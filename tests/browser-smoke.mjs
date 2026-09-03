import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { bodyOrientationBasis, findBody, keplerOffset, moonOrbitAttachment } from "../js/bodies.js";
import { CONFIG, wheelZoomMultiplier } from "../js/config.js";
import { cmbSkyOpacity, sceneHierarchyId } from "../js/galaxy.js";
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

const LOOK_SEMANTICS = {
  sky: { layer: /Earth sky/, focus: /Focused on Earth/ },
  solarfar: { layer: /Solar system/, focus: /Focused on the Sun/ },
  tailsky: { layer: /Milky Way/ },
  growing: { layer: /Milky Way/ },
  disk: { layer: /Milky Way/ },
  milkyway: { layer: /Milky Way/ },
  mwedge: { layer: /Milky Way/ },
  mwbelow: { layer: /Milky Way/ },
  neighborhood: { layer: /Nearby galaxies/ },
  localgroup: { layer: /Local Group/ },
  virgo: { layer: /Virgo Cluster/ },
  preweb: { layer: /Laniakea Supercluster/ },
  web: { layer: /2MRS galaxy distribution/ },
  universe: { layer: /Schematic observable universe/ },
};

async function assertAccessibleHierarchy(page, expectation, label = "scene") {
  const canvas = page.locator("#viewport");
  assert.equal(await canvas.getAttribute("aria-label"), "Helios scene", `${label}: canvas name stays scale-neutral`);
  assert.equal(await canvas.getAttribute("aria-describedby"), "scene-context");
  const context = await page.locator("#scene-context").textContent();
  assert.ok(context.length > 0, `${label}: persistent scene context is populated`);
  assert.doesNotMatch(context, /Interactive solar system/, `${label}: no stale solar-system canvas copy`);
  assert.match(context, expectation.layer, `${label}: layer text ${context}`);
  if (expectation.focus) {
    assert.match(context, expectation.focus, `${label}: focus text ${context}`);
  }
  const canvasSnapshot = await canvas.ariaSnapshot();
  const contextSnapshot = await page.locator("#scene-context").ariaSnapshot();
  assert.match(canvasSnapshot, /Helios scene/, `${label}: accessibility snapshot names the canvas`);
  const snapshotBlob = `${canvasSnapshot}\n${contextSnapshot}\n${context}`;
  assert.match(
    snapshotBlob,
    expectation.layer,
    `${label}: accessibility snapshot exposes the scientific layer`,
  );
  if (expectation.focus) {
    assert.match(snapshotBlob, expectation.focus, `${label}: accessibility snapshot exposes focus`);
  }
  const tree = await page.evaluate(() => ({
    buttons: document.querySelectorAll("button").length,
    worldLabels: document.querySelectorAll("#labels .sky-label").length,
    visibleWorldLabels: [...document.querySelectorAll("#labels .sky-label")]
      .filter((node) => !node.hidden).length,
    liveRole: document.querySelector("#status-live")?.getAttribute("role"),
  }));
  assert.equal(tree.worldLabels, 20, `${label}: a11y tree keeps the v1 body set, not catalog galaxies`);
  assert.ok(tree.buttons < 40, `${label}: accessibility tree is not dumped with rendered objects`);
  assert.equal(tree.liveRole, "status");
  return { context, canvasSnapshot, contextSnapshot };
}

