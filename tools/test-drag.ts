// Offline-Tests der Zieh-Gesten (§8).
// Start:  node --import ./tools/register-ts.mjs tools/test-drag.ts
//
// Geprüft werden die zwei Fehler aus der Tablet-Rückmeldung: im Orbit lief der
// Körper dem Finger entgegen (statt am Finger zu kleben), und im Freiflug kam bei
// schrägen Gesten ein ungewollter Roll um die Bildschirmnormale dazu.

import {
  LOOK_RATE, arcBetween, dragLook, hitSphere, localTurn, orbitGrab, orbitRate,
} from '../src/nav/dragKernel';
import {
  basisFromQuat, mulQuat, normalizeQuat, orientTowards, quatFromAxisAngle, rollAngle, rotateLocal,
} from '../src/nav/orientation';
import type { Quat } from '../src/nav/orientation';
import { screenRay } from '../src/nav/picking';
import { cross, dot, length, normalize, scale, sub, vec3 } from '../src/nav/vec';
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
const R = 6.371e6;
const W = 1180;
const H = 820;
const FOV = (55 * Math.PI) / 180;
const PX = FOV / H; // rad je Pixel in Bildmitte
const angleBetween = (a: Vec3, b: Vec3): number =>
  Math.atan2(length(cross(a, b)), dot(a, b));
const roll = (q: Quat): number => rollAngle(q, UP) ?? NaN;
const ray = (q: Quat, x: number, y: number): Vec3 => screenRay(x, y, W, H, FOV, basisFromQuat(q));

/** Kamera im Orbit: −forward · distance relativ zum Zentrum. */
const camPos = (q: Quat, d: number): Vec3 => scale(basisFromQuat(q).forward, -d);

/** Wie weit liegt der Griffpunkt neben dem Fingerstrahl — in Pixeln. */
function slipPx(q: Quat, d: number, radius: number, grab: Vec3, x: number, y: number): number {
  const toGrab = sub(scale(grab, radius), camPos(q, d));
  return angleBetween(toGrab, ray(q, x, y)) / PX;
}

/** Griff wie orbitGrab, aber naiv: Winkel über acos, kein Roll-Halten. */
function naiveGrab(q: Quat, d: number, radius: number, r: Vec3, grab: Vec3): Quat | null {
  const hit = hitSphere(camPos(q, d), r, radius);
  if (!hit) return null;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(hit, grab))));
  return normalizeQuat(mulQuat(quatFromAxisAngle(cross(hit, grab), angle), q));
}

/** Fingerweg: n Schritte von (x0,y0) um (dx,dy) je Schritt; liefert max. Schlupf und Endzustand. */
function dragPath(
  q0: Quat, d: number, radius: number, x0: number, y0: number, dx: number, dy: number, n: number,
  grabber: (q: Quat, r: Vec3, grab: Vec3) => Quat | null,
): { q: Quat; maxSlip: number; lost: boolean } {
  const grab = hitSphere(camPos(q0, d), ray(q0, x0, y0), radius);
  if (!grab) return { q: q0, maxSlip: Infinity, lost: true };
  let q = q0;
  let maxSlip = 0;
  for (let i = 1; i <= n; i++) {
    const x = x0 + dx * i;
    const y = y0 + dy * i;
    const next = grabber(q, ray(q, x, y), grab);
    if (!next) return { q, maxSlip, lost: true };
    q = next;
    maxSlip = Math.max(maxSlip, slipPx(q, d, radius, grab, x, y));
  }
  return { q, maxSlip, lost: false };
}

const glue = (d: number, radius: number) =>
  (q: Quat, r: Vec3, grab: Vec3): Quat | null => orbitGrab(q, d, radius, r, grab, UP);

// — 1. Orbit: der Boden klebt am Finger ——————————————————————————

