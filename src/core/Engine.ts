import * as THREE from 'three/webgpu';
import { SceneManager } from './SceneManager';
import { SimClock } from './SimClock';
import { LY, EARTH_RADIUS } from './constants';
import { SpaceCamera } from '../camera/SpaceCamera';
import { UniverseManager } from '../universe/UniverseManager';
import type { CelestialBody } from '../universe/CelestialBody';
import { TerrainField } from '../terrain/tileGeometry';
import type { TileSpec } from '../terrain/tileGeometry';
import { configureTerrainProvider, getTerrainProvider } from '../terrain/TerrainProvider';
import type { TerrainBackendChoice } from '../terrain/TerrainProvider';
import { Navigator } from '../nav/Navigator';
import type { NavResult } from '../nav/Navigator';
import { pickBody, screenRay, tapTolerance } from '../nav/picking';
import type { BodyRef, NavInput } from '../nav/types';
import { THRUST_EPSILON } from '../nav/types';
import type { Vec3 } from '../nav/vec';
import { formatDistance, formatSpeed, formatScale } from '../nav/format';
import { FlightControls } from '../ui/FlightControls';

/**
 * Engine: verdrahtet Renderer, Uhr, Universum, Szene und Kamera
 * und besitzt die Main-Loop.
 *
 * Frame-Choreografie (Reihenfolge ist Teil des Vertrags):
 *   1. clock.tick()            → dt (real) & simTime (gewarpt)
 *   2. universe.update()       → analytische Kepler-Propagation aller
 *                                f64-Positionen und -Geschwindigkeiten
 *                                + Lazy-Systeminstanziierung
 *   3. camera.updateOrientation() → Blickrichtung dieses Frames
 *   4. stepNavigation()        → freier Flug / Anflug; setzt im Freiflug die
 *                                f64-Kameraposition (Realzeit, nicht Simzeit!)
 *   5. camera.updatePlacement() → Orbitmodus leitet die Position aus dem Ziel ab,
 *                                dann Near-Plane und Blickmatrix
 *   6. scene.syncToCamera()    → Floating Origin: alles kamerarelativ (f32),
 *                                Per-Body-Hooks (Terrain-LOD, Star-Sprites)
 *   7. terrain.pump()          → Kachel-Jobs nach Kameradistanz priorisiert
 *                                an Worker/GPU verteilen (nie im Frame bauen)
 *   8. renderer.render()       → WebGPU, logarithmischer Depth-Buffer
 *
 * Schritt 3 liegt bewusst *vor* Schritt 4: der Navigator schiebt entlang der
 * Blickrichtung, und die soll die dieses Frames sein, nicht die des letzten.
 */
export class Engine {
  private renderer!: THREE.WebGPURenderer;
  private readonly sceneManager = new SceneManager();
  private readonly clock = new SimClock();
  private camera!: SpaceCamera;
  private universe!: UniverseManager;
  private readonly terrain = getTerrainProvider();

  // Navigation (Stufe 1)
  private readonly navigator = new Navigator();
  private flightControls!: FlightControls;
  private readonly navBodies: BodyRef[] = [];
  private readonly byUid = new Map<string, CelestialBody>();
  private nav: NavResult | null = null;
  private gotoUid: string | null = null;
  private drift = { uid: '', altitude: 0, frames: 0, warned: false };

  // Adaptive Renderauflösung (Tablets sind fast immer fillrate-limitiert)
  private maxPixelRatio = 1;
  private renderScale = 1;
  private smoothedFrameMs = 16;
  private lastScaleChange = 0;

  private constructor(
    private readonly container: HTMLElement,
    private readonly hud: HTMLElement,
  ) {}

  static async create(container: HTMLElement, hud: HTMLElement): Promise<Engine> {
    const engine = new Engine(container, hud);
    await engine.init();
    return engine;
  }

