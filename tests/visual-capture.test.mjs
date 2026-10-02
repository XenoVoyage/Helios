import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { BODIES, findBody } from "../js/bodies.js";
import { focusTrackingOffsets, focusTrackingScenarios } from "./focus-tracking.mjs";

// Exercise the actual capture validator without launching a renderer or writing stills.
const source = await readFile(new URL("./visual-capture.mjs", import.meta.url), "utf8");
const start = source.indexOf("async function capture(page,");
const end = source.indexOf("async function captureFocusTracking()", start);
assert.ok(start >= 0 && end > start, "capture validator is available for behavioral tests");
const captureSource = source.slice(start, end);

const inventoryStart = source.indexOf("const expected = new Set();");
const inventoryEnd = source.indexOf("if (inventoryOnly)", inventoryStart);
assert.ok(inventoryStart >= 0 && inventoryEnd > inventoryStart, "capture inventory is available for partition tests");
function inventory(group) {
  return runInNewContext(`${source.slice(inventoryStart, inventoryEnd)}\n({ expected, completeMatrix, activeTrackingScenarios })`, {
    assert, BODIES, findBody, group, focusTrackingOffsets, focusTrackingScenarios,
    primaryIds: BODIES.filter(({ kind }) => kind !== "moon").map(({ id }) => id),
    moonIds: BODIES.filter(({ kind }) => kind === "moon").map(({ id }) => id),
    touchMoons: ["moon", "phobos", "io", "triton"],
  });
}

const counts = { "bodies-inner": 48, "bodies-giants": 23, "bodies-outer": 13, "moons-inner": 31, "moons-jovian": 18, "moons-outer": 12, "touch-controls": 47, responsive: 40, "desktop-phases": 8, "desktop-lifecycle": 10, "desktop-states": 8, "touch-states": 28, "cosmic-scenes": 40, ordinary: 23 };
test("visual lanes partition all 349 captures and retain the 30 focus captures", () => {
  const all = inventory("all");
  const captured = Object.entries(counts).flatMap(([group, count]) => {
    const { expected, completeMatrix } = inventory(group);
    assert.equal(expected.size, count, `${group} keeps its full coverage`);
    assert.deepEqual([...completeMatrix], [...all.completeMatrix]);
    return [...expected];
  });
  assert.equal(captured.length, 349);
  assert.equal(new Set(captured).size, 349, "no screenshot is assigned to multiple lanes");
  assert.deepEqual(captured.sort(), [...all.expected].sort(), "the lanes cover the complete matrix");
  const controls = [...inventory("touch-controls").expected];
  assert.equal(controls.filter((name) => name.includes("-moon-parent-")).length, 26);
  assert.equal(inventory("responsive").expected.size, 40);
  assert.equal(controls.filter((name) => name.startsWith("touch-portrait-minimum-zoom-")).length, 3);
  assert.equal(controls.filter((name) => name.startsWith("supplement-time-rate-")).length, 18);
  const focus = [...inventory("focus").expected];
  assert.equal(focus.length, 30);
  assert.deepEqual(focus, [...all.expected].filter((name) => name.startsWith("focus-tracking-")));
});

// Exercise the actual sweep loops with recorded public inputs and captures. Each
// lane must preserve the full per-object sequence of the unpartitioned audit.
async function sweep(group, touch = null) {
  const name = touch === null ? "bodySweep" : "moonSweep";
  const start = source.indexOf(`async function ${name}(`);
  const end = source.indexOf("\nasync function ", start + 1);
  assert.ok(start >= 0 && end > start, `${name} is available`);
  const sequences = new Map();
  let current;
  const record = (operation, ...args) => sequences.get(current).push(JSON.parse(JSON.stringify([operation, ...args])));
  const page = {
    viewportSize: () => ({ width: 1440, height: 900 }),
    mouse: { click: async (...args) => record("centered click", ...args) },
    locator: () => ({
      textContent: async () => findBody(current).name,
      evaluate: async () => false,
      evaluateAll: async () => {},
    }),
  };
  const context = {
    assert, BODIES, findBody, expected: inventory(group).expected,
    moonIds: BODIES.filter(({ kind }) => kind === "moon").map(({ id }) => id),
    touchMoons: ["moon", "phobos", "io", "triton"],
    newPage: async () => page, closePage: async () => {},
    scenario: async (_label, run) => run(),
    framedDistance: () => 100, minimumDistance: () => 10,
    parentDelta: () => ({ dx: 2, dy: 3 }),
    select: async (_page, id) => { current = id; sequences.set(id, [["select", id]]); },
    states: new Map([[page, { elapsed: 0, inputs: [], cdp: { send: async (...args) => record("touch input", ...args) } }]]),
  };
  for (const name of ["capture", "settle", "zoomMinimum", "zoomDistance", "advance", "orbit", "pinch", "wheel", "click"]) {
    context[name] = async (_page, ...args) => record(name, ...args);
  }
  const run = runInNewContext(`${source.slice(start, end)}\n${name}`, context);
  await run(touch);
  return sequences;
}

test("partitioned body and moon sweeps retain every complete per-object input and capture sequence", async () => {
  for (const [groups, touch] of [
    [["bodies-inner", "bodies-giants", "bodies-outer"], null],
    [["moons-inner", "moons-jovian", "moons-outer"], false],
    [["touch-controls"], true],
  ]) {
    const all = await sweep("all", touch);
    const combined = (await Promise.all(groups.map((group) => sweep(group, touch)))).flatMap((entries) => [...entries]);
    assert.equal(new Set(combined.map(([id]) => id)).size, all.size, "every object belongs to exactly one lane");
    assert.equal(combined.length, all.size, "no object is lost or repeated");
    for (const [id, sequence] of combined) assert.deepEqual(sequence, all.get(id), `${id} retains its complete sequence`);
  }
});

