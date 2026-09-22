import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { TWOMRS_METADATA, TWOMRS_PAYLOAD_BASE64 } from "../js/2mrs-data.js";
import {
  COSMIC_WEB_MODEL,
  cosmicDensitySampleCount,
  createTwoMrsSamples,
  generateCosmicDensity,
  startCosmicDensityJob,
  startTwoMrsSampleJob,
} from "../js/cosmic-web.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pin = JSON.parse(
  await readFile(new URL("./fixtures/2mrs-integrity.json", import.meta.url), "utf8"),
);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function decodeTwoMrsPayload(payloadBase64) {
  return Buffer.from(String(payloadBase64).replace(/\s/g, ""), "base64");
}

function twoMrsIntegrityFailures(metadata, payloadBytes, expected) {
  const failures = [];
  const payloadSha256 = sha256(payloadBytes);
  if (metadata.sourceSha256 !== expected.sourceSha256) failures.push("source digest");
  if (metadata.payloadSha256 !== expected.payloadSha256) failures.push("metadata payload digest");
  if (payloadSha256 !== expected.payloadSha256) failures.push("payload digest");
  if (metadata.sourceRows !== expected.sourceRows) failures.push("source rows");
  if (metadata.includedRows !== expected.includedRows) failures.push("included rows");
  if (metadata.recordBytes !== expected.recordBytes) failures.push("record width");
  if (metadata.selection !== expected.selection) failures.push("selection");
  if (payloadBytes.length !== expected.includedRows * expected.recordBytes) {
    failures.push("payload length");
  }
  return failures;
}

test("tracked 2MRS payload matches the independent integrity pin", () => {
  const payload = decodeTwoMrsPayload(TWOMRS_PAYLOAD_BASE64);
  assert.equal(pin.generator, "scripts/build-2mrs.mjs");
  assert.equal(pin.payload, "js/2mrs-data.js");
  assert.equal(TWOMRS_METADATA.catalog, "NASA HEASARC TWOMASSRSC");
  assert.equal(TWOMRS_METADATA.citation, "Huchra et al. 2012, ApJS 199, 26");
  assert.equal(TWOMRS_METADATA.license, "https://www.usa.gov/government-works");
  assert.equal(TWOMRS_METADATA.h0KmSPerMpc, 73);
  assert.equal(TWOMRS_METADATA.maxDistanceMpc, 300);
  assert.deepEqual(twoMrsIntegrityFailures(TWOMRS_METADATA, payload, pin), []);
});

test("2MRS payload and header co-edit still fails the independent pin", () => {
  const payload = decodeTwoMrsPayload(TWOMRS_PAYLOAD_BASE64);
  const mutated = Buffer.from(payload);
  mutated[0] ^= 0xff;
  const mutatedHash = sha256(mutated);
  const coeditedMetadata = { ...TWOMRS_METADATA, payloadSha256: mutatedHash };
  assert.equal(sha256(mutated), coeditedMetadata.payloadSha256);
  assert.deepEqual(
    twoMrsIntegrityFailures(coeditedMetadata, mutated, pin).sort(),
    ["metadata payload digest", "payload digest"],
  );
});

test("2MRS payload truncation and corruption fail the independent pin", () => {
  const payload = decodeTwoMrsPayload(TWOMRS_PAYLOAD_BASE64);
  const truncated = payload.subarray(0, payload.length - pin.recordBytes);
  assert.deepEqual(
    twoMrsIntegrityFailures(TWOMRS_METADATA, truncated, pin).sort(),
    ["payload digest", "payload length"],
  );
  const corrupted = Buffer.from(payload);
  corrupted[corrupted.length - 1] ^= 0x01;
  assert.deepEqual(
    twoMrsIntegrityFailures(TWOMRS_METADATA, corrupted, pin),
    ["payload digest"],
  );
});

test("canonical 2MRS generator still owns the tracked payload contract", async () => {
  const generator = await readFile(path.join(root, pin.generator), "utf8");
  assert.match(generator, /js\/2mrs-data\.js/);
  assert.match(generator, new RegExp(`EXPECTED_SOURCE_SHA256 = "${pin.sourceSha256}"`));
  assert.match(generator, new RegExp(`EXPECTED_SOURCE_ROWS = ${pin.sourceRows}`));
  assert.match(generator, new RegExp(`RECORD_BYTES = ${pin.recordBytes}`));
  assert.match(
    generator,
    new RegExp(pin.selection.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.match(generator, /tests\/fixtures\/2mrs-integrity\.json/);
});

test("2MRS samples retain galactic directions and bounded Hubble-law distances", () => {
  const samples = createTwoMrsSamples(({ lDeg, bDeg, distanceMpc }) => ({
    x: lDeg,
    y: bDeg,
    z: distanceMpc,
  }));
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
  const second = generateCosmicDensity(COSMIC_WEB_MODEL.outer, innerRadius, outerRadius);
  assert.deepEqual(first.positions, second.positions);
  assert.deepEqual(first.colors, second.colors);
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

test("budgeted 2MRS and density pumps match the one-shot helpers", () => {
  const project = ({ lDeg, bDeg, distanceMpc }) => ({ x: lDeg, y: bDeg, z: distanceMpc });
  const complete = createTwoMrsSamples(project);
  const twoMrsJob = startTwoMrsSampleJob(project);
  let twoMrsPumps = 0;
  while (!twoMrsJob.done) {
    twoMrsPumps += 1;
    twoMrsJob.pump(0);
    assert.ok(twoMrsPumps < 2_000, "2MRS pumping stays bounded");
  }
  assert.ok(twoMrsPumps > 1, "2MRS samples yield across budgeted pumps");
  assert.deepEqual(twoMrsJob.result().positions, complete.positions);
  assert.deepEqual(twoMrsJob.result().colors, complete.colors);

  const innerRadius = 600;
  const outerRadius = 1000;
  const first = generateCosmicDensity(COSMIC_WEB_MODEL.outer, innerRadius, outerRadius);
  const job = startCosmicDensityJob(COSMIC_WEB_MODEL.outer, innerRadius, outerRadius);
  let pumps = 0;
  while (!job.done) {
    pumps += 1;
    job.pump(0);
    assert.ok(pumps < 20_000, "density pumping stays bounded");
  }
  assert.ok(pumps > 1, "outer density yields across budgeted pumps");
  assert.deepEqual(job.result().positions, first.positions);
  assert.deepEqual(job.result().colors, first.colors);
  assert.equal(job.result().attempts, first.attempts);
});
