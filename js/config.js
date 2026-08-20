/**
 * Canonical tunables. VERSION must match VERSION.txt.
 *
 * Distances are compressed more than sizes so the orrery stays readable.
 * True 1:1 AU spacing would hide every planet against the Sun.
 * Time is an independent slider and is not tied to the visual scale.
 */
export const CONFIG = Object.freeze({
  VERSION: "v2026.8.20",
  earthRadiusKm: 6371,
  auKm: 149597870.7,
  sizeScale: 0.85,
  sizePower: 0.5,
  orbitScale: 34,
  orbitPower: 0.32,
  moonPad: 0.55,
  moonSpread: 0.85,
  moonOrbitCap: 4.2,
  defaultDaysPerSecond: 8,
  minDaysPerSecond: 0.25,
  maxDaysPerSecond: 400,
  beltCount: 2400,
  beltInnerAu: 2.2,
  beltOuterAu: 3.3,
  cameraDistance: 175,
  cameraElevation: 0.48,
  cameraAzimuth: 0.55,
  minDistance: 2.4,
  maxDistance: 320,
  // Pointer travel below this is a tap/click, not an orbit gesture.
  tapMovePx: 12,
  focusLerp: 6,
});
