import assert from "node:assert/strict";
import test from "node:test";
import { CONFIG, formatDaysPerSecond } from "../js/config.js";
import {
  BODIES,
  describeBody,
  findBody,
  keplerOffset,
  moonClearance,
  moonsOf,
  ringTextureU,
  solveKepler,
  visualBodyRadius,
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
  "phobos",
  "deimos",
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
  assert.ok(findBody("uranus").rotationHours < 0);
  assert.ok(findBody("pluto").rotationHours < 0);
  assert.ok(findBody("triton").orbitDays < 0);
  assert.ok(findBody("triton").rotationHours < 0);
  assert.ok(findBody("earth").orbitDays > 365 && findBody("earth").orbitDays < 366);
  assert.ok(findBody("jupiter").tiltDeg < 5);
  assert.ok(findBody("venus").tiltDeg > 170 && findBody("venus").tiltDeg < 180);
  assert.ok(findBody("uranus").tiltDeg > 90 && findBody("uranus").tiltDeg < 100);
  assert.ok(findBody("pluto").tiltDeg > 120 && findBody("pluto").tiltDeg < 125);
  assert.equal(findBody("sun").tiltDeg, 7.25);
  assert.equal(findBody("sun").kind, "star");

  const phobos = findBody("phobos");
  const deimos = findBody("deimos");
  assert.equal(phobos.parent, "mars");
  assert.equal(deimos.parent, "mars");
  assert.ok(phobos.radiusKm > 10 && phobos.radiusKm < 12);
  assert.ok(deimos.radiusKm > 5 && deimos.radiusKm < 7.5);
  assert.ok(phobos.orbitKm > 9000 && phobos.orbitKm < 9800);
  assert.ok(deimos.orbitKm > 22000 && deimos.orbitKm < 24000);
  assert.ok(phobos.orbitKm < deimos.orbitKm);
  assert.ok(phobos.orbitDays > 0.3 && phobos.orbitDays < 0.33);
  assert.ok(deimos.orbitDays > 1.2 && deimos.orbitDays < 1.3);
  assert.ok(Math.abs(phobos.rotationHours - phobos.orbitDays * 24) < 0.01);
  assert.ok(Math.abs(deimos.rotationHours - deimos.orbitDays * 24) < 0.01);
  assert.ok(phobos.tiltDeg >= 0 && phobos.tiltDeg < 1);
  assert.ok(deimos.tiltDeg >= 0 && deimos.tiltDeg < 2);
});

test("physical catalog matches published NASA / JPL figures", () => {
  // NASA planetary fact sheet mean radii where they agree with JPL SSD phys_par.
  assert.equal(findBody("sun").radiusKm, 695700);
  assert.equal(findBody("sun").tiltDeg, 7.25);
  assert.equal(findBody("sun").rotationHours, 609.12);
  assert.equal(findBody("mercury").radiusKm, 2439.7);
  assert.equal(findBody("venus").radiusKm, 6051.8);
  assert.equal(findBody("earth").radiusKm, 6371);
  assert.equal(findBody("moon").radiusKm, 1737.4);
  assert.equal(findBody("mars").radiusKm, 3389.5);
  assert.equal(findBody("jupiter").radiusKm, 69911);
  assert.equal(findBody("saturn").radiusKm, 58232);
  assert.equal(findBody("uranus").radiusKm, 25362);
  assert.equal(findBody("neptune").radiusKm, 24622);
  assert.equal(findBody("pluto").radiusKm, 1188.3);
  assert.equal(findBody("ceres").radiusKm, 473);

  // JPL SSD sats/phys_par mean radii (IAU WGCCRE 2015), except Io 1821.6
  // which keeps the NASA Galilean fact-sheet rounding of 1821.49.
  assert.equal(findBody("phobos").radiusKm, 11.08);
  assert.equal(findBody("deimos").radiusKm, 6.2);
  assert.equal(findBody("io").radiusKm, 1821.6);
  assert.equal(findBody("europa").radiusKm, 1560.8);
  assert.equal(findBody("ganymede").radiusKm, 2631.2);
  assert.equal(findBody("callisto").radiusKm, 2410.3);
  assert.equal(findBody("titan").radiusKm, 2574.7);
  assert.equal(findBody("triton").radiusKm, 1353.4);

  // NASA Saturnian Rings Fact Sheet: D-ring inner, A-ring outer.
  assert.equal(findBody("saturn").ringInnerKm, 66900);
  assert.equal(findBody("saturn").ringOuterKm, 136775);

  // JPL SSD sats/elem mean a at J2000.
  assert.equal(findBody("moon").orbitKm, 384400);
  assert.equal(findBody("phobos").orbitKm, 9375);
  assert.equal(findBody("deimos").orbitKm, 23457);
  assert.equal(findBody("io").orbitKm, 421800);
  assert.equal(findBody("europa").orbitKm, 671100);
  assert.equal(findBody("ganymede").orbitKm, 1070400);
  assert.equal(findBody("callisto").orbitKm, 1882700);
  assert.equal(findBody("titan").orbitKm, 1221870);
  assert.equal(findBody("triton").orbitKm, 354759);

  // JPL NEP097 mean elements at J2000 (retrograde period keeps the NASA sign).
  assert.equal(findBody("triton").meanAnomalyDeg, 63);
  assert.equal(findBody("triton").periDeg, 0);
  assert.ok(findBody("triton").orbitDays < 0);
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
  assert.ok(visualSize < trueSize);
  assert.ok(visualDist < trueDist);
  assert.ok(trueDist / visualDist > trueSize / visualSize);
  assert.ok(trueSize / visualSize > 2);
  assert.ok(trueDist / visualDist > 3);
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
    assert.ok(orbit >= moonClearance(moon, parent) - 1e-12);
  }
  const mars = visualOrbit(findBody("mars").orbitAu);
  const jupiter = visualOrbit(findBody("jupiter").orbitAu);
  const ceres = visualOrbit(findBody("ceres").orbitAu);
  assert.ok(ceres > mars && ceres < jupiter);
});

