// Offline-Test der Warp-Mitführung (Aufgabe 13).
// Start: node --import ./tools/register-ts.mjs tools/test-warp.ts

import { add, copy, distance, length, normalize, scale, sub, vec3 } from '../src/nav/vec';
import type { Vec3 } from '../src/nav/vec';
import type { BodyRef, NavInput } from '../src/nav/types';
import { neutralInput } from '../src/nav/types';
import { Navigator } from '../src/nav/Navigator';
import { stepFlight } from '../src/nav/flightKernel';

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

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-30);

// --- Testszene: Sonne fest im Ursprung, Erde (1 AE), Mond (384.400 km um Erde) ---

const R_EARTH = 6.371e6;
const R_MOON = 1.7374e6;
const R_SUN = 6.957e8;
const AU = 1.495978707e11;
const D_MOON = 3.844e8;

// Gravitationskonstante mal Massen:
const MU_SUN = 1.32712440018e20; // m³/s²
const MU_EARTH_MOON = 4.035e14;   // m³/s² (Erde + Mond)

// Mittlere Bewegungen (Kreisbahnen):
const OMEGA_EARTH = Math.sqrt(MU_SUN / (AU * AU * AU));
const OMEGA_MOON = Math.sqrt(MU_EARTH_MOON / (D_MOON * D_MOON * D_MOON));

// Testzeitpunkt t0 != 0, damit Körper nicht starr auf der x-Achse liegen
const T0 = 1234567;

function getSceneState(simTime: number, warp: number): { bodies: BodyRef[]; sun: BodyRef; earth: BodyRef; moon: BodyRef } {
  const sunPos = vec3(0, 0, 0);
  const sunVel = vec3(0, 0, 0);

  const eAngle = OMEGA_EARTH * simTime;
  const earthPos = vec3(AU * Math.cos(eAngle), AU * Math.sin(eAngle), 0);
  const eSpeed = OMEGA_EARTH * AU;
  const earthVelSim = vec3(-eSpeed * Math.sin(eAngle), eSpeed * Math.cos(eAngle), 0);

  const mAngle = OMEGA_MOON * simTime;
  const moonRelPos = vec3(D_MOON * Math.cos(mAngle), D_MOON * Math.sin(mAngle), 0);
  const mSpeed = OMEGA_MOON * D_MOON;
  const moonRelVelSim = vec3(-mSpeed * Math.sin(mAngle), mSpeed * Math.cos(mAngle), 0);

  const moonPos = add(earthPos, moonRelPos);
  const moonVelSim = add(earthVelSim, moonRelVelSim);

  const sun: BodyRef = { id: 'sun', name: 'Sonne', position: sunPos, radius: R_SUN, velocity: scale(sunVel, warp) };
  const earth: BodyRef = { id: 'earth', name: 'Erde', position: earthPos, radius: R_EARTH, velocity: scale(earthVelSim, warp) };
  const moon: BodyRef = { id: 'moon', name: 'Mond', position: moonPos, radius: R_MOON, velocity: scale(moonVelSim, warp) };

  return { bodies: [sun, earth, moon], sun, earth, moon };
}

const basisFrom = (forward: Vec3) => {
  const f = normalize(forward);
  const ref = Math.abs(f.z) > 0.9 ? vec3(1, 0, 0) : vec3(0, 0, 1);
  const right = normalize(vec3(
    f.y * ref.z - f.z * ref.y,
    f.z * ref.x - f.x * ref.z,
    f.x * ref.y - f.y * ref.x,
  ));
  const up = vec3(
    right.y * f.z - right.z * f.y,
    right.z * f.x - right.x * f.z,
    right.x * f.y - right.y * f.x,
  );
  return { forward: f, right, up };
};

// --- Tests ---

