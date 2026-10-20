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
| **Bild p50** | Median der Bilddauer in ms (p50), aus den Einzelframes der 5 Messsekunden |
| **Bild p95** | 95. Perzentil der Bilddauer in ms (p95 — kritische Metrik) |
| **Bild max** | Maximale Bilddauer in ms |
| **CPU p95** | 95. Perzentil der CPU-Zeit pro Frame in ms |
| **Ruckler** | Anzahl der Bildraten-Spikes (dt ≥ 2 × Median) |
| **Draw** | Anzahl Draw-Calls pro Frame (Mittel über die Messsekunden) |
| **Tri** | Anzahl gerenderter Dreiecke |
| **Geo** | Anzahl Geometrie-Objekte im Speicher |
| **Einschwingen** | Dauer bis die Kachel-Warteschlange leer war (in s) oder „> 15 s" |

---

## Messprotokoll

### Basiszeile — v0.4.19 (Nebenspur B2, Aufgabe 15)

Vom Tablet des Inhabers, Werte unverändert aus dem Ergebnisfeld. „Chrome/Desktop" ist ein Fehler
der Geräteerkennung in v0.4.19: Chrome auf Android-Tablets meldet einen Desktop-User-Agent. Ab
dem nächsten Lauf steht dort „Tablet (Chrome, Desktop-UA)".

- **Version:** v0.4.19
- **Datum:** 2026-10-20
- **Gerät:** Chrome/Desktop
- **Backend:** WebGPU
- **Renderauflösung:** 1,0×

| Halt | Ort | Bild p50 | Bild p95 | Bild max | CPU p95 | Ruckler | Draw | Tri | Geo | Einschwingen |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Erde, Orbitmodus (3 R) | 16,7 ms | 35,9 ms | 38,2 ms | 5,0 ms | 49 | 62 | 44,1k | 67 | 0,9 s |
| 2 | Erde, 1000 km Höhe | 17,1 ms | 36,2 ms | 53,7 ms | 7,6 ms | 30 | 88 | 56,4k | 157 | 1,4 s |
| 3 | Erde, 2 m Höhe über Land | 32,8 ms | 35,9 ms | 37,1 ms | 16,2 ms | 0 | 298 | 197,0k | 416 | 5,4 s |
| 4 | Mond, 10 km Höhe | 49,8 ms | 54,0 ms | 83,8 ms | 17,0 ms | 0 | 217 | 140,0k | 244 | 5,4 s |
| 5 | 50 AE über Ekliptik | 16,7 ms | 17,2 ms | 392,4 ms | 4,3 ms | 2 | 38 | 35,1k | 48 | 0,1 s |
| 6 | 20 Lj vom Sonnensystem | 16,6 ms | 17,1 ms | 36,0 ms | 3,9 ms | 1 | 104 | 108,0k | 78 | 0,0 s |

**Lesart:** Halt 1 und 2 laufen im Median mit 60 fps, verlieren aber jedes sechste bis zehnte Bild
(p95 ≈ zwei Bildintervalle, 49 bzw. 30 Ruckler in 5 s) — bei nur 5–8 ms CPU, also nicht im
Main-Thread. Halt 3 und 4 sind gleichmäßig langsam (30 bzw. 20 fps) und CPU-gebunden (16–17 ms bei
217–298 Draw-Calls): Ansatzpunkt für Aufgabe 16 (Kachel-Culling). Halt 5 hat einen einzelnen
Ausreißer von 392 ms, vermutlich das Abräumen der Mond- und Erdkacheln nach dem Sprung.
