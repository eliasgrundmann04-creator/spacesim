---
id: 15
titel: Nebenspur B2 — Messlauf (?bench) und Leistungsprotokoll
status: offen
braucht: [14]
stufe: B (Performance & Tablet)
tablet: ja
---

## Ziel

Leitfaden §7, Nebenspur B: *Nach jeder Kernstufe kurz prüfen, nicht am Ende sammeln.*

Damit „kurz prüfen" wirklich kurz ist und Messungen vergleichbar sind, braucht es einen festen
Messlauf: `?bench` fliegt eine vorgegebene Route durch alle Skalen, misst an jedem Halt mit dem Kern
aus Aufgabe 14 und gibt am Ende eine fertige Tabellenzeile zum Kopieren aus. Die Zeilen sammelt
`docs/leistung.md` — eine pro Kernstufe und pro B-Aufgabe, damit eine Verschlechterung in dem PR
auffällt, der sie verursacht, und nicht zwanzig Aufgaben später.

## Fertig, wenn

Offline-Test `tools/test-bench.ts` (neu, in `npm test` eingehängt) zeigt mit Zahlenwert:

1. **Ablauf nach Zeit.** Die Zustandsfolge *Anfahren → Einschwingen → Messen → nächster Halt* läuft
   bei 20, 60 und 120 fps mit denselben Haltezeiten (± ein Frame) und endet nach derselben Zahl von
   Halten. Die Gesamtdauer ist im Test ausgegeben.
2. **Einschwingen.** Ein Halt misst erst, wenn die Kachel-Warteschlange leer ist oder 15 s vergangen
   sind; die Einschwingzeit wird mitprotokolliert („bis leer" bzw. „> 15 s"). Beide Fälle im Test.
3. **Ausgabe.** Die Zusammenfassung ist eine Markdown-Tabellenzeile je Halt plus Kopfzeile mit Version,
   Datum, Gerät (gekürzter User-Agent), Backend (WebGPU/WebGL2) und Renderauflösung; deutsche
   Zahlenformate; Spaltenzahl in jeder Zeile gleich (im Test geprüft).
4. **Determinismus.** Die Route ist eine feste Liste; zweimal erzeugt ⇒ identisch. Die Simzeit wird zu
   Beginn auf einen festen Wert gesetzt, Warp ×1.
5. `docs/leistung.md` existiert mit Erklärung, Spaltenbeschreibung und der **Basiszeile vom Tablet**
   (siehe *Auf dem Tablet prüfen*, Schritt 4).
6. `npm run check` grün, `Engine.ts` ≤ 300 Zeilen.

## Route

Jeder Halt: Kamera hinsetzen, einschwingen, 5 s messen. Halt 1 im Orbitmodus, alle anderen im
Freiflug ohne Schub mit Assistenz — der normale Frame-Pfad läuft dabei weiter.

| Halt | Ort | Blick |
|---|---|---|
| 1 | Erde, Orbitmodus, Abstand 3 R | ganze Kugel |
| 2 | Erde, 1000 km Höhe | 30° unter den Horizont |
| 3 | Erde, 2 m Höhe über Land | waagerecht zum Horizont |
| 4 | Mond, 10 km Höhe | 30° unter den Horizont |
| 5 | 50 AE über der Ekliptik | zur Sonne |
| 6 | 20 Lj vom Sonnensystem | zur Sonne (alle Nachbarsterne im Feld) |

Gemessen je Halt: Bild p50/p95/max, CPU p95, Ruckler, Draw, Tri, Geo, Einschwingzeit.

## Verhalten

- **`src/perf/benchRoute.ts`** (neu, three-frei): Routenliste, Zustandsautomat als reine Funktion von
  (Zustand, Zeit, Warteschlangenlänge), Formatierung der Tabellenzeilen. Kein DOM, kein three.
- **`src/core/EngineBench.ts`** (neu): setzt Kamera und Uhr über deren öffentliche Schnittstelle,
  füttert den Automaten jeden Frame, zeigt am Ende ein Feld mit dem Ergebnis und einem Knopf
  „Kopieren" (Muster: Kopierknopf in `src/ui/TuningPanel.ts`); zusätzlich `console.info`.
- **Während des Messlaufs** ist die adaptive Renderauflösung eingefroren (Standard 1,0×,
  `?bench=1.5` für einen anderen Wert) — sonst vergleicht man verschiedene Auflösungen.
- Ohne `?bench` ändert sich nichts.

## Dateien

- `src/perf/benchRoute.ts` — neu, three-frei
- `src/core/EngineBench.ts` — neu
- `src/core/Engine.ts` — Messlauf starten, pro Frame aufrufen, Auflösung einfrieren
- `tools/test-bench.ts` — neu
- `docs/leistung.md` — neu: das Protokoll
- `package.json` — Skript `test:bench`, in `test` einhängen; Version: nächste Patch-Nummer

## Hinweise

- **Kamera platzieren:** über `SpaceCamera` (`focus`, `enterFreeFlight`, `setWorldPosition`,
  `setFreeAltitude`, `lookTowards`, Frame-Methoden) und `Navigator.resetMotion`. Reicht die öffentliche
  Schnittstelle nicht, um einen Halt zu erreichen: eskalieren, nicht `SpaceCamera` umbauen.
- Halt 3 braucht Land, nicht Ozean: einen festen Ort wählen, an dem `TerrainField.height` über dem
  Meeresspiegel liegt, und ihn im Test belegen.
- Die Basiszeile entsteht nach Stufe 2c (v0.5). Was die Frame-Umrechnung pro Körper und Frame kostet,
  zeigt die Phase „Sync" mit `?perf` (Aufgabe 14) — im PR nennen, ob sie auffällt.
- Halt 6 liegt mit dem Frame-Baum (Stufe 2) in einem anderen Bezugsrahmen als Halt 1–5. Positionen
  deshalb relativ zu einem Körper angeben (Sonne, Erde, Mond), nie als absolute Weltkoordinate.
- **Kopfzeile von `docs/leistung.md`:** Spalten fest, Einheiten im Kopf. Darunter die Regel aus der
  README der Aufgaben: Wann ein Messlauf fällig ist und dass eine Verschlechterung von p95 um mehr als
  20 % gegenüber der Vorzeile als Befund in Leitfaden §9 eingetragen wird.

## Nicht-Ziele

Optimierungen, Änderungen an `SpaceCamera` oder `Navigator`, automatischer Messlauf in der CI (dort
gibt es keine GPU).

## Auf dem Tablet prüfen

1. Vorschau mit `?bench` öffnen, Tablet hinlegen, nicht berühren. Die Kamera springt nacheinander zu
   den sechs Halten; nach rund 1–2 Minuten erscheint ein Ergebnisfeld.
   *Fehlerbild:* ein Halt unter der Oberfläche, schwarzes Bild, Halt 3 im Wasser, Lauf bleibt stehen.
2. Das Ergebnis hat sechs Zeilen mit plausiblen Zahlen (Draw > 0 überall, Tri bei Halt 3 am höchsten
   oder nahe daran).
3. Ein zweiter Lauf direkt danach liefert Werte in derselben Größenordnung (± 20 %).
4. „Kopieren" tippen und das Ergebnis **als Kommentar in diesen PR** einfügen. Der Agent übernimmt es
   als Basiszeile in `docs/leistung.md`.
5. Ohne `?bench` verhält sich die App wie vorher.

## Abschluss

- Leitfaden §2: Messlauf `?bench` und `docs/leistung.md` erwähnen.
- Leitfaden §11: neue Zeile mit der Version.
