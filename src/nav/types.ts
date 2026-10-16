import type { Vec3 } from './vec';

/**
 * Minimalsicht auf einen Himmelskörper, wie die Navigation sie braucht.
 * Bewusst entkoppelt von `CelestialBody`: der Adapter in `Engine.ts` baut die Liste pro Frame.
 * Damit gilt §4.4 weiter — Katalog- und prozedurale Körper sind hier ununterscheidbar.
 */
export interface BodyRef {
  id: string;
  name?: string;
  /** Weltposition in m, bereits auf die aktuelle Simzeit propagiert. */
  position: Vec3;
  /** Mittlerer Oberflächenradius in m (ohne Atmosphäre). */
  radius: number;
  /**
   * Weltgeschwindigkeit in m pro **Realsekunde**, also Bahngeschwindigkeit × Time-Warp-Faktor.
   * Optional — fehlt sie, schätzt der Navigator sie aus aufeinanderfolgenden Frames.
   * Achtung: Kepler liefert m pro *Simsekunde*; vor der Übergabe mit dem Warp multiplizieren.
   */
  velocity?: Vec3;
}

/** Steuerkommando eines Frames. Alle Achsen −1…+1, im Kamerarahmen. */
export interface NavInput {
  /** Schub entlang der Blickrichtung. */
  forward: number;
  /** Seitwärts (positiv = rechts). */
  right: number;
  /** Hoch/runter entlang der Kamera-Oben-Achse. */
  up: number;
  /** Log-gestufter Multiplikator auf die Referenzgeschwindigkeit. */
  speedScale: number;
  /** Flugassistenz: dämpft die Relativgeschwindigkeit zum Ankerkörper auf 0. */
  assist: boolean;
  /** Einmaliger Vollstopp relativ zum Ankerkörper. */
  brake?: boolean;
}

export function neutralInput(): NavInput {
  return { forward: 0, right: 0, up: 0, speedScale: 1, assist: true, brake: false };
}

/**
 * Schwelle, ab der ein Kommando als "Schub" gilt — für alle Konsumenten dieselbe.
 *
 * Vorher stand hier 0.02, verglichen wurde aber gegen den *kubisch* gekrümmten
 * Reglerwert: 0.02 = raw³ entspricht 27 % Reglerweg. Ein Viertel des Schubwegs
 * blieb dadurch wirkungslos — im Orbitmodus startete der Freiflug nicht, und ein
 * laufender Anflug ließ sich nicht abbrechen. Der Regler hat jetzt eine kleine
 * Totzone und der Vergleich diese Konstante; zusammen greift der Schub ab etwa
 * 8 % Reglerweg, ohne auf Zittern anzusprechen.
 */
export const THRUST_EPSILON = 1e-4;

/** Totzone des Schubreglers in Reglerweg — gegen Zittern beim Auflegen des Fingers. */
export const THROTTLE_DEAD_ZONE = 0.04;

/**
 * Reglerweg (−1…+1) → Schubkommando. Erst Totzone, dann kubische Kennlinie:
 * feine Kontrolle um die Mitte, volle Leistung am Anschlag. Die Totzone wird
 * herausgerechnet statt abgeschnitten, damit die Kurve stetig bleibt und der
 * Anschlag exakt ±1 ergibt. Als reine Funktion hier statt in der UI, damit die
 * Kennlinie zusammen mit THRUST_EPSILON offline prüfbar ist (§8).
 */
export function throttleToForward(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  const a = Math.min(Math.abs(raw), 1);
  if (a <= THROTTLE_DEAD_ZONE) return 0;
  const t = (a - THROTTLE_DEAD_ZONE) / (1 - THROTTLE_DEAD_ZONE);
  return Math.sign(raw) * t * t * t;
}

/** Orthonormale Kamerabasis + Weltposition, wie sie `SpaceCamera` pro Frame liefert. */
export interface NavFrame {
  position: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}
