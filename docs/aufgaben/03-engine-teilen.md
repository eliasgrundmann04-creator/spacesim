---
id: 03
titel: Engine.ts unter den Dateideckel teilen
status: erledigt
braucht: [00]
stufe: — (Vorbereitung 2b)
tablet: ja
---

## Ziel

`src/core/Engine.ts` hat 496 Zeilen und ist der Ort, an dem Stufe 2b die Frame-Reihenfolge im
Frame-Loop ändern muss. Reiner Umbau nach Leitfaden §8.1, kein geändertes Verhalten.

## Fertig, wenn

- Jede Datei unter `src/core/` hat ≤ 300 Zeilen, der Eintrag in `CAP_BASELINE` ist entfernt.
- Die Reihenfolge in `frame()` ist unverändert und steht als nummerierter Kommentar an einer Stelle:
  `universe.update` → Orientierung → `stepNavigation` → Kameraplatzierung → `syncToCamera` → `pump` → `render`.
- `npm run check` grün; der PR listet jede verschobene Funktion mit Ziel-Datei.

## Dateien

- `src/core/Engine.ts`
- höchstens zwei neue Dateien unter `src/core/`, naheliegend: HUD-Aufbereitung, Eingabe-Bindung
  (Tastatur/Buttons) — der Frame-Loop selbst bleibt in `Engine.ts`
- `tools/contracts.mjs` — nur den `CAP_BASELINE`-Eintrag entfernen

## Hinweise

- **Verschieben, nicht umschreiben**, wie in Aufgabe 02.
- Der Laufzeit-Selbsttest gegen `dtReal`/`dtSim`-Verwechslung bleibt erhalten und aktiv.
- Läuft Aufgabe 02 gleichzeitig: `SpaceCamera` nicht anfassen. Braucht der Schnitt das doch → eskalieren.
- Version: nächste Patch-Nummer.

## Nicht-Ziele

Neue Funktion, Änderungen an der Frame-Reihenfolge, Performance-Arbeit.

## Auf dem Tablet prüfen

Demo-Pfad wie in Aufgabe 02, zusätzlich: alle Bildschirm-Buttons (Zeitraffer, Ziel durchschalten,
Zoom-Stufen, ASSIST, STOP) und die HUD-Anzeige inklusive Terrain-Backend und verlorener Jobs.
