import type { Vec3 } from './vec';
import { clamp, distance } from './vec';
import type { BodyRef } from './types';

/**
 * Die Referenzhöhe ist die einzige Größe, aus der sich die Fluggeschwindigkeit ableitet.
 * Ein hartes Minimum über alle Körper wäre unstetig: sobald beim Vorbeiflug ein anderer
 * Körper der nächste wird, springt die Geschwindigkeit. Deshalb ein weiches Minimum —
 * und zwar im **Logarithmus** der Höhe, weil die Höhen über 20 Größenordnungen streuen
 * und ein Softmin im Linearraum dort wirkungslos wäre (§4.7).
 *
 * Verwendet wird der gewichtete Boltzmann-Mittelwert
 *     u = Σ wᵢuᵢ / Σ wᵢ ,  wᵢ = exp(−(uᵢ − u_min)/s)
 * statt der log-sum-exp-Variante: Letztere zieht das Ergebnis mit jedem zusätzlichen
 * gleich weit entfernten Körper weiter nach unten (100 Sterne in gleicher Distanz ⇒ 5×
 * langsamer). Der gewichtete Mittelwert liefert bei identischen Werten exakt den Wert.
 */
export interface ProximityConfig {
  /** Untergrenze der Höhe in m. Verhindert v → 0 an der Oberfläche (Zeno). */
  minAltitude: number;
  /** Obergrenze der Höhe in m. Deckelt die Geschwindigkeit im intergalaktischen Leerraum. */
  maxAltitude: number;
  /** Breite der Weichmischung in ln-Einheiten. 0.35 ⇒ ein Körper 1 e-Faltung weiter zählt ~6 %. */
  softness: number;
  /** Referenzhöhe, wenn überhaupt kein Körper bekannt ist. */
  fallbackAltitude: number;
}

export const DEFAULT_PROXIMITY: ProximityConfig = {
  minAltitude: 2,
  maxAltitude: 1e18,
  softness: 0.35,
  fallbackAltitude: 1e14,
};

export interface Proximity {
  /** Der tatsächlich nächste Körper (hartes Minimum) — für HUD, Kollision und Bezugsrahmen. */
  anchor: BodyRef | null;
  /** Höhe über der Oberfläche des Ankers in m. Kann negativ sein (Kamera innerhalb). */
  altitude: number;
  /** Weich gemischte Höhe in m, geklemmt. Basis des Geschwindigkeitsmodells. */
  reference: number;
}

export function evaluateProximity(
  position: Vec3,
  bodies: readonly BodyRef[],
  cfg: ProximityConfig,
): Proximity {
  const n = bodies.length;
  if (n === 0) {
    return { anchor: null, altitude: cfg.fallbackAltitude, reference: cfg.fallbackAltitude };
  }

  let anchor: BodyRef | null = null;
  let rawMin = Infinity;
  let uMin = Infinity;
  const u: number[] = [];

  for (let i = 0; i < n; i++) {
    const b = bodies[i];
    const raw = distance(position, b.position) - b.radius;
    // Ein einziger nicht-endlicher Abstand würde uMin, alle Gewichte und damit die
    // Referenzhöhe auf NaN ziehen — und über die Fluggeschwindigkeit die Kamera-
    // position gleich mit. Solche Körper werden übersprungen, nicht durchgereicht.
    if (!Number.isFinite(raw)) continue;
    if (raw < rawMin) {
      rawMin = raw;
      anchor = b;
    }
    const ui = Math.log(Math.max(raw, cfg.minAltitude));
    u.push(ui);
    if (ui < uMin) uMin = ui;
  }

  if (u.length === 0) {
    return { anchor: null, altitude: cfg.fallbackAltitude, reference: cfg.fallbackAltitude };
  }

  // Gewichteter Mittelwert im Log-Raum. Der Shift um uMin hält die Exponenten in [−∞, 0],
  // das größte Gewicht ist damit immer exakt 1 — kein Überlauf, keine Unterlaufsumme 0.
  let wSum = 0;
  let uSum = 0;
  for (let i = 0; i < u.length; i++) {
    const w = Math.exp(-(u[i] - uMin) / cfg.softness);
    wSum += w;
    uSum += w * u[i];
  }
  const uSoft = wSum > 0 ? uSum / wSum : uMin;

  return {
    anchor,
    altitude: rawMin,
    reference: clamp(Math.exp(uSoft), cfg.minAltitude, cfg.maxAltitude),
  };
}
