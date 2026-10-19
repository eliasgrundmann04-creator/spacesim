import type { FeelConfig } from '../src/nav/feel';
import {
  DEFAULT_FEEL,
  FEEL,
  FEEL_RANGES,
  feelToSearch,
  isLogScale,
  mergeFeelIntoSearch,
  parseFeel,
  setFeel,
  sliderToValue,
  valueToSlider,
} from '../src/nav/feel';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    console.error(`  FAIL: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  } else {
    console.log(`  ok   ${msg}`);
  }
}

console.log('\n--- Offline-Test: Tuning-Panel & Feel Functions ---');

// 1. Serialisierung
console.log('\n1. Serialisierung: feelToSearch');
{
  Object.assign(FEEL, DEFAULT_FEEL);
  assert(feelToSearch(FEEL) === '', 'Standardbelegung liefert leeres Ergebnis');

  FEEL.spinTau = 1.234;
  FEEL.glideMax = 45.67;
  const searchStr = feelToSearch(FEEL);
  assert(
    searchStr === 'feel=spinTau:1.234,glideMax:45.67' ||
      searchStr === 'feel=glideMax:45.67,spinTau:1.234',
    `Abweichungen korrekt in der Reihenfolge von DEFAULT_FEEL formatiert (${searchStr})`,
  );
}

// 2. Roundtrip
console.log('\n2. Roundtrip: 200 zufällige Belegungen innerhalb von FEEL_RANGES');
{
  let passedCount = 0;
  // Pseudozufall mit festem Seed
  let seed = 12345;
  function lcg(): number {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  }

  const keys = Object.keys(DEFAULT_FEEL) as (keyof FeelConfig)[];

  for (let i = 0; i < 200; i++) {
    const testCfg: FeelConfig = { ...DEFAULT_FEEL };
    for (const k of keys) {
      const range = FEEL_RANGES[k];
      const r = lcg();
      if (isLogScale(k)) {
        testCfg[k] = Math.exp(Math.log(range.min) + r * (Math.log(range.max) - Math.log(range.min)));
      } else {
        testCfg[k] = range.min + r * (range.max - range.min);
      }
    }

    const searchParam = feelToSearch(testCfg);
    parseFeel('?' + searchParam);

    let match = true;
    for (const k of keys) {
      const expected = Number(testCfg[k].toPrecision(4));
      const actual = FEEL[k];
      if (Math.abs(expected - actual) / Math.max(Math.abs(expected), 1e-9) > 1e-3) {
        match = false;
        break;
      }
    }
    if (match) passedCount++;
  }

  assert(passedCount === 200, '200 / 200 Belegungen auf 4 signifikante Stellen exakt gleich');
}

// 3. Fremde Parameter bleiben
console.log('\n3. Fremde Parameter bleiben');
{
  Object.assign(FEEL, DEFAULT_FEEL);
  FEEL.spinTau = 1;
  const merged1 = mergeFeelIntoSearch('?terrain=gpu&tune&feel=spinTau:2', FEEL);
  assert(
    merged1 === '?terrain=gpu&tune&feel=spinTau:1',
    `Fremde Parameter bleiben, feel wird ersetzt (${merged1})`,
  );

  Object.assign(FEEL, DEFAULT_FEEL);
  const merged2 = mergeFeelIntoSearch('?terrain=gpu&tune&feel=spinTau:1', FEEL);
  assert(
    merged2 === '?terrain=gpu&tune',
    `Standardbelegung entfernt feel= aus search (${merged2})`,
  );
}

// 4. Setzen mit Klemmen
console.log('\n4. Setzen mit Klemmen');
{
  Object.assign(FEEL, DEFAULT_FEEL);
  setFeel('spinTau', 99);
  assert(FEEL.spinTau === FEEL_RANGES.spinTau.max, 'setFeel(spinTau, 99) klemmt auf Obergrenze');

  setFeel('spinTau', -5);
  assert(FEEL.spinTau === FEEL_RANGES.spinTau.min, 'setFeel(spinTau, -5) klemmt auf Untergrenze');

  const feelBefore = { ...FEEL };
  const resUnknown = setFeel('unbekannterSchluessel', 10);
  assert(!resUnknown && FEEL.spinTau === feelBefore.spinTau, 'Unbekannte Schlüssel ändern nichts');

  const resNan = setFeel('spinTau', NaN);
  assert(!resNan && FEEL.spinTau === feelBefore.spinTau, 'Nicht-endliche Werte ändern nichts');
}

// 5. Reglerabbildung
console.log('\n5. Reglerabbildung: sliderToValue / valueToSlider');
{
  const keys = Object.keys(DEFAULT_FEEL) as (keyof FeelConfig)[];
  let allMappedCorrectly = true;
  let logProportionalCorrect = true;

  for (const k of keys) {
    const range = FEEL_RANGES[k];
    for (let step = 0; step < 50; step++) {
      const v = range.min + (step / 49) * (range.max - range.min);
      const slider = valueToSlider(v, k);
      const mappedVal = sliderToValue(slider, k);
      const relErr = Math.abs(v - mappedVal) / Math.max(Math.abs(v), 1e-9);
      if (relErr >= 1e-9) {
        allMappedCorrectly = false;
      }
    }

    if (isLogScale(k)) {
      const v1 = range.min * 1.5;
      const v2 = range.min * 4.5;
      const v3 = range.min * 2.0;
      const v4 = range.min * 6.0;

      const dt12 = valueToSlider(v2, k) - valueToSlider(v1, k);
      const dt34 = valueToSlider(v4, k) - valueToSlider(v3, k);
      if (Math.abs(dt12 - dt34) > 1e-9) {
        logProportionalCorrect = false;
      }
    }
  }

  assert(allMappedCorrectly, 'sliderToValue(valueToSlider(v, key), key) == v (relativ < 1e-9)');
  assert(
    logProportionalCorrect,
    'Logarithmische Skala: Reglerweg proportional zum ln-Verhältnis',
  );
}

console.log('\nAlle Offline-Tests für feel.ts erfolgreich bestanden.\n');
