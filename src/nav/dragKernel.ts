import type { Vec3 } from './vec';
import { cross, dot, length, scale, vec3 } from './vec';
import type { Quat } from './orientation';
import { mulQuat, normalizeQuat, quat, quatFromAxisAngle } from './orientation';

/**
 * Zieh-Geste → Drehung der Kamera. Kein three.js, kein DOM (§5).
 *
 * Jede Geste ergibt einen **Drehvektor im Kamerarahmen** (Achse · Winkel; x = rechts,
 * y = oben, z = Blickachse rückwärts). Die Kamera hängt ihn mit `applyTurn` an ihre
 * Orientierung an. Eine z-Komponente dreht das Bild um seine Mitte — sie entsteht
 * nur, wo die Finger sie verlangen (Griff auf einem Globus, Zwei-Finger-Drehen), sonst nie.
 *
 * Drei Arten, festgelegt beim Aufsetzen des Fingers (`chooseDrag`):
 *
 *   look  — Freiflug. Drehung um die Bildachse senkrecht zum Zug, z = 0.
 *           Der Inhalt folgt dem Finger.
 *   grab  — Orbit, Finger auf dem Körper. Der berührte Bodenpunkt bleibt unter dem
 *           Finger (Globus-Steuerung); über den Rand hinaus läuft die Umrundung weiter.
 *   orbit — Orbit, Finger daneben oder Körper kleiner als eine Fingerkuppe. Wie look,
 *           aber der *Körper* folgt dem Finger, nicht der Himmel; z = 0.
 *
 * Bildschirmpunkte in CSS-px relativ zur linken oberen Ecke der Canvas.
 */

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface DragView {
  /** Canvas-Größe in CSS-px. */
  width: number;
  height: number;
  /** Vertikales Sichtfeld in rad. */
  fovY: number;
}

/** Orbit: die Kamera blickt auf das Zentrum. Radius bis zum Boden unter der Kamera. */
export interface OrbitView {
  distance: number;
  radius: number;
}

export type DragKind = 'look' | 'orbit' | 'grab';

/** Freiflug-Rate: rad je Länge der kürzeren Bildschirmkante. */
export const LOOK_RATE = 2.2;
/** Der Griff ist exakt, bis der Boden dort GRAB_EDGE-mal schneller läuft als in Bildmitte. */
export const GRAB_EDGE = 4;
/** Kleinere Scheiben (Radius in CSS-px) werden umkreist statt gegriffen. */
export const GRAB_MIN_PX = 40;
/** Hinter dem Rand der exakten Zone klingt die Griffrate auf dieser Länge (CSS-px) auf die Orbit-Rate ab. */
export const EDGE_FADE_PX = 150;
/** Zwei-Finger-Drehen setzt erst ab diesem Winkel (rad) seit Pinch-Beginn ein. */
export const TWIST_START = (8 * Math.PI) / 180;

export function chooseDrag(p: ScreenPoint, view: DragView, orbit: OrbitView | null): DragKind {
  if (!orbit) return 'look';
  const eps = heightRatio(orbit);
  if (!(eps > 0)) return 'orbit';
  const limbTan = 1 / Math.sqrt(eps * (2 + eps)); // tan des Scheibenrands
  const diskPx = (limbTan / Math.tan(view.fovY / 2)) * (view.height / 2);
  const { sx, sy } = screenPlane(p, view);
  return diskPx >= GRAB_MIN_PX && Math.hypot(sx, sy) <= limbTan ? 'grab' : 'orbit';
}

/**
 * Drehvektor (Kamerarahmen) für einen Zugschritt `from → to`. Ohne Orbit-Geometrie
 * ist jede Geste `look` — so bleibt ein Zug gültig, wenn mittendrin der Modus wechselt.
 */
export function dragTurn(
  kind: DragKind, from: ScreenPoint, to: ScreenPoint, view: DragView, orbit: OrbitView | null,
): Vec3 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (kind === 'look' || !orbit) {
    // nach unten ziehen ⇒ Blick hebt sich; nach rechts ⇒ Blick schwenkt nach links
    const k = lookRate(view);
    return vec3(dy * k, dx * k, 0);
  }
  const eps = heightRatio(orbit);
  if (!(eps > 0)) return vec3();
  if (kind === 'orbit') {
    const k = orbitRate(view, eps);
    return vec3(-dy * k, -dx * k, 0);
  }
  // Griff: der Zug wird an der Grenze der exakten Zone geteilt, die Teile nacheinander angehängt
  const a = screenPlane(from, view);
  const b = screenPlane(to, view);
  const [lo, hi] = discSpan(a.sx, a.sy, b.sx - a.sx, b.sy - a.sy, Math.tan(exactLimit(eps)));
  const at = (t: number): ScreenPoint =>
    t <= 0 ? from : t >= 1 ? to : { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  const parts: Vec3[] = [];
  if (lo > 0) parts.push(edgeTurn(from, at(lo), view, eps));
  // Innen: die Drehung, die den Kugelpunkt unter dem neuen Fingerort dorthin bringt, wo der
  // unter dem alten lag — der gegriffene Weltpunkt bleibt Schritt für Schritt exakt erhalten.
  if (hi > lo) parts.push(turnBetween(grabPoint(at(hi), view, eps), grabPoint(at(lo), view, eps)));
  if (hi < 1) parts.push(edgeTurn(at(hi), to, view, eps));
  return parts.length === 1 ? parts[0] : composeTurns(parts);
}

