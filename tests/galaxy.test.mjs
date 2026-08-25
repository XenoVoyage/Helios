import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFIG,
  isShortcutTargetInteractive,
  pinchZoomDistance,
  saturnRingHighPhaseFactor,
  saturnRingHighPhaseLitScale,
  wheelZoomMultiplier,
} from "../js/config.js";
import { visualOrbit } from "../js/bodies.js";
import {
  CELESTIAL_RENDER_THRESHOLD,
  ANDROMEDA,
  equatorialToGalactic,
  equatorialToScene,
  galacticToScene,
} from "../js/sky.js";
import {
  CMB_SHELL,
  GALACTIC_CENTER,
  LANIAKEA,
  LOCAL_GROUP,
  MILKY_WAY,
  NEIGHBORS,
  PARTICLE_HORIZON,
  POST_VIRGO_CLUSTERS,
  SUN_GALACTIC,
  VIRGO_CLUSTER,
  findLocalGroupMember,
  findNeighbor,
  localGroupFamily,
} from "../js/galaxy-catalog.js";
import {
  FAR_GALAXY_SKY_MODEL,
  attachFarGalaxySky,
  armPointKpc,
  farthestNeighborhoodDistance,
  farthestUniverseDistance,
  farthestVirgoDistance,
  farthestWebDistance,
  galacticCenterScenePosition,
  celestialSkyOpacity,
  constellationsAvailable,
  extraZoomCameraDistance,
  extraZoomCameraNear,
  farGalaxySkyRadius,
  generateFarGalaxySkySamples,
  galaxyOpacity,
  galaxyBuildStageForDistance,
  galaxyLayerReadyForDistance,
  heliocentricGalactic,
  localWebOpacity,
  localGroupCameraAim,
  localGroupMemberOpacity,
  neighborBodyOpacity,
  milkyWayBelowCameraAim,
  milkyWayEdgeCameraAim,
  milkyWayNameOpacity,
  solarBadgeOpacity,
  solarTrailMarkerMapPosition,
  solarTrailMarkerScenePosition,
  solarSystemHandoffSceneOffset,
  milkyWayInteriorCameraAim,
  milkyWayCameraAim,
  lookAngleTo,
  milkyWayDiskDiameter,
  milkyWayDiskOpacity,
  milkyWayToScene,
  milkyWayUnitsPerKpc,
  cmbDisplayOpacity,
  cmbSkyOpacity,
  cosmicStructureLuminanceGain,
  farGalaxySkyOpacity,
  nearClusterOpacity,
  neighborhoodCameraAim,
  neighborApparentSize,
  neighborOpacity,
  neighborLabelScenePosition,
  neighborLabelWorldSize,
  neighborScenePosition,
  orbitLineOpacity,
  orreryScale,
  responsiveExtraZoomCameraDistance,
  scaleLayer,
  semanticLabelOpacities,
  semanticLabelRow,
  semanticLabelScale,
  skyBandBrightness,
  skyStarBrightness,
  skyStaysOn,
  solarDebrisOpacity,
  solarOpacity,
  sunScenePosition,
  universeOpacity,
  virgoLabelOpacity,
  virgoOpacity,
  virgoScenePosition,
  visualMilkyWay,
  visualNeighborhood,
  visualUniverse,
  visualVirgo,
  visualWeb,
  webHubScenePosition,
  webOpacity,
} from "../js/galaxy.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function unit(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function aimDirection(aim) {
  const cosE = Math.cos(aim.elevation);
  return {
    x: cosE * Math.sin(aim.azimuth),
    y: Math.sin(aim.elevation),
    z: cosE * Math.cos(aim.azimuth),
  };
}

