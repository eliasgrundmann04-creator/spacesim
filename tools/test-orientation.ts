// Offline-Tests der Kameraorientierung (§8).
// Start:  node --import ./tools/register-ts.mjs tools/test-orientation.ts
//
// Geprüft wird genau das, was am theta/phi-Modell kaputt war: die blockierte
// Blickachse am Pol und die verzerrten Diagonalen.

import {
  DEFAULT_LEVEL, basisFromQuat, isFiniteQuat, levelRoll, orientTowards,
  quatFromBasis, rollAngle, rollLocal, rotateLocal, turnTowards,
} from '../src/nav/orientation';
import type { Quat } from '../src/nav/orientation';
import { cross, dot, length, normalize, sub, vec3 } from '../src/nav/vec';
import type { Vec3 } from '../src/nav/vec';

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

const UP: Vec3 = vec3(0, 0, 1);
const angleBetween = (a: Vec3, b: Vec3): number =>
  Math.acos(Math.max(-1, Math.min(1, dot(normalize(a), normalize(b)))));
const finite = (v: Vec3): boolean =>
  Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

// — 1. Basis ————————————————————————————————————————————————————

section('1. Basis ist immer orthonormal und rechtshändig');
{
  let maxErr = 0;
  let handed = true;
  let q: Quat = orientTowards(vec3(1, 0, 0), UP);
  for (let i = 0; i < 2000; i++) {
    q = rotateLocal(q, Math.sin(i * 0.7) * 0.31, Math.cos(i * 1.3) * 0.27);
    const b = basisFromQuat(q);
    maxErr = Math.max(
      maxErr,
      Math.abs(length(b.forward) - 1), Math.abs(length(b.right) - 1), Math.abs(length(b.up) - 1),
      Math.abs(dot(b.forward, b.right)), Math.abs(dot(b.forward, b.up)), Math.abs(dot(b.right, b.up)),
    );
    // three-Konvention: right × up = −forward (Kamera blickt lokal entlang −Z)
    if (length(sub(cross(b.right, b.up), { x: -b.forward.x, y: -b.forward.y, z: -b.forward.z })) > 1e-9) {
      handed = false;
    }
  }
  check('2000 verkettete Drehungen bleiben orthonormal', maxErr < 1e-12, `max. Fehler ${maxErr.toExponential(2)}`);
  check('Rechtshändigkeit (right × up = −forward)', handed);
  check('Quaternion bleibt normiert', isFiniteQuat(q));
}

// — 2. Der Pol ist keine Grenze mehr ————————————————————————————

section('2. Blickachse ohne Anschlag (der eigentliche Fehler)');
{
  // Genau der Fall, der bisher an phi ∈ [0.02, π−0.02] scheiterte:
  // vom Horizont über den Zenit hinweg und weiter.
  const start = orientTowards(vec3(1, 0, 0), UP);
  let q = start;
  const stepsPerTurn = 360;
  const step = (2 * Math.PI) / stepsPerTurn;

  let maxStepAngle = 0;
  let minStepAngle = Infinity;
  let zMax = -Infinity;
  let allFinite = true;

  for (let i = 0; i < stepsPerTurn; i++) {
    const before = basisFromQuat(q).forward;
    q = rotateLocal(q, step, 0);
    const after = basisFromQuat(q).forward;
    const moved = angleBetween(before, after);
    maxStepAngle = Math.max(maxStepAngle, moved);
    minStepAngle = Math.min(minStepAngle, moved);
    zMax = Math.max(zMax, after.z);
    if (!finite(after)) allFinite = false;
  }

  const back = basisFromQuat(q);
  check('Blick erreicht den Zenit (z = 1)', zMax > 0.99999, `max. z = ${zMax.toFixed(6)}`);
  check('jeder Schritt dreht exakt gleich viel — kein Anschlag',
    Math.abs(maxStepAngle - step) < 1e-9 && Math.abs(minStepAngle - step) < 1e-9,
    `min ${minStepAngle.toFixed(9)}, max ${maxStepAngle.toFixed(9)}, soll ${step.toFixed(9)}`);
  check('volle 360°-Schleife führt exakt zum Start zurück',
    angleBetween(back.forward, basisFromQuat(start).forward) < 1e-9 &&
    angleBetween(back.up, basisFromQuat(start).up) < 1e-9);
  check('keine entarteten Werte über den Pol', allFinite);
}

