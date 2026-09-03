import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFIG,
  isShortcutTargetInteractive,
  minimumFocusDistance,
  moonFocusFlightPoint,
  parentGlobeClearance,
  parentGlobeMaximumEndpointAngle,
  parentGlobeMaximumViewAngle,
  pinchZoomDistance,
  resetParentGlobeContinuity,
  resolveParentGlobePoint,
  wheelZoomMultiplier,
} from "../js/config.js";
import {
  BODIES,
  bodyOrientationBasis,
  findBody,
  keplerOffset,
  keplerOrbitNormal,
  moonOrbitAttachment,
  visualBodyRadius,
  visualOrbit,
  visualRingRadius,
} from "../js/bodies.js";
import {
  CELESTIAL_RENDER_THRESHOLD,
  ANDROMEDA,
  equatorialToGalactic,
  equatorialToScene,
  equatorialVectorToScene,
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
  scaleLayer,
  sceneHierarchyId,
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
  assert.equal(sceneHierarchyId(CONFIG.cameraDistance), "solar");
  assert.equal(sceneHierarchyId(CONFIG.solarMaxDistance), "solar");
  assert.equal(
    sceneHierarchyId((CONFIG.solarMaxDistance + CONFIG.handoffViewDistance) / 2),
    "transition",
  );
  assert.equal(sceneHierarchyId(CONFIG.handoffViewDistance), "milkyway");
  assert.equal(sceneHierarchyId(CONFIG.mwViewDistance), "milkyway");
  assert.equal(sceneHierarchyId(CONFIG.neighborhoodViewDistance), "neighborhood");
  assert.equal(sceneHierarchyId(CONFIG.localGroupViewDistance), "localgroup");
  assert.equal(sceneHierarchyId(CONFIG.virgoViewDistance), "virgo");
  assert.equal(sceneHierarchyId(CONFIG.webViewDistance), "web");
  assert.equal(sceneHierarchyId(CONFIG.universeViewDistance), "universe");
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

test("accessible hierarchy ids distinguish the visual scientific sequence", () => {
  const span = CONFIG.webViewDistance - CONFIG.virgoViewDistance;
  const sequence = [];
  const samples = [
    CONFIG.cameraDistance,
    CONFIG.solarMaxDistance,
    (CONFIG.solarMaxDistance + CONFIG.handoffViewDistance) / 2,
    CONFIG.handoffViewDistance,
    CONFIG.mwViewDistance,
    CONFIG.neighborhoodViewDistance,
    CONFIG.localGroupViewDistance,
    CONFIG.virgoViewDistance,
    CONFIG.virgoViewDistance + span * 0.12,
    CONFIG.virgoViewDistance + span * 0.3,
    CONFIG.virgoViewDistance + span * 0.55,
    CONFIG.webViewDistance,
    CONFIG.universeViewDistance,
  ];
  for (let distance = CONFIG.cameraDistance; distance <= CONFIG.universeViewDistance; distance += 250) {
    samples.push(distance);
  }
  for (const distance of samples.sort((a, b) => a - b)) {
    const id = sceneHierarchyId(distance);
    if (sequence.at(-1) !== id) sequence.push(id);
  }
  assert.deepEqual(sequence, [
    "solar",
    "transition",
    "milkyway",
    "neighborhood",
    "localgroup",
    "virgo",
    "virgoSupercluster",
    "laniakea",
    "web",
    "cmb",
    "universe",
  ]);
  assert.equal(
    sceneHierarchyId(CONFIG.virgoViewDistance + span * 0.55),
    "laniakea",
    "the preweb seat names Laniakea, not 2MRS",
  );
  assert.equal(sceneHierarchyId(CONFIG.webViewDistance), "web");
  const firstCmb = samples.find((distance) => sceneHierarchyId(distance) === "cmb");
  assert.ok(firstCmb > CONFIG.webViewDistance, "CMB is named only after the 2MRS web seat");
  assert.ok(firstCmb < CONFIG.universeViewDistance, "CMB is named before the universe seat");
  assert.notEqual(
    sceneHierarchyId(firstCmb),
    sceneHierarchyId(CONFIG.universeViewDistance),
    "the warm observable-universe view is distinct from the CMB approach",
  );
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

test("focused zoom stops outside every rendered globe", () => {
  const raisedFloors = [];
  assert.equal(BODIES.length, 20, "geometry assertions cover the complete focus set");
  for (const body of BODIES) {
    const radius = visualBodyRadius(body);
    const floor = minimumFocusDistance(radius);
    const near = extraZoomCameraNear(floor);
    assert.ok(
      floor - radius > near,
      `${body.id} keeps its rendered surface beyond the near plane`,
    );
    assert.ok(Math.max(radius * 7.5, 5.5) >= floor, `${body.id} selection seat stays unchanged`);
    if (floor > CONFIG.minDistance) raisedFloors.push(body.id);
    else assert.equal(floor, CONFIG.minDistance, `${body.id} retains the global close floor`);
  }
  assert.equal(CONFIG.minDistance, 2.4);
  assert.equal(CONFIG.focusSurfaceClearance, 1.05);
  assert.deepEqual(raisedFloors, ["sun", "jupiter", "saturn"]);

  const sunFloor = minimumFocusDistance(visualBodyRadius(findBody("sun")));
  const jupiterFloor = minimumFocusDistance(visualBodyRadius(findBody("jupiter")));
  const saturnFloor = minimumFocusDistance(visualBodyRadius(findBody("saturn")));
  assert.equal(sunFloor, visualBodyRadius(findBody("sun")) * CONFIG.focusSurfaceClearance);
  assert.equal(jupiterFloor, visualBodyRadius(findBody("jupiter")) * CONFIG.focusSurfaceClearance);
  assert.equal(saturnFloor, visualBodyRadius(findBody("saturn")) * CONFIG.focusSurfaceClearance);
  assert.ok(sunFloor > CONFIG.minDistance);
  assert.ok(jupiterFloor > CONFIG.minDistance);
  assert.ok(saturnFloor > CONFIG.minDistance);
  assert.equal(minimumFocusDistance(Number.NaN), CONFIG.minDistance);
  assert.equal(minimumFocusDistance(-1), CONFIG.minDistance);

  const saturn = findBody("saturn");
  const ringInner = visualRingRadius(saturn, saturn.ringInnerKm);
  assert.ok(saturnFloor < ringInner, "Saturn's minimum camera remains inside the ring hole");

  let distance = 80;
  for (let step = 0; step < 48; step += 1) {
    const next = Math.min(
      CONFIG.maxDistance,
      Math.max(sunFloor, distance * wheelZoomMultiplier(-800)),
    );
    assert.ok(next <= distance + 1e-12, "inbound wheel saturates monotonically");
    assert.ok(next >= sunFloor);
    distance = next;
  }
  assert.equal(distance, sunFloor);
  const reverse = Math.min(
    CONFIG.maxDistance,
    Math.max(sunFloor, distance * wheelZoomMultiplier(800)),
  );
  assert.ok(reverse > sunFloor, "outbound wheel leaves the floor immediately");
  assert.ok(
    pinchZoomDistance(100, 40, 800) < sunFloor,
    "an extreme pinch-out reaches the focused floor",
  );
  assert.ok(
    pinchZoomDistance(100, 40, 39) > sunFloor,
    "reversing the same pinch leaves the floor immediately",
  );
});

function moonWorldOffset(body, days) {
  const parent = findBody(body.parent);
  const offset = keplerOffset(body, parent, days);
  if (moonOrbitAttachment(body) !== "parent-equatorial") return offset;
  const basis = bodyOrientationBasis(parent);
  const xAxis = equatorialVectorToScene(basis.xAxis);
  const yAxis = equatorialVectorToScene(basis.yAxis);
  const zAxis = equatorialVectorToScene(basis.zAxis);
  return {
    x: offset.x * xAxis.x + offset.y * zAxis.x - offset.z * yAxis.x,
    y: offset.x * xAxis.y + offset.y * zAxis.y - offset.z * yAxis.y,
    z: offset.x * xAxis.z + offset.y * zAxis.z - offset.z * yAxis.z,
  };
}

function moonWorldOrbitNormal(body) {
  const parent = findBody(body.parent);
  const normal = keplerOrbitNormal(body, parent);
  if (moonOrbitAttachment(body) !== "parent-equatorial") return normal;
  const basis = bodyOrientationBasis(parent);
  const xAxis = equatorialVectorToScene(basis.xAxis);
  const yAxis = equatorialVectorToScene(basis.yAxis);
  const zAxis = equatorialVectorToScene(basis.zAxis);
  return {
    x: normal.x * xAxis.x + normal.y * zAxis.x - normal.z * yAxis.x,
    y: normal.x * xAxis.y + normal.y * zAxis.y - normal.z * yAxis.y,
    z: normal.x * xAxis.z + normal.y * zAxis.z - normal.z * yAxis.z,
  };
}

function focusOrbitOffset(distance, azimuth, elevation) {
  const radius = extraZoomCameraDistance(distance);
  const cosE = Math.cos(elevation);
  return {
    x: radius * cosE * Math.sin(azimuth),
    y: radius * Math.sin(elevation),
    z: radius * cosE * Math.cos(azimuth),
  };
}

function parentClearCamera(
  moonOffset,
  distance,
  azimuth,
  elevation,
  parentRadius,
  near,
  options = null,
) {
  const orbit = focusOrbitOffset(distance, azimuth, elevation);
  return resolveParentGlobePoint(
    moonOffset.x + orbit.x,
    moonOffset.y + orbit.y,
    moonOffset.z + orbit.z,
    0,
    0,
    0,
    parentRadius,
    near,
    moonOffset.x,
    moonOffset.y,
    moonOffset.z,
    options,
  );
}

function moonSightlineSquaredMargin(camera, moonOffset, visibility, moonRadius = 0) {
  const vx = camera.x - moonOffset.x;
  const vy = camera.y - moonOffset.y;
  const vz = camera.z - moonOffset.z;
  const radius = Math.hypot(vx, vy, vz);
  if (!(radius > moonRadius)) return -Infinity;
  const ux = vx / radius;
  const uy = vy / radius;
  const uz = vz / radius;
  const taper = 1 - (moonRadius / radius) ** 2;
  const linear = moonOffset.x * ux + moonOffset.y * uy + moonOffset.z * uz
    + (visibility + moonRadius) * moonRadius / radius;
  const start = Math.max(0, Math.min(radius, -linear / taper));
  const cx = moonOffset.x + ux * start;
  const cy = moonOffset.y + uy * start;
  const cz = moonOffset.z + uz * start;
  const corridorRadius = visibility + moonRadius * (1 - start / radius);
  return cx * cx + cy * cy + cz * cz - corridorRadius * corridorRadius;
}

function assertMoonCameraClear(
  camera,
  moonOffset,
  requestedRadius,
  parentRadius,
  moonRadius,
  near,
  label,
) {
  const endpoint = Math.hypot(camera.x, camera.y, camera.z);
  const safe = parentGlobeClearance(parentRadius, near);
  assert.ok(endpoint + 1e-9 >= safe, `${label} camera clears the parent endpoint`);
  const radius = Math.hypot(
    camera.x - moonOffset.x,
    camera.y - moonOffset.y,
    camera.z - moonOffset.z,
  );
  assert.ok(
    Math.abs(radius - requestedRadius) <= 1e-9 * Math.max(1, requestedRadius),
    `${label} preserves the requested moon distance`,
  );
  const visibility = parentGlobeClearance(parentRadius, 0);
  assert.ok(
    moonSightlineSquaredMargin(camera, moonOffset, visibility, moonRadius) >= -1e-8,
    `${label} keeps the rendered moon sightline clear`,
  );
}

test("focused moon cameras stay outside the parent globe", () => {
  const moons = BODIES.filter((body) => body.kind === "moon");
  assert.equal(moons.length, 9, "parent-globe guard covers every catalog moon");
  assert.equal(parentGlobeClearance(Number.NaN, 0.05), 0);
  assert.equal(parentGlobeClearance(-1, 0.05), 0);
  assert.equal(parentGlobeClearance(0.4, 0.05), 0.45);
  assert.equal(
    parentGlobeClearance(visualBodyRadius(findBody("jupiter")), 0.05),
    visualBodyRadius(findBody("jupiter")) * CONFIG.focusSurfaceClearance,
  );

  const outside = resolveParentGlobePoint(3, 0, 0, 0, 0, 0, 1, 0.05);
  assert.deepEqual(outside, { x: 3, y: 0, z: 0 });
  const pushed = resolveParentGlobePoint(0.2, 0, 0, 0, 0, 0, 1, 0.05);
  assert.ok(Math.abs(pushed.x - 1.05) < 1e-12);
  assert.equal(pushed.y, 0);
  assert.equal(pushed.z, 0);
  const fromCenter = resolveParentGlobePoint(0, 0, 0, 0, 0, 0, 1, 0.05, 4, 0, 0);
  assert.ok(Math.hypot(fromCenter.x, fromCenter.y, fromCenter.z) >= 1.05);
  assert.ok(moonSightlineSquaredMargin(fromCenter, { x: 4, y: 0, z: 0 }, 1.05) >= -1e-12);
  assert.ok(fromCenter.x > 0, "a centered seat slides toward the moon, not through the parent");
  assert.ok(Math.hypot(fromCenter.y, fromCenter.z) > 0.5, "a centered seat leaves the parent axis");
  const degenerate = resolveParentGlobePoint(0, 0, 0, 0, 0, 0, 1, 0.05);
  assert.deepEqual(degenerate, { x: 1.05, y: 0, z: 0 });
  const invalidFocus = resolveParentGlobePoint(
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    0.05,
    Number.NaN,
    Number.NaN,
    Number.NaN,
  );
  assert.deepEqual(invalidFocus, { x: 1.05, y: 0, z: 0 });

  const colliding = [];
  const azimuths = 48;
  const elevations = [-1.2, -0.6, 0, CONFIG.cameraElevation, 0.6, 1.2];
  for (const moon of moons) {
    const parent = findBody(moon.parent);
    const parentRadius = visualBodyRadius(parent);
    const moonRadius = visualBodyRadius(moon);
    const distance = minimumFocusDistance(moonRadius);
    const near = extraZoomCameraNear(distance);
    const safe = parentGlobeClearance(parentRadius, near);
    assert.equal(distance, CONFIG.minDistance, `${moon.id} keeps the global close floor`);
    let hitCollision = false;
    for (const phase of [0, 0.25, 0.5, 0.75]) {
      const days = Math.abs(moon.orbitDays) * phase;
      const moonOffset = moonWorldOffset(moon, days);
      for (const elevation of elevations) {
        for (let step = 0; step < azimuths; step += 1) {
          const azimuth = (step / azimuths) * Math.PI * 2;
          const orbit = focusOrbitOffset(distance, azimuth, elevation);
          const desired = {
            x: moonOffset.x + orbit.x,
            y: moonOffset.y + orbit.y,
            z: moonOffset.z + orbit.z,
          };
          const desiredDist = Math.hypot(desired.x, desired.y, desired.z);
          const resolved = resolveParentGlobePoint(
            desired.x,
            desired.y,
            desired.z,
            0,
            0,
            0,
            parentRadius,
            near,
            moonOffset.x,
            moonOffset.y,
            moonOffset.z,
          );
          const resolvedDist = Math.hypot(resolved.x, resolved.y, resolved.z);
          assert.ok(
            resolvedDist + 1e-9 >= safe,
            `${moon.id} camera stays outside ${parent.id}`,
          );
          const moonDist = Math.hypot(
            resolved.x - moonOffset.x,
            resolved.y - moonOffset.y,
            resolved.z - moonOffset.z,
          );
          assert.ok(
            moonDist > moonRadius + near,
            `${moon.id} collision slide stays outside the focused globe`,
          );
          const visibility = parentGlobeClearance(parentRadius, 0);
          assert.ok(
            moonSightlineSquaredMargin(resolved, moonOffset, visibility) >= -1e-8,
            `${moon.id} center sightline clears ${parent.id}`,
          );
          const desiredSightlineClear = moonSightlineSquaredMargin(
            desired,
            moonOffset,
            visibility,
          ) >= 0;
          if (desiredDist >= safe && desiredSightlineClear) {
            assert.equal(resolved.x, desired.x, `${moon.id} safe azimuth keeps its seat`);
            assert.equal(resolved.y, desired.y);
            assert.equal(resolved.z, desired.z);
          } else if (desiredDist < safe) {
            hitCollision = true;
            assert.ok(Math.abs(resolvedDist - safe) < 1e-9);
          }
        }
      }
    }
    if (hitCollision) colliding.push(moon.id);
  }
  assert.deepEqual(colliding, ["moon", "io", "triton"]);

  const cases = [
    { id: "moon", parent: "earth", uncorrected: 0.2413463779006788, parentRadius: 0.4 },
    { id: "io", parent: "jupiter", uncorrected: 1.9648811528865182, parentRadius: 2.8519182797222786 },
    { id: "triton", parent: "neptune", uncorrected: 0.705302485717489, parentRadius: 1.21197840954359 },
  ];
  for (const sample of cases) {
    const moon = findBody(sample.id);
    const parent = findBody(sample.parent);
    const moonOffset = moonWorldOffset(moon, 0);
    const sep = Math.hypot(moonOffset.x, moonOffset.y, moonOffset.z);
    const distance = CONFIG.minDistance;
    const near = extraZoomCameraNear(distance);
    const parentRadius = visualBodyRadius(parent);
    assert.equal(parentRadius, sample.parentRadius);
    const towardParentAzimuth = Math.atan2(-moonOffset.x, -moonOffset.z);
    const towardParentElevation = Math.asin(Math.max(-1, Math.min(1, -moonOffset.y / sep)));
    assert.ok(towardParentElevation >= -1.2 && towardParentElevation <= 1.2);
    const orbit = focusOrbitOffset(distance, towardParentAzimuth, towardParentElevation);
    const uncorrected = Math.hypot(
      moonOffset.x + orbit.x,
      moonOffset.y + orbit.y,
      moonOffset.z + orbit.z,
    );
    assert.ok(Math.abs(uncorrected - sample.uncorrected) < 1e-9, `${sample.id} uncorrected closest approach`);
    assert.ok(uncorrected < parentRadius, `${sample.id} would clip ${sample.parent} without the guard`);
    const resolved = parentClearCamera(
      moonOffset,
      distance,
      towardParentAzimuth,
      towardParentElevation,
      parentRadius,
      near,
    );
    const safe = parentGlobeClearance(parentRadius, near);
    assert.ok(Math.abs(Math.hypot(resolved.x, resolved.y, resolved.z) - safe) < 1e-9);
    const clearAzimuth = towardParentAzimuth + Math.PI;
    const clearOrbit = focusOrbitOffset(distance, clearAzimuth, towardParentElevation);
    const clearDesired = {
      x: moonOffset.x + clearOrbit.x,
      y: moonOffset.y + clearOrbit.y,
      z: moonOffset.z + clearOrbit.z,
    };
    const clearResolved = resolveParentGlobePoint(
      clearDesired.x,
      clearDesired.y,
      clearDesired.z,
      0,
      0,
      0,
      parentRadius,
      near,
      moonOffset.x,
      moonOffset.y,
      moonOffset.z,
    );
    assert.deepEqual(clearResolved, clearDesired, `${sample.id} opposite angle is unchanged`);
  }
});

test("moon focus acquisition is stable across display refresh rates", () => {
  const moon = findBody("europa");
  const parent = findBody(moon.parent);
  const moonOffset = moonWorldOffset(moon, 0);
  const moonRadius = visualBodyRadius(moon);
  const parentRadius = visualBodyRadius(parent);
  const near = extraZoomCameraNear(CONFIG.minDistance);
  const separation = Math.hypot(moonOffset.x, moonOffset.y, moonOffset.z);
  const axis = {
    x: moonOffset.x / separation,
    y: moonOffset.y / separation,
    z: moonOffset.z / separation,
  };
  const rawStart = focusOrbitOffset(
    CONFIG.cameraDistance,
    CONFIG.cameraAzimuth,
    CONFIG.cameraElevation,
  );
  const startCandidate = {
    x: moonOffset.x + rawStart.x,
    y: moonOffset.y + rawStart.y,
    z: moonOffset.z + rawStart.z,
  };
  const safeStart = resolveParentGlobePoint(
    startCandidate.x,
    startCandidate.y,
    startCandidate.z,
    0,
    0,
    0,
    parentRadius,
    near,
    moonOffset.x,
    moonOffset.y,
    moonOffset.z,
    { moonRadius },
  );
  const start = {
    x: safeStart.x - moonOffset.x,
    y: safeStart.y - moonOffset.y,
    z: safeStart.z - moonOffset.z,
  };
  const rawTarget = parentAxisSeat(
    moonOffset,
    CONFIG.minDistance,
    0,
    tangentToAxis(axis),
  );
  const orbitNormal = moonWorldOrbitNormal(moon);
  const startCap = parentGlobeMaximumViewAngle(
    separation,
    Math.hypot(start.x, start.y, start.z),
    parentRadius,
    near,
    moonRadius,
  );
  const targetCap = parentGlobeMaximumViewAngle(
    separation,
    CONFIG.minDistance,
    parentRadius,
    near,
    moonRadius,
  );
  const run = (refreshRate, seconds) => {
    const route = {};
    const continuity = {};
    let point = start;
    const frames = Math.round(refreshRate * seconds);
    for (let frame = 0; frame < frames; frame += 1) {
      const guardedTarget = resolveParentGlobePoint(
        rawTarget.x,
        rawTarget.y,
        rawTarget.z,
        0,
        0,
        0,
        parentRadius,
        near,
        moonOffset.x,
        moonOffset.y,
        moonOffset.z,
        { moonRadius, continuity, key: moon.id },
      );
      const target = {
        x: guardedTarget.x - moonOffset.x,
        y: guardedTarget.y - moonOffset.y,
        z: guardedTarget.z - moonOffset.z,
      };
      point = moonFocusFlightPoint(
        route,
        start,
        target,
        moonOffset,
        1 / refreshRate,
        parentGlobeClearance(moonRadius, near),
        startCap,
        targetCap,
        orbitNormal,
      );
      assertMoonCameraClear(
        {
          x: moonOffset.x + point.x,
          y: moonOffset.y + point.y,
          z: moonOffset.z + point.z,
        },
        moonOffset,
        Math.hypot(point.x, point.y, point.z),
        parentRadius,
        moonRadius,
        near,
        `Europa ${refreshRate} Hz focus frame ${frame}`,
      );
    }
    return { point, done: route.done };
  };

  for (const seconds of [1 / 6, 0.5, 1, 2, 4]) {
    const samples = [30, 60, 144].map((refreshRate) => run(refreshRate, seconds));
    for (const sample of samples.slice(1)) {
      assert.ok(
        Math.hypot(
          sample.point.x - samples[0].point.x,
          sample.point.y - samples[0].point.y,
          sample.point.z - samples[0].point.z,
        ) < 1e-9,
        `${seconds}s focus seat is refresh-rate independent`,
      );
      assert.equal(sample.done, samples[0].done);
    }
  }
});

test("hidden Io acquisition tightens its sightline cap without a jump", () => {
  const moon = findBody("io");
  const parent = findBody(moon.parent);
  const parentRadius = visualBodyRadius(parent);
  const moonRadius = visualBodyRadius(moon);
  const near = extraZoomCameraNear(5.5);
  const frameSeconds = 1 / 60;
  const startDay = 0.5073460101855686;
  const startDirection = {
    x: 0.5682395213815248,
    y: 0.006583761423826218,
    z: 0.8228368613677987,
  };
  const startDistance = 157.28041766956449;
  const startCamera = {
    x: startDirection.x * startDistance,
    y: startDirection.y * startDistance,
    z: startDirection.z * startDistance,
  };
  const targetDirection = {
    x: 0.15790476658051636,
    y: 0.844350263942033,
    z: -0.5119948402788564,
  };
  const route = {};
  const orbitNormal = moonWorldOrbitNormal(moon);
  let previousDirection = null;
  let previousAxis = null;
  let switchedToFullSightline = false;
  let doneCamera = null;
  let doneMoonOffset = null;

  for (let frame = 0; frame < 360; frame += 1) {
    const days = startDay
      + frame * frameSeconds * CONFIG.defaultDaysPerSecond;
    const moonOffset = moonWorldOffset(moon, days);
    const separation = Math.hypot(moonOffset.x, moonOffset.y, moonOffset.z);
    const axis = {
      x: moonOffset.x / separation,
      y: moonOffset.y / separation,
      z: moonOffset.z / separation,
    };
    if (!route.ready) {
      const safeStart = resolveParentGlobePoint(
        startCamera.x,
        startCamera.y,
        startCamera.z,
        0,
        0,
        0,
        parentRadius,
        near,
      );
      route.fixtureStart = {
        x: safeStart.x - moonOffset.x,
        y: safeStart.y - moonOffset.y,
        z: safeStart.z - moonOffset.z,
      };
      const visibleStart = resolveParentGlobePoint(
        safeStart.x,
        safeStart.y,
        safeStart.z,
        0,
        0,
        0,
        parentRadius,
        near,
        moonOffset.x,
        moonOffset.y,
        moonOffset.z,
        { moonRadius, orbitNormal },
      );
      route.startVisible = Math.hypot(
        visibleStart.x - safeStart.x,
        visibleStart.y - safeStart.y,
        visibleStart.z - safeStart.z,
      ) <= 1e-9;
    }

    const rawTarget = {
      x: moonOffset.x + targetDirection.x * 5.5,
      y: moonOffset.y + targetDirection.y * 5.5,
      z: moonOffset.z + targetDirection.z * 5.5,
    };
    const guardedTarget = resolveParentGlobePoint(
      rawTarget.x,
      rawTarget.y,
      rawTarget.z,
      0,
      0,
      0,
      parentRadius,
      near,
      moonOffset.x,
      moonOffset.y,
      moonOffset.z,
      { moonRadius, orbitNormal },
    );
    const targetOffset = {
      x: guardedTarget.x - moonOffset.x,
      y: guardedTarget.y - moonOffset.y,
      z: guardedTarget.z - moonOffset.z,
    };
    const startRadius = route.ready
      ? route.startRadius
      : Math.hypot(route.fixtureStart.x, route.fixtureStart.y, route.fixtureStart.z);
    const targetRadius = route.ready
      ? route.targetRadius
      : Math.hypot(targetOffset.x, targetOffset.y, targetOffset.z);
    const startCap = route.startVisible
      ? parentGlobeMaximumViewAngle(
        separation,
        startRadius,
        parentRadius,
        near,
        moonRadius,
      )
      : parentGlobeMaximumEndpointAngle(
        separation,
        startRadius,
        parentRadius,
        near,
      );
    const targetCap = parentGlobeMaximumViewAngle(
      separation,
      targetRadius,
      parentRadius,
      near,
      moonRadius,
    );
    const visibleBeforeFrame = route.startVisible;
    const flightOffset = moonFocusFlightPoint(
      route,
      route.fixtureStart,
      targetOffset,
      moonOffset,
      frameSeconds,
      parentGlobeClearance(moonRadius, near),
      startCap,
      targetCap,
      orbitNormal,
    );
    const radius = Math.hypot(flightOffset.x, flightOffset.y, flightOffset.z);
    const camera = {
      x: moonOffset.x + flightOffset.x,
      y: moonOffset.y + flightOffset.y,
      z: moonOffset.z + flightOffset.z,
    };
    const angle = Math.acos(Math.max(-1, Math.min(1, (
      flightOffset.x * moonOffset.x
        + flightOffset.y * moonOffset.y
        + flightOffset.z * moonOffset.z
    ) / (radius * separation))));
    if (
      !route.startVisible
      && angle <= parentGlobeMaximumViewAngle(
        separation,
        radius,
        parentRadius,
        near,
        moonRadius,
      ) + 1e-10
    ) {
      route.startVisible = true;
    }
    switchedToFullSightline ||= !visibleBeforeFrame && route.startVisible;

    assert.ok(
      Math.hypot(camera.x, camera.y, camera.z) + 1e-9
        >= parentGlobeClearance(parentRadius, near),
      `Io hidden-start frame ${frame} keeps its camera outside Jupiter`,
    );
    if (route.startVisible) {
      assertMoonCameraClear(
        camera,
        moonOffset,
        radius,
        parentRadius,
        moonRadius,
        near,
        `Io hidden-start frame ${frame}`,
      );
    }
    const direction = {
      x: flightOffset.x / radius,
      y: flightOffset.y / radius,
      z: flightOffset.z / radius,
    };
    if (previousDirection) {
      const viewMove = Math.acos(Math.max(-1, Math.min(1, dot(
        direction,
        previousDirection,
      ))));
      const axisMove = Math.acos(Math.max(-1, Math.min(1, dot(axis, previousAxis))));
      assert.ok(
        viewMove <= axisMove
          + CONFIG.moonFocusAngularRateRadiansPerSecond * frameSeconds
          + 1e-8,
        `Io hidden-start frame ${frame} stays inside its angular continuity budget`,
      );
    }
    previousDirection = direction;
    previousAxis = axis;
    if (route.done) {
      doneCamera = camera;
      doneMoonOffset = moonOffset;
      break;
    }
  }

  assert.equal(switchedToFullSightline, true, "the fixture reaches the stricter cap");
  assert.equal(route.done, true, "the hidden-start route settles");
  const handoff = resolveParentGlobePoint(
    doneCamera.x,
    doneCamera.y,
    doneCamera.z,
    0,
    0,
    0,
    parentRadius,
    near,
    doneMoonOffset.x,
    doneMoonOffset.y,
    doneMoonOffset.z,
    { moonRadius, orbitNormal },
  );
  assert.ok(
    Math.hypot(
      handoff.x - doneCamera.x,
      handoff.y - doneCamera.y,
      handoff.z - doneCamera.z,
    ) < 1e-9,
    "the hidden-start route hands off without projection",
  );
});

test("guarded moon zoom flights stay continuous in both radial directions", () => {
  const nearDistance = CONFIG.minDistance;
  const farDistance = 1000;
  const frameSeconds = 1 / 60;

  const runLeg = (moon, moonOffset, startOffset, targetDistance, label) => {
    const parent = findBody(moon.parent);
    const parentRadius = visualBodyRadius(parent);
    const moonRadius = visualBodyRadius(moon);
    const orbitNormal = moonWorldOrbitNormal(moon);
    const separation = Math.hypot(moonOffset.x, moonOffset.y, moonOffset.z);
    const startRadius = Math.hypot(startOffset.x, startOffset.y, startOffset.z);
    const startDirection = {
      x: startOffset.x / startRadius,
      y: startOffset.y / startRadius,
      z: startOffset.z / startRadius,
    };
    const targetRadius = extraZoomCameraDistance(targetDistance);
    const startNear = extraZoomCameraNear(startRadius);
    const targetNear = extraZoomCameraNear(targetDistance);
    const rawTarget = {
      x: moonOffset.x + startDirection.x * targetRadius,
      y: moonOffset.y + startDirection.y * targetRadius,
      z: moonOffset.z + startDirection.z * targetRadius,
    };
    const guardedTarget = resolveParentGlobePoint(
      rawTarget.x,
      rawTarget.y,
      rawTarget.z,
      0,
      0,
      0,
      parentRadius,
      targetNear,
      moonOffset.x,
      moonOffset.y,
      moonOffset.z,
      { moonRadius, orbitNormal },
    );
    const targetOffset = {
      x: guardedTarget.x - moonOffset.x,
      y: guardedTarget.y - moonOffset.y,
      z: guardedTarget.z - moonOffset.z,
    };
    const route = { startVisible: true };
    let previousDirection = startDirection;
    let previousRadius = startRadius;
    let finalOffset = null;

    for (let frame = 1; frame <= 360; frame += 1) {
      const flightOffset = moonFocusFlightPoint(
        route,
        startOffset,
        targetOffset,
        moonOffset,
        frameSeconds,
        parentGlobeClearance(moonRadius, startNear),
        parentGlobeMaximumViewAngle(
          separation,
          startRadius,
          parentRadius,
          startNear,
          moonRadius,
        ),
        parentGlobeMaximumViewAngle(
          separation,
          targetRadius,
          parentRadius,
          targetNear,
          moonRadius,
        ),
        orbitNormal,
        parentGlobeClearance(moonRadius, targetNear),
      );
      const radius = Math.hypot(flightOffset.x, flightOffset.y, flightOffset.z);
      const direction = {
        x: flightOffset.x / radius,
        y: flightOffset.y / radius,
        z: flightOffset.z / radius,
      };
      const outwardEnd = route.outwardSeconds;
      const radialEnd = outwardEnd + route.radialSeconds;
      const currentNear = route.elapsed < outwardEnd
        ? startNear
        : route.elapsed < radialEnd
          ? Math.min(startNear, targetNear)
          : targetNear;
      assertMoonCameraClear(
        {
          x: moonOffset.x + flightOffset.x,
          y: moonOffset.y + flightOffset.y,
          z: moonOffset.z + flightOffset.z,
        },
        moonOffset,
        radius,
        parentRadius,
        moonRadius,
        currentNear,
        `${label} frame ${frame}`,
      );
      const angularMove = Math.acos(Math.max(-1, Math.min(1, dot(
        direction,
        previousDirection,
      ))));
      assert.ok(
        angularMove <= CONFIG.moonFocusAngularRateRadiansPerSecond * frameSeconds + 1e-8,
        `${label} frame ${frame} stays inside its angular rate`,
      );
      assert.ok(
        Math.abs(Math.log(radius / previousRadius))
          <= CONFIG.moonFocusRadialLogRatePerSecond * frameSeconds + 1e-12,
        `${label} frame ${frame} stays inside its radial rate`,
      );
      previousDirection = direction;
      previousRadius = radius;
      finalOffset = flightOffset;
      if (route.done) break;
    }

    assert.equal(route.done, true, `${label} settles`);
    const finalCamera = {
      x: moonOffset.x + finalOffset.x,
      y: moonOffset.y + finalOffset.y,
      z: moonOffset.z + finalOffset.z,
    };
    const handoff = resolveParentGlobePoint(
      finalCamera.x,
      finalCamera.y,
      finalCamera.z,
      0,
      0,
      0,
      parentRadius,
      targetNear,
      moonOffset.x,
      moonOffset.y,
      moonOffset.z,
      { moonRadius, orbitNormal },
    );
    assert.ok(
      Math.hypot(
        handoff.x - finalCamera.x,
        handoff.y - finalCamera.y,
        handoff.z - finalCamera.z,
      ) < 1e-9,
      `${label} hands off without projection`,
    );
    return finalOffset;
  };

  for (const moon of BODIES.filter((body) => body.kind === "moon")) {
    const parent = findBody(moon.parent);
    const moonOffset = moonWorldOffset(moon, 0);
    const separation = Math.hypot(moonOffset.x, moonOffset.y, moonOffset.z);
    const near = extraZoomCameraNear(nearDistance);
    const moonRadius = visualBodyRadius(moon);
    const rawNear = {
      x: moonOffset.x - moonOffset.x / separation * nearDistance,
      y: moonOffset.y - moonOffset.y / separation * nearDistance,
      z: moonOffset.z - moonOffset.z / separation * nearDistance,
    };
    const guardedNear = resolveParentGlobePoint(
      rawNear.x,
      rawNear.y,
      rawNear.z,
      0,
      0,
      0,
      visualBodyRadius(parent),
      near,
      moonOffset.x,
      moonOffset.y,
      moonOffset.z,
      { moonRadius, orbitNormal: moonWorldOrbitNormal(moon) },
    );
    const nearOffset = {
      x: guardedNear.x - moonOffset.x,
      y: guardedNear.y - moonOffset.y,
      z: guardedNear.z - moonOffset.z,
    };
    const farOffset = runLeg(
      moon,
      moonOffset,
      nearOffset,
      farDistance,
      `${moon.id} near-to-far zoom`,
    );
    runLeg(
      moon,
      moonOffset,
      farOffset,
      nearDistance,
      `${moon.id} far-to-near zoom`,
    );
  }
});

test("moon-relative focus flights settle while every catalog moon moves at maximum speed", () => {
  const frameSeconds = 1 / 60;
  const rawTargetOffset = focusOrbitOffset(5.5, CONFIG.cameraAzimuth, CONFIG.cameraElevation);
  const startCamera = focusOrbitOffset(
    CONFIG.cameraDistance,
    CONFIG.cameraAzimuth,
    CONFIG.cameraElevation,
  );
  for (const moon of BODIES.filter((body) => body.kind === "moon")) {
    const parent = findBody(moon.parent);
    const parentRadius = visualBodyRadius(parent);
    const moonRadius = visualBodyRadius(moon);
    const near = extraZoomCameraNear(5.5);
    const firstMoonOffset = moonWorldOffset(moon, 0);
    const safeStart = resolveParentGlobePoint(
      startCamera.x,
      startCamera.y,
      startCamera.z,
      0,
      0,
      0,
      parentRadius,
      near,
      firstMoonOffset.x,
      firstMoonOffset.y,
      firstMoonOffset.z,
      { moonRadius },
    );
    const startOffset = {
      x: safeStart.x - firstMoonOffset.x,
      y: safeStart.y - firstMoonOffset.y,
      z: safeStart.z - firstMoonOffset.z,
    };
    const route = {};
    const continuity = {};
    const orbitNormal = moonWorldOrbitNormal(moon);
    let settledFrame = null;
    for (let frame = 1; frame <= 420; frame += 1) {
      const days = frame * frameSeconds * CONFIG.maxDaysPerSecond;
      const moonOffset = moonWorldOffset(moon, days);
      const rawTarget = {
        x: moonOffset.x + rawTargetOffset.x,
        y: moonOffset.y + rawTargetOffset.y,
        z: moonOffset.z + rawTargetOffset.z,
      };
      const guardedTarget = resolveParentGlobePoint(
        rawTarget.x,
        rawTarget.y,
        rawTarget.z,
        0,
        0,
        0,
        parentRadius,
        near,
        moonOffset.x,
        moonOffset.y,
        moonOffset.z,
        { moonRadius, continuity, key: moon.id },
      );
      const targetOffset = {
        x: guardedTarget.x - moonOffset.x,
        y: guardedTarget.y - moonOffset.y,
        z: guardedTarget.z - moonOffset.z,
      };
      const separation = Math.hypot(moonOffset.x, moonOffset.y, moonOffset.z);
      const startRadius = route.ready
        ? route.startRadius
        : Math.hypot(startOffset.x, startOffset.y, startOffset.z);
      const targetRadius = route.ready
        ? route.targetRadius
        : Math.hypot(targetOffset.x, targetOffset.y, targetOffset.z);
      const flightOffset = moonFocusFlightPoint(
        route,
        startOffset,
        targetOffset,
        moonOffset,
        frameSeconds,
        parentGlobeClearance(moonRadius, near),
        parentGlobeMaximumViewAngle(
          separation,
          startRadius,
          parentRadius,
          near,
          moonRadius,
        ),
        parentGlobeMaximumViewAngle(
          separation,
          targetRadius,
          parentRadius,
          near,
          moonRadius,
        ),
        orbitNormal,
      );
      const camera = {
        x: moonOffset.x + flightOffset.x,
        y: moonOffset.y + flightOffset.y,
        z: moonOffset.z + flightOffset.z,
      };
      assertMoonCameraClear(
        camera,
        moonOffset,
        Math.hypot(flightOffset.x, flightOffset.y, flightOffset.z),
        parentRadius,
        moonRadius,
        near,
        `${moon.id} maximum-speed focus frame ${frame}`,
      );
      if (route.done) {
        const handoff = resolveParentGlobePoint(
          camera.x,
          camera.y,
          camera.z,
          0,
          0,
          0,
          parentRadius,
          near,
          moonOffset.x,
          moonOffset.y,
          moonOffset.z,
          { moonRadius },
        );
        assert.ok(
          Math.hypot(
            camera.x - handoff.x,
            camera.y - handoff.y,
            camera.z - handoff.z,
          ) < 1e-9,
          `${moon.id} focus flight hands off without a camera snap`,
        );
        settledFrame = frame;
        break;
      }
    }
    assert.ok(
      settledFrame !== null && settledFrame < 300,
      `${moon.id} focus flight settles independently of orbital speed (${settledFrame})`,
    );
  }
});

test("moon focus flight follows a tightening Titan sightline cap", () => {
  const moon = findBody("titan");
  const parent = findBody(moon.parent);
  const parentRadius = visualBodyRadius(parent);
  const moonRadius = visualBodyRadius(moon);
  const near = extraZoomCameraNear(5.5);
  const frameSeconds = 1 / 60;
  const startDay = 7.795552355555556;
  const startOffset = {
    x: -1.9418932796803283,
    y: -2.215580539285327,
    z: -4.644378684417595,
  };
  const rawTargetOffset = {
    x: -startOffset.x,
    y: -startOffset.y,
    z: -startOffset.z,
  };
  const firstMoonOffset = moonWorldOffset(moon, startDay);
  const firstTarget = {
    x: firstMoonOffset.x + rawTargetOffset.x,
    y: firstMoonOffset.y + rawTargetOffset.y,
    z: firstMoonOffset.z + rawTargetOffset.z,
  };
  const guardedTarget = resolveParentGlobePoint(
    firstTarget.x,
    firstTarget.y,
    firstTarget.z,
    0,
    0,
    0,
    parentRadius,
    near,
    firstMoonOffset.x,
    firstMoonOffset.y,
    firstMoonOffset.z,
    { moonRadius },
  );
  const targetOffset = {
    x: guardedTarget.x - firstMoonOffset.x,
    y: guardedTarget.y - firstMoonOffset.y,
    z: guardedTarget.z - firstMoonOffset.z,
  };
  const route = {};
  const orbitNormal = moonWorldOrbitNormal(moon);
  const radius = Math.hypot(...Object.values(startOffset));
  const initialSeparation = Math.hypot(...Object.values(firstMoonOffset));
  const initialCap = parentGlobeMaximumViewAngle(
    initialSeparation,
    radius,
    parentRadius,
    near,
    moonRadius,
  );
  let minimumCap = initialCap;
  let camera = null;
  for (let frame = 0; frame <= 90 && !route.done; frame += 1) {
    const days = startDay + frame * frameSeconds * CONFIG.defaultDaysPerSecond;
    const moonOffset = moonWorldOffset(moon, days);
    const separation = Math.hypot(...Object.values(moonOffset));
    const cap = parentGlobeMaximumViewAngle(
      separation,
      radius,
      parentRadius,
      near,
      moonRadius,
    );
    minimumCap = Math.min(minimumCap, cap);
    const flightOffset = moonFocusFlightPoint(
      route,
      startOffset,
      targetOffset,
      moonOffset,
      frame === 0 ? 0 : frameSeconds,
      parentGlobeClearance(moonRadius, near),
      cap,
      cap,
      orbitNormal,
    );
    camera = {
      x: moonOffset.x + flightOffset.x,
      y: moonOffset.y + flightOffset.y,
      z: moonOffset.z + flightOffset.z,
    };
    assertMoonCameraClear(
      camera,
      moonOffset,
      radius,
      parentRadius,
      moonRadius,
      near,
      `Titan tightening-cap frame ${frame}`,
    );
  }
  assert.ok(initialCap - minimumCap > 1e-6, "the regression actually tightens the cap");
  assert.equal(route.done, true, "the capped Titan flight still settles");
  const finalMoonOffset = moonWorldOffset(
    moon,
    startDay + route.elapsed * CONFIG.defaultDaysPerSecond,
  );
  const handoff = resolveParentGlobePoint(
    camera.x,
    camera.y,
    camera.z,
    0,
    0,
    0,
    parentRadius,
    near,
    finalMoonOffset.x,
    finalMoonOffset.y,
    finalMoonOffset.z,
    { moonRadius },
  );
  assert.ok(
    Math.hypot(camera.x - handoff.x, camera.y - handoff.y, camera.z - handoff.z) < 1e-9,
    "Titan's completed route hands off without projection",
  );
});

test("moon focus transport has one stable exact-antipode branch", () => {
  const firstAxis = { x: 1, y: 0, z: 0 };
  const orbitNormal = { x: 0, y: 0, z: 1 };
  const start = { x: Math.cos(1), y: Math.sin(1), z: 0 };
  const route = {};
  moonFocusFlightPoint(route, start, firstAxis, firstAxis, 0, 0, Math.PI, Math.PI, orbitNormal);
  const initial = JSON.parse(JSON.stringify(route));
  const axes = [-2e-12, 0, 2e-12].map((epsilon) => {
    const length = Math.hypot(-1, epsilon);
    return { x: -1 / length, y: epsilon / length, z: 0 };
  });
  const outputs = axes.map((axis) => {
    const copy = JSON.parse(JSON.stringify(initial));
    const output = moonFocusFlightPoint(
      copy,
      start,
      firstAxis,
      axis,
      0,
      0,
      Math.PI,
      Math.PI,
      orbitNormal,
    );
    const repeated = moonFocusFlightPoint(
      copy,
      start,
      firstAxis,
      axis,
      0,
      0,
      Math.PI,
      Math.PI,
      orbitNormal,
    );
    assert.ok(Object.values(output).every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...Object.values(output)) - 1) < 1e-12);
    assert.ok(Math.hypot(
      output.x + Math.cos(1),
      output.y + Math.sin(1),
      output.z,
    ) < 1e-9, "the signed orbit normal owns the antipodal half-turn");
    assert.ok(Math.hypot(
      output.x - repeated.x,
      output.y - repeated.y,
      output.z - repeated.z,
    ) < 1e-12, "an unchanged antipodal axis cannot drift");
    return output;
  });
  for (const output of outputs.slice(1)) {
    assert.ok(Math.hypot(
      output.x - outputs[0].x,
      output.y - outputs[0].y,
      output.z - outputs[0].z,
    ) < 1e-9, "tiny antipode noise cannot flip the flight path");
  }
});

test("steady Phobos guard removes the reproduced default-play camera jump", () => {
  const moon = findBody("phobos");
  const parent = findBody(moon.parent);
  const parentRadius = visualBodyRadius(parent);
  const moonRadius = visualBodyRadius(moon);
  const radius = 5.5;
  const near = extraZoomCameraNear(radius);
  const rawDirection = {
    x: -0.8085530486960075,
    y: 0.4298845767043531,
    z: -0.4017974840091846,
  };
  const orbitNormal = moonWorldOrbitNormal(moon);
  const continuity = {};
  const maximumAngularStep = CONFIG.moonFocusAngularRateRadiansPerSecond / 60;
  let previousAxis = null;
  let previousDirection = null;
  let activated = false;
  for (let frame = 0; frame <= 700; frame += 1) {
    const days = frame / 60 * CONFIG.defaultDaysPerSecond;
    const moonOffset = moonWorldOffset(moon, days);
    const separation = Math.hypot(...Object.values(moonOffset));
    const axis = {
      x: moonOffset.x / separation,
      y: moonOffset.y / separation,
      z: moonOffset.z / separation,
    };
    const desired = {
      x: moonOffset.x + rawDirection.x * radius,
      y: moonOffset.y + rawDirection.y * radius,
      z: moonOffset.z + rawDirection.z * radius,
    };
    const resolved = resolveParentGlobePoint(
      desired.x,
      desired.y,
      desired.z,
      0,
      0,
      0,
      parentRadius,
      near,
      moonOffset.x,
      moonOffset.y,
      moonOffset.z,
      {
        moonRadius,
        continuity,
        key: moon.id,
        maximumAngularStep,
        orbitNormal,
      },
    );
    activated ||= continuity.active;
    assertMoonCameraClear(
      resolved,
      moonOffset,
      radius,
      parentRadius,
      moonRadius,
      near,
      `Phobos default-play frame ${frame}`,
    );
    const direction = {
      x: (resolved.x - moonOffset.x) / radius,
      y: (resolved.y - moonOffset.y) / radius,
      z: (resolved.z - moonOffset.z) / radius,
    };
    if (previousDirection) {
      const axisMove = Math.acos(Math.max(-1, Math.min(1,
        axis.x * previousAxis.x + axis.y * previousAxis.y + axis.z * previousAxis.z,
      )));
      const viewMove = Math.acos(Math.max(-1, Math.min(1,
        direction.x * previousDirection.x
          + direction.y * previousDirection.y
          + direction.z * previousDirection.z,
      )));
      assert.ok(
        viewMove <= axisMove + maximumAngularStep + 1e-8,
        `Phobos frame ${frame} has no branch jump (${viewMove})`,
      );
    }
    previousAxis = axis;
    previousDirection = direction;
  }
  assert.equal(activated, true, "the exact regression enters the parent guard");
});

test("moon camera continuity resets when focus changes between siblings", () => {
  const parent = findBody("jupiter");
  const parentRadius = visualBodyRadius(parent);
  const continuity = {};
  const solve = (moonId, outward) => {
    const moon = findBody(moonId);
    const moonRadius = visualBodyRadius(moon);
    const moonOffset = moonWorldOffset(moon, 0);
    const sep = Math.hypot(moonOffset.x, moonOffset.y, moonOffset.z);
    const axis = {
      x: moonOffset.x / sep,
      y: moonOffset.y / sep,
      z: moonOffset.z / sep,
    };
    const desired = parentAxisSeat(
      moonOffset,
      CONFIG.minDistance,
      outward ? Math.PI : 0,
      tangentToAxis(axis),
    );
    return {
      desired,
      resolved: resolveParentGlobePoint(
        desired.x,
        desired.y,
        desired.z,
        0,
        0,
        0,
        parentRadius,
        extraZoomCameraNear(CONFIG.minDistance),
        moonOffset.x,
        moonOffset.y,
        moonOffset.z,
        { moonRadius, continuity, key: moon.id },
      ),
    };
  };
  solve("io", false);
  assert.equal(continuity.key, "io");
  assert.equal(continuity.active, true);
  const europa = solve("europa", true);
  assert.deepEqual(europa.resolved, europa.desired, "new moon starts from its exact clear seat");
  assert.equal(continuity.key, "europa");
  assert.equal(continuity.active, false);
});

test("parent-facing moon zoom stays continuous through the parent globe", () => {
  const moons = BODIES.filter((body) => body.kind === "moon");
  assert.equal(moons.length, 9, "zoom sweep covers every catalog moon");
  const crossed = [];
  for (const moon of moons) {
    const parent = findBody(moon.parent);
    const parentRadius = visualBodyRadius(parent);
    const moonRadius = visualBodyRadius(moon);
    const moonOffset = moonWorldOffset(moon, 0);
    const sep = Math.hypot(moonOffset.x, moonOffset.y, moonOffset.z);
    const towardParentAzimuth = Math.atan2(-moonOffset.x, -moonOffset.z);
    const towardParentElevation = Math.asin(Math.max(-1, Math.min(1, -moonOffset.y / sep)));
    assert.ok(towardParentElevation >= -1.2 && towardParentElevation <= 1.2);
    const nearAtMin = extraZoomCameraNear(CONFIG.minDistance);
    const safeAtMin = parentGlobeClearance(parentRadius, nearAtMin);
    const samples = [];
    const continuity = {};
    const key = `${parent.id}:${moon.id}`;
    for (let distance = CONFIG.minDistance; distance <= CONFIG.solarMaxDistance; distance *= 1.01) {
      samples.push(distance);
    }
    for (const radius of [sep - safeAtMin, sep, sep + safeAtMin, Math.hypot(sep, safeAtMin)]) {
      if (radius >= CONFIG.minDistance && radius <= CONFIG.solarMaxDistance) samples.push(radius);
    }
    samples.push(CONFIG.solarMaxDistance);
    samples.sort((a, b) => a - b);

    let previous = null;
    let desiredInside = false;
    for (const distance of samples) {
      const near = extraZoomCameraNear(distance);
      const safe = parentGlobeClearance(parentRadius, near);
      const radius = extraZoomCameraDistance(distance);
      const resolved = parentClearCamera(
        moonOffset,
        distance,
        towardParentAzimuth,
        towardParentElevation,
        parentRadius,
        near,
        { moonRadius, continuity, key },
      );
      const moonDist = Math.hypot(
        resolved.x - moonOffset.x,
        resolved.y - moonOffset.y,
        resolved.z - moonOffset.z,
      );
      assertMoonCameraClear(
        resolved,
        moonOffset,
        radius,
        parentRadius,
        moonRadius,
        near,
        `${moon.id} parent-facing zoom`,
      );
      const orbit = focusOrbitOffset(distance, towardParentAzimuth, towardParentElevation);
      const desiredDist = Math.hypot(
        moonOffset.x + orbit.x,
        moonOffset.y + orbit.y,
        moonOffset.z + orbit.z,
      );
      if (desiredDist < safe) {
        desiredInside = true;
        assert.ok(
          Math.abs(moonDist - radius) < 1e-9,
          `${moon.id} interior seat keeps its moon-orbit radius`,
        );
        if (desiredDist < 1e-9) {
          const side = resolved.x * moonOffset.x + resolved.y * moonOffset.y + resolved.z * moonOffset.z;
          assert.ok(side > 0, `${moon.id} crossing stays on the moon side of ${parent.id}`);
        }
      }
      if (previous) {
        const move = Math.hypot(
          resolved.x - previous.x,
          resolved.y - previous.y,
          resolved.z - previous.z,
        );
        const radiusDelta = Math.abs(radius - previous.radius);
        if (desiredDist < safe * 2 || previous.desiredDist < safe * 2) {
          assert.ok(
            move < safe * 1.2,
            `${moon.id} zoom does not flip through ${parent.id} (move=${move})`,
          );
        }
        assert.ok(
          move < radiusDelta * 20 + 0.05,
          `${moon.id} zoom stays continuous (move=${move}, dr=${radiusDelta})`,
        );
      }
      previous = { ...resolved, radius, desiredDist };
    }
    if (desiredInside) crossed.push(moon.id);
    else assert.equal(moon.id, "phobos", "only Phobos never enters Mars on this alignment");
  }
  assert.deepEqual(
    crossed,
    ["moon", "deimos", "io", "europa", "ganymede", "callisto", "titan", "triton"],
  );
});

function tangentToAxis(axis) {
  const tangent = Math.abs(axis.y) < 0.9
    ? { x: axis.z, y: 0, z: -axis.x }
    : { x: 0, y: axis.z, z: -axis.y };
  const length = Math.hypot(tangent.x, tangent.y, tangent.z);
  return { x: tangent.x / length, y: tangent.y / length, z: tangent.z / length };
}

function parentAxisSeat(moonOffset, radius, angle, tangent) {
  const sep = Math.hypot(moonOffset.x, moonOffset.y, moonOffset.z);
  const axis = {
    x: moonOffset.x / sep,
    y: moonOffset.y / sep,
    z: moonOffset.z / sep,
  };
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: moonOffset.x + radius * (-axis.x * cos + tangent.x * sin),
    y: moonOffset.y + radius * (-axis.y * cos + tangent.y * sin),
    z: moonOffset.z + radius * (-axis.z * cos + tangent.z * sin),
  };
}

