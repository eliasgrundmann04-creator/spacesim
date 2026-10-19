---
id: 10
titel: Gleitflug — Pinch ist Schub, die Bewegung gleitet weiter
status: offen
braucht: [09]
stufe: —
tablet: ja
---

## Ziel

Rückmeldung des Inhabers vom Tablet: Die Steuerung fühlt sich noch nicht nach Fliegen an. Gewünscht ist
ein Modus ohne Schubregler, der sich weich und zusammenhängend fliegt wie ein Flugzeug.

1. **Pinch ist Schub.** Auseinanderziehen beschleunigt vorwärts, Zusammenziehen bremst und fährt erst
   danach rückwärts. Nach dem Loslassen stoppt die Bewegung nicht abrupt, sondern gleitet weiter und
   klingt langsam ab.
2. **Flugrichtung folgt dem Blick verzögert.** Wer beim Gleiten mit einem Finger dreht, zieht eine
   geschwungene Kurve statt seitlich zu rutschen oder schlagartig umzuschwenken.

Der Modus ist per `?feel=glide:1` aktiv. Ohne ihn bleibt alles bitgenau wie bisher (Pinch-Zoom,
Zwei-Finger-Schwenk, Schubregler).

## Fertig, wenn

Offline-Test `tools/test-glide.ts` (neu, in `npm test` eingehängt):

- **Ruhe:** Ohne Geste liefert der Gleitkern über 10 s ein Kommando mit `forward = right = up = 0`
  (bitgenau). Ohne `glide:1` ist die Eingabe an den Navigator identisch zur bisherigen.
- **Aufteilung:** Spreizen um Faktor 2 in einem Ereignis ergibt dasselbe `s` wie in 50 Ereignissen
  (< 1e-9). Gilt auch für das Bremsen bis kurz vor null.
- **Bremsraste:** `s = 1`, Zusammenziehen um Faktor 10 in *einer* Geste ⇒ `s = 0`, nicht negativ.
  Eine neue Geste aus der Ruhe fährt rückwärts. Spiegelbildlich: Rückwärtsfahrt, Spreizen um Faktor 10
  ⇒ `s = 0`, nicht positiv.
- **Halbwertszeit:** Nach `glideHalfLife` ohne Eingabe gilt `s = s₀/2` (± 1e-9), bei 20, 30, 60 und
  120 fps identisch.
- **Kopplung:** Nach einem 90°-Sprung der Blickrichtung ist der Restwinkel zwischen Flugrichtung und Blick
  nach `3 · glideCoupleTau` gleich `90° · e⁻³` (± 1 %), bei allen vier Frameraten. Bei Rückwärtsfahrt
  läuft die Flugrichtung auf `−forward`.
- **Deckel:** 1000 Spreizgesten hintereinander ⇒ immer `s ≤ glideMax`; rückwärts immer
  `|s| ≤ glideMaxBack`.
- **Flug-Szenario** (Gleitkern + `Navigator` aus `nav/`, ein ruhender Körper mit Erdradius): Start in
  2 m Höhe mit Blick senkrecht nach oben, alle 2 s eine Spreizgeste um Faktor 3. Die Höhe 1,9e8 m wird bei
  20, 60 und 120 fps erreicht, die Ankunftszeiten weichen um < 2 % voneinander ab.
- **Feel:** `parseFeel('?feel=glide:1,glideHalfLife:8')` setzt genau diese zwei Werte; Bereiche werden
  geklemmt wie bei den bestehenden Schlüsseln.
- Alle bestehenden Tests bleiben unverändert grün. `npm run check` grün. `Engine.ts` wächst nicht
  (Ratsche 496).

## Verhalten

**Zustand** im Gleitkern: signierte Geschwindigkeit `s` in **Referenzhöhen pro Sekunde** (skalenfrei,
dieselbe Einheit wie `rate · speedScale` in `flightKernel.ts`) und eine Flugrichtung `u` (Einheitsvektor,
Welt). Der Kern weiß nichts von Metern und kennt die Referenzhöhe nicht.

**Pinch.** Pro Pointer-Ereignis `λ = ln(d_jetzt / d_vorher)` aus dem Fingerabstand.
- Beim Gestenbeginn merkt sich der Kern die Fahrtrichtung `σ₀ = sign(s)` (0, wenn `|s| < ε`).
- `λ` in Fahrtrichtung beschleunigt: `s += glideGain · λ`.
- `λ` gegen die Fahrtrichtung bremst: `s += glideBrake · λ`.
- Während einer Geste darf `s` nie das Vorzeichen `−σ₀` annehmen; beim Erreichen wird auf 0 geklemmt
  (Bremsraste). Aus der Ruhe (`σ₀ = 0`) gibt die erste Richtung das Vorzeichen vor.
