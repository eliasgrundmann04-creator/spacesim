/**
 * BenchRoute: Routenliste, Zustandsautomat, Auswertung und Formatierung für den Messlauf (?bench).
 * Reines Modul ohne DOM und ohne three.js (§5).
 */
import type { Vec3 } from '../nav/vec';
import { AU, LY } from '../core/constants';
import { calculatePercentile } from './frameStats';

/**
 * Ein Halt. Positionen sind immer relativ zu `body` (Hinweis der Aufgabe: Halt 6 liegt mit dem
 * Frame-Baum in einem anderen Rahmen als Halt 1–5).
 *   orbit   — Orbitmodus, Abstand `distance` × Radius entlang `radial`
 *   surface — Freiflug, `distance` m über dem Terrain entlang `radial`, Blick `pitchDeg` unter
 *             die Waagerechte, Richtung Norden (Ekliptik-z auf die Tangentialebene projiziert)
 *   space   — Freiflug bei body + `offset`, Blick auf `lookAt`
 */
export interface BenchStop {
  id: number;
  name: string;
  location: string;
  body: string;
  kind: 'orbit' | 'surface' | 'space';
  distance: number;
  radial?: Vec3;
  pitchDeg?: number;
  offset?: Vec3;
  lookAt?: string;
}

/**
 * Fester Landpunkt (Erde, ~14° über dem Sonnenpunkt bei Simzeit 0): Rohhöhe ~790 m, Meeresspiegel
 * 229 m, flach im 2-km-Umkreis — im Test belegt. Halt 1, 2 und 4 nutzen dieselbe Richtung,
 * damit alle Oberflächenhalte auf der Tagseite liegen.
 */
export const BENCH_LAND_DIR: Vec3 = { x: 0.27363, y: -0.93091, z: 0.24192 };

/** Feste Simzeit zu Beginn des Messlaufs (J2000.0) — die Beleuchtung hängt daran. */
export const BENCH_SIM_TIME = 0;

export function createBenchRoute(): BenchStop[] {
  const radial = BENCH_LAND_DIR;
  return [
    { id: 1, name: 'Halt 1', location: 'Erde, Orbitmodus (3 R)', body: 'Erde', kind: 'orbit', distance: 3, radial },
    { id: 2, name: 'Halt 2', location: 'Erde, 1000 km Höhe', body: 'Erde', kind: 'surface', distance: 1_000_000, radial, pitchDeg: 30 },
    { id: 3, name: 'Halt 3', location: 'Erde, 2 m Höhe über Land', body: 'Erde', kind: 'surface', distance: 2, radial, pitchDeg: 0 },
    { id: 4, name: 'Halt 4', location: 'Mond, 10 km Höhe', body: 'Mond', kind: 'surface', distance: 10_000, radial, pitchDeg: 30 },
    { id: 5, name: 'Halt 5', location: '50 AE über Ekliptik', body: 'Sonne', kind: 'space', distance: 50 * AU, offset: { x: 0, y: 0, z: 50 * AU }, lookAt: 'Sonne' },
    { id: 6, name: 'Halt 6', location: '20 Lj vom Sonnensystem', body: 'Sonne', kind: 'space', distance: 20 * LY, offset: { x: 20 * LY, y: 0, z: 0 }, lookAt: 'Sonne' },
  ];
}

export const BENCH_STOPS: readonly BenchStop[] = createBenchRoute();

export type BenchPhase = 'setup' | 'settling' | 'measuring' | 'complete';

export interface BenchMetrics {
  dtP50Ms: number;
  dtP95Ms: number;
  dtMaxMs: number;
  cpuP95Ms: number;
  stutters: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
}

export interface BenchStopResult {
  stop: BenchStop;
  settleText: string;
  metrics: BenchMetrics;
}

export interface BenchState {
  stopIndex: number;
  phase: BenchPhase;
  phaseTime: number;
  settleTime: number;
  settleText: string;
  totalTime: number;
  results: BenchStopResult[];
}

export const SETTLE_TIMEOUT_SEC = 15.0;
export const MEASURE_DURATION_SEC = 5.0;

export interface StepBenchOptions {
  dtSec: number;
  pendingQueue: number;
  getMetricsForCurrentStop?: () => BenchMetrics;
}

const EMPTY_METRICS: BenchMetrics = {
  dtP50Ms: 0, dtP95Ms: 0, dtMaxMs: 0, cpuP95Ms: 0, stutters: 0, drawCalls: 0, triangles: 0, geometries: 0,
};

export function createInitialBenchState(): BenchState {
  return { stopIndex: 0, phase: 'setup', phaseTime: 0, settleTime: 0, settleText: '', totalTime: 0, results: [] };
}

