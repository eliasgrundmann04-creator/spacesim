import type { Vec3 } from './vec';
import { add, clamp, cross, dot, length, normalize, scale } from './vec';
import type { LevelConfig, Quat } from './orientation';
import {
  DEFAULT_LEVEL, basisFromQuat, mulQuat, normalizeQuat, quatFromAxisAngle, rollAngle, rollLocal,
  rotateLocal,
} from './orientation';

/**
 * Zieh-Gesten der Kamera — kein three.js, kein DOM (§5).
 *
 * **Roll bleibt, wie er ist.** Eine Drehung um *eine* lokale Achse (`rotateLocal`)
 * folgt dem Finger exakt, kippt bei schrägen Gesten aber den Horizont: die Achse
 * liegt schräg im Bild, und eine Drehung um sie dreht `up` mit. `levelRoll` holt das
 * danach mit τ = 0,8 s zurück — genau das war als ungewolltes Nachdrehen um die
 * Bildschirmnormale sichtbar. Hier wird der Roll-Anteil jedes Schritts sofort
 * zurückgenommen (`holdRoll`). Abseits des Pols ist das dieselbe Bewegung wie
 * Gieren um worldUp plus Nicken um die Rechtsachse, ohne deren Polanschlag: nahe
 * worldUp blendet die Korrektur aus (wie `levelRoll`), dort dreht der Blick frei.
 *
 * **Orbit: der Boden klebt am Finger** (Globus-Steuerung). Beim Aufsetzen wird der
 * berührte Punkt der Kugel gemerkt; jeder Zug dreht das Kamera-Rig so um das
 * Zentrum, dass der Fingerstrahl wieder genau diesen Punkt trifft. Die verbleibende
 * Freiheit — Drehung um die Achse Zentrum → Griffpunkt, die den Griff nicht
 * verschiebt — hält den Roll fest: Norden bleibt oben.
 */

/** Rate des Freiflugs in rad je CSS-px der kürzeren Bildschirmkante. */
export const LOOK_RATE = 2.2;

/** Rig-Drehung `a → b` (Einheitsvektoren) — über atan2, damit µrad-Schritte am Boden nicht in acos untergehen. */
export function arcBetween(a: Vec3, b: Vec3): Quat {
  const axis = cross(a, b);
  const s = length(axis);
  if (!(s > 0)) return { x: 0, y: 0, z: 0, w: 1 };
  return quatFromAxisAngle(axis, Math.atan2(s, dot(a, b)));
}

/**
 * Erster Schnittpunkt eines Strahls mit einer Kugel um den Ursprung, als Einheitsrichtung.
 * `origin` relativ zum Kugelzentrum, `dir` normiert. `null` bei Fehltreffer oder Start in der Kugel.
 * Numerisch stabil: |o|² − R² als (|o| − R)(|o| + R) und t = c / (−b + √disc) —
 * die naive Formel −b − √disc löscht in 2 m Höhe über 6,4e6 m Radius aus (§4.7).
 */
export function hitSphere(origin: Vec3, dir: Vec3, radius: number): Vec3 | null {
  const d = length(origin);
  const h = d - radius;
  if (!(h > 0)) return null;
  const b = dot(origin, dir);
  if (b >= 0) return null;
  const c = h * (d + radius);
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = c / (-b + Math.sqrt(disc));
  return normalize(add(origin, scale(dir, t)));
}

function wrapAngle(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}