async function saveScreenshot(page, name, options = {}) {
  if (!screenshotDir) return;
  await mkdir(screenshotDir, { recursive: true });
  await writeFile(path.join(screenshotDir, `${name}.png`), await page.screenshot(options));
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
  await assertAccessibleHierarchy(page, LOOK_SEMANTICS.virgo, "scale-transition-virgo");
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
    const hierarchyId = sceneHierarchyId(stop.distance);
    const hierarchyText = {
      virgo: /Virgo Cluster/,
      virgoSupercluster: /Local \(Virgo\) Supercluster/,
      laniakea: /Laniakea Supercluster/,
      web: /2MRS galaxy distribution/,
      cmb: /Cosmic microwave background/,
      universe: /Schematic observable universe/,
    }[hierarchyId];
    if (hierarchyText) {
      assert.match(
        await page.locator("#scene-context").textContent(),
        hierarchyText,
        `${stop.name} scene context is ${hierarchyId}`,
      );
    }
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
    await assertAccessibleHierarchy(page, LOOK_SEMANTICS[look], `${prefix}-${look}`);
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

async function orbitCameraDrag(page, dxFrac, dyFrac = 0) {
  const box = await page.locator("#viewport").boundingBox();
  assert.ok(box);
  const startX = box.x + box.width * 0.28;
  const startY = box.y + box.height * 0.55;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(
    startX + box.width * dxFrac,
    startY + box.height * dyFrac,
    { steps: 12 },
  );
  await page.mouse.up();
}

function moonWorldOffset(body, days) {
  const parent = findBody(body.parent);
  const offset = keplerOffset(body, parent, days);
  if (moonOrbitAttachment(body) !== "parent-equatorial") return offset;
  const basis = bodyOrientationBasis(parent);
  return {
    x: offset.x * basis.xAxis.x + offset.y * basis.zAxis.x - offset.z * basis.yAxis.x,
    y: offset.x * basis.xAxis.y + offset.y * basis.zAxis.y - offset.z * basis.yAxis.y,
    z: offset.x * basis.xAxis.z + offset.y * basis.zAxis.z - offset.z * basis.yAxis.z,
  };
}

function parentFacingPointerDelta(bodyId, width, height) {
  const moon = findBody(bodyId);
  const offset = moonWorldOffset(moon, 0);
  const sep = Math.hypot(offset.x, offset.y, offset.z) || 1;
  const targetAzimuth = Math.atan2(-offset.x, -offset.z);
  const targetElevation = Math.max(
    -1.2,
    Math.min(1.2, Math.asin(Math.max(-1, Math.min(1, -offset.y / sep)))),
  );
  let deltaAzimuth = targetAzimuth - CONFIG.cameraAzimuth;
  while (deltaAzimuth > Math.PI) deltaAzimuth -= Math.PI * 2;
  while (deltaAzimuth < -Math.PI) deltaAzimuth += Math.PI * 2;
  const deltaElevation = targetElevation - CONFIG.cameraElevation;
  return {
    dx: -deltaAzimuth / 0.005,
    dy: deltaElevation / 0.004,
    dxFrac: (-deltaAzimuth / 0.005) / width,
    dyFrac: (deltaElevation / 0.004) / height,
  };
}

async function touchOrbitBy(cdp, viewport, dx, dy) {
  let remainX = dx;
  let remainY = dy;
  for (let step = 0; step < 4 && (Math.abs(remainX) > 2 || Math.abs(remainY) > 2); step += 1) {
    const startX = viewport.width * 0.5;
    const startY = viewport.height * 0.55;
    const endX = Math.max(24, Math.min(viewport.width - 24, startX + remainX));
    const endY = Math.max(24, Math.min(viewport.height - 24, startY + remainY));
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 0, x: startX, y: startY, radiusX: 4, radiusY: 4, force: 1 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ id: 0, x: endX, y: endY, radiusX: 4, radiusY: 4, force: 1 }],
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    remainX -= endX - startX;
    remainY -= endY - startY;
  }
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

  await page.evaluate(() => {
    window.__heliosAnnouncements = [];
    const live = document.querySelector("#status-live");
    const observer = new MutationObserver(() => {
      window.__heliosAnnouncements.push(live.textContent);
    });
    observer.observe(live, { childList: true, characterData: true, subtree: true });
    window.__heliosAnnouncementObserver = observer;
  });

  // Enter the measured-volume layer through the real wheel path so its
  // transition announcement remains observable after boot's ready message.
  await wheelFourSteps(1_000);
  await page.locator("#status-live").filter({ hasText: "2MRS galaxy distribution" }).waitFor();
  await assertBodyLabelsHidden(page);
  await assertAccessibleHierarchy(
    page,
    { layer: /2MRS galaxy distribution/ },
    "desktop-wheel-web",
  );
  const outbound = await page.evaluate(() => window.__heliosAnnouncements.slice());
  assert.ok(outbound.length <= 12, `outbound wheel announcements stay bounded (${outbound.length})`);
  assert.ok(
    outbound.some((message) => message.includes("2MRS galaxy distribution")),
    `outbound wheel announces 2MRS: ${JSON.stringify(outbound)}`,
  );
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
  const allAnnouncements = await page.evaluate(() => {
    window.__heliosAnnouncementObserver.disconnect();
    return window.__heliosAnnouncements;
  });
  assert.ok(
    allAnnouncements.length <= 48,
    `rapid wheel cycles stay bounded (${allAnnouncements.length} live-region writes)`,
  );
}

