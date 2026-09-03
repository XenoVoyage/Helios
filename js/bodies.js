import { CONFIG } from "./config.js";

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/** NAIF pck00011 poles evaluated at J2000, including periodic terms. */
const BODY_POLES = Object.freeze({
  sun: Object.freeze({ raDeg: 286.13, decDeg: 63.87 }),
  mercury: Object.freeze({ raDeg: 281.0103, decDeg: 61.4155 }),
  venus: Object.freeze({ raDeg: 272.76, decDeg: 67.16 }),
  earth: Object.freeze({ raDeg: 0, decDeg: 90 }),
  moon: Object.freeze({ raDeg: 266.85773344495135, decDeg: 65.64110274784535 }),
  mars: Object.freeze({ raDeg: 317.6808544073, decDeg: 52.8864392751 }),
  ceres: Object.freeze({ raDeg: 291.418, decDeg: 66.764 }),
  jupiter: Object.freeze({ raDeg: 268.0572040427, decDeg: 64.4958099534 }),
  saturn: Object.freeze({ raDeg: 40.589, decDeg: 83.537 }),
  uranus: Object.freeze({ raDeg: 257.311, decDeg: -15.175 }),
  neptune: Object.freeze({ raDeg: 299.3337389588, decDeg: 42.9503590218 }),
  triton: Object.freeze({ raDeg: 298.4509834088894, decDeg: 20.302361260483217 }),
  pluto: Object.freeze({ raDeg: 132.993, decDeg: -6.163 }),
});

const PARENT_POLES = Object.freeze({
  mars: BODY_POLES.mars,
  jupiter: BODY_POLES.jupiter,
  saturn: BODY_POLES.saturn,
  neptune: BODY_POLES.neptune,
});

function laplaceFrame(parent, poleRaDeg, poleDecDeg) {
  return Object.freeze({
    kind: "laplace",
    poleRaDeg,
    poleDecDeg,
    parentPole: PARENT_POLES[parent],
  });
}

const ECLIPTIC_FRAME = Object.freeze({ kind: "ecliptic" });

/** Null W means the asset longitude is unverified; app.js preserves its roll. */
function orientationJ2000(bodyId, spinDirection, primeMeridianDeg = null) {
  const pole = BODY_POLES[bodyId];
  return Object.freeze({
    poleRaDeg: pole.raDeg,
    poleDecDeg: pole.decDeg,
    primeMeridianDeg,
    spinDirection,
  });
}

