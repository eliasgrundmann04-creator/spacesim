// Offline-Smoke-Tests der three-freien Navigationskerne (§8).
// Start:  node --import ./tools/register-ts.mjs tools/test-nav.ts

import { add, copy, distance, dot, length, normalize, scale, slerpDir, sub, vec3 } from '../src/nav/vec';
import type { Vec3 } from '../src/nav/vec';
import type { BodyRef, NavInput } from '../src/nav/types';
import { neutralInput } from '../src/nav/types';
import { DEFAULT_PROXIMITY, evaluateProximity } from '../src/nav/proximity';
import { DEFAULT_FLIGHT, stepFlight } from '../src/nav/flightKernel';
import { DEFAULT_GOTO, advanceGoto, planGoto, sampleGoto, smootherstep } from '../src/nav/gotoKernel';
import { pickBody, screenRay, tapTolerance } from '../src/nav/picking';
import { Navigator } from '../src/nav/Navigator';

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

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-30);

// — Testszene (grobe reale Zahlen, Ekliptik J2000) ————————————————

const R_EARTH = 6.371e6;
const R_MOON = 1.7374e6;
const R_SUN = 6.957e8;
const D_MOON = 3.844e8;
const AU = 1.495978707e11;

function scene(moonPhase = 0, sunPhase = 0): BodyRef[] {
  const earth: Vec3 = vec3(AU * Math.cos(sunPhase), AU * Math.sin(sunPhase), 0);
  return [
    { id: 'sun', name: 'Sonne', position: vec3(0, 0, 0), radius: R_SUN },
    { id: 'earth', name: 'Erde', position: earth, radius: R_EARTH },
    {
      id: 'moon',
      name: 'Mond',
      position: add(earth, vec3(D_MOON * Math.cos(moonPhase), D_MOON * Math.sin(moonPhase), 0)),
      radius: R_MOON,
    },
  ];
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

// — 1. Vektorkern ————————————————————————————————————————————————

section('1. Vektorkern');
{
  const a = normalize(vec3(1, 0, 0));
  const b = normalize(vec3(0, 1, 0));
  const mid = slerpDir(a, b, 0.5);
  check('slerp Mitte ist normiert', rel(length(mid), 1) < 1e-15);
  check('slerp Mitte halbiert den Winkel', rel(Math.acos(dot(a, mid)), Math.PI / 4) < 1e-12);

  const anti = slerpDir(a, scale(a, -1), 0.5);
  check('slerp antiparallel bleibt normiert', rel(length(anti), 1) < 1e-12);
  check('slerp antiparallel steht senkrecht', Math.abs(dot(anti, a)) < 1e-12);

  const par = slerpDir(a, a, 0.37);
  check('slerp parallel ist stabil', rel(length(par), 1) < 1e-15 && rel(dot(par, a), 1) < 1e-15);

  // s(ε) = 10ε³ − 15ε⁴ + 6ε⁵ ⇒ erste *und* zweite Ableitung verschwinden am Rand.
  const eps = 1e-4;
  check('smootherstep C² an den Rändern',
    smootherstep(0) === 0 && smootherstep(1) === 1 &&
    smootherstep(eps) < 11 * eps ** 3 && 1 - smootherstep(1 - eps) < 11 * eps ** 3,
    `s(1e-4)=${smootherstep(eps).toExponential(2)}`);
}

// — 2. Referenzhöhe ——————————————————————————————————————————————

section('2. Referenzhöhe (Softmin)');
{
  const bodies = scene();
  const surface = add(bodies[1].position, vec3(R_EARTH + 2, 0, 0));
  const p = evaluateProximity(surface, bodies, DEFAULT_PROXIMITY);
  check('Anker an der Oberfläche ist die Erde', p.anchor?.id === 'earth');
  check('harte Höhe stimmt', rel(p.altitude, 2) < 1e-6, `${p.altitude.toFixed(6)} m`);
  check('Referenz ≈ harte Höhe bei klarem Minimum', rel(p.reference, 2) < 1e-3,
    `${p.reference.toFixed(4)} m`);

  // Ein einzelner Körper ⇒ gewichteter Mittelwert liefert exakt das Minimum.
  const single = evaluateProximity(surface, [bodies[1]], DEFAULT_PROXIMITY);
  check('ein Körper: Referenz exakt', rel(single.reference, 2) < 1e-12);

  // 200 gleich weit entfernte Körper dürfen die Referenz nicht drücken
  // (das ist der Grund für den gewichteten Mittelwert statt log-sum-exp).
  const ring: BodyRef[] = [];
  for (let i = 0; i < 200; i++) {
    const a = (i / 200) * Math.PI * 2;
    ring.push({ id: `r${i}`, position: vec3(1e9 * Math.cos(a), 1e9 * Math.sin(a), 0), radius: 1e6 });
  }
  const many = evaluateProximity(vec3(0, 0, 0), ring, DEFAULT_PROXIMITY);
  check('200 gleiche Distanzen drücken die Referenz nicht',
    rel(many.reference, many.altitude) < 1e-9,
    `ref=${many.reference.toExponential(3)}  min=${many.altitude.toExponential(3)}`);

  // Stetigkeit beim Ankerwechsel. Der Test misst zweite Differenzen von ln(Höhe) entlang
  // einer Bahn durch den Übergabepunkt Erde↔Mond: das harte Minimum hat dort einen Knick
  // (Sprung in der ersten Ableitung ⇒ Ausschlag in der zweiten), das weiche nicht.
  const from = add(bodies[1].position, vec3(R_EARTH, 0, 0));
  const to = add(bodies[2].position, vec3(-R_MOON, 0, 0));
  const M = 4000;
  const soft: number[] = [];
  const hard: number[] = [];
  for (let i = 0; i <= M; i++) {
    const t = 0.3 + (0.4 * i) / M; // Übergabepunkt liegt bei ~0,5
    const pos = add(from, scale(sub(to, from), t));
    const r = evaluateProximity(pos, bodies, DEFAULT_PROXIMITY);
    soft.push(Math.log(r.reference));
    hard.push(Math.log(Math.max(r.altitude, DEFAULT_PROXIMITY.minAltitude)));
  }
  const d2 = (a: number[]) => {
    let m = 0;
    for (let i = 1; i < a.length - 1; i++) m = Math.max(m, Math.abs(a[i + 1] - 2 * a[i] + a[i - 1]));
    return m;
  };
  const d2soft = d2(soft);
  const d2hard = d2(hard);
  check('Weichmischung glättet den Knick am Ankerwechsel', d2soft < 0.2 * d2hard,
    `weich ${d2soft.toExponential(2)} vs hart ${d2hard.toExponential(2)}`);
}

// — 3. Flugmodell —————————————————————————————————————————————

section('3. Flugmodell');
{
  const bodies = scene();
  const earth = bodies[1];

  // Skaleninvarianz: Aufstiegszeit hängt nur vom Höhenverhältnis ab, nicht vom Radius.
  function climbTime(radius: number, fromAlt: number, toAlt: number): number {
    const body: BodyRef = { id: 'b', position: vec3(0, 0, 0), radius };
    const list = [body];
    let pos = vec3(radius + fromAlt, 0, 0);
    let vel = vec3();
    const input: NavInput = { ...neutralInput(), forward: 1 };
    const dt = 1 / 60;
    let t = 0;
    while (length(pos) - radius < toAlt && t < 400) {
      const s = stepFlight(pos, vel, basisFrom(pos), input, list, vec3(), dt, DEFAULT_FLIGHT);
      pos = s.position;
      vel = s.relVelocity;
      t += dt;
    }
    return t;
  }
  const tSmall = climbTime(1e3, 10, 1e7);
  const tLarge = climbTime(R_EARTH, 10, 1e7);
  const tHuge = climbTime(R_SUN, 10, 1e7);
  check('Aufstiegszeit ist radiusunabhängig',
    rel(tSmall, tLarge) < 0.03 && rel(tLarge, tHuge) < 0.03,
    `${tSmall.toFixed(2)} / ${tLarge.toFixed(2)} / ${tHuge.toFixed(2)} s`);

  // Geschlossene Erwartung inklusive Beschleunigungslag: bei exponentiell wachsendem
  // Sollwert bleibt v um den Faktor 1/(1 + rate·τ) zurück, die effektive Rate also auch.
  const rateEff = DEFAULT_FLIGHT.rate / (1 + DEFAULT_FLIGHT.rate * DEFAULT_FLIGHT.accelTau);
  const ideal = Math.log(1e7 / 10) / rateEff;
  check('Aufstiegszeit trifft ln(h₁/h₀)·(1+rate·τ)/rate', rel(tLarge, ideal) < 0.06,
    `gemessen ${tLarge.toFixed(2)} s, Modell ${ideal.toFixed(2)} s`);

  // Der Kern ist kein Kollisionssystem — Kollision liegt laut §5 in SpaceCamera.
  // Was er garantiert, ist *Auflösung*: pro Frame ändert sich der Abstand zum Anker um
  // höchstens maxStepFraction·maxSubsteps. Es gibt also keinen Frame, der von weit
  // außerhalb mitten in den Körper führt — auch nicht bei dt = 0,25 s und ×100.
  let pos = add(earth.position, vec3(0, 0, R_EARTH + 1e9));
  let vel = vec3();
  let worstClose = 0;
  let jumped = false;
  const dive: NavInput = { ...neutralInput(), forward: 1, speedScale: 100 };
  const frameCap = DEFAULT_FLIGHT.maxStepFraction * DEFAULT_FLIGHT.maxSubsteps;
  for (let i = 0; i < 400; i++) {
    const before = distance(pos, earth.position) - R_EARTH;
    const dir = normalize(sub(earth.position, pos));
    const s = stepFlight(pos, vel, basisFrom(dir), dive, bodies, vec3(), 0.25, DEFAULT_FLIGHT);
    pos = s.position;
    vel = s.relVelocity;
    const after = distance(pos, earth.position) - R_EARTH;
    if (before > 10 * DEFAULT_FLIGHT.minAltitude) {
      worstClose = Math.max(worstClose, (before - after) / before);
      if (before > 1e3 && after < -1e3) jumped = true;
    }
  }
  check('Annäherung pro Frame bleibt beschränkt', worstClose <= frameCap * 1.05 && !jumped,
    `max ${(worstClose * 100).toFixed(1)} % pro Frame, Deckel ${(frameCap * 100).toFixed(0)} %`);

  // Unterhalb von minAltitude bleibt eine Restsinkrate — die muss die Kollisionsprüfung
  // abfangen. Der Kern garantiert nur, dass sie klein und beschränkt ist.
  const sink = DEFAULT_FLIGHT.maxStepFraction * DEFAULT_FLIGHT.minAltitude / (0.25 / DEFAULT_FLIGHT.maxSubsteps);
  check('Restsinkrate am Boden ist beschränkt', sink < 15, `${sink.toFixed(1)} m/s bei dt=0,25 s`);

  // Determinismus: gleiche Eingaben, bitgleiche Ausgaben.
  function run(): string {
    let p = add(earth.position, vec3(0, 0, R_EARTH + 500));
    let v = vec3();
    const inp: NavInput = { ...neutralInput(), forward: 0.7, right: 0.3, speedScale: 3 };
    for (let i = 0; i < 1000; i++) {
      const s = stepFlight(p, v, basisFrom(vec3(1, 0.2, 0.1)), inp, bodies, vec3(), 1 / 60, DEFAULT_FLIGHT);
      p = s.position;
      v = s.relVelocity;
    }
    return `${p.x};${p.y};${p.z};${v.x};${v.y};${v.z}`;
  }
  check('Determinismus über 1000 Schritte', run() === run());

  // Framerate-Unabhängigkeit über dieselbe Realzeit.
  function fly(dt: number, seconds: number): number {
    let p = add(earth.position, vec3(0, 0, R_EARTH + 100));
    let v = vec3();
    const inp: NavInput = { ...neutralInput(), forward: 1 };
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) {
      const s = stepFlight(p, v, basisFrom(vec3(0, 0, 1)), inp, bodies, vec3(), dt, DEFAULT_FLIGHT);
      p = s.position;
      v = s.relVelocity;
    }
    return distance(p, earth.position) - R_EARTH;
  }
  const a20 = fly(1 / 20, 12);
  const a60 = fly(1 / 60, 12);
  const a120 = fly(1 / 120, 12);
  check('framerate-unabhängig (20 / 60 / 120 fps)',
    rel(a20, a120) < 0.01 && rel(a60, a120) < 0.01,
    `${a20.toExponential(4)} / ${a60.toExponential(4)} / ${a120.toExponential(4)} m`);

  // Time-Warp: der Anker rast durch den Weltframe, die Relativlage muss stehen bleiben.
  {
    const nav = new Navigator();
    const warpVel = vec3(0, 3e10, 0); // m pro Realsekunde
    const offset = vec3(R_EARTH + 1000, 0, 0);
    let p = copy(offset);
    const dt = 1 / 60;
    let moving: BodyRef = { id: 'p', position: vec3(0, 0, 0), radius: R_EARTH, velocity: warpVel };
    const inp = neutralInput();
    for (let i = 0; i < 600; i++) {
      moving = { ...moving, position: add(moving.position, scale(warpVel, dt)) };
      const r = nav.update({ position: p, ...basisFrom(vec3(0, 0, 1)) }, [moving], inp, dt);
      p = r.position;
    }
    const drift = distance(sub(p, moving.position), offset);
    check('Anker wird bei Time-Warp mitgeführt (kein Anlauf-Rückstand)',
      drift < 1e-3, `Restdrift ${drift.toExponential(2)} m`);
  }

  // Ankerwechsel: kein Weggeschleudertwerden, wenn zwei Rahmen mit sehr
  // unterschiedlicher Weltgeschwindigkeit aufeinandertreffen.
  {
    const nav = new Navigator();
    const dt = 1 / 60;
    const warp = 1e6;
    let a: BodyRef = { id: 'a', position: vec3(0, 0, 0), radius: 1e6, velocity: vec3(0, 0, 0) };
    let b: BodyRef = { id: 'b', position: vec3(4e7, 0, 0), radius: 1e6, velocity: vec3(0, 1022 * warp, 0) };
    let p = vec3(2e6, 0, 0);
    const inp: NavInput = { ...neutralInput(), forward: 1, speedScale: 30 };
    let maxRel = 0;
    for (let i = 0; i < 600; i++) {
      b = { ...b, position: add(b.position, scale(b.velocity as Vec3, dt)) };
      const dir = normalize(sub(b.position, p));
      const r = nav.update({ position: p, ...basisFrom(dir) }, [a, b], inp, dt);
      p = r.position;
      maxRel = Math.max(maxRel, r.relativeSpeed);
    }
    const near = Math.min(distance(p, a.position) - a.radius, distance(p, b.position) - b.radius);
    check('Ankerwechsel schleudert nicht weg', Number.isFinite(near) && near < 1e9,
      `Endhöhe ${near.toExponential(2)} m, max v_rel ${maxRel.toExponential(2)} m/s`);
  }
}

