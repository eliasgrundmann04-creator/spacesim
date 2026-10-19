import type { FeelConfig } from '../nav/feel';
import {
  DEFAULT_FEEL,
  FEEL,
  FEEL_RANGES,
  mergeFeelIntoSearch,
  setFeel,
  sliderToValue,
  valueToSlider,
} from '../nav/feel';

const LABELS: Record<keyof FeelConfig, string> = {
  glide: 'Gleitmodus',
  glideGain: 'Schub-Gain',
  glideBrake: 'Brems-Gain',
  glideMax: 'Vmax Vorwärts',
  glideMaxBack: 'Vmax Rückwärts',
  glideHalfLife: 'Halbwertszeit',
  glideCoupleTau: 'Kopplung Tau',
  spinTau: 'Nachlauf Tau',
  maxSpin: 'Max. Wurf-Rate',
  flingRest: 'Ruhe-Schwelle',
  grabEdge: 'Rand-Verstärkung',
  edgeFadePx: 'Rand-Ausblendung',
  twistStartDeg: 'Dreh-Schwelle',
  twistDominance: 'Bogen-Dominanz',
  pinchLockPx: 'Pinch-Sperre',
};

const GROUPS: Array<{ title: string; keys: (keyof FeelConfig)[] }> = [
  {
    title: 'Gleitflug',
    keys: [
      'glide',
      'glideGain',
      'glideBrake',
      'glideMax',
      'glideMaxBack',
      'glideHalfLife',
      'glideCoupleTau',
    ],
  },
  { title: 'Nachlauf', keys: ['spinTau', 'maxSpin', 'flingRest'] },
  { title: 'Orbit-Griff', keys: ['grabEdge', 'edgeFadePx'] },
  { title: 'Zwei Finger', keys: ['twistStartDeg', 'twistDominance', 'pinchLockPx'] },
];

export class TuningPanel {
  private readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly copyFallback: HTMLInputElement;
  private readonly controlMap = new Map<
    keyof FeelConfig,
    { input: HTMLInputElement; valSpan: HTMLSpanElement }
  >();

  constructor(container: HTMLElement) {
    injectStyles();

    this.root = document.createElement('div');
    this.root.className = 'tune-root';

    // Event isolation to prevent camera gestures while interacting with panel
    const isolate = (ev: Event) => ev.stopPropagation();
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'click'].forEach(
      (type) => this.root.addEventListener(type, isolate),
    );

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'tune-toggle';
    toggleBtn.textContent = '⚙';
    toggleBtn.title = 'Tuning-Panel';
    toggleBtn.onclick = () => this.panel.classList.toggle('tune-open');
    this.root.appendChild(toggleBtn);

    this.panel = document.createElement('div');
    this.panel.className = 'tune-panel';

    const header = document.createElement('div');
    header.className = 'tune-header';
    header.innerHTML = '<span>Tuning-Panel</span>';

    const btnGroup = document.createElement('div');
    btnGroup.className = 'tune-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'tune-btn';
    copyBtn.textContent = 'Kopieren';
    copyBtn.onclick = () => this.copyUrl();

    const resetBtn = document.createElement('button');
    resetBtn.className = 'tune-btn';
    resetBtn.textContent = 'Standard';
    resetBtn.onclick = () => this.resetDefault();

    btnGroup.append(copyBtn, resetBtn);
    header.appendChild(btnGroup);
    this.panel.appendChild(header);

    this.copyFallback = document.createElement('input');
    this.copyFallback.type = 'text';
    this.copyFallback.className = 'tune-copy-fallback';
    this.copyFallback.readOnly = true;
    this.panel.appendChild(this.copyFallback);

    this.buildControls();

    this.root.appendChild(this.panel);
    container.appendChild(this.root);

