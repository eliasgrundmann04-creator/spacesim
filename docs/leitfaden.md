# Space Sim — Projektleitfaden

**Stand:** v0.4.16 · Dieses Dokument ist die verbindliche Referenz für alle Folgearbeiten.
Bei Widerspruch zwischen Aufgabe, Chat und diesem Dokument gilt dieses Dokument — oder es wird hier geändert.
Maßgeblich ist `docs/leitfaden.md` im Repo; Kopien an anderer Stelle sind Spiegel.
Wie Agenten damit arbeiten, regelt `AGENTS.md`.

---

## 1. Zielbild

Ein physikalisch realistischer, frei durchfliegbarer 3D-Weltraumsimulator im Stil von SpaceEngine, lauffähig im Tablet-Browser. Nahtlos von 2 m über einer Planetenoberfläche bis zur wabenartigen Großstruktur des Kosmos — ohne Ladebildschirme, ohne Skalenbrüche.

**Der Anspruch ist nicht Vollständigkeit, sondern Glaubwürdigkeit.** Wo reale Daten existieren (Sternkataloge, Bahnelemente, Photometrie), werden sie benutzt. Wo keine existieren (3D-Struktur von Nebeln, Oberflächen von Exoplaneten), wird prozedural erzeugt — aber innerhalb physikalischer Leitplanken, nicht frei erfunden.

### Anti-Ziele

Bewusst *nicht* verfolgt, bis ein konkreter Anlass entsteht:

- Vollständiger Gaia-Katalog (1,8 Mrd. Sterne). Ein Helligkeitsschnitt mit ~10⁵–10⁶ Sternen ist optisch nicht unterscheidbar und passt ins Speicherbudget.
- N-Körper-Integration als Standardpfad. Analytische Kepler-Propagation bleibt die Basis (siehe §4.3).
- Bit-exakter Determinismus über verschiedene Geräte/Engines hinweg. Innerhalb einer Plattform ja, darüber hinaus nicht garantiert (Trigonometrie-Implementierungen unterscheiden sich).
- Fotorealismus um jeden Preis. Wenn eine physikalische Näherung und ein Hack gleich aussehen, gewinnt die Näherung — weil sie in der nächsten Skala noch trägt.

---

## 2. Aktueller Stand (v0.4.16)

Läuft im Tablet-Browser. TypeScript; Node ≥ 22.6 für die Offline-Tests (Type-Stripping, kein Build-Schritt). `npm run check` läuft grün: strikter Typecheck gegen die echten Typen, 175 Offline-Tests (7 Frame-Baum, 12 Kamera-Frame, 41 Navigation, 10 Kepler, 19 Orientierung, 47 Gesten, 12 Gleitflug, 27 Durchsatz), Vertragskarte, Produktionsbuild.

**Vorhanden:**
- WebGPU-Renderer (`three/webgpu`) mit logarithmischem Depth-Buffer, automatischer WebGL2-Fallback
- Floating Origin: f64-CPU-Positionen, Kamera immer bei (0,0,0)
- Analytische Kepler-Propagation, Time-Warp bis ×2,4e8 ohne Drift; `CelestialBody` führt neben der Position auch eine hierarchisch akkumulierte Geschwindigkeit und eine `uid` (Namen wiederholen sich über prozedurale Systeme)
- Hybrides Universum: JSON-Katalog (Sol-System) + prozedurale Sterne im 16-Lj-Umkreis (~70–100 Sterne, entspricht realer Dichte), Systeme lazy instanziiert
- Cube-Sphere-LOD-Quadtree bis Level 14 (~50 m Vertexabstand), asynchron über Worker-Pool; optionaler WGSL-Compute-Pfad via TSL (`?terrain=gpu`) mit Selbsttest und Fallback
- Kachel-Pipeline mit Wachhund: unbeantwortete Worker-Jobs werden erkannt und einmal neu gestellt, nach sechs Verlusten dauerhafter Wechsel auf den synchronen Pfad; Prioritäten werden jedes Frame nachgeführt
- **Navigation (Stufe 1):** freier Flug mit Geschwindigkeit ∝ Referenzhöhe, Goto als Interpolation von `ln d` gegen die *laufend* nachgeführte Zielposition mit analytisch berechneter Übergabegeschwindigkeit; Geschwindigkeitsdeckel pro Sekunde, nicht pro Frame (framerate-unabhängig). Der Kamera-Freiflug wird über die Positionsdifferenz/Verschiebung des Ankerkörpers mitgeführt (nicht über v · dt). Der Kern liegt isoliert und three-frei in `src/nav/`. Gleit-Modus (`?feel=glide:1`): Pinch steuert Schub und Bremsen mit Bremsraste und framerate-unabhängigem Abklingen; die Flugrichtung folgt dem Blick verzögert. Automatisches Tempo (v0.4.11): Kontaktzeit-Begrenzer drosselt die Anflugsgeschwindigkeit sanft vor dem Aufprall (`ttcMin = 0,6 s`); Stufen-Rückführung führt die wählbare Geschwindigkeitsstufe beim Entfernen vom Ort des Setzens einseitig auf ×1 zurück (`stageHalfDecades = 1`). Beide Funktionen sind per `?feel=autoPace:0` abschaltbar.
- Zwei-Modi-Kamera (`orbit`/`free`) mit gemeinsamem Orientierungs-Quaternion (kein Polanschlag), dadurch nahtloser Moduswechsel; Multi-Pointer-Touch: Ein-Finger-Zug, Pinch-Zoom, Zwei-Finger-Pan, iOS-Gestenunterdrückung. Seit v0.4.4 dreht nichts von selbst (keine Roll-Nivellierung mehr): jede Drehung ist eine reine Funktion der Fingerpunkte (`nav/dragKernel.ts`) oder ihr Nachlauf (`nav/fling.ts`). Im Orbit klebt der berührte Boden am Finger, über den Planetenrand hinaus läuft die Umrundung stetig weiter; im Freiflug dreht das Bild nie um seine Mitte — außer beim Zwei-Finger-Drehen (ab 20°, mit Pinch-Sperre und Dominanzprüfung, seit v0.4.8). Alle Gefühlswerte liegen isoliert in `nav/feel.ts` und sind live per URL (`?feel=...`) überschreibbar. Seit v0.4.6 ist `SpaceCamera.ts` unter den Dateideckel geteilt (`cameraTouch.ts` three-frei, `cameraPlacement.ts`). Seit v0.4.13 ist `Engine.ts` unter den Dateideckel geteilt (`EngineHud.ts`, `EngineInput.ts`).
- Adaptive Renderauflösung (0,7×–2×)
- Laufzeit-Selbsttest in `Engine`: warnt, wenn die Kamera ohne Schub von ihrem Anker wegdriftet — diagnostiziert Verwechslungen von `dtReal` und `dtSim`
- Agent-Betrieb: `AGENTS.md`, CI auf jedem PR, Vertragskarte mit Invarianten-Prüfung, Aufgabenwarteschlange in `docs/aufgaben/` (§8, §12)

