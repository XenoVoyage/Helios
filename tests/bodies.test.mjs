import assert from "node:assert/strict";
import test from "node:test";
import { CONFIG, formatDaysPerSecond } from "../js/config.js";
import {
  BODIES,
  describeBody,
  findBody,
  keplerOffset,
  ringTextureU,
  solveKepler,
  visualMoonDistance,
  visualOrbit,
  visualRadius,
  visualRingRadius,
} from "../js/bodies.js";

const required = [
  "sun",
  "mercury",
  "venus",
  "earth",
  "moon",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "io",
  "europa",
  "ganymede",
  "callisto",
  "titan",
  "triton",
  "pluto",
  "ceres",
];

test("catalog includes the v1 bodies with published periods, spins, and tilts", () => {
  assert.deepEqual(BODIES.map((body) => body.id).sort(), [...required].sort());
  assert.equal(BODIES.filter((body) => body.kind === "planet").length, 8);
  for (const body of BODIES) {
    assert.ok(body.radiusKm > 0);
    assert.ok(Number.isFinite(body.rotationHours) && body.rotationHours !== 0);
    assert.ok(Number.isFinite(body.tiltDeg));
    if (body.id !== "sun") {
      assert.ok(body.orbitDays !== 0);
      assert.ok(body.eccentricity >= 0 && body.eccentricity < 1);
    }
  }
  assert.ok(findBody("venus").rotationHours < 0);
  assert.ok(findBody("triton").orbitDays < 0);
  assert.ok(findBody("earth").orbitDays > 365 && findBody("earth").orbitDays < 366);
  assert.ok(findBody("jupiter").tiltDeg < 5);
  assert.ok(findBody("uranus").tiltDeg > 90);
});

test("Kepler's equation recovers a circular and an eccentric orbit", () => {
  assert.ok(Math.abs(solveKepler(1.2, 0) - 1.2) < 1e-10);
  const earth = findBody("earth");
  const start = keplerOffset(earth, findBody("sun"), 0);
  const year = keplerOffset(earth, findBody("sun"), earth.orbitDays);
  assert.ok(Math.hypot(year.x - start.x, year.y - start.y, year.z - start.z) < 1e-6);

  const mercury = findBody("mercury");
  const daysToPeri = (-mercury.meanAnomalyDeg / 360) * mercury.orbitDays;
  const peri = keplerOffset(mercury, findBody("sun"), daysToPeri);
  const apo = keplerOffset(mercury, findBody("sun"), daysToPeri + mercury.orbitDays / 2);
  const periR = Math.hypot(peri.x, peri.y, peri.z);
  const apoR = Math.hypot(apo.x, apo.y, apo.z);
  assert.ok(apoR > periR);
});

test("time floor is one simulated hour per real second", () => {
  assert.equal(CONFIG.defaultDaysPerSecond, 1 / 24);
  assert.equal(CONFIG.minDaysPerSecond, 1 / 24);
  assert.ok(CONFIG.maxDaysPerSecond > CONFIG.defaultDaysPerSecond);
  assert.equal(formatDaysPerSecond(CONFIG.defaultDaysPerSecond), "1 h");
  assert.equal(formatDaysPerSecond(8), "8.0 d");
  assert.equal(formatDaysPerSecond(0.25), "6 h");
});

test("visual scale compresses distances more than sizes", () => {
  const sunR = visualRadius(findBody("sun").radiusKm);
  const earthR = visualRadius(findBody("earth").radiusKm);
  const trueSize = findBody("sun").radiusKm / findBody("earth").radiusKm;
  const visualSize = sunR / earthR;
  const trueDist = findBody("pluto").orbitAu / findBody("earth").orbitAu;
  const visualDist = visualOrbit(findBody("pluto").orbitAu) / visualOrbit(findBody("earth").orbitAu);
  assert.ok(visualSize < trueSize / 6);
  assert.ok(visualDist < trueDist / 4);
  assert.ok(trueDist / visualDist > 3);
  assert.ok(trueSize / visualSize > 5);
  const earth = visualOrbit(findBody("earth").orbitAu);
  const jupiter = visualOrbit(findBody("jupiter").orbitAu);
  const saturn = visualOrbit(findBody("saturn").orbitAu);
  assert.ok(saturn - jupiter > earth * 0.45);
  assert.equal(visualOrbit(1), CONFIG.visualScale * CONFIG.orbitScale);
});

test("moons stay outside their parent and the belt sits between Mars and Jupiter", () => {
  for (const moon of BODIES.filter((body) => body.kind === "moon")) {
    const parent = findBody(moon.parent);
    const orbit = visualMoonDistance(moon, parent);
    assert.ok(orbit > visualRadius(parent.radiusKm) + visualRadius(moon.radiusKm));
  }
  const mars = visualOrbit(findBody("mars").orbitAu);
  const jupiter = visualOrbit(findBody("jupiter").orbitAu);
  const ceres = visualOrbit(findBody("ceres").orbitAu);
  assert.ok(ceres > mars && ceres < jupiter);
});

test("Saturn rings are a NASA annulus and Titan stays outside them", () => {
  const saturn = findBody("saturn");
  const titan = findBody("titan");
  assert.ok(saturn.ringInnerKm > saturn.radiusKm);
  assert.ok(saturn.ringOuterKm > saturn.ringInnerKm);
  assert.ok(titan.orbitKm > saturn.ringOuterKm);
  const globe = visualRadius(saturn.radiusKm);
  const inner = visualRingRadius(saturn, saturn.ringInnerKm);
  const outer = visualRingRadius(saturn, saturn.ringOuterKm);
  assert.ok(inner > globe);
  assert.ok(outer > inner);
  assert.equal(ringTextureU(inner, inner, outer), 0);
  assert.equal(ringTextureU(outer, inner, outer), 1);
  assert.ok(Math.abs(ringTextureU((inner + outer) / 2, inner, outer) - 0.5) < 1e-12);
  const titanOrbit = visualMoonDistance(titan, saturn);
  assert.ok(titanOrbit > outer + visualRadius(titan.radiusKm));
});

test("describeBody keeps public facts readable", () => {
  const earth = describeBody(findBody("earth"));
  assert.match(earth.orbitLabel, /day orbit/);
  assert.match(earth.tiltLabel, /tilt/);
  assert.equal(earth.retrograde, false);
  assert.equal(describeBody(findBody("venus")).retrograde, true);
});
