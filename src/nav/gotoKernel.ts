import type { Vec3 } from './vec';
import { addScaled, clamp, dot, length, normalize, orthogonal, scale, slerpDir, slerpDirDerivative, sub } from './vec';
import type { BodyRef } from './types';

/**
 * „Goto" als Flug statt als Sprung.
 *
 * Zwei Entscheidungen tragen das Ganze:
 *
 * 1. **Interpolation im Log-Raum.** ln d(τ) = lerp(ln d₀, ln d₁, s(τ)) bedeutet konstante
 *    *relative* Annäherung — dieselbe Größe, die auch das freie Flugmodell erzeugt. Lineare
 *    Interpolation würde 99 % der Zeit im leeren Raum stehen und die letzten Meter in einem
 *    Frame verschlucken.
 *
 * 2. **Der Pfad ist relativ zum Ziel definiert, nicht absolut.** `sampleGoto` bekommt jedes
 *    Frame die *aktuelle* Zielposition. Bei Time-Warp ×10⁸ legt der Mond während eines
 *    4-s-Anflugs mehrere Bahnumläufe zurück; ein vorberechneter Weltpfad würde ins Leere führen.
 *    Nebeneffekt: am Ende (s' → 0) bewegt sich die Kamera exakt mit dem Ziel mit, die per
 *    Differenz geschätzte Übergabegeschwindigkeit ist also automatisch die Bahngeschwindigkeit.
 */
export interface GotoConfig {
  /** Zielabstand vom Mittelpunkt = frameFactor · Radius. 3.2 füllt bei ~50° FOV das Bild gut. */
  frameFactor: number;
  /** Mindestabstand über der Oberfläche in m — greift bei sehr kleinen Körpern. */
  minClearance: number;
  baseSeconds: number;
  /** Zusatzdauer je e-Faltung Abstandsänderung. */
  secondsPerEfold: number;
  /** Zusatzdauer für eine volle 180°-Richtungsänderung. */
  turnSeconds: number;
  minDuration: number;
  maxDuration: number;
}

export const DEFAULT_GOTO: GotoConfig = {
  frameFactor: 3.2,
  minClearance: 1000,
  baseSeconds: 1.1,
  secondsPerEfold: 0.55,
  turnSeconds: 1.2,
  minDuration: 1.6,
  maxDuration: 8,
};

export interface GotoPlan {
  targetId: string;
  /** Startabstand zum Zielmittelpunkt in m. */
  d0: number;
  /** Endabstand zum Zielmittelpunkt in m. */
  d1: number;
  /** Radiale Startrichtung (vom Ziel zur Kamera), Einheitsvektor. */
  u0: Vec3;
  /** Radiale Endrichtung, Einheitsvektor. */
  u1: Vec3;
  duration: number;
  elapsed: number;
}

/** C²-stetiges Easing. Erste *und* zweite Ableitung verschwinden an beiden Enden — */
/** deshalb smootherstep statt smoothstep: kein sichtbarer Ruck bei der Übergabe. */
export function smootherstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

export function planGoto(
  cameraPos: Vec3,
  target: BodyRef,
  cfg: GotoConfig = DEFAULT_GOTO,
  preferredDir?: Vec3,
): GotoPlan {
  const rel = sub(cameraPos, target.position);
  const rawD0 = length(rel);

  const d1 = Math.max(target.radius * cfg.frameFactor, target.radius + cfg.minClearance, 1);
  // Schutz gegen ln(0), falls die Kamera exakt im Mittelpunkt sitzt.
  const d0 = Math.max(rawD0, d1 * 1e-3, 1);
  const u0 = rawD0 > 0 ? scale(rel, 1 / rawD0) : orthogonal({ x: 0, y: 0, z: 1 });
  const u1 = preferredDir ? normalize(preferredDir, u0) : u0;

  const efolds = Math.abs(Math.log(d1 / d0));
  const angle = Math.acos(clamp(dot(u0, u1), -1, 1));
  const duration = clamp(
    cfg.baseSeconds + cfg.secondsPerEfold * efolds + cfg.turnSeconds * (angle / Math.PI),
    cfg.minDuration,
    cfg.maxDuration,
  );

  return { targetId: target.id, d0, d1, u0, u1, duration, elapsed: 0 };
}

export function gotoProgress(plan: GotoPlan): number {
  return plan.duration > 0 ? clamp(plan.elapsed / plan.duration, 0, 1) : 1;
}

/** Kameraposition zum aktuellen Fortschritt, relativ zur *jetzigen* Zielposition. */
export function sampleGoto(plan: GotoPlan, targetPosition: Vec3): Vec3 {
  const s = smootherstep(gotoProgress(plan));
  const lnD = Math.log(plan.d0) + (Math.log(plan.d1) - Math.log(plan.d0)) * s;
  const dir = slerpDir(plan.u0, plan.u1, s);
  return addScaled(targetPosition, dir, Math.exp(lnD));
}

/** Ableitung von `smootherstep`: 30τ²(τ−1)². Verschwindet an beiden Rändern. */
export function smootherstepDerivative(t: number): number {
  const x = clamp(t, 0, 1);
  return 30 * x * x * (x - 1) * (x - 1);
}

/**
 * Geschwindigkeit der Kamera **relativ zum Ziel**, analytisch statt per Differenz.
 * Bei τ = 1 ist ṡ exakt 0, das Ergebnis also exakt der Nullvektor — die Übergabe an den
 * freien Flug ist damit ruckfrei ohne Restschließgeschwindigkeit.
 */
export function sampleGotoVelocity(plan: GotoPlan): Vec3 {
  if (!(plan.duration > 0)) return { x: 0, y: 0, z: 0 };
  const tau = gotoProgress(plan);
  const s = smootherstep(tau);
  const sDot = smootherstepDerivative(tau) / plan.duration;
  if (sDot === 0) return { x: 0, y: 0, z: 0 };

  const lnRatio = Math.log(plan.d1) - Math.log(plan.d0);
  const d = Math.exp(Math.log(plan.d0) + lnRatio * s);
  const dDot = d * lnRatio * sDot;

  const dir = slerpDir(plan.u0, plan.u1, s);
  const dirDot = scale(slerpDirDerivative(plan.u0, plan.u1, s), sDot);

  return {
    x: dir.x * dDot + dirDot.x * d,
    y: dir.y * dDot + dirDot.y * d,
    z: dir.z * dDot + dirDot.z * d,
  };
}

export function advanceGoto(plan: GotoPlan, dt: number): void {
  plan.elapsed = Math.min(plan.elapsed + Math.max(dt, 0), plan.duration);
}

export function gotoFinished(plan: GotoPlan): boolean {
  return plan.elapsed >= plan.duration;
}
