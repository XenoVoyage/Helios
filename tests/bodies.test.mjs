import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { errors } from "playwright";
import * as THREE from "../vendor/three.module.min.js";
import { CONFIG, compactFocusFrame, formatDaysPerSecond, pinchZoomDistance } from "../js/config.js";
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
import { bindFocusHelpers, createFocusHelpers } from "../js/helpers.js";
import { assertCompactLabelBounds, compactCaptureMetrics, assertCompactCaptureContent,
  compactLayoutMatches, compactLayoutSettled, assertCompactCaptureState, captureCompactScreenshot,
  waitForCompactGpu, auditCompactFocus } from "./compact-focus.mjs";

const appSource = await readFile(new URL("../js/app.js", import.meta.url), "utf8");

function compactGpuHarness(statuses = [11]) {
  const events = [], timers = new Set();
  let elapsed = 0;
  const state = { frame: 9, id: "earth", resizeEpoch: 1, viewport: { width: 320, height: 568 },
    buffer: { width: 320, height: 568, canvasWidth: 320, canvasHeight: 568 }, playing: false };
  const gl = { SYNC_GPU_COMMANDS_COMPLETE: 10, ALREADY_SIGNALED: 11, CONDITION_SATISFIED: 12, TIMEOUT_EXPIRED: 13,
    WAIT_FAILED: 14, isContextLost: () => false,
    fenceSync: (...args) => { events.push(["fence", ...args]); return {}; },
    flush: () => events.push(["flush"]),
    clientWaitSync: (sync, ...args) => { events.push(["poll", ...args]); return statuses.length > 1 ? statuses.shift() : statuses[0]; },
    deleteSync: () => events.push(["delete"]) };
  const handle = { gpuFence: null, gpuContext: () => gl, gpuFrame: () => structuredClone(state) };
  const observer = { evaluate: async (fn, operation) => fn(handle, operation) };
  const timing = { now: () => elapsed,
    pause: async (milliseconds) => { events.push(["yield", milliseconds]); elapsed += milliseconds; },
    setTimer: (callback, milliseconds) => { const timer = { callback, milliseconds }; timers.add(timer); return timer; },
    clearTimer: (timer) => timers.delete(timer) };
  return { events, timers, state, gl, handle, observer, timing,
    expire: () => { const timer = [...timers][0]; elapsed += timer.milliseconds; timer.callback(); } };
}

test("compact GPU completion yields between polls without adding or changing rendered frames", async () => {
  for (const ready of [11, 12]) {
    const harness = compactGpuHarness([13, ready]), telemetry = {};
    const state = structuredClone(harness.state);
    await waitForCompactGpu(harness.observer, telemetry, harness.timing);
    assert.deepEqual(harness.events, [["fence", 10, 0], ["flush"], ["yield", 16], ["poll", 0, 0],
      ["yield", 16], ["poll", 0, 0], ["delete"]]);
    assert.deepEqual(harness.state, state);
    assert.equal(harness.handle.gpuFence, null);
    assert.equal(harness.timers.size, 0);
    assert.deepEqual(telemetry, { timeoutMilliseconds: 10_000, polls: 2, status: "completed",
      frame: 9, id: "earth", submitted: state, elapsedMilliseconds: 32 });
  }
});

test("compact GPU completion rejects unavailable fences, context loss and failed status", async () => {
  for (const kind of ["null", "lost-before", "lost-during", "wait-failed", "unknown"]) {
    const harness = compactGpuHarness([kind === "unknown" ? 99 : 14]), telemetry = {};
    if (kind === "null") harness.gl.fenceSync = () => null;
    if (kind === "lost-before") harness.gl.isContextLost = () => true;
    if (kind === "lost-during") {
      const pause = harness.timing.pause;
      harness.timing.pause = async (ms) => { await pause(ms); harness.gl.isContextLost = () => true; };
    }
    await assert.rejects(waitForCompactGpu(harness.observer, telemetry, harness.timing), /Compact GPU/);
    assert.equal(telemetry.status, "failed", kind);
    assert.ok(telemetry.error.message);
    assert.equal(harness.handle.gpuFence, null);
    assert.equal(harness.events.filter(([event]) => event === "delete").length,
      ["null", "lost-before"].includes(kind) ? 0 : 1);
    assert.equal(harness.timers.size, 0);
  }
});

test("compact GPU completion rejects frame, body, viewport, buffer and simulation drift", async () => {
  for (const change of [
    (s) => { s.frame += 1; }, (s) => { s.id = "mars"; }, (s) => { s.resizeEpoch += 1; },
    (s) => { s.viewport.width += 1; }, (s) => { s.buffer.width += 1; },
    (s) => { s.buffer.canvasHeight += 1; }, (s) => { s.playing = true; },
  ]) {
    const harness = compactGpuHarness(), telemetry = {}, pause = harness.timing.pause;
    harness.timing.pause = async (ms) => { await pause(ms); change(harness.state); };
    await assert.rejects(waitForCompactGpu(harness.observer, telemetry, harness.timing), /preserves the submitted frame/);
    assert.equal(harness.handle.gpuFence, null);
    assert.equal(telemetry.status, "failed");
  }
});

test("compact GPU polling exhausts one wall deadline and releases its single fence", async () => {
  const harness = compactGpuHarness([13]), telemetry = {};
  await assert.rejects(waitForCompactGpu(harness.observer, telemetry, harness.timing), /10000ms polling deadline/);
  assert.equal(telemetry.elapsedMilliseconds, 10_000);
  assert.equal(telemetry.polls, 624);
  assert.equal(harness.events.filter(([event]) => event === "fence").length, 1);
  assert.equal(harness.events.filter(([event]) => event === "delete").length, 1);
  assert.equal(harness.timers.size, 0);
});

test("compact GPU bounds a hung RPC, observes late rejection and preserves the primary failure", async () => {
  for (const stalled of ["begin", "poll"]) {
    const harness = compactGpuHarness(), telemetry = {}, evaluate = harness.observer.evaluate;
    let rejectPending;
    harness.observer.evaluate = (fn, operation) => {
      if (operation === stalled) return new Promise((resolve, reject) => { rejectPending = reject; });
      if (operation === "delete") throw new Error("cleanup also failed");
      return evaluate(fn, operation);
    };
    const waiting = waitForCompactGpu(harness.observer, telemetry, harness.timing);
    const rejected = assert.rejects(waiting, (error) => {
      assert.match(error.message, new RegExp(`${stalled} exceeded its wall-time deadline`));
      assert.equal(error.compactGpuRpcTimeout, true);
      return true;
    });
    await new Promise(setImmediate);
    assert.equal(harness.timers.size, 1);
    harness.expire();
    await rejected;
    rejectPending(new Error("late protocol failure"));
    await new Promise(setImmediate);
    assert.equal(telemetry.elapsedMilliseconds, 10_000);
    assert.match(telemetry.error.message, new RegExp(`${stalled} exceeded`));
    assert.equal(telemetry.cleanupError.message, "cleanup also failed");
    assert.equal(telemetry.rpcDeadlineExceeded, true);
    assert.equal(harness.timers.size, 0);
  }
});

test("compact GPU cleanup has its own bound and cannot silently pass", async () => {
  const harness = compactGpuHarness(), telemetry = {}, evaluate = harness.observer.evaluate;
  harness.observer.evaluate = (fn, operation) => operation === "delete" ? new Promise(() => {}) : evaluate(fn, operation);
  const waiting = waitForCompactGpu(harness.observer, telemetry, harness.timing);
  const rejected = assert.rejects(waiting, /delete exceeded its wall-time deadline/);
  await new Promise(setImmediate);
  assert.equal([...harness.timers][0].milliseconds, 1_000);
  harness.expire();
  await rejected;
  assert.equal(telemetry.status, "failed");
  assert.match(telemetry.cleanupError.message, /delete exceeded/);
  assert.equal(telemetry.rpcDeadlineExceeded, true);
  assert.equal(harness.timers.size, 0);
});

