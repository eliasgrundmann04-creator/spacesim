---
id: 13
titel: Fix — Kamera bleibt bei Zeitraffer über dem Anker (Mitführung über die Verschiebung)
status: offen
braucht: [12]
stufe: — (Fehler aus Stufe 1)
tablet: ja
---

## Ziel

Befund des Inhabers aus der Tablet-Prüfung (Demo-Pfad aus Aufgabe 02, versehentlich abgenommen): Nach
einem **manuellen** Anflug an den Mond (Freiflug) und Zeitraffer ×10⁶ bleibt die Kamera nicht über dem
Mond. Nach einem Anflug per Doppeltipp klappt es — der endet im Orbitmodus, der die Kamera direkt aus der
Zielposition ableitet.

**Ursache** (offline mit dem echten `Navigator` reproduziert; nicht durch Aufgabe 02 entstanden, besteht
seit v0.3): Im Freiflug führt der Navigator die Kamera über die *Geschwindigkeit* des Ankers mit —
`p += (v_rel + frameVelocity) · h` in `stepFlight`. Das ist ein Euler-Schritt auf der Bahn des Ankers.
Der Mond läuft aber auf einer gekrümmten Bahn (um die Erde, mit ihr um die Sonne), und bei ×10⁶ legt er
pro Frame 16 667 s Simzeit zurück. Die Kamera fliegt die Tangente, der Mond die Kurve. Der Fehler
½·a·(W·dt)² liegt bei 60 fps bei rund 1000 km **pro Frame** und zeigt im mitlaufenden System immer in
dieselbe Richtung, summiert sich also.

Gemessen (Kreisbahnen Sonne–Erde–Mond; bei ×1 zum Mond geflogen, losgelassen, dann 10 s Leerlauf mit
Assistenz bei ×10⁶): Die Höhe wächst von ~1,5 km auf 7,8·10⁸ m (120 fps) bzw. 2,1·10⁹ m (20 fps), der
Anker springt auf die Erde. Schon bei ×10³ driftet die Kamera um Hunderte Meter. Das Ergebnis hängt
zusätzlich von der Framerate ab.

Der bestehende Test „Anker wird bei Time-Warp mitgeführt" (`tools/test-nav.ts`) bewegt den Körper
**geradlinig** mit konstanter Geschwindigkeit. Dort ist Euler exakt, deshalb blieb der Fehler unsichtbar.

**Lösung:** Die Kamera wird über die *tatsächliche Verschiebung* des Ankers seit dem letzten Schritt
mitgeführt, nicht über seine Geschwindigkeit. Die Positionen kommen analytisch aus Kepler (§4.3); die
Differenz zweier Positionen ist exakt, bei jedem Warp und jeder Framerate. Die Ankergeschwindigkeit dient
danach nur noch der Weltgeschwindigkeit in der Ausgabe und der Trägheit beim Ankerwechsel.

## Fertig, wenn

Offline-Test `tools/test-warp.ts` (neu, in `npm test` eingehängt).

**Testszene:** Sonne fest im Ursprung, Erde auf Kreisbahn mit 1 AE, Mond auf Kreisbahn mit 384 400 km um
die Erde, beide analytisch in der Ekliptik. Geschwindigkeiten mit dem Warp multipliziert wie in
`Engine.collectBodies`. Pro Frame zuerst die Simzeit um `warp · dt` vorrücken, dann `nav.update` — dieselbe
Reihenfolge wie in `Engine.frame`. Jeder Fall startet mit einer zur *aktuellen* Körperposition passenden
Kameraposition und `nav.resetMotion(körper)` (siehe Verhalten).

- **Schweben:** Versatz (300 km, −200 km, R_Mond + 100 km) zum Mond, Leerlauf mit Assistenz, 10 s
  Realzeit. Für Warp ×1, ×10³, ×10⁶ und ×2,4·10⁸, jeweils bei 20, 60 und 120 fps: Der Versatz
  Kamera − Mond weicht in keinem Frame um mehr als 1 cm vom Startversatz ab.
  *(Prototyp: höchstens 0,3 mm bei ×2,4·10⁸, sonst ≤ 1 µm.)*
- **Gegenprobe** (AGENTS.md, Präzisionsaussage): dieselbe Szene auf dem bisherigen Weg — `stepFlight` mit
  `frameVelocity` = Mondgeschwindigkeit am Frameende — weicht bei ×10⁶ und 60 fps um mehr als 10⁶ m ab.
  *(Prototyp: 4,2·10⁸ m.)*
- **Relativflug unabhängig vom Warp:** Start 2·10⁷ m über dem Mond, Vollschub auf den Mond zu
  (`speedScale` 1) für 3 s. Die Lage relativ zum Mond nach 3 s weicht bei ×10⁶ von der bei ×1 um weniger
  als 10⁻⁹ der dann erreichten Höhe ab, je Framerate (20, 60, 120 fps). *(Prototyp: 1,4·10⁻¹³.)*
