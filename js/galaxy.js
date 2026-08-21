/**
 * Extra-zoom map: a luminous 3D Milky Way, then catalog neighbors
 * (Andromeda, Local Group, Virgo) against a distant galaxy-image sky.
 * That sky starts in the tail and stays through Virgo. After Virgo,
 * other clusters approach at cluster distances, then become the
 * volume-filling cosmic web already here, then the CMB /
 * observable-universe sphere. The web look is that filled volume. The
 * last universe look is the outside sphere. They do not mix.
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
  LOCAL_GROUP,
  MILKY_WAY,
  NEIGHBORS,
  OBSERVABLE_UNIVERSE,
  SUN_GALACTIC,
  VIRGO_CLUSTER,
} from "./galaxy-catalog.js";

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

/** Last stretch of the transition where solar sky and MW crossfade. */
function handoffBlendStart() {
  return CONFIG.solarMaxDistance
    + (CONFIG.handoffViewDistance - CONFIG.solarMaxDistance) * 0.7;
}

/** Gentle blend into the MW: fades in over the end of the transition. */
export function galaxyOpacity(distance) {
  const start = handoffBlendStart();
  if (distance < start) return 0;
  if (distance >= CONFIG.handoffViewDistance) return 1;
  return smoothstep01(
    (distance - start) / (CONFIG.handoffViewDistance - start),
  );
}

export function solarOpacity(distance) {
  return 1 - galaxyOpacity(distance);
}

/**
 * Asteroid / Kuiper debris fades out right after the solar cap, before
 * the MW crossfade begins, so on the trail the solar system reads as a
 * single tiny star among the arm — no ring, no dust halo.
 */
export function solarDebrisOpacity(distance) {
  if (distance <= CONFIG.solarMaxDistance) return 1;
  const end = handoffBlendStart();
  if (distance >= end) return 0;
  return 1 - smoothstep01(
    (distance - CONFIG.solarMaxDistance) / (end - CONFIG.solarMaxDistance),
  );
}

/** Hipparcos / IAU stay through the solar cap. Extra-zoom uses the galaxy-image sky. */
export function skyStaysOn(distance) {
  const layer = scaleLayer(distance);
  return layer === "solar" || layer === "transition";
}

/**
 * Local disk / arm glow rides the handoff crossfade: it is already
 * fading in while the solar sky fades out, so there is no black gap.
 */
export function milkyWayDiskOpacity(distance) {
  return galaxyOpacity(distance) > 0 ? 1 : 0;
}

/**
 * Hipparcos / IAU stay at full strength through the whole solar region,
 * then crossfade 1:1 with the galaxy layer. The sum never dips below 1,
 * so zooming out never shows an empty black sky.
 */
export function celestialSkyOpacity(distance) {
  return 1 - galaxyOpacity(distance);
}

/** Skybox brightness is constant at every zoom; extra-zoom turns it off. */
export function skyBandBrightness(distance) {
  return distance < CONFIG.handoffViewDistance ? 0.82 : 0;
}

/** Hipparcos size/gain stays 1 so the in-system sky never brightens. */
export function skyStarBrightness(distance) {
  return distance < CONFIG.handoffViewDistance ? 1 : 0;
}

/**
 * Extra-zoom only. In solar the orrery stays 1:1 with visualScale.
 * Past the solar cap it shrinks to a Sun pin before the MW disk dominates.
 * The shrink shares extraZoomCameraDistance's curve and finishes with it at
 * the crossfade start, and the pin stays at or under mwTailNearDistance /
 * solarMaxDistance, so the Sun dot's apparent size never grows while the
 * camera glides down to the arm: zoom-out always reads as zoom-out.
 */
export function orreryScale(distance) {
  if (distance <= CONFIG.solarMaxDistance) return 1;
  const pin = 0.018;
  const start = handoffBlendStart();
  if (distance >= CONFIG.handoffViewDistance) {
    const t = (distance - CONFIG.handoffViewDistance)
      / Math.max(1, CONFIG.galaxyFadeEnd - CONFIG.handoffViewDistance);
    return Math.max(0.01, pin * (1 - smoothstep01(t)));
  }
  if (distance >= start) return pin;
  const t = (distance - CONFIG.solarMaxDistance)
    / (start - CONFIG.solarMaxDistance);
  return 1 - (1 - pin) * smoothstep01(t ** 0.75);
}

/** Planet orbit rings are solar-only. Extra-zoom keeps Kuiper, not rings. */
export function orbitLineOpacity(distance) {
  return distance <= CONFIG.solarMaxDistance ? 1 : 0;
}

