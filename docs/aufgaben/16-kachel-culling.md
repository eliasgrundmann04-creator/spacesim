---
id: 16
titel: Nebenspur B3 — Frustum- und Horizont-Culling für Kacheln
status: offen
braucht: [22]
stufe: B (Performance & Tablet)
tablet: ja
---

## Ziel

Leitfaden §7, Nebenspur B: *Frustum-Culling für Kacheln.*

three verwirft Meshes außerhalb des Sichtkegels schon beim Zeichnen. Der Quadtree weiß davon aber
nichts: `QuadtreeTile.update` verfeinert nach Distanz in **alle** Richtungen (nur die abgewandte
Hemisphäre ist grob ausgenommen). Bei 2 m Höhe entstehen so Kacheln der Stufe 14 auch hinter der
Kamera — sie kosten Worker-Zeit, Warteschlangenplätze, Speicher und Upload, ohne je sichtbar zu sein.
Zusätzlich zeichnet three Kacheln, die zwar im Sichtkegel, aber hinter dem Planetenhorizont liegen.

Nach dieser Aufgabe verfeinert der Quadtree nur, was im (etwas erweiterten) Sichtkegel und vor dem
Horizont liegt, und Kacheln hinter dem Horizont werden nicht gezeichnet.

## Fertig, wenn

Offline-Test `tools/test-cull.ts` (neu, in `npm test` eingehängt) zeigt mit Zahlenwert:

1. **Konservativ — nichts Sichtbares fehlt.** Für ≥ 10⁴ Prüfungen (Kameras von 2 m bis 10⁷ m Höhe,
   zufällige, aber geseedete Blickrichtungen, FOV 55°, Seitenverhältnis 4:3 und 3:4, Kacheln der Stufen
   0–12): Wird eine Kachel verworfen, liegt **keiner** ihrer echten Vertices (`assembleTile` mit einem
   erdähnlichen `TerrainField`) im *unerweiterten* Sichtkegel und zugleich vor dem Horizont.
   0 Verstöße.
2. **Hüllkugel trägt.** Die Hüllkugel, die eine Kachel *vor* ihrer Geometrie kennt, enthält in denselben
   Fällen alle Vertices dieser Kachel, Skirts eingeschlossen.
3. **Wirkung.** Mit derselben Split-Regel wie `PlanetLOD` (aus dem Kern exportiert, siehe Verhalten):
   bei 2 m Höhe mit Blick zum Horizont mindestens 40 % weniger Blattkacheln als ohne Culling
   *(Prototyp: 2064 → 855, −59 %)*; bei 1000 km mit Blick 30° unter den Horizont ebenfalls ≥ 40 %
   *(Prototyp: −58 %)*; aus 1000 km Höhe senkrecht nach unten nie mehr als ohne.
4. **Kosten.** Sichtprüfung für 3000 Kacheln < 0,3 ms (Mittel über 100 Läufe, Zahl im PR).
5. `npm run check` grün, `PlanetLOD.ts` ≤ 300 Zeilen.

## Verhalten

- **Kern `src/perf/tileCull.ts`** (neu, three-frei):
  - Sichtkegel aus Kamerabasis (`forward`, `right`, `up`), `fovY` und Seitenverhältnis, mit Rand
    `marginDeg` (Standard 10°): Wer schnell dreht, sieht zuerst grobe, aber vorhandene Kacheln.
  - Kugel-gegen-Sichtkegel und Kugel-hinter-Horizont, beide konservativ. Horizont gegen die
    *kleinste* mögliche Oberfläche (Radius minus größte mögliche Tiefe aus den Terrainparametern).
  - Die Split-Regel aus `QuadtreeTile.update` (Stufe, `SPLIT_FACTOR`, Rückseiten-Guard) als exportierte
    Funktion, damit Test und `PlanetLOD` dieselbe Regel benutzen. Wortgleich verschieben, dann den
    Culling-Term ergänzen. *Nachtrag v0.4.19:* Aufgabe 23 legt die Regel schon in
    `src/terrain/lodKernel.ts` — dort ergänzen statt ein zweites Mal verschieben.
- **Verfeinern:** Eine Kachel wird nur gesplittet, wenn die bisherige Regel es will **und** ihre
  Hüllkugel im erweiterten Sichtkegel und vor dem Horizont liegt.
