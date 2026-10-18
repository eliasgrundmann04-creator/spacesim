// Offline-Tests der Zieh-Gesten, des Nachlaufs und der Parameterbank (§8).
// Start:  node --import ./tools/register-ts.mjs tools/test-drag.ts

import {
  GRAB_MIN_PX, LOOK_RATE, applyTurn, beginTwist, chooseDrag, dragTurn, exactLimit,
  grabPoint, surfaceAngle, turnBetween, twistTurn,
} from '../src/nav/dragKernel';
import type { DragKind, DragView, OrbitView, ScreenPoint } from '../src/nav/dragKernel';
import { Fling } from '../src/nav/fling';
import { DEFAULT_FEEL, FEEL, FEEL_RANGES, parseFeel } from '../src/nav/feel';
import { basisFromQuat, orientTowards, quat, rotateByQuat } from '../src/nav/orientation';
import type { Quat } from '../src/nav/orientation';
import { add, cross, dot, length, normalize, scale, sub, vec3 } from '../src/nav/vec';
import type { Vec3 } from '../src/nav/vec';
import { mulberry32 } from '../src/math/rng';

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

// iPad quer, Sichtfeld wie in SpaceCamera
const VIEW: DragView = { width: 1180, height: 820, fovY: (55 * Math.PI) / 180 };
const CENTER: ScreenPoint = { x: VIEW.width / 2, y: VIEW.height / 2 };
/** rad Blickwinkel je px in Bildmitte. */
const A0 = (2 * Math.tan(VIEW.fovY / 2)) / VIEW.height;
const R = 6.371e6;
const orbitAt = (k: number): OrbitView => ({ distance: k * R, radius: R });
const eps = (o: OrbitView): number => (o.distance - o.radius) / o.radius;
const angleOf = (a: Vec3, b: Vec3): number => Math.atan2(length(cross(a, b)), dot(a, b));
const exp = (x: number): string => x.toExponential(2);

/** Fingerstrahl im Kamerarahmen (Blick entlang −z). */
function localRay(p: ScreenPoint): Vec3 {
  const half = Math.tan(VIEW.fovY / 2);
  return normalize(vec3(
    (2 * (p.x / VIEW.width) - 1) * half * (VIEW.width / VIEW.height),
    (1 - 2 * (p.y / VIEW.height)) * half,
    -1,
  ));
}

/** Unabhängige Referenz: echter Strahl-Kugel-Schnitt, Richtung vom Zentrum (Kamerarahmen). */
function raycast(p: ScreenPoint, o: OrbitView): Vec3 | null {
  const r = localRay(p);
  const origin = vec3(0, 0, o.distance); // Kamera relativ zum Zentrum
  const h = o.distance - o.radius;
  const b = dot(origin, r);
  const c = h * (o.distance + o.radius);
  const disc = b * b - c;
  if (b >= 0 || disc < 0) return null;
  const t = c / (-b + Math.sqrt(disc));
  return normalize(add(origin, scale(r, t)));
}

/** Fingerweg in 1-px-Schritten; liefert die Gesamtdrehung (Kamerarahmen des Starts) und den max. Schritt. */
function drag(kind: DragKind, path: ScreenPoint[], o: OrbitView | null): { q: Quat; maxStep: number } {
  let q = quat();
  let maxStep = 0;
  for (let i = 1; i < path.length; i++) {
    const v = dragTurn(kind, path[i - 1], path[i], VIEW, o);
    maxStep = Math.max(maxStep, length(v) / Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
    q = applyTurn(q, v);
  }
  return { q, maxStep };
}

function line(a: ScreenPoint, b: ScreenPoint, steps: number): ScreenPoint[] {
  const out: ScreenPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    out.push({ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps });
  }
  return out;
}

// Ensure default values initially
parseFeel('');

// — 0. Parameterbank ——————————————————————————————————————————————