test("moon camera guard preserves every clear seat and clears every blocked sightline", () => {
  const moons = BODIES.filter((body) => body.kind === "moon");
  const endpointInterior = [];
  const farSightlineBlocked = [];

  for (const moon of moons) {
    const parent = findBody(moon.parent);
    const parentRadius = visualBodyRadius(parent);
    const moonRadius = visualBodyRadius(moon);
    const phaseZero = moonWorldOffset(moon, 0);
    const phaseZeroSep = Math.hypot(phaseZero.x, phaseZero.y, phaseZero.z);
    const interiorRadius = Math.max(CONFIG.minDistance, phaseZeroSep);
    const interiorNear = extraZoomCameraNear(interiorRadius);
    if (
      Math.abs(phaseZeroSep - interiorRadius)
      < parentGlobeClearance(parentRadius, interiorNear)
    ) endpointInterior.push(moon.id);

    for (let phase = 0; phase < 8; phase += 1) {
      const days = Math.abs(moon.orbitDays) * phase / 8;
      const moonOffset = moonWorldOffset(moon, days);
      const sep = Math.hypot(moonOffset.x, moonOffset.y, moonOffset.z);
      const distances = [
        CONFIG.minDistance,
        5.5,
        Math.max(CONFIG.minDistance, sep),
        Math.max(CONFIG.minDistance, sep + parentRadius * 1.05 + 2),
      ];
      for (const distance of distances) {
        const radius = extraZoomCameraDistance(distance);
        const near = extraZoomCameraNear(distance);
        const safe = parentGlobeClearance(parentRadius, near);
        const visibility = parentGlobeClearance(parentRadius, 0);
        for (const elevation of [-0.8, 0, 0.8]) {
          for (let step = 0; step < 12; step += 1) {
            const azimuth = step * Math.PI / 6;
            const orbit = focusOrbitOffset(distance, azimuth, elevation);
            const desired = {
              x: moonOffset.x + orbit.x,
              y: moonOffset.y + orbit.y,
              z: moonOffset.z + orbit.z,
            };
            const desiredEndpoint = Math.hypot(desired.x, desired.y, desired.z);
            const desiredSightline = moonSightlineSquaredMargin(
              desired,
              moonOffset,
              visibility,
              moonRadius,
            );
            const resolved = resolveParentGlobePoint(
              desired.x,
              desired.y,
              desired.z,
              0,
              0,
              0,
              parentRadius,
              near,
              moonOffset.x,
              moonOffset.y,
              moonOffset.z,
              { moonRadius },
            );
            assertMoonCameraClear(
              resolved,
              moonOffset,
              radius,
              parentRadius,
              moonRadius,
              near,
              `${moon.id} phase ${phase} seat ${step}`,
            );
            if (desiredEndpoint > safe + 1e-9 && desiredSightline > 1e-8) {
              assert.deepEqual(
                resolved,
                desired,
                `${moon.id} endpoint- and sightline-clear seat stays exact`,
              );
            }
          }
        }
      }
    }

    const farRadius = Math.max(
      CONFIG.minDistance,
      phaseZeroSep + parentRadius * CONFIG.focusSurfaceClearance + 2,
    );
    const farNear = extraZoomCameraNear(farRadius);
    const farTangent = tangentToAxis({
      x: phaseZero.x / phaseZeroSep,
      y: phaseZero.y / phaseZeroSep,
      z: phaseZero.z / phaseZeroSep,
    });
    const farDesired = parentAxisSeat(phaseZero, farRadius, 0, farTangent);
    assert.ok(
      Math.hypot(farDesired.x, farDesired.y, farDesired.z)
        > parentGlobeClearance(parentRadius, farNear),
      `${moon.id} far-side reproduction endpoint is already clear`,
    );
    assert.ok(
      moonSightlineSquaredMargin(
        farDesired,
        phaseZero,
        parentGlobeClearance(parentRadius, 0),
        moonRadius,
      ) < 0,
      `${moon.id} far-side reproduction is hidden without the sightline guard`,
    );
    farSightlineBlocked.push(moon.id);
  }

  assert.deepEqual(
    endpointInterior,
    ["moon", "deimos", "io", "europa", "ganymede", "callisto", "titan", "triton"],
    "Phobos alone never puts an allowed camera endpoint inside its parent",
  );
  assert.deepEqual(
    farSightlineBlocked,
    moons.map((moon) => moon.id),
    "all nine moons have a reachable endpoint-clear parent-occluded seat",
  );
});

