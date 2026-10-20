import * as THREE from 'three/webgpu';
import type { SpaceCamera } from '../camera/SpaceCamera';
import type { SimClock } from './SimClock';
import type { UniverseManager } from '../universe/UniverseManager';
import type { CelestialBody } from '../universe/CelestialBody';
import type { TerrainProvider } from '../terrain/TerrainProvider';
import type { RendererInfoLike } from '../perf/frameStats';
import type { BenchState, BenchStop } from '../perf/benchRoute';
import {
  BENCH_SIM_TIME,
  BENCH_STOPS,
  BenchSampler,
  createInitialBenchState,
  formatBenchReport,
  stepBenchStateMachine,
} from '../perf/benchRoute';
import type { Vec3 } from '../nav/vec';
import { add, cross, dot, normalize, orthogonal, scale, sub, vec3 } from '../nav/vec';
import pkg from '../../package.json' with { type: 'json' };

export function parseBenchParam(search: string = typeof window !== 'undefined' ? window.location.search : ''): { active: boolean; scale: number } {
  const params = new URLSearchParams(search);
  if (!params.has('bench')) return { active: false, scale: 1.0 };
  const val = params.get('bench');
  if (val === '' || val === '1' || val === 'true') return { active: true, scale: 1.0 };
  const parsed = parseFloat(val ?? '1.0');
  return { active: true, scale: Number.isFinite(parsed) && parsed > 0 ? parsed : 1.0 };
}

export interface BenchDeps {
  camera: SpaceCamera;
  clock: SimClock;
  getUniverse: () => UniverseManager;
  terrain: TerrainProvider;
  /** Navigator-Zustand für einen Halt zurücksetzen (null = ohne Ankermerkpunkt). */
  resetMotion: (body: CelestialBody | null) => void;
  backend: string;
  renderScale: number;
}

/** dt ≫ tau ⇒ `lookTowards` dreht in einem Aufruf vollständig. */
const SNAP = Infinity;
/** Länge der Blickhilfsstrecke: groß gegen die f64-Auflösung der Kameraposition. */
const LOOK_REACH = 1e6;
/** Ein Frame über einer Sekunde ist ein Tab-Wechsel, kein Messwert für den Automaten. */
const MAX_STEP_SEC = 1;

/**
 * Messlauf (?bench): setzt Kamera und Uhr über deren öffentliche Schnittstelle, füttert den
 * Automaten aus `benchRoute.ts` jeden Frame und zeigt am Ende das Ergebnis zum Kopieren.
 */
export class EngineBench {
  readonly renderScale: number;
  private readonly deps: BenchDeps;
  private state: BenchState = createInitialBenchState();
  private readonly sampler = new BenchSampler();
  private lastFrameMs = 0;

  constructor(deps: BenchDeps) {
    this.deps = deps;
    this.renderScale = deps.renderScale;
    deps.clock.simTime = BENCH_SIM_TIME;
    deps.clock.paused = false;
    deps.clock.resetWarp();
  }

  /** Nach `endFrame`: frameStartMs = Beginn dieses Frames, cpuMs = seine CPU-Zeit. */
  step(frameStartMs: number, cpuMs: number, info: RendererInfoLike): void {
    if (this.state.phase === 'complete') return;
    if (this.lastFrameMs === 0) {
      this.lastFrameMs = frameStartMs;
      return;
    }

    const dtMs = frameStartMs - this.lastFrameMs;
    this.lastFrameMs = frameStartMs;

    if (this.state.phase === 'measuring') {
      this.sampler.add(dtMs, cpuMs, info.render?.drawCalls ?? 0, info.render?.triangles ?? 0, info.memory?.geometries ?? 0);
    }

    const result = stepBenchStateMachine(this.state, {
      dtSec: Math.min(dtMs / 1000, MAX_STEP_SEC),
      pendingQueue: this.deps.terrain.pending,
      getMetricsForCurrentStop: () => this.sampler.summarize(),
    });
    this.state = result.nextState;

    if (result.action === 'transition_stop') {
      this.sampler.reset();
      this.positionForStop(BENCH_STOPS[this.state.stopIndex]);
    } else if (result.action === 'finish') {
      this.onFinish();
    }
  }

