---
id: 14
titel: Nebenspur B1 — Messpunkte im HUD
status: offen
braucht: [13]
stufe: B (Performance & Tablet)
tablet: ja
---

## Ziel

Leitfaden §7, Nebenspur B: *Frustum-Culling für Kacheln, Instancing, Speicherbudget mit Verdrängung,
Messpunkte im HUD. Nach jeder Kernstufe kurz prüfen, nicht am Ende sammeln.*

Diese Aufgabe kommt zuerst: Ohne Messpunkte lässt sich keine der anderen Maßnahmen bewerten. Heute zeigt
das HUD nur geglättete fps (EMA über ~20 Frames). Ein Ruckler von 80 ms verschwindet darin, und es ist
nicht zu sehen, *wo* die Zeit bleibt — Universum, Navigation, Szenen-Sync samt LOD, Kachel-Pumpe oder
Rendern.

Nach dieser Aufgabe zeigt das HUD Bildzeit-Perzentile über ein festes **Zeitfenster**, die CPU-Zeit
des Frames, Draw-Calls, Dreiecke und lebende Geometrien; mit `?perf` zusätzlich die Aufteilung auf
die Phasen des Frame-Loops.

## Fertig, wenn

Offline-Test `tools/test-perf.ts` (neu, in `npm test` eingehängt) zeigt mit Zahlenwert:

1. **Perzentile stimmen.** Für eine vorgegebene Folge von Bildzeiten stimmen p50, p95 und Maximum mit
   einer sortierten Referenz überein (exakt, gleiche Perzentil-Definition im Test dokumentiert).
2. **Zeitfenster, nicht Frame-Fenster.** Bei 20, 60 und 120 fps umfasst das Fenster jeweils 5 s
   (± ein Frame). Eine einzelne Spitze von 100 ms erscheint bei jeder Framerate als Maximum und als
   genau ein Ruckler und ist 5 s später bei jeder Framerate aus dem Fenster verschwunden.
3. **Ruckler.** Ein Frame zählt als Ruckler, wenn er länger als das Doppelte des Medians im Fenster
   dauert. Gleichmäßige 60 fps ⇒ 0 Ruckler, auch mit ±10 % Zittern.
4. **Phasen.** Die Phasenzeiten addieren sich zur gemessenen CPU-Zeit des Frames (bis auf die Zeit
   zwischen den Marken, < 1 %); eine Phase, die in einem Frame fehlt, zählt dort als 0, nicht als
   alter Wert.
5. **Kosten.** 10⁵ Einträge aufnehmen und 1000-mal zusammenfassen: im Mittel < 2 µs pro Eintrag und
   < 0,2 ms pro Zusammenfassung (Zahl im PR). Der Puffer wird einmal angelegt und wächst nicht.
6. `src/perf/` steht in `THREE_FREE`, `npm run check` grün, `Engine.ts` ≤ 300 Zeilen.

## Verhalten

- **Messkern `src/perf/frameStats.ts`** (neu, three-frei): Ringpuffer mit fester Kapazität (5 s bei
  240 fps), Einträge mit Zeitstempel, Bildintervall, CPU-Zeit und Phasenzeiten. Fenster nach *Zeit*,
  nicht nach Anzahl. Zusammenfassung: p50/p95/max des Bildintervalls, p95 der CPU-Zeit, Ruckler im
  Fenster, Mittel je Phase.
- **Marken im Frame-Loop** (`Engine.frame`): je eine Zeile `performance.now()` an den Grenzen der
  sieben nummerierten Schritte. Die Reihenfolge der Schritte bleibt unverändert.
- **Renderer-Zähler:** Draw-Calls, Dreiecke und Geometrien aus `renderer.info` *nach* `render()` lesen.
  Wann `info` zurückgesetzt wird (`autoReset`), steht in `node_modules/three/src/renderers/common/Info.js`
  — dort nachsehen, nicht raten.