section('1. Orbit: berührter Punkt bleibt unter dem Finger');
{
  // Kamera über dem Äquator, Blick zum Zentrum, Norden oben
  const q0 = orientTowards(vec3(-1, 0, 0), UP);
  const d = 3 * R;
  const cases: [string, number, number, number, number, number][] = [
    ['nach unten', W / 2, H / 2 - 150, 0, 3, 100],
    ['nach rechts', W / 2 - 150, H / 2, 3, 0, 100],
    ['diagonal', W / 2 - 120, H / 2 - 100, 3, 2, 80],
    ['abseits der Mitte, schräg', W / 2 + 100, H / 2 + 60, -2, -3, 60],
  ];
  for (const [name, x0, y0, dx, dy, n] of cases) {
    const r = dragPath(q0, d, R, x0, y0, dx, dy, n, glue(d, R));
    check(`${name}: Schlupf`, !r.lost && r.maxSlip < 1e-6, `max. ${r.maxSlip.toExponential(2)} px über ${n} Schritte`);
    const dr = Math.abs(roll(r.q) - roll(q0));
    check(`${name}: Norden bleibt oben`, dr < 1e-9, `Roll-Änderung ${dr.toExponential(2)} rad`);
  }

  // Die eigentliche Richtungsfrage: Finger nach unten ⇒ Kamera wandert nach Norden,
  // der Boden läuft also mit dem Finger nach unten (vorher: genau umgekehrt).
  const down = dragPath(q0, d, R, W / 2, H / 2, 0, 2, 50, glue(d, R));
  const zBefore = camPos(q0, d).z;
  const zAfter = camPos(down.q, d).z;
  check('Finger nach unten ⇒ Kamera nach Norden', zAfter > zBefore,
    `Kamera-z ${zBefore.toFixed(0)} → ${zAfter.toExponential(3)} m`);
}

// — 2. Präzision am Boden ————————————————————————————————————————

section('2. Griff in 2 m Höhe (Gegenprobe: Winkel über acos)');
{
  const q0 = orientTowards(vec3(-1, 0, 0), UP);
  const d = R + 2;
  const stable = dragPath(q0, d, R, W / 2 - 20, H / 2 - 20, 1, 1, 40, glue(d, R));
  const naive = dragPath(q0, d, R, W / 2 - 20, H / 2 - 20, 1, 1, 40,
    (q, r, g) => naiveGrab(q, d, R, r, g));
  check('atan2-Bogen: Boden klebt auch in 2 m Höhe', !stable.lost && stable.maxSlip < 1e-3,
    `max. Schlupf ${stable.maxSlip.toExponential(2)} px`);
  check('Gegenprobe acos ist messbar schlechter', naive.maxSlip > 100 * stable.maxSlip && naive.maxSlip > 0.1,
    `max. Schlupf ${naive.maxSlip.toExponential(2)} px`);
}

// — 3. Ersatzrate passt zum Griff ————————————————————————————————

section('3. Ohne Griff: gleiche Richtung und Rate wie der Griff in Bildmitte');
{
  const q0 = orientTowards(vec3(-1, 0, 0), UP);
  for (const factor of [1.001, 1.5, 3, 6]) {
    const d = factor * R;
    const rate = orbitRate(d, R, FOV, H, H);
    const [dx, dy] = [0.6, 0.8];
    const viaRate = dragLook(q0, -dy * rate, -dx * rate, UP);
    const viaGrab = dragPath(q0, d, R, W / 2, H / 2, dx, dy, 1, glue(d, R)).q;
    const step = angleBetween(basisFromQuat(q0).forward, basisFromQuat(viaGrab).forward);
    const diff = angleBetween(basisFromQuat(viaRate).forward, basisFromQuat(viaGrab).forward);
    const limited = rate < LOOK_RATE / H;
    check(`d = ${factor} R: Abweichung ≤ 2 % des Schritts${limited ? '' : ' (Rate gedeckelt)'}`,
      limited ? diff <= 0.02 * step : dot(basisFromQuat(viaRate).forward, basisFromQuat(viaGrab).forward) > 0,
      `Schritt ${step.toExponential(2)} rad, Abweichung ${diff.toExponential(2)} rad`);
  }
}

// — 4. Freiflug: kein Roll aus schrägen Gesten ————————————————————

section('4. Freiflug: schräge Geste ohne Roll (Gegenprobe: eine lokale Achse)');
{
  const k = LOOK_RATE / H;
  const q0 = orientTowards(vec3(1, 0, 0), UP);
  let held = q0;
  let naive = q0;
  for (let i = 0; i < 150; i++) {
    held = dragLook(held, 2 * k, 3 * k, UP);
    naive = rotateLocal(naive, 2 * k, 3 * k);
  }
  const rHeld = Math.abs(roll(held));
  const rNaive = Math.abs(roll(naive));
  check('diagonal 150 Schritte: Roll bleibt null', rHeld < 1e-9, `${rHeld.toExponential(2)} rad`);
  check('Gegenprobe rotateLocal kippt den Horizont', rNaive > 0.1, `${rNaive.toFixed(3)} rad`);

  // Kreisgeste (Holonomie): auch hier kein Roll
  let circ = q0;
  for (let i = 0; i < 360; i++) {
    const a = (i * Math.PI) / 180;
    circ = dragLook(circ, Math.cos(a) * 4 * k, Math.sin(a) * 4 * k, UP);
  }
  const rCirc = Math.abs(roll(circ));
  check('Kreisgeste: Roll bleibt null', rCirc < 1e-9, `${rCirc.toExponential(2)} rad`);

  // Der Blick selbst wandert genau wie vorher — nur der Roll wird zurückgenommen
  const one = dragLook(q0, 5 * k, 7 * k, UP);
  const ref = rotateLocal(q0, 5 * k, 7 * k);
  const dF = angleBetween(basisFromQuat(one).forward, basisFromQuat(ref).forward);
  check('Blickrichtung pro Schritt unverändert', dF < 1e-12, `Abweichung ${dF.toExponential(2)} rad`);
}

