# Vertragskarte

> Erzeugt von `tools/contracts.mjs` — nicht von Hand bearbeiten. `npm run contracts` erneuert sie,
> `npm run check` schlägt fehl, wenn sie dem Code hinterherhinkt.
>
> **three:** `—` frei · `direkt` importiert three · `über X` hängt per Wert-Import an einer Datei, die three importiert.
> **Kern:** muss three-frei bleiben (geprüft). **Deckel:** `⚠` = Bestand über 300 Zeilen, darf nicht wachsen.

| Datei | three | Kern | Deckel | hängt ab von |
|---|---|---|---|---|
| `camera/SpaceCamera.ts` | direkt |  |  | camera/cameraPlacement, camera/cameraTouch, core/constants, math/Vector3d, nav/dragKernel, nav/orientation, nav/types, nav/vec, universe/CelestialBody |
| `camera/cameraPlacement.ts` | direkt |  |  | math/Vector3d, universe/CelestialBody |
| `camera/cameraTouch.ts` | — | ✓ |  | nav/dragKernel, nav/feel, nav/fling, nav/glide, nav/vec |
| `core/Engine.ts` | direkt |  | ⚠ | camera/SpaceCamera, core/SceneManager, core/SimClock, core/constants, nav/Navigator, nav/format, nav/picking, nav/types, nav/vec, terrain/TerrainProvider, terrain/tileGeometry, ui/FlightControls, universe/CelestialBody, universe/UniverseManager |
| `core/SceneManager.ts` | direkt |  |  | math/Vector3d, universe/CelestialBody |
| `core/SimClock.ts` | — |  |  | core/constants |
| `core/constants.ts` | — |  |  |  |
| `frames/FrameTree.ts` | — | ✓ |  | frames/types, nav/vec |
| `frames/types.ts` | — | ✓ |  | nav/vec |
| `main.ts` | über core/Engine |  |  | core/Engine, ui/TuningPanel |
| `math/Vector3d.ts` | direkt |  |  |  |
| `math/rng.ts` | — | ✓ |  |  |
| `nav/Navigator.ts` | — | ✓ |  | nav/flightKernel, nav/gotoKernel, nav/proximity, nav/types, nav/vec |
| `nav/dragKernel.ts` | — | ✓ |  | nav/feel, nav/orientation, nav/vec |
| `nav/feel.ts` | — | ✓ |  |  |
| `nav/flightKernel.ts` | — | ✓ |  | nav/proximity, nav/types, nav/vec |
| `nav/fling.ts` | — | ✓ |  | nav/feel, nav/vec |
| `nav/format.ts` | — | ✓ |  |  |
| `nav/glide.ts` | — | ✓ |  | nav/feel, nav/flightKernel, nav/types, nav/vec |
| `nav/gotoKernel.ts` | — | ✓ |  | nav/types, nav/vec |
| `nav/orientation.ts` | — | ✓ |  | nav/vec |
| `nav/picking.ts` | — | ✓ |  | nav/types, nav/vec |
| `nav/proximity.ts` | — | ✓ |  | nav/types, nav/vec |
| `nav/types.ts` | — | ✓ |  | nav/vec |
| `nav/vec.ts` | — | ✓ |  |  |
| `physics/Kepler.ts` | über math/Vector3d |  |  | core/constants, math/Vector3d |
| `terrain/PlanetLOD.ts` | direkt |  |  | terrain/TerrainProvider, terrain/tileGeometry |
| `terrain/TerrainProvider.ts` | über terrain/gpuTerrain |  | ⚠ | terrain/gpuTerrain, terrain/tileGeometry |
| `terrain/gpuTerrain.ts` | direkt |  | ⚠ | terrain/tileGeometry |
| `terrain/noise.ts` | — | ✓ |  | math/rng |
| `terrain/terrainWorker.ts` | — |  |  | terrain/tileGeometry |
| `terrain/tileGeometry.ts` | — | ✓ | ⚠ | terrain/noise |
| `ui/FlightControls.ts` | — |  |  | nav/format, nav/types |
| `ui/TuningPanel.ts` | — |  |  | nav/feel |
| `universe/CelestialBody.ts` | direkt |  |  | core/constants, math/Vector3d, physics/Kepler |
| `universe/Planet.ts` | direkt |  |  | math/Vector3d, terrain/PlanetLOD, terrain/noise, terrain/tileGeometry, universe/CelestialBody |
| `universe/Star.ts` | direkt |  |  | math/Vector3d, universe/CelestialBody |
| `universe/UniverseManager.ts` | über math/Vector3d |  |  | core/SceneManager, core/constants, data/catalog.json, math/Vector3d, math/rng, physics/Kepler, terrain/tileGeometry, universe/CelestialBody, universe/Planet, universe/Star, universe/procedural |
| `universe/procedural.ts` | — |  |  | core/constants, math/rng, physics/Kepler, terrain/PlanetLOD |

