---
id: 09
titel: Kamera-Gefühl — längerer Nachlauf, späteres Drehen, gleichmäßiger Orbit, Werte per URL
status: offen
braucht: [08]
stufe: —
tablet: ja
---

## Ziel

Drei Rückmeldungen des Inhabers vom Tablet nach Aufgabe 08. Alle drei sind Einstellwerte der
vorhandenen Kerne (`dragKernel.ts`, `fling.ts`), keine neue Mechanik:

1. **Nachlauf zu kurz.** Nach dem Loslassen soll die Drehung deutlich länger und weicher auslaufen.
   Ursache: `SPIN_TAU = 0.2 s`; der Gesamtnachlauf ist ω · τ, also sehr kurz.
2. **Zwei-Finger-Drehen setzt zu früh ein.** Beim Pinch-Zoom oder mit zwei ruhenden Fingern beginnt
   das Bild zu „eiern". Ursache: `TWIST_START = 8°` ist die einzige Schwelle; ein natürlicher Pinch
   verdreht die Fingerlinie leicht mehr als das.
3. **Orbit wird zum Rand hin schneller.** Finger auf dem Körper ansetzen und gleichmäßig über den Rand
   hinaus ziehen ⇒ die Umkreisung beschleunigt trotz konstantem Streichtempo. Ursache: `GRAB_EDGE = 4`
   — der exakte Griff darf bis zur 4-fachen Rate der Bildmitte hochlaufen, bevor das Randprofil
   übernimmt. Das ist die Kehrseite des „Punkt klebt unter dem Finger" aus Aufgabe 07: Exakter Griff
   und gleichmäßige Rate schließen sich zum Rand hin aus. **Auftrag des Inhabers:** gleichmäßiges
   Streichen ergibt gleichmäßige Umkreisung. Der Griff bleibt in der Bildmitte exakt, die Zone wird
   kleiner (`grabEdge` 1,5); den endgültigen Wert stimmt der Inhaber per URL ab.

Dazu: Alle Gefühlswerte werden per URL überschreibbar, damit der Inhaber sie in der Netlify-Vorschau
selbst abstimmen kann, ohne für jeden Wert einen PR zu brauchen.

## Fertig, wenn

Offline-Test `tools/test-drag.ts` (neue Abschnitte, bestehende Prüfungen bleiben grün — Erwartungswerte
dort, wo sie die alten Konstanten fest eingebaut haben, auf `FEEL` umstellen, nicht abschwächen):

- **Parameterbank:** `parseFeel('?feel=spinTau:1.4,twistStartDeg:25')` setzt genau diese zwei Werte;
  unbekannte Schlüssel und nicht-endliche Werte werden ignoriert; Werte außerhalb des Bereichs werden
  geklemmt (Bereiche in `feel.ts` dokumentiert). Ohne Parameter gelten die Standardwerte unten.
- **Nachlauf:** Mit `spinTau` = Standardwert ist der Gesamtweg ω · τ, bei 20/60/120 fps gleich
  (< 1e-9 rad, wie bisher). Kein Wurf nach Ruhen (wie bisher).
- **Orbit gleichmäßig:** Radialer Zug von der Scheibenmitte bis 300 px hinter den Rand, in 1-px-Schritten,
  bei d = 1,001 R, 3 R und 15 R: max/min der Drehung je px ≤ `grabEdge` · 1,05. Gegenprobe mit
  `grabEdge = 4` reproduziert das alte Verhältnis (> 3). Stetigkeit am Rand (Stufe ≤ 5 %) wie in 08.
- **Drehen nur mit Absicht** (synthetische Zwei-Finger-Spuren, Fingerabstand 200 px):
  - Pinch auf 60 % bzw. 140 % Abstand mit 12° Mitverdrehung ⇒ Σ z = 0.
  - Erst Pinch um ≥ `pinchLockPx`, danach 40° reine Drehung ⇒ Σ z = 0 (Sperre bis zum Loslassen).
  - Zwei ruhende Finger, 2 px Zufallsrauschen je Finger, 3 s bei 60 fps ⇒ Σ z = 0.
  - Reine Drehung um 45° bei konstantem Abstand ⇒ Σ z = 45° − `twistStartDeg` (± 1e-9), kein Sprung
    beim Einrasten, danach 1:1 in beide Richtungen (wie in 08).
- `npm run check` grün; `cameraTouch.ts` wächst nicht.

## Standardwerte (Startpunkt, Feinabstimmung macht der Inhaber per URL)

