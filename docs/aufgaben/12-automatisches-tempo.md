---
id: 12
titel: Automatisches Tempo — Anflug nach Kontaktzeit, Stufe läuft zur Umgebung zurück
status: offen
braucht: [11]
stufe: —
tablet: ja
---

## Ziel

Wunsch des Inhabers: Das Tempo soll sich überall von selbst sinnvoll anfühlen — interplanetar,
beim Anflug, nah über dem Boden und bei der Landung —, mit weichen Übergängen. Der Geschwindigkeitsregler
bleibt, aber nur als Skala relativ zur jeweiligen Umgebung.

Das Grundprinzip gibt es schon: `v = rate · Referenzhöhe · speedScale` (`flightKernel.ts`). Bei ×1 ist
das Tempo überall angemessen. Zwei Lücken verhindern, dass es sich so anfühlt:

1. **Anflug ohne Richtungssinn.** Die Referenzhöhe kennt nur den Abstand, nicht die Flugrichtung.
   Wer bei ×100 senkrecht auf einen Planeten zuhält, hat eine Kontaktzeit von ~11 ms und schlägt
   praktisch ungebremst auf. Lösung: ein **Kontaktzeit-Begrenzer**. Das kommandierte Tempo wird so
   gedrosselt, dass die Zeit bis zum Kontakt (Höhe ÷ Annäherungsgeschwindigkeit) nie unter `ttcMin`
   fällt. Parallel zur Oberfläche greift er nicht.
2. **Die Stufe wandert mit.** ×100, im Leeren gesetzt, gilt danach auch am Boden. Lösung:
   **Rückführung der Stufe.** Je weiter man sich von der Umgebung entfernt, in der die Stufe gesetzt
   wurde, desto mehr läuft sie auf ×1 zurück — sichtbar in der Anzeige.

Beide Mechanismen sind per `?feel=autoPace:0` abschaltbar und laufen standardmäßig.

## Fertig, wenn

Offline-Test `tools/test-pace.ts` (neu, in `npm test` eingehängt):

- **Parallelflug unberührt:** Kommando senkrecht zur Richtung auf den einzigen Körper ⇒ Zielgeschwindigkeit
  bitgleich zur Rechnung ohne Begrenzer.
- **Sturzflug bei ×100:** Senkrecht auf einen ruhenden Körper mit Erdradius, Start in 1e7 m Höhe. Über
  den ganzen Flug bis 100 m Höhe gilt in jedem Substep `Höhe / Annäherung ≥ 0,95 · ttcMin`. Die
  Ankunftszeit (Höhe < 100 m) weicht bei 20, 60 und 120 fps um < 2 % voneinander ab.
- **×1 fast unverändert:** Sturzflug bei ×1 ⇒ Zielgeschwindigkeit weicht um < 3 % von der Rechnung ohne
  Begrenzer ab.
- **Stetig:** Richtung von parallel bis senkrecht in 1000 Schritten gedreht ⇒ keine Stufe der
  Zielgeschwindigkeit > 1 % zwischen Nachbarschritten.
- **Rückführung** (`stageHalfDecades` = 1):
  - ×100 gesetzt bei Referenzhöhe 1e8 m, Flug auf 1e7 m ⇒ ×10 (± 1e-9 relativ); weiter auf 1e6 m ⇒
    ×√10.
  - Danach zurück auf 1e8 m ⇒ bleibt ×√10. Die Rückführung verkleinert die Abweichung von ×1, sie
    vergrößert sie nie.
  - Zuerst von 1e8 m auf 1e11 m hinaus, dann auf 1e10 m herein ⇒ ×10. Gemessen wird ab dem
    weitesten Punkt seit dem Setzen.
  - ×0,1 gesetzt bei 10 m, Aufstieg auf 100 m ⇒ ×√0,1. Bei Stufen < 1 zählt der tiefste Punkt, und
    die Rückführung greift beim Entfernen.
  - Neue Nutzereingabe (Stufe ändert sich nicht durch die Rückführung) ⇒ Merkpunkt wird auf die
    aktuelle Referenzhöhe neu gesetzt.
  - Ein `speedScale`, der sich jedes Frame von außen ändert (Gleitflug), wird unverändert durchgereicht.
- **Abschaltbar:** Mit `autoPace` = 0 sind `stepFlight` und `Navigator.update` bitgleich zum Stand vor
  dieser Aufgabe (Vergleich gegen fest eingebettete Referenzwerte aus einem Lauf auf `main`).
- **Feel:** `parseFeel('?feel=ttcMin:1.5,stageHalfDecades:2')` setzt genau diese zwei Werte.
- Bestehende Tests grün. In `tools/test-nav.ts` dürfen nur Fälle angepasst werden, die Vollschub mit
  `speedScale > 1` direkt auf einen Körper prüfen (z. B. der Sturzflug bei ×100): Sie laufen dann
  ausdrücklich mit `autoPace = 0`, ihre Erwartungswerte bleiben unverändert. Jede solche Anpassung im
  PR auflisten.
