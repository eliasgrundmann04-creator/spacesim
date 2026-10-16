import {
  AU, DEG, EARTH_MASS, EARTH_RADIUS, JUPITER_RADIUS,
  SOLAR_LUMINOSITY, SOLAR_MASS, SOLAR_RADIUS, SOLAR_TEMPERATURE,
} from '../core/constants';
import { Rng } from '../math/rng';
import type { OrbitalElements } from '../physics/Kepler';
import type { TerrainParams } from '../terrain/PlanetLOD';

/**
 * Prozedurale Systemgenerierung — physikalisch plausibel statt fotorealistisch:
 *
 *  Stern:  Masse log-flach (grobe IMF-Näherung), dann Hauptreihen-Relationen
 *          L ∝ M^3.5, R ∝ M^0.8, T = T☉ · (L/R²)^0.25.
 *  System: geometrische Abstandsleiter (Titius-Bode-artig), Riesenplaneten
 *          bevorzugt jenseits der Frostlinie a_frost ≈ 2.7 AE · √(L/L☉),
 *          Radien aus stückweiser Masse-Radius-Relation, Oberflächentyp aus
 *          der Gleichgewichtstemperatur T_eq = 278 K · (L/L☉)^0.25 / √(a/AE).
 *
 * Alles deterministisch: gleicher Rng-Seed ⇒ identisches System.
 */

export interface ProcStar {
  mass: number;
  radius: number;
  luminosity: number;
  temperature: number;
}

export interface ProcPlanetDef {
  name: string;
  type: 'rocky' | 'gas';
  mass: number;
  radius: number;
  elements: OrbitalElements;
  terrain: TerrainParams | null;
  gasPalette: 'jovian' | 'neptunian';
}

export function generateStar(rng: Rng): ProcStar {
  const m = rng.logUniform(0.12, 6); // in M☉
  const L = Math.pow(m, 3.5);
  const R = Math.pow(m, 0.8);
  const T = SOLAR_TEMPERATURE * Math.pow(L / (R * R), 0.25);
  return {
    mass: m * SOLAR_MASS,
    radius: R * SOLAR_RADIUS,
    luminosity: L * SOLAR_LUMINOSITY,
    temperature: T,
  };
}

/** Stückweise Masse-Radius-Relation (Masse in M⊕, Radius in m). An den Nahtstellen stetig. */
function massToRadius(massEarth: number): number {
  if (massEarth < 2.5) return EARTH_RADIUS * Math.pow(massEarth, 0.28);
  if (massEarth < 130) return EARTH_RADIUS * 0.78 * Math.pow(massEarth, 0.55);
  return JUPITER_RADIUS * Math.pow(massEarth / 318, 0.02); // Entartung: R ≈ const
}

export function generatePlanets(starName: string, star: ProcStar, rng: Rng): ProcPlanetDef[] {
  const Lrel = star.luminosity / SOLAR_LUMINOSITY;
  const frostLine = 2.7 * AU * Math.sqrt(Lrel);
  const count = rng.int(0, 8);

  let a = AU * rng.float(0.05, 0.4) * Math.max(0.3, Math.sqrt(Lrel));
  const planets: ProcPlanetDef[] = [];

  for (let k = 0; k < count; k++) {
    a *= rng.float(1.45, 2.05); // geometrische Abstandsleiter

    const beyondFrost = a > frostLine;
    const isGiantSlot = rng.float() < (beyondFrost ? 0.45 : 0.08);
    const massEarth = isGiantSlot ? rng.logUniform(15, 3000) : rng.logUniform(0.03, 6);
    const type: 'rocky' | 'gas' = massEarth > 8 ? 'gas' : 'rocky';
    const radius = massToRadius(massEarth);
    const Teq = 278 * Math.pow(Lrel, 0.25) / Math.sqrt(a / AU);

    const elements: OrbitalElements = {
      a,
      e: rng.float() ** 2 * 0.12,          // meist fast kreisförmig
      i: rng.float() ** 2 * 5 * DEG,       // flache Systemebene
      Omega: rng.angle(),
      omega: rng.angle(),
      M0: rng.angle(),
      epoch: 0,
    };

    let terrain: TerrainParams | null = null;
    if (type === 'rocky') {
      const ocean = Teq > 235 && Teq < 330 && massEarth > 0.3 && rng.float() < 0.75;
      const palette = ocean
        ? 'earth'
        : Teq > 340 ? 'desert'
        : Teq < 190 ? 'ice'
        : rng.float() < 0.5 ? 'red' : 'gray';
      terrain = {
        amplitude: rng.float(0.0015, 0.006) / Math.cbrt(Math.max(1, massEarth)),
        frequency: rng.float(1.2, 2.6),
        octaves: 5,
        ocean,
        oceanLevel: rng.float(-0.15, 0.15),
        palette,
        maxDepth: 13,
        resolution: 16,
      };
    }

    planets.push({
      name: `${starName} ${String.fromCharCode(98 + k)}`, // b, c, d, …
      type,
      mass: massEarth * EARTH_MASS,
      radius,
      elements,
      terrain,
      gasPalette: Teq < 120 ? 'neptunian' : 'jovian',
    });
  }

  return planets;
}
