import {
  BENCH_LAND_DIR,
  BENCH_SIM_TIME,
  BENCH_STOPS,
  BenchSampler,
  type BenchStopResult,
  createBenchRoute,
  createInitialBenchState,
  formatBenchReport,
  stepBenchStateMachine,
} from '../src/perf/benchRoute';
import { FrameStats } from '../src/perf/frameStats';
import { TerrainField } from '../src/terrain/tileGeometry';
import type { TerrainParams } from '../src/terrain/tileGeometry';
import { hashString } from '../src/math/rng';
import { Orbit } from '../src/physics/Kepler';
import { Vector3d } from '../src/math/Vector3d';
import { AU, DEG } from '../src/core/constants';
import catalog from '../src/data/catalog.json' with { type: 'json' };

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}${detail ? ' (' + detail + ')' : ''}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ' (' + detail + ')' : ''}`);
  }
}

function testDeterminismus(): void {
  console.log('Test 1: Determinismus & Routenliste');

  check('BENCH_STOPS hat exakt 6 Halte', BENCH_STOPS.length === 6, `Anzahl: ${BENCH_STOPS.length}`);

  const names = BENCH_STOPS.map((s) => s.name);
  check('Halt-Namen 1 bis 6', names.join(', ') === 'Halt 1, Halt 2, Halt 3, Halt 4, Halt 5, Halt 6');

  const routeA = createBenchRoute();
  const routeB = createBenchRoute();
  check(
    'Route zweimal erzeugt bitgenau identisch (getrennte Objekte)',
    routeA !== routeB && JSON.stringify(routeA) === JSON.stringify(routeB) && JSON.stringify(routeA) === JSON.stringify(BENCH_STOPS),
  );
  check('Simzeit zu Beginn fest (J2000.0)', BENCH_SIM_TIME === 0, `Simzeit ${BENCH_SIM_TIME} s`);
  check('Halt 1 Orbit, Halt 2–6 Freiflug', BENCH_STOPS[0].kind === 'orbit' && BENCH_STOPS.slice(1).every((s) => s.kind !== 'orbit'));
}

interface CatalogDef { name: string; radius: number; mass: number; orbit?: Record<string, number>; terrain?: Partial<TerrainParams>; children?: CatalogDef[] }

function findDef(def: CatalogDef, name: string, parent: CatalogDef | null = null): { def: CatalogDef; parent: CatalogDef | null } | null {
  if (def.name === name) return { def, parent };
  for (const c of def.children ?? []) {
    const hit = findDef(c, name, def);
    if (hit) return hit;
  }
  return null;
}

function testLandUndTag(): void {
  console.log('\nTest 5: Halt 3 über Land, Oberflächenhalte auf der Tagseite');

  const hit = findDef(catalog as CatalogDef, 'Erde');
  const earth = hit?.def;
  const o = earth?.orbit;
  const parent = hit?.parent;
  if (!earth || !o || !parent) {
    check('Erde im Katalog', false);
    return;
  }
  // Wie UniverseManager: TERRAIN_DEFAULTS (octaves 5) + Katalogwerte, Seed aus dem Namen
  const terrain: TerrainParams = { amplitude: 0.003, frequency: 1.8, octaves: 5, ocean: false, oceanLevel: 0, palette: 'gray', maxDepth: 14, resolution: 16, ...earth.terrain };
  const field = new TerrainField({ seed: hashString('Erde'), radius: earth.radius, terrain });
  const d = BENCH_LAND_DIR;
  const n = Math.hypot(d.x, d.y, d.z);
  const raw = field.rawHeight(d.x / n, d.y / n, d.z / n);
  check('Halt 3: Rohhöhe über dem Meeresspiegel', raw > field.oceanH + 100, `Höhe ${raw.toFixed(0)} m, Meeresspiegel ${field.oceanH.toFixed(0)} m`);

  // Gegenprobe: die alte Richtung +x läge nicht auf flachem Land unter dem Sonnenstand
  const rawX = field.rawHeight(1, 0, 0);

  const orbit = new Orbit({
    a: o.a_au * AU, e: o.e, i: o.i_deg * DEG, Omega: o.Omega_deg * DEG, omega: o.omega_deg * DEG, M0: o.M0_deg * DEG, epoch: 0,
  }, parent.mass);
  const pos = new Vector3d();
  orbit.getStateAtTime(BENCH_SIM_TIME, pos);
  const r = pos.length();
  const cosSun = -(pos.x * d.x + pos.y * d.y + pos.z * d.z) / (r * n);
  const cosSunX = -pos.x / r;
  check(
    'Landpunkt auf der Tagseite (Sonne > 60° über dem Horizont)',
    cosSun > Math.sin(60 * DEG),
    `Sonnenhöhe ${(90 - Math.acos(cosSun) / DEG).toFixed(1)}°; alte Richtung +x: ${(90 - Math.acos(cosSunX) / DEG).toFixed(1)}°, Höhe dort ${rawX.toFixed(0)} m`,
  );
}

function testAuswertungJeFrame(): void {
  console.log('\nTest 6: Auswertung aus Einzelframes (20, 60, 120 fps, je 5 s, 3 Ruckler)');

  for (const fps of [20, 60, 120]) {
    const base = 1000 / fps;
    const sampler = new BenchSampler();
    const stats = new FrameStats();
    const rolling: number[] = [];
    let naiveStutters = 0;
    let t = 0;
    const frames = Math.round(5 * fps);
    for (let i = 0; i < frames; i++) {
      const dt = i % Math.floor(frames / 3) === 7 ? base * 4 : base; // drei Ruckler, je 4 × Bildintervall
      t += dt;
      stats.beginFrame(t - 1);
      stats.endFrame(t);
      sampler.add(dt, 1, 10, 1000, 5);
      const summary = stats.getSummary(t); // alter Weg: gleitende HUD-Zusammenfassung je Frame
      rolling.push(summary.dtP50Ms);
      naiveStutters += summary.stutters;
    }
    const m = sampler.summarize();
    rolling.sort((a, b) => a - b);
    const naiveP95 = rolling[Math.floor(rolling.length * 0.95)];
    check(
      `${fps} fps: Ruckler = 3, Bild max = 4 × Intervall`,
      m.stutters === 3 && Math.abs(m.dtMaxMs - 4 * base) < 1e-9 && Math.abs(m.dtP50Ms - base) < 1e-9,
      `p50 ${m.dtP50Ms.toFixed(2)} ms, max ${m.dtMaxMs.toFixed(2)} ms, Ruckler ${m.stutters}`,
    );
    check(
      `${fps} fps: Gegenprobe — alter Weg glättet p95 und zählt Ruckler vielfach`,
      Math.abs(naiveP95 - base) < 0.01 && m.dtMaxMs >= 4 * naiveP95 - 1e-6 && naiveStutters > 10 * m.stutters,
      `alter Weg: p95 ${naiveP95.toFixed(2)} ms, Ruckler ${naiveStutters}`,
    );
  }
}

function testAblaufNachZeit(): void {
  console.log('\nTest 2: Ablauf nach Zeit bei 20, 60 und 120 fps');

  const fpsList = [20, 60, 120];
  const totalDurations: Record<number, number> = {};
  const stopCounts: Record<number, number> = {};

  for (const fps of fpsList) {
    const dt = 1 / fps;
    let state = createInitialBenchState();
    let guard = 0;

    while (state.phase !== 'complete' && guard++ < 10000) {
      const queue = state.phase === 'settling' && state.phaseTime >= 0.5 ? 0 : 5;

      const res = stepBenchStateMachine(state, {
        dtSec: dt,
        pendingQueue: queue,
        getMetricsForCurrentStop: () => ({
          dtP50Ms: 16.6,
          dtP95Ms: 18.0,
          dtMaxMs: 22.0,
          cpuP95Ms: 3.5,
          stutters: 0,
          drawCalls: 12,
          triangles: 15400,
          geometries: 8,
        }),
      });

      state = res.nextState;
    }

    totalDurations[fps] = state.totalTime;
    stopCounts[fps] = state.results.length;

    console.log(`  ${fps} fps: Gesamtdauer = ${state.totalTime.toFixed(2)} s (${state.results.length} Halte)`);
  }

  check('20, 60, 120 fps beenden mit 6 Halten', fpsList.every((fps) => stopCounts[fps] === 6));

  const t20 = totalDurations[20];
  const t60 = totalDurations[60];
  const t120 = totalDurations[120];

  const diffMax = Math.max(Math.abs(t20 - t60), Math.abs(t60 - t120), Math.abs(t20 - t120));
  check('Gesamtdauer bei 20, 60, 120 fps konsistent (± Quantisierung je Phase)', diffMax <= 1.2, `Max. Abweichung: ${diffMax.toFixed(3)} s`);
}

function testEinschwingen(): void {
  console.log('\nTest 3: Einschwingen (bis leer vs. > 15 s Timeout)');

  const dt = 1 / 60;

  // Fall 1: Kachel-Warteschlange wird nach 1,2 s leer
  let state1 = createInitialBenchState();
  while (state1.phase !== 'complete') {
    const queue = state1.phase === 'settling' && state1.phaseTime < 1.2 ? 8 : 0;
    const res = stepBenchStateMachine(state1, { dtSec: dt, pendingQueue: queue });
    state1 = res.nextState;
    if (state1.stopIndex === 0 && state1.phase === 'measuring') break;
  }
  check('Einschwingen < 15 s zeigt "bis leer" Zeit', state1.settleText === '1,2 s', `erhalten: "${state1.settleText}"`);

  // Fall 2: Kachel-Warteschlange bleibt > 0 -> Timeout nach 15 s
  let state2 = createInitialBenchState();
  while (state2.phase !== 'complete') {
    const res = stepBenchStateMachine(state2, { dtSec: dt, pendingQueue: 10 });
    state2 = res.nextState;
    if (state2.stopIndex === 0 && state2.phase === 'measuring') break;
  }
  check('Einschwingen Timeout zeigt "> 15 s"', state2.settleText === '> 15 s', `erhalten: "${state2.settleText}"`);
}

function testAusgabeFormatierung(): void {
  console.log('\nTest 4: Ausgabe, Kopfzeile und deutsche Zahlenformate');

  const dummyResults: BenchStopResult[] = BENCH_STOPS.map((stop) => ({
    stop,
    settleText: '0,5 s',
    metrics: {
      dtP50Ms: 16.7,
      dtP95Ms: 18.2,
      dtMaxMs: 22.1,
      cpuP95Ms: 2.1,
      stutters: 0,
      drawCalls: 12,
      triangles: 15400,
      geometries: 8,
    },
  }));

  const report = formatBenchReport({
    version: 'v0.4.18',
    date: '2026-10-19',
    device: 'iPad (Safari)',
    backend: 'WebGPU',
    renderScale: '1,0×',
  }, dummyResults);

  const lines = report.split('\n');
  check('Report enthält Version v0.4.18', report.includes('Version:** v0.4.18'));
  check('Report enthält Backend WebGPU', report.includes('Backend:** WebGPU'));
  check('Report enthält Renderauflösung 1,0×', report.includes('Renderauflösung:** 1,0×'));

  const tableLines = lines.filter((l) => l.startsWith('|'));
  check('Tabelle hat 8 Zeilen (Header + Trenner + 6 Halte)', tableLines.length === 8, `Zeilen: ${tableLines.length}`);

  const colCounts = tableLines.map((l) => l.split('|').length);
  const firstColCount = colCounts[0];
  const allEqual = colCounts.every((c) => c === firstColCount);
  check('Spaltenzahl in allen Tabellenzeilen gleich', allEqual, `Spalten inkl. Rand: ${firstColCount}`);

  const row1 = tableLines[2];
  check('Deutsches Zahlenformat mit Komma (16,7 ms)', row1.includes('16,7 ms'));
  check('Dreiecke im Tausenderformat (15,4k)', row1.includes('15,4k'));
}

function main(): void {
  console.log('=== Test Messlauf (?bench) & BenchRoute ===');
  testDeterminismus();
  testAblaufNachZeit();
  testEinschwingen();
  testAusgabeFormatierung();
  testLandUndTag();
  testAuswertungJeFrame();

  console.log(`\n${passed} bestanden, ${failures.length} fehlgeschlagen`);
  if (failures.length) {
    for (const f of failures) console.log(`  · ${f}`);
    const g = globalThis as { process?: { exitCode?: number } };
    if (g.process) g.process.exitCode = 1;
  }
}

main();
