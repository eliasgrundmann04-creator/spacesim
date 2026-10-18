// Offline-Tests für den Frame-Baum (Leitfaden §7 Stufe 2a).
// Start: node --import ./tools/register-ts.mjs tools/test-frames.ts

import type { Vec3 } from '../src/nav/vec';
import { distance, length, sub, vec3 } from '../src/nav/vec';
import type { FrameNode } from '../src/frames/types';
import { attachFrame, createFrame, transformPoint } from '../src/frames/FrameTree';

// — Mini-Harness ————————————————————————————————————————————————

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

function section(title: string): void {
  console.log(`\n${title}`);
}

// — Exakte BigInt-Hilfsfunktionen ————————————————————————————————

interface BigVec3 {
  x: bigint;
  y: bigint;
  z: bigint;
}

const bigVec = (x: bigint, y: bigint = 0n, z: bigint = 0n): BigVec3 => ({ x, y, z });

function bigSub(a: BigVec3, b: BigVec3): BigVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function bigAdd(a: BigVec3, b: BigVec3): BigVec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function bigLengthFloat(v: BigVec3): number {
  const fx = Number(v.x);
  const fy = Number(v.y);
  const fz = Number(v.z);
  return Math.sqrt(fx * fx + fy * fy + fz * fz);
}

// — Test-Konstanten (exakte Ganzzahlen in Metern) ————————————————

const LY_M = 9_460_730_472_580_800n; // 1 Lj in m
const AU_M = 149_597_870_700n; // 1 AE in m
const R_EARTH_M = 6_371_000n; // Erdradius in m
const D_MOON_M = 384_400_000n; // Mondabstand in m

const GAL_POS_M = 100_000n * LY_M; // 100.000 Lj in m (9.4607304725808e20 m)
const SYS2_POS_M = bigVec(10n * LY_M, 5n * LY_M, 0n); // Zweites System 10 Lj entfernt

// — Baumstruktur aufbauen ————————————————————————————————————————

function buildUniverseTree() {
  const universe = createFrame('universe', 'Universum', vec3(0, 0, 0));
  const galaxy = createFrame('galaxy', 'Milchstraße', vec3(Number(GAL_POS_M), 0, 0));
  attachFrame(galaxy, universe);

  const solSystem = createFrame('sol', 'Sonnensystem', vec3(0, 0, 0));
  attachFrame(solSystem, galaxy);

  const sys2 = createFrame('sys2', 'Alpha Centauri', vec3(Number(SYS2_POS_M.x), Number(SYS2_POS_M.y), Number(SYS2_POS_M.z)));
  attachFrame(sys2, galaxy);

  const earth = createFrame('earth', 'Erde', vec3(Number(AU_M), 0, 0));
  attachFrame(earth, solSystem);

  const moon = createFrame('moon', 'Mond', vec3(Number(AU_M + D_MOON_M), 0, 0));
  attachFrame(moon, solSystem);

  return { universe, galaxy, solSystem, sys2, earth, moon };
}

// — 1. Nah bleibt nah ————————————————————————————————————————————

section('1. Nah bleibt nah (< 1 µm Fehler)');
{
  const { earth, moon } = buildUniverseTree();

  // Fels auf der Erde (Erdframe)
  const rockEarth = vec3(Number(R_EARTH_M), 0, 0);

  // Kamera 2 m über dem Fels, aber im Mondframe aufgehängt
  // Mond ist bei AU + D_MOON im System, Erde bei AU.
  // Kamera_Earth = (R_EARTH + 2, 0, 0)
  // Kamera_System = (AU + R_EARTH + 2, 0, 0)
  // Kamera_Moon = Kamera_System - Moon_System = (AU + R_EARTH + 2) - (AU + D_MOON) = R_EARTH + 2 - D_MOON
  const cameraMoonPos = vec3(Number(R_EARTH_M + 2n - D_MOON_M), 0, 0);

  // Umrechnen des Felsens vom Erdframe in den Mondframe
  const rockInMoonFrame = transformPoint(rockEarth, earth, moon);

  // Abstand Fels–Kamera im Mondframe
  const distF64 = distance(rockInMoonFrame, cameraMoonPos);

  // Exakte Wahrheit via BigInt
  const rockSystemBig = bigAdd(bigVec(AU_M), bigVec(R_EARTH_M));
  const moonSystemBig = bigAdd(bigVec(AU_M), bigVec(D_MOON_M));
  const cameraSystemBig = bigAdd(bigVec(AU_M), bigVec(R_EARTH_M + 2n));

  const rockMoonBig = bigSub(rockSystemBig, moonSystemBig);
  const cameraMoonBig = bigSub(cameraSystemBig, moonSystemBig);

  const diffExactBig = bigSub(rockMoonBig, cameraMoonBig);
  const distExact = bigLengthFloat(diffExactBig); // Exakt 2.0 m

  const errorMeters = Math.abs(distF64 - distExact);

  check(
    'Abstand Fels–Kamera auf < 1 µm genau',
    errorMeters < 1e-6,
    `gemessen ${distF64.toFixed(9)} m, exakt ${distExact.toFixed(1)} m, Fehler ${errorMeters.toExponential(3)} m (${(errorMeters * 1e6).toFixed(4)} µm)`
  );
}