## Prüfskripte

- `npm run dev` — `vite`
- `npm run build` — `tsc && vite build`
- `npm run preview` — `vite preview`
- `npm run typecheck` — `tsc --noEmit`
- `npm run test` — `npm run test:frames && npm run test:nav && npm run test:orbit && npm run test:orientation && npm run test:drag && npm run test:glide && npm run test:feel && npm run test:throughput`
- `npm run test:frames` — `node --experimental-strip-types --import ./tools/register-ts.mjs tools/test-frames.ts`
- `npm run test:nav` — `node --experimental-strip-types --import ./tools/register-ts.mjs tools/test-nav.ts`
- `npm run test:orbit` — `node --experimental-strip-types --import ./tools/register-ts.mjs tools/test-orbit.ts`
- `npm run test:orientation` — `node --experimental-strip-types --import ./tools/register-ts.mjs tools/test-orientation.ts`
- `npm run test:drag` — `node --experimental-strip-types --import ./tools/register-ts.mjs tools/test-drag.ts`
- `npm run test:glide` — `node --experimental-strip-types --import ./tools/register-ts.mjs tools/test-glide.ts`
- `npm run test:feel` — `node --experimental-strip-types --import ./tools/register-ts.mjs tools/test-feel.ts`
- `npm run test:throughput` — `node --experimental-strip-types --import ./tools/register-ts.mjs tools/test-throughput.ts`
- `npm run contracts` — `node tools/contracts.mjs`
- `npm run check` — `npm run typecheck && npm test && node tools/contracts.mjs --check && vite build`

## Exporte

### `camera/SpaceCamera.ts`

- `type CameraMode`
- `class SpaceCamera`
  - `readonly camera: THREE.PerspectiveCamera`
  - `readonly worldPosition: Vector3d`
  - `target: CelestialBody | null`
  - `mode: CameraMode`
  - `constructor(private readonly dom: HTMLElement)`
  - `navInput(base: NavInput, dt: number): NavInput`
  - `focus(body: CelestialBody): void`
  - `enterOrbit(body: CelestialBody): void`
  - `enterFreeFlight(): void`
  - `lookTowards(point: Vec3, dt: number, tau = 0.45): void`
  - `zoomStep(direction: 1 | -1): void`
  - `setWorldPosition(v: Vec3): void`
  - `setFreeAltitude(altitude: number): void`
  - `basis(): { forward: Vec3; right: Vec3; up: Vec3 }`
  - `clampToSurface(body: CelestialBody): Vec3 | null`
  - `updateOrientation(dt: number): void`
  - `updatePlacement(dt: number): void`
  - `get altitude(): number`
  - `resize(width: number, height: number): void`
  - `get fovYRadians(): number`

### `camera/cameraPlacement.ts`

- `interface OrbitPlacementState { distance, targetDistance }`
- `function clampToSurface(worldPosition: Vector3d, body: CelestialBody, radialScratch: THREE.Vector3): { normal: { x: number; y: number; z: number } | null }`
- `function placeOrbit(worldPosition: Vector3d, target: CelestialBody | null, state: OrbitPlacementState, viewVector: THREE.Vector3, radialScratch: THREE.Vector3, dt: number): OrbitPlacementState`
- `function applyDolly(worldPosition: Vector3d, viewVector: THREE.Vector3, freeAltitude: number, pendingDolly: number): void`
- `function computeNearPlane(altitude: number): number`

### `camera/cameraTouch.ts`

- `interface PointerState { x, y }`
- `interface CameraTouchCallbacks { getFovYRadians, getOrbitView, getMode, applyStep, zoomBy }`
- `class CameraTouchInput`
  - `readonly fling: Fling`
  - `readonly glide: Glide`
  - `constructor(private readonly dom: HTMLElement, private readonly callbacks: CameraTouchCallbacks)`

