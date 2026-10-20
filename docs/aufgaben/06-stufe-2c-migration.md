---
id: 06
titel: Stufe 2c — Körper und Katalog in Frames migrieren
status: offen
braucht: [15, 22]
stufe: 2c
tablet: ja
---

> **Entwurf — wird vor dem Start neu geschnitten.** Ein erster Versuch (v0.5.0, mit Fix v0.5.1) ist in
> v0.4.16 zurückgenommen; Befund in Leitfaden §9. Er änderte sieben Dateien unter `src/`, ohne zu
> eskalieren, und lief offline grün, während auf dem Tablet alle Körper an einem Punkt standen.
> Nach Aufgabe 22 wird diese Aufgabe in Teilaufgaben mit je höchstens fünf Dateien zerlegt.

## Ziel

Leitfaden §12.4, Teilstufe 2c: *Migration: `CelestialBody`, `UniverseManager`, Katalog-Import.* Jedes
System bekommt einen eigenen Frame, Körperpositionen leben lokal darin. Danach ist Stufe 2 erfüllt.

## Fertig, wenn

Das Abnahmekriterium von Stufe 2 aus Leitfaden §7, wörtlich: *eine Sternposition in 100.000 Lj und
ein Fels auf der Erde im selben Programmlauf beide korrekt — nachweisbar über einen Offline-Test,
der Positionen über mehrere Frame-Wechsel hin- und zurückrechnet.* Zusätzlich:

- Der Fall aus `tools/test-orbit.ts` (dasselbe System 3 Lj vom Ursprung verliert ~0,16 m/s) zeigt
  keinen messbaren Verlust mehr. Der Test wird dafür umgestellt, nicht gelockert: alte Rechnung als
  Gegenprobe behalten.
- Version → 0.5.0, README „Neu in v0.5", Leitfaden §2 und §11 nachgeführt.

## Dateien

Werden im Plan festgelegt. Erwartbar: `CelestialBody.ts`, `UniverseManager.ts`, `SceneManager.ts`,
`test-orbit.ts`, ein neuer Test.

## Auf dem Tablet prüfen

Auf einem Planeten eines `PSC-*`-Sterns bis auf 2 m Höhe hinunterfliegen. Vor dieser Aufgabe ist dort
mit Zittern bzw. springendem Boden zu rechnen (bei ~10 Lj löst f64 nur ~16–32 m auf); danach muss der
Boden so ruhig stehen wie auf der Erde.

## Lehren aus dem ersten Versuch (verbindlich für den Neuschnitt)

- **Jede** Stelle, an der eine Körperposition auf eine Kameragröße trifft, rechnet über
  `src/frames/convert.ts` (Aufgabe 22) — auch die, die „nur" einen Abstand bilden:
  `SceneManager.syncToCamera` (Render-Position **und** die Kameraposition für `body.update`, also LOD und
  Sternglows), `UniverseManager.update` (Bevölkern), `EngineInput.collectBodies`/`bodyRef`,
  `SpaceCamera.focus`, `cameraPlacement` (Orbit, Kollision). Der PR listet jede dieser Stellen.
- **Die Kamera bekommt ihren Rahmen** beim Start und bei jedem `focus`/`enterOrbit` auf einen Körper.
  Der Selbsttest aus 22 (`RAHMEN FEHLT`) muss auf dem Tablet stumm bleiben, `[Frame: …]` muss sichtbar sein.
- **Geschwindigkeiten über Rahmen** nach dem Befund aus 22 behandeln, nicht auf 0 setzen.
- **Der Prüfstand `tools/test-frame-loop.ts`** bleibt grün und wird um die neu verdrahteten Stellen
  erweitert.
- Messlauf `?bench` vor und nach der Migration (Basiszeile aus 15), Ergebnis als PR-Kommentar.