- `npm run check` grün. `Engine.ts` unverändert.

## Verhalten

### Kontaktzeit-Begrenzer (in `stepFlight`, pro Substep, nur bei Schub)

- `ĉ` = Einheitsvektor des Kommandos (wie bisher), `V` = kommandiertes Tempo
  (`rate · reference · speedScale`, wie bisher).
- Für jeden Körper `i` mit Höhe `hᵢ = |cᵢ − p| − Rᵢ > 0`:
  - `kᵢ = max(0, ĉ · (cᵢ − p) / |cᵢ − p|)` ist der Anteil des Kommandos, der auf den Körper zeigt.
  - `Capᵢ = hᵢ / (ttcMin · kᵢ)`, unendlich bei `kᵢ = 0`.
- `V_cap = minᵢ Capᵢ`.
- Weich gesättigt: `V_eff = V / (1 + (V / V_cap)⁴)^(1/4)`. Weit unter dem Deckel gilt `V_eff ≈ V`,
  weit darüber `V_eff ≈ V_cap`, ohne Knick.
- `V_eff` ersetzt `V` nur in der Zielgeschwindigkeit des Schub-Zweigs. Der Zweig ohne Schub mit
  Assistenz (Ziel 0) und der ohne Assistenz (Ziel = v) bleiben unverändert.
- **Zusätzlich die tatsächliche Geschwindigkeit begrenzen.** Das gilt nach der Relaxation, bei Schub
  oder Assistenz, nicht im reinen Trägheitsflug ohne Assistenz. Für jeden Körper mit
  `cᵢ = v · r̂ᵢ > hᵢ / ttcMin` gilt `v −= (cᵢ − hᵢ / ttcMin) · r̂ᵢ`. Nur die Annäherungskomponente wird
  gekappt, die seitliche bleibt.
  - *Begründung:* `v` folgt dem Ziel mit `accelTau = 0,28 s` verzögert. Beim Abbremsen liegt `v` deshalb
    über dem Ziel. Das System `τ·h″ + h′ + h/ttcMin = 0` ist für `ttcMin < 4·accelTau ≈ 1,1 s`
    unterdämpft: Die Höhe schwingt über null hinaus, man schlägt also doch auf. Die Kappung auf `v` macht
    die Kontaktzeit exakt, unabhängig von dieser Verzögerung. Der weiche Deckel auf das Ziel sorgt dafür,
    dass die Kappung nur sanft eingreift.
- Körperbewegung bleibt unberücksichtigt; die Rahmengeschwindigkeit wird wie bisher getrennt geführt.

### Rückführung der Stufe (im `Navigator`, nur im freien Flug)

- Der Navigator merkt sich `stageSet` (Stufe beim Setzen), `mark` (Referenzhöhe) und `lastWritten`
  (die Stufe, die er zuletzt geschrieben hat).
- Pro Frame, mit `r` = Referenzhöhe aus der bereits vorhandenen `evaluateProximity`-Auswertung vor
  dem Schritt:
  - Ist `input.speedScale ≠ lastWritten`, hat der Nutzer die Stufe geändert. Dann gilt
    `stageSet = speedScale` und `mark = r`.
  - Bei `stageSet > 1`: `mark = max(mark, r)` und `d = log10(mark / r)`.
    Bei `stageSet < 1`: `mark = min(mark, r)` und `d = log10(r / mark)`.
  - `S_ziel = exp(ln(stageSet) · 2^(−d / stageHalfDecades))`.
  - Neue Stufe: bei `stageSet > 1` ist sie `min(input.speedScale, S_ziel)`, bei `stageSet < 1`
    ist sie `max(…)`. Dadurch ist die Rückführung einseitig.
- Die neue Stufe wird **in `input.speedScale` zurückgeschrieben** und `lastWritten` gesetzt. Das
  Eingabeobjekt ist der Zustand des Reglers (`FlightControls.input`), deshalb folgt die Anzeige. Diesen
  Seiteneffekt im Doc-Kommentar von `Navigator.update` ausdrücklich nennen.
- Im Gleitflug ändert sich `speedScale` jedes Frame von außen. Dadurch wird der Merkpunkt ständig
  neu gesetzt, und es gibt keine Wirkung. Das ist gewollt: Dort greift nur der Begrenzer.

### Startwerte in `feel.ts`

| Schlüssel | Standard | Bereich | Wirkung |
|---|---|---|---|
| `autoPace` | 1 | 0–1 | ≥ 0,5 schaltet Begrenzer und Rückführung ein |
| `ttcMin` | 0,6 | 0,1–10 | kürzeste Zeit bis zum Kontakt beim Anflug, in s |
| `stageHalfDecades` | 1 | 0,1–20 | Größenordnungen, nach denen sich die Abweichung der Stufe (im Log) halbiert |

