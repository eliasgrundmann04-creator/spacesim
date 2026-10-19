import { Glide } from '../src/nav/glide';
import { parseFeel, FEEL, DEFAULT_FEEL } from '../src/nav/feel';
import { Navigator } from '../src/nav/Navigator';
import { vec3 } from '../src/nav/vec';
import type { BodyRef } from '../src/nav/types';

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    throw err;
  }
}

function assertStrictEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(message ?? `Expected ${expected}, got ${actual}`);
  }
}

function assertDeepStrictEqual<T>(actual: T, expected: T, message?: string): void {
  const aStr = JSON.stringify(actual);
  const eStr = JSON.stringify(expected);
  if (aStr !== eStr) {
    throw new Error(message ?? `Expected ${eStr}, got ${aStr}`);
  }
}

function assertOk(value: boolean, message?: string): void {
  if (!value) {
    throw new Error(message ?? 'Assertion failed');
  }
}

console.log('\n--- Offline-Test: Gleitflug (Pinch ist Schub) ---\n');

const defaultBasis = {
  forward: vec3(0, 0, -1),
  right: vec3(1, 0, 0),
  up: vec3(0, 1, 0),
};

const baseInput = {
  forward: 0,
  right: 0,
  up: 0,
  speedScale: 1,
  assist: true,
  brake: false,
};

// 1. Ruhe
console.log('1. Ruhe');
run('Ohne Geste liefert der Gleitkern über 10 s ein Kommando mit forward = right = up = 0 (bitgenau)', () => {
  FEEL.glide = 1;
  const glide = new Glide();
  glide.reset();
  for (let t = 0; t < 10; t += 0.1) {
    const cmd = glide.step(0.1, defaultBasis, baseInput);
    assertStrictEqual(cmd.forward, 0);
    assertStrictEqual(cmd.right, 0);
    assertStrictEqual(cmd.up, 0);
    assertStrictEqual(cmd.speedScale, 1);
  }
});

run('Ohne glide:1 (feel.glide = 0) ist die Eingabe an den Navigator identisch zur bisherigen', () => {
  FEEL.glide = 0;
  const glide = new Glide();
  glide.begin();
  glide.pinch(0.5);
  glide.end();
  const dummyInput = { forward: 0.1, right: 0.2, up: 0.3, speedScale: 2, assist: true, brake: false };
  const cmd = glide.step(0.1, defaultBasis, dummyInput);
  assertDeepStrictEqual(cmd, dummyInput);
});

// 2. Aufteilung
console.log('\n2. Aufteilung');
run('Spreizen um Faktor 2 in einem Ereignis ergibt dasselbe s wie in 50 Ereignissen (< 1e-9)', () => {
  FEEL.glide = 1;
  const lambdaTotal = Math.log(2);

  const g1 = new Glide();
  g1.begin();
  g1.pinch(lambdaTotal);
  g1.end();
  const s1 = g1.getSpeed();

  const g50 = new Glide();
  g50.begin();
  for (let i = 0; i < 50; i++) {
    g50.pinch(lambdaTotal / 50);
  }
  g50.end();
  const s50 = g50.getSpeed();

  assertOk(Math.abs(s1 - s50) < 1e-9, `Diff: ${Math.abs(s1 - s50)}`);
});

run('Bremsen bis kurz vor null ebenfalls linear additiv', () => {
  FEEL.glide = 1;
  const lambdaStart = Math.log(3);
  const lambdaBrakeTotal = -Math.log(1.5);

  const g1 = new Glide();
  g1.begin();
  g1.pinch(lambdaStart);
  g1.pinch(lambdaBrakeTotal);
  g1.end();

  const g50 = new Glide();
  g50.begin();
  g50.pinch(lambdaStart);
  for (let i = 0; i < 50; i++) {
    g50.pinch(lambdaBrakeTotal / 50);
  }
  g50.end();

  assertOk(Math.abs(g1.getSpeed() - g50.getSpeed()) < 1e-9);
});

// 3. Bremsraste
console.log('\n3. Bremsraste');
run('s = 1, Zusammenziehen um Faktor 10 in einer Geste => s = 0, nicht negativ', () => {
  FEEL.glide = 1;
  const glide = new Glide();
  // Vorwärtsfahrt auf ca. 1.0 bringen
  glide.begin();
  glide.pinch(1.0 / FEEL.glideGain);
  assertOk(Math.abs(glide.getSpeed() - 1.0) < 1e-9);

  // Stark bremsen
  glide.pinch(-Math.log(10));
  assertStrictEqual(glide.getSpeed(), 0);
  glide.end();
});

