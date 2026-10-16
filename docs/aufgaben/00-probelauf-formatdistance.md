---
id: 00
titel: Probelauf — doppeltes formatDistance auflösen
status: offen
braucht: []
stufe: —
tablet: ja
---

## Ziel

Es gibt zwei verschiedene `formatDistance`: `src/core/constants.ts` (benutzt vom HUD in `Engine.ts`)
und `src/nav/format.ts` (getestet, benutzt von `FlightControls.ts`). Nach dieser Aufgabe gibt es nur
noch die aus `src/nav/format.ts`.

Die Aufgabe ist absichtlich klein: Sie prüft die ganze Kette — Issue → Plan → PR → CI → Vorschau →
Merge —, bevor eine Stufe aus §7 drankommt.

## Fertig, wenn

- `src/` enthält genau eine Definition von `formatDistance` (die in `src/nav/format.ts`).
- `npm run check` ist grün, `Engine.ts` ist dabei nicht gewachsen.
- Der PR nennt, wie sich die HUD-Anzeige sichtbar ändert (die beiden Funktionen runden und wechseln
  die Einheit an verschiedenen Schwellen) — mit zwei, drei Beispielwerten vorher/nachher.

## Dateien

- `src/core/constants.ts` — Definition entfernen
- `src/core/Engine.ts` — Import umstellen (nur die Importzeile)

## Hinweise

- Vorher prüfen, ob noch etwas anderes `formatDistance` aus `constants` importiert (`docs/contracts.md`).
- Version → 0.4.2.

## Nicht-Ziele

Keine weitere Aufräumarbeit in `Engine.ts`, auch wenn sie naheliegt — dafür gibt es Aufgabe 03.

## Auf dem Tablet prüfen

In der Vorschau: Erde fokussieren, heraus- und hineinzoomen. Die Entfernungsanzeige im HUD wechselt
sauber zwischen cm / m / km / AE, ohne `NaN` oder `—` bei normalen Werten.
