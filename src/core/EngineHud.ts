import type { SimClock } from './SimClock';
import type { SpaceCamera } from '../camera/SpaceCamera';
import type { TerrainProvider, TerrainBackendChoice } from '../terrain/TerrainProvider';
import type { NavResult } from '../nav/Navigator';
import type { FlightControls } from '../ui/FlightControls';
import { TerrainField } from '../terrain/tileGeometry';
import type { TileSpec } from '../terrain/tileGeometry';
import { EARTH_RADIUS } from './constants';
import { formatDistance, formatSpeed, formatScale } from '../nav/format';
import type { FrameStats } from '../perf/frameStats';

export interface HudContext {
  clock: SimClock;
  smoothedFrameMs: number;
  renderScale: number;
  terrain: TerrainProvider;
  nav: NavResult | null;
  camera: SpaceCamera;
  flightControls: FlightControls;
  stats: FrameStats;
}

export class EngineHud {
  private lastHudUpdate = 0;
  private readonly perfMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('perf');

  constructor(private readonly hud: HTMLElement) {}

  update(ctx: HudContext): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.lastHudUpdate < 100 && this.lastHudUpdate > 0) {
      return;
    }
    this.lastHudUpdate = now;

    const warpLabel = ctx.clock.paused ? 'PAUSE' : `×${ctx.clock.timeWarp.toLocaleString('de-DE')}`;
    const date = ctx.clock.date.toISOString().replace('T', ' ').slice(0, 16);
    const fps = (1000 / Math.max(ctx.smoothedFrameMs, 0.01)).toFixed(0);
    const workers = ctx.terrain.backend === 'worker' ? `×${ctx.terrain.workerCount}` : '';
    const lost = ctx.terrain.lost > 0 ? `   Verloren ${ctx.terrain.lost}` : '';

    const n = ctx.nav;
    const label = n?.anchor?.name ?? ctx.camera.target?.name ?? '—';
    const frameLabel = ctx.camera.frame ? ` [Frame: ${ctx.camera.frame.name}]` : '';
    const speed = n ? `   v ${formatSpeed(n.relativeSpeed)}` : '';
    const modeLabel = !n
      ? 'ORBIT'
      : n.mode === 'goto'
        ? `ANFLUG ${Math.round(n.gotoProgress * 100)} %`
        : `FLUG ${formatScale(ctx.flightControls.input.speedScale)}`;

    const s = ctx.stats.getSummary(now);
    const cpuLast = fmtNum(s.cpuLastMs);
    const cpuP95 = fmtNum(s.cpuP95Ms);
    const dtP50 = fmtNum(s.dtP50Ms);
    const dtP95 = fmtNum(s.dtP95Ms);
    const dtMax = s.dtMaxMs.toFixed(0);
    const tri = formatCount(s.triangles);

    let text =
      `${label}${frameLabel}   Höhe ${formatDistance(ctx.camera.altitude)}${speed}\n` +
      `${modeLabel}   Warp ${warpLabel}   ${date} UTC\n` +
      `${fps} fps @ ${ctx.renderScale.toFixed(2)}×   ` +
      `Terrain ${ctx.terrain.backend}${workers}   Queue ${ctx.terrain.pending}   ` +
      `Kacheln ${ctx.terrain.built}${lost}\n` +
      `CPU ${cpuLast} ms (p95 ${cpuP95})   Bild p50 ${dtP50} / p95 ${dtP95} / max ${dtMax} ms   ` +
      `Ruckler ${s.stutters}   Draw ${s.drawCalls}   Tri ${tri}   Geo ${s.geometries}`;

    if (this.perfMode) {
      const p = s.phaseAvgMs.map((v) => fmtNum(v));
      text += `\nUniv ${p[0]} · Orient ${p[1]} · Nav ${p[2]} · Platz ${p[3]} · Sync ${p[4]} · Pumpe ${p[5]} · Render (CPU) ${p[6]} ms`;
    }

    this.hud.textContent = text;

    const warpButton = document.querySelector<HTMLElement>('#controls [data-act="warp"]');
    if (warpButton) warpButton.textContent = ctx.clock.paused ? 'Pause' : `×${shortWarp(ctx.clock.timeWarp)}`;
  }
}

function fmtNum(v: number, decimals = 1): string {
  return v.toFixed(decimals).replace('.', ',');
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${Math.round(n / 1e3)}k`;
  return `${(n / 1e6).toFixed(1).replace('.', ',')}M`;
}

/** Vector3d / Zahl umformatieren für Warp-Button. */
export function shortWarp(warp: number): string {
  if (warp < 1000) return String(warp);
  if (warp < 1e6) return `${Math.round(warp / 1e3)}k`;
  return `${(warp / 1e6).toFixed(warp < 1e7 ? 1 : 0)}M`;
}

/** ?terrain=worker|gpu|sync — sonst 'auto' (= Worker, siehe TerrainProvider). */
export function readBackendChoice(): TerrainBackendChoice {
  const value = new URLSearchParams(window.location.search).get('terrain');
  return value === 'worker' || value === 'gpu' || value === 'sync' ? value : 'auto';
}

/** Kleine Referenzkachel für den Selbsttest des GPU-Compute-Pfads. */
export function buildProbe(): { field: TerrainField; tile: TileSpec } {
  const field = new TerrainField({
    seed: 0x5eed,
    radius: EARTH_RADIUS,
    terrain: {
      amplitude: 0.0018, frequency: 1.6, octaves: 5,
      ocean: true, oceanLevel: 0.02, palette: 'earth',
      maxDepth: 14, resolution: 16,
    },
  });
  const tile: TileSpec = {
    face: 0, level: 3, u0: -0.25, v0: 0.125, resolution: 16,
    centerX: 0, centerY: 0, centerZ: 0,
  };
  return { field, tile };
}