  private async init(): Promise<void> {
    if (!('gpu' in navigator)) {
      console.info('[Engine] WebGPU nicht verfügbar — WebGPURenderer nutzt den WebGL2-Fallback.');
    }

    // Log-Depth-Buffer: Tiefenpräzision wird logarithmisch verteilt, damit
    // ein Cockpit in 2 m und ein Mond in 4e8 m im selben Frame ohne
    // Z-Fighting koexistieren. (Alternative auf WebGPU: Reversed-Z; die
    // Wahl ist hier gekapselt und später austauschbar.)
    // Hinweis: Options-Objekt untypisiert übergeben, da die @types-Definitionen
    // der WebGPURenderer-Parameter der Renderer-API teils hinterherhinken.
    const rendererParams = { antialias: true, logarithmicDepthBuffer: true };
    this.renderer = new THREE.WebGPURenderer(rendererParams as never);
    await this.renderer.init();

    this.maxPixelRatio = Math.min(window.devicePixelRatio, 2);
    this.renderScale = this.maxPixelRatio;
    this.renderer.setPixelRatio(this.renderScale);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.container.appendChild(this.renderer.domElement);

    this.camera = new SpaceCamera(this.renderer.domElement);

    // Terrain-Backend VOR dem Universum konfigurieren: PlanetLOD fordert im
    // Konstruktor bereits die sechs Wurzelkacheln an.
    const backend = await configureTerrainProvider({
      renderer: this.renderer,
      backend: readBackendChoice(),
      probe: buildProbe(),
    });
    console.info(`[Engine] Terrain-Backend: ${backend}`);

    this.universe = new UniverseManager(this.sceneManager);
    this.universe.loadCatalog();                 // reale Körper (Sol-System)
    this.universe.generateNeighborhood(16 * LY); // prozedurale Sterne ringsum

    const start = this.universe.findBody('Erde') ?? this.sceneManager.allBodies[0];
    if (start) {
      this.universe.populateSystem(start);
      this.universe.update(this.clock.simTime, this.camera.worldPosition);
      this.camera.focus(start); // Erstplatzierung ohne Anflug — es gibt noch kein "Vorher"
    }

    this.flightControls = new FlightControls({
      container: document.getElementById('flight') ?? this.container,
      canvas: this.renderer.domElement,
      hud: false, // das HUD dieser Engine ist #hud; zwei wären einer zu viel
      onDoubleTap: (x, y) => this.gotoAtScreen(x, y),
    });

    this.bindInput();
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => this.onResize());

    // Debug-Zugriff in der Konsole
    (window as unknown as { engine: Engine }).engine = this;

    // ---- Main-Loop ----
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private frame(): void {
    const dt = this.clock.tick();

    this.universe.update(this.clock.simTime, this.camera.worldPosition);
    this.camera.updateOrientation(dt);
    this.stepNavigation(dt);
    this.camera.updatePlacement(dt);
    this.sceneManager.syncToCamera(this.camera.worldPosition, dt);
    this.terrain.pump();

    this.adaptResolution(dt);
    this.updateHud();
    this.renderer.render(this.sceneManager.scene, this.camera.camera);
  }

  /**
   * Renderauflösung nachführen. Grob gestuft und mit langer Sperrzeit, weil
   * jede Änderung die Framebuffer neu allokiert — häufiges Nachregeln würde
   * genau das Ruckeln erzeugen, das es verhindern soll.
   */
  private adaptResolution(dt: number): void {
    this.smoothedFrameMs += (dt * 1000 - this.smoothedFrameMs) * 0.05;
    const now = performance.now();
    if (now - this.lastScaleChange < 2500) return;

    let next = this.renderScale;
    if (this.smoothedFrameMs > 26 && this.renderScale > 0.7) next = this.renderScale - 0.25;
    else if (this.smoothedFrameMs < 14 && this.renderScale < this.maxPixelRatio) next = this.renderScale + 0.25;

    next = Math.max(0.7, Math.min(this.maxPixelRatio, next));
    if (Math.abs(next - this.renderScale) < 0.01) return;

    this.renderScale = next;
    this.renderer.setPixelRatio(next);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.lastScaleChange = now;
  }

  // ------------------------------------------------------------ Navigation

