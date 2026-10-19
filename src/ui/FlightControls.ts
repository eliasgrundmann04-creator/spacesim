import type { NavInput } from '../nav/types';
import { THRUST_EPSILON, neutralInput, throttleToForward } from '../nav/types';
import { formatDistance, formatScale, formatSpeed } from '../nav/format';

/**
 * Bildschirmsteuerung für den freien Flug.
 *
 * Aufteilung: der Schubregler ist ein federnder Vertikalslider (loslassen ⇒ zurück auf 0),
 * die Grobwahl der Geschwindigkeit läuft über einen separaten log-gestuften Multiplikator.
 * Das trennt „wie schnell überhaupt" von „wie fein jetzt gerade" — auf einem Touchscreen
 * lässt sich beides nicht in eine Achse legen.
 *
 * Der Regler antwortet kubisch (x³): die halbe Reglerstrecke ergibt ein Achtel Schub.
 * Nur so ist Landeanflug und Interstellarflug derselbe Slider.
 */
export interface FlightControlsOptions {
  /** Overlay-Container über dem Canvas (position: relative oder absolute). */
  container: HTMLElement;
  /** Canvas für die Doppeltipp-Erkennung. */
  canvas: HTMLElement;
  /** Doppeltipp-Position in CSS-px relativ zum Canvas. */
  onDoubleTap?: (x: number, y: number) => void;
  /** Vollstopp relativ zum Ankerkörper. */
  onBrake?: () => void;
  /** Eigene HUD-Zeile anlegen. Aus, wenn die Engine bereits ein HUD besitzt. */
  hud?: boolean;
  minScale?: number;
  maxScale?: number;
}

const SCALE_STEP = Math.sqrt(10);

export class FlightControls {
  readonly input: NavInput = neutralInput();

  private readonly opts: FlightControlsOptions & { minScale: number; maxScale: number };
  private readonly root: HTMLDivElement;
  private readonly track: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly scaleLabel: HTMLSpanElement;
  private readonly assistBtn: HTMLButtonElement;
  private readonly hud: HTMLDivElement | null;

  private raw = 0; // −1…+1, Reglerposition
  private pointerId: number | null = null;
  private lastTapTime = 0;
  private lastTapX = 0;
  private lastTapY = 0;
  private lastDisplayedScale = 1;
  private disposers: Array<() => void> = [];

  constructor(options: FlightControlsOptions) {
    this.opts = { minScale: 1e-3, maxScale: 1e2, ...options };

    injectStyles();

    this.root = el('div', 'nav-ui') as HTMLDivElement;
    this.hud = options.hud === false ? null : (el('div', 'nav-hud') as HTMLDivElement);
    if (this.hud) this.root.appendChild(this.hud);

    const column = el('div', 'nav-column');

    // Schubregler
    this.track = el('div', 'nav-track') as HTMLDivElement;
    this.knob = el('div', 'nav-knob') as HTMLDivElement;
    const center = el('div', 'nav-center');
    this.track.append(center, this.knob);
    column.appendChild(this.track);

    // Geschwindigkeitsstufen
    const scaleBox = el('div', 'nav-scale');
    const minus = button('−', () => this.stepScale(1 / SCALE_STEP));
    const plus = button('+', () => this.stepScale(SCALE_STEP));
    this.scaleLabel = document.createElement('span');
    this.scaleLabel.className = 'nav-scale-label';
    scaleBox.append(minus, this.scaleLabel, plus);
    column.appendChild(scaleBox);

    const row = el('div', 'nav-row');
    this.assistBtn = button('ASSIST', () => this.toggleAssist());
    const brake = button('STOP', () => {
      this.input.brake = true;
      this.opts.onBrake?.();
    });
    row.append(this.assistBtn, brake);
    column.appendChild(row);

    this.root.appendChild(column);
    this.opts.container.appendChild(this.root);

    this.bindThrottle();
    this.bindDoubleTap();
    this.refreshLabels();
  }

  /** Rohe Reglerposition −1…+1 (vor der kubischen Kennlinie). */
  get throttle(): number {
    return this.raw;
  }

  /** Einmal pro Frame *nach* dem Lesen aufrufen: setzt Einmal-Flags zurück. */
  endFrame(): void {
    this.input.brake = false;
    if (this.input.speedScale !== this.lastDisplayedScale) {
      this.refreshLabels();
    }
  }

  setHud(text: string): void {
    if (this.hud) this.hud.textContent = text;
  }

  /** Standard-HUD aus einem NavResult-artigen Objekt. */
  setHudFrom(info: {
    anchorName?: string | null;
    altitude: number;
    relativeSpeed: number;
    mode: string;
    gotoProgress?: number;
  }): void {
    const parts = [
      info.anchorName ?? '—',
      `H ${formatDistance(info.altitude)}`,
      `v ${formatSpeed(info.relativeSpeed)}`,
    ];
    if (info.mode === 'goto') {
      parts.push(`Anflug ${Math.round((info.gotoProgress ?? 0) * 100)} %`);
    }
    this.setHud(parts.join('   '));
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
    this.root.remove();
  }

  // — Schubregler ————————————————————————————————————————————

  private bindThrottle(): void {
    const onDown = (ev: PointerEvent) => {
      if (this.pointerId !== null) return;
      this.pointerId = ev.pointerId;
      this.track.setPointerCapture(ev.pointerId);
      this.updateFromPointer(ev);
      ev.preventDefault();
      ev.stopPropagation();
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== this.pointerId) return;
      this.updateFromPointer(ev);
      ev.preventDefault();
      ev.stopPropagation();
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.setRaw(0); // Federrückstellung
      ev.preventDefault();
      ev.stopPropagation();
    };