section('0. Parameterbank: FEEL und parseFeel');
{
  parseFeel('?feel=spinTau:1.4,twistStartDeg:25');
  check('parseFeel setzt angegebene Werte', FEEL.spinTau === 1.4 && FEEL.twistStartDeg === 25,
    `spinTau=${FEEL.spinTau}, twistStartDeg=${FEEL.twistStartDeg}`);

  parseFeel('?feel=spinTau:999,grabEdge:-5,unknownKey:42,maxSpin:NaN');
  check('Werte außerhalb des Bereichs werden geklemmt',
    FEEL.spinTau === FEEL_RANGES.spinTau.max && FEEL.grabEdge === FEEL_RANGES.grabEdge.min,
    `spinTau=${FEEL.spinTau} (max ${FEEL_RANGES.spinTau.max}), grabEdge=${FEEL.grabEdge} (min ${FEEL_RANGES.grabEdge.min})`);
  check('unbekannte Schlüssel und non-finite Werte werden ignoriert',
    FEEL.maxSpin === DEFAULT_FEEL.maxSpin,
    `maxSpin=${FEEL.maxSpin}`);

  parseFeel('');
  check('Ohne Parameter gelten die Standardwerte',
    FEEL.spinTau === DEFAULT_FEEL.spinTau &&
    FEEL.grabEdge === DEFAULT_FEEL.grabEdge &&
    FEEL.twistStartDeg === DEFAULT_FEEL.twistStartDeg &&
    FEEL.twistDominance === DEFAULT_FEEL.twistDominance &&
    FEEL.pinchLockPx === DEFAULT_FEEL.pinchLockPx,
    `spinTau=${FEEL.spinTau}, grabEdge=${FEEL.grabEdge}, twistStartDeg=${FEEL.twistStartDeg}`);
}

// — 1. Freiflug ————————————————————————————————————————————————————

section('1. Freiflug: der Blick folgt dem Finger, das Bild dreht nie um seine Mitte');
{
  let zMax = 0;
  for (const [dx, dy] of [[5, 0], [0, 5], [4, 3], [-3, 7], [-6, -6], [1e-3, 9]]) {
    const v = dragTurn('look', CENTER, { x: CENTER.x + dx, y: CENTER.y + dy }, VIEW, null);
    zMax = Math.max(zMax, Math.abs(v.z));
  }
  check('Drehachse liegt in der Bildebene (z-Anteil)', zMax === 0, `max |z| = ${zMax}`);

  const down = basisFromQuat(drag('look', line(CENTER, { x: CENTER.x, y: CENTER.y + 100 }, 100), null).q);
  const right = basisFromQuat(drag('look', line(CENTER, { x: CENTER.x + 100, y: CENTER.y }, 100), null).q);
  check('nach unten ziehen ⇒ Blick hebt sich', down.forward.y > 0, `forward.y = ${down.forward.y.toFixed(4)}`);
  check('nach rechts ziehen ⇒ Blick schwenkt nach links', right.forward.x < 0,
    `forward.x = ${right.forward.x.toFixed(4)}`);

  // Eine lange Diagonale: eine einzige feste Achse, der Bildrand dreht sich nicht weg
  const diag = drag('look', line(CENTER, { x: CENTER.x + 300, y: CENTER.y + 200 }, 360), null).q;
  const axis = normalize(vec3(diag.x, diag.y, diag.z));
  check('Diagonale = Drehung um eine Achse in der Bildebene', Math.abs(axis.z) < 1e-15,
    `Achse z = ${exp(axis.z)}`);
}

// — 2. Orbit: Griff ————————————————————————————————————————————————