- **Nicht zusammenlegen wegen Culling:** Vorhandene Kinder bleiben, wenn sie aus dem Blick geraten;
  zusammengelegt wird weiter nur nach Distanz (`MERGE_FACTOR`). Speicher regelt Aufgabe 19.
- **Abdeckung bleibt:** Kacheln außerhalb des Blicks fordern ihre eigene Geometrie weiter an — mit
  vierfacher Distanz als Priorität, damit Sichtbares zuerst kommt. So bleibt beim Umdrehen kein Loch.
- **Zeichnen:** Eine fertige Kachel, die ganz hinter dem Horizont liegt, bekommt `mesh.visible = false`,
  gilt für die Übergangsregel aus §4.5 aber weiter als *fertig*. „Fertig" und „gezeichnet" sind zwei
  verschiedene Dinge — sonst blieben Elternkacheln stehen, deren Kinder nur verdeckt sind.
- **Hüllkugel vor der Geometrie:** aus Mittelpunkt, den vier Ecken (`surfacePoint`), Höhenspanne und
  Skirt-Tiefe, einmal im Konstruktor.
- **Sicht an `PlanetLOD`:** statisch, `PlanetLOD.setView(view)` einmal pro Frame aus `Engine` vor
  `syncToCamera`. Die Richtungen gelten unverändert planet-lokal (Frames rotieren nicht, §6).
- **A/B-Schalter:** `?cull=0` schaltet das Culling ab (für den Messlauf-Vergleich).

## Dateien

- `src/perf/tileCull.ts` — neu, three-frei
- `src/terrain/PlanetLOD.ts` — Split-Regel aus dem Kern, Hüllkugel, Priorität, Horizont beim Zeichnen
- `src/core/Engine.ts` — Sicht einmal pro Frame setzen (wenige Zeilen)
- `tools/test-cull.ts` — neu
- `package.json` — Skript `test:cull`, in `test` einhängen; Version: nächste Patch-Nummer

## Hinweise

- `PlanetLOD.ts` lädt three und ist nicht offline testbar — deshalb muss alles, was der Test prüft, im
  Kern liegen. Der Test darf `tileGeometry.ts` (three-frei) benutzen.
- **Präzision (§4.1):** Alle Rechnungen in f64 relativ zum Planetenzentrum. Die Kachelmittelpunkte sind
  heute `THREE.Vector3` — das sind JS-Zahlen (f64), also unkritisch; nichts davon in ein `Float32Array`.
- Ozean: `TerrainField` klemmt Höhen unter dem Meeresspiegel. Die Untergrenze für den Horizont trotzdem
  aus der Amplitude nehmen (konservativ), nicht aus dem Ozean.
- Prototyp der Zahlen in Kriterium 3: Kugel-Näherung ohne Höhen, Hüllradius 0,9 · Kachelgröße, Rand 0°.
  Mit echtem Hüllradius und 10° Rand wird der Gewinn etwas kleiner; deshalb die Schwelle 40 %.
- Die Übergangsregel aus §4.5 (Elternkachel bleibt, bis *alle* Kinder fertig sind) bleibt unverändert.

## Nicht-Ziele

Speicherbudget und Verdrängung (Aufgabe 19), Änderungen an `TerrainProvider.ts` (Ratsche),
GPU-seitiges Culling, Occlusion durch Berge.

## Auf dem Tablet prüfen

1. Erde, bis auf wenige Meter Höhe hinunter, Blick zum Horizont. Langsam einmal um 360° drehen.
   Es darf **nie** ein Loch, ein schwarzer Fleck oder ein Blick ins All durch den Boden erscheinen.
   Grobere Kacheln am Bildrand nach schnellem Drehen sind erwartet und füllen sich nach.
2. Schnell um 180° drehen: kurz grober Boden, dann Nachladen — kein Loch.
3. Dasselbe in 1000 km Höhe und im Orbit um den Mond.
4. HUD vergleichen, jeweils am selben Ort und mit derselben Blickrichtung, einmal mit `?cull=0`:
   Geo und Draw sind mit Culling deutlich kleiner.
5. Messlauf `?bench` und `?bench&cull=0`; beide Ergebniszeilen als PR-Kommentar einfügen. Der Agent trägt
   die Culling-Zeile in `docs/leistung.md` ein.

## Abschluss

- Leitfaden §2: Culling unter „Vorhanden" ergänzen (Quadtree verfeinert nur im Sichtkegel vor dem Horizont).
- Leitfaden §11: neue Zeile mit der Version.
