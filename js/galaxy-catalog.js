/**
 * Published galactic neighborhood numbers. Visual mapping lives in
 * js/galaxy.js; tunables live in js/config.js.
 *
 * Distances are kiloparsecs unless a published Mpc or Gpc figure is also
 * stored (Virgo, Laniakea, the observable universe / CMB shell). Coordinates
 * are IAU galactic (l, b) and equatorial J2000. Do not convert these through
 * the solar-system AU curve.
 */

/**
 * Solar location references:
 * rKpc: GRAVITY Collaboration 2019, A&A 625, L10
 *   https://doi.org/10.1051/0004-6361/201935656
 * zKpc: Bennett & Bovy 2019, MNRAS 482, 1417
 *   https://doi.org/10.1093/mnras/sty2813
 * arm: Reid et al. 2014, ApJ 783, 130 (Local / Orion Arm)
 *   https://doi.org/10.1088/0004-637X/783/2/130
 */
export const SUN_GALACTIC = Object.freeze({
  rKpc: 8.178,
  zKpc: 0.0208,
  arm: "Orion Arm",
});

/**
 * Stellar disk size from Bland-Hawthorn & Gerhard 2016, ARA&A 54, 529.
 * heightKpc is the thin-disk scale height; thickHeightKpc is the thick
 * disk. haloRadiusKpc is a stylized inner-stellar-halo display scale, not a
 * physical outer boundary or the dark-matter halo. Visual disk thickness
 * lives in CONFIG.mwVisualHeightKpc.
 */
export const MILKY_WAY = Object.freeze({
  diskRadiusKpc: 16.5,
  bulgeRadiusKpc: 2.5,
  heightKpc: 0.3,
  thickHeightKpc: 0.9,
  haloRadiusKpc: 15,
});

/**
 * IAU Galactic-coordinate origin carried to J2000 (l=0, b=0), not the
 * measured position of Sgr A*. Reid & Brunthaler 2004, Appendix A:
 * https://arxiv.org/html/astro-ph/0408107v1#A1
 */
export const GALACTIC_CENTER = Object.freeze({
  name: "Galactic Center",
  raDeg: 266.4051,
  decDeg: -28.936175,
  lDeg: 0,
  bDeg: 0,
  distanceKpc: SUN_GALACTIC.rKpc,
});

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
    name: "Large Magellanic Cloud",
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
    name: "Small Magellanic Cloud",
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

/**
 * Other well-known Local Group members. Not a dwarf dump. Distances from
 * McConnachie 2012, AJ 144, 4. Positions: SIMBAD ICRS / IAU galactic J2000.
 * WLM is SIMBAD DDO 221 / NAME WLM Galaxy.
 */
export const LOCAL_GROUP = Object.freeze([
  {
    id: "m32",
    name: "M32",
    messier: "M32",
    raDeg: 10.67427,
    decDeg: 40.86517,
    lDeg: 121.150017,
    bDeg: -21.976334,
    distanceKpc: 805,
    radiusKpc: 0.4,
  },
  {
    id: "ngc205",
    name: "NGC 205",
    messier: "M110",
    raDeg: 10.091905,
    decDeg: 41.685419,
    lDeg: 120.716279,
    bDeg: -21.138699,
    distanceKpc: 824,
    radiusKpc: 2.0,
  },
  {
    id: "ngc147",
    name: "NGC 147",
    messier: "",
    raDeg: 8.3005,
    decDeg: 48.508739,
    lDeg: 119.817409,
    bDeg: -14.2527,
    distanceKpc: 676,
    radiusKpc: 1.3,
  },
  {
    id: "ngc185",
    name: "NGC 185",
    messier: "",
    raDeg: 9.741417,
    decDeg: 48.33751,
    lDeg: 120.791757,
    bDeg: -14.482403,
    distanceKpc: 617,
    radiusKpc: 1.0,
  },
  {
    id: "ic10",
    name: "IC 10",
    messier: "",
    raDeg: 5.07223,
    decDeg: 59.303791,
    lDeg: 118.958996,
    bDeg: -3.327464,
    distanceKpc: 794,
    radiusKpc: 0.8,
  },
  {
    id: "ngc6822",
    name: "NGC 6822",
    messier: "",
    raDeg: 296.234163,
    decDeg: -14.797581,
    lDeg: 25.342467,
    bDeg: -18.391181,
    distanceKpc: 459,
    radiusKpc: 1.0,
  },
  {
    id: "wlm",
    name: "WLM",
    messier: "",
    raDeg: 0.49125,
    decDeg: -15.463889,
    lDeg: 75.8532,
    bDeg: -73.6258,
    distanceKpc: 933,
    radiusKpc: 1.6,
  },
]);

/**
 * Nearest large cluster. Centered on M87. Distance: Mei et al. 2007,
 * ApJ 655, 144, ACS Virgo Cluster Survey mean 16.5 Mpc. Position: SIMBAD
 * M87 ICRS / IAU galactic J2000. We sit in the Local Group, not in the Virgo
 * Cluster. The historical Local/Virgo Supercluster is the larger containing
 * region; it is not an alias for this cluster.
 */
export const VIRGO_CLUSTER = Object.freeze({
  id: "virgo",
  name: "Virgo Cluster",
  center: "M87",
  raDeg: 187.705931,
  decDeg: 12.391123,
  lDeg: 283.777755,
  bDeg: 74.491155,
  distanceMpc: 16.5,
  distanceKpc: 16500,
});

/**
 * We sit in Laniakea (Tully, Courtois, Hoffman, Pomarède 2014, Nature 513,
 * 71). The historical Virgo / Local Supercluster is part of that basin.
 * Diameter ~160 Mpc. The extra-zoom web marks our location as the Milky
 * Way hub, not the Great Attractor / Norma Cluster ~70 Mpc away.
 */
export const LANIAKEA = Object.freeze({
  id: "laniakea",
  name: "Laniakea",
  contains: "Local (Virgo) Supercluster",
  home: true,
  diameterMpc: 160,
});

/**
 * Planck 2018 ΛCDM particle-horizon scale (Aghanim et al. 2020, A&A 641,
 * A6). Comoving radius ~46.5 billion ly (~14.25 Gpc). 1 Gpc = 3.26156 Gly.
 */
export const PARTICLE_HORIZON = Object.freeze({
  name: "Particle horizon",
  comovingRadiusGly: 46.5,
  comovingRadiusGpc: 14.25,
  lyPerGpc: 3.26156,
});

/**
 * The physical last-scattering surface is distinct from the particle horizon.
 * Helios deliberately co-locates this illustrative shell with the outer
 * display radius so the approved scale transition stays readable.
 */
export const CMB_SHELL = Object.freeze({
  name: "Illustrative CMB shell",
  displayRadiusGpc: PARTICLE_HORIZON.comovingRadiusGpc,
  physicalRelation: "inside-particle-horizon",
  map: "assets/sky/cmb.jpg",
});

export function findNeighbor(id) {
  return NEIGHBORS.find((item) => item.id === id) ?? null;
}

export function findLocalGroupMember(id) {
  return LOCAL_GROUP.find((item) => item.id === id) ?? null;
}

export function localGroupFamily() {
  return [...NEIGHBORS, ...LOCAL_GROUP];
}
