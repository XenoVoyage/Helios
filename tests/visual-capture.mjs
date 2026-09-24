// Supplemental comparison evidence. This deliberately does not replace npm test.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { delayNextClockPause } from "./clock-pause-regression.mjs";
import { focusTrackingOffsets, focusTrackingScenarios, runFocusTracking } from "./focus-tracking.mjs";

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
assert.ok(["all", "bodies", "desktop-moons", "touch-moons", "other", "ordinary", "focus"].includes(group), "group must be all, bodies, desktop-moons, touch-moons, other, ordinary or focus");
const sourceRoot = path.resolve(options.get("--source-root"));
const output = options.has("--output") ? path.resolve(options.get("--output")) : null;
const sourceLabel = options.get("--source-label");
assert.ok(["main", "develop", "candidate", "historical"].includes(sourceLabel));
assert.ok(output === null || (output !== sourceRoot && !output.startsWith(sourceRoot + path.sep)), "evidence must be outside the immutable source checkout");
const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const harnessClean = git(harnessRoot, "status", "--porcelain", "--untracked-files=all") === "";
const trackingHarnessBytes = await readFile(new URL("./focus-tracking.mjs", import.meta.url));
const trackingHarness = { file: "tests/focus-tracking.mjs", sha256: sha256(trackingHarnessBytes), bytes: trackingHarnessBytes.length };
if (!inventoryOnly) assert.equal(harnessClean, true, "capture harness starts clean");
assert.equal(git(sourceRoot, "status", "--porcelain", "--untracked-files=all"), "", "renderer source starts clean");
const sourceIdentity = {
  label: sourceLabel,
  commit: git(sourceRoot, "rev-parse", "HEAD"),
  tree: git(sourceRoot, "rev-parse", "HEAD^{tree}"),
};
if (sourceLabel === "historical") {
  assert.equal(group, "focus", "historical evidence is limited to focus tracking");
  assert.equal(sourceIdentity.commit, "c1f76d63c06853f8012569d2c19df6f499788a3c", "exact issue #59 historical commit");
  assert.equal(sourceIdentity.tree, "08d8889e3a6b766ebcb55a009b027c5adc21cc03", "exact issue #59 historical tree");
}
const bodyMath = await import(pathToFileURL(path.join(sourceRoot, "js/bodies.js")));
const configMath = await import(pathToFileURL(path.join(sourceRoot, "js/config.js")));
const { equatorialVectorToScene } = await import(pathToFileURL(path.join(sourceRoot, "js/sky.js")));
const { BODIES, findBody, visualBodyRadius, keplerOffset, moonOrbitAttachment, bodyOrientationBasis } = bodyMath;
const { CONFIG } = configMath;
const sourceSpeedFromSlider = configMath.speedFromSlider || ((unit) =>
  Math.exp(Math.log(CONFIG.minDaysPerSecond) + (Math.log(CONFIG.maxDaysPerSecond) - Math.log(CONFIG.minDaysPerSecond)) * unit));
const sourceTimeRates = {
  minimumDaysPerSecond: CONFIG.minDaysPerSecond,
  defaultDaysPerSecond: CONFIG.defaultDaysPerSecond,
  maximumDaysPerSecond: CONFIG.maxDaysPerSecond,
  sliderConversion: configMath.speedFromSlider ? "source-exported speedFromSlider" : "source's existing logarithmic slider mapping",
  quantization: "Native range-input step is retained. A fresh startup default is observed before any slider input; its internal rate is not reconstructed from the rounded thumb position.",
};
const primaryIds = BODIES.filter((body) => body.kind !== "moon").map((body) => body.id);
const moonIds = BODIES.filter((body) => body.kind === "moon").map((body) => body.id);
assert.equal(BODIES.length, 20);
assert.equal(moonIds.length, 9);
const touchMoons = ["moon", "phobos", "io", "triton"];
const radius = (id) => visualBodyRadius(findBody(id));
const framedDistance = (id) => Math.max(radius(id) * 7.5, 5.5);
// Preserve the source's supported minimum, including older historical fallbacks.
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
for (const seat of ["a", "b"]) expect(`supplement-triton-rotation-${seat}`);
for (const scene of ["overview-reset", "milkyway"]) expect(`supplement-${scene}-settled`);
for (const body of BODIES) {
  for (const seat of ["framed", "intermediate", "zoom-back-out"]) {
    if (["uranus", "neptune"].includes(body.id) && seat === "framed") continue;
    expect(`supplement-desktop-${body.id}-${seat}`);
  }
}
const responsiveSizes = [
  [320, 568], [568, 320], [390, 844], [700, 500], [718, 500],
  [719, 500], [720, 500], [721, 500],
  [840, 500], [841, 500], [844, 390], [768, 1024], [1024, 768],
  [720, 900], [721, 900], [720, 720], [721, 721], [720, 501],
  [721, 501], [1440, 900],
];
for (const [width, height] of responsiveSizes) {
  expect(`supplement-responsive-${width}x${height}`);
  expect(`supplement-responsive-closed-${width}x${height}`);
}
assert.equal(expected.size, 238);
const timeRateViewports = [
  { id: "desktop", size: [1440, 900], touch: false },
  { id: "touch-portrait", size: [390, 844], touch: true },
  { id: "touch-landscape", size: [568, 320], touch: true },
];
for (const { id } of timeRateViewports) {
  for (const rate of ["default", "minimum", "maximum"]) {
    expect(`supplement-time-rate-${id}-${rate}`);
    expect(`supplement-time-rate-${id}-${rate}-dock`);
  }
}
assert.equal(expected.size, 256);
const trackingNames = new Map();
for (const scenario of focusTrackingScenarios) {
  for (const offset of focusTrackingOffsets) {
    const name = `focus-tracking-${scenario.id}-${offset}ms`;
    expect(name);
    trackingNames.set(name, scenario);
  }
}
assert.equal(expected.size, 286);
const ordinaryDirectLooks = [
  "sky", "solarfar", "tailsky", "growing", "disk", "milkyway", "mwedge",
  "mwbelow", "neighborhood", "localgroup", "virgo", "preweb", "web", "universe",
];
const ordinaryVirgoFractions = [0.15, 0.35, 0.55, 0.75, 0.92];
const ordinaryUniverseFractions = [0.15, 0.35, 0.55, 0.68, 0.7, 0.72, 0.74, 0.76, 0.78, 0.8, 0.82, 0.85, 0.9, 0.95, 1.01];
const ordinaryPercent = (fraction) => String(Math.round(fraction * 100)).padStart(2, "0");
const ordinaryNames = [
  ...["major-initial", "off", "all", "major-restored"].map((mode) => `desktop-constellations-${mode}`),
  "desktop-overview",
  ...ordinaryDirectLooks.map((look) => `desktop-${look}`),
  ...["start", "mid", "end"].map((seat) => `desktop-solar-handoff-${seat}`),
  ...ordinaryVirgoFractions.map((fraction) => `desktop-transition-virgo-web-${ordinaryPercent(fraction)}`),
  ...ordinaryUniverseFractions.map((fraction) => `desktop-transition-web-universe-${ordinaryPercent(fraction)}`),
  ...["forward", "yaw-quarter", "yaw-180", "pitch-high", "pitch-low", "diagonal"].map((seat) => `desktop-far-sky-${seat}`),
  "earth-june-solstice", "earth-december-solstice", "touch-card", "touch-landscape-card",
  ...["portrait", "landscape"].flatMap((aspect) => ["localgroup", "virgo", "web", "universe"].map((look) => `touch-${aspect}-${look}`)),
  "triton-rotation-a", "triton-rotation-b", "webgl-fallback",
];
assert.equal(ordinaryNames.length, 63);
assert.equal(new Set(ordinaryNames).size, 63);
const ordinaryNameSet = new Set(ordinaryNames);

