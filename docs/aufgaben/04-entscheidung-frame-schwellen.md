---
id: 04
titel: Entscheidungsvorlage — Frame-Wechsel-Schwellen
status: offen
braucht: [00]
stufe: 2 (Vorbereitung 2b)
tablet: nein
---

## Ziel

Leitfaden §9 hält offen: *Frame-Wechsel-Schwellen (Stufe 2): distanzbasiert, hierarchisch nach SOI,
oder nach Winkelgröße?* Das entscheidet der Inhaber, nicht der Agent. Diese Aufgabe liefert die
Vorlage, damit die Entscheidung in fünf Minuten auf dem Tablet fällt.

## Fertig, wenn

- Leitfaden §9 enthält unter dieser Frage 2–3 Optionen, je mit: Regel in einem Satz, was sie gut
  kann, wo sie bricht (konkretes Szenario aus diesem Projekt: Mond-Vorbeiflug, Time-Warp ×10⁸,
  Anflug auf einen `PSC-*`-Stern, Flug aus der Galaxie hinaus), und Folgen für die Navigation
  (Ankerwechsel, ankerrelative Geschwindigkeit, Softmin-Referenzhöhe).
- Eine Empfehlung mit Begründung, ausdrücklich als Empfehlung markiert.
- Hysterese ist in jeder Option behandelt (kein Flattern an der Schwelle).
- Der PR ändert **nur** `docs/leitfaden.md` (§9, dazu die Zeile in §11), diese Aufgabendatei und
  die Version in `package.json`.

## Dateien

- `docs/leitfaden.md` — §9, dazu die Zeile in §11
- diese Datei — Status
- `package.json` — nur die Version

## Hinweise

- Vorher lesen: Leitfaden §3.1, §7 Stufe 1 *Gelernt*, `docs/contracts.md` für `nav/proximity`,
  `nav/Navigator`, `universe/CelestialBody`.
- Zahlen statt Adjektive: Größenordnungen der SOI von Erde, Mond, Sonne; Abstände der
  Nachbarsterne; f64-Auflösung an der Schwelle.
- Status bleibt im PR zunächst `offen`. Der Inhaber entscheidet per PR-Kommentar und merged erst
  danach. Auf seinen Kommentar hin trägst du die Entscheidung im **selben PR** in §9 als
  **entschieden** mit Datum ein und setzt den Status auf `erledigt`.
- Jede Option bekommt einen Buchstaben (A, B, C), damit die Antwort „Option B" eindeutig ist.

## Nicht-Ziele

Code.

## Bearbeitung im PR

- Entscheidungsvorlage in `docs/leitfaden.md` §9 ausgearbeitet (Optionen A, B, C; Empfehlung Option B).
- Status bleibt gemäß Hinweis im PR `offen`, bis der Inhaber entscheidet.
