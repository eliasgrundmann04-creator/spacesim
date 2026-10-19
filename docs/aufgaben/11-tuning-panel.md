---
id: 11
titel: Tuning-Panel — Gefühlswerte live mit Reglern abstimmen
status: offen
braucht: [10]
stufe: —
tablet: ja
---

## Ziel

Seit Aufgabe 09 sind alle Gefühlswerte per `?feel=key:val,…` überschreibbar. Auf dem Tablet ist das
mühsam: lange Adressen tippen, und jede Änderung braucht ein Neuladen. Danach steht man wieder im
Startorbit und muss erst losfliegen, bevor man den Unterschied spürt.

Ein zuschaltbares Panel (`?tune`) zeigt alle Werte aus `FEEL` als Regler. Änderungen wirken **sofort,
mitten im Flug**, ohne Neuladen. Die Adresszeile wird dabei still mitgeführt, sodass ein Neuladen die
Werte behält und die fertige `?feel=`-Zeile per Knopf kopiert werden kann.

Die Kerne lesen ihre Werte schon heute bei jeder Geste und jedem Frame aus dem einen Objekt `FEEL`
(`nav/feel.ts`). Das Panel ändert nur dieses Objekt; an `glide.ts`, `dragKernel.ts`, `fling.ts` und
`cameraTouch.ts` ändert sich nichts.

## Fertig, wenn

Offline-Test `tools/test-feel.ts` (neu, in `npm test` eingehängt):

- **Serialisierung:** `feelToSearch(FEEL)` liefert nur die Schlüssel, die vom Standard abweichen, in der
  Reihenfolge von `DEFAULT_FEEL`, als `feel=k:v,k2:v2`. Sind alle Werte Standard, ist das Ergebnis leer.
- **Roundtrip:** Für 200 zufällige Belegungen innerhalb von `FEEL_RANGES` gilt
  `parseFeel('?' + feelToSearch(x))` ⇒ jeder Wert auf 4 signifikante Stellen gleich `x`.
- **Fremde Parameter bleiben:** `mergeFeelIntoSearch('?terrain=gpu&tune&feel=spinTau:1', FEEL)` behält
  `terrain=gpu` und `tune` unverändert, ersetzt nur `feel=` und entfernt es, wenn alles Standard ist.
- **Setzen mit Klemmen:** `setFeel('spinTau', 99)` klemmt auf den Bereich; unbekannte Schlüssel und
  nicht-endliche Werte ändern nichts.
- **Reglerabbildung:** `sliderToValue(valueToSlider(v, key), key)` ⇒ `v` (relativ < 1e-9) für alle
  Schlüssel und je 50 Werte im Bereich; für Schlüssel mit logarithmischer Skala (siehe unten) ist der
  Reglerweg zwischen zwei Werten proportional zu deren ln-Verhältnis.
- Alle bestehenden Tests unverändert grün, `npm run check` grün. `Engine.ts` unverändert.

## Verhalten

**Zuschalten.** Nur mit `?tune` in der Adresse (Wert egal). Ohne `?tune` wird das Panel nicht gebaut,
nichts im DOM, kein Listener.

**Darstellung.** Ein kleiner runder Knopf oben links (über `#hud`, nicht über dem Schubregler) klappt
das Panel auf und zu. Aufgeklappt: halbtransparente Fläche, höchstens 40 % der Bildschirmbreite, eigener
Scrollbereich. Der Simulator läuft dahinter weiter und bleibt außerhalb der Fläche bedienbar.

**Gruppen und Regler.** Jeder Schlüssel aus `FEEL` bekommt eine Zeile mit kurzem deutschen Namen,
Regler und Zahlenwert (3 signifikante Stellen). Gruppen:

| Gruppe | Schlüssel |
|---|---|
| Gleitflug | `glide` (als Schalter An/Aus statt Regler), `glideGain`, `glideBrake`, `glideMax`, `glideMaxBack`, `glideHalfLife`, `glideCoupleTau` |
| Nachlauf | `spinTau`, `maxSpin`, `flingRest` |
| Orbit-Griff | `grabEdge`, `edgeFadePx` |
| Zwei Finger | `twistStartDeg`, `twistDominance`, `pinchLockPx` |

Ein neuer Schlüssel in `FeelConfig` ohne Gruppe landet automatisch in einer Gruppe „Weitere", damit
künftige Werte nie unsichtbar bleiben.

**Skala.** Logarithmisch, wenn `min > 0` und `max / min ≥ 20` (z. B. `glideMax` 0,1–90,
`glideHalfLife` 0,3–60); sonst linear. Reglerauflösung 1000 Schritte.