### `core/Engine.ts`

- `class Engine`
  - `static async create(container: HTMLElement, hud: HTMLElement): Promise<Engine>`

### `core/SceneManager.ts`

- `class SceneManager`
  - `readonly scene: THREE.Scene`
  - `constructor()`
  - `addBody(body: CelestialBody): void`
  - `addSystem(root: CelestialBody): void`
  - `removeBody(body: CelestialBody): void`
  - `get allBodies(): readonly CelestialBody[]`
  - `syncToCamera(cameraWorldPos: Vector3d, dt: number): void`

### `core/SimClock.ts`

- `class SimClock`
  - `simTime`
  - `timeWarp`
  - `paused`
  - `tick(): number`
  - `faster(): void`
  - `slower(): void`
  - `resetWarp(): void`
  - `togglePause(): void`
  - `get date(): Date`

### `core/constants.ts`

- `const G`
- `const AU`
- `const LY`
- `const PC`
- `const SOLAR_MASS`
- `const SOLAR_RADIUS`
- `const SOLAR_LUMINOSITY`
- `const SOLAR_TEMPERATURE`
- `const EARTH_MASS`
- `const EARTH_RADIUS`
- `const JUPITER_MASS`
- `const JUPITER_RADIUS`
- `const DAY`
- `const YEAR`
- `const DEG`
- `const J2000_UNIX_MS`

### `frames/FrameTree.ts`

- `function createFrame(id: string, name: string, position: Vec3 = ZERO): FrameNode`
- `function attachFrame(child: FrameNode, parent: FrameNode | null): void`
- `function findLCA(a: FrameNode, b: FrameNode): { lca: FrameNode; pathToLCAFromA: FrameNode[]; pathToLCAFromB: FrameNode[]; }`
- `function transformPoint(p: Vec3, from: FrameNode, to: FrameNode): Vec3`

### `frames/types.ts`

- `interface FrameNode { id, name, parent, children, position }`

### `math/Vector3d.ts`

- `class Vector3d`
  - `x: number`
  - `y: number`
  - `z: number`
  - `constructor(x = 0, y = 0, z = 0)`
  - `set(x: number, y: number, z: number): this`
  - `copy(v: Vector3d): this`
  - `clone(): Vector3d`
  - `add(v: Vector3d): this`
  - `sub(v: Vector3d): this`
  - `addVectors(a: Vector3d, b: Vector3d): this`
  - `subVectors(a: Vector3d, b: Vector3d): this`
  - `multiplyScalar(s: number): this`
  - `lengthSq(): number`
  - `length(): number`
  - `distanceTo(v: Vector3d): number`
  - `normalize(): this`
  - `toVector3(target: THREE.Vector3): THREE.Vector3`

### `math/rng.ts`

- `function hash32(...values: number[]): number`
- `function hashString(s: string): number`
- `function mulberry32(seed: number): () => number`
- `class Rng`
  - `constructor(seed: number)`
  - `float(min = 0, max = 1): number`
  - `int(min: number, max: number): number`
  - `logUniform(min: number, max: number): number`
  - `normal(mean = 0, sd = 1): number`
  - `angle(): number`

### `nav/Navigator.ts`

- `type NavMode`
- `interface NavigatorConfig { flight, goto, cancelThreshold, frameVelocityTau }`
- `const DEFAULT_NAVIGATOR: NavigatorConfig`
- `interface NavResult { position, velocity, relVelocity, mode, anchor, altitude, speed, relativeSpeed, lookAt, gotoTarget, gotoProgress }`
- `class Navigator`
  - `readonly cfg: NavigatorConfig`
  - `constructor(cfg: Partial<NavigatorConfig> = {})`
  - `getMode(): NavMode`
  - `getRelativeVelocity(): Vec3`
  - `getFrameVelocity(): Vec3`
  - `setRelativeVelocity(v: Vec3): void`
  - `requestGoto(cameraPos: Vec3, target: BodyRef, preferredDir?: Vec3): void`
  - `cancelGoto(): void`
  - `update(frame: NavFrame, bodies: readonly BodyRef[], input: NavInput, dt: number): NavResult`

