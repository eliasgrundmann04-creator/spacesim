import type { Vec3 } from './vec';
import { addScaled, length, relaxFactor, scale, vec3 } from './vec';
import type { BodyRef, NavInput } from './types';
import type { Proximity, ProximityConfig } from './proximity';
import { DEFAULT_PROXIMITY, evaluateProximity } from './proximity';

/**
 * Skalenfreier Flug: v = rate · Referenzhöhe · speedScale.
 *
 * Die Konsequenz ist eine exponentielle Annäherung — dh/dt = −rate·h ⇒ h(t) = h₀·e^(−rate·t).
 * Damit ist die Flugzeit *logarithmisch* im zurückgelegten Abstand: von 1 AE auf 2 m über
 * der Erdoberfläche dauert genauso lange wie von 2 m auf 1 AE, und beides liegt in derselben
 * Größenordnung wie ein Flug zum Nachbarstern. Genau das macht Navigation über 20
 * Größenordnungen ohne Modiwechsel möglich.
 *
 * Nebeneffekt: die Oberfläche wird asymptotisch nie erreicht. Deshalb `minAltitude` als
 * Untergrenze — bei 2 m bleibt eine Restgeschwindigkeit von rate·2 m/s, mit der man landet.
 *
 * **Der Zustand ist die ankerrelative Geschwindigkeit**, nicht die Weltgeschwindigkeit.
 * Bei Time-Warp ×10⁸ rast die Erde mit ~10¹² m/s durch den Weltframe; würde die Assistenz
 * eine *Welt*geschwindigkeit auf null dämpfen, verlöre man den Planeten innerhalb einer
 * Zeitkonstante. Weltgeschwindigkeit = relativ + Rahmen, und der Rahmen wird ohne
 * Übergangszeit übernommen. Das ist die Vorstufe des Frame-Baums aus §3.1.
 */
export interface FlightConfig extends ProximityConfig {
  /** Geschwindigkeit pro Referenzhöhe, in 1/s. */
  rate: number;
  /** Zeitkonstante beim Beschleunigen. */
  accelTau: number;
  /** Zeitkonstante der Flugassistenz beim Ausrollen. */
  dampTau: number;
  /** Harte Obergrenze der Relativgeschwindigkeit in m/s. Infinity = aus (Überlicht ist nötig). */
  maxSpeed: number;
  /**
   * Obergrenze der Relativgeschwindigkeit in **Referenzhöhen pro Sekunde**.
   *
   * Bewusst *pro Sekunde*, nicht pro Frame: bis v0.3 folgte der Deckel implizit aus
   * maxStepFraction · maxSubsteps · Referenzhöhe **pro Frame**, war also 1,5·ref/dt und
   * damit framerateabhängig — bei 60 fps 90·ref/s, bei 30 fps nur 45·ref/s. Auf dem
   * Tablet sättigte die Geschwindigkeit dadurch schon bei etwa ×50, weitere Stufen
   * blieben wirkungslos, und der Deckel wanderte mit dem Frame-Jitter (sichtbares
   * Zittern in Anzeige und Bewegung). Der Wert liegt bewusst über der maximal
   * kommandierbaren Geschwindigkeit (rate · maxScale = 90 · ref/s): er begrenzt nur
   * von außen gesetzte Zustände (Ankerwechsel, Kollisionsantwort), nie den Regler.
   */
  maxReferenceRate: number;
  /**
   * Auflösungsgrenze: kein Substep soll den Abstand zum Anker um mehr als diesen
   * Anteil der Referenzhöhe ändern. Reine Genauigkeitsgröße — sie begrenzt die
   * Schrittweite, nicht mehr die Geschwindigkeit.
   */
  maxStepFraction: number;
  maxSubsteps: number;
}

export const DEFAULT_FLIGHT: FlightConfig = {
  ...DEFAULT_PROXIMITY,
  rate: 0.9,
  accelTau: 0.28,
  dampTau: 0.9,
  maxSpeed: Infinity,
  maxReferenceRate: 150,
  maxStepFraction: 0.025,
  maxSubsteps: 60,
};

export interface FlightStep {
  position: Vec3;
  /** Neue ankerrelative Geschwindigkeit — der eigentliche Zustand. */
  relVelocity: Vec3;
  /** relVelocity + frameVelocity, für HUD und Anschlussrechnungen. */
  worldVelocity: Vec3;
  proximity: Proximity;
  speed: number;
  relativeSpeed: number;
  /** rate · reference · speedScale, also die Relativgeschwindigkeit bei Vollschub. */
  referenceSpeed: number;
  substeps: number;
}

/**
 * Ein Navigationsschritt über die **Realzeit** dt.
 * `frameVelocity` ist die Geschwindigkeit des Bezugskörpers in m pro Realsekunde,
 * also Bahngeschwindigkeit × Time-Warp-Faktor.
 */