  /**
   * Ein Navigationsschritt in **Realzeit**.
   *
   * Der wichtigste Umrechnungspunkt steht gleich am Anfang: Kepler liefert
   * Geschwindigkeiten pro *Sim*sekunde, der Navigator rechnet pro *Real*sekunde.
   * Ohne den Warpfaktor stünde der Flug bei hohem Zeitraffer still, während der
   * Planet davonrast — genau der Fehler, den die Offline-Tests abfangen.
   */
  private stepNavigation(dt: number): void {
    const input = this.camera.navInput(this.flightControls.input, dt);

    // Schub aus dem Orbitmodus heraus löst den Freiflug aus. Die Kamera war bis
    // dahin starr am Ziel montiert, die Relativgeschwindigkeit ist also null.
    if (this.camera.mode === 'orbit' && Math.abs(input.forward) > THRUST_EPSILON) {
      this.camera.enterFreeFlight();
      this.navigator.setRelativeVelocity({ x: 0, y: 0, z: 0 });
    }

    if (this.camera.mode !== 'free') {
      this.flightControls.endFrame();
      this.nav = null;
      return;
    }

    this.collectBodies();
    const result = this.navigator.update(
      { position: toVec(this.camera.worldPosition), ...this.camera.basis() },
      this.navBodies,
      input,
      dt,
    );
    this.flightControls.endFrame();
    this.nav = result;

    this.camera.setWorldPosition(result.position);
    this.camera.setFreeAltitude(result.altitude);
    if (result.lookAt) this.camera.lookTowards(result.lookAt, dt);

    // Terrainkollision bleibt in der Kamera (§5). Klemmt sie, muss die einwärts
    // gerichtete Komponente raus — sonst drückt der Schub in den Boden und die
    // Kamera klebt beim Loslassen fest.
    const anchor = result.anchor ? this.byUid.get(result.anchor.id) : null;
    if (anchor) {
      const normal = this.camera.clampToSurface(anchor);
      if (normal) {
        const v = this.navigator.getRelativeVelocity();
        const into = v.x * normal.x + v.y * normal.y + v.z * normal.z;
        if (into < 0) {
          this.navigator.setRelativeVelocity({
            x: v.x - normal.x * into,
            y: v.y - normal.y * into,
            z: v.z - normal.z * into,
          });
        }
      }
    }

    this.verifyFrameTracking(result, input);
    this.finishGoto(result);
  }

  /**
   * Laufzeit-Selbsttest für den einen Einbaufehler, den kein Offline-Test finden
   * kann: die Verwechslung von Sim- und Realsekunden bei `BodyRef.velocity`.
   * Symptom ist immer dasselbe — die Kamera treibt ohne Schub und mit Assistenz
   * vom Ankerkörper weg. Warnung erst nach 30 aufeinanderfolgenden Frames, damit
   * ein abgebrochener Anflug oder ein Ankerwechsel nicht fälschlich anschlägt.
   * (Muster wie in `gpuTerrain.ts`: unprüfbarer Pfad ⇒ Selbsttest zur Laufzeit.)
   */
  private verifyFrameTracking(result: NavResult, input: NavInput): void {
    if (this.drift.warned) return;

    const idle = result.mode === 'free' && input.assist && Math.abs(input.forward) <= THRUST_EPSILON;
    if (!result.anchor || !idle || result.altitude < 100) {
      this.drift.uid = '';
      this.drift.frames = 0;
      return;
    }
    if (this.drift.uid !== result.anchor.id) {
      this.drift.uid = result.anchor.id;
      this.drift.altitude = result.altitude;
      this.drift.frames = 0;
      return;
    }

    const before = this.drift.altitude;
    this.drift.altitude = result.altitude;
    this.drift.frames = Math.abs(result.altitude - before) > 0.2 * before ? this.drift.frames + 1 : 0;

    if (this.drift.frames >= 30) {
      this.drift.warned = true;
      console.warn(
        '[Engine] Freiflug driftet ohne Schub vom Ankerkörper weg. Fast immer dieselbe ' +
        'Ursache: BodyRef.velocity ist nicht mit dem Time-Warp-Faktor multipliziert — ' +
        'Kepler liefert m pro Simsekunde, der Navigator erwartet m pro Realsekunde.',
      );
    }
  }

  /**
   * Ein Anflug endet im Orbitmodus um das Ziel: die Zielauswahl bedeutet
   * "bring mich hin und lass mich es ansehen". Da `enterOrbit` Distanz und
   * Blickrichtung aus der erreichten Position ableitet, ist der Wechsel sprungfrei.
   * Ein *abgebrochener* Anflug (Schub während des Flugs) bleibt dagegen im Freiflug.
   */
  private finishGoto(result: NavResult): void {
    if (!this.gotoUid) return;
    if (!result.gotoTarget) {
      this.gotoUid = null; // abgebrochen
      return;
    }
    if (result.mode === 'free') {
      const body = this.byUid.get(this.gotoUid);
      this.gotoUid = null;
      if (body) this.camera.enterOrbit(body);
    }
  }