Zur Einordnung: Bei ×1 senkrecht nach unten ist die Kontaktzeit `1/rate ≈ 1,1 s`. Mit `ttcMin = 0,6`
bleibt ×1 also fast unberührt, und erst höhere Stufen werden beim Anflug gedrosselt.

Im Tuning-Panel erscheinen die drei Werte automatisch unter „Weitere“ — kein Eingriff in
`TuningPanel.ts`.

## Dateien

- `src/nav/autoPace.ts` (neu, three-frei, DOM-frei) — reine Funktionen `contactCap(p, dir, bodies, ttcMin)`,
  `softCap(V, Vcap)` und `relaxStage(state, speedScale, reference, halfDecades)` mit einem kleinen
  Zustandstyp. Unter `src/nav/`, damit schon in `THREE_FREE`.
- `src/nav/flightKernel.ts` — im Schub-Zweig `V_eff` statt `V`, wenn `FEEL.autoPace ≥ 0,5`.
- `src/nav/Navigator.ts` — Rückführung in `updateFree` vor `stepFlight`, Rückschreiben in `input`.
  Steht nahe am Dateideckel: falls nötig, bestehende Hilfsfunktionen nach `autoPace.ts` verlagern,
  nicht den Deckel anheben.
- `src/nav/feel.ts` — die drei Schlüssel.
- `src/ui/FlightControls.ts` — `endFrame()` aktualisiert die Stufenanzeige, wenn sich `speedScale`
  seit der letzten Anzeige geändert hat (höchstens drei Zeilen; Datei bleibt unter 300).
- `tools/test-pace.ts` (neu), `tools/test-nav.ts` (nur die oben erlaubten Anpassungen),
  `package.json` (Skript `test:pace`, Version).

Reicht diese Liste nicht, nach §12.2 abbrechen und berichten. Insbesondere `Engine.ts`, `glide.ts` und
die Gestenverdrahtung bleiben unberührt.

## Hinweise

- **Framerate.** Der Begrenzer wirkt pro Substep auf die Zielgeschwindigkeit; die Relaxation mit
  `accelTau` und das Wegbudget bleiben, wie sie sind. Die Rückführung ist eine reine Funktion der
  Positionen, nicht der Zeit, und damit von selbst framerate-unabhängig.
- **Skalenfrei.** Beide Mechanismen rechnen in Verhältnissen (Höhe ÷ Tempo, Höhe ÷ Merkpunkt). Keine
  Konstanten in Metern.
- **`maxReferenceRate`** bleibt der äußere Deckel gegen von außen gesetzte Zustände. Der Begrenzer
  ersetzt ihn nicht.
- **Goto** läuft über seinen eigenen Pfad und bleibt unberührt.
- **Atmosphäre** gibt es noch nicht (Nebenspur A). Ein Dichtefaktor kommt später als dritter Faktor
  dazu; `autoPace.ts` ist der Ort dafür.

## Nicht-Ziele

Atmosphären-Faktor, Änderungen an Goto, Gleitkern oder Gesten, neue Regler-UI, Ausblenden des
Schubreglers.

## Auf dem Tablet prüfen

1. Start im Erdorbit. Stufe auf ×100, Schub direkt auf die Erde zu ⇒ der Anflug wird weich langsamer.
   Die Stufenanzeige läuft dabei sichtbar zurück, und man kommt kontrolliert in Bodennähe an.
2. In Bodennähe ×100 parallel zur Oberfläche ⇒ schnell, aber ohne Aufprall; solange die Höhe gleich
   bleibt, läuft die Stufe nicht zurück.
3. Weit hinaus, ×100, auf den Mond zu ⇒ die Ankunft bremst von selbst ab.
4. Am Boden ×0,1 einstellen und aufsteigen ⇒ die Stufe läuft Richtung ×1 zurück.
5. `?feel=glide:1`, Gleitflug mit voller Geschwindigkeit senkrecht nach unten ⇒ weich abgebremst.
6. `?feel=autoPace:0` ⇒ Verhalten wie vor dieser Aufgabe.
7. `?tune`: `ttcMin` und `stageHalfDecades` unter „Weitere“ verstellen ⇒ Unterschied sofort spürbar.

## Abschluss

- `docs/aufgaben/README.md`: Zeile 12 in der Reihenfolge-Tabelle (braucht 11, tablet ja).
- Leitfaden §2 (Navigation: Kontaktzeit-Begrenzer und Rückführung der Stufe), §7 Stufe 1 *Gelernt*,
  falls Erkenntnisse anfallen, und §11 (v0.4.11).
- `package.json` Patch +1 (0.4.10 → 0.4.11).