section('2. Orbit: der berührte Bodenpunkt bleibt unter dem Finger');
{
  let maxErr = 0;
  for (const k of [1.2, 1.5, 3, 6, 12]) {
    const o = orbitAt(k);
    for (let i = 0; i < 400; i++) {
      // Punkte innerhalb der Scheibe, auch nah am Rand
      const p = { x: CENTER.x + Math.cos(i * 2.39996) * (i % 37) * 9, y: CENTER.y + Math.sin(i * 2.39996) * (i % 37) * 9 };
      const hit = raycast(p, o);
      if (!hit) continue;
      const alpha = Math.acos(-localRay(p).z);
      if (alpha > exactLimit(eps(o))) continue; // hinter der exakten Zone: s. Abschnitt 3
      maxErr = Math.max(maxErr, angleOf(grabPoint(p, VIEW, eps(o)), hit));
    }
  }
  check('Griffpunkt = echter Strahl-Kugel-Treffer (exakte Zone, d = 1,2…12 R)', maxErr < 1e-12,
    `max. Abweichung ${exp(maxErr)} rad`);

  // Ein Zug quer über die Scheibe (innerhalb der exakten Zone): Gesamtdrehung bringt Endpunkt auf Startpunkt
  for (const k of [1.5, 6]) {
    const o = orbitAt(k);
    const limitPx = Math.tan(exactLimit(eps(o))) / A0;
    const r = limitPx * 0.7; // sicher innerhalb der exakten Zone
    const path = [
      ...line({ x: CENTER.x - r * 0.4, y: CENTER.y + r * 0.3 }, { x: CENTER.x + r * 0.5, y: CENTER.y - r * 0.4 }, 400),
      ...line({ x: CENTER.x + r * 0.5, y: CENTER.y - r * 0.4 }, { x: CENTER.x - r * 0.1, y: CENTER.y + r * 0.6 }, 300).slice(1),
    ];
    const q = drag('grab', path, o).q;
    const start = grabPoint(path[0], VIEW, eps(o));
    const end = rotateByQuat(q, grabPoint(path[path.length - 1], VIEW, eps(o)));
    const slipPx = angleOf(start, end) / (A0 * eps(o)); // in px Fingerweg in Bildmitte
    check(`d = ${k} R: Griffpunkt nach 700 Schritten unter dem Finger`, slipPx < 1e-6, `Schlupf ${exp(slipPx)} px`);
  }

  // Die Richtungsfrage: Finger nach unten ⇒ Kamera nach Norden ⇒ Boden läuft mit nach unten
  const o = orbitAt(3);
  const q = drag('grab', line(CENTER, { x: CENTER.x, y: CENTER.y + 120 }, 120), o).q;
  const cam = rotateByQuat(q, vec3(0, 0, 1)); // Kamera relativ zum Zentrum (Richtung)
  check('Finger nach unten ⇒ Kamera wandert nach oben (Norden)', cam.y > 0.1, `Kamera y = ${cam.y.toFixed(4)}`);
  const qr = drag('grab', line(CENTER, { x: CENTER.x + 120, y: CENTER.y }, 120), o).q;
  const camR = rotateByQuat(qr, vec3(0, 0, 1));
  check('Finger nach rechts ⇒ Kamera wandert nach links', camR.x < -0.1, `Kamera x = ${camR.x.toFixed(4)}`);
}

// — 3. Planetenrand: Orbit gleichmäßig —————————————————————————————

