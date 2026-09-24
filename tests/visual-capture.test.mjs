import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runInNewContext } from "node:vm";

// Exercise the actual capture validator without launching a renderer or writing stills.
const source = await readFile(new URL("./visual-capture.mjs", import.meta.url), "utf8");
const start = source.indexOf("async function capture(page,");
const end = source.indexOf("async function captureFocusTracking()", start);
assert.ok(start >= 0 && end > start, "capture validator is available for behavioral tests");
const captureSource = source.slice(start, end);

async function validate(sourceLabel, busy, { moving = false, stable = true, pickMatched } = {}) {
  const page = { viewportSize: () => ({ width: 1440, height: 900 }) };
  const manifest = { captures: [], failures: [] };
  const capture = runInNewContext(`${captureSource}\ncapture`, {
    assert, path, sourceLabel, manifest, group: "test", output: "unused",
    performance: { now: () => 0 },
    expected: new Set(["seat"]),
    states: new Map([[page, { touch: false, elapsed: 0, initial: {}, inputs: [] }]]),
    settle: async () => ({ stable }),
    screenshot: async () => Buffer.from("test screenshot"),
    sha256: () => "test digest",
    writeFile: async () => {},
    observe: async () => ({ busy }),
    flush: async () => {},
    console: { log() {} },
  });
  await capture(page, "seat", { pickMatched, requestedPick: "io" }, moving);
  assert.equal(manifest.captures.length, 1, "retain the original even when validation fails");
  return manifest.failures.map(({ reason }) => reason);
}

for (const label of ["main", "develop", "candidate"]) {
  test(`${label} captures enforce present and correct aria-busy`, async () => {
    assert.deepEqual(await validate(label, "false"), []);
    assert.deepEqual(await validate(label, "true", { moving: true }), []);
    for (const busy of [null, "true"]) {
      const failures = await validate(label, busy);
      assert.equal(failures.length, 1);
      assert.match(failures[0], /expected aria-busy=false/);
    }
    for (const busy of [null, "false"]) {
      const failures = await validate(label, busy, { moving: true });
      assert.equal(failures.length, 1);
      assert.match(failures[0], /expected aria-busy=true/);
    }
  });
}

test("busy validation does not weaken settling or change the historical main pick exception", async () => {
  for (const label of ["main", "develop", "candidate"]) {
    assert.match((await validate(label, "false", { stable: false }))[0], /stable-frame criterion/);
  }
  assert.deepEqual(await validate("main", "false", { pickMatched: false }), []);
  for (const label of ["develop", "candidate"]) {
    assert.match((await validate(label, "false", { pickMatched: false }))[0], /centered pick did not select io/);
  }
});