for (const name of ordinaryNames) expect(name);
assert.equal(expected.size, 349);
const completeMatrix = [...expected];
const groupFor = (name) => {
  if (ordinaryNameSet.has(name)) return "ordinary";
  const tracking = trackingNames.get(name);
  if (tracking) return tracking.touch ? "other" : tracking.bodyId === "io" ? "desktop-moons" : "bodies";
  if (name.includes("-moon-parent-")) return name.startsWith("desktop-") ? "desktop-moons" : "touch-moons";
  if (name.startsWith("desktop-minimum-zoom-") || (name.startsWith("supplement-desktop-") && !name.includes("-busy-"))) return "bodies";
  return "other";
};
for (const name of expected) {
  if (group === "focus" ? !trackingNames.has(name) : group !== "all" && groupFor(name) !== group) expected.delete(name);
}
assert.equal(expected.size, { all: 349, bodies: 84, "desktop-moons": 61, "touch-moons": 26, other: 115, ordinary: 63, focus: 30 }[group]);
const activeTrackingScenarios = focusTrackingScenarios.filter((item) =>
  expected.has(`focus-tracking-${item.id}-${focusTrackingOffsets[0]}ms`));

if (inventoryOnly) {
  const inventory = JSON.stringify({
    mode: "inventory only; no browser launched, no screenshots captured, no visual pass asserted",
    group,
    completeMatrixCount: completeMatrix.length,
    fullExpected: completeMatrix,
    source: sourceIdentity,
    harness: { commit: git(harnessRoot, "rev-parse", "HEAD"), tree: git(harnessRoot, "rev-parse", "HEAD^{tree}"), clean: harnessClean, sha256: sha256(await readFile(fileURLToPath(import.meta.url))), focusTracking: trackingHarness },
    expected: [...expected].map((name) => {
      const compact = name.match(/responsive-(?:closed-)?(\d+)x(\d+)$/);
      const timeRateViewport = timeRateViewports.find(({ id }) => name.startsWith(`supplement-time-rate-${id}-`));
      return {
        name,
        viewport: name === "webgl-fallback" ? [1024, 768] : name === "touch-card" ? [390, 844] : name === "touch-landscape-card" ? [568, 320] : name.startsWith("touch-landscape-") ? [844, 390] : timeRateViewport?.size || (compact ? [Number(compact[1]), Number(compact[2])] : (name.includes("touch-portrait") || trackingNames.get(name)?.touch) ? [390, 844] : [1440, 900]),
        ...(/^triton-rotation-[ab]$/.test(name) ? { crop: "360px Triton crop; exact rectangle recorded at capture" } : {}),
        ...(timeRateViewport && name.endsWith("-dock") ? { crop: "outward-rounded visible dock bounds; exact rectangle recorded at capture" } : {}),
        scenario: name.replace(/^supplement-/, "").replaceAll("-", " "),
      };
    }),
    sourceTimeRates,
    sourceDistances: BODIES.map(({ id }) => ({ id, framed: framedDistance(id), minimum: minimumDistance(id) })),
  }, null, 2) + "\n";
  await new Promise((resolve, reject) => process.stdout.write(inventory, (error) => error ? reject(error) : resolve()));
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
    focusTracking: trackingHarness,
  },
  node: process.version,
  playwright: JSON.parse(await readFile(path.join(harnessRoot, "node_modules/playwright/package.json"), "utf8")).version,
  rendering: "Headless Chromium; ANGLE SwiftShader; deviceScaleFactor 1; screenshots are full viewport originals except the explicitly named time-rate dock and ordinary Triton crops, whose source view and exact clip are recorded; observed renderer and font metadata are retained per capture",
  clockPolicy: "Playwright clock installed before navigation. A ready observer uses the public playback toggle; a thin requestAnimationFrame wrapper additionally verifies and, if necessary, pauses through that control immediately before the first application tick callback. The first-tick record is asserted on every supported WebGL page; intentional fallback records its separate failure contract. The wrapper preserves timestamps and callback execution. After loading, browser time is paused and advanced with runFor. No simulation-time or camera-state hook is injected. Matching labels alone do not prove matching camera/time.",
  limits: [
    "Touch is emulated with CDP, not physical hardware.",
    "Body selection buttons use DOM click, while camera/pick gestures use browser mouse or CDP touch input.",
    "Minimum zoom follows each source's minimumFocusDistance export when available, otherwise its global floor.",
    "Ordinary captures require the expected aria-busy value on main, develop, and candidate; absence is recorded, never converted to false.",
    "Minimum rates and native-step intermediate rates differ across source revisions. Rates are source-owned; matched moving captures do not imply equal simulation times or poses.",
    "Screenshots do not certify physical screen-reader behavior or universal scientific correctness.",
  ],
  expected: [...expected],
  captures: [],
  sourceTimeRates,
  timeRateObservations: [],
  focusTrackingExpectedReports: activeTrackingScenarios.map((item) => item.id),
  focusTrackingReports: [],
  focusTrackingDiagnostics: [],
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

