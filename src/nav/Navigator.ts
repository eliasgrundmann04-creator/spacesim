import type { Vec3 } from './vec';
import { add, copy, length, scale, sub, vec3 } from './vec';
import type { BodyRef, NavFrame, NavInput } from './types';
import { THRUST_EPSILON } from './types';
import type { FlightConfig } from './flightKernel';
import { DEFAULT_FLIGHT, stepFlight } from './flightKernel';
import type { GotoConfig, GotoPlan } from './gotoKernel';
import { DEFAULT_GOTO, advanceGoto, gotoFinished, gotoProgress, planGoto, sampleGoto, sampleGotoVelocity } from './gotoKernel';
import { evaluateProximity } from './proximity';
import type { AutoPaceState } from './autoPace';
import { createAutoPaceState, relaxStage } from './autoPace';
import { FEEL } from './feel';
import type { FrameCarryState } from './frameCarry';
import { applyFrameCarry, createFrameCarryState, trackFrameVelocity, updateCarry } from './frameCarry';

export type NavMode = 'free' | 'goto';

export interface NavigatorConfig {
  flight: FlightConfig;
  goto: GotoConfig;
  /** Kommandobetrag, ab dem ein laufender Goto abgebrochen wird. */
  cancelThreshold: number;
  /** Tiefpass-Zeitkonstante der geschätzten Rahmengeschwindigkeit. */
  frameVelocityTau: number;
}

export const DEFAULT_NAVIGATOR: NavigatorConfig = {
  flight: DEFAULT_FLIGHT,
  goto: DEFAULT_GOTO,
  cancelThreshold: THRUST_EPSILON,
  frameVelocityTau: 0.4,
};

export interface NavResult {
  position: Vec3;
  /** Weltgeschwindigkeit in m pro Realsekunde. */
  velocity: Vec3;
  /** Geschwindigkeit relativ zum Ankerkörper — die Zahl, die sich „richtig" anfühlt. */
  relVelocity: Vec3;
  mode: NavMode;
  anchor: BodyRef | null;
  /** Höhe über der Oberfläche des Ankers in m. */
  altitude: number;
  speed: number;
  relativeSpeed: number;
  /** Punkt, auf den die Kamera schauen soll — nur während eines Goto gesetzt. */
  lookAt: Vec3 | null;
  gotoTarget: BodyRef | null;
  gotoProgress: number;
}

/**
 * Hält den Flugzustand und schaltet zwischen freiem Flug und Goto-Übergang.
 * Kein three.js, kein DOM — der Adapter in `Engine.ts` füttert Kamerabasis und Körperliste
 * und schreibt das Ergebnis zurück (§5: Rechenkerne bleiben offline testbar).
 */
export class Navigator {
  readonly cfg: NavigatorConfig;

  /** Zustand ist die *ankerrelative* Geschwindigkeit (siehe flightKernel). */
  private relVelocity: Vec3 = vec3();
  private mode: NavMode = 'free';
  private plan: GotoPlan | null = null;
  private carryState: FrameCarryState = createFrameCarryState();
  private lastTargetPos: Vec3 | null = null;
  private lastReferenceSpeed = 0;

  constructor(cfg: Partial<NavigatorConfig> = {}) {
    this.cfg = { ...DEFAULT_NAVIGATOR, ...cfg };
  }

  getMode(): NavMode {
    return this.mode;
  }

  getRelativeVelocity(): Vec3 {
    return copy(this.relVelocity);
  }

  getFrameVelocity(): Vec3 {
    return copy(this.carryState.frameVelocity);
  }

  private paceState: AutoPaceState = createAutoPaceState();

  /**
   * Setzt die Relativgeschwindigkeit direkt — z. B. nachdem die Terrainkollision in
   * `SpaceCamera` die Position geklemmt hat und die radiale Komponente weg soll.
   */
  setRelativeVelocity(v: Vec3): void {
    this.relVelocity = copy(v);
  }

  /** Relativgeschwindigkeit zurücksetzen und Merkpunkt setzen beim Verlassen des Orbits. */
  resetMotion(anchor: BodyRef | null): void {
    this.relVelocity = vec3();
    this.carryState.lastAnchorId = anchor ? anchor.id : null;
    this.carryState.lastAnchorPos = anchor ? copy(anchor.position) : null;
    updateCarry(this.carryState, anchor);
  }

  /** Startet einen Übergang. `preferredDir` erlaubt z. B. einen Anflug von der Sonnenseite. */
  requestGoto(cameraPos: Vec3, target: BodyRef, preferredDir?: Vec3): void {
    this.plan = planGoto(cameraPos, target, this.cfg.goto, preferredDir);
    this.mode = 'goto';
    this.lastTargetPos = null;
  }

  cancelGoto(): void {
    this.plan = null;
    this.mode = 'free';
    this.lastTargetPos = null;
  }