**Fehlt strukturell** (nicht „noch nicht gebaut", sondern „blockiert Weiteres"):
- Ein einziger Weltursprung. f64 löst bei 1 Lj nur noch ~2 m auf, bei 16 Lj ~30 m (§3.1). Sterne darzustellen trägt damit bis ~10³ Lj — bodennaher Flug ist aber schon auf Planeten der prozeduralen Nachbarsysteme nicht mehr sauber. Der Effekt ist vermessen, nicht nur hergeleitet: dasselbe Sonnensystem 3 Lj vom Ursprung verliert ~0,16 m/s Weltgeschwindigkeit allein durch Rundung (`tools/test-orbit.ts`). Genau das behebt Stufe 2. Stand: Frame-Baum (2a) und Kamera-Umhängen (2b) existieren als Code und Tests, sind zur Laufzeit aber nicht verdrahtet — die Kamera bekommt nie einen Rahmen, die Körper rechnen absolut. Ein erster Versuch von 2c ist zurückgenommen (§9); Fundament dafür ist Aufgabe 22
- Keine physikalische Photometrie ⇒ Helligkeiten sind kalibriert-geraten, nicht gerechnet
- Kein Punktwolken- und kein Volumen-Renderer

---

## 3. Die drei Engpässe

Fast alles auf der Wunschliste (Gaia, Nebel, Galaxien, Großstruktur) scheitert heute an denselben drei fehlenden Grundsystemen. Inhalte davor zu bauen bedeutet, sie zweimal zu schreiben.

### 3.1 Verschachtelte Bezugsrahmen

Es gibt genau einen f64-Weltursprung. f64 hat ~16 signifikante Stellen; der Abstand zweier darstellbarer Zahlen bei Koordinate *x* liegt zwischen *x* · 1,1e-16 und *x* · 2,2e-16:

| Skala | Koordinate | f64-Auflösung | f32-Auflösung |
|---|---|---|---|
| Planetenoberfläche | 6,4e6 m | ~1 nm | ~0,5 m |
| 1 AE | 1,5e11 m | ~30 µm | ~16 km |
| 30 AE | 4,5e12 m | ~1 mm | — |
| 1 Lichtjahr | 9,5e15 m | ~2 m | — |
| 1 kpc | 3,1e19 m | ~4 km | — |
| 100.000 Lj (Milchstraße) | 9,5e20 m | ~130 km | — |
| 10 Mio. Lj | 9,5e22 m | ~17.000 km | — |
| 1 Mrd. Lj | 9,5e24 m | ~1 Mio. km | — |

*(Korrigiert in v0.4.1: Bis v0.4 waren die Zeilen 1 Lj, 1 kpc und 100.000 Lj um den Faktor 1000 zu optimistisch angegeben. Die Werte sind jetzt numerisch nachgerechnet.)*

Millimetergenau ist ein einziger Ursprung nur bis ~30 AE. Bei 10 Mio. Lj ist die f64-Auflösung größer als die Erde. Für Galaxienpositionen völlig ausreichend, für Planeten unbrauchbar — und **beides gleichzeitig geht mit einem Ursprung nicht.**

Lösung: ein Baum aus Bezugsrahmen (Universum → Galaxie → Sternhaufen → System → Planet), jeder mit eigenem lokalem Ursprung und eigener Einheit. Die Kamera hängt in genau einem Frame und wird beim Fliegen umgehängt. Das ist der invasivste Umbau des Projekts und muss **vor** allem Galaktischen kommen.

### 3.2 Repräsentationswechsel nach Winkelgröße

Jedes Objekt braucht 2–4 Darstellungen plus unsichtbare Übergänge:

| Objekt | fern → nah |
|---|---|
| Stern | Punkt → Scheibe mit Beugungskreuz → Kugel mit Granulation |
| Galaxie | Sprite → Partikelwolke → Einzelsterne |
| Nebel | Sprite → Volumen (Raymarching) |
| Planet | Punkt → Kugel → LOD-Terrain |
| Ring | Textur-Scheibe → Dichteband → Partikel |

Der schwierige Teil ist nie die einzelne Darstellung, sondern dass **Helligkeit, Farbe und scheinbare Größe am Crossover exakt zusammenpassen**. Das gelingt nur, wenn alle Darstellungen aus denselben physikalischen Größen abgeleitet werden — also nach §3.3.

### 3.3 Physikalische Photometrie + HDR

Der „Hubble-Look" entsteht nicht durch mehr Geometrie, sondern durch korrekte Leuchtdichten: Magnitude → Irradianz am Auge, Auto-Belichtung mit Adaptionszeit, Glare/Bloom als Kamera-Effekt, Tonemapping am Ende. Ohne diese Kette ist ein Feld aus 10⁵ Sternen nur Rauschen und ein Nebel nur grauer Matsch — unabhängig davon, wie gut der Renderer ist.

---

## 4. Architektur-Kanon

Diese Invarianten werden nicht ohne expliziten Beschluss gebrochen. Jede sichert eine Eigenschaft, die sonst schleichend verloren geht.

### 4.1 Präzision ist ein Verbundproblem

Der logarithmische Depth-Buffer beseitigt Z-Fighting. Er beseitigt **kein** Vertex-Jitter — das entsteht durch große Positionskoordinaten in f32 im Vertex-Shader. Vier Maßnahmen zusammen:

1. Absolute Positionen in f64 (`Vector3d`), niemals f32
2. Hierarchisch entlang des Orbitbaums (ein Mond ist mm-genau relativ zu seinem Planeten, egal wie weit das System entfernt ist)
3. Camera-Relative Rendering: Kamera immer bei (0,0,0), die GPU sieht nur Differenzen
4. Kachelgeometrie relativ zum Kachelzentrum

**Regel:** Eine Größe, die in Metern gemessen und größer als ~10⁶ ist, gehört nicht in f32. Wenn sie auf die GPU muss, wird vorher in f64 subtrahiert.

### 4.2 GPU rechnet nur, was in f32 unkritisch ist

Der Compute-Kernel liefert Skalarhöhen und Einheitsnormalen; Positionen entstehen in f64 auf der CPU. Eine f32-Position bei R = 6,4e6 m trägt ~0,5 m Rauschen — bei 2 m Flughöhe sichtbar. Dieses Muster gilt allgemein: **Verhältnisse, Richtungen und kleine Wertebereiche auf die GPU, absolute Weltkoordinaten nicht.**

### 4.3 Analytische Propagation statt Integrator

Position(t) ist bei Kepler-Bahnen geschlossen lösbar ⇒ beliebiger Time-Warp ohne Drift oder Aufschaukeln. Ein Integrator würde bei ×10⁸ sofort divergieren. N-Körper-Störungen und patched conics kommen später als *additiver* Layer für konkrete Fälle (Raumschiffe innerhalb einer SOI), nicht als Ersatz.

### 4.4 Eine Abstraktion für alle Quellen

Katalogkörper und prozedurale Körper sind nach der Instanziierung identische `CelestialBody`-Objekte. Die Naht zwischen „real" und „generiert" existiert nur in den Fabriken — nie in Renderer, Physik oder Kamera. Das gilt künftig genauso für Gaia-Sterne, Asteroiden und Galaxien.

