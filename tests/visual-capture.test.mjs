import assert from "node:assert/strict";
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

const counts = { "bodies-inner": 48, "bodies-giants": 23, "bodies-outer": 13, "moons-inner": 31, "moons-outer": 30, "touch-controls": 47, responsive: 40, "desktop-states": 26, "touch-states": 28, ordinary: 63 };
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
    [["moons-inner", "moons-outer"], false],
    [["touch-controls"], true],
  ]) {
    const all = await sweep("all", touch);
    const combined = (await Promise.all(groups.map((group) => sweep(group, touch)))).flatMap((entries) => [...entries]);
    assert.equal(new Set(combined.map(([id]) => id)).size, all.size, "every object belongs to exactly one lane");
    assert.equal(combined.length, all.size, "no object is lost or repeated");
    for (const [id, sequence] of combined) assert.deepEqual(sequence, all.get(id), `${id} retains its complete sequence`);
  }
});

test("visual lane dispatch runs every complete scenario once across the ten lanes", async () => {
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
    };
    for (const name of ["primaryTouch", "phases", "lifecycle", "ringsAndSky", "controlledLegacyViews", "responsive", "timeRates", "ordinaryViews", "observeDeepLoadWallClock"]) {
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