export function scaleLayer(distance) {
  if (distance <= CONFIG.solarMaxDistance) return "solar";
  if (distance < CONFIG.handoffViewDistance) return "transition";
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
  const start = CONFIG.handoffViewDistance
    + (CONFIG.mwViewDistance - CONFIG.handoffViewDistance) * 0.88;
  if (distance < start) return 0;
  if (distance >= CONFIG.mwViewDistance) return 1;
  return smoothstep01((distance - start) / (CONFIG.mwViewDistance - start));
}

/**
 * LMC / SMC are real companions of the disk: they ride with the MW from
 * the first trail frame instead of popping in at the neighborhood fade.
 * Their labels keep the neighbor-label timing.
 */
export function magellanicOpacity(distance) {
  return milkyWayDiskOpacity(distance);
}

/**
 * Small screen-fixed Sun badge on the MW trail. It rides the same
 * crossfade as the disk and yields once the Milky Way name and the
 * neighbor labels take over at the full-disk view.
 */
export function sunBadgeOpacity(distance) {
  return milkyWayDiskOpacity(distance) * (1 - neighborOpacity(distance));
}

/** The Milky Way name appears the same way the other named objects do. */
export function milkyWayNameOpacity(distance) {
  return neighborOpacity(distance);
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
    + (CONFIG.webViewDistance - CONFIG.virgoViewDistance) * 0.78;
  if (distance < start) return 0;
  if (distance >= CONFIG.webViewDistance) return 1;
  return smoothstep01((distance - start) / (CONFIG.webViewDistance - start));
}

/** Denser galaxy images after Virgo, before filaments. One owner. */
export function deepFieldOpacity(distance) {
  if (distance < CONFIG.virgoViewDistance) return 0;
  const span = CONFIG.webViewDistance - CONFIG.virgoViewDistance;
  const peak = CONFIG.virgoViewDistance + span * 0.62;
  if (distance < peak) {
    return smoothstep01((distance - CONFIG.virgoViewDistance) / (peak - CONFIG.virgoViewDistance));
  }
  return 1 - webOpacity(distance);
}

/** Volume-filling web is the web subject. CMB stays a later outside shell. */
export function universeOpacity(distance) {
  return webOpacity(distance);
}

/**
 * Distant galaxy-image sky starts in the tail and stays through Virgo
 * and the pre-web field. It is a far field, not nearby junk. It yields
 * to the existing web as the web fades in.
 */
export function farGalaxySkyOpacity(distance) {
  if (galaxyOpacity(distance) <= 0) return 0;
  return 1 - webOpacity(distance);
}

/** Microwave sky waits until after a long web, then becomes the outer shell. */
export function cmbSkyOpacity(distance) {
  const start = CONFIG.webViewDistance
    + (CONFIG.universeViewDistance - CONFIG.webViewDistance) * 0.72;
  if (distance <= start) return 0;
  if (distance >= CONFIG.universeViewDistance) return 1;
  return smoothstep01(
    (distance - start) / (CONFIG.universeViewDistance - start),
  );
}

export function nearClusterOpacity(distance) {
  if (distance < CONFIG.virgoViewDistance) return 0;
  const span = CONFIG.webViewDistance - CONFIG.virgoViewDistance;
  const ready = CONFIG.virgoViewDistance + span * 0.42;
  if (distance < ready) {
    return smoothstep01((distance - CONFIG.virgoViewDistance) / (ready - CONFIG.virgoViewDistance));
  }
  return 1 - webOpacity(distance);
}

