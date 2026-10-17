import type { Vec3 } from './vec';
import { cross, dot, length, scale, vec3 } from './vec';
import type { Quat } from './orientation';
import { mulQuat, normalizeQuat, quatFromAxisAngle } from './orientation';

/**
 * Zieh-Geste → Drehung der Kamera. Kein three.js, kein DOM (§5).
 *
 * Jede Geste ergibt einen **Drehvektor im Kamerarahmen** (Achse · Winkel; x = rechts,
 * y = oben, z = Blickachse rückwärts). Die Kamera hängt ihn mit `applyTurn` an ihre
 * Orientierung an. Eine z-Komponente dreht das Bild um seine Mitte — sie entsteht
 * nur, wo der Finger sie verlangt (Griff am Rand eines Globus), sonst nie.
 *
 * Drei Arten, festgelegt beim Aufsetzen des Fingers (`chooseDrag`):
 *
 *   look  — Freiflug. Drehung um die Bildachse senkrecht zum Zug, z = 0.
 *           Der Inhalt folgt dem Finger.
 *   grab  — Orbit, Finger auf dem Körper. Der berührte Bodenpunkt bleibt unter dem
 *           Finger (Globus-Steuerung).
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
  // Griff: die Drehung, die den Kugelpunkt unter dem neuen Fingerort dorthin bringt,
  // wo der unter dem alten lag. Damit bleibt der einmal gegriffene Weltpunkt über
  // den ganzen Zug derselbe — Schritt für Schritt exakt, ohne ihn zu speichern.
  return turnBetween(grabPoint(to, view, eps), grabPoint(from, view, eps));
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
 * Gegriffener Kugelpunkt unter einem Bildschirmpunkt: Einheitsrichtung vom Zentrum,
 * im Kamerarahmen (+z zeigt zur Kamera). Die Kamera blickt im Orbit genau aufs Zentrum,
 * der Punkt liegt also in der Ebene aus Blickachse und Fingerstrahl.
 */
export function grabPoint(p: ScreenPoint, view: DragView, eps: number): Vec3 {
  const { sx, sy } = screenPlane(p, view);
  const rho = Math.hypot(sx, sy);
  if (!(rho > 0)) return vec3(0, 0, 1);
  const theta = grabAngle(Math.atan(rho), eps);
  const s = Math.sin(theta) / rho;
  return vec3(sx * s, sy * s, Math.cos(theta));
}

/**
 * Zentriwinkel θ des gegriffenen Punkts für einen Fingerstrahl im Winkel α zur Blickachse.
 *
 * Innen exakt (`surfaceAngle`). Zum Rand hin wird der exakte Griff beliebig empfindlich —
 * am Horizont unendlich viele Grad je Pixel — und dahinter gibt es keinen Treffer mehr.
 * Ab `exactLimit` geht es deshalb mit derselben Steigung weiter, die sanft gegen den
 * Horizont sättigt: stetig differenzierbar, Drehung je Pixel überall ≤ GRAB_EDGE · ε,
 * und der Griffpunkt wandert nie über den Horizont.
 */
export function grabAngle(alpha: number, eps: number): number {
  const limit = exactLimit(eps);
  if (alpha <= limit) return surfaceAngle(alpha, eps);
  const at = surfaceAngle(limit, eps);
  const span = Math.atan(Math.sqrt(eps * (2 + eps))) - at; // Rest bis zum Horizont
  if (!(span > 0)) return at;
  return at + span * (1 - Math.exp((-(alpha - limit) * GRAB_EDGE * eps) / span));
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
 * Strahlwinkel, bis zu dem der Griff exakt ist: dort ist dθ/dα = GRAB_EDGE · ε.
 * Aus dθ/dα = k cos α / √(1 − k² sin² α) − 1 nach sin² α aufgelöst; ε kürzt sich heraus,
 * deshalb auch am Boden (ε → 0) wohldefiniert: dort sind es 60°, mehr als der Bildschirm zeigt.
 */
function exactLimit(eps: number): number {
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
