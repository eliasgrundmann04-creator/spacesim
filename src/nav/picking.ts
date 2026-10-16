import type { Vec3 } from './vec';
import { clamp, dot, length, normalize, sub } from './vec';
import type { BodyRef } from './types';

/**
 * Zielauswahl per Strahl — im **Winkelraum**, nicht im Bildschirmraum.
 *
 * Grund: ein Körper kann 10⁻⁹ px oder den halben Bildschirm groß sein. Ein fester
 * Pixelradius trifft entweder nichts oder alles. Bewertet wird stattdessen der
 * Fehlwinkel zum Scheibenrand: miss = max(0, θ − ρ) mit ρ = asin(R/d).
 *
 * Rangfolge: Treffer innerhalb der Scheibe (miss = 0) gewinnen, davon der nächste
 * entlang des Strahls — sonst würde ein ferner Stern durch einen Planeten hindurch
 * ausgewählt. Ohne echten Treffer entscheidet der kleinste Fehlwinkel.
 */
export interface PickResult {
  body: BodyRef;
  /** Fehlwinkel in rad, 0 wenn der Strahl die Scheibe trifft. */
  miss: number;
  /** Scheinbarer Radius in rad. */
  angularRadius: number;
  /** Abstand zum Mittelpunkt in m. */
  distance: number;
}

export function pickBody(
  cameraPos: Vec3,
  rayDir: Vec3,
  bodies: readonly BodyRef[],
  toleranceRad: number,
): PickResult | null {
  let best: PickResult | null = null;

  for (const b of bodies) {
    const w = sub(b.position, cameraPos);
    const d = length(w);
    if (d <= 0) continue;

    const cosTheta = clamp(dot(w, rayDir) / d, -1, 1);
    if (cosTheta <= 0) continue; // hinter der Kamera

    const theta = Math.acos(cosTheta);
    const rho = Math.asin(clamp(b.radius / d, 0, 1));
    const miss = Math.max(0, theta - rho);
    if (miss > toleranceRad) continue;

    const cand: PickResult = { body: b, miss, angularRadius: rho, distance: d };
    if (best === null || better(cand, best)) best = cand;
  }

  return best;
}

function better(a: PickResult, b: PickResult): boolean {
  const aHit = a.miss <= 0;
  const bHit = b.miss <= 0;
  if (aHit !== bHit) return aHit;
  if (aHit && bHit) return a.distance < b.distance; // beide getroffen ⇒ der vordere
  return a.miss < b.miss;
}

/**
 * Tipp-Toleranz aus der Fingergröße: ein Finger deckt grob 44 CSS-px ab.
 * `fovY` in rad, `viewportHeight` in CSS-px.
 */
export function tapTolerance(fovY: number, viewportHeight: number, radiusPx = 44): number {
  if (viewportHeight <= 0) return 0.05;
  return (fovY * radiusPx) / viewportHeight;
}

/**
 * Weltrichtung eines Bildschirmpunkts (CSS-px, Ursprung links oben) aus der Kamerabasis.
 * Bewusst hier statt in three: damit ist die Kette Doppeltipp → Strahl → Ziel vollständig
 * offline testbar, und die Renderseite muss nichts beisteuern außer FOV und Größe.
 */
export function screenRay(
  x: number,
  y: number,
  width: number,
  height: number,
  fovY: number,
  basis: { forward: Vec3; right: Vec3; up: Vec3 },
): Vec3 {
  const half = Math.tan(fovY / 2);
  const aspect = height > 0 ? width / height : 1;
  const sx = (2 * (x / Math.max(width, 1)) - 1) * half * aspect;
  const sy = (1 - 2 * (y / Math.max(height, 1))) * half;
  return normalize({
    x: basis.forward.x + basis.right.x * sx + basis.up.x * sy,
    y: basis.forward.y + basis.right.y * sx + basis.up.y * sy,
    z: basis.forward.z + basis.right.z * sx + basis.up.z * sy,
  });
}
