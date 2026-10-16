// Alle internen Einheiten: Meter, Kilogramm, Sekunden.
// Weltkoordinaten: Ekliptik J2000, Z = Norden (camera.up = +Z).

export const G = 6.6743e-11;                    // m^3 kg^-1 s^-2
export const AU = 1.495978707e11;               // m
export const LY = 9.4607304725808e15;           // m
export const PC = 3.0856775814913673e16;        // m

export const SOLAR_MASS = 1.98892e30;           // kg
export const SOLAR_RADIUS = 6.957e8;            // m
export const SOLAR_LUMINOSITY = 3.828e26;       // W
export const SOLAR_TEMPERATURE = 5772;          // K

export const EARTH_MASS = 5.9722e24;
export const EARTH_RADIUS = 6.371e6;
export const JUPITER_MASS = 1.89813e27;
export const JUPITER_RADIUS = 6.9911e7;

export const DAY = 86400;
export const YEAR = 365.25 * DAY;
export const DEG = Math.PI / 180;

/** Unix-Millisekunden der Epoche J2000.0 (2000-01-01 12:00, TT≈UTC hier ausreichend). */
export const J2000_UNIX_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
