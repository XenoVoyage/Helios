import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { bodyOrientationBasis, findBody } from "../js/bodies.js";
import { CONFIG, wheelZoomMultiplier } from "../js/config.js";
import { cmbSkyOpacity } from "../js/galaxy.js";
import { equatorialVectorToScene } from "../js/sky.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.BROWSER_SMOKE_PORT || 4175);
const base = `http://127.0.0.1:${port}/Helios/`;
const screenshotDir = process.env.HELIOS_SCREENSHOT_DIR;
const BRIGHT_LUMINANCE = 12;
const DARK_LUMINANCE = 6;
const TRANSITION_MEAN_LUMINANCE_FLOOR = 5.5;
const TRANSITION_BRIGHT_COVERAGE_FLOOR = 0.006;
const FAR_SKY_MEAN_LUMINANCE_FLOOR = 4.5;
const FAR_SKY_BRIGHT_COVERAGE_FLOOR = 0.002;
const CMB_MEAN_LUMINANCE_FLOOR = 28;
const CMB_LUMINANCE_STDDEV_FLOOR = 12;
const CMB_WARM_COLOR_COVERAGE_FLOOR = 0.08;
const CMB_COOL_COLOR_COVERAGE_FLOOR = 0.005;
const CMB_BLUE_RED_RATIO_CEILING = 1.15;
const child = spawn(process.execPath, ["tests/serve.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});

let browser;

function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function frameDifferenceMetrics(page, before, after) {
  return page.evaluate(async ({ beforeSource, afterSource }) => {
    const load = async (source) => {
      const image = new Image();
      const ready = new Promise((resolve, reject) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", reject, { once: true });
      });
      image.src = `data:image/png;base64,${source}`;
      await ready;
      return image;
    };
    const [beforeImage, afterImage] = await Promise.all([
      load(beforeSource),
      load(afterSource),
    ]);
    if (
      beforeImage.naturalWidth !== afterImage.naturalWidth
      || beforeImage.naturalHeight !== afterImage.naturalHeight
    ) throw new Error("comparison frames have different dimensions");
    const surface = document.createElement("canvas");
    surface.width = beforeImage.naturalWidth;
    surface.height = beforeImage.naturalHeight;
    const context = surface.getContext("2d", { willReadFrequently: true });
    context.drawImage(beforeImage, 0, 0);
    const first = context.getImageData(0, 0, surface.width, surface.height).data;
    context.clearRect(0, 0, surface.width, surface.height);
    context.drawImage(afterImage, 0, 0);
    const second = context.getImageData(0, 0, surface.width, surface.height).data;
    let absoluteTotal = 0;
    let strong = 0;
    const pixels = surface.width * surface.height;
    for (let offset = 0; offset < first.length; offset += 4) {
      const red = Math.abs(first[offset] - second[offset]);
      const green = Math.abs(first[offset + 1] - second[offset + 1]);
      const blue = Math.abs(first[offset + 2] - second[offset + 2]);
      absoluteTotal += (red + green + blue) / 3;
      if (Math.max(red, green, blue) > 12) strong += 1;
    }
    return {
      meanAbsoluteDifference: absoluteTotal / pixels,
      strongCoverage: strong / pixels,
    };
  }, {
    beforeSource: before.toString("base64"),
    afterSource: after.toString("base64"),
  });
}

async function stableCanvasFrame(page, canvas) {
  let before = await canvas.screenshot();
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await page.waitForTimeout(100);
    const after = await canvas.screenshot();
    const difference = await frameDifferenceMetrics(page, before, after);
    if (
      difference.meanAbsoluteDifference <= 0.08
      && difference.strongCoverage <= 0.0005
    ) return after;
    before = after;
  }
  throw new Error("rendered canvas did not settle before visual comparison");
}

function captureErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    errors.push(`request: ${request.url()} ${request.failure()?.errorText ?? "failed"}`);
  });
  return errors;
}

function launchBrowser() {
  return chromium.launch({
    headless: true,
    executablePath: process.env.HELIOS_CHROMIUM_PATH || undefined,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
}

async function openReady(page, suffix = "") {
  await page.goto(base + suffix, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.documentElement.dataset.heliosReady === "1",
    null,
    { timeout: 20_000 },
  );
}

async function assertRenderedCanvas(page) {
  const canvas = page.locator("#viewport");
  const details = await canvas.evaluate((element) => ({
    cssWidth: element.getBoundingClientRect().width,
    cssHeight: element.getBoundingClientRect().height,
    width: element.width,
    height: element.height,
    webgl: Boolean(element.getContext("webgl2")),
  }));
  assert.ok(details.cssWidth > 0 && details.cssHeight > 0, "canvas has a CSS size");
  assert.ok(details.width > 0 && details.height > 0, "canvas has a drawing buffer");
  assert.equal(details.webgl, true, "canvas owns a WebGL2 context");
  const png = await canvas.screenshot();
  assert.ok(png.length > 10_000, `rendered canvas PNG is nonempty (${png.length} bytes)`);
  return png;
}

async function assertBodyLabelsHidden(page) {
  const labels = await page.locator(".sky-label").evaluateAll((elements) => ({
    count: elements.length,
    hidden: elements.filter((element) => element.hidden).length,
    painted: elements.filter((element) => element.getClientRects().length > 0).length,
    displayed: elements.filter((element) => getComputedStyle(element).display !== "none").length,
    hitTested: document.elementsFromPoint(20, 76)
      .filter((element) => element.classList.contains("sky-label")).length,
  }));
  assert.ok(labels.count > 0, "body labels exist");
  assert.equal(labels.hidden, labels.count, "every body label has hidden semantics");
  assert.equal(labels.painted, 0, "hidden body labels have no rendered boxes");
  assert.equal(labels.displayed, 0, "author CSS preserves hidden display semantics");
  assert.equal(labels.hitTested, 0, "hidden body labels cannot intercept pointer input");
}

async function saveScreenshot(page, name, options = {}) {
  if (!screenshotDir) return;
  await mkdir(screenshotDir, { recursive: true });
  await writeFile(path.join(screenshotDir, `${name}.png`), await page.screenshot(options));
}

async function saveCanvasOnlyScreenshot(page, name) {
  const png = await page.locator("#viewport").screenshot({
    style: "#stage > :not(#viewport), body > :not(#stage) { visibility: hidden !important; }",
  });
  if (screenshotDir) {
    await mkdir(screenshotDir, { recursive: true });
    await writeFile(path.join(screenshotDir, `${name}.png`), png);
  }
  return png;
}

async function distributedFrameMetrics(page, png) {
  return page.evaluate(async ({ source, brightLuminance, darkLuminance }) => {
    const image = new Image();
    const ready = new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", reject, { once: true });
    });
    image.src = `data:image/png;base64,${source}`;
    await ready;

    const surface = document.createElement("canvas");
    surface.width = image.naturalWidth;
    surface.height = image.naturalHeight;
    const context = surface.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);

    // Distributed off-center tiles exclude the camera-attached hierarchy
    // titles. A white title therefore cannot make an otherwise black web pass.
    const regions = [
      { name: "lower-left", x: 0.05, y: 0.56, width: 0.38, height: 0.26 },
      { name: "lower-right", x: 0.57, y: 0.56, width: 0.38, height: 0.26 },
    ];
    let luminanceTotal = 0;
    let brightLuminanceTotal = 0;
    let bright = 0;
    let dark = 0;
    let samples = 0;
    const regionMetrics = [];

    for (const region of regions) {
      const x = Math.floor(surface.width * region.x);
      const y = Math.floor(surface.height * region.y);
      const width = Math.max(1, Math.floor(surface.width * region.width));
      const height = Math.max(1, Math.floor(surface.height * region.height));
      const pixels = context.getImageData(x, y, width, height).data;
      let regionLuminance = 0;
      let regionBrightLuminance = 0;
      let regionBright = 0;
      let regionDark = 0;
      let regionSamples = 0;
      // A two-pixel stride keeps the audit inexpensive without averaging away
      // point-built galaxies or filaments.
      for (let row = 0; row < height; row += 2) {
        for (let column = 0; column < width; column += 2) {
          const offset = (row * width + column) * 4;
          const luminance = pixels[offset] * 0.2126
            + pixels[offset + 1] * 0.7152
            + pixels[offset + 2] * 0.0722;
          regionLuminance += luminance;
          if (luminance >= brightLuminance) {
            regionBrightLuminance += luminance;
            regionBright += 1;
          }
          if (luminance < darkLuminance) regionDark += 1;
          regionSamples += 1;
        }
      }
      luminanceTotal += regionLuminance;
      brightLuminanceTotal += regionBrightLuminance;
      bright += regionBright;
      dark += regionDark;
      samples += regionSamples;
      regionMetrics.push({
        name: region.name,
        meanLuminance: regionLuminance / regionSamples,
        brightMeanLuminance: regionBright
          ? regionBrightLuminance / regionBright
          : 0,
        brightCoverage: regionBright / regionSamples,
        darkCoverage: regionDark / regionSamples,
      });
    }

    return {
      meanLuminance: luminanceTotal / samples,
      brightMeanLuminance: bright ? brightLuminanceTotal / bright : 0,
      brightEnergy: brightLuminanceTotal / samples,
      brightCoverage: bright / samples,
      darkCoverage: dark / samples,
      samples,
      regions: regionMetrics,
    };
  }, {
    source: png.toString("base64"),
    brightLuminance: BRIGHT_LUMINANCE,
    darkLuminance: DARK_LUMINANCE,
  });
}

async function cmbTextureMetrics(page, png) {
  return page.evaluate(async ({ source, brightLuminance }) => {
    const image = new Image();
    const ready = new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", reject, { once: true });
    });
    image.src = `data:image/png;base64,${source}`;
    await ready;

    const surface = document.createElement("canvas");
    surface.width = image.naturalWidth;
    surface.height = image.naturalHeight;
    const context = surface.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);

    // The direct universe seat centers the sphere here, clear of the header
    // and dock. Its interior—not the former rim—must carry recognizable warm
    // and cool CMB texture structure.
    const x = Math.floor(surface.width * 0.28);
    const y = Math.floor(surface.height * 0.14);
    const width = Math.max(1, Math.floor(surface.width * 0.44));
    const height = Math.max(1, Math.floor(surface.height * 0.58));
    const pixels = context.getImageData(x, y, width, height).data;
    let red = 0;
    let green = 0;
    let blue = 0;
    let luminance = 0;
    let luminanceSquared = 0;
    let warm = 0;
    let cool = 0;
    let samples = 0;

    for (let row = 0; row < height; row += 2) {
      for (let column = 0; column < width; column += 2) {
        const offset = (row * width + column) * 4;
        const r = pixels[offset];
        const g = pixels[offset + 1];
        const b = pixels[offset + 2];
        const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
        red += r;
        green += g;
        blue += b;
        luminance += luma;
        luminanceSquared += luma * luma;
        if (luma >= brightLuminance && r - b >= 6) warm += 1;
        if (luma >= brightLuminance && b - r >= 6) cool += 1;
        samples += 1;
      }
    }

    const meanLuminance = luminance / samples;
    return {
      meanRed: red / samples,
      meanGreen: green / samples,
      meanBlue: blue / samples,
      meanLuminance,
      luminanceStdDev: Math.sqrt(Math.max(
        0,
        luminanceSquared / samples - meanLuminance * meanLuminance,
      )),
      warmCoverage: warm / samples,
      coolCoverage: cool / samples,
      samples,
    };
  }, {
    source: png.toString("base64"),
    brightLuminance: BRIGHT_LUMINANCE,
  });
}