test("an unresponsive compact GPU context is closed without further page RPCs or masking its failure", async () => {
  for (const cleanupFails of [false, true]) {
    const failure = Object.assign(new Error("GPU RPC deadline"), { compactGpuRpcTimeout: true });
    const events = [];
    let report;
    const page = { on: () => {}, clock: { install: async () => { throw failure; } } };
    const context = { newPage: async () => page, close: async () => {
      events.push("close");
      if (cleanupFails) throw new Error("close failed");
    } };
    await assert.rejects(auditCompactFocus({ newContext: async () => context }, "unused", {
      onStill: async () => assert.fail("an unresponsive context must not acquire another PNG"),
      onReport: async (value) => {
        events.push("report"); report = value;
        if (cleanupFails) throw new Error("write failed");
      },
    }), (error) => error === failure);
    assert.deepEqual(events, ["close", "report"]);
    assert.match(report.failure.screenshotUnavailable, /no further page RPC/);
    assert.match(report.failure.restoreUnavailable, /Closing the unresponsive context/);
    if (cleanupFails) {
      assert.match(report.failure.contextCloseError, /close failed/);
      assert.match(failure.message, /report write failed/);
    }
  }
});

test("a hung compact context close cannot suppress the retained report and primary failure", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const failure = Object.assign(new Error("GPU RPC deadline"), { compactGpuRpcTimeout: true });
  let report, rejectClose;
  const page = { on: () => {}, clock: { install: async () => { throw failure; } } };
  const context = { newPage: async () => page,
    close: () => new Promise((resolve, reject) => { rejectClose = reject; }) };
  const waiting = auditCompactFocus({ newContext: async () => context }, "unused", {
    onStill: async () => assert.fail("no screenshot after an unresponsive RPC"),
    onReport: async (value) => { report = value; },
  });
  const rejected = assert.rejects(waiting, (error) => error === failure);
  await new Promise(setImmediate);
  t.mock.timers.tick(1_000);
  await rejected;
  assert.match(report.failure.contextCloseError, /1000ms deadline/);
  assert.equal(report.failure.message, "GPU RPC deadline");
  rejectClose(new Error("late close failure"));
  await new Promise(setImmediate);
});

test("compact PNG acquisition returns the original bytes without recovery on success", async () => {
  const png = Buffer.from("original PNG bytes"), acquisition = {}, calls = [];
  let verifications = 0;
  const result = await captureCompactScreenshot({ screenshot: async (options) => { calls.push(options); return png; } },
    async () => { verifications += 1; }, acquisition);
  assert.equal(result, png);
  assert.deepEqual(calls, [{ timeout: 30_000 }]);
  assert.equal(verifications, 2, "the same state is verified before and after ordinary acquisition");
  assert.equal(acquisition.recovered, false);
  assert.equal(acquisition.attempts[0].status, "captured");
  assert.ok(acquisition.attempts[0].elapsedMilliseconds >= 0);
});

test("compact PNG acquisition records one bounded recovery after a genuine screenshot timeout", async () => {
  const timeout = new errors.TimeoutError("page.screenshot: Timeout 30000ms exceeded."), acquisition = {}, calls = [];
  const png = Buffer.from("recovered PNG bytes");
  let verifications = 0;
  const result = await captureCompactScreenshot({ screenshot: async (options) => {
    calls.push(options);
    if (calls.length === 1) throw timeout;
    return png;
  } }, async () => { verifications += 1; }, acquisition);
  assert.equal(result, png, "the recovery returns its actual bytes, not an earlier buffer");
  assert.deepEqual(calls, [{ timeout: 30_000 }, { timeout: 10_000 }]);
  assert.equal(verifications, 3, "state is checked before acquisition, before recovery and after recovery");
  assert.equal(acquisition.recovered, true);
  assert.deepEqual(acquisition.attempts.map(({ status }) => status), ["failed", "captured"]);
  assert.deepEqual(acquisition.attempts[0].error, { name: "TimeoutError", message: timeout.message });
});

test("compact PNG acquisition does not retry other errors or a second timeout", async () => {
  const pretender = Object.assign(new Error("not a Playwright timeout"), { name: "TimeoutError" });
  for (const failure of [pretender, new Error("Target page, context or browser has been closed"),
    new assert.AssertionError({ message: "invalid screenshot state" })]) {
    let calls = 0;
    const acquisition = {};
    await assert.rejects(captureCompactScreenshot({ screenshot: async () => { calls += 1; throw failure; } },
      async () => {}, acquisition), (error) => error === failure);
    assert.equal(calls, 1);
    assert.equal(acquisition.recovered, false);
  }
  const first = new errors.TimeoutError("first acquisition"), second = new errors.TimeoutError("recovery acquisition");
  let calls = 0;
  const acquisition = {};
  await assert.rejects(captureCompactScreenshot({ screenshot: async () => { throw ++calls === 1 ? first : second; } },
    async () => {}, acquisition), (error) => error === second);
  assert.equal(calls, 2, "there is no third acquisition or retry-until-green loop");
  assert.equal(acquisition.recovered, false);
  assert.deepEqual(acquisition.attempts.map(({ error }) => error.message), [first.message, second.message]);
});

test("compact capture state failures cannot authorize another screenshot", async () => {
  for (const [failVerification, initialTimeout, expectedCalls] of [[1, false, 0], [2, false, 1], [2, true, 1], [3, true, 2]]) {
    const failure = new errors.TimeoutError("state verification failed"), acquisition = {};
    let calls = 0, verifications = 0;
    await assert.rejects(captureCompactScreenshot({ screenshot: async () => {
      calls += 1;
      if (initialTimeout && calls === 1) throw new errors.TimeoutError("page.screenshot timed out");
      return Buffer.from("PNG");
    } }, async () => { if (++verifications === failVerification) throw failure; }, acquisition), (error) => error === failure);
    assert.equal(calls, expectedCalls);
  }
});

test("compact PNG state proof rejects changed frames, selection, layout, buffers and simulation", () => {
  const layout = { resizeEpoch: 2, viewport: { width: 568, height: 320 }, cameraExpanded: false,
    clearances: { camera: 44, dock: 100 }, controls: [{ id: "dock", left: 8, right: 560, top: 212, bottom: 312, width: 552, height: 100 }] };
  const expected = { frame: 91, resizeEpoch: 2, viewport: layout.viewport,
    sample: { ...layout, frame: 91, id: "ganymede", x: 200, y: 100, radius: 20, camera: [1, 2, 3] },
    live: layout, hit: "viewport", playing: false, date: "2000-01-01",
    buffer: { width: 568, height: 320, canvasWidth: 568, canvasHeight: 320 },
    selectedLabels: [{ id: "ganymede", hidden: false, box: { left: 168, top: 60, width: 64, height: 44 } }] };
  assert.doesNotThrow(() => assertCompactCaptureState(expected, structuredClone(expected), "frozen"));
  for (const change of [
    (value) => { value.frame += 1; }, (value) => { value.resizeEpoch += 1; },
    (value) => { value.sample.id = "earth"; }, (value) => { value.sample.x += 1; },
    (value) => { value.sample.camera[0] += 1; }, (value) => { value.viewport.width += 1; },
    (value) => { value.buffer.width += 1; }, (value) => { value.live.controls[0].top += 1; },
    (value) => { value.selectedLabels[0].box.left += 1; }, (value) => { value.selectedLabels[0].hidden = true; },
    (value) => { value.playing = true; }, (value) => { value.date = "2000-01-02"; },
    (value) => { value.hit = "body-card"; },
  ]) {
    const current = structuredClone(expected);
    change(current);
    assert.throws(() => assertCompactCaptureState(expected, current, "changed"), assert.AssertionError);
  }
});