/**
 * Zugschritt hinter dem Rand der exakten Zone: wie `orbit` (Achse ⊥ Fingerbewegung, z = 0,
 * der Körper folgt dem Finger), die Umrundung läuft also weiter, statt am Horizont zu sättigen.
 * Am Rand schließt der Betrag stetig an den exakten Griff an — radial GRAB_EDGE · ε je rad
 * Strahlwinkel, quer dazu sin θ / tan α —, je nach Zugrichtung gemischt, und klingt mit
 * EDGE_FADE_PX auf die Orbit-Rate ab. Der Griffpunkt liegt nach dem Zurückziehen nicht mehr
 * unter dem Finger (Inhaberentscheidung, Aufgabe 08).
 */
function edgeTurn(from: ScreenPoint, to: ScreenPoint, view: DragView, eps: number): Vec3 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return vec3();
  const { sx, sy } = screenPlane({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, view);
  const rho = Math.hypot(sx, sy);
  const perPx = (2 * Math.tan(view.fovY / 2)) / Math.max(view.height, 1); // Bildebene je px
  const alpha = exactLimit(eps);
  const fade = Math.exp(-Math.max(0, rho - Math.tan(alpha)) / perPx / EDGE_FADE_PX);
  const base = orbitRate(view, eps);
  const radial = base + (GRAB_EDGE * eps * Math.cos(alpha) ** 2 * perPx - base) * fade;
  const across = base + ((Math.sin(surfaceAngle(alpha, eps)) / Math.tan(alpha)) * perPx - base) * fade;
  const c = rho > 0 ? (dx * sx - dy * sy) / (len * rho) : 0; // cos(Zug, radial); Bild-y zeigt nach unten
  const k = Math.sqrt(radial * radial * c * c + across * across * Math.max(0, 1 - c * c));
  return vec3(-dy * k, -dx * k, 0);
}

/** Abschnitt [lo, hi] von p + t·d (t ∈ [0, 1]) innerhalb des Kreises vom Radius r; leer ⇒ lo = hi = 1. */
function discSpan(px: number, py: number, dx: number, dy: number, r: number): [number, number] {
  const dd = dx * dx + dy * dy;
  const pd = px * dx + py * dy;
  const c = px * px + py * py - r * r;
  if (!(dd > 0)) return c <= 0 ? [0, 1] : [1, 1];
  const disc = pd * pd - dd * c;
  if (!(disc > 0)) return [1, 1];
  const root = Math.sqrt(disc);
  const lo = Math.min(1, Math.max(0, (-pd - root) / dd));
  const hi = Math.min(1, Math.max(0, (-pd + root) / dd));
  return hi > lo ? [lo, hi] : [1, 1];
}