// — 2. Fern bleibt relativ genau ——————————————————————————————————

section('2. Fern bleibt relativ genau (relativer Fehler < 10⁻¹²)');
{
  const { galaxy, earth } = buildUniverseTree();

  // Stern 100.000 Lj entfernt im Galaxieframe (z. B. am Ursprung des Universums)
  // Galaxie liegt bei +100.000 Lj in Universum, Stern bei -100.000 Lj im Galaxieframe
  const starGal = vec3(-Number(GAL_POS_M), 0, 0);

  // Umrechnung des Sterns in den Erdframe
  const starInEarth = transformPoint(starGal, galaxy, earth);

  // Kamera auf der Erde
  const cameraEarth = vec3(Number(R_EARTH_M), 0, 0);
  const distF64 = distance(starInEarth, cameraEarth);

  // Exakte BigInt-Rechnung:
  // Stern_Gal = -100.000 Lj
  // Stern_Universe = Gal_Universe + Stern_Gal = 100.000 Lj - 100.000 Lj = 0
  // Earth_Universe = Gal_Universe + Sol_Gal + Earth_Sol = 100.000 Lj + 0 + AU
  // Camera_Universe = Earth_Universe + Camera_Earth = 100.000 Lj + AU + R_EARTH
  // Dist_Exact = |Stern_Universe - Camera_Universe| = 100.000 Lj + AU + R_EARTH
  const distExactBig = GAL_POS_M + AU_M + R_EARTH_M;
  const distExact = Number(distExactBig);

  const relError = Math.abs(distF64 - distExact) / distExact;

  check(
    'Relativer Fehler der Stern-Entfernung < 10⁻¹²',
    relError < 1e-12,
    `gemessen ${distF64.toExponential(15)} m, exakt ${distExact.toExponential(15)} m, rel. Fehler ${relError.toExponential(3)}`
  );
}

// — 3. Roundtrip ————————————————————————————————————————————————

section('3. Roundtrip über ≥ 4 Frame-Wechsel');
{
  const { earth, solSystem, galaxy, sys2, moon } = buildUniverseTree();

  // a) Erde → System → Galaxie → anderes System → Galaxie → System → Erde
  const p0 = vec3(Number(R_EARTH_M), 100, 200);

  const p1 = transformPoint(p0, earth, solSystem);
  const p2 = transformPoint(p1, solSystem, galaxy);
  const p3 = transformPoint(p2, galaxy, sys2);
  const p4 = transformPoint(p3, sys2, galaxy);
  const p5 = transformPoint(p4, galaxy, solSystem);
  const p6 = transformPoint(p5, solSystem, earth);

  const mags = [length(p0), length(p1), length(p2), length(p3), length(p4), length(p5), length(p6)];
  const maxMag = Math.max(...mags);

  const errLong = distance(p6, p0);
  const eps = 2.2e-16;
  const bound = 4 * eps * maxMag;

  check(
    '4-Wechsel-Roundtrip (Erde → System → Galaxie → Sys2 → zurück) im Schranken-Limit',
    errLong <= bound,
    `Fehler ${errLong.toExponential(3)} m, Schranke ${bound.toExponential(3)} m (max Betrag ${maxMag.toExponential(3)} m)`
  );

  // b) Umweg nur über Nachbarframes (Erde → Mond → Erde)
  const pMoon0 = vec3(6_371_000, 0, 0);
  const pMoon1 = transformPoint(pMoon0, earth, moon);
  const pMoon2 = transformPoint(pMoon1, moon, earth);

  const errLocal = distance(pMoon2, pMoon0);

  check(
    'Nachbar-Roundtrip (Erde → Mond → Erde) < 1 µm',
    errLocal < 1e-6,
    `Fehler ${errLocal.toExponential(3)} m (${(errLocal * 1e6).toFixed(4)} µm)`
  );
}

