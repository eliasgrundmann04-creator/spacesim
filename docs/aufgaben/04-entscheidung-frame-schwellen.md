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
- Der PR ändert **nur** `docs/leitfaden.md` §9 und diese Aufgabendatei.

## Dateien

- `docs/leitfaden.md` — nur §9
- diese Datei — Status

## Hinweise

- Vorher lesen: Leitfaden §3.1, §7 Stufe 1 *Gelernt*, `docs/contracts.md` für `nav/proximity`,
  `nav/Navigator`, `universe/CelestialBody`.
- Zahlen statt Adjektive: Größenordnungen der SOI von Erde, Mond, Sonne; Abstände der
  Nachbarsterne; f64-Auflösung an der Schwelle.
- Status bleibt nach dem PR `offen`, bis der Inhaber im PR-Kommentar entschieden hat. Dann die
  Entscheidung in §9 als **entschieden** mit Datum eintragen, Status `erledigt`.

## Nicht-Ziele

Code.
