---
id: 22
titel: Stufe 2b nachziehen — Rahmenwechsel im echten Frame-Loop, ohne stilles Überspringen
status: offen
braucht: [23, 24]
stufe: 2b (Nachtrag)
tablet: ja
---

## Ziel

Aufgabe 06 (Stufe 2c, v0.5.0) und ihr Fix (Aufgabe 21, v0.5.1) sind in v0.4.16 zurückgenommen. Der
Befund steht in Leitfaden §9. Kurz:

1. **Die Kamera hat zur Laufzeit nie einen Bezugsrahmen.** `SpaceCamera.setFrame()` wird seit Aufgabe
   05 nirgends aufgerufen. Der Test von 05 rief es selbst auf und war deshalb grün. Vor 06 fiel das nicht
   auf, weil die Körper absolut rechneten.
2. **Fehlende Rahmen werden still übersprungen.** Jede Umrechnung ist als
   `if (cameraFrame && body.frame && …) transformPoint(…)` geschrieben. Fehlt eine Seite, rechnet der
   Code ohne Umrechnung weiter. Nach 06 standen dadurch alle Körper (je (0,0,0) im eigenen Rahmen) an
   derselben Renderposition. Im Browser gemessen: Sonne und Erde beide bei 3,82·10⁷ m vor der Kamera.
3. **Der Navigator überlebt keinen Rahmenwechsel.** `SpaceCamera.updateFrame()` rechnet nur die
   Kameraposition in den neuen Rahmen um. Der Merkpunkt der Mitführung (`frameCarry`) und der letzte
   Anker bleiben im alten Rahmen ⇒ im ersten Schritt danach springt die Kamera um den Versatz der
   beiden Rahmen.

Diese Aufgabe baut das Fundament, auf dem 06 neu aufsetzt: **eine** Umrechnungsstelle, die einen
fehlenden Rahmen als Fehler meldet statt ihn zu überspringen; einen Navigator, der beim Rahmenwechsel
mitzieht; und einen Prüfstand, der den Frame-Loop über echte Rahmenwechsel laufen lässt — mit dem
echten `Navigator` und dem echten `updateActiveFrame`, nicht mit Einzelteilen.

Sichtbar ändert sich nichts: In v0.4.16 haben die Körper noch keine Rahmen, die Kamera bleibt ohne.

## Fertig, wenn

Offline-Test `tools/test-frame-loop.ts` (neu, in `npm test` eingehängt).

**Prüfstand:** Rahmenbaum wie im zurückgenommenen 06 — Universum → Galaxie → Sonnensystem
(Ursprung Sonne) → Erde (SOI) → Mond (SOI), dazu ein Sternrahmen 4 Lj entfernt mit einem
Gesteinsplaneten (eigener Rahmen). Jeder Körper liegt bei (0,0,0) in seinem Rahmen, die Ursprünge
laufen auf Kreisbahnen wie in `tools/test-warp.ts`. Kamera = `{ frame, position }`. Pro Frame in der
Reihenfolge von `Engine.frame`: Simzeit vorrücken, Rahmenursprünge setzen, alle Körper über die neue
Umrechnungsstelle in den Kamerarahmen holen, `navigator.update`, Kamera setzen, `updateActiveFrame`,
bei Wechsel `navigator.rebaseFrame(…)`.

1. **Kein Sprung am Wechsel.** Freiflug von der Erde zum Mond über die Mond-SOI (Erde → Mond) und
   zurück, bei 20, 60 und 120 fps: Die Lage der Kamera relativ zum Mond springt beim Wechsel um höchstens
   1 mm; der Anker wechselt nicht ungewollt.
2. **Gegenprobe:** derselbe Flug ohne `rebaseFrame` springt beim Wechsel um mehr als 10⁶ m.
3. **Schweben im Unterrahmen.** Kamera im Mondrahmen, Leerlauf mit Assistenz, Warp ×1, ×10³, ×10⁶,
   je 10 s bei 20/60/120 fps: Versatz Kamera − Mond weicht in keinem Frame um mehr als 1 cm ab.
4. **Weit draußen** (Simzeit in diesem Szenario angehalten). Flug Sonnensystem → Galaxie → Sternrahmen in 4 Lj → 2 m über dem Gesteinsplaneten:
   Alle Körperpositionen im Kamerarahmen sind endlich und paarweise verschieden; die Höhe über dem
   Planeten stimmt auf 1 mm (Wahrheit mit `BigInt` wie in `tools/test-frames.ts`).
5. **Kein stilles Überspringen.** Die Umrechnungsstelle mit Körper *mit* Rahmen und Kamera *ohne*
   (oder umgekehrt) wirft einen Fehler mit beiden Namen. Beide ohne Rahmen ⇒ Rechnung wie bisher
   (absolut), das hält v0.4.16 lauffähig.
6. Alle bestehenden Tests unverändert grün. `npm run check` grün.