// — 4. Gegenprobe ————————————————————————————————————————————————

section('4. Gegenprobe (Einziger Weltursprung versagt)');
{
  const { earth, moon } = buildUniverseTree();

  const rockEarth = vec3(Number(R_EARTH_M), 0, 0);
  const cameraMoonPos = vec3(Number(R_EARTH_M + 2n - D_MOON_M), 0, 0);

  // Naive Rechnung in absoluten F64-Weltkoordinaten bzgl. Universumsursprung:
  // Fels_Abs = Universe->Galaxy + Galaxy->Sol + Sol->Earth + Earth->Rock
  const galPos = Number(GAL_POS_M);
  const auPos = Number(AU_M);
  const dMoon = Number(D_MOON_M);
  const rEarth = Number(R_EARTH_M);

  const rockAbsX = galPos + 0 + auPos + rEarth; // ~9.460730472582359e20 m
  const cameraAbsX = galPos + 0 + (auPos + dMoon) + cameraMoonPos.x;

  const naiveDiff = Math.abs(rockAbsX - cameraAbsX); // f64 Subtraktion zweier ~9.46e20 Zahlen
  const exactDist = 2.0;

  const naiveError = Math.abs(naiveDiff - exactDist);

  check(
    'Naive absolute Koordinaten verfehlen 1 µm um viele Größenordnungen',
    naiveError > 1e-3, // 2.0 m Fehler = 2.000.000 µm, verfehlt 1 µm um 6 Größenordnungen
    `naiver Abstand ${naiveDiff.toFixed(1)} m, exakt ${exactDist.toFixed(1)} m, Fehler ${naiveError.toFixed(1)} m (${(naiveError / 1e-6).toExponential(2)} × µm-Limit)`
  );
}

// — 5. Bewegte Frames ————————————————————————————————————————————

section('5. Bewegte Frames (Ursprungsverschiebung)');
{
  const { solSystem, earth, moon } = buildUniverseTree();

  const localEarthPosBefore = vec3(earth.position.x, earth.position.y, earth.position.z);
  const pLocal = vec3(100, 200, 300);

  // Systemframe wird verschoben (z. B. System folgt seinem Stern um 1.000.000 m)
  const shift = vec3(1_000_000, -500_000, 2_000_000);
  solSystem.position = sub(solSystem.position, shift); // Verschiebung im Galaxieframe

  // 1. Lokale Positionen in Kindframes bleiben absolut unverändert
  const earthPosUnchanged = earth.position.x === localEarthPosBefore.x && earth.position.y === localEarthPosBefore.y;
  check('Kindframe-Position bleibt lokal unverändert', earthPosUnchanged);

  // 2. Umrechnung zwischen Kindframes desselben verschobenen Elternframes bleibt unverändert
  const pMoon = transformPoint(pLocal, earth, moon);
  const pEarthBack = transformPoint(pMoon, moon, earth);
  const relDiff = distance(pEarthBack, pLocal);

  check('Umrechnung in Kindframes folgt der Bewegung nahtlos', relDiff < 1e-9, `Drift ${relDiff.toExponential(3)} m`);
}

// — Ergebnis ——————————————————————————————————————————————————————

console.log(`\n${passed} bestanden, ${failures.length} fehlgeschlagen`);
if (failures.length) {
  for (const f of failures) console.log(`  · ${f}`);
  const g = globalThis as { process?: { exitCode?: number } };
  if (g.process) g.process.exitCode = 1;
}
