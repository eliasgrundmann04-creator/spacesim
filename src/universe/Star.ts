import * as THREE from 'three/webgpu';
import { CelestialBody, BodyParams } from './CelestialBody';
import { Vector3d } from '../math/Vector3d';

export interface StarParams extends BodyParams {
  temperature: number;  // K
  luminosity: number;   // W
}

// Skaliert Leuchtkraft (W) auf Three-Lichtintensität, sodass 1 L☉ in 1 AE
// mit ACES-Tonemapping eine plausible Beleuchtung ergibt (Decay = 2 ⇒ 1/d²).
const LIGHT_SCALE = 1.5e-4;

let glowTexture: THREE.CanvasTexture | null = null;
function getGlowTexture(): THREE.CanvasTexture {
  if (!glowTexture) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.22, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    glowTexture = new THREE.CanvasTexture(c);
  }
  return glowTexture;
}

/** Schwarzkörper-Approximation Kelvin → RGB (nach Tanner Helland). */
export function colorFromTemperature(kelvin: number): THREE.Color {
  const t = THREE.MathUtils.clamp(kelvin, 1000, 40000) / 100;
  let r: number, g: number, b: number;

  r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  g = t <= 66
    ? 99.4708025861 * Math.log(t) - 161.1195681661
    : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;

  return new THREE.Color(
    THREE.MathUtils.clamp(r, 0, 255) / 255,
    THREE.MathUtils.clamp(g, 0, 255) / 255,
    THREE.MathUtils.clamp(b, 0, 255) / 255,
  );
}

export class Star extends CelestialBody {
  readonly temperature: number;
  readonly luminosity: number;

  /** Nur bei prozeduralen Sternen gesetzt: Seed für die Lazy-Systemgenerierung. */
  systemSeed: number | null = null;
  populated = true;

  private sprite: THREE.Sprite | null = null;
  private spriteMat: THREE.SpriteMaterial | null = null;

  constructor(params: StarParams) {
    super(params);
    this.temperature = params.temperature;
    this.luminosity = params.luminosity;
  }

  buildRenderObject(): void {
    const color = colorFromTemperature(this.temperature);

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(this.radius, 48, 24),
      new THREE.MeshBasicMaterial({ color }),
    );
    this.root.add(mesh);

    // Physikalischer 1/d²-Abfall über AE-Distanzen
    const light = new THREE.PointLight(color, this.luminosity * LIGHT_SCALE, 0, 2);
    this.root.add(light);

    // Glow-Sprite: hält den Stern auf jeder Distanz sichtbar (min. Winkelgröße),
    // damit prozedurale Nachbarsterne in Lj-Entfernung als Lichtpunkte erscheinen.
    this.spriteMat = new THREE.SpriteMaterial({
      map: getGlowTexture(),
      color,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.sprite = new THREE.Sprite(this.spriteMat);
    this.root.add(this.sprite);
  }

  override update(_dt: number, cameraPos: Vector3d): void {
    if (!this.sprite || !this.spriteMat) return;
    const d = this.position.distanceTo(cameraPos);
    // Winkelgröße: mindestens ~0.006 rad, nahe dem Stern proportional zur Scheibe
    this.sprite.scale.setScalar(Math.max(this.radius * 4, d * 0.006));
    // Ausblenden bei Annäherung, damit der Glow die Oberfläche nicht überstrahlt
    this.spriteMat.opacity = THREE.MathUtils.clamp((d - 3 * this.radius) / (20 * this.radius), 0, 0.9);
  }

  override getSurfaceOffset(): number {
    return this.radius * 0.1; // Sicherheitsabstand zur "Oberfläche"
  }
}
