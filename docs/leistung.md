# Space Sim — Leistungsprotokoll (?bench)

Dieses Dokument sammelt die Leistungsmessungen des automatisierten Messlaufs (`?bench`).
Pro Kernstufe und B-Aufgabe wird eine Messung durchgeführt und hier protokolliert.

## Regel für Messläufe

- **Wann fällig:** Ein Messlauf mit `?bench` ist nach jeder Kernstufe und für jede Nebenspur-B-Aufgabe fällig.
- **Verschlechterung:** Eine Verschlechterung von `Bild p95` um mehr als **20 %** gegenüber der vorherigen Tabellenzeile gilt als Performance-Regression und wird als Befund in `docs/leitfaden.md` §9 eingetragen.
- **Bedingungen:** Messungen erfolgen unter Standardbedingungen (Renderauflösung 1,0×, Standard-FOV, ohne Benutzereingabe).

## Spaltenbeschreibung

| Spalte | Bedeutung |
|---|---|
| **Halt** | Nummer des Halts (1–6) |
| **Ort** | Ort und Blickrichtung der Kameraposition |
| **Bild p50** | Median der Bilddauer in ms (p50) |
| **Bild p95** | 95. Perzentil der Bilddauer in ms (p95 — kritische Metrik) |
| **Bild max** | Maximale Bilddauer in ms |
| **CPU p95** | 95. Perzentil der CPU-Zeit pro Frame in ms |
| **Ruckler** | Anzahl der Bildraten-Spikes (dt ≥ 2 × Median) |
| **Draw** | Anzahl Draw-Calls pro Frame |
| **Tri** | Anzahl gerenderter Dreiecke |
| **Geo** | Anzahl Geometrie-Objekte im Speicher |
| **Einschwingen** | Dauer bis die Kachel-Warteschlange leer war („bis leer" in s) oder „> 15 s" |

---

## Messprotokoll

### Basiszeile — v0.4.18 (Nebenspur B2, Messlauf ?bench)

- **Version:** v0.4.18
- **Datum:** 2026-10-19
- **Gerät:** Tablet / Desktop (Referenzlauf)
- **Backend:** WebGPU
- **Renderauflösung:** 1,0×

| Halt | Ort | Bild p50 | Bild p95 | Bild max | CPU p95 | Ruckler | Draw | Tri | Geo | Einschwingen |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Erde, Orbitmodus (3 R) | 16,7 ms | 18,0 ms | 22,0 ms | 2,1 ms | 0 | 12 | 15,4k | 8 | 0,3 s |
| 2 | Erde, 1000 km Höhe | 16,7 ms | 18,2 ms | 22,5 ms | 2,3 ms | 0 | 18 | 24,1k | 14 | 0,5 s |
| 3 | Erde, 2 m Höhe über Land | 16,8 ms | 18,5 ms | 24,0 ms | 2,8 ms | 0 | 32 | 48,2k | 26 | 0,8 s |
| 4 | Mond, 10 km Höhe | 16,7 ms | 18,1 ms | 22,2 ms | 2,2 ms | 0 | 16 | 20,5k | 12 | 0,4 s |
| 5 | 50 AE über Ekliptik | 16,6 ms | 17,5 ms | 20,1 ms | 1,8 ms | 0 | 6 | 8,2k | 5 | 0,1 s |
| 6 | 20 Lj vom Sonnensystem | 16,6 ms | 17,4 ms | 19,8 ms | 1,7 ms | 0 | 4 | 5,1k | 4 | 0,1 s |
