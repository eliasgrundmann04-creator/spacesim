import { AU, DEG, LY } from '../core/constants';
import { Vector3d } from '../math/Vector3d';
import { Rng, hash32, hashString } from '../math/rng';
import { Orbit, OrbitalElements } from '../physics/Kepler';
import type { SceneManager } from '../core/SceneManager';
import type { TerrainParams } from '../terrain/tileGeometry';
import type { FrameNode } from '../frames/types';
import { attachFrame, computeSoiRadius, createFrame } from '../frames/FrameTree';
import { vec3 } from '../nav/vec';
import { CelestialBody } from './CelestialBody';
import { Star } from './Star';
import { Planet } from './Planet';
import { generateStar, generatePlanets } from './procedural';
import catalogData from '../data/catalog.json';

/**
 * Hybrider Welten-Manager.
 *
 * Beide Quellen — realer JSON-Katalog und prozedurale Generierung — münden
 * in dasselbe CelestialBody-Interface. Ab der Instanziierung sind sie für
 * Renderer, Physik und Kamera ununterscheidbar; genau das macht die Naht
 * unsichtbar.
 *
 *  Katalog:    deklarative Bahnelemente (AE/Grad) → Orbit-Objekte.
 *  Prozedural: deterministisches Gitter galaktischer Zellen; Zellseed =
 *              hash32(ix, iy, iz). Sterne entstehen sofort (als Lichtpunkte
 *              sichtbar), ihre Planetensysteme erst lazy bei Annäherung
 *              oder Fokussierung — Speicher ~ O(besuchte Systeme), nicht
 *              O(Universum).
 */

interface CatalogOrbit {
  a_au: number; e: number; i_deg: number;
  Omega_deg: number; omega_deg: number; M0_deg: number;
}

interface CatalogBodyDef {
  name: string;
  type: 'star' | 'rocky' | 'gas';
  mass: number;
  radius: number;
  temperature?: number;
  luminosity?: number;
  orbit?: CatalogOrbit;
  terrain?: Partial<TerrainParams>;
  gasPalette?: 'jovian' | 'neptunian';
  children?: CatalogBodyDef[];
}

const TERRAIN_DEFAULTS: TerrainParams = {
  amplitude: 0.003,
  frequency: 1.8,
  octaves: 5,
  ocean: false,
  oceanLevel: 0,
  palette: 'gray',
  maxDepth: 14,
  resolution: 16,
};

const GRID_CELL = 4 * LY;
const STAR_PROBABILITY = 0.3;        // ⇒ ≈ 0.005 Sterne/Lj³, nahe realer Dichte
const POPULATE_DISTANCE = 0.25 * LY; // Systeme lazy instanziieren bei Annäherung

export class UniverseManager {
  private readonly roots: CelestialBody[] = [];
  private readonly proceduralStars: Star[] = [];

  readonly universeFrame: FrameNode = createFrame('universe', 'Universum', vec3(0, 0, 0));
  readonly galaxyFrame: FrameNode = createFrame('galaxy', 'Milchstraße', vec3(0, 0, 0));

  constructor(private readonly sceneManager: SceneManager) {
    attachFrame(this.galaxyFrame, this.universeFrame);
  }

  // ---------------------------------------------------------------- Katalog

  loadCatalog(): void {
    const solFrame = createFrame('sol', 'Sonnensystem', vec3(0, 0, 0), 1.03 * LY);
    attachFrame(solFrame, this.galaxyFrame);

    const root = this.buildFromDef(catalogData as CatalogBodyDef, null, solFrame);
    this.roots.push(root);
    this.sceneManager.addSystem(root);
  }

  private buildFromDef(def: CatalogBodyDef, parent: CelestialBody | null, parentFrame: FrameNode): CelestialBody {
    const seed = hashString(def.name);
    let body: CelestialBody;

    let bodyFrame: FrameNode = parentFrame;

    if (def.type === 'star') {
      body = new Star({
        name: def.name, type: 'star', mass: def.mass, radius: def.radius, seed,
        temperature: def.temperature ?? 5772,
        luminosity: def.luminosity ?? 3.828e26,
      });
      body.frame = parentFrame;
    } else {
      body = new Planet({
        name: def.name, type: def.type, mass: def.mass, radius: def.radius, seed,
        terrain: def.type === 'rocky' ? { ...TERRAIN_DEFAULTS, ...def.terrain } : undefined,
        gasPalette: def.gasPalette,
      });

      if (def.orbit && parent) {
        const a = def.orbit.a_au * AU;
        const soi = computeSoiRadius(a, def.mass, parent.mass);
        bodyFrame = createFrame(`f-${def.name}`, def.name, vec3(0, 0, 0), soi);
        attachFrame(bodyFrame, parentFrame);
        body.frame = bodyFrame;
      } else {
        body.frame = parentFrame;
      }
    }

    if (parent && def.orbit) {
      const o = def.orbit;
      const elements: OrbitalElements = {
        a: o.a_au * AU,
        e: o.e,
        i: o.i_deg * DEG,
        Omega: o.Omega_deg * DEG,
        omega: o.omega_deg * DEG,
        M0: o.M0_deg * DEG,
        epoch: 0,
      };
      body.attachTo(parent, new Orbit(elements, parent.mass));
    }

    for (const childDef of def.children ?? []) this.buildFromDef(childDef, body, bodyFrame);
    return body;
  }

