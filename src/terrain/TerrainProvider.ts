import type * as THREE from 'three/webgpu';
import { TerrainField, assembleTile } from './tileGeometry';
import type { TerrainSpec, TileSpec, TileBuffers } from './tileGeometry';
import { GpuTerrain } from './gpuTerrain';

/**
 * Zentrale Kachel-Fabrik für alle Planeten.
 *
 * Die Quadtree-Logik bleibt unverändert synchron und deterministisch — nur die
 * *Erzeugung* der Vertexpuffer ist asynchron geworden. Das ist die eigentliche
 * Ursache des Ruckelns: ein Kachel-Build kostete bisher mehrere Millisekunden
 * im Main-Thread, mitten im Frame.
 *
 * Backends:
 *   'worker' — Pool aus Web Workern (Standard). Parallel, transferable Puffer,
 *              funktioniert auch im WebGL2-Fallback (z. B. iPad-Safari).
 *   'gpu'    — WGSL-Compute via TSL; Höhen + Normalen von der GPU, Positionen
 *              weiterhin in f64 auf dem Main-Thread.
 *   'sync'   — Notfallpfad ohne Worker (nur wenn `Worker` fehlt oder der Pool
 *              sich als unzuverlässig erwiesen hat).
 *
 * Priorisierung: Jobs tragen die Kameradistanz ihrer Kachel; abgearbeitet wird
 * immer die nächstgelegene. Die Distanz wird jeden Frame nachgeführt
 * (`reprioritize`) — ohne das behielt ein Job die Entfernung, die er beim
 * *Anfordern* hatte, und nach einem Anflug über zehn Größenordnungen stand die
 * Warteschlange in der Reihenfolge des alten Standorts.
 *
 * **Ausfallsicherheit (neu in v0.4).** Ein vergebener Job, der nie zurückkommt,
 * belegte seinen Worker-Platz für immer: die Auslastung wurde ausschließlich in
 * `onmessage` verringert. Stirbt ein Worker (Speicherdruck auf dem Tablet,
 * Ausnahme im Worker-Skript), verstummt er einfach — nach `JOBS_PER_WORKER`
 * solchen Fällen ist der Pool dicht und **es entsteht nie wieder eine Kachel**.
 * Bereits gebaute Körper bleiben sichtbar, ein frisch instanziierter Planet
 * dagegen bleibt komplett unsichtbar, bis die Seite neu geladen wird — genau das
 * Fehlerbild "nach dem Goto war das Ziel weg, Neustart half".
 * Dagegen: Fehler-Handler, Wachhund und harter Fallback auf 'sync'.
 */

export type TerrainBackend = 'worker' | 'gpu' | 'sync';
export type TerrainBackendChoice = TerrainBackend | 'auto';

export type TileCallback = (buffers: TileBuffers | null) => void;

interface Job {
  id: number;
  field: TerrainField;
  spec: TerrainSpec;
  tile: TileSpec;
  priority: number;      // Kameradistanz in m — kleiner = wichtiger
  callback: TileCallback;
  attempts: number;
}

/** Ein vergebener Job samt Buchhaltung für die Platzfreigabe. */
interface Flight {
  job: Job;
  worker: Worker | null;
  since: number;    // performance.now() beim Absenden
  pumpAt: number;   // Pump-Zähler beim Absenden
  abandoned: boolean;
}

const MAX_QUEUE = 96;
const JOBS_PER_WORKER = 2;
const GPU_IN_FLIGHT = 2;
const SYNC_PER_FRAME = 2;

/** Ein Kachel-Build dauert ~1 ms. Alles jenseits davon ist kein "langsam", sondern "weg". */
const JOB_TIMEOUT_MS = 5000;
/** Zusätzlich zur Wanduhr: verhindert Fehlalarme, wenn der Tab pausiert war. */
const JOB_TIMEOUT_PUMPS = 60;
/** So viele verlorene Jobs, dann gilt der Pool als unbrauchbar. */
const MAX_LOST_JOBS = 6;

export class TerrainProvider {
  backend: TerrainBackend = 'sync';
  built = 0;
  /** Nie zurückgekehrte Jobs. Sichtbar im HUD — ein Wert > 0 ist ein Hardwarehinweis. */
  lost = 0;

