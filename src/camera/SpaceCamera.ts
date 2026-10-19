import * as THREE from 'three/webgpu';
import { Vector3d } from '../math/Vector3d';
import { LY } from '../core/constants';
import type { CelestialBody } from '../universe/CelestialBody';
import type { NavInput } from '../nav/types';
import type { Vec3 } from '../nav/vec';
import { vec3 } from '../nav/vec';
import type { Quat } from '../nav/orientation';
import { basisFromQuat, isFiniteQuat, orientTowards, turnTowards } from '../nav/orientation';
import type { OrbitView } from '../nav/dragKernel';
import { applyTurn } from '../nav/dragKernel';
import { CameraTouchInput } from './cameraTouch';
import { applyDolly, clampToSurface, computeNearPlane, placeOrbit } from './cameraPlacement';

/**
 * Kamera für 20 Größenordnungen.
 *
 * Kernidee (Floating Origin): Die Three-Kamera steht IMMER bei (0,0,0).
 * Die "wahre" Position lebt als f64 in worldPosition; der SceneManager
 * platziert jede Frame alle Objekte relativ dazu.
 *
 * Zwei Modi mit *einer* gemeinsamen Orientierung:
 *   orbit — Position = Ziel − Blickrichtung × Distanz. Ziehen kreist um das Ziel.
 *   free  — worldPosition ist maßgeblich und wird vom Navigator gesetzt.
 *
 * Gesten- und Pointersteuerung sind in `cameraTouch.ts` abgetrennt,
 * Oberflächen- und Platzierungslogik in `cameraPlacement.ts`.
 */

const MIN_DISTANCE = 0.5;
const MAX_DISTANCE = 500 * LY;

