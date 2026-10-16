import { G } from '../core/constants';
import { Vector3d } from '../math/Vector3d';

/**
 * Keplersche Orbitalmechanik — analytische Propagation.
 *
 * Bewusste Design-Entscheidung: KEIN numerischer Integrator. Kepler-Bahnen
 * sind geschlossen lösbar; Position(t) ist eine reine Funktion der Zeit.
 * Damit ist beliebiger Time-Warp (×1 … ×10^8) drift- und explosionsfrei —
 * die Voraussetzung für eine Simulation über astronomische Zeiträume.
 * (Volle N-Körper-Störungen / patched conics sind ein späterer, additiver Layer.)
 *
 * Referenzrahmen: Ekliptik J2000, Z-up. Winkel in rad, Längen in m, Zeit in s ab J2000.
 */
export interface OrbitalElements {
  a: number;      // große Halbachse (m)
  e: number;      // Exzentrizität [0, 1)
  i: number;      // Inklination (rad)
  Omega: number;  // Länge des aufsteigenden Knotens Ω (rad)
  omega: number;  // Argument der Periapsis ω (rad)
  M0: number;     // mittlere Anomalie zur Epoche (rad)
  epoch: number;  // Epoche (s ab J2000)
}

const TWO_PI = Math.PI * 2;

/** Löst die Kepler-Gleichung M = E − e·sin E per Newton-Raphson. */
export function solveKepler(M: number, e: number): number {
  // M in [-π, π] normalisieren — stabilere Konvergenz
  M = M % TWO_PI;
  if (M > Math.PI) M -= TWO_PI;
  else if (M < -Math.PI) M += TWO_PI;

  let E = e < 0.8 ? M + e * Math.sin(M) : Math.PI * Math.sign(M || 1);
  for (let iter = 0; iter < 30; iter++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    const dE = f / fp;
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

export class Orbit {
  readonly mu: number;   // Gravitationsparameter des Zentralkörpers (m³/s²)
  readonly n: number;    // mittlere Bewegung (rad/s)

  // Perifokal-Basisvektoren P̂ (Richtung Periapsis) und Q̂ (90° voraus),
  // vorberechnet aus Ω, i, ω — spart pro Frame drei Rotationen.
  private px: number; private py: number; private pz: number;
  private qx: number; private qy: number; private qz: number;

  readonly el: OrbitalElements;

  // Explizites Feld statt Parameter-Property — siehe Vector3d.
  constructor(el: OrbitalElements, parentMass: number) {
    this.el = el;
    this.mu = G * parentMass;
    this.n = Math.sqrt(this.mu / (el.a * el.a * el.a));

    const cO = Math.cos(el.Omega), sO = Math.sin(el.Omega);
    const ci = Math.cos(el.i), si = Math.sin(el.i);
    const co = Math.cos(el.omega), so = Math.sin(el.omega);

    this.px = cO * co - sO * so * ci;
    this.py = sO * co + cO * so * ci;
    this.pz = so * si;
    this.qx = -cO * so - sO * co * ci;
    this.qy = -sO * so + cO * co * ci;
    this.qz = co * si;
  }

  /** Umlaufzeit (s). */
  get period(): number {
    return TWO_PI / this.n;
  }

  /**
   * Zustand zur Zeit t (s ab J2000). Position relativ zum Zentralkörper,
   * geschrieben nach outPos (f64). Optional Geschwindigkeit nach outVel.
   */
  getStateAtTime(t: number, outPos: Vector3d, outVel?: Vector3d): void {
    const { a, e } = this.el;
    const M = this.el.M0 + this.n * (t - this.el.epoch);
    const E = solveKepler(M, e);

    const cosE = Math.cos(E), sinE = Math.sin(E);
    const b = a * Math.sqrt(1 - e * e);
    const xp = a * (cosE - e);   // Perifokal-Koordinaten
    const yp = b * sinE;

    outPos.set(
      this.px * xp + this.qx * yp,
      this.py * xp + this.qy * yp,
      this.pz * xp + this.qz * yp,
    );

    if (outVel) {
      const r = a * (1 - e * cosE);
      const k = Math.sqrt(this.mu * a) / r;
      const vxp = -k * sinE;
      const vyp = k * Math.sqrt(1 - e * e) * cosE;
      outVel.set(
        this.px * vxp + this.qx * vyp,
        this.py * vxp + this.qy * vyp,
        this.pz * vxp + this.qz * vyp,
      );
    }
  }
}
