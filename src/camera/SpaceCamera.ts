import * as THREE from 'three/webgpu';
import { Vector3d } from '../math/Vector3d';
import { LY } from '../core/constants';
import type { CelestialBody } from '../universe/CelestialBody';
import type { Vec3 } from '../nav/vec';
import { scale, vec3 } from '../nav/vec';
import type { Quat } from '../nav/orientation';
import { basisFromQuat, isFiniteQuat, orientTowards, turnTowards } from '../nav/orientation';
import type { DragKind, DragView, OrbitView, ScreenPoint } from '../nav/dragKernel';
import { applyTurn, chooseDrag, dragTurn } from '../nav/dragKernel';
import { Fling } from '../nav/fling';

/**
 * Kamera für 20 Größenordnungen.
 *
 * Kernidee (Floating Origin): Die Three-Kamera steht IMMER bei (0,0,0).
 * Die "wahre" Position lebt als f64 in worldPosition; der SceneManager
 * platziert jede Frame alle Objekte relativ dazu. f32-Jitter entsteht im
 * Vertex-Shader durch große absolute Koordinaten — nicht im Depth-Buffer —
 * und genau diese großen Koordinaten erreichen die GPU hier nie.
 *
 * Zoom ist exponentiell (Distanz × e^k): dieselbe Geste bewegt nahtlos von 2 m
 * über einer Planetenoberfläche bis auf Lichtjahre hinaus. Genau deshalb passt
 * Pinch perfekt: das Verhältnis der Fingerabstände ist bereits multiplikativ
 * und wird unverändert auf die Zieldistanz angewandt.
 *
 * Zwei Modi mit *einer* gemeinsamen Orientierung:
 *
 *   orbit — Position = Ziel − Blickrichtung × Distanz. Ziehen kreist um das Ziel,
 *           Pinch ändert die Distanz.
 *   free  — worldPosition ist maßgeblich und wird vom Navigator gesetzt. Ziehen
 *           dreht den Blick frei, Pinch schiebt entlang der Blickachse.
 *
 * **Ab v0.4 ist die Orientierung ein Quaternion** (`nav/orientation.ts`) statt eines
 * theta/phi-Paars. Kugelkoordinaten hatten zwei Pole: der Blick ließ sich nicht
 * über den Zenit hinausdrehen (phi war auf [0.02, π−0.02] geklemmt — man kam nie
 * über den Pol eines Planeten), und die Wirkung einer waagerechten Geste ging dort
 * mit sin φ gegen null, während sich der Azimut weiter aufstaute. Diagonale Gesten
 * liefen dadurch schief. Das Quaternion hat keine ausgezeichnete Achse: eine Geste
 * ist *eine* Drehung um die zur Geste senkrechte Kameraachse.
 *
 * **Ab v0.4.4 dreht nichts mehr von selbst.** Die frühere Roll-Nivellierung drehte
 * das Bild nach jeder schrägen Geste sichtbar um seine Mitte nach. Jede Drehung kommt
 * jetzt aus einer Geste (`nav/dragKernel.ts`) oder ihrem Nachlauf (`nav/fling.ts`);
 * im Orbit klebt der berührte Boden am Finger.
 */

const MIN_DISTANCE = 0.5;
const MAX_DISTANCE = 500 * LY;

/** Zwei-Finger-Schwenk dreht gedämpft mit. */
const PAN_GAIN = 0.6;

export type CameraMode = 'orbit' | 'free';

interface PointerState { x: number; y: number; }

export class SpaceCamera {
  readonly camera: THREE.PerspectiveCamera;
  readonly worldPosition = new Vector3d();

  target: CelestialBody | null = null;
  mode: CameraMode = 'orbit';

  /** Weltframe-Norden (Ekliptik J2000, §6) — Bezug der Startorientierung. */
  private readonly worldUp: Vec3 = vec3(0, 0, 1);

  /** Vollständige Orientierung. Einzige Quelle der Wahrheit für die Blickrichtung. */
  private orientation: Quat = orientTowards(vec3(1, 0, 0), vec3(0, 0, 1));

