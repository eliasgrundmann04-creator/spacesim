---
id: 01
titel: Stufe 2a — Frame-Baum als reine Datenstruktur
status: offen
braucht: [00]
stufe: 2a
tablet: nein
---

## Ziel

Leitfaden §7, Stufe 2, Teilstufe 2a (§12.4): *Frame-Baum als reine Datenstruktur, three-frei, mit
Roundtrip-Test über mehrere Frame-Wechsel.* Noch keine Verdrahtung mit Kamera, Szene oder Körpern.

Hintergrund §3.1: Ein einziger f64-Ursprung löst bei 1 Lj nur noch ~2 m auf, bei 100.000 Lj ~130 km.
Ein Baum aus Bezugsrahmen (Universum → Galaxie → System → Planet) mit lokalen Ursprüngen hält jede
Koordinate klein — vorausgesetzt, Umrechnungen laufen über den nächsten gemeinsamen Vorfahren und nie
über absolute Koordinaten.

## Fertig, wenn

`tools/test-frames.ts` läuft in `npm test` grün und zeigt jeweils mit Zahlenwert:

1. **Nah bleibt nah.** Das ganze Sonnensystem liegt 100.000 Lj vom Universumsursprung. Ein Fels auf
   der Erde (Erdframe, |p| ≈ 6,4·10⁶ m) wird in den Frame einer Kamera 2 m darüber umgerechnet, die in
   einem *anderen* Frame hängt (z. B. Mondframe oder Systemframe). Abstand Fels–Kamera stimmt auf < 1 µm.
2. **Fern bleibt relativ genau.** Ein Stern 100.000 Lj entfernt (Galaxieframe), dargestellt im Frame
   der Kamera auf der Erde: relativer Fehler der Entfernung < 10⁻¹².
3. **Roundtrip.** Eine Position wird über ≥ 4 Frame-Wechsel hin und zurück gerechnet
   (Erde → System → Galaxie → anderes System → zurück). Fehler ≤ 4 · ε · (größter Betrag einer
   Zwischendarstellung), ε = 2,2·10⁻¹⁶: Ein Umweg kostet die Präzision seines gröbsten Frames und nicht
   mehr. Ein Umweg nur über Nachbarframes (Erde → Mond → Erde) bleibt < 1 µm.
4. **Gegenprobe.** Kriterium 1 mit einem einzigen Weltursprung gerechnet (absolute Koordinaten,
   dann subtrahiert) verfehlt die 1 µm um viele Größenordnungen. Ohne diese Gegenprobe beweist
   Kriterium 1 nichts.
5. **Bewegte Frames.** Ein Frame-Ursprung wird verschoben (ein Systemframe folgt seinem Stern);
   Positionen in Kindframes bleiben lokal unverändert, ihre Umrechnung in andere Frames folgt.
6. `src/frames/` steht in `THREE_FREE` (`tools/contracts.mjs`), `npm run check` grün.

## Dateien

- `src/frames/FrameTree.ts` — neu. Bei Bedarf eine zweite Datei `src/frames/types.ts`.
- `tools/test-frames.ts` — neu
- `package.json` — Skript `test:frames`, in `test` einhängen; Version: nächste Patch-Nummer
- `tools/contracts.mjs` — nur `THREE_FREE` um `'src/frames/'` ergänzen

## Hinweise

- **Vektortyp:** `Vec3` und die Funktionen aus `src/nav/vec.ts` verwenden (`Vector3d` importiert three).
- **Exakte Referenzwerte:** Im Test alle Ursprünge und Positionen ganzzahlig in Metern wählen und die
  Wahrheit mit `BigInt` rechnen. Dann misst der Test den Fehler der Implementierung und nicht den
  einer zweiten f64-Rechnung.
- **Umrechnung über den nächsten gemeinsamen Vorfahren.** Von beiden Seiten nur bis dorthin
  aufsteigen. So summieren, dass sich große Ursprungsbeträge zuerst gegenseitig aufheben und die
  kleinen Anteile danach dazukommen (§4.7: umformulieren statt mehr Präzision).
- **Einheit pro Frame?** §3.1 nennt „eigene Einheit". Prüfen, ob das nötig ist: f64 ist Gleitkomma,
  die Auflösung hängt am *Betrag* der Koordinate, nicht an ihrer Einheit — ein Maßstabsfaktor bringt
  zusätzliche Rundung, aber keine Genauigkeit. Wenn du bei Metern bleibst, das als Befund in §9
  eintragen (nicht §3 ändern).
- Keine Rotation der Frames: alle Achsen bleiben Ekliptik J2000 (§6). Rotierende Frames sind ein
  späteres Thema (Achsrotation, Nebenspur A).
- Keine Allokation pro Aufruf erzwingen, aber auch kein vorzeitiges Optimieren — Lesbarkeit zuerst.

## Nicht-Ziele

Geschwindigkeiten zwischen Frames, Schwellen für Frame-Wechsel (Aufgabe 04), jede Änderung an
Kamera, Szene, `CelestialBody` oder `UniverseManager`.
