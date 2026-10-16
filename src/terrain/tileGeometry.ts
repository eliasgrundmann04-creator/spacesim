import { SimplexNoise3D, fbm, ridged } from './noise';

/**
 * Reiner Terrain-Kern — bewusst OHNE three.js-Import.
 *
 * Dadurch kann exakt derselbe Code laufen in:
 *   1. Web Workern (Standardpfad, parallel, kein Main-Thread-Ruckeln),
 *   2. dem synchronen Notpfad (falls Worker nicht verfügbar),
 *   3. der Main-Thread-Assemblierung der GPU-Ergebnisse.
 *
 * Alle hier definierten Typen sind strukturell klonbar (postMessage-fähig).
 */

export interface TerrainParams {
  amplitude: number;    // max. Relief relativ zum Radius (Erde ≈ 0.0018 ⇒ ~11 km)
  frequency: number;    // Basisfrequenz auf der Einheitskugel
  octaves: number;
  ocean: boolean;
  oceanLevel: number;   // Meeresspiegel in Amplituden-Einheiten [-1, 1]
  palette: string;
  maxDepth: number;     // Quadtree-Tiefe
  resolution: number;   // Vertices pro Kachelkante (ohne Skirt)
}

/** Serialisierbare Beschreibung eines Planeten-Höhenfelds. */
export interface TerrainSpec {
  seed: number;
  radius: number;
  terrain: TerrainParams;
}

/** Serialisierbare Beschreibung einer Quadtree-Kachel. */
export interface TileSpec {
  face: number;
  level: number;
  u0: number;
  v0: number;
  resolution: number;
  centerX: number;
  centerY: number;
  centerZ: number;
}

export interface TileBuffers {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  boundingRadius: number;
}

// tu × tv = n ⇒ konsistente CCW-Windung nach außen auf allen sechs Flächen.
export const FACES: readonly { n: number[]; tu: number[]; tv: number[] }[] = [
  { n: [ 1, 0, 0], tu: [0, 0, -1], tv: [0, 1, 0] },
  { n: [-1, 0, 0], tu: [0, 0,  1], tv: [0, 1, 0] },
  { n: [ 0, 1, 0], tu: [1, 0,  0], tv: [0, 0, -1] },
  { n: [ 0,-1, 0], tu: [1, 0,  0], tv: [0, 0,  1] },
  { n: [ 0, 0, 1], tu: [1, 0,  0], tv: [0, 1, 0] },
  { n: [ 0, 0,-1], tu: [1, 0,  0], tv: [0, -1, 0] },
];

// Höhen-Paletten: Stops [höhe_normiert ∈ [-1,1], Hex-Farbe]
export const PALETTES: Record<string, [number, number][]> = {
  earth:  [[-1, 0x081d3f], [-0.06, 0x123f6e], [-0.005, 0x2c6b9e], [0.0, 0xc9bd8f],
           [0.06, 0x3d7a3f], [0.35, 0x6b6353], [0.62, 0x8d8d8d], [0.85, 0xffffff]],
  red:    [[-1, 0x2e150c], [0, 0x7a3b1e], [0.45, 0xb96a3c], [1, 0xe8b98a]],
  gray:   [[-1, 0x262626], [0, 0x6f6f6f], [1, 0xc4c4c4]],
  ice:    [[-1, 0x6e93ba], [0, 0xcfe0ee], [1, 0xffffff]],
  desert: [[-1, 0x5c3f20], [0, 0xa87f45], [0.55, 0xd6b476], [1, 0xf1e2ba]],
};

interface Vec3Like { x: number; y: number; z: number; }

/** Gleichmäßige Würfel-auf-Kugel-Projektion (weniger Verzerrung als reine Normalisierung). */
export function cubeToSphere(x: number, y: number, z: number, out: Vec3Like): Vec3Like {
  const x2 = x * x, y2 = y * y, z2 = z * z;
  let ox = x * Math.sqrt(1 - y2 / 2 - z2 / 2 + (y2 * z2) / 3);
  let oy = y * Math.sqrt(1 - z2 / 2 - x2 / 2 + (z2 * x2) / 3);
  let oz = z * Math.sqrt(1 - x2 / 2 - y2 / 2 + (x2 * y2) / 3);
  const l = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
  ox /= l; oy /= l; oz /= l;
  out.x = ox; out.y = oy; out.z = oz;
  return out;
}

/** Höhenfeld eines Planeten: deterministisch aus Seed, identisch in Worker, GPU und Main-Thread. */
export class TerrainField {
  readonly seed: number;
  readonly radius: number;
  readonly amp: number;       // Amplitude in Metern
  readonly oceanH: number;    // Meeresspiegel in Metern (−Infinity = kein Ozean)
  readonly frequency: number;
  readonly octaves: number;
  readonly noise: SimplexNoise3D;

