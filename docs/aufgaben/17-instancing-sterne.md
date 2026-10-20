---
id: 17
titel: Nebenspur B4 — Instancing: alle Sternglows in einem Draw-Call
status: offen
braucht: [22]
stufe: B (Performance & Tablet)
tablet: ja
---

## Ziel

Leitfaden §7, Nebenspur B: *Instancing.*

Jeder Stern (`Star.buildRenderObject`) baut heute ein eigenes Glow-Sprite und eine eigene Kugel mit
48 × 24 Segmenten. Bei ~70–100 Sternen im 16-Lj-Umkreis sind das bis zu ~200 Draw-Calls für Objekte,
die fast alle kleiner als ein Pixel sind — auf dem Tablet (besonders im WebGL2-Fallback) teuer.
Kacheln eignen sich nicht für Instancing: Jede hat eigene Vertexdaten, und ihre Positionen müssen nach
§4.2 auf der CPU in f64 entstehen.

Nach dieser Aufgabe zeichnet **eine** instanzierte Schicht alle Sternglows in einem Draw-Call, und die
Kugel eines Sterns wird nur gezeichnet, wenn sie auf dem Bildschirm mindestens ein Pixel groß ist
(Repräsentationswechsel nach Winkelgröße, §3.2). Sichtbar ändert sich nichts.

## Fertig, wenn

Offline-Test `tools/test-glow.ts` (neu, in `npm test` eingehängt) zeigt mit Zahlenwert:

1. **Gleiches Bild.** Größe und Deckkraft jedes Glows stimmen mit der bisherigen Formel aus
   `Star.update` überein — für Abstände 3 R, 10 R, 1 AE, 1 Lj, 16 Lj und Sonne bzw. roten Zwerg:
   relativer Unterschied ≤ 10⁻⁶ (f32-Rundung im Instanzpuffer).
2. **Kugel nur, wenn sie zählt.** Die Kugel ist genau dann sichtbar, wenn ihr Winkelradius ≥ ein Pixel
   ist (Pixelwinkel = `fovY / Bildhöhe in px`). Am Umschaltpunkt hat der Glow eine Deckkraft ≥ 0,85, die
   Kugel ist also ohnehin überstrahlt — Zahl für Sonne bei 1080 px Bildhöhe im Test ausgegeben.
3. **Kamerarelativ.** Der Kern nimmt ausschließlich kamerarelative Positionen entgegen (in f64
   subtrahiert, §4.1) und schreibt sie erst dann in den `Float32Array`. Im Test belegt: Eingabe und
   Puffer unterscheiden sich nur um f32-Rundung.
4. **Kosten.** Füllen des Instanzpuffers für 10⁴ Sterne < 0,5 ms (Mittel über 100 Läufe, Zahl im PR).
5. `npm run check` grün.

## Verhalten

- **Kern `src/perf/glowInstances.ts`** (neu, three-frei): aus kamerarelativen Positionen, Radien,
  Farben und Pixelwinkel → Instanzpuffer (Versatz, Größe, Farbe, Deckkraft) und je Stern „Kugel
  sichtbar ja/nein". Die Formel für Größe und Deckkraft wird aus `Star.update` hierher **verschoben**,
  nicht neu erfunden.
- **Schicht `src/universe/StarGlowLayer.ts`** (neu, three): ein Objekt in der Szene, ein Draw-Call.
  Sterne melden sich in `buildRenderObject` an, statt ein eigenes Sprite zu bauen. Einmal pro Frame
  *nach* `syncToCamera` liest die Schicht `star.root.position` — das ist bereits die in f64 gebildete,
  kamerarelative Differenz (und berücksichtigt den Frame-Baum) — und füllt den Puffer über den Kern.
- **Kugeln:** eine gemeinsame Einheitskugel-Geometrie, je Stern skaliert; `visible` aus dem Kern.
- **Selbsttest mit stillem Fallback (§8.3.6):** Aufbau der Schicht in `try/catch`; schlägt er fehl,
  bauen die Sterne ihre Sprites wie bisher (`console.warn`, kein Abbruch).
- **A/B-Schalter:** `?stars=legacy` erzwingt den bisherigen Weg.

## Dateien

- `src/perf/glowInstances.ts` — neu, three-frei
- `src/universe/StarGlowLayer.ts` — neu
- `src/universe/Star.ts` — Anmeldung statt eigenem Sprite, gemeinsame Kugelgeometrie, Legacy-Pfad
- `src/core/Engine.ts` — Schicht in die Szene, einmal pro Frame nach `syncToCamera` aktualisieren
- `tools/test-glow.ts` — neu
- `package.json` — Skript `test:glow`, in `test` einhängen; Version: nächste Patch-Nummer

## Hinweise

- **three-API nicht raten** (AGENTS.md). Kandidaten in r171: `SpriteNodeMaterial` mit `positionNode`
  und `scaleNode` aus einem `instancedBufferAttribute`, oder `InstancedMesh` mit Billboard im
  Vertex-Knoten. Maßgeblich ist `node_modules/three/src/materials/nodes/SpriteNodeMaterial.js` und
  `node_modules/three/src/nodes/` — nicht Beispiele einer anderen Version. Ein Typfehler heißt: falsche
  API, nicht `as unknown as`.
- Additives Blending, `depthWrite: false` und die Glow-Textur bleiben wie bisher.
- `frustumCulled` der Schicht ausschalten (die Instanzen liegen über Lichtjahre verteilt; eine
  gemeinsame Hüllkugel wäre falsch) — sonst verschwinden alle Glows, sobald der Ursprung der Schicht
  außerhalb des Blicks liegt.
- Das `PointLight` jedes Sterns bleibt in dieser Aufgabe unangetastet — das ist Aufgabe 18.
- Mit Stufe 4 (Punktwolken-Renderer) kommen 10⁵ Sterne. Diese Schicht ist nicht dieser Renderer; der
  Kern (kamerarelativ in f64 → Instanzpuffer) ist aber so geschnitten, dass Stufe 4 ihn übernehmen kann.

## Nicht-Ziele

Lichter (Aufgabe 18), Photometrie (Stufe 3), Sternkatalog (Stufe 4), Instancing von Kacheln.

## Auf dem Tablet prüfen

1. Start an der Erde, herauszoomen bis das Sonnensystem klein ist: Die Sonne und die Nachbarsterne
   leuchten wie vorher — gleiche Größe, Farbe, Helligkeit. Mit `?stars=legacy` im zweiten Tab
   nebeneinander vergleichen.
2. Doppeltipp auf einen `PSC-*`-Stern und anfliegen: Der Glow blendet beim Näherkommen aus, die Kugel
   erscheint ohne Sprung oder Aufblitzen.
3. Kamera so drehen, dass die Sonne gerade aus dem Bild geht: Die anderen Sterne bleiben sichtbar.
   *Fehlerbild:* alle Glows verschwinden gleichzeitig (Frustum-Culling der Schicht nicht abgeschaltet).
4. HUD bei Halt 6 des Messlaufs (bzw. weit draußen mit Blick zur Sonne): Draw ist um mindestens die
   Zahl der Sterne kleiner als mit `?stars=legacy`.
5. Messlauf `?bench` und `?bench&stars=legacy`; beide Ergebnisse als PR-Kommentar einfügen. Der Agent
   trägt die Zeile in `docs/leistung.md` ein.

## Abschluss

- Leitfaden §2: Sternglows instanziert, Kugel nach Winkelgröße.
- Leitfaden §11: neue Zeile mit der Version.
