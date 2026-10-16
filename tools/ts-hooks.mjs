// Auflösungs-Hook: erlaubt extensionslose Relativ-Imports (Vite-Konvention) auch in Node.
// Zusammen mit dem eingebauten Type-Stripping von Node ≥22.6 laufen die .ts-Rechenkerne
// damit ohne Buildschritt und ohne node_modules — genau das, was §8 verlangt.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Für Tests, die Kepler oder CelestialBody anfassen: three wird durch einen
// Stub ersetzt. Der Renderpfad ist offline ohnehin nicht prüfbar (§8) — die
// Bahnmechanik dahinter aber sehr wohl.
const STUBS = new Map([
  ['three/webgpu', './stubs/three-webgpu.mjs'],
  ['three/tsl', './stubs/three-tsl.mjs'],
]);

export async function resolve(specifier, context, next) {
  const stub = STUBS.get(specifier);
  if (stub) return next(new URL(stub, import.meta.url).href, context);

  if (specifier.startsWith('.') && !/\.[a-z0-9]+$/i.test(specifier)) {
    for (const ext of ['.ts', '.mjs', '.js']) {
      const url = new URL(specifier + ext, context.parentURL);
      if (existsSync(fileURLToPath(url))) return next(url.href, context);
    }
  }
  return next(specifier, context);
}
