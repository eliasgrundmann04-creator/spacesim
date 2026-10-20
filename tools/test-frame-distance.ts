// Offline-Test: Frame-Abstand für Systeme und Körper (Leitfaden §7, Aufgabe 21).
// Start: node --import ./tools/register-ts.mjs tools/test-frame-distance.ts

import { AU, EARTH_RADIUS, LY } from '../src/core/constants';
import { attachFrame, cameraInBodyFrame, computeSoiRadius, createFrame, transformPoint } from '../src/frames/FrameTree';
import type { FrameNode } from '../src/frames/types';
import { hash32 } from '../src/math/rng';
import { Vector3d } from '../src/math/Vector3d';
import { distance, vec3 } from '../src/nav/vec';

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

const POPULATE_DISTANCE = 0.25 * LY;
const GRID_CELL = 4 * LY;
const STAR_PROBABILITY = 0.3;

// Minimaler Nachbau von Himmelskörpern mit eigener Frame-Zuordnung
interface MockBody {
  name: string;
  position: Vector3d; // Lokale Position in ihrem Frame
  frame: FrameNode;
}

function buildSceneGraph() {
  const universeFrame = createFrame('universe', 'Universum', vec3(0, 0, 0));
  const galaxyFrame = createFrame('galaxy', 'Milchstraße', vec3(0, 0, 0));
  attachFrame(galaxyFrame, universeFrame);

  const solFrame = createFrame('sol', 'Sonnensystem', vec3(0, 0, 0), 1.03 * LY);
  attachFrame(solFrame, galaxyFrame);

  // Erde
  const earthSoi = computeSoiRadius(AU, 5.972e24, 1.989e30);
  const earthFrame = createFrame('f-Erde', 'Erde', vec3(AU, 0, 0), earthSoi);
  attachFrame(earthFrame, solFrame);
  const earthBody: MockBody = { name: 'Erde', position: new Vector3d(0, 0, 0), frame: earthFrame };

  // Mond (im Earth-Frame)
  const moonDist = 384_400_000;
  const moonSoi = computeSoiRadius(moonDist, 7.342e22, 5.972e24);
  const moonFrame = createFrame('f-Mond', 'Mond', vec3(moonDist, 0, 0), moonSoi);
  attachFrame(moonFrame, earthFrame);
  const moonBody: MockBody = { name: 'Mond', position: new Vector3d(0, 0, 0), frame: moonFrame };

  // Venus (0.723 AU)
  const venusDist = 0.723 * AU;
  const venusSoi = computeSoiRadius(venusDist, 4.867e24, 1.989e30);
  const venusFrame = createFrame('f-Venus', 'Venus', vec3(venusDist, 0, 0), venusSoi);
  attachFrame(venusFrame, solFrame);
  const venusBody: MockBody = { name: 'Venus', position: new Vector3d(0, 0, 0), frame: venusFrame };

  // Mars (1.524 AU)
  const marsDist = 1.524 * AU;
  const marsSoi = computeSoiRadius(marsDist, 6.417e23, 1.989e30);
  const marsFrame = createFrame('f-Mars', 'Mars', vec3(marsDist, 0, 0), marsSoi);
  attachFrame(marsFrame, solFrame);
  const marsBody: MockBody = { name: 'Mars', position: new Vector3d(0, 0, 0), frame: marsFrame };

  // 80 Stern-Frames in 16 Lj Umkreis generieren
  const starFrames: FrameNode[] = [];
  const radius = 16 * LY;
  const n = Math.ceil(radius / GRID_CELL);
  for (let ix = -n; ix <= n; ix++) {
    for (let iy = -n; iy <= n; iy++) {
      for (let iz = -n; iz <= n; iz++) {
        if (ix === 0 && iy === 0 && iz === 0) continue;
        const seed = hash32(ix, iy, iz, 0x5a1a11);
        // mulberry32 aus rng.ts nachstellen
        let a = seed >>> 0;
        const rngFloat = () => {
          a |= 0;
          a = (a + 0x6d2b79f5) | 0;
          let t = Math.imul(a ^ (a >>> 15), 1 | a);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };

        if (rngFloat() >= STAR_PROBABILITY) continue;

        const px = (ix + (rngFloat() * 0.9 - 0.45)) * GRID_CELL;
        const py = (iy + (rngFloat() * 0.9 - 0.45)) * GRID_CELL;
        const pz = (iz + (rngFloat() * 0.9 - 0.45)) * GRID_CELL;
        if (px * px + py * py + pz * pz > radius * radius) continue;

        const starName = `PSC-${seed.toString(36).slice(0, 5).toUpperCase()}`;
        const sysFrame = createFrame(`f-${starName}`, starName, vec3(px, py, pz), 1.03 * LY);
        attachFrame(sysFrame, galaxyFrame);
        starFrames.push(sysFrame);
      }
    }
  }

  return {
    universeFrame,
    galaxyFrame,
    solFrame,
    earthFrame,
    earthBody,
    moonFrame,
    moonBody,
    venusFrame,
    venusBody,
    marsFrame,
    marsBody,
    starFrames,
  };
}

