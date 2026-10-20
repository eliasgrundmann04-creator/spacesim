import {
  BENCH_STOPS,
  type BenchStopResult,
  createInitialBenchState,
  formatBenchReport,
  stepBenchStateMachine,
} from '../src/perf/benchRoute';

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

  const routeA = BENCH_STOPS;
  const routeB = BENCH_STOPS;
  check('Route zweimal abgefragt bitgenau identisch', JSON.stringify(routeA) === JSON.stringify(routeB));
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

  console.log(`\n${passed} bestanden, ${failures.length} fehlgeschlagen`);
  if (failures.length) {
    for (const f of failures) console.log(`  · ${f}`);
    const g = globalThis as { process?: { exitCode?: number } };
    if (g.process) g.process.exitCode = 1;
  }
}

main();