test("compact layout settling rejects the observed delayed 48px Camera clearance reflow", () => {
  // Develop's Io-open render saw the expanded panel before ResizeObserver
  // updated its clearance; the subsequent live card covered the old globe.
  const box = (id, left, top, width, height) => ({ id, left, top, width, height,
    right: left + width, bottom: top + height });
  const intermediate = { frame: 430, resizeEpoch: 0, viewport: { width: 320, height: 568 },
    cameraExpanded: true, clearances: { camera: 44, dock: 152 }, controls: [
      box("body-card", 8, 149.625, 304, 182.375),
      box("camera-controls", 12, 300, 192, 92), box("dock", 8, 404, 304, 152),
    ] };
  const final = structuredClone(intermediate);
  final.frame = 431;
  final.clearances.camera = 92;
  final.controls[0] = box("body-card", 8, 101.625, 304, 182.375);
  assert.equal(compactLayoutMatches(intermediate, final), false, "a live card 48px above the render is stale evidence");
  assert.equal(compactLayoutSettled({ ...intermediate, frame: 429 }, intermediate, final), false);
  assert.equal(compactLayoutSettled({ ...intermediate, frame: 429 }, intermediate, intermediate), false,
    "even unchanged live rectangles cannot accept an undelivered Camera clearance");
  assert.equal(compactLayoutSettled(intermediate, final, final), false, "one fresh reflow frame has not converged");
  const next = { ...final, frame: 432 };
  assert.equal(compactLayoutSettled(final, next, next), true, "consecutive final render and live geometry agree");
  assert.equal(compactLayoutSettled(next, next, next), false, "reusing one rendered frame cannot prove settling");
  assert.equal(compactLayoutSettled(final, next, { ...next, resizeEpoch: 1 }), false, "pending viewport work stays unsettled");
  assert.equal(compactLayoutSettled(final, next, { ...next, clearances: { camera: 92, dock: 151 } }), false);
});

test("compact screenshot validation rejects cleared scene pixels even when HTML labels are painted", () => {
  const width = 80, height = 80, data = new Uint8Array(width * height * 4);
  const sample = { x: 40, y: 40, radius: 30 };
  const label = { left: 20, right: 60, top: 18, bottom: 34 };
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    data.set(x >= label.left && x <= label.right && y >= label.top && y <= label.bottom
      ? [255, 255, 255, 255] : [2, 5, 12, 255], (y * width + x) * 4);
  }
  const blank = compactCaptureMetrics({ data, width, height, left: 0, top: 0 }, sample, [label]);
  assert.equal(blank.coloredFraction, 0, "overlaid text cannot count as rendered globe content");
  assert.throws(() => assertCompactCaptureContent(blank, "cleared resize"), /cleared WebGL surface/);
  assert.throws(() => assertCompactCaptureContent({ samples: 1000, coloredFraction: 1,
    meanBackgroundDifference: 200, luminanceStdDev: 0 }, "uniform surface"), /cleared WebGL surface/);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (Math.hypot(x + 0.5 - sample.x, y + 0.5 - sample.y) < 18) data.set([x * 2, y * 2, 150, 255], (y * width + x) * 4);
  }
  assert.doesNotThrow(() => assertCompactCaptureContent(
    compactCaptureMetrics({ data, width, height, left: 0, top: 0 }, sample, [label]), "rendered globe"));
});

test("compact target measurement tolerates DOMRect roundoff but rejects smaller or clipped targets", () => {
  const label = { layoutWidth: 64, layoutHeight: 44, box: {
    width: 64.375, height: 43.999996185302734,
    left: 127.80693054199219, right: 192.1819305419922,
    top: 57.08046340942383, bottom: 101.08045959472656,
  } };
  const viewport = { width: 320, height: 568 };
  assert.doesNotThrow(() => assertCompactLabelBounds(label, viewport, "observed Venus"));
  assert.throws(() => assertCompactLabelBounds({ ...label, layoutHeight: 43 }, viewport, "short layout"), /44px target/);
  assert.throws(() => assertCompactLabelBounds({ ...label, box: { ...label.box, height: 43.9 } }, viewport, "scaled target"), /full target size/);
  assert.throws(() => assertCompactLabelBounds({ ...label, box: { ...label.box, height: 43.999 } }, viewport, "beyond roundoff"), /full target size/);
  assert.throws(() => assertCompactLabelBounds({ ...label, box: { ...label.box, left: 6.99999 } }, viewport, "clipped target"), /stays on screen/);
});

test("compact framing clears chrome with the whole globe and a full-size label", () => {
  const obstacles = [
    { left: 4, right: 145, top: 2, bottom: 52 },
    { left: 244, right: 564, top: 4, bottom: 190 },
    { left: 4, right: 212, top: 100, bottom: 208 },
    { left: 0, right: 568, top: 204, bottom: 320 },
  ];
  const radius = 44, width = 568, height = 320;
  for (const labelWidth of [56, 95]) {
    const frame = compactFocusFrame(width, height, radius, labelWidth, 44, obstacles);
    assert.ok(frame.zoom > 0.75 && frame.zoom <= 1, "compact globe retains meaningful visible size");
    const bounds = { left: frame.x - Math.max(radius * frame.zoom, labelWidth / 2),
      right: frame.x + Math.max(radius * frame.zoom, labelWidth / 2),
      top: frame.y - Math.max(radius * frame.zoom, 52.8), bottom: frame.y + radius * frame.zoom };
    assert.ok(bounds.left >= 8 && bounds.right <= width - 8 && bounds.top >= 8 && bounds.bottom <= height - 8);
    for (const box of obstacles) assert.ok(bounds.right <= box.left || bounds.left >= box.right
      || bounds.bottom <= box.top || bounds.top >= box.bottom);
    const camera = new THREE.PerspectiveCamera(CONFIG.cameraFovDegrees, width / height, 0.05, 100);
    camera.zoom = frame.zoom;
    camera.setViewOffset(width, height, width / 2 - frame.x, height / 2 - frame.y, width, height);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld(true);
    const screen = new THREE.Vector3().project(camera);
    assert.ok(Math.abs((screen.x + 1) * width / 2 - frame.x) < 1e-9);
    assert.ok(Math.abs((1 - screen.y) * height / 2 - frame.y) < 1e-9);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(screen.x, screen.y), camera);
    assert.ok(ray.ray.distanceToPoint(new THREE.Vector3()) < 1e-9, "shifted scene picking follows projection inverse");
    assert.deepEqual(camera.position.toArray(), [0, 0, 10], "framing never moves the world camera");
  }
  assert.deepEqual(compactFocusFrame(1440, 900, 125, 100, 44, []), { x: 720, y: 450, zoom: 1 });
});

test("compact focus keeps Mercury eligible through fractional Camera-open settling", () => {
  // Measured 320x568 chrome from PR179's first rendered run; obstacles include
  // the unchanged 8px clearance used by the real label-placement predicate.
  const obstacles = [
    { left: 4, right: 144.625, top: 2, bottom: 56.59375 },
    { left: 0, right: 320, top: 93.625, bottom: 292 },
    { left: 4, right: 212, top: 292, bottom: 400 },
    { left: 0, right: 320, top: 396, bottom: 564 },
    { left: 221.015625, right: 322, top: -2, bottom: 58 },
  ];
  const node = { labelWidth: 80.75, labelHeight: 44 };
  const fits = runInNewContext(`${appSource.slice(appSource.indexOf("function bodyLabelFits("),
    appSource.indexOf("function placeBodyLabel("))}\nbodyLabelFits`, {
    BODY_LABEL_CLEARANCE: 8, bodyLabelObstacles: obstacles,
  });
  assert.equal(fits(252.375 - 0.019, 344.8 + 0.0095, node, 320, 568), false,
    "the former boundary seat hides a label with the observed subpixel residual");
  const frame = compactFocusFrame(320, 568, 19.2858, node.labelWidth, node.labelHeight, obstacles);
  assert.equal(frame.zoom, 1, "reserving label space does not shrink Mercury");
  for (const dx of [-0.05, 0, 0.05]) for (const dy of [-0.05, 0, 0.05]) {
    assert.equal(fits(frame.x + dx, frame.y + dy, node, 320, 568), true,
      `the real eligibility gate accepts the label throughout settling (${dx}, ${dy})`);
  }
});