/**
 * Published NASA / JPL values used by v1.
 * Distances: AU for heliocentric bodies, km for moons.
 * Periods: Earth days. Rotation: hours (negative = retrograde).
 * Tilts and inclinations: degrees. Epoch angles are J2000 approximations.
 *
 * Physical numbers follow the NASA planetary fact sheet where it and JPL
 * agree, and JPL SSD satellite phys_par (IAU WGCCRE 2015) for moons.
 * Heliocentric Kepler angles stay J2000 approximations, not Horizons,
 * except Ceres, which uses one geometric Horizons J2000 snapshot, and
 * Neptune, whose six orbital elements come from one JPL Approximate
 * Positions Table 1 J2000 snapshot at T=0.
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
    orientationJ2000: orientationJ2000("sun", 1),
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
    orientationJ2000: orientationJ2000("mercury", 1),
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
    orientationJ2000: orientationJ2000("venus", -1),
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
    // NAIF low-accuracy IAU_EARTH pole and W at J2000 TDB.
    orientationJ2000: orientationJ2000("earth", 1, 190.147),
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
    eccentricity: 0.0554,
    inclinationDeg: 5.16,
    nodeDeg: 125.08,
    periDeg: 318.15,
    meanAnomalyDeg: 135.27,
    orbitDays: 27.322,
    orbitFrame: ECLIPTIC_FRAME,
    rotationHours: 655.728,
    tiltDeg: 6.68,
    synchronous: true,
    // NAIF IAU_MOON (Mean Earth/Polar Axis) periodic model at J2000 TDB.
    orientationJ2000: orientationJ2000("moon", 1, 41.1952639807452),
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
    orientationJ2000: orientationJ2000("mars", 1),
    texture: "assets/textures/mars.jpg",
    color: "#d07a55",
  },
  {
    id: "phobos",
    name: "Phobos",
    kind: "moon",
    parent: "mars",
    // JPL SSD phys_par mean radius; MAR099 mean elements at J2000.
    radiusKm: 11.08,
    orbitKm: 9375,
    eccentricity: 0.015,
    inclinationDeg: 1.1,
    nodeDeg: 169.2,
    periDeg: 216.3,
    meanAnomalyDeg: 189.7,
    orbitDays: 0.3187,
    orbitFrame: laplaceFrame("mars", 317.7, 52.9),
    rotationHours: 7.6538,
    tiltDeg: 0,
    synchronous: true,
    texture: "assets/textures/phobos.jpg",
    color: "#8a7a6c",
  },
  {
    id: "deimos",
    name: "Deimos",
    kind: "moon",
    parent: "mars",
    radiusKm: 6.2,
    orbitKm: 23457,
    eccentricity: 0,
    inclinationDeg: 1.8,
    nodeDeg: 54.3,
    periDeg: 0,
    meanAnomalyDeg: 205,
    orbitDays: 1.2625,
    orbitFrame: laplaceFrame("mars", 316.6, 53.5),
    rotationHours: 30.2986,
    tiltDeg: 0.9,
    synchronous: true,
    texture: "assets/textures/deimos.jpg",
    color: "#9a8d7c",
  },
  {
    id: "ceres",
    name: "Ceres",
    kind: "dwarf",
    parent: "sun",
    // JPL Horizons JPL#48/DE441 geometric osculating elements at
    // JD 2451545.0 TDB, Sun center, ecliptic J2000, AU-days. Mean
    // radius is JPL SSD phys_par 469.7 km, not the inherited 473 km.
    radiusKm: 469.7,
    orbitAu: 2.766496019994375,
    eccentricity: 0.07837562647163041,
    inclinationDeg: 10.58336045805628,
    nodeDeg: 80.49435747295276,
    periDeg: 73.92286274285223,
    meanAnomalyDeg: 6.176654513180486,
    orbitDays: 1680.712776442072,
    rotationHours: 9.074,
    tiltDeg: 4,
    orientationJ2000: orientationJ2000("ceres", 1),
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
    orientationJ2000: orientationJ2000("jupiter", 1),
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
    eccentricity: 0.004,
    inclinationDeg: 0,
    nodeDeg: 0,
    periDeg: 49.1,
    meanAnomalyDeg: 330.9,
    orbitDays: 1.762732,
    orbitFrame: laplaceFrame("jupiter", 268.1, 64.5),
    rotationHours: 42.456,
    tiltDeg: 0,
    synchronous: true,
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
    inclinationDeg: 0.5,
    nodeDeg: 184,
    periDeg: 45,
    meanAnomalyDeg: 345.4,
    orbitDays: 3.525463,
    orbitFrame: laplaceFrame("jupiter", 268.1, 64.5),
    rotationHours: 85.224,
    tiltDeg: 0.1,
    synchronous: true,
    texture: "assets/textures/europa.jpg",
    color: "#c9b99a",
  },
  {
    id: "ganymede",
    name: "Ganymede",
    kind: "moon",
    parent: "jupiter",
    radiusKm: 2631.2,
    orbitKm: 1070400,
    eccentricity: 0.001,
    inclinationDeg: 0.2,
    nodeDeg: 58.5,
    periDeg: 198.3,
    meanAnomalyDeg: 324.8,
    orbitDays: 7.155588,
    orbitFrame: laplaceFrame("jupiter", 268.2, 64.6),
    rotationHours: 171.709,
    tiltDeg: 0.33,
    synchronous: true,
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
    eccentricity: 0.007,
    inclinationDeg: 0.3,
    nodeDeg: 309.1,
    periDeg: 43.8,
    meanAnomalyDeg: 87.4,
    orbitDays: 16.69044,
    orbitFrame: laplaceFrame("jupiter", 268.7, 64.8),
    rotationHours: 400.536,
    tiltDeg: 0,
    synchronous: true,
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
    orientationJ2000: orientationJ2000("saturn", 1),
    texture: "assets/textures/saturn.jpg",
    ring: "assets/textures/saturn-ring.png",
    // NASA / JPL main-ring edges (D-ring inner, A-ring outer), km from Saturn center.
    ringInnerKm: 66900,
    ringOuterKm: 136775,
    color: "#e6d3a1",
  },
  {
    id: "titan",
    name: "Titan",
    kind: "moon",
    parent: "saturn",
    radiusKm: 2574.7,
    orbitKm: 1221900,
    eccentricity: 0.029,
    inclinationDeg: 0.3,
    nodeDeg: 78.6,
    periDeg: 78.3,
    meanAnomalyDeg: 11.7,
    orbitDays: 15.945448,
    orbitFrame: laplaceFrame("saturn", 36.4, 84.0),
    rotationHours: 382.68,
    tiltDeg: 0,
    synchronous: true,
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
    orientationJ2000: orientationJ2000("uranus", -1),
    texture: "assets/textures/uranus.jpg",
    color: "#9ad6d8",
  },
  {
    id: "neptune",
    name: "Neptune",
    kind: "planet",
    parent: "sun",
    // JPL Approximate Positions Table 1 at T=0 (JD 2451545.0), mean
    // ecliptic and equinox of J2000, valid 1800 AD – 2050 AD. ω and M
    // are derived from L and the longitude of perihelion. Period,
    // radius, spin, pole, and texture stay on their existing owners.
    radiusKm: 24622,
    orbitAu: 30.06992276,
    eccentricity: 0.00859048,
    inclinationDeg: 1.77004347,
    nodeDeg: 131.78422574,
    periDeg: 273.18053653,
    meanAnomalyDeg: 259.91520804,
    orbitDays: 60189,
    rotationHours: 16.11,
    tiltDeg: 28.32,
    orientationJ2000: orientationJ2000("neptune", 1),
    texture: "assets/textures/neptune.jpg",
    color: "#4d74d6",
  },
  {
    id: "triton",
    name: "Triton",
    kind: "moon",
    parent: "neptune",
    radiusKm: 1353.4,
    orbitKm: 354800,
    eccentricity: 0,
    inclinationDeg: 157.3,
    nodeDeg: 178.1,
    periDeg: 0,
    // JPL NEP097 mean elements at J2000.
    meanAnomalyDeg: 63,
    orbitDays: 5.876994,
    orbitFrame: laplaceFrame("neptune", 299.8, 43.1),
    rotationHours: -141.048,
    tiltDeg: 0.54,
    synchronous: true,
    // NAIF IAU_TRITON periodic model evaluated at J2000 TDB.
    orientationJ2000: orientationJ2000("triton", -1, 297.01780353391297),
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
    // PCK pole against this fixed J2000 orbit: 119.6° (NASA: about 119.5°).
    tiltDeg: 119.6,
    orientationJ2000: orientationJ2000("pluto", 1),
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

/**
 * Displayed globe size. Moons share the size curve (moonSizeScale 1) with a
 * visual floor: the curve maps Phobos / Deimos to a sub-pixel ~0.002 units,
 * so without the floor they vanish at every allowed camera distance while
 * their labels stay up. Published radiusKm is untouched.
 */