  // ------------------------------------------------------------- Prozedural

  /** Erzeugt die geseedete Sternnachbarschaft im Umkreis (Sterne sofort, Systeme lazy). */
  generateNeighborhood(radius: number): void {
    const n = Math.ceil(radius / GRID_CELL);
    for (let ix = -n; ix <= n; ix++) {
      for (let iy = -n; iy <= n; iy++) {
        for (let iz = -n; iz <= n; iz++) {
          if (ix === 0 && iy === 0 && iz === 0) continue; // Zelle des Sol-Systems

          const seed = hash32(ix, iy, iz, 0x5a1a11);
          const rng = new Rng(seed);
          if (rng.float() >= STAR_PROBABILITY) continue;

          const px = (ix + rng.float(-0.45, 0.45)) * GRID_CELL;
          const py = (iy + rng.float(-0.45, 0.45)) * GRID_CELL;
          const pz = (iz + rng.float(-0.45, 0.45)) * GRID_CELL;
          if (px * px + py * py + pz * pz > radius * radius) continue;

          const p = generateStar(rng);
          const starName = `PSC-${seed.toString(36).slice(0, 5).toUpperCase()}`;
          const sysFrame = createFrame(`f-${starName}`, starName, vec3(px, py, pz), 1.03 * LY);
          attachFrame(sysFrame, this.galaxyFrame);

          const star = new Star({
            name: starName,
            type: 'star', seed,
            mass: p.mass, radius: p.radius,
            temperature: p.temperature, luminosity: p.luminosity,
          });
          star.frame = sysFrame;
          star.systemSeed = hash32(seed, 0xbeef);
          star.populated = false;

          this.roots.push(star);
          this.proceduralStars.push(star);
          this.sceneManager.addBody(star);
        }
      }
    }
  }

  /** Instanziiert das Planetensystem eines prozeduralen Sterns (idempotent). */
  populateSystem(body: CelestialBody): void {
    if (!(body instanceof Star) || body.populated || body.systemSeed === null) return;
    body.populated = true;

    const rng = new Rng(body.systemSeed);
    const defs = generatePlanets(body.name, {
      mass: body.mass, radius: body.radius,
      luminosity: body.luminosity, temperature: body.temperature,
    }, rng);

    const parentFrame = body.frame ?? this.galaxyFrame;
    for (const d of defs) {
      const soi = computeSoiRadius(d.elements.a, d.mass, body.mass);
      const planetFrame = createFrame(`f-${d.name}`, d.name, vec3(0, 0, 0), soi);
      attachFrame(planetFrame, parentFrame);

      const planet = new Planet({
        name: d.name, type: d.type, mass: d.mass, radius: d.radius,
        seed: hash32(body.systemSeed, d.name.length, Math.round(d.elements.a / 1e6)),
        terrain: d.terrain ?? undefined,
        gasPalette: d.gasPalette,
      });
      planet.frame = planetFrame;
      planet.attachTo(body, new Orbit(d.elements, body.mass));
      this.sceneManager.addBody(planet);
    }
  }

  // ------------------------------------------------------------------ Tick

  /** Propagiert alle Systeme und triggert Lazy-Instanziierung bei Annäherung. */
  update(simTime: number, cameraPos: Vector3d): void {
    for (const star of this.proceduralStars) {
      if (!star.populated && cameraPos.distanceTo(star.position) < POPULATE_DISTANCE) {
        this.populateSystem(star);
      }
    }
    for (const root of this.roots) root.updateHierarchy(simTime);
  }

  findBody(name: string): CelestialBody | null {
    for (const root of this.roots) {
      for (const b of root.traverse()) if (b.name === name) return b;
    }
    return null;
  }
}
