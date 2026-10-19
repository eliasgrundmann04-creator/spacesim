import type { Vec3 } from './vec';
import { add, copy, length, relaxFactor, scale, sub, vec3 } from './vec';
import type { BodyRef } from './types';

export interface FrameCarryState {
  frameVelocity: Vec3;
  lastAnchorId: string | null;
  lastAnchorPos: Vec3 | null;
  carry: { id: string; position: Vec3 } | null;
}

export function createFrameCarryState(): FrameCarryState {
  return {
    frameVelocity: vec3(),
    lastAnchorId: null,
    lastAnchorPos: null,
    carry: null,
  };
}

export function clampMagnitude(v: Vec3, max: number): Vec3 {
  const l = length(v);
  if (!(max > 0) || l <= max) return l > 0 ? copy(v) : vec3();
  return scale(v, max / l);
}

export function applyFrameCarry(
  position: Vec3,
  state: FrameCarryState,
  bodies: readonly BodyRef[],
): { start: Vec3; carried: boolean } {
  if (state.carry) {
    for (const b of bodies) {
      if (b.id === state.carry.id) {
        return {
          start: add(position, sub(b.position, state.carry.position)),
          carried: true,
        };
      }
    }
  }
  return { start: copy(position), carried: false };
}

export function updateCarry(state: FrameCarryState, anchor: BodyRef | null): void {
  state.carry = anchor ? { id: anchor.id, position: copy(anchor.position) } : null;
}

export function trackFrameVelocity(
  state: FrameCarryState,
  anchor: BodyRef | null,
  dt: number,
  frameVelocityTau: number,
  lastReferenceSpeed: number,
  relVelocity: Vec3,
): Vec3 {
  const previous = state.frameVelocity;
  const switched = anchor ? state.lastAnchorId !== null && state.lastAnchorId !== anchor.id : false;

  if (!anchor) {
    state.frameVelocity = vec3();
    state.lastAnchorId = null;
    state.lastAnchorPos = null;
    return relVelocity;
  }

  if (anchor.velocity) {
    state.frameVelocity = copy(anchor.velocity);
  } else if (state.lastAnchorId === anchor.id && state.lastAnchorPos && dt > 0) {
    const measured = scale(sub(anchor.position, state.lastAnchorPos), 1 / dt);
    const a = relaxFactor(dt, frameVelocityTau);
    state.frameVelocity = {
      x: state.frameVelocity.x + (measured.x - state.frameVelocity.x) * a,
      y: state.frameVelocity.y + (measured.y - state.frameVelocity.y) * a,
      z: state.frameVelocity.z + (measured.z - state.frameVelocity.z) * a,
    };
  } else {
    state.frameVelocity = vec3();
  }

  let newRelVelocity = relVelocity;
  if (switched) {
    const carry = clampMagnitude(
      sub(previous, state.frameVelocity),
      Math.max(lastReferenceSpeed, length(relVelocity)),
    );
    newRelVelocity = add(relVelocity, carry);
  }

  state.lastAnchorId = anchor.id;
  state.lastAnchorPos = copy(anchor.position);
  return newRelVelocity;
}