### `nav/dragKernel.ts`

- `interface ScreenPoint { x, y }`
- `interface DragView { width, height, fovY }`
- `interface OrbitView { distance, radius }`
- `type DragKind`
- `const LOOK_RATE`
- `const GRAB_EDGE`
- `const GRAB_MIN_PX`
- `const EDGE_FADE_PX`
- `const TWIST_START`
- `function chooseDrag(p: ScreenPoint, view: DragView, orbit: OrbitView | null): DragKind`
- `function dragTurn(kind: DragKind, from: ScreenPoint, to: ScreenPoint, view: DragView, orbit: OrbitView | null): Vec3`
- `interface Twist { angle, total, engaged, initialDist, locked }`
- `function beginTwist(a: ScreenPoint, b: ScreenPoint): Twist`
- `function twistTurn(t: Twist, a: ScreenPoint, b: ScreenPoint): { twist: Twist; turn: Vec3 }`
- `function applyTurn(q: Quat, v: Vec3): Quat`
- `function turnBetween(a: Vec3, b: Vec3): Vec3`
- `function grabPoint(p: ScreenPoint, view: DragView, eps: number): Vec3`
- `function surfaceAngle(alpha: number, eps: number): number`
- `function exactLimit(eps: number): number`

### `nav/feel.ts`

- `interface FeelConfig { spinTau, maxSpin, flingRest, grabEdge, edgeFadePx, twistStartDeg, twistDominance, pinchLockPx, glide, glideGain, glideBrake, glideMax, glideMaxBack, glideHalfLife, glideCoupleTau }`
- `interface FeelRange { min, max }`
- `const FEEL_RANGES: Record<keyof FeelConfig, FeelRange>`
- `const DEFAULT_FEEL: Readonly<FeelConfig>`
- `const FEEL: FeelConfig`
- `function parseFeel(search: string): void`
- `function setFeel(key: string, value: number): boolean`
- `function isLogScale(key: keyof FeelConfig): boolean`
- `function valueToSlider(value: number, key: keyof FeelConfig): number`
- `function sliderToValue(t: number, key: keyof FeelConfig): number`
- `function feelToSearch(cfg: FeelConfig): string`
- `function mergeFeelIntoSearch(search: string, cfg: FeelConfig): string`

### `nav/flightKernel.ts`

- `interface FlightConfig extends ProximityConfig { rate, accelTau, dampTau, maxSpeed, maxReferenceRate, maxStepFraction, maxSubsteps }`
- `const DEFAULT_FLIGHT: FlightConfig`
- `interface FlightStep { position, relVelocity, worldVelocity, proximity, speed, relativeSpeed, referenceSpeed, substeps }`
- `function stepFlight(position: Vec3, relVelocity: Vec3, basis: { forward: Vec3; right: Vec3; up: Vec3 }, input: NavInput, bodies: readonly BodyRef[], frameVelocity: Vec3, dt: number, cfg: FlightConfig = DEFAULT_FLIGHT): FlightStep`

### `nav/fling.ts`

- `const SPIN_TAU`
- `const MAX_SPIN`
- `const FLING_WINDOW`
- `const FLING_REST`
- `class Fling`
  - `press(time: number): void`
  - `record(time: number, v: Vec3): void`
  - `release(time: number): void`
  - `stop(): void`
  - `get angularVelocity(): Vec3`
  - `coast(dt: number): Vec3 | null`

### `nav/format.ts`

- `function formatDistance(m: number): string`
- `function formatSpeed(mps: number): string`
- `function formatScale(scale: number): string`

### `nav/glide.ts`

- `class Glide`
  - `getSpeed(): number`
  - `getDirection(): Vec3`
  - `reset(): void`
  - `begin(): void`
  - `end(): void`
  - `pinch(lambda: number): void`
  - `step(dt: number, basis: { forward: Vec3; right: Vec3; up: Vec3 }, base: NavInput): NavInput`

### `nav/gotoKernel.ts`