async function assertMinimumZoomViews(context, prefix, bodyIds, touch = false) {
  const page = await context.newPage();
  const errors = captureErrors(page);
  await openReady(page);
  const play = page.locator("#play-button");
  if (await play.getAttribute("aria-pressed") === "true") {
    if (touch) await play.tap();
    else await play.click();
  }
  const canvas = page.locator("#viewport");
  const cdp = touch ? await context.newCDPSession(page) : null;

  for (const bodyId of bodyIds) {
    await page.locator("#reset-button").click();
    await page.evaluate(
      (id) => document.querySelector(`[data-body-id="${id}"]`).click(),
      bodyId,
    );
    await page.locator("#body-card:not([hidden])").waitFor();

    if (cdp) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
          { id: 0, x: 175, y: 320, radiusX: 4, radiusY: 4, force: 1 },
          { id: 1, x: 215, y: 320, radiusX: 4, radiusY: 4, force: 1 },
        ],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { id: 0, x: 10, y: 320, radiusX: 4, radiusY: 4, force: 1 },
          { id: 1, x: 380, y: 320, radiusX: 4, radiusY: 4, force: 1 },
        ],
      });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      const point = await canvas.evaluate((viewport) => {
        const box = viewport.getBoundingClientRect();
        for (const [x, y] of [[0.5, 0.7], [0.2, 0.6], [0.8, 0.6]]) {
          const clientX = box.left + box.width * x;
          const clientY = box.top + box.height * y;
          if (document.elementFromPoint(clientX, clientY) === viewport) {
            return { x: clientX, y: clientY };
          }
        }
        return null;
      });
      assert.ok(point, `${prefix} ${bodyId} has an unobstructed wheel target`);
      await page.mouse.move(point.x, point.y);
      await page.mouse.wheel(0, -10_000);
    }

    await waitForCenteredBodyLabel(page, bodyId);
    await page.waitForTimeout(250);
    assert.equal(await page.locator("#card-name").textContent(), findBody(bodyId).name);
    await assertRenderedCanvas(page);
    await assertFocusedGlobeSurfaceVisible(page, `${prefix} ${bodyId}`);
    await assertPersistentChromeContrast(page, `${prefix} ${bodyId}`);
    await saveScreenshot(page, `${prefix}-minimum-zoom-${bodyId}`);
  }

  if (cdp) await cdp.detach();
  assert.deepEqual(errors, [], `${prefix} minimum zoom has no browser errors`);
  await page.close();
}

