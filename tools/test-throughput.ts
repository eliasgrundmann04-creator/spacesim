// Offline-Tests für Fluggeschwindigkeit und Kachel-Durchsatz (§8).
// Start:  node --import ./tools/register-ts.mjs tools/test-throughput.ts
//
// Beide Abschnitte sichern je einen Hardware-Befund ab, den die bisherigen Tests
// nicht sehen konnten, weil sie nur bei 60 fps und ohne Ausfälle liefen.

import { DEFAULT_FLIGHT, stepFlight } from '../src/nav/flightKernel';
import { THRUST_EPSILON, neutralInput, throttleToForward } from '../src/nav/types';
import type { BodyRef } from '../src/nav/types';
import { evaluateProximity, DEFAULT_PROXIMITY } from '../src/nav/proximity';
import { length, vec3 } from '../src/nav/vec';
import { TerrainProvider } from '../src/terrain/TerrainProvider';
import { TerrainField } from '../src/terrain/tileGeometry';
import type { TerrainSpec, TileSpec } from '../src/terrain/tileGeometry';

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

// — Testszene ——————————————————————————————————————————————————

const R_EARTH = 6.371e6;
const bodies: BodyRef[] = [{ id: 'earth', name: 'Erde', position: vec3(0, 0, 0), radius: R_EARTH }];
const basis = { forward: vec3(1, 0, 0), right: vec3(0, -1, 0), up: vec3(0, 0, 1) };
const START = vec3(R_EARTH + 1e6, 0, 0); // 1000 km Höhe

/** Fliegt `seconds` mit Vollschub und liefert die erreichte Höhe. */
function flyTo(fps: number, speedScale: number, seconds: number): number {
  const dt = 1 / fps;
  const input = { ...neutralInput(), forward: 1, speedScale };
  let p = START;
  let v = vec3();
  for (let i = 0; i < Math.round(seconds * fps); i++) {
    const s = stepFlight(p, v, basis, input, bodies, vec3(), dt, DEFAULT_FLIGHT);
    p = s.position;
    v = s.relVelocity;
  }
  return length(p) - R_EARTH;
}

// — 1. Geschwindigkeit ist framerate-unabhängig ————————————————

section('1. Fluggeschwindigkeit hängt nicht an der Framerate');
{
  // Bis v0.3 folgte der Deckel aus maxStepFraction · maxSubsteps · ref **pro Frame**,
  // war also 1,5·ref/dt: bei 60 fps 90·ref/s, bei 20 fps nur 30·ref/s. Auf dem Tablet
  // sättigte die Geschwindigkeit damit weit vor der obersten Reglerstufe.
  const rates = [120, 60, 30, 20];
  for (const scale of [1, 10, 30, 100]) {
    const reached = rates.map((f) => flyTo(f, scale, 2));
    const spread = Math.max(...reached) / Math.min(...reached) - 1;
    check(`×${scale}: gleiche Strecke bei 20…120 fps`, spread < 0.02,
      `Streuung ${(spread * 100).toFixed(2)} %`);
  }
}