section('3. Orbit gleichmäßig: Radialer Zug von der Scheibenmitte bis 300 px hinter den Rand');
{
  for (const k of [1.001, 3, 15]) {
    const o = orbitAt(k);
    const limbPx = (1 / Math.sqrt(eps(o) * (2 + eps(o))) / Math.tan(VIEW.fovY / 2)) * (VIEW.height / 2);
    const totalPx = Math.ceil(limbPx + 300);

    let minRate = Infinity;
    let maxRate = 0;
    for (let px = 0; px < totalPx; px++) {
      const p0 = { x: CENTER.x + px, y: CENTER.y };
      const p1 = { x: CENTER.x + px + 1, y: CENTER.y };
      const turn = length(dragTurn('grab', p0, p1, VIEW, o));
      minRate = Math.min(minRate, turn);
      maxRate = Math.max(maxRate, turn);
    }
    const ratio = maxRate / minRate;
    const allowed = FEEL.grabEdge * 1.05;
    check(`d = ${k.toFixed(3)} R: max/min = ${ratio.toFixed(3)} ≤ grabEdge · 1.05 (${allowed.toFixed(3)})`,
      ratio <= allowed + 1e-9, `max/min = ${ratio.toFixed(4)}`);
  }

  // Gegenprobe mit grabEdge = 4 reproduziert altes Verhältnis (> 3)
  parseFeel('?feel=grabEdge:4');
  const oGegen = orbitAt(3);
  const limbPxGegen = (1 / Math.sqrt(eps(oGegen) * (2 + eps(oGegen))) / Math.tan(VIEW.fovY / 2)) * (VIEW.height / 2);
  const totalPxGegen = Math.ceil(limbPxGegen + 300);
  let minRateG = Infinity;
  let maxRateG = 0;
  for (let px = 0; px < totalPxGegen; px++) {
    const p0 = { x: CENTER.x + px, y: CENTER.y };
    const p1 = { x: CENTER.x + px + 1, y: CENTER.y };
    const turn = length(dragTurn('grab', p0, p1, VIEW, oGegen));
    minRateG = Math.min(minRateG, turn);
    maxRateG = Math.max(maxRateG, turn);
  }
  const ratioGegen = maxRateG / minRateG;
  check('Gegenprobe mit grabEdge = 4: max/min > 3', ratioGegen > 3,
    `max/min = ${ratioGegen.toFixed(3)}`);

  parseFeel(''); // Zurücksetzen auf Standardwerte
}

section('3b. Stetigkeit am Rand (Stufe ≤ 5 %)');
{
  const DELTA = 0.01;
  for (const k of [1.5, 3, 6, 15]) {
    const o = orbitAt(k);
    const edgePx = Math.tan(exactLimit(eps(o))) / A0;
    const perPx = (a: ScreenPoint, b: ScreenPoint, kind: DragKind = 'grab'): number =>
      length(dragTurn(kind, a, b, VIEW, o)) / Math.hypot(b.x - a.x, b.y - a.y);
    const at = (phi: number, px: number): ScreenPoint => ({ x: CENTER.x + Math.cos(phi) * px, y: CENTER.y + Math.sin(phi) * px });
    let step = 0;
    for (let az = 0; az < 6; az++) {
      const phi = az * 1.047 + 0.3;
      const edge = at(phi, edgePx);
      for (const beta of [0, 30, 60, 85]) {
        const b = phi + (beta * Math.PI) / 180;
        const inner = { x: edge.x - Math.cos(b) * DELTA, y: edge.y - Math.sin(b) * DELTA };
        const outer = { x: edge.x + Math.cos(b) * DELTA, y: edge.y + Math.sin(b) * DELTA };
        const rin = perPx(inner, edge);
        step = Math.max(step, Math.abs(perPx(edge, outer) / rin - 1));
      }
    }
    check(`d = ${k} R: Drehung je px stetig über den Rand (Stufe ≤ 5 %)`, step <= 0.05,
      `größte Stufe ${(step * 100).toFixed(3)} %`);
  }
}

// — 4. Bodennähe ———————————————————————————————————————————————————

