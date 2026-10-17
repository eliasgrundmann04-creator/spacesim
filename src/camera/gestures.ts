/**
 * Multi-Pointer-Gestenerkennung der Kamera, aus `SpaceCamera.ts` herausgelöst.
 * Übersetzt Pointer-Events in Ein-Finger-Zug, Pinch und Rad; was die Gesten
 * bedeuten, entscheidet die Kamera über die Rückrufe.
 */

interface PointerState { x: number; y: number; }

export interface GestureHandlers {
  /** Finger gesetzt; `count` = Finger danach. */
  press(x: number, y: number, count: number): void;
  /** Ein Finger bewegt (Position und Delta in CSS-px). */
  drag(x: number, y: number, dx: number, dy: number): void;
  /** Zwei Finger: Zoomfaktor (< 1 = heran) und Schwenk der Mitte. */
  pinch(factor: number, dx: number, dy: number): void;
  /** Finger gelöst; `count` = Finger danach. */
  release(count: number): void;
  wheel(factor: number): void;
  blur(): void;
}

export class GestureInput {
  private readonly pointers = new Map<number, PointerState>();
  private pinchDistance = 0;
  private pinchX = 0;
  private pinchY = 0;

  constructor(dom: HTMLElement, h: GestureHandlers) {
    dom.style.touchAction = 'none';

    dom.addEventListener('pointerdown', (e) => {
      dom.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      h.press(e.clientX, e.clientY, this.pointers.size);
      if (this.pointers.size === 2) this.beginPinch();
    });

    dom.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      prev.x = e.clientX;
      prev.y = e.clientY;

      if (this.pointers.size === 1) h.drag(e.clientX, e.clientY, dx, dy);
      else if (this.pointers.size === 2) this.updatePinch(h);
    });

    const release = (e: PointerEvent): void => {
      if (!this.pointers.delete(e.pointerId)) return;
      if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);
      h.release(this.pointers.size);
      // Bei 3 → 2 Fingern die Pinch-Basis neu setzen, sonst springt der Zoom
      if (this.pointers.size === 2) this.beginPinch();
      else this.pinchDistance = 0;
    };
    dom.addEventListener('pointerup', release);
    dom.addEventListener('pointercancel', release);
    window.addEventListener('blur', () => {
      this.pointers.clear();
      this.pinchDistance = 0;
      h.blur();
    });

    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        h.wheel(Math.exp(e.deltaY * 0.0015));
      },
      { passive: false },
    );

    // iOS-Safari: Seiten-Zoom per Pinch unterbinden, damit die Geste bei uns ankommt
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      dom.addEventListener(type, (e: Event) => e.preventDefault());
    }
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Anzahl der Finger auf dem Bildschirm. */
  get active(): number {
    return this.pointers.size;
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
  }

  private updatePinch(h: GestureHandlers): void {
    const [a, b] = this.twoPointers();
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;

    // Auseinanderziehen (dist wächst) ⇒ heranzoomen ⇒ Faktor < 1
    if (this.pinchDistance > 0) h.pinch(this.pinchDistance / dist, midX - this.pinchX, midY - this.pinchY);

    this.pinchDistance = dist;
    this.pinchX = midX;
    this.pinchY = midY;
  }
}
