// Reine f64-Vektorarithmetik auf einfachen {x,y,z}-Objekten.
// Kein three.js, kein Projekt-Import (§5): identisch lauffähig im Browser, im Worker und in Node.
// Absichtlich wertsemantisch (jede Operation liefert ein neues Objekt) — die Kerne laufen
// höchstens ein paar hundert Mal pro Frame, Allokationsdruck ist hier kein Thema.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function copy(a: Vec3): Vec3 {
  return { x: a.x, y: a.y, z: a.z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

/** a + b·s — spart die Zwischenallokation im Integrationsschritt. */
export function addScaled(a: Vec3, b: Vec3, s: number): Vec3 {
  return { x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function lengthSq(a: Vec3): number {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

// Math.hypot wäre überlaufsicher, aber ~4x langsamer. Im simulierten Bereich
// (max ~1e26 m) bleibt das Quadrat bei 1e52 — weit unter 1.8e308. Also sqrt.
export function length(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function normalize(a: Vec3, fallback: Vec3 = { x: 0, y: 0, z: 1 }): Vec3 {
  const l = length(a);
  return l > 0 ? { x: a.x / l, y: a.y / l, z: a.z / l } : copy(fallback);
}

export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Beliebiger Einheitsvektor senkrecht auf a. Wählt die betragskleinste Achse ⇒ kein Auslöschungsfall. */
export function orthogonal(a: Vec3): Vec3 {
  const ax = Math.abs(a.x);
  const ay = Math.abs(a.y);
  const az = Math.abs(a.z);
  const axis = ax <= ay && ax <= az ? vec3(1, 0, 0) : ay <= az ? vec3(0, 1, 0) : vec3(0, 0, 1);
  return normalize(cross(a, axis), vec3(1, 0, 0));
}

/** Rodrigues-Rotation von v um die Einheitsachse `axis`. */
export function rotateAround(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = cross(axis, v);
  const d = dot(axis, v) * (1 - c);
  return {
    x: v.x * c + k.x * s + axis.x * d,
    y: v.y * c + k.y * s + axis.y * d,
    z: v.z * c + k.z * s + axis.z * d,
  };
}

/**
 * Slerp zweier Einheitsvektoren mit Behandlung der beiden Entartungen.
 * Nahezu parallel: lineare Interpolation (sin θ → 0 wäre Division durch fast Null, §4.7).
 * Nahezu antiparallel: Drehung um eine beliebige orthogonale Achse — das Ergebnis ist
 * nicht eindeutig, aber stetig und normiert.
 */
export function slerpDir(a: Vec3, b: Vec3, t: number): Vec3 {
  const c = clamp(dot(a, b), -1, 1);
  const theta = Math.acos(c);
  if (theta < 1e-6) return normalize(lerp(a, b, t), a);
  if (Math.PI - theta < 1e-6) return rotateAround(a, orthogonal(a), t * Math.PI);
  const s = Math.sin(theta);
  const w0 = Math.sin((1 - t) * theta) / s;
  const w1 = Math.sin(t * theta) / s;
  return {
    x: a.x * w0 + b.x * w1,
    y: a.y * w0 + b.y * w1,
    z: a.z * w0 + b.z * w1,
  };
}

/**
 * Ableitung von `slerpDir` nach dem Parameter. Wird für die analytische
 * Übergabegeschwindigkeit am Ende eines Goto gebraucht — eine Rückwärtsdifferenz
 * hinterlässt dort einen kleinen Rest, die Ableitung nicht.
 */
export function slerpDirDerivative(a: Vec3, b: Vec3, t: number): Vec3 {
  const c = clamp(dot(a, b), -1, 1);
  const theta = Math.acos(c);
  if (theta < 1e-6) return sub(b, a); // fast parallel ⇒ praktisch linear
  if (Math.PI - theta < 1e-6) {
    const axis = orthogonal(a);
    return scale(cross(axis, rotateAround(a, axis, t * Math.PI)), Math.PI);
  }
  const sinT = Math.sin(theta);
  const w0 = (-theta * Math.cos((1 - t) * theta)) / sinT;
  const w1 = (theta * Math.cos(t * theta)) / sinT;
  return {
    x: a.x * w0 + b.x * w1,
    y: a.y * w0 + b.y * w1,
    z: a.z * w0 + b.z * w1,
  };
}

/** Zeitkonstanten-Glättung, framerate-unabhängig: 1 − e^(−dt/τ). */
export function relaxFactor(dt: number, tau: number): number {
  if (!(tau > 0)) return 1;
  return 1 - Math.exp(-dt / tau);
}
