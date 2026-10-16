import * as THREE from 'three/webgpu';
import { TerrainField, cubeToSphere, FACES, tileIndices } from './tileGeometry';
import type { TerrainParams, TerrainSpec, TileBuffers, TileSpec } from './tileGeometry';
import { getTerrainProvider } from './TerrainProvider';

export type { TerrainParams };

/**
 * Prozedurale Planetenoberfläche: Cube-Sphere + LOD-Quadtree.
 *
 * Die Auswahl-Logik ist unverändert (distanzbasiertes Split mit Hysterese,
 * Skirts gegen T-Junction-Risse, analytische Normalen, Ozean-Clamp) — neu ist
 * nur, dass Kachelgeometrie asynchron entsteht (Worker bzw. GPU-Compute).
 *
 * Lückenfreier Übergang: Eine gesplittete Kachel bleibt sichtbar, bis ALLE vier
 * Kinder ihre Geometrie haben. Vorher werden die Kinder ausgeblendet — dadurch
 * gibt es weder Löcher noch doppelt gezeichnete, z-fightende Flächen.
 */

export interface PlanetLODConfig {
  radius: number;
  seed: number;
  terrain: TerrainParams;
}

const SPLIT_FACTOR = 3.0;
const MERGE_FACTOR = 4.2;   // > SPLIT_FACTOR ⇒ Hysterese
const REQUEST_BUDGET = 8;   // Anfragen pro Frame und Planet (nur noch Queue-Kosten)

class QuadtreeTile {
  children: QuadtreeTile[] | null = null;
  mesh: THREE.Mesh | null = null;

  readonly center = new THREE.Vector3();
  readonly centerDir = new THREE.Vector3();
  readonly size: number;

  private jobId: number | null = null;
  private disposed = false;

  constructor(
    private readonly lod: PlanetLOD,
    private readonly face: number,
    readonly level: number,
    private readonly u0: number,
    private readonly v0: number,
  ) {
    this.size = (2 * lod.config.radius) / (1 << level);
    const half = 1 / (1 << level);
    lod.surfacePoint(face, u0 + half, v0 + half, this.center, this.centerDir);
  }

  /** @returns true, wenn diese Kachel (bzw. ihr Teilbaum) etwas Sichtbares beisteuert. */
  update(camLocal: THREE.Vector3, budget: { requests: number }): boolean {
    const d = camLocal.distanceTo(this.center);

    const wantSplit =
      this.level < this.lod.config.terrain.maxDepth &&
      d < this.size * SPLIT_FACTOR &&
      // grober Rückseiten-Guard: abgewandte Hemisphäre nicht verfeinern
      (this.centerDir.dot(camLocal) > 0 || d < this.size * 4);

    if (wantSplit && !this.children) this.split();

    if (this.children) {
      const wantMerge = d > this.size * MERGE_FACTOR;
      if (wantMerge && this.mesh) {
        this.merge();
      } else {
        // Zusammenlegen braucht die eigene Geometrie — sonst risse ein Loch.
        // Fehlt sie (verworfener oder verlorener Job), muss sie *hier* neu
        // angefordert werden: der reguläre Pfad unten wird bei fertigen Kindern
        // nie erreicht, der Teilbaum bliebe sonst dauerhaft auf hoher Stufe
        // stehen und flutete die Warteschlange mit fernen Kacheln. Ohne Budget:
        // die Anfrage *senkt* die Last, sobald sie eintrifft (der Teilbaum fällt weg).
        if (wantMerge) this.requestMesh(d);

        let allReady = true;
        for (const child of this.children) {
          const ready = child.update(camLocal, budget);
          allReady = allReady && ready;
        }
        if (allReady) {
          if (this.mesh) this.mesh.visible = false;
          return true;
        }
        // Noch nicht vollständig: Kinder verstecken, Elternkachel zeigen.
        for (const child of this.children) child.setVisible(false);
      }
    }

    this.requestMesh(d, budget);
    if (!this.mesh) return false;
    this.mesh.visible = true;
    return true;
  }

  private split(): void {
    const s = 1 / (1 << this.level);
    this.children = [
      new QuadtreeTile(this.lod, this.face, this.level + 1, this.u0,     this.v0),
      new QuadtreeTile(this.lod, this.face, this.level + 1, this.u0 + s, this.v0),
      new QuadtreeTile(this.lod, this.face, this.level + 1, this.u0,     this.v0 + s),
      new QuadtreeTile(this.lod, this.face, this.level + 1, this.u0 + s, this.v0 + s),
    ];
  }