### 4.5 Auswahl synchron, Erzeugung asynchron

LOD-Auswahl, Sichtbarkeit und Streaming-Entscheidungen laufen deterministisch im Frame. Alles Teure (Geometrie, Texturen, Volumendaten) wird asynchron erzeugt — Worker oder GPU-Compute, priorisiert nach Kameradistanz. **Nichts, was mehr als ~0,5 ms kostet, wird im Frame gebaut.**

Übergangsregel gegen Löcher: Ein gesplitteter Knoten bleibt sichtbar, bis *alle* Kinder fertig sind; vorher sind die Kinder unsichtbar. Nie beide gleichzeitig (z-Fighting).

### 4.6 Determinismus durch Seed-Hierarchie

Prozedurale Inhalte entstehen aus `hash32(Kontext…)` → `mulberry32`. Ein Objekt wird immer aus dem Seed seines Elternkontexts abgeleitet, nie aus einem globalen Zähler. Folge: Alles ist ohne Speicherung reproduzierbar und lazy instanziierbar.

### 4.7 Numerisch stabile Formulierungen bevorzugen

Beispiel aus v0.2: Normalen aus dem Höhen-Gradienten `n = normalize(dir − t₁·∂h/∂s₁ − t₂·∂h/∂s₂)` statt aus dem Kreuzprodukt zweier Oberflächenpunkte — letzteres verliert auf Level 14 ~6 signifikante Stellen durch Auslöschung. **Bei jeder Differenz großer, fast gleicher Zahlen: umformulieren, nicht mehr Präzision draufwerfen.**

---

## 5. Modulkarte

Exporte, Signaturen und Abhängigkeiten stehen in `docs/contracts.md`, erzeugt von `tools/contracts.mjs` (§8.1). Hier nur die Grobgliederung, die sich selten ändert:

| Ordner | Zuständigkeit |
|---|---|
| `core/` | Renderer, Main-Loop, Input, HUD, Floating-Origin-Sync, Sim-Uhr, Konstanten |
| `math/` | f64-Vektor (alle Weltkoordinaten), `hash32` + `mulberry32` + Verteilungen |
| `camera/` | Zwei-Modi-Kamera, Multi-Pointer, exp. Zoom, Terrain-Kollision, Near-Plane |
| `nav/` | Flugkernel, Goto, Proximity, Picking, Quaternion-Orientierung, Formatierung — three-frei |
| `ui/` | Schubregler, Geschwindigkeitsstufen, Doppeltipp-Erkennung |
| `physics/` | Bahnelemente, Kepler-Löser, analytische Propagation |
| `universe/` | Körperhierarchie, Katalog + prozedurale Nachbarschaft, Fabriken |
| `terrain/` | Quadtree-Auswahl, Job-Queue mit Wachhund, Worker, WGSL-Compute, Geometriekern, Noise |
| `frames/` | *(ab Stufe 2a)* Bezugsrahmen-Baum — three-frei |
| `data/` | `catalog.json` — Sol-System, vereinfachte J2000-Elemente |

**Strukturregel:** Rechenkerne bleiben frei von three.js-Importen (wie `tileGeometry.ts`, `noise.ts`, alles unter `nav/`), damit sie in Workern, auf dem Main-Thread und in Offline-Tests identisch laufen. Diese Trennung bei jedem neuen Rechenkern beibehalten. `npm run check` prüft sie für alle Einträge in `THREE_FREE` (`tools/contracts.mjs`), auch transitiv; die `three`-Spalte in `docs/contracts.md` zeigt den Stand aller Dateien.

---

## 6. Physik- und Einheitenvertrag

- **Längen** Meter · **Massen** kg · **Zeiten** Sekunden — intern immer. Umrechnung (AE, Lj, pc, Sonnenmassen) nur an den Rändern: Katalog-Import und HUD-Ausgabe.
- **Winkel** intern Radiant, im JSON Grad (Suffix `_deg`).
- **Weltframe** Ekliptik J2000, Z = Norden, `camera.up = (0,0,1)`.
- **Zeitachse** Sekunden seit J2000.0; `SimClock` startet auf „jetzt", sodass Planeten näherungsweise real stehen.
- **Bahnelemente** `{a, e, i, Ω, ω, M₀, epoch}`, Epoche in s ab J2000.

Ab Stufe 3 kommt hinzu: **Leuchtkraft** in W, **Bestrahlungsstärke** in W/m², Magnituden nur als Ein-/Ausgabeformat.

---

## 7. Stufenplan

Jede Stufe macht die nächste bewertbar. Reihenfolge ist nicht beliebig — Stufe *n* setzt Stufe *n−1* voraus, außer bei den Nebenspuren.

### Kernpfad