    this.syncFromFeel();
  }

  private buildControls(): void {
    const assignedKeys = new Set<keyof FeelConfig>();
    const allGroups = [...GROUPS];

    // Collect unassigned keys into "Weitere"
    const unassigned: (keyof FeelConfig)[] = [];
    for (const k of Object.keys(DEFAULT_FEEL) as (keyof FeelConfig)[]) {
      let isAssigned = false;
      for (const g of GROUPS) {
        if (g.keys.includes(k)) {
          isAssigned = true;
          break;
        }
      }
      if (!isAssigned) unassigned.push(k);
    }
    if (unassigned.length > 0) {
      allGroups.push({ title: 'Weitere', keys: unassigned });
    }

    const scrollBox = document.createElement('div');
    scrollBox.className = 'tune-scroll';

    for (const g of allGroups) {
      const groupEl = document.createElement('div');
      groupEl.className = 'tune-group';
      const titleEl = document.createElement('div');
      titleEl.className = 'tune-group-title';
      titleEl.textContent = g.title;
      groupEl.appendChild(titleEl);

      for (const key of g.keys) {
        assignedKeys.add(key);
        const row = document.createElement('div');
        row.className = 'tune-row';

        const label = document.createElement('span');
        label.className = 'tune-label';
        label.textContent = LABELS[key] ?? key;

        const valSpan = document.createElement('span');
        valSpan.className = 'tune-val';

        let input: HTMLInputElement;

        if (key === 'glide') {
          input = document.createElement('input');
          input.type = 'checkbox';
          input.className = 'tune-checkbox';
          input.onchange = () => {
            this.updateValue(key, input.checked ? 1 : 0);
          };
        } else {
          input = document.createElement('input');
          input.type = 'range';
          input.min = '0';
          input.max = '1000';
          input.step = '1';
          input.className = 'tune-slider';
          input.oninput = () => {
            const v = sliderToValue(Number(input.value) / 1000, key);
            this.updateValue(key, v);
          };
        }

        row.append(label, input, valSpan);
        groupEl.appendChild(row);
        this.controlMap.set(key, { input, valSpan });
      }
      scrollBox.appendChild(groupEl);
    }
    this.panel.appendChild(scrollBox);
  }

  private updateValue(key: keyof FeelConfig, value: number): void {
    setFeel(key, value);
    this.syncFromFeel();
    this.updateUrl();
  }

  private updateUrl(): void {
    const search = mergeFeelIntoSearch(window.location.search, FEEL);
    const newUrl = window.location.pathname + search + window.location.hash;
    window.history.replaceState(null, '', newUrl);
  }

  private syncFromFeel(): void {
    for (const [key, { input, valSpan }] of this.controlMap.entries()) {
      const val = FEEL[key];
      if (key === 'glide') {
        input.checked = val >= 0.5;
        valSpan.textContent = val >= 0.5 ? 'An' : 'Aus';
      } else {
        const sliderPos = Math.round(valueToSlider(val, key) * 1000);
        input.value = String(sliderPos);
        valSpan.textContent = val.toPrecision(3);
      }
    }
  }

  private resetDefault(): void {
    Object.assign(FEEL, DEFAULT_FEEL);
    this.syncFromFeel();
    this.updateUrl();
    this.copyFallback.style.display = 'none';
  }

  private copyUrl(): void {
    const feelStr = mergeFeelIntoSearch(window.location.search, FEEL);
    const fullSearch = feelStr ? feelStr : '';
    const textToCopy = fullSearch.startsWith('?') ? fullSearch.slice(1) : fullSearch;

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(textToCopy).catch(() => {
        this.showCopyFallback(textToCopy);
      });
    } else {
      this.showCopyFallback(textToCopy);
    }
  }

  private showCopyFallback(text: string): void {
    this.copyFallback.value = text;
    this.copyFallback.style.display = 'block';
    this.copyFallback.select();
  }
}

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const s = document.createElement('style');
  s.textContent = `
.tune-root { position: absolute; top: calc(env(safe-area-inset-top, 0px) + 10px); left: 10px; z-index: 1000;
  font: 500 12px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; color: #cfe3ff;
  pointer-events: auto; user-select: none; -webkit-user-select: none; }
.tune-toggle { width: 36px; height: 36px; border-radius: 50%; border: 1px solid rgba(120, 170, 240, 0.35);
  background: rgba(8, 14, 26, 0.7); color: #cfe3ff; font-size: 18px; cursor: pointer;
  backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; }
.tune-panel { display: none; position: absolute; top: 44px; left: 0; width: min(320px, 40vw);
  max-height: calc(100vh - 70px); background: rgba(8, 14, 26, 0.85); border: 1px solid rgba(120, 170, 240, 0.3);
  border-radius: 10px; backdrop-filter: blur(10px); padding: 10px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5); }
.tune-panel.tune-open { display: flex; flex-direction: column; gap: 8px; }
.tune-header { display: flex; justify-content: space-between; align-items: center; font-weight: bold; border-bottom: 1px solid rgba(120, 170, 240, 0.2); padding-bottom: 6px; }
.tune-actions { display: flex; gap: 6px; }
.tune-btn { font: inherit; color: #cfe3ff; padding: 2px 8px; border-radius: 6px; border: 1px solid rgba(120, 170, 240, 0.3);
  background: rgba(20, 35, 60, 0.6); cursor: pointer; }
.tune-btn:active { background: rgba(50, 90, 150, 0.8); }
.tune-copy-fallback { display: none; width: 100%; box-sizing: border-box; background: #080e1a; color: #70b0ff;
  border: 1px solid rgba(120, 170, 240, 0.4); border-radius: 4px; padding: 4px; font: inherit; }
.tune-scroll { overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding-right: 4px; }
.tune-group-title { font-weight: bold; color: #70b0ff; margin-bottom: 4px; }
.tune-row { display: flex; align-items: center; gap: 6px; min-height: 32px; }
.tune-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tune-val { width: 42px; text-align: right; color: #90c0ff; }
.tune-slider { flex: 1.2; height: 32px; accent-color: #5090ff; cursor: pointer; touch-action: none; }
.tune-checkbox { width: 20px; height: 20px; accent-color: #5090ff; cursor: pointer; }
`;
  document.head.appendChild(s);
}
