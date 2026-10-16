# Spickzettel für den Inhaber

Alles für die nächsten Sessions. Texte in grauen Kästen: auf dem Tablet antippen → Kopier-Symbol oben rechts.

**Grundregel:** immer nur **eine** Aufgabe gleichzeitig. Erst mergen, dann die nächste starten.

---

## Jede Session in fünf Schritten

1. **Issue anlegen** — Repo → *Issues* → *New issue*. Titel und Text aus dem Abschnitt der Session
   unten kopieren, rechts bei *Labels* `jules` wählen, *Create*.
2. **Plan prüfen** — auf jules.google erscheint die Aufgabe nach ein, zwei Minuten. Drei Fragen:
   Nennt er die Aufgabendatei? Zitiert er das *Fertig, wenn*? Stimmen die Dateien mit der Liste unten
   überein? → Ja: bestätigen. Nein: ins Chatfeld schreiben, was nicht passt, **dann** bestätigen.
3. **Warten** — bis Jules den PR verlinkt. Nichts tun nötig.
4. **PR prüfen** — im PR:
   - unten: `check (22.16)` und `check (24)` grün
   - Reiter *Files changed*: nur Dateien aus der Liste unten
   - Beschreibung: *Bewertung: erfüllt*, *Testausgabe* mit Zahlen, *Auf dem Tablet prüfen*
5. **Tablet-Test, dann mergen** — wenn die Session einen Tablet-Test hat: Netlify-Kommentar
   „Deploy Preview ready" → Link öffnen → Schritte machen. Dann *Merge pull request* →
   *Confirm merge* → *Delete branch*.

---

## Session 1 — Aufgabe 01: Frame-Baum

```
01 Stufe 2a: Frame-Baum
```
```
Bearbeite docs/aufgaben/01-stufe-2a-frame-baum.md nach AGENTS.md.
```

**Erwartete Dateien:** `src/frames/FrameTree.ts` (neu, evtl. zusätzlich `src/frames/types.ts`) ·
`tools/test-frames.ts` (neu) · `package.json` · `tools/contracts.mjs` · `docs/contracts.md` ·
`docs/leitfaden.md` · die Aufgabendatei

**Genau hinschauen:**
- In `tools/contracts.mjs` darf nur **eine** grüne Zeile dazukommen: `'src/frames/',`
- In der *Testausgabe* stehen Zahlen für alle sechs Kriterien. Besonders Nr. 4, die **Gegenprobe**:
  Der naive Weg (ein einziger Weltursprung) muss um viele Größenordnungen schlechter sein als 1 µm.
  Fehlt diese Zahl, beweist der Test nichts → nachfragen.

**Tablet-Test:** keiner.

---

## Session 2 — Aufgabe 02: SpaceCamera teilen

```
02 SpaceCamera.ts unter den Dateideckel teilen
```
```
Bearbeite docs/aufgaben/02-spacecamera-teilen.md nach AGENTS.md.
```

**Erwartete Dateien:** `src/camera/SpaceCamera.ts` · höchstens zwei **neue** Dateien in
`src/camera/` · `tools/contracts.mjs` · `docs/contracts.md` · `package.json` · `docs/leitfaden.md` ·
die Aufgabendatei

**Genau hinschauen:**
- `src/core/Engine.ts` darf **nicht** in der Liste stehen.
- In `tools/contracts.mjs` verschwindet genau eine Zeile (rot):
  `'src/camera/SpaceCamera.ts': 476,`

**Tablet-Test** (in der Vorschau, alles muss sich anfühlen wie vorher):
1. Erde fokussieren, Schubregler hoch, Stufe ×10 → zum Mond fliegen
2. Regler loslassen → die Kamera bremst relativ zum Mond
3. Zeitraffer auf ×10⁶ → die Kamera bleibt über dem Mond
4. Doppeltipp auf die Sonne → Anflug
5. Gesten: ein Finger drehen (läuft nach), Pinch, zwei Finger verschieben, einmal über den Pol schwenken

---

## Session 3 — Aufgabe 03: Engine teilen

```
03 Engine.ts unter den Dateideckel teilen
```
```
Bearbeite docs/aufgaben/03-engine-teilen.md nach AGENTS.md.
```

**Erwartete Dateien:** `src/core/Engine.ts` · höchstens zwei **neue** Dateien in `src/core/` ·
`tools/contracts.mjs` · `docs/contracts.md` · `package.json` · `docs/leitfaden.md` · die Aufgabendatei

