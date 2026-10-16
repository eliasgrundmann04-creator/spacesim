import * as THREE from 'three/webgpu';
import { storage, wgslFn, uniform, texture, instanceIndex } from 'three/tsl';
import { FACES, TerrainField } from './tileGeometry';
import type { TileSpec } from './tileGeometry';

/**
 * Höhenfeld als WGSL-Compute-Kernel, eingebunden über TSL (`wgslFn` + `.compute()`).
 *
 * Arbeitsteilung (bewusst asymmetrisch):
 *   GPU  → die teure Arbeit: pro Vertex 5 Höhensamples à (octaves + 4) Simplex-
 *          Auswertungen, also ~45 Noise-Evaluationen; dazu die Normale aus dem
 *          Höhen-Gradienten im Tangentialrahmen.
 *   CPU  → die präzisionskritische Arbeit: Positionen als kachel-lokale f64-
 *          Differenz. Eine f32-Position bei R = 6.4e6 m hätte ~0.5 m Rauschen,
 *          was bei 2 m Flughöhe sichtbar wäre; Skalarhöhen und Einheitsnormalen
 *          sind in f32 dagegen unkritisch.
 *
 * Determinismus: Der Kernel liest exakt dieselbe mulberry32-Permutationstabelle
 * wie die CPU — hochgeladen als 512×1-RGBA8-Textur (R = perm, G = permMod12).
 * Restabweichung ist nur f32-Rundung (< 1 cm bei Erdamplitude).
 *
 * Die WebGPU-Node-API bewegt sich noch; deshalb validiert `create()` die
 * Pipeline zur Laufzeit gegen die CPU-Referenz und gibt bei Abweichung oder
 * Fehler null zurück — der Provider fällt dann automatisch auf Worker zurück.
 */