function smoothstep(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

/** 0 am Pol (Blick ∥ worldUp, "oben" unbestimmt), 1 ab `poleFade` — wie in `levelRoll`. */
function poleGain(q: Quat, worldUp: Vec3, cfg: LevelConfig): number {
  const axial = Math.abs(clamp(dot(basisFromQuat(q).forward, normalize(worldUp)), -1, 1));
  return smoothstep(Math.acos(axial) / Math.max(cfg.poleFade, 1e-6));
}

/**
 * Roll-Sollwert für `after`: der Roll von `before`, am Pol anteilig freigegeben.
 * `null` heißt: nicht korrigieren — am Pol selbst und beim Sprung über ihn
 * (dort springt der gemessene Roll um π, das ist kein Drift).
 */
function rollTarget(before: Quat, after: Quat, worldUp: Vec3, cfg: LevelConfig): number | null {
  const r0 = rollAngle(before, worldUp);
  const r1 = rollAngle(after, worldUp);
  if (r0 === null || r1 === null) return null;
  const d = wrapAngle(r1 - r0);
  if (Math.abs(d) > Math.PI / 2) return null;
  return r0 + d * (1 - poleGain(after, worldUp, cfg));
}

/** Roll-Änderung von `before` nach `after` zurücknehmen (Drehung um die Blickachse). */
export function holdRoll(before: Quat, after: Quat, worldUp: Vec3, cfg: LevelConfig = DEFAULT_LEVEL): Quat {
  const target = rollTarget(before, after, worldUp, cfg);
  if (target === null) return after;
  // rollLocal(q, r) senkt den gemessenen Roll um genau r (siehe levelRoll)
  return rollLocal(after, wrapAngle((rollAngle(after, worldUp) ?? target) - target));
}

/** Freies Umsehen und Nachlauf: eine Drehung im Kamerarahmen, Roll gehalten. */
export function dragLook(
  q: Quat, pitch: number, yaw: number, worldUp: Vec3, cfg: LevelConfig = DEFAULT_LEVEL,
): Quat {
  return holdRoll(q, rotateLocal(q, pitch, yaw), worldUp, cfg);
}

/**
 * Orbit-Griff: neue Orientierung, bei der der Strahl `ray` (Weltrichtung, bezogen auf
 * die *aktuelle* Orientierung `q`) den Griffpunkt `grab` (Einheitsrichtung vom Zentrum)
 * trifft. Die Kamera steht im Orbit bei −forward · distance; jede Orientierung ist
 * damit zugleich eine Rig-Drehung um das Zentrum. `null`, wenn der Strahl die Kugel verfehlt.
 */
export function orbitGrab(
  q: Quat, distance: number, radius: number, ray: Vec3, grab: Vec3, worldUp: Vec3,
  cfg: LevelConfig = DEFAULT_LEVEL,
): Quat | null {
  const forward = basisFromQuat(q).forward;
  const hit = hitSphere(scale(forward, -distance), ray, radius);
  if (!hit) return null;
  const moved = normalizeQuat(mulQuat(arcBetween(hit, grab), q));

  const target = rollTarget(q, moved, worldUp, cfg);
  if (target === null) return moved;
  // Die Drehung um `grab` lässt den Griff fest und ändert vor allem den Roll —
  // um so stärker, je näher der Griff an der Bildmitte liegt (Steigung ≈ −c).
  const c = -dot(grab, basisFromQuat(moved).forward);
  if (c < 0.05) return moved; // Griff am Rand: Roll kaum steuerbar, lieber nicht korrigieren
  const turned = (beta: number): Quat => normalizeQuat(mulQuat(quatFromAxisAngle(grab, beta), moved));
  const error = (p: Quat): number => wrapAngle((rollAngle(p, worldUp) ?? target) - target);

  // Sekantenverfahren auf β; Startschritt aus der Steigung −c.
  let b0 = 0;
  let e0 = error(moved);
  let b1 = e0 / c;
  let best = moved;
  let bestErr = Math.abs(e0);
  for (let i = 0; i < 5 && bestErr > 1e-12; i++) {
    const p = turned(b1);
    const e1 = error(p);
    if (Math.abs(e1) < bestErr) {
      best = p;
      bestErr = Math.abs(e1);
    }
    if (e1 === e0) break;
    const b2 = b1 - (e1 * (b1 - b0)) / (e1 - e0);
    b0 = b1;
    e0 = e1;
    b1 = b2;
  }
  return best;
}

/** Nick-/Gier-Anteil der Drehung `from → to` im Kamerarahmen von `from` (für den Nachlauf). */
export function localTurn(from: Quat, to: Quat): { pitch: number; yaw: number } {
  const d = mulQuat({ x: -from.x, y: -from.y, z: -from.z, w: from.w }, to);
  const sign = d.w < 0 ? -1 : 1; // kürzerer Weg
  const s = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
  if (!(s > 0)) return { pitch: 0, yaw: 0 };
  const k = (2 * Math.atan2(s, Math.abs(d.w))) / s;
  return { pitch: sign * d.x * k, yaw: sign * d.y * k };
}

/**
 * Drehrate im Orbit in rad je px: so schnell, wie sich der Boden in Bildmitte unter dem
 * Finger bewegt — 2·tan(fovY/2)/Höhe · (d − R)/R —, nach oben auf die Freiflug-Rate begrenzt.
 * Gilt, wo der Griff nicht greift (Finger neben dem Körper, Zwei-Finger-Schwenk).
 */
export function orbitRate(
  distance: number, radius: number, fovY: number, heightPx: number, minEdgePx: number,
): number {
  const look = LOOK_RATE / Math.max(minEdgePx, 1);
  if (!(radius > 0) || !(distance > radius)) return look;
  const perPx = (2 * Math.tan(fovY / 2)) / Math.max(heightPx, 1); // Bildebene, nicht fovY/Höhe
  return Math.min(look, perPx * ((distance - radius) / radius));
}