async function screenshot(page, purpose, clip = null) {
  const state = states.get(page);
  const started = performance.now();
  const timing = { page: state.id, operation: "page.screenshot", purpose, controlledAt: state.elapsed };
  try {
    // Screenshot acquisition exceeded 15s in CI after many controlled animation frames.
    // This bounds acquisition only; the stable-frame and semantic criteria are unchanged.
    const png = await page.screenshot({ timeout: 60_000, ...(clip ? { clip } : {}) });
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
    const gl = canvas?.getContext("webgl2");
    const debug = gl?.getExtension("WEBGL_debug_renderer_info");
    const labelStyle = getComputedStyle(document.querySelector(".sky-label") || document.body);
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
      renderer: gl ? {
        vendor: gl.getParameter(gl.VENDOR), renderer: gl.getParameter(gl.RENDERER),
        unmaskedVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
        unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
        drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        devicePixelRatio,
      } : null,
      fonts: { status: document.fonts.status, labelFamily: labelStyle.fontFamily,
        labelSize: labelStyle.fontSize, labelWeight: labelStyle.fontWeight },
      timeSpeed: {
        sliderValue: Number(document.querySelector("#speed-slider")?.value),
        sliderStep: document.querySelector("#speed-slider")?.step,
        readout: document.querySelector("#speed-readout")?.textContent,
        accessibleValue: document.querySelector("#speed-slider")?.getAttribute("aria-valuetext"),
      },
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
  if (state.id === 1) delayNextClockPause(page);
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
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => globalThis.__heliosVisualPausedAtReady), true, "simulation paused at initial ready signal");
  assert.equal(await page.evaluate(() => globalThis.__heliosVisualFirstTick?.pausedBeforeCallback), true, "public Pause state is verified before the first application tick");
  assert.equal(await page.locator("#play-button").getAttribute("aria-pressed"), "false");
  await page.clock.pauseAt(new Date("2026-09-05T01:00:00Z"));
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
    // Two supported pinch gestures reach the source's supported focus minimum.
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
  return { stable, elapsed, criterion: "two byte-identical full-viewport PNGs separated by 400 controlled milliseconds; aria-busy not true, with its exact expected value checked at capture" };
}

async function capture(page, name, details = {}, moving = false) {
  const started = performance.now();
  assert.ok(expected.has(name), `unexpected filename ${name}`);
  assert.ok(!manifest.captures.some((entry) => entry.name === name), `duplicate capture ${name}`);
  const settled = moving ? null : await settle(page);
  const state = states.get(page);
  const png = await screenshot(page, name, details.clip || null);
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
  const expectedBusy = moving ? "true" : "false";
  if (entry.observable.busy !== expectedBusy) {
    manifest.failures.push({ name, reason: `expected aria-busy=${expectedBusy}, observed ${entry.observable.busy}; original retained for review` });
  }
  if (sourceLabel !== "main" && entry.pickMatched === false) {
    manifest.failures.push({ name, reason: `centered pick did not select ${entry.requestedPick}; original retained for review` });
  }
  await flush();
  console.log(`Captured ${sourceLabel}/${group} ${manifest.captures.length}/${expected.size} ${name}${settled?.stable === false ? " (UNSETTLED)" : ""}`);
  return entry;
}

async function captureFocusTracking() {
  for (const trackingScenario of activeTrackingScenarios) await scenario(`focus tracking ${trackingScenario.id}`, async () => {
    const reportFile = `focus-tracking-${trackingScenario.id}.json`;
    await runFocusTracking(browser, base, {
      scenarios: [trackingScenario], assertTracking: false, lifecycle: false,
      onStill: async ({ name, page, scenario: current, offset, report }) => {
        assert.equal(current.id, trackingScenario.id);
        assert.ok(expected.has(name), `unexpected tracking filename ${name}`);
        assert.ok(!manifest.captures.some((entry) => entry.name === name), `duplicate capture ${name}`);
        assert.equal(name, `focus-tracking-${current.id}-${offset}ms`);
        const started = performance.now();
        // Preserve the playing frame: neither stable-frame waits nor recentering belongs here.
        const png = await page.screenshot({ timeout: 60_000 });
        assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "tracking original is a PNG");
        assert.deepEqual({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }, page.viewportSize(), "tracking PNG retains the full viewport at deviceScaleFactor 1");
        await writeFile(path.join(output, `${name}.png`), png);
        manifest.captures.push({
          name, file: `${name}.png`, sha256: sha256(png), bytes: png.length,
          viewport: page.viewportSize(), touchEmulation: current.touch,
          initial: report.initial,
          observable: {
            ...await observe(page), pausedAtReady: report.initial.pausedAtReady,
            firstApplicationTick: report.initial.firstApplicationTick,
          },
          inputs: report.inputs,
          settled: null, moving: offset > 0,
          tracking: {
            scenario: current, requestedOffsetMilliseconds: offset, reportFile,
            requestedRate: report.requestedRate, effectiveRate: report.effectiveRate,
            sliderValue: report.sliderValue, anchor: report.anchor,
            observerFrameCount: report.frames.length, observerFrame: report.frames.at(-1) ?? null,
            capturePolicy: "direct full-viewport screenshot at the sequence offset; no stable-frame wait or recentering",
          },
          acquisitionWallMilliseconds: Math.round(performance.now() - started),
        });
        await flush();
        console.log(`Captured ${sourceLabel}/${group} ${manifest.captures.length}/${expected.size} ${name}`);
      },
      onReport: async (report) => {
        assert.equal(report.scenario.id, trackingScenario.id);
        assert.ok(!manifest.focusTrackingReports.some((entry) => entry.scenario === trackingScenario.id), `duplicate tracking report ${trackingScenario.id}`);
        const bytes = Buffer.from(JSON.stringify(report, null, 2) + "\n");
        await writeFile(path.join(output, reportFile), bytes);
        manifest.focusTrackingReports.push({
          scenario: trackingScenario.id, file: reportFile, sha256: sha256(bytes), bytes: bytes.length,
          frames: report.frames.length, completed: report.completed,
          diagnosticFailures: report.failures.length, infrastructureError: report.infrastructureError,
        });
        manifest.browserErrors.push(...report.browserErrors.map((message) => ({ scenario: trackingScenario.id, message })));
        // Old references retain their measured defect; npm's actual regression asserts tracking.
        manifest.focusTrackingDiagnostics.push(...report.failures.map((failure) => ({ scenario: trackingScenario.id, ...failure })));
        if (report.infrastructureError) manifest.failures.push({ scenario: trackingScenario.id, reason: report.infrastructureError });
        if (!report.completed) manifest.failures.push({ scenario: trackingScenario.id, reason: "tracking scenario did not complete; available dense report retained" });
        await flush();
      },
    });
  });
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