export function visualBodyRadius(body) {
  if (body.kind !== "moon") return visualRadius(body.radiusKm);
  return Math.max(visualRadius(body.radiusKm) * CONFIG.moonSizeScale, CONFIG.moonMinRadius);
}

export function visualOrbit(orbitAu) {
  if (orbitAu <= 0) return 0;
  return CONFIG.visualScale * CONFIG.orbitScale * orbitAu ** CONFIG.orbitPower;
}

/** Ring km mapped linearly onto the displayed globe, not through sizePower. */
export function visualRingRadius(parent, ringKm) {
  if (!parent || !(ringKm > 0)) return 0;
  return visualRadius(parent.radiusKm) * (ringKm / parent.radiusKm);
}

/** Radial U for the 1D saturn-ring strip. 0 at the inner edge, 1 at the outer. */
export function ringTextureU(radius, inner, outer) {
  const span = outer - inner;
  if (!(span > 0)) return 0;
  return (radius - inner) / span;
}

/** Moons of one parent, inner orbit first. Physical order is orbitKm. */
export function moonsOf(parentId) {
  return BODIES
    .filter((body) => body.kind === "moon" && body.parent === parentId)
    .slice()
    .sort((a, b) => a.orbitKm - b.orbitKm);
}

/** Visual radius the moon's path must stay outside: globe, rings, and the moon itself. */
export function moonClearance(body, parent) {
  const parentVisual = visualBodyRadius(parent);
  const moonVisual = visualBodyRadius(body);
  const ringOuter = visualRingRadius(parent, parent.ringOuterKm);
  const ringClearance = ringOuter > 0 ? ringOuter + moonVisual + CONFIG.moonRingGap : 0;
  return Math.max(parentVisual + moonVisual + CONFIG.moonPad, ringClearance);
}

