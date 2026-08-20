import { CONFIG } from "./config.js";

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/**
 * Published NASA / JPL values used by v1.
 * Distances: AU for heliocentric bodies, km for moons.
 * Periods: Earth days. Rotation: hours (negative = retrograde).
 * Tilts and inclinations: degrees. Epoch angles are J2000 approximations.
 */
export const BODIES = Object.freeze([
  {
    id: "sun",
    name: "Sun",
    kind: "star",
    parent: null,
    radiusKm: 695700,
    orbitAu: 0,
    orbitKm: 0,
    eccentricity: 0,
    inclinationDeg: 0,
    nodeDeg: 0,
    periDeg: 0,
    meanAnomalyDeg: 0,
    orbitDays: 0,
    rotationHours: 609.12,
    tiltDeg: 7.25,
    texture: "assets/textures/sun.jpg",
    color: "#ffd27a",
  },
  {
    id: "mercury",
    name: "Mercury",
    kind: "planet",
    parent: "sun",
    radiusKm: 2439.7,
    orbitAu: 0.387098,
    eccentricity: 0.20563,
    inclinationDeg: 7.005,
    nodeDeg: 48.331,
    periDeg: 29.124,
    meanAnomalyDeg: 174.796,
    orbitDays: 87.969,
    rotationHours: 1407.6,
    tiltDeg: 0.034,
    texture: "assets/textures/mercury.jpg",
    color: "#b7b0a6",
  },
  {
    id: "venus",
    name: "Venus",
    kind: "planet",
    parent: "sun",
    radiusKm: 6051.8,
    orbitAu: 0.723332,
    eccentricity: 0.006772,
    inclinationDeg: 3.39471,
    nodeDeg: 76.68,
    periDeg: 54.884,
    meanAnomalyDeg: 50.115,
    orbitDays: 224.701,
    rotationHours: -5832.6,
    tiltDeg: 177.36,
    texture: "assets/textures/venus.jpg",
    color: "#e3c48a",
  },
  {
    id: "earth",
    name: "Earth",
    kind: "planet",
    parent: "sun",
    radiusKm: 6371,
    orbitAu: 1,
    eccentricity: 0.0167086,
    inclinationDeg: 0.00005,
    nodeDeg: -11.261,
    periDeg: 114.208,
    meanAnomalyDeg: 357.517,
    orbitDays: 365.256,
    rotationHours: 23.9345,
    tiltDeg: 23.44,
    texture: "assets/textures/earth.jpg",
    color: "#6ea8d6",
  },
  {
    id: "moon",
    name: "Moon",
    kind: "moon",
    parent: "earth",
    radiusKm: 1737.4,
    orbitKm: 384400,
    eccentricity: 0.0549,
    inclinationDeg: 5.145,
    nodeDeg: 125.08,
    periDeg: 318.15,
    meanAnomalyDeg: 134.96,
    orbitDays: 27.3217,
    rotationHours: 655.728,
    tiltDeg: 6.68,
    texture: "assets/textures/moon.jpg",
    color: "#c5c2bb",
  },
  {
    id: "mars",
    name: "Mars",
    kind: "planet",
    parent: "sun",
    radiusKm: 3389.5,
    orbitAu: 1.523679,
    eccentricity: 0.0934,
    inclinationDeg: 1.85,
    nodeDeg: 49.558,
    periDeg: 286.502,
    meanAnomalyDeg: 19.373,
    orbitDays: 686.98,
    rotationHours: 24.6229,
    tiltDeg: 25.19,
    texture: "assets/textures/mars.jpg",
    color: "#d07a55",
  },
  {
    id: "ceres",
    name: "Ceres",
    kind: "dwarf",
    parent: "sun",
    radiusKm: 473,
    orbitAu: 2.769165,
    eccentricity: 0.0758,
    inclinationDeg: 10.59,
    nodeDeg: 80.31,
    periDeg: 73.47,
    meanAnomalyDeg: 95.99,
    orbitDays: 1681.63,
    rotationHours: 9.074,
    tiltDeg: 4,
    texture: "assets/textures/ceres.jpg",
    color: "#9b958c",
  },
  {
    id: "jupiter",
    name: "Jupiter",
    kind: "planet",
    parent: "sun",
    radiusKm: 69911,
    orbitAu: 5.203363,
    eccentricity: 0.0489,
    inclinationDeg: 1.303,
    nodeDeg: 100.464,
    periDeg: 273.867,
    meanAnomalyDeg: 20.02,
    orbitDays: 4332.589,
    rotationHours: 9.925,
    tiltDeg: 3.13,
    texture: "assets/textures/jupiter.jpg",
    color: "#d4b38a",
  },
  {
    id: "io",
    name: "Io",
    kind: "moon",
    parent: "jupiter",
    radiusKm: 1821.6,
    orbitKm: 421800,
    eccentricity: 0.0041,
    inclinationDeg: 0.036,
    nodeDeg: 43.98,
    periDeg: 84.13,
    meanAnomalyDeg: 342.021,
    orbitDays: 1.769,
    rotationHours: 42.456,
    tiltDeg: 0,
    texture: "assets/textures/io.jpg",
    color: "#e6d36a",
  },
  {
    id: "europa",
    name: "Europa",
    kind: "moon",
    parent: "jupiter",
    radiusKm: 1560.8,
    orbitKm: 671100,
    eccentricity: 0.009,
    inclinationDeg: 0.47,
    nodeDeg: 219.11,
    periDeg: 88.97,
    meanAnomalyDeg: 171.016,
    orbitDays: 3.551,
    rotationHours: 85.224,
    tiltDeg: 0.1,
    texture: "assets/textures/europa.jpg",
    color: "#c9b99a",
  },
  {
    id: "ganymede",
    name: "Ganymede",
    kind: "moon",
    parent: "jupiter",
    radiusKm: 2634.1,
    orbitKm: 1070400,
    eccentricity: 0.0013,
    inclinationDeg: 0.177,
    nodeDeg: 63.55,
    periDeg: 192.42,
    meanAnomalyDeg: 317.54,
    orbitDays: 7.155,
    rotationHours: 171.709,
    tiltDeg: 0.33,
    texture: "assets/textures/ganymede.jpg",
    color: "#b09a7c",
  },
  {
    id: "callisto",
    name: "Callisto",
    kind: "moon",
    parent: "jupiter",
    radiusKm: 2410.3,
    orbitKm: 1882700,
    eccentricity: 0.0074,
    inclinationDeg: 0.192,
    nodeDeg: 298.85,
    periDeg: 52.64,
    meanAnomalyDeg: 263.747,
    orbitDays: 16.689,
    rotationHours: 400.536,
    tiltDeg: 0,
    texture: "assets/textures/callisto.jpg",
    color: "#7d6d5d",
  },
  {
    id: "saturn",
    name: "Saturn",
    kind: "planet",
    parent: "sun",
    radiusKm: 58232,
    orbitAu: 9.53707,
    eccentricity: 0.0542,
    inclinationDeg: 2.485,
    nodeDeg: 113.665,
    periDeg: 339.391,
    meanAnomalyDeg: 317.02,
    orbitDays: 10759.22,
    rotationHours: 10.656,
    tiltDeg: 26.73,
    texture: "assets/textures/saturn.jpg",
    ring: "assets/textures/saturn-ring.png",
    ringInner: 1.11,
    ringOuter: 2.27,
    color: "#e6d3a1",
  },
  {
    id: "titan",
    name: "Titan",
    kind: "moon",
    parent: "saturn",
    radiusKm: 2574.7,
    orbitKm: 1221870,
    eccentricity: 0.0288,
    inclinationDeg: 0.349,
    nodeDeg: 28.06,
    periDeg: 180.53,
    meanAnomalyDeg: 186.586,
    orbitDays: 15.945,
    rotationHours: 382.68,
    tiltDeg: 0,
    texture: "assets/textures/titan.jpg",
    color: "#d2a15a",
  },
  {
    id: "uranus",
    name: "Uranus",
    kind: "planet",
    parent: "sun",
    radiusKm: 25362,
    orbitAu: 19.191264,
    eccentricity: 0.0472,
    inclinationDeg: 0.773,
    nodeDeg: 74.006,
    periDeg: 96.999,
    meanAnomalyDeg: 142.239,
    orbitDays: 30685.4,
    rotationHours: -17.24,
    tiltDeg: 97.77,
    texture: "assets/textures/uranus.jpg",
    color: "#9ad6d8",
  },
  {
    id: "neptune",
    name: "Neptune",
    kind: "planet",
    parent: "sun",
    radiusKm: 24622,
    orbitAu: 30.068963,
    eccentricity: 0.0086,
    inclinationDeg: 1.77,
    nodeDeg: 131.784,
    periDeg: 273.219,
    meanAnomalyDeg: 256.228,
    orbitDays: 60189,
    rotationHours: 16.11,
    tiltDeg: 28.32,
    texture: "assets/textures/neptune.jpg",
    color: "#4d74d6",
  },
  {
    id: "triton",
    name: "Triton",
    kind: "moon",
    parent: "neptune",
    radiusKm: 1353.4,
    orbitKm: 354759,
    eccentricity: 0.000016,
    inclinationDeg: 156.865,
    nodeDeg: 167.71,
    periDeg: 0,
    meanAnomalyDeg: 0,
    orbitDays: -5.877,
    rotationHours: -141.048,
    tiltDeg: 0,
    texture: "assets/textures/triton.jpg",
    color: "#c8c2b6",
  },
  {
    id: "pluto",
    name: "Pluto",
    kind: "dwarf",
    parent: "sun",
    radiusKm: 1188.3,
    orbitAu: 39.482,
    eccentricity: 0.2488,
    inclinationDeg: 17.16,
    nodeDeg: 110.299,
    periDeg: 113.834,
    meanAnomalyDeg: 14.796,
    orbitDays: 90560,
    rotationHours: -153.29,
    tiltDeg: 122.53,
    texture: "assets/textures/pluto.jpg",
    color: "#c9b09a",
  },
]);