async function controlledLegacyViews() {
  const page = await newPage();
  try {
    await select(page, "triton");
    await advance(page, 1500);
    await click(page, "#card-close");
    const referenceDragPixels = page.viewportSize().width * 0.44;
    await orbit(page, referenceDragPixels);
    await wheel(page, -1200);
    const framing = { referenceDragPixels, referenceWheelDelta: -1200, initialSimulation: "J2000; paused before the first application tick" };
    await capture(page, "supplement-triton-rotation-a", framing);
    // Match the regular Triton still's public slider input, recording any
    // range-input step rounding instead of asserting an exact half rotation.
    const speed = await page.locator("#speed-slider").evaluate((slider, { minimum, maximum, target }) => {
      slider.value = String((Math.log(target) - Math.log(minimum)) / (Math.log(maximum) - Math.log(minimum)));
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      return {
        requestedDaysPerSecond: target,
        sliderValue: Number(slider.value),
        effectiveDaysPerSecond: Math.exp(Math.log(minimum) + (Math.log(maximum) - Math.log(minimum)) * Number(slider.value)),
        accessibleValue: slider.getAttribute("aria-valuetext"),
      };
    }, { minimum: CONFIG.minDaysPerSecond, maximum: CONFIG.maxDaysPerSecond, target: 5.876994 });
    states.get(page).inputs.push({ at: states.get(page).elapsed, kind: "public speed slider input", ...speed });
    // Start after an application frame so different page-load durations cannot
    // add or remove one playing frame from the paired 500ms interval.
    await page.evaluate(() => {
      globalThis.__heliosVisualTimedPlayback = { scheduledAt: performance.now() };
      requestAnimationFrame(() => {
        const play = document.querySelector("#play-button");
        play.click();
        Object.assign(globalThis.__heliosVisualTimedPlayback, { startedAt: performance.now(), startedPlaying: play.getAttribute("aria-pressed") });
        setTimeout(() => {
          play.click();
          Object.assign(globalThis.__heliosVisualTimedPlayback, { endedAt: performance.now(), endedPlaying: play.getAttribute("aria-pressed") });
        }, 500);
      });
    });
    await advance(page, 516);
    const playback = await page.evaluate(() => globalThis.__heliosVisualTimedPlayback);
    assert.equal(playback.startedPlaying, "true");
    assert.equal(playback.endedPlaying, "false");
    assert.equal(playback.endedAt - playback.startedAt, 500, "Triton runs for exactly 500 controlled browser milliseconds");
    states.get(page).inputs.push({ at: states.get(page).elapsed - 516, kind: "frame-aligned public Play/Pause clicks", ...playback });
    await capture(page, "supplement-triton-rotation-b", { ...framing, speed, playback, controlledPlayingMilliseconds: 500 });
  } finally { await closePage(page); }
  for (const look of ["overview-reset", "milkyway"]) {
    const scene = await newPage(false, [1440, 900], look === "milkyway" ? "?look=milkyway" : "");
    try {
      if (look === "overview-reset") {
        await select(scene, "earth");
        await settle(scene);
        await click(scene, "#reset-button");
      } else {
        assert.equal(await scene.getAttribute("html", "data-galaxy-ready"), "1");
      }
      await capture(scene, `supplement-${look}-settled`, { requestedLook: look, initialSimulation: "J2000; paused before the first application tick" });
    } finally { await closePage(scene); }
  }
}

async function responsive() {
  for (const size of responsiveSizes) await scenario(`responsive ${size.join("x")}`, async () => {
    const page = await newPage(true, size);
    try {
      await capture(page, `supplement-responsive-closed-${size.join("x")}`, { state: "Reset overview, card closed", physicalDevice: false });
      await select(page, "earth");
      await page.locator("#helper-orbit").evaluate((element) => element.focus());
      await page.keyboard.press("Tab");
      states.get(page).inputs.push({ at: states.get(page).elapsed, kind: "keyboard Tab", from: "helper-orbit" });
      assert.equal(await page.evaluate(() => document.activeElement?.id), "helper-axis");
      await capture(page, `supplement-responsive-${size.join("x")}`, { state: "Earth card open, axis helper keyboard focus", physicalDevice: false });
    } finally { await closePage(page); }
  });
}

