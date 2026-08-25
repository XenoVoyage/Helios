/**
 * Static J2000 celestial sphere: Hipparcos stars, IAU stick figures,
 * a galactic-plane Milky Way, and Andromeda at M31.
 *
 * Catalog positions stay equatorial J2000. They are rotated into the
 * orrery's Y-up ecliptic frame so the sky matches js/bodies.js.
 */
import { CONFIG } from "./config.js";
import {
  ANDROMEDA,
  CONSTELLATION_LINES,
  MAJOR_CONSTELLATIONS,
  STAR_NAMES,
  STARS,
} from "./sky-catalog.js";

export { ANDROMEDA, CONSTELLATION_LINES, MAJOR_CONSTELLATIONS, STAR_NAMES, STARS };

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

export const CELESTIAL_RENDER_THRESHOLD = 0.04;
export const CONSTELLATION_MODES = Object.freeze({
  off: "off",
  major: "major",
  all: "all",
});
export const CONSTELLATION_LAYOUT = Object.freeze({
  minBudget: 4,
  maxBudget: 18,
  pixelsPerLabel: 65000,
  edgePadding: 12,
  enterPadding: 8,
  collisionGap: 8,
});
export const CONSTELLATION_LABEL_FALLBACK_HIPS = Object.freeze({
  Men: Object.freeze([29271]),
  Mic: Object.freeze([102831]),
});

/** IAU 2006 mean obliquity of the ecliptic at J2000, degrees. */
export const OBLIQUITY_J2000_DEG = 23.43927944;
const OBLIQUITY_J2000_RAD = OBLIQUITY_J2000_DEG * DEG;
const COS_OBLIQUITY_J2000 = Math.cos(OBLIQUITY_J2000_RAD);
const SIN_OBLIQUITY_J2000 = Math.sin(OBLIQUITY_J2000_RAD);

/** IAU galactic pole (J2000), used to orient the Milky Way texture. */
export const GALACTIC_NGP_RA_DEG = 192.85948;
export const GALACTIC_NGP_DEC_DEG = 27.12825;
export const GALACTIC_NCP_LON_DEG = 122.93192;
const GALACTIC_NGP_RA_RAD = GALACTIC_NGP_RA_DEG * DEG;
const GALACTIC_NGP_DEC_RAD = GALACTIC_NGP_DEC_DEG * DEG;
const GALACTIC_NCP_LON_RAD = GALACTIC_NCP_LON_DEG * DEG;

const GALACTIC_EQUATORIAL_BASIS = (() => {
  const sinAG = Math.sin(GALACTIC_NGP_RA_RAD);
  const cosAG = Math.cos(GALACTIC_NGP_RA_RAD);
  const sinDG = Math.sin(GALACTIC_NGP_DEC_RAD);
  const cosDG = Math.cos(GALACTIC_NGP_DEC_RAD);
  const sinL = Math.sin(GALACTIC_NCP_LON_RAD);
  const cosL = Math.cos(GALACTIC_NCP_LON_RAD);
  const meridian = { x: -sinDG * cosAG, y: -sinDG * sinAG, z: cosDG };
  const east = { x: -sinAG, y: cosAG, z: 0 };
  return Object.freeze({
    x: Object.freeze({
      x: cosL * meridian.x + sinL * east.x,
      y: cosL * meridian.y + sinL * east.y,
      z: cosL * meridian.z + sinL * east.z,
    }),
    y: Object.freeze({
      x: sinL * meridian.x - cosL * east.x,
      y: sinL * meridian.y - cosL * east.y,
      z: sinL * meridian.z - cosL * east.z,
    }),
    z: Object.freeze({ x: cosDG * cosAG, y: cosDG * sinAG, z: sinDG }),
  });
})();

/** Cassiopeia / Andromeda / MW crossing, used by ?look=sky. */
export const EARTH_SKY_LOOK = Object.freeze({ raDeg: 16, decDeg: 49 });

export const SKY_ASSETS = Object.freeze({
  milkyWay: "assets/sky/milky-way.jpg",
  andromeda: "assets/sky/andromeda.png",
});

const starsByHip = new Map();
const starsByName = new Map();
for (const row of STARS) {
  const star = {
    hip: row[0],
    raDeg: row[1],
    decDeg: row[2],
    mag: row[3],
    bv: row[4],
    name: STAR_NAMES[row[0]] ?? "",
  };
  starsByHip.set(star.hip, star);
  if (star.name) starsByName.set(star.name.toLowerCase(), star);
}

