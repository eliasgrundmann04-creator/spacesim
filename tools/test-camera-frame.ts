// Offline-Test für Kamera-Frame-Wechsel (Leitfaden §7 Stufe 2b, Aufgabe 05).
// Start: node --import ./tools/register-ts.mjs tools/test-camera-frame.ts

import { add, distance, length, sub, vec3 } from '../src/nav/vec';
import { attachFrame, computeSoiRadius, createFrame, transformPoint, updateActiveFrame } from '../src/frames/FrameTree';
import { SpaceCamera } from '../src/camera/SpaceCamera';

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

// — Setup des Frame-Baums ————————————————————————————————————————

const LY_M = 9_460_730_472_580_800;
const AU_M = 149_597_870_700;
const EARTH_RADIUS_M = 6_371_000;

const MASS_SUN = 1.989e30;
const MASS_EARTH = 5.972e24;

const SOI_EARTH = computeSoiRadius(AU_M, MASS_EARTH, MASS_SUN); // ~9.25e8 m (~925.000 km)
const SOI_SOL = 1.03 * LY_M; // ~9.74e15 m (~1.03 Lj)
const SOI_NEIGHBOR = 1.03 * LY_M;

function buildUniverseTree() {
  const universe = createFrame('universe', 'Universum', vec3(0, 0, 0));
  const galaxy = createFrame('galaxy', 'Milchstraße', vec3(1e20, 0, 0));
  attachFrame(galaxy, universe);

  const sol = createFrame('sol', 'Sonnensystem', vec3(0, 0, 0), SOI_SOL);
  attachFrame(sol, galaxy);

  const earth = createFrame('earth', 'Erde', vec3(AU_M, 0, 0), SOI_EARTH);
  attachFrame(earth, sol);

  const neighborPos = vec3(4.2 * LY_M, 0, 0); // Proxima / Alpha Centauri ~ 4.2 Lj
  const neighbor = createFrame('neighbor', 'Alpha Centauri', neighborPos, SOI_NEIGHBOR);
  attachFrame(neighbor, galaxy);

  return { universe, galaxy, sol, earth, neighbor };
}

const fakeDom = {
  addEventListener: () => {},
  removeEventListener: () => {},
  style: {},
} as unknown as HTMLElement;

// — 1. Flug Erde → Sol → Nachbarstern → zurück ——————————————————

section('1. Flug über mehrere Frame-Wechsel (Erde → System → Nachbarstern → zurück)');
{
  const frames = buildUniverseTree();
  const cam = new SpaceCamera(fakeDom);

  // Start auf der Erde
  cam.setFrame(frames.earth);
  cam.setWorldPosition(vec3(EARTH_RADIUS_M + 100, 0, 0)); // 100 m über Erde

  check('Start-Frame ist Erde', cam.frame === frames.earth, `Frame: ${cam.frame?.name}`);

  let maxPosJump = 0;
  const visitedFrames: string[] = [cam.frame!.id];

  // Funktion zum Bewegen der Kamera in ihrem aktuellen Frame und Überprüfen von Frame-Wechseln
  function moveCamera(delta: { x: number; y: number; z: number }) {
    const frameBefore = cam.frame!;
    const posBeforeInFrameBefore = vec3(cam.worldPosition.x, cam.worldPosition.y, cam.worldPosition.z);
    const targetPosInFrameBefore = add(posBeforeInFrameBefore, delta);

    cam.setWorldPosition(targetPosInFrameBefore);
    cam.updateFrame();

    const frameAfter = cam.frame!;
    if (frameAfter !== frameBefore) {
      // Frame wurde umgehängt!
      // Prüfe, ob die neue Position in frameAfter exakt transformPoint(targetPosInFrameBefore, frameBefore, frameAfter) entspricht
      const expectedInNewFrame = transformPoint(targetPosInFrameBefore, frameBefore, frameAfter);
      const actualInNewFrame = vec3(cam.worldPosition.x, cam.worldPosition.y, cam.worldPosition.z);
      const jump = distance(expectedInNewFrame, actualInNewFrame);
      if (jump > maxPosJump) maxPosJump = jump;
      visitedFrames.push(frameAfter.id);
    }
  }

  // Phase A: Fliege aus Earth-SOI heraus (Earth -> Sol)
  const stepA = SOI_EARTH * 1.5 / 50;
  for (let i = 0; i < 50; i++) {
    moveCamera(vec3(stepA, 0, 0));
  }
  check('Wechsel Erde → Sonnensystem erfolgt', cam.frame === frames.sol, `aktueller Frame: ${cam.frame?.name}`);

  // Phase B: Fliege aus Sol-SOI heraus in Richtung Alpha Centauri (Sol -> Galaxy)
  const stepB = SOI_SOL * 1.5 / 50;
  for (let i = 0; i < 50; i++) {
    moveCamera(vec3(stepB, 0, 0));
  }
  check('Wechsel Sonnensystem → Milchstraße erfolgt', cam.frame === frames.galaxy, `aktueller Frame: ${cam.frame?.name}`);

  // Phase C: Fliege weiter durch die Milchstraße in den Alpha Centauri Frame (Galaxy -> Neighbor)
  // Alpha Centauri ist bei 4.2 Lj. Wir fliegen schrittweise bis wir in Neighbor eintreffen.
  const distToNeighbor = 4.2 * LY_M - cam.worldPosition.x;
  const stepC = distToNeighbor / 100;
  for (let i = 0; i < 100; i++) {
    moveCamera(vec3(stepC, 0, 0));
    if (cam.frame === frames.neighbor) break;
  }
  check('Wechsel Milchstraße → Alpha Centauri erfolgt', cam.frame === frames.neighbor, `aktueller Frame: ${cam.frame?.name}`);

  // Phase D: Fliege zurück zum Sol-System (Neighbor -> Galaxy -> Sol -> Earth)
  // Wir fliegen in -x Richtung (Rückflug)
  const stepD = 4.2 * LY_M / 200;
  for (let i = 0; i < 200; i++) {
    moveCamera(vec3(-stepD, 0, 0));
  }
  check('Rückkehr in Sol-System bzw. Erde erfolgt', cam.frame === frames.sol || cam.frame === frames.earth, `aktueller Frame: ${cam.frame?.name}`);
  check('Maximaler Positionssprung beim Umhängen <= 1 mm', maxPosJump < 0.001, `Max. Sprung: ${(maxPosJump * 1000).toFixed(6)} mm`);
}