- Beim Wechsel von `s = 0` auf `s ≠ 0` springt `u` auf `±forward`, je nach Vorzeichen.

**Gleiten.** Pro Frame über **`dtReal`**: `s ← s · exp(−dt · ln2 / glideHalfLife)`; `|s| < ε` ⇒ `s = 0`.
Exakte Exponentialform, damit die Halbwertszeit framerate-unabhängig ist.

**Kopplung.** `u` dreht auf `sign(s) · forward` zu; der Winkel schrumpft pro Schritt um den Faktor
`exp(−dt / glideCoupleTau)`. Rotation um die gemeinsame Achse (kürzeste Drehung), keine Euler-Winkel.

**Ausgabe.** Der Kern erzeugt pro Frame ein `NavInput` für den bestehenden Navigator:
`forward/right/up` = Komponenten von `u` in der Kamerabasis, `speedScale = |s| / DEFAULT_FLIGHT.rate`,
`assist = true`. Damit laufen Substeps, Deckel pro Sekunde, Ankerwechsel und Terrainkollision
unverändert durch `stepFlight` — der Gleitkern ersetzt nur den Schubregler als Kommandoquelle.
Bei `s = 0` ist das Kommando null, und die vorhandene Assistenz dämpft den Rest weich aus.

**Gesten im Gleit-Modus** (`FEEL.glide ≥ 0,5`):
- Zwei Finger: Abstandsänderung ⇒ Gleitkern statt `zoomBy`, **in beiden Kameramodi**. Aus dem Orbit
  heraus startet Schub den Freiflug über den vorhandenen Übergang in `Engine.stepNavigation`
  (`input.forward > THRUST_EPSILON`), so wie heute der Schubregler.
- Zwei-Finger-Schwenk ist aus. **Zwei-Finger-Drehen bleibt** — im Gleit-Modus ist das die Rollachse.
  Pinch-Sperre und Dominanzprüfung aus Aufgabe 09 gelten unverändert.
- Ein Finger, Wurf und Nachlauf: unverändert.
- Ein laufendes Goto bricht ab, sobald Schub kommt — über den vorhandenen Abbruch im Navigator.
- `focus` und `enterOrbit` setzen den Gleitkern zurück (wie `fling.stop()`).

Mausrad, Zoom-Knöpfe und Schubregler bleiben bedienbar. Benutzt jemand den Schubregler, während der
Gleitkern läuft, gewinnt der Regler (`|forward| > THRUST_EPSILON` im Regler-Input) und der Gleitkern
wird zurückgesetzt.

## Startwerte in `feel.ts`

| Schlüssel | Standard | Bereich | Wirkung |
|---|---|---|---|
| `glide` | 0 | 0–1 | ≥ 0,5 schaltet den Gleit-Modus ein |
| `glideGain` | 0,8 | 0,05–10 | h/s je ln-Einheit Spreizung |
| `glideBrake` | 1,6 | 0,05–20 | h/s je ln-Einheit beim Bremsen |
| `glideMax` | 3 | 0,1–90 | Höchstgeschwindigkeit vorwärts in h/s |
| `glideMaxBack` | 0,5 | 0–10 | Höchstgeschwindigkeit rückwärts in h/s |
| `glideHalfLife` | 5 | 0,3–60 | Halbwertszeit des Gleitens in s |
| `glideCoupleTau` | 0,5 | 0,02–5 | Zeitkonstante, mit der die Flugrichtung dem Blick folgt, in s |

`ε = 0,01 h/s` ist eine Konstante im Kern, kein URL-Wert.

## Dateien

- `src/nav/glide.ts` (neu, three-frei, DOM-frei) — Klasse `Glide`: `begin()`, `pinch(λ)`, `end()`,
  `reset()`, `step(dt, basis, base: NavInput): NavInput`. Liegt unter `src/nav/`, ist damit schon in
  `THREE_FREE`.
- `src/nav/feel.ts` — die sieben Schlüssel oben in `FeelConfig`, `FEEL_RANGES`, `DEFAULT_FEEL`.
- `src/camera/cameraTouch.ts` — hält `readonly glide = new Glide()` neben `fling`; `beginPinch`,
  `updatePinch` und `release` leiten im Gleit-Modus an den Kern, statt zu zoomen und zu schwenken.