- `interface GotoConfig { frameFactor, minClearance, baseSeconds, secondsPerEfold, turnSeconds, minDuration, maxDuration }`
- `const DEFAULT_GOTO: GotoConfig`
- `interface GotoPlan { targetId, d0, d1, u0, u1, duration, elapsed }`
- `function smootherstep(t: number): number`
- `function planGoto(cameraPos: Vec3, target: BodyRef, cfg: GotoConfig = DEFAULT_GOTO, preferredDir?: Vec3): GotoPlan`
- `function gotoProgress(plan: GotoPlan): number`
- `function sampleGoto(plan: GotoPlan, targetPosition: Vec3): Vec3`
- `function smootherstepDerivative(t: number): number`
- `function sampleGotoVelocity(plan: GotoPlan): Vec3`
- `function advanceGoto(plan: GotoPlan, dt: number): void`
- `function gotoFinished(plan: GotoPlan): boolean`

### `nav/orientation.ts`

- `interface Quat { x, y, z, w }`
- `interface Basis { forward, right, up }`
- `function quat(x = 0, y = 0, z = 0, w = 1): Quat`
- `function copyQuat(q: Quat): Quat`
- `function isFiniteQuat(q: Quat): boolean`
- `function normalizeQuat(q: Quat): Quat`
- `function mulQuat(a: Quat, b: Quat): Quat`
- `function quatFromAxisAngle(axis: Vec3, angle: number): Quat`
- `function rotateByQuat(q: Quat, v: Vec3): Vec3`
- `function basisFromQuat(q: Quat): Basis`
- `function quatFromBasis(right: Vec3, up: Vec3, forward: Vec3): Quat`
- `function rotateLocal(q: Quat, pitch: number, yaw: number): Quat`
- `function rollLocal(q: Quat, angle: number): Quat`
- `function rollAngle(q: Quat, worldUp: Vec3): number | null`
- `interface LevelConfig { tau, poleFade, rollFade }`
- `const DEFAULT_LEVEL: LevelConfig`
- `function levelRoll(q: Quat, worldUp: Vec3, dt: number, cfg: LevelConfig = DEFAULT_LEVEL): Quat`
- `function turnTowards(q: Quat, dir: Vec3, t: number): Quat`
- `function orientTowards(dir: Vec3, worldUp: Vec3, fallbackRight?: Vec3): Quat`

### `nav/picking.ts`

- `interface PickResult { body, miss, angularRadius, distance }`
- `function pickBody(cameraPos: Vec3, rayDir: Vec3, bodies: readonly BodyRef[], toleranceRad: number): PickResult | null`
- `function tapTolerance(fovY: number, viewportHeight: number, radiusPx = 44): number`
- `function screenRay(x: number, y: number, width: number, height: number, fovY: number, basis: { forward: Vec3; right: Vec3; up: Vec3 }): Vec3`

### `nav/proximity.ts`

- `interface ProximityConfig { minAltitude, maxAltitude, softness, fallbackAltitude }`
- `const DEFAULT_PROXIMITY: ProximityConfig`
- `interface Proximity { anchor, altitude, reference }`
- `function evaluateProximity(position: Vec3, bodies: readonly BodyRef[], cfg: ProximityConfig): Proximity`

### `nav/types.ts`

- `interface BodyRef { id, name?, position, radius, velocity? }`
- `interface NavInput { forward, right, up, speedScale, assist, brake? }`
- `function neutralInput(): NavInput`
- `const THRUST_EPSILON`
- `const THROTTLE_DEAD_ZONE`
- `function throttleToForward(raw: number): number`
- `interface NavFrame { position, forward, right, up }`

### `nav/vec.ts`

- `interface Vec3 { x, y, z }`
- `const ZERO: Vec3`
- `function vec3(x = 0, y = 0, z = 0): Vec3`
- `function copy(a: Vec3): Vec3`
- `function add(a: Vec3, b: Vec3): Vec3`
- `function sub(a: Vec3, b: Vec3): Vec3`
- `function scale(a: Vec3, s: number): Vec3`
- `function addScaled(a: Vec3, b: Vec3, s: number): Vec3`
- `function dot(a: Vec3, b: Vec3): number`
- `function cross(a: Vec3, b: Vec3): Vec3`
- `function lengthSq(a: Vec3): number`
- `function length(a: Vec3): number`
- `function distance(a: Vec3, b: Vec3): number`
- `function normalize(a: Vec3, fallback: Vec3 = { x: 0, y: 0, z: 1 }): Vec3`
- `function lerp(a: Vec3, b: Vec3, t: number): Vec3`
- `function clamp(v: number, lo: number, hi: number): number`
- `function orthogonal(a: Vec3): Vec3`
- `function rotateAround(v: Vec3, axis: Vec3, angle: number): Vec3`
- `function slerpDir(a: Vec3, b: Vec3, t: number): Vec3`
- `function slerpDirDerivative(a: Vec3, b: Vec3, t: number): Vec3`
- `function relaxFactor(dt: number, tau: number): number`

