/**
 * Published galactic neighborhood numbers. Visual mapping lives in
 * js/galaxy.js; tunables live in js/config.js.
 *
 * Distances are kiloparsecs. Coordinates are IAU galactic (l, b) and
 * equatorial J2000. Do not convert these through the solar-system AU curve.
 */

/** GRAVITY Collaboration 2019, A&A 625, L10. Geometric R0 from S2. */
export const SUN_GALACTIC = Object.freeze({
  rKpc: 8.178,
  zKpc: 0.0208,
  arm: "Orion Arm",
});

/**
 * Stellar disk size from Bland-Hawthorn & Gerhard 2016, ARA&A 54, 529.
 * This is the luminous disk, not the dark-matter halo.
 */
export const MILKY_WAY = Object.freeze({
  diskRadiusKpc: 16.5,
  bulgeRadiusKpc: 2.5,
  heightKpc: 0.3,
});

/** Sgr A*; Reid & Brunthaler 2004, ApJ 616, 872. l, b ~ 0 by definition. */
export const GALACTIC_CENTER = Object.freeze({
  name: "Galactic Center",
  raDeg: 266.4051,
  decDeg: -28.936175,
  lDeg: 0,
  bDeg: 0,
  distanceKpc: SUN_GALACTIC.rKpc,
});

/**
 * Reid et al. 2019, ApJ 885, 131, Table 2. Logarithmic spirals from
 * BeSSeL maser parallaxes. β is galactocentric azimuth in degrees,
 * 0 toward the Sun, increasing with galactic longitude. Pitch angles
 * inner/outer of the kink. Local Arm is the Orion Arm.
 */
export const SPIRAL_ARMS = Object.freeze([
  {
    id: "norma",
    name: "Norma",
    betaMinDeg: 5,
    betaMaxDeg: 54,
    betaKinkDeg: 18,
    rKinkKpc: 4.46,
    pitchInnerDeg: -1.0,
    pitchOuterDeg: 19.5,
    widthKpc: 0.14,
  },
  {
    id: "scutum",
    name: "Scutum-Centaurus",
    betaMinDeg: 0,
    betaMaxDeg: 104,
    betaKinkDeg: 23,
    rKinkKpc: 4.91,
    pitchInnerDeg: 14.1,
    pitchOuterDeg: 12.1,
    widthKpc: 0.23,
  },
  {
    id: "sagittarius",
    name: "Sagittarius-Carina",
    betaMinDeg: 2,
    betaMaxDeg: 97,
    betaKinkDeg: 24,
    rKinkKpc: 6.04,
    pitchInnerDeg: 17.1,
    pitchOuterDeg: 1.0,
    widthKpc: 0.27,
  },
  {
    id: "orion",
    name: "Orion Arm",
    betaMinDeg: -8,
    betaMaxDeg: 34,
    betaKinkDeg: 9,
    rKinkKpc: 8.26,
    pitchInnerDeg: 11.4,
    pitchOuterDeg: 11.4,
    widthKpc: 0.31,
  },
  {
    id: "perseus",
    name: "Perseus",
    betaMinDeg: -23,
    betaMaxDeg: 115,
    betaKinkDeg: 40,
    rKinkKpc: 8.87,
    pitchInnerDeg: 10.3,
    pitchOuterDeg: 8.7,
    widthKpc: 0.35,
  },
  {
    id: "outer",
    name: "Outer",
    betaMinDeg: -16,
    betaMaxDeg: 71,
    betaKinkDeg: 18,
    rKinkKpc: 12.24,
    pitchInnerDeg: 3.0,
    pitchOuterDeg: 9.4,
    widthKpc: 0.65,
  },
]);

/**
 * Nearby galaxies. Positions: SIMBAD ICRS / IAU galactic J2000.
 * Distances: LMC Pietrzyński et al. 2019, Nature 567, 200;
 * SMC Graczyk et al. 2020, ApJ 904, 13;
 * M31 NASA / NED 0.78 Mpc convention;
 * M33 de Grijs & Bono 2014, AJ 148, 17.
 * R25 kpc from NED / Utomo et al. 2019 compilation.
 */
export const NEIGHBORS = Object.freeze([
  {
    id: "lmc",
    name: "LMC",
    messier: "",
    raDeg: 80.89417,
    decDeg: -69.75611,
    lDeg: 280.4652,
    bDeg: -32.8884,
    distanceKpc: 49.59,
    radiusKpc: 5.0,
  },
  {
    id: "smc",
    name: "SMC",
    messier: "",
    raDeg: 13.15833,
    decDeg: -72.80028,
    lDeg: 302.8084,
    bDeg: -44.3277,
    distanceKpc: 62.44,
    radiusKpc: 2.5,
  },
  {
    id: "m31",
    name: "Andromeda",
    messier: "M31",
    raDeg: 10.68471,
    decDeg: 41.26875,
    lDeg: 121.174329,
    bDeg: -21.573309,
    distanceKpc: 780,
    radiusKpc: 20.5,
  },
  {
    id: "m33",
    name: "Triangulum",
    messier: "M33",
    raDeg: 23.46207,
    decDeg: 30.66018,
    lDeg: 133.610195,
    bDeg: -31.330679,
    distanceKpc: 859,
    radiusKpc: 7.5,
  },
]);

export function findNeighbor(id) {
  return NEIGHBORS.find((item) => item.id === id) ?? null;
}

export function findSpiralArm(id) {
  return SPIRAL_ARMS.find((item) => item.id === id) ?? null;
}