async function assertCmbTextureVisible(page) {
  const png = await page.locator("#viewport").screenshot();
  const metrics = await cmbTextureMetrics(page, png);
  console.log(
    `desktop-universe-cmb: mean=${metrics.meanLuminance.toFixed(3)}, `
      + `stddev=${metrics.luminanceStdDev.toFixed(3)}, `
      + `rgb=${metrics.meanRed.toFixed(3)}/${metrics.meanGreen.toFixed(3)}`
      + `/${metrics.meanBlue.toFixed(3)}, `
      + `warm=${(metrics.warmCoverage * 100).toFixed(3)}%, `
      + `cool=${(metrics.coolCoverage * 100).toFixed(3)}%`,
  );
  assert.ok(
    metrics.meanLuminance >= CMB_MEAN_LUMINANCE_FLOOR,
    "the final CMB texture is brighter than the rejected dark-blue rendering",
  );
  assert.ok(
    metrics.luminanceStdDev >= CMB_LUMINANCE_STDDEV_FLOOR,
    "the final sphere retains visible CMB texture variation",
  );
  assert.ok(
    metrics.warmCoverage >= CMB_WARM_COLOR_COVERAGE_FLOOR,
    "the final sphere retains a substantial warm CMB population",
  );
  assert.ok(
    metrics.coolCoverage >= CMB_COOL_COLOR_COVERAGE_FLOOR,
    "the fixed camera face retains visible cool CMB structure",
  );
  assert.ok(
    metrics.meanBlue <= metrics.meanRed * CMB_BLUE_RED_RATIO_CEILING,
    "the final sphere is not dominated by an artificial blue treatment",
  );
}

function assertFrameFloor(metrics, name, meanFloor, coverageFloor) {
  const mean = metrics.meanLuminance.toFixed(3);
  const coverage = (metrics.brightCoverage * 100).toFixed(3);
  assert.ok(
    metrics.meanLuminance >= meanFloor,
    `${name} distributed mean luminance ${mean} stays at or above ${meanFloor}`,
  );
  assert.ok(
    metrics.brightCoverage >= coverageFloor,
    `${name} distributed bright-pixel coverage ${coverage}% stays at or above `
      + `${(coverageFloor * 100).toFixed(3)}%`,
  );
  const populatedRegions = metrics.regions.filter((region) => (
    region.meanLuminance >= meanFloor * 0.45
    && region.brightCoverage >= coverageFloor * 0.45
  ));
  assert.ok(
    populatedRegions.length === metrics.regions.length,
    `${name} has visible structure in both label- and dock-free side regions`,
  );
}

async function auditedCanvasFrame(
  page,
  name,
  meanFloor,
  coverageFloor,
  { deferFloor = false } = {},
) {
  const png = await page.locator("#viewport").screenshot();
  const metrics = await distributedFrameMetrics(page, png);
  await saveScreenshot(page, name);
  console.log(
    `${name}: mean=${metrics.meanLuminance.toFixed(3)}, `
      + `bright-mean=${metrics.brightMeanLuminance.toFixed(3)}, `
      + `bright-energy=${metrics.brightEnergy.toFixed(3)}, `
      + `coverage=${(metrics.brightCoverage * 100).toFixed(3)}%, `
      + `dark=${(metrics.darkCoverage * 100).toFixed(3)}%, `
      + `side-means=${metrics.regions.map((region) => region.meanLuminance.toFixed(3)).join("/")}, `
      + `side-coverage=${metrics.regions.map((region) => (
        `${(region.brightCoverage * 100).toFixed(3)}%`
      )).join("/")}`,
  );
  if (!deferFloor) assertFrameFloor(metrics, name, meanFloor, coverageFloor);
  return { png, metrics };
}

async function moveToCanvas(page) {
  const point = await page.evaluate(() => {
    const viewport = document.querySelector("#viewport");
    const box = viewport.getBoundingClientRect();
    const candidates = [[0.5, 0.5], [0.72, 0.46], [0.28, 0.46]];
    for (const [x, y] of candidates) {
      const clientX = box.left + box.width * x;
      const clientY = box.top + box.height * y;
      if (document.elementFromPoint(clientX, clientY) === viewport) {
        return { x: clientX, y: clientY };
      }
    }
    return null;
  });
  assert.ok(point, "an unobstructed canvas point is available for visual-audit input");
  await page.mouse.move(point.x, point.y);
}

async function zoomBetweenAuditDistances(page, from, to) {
  await moveToCanvas(page);
  await page.mouse.wheel(0, Math.log(to / from) / Math.log(wheelZoomMultiplier(1)));
  await page.waitForTimeout(350);
}

async function dispatchWheelZoom(page, from, to) {
  const deltaY = Math.log(to / from) / 0.0016;
  await page.locator("#viewport").evaluate((canvas, delta) => {
    canvas.dispatchEvent(new WheelEvent("wheel", {
      deltaY: delta,
      bubbles: true,
      cancelable: true,
    }));
  }, deltaY);
}

async function settleCameraFrame(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => {
    requestAnimationFrame(resolve);
  })));
}

async function currentCameraMetrics(page) {
  return page.evaluate(async () => {
    const app = await import(new URL("./js/app.js", location.href).href);
    return app.currentCameraMetrics();
  });
}

async function settleCameraMotion(page) {
  await page.waitForFunction(async () => {
    const app = await import(new URL("./js/app.js", location.href).href);
    return app.currentCameraMetrics()?.cameraSettling === false;
  }, null, { timeout: 5_000 });
}

async function assertColdGalaxyZoomDoesNotBlock(context) {
  const page = await context.newPage();
  const errors = captureErrors(page);
  await page.addInitScript(() => {
    window.__heliosLongTasks = [];
    if ("PerformanceObserver" in window) {
      const observer = new PerformanceObserver((list) => {
        window.__heliosLongTasks.push(...list.getEntries().map((entry) => ({
          startTime: entry.startTime,
          duration: entry.duration,
        })));
      });
      try { observer.observe({ type: "longtask", buffered: true }); } catch {}
    }
    window.requestIdleCallback = (callback) => window.setTimeout(() => callback({
      didTimeout: true,
      timeRemaining: () => 0,
    }), 30_000);
    window.cancelIdleCallback = (handle) => window.clearTimeout(handle);
  });
  await openReady(page);
  assert.equal(await page.getAttribute("html", "data-galaxy-prepared"), null);
  const result = await page.locator("#viewport").evaluate(async (canvas, target) => {
    const app = await import(new URL("./js/app.js", location.href).href);
    const gl = canvas.getContext("webgl2");
    const glCalls = {};
    const timedCalls = [
      "compileShader", "linkProgram", "getShaderParameter", "getProgramParameter",
      "texImage2D", "texSubImage2D", "generateMipmap", "bufferData",
      "drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced",
    ];
    for (const name of timedCalls) {
      const original = gl?.[name];
      if (typeof original !== "function") continue;
      const stats = { calls: 0, totalMs: 0, maxMs: 0, wrapped: false };
      glCalls[name] = stats;
      try {
        gl[name] = function timedWebGlCall(...args) {
          const callStarted = performance.now();
          try {
            return original.apply(this, args);
          } finally {
            const duration = performance.now() - callStarted;
            stats.calls += 1;
            stats.totalMs += duration;
            stats.maxMs = Math.max(stats.maxMs, duration);
          }
        };
        stats.wrapped = gl[name] !== original;
      } catch {}
    }
    const parallelCompile = Boolean(gl?.getExtension("KHR_parallel_shader_compile"));
    const before = app.currentCameraMetrics();
    const started = performance.now();
    canvas.dispatchEvent(new WheelEvent("wheel", {
      deltaY: Math.log(target / before.controlDistance) / 0.0016,
      bubbles: true,
      cancelable: true,
    }));
    const afterDispatch = app.currentCameraMetrics();
    const dispatchMs = performance.now() - started;
    const inputToPaintMs = await new Promise((resolve, reject) => {
      const deadline = started + 5_000;
      const inspect = () => {
        const metrics = app.currentCameraMetrics();
        if (
          document.documentElement.dataset.galaxyReady === "1"
          && Math.abs(metrics.lastRenderedControlDistance - target) < 1e-6
        ) {
          resolve(performance.now() - started);
        } else if (performance.now() >= deadline) {
          reject(new Error(
            "cold galaxy zoom did not render within 5 seconds: "
              + JSON.stringify({
                galaxyReady: document.documentElement.dataset.galaxyReady ?? null,
                stage: metrics.galaxyStage,
                warmup: metrics.galaxyWarmup,
                requested: metrics.requestedControlDistance,
                rendered: metrics.lastRenderedControlDistance,
              }),
          ));
        } else {
          requestAnimationFrame(inspect);
        }
      };
      requestAnimationFrame(inspect);
    });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const longTasks = (window.__heliosLongTasks ?? [])
      .filter((entry) => entry.startTime >= started);
    return {
      dispatchMs,
      inputToPaintMs,
      beforeControlDistance: before.controlDistance,
      heldControlDistance: afterDispatch.controlDistance,
      queuedControlDistance: afterDispatch.requestedControlDistance,
      metrics: app.currentCameraMetrics(),
      parallelCompile,
      glCalls,
      longTasks: longTasks.map((entry) => ({
        startMs: entry.startTime - started,
        duration: entry.duration,
      })),
      longTaskMaxMs: Math.max(0, ...longTasks.map((entry) => entry.duration)),
    };
  }, CONFIG.handoffViewDistance);
  console.log(
    `Cold galaxy zoom: dispatch=${result.dispatchMs.toFixed(2)} ms, `
      + `input-to-render=${result.inputToPaintMs.toFixed(2)} ms, `
      + `max-task=${result.metrics.galaxyWarmup.maxMs.toFixed(2)} ms, `
      + `long-task=${result.longTaskMaxMs.toFixed(2)} ms`,
  );
  console.log("Cold galaxy WebGL timing", JSON.stringify({
    parallelCompile: result.parallelCompile,
    calls: result.glCalls,
    longTasks: result.longTasks,
  }));
  assert.equal(result.heldControlDistance, result.beforeControlDistance);
  assert.ok(Math.abs(result.queuedControlDistance - CONFIG.handoffViewDistance) < 1e-6);
  assert.ok(result.dispatchMs < 50, `cold zoom dispatch returns in ${result.dispatchMs.toFixed(2)} ms`);
  assert.ok(result.metrics.galaxyWarmup.chunks > 5, "cold near build spans multiple tasks");
  assert.ok(
    result.metrics.galaxyWarmup.maxMs < 50,
    `cold galaxy work avoids a long task (${result.metrics.galaxyWarmup.maxMs.toFixed(2)} ms)`,
  );
  assert.ok(result.longTaskMaxMs < 50, "dispatch-through-render has no browser long task");
  assert.ok(result.inputToPaintMs < 2_000, "cold target renders promptly");
  assert.equal(result.metrics.galaxyStage, "near");
  assert.deepEqual(errors, []);
  await saveScreenshot(page, "desktop-cold-galaxy-first-frame");
  await page.close();
}