// — 5. Pol ————————————————————————————————————————————————————————

section('5. Über den Zenit: kein Anschlag, kein Sprung');
{
  const k = LOOK_RATE / H;
  let q = orientTowards(vec3(1, 0, 0), UP);
  let maxStep = 0;
  let minStep = Infinity;
  let finite = true;
  for (let i = 0; i < 1200; i++) {
    const before = basisFromQuat(q).forward;
    q = dragLook(q, 3 * k, 0, UP);
    const after = basisFromQuat(q).forward;
    finite &&= Number.isFinite(after.x + after.y + after.z);
    const s = angleBetween(before, after);
    maxStep = Math.max(maxStep, s);
    minStep = Math.min(minStep, s);
  }
  check('volle Umdrehung nach oben ohne NaN', finite);
  check('gleichmäßige Schritte auch am Pol', maxStep - minStep < 1e-9,
    `Schritt ${minStep.toExponential(4)} … ${maxStep.toExponential(4)} rad`);
}

// — 6. Nachlauf bei 20–120 fps ————————————————————————————————————

section('6. Nachlauf hält den Roll bei jeder Framerate (Gegenprobe: rotateLocal)');
for (const fps of [20, 30, 60, 120]) {
  const dt = 1 / fps;
  let q = orientTowards(vec3(1, 0, 0.3), UP);
  let n = q;
  let pitch = 1.2;
  let yaw = -2.5;
  for (let t = 0; t < 1.5; t += dt) {
    q = dragLook(q, pitch * dt, yaw * dt, UP);
    n = rotateLocal(n, pitch * dt, yaw * dt);
    const decay = Math.exp(-dt / 0.2);
    pitch *= decay;
    yaw *= decay;
  }
  const r0 = roll(orientTowards(vec3(1, 0, 0.3), UP));
  const dq = Math.abs(roll(q) - r0);
  const dn = Math.abs(roll(n) - r0);
  check(`${fps} fps: Roll-Änderung`, dq < 1e-9 && dn > 1e-3,
    `gehalten ${dq.toExponential(2)} rad, naiv ${dn.toFixed(4)} rad`);
}

// — 7. Bausteine ——————————————————————————————————————————————————

section('7. Bausteine');
{
  const q = orientTowards(vec3(0.3, -0.8, 0.2), UP);
  const t = localTurn(q, rotateLocal(q, 0.012, -0.034));
  check('localTurn ist die Umkehrung von rotateLocal',
    Math.abs(t.pitch - 0.012) < 1e-12 && Math.abs(t.yaw + 0.034) < 1e-12,
    `pitch ${t.pitch.toFixed(6)}, yaw ${t.yaw.toFixed(6)}`);

  const a = normalize(vec3(1, 2, 3));
  const b = normalize(vec3(1, 2, 3 + 1e-9));
  const arc = arcBetween(a, b);
  const moved = basisFromQuat(mulQuat(arc, orientTowards(a, UP))).forward;
  check('arcBetween trifft auch bei 1e-10 rad', angleBetween(moved, b) < 1e-15,
    `Rest ${angleBetween(moved, b).toExponential(2)} rad`);

  check('hitSphere: Strahl vom Körper weg ⇒ kein Treffer', hitSphere(vec3(0, 0, 2 * R), UP, R) === null);
  check('hitSphere: Start in der Kugel ⇒ kein Treffer', hitSphere(vec3(0, 0, R / 2), scale(UP, -1), R) === null);
  const h = hitSphere(vec3(0, 0, R + 2), scale(UP, -1), R);
  check('hitSphere: senkrecht nach unten trifft den Nadir', h !== null && angleBetween(h, UP) < 1e-15);
}

// — Ergebnis ——————————————————————————————————————————————————————

console.log(`\n${passed} bestanden, ${failures.length} fehlgeschlagen`);
if (failures.length) {
  for (const f of failures) console.log(`  · ${f}`);
  const g = globalThis as { process?: { exitCode?: number } };
  if (g.process) g.process.exitCode = 1;
}
