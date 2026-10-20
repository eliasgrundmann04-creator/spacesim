---
id: 23
titel: Kacheln grob vor fein — nach einem Sprung schärft sich der Boden stufenweise
status: offen
braucht: [15]
stufe: B (Performance & Tablet)
tablet: ja
---

## Ziel

Befund aus dem Messlauf (Leitfaden §9, „Kachel-Warteschlange verhungert"): Springt die Kamera an
die Oberfläche (Halt 3 von `?bench`, aber genauso nach einem schnellen Goto), zeigt die Erde
**sekundenlang eine einzige grobe Fläche** und dann auf einen Schlag volle Auflösung. Auf dem Tablet
dauert das 5,4 s. Die grobe Fläche liegt wegen des Sehnendurchhangs bis zu ~3 km unter dem echten
Boden. Deshalb wirkte Halt 3 nicht wie 2 m. Liegt die Kamera in einer Senke, steckt sie sogar in
der Fläche: Blick durch die Kruste, Kachelkanten als Gitter, Sterne dahinter (v0.4.18).

Ursache: `QuadtreeTile.update` teilt eine Kachel, sobald die Distanz es verlangt, auch wenn ihre
eigene Geometrie noch fehlt. Nach einem Sprung hängen so alle Stufen 0–14 auf einmal in der
Warteschlange (2.638 Kacheln), sortiert nur nach Distanz. Eine Elternkachel schaltet aber erst auf
ihre Kinder um, wenn **alle vier** fertig sind, und die groben Geschwister liegen am weitesten weg.
Sie kommen zuletzt dran, auf langsamen Geräten fallen sie aus der vollen Warteschlange (96 Plätze)
und werden immer neu angefordert.

Nach dieser Aufgabe wird der Boden nach einem Sprung Stufe für Stufe schärfer, und die volle
Auflösung ist früher da als heute. Im normalen Flug ändert sich nichts Messbares.

## Fertig, wenn

Offline-Test `tools/test-lod.ts` (neu, in `npm test` eingehängt). Er fährt den Quadtree-Kern mit dem
**echten** `TerrainProvider` und künstlichen Workern (Muster: `tools/test-throughput.ts`); jeder
Worker antwortet einen Frame später. Kamera über dem Landpunkt von Halt 3 (`BENCH_LAND_DIR`), zuerst
eingeschwungen im Orbit 3 R. Gemessen wird die **sichtbare Stufe unter der Kamera**: die Stufe der
gezeichneten Kachel, die den Kamerafußpunkt enthält. Jede Zeile läuft mit neuer Regel und zur
Gegenprobe mit der alten Regel (`?lod=alt`, siehe Verhalten) im selben Lauf:

1. **Sprung 3 R → 2 m, 8 Kacheln pro Frame** (Tablet: 4 Worker × 2 Plätze). Stufe ≥ 8 nach höchstens
   50 % der Frames, die die alte Regel bis Stufe 14 braucht; Stufe 14 nach höchstens 75 %.
   *(Prototyp: alt 291 Frames auf Stufe 2, dann alles auf einmal; neu Stufe 4/8/12/14 nach
   46/125/156/173 Frames.)*
2. **Derselbe Sprung, 2 Kacheln pro Frame** (langsames Gerät, Warteschlange läuft über). Stufe ≥ 4
   nach höchstens 25 % der alten Frames bis Stufe 14; Stufe 14 nach höchstens 70 %.
   *(Prototyp: alt 1099; neu Stufe 4 nach 151, Stufe 14 nach 653.)*
3. **Kein Rückschritt im Flug.** Anflug 1000 km → 2 m in 30 s (Höhe log-linear) bei 20, 60 und 120 fps:
   Stufe 14 nicht später als mit der alten Regel (± 1 Frame), gebaute Kacheln höchstens 2 % mehr.
   Sprung 3 R → 1000 km: Stufe 6 nicht später als alt.
4. **Lückenlos.** In jedem Frame von 1 und 2 ist jede von 2000 geseedeten Richtungen auf der Kugel
   von **genau einer** gezeichneten Kachel abgedeckt (keine Lücke, nichts doppelt). 0 Verstöße.
5. **Kein Mehrbau.** Gebaute Kacheln bis „Warteschlange leer" in 1 und 2 höchstens 2 % über der alten
   Regel. Die Zahl der Abwürfe aus der vollen Warteschlange wird ausgegeben, alt und neu.
6. `npm run check` grün, `PlanetLOD.ts` ≤ 300 Zeilen, `TerrainProvider.ts` wächst nicht (Ratsche).

## Verhalten

- **Kern `src/terrain/lodKernel.ts`** (neu, three-frei, in `THREE_FREE` eintragen): Die Baumlogik
  aus `QuadtreeTile` (Teilen, Zusammenlegen, Übergangsregel aus §4.5, Anfordern mit Budget,
  Sichtbarkeit) zieht wortgleich in den Kern um, danach kommen die zwei Änderungen unten dazu.
  `PlanetLOD.ts` behält nur, was three braucht: Mesh bauen, einhängen, `visible` setzen, entsorgen.
  Der Kern meldet das über Rückrufe.
- **Teilen erst mit eigener Geometrie:** Eine Kachel teilt sich nur, wenn ihre eigene Geometrie
  fertig ist. Damit verfeinert der Baum Stufe für Stufe, und die Warteschlange enthält nach einem
  Sprung die nächste Stufe statt aller vierzehn.
- **Grob vor fein:** Priorität erst nach Stufe, innerhalb der Stufe nach Distanz. Sonst verdrängen auf
  langsamen Geräten die feinen nahen Kacheln die groben Geschwister, ohne die nichts umschaltet
  (Prototyp: „nur teilen mit Geometrie" allein hilft bei 2 Kacheln pro Frame kaum, 969 statt 1099).
- **A/B-Schalter:** `?lod=alt` stellt die alte Regel her (Teilen ohne eigene Geometrie, Priorität =
  Distanz). Er ist zugleich die Gegenprobe im Test.
- Ohne Sprung, also im normalen Flug, entsteht dieselbe Kachelmenge wie heute.

## Dateien

- `src/terrain/lodKernel.ts` — neu, three-frei
- `src/terrain/PlanetLOD.ts` — wird zur dünnen three-Schicht über dem Kern
- `tools/test-lod.ts` — neu
- `tools/contracts.mjs` — nur `THREE_FREE` um `src/terrain/lodKernel.ts` ergänzen (erlaubt)
- `package.json` — Skript `test:lod`, in `test` einhängen; Version: nächste Patch-Nummer

## Hinweise

- **Priorität als eine Zahl:** `TerrainProvider` sortiert eine Zahl, „kleiner = wichtiger". Nicht
  `Stufe · 10²⁰ + Distanz` rechnen: Bei 10²¹ beträgt die f64-Auflösung ~10⁵ m, und die Reihenfolge der
  nahen Kacheln ginge verloren. Monoton und verlustfrei ist z. B. `Stufe + d / (d + Kachelgröße)`, also
  ein Wert in [Stufe, Stufe + 1). Prüfen, ob das über mehrere Planeten in derselben Warteschlange
  sinnvoll bleibt (ferne Planeten fordern ab 400 R ohnehin nichts an), und im PR begründen.
- `reprioritize` muss dieselbe Formel bekommen wie `request`, sonst sortiert die Warteschlange beim
  nächsten Frame wieder nach Distanz.
- Am Kommentar zu `Job.priority` in `TerrainProvider.ts` („Kameradistanz in m") darf die Bedeutung
  nachgeführt werden, aber ohne neue Zeilen (Ratsche). Sonst bleibt die Datei unberührt.
- Der Prototyp der Zahlen in *Fertig, wenn* ist ein Modell mit derselben Split-/Merge-/Übergangsregel,
  einer Kugel ohne Höhen und 8 bzw. 2 Plätzen pro Frame. Sein alter Weg (291 Frames ≈ 4,9 s bei
  60 fps) trifft das Einschwingen von Halt 3 auf dem Tablet (5,4 s).
- **Aufgabe 16** will die Split-Regel ebenfalls in einen Kern legen (`src/perf/tileCull.ts`). Nach
  dieser Aufgabe liegt sie in `lodKernel.ts`; 16 ergänzt dort den Culling-Term, statt sie ein zweites
  Mal zu verschieben.
- Kein Integrator, kein `Math.random`. Die 2000 Prüfrichtungen kommen aus `hash32` → `mulberry32`.

## Nicht-Ziele

Culling (Aufgabe 16), Speicherbudget (Aufgabe 19), Kachelauflösung oder `maxDepth`, größere
Warteschlange, mehr Worker, Änderungen an `TerrainProvider.ts` über den Kommentar hinaus.

## Auf dem Tablet prüfen

1. Vorschau mit `?bench` öffnen und Halt 3 beobachten, 2 m über Land. Der Boden wird innerhalb der
   ersten Sekunden sichtbar stufenweise detaillierter, statt erst ~5 s glatt zu bleiben und dann
   umzuspringen. *Fehlerbild:* Loch im Boden, Blick ins All durch den Boden, flackernde Kacheln.
2. Dasselbe mit `?bench&lod=alt`: Hier bleibt der Boden wie bisher lange glatt. Das ist die Gegenprobe.
3. Ohne `?bench`: Doppeltipp auf die Erde, im Orbit bis auf wenige Meter hinunterzoomen und eine Weile
   über die Oberfläche fliegen. Es darf kein Loch und kein Flackern auftreten, und Kacheln dürfen nicht
   sichtbar später nachladen als vorher.
4. Beide Messläufe (`?bench` und `?bench&lod=alt`) kopieren und als PR-Kommentar einfügen. Der Agent
   trägt die neue Zeile in `docs/leistung.md` ein und nennt die Einschwingzeit von Halt 2–4 im
   Vergleich zur Basiszeile.

## Abschluss

- Leitfaden §2: unter „Vorhanden" ergänzen: Quadtree verfeinert grob vor fein, Kern in `lodKernel.ts`.
- Leitfaden §9: Befund „Kachel-Warteschlange verhungert" als erledigt markieren (mit Version).
- Leitfaden §11: neue Zeile mit der Version.
