/**
 * Extra-zoom map: a luminous 3D Milky Way, nearby galaxies against a
 * far-galaxy sky that stays up through Virgo and turns microwave, a short
 * Local Group, Virgo with more clusters around it, a colored cosmic web,
 * and a CMB / observable-universe sphere you approach and then leave.
 *
 * Catalog kpc / Mpc / Gpc stay in js/galaxy-catalog.js. Visual compression
 * lives here and in CONFIG. This map is a different representation from
 * the celestial sphere and is shown only after the solar camera cap.
 *
 * Scene frame for this map: +X toward the Galactic Center from the Sun,
 * +Y galactic north, matching the orrery's Y-up XZ disk so the default
 * camera already looks down on it. Solar AU units are never used.
 */
import { CONFIG } from "./config.js";
import { SKY_ASSETS } from "./sky.js";
import {
  CMB_SHELL,
  GALACTIC_CENTER,
  LANIAKEA,
  LOCAL_GROUP,
  MILKY_WAY,
  NEIGHBORS,
  OBSERVABLE_UNIVERSE,
  SPIRAL_ARMS,
  SUN_GALACTIC,
  VIRGO_CLUSTER,
} from "./galaxy-catalog.js";

export {
  CMB_SHELL,
  GALACTIC_CENTER,
  LANIAKEA,
  LOCAL_GROUP,
  MILKY_WAY,
  NEIGHBORS,
  OBSERVABLE_UNIVERSE,
  SPIRAL_ARMS,
  SUN_GALACTIC,
  VIRGO_CLUSTER,
};

