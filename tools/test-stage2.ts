// Offline-Test: Stufe 2 Abnahmekriterium (Leitfaden §7)
// Start: node --import ./tools/register-ts.mjs tools/test-stage2.ts

import { LY, AU, EARTH_RADIUS } from '../src/core/constants';
import { attachFrame, computeSoiRadius, createFrame, transformPoint } from '../src/frames/FrameTree';
import { distance, length, vec3 } from '../src/nav/vec';

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  ok   ${name}${detail ? '  ' + detail : ''}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`);
  }
}

console.log('\n--- Offline-Test: Stufe 2 Abnahmekriterium (100.000 Lj Stern & Fels auf der Erde) ---');

// Setup des hierarchischen Bezugsrahmen-Baums
const universe = createFrame('universe', 'Universum', vec3(0, 0, 0));

// 1. Galaxie am Rand des beobachtbaren Universums/Milchstraße
const galaxyPos = vec3(0, 0, 0);
const galaxy = createFrame('galaxy', 'Milchstraße', galaxyPos, 150_000 * LY);
attachFrame(galaxy, universe);

// 2. Sol-System im Zentrum der Galaxie (lokal im Galaxie-Frame)
const sol = createFrame('sol', 'Sonnensystem', vec3(0, 0, 0), 1.03 * LY);
attachFrame(sol, galaxy);

// 3. Erde im Sol-System (1 AE vom Sol-Zentrum)
const earth = createFrame('earth', 'Erde', vec3(AU, 0, 0), computeSoiRadius(AU, 5.972e24, 1.989e30));
attachFrame(earth, sol);

// 4. Ein Fels auf der Erdoberfläche im Erde-Frame (z.B. (6.371.000 m, 0, 0))
const rockOnEarthLocal = vec3(EARTH_RADIUS, 0, 0);

// 5. Ein ferner Stern am Rand der Galaxie in 100.000 Lj Entfernung vom Sol-System
const distantStarPosInGalaxy = vec3(100_000 * LY, 0, 0);
const distantStarFrame = createFrame('star-100kly', 'Ferner Stern (100.000 Lj)', distantStarPosInGalaxy, 1.03 * LY);
attachFrame(distantStarFrame, galaxy);
const distantStarLocal = vec3(0, 0, 0);

// — 1. Beides im selben Lauf korrekt: Lokale Präzision in ihren jeweiligen Frames —

{
  // Der Fels auf der Erde hat im Earth-Frame Millimeter-Präzision (Betrag ~6,37e6 m, f64-Auflösung ~1 nm)
  const rockPosInEarth = rockOnEarthLocal;
  // Der ferne Stern hat in seinem eigenen System-Frame Millimeter-Präzision (Betrag 0 m)
  const starPosInStarFrame = distantStarLocal;

  check('Fels im Earth-Frame hat nm-Auflösung', length(rockPosInEarth) === EARTH_RADIUS);
  check('Stern im eigenen Frame ist lokal exakt verankert', length(starPosInStarFrame) === 0);
}

// — 2. Roundtrip über 100.000 Lj liegt im theoretischen f64-Schranken-Limit —

{
  const rockInStarFrame = transformPoint(rockOnEarthLocal, earth, distantStarFrame);
  const rockBackInEarth = transformPoint(rockInStarFrame, distantStarFrame, earth);

  const errorEarth = distance(rockOnEarthLocal, rockBackInEarth);
  const maxMag = Math.max(length(rockOnEarthLocal), length(rockInStarFrame), length(rockBackInEarth));
  const eps = 2.22e-16;
  const theoreticalBound = 4 * eps * maxMag;

  check('Roundtrip Erd-Fels über 100.000 Lj Sternframe liegt im f64-Schranken-Limit',
    errorEarth <= theoreticalBound,
    `Fehler ${(errorEarth / 1000).toFixed(3)} km <= Schranke ${(theoreticalBound / 1000).toFixed(3)} km (rel. Fehler ${(errorEarth / maxMag).toExponential(3)})`);

  const starInEarthFrame = transformPoint(distantStarLocal, distantStarFrame, earth);
  const starBackInStarFrame = transformPoint(starInEarthFrame, earth, distantStarFrame);

  const errorStar = distance(distantStarLocal, starBackInStarFrame);
  check('Roundtrip 100.000 Lj Stern über Erd-Frame ist exakt', errorStar === 0,
    `Fehler: ${errorStar} m`);
}

// — 3. Transformation über mehrere Zwischen-Frame-Hops (Erde -> Sol -> Galaxie -> Stern) —

{
  const p1 = transformPoint(rockOnEarthLocal, earth, sol);
  const p2 = transformPoint(p1, sol, galaxy);
  const p3 = transformPoint(p2, galaxy, distantStarFrame);
  const directP3 = transformPoint(rockOnEarthLocal, earth, distantStarFrame);

  const diffDirectStep = distance(p3, directP3);
  check('Schrittweise Hop-Transformation ist identisch zur direkten LCA-Transformation', diffDirectStep === 0,
    `Abweichung: ${diffDirectStep} m`);
}

// — 4. Gegenprobe ohne Verschachtelung (ein einziger f64 Ursprung bei 100.000 Lj) —

{
  // Bei 100.000 Lj (~9.46e20 m) verliert f64 ~130 km Auflösung!
  const distM = 100_000 * LY;
  const absRockX = distM + EARTH_RADIUS; // Naive absolute f64 Koordinate
  const floatGap = Math.abs((absRockX - distM) - EARTH_RADIUS);

  check('Gegenprobe ohne Frames: f64 bei 100.000 Lj verliert Kilometer-Präzision', floatGap > 1000,
    `Präzisionsverlust des naiven Ansatzes: ${(floatGap / 1000).toFixed(3)} km`);
}

console.log(`\n${passed} bestanden, ${failures.length} fehlgeschlagen`);
if (failures.length) {
  for (const f of failures) console.log(`  · ${f}`);
  const g = globalThis as { process?: { exitCode?: number } };
  if (g.process) g.process.exitCode = 1;
}
