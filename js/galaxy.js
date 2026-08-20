/**
 * Galactic neighborhood layer: a 3D Milky Way disk and nearby galaxies.
 *
 * Catalog kpc stay in js/galaxy-catalog.js. Visual compression lives here
 * and in CONFIG. This map is a different representation from the celestial
 * sphere and is shown only after the solar camera cap.
 *
 * Scene frame for this map: +X toward the Galactic Center from the Sun,
 * +Y galactic north, matching the orrery's Y-up XZ disk so the default
 * camera already looks down on it. Solar AU units are never used.
 */
import { CONFIG } from "./config.js";
import { SKY_ASSETS } from "./sky.js";
import {
  GALACTIC_CENTER,
  MILKY_WAY,
  NEIGHBORS,
  SPIRAL_ARMS,
  SUN_GALACTIC,
} from "./galaxy-catalog.js";

export {
  GALACTIC_CENTER,
  MILKY_WAY,
  NEIGHBORS,
  SPIRAL_ARMS,
  SUN_GALACTIC,
};

const DEG = Math.PI / 180;
const LABEL = Object.freeze({
  canvasWidth: 768,
  canvasHeight: 192,
  fontPx: 72,
  scaleX: 420,
  scaleY: 105,
});

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

/** kpc → scene units for the Milky Way disk. Not the solar AU curve. */
export function visualMilkyWay(kpc) {
  if (!(kpc > 0)) return 0;
  return CONFIG.mwScale * kpc ** CONFIG.mwPower;
}

/** kpc → scene units for nearby galaxies. A second scale, not the disk. */
export function visualNeighborhood(kpc) {
  if (!(kpc > 0)) return 0;
  return CONFIG.neighborhoodScale * kpc ** CONFIG.neighborhoodPower;
}

/** Uniform scene units per kpc inside the disk so the spiral is not warped. */
export function milkyWayUnitsPerKpc() {
  return visualMilkyWay(SUN_GALACTIC.rKpc) / SUN_GALACTIC.rKpc;
}

/**
 * Heliocentric galactic cartesian, kpc.
 * +X toward the Galactic Center, +Y rotation, +Z north galactic pole.
 */
export function heliocentricGalactic(lDeg, bDeg, distanceKpc) {
  const l = lDeg * DEG;
  const b = bDeg * DEG;
  const cosB = Math.cos(b);
  return {
    x: distanceKpc * cosB * Math.cos(l),
    y: distanceKpc * cosB * Math.sin(l),
    z: distanceKpc * Math.sin(b),
  };
}

/** Map galactic cartesian (kpc or already-scaled) onto the Y-up scene. */
export function galacticToScene(x, y, z) {
  return { x, y: z, z: -y };
}

export function milkyWayToScene(xKpc, yKpc, zKpc) {
  const s = milkyWayUnitsPerKpc();
  return galacticToScene(xKpc * s, yKpc * s, zKpc * s);
}

export function neighborScenePosition(neighbor) {
  const hel = heliocentricGalactic(neighbor.lDeg, neighbor.bDeg, neighbor.distanceKpc);
  const len = Math.hypot(hel.x, hel.y, hel.z) || 1;
  const visual = visualNeighborhood(neighbor.distanceKpc);
  return galacticToScene(
    (hel.x / len) * visual,
    (hel.y / len) * visual,
    (hel.z / len) * visual,
  );
}

export function galacticCenterScenePosition() {
  return milkyWayToScene(GALACTIC_CENTER.distanceKpc, 0, -SUN_GALACTIC.zKpc);
}

export function sunScenePosition() {
  return { x: 0, y: 0, z: 0 };
}

/**
 * Reid et al. 2019 log spiral: ln(R/R_kink) = -(β-β_kink)*tan(ψ).
 * ψ switches at the kink. β in degrees, R in kpc.
 */
export function spiralRadiusKpc(arm, betaDeg) {
  const pitch = betaDeg <= arm.betaKinkDeg ? arm.pitchInnerDeg : arm.pitchOuterDeg;
  const dBeta = (betaDeg - arm.betaKinkDeg) * DEG;
  return arm.rKinkKpc * Math.exp(-dBeta * Math.tan(pitch * DEG));
}

/** Galactocentric (R, β) to heliocentric galactic cartesian, kpc. */
export function armPointKpc(radiusKpc, betaDeg, zKpc = 0) {
  const beta = betaDeg * DEG;
  return {
    x: SUN_GALACTIC.rKpc - radiusKpc * Math.cos(beta),
    y: radiusKpc * Math.sin(beta),
    z: zKpc - SUN_GALACTIC.zKpc,
  };
}

