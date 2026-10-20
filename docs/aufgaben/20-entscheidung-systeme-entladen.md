---
id: 20
titel: Nebenspur B7 — Entscheidungsvorlage: wann ferne Systeme wieder entladen werden
status: offen
braucht: [06, 19]
stufe: B (Performance & Tablet)
tablet: nein
---

## Ziel

Leitfaden §9 hält offen: *Speicherbudget auf dem Tablet: ab wann werden ferne Systeme wieder
entladen?* Den Kachelteil beantwortet Aufgabe 19. Offen bleibt, ob und wann ein bevölkertes
Planetensystem (`UniverseManager.populateSystem`) wieder abgebaut wird — heute nie. Das entscheidet der
Inhaber, nicht der Agent. Diese Aufgabe liefert die Vorlage, damit die Entscheidung in fünf Minuten auf
dem Tablet fällt (Muster: Aufgabe 04).

## Fertig, wenn

- Leitfaden §9 enthält unter dieser Frage 2–3 Optionen (A, B, C), je mit: Regel in einem Satz, was sie
  gut kann, wo sie bricht (konkrete Szenarien aus diesem Projekt: Rundflug über fünf Nachbarsterne;
  Rückflug zu einem eben verlassenen System; Time-Warp ×10⁸ in einem System; Goto auf einen Stern am
  Rand der 16-Lj-Nachbarschaft) und Folgen für Navigation, Frame-Baum und Kachelbudget.
- **Zahlen statt Adjektive:** Kosten eines bevölkerten Systems, offline ermittelt — Zahl der Körper,
  Zahl der Szenenobjekte, Bytes der Wurzelkacheln und der Gasriesen-Geometrie (aus den Konstanten und
  Segmentzahlen gerechnet) für drei geseedete Nachbarsysteme. Dazu die Zahl der Systeme, die bei
  `POPULATE_DISTANCE` auf einem typischen Rundflug bevölkert werden.
- Jede Option behandelt Hysterese (kein Auf- und Abbauen an der Schwelle) und was nie entladen werden
  darf (Kameraanker, Goto-Ziel, aktueller Kameraframe, das Sonnensystem).
- Eine Empfehlung mit Begründung, ausdrücklich als Empfehlung markiert.
- Der PR ändert **nur** `docs/leitfaden.md` (§9, dazu die Zeile in §11), diese Aufgabendatei und die
  Version in `package.json`.

## Dateien

- `docs/leitfaden.md` — §9, dazu die Zeile in §11
- diese Datei — Status
- `package.json` — nur die Version

## Hinweise

- Vorher lesen: Leitfaden §4.4 und §4.6, `docs/contracts.md` für `universe/UniverseManager`,
  `core/SceneManager` (`removeBody` gibt es, wird aber nirgends benutzt) und `frames/FrameTree`.
- Entladen verliert nichts, was nicht wiederkommt: Systeme entstehen deterministisch aus
  `hash32(…)` (§4.6). Zu prüfen ist, ob das seit Stufe 2c (Aufgabe 06, Frames je System) noch ohne
  Ausnahme stimmt — auch der Frame eines Systems muss beim Wiederaufbau identisch entstehen.
- Die Zahlen für die Vorlage darf ein Wegwerf-Skript liefern; es wird nicht eingecheckt. Rechenweg in
  §9 in einem Satz nennen.
- Status bleibt im PR zunächst `offen`. Der Inhaber entscheidet per PR-Kommentar und merged erst danach.
  Auf seinen Kommentar hin trägst du die Entscheidung im **selben PR** in §9 als **entschieden** mit
  Datum ein und setzt den Status auf `erledigt`. Die Umsetzung ist eine eigene, spätere Aufgabe.

## Nicht-Ziele

Code.