test("minimum landscape keeps the widest world label and globe clear with Camera open", () => {
  // PR179's rendered Ganymede failure: a 99px layout target plus its 1px
  // projection reserve cannot fit the former 99.375px strip beside the card.
  const obstacles = [
    { left: 4, right: 144.625, top: 2, bottom: 53.59375 },
    { left: 244, right: 564, top: 4, bottom: 186.375 },
    { left: 4, right: 212, top: 100, bottom: 208 },
    { left: 0, right: 568, top: 204, bottom: 316 },
    { left: 4, right: 104.984375, top: 46, bottom: 106 },
  ];
  const node = { labelWidth: 99, labelHeight: 44 }, radius = 11.56061564;
  assert.deepEqual(compactFocusFrame(568, 320, radius, node.labelWidth, node.labelHeight, obstacles),
    { x: 284, y: 160, zoom: 1 }, "the former card leaves no valid label seat");
  obstacles[1].left += 4;
  const frame = compactFocusFrame(568, 320, radius, node.labelWidth, node.labelHeight, obstacles);
  assert.equal(frame.zoom, 1, "the corrected card keeps Ganymede at its normal apparent size");
  const fits = runInNewContext(`${appSource.slice(appSource.indexOf("function bodyLabelFits("),
    appSource.indexOf("function placeBodyLabel("))}\nbodyLabelFits`, {
    BODY_LABEL_CLEARANCE: 8, bodyLabelObstacles: obstacles,
  });
  for (const dx of [-0.05, 0, 0.05]) for (const dy of [-0.05, 0, 0.05]) {
    assert.equal(fits(frame.x + dx, frame.y + dy, node, 568, 320), true,
      "the widest label retains its full target and projection reserve");
  }
  for (const box of obstacles) assert.ok(frame.x + radius <= box.left || frame.x - radius >= box.right
    || frame.y + radius <= box.top || frame.y - radius >= box.bottom, "the entire globe clears chrome");
});

function labelTouchInput() {
  const makeSurface = (id) => {
    const captures = new Set();
    return {
      dataset: { bodyId: id }, closest() { return this; },
      setPointerCapture(value) { captures.add(value); },
      hasPointerCapture(value) { return captures.has(value); },
      releasePointerCapture(value) { captures.delete(value); },
    };
  };
  const canvas = makeSurface(null), label = makeSurface("earth"), sibling = makeSurface("venus");
  const state = { distance: 1000, azimuth: 0, elevation: 0, pinching: false, tap: null };
  const pointerIds = new Map(), selected = [], picked = [];
  let canvasFocusCount = 0;
  const input = runInNewContext(`${appSource.slice(
    appSource.indexOf("function onBodyLabelClick("), appSource.indexOf("function onWheel("),
  )}\n${appSource.slice(
    appSource.indexOf("function pointerGap("), appSource.indexOf("function moonZoomNeedsTransition("),
  )}\n({ onBodyLabelClick, onLabelPointerDown, onPointerDown, onPointerMove, onPointerUp, onPointerAbort })`, {
    CONFIG, state, pointerIds, suppressedLabelClicks: new Set(), ui: { viewport: canvas },
    pinchZoomDistance, clamp: (x, a, b) => Math.max(a, Math.min(b, x)),
    zoomTo: (value) => { state.distance = value; }, canvasFocus: () => { canvasFocusCount += 1; },
    pickAt: (...point) => picked.push(point), selectBody: (id) => selected.push(id),
  });
  const event = (id, x, target = canvas, detail = 1) => ({
    pointerId: id, clientX: x, clientY: 100, pointerType: "touch", target, detail, preventDefault() {},
  });
  return { ...input, event, canvas, label, sibling, state, pointerIds, selected, picked,
    canvasFocusCount: () => canvasFocusCount };
}

test("label and canvas touches share pinch zoom in either contact and release order", () => {
  for (const labelFirst of [false, true]) for (const labelUpFirst of [false, true]) {
    const h = labelTouchInput();
    const labelDown = () => h.onLabelPointerDown(h.event(1, 100, h.label));
    const canvasDown = () => h.onPointerDown(h.event(2, 180));
    for (const down of labelFirst ? [labelDown, canvasDown] : [canvasDown, labelDown]) down();
    assert.equal(h.label.hasPointerCapture(1), true, "label keeps its native capture owner");
    assert.equal(h.canvas.hasPointerCapture(1), false);
    assert.equal(h.canvasFocusCount(), 1, "only a canvas contact focuses the canvas");
    h.onPointerMove(h.event(2, 260));
    assert.equal(h.state.distance, 500, "doubling the gap halves distance, as canvas-only input does");
    assert.equal(h.state.azimuth, 0, "mixed pinch does not orbit");
    for (const id of labelUpFirst ? [1, 2] : [2, 1]) {
      h.onPointerUp(h.event(id, id === 1 ? 100 : 260, id === 1 ? h.label : h.canvas));
      h.onPointerAbort(h.event(id, 100)); // native lost capture after normal up
    }
    h.onBodyLabelClick(h.event(1, 100, h.label));
    assert.deepEqual(h.selected, [], "pinch cannot activate its starting label");
    assert.deepEqual(h.picked, [], "pinch cannot raycast a canvas tap");
    assert.equal(h.pointerIds.size, 0);
    assert.equal(h.state.pinching, false);
    h.onBodyLabelClick(h.event(1, 100, h.label, 0));
    assert.deepEqual(h.selected, ["earth"], "keyboard activation ignores pointer-click suppression");
    h.onLabelPointerDown(h.event(3, 100, h.label));
    h.onPointerUp(h.event(3, 100, h.label));
    h.onPointerAbort(h.event(3, 100, h.label));
    h.onBodyLabelClick(h.event(3, 100, h.label));
    assert.deepEqual(h.selected, ["earth", "earth"], "the next native label tap remains selectable");
  }
});

test("label-only gestures preserve native taps and recover after pinch cancellation", () => {
  const h = labelTouchInput();
  h.onLabelPointerDown(h.event(1, 100, h.label));
  h.onPointerMove(h.event(1, 130, h.label));
  assert.equal(h.state.azimuth, 0, "a lone label drag does not start a scene orbit");
  h.onLabelPointerDown(h.event(2, 210, h.sibling));
  h.onPointerMove(h.event(2, 290, h.sibling));
  assert.equal(h.state.distance, 500, "two labels also join the same pinch");
  for (const [id, label] of [[1, h.label], [2, h.sibling]]) {
    h.onPointerAbort(h.event(id, 100, label));
    assert.equal(label.hasPointerCapture(id), false, "abort releases the actual label capture owner");
    h.onBodyLabelClick(h.event(id, 100, label));
  }
  assert.deepEqual(h.selected, []);
  assert.deepEqual(h.picked, []);
  assert.equal(h.state.pinching, false);
  assert.equal(h.pointerIds.size, 0);
  const mouse = { ...h.event(3, 100, h.label), pointerType: "mouse" };
  h.onLabelPointerDown(mouse);
  assert.equal(h.pointerIds.size, 0, "mouse labels retain native button handling");
  h.onBodyLabelClick(mouse);
  assert.deepEqual(h.selected, ["earth"], "stale cancellation cannot swallow a later mouse click");
});

test("a captured lone-label drag keeps the scene still and cannot become a selecting click", () => {
  for (const moved of [CONFIG.tapMovePx - 1, CONFIG.tapMovePx, CONFIG.tapMovePx + 20]) {
    const h = labelTouchInput();
    h.onLabelPointerDown(h.event(1, 100, h.label));
    h.onPointerMove(h.event(1, 100 + moved, h.label));
    h.onPointerUp(h.event(1, 100 + moved, h.label));
    h.onPointerAbort(h.event(1, 100 + moved, h.label));
    h.onBodyLabelClick(h.event(1, 100 + moved, h.label));
    const expected = moved < CONFIG.tapMovePx ? ["earth"] : [];
    assert.deepEqual(h.selected, expected, "only movement below tap slop can select the label");
    assert.equal(h.state.azimuth, 0);
    assert.equal(h.state.elevation, 0);
    assert.equal(h.state.distance, 1000);
    assert.deepEqual(h.picked, []);
    h.onLabelPointerDown(h.event(2, 100, h.label));
    h.onPointerUp(h.event(2, 100, h.label));
    h.onBodyLabelClick(h.event(2, 100, h.label));
    assert.deepEqual(h.selected, [...expected, "earth"], "the next ordinary tap still selects");
  }
});