{
  // Sollgeschwindigkeit an fester Position (dt so klein, dass die Kamera sich
  // innerhalb des Frames praktisch nicht bewegt): reine Funktion von Höhe und Stufe.
  const ref = evaluateProximity(START, bodies, DEFAULT_PROXIMITY).reference;
  const commanded = (scale: number, dt: number) => stepFlight(
    START, vec3(), basis, { ...neutralInput(), forward: 1, speedScale: scale },
    bodies, vec3(), dt, DEFAULT_FLIGHT,
  ).referenceSpeed;

  const expected = DEFAULT_FLIGHT.rate * ref * 100;
  const err = Math.abs(commanded(100, 1e-5) / expected - 1);
  check('Sollgeschwindigkeit = rate · Referenzhöhe · Stufe', err < 1e-6,
    `${(commanded(100, 1e-5) / 1e6).toFixed(3)} Mm/s bei ref = ${(ref / 1e3).toFixed(0)} km`);
  check('×100 ist auch wirklich 100× so schnell wie ×1',
    Math.abs(commanded(100, 1e-5) / commanded(1, 1e-5) - 100) < 1e-6);

  // Gegenprobe mit dem alten, framebasierten Deckel (maxStepFraction · maxSubsteps
  // · ref **pro Frame**): der greift bei 30 fps mitten in den Regelbereich hinein.
  const oldCap = (fps: number) =>
    DEFAULT_FLIGHT.maxStepFraction * DEFAULT_FLIGHT.maxSubsteps * ref * fps;
  check('alter Deckel hätte ×100 bei 30 fps auf die Hälfte gestutzt',
    oldCap(30) < 0.6 * expected && oldCap(120) > expected,
    `30 fps: ${(oldCap(30) / 1e6).toFixed(0)} Mm/s, 120 fps: ${(oldCap(120) / 1e6).toFixed(0)} Mm/s, ` +
    `gefordert ${(expected / 1e6).toFixed(0)}`);
  check('neuer Deckel liegt über dem gesamten Regelbereich',
    DEFAULT_FLIGHT.maxReferenceRate * ref > expected,
    `${(DEFAULT_FLIGHT.maxReferenceRate * ref / 1e6).toFixed(0)} Mm/s`);
}

{
  // Schärfe des Streckentests: mit dem alten Deckel liefe er weit auseinander.
  const rates = [120, 60, 30, 20];
  const reached = rates.map((fps) => {
    const dt = 1 / fps;
    const cfg = {
      ...DEFAULT_FLIGHT,
      // alte Formel, in der neuen Konfiguration nachgebaut
      maxReferenceRate: DEFAULT_FLIGHT.maxStepFraction * DEFAULT_FLIGHT.maxSubsteps / dt,
    };
    const input = { ...neutralInput(), forward: 1, speedScale: 100 };
    let p = START;
    let v = vec3();
    for (let i = 0; i < Math.round(2 * fps); i++) {
      const st = stepFlight(p, v, basis, input, bodies, vec3(), dt, cfg);
      p = st.position; v = st.relVelocity;
    }
    return length(p) - R_EARTH;
  });
  const spread = Math.max(...reached) / Math.min(...reached) - 1;
  check('Regression: mit dem alten Deckel streuen dieselben 2 s massiv', spread > 1,
    `Faktor ${(spread + 1).toExponential(1)} zwischen 20 und 120 fps`);
}

{
  // Frame-Jitter darf die Anzeige nicht flackern lassen: zwei Läufe mit gleicher
  // Gesamtzeit, einmal mit stark schwankendem dt.
  function run(jitter: boolean): number {
    const input = { ...neutralInput(), forward: 1, speedScale: 30 };
    let p = START;
    let v = vec3();
    let t = 0;
    let i = 0;
    while (t < 1) {
      const dt = Math.min(jitter ? (i % 2 === 0 ? 1 / 60 : 1 / 20) : 1 / 30, 1 - t);
      const s = stepFlight(p, v, basis, input, bodies, vec3(), dt, DEFAULT_FLIGHT);
      p = s.position; v = s.relVelocity; t += dt; i++;
    }
    return length(p) - R_EARTH;
  }
  const rel = Math.abs(run(true) / run(false) - 1);
  check('starker dt-Jitter ändert die Strecke nicht', rel < 0.02,
    `Abweichung ${(rel * 100).toFixed(2)} %`);
}

{
  // Der Deckel selbst muss weiter greifen — nur eben dt-unabhängig.
  const wild = vec3(1e15, 0, 0); // von außen gesetzter Unsinn
  const s = stepFlight(START, wild, basis, { ...neutralInput() }, bodies, vec3(), 1 / 60, DEFAULT_FLIGHT);
  const ref = evaluateProximity(START, bodies, DEFAULT_PROXIMITY).reference;
  check('extern gesetzte Geschwindigkeit wird weiterhin gedeckelt',
    s.relativeSpeed <= DEFAULT_FLIGHT.maxReferenceRate * ref * 1.001,
    `${(s.relativeSpeed / 1e6).toFixed(1)} Mm/s ≤ ${(DEFAULT_FLIGHT.maxReferenceRate * ref / 1e6).toFixed(1)}`);
}