{
  // Auch der Sonderfall "Blick exakt entlang der Weltachse" muss tragen:
  // dort war `right = view × cameraUp` bisher der Nullvektor.
  const q = orientTowards(vec3(0, 0, 1), UP);
  const b = basisFromQuat(q);
  check('Blick exakt auf den Weltpol liefert gültige Basis',
    finite(b.right) && finite(b.up) && Math.abs(length(b.right) - 1) < 1e-12,
    `right = (${b.right.x.toFixed(2)}, ${b.right.y.toFixed(2)}, ${b.right.z.toFixed(2)})`);
}

// — 3. Diagonale Schwenks ————————————————————————————————————————

section('3. Diagonale folgen der Geste (unabhängig von der Blickrichtung)');
{
  // Erwartung: Der Blick dreht sich um genau √(dx² + dy²) — an jeder Stelle der
  // Kugel gleich. Im theta/phi-Modell war die waagerechte Wirkung ∝ sin φ und
  // nahe dem Pol praktisch null.
  const gestures: [number, number][] = [[0.2, 0.2], [0.05, 0.3], [0.3, 0], [0, 0.25], [-0.15, 0.22]];
  const pitchStarts = [0, 0.8, 1.4, 1.53, 1.57];  // bis fast senkrecht nach oben

  let worst = 0;
  for (const startPitch of pitchStarts) {
    const base = rotateLocal(orientTowards(vec3(1, 0, 0), UP), startPitch, 0);
    for (const [p, y] of gestures) {
      const f0 = basisFromQuat(base).forward;
      const f1 = basisFromQuat(rotateLocal(base, p, y)).forward;
      worst = Math.max(worst, Math.abs(angleBetween(f0, f1) - Math.hypot(p, y)));
    }
  }
  check('Drehwinkel = |Geste|, auch bei senkrechtem Blick', worst < 1e-9,
    `max. Abweichung ${worst.toExponential(2)} rad`);
}

{
  // Richtungstreue: die Blickrichtung bewegt sich in der Bildebene entlang der Geste.
  // Prüfung im Kamerarahmen — dort muss die Verschiebung (yaw nach links, pitch nach oben)
  // dasselbe Verhältnis haben wie die Geste selbst.
  let worst = 0;
  for (const startPitch of [0, 0.9, 1.5]) {
    const base = rotateLocal(orientTowards(vec3(1, 0, 0), UP), startPitch, 0);
    const b0 = basisFromQuat(base);
    const p = 0.12, y = 0.05;
    const f1 = basisFromQuat(rotateLocal(base, p, y)).forward;
    const dv = sub(f1, b0.forward);
    const screenX = dot(dv, b0.right);   // nach rechts
    const screenY = dot(dv, b0.up);      // nach oben
    // Geste: pitch hebt (screenY > 0), yaw schwenkt nach links (screenX < 0)
    worst = Math.max(worst, Math.abs(screenY / screenX - p / -y));
  }
  check('Verhältnis der Bildschirmbewegung entspricht dem Verhältnis der Geste', worst < 1e-2,
    `max. Abweichung ${worst.toExponential(2)}`);
}

// — 4. Horizont ——————————————————————————————————————————————————

section('4. Roll-Nivellierung statt Achsenklemmung');
{
  let q = rollLocal(orientTowards(vec3(1, 0, 0), UP), 0.4);
  const before = rollAngle(q, UP)!;
  const forwardBefore = basisFromQuat(q).forward;
  for (let i = 0; i < 30; i++) q = levelRoll(q, UP, 1 / 60);
  const after = rollAngle(q, UP)!;

  // 0,5 s bei τ = 0,8 s ⇒ Restanteil e^(−0,625) = 0,535
  const expected = before * Math.exp(-0.5 / DEFAULT_LEVEL.tau);
  check('Roll-Drift klingt mit der Zeitkonstante ab', Math.abs(after - expected) < 0.02,
    `${before.toFixed(3)} → ${after.toFixed(3)} rad (erwartet ${expected.toFixed(3)})`);
  check('Nivellierung dreht nur um die Blickachse',
    angleBetween(forwardBefore, basisFromQuat(q).forward) < 1e-9);
}