### `physics/Kepler.ts`

- `interface OrbitalElements { a, e, i, Omega, omega, M0, epoch }`
- `function solveKepler(M: number, e: number): number`
- `class Orbit`
  - `readonly mu: number`
  - `readonly n: number`
  - `readonly el: OrbitalElements`
  - `constructor(el: OrbitalElements, parentMass: number)`
  - `get period(): number`
  - `getStateAtTime(t: number, outPos: Vector3d, outVel?: Vector3d): void`

### `terrain/PlanetLOD.ts`

- `export type { TerrainParams }`
- `interface PlanetLODConfig { radius, seed, terrain }`
- `class PlanetLOD`
  - `readonly group: THREE.Group`
  - `readonly field: TerrainField`
  - `readonly spec: TerrainSpec`
  - `readonly provider`
  - `constructor(readonly config: PlanetLODConfig)`
  - `sampleHeight(dir: THREE.Vector3): number`
  - `surfacePoint(face: number, u: number, v: number, outPos: THREE.Vector3, outDir: THREE.Vector3): void`
  - `update(camLocal: THREE.Vector3): void`
  - `createMesh(buffers: TileBuffers, center: THREE.Vector3): THREE.Mesh`
  - `dispose(): void`

### `terrain/TerrainProvider.ts`

- `type TerrainBackend`
- `type TerrainBackendChoice`
- `type TileCallback`
- `class TerrainProvider`
  - `backend: TerrainBackend`
  - `built`
  - `lost`
  - `jobTimeoutMs`
  - `jobTimeoutPumps`
  - `maxLostJobs`
  - `get workerCount(): number`
  - `get pending(): number`
  - `async configure(options: { renderer?: THREE.WebGPURenderer; backend?: TerrainBackendChoice; probe?: { field: TerrainField; tile: TileSpec }; createWorker?: () => Worker; }): Promise<void>`
  - `request(field: TerrainField, spec: TerrainSpec, tile: TileSpec, priority: number, callback: TileCallback): number`
  - `reprioritize(id: number, priority: number): void`
  - `cancel(id: number): void`
  - `pump(): void`
  - `dispose(): void`
- `function getTerrainProvider(): TerrainProvider`
- `async function configureTerrainProvider(options: { renderer?: THREE.WebGPURenderer; backend?: TerrainBackendChoice; probe?: { field: TerrainField; tile: TileSpec }; }): Promise<TerrainBackend>`

### `terrain/gpuTerrain.ts`

- `class GpuTerrain`
  - `static async create(renderer: THREE.WebGPURenderer, probe: { field: TerrainField; tile: TileSpec; reference: Float32Array; }): Promise<GpuTerrain | null>`
  - `computeTile(field: TerrainField, tile: TileSpec): Promise<Float32Array>`

### `terrain/noise.ts`

- `class SimplexNoise3D`
  - `readonly perm: Uint8Array`
  - `readonly permMod12: Uint8Array`
  - `constructor(seed: number)`
  - `noise(xin: number, yin: number, zin: number): number`
- `function fbm(n: SimplexNoise3D, x: number, y: number, z: number, octaves: number, lacunarity = 2, gain = 0.5): number`
- `function ridged(n: SimplexNoise3D, x: number, y: number, z: number, octaves: number, lacunarity = 2.1, gain = 0.5): number`

### `terrain/tileGeometry.ts`

