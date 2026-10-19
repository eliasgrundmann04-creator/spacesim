import type { DragKind, DragView, OrbitView, ScreenPoint, Twist } from '../nav/dragKernel';
import { beginTwist, chooseDrag, dragTurn, twistTurn } from '../nav/dragKernel';
import { FEEL } from '../nav/feel';
import { Fling } from '../nav/fling';
import { Glide } from '../nav/glide';
import type { Vec3 } from '../nav/vec';
import { ZERO, add, scale } from '../nav/vec';

/** Zwei-Finger-Schwenk dreht gedämpft mit. */
const PAN_GAIN = 0.6;

export interface PointerState {
  x: number;
  y: number;
}

export interface CameraTouchCallbacks {
  getFovYRadians(): number;
  getOrbitView(): OrbitView | null;
  getMode(): 'orbit' | 'free';
  applyStep(step: Vec3): void;
  zoomBy(factor: number): void;
}

export class CameraTouchInput {
  readonly fling = new Fling();
  readonly glide = new Glide();

  private dragKind: DragKind = 'look';
  private canvasRect = new DOMRect();

  private readonly pointers = new Map<number, PointerState>();
  private pinchDistance = 0;
  private pinchX = 0;
  private pinchY = 0;
  private twist: Twist = beginTwist({ x: 0, y: 0 }, { x: 1, y: 0 });

  constructor(
    private readonly dom: HTMLElement,
    private readonly callbacks: CameraTouchCallbacks,
  ) {
    dom.style.touchAction = 'none';
    this.bindPointer();
  }

  private bindPointer(): void {
    const dom = this.dom;

    dom.addEventListener('pointerdown', (e) => {
      dom.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.canvasRect = dom.getBoundingClientRect();
      this.fling.press(e.timeStamp / 1000);
      if (this.pointers.size === 1) this.dragKind = this.chooseDragAt(e.clientX, e.clientY);
      if (this.pointers.size === 2) this.beginPinch();
    });

    dom.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const from = { x: prev.x, y: prev.y };
      prev.x = e.clientX;
      prev.y = e.clientY;

      const time = e.timeStamp / 1000;
      if (this.pointers.size === 1) this.turn(this.dragKind, from, prev, 1, time);
      else if (this.pointers.size === 2) this.updatePinch(time);
    });

    const release = (e: PointerEvent): void => {
      if (!this.pointers.delete(e.pointerId)) return;
      if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);
      if (this.pointers.size < 2) this.glide.end();
      // Bei 3 → 2 Fingern die Pinch-Basis neu setzen, sonst springt der Zoom
      if (this.pointers.size === 2) this.beginPinch();
      else this.pinchDistance = 0;
      // 2 → 1: der verbleibende Finger beginnt einen neuen Zug, dort wo er liegt
      const rest = this.pointers.values().next().value;
      if (this.pointers.size === 1 && rest) this.dragKind = this.chooseDragAt(rest.x, rest.y);
      if (this.pointers.size === 0) this.fling.release(e.timeStamp / 1000);
    };
    dom.addEventListener('pointerup', release);
    dom.addEventListener('pointercancel', release);
    window.addEventListener('blur', () => {
      this.pointers.clear();
      this.pinchDistance = 0;
      this.fling.stop();
      this.glide.end();
    });

    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.callbacks.zoomBy(Math.exp(e.deltaY * 0.0015));
    }, { passive: false });

    // iOS-Safari: Seiten-Zoom per Pinch unterbinden, damit die Geste bei uns ankommt
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      dom.addEventListener(type, (e: Event) => e.preventDefault());
    }
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private turn(kind: DragKind, from: ScreenPoint, to: ScreenPoint, gain: number, time: number, extra = ZERO): void {
    const s = this.screen();
    const v = dragTurn(kind, s.local(from), s.local(to), s.view, this.callbacks.getOrbitView());
    const step = add(scale(v, gain), extra);
    this.callbacks.applyStep(step);
    this.fling.record(time, step);
  }

  private chooseDragAt(x: number, y: number): DragKind {
    const s = this.screen();
    return chooseDrag(s.local({ x, y }), s.view, this.callbacks.getOrbitView());
  }

  /** Canvas-Geometrie für den Gestenkern; `local` rechnet Client- in Canvas-Koordinaten um. */
  private screen(): { view: DragView; local: (p: ScreenPoint) => ScreenPoint } {
    const r = this.canvasRect;
    return {
      view: { width: r.width, height: r.height, fovY: this.callbacks.getFovYRadians() },
      local: (p) => ({ x: p.x - r.left, y: p.y - r.top }),
    };
  }

  private twoPointers(): [PointerState, PointerState] {
    const it = this.pointers.values();
    return [it.next().value as PointerState, it.next().value as PointerState];
  }

  private beginPinch(): void {
    const [a, b] = this.twoPointers();
    this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    this.pinchX = (a.x + b.x) / 2;
    this.pinchY = (a.y + b.y) / 2;
    this.twist = beginTwist(a, b);
    if (FEEL.glide >= 0.5) {
      this.glide.begin();
    }
  }

  private updatePinch(time: number): void {
    const [a, b] = this.twoPointers();
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;

    if (this.pinchDistance > 0) {
      if (FEEL.glide >= 0.5) {
        const lambda = Math.log(dist / this.pinchDistance);
        this.glide.pinch(lambda);
      } else {
        // Auseinanderziehen (dist wächst) ⇒ heranzoomen ⇒ Distanz sinkt
        this.callbacks.zoomBy(this.pinchDistance / dist);
      }
      // Schwenk dreht mit, nie als Griff (zwei Finger halten keinen Punkt); die Fingerlinie dreht das Bild
      const kind = this.callbacks.getMode() === 'orbit' ? 'orbit' : 'look';
      const twist = twistTurn(this.twist, a, b);
      this.twist = twist.twist;
      const panGain = FEEL.glide >= 0.5 ? 0 : PAN_GAIN;
      this.turn(kind, { x: this.pinchX, y: this.pinchY }, { x: midX, y: midY }, panGain, time, twist.turn);
    }

    this.pinchDistance = dist;
    this.pinchX = midX;
    this.pinchY = midY;
  }
}