async function assertPersistentChromeContrast(page, label) {
  const audit = await page.evaluate(() => {
    const parseColor = (value) => {
      const channels = value.match(/[\d.]+/g)?.map(Number);
      if (!channels || channels.length < 3) throw new Error(`Unsupported CSS color: ${value}`);
      return {
        red: channels[0],
        green: channels[1],
        blue: channels[2],
        alpha: channels[3] ?? 1,
      };
    };
    const composite = (foreground, background) => ({
      red: foreground.red * foreground.alpha + background.red * (1 - foreground.alpha),
      green: foreground.green * foreground.alpha
        + background.green * (1 - foreground.alpha),
      blue: foreground.blue * foreground.alpha + background.blue * (1 - foreground.alpha),
      alpha: 1,
    });
    const linearChannel = (value) => {
      const channel = value / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (color) => (
      0.2126 * linearChannel(color.red)
      + 0.7152 * linearChannel(color.green)
      + 0.0722 * linearChannel(color.blue)
    );
    const contrast = (first, second) => {
      const firstLuminance = luminance(first);
      const secondLuminance = luminance(second);
      return (Math.max(firstLuminance, secondLuminance) + 0.05)
        / (Math.min(firstLuminance, secondLuminance) + 0.05);
    };
    const whiteCanvas = { red: 255, green: 255, blue: 255, alpha: 1 };
    const effectiveBackground = (element, root) => {
      const ancestry = [];
      let current = element;
      while (current && current !== root) {
        ancestry.push(current);
        current = current.parentElement;
      }
      if (current !== root) throw new Error("Contrast root is not an ancestor");
      ancestry.push(root);
      return ancestry.reverse().reduce((background, item) => (
        composite(parseColor(getComputedStyle(item).backgroundColor), background)
      ), whiteCanvas);
    };
    const textPairs = [
      [".topbar .eyebrow", ".topbar"],
      [".topbar h1", ".topbar"],
      [".topbar .clock", ".topbar"],
      ["#play-button", "#dock"],
      ["#slower-button", "#dock"],
      ["#faster-button", "#dock"],
      ["#speed-readout", "#dock"],
      ["#sky-mode", "#dock"],
      ["#reset-button", "#dock"],
      ["#version-label", "#version-label"],
    ].map(([selector, rootSelector]) => {
      const element = document.querySelector(selector);
      const root = document.querySelector(rootSelector);
      if (!element || !root) throw new Error(`Missing contrast target: ${selector}`);
      const background = effectiveBackground(element, root);
      const foreground = composite(parseColor(getComputedStyle(element).color), background);
      return { selector, ratio: contrast(foreground, background) };
    });
    const controlBoundaries = [...document.querySelectorAll("#dock button, #sky-mode")]
      .map((element) => {
        const root = document.querySelector("#dock");
        const outer = effectiveBackground(root, root);
        const inner = effectiveBackground(element, root);
        // CSS backgrounds paint beneath translucent borders by default, so
        // evaluate the real border color against both adjacent surfaces.
        const border = composite(parseColor(getComputedStyle(element).borderTopColor), inner);
        return {
          selector: `#${element.id}`,
          ratio: Math.min(contrast(border, outer), contrast(border, inner)),
        };
      });
    const dockBackground = effectiveBackground(
      document.querySelector("#dock"),
      document.querySelector("#dock"),
    );
    const sliderAccent = parseColor(getComputedStyle(
      document.querySelector("#speed-slider"),
    ).accentColor);
    const backing = [".topbar", "#dock", "#version-label"].map((selector) => {
      const shadow = getComputedStyle(document.querySelector(selector)).boxShadow;
      const lengths = shadow.match(/-?[\d.]+px/g)?.map(Number.parseFloat) ?? [];
      return { selector, spread: lengths[3] ?? 0 };
    });
    return {
      textPairs,
      controls: [
        ...controlBoundaries,
        { selector: "#speed-slider accent", ratio: contrast(sliderAccent, dockBackground) },
      ],
      backing,
    };
  });

  for (const result of audit.textPairs) {
    assert.ok(
      result.ratio >= 4.5,
      `${label} ${result.selector} worst-case text contrast is ${result.ratio}`,
    );
  }
  for (const result of audit.controls) {
    assert.ok(
      result.ratio >= 3,
      `${label} ${result.selector} worst-case control contrast is ${result.ratio}`,
    );
  }
  for (const result of audit.backing) {
    assert.ok(
      result.spread >= 6,
      `${label} ${result.selector} backing covers its ${result.spread}px focus-ring halo`,
    );
  }
}

async function assertMoonParentCloseViews(context, prefix, touch = false) {
  const page = await context.newPage();
  const errors = captureErrors(page);
  await openReady(page);
  const play = page.locator("#play-button");
  if (await play.getAttribute("aria-pressed") === "true") {
    if (touch) await play.tap();
    else await play.click();
  }
  const canvas = page.locator("#viewport");
  const cdp = touch ? await context.newCDPSession(page) : null;
  const colliding = ["moon", "io", "triton"];
  const bodies = touch ? colliding : [...colliding, "europa"];

  for (const bodyId of bodies) {
    await page.locator("#reset-button").click();
    await page.evaluate(
      (id) => document.querySelector(`[data-body-id="${id}"]`).click(),
      bodyId,
    );
    await page.locator("#body-card:not([hidden])").waitFor();

    if (cdp) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
          { id: 0, x: 175, y: 320, radiusX: 4, radiusY: 4, force: 1 },
          { id: 1, x: 215, y: 320, radiusX: 4, radiusY: 4, force: 1 },
        ],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { id: 0, x: 10, y: 320, radiusX: 4, radiusY: 4, force: 1 },
          { id: 1, x: 380, y: 320, radiusX: 4, radiusY: 4, force: 1 },
        ],
      });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      const point = await canvas.evaluate((viewport) => {
        const box = viewport.getBoundingClientRect();
        for (const [x, y] of [[0.5, 0.7], [0.2, 0.6], [0.8, 0.6]]) {
          const clientX = box.left + box.width * x;
          const clientY = box.top + box.height * y;
          if (document.elementFromPoint(clientX, clientY) === viewport) {
            return { x: clientX, y: clientY };
          }
        }
        return null;
      });
      assert.ok(point, `${prefix} ${bodyId} has an unobstructed wheel target`);
      await page.mouse.move(point.x, point.y);
      await page.mouse.wheel(0, -10_000);
    }

    await waitForCenteredBodyLabel(page, bodyId);
    await page.waitForTimeout(250);
    assert.equal(await page.locator("#card-name").textContent(), findBody(bodyId).name);
    await assertRenderedCanvas(page);
    await saveScreenshot(page, `${prefix}-moon-parent-min-${bodyId}`);

    const viewport = page.viewportSize();
    assert.ok(viewport);
    const towardParent = parentFacingPointerDelta(bodyId, viewport.width, viewport.height);
    if (cdp) {
      await touchOrbitBy(cdp, viewport, towardParent.dx, towardParent.dy);
    } else {
      await orbitCameraDrag(page, towardParent.dxFrac, towardParent.dyFrac);
    }
    await waitForCenteredBodyLabel(page, bodyId);
    await page.waitForTimeout(250);
    assert.equal(await page.locator("#card-name").textContent(), findBody(bodyId).name);
    await assertRenderedCanvas(page);
    await saveScreenshot(page, `${prefix}-moon-parent-close-${bodyId}`);

    if (cdp) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
          { id: 0, x: 10, y: 320, radiusX: 4, radiusY: 4, force: 1 },
          { id: 1, x: 380, y: 320, radiusX: 4, radiusY: 4, force: 1 },
        ],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { id: 0, x: 175, y: 320, radiusX: 4, radiusY: 4, force: 1 },
          { id: 1, x: 215, y: 320, radiusX: 4, radiusY: 4, force: 1 },
        ],
      });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      const point = await canvas.evaluate((viewport) => {
        const box = viewport.getBoundingClientRect();
        const clientX = box.left + box.width * 0.5;
        const clientY = box.top + box.height * 0.7;
        return { x: clientX, y: clientY };
      });
      await page.mouse.move(point.x, point.y);
      await page.mouse.wheel(0, 800);
      await page.mouse.wheel(0, 800);
    }
    await waitForCenteredBodyLabel(page, bodyId);
    await page.waitForTimeout(250);
    assert.equal(
      await page.locator("#card-name").textContent(),
      findBody(bodyId).name,
      `${prefix} ${bodyId} zoom through the parent keeps the moon focused`,
    );
    await assertRenderedCanvas(page);
    await saveScreenshot(page, `${prefix}-moon-parent-cross-${bodyId}`);

    if (cdp) {
      await touchOrbitBy(cdp, viewport, -towardParent.dx, -towardParent.dy);
    } else {
      await orbitCameraDrag(page, -towardParent.dxFrac, -towardParent.dyFrac);
    }
    await waitForCenteredBodyLabel(page, bodyId);
    await page.waitForTimeout(250);
    assert.equal(
      await page.locator("#card-name").textContent(),
      findBody(bodyId).name,
      `${prefix} ${bodyId} reverse orbit keeps the moon focused`,
    );
    await assertRenderedCanvas(page);
    await saveScreenshot(page, `${prefix}-moon-parent-reverse-${bodyId}`);
  }

  if (cdp) await cdp.detach();
  assert.deepEqual(errors, [], `${prefix} moon-parent close views have no browser errors`);
  await page.close();
}

