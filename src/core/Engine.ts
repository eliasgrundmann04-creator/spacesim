import * as THREE from 'three/webgpu';
import { SceneManager } from './SceneManager';
import { SimClock } from './SimClock';
import { LY } from './constants';
import { SpaceCamera } from '../camera/SpaceCamera';
import { UniverseManager } from '../universe/UniverseManager';
import { configureTerrainProvider, getTerrainProvider } from '../terrain/TerrainProvider';
import { Navigator } from '../nav/Navigator';
import type { NavResult } from '../nav/Navigator';
import type { NavInput } from '../nav/types';
import { THRUST_EPSILON } from '../nav/types';
import { FlightControls } from '../ui/FlightControls';
import { EngineHud, readBackendChoice, buildProbe } from './EngineHud';
import { EngineInput, toVec } from './EngineInput';
import { FrameStats } from '../perf/frameStats';
import { EngineBench, parseBenchParam } from './EngineBench';

/**
 * Engine: verdrahtet Renderer, Uhr, Universum, Szene und Kamera und besitzt die Main-Loop.
 */
export class Engine {
  private renderer!: THREE.WebGPURenderer;
  private readonly sceneManager = new SceneManager();
  private readonly clock = new SimClock();
  private camera!: SpaceCamera;
  private universe!: UniverseManager;
  private readonly terrain = getTerrainProvider();
  private readonly stats = new FrameStats();

  private readonly navigator = new Navigator();
  private flightControls!: FlightControls;
  private nav: NavResult | null = null;
  private gotoUid: string | null = null;
  private drift = { uid: '', altitude: 0, frames: 0, warned: false };

  private hudHandler!: EngineHud;
  private inputHandler!: EngineInput;
  private benchHandler: EngineBench | null = null;

  private maxPixelRatio = 1;
  private renderScale = 1;
  private smoothedFrameMs = 16;
  private lastScaleChange = 0;

  private constructor(private readonly container: HTMLElement, hud: HTMLElement) {
    this.hudHandler = new EngineHud(hud);
    this.inputHandler = new EngineInput({
      getCamera: () => this.camera,
      clock: this.clock,
      sceneManager: this.sceneManager,
      getUniverse: () => this.universe,
      navigator: this.navigator,
      getDomElement: () => this.renderer.domElement,
      getNav: () => this.nav,
      setGotoUid: (uid) => { this.gotoUid = uid; },
      getGotoUid: () => this.gotoUid,
    });
  }

  static async create(container: HTMLElement, hud: HTMLElement): Promise<Engine> {
    const engine = new Engine(container, hud);
    await engine.init();
    return engine;
  }

  private async init(): Promise<void> {
    if (!('gpu' in navigator)) console.info('[Engine] WebGPU nicht verfügbar — WebGPURenderer nutzt WebGL2-Fallback.');

    this.renderer = new THREE.WebGPURenderer({ antialias: true, logarithmicDepthBuffer: true } as never);
    await this.renderer.init();

    const benchOpt = parseBenchParam();
    this.maxPixelRatio = Math.min(window.devicePixelRatio, 2);
    this.renderScale = benchOpt.active ? benchOpt.scale : this.maxPixelRatio;
    this.renderer.setPixelRatio(this.renderScale);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.container.appendChild(this.renderer.domElement);

    this.camera = new SpaceCamera(this.renderer.domElement);

    const backend = await configureTerrainProvider({
      renderer: this.renderer,
      backend: readBackendChoice(),
      probe: buildProbe(),
    });
    console.info(`[Engine] Terrain-Backend: ${backend}`);

    this.universe = new UniverseManager(this.sceneManager);
    this.universe.loadCatalog();
    this.universe.generateNeighborhood(16 * LY);

    const start = this.universe.findBody('Erde') ?? this.sceneManager.allBodies[0];
    if (start) {
      this.universe.populateSystem(start);
      this.universe.update(this.clock.simTime, this.camera.worldPosition);
      this.camera.focus(start);
    }

    if (benchOpt.active) {
      this.benchHandler = new EngineBench(
        this.camera, this.clock, () => this.universe, this.terrain, this.stats, this.renderScale,
      );
    }

    this.flightControls = new FlightControls({
      container: document.getElementById('flight') ?? this.container,
      canvas: this.renderer.domElement,
      hud: false,
      onDoubleTap: (x, y) => this.inputHandler.gotoAtScreen(x, y),
    });

    this.inputHandler.bindInput();
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => this.onResize());

    (window as unknown as { engine: Engine }).engine = this;
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private frame(): void {
    const now = performance.now();
    this.stats.beginFrame(now);

    const dt = this.clock.tick();
    this.universe.update(this.clock.simTime, this.camera.worldPosition);
    this.stats.mark(0);

    this.camera.updateOrientation(dt);
    this.stats.mark(1);

    this.stepNavigation(dt);
    this.stats.mark(2);

    this.camera.updatePlacement(dt);
    this.stats.mark(3);

    this.sceneManager.syncToCamera(this.camera.worldPosition, dt, this.camera.frame);
    this.stats.mark(4);

    this.terrain.pump();
    this.stats.mark(5);

    this.adaptResolution(dt);

    this.renderer.render(this.sceneManager.scene, this.camera.camera);
    this.stats.mark(6);

    this.stats.endFrame(performance.now(), this.renderer.info);

    if (this.benchHandler) this.benchHandler.step(now);

    this.hudHandler.update({
      clock: this.clock,
      smoothedFrameMs: this.smoothedFrameMs,
      renderScale: this.renderScale,
      terrain: this.terrain,
      nav: this.nav,
      camera: this.camera,
      flightControls: this.flightControls,
      stats: this.stats,
    });
  }

  private adaptResolution(dt: number): void {
    if (this.benchHandler) return;
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

  private stepNavigation(dt: number): void {
    const input = this.camera.navInput(this.flightControls.input, dt);

    if (this.camera.mode === 'orbit' && Math.abs(input.forward) > THRUST_EPSILON) {
      this.camera.enterFreeFlight();
      this.navigator.resetMotion(this.camera.target && this.inputHandler.bodyRef(this.camera.target));
    }

    if (this.camera.mode !== 'free') {
      this.flightControls.endFrame();
      this.nav = null;
      return;
    }

    this.inputHandler.collectBodies();
    const result = this.navigator.update(
      { position: toVec(this.camera.worldPosition), ...this.camera.basis() },
      this.inputHandler.navBodies,
      input,
      dt,
    );
    this.flightControls.endFrame();
    this.nav = result;

    this.camera.setWorldPosition(result.position);
    this.camera.setFreeAltitude(result.altitude);
    if (result.lookAt) this.camera.lookTowards(result.lookAt, dt);

    const anchor = result.anchor ? this.inputHandler.byUid.get(result.anchor.id) : null;
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
      console.warn('[Engine] Freiflug driftet ohne Schub vom Ankerkörper weg.');
    }
  }

  private finishGoto(result: NavResult): void {
    if (!this.gotoUid) return;
    if (!result.gotoTarget) {
      this.gotoUid = null;
      return;
    }
    if (result.mode === 'free') {
      const body = this.inputHandler.byUid.get(this.gotoUid);
      this.gotoUid = null;
      if (body) this.camera.enterOrbit(body);
    }
  }

  private onResize(): void {
    this.renderer.setPixelRatio(this.renderScale);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.resize(window.innerWidth, window.innerHeight);
  }
}
