import type { Vec3 } from '../nav/vec';

/**
 * Ein Knoten im Bezugsrahmen-Baum (Leitfaden §3.1, §7 Stufe 2a).
 *
 * Jeder Frame hat einen eigenen lokalen Ursprung. `position` ist die Lage
 * dieses Ursprungs im Koordinatensystem des Eltern-Frames (`parent`).
 * Wurzel-Frames (z. B. Universum) haben `parent === null` und `position === ZERO`.
 *
 * Alle Achsen sind fest nach Ekliptik J2000 ausgerichtet (keine Rotation in Stufe 2a).
 */
export interface FrameNode {
  readonly id: string;
  readonly name: string;
  parent: FrameNode | null;
  readonly children: FrameNode[];
  /** Position des Frame-Ursprungs im Koordinatensystem des Eltern-Frames (Meter). */
  position: Vec3;
}