- `interface TerrainParams { amplitude, frequency, octaves, ocean, oceanLevel, palette, maxDepth, resolution }`
- `interface TerrainSpec { seed, radius, terrain }`
- `interface TileSpec { face, level, u0, v0, resolution, centerX, centerY, centerZ }`
- `interface TileBuffers { positions, normals, colors, boundingRadius }`
- `const FACES: readonly { n: number[]; tu: number[]; tv: number[] }[]`
- `const PALETTES: Record<string, [number, number][]>`
- `function cubeToSphere(x: number, y: number, z: number, out: Vec3Like): Vec3Like`
- `class TerrainField`
  - `readonly seed: number`
  - `readonly radius: number`
  - `readonly amp: number`
  - `readonly oceanH: number`
  - `readonly frequency: number`
  - `readonly octaves: number`
  - `readonly noise: SimplexNoise3D`
  - `constructor(spec: TerrainSpec)`
  - `rawHeight(dx: number, dy: number, dz: number): number`
  - `height(dx: number, dy: number, dz: number): number`
  - `colorInto(rawHeight: number, out: Float32Array, offset: number): void`
- `function assembleTile(field: TerrainField, tile: TileSpec, gpuData: Float32Array | null): TileBuffers`
- `function tileIndices(resolution: number): Uint16Array`

### `ui/FlightControls.ts`

- `interface FlightControlsOptions { container, canvas, onDoubleTap?, onBrake?, hud?, minScale?, maxScale? }`
- `class FlightControls`
  - `readonly input: NavInput`
  - `constructor(options: FlightControlsOptions)`
  - `get throttle(): number`
  - `endFrame(): void`
  - `setHud(text: string): void`
  - `setHudFrom(info: { anchorName?: string | null; altitude: number; relativeSpeed: number; mode: string; gotoProgress?: number; }): void`
  - `dispose(): void`

### `ui/TuningPanel.ts`

- `class TuningPanel`
  - `constructor(container: HTMLElement)`

### `universe/CelestialBody.ts`

- `type BodyType`
- `interface BodyParams { name, type, mass, radius, seed }`
- `abstract class CelestialBody`
  - `readonly uid`
  - `readonly name: string`
  - `readonly type: BodyType`
  - `readonly mass: number`
  - `readonly radius: number`
  - `readonly seed: number`
  - `parent: CelestialBody | null`
  - `readonly children: CelestialBody[]`
  - `orbit: Orbit | null`
  - `readonly position: Vector3d`
  - `readonly velocity: Vector3d`
  - `readonly root: THREE.Group`
  - `constructor(params: BodyParams)`
  - `get gravParameter(): number`
  - `attachTo(parent: CelestialBody, orbit: Orbit): void`
  - `updateHierarchy(simTime: number): void`
  - `abstract buildRenderObject(): void`
  - `update(dt: number, cameraPos: Vector3d): void`
  - `getSurfaceOffset(dir: THREE.Vector3): number`
  - `*traverse(): Generator<CelestialBody>`

### `universe/Planet.ts`

- `interface PlanetParams extends BodyParams { terrain?, gasPalette? }`
- `class Planet extends CelestialBody`
  - `readonly terrain: TerrainParams | null`
  - `readonly gasPalette: 'jovian' | 'neptunian'`
  - `lod: PlanetLOD | null`
  - `constructor(params: PlanetParams)`
  - `buildRenderObject(): void`
  - `override update(_dt: number, cameraPos: Vector3d): void`
  - `override getSurfaceOffset(dir: THREE.Vector3): number`

### `universe/Star.ts`

- `interface StarParams extends BodyParams { temperature, luminosity }`
- `function colorFromTemperature(kelvin: number): THREE.Color`
- `class Star extends CelestialBody`
  - `readonly temperature: number`
  - `readonly luminosity: number`
  - `systemSeed: number | null`
  - `populated`
  - `constructor(params: StarParams)`
  - `buildRenderObject(): void`
  - `override update(_dt: number, cameraPos: Vector3d): void`
  - `override getSurfaceOffset(): number`

### `universe/UniverseManager.ts`

- `class UniverseManager`
  - `constructor(private readonly sceneManager: SceneManager)`
  - `loadCatalog(): void`
  - `generateNeighborhood(radius: number): void`
  - `populateSystem(body: CelestialBody): void`
  - `update(simTime: number, cameraPos: Vector3d): void`
  - `findBody(name: string): CelestialBody | null`

### `universe/procedural.ts`

- `interface ProcStar { mass, radius, luminosity, temperature }`
- `interface ProcPlanetDef { name, type, mass, radius, elements, terrain, gasPalette }`
- `function generateStar(rng: Rng): ProcStar`
- `function generatePlanets(starName: string, star: ProcStar, rng: Rng): ProcPlanetDef[]`