async function assertPreparedZoomLatency(page) {
  await page.waitForFunction(
    () => document.documentElement.dataset.galaxyPrepared === "1"
      && document.documentElement.dataset.assetsLoading === "0",
    null,
    { timeout: 30_000 },
  );
  const warmup = (await currentCameraMetrics(page)).galaxyWarmup;
  console.log(`Galaxy warmup: chunks=${warmup.chunks}, max-task=${warmup.maxMs.toFixed(2)} ms`);
  assert.ok(warmup.chunks > 5);
  assert.ok(warmup.maxMs < 50);
  const result = await page.locator("#viewport").evaluate(async (canvas, target) => {
    const app = await import(new URL("./js/app.js", location.href).href);
    const before = app.currentCameraMetrics();
    const started = performance.now();
    canvas.dispatchEvent(new WheelEvent("wheel", {
      deltaY: Math.log(target / before.controlDistance) / 0.0016,
      bubbles: true,
      cancelable: true,
    }));
    const dispatchMs = performance.now() - started;
    const inputToPaintMs = await new Promise((resolve, reject) => {
      const deadline = started + 2_000;
      const inspect = () => {
        const metrics = app.currentCameraMetrics();
        if (Math.abs(metrics.lastRenderedControlDistance - target) < 1e-6) {
          resolve(performance.now() - started);
        } else if (performance.now() >= deadline) {
          reject(new Error("prepared galaxy zoom did not render"));
        } else requestAnimationFrame(inspect);
      };
      requestAnimationFrame(inspect);
    });
    return { dispatchMs, inputToPaintMs };
  }, CONFIG.handoffViewDistance);
  assert.ok(result.dispatchMs < 50);
  assert.ok(result.inputToPaintMs < 500);
  await page.locator("#reset-button").click();
  await settleCameraMotion(page);
}

async function assertPausedRenderInvalidation(page) {
  const play = page.locator("#play-button");
  if (await play.getAttribute("aria-pressed") === "true") await play.click();
  await page.waitForFunction(async () => {
    const app = await import(new URL("./js/app.js", location.href).href);
    const metrics = app.currentCameraMetrics();
    return document.documentElement.dataset.galaxyPrepared === "1"
      && document.documentElement.dataset.assetsLoading === "0"
      && metrics.cameraSettling === false
      && metrics.framePending === false;
  }, null, { timeout: 30_000 });
  const before = (await currentCameraMetrics(page)).renderCount;
  await page.waitForTimeout(300);
  assert.equal((await currentCameraMetrics(page)).renderCount, before, "paused settled scene stops GPU renders");
  await page.locator("#zoom-in-button").click();
  await page.waitForFunction(async (count) => {
    const app = await import(new URL("./js/app.js", location.href).href);
    return app.currentCameraMetrics().renderCount > count;
  }, before);
}

async function assertCameraControlsAndSunBoundary(page) {
  for (const id of ["zoom-out-button", "zoom-in-button"]) {
    const box = await page.locator(`#${id}`).boundingBox();
    assert.ok(box && box.width >= 44 && box.height >= 44, `${id} is a 44px target`);
  }
  await page.locator("#skip-link").focus();
  await page.locator("#skip-link").press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "dock");
  await page.locator("#faster-button").click();
  assert.equal(await page.locator("#status-live").textContent(), "Time speed 2 seconds per second");
  await page.locator("#slower-button").click();
  assert.equal(await page.locator("#status-live").textContent(), "Time speed 1 second per second");
  const canvas = page.locator("#viewport");
  await canvas.focus();
  const beforeOrbit = await currentCameraMetrics(page);
  await canvas.press("ArrowRight");
  await settleCameraFrame(page);
  assert.ok((await currentCameraMetrics(page)).azimuth > beforeOrbit.azimuth);
  const beforeZoom = await currentCameraMetrics(page);
  await canvas.press("PageUp");
  await settleCameraFrame(page);
  assert.ok((await currentCameraMetrics(page)).controlDistance < beforeZoom.controlDistance);
  await page.evaluate(() => document.querySelector('[data-body-id="sun"]').click());
  await settleCameraMotion(page);
  const haloPoint = await page.evaluate(async () => {
    const app = await import(new URL("./js/app.js", location.href).href);
    const metrics = app.currentCameraMetrics();
    const radius = innerHeight * 0.5
      * Math.tan(Math.asin(metrics.focusRadius / metrics.cameraDistance))
      / Math.tan(52 * Math.PI / 360);
    const point = { x: innerWidth * 0.5 + radius * 2, y: innerHeight * 0.5 };
    return { ...point, hit: document.elementFromPoint(point.x, point.y)?.id };
  });
  assert.equal(haloPoint.hit, "viewport", "the Sun halo test point reaches the canvas");
  await page.mouse.click(haloPoint.x, haloPoint.y);
  await settleCameraFrame(page);
  assert.equal(
    await page.locator("#body-card").getAttribute("hidden"),
    "",
    "transparent Sun glow does not enlarge the scientific mesh pick target",
  );
  for (let i = 0; i < 80; i += 1) await canvas.press("PageUp");
  await settleCameraMotion(page);
  const sun = await currentCameraMetrics(page);
  assert.equal(sun.focusedId, "sun");
  assert.ok(sun.controlDistance > sun.focusRadius + sun.near);
  assert.ok(
    sun.cameraDistance > sun.focusRadius + sun.near,
    "the camera near plane stays outside the Sun",
  );
  const assertSunClearance = async (seat) => {
    const metrics = await currentCameraMetrics(page);
    assert.ok(
      metrics.cameraDistance > metrics.focusRadius + metrics.near,
      `the Sun near-plane boundary holds at ${seat}`,
    );
  };
  for (const pitch of [
    { key: "ArrowDown", count: 20, name: "low elevation" },
    { key: "ArrowUp", count: 12, name: "mid elevation" },
    { key: "ArrowUp", count: 12, name: "high elevation" },
  ]) {
    for (let i = 0; i < pitch.count; i += 1) await canvas.press(pitch.key);
    for (let seat = 0; seat < 8; seat += 1) {
      for (let step = 0; step < 7; step += 1) await canvas.press("ArrowRight");
      await settleCameraFrame(page);
      await assertSunClearance(`${pitch.name}, azimuth seat ${seat + 1}`);
    }
  }
  await page.locator("#reset-button").click();
  await settleCameraMotion(page);
}

async function assertBodyLabelCollisionsSuppressed(page) {
  const visibleSnapshot = () => page.locator(".sky-label").evaluateAll((elements) => (
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return {
        id: element.dataset.bodyId,
        hidden: element.hidden,
        transform: element.style.transform,
        className: element.className,
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
      };
    }).filter((label) => !label.hidden)
  ));
  await settleCameraMotion(page);
  const labels = await visibleSnapshot();
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      const first = labels[i];
      const second = labels[j];
      const overlaps = first.right > second.left && first.left < second.right
        && first.bottom > second.top && first.top < second.bottom;
      assert.equal(overlaps, false, `${first.id} and ${second.id} labels do not overlap`);
    }
  }
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await settleCameraFrame(page);
  assert.deepEqual(await visibleSnapshot(), labels, "a repeated frame keeps the same label survivors and styles");

  await page.evaluate(() => document.querySelector('[data-body-id="jupiter"]').click());
  await page.waitForFunction(async () => {
    const app = await import(new URL("./js/app.js", location.href).href);
    const metrics = app.currentCameraMetrics();
    const label = document.querySelector('[data-body-id="jupiter"]');
    return metrics.focusedId === "jupiter"
      && metrics.cameraSettling === false
      && metrics.framePending === false
      && label?.hidden === false;
  });
  assert.equal(
    await page.locator('[data-body-id="jupiter"]').getAttribute("hidden"),
    null,
    "the selected/focused label wins any collision",
  );
  await page.locator("#reset-button").click();
  await settleCameraMotion(page);
}

async function pressCameraKey(page, key, count) {
  const canvas = page.locator("#viewport");
  await canvas.focus();
  for (let step = 0; step < count; step += 1) await canvas.press(key);
  await settleCameraFrame(page);
}

async function findSaturnFrontSeat(page) {
  const canvas = page.locator("#viewport");
  await canvas.focus();
  let best = null;
  for (let step = 0; step < 52; step += 1) {
    const metrics = await currentCameraMetrics(page);
    if (!best || metrics.saturnRing.viewLightDot > best.metrics.saturnRing.viewLightDot) {
      best = { step, metrics };
    }
    await canvas.press("ArrowRight");
    await settleCameraFrame(page);
  }
  await pressCameraKey(page, "ArrowLeft", 52 - best.step);
  return currentCameraMetrics(page);
}

function antipodalOrbitError(first, second) {
  const vector = ({ azimuth, elevation }) => ({
    x: Math.cos(elevation) * Math.sin(azimuth),
    y: Math.sin(elevation),
    z: Math.cos(elevation) * Math.cos(azimuth),
  });
  const a = vector(first);
  const b = vector(second);
  const antipodalDot = -(a.x * b.x + a.y * b.y + a.z * b.z);
  return Math.acos(Math.max(-1, Math.min(1, antipodalDot)));
}

