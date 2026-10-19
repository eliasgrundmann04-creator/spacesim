// Offline-Test des automatischen Tempos (Begrenzer + Rückführung).
// Start: node --experimental-strip-types --import ./tools/register-ts.mjs tools/test-pace.ts

import { add, distance, dot, length, normalize, scale, vec3 } from '../src/nav/vec';
import type { Vec3 } from '../src/nav/vec';
import type { BodyRef, NavInput } from '../src/nav/types';
import { neutralInput } from '../src/nav/types';
import { DEFAULT_FLIGHT, stepFlight } from '../src/nav/flightKernel';
import { Navigator } from '../src/nav/Navigator';
import { FEEL, parseFeel } from '../src/nav/feel';
import { createAutoPaceState, relaxStage } from '../src/nav/autoPace';

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

const R_EARTH = 6.371e6;
const earth: BodyRef = { id: 'earth', name: 'Erde', position: vec3(0, 0, 0), radius: R_EARTH };
const bodies = [earth];

const basisFrom = (forward: Vec3) => {
  const f = normalize(forward);
  const refVec = Math.abs(f.z) > 0.9 ? vec3(1, 0, 0) : vec3(0, 0, 1);
  const right = normalize(vec3(
    f.y * refVec.z - f.z * refVec.y,
    f.z * refVec.x - f.x * refVec.z,
    f.x * refVec.y - f.y * refVec.x,
  ));
  const up = vec3(
    right.y * f.z - right.z * f.y,
    right.z * f.x - right.x * f.z,
    right.x * f.y - right.y * f.x,
  );
  return { forward: f, right, up };
};

// 1. Parallelflug unberührt
section('1. Parallelflug unberührt');
{
  FEEL.autoPace = 1;
  FEEL.ttcMin = 0.6;
  const p = vec3(0, 0, R_EARTH + 1e6);
  // Kommando senkrecht zur Richtung auf den Körper (Erde liegt bei (0,0,0), Richtungsvektor toBody = (0,0,-1))
  const forward = vec3(1, 0, 0); // parallel
  const basis = basisFrom(forward);
  const input: NavInput = { ...neutralInput(), forward: 1, speedScale: 100 };

  FEEL.autoPace = 0;
  const sOff = stepFlight(p, vec3(), basis, input, bodies, vec3(), 1 / 60, DEFAULT_FLIGHT);

  FEEL.autoPace = 1;
  const sOn = stepFlight(p, vec3(), basis, input, bodies, vec3(), 1 / 60, DEFAULT_FLIGHT);

  check('Parallelflug Zielgeschwindigkeit bitgleich', sOn.referenceSpeed === sOff.referenceSpeed,
    `on=${sOn.referenceSpeed} off=${sOff.referenceSpeed}`);
}

// 2. Sturzflug bei ×100
section('2. Sturzflug bei ×100');
{
  FEEL.autoPace = 1;
  FEEL.ttcMin = 0.6;

  function runDive(fps: number): { arrivalTime: number; minTtcRatio: number } {
    FEEL.autoPace = 1;
    FEEL.ttcMin = 0.6;
    let pos = vec3(0, 0, R_EARTH + 1e7);
    let vel = vec3();
    const dt = 1 / fps;
    const input: NavInput = { ...neutralInput(), forward: 1, speedScale: 100 };
    let t = 0;
    let minRatio = Infinity;

    while (t < 500) {
      const h = length(pos) - R_EARTH;
      if (h < 100) break;

      const dir = normalize(scale(pos, -1));
      const basis = basisFrom(dir);

      // Wir prüfen vor dem Schritt die Annäherungsgeschwindigkeit
      const s = stepFlight(pos, vel, basis, input, bodies, vec3(), dt, DEFAULT_FLIGHT);
      pos = s.position;
      vel = s.relVelocity;

      const hNew = length(pos) - R_EARTH;
      const approach = -dot(vel, normalize(pos));
      if (approach > 1e-6) {
        const ttc = hNew / approach;
        const ratio = ttc / FEEL.ttcMin;
        if (ratio < minRatio) minRatio = ratio;
      }

      t += dt;
    }

    return { arrivalTime: t, minTtcRatio: minRatio };
  }

  const res20 = runDive(20);
  const res60 = runDive(60);
  const res120 = runDive(120);

  check('Höhe / Annäherung ≥ 0.95 · ttcMin über den ganzen Flug (20 fps)', res20.minTtcRatio >= 0.95,
    `minRatio 20fps=${res20.minTtcRatio.toFixed(4)}`);
  check('Höhe / Annäherung ≥ 0.95 · ttcMin über den ganzen Flug (60 fps)', res60.minTtcRatio >= 0.95,
    `minRatio 60fps=${res60.minTtcRatio.toFixed(4)}`);
  check('Höhe / Annäherung ≥ 0.95 · ttcMin über den ganzen Flug (120 fps)', res120.minTtcRatio >= 0.95,
    `minRatio 120fps=${res120.minTtcRatio.toFixed(4)}`);

  const tAvg = (res20.arrivalTime + res60.arrivalTime + res120.arrivalTime) / 3;
  const dev20 = Math.abs(res20.arrivalTime - tAvg) / tAvg;
  const dev60 = Math.abs(res60.arrivalTime - tAvg) / tAvg;
  const dev120 = Math.abs(res120.arrivalTime - tAvg) / tAvg;

  check('Ankunftszeiten bei 20/60/120 fps weichen um < 2 % ab',
    dev20 < 0.02 && dev60 < 0.02 && dev120 < 0.02,
    `20fps: ${res20.arrivalTime.toFixed(2)}s, 60fps: ${res60.arrivalTime.toFixed(2)}s, 120fps: ${res120.arrivalTime.toFixed(2)}s`);
}

