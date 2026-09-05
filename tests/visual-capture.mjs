// Supplemental comparison evidence. This deliberately does not replace npm test.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const options = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const name = process.argv[index];
  if (name === "--inventory-only") { options.set(name, true); continue; }
  assert.ok(name?.startsWith("--") && process.argv[index + 1], "named argument needs a value");
  options.set(name, process.argv[++index]);
}
const inventoryOnly = options.has("--inventory-only");
for (const name of ["--source-root", "--source-label", ...(inventoryOnly ? [] : ["--output"])]) assert.ok(options.has(name), `${name} is required`);
for (const name of options.keys()) assert.ok(["--source-root", "--output", "--source-label", "--inventory-only", "--group"].includes(name), `unknown argument ${name}`);
const group = options.get("--group") || "all";
assert.ok(["all", "bodies", "desktop-moons", "touch-moons", "other"].includes(group), "group must be all, bodies, desktop-moons, touch-moons or other");
const sourceRoot = path.resolve(options.get("--source-root"));
const output = options.has("--output") ? path.resolve(options.get("--output")) : null;
const sourceLabel = options.get("--source-label");
assert.ok(["main", "develop", "candidate"].includes(sourceLabel));
assert.ok(output === null || (output !== sourceRoot && !output.startsWith(sourceRoot + path.sep)), "evidence must be outside the immutable source checkout");
const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const harnessClean = git(harnessRoot, "status", "--porcelain", "--untracked-files=all") === "";
if (!inventoryOnly) assert.equal(harnessClean, true, "capture harness starts clean");
assert.equal(git(sourceRoot, "status", "--porcelain", "--untracked-files=all"), "", "renderer source starts clean");
const sourceIdentity = {
  label: sourceLabel,
  commit: git(sourceRoot, "rev-parse", "HEAD"),
  tree: git(sourceRoot, "rev-parse", "HEAD^{tree}"),
};
const bodyMath = await import(pathToFileURL(path.join(sourceRoot, "js/bodies.js")));
const configMath = await import(pathToFileURL(path.join(sourceRoot, "js/config.js")));
const { equatorialVectorToScene } = await import(pathToFileURL(path.join(sourceRoot, "js/sky.js")));
const { BODIES, findBody, visualBodyRadius, keplerOffset, moonOrbitAttachment, bodyOrientationBasis } = bodyMath;
const { CONFIG } = configMath;
const primaryIds = BODIES.filter((body) => body.kind !== "moon").map((body) => body.id);
const moonIds = BODIES.filter((body) => body.kind === "moon").map((body) => body.id);
assert.equal(BODIES.length, 20);
assert.equal(moonIds.length, 9);
const touchMoons = ["moon", "phobos", "io", "triton"];
const radius = (id) => visualBodyRadius(findBody(id));
const framedDistance = (id) => Math.max(radius(id) * 7.5, 5.5);
// Main predates the per-body floor. Preserve that source's actual supported minimum.
const minimumDistance = (id) => configMath.minimumFocusDistance
  ? configMath.minimumFocusDistance(radius(id)) : CONFIG.minDistance;