**Wirkung.** Jede Reglerbewegung ruft `setFeel(key, value)` und danach
`history.replaceState(null, '', location.pathname + mergeFeelIntoSearch(location.search, FEEL) + location.hash)`
auf. Kein Neuladen, kein neuer History-Eintrag.

**Knöpfe.**
- „Kopieren": die aktuelle `?feel=`-Zeile in die Zwischenablage (`navigator.clipboard.writeText`).
  Schlägt das fehl, wird die Zeile stattdessen markierbar im Panel angezeigt.
- „Standard": alle Werte auf `DEFAULT_FEEL`, Regler und Adresszeile nachführen.

**Touch.** Pointer-Ereignisse im Panel erreichen die Canvas nicht (das Panel ist ein eigenes Element
außerhalb von `renderer.domElement`; prüfen, dass `touch-action` und Pointer-Capture der Canvas das
nicht unterlaufen). Regler sind fingergroß, mindestens 32 px hoch.

## Dateien

- `src/nav/feel.ts` — neue reine Funktionen, three-frei, DOM-frei:
  `setFeel(key, value): boolean`, `feelToSearch(cfg): string`, `mergeFeelIntoSearch(search, cfg): string`,
  `isLogScale(key): boolean`, `valueToSlider(value, key): number` (0…1), `sliderToValue(t, key): number`.
- `src/ui/TuningPanel.ts` (neu, DOM, kein three) — baut das Panel aus `FEEL`, `DEFAULT_FEEL` und
  `FEEL_RANGES`, Stil wie in `FlightControls.ts` (eigenes `<style>`-Element), unter dem Dateideckel.
- `src/main.ts` — höchstens zwei Zeilen: bei `?tune` das Panel nach dem Engine-Start einhängen.
- `tools/test-feel.ts` (neu) und `package.json` (Skript `test:feel`, in `test` eingehängt; Version).

Reicht diese Liste nicht, nach §12.2 abbrechen und berichten. Insbesondere: `Engine.ts`,
`cameraTouch.ts` und die Kerne in `nav/` außer `feel.ts` werden nicht angefasst.

## Hinweise

- **Eine Quelle.** Das Panel hält keinen eigenen Zustand der Werte; es liest `FEEL` beim Aufbau und
  nach „Standard" neu. Damit stimmen Panel, Adresszeile und Kerne immer überein.
- **`parseFeel` bleibt** der einzige Weg von der Adresse in `FEEL` beim Laden. `mergeFeelIntoSearch`
  ist die Gegenrichtung und baut auf `feelToSearch` auf.
- **Zahlenformat** in der Adresse: `Number(v.toPrecision(4))`, Punkt als Dezimaltrenner. Im Panel
  darf die Anzeige ein Komma zeigen.
- **Wertebereiche** kommen ausschließlich aus `FEEL_RANGES`; keine zweiten Grenzen im Panel.
- **Nicht in `THREE_FREE` eintragen**: `TuningPanel.ts` ist DOM-Code, `feel.ts` ist über `src/nav/`
  schon erfasst.

## Nicht-Ziele

Neue Gefühlswerte, geänderte Standardwerte, Speichern in `localStorage`, Panel für andere Parameter
(Terrain, Renderauflösung), Ausblenden des Schubreglers.

## Auf dem Tablet prüfen

1. Seite **ohne** `?tune` öffnen ⇒ kein Knopf, alles wie vorher.
2. Mit `?tune` öffnen ⇒ kleiner Knopf oben links; antippen klappt das Panel auf und wieder zu.
3. Gleitflug-Schalter auf An ⇒ ohne Neuladen ist Pinch sofort Schub.
4. Losfliegen, dann während des Gleitens `glideHalfLife` hochziehen ⇒ das Gleiten wird spürbar länger,
   ohne dass der Flug abbricht.
5. `spinTau` ändern, mit einem Finger wischen ⇒ Nachlauf sofort anders.
6. Neben dem Panel auf die Szene tippen und ziehen ⇒ Steuerung reagiert normal; Ziehen auf einem
   Regler dreht die Kamera nicht.
7. Seite neu laden ⇒ die eingestellten Werte sind noch da (stehen in der Adresszeile).
8. „Kopieren" ⇒ die `feel=`-Zeile lässt sich in eine Notiz einfügen.
9. „Standard" ⇒ alle Regler zurück, `feel=` verschwindet aus der Adresse, `tune` bleibt.

## Abschluss

- `docs/aufgaben/README.md`: Zeile 11 in der Reihenfolge-Tabelle (braucht 10, tablet ja).
- Leitfaden §2 (Kamera-Absatz: Tuning-Panel mit `?tune`) und §11 (v0.4.10).
- `package.json` Patch +1 (0.4.9 → 0.4.10).
