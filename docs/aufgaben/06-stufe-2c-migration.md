---
id: 06
titel: Stufe 2c — Körper und Katalog in Frames migrieren
status: offen
braucht: [05]
stufe: 2c
tablet: ja
---

> **Entwurf.** Wird nach Aufgabe 05 präzisiert; Teilung per Eskalation ist auch hier erwartbar.

## Ziel

Leitfaden §12.4, Teilstufe 2c: *Migration: `CelestialBody`, `UniverseManager`, Katalog-Import.* Jedes
System bekommt einen eigenen Frame, Körperpositionen leben lokal darin. Danach ist Stufe 2 erfüllt.

## Fertig, wenn

Das Abnahmekriterium von Stufe 2 aus Leitfaden §7, wörtlich: *eine Sternposition in 100.000 Lj und
ein Fels auf der Erde im selben Programmlauf beide korrekt — nachweisbar über einen Offline-Test,
der Positionen über mehrere Frame-Wechsel hin- und zurückrechnet.* Zusätzlich:

- Der Fall aus `tools/test-orbit.ts` (dasselbe System 3 Lj vom Ursprung verliert ~0,16 m/s) zeigt
  keinen messbaren Verlust mehr. Der Test wird dafür umgestellt, nicht gelockert: alte Rechnung als
  Gegenprobe behalten.
- Version → 0.5.0, README „Neu in v0.5", Leitfaden §2 und §11 nachgeführt.

## Dateien

Werden im Plan festgelegt. Erwartbar: `CelestialBody.ts`, `UniverseManager.ts`, `SceneManager.ts`,
`test-orbit.ts`, ein neuer Test.

## Auf dem Tablet prüfen

Auf einem Planeten eines `PSC-*`-Sterns bis auf 2 m Höhe hinunterfliegen. Vor dieser Aufgabe ist dort
mit Zittern bzw. springendem Boden zu rechnen (bei ~10 Lj löst f64 nur ~16–32 m auf); danach muss der
Boden so ruhig stehen wie auf der Erde.
