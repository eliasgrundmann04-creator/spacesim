import type { Vec3 } from './vec';
import { add, length, scale, sub, vec3 } from './vec';
import { FEEL } from './feel';

/**
 * Nachlauf (Wurf) einer Zieh-Geste. Kein three.js, kein DOM (§5).
 *
 * **Wurfgeschwindigkeit = Steigung der Ausgleichsgeraden durch den Drehweg der letzten
 * 100 ms** — nicht der letzte Schritt durch den letzten Event-Abstand. Touch-Events kommen
 * gebündelt, ihre Zeitstempel springen zwischen 1 und 16 ms Abstand; ein einzelner Quotient
 * schwankt dann um ein Vielfaches, und auch eine Differenz Anfang/Ende trägt den Jitter
 * beider Enden voll. Lag der Finger vor dem Loslassen still, gibt es keinen Wurf: sonst
 * liefe der Körper nach einer Pause von selbst los.
 *
 * Der Nachlauf klingt mit τ ab, um eine feste Achse, und wird je Frame **exakt
 * integriert** (∫ ω e^(−t/τ) dt über das Frame). Der Gesamtweg ist ω · τ — bei 20 fps
 * derselbe wie bei 120 fps.
 *
 * Zeiten in s, Drehvektoren im Kamerarahmen (wie in `dragKernel.ts`).
 */

/** Zeitkonstante des Nachlaufs in s. */
export const SPIN_TAU = FEEL.spinTau;
/** Obergrenze der Wurfgeschwindigkeit in rad/s. */
export const MAX_SPIN = FEEL.maxSpin;
/** Mittelungsfenster vor dem Loslassen in s. */
export const FLING_WINDOW = 0.1;
/** So lange still vor dem Loslassen ⇒ kein Wurf (s). */
export const FLING_REST = FEEL.flingRest;
/** Kürzeste Messdauer in s — ein einzelnes Event nach 1 ms ist kein Maß. */
const MIN_SPAN = 0.016;
/** Restwinkel in rad, ab dem der Nachlauf auf einmal zu Ende geführt wird. */
const STOP_ANGLE = 1e-6;

interface Step {
  t0: number;
  t1: number;
  v: Vec3;
}

export class Fling {
  private steps: Step[] = [];
  private lastTime = 0;
  private spin: Vec3 = vec3();

  /** Finger gesetzt: der Nachlauf endet, die Messung beginnt neu. */
  press(time: number): void {
    this.spin = vec3();
    this.steps = [];
    this.lastTime = time;
  }

  /** Ein angewandter Zugschritt. */
  record(time: number, v: Vec3): void {
    this.steps.push({ t0: this.lastTime, t1: time, v });
    this.lastTime = time;
    while (this.steps.length > 0 && this.steps[0].t1 < time - FLING_WINDOW) this.steps.shift();
  }

  /** Letzter Finger gelöst: Wurf aus dem gemittelten Fingerweg. */
  release(time: number): void {
    this.spin = this.velocity(time);
    this.steps = [];
  }

  stop(): void {
    this.spin = vec3();
  }

  /** Aktuelle Nachlaufgeschwindigkeit (rad/s, Kamerarahmen). */
  get angularVelocity(): Vec3 {
    return this.spin;
  }

  /** Drehvektor für dieses Frame, oder null, wenn nichts nachläuft. */
  coast(dt: number): Vec3 | null {
    const w = length(this.spin);
    if (!(w > 0) || !(dt > 0)) return null;
    const spinTau = FEEL.spinTau;
    const decay = Math.exp(-dt / spinTau);
    if (w * spinTau * decay < STOP_ANGLE) {
      const rest = scale(this.spin, spinTau); // genau der verbleibende Weg
      this.spin = vec3();
      return rest;
    }
    const turn = scale(this.spin, spinTau * (1 - decay));
    this.spin = scale(this.spin, decay);
    return turn;
  }

  private velocity(time: number): Vec3 {
    if (time - this.lastTime > FEEL.flingRest) return vec3();
    const recent = this.steps.filter((s) => s.t1 >= time - FLING_WINDOW);
    if (recent.length === 0) return vec3();

    // Drehweg über der Zeit, beginnend bei 0 am Anfang des ältesten Schritts
    const times = [recent[0].t0, ...recent.map((s) => s.t1)];
    const path = [vec3()];
    for (const s of recent) path.push(add(path[path.length - 1], s.v));

    const tMean = times.reduce((a, t) => a + t, 0) / times.length;
    const pMean = scale(path.reduce((a, p) => add(a, p), vec3()), 1 / path.length);
    let stt = 0;
    let stp = vec3();
    for (let i = 0; i < times.length; i++) {
      const dt = times[i] - tMean;
      stt += dt * dt;
      stp = add(stp, scale(sub(path[i], pMean), dt));
    }
    // Zu kurz gemessen (z. B. ein einzelnes Event nach 1 ms): Weg durch Mindestdauer
    const span = times[times.length - 1] - times[0];
    const w = span >= MIN_SPAN && stt > 0
      ? scale(stp, 1 / stt)
      : scale(path[path.length - 1], 1 / MIN_SPAN);
    const l = length(w);
    if (!Number.isFinite(l)) return vec3();
    const maxSpin = FEEL.maxSpin;
    return l > maxSpin ? scale(w, maxSpin / l) : w;
  }
}
