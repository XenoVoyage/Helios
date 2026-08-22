/**
 * Compact 2MRS decoding plus the deterministic outer-density illustration.
 *
 * The local volume contains measured 2MRS galaxy directions and an explicitly
 * approximate Hubble-law radial distance. Beyond the survey range, first-party
 * random candidate points are retained preferentially near walls, filaments,
 * and nodes of a seeded Voronoi tessellation. That outer volume is not survey
 * data, a density reconstruction, or a cosmological simulation.
 */
import { TWOMRS_METADATA, TWOMRS_PAYLOAD_BASE64 } from "./2mrs-data.js";

const TAU = Math.PI * 2;

export const COSMIC_WEB_MODEL = Object.freeze({
  localMethod: "2MRS galactic direction + barycentric radial velocity / H0",
  outerMethod: "seeded Voronoi-proximity point density illustration",
  maxSamples: 50000,
  outer: Object.freeze({
    count: 6500,
    voidCount: 24,
    seed: 0x4cf42026,
    verticalScale: 0.94,
    warmth: 0.06,
  }),
});

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function seedRandom(seed) {
  let n = seed >>> 0;
  return () => {
    n = (n + 0x6d2b79f5) | 0;
    let t = Math.imul(n ^ (n >>> 15), 1 | n);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function readUint16(bytes, offset) {
  return bytes[offset] * 256 + bytes[offset + 1];
}

function decodePayload() {
  const encoded = TWOMRS_PAYLOAD_BASE64.replace(/\s/g, "");
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const expected = TWOMRS_METADATA.includedRows * TWOMRS_METADATA.recordBytes;
  if (bytes.length !== expected) {
    throw new Error(`2MRS payload has ${bytes.length} bytes; expected ${expected}`);
  }
  return bytes;
}

/** Decode the compact 2MRS subset into one projected point/color pair. */
export function createTwoMrsSamples(project) {
  if (typeof project !== "function") throw new TypeError("2MRS projection must be a function");
  const bytes = decodePayload();
  const count = TWOMRS_METADATA.includedRows;
  const stride = TWOMRS_METADATA.recordBytes;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const offset = i * stride;
    const lDeg = readUint16(bytes, offset) / 65535 * 360;
    const bDeg = readUint16(bytes, offset + 2) / 65535 * 180 - 90;
    const velocityKmS = readUint16(bytes, offset + 4);
    const distanceMpc = velocityKmS / TWOMRS_METADATA.h0KmSPerMpc;
    const at = project({ lDeg, bDeg, distanceMpc });
    const positionOffset = i * 3;
    positions[positionOffset] = at.x;
    positions[positionOffset + 1] = at.y;
    positions[positionOffset + 2] = at.z;

    const magnitude = 4 + bytes[offset + 6] / 32;
    const brightness = clamp01((11.75 - magnitude) / 7.75);
    colors[positionOffset] = 0.52 + brightness * 0.42;
    colors[positionOffset + 1] = 0.65 + brightness * 0.3;
    colors[positionOffset + 2] = 0.86 + brightness * 0.14;
  }
  return { positions, colors };
}

function unitSpherePoint(rand, inner = 0, outer = 1) {
  const z = rand() * 2 - 1;
  const azimuth = rand() * TAU;
  const radialCube = inner ** 3 + rand() * (outer ** 3 - inner ** 3);
  const radius = Math.cbrt(radialCube);
  const ring = Math.sqrt(Math.max(0, 1 - z * z));
  return {
    x: radius * ring * Math.cos(azimuth),
    y: radius * z,
    z: radius * ring * Math.sin(azimuth),
  };
}

function createVoidCenters(count, rand) {
  const centers = [];
  for (let i = 0; i < count; i += 1) {
    centers.push(unitSpherePoint(rand, 0.08, 0.88));
  }
  return centers;
}

function proximityScores(point, centers) {
  let first = Infinity;
  let second = Infinity;
  let third = Infinity;
  let fourth = Infinity;
  for (const center of centers) {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const dz = point.z - center.z;
    const distance2 = dx * dx + dy * dy + dz * dz;
    if (distance2 < first) {
      fourth = third;
      third = second;
      second = first;
      first = distance2;
    } else if (distance2 < second) {
      fourth = third;
      third = second;
      second = distance2;
    } else if (distance2 < third) {
      fourth = third;
      third = distance2;
    } else if (distance2 < fourth) {
      fourth = distance2;
    }
  }
  const d1 = Math.sqrt(first);
  const d2 = Math.sqrt(second);
  const d3 = Math.sqrt(third);
  const d4 = Math.sqrt(fourth);
  const scale = Math.max(d4, 1e-6);
  const wall = Math.exp(-18 * (d2 - d1) / scale);
  const filament = wall * Math.exp(-24 * (d3 - d2) / scale);
  const node = filament * Math.exp(-30 * (d4 - d3) / scale);
  return { wall, filament, node };
}

/**
 * Generate exactly `settings.count` samples between two scene radii.
 * The small uniform floor leaves a sparse field while the Voronoi proximity
 * weights concentrate most accepted points on walls and their intersections.
 */
export function generateCosmicDensity(settings, innerRadius, outerRadius) {
  if (!(innerRadius >= 0) || !(outerRadius > innerRadius)) {
    throw new RangeError("cosmic density radii must define a positive shell");
  }
  const { count, voidCount, seed, verticalScale, warmth } = settings;
  if (!Number.isInteger(count) || count <= 0) throw new RangeError("cosmic density count must be positive");
  if (!Number.isInteger(voidCount) || voidCount < 4) throw new RangeError("cosmic density needs at least four void centers");

  const rand = seedRandom(seed);
  const centers = createVoidCenters(voidCount, rand);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  let accepted = 0;
  let attempts = 0;
  const maxAttempts = count * 180;

  while (accepted < count && attempts < maxAttempts) {
    attempts += 1;
    const point = unitSpherePoint(rand, 0.035, 0.965);
    const scores = proximityScores(point, centers);
    const acceptance = Math.min(
      0.96,
      0.025 + scores.wall * 0.34 + scores.filament * 0.44 + scores.node * 0.17,
    );
    if (rand() > acceptance) continue;

    const i = accepted * 3;
    // Retain the accepted topology and radial ordering, but remap it into a
    // volume-uniform shell beyond the measured 2MRS boundary. Normalize after
    // the visual flattening so no direction can fall back inside that boundary.
    const sourceRadius = Math.hypot(point.x, point.y, point.z);
    const radialQuantile = (sourceRadius ** 3 - 0.035 ** 3) / (0.965 ** 3 - 0.035 ** 3);
    const shellRadius = Math.cbrt(
      innerRadius ** 3 + radialQuantile * (outerRadius ** 3 - innerRadius ** 3),
    );
    const directionLength = Math.hypot(point.x, point.y * verticalScale, point.z);
    positions[i] = point.x / directionLength * shellRadius;
    positions[i + 1] = point.y * verticalScale / directionLength * shellRadius;
    positions[i + 2] = point.z / directionLength * shellRadius;

    const strength = clamp01(
      0.18 + scores.wall * 0.28 + scores.filament * 0.38 + scores.node * 0.42,
    );
    colors[i] = clamp01(0.34 + warmth * 0.42 + scores.node * 0.45);
    colors[i + 1] = clamp01(0.48 + strength * 0.34 + warmth * 0.12);
    colors[i + 2] = clamp01(0.66 + strength * 0.34 - warmth * 0.12);
    accepted += 1;
  }

  if (accepted !== count) {
    throw new Error(`cosmic density accepted ${accepted} of ${count} samples`);
  }
  return { positions, colors, attempts };
}

export function cosmicDensitySampleCount() {
  return TWOMRS_METADATA.includedRows + COSMIC_WEB_MODEL.outer.count;
}
