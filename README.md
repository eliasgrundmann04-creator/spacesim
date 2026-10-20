# Space Sim — Navigation (v0.5.0)

Physikalisch realistischer Weltraumsimulator (SpaceEngine-Stil).
TypeScript · Three.js (WebGPU-Renderer, `three/webgpu`) · Vite.

**Neu in v0.5 — Stufe 2 „Verschachtelte Bezugsrahmen" komplett.** Jedes System, jeder Stern und jeder Planet besitzt nun seinen eigenen lokalen Bezugsrahmen (`FrameNode`). Körperpositionen und Kepler-Propagation werden lokal im jeweiligen System-Frame gerechnet. Dadurch sind Sternpositionen in 100.000 Lj und ein Fels auf der Erdoberfläche im selben Programmlauf ohne Präzisionsverlust möglich (`tools/test-stage2.ts`), und Bahngeschwindigkeiten ferner Systeme weisen bei 3 Lj keinen f64-Rundungsverlust mehr auf (`tools/test-orbit.ts`).

**Neu in v0.4.1 — Umzug auf Agent-Betrieb.** Das Repo enthält jetzt den Quellbaum statt eines ZIPs. Agenten arbeiten nach [`AGENTS.md`](AGENTS.md), Aufgaben stehen in [`docs/aufgaben/`](docs/aufgaben/), der Leitfaden in [`docs/leitfaden.md`](docs/leitfaden.md). `npm run check` bündelt Typecheck, alle Tests, Vertragskarte ([`docs/contracts.md`](docs/contracts.md)) und Produktionsbuild und läuft in der CI auf jedem PR. Nebenbei behoben: drei Typfehler, die ohne `node_modules` unsichtbar blieben und `npm run build` scheitern ließen, und Testskripte, die unter Node 22.6–22.17 gar nicht starteten.

**Neu in v0.4 — drei Hardware-Befunde behoben.** Alle drei traten nur auf dem Tablet auf und blieben von den 51 Offline-Tests der v0.3 unentdeckt, weil diese ausschließlich bei 60 fps und ohne Worker-Ausfälle liefen. Ausführlich unter *Was v0.4 repariert*; die Kurzfassung:

1. **Blickachse ohne Anschlag.** Die Orientierung ist jetzt ein Quaternion statt `theta/phi`. Kein Pol-Clamp mehr, und diagonale Schwenks folgen der Geste an jeder Stelle der Kugel gleich.
2. **Kachel-Pipeline übersteht tote Worker.** Ein verstummter Worker belegte seinen Platz dauerhaft; nach wenigen Fällen entstand keine Kachel mehr und ein frisch erzeugter Planet blieb unsichtbar. Jetzt mit Wachhund, Wiederholung und hartem Fallback.
3. **Geschwindigkeit ist framerate-unabhängig.** Der Deckel war implizit *pro Frame* statt pro Sekunde formuliert und wanderte mit dem Frame-Jitter mit.

*Neu in v0.3 — Stufe 1 „Navigation & Übergänge":* freier Flug mit skalenfreiem Geschwindigkeitsmodell, weiche Zielübergänge im Log-Raum statt Sprüngen, Winkel-Picking per Doppeltipp, Schubregler. Details unten unter *Navigation*.

*Neu in v0.2:* asynchrone Terrain-Erzeugung (Web-Worker-Pool + optionaler WGSL-Compute-Pfad via TSL) und vollständige Touch-Bedienung inkl. Pinch-to-Zoom.

## Setup

Voraussetzungen: Node ≥ 22.6. WebGPU: Chrome/Edge 113+ (andere Browser nutzen automatisch den WebGL2-Fallback des `WebGPURenderer`).

```bash
npm ci
npm run dev        # → http://localhost:5173
npm run check      # alles Prüfbare: Typecheck, Tests, Vertragskarte, Build
```

Geschrieben gegen `three@0.171` / `@types/three@0.171` (gepinnt).

Offline-Prüfungen (brauchen weder Netz noch `node_modules`, Node ≥ 22.6):

