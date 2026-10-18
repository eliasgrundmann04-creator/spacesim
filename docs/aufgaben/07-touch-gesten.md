---
id: 07
titel: Touch-Gesten — Globus folgt dem Finger, nichts dreht von selbst
status: erledigt
braucht: [00]
stufe: —
tablet: ja
---

## Ziel

Zwei Rückmeldungen des Inhabers vom Tablet (Auftrag direkt im Chat, kein Issue):

1. **Orbit:** Der Körper dreht sich dem Finger entgegen. Er soll dem Finger folgen wie bei
   Google Earth — der berührte Punkt des Bodens bleibt unter dem Finger, als klebe er dort.
2. **Freiflug:** Beim Schwenken kommt eine ungewollte Drehung um die Achse senkrecht zum
   Bildschirm dazu.

Ein erster Versuch (v0.4.4-Entwurf) wurde verworfen: Er ruckte am Planetenrand, der Planet lief nach
dem Loslassen unerwartet los, und das Nachdrehen im Freiflug blieb.

## Fertig, wenn

Offline-Test `tools/test-drag.ts`:

- Freiflug: Jeder Zugschritt dreht um eine Achse in der Bildebene (z-Anteil exakt 0).
- Orbit: Der Griffpunkt ist der echte Strahl-Kugel-Treffer (< 1e-12 rad) und liegt nach einem
  Zug von 700 Schritten noch unter dem Finger (< 1e-6 px), auch in 2 m Höhe (Gegenprobe `acos`).
- Planetenrand: Drehung je Pixel überall ≤ GRAB_EDGE · ε · (rad je px); Gegenprobe: der exakte
  Treffer wächst zum Rand wie 1/√Abstand ohne Grenze.
- Wurf: Fehler < 10 % bei gebündelten Events mit Zeitstempel-Jitter (Gegenprobe Einzelquotient);
  kein Wurf nach Ruhen; Nachlauf bei 20–120 fps in derselben Orientierung (< 1e-12 rad).
- Ohne Geste und ohne Wurf ändert sich die Orientierung nicht (bitgenau über 10 s).
- `npm run check` grün, `SpaceCamera.ts` nicht gewachsen.

## Dateien

- `src/nav/dragKernel.ts` (neu, three-frei) — Geste → Drehvektor im Kamerarahmen
- `src/nav/fling.ts` (neu, three-frei) — Wurfgeschwindigkeit und Nachlauf
- `src/camera/SpaceCamera.ts` — verdrahtet nur noch; Nivellierung entfernt
- `tools/test-drag.ts` (neu)
- `tools/contracts.mjs` — nur `CAP_BASELINE` von `SpaceCamera.ts` gesenkt (476 → 473)

## Ursachen

- **Orbit falsch herum:** Die Orbit-Kamera benutzte die Freiflug-Drehung („nach unten ziehen ⇒
  Blick hebt sich"). Im Orbit hängt die Position an der Blickrichtung, also lief der Boden gegen den Finger.
- **Nachdrehen im Freiflug:** `levelRoll` zog den Roll mit τ = 0,8 s auf den Ekliptik-Norden — eine
  Drehung um die Bildmitte, die nach jeder schrägen Geste von selbst einsetzte. Der verworfene Versuch
  hatte sie nur sofort statt langsam ausgeführt; das ist dieselbe Drehung zu einem anderen Zeitpunkt.
- **Rucken im verworfenen Versuch:** exakter Treffer bis an den Rand (dort ∞ Grad je Pixel), harter
  Wechsel auf eine Ersatzrate hinter dem Rand, eine iterative Roll-Korrektur mit Schwellwert, und ein
  Wurf aus einem einzelnen Event (1 ms Abstand ⇒ Deckel 12 rad/s), der auch nach einer Pause noch galt.

## Lösung

- Drei Regeln: Nichts dreht von selbst. Jede Geste ist eine reine Funktion Bildschirmpunkte →
  Drehvektor. Der Wurf ist eine Ausgleichsgerade über 100 ms, der Nachlauf exakt integriert.
- Griff Schritt für Schritt: die Drehung, die den Kugelpunkt unter dem neuen Fingerort dorthin
  bringt, wo der unter dem alten lag. Der gegriffene Weltpunkt bleibt so über den ganzen Zug erhalten.
- Profil zum Rand: exakt, bis der Boden 4-mal schneller läuft als in Bildmitte, danach mit derselben
  Steigung weiter und sanft gegen den Horizont sättigend — stetig differenzierbar, ohne Umschalten.
- Neben dem Körper oder bei Scheiben < 40 px: feste Rate, Körper folgt dem Finger, kein Drehen um die
  Bildmitte. Übergang Anflug → Orbit über die kürzeste Drehung statt Roll-Reset.

## Nicht-Ziele

Nordausrichtung (der Roll bleibt, wie die Gesten ihn hinterlassen), Zwei-Finger-Drehen, Änderungen an
der Freiflug-Rate.

## Auf dem Tablet prüfen

Siehe PR.
