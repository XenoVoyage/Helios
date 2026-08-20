/**
 * Canonical tunables. VERSION must match VERSION.txt.
 *
 * NASA / JPL catalog numbers stay in js/bodies.js. Only this visual scale
 * and the time slider may diverge from 1:1. Time is not tied to scale.
 *
 * visualScale is the one spacing knob: it multiplies the compressed orbit
 * curve (orbitScale * AU^orbitPower). Raise it to spread the system; do not
 * invent fake AU values. sizeScale / sizePower size the spheres the same way.
 * Moons share that size curve (moonSizeScale 1).
 */
export const CONFIG = Object.freeze({
  VERSION: "v2026.8.20e",
  earthRadiusKm: 6371,
  auKm: 149597870.7,
  visualScale: 2.6,
  sizeScale: 0.4,
  sizePower: 0.82,
  orbitScale: 40,
  orbitPower: 0.58,
  moonPad: 0.4,
  moonSpread: 0.35,
  // Extra visual space between sibling moon paths after radii are reserved.
  moonSiblingGap: 1.5,
  moonOrbitCap: 6,
  // Moons sit just outside rings; do not push them to 1.5× the ring radius.
  moonRingGap: 0.25,
  // 1 = no extra moon shrink; Phobos/Deimos stay tiny from sizePower alone.
  moonSizeScale: 1,
  defaultDaysPerSecond: 1 / 24,
  minDaysPerSecond: 1 / 24,
  maxDaysPerSecond: 400,
  // Debris fields: sparse point clouds, not rock catalogs. One owner for both.
  beltCount: 2400,
  beltInnerAu: 2.2,
  beltOuterAu: 3.3,
  kuiperCount: 880,
  kuiperInnerAu: 30.2,
  kuiperOuterAu: 50,
  cameraDistance: 1100,
  cameraElevation: 0.5,
  cameraAzimuth: 0.55,
  minDistance: 2.4,
  maxDistance: 1650,
  // Celestial sphere sits around the camera; far plane must clear it.
  skyRadius: 2000,
  cameraFar: 4200,
  // Pointer travel below this is a tap/click, not an orbit gesture.
  tapMovePx: 12,
  focusLerp: 6,
});

/** Honest clock-rate label. Hours below 1 day/sec; days, months, years above. */
export function formatDaysPerSecond(daysPerSecond) {
  if (daysPerSecond >= 365) return `${(daysPerSecond / 365.25).toFixed(1)} yr`;
  if (daysPerSecond >= 30) return `${(daysPerSecond / 30.437).toFixed(1)} mo`;
  if (daysPerSecond >= 1) return `${daysPerSecond.toFixed(daysPerSecond >= 10 ? 0 : 1)} d`;
  return `${(daysPerSecond * 24).toFixed(0)} h`;
}
