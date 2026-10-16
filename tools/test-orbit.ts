// Offline-Test der hierarchischen Zustandspropagation (§8).
// Start:  node --import ./tools/register-ts.mjs tools/test-orbit.ts
//
// Geprüft wird die in v0.3 ergänzte Weltgeschwindigkeit: Kepler liefert sie
// analytisch mit, CelestialBody akkumuliert sie entlang desselben Baums wie die
// Position. Sie ist die Grundlage der Time-Warp-Mitführung — steht sie falsch,
// verliert die Kamera bei hohem Zeitraffer den Planeten unter sich.

import { Orbit } from '../src/physics/Kepler';
import type { OrbitalElements } from '../src/physics/Kepler';
import { Vector3d } from '../src/math/Vector3d';
import { CelestialBody } from '../src/universe/CelestialBody';
import type { BodyParams } from '../src/universe/CelestialBody';
import { AU, DEG, G, SOLAR_MASS, EARTH_MASS } from '../src/core/constants';

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

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-30);

/** Minimaler konkreter Körper — der Renderpfad ist offline nicht prüfbar und hier egal. */
class TestBody extends CelestialBody {
  constructor(params: BodyParams) {
    super(params);
  }
  buildRenderObject(): void {
    /* offline nicht relevant */
  }
}

const el = (over: Partial<OrbitalElements>): OrbitalElements => ({
  a: AU, e: 0, i: 0, Omega: 0, omega: 0, M0: 0, epoch: 0, ...over,
});

// — 1. Vis-Viva ——————————————————————————————————————————————————

console.log('\n1. Bahngeschwindigkeit gegen Vis-Viva');
{
  const mu = G * SOLAR_MASS;
  const pos = new Vector3d();
  const vel = new Vector3d();

  const circular = new Orbit(el({ a: AU }), SOLAR_MASS);
  circular.getStateAtTime(0, pos, vel);
  check('Kreisbahn: |v| = √(µ/a)', rel(vel.length(), Math.sqrt(mu / AU)) < 1e-12,
    `${(vel.length() / 1e3).toFixed(3)} km/s`);

  // Ellipse an mehreren Bahnpunkten: v² = µ(2/r − 1/a)
  const ecc = new Orbit(el({ a: 1.5 * AU, e: 0.4, i: 23 * DEG, Omega: 1.1, omega: 0.7 }), SOLAR_MASS);
  let worst = 0;
  for (let k = 0; k < 24; k++) {
    ecc.getStateAtTime((k / 24) * ecc.period, pos, vel);
    const expected = Math.sqrt(mu * (2 / pos.length() - 1 / (1.5 * AU)));
    worst = Math.max(worst, rel(vel.length(), expected));
  }
  check('Ellipse: Vis-Viva an 24 Bahnpunkten', worst < 1e-10, `max. Abweichung ${worst.toExponential(2)}`);
}

// — 2. Hierarchische Akkumulation ————————————————————————————————

console.log('\n2. Weltgeschwindigkeit entlang des Systembaums');

/** Baut Stern → Planet → Mond an einer wählbaren Weltposition des Sterns. */
function buildSystem(starX: number) {
  const star = new TestBody({ name: 'S', type: 'star', mass: SOLAR_MASS, radius: 7e8, seed: 1 });
  const planet = new TestBody({ name: 'P', type: 'rocky', mass: EARTH_MASS, radius: 6.371e6, seed: 2 });
  const moon = new TestBody({ name: 'M', type: 'rocky', mass: 7.35e22, radius: 1.7374e6, seed: 3 });
  star.position.set(starX, 0, 0);
  planet.attachTo(star, new Orbit(el({ a: AU, e: 0.0167 }), star.mass));
  moon.attachTo(planet, new Orbit(el({ a: 3.844e8, e: 0.0549, i: 5.1 * DEG }), planet.mass));
  return { star, planet, moon };
}

/**
 * Relativer Fehler zwischen der analytischen Geschwindigkeit und der zentralen
 * Differenz der Position. Erwischt jeden Fehler in der Kette — falsches Vorzeichen,
 * vergessener Elternterm, vertauschter Scratch-Vektor.
 */