const TILE_WGSL = /* wgsl */ `
fn tileCompute(
	outBuf: ptr<storage, array<vec4<f32>>, read_write>,
	permTex: texture_2d<f32>,
	geomA: vec4<f32>,
	geomB: vec4<f32>,
	geomC: vec4<f32>,
	faceN: vec3<f32>,
	faceTu: vec3<f32>,
	faceTv: vec3<f32>,
	index: u32
) -> void {
	let radius = geomA.x;
	let amp = geomA.y;
	let oceanH = geomA.z;
	let freq = geomA.w;

	let u0 = geomB.x;
	let v0 = geomB.y;
	let span = geomB.z;
	let res = i32(geomB.w + 0.5);

	let eps = geomC.x;
	let octaves = geomC.y;

	let W = res + 3;
	let idx = i32(index);
	if (idx >= W * W) { return; }

	let i = idx % W - 1;
	let j = idx / W - 1;
	let ci = clamp(i, 0, res);
	let cj = clamp(j, 0, res);
	let u = u0 + span * f32(ci) / f32(res);
	let v = v0 + span * f32(cj) / f32(res);

	let dir = cubeToSphere(faceN + faceTu * u + faceTv * v);

	let raw = rawHeight(permTex, dir, freq, octaves, amp);
	let h = max(raw, oceanH);

	var ax = vec3<f32>(0.0, 0.0, 1.0);
	if (abs(dir.z) > 0.9) { ax = vec3<f32>(1.0, 0.0, 0.0); }
	let t1 = normalize(cross(dir, ax));
	let t2 = cross(dir, t1);

	let hA = max(rawHeight(permTex, normalize(dir + t1 * eps), freq, octaves, amp), oceanH);
	let hB = max(rawHeight(permTex, normalize(dir - t1 * eps), freq, octaves, amp), oceanH);
	let hC = max(rawHeight(permTex, normalize(dir + t2 * eps), freq, octaves, amp), oceanH);
	let hD = max(rawHeight(permTex, normalize(dir - t2 * eps), freq, octaves, amp), oceanH);

	let ds = 2.0 * eps * (radius + h);
	let nrm = normalize(dir - t1 * ((hA - hB) / ds) - t2 * ((hC - hD) / ds));

	(*outBuf)[index] = vec4<f32>(nrm, raw);
}

fn cubeToSphere(c: vec3<f32>) -> vec3<f32> {
	let x2 = c.x * c.x;
	let y2 = c.y * c.y;
	let z2 = c.z * c.z;
	let p = vec3<f32>(
		c.x * sqrt(1.0 - y2 * 0.5 - z2 * 0.5 + y2 * z2 / 3.0),
		c.y * sqrt(1.0 - z2 * 0.5 - x2 * 0.5 + z2 * x2 / 3.0),
		c.z * sqrt(1.0 - x2 * 0.5 - y2 * 0.5 + x2 * y2 / 3.0)
	);
	return normalize(p);
}

fn permR(t: texture_2d<f32>, i: i32) -> i32 {
	return i32(textureLoad(t, vec2<i32>(i & 511, 0), 0).r * 255.0 + 0.5);
}

fn permG(t: texture_2d<f32>, i: i32) -> i32 {
	return i32(textureLoad(t, vec2<i32>(i & 511, 0), 0).g * 255.0 + 0.5);
}

fn snoise(t: texture_2d<f32>, pin: vec3<f32>) -> f32 {
	let F3 = 0.3333333333333333;
	let G3 = 0.16666666666666666;

	var grad = array<vec3<f32>, 12>(
		vec3<f32>( 1.0,  1.0,  0.0), vec3<f32>(-1.0,  1.0,  0.0),
		vec3<f32>( 1.0, -1.0,  0.0), vec3<f32>(-1.0, -1.0,  0.0),
		vec3<f32>( 1.0,  0.0,  1.0), vec3<f32>(-1.0,  0.0,  1.0),
		vec3<f32>( 1.0,  0.0, -1.0), vec3<f32>(-1.0,  0.0, -1.0),
		vec3<f32>( 0.0,  1.0,  1.0), vec3<f32>( 0.0, -1.0,  1.0),
		vec3<f32>( 0.0,  1.0, -1.0), vec3<f32>( 0.0, -1.0, -1.0)
	);

	let s = (pin.x + pin.y + pin.z) * F3;
	let fi = floor(pin.x + s);
	let fj = floor(pin.y + s);
	let fk = floor(pin.z + s);
	let tt = (fi + fj + fk) * G3;
	let x0 = pin.x - (fi - tt);
	let y0 = pin.y - (fj - tt);
	let z0 = pin.z - (fk - tt);

	var i1 = 0; var j1 = 0; var k1 = 0;
	var i2 = 0; var j2 = 0; var k2 = 0;
	if (x0 >= y0) {
		if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
		else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
		else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
	} else {
		if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
		else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
		else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
	}

	let p1 = vec3<f32>(x0 - f32(i1) + G3, y0 - f32(j1) + G3, z0 - f32(k1) + G3);
	let p2 = vec3<f32>(x0 - f32(i2) + 2.0 * G3, y0 - f32(j2) + 2.0 * G3, z0 - f32(k2) + 2.0 * G3);
	let p3 = vec3<f32>(x0 - 1.0 + 3.0 * G3, y0 - 1.0 + 3.0 * G3, z0 - 1.0 + 3.0 * G3);
	let p0 = vec3<f32>(x0, y0, z0);

	let ii = i32(fi) & 255;
	let jj = i32(fj) & 255;
	let kk = i32(fk) & 255;

	var total = 0.0;

	var c0 = 0.6 - dot(p0, p0);
	if (c0 > 0.0) {
		let gi = permG(t, ii + permR(t, jj + permR(t, kk)));
		c0 = c0 * c0;
		total = total + c0 * c0 * dot(grad[gi], p0);
	}

	var c1 = 0.6 - dot(p1, p1);
	if (c1 > 0.0) {
		let gi = permG(t, ii + i1 + permR(t, jj + j1 + permR(t, kk + k1)));
		c1 = c1 * c1;
		total = total + c1 * c1 * dot(grad[gi], p1);
	}

	var c2 = 0.6 - dot(p2, p2);
	if (c2 > 0.0) {
		let gi = permG(t, ii + i2 + permR(t, jj + j2 + permR(t, kk + k2)));
		c2 = c2 * c2;
		total = total + c2 * c2 * dot(grad[gi], p2);
	}

	var c3 = 0.6 - dot(p3, p3);
	if (c3 > 0.0) {
		let gi = permG(t, ii + 1 + permR(t, jj + 1 + permR(t, kk + 1)));
		c3 = c3 * c3;
		total = total + c3 * c3 * dot(grad[gi], p3);
	}

	return 32.0 * total;
}

fn fbmNoise(t: texture_2d<f32>, p: vec3<f32>, octaves: f32) -> f32 {
	var sum = 0.0;
	var amp = 1.0;
	var freq = 1.0;
	var norm = 0.0;
	for (var o = 0u; o < 12u; o = o + 1u) {
		if (f32(o) >= octaves) { break; }
		sum = sum + amp * snoise(t, p * freq);
		norm = norm + amp;
		amp = amp * 0.5;
		freq = freq * 2.0;
	}
	return sum / norm;
}

fn ridgedNoise(t: texture_2d<f32>, p: vec3<f32>, octaves: f32) -> f32 {
	var sum = 0.0;
	var amp = 0.5;
	var freq = 1.0;
	var norm = 0.0;
	for (var o = 0u; o < 12u; o = o + 1u) {
		if (f32(o) >= octaves) { break; }
		var v = 1.0 - abs(snoise(t, p * freq));
		v = v * v;
		sum = sum + v * amp;
		norm = norm + amp;
		amp = amp * 0.5;
		freq = freq * 2.1;
	}
	return sum / norm;
}

fn rawHeight(t: texture_2d<f32>, dir: vec3<f32>, freq: f32, octaves: f32, amp: f32) -> f32 {
	let base = fbmNoise(t, dir * freq, octaves);
	let r = ridgedNoise(t, dir * (freq * 2.6) + vec3<f32>(11.7, 11.7, 11.7), 4.0);
	return (base + r * 0.55 * max(0.0, base + 0.15)) * amp;
}
`;

