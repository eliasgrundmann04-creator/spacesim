/**
 * BenchRoute: Routenliste, Zustandsautomat und Formatierung für den Messlauf (?bench).
 * Reines Modul ohne DOM und ohne three.js (§5).
 */

export interface BenchStop {
  id: number;
  name: string;
  location: string;
  targetBodyName: string;
  mode: 'orbit' | 'free';
  altitudeOrDistance: number;
  pitchDeg?: number;
  isLand?: boolean;
  customRelativePos?: { x: number; y: number; z: number };
  customLookTarget?: string;
}

export const BENCH_STOPS: readonly BenchStop[] = [
  {
    id: 1,
    name: 'Halt 1',
    location: 'Erde, Orbitmodus (3 R)',
    targetBodyName: 'Erde',
    mode: 'orbit',
    altitudeOrDistance: 3,
  },
  {
    id: 2,
    name: 'Halt 2',
    location: 'Erde, 1000 km Höhe',
    targetBodyName: 'Erde',
    mode: 'free',
    altitudeOrDistance: 1_000_000,
    pitchDeg: -30,
  },
  {
    id: 3,
    name: 'Halt 3',
    location: 'Erde, 2 m Höhe über Land',
    targetBodyName: 'Erde',
    mode: 'free',
    altitudeOrDistance: 2,
    pitchDeg: 0,
    isLand: true,
  },
  {
    id: 4,
    name: 'Halt 4',
    location: 'Mond, 10 km Höhe',
    targetBodyName: 'Mond',
    mode: 'free',
    altitudeOrDistance: 10_000,
    pitchDeg: -30,
  },
  {
    id: 5,
    name: 'Halt 5',
    location: '50 AE über Ekliptik',
    targetBodyName: 'Sonne',
    mode: 'free',
    altitudeOrDistance: 50 * 1.495978707e11,
    customRelativePos: { x: 0, y: 0, z: 50 * 1.495978707e11 },
    customLookTarget: 'Sonne',
  },
  {
    id: 6,
    name: 'Halt 6',
    location: '20 Lj vom Sonnensystem',
    targetBodyName: 'Sonne',
    mode: 'free',
    altitudeOrDistance: 20 * 9.4607304725808e15,
    customRelativePos: { x: 20 * 9.4607304725808e15, y: 0, z: 0 },
    customLookTarget: 'Sonne',
  },
];

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

export function createInitialBenchState(): BenchState {
  return {
    stopIndex: 0,
    phase: 'setup',
    phaseTime: 0,
    settleTime: 0,
    settleText: '',
    totalTime: 0,
    results: [],
  };
}

export function stepBenchStateMachine(
  state: BenchState,
  options: StepBenchOptions,
): { nextState: BenchState; action?: 'transition_stop' | 'finish' } {
  if (state.phase === 'complete') {
    return { nextState: state };
  }

  const dt = options.dtSec;
  const pending = options.pendingQueue;
  const newTotalTime = state.totalTime + dt;
  const newPhaseTime = state.phaseTime + dt;

  if (state.phase === 'setup') {
    return {
      nextState: {
        ...state,
        phase: 'settling',
        phaseTime: 0,
        settleTime: 0,
        settleText: '',
        totalTime: newTotalTime,
      },
      action: 'transition_stop',
    };
  }

  if (state.phase === 'settling') {
    const settleTime = newPhaseTime;
    const isQueueEmpty = pending === 0;
    const isTimeout = settleTime >= SETTLE_TIMEOUT_SEC;

    if (isQueueEmpty || isTimeout) {
      const text = isTimeout
        ? '> 15 s'
        : `${formatGermanNumber(settleTime, 1)} s`;

      return {
        nextState: {
          ...state,
          phase: 'measuring',
          phaseTime: 0,
          settleTime,
          settleText: text,
          totalTime: newTotalTime,
        },
      };
    }

    return {
      nextState: {
        ...state,
        phaseTime: newPhaseTime,
        totalTime: newTotalTime,
      },
    };
  }

  if (state.phase === 'measuring') {
    if (newPhaseTime >= MEASURE_DURATION_SEC) {
      const metrics = options.getMetricsForCurrentStop
        ? options.getMetricsForCurrentStop()
        : {
            dtP50Ms: 0,
            dtP95Ms: 0,
            dtMaxMs: 0,
            cpuP95Ms: 0,
            stutters: 0,
            drawCalls: 0,
            triangles: 0,
            geometries: 0,
          };

      const stopResult: BenchStopResult = {
        stop: BENCH_STOPS[state.stopIndex],
        settleText: state.settleText,
        metrics,
      };

      const nextResults = [...state.results, stopResult];
      const nextIndex = state.stopIndex + 1;

      if (nextIndex >= BENCH_STOPS.length) {
        return {
          nextState: {
            ...state,
            phase: 'complete',
            phaseTime: 0,
            totalTime: newTotalTime,
            results: nextResults,
          },
          action: 'finish',
        };
      }

      return {
        nextState: {
          ...state,
          stopIndex: nextIndex,
          phase: 'setup',
          phaseTime: 0,
          totalTime: newTotalTime,
          results: nextResults,
        },
      };
    }

    return {
      nextState: {
        ...state,
        phaseTime: newPhaseTime,
        totalTime: newTotalTime,
      },
    };
  }

  return { nextState: state };
}

export function formatGermanNumber(val: number, decimals = 1): string {
  if (!Number.isFinite(val)) return '0,0';
  return val.toFixed(decimals).replace('.', ',');
}

export function formatTriangles(tri: number): string {
  if (tri >= 1000) {
    return `${formatGermanNumber(tri / 1000, 1)}k`;
  }
  return Math.round(tri).toString();
}

export function formatBenchRow(result: BenchStopResult): string {
  const m = result.metrics;
  const p50 = `${formatGermanNumber(m.dtP50Ms, 1)} ms`;
  const p95 = `${formatGermanNumber(m.dtP95Ms, 1)} ms`;
  const max = `${formatGermanNumber(m.dtMaxMs, 1)} ms`;
  const cpu = `${formatGermanNumber(m.cpuP95Ms, 1)} ms`;
  const stutters = Math.round(m.stutters).toString();
  const draw = Math.round(m.drawCalls).toString();
  const tri = formatTriangles(m.triangles);
  const geo = Math.round(m.geometries).toString();

  return `| ${result.stop.id} | ${result.stop.location} | ${p50} | ${p95} | ${max} | ${cpu} | ${stutters} | ${draw} | ${tri} | ${geo} | ${result.settleText} |`;
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
  const lines: string[] = [];
  lines.push(`- **Version:** ${meta.version}`);
  lines.push(`- **Datum:** ${meta.date}`);
  lines.push(`- **Gerät:** ${meta.device}`);
  lines.push(`- **Backend:** ${meta.backend}`);
  lines.push(`- **Renderauflösung:** ${meta.renderScale}`);
  lines.push('');
  lines.push(BENCH_TABLE_HEADER);
  for (const res of results) {
    lines.push(formatBenchRow(res));
  }
  return lines.join('\n');
}
