// Minimaler Stub für 'three/tsl'. `gpuTerrain.ts` benutzt diese Symbole
// ausschließlich innerhalb von Funktionen; für den Offline-Test muss der Import
// nur auflösbar sein. Der GPU-Pfad selbst ist offline nicht prüfbar (§8) und
// validiert sich zur Laufzeit gegen die CPU-Referenz.
const unavailable = (name) => () => {
  throw new Error(`three/tsl:${name} ist im Offline-Test nicht verfügbar`);
};
export const storage = unavailable('storage');
export const wgslFn = unavailable('wgslFn');
export const uniform = unavailable('uniform');
export const texture = unavailable('texture');
export const instanceIndex = null;
