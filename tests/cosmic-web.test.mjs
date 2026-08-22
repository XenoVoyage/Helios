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
  assert.equal(COSMIC_WEB_MODEL.outer.count, 6500);
  assert.equal(cosmicDensitySampleCount(), 49427);
  assert.ok(cosmicDensitySampleCount() <= COSMIC_WEB_MODEL.maxSamples);
  const innerRadius = 600;
  const outerRadius = 1000;
  const first = generateCosmicDensity(COSMIC_WEB_MODEL.outer, innerRadius, outerRadius);
  const second = generateCosmicDensity(COSMIC_WEB_MODEL.outer, innerRadius, outerRadius);
  assert.deepEqual(first.positions, second.positions);
  assert.deepEqual(first.colors, second.colors);
  assert.equal(first.positions.length, COSMIC_WEB_MODEL.outer.count * 3);
  assert.ok(first.attempts > COSMIC_WEB_MODEL.outer.count);
  for (let i = 0; i < first.positions.length; i += 3) {
    const radius = Math.hypot(
      first.positions[i],
      first.positions[i + 1],
      first.positions[i + 2],
    );
    assert.ok(Number.isFinite(radius) && radius >= innerRadius - 0.001);
    assert.ok(radius <= outerRadius + 0.001);
  }

  const source = await readFile(path.join(root, "js/galaxy.js"), "utf8");
  assert.match(source, /"catalog-cluster-anchors"/);
  assert.match(source, /"2mrs-galaxies"/);
  assert.match(source, /"illustrative-outer-density"/);
  assert.doesNotMatch(source, /pushFilament|collectWebHubs|createWebVolume/);
});