// — 2. Schubkennlinie ————————————————————————————————————————————

section('2. Schubregler: Totzone statt versteckter 27-%-Schwelle');
{
  check('Mittelstellung ergibt exakt null Schub', throttleToForward(0) === 0);
  check('Zittern unterhalb der Totzone bleibt wirkungslos',
    throttleToForward(0.03) === 0 && throttleToForward(-0.03) === 0);
  check('10 % Reglerweg lösen den Schub aus',
    Math.abs(throttleToForward(0.1)) > THRUST_EPSILON,
    `forward = ${throttleToForward(0.1).toExponential(2)}`);
  check('Anschlag liefert exakt ±1',
    throttleToForward(1) === 1 && throttleToForward(-1) === -1);
  check('Kennlinie ist streng monoton und stetig', (() => {
    let last = -1.0000001;
    for (let x = -1; x <= 1.0001; x += 0.005) {
      const y = throttleToForward(x);
      if (y < last - 1e-12) return false;
      if (Math.abs(y - last) > 0.02) return false;
      last = y;
    }
    return true;
  })());
  // Regression: mit der alten Schwelle 0.02 hätte 27 % Reglerweg nichts bewirkt.
  check('alte Schwelle hätte ein Viertel des Reglerwegs verschluckt',
    Math.abs(throttleToForward(0.26)) < 0.02 && Math.abs(throttleToForward(0.26)) > THRUST_EPSILON,
    `forward(26 %) = ${throttleToForward(0.26).toFixed(5)}`);
}

// — 3. Robustheit gegen entartete Körper ————————————————————————

section('3. Ein defekter Körper legt nicht die ganze Navigation lahm');
{
  const poisoned: BodyRef[] = [
    { id: 'ok', position: vec3(0, 0, 0), radius: R_EARTH },
    { id: 'nan', position: vec3(NaN, 0, 0), radius: 1e6 },
  ];
  const prox = evaluateProximity(START, poisoned, DEFAULT_PROXIMITY);
  check('Referenzhöhe bleibt endlich', Number.isFinite(prox.reference),
    `${(prox.reference / 1e3).toFixed(0)} km`);
  check('Anker ist der gesunde Körper', prox.anchor?.id === 'ok');

  const s = stepFlight(
    START, vec3(), basis, { ...neutralInput(), forward: 1 }, poisoned, vec3(), 1 / 60, DEFAULT_FLIGHT,
  );
  check('Kameraposition bleibt endlich',
    Number.isFinite(s.position.x) && Number.isFinite(s.position.y) && Number.isFinite(s.position.z));
}

// — 4. Kachel-Warteschlange ————————————————————————————————————

section('4. Kachel-Durchsatz überlebt tote Worker');

const spec: TerrainSpec = {
  seed: 1234,
  radius: R_EARTH,
  terrain: {
    amplitude: 0.002, frequency: 1.6, octaves: 3,
    ocean: false, oceanLevel: 0, palette: 'gray',
    maxDepth: 10, resolution: 8,
  },
};
const field = new TerrainField(spec);
const tileAt = (level: number): TileSpec => ({
  face: 0, level, u0: -1, v0: -1, resolution: 8,
  centerX: R_EARTH, centerY: 0, centerZ: 0,
});

/** Worker-Attrappe: antwortet, schweigt oder wirft — je nach Modus. */
function fakeWorker(mode: 'reply' | 'silent'): Worker & { flush: () => void } {
  const inbox: number[] = [];
  const w = {
    onmessage: null as ((e: MessageEvent) => void) | null,
    onerror: null as ((e: Event) => void) | null,
    onmessageerror: null as ((e: Event) => void) | null,
    postMessage(msg: { jobId: number }) {
      if (mode === 'reply') inbox.push(msg.jobId);
    },
    terminate() { inbox.length = 0; },
    flush() {
      for (const jobId of inbox.splice(0)) {
        w.onmessage?.({
          data: {
            jobId,
            positions: new Float32Array(3),
            normals: new Float32Array(3),
            colors: new Float32Array(3),
            boundingRadius: 1,
          },
        } as MessageEvent);
      }
    },
  };
  return w as unknown as Worker & { flush: () => void };
}