function cameraPosition(aim, distance) {
  const direction = aimDirection(aim);
  return {
    x: direction.x * distance,
    y: direction.y * distance,
    z: direction.z * distance,
  };
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function projectedSpriteRect(aim, distance, position, size) {
  const camera = cameraPosition(aim, distance);
  const forward = unit({ x: -camera.x, y: -camera.y, z: -camera.z });
  const right = unit(cross(forward, { x: 0, y: 1, z: 0 }));
  const up = cross(right, forward);
  const relative = {
    x: position.x - camera.x,
    y: position.y - camera.y,
    z: position.z - camera.z,
  };
  const depth = dot(relative, forward);
  const focal = 1 / Math.tan((52 * Math.PI) / 180 / 2);
  return {
    x: (dot(relative, right) / depth) * focal,
    y: (dot(relative, up) / depth) * focal,
    halfWidth: (size.width / 2 / depth) * focal,
    halfHeight: (size.height / 2 / depth) * focal,
  };
}

function projectedSpritesOverlap(first, second) {
  return Math.abs(first.x - second.x) < first.halfWidth + second.halfWidth
    && Math.abs(first.y - second.y) < first.halfHeight + second.halfHeight;
}

test("Milky Way catalog keeps the thin disk and a thicker visual map", () => {
  assert.equal(MILKY_WAY.heightKpc, 0.3);
  assert.equal(MILKY_WAY.thickHeightKpc, 0.9);
  assert.equal(MILKY_WAY.haloRadiusKpc, 15);
  assert.ok(CONFIG.mwVisualHeightKpc > MILKY_WAY.thickHeightKpc);
  const thin = MILKY_WAY.heightKpc * milkyWayUnitsPerKpc();
  const visual = CONFIG.mwVisualHeightKpc * milkyWayUnitsPerKpc();
  assert.ok(visual > thin * 4, "edge-on disk is thicker than the published thin-disk scale height");
});

test("Sun sits about 8 kpc from the Galactic Center in the Orion Arm", () => {
  assert.equal(SUN_GALACTIC.arm, "Orion Arm");
  assert.ok(SUN_GALACTIC.rKpc > 8.1 && SUN_GALACTIC.rKpc < 8.3);
  assert.equal(SUN_GALACTIC.rKpc, 8.178);
  assert.ok(SUN_GALACTIC.zKpc > 0.015 && SUN_GALACTIC.zKpc < 0.03);
  assert.equal(GALACTIC_CENTER.distanceKpc, SUN_GALACTIC.rKpc);
  assert.ok(Math.abs(GALACTIC_CENTER.lDeg) < 1e-9);
  assert.ok(Math.abs(GALACTIC_CENTER.bDeg) < 1e-9);
});

test("nearby galaxies keep SIMBAD positions and published distances", () => {
  const lmc = findNeighbor("lmc");
  const smc = findNeighbor("smc");
  const m31 = findNeighbor("m31");
  const m33 = findNeighbor("m33");
  assert.equal(NEIGHBORS.length, 4);
  assert.equal(lmc.name, "Large Magellanic Cloud");
  assert.equal(smc.name, "Small Magellanic Cloud");
  assert.equal(m31.name, "Andromeda");
  assert.equal(lmc.distanceKpc, 49.59);
  assert.equal(smc.distanceKpc, 62.44);
  assert.equal(m31.distanceKpc, 780);
  assert.equal(m33.distanceKpc, 859);
  assert.equal(m31.messier, "M31");
  assert.equal(m33.messier, "M33");

  assert.ok(lmc.lDeg > 280 && lmc.lDeg < 281);
  assert.ok(lmc.bDeg < -32 && lmc.bDeg > -34);
  assert.ok(smc.lDeg > 302.5 && smc.lDeg < 303.2);
  assert.ok(smc.bDeg < -44 && smc.bDeg > -45);
  assert.ok(m31.lDeg > 121.1 && m31.lDeg < 121.3);
  assert.ok(m31.bDeg < -21.4 && m31.bDeg > -21.7);
  assert.ok(m33.lDeg > 133.5 && m33.lDeg < 133.8);
  assert.ok(m33.bDeg < -31.2 && m33.bDeg > -31.5);

  const m31Gal = equatorialToGalactic(m31.raDeg, m31.decDeg);
  assert.ok(Math.abs(m31Gal.lDeg - m31.lDeg) < 0.05);
  assert.ok(Math.abs(m31Gal.bDeg - m31.bDeg) < 0.05);
  const lmcGal = equatorialToGalactic(lmc.raDeg, lmc.decDeg);
  assert.ok(Math.abs(((lmcGal.lDeg + 180) % 360) - ((lmc.lDeg + 180) % 360)) < 0.1);
  assert.ok(Math.abs(lmcGal.bDeg - lmc.bDeg) < 0.1);
});

test("neighborhood and Local Group looks keep Andromeda beside the Milky Way", () => {
  const halfFov = (52 * Math.PI) / 180 / 2;
  const m31 = neighborScenePosition(findNeighbor("m31"));
  const lmc = neighborScenePosition(findNeighbor("lmc"));
  const smc = neighborScenePosition(findNeighbor("smc"));
  const looks = [
    [neighborhoodCameraAim(), CONFIG.neighborhoodViewDistance, "neighborhood"],
    [localGroupCameraAim(), CONFIG.localGroupViewDistance, "localgroup"],
  ];
  for (const [aim, distance, name] of looks) {
    const andromeda = lookAngleTo(aim, distance, m31);
    assert.ok(
      andromeda > 0.24,
      `${name} must not stack Andromeda behind the disk (${andromeda})`,
    );
    assert.ok(
      andromeda < halfFov - 0.06,
      `${name} must keep Andromeda in frame (${andromeda})`,
    );
    assert.ok(lookAngleTo(aim, distance, lmc) < halfFov - 0.06, `${name} LMC`);
    assert.ok(lookAngleTo(aim, distance, smc) < halfFov - 0.06, `${name} SMC`);
  }
});

test("Magellanic Cloud labels stay clear in every named camera seat", () => {
  const lmc = findNeighbor("lmc");
  const smc = findNeighbor("smc");
  const growingDistance = CONFIG.handoffViewDistance
    + (CONFIG.mwViewDistance - CONFIG.handoffViewDistance) * 0.9;
  const looks = [
    [milkyWayCameraAim(), extraZoomCameraDistance(growingDistance), "growing"],
    [milkyWayCameraAim(), CONFIG.mwViewDistance, "disk"],
    [milkyWayEdgeCameraAim(), CONFIG.mwViewDistance, "mwedge"],
    [milkyWayBelowCameraAim(), CONFIG.mwViewDistance, "mwbelow"],
    [neighborhoodCameraAim(), CONFIG.neighborhoodViewDistance, "neighborhood"],
    [localGroupCameraAim(), CONFIG.localGroupViewDistance, "localgroup"],
  ];
  for (const [aim, distance, name] of looks) {
    const lmcRect = projectedSpriteRect(
      aim,
      distance,
      neighborLabelScenePosition(lmc),
      neighborLabelWorldSize(lmc),
    );
    const smcRect = projectedSpriteRect(
      aim,
      distance,
      neighborLabelScenePosition(smc),
      neighborLabelWorldSize(smc),
    );
    assert.equal(
      projectedSpritesOverlap(lmcRect, smcRect),
      false,
      `${name} keeps the complete LMC and SMC label sprites separate`,
    );

    // The generated irregular-galaxy textures have transparent outer bounds;
    // this rectangle represents the bright central quarter reviewers must see.
    const cores = [lmc, smc].map((neighbor) => {
      const size = neighborApparentSize(neighbor);
      return projectedSpriteRect(
        aim,
        distance,
        neighborScenePosition(neighbor),
        { width: size * 0.25, height: size * 0.68 * 0.25 },
      );
    });
    const labels = [[lmcRect, "LMC"], [smcRect, "SMC"]];
    for (const [label, labelName] of labels) {
      for (const [core, coreName] of [[cores[0], "LMC"], [cores[1], "SMC"]]) {
        assert.equal(
          projectedSpritesOverlap(label, core),
          false,
          `${name} keeps the ${labelName} label off the ${coreName} bright core`,
        );
      }
    }
  }
});

test("galaxy scales are kpc mappings and do not reuse solar AU units", async () => {
  const galaxySource = await readFile(path.join(root, "js/galaxy.js"), "utf8");
  const catalogSource = await readFile(path.join(root, "js/galaxy-catalog.js"), "utf8");
  assert.doesNotMatch(galaxySource, /visualOrbit\(/);
  assert.doesNotMatch(galaxySource, /orbitScale/);
  assert.doesNotMatch(galaxySource, /orbitPower/);
  assert.doesNotMatch(galaxySource, /orbitAu/);
  assert.doesNotMatch(galaxySource, /auKm/);
  assert.doesNotMatch(catalogSource, /visualOrbit\(/);
  assert.doesNotMatch(catalogSource, /orbitAu/);
  assert.doesNotMatch(catalogSource, /auKm/);

  assert.equal(visualMilkyWay(SUN_GALACTIC.rKpc), CONFIG.mwScale * SUN_GALACTIC.rKpc ** CONFIG.mwPower);
  assert.equal(visualNeighborhood(780), CONFIG.neighborhoodScale * 780 ** CONFIG.neighborhoodPower);
  assert.equal(visualVirgo(16500), CONFIG.virgoScale * (16500 / 1000) ** CONFIG.virgoPower);
  assert.equal(visualWeb(16.5), CONFIG.webScale * 16.5 ** CONFIG.webPower);
  assert.equal(visualUniverse(14.25), CONFIG.universeScale * 14.25 ** CONFIG.universePower);
  assert.notEqual(visualMilkyWay(1), visualOrbit(1));
  assert.notEqual(visualNeighborhood(1), visualOrbit(1));
  assert.notEqual(visualVirgo(1000), visualOrbit(1));
  assert.notEqual(visualVirgo(1000), visualNeighborhood(1));
  assert.notEqual(visualVirgo(1000), visualMilkyWay(1));
  assert.notEqual(visualWeb(16.5), visualVirgo(16500));
  assert.notEqual(visualWeb(16.5), visualOrbit(1));
  assert.notEqual(visualUniverse(1), visualOrbit(1));
  assert.notEqual(visualUniverse(1), 1);
  assert.notEqual(visualUniverse(14.25), 14.25);
  assert.notEqual(visualUniverse(14.25), visualWeb(80));
  assert.notEqual(visualMilkyWay(8.178), visualNeighborhood(8.178));
  assert.notEqual(visualNeighborhood(16500), visualVirgo(16500));
  assert.ok(visualNeighborhood(findNeighbor("m31").distanceKpc) > visualNeighborhood(findNeighbor("lmc").distanceKpc));
  assert.ok(visualNeighborhood(findNeighbor("m33").distanceKpc) > visualNeighborhood(findNeighbor("m31").distanceKpc));
  assert.ok(visualNeighborhood(findNeighbor("smc").distanceKpc) > visualNeighborhood(findNeighbor("lmc").distanceKpc));
  assert.ok(visualVirgo(VIRGO_CLUSTER.distanceKpc) > visualNeighborhood(findNeighbor("m33").distanceKpc) * 0.4);

  const diskFromSun = MILKY_WAY.diskRadiusKpc * milkyWayUnitsPerKpc() + visualMilkyWay(SUN_GALACTIC.rKpc);
  assert.ok(
    visualNeighborhood(findNeighbor("lmc").distanceKpc) > diskFromSun * 0.8,
    "LMC sits outside the luminous disk",
  );
});

test("scale layer switches after the solar camera cap and reset stays solar", () => {
  assert.equal(CONFIG.solarMaxDistance, 1880);
  assert.equal(CONFIG.cameraDistance, 880);
  assert.ok(CONFIG.maxDistance > CONFIG.solarMaxDistance);
  assert.ok(CONFIG.solarMaxDistance < CONFIG.skyRadius);
  assert.ok(CONFIG.maxDistance > CONFIG.skyRadius);
  assert.ok(CONFIG.mwViewDistance > CONFIG.solarMaxDistance);
  assert.ok(CONFIG.neighborhoodViewDistance > CONFIG.mwViewDistance);
  assert.ok(CONFIG.localGroupViewDistance > CONFIG.neighborhoodViewDistance);
  assert.ok(CONFIG.virgoViewDistance > CONFIG.localGroupViewDistance);
  assert.ok(CONFIG.webViewDistance > CONFIG.virgoViewDistance);
  assert.ok(CONFIG.universeViewDistance > CONFIG.webViewDistance);
  assert.ok(CONFIG.maxDistance >= CONFIG.universeViewDistance);
  assert.ok(CONFIG.neighborhoodViewDistance > CONFIG.mwViewDistance * 2);
  assert.ok(CONFIG.webViewDistance > CONFIG.virgoViewDistance * 1.5);
  assert.ok(CONFIG.universeViewDistance > CONFIG.webViewDistance * 1.4);
  assert.ok(CONFIG.mwVisualHeightKpc > MILKY_WAY.heightKpc * 3);
  assert.ok(CONFIG.mwHaloRadiusKpc >= MILKY_WAY.haloRadiusKpc);
  assert.equal(scaleLayer(CONFIG.cameraDistance), "solar");
  assert.equal(scaleLayer(CONFIG.solarMaxDistance), "solar");
  assert.equal(
    scaleLayer((CONFIG.solarMaxDistance + CONFIG.handoffViewDistance) / 2),
    "transition",
  );
  assert.ok(CONFIG.handoffViewDistance > CONFIG.solarMaxDistance);
  assert.ok(CONFIG.handoffViewDistance < CONFIG.galaxyFadeEnd);
  assert.equal(scaleLayer(CONFIG.handoffViewDistance), "milkyway");
  const blendStart = CONFIG.solarMaxDistance
    + (CONFIG.handoffViewDistance - CONFIG.solarMaxDistance) * 0.7;
  assert.equal(
    galaxyOpacity(blendStart - 1),
    0,
    "MW stays off while the orrery shrinks to a pin",
  );
  assert.equal(
    solarOpacity(blendStart - 1),
    1,
    "solar stays up until the handoff crossfade begins",
  );
  const midBlend = (blendStart + CONFIG.handoffViewDistance) / 2;
  assert.ok(
    galaxyOpacity(midBlend) > 0.1 && galaxyOpacity(midBlend) < 0.9,
    "solar sky and MW crossfade gently, not a hard cut",
  );
  assert.equal(
    galaxyOpacity(CONFIG.handoffViewDistance),
    1,
    "MW is full brightness as soon as it is the subject",
  );
  assert.equal(
    solarOpacity(CONFIG.handoffViewDistance),
    0,
    "solar yields once the MW crossfade completes",
  );
  // Regression (zoom-out black void): sky + galaxy always cover the frame.
  for (let d = CONFIG.cameraDistance; d <= CONFIG.mwViewDistance; d += 40) {
    assert.ok(
      celestialSkyOpacity(d) + galaxyOpacity(d) >= 1 - 1e-9,
      `no empty black sky at ${d}`,
    );
  }
  // Regression (ring / dust halo on the trail): the asteroid and Kuiper
  // debris is gone before the MW crossfade begins, so the solar system
  // reads as a single tiny star on the arm.
  assert.equal(solarDebrisOpacity(CONFIG.cameraDistance), 1);
  assert.equal(solarDebrisOpacity(CONFIG.solarMaxDistance), 1, "inner debris look unchanged");
  assert.ok(
    solarDebrisOpacity((CONFIG.solarMaxDistance + blendStart) / 2) < 1,
    "debris fades smoothly after the cap, no pop",
  );
  assert.equal(solarDebrisOpacity(blendStart), 0, "no ring or dust halo once the MW fades in");
  assert.equal(solarDebrisOpacity(midBlend), 0);
  assert.equal(solarDebrisOpacity(CONFIG.handoffViewDistance), 0);
  assert.equal(solarDebrisOpacity(CONFIG.mwViewDistance), 0);
  assert.equal(scaleLayer(CONFIG.mwViewDistance), "milkyway");
  assert.equal(scaleLayer(CONFIG.neighborhoodViewDistance), "neighborhood");
  assert.equal(scaleLayer(CONFIG.localGroupViewDistance), "localgroup");
  assert.equal(scaleLayer(CONFIG.virgoViewDistance), "virgo");
  assert.equal(scaleLayer(CONFIG.webViewDistance), "web");
  assert.equal(scaleLayer(CONFIG.universeViewDistance), "universe");
  assert.equal(solarOpacity(CONFIG.cameraDistance), 1);
  assert.equal(galaxyOpacity(CONFIG.cameraDistance), 0);
  assert.equal(solarOpacity(CONFIG.galaxyFadeEnd), 0);
  assert.equal(galaxyOpacity(CONFIG.galaxyFadeEnd), 1);
  assert.ok(galaxyOpacity(CONFIG.mwViewDistance) === 1);
  assert.equal(neighborOpacity(CONFIG.mwViewDistance), 1);
  assert.equal(neighborOpacity(CONFIG.neighborhoodViewDistance), 1);
  assert.equal(
    neighborOpacity(CONFIG.handoffViewDistance),
    0,
    "neighbor labels wait until the disk is leaving the tail",
  );
  // Regression (neighbor pop-in): all four catalog neighbor bodies (LMC,
  // SMC, Andromeda, Triangulum) ride with the disk from the first trail
  // frame; only their labels wait for the neighbor-label fade.
  assert.equal(neighborBodyOpacity(blendStart - 1), 0);
  assert.ok(neighborBodyOpacity(midBlend) > 0 || galaxyOpacity(midBlend) > 0);
  assert.equal(
    neighborBodyOpacity(CONFIG.handoffViewDistance),
    1,
    "catalog neighbors already exist while the camera is on the MW trail",
  );
  assert.equal(neighborBodyOpacity(CONFIG.mwViewDistance), 1);
  assert.equal(neighborBodyOpacity(CONFIG.neighborhoodViewDistance), 1);
  // Trail badge: the "Solar System" badge rides the trail over the white
  // seat particle, then dies early on the way out — before the Milky Way
  // name and the neighbor labels arrive — so no empty badge floats over
  // the trail or the disk.
  assert.equal(solarBadgeOpacity(blendStart - 1), 0);
  assert.equal(solarBadgeOpacity(CONFIG.handoffViewDistance), 1, "badge is up on the trail");
  const badgeGone = CONFIG.handoffViewDistance
    + (CONFIG.mwViewDistance - CONFIG.handoffViewDistance) * 0.45;
  assert.equal(solarBadgeOpacity(badgeGone), 0, "badge dies early on the way out");
  assert.equal(
    neighborOpacity(badgeGone),
    0,
    "badge is gone before the galaxy names arrive to take over",
  );
  assert.equal(solarBadgeOpacity(CONFIG.mwViewDistance), 0, "no badge at the full disk");
  assert.equal(milkyWayNameOpacity(CONFIG.handoffViewDistance), 0);
  assert.equal(milkyWayNameOpacity(CONFIG.mwViewDistance), 1);
  assert.equal(milkyWayNameOpacity(CONFIG.mwViewDistance), neighborOpacity(CONFIG.mwViewDistance));
  // Regression (Local Group / Virgo pop-in): already-there catalog objects
  // are faintly present from the first trail frame, never spawn later.
  assert.equal(localGroupMemberOpacity(blendStart - 1), 0);
  assert.ok(
    localGroupMemberOpacity(CONFIG.handoffViewDistance) > 0.2,
    "Local Group extras are present on the first trail frame",
  );
  assert.ok(localGroupMemberOpacity(CONFIG.neighborhoodViewDistance) < 0.5);
  assert.equal(localGroupMemberOpacity(CONFIG.localGroupViewDistance), 1);
  assert.equal(virgoOpacity(blendStart - 1), 0);
  assert.ok(
    virgoOpacity(CONFIG.handoffViewDistance) > 0.2,
    "Virgo is present on the first trail frame",
  );
  assert.ok(virgoOpacity(CONFIG.localGroupViewDistance) < 0.5);
  assert.equal(virgoOpacity(CONFIG.virgoViewDistance), 1);
  assert.equal(
    virgoLabelOpacity(CONFIG.localGroupViewDistance),
    0,
    "the distant Virgo name cannot leave a clipped fragment in the Local Group seat",
  );
  assert.ok(
    virgoLabelOpacity((CONFIG.localGroupViewDistance + CONFIG.virgoViewDistance) / 2) > 0,
  );
  assert.equal(virgoLabelOpacity(CONFIG.virgoViewDistance), 1);
  assert.equal(nearClusterOpacity(CONFIG.localGroupViewDistance), 0);
  assert.equal(
    nearClusterOpacity(CONFIG.virgoViewDistance),
    0,
    "other clusters wait until after Virgo, then approach the way Virgo did",
  );
  assert.ok(
    nearClusterOpacity(CONFIG.virgoViewDistance + (CONFIG.webViewDistance - CONFIG.virgoViewDistance) * 0.42) > 0.95,
    "catalog cluster anchors lead the pre-web handoff",
  );
  assert.equal(webOpacity(CONFIG.virgoViewDistance), 0);
  assert.ok(
    webOpacity(CONFIG.virgoViewDistance + (CONFIG.webViewDistance - CONFIG.virgoViewDistance) * 0.55) > 0.4,
    "2MRS galaxies arrive gradually after the catalog anchors",
  );
  assert.equal(webOpacity(CONFIG.webViewDistance), 1);
  assert.equal(
    localWebOpacity(CONFIG.webViewDistance),
    1,
    "web seat is the measured 2MRS volume",
  );
  assert.equal(
    universeOpacity(CONFIG.webViewDistance),
    0,
    "outer illustrative density waits until after the 2MRS seat",
  );
  const outerTransition = CONFIG.webViewDistance
    + (CONFIG.universeViewDistance - CONFIG.webViewDistance) * 0.2;
  assert.equal(
    localWebOpacity(outerTransition),
    1,
    "2MRS stays fully visible while the camera remains inside its display volume",
  );
  assert.ok(
    universeOpacity(outerTransition) > 0 && universeOpacity(outerTransition) < 1,
    "outer density crossfades in after the measured volume",
  );
  const readabilityTransition = CONFIG.webViewDistance
    + (CONFIG.universeViewDistance - CONFIG.webViewDistance) * 0.35;
  assert.ok(
    localWebOpacity(readabilityTransition) + universeOpacity(readabilityTransition) > 1.35,
    "measured and illustrative volumes overlap through the sparse outer handoff",
  );
  const measuredBoundary = CONFIG.webViewDistance
    + (CONFIG.universeViewDistance - CONFIG.webViewDistance) * 0.74;
  assert.equal(
    localWebOpacity(measuredBoundary),
    1,
    "2MRS stays fully visible while the front-facing CMB is still invisible",
  );
  const cmbStrongTransition = CONFIG.webViewDistance
    + (CONFIG.universeViewDistance - CONFIG.webViewDistance) * 0.82;
  assert.ok(
    localWebOpacity(cmbStrongTransition) > 0.95,
    "the measured inner context yields only as a genuinely visible CMB grows",
  );
  assert.equal(localWebOpacity(CONFIG.universeViewDistance), 0);
  assert.ok(
    Math.abs(
      universeOpacity(CONFIG.universeViewDistance)
      * cosmicStructureLuminanceGain(CONFIG.universeViewDistance)
      - 0.75,
    ) < 1e-12,
    "the compensated outer web keeps its approved final contribution",
  );
  assert.equal(nearClusterOpacity(CONFIG.webViewDistance), 0);
  assert.equal(
    farGalaxySkyOpacity(CONFIG.handoffViewDistance),
    1,
    "unresolved density sky is already up in the tail",
  );
  assert.equal(
    farGalaxySkyOpacity(CONFIG.handoffViewDistance + (CONFIG.mwViewDistance - CONFIG.handoffViewDistance) * 0.90),
    1,
    "unresolved density sky is the extra-zoom background while the disk is growing",
  );
  assert.equal(
    farGalaxySkyOpacity(CONFIG.mwViewDistance),
    1,
    "distant density sky stays up on the full-disk frame",
  );
  assert.equal(
    farGalaxySkyOpacity(CONFIG.neighborhoodViewDistance),
    1,
    "distant density sky stays up through the neighborhood",
  );
  assert.equal(
    farGalaxySkyOpacity(CONFIG.virgoViewDistance),
    1,
    "distant density sky stays up at Virgo",
  );
  const clusterHandoff = CONFIG.virgoViewDistance
    + (CONFIG.webViewDistance - CONFIG.virgoViewDistance) * 0.28;
  assert.ok(
    farGalaxySkyOpacity(clusterHandoff) > 0.75,
    "the distant sky overlaps the still-growing measured web",
  );
  assert.ok(
    webOpacity(clusterHandoff) > 0.15,
    "measured 2MRS points are already present during the sky crossfade",
  );
  for (let i = 0; i <= 100; i += 1) {
    const distance = CONFIG.virgoViewDistance
      + (CONFIG.webViewDistance - CONFIG.virgoViewDistance) * (i / 100);
    assert.ok(
      farGalaxySkyOpacity(distance) + webOpacity(distance) >= 0.78,
      `Virgo-to-web background coverage never collapses (${distance})`,
    );
  }
  assert.equal(
    farGalaxySkyOpacity(CONFIG.localGroupViewDistance),
    1,
    "distant density sky stays up at Local Group",
  );
  assert.equal(
    farGalaxySkyOpacity(CONFIG.webViewDistance),
    0,
    "web look is the volume-filling web, not the far-galaxy sprite sky",
  );
  assert.equal(
    cmbSkyOpacity(CONFIG.localGroupViewDistance),
    0,
    "microwave does not start at Local Group",
  );
  assert.equal(
    cmbSkyOpacity(CONFIG.virgoViewDistance),
    0,
    "microwave does not start at Virgo",
  );
  assert.equal(
    cmbSkyOpacity(CONFIG.webViewDistance),
    0,
    "microwave waits until after the web",
  );
  assert.equal(cmbSkyOpacity(CONFIG.universeViewDistance), 1);
  assert.equal(cmbDisplayOpacity(CONFIG.universeViewDistance), 1.05);
  assert.equal(
    farGalaxySkyOpacity(CONFIG.universeViewDistance),
    0,
    "far-galaxy sky yields to the CMB sphere outside",
  );
  assert.ok(
    CONFIG.webViewDistance < farthestWebDistance(),
    "web look sits inside the measured 2MRS volume, not outside a ball",
  );
  assert.ok(
    farthestUniverseDistance() > CONFIG.webViewDistance,
    "CMB shell is still ahead at web scale",
  );
  assert.ok(
    CONFIG.universeViewDistance > farthestUniverseDistance() * 1.2,
    "universe look sits outside the CMB shell so the sphere reads",
  );
  assert.ok(
    CONFIG.maxDistance > farthestUniverseDistance(),
    "camera can leave the observable sphere",
  );
});

test("cosmic structure brightens by semantic stage while the CMB waits for shell exit", () => {
  const preWeb = CONFIG.virgoViewDistance
    + (CONFIG.webViewDistance - CONFIG.virgoViewDistance) * 0.55;
  assert.equal(cosmicStructureLuminanceGain(CONFIG.virgoViewDistance), 1);
  assert.ok(cosmicStructureLuminanceGain(preWeb) > 1);
  assert.ok(
    cosmicStructureLuminanceGain(CONFIG.webViewDistance)
      > cosmicStructureLuminanceGain(preWeb),
  );

  let inside = CONFIG.webViewDistance;
  let outside = CONFIG.universeViewDistance;
  const shell = farthestUniverseDistance();
  for (let i = 0; i < 80; i += 1) {
    const middle = (inside + outside) / 2;
    if (extraZoomCameraDistance(middle) <= shell) inside = middle;
    else outside = middle;
  }
  assert.equal(cmbSkyOpacity(inside), 0, "CMB stays invisible from inside its sphere");
  assert.ok(cmbSkyOpacity(outside) < 1e-20, "CMB begins continuously after shell exit");
  assert.equal(localWebOpacity(inside), 1, "the measured web cannot fade into nothing");
  assert.ok(
    Math.abs(universeOpacity(inside) - 1) < 1e-12,
    "the mature outer density is not attenuated by an invisible CMB",
  );

  let previousCmb = 0;
  let previousGain = cosmicStructureLuminanceGain(CONFIG.virgoViewDistance);
  for (let i = 1; i <= 200; i += 1) {
    const distance = CONFIG.virgoViewDistance
      + (CONFIG.universeViewDistance - CONFIG.virgoViewDistance) * (i / 200);
    const cmb = cmbSkyOpacity(distance);
    const gain = cosmicStructureLuminanceGain(distance);
    assert.ok(cmb >= previousCmb, `CMB opacity is monotonic at ${distance}`);
    assert.ok(gain >= previousGain, `point luminance gain is monotonic at ${distance}`);
    assert.ok(gain <= 1.5 + 1e-12, `point luminance gain stays bounded at ${distance}`);
    previousCmb = cmb;
    previousGain = gain;
  }
});

test("portrait CMB distance fits the shell without changing the approved base path", () => {
  const pullStart = CONFIG.webViewDistance
    + (CONFIG.universeViewDistance - CONFIG.webViewDistance) * 0.68;
  const landscape = 16 / 9;
  for (const distance of [
    CONFIG.cameraDistance,
    CONFIG.webViewDistance,
    pullStart,
    (pullStart + CONFIG.universeViewDistance) / 2,
    CONFIG.universeViewDistance,
    CONFIG.maxDistance,
  ]) {
    assert.equal(
      responsiveExtraZoomCameraDistance(distance, landscape),
      extraZoomCameraDistance(distance),
      `landscape keeps the exact base camera distance at ${distance}`,
    );
  }

  const aspect = 390 / 844;
  const halfFov = 52 * Math.PI / 360;
  const limitingHalfFov = Math.min(halfFov, Math.atan(aspect * Math.tan(halfFov)));
  const shellFit = farthestUniverseDistance() / Math.sin(limitingHalfFov);
  let previous = 0;
  for (let index = 0; index <= 200; index += 1) {
    const distance = CONFIG.webViewDistance
      + (CONFIG.universeViewDistance - CONFIG.webViewDistance) * index / 200;
    const base = extraZoomCameraDistance(distance);
    const cmb = cmbSkyOpacity(distance);
    const responsive = responsiveExtraZoomCameraDistance(distance, aspect);
    if (cmb === 0) assert.equal(responsive, base, `invisible CMB keeps base path at ${distance}`);
    const blend = cmb * cmb * (3 - 2 * cmb);
    assert.ok(Math.abs(responsive - (base + (shellFit - base) * blend)) < 1e-9);
    assert.ok(responsive >= previous, `portrait camera remains monotonic at ${distance}`);
    previous = responsive;
  }
  const finalDistance = responsiveExtraZoomCameraDistance(CONFIG.universeViewDistance, aspect);
  assert.ok(Math.abs(finalDistance - shellFit) < 1e-9);
  assert.ok(Math.asin(farthestUniverseDistance() / finalDistance) <= limitingHalfFov + 1e-12);
  assert.equal(
    responsiveExtraZoomCameraDistance(CONFIG.universeViewDistance, 0.8),
    extraZoomCameraDistance(CONFIG.universeViewDistance),
  );
  assert.ok(Math.abs(
    responsiveExtraZoomCameraDistance(CONFIG.maxDistance, aspect) - finalDistance
      - (CONFIG.maxDistance - CONFIG.universeViewDistance)
  ) < 1e-9, "portrait zoom retains one-to-one motion beyond the fitted endpoint");
});

test("galaxy construction stages follow only layers that can contribute", () => {
  assert.equal(galaxyBuildStageForDistance(CONFIG.cameraDistance), "skeleton");
  assert.equal(galaxyBuildStageForDistance(CONFIG.handoffViewDistance), "near");
  assert.equal(galaxyBuildStageForDistance(CONFIG.localGroupViewDistance), "near");
  assert.equal(galaxyBuildStageForDistance(CONFIG.webViewDistance), "web");
  assert.equal(
    galaxyBuildStageForDistance(
      CONFIG.webViewDistance
        + (CONFIG.universeViewDistance - CONFIG.webViewDistance) * 0.2,
    ),
    "outer",
  );
  assert.equal(galaxyBuildStageForDistance(CONFIG.universeViewDistance), "complete");
  const staged = { userData: { buildStage: "near" } };
  assert.equal(galaxyLayerReadyForDistance(staged, CONFIG.localGroupViewDistance), true);
  assert.equal(galaxyLayerReadyForDistance(staged, CONFIG.webViewDistance), false);
  staged.userData.buildStage = "complete";
  assert.equal(galaxyLayerReadyForDistance(staged, CONFIG.universeViewDistance), true);
});

test("semantic labels roll up from galaxies to superclusters, then clear for the web", () => {
  assert.ok(semanticLabelScale("catalog") < semanticLabelScale("group"));
  assert.ok(semanticLabelScale("group") < semanticLabelScale("structure"));
  assert.ok(semanticLabelScale("structure") < semanticLabelScale("scope"));
  assert.notEqual(
    semanticLabelRow("virgoSupercluster"),
    semanticLabelRow("laniakea"),
    "overlapping supercluster titles occupy separate rows",
  );

  const neighborhood = semanticLabelOpacities(CONFIG.neighborhoodViewDistance);
  const localGroup = semanticLabelOpacities(CONFIG.localGroupViewDistance);
  const virgo = semanticLabelOpacities(CONFIG.virgoViewDistance);
  const span = CONFIG.webViewDistance - CONFIG.virgoViewDistance;
  const laniakea = semanticLabelOpacities(CONFIG.virgoViewDistance + span * 0.3);
  const web = semanticLabelOpacities(CONFIG.webViewDistance);
  const universe = semanticLabelOpacities(CONFIG.universeViewDistance);

  assert.equal(neighborhood.galaxies, 1);
  assert.equal(neighborhood.localGroup, 0);
  assert.equal(localGroup.localGroup, 1);
  assert.equal(localGroup.galaxies, 0);
  assert.equal(virgo.virgoSupercluster, 1);
  assert.equal(virgo.localGroup, 1);
  assert.equal(virgo.galaxies, 0);
  assert.equal(laniakea.laniakea, 1);
  assert.ok(laniakea.virgoSupercluster > 0, "supercluster labels crossfade without a gap");
  const semanticKeys = ["galaxies", "localGroup", "virgoSupercluster", "laniakea"];
  assert.deepEqual(Object.keys(web).sort(), semanticKeys.sort());
  assert.ok(Object.values(web).every((opacity) => opacity === 0));
  assert.ok(Object.values(universe).every((opacity) => opacity === 0));

  for (let i = 0; i <= 100; i += 1) {
    const distance = CONFIG.neighborhoodViewDistance
      + (CONFIG.localGroupViewDistance - CONFIG.neighborhoodViewDistance) * (i / 100);
    const labels = semanticLabelOpacities(distance);
    assert.ok(
      Math.max(labels.galaxies, labels.localGroup) >= 0.5 - 1e-12,
      `galaxy names crossfade into Local Group without a dim label gap (${distance})`,
    );
  }

  const finalHierarchyDistance = CONFIG.virgoViewDistance + span * 0.675;
  for (let i = 0; i <= 180; i += 1) {
    const distance = CONFIG.neighborhoodViewDistance
      + (finalHierarchyDistance - CONFIG.neighborhoodViewDistance) * (i / 180);
    const labels = semanticLabelOpacities(distance);
    const dominant = Math.max(
      labels.galaxies,
      labels.localGroup,
      labels.virgoSupercluster,
      labels.laniakea,
    );
    assert.ok(dominant >= 0.48, `a dominant semantic label remains through ${distance}`);
  }
});

test("trail marks: one display-offset Solar System particle, no lingering Sun badge", async () => {
  const galaxySource = await readFile(path.join(root, "js/galaxy.js"), "utf8");
  assert.match(galaxySource, /"Solar System"/, "the trail badge names the Solar System");
  assert.doesNotMatch(
    galaxySource,
    /labelSprite\(THREE, "Sun"[,)]/,
    "no bare Sun badge survives at trail / disk scale",
  );
  assert.match(galaxySource, /solar-seat-star/, "one seat particle marks the Sun's spot");
  const sun = sunScenePosition();
  const seat = solarTrailMarkerMapPosition();
  assert.deepEqual(sun, { x: 0, y: 0, z: 0 }, "the scientific Solar origin stays fixed");
  assert.equal(SUN_GALACTIC.zKpc, 0.0208, "the catalog Solar height stays published");
  assert.deepEqual(
    seat,
    { x: -0.5, y: 2.5, z: 0 },
    "the trail pin uses only the approved map-local display offset",
  );
  assert.ok(
    Math.hypot(seat.x - sun.x, seat.y - sun.y, seat.z - sun.z) < 4,
    "the trail-only marker offset stays visually local",
  );
  assert.match(
    galaxySource,
    /"solar-seat-star",\s*new Float32Array\(\[seatAt\.x, seatAt\.y, seatAt\.z\]\),\s*new Float32Array\(\[1, 1, 1\]\)/,
    "the seat particle is a single white point at the shared display seat",
  );
  assert.match(
    galaxySource,
    /labelSprite\(THREE, "Solar System", seatAt, 0\.9, true\)/,
    "the dot and screen-fixed badge share one display position",
  );
  assert.doesNotMatch(galaxySource, /solar-seat-ring|seatGlowMap/, "not a ring, not a glow halo");
  // The badge dies strictly earlier than the old (1 - neighborOpacity)
  // fade: gone by mid-trail, while the names arrive near the full disk.
  const start = CONFIG.handoffViewDistance;
  const span = CONFIG.mwViewDistance - start;
  assert.ok(solarBadgeOpacity(start + span * 0.2) < 1);
  assert.equal(solarBadgeOpacity(start + span * 0.5), 0);
  assert.equal(solarBadgeOpacity(start + span * 0.88), 0);
  assert.ok(neighborOpacity(start + span * 0.94) > 0, "names take over after the badge is gone");
});

test("the shrinking Sun reaches the final trail seat before both layers crossfade", () => {
  const blendStart = CONFIG.solarMaxDistance
    + (CONFIG.handoffViewDistance - CONFIG.solarMaxDistance) * 0.7;
  const marker = solarTrailMarkerScenePosition();
  assert.deepEqual(solarSystemHandoffSceneOffset(CONFIG.solarMaxDistance), { x: 0, y: 0, z: 0 });
  assert.deepEqual(solarSystemHandoffSceneOffset(blendStart), marker);
  assert.deepEqual(solarSystemHandoffSceneOffset(CONFIG.handoffViewDistance), marker);
  let previous = 0;
  const markerLength = Math.hypot(marker.x, marker.y, marker.z);
  for (let step = 0; step <= 100; step += 1) {
    const distance = CONFIG.solarMaxDistance
      + (blendStart - CONFIG.solarMaxDistance) * (step / 100);
    const offset = solarSystemHandoffSceneOffset(distance);
    const length = Math.hypot(offset.x, offset.y, offset.z);
    assert.ok(length + 1e-12 >= previous, `handoff offset is monotonic at ${distance}`);
    assert.ok(length <= markerLength + 1e-12);
    previous = length;
  }
  for (let step = 0; step <= 100; step += 1) {
    const distance = blendStart
      + (CONFIG.handoffViewDistance - blendStart) * (step / 100);
    assert.deepEqual(
      solarSystemHandoffSceneOffset(distance),
      marker,
      `Sun and marker coincide throughout the visible crossfade (${distance})`,
    );
  }
  assert.deepEqual(sunScenePosition(), { x: 0, y: 0, z: 0 });
});

test("extra-zoom shrinks the orrery to a Sun pin before the MW disk", () => {
  assert.equal(orreryScale(CONFIG.cameraDistance), 1);
  assert.equal(orreryScale(CONFIG.solarMaxDistance), 1);
  assert.ok(orreryScale(CONFIG.handoffViewDistance) < 0.12);
  assert.ok(orreryScale(CONFIG.mwViewDistance) < 0.04);
  const kuiper = visualOrbit(CONFIG.kuiperOuterAu) * orreryScale(CONFIG.handoffViewDistance);
  assert.ok(
    kuiper < milkyWayDiskDiameter() * 0.1,
    "Kuiper / planet orbits are a pin on the MW, not a system-sized overlay",
  );
  assert.equal(orbitLineOpacity(CONFIG.solarMaxDistance), 1);
  assert.equal(orbitLineOpacity(CONFIG.solarMaxDistance + 1), 0);
  assert.equal(orbitLineOpacity(CONFIG.handoffViewDistance), 0);
  assert.equal(orbitLineOpacity(CONFIG.mwViewDistance), 0);
});

test("solar skybox stays at constant brightness and crossfades into the MW", () => {
  const blendStart = CONFIG.solarMaxDistance
    + (CONFIG.handoffViewDistance - CONFIG.solarMaxDistance) * 0.7;
  assert.equal(skyStaysOn(CONFIG.cameraDistance), true);
  assert.equal(skyStaysOn(CONFIG.solarMaxDistance), true);
  assert.equal(skyStaysOn(CONFIG.solarMaxDistance + 1), true);
  assert.equal(skyStaysOn(CONFIG.handoffViewDistance), false);
  assert.equal(skyStaysOn(CONFIG.mwViewDistance), false);
  assert.equal(skyStaysOn(CONFIG.neighborhoodViewDistance), false);
  assert.equal(celestialSkyOpacity(CONFIG.solarMaxDistance), 1);
  assert.equal(
    celestialSkyOpacity((CONFIG.solarMaxDistance + CONFIG.handoffViewDistance) / 2),
    1,
    "regression: zoomed-out solar view keeps the full skybox, no black void",
  );
  assert.equal(celestialSkyOpacity(CONFIG.handoffViewDistance), 0);
  assert.equal(celestialSkyOpacity(CONFIG.mwViewDistance), 0);
  assert.equal(celestialSkyOpacity(CONFIG.neighborhoodViewDistance), 0);
  assert.equal(milkyWayDiskOpacity(blendStart - 1), 0);
  assert.equal(
    milkyWayDiskOpacity(CONFIG.handoffViewDistance),
    1,
    "first extra-zoom is already inside the local arm / disk trail",
  );
  assert.equal(milkyWayDiskOpacity(CONFIG.mwViewDistance), 1);
  assert.equal(farGalaxySkyOpacity(CONFIG.handoffViewDistance), 1);
  assert.equal(farGalaxySkyOpacity(CONFIG.mwViewDistance), 1);
  // Regression: no feature may brighten the skybox on the way to the cap.
  assert.equal(skyBandBrightness(CONFIG.cameraDistance), 0.82);
  assert.equal(skyBandBrightness(CONFIG.solarMaxDistance), 0.82);
  assert.equal(skyStarBrightness(CONFIG.cameraDistance), 1);
  assert.equal(skyStarBrightness(CONFIG.solarMaxDistance), 1);
  for (let d = CONFIG.minDistance; d < CONFIG.handoffViewDistance; d += 25) {
    assert.equal(skyBandBrightness(d), 0.82, `constant band brightness at ${d}`);
    assert.equal(skyStarBrightness(d), 1, `constant star brightness at ${d}`);
  }
  assert.equal(
    skyBandBrightness(CONFIG.handoffViewDistance),
    0,
    "Gaia band is off once extra-zoom owns the sky",
  );
  assert.equal(skyBandBrightness(CONFIG.mwViewDistance), 0);
  assert.equal(
    skyStarBrightness(CONFIG.handoffViewDistance),
    0,
    "Hipparcos is off after the handoff",
  );
  assert.equal(skyStarBrightness(CONFIG.mwViewDistance), 0);
  const interior = milkyWayInteriorCameraAim();
  const galacticNorth = galacticToScene(0, 0, 1);
  const interiorLatitude = dot(aimDirection(interior), galacticNorth);
  assert.ok(interiorLatitude < Math.sin(0.12), "first extra-zoom look stays in the disk tail");
  assert.ok(interiorLatitude > 0, "interior look is not from under the Galactic plane");
  assert.equal(extraZoomCameraDistance(CONFIG.cameraDistance), CONFIG.cameraDistance);
  // Regression (zoom invert / bounce): the camera dive down to the arm
  // seat finishes before the crossfade begins, while the MW is still off
  // and only the camera-attached sky and the Sun pin are visible.
  assert.ok(
    Math.abs(extraZoomCameraDistance(blendStart) - CONFIG.mwTailNearDistance) < 1e-6,
    "camera is already parked in the arm when the crossfade starts",
  );
  for (let d = CONFIG.solarMaxDistance + 1; d < blendStart; d += 7) {
    assert.equal(galaxyOpacity(d), 0, `MW stays off during the dive at ${d}`);
  }
  // Regression (zoom invert): while anything world-anchored is visible
  // (crossfade onward), camera radius must never decrease as the slider
  // zooms out.
  let previousRadius = extraZoomCameraDistance(blendStart);
  for (let d = blendStart; d <= CONFIG.maxDistance; d += 199) {
    const radius = extraZoomCameraDistance(d);
    assert.ok(
      radius >= previousRadius - 1e-9,
      `camera radius keeps going out past the crossfade (${d})`,
    );
    previousRadius = radius;
  }
  // Regression (zoom invert): during the dive the Sun pin's apparent size
  // (scale over camera radius) must never grow, so nothing reads as
  // approaching while the user zooms out.
  let previousApparent = orreryScale(CONFIG.solarMaxDistance)
    / extraZoomCameraDistance(CONFIG.solarMaxDistance);
  for (let d = CONFIG.solarMaxDistance + 1; d <= CONFIG.handoffViewDistance; d += 3) {
    const apparent = orreryScale(d) / extraZoomCameraDistance(d);
    assert.ok(
      apparent <= previousApparent + 1e-12,
      `Sun pin apparent size never grows through the handoff (${d})`,
    );
    previousApparent = apparent;
  }
  assert.equal(extraZoomCameraDistance(CONFIG.handoffViewDistance), CONFIG.mwTailNearDistance);
  assert.ok(
    Math.abs(extraZoomCameraDistance(CONFIG.handoffViewDistance - 1) - CONFIG.mwTailNearDistance) < 1,
    "regression: camera glides through the handoff, no jump that reads as a hitch",
  );
  assert.ok(
    extraZoomCameraDistance(CONFIG.handoffViewDistance) < milkyWayDiskDiameter() * 0.03,
    "first extra-zoom camera sits in the arm, not a postcard of the disk",
  );
  assert.ok(extraZoomCameraNear(CONFIG.handoffViewDistance) < 0.3);
  assert.ok(extraZoomCameraNear(CONFIG.cameraDistance) > extraZoomCameraNear(CONFIG.handoffViewDistance));
  assert.equal(extraZoomCameraDistance(CONFIG.mwViewDistance), CONFIG.mwViewDistance);
  for (let d = CONFIG.mwViewDistance; d <= CONFIG.webViewDistance; d += 7919) {
    assert.equal(
      extraZoomCameraDistance(d),
      d,
      `all established camera seats through the measured-web look stay unchanged (${d})`,
    );
  }
  const cmbStart = CONFIG.webViewDistance
    + (CONFIG.universeViewDistance - CONFIG.webViewDistance) * 0.68;
  assert.ok(
    extraZoomCameraDistance(cmbStart) < farthestWebDistance(),
    "camera remains inside the measured density until the CMB transition",
  );
  const lateDistance = (fraction) => CONFIG.webViewDistance
    + (CONFIG.universeViewDistance - CONFIG.webViewDistance) * fraction;
  assert.ok(
    extraZoomCameraDistance(lateDistance(0.74)) < farthestWebDistance(),
    "camera still sees the measured volume at the start of the CMB crossfade",
  );
  assert.ok(
    extraZoomCameraDistance(lateDistance(0.78)) < farthestUniverseDistance() * 0.92,
    "camera remains among the illustrative density while the CMB becomes visible",
  );
  assert.ok(
    extraZoomCameraDistance(lateDistance(0.8)) > farthestUniverseDistance(),
    "camera clears the display shell only after the CMB has materially arrived",
  );
  assert.equal(
    extraZoomCameraDistance(CONFIG.universeViewDistance),
    CONFIG.universeViewDistance,
    "final camera still finishes outside the observable shell",
  );
  assert.ok(
    farGalaxySkyRadius() > CONFIG.neighborhoodViewDistance * 8,
    "far-galaxy shell is far past the neighborhood camera",
  );
  assert.ok(farGalaxySkyRadius() > CONFIG.webViewDistance);
  assert.ok(farGalaxySkyRadius() < CONFIG.cameraFar);
});

test("constellation availability is the celestial render threshold", () => {
  assert.equal(CELESTIAL_RENDER_THRESHOLD, 0.04);
  assert.equal(constellationsAvailable(2524), true);
  assert.equal(constellationsAvailable(2700), true);
  assert.equal(constellationsAvailable(2750), true);
  assert.equal(constellationsAvailable(2766), true);
  assert.equal(constellationsAvailable(2767), false);
  assert.equal(constellationsAvailable(2790), false);
  assert.equal(constellationsAvailable(CONFIG.handoffViewDistance), false);
  for (let distance = CONFIG.solarMaxDistance; distance <= CONFIG.handoffViewDistance; distance += 1) {
    assert.equal(
      constellationsAvailable(distance),
      celestialSkyOpacity(distance) > CELESTIAL_RENDER_THRESHOLD,
    );
  }
});

test("far-galaxy backdrop is deterministic spherical density without cube faces", async () => {
  const radius = 1000;
  const first = generateFarGalaxySkySamples(radius);
  const second = generateFarGalaxySkySamples(radius);
  assert.equal(first.positions.length, FAR_GALAXY_SKY_MODEL.count * 3);
  assert.equal(first.corePositions.length, FAR_GALAXY_SKY_MODEL.coreCount * 3);
  assert.deepEqual(first.positions, second.positions);
  assert.deepEqual(first.colors, second.colors);
  assert.deepEqual(first.corePositions, second.corePositions);
  const octants = new Array(8).fill(0);
  for (let i = 0; i < first.positions.length; i += 3) {
    const x = first.positions[i];
    const y = first.positions[i + 1];
    const z = first.positions[i + 2];
    const length = Math.hypot(x, y, z);
    assert.ok(Number.isFinite(length));
    assert.ok(length >= radius * 0.985 - 1e-3 && length <= radius + 1e-3);
    const octant = (x >= 0 ? 4 : 0) | (y >= 0 ? 2 : 0) | (z >= 0 ? 1 : 0);
    octants[octant] += 1;
  }
  assert.ok(octants.every((count) => count > FAR_GALAXY_SKY_MODEL.count * 0.06));

  // Sample viewport-sized spherical caps directly from the generated layer.
  // This isolates the backdrop from named foreground galaxies in browser
  // frames while guarding against face, pole, or oversized angular voids.
  const capCounts = [];
  const capDotFloor = Math.cos((25 * Math.PI) / 180);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let sample = 0; sample < 256; sample += 1) {
    const y = 1 - 2 * ((sample + 0.5) / 256);
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = sample * goldenAngle;
    const direction = {
      x: Math.cos(angle) * radial,
      y,
      z: Math.sin(angle) * radial,
    };
    let count = 0;
    for (let i = 0; i < first.positions.length; i += 3) {
      const length = Math.hypot(
        first.positions[i],
        first.positions[i + 1],
        first.positions[i + 2],
      );
      const alignment = (
        first.positions[i] * direction.x
        + first.positions[i + 1] * direction.y
        + first.positions[i + 2] * direction.z
      ) / length;
      if (alignment >= capDotFloor) count += 1;
    }
    capCounts.push(count);
  }
  assert.ok(Math.min(...capCounts) > 0, "every viewport-sized spherical cap contains density");
  assert.ok(
    Math.max(...capCounts) / Math.min(...capCounts) < 3,
    "far-galaxy density stays distributed across equal-solid-angle views",
  );
  const source = await readFile(path.join(root, "js/galaxy.js"), "utf8");
  assert.doesNotMatch(source, /CubeTexture|samplerCube|textureCube|paintFarGalaxySkyFace/);
  assert.match(source, /far-galaxy-density/);
  assert.match(source, /far-galaxy-cluster-cores/);
  assert.match(source, /sizeAttenuation:\s*attenuation/);
});

test("far-galaxy sky remains camera-attached and tolerates an absent layer", () => {
  let copiedPosition;
  const sky = {
    position: {
      copy(position) {
        copiedPosition = position;
      },
    },
  };
  const group = {
    userData: {
      visibilityCache: {
        nodes: new Map([["far-galaxy-sky", sky]]),
      },
    },
  };
  const camera = { position: { x: 12, y: -7, z: 31 } };
  attachFarGalaxySky(group, camera);
  assert.equal(copiedPosition, camera.position);
  assert.doesNotThrow(() => attachFarGalaxySky(undefined, camera));
  assert.doesNotThrow(() => attachFarGalaxySky(group, undefined));
});

test("pinch direction, wheel direction, and shortcut targets follow native behavior", () => {
  assert.ok(pinchZoomDistance(1000, 40, 80) < 1000, "pinch-out decreases camera distance");
  assert.ok(pinchZoomDistance(1000, 40, 20) > 1000, "pinch-in increases camera distance");
  assert.equal(pinchZoomDistance(1000, 40, 80), 500);
  assert.equal(pinchZoomDistance(1000, 40, 20), 2000);
  assert.ok(wheelZoomMultiplier(100) > 1, "positive wheel delta zooms out");
  assert.ok(wheelZoomMultiplier(-100) < 1, "negative browser-pinch delta zooms in");

  for (const tagName of ["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"]) {
    assert.equal(isShortcutTargetInteractive({ tagName }), true);
  }
  assert.equal(isShortcutTargetInteractive({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isShortcutTargetInteractive({ tagName: "SPAN", parentElement: { tagName: "BUTTON" } }), true);
  assert.equal(isShortcutTargetInteractive({ tagName: "CANVAS" }), false);
});

test("Saturn high-phase ring cue is zero in normal views and smoothly bounded", () => {
  assert.equal(saturnRingHighPhaseFactor(1), 0);
  assert.equal(saturnRingHighPhaseFactor(-0.2), 0);
  assert.equal(saturnRingHighPhaseFactor(-0.85), 1);
  assert.equal(saturnRingHighPhaseFactor(-1), 1);
  assert.ok(saturnRingHighPhaseFactor(-0.5) > 0);
  assert.ok(saturnRingHighPhaseFactor(-0.5) < 1);
  assert.equal(CONFIG.saturnRingHighPhaseLight, 0.025);
  assert.equal(CONFIG.saturnRingBacklitReflectedLight, 0.1);
  assert.equal(saturnRingHighPhaseLitScale(1), 1);
  assert.equal(saturnRingHighPhaseLitScale(-0.2), 1);
  assert.ok(
    Math.abs(
      saturnRingHighPhaseLitScale(-0.85) - CONFIG.saturnRingBacklitReflectedLight,
    ) < 1e-12,
  );
  assert.ok(
    saturnRingHighPhaseLitScale(-0.5) > CONFIG.saturnRingBacklitReflectedLight,
  );
  assert.ok(saturnRingHighPhaseLitScale(-0.5) < 1);
});

test("camera far plane clears the neighborhood and galactic coordinates stay coherent", () => {
  const farthest = Math.max(
    farthestNeighborhoodDistance(),
    farthestVirgoDistance(),
    farthestWebDistance(),
    farthestUniverseDistance(),
  );
  assert.ok(CONFIG.cameraFar > CONFIG.maxDistance);
  assert.ok(CONFIG.cameraFar > farthest + CONFIG.maxDistance * 0.25);
  const sunHel = armPointKpc(SUN_GALACTIC.rKpc, 0, SUN_GALACTIC.zKpc);
  assert.ok(Math.hypot(sunHel.x, sunHel.y, sunHel.z) < 1e-9);
  const gcHel = heliocentricGalactic(0, 0, SUN_GALACTIC.rKpc);
  assert.ok(Math.abs(gcHel.x - SUN_GALACTIC.rKpc) < 1e-9);
  assert.ok(Math.abs(gcHel.y) < 1e-9);
  const below = milkyWayBelowCameraAim();
  assert.ok(below.elevation < 0, "below-disk look stays under the plane");
  const sun = sunScenePosition();
  assert.equal(sun.x, 0);
  assert.equal(sun.y, 0);
  assert.equal(sun.z, 0);
  const gc = galacticCenterScenePosition();
  const expectedGc = galacticToScene(
    GALACTIC_CENTER.distanceKpc,
    0,
    -SUN_GALACTIC.zKpc,
  );
  assert.ok(dot(unit(gc), unit(expectedGc)) > 1 - 1e-12);
  const m31 = neighborScenePosition(findNeighbor("m31"));
  const lmc = neighborScenePosition(findNeighbor("lmc"));
  assert.ok(Math.hypot(m31.x, m31.y, m31.z) > Math.hypot(lmc.x, lmc.y, lmc.z));
  const mapped = milkyWayToScene(SUN_GALACTIC.rKpc, 0, 0);
  assert.ok(Math.abs(Math.hypot(mapped.x, mapped.y, mapped.z) - visualMilkyWay(SUN_GALACTIC.rKpc)) < 1e-6);
});

test("catalog galaxies keep one celestial direction across the scale handoff", () => {
  const rows = [
    ...NEIGHBORS.map((item) => [item, neighborScenePosition(item)]),
    [VIRGO_CLUSTER, virgoScenePosition()],
  ];
  for (const [item, scene] of rows) {
    const equatorial = equatorialToScene(item.raDeg, item.decDeg);
    assert.ok(
      dot(unit(scene), equatorial) > 0.999999999,
      `${item.id} must use its J2000 sky direction`,
    );
  }

  const m31 = neighborScenePosition(findNeighbor("m31"));
  const solarM31 = equatorialToScene(ANDROMEDA.raDeg, ANDROMEDA.decDeg);
  assert.ok(
    dot(unit(m31), solarM31) > 0.999999999,
    "M31 cannot jump when the solar sky yields to the physical galaxy map",
  );
  const handoffAim = milkyWayInteriorCameraAim();
  const handoffRadius = extraZoomCameraDistance(CONFIG.handoffViewDistance);
  const handoffDirection = aimDirection(handoffAim);
  const fromCamera = unit({
    x: m31.x - handoffDirection.x * handoffRadius,
    y: m31.y - handoffDirection.y * handoffRadius,
    z: m31.z - handoffDirection.z * handoffRadius,
  });
  assert.ok(
    dot(fromCamera, solarM31) > Math.cos(0.12 * Math.PI / 180),
    "the parked handoff camera adds less than 0.12 degrees of M31 parallax",
  );

  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const [a, aScene] = rows[i];
      const [b, bScene] = rows[j];
      const aGalactic = unit(heliocentricGalactic(a.lDeg, a.bDeg, 1));
      const bGalactic = unit(heliocentricGalactic(b.lDeg, b.bDeg, 1));
      assert.ok(
        Math.abs(dot(unit(aScene), unit(bScene)) - dot(aGalactic, bGalactic)) < 1e-12,
        `${a.id}/${b.id} pairwise angle is preserved`,
      );
    }
  }
});

test("Local Group extras keep McConnachie distances and SIMBAD positions", () => {
  assert.equal(NEIGHBORS.length, 4);
  assert.equal(LOCAL_GROUP.length, 7);
  assert.equal(localGroupFamily().length, 11);
  const expected = {
    m32: 805,
    ngc205: 824,
    ngc147: 676,
    ngc185: 617,
    ic10: 794,
    ngc6822: 459,
    wlm: 933,
  };
  for (const [id, distanceKpc] of Object.entries(expected)) {
    const member = findLocalGroupMember(id);
    assert.ok(member, id);
    assert.equal(member.distanceKpc, distanceKpc);
    assert.ok(member.distanceKpc > 0);
    const gal = equatorialToGalactic(member.raDeg, member.decDeg);
    const lGap = Math.abs(((gal.lDeg + 180) % 360) - ((member.lDeg + 180) % 360));
    assert.ok(lGap < 0.15, `${id} galactic longitude`);
    assert.ok(Math.abs(gal.bDeg - member.bDeg) < 0.15, `${id} galactic latitude`);
  }
  assert.equal(findLocalGroupMember("m32").messier, "M32");
  assert.equal(findLocalGroupMember("ngc205").messier, "M110");
  assert.ok(findLocalGroupMember("wlm").distanceKpc > findLocalGroupMember("ngc6822").distanceKpc);
  const m32 = neighborScenePosition(findLocalGroupMember("m32"));
  const m31 = neighborScenePosition(findNeighbor("m31"));
  assert.ok(Math.hypot(m32.x - m31.x, m32.y - m31.y, m32.z - m31.z) < visualNeighborhood(80));
});

test("Virgo Cluster keeps the published 16.5 Mpc M87 position", () => {
  assert.equal(VIRGO_CLUSTER.distanceMpc, 16.5);
  assert.equal(VIRGO_CLUSTER.distanceKpc, 16500);
  assert.equal(VIRGO_CLUSTER.distanceKpc, VIRGO_CLUSTER.distanceMpc * 1000);
  assert.equal(VIRGO_CLUSTER.center, "M87");
  assert.ok(VIRGO_CLUSTER.raDeg > 187.6 && VIRGO_CLUSTER.raDeg < 187.8);
  assert.ok(VIRGO_CLUSTER.decDeg > 12.3 && VIRGO_CLUSTER.decDeg < 12.5);
  assert.ok(VIRGO_CLUSTER.lDeg > 283.6 && VIRGO_CLUSTER.lDeg < 283.9);
  assert.ok(VIRGO_CLUSTER.bDeg > 74.4 && VIRGO_CLUSTER.bDeg < 74.6);
  const gal = equatorialToGalactic(VIRGO_CLUSTER.raDeg, VIRGO_CLUSTER.decDeg);
  assert.ok(Math.abs(gal.lDeg - VIRGO_CLUSTER.lDeg) < 0.05);
  assert.ok(Math.abs(gal.bDeg - VIRGO_CLUSTER.bDeg) < 0.05);
  const at = virgoScenePosition();
  const len = Math.hypot(at.x, at.y, at.z);
  assert.ok(Math.abs(len - visualVirgo(16500)) < 1e-6);
  assert.ok(dot(unit(at), galacticToScene(0, 0, 1)) > 0, "Virgo stays north of the Galactic plane");
  assert.ok(len > farthestNeighborhoodDistance());
  assert.ok(CONFIG.cameraFar > farthestVirgoDistance() + CONFIG.maxDistance * 0.25);
});

test("post-Virgo map uses measured cluster anchors and no invented web links", async () => {
  assert.equal(LANIAKEA.name, "Laniakea");
  assert.equal(LANIAKEA.contains, "Local (Virgo) Supercluster");
  assert.equal(LANIAKEA.home, true);
  assert.equal(LANIAKEA.diameterMpc, 160);
  assert.equal(POST_VIRGO_CLUSTERS.length, 7);
  assert.equal(new Set(POST_VIRGO_CLUSTERS.map((cluster) => cluster.id)).size, 7);
  assert.ok(POST_VIRGO_CLUSTERS.every((cluster) => cluster.distanceMpc > VIRGO_CLUSTER.distanceMpc));
  assert.ok(POST_VIRGO_CLUSTERS.every((cluster) => cluster.distanceMpc <= 100));
  assert.ok(POST_VIRGO_CLUSTERS.some((cluster) => cluster.name === "Coma Cluster"));
  for (const cluster of POST_VIRGO_CLUSTERS) {
    const galactic = equatorialToGalactic(cluster.raDeg, cluster.decDeg);
    const longitudeDelta = Math.abs(((galactic.lDeg - cluster.lDeg + 540) % 360) - 180);
    assert.ok(longitudeDelta < 0.08, `${cluster.name} galactic longitude`);
    assert.ok(Math.abs(galactic.bDeg - cluster.bDeg) < 0.08, `${cluster.name} galactic latitude`);
  }
  const catalogSource = await readFile(path.join(root, "js/galaxy-catalog.js"), "utf8");
  const galaxySource = await readFile(path.join(root, "js/galaxy.js"), "utf8");
  assert.doesNotMatch(catalogSource, /SUPERCLUSTERS/);
  assert.doesNotMatch(catalogSource, /Perseus-Pisces/);
  assert.doesNotMatch(catalogSource, /Shapley/);
  assert.doesNotMatch(galaxySource, /You are here/);
  assert.doesNotMatch(galaxySource, /solar-circle/);
  assert.doesNotMatch(galaxySource, /Perseus-Pisces/);
  assert.doesNotMatch(galaxySource, /pushFilament|collectWebHubs|createWebVolume/);
  assert.doesNotMatch(galaxySource, /createDeepField|deep-field|deepFieldOpacity/);
  assert.match(galaxySource, /createMeasuredWeb/);
  assert.match(galaxySource, /createPostVirgoClusters/);
  assert.match(galaxySource, /createOuterDensity/);
  assert.match(galaxySource, /2mrs-galaxies/);
  assert.match(galaxySource, /catalog-cluster-anchors/);
  assert.match(galaxySource, /illustrative-outer-density/);
  assert.match(galaxySource, /cosmic-web/);
  assert.match(galaxySource, /cmb-shell/);
  assert.match(galaxySource, /export function createGalaxyLayer/);
  assert.match(galaxySource, /map\.name = "galactic-frame"/);
  assert.match(galaxySource, /orientMapFrame\(job\.THREE, job\.map\)/);
  assert.match(galaxySource, /visibilityCache/);
  assert.match(galaxySource, /cache\.opacity === opacity && cache\.distance === distance/);
  assert.match(galaxySource, /far-galaxy-sky/);
  assert.match(galaxySource, /near-clusters/);
  assert.match(galaxySource, /mw-disk-edge/);
  assert.match(galaxySource, /mw-halo/);
  assert.match(galaxySource, /Large Magellanic Cloud|neighbor\.name/);
  assert.match(galaxySource, /createFarGalaxySky/);
  assert.match(galaxySource, /CanvasTexture/);
  assert.match(galaxySource, /toneMapped:\s*false/);
  assert.match(galaxySource, /AdditiveBlending/);
  assert.match(galaxySource, /SKY_ASSETS\.andromeda/);
  assert.match(galaxySource, /quietAndromedaMap|andromeda\.png/);
  assert.match(galaxySource, /cameraFar \* 0\.42/);
  assert.match(galaxySource, /generateFarGalaxySkySamples/);
  assert.match(galaxySource, /generateCosmicDensity/);
  assert.match(galaxySource, /far-galaxy-density/);
  assert.match(galaxySource, /far-galaxy-cluster-cores/);
  assert.doesNotMatch(galaxySource, /CubeTexture|samplerCube|textureCube/);
  assert.match(galaxySource, /orientMapFrame\(THREE, sky\)/);
  assert.doesNotMatch(
    galaxySource,
    /function farGalaxySkyMap|const width = 2048|const height = 1024/,
    "the far sky has no equirectangular pole singularity",
  );
  assert.doesNotMatch(
    galaxySource,
    /const size = 68000/,
    "no massive sky sprites sitting next to the Milky Way",
  );
  assert.doesNotMatch(galaxySource, /farGalaxySkyRadius\(\) \* 0\.045/);
  assert.doesNotMatch(galaxySource, /t: 0\.16/);
  assert.match(galaxySource, /function createFarGalaxySky\(THREE, group, samples/);
  assert.doesNotMatch(galaxySource, /far-galaxy-shell/);
  assert.doesNotMatch(galaxySource, /far-galaxy-blobs/);
  assert.match(galaxySource, /brightenLoadedMap/);
  assert.doesNotMatch(galaxySource, /kind === "andromeda"/);
  assert.doesNotMatch(galaxySource, /lineWidth = 13/);
  assert.doesNotMatch(galaxySource, /smc: galaxySprite/);
  assert.doesNotMatch(galaxySource, /kind === "smc"/);
  assert.doesNotMatch(galaxySource, /export \{\s*CMB_SHELL/);
  assert.match(galaxySource, /farGalaxySkyOpacity/);
  assert.match(galaxySource, /cmbSkyOpacity/);
  assert.match(galaxySource, /milkyWayDiskOpacity/);
  assert.doesNotMatch(
    galaxySource,
    /sun-pin-mark|sunPinOpacity/,
    "no white Sun pin survives past the tail",
  );
  // Regression (blown-out tail / white arm patch): the dense additive
  // arm-trail dressing is gone, not dimmed.
  assert.doesNotMatch(galaxySource, /mw-arm-trail/);
  assert.doesNotMatch(galaxySource, /mw-arm-sun/);
  assert.doesNotMatch(galaxySource, /mw-tail/);
  assert.doesNotMatch(galaxySource, /extraZoomTailMix/);
  // Regression (Local Group rewrite): the real Milky Way stays itself
  // through Virgo; no generic stand-in family.
  assert.doesNotMatch(galaxySource, /local-group-family/);
  assert.match(
    galaxySource,
    /const family = 1 - web;/,
    "MW and catalog neighbors yield monotonically to measured galaxies",
  );
  assert.doesNotMatch(galaxySource, /const members = 2 \+/);
  assert.match(galaxySource, /extraZoomCameraNear/);
  assert.match(galaxySource, /skyStaysOn/);
  assert.match(galaxySource, /attachFarGalaxySky/);
  assert.doesNotMatch(galaxySource, /sun-nearby/, "no warm Sun blob in the arm");
  assert.match(galaxySource, /toneMapped:\s*false/);
  assert.match(galaxySource, /unlitSprite|toneMapped:\s*false/);
  assert.doesNotMatch(galaxySource, /hubCount:\s*20\b/);
  assert.match(galaxySource, /depthTest:\s*false/);
  assert.match(galaxySource, /fog:\s*false/);
  assert.match(galaxySource, /name = "cmb-sphere"/);
  const cmbSource = galaxySource.slice(
    galaxySource.indexOf("function createCmbShell"),
    galaxySource.indexOf("/** Distant camera-attached density sky radius."),
  );
  assert.match(cmbSource, /map:\s*loadMap\(THREE, CMB_SHELL\.map\)/);
  assert.match(cmbSource, /opacity:\s*CMB_TEXTURE_OPACITY/);
  assert.match(cmbSource, /side:\s*THREE\.FrontSide/);
  assert.match(galaxySource, /const CMB_TEXTURE_OPACITY = 0\.4;/);
  assert.doesNotMatch(
    cmbSource,
    /color:|blending:|AdditiveBlending|DoubleSide|forceSinglePass|horizonRimMap|observable-horizon-rim/,
    "the CMB stays untinted, normally blended, front-facing, and free of an artificial rim",
  );
  assert.doesNotMatch(
    galaxySource,
    /horizonRimMap|observable-horizon-rim/,
    "the removed blue boundary has no dead renderer left behind",
  );
  const scopeLabelSource = galaxySource.slice(
    galaxySource.indexOf("function createScaleLabels"),
    galaxySource.indexOf("function pinSprite"),
  );
  assert.match(scopeLabelSource, /virgo-supercluster-label/);
  assert.match(scopeLabelSource, /laniakea-label/);
  assert.doesNotMatch(scopeLabelSource, /cosmic-web-label|observable-universe-label/);
  assert.doesNotMatch(
    galaxySource,
    /"cosmic-web-label"|"observable-universe-label"/,
    "web and universe remain scientific scale states without screen badges",
  );
  assert.match(galaxySource, /function handoffBlendStart/);
  assert.doesNotMatch(galaxySource, /far-galaxy-glow/);
  assert.match(galaxySource, /outerDensityBlend/);
  assert.match(galaxySource, /localWebOpacity/);
  const m31 = findNeighbor("m31");
  const catalogRelativeSize = milkyWayDiskDiameter()
    * (m31.radiusKpc / MILKY_WAY.diskRadiusKpc);
  assert.ok(
    Math.abs(neighborApparentSize(m31) - catalogRelativeSize) < 1e-9,
    "Andromeda cannot read smaller than its catalog radius relative to the Milky Way",
  );
  assert.ok(
    visualNeighborhood(m31.distanceKpc) > milkyWayDiskDiameter(),
    "Andromeda sits at a neighbor distance, not stacked on the disk",
  );
  assert.ok(
    farthestUniverseDistance() * 0.92 > CONFIG.webViewDistance,
    "the outer density surrounds the web camera",
  );
  assert.doesNotMatch(galaxySource, /BoxGeometry/);
  assert.equal(visualWeb(CONFIG.webRadiusMpc), CONFIG.webScale * CONFIG.webRadiusMpc ** CONFIG.webPower);
  assert.ok(visualWeb(80) > visualWeb(16.5));
  assert.equal(CONFIG.webRadiusMpc, 300);
  assert.equal(farthestWebDistance(), visualWeb(300));
  const virgoHub = webHubScenePosition({
    lDeg: VIRGO_CLUSTER.lDeg,
    bDeg: VIRGO_CLUSTER.bDeg,
    distanceMpc: VIRGO_CLUSTER.distanceMpc,
  });
  assert.ok(Math.abs(Math.hypot(virgoHub.x, virgoHub.y, virgoHub.z) - visualWeb(16.5)) < 1e-6);
  assert.notEqual(visualWeb(16.5), visualVirgo(16500));
});

test("particle horizon and the artistically co-located CMB shell stay distinct", () => {
  assert.equal(PARTICLE_HORIZON.name, "Particle horizon");
  assert.equal(PARTICLE_HORIZON.comovingRadiusGly, 46.5);
  assert.equal(PARTICLE_HORIZON.comovingRadiusGpc, 14.25);
  assert.equal(PARTICLE_HORIZON.lyPerGpc, 3.26156);
  const fromGpc = PARTICLE_HORIZON.comovingRadiusGpc * PARTICLE_HORIZON.lyPerGpc;
  assert.ok(Math.abs(fromGpc - 46.5) < 0.03);
  assert.equal(
    visualUniverse(PARTICLE_HORIZON.comovingRadiusGpc),
    CONFIG.universeScale * 14.25 ** CONFIG.universePower,
  );
  assert.equal(CMB_SHELL.name, "Illustrative CMB shell");
  assert.equal(CMB_SHELL.displayRadiusGpc, PARTICLE_HORIZON.comovingRadiusGpc);
  assert.equal(CMB_SHELL.physicalRelation, "inside-particle-horizon");
  assert.equal(CMB_SHELL.map, "assets/sky/cmb.jpg");
  assert.ok(farthestUniverseDistance() > farthestWebDistance());
  assert.ok(CONFIG.cameraFar > farthestUniverseDistance() + CONFIG.maxDistance * 0.25);
  assert.ok(CONFIG.maxDistance >= CONFIG.universeViewDistance);
});
