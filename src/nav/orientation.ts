import type { Vec3 } from './vec';
import { clamp, cross, dot, length, normalize, orthogonal, vec3 } from './vec';

/**
 * Kameraorientierung als Quaternion — kein three.js, kein DOM (§5).
 *
 * **Warum nicht theta/phi.** Kugelkoordinaten für die Blickrichtung haben zwei
 * Pole, und an beiden bricht die Steuerung zusammen:
 *
 *   1. Der Blick lässt sich nicht über den Pol hinausdrehen. Man kann klemmen
 *      (dann blockiert die Achse) oder durchlaufen lassen (dann kippt das Bild
 *      um 180°). Beides ist falsch.
 *   2. Die Winkelgeschwindigkeit einer waagerechten Geste ist |∂v/∂θ| = sin φ,
 *      also nahe dem Pol ≈ 0. Eine diagonale Geste bewegt dort fast nur die
 *      Vertikale — und der aufgestaute Azimut schlägt zu, sobald man wieder
 *      Richtung Äquator schwenkt. Genau das fühlt sich "verdreht" an.
 *
 * Ein Quaternion hat keine ausgezeichnete Achse. Eine Zieh-Geste (dx, dy) wird
 * hier als **eine** Drehung um die zur Geste senkrechte Achse im *Kamerarahmen*
 * ausgeführt: Betrag = √(dx² + dy²), Achse = (dy, −dx, 0)/|…|. Dadurch folgt die
 * Blickrichtung dem Finger exakt — unabhängig davon, wohin die Kamera zeigt, und
 * in jeder Richtung gleich schnell. Diagonalen sind damit korrekt *by construction*,
 * nicht durch eine Sonderbehandlung.
 *
 * Rahmenkonvention wie in three.js: lokal blickt die Kamera entlang −Z,
 * oben ist +Y, rechts ist +X. `basisFromQuat` liefert genau diese drei Achsen
 * in Weltkoordinaten.
 *
 * Der Preis der Freiheit ist Roll-Drift: zwei aufeinanderfolgende Drehungen um
 * verschiedene lokale Achsen ergeben zusammen eine kleine Drehung um die Blick-
 * achse (Holonomie auf der Kugel). Dagegen steht `levelRoll` — siehe dort.
 */

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Basis {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

export function quat(x = 0, y = 0, z = 0, w = 1): Quat {
  return { x, y, z, w };
}

export function copyQuat(q: Quat): Quat {
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

export function isFiniteQuat(q: Quat): boolean {
  return (
    Number.isFinite(q.x) && Number.isFinite(q.y) &&
    Number.isFinite(q.z) && Number.isFinite(q.w) &&
    q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w > 1e-12
  );
}

export function normalizeQuat(q: Quat): Quat {
  const l = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (!(l > 0)) return quat();
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
}

/** Hamilton-Produkt. `a ⊗ b` bedeutet: erst a, dann b **im Rahmen von a**. */
export function mulQuat(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const l = length(axis);
  if (!(l > 0) || !Number.isFinite(angle)) return quat();
  const h = angle / 2;
  const s = Math.sin(h) / l;
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(h) };
}

/** Dreht einen Weltvektor mit q (v' = q v q⁻¹), ohne Matrix-Zwischenschritt. */
export function rotateByQuat(q: Quat, v: Vec3): Vec3 {
  // t = 2 (q_vec × v); v' = v + q_w t + q_vec × t
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + q.y * tz - q.z * ty,
    y: v.y + q.w * ty + q.z * tx - q.x * tz,
    z: v.z + q.w * tz + q.x * ty - q.y * tx,
  };
}

/** Weltraum-Achsen der Kamera: right = +X, up = +Y, forward = −Z (three-Konvention). */
export function basisFromQuat(q: Quat): Basis {
  return {
    right: rotateByQuat(q, vec3(1, 0, 0)),
    up: rotateByQuat(q, vec3(0, 1, 0)),
    forward: rotateByQuat(q, vec3(0, 0, -1)),
  };
}