**Genau hinschauen:**
- `src/camera/…` darf **nicht** in der Liste stehen.
- In `tools/contracts.mjs` verschwindet genau eine Zeile (rot): `'src/core/Engine.ts': 496,`

**Tablet-Test:** wie Session 2, zusätzlich jeden Knopf einmal antippen (Zeitraffer ≪ ≫ ❚❚, Ziel ◀ ▶,
Zoom − +, ASSIST, STOP) und prüfen, dass das HUD Höhe, Geschwindigkeit und Terrain-Backend zeigt.

---

## Session 4 — Aufgabe 04: Entscheidung Frame-Wechsel

```
04 Entscheidungsvorlage Frame-Wechsel-Schwellen
```
```
Bearbeite docs/aufgaben/04-entscheidung-frame-schwellen.md nach AGENTS.md.
```

**Erwartete Dateien:** nur `docs/leitfaden.md`, die Aufgabendatei, `package.json`. **Kein Code.**

**Ablauf anders als sonst — erst entscheiden, dann mergen:**
1. Im PR auf *Files changed* → `docs/leitfaden.md` → die Optionen A, B, C in §9 lesen.
2. Unsicher? Den Abschnitt kopieren und Claude in einem kurzen Chat um eine zweite Meinung bitten.
   Das ist eine Architekturentscheidung — dafür lohnt es sich.
3. Im PR kommentieren (Buchstaben einsetzen):
   ```
   @Jules Ich entscheide mich für Option B. Bitte in §9 als entschieden mit Datum eintragen und die Aufgabe auf erledigt setzen.
   ```
4. Warten, bis Jules nachgelegt hat und die Checks grün sind → mergen.

**Tablet-Test:** keiner.

---

## Danach: Aufgaben 05 und 06

Das sind die großen Umbauten. Es ist **zu erwarten**, dass Jules dort nicht anfängt, sondern eine
Teilung vorschlägt (Status `blockiert`, drei Sätze im PR). Das ist kein Fehler. Antwort:

```
@Jules Einverstanden mit der Teilung. Lege die Teilaufgaben als neue Dateien nach dem Muster in docs/aufgaben/README.md an, nur Doku, in diesem PR.
```

Danach mergen und die erste Teilaufgabe wie gewohnt per Issue starten.
Für 05 und 06 lohnt sich, wenn möglich, das stärkere Modell (Pro-Plan).

---

## Kommentare zum Kopieren

```
@Jules bitte die PR-Beschreibung vollständig nach .github/pull_request_template.md ergänzen.
```
```
@Jules der Check ist rot. Bitte beheben, ohne Tests abzuschwächen oder zu löschen.
```
```
@Jules bitte nur die Dateien aus der Aufgabe ändern. Diese Datei gehört nicht dazu: 
```
```
@Jules in der Vorschau sehe ich Folgendes: … Erwartet war: … 
```

---

## Warnzeichen in *Files changed*

Nachfragen oder nicht mergen, wenn eins davon auftaucht:
- eine Datei, die nicht in der Liste der Session steht
- `AGENTS.md`, `SPICKZETTEL.md`, `.github/…` oder `netlify.toml`
- in `package.json` neue Einträge unter `"dependencies"` oder `"devDependencies"`
- in `tools/test-….ts` viele rote Zeilen, obwohl die Aufgabe keine Tests umbauen soll

---

## Wenn etwas hakt

| Was | Was tun |
|---|---|
| Jules reagiert nicht aufs Issue | Label genau `jules`? Hat Jules Zugriff auf das Repo? Tageslimit (15) erreicht? |
| Check rot | 15 Minuten warten, Jules repariert selbst. Dann Kommentar oben. |
| Kein Netlify-Link im PR | Netlify → Projekt → Deploy Previews für Pull Requests einschalten |
| PR völlig daneben | *Close pull request* (nicht mergen). Neues Issue mit gleichem Text, darunter ein Satz, was beim ersten Mal schiefging. |
| Merge-Knopf grau | Ein Check ist noch nicht grün — das ist der Schutz von `main`, nicht kaputt. |

**Grenzen:** Jules ~15 Aufgaben pro Tag (Free). Netlify ~20 Merges pro Monat frei, Vorschauen kosten nichts.
