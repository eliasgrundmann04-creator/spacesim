import { FrameStats, calculatePercentile, NUM_PHASES } from '../src/perf/frameStats';

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

function near(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) < eps;
}

function testPercentiles(): void {
  console.log('Test 1: Perzentile stimmen (Type 7 lineare Interpolation)');

  const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const p50 = calculatePercentile(samples, samples.length, 0.5);
  const p95 = calculatePercentile(samples, samples.length, 0.95);
  const max = calculatePercentile(samples, samples.length, 1.0);

  check('p50 exakt 55.0', near(p50, 55), `erhalten ${p50}`);
  check('p95 exakt 95.5', near(p95, 95.5), `erhalten ${p95}`);
  check('max exakt 100.0', near(max, 100), `erhalten ${max}`);

  const stats = new FrameStats(100, 10000);
  let t = 1000;
  for (let i = 0; i < samples.length; i++) {
    t += samples[i];
    stats.beginFrame(t - samples[i]);
    stats.endFrame(t);
  }
  const summary = stats.getSummary(t);
  check('Summary dtP50Ms', near(summary.dtP50Ms, 55), `erhalten ${summary.dtP50Ms}`);
  check('Summary dtP95Ms', near(summary.dtP95Ms, 95.5), `erhalten ${summary.dtP95Ms}`);
  check('Summary dtMaxMs', near(summary.dtMaxMs, 100), `erhalten ${summary.dtMaxMs}`);
}

function testTimeWindow(): void {
  console.log('\nTest 2: Zeitfenster (5 s), nicht Frame-Fenster bei 20, 60, 120 fps');

  const fpsList = [20, 60, 120];

  for (const fps of fpsList) {
    const frameMs = 1000 / fps;
    const stats = new FrameStats(2000, 5000);

    let t = 1000;
    const normalFrames = Math.floor(5000 / frameMs);
    for (let i = 0; i < normalFrames; i++) {
      stats.beginFrame(t);
      t += frameMs;
      stats.endFrame(t);
    }

    // 1 Spike von 100 ms
    stats.beginFrame(t);
    t += 100;
    stats.endFrame(t);

    const sumWithSpike = stats.getSummary(t);
    check(`${fps} fps: 1 Ruckler beim 100ms Spike`, sumWithSpike.stutters === 1, `Ruckler ${sumWithSpike.stutters}`);
    check(`${fps} fps: Max dt == 100ms`, sumWithSpike.dtMaxMs === 100, `Max ${sumWithSpike.dtMaxMs}`);

    // 5,1 s spätere Frames nachschieben -> Spike muss vollständig verschwunden sein
    const postFrames = Math.ceil(5100 / frameMs);
    for (let i = 0; i < postFrames; i++) {
      stats.beginFrame(t);
      t += frameMs;
      stats.endFrame(t);
    }

    const sumAfter = stats.getSummary(t);
    check(`${fps} fps: 0 Ruckler nach 5s`, sumAfter.stutters === 0, `Ruckler ${sumAfter.stutters}`);
    check(`${fps} fps: Spike aus Fenster verschwunden`, sumAfter.dtMaxMs < 100, `Max ${sumAfter.dtMaxMs} ms, Samples ${sumAfter.sampleCount}`);
  }
}

function testStutters(): void {
  console.log('\nTest 3: Ruckler-Logik (> 2 * Median)');

  const stats = new FrameStats(500, 5000);
  let t = 1000;

  // Steady 60 fps mit ±10 % Zittern (15,0 ms bis 18,3 ms)
  const jitterValues = [15.0, 16.0, 16.7, 17.5, 18.3, 16.5, 15.5, 17.0, 16.6, 16.8];
  for (let i = 0; i < 30; i++) {
    const dt = jitterValues[i % jitterValues.length];
    stats.beginFrame(t);
    t += dt;
    stats.endFrame(t);
  }

  const sumJitter = stats.getSummary(t);
  check('Gleichmäßige 60 fps (±10 %): 0 Ruckler', sumJitter.stutters === 0, `erhalten ${sumJitter.stutters}`);

  // 1 Ruckler einfügen (35 ms > 2 * ~16.6 ms)
  stats.beginFrame(t);
  t += 35;
  stats.endFrame(t);

  const sumStutter = stats.getSummary(t);
  check('35 ms Spike: 1 Ruckler', sumStutter.stutters === 1, `erhalten ${sumStutter.stutters}`);
}

