import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
    settle: async () => ({ settled: { stable }, png: Buffer.from("verified screenshot"), purpose: "settle-after-1" }),
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

// Exercise both real functions with controlled frames, browser state and I/O.
const settleStart = source.indexOf("async function settle(page)");
assert.ok(settleStart >= 0 && settleStart < start, "settling is available for behavioral tests");
const settleCaptureSource = source.slice(settleStart, end);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function captureHarness({ frames, busy = ["false"], observedBusy = "false" }) {
  const advances = [], screenshots = [], writes = [];
  const state = { id: 1, touch: false, elapsed: 0, initial: {}, inputs: [] };
  const manifest = { captures: [], failures: [] };
  let busyIndex = 0;
  const page = {
    viewportSize: () => ({ width: 1440, height: 900 }),
    locator: (selector) => {
      assert.equal(selector, "#viewport");
      return { getAttribute: async (name) => {
        assert.equal(name, "aria-busy");
        return busy[Math.min(busyIndex++, busy.length - 1)];
      } };
    },
  };
  const capture = runInNewContext(`${settleCaptureSource}\ncapture`, {
    assert, path, manifest, group: "test", output: "unused", sourceLabel: "candidate",
    performance: { now: () => 0 }, expected: new Set(["seat", "next-seat"]),
    states: new Map([[page, state]]), sha256: digest,
    advance: async (target, milliseconds) => {
      assert.equal(target, page);
      advances.push(milliseconds);
      state.elapsed += milliseconds;
    },
    screenshot: async (target, purpose, clip = null) => {
      assert.equal(target, page);
      const frame = frames[screenshots.length];
      screenshots.push({ purpose, clip });
      assert.ok(frame, `unexpected screenshot ${purpose}`);
      if (frame instanceof Error) throw frame;
      return frame;
    },
    writeFile: async (file, png) => writes.push({ file, png }),
    observe: async () => ({ busy: observedBusy }),
    flush: async () => {}, console: { log() {} },
  });
  return { advances, screenshots, writes, manifest,
    run: (name = "seat", details = {}, moving = false) => capture(page, name, details, moving) };
}

test("a settled full viewport saves the last verified frame without a third acquisition", async () => {
  const first = Buffer.from("stable frame"), verified = Buffer.from("stable frame");
  const harness = captureHarness({ frames: [first, verified] });
  const entry = await harness.run();
  assert.deepEqual(harness.advances, [1500, 400]);
  assert.deepEqual(harness.screenshots.map(({ purpose }) => purpose), ["settle-before", "settle-after-1"]);
  assert.equal(harness.writes[0].png, verified, "retain the second, verified PNG object");
  assert.equal(entry.sha256, digest(verified));
  assert.equal(entry.bytes, verified.length);
  assert.equal(entry.controlledElapsed, 1900);
  assert.equal(entry.settled.elapsed, 1900);
  assert.equal(entry.settled.stable, true);
  assert.deepEqual(JSON.parse(JSON.stringify(entry.screenshotAcquisition)), {
    method: "verified-settle-frame", page: 1, purpose: "settle-after-1", controlledAt: 1900,
  });
  assert.deepEqual(harness.manifest.failures, []);
  const serialized = JSON.stringify(harness.manifest);
  assert.doesNotMatch(serialized, /"type":"Buffer"|"png"|stable frame/);
  assert.deepEqual(Object.keys(entry.settled).sort(), ["criterion", "elapsed", "stable"]);
});

test("changing frames keep the same controlled settling cadence until the final stable pair", async () => {
  const verified = Buffer.from("final frame");
  const harness = captureHarness({ frames: [Buffer.from("initial"), Buffer.from("final frame"), verified] });
  const entry = await harness.run();
  assert.deepEqual(harness.advances, [1500, 400, 400]);
  assert.equal(harness.writes[0].png, verified);
  assert.equal(entry.settled.elapsed, 2300);
  assert.equal(entry.screenshotAcquisition.purpose, "settle-after-2");
});