async function timeRates() {
  for (const { id, size, touch } of timeRateViewports) await scenario(`time rates ${id}`, async () => {
    const page = await newPage(touch, size);
    try {
      // The fresh default is exact even when its displayed thumb is step-rounded.
      // Replaying that thumb would change the rate, so capture the default first.
      for (const [rate, requestedUnit] of [["default", null], ["minimum", 0], ["maximum", 1], ["intermediate-quarter", 0.25], ["intermediate-three-quarters", 0.75]]) {
        if (requestedUnit !== null) {
          const sliderValue = await page.locator("#speed-slider").evaluate((slider, unit) => {
            slider.value = String(unit);
            slider.dispatchEvent(new Event("input", { bubbles: true }));
            return Number(slider.value);
          }, requestedUnit);
          states.get(page).inputs.push({ at: states.get(page).elapsed, kind: "public speed slider input", requestedUnit, sliderValue });
          await advance(page, 32);
        }
        const observable = await observe(page);
        const effectiveDaysPerSecond = rate === "default" ? CONFIG.defaultDaysPerSecond : sourceSpeedFromSlider(observable.timeSpeed.sliderValue);
        assert.equal(observable.playing, "false", "time-rate comparison remains paused");
        assert.equal(observable.clockText, "2000-01-01", "time-rate comparison preserves J2000");
        assert.equal(observable.cardHidden, true, "time-rate comparison retains the reset overview");
        assert.equal(observable.timeSpeed.readout, `${configMath.formatDaysPerSecond(effectiveDaysPerSecond)} / sec`, "rate readout uses this source's effective rate");
        assert.equal(observable.timeSpeed.accessibleValue, configMath.describeDaysPerSecond(effectiveDaysPerSecond), "accessible rate uses this source's effective rate");
        const observation = {
          viewport: { id, width: size[0], height: size[1], touchEmulation: touch }, rate, requestedUnit,
          effectiveDaysPerSecond,
          effectiveRateBasis: rate === "default" ? "source CONFIG default before any slider input" : "source conversion of the actual native-step slider value",
          ...observable.timeSpeed, controlledElapsed: states.get(page).elapsed,
          clockText: observable.clockText, playing: observable.playing,
        };
        manifest.timeRateObservations.push(observation);
        if (rate.startsWith("intermediate-")) { await flush(); continue; }
        const name = `supplement-time-rate-${id}-${rate}`;
        const full = await capture(page, name, { timeRate: observation, initialSimulation: "J2000; paused before the first application tick" });
        const started = performance.now();
        const clip = await page.locator("#dock").evaluate((dock) => {
          const box = dock.getBoundingClientRect();
          const x = Math.max(0, Math.floor(box.x)), y = Math.max(0, Math.floor(box.y));
          return { x, y, width: Math.min(innerWidth, Math.ceil(box.right)) - x, height: Math.min(innerHeight, Math.ceil(box.bottom)) - y };
        });
        assert.ok(clip.width > 0 && clip.height > 0, "visible dock has a nonempty crop");
        const cropName = `${name}-dock`;
        assert.ok(expected.has(cropName) && !manifest.captures.some((entry) => entry.name === cropName), "expected dock crop is captured once");
        const png = await screenshot(page, cropName, clip);
        assert.deepEqual({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }, { width: clip.width, height: clip.height }, "dock crop retains native pixels without resizing");
        await writeFile(path.join(output, `${cropName}.png`), png);
        manifest.captures.push({
          ...full, name: cropName, file: `${cropName}.png`, sha256: sha256(png), bytes: png.length,
          crop: { sourceFullView: full.file, clip, criterion: "same settled paused frame; outward-rounded visible dock bounds, no resize" },
          observable: await observe(page), acquisitionWallMilliseconds: Math.round(performance.now() - started),
        });
        await flush();
        console.log(`Captured ${sourceLabel}/${group} ${manifest.captures.length}/${expected.size} ${cropName}`);
      }
    } finally { await closePage(page); }
  });
}

async function ordinaryContext(page, look) {
  const expected = {
    sky: /Earth sky/, solarfar: /Solar system/, tailsky: /Milky Way/,
    growing: /Milky Way/, disk: /Milky Way/, milkyway: /Milky Way/,
    mwedge: /Milky Way/, mwbelow: /Milky Way/, neighborhood: /Nearby galaxies/,
    localgroup: /Local Group/, virgo: /Virgo Cluster/, preweb: /Laniakea Supercluster/,
    web: /2MRS galaxy distribution/, universe: /Schematic observable universe/,
  }[look];
  assert.match(await page.locator("#scene-context").textContent(), expected, `${look}: source scene context`);
  assert.equal(await page.locator("#viewport").getAttribute("aria-label"), "Helios scene");
  if (look === "sky") assert.equal(await page.locator("#card-name").textContent(), "Earth");
  else if (look === "solarfar") assert.equal(await page.getAttribute("html", "data-galaxy-ready"), null);
  else assert.equal(await page.getAttribute("html", "data-galaxy-ready"), "1");
}

async function ordinaryOverviewAndConstellations() {
  const page = await newPage();
  try {
    for (const [mode, seat] of [["major", "major-initial"], ["off", "off"], ["all", "all"], ["major", "major-restored"]]) {
      await page.locator("#sky-mode").selectOption(mode);
      states.get(page).inputs.push({ at: states.get(page).elapsed, kind: "public constellation select", mode });
      await capture(page, `desktop-constellations-${seat}`, { initialSimulation: "J2000; paused before first application tick" });
    }
    await click(page, "#reset-button");
    await capture(page, "desktop-overview", { initialSimulation: "J2000; settled reset overview" });
  } finally { await closePage(page); }
}

async function ordinaryDirectViews() {
  for (const look of ordinaryDirectLooks) await scenario(`ordinary direct ${look}`, async () => {
    const page = await newPage(false, [1440, 900], `?look=${look}`);
    try {
      await ordinaryContext(page, look);
      await capture(page, `desktop-${look}`, { requestedLook: look, initialSimulation: "J2000; paused before first application tick" });
    } finally { await closePage(page); }
  });
}

async function ordinaryHandoff() {
  const page = await newPage();
  try {
    const blendStart = CONFIG.solarMaxDistance + (CONFIG.handoffViewDistance - CONFIG.solarMaxDistance) * 0.7;
    let distance = CONFIG.cameraDistance;
    for (const [seat, target] of [
      ["start", blendStart],
      ["mid", blendStart + (CONFIG.handoffViewDistance - blendStart) * 0.5],
      ["end", CONFIG.handoffViewDistance - 10],
    ]) {
      await zoomDistance(page, distance, target);
      distance = target;
      await capture(page, `desktop-solar-handoff-${seat}`, {
        expectedDistance: target, acquisition: "settled controlled comparison; transient Loading is separately tested by browser-smoke",
      });
      assert.equal(await page.getAttribute("html", "data-galaxy-ready"), "1");
    }
  } finally { await closePage(page); }
}

