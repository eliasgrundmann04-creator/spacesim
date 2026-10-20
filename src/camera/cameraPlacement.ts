import * as THREE from 'three/webgpu';
import type { Vector3d } from '../math/Vector3d';
import type { CelestialBody } from '../universe/CelestialBody';

export interface OrbitPlacementState {
  distance: number;
  targetDistance: number;
}

export function clampToSurface(
  worldPosition: Vector3d,
  body: CelestialBody,
  radialScratch: THREE.Vector3,
): { normal: { x: number; y: number; z: number } | null } {
  const dx = worldPosition.x - body.position.x;
  const dy = worldPosition.y - body.position.y;
  const dz = worldPosition.z - body.position.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(d > 0)) return { normal: null };

  radialScratch.set(dx / d, dy / d, dz / d);
  const minD = body.radius + body.getSurfaceOffset(radialScratch) + 2;
  if (d >= minD) return { normal: null };

  worldPosition.set(
    body.position.x + radialScratch.x * minD,
    body.position.y + radialScratch.y * minD,
    body.position.z + radialScratch.z * minD,
  );
  return { normal: { x: radialScratch.x, y: radialScratch.y, z: radialScratch.z } };
}

export function placeOrbit(
  worldPosition: Vector3d,
  target: CelestialBody | null,
  state: OrbitPlacementState,
  viewVector: THREE.Vector3,
  radialScratch: THREE.Vector3,
  dt: number,
): OrbitPlacementState {
  if (!target) return state;

  let { distance, targetDistance } = state;

  // Zoom im Log-Raum glätten (gleichmäßig über alle Größenordnungen)
  const s = 1 - Math.exp(-dt * 8);
  distance = Math.exp(
    THREE.MathUtils.lerp(Math.log(distance), Math.log(targetDistance), s),
  );

  // Radialrichtung ist die Gegenrichtung des Blicks ⇒ Bodenhöhe dort sampeln
  radialScratch.copy(viewVector).multiplyScalar(-1);
  const minD = target.radius + target.getSurfaceOffset(radialScratch) + 2;
  if (targetDistance < minD) targetDistance = minD;
  if (distance < minD) distance = minD;

  worldPosition.set(
    target.position.x + radialScratch.x * distance,
    target.position.y + radialScratch.y * distance,
    target.position.z + radialScratch.z * distance,
  );

  return { distance, targetDistance };
}

export function applyDolly(
  worldPosition: Vector3d,
  viewVector: THREE.Vector3,
  freeAltitude: number,
  pendingDolly: number,
): void {
  if (pendingDolly === 1) return;
  // Pinch/Rad im Freiflug: Translation entlang der Blickachse, skaliert mit der
  // Ankerhöhe — damit fühlt sich die Geste in 2 m und in 2 AE identisch an.
  const step = THREE.MathUtils.clamp(
    freeAltitude * (1 - pendingDolly),
    -4 * freeAltitude,
    0.9 * freeAltitude,
  );
  worldPosition.set(
    worldPosition.x + viewVector.x * step,
    worldPosition.y + viewVector.y * step,
    worldPosition.z + viewVector.z * step,
  );
}

export function computeNearPlane(altitude: number): number {
  return THREE.MathUtils.clamp(Math.max(altitude, 1) * 1e-3, 0.2, 1e6);
}
