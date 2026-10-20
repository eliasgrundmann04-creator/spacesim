---
id: 19
titel: Nebenspur B6 — Speicherbudget für Kacheln mit Verdrängung
status: offen
braucht: [16]
stufe: B (Performance & Tablet)
tablet: ja
---

## Ziel

Leitfaden §7, Nebenspur B: *Speicherbudget mit Verdrängung.* Teilantwort auf die offene Frage aus
Leitfaden §9 („Speicherbudget auf dem Tablet") — für Kachelgeometrie. Das Entladen ganzer Systeme ist
eine Entscheidung des Inhabers und kommt als Vorlage in Aufgabe 20.

Eine Kachel (Auflösung 16, mit Skirt 19 × 19 Vertices, Position + Normale + Farbe in f32) belegt rund
13 KB — im JS-Speicher und noch einmal auf der GPU. Heute legt der Quadtree Kacheln nur nach Distanz
zusammen. Seit Aufgabe 16 bleiben außerdem Kinder bestehen, die aus dem Blick geraten: Wer am Boden
einmal im Kreis schaut, behält die feine Geometrie aller Richtungen. Über mehrere Planeten und lange
Flüge wächst der Bestand ohne Obergrenze, bis das Tablet die Seite verwirft.

Nach dieser Aufgabe gilt ein globales Budget für Kachelgeometrie über alle Planeten. Wird es
überschritten, werden zuerst die am längsten nicht gezeichneten Teilbäume zusammengelegt.

## Fertig, wenn

Offline-Test `tools/test-budget.ts` (neu, in `npm test` eingehängt) zeigt mit Zahlenwert:

1. **Budget hält.** In einer simulierten Folge von Ankünften (mehrere Planeten, Drehen am Boden,
   Abflug) liegt der Bestand nach jeder Verdrängungsrunde unter dem Budget, sofern genug Verdrängbares
   existiert; die größte Überschreitung ist höchstens die Größe der Ankünfte eines Frames (Zahl im Test).
2. **Nichts Gezeichnetes geht.** Kein Teilbaum, von dem in der letzten Sekunde etwas gezeichnet wurde,
   wird verdrängt — geprüft bei 20, 60 und 120 fps (Zeit, nicht Frames).
3. **Kein Loch.** Verdrängt wird nur durch Zusammenlegen auf eine Kachel, die ihre eigene Geometrie
   *hat* (§4.5). Wurzelkacheln werden nie verdrängt.
4. **Reihenfolge.** Zuerst am längsten ungezeichnet, bei Gleichstand die fernste Kachel.
5. **Voll und nichts verdrängbar:** Neue Verfeinerung wird ausgesetzt, Anfragen für Abdeckung laufen
   weiter; sobald wieder Platz ist, geht die Verfeinerung weiter. Beide Übergänge im Test.
6. **Kosten.** Auswahl der Opfer aus 5000 Kandidaten < 0,5 ms (Mittel über 100 Läufe, Zahl im PR).
7. `npm run check` grün, jede Datei unter `src/terrain/` außer den Ratschen-Dateien ≤ 300 Zeilen.

## Verhalten

- **Kern `src/perf/tileBudget.ts`** (neu, three-frei): Buchführung in Bytes (Anmelden bei Ankunft,
  Abmelden bei `dispose`), Zeitpunkt des letzten Zeichnens je Kachel, Auswahl der Opfer aus einer
  flachen Kandidatenliste (`id`, eigene Geometrie ja/nein, Bytes des Teilbaums, zuletzt gezeichnet im
  Teilbaum, Distanz). Ein Budget für alle Planeten — der Speicher gehört dem Gerät, nicht dem Planeten.
- **`PlanetLOD`:** meldet Kacheln an und ab, setzt „gezeichnet" in `update`, liefert auf Anfrage seine
  Kandidaten und legt Opfer über das vorhandene `merge()` zusammen.
- **Wann verdrängt wird:** bei Ankunft einer Kachel, wenn das Budget überschritten ist — nicht in jedem
  Frame. Höchstens so viele Opfer pro Ankunft, dass das Budget wieder eingehalten wird.
- **Budget:** Standard 48 MB Kachelgeometrie (gezählt: `byteLength` von Position, Normale, Farbe;
  ≈ 3700 Kacheln). `?mem=64` setzt MB, `?mem=0` schaltet die Verdrängung ab (A/B).
- **HUD:** in der Kachelzeile `Kachelspeicher 23,1 / 48 MB`, bei ausgesetzter Verfeinerung `voll`.

## Dateien

- `src/perf/tileBudget.ts` — neu, three-frei
- `src/terrain/PlanetLOD.ts` — Anmelden/Abmelden, „gezeichnet", Kandidaten, Verfeinerung aussetzen
- `src/terrain/QuadtreeTile.ts` — neu, **nur falls** `PlanetLOD.ts` sonst über 300 Zeilen wächst:
  die Klasse `QuadtreeTile` wortgleich verschieben (Verschieben, nicht umschreiben; Aufgabe 02 als Muster)
- `src/core/EngineHud.ts` — Anzeige
- `tools/test-budget.ts` — neu
- `package.json` — Skript `test:budget`, in `test` einhängen; Version: nächste Patch-Nummer

## Hinweise

- **Zusammenlegen gibt frei.** `merge()` ruft `dispose()` der Kinder, das ruft `geometry.dispose()`.
  Prüfen, dass dabei auch die GPU-Puffer freigegeben werden (Index-Attribut ist geteilt, siehe Kommentar
  in `createMesh`) — Geo im HUD aus Aufgabe 14 muss nach einer Verdrängung sinken.
- **Teilbaum-Werte** (Bytes, zuletzt gezeichnet) entstehen beim ohnehin laufenden Baumdurchlauf in
  `update`; nicht pro Kandidat den Teilbaum neu ablaufen.
- **48 MB** ist eine Setzung, keine Messung: Bei 2 m Höhe braucht der Quadtree mit Culling (Aufgabe 16)
  im Prototyp rund 1150 Knoten ≈ 15 MB. Nach dem Messlauf auf dem Tablet die Zahl in Leitfaden §9
  bestätigen oder korrigieren lassen — Entscheidung des Inhabers.
- Der Schutz „in der letzten Sekunde gezeichnet" ist eine Zeitspanne, kein Frame-Zähler (§9,
  Kanon-Kandidat 1).