```bash
npm test                    # alle vier Suiten nacheinander — 97 Tests
npm run test:nav            # 41 Tests der Navigationskerne
npm run test:orbit          # 10 Tests der Kepler-Zustandspropagation
npm run test:orientation    # 19 Tests des Quaternion-Kerns          (neu in v0.4)
npm run test:throughput     # 27 Tests Geschwindigkeit + Kachel-Queue (neu in v0.4)
npm run typecheck           # strikt; ohne node_modules bleiben nur TS2307 übrig
```

## Steuerung

| Touch | Maus/Tastatur | Wirkung |
|---|---|---|
| Ein Finger ziehen | Ziehen | Orbit: um das Ziel rotieren · Freiflug: Blickrichtung drehen — **unbegrenzt in jede Richtung**, über den Pol hinweg, läuft mit Drehimpuls aus |
| **Pinch** (zwei Finger) | Scrollen | Orbit: exponentieller Zoom · Freiflug: Schub entlang der Blickachse |
| **Schubregler** (rechts) | — | Vorwärts/rückwärts fliegen; federt beim Loslassen auf 0 zurück |
| **`− ×N +`** | — | Geschwindigkeitsstufe, √10 pro Schritt, ×0,001 … ×100 |
| **`ASSIST`** | — | Relativgeschwindigkeit zum Ankerkörper ausdämpfen (an = Standard) |
| **`STOP`** | — | Sofortiger Vollstopp relativ zum Anker |
| **Doppeltipp auf einen Körper** | Doppelklick | Anflug starten |
| ◀ ▶ | Tab / Shift+Tab | Ziel durchschalten — ab v0.3 als sichtbarer Flug |
| − + | Scrollen | Zoomen bzw. schieben in Stufen |
| ≪ ×n ≫ ❚❚ | `,` `.` `0` `P` | Zeitraffer langsamer / schneller / zurücksetzen / Pause |
| — | 1–9 | Direktwahl (1 = Sonne, 4 = Erde, 5 = Mond, …) |

Der Pinch-Faktor wird direkt als Multiplikator verwendet: Fingerabstands-*Verhältnis*, exponentieller Zoom und das Geschwindigkeitsmodell sind alle drei multiplikativ, deshalb fühlt sich die Geste über alle 20 Größenordnungen gleich an.

Demo-Pfad: Erde fokussieren → Schubregler nach oben, Stufe ×10 → in wenigen Sekunden zum Mond fliegen, ganz ohne Zielauswahl → Regler loslassen, die Assistenz bremst relativ zum Mond aus → Zeitraffer auf ×10⁶ stellen: die Kamera bleibt über dem Mond stehen, statt zurückzufallen → Doppeltipp auf die Sonne für einen Anflug → mit ▶ einen `PSC-*`-Stern wählen, sein System wird beim Anflug lazy generiert.

## Navigation (Stufe 1)

**Geschwindigkeit ∝ Referenzhöhe ⇒ logarithmische Flugzeit.** `v = rate · h · speedScale` ergibt `dh/dt = ±rate·h`, also `h(t) = h₀·e^(±rate·t)`. Die Flugzeit hängt nur vom *Verhältnis* der Höhen ab: von 2 m auf 1 AE dauert genauso lange wie zurück und in derselben Größenordnung wie ein Flug zum Nachbarstern. Der Offline-Test misst Erde↔Mond mit 24,10 s hin und 24,10 s zurück — die Symmetrie ist die Aussage des Modells, nicht Zufall. Untergrenze `minAltitude = 2 m`, sonst wäre die Oberfläche asymptotisch unerreichbar (Zeno).

**Weiches Minimum im Logarithmus der Höhe.** Ein hartes `min` über alle Körper springt, sobald beim Vorbeiflug ein anderer Körper der nächste wird. Gemischt wird deshalb weich — aber im Logarithmus, weil die Höhen über 20 Größenordnungen streuen. Verwendet wird der gewichtete Boltzmann-Mittelwert, **nicht** log-sum-exp: Letzteres zieht das Ergebnis mit jedem weiteren gleich weit entfernten Körper nach unten, 200 Sterne in gleicher Distanz ergäben eine fünffach zu niedrige Referenz.