function bodyLabelLayout(labels, obstacles = []) {
  // Execute the live layout owner with measured-box stand-ins, without a DOM
  // or renderer; the browser suite supplies native hit-testing and font boxes.
  return runInNewContext(`${appSource.slice(
    appSource.indexOf("const BODY_LABEL_CLEARANCE ="),
    appSource.indexOf("const moonFocusTransition ="),
  )}\n${appSource.slice(
    appSource.indexOf("function bodyLabelFits("),
    appSource.indexOf("function updateLabels("),
  )}\n({ placeBodyLabels, bodyLabelFits })`, {
    CONFIG, bodyLabelCandidates: labels, placedBodyLabels: [], bodyLabelObstacles: obstacles,
  });
}

function measuredLabel(id, x, y, width = 90) {
  return {
    label: { id }, labelAnchorX: x, labelAnchorY: y,
    labelWidth: width, labelHeight: 44, labelOffsetX: 0, labelOffsetY: 0, labelPlaced: false,
  };
}

function labelBox(node) {
  const left = node.labelAnchorX + node.labelOffsetX - node.labelWidth / 2;
  const top = node.labelAnchorY + node.labelOffsetY - node.labelHeight * 1.2;
  return { left, top, right: left + node.labelWidth, bottom: top + node.labelHeight };
}

function assertSeparateLabels(labels) {
  for (const [index, first] of labels.filter((node) => node.labelPlaced).entries()) {
    const a = labelBox(first);
    for (const second of labels.filter((node) => node.labelPlaced).slice(index + 1)) {
      const b = labelBox(second);
      assert.ok(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom,
        `${first.label.id}/${second.label.id}: complete hit targets do not overlap`);
    }
  }
}

test("J2000 far-solar labels remain separately reachable on desktop and portrait", () => {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const camera = new THREE.PerspectiveCamera(52, width / height, 0.05, CONFIG.cameraFar);
    const distance = CONFIG.solarMaxDistance;
    camera.position.set(
      distance * Math.cos(CONFIG.cameraElevation) * Math.sin(CONFIG.cameraAzimuth),
      distance * Math.sin(CONFIG.cameraElevation),
      distance * Math.cos(CONFIG.cameraElevation) * Math.cos(CONFIG.cameraAzimuth),
    );
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const labels = BODIES.filter((body) => body.kind !== "moon").map((body) => {
      const at = keplerOffset(body, body.parent ? findBody(body.parent) : null, 0);
      const point = new THREE.Vector3(at.x, at.y, at.z).project(camera);
      return measuredLabel(body.id, (point.x * 0.5 + 0.5) * width, (-point.y * 0.5 + 0.5) * height);
    });
    const layout = bodyLabelLayout(labels);
    for (let index = labels.length - 1; index >= 0; index -= 1) {
      const node = labels[index];
      if (!layout.bodyLabelFits(node.labelAnchorX, node.labelAnchorY, node, width, height)) labels.splice(index, 1);
    }
    layout.placeBodyLabels(width, height, null);
    assert.ok(labels.every((node) => node.labelPlaced), `${width}: all eligible worlds retain a target`);
    assertSeparateLabels(labels);
    const sun = labels.find((node) => node.label.id === "sun");
    assert.equal(sun.labelOffsetX, 0);
    assert.equal(sun.labelOffsetY, 0);
    for (const node of labels) assert.ok(Math.hypot(node.labelOffsetX, node.labelOffsetY) <= CONFIG.bodyLabelMaxOffsetPx);
  }
});

test("crowded moon labels preserve clear anchors, chrome clearance and focused displaced targets", () => {
  const labels = [
    measuredLabel("callisto", 300, 300), measuredLabel("io", 304, 309),
    measuredLabel("europa", 311, 302), measuredLabel("ganymede", 306, 301),
    measuredLabel("clear", 540, 200),
  ];
  const obstacles = [{ left: 130, right: 235, top: 205, bottom: 400 }];
  const layout = bodyLabelLayout(labels, obstacles);
  layout.placeBodyLabels(800, 600, null);
  assert.ok(labels.every((node) => node.labelPlaced));
  assertSeparateLabels(labels);
  assert.deepEqual([labels[0].labelOffsetX, labels[0].labelOffsetY], [0, 0], "scene focus keeps its anchor");
  assert.deepEqual([labels[4].labelOffsetX, labels[4].labelOffsetY], [0, 0], "uncrowded label is unchanged");
  const active = labels.find((node) => node.labelOffsetX || node.labelOffsetY);
  const before = labelBox(active);
  labels.sort((a, b) => Number(b === active) - Number(a === active));
  for (const node of labels) node.labelPlaced = false;
  layout.placeBodyLabels(800, 600, active.label);
  assert.deepEqual(labelBox(active), before, "pointerdown/keyboard focus does not move a displaced target");
  assertSeparateLabels(labels);
  for (const node of labels) assert.equal(layout.bodyLabelFits(
    node.labelAnchorX + node.labelOffsetX, node.labelAnchorY + node.labelOffsetY, node, 800, 600,
  ), true, `${node.label.id} clears chrome and viewport`);
});

test("unplaceable lower-priority labels cannot cover the retained target", () => {
  const labels = [measuredLabel("focused", 60, 70), measuredLabel("sibling", 60, 70)];
  bodyLabelLayout(labels).placeBodyLabels(120, 90, labels[0].label);
  assert.equal(labels[0].labelPlaced, true);
  assert.equal(labels[1].labelPlaced, false);
  assertSeparateLabels(labels);
});

test("compact overview fills a finer gap without moving already placed world labels", () => {
  // Measured 568x320 closed-overview geometry from the matched J2000 browser
  // capture. Widths use offsetWidth, as the runtime does. The old 24px grid
  // hid Mars even though a full target fits 36px below its natural seat.
  const measurements = [
    ["sun", 284, 160, 47, 0, 0],
    ["mercury", 263.124, 170.405, 81, -48, 0],
    ["venus", 257.169, 151.267, 64, 0, -48],
    ["earth", 296.551, 144.433, 59, 48, -48],
    ["mars", 324.831, 173.319, 55, 0, 36],
    ["ceres", 247.359, 129.834, 61, -72, -24],
    ["jupiter", 377.615, 157.856, 70, 0, 0],
    ["saturn", 405.699, 149.742, 70, 48, 0],
  ];
  const labels = measurements.map(([id, x, y, width]) => measuredLabel(id, x, y, width));
  // Chrome rectangles include the runtime's 8px clearance. The Camera toggle
  // uses a conservative right edge, well left of the recovered Mars target.
  const obstacles = [
    { left: 4, right: 144.625, top: 2, bottom: 53.594 },
    { left: 0, right: 568, top: 204, bottom: 316 },
    { left: 4, right: 96.047, top: 46, bottom: 106 },
    { left: 4, right: 110, top: 148, bottom: 208 },
  ];
  const layout = bodyLabelLayout(labels, obstacles);
  layout.placeBodyLabels(568, 320, null);
  for (const [index, node] of labels.entries()) {
    assert.equal(node.labelPlaced, true, `${node.label.id} retains its target`);
    assert.deepEqual([node.labelOffsetX, node.labelOffsetY], measurements[index].slice(4),
      `${node.label.id}: preserve every coarse placement and restore Mars in the finer gap`);
    assert.ok(Math.hypot(node.labelOffsetX, node.labelOffsetY) <= CONFIG.bodyLabelMaxOffsetPx);
    assert.equal(layout.bodyLabelFits(
      node.labelAnchorX + node.labelOffsetX, node.labelAnchorY + node.labelOffsetY, node, 568, 320,
    ), true, `${node.label.id} clears chrome and viewport`);
  }
  assertSeparateLabels(labels);
  const mars = labels.find((node) => node.label.id === "mars");
  const before = labelBox(mars);
  for (const id of ["sun", "jupiter"]) {
    const above = labelBox(labels.find((node) => node.label.id === id));
    assert.ok(before.top - above.bottom >= CONFIG.bodyLabelGapPx, `Mars clears ${id}'s full target`);
  }
  labels.sort((a, b) => Number(b === mars) - Number(a === mars));
  for (const node of labels) node.labelPlaced = false;
  layout.placeBodyLabels(568, 320, mars.label);
  assert.equal(mars.labelPlaced, true);
  assert.deepEqual(labelBox(mars), before, "focus preserves the finer-grid target until activation");
  assertSeparateLabels(labels);
});