test("identical frames while busy do not satisfy settling", async () => {
  const frames = Array.from({ length: 3 }, () => Buffer.from("same pixels"));
  const harness = captureHarness({ frames, busy: ["true", "false"] });
  const entry = await harness.run();
  assert.deepEqual(harness.advances, [1500, 400, 400]);
  assert.equal(harness.writes[0].png, frames[2]);
  assert.equal(entry.screenshotAcquisition.purpose, "settle-after-2");
  assert.deepEqual(harness.manifest.failures, []);
});

test("exhausted settling retains a fresh diagnostic and the failure", async () => {
  const frames = Array.from({ length: 17 }, (_, index) => Buffer.from(`frame ${index}`));
  const harness = captureHarness({ frames });
  const entry = await harness.run();
  assert.deepEqual(harness.advances, [1500, ...Array(15).fill(400)]);
  assert.equal(entry.settled.elapsed, 7500);
  assert.equal(entry.settled.stable, false);
  assert.equal(harness.screenshots.length, 17);
  assert.equal(harness.screenshots.at(-1).purpose, "seat");
  assert.equal(harness.writes[0].png, frames[16]);
  assert.equal(entry.screenshotAcquisition.method, "fresh-screenshot");
  assert.equal(harness.manifest.failures.length, 1);
  assert.match(harness.manifest.failures[0].reason, /stable-frame criterion/);
});

test("moving captures acquire a fresh frame without advancing or settling", async () => {
  const moving = Buffer.from("moving frame");
  const harness = captureHarness({ frames: [moving], observedBusy: "true" });
  const entry = await harness.run("seat", {}, true);
  assert.deepEqual(harness.advances, []);
  assert.deepEqual(harness.screenshots, [{ purpose: "seat", clip: null }]);
  assert.equal(harness.writes[0].png, moving);
  assert.equal(entry.settled, null);
  assert.equal(entry.screenshotAcquisition.method, "fresh-screenshot");
  assert.deepEqual(harness.manifest.failures, []);
});

test("clipped captures still settle and then acquire the requested crop", async () => {
  const crop = Buffer.from("crop");
  const harness = captureHarness({ frames: [Buffer.from("full"), Buffer.from("full"), crop] });
  const clip = { x: 10, y: 20, width: 30, height: 40 };
  const entry = await harness.run("seat", { clip });
  assert.deepEqual(harness.advances, [1500, 400]);
  assert.deepEqual(harness.screenshots.at(-1), { purpose: "seat", clip });
  assert.equal(harness.screenshots.length, 3);
  assert.equal(harness.writes[0].png, crop);
  assert.equal(entry.settled.stable, true);
  assert.equal(entry.screenshotAcquisition.method, "fresh-screenshot");
});

test("reusing verified pixels does not bypass final busy and pick validation", async () => {
  for (const observedBusy of [null, "true"]) {
    const harness = captureHarness({ frames: [Buffer.from("same"), Buffer.from("same")], observedBusy });
    await harness.run("seat", { pickMatched: false, requestedPick: "io" });
    assert.equal(harness.screenshots.length, 2);
    assert.equal(harness.writes.length, 1, "retain evidence for a semantic failure");
    assert.equal(harness.manifest.failures.length, 2);
    assert.match(harness.manifest.failures[0].reason, /expected aria-busy=false/);
    assert.match(harness.manifest.failures[1].reason, /centered pick did not select io/);
  }
});

test("a later capture obtains its own stable pair rather than reusing previous state", async () => {
  const frames = ["first", "first", "second", "second"].map((value) => Buffer.from(value));
  const harness = captureHarness({ frames });
  await harness.run();
  const second = await harness.run("next-seat");
  assert.deepEqual(harness.advances, [1500, 400, 1500, 400]);
  assert.equal(harness.screenshots.length, 4);
  assert.equal(harness.writes[0].png, frames[1]);
  assert.equal(harness.writes[1].png, frames[3]);
  assert.equal(second.screenshotAcquisition.controlledAt, 3800);
});

test("screenshot acquisition failures propagate without fabricated evidence", async () => {
  const failure = new Error("screenshot failed");
  const harness = captureHarness({ frames: [Buffer.from("initial"), failure] });
  await assert.rejects(harness.run(), (error) => error === failure);
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.manifest.captures.length, 0);
});