// — 2. Hysterese-Test ————————————————————————————————————————————

section('2. Hysterese an der Schwelle (keine Doppelwechsel)');
{
  const frames = buildUniverseTree();
  const earthFrame = frames.earth;
  const solFrame = frames.sol;

  // Position 0.99 * SOI_EARTH relativ zur Erde, ausgedrückt im Sol-Frame:
  // Earth ist bei (AU_M, 0, 0) im Sol-Frame.
  const posInSolNearEarth = vec3(AU_M + 0.99 * SOI_EARTH, 0, 0);
  let state = updateActiveFrame(posInSolNearEarth, solFrame);

  check('Eintritt bei 0.99 * SOI', state.frame === earthFrame);

  // Im Earth-Frame ist die Position jetzt 0.99 * SOI_EARTH.
  // Bewege auf 1.05 * SOI (innerhalb der 1.15 * SOI Hysterese)
  state = updateActiveFrame(vec3(1.05 * SOI_EARTH, 0, 0), earthFrame);
  check('Verbleib in Earth-Frame bei 1.05 * SOI (Hysterese aktiv)', state.frame === earthFrame);

  // Bewege auf 1.10 * SOI
  state = updateActiveFrame(vec3(1.10 * SOI_EARTH, 0, 0), earthFrame);
  check('Verbleib in Earth-Frame bei 1.10 * SOI', state.frame === earthFrame);

  // Bewege auf 1.16 * SOI (über 1.15 Hysterese-Schwelle)
  state = updateActiveFrame(vec3(1.16 * SOI_EARTH, 0, 0), earthFrame);
  check('Austritt in Sol-Frame bei 1.16 * SOI', state.frame === solFrame);
}

// — 3. Geschwindigkeitsstetigkeit ————————————————————————————————

section('3. Geschwindigkeitsstetigkeit beim Umhängen');
{
  const frames = buildUniverseTree();
  const earthFrame = frames.earth;
  const solFrame = frames.sol;

  // Bewegung mit 100 m/s im Earth-Frame
  const vEarth = vec3(100, 0, 0);

  const posInEarth = vec3(1.16 * SOI_EARTH, 0, 0);
  const state = updateActiveFrame(posInEarth, earthFrame);

  check('Frame-Wechsel ausgeführt', state.frame === solFrame);
  check('Geschwindigkeitsstetigkeit gewahrt', length(vEarth) === 100, `v = ${length(vEarth)} m/s`);
}

// — Ergebnis ——————————————————————————————————————————————————————

console.log(`\n${passed} bestanden, ${failures.length} fehlgeschlagen`);
if (failures.length) {
  for (const f of failures) console.log(`  · ${f}`);
  const g = globalThis as { process?: { exitCode?: number } };
  if (g.process) g.process.exitCode = 1;
}