  // Wachhund-Parameter als Felder statt Konstanten: so kann der Offline-Test das
  // Zeitfenster verkürzen und den Ausfall eines Workers in Millisekunden nachstellen.
  jobTimeoutMs = JOB_TIMEOUT_MS;
  jobTimeoutPumps = JOB_TIMEOUT_PUMPS;
  maxLostJobs = MAX_LOST_JOBS;

  private queue: Job[] = [];
  private readonly inflight = new Map<number, Flight>();
  private nextId = 1;
  private pumps = 0;

  private workers: Worker[] = [];
  private readonly load = new Map<Worker, number>();

  private gpu: GpuTerrain | null = null;
  private gpuBusy = 0;
  private gpuFailures = 0;

  get workerCount(): number {
    return this.workers.length;
  }

  get pending(): number {
    return this.queue.length + this.inflight.size;
  }

  async configure(options: {
    renderer?: THREE.WebGPURenderer;
    backend?: TerrainBackendChoice;
    probe?: { field: TerrainField; tile: TileSpec };
    /** Nur für Tests: erlaubt einen künstlichen Worker (auch einen, der nie antwortet). */
    createWorker?: () => Worker;
  }): Promise<void> {
    // 'auto' wählt bewusst den Worker-Pfad: er ist parallel, läuft auch ohne
    // WebGPU und hat bei 19×19-Kacheln keine Readback-Latenz. Der GPU-Pfad
    // wird per ?terrain=gpu angefordert und spielt seine Stärke bei höheren
    // Kachelauflösungen aus (siehe README).
    const wanted = options.backend ?? 'auto';

    if (wanted === 'gpu' && options.renderer && options.probe) {
      const reference = referenceData(options.probe.field, options.probe.tile);
      this.gpu = await GpuTerrain.create(options.renderer, {
        field: options.probe.field,
        tile: options.probe.tile,
        reference,
      });
      if (this.gpu) {
        this.backend = 'gpu';
        return;
      }
      console.warn('[Terrain] GPU-Pfad nicht nutzbar — Fallback auf Worker.');
    }

    const factory = options.createWorker
      ?? (typeof Worker !== 'undefined'
        ? () => new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' })
        : null);

    if (wanted !== 'sync' && factory) {
      try {
        const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4;
        const count = Math.max(2, Math.min(4, (cores || 4) - 1));
        for (let i = 0; i < count; i++) {
          const worker = factory();
          worker.onmessage = (e) => this.onWorkerMessage(worker, e);
          worker.onerror = (e) => this.onWorkerError(worker, e);
          worker.onmessageerror = (e) => this.onWorkerError(worker, e);
          this.workers.push(worker);
          this.load.set(worker, 0);
        }
        this.backend = 'worker';
        return;
      } catch (e) {
        console.warn('[Terrain] Worker nicht verfügbar — synchroner Notfallpfad.', e);
        this.workers = [];
      }
    }

    this.backend = 'sync';
  }

  request(
    field: TerrainField,
    spec: TerrainSpec,
    tile: TileSpec,
    priority: number,
    callback: TileCallback,
  ): number {
    const id = this.nextId++;
    this.queue.push({ id, field, spec, tile, priority, callback, attempts: 0 });
    return id;
  }

  /**
   * Priorität eines noch wartenden Jobs nachführen. Der Quadtree kennt die aktuelle
   * Kameradistanz jeder Kachel ohnehin jeden Frame — ohne diese Rückmeldung sortiert
   * die Warteschlange nach einem veralteten Standort und verwirft beim Überlauf
   * ausgerechnet die Kacheln, vor denen die Kamera gerade steht.
   */
  reprioritize(id: number, priority: number): void {
    for (const job of this.queue) {
      if (job.id === id) {
        job.priority = priority;
        return;
      }
    }
  }

  cancel(id: number): void {
    const qi = this.queue.findIndex((j) => j.id === id);
    if (qi >= 0) {
      this.queue.splice(qi, 1);
      return;
    }
    // Bereits vergeben: Eintrag bleibt für die Platzbuchhaltung bestehen,
    // das Ergebnis wird beim Eintreffen verworfen.
    const flight = this.inflight.get(id);
    if (flight) flight.abandoned = true;
  }

