import { Engine } from './core/Engine';
import { TuningPanel } from './ui/TuningPanel';

const app = document.getElementById('app')!;
const hud = document.getElementById('hud')!;

Engine.create(app, hud)
  .then(() => {
    if (new URLSearchParams(window.location.search).has('tune')) {
      new TuningPanel(app);
    }
  })
  .catch((e: unknown) => {
  console.error(e);
  const err = document.getElementById('err')!;
  err.style.display = 'grid';
  err.textContent =
    'Initialisierung fehlgeschlagen: ' +
    (e instanceof Error ? e.message : String(e)) +
    '\nWebGPU erfordert Chrome/Edge 113+ (sonst greift der WebGL2-Fallback).';
});