run('Eine neue Geste aus der Ruhe fährt rückwärts', () => {
  FEEL.glide = 1;
  const glide = new Glide();
  glide.begin();
  glide.pinch(-Math.log(2));
  glide.end();
  assertOk(glide.getSpeed() < 0, `Speed: ${glide.getSpeed()}`);
});

run('Spiegelbildlich: Rückwärtsfahrt, Spreizen um Faktor 10 => s = 0, nicht positiv', () => {
  FEEL.glide = 1;
  const glide = new Glide();
  glide.begin();
  glide.pinch(-Math.log(2)); // Rückwärts
  assertOk(glide.getSpeed() < 0);
  glide.pinch(Math.log(10)); // Spreizen
  assertStrictEqual(glide.getSpeed(), 0);
  glide.end();
});

// 4. Halbwertszeit
console.log('\n4. Halbwertszeit');
run('Nach glideHalfLife ohne Eingabe gilt s = s₀/2 (± 1e-9), bei 20, 30, 60 und 120 fps identisch', () => {
  FEEL.glide = 1;
  FEEL.glideHalfLife = 5;

  const fpsList = [20, 30, 60, 120];
  const results: number[] = [];

  for (const fps of fpsList) {
    const glide = new Glide();
    glide.begin();
    glide.pinch(Math.log(2));
    glide.end();
    const s0 = glide.getSpeed();

    const dt = 1 / fps;
    const steps = Math.round(FEEL.glideHalfLife * fps);
    for (let i = 0; i < steps; i++) {
      glide.step(dt, defaultBasis, baseInput);
    }
    const sEnd = glide.getSpeed();
    assertOk(Math.abs(sEnd - s0 / 2) < 1e-9, `fps ${fps}: sEnd ${sEnd}, s0/2 ${s0 / 2}`);
    results.push(sEnd);
  }

  for (let i = 1; i < results.length; i++) {
    assertOk(Math.abs(results[i] - results[0]) < 1e-12);
  }
});

// 5. Kopplung
console.log('\n5. Kopplung');
run('Nach 90°-Sprung der Blickrichtung ist der Restwinkel nach 3 · glideCoupleTau gleich 90° · e⁻³ (± 1 %) bei 20, 30, 60, 120 fps', () => {
  FEEL.glide = 1;
  FEEL.glideCoupleTau = 0.5;

  const fpsList = [20, 30, 60, 120];
  const expectedRestAngle = (Math.PI / 2) * Math.exp(-3);

  for (const fps of fpsList) {
    const glide = new Glide();
    glide.begin();
    glide.pinch(Math.log(2)); // s > 0
    glide.end();

    // Startblick: +Z
    const basisInitial = { forward: vec3(0, 0, 1), right: vec3(1, 0, 0), up: vec3(0, 1, 0) };
    glide.step(0.01, basisInitial, baseInput);

    // Blick springt um 90° auf +X
    const basisTurned = { forward: vec3(1, 0, 0), right: vec3(0, 0, -1), up: vec3(0, 1, 0) };

    const totalTime = 3 * FEEL.glideCoupleTau;
    const dt = 1 / fps;
    const steps = Math.round(totalTime * fps);

    for (let i = 0; i < steps; i++) {
      glide.step(dt, basisTurned, baseInput);
    }

    const u = glide.getDirection();
    // Winkel zwischen u (jetzt nahe +X) und Blick (+X)
    const cosAngle = u.x; // dot(u, forward)
    const restAngle = Math.acos(Math.min(1, Math.max(-1, cosAngle)));

    const relDiff = Math.abs(restAngle - expectedRestAngle) / expectedRestAngle;
    assertOk(relDiff < 0.01, `fps ${fps}: restAngle ${restAngle}, expected ${expectedRestAngle}, diff ${relDiff}`);
  }
});

run('Bei Rückwärtsfahrt läuft die Flugrichtung auf -forward', () => {
  FEEL.glide = 1;
  FEEL.glideCoupleTau = 0.5;

  const glide = new Glide();
  glide.begin();
  glide.pinch(-Math.log(2)); // s < 0
  glide.end();

  const basis = { forward: vec3(0, 0, 1), right: vec3(1, 0, 0), up: vec3(0, 1, 0) };
  for (let i = 0; i < 100; i++) {
    glide.step(0.1, basis, baseInput);
  }

  const u = glide.getDirection();
  // u sollte nahe -forward = (0, 0, -1) sein
  assertOk(Math.abs(u.z - (-1)) < 1e-4, `u.z: ${u.z}`);
});

