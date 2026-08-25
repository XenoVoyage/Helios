/**
 * Canonical tunables. VERSION must match VERSION.txt.
 *
 * NASA / JPL catalog numbers stay in js/bodies.js. Galactic kpc, Virgo Mpc,
 * web Mpc, particle-horizon Gpc, and illustrative CMB display radius stay in
 * js/galaxy-catalog.js.
 * Only visual scale, the galaxy kpc / cluster / universe mapping, and the
 * time slider may diverge from 1:1. Time is not tied to scale.
 *
 * visualScale is the one spacing knob: it multiplies the compressed orbit
 * curve (orbitScale * AU^orbitPower). Raise it to spread the system; do not
 * invent fake AU values. sizeScale / sizePower size the spheres the same way.
 * Moons share that size curve (moonSizeScale 1). Galaxy zoom uses mwScale /
 * neighborhoodScale / virgoScale / webScale / universeScale; those are kpc,
 * compressed-Mpc, or compressed-Gpc mappings, not AU.
 */
export const CONFIG = Object.freeze({
  VERSION: "v2026.8.23a",
  earthRadiusKm: 6371,
  auKm: 149597870.7,
  visualScale: 2.6,
  sizeScale: 0.4,
  sizePower: 0.82,
  orbitScale: 40,
  orbitPower: 0.58,
  moonPad: 0.4,
  moonSpread: 0.35,
  // Extra visual space between sibling moon paths after radii are reserved.
  moonSiblingGap: 1.5,
  moonOrbitCap: 6,
  // Moons sit just outside rings; do not push them to 1.5× the ring radius.
  moonRingGap: 0.25,
  // 1 = no extra moon shrink; Phobos/Deimos stay tiny from sizePower alone.
  moonSizeScale: 1,
  // Visual floor so Phobos / Deimos never fall below a visible dot. The
  // published radiusKm stays 1:1 in the catalog; only the display size
  // is floored, like every other visual-scale knob.
  moonMinRadius: 0.05,
  defaultDaysPerSecond: 1 / 86400,
  minDaysPerSecond: 1 / 86400,
  maxDaysPerSecond: 400,
  // Debris fields: sparse point clouds, not rock catalogs. One owner for both.
  beltCount: 2400,
  beltInnerAu: 2.2,
  beltOuterAu: 3.3,
  kuiperCount: 880,
  kuiperInnerAu: 30.2,
  kuiperOuterAu: 50,
  cameraDistance: 880,
  cameraElevation: 0.5,
  cameraAzimuth: 0.55,
  minDistance: 2.4,
  // Solar overview / Kuiper camera cap. Further zoom is the galaxy layer.
  solarMaxDistance: 1880,
  maxDistance: 2600000,
  mwViewDistance: 11000,
  neighborhoodViewDistance: 24000,
  localGroupViewDistance: 40000,
  virgoViewDistance: 75000,
  // Inside the volume-filling web (o's universe camera), not outside the local ball.
  webViewDistance: 480000,
  // Far enough outside the CMB shell that the sphere reads as a ball.
  universeViewDistance: 2000000,
  galaxyFadeStart: 1880,
  // Extra-zoom pin shrink after the handoff. Not a solar/MW opacity blend.
  galaxyFadeEnd: 11000,
  // Solar sky and MW crossfade over the last stretch before this distance,
  // so zooming out never shows an empty black sky.
  handoffViewDistance: 2800,
  // Extra-zoom near range: first frames sit among Orion-arm stars, not a postcard.
  mwTailNearDistance: 36,
  // kpc → scene for the Milky Way disk. Not the AU orbit curve.
  mwScale: 82,
  mwPower: 0.95,
  // Visual disk half-thickness so the MW reads as a 3D disk, not a plane.
  // Catalog heightKpc stays the published thin-disk scale height.
  mwVisualHeightKpc: 1.55,
  mwHaloRadiusKpc: 18,
  // Second compressed scale for LMC / SMC / M31 / M33 and Local Group members.
  neighborhoodScale: 340,
  neighborhoodPower: 0.55,
  // Third compressed scale for Virgo. Input is catalog kpc / 1000 (Mpc).
  virgoScale: 4800,
  virgoPower: 0.5,
  // Visual core mark for the cluster, not a 1:1 member catalog.
  virgoMarkRadiusMpc: 2.2,
  // Fourth compressed scale for the local cosmic web. Input is catalog Mpc.
  // Keeps the 300 Mpc 2MRS boundary beyond the web camera so the measured
  // distribution reads as a surrounding volume, not an outside-view ball.
  webScale: 55000,
  webPower: 0.42,
  // 2MRS display cutoff. Radial velocity / H0 is an approximate Mpc mapping.
  webRadiusMpc: 300,
  // Visual home-hub glow. Not the published Laniakea diameter.
  laniakeaMarkRadiusMpc: 3.6,
  // Fifth compressed scale for the observable universe. Input is catalog Gpc.
  universeScale: 200000,
  universePower: 0.48,
  // Faint seeded backdrop stars so the solar sky reads as a full universe.
  // Hipparcos / IAU stay the catalog sky; these are dim dressing only and
  // never brighten with zoom.
  skyFaintStarCount: 9200,
  // Celestial sphere sits around the camera; far plane must clear the universe layer.
  skyRadius: 2000,
  cameraFar: 7000000,
  // Pointer travel below this is a tap/click, not an orbit gesture.
  tapMovePx: 12,
  focusLerp: 6,
  // Bounded texture-shaped scattered light for Saturn's strongly backlit rings.
  saturnRingHighPhaseLight: 0.12,
});