async function saturnFrameMetrics(page, png, cameraMetrics) {
  return page.evaluate(async ({ source, camera }) => {
    const image = new Image();
    const ready = new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", reject, { once: true });
    });
    image.src = `data:image/png;base64,${source}`;
    await ready;
    const surface = document.createElement("canvas");
    surface.width = image.naturalWidth;
    surface.height = image.naturalHeight;
    const context = surface.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, surface.width, surface.height).data;
    const angularRadius = Math.asin(Math.min(0.999, camera.focusRadius / camera.cameraDistance));
    const globeRadius = surface.height * 0.5 * Math.tan(angularRadius)
      / Math.tan(52 * Math.PI / 360);
    const centerX = surface.width * 0.5;
    const centerY = surface.height * 0.5;
    let centerTotal = 0;
    let centerCount = 0;
    let ringTotal = 0;
    let ringCount = 0;
    let ringBright = 0;
    let outsideTotal = 0;
    let outsideCount = 0;
    let outsideBright = 0;
    for (let y = 0; y < surface.height; y += 1) {
      for (let x = 0; x < surface.width; x += 1) {
        const radius = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY) / globeRadius;
        if (radius > 3) continue;
        const offset = (y * surface.width + x) * 4;
        const luminance = pixels[offset] * 0.2126
          + pixels[offset + 1] * 0.7152
          + pixels[offset + 2] * 0.0722;
        if (radius <= 0.55) {
          centerTotal += luminance;
          centerCount += 1;
        } else if (radius >= 1.12 && radius <= 2.42) {
          ringTotal += luminance;
          ringCount += 1;
          if (luminance > 8) ringBright += 1;
        } else if (radius >= 2.58) {
          outsideTotal += luminance;
          outsideCount += 1;
          if (luminance > 8) outsideBright += 1;
        }
      }
    }
    return {
      globeRadius,
      centerMean: centerTotal / Math.max(1, centerCount),
      ringMean: ringTotal / Math.max(1, ringCount),
      ringBrightCoverage: ringBright / Math.max(1, ringCount),
      outsideMean: outsideTotal / Math.max(1, outsideCount),
      outsideBrightCoverage: outsideBright / Math.max(1, outsideCount),
    };
  }, { source: png.toString("base64"), camera: cameraMetrics });
}

async function assertSaturnRingTextureProfile(page) {
  const profile = await page.evaluate(async () => {
    const image = new Image();
    const ready = new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", reject, { once: true });
    });
    image.src = "./assets/textures/saturn-ring.png";
    await ready;
    const surface = document.createElement("canvas");
    surface.width = image.naturalWidth;
    surface.height = image.naturalHeight;
    const context = surface.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, surface.width, surface.height).data;
    const alpha = new Float64Array(surface.width);
    const luminance = new Float64Array(surface.width);
    for (let x = 0; x < surface.width; x += 1) {
      for (let y = 0; y < surface.height; y += 1) {
        const offset = (y * surface.width + x) * 4;
        const a = pixels[offset + 3] / 255;
        alpha[x] += pixels[offset + 3] / surface.height;
        luminance[x] += (pixels[offset] * 0.2126
          + pixels[offset + 1] * 0.7152
          + pixels[offset + 2] * 0.0722) * a / surface.height;
      }
    }
    let transparentColumns = 0;
    let transitions = 0;
    let mean = 0;
    for (let x = 0; x < alpha.length; x += 1) {
      mean += luminance[x] / alpha.length;
      if (alpha[x] < 10) transparentColumns += 1;
      if (x > 0 && Math.abs(luminance[x] - luminance[x - 1]) > 5) transitions += 1;
    }
    let variance = 0;
    for (let x = 0; x < luminance.length; x += 1) {
      variance += (luminance[x] - mean) ** 2 / luminance.length;
    }
    return { transparentColumns, transitions, standardDeviation: Math.sqrt(variance) };
  });
  assert.ok(profile.transparentColumns > 100, "ring texture retains transparent gaps");
  assert.ok(profile.transitions > 100, "ring texture retains many radial bands");
  assert.ok(profile.standardDeviation > 30, "ring texture retains strong radial contrast");
}

async function touchPinchZoomOut(context, page) {
  const cdp = await context.newCDPSession(page);
  const box = await page.locator("#viewport").boundingBox();
  assert.ok(box);
  const centerX = box.x + box.width * 0.5;
  const centerY = box.y + box.height * 0.42;
  const points = (halfGap) => [
    { id: 0, x: centerX - halfGap, y: centerY, radiusX: 4, radiusY: 4, force: 1 },
    { id: 1, x: centerX + halfGap, y: centerY, radiusX: 4, radiusY: 4, force: 1 },
  ];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(70) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(35) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await settleCameraFrame(page);
}

async function touchSaturnHalfTurn(context, page, front) {
  const cdp = await context.newCDPSession(page);
  const start = await page.evaluate(() => {
    const canvas = document.querySelector("#viewport");
    const box = canvas.getBoundingClientRect();
    for (const [x, y] of [[0.82, 0.55], [0.82, 0.42], [0.72, 0.5]]) {
      const at = { x: box.left + box.width * x, y: box.top + box.height * y };
      if (document.elementFromPoint(at.x, at.y) === canvas) return at;
    }
    return null;
  });
  assert.ok(start, "touch Saturn audit has an unobstructed drag origin");
  const dx = -Math.PI / (4 * 0.005);
  const dy = -2 * front.elevation / (4 * 0.004);
  for (let drag = 0; drag < 4; drag += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 0, x: start.x, y: start.y, radiusX: 4, radiusY: 4, force: 1 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ id: 0, x: start.x + dx, y: start.y + dy, radiusX: 4, radiusY: 4, force: 1 }],
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await settleCameraFrame(page);
  }
}

async function mouseSaturnHalfTurn(page, front) {
  const start = await page.evaluate(() => {
    const canvas = document.querySelector("#viewport");
    const box = canvas.getBoundingClientRect();
    for (const [x, y] of [[0.72, 0.55], [0.72, 0.42], [0.65, 0.5]]) {
      const at = { x: box.left + box.width * x, y: box.top + box.height * y };
      if (document.elementFromPoint(at.x, at.y) === canvas) return at;
    }
    return null;
  });
  assert.ok(start, "desktop Saturn audit has an unobstructed drag origin");
  const dx = -Math.PI / (4 * 0.005);
  const dy = -2 * front.elevation / (4 * 0.004);
  for (let drag = 0; drag < 4; drag += 1) {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + dx, start.y + dy, { steps: 2 });
    await page.mouse.up();
    await settleCameraFrame(page);
  }
}

async function auditSaturnRing(context, prefix = "desktop") {
  const page = await context.newPage();
  const errors = captureErrors(page);
  await openReady(page);
  if (await page.locator("#play-button").getAttribute("aria-pressed") === "true") {
    await page.locator("#play-button").click();
  }
  await page.evaluate(() => document.querySelector('[data-body-id="saturn"]').click());
  await settleCameraMotion(page);
  await page.locator("#card-close").click();
  if (prefix === "touch") await touchPinchZoomOut(context, page);
  const front = await findSaturnFrontSeat(page);
  assert.ok(front.saturnRing.viewLightDot >= 0.7, "front audit uses a strongly lit seat");
  assert.equal(front.saturnRing.emissiveIntensity, 0, "front view remains exactly unchanged");
  await saveScreenshot(page, `${prefix}-saturn-front-ring`);
  const frontCanvas = await saveCanvasOnlyScreenshot(page, `${prefix}-saturn-front-ring-canvas`);
  if (prefix === "touch") {
    const saturn = findBody("saturn");
    const horizontalHalfFov = Math.atan(
      page.viewportSize().width / page.viewportSize().height * Math.tan(52 * Math.PI / 360),
    );
    const ringAngularRadius = Math.asin(
      front.focusRadius * (saturn.ringOuterKm / saturn.radiusKm) / front.cameraDistance,
    );
    assert.ok(ringAngularRadius < horizontalHalfFov, "the complete Saturn ring fits in portrait");
    await touchSaturnHalfTurn(context, page, front);
  } else {
    await mouseSaturnHalfTurn(page, front);
  }
  const back = await currentCameraMetrics(page);
  assert.ok(antipodalOrbitError(front, back) < 0.04, "front/back Saturn seats are antipodal");
  assert.ok(back.saturnRing.viewLightDot <= -0.85, "back audit uses strong high phase");
  assert.ok(back.saturnRing.emissiveIntensity > 0);
  assert.ok(back.saturnRing.emissiveIntensity <= CONFIG.saturnRingHighPhaseLight);
  await saveScreenshot(page, `${prefix}-saturn-backlit-ring`);
  const backCanvas = await saveCanvasOnlyScreenshot(page, `${prefix}-saturn-backlit-ring-canvas`);
  const frontVisual = await saturnFrameMetrics(page, frontCanvas, front);
  const backVisual = await saturnFrameMetrics(page, backCanvas, back);
  assert.ok(backVisual.centerMean < frontVisual.centerMean, "Saturn's backlit globe stays dark");
  assert.ok(backVisual.ringMean < frontVisual.ringMean, "backlit rings stay dimmer than front-lit rings");
  assert.ok(backVisual.ringMean > backVisual.outsideMean, "backlit rings remain visible without a halo");
  assert.ok(
    backVisual.ringBrightCoverage > backVisual.outsideBrightCoverage,
    "bright pixels stay concentrated on the ring surface",
  );
  await assertSaturnRingTextureProfile(page);
  await pressCameraKey(page, "ArrowUp", 2);
  assert.ok((await currentCameraMetrics(page)).saturnRing.emissiveIntensity > 0);
  await saveScreenshot(page, `${prefix}-saturn-backlit-high`);
  await saveCanvasOnlyScreenshot(page, `${prefix}-saturn-backlit-high-canvas`);
  await pressCameraKey(page, "ArrowDown", 4);
  assert.ok((await currentCameraMetrics(page)).saturnRing.emissiveIntensity > 0);
  await saveScreenshot(page, `${prefix}-saturn-backlit-low`);
  await saveCanvasOnlyScreenshot(page, `${prefix}-saturn-backlit-low-canvas`);
  console.log(`${prefix} Saturn front/back metrics`, { frontVisual, backVisual });
  assert.deepEqual(errors, []);
  await page.close();
}