const expected = new Set();
const expect = (name) => { assert.ok(!expected.has(name), `duplicate expected shot ${name}`); expected.add(name); };
for (const id of primaryIds) expect(`desktop-minimum-zoom-${id}`);
for (const id of ["sun", "jupiter", "saturn"]) expect(`touch-portrait-minimum-zoom-${id}`);
for (const [prefix, ids] of [["desktop", moonIds], ["touch-portrait", touchMoons]]) {
  for (const id of ids) {
    for (const seat of ["min", "close", "cross", "reverse", "pick-target", "picked"]) expect(`${prefix}-moon-parent-${seat}-${id}`);
  }
  for (const seat of ["start", "mid"]) expect(`${prefix}-moon-parent-transition-io-${seat}`);
  for (const id of ["uranus", "neptune"]) {
    for (const seat of ["framed", "minimum", "half-lit", "sunward"]) expect(`${prefix}-night-side-${seat}-${id}`);
  }
  for (const action of ["reset", "escape", "planet-interruption", "repeated-focus", "zoom-reversal"]) {
    for (const seat of ["active", "settled"]) expect(`supplement-${prefix}-busy-${action}-${seat}`);
  }
}
for (const seat of ["front", "back"]) expect(`desktop-saturn-rings-${seat}`);
for (const action of ["button", "escape"]) expect(`desktop-sky-${action}`);
for (const body of BODIES) {
  for (const seat of ["framed", "intermediate", "zoom-back-out"]) {
    if (["uranus", "neptune"].includes(body.id) && seat === "framed") continue;
    expect(`supplement-desktop-${body.id}-${seat}`);
  }
}
const responsiveSizes = [[320, 568], [568, 320], [390, 844], [844, 390], [768, 1024], [1024, 768]];
for (const [width, height] of responsiveSizes) expect(`supplement-responsive-${width}x${height}`);
assert.equal(expected.size, 200);
const completeMatrix = [...expected];
const groupFor = (name) => {
  if (name.includes("-moon-parent-")) return name.startsWith("desktop-") ? "desktop-moons" : "touch-moons";
  if (name.startsWith("desktop-minimum-zoom-") || (name.startsWith("supplement-desktop-") && !name.includes("-busy-"))) return "bodies";
  return "other";
};
for (const name of expected) if (group !== "all" && groupFor(name) !== group) expected.delete(name);
assert.equal(expected.size, { all: 200, bodies: 69, "desktop-moons": 56, "touch-moons": 26, other: 49 }[group]);

if (inventoryOnly) {
  console.log(JSON.stringify({
    mode: "inventory only; no browser launched, no screenshots captured, no visual pass asserted",
    group,
    completeMatrixCount: completeMatrix.length,
    fullExpected: completeMatrix,
    source: sourceIdentity,
    harness: { commit: git(harnessRoot, "rev-parse", "HEAD"), tree: git(harnessRoot, "rev-parse", "HEAD^{tree}"), clean: harnessClean, sha256: sha256(await readFile(fileURLToPath(import.meta.url))) },
    expected: [...expected].map((name) => {
      const compact = name.match(/responsive-(\d+)x(\d+)$/);
      return {
        name,
        viewport: compact ? [Number(compact[1]), Number(compact[2])] : name.includes("touch-portrait") ? [390, 844] : [1440, 900],
        scenario: name.replace(/^supplement-/, "").replaceAll("-", " "),
      };
    }),
    sourceDistances: BODIES.map(({ id }) => ({ id, framed: framedDistance(id), minimum: minimumDistance(id) })),
  }, null, 2));
  process.exit(0);
}

await mkdir(output, { recursive: true });
const manifest = {
  schema: 1,
  group,
  completeMatrixCount: completeMatrix.length,
  fullExpected: completeMatrix,
  source: sourceIdentity,
  harness: {
    commit: git(harnessRoot, "rev-parse", "HEAD"),
    tree: git(harnessRoot, "rev-parse", "HEAD^{tree}"),
    clean: harnessClean,
    sha256: sha256(await readFile(fileURLToPath(import.meta.url))),
  },
  node: process.version,
  playwright: JSON.parse(await readFile(path.join(harnessRoot, "node_modules/playwright/package.json"), "utf8")).version,
  rendering: "Headless Chromium; ANGLE SwiftShader; deviceScaleFactor 1; screenshots are full viewport originals",
  clockPolicy: "Playwright clock installed before navigation. A ready observer uses the public Pause control; a thin requestAnimationFrame wrapper additionally verifies and, if necessary, pauses through that control immediately before the first application tick callback. The first-tick record is asserted on every page. The wrapper preserves timestamps and callback execution. After loading, browser time is paused and advanced with runFor. No simulation-time or camera-state hook is injected. Matching labels alone do not prove matching camera/time.",
  limits: [
    "Touch is emulated with CDP, not physical hardware.",
    "Body selection buttons use DOM click, while camera/pick gestures use browser mouse or CDP touch input.",
    "Source minimum zoom differs: main has a global floor; develop/candidate have a source-owned per-body floor.",
    "Main has no aria-busy attribute; absence is recorded, never converted to false.",
    "Screenshots do not certify physical screen-reader behavior or universal scientific correctness.",
  ],
  expected: [...expected],
  captures: [],
  failures: [],
  browserErrors: [],
  timings: [],
};
const flush = () => writeFile(path.join(output, "capture-details.json"), JSON.stringify(manifest, null, 2) + "\n");
const port = Number(process.env.VISUAL_CAPTURE_PORT || 4177);
const base = `http://127.0.0.1:${port}/Helios/`;
const server = spawn(process.execPath, [path.join(sourceRoot, "tests/serve.mjs")], {
  cwd: sourceRoot, env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"],
});
let browser;
const states = new WeakMap();
let nextPageId = 1;