- **Der Tablet-Ablauf:** Start 6 Erdradien vor der Erde in Richtung Mond, `resetMotion(erde)`, Warp ×1.
  Vollschub mit `speedScale` 10, Blick jedes Frame auf den Mond, bis der Anker der Mond ist und die Höhe
  unter 5·10⁶ m liegt. Dann 5 s loslassen (Assistenz an). Dann Warp ×10⁶ und 10 s Leerlauf. Bei 20, 60
  und 120 fps gilt über diese 10 s: Der Anker bleibt in jedem Frame der Mond, und die Höhe wird nie größer
  als zu Beginn der Warp-Phase plus 1 m. *(Bisher: Anker springt auf die Erde, Höhe bis 10⁹ m.)*
- **Bestehende Tests unverändert grün**, insbesondere „Anker wird bei Time-Warp mitgeführt" und
  „Ankerwechsel schleudert nicht weg" (beide laufen über den Rückfallweg, siehe Verhalten). Kein
  bestehender Test wird angepasst.
- `npm run check` grün. `Navigator.ts` ≤ 300 Zeilen. `Engine.ts` wächst nicht (Ratsche 496).

## Verhalten

### Mitführung über die Verschiebung (im `Navigator`)

- **Neuer Zustand:** Merkpunkt `carry = { id, position } | null` — der Anker am Ende des letzten
  Navigator-Schritts und seine Position zu diesem Zeitpunkt.
- **Am Anfang von `updateFree`:** Ist ein Merkpunkt gesetzt und der Körper mit dieser `id` in `bodies`,
  dann gilt `start = frame.position + (körper.position − carry.position)`. Alles Weitere — Proximity,
  Rückführung der Stufe, `stepFlight` — rechnet mit `start`. `stepFlight` bekommt in diesem Fall
  `frameVelocity = (0, 0, 0)`: Die Mitführung ist schon geschehen, integriert wird nur noch die
  Relativbewegung.
- **Rückfallweg ohne Merkpunkt** (frischer Navigator, Körper entladen): unverändert wie bisher —
  `start = frame.position`, `stepFlight` mit `this.frameVelocity`. Dieser Weg hält die beiden
  bestehenden Tests grün.
- **Nach dem Schritt:** Merkpunkt = `step.proximity.anchor` mit seiner aktuellen Position (kein Anker ⇒
  `null`). In `updateGoto` ebenso mit `prox.anchor`, damit ein abgebrochener Anflug nahtlos im Freiflug
  weiterläuft.
- **Ausgabe:** `NavResult.velocity` = `relVelocity + frameVelocity`, `speed` = deren Betrag — dieselbe
  Bedeutung wie bisher, nur nicht mehr aus `step.worldVelocity` (die ist im neuen Weg = `relVelocity`).
- **Rahmengeschwindigkeit:** `trackFrameVelocity` läuft weiter wie bisher, einschließlich der Trägheit
  beim Ankerwechsel. Sie liefert nur nicht mehr die Positionsmitführung.

### Kontinuitätsbruch: Orbit → Freiflug

Im Orbitmodus ruft niemand den Navigator, der Merkpunkt veraltet. Außerdem steht die Kamera im ersten
Freiflug-Frame noch auf der Orbitposition des *letzten* Frames, während der Körper schon weitergerückt ist
— bei ×10⁶ um rund 5·10⁸ m.

- **`Navigator.resetMotion(anchor: BodyRef | null)`** (neu): Relativgeschwindigkeit auf 0,
  `lastAnchorId` und `lastAnchorPos` zurücksetzen, Merkpunkt = `anchor` mit seiner *aktuellen* Position.
- **`Engine.ts`:** Die beiden Aufrufe `this.navigator.setRelativeVelocity({ x: 0, y: 0, z: 0 })` beim
  Verlassen des Orbits (in `stepNavigation` und `setTarget`) werden zu
  `this.navigator.resetMotion(this.camera.target && this.bodyRef(this.camera.target))`. Zeile gegen
  Zeile, sonst keine Änderung. `setRelativeVelocity` bleibt für die Terrainkollision.
- **`SpaceCamera.enterFreeFlight()`:** Kommt die Kamera aus dem Orbit, wird sie *vor* dem Moduswechsel
  auf die Orbitposition relativ zur aktuellen Zielposition nachgezogen — `this.updatePlacement(0)` vor
  `this.mode = 'free'`. Mit `dt = 0` ändert sich die Zoomdistanz nicht. Damit passen Kameraposition und
  Merkpunkt im ersten Freiflug-Frame exakt zusammen.

## Dateien

- `src/nav/Navigator.ts` — Merkpunkt, Mitführung in `updateFree`, Merkpunkt in `updateGoto`,
  `resetMotion`.
