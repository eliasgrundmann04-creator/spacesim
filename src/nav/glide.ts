import type { Vec3 } from './vec';
import { dot, length, scale, slerpDir, vec3 } from './vec';
import type { NavInput } from './types';
import { DEFAULT_FLIGHT } from './flightKernel';
import { FEEL } from './feel';

const EPSILON = 0.01;

export class Glide {
  /** Signierte Geschwindigkeit in Referenzhöhen pro Sekunde (h/s). */
  private s = 0;
  /** Flugrichtung im Weltraum (Einheitsvektor). */
  private u: Vec3 = vec3(0, 0, 1);
  /** Fahrtrichtung zu Gestenbeginn (-1, 0, +1). */
  private sigma0 = 0;
  /** Signalisiert, dass u beim nächsten Schritt mit s != 0 auf ±forward springen muss. */
  private needsDirectionJump = false;

  getSpeed(): number {
    return this.s;
  }

  getDirection(): Vec3 {
    return { ...this.u };
  }

  reset(): void {
    this.s = 0;
    this.sigma0 = 0;
    this.needsDirectionJump = true;
  }

  begin(): void {
    if (Math.abs(this.s) < EPSILON) {
      this.sigma0 = 0;
    } else {
      this.sigma0 = Math.sign(this.s);
    }
  }

  end(): void {
    this.sigma0 = 0;
  }

  pinch(lambda: number): void {
    if (!Number.isFinite(lambda) || lambda === 0) return;

    // Aus der Ruhe bestimmt das erste λ das Vorzeichen
    if (this.sigma0 === 0) {
      if (Math.abs(this.s) >= EPSILON) {
        this.sigma0 = Math.sign(this.s);
      } else {
        this.sigma0 = Math.sign(lambda);
      }
    }

    const wasZero = Math.abs(this.s) < EPSILON;

    if (this.sigma0 > 0) {
      // Vorwärtsfahrt
      if (lambda > 0) {
        this.s += FEEL.glideGain * lambda;
      } else {
        this.s += FEEL.glideBrake * lambda;
        if (this.s < 0) this.s = 0; // Bremsraste
      }
      this.s = Math.min(this.s, FEEL.glideMax);
    } else if (this.sigma0 < 0) {
      // Rückwärtsfahrt (s < 0)
      if (lambda < 0) {
        this.s += FEEL.glideGain * lambda; // λ < 0 => s wird negativer
      } else {
        this.s += FEEL.glideBrake * lambda; // λ > 0 => s wird positiver
        if (this.s > 0) this.s = 0; // Bremsraste
      }
      this.s = Math.max(this.s, -FEEL.glideMaxBack);
    }

    if (wasZero && Math.abs(this.s) >= EPSILON) {
      this.needsDirectionJump = true;
    }
  }

  step(
    dt: number,
    basis: { forward: Vec3; right: Vec3; up: Vec3 },
    base: NavInput,
  ): NavInput {
    if (FEEL.glide < 0.5) {
      this.reset();
      return base;
    }

    // Wenn der Schubregler aktiv benutzt wird, gewinnt der Regler
    if (Math.abs(base.forward) > 1e-4) {
      this.reset();
      return base;
    }

    if (dt > 0 && Math.abs(this.s) > 0) {
      // Gleiten: Abklingen über dt
      this.s *= Math.exp((-dt * Math.LN2) / FEEL.glideHalfLife);
      if (Math.abs(this.s) < EPSILON) {
        this.s = 0;
      }
    }

    if (Math.abs(this.s) < EPSILON) {
      this.s = 0;
      return { forward: 0, right: 0, up: 0, speedScale: 1, assist: true, brake: false };
    }

    const targetDir = scale(basis.forward, Math.sign(this.s));

    if (this.needsDirectionJump || length(this.u) < 0.5) {
      this.u = targetDir;
      this.needsDirectionJump = false;
    } else if (dt > 0) {
      const tau = FEEL.glideCoupleTau;
      const factor = 1 - Math.exp(-dt / tau);
      this.u = slerpDir(this.u, targetDir, factor);
    }

    const speedScale = Math.abs(this.s) / DEFAULT_FLIGHT.rate;

    return {
      forward: dot(this.u, basis.forward),
      right: dot(this.u, basis.right),
      up: dot(this.u, basis.up),
      speedScale,
      assist: true,
      brake: false,
    };
  }
}