function testPhases(): void {
  console.log('\nTest 4: Phasen-Addition & Behandlung fehlender Phasen');

  const stats = new FrameStats(100, 5000);
  let t = 1000;

  stats.beginFrame(t);
  let current = t;
  const phaseDurations = [1.0, 0.5, 1.5, 0.8, 2.0, 0.2, 4.0];
  for (let p = 0; p < NUM_PHASES; p++) {
    current += phaseDurations[p];
    stats.mark(p, current);
  }
  stats.endFrame(current);

  const sum1 = stats.getSummary(current);
  const phaseSum = sum1.phaseAvgMs.reduce((a, b) => a + b, 0);
  check('Phasen addieren sich zur CPU-Zeit (< 0.01 ms Abweichung)', Math.abs(phaseSum - sum1.cpuLastMs) < 0.01, `Summe ${phaseSum.toFixed(1)} ms == CPU ${sum1.cpuLastMs.toFixed(1)} ms`);

  // Frame, in dem Phase 3 übersprungen wird
  stats.beginFrame(current);
  let t2 = current;
  for (let p = 0; p < NUM_PHASES; p++) {
    if (p === 3) continue;
    t2 += 1.0;
    stats.mark(p, t2);
  }
  stats.endFrame(t2);

  const sum2 = stats.getSummary(t2);
  check('Fehlende Phase zählt als 0 (Mittelwert 0.4 ms)', near(sum2.phaseAvgMs[3], 0.4), `erhalten ${sum2.phaseAvgMs[3]}`);
}

function testPerformanceCost(): void {
  console.log('\nTest 5: Performance-Kosten (< 2 µs pro Aufnahme, < 0.2 ms pro Zusammenfassung)');

  const capacity = 1200;
  const stats = new FrameStats(capacity, 5000);

  const recordCount = 100_000;
  const summaryCount = 1000;

  let t = 1000;

  const startRec = performance.now();
  for (let i = 0; i < recordCount; i++) {
    stats.beginFrame(t);
    t += 16.667;
    stats.mark(0, t - 14);
    stats.mark(1, t - 12);
    stats.mark(2, t - 10);
    stats.mark(3, t - 8);
    stats.mark(4, t - 6);
    stats.mark(5, t - 4);
    stats.mark(6, t - 1);
    stats.endFrame(t, { render: { drawCalls: 100, triangles: 50000 }, memory: { geometries: 200 } });
  }
  const endRec = performance.now();
  const avgRecordUs = ((endRec - startRec) / recordCount) * 1000;

  const startSum = performance.now();
  for (let i = 0; i < summaryCount; i++) {
    stats.getSummary(t);
  }
  const endSum = performance.now();
  const avgSummaryMs = (endSum - startSum) / summaryCount;

  check('Aufnahmedauer < 2 µs / Eintrag', avgRecordUs < 2.0, `${avgRecordUs.toFixed(3)} µs`);
  check('Zusammenfassung < 0.2 ms', avgSummaryMs < 0.2, `${avgSummaryMs.toFixed(3)} ms`);
}

function main(): void {
  console.log('=== Test Performance-HUD & FrameStats ===');
  testPercentiles();
  testTimeWindow();
  testStutters();
  testPhases();
  testPerformanceCost();

  console.log(`\n${passed} bestanden, ${failures.length} fehlgeschlagen`);
  if (failures.length) {
    for (const f of failures) console.log(`  · ${f}`);
    const g = globalThis as { process?: { exitCode?: number } };
    if (g.process) g.process.exitCode = 1;
  }
}

main();
