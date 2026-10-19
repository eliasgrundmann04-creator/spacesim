---
id: 05
titel: Stufe 2b — Kamera hängt in Frames um
status: erledigt
braucht: [01, 02, 03, 04]
stufe: 2b
tablet: ja
---

> **Entwurf.** Wird präzisiert, wenn 01–04 erledigt sind. Der erste Schritt dieser Aufgabe ist der
> Plan; passt er nicht in fünf Dateien, ist die erwartete Antwort ein Teilungsvorschlag (05a/05b)
> per Eskalation — kein Anfang.

## Ziel

Leitfaden §12.4, Teilstufe 2b: *Kamera hängt um: `SpaceCamera`, `SceneManager`.* Die Kamera hat einen
Frame aus dem Frame-Baum (Aufgabe 01) und eine Position *in diesem Frame*. Beim Überschreiten der in
Aufgabe 04 entschiedenen Schwelle wird sie umgehängt. Szene und Navigation rechnen relativ zum
Kameraframe.

## Fertig, wenn

- Offline-Test: Die Kamera fliegt per Navigationskern über mehrere Frame-Wechsel (Erde → System →
  Nachbarstern → zurück); Ankerwechsel und Geschwindigkeit bleiben stetig, kein Sprung > 1 mm
  beim Umhängen, keine Doppelwechsel an der Schwelle (Hysterese).
- Alle bestehenden Tests unverändert grün.
- Das HUD zeigt den aktuellen Kameraframe.

## Dateien

Werden im Plan festgelegt. Erwartbar: Kamera (nach Aufgabe 02 geteilt), `SceneManager.ts`, ein
Adapter zwischen Frame-Baum und Navigation, `Engine.ts` (Frame-Loop), ein neuer Test.

## Hinweise

- Bis Aufgabe 06 haben die Körper noch absolute Positionen. Die Präzision gewinnt diese Aufgabe
  also noch nicht — sie baut den Mechanismus und darf nichts verschlechtern.
- Ankerrelative Geschwindigkeit (Stufe 1 *Gelernt*) gilt weiter; beim Umhängen nur die
  Positionsdarstellung ändern, nicht den Bewegungszustand.

## Auf dem Tablet prüfen

Demo-Pfad aus der README vollständig; dazu zu einem `PSC-*`-Stern fliegen und zurück zur Erde — das
HUD zeigt die Frame-Wechsel, die Bewegung bleibt dabei ruckfrei.
