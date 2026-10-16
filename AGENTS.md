# AGENTS.md — Arbeitsanweisung für KI-Agenten

Dieses Repo ist ein physikalisch realistischer Weltraumsimulator im Tablet-Browser
(TypeScript, `three@0.171` mit WebGPU, Vite). Der Inhaber schaut nur gelegentlich vom
Tablet herein. Du arbeitest also weitgehend allein — diese Regeln ersetzen das Gespräch,
das sonst stattfinden würde. Gilt für jedes Werkzeug (Jules, Gemini CLI, Antigravity, …).

## Rangfolge

1. diese Datei — *wie* gearbeitet wird
2. `docs/leitfaden.md` — *was* und *warum*: Zielbild §1, Kanon §4, Stufenplan §7
3. der Aufgabentext

Widerspricht eine Aufgabe dem Kanon (§4), löst du das nicht selbst auf: **eskalieren** (unten).

## Vor jeder Aufgabe lesen — und sonst nichts

- `docs/leitfaden.md` §1, §4 und in §7 nur die Stufe der Aufgabe
- `docs/contracts.md` — die Vertragskarte (Exporte, Signaturen, Abhängigkeiten, three-Status).
  Sie ist der Einstieg, nicht der Quelltext.
- die Aufgabendatei in `docs/aufgaben/`
- die Dateien, die die Aufgabe nennt

## Ablauf: eine Aufgabe = ein Branch = ein PR

1. **Aufgabe wählen.** Die genannte; sonst die erste Datei in `docs/aufgaben/` mit
   `status: offen`, deren `braucht:` alle `erledigt` sind. Gibt es keine: nichts ändern, das melden.
2. **Plan.** Ziel und *Fertig, wenn* wörtlich zitieren, Dateiliste mit je einem Satz Begründung.
   Braucht der Plan mehr als fünf Dateien (generierte und Versionsnummer nicht mitgezählt),
   ist die Aufgabe zu groß → eskalieren, nicht anfangen.
3. **Umsetzen.** Nur Dateien der Liste ändern. Immer erlaubt: `docs/contracts.md` (generiert),
   `package.json` (Version, Testskripte), die eigene Aufgabendatei (Status),
   `docs/leitfaden.md` §2, §9 und §11.
4. **Prüfen.** `npm run contracts`, dann `npm run check` — muss grün sein.
   Nie einen Test abschwächen, löschen, überspringen oder seine Toleranz lockern, um grün zu werden.
5. **Version.** `package.json`: Patch +1 je Aufgabe; Minor +1, wenn damit eine Stufe aus §7
   vollständig abgeschlossen ist (Stufe 2 komplett → 0.5.0).
6. **Abschluss.** Aufgabendatei auf `status: erledigt`, Leitfaden §2/§11 nachführen, PR nach
   `.github/pull_request_template.md`. Nie direkt auf `main`.
7. **CI.** Wird der PR-Check rot, beheben — mit derselben Regel wie in Schritt 4.

## Eskalation statt stiller Umplanung (Leitfaden §12.2)

Abbrechen, wenn: mehr Dateien nötig sind · eine Invariante aus §4 im Weg steht · eine Annahme der
Aufgabe falsch ist · ein Test nur durch Abschwächen grün würde · eine Abhängigkeit geändert werden
müsste · eine Entscheidung ansteht, die die Aufgabe dem Inhaber zuweist.

Dann: Arbeitsstand verwerfen oder als Entwurf lassen, Aufgabendatei auf `status: blockiert`,
Befund in Leitfaden §9 eintragen, und im PR bzw. in der Rückfrage **drei Sätze**: was geplant war,
was die Realität ist, welche Optionen es gibt (mit Empfehlung). Nicht am stillschweigend
veränderten Ziel weiterarbeiten — auf genau diesem Weg geht das Zielbild verloren.

## Harte Regeln (Kurzfassung von §4 — Begründungen im Leitfaden)

- **Präzision:** Weltkoordinaten in f64 (`Vector3d`, `Vec3`). Nichts, was in Metern > ~10⁶ ist,
  in f32. Auf die GPU nur kamerarelative Differenzen, vorher in f64 subtrahiert.