const constellationHips = new Set();
for (const constellation of CONSTELLATION_LINES) {
  for (const path of constellation.paths) {
    for (const hip of path) constellationHips.add(hip);
  }
}

/** True when the star is a member of a drawn IAU stick figure. */
export function isConstellationLineStar(hip) {
  return constellationHips.has(hip);
}

export function findStarByName(name) {
  return starsByName.get(String(name).toLowerCase()) ?? null;
}

export function findStarByHip(hip) {
  return starsByHip.get(hip) ?? null;
}

export function findConstellation(id) {
  return CONSTELLATION_LINES.find((item) => item.id === id) ?? null;
}

export function constellationHasStar(id, hip) {
  const constellation = findConstellation(id);
  if (!constellation) return false;
  return constellation.paths.some((path) => path.includes(hip));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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

function wrapRad(radians) {
  return ((radians % TAU) + TAU) % TAU;
}

/** Equatorial J2000 unit vector in the standard ICRS basis. */
export function equatorialUnit(raDeg, decDeg) {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const cosD = Math.cos(dec);
  return {
    x: cosD * Math.cos(ra),
    y: cosD * Math.sin(ra),
    z: Math.sin(dec),
  };
}

/**
 * Equatorial J2000 vector to the scene frame used by keplerOffset:
 * +X vernal equinox, +Y ecliptic north, right-handed.
 */
export function equatorialVectorToScene(eq) {
  const xEc = eq.x;
  const yEc = eq.y * COS_OBLIQUITY_J2000 + eq.z * SIN_OBLIQUITY_J2000;
  const zEc = -eq.y * SIN_OBLIQUITY_J2000 + eq.z * COS_OBLIQUITY_J2000;
  return { x: xEc, y: zEc, z: -yEc };
}

/** Equatorial J2000 sky position in the scene frame. */
export function equatorialToScene(raDeg, decDeg) {
  return equatorialVectorToScene(equatorialUnit(raDeg, decDeg));
}

/**
 * IAU Galactic cartesian to the same J2000 ecliptic scene frame.
 *
 * The three equatorial basis vectors are the exact inverse of
 * equatorialToGalactic below. Keeping this transform beside that owner
 * prevents the solar sky and extra-zoom map from inventing separate axes.
 * Magnitude is preserved, so callers may pass unit vectors or distances.
 */
export function galacticToScene(x, y, z) {
  const basis = GALACTIC_EQUATORIAL_BASIS;
  return equatorialVectorToScene({
    x: x * basis.x.x + y * basis.y.x + z * basis.z.x,
    y: x * basis.x.y + y * basis.y.y + z * basis.z.y,
    z: x * basis.x.z + y * basis.y.z + z * basis.z.z,
  });
}

export function equatorialToGalactic(raDeg, decDeg) {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const aG = GALACTIC_NGP_RA_RAD;
  const dG = GALACTIC_NGP_DEC_RAD;
  const lNCP = GALACTIC_NCP_LON_RAD;
  const sinD = Math.sin(dec);
  const cosD = Math.cos(dec);
  const sinDG = Math.sin(dG);
  const cosDG = Math.cos(dG);
  const dA = ra - aG;
  const sinB = sinD * sinDG + cosD * cosDG * Math.cos(dA);
  const b = Math.asin(clamp(sinB, -1, 1));
  const y = cosD * Math.sin(dA);
  const x = sinD * cosDG - cosD * sinDG * Math.cos(dA);
  const l = wrapRad(lNCP - Math.atan2(y, x));
  return { lDeg: l / DEG, bDeg: b / DEG };
}

/** Gaia-style galactic equirectangular UV: l = 0 at the image center. */
export function galacticToUv(lDeg, bDeg) {
  let u = 0.5 - lDeg / 360;
  u = ((u % 1) + 1) % 1;
  return { u, v: clamp(0.5 + bDeg / 180, 0, 1) };
}

export function colorFromBV(bv) {
  const t = clamp(bv, -0.4, 1.9);
  if (t < 0) {
    const u = (t + 0.4) / 0.4;
    return { r: 0.72 + 0.16 * u, g: 0.82 + 0.08 * u, b: 1 };
  }
  if (t < 0.65) {
    const u = t / 0.65;
    return { r: 0.88 + 0.12 * u, g: 0.9 + 0.06 * u, b: 1 - 0.22 * u };
  }
  const u = Math.min(1, (t - 0.65) / 1.15);
  return { r: 1, g: 0.92 - 0.42 * u, b: 0.78 - 0.55 * u };
}

export function sizeFromMag(mag) {
  return clamp(7.2 * 10 ** (-0.13 * mag), 1.7, 14);
}

/**
 * Fixed boost for stars that belong to a drawn constellation figure, so
 * the stick figures read like real sky against the field stars. Static
 * values, not a zoom ramp: brightness stays constant at every distance.
 */
export const CONSTELLATION_STAR_BOOST = Object.freeze({ size: 1.3, shade: 1.24 });

function scaleDir(dir, radius) {
  return { x: dir.x * radius, y: dir.y * radius, z: dir.z * radius };
}

function slerp(a, b, t) {
  let dot = clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1);
  const angle = Math.acos(dot);
  if (angle < 1e-5) return { x: a.x, y: a.y, z: a.z };
  const s0 = Math.sin((1 - t) * angle) / Math.sin(angle);
  const s1 = Math.sin(t * angle) / Math.sin(angle);
  return {
    x: a.x * s0 + b.x * s1,
    y: a.y * s0 + b.y * s1,
    z: a.z * s0 + b.z * s1,
  };
}