  private readonly stops: { h: number; r: number; g: number; b: number }[];

  constructor(spec: TerrainSpec) {
    const t = spec.terrain;
    this.seed = spec.seed;
    this.radius = spec.radius;
    this.amp = t.amplitude * spec.radius;
    this.oceanH = t.ocean ? t.oceanLevel * this.amp : -Infinity;
    this.frequency = t.frequency;
    this.octaves = t.octaves;
    this.noise = new SimplexNoise3D(spec.seed);

    const table = PALETTES[t.palette] ?? PALETTES.gray;
    this.stops = table.map(([h, hex]) => ({
      h,
      r: ((hex >> 16) & 255) / 255,
      g: ((hex >> 8) & 255) / 255,
      b: (hex & 255) / 255,
    }));
  }

  /** Rohe Terrainhöhe in Metern (ohne Ozean-Clamp). */
  rawHeight(dx: number, dy: number, dz: number): number {
    const f = this.frequency;
    const base = fbm(this.noise, dx * f, dy * f, dz * f, this.octaves);
    const r = ridged(
      this.noise,
      dx * f * 2.6 + 11.7, dy * f * 2.6 + 11.7, dz * f * 2.6 + 11.7,
      4,
    );
    // Gebirgszüge nur auf "Kontinenten" (positives Grundniveau)
    return (base + r * 0.55 * Math.max(0, base + 0.15)) * this.amp;
  }

  /** Effektive Höhe inkl. Ozean-Clamp (Geometrie & Kollision). */
  height(dx: number, dy: number, dz: number): number {
    const raw = this.rawHeight(dx, dy, dz);
    return raw > this.oceanH ? raw : this.oceanH;
  }

  /** Farbe aus roher Höhe (nicht geklemmt ⇒ Meeresboden bleibt sichtbar blau). */
  colorInto(rawHeight: number, out: Float32Array, offset: number): void {
    let hn = rawHeight / this.amp;
    if (hn < -1) hn = -1; else if (hn > 1) hn = 1;
    const s = this.stops;
    if (hn <= s[0].h) {
      out[offset] = s[0].r; out[offset + 1] = s[0].g; out[offset + 2] = s[0].b;
      return;
    }
    for (let i = 1; i < s.length; i++) {
      if (hn <= s[i].h) {
        const a = s[i - 1], b = s[i];
        const t = (hn - a.h) / (b.h - a.h);
        out[offset] = a.r + (b.r - a.r) * t;
        out[offset + 1] = a.g + (b.g - a.g) * t;
        out[offset + 2] = a.b + (b.b - a.b) * t;
        return;
      }
    }
    const last = s[s.length - 1];
    out[offset] = last.r; out[offset + 1] = last.g; out[offset + 2] = last.b;
  }
}

const _dir: Vec3Like = { x: 0, y: 0, z: 0 };
const _s: Vec3Like = { x: 0, y: 0, z: 0 };

/** Höhe an einem tangential versetzten Punkt (Einheitsrichtung wird neu normalisiert). */
function heightAtOffset(
  field: TerrainField,
  dx: number, dy: number, dz: number,
  tx: number, ty: number, tz: number,
  eps: number,
): number {
  let ax = dx + tx * eps, ay = dy + ty * eps, az = dz + tz * eps;
  const l = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
  ax /= l; ay /= l; az /= l;
  _s.x = ax; _s.y = ay; _s.z = az;
  return field.height(ax, ay, az);
}

/**
 * Baut die Vertexpuffer einer Kachel.
 *
 * @param gpuData Optional: vom Compute-Shader gelieferte (nx, ny, nz, rawHeight)-Vierergruppen.
 *                Ist der Parameter null, werden Höhen und Normalen hier auf der CPU berechnet.
 *
 * Präzision: Positionen entstehen IMMER hier in f64 und werden erst als kachel-lokale
 * Differenz (dir·rad − center) nach f32 geschrieben. Genau deshalb liefert der GPU-Pfad
 * nur Skalarhöhen und Normalen — eine f32-Position bei Radius 6.4e6 m hätte sonst ~0.5 m
 * Rauschen, was bei 2 m Flughöhe sichtbar wäre.
 */
