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

/** IAU 2006 mean obliquity of the ecliptic at J2000, degrees. */
export const OBLIQUITY_J2000_DEG = 23.43927944;

/** IAU galactic pole (J2000), used to orient the Milky Way texture. */
export const GALACTIC_NGP_RA_DEG = 192.85948;
export const GALACTIC_NGP_DEC_DEG = 27.12825;
export const GALACTIC_NCP_LON_DEG = 122.93192;

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
 * Equatorial J2000 to the scene frame used by keplerOffset:
 * +X vernal equinox, +Y ecliptic north, right-handed.
 */
export function equatorialToScene(raDeg, decDeg) {
  const eq = equatorialUnit(raDeg, decDeg);
  const cosE = Math.cos(OBLIQUITY_J2000_DEG * DEG);
  const sinE = Math.sin(OBLIQUITY_J2000_DEG * DEG);
  const xEc = eq.x;
  const yEc = eq.y * cosE + eq.z * sinE;
  const zEc = -eq.y * sinE + eq.z * cosE;
  return { x: xEc, y: zEc, z: -yEc };
}

export function equatorialToGalactic(raDeg, decDeg) {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const aG = GALACTIC_NGP_RA_DEG * DEG;
  const dG = GALACTIC_NGP_DEC_DEG * DEG;
  const lNCP = GALACTIC_NCP_LON_DEG * DEG;
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
  return clamp(6.4 * 10 ** (-0.13 * mag), 1.15, 14);
}

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
      varying vec3 vDir;
      const float PI = 3.141592653589793;
      const float TAU = 6.283185307179586;
      const float EPS = 0.4090928042223289;
      const float NGP_RA = 3.366032882493748;
      const float NGP_DEC = 0.473477302980151;
      const float NCP_L = 2.1455668513703367;
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
        gl_FragColor = vec4(color.rgb * brightness, clamp(luma * 1.35, 0.0, 0.92));
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    toneMapped: true,
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
      raDeg: STARS[i][1],
      decDeg: STARS[i][2],
      mag: STARS[i][3],
      bv: STARS[i][4],
    };
    const at = scaleDir(equatorialToScene(star.raDeg, star.decDeg), radius);
    positions[i * 3] = at.x;
    positions[i * 3 + 1] = at.y;
    positions[i * 3 + 2] = at.z;
    const tint = colorFromBV(star.bv);
    const shade = clamp(1.18 - star.mag * 0.08, 0.35, 1.25);
    colors[i * 3] = tint.r * shade;
    colors[i * 3 + 1] = tint.g * shade;
    colors[i * 3 + 2] = tint.b * shade;
    sizes[i] = sizeFromMag(star.mag);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { starMap: { value: starSprite(THREE) } },
    vertexShader: `
      attribute float size;
      attribute vec3 color;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform sampler2D starMap;
      varying vec3 vColor;
      void main() {
        vec4 tex = texture2D(starMap, gl_PointCoord);
        if (tex.a < 0.06) discard;
        gl_FragColor = vec4(vColor, 1.0) * tex;
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

function makeLabelMap(THREE, text) {
  const width = CONSTELLATION_LABEL.canvasWidth;
  const height = CONSTELLATION_LABEL.canvasHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  ctx.font = `700 ${CONSTELLATION_LABEL.fontPx}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 12;
  ctx.strokeStyle = "rgba(2, 5, 12, 0.88)";
  ctx.fillStyle = "rgba(214, 244, 250, 0.96)";
  ctx.strokeText(text, width / 2, height / 2);
  ctx.fillText(text, width / 2, height / 2);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function createConstellationLabels(THREE, radius) {
  const group = new THREE.Group();
  group.name = "constellation-labels";
  for (const constellation of CONSTELLATION_LINES) {
    if (!MAJOR_CONSTELLATIONS.includes(constellation.id)) continue;
    const hips = constellation.paths.flat();
    const at = centroidScene(hips, radius);
    if (!at) continue;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeLabelMap(THREE, constellation.name),
      transparent: true,
      depthWrite: false,
      opacity: 0.94,
      sizeAttenuation: true,
    }));
    sprite.position.set(at.x, at.y, at.z);
    sprite.scale.set(CONSTELLATION_LABEL.scaleX, CONSTELLATION_LABEL.scaleY, 1);
    sprite.frustumCulled = false;
    group.add(sprite);
  }
  return group;
}

export function setConstellationsVisible(sky, visible) {
  const lines = sky.getObjectByName("constellation-lines");
  const labels = sky.getObjectByName("constellation-labels");
  if (lines) lines.visible = visible;
  if (labels) labels.visible = visible;
}

export function createCelestialSphere(THREE, radius = CONFIG.skyRadius) {
  const group = new THREE.Group();
  group.name = "celestial-sphere";
  group.add(createMilkyWay(THREE, radius));
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