async function waitForCenteredBodyLabel(page, bodyId) {
  await page.waitForFunction((id) => {
    const label = document.querySelector(`[data-body-id="${id}"]`);
    if (!label || label.hidden) return false;
    const match = label.style.transform.match(
      /translate\(([-\d.eE]+)px,\s*([-\d.eE]+)px\)$/,
    );
    if (!match) return false;
    return Math.abs(Number(match[1]) - innerWidth / 2) <= innerWidth * 0.12
      && Math.abs(Number(match[2]) - innerHeight / 2) <= innerHeight * 0.12;
  }, bodyId, { timeout: 20_000 });
}

async function assertFocusedGlobeSurfaceVisible(page, label) {
  const png = await page.locator("#viewport").screenshot();
  const metrics = await page.evaluate(async (source) => {
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
    const x = Math.floor(surface.width * 0.4);
    const y = Math.floor(surface.height * 0.4);
    const width = Math.max(1, Math.floor(surface.width * 0.2));
    const height = Math.max(1, Math.floor(surface.height * 0.2));
    const pixels = context.getImageData(x, y, width, height).data;
    let luminance = 0;
    let dark = 0;
    let samples = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const value = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
      luminance += value;
      if (value < 8) dark += 1;
      samples += 1;
    }
    return { mean: luminance / samples, dark: dark / samples };
  }, png.toString("base64"));
  assert.ok(
    metrics.mean > 40,
    `${label} closest view shows globe surface (mean=${metrics.mean.toFixed(1)})`,
  );
  assert.ok(
    metrics.dark < 0.05,
    `${label} closest view is not an inside-sphere void (dark=${metrics.dark.toFixed(3)})`,
  );
}