async function ordinaryTransitions() {
  const page = await newPage(false, [1440, 900], "?look=virgo");
  try {
    await ordinaryContext(page, "virgo");
    let distance = CONFIG.virgoViewDistance;
    const stops = [
      ...ordinaryVirgoFractions.map((fraction) => ({ name: `desktop-transition-virgo-web-${ordinaryPercent(fraction)}`, distance: CONFIG.virgoViewDistance + (CONFIG.webViewDistance - CONFIG.virgoViewDistance) * fraction })),
      ...ordinaryUniverseFractions.map((fraction) => ({ name: `desktop-transition-web-universe-${ordinaryPercent(fraction)}`, distance: CONFIG.webViewDistance + (CONFIG.universeViewDistance - CONFIG.webViewDistance) * fraction })),
    ];
    for (const stop of stops) {
      await zoomDistance(page, distance, stop.distance);
      distance = stop.distance;
      await capture(page, stop.name, { expectedDistance: distance, initialSimulation: "J2000; paused before first application tick" });
    }
  } finally { await closePage(page); }
}

async function ordinaryFarSky() {
  const page = await newPage(false, [1440, 900], "?look=virgo");
  try {
    await ordinaryContext(page, "virgo");
    const shots = [];
    for (const [seat, gestures] of [
      ["forward", []], ["yaw-quarter", [[-300, 0]]], ["yaw-180", [[-300, 0]]],
      ["pitch-high", [[0, 300], [0, 300]]],
      ["pitch-low", [[0, -300], [0, -300], [0, -300], [0, -300]]],
      ["diagonal", [[260, 220]]],
    ]) {
      for (const [dx, dy] of gestures) await orbit(page, dx, dy);
      shots.push(await capture(page, `desktop-far-sky-${seat}`, { referenceDragPixels: gestures, requestedLook: "virgo" }));
    }
    assert.notEqual(shots[0].sha256, shots[1].sha256, "quarter yaw changes visible sky");
    assert.notEqual(shots[0].sha256, shots[2].sha256, "half yaw changes visible sky");
    assert.notEqual(shots[3].sha256, shots[4].sha256, "pitch extremes differ");
    assert.notEqual(shots[4].sha256, shots[5].sha256, "diagonal differs");
  } finally { await closePage(page); }
}

// Exact solstice time through public controls, without a simulation-state hook.
// Each 16 ms playing frame at400 d/s advances6.4 days. Successively halving
// that public rate gives3.2,1.6,0.8,0.4,0.2,0.1 days per frame. Both requested
// J2000-to-midnight offsets are integer tenths, so a short binary decomposition
// reaches them exactly (subject to ordinary floating-point arithmetic).
async function installOrdinaryFrameObserver(page) {
  await page.evaluate(() => {
    const prior = window.requestAnimationFrame.bind(window);
    const evidence = globalThis.__ordinaryFrameEvidence = { previous: null, ticks: [], rate: 0 };
    window.requestAnimationFrame = (callback) => prior((timestamp) => {
      if (callback.name === "tick") {
        const playing = document.querySelector("#play-button")?.getAttribute("aria-pressed") === "true";
        if (playing) evidence.ticks.push({ timestamp, elapsed: (timestamp - evidence.previous) / 1000, rate: evidence.rate });
        evidence.previous = timestamp;
      }
      callback(timestamp);
    });
  });
  await advance(page, 48); // Observe a full paused application tick before playing.
  assert.ok(await page.evaluate(() => Number.isFinite(globalThis.__ordinaryFrameEvidence.previous)));
}

async function ordinaryPlayingFrames(page, frames, rate) {
  assert.ok(Number.isInteger(frames) && frames > 0);
  await page.evaluate(({ frames, rate }) => {
    globalThis.__ordinaryFrameEvidence.rate = rate;
    const record = globalThis.__ordinaryPlayback = { requestedFrames: frames, timestamps: [] };
    requestAnimationFrame((start) => {
      const play = document.querySelector("#play-button");
      if (play.getAttribute("aria-pressed") !== "false") throw new Error("timed playback must start paused");
      play.click();
      record.startedAt = start;
      function afterApplicationTick(timestamp) {
        record.timestamps.push(timestamp);
        if (record.timestamps.length === frames) {
          play.click();
          record.endedAt = timestamp;
        } else requestAnimationFrame(afterApplicationTick);
      }
      requestAnimationFrame(afterApplicationTick);
    });
  }, { frames, rate });
  await advance(page, (frames + 2) * 16);
  const playback = await page.evaluate(() => globalThis.__ordinaryPlayback);
  assert.equal(playback.timestamps.length, frames);
  assert.equal(playback.endedAt - playback.startedAt, frames * 16, "one16 ms interval per requested playing frame");
  assert.equal(await page.locator("#play-button").getAttribute("aria-pressed"), "false");
  states.get(page).inputs.push({ at: states.get(page).elapsed, kind: "frame-aligned public Play/Pause", rate, ...playback });
}

