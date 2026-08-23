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
import { equatorialVectorToScene } from "../js/sky.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.BROWSER_SMOKE_PORT || 4175);
const base = `http://127.0.0.1:${port}/Helios/`;
const screenshotDir = process.env.HELIOS_SCREENSHOT_DIR;
const BRIGHT_LUMINANCE = 12;
const TRANSITION_MEAN_LUMINANCE_FLOOR = 5.5;
const TRANSITION_BRIGHT_COVERAGE_FLOOR = 0.006;
const FAR_SKY_MEAN_LUMINANCE_FLOOR = 4.5;
const FAR_SKY_BRIGHT_COVERAGE_FLOOR = 0.002;
const child = spawn(process.execPath, ["tests/serve.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});

let browser;

function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
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

async function distributedFrameMetrics(page, png) {
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

    // Distributed off-center tiles exclude the camera-attached hierarchy
    // titles. A white title therefore cannot make an otherwise black web pass.
    const regions = [
      { name: "lower-left", x: 0.05, y: 0.56, width: 0.38, height: 0.26 },
      { name: "lower-right", x: 0.57, y: 0.56, width: 0.38, height: 0.26 },
    ];
    let luminanceTotal = 0;
    let bright = 0;
    let samples = 0;
    const regionMetrics = [];

    for (const region of regions) {
      const x = Math.floor(surface.width * region.x);
      const y = Math.floor(surface.height * region.y);
      const width = Math.max(1, Math.floor(surface.width * region.width));
      const height = Math.max(1, Math.floor(surface.height * region.height));
      const pixels = context.getImageData(x, y, width, height).data;
      let regionLuminance = 0;
      let regionBright = 0;
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
          if (luminance >= brightLuminance) regionBright += 1;
          regionSamples += 1;
        }
      }
      luminanceTotal += regionLuminance;
      bright += regionBright;
      samples += regionSamples;
      regionMetrics.push({
        name: region.name,
        meanLuminance: regionLuminance / regionSamples,
        brightCoverage: regionBright / regionSamples,
      });
    }

    return {
      meanLuminance: luminanceTotal / samples,
      brightCoverage: bright / samples,
      samples,
      regions: regionMetrics,
    };
  }, {
    source: png.toString("base64"),
    brightLuminance: BRIGHT_LUMINANCE,
  });
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
      + `coverage=${(metrics.brightCoverage * 100).toFixed(3)}%, `
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
    observations.push({ name: stop.name, ...frame.metrics });
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
  await openReady(page, "?look=growing");
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
  assert.notEqual(digest(low.png), digest(diagonal.png), "far sky changes toward a cube corner");
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
  await page.locator("#sky-button:not([hidden])").waitFor();

  for (let cycle = 0; cycle < 3; cycle += 1) {
    await page.locator("#reset-button").click();
    await moveToCanvas();
    await canvas.focus();
    await wheelFourSteps(1_000);
    try {
      await page.waitForFunction(
        () => document.documentElement.dataset.galaxyReady === "1"
          && document.querySelector("#sky-button").hidden
          && [...document.querySelectorAll(".sky-label")].every((label) => label.hidden),
        null,
        { timeout: 5_000 },
      );
    } catch (error) {
      const state = await page.evaluate(() => ({
        galaxyReady: document.documentElement.dataset.galaxyReady,
        skyHidden: document.querySelector("#sky-button").hidden,
        labelCount: document.querySelectorAll(".sky-label").length,
        visibleLabels: [...document.querySelectorAll(".sky-label")]
          .filter((label) => !label.hidden).map((label) => label.textContent),
        status: document.querySelector("#status-live").textContent,
      }));
      assert.fail(`zoom stress cycle ${cycle + 1}: ${JSON.stringify(state)} (${error.message})`);
    }
    await assertBodyLabelsHidden(page);
    await wheelFourSteps(-1_000);
    await page.locator("#sky-button:not([hidden])").waitFor();
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
  await page.locator("#speed-slider").evaluate((slider) => {
    const minimum = 1 / 24;
    const maximum = 400;
    const target = 5.876994;
    slider.value = String((Math.log(target) - Math.log(minimum))
      / (Math.log(maximum) - Math.log(minimum)));
    slider.dispatchEvent(new Event("input", { bubbles: true }));
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
  const setSpeed = (target) => page.locator("#speed-slider").evaluate((slider, daysPerSecond) => {
    const minimum = 1 / 24;
    const maximum = 400;
    slider.value = String((Math.log(daysPerSecond) - Math.log(minimum))
      / (Math.log(maximum) - Math.log(minimum)));
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  }, target);
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
  const desktopPage = await desktop.newPage();
  const desktopErrors = captureErrors(desktopPage);
  await openReady(desktopPage);
  assert.equal(await desktopPage.getAttribute("html", "data-galaxy-ready"), null);
  await assertRenderedCanvas(desktopPage);

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

  await assertBodySelectionSweep(desktopPage);
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
    assert.deepEqual(directErrors, [], `${look} has no browser errors`);
    await directPage.close();
  }
  await auditScaleTransitions(desktop);
  await auditFarSkyDirections(desktop);
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
      && document.querySelector("#sky-button").hidden,
  );
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
    const visibleFocusable = [...document.querySelectorAll("a, button, input, [tabindex]")]
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
