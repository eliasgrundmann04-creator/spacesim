import type { Vec3 } from './vec';
import { distance, dot, length, normalize, vec3 } from './vec';
import type { BodyRef } from './types';

export interface AutoPaceState {
  stageSet: number;
  mark: number;
  lastWritten: number;
}

export function createAutoPaceState(initialSpeedScale = 1, initialReference = 1e8): AutoPaceState {
  return {
    stageSet: initialSpeedScale,
    mark: initialReference,
    lastWritten: initialSpeedScale,
  };
}

/**
 * Berechnet den Deckel der Kontaktzeit-Begrenzung V_cap für eine kommandierte Richtung.
 * V_cap = min_i (h_i / (ttcMin · k_i)) für alle Körper mit h_i > 0 und k_i > 0.
 */
export function contactCap(
  position: Vec3,
  dir: Vec3,
  bodies: readonly BodyRef[],
  ttcMin: number,
): number {
  if (ttcMin <= 0 || bodies.length === 0) return Infinity;

  const dirLen = length(dir);
  if (dirLen < 1e-6) return Infinity;

  const c = scaleDir(dir, 1 / dirLen);
  let vCap = Infinity;

  for (const body of bodies) {
    const toBodyVec = {
      x: body.position.x - position.x,
      y: body.position.y - position.y,
      z: body.position.z - position.z,
    };
    const dist = length(toBodyVec);
    const h = dist - body.radius;
    if (h <= 0 || dist < 1e-12) continue;

    const toBodyUnit = {
      x: toBodyVec.x / dist,
      y: toBodyVec.y / dist,
      z: toBodyVec.z / dist,
    };

    const k = Math.max(0, dot(c, toBodyUnit));
    if (k > 1e-12) {
      const cap = h / (ttcMin * k);
      if (cap < vCap) vCap = cap;
    }
  }

  return vCap;
}

function scaleDir(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

/**
 * Weiche Sättigung des Tempos: V_eff = V / (1 + (V / V_cap)^4)^(1/4).
 */
export function softCap(V: number, Vcap: number): number {
  if (V <= 0) return V;
  if (!Number.isFinite(Vcap) || Vcap <= 0) return V;
  const ratio = V / Vcap;
  return V / Math.pow(1 + Math.pow(ratio, 4), 0.25);
}

/**
 * Führt die Geschwindigkeitsstufe fließend zur Umgebung zurück.
 */
export function relaxStage(
  state: AutoPaceState,
  speedScale: number,
  reference: number,
  halfDecades: number,
): number {
  const r = reference;
  if (speedScale !== state.lastWritten) {
    state.stageSet = speedScale;
    state.mark = r;
  }

  if (state.stageSet > 1) {
    state.mark = Math.max(state.mark, r);
    const d = Math.log10(Math.max(1e-12, state.mark / Math.max(1e-12, r)));
    const hd = Math.max(1e-6, halfDecades);
    const S_ziel = Math.exp(Math.log(state.stageSet) * Math.pow(2, -d / hd));
    const newStage = Math.min(speedScale, S_ziel);
    state.lastWritten = newStage;
    return newStage;
  } else if (state.stageSet < 1) {
    state.mark = Math.min(state.mark, r);
    const d = Math.log10(Math.max(1e-12, r / Math.max(1e-12, state.mark)));
    const hd = Math.max(1e-6, halfDecades);
    const S_ziel = Math.exp(Math.log(state.stageSet) * Math.pow(2, -d / hd));
    const newStage = Math.max(speedScale, S_ziel);
    state.lastWritten = newStage;
    return newStage;
  } else {
    state.lastWritten = 1;
    return 1;
  }
}