- **Physik analytisch:** Bahnen über Kepler. **Kein** numerischer Integrator (Euler, Runge-Kutta,
  Verlet …) als Ersatz — auch nicht „nur für die Physik". Störungen später nur als additive Schicht.
- **Three-freie Rechenkerne:** `src/nav/`, `tileGeometry.ts`, `noise.ts`, `rng.ts` und jeder neue
  Kern. Neue Kerne in `THREE_FREE` in `tools/contracts.mjs` eintragen; `check` prüft auch transitiv.
- **Frame-Budget:** nichts, was > 0,5 ms kostet, im Frame bauen. Teures asynchron, nach Distanz priorisiert.
- **Determinismus:** Prozedurales nur aus `hash32(Kontext…)` → `mulberry32`. Kein `Math.random`,
  kein globaler Zähler als Seed.
- **Dateideckel 300 Zeilen** in `src/`. Bestandsdateien darüber dürfen nicht wachsen (Ratsche in
  `tools/contracts.mjs`) — wer dort etwas hinzufügen muss, teilt zuerst.
- **Abhängigkeiten:** `three@0.171` bleibt gepinnt. Keine neuen Pakete, keine Upgrades.
- **Stil:** Bezeichner englisch, Kommentare deutsch und knapp. Interfaces über `import type`;
  keine Parameter-Properties in Konstruktoren von Dateien, die Offline-Tests laden (Node-Type-Stripping).

## Nicht anfassen

`AGENTS.md`, `.github/`, `netlify.toml`, Leitfaden §1/§4/§7/§12, die Konfiguration in
`tools/contracts.mjs` (Ausnahme: `THREE_FREE` darf wachsen, `CAP_BASELINE` darf schrumpfen —
der Check sagt, wann). Änderungsbedarf daran → eskalieren.

## three.js, TSL, WebGPU — nicht raten

Die TSL-/WebGPU-API von three bewegt sich von Version zu Version; dein Trainingswissen passt
oft zu einer anderen. Maßgeblich ist, was installiert ist:

- `node_modules/three/src/nodes/` (TSL), `node_modules/three/src/renderers/webgpu/`
- `node_modules/three/examples/jsm/` und `node_modules/three/examples/webgpu_*.html`
- Typen: `node_modules/@types/three/src/`

Vor jeder TSL- oder WebGPU-Nutzung dort nachsehen. Muster aus Doku oder Beispielen einer anderen
Version nicht übernehmen. Ein Typfehler ist ein Hinweis auf eine falsche API, kein Grund für
`as unknown as`.

## Was du nicht prüfen kannst — und wie du damit umgehst

Renderpfad, WebGPU-Verhalten und Touch sind offline nicht prüfbar. Deshalb:

- Jeder neue unprüfbare Pfad bekommt einen **Laufzeit-Selbsttest mit stillem Fallback**
  (Muster: `src/terrain/gpuTerrain.ts` vergleicht gegen die CPU-Referenz).
- Jeder PR, der Dateien außerhalb der three-freien Kerne ändert, enthält im Abschnitt
  **„Auf dem Tablet prüfen"** konkrete Schritte: was tun, was sehen, woran ein Fehler erkennbar
  wäre. Der Inhaber prüft das in der Netlify-Vorschau des PR.
- Behaupte nie, etwas „funktioniere sichtbar". Du hast es nicht gesehen.

## Tests

- Jeder neue Rechenkern bekommt einen Offline-Test `tools/test-<name>.ts` (Mini-Harness wie in
  `tools/test-nav.ts`, Ausgabe deutsch), ein Skript in `package.json` und hängt in `npm test`.
- Was pro Frame passiert, über mehrere Frameraten testen (20–120 fps), nicht nur bei 60.
- Ein Test, der eine Präzisionsaussage macht, enthält eine **Gegenprobe**: dieselbe Rechnung auf
  dem naiven Weg muss messbar schlechter sein. Sonst beweist er nichts.

## Umgebung

Node ≥ 22.6 (die Testskripte setzen `--experimental-strip-types`). Einrichtung: `npm ci`.
Lokal starten: `npm run dev`. Keine Systempakete, keine Netzzugriffe zur Laufzeit.