**Stufe 1 — Navigation & Übergänge** ✅ *erledigt in v0.3, gehärtet in v0.4*
Freier Flug mit Geschwindigkeit ∝ Distanz zum nächsten Körper; „Goto" als weiche Interpolation im Log-Raum statt Sprung. Touch: Schub-Slider und Doppeltipp-Ziel.
*Abgenommen:* Flug von der Erdoberfläche zum Mond ohne Zielauswahl, jeder Zielwechsel als sichtbarer Flug.
*Gelernt:* Geschwindigkeit wird ankerrelativ gespeichert, nicht als Weltgeschwindigkeit — sonst verliert die Kamera unter Time-Warp ihren Zielplaneten. Die Referenzhöhe entsteht aus einem gewichteten Boltzmann-Mittel im Log-Raum („Softmin"), nicht aus `logsumexp`; daraus folgt eine Flugzeit, die logarithmisch mit der Referenzhöhe skaliert — skalenfreier Flug. Picking läuft im Winkelraum, nicht im Pixelraum. *Aus v0.4:* Orientierung als Quaternion statt `theta/phi` (sonst Polanschlag und verzerrte Diagonalen); jeder Deckel pro Frame braucht einen Deckel pro Sekunde; wer einen asynchronen Platz belegt, muss ihn auch freigeben, wenn nie eine Antwort kommt. Alle drei v0.4-Fehler waren offline reproduzierbar — sie wurden nur nicht gesucht, weil die Tests ausschließlich bei 60 fps liefen.

**Stufe 2 — Verschachtelte Bezugsrahmen**
Frame-Baum mit lokalen Ursprüngen; Kamera wird beim Überschreiten von Schwellen umgehängt. Alle Positionen werden relativ zum aktuellen Frame aufgelöst.
*Fertig, wenn:* eine Sternposition in 100.000 Lj und ein Fels auf der Erde im selben Programmlauf beide korrekt sind — nachweisbar über einen Offline-Test, der Positionen über mehere Frame-Wechsel hin- und zurückrechnet.
*Risiko:* invasivster Umbau; `SceneManager`, `CelestialBody`, `SpaceCamera`, `UniverseManager` sind betroffen.
*Schnitt:* Aufgaben 01–06 in `docs/aufgaben/` (2a, Vorbereitung, Entscheidungsvorlage, 2b, 2c).

**Stufe 3 — Photometrie & HDR**
Magnitude → Irradianz, Auto-Belichtung mit Adaptionszeit, Glare, Tonemapping. Sternfarben aus Temperatur bleiben, werden aber energetisch korrekt skaliert.
*Fertig, wenn:* Sirius und die Sonne aus derselben Distanz im richtigen Helligkeitsverhältnis erscheinen und die Belichtung beim Flug von der Tagseite in den Schatten sichtbar nachzieht.

**Stufe 4 — Punktwolken-Renderer**
Gaia-/HYG-Ausschnitt (Helligkeitsschnitt, ~10⁵) + prozedurale Auffüllung dahinter. Ein Renderer, der später auch Kugelsternhaufen und Galaxien-Partikelwolken trägt.
*Fertig, wenn:* der Blick von der Erde zum Himmel die realen Sternbilder zeigt und man kontinuierlich bis 1000 Lj hinausfliegen kann.

**Stufe 5 — Volumetrik**
Raymarching durch 3D-Noise mit Emission und Extinktion. Nebel, Staubbahnen, Galaxienscheiben.
*Fertig, wenn:* ein Emissionsnebel durchfliegbar ist und dabei plausibel die Perspektive wechselt.
*Deckel:* auf dem Tablet die härteste Stufe — halbe Auflösung plus temporale Reprojektion, sonst chancenlos.

**Stufe 6 — Kleinkörper**
Ringe analytisch (Dichteprofil, Eigenschatten, Schatten auf den Planeten), erst nah als Partikel. Asteroiden instanziiert mit Familien aus dem Gürtel-Seed. Kometen: Koma + Schweif entlang des Sonnenvektors, Aktivität abhängig vom Abstand.

**Stufe 7 — Galaxien & Großstruktur**
Galaxien mit Impostor → Partikelwolke → Einzelsterne. Filamente und Voids aus geschwelltem Noise. Herauszoomen bis zur Wabenstruktur.

### Nebenspuren (parallel einschiebbar)

**A — Planetenqualität.** Detail-Oktaven, die mit der LOD-Stufe skalieren (aktuell wirkt der Boden aus 2 m Höhe glatt, weil nur 5 Oktaven ab Frequenz ~1,6 existieren — Strukturen erst ab ~1000 km). Danach: Atmosphären-Scattering, Wolkenschicht, triplanare Detail-Maps, Biome aus Klimamodell statt reiner Höhenpalette, Achsrotation.

**B — Performance & Tablet.** Frustum-Culling für Kacheln, Instancing, Speicherbudget mit Verdrängung, Messpunkte im HUD. Nach jeder Kernstufe kurz prüfen, nicht am Ende sammeln.

---

## 8. Arbeitsweise

- **Ort:** Das GitHub-Repo (`main`) ist die einzige Quelle — Code, dieser Leitfaden, Vertragskarte, Aufgaben. Keine ZIPs im Repo, keine Arbeitsstände nur in Chats.
- **Rollen:** Ein Coding-Agent arbeitet Aufgaben nach `AGENTS.md` ab (Standard: Jules, über das GitHub-Label `jules`). Der Inhaber startet Aufgaben, entscheidet offene Fragen, prüft auf dem Tablet und merged.
- **Sprache:** Deutsch in Aufgaben, PRs und Doku, Bezeichner im Code englisch, Kommentare deutsch und knapp.
- **Versionierung:** `package.json` je Aufgabe Patch +1, je abgeschlossener Stufe Minor +1; dann README „Neu in vX.Y" und Git-Tag `vX.Y.0`.
- **Dependencies:** `three@0.171` gepinnt, `package-lock.json` eingecheckt. Bei Upgrade zuerst WebGPU-/TSL-Changelogs prüfen, die API bewegt sich noch.
- **Start:** `npm ci && npm run dev` (bei zickigem Vite-Cache `npm run dev -- --force`).

### 8.1 Kontextbudget

Die begrenzende Größe dieses Projekts ist nicht der Umfang des Codes, sondern die Zahl der Dateien, die man liest, um eine Änderung korrekt zu machen. Sie wird wie eine Performance-Kennzahl behandelt — für Agenten genauso wie für Menschen.

- **Dateideckel ~300 Zeilen** in `src/`. `npm run check` lässt neue Dateien darüber und jedes Wachstum der Bestandsdateien in `CAP_BASELINE` scheitern. Eine Überschreitung ist ein Auftrag zum Teilen, kein Schönheitsfehler.
- **Einstiegspunkt ist `docs/contracts.md`**, nicht der Quelltext. Wer eine Änderung plant, liest die Vertragskarte plus die Dateien, die er tatsächlich anfasst.
- **Neue Subsysteme werden isoliert geschnitten** — Vorbild `src/nav/`: three-frei, ohne Rückgriff auf den Rest, in Node testbar. Isolation ist hier kein Selbstzweck; sie ist das, was ein Subsystem in einer Aufgabe bearbeitbar macht.
- **Mehr als vier bis fünf Dateien in einer Aufgabe** heißt: der Schnitt stimmt nicht. Dann wird umgeplant, nicht mehr nachgeladen.

### 8.2 Lieferformat

- **Pro Aufgabe:** ein Branch, ein PR nach `.github/pull_request_template.md` — Ziel und Abnahmekriterium wörtlich, Bewertung erfüllt/nicht erfüllt, Dateiliste, Tablet-Prüfschritte. Nur Dateien der Aufgabe; unbeteiligte Dateien neu zu schreiben erzeugt genau die schleichende Drift, gegen die §4 gebaut ist.
- **Pro Meilenstein** (Stufe aus §7 abgeschlossen): Git-Tag + README als Snapshot, aus dem ein frischer Agent bootstrappen kann.
- **Sichtprüfung:** Jeder PR bekommt eine Netlify-Vorschau mit eigener https-Adresse; dort prüft der Inhaber auf dem Tablet.

### 8.3 Verifikationsdisziplin

Ein Befehl deckt alles Prüfbare ab und läuft lokal beim Agenten wie in der CI (Node 22.16 und 24):

```json
"check": "npm run typecheck && npm test && node tools/contracts.mjs --check && vite build"
```

1. **Typecheck** strikt gegen die installierten Typen, ohne Ausnahmen. (Die frühere Toleranz für `TS2307` galt der Sandbox ohne `node_modules` und entfällt. Sie hatte drei echte Typfehler verdeckt, an denen auch `npm run build` scheiterte — behoben in v0.4.1.)
2. **Offline-Tests** der three-freien Rechenkerne in Node: Determinismus, physikalische Plausibilität, numerische Stabilität, Bauzeiten — und alles, was pro Frame passiert, über mehrere Frameraten (20–120 fps).
3. **Invarianten aus §4 als Tests, nicht als Prosa.** Geprüft werden: three-Freiheit der Rechenkerne (transitiv, per Import-Graph), Dateideckel als Ratsche. Ab Stufe 2 der Frame-Roundtrip. Noch nicht automatisiert: keine f32-Weltkoordinaten, Seed-Determinismus über einen Hash (§9). Eine Regel, die nur im Dokument steht, überlebt keine zwanzig Aufgaben.
4. **Aktualität der Vertragskarte** (`contracts --check`). Hinkt sie dem Code hinterher, wird sie von der Abkürzung zur Fehlerquelle.
5. **Produktionsbuild** (`vite build`) — dasselbe, was die Vorschau ausliefert.
6. **Nicht prüfbar** sind Renderpfad, WebGPU-/TSL-API und Touch-Verhalten. Deshalb gilt: **jeder unprüfbare Pfad bekommt einen Laufzeit-Selbsttest mit stillem Fallback** (Muster: `gpuTerrain.ts` vergleicht gegen die CPU-Referenz und schaltet bei Abweichung auf Worker um), und jeder PR, der solche Pfade berührt, nennt konkrete Tablet-Prüfschritte.

Ein grüner `check` ersetzt das erneute Lesen von Code. Das ist der eigentliche Grund für den Aufwand.

Neue Rechenkerne so schneiden, dass sie in Node testbar sind — das ist der Grund für die three-Freiheit aus §5.

---

## 9. Offene Fragen

Zu entscheiden, wenn die jeweilige Stufe ansteht:

- **Frame-Wechsel-Schwellen** (Stufe 2): **Entschieden am 19.10.2026:** Option B (hierarchisch nach SOI). Die Koordinatengrenzen entsprechen exakt den stärksten Beschleunigungsfeldern und der Kepler-Baumstruktur.

  *(Entscheidungsvorlage aus Aufgabe 04 — Stand v0.4.14)*

  ### Option A: Distanzbasiert (Feste Radien-Vielfache)
  - **Regel:** Wechsel in den Frame eines Körpers, wenn der Abstand $d \le k \cdot R$ (z. B. $k = 100 \cdot R$) unterschreitet; Stern-System-Wechsel bei festem Lichtjahr-Radius.
  - **Was sie gut kann:** Extrem einfache Berechnung, intuitiv verständlich, triviale Unit-Tests ohne Gravitationsparameter.
  - **Wo sie bricht:**
    - *Mond-Vorbeiflug:* Mond-Radius $R_{\text{Mond}} = 1.737\text{ km}$. Bei $k = 100$ läge die Schwelle bei $173.700\text{ km}$. Das ist fast das Dreifache der Mond-SOI ($66.000\text{ km}$) — die Kamera würde mitten im von der Erde dominierten Raumschacht in den Mond-Frame springen.
    - *Time-Warp $\times 10^8$:* Starre Abstandsradien berücksichtigen keine Relativgeschwindigkeiten; bei hohen Warp-Faktoren wird die dünne Schale in einem einzelnen Frame übersprungen.
    - *Anflug auf einen `PSC-*`-Stern:* Bei $k \cdot R_{\text{Sonne}}$ ($100 \cdot 696.340\text{ km} \approx 0,46\text{ AE}$) bliebe die Kamera im interstellaren Flug bis kurz vor die Korona im Galaxie-Frame — mit $1,05\text{ m}$ f64-Rauschen bei $1\text{ Lj}$ Distanz.
    - *Flug aus der Galaxie hinaus:* Für körperlose Räume (Nebel, Galaxienhaufen) fehlen Radien als Bezugsgröße.
  - **Folgen für die Navigation:** Ankerwechsel erfolgen rein geometrisch ohne Bezug zur Bahnmechanik. Ankerrelative Geschwindigkeit $v_{\text{rel}}$ erfährt künstliche Diskontinuitäten. Softmin-Referenzhöhe divergiert an den geometrischen Schwellen von der physikalischen Hauptmasse.
  - **Hysterese:** Eintritt bei $d \le k \cdot R$, Austritt bei $d \ge 1,20 \cdot k \cdot R$ (20 % Bandbreite).

  ### Option B: Hierarchisch nach SOI (Sphere of Influence) — EMPFEHLUNG
  - **Regel:** Der aktive Frame folgt der astronomischen Gravitationshierarchie: Die Kamera wählt stets den tiefsten Knoten im Orbitbaum, dessen Gravitations-Einflussbereich $r_{\text{SOI}} = a \cdot (m/M)^{2/5}$ sie betritt; außerhalb planetarer SOIs gilt der Stern-Frame ($r_{\text{SOI, Stern}} \approx 1,03\text{ Lj}$), außerhalb der Stern-SOI der Galaxie-Frame.
  - **Was sie gut kann:** Physikalisch exakte Entkopplung. Die Koordinatengrenzen entsprechen exakt den stärksten Beschleunigungsfeldern und der Kepler-Baumstruktur. f64-Auflösung ist in jeder Ebene optimal ($7,3\text{ nm}$ bei Mond-SOI, $103\text{ nm}$ bei Erde-SOI, $1,05\text{ m}$ im Sternsystem bei $1\text{ Lj}$, $2.100\text{ km}$ im Galaxie-Frame bei $2\text{ Mio. Lj}$).
  - **Verhalten in den Szenarien:**
    - *Mond-Vorbeiflug:* Eintritt erst bei $r \le 66.000\text{ km}$ (Mond-SOI). Davor Verbleib im Erde-Frame, wo die Mondbahn physikalisch exakt akkumuliert wird.
    - *Time-Warp $\times 10^8$:* Verschachtelte SOIs bilden lückenlose physikalische Räume. Auch bei großen Zeitschritten landet die Kamera deterministisch im mathematisch korrekten Dominanzgebiet.
    - *Anflug auf einen `PSC-*`-Stern:* Wechsel vom Galaxie-Frame in den Stern-Frame bei $r \le r_{\text{SOI, Stern}} \approx 1,03\text{ Lj}$ ($\approx 9,8 \times 10^{15}\text{ m}$). Das gesamte Planetary System liegt geschützt im Stern-Frame; f64-Rauschen fällt von $2.100\text{ km}$ (Galaxie) sofort auf $1,05\text{ m}$.
    - *Flug aus der Galaxie hinaus:* Außerhalb der Stern-SOI ($> 1\text{ Lj}$) Galaxie-Frame; beim Verlassen des Milchstraßen-Systems ($\sim 100.000\text{ Lj}$) nahtloser Übergang in den Lokale-Gruppe- / Kosmos-Frame.
  - **Folgen für die Navigation:** Ankerwechsel fällt exakt mit dem Wechsel des dominierenden Anziehungskörpers zusammen. Die ankerrelative Geschwindigkeit $v_{\text{rel}}$ wird beim Frame-Wechsel präzise um die analytische Kepler-Bahngeschwindigkeit $v_{\text{parent}}$ transformiert ($v_{\text{rel, neu}} = v_{\text{rel, alt}} - v_{\text{parent}}$). Die Softmin-Referenzhöhe gewichtet den Anker nativ als Primärkörper.
  - **Hysterese:** Eintritt bei $r \le 1,00 \cdot r_{\text{SOI}}$, Austritt erst bei $r \ge 1,15 \cdot r_{\text{SOI}}$ (15 % Sicherheitsmarge gegen Oszillation an der Gravitationsgrenze).

  ### Option C: Nach scheinbarer Winkelgröße (Screen/FOV-Budget)
  - **Regel:** Wechsel in den Frame eines Körpers/Systems, sobald seine scheinbare Winkelgröße $\theta = 2 \cdot \arctan(R / d)$ am Bildschirm einen Schwellenwert überschreitet ($\theta_{\text{enter}} \ge 15^\circ$ für Körper, $\theta \ge 5^\circ$ für Systeme).
  - **Was sie gut kann:** Garantiert visuelle Kopplung — das Koordinatensystem verankert sich stets am Objekt, das den Bildschirm dominiert und LOD-Details erfordert.
  - **Wo sie bricht:**
    - *Mond-Vorbeiflug:* Ein kleiner Mond hat bei $60.000\text{ km}$ Abstand nur $\theta \approx 0,33^\circ$. Ein Frame-Wechsel würde erst in $6.600\text{ km}$ Höhe stattfinden ($\theta = 15^\circ$), obwohl der Flug bereits tief im Schwerefeld verläuft.
    - *Time-Warp $\times 10^8$:* Zoom- und FOV-Änderungen verändern $\theta$ unabhängig von der räumlichen Position; extremer Time-Warp führt zu kaskadierenden Frame-Jumps.
    - *Anflug auf einen `PSC-*`-Stern:* Ein Stern in $0,5\text{ Lj}$ Entfernung ist ein punktförmiges Objekt ($\theta \ll 0,01^\circ$). Der Wechsel in den Stern-Frame würde erst wenige AE vor dem Stern erfolgen, wodurch der Anflug im galaktischen Rauschen verharrt.
    - *Flug aus der Galaxie hinaus:* Diffuse Großstrukturen (Nebel, Voids) besitzen keine scharfe Winkelgrenze.
  - **Folgen für die Navigation:** Unphysikalische Kopplung von Physik und Koordinatensystem an Render- und Kamera-Parameter (FOV, Bildschirmauflösung).
  - **Hysterese:** Eintritt bei $\theta \ge 15^\circ$, Austritt bei $\theta \le 10^\circ$.
- **Meter-Einheit je Frame** (Befund aus Stufe 2a / Aufgabe 01): IEEE-754 f64 ist Gleitkomma — die relative Auflösung hängt ausschließlich am Betrag der Koordinate, nicht an ihrer physikalischen Einheit. Ein Skalenfaktor pro Frame bringt zusätzliche Rundungsfehler, aber keine rechnerische Präzision. Alle Frames bleiben daher bei Metern (`m`).
- **Katalogformat** (Stufe 4): JSON ist bei 10⁵ Sternen zu groß. Binärformat mit gepackten Feldern, gestreamt in Chunks?
- **Nebeldaten** (Stufe 5): echte 3D-Daten existieren nicht — Rekonstruktion aus 2D-Bild plus geschätzter Distanz. Wie viel Handarbeit pro Objekt ist vertretbar?
- **Speicherbudget** auf dem Tablet: ab wann werden ferne Systeme wieder entladen?
- **Persistenz:** bleibt alles prozedural-reproduzierbar, oder gibt es gespeicherte Zustände (Position, Lesezeichen)?
- **GPU-Terrain als Standardpfad** (offen seit v0.2): Die Readback-Latenz von `getArrayBufferAsync` übersteigt bei der tested Kachelauflösung die Ersparnis im Compute. Der Worker-Pool bleibt deshalb Standard, der GPU-Pfad opt-in. Neu zu bewerten, sobald sich Kachelauflösung oder Zielhardware ändern.
- **Kanon-Kandidaten aus v0.4** (zu beschließen; bis dahin gelten sie als Arbeitsregel in `AGENTS.md`):
  1. *Jede Größe, die pro Frame begrenzt wird, wird zusätzlich pro Sekunde begrenzt* — sonst hängt das Verhalten an der Framerate (Fehler 3 aus v0.4; gilt für Budgets, Dämpfungen, Nachlauf). Kandidat für §4.8.
  2. *Wer einen asynchronen Platz belegt, gibt ihn auch frei, wenn die Antwort nie kommt* (Fehler 2 aus v0.4). Kandidat für eine Ergänzung von §4.5; der Fallback aus §8.3.6 gilt damit für den Worker-Pool genauso wie für den GPU-Kernel.
  3. *Bewegte Bezugskörper werden über ihre Positionsdifferenz mitgeführt, nie über v · dt — sonst ist es ein Euler-Schritt auf einer gekrümmten Bahn.* Dazu: Tests zur Mitführung brauchen gekrümmte Bahnen; geradlinige Bewegung beweist nichts.
- **Noch nicht automatisierte Invarianten** (§8.3.3): keine f32-Weltkoordinaten (statisch schwer — Kandidat: Laufzeit-Assertion im `SceneManager`), Seed-Determinismus (Kandidat: Hash über ein prozedurales System in einem Offline-Test).
- **Nordausrichtung der Kamera** — Zwei-Finger-Drehen umgesetzt (v0.4.7, Aufgabe 08): Der Roll bleibt, wie die Gesten ihn hinterlassen, lässt sich aber mit zwei Fingern ausdrücklich zurückdrehen (Totzone 8°, danach 1:1). Eine automatische Nivellierung gibt es weiterhin nicht. Offen bleibt nur, ob zusätzlich ein Knopf „Norden oben" gewünscht ist — Entscheidung des Inhabers.
- **Aufgabentext gegen den Stand von `main`** (Befund aus Aufgabe 08): Die Aufgabe nannte `SpaceCamera.ts` (Ratsche 473) und Version 0.4.5. Seit Aufgabe 02 (v0.4.6) liegt die Gestenverdrahtung in `camera/cameraTouch.ts`, `SpaceCamera.ts` hat keinen Ratscheneintrag mehr. Umgesetzt in `cameraTouch.ts` mit derselben Auflage (wächst nicht: 153 Zeilen), Version 0.4.7.
- **Stufe 2c zurückgenommen** (v0.4.16; Befund aus Aufgabe 06 und 21): Nach dem Merge von v0.5.0 stand die Warteschlange sofort auf 96, ~12 fps; nach dem Fix v0.5.1 war die Warteschlange leer, aber nichts funktionierte. Drei Ursachen, im Browser mit dem Stand von `main` nachgemessen:
  1. *Die Kamera hatte zur Laufzeit nie einen Rahmen.* `SpaceCamera.setFrame()` wird seit Aufgabe 05 nirgends aufgerufen; `tools/test-camera-frame.ts` rief es selbst und war deshalb grün. Das im PR von 05 versprochene `[Frame: …]` im HUD erschien nie.
  2. *Fehlende Rahmen wurden still übersprungen* (`if (cameraFrame && body.frame && …)`). Seit 2c liegt jeder Körper bei (0,0,0) im eigenen Rahmen ⇒ ohne Umrechnung standen alle an einem Punkt (Sonne und Erde beide bei 3,82·10⁷ m vor der Kamera), vorher wurden aus demselben Grund alle 80 Nachbarsysteme bevölkert und alle 285 Gesteinsplaneten verfeinert.
  3. *Der Navigator überlebt keinen Rahmenwechsel*: `updateFrame()` rechnet nur die Kameraposition um, der Merkpunkt der Mitführung bleibt im alten Rahmen.
  Dazu: 06 änderte sieben Dateien unter `src/` ohne Eskalation (Grenze fünf). Folgerung: eine Umrechnungsstelle, die einen fehlenden Rahmen als Fehler meldet; ein Prüfstand über den ganzen Frame-Loop statt Tests der Einzelteile; Laufzeit-Selbsttest „Rahmen fehlt" (Aufgabe 22); 06 wird danach neu geschnitten. Kanon-Kandidat: *Eine Umrechnung zwischen Rahmen darf nie still entfallen — fehlt ein Rahmen, ist das ein Fehler, kein Sonderfall.*
- **Parameter-Properties** in `SpaceCamera`, `PlanetLOD`, `UniverseManager` (`constructor(private readonly …)`): Node-Type-Stripping kann sie nicht entfernen, die Dateien sind damit nicht offline ladbar. Erst umstellen, wenn ein Test sie braucht.

---

## 10. Glossar

| Begriff | Bedeutung |
|---|---|
| **Floating Origin** | Kamera bei (0,0,0), Objekte werden kamerarelativ platziert |
| **Frame / Bezugsrahmen** | Lokaler Koordinatenursprung; künftig hierarchisch verschachtelt |
| **LOD** | Level of Detail; hier Quadtree über Cube-Sphere-Flächen |
| **Skirt** | Abgesenkter Randring einer Kachel; kaschiert T-Junction-Risse |
| **Cube-Sphere** | Würfel auf Kugel projiziert; sechs Quadtree-Wurzeln |
| **SOI** | Sphere of Influence — Gravitationsdominanzbereich eines Körpers |
| **TSL** | Three.js Shading Language; erzeugt WGSL |
| **Impostor** | Vorgerendertes Bild eines Objekts als Ersatz für Geometrie |
| **Frostlinie** | Abstand, ab dem flüchtige Stoffe kondensieren; trennt Gesteins- von Gasplaneten |
| **Ridged Noise** | Bergrücken-Variante von fBm über `1 − |n|` |
| **Vertragskarte** | `docs/contracts.md` — generierte Übersicht aller Exporte, Signaturen, Abhängigkeiten |
| **Aufgabe** | Datei in `docs/aufgaben/`; ein Ziel, ein prüfbares Abnahmekriterium, ein PR |
| **Vorschau** | Netlify-Deploy eines PR unter eigener https-Adresse, für die Tablet-Prüfung |

---

## 11. Änderungsprotokoll

| Version | Inhalt |
|---|---|
| v0.1 | Fundament: WebGPU + Log-Depth, Floating Origin, Kepler, Hybrid-Universum, Cube-Sphere-LOD |
| v0.2 | Asynchrone Terrain-Erzeugung (Worker-Pool + WGSL-Compute via TSL), Gradienten-Normalen, Touch-Steuerung, adaptive Renderauflösung |
| v0.3 | Stufe 1: freier Flug und Goto als Log-Interpolation, isolierter `src/nav/`-Kern mit Offline-Tests, Zwei-Modi-Kamera mit Multi-Pointer-Touch, `uid` und ankerrelative Geschwindigkeit auf `CelestialBody`, Laufzeit-Selbsttest gegen `dtReal`/`dtSim`-Verwechslung |
| v0.4 | Quaternion-Orientierung ohne Achsenanschlag (`nav/orientation.ts`), robuste Kachel-Warteschlange (Wachhund + Fallback), framerate-unabhängiger Geschwindigkeitsdeckel, explizite Schub-Totzone; 97 Offline-Tests |
| v0.4.1 | Umzug auf Agent-Betrieb: Quellbaum statt ZIP im Repo, `AGENTS.md`, CI, Netlify-Vorschau, `tools/contracts.mjs` + `docs/contracts.md` (three-Freiheit transitiv, Dateideckel-Ratsche), Aufgaben 00–06. Testskripte mit `--experimental-strip-types` (sonst scheitern sie unter Node 22.6–22.17), drei verdeckte Typfehler behoben (`npm run build` lief vorher nicht), Präzisionstabelle §3.1 korrigiert, §8/§12 auf Aufgaben und PRs umgestellt |
| v0.4.2 | Probelauf: doppeltes `formatDistance` auf `src/nav/format.ts` konsolidiert, veraltete Definition aus `src/core/constants.ts` entfernt. |
| v0.4.3 | `SPICKZETTEL.md` für den Inhaber; `AGENTS.md`: PR-Beschreibung vollständig nach Vorlage inklusive Testausgabe und `Fixes #…`; Vorlage um *Testausgabe* ergänzt; Aufgabe 04 an die Versionsregel angeglichen |
| v0.4.4 | Aufgabe 07: Touch-Gesten. Orbit: der berührte Bodenpunkt bleibt unter dem Finger (vorher lief der Körper dem Finger entgegen), zum Planetenrand stetig gesättigt statt unbegrenzt. Roll-Nivellierung entfernt — sie drehte das Bild nach schrägen Gesten ungefragt um seine Mitte. Wurf als Ausgleichsgerade über 100 ms, kein Wurf nach Ruhen, Nachlauf framerate-unabhängig integriert. Neue three-freie Kerne `nav/dragKernel.ts` und `nav/fling.ts` mit 38 Offline-Tests; `SpaceCamera.ts` 476 → 473 Zeilen |
| v0.4.5 | Stufe 2a (Aufgabe 01): Frame-Baum als reine, three-freie Datenstruktur (`src/frames/`). `createFrame`, `attachFrame`, `findLCA`, `transformPoint` mit präziser LCA-Ablösung. 7 Offline-Tests in `tools/test-frames.ts` inklusive Nah-bei-Nah-, Fern-, Roundtrip- (≤ 4 · ε · max|p|), Gegenprobe- und Bewegungs-Tests. |
| v0.4.6 | Vorbereitung 2b (Aufgabe 02): `SpaceCamera.ts` unter den Deckel geteilt (473 → 244 Zeilen). Gesten- und Touch-Eingabe in `cameraTouch.ts` (three-frei), Platzierungs- und Near-Plane-Logik in `cameraPlacement.ts`. `CAP_BASELINE`-Eintrag für `SpaceCamera.ts` entfernt. |
| v0.4.7 | Aufgabe 08: Orbit-Griff über den Rand hinaus — innen weiter exakt, dahinter Umrundung wie `orbit` (z = 0), die Drehung je px schließt am Rand stetig an (größte Stufe 0,13 %) und klingt über 150 px auf die Orbit-Rate ab; der Griffpunkt muss nach dem Zurückziehen nicht mehr unter dem Finger liegen (Inhaberentscheidung). Zwei-Finger-Drehen um die Bildmitte: Totzone 8°, danach 1:1 ohne Sprung, Wurf über die vorhandene Aufzeichnung. `grabAngle` entfällt; 59 Gesten-Tests |
| v0.4.8 | Aufgabe 09: Kamera-Gefühl — Gefühlswerte der Steuerung (`spinTau`, `grabEdge`, `twistStartDeg`, `twistDominance`, `pinchLockPx`, `edgeFadePx`, `maxSpin`, `flingRest`) in isolierter `src/nav/feel.ts` gebündelt und per URL (`?feel=key:val`) überschreibbar. Gleichmäßiger Orbit über den Rand, Nachlauf verlängert (spinTau 0,8 s), Dreheinrasten gedämpft (20°, Dominanz, Pinch-Sperre). 47 Gesten-Tests in `tools/test-drag.ts`. |
| v0.4.9 | Aufgabe 10: Gleitflug-Pinch (`?feel=glide:1`). Pinch steuert Schub und Bremsen mit Bremsraste, `glideMax`/`glideMaxBack`, framerate-unabhängigem Abklingen (`glideHalfLife`) und verzögerter Kopplung der Flugrichtung an den Blick (`glideCoupleTau`). 12 Offline-Tests in `tools/test-glide.ts`. |
| v0.4.10 | Aufgabe 11: Tuning-Panel (`?tune`). Live-Abstimmung aller Gefühlswerte im Flug per Regler ohne Neuladen; automatische Adresszeilen-Nachführung, Kopierknopf und Standard-Reset. Reine Funktionen in `nav/feel.ts`, UI-Panel in `src/ui/TuningPanel.ts`. 5 Offline-Tests in `tools/test-feel.ts`. |
| v0.4.11 | Aufgabe 12: Automatisches Tempo. Kontaktzeit-Begrenzer (`contactCap`, `softCap`) zur weichen Drosselung beim Anflug, direkte Annäherungskappung nach Relaxation; Stufen-Rückführung (`relaxStage`) im freien Flug mit einseitiger Rückführung auf ×1 bei Positionsveränderung. Isolierte Kernfunktionen in `src/nav/autoPace.ts`. 16 Offline-Tests in `tools/test-pace.ts`. |
| v0.4.12 | Aufgabe 13: Warp-Mitführung über Verschiebung. Mitführung im Freiflug von v · dt auf die exakte Positionsdifferenz des Ankers umgestellt (`src/nav/frameCarry.ts`, `Navigator.ts`). Orbit-Freiflug-Kontinuität über `updatePlacement(0)` in `SpaceCamera.enterFreeFlight()` und `resetMotion` abgesichert. 25 Offline-Tests in `tools/test-warp.ts`. |
| v0.4.13 | Vorbereitung 2b (Aufgabe 03): `Engine.ts` unter den Dateideckel geteilt (496 → 236 Zeilen). HUD-Formatierung in `EngineHud.ts`, Eingabe-Bindung und Zielauswahl in `EngineInput.ts`. `CAP_BASELINE`-Eintrag für `Engine.ts` entfernt. |
| v0.4.14 | Aufgabe 04: Entscheidungsvorlage Frame-Wechsel-Schwellen in Leitfaden §9 ausgearbeitet (Optionen A, B, C; Empfehlung Option B hierarchisch nach SOI). Nachtrag: Entscheidung für Option B (hierarchisch nach SOI) am 19.10.2026 eingetragen. |
| v0.4.15 | Stufe 2b (Aufgabe 05): Kamera hängt in Bezugsrahmen um (`SpaceCamera`, `SceneManager`). `updateActiveFrame` mit SOI-Radius und 15 % Hysterese in `src/frames/FrameTree.ts`. HUD-Anzeige des Kameraframes. 12 Offline-Tests in `tools/test-camera-frame.ts`. |
| v0.4.16 | Rücknahme von Stufe 2c (v0.5.0, Aufgabe 06) und ihrem Fix (v0.5.1, Aufgabe 21): Code wieder auf dem Stand v0.4.15. Befund in §9 (Kamera ohne Rahmen, still übersprungene Umrechnung, Navigator beim Rahmenwechsel). Neue Aufgabe 22 als Fundament, Aufgaben 14–20 für Nebenspur B. |

---

## 12. Aufgabenprotokoll

Verbindlicher Ablauf für jede Aufgabe, egal ob Agent oder Mensch sie bearbeitet. Er kostet ein paar Minuten und ist der Grund, warum Aufgabe 40 noch so präzise ausgeführt wird wie Aufgabe 4. Die operative Kurzfassung steht in `AGENTS.md`.

### 12.1 Vorher — Auftrag

1. **Genau ein Ziel:** eine Aufgabendatei in `docs/aufgaben/`, mit einem *Fertig, wenn*, das sich prüfen lässt — bei Stufen aus §7 deren Kriterium wörtlich. Passt das Ziel nicht in eine Aufgabe, wird es vorher geteilt (§12.4).
2. **Dateiliste vorab**, benannt und begründet. Alles außerhalb ist tabu.
3. **Kontextpaket:** §1 (Zielbild), §4 (Kanon), `docs/contracts.md`, die gelisteten Dateien. Sonst nichts.
4. **Start:** GitHub-Issue `Bearbeite docs/aufgaben/<datei>.md nach AGENTS.md.` mit Label `jules`.

### 12.2 Währenddessen — Eskalation statt stiller Umplanung

Stellt sich heraus, dass der Auftrag nicht trägt — mehr Dateien nötig, eine Invariante im Weg, eine Annahme falsch —, wird abgebrochen und in drei Sätzen berichtet: was geplant war, was die Realität ist, welche Optionen es gibt. Der Befund geht nach §9, die Aufgabe auf `status: blockiert`. Kein Weiterarbeiten am stillschweigend veränderten Ziel; auf genau diesem Weg gehen Zielbilder verloren.

### 12.3 Nachher — Abschluss

1. `npm run check` grün — lokal und in der CI.
2. PR nach Vorlage, Abnahmekriterium ausdrücklich als erfüllt oder nicht erfüllt bewertet.
3. **Leitfaden-Patch:** nur die geänderten Abschnitte, nie das ganze Dokument. §2, §9 und §11 sind die üblichen Kandidaten.
4. `package.json` hochzählen, Aufgabe auf `status: erledigt`.
5. **Inhaber:** Tablet-Prüfung in der Vorschau (wenn `tablet: ja`), dann Merge — oder ein Kommentar im PR, auf den der Agent reagiert.

### 12.4 Stufenschnitt

Eine Stufe aus §7 ist eine Absicht, keine Aufgabe. Vor Beginn wird sie in Teilstufen zerlegt, die je ein eigenes Abnahmekriterium haben und je in eine Aufgabe passen. Stufe 2 zum Beispiel:

- **2a** Frame-Baum als reine Datenstruktur, three-frei, mit Roundtrip-Test über mehrere Frame-Wechsel
- **2b** Kamera hängt um: `SpaceCamera`, `SceneManager`
- **2c** Migration: `CelestialBody`, `UniverseManager`, Katalog-Import

Ausgeführt als Aufgaben 01–06, inklusive der Vorbereitung (Dateien unter den Deckel) und einer Entscheidungsvorlage für die offene Frage aus §9.

### 12.5 Hygiene

Eine Aufgabe = eine Agent-Sitzung = ein PR. Lange Sitzungen werden unscharf; lieber abbrechen und neu ansetzen. Der Kontext kommt aus dem Repo — `AGENTS.md`, dieser Leitfaden, die Vertragskarte —, nie aus Chatverläufen. Aufgaben laufen nacheinander, nicht parallel: parallele PRs kollidieren in `package.json`, `docs/contracts.md` und §2/§11.