// — 4. Goto-Übergang —————————————————————————————————————————————

section('4. Goto-Übergang');
{
  const bodies = scene();
  const earth = bodies[1];
  const moon = bodies[2];

  const start = add(earth.position, vec3(R_EARTH + 2, 0, 0));
  const plan = planGoto(start, moon, DEFAULT_GOTO);
  check('Dauer liegt im Zielkorridor (~4 s)', plan.duration > 2.5 && plan.duration < 5,
    `${plan.duration.toFixed(2)} s`);

  // Endzustand exakt
  advanceGoto(plan, plan.duration);
  const end = sampleGoto(plan, moon.position);
  const dEnd = distance(end, moon.position);
  check('Endabstand = frameFactor · R', rel(dEnd, plan.d1) < 1e-12,
    `${(dEnd / R_MOON).toFixed(3)} R_Mond`);

  // Monotonie und C¹-Anschluss
  const p2 = planGoto(start, moon, DEFAULT_GOTO);
  let prevD = Infinity;
  let monotone = true;
  const speeds: number[] = [];
  let prevPos: Vec3 | null = null;
  const dt = 1 / 60;
  while (p2.elapsed < p2.duration) {
    advanceGoto(p2, dt);
    const pos = sampleGoto(p2, moon.position);
    const d = distance(pos, moon.position);
    if (d > prevD + 1e-9) monotone = false;
    prevD = d;
    if (prevPos) speeds.push(distance(pos, prevPos) / dt);
    prevPos = pos;
  }
  check('Abstand fällt monoton', monotone);
  const vMax = Math.max(...speeds);
  check('Geschwindigkeit startet und endet bei ~0',
    speeds[0] / vMax < 0.02 && speeds[speeds.length - 1] / vMax < 0.02,
    `v₀/vmax=${(speeds[0] / vMax).toExponential(2)}  vₑ/vmax=${(speeds[speeds.length - 1] / vMax).toExponential(2)}`);

  // Bewegtes Ziel über den echten Navigator-Pfad: am Ende muss die *Relativ*geschwindigkeit
  // praktisch null sein — die Kamera bewegt sich dann mit dem Ziel mit, und der Wechsel
  // in den freien Flug erzeugt keinen Ruck.
  {
    const orbit = vec3(0, 1022, 0); // m/s, grob die Mondbahngeschwindigkeit
    let target: BodyRef = { ...moon, velocity: orbit };
    const nav = new Navigator();
    nav.requestGoto(start, target);
    let pos = start;
    let peakRel = 0;
    let finalRel = 0;
    let finalWorld = vec3();
    for (let i = 0; i < 1000; i++) {
      target = { ...target, position: add(target.position, scale(orbit, dt)) };
      const r = nav.update({ position: pos, ...basisFrom(vec3(0, 0, 1)) }, [target], neutralInput(), dt);
      pos = r.position;
      peakRel = Math.max(peakRel, r.relativeSpeed);
      finalRel = r.relativeSpeed;
      finalWorld = r.velocity;
      if (r.mode === 'free' && i > 2) break;
    }
    check('Relativgeschwindigkeit bei der Übergabe ≈ 0', finalRel / peakRel < 1e-3,
      `${finalRel.toExponential(2)} / ${peakRel.toExponential(2)} m/s`);
    const err = length(sub(finalWorld, orbit)) / length(orbit);
    check('Weltgeschwindigkeit bei der Übergabe = Bahngeschwindigkeit', err < 0.01,
      `Fehler ${(err * 100).toFixed(3)} %`);
    const dFinal = distance(pos, target.position);
    check('bewegtes Ziel wird exakt getroffen', rel(dFinal, DEFAULT_GOTO.frameFactor * R_MOON) < 1e-9);
  }

  // Entartung: Kamera exakt im Mittelpunkt.
  const degen = planGoto(moon.position, moon, DEFAULT_GOTO);
  advanceGoto(degen, degen.duration);
  const dp = sampleGoto(degen, moon.position);
  check('Start im Mittelpunkt erzeugt keine NaN',
    Number.isFinite(dp.x) && Number.isFinite(dp.y) && Number.isFinite(dp.z));
}

