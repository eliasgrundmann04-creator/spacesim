---
id: 18
titel: Nebenspur B5 — Lichtbudget: zwei Lichtplätze statt ein PointLight pro Stern
status: offen
braucht: [17]
stufe: B (Performance & Tablet)
tablet: ja
---

## Ziel

Leitfaden §7, Nebenspur B (*Performance & Tablet*). Nicht in der Stichpunktliste von §7, sondern ein
Befund aus dem Code beim Schneiden dieser Nebenspur — vor der Umsetzung mit den Messpunkten aus
Aufgabe 14 bestätigen (siehe Hinweise).

Jeder Stern hängt ein eigenes `PointLight` in die Szene (`Star.buildRenderObject`), bei ~70–100
Sternen also ebenso viele Lichter. Im WebGPU-Renderer von three erzeugt `LightsNode` für **jedes**
Licht der Szene Shadercode, den jedes beleuchtete Material — also jede Terrainkachel — pro Fragment
durchläuft. Physikalisch tragen diese Lichter nichts bei: Ein Stern in 4 Lj liefert auf der Erde rund
10⁻¹¹ der Bestrahlungsstärke der Sonne.

Nach dieser Aufgabe gibt es eine feste Zahl von Lichtplätzen (K = 2), die jeden Frame an die Sterne mit
der größten Bestrahlungsstärke am Ort der Kamera vergeben werden. Die Zahl der Lichter in der Szene
ändert sich nie — sonst kompiliert three die Shader neu.

## Fertig, wenn

Offline-Test `tools/test-lights.ts` (neu, in `npm test` eingehängt) zeigt mit Zahlenwert:

1. **Sonnensystem unverändert.** Mit den Sternen aus Katalog und 16-Lj-Nachbarschaft (gleiche Seeds wie
   `UniverseManager`, im Test nachgebaut oder direkt aus dem three-freien Teil erzeugt): An jedem Ort
   innerhalb von 1000 AE um die Sonne hält die Sonne Platz 1, und die Summe der Bestrahlungsstärke
   aller Sterne *ohne* Platz ist ≤ 10⁻⁶ der Summe mit Platz (Zahl im Test).
2. **Übergabe beim Anflug.** Flug auf der Geraden von der Sonne zu einem Stern in 4 Lj: Platz 1 wechselt
   genau einmal, nahe dem Punkt gleicher Bestrahlungsstärke; vorher und nachher hat der jeweils andere
   Stern Platz 2.
3. **Kein Flattern.** Pendelt die Kamera ± 1 % um diesen Punkt (20, 60 und 120 fps, je 10 s), wechselt
   die Belegung höchstens einmal (Hysterese: ein Herausforderer verdrängt einen Platzinhaber erst ab
   1,25-facher Bestrahlungsstärke).
4. **Kosten.** Rangfolge für 10⁴ Sterne < 0,5 ms (Mittel über 100 Läufe, Zahl im PR).
5. `npm run check` grün.

## Verhalten

- **Kern `src/perf/lightRank.ts`** (neu, three-frei): Bestrahlungsstärke E = L / (4π d²) aus
  kamerarelativer Position und Leuchtkraft; vergibt K Plätze mit Hysterese; liefert je Platz den
  Stern-Index oder „leer".
- **`src/universe/LightSlots.ts`** (neu, three): legt einmal K `PointLight` an und hängt sie in die
  Szene. Jeden Frame nach `syncToCamera`: Position = `star.root.position` des Platzinhabers (kamerarelativ,
  in f64 gebildet), Farbe und Intensität genau wie bisher in `Star` (`luminosity · LIGHT_SCALE`,
  Decay 2, Reichweite 0). Leerer Platz ⇒ Intensität 0, **nicht** entfernen.
- **`Star.ts`:** kein eigenes `PointLight` mehr; `LIGHT_SCALE` exportieren, damit es eine Quelle gibt.
- **A/B-Schalter:** `?lights=all` stellt den bisherigen Zustand her (ein Licht je Stern).

## Dateien

- `src/perf/lightRank.ts` — neu, three-frei
- `src/universe/LightSlots.ts` — neu
- `src/universe/Star.ts` — Licht entfernen, `LIGHT_SCALE` exportieren, Legacy-Pfad
- `src/core/Engine.ts` — Plätze anlegen, einmal pro Frame nach `syncToCamera` aktualisieren
- `tools/test-lights.ts` — neu
- `package.json` — Skript `test:lights`, in `test` einhängen; Version: nächste Patch-Nummer

## Hinweise

- **Erst messen.** Vor dem Umbau mit `?perf` und dem Messlauf (Halte 2 und 3, Terrain im Bild) die
  Render-Zeit festhalten; nach dem Umbau dasselbe, und `?lights=all` als Gegenprobe. Zeigt sich kein
  messbarer Unterschied, trotzdem fertigstellen (die Lichtzahl ist ein Risiko für den WebGL2-Fallback:
  Uniform-Grenzen), aber den Befund ehrlich im PR und in Leitfaden §9 nennen.
- Prüfen, wie `LightsNode` (`node_modules/three/src/nodes/lighting/LightsNode.js`) seinen Cache-Schlüssel
  bildet: Eine konstante Zahl von Lichtern mit wechselnder Intensität darf keine Neukompilierung
  auslösen. Licht nie per `visible = false` ausblenden, wenn das den Schlüssel ändert.
- Die Sterne kennt `Engine` über `sceneManager.allBodies` (Filter auf `Star`). Die Liste ändert sich
  nur, wenn ein System bevölkert wird — nicht jeden Frame neu filtern.
- Stufe 3 (Photometrie) wird Lichtintensitäten neu kalibrieren. Diese Aufgabe ändert an der Kalibrierung
  nichts, sie ändert nur, *welche* Sterne ein Licht haben.

## Nicht-Ziele

Photometrie, Schatten, Umgebungslicht, Änderungen an den Glows (Aufgabe 17).

## Auf dem Tablet prüfen

1. Erde im Orbit: Tag- und Nachtseite sehen genau aus wie vorher; im zweiten Tab mit `?lights=all`
   nebeneinander vergleichen.
2. Bis auf wenige Meter Höhe auf der Tagseite: Beleuchtung unverändert. Bild p50 und Render-Phase
   (`?perf`) mit und ohne `?lights=all` notieren.
3. Doppeltipp auf einen `PSC-*`-Stern, anfliegen, einen seiner Gesteinsplaneten fokussieren: Der
   Planet ist von *seinem* Stern beleuchtet. *Fehlerbild:* Planet schwarz oder von der falschen Seite
   beleuchtet.
4. Auf dem Weg dorthin: kein Flackern, kein kurzes Ruckeln beim Wechsel der Lichtplätze.
5. Messlauf `?bench` und `?bench&lights=all`; beide Ergebnisse als PR-Kommentar einfügen. Der Agent
   trägt die Zeile in `docs/leistung.md` ein.

## Abschluss

- Leitfaden §2: Lichtbudget (K = 2 Lichtplätze nach Bestrahlungsstärke).
- Leitfaden §11: neue Zeile mit der Version.