async function advance(page, milliseconds) {
  const state = states.get(page);
  const started = performance.now();
  const timing = { page: state.id, operation: "clock.runFor", controlledBefore: state.elapsed, milliseconds };
  try {
    await page.clock.runFor(milliseconds);
    state.elapsed += milliseconds;
  } catch (error) {
    timing.error = String(error);
    throw error;
  } finally {
    timing.wallMilliseconds = Math.round(performance.now() - started);
    manifest.timings.push(timing);
  }
}

async function screenshot(page, purpose) {
  const state = states.get(page);
  const started = performance.now();
  const timing = { page: state.id, operation: "page.screenshot", purpose, controlledAt: state.elapsed };
  try {
    // Screenshot acquisition exceeded 15s in CI after many controlled animation frames.
    // This bounds acquisition only; the stable-frame and semantic criteria are unchanged.
    const png = await page.screenshot({ timeout: 60_000 });
    timing.bytes = png.length;
    return png;
  } catch (error) {
    timing.error = String(error);
    throw error;
  } finally {
    timing.wallMilliseconds = Math.round(performance.now() - started);
    manifest.timings.push(timing);
    if (timing.wallMilliseconds >= 15_000) console.log(`Slow screenshot ${sourceLabel}/${group} ${purpose}: ${timing.wallMilliseconds}ms`);
  }
}

async function observe(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("#viewport");
    const labels = [...document.querySelectorAll(".sky-label")].map((label) => ({
      id: label.dataset.bodyId, hidden: label.hidden, transform: label.style.transform,
      rectangle: (() => { const r = label.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })(),
    }));
    return {
      url: location.pathname + location.search,
      clockText: document.querySelector("#clock")?.textContent,
      clockNow: Date.now(),
      performanceNow: performance.now(),
      pausedAtReady: globalThis.__heliosVisualPausedAtReady,
      firstApplicationTick: globalThis.__heliosVisualFirstTick,
      playing: document.querySelector("#play-button")?.getAttribute("aria-pressed"),
      busy: canvas?.getAttribute("aria-busy"),
      card: document.querySelector("#card-name")?.textContent,
      cardHidden: document.querySelector("#body-card")?.hidden,
      status: document.querySelector("#status-live")?.textContent,
      scene: document.querySelector("#scene-context")?.textContent,
      focus: document.activeElement?.id || document.activeElement?.dataset.bodyId || document.activeElement?.tagName,
      version: document.querySelector("#version-label")?.textContent,
      uiObstacles: [...document.querySelectorAll(".sky-label, #stage .topbar, #body-card, #dock, #version-label")]
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => {
          const box = element.getBoundingClientRect();
          return { id: element.id || element.dataset.bodyId || element.className, left: box.left, top: box.top, right: box.right, bottom: box.bottom };
        }),
      labels,
    };
  });
}