// — 5. Picking ————————————————————————————————————————————————————

section('5. Picking');
{
  const bodies = scene();
  const cam = add(bodies[1].position, vec3(0, 0, R_EARTH + 1e7));
  const tol = tapTolerance((50 * Math.PI) / 180, 900);

  const straight = pickBody(cam, normalize(sub(bodies[1].position, cam)), bodies, tol);
  check('Strahl auf die Erde trifft die Erde', straight?.body.id === 'earth');

  const back = pickBody(cam, normalize(sub(cam, bodies[1].position)), bodies, tol);
  check('Körper hinter der Kamera wird ignoriert', back?.body.id !== 'earth');

  // Verdeckung: Sonne steht hinter der Erde ⇒ der nähere Körper gewinnt.
  const camLine = add(bodies[1].position, scale(normalize(sub(bodies[1].position, bodies[0].position)), 1e8));
  const occl = pickBody(camLine, normalize(sub(bodies[1].position, camLine)), bodies, tol);
  check('verdeckter Körper verliert gegen den näheren', occl?.body.id === 'earth');

  // Punktförmiges Ziel: nur der Fehlwinkel entscheidet.
  const far: BodyRef = { id: 'far', position: add(cam, vec3(0, 0, -4e16)), radius: 7e8 };
  const list = [far];
  const nearMiss = pickBody(cam, normalize(vec3(1e-4, 0, -1)), list, tol);
  const wideMiss = pickBody(cam, normalize(vec3(1, 0, -1)), list, tol);
  check('Punktziel innerhalb der Fingertoleranz trifft', nearMiss?.body.id === 'far');
  check('Punktziel außerhalb der Toleranz trifft nicht', wideMiss === null);

  // Bildschirmstrahl: Mitte = Blickrichtung, Rand = halbes FOV.
  const basis = basisFrom(vec3(0, 0, -1));
  const fov = (50 * Math.PI) / 180;
  const centre = screenRay(600, 450, 1200, 900, fov, basis);
  check('Strahl durch die Bildmitte ist die Blickrichtung',
    rel(dot(centre, basis.forward), 1) < 1e-12);
  const top = screenRay(600, 0, 1200, 900, fov, basis);
  check('Strahl an der Oberkante trifft das halbe vertikale FOV',
    rel(Math.acos(dot(top, basis.forward)), fov / 2) < 1e-9,
    `${((Math.acos(dot(top, basis.forward)) * 360) / Math.PI).toFixed(2)}° FOV`);

  // Volle Kette Doppeltipp → Strahl → Ziel.
  const camAbove = add(bodies[1].position, vec3(0, 0, R_EARTH + 5e7));
  const look = basisFrom(sub(bodies[1].position, camAbove));
  const ray = screenRay(640, 480, 1280, 960, fov, look);
  const hit = pickBody(camAbove, ray, bodies, tapTolerance(fov, 960));
  check('Doppeltipp auf die Bildmitte wählt den Körper darunter', hit?.body.id === 'earth');
}

