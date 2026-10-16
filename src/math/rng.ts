/**
 * Deterministische Zufälligkeit für die prozedurale Generierung.
 * Gleicher Seed ⇒ identisches Universum, auf jedem Gerät, in jeder Session.
 */

/** Kombiniert beliebig viele Integer zu einem 32-bit-Seed (FNV-1a + Murmur3-Finalizer). */
export function hash32(...values: number[]): number {
  let h = 0x811c9dc5 >>> 0;
  for (const v of values) {
    h ^= (v | 0) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function hashString(s: string): number {
  const codes: number[] = [];
  for (let i = 0; i < s.length; i++) codes.push(s.charCodeAt(i));
  return hash32(...codes, s.length);
}

/** mulberry32 — schneller, hochwertiger 32-bit-PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  /** Gleichverteilt in [min, max). */
  float(min = 0, max = 1): number {
    return min + this.next() * (max - min);
  }

  /** Ganzzahl in [min, max] (inklusiv). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Log-gleichverteilt — natürlich für Massen, Leuchtkräfte etc. */
  logUniform(min: number, max: number): number {
    return Math.exp(this.float(Math.log(min), Math.log(max)));
  }

  /** Normalverteilt (Box-Muller). */
  normal(mean = 0, sd = 1): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  angle(): number {
    return this.float(0, 2 * Math.PI);
  }
}
