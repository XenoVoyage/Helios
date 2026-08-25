import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { TWOMRS_METADATA, TWOMRS_PAYLOAD_BASE64 } from "../js/2mrs-data.js";
import {
  advanceCosmicDensityJob,
  advanceTwoMrsSampleJob,
  COSMIC_WEB_MODEL,
  cosmicDensityJobResult,
  cosmicDensitySampleCount,
  createCosmicDensityJob,
  createTwoMrsSampleJob,
  createTwoMrsSamples,
  generateCosmicDensity,
  twoMrsSampleJobResult,
} from "../js/cosmic-web.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("tracked 2MRS payload matches the licensed source manifest", () => {
  const payload = Buffer.from(TWOMRS_PAYLOAD_BASE64.replace(/\s/g, ""), "base64");
  assert.equal(TWOMRS_METADATA.catalog, "NASA HEASARC TWOMASSRSC");
  assert.equal(TWOMRS_METADATA.citation, "Huchra et al. 2012, ApJS 199, 26");
  assert.equal(TWOMRS_METADATA.license, "https://www.usa.gov/government-works");
  assert.equal(TWOMRS_METADATA.sourceRows, 44599);
  assert.equal(TWOMRS_METADATA.includedRows, 42927);
  assert.equal(TWOMRS_METADATA.h0KmSPerMpc, 73);
  assert.equal(TWOMRS_METADATA.maxDistanceMpc, 300);
  assert.equal(
    TWOMRS_METADATA.sourceSha256,
    "236be982e9a172c55d483d40c38ca38b36a3dc8b8af4f402a0fd045f1b87da6f",
  );
  assert.equal(payload.length, TWOMRS_METADATA.includedRows * TWOMRS_METADATA.recordBytes);
  assert.equal(
    createHash("sha256").update(payload).digest("hex"),
    TWOMRS_METADATA.payloadSha256,
  );
});

test("2MRS samples retain galactic directions and bounded Hubble-law distances", () => {
  const project = ({ lDeg, bDeg, distanceMpc }) => ({
    x: lDeg,
    y: bDeg,
    z: distanceMpc,
  });
  const samples = createTwoMrsSamples(project);
  const stagedJob = createTwoMrsSampleJob(project);
  while (!advanceTwoMrsSampleJob(stagedJob, 997)) {}
  const staged = twoMrsSampleJobResult(stagedJob);
  assert.deepEqual(staged.positions, samples.positions);
  assert.deepEqual(staged.colors, samples.colors);
  assert.throws(() => advanceTwoMrsSampleJob(stagedJob, 0), /positive integer/);
  assert.throws(() => advanceTwoMrsSampleJob(stagedJob, 1.5), /positive integer/);
  assert.equal(samples.positions.length, TWOMRS_METADATA.includedRows * 3);
  assert.equal(samples.colors.length, samples.positions.length);
  let minAbsLatitude = Infinity;
  let maxDistance = 0;
  for (let i = 0; i < samples.positions.length; i += 3) {
    const lDeg = samples.positions[i];
    const bDeg = samples.positions[i + 1];
    const distanceMpc = samples.positions[i + 2];
    assert.ok(Number.isFinite(lDeg) && lDeg >= 0 && lDeg <= 360);
    assert.ok(Number.isFinite(bDeg) && bDeg >= -90 && bDeg <= 90);
    assert.ok(Number.isFinite(distanceMpc) && distanceMpc > 0 && distanceMpc <= 300);
    minAbsLatitude = Math.min(minAbsLatitude, Math.abs(bDeg));
    maxDistance = Math.max(maxDistance, distanceMpc);
  }
  assert.ok(minAbsLatitude > 4.99, "the documented 2MRS Zone of Avoidance remains visible");
  assert.ok(maxDistance > 299, "the selected catalog reaches its disclosed 300 Mpc cap");
});

test("post-Virgo density stays deterministic and within the point budget", async () => {
  assert.equal(COSMIC_WEB_MODEL.outer.count, 7000);
  assert.equal(cosmicDensitySampleCount(), 49927);
  assert.ok(cosmicDensitySampleCount() <= COSMIC_WEB_MODEL.maxSamples);
  const innerRadius = 600;
  const outerRadius = 1000;
  const first = generateCosmicDensity(COSMIC_WEB_MODEL.outer, innerRadius, outerRadius);
  const stagedJob = createCosmicDensityJob(COSMIC_WEB_MODEL.outer, innerRadius, outerRadius);
  while (!advanceCosmicDensityJob(stagedJob, 613)) {}
  const second = cosmicDensityJobResult(stagedJob);
  assert.deepEqual(first.positions, second.positions);
  assert.deepEqual(first.colors, second.colors);
  assert.equal(first.attempts, second.attempts);
  assert.throws(() => advanceCosmicDensityJob(stagedJob, 0), /positive integer/);
  assert.throws(() => advanceCosmicDensityJob(stagedJob, 1.5), /positive integer/);
  assert.equal(first.positions.length, COSMIC_WEB_MODEL.outer.count * 3);
  assert.ok(first.attempts > COSMIC_WEB_MODEL.outer.count);
  const radialBands = [0, 0, 0, 0];
  let coolStructureCount = 0;
  let warmKnotCount = 0;
  for (let i = 0; i < first.positions.length; i += 3) {
    const radius = Math.hypot(
      first.positions[i],
      first.positions[i + 1],
      first.positions[i + 2],
    );
    assert.ok(Number.isFinite(radius) && radius >= innerRadius - 0.001);
    assert.ok(radius <= outerRadius + 0.001);
    const radialFraction = (radius ** 3 - innerRadius ** 3)
      / (outerRadius ** 3 - innerRadius ** 3);
    radialBands[Math.min(3, Math.floor(radialFraction * 4))] += 1;

    const red = first.colors[i];
    const green = first.colors[i + 1];
    const blue = first.colors[i + 2];
    assert.ok(red >= 0 && red <= 1 && green >= 0 && green <= 1 && blue >= 0 && blue <= 1);
    if (blue - red > 0.28) coolStructureCount += 1;
    if (red > 0.72 && red > blue) warmKnotCount += 1;
  }
  assert.ok(radialBands.every((band) => band > COSMIC_WEB_MODEL.outer.count * 0.2));
  assert.ok(coolStructureCount > COSMIC_WEB_MODEL.outer.count * 0.25);
  assert.ok(warmKnotCount > COSMIC_WEB_MODEL.outer.count * 0.01);

  const source = await readFile(path.join(root, "js/galaxy.js"), "utf8");
  assert.match(source, /"catalog-cluster-anchors"/);
  assert.match(source, /"2mrs-galaxies"/);
  assert.match(source, /"illustrative-outer-density"/);
  assert.doesNotMatch(
    source,
    /2mrs-galaxies-halo|illustrative-outer-density-halo/,
    "each density sample is submitted once rather than duplicated for a halo pass",
  );
  assert.doesNotMatch(source, /pushFilament|collectWebHubs|createWebVolume/);
});