{
  // Am Pol ist "oben" unbestimmt — dort darf nicht nivelliert werden.
  const q = orientTowards(vec3(0, 0, 1), UP);
  check('am Pol ist der Rollwinkel undefiniert', rollAngle(q, UP) === null);
  const after = levelRoll(q, UP, 1 / 60);
  check('am Pol bleibt die Orientierung unverändert',
    angleBetween(basisFromQuat(after).forward, basisFromQuat(q).forward) < 1e-12 &&
    isFiniteQuat(after));
}

{
  // Absicht wird nicht korrigiert: wer über den Pol schwenkt, bleibt kopfüber.
  let q = rotateLocal(orientTowards(vec3(1, 0, 0), UP), Math.PI * 0.75, 0);
  const before = rollAngle(q, UP)!;
  for (let i = 0; i < 120; i++) q = levelRoll(q, UP, 1 / 60);
  const after = rollAngle(q, UP)!;
  check('gewollte Kopfüberlage wird nicht zurückgedreht',
    Math.abs(after - before) < 1e-6, `${before.toFixed(3)} → ${after.toFixed(3)} rad`);
}

// — 5. Nachführen und Setzen ————————————————————————————————————

section('5. turnTowards / orientTowards');
{
  const q = turnTowards(orientTowards(vec3(1, 0, 0), UP), vec3(0, 0, 1), 1);
  check('turnTowards(t=1) trifft die Zielrichtung exakt',
    angleBetween(basisFromQuat(q).forward, vec3(0, 0, 1)) < 1e-9);

  const anti = turnTowards(orientTowards(vec3(1, 0, 0), UP), vec3(-1, 0, 0), 1);
  check('antiparallele Zielrichtung ist stabil (keine Division durch null)',
    angleBetween(basisFromQuat(anti).forward, vec3(-1, 0, 0)) < 1e-9 && isFiniteQuat(anti));

  // Teilschritte konvergieren monoton
  let p = orientTowards(vec3(1, 0, 0), UP);
  const target = normalize(vec3(0.2, -0.3, 0.93));
  const initial = angleBetween(basisFromQuat(p).forward, target);
  let last = initial;
  let monotone = true;
  for (let i = 0; i < 60; i++) {
    p = turnTowards(p, target, 1 - Math.exp(-(1 / 60) / 0.45));
    const now = angleBetween(basisFromQuat(p).forward, target);
    if (now > last + 1e-12) monotone = false;
    last = now;
  }
  // Nach 1 s mit τ = 0,45 s bleibt e^(−1/0,45) = 10,8 % des Anfangswinkels.
  const expected = initial * Math.exp(-1 / 0.45);
  check('weiches Nachführen folgt exakt der Zeitkonstante, monoton',
    monotone && Math.abs(last - expected) < 0.01 * initial,
    `Restwinkel ${last.toFixed(4)} rad, erwartet ${expected.toFixed(4)}`);
}

{
  const q = quatFromBasis(vec3(0, -1, 0), vec3(0, 0, 1), vec3(1, 0, 0));
  const b = basisFromQuat(q);
  check('quatFromBasis ist die Umkehrung von basisFromQuat',
    angleBetween(b.forward, vec3(1, 0, 0)) < 1e-12 && angleBetween(b.up, vec3(0, 0, 1)) < 1e-12);
}

// — Ergebnis ——————————————————————————————————————————————————————

console.log(`\n${passed} bestanden, ${failures.length} fehlgeschlagen`);
if (failures.length) {
  for (const f of failures) console.log(`  · ${f}`);
  const g = globalThis as { process?: { exitCode?: number } };
  if (g.process) g.process.exitCode = 1;
}