/** Quaternion aus einer orthonormalen Basis (Shepperd-Methode: nimmt die größte Komponente). */
export function quatFromBasis(right: Vec3, up: Vec3, forward: Vec3): Quat {
  // Spaltenweise Rotationsmatrix: [right, up, −forward]
  const m00 = right.x, m01 = up.x, m02 = -forward.x;
  const m10 = right.y, m11 = up.y, m12 = -forward.y;
  const m20 = right.z, m21 = up.z, m22 = -forward.z;
  const trace = m00 + m11 + m22;

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return normalizeQuat({ x: (m21 - m12) * s, y: (m02 - m20) * s, z: (m10 - m01) * s, w: 0.25 / s });
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return normalizeQuat({ x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s, w: (m21 - m12) / s });
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return normalizeQuat({ x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s, w: (m02 - m20) / s });
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return normalizeQuat({ x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s, w: (m10 - m01) / s });
}

/**
 * Zieh-Geste als *eine* Drehung im Kamerarahmen.
 *
 * @param pitch Drehung um die lokale X-Achse (rechts), positiv = Blick hebt sich.
 * @param yaw   Drehung um die lokale Y-Achse (oben), positiv = Blick wandert nach links.
 *
 * Es wird bewusst nicht erst geneigt und dann geschwenkt: die Verkettung zweier
 * Achsen erzeugt Roll und ist nicht kommutativ, die Diagonale liefe also je nach
 * Reihenfolge anders. Eine Achse, ein Winkel — das ist die Drehung, die der
 * Fingerbewegung auf der Blickkugel entspricht.
 */
export function rotateLocal(q: Quat, pitch: number, yaw: number): Quat {
  const angle = Math.sqrt(pitch * pitch + yaw * yaw);
  if (!(angle > 0) || !Number.isFinite(angle)) return copyQuat(q);
  const h = angle / 2;
  const s = Math.sin(h) / angle;
  const d: Quat = { x: pitch * s, y: yaw * s, z: 0, w: Math.cos(h) };
  return normalizeQuat(mulQuat(q, d));
}

/** Rollen um die Blickachse (positiv = Bild dreht sich gegen den Uhrzeigersinn). */
export function rollLocal(q: Quat, angle: number): Quat {
  if (!Number.isFinite(angle) || angle === 0) return copyQuat(q);
  const h = angle / 2;
  return normalizeQuat(mulQuat(q, { x: 0, y: 0, z: Math.sin(h), w: Math.cos(h) }));
}

/**
 * Aktueller Rollwinkel gegenüber `worldUp`, gemessen um die Blickachse.
 * `null`, wenn der Blick (fast) parallel zu worldUp steht — dort ist "oben"
 * nicht definiert, und **genau deshalb wird dort nicht nivelliert** statt zu klemmen.
 */
export function rollAngle(q: Quat, worldUp: Vec3): number | null {
  const b = basisFromQuat(q);
  const axial = dot(b.forward, worldUp);
  const wx = worldUp.x - b.forward.x * axial;
  const wy = worldUp.y - b.forward.y * axial;
  const wz = worldUp.z - b.forward.z * axial;
  const l = Math.sqrt(wx * wx + wy * wy + wz * wz);
  if (l < 1e-6) return null;
  const desired = { x: wx / l, y: wy / l, z: wz / l };
  return Math.atan2(-dot(b.right, desired), dot(b.up, desired));
}

export interface LevelConfig {
  /** Zeitkonstante der Nivellierung in s. */
  tau: number;
  /** Ab diesem Winkel zwischen Blick und worldUp wird voll nivelliert (rad). */
  poleFade: number;
  /** Rollwinkel, ab dem die Nivellierung ausblendet (rad) — Absicht wird nicht korrigiert. */
  rollFade: number;
}

export const DEFAULT_LEVEL: LevelConfig = {
  tau: 0.8,
  poleFade: 0.35,
  rollFade: 1.2,
};