async function ordinarySolstice(name, targetDate, southPole = false) {
  const page = await newPage();
  try {
    await select(page, "earth");
    await settle(page);
    await installOrdinaryFrameObserver(page);
    assert.equal(CONFIG.maxDaysPerSecond, 400, "reviewed endpoint remains400 days/sec");
    await page.locator("#speed-slider").evaluate((slider) => { slider.value = "1"; slider.dispatchEvent(new Event("input", { bubbles: true })); });
    // Main's logarithm/exponent endpoint can exceed400 by2e-13. Faster clamps
    // it to the exact source maximum. Develop already holds400 and is disabled.
    await click(page, "#faster-button");
    const targetDays = (Date.parse(`${targetDate}T00:00:00Z`) - Date.UTC(2000, 0, 1, 12)) / 86400000;
    let units = Math.round(targetDays * 10);
    assert.equal(units / 10, targetDays, "target is representable in tenths of a day");
    const plan = [];
    for (let level = 0; level <= 6; level += 1) {
      if (level > 0) await click(page, "#slower-button");
      const unitsPerFrame = 64 / 2 ** level;
      const frames = Math.floor(units / unitsPerFrame);
      const rate = 400 / 2 ** level;
      if (frames) {
        await ordinaryPlayingFrames(page, frames, rate);
        plan.push({ frames, rate, days: frames * rate * 0.016 });
        units -= frames * unitsPerFrame;
      }
    }
    assert.equal(units, 0);
    const ticks = await page.evaluate(() => globalThis.__ordinaryFrameEvidence.ticks);
    assert.equal(ticks.length, plan.reduce((total, segment) => total + segment.frames, 0));
    for (const tick of ticks) assert.equal(tick.elapsed, 0.016, "recorded application playing interval is16 ms");
    const observedDays = ticks.reduce((days, tick) => days + tick.elapsed * tick.rate, 0);
    assert.ok(Math.abs(observedDays - targetDays) < 0.001, `public-control simulation delta${observedDays} matches target${targetDays}`);
    assert.equal(await page.locator("#clock").textContent(), targetDate, "exact target calendar date");
    const north = equatorialVectorToScene(bodyOrientationBasis(findBody("earth")).zAxis);
    const direction = southPole ? -1 : 1;
    const azimuth = Math.atan2(north.x * direction, north.z * direction);
    const elevation = Math.asin(north.y * direction);
    await orbit(page, (CONFIG.cameraAzimuth - azimuth) / 0.005, (elevation - CONFIG.cameraElevation) / 0.004);
    await wheel(page, -500);
    await capture(page, name, { targetDate, targetDays, observedDays, plan, playingTicks: ticks, southPole, timingBasis: "public endpoint/Faster clamp/Slower halvings; unchanged application RAF timestamps and public Play/Pause" });
  } finally { await closePage(page); }
}

async function ordinaryTouch() {
  for (const [name, size] of [["touch-card", [390, 844]], ["touch-landscape-card", [568, 320]]]) {
    const page = await newPage(true, size);
    try {
      await page.locator("#sky-mode").selectOption("all");
      await select(page, "earth");
      await capture(page, name, { initialSimulation: "J2000; settled Earth focus" });
    } finally { await closePage(page); }
  }
  for (const [aspect, size] of [["portrait", [390, 844]], ["landscape", [844, 390]]]) {
    for (const look of ["localgroup", "virgo", "web", "universe"]) {
      const page = await newPage(true, size, `?look=${look}`);
      try {
        await ordinaryContext(page, look);
        await capture(page, `touch-${aspect}-${look}`, { requestedLook: look, initialSimulation: "J2000; paused before first application tick" });
      } finally { await closePage(page); }
    }
  }
}

async function ordinaryTriton() {
  const page = await newPage();
  try {
    await select(page, "triton");
    await advance(page, 1500);
    await click(page, "#card-close");
    await orbit(page, page.viewportSize().width * 0.44);
    await wheel(page, -1200);
    const captureCrop = async (name, details = {}) => {
      await settle(page);
      const viewport = page.viewportSize();
      const label = await page.locator('.sky-label[data-body-id="triton"]').boundingBox();
      assert.ok(label && label.x >= 0 && label.y >= 0 && label.x + label.width <= viewport.width && label.y + label.height + 72 <= viewport.height);
      const cropSize = Math.min(360, viewport.width, viewport.height);
      const clip = {
        x: Math.max(0, Math.min(viewport.width - cropSize, label.x + label.width / 2 - cropSize / 2)),
        y: Math.max(0, Math.min(viewport.height - cropSize, label.y + label.height + 32 - cropSize / 2)),
        width: cropSize, height: cropSize,
      };
      await capture(page, name, { clip, ...details });
    };
    await captureCrop("triton-rotation-a", { initialSimulation: "J2000; paused before first application tick" });
    const speed = await page.locator("#speed-slider").evaluate((slider, { minimum, maximum }) => {
      slider.value = String((Math.log(5.876994) - Math.log(minimum)) / (Math.log(maximum) - Math.log(minimum)));
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      return { sliderValue: Number(slider.value), sliderStep: slider.step, readout: document.querySelector("#speed-readout").textContent };
    }, { minimum: CONFIG.minDaysPerSecond, maximum: CONFIG.maxDaysPerSecond });
    speed.effectiveDaysPerSecond = sourceSpeedFromSlider(speed.sliderValue);
    await page.evaluate(() => {
      const record = globalThis.__ordinaryTritonPlayback = {};
      requestAnimationFrame((timestamp) => {
        const play = document.querySelector("#play-button");
        play.click(); record.startedAt = timestamp;
        setTimeout(() => { play.click(); record.endedAt = performance.now(); }, 500);
      });
    });
    await advance(page, 532);
    const playback = await page.evaluate(() => globalThis.__ordinaryTritonPlayback);
    assert.equal(playback.endedAt - playback.startedAt, 500);
    assert.equal(await page.locator("#play-button").getAttribute("aria-pressed"), "false");
    await captureCrop("triton-rotation-b", { speed, playback, sourceRateLimit: "#78 changes native intermediate quantization;500 ms equal browser time is not equal simulated phase" });
  } finally { await closePage(page); }
}