  /** BodyRef-Liste dieses Frames. Die uid entkoppelt sie vom Namen (der sich wiederholen kann). */
  private collectBodies(): void {
    const warp = this.clock.paused ? 0 : this.clock.timeWarp;
    this.navBodies.length = 0;
    this.byUid.clear();
    for (const b of this.sceneManager.allBodies) {
      this.byUid.set(b.uid, b);
      // Ein einziger nicht-endlicher Wert würde über das Softmin der Referenzhöhe
      // die gesamte Navigation und damit die Kameraposition vergiften (§4.7).
      if (!isFinite3(b.position) || !isFinite3(b.velocity)) continue;
      this.navBodies.push({
        id: b.uid,
        name: b.name,
        position: { x: b.position.x, y: b.position.y, z: b.position.z },
        radius: b.radius,
        // Sim- → Realsekunden. Ohne diesen Faktor hängt man bei Warp hinterher.
        velocity: { x: b.velocity.x * warp, y: b.velocity.y * warp, z: b.velocity.z * warp },
      });
    }
  }

  private bodyRef(body: CelestialBody): BodyRef {
    const warp = this.clock.paused ? 0 : this.clock.timeWarp;
    return {
      id: body.uid,
      name: body.name,
      position: { x: body.position.x, y: body.position.y, z: body.position.z },
      radius: body.radius,
      velocity: {
        x: body.velocity.x * warp,
        y: body.velocity.y * warp,
        z: body.velocity.z * warp,
      },
    };
  }

  /** Doppeltipp: Bildschirmpunkt → Weltstrahl → Körper → Anflug. */
  private gotoAtScreen(x: number, y: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const fov = this.camera.fovYRadians;
    const ray = screenRay(x, y, rect.width, rect.height, fov, this.camera.basis());

    this.collectBodies();
    const hit = pickBody(
      toVec(this.camera.worldPosition),
      ray,
      this.navBodies,
      tapTolerance(fov, rect.height),
    );
    if (!hit) return;

    const body = this.byUid.get(hit.body.id);
    if (body) this.setTarget(body);
  }

  // ------------------------------------------------------------ Interaktion

  /** Zielwechsel ist ab v0.3 immer ein sichtbarer Flug, nie ein Sprung (§7, Stufe 1). */
  private setTarget(body: CelestialBody): void {
    this.universe.populateSystem(body); // prozedurale Sterne beim Fokussieren füllen
    // Aus dem Orbit heraus ist die Relativgeschwindigkeit per Definition null — die
    // Kamera hing starr am Ziel. Ohne dieses Zurücksetzen übernähme ein abgebrochener
    // Anflug die Geschwindigkeit einer längst beendeten Flugphase.
    if (this.camera.mode === 'orbit') this.navigator.setRelativeVelocity({ x: 0, y: 0, z: 0 });
    this.camera.enterFreeFlight();
    this.navigator.requestGoto(toVec(this.camera.worldPosition), this.bodyRef(body));
    this.gotoUid = body.uid;
  }

  private cycleTarget(direction: 1 | -1): void {
    const bodies = this.sceneManager.allBodies;
    if (bodies.length === 0) return;
    // Im Freiflug ist der Ankerkörper der Bezug, nicht das alte Orbitziel.
    const anchor = this.nav?.anchor ? this.byUid.get(this.nav.anchor.id) ?? null : null;
    const current = this.camera.mode === 'free' ? anchor ?? this.camera.target : this.camera.target;
    const i = current ? bodies.indexOf(current) : 0;
    const next = (i + direction + bodies.length) % bodies.length;
    this.setTarget(bodies[next]);
  }

  private action(act: string): void {
    switch (act) {
      case 'prev': this.cycleTarget(-1); break;
      case 'next': this.cycleTarget(1); break;
      case 'in': this.camera.zoomStep(-1); break;
      case 'out': this.camera.zoomStep(1); break;
      case 'slower': this.clock.slower(); break;
      case 'faster': this.clock.faster(); break;
      case 'warp': this.clock.resetWarp(); break;
      case 'pause': this.clock.togglePause(); break;
    }
  }