section('1. Schweben über dem Mond bei verschiedenen Warps und Frameraten');
{
  const offsetRel = vec3(300e3, -200e3, R_MOON + 100e3);
  const warps = [1, 1e3, 1e6, 2.4e8];
  const fpsList = [20, 60, 120];

  for (const warp of warps) {
    for (const fps of fpsList) {
      const dt = 1 / fps;
      let simTime = T0;
      let state = getSceneState(simTime, warp);

      const nav = new Navigator();
      let camPos = add(state.moon.position, offsetRel);
      nav.resetMotion(state.moon);

      let maxDrift = 0;
      const steps = Math.round(10 * fps); // 10 s Realzeit
      for (let i = 0; i < steps; i++) {
        simTime += warp * dt;
        state = getSceneState(simTime, warp);

        const res = nav.update({ position: camPos, ...basisFrom(vec3(0, 0, 1)) }, state.bodies, neutralInput(), dt);
        camPos = res.position;

        const currentOffset = sub(camPos, state.moon.position);
        const drift = distance(currentOffset, offsetRel);
        if (drift > maxDrift) maxDrift = drift;
      }

      check(`Schweben bei Warp ×${warp.toExponential(0)}, ${fps} fps: max Drift <= 0,01 m`,
        maxDrift <= 0.01, `max Drift: ${maxDrift.toExponential(3)} m`);
    }
  }
}

section('2. Gegenprobe: Bisheriger Euler-Weg weicht massiv ab');
{
  const warp = 1e6;
  const fps = 60;
  const dt = 1 / fps;
  let simTime = T0;

  const offsetRel = vec3(300e3, -200e3, R_MOON + 100e3);
  let state = getSceneState(simTime, warp);
  let camPos = add(state.moon.position, offsetRel);
  let relVel = vec3();

  const steps = Math.round(10 * fps);
  for (let i = 0; i < steps; i++) {
    simTime += warp * dt;
    state = getSceneState(simTime, warp);

    const step = stepFlight(
      camPos,
      relVel,
      basisFrom(vec3(0, 0, 1)),
      neutralInput(),
      state.bodies,
      state.moon.velocity as Vec3,
      dt,
    );
    camPos = step.position;
    relVel = step.relVelocity;
  }

  const finalDrift = distance(sub(camPos, state.moon.position), offsetRel);
  check('Gegenprobe alter Euler-Weg: Drift > 1e6 m bei ×10⁶, 60 fps',
    finalDrift > 1e6, `gemessene Drift: ${finalDrift.toExponential(3)} m`);
}

section('3. Relativflug unabhängig vom Warp');
{
  const initialAlt = 2e7;
  const startOffset = vec3(0, 0, R_MOON + initialAlt);
  const input: NavInput = { ...neutralInput(), forward: 1, speedScale: 1 };
  const duration = 3; // 3 s
  const fpsList = [20, 60, 120];

  for (const fps of fpsList) {
    const dt = 1 / fps;
    const steps = Math.round(duration * fps);

    // Lauf bei Warp ×1
    let simTime1 = T0;
    let state1 = getSceneState(simTime1, 1);
    const nav1 = new Navigator();
    let pos1 = add(state1.moon.position, startOffset);
    nav1.resetMotion(state1.moon);

    let prevMoon1 = state1.moon.position;
    for (let i = 0; i < steps; i++) {
      simTime1 += 1 * dt;
      state1 = getSceneState(simTime1, 1);
      const carriedPos1 = add(pos1, sub(state1.moon.position, prevMoon1));
      const dir1 = normalize(sub(state1.moon.position, carriedPos1));
      const res1 = nav1.update({ position: pos1, ...basisFrom(dir1) }, state1.bodies, input, dt);
      pos1 = res1.position;
      prevMoon1 = state1.moon.position;
    }
    const finalAlt1 = distance(pos1, state1.moon.position) - R_MOON;

    // Lauf bei Warp ×10⁶
    let simTimeWarp = T0;
    let stateWarp = getSceneState(simTimeWarp, 1e6);
    const navWarp = new Navigator();
    let posWarp = add(stateWarp.moon.position, startOffset);
    navWarp.resetMotion(stateWarp.moon);

    let prevMoonWarp = stateWarp.moon.position;
    for (let i = 0; i < steps; i++) {
      simTimeWarp += 1e6 * dt;
      stateWarp = getSceneState(simTimeWarp, 1e6);
      const carriedPosWarp = add(posWarp, sub(stateWarp.moon.position, prevMoonWarp));
      const dirWarp = normalize(sub(stateWarp.moon.position, carriedPosWarp));
      const resWarp = navWarp.update({ position: posWarp, ...basisFrom(dirWarp) }, stateWarp.bodies, input, dt);
      posWarp = resWarp.position;
      prevMoonWarp = stateWarp.moon.position;
    }
    const finalAltWarp = distance(posWarp, stateWarp.moon.position) - R_MOON;

    const diff = Math.abs(finalAltWarp - finalAlt1);
    const relErr = diff / finalAlt1;

    check(`Relativflug bei ${fps} fps: Höhenabweichung Warp ×10⁶ vs ×1 < 1e-9 relative Höhe`,
      relErr < 1e-9, `rel. Fehler: ${relErr.toExponential(3)}, diff: ${diff.toExponential(3)} m`);
  }
}