test("moon lane boundaries keep Io's transient history and start the other lanes with settled captures", async () => {
  for (const [group, ids] of [
    ["moons-inner", ["moon", "phobos", "deimos", "io"]],
    ["moons-jovian", ["europa", "ganymede", "callisto"]],
    ["moons-outer", ["titan", "triton"]],
  ]) {
    const sequences = await sweep(group, false);
    assert.deepEqual([...sequences.keys()], ids);
    const firstCapture = sequences.get(ids[0]).find(([operation]) => operation === "capture");
    assert.equal(firstCapture[1], `desktop-moon-parent-min-${ids[0]}`);
    assert.notEqual(firstCapture[3], true, "the first capture must settle before retaining pixels");
    if (group === "moons-inner") {
      const io = sequences.get("io");
      assert.deepEqual(io.slice(0, 6), [
        ["select", "io"], ["zoomMinimum"], ["advance", 32],
        ["capture", "desktop-moon-parent-transition-io-start", { transitionOffset: 32 }, true],
        ["advance", 350],
        ["capture", "desktop-moon-parent-transition-io-mid", { transitionOffset: 382 }, true],
      ]);
    }
  }
});

const ordinaryStart = source.indexOf("async function ordinaryViews()");
const ordinaryEnd = source.indexOf("\ntry {", ordinaryStart);
assert.ok(ordinaryStart >= 0 && ordinaryEnd > ordinaryStart);
const ordinaryFunctions = ["ordinaryOverviewAndConstellations", "ordinaryDirectViews", "ordinaryHandoff", "ordinaryTransitions", "ordinaryFarSky", "ordinarySolstice", "ordinaryTouch", "ordinaryTriton", "ordinaryFallback"];
async function ordinarySequence(group) {
  const calls = [];
  const context = { expected: inventory(group).expected, scenario: async (_label, run) => run() };
  for (const name of ordinaryFunctions) context[name] = async (...args) => calls.push([name, ...args]);
  const run = runInNewContext(`${source.slice(ordinaryStart, ordinaryEnd)}\nordinaryViews`, context);
  await run();
  return calls;
}

test("ordinary and cosmic lanes preserve whole page sequences and the unpartitioned ordering", async () => {
  const original = [
    ["ordinaryOverviewAndConstellations"], ["ordinaryDirectViews"], ["ordinaryHandoff"],
    ["ordinaryTransitions"], ["ordinaryFarSky"],
    ["ordinarySolstice", "earth-june-solstice", "2000-06-21"],
    ["ordinarySolstice", "earth-december-solstice", "2000-12-21", true],
    ["ordinaryTouch"], ["ordinaryTriton"], ["ordinaryFallback"],
  ];
  assert.deepEqual(await ordinarySequence("all"), original);
  assert.deepEqual(await ordinarySequence("cosmic-scenes"), [original[1], original[3], original[4]]);
  assert.deepEqual(await ordinarySequence("ordinary"), original.filter((_item, index) => ![1, 3, 4].includes(index)));
});

test("visual lane dispatch runs every complete scenario once across the fourteen lanes", async () => {
  const dispatchStart = source.indexOf('  if (["all", "bodies-inner", "bodies-giants", "bodies-outer"].includes(group)) await scenario(');
  const dispatchEnd = source.indexOf("\n} catch (error)", dispatchStart);
  assert.ok(dispatchStart >= 0 && dispatchEnd > dispatchStart, "capture dispatch is available");
  async function dispatch(group) {
    const calls = [];
    const context = {
      group, manifest: {}, browser: {}, base: "unused", sourceIdentity: {}, flush: () => {},
      scenario: async (_name, run) => run(),
      bodySweep: async () => { for (const id of (await sweep(group)).keys()) calls.push(`body:${id}`); },
      moonSweep: async (touch) => { for (const id of (await sweep(group, touch)).keys()) calls.push(`moon:${touch}:${id}`); },
      captureFocusTracking: async () => {
        for (const { id } of inventory(group).activeTrackingScenarios) calls.push(`focus:${id}`);
      },
      ordinaryViews: async () => { calls.push(...(await ordinarySequence(group)).map((call) => JSON.stringify(call))); },
    };
    for (const name of ["primaryTouch", "phases", "lifecycle", "ringsAndSky", "controlledLegacyViews", "responsive", "timeRates", "observeDeepLoadWallClock"]) {
      context[name] = async (touch) => { calls.push(typeof touch === "boolean" ? `${name}:${touch}` : name); };
    }
    await runInNewContext(`(async () => { ${source.slice(dispatchStart, dispatchEnd)} })()`, context);
    return calls;
  }
  const lanes = await Promise.all(Object.keys(counts).map(dispatch));
  const combined = lanes.flat();
  assert.equal(new Set(combined).size, combined.length, "scenarios do not run in duplicate lanes");
  assert.deepEqual(combined.sort(), (await dispatch("all")).sort(), "lane execution matches the complete audit");
  assert.deepEqual(await dispatch("touch-controls"), ["primaryTouch", "moon:true:moon", "moon:true:phobos", "moon:true:io", "moon:true:triton", "timeRates"]);
  assert.deepEqual(await dispatch("responsive"), ["responsive"]);
  assert.deepEqual(await dispatch("desktop-phases"), ["phases:false"]);
  assert.deepEqual(await dispatch("desktop-lifecycle"), ["lifecycle:false"]);
  assert.deepEqual(await dispatch("desktop-states"), ["ringsAndSky", "controlledLegacyViews"]);
  assert.deepEqual(await dispatch("focus"), focusTrackingScenarios.map(({ id }) => `focus:${id}`));
});

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
