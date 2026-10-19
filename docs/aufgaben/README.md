# Aufgabenwarteschlange

Jede Datei hier ist **eine** Aufgabe für **eine** Agent-Sitzung und ergibt **einen** PR
(Leitfaden §12.4: eine Stufe ist eine Absicht, keine Session).

## Kopf jeder Aufgabe

```
---
id: 01
titel: Kurzname
status: offen        # offen | blockiert | erledigt
braucht: [00]        # ids, die vorher erledigt sein müssen
stufe: 2a            # Bezug zu Leitfaden §7, oder "—"
tablet: ja           # ja = der PR braucht eine Sichtprüfung in der Netlify-Vorschau
---
```

Danach: **Ziel**, **Fertig, wenn** (prüfbar, möglichst als Test), **Dateien** (die erlaubte Liste),
**Hinweise**, **Nicht-Ziele**, bei `tablet: ja` die Sichtprüfung.

## Ablauf

- **Starten:** GitHub-Issue mit dem Titel der Aufgabe anlegen, Text:
  `Bearbeite docs/aufgaben/<datei>.md nach AGENTS.md.` — und das Label `jules` setzen.
- **Der Agent** setzt `status: erledigt` *in seinem PR*. Auf `main` steht sie damit erst nach dem Merge
  auf erledigt — deshalb nie zwei Aufgaben starten, die voneinander abhängen.
- **Blockiert:** Der Agent hat eskaliert. Befund steht im PR und in Leitfaden §9.
  Entscheiden, Aufgabe anpassen oder teilen, Status zurück auf `offen`.
- **Neue Aufgaben** schreibt der Inhaber (oder ein Agent auf ausdrücklichen Auftrag) nach diesem Muster.
  Ein *Fertig, wenn*, das sich nicht prüfen lässt, ist ein Zeichen, dass die Aufgabe noch nicht geschnitten ist.

## Reihenfolge (Stand v0.4.1)

| id | Aufgabe | braucht | tablet |
|---|---|---|---|
| 00 | Probelauf: doppeltes `formatDistance` auflösen | — | ja |
| 01 | Stufe 2a: Frame-Baum als Datenstruktur | 00 | nein |
| 02 | `SpaceCamera.ts` unter den Deckel teilen | 00 | ja |
| 03 | `Engine.ts` unter den Deckel teilen | 00 | ja |
| 04 | Entscheidungsvorlage Frame-Wechsel-Schwellen | 00 | nein |
| 05 | Stufe 2b: Kamera hängt um | 01–04 | ja |
| 06 | Stufe 2c: Körper und Katalog migrieren | 05 | ja |
| 07 | Touch-Gesten: Globus folgt dem Finger | 00 | ja |
| 08 | Orbit-Griff über den Rand, Zwei-Finger-Drehen | 07 | ja |
| 09 | Kamera-Gefühl: Nachlauf, Drehschwelle, gleichmäßiger Orbit, `?feel=` | 08 | ja |
| 10 | Gleitflug — Pinch ist Schub, die Bewegung gleitet weiter | 09 | ja |
| 11 | Tuning-Panel — Gefühlswerte live mit Reglern abstimmen | 10 | ja |

**Eine nach der anderen.** 01–04 hängen nicht voneinander ab, aber parallele PRs kollidieren in
`package.json` (Version), `docs/contracts.md` und Leitfaden §2/§11. Für ein Einpersonenprojekt kostet
das Auflösen mehr, als die Parallelität spart.