test("moon camera continuity state removes axis jumps, jitter, and drift", () => {
  const moons = BODIES.filter((body) => body.kind === "moon");
  for (const moon of moons) {
    const parent = findBody(moon.parent);
    const parentRadius = visualBodyRadius(parent);
    const moonRadius = visualBodyRadius(moon);
    const moonOffset = moonWorldOffset(moon, 0);
    const sep = Math.hypot(moonOffset.x, moonOffset.y, moonOffset.z);
    const axis = {
      x: moonOffset.x / sep,
      y: moonOffset.y / sep,
      z: moonOffset.z / sep,
    };
    const tangent = tangentToAxis(axis);
    const radius = Math.max(CONFIG.minDistance, sep);
    const near = extraZoomCameraNear(radius);
    const key = `${parent.id}:${moon.id}`;
    const orbitNormal = moonWorldOrbitNormal(moon);
    const maximumAngularStep = CONFIG.moonFocusAngularRateRadiansPerSecond / 60;

    for (const direction of [1, -1]) {
      const continuity = {};
      let previous = null;
      let maximumMove = 0;
      const span = 1.1;
      const steps = 1200;
      for (let step = 0; step <= steps; step += 1) {
        const angle = direction * (-span + 2 * span * step / steps);
        const desired = parentAxisSeat(moonOffset, radius, angle, tangent);
        const resolved = resolveParentGlobePoint(
          desired.x,
          desired.y,
          desired.z,
          0,
          0,
          0,
          parentRadius,
          near,
          moonOffset.x,
          moonOffset.y,
          moonOffset.z,
          { moonRadius, continuity, key, maximumAngularStep, orbitNormal },
        );
        assertMoonCameraClear(
          resolved,
          moonOffset,
          radius,
          parentRadius,
          moonRadius,
          near,
          `${moon.id} ${direction > 0 ? "forward" : "reverse"} orbit ${step}`,
        );
        if (previous) {
          const previousOffset = {
            x: previous.x - moonOffset.x,
            y: previous.y - moonOffset.y,
            z: previous.z - moonOffset.z,
          };
          const resolvedOffset = {
            x: resolved.x - moonOffset.x,
            y: resolved.y - moonOffset.y,
            z: resolved.z - moonOffset.z,
          };
          maximumMove = Math.max(maximumMove, Math.acos(Math.max(-1, Math.min(1,
            (
              previousOffset.x * resolvedOffset.x
                + previousOffset.y * resolvedOffset.y
                + previousOffset.z * resolvedOffset.z
            ) / (radius * radius),
          ))));
        }
        previous = resolved;
      }
      assert.ok(
        maximumMove <= maximumAngularStep + 1e-9,
        `${moon.id} ${direction > 0 ? "forward" : "reverse"} axis crossing is continuous (${maximumMove})`,
      );
    }

    const continuity = {};
    for (let step = 0; step <= 300; step += 1) {
      const angle = -1.1 + (1.1 - 1e-6) * step / 300;
      const desired = parentAxisSeat(moonOffset, radius, angle, tangent);
      resolveParentGlobePoint(
        desired.x,
        desired.y,
        desired.z,
        0,
        0,
        0,
        parentRadius,
        near,
        moonOffset.x,
        moonOffset.y,
        moonOffset.z,
        { moonRadius, continuity, key, maximumAngularStep, orbitNormal },
      );
    }
    let stable = null;
    for (let sample = 0; sample < 16; sample += 1) {
      const desired = parentAxisSeat(
        moonOffset,
        radius,
        sample % 2 === 0 ? -1e-7 : 1e-7,
        tangent,
      );
      const resolved = resolveParentGlobePoint(
        desired.x,
        desired.y,
        desired.z,
        0,
        0,
        0,
        parentRadius,
        near,
        moonOffset.x,
        moonOffset.y,
        moonOffset.z,
        { moonRadius, continuity, key, maximumAngularStep, orbitNormal },
      );
      assertMoonCameraClear(
        resolved,
        moonOffset,
        radius,
        parentRadius,
        moonRadius,
        near,
        `${moon.id} axis jitter ${sample}`,
      );
      if (stable) {
        assert.ok(
          Math.hypot(
            resolved.x - stable.x,
            resolved.y - stable.y,
            resolved.z - stable.z,
          ) < 1e-6,
          `${moon.id} tiny parent-axis jitter does not oscillate`,
        );
      }
      stable = resolved;
    }
    const repeated = resolveParentGlobePoint(
      moonOffset.x - axis.x * radius,
      moonOffset.y - axis.y * radius,
      moonOffset.z - axis.z * radius,
      0,
      0,
      0,
      parentRadius,
      near,
      moonOffset.x,
      moonOffset.y,
      moonOffset.z,
      { moonRadius, continuity, key, maximumAngularStep, orbitNormal },
    );
    const repeatedAgain = resolveParentGlobePoint(
      moonOffset.x - axis.x * radius,
      moonOffset.y - axis.y * radius,
      moonOffset.z - axis.z * radius,
      0,
      0,
      0,
      parentRadius,
      near,
      moonOffset.x,
      moonOffset.y,
      moonOffset.z,
      { moonRadius, continuity, key, maximumAngularStep, orbitNormal },
    );
    assert.ok(
      Math.hypot(
        repeatedAgain.x - repeated.x,
        repeatedAgain.y - repeated.y,
        repeatedAgain.z - repeated.z,
      ) <= maximumAngularStep * radius + 1e-9,
      `${moon.id} repeated input converges without a camera jump`,
    );
    resetParentGlobeContinuity(continuity);
    assert.equal(continuity.active, false);
    assert.equal(continuity.key, null);
  }
});

