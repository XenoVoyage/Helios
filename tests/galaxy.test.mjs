import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG, pinchZoomDistance, wheelZoomMultiplier } from "../js/config.js";
import { visualOrbit } from "../js/bodies.js";
import { equatorialToGalactic } from "../js/sky.js";
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
  findLocalGroupMember,
  findNeighbor,
  findSpiralArm,
  localGroupFamily,
} from "../js/galaxy-catalog.js";
import {
  armPointKpc,
  farthestNeighborhoodDistance,
  farthestUniverseDistance,
  farthestVirgoDistance,
  farthestWebDistance,
  galacticCenterScenePosition,
  celestialSkyOpacity,
  extraZoomCameraDistance,
  extraZoomCameraNear,
  extraZoomTailMix,
  farGalaxySkyRadius,
  galaxyOpacity,
  heliocentricGalactic,
  localGroupCameraAim,
  localGroupMemberOpacity,
  milkyWayBelowCameraAim,
  milkyWayInteriorCameraAim,
  milkyWayTailLookAt,
  milkyWayTailSeat,
  lookAngleTo,
  milkyWayDiskDiameter,
  milkyWayDiskOpacity,
  milkyWayToScene,
  milkyWayUnitsPerKpc,
  cmbSkyOpacity,
  deepFieldOpacity,
  farGalaxySkyOpacity,
  nearClusterOpacity,
  neighborhoodCameraAim,
  neighborApparentSize,
  neighborOpacity,
  neighborScenePosition,
  orbitLineOpacity,
  orreryScale,
  scaleLayer,
  skyBandBrightness,
  skyStarBrightness,
  skyStaysOn,
  solarOpacity,
  spiralRadiusKpc,
  sunPinOpacity,
  sunScenePosition,
  universeOpacity,
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
  const orion = findSpiralArm("orion");
  assert.equal(orion.name, "Orion Arm");
  assert.ok(orion.rKinkKpc > 8.2 && orion.rKinkKpc < 8.4);
  const atSun = spiralRadiusKpc(orion, 0);
  assert.ok(Math.abs(atSun - SUN_GALACTIC.rKpc) < 0.5, "Orion Arm passes near the Sun");
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
  assert.equal(
    galaxyOpacity(CONFIG.handoffViewDistance - 1),
    0,
    "MW stays off while the orrery shrinks to a pin",
  );
  assert.equal(
    solarOpacity(CONFIG.handoffViewDistance - 1),
    1,
    "solar stays up until the pin handoff",
  );
  assert.equal(
    galaxyOpacity(CONFIG.handoffViewDistance),
    1,
    "MW is full brightness as soon as it is the subject",
  );
  assert.equal(
    solarOpacity(CONFIG.handoffViewDistance),
    0,
    "solar does not blend with the MW disk",
  );
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
    "catalog neighbors wait until the disk is leaving the tail",
  );
  assert.equal(localGroupMemberOpacity(CONFIG.neighborhoodViewDistance), 0);
  assert.equal(localGroupMemberOpacity(CONFIG.localGroupViewDistance), 1);
  assert.equal(virgoOpacity(CONFIG.localGroupViewDistance), 0);
  assert.equal(virgoOpacity(CONFIG.virgoViewDistance), 1);
  assert.equal(nearClusterOpacity(CONFIG.localGroupViewDistance), 0);
  assert.equal(
    nearClusterOpacity(CONFIG.virgoViewDistance),
    0,
    "other clusters wait until after Virgo, then approach the way Virgo did",
  );
  assert.ok(
    nearClusterOpacity(CONFIG.virgoViewDistance + (CONFIG.webViewDistance - CONFIG.virgoViewDistance) * 0.42) > 0.95,
    "clusters are in by the pre-web look",
  );
  assert.equal(webOpacity(CONFIG.virgoViewDistance), 0);
  assert.equal(
    webOpacity(CONFIG.virgoViewDistance + (CONFIG.webViewDistance - CONFIG.virgoViewDistance) * 0.55),
    0,
    "Virgo lingers before the web takes over",
  );
  assert.ok(
    deepFieldOpacity(CONFIG.virgoViewDistance + (CONFIG.webViewDistance - CONFIG.virgoViewDistance) * 0.55) > 0.7,
    "galaxy images densify after Virgo before filaments",
  );
  assert.equal(deepFieldOpacity(CONFIG.virgoViewDistance), 0);
  assert.equal(deepFieldOpacity(CONFIG.webViewDistance), 0);
  assert.equal(webOpacity(CONFIG.webViewDistance), 1);
  assert.equal(
    universeOpacity(CONFIG.webViewDistance),
    1,
    "web look uses the volume-filling web, not the local home-hub ball",
  );
  assert.equal(
    universeOpacity(CONFIG.webViewDistance + (CONFIG.universeViewDistance - CONFIG.webViewDistance) * 0.2),
    1,
    "the filled web stays up until the last outside sphere",
  );
  assert.equal(universeOpacity(CONFIG.universeViewDistance), 1);
  assert.equal(nearClusterOpacity(CONFIG.webViewDistance), 0);
  assert.equal(
    farGalaxySkyOpacity(CONFIG.handoffViewDistance),
    1,
    "galaxy-image sky is already up in the tail",
  );
  assert.equal(
    farGalaxySkyOpacity(CONFIG.handoffViewDistance + (CONFIG.mwViewDistance - CONFIG.handoffViewDistance) * 0.90),
    1,
    "galaxy-image sky is the extra-zoom background while the disk is growing",
  );
  assert.equal(
    farGalaxySkyOpacity(CONFIG.mwViewDistance),
    1,
    "distant galaxy-image sky stays up on the full-disk frame",
  );
  assert.equal(
    farGalaxySkyOpacity(CONFIG.neighborhoodViewDistance),
    1,
    "distant galaxy-image sky stays up through the neighborhood",
  );
  assert.equal(
    farGalaxySkyOpacity(CONFIG.virgoViewDistance),
    1,
    "distant galaxy-image sky stays up at Virgo",
  );
  assert.equal(
    farGalaxySkyOpacity(CONFIG.localGroupViewDistance),
    1,
    "distant galaxy-image sky stays up at Local Group",
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
  assert.equal(
    farGalaxySkyOpacity(CONFIG.universeViewDistance),
    0,
    "far-galaxy sky yields to the CMB sphere outside",
  );
  assert.ok(
    CONFIG.webViewDistance < farthestUniverseDistance() * 0.92,
    "web look sits inside the volume-filling web, not outside a ball",
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

test("solar skybox stays through the tail and the camera sits in the arm", () => {
  assert.equal(skyStaysOn(CONFIG.cameraDistance), true);
  assert.equal(skyStaysOn(CONFIG.solarMaxDistance), true);
  assert.equal(skyStaysOn(CONFIG.solarMaxDistance + 1), true);
  assert.equal(skyStaysOn(CONFIG.handoffViewDistance), false);
  assert.equal(skyStaysOn(CONFIG.mwViewDistance), false);
  assert.equal(skyStaysOn(CONFIG.neighborhoodViewDistance), false);
  assert.equal(celestialSkyOpacity(CONFIG.solarMaxDistance), 1);
  assert.equal(celestialSkyOpacity(CONFIG.handoffViewDistance), 0);
  assert.equal(celestialSkyOpacity(CONFIG.mwViewDistance), 0);
  assert.equal(celestialSkyOpacity(CONFIG.neighborhoodViewDistance), 0);
  assert.equal(milkyWayDiskOpacity(CONFIG.handoffViewDistance - 1), 0);
  assert.equal(
    milkyWayDiskOpacity(CONFIG.handoffViewDistance),
    1,
    "first extra-zoom is already inside the local arm / disk trail",
  );
  assert.equal(milkyWayDiskOpacity(CONFIG.mwViewDistance), 1);
  assert.equal(sunPinOpacity(CONFIG.handoffViewDistance), 0);
  assert.equal(sunPinOpacity(CONFIG.mwViewDistance), 1);
  assert.equal(farGalaxySkyOpacity(CONFIG.handoffViewDistance), 1);
  assert.equal(farGalaxySkyOpacity(CONFIG.mwViewDistance), 1);
  assert.equal(skyBandBrightness(CONFIG.cameraDistance), 0.82);
  assert.ok(
    skyBandBrightness(CONFIG.solarMaxDistance) > skyBandBrightness(CONFIG.cameraDistance),
    "solar sky brightens on the way out to the cap",
  );
  assert.ok(
    skyStarBrightness(CONFIG.solarMaxDistance) > 3,
    "stars at the solar cap fill the frame, not a dim leftover sky",
  );
  assert.equal(
    skyBandBrightness(CONFIG.handoffViewDistance),
    0,
    "Gaia band is off the moment extra-zoom begins; the tail is the local arm, not the solar skybox",
  );
  assert.equal(
    skyBandBrightness(CONFIG.mwViewDistance),
    0,
    "full-disk frame has no solar MW band",
  );
  assert.equal(skyStarBrightness(CONFIG.cameraDistance), 1);
  assert.equal(
    skyStarBrightness(CONFIG.handoffViewDistance),
    0,
    "Hipparcos is off after the tail",
  );
  assert.equal(skyStarBrightness(CONFIG.mwViewDistance), 0);
  assert.ok(
    extraZoomTailMix(CONFIG.handoffViewDistance + (CONFIG.mwViewDistance - CONFIG.handoffViewDistance) * 0.90) < 0.2,
    "growing look has already left the tail seat",
  );
  const interior = milkyWayInteriorCameraAim();
  assert.ok(interior.elevation < 0.12, "first extra-zoom look stays in the disk tail");
  assert.ok(interior.elevation > 0, "interior look is not from under the plane");
  assert.equal(extraZoomCameraDistance(CONFIG.cameraDistance), CONFIG.cameraDistance);
  assert.equal(
    extraZoomCameraDistance((CONFIG.solarMaxDistance + CONFIG.handoffViewDistance) / 2),
    CONFIG.solarMaxDistance,
    "transition stays on the solar-cap field until extra-zoom",
  );
  assert.equal(extraZoomCameraDistance(CONFIG.handoffViewDistance), CONFIG.mwTailNearDistance);
  assert.ok(
    extraZoomCameraDistance(CONFIG.handoffViewDistance) < milkyWayDiskDiameter() * 0.03,
    "first extra-zoom camera sits in the arm, not a postcard of the disk",
  );
  assert.ok(extraZoomCameraNear(CONFIG.handoffViewDistance) <= 0.04);
  assert.ok(extraZoomCameraNear(CONFIG.cameraDistance) > extraZoomCameraNear(CONFIG.handoffViewDistance));
  assert.equal(extraZoomCameraDistance(CONFIG.mwViewDistance), CONFIG.mwViewDistance);
  assert.equal(extraZoomTailMix(CONFIG.handoffViewDistance), 1);
  assert.equal(extraZoomTailMix(CONFIG.mwViewDistance), 0);
  assert.equal(
    extraZoomTailMix(CONFIG.handoffViewDistance + (CONFIG.mwViewDistance - CONFIG.handoffViewDistance) * 0.4),
    1,
  );
  const seat = milkyWayTailSeat();
  const along = milkyWayTailLookAt();
  assert.ok(Math.hypot(seat.x, seat.y, seat.z) < milkyWayDiskDiameter() * 0.12, "tail seat stays inside the disk");
  assert.ok(Math.abs(seat.y) < milkyWayDiskDiameter() * 0.03, "tail seat stays in the arm, not above the plate");
  assert.ok(Math.abs(seat.z) > Math.abs(seat.x), "tail seat looks along the arm");
  assert.ok(seat.z * along.z < 0, "tail look goes past the Sun along the arm");
  assert.ok(
    farGalaxySkyRadius() > CONFIG.neighborhoodViewDistance * 8,
    "far-galaxy shell is far past the neighborhood camera",
  );
  assert.ok(farGalaxySkyRadius() > CONFIG.webViewDistance);
  assert.ok(farGalaxySkyRadius() < CONFIG.cameraFar);
});

test("pinch-out zooms out and mouse wheel stays as it is", () => {
  assert.ok(pinchZoomDistance(1000, 40, 80) > 1000, "pinch-out increases camera distance");
  assert.ok(pinchZoomDistance(1000, 40, 20) < 1000, "pinch-in decreases camera distance");
  assert.equal(pinchZoomDistance(1000, 40, 80), 2000);
  assert.equal(pinchZoomDistance(1000, 40, 20), 500);
  assert.ok(wheelZoomMultiplier(100, false) > 1, "positive mouse wheel zooms out");
  assert.ok(wheelZoomMultiplier(100, true) < 1, "touch pinch-out wheel is inverted to zoom out");
  assert.ok(wheelZoomMultiplier(-100, true) > 1, "iOS pinch-out (negative delta) zooms out");
});

test("camera far plane clears the neighborhood and spiral math stays Reid-like", () => {
  const farthest = Math.max(
    farthestNeighborhoodDistance(),
    farthestVirgoDistance(),
    farthestWebDistance(),
    farthestUniverseDistance(),
  );
  assert.ok(CONFIG.cameraFar > CONFIG.maxDistance);
  assert.ok(CONFIG.cameraFar > farthest + CONFIG.maxDistance * 0.25);
  assert.equal(SPIRAL_ARMS.length, 6);
  const orion = findSpiralArm("orion");
  assert.equal(spiralRadiusKpc(orion, orion.betaKinkDeg), orion.rKinkKpc);
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
  assert.ok(gc.x > 0);
  assert.ok(Math.abs(gc.z) < visualMilkyWay(0.1));
  const m31 = neighborScenePosition(findNeighbor("m31"));
  const lmc = neighborScenePosition(findNeighbor("lmc"));
  assert.ok(Math.hypot(m31.x, m31.y, m31.z) > Math.hypot(lmc.x, lmc.y, lmc.z));
  const mapped = milkyWayToScene(SUN_GALACTIC.rKpc, 0, 0);
  assert.ok(Math.abs(mapped.x - visualMilkyWay(SUN_GALACTIC.rKpc)) < 1e-6);
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
  assert.ok(at.y > 0, "Virgo sits at high galactic latitude, +Y in this map");
  assert.ok(len > farthestNeighborhoodDistance());
  assert.ok(CONFIG.cameraFar > farthestVirgoDistance() + CONFIG.maxDistance * 0.25);
});

test("cosmic web keeps Laniakea published size and drops named supercluster pins", async () => {
  assert.equal(LANIAKEA.name, "Laniakea");
  assert.equal(LANIAKEA.also, "Virgo Supercluster");
  assert.equal(LANIAKEA.home, true);
  assert.equal(LANIAKEA.diameterMpc, 160);
  const catalogSource = await readFile(path.join(root, "js/galaxy-catalog.js"), "utf8");
  const galaxySource = await readFile(path.join(root, "js/galaxy.js"), "utf8");
  assert.doesNotMatch(catalogSource, /SUPERCLUSTERS/);
  assert.doesNotMatch(catalogSource, /Perseus-Pisces/);
  assert.doesNotMatch(catalogSource, /\bComa\b/);
  assert.doesNotMatch(catalogSource, /Shapley/);
  assert.doesNotMatch(galaxySource, /You are here/);
  assert.doesNotMatch(galaxySource, /solar-circle/);
  assert.doesNotMatch(galaxySource, /Perseus-Pisces/);
  assert.match(galaxySource, /cosmic-web/);
  assert.match(galaxySource, /cmb-shell/);
  assert.match(galaxySource, /export function createGalaxyLayer/);
  assert.match(galaxySource, /far-galaxy-sky/);
  assert.match(galaxySource, /near-clusters/);
  assert.match(galaxySource, /mw-disk-edge/);
  assert.match(galaxySource, /mw-halo/);
  assert.match(galaxySource, /Large Magellanic Cloud|neighbor\.name/);
  assert.match(galaxySource, /createFarGalaxySky/);
  assert.match(galaxySource, /createDeepField/);
  assert.match(galaxySource, /deep-field/);
  assert.match(galaxySource, /CanvasTexture/);
  assert.match(galaxySource, /toneMapped:\s*false/);
  assert.match(galaxySource, /AdditiveBlending/);
  assert.match(galaxySource, /SKY_ASSETS\.andromeda/);
  assert.match(galaxySource, /quietAndromedaMap|andromeda\.png/);
  assert.doesNotMatch(galaxySource, /if \(pole < 0\.28\) continue/);
  assert.match(galaxySource, /cameraFar \* 0\.42/);
  assert.doesNotMatch(galaxySource, /function farGalaxySkyMap/);
  assert.doesNotMatch(galaxySource, /farGalaxySkyRadius\(\) \* 0\.045/);
  assert.doesNotMatch(galaxySource, /t: 0\.16/);
  assert.match(galaxySource, /createFarGalaxySky\(THREE, group, maps\)/);
  assert.doesNotMatch(galaxySource, /far-galaxy-shell/);
  assert.doesNotMatch(galaxySource, /fillSpherePoints/);
  assert.doesNotMatch(galaxySource, /far-galaxy-blobs/);
  assert.match(galaxySource, /brightenLoadedMap/);
  assert.match(galaxySource, /deepFieldOpacity/);
  assert.doesNotMatch(galaxySource, /kind === "andromeda"/);
  assert.doesNotMatch(galaxySource, /lineWidth = 13/);
  assert.doesNotMatch(galaxySource, /smc: galaxySprite/);
  assert.doesNotMatch(galaxySource, /kind === "smc"/);
  assert.doesNotMatch(galaxySource, /export \{\s*CMB_SHELL/);
  assert.match(galaxySource, /farGalaxySkyOpacity/);
  assert.match(galaxySource, /cmbSkyOpacity/);
  assert.match(galaxySource, /milkyWayDiskOpacity/);
  assert.match(galaxySource, /sunPinOpacity/);
  assert.match(galaxySource, /mw-arm-trail/);
  assert.match(galaxySource, /mw-arm-sun/);
  assert.match(galaxySource, /extraZoomCameraNear/);
  assert.match(galaxySource, /skyStaysOn/);
  assert.match(galaxySource, /attachFarGalaxySky/);
  assert.match(galaxySource, /sun-pin-mark/);
  assert.match(galaxySource, /sun-nearby-mark/);
  assert.match(galaxySource, /toneMapped:\s*false/);
  assert.match(galaxySource, /unlitSprite|toneMapped:\s*false/);
  assert.doesNotMatch(galaxySource, /hubCount:\s*20\b/);
  assert.match(galaxySource, /includeHome:\s*false/);
  assert.match(galaxySource, /depthTest:\s*false/);
  assert.match(galaxySource, /fog:\s*false/);
  assert.match(galaxySource, /name = "cmb-sphere"/);
  assert.match(galaxySource, /side:\s*THREE\.DoubleSide/);
  assert.match(galaxySource, /return distance >= CONFIG\.handoffViewDistance \? 1 : 0/);
  assert.doesNotMatch(galaxySource, /far-galaxy-glow/);
  assert.match(
    galaxySource,
    /export function universeOpacity\(distance\) \{\s*return webOpacity\(distance\);/,
  );
  assert.doesNotMatch(galaxySource, /Math\.max\(web, universe/);
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
    "the filled web surrounds the web camera",
  );
  assert.doesNotMatch(galaxySource, /BoxGeometry/);
  assert.equal(visualWeb(CONFIG.webRadiusMpc), CONFIG.webScale * CONFIG.webRadiusMpc ** CONFIG.webPower);
  assert.ok(visualWeb(80) > visualWeb(16.5));
  assert.ok(farthestWebDistance() >= visualWeb(CONFIG.webRadiusMpc));
  const virgoHub = webHubScenePosition({
    lDeg: VIRGO_CLUSTER.lDeg,
    bDeg: VIRGO_CLUSTER.bDeg,
    distanceMpc: VIRGO_CLUSTER.distanceMpc,
  });
  assert.ok(Math.abs(Math.hypot(virgoHub.x, virgoHub.y, virgoHub.z) - visualWeb(16.5)) < 1e-6);
  assert.notEqual(visualWeb(16.5), visualVirgo(16500));
});

test("observable universe keeps the Planck 2018 comoving radius", () => {
  assert.equal(OBSERVABLE_UNIVERSE.comovingRadiusGly, 46.5);
  assert.equal(OBSERVABLE_UNIVERSE.comovingRadiusGpc, 14.25);
  assert.equal(OBSERVABLE_UNIVERSE.lyPerGpc, 3.26156);
  const fromGpc = OBSERVABLE_UNIVERSE.comovingRadiusGpc * OBSERVABLE_UNIVERSE.lyPerGpc;
  assert.ok(Math.abs(fromGpc - 46.5) < 0.03);
  assert.equal(
    visualUniverse(OBSERVABLE_UNIVERSE.comovingRadiusGpc),
    CONFIG.universeScale * 14.25 ** CONFIG.universePower,
  );
  assert.equal(CMB_SHELL.name, "CMB");
  assert.equal(CMB_SHELL.comovingRadiusGpc, OBSERVABLE_UNIVERSE.comovingRadiusGpc);
  assert.equal(CMB_SHELL.map, "assets/sky/cmb.jpg");
  assert.ok(farthestUniverseDistance() > farthestWebDistance());
  assert.ok(CONFIG.cameraFar > farthestUniverseDistance() + CONFIG.maxDistance * 0.25);
  assert.ok(CONFIG.maxDistance >= CONFIG.universeViewDistance);
});
