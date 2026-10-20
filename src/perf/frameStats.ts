export const NUM_PHASES = 7;
export const PHASE_NAMES = ['Univ', 'Orient', 'Nav', 'Platz', 'Sync', 'Pumpe', 'Render'] as const;

export interface FrameStatsSummary {
  cpuLastMs: number;
  cpuP95Ms: number;
  dtP50Ms: number;
  dtP95Ms: number;
  dtMaxMs: number;
  stutters: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  phaseAvgMs: number[];
  sampleCount: number;
}

export interface RendererInfoLike {
  render?: {
    drawCalls?: number;
    triangles?: number;
  };
  memory?: {
    geometries?: number;
  };
}

/**
 * Calculates percentile p in [0, 1] using Type 7 linear interpolation:
 * index k = (len - 1) * p
 * integer part i = floor(k), fractional part f = k - i
 * result = sorted[i] + f * (sorted[i+1] - sorted[i])
 */
export function calculatePercentile(sorted: ArrayLike<number>, len: number, p: number): number {
  if (len <= 0) return 0;
  if (len === 1) return sorted[0];
  const clampedP = Math.max(0, Math.min(1, p));
  const k = (len - 1) * clampedP;
  const i = Math.floor(k);
  const f = k - i;
  if (i >= len - 1) return sorted[len - 1];
  return sorted[i] + f * (sorted[i + 1] - sorted[i]);
}

/**
 * Three-freier Ringpuffer zur Messung von Frame-Zeiten, Perzentilen, Phasen und Renderer-Metriken.
 */
export class FrameStats {
  readonly capacity: number;
  readonly windowMs: number;

  private readonly timestamps: Float64Array;
  private readonly dtReals: Float32Array;
  private readonly cpuTimes: Float32Array;
  private readonly phaseTimes: Float32Array;
  private readonly drawCallsBuf: Int32Array;
  private readonly trianglesBuf: Float64Array;
  private readonly geometriesBuf: Int32Array;

  private writeIndex = 0;
  private count = 0;

  private frameStartTime = 0;
  private lastFrameTimestamp = 0;
  private lastMarkTime = 0;
  private readonly currentPhases = new Float32Array(NUM_PHASES);

  private readonly scratchDt: Float32Array;
  private readonly scratchCpu: Float32Array;
  private readonly phaseSums = new Float64Array(NUM_PHASES);

  constructor(
    capacity = 1200,
    windowMs = 5000,
  ) {
    this.capacity = capacity;
    this.windowMs = windowMs;

    this.timestamps = new Float64Array(capacity);
    this.dtReals = new Float32Array(capacity);
    this.cpuTimes = new Float32Array(capacity);
    this.phaseTimes = new Float32Array(capacity * NUM_PHASES);
    this.drawCallsBuf = new Int32Array(capacity);
    this.trianglesBuf = new Float64Array(capacity);
    this.geometriesBuf = new Int32Array(capacity);

    this.scratchDt = new Float32Array(capacity);
    this.scratchCpu = new Float32Array(capacity);
  }

  /**
   * Startet die Zeitmessung für einen neuen Frame.
   */
  beginFrame(nowMs: number): void {
    this.frameStartTime = nowMs;
    this.currentPhases.fill(0);
    this.lastMarkTime = nowMs;
  }

  /**
   * Setzt eine Zeitmarke für die angegebene Phase (0 bis 6).
   */
  mark(phaseIndex: number, nowMs?: number): void {
    if (phaseIndex < 0 || phaseIndex >= NUM_PHASES) return;
    const time = nowMs ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.currentPhases[phaseIndex] = Math.max(0, time - this.lastMarkTime);
    this.lastMarkTime = time;
  }

