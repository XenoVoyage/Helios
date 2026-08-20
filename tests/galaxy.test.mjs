import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "../js/config.js";
import { visualOrbit } from "../js/bodies.js";
import { equatorialToGalactic } from "../js/sky.js";
import {
  GALACTIC_CENTER,
  LOCAL_GROUP,
  MILKY_WAY,
  NEIGHBORS,
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
  farthestVirgoDistance,
  galacticCenterScenePosition,
  galaxyOpacity,
  heliocentricGalactic,
  localGroupMemberOpacity,
  milkyWayToScene,
  milkyWayUnitsPerKpc,
  neighborScenePosition,
  scaleLayer,
  solarOpacity,
  spiralRadiusKpc,
  sunScenePosition,
  virgoOpacity,
  virgoScenePosition,
  visualMilkyWay,
  visualNeighborhood,
  visualVirgo,
} from "../js/galaxy.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
  assert.notEqual(visualMilkyWay(1), visualOrbit(1));
  assert.notEqual(visualNeighborhood(1), visualOrbit(1));
  assert.notEqual(visualVirgo(1000), visualOrbit(1));
  assert.notEqual(visualVirgo(1000), visualNeighborhood(1));
  assert.notEqual(visualVirgo(1000), visualMilkyWay(1));
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
  assert.equal(CONFIG.solarMaxDistance, 1650);
  assert.equal(CONFIG.cameraDistance, 880);
  assert.ok(CONFIG.maxDistance > CONFIG.solarMaxDistance);
  assert.ok(CONFIG.solarMaxDistance < CONFIG.skyRadius);
  assert.ok(CONFIG.maxDistance > CONFIG.skyRadius);
  assert.ok(CONFIG.mwViewDistance > CONFIG.solarMaxDistance);
  assert.ok(CONFIG.neighborhoodViewDistance > CONFIG.mwViewDistance);
  assert.ok(CONFIG.localGroupViewDistance > CONFIG.neighborhoodViewDistance);
  assert.ok(CONFIG.virgoViewDistance > CONFIG.localGroupViewDistance);
  assert.ok(CONFIG.maxDistance >= CONFIG.virgoViewDistance);
  assert.ok(CONFIG.neighborhoodViewDistance > CONFIG.mwViewDistance * 2);
  assert.equal(scaleLayer(CONFIG.cameraDistance), "solar");
  assert.equal(scaleLayer(CONFIG.solarMaxDistance), "solar");
  assert.equal(scaleLayer((CONFIG.galaxyFadeStart + CONFIG.galaxyFadeEnd) / 2), "transition");
  assert.equal(scaleLayer(CONFIG.mwViewDistance), "milkyway");
  assert.equal(scaleLayer(CONFIG.neighborhoodViewDistance), "neighborhood");
  assert.equal(scaleLayer(CONFIG.localGroupViewDistance), "localgroup");
  assert.equal(scaleLayer(CONFIG.virgoViewDistance), "virgo");
  assert.equal(solarOpacity(CONFIG.cameraDistance), 1);
  assert.equal(galaxyOpacity(CONFIG.cameraDistance), 0);
  assert.equal(solarOpacity(CONFIG.galaxyFadeEnd), 0);
  assert.equal(galaxyOpacity(CONFIG.galaxyFadeEnd), 1);
  assert.ok(galaxyOpacity(CONFIG.mwViewDistance) === 1);
  assert.equal(localGroupMemberOpacity(CONFIG.neighborhoodViewDistance), 0);
  assert.equal(localGroupMemberOpacity(CONFIG.localGroupViewDistance), 1);
  assert.equal(virgoOpacity(CONFIG.localGroupViewDistance), 0);
  assert.equal(virgoOpacity(CONFIG.virgoViewDistance), 1);
});

test("camera far plane clears the neighborhood and spiral math stays Reid-like", () => {
  const farthest = Math.max(farthestNeighborhoodDistance(), farthestVirgoDistance());
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