  private bindInput(): void {
    // Bildschirm-Buttons (Tablet): pointerdown statt click ⇒ keine 300-ms-Verzögerung
    for (const button of document.querySelectorAll<HTMLElement>('#controls button')) {
      button.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.action(button.dataset.act ?? '');
      });
    }

    window.addEventListener('keydown', (e) => {
      switch (e.key) {
        case 'Tab':
          e.preventDefault();
          this.cycleTarget(e.shiftKey ? -1 : 1);
          break;
        case '.': this.action('faster'); break;
        case ',': this.action('slower'); break;
        case '0': this.action('warp'); break;
        case 'p': case 'P': this.action('pause'); break;
        default: {
          const n = Number(e.key);
          if (n >= 1 && n <= 9) {
            const body = this.sceneManager.allBodies[n - 1];
            if (body) this.setTarget(body);
          }
        }
      }
    });
  }

  // ------------------------------------------------------------------- HUD

  private updateHud(): void {
    const warpLabel = this.clock.paused ? 'PAUSE' : `×${this.clock.timeWarp.toLocaleString('de-DE')}`;
    const date = this.clock.date.toISOString().replace('T', ' ').slice(0, 16);
    const fps = (1000 / Math.max(this.smoothedFrameMs, 0.01)).toFixed(0);
    const workers = this.terrain.backend === 'worker' ? `×${this.terrain.workerCount}` : '';
    // Verlorene Kachel-Jobs sind ein Hardwaresignal (Worker gestorben), kein Rauschen:
    // sie waren bisher unsichtbar und endeten in einem dauerhaft leeren Planeten.
    const lost = this.terrain.lost > 0 ? `   Verloren ${this.terrain.lost}` : '';

    const n = this.nav;
    const label = n?.anchor?.name ?? this.camera.target?.name ?? '—';
    const speed = n ? `   v ${formatSpeed(n.relativeSpeed)}` : '';
    const modeLabel = !n
      ? 'ORBIT'
      : n.mode === 'goto'
        ? `ANFLUG ${Math.round(n.gotoProgress * 100)} %`
        : `FLUG ${formatScale(this.flightControls.input.speedScale)}`;

    this.hud.textContent =
      `${label}   Höhe ${formatDistance(this.camera.altitude)}${speed}\n` +
      `${modeLabel}   Warp ${warpLabel}   ${date} UTC\n` +
      `${fps} fps @ ${this.renderScale.toFixed(2)}×   ` +
      `Terrain ${this.terrain.backend}${workers}   Queue ${this.terrain.pending}   ` +
      `Kacheln ${this.terrain.built}${lost}`;

    const warpButton = document.querySelector<HTMLElement>('#controls [data-act="warp"]');
    if (warpButton) warpButton.textContent = this.clock.paused ? 'Pause' : `×${shortWarp(this.clock.timeWarp)}`;
  }

  private onResize(): void {
    this.renderer.setPixelRatio(this.renderScale);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.resize(window.innerWidth, window.innerHeight);
  }
}

function isFinite3(v: { x: number; y: number; z: number }): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/** Vector3d → das schlanke {x,y,z} der Navigationskerne (dieselben f64-Zahlen). */
function toVec(v: { x: number; y: number; z: number }): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

/** ?terrain=worker|gpu|sync — sonst 'auto' (= Worker, siehe TerrainProvider). */
function readBackendChoice(): TerrainBackendChoice {
  const value = new URLSearchParams(window.location.search).get('terrain');
  return value === 'worker' || value === 'gpu' || value === 'sync' ? value : 'auto';
}

/** Kleine Referenzkachel für den Selbsttest des GPU-Compute-Pfads. */
function buildProbe(): { field: TerrainField; tile: TileSpec } {
  const field = new TerrainField({
    seed: 0x5eed,
    radius: EARTH_RADIUS,
    terrain: {
      amplitude: 0.0018, frequency: 1.6, octaves: 5,
      ocean: true, oceanLevel: 0.02, palette: 'earth',
      maxDepth: 14, resolution: 16,
    },
  });
  const tile: TileSpec = {
    face: 0, level: 3, u0: -0.25, v0: 0.125, resolution: 16,
    centerX: 0, centerY: 0, centerZ: 0,
  };
  return { field, tile };
}

function shortWarp(warp: number): string {
  if (warp < 1000) return String(warp);
  if (warp < 1e6) return `${Math.round(warp / 1e3)}k`;
  return `${(warp / 1e6).toFixed(warp < 1e7 ? 1 : 0)}M`;
}
