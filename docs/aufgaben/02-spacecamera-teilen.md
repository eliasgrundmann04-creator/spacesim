---
id: 02
titel: SpaceCamera.ts unter den Dateideckel teilen
status: erledigt
braucht: [00]
stufe: — (Vorbereitung 2b)
tablet: ja
---

## Ziel

`src/camera/SpaceCamera.ts` hat 476 Zeilen; Stufe 2b muss genau dort Funktion hinzufügen. Leitfaden
§8.1: Eine Überschreitung ist ein Auftrag zum Teilen. Reiner Umbau, kein geändertes Verhalten.

## Fertig, wenn

- Jede Datei unter `src/camera/` hat ≤ 300 Zeilen, der Eintrag in `CAP_BASELINE` ist entfernt.
- `npm run check` grün.
- Der PR listet jede verschobene Funktion mit Ziel-Datei.

## Dateien

- `src/camera/SpaceCamera.ts`
- höchstens zwei neue Dateien unter `src/camera/`, z. B. die Multi-Pointer-Gestenerkennung und die
  Oberflächen-/Near-Plane-Logik
- `tools/contracts.mjs` — nur den `CAP_BASELINE`-Eintrag entfernen

## Hinweise

- **Verschieben, nicht umschreiben.** Funktionskörper bleiben wortgleich, bis auf das, was der
  Schnitt erzwingt (`this.x` → Parameter). Kein Umbenennen, kein „bei der Gelegenheit".
- Die öffentliche Schnittstelle von `SpaceCamera` (siehe `docs/contracts.md`) bleibt gleich, damit
  `Engine.ts` unverändert bleiben kann. Wenn nicht: eskalieren.
- Wo ein abgetrennter Teil three-frei werden *kann* (reine Gestenmathematik), ihn so schneiden und
  in `THREE_FREE` aufnehmen — dann wird er offline testbar. Nicht erzwingen.
- Version: nächste Patch-Nummer.

## Nicht-Ziele

Neue Funktion, Bugfixes, Änderungen an `Engine.ts`.

## Auf dem Tablet prüfen

Der komplette Demo-Pfad aus der README: Erde fokussieren → Schubregler hoch, Stufe ×10 → zum Mond →
loslassen, Assistenz bremst → Zeitraffer ×10⁶, Kamera bleibt über dem Mond → Doppeltipp auf die Sonne
→ ein-, zwei-Finger-Gesten (Rotation mit Nachlauf, Pinch, Pan) und Blick über den Pol.
Alles muss sich genau wie vorher anfühlen.