| Schlüssel | bisher | neu | Bereich | Wirkung |
|---|---|---|---|---|
| `spinTau` | 0,2 s | 0,8 s | 0,05–3 | Nachlaufdauer; Gesamtweg = ω · τ |
| `maxSpin` | 12 rad/s | 12 rad/s | 1–30 | Deckel der Wurfgeschwindigkeit |
| `flingRest` | 0,05 s | 0,05 s | 0,02–0,3 | so lange still ⇒ kein Wurf |
| `grabEdge` | 4 | 1,5 | 1,05–6 | wie viel schneller der exakte Griff zum Rand werden darf |
| `edgeFadePx` | 150 | 150 | 20–600 | Übergang hinter der exakten Zone auf die Orbit-Rate |
| `twistStartDeg` | 8 | 20 | 0–60 | Drehwinkel bis zum Einrasten |
| `twistDominance` | — | 1,5 | 0–5 | Bogenlänge r̄·\|Σφ\| muss \|Δr\| um diesen Faktor übertreffen |
| `pinchLockPx` | — | 40 | 5–300 | Abstandsänderung, nach der Drehen bis zum Loslassen gesperrt ist |

## Dateien

- `src/nav/feel.ts` (neu, three-frei, DOM-frei) — Objekt `FEEL` mit den Werten oben, `parseFeel(search)`
  und einmalige Übernahme aus `globalThis.location?.search`, falls vorhanden (in Node: Standardwerte).
  Kein Eingriff in `Engine.ts` (über dem Deckel, Aufgabe 03).
- `src/nav/dragKernel.ts` — `GRAB_EDGE`, `EDGE_FADE_PX`, `TWIST_START` aus `FEEL` lesen; `twistTurn`
  um Dominanz und Pinch-Sperre erweitern (Abstand bei `beginTwist` merken; Signatur nach außen gleich).
- `src/nav/fling.ts` — `SPIN_TAU`, `MAX_SPIN`, `FLING_REST` aus `FEEL` lesen.
- `tools/test-drag.ts` — Abschnitte oben.
- `tools/contracts.mjs` — `src/nav/feel.ts` in `THREE_FREE`.

`cameraTouch.ts` bleibt unverändert. Stellt sich heraus, dass das nicht geht, oder dass der Orbit-Befund
eine andere Ursache als `GRAB_EDGE` hat: nach §12.2 abbrechen und berichten.

## Hinweise

- Die Konstanten-Exporte dürfen bleiben (als Getter auf `FEEL` oder entfernt, wenn nur Tests sie nutzen) —
  wichtig ist, dass zur Laufzeit genau eine Quelle gilt.
- `exactLimit` ist für `grabEdge → 1` entartet (Zone 0); deshalb die Untergrenze 1,05.
- Die Pinch-Sperre gilt ab dem Moment, in dem |Δr| seit Pinch-Beginn `pinchLockPx` überschreitet,
  *bevor* das Drehen eingerastet ist. Ist es schon eingerastet, bleibt es aktiv.
- Unbekannte URL-Schlüssel mit einer Konsolenwarnung melden (nur im Browser).

## Nicht-Ziele

Nachlauf für Pinch-Zoom, Knopf „Norden oben", Änderungen an Freiflug-Rate oder Zwei-Finger-Schwenk,
Bezugsrahmen (Stufe 2b).

## Auf dem Tablet prüfen

1. Finger in der Scheibenmitte ansetzen, gleichmäßig weit über den Rand hinaus ziehen ⇒ die Umkreisung
   bleibt gleichmäßig.
2. Nahe am Rand ansetzen und weiterziehen ⇒ gleiches Tempo wie aus der Mitte.
3. Schnell wischen und loslassen ⇒ weiches Auslaufen über gut eine Sekunde.
4. Langsam ziehen, Finger anhalten, abheben ⇒ kein Nachlauf.
5. Pinch-Zoom mit natürlicher Mitverdrehung ⇒ das Bild dreht sich nicht.
6. Zwei Finger nur auflegen ⇒ nichts bewegt sich.
7. Bewusst mit zwei Fingern drehen ⇒ Drehen setzt weich ein.
8. Vorschau-Adresse mit `?feel=spinTau:1.5,grabEdge:1.1,twistStartDeg:30` laden ⇒ Unterschied spürbar.

## Abschluss

Leitfaden §2 (Kamera-Absatz: Gefühlswerte in `nav/feel.ts`, per `?feel=` überschreibbar) und §11.
`package.json` Patch +1.