test("sibling moon visual orbits keep a readable gap and do not clip", () => {
  const parents = [...new Set(BODIES.filter((body) => body.kind === "moon").map((body) => body.parent))];
  for (const parentId of parents) {
    const parent = findBody(parentId);
    const siblings = moonsOf(parentId);
    let previous = null;
    for (const moon of siblings) {
      const orbit = visualMoonDistance(moon, parent);
      const moonR = visualBodyRadius(moon);
      const ringOuter = visualRingRadius(parent, parent.ringOuterKm);
      assert.ok(orbit > visualRadius(parent.radiusKm) + moonR + CONFIG.moonPad - 1e-12);
      if (ringOuter > 0) {
        assert.ok(orbit > ringOuter + moonR);
      }
      if (previous) {
        const gap = orbit - previous.orbit - previous.radius - moonR;
        assert.ok(
          gap + 1e-12 >= CONFIG.moonSiblingGap,
          `${previous.id} and ${moon.id} visual gap ${gap}`,
        );
        assert.ok(orbit > previous.orbit);
      }
      previous = { id: moon.id, orbit, radius: moonR };
    }
  }

  const mars = findBody("mars");
  const jupiter = findBody("jupiter");
  const phobos = findBody("phobos");
  const deimos = findBody("deimos");
  const phobosOrbit = visualMoonDistance(phobos, mars);
  const deimosOrbit = visualMoonDistance(deimos, mars);
  assert.ok(phobosOrbit < deimosOrbit);
  assert.ok(visualRadius(phobos.radiusKm) < visualRadius(mars.radiusKm) * 0.12);
  assert.ok(visualRadius(deimos.radiusKm) < visualRadius(mars.radiusKm) * 0.1);
  for (const id of ["io", "europa", "ganymede", "callisto"]) {
    const galilean = visualMoonDistance(findBody(id), jupiter);
    assert.ok(deimosOrbit < galilean, `${id} should sit farther from Jupiter than Deimos from Mars`);
  }

  const earth = findBody("earth");
  const moon = findBody("moon");
  const moonOrbit = visualMoonDistance(moon, earth);
  const earthToMars = visualOrbit(findBody("mars").orbitAu) - visualOrbit(earth.orbitAu);
  assert.ok(moonOrbit < earthToMars * 0.6);
  assert.ok(moonOrbit < visualOrbit(earth.orbitAu) * 0.15);
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
  const titanR = visualBodyRadius(titan);
  assert.ok(titanOrbit > outer + titanR);
  assert.ok(
    titanOrbit < outer * 1.5 + titanR,
    `Titan should sit closer than the old 1.5× ring rule (${titanOrbit} vs ${outer * 1.5 + titanR})`,
  );
});

test("visualScale is the one planet-spacing knob", () => {
  assert.ok(CONFIG.visualScale > 1);
  assert.equal(visualOrbit(1), CONFIG.visualScale * CONFIG.orbitScale);
  const mars = findBody("mars");
  const earth = findBody("earth");
  const venus = findBody("venus");
  assert.equal(
    visualOrbit(mars.orbitAu) / visualOrbit(earth.orbitAu),
    mars.orbitAu ** CONFIG.orbitPower / earth.orbitAu ** CONFIG.orbitPower,
  );
  assert.ok(visualOrbit(earth.orbitAu) - visualOrbit(venus.orbitAu) > 0);
  assert.ok(visualOrbit(mars.orbitAu) - visualOrbit(earth.orbitAu) > 0);
});