**Der Flugzustand ist die *ankerrelative* Geschwindigkeit.** Bei Time-Warp ×10⁸ rast die Erde mit ~10¹² m/s durch den Weltframe. Dämpfte die Assistenz eine *Welt*geschwindigkeit auf null, bliebe man beim Einschalten des Warps um `v_Rahmen · τ` zurück — der Planet wäre weg. Gespeichert wird deshalb die Geschwindigkeit relativ zum Anker; die Rahmengeschwindigkeit kommt analytisch aus Kepler (neu: `CelestialBody.velocity`, entlang desselben Baums akkumuliert wie die Position) und wird ohne Übergangszeit addiert. Beim Ankerwechsel wird nur so viel Trägheit übernommen, wie die eigene Bewegungsskala verträgt — bei realistischem Tempo bleibt sie erhalten, bei Warp gewinnt die Mitführung. Sauber löst das erst der Frame-Baum (Stufe 2).

**Anflug relativ zum Ziel, nicht absolut.** `ln d(τ) = lerp(ln d₀, ln d₁, smootherstep(τ))` — konstante *relative* Annäherung, dieselbe Größe wie im freien Flug. Die Bahn wird jedes Frame gegen die *aktuelle* Zielposition ausgewertet; bei hohem Warp legt der Mond während eines 3,4-s-Anflugs mehrere Umläufe zurück, ein vorberechneter Weltpfad führte ins Leere. `smootherstep` statt `smoothstep`, weil erste **und** zweite Ableitung an beiden Rändern verschwinden müssen. Die Übergabegeschwindigkeit wird analytisch gerechnet (Ableitung von Log-Interpolation und Slerp) statt per Rückwärtsdifferenz — die hinterließ ~3 km/s Restschließgeschwindigkeit, die Ableitung ist bei τ = 1 exakt null. Dauer: `1,1 s + 0,55 s je e-Faltung + 1,2 s je 180°`, geklemmt auf 1,6 … 8 s.

**Picking im Winkelraum.** Ein Körper kann 10⁻⁹ px oder den halben Bildschirm groß sein; ein fester Pixelradius trifft entweder nichts oder alles. Bewertet wird der Fehlwinkel zum Scheibenrand `miss = max(0, θ − asin(R/d))`, Treffer *innerhalb* der Scheibe gewinnen, davon der nächste — sonst würde ein ferner Stern durch einen Planeten hindurch ausgewählt.

**Zwei Kameramodi, eine Orientierung.** Beide Modi teilen dasselbe Orientierungs-Quaternion; nur die Herkunft der Position unterscheidet sich (Orbit: aus dem Ziel abgeleitet, Freiflug: vom Navigator gesetzt). Dadurch teilen sich beide Modi Eingabe, Drehimpuls und Dämpfung, und der Wechsel ist sprungfrei. Ein Anflug endet im Orbitmodus um das Ziel, ein *abgebrochener* Anflug bleibt im Freiflug.

**Auflösungsbudget und Geschwindigkeitsdeckel sind zwei Dinge** (korrigiert in v0.4). Das *Auflösungsbudget* — pro Substep höchstens 1,5 Referenzhöhen Weg — ist keine Bequemlichkeit: weder Kollisionsprüfung noch LOD könnten einem Sprung folgen, der von 1 AE in den Sonnenkern führt. Deshalb wird der Frame in bis zu `maxSubsteps` Teilschritte zerlegt. Der *Geschwindigkeitsdeckel* ist davon jetzt getrennt und in Referenzhöhen **pro Sekunde** ausgedrückt (`maxReferenceRate = 150`): er liegt über dem gesamten Regelbereich (×100 fordert 90 ref/s) und fängt nur noch extern gesetzten Unsinn ab. Bis v0.3 fiel beides zusammen, siehe unten.

## Was v0.4 repariert

Drei auf dem Tablet beobachtete Fehler. Bei zweien lag die Ursache nicht dort, wo sie sich zeigte — das ist jeweils mit dokumentiert, weil die Fehlspur selbst eine Information ist.

### 1. Die Blickachse ließ sich nicht frei drehen

**Symptom:** Der Blick klemmte kurz vor senkrecht; über den Pol eines Planeten kam man nie. Diagonale Schwenks fühlten sich falsch an.