/** Drehvektoren nacheinander anhängen und als einen zurückgeben. */
function composeTurns(parts: Vec3[]): Vec3 {
  let q = quat();
  for (const v of parts) q = applyTurn(q, v);
  if (q.w < 0) q = { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
  const s = Math.hypot(q.x, q.y, q.z);
  if (!(s > 0)) return vec3();
  return scale(vec3(q.x, q.y, q.z), (2 * Math.atan2(s, q.w)) / s);
}

/** Zwei-Finger-Drehen: Winkel der Fingerlinie (Bild-y nach unten), Summe seit Pinch-Beginn, eingerastet. */
export interface Twist {
  angle: number;
  total: number;
  engaged: boolean;
}

export function beginTwist(a: ScreenPoint, b: ScreenPoint): Twist {
  return { angle: Math.atan2(b.y - a.y, b.x - a.x), total: 0, engaged: false };
}

/**
 * Drehvektor (0, 0, Δφ) aus der Winkeländerung der Fingerlinie: das Bild dreht mit den Fingern
 * um seine Mitte (Finger im Uhrzeigersinn ⇒ Δφ > 0 ⇒ Kamera rollt gegen ihn, das Bild mit). Bis TWIST_START
 * nichts, denn jeder Pinch dreht ein wenig mit; beim Einrasten nur der Überschuss — kein Sprung —,
 * danach 1:1 in beide Richtungen.
 */
export function twistTurn(t: Twist, a: ScreenPoint, b: ScreenPoint): { twist: Twist; turn: Vec3 } {
  if (!(Math.hypot(b.x - a.x, b.y - a.y) > 0)) return { twist: t, turn: vec3() }; // keine Linie
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const delta = Math.atan2(Math.sin(angle - t.angle), Math.cos(angle - t.angle)); // über ±π hinweg
  const total = t.total + delta;
  const engaged = t.engaged || Math.abs(total) >= TWIST_START;
  const z = t.engaged ? delta : engaged ? Math.sign(total) * (Math.abs(total) - TWIST_START) : 0;
  return { twist: { angle, total, engaged }, turn: vec3(0, 0, z) };
}

/** Drehvektor im Kamerarahmen anhängen: q ⊗ exp(v). */
export function applyTurn(q: Quat, v: Vec3): Quat {
  const angle = length(v);
  if (!(angle > 0) || !Number.isFinite(angle)) return q;
  return normalizeQuat(mulQuat(q, quatFromAxisAngle(v, angle)));
}

/** Drehvektor, der Einheitsvektor a auf b dreht. Winkel über atan2: acos verliert µrad-Schritte. */
export function turnBetween(a: Vec3, b: Vec3): Vec3 {
  const axis = cross(a, b);
  const s = length(axis);
  if (!(s > 0)) return vec3();
  return scale(axis, Math.atan2(s, dot(a, b)) / s);
}

/**
 * Gegriffener Kugelpunkt unter einem Bildschirmpunkt der exakten Zone: Einheitsrichtung vom
 * Zentrum, im Kamerarahmen (+z zeigt zur Kamera). Die Kamera blickt im Orbit genau aufs Zentrum,
 * der Punkt liegt also in der Ebene aus Blickachse und Fingerstrahl.
 */
export function grabPoint(p: ScreenPoint, view: DragView, eps: number): Vec3 {
  const { sx, sy } = screenPlane(p, view);
  const rho = Math.hypot(sx, sy);
  if (!(rho > 0)) return vec3(0, 0, 1);
  const theta = surfaceAngle(Math.atan(rho), eps);
  const s = Math.sin(theta) / rho;
  return vec3(sx * s, sy * s, Math.cos(theta));
}

/**
 * Exakter Zentriwinkel des Bodenpunkts unter einem Strahl im Winkel α (nahe Kugelseite),
 * ε = Höhe / Radius. Sinussatz im Dreieck Zentrum–Kamera–Bodenpunkt: sin(α + θ) = k sin α
 * mit k = 1 + ε. Die naive Form asin(k sin α) − α zieht in Bodennähe zwei fast gleiche
 * Winkel voneinander ab; umgeformt steht ε(2 + ε) = k² − 1 als Faktor vorn (§4.7).
 */
export function surfaceAngle(alpha: number, eps: number): number {
  const k = 1 + eps;
  const s = Math.sin(alpha);
  const ks = k * s;
  const root = Math.sqrt(Math.max(0, (1 - ks) * (1 + ks)));
  return Math.asin(Math.min(1, (s * eps * (2 + eps)) / (k * Math.cos(alpha) + root)));
}

/**
 * Strahlwinkel, bis zu dem der Griff exakt ist: dort ist dθ/dα = GRAB_EDGE · ε. Näher am Rand
 * würde der exakte Griff beliebig empfindlich — am Horizont unendlich viele Grad je Pixel.
 * Aus dθ/dα = k cos α / √(1 − k² sin² α) − 1 nach sin² α aufgelöst; ε kürzt sich heraus,
 * deshalb auch am Boden (ε → 0) wohldefiniert: dort sind es 60°, mehr als der Bildschirm zeigt.
 */
export function exactLimit(eps: number): number {
  const e = GRAB_EDGE;
  const k = 1 + eps;
  const sin2 = ((e - 1) * ((e + 1) * eps + 2)) / (k * k * e * (e * eps + 2));
  return Math.asin(Math.sqrt(sin2));
}

/** Höhe / Radius aus der Orbit-Geometrie. */
function heightRatio(orbit: OrbitView): number {
  return (orbit.distance - orbit.radius) / orbit.radius;
}

function lookRate(view: DragView): number {
  return LOOK_RATE / Math.max(Math.min(view.width, view.height), 1);
}

/** Wie schnell der Boden in Bildmitte unter dem Finger läuft — höchstens die Freiflug-Rate. */
function orbitRate(view: DragView, eps: number): number {
  const centerGrab = ((2 * Math.tan(view.fovY / 2)) / Math.max(view.height, 1)) * eps;
  return Math.min(lookRate(view), centerGrab);
}

/** Bildschirmpunkt → Bildebene in Tiefe 1 (x rechts, y oben), wie `screenRay` in picking.ts. */
function screenPlane(p: ScreenPoint, view: DragView): { sx: number; sy: number } {
  const half = Math.tan(view.fovY / 2);
  const aspect = view.height > 0 ? view.width / view.height : 1;
  return {
    sx: (2 * (p.x / Math.max(view.width, 1)) - 1) * half * aspect,
    sy: (1 - 2 * (p.y / Math.max(view.height, 1))) * half,
  };
}
