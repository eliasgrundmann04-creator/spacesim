/**
 * Gefühlswerte der Kamera-Steuerung.
 * Three-frei, DOM-frei (§5).
 *
 * Alle Gefühlswerte sind per URL (`?feel=key:val,key2:val2`) überschreibbar,
 * damit sie im Browser live abgestimmt werden können.
 */

export interface FeelConfig {
  /** Nachlaufdauer in s; Gesamtweg = ω · τ. */
  spinTau: number;
  /** Obergrenze der Wurfgeschwindigkeit in rad/s. */
  maxSpin: number;
  /** So lange still vor dem Loslassen ⇒ kein Wurf (s). */
  flingRest: number;
  /** Wie viel schneller der exakte Griff zum Rand werden darf. */
  grabEdge: number;
  /** Übergang hinter der exakten Zone auf die Orbit-Rate in CSS-px. */
  edgeFadePx: number;
  /** Drehwinkel bis zum Einrasten in Grad. */
  twistStartDeg: number;
  /** Bogenlänge r̄·|Σφ| muss |Δr| um diesen Faktor übertreffen. */
  twistDominance: number;
  /** Abstandsänderung in px, nach der Drehen bis zum Loslassen gesperrt ist. */
  pinchLockPx: number;

  /** ≥ 0,5 schaltet den Gleit-Modus ein. */
  glide: number;
  /** h/s je ln-Einheit Spreizung. */
  glideGain: number;
  /** h/s je ln-Einheit beim Bremsen. */
  glideBrake: number;
  /** Höchstgeschwindigkeit vorwärts in h/s. */
  glideMax: number;
  /** Höchstgeschwindigkeit rückwärts in h/s. */
  glideMaxBack: number;
  /** Halbwertszeit des Gleitens in s. */
  glideHalfLife: number;
  /** Zeitkonstante, mit der die Flugrichtung dem Blick folgt, in s. */
  glideCoupleTau: number;

  /** ≥ 0,5 schaltet Begrenzer und Rückführung ein. */
  autoPace: number;
  /** Kürzeste Zeit bis zum Kontakt beim Anflug, in s. */
  ttcMin: number;
  /** Größenordnungen, nach denen sich die Abweichung der Stufe (im Log) halbiert. */
  stageHalfDecades: number;
}

export interface FeelRange {
  min: number;
  max: number;
}

export const FEEL_RANGES: Record<keyof FeelConfig, FeelRange> = {
  spinTau: { min: 0.05, max: 3 },
  maxSpin: { min: 1, max: 30 },
  flingRest: { min: 0.02, max: 0.3 },
  grabEdge: { min: 1.05, max: 6 },
  edgeFadePx: { min: 20, max: 600 },
  twistStartDeg: { min: 0, max: 60 },
  twistDominance: { min: 0, max: 5 },
  pinchLockPx: { min: 5, max: 300 },

  glide: { min: 0, max: 1 },
  glideGain: { min: 0.05, max: 10 },
  glideBrake: { min: 0.05, max: 20 },
  glideMax: { min: 0.1, max: 90 },
  glideMaxBack: { min: 0, max: 10 },
  glideHalfLife: { min: 0.3, max: 60 },
  glideCoupleTau: { min: 0.02, max: 5 },

  autoPace: { min: 0, max: 1 },
  ttcMin: { min: 0.1, max: 10 },
  stageHalfDecades: { min: 0.1, max: 20 },
};

export const DEFAULT_FEEL: Readonly<FeelConfig> = {
  spinTau: 0.8,
  maxSpin: 12,
  flingRest: 0.05,
  grabEdge: 1.5,
  edgeFadePx: 150,
  twistStartDeg: 20,
  twistDominance: 1.5,
  pinchLockPx: 40,

  glide: 0,
  glideGain: 0.8,
  glideBrake: 1.6,
  glideMax: 3,
  glideMaxBack: 0.5,
  glideHalfLife: 5,
  glideCoupleTau: 0.5,

  autoPace: 1,
  ttcMin: 0.6,
  stageHalfDecades: 1,
};

/** Global steuerbares Gefühlskonfigurationsobjekt. */
export const FEEL: FeelConfig = { ...DEFAULT_FEEL };

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