section('4. Der Tablet-Ablauf');
{
  const fpsList = [20, 60, 120];

  for (const fps of fpsList) {
    const dt = 1 / fps;
    let simTime = T0;
    let state = getSceneState(simTime, 1);

    const nav = new Navigator();
    // Start 6 Erdradien vor der Erde in Richtung Mond
    const earthToMoonDir = normalize(sub(state.moon.position, state.earth.position));
    let camPos = add(state.earth.position, scale(earthToMoonDir, 6 * R_EARTH));
    nav.resetMotion(state.earth);

    // Phase 1: Vollschub mit speedScale 10 in Richtung Mond bis Anker=Mond & Höhe < 5e6 m
    const thrustInput: NavInput = { ...neutralInput(), forward: 1, speedScale: 10 };
    let reached = false;
    let maxStepsPhase1 = Math.round(300 * fps);

    for (let i = 0; i < maxStepsPhase1; i++) {
      simTime += 1 * dt;
      state = getSceneState(simTime, 1);
      const lookDir = normalize(sub(state.moon.position, camPos));
      const res = nav.update({ position: camPos, ...basisFrom(lookDir) }, state.bodies, thrustInput, dt);
      camPos = res.position;

      if (res.anchor?.id === 'moon' && res.altitude < 5e6) {
        reached = true;
        break;
      }
    }
    check(`Tablet-Ablauf Phase 1 (${fps} fps): Mond erreicht (< 5e6 m)`, reached);

    // Phase 2: 5 s loslassen (Assistenz an), Warp ×1
    const idleInput = neutralInput();
    for (let i = 0; i < Math.round(5 * fps); i++) {
      simTime += 1 * dt;
      state = getSceneState(simTime, 1);
      const res = nav.update({ position: camPos, ...basisFrom(vec3(0, 0, 1)) }, state.bodies, idleInput, dt);
      camPos = res.position;
    }

    const altBeforeWarp = distance(camPos, state.moon.position) - R_MOON;

    // Phase 3: Warp ×10⁶ und 10 s Leerlauf
    let anchorStaysMoon = true;
    let maxAltInWarp = 0;

    for (let i = 0; i < Math.round(10 * fps); i++) {
      simTime += 1e6 * dt;
      state = getSceneState(simTime, 1e6);
      const res = nav.update({ position: camPos, ...basisFrom(vec3(0, 0, 1)) }, state.bodies, idleInput, dt);
      camPos = res.position;

      if (res.anchor?.id !== 'moon') anchorStaysMoon = false;
      if (res.altitude > maxAltInWarp) maxAltInWarp = res.altitude;
    }

    check(`Tablet-Ablauf Phase 3 (${fps} fps): Anker bleibt Mond`, anchorStaysMoon);
    check(`Tablet-Ablauf Phase 3 (${fps} fps): Höhe wächst um <= 1 m`,
      maxAltInWarp <= altBeforeWarp + 1.0,
      `Höhe vorher: ${altBeforeWarp.toFixed(3)} m, max in Warp: ${maxAltInWarp.toFixed(3)} m`);
  }
}

// --- Ergebnis ---

console.log(`\n${passed} bestanden, ${failures.length} fehlgeschlagen`);
if (failures.length) {
  for (const f of failures) console.log(`  · ${f}`);
  const g = globalThis as { process?: { exitCode?: number } };
  if (g.process) g.process.exitCode = 1;
}