## Verhalten

- **`src/frames/convert.ts`** (neu, three-frei): die *eine* Umrechnungsstelle für „Punkt eines Körpers
  im Kamerarahmen" und „Kamera im Rahmen eines Körpers", auf `transformPoint` aufgebaut. Regel: beide
  Rahmen da ⇒ umrechnen; beide fehlen ⇒ unverändert; genau einer fehlt ⇒ Fehler.
- **`Navigator.rebaseFrame(offset: Vec3)`**: verschiebt jede gespeicherte Position (Merkpunkt der
  Mitführung, letzter Anker, Goto-Zustand — im Code nachsehen, was es alles gibt) um den Versatz
  zwischen altem und neuem Rahmen. Rahmen rotieren nicht (§6), also reine Verschiebung.
- **`Engine`:** merkt sich `camera.frame` vor `updatePlacement`; hat er sich danach geändert, ruft es
  `navigator.rebaseFrame` mit dem Versatz aus `convert.ts`. Dazu ein **Laufzeit-Selbsttest** (§8.3.6):
  hat irgendein Körper einen Rahmen und die Kamera keinen, einmal `console.error` mit Erklärung und
  ein dauerhafter Hinweis im HUD.
- **`EngineHud`:** zeigt den Hinweis `RAHMEN FEHLT` an, wenn der Selbsttest anschlägt. Bis 06 ist er nie
  sichtbar.

## Dateien

- `src/frames/convert.ts` — neu, three-frei (liegt unter `src/frames/`, schon in `THREE_FREE`)
- `src/nav/Navigator.ts` — `rebaseFrame` (bei Bedarf die Verschiebung in `nav/frameCarry.ts`; dann ist
  das die fünfte Datei statt `EngineHud.ts`, und der HUD-Hinweis wird nur `console.error`)
- `src/core/Engine.ts` — Wechsel erkennen, `rebaseFrame`, Selbsttest
- `src/core/EngineHud.ts` — Hinweis anzeigen
- `tools/test-frame-loop.ts` — neu
- `package.json` — Skript `test:frame-loop`, in `test` einhängen; Version: nächste Patch-Nummer

Reicht diese Liste nicht, nach §12.2 abbrechen und berichten. **Nicht** anfassen: `CelestialBody`,
`UniverseManager`, `SceneManager`, `SpaceCamera`, `cameraPlacement`, `EngineInput` — die stellt der
Neuschnitt von 06 auf `convert.ts` um.

## Hinweise

- **Der Prüfstand ist der Kern dieser Aufgabe.** Er bleibt danach stehen und ist das Abnahmekriterium
  für jeden Teil des neuen 06: Was dort an Kamera und Körpern verdrahtet wird, muss denselben Ablauf
  nehmen wie der Prüfstand.
- `Navigator` ist three-frei und offline ladbar; `SpaceCamera` nicht (Parameter-Properties, three).
  Deshalb modelliert der Prüfstand die Kamera als `{ frame, position }` und ruft `updateActiveFrame`
  direkt — das ist genau die Logik von `SpaceCamera.updateFrame()`.
- Geschwindigkeiten über Rahmen (`BodyRef.velocity` für Körper im eigenen Rahmen) sind **nicht** Teil
  dieser Aufgabe. Das zurückgenommene 06 setzte sie auf 0. Den Befund für den Neuschnitt in §9 notieren:
  welche Funktionen des Navigators die Ankergeschwindigkeit brauchen (Ausgabe, Trägheit beim
  Ankerwechsel, Goto-Übergabe) und was sie mit 0 tun.
- Rückgabewerte von `transformPoint` sind neue Objekte. Für den Prüfstand egal; Allokation pro Körper
  und Frame ist ein Thema für Nebenspur B, nicht hier.

## Nicht-Ziele

Körper in Rahmen migrieren (das ist 06), Geschwindigkeiten über Rahmen, Änderungen an Kamera, Szene
oder Universum, Performance.

## Auf dem Tablet prüfen

1. Vorschau öffnen: Die App verhält sich exakt wie v0.4.15/v0.4.16 — Erde lädt, Queue fällt auf 0,
   Doppeltipp auf den Mond fliegt hin, Zeitraffer ×10⁶ hält die Kamera über dem Mond.
2. Im HUD erscheint **kein** `RAHMEN FEHLT` und kein `[Frame: …]` (Körper haben noch keine Rahmen).
3. Doppeltipp auf einen `PSC-*`-Stern und zurück zur Erde: alles wie vorher.

## Abschluss

- Leitfaden §2: unter „Fehlt strukturell" den Stand nachführen (Rahmenwechsel des Navigators gelöst,
  Körper noch absolut).
- Leitfaden §9: Befund zu den Geschwindigkeiten über Rahmen (siehe Hinweise).
- Leitfaden §11: neue Zeile mit der Version.
