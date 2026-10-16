// Einheiten-Umrechnung nur am Rand (§6): intern bleibt alles in m und m/s.

const AU = 1.495978707e11;
const LY = 9.4607304725808e15;
const C = 2.99792458e8;

function sig(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(Math.max(0, digits - 2));
  if (a >= 1) return v.toFixed(Math.max(0, digits - 1));
  return v.toFixed(digits);
}

export function formatDistance(m: number): string {
  const a = Math.abs(m);
  if (!Number.isFinite(a)) return '—';
  if (a < 1) return `${sig(m * 100)} cm`;
  if (a < 1e3) return `${sig(m)} m`;
  if (a < 0.01 * AU) return `${sig(m / 1e3)} km`;
  if (a < 0.05 * LY) return `${sig(m / AU)} AE`;
  return `${sig(m / LY)} Lj`;
}

export function formatSpeed(mps: number): string {
  const a = Math.abs(mps);
  if (!Number.isFinite(a)) return '—';
  if (a >= 1e-3 * C) return `${sig(mps / C)} c`;
  if (a >= 1e3) return `${sig(mps / 1e3)} km/s`;
  return `${sig(mps)} m/s`;
}

/** Schrittweise, log-gestufte Anzeige des Geschwindigkeitsmultiplikators. */
export function formatScale(scale: number): string {
  if (scale >= 1000) return `×${Math.round(scale)}`;
  if (scale >= 1) return `×${sig(scale, 2)}`;
  return `×${scale.toPrecision(2)}`;
}