  private merge(): void {
    if (!this.children) return;
    for (const child of this.children) child.dispose();
    this.children = null;
  }

  private setVisible(visible: boolean): void {
    if (this.mesh) this.mesh.visible = visible;
    if (this.children) for (const child of this.children) child.setVisible(visible);
  }

  requestMesh(priority: number, budget?: { requests: number }): void {
    if (this.mesh) return;
    if (this.jobId !== null) {
      // Wartender Job: Priorität auf die aktuelle Kameradistanz nachziehen.
      // Ohne das sortiert die Warteschlange nach dem Standort zum Anfragezeitpunkt.
      this.lod.provider.reprioritize(this.jobId, priority);
      return;
    }
    if (budget) {
      if (budget.requests <= 0) return;
      budget.requests--;
    }

    const tile: TileSpec = {
      face: this.face,
      level: this.level,
      u0: this.u0,
      v0: this.v0,
      resolution: this.lod.config.terrain.resolution,
      centerX: this.center.x,
      centerY: this.center.y,
      centerZ: this.center.z,
    };

    this.jobId = this.lod.provider.request(
      this.lod.field, this.lod.spec, tile, priority,
      (buffers: TileBuffers | null) => {
        this.jobId = null;
        if (this.disposed || !buffers) return;
        this.mesh = this.lod.createMesh(buffers, this.center);
        this.mesh.visible = false; // Sichtbarkeit entscheidet der nächste update()
        this.lod.group.add(this.mesh);
      },
    );
  }

  dispose(): void {
    this.disposed = true;
    if (this.jobId !== null) {
      this.lod.provider.cancel(this.jobId);
      this.jobId = null;
    }
    this.merge();
    if (this.mesh) {
      this.lod.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
  }
}

export class PlanetLOD {
  readonly group = new THREE.Group();
  readonly field: TerrainField;
  readonly spec: TerrainSpec;
  readonly provider = getTerrainProvider();

  private readonly roots: QuadtreeTile[] = [];
  private readonly material: THREE.MeshStandardMaterial;
  private readonly indices: Uint16Array;

  constructor(readonly config: PlanetLODConfig) {
    this.spec = { seed: config.seed, radius: config.radius, terrain: config.terrain };
    this.field = new TerrainField(this.spec);
    this.indices = tileIndices(config.terrain.resolution);

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
    });

    for (let f = 0; f < 6; f++) {
      const root = new QuadtreeTile(this, f, 0, -1, -1);
      root.requestMesh(0); // Wurzelkacheln sofort und ohne Budget anfordern
      this.roots.push(root);
    }
  }

  /** Höhensampling für Kamera-Kollision (immer CPU: muss synchron verfügbar sein). */
  sampleHeight(dir: THREE.Vector3): number {
    return this.field.height(dir.x, dir.y, dir.z);
  }

  /** Oberflächenpunkt (planet-lokal) für Würfel-UV (u, v ∈ [-1, 1]) einer Fläche. */
  surfacePoint(face: number, u: number, v: number, outPos: THREE.Vector3, outDir: THREE.Vector3): void {
    const F = FACES[face];
    cubeToSphere(
      F.n[0] + F.tu[0] * u + F.tv[0] * v,
      F.n[1] + F.tu[1] * u + F.tv[1] * v,
      F.n[2] + F.tu[2] * u + F.tv[2] * v,
      outDir,
    );
    const h = this.field.height(outDir.x, outDir.y, outDir.z);
    outPos.copy(outDir).multiplyScalar(this.config.radius + h);
  }

  /** camLocal = Kameraposition relativ zum Planetenzentrum. */
  update(camLocal: THREE.Vector3): void {
    const budget = {
      requests: camLocal.length() > this.config.radius * 400 ? 0 : REQUEST_BUDGET,
    };
    for (const root of this.roots) root.update(camLocal, budget);
  }

  createMesh(buffers: TileBuffers, center: THREE.Vector3): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(buffers.normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(buffers.colors, 3));
    // Index-Array wird geteilt, das Attribut-Objekt nicht: dispose() einer
    // Geometrie darf die GPU-Puffer der anderen Kacheln nicht mitreißen.
    geo.setIndex(new THREE.BufferAttribute(this.indices, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), buffers.boundingRadius);

    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.copy(center);
    return mesh;
  }

  dispose(): void {
    for (const root of this.roots) root.dispose();
    this.material.dispose();
  }
}