async function assertConstellationModesAndFreshLabels(page) {
  const select = page.locator("#sky-mode");
  const control = page.locator("#sky-control");
  const canvas = page.locator("#viewport");
  await page.locator("#reset-button").click();
  if (await page.locator("#play-button").getAttribute("aria-pressed") === "true") {
    await page.locator("#play-button").click();
  }
  // The preceding 20-body focus sweep leaves the camera easing from Ceres
  // back to the Sun. Let that intentional interpolation finish before using
  // byte-identical screenshots to lock the unchanged Major baseline.
  await page.waitForTimeout(2_500);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => {
    requestAnimationFrame(resolve);
  })));
  await control.waitFor();
  assert.equal(await select.inputValue(), "major");
  assert.equal(await select.isEnabled(), true);
  assert.equal(await select.getAttribute("aria-pressed"), null);
  const controlBox = await select.boundingBox();
  assert.ok(controlBox && controlBox.height >= 44, "constellation select keeps a 44px target");

  await page.evaluate(() => document.activeElement?.blur());
  const majorFrame = await stableCanvasFrame(page, canvas);
  await saveScreenshot(page, "desktop-constellations-major-initial");
  await select.selectOption("off");
  await page.waitForTimeout(50);
  const offFrame = await canvas.screenshot();
  await saveScreenshot(page, "desktop-constellations-off");
  assert.notEqual(digest(majorFrame), digest(offFrame), "Off hides figures and names");
  assert.equal(await page.locator("#status-live").textContent(), "Constellations off");

  await select.focus();
  await select.press("ArrowDown");
  assert.equal(await select.inputValue(), "major", "native keyboard selection reaches Major");
  await select.press("End");
  assert.equal(await select.inputValue(), "all", "native keyboard selection reaches All");
  await page.waitForTimeout(50);
  const allFrame = await canvas.screenshot();
  await saveScreenshot(page, "desktop-constellations-all");
  assert.notEqual(digest(allFrame), digest(offFrame), "All restores figures and names");
  assert.notEqual(digest(allFrame), digest(majorFrame), "All exposes more names than Major");

  const statusBeforeEscape = await page.locator("#status-live").textContent();
  await select.focus();
  await select.press("Escape");
  assert.equal(await select.inputValue(), "all", "Escape preserves the native selection");
  assert.equal(
    await page.locator("#status-live").textContent(),
    statusBeforeEscape,
    "Escape on the select does not invoke the global overview shortcut",
  );

  await select.selectOption("major");
  await page.waitForTimeout(50);
  await page.evaluate(() => document.activeElement?.blur());
  const restoredMajor = await stableCanvasFrame(page, canvas);
  await saveScreenshot(page, "desktop-constellations-major-restored");
  const restoredDifference = await frameDifferenceMetrics(page, majorFrame, restoredMajor);
  console.log(
    `Major restoration: mean-diff=${restoredDifference.meanAbsoluteDifference.toFixed(4)}, `
      + `strong=${(restoredDifference.strongCoverage * 100).toFixed(4)}%`,
  );
  assert.ok(
    restoredDifference.meanAbsoluteDifference <= 0.35,
    "Major restoration keeps the approved default canvas within subpixel variance",
  );
  assert.ok(
    restoredDifference.strongCoverage <= 0.003,
    "Major restoration cannot add, remove, or substantially move a label or figure",
  );

  // The strict fade > 0.04 boundary lies between these two distances. The
  // wheel handler must repaint hidden/disabled state synchronously, without
  // waiting for the next animation frame.
  await dispatchWheelZoom(page, CONFIG.cameraDistance, 2766);
  assert.equal(await control.isHidden(), false);
  assert.equal(await select.isEnabled(), true);
  await select.selectOption("all");
  await select.focus();
  await dispatchWheelZoom(page, 2766, 2767);
  const unavailable = await page.evaluate(() => ({
    hidden: document.querySelector("#sky-control").hidden,
    disabled: document.querySelector("#sky-mode").disabled,
    value: document.querySelector("#sky-mode").value,
    active: document.activeElement?.id,
  }));
  assert.deepEqual(unavailable, {
    hidden: true,
    disabled: true,
    value: "all",
    active: "viewport",
  });
  await dispatchWheelZoom(page, 2767, 2750);
  assert.equal(await control.isHidden(), false);
  assert.equal(await select.isEnabled(), true);
  assert.equal(await select.inputValue(), "all", "All preference returns after re-entry");
  await dispatchWheelZoom(page, 2750, CONFIG.handoffViewDistance);
  await page.locator("#reset-button").click();
  assert.equal(await select.inputValue(), "all", "Reset preserves the chosen mode");
  await select.selectOption("major");

  // A single wheel jump changes camera radius before one RAF. Both label
  // samples must already use that fresh matrix; the former bug moved only on
  // the second frame because projection lagged renderer.render().
  await page.waitForTimeout(600);
  const labelMotion = await page.evaluate((deltaY) => new Promise((resolve) => {
    const canvasElement = document.querySelector("#viewport");
    const label = [...document.querySelectorAll('.sky-label:not([hidden])')]
      .find((item) => item.dataset.bodyId !== "sun");
    if (!label) {
      resolve(null);
      return;
    }
    canvasElement.dispatchEvent(new WheelEvent("wheel", {
      deltaY,
      bubbles: true,
      cancelable: true,
    }));
    requestAnimationFrame(() => {
      const first = label.getBoundingClientRect();
      requestAnimationFrame(() => {
        const second = label.getBoundingClientRect();
        resolve({
          id: label.dataset.bodyId,
          first: { x: first.x, y: first.y },
          second: { x: second.x, y: second.y },
          visible: !label.hidden,
          firstSize: { width: first.width, height: first.height },
          secondSize: { width: second.width, height: second.height },
        });
      });
    });
  }), Math.log(1400 / CONFIG.cameraDistance) / 0.0016);
  assert.ok(labelMotion, "a non-Sun body label is visible for the lag regression");
  assert.equal(labelMotion.visible, true, `${labelMotion.id} remains visible after the wheel jump`);
  assert.ok(
    labelMotion.firstSize.width > 0 && labelMotion.firstSize.height > 0
      && labelMotion.secondSize.width > 0 && labelMotion.secondSize.height > 0,
    `${labelMotion.id} has real rendered boxes in both sampled frames`,
  );
  assert.ok(
    Math.hypot(
      labelMotion.second.x - labelMotion.first.x,
      labelMotion.second.y - labelMotion.first.y,
    ) <= 0.25,
    `${labelMotion.id} label uses the new camera matrix on the first frame`,
  );
  await page.locator("#reset-button").click();
}

async function auditSolarHandoff(context) {
  const page = await context.newPage();
  const errors = captureErrors(page);
  await openReady(page);
  if (await page.locator("#play-button").getAttribute("aria-pressed") === "true") {
    await page.locator("#play-button").click();
  }
  const blendStart = CONFIG.solarMaxDistance
    + (CONFIG.handoffViewDistance - CONFIG.solarMaxDistance) * 0.7;
  const stops = [
    { name: "desktop-solar-handoff-start", distance: blendStart },
    {
      name: "desktop-solar-handoff-mid",
      distance: blendStart + (CONFIG.handoffViewDistance - blendStart) * 0.5,
    },
    { name: "desktop-solar-handoff-end", distance: CONFIG.handoffViewDistance - 10 },
  ];
  let distance = CONFIG.cameraDistance;
  for (const stop of stops) {
    await zoomBetweenAuditDistances(page, distance, stop.distance);
    distance = stop.distance;
    await assertRenderedCanvas(page);
    await assertBodyLabelsHidden(page);
    await saveScreenshot(page, stop.name);
  }
  assert.deepEqual(errors, [], "Solar-to-Milky-Way handoff has no browser errors");
  await page.close();
}

async function auditScaleTransitions(context) {
  const page = await context.newPage();
  const errors = captureErrors(page);
  await openReady(page, "?look=virgo");
  if (await page.locator("#play-button").getAttribute("aria-pressed") === "true") {
    await page.locator("#play-button").click();
  }
  await page.waitForTimeout(350);

  const virgoToWeb = [0.15, 0.35, 0.55, 0.75, 0.92].map((fraction) => ({
    name: `desktop-transition-virgo-web-${String(Math.round(fraction * 100)).padStart(2, "0")}`,
    distance: CONFIG.virgoViewDistance
      + (CONFIG.webViewDistance - CONFIG.virgoViewDistance) * fraction,
  }));
  const webToUniverse = [
    0.15, 0.35, 0.55, 0.68, 0.7, 0.72, 0.74, 0.76,
    0.78, 0.8, 0.82, 0.85, 0.9, 0.95, 1.01,
  ].map((fraction) => ({
    name: `desktop-transition-web-universe-${String(Math.round(fraction * 100)).padStart(2, "0")}`,
    distance: CONFIG.webViewDistance
      + (CONFIG.universeViewDistance - CONFIG.webViewDistance) * fraction,
  }));
  const stops = [...virgoToWeb, ...webToUniverse];
  let distance = CONFIG.virgoViewDistance;
  const observations = [];

  for (let index = 0; index < stops.length; index += 1) {
    const stop = stops[index];
    await zoomBetweenAuditDistances(page, distance, stop.distance);
    distance = stop.distance;
    if (index === virgoToWeb.length) {
      await page.locator("#status-live")
        .filter({ hasText: "2MRS galaxy distribution" }).waitFor();
    }
    if (index === stops.length - 1) {
      await page.locator("#status-live")
        .filter({ hasText: "Schematic observable universe" }).waitFor();
    }
    await assertBodyLabelsHidden(page);
    const frame = await auditedCanvasFrame(
      page,
      stop.name,
      TRANSITION_MEAN_LUMINANCE_FLOOR,
      TRANSITION_BRIGHT_COVERAGE_FLOOR,
      { deferFloor: true },
    );
    observations.push({ name: stop.name, distance: stop.distance, ...frame.metrics });
  }

  assert.equal(observations.length, stops.length, "every transition distance is audited");
  for (const observation of observations) {
    assertFrameFloor(
      observation,
      observation.name,
      TRANSITION_MEAN_LUMINANCE_FLOOR,
      TRANSITION_BRIGHT_COVERAGE_FLOOR,
    );
  }
  for (let i = 1; i < observations.length; i += 1) {
    assert.ok(
      observations[i].meanLuminance >= observations[i - 1].meanLuminance * 0.45,
      `${observations[i].name} has no adjacent mean-luminance collapse`,
    );
    assert.ok(
      observations[i].brightCoverage >= observations[i - 1].brightCoverage * 0.35,
      `${observations[i].name} has no adjacent bright-coverage collapse`,
    );
  }
  const webObservations = observations.slice(virgoToWeb.length);
  const preCmbWeb = webObservations.filter((item) => cmbSkyOpacity(item.distance) === 0);
  assert.ok(preCmbWeb.length >= 3, "multiple mature-web frames precede the visible CMB");
  const firstStructuredWeb = preCmbWeb[0];
  const matureStructuredWeb = preCmbWeb.at(-1);
  assert.ok(
    matureStructuredWeb.meanLuminance >= firstStructuredWeb.meanLuminance,
    "the mature point-built web does not get darker before the CMB is visible",
  );
  assert.ok(
    matureStructuredWeb.brightEnergy >= firstStructuredWeb.brightEnergy * 1.05,
    "bright knots and filaments strengthen through the mature web",
  );
  for (const observation of preCmbWeb) {
    assert.ok(
      observation.darkCoverage >= 0.75,
      `${observation.name} preserves substantial black voids`,
    );
  }

  const firstPerceptibleCmbIndex = webObservations.findIndex(
    (item) => cmbSkyOpacity(item.distance) >= 0.01,
  );
  assert.ok(
    firstPerceptibleCmbIndex > 0,
    "the audit brackets the first perceptible CMB stage",
  );
  const beforeCmb = webObservations[firstPerceptibleCmbIndex - 1];
  const afterCmb = webObservations[firstPerceptibleCmbIndex];
  assert.ok(
    afterCmb.meanLuminance <= beforeCmb.meanLuminance * 1.8 + 1,
    "the first perceptible CMB stage cannot create a full-frame flash",
  );
  assert.ok(
    afterCmb.brightCoverage - beforeCmb.brightCoverage <= 0.35,
    "the first perceptible CMB stage cannot erase the voids in one audited step",
  );
  assert.ok(
    afterCmb.darkCoverage >= 0.55,
    "dark voids remain visible at the first perceptible CMB stage",
  );
  const emergingCmbWeb = webObservations.filter((item) => {
    const cmb = cmbSkyOpacity(item.distance);
    return cmb > 0 && cmb <= 0.05;
  });
  assert.ok(emergingCmbWeb.length >= 2, "multiple frames audit the emerging CMB");
  for (const observation of emergingCmbWeb) {
    assert.ok(
      observation.darkCoverage >= 0.55,
      `${observation.name} retains voids while the CMB is still emerging`,
    );
    assert.ok(
      observation.brightCoverage <= 0.45,
      `${observation.name} cannot become a full-field veil while the CMB is still emerging`,
    );
  }

  const earlyMean = webObservations.slice(0, 3)
    .reduce((total, item) => total + item.meanLuminance, 0) / 3;
  const lateMean = webObservations.slice(-3)
    .reduce((total, item) => total + item.meanLuminance, 0) / 3;
  assert.ok(
    lateMean >= earlyMean * 0.85,
    "the observable-universe approach remains at least as legible as the early outer web",
  );
  assert.deepEqual(errors, [], "continuous Virgo-to-universe zoom has no browser errors");
  await page.close();
}