export function requestedGalaxyLook() {
  if (typeof location === "undefined") return null;
  const look = new URLSearchParams(location.search).get("look");
  if (look === "cmb") return "universe";
  if (
    look === "solarfar"
    || look === "tailsky"
    || look === "growing"
    || look === "disk"
    || look === "milkyway"
    || look === "mwedge"
    || look === "mwbelow"
    || look === "handoff"
    || look === "mwinterior"
    || look === "neighborhood"
    || look === "localgroup"
    || look === "virgo"
    || look === "preweb"
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

/**
 * First extra-zoom frame: inside the disk, looking along the Orion Arm
 * (galactic +Y → scene −Z) so the ride is a crack / tail, not a plate.
 */
export function milkyWayInteriorCameraAim() {
  return { elevation: 0.08, azimuth: Math.PI };
}

/**
 * Extra-zoom near range. Slider distance still picks the layer; the
 * camera dives from the solar cap down to the arm seat while the MW is
 * still off and the only visible things are the camera-attached sky and
 * the shrinking Sun pin, so nothing on screen ever moves inward. The 1:1
 * sky ↔ MW crossfade then happens parked among the arm stars, and past
 * the handoff the pull-back to the full disk is strictly outward. This is
 * what keeps zoom monotonic: no invert, no bounce, in either direction.
 */
export function extraZoomCameraDistance(distance) {
  const near = CONFIG.mwTailNearDistance;
  if (distance <= CONFIG.solarMaxDistance) return distance;
  if (distance >= CONFIG.mwViewDistance) return distance;
  const start = handoffBlendStart();
  if (distance < start) {
    const t = (distance - CONFIG.solarMaxDistance)
      / (start - CONFIG.solarMaxDistance);
    const s = smoothstep01(t ** 0.75);
    return CONFIG.solarMaxDistance + (near - CONFIG.solarMaxDistance) * s;
  }
  if (distance < CONFIG.handoffViewDistance) return near;
  const t = (distance - CONFIG.handoffViewDistance)
    / (CONFIG.mwViewDistance - CONFIG.handoffViewDistance);
  return near + (CONFIG.mwViewDistance - near) * (t ** 1.55);
}

/** Near clip so nearby arm stars are not sliced off. Extra-zoom only. */
export function extraZoomCameraNear(distance) {
  return Math.max(0.05, extraZoomCameraDistance(distance) / 160);
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
  return neighborFamilyAim(0.22, -0.04);
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

/** Inside the filled web so filaments read as a volume, not an outside ball. */
export function webCameraAim() {
  return { elevation: 0.38, azimuth: 1.05 };
}

/** Outside the CMB shell so the observable sphere reads as a sphere. */
export function universeCameraAim() {
  return { elevation: 0.38, azimuth: 1.05 };
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

function brightenLoadedMap(THREE, texture, gain) {
  const image = texture.image;
  if (!image?.width) return texture;
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.min(255, data[i] * gain);
    data[i + 1] = Math.min(255, data[i + 1] * gain);
    data[i + 2] = Math.min(255, data[i + 2] * gain);
  }
  ctx.putImageData(pixels, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
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
  const cx = LABEL.canvasWidth / 2;
  const cy = LABEL.canvasHeight / 2;
  const tw = ctx.measureText(text).width;
  const padX = 36;
  const padY = 28;
  const x = cx - tw / 2 - padX;
  const y = cy - fontPx / 2 - padY;
  const w = tw + padX * 2;
  const h = fontPx + padY * 2;
  const r = 28;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = "rgba(2, 8, 18, 0.86)";
  ctx.fill();
  ctx.lineJoin = "round";
  ctx.lineWidth = 16;
  ctx.strokeStyle = "rgba(2, 5, 12, 1)";
  ctx.fillStyle = "rgba(255, 255, 255, 1)";
  ctx.strokeText(text, cx, cy);
  ctx.fillText(text, cx, cy);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

/**
 * One label system for the extra-zoom map. screenFixed keeps the badge a
 * constant on-screen size (the trail spans a 300× camera-radius range, so
 * a world-sized sprite cannot read across it); the scale is then a
 * viewport fraction instead of world units.
 */
function labelSprite(THREE, text, position, scale = 1, screenFixed = false) {
  const sprite = new THREE.Sprite(unlitSprite(THREE, {
    map: makeLabelMap(THREE, text),
    opacity: 1,
    depthTest: false,
    sizeAttenuation: !screenFixed,
  }));
  sprite.position.set(position.x, position.y, position.z);
  if (screenFixed) {
    sprite.scale.set(0.00056 * LABEL.scaleX * scale, 0.00056 * LABEL.scaleY * scale, 1);
  } else {
    sprite.scale.set(LABEL.scaleX * scale, LABEL.scaleY * scale, 1);
  }
  sprite.renderOrder = 20;
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
    disk.addColorStop(0, "rgba(255, 244, 210, 1)");
    disk.addColorStop(0.16, "rgba(255, 220, 170, 0.92)");
    disk.addColorStop(0.5, "rgba(170, 200, 255, 0.7)");
    disk.addColorStop(1, "rgba(80, 120, 220, 0)");
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
      ctx.strokeStyle = "rgba(200, 230, 255, 0.95)";
      ctx.lineWidth = 11;
      ctx.stroke();
      ctx.strokeStyle = "rgba(255, 236, 200, 0.7)";
      ctx.lineWidth = 5;
      ctx.stroke();
    }
    const bulge = ctx.createRadialGradient(0, 0, 2, 0, 0, 28);
    bulge.addColorStop(0, "rgba(255, 248, 230, 1)");
    bulge.addColorStop(1, "rgba(255, 200, 120, 0)");
    ctx.fillStyle = bulge;
    ctx.beginPath();
    ctx.arc(0, 0, 28, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "elliptical") {
    ctx.rotate(rand() * 0.8);
    ctx.scale(1, 0.68 + rand() * 0.1);
    const core = ctx.createRadialGradient(0, 0, 2, 0, 0, 110);
    core.addColorStop(0, "rgba(255, 246, 220, 1)");
    core.addColorStop(0.18, "rgba(255, 220, 170, 0.92)");
    core.addColorStop(0.55, "rgba(230, 190, 140, 0.5)");
    core.addColorStop(1, "rgba(120, 90, 60, 0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.ellipse(0, 0, 110, 90, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "lmc") {
    ctx.rotate(-0.35);
    ctx.scale(1, 0.62);
    const body = ctx.createRadialGradient(-10, 0, 8, 0, 0, 120);
    body.addColorStop(0, "rgba(255, 236, 200, 1)");
    body.addColorStop(0.35, "rgba(255, 200, 140, 0.85)");
    body.addColorStop(1, "rgba(160, 100, 70, 0)");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(0, 0, 118, 78, 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 220, 170, 0.85)";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.ellipse(8, 6, 70, 22, 0.4, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 8; i += 1) {
      const px = (rand() - 0.5) * 90;
      const py = (rand() - 0.5) * 60;
      const blob = ctx.createRadialGradient(px, py, 1, px, py, 16);
      blob.addColorStop(0, "rgba(255, 236, 200, 0.95)");
      blob.addColorStop(1, "rgba(255, 170, 110, 0)");
      ctx.fillStyle = blob;
      ctx.fillRect(px - 16, py - 16, 32, 32);
    }
  } else {
    ctx.scale(1, 0.7);
    for (let i = 0; i < 5; i += 1) {
      const px = (rand() - 0.5) * 70;
      const py = (rand() - 0.5) * 50;
      const rr = 40 + rand() * 50;
      const blob = ctx.createRadialGradient(px, py, 4, px, py, rr);
      blob.addColorStop(0, "rgba(255, 236, 200, 0.95)");
      blob.addColorStop(0.4, "rgba(255, 200, 150, 0.7)");
      blob.addColorStop(1, "rgba(160, 100, 70, 0)");
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
  const size = 2048;
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
  disk.addColorStop(0, "rgba(255, 226, 186, 0.38)");
  disk.addColorStop(0.1, "rgba(255, 196, 148, 0.16)");
  disk.addColorStop(0.28, "rgba(140, 160, 220, 0.07)");
  disk.addColorStop(0.58, "rgba(90, 120, 200, 0.02)");
  disk.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = disk;
  ctx.fillRect(0, 0, size, size);

  const arms = [
    { beta: beta0, turns: 1.32, alpha: 1, width: 1 },
    { beta: beta0 + Math.PI, turns: 1.32, alpha: 1, width: 1 },
    { beta: beta0 + 1.55, turns: 1.05, alpha: 0.55, width: 0.72 },
    { beta: beta0 + Math.PI + 1.55, turns: 1.05, alpha: 0.5, width: 0.68 },
  ];
  for (const arm of arms) {
    const stamps = Math.floor(520 * arm.alpha);
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
      stampSoft(ctx, x, y, 18 + t * 24, `rgba(170, 200, 255, ${0.52 * fade})`);
      stampSoft(ctx, x, y, 10 + t * 14, `rgba(255, 236, 210, ${0.66 * fade})`);
    }
    const clumps = arm.alpha > 0.8 ? 120 : 56;
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
    fog: false,
    ...params,
  });
}

function unlitSprite(THREE, params) {
  return new THREE.SpriteMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    fog: false,
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
  const count = 11000;
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
  addPoints(THREE, group, "mw-disk", positions.slice(0, n * 3), colors.slice(0, n * 3), 3.1, 0.82, true, THREE.AdditiveBlending);
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
    new THREE.SphereGeometry(radius * 1.08, 40, 24),
    unlitBasic(THREE, {
      map: diskGlowMap(THREE),
      color: 0xffe2c4,
      opacity: 0.12,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  glow.position.set(gc.x, gc.y, gc.z);
  glow.scale.set(1, clamp((halfH * 3.6) / radius, 0.2, 0.36), 1);
  glow.name = "mw-glow";
  group.add(glow);

  const edge = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.96, 48, 20),
    unlitBasic(THREE, {
      map: diskGlowMap(THREE),
      color: 0xd0dcff,
      opacity: 0.08,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  edge.position.set(gc.x, gc.y, gc.z);
  edge.scale.set(1, clamp((halfH * 2.2) / radius, 0.14, 0.24), 1);
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

function neighborSpriteSize(neighbor) {
  const visual = visualNeighborhood(neighbor.distanceKpc);
  const size = (neighbor.radiusKpc / neighbor.distanceKpc) * visual * 2.2;
  return Math.max(160, size);
}

function neighborSizeBoost(neighbor) {
  if (neighbor.id === "m31") return 3.05;
  if (neighbor.id === "lmc") return 2.85;
  if (neighbor.id === "smc") return 2.7;
  if (neighbor.id === "m33") return 3.15;
  return 2.1;
}

export function neighborApparentSize(neighbor) {
  return neighborSpriteSize(neighbor) * neighborSizeBoost(neighbor);
}

// Later issue: M31 still reads as a dwarf beside its label. Do not invent a model here.
function quietAndromedaMap(THREE) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.translate(128, 128);
  ctx.rotate(-0.38);
  ctx.scale(1, 0.42);
  const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, 122);
  halo.addColorStop(0, "rgba(255, 248, 220, 1)");
  halo.addColorStop(0.12, "rgba(255, 220, 160, 1)");
  halo.addColorStop(0.34, "rgba(220, 190, 255, 0.88)");
  halo.addColorStop(0.62, "rgba(160, 190, 255, 0.62)");
  halo.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, 122, 0, Math.PI * 2);
  ctx.fill();
  stampSoft(ctx, -22, -6, 48, "rgba(28, 16, 12, 0.45)");
  stampSoft(ctx, 26, 8, 40, "rgba(24, 14, 10, 0.35)");
  const bulge = ctx.createRadialGradient(0, 0, 1, 0, 0, 36);
  bulge.addColorStop(0, "rgba(255, 248, 220, 1)");
  bulge.addColorStop(0.4, "rgba(255, 210, 140, 0.95)");
  bulge.addColorStop(1, "rgba(255, 160, 80, 0)");
  ctx.fillStyle = bulge;
  ctx.beginPath();
  ctx.arc(0, 0, 36, 0, Math.PI * 2);
  ctx.fill();
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function createNeighbors(THREE, group, maps) {
  const cluster = new THREE.Group();
  cluster.name = "neighbors";
  // LMC / SMC bodies live in their own group so they can ride with the
  // disk from the first trail frame (magellanicOpacity) instead of
  // popping in with the M31 / M33 fade. Labels stay on the neighbor fade.
  const magellanic = new THREE.Group();
  magellanic.name = "magellanic";
  for (const neighbor of NEIGHBORS) {
    const home = neighbor.id === "lmc" || neighbor.id === "smc" ? magellanic : cluster;
    const at = neighborScenePosition(neighbor);
    const map = neighbor.id === "m31"
      ? quietAndromedaMap(THREE)
      : maps[galaxyKind(neighbor.id)] ?? maps.spiral;
    const size = neighborApparentSize(neighbor);
    const aspect = neighbor.id === "m31" ? 0.4 : neighbor.id === "m33" ? 0.46 : 0.68;
    const glow = new THREE.Sprite(unlitSprite(THREE, {
      map: diskGlowMap(THREE),
      color: 0xfff1d2,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthTest: false,
    }));
    glow.position.set(at.x, at.y, at.z);
    glow.scale.set(size * 1.7, size * aspect * 1.7, 1);
    glow.renderOrder = 3;
    glow.frustumCulled = false;
    home.add(glow);
    const sprite = new THREE.Sprite(unlitSprite(THREE, {
      map,
      color: 0xfff8ee,
      depthTest: neighbor.id !== "m31",
      opacity: 1,
      blending: THREE.AdditiveBlending,
    }));
    sprite.renderOrder = neighbor.id === "m31" ? 6 : 4;
    sprite.position.set(at.x, at.y, at.z);
    sprite.scale.set(size, size * aspect, 1);
    sprite.name = neighbor.id;
    sprite.frustumCulled = false;
    home.add(sprite);
    if (neighbor.id === "m31") {
      new THREE.TextureLoader().load(SKY_ASSETS.andromeda, (loaded) => {
        loaded.colorSpace = THREE.SRGBColorSpace;
        loaded.anisotropy = 4;
        sprite.material.map = brightenLoadedMap(THREE, loaded, 2.15);
        sprite.material.color.set(0xfff4e8);
        sprite.material.blending = THREE.AdditiveBlending;
        sprite.material.needsUpdate = true;
      });
    }
    const label = neighbor.messier ? `${neighbor.name} (${neighbor.messier})` : neighbor.name;
    const lift = size * aspect * 0.72 + 80;
    const side = neighbor.id === "smc" ? 180 : neighbor.id === "lmc" ? -80 : neighbor.id === "m31" ? 340 : 0;
    const labelScale = neighbor.id === "lmc" || neighbor.id === "smc" ? 7.4 : neighbor.id === "m31" ? 12.5 : 5.2;
    cluster.add(labelSprite(THREE, label, { x: at.x + side, y: at.y + lift, z: at.z }, labelScale));
  }
  group.add(cluster);
  group.add(magellanic);
}

/**
 * Trail badge for the Sun's seat plus the Milky Way's own name. Both use
 * the existing labelSprite system, not a new labeling path. The badge is
 * screen-fixed because the trail camera radius spans 36 → 11000; the MW
 * name is a normal world label above the disk, timed like the neighbors.
 */
function createMilkyWayMarks(THREE, group) {
  const badge = new THREE.Group();
  badge.name = "sun-badge";
  const sun = labelSprite(THREE, "Sun", sunScenePosition(), 0.9, true);
  // Anchor below center so the pill floats above the Sun's spot.
  sun.center.set(0.5, -0.6);
  badge.add(sun);
  group.add(badge);

  const name = new THREE.Group();
  name.name = "mw-name";
  const gc = galacticCenterScenePosition();
  const lift = MILKY_WAY.diskRadiusKpc * milkyWayUnitsPerKpc() * 0.5;
  name.add(labelSprite(THREE, "Milky Way", { x: gc.x, y: gc.y + lift, z: gc.z }, 9));
  group.add(name);
}

function memberSpriteSize(member) {
  const visual = visualNeighborhood(member.distanceKpc);
  const size = (member.radiusKpc / member.distanceKpc) * visual * 5.2;
  return Math.max(160, Math.min(480, size));
}

function createLocalGroupMembers(THREE, group, maps) {
  const family = new THREE.Group();
  family.name = "local-group";
  for (const member of LOCAL_GROUP) {
    const at = neighborScenePosition(member);
    const kind = galaxyKind(member.id);
    const size = memberSpriteSize(member);
    const aspect = kind === "elliptical" ? 0.78 : 0.64;
    const glow = new THREE.Sprite(unlitSprite(THREE, {
      map: diskGlowMap(THREE),
      color: 0xffeed8,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthTest: false,
    }));
    glow.position.set(at.x, at.y, at.z);
    glow.scale.set(size * 1.8, size * aspect * 1.8, 1);
    glow.frustumCulled = false;
    family.add(glow);
    const sprite = new THREE.Sprite(unlitSprite(THREE, {
      map: maps[kind] ?? maps.irregular,
      color: 0xfff8ee,
      opacity: 1,
      blending: THREE.AdditiveBlending,
    }));
    sprite.position.set(at.x, at.y, at.z);
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
      4.6,
    ));
  }
  group.add(family);
}

function clusterHubAt(virgoLen, distanceScale, lon, lat) {
  const cosL = Math.cos(lat);
  return {
    x: virgoLen * distanceScale * cosL * Math.cos(lon),
    y: virgoLen * distanceScale * Math.sin(lat),
    z: virgoLen * distanceScale * cosL * Math.sin(lon),
  };
}

function addClusterHub(THREE, field, maps, hub, mark, rand, members) {
  const kinds = ["elliptical", "spiral", "spiral", "irregular"];
  // Wide spread and small members: cluster galaxies stay separated, with
  // visible space between them, instead of piling into one blob.
  const spread = mark * (0.72 + rand() * 0.22);
  for (let i = 0; i < members; i += 1) {
    const kind = kinds[Math.floor(rand() * kinds.length)];
    const size = 300 + rand() * 360;
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

/** Other clusters sit at Virgo-like distances, not on the MW / Local Group. */
function createNearClusters(THREE, group, maps) {
  const field = new THREE.Group();
  field.name = "near-clusters";
  const virgo = virgoScenePosition();
  const virgoLen = Math.hypot(virgo.x, virgo.y, virgo.z);
  const mark = visualVirgo(CONFIG.virgoMarkRadiusMpc * 1000);
  const rand = seedRandom(16501);
  const hubs = [
    { t: 1.45, lon: 0.55, lat: 0.2 },
    { t: 1.85, lon: 2.4, lat: -0.45 },
    { t: 2.25, lon: 4.1, lat: 0.55 },
    { t: 2.7, lon: 5.4, lat: -0.15 },
  ];
  for (const item of hubs) {
    addClusterHub(
      THREE,
      field,
      maps,
      clusterHubAt(virgoLen, item.t, item.lon, item.lat),
      mark,
      rand,
      12 + Math.floor(rand() * 5),
    );
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
    11,
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
    const scatter = (0.6 + Math.sin(t * Math.PI) * 1.35) * (140 + rand() * 260) * scatterScale;
    const puffs = 6;
    for (let p = 0; p < puffs; p += 1) {
      positions.push(
        x + (rand() - 0.5) * scatter,
        y + (rand() - 0.5) * scatter * 0.9,
        z + (rand() - 0.5) * scatter,
      );
      const dense = Math.sin(t * Math.PI);
      const heat = clamp(0.08 + warm * 0.62 + dense * 0.58 * (0.5 + rand() * 0.5), 0, 1);
      colors.push(0.3 + 0.7 * heat, 0.2 + 0.42 * heat, 0.28 + 0.62 * (1 - heat));
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
  addPoints(THREE, group, `${name}-px`, positions, colors, 3.6, 0.7, false, THREE.AdditiveBlending);
  addPoints(THREE, group, name, positions, colors, 220, 0.55, true, THREE.AdditiveBlending);
}

/**
 * Web hub positions. The pre-web deep field reuses this with the same
 * seed and parameters as the cosmic web, so the galaxy images sit
 * exactly where the lattice hubs appear and the morph is a crossfade.
 */
function collectWebHubs(rand, radius, hubCount, includeVirgo, includeHome = true) {
  const hubs = [];
  if (includeHome) hubs.push({ x: 0, y: 0, z: 0, home: true });
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
  return hubs;
}

function createWebVolume(THREE, group, {
  name,
  radius,
  hubCount,
  seed,
  hubSize,
  particleSize,
  includeVirgo,
  includeHome = true,
  fieldCount,
}) {
  const web = new THREE.Group();
  web.name = name;
  const rand = seedRandom(seed);
  const hubMap = hubSprite(THREE);
  const hubs = collectWebHubs(rand, radius, hubCount, includeVirgo, includeHome);

  const positions = [];
  const colors = [];
  for (let i = 0; i < hubs.length; i += 1) {
    const others = hubs
      .map((hub, j) => ({ hub, j, d: Math.hypot(hub.x - hubs[i].x, hub.y - hubs[i].y, hub.z - hubs[i].z) }))
      .filter((row) => row.j !== i)
      .sort((a, b) => a.d - b.d);
    const links = hubs[i].home ? 10 : 7;
    for (let k = 0; k < Math.min(links, others.length); k += 1) {
      if (others[k].j < i && !hubs[i].home) continue;
      pushFilament(positions, colors, hubs[i], others[k].hub, 96, rand, hubs[i].home ? 0.35 : 0, 1.55);
    }
  }

  addPoints(
    THREE,
    web,
    `${name}-filaments`,
    new Float32Array(positions),
    new Float32Array(colors),
    particleSize,
    0.92,
    true,
  );
  addPoints(
    THREE,
    web,
    `${name}-dust`,
    new Float32Array(positions),
    new Float32Array(colors),
    particleSize * 2.6,
    0.36,
    true,
    THREE.AdditiveBlending,
  );
  addFieldGalaxies(THREE, web, `${name}-field`, radius, fieldCount, seed + 17);

  for (let i = 0; i < hubs.length; i += 1) {
    const hub = hubs[i];
    const size = hub.home ? hubSize * 1.15 : hubSize * (0.36 + rand() * 0.46);
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
    fieldCount: 22000,
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
    radius: radius * 0.92,
    hubCount: 240,
    seed: 2018,
    hubSize: 7800,
    particleSize: 760,
    includeVirgo: false,
    includeHome: false,
    fieldCount: 34000,
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
      opacity: 0.42,
      side: THREE.DoubleSide,
    }),
  );
  cmb.name = "cmb-sphere";
  cmb.frustumCulled = false;
  shell.add(cmb);
  group.add(shell);
}

/**
 * Galaxy-image skybox texture: thousands of faint distant galaxies and a
 * few hundred small slivers painted on an equirectangular canvas. This is
 * the pre-v2026.8.20s sky. Slivers are compressed toward the poles instead
 * of skipped so the face-on disk no longer sees a pole hole or ring.
 */
function farGalaxySkyMap(THREE) {
  const width = 2048;
  const height = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#02050c";
  ctx.fillRect(0, 0, width, height);
  const rand = seedRandom(4608);
  for (let i = 0; i < 14000; i += 1) {
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    const x = (theta / (Math.PI * 2)) * width;
    const y = (phi / Math.PI) * height;
    const pole = Math.sin(phi);
    const warm = rand();
    stampSoft(
      ctx,
      x,
      y,
      (0.7 + rand() * 2.2) * (0.4 + 0.6 * pole),
      `rgba(${Math.floor(150 + 95 * warm)}, ${Math.floor(165 + 55 * warm)}, ${Math.floor(215 - 40 * warm)}, ${0.28 + rand() * 0.5})`,
    );
  }
  for (let i = 0; i < 420; i += 1) {
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    const pole = Math.sin(phi);
    const x = (theta / (Math.PI * 2)) * width;
    const y = (phi / Math.PI) * height;
    ctx.save();
    ctx.translate(x, y);
    // Equirect pixels stretch by 1/sin(phi) near the poles; pre-shrink the
    // sliver so it reads the same size on the sphere at every latitude.
    ctx.scale(Math.max(pole, 0.14), 1);
    ctx.rotate(rand() * Math.PI);
    ctx.scale(1, 0.3 + rand() * 0.28);
    stampSoft(ctx, 0, 0, 3 + rand() * 4.5, "rgba(220, 200, 170, 0.4)");
    ctx.restore();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

/** Distant camera-attached galaxy-image sky. Transparent shell, not a lit ball. */
export function farGalaxySkyRadius() {
  return CONFIG.cameraFar * 0.42;
}

function createFarGalaxySky(THREE, group) {
  const sky = new THREE.Group();
  sky.name = "far-galaxy-sky";
  const radius = farGalaxySkyRadius();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 64, 48),
    unlitBasic(THREE, {
      map: farGalaxySkyMap(THREE),
      opacity: 0.88,
      side: THREE.BackSide,
      depthTest: false,
      fog: false,
    }),
  );
  sphere.name = "far-galaxy-shell";
  sphere.frustumCulled = false;
  sky.add(sphere);
  sky.renderOrder = -80;
  group.add(sky);
}

/**
 * Pre-web field: one galaxy image sitting exactly on each cosmic-web hub
 * position (same seed / radius / count as createLocalWeb). The screen
 * fills with separated galaxies — space stays visible between them — and
 * then the lattice fades in through them, so the galaxies are the hubs.
 */
function createDeepField(THREE, group, maps) {
  const field = new THREE.Group();
  field.name = "deep-field";
  const radius = visualWeb(CONFIG.webRadiusMpc);
  const hubs = collectWebHubs(seedRandom(88421), radius, 168, true);
  const rand = seedRandom(7711);
  const kinds = ["spiral", "elliptical", "spiral", "irregular"];
  for (const hub of hubs) {
    if (hub.home) continue;
    const kind = kinds[Math.floor(rand() * kinds.length)];
    // Hubs are at least radius * 0.052 apart; staying under two half-sizes
    // of that spacing keeps every galaxy separated, never a colliding swarm.
    const size = radius * (0.026 + rand() * 0.02);
    const sprite = new THREE.Sprite(unlitSprite(THREE, {
      map: maps[kind],
      color: kind === "elliptical" ? 0xffe6c4 : 0xf2f6ff,
      opacity: 0.95,
      rotation: rand() * Math.PI,
      blending: THREE.AdditiveBlending,
    }));
    sprite.position.set(hub.x, hub.y, hub.z);
    sprite.scale.set(size, size * (kind === "elliptical" ? 0.78 : 0.48), 1);
    sprite.frustumCulled = false;
    field.add(sprite);
  }
  group.add(field);
}

export function attachFarGalaxySky(group, camera) {
  const sky = group?.getObjectByName("far-galaxy-sky");
  if (sky && camera) sky.position.copy(camera.position);
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
  };
  createFarGalaxySky(THREE, group);
  const milkyway = new THREE.Group();
  milkyway.name = "milkyway";
  createDiskGlow(THREE, milkyway);
  createSpiralStars(THREE, milkyway);
  createHalo(THREE, milkyway);
  createBulge(THREE, milkyway);
  group.add(milkyway);
  createMilkyWayMarks(THREE, group);
  createNeighbors(THREE, group, maps);
  createLocalGroupMembers(THREE, group, maps);
  createNearClusters(THREE, group, maps);
  createVirgoCluster(THREE, group, maps);
  createDeepField(THREE, group, maps);
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
  // The real Milky Way and its catalog neighbors stay themselves through
  // Virgo; they only yield when the volume-filling web takes over.
  const family = 1 - web;
  const virgoShown = cluster * (1 - web);
  fadeNamedGroup(group, "far-galaxy-sky", opacity, farGalaxySkyOpacity(distance));
  fadeNamedGroup(group, "milkyway", opacity, milkyWayDiskOpacity(distance) * family);
  fadeNamedGroup(group, "sun-badge", opacity, sunBadgeOpacity(distance) * family);
  fadeNamedGroup(group, "mw-name", opacity, milkyWayNameOpacity(distance) * family);
  fadeNamedGroup(group, "magellanic", opacity, magellanicOpacity(distance) * family);
  fadeNamedGroup(group, "neighbors", opacity, neighborOpacity(distance) * family);
  fadeNamedGroup(group, "local-group", opacity, localGroupMemberOpacity(distance) * family);
  fadeNamedGroup(group, "near-clusters", opacity, near);
  fadeNamedGroup(group, "virgo", opacity, virgoShown);
  fadeNamedGroup(group, "deep-field", opacity, deepFieldOpacity(distance));
  fadeNamedGroup(group, "cosmic-web", opacity, web * (1 - universe));
  fadeNamedGroup(group, "home-mark", opacity, web * (1 - universe));
  fadeNamedGroup(group, "universe", opacity, universe);
  fadeNamedGroup(group, "cmb-shell", opacity, cmbSkyOpacity(distance));
}