function centroidScene(hips, radius) {
  let x = 0;
  let y = 0;
  let z = 0;
  let n = 0;
  for (const hip of hips) {
    const star = starsByHip.get(hip);
    if (!star) continue;
    const at = equatorialToScene(star.raDeg, star.decDeg);
    x += at.x;
    y += at.y;
    z += at.z;
    n += 1;
  }
  if (!n) return null;
  const len = Math.hypot(x, y, z) || 1;
  return { x: (x / len) * radius, y: (y / len) * radius, z: (z / len) * radius };
}

export function normalizeConstellationMode(mode) {
  if (mode === true) return CONSTELLATION_MODES.major;
  if (mode === false) return CONSTELLATION_MODES.off;
  const normalized = String(mode ?? "").toLowerCase();
  return Object.values(CONSTELLATION_MODES).includes(normalized)
    ? normalized
    : CONSTELLATION_MODES.major;
}

export function celestialLayerRenderable(fade) {
  return Number.isFinite(fade) && fade > CELESTIAL_RENDER_THRESHOLD;
}

export function constellationAnchorHips(id) {
  const constellation = findConstellation(id);
  if (!constellation) return [];
  // Preserve the existing path weighting exactly: repeated junction stars
  // contributed repeatedly to the original ten Major-label centroids.
  const hips = constellation.paths.flat().filter((hip) => starsByHip.has(hip));
  return hips.length ? hips : [...(CONSTELLATION_LABEL_FALLBACK_HIPS[id] ?? [])];
}

export function constellationAnchor(id, radius = 1) {
  return centroidScene(constellationAnchorHips(id), radius);
}

