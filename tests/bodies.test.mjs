import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "../vendor/three.module.min.js";
import { CONFIG, formatDaysPerSecond } from "../js/config.js";
import {
  BODIES,
  bodyOrientationBasis,
  describeBody,
  findBody,
  keplerOffset,
  keplerPathOffset,
  moonClearance,
  moonOrbitAttachment,
  moonsOf,
  renderedOrbitPeriod,
  renderedPeriod,
  renderedSpinPeriod,
  ringTextureU,
  solveKepler,
  visualBodyRadius,
  visualMoonDistance,
  visualOrbit,
  visualRadius,
  visualRingRadius,
} from "../js/bodies.js";
import { equatorialToScene, equatorialVectorToScene } from "../js/sky.js";

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

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalized(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function angleDeg(a, b) {
  return Math.acos(Math.max(-1, Math.min(1, dot(normalized(a), normalized(b))))) * 180 / Math.PI;
}

function angleDifference(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function sceneOrientationBasis(body) {
  const basis = bodyOrientationBasis(body);
  if (!basis) return null;
  return {
    xAxis: equatorialVectorToScene(basis.xAxis),
    yAxis: equatorialVectorToScene(basis.yAxis),
    zAxis: equatorialVectorToScene(basis.zAxis),
    primeMeridian: basis.primeMeridianDeg * Math.PI / 180,
  };
}

function facingCoordinates(basis, direction, spin) {
  const facing = normalized(direction);
  const W = basis.primeMeridian + spin;
  const bodyX = {
    x: Math.cos(W) * basis.xAxis.x + Math.sin(W) * basis.yAxis.x,
    y: Math.cos(W) * basis.xAxis.y + Math.sin(W) * basis.yAxis.y,
    z: Math.cos(W) * basis.xAxis.z + Math.sin(W) * basis.yAxis.z,
  };
  const bodyY = {
    x: -Math.sin(W) * basis.xAxis.x + Math.cos(W) * basis.yAxis.x,
    y: -Math.sin(W) * basis.xAxis.y + Math.cos(W) * basis.yAxis.y,
    z: -Math.sin(W) * basis.xAxis.z + Math.cos(W) * basis.yAxis.z,
  };
  return {
    longitudeDeg: Math.atan2(dot(facing, bodyY), dot(facing, bodyX)) * 180 / Math.PI,
    latitudeDeg: Math.asin(dot(facing, basis.zAxis)) * 180 / Math.PI,
  };
}

function bodyFacingCoordinates(body, direction, spin) {
  return facingCoordinates(sceneOrientationBasis(body), direction, spin);
}

function sceneOrientationMatrix(body) {
  const basis = sceneOrientationBasis(body);
  return new THREE.Matrix4().makeBasis(
    new THREE.Vector3(basis.xAxis.x, basis.xAxis.y, basis.xAxis.z),
    new THREE.Vector3(basis.zAxis.x, basis.zAxis.y, basis.zAxis.z),
    new THREE.Vector3(-basis.yAxis.x, -basis.yAxis.y, -basis.yAxis.z),
  );
}

function runtimeMoonHierarchy(body) {
  const parent = findBody(body.parent);
  const parentTilt = new THREE.Group();
  const pivot = new THREE.Group();
  const tilt = new THREE.Group();
  parentTilt.setRotationFromMatrix(sceneOrientationMatrix(parent));
  tilt.setRotationFromMatrix(sceneOrientationMatrix(body));
  if (moonOrbitAttachment(body) === "parent-equatorial" && body.orientationJ2000) {
    tilt.quaternion.premultiply(parentTilt.quaternion.clone().invert());
  }
  pivot.add(tilt);
  parentTilt.add(pivot);
  return { body, parent, parentTilt, pivot, tilt };
}

function runtimeMoonState(hierarchy, days) {
  const at = keplerOffset(hierarchy.body, hierarchy.parent, days);
  hierarchy.pivot.position.set(at.x, at.y, at.z);
  hierarchy.parentTilt.updateMatrixWorld(true);
  const offset = hierarchy.pivot.getWorldPosition(new THREE.Vector3());
  const xAxis = new THREE.Vector3(1, 0, 0).transformDirection(hierarchy.tilt.matrixWorld);
  const zAxis = new THREE.Vector3(0, 1, 0).transformDirection(hierarchy.tilt.matrixWorld);
  const yAxis = new THREE.Vector3(0, 0, -1).transformDirection(hierarchy.tilt.matrixWorld);
  return {
    at,
    offset: { x: offset.x, y: offset.y, z: offset.z },
    basis: {
      xAxis: { x: xAxis.x, y: xAxis.y, z: xAxis.z },
      yAxis: { x: yAxis.x, y: yAxis.y, z: yAxis.z },
      zAxis: { x: zAxis.x, y: zAxis.y, z: zAxis.z },
      primeMeridian: sceneOrientationBasis(hierarchy.body).primeMeridian,
    },
  };
}

function minimumSolarAltitude(latitudeDeg, declinationDeg) {
  const latitude = latitudeDeg * Math.PI / 180;
  const declination = declinationDeg * Math.PI / 180;
  return Math.asin(
    Math.sin(latitude) * Math.sin(declination)
      - Math.cos(latitude) * Math.cos(declination),
  ) * 180 / Math.PI;
}

function worldOffset(body, days) {
  const parent = findBody(body.parent);
  const offset = keplerOffset(body, parent, days);
  if (moonOrbitAttachment(body) !== "parent-equatorial") return offset;
  const basis = sceneOrientationBasis(parent);
  return {
    x: offset.x * basis.xAxis.x + offset.y * basis.zAxis.x - offset.z * basis.yAxis.x,
    y: offset.x * basis.xAxis.y + offset.y * basis.zAxis.y - offset.z * basis.yAxis.y,
    z: offset.x * basis.xAxis.z + offset.y * basis.zAxis.z - offset.z * basis.yAxis.z,
    spin: offset.spin,
  };
}

function orbitNormal(body) {
  const step = Math.abs(body.orbitDays) * 1e-5;
  const at = worldOffset(body, 0);
  const next = worldOffset(body, step);
  return normalized(cross(at, subtract(next, at)));
}

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
  assert.ok(findBody("triton").inclinationDeg > 90);
  assert.ok(findBody("triton").rotationHours < 0);
  assert.ok(findBody("earth").orbitDays > 365 && findBody("earth").orbitDays < 366);
  assert.ok(findBody("jupiter").tiltDeg < 5);
  assert.ok(findBody("venus").tiltDeg > 170 && findBody("venus").tiltDeg < 180);
  assert.ok(findBody("uranus").tiltDeg > 90 && findBody("uranus").tiltDeg < 100);
  assert.ok(findBody("pluto").tiltDeg > 119 && findBody("pluto").tiltDeg < 120);
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

  assert.deepEqual(findBody("earth").orientationJ2000, {
    poleRaDeg: 0,
    poleDecDeg: 90,
    primeMeridianDeg: 190.147,
    spinDirection: 1,
  });
  assert.deepEqual(findBody("moon").orientationJ2000, {
    poleRaDeg: 266.85773344495135,
    poleDecDeg: 65.64110274784535,
    primeMeridianDeg: 41.1952639807452,
    spinDirection: 1,
  });
  assert.deepEqual(findBody("triton").orientationJ2000, {
    poleRaDeg: 298.4509834088894,
    poleDecDeg: 20.302361260483217,
    primeMeridianDeg: 297.01780353391297,
    spinDirection: -1,
  });

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
  assert.equal(findBody("titan").orbitKm, 1221900);
  assert.equal(findBody("triton").orbitKm, 354800);

  // JPL NEP097 mean elements at J2000; inclination owns retrograde direction.
  assert.equal(findBody("triton").meanAnomalyDeg, 63);
  assert.equal(findBody("triton").periDeg, 0);
  assert.equal(findBody("triton").orbitDays, 5.876994);

  // SAT441 J2000 orbital angles; the old M=186.586 value was a spin constant.
  assert.equal(findBody("titan").periDeg, 78.3);
  assert.equal(findBody("titan").meanAnomalyDeg, 11.7);
  assert.equal(findBody("titan").nodeDeg, 78.6);
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

test("Earth J2000 orientation puts the solstices at the correct poles", () => {
  const earth = findBody("earth");
  const sun = findBody("sun");
  const basis = sceneOrientationBasis(earth);
  assert.ok(Math.abs(angleDeg(basis.zAxis, { x: 0, y: 1, z: 0 }) - 23.43927944) < 1e-7);

  for (const [days, expectedDeclination] of [[79, 0], [172, 23.44], [266, 0], [355, -23.44]]) {
    const at = keplerOffset(earth, sun, days);
    const sunward = normalized({ x: -at.x, y: -at.y, z: -at.z });
    const declination = Math.asin(dot(sunward, basis.zAxis)) * 180 / Math.PI;
    assert.ok(
      Math.abs(declination - expectedDeclination) < 0.5,
      `day ${days}: subsolar declination ${declination.toFixed(3)}°`,
    );
  }

  const atJ2000 = keplerOffset(earth, sun, 0);
  const subsolar = bodyFacingCoordinates(
    earth,
    { x: -atJ2000.x, y: -atJ2000.y, z: -atJ2000.z },
    atJ2000.spin,
  );
  assert.ok(Math.abs(subsolar.longitudeDeg - 1.1428) < 0.01);
  assert.ok(Math.abs(subsolar.latitudeDeg + 23.0335) < 0.01);

  // Solstice midnight Sun is positive inside each polar circle, not across
  // all of Greenland or the Antarctic Peninsula.
  assert.ok(minimumSolarAltitude(72, 23.44) > 5);
  assert.ok(minimumSolarAltitude(64, 23.44) < 0);
  assert.ok(minimumSolarAltitude(-80, -23.44) > 13);
  assert.ok(minimumSolarAltitude(-64, -23.44) < 0);
});

test("heliocentric axes and Saturn's ring plane use static J2000 PCK poles", () => {
  const oriented = BODIES.filter((body) => body.orientationJ2000 && body.kind !== "moon");
  assert.deepEqual(oriented.map((body) => body.id), [
    "sun",
    "mercury",
    "venus",
    "earth",
    "mars",
    "ceres",
    "jupiter",
    "saturn",
    "uranus",
    "neptune",
    "pluto",
  ]);
  assert.deepEqual(findBody("mercury").orientationJ2000, {
    poleRaDeg: 281.0103,
    poleDecDeg: 61.4155,
    primeMeridianDeg: null,
    spinDirection: 1,
  });
  assert.deepEqual(findBody("ceres").orientationJ2000, {
    poleRaDeg: 291.418,
    poleDecDeg: 66.764,
    primeMeridianDeg: null,
    spinDirection: 1,
  });
  assert.deepEqual(findBody("uranus").orientationJ2000, {
    poleRaDeg: 257.311,
    poleDecDeg: -15.175,
    primeMeridianDeg: null,
    spinDirection: -1,
  });
  assert.deepEqual(findBody("pluto").orientationJ2000, {
    poleRaDeg: 132.993,
    poleDecDeg: -6.163,
    primeMeridianDeg: null,
    spinDirection: 1,
  });

  for (const [id, expectedTilt, tolerance] of [
    ["mercury", 0.034, 0.001],
    ["ceres", 4.033, 0.01],
    ["saturn", 26.73, 0.01],
    ["uranus", 97.77, 0.01],
    ["pluto", 119.6, 0.1],
  ]) {
    const body = findBody(id);
    const pole = sceneOrientationBasis(body).zAxis;
    const direction = Math.sign(renderedSpinPeriod(body));
    const spinAxis = { x: pole.x * direction, y: pole.y * direction, z: pole.z * direction };
    assert.ok(Math.abs(angleDeg(spinAxis, orbitNormal(body)) - expectedTilt) < tolerance);
  }
  assert.ok(Math.abs(angleDeg(
    sceneOrientationBasis(findBody("saturn")).zAxis,
    equatorialToScene(40.589, 83.537),
  )) < 1e-6);
});

test("Moon orientation keeps the near side Earth-facing with bounded natural libration", () => {
  const moon = findBody("moon");
  const earth = findBody("earth");
  const longitudes = [];
  const latitudes = [];
  for (let step = 0; step <= 720; step += 1) {
    const at = keplerOffset(moon, earth, moon.orbitDays * step / 720);
    const facing = bodyFacingCoordinates(
      moon,
      { x: -at.x, y: -at.y, z: -at.z },
      at.spin,
    );
    longitudes.push(facing.longitudeDeg);
    latitudes.push(facing.latitudeDeg);
  }
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  assert.ok(Math.max(Math.abs(minLongitude), Math.abs(maxLongitude)) < 6.5);
  assert.ok(Math.abs((minLongitude + maxLongitude) / 2) < 0.1);
  assert.ok(Math.abs(Math.min(...latitudes) + 6.73) < 0.02);
  assert.ok(Math.abs(Math.max(...latitudes) - 6.73) < 0.02);
});

test("Triton's runtime hierarchy preserves its absolute pole and registered hemisphere", () => {
  const triton = findBody("triton");
  const hierarchy = runtimeMoonHierarchy(triton);
  const start = runtimeMoonState(hierarchy, 0);
  const next = runtimeMoonState(hierarchy, triton.orbitDays * 1e-5);
  const spinPole = start.basis.zAxis;
  assert.ok(angleDeg(spinPole, sceneOrientationBasis(triton).zAxis) < 1e-6);
  const spinDirection = Math.sign(renderedSpinPeriod(triton));
  const spinAxis = {
    x: spinPole.x * spinDirection,
    y: spinPole.y * spinDirection,
    z: spinPole.z * spinDirection,
  };
  const runtimeOrbitNormal = normalized(cross(start.offset, subtract(next.offset, start.offset)));
  const obliquity = angleDeg(runtimeOrbitNormal, spinAxis);
  assert.ok(obliquity < 0.6);
  assert.ok(Math.abs(obliquity - triton.tiltDeg) < 0.01);

  const longitudes = [];
  const latitudes = [];
  for (let step = 0; step <= 720; step += 1) {
    const state = runtimeMoonState(hierarchy, triton.orbitDays * step / 720);
    const facing = facingCoordinates(
      state.basis,
      { x: -state.offset.x, y: -state.offset.y, z: -state.offset.z },
      state.at.spin,
    );
    longitudes.push(facing.longitudeDeg);
    latitudes.push(facing.latitudeDeg);
  }
  assert.ok(Math.abs(Math.min(...longitudes) + 1.30205) < 0.001);
  assert.ok(Math.abs(Math.max(...longitudes) + 1.29948) < 0.001);
  assert.ok(Math.abs(Math.min(...latitudes) + 0.54209) < 0.001);
  assert.ok(Math.abs(Math.max(...latitudes) - 0.54209) < 0.001);
});

test("synchronous moon rates avoid secular longitude drift without registering new faces", () => {
  const synchronous = BODIES.filter((body) => body.synchronous);
  assert.deepEqual(synchronous.map((body) => body.id), [
    "moon",
    "phobos",
    "deimos",
    "io",
    "europa",
    "ganymede",
    "callisto",
    "titan",
    "triton",
  ]);
  assert.deepEqual(
    synchronous.filter((body) => body.orientationJ2000).map((body) => body.id),
    ["moon", "triton"],
  );
  for (const body of synchronous) {
    assert.equal(renderedOrbitPeriod(body), Math.abs(body.rotationHours) / 24);
    const circular = {
      ...body,
      eccentricity: 0,
      inclinationDeg: body.inclinationDeg > 90 ? 180 : 0,
      nodeDeg: 0,
      periDeg: 0,
      meanAnomalyDeg: 0,
      orbitFrame: { kind: "ecliptic" },
    };
    const at = keplerOffset(circular, findBody(body.parent), 365.256);
    const orbitLongitude = Math.atan2(-at.z, at.x);
    assert.ok(
      Math.abs(angleDifference(orbitLongitude, at.spin)) < 1e-9,
      `${body.id} rate model has secular longitude drift`,
    );
  }
});

test("focus orbit paths close on the fixed catalog ellipse", () => {
  for (const body of BODIES.filter((candidate) => candidate.orbitDays)) {
    const parent = findBody(body.parent);
    const start = keplerPathOffset(body, parent, 0);
    const end = keplerPathOffset(body, parent, 1);
    assert.ok(
      Math.hypot(start.x - end.x, start.y - end.y, start.z - end.z) < 1e-10,
      `${body.id} helper path is open`,
    );
  }

  // Europa's two display clocks intentionally do not return its propagated
  // position to the same direction after one mean-anomaly period.
  const europa = findBody("europa");
  const start = keplerPathOffset(europa, findBody("jupiter"), 0);
  const propagated = keplerOffset(europa, findBody("jupiter"), europa.orbitDays);
  assert.ok(angleDeg(start, propagated) > 2.5);
});

test("rendered moon planes and retrograde directions use each source frame once", () => {
  const moon = findBody("moon");
  const titan = findBody("titan");
  const triton = findBody("triton");
  assert.equal(moon.orbitFrame.kind, "ecliptic");
  assert.equal(moonOrbitAttachment(moon), "parent-ecliptic");
  assert.equal(titan.orbitFrame.kind, "laplace");
  assert.equal(moonOrbitAttachment(titan), "parent-equatorial");
  assert.deepEqual(findBody("phobos").orbitFrame.parentPole, {
    raDeg: 317.6808544073,
    decDeg: 52.8864392751,
  });
  assert.deepEqual(findBody("io").orbitFrame.parentPole, {
    raDeg: 268.0572040427,
    decDeg: 64.4958099534,
  });
  assert.deepEqual(triton.orbitFrame.parentPole, {
    raDeg: 299.3337389588,
    decDeg: 42.9503590218,
  });
  assert.ok(Math.abs(angleDeg(orbitNormal(moon), { x: 0, y: 1, z: 0 }) - 5.16) < 0.01);

  const marsPole = sceneOrientationBasis(findBody("mars")).zAxis;
  assert.ok(Math.abs(angleDeg(orbitNormal(findBody("phobos")), marsPole) - 1.1155) < 0.01);
  assert.ok(Math.abs(angleDeg(orbitNormal(findBody("deimos")), marsPole) - 0.9223) < 0.01);
  const saturnPole = sceneOrientationBasis(findBody("saturn")).zAxis;
  assert.ok(angleDeg(orbitNormal(titan), saturnPole) < 1.1);
  const neptunePole = sceneOrientationBasis(findBody("neptune")).zAxis;
  assert.ok(Math.abs(angleDeg(orbitNormal(triton), neptunePole) - 157.4576) < 0.01);
  assert.ok(renderedPeriod(triton.orbitDays, triton.inclinationDeg) > 0);
});

test("retrograde spin is not reversed twice by period and obliquity", () => {
  for (const id of ["venus", "uranus", "pluto"]) {
    const body = findBody(id);
    assert.ok(body.tiltDeg > 90);
    assert.ok(body.rotationHours < 0);
    const pole = sceneOrientationBasis(body).zAxis;
    const spinAxis = {
      x: pole.x * Math.sign(renderedSpinPeriod(body)),
      y: pole.y * Math.sign(renderedSpinPeriod(body)),
      z: pole.z * Math.sign(renderedSpinPeriod(body)),
    };
    assert.ok(dot(spinAxis, orbitNormal(body)) < 0, `${id} spin is retrograde`);
  }
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
  // Regression (vanishing Mars moons): the raw size curve maps Phobos /
  // Deimos to a sub-pixel globe; the display floor keeps them a visible
  // dot while the published radiusKm stays 1:1 in the catalog.
  assert.ok(visualRadius(phobos.radiusKm) < CONFIG.moonMinRadius);
  assert.ok(visualRadius(deimos.radiusKm) < CONFIG.moonMinRadius);
  assert.equal(visualBodyRadius(phobos), CONFIG.moonMinRadius);
  assert.equal(visualBodyRadius(deimos), CONFIG.moonMinRadius);
  assert.ok(
    visualBodyRadius(findBody("moon")) > CONFIG.moonMinRadius,
    "Earth's Moon stays on the shared size curve, above the floor",
  );
  assert.ok(visualBodyRadius(phobos) < visualBodyRadius(findBody("moon")));
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

test("Kuiper field brackets Pluto's semimajor axis while its eccentric path crosses the drawn edges", () => {
  const plutoBody = findBody("pluto");
  const neptune = visualOrbit(findBody("neptune").orbitAu);
  const pluto = visualOrbit(plutoBody.orbitAu);
  const inner = visualOrbit(CONFIG.kuiperInnerAu);
  const outer = visualOrbit(CONFIG.kuiperOuterAu);
  assert.ok(CONFIG.kuiperInnerAu > findBody("neptune").orbitAu);
  assert.ok(CONFIG.kuiperOuterAu > plutoBody.orbitAu);
  assert.ok(inner > neptune);
  assert.ok(inner < pluto);
  assert.ok(outer > pluto);
  const perihelionAu = plutoBody.orbitAu * (1 - plutoBody.eccentricity);
  const aphelionAu = plutoBody.orbitAu * (1 + plutoBody.eccentricity);
  assert.ok(perihelionAu < CONFIG.kuiperInnerAu);
  assert.ok(aphelionAu < CONFIG.kuiperOuterAu);
  assert.ok(pluto * (1 - plutoBody.eccentricity) < inner);
  assert.ok(pluto * (1 + plutoBody.eccentricity) > outer);
  assert.ok(CONFIG.maxDistance > outer);
  assert.ok(CONFIG.cameraDistance > pluto);
  assert.ok(CONFIG.solarMaxDistance > outer);
  assert.ok(CONFIG.solarMaxDistance < CONFIG.skyRadius);
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