function mappedMoonDistance(body, parent) {
  const parentVisual = visualBodyRadius(parent);
  const moonVisual = visualBodyRadius(body);
  const ringOuter = visualRingRadius(parent, parent.ringOuterKm);
  const clearance = moonClearance(body, parent);
  const radii = body.orbitKm / parent.radiusKm;
  const spread = clearance + CONFIG.moonSpread * Math.log2(1 + radii);
  const cap = Math.max(parentVisual, ringOuter) * CONFIG.moonOrbitCap + moonVisual;
  return Math.min(Math.max(spread, clearance), cap);
}

/**
 * Visual moon distance keeps published periods and orbital order.
 * The log map + cap is only a first guess; parent/ring clearance and a
 * readable sibling gap win when the cap would stack moons.
 */
export function visualMoonDistance(body, parent) {
  const siblings = moonsOf(parent.id);
  let previousOrbit = 0;
  let previousRadius = 0;
  for (const moon of siblings) {
    const moonVisual = visualBodyRadius(moon);
    const mapped = mappedMoonDistance(moon, parent);
    const siblingFloor = previousOrbit > 0
      ? previousOrbit + previousRadius + moonVisual + CONFIG.moonSiblingGap
      : 0;
    const orbit = Math.max(mapped, moonClearance(moon, parent), siblingFloor);
    if (moon.id === body.id) return orbit;
    previousOrbit = orbit;
    previousRadius = moonVisual;
  }
  return mappedMoonDistance(body, parent);
}

export function visualSemiMajor(body, parent) {
  if (!parent || body.id === "sun") return 0;
  if (body.kind === "moon") return visualMoonDistance(body, parent);
  return visualOrbit(body.orbitAu);
}

export function wrapAngle(radians) {
  return ((radians % TAU) + TAU) % TAU;
}

/**
 * Inclination/obliquity above 90° owns the retrograde direction. Otherwise
 * the period sign owns it. This prevents the same direction being encoded
 * twice while preserving the published catalog fields.
 */
export function renderedPeriod(period, orientationDeg = 0) {
  if (!period) return 0;
  return orientationDeg > 90 ? Math.abs(period) : period;
}

/** Signed spin period after applying the selected pole convention once. */
export function renderedSpinPeriod(body) {
  const direction = body?.orientationJ2000?.spinDirection;
  if (direction) return Math.abs(body.rotationHours) * direction;
  return renderedPeriod(body?.rotationHours ?? 0, body?.tiltDeg ?? 0);
}