- **HUD** (`EngineHud`): neue vierte Zeile, z. B.
  `CPU 4,2 ms (p95 7,9)   Bild p50 16,7 / p95 18,1 / max 41 ms   Ruckler 2   Draw 812   Tri 410k   Geo 930`.
  Mit `?perf` eine fünfte: `Univ 0,3 · Orient 0,1 · Nav 0,2 · Platz 0,1 · Sync 2,1 · Pumpe 0,4 · Render 1,8 ms`.
- **HUD-Takt:** Der HUD-Text wird höchstens 10-mal pro Sekunde neu gesetzt (nach Zeit, nicht jeden
  n-ten Frame). Ein `textContent` pro Frame kostet auf dem Tablet selbst messbar Zeit. Die
  Zusammenfassung wird nur in diesem Takt berechnet, die Aufnahme läuft jeden Frame.

## Dateien

- `src/perf/frameStats.ts` — neu, three-frei: Ringpuffer, Fenster, Perzentile, Phasen
- `tools/test-perf.ts` — neu
- `src/core/Engine.ts` — Marken im Frame-Loop, `renderer.info` lesen, an den HUD übergeben
- `src/core/EngineHud.ts` — Zeilen 4 und 5, HUD-Takt
- `tools/contracts.mjs` — nur `THREE_FREE` um `'src/perf/'` ergänzen
- `package.json` — Skript `test:perf`, in `test` einhängen; Version: nächste Patch-Nummer

## Hinweise

- `src/perf/` ist der Ort für alle three-freien Kerne der Nebenspur B (Messung, Sichtbarkeit, Budgets).
  Die folgenden B-Aufgaben legen ihre Kerne dort ab und müssen `tools/contracts.mjs` nicht mehr anfassen.
- Die geglättete Bildzeit `smoothedFrameMs` speist weiterhin die adaptive Renderauflösung. Nicht
  umbauen — das ist eine eigene Regelung; die neuen Zahlen sind nur Anzeige.
- `clock.tick()` begrenzt `dt` auf 0,1 s. Für die Messung das *ungekappte* Intervall verwenden (eigene
  Zeitstempel), sonst sieht das HUD nie einen Ruckler über 100 ms.
- Die CPU-Zeit von `render()` ist bei WebGPU nur die Zeit zum Abschicken, nicht die GPU-Zeit. So im HUD
  beschriften (z. B. „Render (CPU)") — keine GPU-Zeit behaupten.
- `Engine.ts` hat 266 Zeilen. Sieben Marken plus Übergabe passen; wird es eng, die Marken über ein
  kleines Hilfsobjekt aus `frameStats.ts` setzen (`stats.mark('sync')`), nicht neue Logik in `Engine.ts`.

## Nicht-Ziele

GPU-Zeitstempel (`trackTimestamp` — auf iPad-Safari nicht verfügbar; später, mit Selbsttest),
JS-Heap-Anzeige (`performance.memory` gibt es nur in Chromium), Änderungen an der adaptiven
Auflösung, jede Optimierung.

## Auf dem Tablet prüfen

1. Vorschau öffnen. Das HUD hat eine vierte Zeile mit CPU, Bild-Perzentilen, Ruckler, Draw, Tri, Geo.
   *Fehlerbild:* `NaN`, `0` bei Draw/Tri trotz sichtbarer Erde, oder die Zeile fehlt.
2. Erde im Orbit, ruhig: Bild p50 nahe 16,7 ms (bzw. 8,3 ms bei 120 Hz), Ruckler 0 oder sehr selten.
3. Schnell drehen und zoomen, bis Kacheln nachladen: Draw und Geo ändern sich, p95/max steigen
   sichtbar; 5 s nach dem Loslassen fallen sie zurück.
4. App kurz in den Hintergrund und zurück: max zeigt einen großen Wert, der nach 5 s verschwindet.
5. `?perf` an die Adresse hängen: fünfte Zeile mit sieben Phasen; ihre Summe liegt nahe dem CPU-Wert.
6. Die Anzeige springt nicht flackernd — sie aktualisiert sich ruhig, etwa zehnmal pro Sekunde.

## Abschluss

- Leitfaden §2: Messpunkte im HUD unter „Vorhanden" ergänzen; Testzahl nachführen.
- Leitfaden §11: neue Zeile mit der Version.