export function assembleTile(
  field: TerrainField,
  tile: TileSpec,
  gpuData: Float32Array | null,
): TileBuffers {
  const res = tile.resolution;
  const span = 2 / (1 << tile.level);
  const W = res + 3;                                 // + Skirt-Ring
  const count = W * W;
  const R = field.radius;
  const tileSize = (2 * R) / (1 << tile.level);
  const skirtDepth = Math.max(5, tileSize * 0.03);
  const eps = (span / res) * 0.35;
  const F = FACES[tile.face];

  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  let o = 0;
  let vi = 0;
  let maxR2 = 0;

  for (let j = -1; j <= res + 1; j++) {
    for (let i = -1; i <= res + 1; i++, vi++, o += 3) {
      const isSkirt = i < 0 || j < 0 || i > res || j > res;
      const ci = i < 0 ? 0 : i > res ? res : i;
      const cj = j < 0 ? 0 : j > res ? res : j;
      const u = tile.u0 + (span * ci) / res;
      const v = tile.v0 + (span * cj) / res;

      cubeToSphere(
        F.n[0] + F.tu[0] * u + F.tv[0] * v,
        F.n[1] + F.tu[1] * u + F.tv[1] * v,
        F.n[2] + F.tu[2] * u + F.tv[2] * v,
        _dir,
      );
      const dx = _dir.x, dy = _dir.y, dz = _dir.z;

      let raw: number;
      let nx: number, ny: number, nz: number;

      if (gpuData) {
        const g = vi * 4;
        nx = gpuData[g]; ny = gpuData[g + 1]; nz = gpuData[g + 2];
        raw = gpuData[g + 3];
      } else {
        raw = field.rawHeight(dx, dy, dz);
        const h0 = raw > field.oceanH ? raw : field.oceanH;

        // Tangentialbasis; Normale aus dem Höhen-Gradienten (siehe unten).
        let a1x = 0, a1y = 0, a1z = 1;
        if (Math.abs(dz) > 0.9) { a1x = 1; a1y = 0; a1z = 0; }
        let t1x = dy * a1z - dz * a1y;
        let t1y = dz * a1x - dx * a1z;
        let t1z = dx * a1y - dy * a1x;
        const tl = Math.sqrt(t1x * t1x + t1y * t1y + t1z * t1z) || 1;
        t1x /= tl; t1y /= tl; t1z /= tl;
        const t2x = dy * t1z - dz * t1y;
        const t2y = dz * t1x - dx * t1z;
        const t2z = dx * t1y - dy * t1x;

        const hA = heightAtOffset(field, dx, dy, dz,  t1x,  t1y,  t1z, eps);
        const hB = heightAtOffset(field, dx, dy, dz, -t1x, -t1y, -t1z, eps);
        const hC = heightAtOffset(field, dx, dy, dz,  t2x,  t2y,  t2z, eps);
        const hD = heightAtOffset(field, dx, dy, dz, -t2x, -t2y, -t2z, eps);

        // Analytische Normale über den Höhen-Gradienten im Tangentialrahmen:
        //   n = normalize(dir − t1·∂h/∂s1 − t2·∂h/∂s2),  ∂s = 2·eps·(R+h)
        // Numerisch stabiler als das Kreuzprodukt zweier Oberflächenpunkte
        // (dort löschen sich bei tiefen LOD-Stufen ~6 signifikante Stellen aus)
        // und exakt dieselbe Formel wie im WGSL-Kernel ⇒ identische Optik.
        const ds = 2 * eps * (R + h0);
        const g1 = (hA - hB) / ds;
        const g2 = (hC - hD) / ds;
        nx = dx - t1x * g1 - t2x * g2;
        ny = dy - t1y * g1 - t2y * g2;
        nz = dz - t1z * g1 - t2z * g2;
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
      }

      const h = raw > field.oceanH ? raw : field.oceanH;
      const rad = R + h - (isSkirt ? skirtDepth : 0);

      const px = dx * rad - tile.centerX;
      const py = dy * rad - tile.centerY;
      const pz = dz * rad - tile.centerZ;
      positions[o] = px; positions[o + 1] = py; positions[o + 2] = pz;
      normals[o] = nx; normals[o + 1] = ny; normals[o + 2] = nz;

      const r2 = px * px + py * py + pz * pz;
      if (r2 > maxR2) maxR2 = r2;

      field.colorInto(raw, colors, o);
    }
  }

  return { positions, normals, colors, boundingRadius: Math.sqrt(maxR2) };
}

const indexCache = new Map<number, Uint16Array>();

/** Indexpuffer ist für jede Kachel gleicher Auflösung identisch ⇒ einmal bauen, Array teilen. */
export function tileIndices(resolution: number): Uint16Array {
  const cached = indexCache.get(resolution);
  if (cached) return cached;

  const W = resolution + 3;
  const idx = new Uint16Array((W - 1) * (W - 1) * 6);
  let p = 0;
  for (let j = 0; j < W - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
      idx[p++] = a; idx[p++] = b; idx[p++] = d;
      idx[p++] = a; idx[p++] = d; idx[p++] = c;
    }
  }
  indexCache.set(resolution, idx);
  return idx;
}