function starSprite(THREE) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, "rgba(255, 255, 255, 1)");
  glow.addColorStop(0.18, "rgba(255, 255, 255, 0.85)");
  glow.addColorStop(0.42, "rgba(220, 230, 255, 0.22)");
  glow.addColorStop(1, "rgba(220, 230, 255, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 64, 64);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function loadMap(THREE, path, colorSpace = true) {
  const texture = new THREE.TextureLoader().load(path);
  if (colorSpace) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function createMilkyWay(THREE, radius) {
  const texture = loadMap(THREE, SKY_ASSETS.milkyWay);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      milkyWay: { value: texture },
      brightness: { value: 0.82 },
      fade: { value: 1 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D milkyWay;
      uniform float brightness;
      uniform float fade;
      varying vec3 vDir;
      const float PI = 3.141592653589793;
      const float TAU = 6.283185307179586;
      const float EPS = ${OBLIQUITY_J2000_RAD};
      const float NGP_RA = ${GALACTIC_NGP_RA_RAD};
      const float NGP_DEC = ${GALACTIC_NGP_DEC_RAD};
      const float NCP_L = ${GALACTIC_NCP_LON_RAD};
      void main() {
        vec3 dir = normalize(vDir);
        vec3 ecl = vec3(dir.x, -dir.z, dir.y);
        float cosE = cos(EPS);
        float sinE = sin(EPS);
        vec3 eq = vec3(
          ecl.x,
          ecl.y * cosE - ecl.z * sinE,
          ecl.y * sinE + ecl.z * cosE
        );
        float ra = atan(eq.y, eq.x);
        float dec = asin(clamp(eq.z, -1.0, 1.0));
        float sinD = sin(dec);
        float cosD = cos(dec);
        float sinG = sin(NGP_DEC);
        float cosG = cos(NGP_DEC);
        float dA = ra - NGP_RA;
        float sinB = sinD * sinG + cosD * cosG * cos(dA);
        float b = asin(clamp(sinB, -1.0, 1.0));
        float y = cosD * sin(dA);
        float x = sinD * cosG - cosD * sinG * cos(dA);
        float l = NCP_L - atan(y, x);
        float u = 0.5 - l / TAU;
        float v = 0.5 + b / PI;
        vec4 color = texture2D(milkyWay, vec2(u, v));
        float luma = dot(color.rgb, vec3(0.30, 0.59, 0.11));
        float solar = 0.82;
        float gain = max(1.0, brightness / solar);
        float a = clamp(luma * 1.35 * gain, 0.0, 0.96) * fade;
        gl_FragColor = vec4(color.rgb * brightness * fade, a);
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    lights: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 48), material);
  mesh.name = "milky-way";
  mesh.frustumCulled = false;
  return mesh;
}

function createStars(THREE, radius) {
  const count = STARS.length;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const star = {
      hip: STARS[i][0],
      raDeg: STARS[i][1],
      decDeg: STARS[i][2],
      mag: STARS[i][3],
      bv: STARS[i][4],
    };
    const at = scaleDir(equatorialToScene(star.raDeg, star.decDeg), radius);
    positions[i * 3] = at.x;
    positions[i * 3 + 1] = at.y;
    positions[i * 3 + 2] = at.z;
    const figure = isConstellationLineStar(star.hip);
    const tint = colorFromBV(star.bv);
    const shade = clamp(1.3 - star.mag * 0.08, 0.5, 1.34)
      * (figure ? CONSTELLATION_STAR_BOOST.shade : 1);
    colors[i * 3] = tint.r * shade;
    colors[i * 3 + 1] = tint.g * shade;
    colors[i * 3 + 2] = tint.b * shade;
    sizes[i] = sizeFromMag(star.mag) * (figure ? CONSTELLATION_STAR_BOOST.size : 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      starMap: { value: starSprite(THREE) },
      brightness: { value: 1 },
      fade: { value: 1 },
    },
    vertexShader: `
      attribute float size;
      attribute vec3 color;
      uniform float brightness;
      varying vec3 vColor;
      void main() {
        vColor = color * brightness;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * brightness * brightness;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform sampler2D starMap;
      uniform float fade;
      varying vec3 vColor;
      void main() {
        vec4 tex = texture2D(starMap, gl_PointCoord);
        if (tex.a < 0.06 || fade < 0.04) discard;
        gl_FragColor = vec4(vColor, 1.0) * tex * fade;
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = "stars";
  points.frustumCulled = false;
  return points;
}

/**
 * Faint seeded backdrop stars behind the Hipparcos catalog, denser toward
 * the galactic plane, so the solar sky reads as a full universe inside the
 * MW. Dressing only: constant brightness at every zoom, no catalog claims,
 * and always quieter than the bright catalog stars.
 */
function createFaintStars(THREE, radius, { count, size, seed, opacity, name }) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const rand = seedRandom(seed);
  let n = 0;
  let guard = 0;
  while (n < count && guard < count * 30) {
    guard += 1;
    const raDeg = rand() * 360;
    const decDeg = Math.asin(2 * rand() - 1) / DEG;
    const { bDeg } = equatorialToGalactic(raDeg, decDeg);
    // Real faint-star density rises toward the band; mild, not a stripe.
    const keep = 0.32 + 0.68 * Math.exp(-((bDeg / 16) ** 2));
    if (rand() > keep) continue;
    const at = scaleDir(equatorialToScene(raDeg, decDeg), radius);
    const o = n * 3;
    positions[o] = at.x;
    positions[o + 1] = at.y;
    positions[o + 2] = at.z;
    const tint = colorFromBV(-0.2 + rand() * 1.5);
    const shade = 0.7 + rand() * 0.42;
    colors[o] = tint.r * shade;
    colors[o + 1] = tint.g * shade;
    colors[o + 2] = tint.b * shade;
    n += 1;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions.slice(0, n * 3), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors.slice(0, n * 3), 3));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      map: starSprite(THREE),
      size,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  points.name = name;
  points.frustumCulled = false;
  return points;
}

function createConstellationLines(THREE, radius) {
  const positions = [];
  for (const constellation of CONSTELLATION_LINES) {
    for (const path of constellation.paths) {
      for (let i = 0; i < path.length - 1; i += 1) {
        const a = starsByHip.get(path[i]);
        const b = starsByHip.get(path[i + 1]);
        if (!a || !b) continue;
        const from = equatorialToScene(a.raDeg, a.decDeg);
        const to = equatorialToScene(b.raDeg, b.decDeg);
        const angle = Math.acos(clamp(from.x * to.x + from.y * to.y + from.z * to.z, -1, 1));
        const steps = Math.max(1, Math.ceil(angle / (5 * DEG)));
        for (let step = 0; step < steps; step += 1) {
          const p0 = scaleDir(slerp(from, to, step / steps), radius);
          const p1 = scaleDir(slerp(from, to, (step + 1) / steps), radius);
          positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  const lines = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({
      color: 0x8ec7e2,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    }),
  );
  lines.name = "constellation-lines";
  lines.frustumCulled = false;
  return lines;
}

function createAndromeda(THREE, radius) {
  const map = loadMap(THREE, SKY_ASSETS.andromeda);
  const material = new THREE.SpriteMaterial({
    map,
    transparent: true,
    depthWrite: false,
    opacity: 0.92,
    color: 0xf4f0ea,
  });
  const sprite = new THREE.Sprite(material);
  const at = scaleDir(equatorialToScene(ANDROMEDA.raDeg, ANDROMEDA.decDeg), radius);
  sprite.position.set(at.x, at.y, at.z);
  const width = 2 * radius * Math.tan(1.55 * DEG);
  const height = 2 * radius * Math.tan(0.55 * DEG);
  sprite.scale.set(width, height, 1);
  sprite.name = "andromeda";
  sprite.frustumCulled = false;
  return sprite;
}

/** World-unit sprite size so names stay readable at overview, not 8px specks. */
export const CONSTELLATION_LABEL = Object.freeze({
  canvasWidth: 1024,
  canvasHeight: 256,
  fontPx: 96,
  scaleX: 240,
  scaleY: 60,
});

export function constellationLabelPixelHeight(
  viewportHeight = 1080,
  fovDeg = 52,
  radius = CONFIG.skyRadius * 0.96,
) {
  const visible = 2 * radius * Math.tan((fovDeg * Math.PI / 180) / 2);
  return CONSTELLATION_LABEL.scaleY / visible * viewportHeight;
}

function makeLabelMap(THREE, text, resolution = 1) {
  const width = Math.round(CONSTELLATION_LABEL.canvasWidth * resolution);
  const height = Math.round(CONSTELLATION_LABEL.canvasHeight * resolution);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  ctx.font = `700 ${CONSTELLATION_LABEL.fontPx * resolution}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 12 * resolution;
  ctx.strokeStyle = "rgba(2, 5, 12, 0.88)";
  ctx.fillStyle = "rgba(214, 244, 250, 0.96)";
  ctx.strokeText(text, width / 2, height / 2);
  ctx.fillText(text, width / 2, height / 2);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.userData.inkWidthRatio = clamp(
    (ctx.measureText(text).width + 32 * resolution) / width,
    0.18,
    0.96,
  );
  return map;
}

function createConstellationLabels(THREE, radius) {
  const group = new THREE.Group();
  group.name = "constellation-labels";
  group.userData.layoutWorkspace = createConstellationLabelWorkspace();
  group.userData.layoutKey = "";
  for (let catalogRank = 0; catalogRank < CONSTELLATION_LINES.length; catalogRank += 1) {
    const constellation = CONSTELLATION_LINES[catalogRank];
    const majorRank = MAJOR_CONSTELLATIONS.indexOf(constellation.id);
    const at = constellationAnchor(constellation.id, radius);
    if (!at) continue;
    const map = makeLabelMap(THREE, constellation.name, majorRank >= 0 ? 1 : 0.5);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map,
      transparent: true,
      depthWrite: false,
      opacity: 0.94,
      sizeAttenuation: true,
    }));
    sprite.position.set(at.x, at.y, at.z);
    sprite.scale.set(CONSTELLATION_LABEL.scaleX, CONSTELLATION_LABEL.scaleY, 1);
    sprite.frustumCulled = false;
    sprite.visible = majorRank >= 0;
    sprite.name = `constellation-label-${constellation.id}`;
    sprite.userData.constellationId = constellation.id;
    sprite.userData.constellationName = constellation.name;
    sprite.userData.majorRank = majorRank;
    sprite.userData.catalogRank = catalogRank;
    sprite.userData.inkWidthRatio = map.userData.inkWidthRatio;
    sprite.userData.world = new THREE.Vector3();
    sprite.userData.cameraSpace = new THREE.Vector3();
    sprite.userData.projected = new THREE.Vector3();
    sprite.userData.layoutCandidate = {
      id: constellation.id,
      name: constellation.name,
      majorRank,
      catalogRank,
      retained: false,
      eligible: false,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };
    group.add(sprite);
  }
  return group;
}