function velocityError(
  star: CelestialBody, body: CelestialBody, t: number, h: number,
): number {
  const sample = (time: number): Vector3d => {
    star.updateHierarchy(time);
    return body.position.clone();
  };
  const before = sample(t - h);
  const after = sample(t + h);
  star.updateHierarchy(t);
  const fd = new Vector3d().subVectors(after, before).multiplyScalar(1 / (2 * h));
  return new Vector3d().subVectors(body.velocity, fd).length() / body.velocity.length();
}

const T = 1.234e8;

{
  // (a) System am Weltursprung: hier ist die f64-Auflösung kein Thema, der Test
  //     misst also wirklich die Propagationslogik.
  const { star, planet, moon } = buildSystem(0);
  star.updateHierarchy(T);
  check('Wurzelkörper hat v = 0', star.velocity.length() === 0);

  for (const body of [planet, moon]) {
    const err = velocityError(star, body, T, 5);
    check(`${body.name}: v = d/dt Position (System im Ursprung)`, err < 1e-9,
      `Abweichung ${err.toExponential(2)}, |v| = ${(body.velocity.length() / 1e3).toFixed(3)} km/s`);
  }

  // Der Mond muss die Bahngeschwindigkeit des Planeten mittragen, sonst wäre die
  // Mitführung im Freiflug für Monde falsch.
  const relSpeed = new Vector3d().subVectors(moon.velocity, planet.velocity).length();
  check('Mondgeschwindigkeit enthält den Planetenanteil',
    relSpeed < 0.05 * moon.velocity.length() && relSpeed > 900 && relSpeed < 1150,
    `relativ ${(relSpeed / 1e3).toFixed(3)} km/s, absolut ${(moon.velocity.length() / 1e3).toFixed(3)} km/s`);
}

{
  // (b) Dasselbe System 3 Lj vom Ursprung. Die Propagation ist identisch, aber die
  //     *gespeicherte* Absolutposition verliert Stellen: bei 2,8e16 m beträgt der
  //     f64-Abstand rund 6 m. Der Test hält fest, dass die verbleibende Abweichung
  //     genau diese Rundung ist und kein Logikfehler — und beziffert damit, was
  //     Stufe 2 (§3.1, verschachtelte Bezugsrahmen) tatsächlich einbringt.
  const starX = 3 * 9.4607304725808e15;
  const { star, planet } = buildSystem(starX);
  star.updateHierarchy(T);

  const h = 5;
  const err = velocityError(star, planet, T, h);
  const predicted = (4 * starX * 2.22e-16) / (planet.velocity.length() * 2 * h);

  check('Abweichung bei 3 Lj entspricht der f64-Auflösung, nicht einem Logikfehler',
    err > predicted / 20 && err < predicted * 20,
    `gemessen ${err.toExponential(2)}, erwartet ~${predicted.toExponential(2)}`);
  check('Absolutkoordinaten bleiben trotzdem brauchbar (< 1e-4)', err < 1e-4,
    `${(err * planet.velocity.length()).toFixed(2)} m/s absoluter Fehler`);
}

// — 3. Determinismus ————————————————————————————————————————————

console.log('\n3. Reproduzierbarkeit');
{
  const star = new TestBody({ name: 'S', type: 'star', mass: SOLAR_MASS, radius: 7e8, seed: 1 });
  const planet = new TestBody({ name: 'P', type: 'gas', mass: 1.9e27, radius: 7e7, seed: 2 });
  planet.attachTo(star, new Orbit(el({ a: 5.2 * AU, e: 0.048, i: 1.3 * DEG }), star.mass));

  const snapshot = (): string => {
    star.updateHierarchy(9.87e8);
    return `${planet.position.x};${planet.position.y};${planet.position.z};` +
      `${planet.velocity.x};${planet.velocity.y};${planet.velocity.z}`;
  };
  const a = snapshot();
  star.updateHierarchy(1e5); // Zwischenzustand — darf nichts akkumulieren
  check('Zustand ist reine Funktion der Zeit', a === snapshot());

  check('uid ist eindeutig', star.uid !== planet.uid, `${star.uid} / ${planet.uid}`);
}

console.log(`\n${passed} bestanden, ${failures.length} fehlgeschlagen`);
if (failures.length) {
  for (const f of failures) console.log(`  · ${f}`);
  const g = globalThis as { process?: { exitCode?: number } };
  if (g.process) g.process.exitCode = 1;
}
