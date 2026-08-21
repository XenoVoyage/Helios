import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFIG,
  isShortcutTargetInteractive,
  pinchZoomDistance,
  wheelZoomMultiplier,
} from "../js/config.js";
import { visualOrbit } from "../js/bodies.js";
import { equatorialToGalactic } from "../js/sky.js";
import {
  CMB_SHELL,
  GALACTIC_CENTER,
  LANIAKEA,
  LOCAL_GROUP,
  MILKY_WAY,
  NEIGHBORS,
  PARTICLE_HORIZON,
  SUN_GALACTIC,
  VIRGO_CLUSTER,
  findLocalGroupMember,
  findNeighbor,
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
  farGalaxySkyRadius,
  galaxyOpacity,
  heliocentricGalactic,
  localGroupCameraAim,
  localGroupMemberOpacity,
  neighborBodyOpacity,
  milkyWayBelowCameraAim,
  milkyWayNameOpacity,
  solarBadgeOpacity,
  milkyWayInteriorCameraAim,
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
  solarDebrisOpacity,
  solarOpacity,
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

test("trail marks: one white Solar System particle, no lingering Sun badge", async () => {
  const galaxySource = await readFile(path.join(root, "js/galaxy.js"), "utf8");
  assert.match(galaxySource, /"Solar System"/, "the trail badge names the Solar System");
  assert.doesNotMatch(
    galaxySource,
    /labelSprite\(THREE, "Sun"[,)]/,
    "no bare Sun badge survives at trail / disk scale",
  );
  assert.match(galaxySource, /solar-seat-star/, "one seat particle marks the Sun's spot");
  assert.match(
    galaxySource,
    /"solar-seat-star",\s*new Float32Array\(\[sun\.x, sun\.y, sun\.z\]\),\s*new Float32Array\(\[1, 1, 1\]\)/,
    "the seat particle is a single white point at the Sun's seat",
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
  assert.ok(interior.elevation < 0.12, "first extra-zoom look stays in the disk tail");
  assert.ok(interior.elevation > 0, "interior look is not from under the plane");
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
  assert.ok(
    farGalaxySkyRadius() > CONFIG.neighborhoodViewDistance * 8,
    "far-galaxy shell is far past the neighborhood camera",
  );
  assert.ok(farGalaxySkyRadius() > CONFIG.webViewDistance);
  assert.ok(farGalaxySkyRadius() < CONFIG.cameraFar);
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
  assert.equal(LANIAKEA.contains, "Local (Virgo) Supercluster");
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
  assert.match(galaxySource, /visibilityCache/);
  assert.match(galaxySource, /cache\.opacity === opacity && cache\.distance === distance/);
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
  assert.match(
    galaxySource,
    /function farGalaxySkyMap/,
    "the sky is the restored galaxy-image skybox texture, not sprites or points",
  );
  assert.match(galaxySource, /side:\s*THREE\.BackSide/);
  assert.doesNotMatch(
    galaxySource,
    /const size = 68000/,
    "no massive sky sprites sitting next to the Milky Way",
  );
  assert.doesNotMatch(galaxySource, /farGalaxySkyRadius\(\) \* 0\.045/);
  assert.doesNotMatch(galaxySource, /t: 0\.16/);
  assert.match(
    galaxySource,
    /collectWebHubs\(seedRandom\(88421\), radius, 168, true\)/,
    "pre-web galaxies sit on the cosmic-web hub positions",
  );
  assert.match(
    galaxySource,
    /hubs = collectWebHubs\(rand, radius, hubCount, includeVirgo, includeHome\)/,
    "the web volume uses the same hub collector",
  );
  assert.match(galaxySource, /createFarGalaxySky\(THREE, group\)/);
  assert.match(galaxySource, /far-galaxy-shell/);
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
    "MW and catalog neighbors yield only to the volume-filling web",
  );
  assert.match(
    galaxySource,
    /sprite\.position\.set\(hub\.x, hub\.y, hub\.z\)/,
    "one separated pre-web galaxy per hub, no scattered clumps",
  );
  assert.doesNotMatch(galaxySource, /const members = 2 \+/);
  assert.match(galaxySource, /extraZoomCameraNear/);
  assert.match(galaxySource, /skyStaysOn/);
  assert.match(galaxySource, /attachFarGalaxySky/);
  assert.doesNotMatch(galaxySource, /sun-nearby/, "no warm Sun blob in the arm");
  assert.match(galaxySource, /toneMapped:\s*false/);
  assert.match(galaxySource, /unlitSprite|toneMapped:\s*false/);
  assert.doesNotMatch(galaxySource, /hubCount:\s*20\b/);
  assert.match(galaxySource, /includeHome:\s*false/);
  assert.match(galaxySource, /depthTest:\s*false/);
  assert.match(galaxySource, /fog:\s*false/);
  assert.match(galaxySource, /name = "cmb-sphere"/);
  assert.match(galaxySource, /side:\s*THREE\.DoubleSide/);
  assert.match(galaxySource, /function handoffBlendStart/);
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