// 3. ×1 fast unverändert
section('3. ×1 fast unverändert');
{
  FEEL.autoPace = 1;
  FEEL.ttcMin = 0.6;
  const pos = vec3(0, 0, R_EARTH + 1e6);
  const dir = normalize(scale(pos, -1));
  const basis = basisFrom(dir);
  const input: NavInput = { ...neutralInput(), forward: 1, speedScale: 1 };

  FEEL.autoPace = 0;
  const sOff = stepFlight(pos, vec3(), basis, input, bodies, vec3(), 1 / 60, DEFAULT_FLIGHT);

  FEEL.autoPace = 1;
  const sOn = stepFlight(pos, vec3(), basis, input, bodies, vec3(), 1 / 60, DEFAULT_FLIGHT);

  const diff = Math.abs(sOn.referenceSpeed - sOff.referenceSpeed) / sOff.referenceSpeed;
  check('Sturzflug bei ×1 weicht um < 3 % ab', diff < 0.03,
    `Abweichung ${(diff * 100).toFixed(2)} % (on=${sOn.referenceSpeed.toFixed(1)}, off=${sOff.referenceSpeed.toFixed(1)})`);
}

// 4. Stetigkeit
section('4. Stetigkeit der Zielgeschwindigkeit');
{
  FEEL.autoPace = 1;
  FEEL.ttcMin = 0.6;
  const pos = vec3(0, 0, R_EARTH + 1e6);
  const input: NavInput = { ...neutralInput(), forward: 1, speedScale: 100 };

  let maxStep = 0;
  let prevV = 0;
  const N = 1000;
  for (let i = 0; i <= N; i++) {
    const angle = (i / N) * (Math.PI / 2); // 0 = parallel, PI/2 = senkrecht auf den Körper
    // Position bei (0,0,R_EARTH+1e6), Erde bei (0,0,0) ⇒ Ausrichtung nach (0,0,-1)
    const forward = vec3(Math.cos(angle), 0, -Math.sin(angle));
    const basis = basisFrom(forward);
    const s = stepFlight(pos, vec3(), basis, input, bodies, vec3(), 1 / 60, DEFAULT_FLIGHT);
    if (i > 0) {
      const stepRel = Math.abs(s.referenceSpeed - prevV) / Math.max(prevV, 1e-6);
      if (stepRel > maxStep) maxStep = stepRel;
    }
    prevV = s.referenceSpeed;
  }

  check('Keine Stufe der Zielgeschwindigkeit > 1 % zwischen Nachbarschritten', maxStep < 0.01,
    `max. Schrittweite ${(maxStep * 100).toFixed(3)} %`);
}

