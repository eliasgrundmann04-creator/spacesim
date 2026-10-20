import * as THREE from 'three/webgpu';
import { Vector3d } from '../math/Vector3d';
import type { CelestialBody } from '../universe/CelestialBody';
import type { FrameNode } from '../frames/types';
import { transformPoint } from '../frames/FrameTree';

/**
 * SceneManager: Brücke zwischen der f64-Simulationswelt und der f32-GPU-Welt.
 *
 * Vertrag:
 *  - Jeder CelestialBody hat genau eine Render-Wurzel (body.root) in der Szene.
 *  - Absolute Positionen (f64, Meter) leben ausschließlich in body.position.
 *  - syncToCamera() setzt pro Frame body.root.position auf die Differenz
 *    (body.position − cameraWorldPos). Die Subtraktion erfolgt in f64,
 *    erst das Ergebnis wird f32 — nahe der Kamera also voll präzise.
 *
 * Warum das bis auf Lichtjahre trägt: f32 hat ~7 signifikante Stellen
 * *relativ*. Ein Stern in 4 Lj (Koordinate ~4e16 m) landet mit relativem
 * Fehler ~1e-7 auf der GPU ⇒ Winkelfehler ~1e-7 rad, weit unter einem Pixel.
 * Nahe Objekte haben kleine Koordinaten und damit Zentimeter-Präzision.
 * Der Log-Depth-Buffer löst orthogonal dazu das Z-Fighting über die
 * Tiefenspanne 0.2 m … 1e19 m.
 */
export class SceneManager {
  readonly scene = new THREE.Scene();

  private readonly bodies: CelestialBody[] = [];

  constructor() {
    this.scene.background = new THREE.Color(0x000000);
    // Minimales Restlicht, damit Nachtseiten nicht absolut schwarz sind
    this.scene.add(new THREE.AmbientLight(0x8899bb, 0.25));
  }

  /** Registriert einen Körper: baut sein Render-Objekt und hängt es in die Szene. */
  addBody(body: CelestialBody): void {
    body.buildRenderObject();
    this.scene.add(body.root);
    this.bodies.push(body);
  }

  /** Registriert einen kompletten Systembaum (Stern + alle Kinder). */
  addSystem(root: CelestialBody): void {
    for (const body of root.traverse()) this.addBody(body);
  }

  removeBody(body: CelestialBody): void {
    const i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
    this.scene.remove(body.root);
  }

  get allBodies(): readonly CelestialBody[] {
    return this.bodies;
  }

  /**
   * Floating-Origin-Sync: platziert alle Render-Wurzeln relativ zur Kamera
   * und ruft die Per-Frame-Hooks der Körper auf (LOD, Sprites …).
   */
  syncToCamera(cameraWorldPos: Vector3d, dt: number, cameraFrame?: FrameNode | null): void {
    for (const body of this.bodies) {
      let relX = body.position.x - cameraWorldPos.x;
      let relY = body.position.y - cameraWorldPos.y;
      let relZ = body.position.z - cameraWorldPos.z;

      if (cameraFrame && body.frame && cameraFrame !== body.frame) {
        const bodyInCamFrame = transformPoint(
          { x: body.position.x, y: body.position.y, z: body.position.z },
          body.frame,
          cameraFrame,
        );
        relX = bodyInCamFrame.x - cameraWorldPos.x;
        relY = bodyInCamFrame.y - cameraWorldPos.y;
        relZ = bodyInCamFrame.z - cameraWorldPos.z;
      }

      body.root.position.set(relX, relY, relZ);
      body.update(dt, cameraWorldPos);
    }
  }
}