// — 6. Szenario Erdoberfläche → Mond ——————————————————————————————

section('6. Szenario: von der Erdoberfläche zum Mond, nur mit Schub');
{
  // Abnahmekriterium aus §7, Stufe 1: „man kann von der Erdoberfläche zum Mond fliegen,
  // ohne die Zielauswahl zu benutzen". Start auf dem sublunaren Punkt, Blick zum Mond,
  // Schubregler auf Anschlag — kein Goto, kein Sprung.
  const bodies = scene();
  const toMoon = normalize(sub(bodies[2].position, bodies[1].position));
  const nav = new Navigator();
  let pos = add(bodies[1].position, scale(toMoon, R_EARTH + 2));

  const dt = 1 / 60;
  const input: NavInput = { ...neutralInput(), forward: 1, speedScale: 10 };
  let t = 0;
  let minEarthAlt = Infinity;
  let arrived = -1;

  while (t < 180) {
    const dir = normalize(sub(bodies[2].position, pos));
    const r = nav.update({ position: pos, ...basisFrom(dir) }, bodies, input, dt);
    pos = r.position;
    minEarthAlt = Math.min(minEarthAlt, distance(pos, bodies[1].position) - R_EARTH);
    if (distance(pos, bodies[2].position) - R_MOON < 1e5) {
      arrived = t;
      break;
    }
    t += dt;
  }
  check('Mond in unter 60 s erreicht (100 km Höhe, ×10)', arrived > 0 && arrived < 60,
    `${arrived.toFixed(1)} s`);
  check('Erde wird dabei nicht durchflogen', minEarthAlt > 0,
    `min. Erdhöhe ${minEarthAlt.toFixed(1)} m`);

  // Symmetrie: dieselbe Strecke rückwärts muss gleich lang dauern. Das ist die eigentliche
  // Aussage des Modells — die Flugzeit hängt nur vom Höhenverhältnis ab, nicht von der
  // Richtung. Beide Läufe mit ×1 zwischen den Höhen 1 km und 1 km.
  const slow: NavInput = { ...neutralInput(), forward: 1 };
  const H = 1e3;
  function leg(fromBody: BodyRef, toBody: BodyRef): number {
    const nav2 = new Navigator();
    const dir0 = normalize(sub(toBody.position, fromBody.position));
    let p = add(fromBody.position, scale(dir0, fromBody.radius + H));
    let tt = 0;
    while (tt < 300) {
      const dir = normalize(sub(toBody.position, p));
      p = nav2.update({ position: p, ...basisFrom(dir) }, bodies, slow, dt).position;
      if (distance(p, toBody.position) - toBody.radius < H) return tt;
      tt += dt;
    }
    return -1;
  }
  const out = leg(bodies[1], bodies[2]);
  const back = leg(bodies[2], bodies[1]);
  check('auch bei ×1 in vertretbarer Zeit', out > 0 && out < 60, `${out.toFixed(1)} s`);
  check('Flugzeit ist richtungssymmetrisch', back > 0 && rel(back, out) < 0.05,
    `hin ${out.toFixed(2)} s, zurück ${back.toFixed(2)} s`);
}

