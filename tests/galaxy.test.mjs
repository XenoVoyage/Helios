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
  MILKY_WAY,
  NEIGHBORS,
  SPIRAL_ARMS,
  SUN_GALACTIC,
  findNeighbor,
  findSpiralArm,
} from "../js/galaxy-catalog.js";
import {
  armPointKpc,
  farthestNeighborhoodDistance,
  galacticCenterScenePosition,
  galaxyOpacity,
  heliocentricGalactic,
  milkyWayToScene,
  milkyWayUnitsPerKpc,
  neighborScenePosition,
  scaleLayer,
  solarOpacity,
  spiralRadiusKpc,
  sunScenePosition,
  visualMilkyWay,
  visualNeighborhood,
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
  assert.notEqual(visualMilkyWay(1), visualOrbit(1));
  assert.notEqual(visualNeighborhood(1), visualOrbit(1));
  assert.notEqual(visualMilkyWay(8.178), visualNeighborhood(8.178));
  assert.ok(visualNeighborhood(findNeighbor("m31").distanceKpc) > visualNeighborhood(findNeighbor("lmc").distanceKpc));
  assert.ok(visualNeighborhood(findNeighbor("m33").distanceKpc) > visualNeighborhood(findNeighbor("m31").distanceKpc));
  assert.ok(visualNeighborhood(findNeighbor("smc").distanceKpc) > visualNeighborhood(findNeighbor("lmc").distanceKpc));

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
  assert.ok(CONFIG.maxDistance >= CONFIG.neighborhoodViewDistance);
  assert.equal(scaleLayer(CONFIG.cameraDistance), "solar");
  assert.equal(scaleLayer(CONFIG.solarMaxDistance), "solar");
  assert.equal(scaleLayer((CONFIG.galaxyFadeStart + CONFIG.galaxyFadeEnd) / 2), "transition");
  assert.equal(scaleLayer(CONFIG.mwViewDistance), "milkyway");
  assert.equal(scaleLayer(CONFIG.neighborhoodViewDistance), "neighborhood");
  assert.equal(solarOpacity(CONFIG.cameraDistance), 1);
  assert.equal(galaxyOpacity(CONFIG.cameraDistance), 0);
  assert.equal(solarOpacity(CONFIG.galaxyFadeEnd), 0);
  assert.equal(galaxyOpacity(CONFIG.galaxyFadeEnd), 1);
  assert.ok(galaxyOpacity(CONFIG.mwViewDistance) === 1);
});

test("camera far plane clears the neighborhood and spiral math stays Reid-like", () => {
  const farthest = farthestNeighborhoodDistance();
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
