---
id: 08
titel: Orbit-Griff über den Rand hinaus, Zwei-Finger-Drehen
status: erledigt
braucht: [07]
stufe: —
tablet: ja
---

## Ziel

Zwei Rückmeldungen des Inhabers zu Aufgabe 07 (Auftrag direkt im Chat, kein Issue):

1. **Orbit-Griff über den Rand hinaus:** Statt am Horizont zu sättigen, soll die Umrundung
   weiterlaufen. Innerhalb der exakten Zone (`exactLimit`) bleibt der Griff exakt. Außerhalb wird
   der Zugschritt wie die Art `orbit` gerechnet (Achse ⊥ Fingerbewegung, z = 0, Körper folgt dem
   Finger), mit einer Rate, die am Rand stetig an die Griff-Steigung GRAB_EDGE · ε · (rad/px)
   anschließt und weich auf `orbitRate` abklingt — kein Sprung in der Drehung je Pixel.
   **Inhaberentscheidung:** Der Griffpunkt muss nach dem Zurückziehen nicht mehr unter dem Finger
   liegen. Die Tests „über den Rand hinaus und zurück" und „diesseits des Horizonts" entfallen
   deshalb bewusst.
2. **Zwei-Finger-Drehen:** Beim Pinch dreht die Winkeländerung der Verbindungslinie beider Finger
   das Bild um seine Mitte (Drehvektor (0, 0, Δφ), Vorzeichen so, dass das Bild den Fingern folgt).
   Als reine Funktion in `dragKernel.ts`. Totzone: erst ab 8° kumulierter Drehung seit
   Pinch-Beginn, danach 1:1 ohne Sprung. Zoom und Schwenk wie bisher. Der Wurf läuft über die
   vorhandene Fling-Aufzeichnung.

## Fertig, wenn

Offline-Test `tools/test-drag.ts`:

- Rand: Drehung je px stetig über den Rand (keine Stufe > 5 %), z = 0 außerhalb, Weiterdrehen
  auch 200 px hinter dem Rand, Grenze je px (≤ GRAB_EDGE · ε · rad/px) weiterhin eingehalten.
- Zwei-Finger-Drehen: Totzone, Vorzeichen, 1:1 danach, kein Sprung beim Einsetzen, reiner Pinch
  ohne Drehung ergibt z = 0.
- Alle übrigen Prüfungen aus Aufgabe 07 bleiben grün (ohne die zwei entfallenen).
- `npm run check` grün; die Gestenverdrahtung wächst nicht.

## Dateien

- `src/nav/dragKernel.ts` — Randprofil (`edgeTurn`), Zugteilung an der exakten Zone, `twistTurn`
- `src/camera/cameraTouch.ts` — verdrahtet das Drehen in den Pinch (153 Zeilen, nicht gewachsen)
- `tools/test-drag.ts` — Abschnitt 3b (Rand) und 9 (Zwei-Finger-Drehen)

Abweichung vom Auftrag: Er nannte `SpaceCamera.ts` (Ratsche 473). Seit Aufgabe 02 (v0.4.6) liegt die
Gestenverdrahtung in `cameraTouch.ts`; `SpaceCamera.ts` bleibt unverändert. Version: `main` stand
schon auf 0.4.6, daher 0.4.7 statt 0.4.5. Beides in Leitfaden §9 vermerkt.

## Lösung

- **Zug an der Grenze teilen.** Ein Zugschritt wird am Kreis der exakten Zone geteilt; innen gilt der
  exakte Griff, außen `edgeTurn`, die Teile werden als Quaternionen nacheinander angehängt. Ein Zug
  ganz innen ergibt bitgleich den bisherigen Griff.
- **Richtungsabhängiger Betrag.** Am Rand läuft der exakte Griff radial mit GRAB_EDGE · ε · cos² α
  je px, quer dazu nur mit sin θ / tan α (≈ ε). Eine einzige Rate spränge für schräge Züge um ×3–4 (radial ÷ quer, d = 3…15 R).
  Außen bleibt die Achse ⊥ zur Fingerbewegung, z = 0; der Betrag mischt beide Randwerte nach dem
  Winkel zwischen Zug und Radialrichtung und klingt mit `EDGE_FADE_PX` = 150 px auf `orbitRate` ab.
- **Stufe messen, nicht Krümmung.** Der exakte Griff ändert sich bei kleinen Scheiben (d = 15 R)
  schon von Pixel zu Pixel um ~20 % (d = 6 R: ~8 %). Die Stufe am Rand wird deshalb mit 0,01-px-Schritten beiderseits
  gemessen.
- **Drehen eingerastet.** `twistTurn` summiert die Winkeländerung (über ±π gefaltet); beim Erreichen
  von 8° wird nur der Überschuss gedreht, danach jede Änderung 1:1 in beide Richtungen. Pinch-Schwenk
  und Drehen gehen als ein Schritt in Kamera und Wurf.

## Nicht-Ziele

Knopf „Norden oben", automatische Nivellierung, Änderungen an Freiflug-Rate, Pinch-Zoom oder
Zwei-Finger-Schwenk.

## Auf dem Tablet prüfen

Siehe PR.