- `src/camera/SpaceCamera.ts` — `navInput(base: NavInput, dt: number): NavInput` reicht an
  `touchInput.glide.step(dt, this.basis(), base)` durch; `focus`/`enterOrbit` rufen `glide.reset()`.
- `src/core/Engine.ts` — **genau eine Zeile**: in `stepNavigation`
  `const input = this.flightControls.input;` → `const input = this.camera.navInput(this.flightControls.input, dt);`
- `tools/test-glide.ts` (neu) und `package.json` (Skript `test:glide`, Version).

`FlightControls.ts` bleibt unverändert, der Schubregler ist also weiter sichtbar. Ausblenden und
Entfernen kommen in einer Folgeaufgabe, wenn der Gleit-Modus Standard wird.

Reicht diese Liste nicht — insbesondere, wenn `Engine.ts` mehr als die eine Zeile braucht —, nach §12.2
abbrechen und berichten.

## Hinweise

- **Realzeit.** `dt` in `stepNavigation` ist Realzeit. Der Gleitkern darf `dtSim` nie sehen, sonst
  beschleunigt Time-Warp den Flug (Selbsttest `verifyFrameTracking`).
- **Kein Dolly im Gleit-Modus.** `applyDolly` versetzt die Position direkt, statt eine Geschwindigkeit
  zu setzen. Im Gleit-Modus darf `pendingDolly` durch Pinch nicht mehr verändert werden, sonst wirken
  beide gleichzeitig.
- **Doppelte Glättung ist gewollt.** `stepFlight` relaxiert die Geschwindigkeit zusätzlich mit
  `accelTau = 0,28 s` auf das Kommando. Das ergibt einen weichen Einsatz; `glideCoupleTau` regelt
  nur die Richtung.
- **Skalenfreiheit** kommt aus der Einheit h/s: Beim Anflug auf eine Oberfläche sinkt die Absolut-
  geschwindigkeit von selbst, beim Wegfliegen steigt sie. Der Gleitkern rechnet nie in Metern.
- **Kanon.** Alles, was pro Ereignis begrenzt wird, ist zusätzlich absolut begrenzt (`glideMax`);
  der Deckel pro Sekunde in `stepFlight` bleibt bestehen.

## Nicht-Ziele

Schräglegen in Kurven, Lagesteuerung über die Tablet-Sensoren, Gleit-Modus als Standard, Ausblenden oder
Entfernen des Schubreglers, Übernahme der Goto-Übergabegeschwindigkeit in `s`, Bezugsrahmen (Stufe 2b).

## Auf dem Tablet prüfen

Vorschau mit `?feel=glide:1` öffnen. Die Kamera startet im Orbit um die Erde.

1. Zwei Finger auseinanderziehen ⇒ die Kamera fliegt auf die Erde zu, der Orbit-Modus wird verlassen.
   Nach dem Loslassen gleitet sie weiter und wird über mehrere Sekunden langsamer.
2. Mehrmals hintereinander spreizen ⇒ die Geschwindigkeit stapelt sich.
3. Während der Fahrt zusammenziehen ⇒ Bremsen bis zum Stillstand, kein Rückwärtsfahren in derselben Geste.
   Neue Zusammenzieh-Geste ⇒ rückwärts.
4. Während des Gleitens mit einem Finger drehen ⇒ die Flugrichtung schwenkt weich nach, die Bahn ist
   sichtbar geschwungen.
5. Bewusst mit zwei Fingern drehen ⇒ das Bild rollt; beim reinen Spreizen rollt nichts.
6. Von der Oberfläche aus nur mit Spreizen und Ein-Finger-Drehen zum Mond fliegen, ohne Schubregler
   und ohne Doppeltipp.
7. Ohne `?feel=glide:1` ⇒ alles wie vorher: Pinch zoomt, zwei Finger schwenken.
8. `?feel=glide:1,glideHalfLife:12,glideCoupleTau:1.2` ⇒ längeres Gleiten, trägere Kurven, spürbar
   anders.

## Abschluss

- `docs/aufgaben/README.md`: Zeile 10 in der Reihenfolge-Tabelle (braucht 09, tablet ja).
- Leitfaden §2 (Navigation: Gleit-Modus hinter `?feel=glide:1`) und §11 (v0.4.9).
- `package.json` Patch +1 (0.4.8 → 0.4.9).
