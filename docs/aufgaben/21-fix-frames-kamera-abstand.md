---
id: 21
titel: Fix — nach Stufe 2c rechnen Körper ihren Kameraabstand im falschen Bezugsrahmen
status: erledigt
braucht: [06]
stufe: — (Fehler aus Stufe 2c)
tablet: ja
---

## Ziel

Befund des Inhabers nach dem Merge von Aufgabe 06 (v0.5.0): Die Warteschlange steht sofort auf 96, die
App läuft mit ~12 fps, das Tablet wird warm, keine Aktion funktioniert mehr.

**Ursache** (offline mit den echten Klassen aus `main` reproduziert): Seit 2c liegt jeder Planet und
jeder Stern in seinem **eigenen** Frame, `body.position` ist dort (0, 0, 0). Zwei Stellen vergleichen
diese Position aber weiter direkt mit der Kameraposition, die im **Kameraframe** steht:

1. **`UniverseManager.update`** — `cameraPos.distanceTo(star.position) < POPULATE_DISTANCE`. Die
   Kamera liegt in ihrem Frame nahe am Ursprung, `star.position` ist (0, 0, 0) ⇒ jeder prozedurale
   Stern gilt als nah. Gemessen: **80 von 80** Nachbarsystemen werden im ersten Frame bevölkert,
   447 Körper statt 87 (Sonnensystem plus 80 Sterne als Lichtpunkte).
2. **`SceneManager.syncToCamera`** reicht `cameraWorldPos` unverändert an `body.update` weiter. Dort
   bilden `Planet.update` (Abstand für den LOD-Quadtree) und `Star.update` (Glowgröße und -deckkraft)
   `cameraPos − this.position`. Gemessen mit der Kamera 3 Erdradien vor der Erde: Venus, Mars und Mond
   „sehen" die Kamera alle in 1,91·10⁷ m statt in 7,85·10¹⁰ m, 2,25·10¹¹ m bzw. 3,97·10⁸ m.
   **285 von 285** Gesteinsplaneten verfeinern ihr Terrain, als schwebte die Kamera über ihnen.
   Alle Sternglows rechnen mit demselben falschen Abstand.

Die Render-Positionen selbst sind korrekt (`syncToCamera` rechnet sie über `transformPoint`). Nur die
Abstände, die *in* den Körpern entstehen, sind falsch.

## Fertig, wenn

Offline-Test `tools/test-frame-distance.ts` (neu, in `npm test` eingehängt). Die Szene baut den
Frame-Baum wie `UniverseManager` mit `createFrame`/`attachFrame` nach: Sonnensystem-Frame im Ursprung,
Planeten- und Mondframes darin, 80 Sternframes an geseedeten Positionen im 16-Lj-Umkreis.

1. **Bevölkern.** Kamera im Erdframe, 3 Erdradien vom Zentrum: 0 prozedurale Systeme gelten als nah.
   Kamera 0,2 Lj vor einem `PSC-*`-Stern (einmal im Galaxie-, einmal im Sternframe): genau dieses eine.
2. **Abstand im Körper.** Die Kameraposition, die ein Körper bekommt, ist die Kamera *in seinem Frame*.
   Für Erde, Mond, Venus und Mars stimmt der Abstand mit dem echten Abstand überein (relativer Fehler
   < 10⁻⁹).
3. **Gegenprobe:** der bisherige Weg (Kameraposition ohne Umrechnung) liefert in derselben Szene
   80 nahe Systeme und für Venus 1,91·10⁷ m.
4. **Ohne Kameraframe** (erster Aufruf in `Engine.init`, bevor die Kamera einen Frame hat): die Kamera
   gilt als im Universumsframe; kein prozedurales System gilt als nah.
5. `npm run check` grün.

## Verhalten

- **Kern in `src/frames/`** (three-frei, schon in `THREE_FREE`): eine kleine Funktion, die einen Punkt
  aus dem Kameraframe in den Frame eines Körpers abbildet bzw. den Abstand über Frames bildet — auf
  `transformPoint` aufgebaut, nicht neu gerechnet.