  /**
   * Schließt den Frame ab und speichert alle Werte im Ringpuffer.
   */
  endFrame(nowMs: number, info?: RendererInfoLike): void {
    const cpuTotal = Math.max(0, nowMs - this.frameStartTime);
    const dtReal = this.lastFrameTimestamp > 0 ? Math.max(0, nowMs - this.lastFrameTimestamp) : 16.6667;
    this.lastFrameTimestamp = nowMs;

    const idx = this.writeIndex % this.capacity;
    this.timestamps[idx] = nowMs;
    this.dtReals[idx] = dtReal;
    this.cpuTimes[idx] = cpuTotal;

    const phaseOffset = idx * NUM_PHASES;
    for (let p = 0; p < NUM_PHASES; p++) {
      this.phaseTimes[phaseOffset + p] = this.currentPhases[p];
    }

    this.drawCallsBuf[idx] = info?.render?.drawCalls ?? 0;
    this.trianglesBuf[idx] = info?.render?.triangles ?? 0;
    this.geometriesBuf[idx] = info?.memory?.geometries ?? 0;

    this.writeIndex++;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  /**
   * Berechnet die zusammengefassten Statistiken über das Zeitfenster (default 5 s).
   */
  getSummary(nowMs?: number): FrameStatsSummary {
    const now = nowMs ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const cutoff = now - this.windowMs;

    let n = 0;
    this.phaseSums.fill(0);

    let latestDrawCalls = 0;
    let latestTriangles = 0;
    let latestGeometries = 0;
    let cpuLastMs = 0;

    // Rückwärts ab dem neuesten Eintrag
    for (let k = 0; k < this.count; k++) {
      const idx = (this.writeIndex - 1 - k + this.capacity) % this.capacity;
      const ts = this.timestamps[idx];
      if (ts < cutoff) break;

      if (n === 0) {
        latestDrawCalls = this.drawCallsBuf[idx];
        latestTriangles = this.trianglesBuf[idx];
        latestGeometries = this.geometriesBuf[idx];
        cpuLastMs = this.cpuTimes[idx];
      }

      this.scratchDt[n] = this.dtReals[idx];
      this.scratchCpu[n] = this.cpuTimes[idx];

      const phaseOffset = idx * NUM_PHASES;
      for (let p = 0; p < NUM_PHASES; p++) {
        this.phaseSums[p] += this.phaseTimes[phaseOffset + p];
      }

      n++;
    }

    if (n === 0) {
      return {
        cpuLastMs: 0,
        cpuP95Ms: 0,
        dtP50Ms: 0,
        dtP95Ms: 0,
        dtMaxMs: 0,
        stutters: 0,
        drawCalls: 0,
        triangles: 0,
        geometries: 0,
        phaseAvgMs: new Array(NUM_PHASES).fill(0),
        sampleCount: 0,
      };
    }

    const dtSub = this.scratchDt.subarray(0, n);
    const cpuSub = this.scratchCpu.subarray(0, n);

    dtSub.sort();
    cpuSub.sort();

    const dtP50Ms = calculatePercentile(dtSub, n, 0.5);
    const dtP95Ms = calculatePercentile(dtSub, n, 0.95);
    const dtMaxMs = dtSub[n - 1];
    const cpuP95Ms = calculatePercentile(cpuSub, n, 0.95);

    const stutterThreshold = 2 * dtP50Ms - 1e-4;
    let stutters = 0;
    for (let i = 0; i < n; i++) {
      if (dtSub[i] >= stutterThreshold) {
        stutters++;
      }
    }

    const phaseAvgMs: number[] = new Array(NUM_PHASES);
    for (let p = 0; p < NUM_PHASES; p++) {
      phaseAvgMs[p] = this.phaseSums[p] / n;
    }

    return {
      cpuLastMs,
      cpuP95Ms,
      dtP50Ms,
      dtP95Ms,
      dtMaxMs,
      stutters,
      drawCalls: latestDrawCalls,
      triangles: latestTriangles,
      geometries: latestGeometries,
      phaseAvgMs,
      sampleCount: n,
    };
  }
}