// 6. Deckel
console.log('\n6. Deckel');
run('1000 Spreizgesten hintereinander => immer s <= glideMax; rückwärts immer |s| <= glideMaxBack', () => {
  FEEL.glide = 1;
  const glide = new Glide();

  // Vorwärts
  glide.begin();
  for (let i = 0; i < 1000; i++) {
    glide.pinch(Math.log(1.5));
  }
  glide.end();
  assertOk(glide.getSpeed() <= FEEL.glideMax + 1e-9);
  assertStrictEqual(glide.getSpeed(), FEEL.glideMax);

  // Reset & Rückwärts
  glide.reset();
  glide.begin();
  for (let i = 0; i < 1000; i++) {
    glide.pinch(-Math.log(1.5));
  }
  glide.end();
  assertOk(Math.abs(glide.getSpeed()) <= FEEL.glideMaxBack + 1e-9);
  assertStrictEqual(glide.getSpeed(), -FEEL.glideMaxBack);
});

// 7. Flug-Szenario
console.log('\n7. Flug-Szenario');
run('Start in 2 m Höhe mit Blick senkrecht nach oben, alle 2 s Spreizgeste um Faktor 3. Höhe 1.9e8 m wird bei 20, 60, 120 fps erreicht, Ankunftszeiten weichen < 2 % ab', () => {
  FEEL.glide = 1;

  const earthRadius = 6_371_000;
  const earth: BodyRef = {
    id: 'earth',
    name: 'Erde',
    position: vec3(0, 0, 0),
    radius: earthRadius,
    velocity: vec3(0, 0, 0),
  };
  const bodies = [earth];

  const targetAltitude = 1.9e8;
  const fpsList = [20, 60, 120];
  const arrivalTimes: number[] = [];

  for (const fps of fpsList) {
    FEEL.glide = 1;
    FEEL.glideGain = DEFAULT_FEEL.glideGain;
    FEEL.glideBrake = DEFAULT_FEEL.glideBrake;
    FEEL.glideMax = DEFAULT_FEEL.glideMax;
    FEEL.glideHalfLife = DEFAULT_FEEL.glideHalfLife;
    FEEL.glideCoupleTau = DEFAULT_FEEL.glideCoupleTau;

    const nav = new Navigator();
    const glide = new Glide();
    glide.reset();

    // Start 2 m über der Erdoberfläche
    let camPos = vec3(0, 0, earthRadius + 2);
    // Blick senkrecht nach oben (+Z)
    const basis = { forward: vec3(0, 0, 1), right: vec3(1, 0, 0), up: vec3(0, 1, 0) };

    let simTime = 0;
    const dt = 1 / fps;
    let nextPinchTime = 0;

    while (simTime < 300) {
      if (simTime >= nextPinchTime) {
        glide.begin();
        glide.pinch(Math.log(3));
        glide.end();
        nextPinchTime += 2;
      }

      const input = glide.step(dt, basis, baseInput);
      const res = nav.update({ position: camPos, ...basis }, bodies, input, dt);
      camPos = res.position;

      const alt = res.altitude;
      if (alt >= targetAltitude) {
        arrivalTimes.push(simTime);
        break;
      }

      simTime += dt;
    }
  }

  assertStrictEqual(arrivalTimes.length, 3);
  const [t20, t60, t120] = arrivalTimes;
  console.log(`    Ankunftszeiten: 20 fps = ${t20.toFixed(2)}s, 60 fps = ${t60.toFixed(2)}s, 120 fps = ${t120.toFixed(2)}s`);

  const avg = (t20 + t60 + t120) / 3;
  assertOk(Math.abs(t20 - avg) / avg < 0.02, `t20 diff: ${Math.abs(t20 - avg) / avg}`);
  assertOk(Math.abs(t60 - avg) / avg < 0.02, `t60 diff: ${Math.abs(t60 - avg) / avg}`);
  assertOk(Math.abs(t120 - avg) / avg < 0.02, `t120 diff: ${Math.abs(t120 - avg) / avg}`);
});

// 8. Feel
console.log('\n8. Feel');
run('parseFeel("?feel=glide:1,glideHalfLife:8") setzt genau diese zwei Werte; Bereiche werden geklemmt', () => {
  parseFeel('?feel=glide:1,glideHalfLife:8');
  assertStrictEqual(FEEL.glide, 1);
  assertStrictEqual(FEEL.glideHalfLife, 8);
  assertStrictEqual(FEEL.glideGain, DEFAULT_FEEL.glideGain);

  // Klemmung prüfen
  parseFeel('?feel=glideHalfLife:100,glideBrake:0.01');
  assertStrictEqual(FEEL.glideHalfLife, 60); // Max in FEEL_RANGES
  assertStrictEqual(FEEL.glideBrake, 0.05); // Min in FEEL_RANGES
});

console.log('\nOffline-Tests Gleitflug erfolgreich abgeschlossen.');