async function assertSaturnRingReferenceViews(context) {
  const page = await context.newPage();
  const errors = captureErrors(page);
  await openReady(page);
  const play = page.locator("#play-button");
  if (await play.getAttribute("aria-pressed") === "true") {
    await play.click();
  }
  await page.locator("#reset-button").click();
  await page.evaluate(() => document.querySelector('[data-body-id="saturn"]').click());
  await page.locator("#body-card:not([hidden])").waitFor();
  assert.equal(await page.locator("#card-name").textContent(), "Saturn");
  await waitForCenteredBodyLabel(page, "saturn");
  await page.waitForTimeout(250);
  await assertRenderedCanvas(page);
  await saveScreenshot(page, "desktop-saturn-rings-front");
  await orbitCameraHalfTurn(page);
  await waitForCenteredBodyLabel(page, "saturn");
  await page.waitForTimeout(250);
  await assertRenderedCanvas(page);
  await saveScreenshot(page, "desktop-saturn-rings-back");
  assert.deepEqual(errors, [], "Saturn ring reference views have no browser errors");
  await page.close();
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
  await assertAccessibleHierarchy(
    desktopPage,
    { layer: /Solar system/, focus: /Focused on the Sun/ },
    "desktop-boot",
  );

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
  await assertAccessibleHierarchy(
    desktopPage,
    { layer: /Solar system/, focus: /Focused on Earth/ },
    "desktop-earth-focus",
  );
  await desktopPage.locator("#reset-button").click();
  assert.equal(await desktopPage.locator("#body-card").getAttribute("hidden"), "");

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
    await assertAccessibleHierarchy(directPage, LOOK_SEMANTICS[look], `desktop-${look}`);
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
  await captureEarthSolstice(desktop, "earth-june-solstice", "2000-06-21");
  await captureEarthSolstice(desktop, "earth-december-solstice", "2000-12-21", true);
  await assertMinimumZoomViews(desktop, "desktop", ["sun", "jupiter", "saturn"]);
  await assertMoonParentCloseViews(desktop, "desktop");
  await assertSaturnRingReferenceViews(desktop);
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
  await assertAccessibleHierarchy(
    touchPage,
    { layer: /Solar system/, focus: /Focused on the Sun/ },
    "touch-portrait-boot",
  );
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
  // Pinch on empty canvas. Ceres's corrected J2000 seat places its 44px
  // label over the former (70, 320) start, which selected Ceres instead
  // of zooming.
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { id: 0, x: 70, y: 240, radiusX: 4, radiusY: 4, force: 1 },
      { id: 1, x: 320, y: 240, radiusX: 4, radiusY: 4, force: 1 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { id: 0, x: 165, y: 240, radiusX: 4, radiusY: 4, force: 1 },
      { id: 1, x: 225, y: 240, radiusX: 4, radiusY: 4, force: 1 },
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
  await assertAccessibleHierarchy(
    touchPage,
    { layer: /Milky Way|Nearby galaxies|Local Group|Virgo Cluster|Laniakea Supercluster|2MRS galaxy distribution/ },
    "touch-portrait-pinch",
  );

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
  await touchPage.close();
  await assertMinimumZoomViews(touch, "touch-portrait", ["sun", "jupiter", "saturn"], true);
  await assertMoonParentCloseViews(touch, "touch-portrait", true);
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