async function dragCamera(page, deltaX, deltaY) {
  const start = await page.evaluate(({ deltaX: dx, deltaY: dy }) => {
    const viewport = document.querySelector("#viewport");
    const box = viewport.getBoundingClientRect();
    const x = box.left + box.width / 2 - dx / 2;
    const y = box.top + box.height / 2 - dy / 2;
    const endX = x + dx;
    const endY = y + dy;
    const inset = 24;
    if (
      x <= box.left + inset || x >= box.right - inset
      || y <= box.top + inset || y >= box.bottom - inset
      || endX <= box.left + inset || endX >= box.right - inset
      || endY <= box.top + inset || endY >= box.bottom - inset
      || document.elementFromPoint(x, y) !== viewport
      || document.elementFromPoint(endX, endY) !== viewport
    ) return null;
    return { x, y };
  }, { deltaX, deltaY });
  assert.ok(start, "far-sky audit drag remains on unobstructed canvas");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + deltaX, start.y + deltaY, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

async function auditFarSkyDirections(context) {
  const page = await context.newPage();
  const errors = captureErrors(page);
  // Virgo keeps the spherical far-density layer fully opaque. Per-view floors
  // and side tiles exercise the rendered backdrop, while the pure spherical-
  // cap unit test isolates its angular distribution from named foregrounds.
  await openReady(page, "?look=virgo");
  if (await page.locator("#play-button").getAttribute("aria-pressed") === "true") {
    await page.locator("#play-button").click();
  }
  await page.waitForTimeout(350);

  const forward = await auditedCanvasFrame(
    page,
    "desktop-far-sky-forward",
    FAR_SKY_MEAN_LUMINANCE_FLOOR,
    FAR_SKY_BRIGHT_COVERAGE_FLOOR,
  );
  await dragCamera(page, -300, 0);
  const quarterYaw = await auditedCanvasFrame(
    page,
    "desktop-far-sky-yaw-quarter",
    FAR_SKY_MEAN_LUMINANCE_FLOOR,
    FAR_SKY_BRIGHT_COVERAGE_FLOOR,
  );
  await dragCamera(page, -300, 0);
  const yaw = await auditedCanvasFrame(
    page,
    "desktop-far-sky-yaw-180",
    FAR_SKY_MEAN_LUMINANCE_FLOOR,
    FAR_SKY_BRIGHT_COVERAGE_FLOOR,
  );
  assert.notEqual(
    digest(forward.png),
    digest(quarterYaw.png),
    "far sky changes across a quarter-turn yaw",
  );
  assert.notEqual(digest(forward.png), digest(yaw.png), "far sky changes across a half-turn yaw");

  await dragCamera(page, 0, 300);
  await dragCamera(page, 0, 300);
  const high = await auditedCanvasFrame(
    page,
    "desktop-far-sky-pitch-high",
    FAR_SKY_MEAN_LUMINANCE_FLOOR,
    FAR_SKY_BRIGHT_COVERAGE_FLOOR,
  );
  await dragCamera(page, 0, -300);
  await dragCamera(page, 0, -300);
  await dragCamera(page, 0, -300);
  await dragCamera(page, 0, -300);
  const low = await auditedCanvasFrame(
    page,
    "desktop-far-sky-pitch-low",
    FAR_SKY_MEAN_LUMINANCE_FLOOR,
    FAR_SKY_BRIGHT_COVERAGE_FLOOR,
  );
  assert.notEqual(digest(high.png), digest(low.png), "far sky changes between pitch extremes");
  await dragCamera(page, 260, 220);
  const diagonal = await auditedCanvasFrame(
    page,
    "desktop-far-sky-diagonal",
    FAR_SKY_MEAN_LUMINANCE_FLOOR,
    FAR_SKY_BRIGHT_COVERAGE_FLOOR,
  );
  assert.notEqual(digest(low.png), digest(diagonal.png), "far sky changes toward a spherical diagonal");
  const directionMetrics = [forward, quarterYaw, yaw, high, low, diagonal]
    .map((frame) => frame.metrics);
  const means = directionMetrics.map((metrics) => metrics.meanLuminance);
  assert.ok(
    Math.max(...means) / Math.min(...means) < 2.5,
    "equal-angle far-sky views have no cube-corner density spike",
  );
  assert.ok(
    directionMetrics.every((metrics) => metrics.darkCoverage > 0.7),
    "the distant density preserves dark voids in every audited direction",
  );
  assert.deepEqual(errors, [], "far-sky yaw and pitch audit has no browser errors");
  await page.close();
}

async function auditResponsiveCosmology(context, prefix) {
  for (const look of ["localgroup", "virgo", "web", "universe"]) {
    const page = await context.newPage();
    const errors = captureErrors(page);
    await openReady(page, `?look=${look}`);
    await assertRenderedCanvas(page);
    assert.equal(await page.getAttribute("html", "data-galaxy-ready"), "1");
    await assertBodyLabelsHidden(page);
    await page.waitForTimeout(250);
    if (look === "web" || look === "universe") {
      await auditedCanvasFrame(
        page,
        `${prefix}-${look}`,
        TRANSITION_MEAN_LUMINANCE_FLOOR,
        TRANSITION_BRIGHT_COVERAGE_FLOOR,
      );
    } else {
      await saveScreenshot(page, `${prefix}-${look}`);
    }
    if (look === "universe") {
      await settleCameraMotion(page);
      const fit = await page.evaluate(async () => {
        const app = await import(new URL("./js/app.js", location.href).href);
        const galaxy = await import(new URL("./js/galaxy.js", location.href).href);
        const metrics = app.currentCameraMetrics();
        const halfFov = 52 * Math.PI / 360;
        const limiting = Math.min(halfFov, Math.atan(innerWidth / innerHeight * Math.tan(halfFov)));
        return {
          angularRadius: Math.asin(galaxy.farthestUniverseDistance() / metrics.cameraDistance),
          limiting,
        };
      });
      assert.ok(fit.angularRadius <= fit.limiting + 1e-6, `${prefix} contains the complete CMB sphere`);
      if (prefix === "touch-portrait") {
        const before = await currentCameraMetrics(page);
        await page.locator("#zoom-out-button").click();
        await page.locator("#zoom-out-button").click();
        await settleCameraFrame(page);
        const after = await currentCameraMetrics(page);
        assert.ok(after.controlDistance > before.controlDistance, "portrait zoom continues past the fit seat");
        assert.ok(Math.abs(
          (after.cameraDistance - before.cameraDistance)
            - (after.controlDistance - before.controlDistance)
        ) < 1e-4, "post-fit portrait camera retains one-to-one motion");
        await saveScreenshot(page, "touch-portrait-universe-max-zoom-out");
      }
    }
    assert.deepEqual(errors, [], `${prefix} ${look} has no browser errors`);
    await page.close();
  }
}

async function orbitCameraHalfTurn(page) {
  const box = await page.locator("#viewport").boundingBox();
  assert.ok(box);
  const y = box.y + box.height * 0.55;
  await page.mouse.move(box.x + box.width * 0.28, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.72, y, { steps: 8 });
  await page.mouse.up();
}

async function assertBodySelectionSweep(page) {
  const bodies = await page.locator(".sky-label").evaluateAll((labels) => (
    labels.map((label) => ({ id: label.dataset.bodyId, name: label.textContent }))
  ));
  assert.equal(bodies.length, 20, "the browser exposes exactly the v1 body set");

  for (const body of bodies) {
    await page.evaluate((id) => document.querySelector(`[data-body-id="${id}"]`).click(), body.id);
    await page.locator("#body-card:not([hidden])").waitFor();
    assert.equal(await page.locator("#card-name").textContent(), body.name);
    assert.ok((await page.locator("#card-meta").textContent()).length > 20);
  }
  await assertRenderedCanvas(page);
  await page.locator("#reset-button").click();
}

async function assertZoomStress(page) {
  const canvas = page.locator("#viewport");
  const bounds = await canvas.boundingBox();
  assert.ok(bounds);
  const moveToCanvas = async () => {
    const point = await page.evaluate(() => {
      const viewport = document.querySelector("#viewport");
      const box = viewport.getBoundingClientRect();
      const candidates = [
        [0.92, 0.5], [0.08, 0.5], [0.82, 0.7], [0.18, 0.7],
        [0.82, 0.3], [0.18, 0.3], [0.5, 0.45],
      ];
      for (const [x, y] of candidates) {
        const clientX = box.left + box.width * x;
        const clientY = box.top + box.height * y;
        if (document.elementFromPoint(clientX, clientY) === viewport) {
          return { x: clientX, y: clientY };
        }
      }
      return null;
    });
    assert.ok(point, "an unobstructed canvas point is available for wheel input");
    await page.mouse.move(point.x, point.y);
  };
  const wheelFourSteps = async (deltaY) => {
    for (let step = 0; step < 4; step += 1) {
      await page.mouse.wheel(0, deltaY);
      await page.waitForTimeout(40);
    }
  };
  await moveToCanvas();
  await canvas.focus();

  // Enter the measured-volume layer through the real wheel path so its
  // transition announcement remains observable after boot's ready message.
  await wheelFourSteps(1_000);
  await page.locator("#status-live").filter({ hasText: "2MRS galaxy distribution" }).waitFor();
  await assertBodyLabelsHidden(page);
  await wheelFourSteps(-1_000);
  await page.locator("#sky-control:not([hidden])").waitFor();

  for (let cycle = 0; cycle < 3; cycle += 1) {
    await page.locator("#reset-button").click();
    await moveToCanvas();
    await canvas.focus();
    await wheelFourSteps(1_000);
    try {
      await page.waitForFunction(
        () => document.documentElement.dataset.galaxyReady === "1"
          && document.querySelector("#sky-control").hidden
          && [...document.querySelectorAll(".sky-label")].every((label) => label.hidden),
        null,
        { timeout: 5_000 },
      );
    } catch (error) {
      const state = await page.evaluate(() => ({
        galaxyReady: document.documentElement.dataset.galaxyReady,
        skyHidden: document.querySelector("#sky-control").hidden,
        labelCount: document.querySelectorAll(".sky-label").length,
        visibleLabels: [...document.querySelectorAll(".sky-label")]
          .filter((label) => !label.hidden).map((label) => label.textContent),
        status: document.querySelector("#status-live").textContent,
      }));
      assert.fail(`zoom stress cycle ${cycle + 1}: ${JSON.stringify(state)} (${error.message})`);
    }
    await assertBodyLabelsHidden(page);
    await wheelFourSteps(-1_000);
    await page.locator("#sky-control:not([hidden])").waitFor();
  }
}

async function saveTritonScreenshot(page, name) {
  await page.waitForFunction(() => {
    const label = document.querySelector('.sky-label[data-body-id="triton"]');
    if (!label || label.hidden) return false;
    const box = label.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth
      && box.top >= 0 && box.bottom + 72 <= innerHeight;
  }, null, { timeout: 4_000 });
  const viewport = page.viewportSize();
  const label = await page.locator('.sky-label[data-body-id="triton"]').boundingBox();
  assert.ok(viewport);
  assert.ok(label);
  const cropSize = Math.min(360, viewport.width, viewport.height);
  const centerX = label.x + label.width / 2;
  const centerY = label.y + label.height + 32;
  const crop = {
    x: Math.max(0, Math.min(viewport.width - cropSize, centerX - cropSize / 2)),
    y: Math.max(0, Math.min(viewport.height - cropSize, centerY - cropSize / 2)),
    width: cropSize,
    height: cropSize,
  };
  await saveScreenshot(page, name, { clip: crop });
}

async function captureTriton(page) {
  if (!screenshotDir) return;
  await page.locator("#reset-button").click();
  if (await page.locator("#play-button").getAttribute("aria-pressed") === "true") {
    await page.locator("#play-button").click();
  }
  await page.evaluate(() => document.querySelector('[data-body-id="triton"]').click());
  await page.waitForTimeout(1_500);
  await page.locator("#card-close").click();
  await orbitCameraHalfTurn(page);
  await page.mouse.wheel(0, -1_200);
  await page.waitForTimeout(500);
  await saveTritonScreenshot(page, "triton-rotation-a");
  await page.locator("#speed-slider").evaluate((slider, { minimum, maximum, target }) => {
    slider.value = String((Math.log(target) - Math.log(minimum))
      / (Math.log(maximum) - Math.log(minimum)));
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  }, {
    minimum: CONFIG.minDaysPerSecond,
    maximum: CONFIG.maxDaysPerSecond,
    target: 5.876994,
  });
  await page.locator("#play-button").click();
  await page.waitForTimeout(500);
  await page.locator("#play-button").click();
  await page.waitForTimeout(1_500);
  await saveTritonScreenshot(page, "triton-rotation-b");
}

async function orientEarthPole(page, southPole) {
  const basis = bodyOrientationBasis(findBody("earth"));
  const north = equatorialVectorToScene(basis.zAxis);
  const direction = southPole ? -1 : 1;
  const pole = {
    x: north.x * direction,
    y: north.y * direction,
    z: north.z * direction,
  };
  const targetAzimuth = Math.atan2(pole.x, pole.z);
  const targetElevation = Math.asin(pole.y);
  const delta = {
    x: (CONFIG.cameraAzimuth - targetAzimuth) / 0.005,
    y: (targetElevation - CONFIG.cameraElevation) / 0.004,
  };
  const start = await page.evaluate(({ x, y }) => {
    const viewport = document.querySelector("#viewport");
    const box = viewport.getBoundingClientRect();
    const base = {
      x: box.left + box.width / 2 - x / 2,
      y: box.top + box.height / 2 - y / 2,
    };
    for (const [ox, oy] of [[0, 0], [-120, 0], [120, 0], [0, -90], [0, 90]]) {
      const sx = base.x + ox;
      const sy = base.y + oy;
      const ex = sx + x;
      const ey = sy + y;
      const inside = sx > box.left + 20 && sx < box.right - 20
        && sy > box.top + 20 && sy < box.bottom - 20
        && ex > box.left + 20 && ex < box.right - 20
        && ey > box.top + 20 && ey < box.bottom - 20;
      if (inside && document.elementFromPoint(sx, sy) === viewport) return { x: sx, y: sy };
    }
    return null;
  }, delta);
  assert.ok(start, "Earth pole audit starts on unobstructed canvas");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 12 });
  await page.mouse.up();
  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(500);
}