/**
 * Roll-Drift gegen `worldUp` abbauen — die Gegenmaßnahme zur Holonomie.
 *
 * Zwei Ausblendungen, beide notwendig:
 *
 *   **Pol.** Nahe der worldUp-Achse ist "oben" unbestimmt; dort zu nivellieren
 *   hieße, um einen beliebig springenden Sollwert zu kreiseln. Also aus.
 *
 *   **Großer Rollwinkel.** Wer über den Pol hinweg nach hinten schwenkt, steht
 *   danach absichtlich auf dem Kopf. Diesen Zustand zurückzudrehen wäre eine
 *   ungefragte 180°-Drehung des Bildes. Korrigiert wird also nur Drift
 *   (kleine Winkel), nicht Absicht.
 *
 * Der Horizont bleibt dadurch im Normalbetrieb waagerecht, ohne dass irgendeine
 * Achse blockiert — das ist der Ersatz für den alten phi-Klemmbereich.
 */
export function levelRoll(q: Quat, worldUp: Vec3, dt: number, cfg: LevelConfig = DEFAULT_LEVEL): Quat {
  const roll = rollAngle(q, worldUp);
  if (roll === null || roll === 0) return copyQuat(q);

  const b = basisFromQuat(q);
  const axial = Math.abs(clamp(dot(b.forward, normalize(worldUp)), -1, 1));
  const poleAngle = Math.acos(axial);            // 0 = genau am Pol
  const poleGain = smoothstep(poleAngle / Math.max(cfg.poleFade, 1e-6));
  const rollGain = 1 - smoothstep((Math.abs(roll) - cfg.rollFade) / 0.6);
  const gain = poleGain * rollGain;
  if (gain <= 0) return copyQuat(q);

  // rollLocal(q, r) dreht `up` genau auf den Sollvektor, den `rollAngle` mit r misst.
  const a = cfg.tau > 0 ? 1 - Math.exp(-dt / cfg.tau) : 1;
  return rollLocal(q, roll * a * gain);
}

/**
 * Blick auf `dir` zudrehen — als kürzeste Drehung, nicht über Kugelkoordinaten.
 * `t = 1` setzt die Richtung exakt; kleinere Werte drehen anteilig (weiches Nachführen).
 * Der Rollzustand bleibt dabei erhalten, weil um die kürzeste Achse gedreht wird.
 */
export function turnTowards(q: Quat, dir: Vec3, t: number): Quat {
  const d = normalize(dir, vec3(0, 0, 0));
  if (length(d) === 0) return copyQuat(q);

  const forward = rotateByQuat(q, vec3(0, 0, -1));
  const c = clamp(dot(forward, d), -1, 1);
  const angle = Math.acos(c);
  if (angle < 1e-9) return copyQuat(q);

  // Antiparallel: die Drehachse ist nicht eindeutig — irgendeine senkrechte tut es.
  const axis = Math.PI - angle < 1e-6 ? orthogonal(forward) : cross(forward, d);
  return normalizeQuat(mulQuat(quatFromAxisAngle(axis, angle * clamp(t, 0, 1)), q));
}

/**
 * Orientierung aus einer Blickrichtung neu aufbauen, Roll auf worldUp genullt.
 * Für harte Setzpunkte (Erstplatzierung, Übergabe eines Anflugs an den Orbitmodus).
 * Am Pol wird eine beliebige, aber stetige Rechtsachse gewählt statt geklemmt.
 */
export function orientTowards(dir: Vec3, worldUp: Vec3, fallbackRight?: Vec3): Quat {
  const f = normalize(dir, vec3(0, 0, -1));
  const u = normalize(worldUp, vec3(0, 0, 1));

  let right = cross(f, u);
  if (length(right) < 1e-9) {
    right = fallbackRight && length(cross(f, fallbackRight)) > 1e-9
      ? normalize(cross(f, cross(fallbackRight, f)))
      : orthogonal(f);
  }
  right = normalize(right);
  const up = normalize(cross(right, f));
  return quatFromBasis(right, up, f);
}

function smoothstep(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}