// 5. Rückführung
section('5. Rückführung der Stufe');
{
  const hd = 1; // stageHalfDecades

  // a) ×100 gesetzt bei 1e8 m, Flug auf 1e7 m ⇒ ×10; weiter auf 1e6 m ⇒ ×√10
  const st1 = createAutoPaceState(100, 1e8);
  const s1a = relaxStage(st1, 100, 1e7, hd);
  check('×100 bei 1e8m -> 1e7m => ×10', rel(s1a, 10) < 1e-8, `s1a = ${s1a}`);
  const s1b = relaxStage(st1, s1a, 1e6, hd);
  check('weiter auf 1e6m => ×√10', rel(s1b, Math.sqrt(10)) < 1e-8, `s1b = ${s1b}`);

  // b) Danach zurück auf 1e8 m ⇒ bleibt ×√10
  const s1c = relaxStage(st1, s1b, 1e8, hd);
  check('danach zurück auf 1e8m => bleibt ×√10', rel(s1c, Math.sqrt(10)) < 1e-8, `s1c = ${s1c}`);

  // c) Zuerst von 1e8 m auf 1e11 m hinaus, dann auf 1e10 m herein ⇒ ×10
  const st2 = createAutoPaceState(100, 1e8);
  relaxStage(st2, 100, 1e11, hd); // mark wird 1e11
  const s2 = relaxStage(st2, 100, 1e10, hd);
  check('von 1e8m auf 1e11m hinaus, dann auf 1e10m herein => ×10', rel(s2, 10) < 1e-8, `s2 = ${s2}`);

  // d) ×0,1 gesetzt bei 10 m, Aufstieg auf 100 m ⇒ ×√0,1
  const st3 = createAutoPaceState(0.1, 10);
  const s3 = relaxStage(st3, 0.1, 100, hd);
  check('×0,1 bei 10m -> 100m => ×√0,1', rel(s3, Math.sqrt(0.1)) < 1e-8, `s3 = ${s3}`);

  // e) Neue Nutzereingabe ⇒ Merkpunkt wird auf aktuelle Referenzhöhe neu gesetzt
  const st4 = createAutoPaceState(100, 1e8);
  relaxStage(st4, 100, 1e7, hd); // lastWritten wurde 10
  // Nun gibt der Nutzer manuell 50 ein
  const s4 = relaxStage(st4, 50, 1e7, hd);
  check('neue Nutzereingabe 50 setzt Merkpunkt neu auf 1e7m', st4.stageSet === 50 && st4.mark === 1e7 && rel(s4, 50) < 1e-12,
    `stageSet=${st4.stageSet}, mark=${st4.mark}, s4=${s4}`);

  // f) Gleitflug: speedScale ändert sich jedes Frame von außen ⇒ unverändert durchgereicht
  const st5 = createAutoPaceState(1, 100);
  const s5a = relaxStage(st5, 1.23, 80, hd);
  const s5b = relaxStage(st5, 1.45, 60, hd);
  check('sich stetig ändernde Eingabe wird unverändert durchgereicht', s5a === 1.23 && s5b === 1.45);
}

// 6. Abschaltbar
section('6. Abschaltbar mit autoPace = 0');
{
  FEEL.autoPace = 0;
  FEEL.ttcMin = 0.6;

  const pos = vec3(0, 0, R_EARTH + 1e7);
  const basis = basisFrom(vec3(0, 0, -1));
  const input: NavInput = { ...neutralInput(), forward: 1, speedScale: 100 };

  const s = stepFlight(pos, vec3(), basis, input, bodies, vec3(), 1 / 60, DEFAULT_FLIGHT);
  const nav = new Navigator();
  const res = nav.update({ position: pos, ...basis }, bodies, input, 1 / 60);

  // Fest eingebettete Referenzwerte aus einem Lauf auf main (ohne Begrenzer / Rückführung)
  const expectedRefSpeed = 861538468.3874788;
  const expectedPosZ = 15929416.875993112;
  check('stepFlight referenceSpeed ist bitgleich zum Stand vor der Aufgabe', s.referenceSpeed === expectedRefSpeed,
    `s.referenceSpeed=${s.referenceSpeed}`);
  check('Navigator.update position.z ist bitgleich zum Stand vor der Aufgabe', res.position.z === expectedPosZ,
    `res.position.z=${res.position.z}`);
}

// 7. Feel
section('7. Feel Parsing');
{
  FEEL.autoPace = 1;
  parseFeel('?feel=ttcMin:1.5,stageHalfDecades:2');
  check('parseFeel setzt ttcMin=1.5 und stageHalfDecades=2', FEEL.ttcMin === 1.5 && FEEL.stageHalfDecades === 2,
    `ttcMin=${FEEL.ttcMin}, stageHalfDecades=${FEEL.stageHalfDecades}`);
}

console.log(`\n${passed} bestanden, ${failures.length} fehlgeschlagen`);
if (failures.length) {
  for (const f of failures) console.log(`  · ${f}`);
  const g = globalThis as { process?: { exitCode?: number } };
  if (g.process) g.process.exitCode = 1;
}