test("Reset view restores the same label positions after orbit and focus easing", () => {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const labels = BODIES.filter((body) => body.kind !== "moon").map((body) => (
      Object.assign(measuredLabel(body.id, 0, 0), { body })
    ));
    const candidates = [];
    const layout = bodyLabelLayout(candidates);
    const state = {};
    const resetView = runInNewContext(`${appSource.slice(
      appSource.indexOf("function resetView("), appSource.indexOf("function changeConstellationMode("),
    )}\nresetView`, {
      CONFIG, state, nodes: new Map(labels.map((node) => [node.body.id, node])),
      parentGlobeContinuity: {}, moonFocusTransition: {}, earthSkyLook: false, galaxyPreparing: false,
      resetParentGlobeContinuity() {}, setMoonFocusTransition() {}, paintCard() {},
      paintConstellations() {}, paintSceneSemantics() {}, say() {},
    });
    const project = (center = new THREE.Vector3()) => {
      const camera = new THREE.PerspectiveCamera(52, width / height, 0.05, CONFIG.cameraFar);
      camera.position.set(
        state.distance * Math.cos(state.elevation) * Math.sin(state.azimuth),
        state.distance * Math.sin(state.elevation),
        state.distance * Math.cos(state.elevation) * Math.cos(state.azimuth),
      ).add(center);
      camera.lookAt(center);
      camera.updateMatrixWorld(true);
      candidates.length = 0;
      for (const node of labels) {
        const at = keplerOffset(node.body, node.body.parent ? findBody(node.body.parent) : null, 0);
        const point = new THREE.Vector3(at.x, at.y, at.z).project(camera);
        node.labelAnchorX = (point.x * 0.5 + 0.5) * width;
        node.labelAnchorY = (-point.y * 0.5 + 0.5) * height;
        node.labelPlaced = false;
        if (layout.bodyLabelFits(node.labelAnchorX, node.labelAnchorY, node, width, height)) candidates.push(node);
      }
      layout.placeBodyLabels(width, height, null);
      assertSeparateLabels(candidates);
      return candidates.filter((node) => node.labelPlaced).map((node) => ({ id: node.body.id, ...labelBox(node) }));
    };
    resetView();
    const baseline = project();
    for (let step = 1; step <= 8; step += 1) {
      state.azimuth += CONFIG.cameraOrbitStep;
      project();
    }
    state.azimuth = CONFIG.cameraAzimuth;
    assert.deepEqual(project(), baseline, `${width}: returning through reused nodes is history-independent`);
    resetView();
    assert.deepEqual(project(), baseline, `${width}: orbit then Reset restores the original targets`);
    // Reset's existing camera flight can continue projecting intermediate
    // centers. Those frames must not seed a different settled home layout.
    const earth = keplerOffset(findBody("earth"), findBody("sun"), 0);
    resetView();
    for (let step = 8; step > 0; step -= 1) {
      project(new THREE.Vector3(earth.x, earth.y, earth.z).multiplyScalar(step / 8));
    }
    assert.deepEqual(project(), baseline, `${width}: focus easing does not change the settled home targets`);
  }
});

const orbitalProvenance = JSON.parse(await readFile(
  new URL("./fixtures/orbital-provenance.json", import.meta.url), "utf8",
));
const textureProvenance = JSON.parse(await readFile(
  new URL("./fixtures/texture-provenance.json", import.meta.url), "utf8",
));
const assetDigestManifest = JSON.parse(await readFile(
  new URL("./fixtures/asset-digest-manifest.json", import.meta.url), "utf8",
));

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function rasterSize(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  let offset = 2;
  while (offset < bytes.length - 8) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    }
    if (marker === 0xda) break;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  throw new Error("raster size not found");
}

test("every scientific catalog row has a complete preservation and provenance record", () => {
  const expectedSources = {
    sun: "fixed-sun",
    mercury: "legacy-heliocentric",
    venus: "legacy-heliocentric",
    earth: "legacy-heliocentric",
    moon: "satellite-de405-le405",
    mars: "legacy-heliocentric",
    phobos: "satellite-mar099",
    deimos: "satellite-mar099",
    ceres: "ceres-horizons",
    jupiter: "legacy-heliocentric",
    io: "satellite-jup365",
    europa: "satellite-jup365",
    ganymede: "satellite-jup365",
    callisto: "satellite-jup365",
    saturn: "legacy-heliocentric",
    titan: "satellite-sat441",
    uranus: "legacy-heliocentric",
    neptune: "neptune-table-1",
    triton: "satellite-nep097",
    pluto: "legacy-heliocentric",
  };
  assert.deepEqual(Object.keys(expectedSources), BODIES.map((body) => body.id));
  assert.deepEqual(orbitalProvenance.rows.map((row) => row.id), BODIES.map((body) => body.id));
  for (const body of BODIES) {
    const row = orbitalProvenance.rows.find((entry) => entry.id === body.id);
    // Omit only presentation metadata; new scientific fields require a ledger update.
    const { id, name, kind, texture, color, ring, ...scientific } = body;
    assert.deepEqual(scientific, row.catalog, `${id}: update the source record with any scientific change`);
    assert.equal(row.record, name);
    assert.equal(row.source, expectedSources[id], `${id}: retain the independently verified source classification`);
    for (const sourceId of [row.source, row.periodSource].filter(Boolean)) {
      const source = orbitalProvenance.sources[sourceId];
      assert.ok(source, `${id}: source ${sourceId} exists`);
      for (const field of ["uri", "table", "version", "epoch", "timeScale", "center", "frame", "elementType", "units", "derivation", "validity"]) {
        assert.equal(typeof source[field], "string", `${id}: ${field} is documented`);
        assert.ok(source[field].trim(), `${id}: ${field} is not empty`);
      }
      assert.equal(new URL(source.uri).protocol, "https:");
      if (sourceId === "legacy-heliocentric") {
        assert.equal(source.upstreamUri, null, "unrecovered Keplerian-angle provenance is explicit");
        assert.equal(source.upstreamTable, null);
        assert.equal(source.upstreamVersion, null);
        assert.ok(source.gap.startsWith("https://github.com/XenoVoyage/Helios/issues/"));
        assert.match(source.gap.slice("https://github.com/XenoVoyage/Helios/issues/".length), /^\d+$/);
      } else if (sourceId === "nasa-nssdc-sidereal-period") {
        assert.match(source.table, /Sidereal orbit period \(days\)/, `${id}: period source is the fact-sheet sidereal column`);
        assert.match(source.derivation, /tropical/i, `${id}: tropical comparison-table row is excluded`);
        assert.equal(source.epoch, "not applicable to a period scalar");
        assert.equal(source.timeScale, "not applicable");
      } else if (sourceId !== "fixed-sun") {
        assert.match(source.timeScale, /^TDB\b/, `${id}: verified epoch time scale is TDB`);
        assert.match(source.epoch, /\bJD 2451545\.0\b/, `${id}: verified source epoch is JD 2451545.0`);
      }
    }
  }
});