- **`SceneManager.syncToCamera`:** jedem Körper die Kameraposition *in seinem Frame* übergeben. Sie
  folgt ohne zweite Umrechnung aus dem schon gebildeten Versatz: Kamera im Körperframe =
  `body.position − (bodyInCamFrame − cameraWorldPos)`. `Planet` und `Star` bleiben unverändert.
- **`UniverseManager.update(simTime, cameraPos, cameraFrame)`:** Bevölkern nach dem Abstand über
  Frames. `Engine` übergibt `camera.frame` (eine Zeile, beide Aufrufe).

## Dateien

- `src/frames/` — neue Funktion (eigene kleine Datei oder in `FrameTree.ts`)
- `src/core/SceneManager.ts` — Kameraposition im Körperframe an `body.update`
- `src/universe/UniverseManager.ts` — Bevölkern über Frames
- `src/core/Engine.ts` — `camera.frame` an `universe.update` übergeben, sonst nichts
- `tools/test-frame-distance.ts` — neu
- `package.json` — Skript `test:frame-distance`, in `test` einhängen; Version: nächste Patch-Nummer

Reicht diese Liste nicht, nach §12.2 abbrechen und berichten.

## Hinweise

- **Präzision (§4.1):** Der Abstand zu einem fernen Stern (bis 16 Lj) entsteht über `transformPoint`
  mit Ablösung am gemeinsamen Vorfahren — nicht über absolute Koordinaten.
- `UniverseManager`, `Planet` und `PlanetLOD` sind offline nicht ladbar (Parameter-Properties, JSON-Import,
  §9). Deshalb prüft der Test den Kern mit nachgebautem Frame-Baum; die Verdrahtung prüft das Tablet.
- **Bestand:** Weitere Stellen mit demselben Muster (`body.position` gegen eine Kameragröße ohne
  Umrechnung) suchen und im PR auflisten. Liegen sie außerhalb der Dateiliste: nicht anfassen, als
  Befund in Leitfaden §9.
- Aufgefallen, aber nicht Teil dieser Aufgabe: Planeten mit eigenem Frame haben jetzt `velocity = 0`,
  `BodyRef.velocity` an den Navigator ist für sie also null. Prüfen, ob die Ankerträgheit beim
  Ankerwechsel (`trackFrameVelocity`) davon betroffen ist, und als Befund in §9 notieren.

## Nicht-Ziele

Performance-Arbeit (Aufgaben 14–19), Entladen von Systemen (Aufgabe 20), Änderungen an `Planet`,
`Star`, `PlanetLOD` oder am Frame-Wechsel der Kamera.

## Auf dem Tablet prüfen

1. Vorschau öffnen, Erde im Orbit. HUD: Die Queue fällt nach dem Start innerhalb weniger Sekunden auf
   0 oder einstellige Werte, fps wie vor v0.5.0 (vorher: Queue sofort 96, ~12 fps).
2. Doppeltipp auf den Mond, Anflug, Doppeltipp zurück zur Erde: alles reagiert.
3. Herauszoomen, bis die Nachbarsterne als Lichtpunkte erscheinen: Sie sind sichtbar wie vor v0.5.0.
   *Fehlerbild:* keine Sternpunkte oder riesige Glows.
4. Doppeltipp auf einen `PSC-*`-Stern und anfliegen: Erst in der Nähe erscheinen seine Planeten; einen
   Gesteinsplaneten fokussieren, bis auf wenige Meter hinunter — der Boden lädt nach und steht ruhig.
5. Das Tablet bleibt bei ruhigem Orbit nach ein paar Minuten kühl.

## Abschluss

- Leitfaden §11: neue Zeile mit der Version, „Fix nach Stufe 2c".
- Leitfaden §9: Befund *Ein Abstand zwischen zwei Größen ist nur gültig, wenn beide im selben Frame
  stehen — jeder Vergleich mit `body.position` braucht den Frame des Körpers.* Als Kanon-Kandidat
  vormerken.