section('4. 2 m über dem Boden (Gegenprobe: Winkel über acos, θ über asin(k sin α) − α)');
{
  const o: OrbitView = { distance: R + 2, radius: R };
  const path = line({ x: CENTER.x - 300, y: CENTER.y - 200 }, { x: CENTER.x + 250, y: CENTER.y + 180 }, 700);
  const q = drag('grab', path, o).q;
  const end = rotateByQuat(q, grabPoint(path[path.length - 1], VIEW, eps(o)));
  const slip = angleOf(grabPoint(path[0], VIEW, eps(o)), end) / (A0 * eps(o));
  check('Boden klebt am Finger', slip < 1e-6, `Schlupf ${exp(slip)} px`);

  let acosQ = quat();
  for (let i = 1; i < path.length; i++) {
    const a = grabPoint(path[i], VIEW, eps(o));
    const b = grabPoint(path[i - 1], VIEW, eps(o));
    const angle = Math.acos(Math.min(1, dot(a, b)));
    acosQ = applyTurn(acosQ, scale(normalize(cross(a, b)), angle));
  }
  const acosEnd = rotateByQuat(acosQ, grabPoint(path[path.length - 1], VIEW, eps(o)));
  const acosSlip = angleOf(grabPoint(path[0], VIEW, eps(o)), acosEnd) / (A0 * eps(o));
  check('Gegenprobe acos: der Boden bleibt stehen, der Finger rutscht', acosSlip > 100,
    `Schlupf ${acosSlip.toFixed(0)} px`);

  let stable = 0;
  let naive = 0;
  for (const p of [{ x: 200, y: 150 }, { x: 900, y: 600 }, { x: 640, y: 380 }]) {
    const ref = raycast(p, o);
    if (!ref) continue;
    const thetaRef = Math.atan2(Math.hypot(ref.x, ref.y), ref.z);
    const alpha = Math.acos(-localRay(p).z);
    const e = eps(o);
    stable = Math.max(stable, Math.abs(surfaceAngle(alpha, e) - thetaRef) / thetaRef);
    naive = Math.max(naive, Math.abs(Math.asin((1 + e) * Math.sin(alpha)) - alpha - thetaRef) / thetaRef);
  }
  check('Bodenwinkel: rel. Fehler umgeformt', stable < 1e-12, exp(stable));
  check('Gegenprobe naive Formel messbar schlechter', naive > 1000 * stable && naive > 1e-12, exp(naive));
}

// — 5. Orbit ohne Griff ————————————————————————————————————————————

section('5. Orbit neben dem Körper: gleiche Richtung wie der Griff, kein Drehen um die Bildmitte');
{
  for (const k of [1.5, 3]) {
    const o = orbitAt(k);
    const to = { x: CENTER.x + 0.6, y: CENTER.y + 0.8 };
    const viaRate = dragTurn('orbit', CENTER, to, VIEW, o);
    const viaGrab = dragTurn('grab', CENTER, to, VIEW, o);
    const diff = length(sub(viaRate, viaGrab)) / length(viaGrab);
    check(`d = ${k} R: Rate = Griff in Bildmitte`, diff < 1e-3 && viaRate.z === 0,
      `rel. Abweichung ${exp(diff)}, z = ${viaRate.z}`);
  }
  const far = dragTurn('orbit', CENTER, { x: CENTER.x, y: CENTER.y + 100 }, VIEW, orbitAt(1e4));
  const cap = (LOOK_RATE / VIEW.height) * 100;
  check('ferner Körper: Rate gedeckelt auf die Freiflug-Rate', Math.abs(length(far) - cap) < 1e-15,
    `${exp(length(far))} rad je 100 px`);
}

// — 6. Wahl der Geste ——————————————————————————————————————————————

section('6. Wahl beim Aufsetzen');
{
  const near = orbitAt(3);
  check('Freiflug ⇒ look', chooseDrag(CENTER, VIEW, null) === 'look');
  check('Finger auf dem Körper ⇒ grab', chooseDrag({ x: CENTER.x + 100, y: CENTER.y }, VIEW, near) === 'grab');
  check('Finger daneben ⇒ orbit', chooseDrag({ x: 20, y: 20 }, VIEW, near) === 'orbit');
  // Scheibe kleiner als eine Fingerkuppe: auch mittig kein Griff
  const kSmall = 1 / Math.sin(Math.atan(((GRAB_MIN_PX - 1) / (VIEW.height / 2)) * Math.tan(VIEW.fovY / 2)));
  check(`Scheibe < ${GRAB_MIN_PX} px ⇒ orbit`, chooseDrag(CENTER, VIEW, orbitAt(kSmall)) === 'orbit',
    `d = ${kSmall.toFixed(1)} R`);
}

// — 7. Wurf ————————————————————————————————————————————————————————