async function ordinaryFallback() {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const state = { id: nextPageId++, context, touch: false, elapsed: 0, inputs: [], cdp: null, errors: [] };
  states.set(page, state);
  const expectedConsoleErrors = [];
  page.on("pageerror", (error) => state.errors.push(`page:${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (message.text() === "THREE.WebGLRenderer: THREE.WebGLRenderer: Error creating WebGL context.") expectedConsoleErrors.push(message.text());
    else state.errors.push(`console:${message.text()}`);
  });
  page.on("requestfailed", (request) => state.errors.push(`request:${request.url()} ${request.failure()?.errorText}`));
  page.on("response", (response) => { if (response.status() >= 400) state.errors.push(`HTTP${response.status()}:${response.url()}`); });
  try {
    await page.clock.install({ time: new Date("2026-09-05T00:00:00Z") });
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (["webgl", "webgl2", "experimental-webgl"].includes(type)) return null;
        return original.call(this, type, ...args);
      };
    });
    await page.goto(base, { waitUntil: "networkidle" });
    await page.locator("#unsupported:not([hidden])").waitFor();
    await page.clock.pauseAt(new Date("2026-09-05T01:00:00Z"));
    const failure = await page.evaluate(() => ({
      active: document.activeElement?.id,
      role: document.querySelector("#unsupported").getAttribute("role"),
      stageHidden: document.querySelector("#stage").hidden,
      stageInert: document.querySelector("#stage").inert,
      visibleFocusable: [...document.querySelectorAll("a, button, input, select, [tabindex]")].filter((element) => !element.hidden && element.getClientRects().length > 0).map((element) => element.id),
    }));
    assert.deepEqual(failure, { active: "unsupported", role: "alert", stageHidden: true, stageInert: true, visibleFocusable: ["unsupported"] });
    // Both exact sources initialize aria-busy=false before creating WebGL.
    // There is no broad main exemption and no invented heliosReady success.
    assert.equal(await page.locator("#viewport").getAttribute("aria-busy"), "false");
    assert.notEqual(await page.getAttribute("html", "data-helios-ready"), "1");
    state.initial = await observe(page);
    await capture(page, "webgl-fallback", { failure, expectedConsoleErrors, expectedMissingReady: true });
  } finally { await closePage(page); }
}

async function ordinaryViews() {
  await scenario("ordinary constellations and overview", ordinaryOverviewAndConstellations);
  await ordinaryDirectViews();
  await scenario("ordinary solar handoff", ordinaryHandoff);
  await scenario("ordinary20 scale transitions", ordinaryTransitions);
  await scenario("ordinary6 far-sky directions", ordinaryFarSky);
  await scenario("ordinary June solstice", () => ordinarySolstice("earth-june-solstice", "2000-06-21"));
  await scenario("ordinary December solstice", () => ordinarySolstice("earth-december-solstice", "2000-12-21", true));
  await scenario("ordinary touch card and cosmology", ordinaryTouch);
  await scenario("ordinary Triton crops", ordinaryTriton);
  await scenario("ordinary WebGL fallback", ordinaryFallback);
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
    await scenario("Controlled regular Triton, overview and Milky Way references", controlledLegacyViews);
    await responsive();
    await timeRates();
  }
  if (["all", "ordinary"].includes(group)) await ordinaryViews();
  await captureFocusTracking();
} catch (error) {
  manifest.failures.push({ scenario: "capture infrastructure", reason: String(error.stack || error) });
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
  manifest.missing = [...expected].filter((name) => !manifest.captures.some((entry) => entry.name === name));
  manifest.missingTrackingReports = manifest.focusTrackingExpectedReports.filter((id) =>
    !manifest.focusTrackingReports.some((entry) => entry.scenario === id));
  manifest.sourceCleanAfter = git(sourceRoot, "status", "--porcelain", "--untracked-files=all") === "";
  manifest.sourceCommitAfter = git(sourceRoot, "rev-parse", "HEAD");
  manifest.sourceTreeAfter = git(sourceRoot, "rev-parse", "HEAD^{tree}");
  manifest.harnessCleanAfter = git(harnessRoot, "status", "--porcelain", "--untracked-files=all") === "";
  if (group === "focus") {
    try {
      manifest.harnessAfter = {
        commit: git(harnessRoot, "rev-parse", "HEAD"), tree: git(harnessRoot, "rev-parse", "HEAD^{tree}"),
        sha256: sha256(await readFile(fileURLToPath(import.meta.url))),
        focusTrackingSha256: sha256(await readFile(new URL("./focus-tracking.mjs", import.meta.url))),
      };
      assert.equal(manifest.harnessAfter.commit, manifest.harness.commit, "focus harness commit remains frozen");
      assert.equal(manifest.harnessAfter.tree, manifest.harness.tree, "focus harness tree remains frozen");
      assert.equal(manifest.harnessAfter.sha256, manifest.harness.sha256, "focus capture harness bytes remain frozen");
      assert.equal(manifest.harnessAfter.focusTrackingSha256, manifest.harness.focusTracking.sha256, "focus observer bytes remain frozen");
      const files = ["capture-details.json", ...[...expected].map((name) => `${name}.png`),
        ...activeTrackingScenarios.map((item) => `focus-tracking-${item.id}.json`)];
      manifest.outputInventory = (await readdir(output)).sort();
      assert.deepEqual(manifest.outputInventory, files.sort(), "focus evidence has exactly 30 PNGs, 6 dense reports and its manifest");
      for (const entry of [...manifest.captures, ...manifest.focusTrackingReports]) {
        const bytes = await readFile(path.join(output, entry.file));
        assert.equal(bytes.length, entry.bytes, `${entry.file} retains its byte length`);
        assert.equal(sha256(bytes), entry.sha256, `${entry.file} retains its recorded hash`);
      }
    } catch (error) {
      manifest.failures.push({ scenario: "focus evidence inventory", reason: String(error.stack || error) });
    }
  }
  await flush();
}
assert.equal(manifest.sourceCleanAfter, true, "renderer source remains clean");
assert.equal(manifest.harnessCleanAfter, true, "capture harness remains clean");
assert.equal(manifest.sourceCommitAfter, sourceIdentity.commit);
assert.equal(manifest.sourceTreeAfter, sourceIdentity.tree);
assert.deepEqual(manifest.browserErrors, [], "no browser, console, request or HTTP errors");
assert.deepEqual(manifest.failures, [], "every capture scenario reaches its stated bounded criterion");
assert.deepEqual(manifest.missing, [], `all ${expected.size} requested ${group} captures exist`);
assert.deepEqual(manifest.missingTrackingReports, [], "every tracking sequence retains its complete hashed observer report");
console.log(`Visual capture complete: ${sourceLabel}/${group}, ${manifest.captures.length}/${expected.size} originals; ${sourceIdentity.commit} ${sourceIdentity.tree}`);