/**
 * Parst einen URL-Suchstring (z. B. `?feel=spinTau:1.4,twistStartDeg:25` oder `feel=...`)
 * und überschreibt `FEEL`.
 */
export function parseFeel(search: string): void {
  // Zurücksetzen auf Standardwerte
  Object.assign(FEEL, DEFAULT_FEEL);

  if (!search) return;

  const rawSearch = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(rawSearch);
  const feelParam = params.get('feel');
  if (!feelParam) return;

  const pairs = feelParam.split(',');
  const isBrowser = typeof window !== 'undefined' && typeof console !== 'undefined';

  for (const pair of pairs) {
    if (!pair.trim()) continue;
    const parts = pair.split(':');
    if (parts.length !== 2) continue;

    const key = parts[0].trim() as keyof FeelConfig;
    const valStr = parts[1].trim();
    const val = Number(valStr);

    if (!(key in DEFAULT_FEEL)) {
      if (isBrowser) {
        console.warn(`[feel] Unbekannter Schlüssel in URL: '${key}'`);
      }
      continue;
    }

    if (!Number.isFinite(val)) continue;

    const range = FEEL_RANGES[key];
    FEEL[key] = clamp(val, range.min, range.max);
  }
}

export function setFeel(key: string, value: number): boolean {
  if (!(key in DEFAULT_FEEL)) return false;
  if (!Number.isFinite(value)) return false;
  const k = key as keyof FeelConfig;
  const range = FEEL_RANGES[k];
  FEEL[k] = clamp(value, range.min, range.max);
  return true;
}

export function isLogScale(key: keyof FeelConfig): boolean {
  const range = FEEL_RANGES[key];
  return range.min > 0 && range.max / range.min >= 20;
}

export function valueToSlider(value: number, key: keyof FeelConfig): number {
  const range = FEEL_RANGES[key];
  const v = clamp(value, range.min, range.max);
  if (isLogScale(key)) {
    return (Math.log(v) - Math.log(range.min)) / (Math.log(range.max) - Math.log(range.min));
  }
  return (v - range.min) / (range.max - range.min);
}

export function sliderToValue(t: number, key: keyof FeelConfig): number {
  const range = FEEL_RANGES[key];
  const clampedT = clamp(t, 0, 1);
  if (isLogScale(key)) {
    return Math.exp(Math.log(range.min) + clampedT * (Math.log(range.max) - Math.log(range.min)));
  }
  return range.min + clampedT * (range.max - range.min);
}

export function feelToSearch(cfg: FeelConfig): string {
  const pairs: string[] = [];
  const keys = Object.keys(DEFAULT_FEEL) as (keyof FeelConfig)[];
  for (const k of keys) {
    const val = Number(cfg[k].toPrecision(4));
    const def = Number(DEFAULT_FEEL[k].toPrecision(4));
    if (val !== def) {
      pairs.push(`${k}:${val}`);
    }
  }
  return pairs.length > 0 ? `feel=${pairs.join(',')}` : '';
}

export function mergeFeelIntoSearch(search: string, cfg: FeelConfig): string {
  const hasQuestion = search.startsWith('?');
  const raw = hasQuestion ? search.slice(1) : search;
  const feelStr = feelToSearch(cfg);

  if (!raw) {
    return feelStr ? `?${feelStr}` : '';
  }

  const items = raw.split('&').filter((item) => item.length > 0);
  let replaced = false;
  const resultItems: string[] = [];

  for (const item of items) {
    const eqIdx = item.indexOf('=');
    const key = eqIdx >= 0 ? item.slice(0, eqIdx) : item;
    if (key === 'feel') {
      if (!replaced) {
        if (feelStr) {
          resultItems.push(feelStr);
        }
        replaced = true;
      }
    } else {
      resultItems.push(item);
    }
  }

  if (!replaced && feelStr) {
    resultItems.push(feelStr);
  }

  if (resultItems.length === 0) return '';
  return `?${resultItems.join('&')}`;
}

// Einmalige Übernahme aus globalThis.location?.search
if (typeof globalThis !== 'undefined' && globalThis.location?.search) {
  parseFeel(globalThis.location.search);
}
