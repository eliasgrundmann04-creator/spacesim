/// <reference lib="webworker" />
import { TerrainField, assembleTile } from './tileGeometry';
import type { TerrainSpec, TileSpec } from './tileGeometry';

/**
 * Terrain-Worker: baut die Vertexpuffer einer Kachel komplett off-thread.
 * Ergebnis geht als Transferable zurück (Zero-Copy) — der Main-Thread
 * erzeugt daraus nur noch die BufferGeometry.
 */

interface JobMessage {
  jobId: number;
  spec: TerrainSpec;
  tile: TileSpec;
}

// Felder pro Planet cachen: die 512er-Permutationstabelle soll nicht pro Kachel entstehen.
const fields = new Map<string, TerrainField>();

function fieldFor(spec: TerrainSpec): TerrainField {
  const t = spec.terrain;
  const key = `${spec.seed}|${spec.radius}|${t.amplitude}|${t.frequency}|${t.octaves}|${t.ocean}|${t.oceanLevel}|${t.palette}`;
  let field = fields.get(key);
  if (!field) {
    field = new TerrainField(spec);
    fields.set(key, field);
  }
  return field;
}

self.onmessage = (event: MessageEvent<JobMessage>) => {
  const { jobId, spec, tile } = event.data;

  // Immer antworten — auch im Fehlerfall. Eine unbeantwortete Nachricht belegte
  // im Provider dauerhaft einen Worker-Platz; nach wenigen davon entsteht keine
  // Kachel mehr, und ein frisch instanziierter Planet bleibt unsichtbar.
  try {
    const buffers = assembleTile(fieldFor(spec), tile, null);
    (self as unknown as Worker).postMessage(
      {
        jobId,
        positions: buffers.positions,
        normals: buffers.normals,
        colors: buffers.colors,
        boundingRadius: buffers.boundingRadius,
      },
      [buffers.positions.buffer, buffers.normals.buffer, buffers.colors.buffer],
    );
  } catch (e) {
    (self as unknown as Worker).postMessage({ jobId, error: String(e) });
  }
};