export function constellationLabelBudget(width, height, topInset = 64, bottomInset = 72) {
  const usableHeight = Math.max(1, height - topInset - bottomInset);
  return clamp(
    Math.floor(width * usableHeight / CONSTELLATION_LAYOUT.pixelsPerLabel),
    CONSTELLATION_LAYOUT.minBudget,
    CONSTELLATION_LAYOUT.maxBudget,
  );
}

function rectanglesOverlap(a, b, gap) {
  return a.left < b.right + gap
    && a.right > b.left - gap
    && a.top < b.bottom + gap
    && a.bottom > b.top - gap;
}

function createConstellationLabelRect() {
  return { left: 0, right: 0, top: 0, bottom: 0 };
}

/** Preserve Major mode unless visible label ink would be cut by a viewport edge. */
export function constellationLabelFitsViewport(candidate, {
  width,
  height,
} = {}) {
  if (!candidate || !(width > 0) || !(height > 0)) return true;
  const halfWidth = candidate.width / 2;
  const halfHeight = candidate.height / 2;
  const left = candidate.x - halfWidth;
  const right = candidate.x + halfWidth;
  const top = candidate.y - halfHeight;
  const bottom = candidate.y + halfHeight;
  const intersectsViewport = right > 0 && left < width && bottom > 0 && top < height;
  if (!candidate.eligible || !intersectsViewport) return true;
  return left >= 0 && right <= width && top >= 0 && bottom <= height;
}

