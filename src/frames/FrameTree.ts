import type { Vec3 } from '../nav/vec';
import { add, copy, length, sub, vec3, ZERO } from '../nav/vec';
import type { FrameNode } from './types';

/**
 * Erstellt einen neuen Frame-Knoten.
 */
export function createFrame(id: string, name: string, position: Vec3 = ZERO, soiRadius = Infinity): FrameNode {
  return {
    id,
    name,
    parent: null,
    children: [],
    position: copy(position),
    soiRadius,
  };
}

/**
 * Berechnet den SOI-Radius (Sphere of Influence) nach Laplace: r_soi = a * (m / M)^(2/5)
 */
export function computeSoiRadius(a: number, mass: number, parentMass: number): number {
  if (parentMass <= 0 || mass <= 0 || a <= 0) return Infinity;
  return a * Math.pow(mass / parentMass, 0.4);
}

/**
 * Prüft und bestimmt den besten Frame für eine Position p (relativ zum aktuellen Frame currentFrame).
 * Verwendet Hysterese nach Option B (Leitfaden §9):
 * - Eintritt in Kind-Frame wenn Abstand r <= 1.0 * soiRadius
 * - Austritt aus currentFrame wenn Abstand r >= 1.15 * soiRadius
 */
export function updateActiveFrame(p: Vec3, currentFrame: FrameNode): { frame: FrameNode; position: Vec3 } {
  // 1. Prüfen ob wir tiefere Kind-Frames betreten
  for (const child of currentFrame.children) {
    const soi = child.soiRadius ?? Infinity;
    const dist = length(sub(p, child.position));
    if (dist <= soi) {
      // Eintritt in den Kind-Frame
      const newPos = transformPoint(p, currentFrame, child);
      // Rekursiv prüfen ob tiefere Enkel-Frames betreten werden
      return updateActiveFrame(newPos, child);
    }
  }

  // 2. Prüfen ob wir aus dem aktuellen Frame nach oben austreten müssen (Hysterese 1.15 * SOI)
  if (currentFrame.parent) {
    const soi = currentFrame.soiRadius ?? Infinity;
    const dist = length(p); // p ist bereits lokal in currentFrame (relativ zum Ursprung des currentFrame)
    if (dist >= 1.15 * soi) {
      // Austritt in den Eltern-Frame
      const newPos = transformPoint(p, currentFrame, currentFrame.parent);
      return updateActiveFrame(newPos, currentFrame.parent);
    }
  }

  return { frame: currentFrame, position: copy(p) };
}

/**
 * Hängt `child` an `parent` an (oder löst die Verbindung, wenn `parent === null`).
 */
export function attachFrame(child: FrameNode, parent: FrameNode | null): void {
  if (child.parent === parent) return;

  if (child.parent) {
    const idx = child.parent.children.indexOf(child);
    if (idx >= 0) child.parent.children.splice(idx, 1);
  }

  child.parent = parent;
  if (parent) {
    parent.children.push(child);
  }
}

/**
 * Findet den nächsten gemeinsamen Vorfahren (Lowest Common Ancestor, LCA) zweier Frames.
 * Gibt zusätzlich die Pfade von `a` und `b` hinauf zum LCA zurück.
 */
export function findLCA(a: FrameNode, b: FrameNode): {
  lca: FrameNode;
  pathToLCAFromA: FrameNode[];
  pathToLCAFromB: FrameNode[];
} {
  const ancestorsA = new Map<FrameNode, number>();
  const pathA: FrameNode[] = [];

  let currA: FrameNode | null = a;
  while (currA) {
    ancestorsA.set(currA, pathA.length);
    pathA.push(currA);
    currA = currA.parent;
  }

  const pathB: FrameNode[] = [];
  let currB: FrameNode | null = b;
  while (currB) {
    if (ancestorsA.has(currB)) {
      const lca = currB;
      const indexA = ancestorsA.get(lca)!;
      const pathToLCAFromA = pathA.slice(0, indexA + 1);
      pathB.push(currB);
      const pathToLCAFromB = pathB;
      return { lca, pathToLCAFromA, pathToLCAFromB };
    }
    pathB.push(currB);
    currB = currB.parent;
  }

  throw new Error(`Frames '${a.name}' (${a.id}) und '${b.name}' (${b.id}) sind nicht im selben Baum verbunden.`);
}