function countNearSystems(
  cameraPos: Vector3d,
  cameraFrame: FrameNode | null,
  galaxyFrame: FrameNode,
  starFrames: FrameNode[],
): number {
  let count = 0;
  const camPosVec3 = { x: cameraPos.x, y: cameraPos.y, z: cameraPos.z };
  for (const starFrame of starFrames) {
    const camInStar = cameraInBodyFrame(camPosVec3, cameraFrame, starFrame, galaxyFrame);
    // Sternposition in seinem eigenen Frame ist (0,0,0)
    const dist = Math.sqrt(camInStar.x * camInStar.x + camInStar.y * camInStar.y + camInStar.z * camInStar.z);
    if (dist < POPULATE_DISTANCE) count++;
  }
  return count;
}

function computeBodyCamDistance(
  body: MockBody,
  cameraPos: Vector3d,
  cameraFrame: FrameNode,
): number {
  // Entspricht SceneManager.syncToCamera:
  const bodyInCamFrame = transformPoint(
    { x: body.position.x, y: body.position.y, z: body.position.z },
    body.frame,
    cameraFrame,
  );
  const relX = bodyInCamFrame.x - cameraPos.x;
  const relY = bodyInCamFrame.y - cameraPos.y;
  const relZ = bodyInCamFrame.z - cameraPos.z;

  const camPosInBodyFrame = vec3(
    body.position.x - relX,
    body.position.y - relY,
    body.position.z - relZ,
  );

  return Math.sqrt(camPosInBodyFrame.x * camPosInBodyFrame.x + camPosInBodyFrame.y * camPosInBodyFrame.y + camPosInBodyFrame.z * camPosInBodyFrame.z);
}

// — 1. Bevölkern ————————————————————————————————————————————————

section('1. Bevölkern über Frame-Abstände');
{
  const graph = buildSceneGraph();
  check('80 Sternframes im 16-Lj-Umkreis aufgebaut', graph.starFrames.length === 80, `Anzahl: ${graph.starFrames.length}`);

  // Kamera im Erdframe, 3 Erdradien vom Zentrum
  const camAtEarth = new Vector3d(3 * EARTH_RADIUS, 0, 0);
  const nearCountAtEarth = countNearSystems(camAtEarth, graph.earthFrame, graph.galaxyFrame, graph.starFrames);
  check('Kamera an der Erde: 0 prozedurale Systeme gelten als nah', nearCountAtEarth === 0, `Gefunden: ${nearCountAtEarth}`);

  // Kamera 0,2 Lj vor einem PSC-Stern (Kamera im Galaxie-Frame)
  const targetStarFrame = graph.starFrames[0];
  const starPosInGalaxy = targetStarFrame.position; // Position des Sternframes in der Galaxie
  const camInGalaxyNearStar = new Vector3d(starPosInGalaxy.x - 0.2 * LY, starPosInGalaxy.y, starPosInGalaxy.z);
  const nearInGalaxy = countNearSystems(camInGalaxyNearStar, graph.galaxyFrame, graph.galaxyFrame, graph.starFrames);
  check('Kamera 0,2 Lj vor Stern (im Galaxie-Frame): genau 1 System nah', nearInGalaxy === 1, `Gefunden: ${nearInGalaxy}`);

  // Kamera 0,2 Lj vor demselben Stern (Kamera im Stern-Frame)
  const camInStarFrame = new Vector3d(-0.2 * LY, 0, 0);
  const nearInStar = countNearSystems(camInStarFrame, targetStarFrame, graph.galaxyFrame, graph.starFrames);
  check('Kamera 0,2 Lj vor Stern (im Stern-Frame): genau 1 System nah', nearInStar === 1, `Gefunden: ${nearInStar}`);
}

// — 2. Abstand im Körper ————————————————————————————————————————

