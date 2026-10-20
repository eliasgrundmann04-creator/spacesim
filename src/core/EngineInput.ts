import type { SpaceCamera } from '../camera/SpaceCamera';
import type { SimClock } from './SimClock';
import type { SceneManager } from './SceneManager';
import type { UniverseManager } from '../universe/UniverseManager';
import type { Navigator, NavResult } from '../nav/Navigator';
import type { CelestialBody } from '../universe/CelestialBody';
import type { BodyRef } from '../nav/types';
import type { Vec3 } from '../nav/vec';
import { pickBody, screenRay, tapTolerance } from '../nav/picking';
import { transformPoint } from '../frames/FrameTree';

export interface EngineInputCallbacks {
  getCamera: () => SpaceCamera;
  clock: SimClock;
  sceneManager: SceneManager;
  getUniverse: () => UniverseManager;
  navigator: Navigator;
  getDomElement: () => HTMLCanvasElement | HTMLElement;
  getNav: () => NavResult | null;
  setGotoUid: (uid: string | null) => void;
  getGotoUid: () => string | null;
}

export class EngineInput {
  readonly navBodies: BodyRef[] = [];
  readonly byUid = new Map<string, CelestialBody>();

  constructor(private readonly cb: EngineInputCallbacks) {}

  private get camera(): SpaceCamera {
    return this.cb.getCamera();
  }

  private get universe(): UniverseManager {
    return this.cb.getUniverse();
  }

  private get domElement(): HTMLCanvasElement | HTMLElement {
    return this.cb.getDomElement();
  }

  bindInput(): void {
    for (const button of document.querySelectorAll<HTMLElement>('#controls button')) {
      button.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.action(button.dataset.act ?? '');
      });
    }

    window.addEventListener('keydown', (e) => {
      switch (e.key) {
        case 'Tab':
          e.preventDefault();
          this.cycleTarget(e.shiftKey ? -1 : 1);
          break;
        case '.': this.action('faster'); break;
        case ',': this.action('slower'); break;
        case '0': this.action('warp'); break;
        case 'p': case 'P': this.action('pause'); break;
        default: {
          const n = Number(e.key);
          if (n >= 1 && n <= 9) {
            const body = this.cb.sceneManager.allBodies[n - 1];
            if (body) this.setTarget(body);
          }
        }
      }
    });
  }

  action(act: string): void {
    switch (act) {
      case 'prev': this.cycleTarget(-1); break;
      case 'next': this.cycleTarget(1); break;
      case 'in': this.camera.zoomStep(-1); break;
      case 'out': this.camera.zoomStep(1); break;
      case 'slower': this.cb.clock.slower(); break;
      case 'faster': this.cb.clock.faster(); break;
      case 'warp': this.cb.clock.resetWarp(); break;
      case 'pause': this.cb.clock.togglePause(); break;
    }
  }

  setTarget(body: CelestialBody): void {
    this.universe.populateSystem(body);
    if (this.camera.mode === 'orbit') {
      this.cb.navigator.resetMotion(this.camera.target && this.bodyRef(this.camera.target));
    }
    this.camera.enterFreeFlight();
    this.cb.navigator.requestGoto(toVec(this.camera.worldPosition), this.bodyRef(body));
    this.cb.setGotoUid(body.uid);
  }

  cycleTarget(direction: 1 | -1): void {
    const bodies = this.cb.sceneManager.allBodies;
    if (bodies.length === 0) return;
    const nav = this.cb.getNav();
    const anchor = nav?.anchor ? this.byUid.get(nav.anchor.id) ?? null : null;
    const current = this.camera.mode === 'free' ? anchor ?? this.camera.target : this.camera.target;
    const i = current ? bodies.indexOf(current) : 0;
    const next = (i + direction + bodies.length) % bodies.length;
    this.setTarget(bodies[next]);
  }

  gotoAtScreen(x: number, y: number): void {
    const rect = this.domElement.getBoundingClientRect();
    const fov = this.camera.fovYRadians;
    const ray = screenRay(x, y, rect.width, rect.height, fov, this.camera.basis());

    this.collectBodies();
    const hit = pickBody(
      toVec(this.camera.worldPosition),
      ray,
      this.navBodies,
      tapTolerance(fov, rect.height),
    );
    if (!hit) return;

    const body = this.byUid.get(hit.body.id);
    if (body) this.setTarget(body);
  }

  collectBodies(): void {
    const warp = this.cb.clock.paused ? 0 : this.cb.clock.timeWarp;
    const camFrame = this.camera.frame;
    this.navBodies.length = 0;
    this.byUid.clear();
    for (const b of this.cb.sceneManager.allBodies) {
      this.byUid.set(b.uid, b);
      if (!isFinite3(b.position) || !isFinite3(b.velocity)) continue;
      let pos = { x: b.position.x, y: b.position.y, z: b.position.z };
      if (camFrame && b.frame && camFrame !== b.frame) {
        pos = transformPoint(pos, b.frame, camFrame);
      }
      this.navBodies.push({
        id: b.uid,
        name: b.name,
        position: pos,
        radius: b.radius,
        velocity: { x: b.velocity.x * warp, y: b.velocity.y * warp, z: b.velocity.z * warp },
      });
    }
  }

  bodyRef(body: CelestialBody): BodyRef {
    const warp = this.cb.clock.paused ? 0 : this.cb.clock.timeWarp;
    const camFrame = this.camera.frame;
    let pos = { x: body.position.x, y: body.position.y, z: body.position.z };
    if (camFrame && body.frame && camFrame !== body.frame) {
      pos = transformPoint(pos, body.frame, camFrame);
    }
    return {
      id: body.uid,
      name: body.name,
      position: pos,
      radius: body.radius,
      velocity: {
        x: body.velocity.x * warp,
        y: body.velocity.y * warp,
        z: body.velocity.z * warp,
      },
    };
  }
}

export function isFinite3(v: { x: number; y: number; z: number }): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

export function toVec(v: { x: number; y: number; z: number }): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}
