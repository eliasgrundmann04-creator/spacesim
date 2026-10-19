// Minimaler Stub für 'three/webgpu' in den Offline-Tests.
// Enthält nur, was Vector3d und CelestialBody zur *Laufzeit* anfassen — alles
// Übrige (Renderer, Materialien, Geometrie) taucht in den three-freien Rechen-
// kernen und in Kepler ohnehin nicht auf.
export class Group {
  constructor() {
    this.name = '';
    this.position = { set() {} };
    this.children = [];
  }
  add(child) { this.children.push(child); }
}

export class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
}

export class PerspectiveCamera {
  constructor(fov = 50, aspect = 1, near = 0.1, far = 2000) {
    this.fov = fov;
    this.aspect = aspect;
    this.near = near;
    this.far = far;
    this.up = new Vector3(0, 0, 1);
    this.position = new Vector3(0, 0, 0);
    this.quaternion = { set() {} };
  }
  updateProjectionMatrix() {}
}

export const MathUtils = {
  clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
  lerp: (a, b, t) => a + (b - a) * t,
};