  private positionForStop(stop: BenchStop): void {
    const { camera, clock } = this.deps;
    clock.resetWarp();
    const universe = this.deps.getUniverse();
    const body = universe.findBody(stop.body);
    if (!body) {
      console.warn(`[EngineBench] Körper „${stop.body}" fehlt — Halt ${stop.id} übersprungen.`);
      return;
    }
    const center = vec3(body.position.x, body.position.y, body.position.z);

    if (stop.kind === 'orbit') {
      const u = normalize(stop.radial ?? vec3(1, 0, 0));
      camera.setWorldPosition(add(center, scale(u, stop.distance * body.radius)));
      camera.enterOrbit(body);
      return;
    }

    camera.enterFreeFlight();

    if (stop.kind === 'space') {
      const pos = add(center, stop.offset ?? vec3());
      camera.setWorldPosition(pos);
      camera.setFreeAltitude(stop.distance);
      const target = universe.findBody(stop.lookAt ?? stop.body) ?? body;
      camera.lookTowards(target.position, SNAP);
      this.deps.resetMotion(null);
      return;
    }

    const u = normalize(stop.radial ?? vec3(1, 0, 0));
    const ground = body.radius + body.getSurfaceOffset(new THREE.Vector3(u.x, u.y, u.z));
    const pos = add(center, scale(u, ground + stop.distance));
    camera.setWorldPosition(pos);
    camera.setFreeAltitude(stop.distance);
    this.levelView(pos, u, (stop.pitchDeg ?? 0) * (Math.PI / 180));
    this.deps.resetMotion(body);
  }

  /**
   * Blick nach Norden, `pitch` unter die Waagerechte, Horizont waagerecht im Bild.
   * `lookTowards` dreht auf dem kürzesten Bogen und behält dabei den Roll — deshalb in Schritten,
   * deren Drehachse jeweils bekannt ist:
   *   1. senkrecht nach unten (−u)
   *   2. auf die dabei entstandene Oben-Richtung h: 90° um die Rechtsachse ⇒ Blick h, oben u
   *   3. auf Norden: Drehung um u (über einen Zwischenschritt, falls Norden hinter h liegt)
   *   4. um die Rechtsachse auf die Neigung
   */
  private levelView(pos: Vec3, u: Vec3, pitch: number): void {
    const { camera } = this.deps;
    const look = (dir: Vec3) => camera.lookTowards(add(pos, scale(dir, LOOK_REACH)), SNAP);
    const horizontal = (v: Vec3) => normalize(sub(v, scale(u, dot(v, u))), orthogonal(u));

    look(scale(u, -1));
    const h = horizontal(camera.basis().up);
    look(h);

    const north = horizontal(vec3(0, 0, 1));
    if (dot(h, north) < -0.5) look(normalize(cross(u, h)));
    look(north);

    if (pitch !== 0) look(add(scale(north, Math.cos(pitch)), scale(u, -Math.sin(pitch))));
  }

  private onFinish(): void {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'Node/Offline';
    const report = formatBenchReport({
      version: `v${pkg.version}`,
      date: new Date().toISOString().split('T')[0],
      device: shortenUserAgent(ua, typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0),
      backend: this.deps.backend,
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

/**
 * Gekürzter User-Agent. Chrome auf Android-Tablets und Safari auf iPadOS melden sich standardmäßig
 * als Desktop (Linux/Macintosh) — erst die Touchpunkte verraten das Tablet.
 */
function shortenUserAgent(ua: string, touchPoints: number): string {
  const touch = touchPoints > 1;
  if (ua.includes('iPad') || (touch && ua.includes('Macintosh'))) return 'iPad (Safari)';
  if (ua.includes('iPhone')) return 'iPhone (Safari)';
  if (ua.includes('Android')) return ua.includes('Mobile') ? 'Android-Telefon (Chrome)' : 'Android-Tablet (Chrome)';
  const browser = ua.includes('Firefox') ? 'Firefox' : ua.includes('Chrome') ? 'Chrome' : ua.includes('Safari') ? 'Safari' : ua.slice(0, 24);
  return touch ? `Tablet (${browser}, Desktop-UA)` : `${browser}/Desktop`;
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