export function stepFlight(
  position: Vec3,
  relVelocity: Vec3,
  basis: { forward: Vec3; right: Vec3; up: Vec3 },
  input: NavInput,
  bodies: readonly BodyRef[],
  frameVelocity: Vec3,
  dt: number,
  cfg: FlightConfig = DEFAULT_FLIGHT,
): FlightStep {
  // Kommandorichtung im Kamerarahmen, Betrag auf 1 begrenzt
  // (Diagonalen sollen nicht schneller sein als eine einzelne Achse).
  let cx = basis.forward.x * input.forward + basis.right.x * input.right + basis.up.x * input.up;
  let cy = basis.forward.y * input.forward + basis.right.y * input.right + basis.up.y * input.up;
  let cz = basis.forward.z * input.forward + basis.right.z * input.right + basis.up.z * input.up;
  const cmd = Math.sqrt(cx * cx + cy * cy + cz * cz);
  if (cmd > 1) {
    cx /= cmd;
    cy /= cmd;
    cz /= cmd;
  }
  const thrusting = cmd > 1e-6;

  let p = position;
  let v = relVelocity;
  let remaining = Math.max(dt, 0);
  let referenceSpeed = 0;
  let steps = 0;

  // Kleinste zulässige Substep-Länge. Da jeder Schritt mindestens minSlice lang ist,
  // terminiert die Schleife nach höchstens maxSubsteps Durchläufen — und zwar immer
  // mit remaining ≈ 0, also mit vollständig integriertem dt. Bei sehr hohem Tempo
  // wird dafür das Wegbudget je Substep überschritten: das kostet Genauigkeit in der
  // Annäherungskurve, aber es verkürzt nicht mehr die Strecke. Genau diese frühere
  // Kopplung machte die Fluggeschwindigkeit von der Framerate abhängig.
  const minSlice = remaining / cfg.maxSubsteps;
  let prox = evaluateProximity(p, bodies, cfg);

  while (remaining > 1e-12 && steps < cfg.maxSubsteps) {
    prox = evaluateProximity(p, bodies, cfg);

    // Wegbudget pro Substep (Auflösung) und Geschwindigkeitsdeckel (Physik) sind
    // ab v0.4 getrennt: der Deckel hängt an der Referenzhöhe, das Budget an der
    // Schrittweite. Vorher war beides dasselbe — und damit framerateabhängig.
    const budget = cfg.maxStepFraction * prox.reference;
    const speedCap = cfg.maxReferenceRate * prox.reference;

    referenceSpeed = Math.min(
      cfg.rate * prox.reference * Math.max(input.speedScale, 0),
      speedCap,
    );

    // v kann den Deckel von außen verletzen (Ankerwechsel, gesetzter Zustand).
    const vLen = length(v);
    if (vLen > speedCap) v = scale(v, speedCap / vLen);

    let target: Vec3;
    let tau: number;
    if (thrusting) {
      target = { x: cx * referenceSpeed, y: cy * referenceSpeed, z: cz * referenceSpeed };
      tau = cfg.accelTau;
    } else if (input.assist) {
      target = vec3();
      tau = cfg.dampTau;
    } else {
      target = v;
      tau = cfg.accelTau;
    }

    // Maßgeblich ist die *relative* Geschwindigkeit: die Rahmenbewegung verändert den
    // Abstand zum Anker nicht. Der begrenzte Substep hält außerdem den Fehler der
    // Operatoraufspaltung klein — daraus folgt die Framerate-Unabhängigkeit.
    const vMax = Math.max(length(v), length(target));
    let h = vMax > 0 ? Math.min(remaining, budget / vMax) : remaining;
    if (h < minSlice) h = Math.min(remaining, minSlice);

    const a = relaxFactor(h, tau);
    v = {
      x: v.x + (target.x - v.x) * a,
      y: v.y + (target.y - v.y) * a,
      z: v.z + (target.z - v.z) * a,
    };

    if (cfg.maxSpeed < Infinity) {
      const sp = length(v);
      if (sp > cfg.maxSpeed) v = scale(v, cfg.maxSpeed / sp);
    }

    p = addScaled(p, { x: v.x + frameVelocity.x, y: v.y + frameVelocity.y, z: v.z + frameVelocity.z }, h);
    remaining -= h;
    steps++;
  }

  prox = evaluateProximity(p, bodies, cfg);
  const world = { x: v.x + frameVelocity.x, y: v.y + frameVelocity.y, z: v.z + frameVelocity.z };

  return {
    position: p,
    relVelocity: v,
    worldVelocity: world,
    proximity: prox,
    speed: length(world),
    relativeSpeed: length(v),
    referenceSpeed,
    substeps: steps,
  };
}