test("published orbital source columns and derived angles reproduce their catalog rows", () => {
  const wrapDegrees = (degrees) => ((degrees % 360) + 360) % 360;
  for (const row of orbitalProvenance.rows) {
    const body = findBody(row.id);
    const ref = row.reference;
    let expected;
    if (row.source === "ceres-horizons") {
      assert.ok(ref, "Ceres has its retained Horizons source fields");
      expected = { orbitAu: ref.A, eccentricity: ref.EC, inclinationDeg: ref.IN, nodeDeg: ref.OM, periDeg: ref.W, meanAnomalyDeg: ref.MA, orbitDays: ref.PR };
    } else if (row.source === "neptune-table-1") {
      assert.ok(ref, "Neptune has all six original Table 1 coefficients");
      expected = { orbitAu: ref.a, eccentricity: ref.e, inclinationDeg: ref.I, nodeDeg: ref.longNode };
      assert.ok(Math.abs(body.periDeg - wrapDegrees(ref.longPeri - ref.longNode)) < 1e-10);
      assert.ok(Math.abs(body.meanAnomalyDeg - wrapDegrees(ref.L - ref.longPeri)) < 1e-10);
      assert.equal(row.periodSource, "nasa-nssdc-sidereal-period", "Table 1 does not own the recovered fact-sheet period");
    } else if (row.source.startsWith("satellite-")) {
      assert.ok(ref, `${row.id}: published moon row is retained`);
      assert.equal(body.kind, "moon");
      const source = orbitalProvenance.sources[row.source];
      assert.equal(source.center, `${findBody(body.parent).name} (planet center)`, `${row.id}: source center matches the parent`);
      const fields = ["a", "e", "i", "node", "w", "M", "P"];
      if (row.id !== "moon") fields.push("poleRA", "poleDec");
      for (const field of fields) {
        assert.equal(typeof ref[field], "string", `${row.id}: ${field} retains source decimal text`);
        assert.match(ref[field], /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/, `${row.id}: ${field} is nonempty decimal text`);
      }
      expected = { orbitKm: Number(ref.a), eccentricity: Number(ref.e), inclinationDeg: Number(ref.i), nodeDeg: Number(ref.node), periDeg: Number(ref.w), meanAnomalyDeg: Number(ref.M), orbitDays: Number(ref.P) };
      if (row.id === "moon") {
        assert.match(source.frame, /^ecliptic(?:;|$)/);
        assert.equal(ref.poleRA, null);
        assert.equal(ref.poleDec, null);
        assert.deepEqual(body.orbitFrame, { kind: "ecliptic" });
      } else {
        assert.match(source.frame, /^local Laplace plane(?:;|$)/);
        assert.equal(body.orbitFrame.kind, "laplace");
        assert.equal(body.orbitFrame.poleRaDeg, Number(ref.poleRA));
        assert.equal(body.orbitFrame.poleDecDeg, Number(ref.poleDec));
        const parent = findBody(body.parent).orientationJ2000;
        assert.deepEqual(body.orbitFrame.parentPole, { raDeg: parent.poleRaDeg, decDeg: parent.poleDecDeg });
      }
    } else {
      assert.ok(["fixed-sun", "legacy-heliocentric"].includes(row.source));
      assert.equal(ref, undefined, `${row.id}: do not fabricate authoritative Keplerian reference columns`);
      continue;
    }
    assert.deepEqual(Object.fromEntries(Object.keys(expected).map((key) => [key, body[key]])), expected, `${row.id}: published orbital fields`);
  }
});

test("dated NASA fact-sheet sidereal periods reproduce the inherited orbitDays literals", () => {
  const expectedPrintings = {
    mercury: "87.969",
    venus: "224.701",
    earth: "365.256",
    mars: "686.980",
    jupiter: "4,332.589",
    saturn: "10,759.22",
    uranus: "30,685.4",
    neptune: "60,189.",
    pluto: "90,560",
  };
  for (const [id, printed] of Object.entries(expectedPrintings)) {
    const row = orbitalProvenance.rows.find((entry) => entry.id === id);
    const body = findBody(id);
    assert.equal(row.periodSource, "nasa-nssdc-sidereal-period", `${id}: period owner is the dated fact sheet`);
    assert.equal(row.periodReference.P, printed, `${id}: retain the printed sidereal-period text`);
    assert.equal(Number(printed.replaceAll(",", "")), body.orbitDays, `${id}: printed period parses to the catalog`);
    assert.equal(row.catalog.orbitDays, body.orbitDays);
  }
  assert.equal(orbitalProvenance.sources["legacy-heliocentric"].upstreamUri, null);
  assert.equal(
    orbitalProvenance.rows.filter((row) => row.source === "legacy-heliocentric").length,
    8,
    "eight inherited Keplerian-angle rows remain unrecovered",
  );
});

test("every body texture has a complete source and transformation record", async () => {
  const requiredFamilies = {
    sun: "solar-system-scope-2k",
    mercury: "solar-system-scope-2k",
    venus: "solar-system-scope-2k",
    earth: "solar-system-scope-2k",
    moon: "solar-system-scope-2k",
    mars: "solar-system-scope-2k",
    phobos: "nasa-3d-resources-jpeg",
    deimos: "nasa-3d-resources-jpeg",
    ceres: "solar-system-scope-2k",
    jupiter: "solar-system-scope-2k",
    io: "nasa-3d-resources-jpeg",
    europa: "nasa-3d-resources-jpeg",
    ganymede: "nasa-3d-resources-jpeg",
    callisto: "nasa-3d-resources-jpeg",
    saturn: "solar-system-scope-2k",
    "saturn-ring": "solar-system-scope-2k",
    titan: "nasa-3d-resources-jpeg",
    uranus: "solar-system-scope-2k",
    neptune: "solar-system-scope-2k",
    triton: "lpi-triton-mosaic",
    pluto: "nasa-3d-resources-jpeg",
  };
  const expectedIds = [];
  for (const body of BODIES) {
    expectedIds.push(body.id);
    if (body.ring) expectedIds.push("saturn-ring");
  }
  assert.deepEqual(Object.keys(requiredFamilies), expectedIds);
  assert.deepEqual(textureProvenance.files.map((row) => row.id), expectedIds);
  assert.equal(findBody("saturn").ring, "assets/textures/saturn-ring.png");

  for (const [familyId, family] of Object.entries(textureProvenance.families)) {
    for (const field of ["origin", "license", "licenseUri", "attribution", "versionPin", "projection", "heliosTransformSummary"]) {
      assert.equal(typeof family[field], "string", `${familyId}: ${field} is documented`);
      assert.ok(family[field].trim(), `${familyId}: ${field} is not empty`);
    }
    assert.equal(new URL(family.origin).protocol, "https:");
    assert.equal(new URL(family.licenseUri).protocol, "https:");
  }

  for (const body of BODIES) {
    const row = textureProvenance.files.find((entry) => entry.id === body.id);
    assert.equal(row.path, body.texture, `${body.id}: fixture path matches the catalog texture`);
  }

  for (const row of textureProvenance.files) {
    const bytes = await readFile(new URL(`../${row.path}`, import.meta.url));
    const family = textureProvenance.families[row.family];
    assert.ok(family, `${row.id}: family ${row.family} exists`);
    assert.equal(row.family, requiredFamilies[row.id], `${row.id}: retain the recovered family classification`);
    assert.equal(sha256Bytes(bytes), row.trackedDigest, `${row.id}: tracked digest matches the file`);
    assert.equal(bytes.length, row.bytes, `${row.id}: recorded byte length matches the file`);
    const size = rasterSize(bytes);
    assert.equal(size.width, row.width, `${row.id}: recorded width matches the file`);
    assert.equal(size.height, row.height, `${row.id}: recorded height matches the file`);
    assert.equal(new URL(row.upstreamUri).protocol, "https:");
    assert.equal(typeof row.upstreamName, "string");
    assert.ok(row.upstreamName.trim());
    assert.equal(typeof row.upstreamVersion, "string");
    assert.ok(row.upstreamVersion.trim());
    assert.match(row.heliosEntered, /^[0-9a-f]{40}$/);
    assert.equal(typeof row.projection, "string");
    assert.ok(Array.isArray(row.caveats));
    assert.ok(row.caveats.length > 0, `${row.id}: retained caveats are explicit`);
    assert.equal(row.unresolved, null, `${row.id}: recovered body textures must not hide an unresolved pixel transform`);

    const transform = row.transformation;
    for (const flag of ["crop", "resample", "color", "fill", "longitudeShift"]) {
      assert.equal(typeof transform[flag], "boolean", `${row.id}: ${flag} is explicit`);
    }
    assert.equal(typeof transform.record, "string");
    assert.ok(transform.record.trim());

    if (transform.kind === "identity") {
      assert.equal(row.sourceDigest, row.trackedDigest, `${row.id}: identity records require equal source and tracked digests`);
      assert.equal(transform.crop, false);
      assert.equal(transform.resample, false);
      assert.equal(transform.color, false);
      assert.equal(transform.fill, false);
      assert.equal(transform.longitudeShift, false);
      assert.match(transform.record, /no crop, resample, color, fill, or longitude operation/i);
    } else {
      assert.equal(transform.kind, "documented", `${row.id}: non-identity history must be documented, not guessed`);
      assert.notEqual(row.sourceDigest, row.trackedDigest, `${row.id}: documented transforms retain a distinct source digest`);
      assert.match(row.sourceDigest, /^[0-9a-f]{64}$/);
    }
  }

  const venus = textureProvenance.files.find((row) => row.id === "venus");
  assert.equal(venus.upstreamName, "2k_venus_atmosphere.jpg");
  assert.doesNotMatch(venus.upstreamName, /surface/);
  const ceres = textureProvenance.files.find((row) => row.id === "ceres");
  assert.equal(ceres.upstreamName, "2k_ceres_fictional.jpg");
  const ring = textureProvenance.files.find((row) => row.id === "saturn-ring");
  assert.equal(ring.upstreamName, "2k_saturn_ring_alpha.png");
  const io = textureProvenance.files.find((row) => row.id === "io");
  assert.equal(io.upstreamName, "Jupiter - Io (A).jpg");
  assert.doesNotMatch(io.upstreamPath, /Io \(B\)/);
  const triton = textureProvenance.files.find((row) => row.id === "triton");
  assert.equal(triton.transformation.kind, "documented");
  assert.equal(triton.transformation.fill, true);
  assert.equal(triton.transformation.resample, true);
  assert.match(textureProvenance.scope, /asset-digest-manifest\.json/);
  for (const row of textureProvenance.files) {
    const digestRow = assetDigestManifest.files.find((entry) => entry.path === row.path);
    assert.ok(digestRow, `${row.id}: image-asset digest fixture owns this path`);
    assert.equal(row.trackedDigest, digestRow.sha256, `${row.id}: tracked digest matches the image-asset digest fixture`);
    assert.equal(row.family, digestRow.family, `${row.id}: family membership matches the image-asset digest fixture`);
  }
});

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

