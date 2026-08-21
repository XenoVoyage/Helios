import assert from "node:assert/strict";
import test from "node:test";
import { CONFIG } from "../js/config.js";
import {
  ANDROMEDA,
  CONSTELLATION_LINES,
  STARS,
} from "../js/sky-catalog.js";
import {
  constellationHasStar,
  constellationLabelPixelHeight,
  equatorialToGalactic,
  equatorialToScene,
  findConstellation,
  findStarByHip,
  findStarByName,
  galacticToUv,
} from "../js/sky.js";

test("named stars have sane J2000 RA/Dec and magnitudes", () => {
  const sirius = findStarByName("Sirius");
  const betelgeuse = findStarByName("Betelgeuse");
  const rigel = findStarByName("Rigel");
  const vega = findStarByName("Vega");
  const polaris = findStarByName("Polaris");
  const alpharatz = findStarByName("Alpheratz");

  assert.ok(sirius && betelgeuse && rigel && vega && polaris && alpharatz);
  assert.equal(sirius.hip, 32349);
  assert.ok(sirius.raDeg > 100.8 && sirius.raDeg < 101.8);
  assert.ok(sirius.decDeg > -17.2 && sirius.decDeg < -16.3);
  assert.ok(sirius.mag < -1);

  assert.ok(betelgeuse.raDeg > 88.3 && betelgeuse.raDeg < 89.3);
  assert.ok(betelgeuse.decDeg > 7.0 && betelgeuse.decDeg < 7.8);
  assert.ok(rigel.raDeg > 78.2 && rigel.raDeg < 79.1);
  assert.ok(rigel.decDeg > -8.7 && rigel.decDeg < -7.7);

  assert.ok(vega.raDeg > 278.7 && vega.raDeg < 279.8);
  assert.ok(vega.decDeg > 38.3 && vega.decDeg < 39.3);
  assert.ok(polaris.decDeg > 89.0);
  assert.ok(alpharatz.raDeg > 1.5 && alpharatz.raDeg < 2.7);
  assert.ok(alpharatz.decDeg > 28.5 && alpharatz.decDeg < 29.6);
});

test("IAU stick figures connect the right bright stars", () => {
  assert.equal(CONSTELLATION_LINES.length, 88);
  assert.equal(findConstellation("Ori").name, "Orion");
  assert.ok(constellationHasStar("Ori", findStarByName("Betelgeuse").hip));
  assert.ok(constellationHasStar("Ori", findStarByName("Rigel").hip));
  assert.ok(constellationHasStar("UMa", findStarByHip(54061).hip));
  assert.ok(constellationHasStar("UMa", findStarByHip(67301).hip));
  assert.ok(constellationHasStar("Cas", 8886));
  assert.ok(constellationHasStar("And", findStarByName("Alpheratz").hip));
  assert.equal(findConstellation("And").name, "Andromeda");
});

test("Andromeda sits in Andromeda at the catalog M31 position", () => {
  assert.equal(ANDROMEDA.constellation, "And");
  assert.equal(ANDROMEDA.messier, "M31");
  assert.ok(ANDROMEDA.raDeg > 10.4 && ANDROMEDA.raDeg < 11.0);
  assert.ok(ANDROMEDA.decDeg > 40.9 && ANDROMEDA.decDeg < 41.6);

  const andromeda = findConstellation("And");
  const stars = andromeda.paths.flat().map((hip) => findStarByHip(hip)).filter(Boolean);
  assert.ok(stars.length >= 6);
  const ras = stars.map((star) => ((star.raDeg + 180) % 360) - 180);
  const decs = stars.map((star) => star.decDeg);
  const minRa = Math.min(...ras);
  const maxRa = Math.max(...ras);
  const minDec = Math.min(...decs);
  const maxDec = Math.max(...decs);
  const m31Ra = ((ANDROMEDA.raDeg + 180) % 360) - 180;
  assert.ok(m31Ra > minRa - 15 && m31Ra < maxRa + 15);
  assert.ok(ANDROMEDA.decDeg > minDec - 10 && ANDROMEDA.decDeg < maxDec + 10);
});

test("galactic equator and Andromeda map onto the Milky Way texture", () => {
  const gc = equatorialToGalactic(266.4051, -28.936175);
  assert.ok(Math.abs(gc.lDeg) < 0.4 || Math.abs(gc.lDeg - 360) < 0.4);
  assert.ok(Math.abs(gc.bDeg) < 0.4);
  const gcUv = galacticToUv(gc.lDeg, gc.bDeg);
  assert.ok(Math.abs(gcUv.u - 0.5) < 0.01);
  assert.ok(Math.abs(gcUv.v - 0.5) < 0.01);

  const m31 = equatorialToGalactic(ANDROMEDA.raDeg, ANDROMEDA.decDeg);
  assert.ok(m31.lDeg > 120 && m31.lDeg < 122.5);
  assert.ok(m31.bDeg > -22.2 && m31.bDeg < -20.8);
  assert.ok(Math.abs(m31.bDeg) > 15, "Andromeda is off the galactic plane");
});

test("equatorial J2000 lands on the orrery ecliptic axes", () => {
  const equinox = equatorialToScene(0, 0);
  assert.ok(Math.abs(equinox.x - 1) < 1e-9);
  assert.ok(Math.abs(equinox.y) < 1e-9);
  assert.ok(Math.abs(equinox.z) < 1e-9);

  const eclipticNorth = equatorialToScene(270, 90 - 23.43927944);
  assert.ok(eclipticNorth.y > 0.999, "ecliptic north is +Y");
  assert.ok(Math.abs(eclipticNorth.x) < 0.02);
  assert.ok(Math.abs(eclipticNorth.z) < 0.02);
});

test("catalog is a few thousand brightest Hipparcos stars and the far plane clears the sky", () => {
  assert.ok(STARS.length > 3000 && STARS.length < 8000);
  assert.ok(STARS.every((row) => row[0] > 0 && Number.isFinite(row[1]) && Number.isFinite(row[2])));
  assert.ok(CONFIG.cameraFar > CONFIG.skyRadius);
  assert.equal(CONFIG.VERSION, "v2026.8.20p");
});

test("constellation names stay readable at overview", () => {
  assert.ok(constellationLabelPixelHeight() > 22);
  assert.ok(constellationLabelPixelHeight(800, 52) > 16);
});
