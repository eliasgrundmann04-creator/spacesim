---
id: 24
titel: Höhe über Grund — HUD, Flugtempo und Kontaktzeit messen ab dem Boden, nicht ab der Kugel
status: offen
braucht: [23]
stufe: 1 (Nachtrag Navigation)
tablet: ja
---

## Ziel

Befund aus dem Messlauf (Leitfaden §9, „Höhe im HUD ist die Höhe über der glatten Kugel"): In 2 m über
dem Landpunkt von Halt 3 zeigt das HUD **„789 m"** (787 m Gelände + 2 m). Die Navigation rechnet
überall `Abstand − Radius` ohne Terrain:

- `evaluateProximity` (`src/nav/proximity.ts:62`) liefert diese Höhe an HUD, Near-Plane und Pinch und
  macht daraus die Referenzhöhe, aus der das **Flugtempo** folgt.
- `contactCap` (`src/nav/autoPace.ts:44`) und der Anflugdeckel in `stepFlight`
  (`src/nav/flightKernel.ts:182`) rechnen die **Kontaktzeit** gegen die Kugel.

Folge: Dicht über Hochland fliegt man so schnell, als wäre man hunderte Meter hoch, und der
Kontaktzeit-Begrenzer bremst gegen einen Boden, der in Wirklichkeit höher liegt. Die Kamera schlägt
dann hart auf `clampToSurface` auf. Nach dieser Aufgabe zählen HUD, Tempo und Kontaktzeit ab dem
Boden unter der Kamera. Über dem Meer ist das die Meeresoberfläche.

## Fertig, wenn

Offline-Test `tools/test-ground.ts` (neu, in `npm test` eingehängt) mit erdähnlichem `TerrainField`
(Katalogwerte der Erde, wie in `tools/test-bench.ts`) zeigt mit Zahlenwert:

1. **HUD-Höhe.** Kamera 2 m über dem Landpunkt von Halt 3 (`BENCH_LAND_DIR`): `evaluateProximity`
   liefert 2 m ± 0,01 m. *Gegenprobe* ohne Bodenhöhe: 789 m.
2. **Tempo.** 1 s Vollschub waagerecht, 2 m über dem Hochland, bei 20, 60 und 120 fps; die Bodenhöhe
   wird jeden Frame neu bestimmt, wie in `Engine`. Die erreichte Geschwindigkeit liegt innerhalb ± 10 %
   derselben Rechnung 2 m über dem Meer. *Gegenprobe* ohne Bodenhöhe: mindestens 10× schneller.
3. **Kontaktzeit.** Sinkflug mit Vollschub senkrecht auf das Hochland, Start 200 m über Grund, bei 20,
   60 und 120 fps: Bei 10 m über Grund ist die Sinkgeschwindigkeit ≤ 10 m / `ttcMin` + 5 %.
   *Gegenprobe* ohne Bodenhöhe: deutlich darüber (Zahl im PR).
4. **Kosten.** Bodenhöhe für alle Körper innerhalb von 10 Radien, in der Szene Erde und Mond: im
   Mittel über 1000 Frames < 0,05 ms pro Frame.
5. **Unverändert, wo kein Boden ist:** Körper ohne Terrain (Sterne, Gasriesen) und Körper weiter als
   10 Radien liefern exakt dieselben Werte wie bisher. Alle bestehenden Tests bleiben unverändert grün.
6. `npm run check` grün.

## Verhalten

- **Ein Ort, an dem der Boden in die Navigation kommt:** `EngineInput.collectBodies` gibt für jeden
  Körper innerhalb von 10 Radien als `BodyRef.radius` den **Oberflächenradius in Richtung der
  Kamera**: Radius plus `getSurfaceOffset(Richtung Körper → Kamera)`, Richtung in f64 aus der
  Positionsdifferenz. Weiter entfernte Körper behalten den mittleren Radius. Der Navigationskern
  rechnet damit unverändert. `proximity`, `autoPace` und `flightKernel` werden nicht angefasst.
- **Reiner Kern dafür:** eine three-freie Funktion in `src/nav/proximity.ts` (z. B.
  `surfaceRadius(position, center, radius, height)`; `height` bekommt eine Einheitsrichtung und
  liefert Meter). Die Grenze von 10 Radien steht ebenfalls dort. Der Test benutzt dieselbe Funktion
  mit `TerrainField.height`, der Adapter mit `getSurfaceOffset`.
- **`BodyRef.radius` neu dokumentieren** (`src/nav/types.ts`): „Oberflächenradius in Richtung der
  Kamera, falls der Adapter ihn kennt; sonst mittlerer Radius." Damit ist die neue Bedeutung kein
  stilles Umdeuten.
- **HUD im Orbitmodus:** `SpaceCamera.altitude` rechnet im Orbit ebenfalls ab dem Boden
  (`distance − radius − getSurfaceOffset(radial)`, so wie `placeOrbit` den Mindestabstand schon heute
  bestimmt). Im Freiflug kommt die Höhe bereits aus dem Navigator.
- `EngineInput.bodyRef` (Goto, `resetMotion`) bleibt beim mittleren Radius. Ein Goto endet in
  `frameFactor` Radien Abstand, dort spielt Terrain keine Rolle.

## Dateien

- `src/nav/proximity.ts` — Funktion `surfaceRadius` und die Grenze von 10 Radien (three-frei)
- `src/nav/types.ts` — Doku von `BodyRef.radius`
- `src/core/EngineInput.ts` — `collectBodies` füllt den Oberflächenradius
- `src/camera/SpaceCamera.ts` — `altitude` im Orbitmodus über Grund
- `tools/test-ground.ts` — neu
- `package.json` — Skript `test:ground`, in `test` einhängen; Version: nächste Patch-Nummer

## Hinweise

- **Präzision (§4.1):** Richtung als f64-Differenz Kamera − Körperzentrum, erst danach normieren. Nichts
  davon in f32. `getSurfaceOffset` nimmt ein `THREE.Vector3`: in `EngineInput` einen Scratch-Vektor
  wiederverwenden, keine Allokation pro Frame.
- **Ozean:** `TerrainField.height` klemmt auf den Meeresspiegel. Über dem Meer ist die Höhe also die
  Höhe über der Wasseroberfläche. Das ist gewollt; `rawHeight` nicht benutzen.
- **Picking** (`nav/picking.ts`) benutzt `radius` für die Winkelgröße beim Antippen. Der Unterschied
  liegt unter 0,1 % und betrifft nur nahe Körper, das ist unkritisch und im PR zu erwähnen.
- **Bodenhöhe pro Frame:** Innerhalb eines Frames gilt sie für die Startposition des
  Navigationsschritts. Der Boden ändert sich in einem Frame um höchstens Fluggeschwindigkeit × dt ×
  Hangneigung. Die harte Untergrenze bleibt `clampToSurface` in `Engine` und ist damit konsistent.
- Kein Integrator: Tests 2 und 3 laufen über den echten `stepFlight`, mit `BodyRef`s, die der Test pro
  Frame wie `collectBodies` füllt.
- `SpaceCamera.ts` ist offline nicht ladbar (three, siehe Leitfaden §9 „Parameter-Properties").
  Die Orbit-Höhe ist deshalb nur auf dem Tablet prüfbar (Schritt 3).

## Nicht-Ziele

Höhe über Grund für Goto-Ziele, Kollision gegen die *gezeichnete* statt die berechnete Oberfläche
(hängt an Aufgabe 23), Atmosphäre, neue HUD-Felder.

## Auf dem Tablet prüfen

1. Vorschau mit `?bench`: Bei Halt 3 zeigt das HUD **„Höhe 2.00 m"** (vorher 789 m), bei Halt 4 etwa
   10 km. *Fehlerbild:* weiterhin 789 m oder ein negativer Wert.
2. Ohne `?bench` im Freiflug dicht über ein Gebirge und danach dicht über das Meer fliegen, jeweils mit
   derselben Schubstufe. Das Tempo fühlt sich in gleicher Höhe über Grund gleich an. Beim Sinkflug
   auf einen Berg bremst die Kamera weich ab, statt hart aufzusetzen.
3. Im Orbitmodus nah an einen Berg zoomen. Die Höhe im HUD nimmt beim Überfliegen des Gipfels ab,
   statt konstant zu bleiben.
4. Messlauf `?bench` kopieren und als PR-Kommentar einfügen. Der Agent trägt die Zeile in
   `docs/leistung.md` ein; die Zeitwerte sollten sich gegenüber der Vorzeile nicht verändern.

## Abschluss

- Leitfaden §2: Navigation unter „Vorhanden" um „Höhe, Tempo und Kontaktzeit über Grund" ergänzen.
- Leitfaden §9: Befund „Höhe im HUD …" als erledigt markieren (mit Version).
- Leitfaden §11: neue Zeile mit der Version.