test("inner-planet gaps stay larger than the Moon path, and sizes read closer to true", () => {
  const sun = findBody("sun");
  const mercury = findBody("mercury");
  const venus = findBody("venus");
  const earth = findBody("earth");
  const moon = findBody("moon");
  const mars = findBody("mars");
  const jupiter = findBody("jupiter");

  const venusEarthGap = visualOrbit(earth.orbitAu) - visualOrbit(venus.orbitAu);
  const moonOrbit = visualMoonDistance(moon, earth);
  assert.ok(venusEarthGap > moonOrbit * 3);
  assert.ok(moonOrbit / venusEarthGap < 0.33);
  assert.ok(moonOrbit < visualOrbit(earth.orbitAu) * 0.15);

  const earthR = visualBodyRadius(earth);
  const moonR = visualBodyRadius(moon);
  const sunR = visualBodyRadius(sun);
  const jupiterR = visualBodyRadius(jupiter);
  const trueMoonRatio = moon.radiusKm / earth.radiusKm;
  const visualMoonRatio = moonR / earthR;
  // v2026.8.20d: sizePower 0.55, moonSizeScale 0.72.
  const previousMoonRatio = 0.352;
  const previousSunRatio = 13.21;
  const previousJupiterRatio = 3.73;
  assert.ok(moonR < earthR);
  assert.equal(CONFIG.moonSizeScale, 1);
  assert.equal(visualBodyRadius(moon), visualRadius(moon.radiusKm));
  assert.ok(visualMoonRatio < previousMoonRatio);
  assert.ok(Math.abs(visualMoonRatio - trueMoonRatio) < Math.abs(previousMoonRatio - trueMoonRatio));
  assert.ok(sunR / earthR > previousSunRatio);
  assert.ok(jupiterR / earthR > previousJupiterRatio);

  const mercuryOrbit = visualOrbit(mercury.orbitAu);
  assert.ok(mercuryOrbit > sunR + visualBodyRadius(mercury) + CONFIG.moonPad);
  assert.ok(mercuryOrbit / sunR > 2.4);

  const earthToMars = visualOrbit(mars.orbitAu) - visualOrbit(earth.orbitAu);
  assert.ok(venusEarthGap > 0 && earthToMars > venusEarthGap);
});

test("Kuiper belt sits outside Neptune and contains Pluto's orbit", () => {
  const neptune = visualOrbit(findBody("neptune").orbitAu);
  const pluto = visualOrbit(findBody("pluto").orbitAu);
  const inner = visualOrbit(CONFIG.kuiperInnerAu);
  const outer = visualOrbit(CONFIG.kuiperOuterAu);
  assert.ok(CONFIG.kuiperInnerAu > findBody("neptune").orbitAu);
  assert.ok(CONFIG.kuiperOuterAu > findBody("pluto").orbitAu);
  assert.ok(inner > neptune);
  assert.ok(inner < pluto);
  assert.ok(outer > pluto);
  assert.ok(CONFIG.maxDistance > outer);
  assert.ok(CONFIG.cameraDistance > pluto);
  assert.ok(CONFIG.maxDistance < CONFIG.skyRadius);
  assert.ok(CONFIG.cameraFar > CONFIG.skyRadius);
  assert.ok(CONFIG.kuiperCount < CONFIG.beltCount);
});

test("describeBody keeps public facts readable", () => {
  const earth = describeBody(findBody("earth"));
  assert.match(earth.orbitLabel, /day orbit/);
  assert.match(earth.tiltLabel, /tilt/);
  assert.match(earth.radiusLabel, /6371/);
  assert.ok(earth.facts.some((fact) => /AU orbit/.test(fact)));
  assert.ok(earth.facts.some((fact) => /^e /.test(fact)));
  assert.equal(earth.retrograde, false);
  assert.equal(describeBody(findBody("venus")).retrograde, true);
  assert.ok(describeBody(findBody("triton")).facts.includes("Retrograde"));

  const sun = describeBody(findBody("sun"));
  assert.equal(sun.kind, "star");
  assert.match(sun.radiusLabel, /695700/);
  assert.equal(sun.orbitLabel, "Center of the system");
  assert.match(sun.tiltLabel, /7\.25/);
  assert.match(sun.spinLabel, /spin/);
  assert.equal(sun.retrograde, false);
  assert.ok(sun.facts.includes("Center of the system"));
  assert.ok(!sun.facts.includes("Retrograde"));
});
