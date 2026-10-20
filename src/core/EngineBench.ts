import * as THREE from 'three/webgpu';
import { SpaceCamera } from '../camera/SpaceCamera';
import { SimClock } from './SimClock';
import { UniverseManager } from '../universe/UniverseManager';
import { TerrainProvider } from '../terrain/TerrainProvider';
import { FrameStats } from '../perf/frameStats';
import {
  BENCH_STOPS,
  BenchMetrics,
  BenchState,
  BenchStop,
  createInitialBenchState,
  formatBenchReport,
  stepBenchStateMachine,
} from '../perf/benchRoute';
import pkg from '../../package.json' with { type: 'json' };

export function parseBenchParam(search: string = typeof window !== 'undefined' ? window.location.search : ''): { active: boolean; scale: number } {
  const params = new URLSearchParams(search);
  if (!params.has('bench')) return { active: false, scale: 1.0 };
  const val = params.get('bench');
  if (val === '' || val === '1' || val === 'true') return { active: true, scale: 1.0 };
  const parsed = parseFloat(val ?? '1.0');
  return { active: true, scale: Number.isFinite(parsed) && parsed > 0 ? parsed : 1.0 };
}

export class EngineBench {
  readonly renderScale: number;
  private state: BenchState = createInitialBenchState();
  private lastFrameMs = 0;

  private stopFrameCount = 0;
  private stopDtMsList: number[] = [];
  private stopCpuMsList: number[] = [];
  private stopDrawCallsSum = 0;
  private stopTrianglesSum = 0;
  private stopGeometriesSum = 0;
  private stopStuttersCount = 0;

  constructor(
    private readonly camera: SpaceCamera,
    private readonly clock: SimClock,
    private readonly getUniverse: () => UniverseManager,
    private readonly terrain: TerrainProvider,
    private readonly stats: FrameStats,
    renderScale = 1.0,
  ) {
    this.renderScale = renderScale;
    this.clock.simTime = 0;
    this.clock.resetWarp();
  }

  step(nowMs: number): void {
    if (this.state.phase === 'complete') return;
    if (this.lastFrameMs === 0) {
      this.lastFrameMs = nowMs;
      this.positionForStop(BENCH_STOPS[this.state.stopIndex]);
      return;
    }

    const dtSec = Math.max(0.001, Math.min(0.1, (nowMs - this.lastFrameMs) / 1000));
    this.lastFrameMs = nowMs;

    if (this.state.phase === 'measuring') this.recordFrameMetrics();

    const result = stepBenchStateMachine(this.state, {
      dtSec,
      pendingQueue: this.terrain.pending,
      getMetricsForCurrentStop: () => this.calculateStopMetrics(),
    });

    this.state = result.nextState;

    if (result.action === 'transition_stop') {
      this.resetStopMetrics();
      this.positionForStop(BENCH_STOPS[this.state.stopIndex]);
    } else if (result.action === 'finish') {
      this.onFinish();
    }
  }

  private resetStopMetrics(): void {
    this.stopFrameCount = 0;
    this.stopDtMsList = [];
    this.stopCpuMsList = [];
    this.stopDrawCallsSum = 0;
    this.stopTrianglesSum = 0;
    this.stopGeometriesSum = 0;
    this.stopStuttersCount = 0;
  }

  private recordFrameMetrics(): void {
    const s = this.stats.getSummary();
    this.stopFrameCount++;
    this.stopDtMsList.push(s.dtP50Ms);
    this.stopCpuMsList.push(s.cpuLastMs);
    this.stopDrawCallsSum += s.drawCalls;
    this.stopTrianglesSum += s.triangles;
    this.stopGeometriesSum += s.geometries;
    if (s.stutters > 0) this.stopStuttersCount += s.stutters;
  }

  private calculateStopMetrics(): BenchMetrics {
    if (this.stopDtMsList.length === 0) {
      const s = this.stats.getSummary();
      return { dtP50Ms: s.dtP50Ms, dtP95Ms: s.dtP95Ms, dtMaxMs: s.dtMaxMs, cpuP95Ms: s.cpuP95Ms, stutters: s.stutters, drawCalls: s.drawCalls, triangles: s.triangles, geometries: s.geometries };
    }

    const dtSorted = [...this.stopDtMsList].sort((a, b) => a - b);
    const cpuSorted = [...this.stopCpuMsList].sort((a, b) => a - b);
    const len = dtSorted.length;

    return {
      dtP50Ms: dtSorted[Math.floor(len * 0.5)],
      dtP95Ms: dtSorted[Math.floor(len * 0.95)],
      dtMaxMs: dtSorted[len - 1],
      cpuP95Ms: cpuSorted[Math.floor(len * 0.95)],
      stutters: this.stopStuttersCount,
      drawCalls: Math.round(this.stopDrawCallsSum / len),
      triangles: Math.round(this.stopTrianglesSum / len),
      geometries: Math.round(this.stopGeometriesSum / len),
    };
  }