test("Spin helper arrows follow the rendered Three.js Y-rotation direction", () => {
  for (const id of ["earth", "venus"]) {
    const body = findBody(id);
    const helpers = createFocusHelpers(THREE);
    const scene = new THREE.Scene();
    const parentNode = { pivot: new THREE.Group(), tilt: new THREE.Group() };
    const node = { pivot: new THREE.Group(), tilt: new THREE.Group() };
    scene.add(parentNode.pivot);
    parentNode.pivot.add(node.pivot);
    node.pivot.add(node.tilt);
    bindFocusHelpers(THREE, helpers, { body, node, parentNode, scene });

    const arc = helpers.spin.children[0];
    const positions = arc.geometry.getAttribute("position");
    const first = new THREE.Vector3().fromBufferAttribute(positions, 0);
    const second = new THREE.Vector3().fromBufferAttribute(positions, 1);
    const actual = second.clone().sub(first).normalize();
    const stepAngle = Math.PI * 1.55 / 48 * Math.sign(1 / renderedSpinPeriod(body));
    const expectedPoint = first.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), stepAngle);
    const expected = expectedPoint.sub(first).normalize();
    assert.ok(actual.dot(expected) > 1 - 1e-9, `${body.name} arc matches rendered spin`);

    const cone = helpers.spin.children[1];
    const coneDirection = new THREE.Vector3(0, 1, 0).applyQuaternion(cone.quaternion).normalize();
    const last = new THREE.Vector3().fromBufferAttribute(positions, positions.count - 1);
    const beforeLast = new THREE.Vector3().fromBufferAttribute(positions, positions.count - 2);
    const lastSegment = last.sub(beforeLast).normalize();
    assert.ok(coneDirection.dot(lastSegment) > 0.99, `${body.name} arrowhead follows its arc`);
  }
});

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

test("Neptune J2000 row matches one JPL Approximate Positions Table 1 snapshot", () => {
  const neptune = findBody("neptune");
  assert.equal(neptune.radiusKm, 24622);
  assert.equal(neptune.orbitAu, 30.06992276);
  assert.equal(neptune.eccentricity, 0.00859048);
  assert.equal(neptune.inclinationDeg, 1.77004347);
  assert.equal(neptune.nodeDeg, 131.78422574);
  assert.equal(neptune.periDeg, 273.18053653);
  assert.equal(neptune.meanAnomalyDeg, 259.91520804);
  assert.equal(neptune.orbitDays, 60189);
  assert.equal(neptune.rotationHours, 16.11);
  assert.equal(neptune.tiltDeg, 28.32);
  assert.deepEqual(neptune.orientationJ2000, {
    poleRaDeg: 299.3337389588,
    poleDecDeg: 42.9503590218,
    primeMeridianDeg: null,
    spinDirection: 1,
  });
  assert.equal(neptune.texture, "assets/textures/neptune.jpg");

  const at = keplerOffset(neptune, findBody("sun"), 0);
  const compressed = visualOrbit(neptune.orbitAu);
  const scale = neptune.orbitAu / compressed;
  const sceneAu = { x: at.x * scale, y: at.y * scale, z: at.z * scale };
  const expected = {
    x: 16.804762811918863,
    y: 0.12740321008663313,
    z: 24.99270986023979,
  };
  assert.ok(Math.abs(sceneAu.x - expected.x) < 1e-12, `Neptune X ${sceneAu.x}`);
  assert.ok(Math.abs(sceneAu.y - expected.y) < 1e-12, `Neptune Y ${sceneAu.y}`);
  assert.ok(Math.abs(sceneAu.z - expected.z) < 1e-12, `Neptune Z ${sceneAu.z}`);
});

test("Ceres J2000 row matches one JPL Horizons geometric snapshot", () => {
  const ceres = findBody("ceres");
  assert.equal(ceres.radiusKm, 469.7);
  assert.equal(ceres.orbitAu, 2.766496019994375);
  assert.equal(ceres.eccentricity, 0.07837562647163041);
  assert.equal(ceres.inclinationDeg, 10.58336045805628);
  assert.equal(ceres.nodeDeg, 80.49435747295276);
  assert.equal(ceres.periDeg, 73.92286274285223);
  assert.equal(ceres.meanAnomalyDeg, 6.176654513180486);
  assert.equal(ceres.orbitDays, 1680.712776442072);
  assert.equal(ceres.rotationHours, 9.074);
  assert.equal(ceres.tiltDeg, 4);
  assert.deepEqual(ceres.orientationJ2000, {
    poleRaDeg: 291.418,
    poleDecDeg: 66.764,
    primeMeridianDeg: null,
    spinDirection: 1,
  });
  assert.equal(ceres.texture, "assets/textures/ceres.jpg");

  const at = keplerOffset(ceres, findBody("sun"), 0);
  const compressed = visualOrbit(ceres.orbitAu);
  const scale = ceres.orbitAu / compressed;
  const sceneAu = { x: at.x * scale, y: at.y * scale, z: at.z * scale };
  const expected = {
    x: -2.379327705915647,
    y: 0.4630055715902157,
    z: -0.7954860388931395,
  };
  assert.ok(Math.abs(sceneAu.x - expected.x) < 1e-12, `Ceres X ${sceneAu.x}`);
  assert.ok(Math.abs(sceneAu.y - expected.y) < 1e-12, `Ceres Y ${sceneAu.y}`);
  assert.ok(Math.abs(sceneAu.z - expected.z) < 1e-12, `Ceres Z ${sceneAu.z}`);
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
    ["ceres", 4.003, 0.01],
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

test("time floor is real time while startup remains one hour per second", () => {
  assert.equal(CONFIG.defaultDaysPerSecond, 1 / 24);
  assert.equal(CONFIG.minDaysPerSecond, 1 / 86400);
  assert.equal(CONFIG.maxDaysPerSecond, 400);
  assert.equal(formatDaysPerSecond(CONFIG.minDaysPerSecond), "1 s");
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