  /** Einmal pro Frame von der Engine aufgerufen: verteilt Jobs nach Priorität. */
  pump(): void {
    this.pumps++;
    this.collectLostJobs();
    if (this.queue.length === 0) return;

    this.queue.sort((a, b) => a.priority - b.priority);

    if (this.queue.length > MAX_QUEUE) {
      for (const dropped of this.queue.splice(MAX_QUEUE)) dropped.callback(null);
    }

    switch (this.backend) {
      case 'worker': this.pumpWorkers(); break;
      case 'gpu': this.pumpGpu(); break;
      default: this.pumpSync(); break;
    }
  }

  // ------------------------------------------------------------ Wachhund

  /**
   * Vergebene, nie beantwortete Jobs einsammeln: Platz freigeben und einmal
   * erneut versuchen. Zwei Bedingungen gleichzeitig (Wanduhr *und* Frame-Zähler),
   * damit ein pausierter Tab nicht die halbe Warteschlange für verloren erklärt.
   */
  private collectLostJobs(): void {
    if (this.inflight.size === 0) return;
    const now = nowMs();

    for (const [id, flight] of this.inflight) {
      if (now - flight.since < this.jobTimeoutMs) continue;
      if (this.pumps - flight.pumpAt < this.jobTimeoutPumps) continue;

      this.inflight.delete(id);
      this.releaseSlot(flight);
      this.lost++;
      if (!flight.abandoned) this.retry(flight.job);
    }

    if (this.lost >= this.maxLostJobs && this.backend === 'worker') {
      console.warn(
        `[Terrain] ${this.lost} Kachel-Jobs ohne Antwort — Worker-Pool gilt als unzuverlässig. ` +
        'Dauerhafter Wechsel auf den synchronen Pfad (ruckelt, aber liefert).',
      );
      this.switchToSync();
    }
  }

  /** Ein Wiederholungsversuch; danach wird der Kachel abgesagt, sie fordert selbst neu an. */
  private retry(job: Job): void {
    if (job.attempts >= 1) {
      job.callback(null);
      return;
    }
    job.attempts++;
    this.queue.push(job);
  }

  private releaseSlot(flight: Flight): void {
    if (flight.worker) {
      this.load.set(flight.worker, Math.max(0, (this.load.get(flight.worker) ?? 1) - 1));
    } else if (this.backend === 'gpu') {
      this.gpuBusy = Math.max(0, this.gpuBusy - 1);
    }
  }

  private switchToSync(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.load.clear();
    // Laufende Flüge sind mit dem Pool gestorben — zurück in die Warteschlange.
    for (const [id, flight] of this.inflight) {
      this.inflight.delete(id);
      if (!flight.abandoned) this.queue.push(flight.job);
    }
    this.backend = 'sync';
  }

  // --------------------------------------------------------------- Worker

  private pumpWorkers(): void {
    let guard = this.workers.length * JOBS_PER_WORKER;
    while (guard-- > 0 && this.queue.length > 0) {
      const worker = this.leastLoadedWorker();
      if (!worker || (this.load.get(worker) ?? 0) >= JOBS_PER_WORKER) break;

      const job = this.queue.shift()!;
      this.inflight.set(job.id, {
        job, worker, since: nowMs(), pumpAt: this.pumps, abandoned: false,
      });
      this.load.set(worker, (this.load.get(worker) ?? 0) + 1);
      worker.postMessage({ jobId: job.id, spec: job.spec, tile: job.tile });
    }
  }

  private leastLoadedWorker(): Worker | null {
    let best: Worker | null = null;
    let bestLoad = Infinity;
    for (const w of this.workers) {
      const l = this.load.get(w) ?? 0;
      if (l < bestLoad) { bestLoad = l; best = w; }
    }
    return best;
  }

  private onWorkerMessage(worker: Worker, event: MessageEvent): void {
    const { jobId, positions, normals, colors, boundingRadius, error } = event.data ?? {};
    this.load.set(worker, Math.max(0, (this.load.get(worker) ?? 1) - 1));

    const flight = this.inflight.get(jobId);
    if (!flight) return; // zwischenzeitlich abgebrochen (Kachel gemerged/entsorgt)
    this.inflight.delete(jobId);
    if (flight.abandoned) return;

    if (error || !positions) {
      // Der Worker lebt, diese eine Kachel ist gescheitert: absagen statt schweigen.
      console.warn('[Terrain] Kachel konnte nicht gebaut werden', error);
      flight.job.callback(null);
      return;
    }

    this.built++;
    flight.job.callback({ positions, normals, colors, boundingRadius });
  }