export function galaxyOpacity(distance) {
  if (distance <= CONFIG.galaxyFadeStart) return 0;
  if (distance >= CONFIG.galaxyFadeEnd) return 1;
  const t = (distance - CONFIG.galaxyFadeStart) / (CONFIG.galaxyFadeEnd - CONFIG.galaxyFadeStart);
  return t * t * (3 - 2 * t);
}

export function solarOpacity(distance) {
  return 1 - galaxyOpacity(distance);
}

export function scaleLayer(distance) {
  if (distance <= CONFIG.solarMaxDistance) return "solar";
  if (distance < CONFIG.galaxyFadeEnd) return "transition";
  if (distance < CONFIG.neighborhoodViewDistance) return "milkyway";
  return "neighborhood";
}

export function requestedGalaxyLook() {
  if (typeof location === "undefined") return null;
  const look = new URLSearchParams(location.search).get("look");
  if (look === "milkyway" || look === "neighborhood") return look;
  return null;
}

export function farthestNeighborhoodDistance() {
  let max = 0;
  for (const neighbor of NEIGHBORS) {
    max = Math.max(max, visualNeighborhood(neighbor.distanceKpc));
  }
  return max;
}

function loadMap(THREE, path) {
  const texture = new THREE.TextureLoader().load(path);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function makeLabelMap(THREE, text) {
  const canvas = document.createElement("canvas");
  canvas.width = LABEL.canvasWidth;
  canvas.height = LABEL.canvasHeight;
  const ctx = canvas.getContext("2d");
  ctx.font = `700 ${LABEL.fontPx}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 12;
  ctx.strokeStyle = "rgba(2, 5, 12, 0.88)";
  ctx.fillStyle = "rgba(214, 244, 250, 0.96)";
  ctx.strokeText(text, LABEL.canvasWidth / 2, LABEL.canvasHeight / 2);
  ctx.fillText(text, LABEL.canvasWidth / 2, LABEL.canvasHeight / 2);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function labelSprite(THREE, text, position, scale = 1) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeLabelMap(THREE, text),
    transparent: true,
    depthWrite: false,
    opacity: 0.96,
    sizeAttenuation: true,
  }));
  sprite.position.set(position.x, position.y, position.z);
  sprite.scale.set(LABEL.scaleX * scale, LABEL.scaleY * scale, 1);
  sprite.frustumCulled = false;
  return sprite;
}

function pinSprite(THREE) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const glow = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  glow.addColorStop(0, "rgba(255, 244, 180, 1)");
  glow.addColorStop(0.18, "rgba(102, 247, 255, 0.95)");
  glow.addColorStop(0.42, "rgba(102, 247, 255, 0.28)");
  glow.addColorStop(1, "rgba(102, 247, 255, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 128, 128);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function galaxySprite(THREE, kind) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.translate(128, 128);
  if (kind === "spiral") {
    ctx.rotate(-0.4);
    ctx.scale(1, 0.42);
    const disk = ctx.createRadialGradient(0, 0, 8, 0, 0, 120);
    disk.addColorStop(0, "rgba(255, 236, 200, 0.95)");
    disk.addColorStop(0.2, "rgba(180, 200, 255, 0.55)");
    disk.addColorStop(0.55, "rgba(90, 120, 200, 0.22)");
    disk.addColorStop(1, "rgba(40, 60, 120, 0)");
    ctx.fillStyle = disk;
    ctx.beginPath();
    ctx.arc(0, 0, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(170, 210, 255, 0.45)";
    ctx.lineWidth = 7;
    for (let arm = 0; arm < 2; arm += 1) {
      ctx.beginPath();
      for (let i = 0; i <= 48; i += 1) {
        const t = i / 48;
        const a = arm * Math.PI + t * 4.2;
        const r = 18 + t * 100;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  } else {
    ctx.scale(kind === "smc" ? 0.72 : 1, kind === "smc" ? 0.55 : 0.7);
    const blob = ctx.createRadialGradient(0, 0, 6, 0, 0, 110);
    blob.addColorStop(0, "rgba(255, 226, 180, 0.9)");
    blob.addColorStop(0.35, "rgba(255, 180, 120, 0.4)");
    blob.addColorStop(1, "rgba(120, 70, 40, 0)");
    ctx.fillStyle = blob;
    ctx.beginPath();
    ctx.ellipse(0, 0, 110, 80, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(30, -10, 50, 36, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function diskGlowMap(THREE) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  const glow = ctx.createRadialGradient(256, 256, 12, 256, 256, 250);
  glow.addColorStop(0, "rgba(255, 220, 160, 0.55)");
  glow.addColorStop(0.12, "rgba(255, 186, 120, 0.22)");
  glow.addColorStop(0.42, "rgba(120, 150, 220, 0.12)");
  glow.addColorStop(0.78, "rgba(70, 90, 150, 0.05)");
  glow.addColorStop(1, "rgba(20, 30, 60, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 512, 512);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function addPoints(THREE, group, name, positions, colors, size, opacity) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size,
      vertexColors: true,
      transparent: true,
      opacity,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  );
  points.name = name;
  points.frustumCulled = false;
  group.add(points);
  return points;
}

function createDiskParticles(THREE, group) {
  const count = 7200;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const rand = seedRandom(20260820);
  const diskR = MILKY_WAY.diskRadiusKpc;
  for (let i = 0; i < count; i += 1) {
    const u = rand();
    const radius = diskR * Math.sqrt(u) * (0.35 + 0.65 * rand());
    const beta = rand() * 360 - 180;
    const height = (rand() + rand() + rand() - 1.5) * MILKY_WAY.heightKpc;
    const at = armPointKpc(radius, beta, height);
    const scene = milkyWayToScene(at.x, at.y, at.z);
    positions[i * 3] = scene.x;
    positions[i * 3 + 1] = scene.y;
    positions[i * 3 + 2] = scene.z;
    const warm = 0.55 + 0.45 * (1 - radius / diskR);
    colors[i * 3] = 0.72 + 0.28 * warm;
    colors[i * 3 + 1] = 0.78 + 0.12 * warm;
    colors[i * 3 + 2] = 0.92 - 0.25 * warm;
  }
  addPoints(THREE, group, "mw-disk", positions, colors, 2.4, 0.42);
}

function createArmParticles(THREE, group) {
  const perArm = 900;
  const total = SPIRAL_ARMS.length * perArm;
  const positions = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const rand = seedRandom(88421);
  let n = 0;
  for (const arm of SPIRAL_ARMS) {
    const orion = arm.id === "orion";
    for (let i = 0; i < perArm; i += 1) {
      const t = i / (perArm - 1);
      const beta = arm.betaMinDeg + (arm.betaMaxDeg - arm.betaMinDeg) * t;
      const radius = spiralRadiusKpc(arm, beta) + (rand() - 0.5) * arm.widthKpc * 2.4;
      if (radius < 1.6 || radius > MILKY_WAY.diskRadiusKpc * 1.08) continue;
      const height = (rand() - 0.5) * MILKY_WAY.heightKpc * 0.7;
      const at = armPointKpc(radius, beta, height);
      const scene = milkyWayToScene(at.x, at.y, at.z);
      const o = n * 3;
      positions[o] = scene.x;
      positions[o + 1] = scene.y;
      positions[o + 2] = scene.z;
      if (orion) {
        colors[o] = 0.55;
        colors[o + 1] = 0.92;
        colors[o + 2] = 1;
      } else {
        colors[o] = 0.62 + 0.15 * rand();
        colors[o + 1] = 0.74 + 0.12 * rand();
        colors[o + 2] = 1;
      }
      n += 1;
    }
  }
  addPoints(
    THREE,
    group,
    "mw-arms",
    positions.slice(0, n * 3),
    colors.slice(0, n * 3),
    3.1,
    0.7,
  );
}

function createBulge(THREE, group) {
  const count = 1100;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const rand = seedRandom(11973);
  const gc = galacticCenterScenePosition();
  const s = milkyWayUnitsPerKpc();
  for (let i = 0; i < count; i += 1) {
    const u = rand();
    const r = MILKY_WAY.bulgeRadiusKpc * s * (u ** 0.55);
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    positions[i * 3] = gc.x + r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = gc.y + r * Math.cos(phi) * 0.55;
    positions[i * 3 + 2] = gc.z + r * Math.sin(phi) * Math.sin(theta);
    colors[i * 3] = 1;
    colors[i * 3 + 1] = 0.78 + 0.12 * rand();
    colors[i * 3 + 2] = 0.45 + 0.1 * rand();
  }
  addPoints(THREE, group, "mw-bulge", positions, colors, 3.4, 0.65);
}

function createSolarCircle(THREE, group) {
  const points = [];
  const s = milkyWayUnitsPerKpc();
  const gc = galacticCenterScenePosition();
  const radius = SUN_GALACTIC.rKpc * s;
  for (let i = 0; i <= 160; i += 1) {
    const a = (i / 160) * Math.PI * 2;
    points.push(new THREE.Vector3(
      gc.x + Math.cos(a) * radius,
      gc.y,
      gc.z + Math.sin(a) * radius,
    ));
  }
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({
      color: 0x66f7ff,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    }),
  );
  line.name = "solar-circle";
  group.add(line);
}

function createDiskGlow(THREE, group) {
  const gc = galacticCenterScenePosition();
  const radius = MILKY_WAY.diskRadiusKpc * milkyWayUnitsPerKpc();
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 96),
    new THREE.MeshBasicMaterial({
      map: diskGlowMap(THREE),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(gc.x, gc.y, gc.z);
  mesh.name = "mw-glow";
  group.add(mesh);
}

function createSunPin(THREE, group) {
  const pin = new THREE.Sprite(new THREE.SpriteMaterial({
    map: pinSprite(THREE),
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  pin.scale.set(48, 48, 1);
  pin.name = "sun-pin";
  pin.position.set(0, 0, 0);
  pin.frustumCulled = false;
  group.add(pin);
  group.add(labelSprite(THREE, "Sun", { x: 0, y: 36, z: 0 }, 0.72));
}

function neighborSpriteSize(neighbor) {
  const visual = visualNeighborhood(neighbor.distanceKpc);
  const size = (neighbor.radiusKpc / neighbor.distanceKpc) * visual * 2.2;
  return Math.max(90, size);
}

function createNeighbors(THREE, group) {
  const cluster = new THREE.Group();
  cluster.name = "neighbors";
  for (const neighbor of NEIGHBORS) {
    const at = neighborScenePosition(neighbor);
    let map;
    if (neighbor.id === "m31") map = loadMap(THREE, SKY_ASSETS.andromeda);
    else if (neighbor.id === "m33") map = galaxySprite(THREE, "spiral");
    else map = galaxySprite(THREE, neighbor.id);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map,
      color: neighbor.id === "m31" ? 0xf4f0ea : 0xffffff,
      transparent: true,
      depthWrite: false,
      opacity: 0.92,
    }));
    sprite.position.set(at.x, at.y, at.z);
    const size = neighborSpriteSize(neighbor);
    const aspect = neighbor.id === "m31" ? 0.36 : neighbor.id === "m33" ? 0.45 : 0.7;
    sprite.scale.set(size, size * aspect, 1);
    sprite.name = neighbor.id;
    sprite.frustumCulled = false;
    cluster.add(sprite);
    const label = neighbor.messier ? `${neighbor.name} (${neighbor.messier})` : neighbor.name;
    const lift = size * aspect * 0.65 + 40;
    cluster.add(labelSprite(THREE, label, { x: at.x, y: at.y + lift, z: at.z }, 1.15));
  }
  group.add(cluster);
}

function createCenterMark(THREE, group) {
  const gc = galacticCenterScenePosition();
  const mark = new THREE.Sprite(new THREE.SpriteMaterial({
    map: pinSprite(THREE),
    color: 0xffc35a,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.85,
  }));
  mark.position.set(gc.x, gc.y, gc.z);
  mark.scale.set(34, 34, 1);
  mark.name = "gc-pin";
  mark.frustumCulled = false;
  group.add(mark);
  group.add(labelSprite(THREE, "Galactic Center", { x: gc.x, y: gc.y + 48, z: gc.z }, 0.85));
}

export function createGalaxyLayer(THREE) {
  const group = new THREE.Group();
  group.name = "galaxy-layer";
  group.visible = false;
  createDiskGlow(THREE, group);
  createDiskParticles(THREE, group);
  createArmParticles(THREE, group);
  createBulge(THREE, group);
  createSolarCircle(THREE, group);
  createCenterMark(THREE, group);
  createSunPin(THREE, group);
  createNeighbors(THREE, group);
  return group;
}

export function setGalaxyLayerVisible(group, opacity) {
  if (!group) return;
  group.visible = opacity > 0.02;
  group.traverse((obj) => {
    const mat = obj.material;
    if (!mat || mat.opacity == null) return;
    if (mat.userData.keepOpacity == null) mat.userData.keepOpacity = mat.opacity;
    mat.transparent = true;
    mat.opacity = mat.userData.keepOpacity * opacity;
  });
}