/**
 * Display-longitude period used to prevent secular drift for a synchronous
 * moon. This rate match does not register an unverified pole or texture phase.
 */
export function renderedOrbitPeriod(body) {
  if (!body?.orbitDays) return 0;
  if (body.synchronous) {
    return renderedPeriod(Math.abs(body.rotationHours) / 24, body.inclinationDeg);
  }
  return renderedPeriod(body.orbitDays, body.inclinationDeg);
}

/** IAU body axes in equatorial J2000 at prime-meridian angle W = 0. */
export function bodyOrientationBasis(body) {
  const orientation = body?.orientationJ2000;
  if (!orientation) return null;
  const basis = poleBasis({
    raDeg: orientation.poleRaDeg,
    decDeg: orientation.poleDecDeg,
  });
  return {
    xAxis: basis.xAxis,
    yAxis: basis.yAxis,
    zAxis: basis.normal,
    primeMeridianDeg: orientation.primeMeridianDeg,
  };
}

/** Scene-parent choice for a moon's explicitly declared element frame. */
export function moonOrbitAttachment(body) {
  return body?.kind === "moon" && body.orbitFrame?.kind !== "ecliptic"
    ? "parent-equatorial"
    : "parent-ecliptic";
}

function poleBasis(pole) {
  const ra = pole.raDeg * DEG;
  const dec = pole.decDeg * DEG;
  const normal = {
    x: Math.cos(dec) * Math.cos(ra),
    y: Math.cos(dec) * Math.sin(ra),
    z: Math.sin(dec),
  };
  const length = Math.hypot(normal.x, normal.y) || 1;
  const xAxis = { x: -normal.y / length, y: normal.x / length, z: 0 };
  const yAxis = {
    x: normal.y * xAxis.z - normal.z * xAxis.y,
    y: normal.z * xAxis.x - normal.x * xAxis.z,
    z: normal.x * xAxis.y - normal.y * xAxis.x,
  };
  return { xAxis, yAxis, normal };
}

function combineBasis(vector, basis) {
  return {
    x: vector.x * basis.xAxis.x + vector.y * basis.yAxis.x + vector.z * basis.normal.x,
    y: vector.x * basis.xAxis.y + vector.y * basis.yAxis.y + vector.z * basis.normal.y,
    z: vector.x * basis.xAxis.z + vector.y * basis.yAxis.z + vector.z * basis.normal.z,
  };
}

function projectBasis(vector, basis) {
  return {
    x: vector.x * basis.xAxis.x + vector.y * basis.xAxis.y + vector.z * basis.xAxis.z,
    y: vector.x * basis.yAxis.x + vector.y * basis.yAxis.y + vector.z * basis.yAxis.z,
    z: vector.x * basis.normal.x + vector.y * basis.normal.y + vector.z * basis.normal.z,
  };
}