export function findBody(id) {
  return BODIES.find((body) => body.id === id) ?? null;
}

export function visualRadius(radiusKm) {
  return CONFIG.sizeScale * (radiusKm / CONFIG.earthRadiusKm) ** CONFIG.sizePower;
}

export function visualOrbit(orbitAu) {
  if (orbitAu <= 0) return 0;
  return CONFIG.orbitScale * orbitAu ** CONFIG.orbitPower;
}

export function visualMoonDistance(body, parent) {
  const parentVisual = visualRadius(parent.radiusKm);
  const moonVisual = visualRadius(body.radiusKm);
  const room = parentVisual + moonVisual + CONFIG.moonPad;
  const radii = body.orbitKm / parent.radiusKm;
  const spread = room + CONFIG.moonSpread * Math.log2(1 + radii);
  return Math.min(spread, parentVisual * CONFIG.moonOrbitCap + moonVisual);
}

export function visualSemiMajor(body, parent) {
  if (!parent || body.id === "sun") return 0;
  if (body.kind === "moon") return visualMoonDistance(body, parent);
  return visualOrbit(body.orbitAu);
}

export function wrapAngle(radians) {
  return ((radians % TAU) + TAU) % TAU;
}

/** Newton-Raphson for M = E - e sin E. Units: radians. */
export function solveKepler(meanAnomaly, eccentricity) {
  const M = wrapAngle(meanAnomaly);
  let E = eccentricity < 0.8 ? M : Math.PI;
  for (let step = 0; step < 14; step += 1) {
    const delta = E - eccentricity * Math.sin(E) - M;
    E -= delta / (1 - eccentricity * Math.cos(E));
    if (Math.abs(delta) < 1e-9) break;
  }
  return E;
}