    this.track.addEventListener('pointerdown', onDown);
    this.track.addEventListener('pointermove', onMove);
    this.track.addEventListener('pointerup', onUp);
    this.track.addEventListener('pointercancel', onUp);
    this.disposers.push(() => {
      this.track.removeEventListener('pointerdown', onDown);
      this.track.removeEventListener('pointermove', onMove);
      this.track.removeEventListener('pointerup', onUp);
      this.track.removeEventListener('pointercancel', onUp);
    });
  }

  private updateFromPointer(ev: PointerEvent): void {
    const r = this.track.getBoundingClientRect();
    const t = (ev.clientY - r.top) / Math.max(r.height, 1);
    this.setRaw(clamp(1 - 2 * t, -1, 1));
  }

  private setRaw(v: number): void {
    this.raw = v;
    // Kennlinie (Totzone + kubisch) liegt im Navigationskern, nicht in der UI —
    // sie gehört zur Steuerungsphysik und wird offline mitgeprüft.
    this.input.forward = throttleToForward(v);
    const pct = (0.5 - v * 0.5) * 100;
    this.knob.style.top = `${pct}%`;
    // Der Knopf leuchtet genau dann, wenn der Schub auch wirklich greift.
    this.knob.classList.toggle('nav-knob-active', Math.abs(this.input.forward) > THRUST_EPSILON);
  }

  private stepScale(factor: number): void {
    this.input.speedScale = clamp(
      this.input.speedScale * factor,
      this.opts.minScale,
      this.opts.maxScale,
    );
    this.refreshLabels();
  }

  private toggleAssist(): void {
    this.input.assist = !this.input.assist;
    this.refreshLabels();
  }

  private refreshLabels(): void {
    this.scaleLabel.textContent = formatScale(this.input.speedScale);
    this.assistBtn.classList.toggle('nav-btn-on', this.input.assist);
    this.lastDisplayedScale = this.input.speedScale;
  }

  // — Doppeltipp ——————————————————————————————————————————————

  /**
   * Rein beobachtend: kein preventDefault, kein stopPropagation. Die vorhandene
   * Multi-Pointer-Logik der Kamera (Pinch, Drag) bleibt dadurch unberührt.
   */
  private bindDoubleTap(): void {
    const onDown = (ev: PointerEvent) => {
      if (!ev.isPrimary) return;
      const now = performance.now();
      const dx = ev.clientX - this.lastTapX;
      const dy = ev.clientY - this.lastTapY;
      const near = Math.hypot(dx, dy) < 32;
      if (now - this.lastTapTime < 320 && near) {
        this.lastTapTime = 0;
        const r = this.opts.canvas.getBoundingClientRect();
        this.opts.onDoubleTap?.(ev.clientX - r.left, ev.clientY - r.top);
        return;
      }
      this.lastTapTime = now;
      this.lastTapX = ev.clientX;
      this.lastTapY = ev.clientY;
    };
    this.opts.canvas.addEventListener('pointerdown', onDown as EventListener, { passive: true });
    this.disposers.push(() =>
      this.opts.canvas.removeEventListener('pointerdown', onDown as EventListener),
    );
  }
}

// — DOM-Kleinkram ——————————————————————————————————————————————

function el(tag: string, cls: string): HTMLElement {
  const n = document.createElement(tag);
  n.className = cls;
  return n;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'nav-btn';
  b.textContent = label;
  b.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    onClick();
  });
  return b;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const s = document.createElement('style');
  s.textContent = `
.nav-ui{position:absolute;inset:0;pointer-events:none;
  font:500 12px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;color:#cfe3ff;
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none;}
.nav-hud{position:absolute;top:calc(env(safe-area-inset-top,0px) + 10px);left:50%;
  transform:translateX(-50%);padding:6px 12px;border-radius:8px;white-space:nowrap;
  background:rgba(8,14,26,.55);backdrop-filter:blur(6px);letter-spacing:.02em;}
.nav-column{position:absolute;right:calc(env(safe-area-inset-right,0px) + 12px);
  bottom:calc(env(safe-area-inset-bottom,0px) + 16px);
  display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:auto;}
.nav-track{position:relative;width:52px;height:190px;border-radius:26px;
  background:rgba(8,14,26,.5);border:1px solid rgba(120,170,240,.25);
  backdrop-filter:blur(6px);touch-action:none;}
.nav-center{position:absolute;top:50%;left:8px;right:8px;height:1px;
  background:rgba(140,190,255,.35);}
.nav-knob{position:absolute;left:50%;top:50%;width:38px;height:38px;margin:-19px 0 0 -19px;
  border-radius:50%;background:rgba(150,200,255,.28);border:1px solid rgba(180,220,255,.6);
  transition:background .12s ease;}
.nav-knob-active{background:rgba(120,200,255,.6);}
.nav-scale{display:flex;align-items:center;gap:2px;pointer-events:auto;}
.nav-scale-label{min-width:52px;text-align:center;padding:6px 4px;border-radius:8px;
  background:rgba(8,14,26,.5);backdrop-filter:blur(6px);}
.nav-row{display:flex;gap:6px;pointer-events:auto;}
.nav-btn{font:inherit;color:inherit;min-width:40px;min-height:36px;padding:0 10px;
  border-radius:8px;border:1px solid rgba(120,170,240,.25);background:rgba(8,14,26,.5);
  backdrop-filter:blur(6px);touch-action:none;-webkit-tap-highlight-color:transparent;}
.nav-btn-on{background:rgba(90,160,255,.45);border-color:rgba(180,220,255,.6);}
`;
  document.head.appendChild(s);
}
