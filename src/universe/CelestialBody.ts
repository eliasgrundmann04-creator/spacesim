import * as THREE from 'three/webgpu';
import { Vector3d } from '../math/Vector3d';
import { G } from '../core/constants';
import type { Orbit } from '../physics/Kepler';
import type { FrameNode } from '../frames/types';

export type BodyType = 'star' | 'rocky' | 'gas';

export interface BodyParams {
  name: string;
  type: BodyType;
  mass: number;    // kg
  radius: number;  // m
  seed: number;
}

/**
 * Basisklasse aller Himmelskörper.
 *
 * Präzision durch Konstruktion: Positionen sind *hierarchisch* — jeder Körper
 * kennt nur seine Bahn relativ zum Elternkörper. Die absolute f64-Position
 * wird pro Tick entlang des Baums akkumuliert (Stern → Planet → Mond).
 * Ein Mond hat so mm-Präzision relativ zu seinem Planeten, selbst wenn das
 * System Lichtjahre vom Ursprung entfernt liegt.
 */
let uidCounter = 0;

export abstract class CelestialBody {
  /** Stabile, eindeutige Kennung. Namen können sich zwischen Systemen wiederholen. */
  readonly uid = `b${++uidCounter}`;
  readonly name: string;
  readonly type: BodyType;
  readonly mass: number;
  readonly radius: number;
  readonly seed: number;

  parent: CelestialBody | null = null;
  readonly children: CelestialBody[] = [];
  orbit: Orbit | null = null;
  frame: FrameNode | null = null;

  /** Absolute Weltposition in Metern (f64). Wird von updateHierarchy gesetzt. */
  readonly position = new Vector3d();

  /**
   * Absolute Weltgeschwindigkeit in m pro **Sim**sekunde (f64), entlang desselben
   * Baums akkumuliert wie die Position. Kepler liefert sie analytisch mit — sie ist
   * damit exakt und nicht aus zwei Frames geschätzt. Die Navigation rechnet in
   * Realzeit und multipliziert deshalb mit dem Time-Warp-Faktor.
   */
  readonly velocity = new Vector3d();

  /**
   * Render-Wurzel. Der SceneManager setzt .position jeden Frame
   * kamerarelativ (Floating Origin) — nie absolut befüllen!
   */
  readonly root = new THREE.Group();

  constructor(params: BodyParams) {
    this.name = params.name;
    this.type = params.type;
    this.mass = params.mass;
    this.radius = params.radius;
    this.seed = params.seed;
    this.root.name = params.name;
  }

  get gravParameter(): number {
    return G * this.mass;
  }

  attachTo(parent: CelestialBody, orbit: Orbit): void {
    this.parent = parent;
    this.orbit = orbit;
    parent.children.push(this);
  }

  /** Propagiert Kepler-Zustände rekursiv durch den Systembaum. */
  updateHierarchy(simTime: number): void {
    if (this.orbit && this.parent) {
      this.orbit.getStateAtTime(simTime, _local, _localVel);
      this.position.addVectors(this.parent.position, _local);
      this.velocity.addVectors(this.parent.velocity, _localVel);
    }
    // Wurzelkörper (Sterne) behalten ihre statische galaktische Position und v = 0.
    for (const child of this.children) child.updateHierarchy(simTime);
  }

  /** Erzeugt die Render-Repräsentation (füllt this.root). Einmalig vom SceneManager aufgerufen. */
  abstract buildRenderObject(): void;

  /** Per-Frame-Hook (LOD, Sprites …). cameraPos = absolute Kameraposition (f64). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(dt: number, cameraPos: Vector3d): void {}

  /**
   * Lokale Oberflächenhöhe (m über radius) in Richtung dir (Einheitsvektor,
   * vom Körperzentrum aus). Basis für Kamera-Kollision auf Meter-Ebene.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getSurfaceOffset(dir: THREE.Vector3): number {
    return 0;
  }

  *traverse(): Generator<CelestialBody> {
    yield this;
    for (const c of this.children) yield* c.traverse();
  }
}

// Scratch — beide vollständig verbraucht, bevor die Rekursion sie erneut belegt.
const _local = new Vector3d();
const _localVel = new Vector3d();