  /**
   * Ein Worker hat sich verabschiedet. Ohne diesen Pfad blieben seine Plätze
   * dauerhaft belegt — der Pool verhungert schleichend, statt sichtbar zu scheitern.
   */
  private onWorkerError(worker: Worker, event: Event | ErrorEvent): void {
    console.error('[Terrain] Worker-Fehler', event);
    this.load.set(worker, 0);

    for (const [id, flight] of this.inflight) {
      if (flight.worker !== worker) continue;
      this.inflight.delete(id);
      this.lost++;
      if (!flight.abandoned) this.retry(flight.job);
    }

    if (this.lost >= this.maxLostJobs) this.switchToSync();
  }

  // ------------------------------------------------------------------ GPU

  private pumpGpu(): void {
    while (this.gpu && this.gpuBusy < GPU_IN_FLIGHT && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.inflight.set(job.id, {
        job, worker: null, since: nowMs(), pumpAt: this.pumps, abandoned: false,
      });
      this.gpuBusy++;

      this.gpu.computeTile(job.field, job.tile)
        .then((data) => {
          this.gpuBusy = Math.max(0, this.gpuBusy - 1);
          const flight = this.inflight.get(job.id);
          if (!flight || flight.abandoned) {
            this.inflight.delete(job.id);
            return;
          }
          this.inflight.delete(job.id);
          this.built++;
          // Positionen weiterhin in f64 auf dem Main-Thread (Präzision!)
          job.callback(assembleTile(job.field, job.tile, data));
        })
        .catch((e) => {
          this.gpuBusy = Math.max(0, this.gpuBusy - 1);
          this.inflight.delete(job.id);
          console.error('[Terrain] GPU-Dispatch fehlgeschlagen', e);
          job.callback(null);
          // Nach wiederholten Fehlern dauerhaft auf Worker umschalten,
          // statt jeden Frame erneut in denselben Fehler zu laufen.
          if (++this.gpuFailures > 8) {
            console.warn('[Terrain] GPU-Pfad instabil — dauerhafter Wechsel auf Worker.');
            this.gpu = null;
            void this.configure({ backend: 'worker' });
          }
        });
    }
  }

  // ----------------------------------------------------------------- Sync

  private pumpSync(): void {
    for (let i = 0; i < SYNC_PER_FRAME && this.queue.length > 0; i++) {
      const job = this.queue.shift()!;
      this.built++;
      job.callback(assembleTile(job.field, job.tile, null));
    }
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.load.clear();
    this.queue = [];
    this.inflight.clear();
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** CPU-Referenz (nx, ny, nz, raw) für den GPU-Selbsttest. */
function referenceData(field: TerrainField, tile: TileSpec): Float32Array {
  const buffers = assembleTile(field, tile, null);
  const count = buffers.normals.length / 3;
  const out = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    out[i * 4] = buffers.normals[i * 3];
    out[i * 4 + 1] = buffers.normals[i * 3 + 1];
    out[i * 4 + 2] = buffers.normals[i * 3 + 2];
    // Rohhöhe aus der Position zurückrechnen ist unnötig ungenau — direkt sampeln:
    const px = buffers.positions[i * 3] + tile.centerX;
    const py = buffers.positions[i * 3 + 1] + tile.centerY;
    const pz = buffers.positions[i * 3 + 2] + tile.centerZ;
    const l = Math.sqrt(px * px + py * py + pz * pz) || 1;
    out[i * 4 + 3] = field.rawHeight(px / l, py / l, pz / l);
  }
  return out;
}

let instance: TerrainProvider | null = null;

export function getTerrainProvider(): TerrainProvider {
  if (!instance) instance = new TerrainProvider();
  return instance;
}

export async function configureTerrainProvider(options: {
  renderer?: THREE.WebGPURenderer;
  backend?: TerrainBackendChoice;
  probe?: { field: TerrainField; tile: TileSpec };
}): Promise<TerrainBackend> {
  const provider = getTerrainProvider();
  await provider.configure(options);
  return provider.backend;
}