async function newPage(touch = false, size = touch ? [390, 844] : [1440, 900], suffix = "") {
  const context = await browser.newContext({
    viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const state = { id: nextPageId++, context, touch, elapsed: 0, inputs: [], cdp: touch ? await context.newCDPSession(page) : null, errors: [] };
  states.set(page, state);
  page.on("pageerror", (error) => state.errors.push(`page: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") state.errors.push(`console: ${message.text()}`); });
  page.on("requestfailed", (request) => state.errors.push(`request: ${request.url()} ${request.failure()?.errorText}`));
  page.on("response", (response) => { if (response.status() >= 400) state.errors.push(`HTTP ${response.status()}: ${response.url()}`); });
  await page.clock.install({ time: new Date("2026-09-05T00:00:00Z") });
  await page.addInitScript(() => {
    const requestFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => requestFrame((timestamp) => {
      // Both reviewed app revisions own one RAF loop, named tick. Preserve its callback and timestamp.
      if (callback.name === "tick" && !globalThis.__heliosVisualFirstTick) {
        const play = document.querySelector("#play-button");
        const before = play?.getAttribute("aria-pressed");
        if (before === "true") play.click();
        globalThis.__heliosVisualFirstTick = {
          callback: callback.name, timestamp, before,
          pausedBeforeCallback: play?.getAttribute("aria-pressed") === "false",
          clockText: document.querySelector("#clock")?.textContent,
        };
      }
      callback(timestamp);
    });
    const observer = new MutationObserver(() => {
      if (document.documentElement?.dataset.heliosReady !== "1") return;
      const play = document.querySelector("#play-button");
      if (play?.getAttribute("aria-pressed") === "true") play.click();
      globalThis.__heliosVisualPausedAtReady = play?.getAttribute("aria-pressed") === "false";
      observer.disconnect();
    });
    observer.observe(document, { attributes: true, attributeFilter: ["data-helios-ready"], subtree: true });
  });
  await page.goto(base + suffix, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForFunction(() => document.documentElement.dataset.heliosReady === "1");
  assert.equal(await page.evaluate(() => globalThis.__heliosVisualPausedAtReady), true, "simulation paused at initial ready signal");
  assert.equal(await page.evaluate(() => globalThis.__heliosVisualFirstTick?.pausedBeforeCallback), true, "public Pause state is verified before the first application tick");
  assert.equal(await page.locator("#play-button").getAttribute("aria-pressed"), "false");
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await advance(page, 100);
  state.initial = await observe(page);
  return page;
}

async function closePage(page) {
  const state = states.get(page);
  manifest.browserErrors.push(...state.errors.map((message) => ({ url: page.url(), message })));
  await state.context.close();
}

async function click(page, selector) {
  states.get(page).inputs.push({ at: states.get(page).elapsed, kind: "DOM click", selector });
  await page.locator(selector).evaluate((element) => element.click());
}

async function select(page, id) {
  await click(page, "#reset-button");
  await click(page, `[data-body-id="${id}"]`);
  assert.equal(await page.locator("#card-name").textContent(), findBody(id).name);
}

async function canvasPoint(page, spread = 0) {
  const point = await page.locator("#viewport").evaluate((canvas, spread) => {
    const box = canvas.getBoundingClientRect();
    for (const [fx, fy] of [[0.5, 0.38], [0.5, 0.52], [0.5, 0.28], [0.5, 0.65], [0.2, 0.6], [0.8, 0.6]]) {
      const x = box.x + box.width * fx, y = box.y + box.height * fy;
      if ([-spread, 0, spread].every((offset) => document.elementFromPoint(x + offset, y) === canvas)) return { x, y };
    }
    return null;
  }, spread);
  assert.ok(point, "unobstructed canvas input point exists");
  return point;
}

async function wheel(page, delta) {
  const point = await canvasPoint(page);
  states.get(page).inputs.push({ at: states.get(page).elapsed, kind: "mouse wheel", delta, point });
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, delta);
}

async function pinch(page, from, to) {
  const state = states.get(page);
  const center = await canvasPoint(page, Math.max(from, to) / 2);
  const points = (gap) => [-1, 1].map((sign, id) => ({ id, x: center.x + sign * gap / 2, y: center.y, radiusX: 4, radiusY: 4, force: 1 }));
  state.inputs.push({ at: state.elapsed, kind: "CDP pinch", from, to, center });
  await state.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(from) });
  await state.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(to) });
  await state.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function zoomMinimum(page) {
  if (states.get(page).touch) {
    // Two supported pinch gestures reach even main's inherited global floor.
    await pinch(page, 40, 370);
    await advance(page, 32);
    await pinch(page, 40, 370);
  } else await wheel(page, -10_000);
}

async function zoomDistance(page, from, to) {
  await wheel(page, Math.log(to / from) / Math.log(configMath.wheelZoomMultiplier(1)));
}

async function orbit(page, dx, dy = 0) {
  const state = states.get(page);
  state.inputs.push({ at: state.elapsed, kind: state.touch ? "CDP orbit" : "mouse orbit", dx, dy });
  let remainX = dx, remainY = dy;
  const { width, height } = page.viewportSize();
  for (let step = 0; step < 24 && (Math.abs(remainX) > 0.01 || Math.abs(remainY) > 0.01); step += 1) {
    const start = await canvasPoint(page);
    const endX = Math.max(20, Math.min(width - 20, start.x + remainX));
    const endY = Math.max(20, Math.min(height - 20, start.y + remainY));
    const moves = [];
    // A tiny final chunk must remain an orbit rather than trigger tap-to-pick.
    if (Math.hypot(endX - start.x, endY - start.y) < CONFIG.tapMovePx) {
      moves.push({ x: start.x + (start.x < width / 2 ? 20 : -20), y: start.y });
    }
    moves.push({ x: endX, y: endY });
    if (state.touch) {
      const point = (x, y) => [{ id: 0, x, y, radiusX: 4, radiusY: 4, force: 1 }];
      await state.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(start.x, start.y) });
      for (const move of moves) await state.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(move.x, move.y) });
      await state.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      for (const move of moves) await page.mouse.move(move.x, move.y);
      await page.mouse.up();
    }
    remainX -= endX - start.x;
    remainY -= endY - start.y;
  }
  assert.ok(Math.abs(remainX) < 0.01 && Math.abs(remainY) < 0.01, "full orbit gesture applied");
}

async function settle(page) {
  await advance(page, 1500);
  let previous = await screenshot(page, "settle-before");
  let stable = false;
  let elapsed = 1500;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await advance(page, 400);
    elapsed += 400;
    const next = await screenshot(page, `settle-after-${attempt + 1}`);
    const busy = await page.locator("#viewport").getAttribute("aria-busy");
    if (sha256(previous) === sha256(next) && busy !== "true") { stable = true; break; }
    previous = next;
  }
  return { stable, elapsed, criterion: "two byte-identical full-viewport PNGs separated by 400 controlled milliseconds; aria-busy not true (may be absent on main)" };
}

async function capture(page, name, details = {}, moving = false) {
  const started = performance.now();
  assert.ok(expected.has(name), `unexpected filename ${name}`);
  assert.ok(!manifest.captures.some((entry) => entry.name === name), `duplicate capture ${name}`);
  const settled = moving ? null : await settle(page);
  const state = states.get(page);
  const png = await screenshot(page, name);
  await writeFile(path.join(output, `${name}.png`), png);
  const entry = {
    name, file: `${name}.png`, sha256: sha256(png), bytes: png.length,
    viewport: page.viewportSize(), touchEmulation: state.touch,
    controlledElapsed: state.elapsed, initial: state.initial, observable: await observe(page),
    inputs: state.inputs.slice(), settled, moving, ...details,
  };
  entry.acquisitionWallMilliseconds = Math.round(performance.now() - started);
  manifest.captures.push(entry);
  if (settled && !settled.stable) manifest.failures.push({ name, reason: "bounded stable-frame criterion was not reached; original retained for review" });
  if (sourceLabel !== "main") {
    const expectedBusy = moving ? "true" : "false";
    if (entry.observable.busy !== expectedBusy) {
      manifest.failures.push({ name, reason: `expected aria-busy=${expectedBusy}, observed ${entry.observable.busy}; original retained for review` });
    }
    if (entry.pickMatched === false) {
      manifest.failures.push({ name, reason: `centered pick did not select ${entry.requestedPick}; original retained for review` });
    }
  }
  await flush();
  console.log(`Captured ${sourceLabel}/${group} ${manifest.captures.length}/${expected.size} ${name}${settled?.stable === false ? " (UNSETTLED)" : ""}`);
}

async function scenario(label, work) {
  try { await work(); } catch (error) {
    manifest.failures.push({ scenario: label, reason: String(error.stack || error) });
    console.error(`${label}: ${error.stack || error}`);
    await flush();
  }
}

function parentDelta(id) {
  const body = findBody(id), parent = findBody(body.parent);
  let offset = keplerOffset(body, parent, 0);
  if (moonOrbitAttachment(body) === "parent-equatorial") {
    const basis = bodyOrientationBasis(parent);
    const x = equatorialVectorToScene(basis.xAxis), y = equatorialVectorToScene(basis.yAxis), z = equatorialVectorToScene(basis.zAxis);
    offset = Object.fromEntries(["x", "y", "z"].map((axis) => [axis, offset.x * x[axis] + offset.y * z[axis] - offset.z * y[axis]]));
  }
  const separation = Math.hypot(offset.x, offset.y, offset.z);
  const azimuth = Math.atan2(-offset.x, -offset.z);
  const elevation = Math.max(-1.2, Math.min(1.2, Math.asin(-offset.y / separation)));
  const da = Math.atan2(Math.sin(azimuth - CONFIG.cameraAzimuth), Math.cos(azimuth - CONFIG.cameraAzimuth));
  return { dx: -da / 0.005, dy: (elevation - CONFIG.cameraElevation) / 0.004, azimuth, elevation };
}

async function bodySweep() {
  const page = await newPage();
  try {
    for (const body of BODIES) await scenario(`body ${body.id}`, async () => {
      const id = body.id, framed = framedDistance(id), minimum = minimumDistance(id), intermediate = Math.sqrt(framed * minimum);
      await select(page, id);
      if (!["uranus", "neptune"].includes(id)) await capture(page, `supplement-desktop-${id}-framed`, { expectedDistance: framed });
      await zoomMinimum(page);
      if (body.kind !== "moon") await capture(page, `desktop-minimum-zoom-${id}`, { expectedDistance: minimum });
      else await settle(page);
      await zoomDistance(page, minimum, intermediate);
      await capture(page, `supplement-desktop-${id}-intermediate`, { expectedDistance: intermediate });
      await zoomDistance(page, intermediate, framed);
      await capture(page, `supplement-desktop-${id}-zoom-back-out`, { expectedDistance: framed });
    });
  } finally { await closePage(page); }
}

async function primaryTouch() {
  const page = await newPage(true);
  try {
    for (const id of ["sun", "jupiter", "saturn"]) await scenario(`touch minimum ${id}`, async () => {
      await select(page, id);
      await zoomMinimum(page);
      await capture(page, `touch-portrait-minimum-zoom-${id}`, { expectedDistance: minimumDistance(id) });
    });
  } finally { await closePage(page); }
}

async function moonSweep(touch) {
  const prefix = touch ? "touch-portrait" : "desktop";
  const page = await newPage(touch);
  try {
    for (const id of touch ? touchMoons : moonIds) await scenario(`${prefix} parent ${id}`, async () => {
      await select(page, id);
      await zoomMinimum(page);
      if (id === "io") {
        await advance(page, 32);
        await capture(page, `${prefix}-moon-parent-transition-io-start`, { transitionOffset: 32 }, true);
        await advance(page, 350);
        await capture(page, `${prefix}-moon-parent-transition-io-mid`, { transitionOffset: 382 }, true);
      }
      await capture(page, `${prefix}-moon-parent-min-${id}`, { expectedDistance: minimumDistance(id) });
      const delta = parentDelta(id);
      await orbit(page, delta.dx, delta.dy);
      await capture(page, `${prefix}-moon-parent-close-${id}`, { parentAlignment: delta });
      if (touch) await pinch(page, 370, 40);
      else { await wheel(page, 800); await wheel(page, 800); }
      await capture(page, `${prefix}-moon-parent-cross-${id}`);
      await orbit(page, -delta.dx, -delta.dy);
      await capture(page, `${prefix}-moon-parent-reverse-${id}`);
      await orbit(page, delta.dx, delta.dy);
      await capture(page, `${prefix}-moon-parent-pick-target-${id}`);
      await click(page, "#card-close");
      // Match the existing raycast test: keep labels visible but let the center reach the canvas.
      await page.locator(".sky-label").evaluateAll((labels) => labels.forEach((label) => { label.style.pointerEvents = "none"; }));
      try {
        const { width, height } = page.viewportSize();
        if (touch) {
          await states.get(page).cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 0, x: width / 2, y: height / 2, radiusX: 4, radiusY: 4, force: 1 }] });
          await states.get(page).cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        } else await page.mouse.click(width / 2, height / 2);
        states.get(page).inputs.push({ at: states.get(page).elapsed, kind: touch ? "CDP centered tap" : "mouse centered click", target: id });
      } finally {
        await page.locator(".sky-label").evaluateAll((labels) => labels.forEach((label) => { label.style.pointerEvents = ""; }));
      }
      await capture(page, `${prefix}-moon-parent-picked-${id}`, {
        requestedPick: id,
        pickMatched: await page.locator("#card-name").textContent() === findBody(id).name && !await page.locator("#body-card").evaluate((element) => element.hidden),
      });
    });
  } finally { await closePage(page); }
}

async function phases(touch) {
  const prefix = touch ? "touch-portrait" : "desktop";
  const page = await newPage(touch);
  try {
    for (const id of ["uranus", "neptune"]) await scenario(`${prefix} phases ${id}`, async () => {
      const body = findBody(id), position = keplerOffset(body, findBody(body.parent), 0);
      const geometry = (distance, azimuth = CONFIG.cameraAzimuth, elevation = CONFIG.cameraElevation) => ({
        center: position, radius: radius(id), distance, azimuth, elevation,
        fieldOfViewDegrees: 52, geometryDays: 0,
        limit: "Reconstructed from source-owned data and commanded input; camera coordinates are not exposed by the app. Exclude observable.uiObstacles plus a 3px margin for surface metrics.",
      });
      await select(page, id);
      await capture(page, `${prefix}-night-side-framed-${id}`, { expectedDistance: framedDistance(id), surfaceGeometry: geometry(framedDistance(id)) });
      await zoomMinimum(page);
      await capture(page, `${prefix}-night-side-minimum-${id}`, { expectedDistance: minimumDistance(id), surfaceGeometry: geometry(minimumDistance(id)) });
      const sunAzimuth = Math.atan2(-position.x, -position.z);
      const sunElevation = Math.asin(-position.y / Math.hypot(position.x, position.y, position.z));
      for (const [seat, azimuth, elevation] of [["half-lit", sunAzimuth + Math.PI / 2, 0], ["sunward", sunAzimuth, sunElevation]]) {
        await select(page, id);
        await settle(page);
        const delta = Math.atan2(Math.sin(azimuth - CONFIG.cameraAzimuth), Math.cos(azimuth - CONFIG.cameraAzimuth));
        await orbit(page, -delta / 0.005, (elevation - CONFIG.cameraElevation) / 0.004);
        await capture(page, `${prefix}-night-side-${seat}-${id}`, { expectedDistance: framedDistance(id), surfaceGeometry: geometry(framedDistance(id), azimuth, elevation) });
      }
    });
  } finally { await closePage(page); }
}

async function lifecycle(touch) {
  const prefix = touch ? "touch-portrait" : "desktop";
  const page = await newPage(touch);
  try {
    for (const action of ["reset", "escape", "planet-interruption", "repeated-focus", "zoom-reversal"]) await scenario(`${prefix} lifecycle ${action}`, async () => {
      await click(page, "#reset-button");
      await settle(page);
      await click(page, '[data-body-id="io"]');
      await advance(page, 32);
      await capture(page, `supplement-${prefix}-busy-${action}-active`, { beforeInterruption: action, transitionOffset: 32 }, true);
      if (action === "reset") await click(page, "#reset-button");
      else if (action === "escape") {
        await page.locator("#viewport").evaluate((canvas) => canvas.focus());
        await page.keyboard.press("Escape");
      } else if (action === "planet-interruption") await click(page, '[data-body-id="earth"]');
      else if (action === "repeated-focus") {
        for (const id of ["io", "triton", "triton", "io"]) await click(page, `[data-body-id="${id}"]`);
      } else {
        for (const delta of [-10_000, 800, -800]) await wheel(page, delta);
      }
      await capture(page, `supplement-${prefix}-busy-${action}-settled`, { afterInterruption: action });
    });
  } finally { await closePage(page); }
}

async function ringsAndSky() {
  const page = await newPage();
  try {
    await select(page, "saturn");
    await capture(page, "desktop-saturn-rings-front");
    await orbit(page, 1440 * 0.44);
    await capture(page, "desktop-saturn-rings-back", { inheritedRingOwner: "issue #44", referenceDragPixels: 1440 * 0.44 });
  } finally { await closePage(page); }
  for (const action of ["button", "escape"]) {
    const sky = await newPage(false, [1440, 900], "?look=sky");
    try {
      await click(sky, '[data-body-id="earth"]');
      await settle(sky);
      if (action === "button") await click(sky, "#reset-button");
      else { await sky.locator("#viewport").evaluate((canvas) => canvas.focus()); await sky.keyboard.press("Escape"); }
      await capture(sky, `desktop-sky-${action}`, { requestedLook: "sky", action });
    } finally { await closePage(sky); }
  }
}

async function responsive() {
  for (const size of responsiveSizes) await scenario(`responsive ${size.join("x")}`, async () => {
    const page = await newPage(true, size);
    try {
      await select(page, "earth");
      await page.locator("#helper-orbit").evaluate((element) => element.focus());
      await page.keyboard.press("Tab");
      states.get(page).inputs.push({ at: states.get(page).elapsed, kind: "keyboard Tab", from: "helper-orbit" });
      assert.equal(await page.evaluate(() => document.activeElement?.id), "helper-axis");
      await capture(page, `supplement-responsive-${size.join("x")}`, { state: "Earth card open, axis helper keyboard focus", physicalDevice: false });
    } finally { await closePage(page); }
  });
}

try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("source server did not start")), 15_000);
    server.once("error", reject);
    server.once("exit", (code) => reject(new Error(`source server exited ${code}`)));
    server.stdout.on("data", (chunk) => { if (String(chunk).includes("Helios local server:")) { clearTimeout(timeout); resolve(); } });
    server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  });
  browser = await chromium.launch({ headless: true, executablePath: process.env.HELIOS_CHROMIUM_PATH || undefined,
    args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  manifest.browser = browser.version();
  if (["all", "bodies"].includes(group)) await scenario("desktop body sweep", bodySweep);
  if (["all", "other"].includes(group)) await scenario("touch primary minimum", primaryTouch);
  for (const touch of [false, true]) {
    if (["all", touch ? "touch-moons" : "desktop-moons"].includes(group)) await scenario(`moon sweep touch=${touch}`, () => moonSweep(touch));
    if (["all", "other"].includes(group)) {
      await scenario(`phases touch=${touch}`, () => phases(touch));
      await scenario(`lifecycle touch=${touch}`, () => lifecycle(touch));
    }
  }
  if (["all", "other"].includes(group)) {
    await scenario("Saturn and Earth sky", ringsAndSky);
    await responsive();
  }
} catch (error) {
  manifest.failures.push({ scenario: "capture infrastructure", reason: String(error.stack || error) });
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
  manifest.missing = [...expected].filter((name) => !manifest.captures.some((entry) => entry.name === name));
  manifest.sourceCleanAfter = git(sourceRoot, "status", "--porcelain", "--untracked-files=all") === "";
  manifest.sourceCommitAfter = git(sourceRoot, "rev-parse", "HEAD");
  manifest.sourceTreeAfter = git(sourceRoot, "rev-parse", "HEAD^{tree}");
  manifest.harnessCleanAfter = git(harnessRoot, "status", "--porcelain", "--untracked-files=all") === "";
  await flush();
}
assert.equal(manifest.sourceCleanAfter, true, "renderer source remains clean");
assert.equal(manifest.harnessCleanAfter, true, "capture harness remains clean");
assert.equal(manifest.sourceCommitAfter, sourceIdentity.commit);
assert.equal(manifest.sourceTreeAfter, sourceIdentity.tree);
assert.deepEqual(manifest.browserErrors, [], "no browser, console, request or HTTP errors");
assert.deepEqual(manifest.failures, [], "every capture scenario reaches its stated bounded criterion");
assert.deepEqual(manifest.missing, [], `all ${expected.size} requested ${group} captures exist`);
console.log(`Visual capture complete: ${sourceLabel}/${group}, ${manifest.captures.length}/${expected.size} originals; ${sourceIdentity.commit} ${sourceIdentity.tree}`);