/**
 * Keplerian position in a Y-up ecliptic frame (Y is north).
 * Returns scene units; parent offset is applied by the caller.
 */
export function keplerOffset(body, parent, days) {
  const spin = body.rotationHours
    ? (days / (body.rotationHours / 24)) * TAU
    : 0;
  const a = visualSemiMajor(body, parent);
  if (a <= 0 || !body.orbitDays) return { x: 0, y: 0, z: 0, spin };

  const n = (TAU / body.orbitDays) * days;
  const M = wrapAngle(body.meanAnomalyDeg * DEG + n);
  const e = body.eccentricity;
  const E = solveKepler(M, e);
  const trueAnomaly = 2 * Math.atan2(
    Math.sqrt(1 + e) * Math.sin(E / 2),
    Math.sqrt(1 - e) * Math.cos(E / 2),
  );
  const r = a * (1 - e * Math.cos(E));
  const i = body.inclinationDeg * DEG;
  const node = body.nodeDeg * DEG;
  const peri = body.periDeg * DEG;
  const arg = peri + trueAnomaly;
  const cosN = Math.cos(node);
  const sinN = Math.sin(node);
  const cosA = Math.cos(arg);
  const sinA = Math.sin(arg);
  const cosI = Math.cos(i);
  const sinI = Math.sin(i);
  const x = r * (cosN * cosA - sinN * sinA * cosI);
  const astroY = r * (sinN * cosA + cosN * sinA * cosI);
  const astroZ = r * (sinA * sinI);
  return { x, y: astroZ, z: -astroY, spin };
}

export function describeBody(body) {
  const orbit = Math.abs(body.orbitDays);
  const rotationDays = Math.abs(body.rotationHours) / 24;
  return {
    id: body.id,
    name: body.name,
    kind: body.kind,
    orbitLabel: orbit ? `${formatNumber(orbit)} day orbit` : "Center of the system",
    spinLabel: `${formatNumber(rotationDays)} day spin`,
    tiltLabel: `${formatNumber(body.tiltDeg)}° tilt`,
    retrograde: body.orbitDays < 0 || body.rotationHours < 0,
  };
}

function formatNumber(value) {
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}