/** Reusable CPU-only storage for the per-frame All-label layout. */
export function createConstellationLabelWorkspace(
  rectCapacity = CONSTELLATION_LAYOUT.maxBudget,
) {
  const rects = [];
  for (let index = 0; index < rectCapacity; index += 1) {
    rects.push(createConstellationLabelRect());
  }
  return {
    candidates: [],
    ordered: [],
    accepted: [],
    rects,
    retained: new Set(),
    selected: new Set(),
    options: { width: 0, height: 0, topInset: 64, bottomInset: 72 },
    viewport: { width: null, height: null, topInset: null, bottomInset: null },
  };
}

/**
 * Pure deterministic label packing used by the All mode and unit tests.
 * Existing two-argument callers receive independent output. A supplied
 * workspace reuses its arrays and rectangle pool until the next call.
 */
export function selectConstellationLabelIds(candidates, {
  width,
  height,
  topInset = 64,
  bottomInset = 72,
  budget = constellationLabelBudget(width, height, topInset, bottomInset),
} = {}, workspace = null) {
  const storage = workspace ?? createConstellationLabelWorkspace();
  const { ordered, accepted, rects } = storage;
  ordered.length = 0;
  accepted.length = 0;
  if (!(width > 0) || !(height > 0) || budget <= 0) return accepted;
  for (const candidate of candidates) ordered.push(candidate);
  ordered.sort((a, b) => {
    const aMajor = a.majorRank >= 0;
    const bMajor = b.majorRank >= 0;
    if (aMajor !== bMajor) return aMajor ? -1 : 1;
    if (aMajor && a.majorRank !== b.majorRank) return a.majorRank - b.majorRank;
    if (a.retained !== b.retained) return a.retained ? -1 : 1;
    if (a.catalogRank !== b.catalogRank) return a.catalogRank - b.catalogRank;
    return String(a.id).localeCompare(String(b.id));
  });
  for (const candidate of ordered) {
    if (!candidate.eligible || accepted.length >= budget) continue;
    const halfWidth = candidate.width / 2;
    const halfHeight = candidate.height / 2;
    const inset = CONSTELLATION_LAYOUT.edgePadding
      + (candidate.majorRank >= 0 || candidate.retained ? 0 : CONSTELLATION_LAYOUT.enterPadding);
    const rectIndex = accepted.length;
    let rect = rects[rectIndex];
    if (!rect) {
      rect = createConstellationLabelRect();
      rects.push(rect);
    }
    rect.left = candidate.x - halfWidth;
    rect.right = candidate.x + halfWidth;
    rect.top = candidate.y - halfHeight;
    rect.bottom = candidate.y + halfHeight;
    if (rect.left < inset || rect.right > width - inset) continue;
    if (rect.top < topInset + inset || rect.bottom > height - bottomInset - inset) continue;
    let overlaps = false;
    for (let index = 0; index < rectIndex; index += 1) {
      if (rectanglesOverlap(rect, rects[index], CONSTELLATION_LAYOUT.collisionGap)) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;
    accepted.push(candidate.id);
  }
  return accepted;
}

export function setConstellationMode(sky, mode, available = true) {
  if (!sky) return;
  const normalized = normalizeConstellationMode(mode);
  sky.userData.constellationMode = normalized;
  const canRender = Boolean(available);
  const lines = sky.getObjectByName("constellation-lines");
  const labels = sky.getObjectByName("constellation-labels");
  const figuresVisible = canRender && normalized !== CONSTELLATION_MODES.off;
  if (lines) lines.visible = figuresVisible;
  if (!labels) return;
  labels.visible = figuresVisible;
  const layoutKey = `${normalized}:${canRender}`;
  if (labels.userData.layoutKey === layoutKey) return;
  labels.userData.layoutKey = layoutKey;
  labels.userData.layoutWorkspace?.retained.clear();
  labels.userData.layoutWorkspace?.selected.clear();
  for (const sprite of labels.children) {
    sprite.visible = figuresVisible
      && normalized === CONSTELLATION_MODES.major
      && sprite.userData.majorRank >= 0;
  }
}

/** Backward-compatible boolean entrypoint; new UI uses setConstellationMode. */
export function setConstellationsVisible(sky, visible) {
  setConstellationMode(sky, visible ? CONSTELLATION_MODES.major : CONSTELLATION_MODES.off);
}

/** Project and pack All-mode names after the camera matrix is current. */
export function updateConstellationLabels(sky, camera, {
  width,
  height,
  topInset = 64,
  bottomInset = 72,
} = {}) {
  const labels = sky?.getObjectByName("constellation-labels");
  if (!labels?.visible || !camera) return [];
  const mode = normalizeConstellationMode(sky.userData.constellationMode);
  if (mode === CONSTELLATION_MODES.off) return [];
  const workspace = labels.userData.layoutWorkspace;
  const { viewport, retained, selected, options } = workspace;
  if (viewport.width !== width
    || viewport.height !== height
    || viewport.topInset !== topInset
    || viewport.bottomInset !== bottomInset) {
    viewport.width = width;
    viewport.height = height;
    viewport.topInset = topInset;
    viewport.bottomInset = bottomInset;
    retained.clear();
  }
  const fov = camera.fov * DEG;
  const candidates = workspace.candidates;
  candidates.length = 0;
  for (const sprite of labels.children) {
    const data = sprite.userData;
    if (mode === CONSTELLATION_MODES.major && data.majorRank < 0) {
      sprite.visible = false;
      continue;
    }
    const candidate = data.layoutCandidate;
    sprite.getWorldPosition(data.world);
    data.cameraSpace.copy(data.world).applyMatrix4(camera.matrixWorldInverse);
    data.projected.copy(data.world).project(camera);
    const depth = -data.cameraSpace.z;
    const pixelsPerWorld = depth > 0
      ? height / (2 * depth * Math.tan(fov / 2))
      : 0;
    candidate.retained = retained.has(candidate.id);
    candidate.eligible = depth > camera.near
      && data.projected.z > -1 && data.projected.z < 1
      && Number.isFinite(pixelsPerWorld);
    candidate.x = (data.projected.x * 0.5 + 0.5) * width;
    candidate.y = (-data.projected.y * 0.5 + 0.5) * height;
    candidate.width = sprite.scale.x * pixelsPerWorld * data.inkWidthRatio;
    candidate.height = sprite.scale.y * pixelsPerWorld * 0.58;
    candidates.push(candidate);
  }
  options.width = width;
  options.height = height;
  options.topInset = topInset;
  options.bottomInset = bottomInset;
  if (mode === CONSTELLATION_MODES.major) {
    const visibleIds = workspace.accepted;
    visibleIds.length = 0;
    for (const sprite of labels.children) {
      const data = sprite.userData;
      const visible = data.majorRank >= 0
        && constellationLabelFitsViewport(data.layoutCandidate, options);
      sprite.visible = visible;
      if (visible) visibleIds.push(data.constellationId);
    }
    return visibleIds;
  }
  const selectedIds = selectConstellationLabelIds(candidates, options, workspace);
  selected.clear();
  for (const id of selectedIds) selected.add(id);
  for (const sprite of labels.children) {
    sprite.visible = selected.has(sprite.userData.constellationId);
  }
  retained.clear();
  for (const id of selectedIds) {
    if (!MAJOR_CONSTELLATIONS.includes(id)) retained.add(id);
  }
  return selectedIds;
}

export function setSkyBandBrightness(sky, brightness) {
  const band = sky?.getObjectByName("milky-way");
  if (band?.material?.uniforms?.brightness) {
    band.material.uniforms.brightness.value = brightness;
  }
}

/** 1 keeps the solar Hipparcos look. Extra-zoom may raise this. */
export function setStarBrightness(sky, brightness) {
  const stars = sky?.getObjectByName("stars");
  if (stars?.material?.uniforms?.brightness) {
    stars.material.uniforms.brightness.value = brightness;
  }
}

export function setCelestialFade(sky, fade) {
  if (!sky) return;
  const factor = Math.min(1, Math.max(0, fade));
  sky.visible = celestialLayerRenderable(factor);
  const band = sky.getObjectByName("milky-way");
  if (band?.material?.uniforms?.fade) band.material.uniforms.fade.value = factor;
  const stars = sky.getObjectByName("stars");
  if (stars?.material?.uniforms?.fade) stars.material.uniforms.fade.value = factor;
  if (!celestialLayerRenderable(factor)) {
    const lines = sky.getObjectByName("constellation-lines");
    const labels = sky.getObjectByName("constellation-labels");
    if (lines) lines.visible = false;
    if (labels) labels.visible = false;
  }
  sky.traverse((child) => {
    if (child.name === "milky-way") return;
    const mat = child.material;
    if (!mat || mat.opacity == null) return;
    if (mat.userData.baseOpacity == null) mat.userData.baseOpacity = mat.opacity;
    mat.transparent = true;
    mat.opacity = mat.userData.baseOpacity * factor;
  });
}

export function createCelestialSphere(THREE, radius = CONFIG.skyRadius) {
  const group = new THREE.Group();
  group.name = "celestial-sphere";
  group.add(createMilkyWay(THREE, radius));
  group.add(createFaintStars(THREE, radius * 0.992, {
    count: Math.round(CONFIG.skyFaintStarCount * 0.82),
    size: 3.1,
    seed: 20260821,
    opacity: 1,
    name: "faint-stars",
  }));
  group.add(createFaintStars(THREE, radius * 0.99, {
    count: Math.round(CONFIG.skyFaintStarCount * 0.18),
    size: 4,
    seed: 47251,
    opacity: 0.95,
    name: "faint-stars-bright",
  }));
  group.add(createStars(THREE, radius * 0.985));
  group.add(createConstellationLines(THREE, radius * 0.972));
  group.add(createAndromeda(THREE, radius * 0.978));
  group.add(createConstellationLabels(THREE, radius * 0.96));
  return group;
}

export function attachSkyToCamera(sky, camera) {
  sky.position.copy(camera.position);
}

export function wantsEarthSkyLook() {
  return new URLSearchParams(location.search).get("look") === "sky";
}

/** Camera just outside a world, looking at the inertial sky. */
export function placeCameraForSkyLook(camera, origin, standoff, look = EARTH_SKY_LOOK) {
  const dir = equatorialToScene(look.raDeg, look.decDeg);
  camera.position.set(
    origin.x + dir.x * standoff,
    origin.y + dir.y * standoff,
    origin.z + dir.z * standoff,
  );
  camera.lookAt(
    origin.x + dir.x * 400,
    origin.y + dir.y * 400,
    origin.z + dir.z * 400,
  );
}
