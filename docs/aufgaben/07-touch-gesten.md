---
id: 07
titel: Touch-Gesten — Globus folgt dem Finger, kein Roll beim Schwenken
status: erledigt
braucht: [00]
stufe: —
tablet: ja
---

## Ziel

Zwei Rückmeldungen des Inhabers vom Tablet (Auftrag direkt im Chat, kein Issue):

1. **Orbit:** Der Körper dreht sich dem Finger entgegen. Er soll dem Finger folgen wie bei
   Google Earth — der berührte Punkt des Bodens bleibt unter dem Finger, als klebe er dort.
2. **Freiflug:** Beim schrägen Schwenken kommt eine ungewollte Drehung um die Achse senkrecht
   zum Bildschirm (Roll) dazu.

## Fertig, wenn

- Offline-Test `tools/test-drag.ts`: im Orbit liegt der berührte Punkt nach jedem Zugschritt
  < 1e-6 px neben dem Finger, auch in 2 m Höhe (< 1e-3 px; Gegenprobe über `acos` messbar
  schlechter); der Roll ändert sich dabei nicht (< 1e-9 rad).
- Freiflug: diagonale Geste, Kreisgeste und Nachlauf bei 20–120 fps ändern den Roll um < 1e-9 rad
  (Gegenprobe: eine lokale Drehachse kippt den Horizont messbar).
- `npm run check` grün, `SpaceCamera.ts` nicht gewachsen.

## Dateien

- `src/nav/dragKernel.ts` (neu, three-frei) — Griff auf der Kugel, Roll halten, Ersatzrate
- `src/camera/gestures.ts` (neu) — Multi-Pointer-Erkennung aus `SpaceCamera.ts` herausgelöst,
  damit diese Datei nicht über ihre Ratsche wächst
- `src/camera/SpaceCamera.ts` — Geste → Kern
- `tools/test-drag.ts` (neu)
- `tools/contracts.mjs` — nur `CAP_BASELINE` von `SpaceCamera.ts` gesenkt (476 → 448)

## Ursachen

- **Orbit:** Die Orbit-Kamera benutzte dieselbe Drehung wie der Freiflug („nach unten ziehen ⇒
  Blick hebt sich"). Im Orbit hängt die Position aber an der Blickrichtung — hebt sich der Blick,
  wandert die Kamera nach Süden, und der Boden läuft nach oben, also gegen den Finger.
- **Freiflug:** Eine Geste war *eine* Drehung um die zur Geste senkrechte Kameraachse. Bei schräger
  Geste liegt diese Achse schräg im Bild und nimmt `up` mit — der Horizont kippt. Die
  Roll-Nivellierung (τ = 0,8 s) hat das danach zurückgedreht: das sichtbare Nachdrehen.

## Lösung

- Jeder Gesten- und Nachlaufschritt nimmt seinen Roll-Anteil sofort zurück (`holdRoll`). Abseits des
  Pols ist das Gieren um worldUp plus Nicken um die Rechtsachse; am Pol blendet die Korrektur aus
  wie `levelRoll`, die Blickachse bleibt ohne Anschlag.
- Orbit bis 10 Radien Abstand: Beim Aufsetzen wird der berührte Punkt der Kugel (Radius bis zum
  Boden unter der Kamera) gemerkt; jeder Zug dreht das Rig um das Zentrum, bis der Fingerstrahl
  ihn wieder trifft. Die freie Drehung um die Griffachse hält den Roll (Norden bleibt oben).
- Daneben (Finger neben dem Körper, weiter als 10 Radien, Zwei-Finger-Schwenk): feste Rate mit
  umgekehrtem Vorzeichen, so schnell wie der Boden in Bildmitte, höchstens die Freiflug-Rate.

## Auf dem Tablet prüfen

Siehe PR.