**Ursache:** Die Orientierung lag als `theta/phi` vor, mit `clamp(phi, 0.02, π − 0.02)`. Das Clamp erklärt den Anschlag — und dieselbe Parametrisierung erklärt auch die Diagonalen: die Wirkung einer waagerechten Geste ist ∝ `sin φ`, nahe dem Pol also praktisch null. Der Azimut staute sich trotzdem auf und schlug beim Zurückschwenken zu. Am Klemmrand degenerierte eine Diagonale vollends zur reinen Drehung um die Hochachse. Zusätzlich entartete `camera.lookAt` genau dort, wo Blickrichtung und `up` kollinear werden.

**Behebung:** neuer three-freier Rechenkern `src/nav/orientation.ts` (§5 des Leitfadens). Die Orientierung ist ein Quaternion; eine Geste `(pitch, yaw)` wird zu **einer** Drehung um die zur Geste senkrechte Kameraachse zusammengefasst:

```
axis = (right·(−yaw) + up·pitch) / |…| ,  Winkel = √(pitch² + yaw²)
```

Damit gibt es keine ausgezeichnete Achse mehr, an der etwas klemmen könnte, und der gedrehte Winkel ist überall exakt `hypot(pitch, yaw)` — am Pol wie am Äquator. `camera.quaternion` wird direkt gesetzt statt über `lookAt`.