section('7. Wurf: Ausgleichsgerade über 100 ms (Gegenprobe: letzter Schritt / letzter Abstand)');
{
  const rate = 2;
  const jitter = [0, 6, 1, 5, 0, 7, 2, 0, 6, 3];
  const errs: number[] = [];
  const naiveErrs: number[] = [];
  for (let release = 30; release < 40; release++) {
    const f = new Fling();
    f.press(0);
    let lastT = 0;
    let lastStep = 0;
    for (let i = 1; i <= release; i++) {
      const sample = i * 0.0083;
      const stamp = sample + jitter[i % jitter.length] / 1000;
      const v = vec3(rate * 0.0083, 0, 0);
      f.record(stamp, v);
      lastStep = 0.0083 * rate / Math.max(stamp - lastT, 1e-3);
      lastT = stamp;
    }
    f.release(lastT + 0.004);
    errs.push(Math.abs(length(f.angularVelocity) - rate) / rate);
    naiveErrs.push(Math.abs(lastStep - rate) / rate);
  }
  const worst = Math.max(...errs);
  const naiveWorst = Math.max(...naiveErrs);
  check('Wurfgeschwindigkeit trotz Zeitstempel-Jitter', worst < 0.1, `max. Fehler ${(worst * 100).toFixed(1)} %`);
  check('Gegenprobe Einzelquotient schwankt', naiveWorst > 0.5, `max. Fehler ${(naiveWorst * 100).toFixed(0)} %`);

  const rest = new Fling();
  rest.press(0);
  for (let i = 1; i <= 20; i++) rest.record(i * 0.01, vec3(0.05, 0, 0));
  rest.release(0.2 + FEEL.flingRest + 0.01);
  check('Finger lag still vor dem Loslassen ⇒ kein Wurf', length(rest.angularVelocity) === 0);

  const burst = new Fling();
  burst.press(0);
  burst.record(0.001, vec3(0.5, 0, 0));
  burst.release(0.002);
  check('einzelnes 1-ms-Event ⇒ begrenzt', length(burst.angularVelocity) <= FEEL.maxSpin,
    `${length(burst.angularVelocity).toFixed(2)} rad/s`);
}

// — 8. Nachlauf ————————————————————————————————————————————————————

section('8. Nachlauf: Gesamtweg unabhängig von der Framerate (spinTau = Standardwert)');
{
  const spin = vec3(1.1, -2.3, 0);
  const finals: Quat[] = [];
  const naiveAngles: number[] = [];
  for (const fps of [20, 30, 60, 120]) {
    const f = new Fling();
    f.press(0);
    f.record(0.05, scale(spin, 0.05));
    f.release(0.05);
    let q = quat();
    let frames = 0;
    for (let c = f.coast(1 / fps); c; c = f.coast(1 / fps)) {
      q = applyTurn(q, c);
      frames++;
      if (frames > 10000) break;
    }
    finals.push(q);

    let w = length(spin);
    let total = 0;
    for (let i = 0; i < 10 * fps; i++) {
      total += w / fps;
      w *= Math.exp(-1 / fps / FEEL.spinTau);
    }
    naiveAngles.push(total);
  }
  let spread = 0;
  for (const q of finals) spread = Math.max(spread, angleOf(rotateByQuat(q, vec3(0, 0, -1)), rotateByQuat(finals[0], vec3(0, 0, -1))));
  const total = 2 * Math.atan2(Math.hypot(finals[0].x, finals[0].y, finals[0].z), finals[0].w);
  const expectedTotal = length(spin) * FEEL.spinTau;
  check('20/30/60/120 fps enden in derselben Orientierung', spread < 1e-12, `Streuung ${exp(spread)} rad`);
  check('Gesamtweg = ω · τ (< 1e-9 rad)', Math.abs(total - expectedTotal) < 1e-9,
    `${total.toFixed(6)} rad, erwartet ${expectedTotal.toFixed(6)}`);
  const naiveSpread = (Math.max(...naiveAngles) - Math.min(...naiveAngles)) / Math.min(...naiveAngles);
  check('Gegenprobe ω·dt: Weg hängt an der Framerate', naiveSpread > 0.02,
    `20 vs. 120 fps: ${(naiveSpread * 100).toFixed(1)} %`);

  const idle = new Fling();
  let q = orientTowards(vec3(0.3, 0.9, 0.1), vec3(0, 0, 1));
  const before = q;
  for (let i = 0; i < 600; i++) {
    const c = idle.coast(1 / 60);
    if (c) q = applyTurn(q, c);
  }
  check('ohne Wurf dreht sich nichts (10 s)', q.x === before.x && q.y === before.y && q.z === before.z && q.w === before.w);
}