  /**
   * Führt einen Navigationsschritt aus.
   * Seiteneffekt: Im freien Flug wird `input.speedScale` durch die Rückführung der Stufe
   * (`relaxStage`) direkt modifiziert, damit die Anzeige der Reglerstellung folgt.
   */
  update(frame: NavFrame, bodies: readonly BodyRef[], input: NavInput, dt: number): NavResult {
    const step = Math.max(dt, 0);
    const cmd = Math.hypot(input.forward, input.right, input.up);

    if (this.mode === 'goto' && this.plan) {
      const target = findBody(bodies, this.plan.targetId);
      if (!target) {
        this.cancelGoto(); // Ziel wurde entladen (lazy Universum)
      } else if (cmd > this.cfg.cancelThreshold || input.brake) {
        this.cancelGoto(); // Eingriff bricht ab — sofort, ohne Nachlauf
      } else {
        return this.updateGoto(target, bodies, step);
      }
    }

    return this.updateFree(frame, bodies, input, step);
  }

  // — freier Flug —————————————————————————————————————————————

  private updateFree(
    frame: NavFrame,
    bodies: readonly BodyRef[],
    input: NavInput,
    dt: number,
  ): NavResult {
    const carryRes = applyFrameCarry(frame.position, this.carryState, bodies);
    const startPos = carryRes.start;

    const pre = evaluateProximity(startPos, bodies, this.cfg.flight);
    this.relVelocity = trackFrameVelocity(
      this.carryState,
      pre.anchor,
      dt,
      this.cfg.frameVelocityTau,
      this.lastReferenceSpeed,
      this.relVelocity,
    );

    if (FEEL.autoPace >= 0.5) {
      input.speedScale = relaxStage(
        this.paceState,
        input.speedScale,
        pre.reference,
        FEEL.stageHalfDecades,
      );
    }

    if (input.brake) this.relVelocity = vec3();

    const frameVelForKernel = carryRes.carried ? vec3() : this.carryState.frameVelocity;

    const step = stepFlight(
      startPos,
      this.relVelocity,
      frame,
      input,
      bodies,
      frameVelForKernel,
      dt,
      this.cfg.flight,
    );
    this.relVelocity = step.relVelocity;
    this.lastReferenceSpeed = step.referenceSpeed;

    updateCarry(this.carryState, step.proximity.anchor);

    const worldVel = carryRes.carried
      ? add(step.relVelocity, this.carryState.frameVelocity)
      : step.worldVelocity;

    return {
      position: step.position,
      velocity: worldVel,
      relVelocity: copy(step.relVelocity),
      mode: 'free',
      anchor: step.proximity.anchor,
      altitude: step.proximity.altitude,
      speed: length(worldVel),
      relativeSpeed: step.relativeSpeed,
      lookAt: null,
      gotoTarget: null,
      gotoProgress: 1,
    };
  }

  // — Goto-Übergang ——————————————————————————————————————————

  private updateGoto(target: BodyRef, bodies: readonly BodyRef[], dt: number): NavResult {
    const plan = this.plan as GotoPlan;
    const before = plan.elapsed;
    advanceGoto(plan, dt);
    const used = plan.elapsed - before; // der letzte Schritt ist meist ein Teilschritt

    const position = sampleGoto(plan, target.position);
    const prox = evaluateProximity(position, bodies, this.cfg.flight);
    this.relVelocity = trackFrameVelocity(
      this.carryState,
      prox.anchor,
      dt,
      this.cfg.frameVelocityTau,
      this.lastReferenceSpeed,
      this.relVelocity,
    );

    // Übergabegeschwindigkeit: analytischer Anteil relativ zum Ziel plus die Eigenbewegung
    // des Ziels. Bei τ = 1 verschwindet der analytische Teil exakt (ṡ = 0), es bleibt genau
    // die Bahngeschwindigkeit — der Anschluss an den freien Flug ist damit ruckfrei.
    const approach = sampleGotoVelocity(plan);
    const targetVel = this.targetVelocity(target, used);
    const world = add(approach, targetVel);
    this.relVelocity = sub(world, this.carryState.frameVelocity);
    this.lastTargetPos = copy(target.position);

    updateCarry(this.carryState, prox.anchor);

    const done = gotoFinished(plan);
    const progress = gotoProgress(plan);
    if (done) {
      this.plan = null;
      this.mode = 'free';
      this.lastTargetPos = null;
    }

    return {
      position,
      velocity: world,
      relVelocity: copy(this.relVelocity),
      mode: done ? 'free' : 'goto',
      anchor: prox.anchor,
      altitude: prox.altitude,
      speed: length(world),
      relativeSpeed: length(this.relVelocity),
      lookAt: copy(target.position),
      gotoTarget: target,
      gotoProgress: progress,
    };
  }

  /** Eigenbewegung des Ziels in m pro Realsekunde — geliefert oder aus zwei Frames geschätzt. */
  private targetVelocity(target: BodyRef, dt: number): Vec3 {
    if (target.velocity) return copy(target.velocity);
    if (this.lastTargetPos && dt > 0) return scale(sub(target.position, this.lastTargetPos), 1 / dt);
    return vec3();
  }
}

function findBody(bodies: readonly BodyRef[], id: string): BodyRef | null {
  for (const b of bodies) if (b.id === id) return b;
  return null;
}