async function captureEarthSolstice(context, name, targetDate, southPole = false) {
  if (!screenshotDir) return;
  const page = await context.newPage();
  const errors = captureErrors(page);
  await openReady(page);
  if (await page.locator("#play-button").getAttribute("aria-pressed") === "true") {
    await page.locator("#play-button").click();
  }
  await page.evaluate(() => document.querySelector('[data-body-id="earth"]').click());
  await page.locator("#body-card:not([hidden])").waitFor();
  const setSpeed = (target) => page.locator("#speed-slider").evaluate((slider, options) => {
    slider.value = String((Math.log(options.target) - Math.log(options.minimum))
      / (Math.log(options.maximum) - Math.log(options.minimum)));
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  }, {
    target,
    minimum: CONFIG.minDaysPerSecond,
    maximum: CONFIG.maxDaysPerSecond,
  });
  const approachDate = new Date(
    Date.parse(`${targetDate}T00:00:00Z`) - 75 * 86_400_000,
  ).toISOString().slice(0, 10);
  const pauseAtDate = (date, timeout) => page.waitForFunction((target) => {
    if (document.querySelector("#clock").textContent < target) return false;
    const play = document.querySelector("#play-button");
    if (play.getAttribute("aria-pressed") === "true") play.click();
    return true;
  }, date, { timeout });
  await setSpeed(10);
  await page.locator("#play-button").click();
  await pauseAtDate(approachDate, 60_000);
  await setSpeed(1);
  await page.locator("#play-button").click();
  await pauseAtDate(targetDate, 90_000);
  await page.waitForTimeout(350);

  const observedDate = await page.locator("#clock").textContent();
  const overshootDays = (Date.parse(`${observedDate}T00:00:00Z`)
    - Date.parse(`${targetDate}T00:00:00Z`)) / 86_400_000;
  assert.ok(
    overshootDays >= 0 && overshootDays <= 5,
    `${name} captured ${observedDate}, near ${targetDate}`,
  );

  await orientEarthPole(page, southPole);
  await saveScreenshot(page, name);
  assert.deepEqual(errors, []);
  await page.close();
}

async function assertCardClearsDock(page, viewport) {
  await page.setViewportSize(viewport);
  await page.locator("#reset-button").click();
  await page.evaluate(() => document.querySelector('[data-body-id="earth"]').click());
  await page.locator("#body-card:not([hidden])").waitFor();
  await page.waitForTimeout(100);
  const layout = await page.evaluate(() => {
    const card = document.querySelector("#body-card").getBoundingClientRect();
    const dock = document.querySelector("#dock").getBoundingClientRect();
    const credits = document.querySelector("#version-label").getBoundingClientRect();
    const topbar = document.querySelector("#stage .topbar").getBoundingClientRect();
    const overlaps = card.left < dock.right
      && card.right > dock.left
      && card.top < dock.bottom
      && card.bottom > dock.top;
    const creditsOverlap = card.left < credits.right
      && card.right > credits.left
      && card.top < credits.bottom
      && card.bottom > credits.top;
    const topbarOverlap = card.left < topbar.right
      && card.right > topbar.left
      && card.top < topbar.bottom
      && card.bottom > topbar.top;
    const helpersInside = [...document.querySelectorAll(".helper-toggles button")]
      .every((button) => {
        const box = button.getBoundingClientRect();
        return box.top >= card.top && box.bottom <= card.bottom;
      });
    const creditsHit = document.elementFromPoint(
      credits.left + credits.width / 2,
      credits.top + credits.height / 2,
    );
    return {
      card: { top: card.top, right: card.right, bottom: card.bottom, left: card.left },
      dock: { top: dock.top, right: dock.right, bottom: dock.bottom, left: dock.left },
      overlaps,
      creditsOverlap,
      topbarOverlap,
      helpersInside,
      cardClientHeight: document.querySelector("#body-card").clientHeight,
      cardScrollHeight: document.querySelector("#body-card").scrollHeight,
      creditsHit: creditsHit?.id,
      clearance: Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--dock-clearance"),
      ),
      dockHeight: dock.height,
      speedOverflow: getComputedStyle(document.querySelector(".speed-group")).overflow,
    };
  });
  assert.equal(layout.overlaps, false, `${viewport.width}x${viewport.height} card clears dock`);
  assert.equal(
    layout.creditsOverlap,
    false,
    `${viewport.width}x${viewport.height} card clears credits`,
  );
  assert.equal(
    layout.topbarOverlap,
    false,
    `${viewport.width}x${viewport.height} card clears the title and date`,
  );
  assert.equal(
    layout.helpersInside,
    true,
    `${viewport.width}x${viewport.height} keeps every helper control inside the card`,
  );
  assert.ok(
    layout.cardScrollHeight <= layout.cardClientHeight + 1,
    `${viewport.width}x${viewport.height} card content is not vertically clipped`,
  );
  assert.equal(
    layout.creditsHit,
    "version-label",
    `${viewport.width}x${viewport.height} credits stay hit-testable with a card open`,
  );
  assert.ok(layout.card.top >= 0 && layout.card.bottom <= viewport.height + 1);
  assert.ok(Math.abs(layout.clearance - Math.ceil(layout.dockHeight)) <= 1);
  assert.equal(layout.speedOverflow, "visible");
}