interface Pipeline {
  computeNode: unknown;
  attribute: THREE.StorageBufferAttribute;
  geomA: { value: THREE.Vector4 };
  geomB: { value: THREE.Vector4 };
  geomC: { value: THREE.Vector4 };
  faceN: { value: THREE.Vector3 };
  faceTu: { value: THREE.Vector3 };
  faceTv: { value: THREE.Vector3 };
}

/** Permutationstabelle als 512×1-RGBA8-Textur (R = perm, G = permMod12). */
function permTexture(field: TerrainField): THREE.DataTexture {
  const data = new Uint8Array(512 * 4);
  for (let i = 0; i < 512; i++) {
    data[i * 4] = field.noise.perm[i];
    data[i * 4 + 1] = field.noise.permMod12[i];
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, 512, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export class GpuTerrain {
  private readonly pipelines = new Map<string, Pipeline>();
  private readonly textures = new Map<number, THREE.DataTexture>();
  private chain: Promise<unknown> = Promise.resolve();

  // Explizites Feld statt Parameter-Property: Nodes Type-Stripping kann Letztere
  // nicht entfernen, und über den TerrainProvider hängt dieses Modul jetzt am
  // Offline-Test (§8).
  private readonly renderer: THREE.WebGPURenderer;

  private constructor(renderer: THREE.WebGPURenderer) {
    this.renderer = renderer;
  }

  /** Baut den Kernel und validiert ihn gegen die CPU-Referenz. null = nicht nutzbar. */
  static async create(renderer: THREE.WebGPURenderer, probe: {
    field: TerrainField;
    tile: TileSpec;
    reference: Float32Array;   // erwartete (nx, ny, nz, raw)-Werte der CPU
  }): Promise<GpuTerrain | null> {
    try {
      if (!renderer.backend || !('gpu' in navigator)) return null;

      const gpu = new GpuTerrain(renderer);
      const data = await gpu.computeTile(probe.field, probe.tile);

      const amp = probe.field.amp;
      let maxHeightError = 0;
      let minDot = 1;
      for (let i = 0; i < probe.reference.length; i += 4) {
        maxHeightError = Math.max(maxHeightError, Math.abs(data[i + 3] - probe.reference[i + 3]));
        minDot = Math.min(
          minDot,
          data[i] * probe.reference[i] +
          data[i + 1] * probe.reference[i + 1] +
          data[i + 2] * probe.reference[i + 2],
        );
      }
      if (!(maxHeightError < Math.max(1, amp * 5e-3)) || !(minDot > 0.999)) {
        console.warn(
          `[GpuTerrain] Selbsttest fehlgeschlagen (Δh ${maxHeightError.toFixed(3)} m, min·n ${minDot.toFixed(5)}) — Worker-Pfad wird genutzt.`,
        );
        return null;
      }
      return gpu;
    } catch (e) {
      console.warn('[GpuTerrain] Compute-Pfad nicht verfügbar — Worker-Pfad wird genutzt.', e);
      return null;
    }
  }

  /** Serialisiert die Dispatches: Uniforms werden zwischen den Läufen mutiert. */
  computeTile(field: TerrainField, tile: TileSpec): Promise<Float32Array> {
    const run = this.chain.then(() => this.dispatch(field, tile));
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Pro (Auflösung, Planet) eine Pipeline — die Permutationstextur ist Teil der Bindings. */
  private pipelineFor(resolution: number, tex: THREE.DataTexture, seed: number): Pipeline {
    const key = `r${resolution}s${seed}`;
    const cached = this.pipelines.get(key);
    if (cached) return cached;

    const W = resolution + 3;
    const count = W * W;

    const attribute = new THREE.StorageBufferAttribute(new Float32Array(count * 4), 4);
    // Uniform-Knoten typisiert lassen: wgslFn verlangt Nodes, Pipeline nur `.value`
    const geomA = uniform(new THREE.Vector4());
    const geomB = uniform(new THREE.Vector4());
    const geomC = uniform(new THREE.Vector4());
    const faceN = uniform(new THREE.Vector3());
    const faceTu = uniform(new THREE.Vector3());
    const faceTv = uniform(new THREE.Vector3());

    const kernel = wgslFn(TILE_WGSL);
    const call = kernel({
      outBuf: storage(attribute, 'vec4', count),
      permTex: texture(tex),
      geomA, geomB, geomC,
      faceN, faceTu, faceTv,
      index: instanceIndex,
    });
    const computeNode = (call as unknown as { compute: (n: number) => unknown }).compute(count);

    const pipeline: Pipeline = { computeNode, attribute, geomA, geomB, geomC, faceN, faceTu, faceTv };
    this.pipelines.set(key, pipeline);
    return pipeline;
  }

  private async dispatch(field: TerrainField, tile: TileSpec): Promise<Float32Array> {
    let tex = this.textures.get(field.seed);
    if (!tex) {
      tex = permTexture(field);
      this.textures.set(field.seed, tex);
    }
    const pipeline = this.pipelineFor(tile.resolution, tex, field.seed);

    const span = 2 / (1 << tile.level);
    const eps = (span / tile.resolution) * 0.35;
    const F = FACES[tile.face];

    pipeline.geomA.value.set(field.radius, field.amp, field.oceanH === -Infinity ? -3.4e38 : field.oceanH, field.frequency);
    pipeline.geomB.value.set(tile.u0, tile.v0, span, tile.resolution);
    pipeline.geomC.value.set(eps, field.octaves, 0, 0);
    pipeline.faceN.value.set(F.n[0], F.n[1], F.n[2]);
    pipeline.faceTu.value.set(F.tu[0], F.tu[1], F.tu[2]);
    pipeline.faceTv.value.set(F.tv[0], F.tv[1], F.tv[2]);

    await this.renderer.computeAsync(pipeline.computeNode as never);
    const buffer = await this.renderer.getArrayBufferAsync(pipeline.attribute as never);
    return new Float32Array(buffer);
  }
}