function sourceToRenderFrame(body, vector) {
  const frame = body.orbitFrame;
  if (frame?.kind === "laplace") {
    const icrf = combineBasis(vector, poleBasis({
      raDeg: frame.poleRaDeg,
      decDeg: frame.poleDecDeg,
    }));
    return projectBasis(icrf, poleBasis(frame.parentPole));
  }
  return vector;
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

function orbitalPosition(body, parent, meanAnomaly, apsidalAdvance = 0) {
  const a = visualSemiMajor(body, parent);
  if (a <= 0 || !body.orbitDays) return { x: 0, y: 0, z: 0 };
  const e = body.eccentricity;
  const E = solveKepler(meanAnomaly, e);
  const trueAnomaly = 2 * Math.atan2(
    Math.sqrt(1 + e) * Math.sin(E / 2),
    Math.sqrt(1 - e) * Math.cos(E / 2),
  );
  const r = a * (1 - e * Math.cos(E));
  const i = body.inclinationDeg * DEG;
  const node = body.nodeDeg * DEG;
  const arg = body.periDeg * DEG + trueAnomaly + apsidalAdvance;
  const cosN = Math.cos(node);
  const sinN = Math.sin(node);
  const cosA = Math.cos(arg);
  const sinA = Math.sin(arg);
  const cosI = Math.cos(i);
  const sinI = Math.sin(i);
  const source = sourceToRenderFrame(body, {
    x: r * (cosN * cosA - sinN * sinA * cosI),
    y: r * (sinN * cosA + cosN * sinA * cosI),
    z: r * (sinA * sinI),
  });
  return { x: source.x, y: source.z, z: -source.y };
}

/** Fixed catalog ellipse point for orbit helpers; phase 0 and 1 are identical. */
export function keplerPathOffset(body, parent, phase) {
  if (!body?.orbitDays) return { x: 0, y: 0, z: 0 };
  const direction = Math.sign(renderedPeriod(body.orbitDays, body.inclinationDeg));
  const meanAnomaly = body.meanAnomalyDeg * DEG + direction * TAU * phase;
  return orbitalPosition(body, parent, meanAnomaly);
}

/**
 * Keplerian position in a Y-up ecliptic frame (Y is north).
 * Returns scene units; parent offset is applied by the caller.
 */
export function keplerOffset(body, parent, days) {
  const spinPeriod = renderedSpinPeriod(body);
  const spin = spinPeriod
    ? (days / (spinPeriod / 24)) * TAU
    : 0;
  if (!body.orbitDays) {
    return { x: 0, y: 0, z: 0, spin };
  }

  const anomalyPeriod = renderedPeriod(body.orbitDays, body.inclinationDeg);
  const n = (TAU / anomalyPeriod) * days;
  const M = wrapAngle(body.meanAnomalyDeg * DEG + n);
  const revolutionPeriod = renderedOrbitPeriod(body);
  const displayApsidalAdvance = (TAU / revolutionPeriod - TAU / anomalyPeriod) * days;
  return { ...orbitalPosition(body, parent, M, displayApsidalAdvance), spin };
}

export function describeBody(body) {
  const orbit = Math.abs(body.orbitDays);
  const rotationDays = Math.abs(body.rotationHours) / 24;
  const retrograde = body.orbitDays < 0 || body.rotationHours < 0;
  const radiusLabel = `${formatRadius(body.radiusKm)} km radius`;
  const orbitLabel = orbit ? `${formatNumber(orbit)} day orbit` : "Center of the system";
  const spinLabel = `${formatNumber(rotationDays)} day spin`;
  const tiltLabel = `${formatNumber(body.tiltDeg)}° tilt`;
  const facts = [radiusLabel];
  if (!orbit) {
    facts.push(orbitLabel);
  } else if (body.kind === "moon") {
    facts.push(`${formatRadius(body.orbitKm)} km orbit`);
    facts.push(orbitLabel);
  } else {
    facts.push(`${formatAu(body.orbitAu)} AU orbit`);
    facts.push(orbitLabel);
  }
  facts.push(spinLabel, tiltLabel);
  if (orbit) {
    facts.push(`e ${formatEcc(body.eccentricity)}`);
    facts.push(`${formatNumber(body.inclinationDeg)}° inclination`);
  }
  if (retrograde) facts.push("Retrograde");
  return {
    id: body.id,
    name: body.name,
    kind: body.kind,
    radiusLabel,
    orbitLabel,
    spinLabel,
    tiltLabel,
    facts,
    retrograde,
  };
}

function formatNumber(value) {
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function formatRadius(km) {
  if (km >= 100) return String(Math.round(km));
  return formatNumber(km);
}

function formatAu(value) {
  if (value >= 10) return value.toFixed(1);
  if (value >= 1) return value.toFixed(2);
  return value.toFixed(3);
}

function formatEcc(value) {
  if (value >= 0.1) return value.toFixed(3);
  if (value >= 0.01) return value.toFixed(3);
  if (value >= 0.001) return value.toFixed(4);
  return value.toFixed(5);
}