export type CameraMode = 'orbit' | 'free';

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

  // Freiflug: Höhe über dem Ankerkörper, vom Navigator pro Frame nachgereicht.
  private freeAltitude = 1e6;
  private pendingDolly = 1;

  private readonly touchInput: CameraTouchInput;

  private readonly view = new THREE.Vector3();   // Blickrichtung (f32-Spiegel)
  private readonly radial = new THREE.Vector3(); // Zentrum → Kamera

  constructor(private readonly dom: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.2,
      1e19,
    );
    this.camera.up.set(0, 0, 1);

    this.touchInput = new CameraTouchInput(dom, {
      getFovYRadians: () => this.fovYRadians,
      getOrbitView: () => this.orbitView(),
      getMode: () => this.mode,
      applyStep: (step) => {
        this.orientation = applyTurn(this.orientation, step);
        this.updateViewVector();
      },
      zoomBy: (factor) => this.zoomBy(factor),
    });
  }

  navInput(base: NavInput, dt: number): NavInput {
    return this.touchInput.glide.step(dt, this.basis(), base);
  }

  private orbitView(): OrbitView | null {
    const t = this.target;
    if (this.mode !== 'orbit' || !t) return null;
    this.radial.copy(this.view).multiplyScalar(-1);
    return { distance: this.distance, radius: t.radius + t.getSurfaceOffset(this.radial) };
  }

  private zoomBy(factor: number): void {
    if (this.mode === 'orbit') {
      this.targetDistance = THREE.MathUtils.clamp(
        this.targetDistance * factor, MIN_DISTANCE, MAX_DISTANCE,
      );
    } else {
      this.pendingDolly *= factor;
    }
  }

  // ------------------------------------------------------------ Steuerung

  /** Erstplatzierung ohne Übergang — nur beim Start. Danach läuft alles über Goto. */
  focus(body: CelestialBody): void {
    this.target = body;
    this.mode = 'orbit';
    this.targetDistance = body.radius * 6;
    this.distance = this.targetDistance;
    this.touchInput.fling.stop();
    this.touchInput.glide.reset();
  }

  /**
   * In den Orbitmodus wechseln und Distanz sowie Blickrichtung aus der *aktuellen*
   * Position ableiten. Dadurch ist der Wechsel sprungfrei.
   */
  enterOrbit(body: CelestialBody): void {
    this.target = body;
    this.mode = 'orbit';
    this.pendingDolly = 1;
    this.touchInput.fling.stop();
    this.touchInput.glide.reset();

    const dx = this.worldPosition.x - body.position.x;
    const dy = this.worldPosition.y - body.position.y;
    const dz = this.worldPosition.z - body.position.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 0 && Number.isFinite(d)) {
      this.distance = THREE.MathUtils.clamp(d, MIN_DISTANCE, MAX_DISTANCE);
      this.targetDistance = this.distance;
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

  /** Blick weich auf einen Weltpunkt ziehen (Anflug). */
  lookTowards(point: Vec3, dt: number, tau = 0.45): void {
    const dx = point.x - this.worldPosition.x;
    const dy = point.y - this.worldPosition.y;
    const dz = point.z - this.worldPosition.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(d > 0)) return;

    const s = 1 - Math.exp(-dt / tau);
    this.orientation = turnTowards(this.orientation, vec3(dx / d, dy / d, dz / d), s);
    this.updateViewVector();
    this.touchInput.fling.stop();
  }

  /** Für Bildschirm-Buttons auf Geräten ohne Tastatur/Mausrad. */
  zoomStep(direction: 1 | -1): void {
    this.zoomBy(Math.exp(direction * 0.35));
  }

  setWorldPosition(v: Vec3): void {
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) return;
    this.worldPosition.set(v.x, v.y, v.z);
  }

  /** Höhe über dem Ankerkörper — im Freiflug der Maßstab für Near-Plane und Pinch. */
  setFreeAltitude(altitude: number): void {
    this.freeAltitude = Number.isFinite(altitude) ? Math.max(altitude, 1) : 1;
  }

  /** Orthonormale Basis der Blickrichtung für den Navigator. */
  basis(): { forward: Vec3; right: Vec3; up: Vec3 } {
    return basisFromQuat(this.orientation);
  }

  /** Kollision auf Meter-Ebene: schiebt die Kamera bei Bedarf auf die lokale Terrainhöhe. */
  clampToSurface(body: CelestialBody): Vec3 | null {
    const res = clampToSurface(this.worldPosition, body, this.radial);
    return res.normal;
  }

  // -------------------------------------------------------------- Per Frame

  /** Schritt 1: Orientierung. Läuft *vor* der Navigation. */
  updateOrientation(dt: number): void {
    const coast = this.touchInput.fling.coast(dt);
    if (coast) this.orientation = applyTurn(this.orientation, coast);

    if (!isFiniteQuat(this.orientation)) {
      console.warn('[SpaceCamera] Orientierung entartet — auf Weltnorden zurückgesetzt.');
      this.orientation = orientTowards(vec3(1, 0, 0), this.worldUp);
      this.touchInput.fling.stop();
    }

    this.updateViewVector();
    if (this.mode === 'free') {
      applyDolly(this.worldPosition, this.view, this.freeAltitude, this.pendingDolly);
      this.pendingDolly = 1;
    }
  }

  /** Schritt 2: Position und Projektion. Läuft *nach* der Navigation. */
  updatePlacement(dt: number): void {
    this.updateViewVector();
    if (this.mode === 'orbit') {
      const res = placeOrbit(
        this.worldPosition,
        this.target,
        { distance: this.distance, targetDistance: this.targetDistance },
        this.view,
        this.radial,
        dt,
      );
      this.distance = res.distance;
      this.targetDistance = res.targetDistance;
    }

    this.camera.position.set(0, 0, 0);
    this.camera.quaternion.set(
      this.orientation.x, this.orientation.y, this.orientation.z, this.orientation.w,
    );

    const near = computeNearPlane(this.altitude);
    if (Math.abs(near - this.camera.near) / this.camera.near > 0.1) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
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