## Nicht-Ziele

Ganze Systeme entladen (Aufgabe 20), JS-Kopien der Puffer nach dem Upload freigeben, Texturen,
Änderungen an `TerrainProvider.ts` (Ratsche) oder an der Split-Regel.

## Auf dem Tablet prüfen

1. Erde, wenige Meter über dem Boden, langsam zweimal im Kreis drehen: kein Loch, kein schwarzer Fleck.
   HUD: Kachelspeicher steigt, bleibt aber unter dem Budget.
2. Mit `?mem=8` dasselbe: Kachelspeicher bleibt nahe 8 MB, beim Zurückdrehen lädt Boden sichtbar nach
   (erwartet), aber es entsteht **nie** ein Loch. Steht `voll` im HUD, wird die Fernsicht gröber, der
   Boden direkt vor der Kamera bleibt geschlossen.
3. Von der Erde zum Mond und zurück: Der Kachelspeicher der Erde wird beim Abflug kleiner (Distanz)
   und beim Ankommen am Mond nicht durch Erdkacheln blockiert.
4. Fünf Minuten frei fliegen, mehrere Planeten anfliegen: Die Seite wird nicht neu geladen,
   Kachelspeicher und Geo bleiben begrenzt.
5. Messlauf `?bench` und `?bench&mem=0`; beide Ergebnisse als PR-Kommentar einfügen. Der Agent trägt
   die Zeile in `docs/leistung.md` ein.

## Abschluss

- Leitfaden §2: Speicherbudget für Kacheln.
- Leitfaden §9, „Speicherbudget auf dem Tablet": Kachelteil beantwortet (Budget, Standardwert zur
  Bestätigung durch den Inhaber); Systemteil offen → Aufgabe 20.
- Leitfaden §11: neue Zeile mit der Version.