  private distance = 1e7;
  private targetDistance = 1e7;

  /** Nachlauf nach dem Loslassen — die einzige Drehung ohne Finger auf dem Schirm. */
  private readonly fling = new Fling();
  /** Art des laufenden Ein-Finger-Zugs, festgelegt beim Aufsetzen. */
  private dragKind: DragKind = 'look';
  /** Canvas-Rechteck, beim Aufsetzen gemessen — je Event erzwänge es ein Layout. */
  private canvasRect = new DOMRect();

  // Freiflug: Höhe über dem Ankerkörper, vom Navigator pro Frame nachgereicht.
  // Sie ersetzt `distance` als Maßstab für Near-Plane und Pinch-Schub.
  private freeAltitude = 1e6;
  private pendingDolly = 1;

  private readonly pointers = new Map<number, PointerState>();
  private pinchDistance = 0;
  private pinchX = 0;
  private pinchY = 0;

  private readonly view = new THREE.Vector3();   // Blickrichtung (f32-Spiegel)
  private readonly radial = new THREE.Vector3(); // Zentrum → Kamera

  constructor(private readonly dom: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.2,
      1e19, // far ≫ 16 Lj Nachbarschaft; mit Log-Depth-Buffer unkritisch
    );
    // Nur noch Dokumentation der Weltkonvention: die Orientierung kommt aus dem
    // Quaternion, nicht mehr aus lookAt(up). Damit entfällt die Entartung,
    // sobald die Blickachse parallel zu +Z steht.
    this.camera.up.set(0, 0, 1);

