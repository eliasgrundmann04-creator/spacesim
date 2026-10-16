import { J2000_UNIX_MS } from './constants';

/**
 * Simulationsuhr. simTime = Sekunden seit J2000.0 — dieselbe Zeitachse,
 * auf der die Katalog-Bahnelemente definiert sind. Startet auf "jetzt",
 * sodass die Planeten des Sonnensystems näherungsweise real stehen.
 */
export class SimClock {
  simTime = (Date.now() - J2000_UNIX_MS) / 1000;
  timeWarp = 1;
  paused = false;

  private last = performance.now();

  /** Liefert reales Frame-dt (s) und schiebt die Sim-Zeit um dt × warp weiter. */
  tick(): number {
    const now = performance.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    dt = Math.min(dt, 0.1); // Tab-Wechsel etc. nicht als Riesensprung werten
    if (!this.paused) this.simTime += dt * this.timeWarp;
    return dt;
  }

  faster(): void { this.timeWarp = Math.min(this.timeWarp * 5, 2.44e8); } // bis ~×5^12
  slower(): void { this.timeWarp = Math.max(this.timeWarp / 5, 1); }
  resetWarp(): void { this.timeWarp = 1; }
  togglePause(): void { this.paused = !this.paused; }

  get date(): Date {
    return new Date(J2000_UNIX_MS + this.simTime * 1000);
  }
}