/**
 * Pinch-out (larger gap) moves the camera closer: zoom in.
 * Pinch-in (smaller gap) moves farther: zoom out. Touch only uses this path.
 */
export function pinchZoomDistance(startDistance, startGap, gap) {
  if (!(startGap > 0) || !(gap > 0)) return startDistance;
  return startDistance * (startGap / gap);
}

/** Mouse wheel and browser pinch both follow the platform's delivered direction. */
export function wheelZoomMultiplier(deltaY) {
  return Math.exp(deltaY * 0.0016);
}

/** Saturn ring-only high-phase cue; normal/front views remain exactly unlit. */
export function saturnRingHighPhaseFactor(viewLightDot) {
  if (viewLightDot >= -0.2) return 0;
  if (viewLightDot <= -0.85) return 1;
  const t = (-0.2 - viewLightDot) / 0.65;
  return t * t * (3 - 2 * t);
}

/** Global canvas shortcuts must yield to native and editable controls. */
export function isShortcutTargetInteractive(target) {
  for (let node = target; node; node = node.parentElement) {
    const tag = String(node.tagName || "").toUpperCase();
    if (["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"].includes(tag)) return true;
    if (node.isContentEditable || node.getAttribute?.("contenteditable") === "true") return true;
  }
  return false;
}

/** Honest clock-rate label. Seconds, minutes, and hours remain distinguishable. */
export function formatDaysPerSecond(daysPerSecond) {
  if (daysPerSecond >= 365) return `${(daysPerSecond / 365.25).toFixed(1)} yr`;
  if (daysPerSecond >= 30) return `${(daysPerSecond / 30.437).toFixed(1)} mo`;
  if (daysPerSecond >= 1) return `${daysPerSecond.toFixed(daysPerSecond >= 10 ? 0 : 1)} d`;
  if (daysPerSecond >= 1 / 24) return `${(daysPerSecond * 24).toFixed(0)} h`;
  if (daysPerSecond >= 1 / 1440) return `${(daysPerSecond * 1440).toFixed(0)} min`;
  return `${(daysPerSecond * 86400).toFixed(0)} sec`;
}

export function describeDaysPerSecond(daysPerSecond) {
  let value;
  let unit;
  if (daysPerSecond >= 365) {
    value = Number((daysPerSecond / 365.25).toFixed(1));
    unit = "year";
  } else if (daysPerSecond >= 30) {
    value = Number((daysPerSecond / 30.437).toFixed(1));
    unit = "month";
  } else if (daysPerSecond >= 1) {
    value = Number(daysPerSecond.toFixed(daysPerSecond >= 10 ? 0 : 1));
    unit = "day";
  } else if (daysPerSecond >= 1 / 24) {
    value = Number((daysPerSecond * 24).toFixed(0));
    unit = "hour";
  } else if (daysPerSecond >= 1 / 1440) {
    value = Number((daysPerSecond * 1440).toFixed(0));
    unit = "minute";
  } else {
    value = Number((daysPerSecond * 86400).toFixed(0));
    unit = "second";
  }
  return `${value} ${unit}${value === 1 ? "" : "s"} per second`;
}