    dom.style.touchAction = 'none';
    this.bindPointer();
  }

  // -------------------------------------------------------------- Eingabe

  private bindPointer(): void {
    const dom = this.dom;

    dom.addEventListener('pointerdown', (e) => {
      dom.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.canvasRect = dom.getBoundingClientRect();
      this.fling.press(e.timeStamp / 1000);
      if (this.pointers.size === 1) this.dragKind = this.chooseDragAt(e.clientX, e.clientY);
      if (this.pointers.size === 2) this.beginPinch();
    });

    dom.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const from = { x: prev.x, y: prev.y };
      prev.x = e.clientX;
      prev.y = e.clientY;

      const time = e.timeStamp / 1000;
      if (this.pointers.size === 1) this.turn(this.dragKind, from, prev, 1, time);
      else if (this.pointers.size === 2) this.updatePinch(time);
    });

    const release = (e: PointerEvent): void => {
      if (!this.pointers.delete(e.pointerId)) return;
      if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);
      // Bei 3 → 2 Fingern die Pinch-Basis neu setzen, sonst springt der Zoom
      if (this.pointers.size === 2) this.beginPinch();
      else this.pinchDistance = 0;
      // 2 → 1: der verbleibende Finger beginnt einen neuen Zug, dort wo er liegt
      const rest = this.pointers.values().next().value;
      if (this.pointers.size === 1 && rest) this.dragKind = this.chooseDragAt(rest.x, rest.y);
      if (this.pointers.size === 0) this.fling.release(e.timeStamp / 1000);
    };
    dom.addEventListener('pointerup', release);
    dom.addEventListener('pointercancel', release);
    window.addEventListener('blur', () => {
      this.pointers.clear();
      this.pinchDistance = 0;
      this.fling.stop();
    });

    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomBy(Math.exp(e.deltaY * 0.0015));
      },
      { passive: false },
    );

    // iOS-Safari: Seiten-Zoom per Pinch unterbinden, damit die Geste bei uns ankommt
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      dom.addEventListener(type, (e: Event) => e.preventDefault());
    }
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /**
   * Zugschritt anwenden (Client-Koordinaten). Die Drehung rechnet der Kern aus;
   * hier wird sie nur angehängt und für den Nachlauf gemerkt.
   */
  private turn(kind: DragKind, from: ScreenPoint, to: ScreenPoint, gain: number, time: number): void {
    const s = this.screen();
    const v = dragTurn(kind, s.local(from), s.local(to), s.view, this.orbitView());
    const step = scale(v, gain);
    this.orientation = applyTurn(this.orientation, step);
    this.updateViewVector();
    this.fling.record(time, step);
  }

  private chooseDragAt(x: number, y: number): DragKind {
    const s = this.screen();
    return chooseDrag(s.local({ x, y }), s.view, this.orbitView());
  }

  /** Canvas-Geometrie für den Gestenkern; `local` rechnet Client- in Canvas-Koordinaten um. */
  private screen(): { view: DragView; local: (p: ScreenPoint) => ScreenPoint } {
    const r = this.canvasRect;
    return {
      view: { width: r.width, height: r.height, fovY: this.fovYRadians },
      local: (p) => ({ x: p.x - r.left, y: p.y - r.top }),
    };
  }

  /** Orbit-Geometrie für den Griff (Radius bis zum Boden unter der Kamera), im Freiflug null. */
  private orbitView(): OrbitView | null {
    const t = this.target;
    if (this.mode !== 'orbit' || !t) return null;
    this.radial.copy(this.view).multiplyScalar(-1);
    return { distance: this.distance, radius: t.radius + t.getSurfaceOffset(this.radial) };
  }

  /**
   * Im Orbitmodus die Zieldistanz, im Freiflug ein Schub entlang der Blickachse.
   * Beides ist dieselbe Geste mit derselben Bedeutung — "näher ran" — nur einmal
   * als Bahnradius und einmal als Translation ausgedrückt.
   */
  private zoomBy(factor: number): void {
    if (this.mode === 'orbit') {
      this.targetDistance = THREE.MathUtils.clamp(
        this.targetDistance * factor, MIN_DISTANCE, MAX_DISTANCE,
      );
    } else {
      this.pendingDolly *= factor;
    }
  }

  private twoPointers(): [PointerState, PointerState] {
    const it = this.pointers.values();
    return [it.next().value as PointerState, it.next().value as PointerState];
  }

  private beginPinch(): void {
    const [a, b] = this.twoPointers();
    this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    this.pinchX = (a.x + b.x) / 2;
    this.pinchY = (a.y + b.y) / 2;
  }

  private updatePinch(time: number): void {
    const [a, b] = this.twoPointers();
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;

    if (this.pinchDistance > 0) {
      // Auseinanderziehen (dist wächst) ⇒ heranzoomen ⇒ Distanz sinkt
      this.zoomBy(this.pinchDistance / dist);
      // Zwei-Finger-Schwenk dreht mit, nie als Griff: zwei Finger halten keinen Punkt fest
      const kind = this.mode === 'orbit' ? 'orbit' : 'look';
      this.turn(kind, { x: this.pinchX, y: this.pinchY }, { x: midX, y: midY }, PAN_GAIN, time);
    }

    this.pinchDistance = dist;
    this.pinchX = midX;
    this.pinchY = midY;
  }

  // ------------------------------------------------------------ Steuerung

  /** Erstplatzierung ohne Übergang — nur beim Start. Danach läuft alles über Goto. */
  focus(body: CelestialBody): void {
    this.target = body;
    this.mode = 'orbit';
    this.targetDistance = body.radius * 6;
    this.distance = this.targetDistance;
    this.fling.stop();
  }

  /**
   * In den Orbitmodus wechseln und Distanz sowie Blickrichtung aus der *aktuellen*
   * Position ableiten. Dadurch ist der Wechsel sprungfrei: die Kamera steht danach
   * exakt dort, wo der Anflug sie abgesetzt hat.
   */
  enterOrbit(body: CelestialBody): void {
    this.target = body;
    this.mode = 'orbit';
    this.pendingDolly = 1;
    this.fling.stop();

    const dx = this.worldPosition.x - body.position.x;
    const dy = this.worldPosition.y - body.position.y;
    const dz = this.worldPosition.z - body.position.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 0 && Number.isFinite(d)) {
      this.distance = THREE.MathUtils.clamp(d, MIN_DISTANCE, MAX_DISTANCE);
      this.targetDistance = this.distance;
      // Blick exakt aufs Zentrum, über die kürzeste Drehung: der Roll bleibt, wie er ist.
      // Ein Zurücksetzen auf den Weltnorden wäre ein sichtbarer Ruck um die Bildmitte.
      this.orientation = turnTowards(this.orientation, vec3(-dx / d, -dy / d, -dz / d), 1);
      this.updateViewVector();
    } else {
      this.distance = this.targetDistance = body.radius * 6;
    }
  }

  /** In den Freiflug wechseln. Position und Blickrichtung bleiben, wie sie sind. */
  enterFreeFlight(): void {
    if (this.mode === 'free') return;
    this.mode = 'free';
    this.pendingDolly = 1;
  }

  /**
   * Blick weich auf einen Weltpunkt ziehen (Anflug). Deutlich schneller als der
   * Anflug selbst — sonst schaut man noch am Ziel vorbei, wenn man längst da ist.
   * Gedreht wird um die kürzeste Achse: kein Umweg über Kugelkoordinaten, damit
   * auch ein Ziel senkrecht über der Kamera sauber angefahren wird.
   */
  lookTowards(point: Vec3, dt: number, tau = 0.45): void {
    const dx = point.x - this.worldPosition.x;
    const dy = point.y - this.worldPosition.y;
    const dz = point.z - this.worldPosition.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(d > 0)) return;

    const s = 1 - Math.exp(-dt / tau);
    this.orientation = turnTowards(this.orientation, vec3(dx / d, dy / d, dz / d), s);
    this.updateViewVector();
    this.fling.stop();
  }

  /** Für Bildschirm-Buttons auf Geräten ohne Tastatur/Mausrad. */
  zoomStep(direction: 1 | -1): void {
    this.zoomBy(Math.exp(direction * 0.35));
  }

  setWorldPosition(v: Vec3): void {
    // Schutz der letzten gültigen Lage: ein einziges NaN würde über den
    // Floating-Origin-Sync die gesamte Szene unsichtbar machen (§8).
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) return;
    this.worldPosition.set(v.x, v.y, v.z);
  }

  /** Höhe über dem Ankerkörper — im Freiflug der Maßstab für Near-Plane und Pinch. */
  setFreeAltitude(altitude: number): void {
    this.freeAltitude = Number.isFinite(altitude) ? Math.max(altitude, 1) : 1;
  }

  /**
   * Orthonormale Basis der Blickrichtung für den Navigator.
   * Kommt direkt aus dem Quaternion und ist damit immer exakt orthonormal —
   * die frühere Herleitung über `view × camera.up` wurde nahe der Z-Achse singulär.
   */
  basis(): { forward: Vec3; right: Vec3; up: Vec3 } {
    return basisFromQuat(this.orientation);
  }

  /**
   * Kollision auf Meter-Ebene: schiebt die Kamera bei Bedarf auf die lokale
   * Terrainhöhe. Liefert die Oberflächennormale, wenn geklemmt wurde — der
   * Aufrufer muss dann die einwärts gerichtete Geschwindigkeitskomponente
   * entfernen, sonst drückt der Schub in den Boden und die Kamera klebt fest.
   */
  clampToSurface(body: CelestialBody): Vec3 | null {
    const dx = this.worldPosition.x - body.position.x;
    const dy = this.worldPosition.y - body.position.y;
    const dz = this.worldPosition.z - body.position.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(d > 0)) return null;

    this.radial.set(dx / d, dy / d, dz / d);
    const minD = body.radius + body.getSurfaceOffset(this.radial) + 2;
    if (d >= minD) return null;

    this.worldPosition.set(
      body.position.x + this.radial.x * minD,
      body.position.y + this.radial.y * minD,
      body.position.z + this.radial.z * minD,
    );
    return { x: this.radial.x, y: this.radial.y, z: this.radial.z };
  }

  // -------------------------------------------------------------- Per Frame

  /**
   * Schritt 1: Orientierung. Läuft *vor* der Navigation, damit der Navigator mit
   * der Blickrichtung dieses Frames rechnet und nicht mit der des letzten.
   */
  updateOrientation(dt: number): void {
    // Einzige Drehung ohne Finger: der Nachlauf. Keine Nivellierung — sie drehte das
    // Bild nach schrägen Gesten ungefragt um seine Mitte.
    const coast = this.fling.coast(dt);
    if (coast) this.orientation = applyTurn(this.orientation, coast);

    // Letzte Verteidigungslinie: eine entartete Orientierung würde über die
    // Kameramatrix die ganze Szene verschlucken (Muster §8: stiller Fallback).
    if (!isFiniteQuat(this.orientation)) {
      console.warn('[SpaceCamera] Orientierung entartet — auf Weltnorden zurückgesetzt.');
      this.orientation = orientTowards(vec3(1, 0, 0), this.worldUp);
      this.fling.stop();
    }

    this.updateViewVector();
    // Der Pinch-Schub wird *vor* der Navigation eingerechnet, damit der Navigator
    // Nachbarschaft und Kollision für die tatsächlich neue Position auswertet.
    if (this.mode === 'free') this.applyDolly();
  }

  /** Schritt 2: Position und Projektion. Läuft *nach* der Navigation. */
  updatePlacement(dt: number): void {
    this.updateViewVector(); // lookTowards kann die Richtung zwischendurch gedreht haben
    if (this.mode === 'orbit') this.placeOrbit(dt);

    // Floating Origin: Kamera bleibt im Ursprung. Die Orientierung wird direkt
    // gesetzt statt über lookAt — lookAt braucht einen up-Vektor und entartet,
    // sobald die Blickachse parallel dazu steht (genau der alte Pol-Fehler).
    this.camera.position.set(0, 0, 0);
    this.camera.quaternion.set(
      this.orientation.x, this.orientation.y, this.orientation.z, this.orientation.w,
    );

    // Dynamische Near-Plane: verteilt die Log-Depth-Auflösung sinnvoll und
    // verbessert das Culling — von 20 cm am Boden bis 10^6 m im Deep Space.
    const near = THREE.MathUtils.clamp(Math.max(this.altitude, 1) * 1e-3, 0.2, 1e6);
    if (Math.abs(near - this.camera.near) / this.camera.near > 0.1) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
  }

  private placeOrbit(dt: number): void {
    const t = this.target;
    if (!t) return;

    // Zoom im Log-Raum glätten (gleichmäßig über alle Größenordnungen)
    const s = 1 - Math.exp(-dt * 8);
    this.distance = Math.exp(
      THREE.MathUtils.lerp(Math.log(this.distance), Math.log(this.targetDistance), s),
    );

    // Radialrichtung ist die Gegenrichtung des Blicks ⇒ Bodenhöhe dort sampeln
    this.radial.copy(this.view).multiplyScalar(-1);
    const minD = t.radius + t.getSurfaceOffset(this.radial) + 2;
    if (this.targetDistance < minD) this.targetDistance = minD;
    if (this.distance < minD) this.distance = minD;

    this.worldPosition.set(
      t.position.x + this.radial.x * this.distance,
      t.position.y + this.radial.y * this.distance,
      t.position.z + this.radial.z * this.distance,
    );
  }

  private applyDolly(): void {
    if (this.pendingDolly === 1) return;
    // Pinch/Rad im Freiflug: Translation entlang der Blickachse, skaliert mit der
    // Ankerhöhe — damit fühlt sich die Geste in 2 m und in 2 AE identisch an.
    const step = THREE.MathUtils.clamp(
      this.freeAltitude * (1 - this.pendingDolly),
      -4 * this.freeAltitude,
      0.9 * this.freeAltitude,
    );
    this.worldPosition.set(
      this.worldPosition.x + this.view.x * step,
      this.worldPosition.y + this.view.y * step,
      this.worldPosition.z + this.view.z * step,
    );
    this.pendingDolly = 1;
  }

  private updateViewVector(): void {
    const f = basisFromQuat(this.orientation).forward;
    this.view.set(f.x, f.y, f.z);
  }

  get altitude(): number {
    if (this.mode === 'free') return this.freeAltitude;
    return this.target ? this.distance - this.target.radius : 0;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  get fovYRadians(): number {
    return (this.camera.fov * Math.PI) / 180;
  }
}