async function provider(mode: 'reply' | 'silent'): Promise<{
  p: TerrainProvider; workers: (Worker & { flush: () => void })[];
}> {
  const workers: (Worker & { flush: () => void })[] = [];
  const p = new TerrainProvider();
  await p.configure({
    backend: 'worker',
    createWorker: () => {
      const w = fakeWorker(mode);
      workers.push(w);
      return w;
    },
  });
  p.jobTimeoutMs = 0;   // Wachhund im Test sofort scharf
  p.jobTimeoutPumps = 2;
  return { p, workers };
}

{
  const { p, workers } = await provider('reply');
  let done = 0;
  for (let i = 0; i < 12; i++) {
    p.request(field, spec, tileAt(3), 1e6 - i, () => { done++; });
  }
  for (let round = 0; round < 12; round++) {
    p.pump();
    for (const w of workers) w.flush();
  }
  check('gesunder Pool arbeitet die Warteschlange ab', done === 12 && p.pending === 0,
    `${done}/12 fertig, ${p.pending} offen`);
  check('keine verlorenen Jobs gezählt', p.lost === 0);
}

{
  // Der eigentliche Befund: Worker verstummt. Vorher blieb sein Platz für immer
  // belegt — nach JOBS_PER_WORKER Fällen entstand keine Kachel mehr, und ein frisch
  // erzeugter Planet blieb bis zum Neustart unsichtbar.
  const { p } = await provider('silent');
  let answered = 0;
  for (let i = 0; i < 20; i++) {
    p.request(field, spec, tileAt(3), 1e6 - i, (b) => { if (b) answered++; });
  }
  for (let round = 0; round < 40; round++) p.pump();

  check('Wachhund gibt die Plätze verstummter Worker frei', p.lost > 0,
    `${p.lost} Jobs als verloren erkannt`);
  check('Provider fällt auf den synchronen Pfad zurück', p.backend === 'sync',
    `Backend jetzt "${p.backend}"`);

  for (let round = 0; round < 40; round++) p.pump();
  check('danach entstehen wieder Kacheln', answered > 0 && p.built > 0,
    `${p.built} Kacheln gebaut`);
}

{
  // Priorität muss nachführbar sein — sonst sortiert die Warteschlange nach dem
  // Standort zum Anfragezeitpunkt, und genau nach einem Anflug ist der falsch.
  const { p, workers } = await provider('reply');
  const order: string[] = [];
  const far = p.request(field, spec, tileAt(3), 1e12, () => order.push('fern'));
  p.request(field, spec, tileAt(3), 1e3, () => order.push('nah'));
  p.reprioritize(far, 1); // die "ferne" Kachel steht jetzt direkt vor der Kamera
  p.pump();
  for (const w of workers) w.flush();
  check('reprioritize ändert die Abarbeitungsreihenfolge', order[0] === 'fern',
    `Reihenfolge ${order.join(' → ')}`);
}

{
  // Abgebrochene Jobs dürfen den Platz nicht mitnehmen.
  const { p, workers } = await provider('reply');
  const ids: number[] = [];
  for (let i = 0; i < 6; i++) ids.push(p.request(field, spec, tileAt(3), i, () => {}));
  p.pump();
  for (const id of ids) p.cancel(id);
  for (const w of workers) w.flush();
  let built = 0;
  for (let i = 0; i < 6; i++) p.request(field, spec, tileAt(3), i, (b) => { if (b) built++; });
  for (let round = 0; round < 6; round++) {
    p.pump();
    for (const w of workers) w.flush();
  }
  check('nach cancel() bleiben die Worker-Plätze nutzbar', built === 6 && p.lost === 0,
    `${built}/6 neue Kacheln, ${p.lost} verloren`);
}

// — Ergebnis ——————————————————————————————————————————————————————

console.log(`\n${passed} bestanden, ${failures.length} fehlgeschlagen`);
if (failures.length) {
  for (const f of failures) console.log(`  · ${f}`);
  const g = globalThis as { process?: { exitCode?: number } };
  if (g.process) g.process.exitCode = 1;
}