**Der Horizont bleibt trotzdem stehen:** eine weiche Roll-Nivellierung dreht pro Frame einen kleinen Bruchteil (`τ = 0,8 s`) der Verkippung gegenüber der lokalen Vertikalen heraus. Sie blendet nahe der Vertikalen aus (dort ist „oben" unbestimmt) und ebenso bei großen Rollwinkeln — wer bewusst über den Pol schwenkt und kopfüber hängt, wird nicht heimlich zurückgedreht. Korrigiert wird Drift, nicht Absicht.

**Nebenwirkung, gratis mitgenommen:** Der Drehimpuls wird jetzt in rad/s aus den Zeitabständen der Pointer-Events geschätzt statt in Pixeln pro Event. Der Nachlauf ist damit unabhängig von der Ereignisrate des Digitizers — auf dem iPad liefert der 120 Hz statt 60.

### 2. Nach einem Anflug blieb das Ziel unsichtbar

**Symptom:** Nach automatischem Goto war der Zielkörper nicht da; Neustart half.

**Nicht die Ursache:** der Floating-Origin-Sync. Die Frame-Reihenfolge in `Engine.frame()` wurde geprüft und ist korrekt — `universe.update` → Orientierung → `stepNavigation` → Kameraplatzierung → `syncToCamera` → `pump` → `render`. Der `SceneManager` sieht immer die Kameraposition desselben Frames, kein Nachhinken.

**Ursache:** die Kachel-Pipeline, in drei Stufen.

- **Der Pool konnte dicht laufen.** Die Auslastung eines Workers wurde ausschließlich in `onmessage` verringert. Ein Worker, der nie antwortet — Speicherdruck auf dem iPad, oder eine Ausnahme im Worker-Skript, das kein `try/catch` hatte — belegte seinen Platz **dauerhaft**. Nach `JOBS_PER_WORKER` solchen Fällen war der Pool vollständig blockiert: es entstand nie wieder eine Kachel. Schon gebaute Körper blieben sichtbar, aber ein beim Goto lazy instanziierter Planet blieb komplett unsichtbar. Genau das Bild, das ein Neustart behebt.
- **Ein Teilbaum konnte sich festfressen.** Der Merge in `QuadtreeTile.update` war an das Vorhandensein des eigenen Mesh gekoppelt. Eine gesplittete Kachel ohne eigene Geometrie konnte deshalb nie zusammenlegen — und forderte ihr Mesh auch nicht neu an. Der Teilbaum blieb auf hoher Stufe stehen und hielt die Warteschlange dauerhaft am Anschlag (`MAX_QUEUE = 96`), was den ersten Punkt beschleunigte.
- **Die Prioritäten waren veraltet.** Jobs trugen die Kameradistanz *zum Anfragezeitpunkt*. Nach einem Anflug über viele Größenordnungen sortierte die Queue also nach dem alten Standort — die dringendsten Kacheln standen hinten.

**Behebung:** `TerrainProvider` führt Buch über in Flug befindliche Jobs (Worker, Startzeit, Pump-Zähler). Ein Wachhund erkennt unbeantwortete Jobs an Wanduhr *und* Pump-Zähler (5 s bzw. 60 Pumps — welches zuerst greift), gibt den Platz frei und stellt den Job **einmal** zurück in die Queue. `onerror`/`onmessageerror` tun dasselbe sofort. Nach sechs verlorenen Jobs gilt der Pool als unzuverlässig und der Provider wechselt dauerhaft auf den synchronen Pfad — der ruckelt, aber er liefert. Der Worker antwortet jetzt auch im Fehlerfall (`{ jobId, error }`), Prioritäten sind über `reprioritize()` nachführbar, und `cancel()` markiert in Flug befindliche Jobs als verworfen, statt ihren Platz mitzunehmen. Das HUD zeigt verlorene Jobs an.

Zusätzlich gehärtet: `evaluateProximity` überspringt Körper mit nicht-endlicher Position, und `Engine.collectBodies` reicht sie gar nicht erst weiter. Vorher hätte ein einziger `NaN` über das Softmin die Referenzhöhe, die Fluggeschwindigkeit und damit die Kameraposition vergiftet — eine dauerhaft leere Szene, aus derselben Symptomfamilie.

### 3. Die Geschwindigkeit ließ sich nicht mehr ändern und flackerte

**Symptom:** Ab einer bestimmten Stufe tat der `+`-Knopf nichts mehr, die Anzeige zitterte.

**Ursache A — Deckel pro Frame statt pro Sekunde.** Es gab keinen expliziten Geschwindigkeitsdeckel; er ergab sich implizit aus dem Wegbudget `maxStepFraction · maxSubsteps · ref` **pro Frame**, also `1,5 · ref / dt`. In Referenzhöhen pro Sekunde: 90 bei 60 fps, 45 bei 30 fps, 30 bei 20 fps. Stufe ×100 fordert 90 ref/s — auf einem Tablet mit 30 fps war also bei der Hälfte Schluss, jede weitere Stufe wirkungslos. Und weil `dt` von Frame zu Frame schwankt, wanderte der Deckel mit: daher das Zittern. Gemessen bei 1000 km Höhe und ×100: 93,9 Mm/s bei 60 fps gegen 39,8 Mm/s bei 24 fps.

**Behebung:** `maxReferenceRate = 150` (Referenzhöhen pro Sekunde) als eigenständiger Deckel. Das Wegbudget bleibt, was es ist — eine Auflösungsgröße für Kollision und LOD, die nur bestimmt, in wie viele Teilschritte ein Frame zerlegt wird. Der Test misst die in 2 s erreichte Höhe über 20 … 120 fps: Streuung ≤ 0,6 % (mit der alten Formel: Faktor 5·10⁵).

**Ursache B — versteckte Schwelle im Regler.** Der Schubregler krümmt seinen Rohwert kubisch für feines Dosieren. Geprüft wurde aber mit `Math.abs(input.forward) > 0.02` gegen den **gekrümmten** Wert: `0,02^(1/3) ≈ 0,27`. Die ersten 27 % Reglerweg waren wirkungslos — der Freiflug startete nicht, und ein laufender Anflug ließ sich damit auch nicht abbrechen.

**Behebung:** eine explizite Totzone (4 % Reglerweg, gegen Digitizer-Zittern) plus die reine Funktion `throttleToForward()` im Kern, und eine gemeinsame Konstante `THRUST_EPSILON = 1e-4` als Schwelle „Schub liegt an" in Engine, Navigator und UI. Der Knopf leuchtet jetzt genau dann, wenn der Schub auch wirklich greift.

## Terrain-Backends

Das HUD zeigt das aktive Backend, die Queue-Länge und die Zahl gebauter Kacheln.

| URL | Backend | Beschreibung |
|---|---|---|
| *(Standard)* | `worker` | Pool aus 2–4 Web Workern, Ergebnisse als Transferables |
| `?terrain=gpu` | `gpu` | Höhenfeld + Normalen als WGSL-Compute-Kernel (TSL) |
| `?terrain=sync` | `sync` | Notfallpfad im Main-Thread (nur zum Vergleich/Debuggen) |

**Warum Worker der Standard ist:** bei 19×19-Kacheln (~1.1 ms Bauzeit) kostet ein GPU-Dispatch samt `getArrayBufferAsync`-Readback mehr Latenz, als er an Rechenzeit spart — und der Worker-Pfad läuft auch dort, wo es kein WebGPU gibt (iPad-Safari, WebGL2-Fallback). Der GPU-Pfad gewinnt, sobald die Kachelauflösung steigt (`resolution` 32/64) oder mehrere Kacheln pro Dispatch gebündelt werden; beides ist der nächste sinnvolle Schritt.

Der GPU-Pfad prüft sich beim Start selbst: er rechnet eine Referenzkachel und vergleicht Höhen und Normalen gegen die CPU-Implementierung. Bei Abweichung, fehlendem WebGPU oder Pipeline-Fehler fällt er automatisch und still auf den Worker-Pfad zurück (Meldung in der Konsole).

## Architektur

```
src/
├── main.ts                    Bootstrap
├── core/
│   ├── Engine.ts              Renderer (WebGPU + Log-Depth), Main-Loop, Input, HUD,
│   │                          adaptive Renderauflösung
│   ├── SceneManager.ts        f64→f32-Brücke: Floating-Origin-Sync pro Frame
│   ├── SimClock.ts            Sim-Zeit ab J2000, Time-Warp
│   └── constants.ts           Einheiten (m, kg, s), astronomische Konstanten
├── math/
│   ├── Vector3d.ts            Double-Precision-Vektor (CPU-Weltkoordinaten)
│   └── rng.ts                 hash32 + mulberry32: deterministische Seeds
├── camera/
│   └── SpaceCamera.ts         Multi-Pointer (Pinch/Drag/Impuls in rad/s), f64-Welt-
│                              position, Orbit- und Freiflugmodus mit gemeinsamem
│                              Quaternion, exp. Zoom, Terrain-Kollision, Near-Plane
├── nav/                       three-frei, offline testbar
│   ├── vec.ts                 f64-Vektorarithmetik auf {x,y,z}
│   ├── orientation.ts         Quaternion-Kern: Gesten, Roll-Nivellierung,
│   │                          Nachführen                            (neu in v0.4)
│   ├── types.ts               BodyRef, NavInput, NavFrame, Schubkennlinie
│   ├── proximity.ts           weiche Referenzhöhe (Softmin im Log-Raum)
│   ├── flightKernel.ts        skalenfreies Geschwindigkeitsmodell mit Substepping
│   ├── gotoKernel.ts          Log-Raum-Übergang, analytische Übergabegeschwindigkeit
│   ├── picking.ts             Winkel-Picking + Bildschirmstrahl
│   ├── Navigator.ts           Zustandsmaschine frei ↔ Anflug
│   └── format.ts              HUD-Formatierung (m/km/AE/Lj, m/s/km/s/c)
├── ui/
│   └── FlightControls.ts      Schubregler, Speed-Stufen, Doppeltipp-Erkennung
├── physics/
│   └── Kepler.ts              Bahnelemente, Kepler-Löser, analytische Propagation
├── universe/
│   ├── CelestialBody.ts       Basisklasse, hierarchische Positionen
│   ├── Star.ts / Planet.ts    Konkrete Körper (Licht/Glow bzw. Terrain/Gas)
│   ├── UniverseManager.ts     Hybrid: Katalog + prozedurale Nachbarschaft, lazy
│   └── procedural.ts          Hauptreihen-Sterne, Frostlinie, Masse-Radius
├── terrain/
│   ├── PlanetLOD.ts           Cube-Sphere-Quadtree (Auswahl-Logik, synchron)
│   ├── TerrainProvider.ts     priorisierte Job-Queue, Worker-Pool, Backend-Wahl,
│   │                          Wachhund für verlorene Jobs           (v0.4)
│   ├── terrainWorker.ts       Worker-Entry (Transferable-Puffer)
│   ├── gpuTerrain.ts          WGSL-Compute-Kernel via TSL + Selbsttest
│   ├── tileGeometry.ts        THREE-freier Kern: Höhenfeld, Kachel-Assembly, Paletten
│   └── noise.ts               Seedbares 3D-Simplex, fBm, Ridged
└── data/catalog.json          Sol-System, vereinfachte J2000-Bahnelemente

tools/                         Offline-Prüfungen (kein Build, kein node_modules)
├── test-nav.ts                41 Tests der Navigationskerne
├── test-orbit.ts              10 Tests der Kepler-Zustandspropagation
├── test-orientation.ts        19 Tests des Quaternion-Kerns          (neu in v0.4)
├── test-throughput.ts         27 Tests Geschwindigkeit + Kachel-Queue (neu in v0.4)
├── register-ts.mjs            Node-Loader-Hooks (Type-Stripping + Auflösung)
├── ts-hooks.mjs
└── stubs/                     Minimalstubs (three/webgpu, three/tsl), damit Kepler
                               und TerrainProvider offline importierbar sind
```

Die Module unter `src/nav/` importieren nichts aus dem Projekt und kein three — sie laufen im Browser, im Worker und in Node identisch. Das gilt seit v0.4 auch für `orientation.ts`: die Kamera-Mathematik ist damit prüfbar, ohne einen Renderer zu starten, und genau dort saß Fehler 1.

`Vector3d` und `Orbit` verwenden seit v0.3 explizite Felder statt Parameter-Properties; `gpuTerrain.ts` seit v0.4 ebenso, weil `TerrainProvider` jetzt am Offline-Test hängt. Nodes Type-Stripping kann Parameter-Properties nicht entfernen und auch keine Typen aus Wert-Importen aussortieren — Interfaces werden deshalb über `import type` geholt.

## Zentrale Entscheidungen

**Präzision ist ein Verbundproblem, kein Depth-Buffer-Problem.** Der logarithmische Depth-Buffer beseitigt Z-Fighting über 0.2 m … 1e19 m — aber Vertex-Jitter entsteht durch große *Positions*-Koordinaten in f32. Daher: (1) absolute Positionen in f64, (2) hierarchisch entlang des Orbitbaums, (3) Camera-Relative Rendering (Kamera immer bei (0,0,0)), (4) Kachelgeometrie relativ zum Kachelzentrum.

**Der GPU-Pfad rechnet nur, was in f32 unkritisch ist.** Der Compute-Kernel liefert Skalarhöhen und Einheitsnormalen; die Positionen entstehen weiterhin in f64 auf dem Main-Thread. Eine in f32 gerechnete Position bei R = 6.4 e6 m trüge ~0.5 m Rauschen — bei 2 m Flughöhe wäre das sichtbar. Höhen und Normalen dagegen haben kleinen Wertebereich bzw. sind normiert.

**Analytische Kepler-Propagation statt Integrator.** Position(t) ist geschlossen lösbar ⇒ Time-Warp ×10⁸ ohne Drift.

**Eine Abstraktion für zwei Welten.** Katalog- und prozedurale Körper sind nach der Instanziierung identische `CelestialBody`-Objekte; die Naht existiert nur in den Fabriken.

**Quadtree synchron, Geometrie asynchron.** Die LOD-Auswahl (Split/Merge mit Hysterese, Rückseiten-Guard, Anfrage-Budget) bleibt deterministisch im Frame. Nur der Kachelbau wandert aus. Lückenfreier Übergang: eine gesplittete Kachel bleibt sichtbar, bis **alle vier** Kinder Geometrie haben — vorher werden die Kinder ausgeblendet, sodass weder Löcher noch doppelt gezeichnete, z-fightende Flächen entstehen. Jobs tragen die Kameradistanz als Priorität; bei voller Queue fallen die fernsten heraus und werden im Folgeframe neu gestellt. Seit v0.4 wird die Priorität wartender Jobs jedes Frame nachgeführt (sonst sortiert die Queue nach dem Standort vor dem Anflug), und ein Wachhund gibt die Plätze verstummter Worker wieder frei.

**Normalen aus dem Höhen-Gradienten.** Statt des Kreuzprodukts zweier Oberflächenpunkte (dort löschen sich auf tiefen LOD-Stufen ~6 signifikante Stellen aus) gilt `n = normalize(dir − t₁·∂h/∂s₁ − t₂·∂h/∂s₂)`. Numerisch stabil bis Level 14, nahtlos über Kachelgrenzen und — wichtig — in CPU und WGSL bitweise dieselbe Formel, sodass beide Backends identisch aussehen.

## Bekannte Grenzen / Roadmap

1. **Kacheln bündeln:** mehrere Kacheln pro Compute-Dispatch, dann lohnt sich der GPU-Pfad auch bei kleiner Auflösung.
2. **Detail-Oktaven:** das Höhenfeld hat aktuell 5 Oktaven ab Frequenz ~1.6, d. h. Strukturen ab ~1000 km. Aus 2 m Höhe wirkt der Boden deshalb glatt; LOD-abhängige Detail-Oktaven (+ triplanare Detail-Maps) sind der nächste Qualitätssprung.
3. Atmosphären-Scattering (TSL-Nodes), Sternen-Backdrop/Galaxienkatalog statt leerem Himmel.
4. Achsrotation + rotierende Bezugssysteme.
5. **Stufe 2 — verschachtelte Bezugsrahmen.** Der Flug ist mit v0.3 skalenfrei, die *Koordinaten* sind es nicht: ein einziger f64-Weltursprung bleibt ein einziger Weltursprung, bei ~10³ Lj ist weiter Schluss. `tools/test-orbit.ts` beziffert den Effekt — dasselbe System 3 Lj vom Ursprung verliert in der Geschwindigkeit rund 0,16 m/s allein durch die Rundung der Absolutposition. Danach: Galaxien-Ebene, Octree über Sternregionen, Impostor-Rendering.
6. Orbit-Linien, patched conics für steuerbare Schiffe. *(Picking/Tippen zum Fokussieren ist mit v0.3 erledigt.)*
7. Mond-Bahnelemente sind grob (starke reale Störungen); Katalogelemente generell „vereinfachtes J2000“.
8. T-Junctions werden von Skirts kaschiert, nicht topologisch aufgelöst.
9. Der Wachhund erkennt einen toten Worker erst nach 5 s bzw. 60 Pumps. Das ist bewusst träge (eine große Kachel darf dauern), heißt aber: der erste Ausfall kostet einmalig eine sichtbare Pause. Ein Heartbeat wäre schneller, kostet aber Nachrichten pro Frame.

## Für den Leitfaden

*In v0.4.1 übernommen (§5, §7, §11); die beiden Kanon-Kandidaten stehen in §9 zur Entscheidung.*

Kandidaten für die Übernahme in `space-sim-leitfaden.md`:

- **§11 Änderungsprotokoll:** `| v0.4 | Quaternion-Orientierung ohne Achsenanschlag, robuste Kachel-Warteschlange (Wachhund + Fallback), framerate-unabhängiger Geschwindigkeitsdeckel |`
- **§5 Modulkarte:** `nav/orientation.ts` als weiterer three-freier Rechenkern eintragen.
- **§4 Architektur-Kanon, Kandidat für eine neue Invariante:** *Jede Größe, die pro Frame begrenzt wird, muss zusätzlich pro Sekunde begrenzt werden — sonst hängt das Verhalten an der Framerate.* Fehler 3 war genau das; das Muster ist allgemein (Budgets, Dämpfungen, Nachlauf).
- **§4.5 Ergänzung:** *Wer einen asynchronen Platz belegt, muss ihn auch dann freigeben, wenn die Antwort nie kommt.* Der Fallback-Pfad aus §8 („Selbsttest mit stillem Fallback") galt bisher nur für den GPU-Kernel; er gilt genauso für den Worker-Pool.
- **§8 Verifikationsdisziplin:** Offline-Tests müssen über **mehrere Frameraten** laufen, nicht nur bei 60 fps. Alle drei Fehler waren offline reproduzierbar — sie wurden nur nicht gesucht.
