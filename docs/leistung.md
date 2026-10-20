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

Noch keine Zeile. Die Basiszeile entsteht aus dem ersten Messlauf auf dem Tablet (Aufgabe 15,
*Auf dem Tablet prüfen*, Schritt 4) und wird unverändert aus dem Ergebnisfeld übernommen —
Messwerte von einem anderen Gerät oder geschätzte Zahlen gehören nicht hierher.