// — 7. Rechenzeit ————————————————————————————————————————————————

section('7. Rechenzeit pro Frame (§4.5: < 0,5 ms)');
{
  const many: BodyRef[] = [];
  for (let i = 0; i < 400; i++) {
    many.push({
      id: `b${i}`,
      position: vec3(Math.sin(i) * 1e13, Math.cos(i * 1.7) * 1e13, Math.sin(i * 0.3) * 1e13),
      radius: 1e6 + (i % 7) * 1e5,
    });
  }
  const nav = new Navigator();
  const input: NavInput = { ...neutralInput(), forward: 1 };
  let pos = vec3(1e12, 0, 0);
  // Aufwärmen
  for (let i = 0; i < 500; i++) pos = nav.update({ position: pos, ...basisFrom(vec3(1, 0, 0)) }, many, input, 1 / 60).position;

  const t0 = performance.now();
  const iterations = 3000;
  for (let i = 0; i < iterations; i++) {
    pos = nav.update({ position: pos, ...basisFrom(vec3(1, 0, 0)) }, many, input, 1 / 60).position;
  }
  const per = (performance.now() - t0) / iterations;
  check('Navigator-Update < 0,5 ms bei 400 Körpern', per < 0.5,
    `${per.toFixed(4)} ms/Frame`);
}

// — Ergebnis ——————————————————————————————————————————————————————

console.log(`\n${passed} bestanden, ${failures.length} fehlgeschlagen`);
if (failures.length) {
  for (const f of failures) console.log(`  · ${f}`);
  // Ohne @types/node ist `process` nicht deklariert — der Zugriff läuft über globalThis.
  const g = globalThis as { process?: { exitCode?: number } };
  if (g.process) g.process.exitCode = 1;
}