const DEG = Math.PI / 180;
const LABEL = Object.freeze({
  canvasWidth: 1400,
  canvasHeight: 192,
  fontPx: 64,
  scaleX: 560,
  scaleY: 96,
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

/** kpc → scene units for Virgo. Compresses published Mpc; not AU or the neighbor curve. */
export function visualVirgo(kpc) {
  if (!(kpc > 0)) return 0;
  return CONFIG.virgoScale * (kpc / 1000) ** CONFIG.virgoPower;
}

/** Mpc → scene units for the local cosmic web. A fourth scale, not Virgo or AU. */
export function visualWeb(mpc) {
  if (!(mpc > 0)) return 0;
  return CONFIG.webScale * mpc ** CONFIG.webPower;
}

/** Gpc → scene units for the observable universe. Compressed, not 1:1 Gpc. */
export function visualUniverse(gpc) {
  if (!(gpc > 0)) return 0;
  return CONFIG.universeScale * gpc ** CONFIG.universePower;
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

function scaledGalacticPosition(item, visual) {
  const hel = heliocentricGalactic(item.lDeg, item.bDeg, item.distanceKpc);
  const len = Math.hypot(hel.x, hel.y, hel.z) || 1;
  return galacticToScene(
    (hel.x / len) * visual,
    (hel.y / len) * visual,
    (hel.z / len) * visual,
  );
}

export function neighborScenePosition(neighbor) {
  return scaledGalacticPosition(neighbor, visualNeighborhood(neighbor.distanceKpc));
}

export function virgoScenePosition(cluster = VIRGO_CLUSTER) {
  return scaledGalacticPosition(cluster, visualVirgo(cluster.distanceKpc));
}

export function webHubScenePosition(item) {
  return scaledGalacticPosition(
    { lDeg: item.lDeg, bDeg: item.bDeg, distanceKpc: item.distanceMpc },
    visualWeb(item.distanceMpc),
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
  if (distance < CONFIG.localGroupViewDistance) return "neighborhood";
  if (distance < CONFIG.virgoViewDistance) return "localgroup";
  if (distance < CONFIG.webViewDistance) return "virgo";
  if (distance < CONFIG.universeViewDistance) return "web";
  return "universe";
}

function smoothstep01(t) {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
}

export function neighborOpacity(distance) {
  if (distance < CONFIG.mwViewDistance) return 0;
  const ready = CONFIG.mwViewDistance
    + (CONFIG.neighborhoodViewDistance - CONFIG.mwViewDistance) * 0.55;
  if (distance >= ready) return 1;
  return smoothstep01((distance - CONFIG.mwViewDistance) / (ready - CONFIG.mwViewDistance));
}

export function localGroupMemberOpacity(distance) {
  if (distance < CONFIG.neighborhoodViewDistance) return 0;
  if (distance >= CONFIG.localGroupViewDistance) return 1;
  return smoothstep01(
    (distance - CONFIG.neighborhoodViewDistance)
    / (CONFIG.localGroupViewDistance - CONFIG.neighborhoodViewDistance),
  );
}

export function virgoOpacity(distance) {
  if (distance < CONFIG.localGroupViewDistance) return 0;
  if (distance >= CONFIG.virgoViewDistance) return 1;
  return smoothstep01(
    (distance - CONFIG.localGroupViewDistance)
    / (CONFIG.virgoViewDistance - CONFIG.localGroupViewDistance),
  );
}

export function webOpacity(distance) {
  const start = CONFIG.virgoViewDistance
    + (CONFIG.webViewDistance - CONFIG.virgoViewDistance) * 0.48;
  if (distance < start) return 0;
  if (distance >= CONFIG.webViewDistance) return 1;
  return smoothstep01((distance - start) / (CONFIG.webViewDistance - start));
}

export function universeOpacity(distance) {
  const start = CONFIG.webViewDistance
    + (CONFIG.universeViewDistance - CONFIG.webViewDistance) * 0.55;
  if (distance < start) return 0;
  if (distance >= CONFIG.universeViewDistance) return 1;
  return smoothstep01((distance - start) / (CONFIG.universeViewDistance - start));
}

/** Far-galaxy sphere stays up through Virgo and the filled web; CMB replaces it later. */
export function farGalaxySkyOpacity(distance) {
  if (distance <= CONFIG.galaxyFadeStart) return 0;
  const fadeStart = CONFIG.webViewDistance
    + (CONFIG.universeViewDistance - CONFIG.webViewDistance) * 0.62;
  if (distance <= fadeStart) return 1;
  if (distance >= CONFIG.universeViewDistance) return 0.06;
  return 1 - 0.94 * smoothstep01(
    (distance - fadeStart) / (CONFIG.universeViewDistance - fadeStart),
  );
}

/** Microwave sky waits until after a long web, then becomes the shell you approach. */
export function cmbSkyOpacity(distance) {
  const start = CONFIG.webViewDistance
    + (CONFIG.universeViewDistance - CONFIG.webViewDistance) * 0.58;
  if (distance <= start) return 0;
  if (distance >= CONFIG.universeViewDistance) return 1;
  return smoothstep01(
    (distance - start) / (CONFIG.universeViewDistance - start),
  );
}

export function nearClusterOpacity(distance) {
  if (distance < CONFIG.localGroupViewDistance) return 0;
  if (distance >= CONFIG.virgoViewDistance) {
    return 1 - webOpacity(distance);
  }
  return smoothstep01(
    (distance - CONFIG.localGroupViewDistance)
    / (CONFIG.virgoViewDistance - CONFIG.localGroupViewDistance),
  );
}

export function requestedGalaxyLook() {
  if (typeof location === "undefined") return null;
  const look = new URLSearchParams(location.search).get("look");
  if (look === "cmb") return "universe";
  if (
    look === "milkyway"
    || look === "mwedge"
    || look === "mwbelow"
    || look === "handoff"
    || look === "neighborhood"
    || look === "localgroup"
    || look === "virgo"
    || look === "web"
    || look === "universe"
  ) return look;
  return null;
}

function aimAwayFrom(at) {
  const len = Math.hypot(at.x, at.y, at.z) || 1;
  const dir = { x: -at.x / len, y: -at.y / len, z: -at.z / len };
  return {
    elevation: Math.asin(clamp(dir.y, -1, 1)),
    azimuth: Math.atan2(dir.x, dir.z),
  };
}

/** High look so the spiral disk reads face-on, slightly tilted. */
export function milkyWayCameraAim() {
  return { elevation: 1.08, azimuth: 0.28 };
}

/** Near edge-on so disk thickness, bulge, and halo can be audited. */
export function milkyWayEdgeCameraAim() {
  return { elevation: 0.04, azimuth: 1.15 };
}

/** From under the disk so luminosity is not a one-sided top light. */
export function milkyWayBelowCameraAim() {
  return { elevation: -1.05, azimuth: 0.28 };
}

function cameraPosition(aim, distance) {
  const cosE = Math.cos(aim.elevation);
  return {
    x: distance * cosE * Math.sin(aim.azimuth),
    y: distance * Math.sin(aim.elevation),
    z: distance * cosE * Math.cos(aim.azimuth),
  };
}

/** Angle from the look-at ray (Sun) to a scene point, for framing audits. */
export function lookAngleTo(aim, distance, at) {
  const cam = cameraPosition(aim, distance);
  const look = { x: -cam.x, y: -cam.y, z: -cam.z };
  const to = { x: at.x - cam.x, y: at.y - cam.y, z: at.z - cam.z };
  const denom = (Math.hypot(look.x, look.y, look.z) * Math.hypot(to.x, to.y, to.z)) || 1;
  const dot = (look.x * to.x + look.y * to.y + look.z * to.z) / denom;
  return Math.acos(clamp(dot, -1, 1));
}

/**
 * Stand beside the Sun–M31 line so Andromeda sits next to the disk,
 * not stacked behind it.
 */
function neighborFamilyAim(azimuthNudge = 0, elevationNudge = 0) {
  const m31 = neighborScenePosition(NEIGHBORS.find((item) => item.id === "m31"));
  const away = aimAwayFrom(m31);
  return {
    elevation: clamp(0.7 + elevationNudge, -1.2, 1.2),
    azimuth: away.azimuth + 0.88 + azimuthNudge,
  };
}

export function neighborhoodCameraAim() {
  return neighborFamilyAim();
}

export function localGroupCameraAim() {
  return neighborFamilyAim(0.42, -0.02);
}

/** Oblique look so the Local Group family and Virgo both sit in frame. */
export function virgoCameraAim() {
  const aim = aimAwayFrom(virgoScenePosition());
  return {
    elevation: clamp(aim.elevation * 0.1 + 0.3, -1.2, 1.2),
    azimuth: aim.azimuth + 0.5,
  };
}

/** Oblique enough to read the web as a 3D volume, not a flat graph. */
export function webCameraAim() {
  return { elevation: 0.38, azimuth: 1.05 };
}

/** Pulled back so the CMB shell reads after the filled web, not instead of it. */
export function universeCameraAim() {
  return { elevation: 0.42, azimuth: 0.9 };
}

export function farthestNeighborhoodDistance() {
  let max = 0;
  for (const neighbor of NEIGHBORS) {
    max = Math.max(max, visualNeighborhood(neighbor.distanceKpc));
  }
  for (const member of LOCAL_GROUP) {
    max = Math.max(max, visualNeighborhood(member.distanceKpc));
  }
  return max;
}

export function farthestVirgoDistance() {
  const center = visualVirgo(VIRGO_CLUSTER.distanceKpc);
  const mark = visualVirgo(CONFIG.virgoMarkRadiusMpc * 1000);
  return center + mark;
}

export function farthestWebDistance() {
  return visualWeb(CONFIG.webRadiusMpc);
}

export function farthestUniverseDistance() {
  return visualUniverse(OBSERVABLE_UNIVERSE.comovingRadiusGpc);
}

function loadMap(THREE, path) {
  const texture = new THREE.TextureLoader().load(path);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function makeLabelMap(THREE, text) {
  const fontPx = text.length > 20 ? 52 : LABEL.fontPx;
  const canvas = document.createElement("canvas");
  canvas.width = LABEL.canvasWidth;
  canvas.height = LABEL.canvasHeight;
  const ctx = canvas.getContext("2d");
  ctx.font = `700 ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
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
  const sprite = new THREE.Sprite(unlitSprite(THREE, {
    map: makeLabelMap(THREE, text),
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

function hubSprite(THREE) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const glow = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  glow.addColorStop(0, "rgba(255, 236, 210, 1)");
  glow.addColorStop(0.16, "rgba(190, 210, 255, 0.85)");
  glow.addColorStop(0.42, "rgba(90, 130, 220, 0.28)");
  glow.addColorStop(1, "rgba(30, 50, 120, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 128, 128);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function galaxyKind(id) {
  if (id === "m31" || id === "m33") return "spiral";
  if (id === "lmc") return "lmc";
  if (id === "smc" || id === "wlm" || id === "ic10" || id === "ngc6822") return "irregular";
  return "elliptical";
}

function galaxySprite(THREE, kind, seed = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const rand = seedRandom(7000 + seed * 97);
  ctx.translate(128, 128);
  if (kind === "spiral") {
    ctx.rotate(-0.5 + rand() * 0.2);
    ctx.scale(1, 0.42 + rand() * 0.08);
    const disk = ctx.createRadialGradient(0, 0, 4, 0, 0, 118);
    disk.addColorStop(0, "rgba(255, 232, 190, 0.96)");
    disk.addColorStop(0.16, "rgba(210, 190, 160, 0.42)");
    disk.addColorStop(0.5, "rgba(100, 130, 200, 0.22)");
    disk.addColorStop(1, "rgba(40, 60, 120, 0)");
    ctx.fillStyle = disk;
    ctx.beginPath();
    ctx.arc(0, 0, 118, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineCap = "round";
    for (let arm = 0; arm < 2; arm += 1) {
      ctx.beginPath();
      for (let i = 0; i <= 56; i += 1) {
        const t = i / 56;
        const a = arm * Math.PI + t * 4.6;
        const r = 16 + t * 96;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "rgba(170, 210, 255, 0.55)";
      ctx.lineWidth = 9;
      ctx.stroke();
      ctx.strokeStyle = "rgba(255, 210, 160, 0.28)";
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    const bulge = ctx.createRadialGradient(0, 0, 2, 0, 0, 28);
    bulge.addColorStop(0, "rgba(255, 236, 200, 0.95)");
    bulge.addColorStop(1, "rgba(255, 180, 90, 0)");
    ctx.fillStyle = bulge;
    ctx.beginPath();
    ctx.arc(0, 0, 28, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "elliptical") {
    ctx.rotate(rand() * 0.8);
    ctx.scale(1, 0.68 + rand() * 0.1);
    const core = ctx.createRadialGradient(0, 0, 2, 0, 0, 110);
    core.addColorStop(0, "rgba(255, 236, 210, 0.95)");
    core.addColorStop(0.18, "rgba(240, 200, 150, 0.55)");
    core.addColorStop(0.55, "rgba(180, 150, 120, 0.16)");
    core.addColorStop(1, "rgba(80, 60, 40, 0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.ellipse(0, 0, 110, 90, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "lmc") {
    ctx.rotate(-0.35);
    ctx.scale(1, 0.62);
    const body = ctx.createRadialGradient(-10, 0, 8, 0, 0, 120);
    body.addColorStop(0, "rgba(255, 220, 170, 0.9)");
    body.addColorStop(0.35, "rgba(255, 160, 110, 0.4)");
    body.addColorStop(1, "rgba(80, 50, 40, 0)");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(0, 0, 118, 78, 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 190, 140, 0.45)";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.ellipse(8, 6, 70, 22, 0.4, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 8; i += 1) {
      const px = (rand() - 0.5) * 90;
      const py = (rand() - 0.5) * 60;
      const blob = ctx.createRadialGradient(px, py, 1, px, py, 16);
      blob.addColorStop(0, "rgba(255, 210, 170, 0.7)");
      blob.addColorStop(1, "rgba(255, 120, 80, 0)");
      ctx.fillStyle = blob;
      ctx.fillRect(px - 16, py - 16, 32, 32);
    }
  } else {
    ctx.scale(kind === "smc" ? 0.78 : 1, kind === "smc" ? 0.58 : 0.7);
    for (let i = 0; i < 5; i += 1) {
      const px = (rand() - 0.5) * 70;
      const py = (rand() - 0.5) * 50;
      const rr = 40 + rand() * 50;
      const blob = ctx.createRadialGradient(px, py, 4, px, py, rr);
      blob.addColorStop(0, "rgba(255, 220, 170, 0.72)");
      blob.addColorStop(0.4, "rgba(255, 170, 110, 0.28)");
      blob.addColorStop(1, "rgba(90, 50, 30, 0)");
      ctx.fillStyle = blob;
      ctx.beginPath();
      ctx.ellipse(px, py, rr, rr * 0.7, rand() * 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
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

function stampSoft(ctx, x, y, radius, color) {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
  glow.addColorStop(0, color);
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function milkyWayDiskMap(THREE) {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const cx = size / 2;
  const cy = size / 2;
  const diskPx = size * 0.46;
  const rand = seedRandom(2019);
  const pitch = 14 * DEG;
  const rInner = diskPx * 0.1;
  const thetaSun = Math.log((SUN_GALACTIC.rKpc / MILKY_WAY.diskRadiusKpc) * diskPx / rInner)
    / Math.tan(pitch);
  const beta0 = Math.PI - thetaSun;

  const disk = ctx.createRadialGradient(cx, cy, 2, cx, cy, diskPx);
  disk.addColorStop(0, "rgba(255, 226, 186, 0.92)");
  disk.addColorStop(0.12, "rgba(255, 196, 148, 0.58)");
  disk.addColorStop(0.34, "rgba(160, 180, 240, 0.38)");
  disk.addColorStop(0.7, "rgba(100, 130, 210, 0.2)");
  disk.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = disk;
  ctx.fillRect(0, 0, size, size);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.4);
  ctx.scale(1, 0.24);
  stampSoft(ctx, 0, 0, diskPx * 0.38, "rgba(255, 214, 168, 0.7)");
  ctx.restore();

  const arms = [
    { beta: beta0, turns: 1.32, alpha: 1, width: 1 },
    { beta: beta0 + Math.PI, turns: 1.32, alpha: 1, width: 1 },
    { beta: beta0 + 1.55, turns: 1.05, alpha: 0.55, width: 0.72 },
    { beta: beta0 + Math.PI + 1.55, turns: 1.05, alpha: 0.5, width: 0.68 },
  ];
  for (const arm of arms) {
    const stamps = Math.floor(280 * arm.alpha);
    for (let i = 0; i < stamps; i += 1) {
      const t = 0.04 + (i / stamps) * 0.94 + (rand() - 0.5) * 0.01;
      const theta = t * arm.turns * Math.PI * 2;
      const r = rInner * Math.exp(theta * Math.tan(pitch));
      if (r > diskPx * 0.98) continue;
      const a = arm.beta + theta;
      const scatter = (8 + t * 22) * arm.width;
      const x = cx + Math.cos(a) * r + (rand() - 0.5) * scatter;
      const y = cy + Math.sin(a) * r + (rand() - 0.5) * scatter;
      const fade = (1 - t * 0.55) * arm.alpha;
      stampSoft(ctx, x + 5, y + 3, 8 + t * 12, `rgba(40, 28, 22, ${0.1 * fade})`);
      stampSoft(ctx, x, y, 18 + t * 24, `rgba(170, 200, 255, ${0.48 * fade})`);
      stampSoft(ctx, x, y, 10 + t * 14, `rgba(255, 236, 210, ${0.62 * fade})`);
    }
    const clumps = arm.alpha > 0.8 ? 70 : 32;
    for (let i = 0; i < clumps; i += 1) {
      const t = 0.1 + rand() * 0.8;
      const theta = t * arm.turns * Math.PI * 2;
      const r = rInner * Math.exp(theta * Math.tan(pitch));
      const a = arm.beta + theta;
      const x = cx + Math.cos(a) * r + (rand() - 0.5) * 14;
      const y = cy + Math.sin(a) * r + (rand() - 0.5) * 14;
      stampSoft(ctx, x, y, 5 + rand() * 8, `rgba(255, 196, 150, ${0.45 * arm.alpha})`);
    }
  }

  stampSoft(ctx, cx, cy, diskPx * 0.2, "rgba(255, 230, 190, 0.85)");
  stampSoft(ctx, cx, cy, diskPx * 0.1, "rgba(255, 244, 220, 0.9)");

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

function softPointMap(THREE) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, "rgba(255, 255, 255, 1)");
  glow.addColorStop(0.4, "rgba(255, 255, 255, 0.5)");
  glow.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 64, 64);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function eachMaterial(obj, fn) {
  const mat = obj.material;
  if (!mat) return;
  if (Array.isArray(mat)) mat.forEach(fn);
  else fn(mat);
}

function unlitBasic(THREE, params) {
  return new THREE.MeshBasicMaterial({
    depthWrite: false,
    transparent: true,
    toneMapped: false,
    ...params,
  });
}

function unlitSprite(THREE, params) {
  return new THREE.SpriteMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    ...params,
  });
}

export function milkyWayDiskDiameter() {
  return MILKY_WAY.diskRadiusKpc * milkyWayUnitsPerKpc() * 2;
}

function addPoints(THREE, group, name, positions, colors, size, opacity, attenuation = true, blending) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      map: softPointMap(THREE),
      size,
      vertexColors: true,
      transparent: true,
      opacity,
      depthWrite: false,
      sizeAttenuation: attenuation,
      toneMapped: false,
      blending: blending ?? THREE.NormalBlending,
    }),
  );
  points.name = name;
  points.frustumCulled = false;
  group.add(points);
  return points;
}

function visualDiskHalfHeight() {
  return CONFIG.mwVisualHeightKpc * milkyWayUnitsPerKpc();
}

function createSpiralStars(THREE, group) {
  const count = 7800;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const rand = seedRandom(20260820);
  const diskR = MILKY_WAY.diskRadiusKpc;
  const pitch = 14 * DEG;
  const rInner = 2.4;
  const thetaSun = Math.log(SUN_GALACTIC.rKpc / rInner) / Math.tan(pitch);
  const beta0 = -thetaSun;
  const arms = [beta0, beta0 + Math.PI, beta0 + 1.55, beta0 + Math.PI + 1.55];
  const thinH = MILKY_WAY.heightKpc;
  const thickH = MILKY_WAY.thickHeightKpc;
  const visualH = CONFIG.mwVisualHeightKpc;
  let n = 0;
  for (let i = 0; i < count * 2 && n < count; i += 1) {
    const arm = arms[Math.floor(rand() * 4)];
    const t = rand() ** 0.7;
    const theta = t * 1.28 * Math.PI * 2;
    const radius = rInner * Math.exp(theta * Math.tan(pitch)) + (rand() - 0.5) * (0.7 + t * 1.4);
    if (radius < 1.6 || radius > diskR) continue;
    const beta = (arm + theta) / DEG;
    const thick = rand() < 0.28;
    const scaleH = thick ? Math.max(thickH, visualH * 0.72) : Math.max(thinH * 2.2, visualH * 0.42);
    const height = (rand() + rand() - 1) * scaleH;
    const at = armPointKpc(radius, beta, height);
    const scene = milkyWayToScene(at.x, at.y, at.z);
    const o = n * 3;
    positions[o] = scene.x;
    positions[o + 1] = scene.y;
    positions[o + 2] = scene.z;
    const warm = clamp(1 - radius / diskR, 0, 1);
    colors[o] = 0.7 + 0.25 * warm;
    colors[o + 1] = 0.78 + 0.12 * warm;
    colors[o + 2] = 0.95 - 0.2 * warm;
    n += 1;
  }
  addPoints(THREE, group, "mw-disk", positions.slice(0, n * 3), colors.slice(0, n * 3), 2.8, 0.72, true, THREE.AdditiveBlending);
}

function createHalo(THREE, group) {
  const count = 2800;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const rand = seedRandom(88421);
  const gc = galacticCenterScenePosition();
  const s = milkyWayUnitsPerKpc();
  const haloR = Math.max(MILKY_WAY.haloRadiusKpc, CONFIG.mwHaloRadiusKpc) * s;
  for (let i = 0; i < count; i += 1) {
    const r = haloR * (0.18 + 0.82 * (rand() ** 0.55));
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    positions[i * 3] = gc.x + r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = gc.y + r * Math.cos(phi) * 0.62;
    positions[i * 3 + 2] = gc.z + r * Math.sin(phi) * Math.sin(theta);
    colors[i * 3] = 0.72 + rand() * 0.12;
    colors[i * 3 + 1] = 0.78 + rand() * 0.1;
    colors[i * 3 + 2] = 0.95;
  }
  addPoints(THREE, group, "mw-halo", positions, colors, 3.6, 0.62, true, THREE.AdditiveBlending);
}

function createBulge(THREE, group) {
  const count = 1600;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const rand = seedRandom(11973);
  const gc = galacticCenterScenePosition();
  const s = milkyWayUnitsPerKpc();
  const bulgeR = MILKY_WAY.bulgeRadiusKpc * s;
  for (let i = 0; i < count; i += 1) {
    const u = rand();
    const r = bulgeR * (u ** 0.5);
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    positions[i * 3] = gc.x + r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = gc.y + r * Math.cos(phi) * 0.86;
    positions[i * 3 + 2] = gc.z + r * Math.sin(phi) * Math.sin(theta);
    colors[i * 3] = 1;
    colors[i * 3 + 1] = 0.78 + 0.12 * rand();
    colors[i * 3 + 2] = 0.45 + 0.1 * rand();
  }
  addPoints(THREE, group, "mw-bulge", positions, colors, 4.2, 0.92, true, THREE.AdditiveBlending);

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(bulgeR * 0.92, 24, 16),
    unlitBasic(THREE, {
      map: diskGlowMap(THREE),
      color: 0xffe2b4,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
    }),
  );
  mesh.position.set(gc.x, gc.y, gc.z);
  mesh.scale.set(1.05, 0.88, 1.05);
  mesh.name = "mw-bulge-body";
  group.add(mesh);
}

function createDiskGlow(THREE, group) {
  const gc = galacticCenterScenePosition();
  const radius = MILKY_WAY.diskRadiusKpc * milkyWayUnitsPerKpc();
  const halfH = visualDiskHalfHeight();
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.12, 40, 24),
    unlitBasic(THREE, {
      color: 0xffe2c4,
      opacity: 0.24,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  glow.position.set(gc.x, gc.y, gc.z);
  glow.scale.set(1, clamp((halfH * 4.2) / radius, 0.22, 0.42), 1);
  glow.name = "mw-glow";
  group.add(glow);

  const edge = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.98, 48, 20),
    unlitBasic(THREE, {
      color: 0xd0dcff,
      opacity: 0.2,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  edge.position.set(gc.x, gc.y, gc.z);
  edge.scale.set(1, clamp((halfH * 2.6) / radius, 0.14, 0.28), 1);
  edge.name = "mw-disk-edge";
  group.add(edge);

  const disk = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    unlitBasic(THREE, {
      map: milkyWayDiskMap(THREE),
      opacity: 1,
      side: THREE.DoubleSide,
    }),
  );
  disk.rotation.x = -Math.PI / 2;
  disk.position.set(gc.x, gc.y, gc.z);
  disk.name = "mw-spiral";
  group.add(disk);
}

function createSunPin(THREE, group) {
  const pin = new THREE.Sprite(unlitSprite(THREE, {
    map: pinSprite(THREE),
    color: 0xffffff,
    blending: THREE.AdditiveBlending,
  }));
  pin.scale.set(42, 42, 1);
  pin.name = "sun-pin";
  pin.position.set(0, 0, 0);
  pin.frustumCulled = false;
  group.add(pin);
  group.add(labelSprite(THREE, "Sun", { x: 0, y: visualDiskHalfHeight() + 56, z: 0 }, 0.86));
}

function neighborSpriteSize(neighbor) {
  const visual = visualNeighborhood(neighbor.distanceKpc);
  const size = (neighbor.radiusKpc / neighbor.distanceKpc) * visual * 2.2;
  return Math.max(160, size);
}

function neighborSizeBoost(neighbor) {
  if (neighbor.id === "m31") return 1.55;
  if (neighbor.id === "lmc") return 1.85;
  if (neighbor.id === "smc") return 1.7;
  return 1.2;
}

export function neighborApparentSize(neighbor) {
  return neighborSpriteSize(neighbor) * neighborSizeBoost(neighbor);
}

function quietAndromedaMap(THREE) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.translate(128, 128);
  ctx.rotate(-0.32);
  ctx.scale(1, 0.38);
  const disk = ctx.createRadialGradient(0, 0, 6, 0, 0, 118);
  disk.addColorStop(0, "rgba(255, 228, 190, 0.95)");
  disk.addColorStop(0.18, "rgba(210, 180, 150, 0.45)");
  disk.addColorStop(0.55, "rgba(120, 140, 200, 0.22)");
  disk.addColorStop(1, "rgba(40, 50, 80, 0)");
  ctx.fillStyle = disk;
  ctx.beginPath();
  ctx.arc(0, 0, 118, 0, Math.PI * 2);
  ctx.fill();
  const bulge = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
  bulge.addColorStop(0, "rgba(255, 236, 200, 0.95)");
  bulge.addColorStop(1, "rgba(255, 180, 90, 0)");
  ctx.fillStyle = bulge;
  ctx.beginPath();
  ctx.arc(0, 0, 26, 0, Math.PI * 2);
  ctx.fill();
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function createNeighbors(THREE, group, maps) {
  const cluster = new THREE.Group();
  cluster.name = "neighbors";
  for (const neighbor of NEIGHBORS) {
    const at = neighborScenePosition(neighbor);
    const map = neighbor.id === "m31"
      ? quietAndromedaMap(THREE)
      : maps[galaxyKind(neighbor.id)] ?? maps.spiral;
    const sprite = new THREE.Sprite(unlitSprite(THREE, {
      map,
      color: neighbor.id === "m31" ? 0xf4f0ea : 0xffffff,
      depthTest: neighbor.id !== "m31",
      opacity: 0.96,
    }));
    sprite.renderOrder = 4;
    sprite.position.set(at.x, at.y, at.z);
    const size = neighborApparentSize(neighbor);
    const aspect = neighbor.id === "m31" ? 0.36 : neighbor.id === "m33" ? 0.46 : 0.68;
    sprite.scale.set(size, size * aspect, 1);
    sprite.name = neighbor.id;
    sprite.frustumCulled = false;
    cluster.add(sprite);
    if (neighbor.id === "m31") {
      new THREE.TextureLoader().load(SKY_ASSETS.andromeda, (loaded) => {
        loaded.colorSpace = THREE.SRGBColorSpace;
        loaded.anisotropy = 4;
        sprite.material.map = loaded;
        sprite.material.needsUpdate = true;
      });
    }
    const label = neighbor.messier ? `${neighbor.name} (${neighbor.messier})` : neighbor.name;
    const lift = size * aspect * 0.65 + 48;
    const side = neighbor.id === "smc" ? 180 : neighbor.id === "lmc" ? -80 : 0;
    const labelScale = neighbor.id === "lmc" || neighbor.id === "smc" ? 2.35 : 2.6;
    cluster.add(labelSprite(THREE, label, { x: at.x + side, y: at.y + lift, z: at.z }, labelScale));
  }
  group.add(cluster);
}

function memberSpriteSize(member) {
  const visual = visualNeighborhood(member.distanceKpc);
  const size = (member.radiusKpc / member.distanceKpc) * visual * 3.4;
  return Math.max(90, Math.min(220, size));
}

function createLocalGroupMembers(THREE, group, maps) {
  const family = new THREE.Group();
  family.name = "local-group";
  for (const member of LOCAL_GROUP) {
    const at = neighborScenePosition(member);
    const kind = galaxyKind(member.id);
    const sprite = new THREE.Sprite(unlitSprite(THREE, {
      map: maps[kind] ?? maps.irregular,
      color: 0xf2f4ff,
      opacity: 0.9,
    }));
    sprite.position.set(at.x, at.y, at.z);
    const size = memberSpriteSize(member);
    const aspect = kind === "elliptical" ? 0.78 : 0.64;
    sprite.scale.set(size, size * aspect, 1);
    sprite.name = member.id;
    sprite.frustumCulled = false;
    family.add(sprite);
    const lift = size * 0.85 + 48;
    const side = member.id === "m32" ? -110 : member.id === "ngc205" ? 120 : 0;
    family.add(labelSprite(
      THREE,
      member.name,
      { x: at.x + side, y: at.y + lift, z: at.z },
      2.8,
    ));
  }
  group.add(family);
}

function createLocalGroupFamily(THREE, group, maps) {
  const family = new THREE.Group();
  family.name = "local-group-family";
  const members = [
    { map: maps.spiral, x: -520, z: 180, size: 1680, aspect: 0.46, color: 0xffe8c8 },
    { map: maps.spiral, x: 720, z: -260, size: 2140, aspect: 0.4, color: 0xf4f0ea },
    { map: maps.lmc, x: -220, z: 620, size: 820, aspect: 0.62, color: 0xffd0a0 },
    { map: maps.irregular, x: 340, z: -680, size: 640, aspect: 0.6, color: 0xe8d4c0 },
  ];
  for (const item of members) {
    const sprite = new THREE.Sprite(unlitSprite(THREE, {
      map: item.map,
      color: item.color,
      opacity: 0.92,
    }));
    sprite.position.set(item.x, 0, item.z);
    sprite.scale.set(item.size, item.size * item.aspect, 1);
    sprite.frustumCulled = false;
    family.add(sprite);
  }
  family.add(labelSprite(THREE, "Local Group", { x: 0, y: 1180, z: 0 }, 6.4));
  group.add(family);
}

function createNearClusters(THREE, group, maps) {
  const field = new THREE.Group();
  field.name = "near-clusters";
  const virgo = virgoScenePosition();
  const mark = visualVirgo(CONFIG.virgoMarkRadiusMpc * 1000);
  const rand = seedRandom(16501);
  const hubs = [{ x: 0, y: 0, z: 0, home: true }, { ...virgo, home: false }];
  const extras = [
    { t: 0.16, ox: 0.04, oy: -0.03, oz: 0.05 },
    { t: 0.24, ox: -0.06, oy: 0.05, oz: -0.04 },
    { t: 0.32, ox: 0.07, oy: 0.04, oz: 0.06 },
    { t: 0.4, ox: -0.05, oy: -0.06, oz: 0.03 },
    { t: 0.48, ox: 0.08, oy: 0.03, oz: -0.07 },
    { t: 0.56, ox: -0.07, oy: 0.06, oz: 0.04 },
    { t: 0.64, ox: 0.05, oy: -0.05, oz: -0.05 },
    { t: 0.72, ox: -0.08, oy: 0.04, oz: 0.06 },
    { t: 0.8, ox: 0.06, oy: -0.04, oz: -0.04 },
    { t: 0.88, ox: -0.04, oy: 0.05, oz: 0.03 },
    { t: 0.36, ox: 0.16, oy: -0.08, oz: 0.12 },
    { t: 0.52, ox: -0.15, oy: 0.1, oz: -0.11 },
    { t: 0.68, ox: 0.14, oy: 0.09, oz: 0.1 },
    { t: 1.08, ox: 0.1, oy: 0.06, oz: -0.12 },
  ];
  for (const extra of extras) {
    hubs.push({
      x: virgo.x * extra.t + extra.ox * mark * 0.7,
      y: virgo.y * extra.t + extra.oy * mark * 0.7,
      z: virgo.z * extra.t + extra.oz * mark * 0.7,
      home: false,
    });
  }

  const kinds = ["elliptical", "spiral", "spiral", "irregular"];
  for (let h = 2; h < hubs.length; h += 1) {
    const hub = hubs[h];
    const members = 18 + Math.floor(rand() * 16);
    const spread = mark * (0.1 + rand() * 0.08);
    for (let i = 0; i < members; i += 1) {
      const kind = kinds[Math.floor(rand() * kinds.length)];
      const size = 560 + rand() * 820;
      const sprite = new THREE.Sprite(unlitSprite(THREE, {
        map: maps[kind],
        color: kind === "elliptical" ? 0xffe6c4 : 0xe8f0ff,
        opacity: 0.86,
        rotation: rand() * Math.PI,
      }));
      sprite.position.set(
        hub.x + (rand() - 0.5) * spread,
        hub.y + (rand() - 0.5) * spread * 0.55,
        hub.z + (rand() - 0.5) * spread,
      );
      sprite.scale.set(size, size * (kind === "elliptical" ? 0.78 : 0.48), 1);
      sprite.frustumCulled = false;
      field.add(sprite);
    }
  }

  group.add(field);
}

function createVirgoCluster(THREE, group, maps) {
  const cluster = new THREE.Group();
  cluster.name = "virgo";
  const at = virgoScenePosition();
  const mark = visualVirgo(CONFIG.virgoMarkRadiusMpc * 1000);
  const glow = new THREE.Sprite(unlitSprite(THREE, {
    map: diskGlowMap(THREE),
    color: 0xc8d8ff,
    opacity: 0.55,
  }));
  glow.position.set(at.x, at.y, at.z);
  glow.scale.set(mark * 1.85, mark * 1.25, 1);
  glow.name = "virgo-glow";
  glow.frustumCulled = false;
  cluster.add(glow);

  const kinds = ["elliptical", "spiral", "spiral", "elliptical", "irregular"];
  const rand = seedRandom(16500);
  const count = 58;
  for (let i = 0; i < count; i += 1) {
    const core = i < 28;
    const sub = i >= 28 && i < 42;
    let ox;
    let oy;
    let oz;
    if (core) {
      const r = mark * 0.42 * (rand() ** 1.35);
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      ox = r * Math.sin(phi) * Math.cos(theta);
      oy = r * Math.cos(phi) * 0.38;
      oz = r * Math.sin(phi) * Math.sin(theta) * 0.7;
    } else if (sub) {
      const r = mark * 0.28 * (rand() ** 1.1);
      const theta = rand() * Math.PI * 2;
      ox = mark * 0.62 + r * Math.cos(theta);
      oy = -mark * 0.12 + (rand() - 0.5) * mark * 0.18;
      oz = -mark * 0.22 + r * Math.sin(theta) * 0.65;
    } else {
      const r = mark * (0.45 + 0.7 * rand() ** 0.8);
      const theta = rand() * Math.PI * 2;
      ox = r * Math.cos(theta);
      oy = (rand() - 0.5) * mark * 0.22;
      oz = r * Math.sin(theta) * 0.58;
    }
    const kind = i === 0 ? "elliptical" : kinds[Math.floor(rand() * kinds.length)];
    const size = i === 0 ? 1480 : 420 + rand() * 640;
    const sprite = new THREE.Sprite(unlitSprite(THREE, {
      map: maps[kind],
      color: kind === "elliptical" ? 0xffe6c4 : 0xe8f0ff,
      opacity: 0.9,
      rotation: rand() * Math.PI,
    }));
    sprite.position.set(at.x + ox, at.y + oy, at.z + oz);
    sprite.scale.set(size, size * (kind === "elliptical" ? 0.78 : 0.48), 1);
    sprite.frustumCulled = false;
    cluster.add(sprite);
  }
  cluster.add(labelSprite(
    THREE,
    "Virgo Cluster",
    { x: at.x, y: at.y + mark * 0.82, z: at.z },
    6.8,
  ));
  group.add(cluster);
}

function addHub(THREE, group, at, size, map, name) {
  const sprite = new THREE.Sprite(unlitSprite(THREE, {
    map,
    color: 0xffffff,
    blending: THREE.AdditiveBlending,
    opacity: 0.92,
  }));
  sprite.position.set(at.x, at.y, at.z);
  sprite.scale.set(size, size, 1);
  sprite.name = name;
  sprite.frustumCulled = false;
  group.add(sprite);
}

function pushFilament(positions, colors, a, b, count, rand, warm = 0, scatterScale = 1) {
  const span = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const mid = {
    x: (a.x + b.x) * 0.5 + (rand() - 0.5) * span * 0.18,
    y: (a.y + b.y) * 0.5 + (rand() - 0.5) * span * 0.14,
    z: (a.z + b.z) * 0.5 + (rand() - 0.5) * span * 0.18,
  };
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    const omt = 1 - t;
    const x = omt * omt * a.x + 2 * omt * t * mid.x + t * t * b.x;
    const y = omt * omt * a.y + 2 * omt * t * mid.y + t * t * b.y;
    const z = omt * omt * a.z + 2 * omt * t * mid.z + t * t * b.z;
    const scatter = (0.8 + Math.sin(t * Math.PI) * 1.6) * (140 + rand() * 260) * scatterScale;
    const puffs = 5;
    for (let p = 0; p < puffs; p += 1) {
      positions.push(
        x + (rand() - 0.5) * scatter,
        y + (rand() - 0.5) * scatter * 0.9,
        z + (rand() - 0.5) * scatter,
      );
      const dense = Math.sin(t * Math.PI);
      const heat = clamp(0.08 + warm * 0.62 + dense * 0.58 * (0.5 + rand() * 0.5), 0, 1);
      colors.push(0.28 + 0.72 * heat, 0.18 + 0.42 * heat, 0.22 + 0.55 * (1 - heat));
    }
  }
}

function addFieldGalaxies(THREE, group, name, radius, count, seed) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const rand = seedRandom(seed);
  for (let i = 0; i < count; i += 1) {
    const r = radius * (0.08 + 0.92 * (rand() ** 0.7));
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi) * 0.88;
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const warm = rand();
    colors[i * 3] = 0.55 + 0.35 * warm;
    colors[i * 3 + 1] = 0.62 + 0.22 * warm;
    colors[i * 3 + 2] = 0.78 + 0.22 * (1 - warm);
  }
  addPoints(THREE, group, `${name}-px`, positions, colors, 3.4, 0.62, false, THREE.AdditiveBlending);
  addPoints(THREE, group, name, positions, colors, 220, 0.48, true, THREE.AdditiveBlending);
}

function createWebVolume(THREE, group, {
  name,
  radius,
  hubCount,
  seed,
  hubSize,
  particleSize,
  includeVirgo,
  fieldCount,
}) {
  const web = new THREE.Group();
  web.name = name;
  const rand = seedRandom(seed);
  const hubMap = hubSprite(THREE);
  const hubs = [{ x: 0, y: 0, z: 0, home: true }];
  if (includeVirgo) {
    const virgo = webHubScenePosition({
      lDeg: VIRGO_CLUSTER.lDeg,
      bDeg: VIRGO_CLUSTER.bDeg,
      distanceMpc: VIRGO_CLUSTER.distanceMpc,
    });
    hubs.push({ ...virgo, home: false });
  }
  let guard = 0;
  while (hubs.length < hubCount && guard < hubCount * 24) {
    guard += 1;
    const u = rand();
    const r = radius * (0.16 + 0.84 * (u ** 0.62));
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    const at = {
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.cos(phi) * 0.88,
      z: r * Math.sin(phi) * Math.sin(theta),
      home: false,
    };
    if (hubs.some((hub) => Math.hypot(hub.x - at.x, hub.y - at.y, hub.z - at.z) < radius * 0.052)) {
      continue;
    }
    hubs.push(at);
  }

  const positions = [];
  const colors = [];
  for (let i = 0; i < hubs.length; i += 1) {
    const others = hubs
      .map((hub, j) => ({ hub, j, d: Math.hypot(hub.x - hubs[i].x, hub.y - hubs[i].y, hub.z - hubs[i].z) }))
      .filter((row) => row.j !== i)
      .sort((a, b) => a.d - b.d);
    const links = hubs[i].home ? 10 : 6;
    for (let k = 0; k < Math.min(links, others.length); k += 1) {
      if (others[k].j < i && !hubs[i].home) continue;
      pushFilament(positions, colors, hubs[i], others[k].hub, 80, rand, hubs[i].home ? 0.35 : 0, 1.55);
    }
  }

  addPoints(
    THREE,
    web,
    `${name}-filaments`,
    new Float32Array(positions),
    new Float32Array(colors),
    particleSize,
    0.86,
    true,
  );
  addPoints(
    THREE,
    web,
    `${name}-dust`,
    new Float32Array(positions),
    new Float32Array(colors),
    particleSize * 2.6,
    0.28,
    true,
    THREE.AdditiveBlending,
  );
  addFieldGalaxies(THREE, web, `${name}-field`, radius, fieldCount, seed + 17);

  for (let i = 0; i < hubs.length; i += 1) {
    const hub = hubs[i];
    const size = hub.home ? hubSize * 1.15 : hubSize * (0.28 + rand() * 0.4);
    addHub(THREE, web, hub, size, hubMap, hub.home ? `${name}-home` : `${name}-hub-${i}`);
  }
  group.add(web);
  return web;
}

function createLocalWeb(THREE, group) {
  const radius = visualWeb(CONFIG.webRadiusMpc);
  createWebVolume(THREE, group, {
    name: "cosmic-web",
    radius,
    hubCount: 168,
    seed: 88421,
    hubSize: 7200,
    particleSize: 720,
    includeVirgo: true,
    fieldCount: 16000,
  });
}

function createHomeMark(THREE, group) {
  const mark = new THREE.Group();
  mark.name = "home-mark";
  const glow = new THREE.Sprite(unlitSprite(THREE, {
    map: diskGlowMap(THREE),
    color: 0xc4dcff,
    opacity: 0.5,
  }));
  const home = visualWeb(CONFIG.laniakeaMarkRadiusMpc);
  glow.scale.set(home * 1.8, home * 1.15, 1);
  glow.position.set(0, 0, 0);
  glow.name = "mw-home-glow";
  glow.frustumCulled = false;
  mark.add(glow);
  const pin = new THREE.Sprite(unlitSprite(THREE, {
    map: pinSprite(THREE),
    color: 0xffffff,
    blending: THREE.AdditiveBlending,
    opacity: 0.95,
  }));
  pin.scale.set(640, 640, 1);
  pin.name = "mw-home-pin";
  pin.position.set(0, 0, 0);
  pin.frustumCulled = false;
  mark.add(pin);
  mark.add(labelSprite(THREE, "Milky Way", { x: 0, y: home * 0.32, z: 0 }, 7.2));
  group.add(mark);
}

function createUniverseWeb(THREE, group) {
  const shell = new THREE.Group();
  shell.name = "universe";
  const radius = visualUniverse(CMB_SHELL.comovingRadiusGpc);
  createWebVolume(THREE, shell, {
    name: "universe-web",
    radius: radius * 0.82,
    hubCount: 220,
    seed: 2018,
    hubSize: 9600,
    particleSize: 860,
    includeVirgo: false,
    fieldCount: 22000,
  });
  group.add(shell);
}

function createCmbShell(THREE, group) {
  const shell = new THREE.Group();
  shell.name = "cmb-shell";
  const radius = visualUniverse(CMB_SHELL.comovingRadiusGpc);
  const cmb = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 96, 64),
    unlitBasic(THREE, {
      map: loadMap(THREE, CMB_SHELL.map),
      opacity: 0.88,
      side: THREE.DoubleSide,
    }),
  );
  cmb.name = "cmb-sphere";
  cmb.frustumCulled = false;
  shell.add(cmb);
  group.add(shell);
}

function paintSkyFace(size, seed) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#02050c";
  ctx.fillRect(0, 0, size, size);
  const rand = seedRandom(seed);
  for (let i = 0; i < 5200; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const warm = rand();
    stampSoft(
      ctx,
      x,
      y,
      1.1 + rand() * 2.8,
      `rgba(${Math.floor(160 + 90 * warm)}, ${Math.floor(170 + 55 * warm)}, ${Math.floor(215 - 35 * warm)}, ${0.32 + rand() * 0.48})`,
    );
  }
  for (let i = 0; i < 360; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rand() * Math.PI);
    ctx.scale(1, 0.32 + rand() * 0.28);
    stampSoft(ctx, 0, 0, 5 + rand() * 8, "rgba(220, 200, 170, 0.42)");
    ctx.restore();
  }
  return canvas;
}

function createFarGalaxySky(THREE, group) {
  const sky = new THREE.Group();
  sky.name = "far-galaxy-sky";
  const radius = visualUniverse(CMB_SHELL.comovingRadiusGpc);
  const cube = new THREE.CubeTexture([0, 1, 2, 3, 4, 5].map((face) => paintSkyFace(768, 8100 + face * 131)));
  cube.colorSpace = THREE.SRGBColorSpace;
  cube.needsUpdate = true;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tCube: { value: cube },
      opacity: { value: 0.88 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform samplerCube tCube;
      uniform float opacity;
      varying vec3 vDir;
      void main() {
        vec4 tex = texture(tCube, normalize(vDir));
        gl_FragColor = vec4(tex.rgb, tex.a * opacity);
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  material.opacity = 0.88;
  material.userData.keepOpacity = 0.88;
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 64), material);
  sphere.name = "far-galaxy-shell";
  sphere.frustumCulled = false;
  sky.add(sphere);
  const count = 3600;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const rand = seedRandom(31415);
  for (let i = 0; i < count; i += 1) {
    const r = radius * (0.78 + rand() * 0.2);
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const warm = rand();
    colors[i * 3] = 0.68 + 0.28 * warm;
    colors[i * 3 + 1] = 0.72 + 0.18 * warm;
    colors[i * 3 + 2] = 0.92 - 0.18 * warm;
  }
  addPoints(THREE, sky, "far-galaxy-points", positions, colors, 3.6, 0.7, false, THREE.AdditiveBlending);
  addPoints(THREE, sky, "far-galaxy-glow", positions, colors, 48, 0.28, true, THREE.AdditiveBlending);
  group.add(sky);
}

export function createGalaxyLayer(THREE) {
  const group = new THREE.Group();
  group.name = "galaxy-layer";
  group.visible = false;
  const maps = {
    spiral: galaxySprite(THREE, "spiral", 1),
    elliptical: galaxySprite(THREE, "elliptical", 2),
    irregular: galaxySprite(THREE, "irregular", 3),
    lmc: galaxySprite(THREE, "lmc", 4),
    smc: galaxySprite(THREE, "smc", 5),
  };
  createFarGalaxySky(THREE, group);
  const milkyway = new THREE.Group();
  milkyway.name = "milkyway";
  createDiskGlow(THREE, milkyway);
  createSpiralStars(THREE, milkyway);
  createHalo(THREE, milkyway);
  createBulge(THREE, milkyway);
  createSunPin(THREE, milkyway);
  group.add(milkyway);
  createNeighbors(THREE, group, maps);
  createLocalGroupMembers(THREE, group, maps);
  createLocalGroupFamily(THREE, group, maps);
  createNearClusters(THREE, group, maps);
  createVirgoCluster(THREE, group, maps);
  createLocalWeb(THREE, group);
  createHomeMark(THREE, group);
  createUniverseWeb(THREE, group);
  createCmbShell(THREE, group);
  return group;
}

function fadeNamedGroup(root, name, opacity, shown) {
  const node = root.getObjectByName(name);
  if (!node) return;
  node.visible = shown > 0.04 && opacity > 0.02;
  node.traverse((obj) => {
    eachMaterial(obj, (mat) => {
      if (mat.opacity == null || mat.userData.keepOpacity == null) return;
      mat.opacity = mat.userData.keepOpacity * opacity * shown;
      if (mat.uniforms?.opacity) mat.uniforms.opacity.value = mat.opacity;
    });
  });
}

export function setGalaxyLayerVisible(group, opacity, distance = CONFIG.mwViewDistance) {
  if (!group) return;
  group.visible = opacity > 0.02;
  group.traverse((obj) => {
    eachMaterial(obj, (mat) => {
      if (mat.opacity == null) return;
      if (mat.userData.keepOpacity == null) mat.userData.keepOpacity = mat.opacity;
      mat.transparent = true;
      mat.opacity = mat.userData.keepOpacity * opacity;
      if (mat.uniforms?.opacity) mat.uniforms.opacity.value = mat.opacity;
    });
  });
  const cluster = virgoOpacity(distance);
  const near = nearClusterOpacity(distance);
  const web = webOpacity(distance);
  const universe = universeOpacity(distance);
  const family = 1 - cluster * 0.92;
  const virgoShown = cluster * (1 - web);
  fadeNamedGroup(group, "far-galaxy-sky", opacity, farGalaxySkyOpacity(distance));
  fadeNamedGroup(group, "milkyway", opacity, family);
  fadeNamedGroup(group, "neighbors", opacity, neighborOpacity(distance) * family);
  fadeNamedGroup(group, "local-group", opacity, localGroupMemberOpacity(distance) * family);
  fadeNamedGroup(group, "local-group-family", opacity, virgoShown);
  fadeNamedGroup(group, "near-clusters", opacity, near);
  fadeNamedGroup(group, "virgo", opacity, virgoShown);
  fadeNamedGroup(group, "cosmic-web", opacity, Math.max(web, universe * 0.85));
  fadeNamedGroup(group, "home-mark", opacity, Math.max(web, universe));
  fadeNamedGroup(group, "universe", opacity, universe);
  fadeNamedGroup(group, "cmb-shell", opacity, cmbSkyOpacity(distance));
}