  private positionForStop(stop: BenchStop): void {
    this.clock.resetWarp();
    const universe = this.getUniverse();
    const targetBody = universe.findBody(stop.targetBodyName) ?? universe.findBody('Erde');
    if (!targetBody) return;

    if (stop.mode === 'orbit') {
      const dist = stop.altitudeOrDistance * targetBody.radius;
      this.camera.setWorldPosition({ x: targetBody.position.x + dist, y: targetBody.position.y, z: targetBody.position.z });
      this.camera.focus(targetBody);
      this.camera.enterOrbit(targetBody);
    } else {
      this.camera.enterFreeFlight();
      if (stop.customRelativePos) {
        const rel = stop.customRelativePos;
        const pos = { x: targetBody.position.x + rel.x, y: targetBody.position.y + rel.y, z: targetBody.position.z + rel.z };
        this.camera.setWorldPosition(pos);
        const lookTarget = universe.findBody(stop.customLookTarget ?? 'Sonne') ?? targetBody;
        this.camera.lookTowards({ x: lookTarget.position.x, y: lookTarget.position.y, z: lookTarget.position.z }, 0.001);
      } else {
        const dir = { x: 1, y: 0, z: 0 };
        const surfOffset = targetBody.getSurfaceOffset(new THREE.Vector3(dir.x, dir.y, dir.z));
        const totalDist = targetBody.radius + surfOffset + stop.altitudeOrDistance;
        const pos = { x: targetBody.position.x + dir.x * totalDist, y: targetBody.position.y + dir.y * totalDist, z: targetBody.position.z + dir.z * totalDist };
        this.camera.setWorldPosition(pos);
        this.camera.setFreeAltitude(stop.altitudeOrDistance);

        if (stop.pitchDeg !== undefined) {
          const rad = (stop.pitchDeg * Math.PI) / 180;
          this.camera.lookTowards({ x: pos.x + Math.sin(rad) * 10000, y: pos.y + Math.cos(rad) * 10000, z: pos.z }, 0.001);
        } else {
          this.camera.lookTowards({ x: pos.x, y: pos.y + 10000, z: pos.z }, 0.001);
        }
      }
    }
  }

  private onFinish(): void {
    const isWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'Node/Offline';
    const report = formatBenchReport({
      version: `v${pkg.version}`,
      date: new Date().toISOString().split('T')[0],
      device: shortenUserAgent(ua),
      backend: isWebGPU ? 'WebGPU' : 'WebGL2',
      renderScale: `${this.renderScale.toFixed(1).replace('.', ',')}×`,
    }, this.state.results);

    console.info(`[EngineBench] Messlauf beendet:\n${report}`);
    if (typeof document !== 'undefined') this.showOverlay(report);
  }

  private showOverlay(reportText: string): void {
    injectBenchStyles();
    const overlay = document.createElement('div');
    overlay.className = 'bench-overlay';

    const isolate = (ev: Event) => ev.stopPropagation();
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'click'].forEach(
      (type) => overlay.addEventListener(type, isolate),
    );

    const header = document.createElement('div');
    header.className = 'bench-header';
    header.textContent = 'Messlauf abgeschlossen (?bench)';

    const textarea = document.createElement('textarea');
    textarea.className = 'bench-textarea';
    textarea.readOnly = true;
    textarea.value = reportText;

    const btnRow = document.createElement('div');
    btnRow.className = 'bench-btn-row';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'bench-copy-btn';
    copyBtn.textContent = 'Kopieren';

    copyBtn.onclick = () => {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(reportText).then(() => {
          copyBtn.textContent = 'Kopiert!';
          setTimeout(() => { copyBtn.textContent = 'Kopieren'; }, 2000);
        }).catch(() => { textarea.select(); });
      } else {
        textarea.select();
      }
    };

    btnRow.appendChild(copyBtn);
    overlay.append(header, textarea, btnRow);
    document.body.appendChild(overlay);
  }
}

function shortenUserAgent(ua: string): string {
  if (ua.includes('iPad')) return 'iPad (Safari)';
  if (ua.includes('iPhone')) return 'iPhone (Safari)';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('Chrome')) return 'Chrome/Desktop';
  if (ua.includes('Safari')) return 'Safari/Desktop';
  if (ua.includes('Firefox')) return 'Firefox/Desktop';
  return ua.slice(0, 24);
}

let stylesInjected = false;
function injectBenchStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const s = document.createElement('style');
  s.textContent = `
.bench-overlay { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 2000;
  width: min(600px, 90vw); max-height: 80vh; background: rgba(8, 14, 26, 0.92); border: 1px solid rgba(120, 170, 240, 0.4);
  border-radius: 12px; backdrop-filter: blur(12px); padding: 16px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  font: 500 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: #cfe3ff; display: flex; flex-direction: column; gap: 12px; }
.bench-header { font-weight: bold; font-size: 15px; color: #70b0ff; }
.bench-textarea { width: 100%; height: 260px; background: #080e1a; color: #a0d0ff; border: 1px solid rgba(120, 170, 240, 0.3);
  border-radius: 6px; padding: 8px; font: inherit; resize: vertical; box-sizing: border-box; }
.bench-btn-row { display: flex; justify-content: flex-end; }
.bench-copy-btn { font: inherit; font-weight: bold; color: #ffffff; background: #2563eb; border: none; border-radius: 6px; padding: 8px 16px; cursor: pointer; }
.bench-copy-btn:active { background: #1d4ed8; }
`;
  document.head.appendChild(s);
}