/** Automat als reine Funktion von (Zustand, Zeit, Warteschlangenlänge). */
export function stepBenchStateMachine(
  state: BenchState,
  options: StepBenchOptions,
): { nextState: BenchState; action?: 'transition_stop' | 'finish' } {
  if (state.phase === 'complete') return { nextState: state };

  const totalTime = state.totalTime + options.dtSec;
  const phaseTime = state.phaseTime + options.dtSec;

  if (state.phase === 'setup') {
    return {
      nextState: { ...state, phase: 'settling', phaseTime: 0, settleTime: 0, settleText: '', totalTime },
      action: 'transition_stop',
    };
  }

  if (state.phase === 'settling') {
    const timeout = phaseTime >= SETTLE_TIMEOUT_SEC;
    if (options.pendingQueue === 0 || timeout) {
      const settleText = timeout ? '> 15 s' : `${formatGermanNumber(phaseTime, 1)} s`;
      return { nextState: { ...state, phase: 'measuring', phaseTime: 0, settleTime: phaseTime, settleText, totalTime } };
    }
    return { nextState: { ...state, phaseTime, totalTime } };
  }

  if (phaseTime < MEASURE_DURATION_SEC) return { nextState: { ...state, phaseTime, totalTime } };

  const metrics = options.getMetricsForCurrentStop ? options.getMetricsForCurrentStop() : EMPTY_METRICS;
  const results = [...state.results, { stop: BENCH_STOPS[state.stopIndex], settleText: state.settleText, metrics }];
  const stopIndex = state.stopIndex + 1;

  if (stopIndex >= BENCH_STOPS.length) {
    return { nextState: { ...state, phase: 'complete', phaseTime: 0, totalTime, results }, action: 'finish' };
  }
  return { nextState: { ...state, stopIndex, phase: 'setup', phaseTime: 0, totalTime, results } };
}

/**
 * Sammelt die Frames *eines* Halts: Bildintervall und CPU-Zeit jedes einzelnen Frames.
 * Perzentile und Ruckler entstehen erst am Ende über genau diese Frames — nicht aus der
 * gleitenden HUD-Zusammenfassung, deren Median Ruckler glättet.
 */
export class BenchSampler {
  private dt: number[] = [];
  private cpu: number[] = [];
  private draw = 0;
  private tri = 0;
  private geo = 0;

  get count(): number {
    return this.dt.length;
  }

  reset(): void {
    this.dt = [];
    this.cpu = [];
    this.draw = this.tri = this.geo = 0;
  }

  add(dtMs: number, cpuMs: number, drawCalls: number, triangles: number, geometries: number): void {
    this.dt.push(dtMs);
    this.cpu.push(cpuMs);
    this.draw += drawCalls;
    this.tri += triangles;
    this.geo += geometries;
  }

  /** Ruckler wie im HUD (Aufgabe 14): Bildintervall ≥ 2 × Median. Draw/Tri/Geo gemittelt. */
  summarize(): BenchMetrics {
    const n = this.dt.length;
    if (n === 0) return { ...EMPTY_METRICS };
    const dt = [...this.dt].sort((a, b) => a - b);
    const cpu = [...this.cpu].sort((a, b) => a - b);
    const p50 = calculatePercentile(dt, n, 0.5);
    let stutters = 0;
    for (const v of dt) if (v >= 2 * p50 - 1e-4) stutters++;
    return {
      dtP50Ms: p50,
      dtP95Ms: calculatePercentile(dt, n, 0.95),
      dtMaxMs: dt[n - 1],
      cpuP95Ms: calculatePercentile(cpu, n, 0.95),
      stutters,
      drawCalls: Math.round(this.draw / n),
      triangles: Math.round(this.tri / n),
      geometries: Math.round(this.geo / n),
    };
  }
}

export function formatGermanNumber(val: number, decimals = 1): string {
  if (!Number.isFinite(val)) return '0,0';
  return val.toFixed(decimals).replace('.', ',');
}

export function formatTriangles(tri: number): string {
  if (tri >= 1000) return `${formatGermanNumber(tri / 1000, 1)}k`;
  return Math.round(tri).toString();
}

export function formatBenchRow(result: BenchStopResult): string {
  const m = result.metrics;
  const ms = (v: number) => `${formatGermanNumber(v, 1)} ms`;
  const cells = [
    String(result.stop.id), result.stop.location,
    ms(m.dtP50Ms), ms(m.dtP95Ms), ms(m.dtMaxMs), ms(m.cpuP95Ms),
    String(Math.round(m.stutters)), String(Math.round(m.drawCalls)), formatTriangles(m.triangles),
    String(Math.round(m.geometries)), result.settleText,
  ];
  return `| ${cells.join(' | ')} |`;
}

export interface BenchMetadata {
  version: string;
  date: string;
  device: string;
  backend: string;
  renderScale: string;
}

export const BENCH_TABLE_HEADER = `| Halt | Ort | Bild p50 | Bild p95 | Bild max | CPU p95 | Ruckler | Draw | Tri | Geo | Einschwingen |
|---|---|---|---|---|---|---|---|---|---|---|`;

export function formatBenchReport(meta: BenchMetadata, results: BenchStopResult[]): string {
  return [
    `- **Version:** ${meta.version}`,
    `- **Datum:** ${meta.date}`,
    `- **Gerät:** ${meta.device}`,
    `- **Backend:** ${meta.backend}`,
    `- **Renderauflösung:** ${meta.renderScale}`,
    '',
    BENCH_TABLE_HEADER,
    ...results.map(formatBenchRow),
  ].join('\n');
}
