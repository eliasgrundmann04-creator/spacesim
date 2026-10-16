import * as THREE from 'three/webgpu';
import { CelestialBody, BodyParams } from './CelestialBody';
import { Vector3d } from '../math/Vector3d';
import { PlanetLOD } from '../terrain/PlanetLOD';
import type { TerrainParams } from '../terrain/tileGeometry';
import { SimplexNoise3D } from '../terrain/noise';

export interface PlanetParams extends BodyParams {
  terrain?: TerrainParams;                   // nur type === 'rocky'
  gasPalette?: 'jovian' | 'neptunian';       // nur type === 'gas'
}

const GAS_COLORS: Record<string, [number, number]> = {
  jovian:    [0xc8a06a, 0x8a6642],
  neptunian: [0x5a7fd6, 0x2f4f96],
};

const _camLocal = new THREE.Vector3();
const _ca = new THREE.Color();
const _cb = new THREE.Color();

export class Planet extends CelestialBody {
  readonly terrain: TerrainParams | null;
  readonly gasPalette: 'jovian' | 'neptunian';
  lod: PlanetLOD | null = null;

  constructor(params: PlanetParams) {
    super(params);
    this.terrain = params.terrain ?? null;
    this.gasPalette = params.gasPalette ?? 'jovian';
  }

  buildRenderObject(): void {
    if (this.type === 'rocky' && this.terrain) {
      this.lod = new PlanetLOD({ radius: this.radius, seed: this.seed, terrain: this.terrain });
      this.root.add(this.lod.group);
    } else {
      this.root.add(this.buildGasGiant());
    }
  }

  /** Gasriese: einfache Kugel mit Breitengrad-Bändern (Vertex-Farben). */
  private buildGasGiant(): THREE.Mesh {
    const geo = new THREE.SphereGeometry(this.radius, 96, 48);
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const noise = new SimplexNoise3D(this.seed);
    const [cA, cB] = GAS_COLORS[this.gasPalette];
    _ca.setHex(cA);
    _cb.setHex(cB);

    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / this.radius;
      const y = pos.getY(i) / this.radius;
      const z = pos.getZ(i) / this.radius;   // Z-up ⇒ z = sin(Breitengrad)
      const wobble = noise.noise(x * 2.5, y * 2.5, z * 4) * 1.6;
      const band = Math.sin(Math.asin(THREE.MathUtils.clamp(z, -1, 1)) * 9 + wobble) * 0.5 + 0.5;
      c.copy(_ca).lerp(_cb, band);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    return new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
    );
  }

  override update(_dt: number, cameraPos: Vector3d): void {
    if (!this.lod) return;
    // Kameraposition relativ zum Planetenzentrum (f64-Differenz → f32)
    _camLocal.set(
      cameraPos.x - this.position.x,
      cameraPos.y - this.position.y,
      cameraPos.z - this.position.z,
    );
    this.lod.update(_camLocal);
  }

  override getSurfaceOffset(dir: THREE.Vector3): number {
    return this.lod ? this.lod.sampleHeight(dir) : 0;
  }
}