- `src/nav/frameCarry.ts` (neu; three-frei, liegt unter `src/nav/` und ist damit schon in `THREE_FREE`) —
  `Navigator.ts` hat 293 Zeilen, mit der Mitführung wären es rund 320. Deshalb die Rahmenführung
  (`trackFrameVelocity`, `clampMagnitude`) hierher **verschieben, nicht umschreiben**: Funktionskörper
  wortgleich, nur `this.x` → Zustandsobjekt. Dazu die kleine Hilfsfunktion für die Mitführung.
- `src/camera/SpaceCamera.ts` — `enterFreeFlight()` zieht nach (wenige Zeilen).
- `src/core/Engine.ts` — genau die zwei Aufrufe ersetzen, sonst nichts.
- `tools/test-warp.ts` (neu), `package.json` (Skript `test:warp`, in `test` einhängen; Version).

Reicht diese Liste nicht, nach §12.2 abbrechen und berichten.

## Hinweise

- **Präzision (§4.1):** Die Verschiebung ist die Differenz zweier f64-Positionen bei ~1,5·10¹¹ m,
  Auflösung ~30 µm. Das reicht bis Stufe 2. Die saubere Lösung bleibt der Frame-Baum (Aufgaben 05/06);
  diese Mitführung ist seine Vorstufe und wird dort ersetzt. Nichts davon in f32.
- **Kein Integrator (§4.3):** Die Lösung benutzt die analytischen Positionen. Sie integriert die
  Ankerbahn *nicht* genauer — kein Runge-Kutta, kein Mittelpunktsverfahren für die Ankerbewegung.
- **Framerate, Pause, Warp-Wechsel:** keine Sonderbehandlung nötig. Die Mitführung hängt nur an
  Positionen, nicht an `dt`; bei Pause ist die Verschiebung 0, nach einem Warp-Wechsel die zum neuen Warp
  passende.
- **Testszene:** Mondbahn ω = √(µ / a³) mit µ ≈ 4,035·10¹⁴ m³/s² (Erde + Mond), Erdbahn ω = √(µ_Sonne / AE³).
  Startzeitpunkt beliebig, aber nicht t = 0 — sonst liegen alle Körper auf der x-Achse und verdecken
  Richtungsfehler. Die Szene ist three-frei (nur `src/nav/`), Kepler und `CelestialBody` werden nicht
  gebraucht.
- Der Selbsttest `verifyFrameTracking` in `Engine.ts` bleibt, wie er ist.

## Nicht-Ziele

- Den Mond bei ×10⁶ vom Erdorbit aus *einholen*. Er umrundet die Erde dann in ~2,4 s Realzeit — das ist
  Physik, kein Fehler.
- Änderungen an `stepFlight`, Goto, Gleitflug, Gesten oder dem automatischen Tempo (Aufgabe 12).
- Frame-Baum (Stufe 2).

## Auf dem Tablet prüfen

1. Start im Erdorbit, Zeitraffer ×1. Schubregler hoch, Stufe ×10, zum Mond fliegen, bis er groß im Bild
   ist. Loslassen ⇒ die Kamera bremst relativ zum Mond.
2. Zeitraffer schrittweise bis ×10⁶ ⇒ der Mond bleibt ruhig unter der Kamera, die Höhe im HUD bleibt
   stehen, oben links steht weiter „Mond". *Fehlerbild bisher:* Der Mond wandert aus dem Bild, die Höhe
   wächst, der Name springt auf „Erde".
3. Bei ×10⁶ kurz Schub geben und loslassen ⇒ fühlt sich an wie bei ×1, gleiches Tempo relativ zum Mond.
4. Zeitraffer zurück auf ×1, Doppeltipp auf den Mond (Anflug endet im Orbit). Zeitraffer ×10⁶, dann
   Schub ⇒ kein Sprung beim Übergang in den Freiflug, die Kamera fliegt vom Mond aus los.
5. Zur Erde zurück, bis auf wenige Meter Höhe hinunter, Zeitraffer ×10⁶ ⇒ der Boden steht still.
6. Doppeltipp auf die Sonne ⇒ Anflug wie bisher.

## Abschluss

- Leitfaden §2: unter Navigation ergänzen, dass die Kamera im Freiflug über die Verschiebung des Ankers
  mitgeführt wird (nicht über seine Geschwindigkeit).
- Leitfaden §9, Kanon-Kandidaten: *Bewegte Bezugskörper werden über ihre Positionsdifferenz mitgeführt,
  nie über v · dt — sonst ist es ein Euler-Schritt auf einer gekrümmten Bahn.* Dazu: Tests zur Mitführung
  brauchen gekrümmte Bahnen; geradlinige Bewegung beweist nichts.
- Leitfaden §11: v0.4.12.
- `package.json` Patch +1 (0.4.11 → 0.4.12).