section('2. Abstand im Körper (Erde, Mond, Venus, Mars)');
{
  const graph = buildSceneGraph();
  // Kamera im Erdframe, 3 Erdradien vom Zentrum: (3 * EARTH_RADIUS, 0, 0)
  const camPos = new Vector3d(3 * EARTH_RADIUS, 0, 0);
  const camFrame = graph.earthFrame;

  // Echte geometrische Abstände von der Kamera (1 AU + 3 Erdradien, 0, 0) im Sol-Frame:
  // Kamera im Sol-Frame = (AU + 3 * EARTH_RADIUS, 0, 0)
  const camSolX = AU + 3 * EARTH_RADIUS;

  // Erde Origin = (AU, 0, 0) in Sol => Abstand = 3 * EARTH_RADIUS
  const trueDistEarth = 3 * EARTH_RADIUS;
  // Mond Origin = (AU + 384_400_000, 0, 0) in Sol => Abstand = |(AU + 384.4e6) - camSolX| = |384.4e6 - 3*EARTH_RADIUS|
  const trueDistMoon = Math.abs(384_400_000 - 3 * EARTH_RADIUS);
  // Venus Origin = (0.723 AU, 0, 0) in Sol => Abstand = |0.723 AU - camSolX|
  const trueDistVenus = Math.abs(0.723 * AU - camSolX);
  // Mars Origin = (1.524 AU, 0, 0) in Sol => Abstand = |1.524 AU - camSolX|
  const trueDistMars = Math.abs(1.524 * AU - camSolX);

  const calcEarth = computeBodyCamDistance(graph.earthBody, camPos, camFrame);
  const calcMoon = computeBodyCamDistance(graph.moonBody, camPos, camFrame);
  const calcVenus = computeBodyCamDistance(graph.venusBody, camPos, camFrame);
  const calcMars = computeBodyCamDistance(graph.marsBody, camPos, camFrame);

  const errEarth = Math.abs(calcEarth - trueDistEarth) / trueDistEarth;
  const errMoon = Math.abs(calcMoon - trueDistMoon) / trueDistMoon;
  const errVenus = Math.abs(calcVenus - trueDistVenus) / trueDistVenus;
  const errMars = Math.abs(calcMars - trueDistMars) / trueDistMars;

  check('Abstand für Erde korrekt (rel. Fehler < 10⁻⁹)', errEarth < 1e-9, `rel. Fehler: ${errEarth.toExponential(4)}`);
  check('Abstand für Mond korrekt (rel. Fehler < 10⁻⁹)', errMoon < 1e-9, `rel. Fehler: ${errMoon.toExponential(4)}`);
  check('Abstand für Venus korrekt (rel. Fehler < 10⁻⁹)', errVenus < 1e-9, `rel. Fehler: ${errVenus.toExponential(4)}`);
  check('Abstand für Mars korrekt (rel. Fehler < 10⁻⁹)', errMars < 1e-9, `rel. Fehler: ${errMars.toExponential(4)}`);
}

// — 3. Gegenprobe ————————————————————————————————————————————————

section('3. Gegenprobe (bisheriger naiver Weg)');
{
  const graph = buildSceneGraph();
  const camPosAtEarth = new Vector3d(3 * EARTH_RADIUS, 0, 0);

  // Naiver Weg für Systeme: `cameraPos.distanceTo(star.position) < POPULATE_DISTANCE`
  // Da star.position = (0,0,0) in seinem Frame, ist distanceTo(camPosAtEarth) = |camPosAtEarth| = 3 * EARTH_RADIUS (~1.91e7 m)
  let naiveNearCount = 0;
  for (const sf of graph.starFrames) {
    const starPosInStarFrame = new Vector3d(0, 0, 0);
    if (camPosAtEarth.distanceTo(starPosInStarFrame) < POPULATE_DISTANCE) naiveNearCount++;
  }
  check('Gegenprobe Bevölkern: Naiver Weg liefert 80 nahe Systeme', naiveNearCount === 80, `Gefunden: ${naiveNearCount}`);

  // Naiver Weg für Venus: `cameraPos - venus.position`
  // venus.position = (0,0,0) => naive Distanz = |camPosAtEarth| = 3 * EARTH_RADIUS (~1.9113e7 m)
  const naiveVenusDist = camPosAtEarth.distanceTo(graph.venusBody.position);
  check('Gegenprobe Venus: Naiver Weg liefert 1.91·10⁷ m', Math.abs(naiveVenusDist - 3 * EARTH_RADIUS) < 1, `Naiv: ${naiveVenusDist.toExponential(4)} m`);
}

// — 4. Ohne Kameraframe ——————————————————————————————————————————

section('4. Ohne Kameraframe (erster Aufruf in Engine.init)');
{
  const graph = buildSceneGraph();
  const camPosAtEarth = new Vector3d(3 * EARTH_RADIUS, 0, 0);

  // Kameraframe null => cameraInBodyFrame nutzt galaxyFrame als Fallback
  const countNullFrame = countNearSystems(camPosAtEarth, null, graph.galaxyFrame, graph.starFrames);
  check('Ohne Kameraframe (null): 0 prozedurale Systeme nah', countNullFrame === 0, `Gefunden: ${countNullFrame}`);
}

// — Ergebnis ——————————————————————————————————————————————————————

console.log(`\n${passed} bestanden, ${failures.length} fehlgeschlagen`);
if (failures.length) {
  for (const f of failures) console.log(`  · ${f}`);
  const g = globalThis as { process?: { exitCode?: number } };
  if (g.process) g.process.exitCode = 1;
}
