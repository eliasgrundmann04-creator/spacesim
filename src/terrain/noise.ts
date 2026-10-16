import { mulberry32 } from '../math/rng';

/**
 * Seedbares 3D-Simplex-Noise (nach Gustavson) — läuft vorerst auf der CPU.
 * Migrationspfad: identische Funktion als WGSL-Compute-Kernel (TSL), damit
 * Tile-Höhenfelder auf der GPU entstehen; die CPU-Version bleibt dann für
 * Kollision/Sampling (Kamera, spätere Physik) erhalten.
 */

const GRAD3 = new Float64Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

const F3 = 1 / 3;
const G3 = 1 / 6;

export class SimplexNoise3D {
  /** Öffentlich, damit der GPU-Pfad exakt dieselbe Tabelle als Textur hochladen kann. */
  readonly perm = new Uint8Array(512);
  readonly permMod12 = new Uint8Array(512);

  constructor(seed: number) {
    const rand = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // Fisher-Yates mit geseedetem PRNG ⇒ deterministische Permutation
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }

  /** Rückgabe ≈ [-1, 1]. */
  noise(xin: number, yin: number, zin: number): number {
    const perm = this.perm, permMod12 = this.permMod12;

    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);

    let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0)      { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else               { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0)       { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0)  { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else               { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }

    const x1 = x0 - i1 + G3,     y1 = y0 - j1 + G3,     z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3,  y3 = y0 - 1 + 3 * G3,  z3 = z0 - 1 + 3 * G3;

    const ii = i & 255, jj = j & 255, kk = k & 255;

    let n = 0;

    let tc = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (tc > 0) {
      const gi = permMod12[ii + perm[jj + perm[kk]]] * 3;
      tc *= tc;
      n += tc * tc * (GRAD3[gi] * x0 + GRAD3[gi + 1] * y0 + GRAD3[gi + 2] * z0);
    }
    tc = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (tc > 0) {
      const gi = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3;
      tc *= tc;
      n += tc * tc * (GRAD3[gi] * x1 + GRAD3[gi + 1] * y1 + GRAD3[gi + 2] * z1);
    }
    tc = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (tc > 0) {
      const gi = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3;
      tc *= tc;
      n += tc * tc * (GRAD3[gi] * x2 + GRAD3[gi + 1] * y2 + GRAD3[gi + 2] * z2);
    }
    tc = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (tc > 0) {
      const gi = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3;
      tc *= tc;
      n += tc * tc * (GRAD3[gi] * x3 + GRAD3[gi + 1] * y3 + GRAD3[gi + 2] * z3);
    }

    return 32 * n;
  }
}

/** Fraktales Brownsches Rauschen, normalisiert auf ≈ [-1, 1]. */
export function fbm(
  n: SimplexNoise3D, x: number, y: number, z: number,
  octaves: number, lacunarity = 2, gain = 0.5,
): number {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * n.noise(x * freq, y * freq, z * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged-Multifraktal (Bergrücken), Rückgabe ≈ [0, 1]. */
export function ridged(
  n: SimplexNoise3D, x: number, y: number, z: number,
  octaves: number, lacunarity = 2.1, gain = 0.5,
): number {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    let v = 1 - Math.abs(n.noise(x * freq, y * freq, z * freq));
    v *= v;
    sum += v * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
