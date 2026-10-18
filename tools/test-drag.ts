// Offline-Tests der Zieh-Gesten und des Nachlaufs (§8).
// Start:  node --import ./tools/register-ts.mjs tools/test-drag.ts
//
// Geprüft wird, was auf dem Tablet schiefging:
//   · im Orbit lief der Körper dem Finger entgegen, statt am Finger zu kleben
//   · im Freiflug drehte sich das Bild nach schrägen Gesten um seine Mitte
//   · der erste Neuversuch ruckte: unbegrenzte Drehung am Planetenrand, Wurf aus
//     einem einzelnen 1-ms-Event, Wurf nach einer Pause
//   · Aufgabe 08: hinter dem Planetenrand blieb die Umrundung stehen; Zwei-Finger-Drehen fehlte

import {
  GRAB_EDGE, GRAB_MIN_PX, LOOK_RATE, TWIST_START, applyTurn, beginTwist, chooseDrag, dragTurn, exactLimit,
  grabPoint, surfaceAngle, turnBetween, twistTurn,
} from '../src/nav/dragKernel';
import type { DragKind, DragView, OrbitView, ScreenPoint } from '../src/nav/dragKernel';
import { FLING_REST, Fling, MAX_SPIN, SPIN_TAU } from '../src/nav/fling';
import { basisFromQuat, orientTowards, quat, rotateByQuat } from '../src/nav/orientation';
import type { Quat } from '../src/nav/orientation';
import { add, cross, dot, length, normalize, scale, sub, vec3 } from '../src/nav/vec';
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

  // Ein Zug quer über die Scheibe: die Gesamtdrehung bringt den Endpunkt auf den Startpunkt
  for (const k of [1.5, 6]) {
    const o = orbitAt(k);
    const path = [
      ...line({ x: CENTER.x - 60, y: CENTER.y + 40 }, { x: CENTER.x + 90, y: CENTER.y - 70 }, 400),
      ...line({ x: CENTER.x + 90, y: CENTER.y - 70 }, { x: CENTER.x - 20, y: CENTER.y + 100 }, 300).slice(1),
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

// — 3. Planetenrand: kein Ruck —————————————————————————————————————

section('3. Planetenrand: Drehung je Pixel bleibt begrenzt (Gegenprobe: exakter Treffer am Rand)');
for (const k of [1.5, 3, 6, 15]) {
  const o = orbitAt(k);
  const bound = GRAB_EDGE * eps(o) * A0;
  // Strahlen von innen weit über den Rand hinaus, in mehrere Richtungen, dazu ein Kreis um den Rand
  let maxStep = 0;
  for (let a = 0; a < 12; a++) {
    const far = { x: CENTER.x + Math.cos(a * 0.52) * 700, y: CENTER.y + Math.sin(a * 0.52) * 700 };
    maxStep = Math.max(maxStep, drag('grab', line(CENTER, far, 2800), o).maxStep);
  }
  const limbPx = (1 / Math.sqrt(eps(o) * (2 + eps(o))) / Math.tan(VIEW.fovY / 2)) * (VIEW.height / 2);
  const ring: ScreenPoint[] = [];
  for (let i = 0; i <= 1200; i++) {
    const r = limbPx * 0.995;
    ring.push({ x: CENTER.x + Math.cos(i / 191) * r, y: CENTER.y + Math.sin(i / 191) * r });
  }
  maxStep = Math.max(maxStep, drag('grab', ring, o).maxStep);

  // Gegenprobe — so griff der verworfene Versuch: exakter Treffer bis an den Rand.
  // Dort wächst die Drehung je Pixel wie 1/√(Abstand zum Rand), ohne Grenze.
  const rim = (inside: number): ScreenPoint => ({ x: CENTER.x + limbPx - inside, y: CENTER.y });
  const exactRate = (inside: number): number => {
    const h0 = raycast(rim(inside * 1.1), o);
    const h1 = raycast(rim(inside), o);
    return h0 && h1 ? length(turnBetween(h1, h0)) / (inside * 0.1) : Infinity;
  };
  const near = exactRate(0.005);
  const growth = near / exactRate(0.5);
  check(`d = ${k} R: max. ${exp(maxStep)} rad/px ≤ Grenze ${exp(bound)}`, maxStep <= bound * (1 + 1e-9));
  check(`d = ${k} R: Gegenprobe exakter Treffer wächst zum Rand ohne Grenze`, growth > 5 && near > bound,
    `0,5 → 0,005 px vor dem Rand: ×${growth.toFixed(1)}, dort ${(near / bound).toFixed(0)} × Grenze`);
}
section('3b. Über den Rand hinaus: die Umrundung läuft weiter (Gegenprobe: harter Wechsel auf die Orbit-Rate)');
{
  // Sprung am Rand mit 0,01-px-Schritten: misst die Stufe, nicht die Krümmung des exakten Griffs
  const DELTA = 0.01;
  for (const k of [1.5, 3, 6, 15]) {
    const o = orbitAt(k);
    const edgePx = Math.tan(exactLimit(eps(o))) / A0;
    const perPx = (a: ScreenPoint, b: ScreenPoint, kind: DragKind = 'grab'): number =>
      length(dragTurn(kind, a, b, VIEW, o)) / Math.hypot(b.x - a.x, b.y - a.y);
    const at = (phi: number, px: number): ScreenPoint => ({ x: CENTER.x + Math.cos(phi) * px, y: CENTER.y + Math.sin(phi) * px });
    let step = 0;
    let hard = 0;
    for (let az = 0; az < 6; az++) {
      const phi = az * 1.047 + 0.3;
      const edge = at(phi, edgePx);
      for (const beta of [0, 30, 60, 85]) {
        const b = phi + (beta * Math.PI) / 180; // Zugrichtung, um β gegen radial gedreht
        const inner = { x: edge.x - Math.cos(b) * DELTA, y: edge.y - Math.sin(b) * DELTA };
        const outer = { x: edge.x + Math.cos(b) * DELTA, y: edge.y + Math.sin(b) * DELTA };
        const rin = perPx(inner, edge);
        step = Math.max(step, Math.abs(perPx(edge, outer) / rin - 1));
        hard = Math.max(hard, Math.abs(perPx(edge, outer, 'orbit') / rin - 1));
      }
    }
    check(`d = ${k} R: Drehung je px stetig über den Rand (Stufe ≤ 5 %)`, step <= 0.05,
      `größte Stufe ${(step * 100).toFixed(3)} % bei Rand ${edgePx.toFixed(0)} px, β = 0…85°`);
    check(`d = ${k} R: Gegenprobe harter Wechsel auf die Orbit-Rate springt`, hard > 0.05,
      `Stufe bis ${(hard * 100).toFixed(0)} %`);

    // Ganz außerhalb: Achse in der Bildebene, Richtung wie 'orbit' (der Körper folgt dem Finger)
    let zMax = 0;
    let cosMin = 1;
    let far = Infinity;
    for (let az = 0; az < 12; az++) {
      const phi = az * 0.52 + 0.1;
      for (let px = edgePx + 1; px < edgePx + 400; px++) {
        const v = dragTurn('grab', at(phi, px), at(phi, px + 1), VIEW, o);
        const w = dragTurn('grab', at(phi, px), at(phi + 1 / px, px), VIEW, o); // 1 px quer
        zMax = Math.max(zMax, Math.abs(v.z), Math.abs(w.z));
        const vo = dragTurn('orbit', at(phi, px), at(phi, px + 1), VIEW, o);
        cosMin = Math.min(cosMin, dot(v, vo) / (length(v) * length(vo)));
      }
      const p200 = edgePx + 200;
      far = Math.min(far, perPx(at(phi, p200), at(phi, p200 + 1)), perPx(at(phi, p200), at(phi + 1 / p200, p200)));
    }
    const orbitPx = perPx(CENTER, { x: CENTER.x + 1, y: CENTER.y }, 'orbit');
    check(`d = ${k} R: außerhalb z = 0, Körper folgt dem Finger`, zMax === 0 && cosMin > 1 - 1e-12,
      `max |z| = ${zMax}, Richtung zu 'orbit' cos ≥ ${cosMin.toFixed(15)}`);
    check(`d = ${k} R: 200 px hinter dem Rand dreht es weiter`, far >= orbitPx * (1 - 1e-9),
      `${exp(far)} rad/px = ${(far / orbitPx).toFixed(3)} × Orbit-Rate`);
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
  // Finger mit 2 rad/s, Abtastung alle 8,3 ms, Events aber gebündelt mit Zeitstempel-Jitter
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
  rest.release(0.2 + FLING_REST + 0.01);
  check('Finger lag still vor dem Loslassen ⇒ kein Wurf', length(rest.angularVelocity) === 0);

  const burst = new Fling();
  burst.press(0);
  burst.record(0.001, vec3(0.5, 0, 0)); // ein Riesenschritt nach 1 ms
  burst.release(0.002);
  check('einzelnes 1-ms-Event ⇒ begrenzt', length(burst.angularVelocity) <= MAX_SPIN,
    `${length(burst.angularVelocity).toFixed(2)} rad/s`);
}

section('8. Nachlauf: Gesamtweg unabhängig von der Framerate (Gegenprobe: ω·dt je Frame)');
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
    // so lief der Nachlauf bisher: ω·dt, danach Abklingen
    let w = length(spin);
    let total = 0;
    for (let i = 0; i < 3 * fps; i++) {
      total += w / fps;
      w *= Math.exp(-1 / fps / SPIN_TAU);
    }
    naiveAngles.push(total);
  }
  let spread = 0;
  for (const q of finals) spread = Math.max(spread, angleOf(rotateByQuat(q, vec3(0, 0, -1)), rotateByQuat(finals[0], vec3(0, 0, -1))));
  const total = 2 * Math.atan2(Math.hypot(finals[0].x, finals[0].y, finals[0].z), finals[0].w);
  check('20/30/60/120 fps enden in derselben Orientierung', spread < 1e-12, `Streuung ${exp(spread)} rad`);
  check('Gesamtweg = ω · τ', Math.abs(total - length(spin) * SPIN_TAU) < 1e-9,
    `${total.toFixed(6)} rad, erwartet ${(length(spin) * SPIN_TAU).toFixed(6)}`);
  const naiveSpread = (Math.max(...naiveAngles) - Math.min(...naiveAngles)) / Math.min(...naiveAngles);
  check('Gegenprobe ω·dt: Weg hängt an der Framerate', naiveSpread > 0.05,
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

section('9. Zwei-Finger-Drehen: Totzone 8°, danach 1:1 ohne Sprung (Gegenprobe: ganzer Winkel beim Einrasten)');
{
  const DEG = Math.PI / 180;
  /** Fingerpaar um p im Abstand 2r, Fingerlinie im Winkel phi (Bild-y nach unten). */
  const pair = (phi: number, r = 150, p: ScreenPoint = CENTER): [ScreenPoint, ScreenPoint] => [
    { x: p.x - Math.cos(phi) * r, y: p.y - Math.sin(phi) * r },
    { x: p.x + Math.cos(phi) * r, y: p.y + Math.sin(phi) * r },
  ];
  /** Fingerpaare nacheinander; liefert die Bild-Drehungen je Schritt. */
  const run = (pairs: [ScreenPoint, ScreenPoint][]): Vec3[] => {
    let t = beginTwist(pairs[0][0], pairs[0][1]);
    const out: Vec3[] = [];
    for (const [a, b] of pairs.slice(1)) {
      const r = twistTurn(t, a, b);
      t = r.twist;
      out.push(r.turn);
    }
    return out;
  };
  const sweep = (phi0: number, angles: number[]): Vec3[] => run([pair(phi0), ...angles.map((a) => pair(a))]);
  const sumZ = (vs: Vec3[]): number => vs.reduce((s, v) => s + v.z, 0);

  // Totzone: bis 7,9° in beide Richtungen, mit Hin und Her
  const wobble = [0.5, 2, 4.5, 7.9, 6, 3, -1, -4, -7.9, -2, 1].map((d) => (20 + d) * DEG);
  const dead = sweep(20 * DEG, wobble);
  check('Totzone: unter 8° dreht nichts', dead.every((v) => v.x === 0 && v.y === 0 && v.z === 0),
    `${dead.length} Schritte bis ±7,9°, alle (0, 0, 0)`);

  // Einsetzen: 0,7°-Schritte über die Schwelle — der erste Schritt bringt nur den Überschuss
  const steps = Array.from({ length: 20 }, (_, i) => (i + 1) * 0.7 * DEG);
  const onset = sweep(0, steps);
  const first = onset.find((v) => v.z !== 0);
  const maxStep = Math.max(...onset.map((v) => Math.abs(v.z)));
  check('kein Sprung beim Einsetzen', maxStep <= 0.7 * DEG * (1 + 1e-9) && !!first && first.z < 0.7 * DEG,
    `größter Bildschritt ${(maxStep / DEG).toFixed(3)}° bei 0,7°-Fingerschritten, erster ${((first?.z ?? 0) / DEG).toFixed(3)}°` +
    ` (ganzer Winkel beim Einrasten wäre ${(8.4).toFixed(1)}°)`);

  // 1:1 danach, vor und zurück, über ±180° hinweg
  const path = [10, 4, 25, 18, 40, 39.5, 12, 30].map((d) => (170 + d) * DEG);
  const loose = sweep(170 * DEG, path);
  let follow = 0;
  for (let i = 1; i < path.length; i++) follow = Math.max(follow, Math.abs(loose[i].z - (path[i] - path[i - 1])));
  const net = sumZ(loose) - (path[path.length - 1] - 170 * DEG - TWIST_START);
  check('danach 1:1 (auch rückwärts, über ±180°)', follow < 1e-12 && Math.abs(net) < 1e-12,
    `max. Abweichung je Schritt ${exp(follow)} rad, Summe − (Fingerwinkel − 8°) = ${exp(net)} rad`);

  // Vorzeichen: Finger im Uhrzeigersinn ⇒ ein Bildpunkt wandert im Uhrzeigersinn um die Mitte
  const cw = sweep(0, Array.from({ length: 30 }, (_, i) => (i + 1) * DEG));
  const q = applyTurn(quat(), vec3(0, 0, sumZ(cw)));
  const p0 = { x: CENTER.x + 200, y: CENTER.y - 120 };
  const d = rotateByQuat(quat(-q.x, -q.y, -q.z, q.w), localRay(p0)); // Weltrichtung im neuen Kamerarahmen
  const half = Math.tan(VIEW.fovY / 2);
  const p1 = { x: CENTER.x + (d.x / -d.z / half) * (VIEW.height / 2), y: CENTER.y - (d.y / -d.z / half) * (VIEW.height / 2) };
  const moved = Math.atan2(p1.y - CENTER.y, p1.x - CENTER.x) - Math.atan2(p0.y - CENTER.y, p0.x - CENTER.x);
  check('Vorzeichen: das Bild folgt den Fingern', Math.abs(moved - 22 * DEG) < 1e-9,
    `Finger +30° (im Uhrzeigersinn) ⇒ Bildpunkt ${(moved / DEG).toFixed(6)}°, erwartet +22°`);

  // Eventdichte: derselbe Fingerweg in 10, 40 und 160 Events ergibt dieselbe Drehung
  const totals = [10, 40, 160].map((n) => sumZ(sweep(0, Array.from({ length: n }, (_, i) => ((i + 1) / n) * 40 * DEG))));
  const spread = Math.max(...totals) - Math.min(...totals);
  check('Drehung unabhängig von der Eventdichte', spread < 1e-12 && Math.abs(totals[0] - 32 * DEG) < 1e-12,
    `${(totals[0] / DEG).toFixed(9)}°, Streuung ${exp(spread)} rad`);

  // Reiner Pinch und Schwenk ohne Drehung der Fingerlinie: z = 0
  const pinch: [ScreenPoint, ScreenPoint][] = [];
  for (let i = 0; i <= 60; i++) pinch.push(pair(0.37, 60 + i * 4 + (i % 3) * 9, { x: CENTER.x + i * 2.5, y: CENTER.y - i }));
  const flat = run(pinch);
  check('reiner Pinch ohne Drehung ⇒ z = 0', flat.every((v) => v.z === 0), `${flat.length} Schritte, Abstand 120 → 618 px`);

  // Wurf über die vorhandene Fling-Aufzeichnung: 3 rad/s, Events alle 1/60 s
  const f = new Fling();
  f.press(0);
  let t = beginTwist(...pair(0));
  for (let i = 1; i <= 30; i++) {
    const r = twistTurn(t, ...pair((3 * i) / 60));
    t = r.twist;
    f.record(i / 60, r.turn);
  }
  f.release(30 / 60 + 0.004);
  const w = f.angularVelocity;
  check('Wurf aus dem Drehen: um die Blickachse, 3 rad/s', w.x === 0 && w.y === 0 && Math.abs(w.z - 3) / 3 < 1e-9,
    `ω = (${w.x}, ${w.y}, ${w.z.toFixed(12)}) rad/s`);
}

// — Ergebnis ——————————————————————————————————————————————————————

console.log(`\n${passed} bestanden, ${failures.length} fehlgeschlagen`);
if (failures.length) {
  for (const f of failures) console.log(`  · ${f}`);
  const g = globalThis as { process?: { exitCode?: number } };
  if (g.process) g.process.exitCode = 1;
}