test("moon camera continuity ignores axial jitter and releases without a snap", () => {
  const parent = findBody("jupiter");
  const moon = findBody("io");
  const parentRadius = visualBodyRadius(parent);
  const moonRadius = visualBodyRadius(moon);
  const moonOffset = { x: 4.5, y: 0, z: 0 };
  const radius = CONFIG.minDistance;
  const near = extraZoomCameraNear(radius);
  const tangent = tangentToAxis({ x: 1, y: 0, z: 0 });
  const continuity = {};
  const key = `${parent.id}:${moon.id}`;
  const maximumAngularStep = CONFIG.moonFocusAngularRateRadiansPerSecond / 60;
  const orbitNormal = { x: 0, y: 1, z: 0 };
  const direction = (point) => ({
    x: (point.x - moonOffset.x) / radius,
    y: (point.y - moonOffset.y) / radius,
    z: (point.z - moonOffset.z) / radius,
  });
  const separation = (a, b) => Math.acos(Math.max(-1, Math.min(1,
    a.x * b.x + a.y * b.y + a.z * b.z,
  )));
  let previous = null;
  const solve = (desired, label) => {
    const resolved = resolveParentGlobePoint(
      desired.x,
      desired.y,
      desired.z,
      0,
      0,
      0,
      parentRadius,
      near,
      moonOffset.x,
      moonOffset.y,
      moonOffset.z,
      { moonRadius, continuity, key, maximumAngularStep, orbitNormal },
    );
    assertMoonCameraClear(
      resolved,
      moonOffset,
      radius,
      parentRadius,
      moonRadius,
      near,
      label,
    );
    const next = direction(resolved);
    if (previous) {
      assert.ok(
        separation(previous, next) <= maximumAngularStep + 1e-9,
        `${label} stays inside the angular continuity budget`,
      );
    }
    previous = next;
    return resolved;
  };

  const steps = 600;
  for (let step = 0; step <= steps; step += 1) {
    const angle = -0.5 + step / steps;
    solve(parentAxisSeat(moonOffset, radius, angle, tangent), `Io crossing ${step}`);
  }

  const coreStart = previous;
  for (let sample = 0; sample < 128; sample += 1) {
    const angle = sample % 2 === 0 ? -1e-11 : 1e-11;
    solve(parentAxisSeat(moonOffset, radius, angle, tangent), `Io axial jitter ${sample}`);
    assert.ok(
      separation(previous, coreStart) <= 1e-9,
      "sub-pixel axial jitter cannot wind the guarded seat",
    );
  }

  const clearDesired = parentAxisSeat(moonOffset, radius, Math.PI, tangent);
  let clearResolved = null;
  for (let frame = 0; frame < 180 && continuity.active; frame += 1) {
    clearResolved = solve(clearDesired, `Io clear-seat release ${frame}`);
  }
  assert.equal(continuity.active, false, "the bounded guard eventually releases a clear seat");
  assert.deepEqual(clearResolved, clearDesired, "release ends at the exact requested clear seat");
  assert.deepEqual(
    solve(clearDesired, "Io inactive clear seat"),
    clearDesired,
    "an inactive clear seat passes through bit-exactly",
  );

  resetParentGlobeContinuity(continuity);
  assert.deepEqual(continuity, { key: null, active: false });
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
  assert.match(galaxySource, /orientMapFrame\(THREE, map\)/);
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
  assert.match(galaxySource, /createFarGalaxySky\(THREE, group\)/);
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
  assert.ok(
    neighborApparentSize(m31) < milkyWayDiskDiameter(),
    "Andromeda stays smaller than the Milky Way disk",
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
