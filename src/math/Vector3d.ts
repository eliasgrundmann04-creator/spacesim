import * as THREE from 'three/webgpu';

/**
 * 3D-Vektor in doppelter Genauigkeit (JS-Numbers sind IEEE-754 f64).
 *
 * Alle *absoluten* Positionen der Engine leben in Vector3d (Meter).
 * Auf die GPU gehen ausschließlich Differenzen relativ zur Kamera
 * (Floating Origin) — dort reicht f32, weil die Beträge nahe der
 * Kamera klein sind und ferne Objekte nur sub-pixel-genau sein müssen.
 */
export class Vector3d {
  x: number;
  y: number;
  z: number;

  // Felder explizit statt als Parameter-Properties: Nodes Type-Stripping kann
  // Letztere nicht entfernen, und Kepler/Vector3d sollen offline testbar bleiben (§8).
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x: number, y: number, z: number): this {
    this.x = x; this.y = y; this.z = z;
    return this;
  }

  copy(v: Vector3d): this { return this.set(v.x, v.y, v.z); }
  clone(): Vector3d { return new Vector3d(this.x, this.y, this.z); }

  add(v: Vector3d): this { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v: Vector3d): this { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }

  addVectors(a: Vector3d, b: Vector3d): this {
    return this.set(a.x + b.x, a.y + b.y, a.z + b.z);
  }

  subVectors(a: Vector3d, b: Vector3d): this {
    return this.set(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  multiplyScalar(s: number): this { this.x *= s; this.y *= s; this.z *= s; return this; }

  lengthSq(): number { return this.x * this.x + this.y * this.y + this.z * this.z; }
  length(): number { return Math.sqrt(this.lengthSq()); }

  distanceTo(v: Vector3d): number {
    const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  normalize(): this {
    const l = this.length();
    return l > 0 ? this.multiplyScalar(1 / l) : this;
  }

  /** f64 → f32-Übergabe an Three (nur für kamerarelative Größen verwenden!). */
  toVector3(target: THREE.Vector3): THREE.Vector3 {
    return target.set(this.x, this.y, this.z);
  }
}
