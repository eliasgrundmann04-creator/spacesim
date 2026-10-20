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

## Reihenfolge (Stand v0.4.16)

| id | Aufgabe | braucht | tablet |
|---|---|---|---|
| 00 | Probelauf: doppeltes `formatDistance` auflösen | — | ja |
| 01 | Stufe 2a: Frame-Baum als Datenstruktur | 00 | nein |
| 02 | `SpaceCamera.ts` unter den Deckel teilen | 00 | ja |
| 03 | `Engine.ts` unter den Deckel teilen | 00 | ja |
| 04 | Entscheidungsvorlage Frame-Wechsel-Schwellen | 00 | nein |
| 05 | Stufe 2b: Kamera hängt um | 01–04 | ja |
| 06 | Stufe 2c: Körper und Katalog migrieren — *Entwurf, wird nach 22 neu geschnitten* | 15, 22 | ja |
| 07 | Touch-Gesten: Globus folgt dem Finger | 00 | ja |
| 08 | Orbit-Griff über den Rand, Zwei-Finger-Drehen | 07 | ja |
| 09 | Kamera-Gefühl: Nachlauf, Drehschwelle, gleichmäßiger Orbit, `?feel=` | 08 | ja |
| 10 | Gleitflug — Pinch ist Schub, die Bewegung gleitet weiter | 09 | ja |
| 11 | Tuning-Panel — Gefühlswerte live mit Reglern abstimmen | 10 | ja |
| 12 | Automatisches Tempo — Anflug nach Kontaktzeit, Stufe läuft zur Umgebung zurück | 11 | ja |
| 13 | Fix: Kamera bleibt bei Zeitraffer über dem Anker — Mitführung über die Verschiebung | 12 | ja |
| 14 | B1: Messpunkte im HUD — Bildzeit-Perzentile, CPU je Phase, Draw/Tri/Geo | 13 | ja |
| 15 | B2: Messlauf `?bench` und Leistungsprotokoll `docs/leistung.md` | 14 | ja |
| 16 | B3: Frustum- und Horizont-Culling für Kacheln | 22 | ja |
| 17 | B4: Instancing — alle Sternglows in einem Draw-Call | 22 | ja |
| 18 | B5: Lichtbudget — zwei Lichtplätze statt ein Licht pro Stern | 17 | ja |
| 19 | B6: Speicherbudget für Kacheln mit Verdrängung | 16 | ja |
| 20 | B7: Entscheidungsvorlage — wann ferne Systeme entladen werden | 06, 19 | nein |
| 22 | Stufe 2b nachziehen: Rahmenwechsel im echten Frame-Loop, ohne stilles Überspringen | 15 | ja |

**Eine nach der anderen.** 01–04 hängen nicht voneinander ab, aber parallele PRs kollidieren in
`package.json` (Version), `docs/contracts.md` und Leitfaden §2/§11. Für ein Einpersonenprojekt kostet
das Auflösen mehr, als die Parallelität spart.

## Nebenspur B — Leistung prüfen, nicht sammeln

Leitfaden §7, Nebenspur B: *Nach jeder Kernstufe kurz prüfen, nicht am Ende sammeln.* Ab Aufgabe 15
gibt es dafür den Messlauf `?bench` und das Protokoll `docs/leistung.md`. Eine neue Zeile ist fällig:

- in jeder Aufgabe, die eine Stufe aus §7 abschließt (Minor-Version), und in jeder B-Aufgabe;
- im Abschnitt *Auf dem Tablet prüfen* als letzter Schritt: `?bench` laufen lassen, Ergebnis als
  PR-Kommentar einfügen, der Agent trägt die Zeile im selben PR ein;
- jede Optimierung bringt einen Abschalter mit (`?cull=0`, `?stars=legacy`, `?lights=all`, `?mem=0`),
  damit der Vergleich im selben Build gelingt.

Steigt Bild-p95 an einem Halt um mehr als 20 % gegenüber der Vorzeile, ist das ein Pflichteintrag in
Leitfaden §9 — kein Merge-Verbot, aber nicht stillschweigend.

Reihenfolge (Stand v0.4.16, nach Rücknahme von 06): **14 → 15 → 22 → 16–19**, 06 sobald neu geschnitten, 20 nach 06 und 19.
14 und 15 zuerst, weil sich ohne Messung keine Maßnahme bewerten lässt und v0.4.16 eine saubere
Basiszeile liefert. 22 legt das Fundament, auf dem 06 neu aufsetzt; 16 und 17 warten auf 22, damit die
Warteschlange (erste offene Datei nach Nummer) diese Reihenfolge von selbst einhält. Den Neuschnitt von
06 beauftragt der Inhaber; danach wird 06 gegen die Basiszeile gemessen. Die frühere Aufgabe 21 (Fix nach 06) ist mit der Rücknahme entfallen.