async function assertCreditsClearDock(page, viewport) {
  await page.setViewportSize(viewport);
  await page.locator("#reset-button").click();
  await page.waitForTimeout(100);
  const layout = await page.evaluate(() => {
    const credits = document.querySelector("#version-label");
    const dock = document.querySelector("#dock");
    const creditsBox = credits.getBoundingClientRect();
    const dockBox = dock.getBoundingClientRect();
    const overlaps = creditsBox.left < dockBox.right
      && creditsBox.right > dockBox.left
      && creditsBox.top < dockBox.bottom
      && creditsBox.bottom > dockBox.top;
    const hit = document.elementFromPoint(
      creditsBox.left + creditsBox.width / 2,
      creditsBox.top + creditsBox.height / 2,
    );
    return {
      width: creditsBox.width,
      height: creditsBox.height,
      overlaps,
      hit: hit?.id,
    };
  });
  assert.ok(layout.width >= 44 && layout.height >= 44);
  assert.equal(layout.overlaps, false, `${viewport.width}px credits clear dock`);
  assert.equal(layout.hit, "version-label", `${viewport.width}px credits remain hit-testable`);
}

try {
  const [line] = await Promise.race([
    once(child.stdout, "data"),
    once(child, "exit").then(([code]) => {
      throw new Error(`server exited ${code}`);
    }),
  ]);
  assert.match(String(line), /Helios local server/);

  browser = await launchBrowser();

  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await assertColdGalaxyZoomDoesNotBlock(desktop);
  const desktopPage = await desktop.newPage();
  const desktopErrors = captureErrors(desktopPage);
  await openReady(desktopPage);
  assert.equal(await desktopPage.getAttribute("html", "data-galaxy-ready"), null);
  await assertRenderedCanvas(desktopPage);
  await assertPreparedZoomLatency(desktopPage);

  await desktopPage.locator("#play-button").click();
  const canvas = desktopPage.locator("#viewport");
  const beforeDrag = await canvas.screenshot();
  const bounds = await canvas.boundingBox();
  assert.ok(bounds);
  await desktopPage.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5);
  await desktopPage.mouse.down();
  await desktopPage.mouse.move(
    bounds.x + bounds.width * 0.62,
    bounds.y + bounds.height * 0.57,
    { steps: 5 },
  );
  await desktopPage.mouse.up();
  await desktopPage.waitForTimeout(100);
  const afterDrag = await canvas.screenshot();
  assert.notEqual(digest(beforeDrag), digest(afterDrag), "pointer drag changes the rendered view");

  await desktopPage.locator("#reset-button").click();
  const earth = desktopPage.locator('[data-body-id="earth"]');
  await earth.click();
  await desktopPage.locator("#body-card:not([hidden])").waitFor();
  assert.equal(await desktopPage.locator("#card-name").textContent(), "Earth");
  await desktopPage.locator("#reset-button").click();
  assert.equal(await desktopPage.locator("#body-card").getAttribute("hidden"), "");
  await assertCameraControlsAndSunBoundary(desktopPage);
  await assertBodyLabelCollisionsSuppressed(desktopPage);
  await assertPausedRenderInvalidation(desktopPage);

  await assertBodySelectionSweep(desktopPage);
  await assertConstellationModesAndFreshLabels(desktopPage);
  await assertZoomStress(desktopPage);

  const play = desktopPage.locator("#play-button");
  const playingBeforeSpace = await play.getAttribute("aria-pressed");
  await play.focus();
  await play.press("Space");
  assert.notEqual(
    await play.getAttribute("aria-pressed"),
    playingBeforeSpace,
    "native Space activation toggles play exactly once",
  );
  await saveScreenshot(desktopPage, "desktop-overview");
  await captureTriton(desktopPage);
  assert.deepEqual(desktopErrors, []);
  await desktopPage.close();

  const directLooks = [
    "sky",
    "solarfar",
    "tailsky",
    "growing",
    "disk",
    "milkyway",
    "mwedge",
    "mwbelow",
    "neighborhood",
    "localgroup",
    "virgo",
    "preweb",
    "web",
    "universe",
  ];
  for (const look of directLooks) {
    const directPage = await desktop.newPage();
    const directErrors = captureErrors(directPage);
    await openReady(directPage, `?look=${look}`);
    await assertRenderedCanvas(directPage);
    if (look === "sky") {
      assert.equal(await directPage.locator("#card-name").textContent(), "Earth");
    } else if (look === "solarfar") {
      assert.equal(await directPage.getAttribute("html", "data-galaxy-ready"), null);
    } else {
      assert.equal(await directPage.getAttribute("html", "data-galaxy-ready"), "1");
      await assertBodyLabelsHidden(directPage);
    }
    await directPage.waitForTimeout(250);
    await saveScreenshot(directPage, `desktop-${look}`);
    if (look === "universe") await assertCmbTextureVisible(directPage);
    assert.deepEqual(directErrors, [], `${look} has no browser errors`);
    await directPage.close();
  }
  await auditSolarHandoff(desktop);
  await auditScaleTransitions(desktop);
  await auditFarSkyDirections(desktop);
  await auditSaturnRing(desktop);
  await captureEarthSolstice(desktop, "earth-june-solstice", "2000-06-21");
  await captureEarthSolstice(desktop, "earth-december-solstice", "2000-12-21", true);
  await desktop.close();

  const touch = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  const touchPage = await touch.newPage();
  const touchErrors = captureErrors(touchPage);
  await openReady(touchPage);
  await assertRenderedCanvas(touchPage);
  const credits = touchPage.locator("#version-label");
  await credits.waitFor();
  assert.equal(await credits.getAttribute("href"), "./PROVENANCE.md");
  const touchSky = touchPage.locator("#sky-mode");
  await touchSky.selectOption("all");
  assert.equal(await touchSky.inputValue(), "all", "touch context selects All natively");
  assert.equal(await touchPage.locator("#status-live").textContent(), "Constellations all");
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 568, height: 320 },
    { width: 844, height: 390 },
  ]) {
    await assertCardClearsDock(touchPage, viewport);
    assert.equal(await touchPage.locator("#sky-control").isHidden(), false);
    assert.equal(await touchSky.isEnabled(), true);
    assert.equal(await touchSky.inputValue(), "all");
  }
  await touchPage.locator("#reset-button").click();
  await touchPage.setViewportSize({ width: 390, height: 844 });

  const cdp = await touch.newCDPSession(touchPage);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { id: 0, x: 70, y: 320, radiusX: 4, radiusY: 4, force: 1 },
      { id: 1, x: 320, y: 320, radiusX: 4, radiusY: 4, force: 1 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { id: 0, x: 165, y: 320, radiusX: 4, radiusY: 4, force: 1 },
      { id: 1, x: 225, y: 320, radiusX: 4, radiusY: 4, force: 1 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await touchPage.waitForFunction(
    () => document.documentElement.dataset.galaxyReady === "1"
      && document.querySelector("#sky-control").hidden,
  );
  assert.equal(await touchSky.inputValue(), "all", "touch preference survives sky unavailability");
  assert.equal(await touchSky.isEnabled(), false, "unavailable touch control is disabled");
  await assertBodyLabelsHidden(touchPage);

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 568, height: 320 },
    { width: 844, height: 390 },
  ]) {
    await assertCardClearsDock(touchPage, viewport);
  }
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 844, height: 390 },
    { width: 1024, height: 768 },
  ]) {
    await assertCreditsClearDock(touchPage, viewport);
  }
  await assertCardClearsDock(touchPage, { width: 390, height: 844 });
  await saveScreenshot(touchPage, "touch-card");
  await assertCardClearsDock(touchPage, { width: 568, height: 320 });
  await saveScreenshot(touchPage, "touch-landscape-card");
  assert.deepEqual(touchErrors, []);
  await auditSaturnRing(touch, "touch");
  await auditResponsiveCosmology(touch, "touch-portrait");
  await touch.close();

  const compactLandscape = await browser.newContext({
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  await auditResponsiveCosmology(compactLandscape, "touch-landscape");
  await compactLandscape.close();

  const failure = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const failurePage = await failure.newPage();
  await failurePage.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...args) {
      if (["webgl", "webgl2", "experimental-webgl"].includes(type)) return null;
      return original.call(this, type, ...args);
    };
  });
  await failurePage.goto(base, { waitUntil: "networkidle" });
  await failurePage.locator("#unsupported:not([hidden])").waitFor();
  const failureState = await failurePage.evaluate(() => {
    const visibleFocusable = [...document.querySelectorAll("a, button, input, select, [tabindex]")]
      .filter((element) => !element.hidden && element.getClientRects().length > 0)
      .map((element) => element.id);
    const stage = document.querySelector("#stage");
    const unsupported = document.querySelector("#unsupported");
    return {
      active: document.activeElement?.id,
      role: unsupported.getAttribute("role"),
      stageHidden: stage.hidden,
      stageInert: stage.inert,
      visibleFocusable,
    };
  });
  assert.deepEqual(failureState, {
    active: "unsupported",
    role: "alert",
    stageHidden: true,
    stageInert: true,
    visibleFocusable: ["unsupported"],
  });
  await saveScreenshot(failurePage, "webgl-fallback");
  await failure.close();

  console.log("browser-smoke ok");
} finally {
  if (browser) await browser.close();
  child.kill("SIGTERM");
}
