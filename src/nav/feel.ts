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

// Einmalige Übernahme aus globalThis.location?.search
if (typeof globalThis !== 'undefined' && globalThis.location?.search) {
  parseFeel(globalThis.location.search);
}