// — 9. Drehen nur mit Absicht ——————————————————————————————————————

section('9. Drehen nur mit Absicht (synthetische Zwei-Finger-Spuren, Fingerabstand 200 px)');
{
  const DEG = Math.PI / 180;
  const pairAt = (phi: number, dist = 200, p: ScreenPoint = CENTER): [ScreenPoint, ScreenPoint] => {
    const r = dist / 2;
    return [
      { x: p.x - Math.cos(phi) * r, y: p.y - Math.sin(phi) * r },
      { x: p.x + Math.cos(phi) * r, y: p.y + Math.sin(phi) * r },
    ];
  };

  const runTrack = (pairs: [ScreenPoint, ScreenPoint][]): Vec3[] => {
    let t = beginTwist(pairs[0][0], pairs[0][1]);
    const out: Vec3[] = [];
    for (const [a, b] of pairs.slice(1)) {
      const res = twistTurn(t, a, b);
      t = res.twist;
      out.push(res.turn);
    }
    return out;
  };

  const sumZ = (vs: Vec3[]): number => vs.reduce((s, v) => s + v.z, 0);

  // 1. Pinch auf 60 % bzw. 140 % Abstand mit 12° Mitverdrehung ⇒ Σ z = 0
  const pinch60: [ScreenPoint, ScreenPoint][] = [];
  const pinch140: [ScreenPoint, ScreenPoint][] = [];
  for (let i = 0; i <= 50; i++) {
    const t = i / 50;
    const phi = t * 12 * DEG;
    pinch60.push(pairAt(phi, 200 * (1 - 0.4 * t)));
    pinch140.push(pairAt(phi, 200 * (1 + 0.4 * t)));
  }
  const z60 = sumZ(runTrack(pinch60));
  const z140 = sumZ(runTrack(pinch140));
  check('Pinch 60 % mit 12° Mitverdrehung ⇒ Σ z = 0', z60 === 0, `Σ z = ${z60}`);
  check('Pinch 140 % mit 12° Mitverdrehung ⇒ Σ z = 0', z140 === 0, `Σ z = ${z140}`);

  // 2. Erst Pinch um ≥ pinchLockPx, danach 40° reine Drehung ⇒ Σ z = 0 (Sperre bis zum Loslassen)
  const lockedTrack: [ScreenPoint, ScreenPoint][] = [];
  // Pinch um pinchLockPx + 10 px
  const pLock = FEEL.pinchLockPx + 10;
  for (let i = 0; i <= 20; i++) {
    const d = 200 + (pLock * i) / 20;
    lockedTrack.push(pairAt(0, d));
  }
  // Danach 40° reine Drehung bei vergrößertem Abstand
  const dLocked = 200 + pLock;
  for (let i = 1; i <= 40; i++) {
    const phi = (i / 40) * 40 * DEG;
    lockedTrack.push(pairAt(phi, dLocked));
  }
  const zLocked = sumZ(runTrack(lockedTrack));
  check('Pinch ≥ pinchLockPx gesperrt bis Loslassen ⇒ Σ z = 0', zLocked === 0, `Σ z = ${zLocked}`);

  // 3. Zwei ruhende Finger, 2 px Zufallsrauschen je Finger, 3 s bei 60 fps ⇒ Σ z = 0
  const noiseRng = mulberry32(12345);
  let fa: ScreenPoint = { x: CENTER.x - 100, y: CENTER.y };
  let fb: ScreenPoint = { x: CENTER.x + 100, y: CENTER.y };
  const noiseTrack: [ScreenPoint, ScreenPoint][] = [[fa, fb]];
  for (let i = 0; i < 180; i++) {
    fa = { x: fa.x + (noiseRng() - 0.5) * 2, y: fa.y + (noiseRng() - 0.5) * 2 };
    fb = { x: fb.x + (noiseRng() - 0.5) * 2, y: fb.y + (noiseRng() - 0.5) * 2 };
    noiseTrack.push([fa, fb]);
  }
  const zNoise = sumZ(runTrack(noiseTrack));
  check('Zwei ruhende Finger + 2 px Rauschen (3 s, 60 fps) ⇒ Σ z = 0', zNoise === 0, `Σ z = ${zNoise}`);

  // 4. Reine Drehung um 45° bei konstantem Abstand ⇒ Σ z = 45° − twistStartDeg (± 1e-9), kein Sprung beim Einrasten, danach 1:1
  const twistStartRad = (FEEL.twistStartDeg * Math.PI) / 180;
  const targetRad = 45 * DEG;
  const rot45Track: [ScreenPoint, ScreenPoint][] = [];
  const N = 90;
  for (let i = 0; i <= N; i++) {
    const phi = (i / N) * targetRad;
    rot45Track.push(pairAt(phi, 200));
  }
  let tState = beginTwist(rot45Track[0][0], rot45Track[0][1]);
  let maxStepZ = 0;
  let firstEngagedZ = 0;
  let sumZ45 = 0;
  for (const [a, b] of rot45Track.slice(1)) {
    const res = twistTurn(tState, a, b);
    if (!tState.engaged && res.twist.engaged) {
      firstEngagedZ = res.turn.z;
    }
    tState = res.twist;
    maxStepZ = Math.max(maxStepZ, Math.abs(res.turn.z));
    sumZ45 += res.turn.z;
  }
  const expectedZ = targetRad - twistStartRad;
  const stepRad = targetRad / N;
  check('Reine Drehung 45° ⇒ Σ z = 45° − twistStartDeg (± 1e-9)',
    Math.abs(sumZ45 - expectedZ) < 1e-9,
    `Σ z = ${(sumZ45 / DEG).toFixed(4)}°, erwartet ${(expectedZ / DEG).toFixed(4)}°`);
  check('Kein Sprung beim Einrasten', firstEngagedZ <= stepRad * (1 + 1e-9) && maxStepZ <= stepRad * (1 + 1e-9),
    `erster Einrast-Schritt ${(firstEngagedZ / DEG).toFixed(4)}°, Finger-Schritt ${(stepRad / DEG).toFixed(4)}°`);

  // Danach 1:1 in beide Richtungen: 10° zurück, 10° vor
  const backForwardTrack: [ScreenPoint, ScreenPoint][] = [rot45Track[rot45Track.length - 1]];
  for (let i = 1; i <= 20; i++) {
    const phi = targetRad - (i / 20) * 10 * DEG;
    backForwardTrack.push(pairAt(phi, 200));
  }
  for (let i = 1; i <= 20; i++) {
    const phi = targetRad - 10 * DEG + (i / 20) * 10 * DEG;
    backForwardTrack.push(pairAt(phi, 200));
  }
  const bfTurns = [];
  for (const [a, b] of backForwardTrack.slice(1)) {
    const res = twistTurn(tState, a, b);
    tState = res.twist;
    bfTurns.push(res.turn);
  }
  const backZ = sumZ(bfTurns.slice(0, 20));
  const fwdZ = sumZ(bfTurns.slice(20));
  check('Danach 1:1 in beide Richtungen',
    Math.abs(backZ - (-10 * DEG)) < 1e-9 && Math.abs(fwdZ - 10 * DEG) < 1e-9,
    `zurück = ${(backZ / DEG).toFixed(4)}°, vor = ${(fwdZ / DEG).toFixed(4)}°`);
}

// — Ergebnis ——————————————————————————————————————————————————————

console.log(`\n${passed} bestanden, ${failures.length} fehlgeschlagen`);
if (failures.length) {
  for (const f of failures) console.log(`  · ${f}`);
  const g = globalThis as { process?: { exitCode?: number } };
  if (g.process) g.process.exitCode = 1;
}