/**
 * Rechnet einen Punkt `p` vom Koordinatensystem des Frames `from` in den Frame `to` um.
 *
 * Die Summation verläuft über den nächsten gemeinsamen Vorfahren (LCA) und ist so
 * strukturiert, dass sich große Ursprungsbeträge der obersten Kindknoten zuerst
 * gegenseitig aufheben, bevor feine lokale Offsets hinzukommen (§4.7).
 */
export function transformPoint(p: Vec3, from: FrameNode, to: FrameNode): Vec3 {
  if (from === to) return copy(p);

  const { pathToLCAFromA, pathToLCAFromB } = findLCA(from, to);

  const m = pathToLCAFromA.length - 1; // Zahl der Schritte von from bis LCA
  const n = pathToLCAFromB.length - 1; // Zahl der Schritte von to bis LCA

  if (m === 0) {
    // `from` ist selbst der LCA (Vorfahr von `to`).
    // p_to = p_from - sum(pos(B_j) for j in 0..n-1)
    let offsetB = vec3(0, 0, 0);
    for (let j = 0; j < n; j++) {
      offsetB = add(offsetB, pathToLCAFromB[j].position);
    }
    return sub(p, offsetB);
  }

  if (n === 0) {
    // `to` ist selbst der LCA (Vorfahr von `from`).
    // p_to = p_from + sum(pos(A_i) for i in 0..m-1)
    let offsetA = vec3(0, 0, 0);
    for (let i = 0; i < m; i++) {
      offsetA = add(offsetA, pathToLCAFromA[i].position);
    }
    return add(p, offsetA);
  }

  // Beide Pfade steigen mindestens einen Schritt bis zum LCA auf.
  // pathToLCAFromA[m - 1] ist der höchste Knoten unter LCA auf der A-Seite.
  // pathToLCAFromB[n - 1] ist der höchste Knoten unter LCA auf der B-Seite.

  // Sub-Offsets auf der A-Seite (von 0 bis m-2):
  let offsetA = vec3(0, 0, 0);
  for (let i = 0; i < m - 1; i++) {
    offsetA = add(offsetA, pathToLCAFromA[i].position);
  }

  // Sub-Offsets auf der B-Seite (von 0 bis n-2):
  let offsetB = vec3(0, 0, 0);
  for (let j = 0; j < n - 1; j++) {
    offsetB = add(offsetB, pathToLCAFromB[j].position);
  }

  // Differenz der beiden höchsten Kindknoten unter dem LCA:
  // (pos(A_{m-1}) - pos(B_{n-1})) hebt große gemeinsame Komponenten direkt auf.
  const topDiff = sub(pathToLCAFromA[m - 1].position, pathToLCAFromB[n - 1].position);

  // Gesamt-Offset = offsetA + topDiff - offsetB
  const totalOffset = sub(add(offsetA, topDiff), offsetB);

  return add(p, totalOffset);
}

/**
 * Transformation der Kameraposition aus dem Kameraframe in den Frame eines Körpers.
 * Falls cameraFrame null ist (z.B. beim ersten Aufruf), wird defaultFrame verwendet.
 */
export function cameraInBodyFrame(
  cameraPos: Vec3,
  cameraFrame: FrameNode | null | undefined,
  bodyFrame: FrameNode | null | undefined,
  defaultFrame: FrameNode,
): Vec3 {
  const from = cameraFrame ?? defaultFrame;
  const to = bodyFrame ?? defaultFrame;
  return transformPoint(cameraPos, from, to);
}
