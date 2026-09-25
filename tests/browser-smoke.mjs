import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  BODIES,
  bodyOrientationBasis,
  findBody,
  keplerOffset,
  moonOrbitAttachment,
  visualBodyRadius,
  visualRingRadius,
} from "../js/bodies.js";
import {
  CONFIG,
  describeDaysPerSecond,
  formatDaysPerSecond,
  minimumFocusDistance,
  wheelZoomMultiplier,
} from "../js/config.js";
import { cmbSkyOpacity, sceneHierarchyId } from "../js/galaxy.js";
import { equatorialVectorToScene } from "../js/sky.js";
import { auditCameraNavigation } from "./camera-navigation.mjs";
import { runFocusTracking } from "./focus-tracking.mjs";
import { MAX_SIMULATION_DAYS, simulationDateLabel } from "../js/time.js";

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
const PRIMARY_BODY_IDS = BODIES.filter((body) => body.kind !== "moon").map((body) => body.id);
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

async function auditCredits(context) {
  const page = await context.newPage();
  const errors = captureErrors(page);
  const downloads = [];
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  try {
    await openReady(page);
    const [response] = await Promise.all([
      page.waitForResponse(base + "PROVENANCE.md"),
      page.locator("#version-label").click(),
    ]);
    assert.equal(response.status(), 200);
    assert.equal(response.headers()["content-type"], "text/plain; charset=utf-8");
    await page.waitForURL(base + "PROVENANCE.md");
    await page.waitForLoadState("domcontentloaded");
    assert.equal(await page.evaluate(() => document.contentType), "text/plain");
    assert.equal(
      (await page.locator("body").innerText()).trim(),
      (await readFile(path.join(root, "PROVENANCE.md"), "utf8")).trim(),
      "Credits displays the published provenance inline in the same tab",
    );
    assert.deepEqual(downloads, [], "Credits does not download the Markdown file");
    assert.deepEqual(errors, [], "Credits navigation has no browser errors");
  } finally {
    await page.close();
  }
}

async function beginViewportBusyAudit(page) {
  await page.locator("#viewport").evaluate((viewport) => {
    const oldValues = [];
    const observer = new MutationObserver((records) => {
      oldValues.push(...records.map((record) => record.oldValue));
    });
    observer.observe(viewport, {
      attributes: true,
      attributeFilter: ["aria-busy"],
      attributeOldValue: true,
    });
    globalThis.__heliosBusyAudit = {
      observer,
      oldValues,
      initial: viewport.getAttribute("aria-busy"),
    };
  });
}

async function endViewportBusyAudit(page) {
  return page.locator("#viewport").evaluate((viewport) => {
    const { observer, oldValues, initial } = globalThis.__heliosBusyAudit;
    oldValues.push(...observer.takeRecords().map((record) => record.oldValue));
    observer.disconnect();
    delete globalThis.__heliosBusyAudit;
    return { initial, oldValues, final: viewport.getAttribute("aria-busy") };
  });
}

async function assertViewportBusyIdle(page, label) {
  await waitForMoonCameraSettled(page);
  await beginViewportBusyAudit(page);
  await page.evaluate(async () => {
    for (let frame = 0; frame < 12; frame += 1) {
      await new Promise(requestAnimationFrame);
    }
  });
  const trace = await endViewportBusyAudit(page);
  const evidence = `${label}: at least 12 idle frames, ${trace.oldValues.length} aria-busy writes; ${JSON.stringify(trace)}`;
  assert.equal(trace.initial, "false", evidence);
  assert.equal(trace.final, "false", evidence);
  assert.equal(trace.oldValues.length, 0, evidence);
  console.log(evidence);
}

async function assertViewportBusyChanges(page, label, expected = null) {
  const trace = await endViewportBusyAudit(page);
  // Each following old value is the preceding write's new value, including
  // several synchronous writes delivered in one MutationObserver callback.
  const values = [...trace.oldValues, trace.final];
  const evidence = `${label}: ${trace.oldValues.length} aria-busy writes; ${JSON.stringify(trace)}`;
  assert.equal(trace.initial, "false", evidence);
  assert.equal(values[0], trace.initial, evidence);
  assert.equal(trace.final, "false", evidence);
  assert.ok(values.includes("true"), `${evidence}; a real transition becomes busy`);
  for (let index = 1; index < values.length; index += 1) {
    assert.ok(["true", "false"].includes(values[index]), evidence);
    assert.notEqual(values[index], values[index - 1], `${evidence}; no redundant writes`);
  }
  if (expected) assert.deepEqual(values, expected, evidence);
  console.log(evidence);
}

async function assertViewportBusyLifecycle(context, prefix) {
  // Keep these extra interactions off the existing visual-evidence pages.
  const page = await context.newPage();
  const errors = captureErrors(page);
  await openReady(page);
  await assertViewportBusyIdle(page, `${prefix} startup`);
  await page.locator("#play-button").click();
  const canvas = page.locator("#viewport");
  for (const action of ["Reset", "Escape", "planet interruption", "repeated focus", "zoom reversal"]) {
    await page.locator("#reset-button").click();
    await beginViewportBusyAudit(page);
    await page.evaluate(() => document.querySelector('[data-body-id="io"]').click());
    assert.equal(await canvas.getAttribute("aria-busy"), "true", `${prefix} ${action} starts busy`);
    await waitForTwoAnimationFrames(page);
    if (action === "Reset") {
      await page.locator("#reset-button").click();
    } else if (action === "Escape") {
      await canvas.press("Escape");
    } else if (action === "planet interruption") {
      await page.evaluate(() => document.querySelector('[data-body-id="earth"]').click());
    } else if (action === "repeated focus") {
      await page.evaluate(() => {
        for (const id of ["io", "triton", "triton", "io"]) {
          document.querySelector(`[data-body-id="${id}"]`).click();
        }
      });
      assert.equal(await canvas.getAttribute("aria-busy"), "true", `${prefix} retargeting stays busy`);
    } else {
      await canvas.evaluate((viewport) => {
        for (const deltaY of [-10_000, 800, -800]) {
          viewport.dispatchEvent(new WheelEvent("wheel", {
            deltaY,
            bubbles: true,
            cancelable: true,
          }));
        }
      });
      assert.equal(await canvas.getAttribute("aria-busy"), "true", `${prefix} zoom reversal stays busy`);
    }
    await waitForMoonCameraSettled(page);
    await assertViewportBusyChanges(page, `${prefix} ${action}`, ["false", "true", "false"]);
    if (["Reset", "Escape"].includes(action)) {
      assert.equal(await page.locator("#body-card").getAttribute("hidden"), "");
      assert.equal(await page.locator("#status-live").textContent(), "Returned to the overview");
    } else {
      const target = action === "planet interruption" ? "Earth" : "Io";
      assert.equal(await page.locator("#card-name").textContent(), target);
    }
    await assertViewportBusyIdle(page, `${prefix} settled after ${action}`);
  }
  await openReady(page, "?look=sky");
  await assertViewportBusyIdle(page, `${prefix} Earth-sky startup`);
  assert.deepEqual(errors, [], `${prefix} busy-state lifecycle has no browser errors`);
  await page.close();
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

async function assertVisibleBodyLabelsClearChrome(page, label, requireVisible = true) {
  const audit = await page.evaluate(() => {
    const describeHit = (element) => element ? {
      tag: element.tagName,
      id: element.id,
      bodyId: element.dataset.bodyId ?? null,
      className: element.getAttribute("class"),
      rectangle: element.getBoundingClientRect().toJSON(),
    } : null;
    const sample = {
      at: performance.now(),
      viewport: { width: innerWidth, height: innerHeight },
      playing: document.querySelector("#play-button")?.getAttribute("aria-pressed"),
      cardName: document.querySelector("#card-name")?.textContent,
      cardHidden: document.querySelector("#body-card")?.hidden,
      activeBody: document.querySelector(".sky-label.is-active")?.dataset.bodyId ?? null,
      camera: describeHit(document.querySelector("#camera-controls")),
    };
    // Runtime reserves 8px; tolerate subpixel DOMRect rounding at the boundary.
    const clearance = 7.5;
    const obstacles = [
      document.querySelector(".topbar"),
      document.querySelector("#body-card"),
      document.querySelector("#dock"),
      document.querySelector("#version-label"),
      document.querySelector("#camera-controls"),
    ].filter((element) => element && !element.hidden && element.getClientRects().length > 0)
      .map((element) => {
        const box = element.getBoundingClientRect();
        return {
          name: element.id || element.className,
          left: box.left - clearance,
          right: box.right + clearance,
          top: box.top - clearance,
          bottom: box.bottom + clearance,
        };
      });
    return [...document.querySelectorAll(".sky-label:not([hidden])")].map((element) => {
      const box = element.getBoundingClientRect();
      const center = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      );
      const blocker = obstacles.find((obstacle) => (
        box.right > obstacle.left
        && box.left < obstacle.right
        && box.bottom > obstacle.top
        && box.top < obstacle.bottom
      ));
      return {
        name: element.textContent,
        width: box.width,
        height: box.height,
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        insideViewport: box.left >= clearance
          && box.right <= window.innerWidth - clearance
          && box.top >= clearance
          && box.bottom <= window.innerHeight - clearance,
        blocker: blocker?.name ?? null,
        hit: center?.closest?.(".sky-label") === element,
        hitElement: describeHit(center),
        hitStack: document.elementsFromPoint(
          box.left + box.width / 2, box.top + box.height / 2,
        ).slice(0, 8).map(describeHit),
        sample,
      };
    });
  });
  if (requireVisible) {
    assert.ok(audit.length > 0, `${label}: at least one body label remains visible`);
  }
  for (const [index, first] of audit.entries()) {
    for (const second of audit.slice(index + 1)) {
      assert.ok(
        first.right <= second.left || first.left >= second.right
          || first.bottom <= second.top || first.top >= second.bottom,
        `${label}: ${first.name}/${second.name} complete label targets do not overlap`,
      );
    }
  }
  for (const item of audit) {
    assert.ok(item.width >= 43.5 && item.height >= 43.5, `${label}: ${item.name} keeps a 44px target`);
    assert.equal(item.insideViewport, true, `${label}: ${item.name} stays inside the viewport: ${JSON.stringify(item)}`);
    assert.equal(item.blocker, null, `${label}: ${item.name} clears persistent chrome: ${JSON.stringify(item)}`);
    try {
      assert.equal(item.hit, true, `${label}: ${item.name} remains hit-testable: ${JSON.stringify(item)}`);
    } catch (error) {
      // Retain the failing sample before any later screenshot can advance a frame.
      console.error(JSON.stringify({ label, audit }));
      if (screenshotDir) {
        const name = `label-hit-failure-${label.replace(/[^a-z0-9-]+/gi, "-")}`;
        try {
          await mkdir(screenshotDir, { recursive: true });
          await writeFile(path.join(screenshotDir, `${name}.json`), JSON.stringify({ label, audit }, null, 2) + "\n");
          await saveScreenshot(page, name);
        } catch (captureError) {
          console.error(`Could not retain label-hit failure evidence: ${captureError}`);
        }
      }
      throw error;
    }
  }
}

async function auditBodyLabelCollisions(context, prefix, touch = false) {
  const page = await context.newPage();
  const errors = captureErrors(page);
  try {
    for (const input of ["pointer", "keyboard"]) {
      await openReady(page, "?look=solarfar");
      await page.locator("#play-button").click();
      await waitForTwoAnimationFrames(page);
      await assertVisibleBodyLabelsClearChrome(page, `${prefix} far-solar ${input}`);
      for (const id of ["sun", "mercury", "venus", "earth"]) {
        assert.equal(await page.locator(`[data-body-id="${id}"]`).isVisible(), true,
          `${prefix}: crowded inner-world ${id} remains available`);
      }
      if (input === "pointer") await saveScreenshot(page, `${prefix}-solarfar-label-collisions`);
      const id = await page.locator('.sky-label:not([hidden])').evaluateAll((labels) => (
        labels.find((label) => label.style.transform.includes("translateX("))?.dataset.bodyId
      ));
      assert.ok(id, `${prefix}: regression exercises an actually displaced label`);
      const target = page.locator(`[data-body-id="${id}"]`);
      const before = await target.boundingBox();
      assert.ok(before);
      if (input === "keyboard") {
        await target.focus();
        await waitForTwoAnimationFrames(page);
        const after = await target.boundingBox();
        assert.deepEqual(after, before, `${prefix}: keyboard focus keeps the displaced target stable`);
        assert.equal(await target.evaluate((label) => document.activeElement === label), true);
        await assertVisibleBodyLabelsClearChrome(page, `${prefix} keyboard-focused labels`);
        await target.press("Enter");
      } else if (touch) {
        await page.touchscreen.tap(before.x + before.width / 2, before.y + before.height / 2);
      } else {
        await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
        await page.mouse.down();
        await waitForTwoAnimationFrames(page);
        assert.deepEqual(await target.boundingBox(), before,
          "mouse press cannot move its displaced target before release");
        await page.mouse.up();
      }
      assert.equal(await page.locator("#card-name").textContent(), findBody(id).name,
        `${prefix}: ${input} selects the named displaced label`);
      await waitForCenteredBodyLabel(page, id);
      assert.equal(await target.evaluate((label) => label.style.transform.includes("translateX(")), false,
        `${prefix}: selected world regains its natural label seat`);
      await assertVisibleBodyLabelsClearChrome(page, `${prefix} selected ${id}`);
      await saveScreenshot(page, `${prefix}-label-collision-${input}`);
    }
    assert.deepEqual(errors, [], `${prefix}: crowded label selection has no runtime errors`);
  } finally {
    await page.close();
  }
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
  assert.equal(
    await canvas.getAttribute("aria-describedby"),
    new URL(page.url()).searchParams.get("look") === "sky" ? "scene-context" : "scene-context camera-help",
  );
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

async function assertEarthSkyReset(page) {
  for (const action of ["button", "escape"]) {
    await openReady(page, "?look=sky");
    const canvas = page.locator("#viewport");
    const before = await stableCanvasFrame(page, canvas);
    if (action === "button") {
      await page.locator("#reset-button").click();
    } else {
      await canvas.focus();
      await canvas.press("Escape");
    }
    await page.waitForTimeout(100);
    assert.equal(
      await page.locator("#body-card").getAttribute("hidden"),
      "",
      `Earth-sky ${action} clears the selected-body card`,
    );
    assert.equal(
      await page.locator("#status-live").textContent(),
      "Returned to the Earth sky",
      `Earth-sky ${action} announces the restored direct look`,
    );
    const semantics = await assertAccessibleHierarchy(
      page,
      LOOK_SEMANTICS.sky,
      `desktop-sky-${action}`,
    );
    assert.equal(
      semantics.context,
      "Earth sky. Focused on Earth.",
      `Earth-sky ${action} retains Earth as the real focus`,
    );
    const after = await stableCanvasFrame(page, canvas);
    const difference = await frameDifferenceMetrics(page, before, after);
    await saveScreenshot(page, `desktop-sky-${action}`);
    // The focus-derived semantics prove state; this only rejects a visible
    // camera change while tolerating repeat WebGL rasterization noise.
    assert.ok(
      difference.meanAbsoluteDifference <= 1.25
        && difference.strongCoverage <= 0.02,
      `Earth-sky ${action} preserves the Earth-centered camera: ${JSON.stringify(difference)}`,
    );
  }
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

async function auditWheelDeltaModes(browser, touch = false) {
  // Desktop matrix/input checks keep CSS coordinates with a quarter-size buffer.
  // This isolated audit produces no baseline screenshots.
  const context = await browser.newContext({
    viewport: touch ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: touch ? 1 : 0.5,
    hasTouch: touch,
    isMobile: touch,
  });
  const page = await context.newPage();
  const errors = captureErrors(page);
  let observer, cdp;
  const relativeGap = (a, b) => Math.max(...a.map((value, index) =>
    Math.abs(value - b[index]) / Math.max(1, Math.abs(value), Math.abs(b[index]))));
  const equal = (a, b, label) => {
    const gap = relativeGap(a.geometry, b.geometry);
    assert.ok(gap <= 1e-6,
      `${label}: rendered camera gap ${gap} stays within 1e-6 relative/absolute tolerance`);
    assert.deepEqual(a.ui, b.ui, `${label}: scene, focus, card and labels agree`);
  };
  try {
    await openReady(page);
    if (await page.locator("#play-button").getAttribute("aria-pressed") === "true") {
      await page.locator("#play-button").click();
    }
    await assertRenderedCanvas(page);
    observer = await page.evaluateHandle(async () => {
      // Observe matrices used by the real render; never read or change app state.
      const THREE = await import(new URL("vendor/three.module.min.js", location.href).href);
      const prototype = THREE.Scene.prototype;
      const own = Object.getOwnPropertyDescriptor(prototype, "onAfterRender");
      const original = prototype.onAfterRender;
      const canvas = document.querySelector("#viewport");
      const labels = document.querySelector("#labels");
      const touchIds = new Set();
      const touchStarts = [];
      const recordTouch = (event) => {
        if (event.pointerType !== "touch") return;
        touchIds.add(event.pointerId);
        touchStarts.push(event.target.closest("[data-body-id]")?.dataset.bodyId || "canvas");
      };
      canvas.addEventListener("pointerdown", recordTouch);
      labels.addEventListener("pointerdown", recordTouch);
      let serial = 0, latest = null;
      prototype.onAfterRender = function (renderer, scene, camera) {
        original.call(this, renderer, scene, camera);
        latest = {
          serial: ++serial,
          geometry: [...camera.matrixWorld.elements, ...camera.projectionMatrix.elements],
          ui: {
            scene: document.querySelector("#scene-context").textContent,
            cardHidden: document.querySelector("#body-card").hidden,
            cardName: document.querySelector("#card-name").textContent,
            active: [...document.querySelectorAll("[data-body-id].is-active")].map((node) => node.dataset.bodyId),
            playing: document.querySelector("#play-button").getAttribute("aria-pressed"),
          },
          busy: canvas.getAttribute("aria-busy"),
        };
      };
      return {
        snapshot: () => latest,
        touchCount: () => touchIds.size,
        touchStarts: () => touchStarts.slice(),
        restore() {
          if (own) Object.defineProperty(prototype, "onAfterRender", own);
          else delete prototype.onAfterRender;
          canvas.removeEventListener("pointerdown", recordTouch);
          labels.removeEventListener("pointerdown", recordTouch);
        },
      };
    });
    const settled = async () => {
      let previous;
      for (let attempt = 0; attempt < 180; attempt += 1) {
        await waitForTwoAnimationFrames(page);
        const current = await observer.evaluate((item) => item.snapshot());
        assert.ok(current && current.geometry.every(Number.isFinite), "wheel retains a finite rendered camera");
        assert.equal(current.ui.playing, "false", "wheel comparison remains paused");
        if (previous && current.serial > previous.serial && current.busy === "false"
          && relativeGap(previous.geometry, current.geometry) <= 1e-9) return current;
        previous = current;
      }
      throw new Error("wheel camera did not settle");
    };
    const dispatch = async (deltaY, deltaMode = 0, ctrlKey = false) => {
      const delivered = await page.locator("#viewport").evaluate((canvas, input) => {
        const event = new WheelEvent("wheel", {
          deltaY: Number.isFinite(input.deltaY) ? input.deltaY : 0,
          deltaMode: input.deltaMode, ctrlKey: input.ctrlKey,
          bubbles: true, cancelable: true,
        });
        // WebIDL may reject nonfinite constructor doubles. These robustness
        // cases explicitly deliver an own property to the real handler.
        if (!Number.isFinite(input.deltaY)) Object.defineProperty(event, "deltaY", { value: input.deltaY });
        const accepted = canvas.dispatchEvent(event);
        return { deltaY: event.deltaY, deltaMode: event.deltaMode,
          prevented: event.defaultPrevented, accepted };
      }, { deltaY, deltaMode, ctrlKey });
      assert.ok(Object.is(delivered.deltaY, deltaY), "the intended wheel delta reached the browser handler");
      assert.equal(delivered.deltaMode, deltaMode);
      assert.equal(delivered.prevented, true, "wheel still prevents default, including ignored inputs");
      assert.equal(delivered.accepted, false);
    };
    const reset = async () => {
      await page.locator("#reset-button").click();
      return settled();
    };
    const height = await page.locator("#viewport").evaluate((canvas) => canvas.clientHeight);
    assert.ok(height > 0);
    // Independent equivalents from the documented contract: a line is 16 CSS
    // pixels; a page is the current canvas clientHeight. Do not call the helper
    // being tested to generate expected values.
    const equivalent = (pixels, mode) => pixels / [1, 16, height][mode];
    const pixelSeat = async (from, to) => {
      await dispatch(Math.log(to / from) / 0.0016);
      return settled();
    };
    if (touch) {
      await reset();
      cdp = await context.newCDPSession(page);
      const center = await unobstructedCanvasPoint(page,
        [[0.5, 0.38], [0.5, 0.52], [0.5, 0.28]], 80);
      assert.ok(center, "native two-touch wheel-suppression corridor is clear");
      const points = (gap) => [0, 1].map((id) => ({ id,
        x: center.x + (id ? 1 : -1) * gap / 2, y: center.y,
        radiusX: 4, radiusY: 4, force: 1 }));
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(80) });
      assert.equal(await observer.evaluate((item) => item.touchCount()), 2,
        "two native touch pointers reached the canvas");
      const before = await settled();
      for (const mode of [0, 1, 2]) {
        await dispatch(equivalent(48, mode), mode);
        equal(before, await settled(), `mode ${mode}: wheel ignored during active pinch`);
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(160) });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      const pinched = await settled();
      assert.ok(relativeGap(before.geometry, pinched.geometry) > 1e-5, "native pinch changes rendered zoom");
      await reset();
      await dispatch(Math.log(0.5) / 0.0016);
      equal(pinched, await settled(), "80-to-160 pinch retains the existing half-distance result");
      await dispatch(48);
      assert.ok(relativeGap(pinched.geometry, (await settled()).geometry) > 1e-5,
        "wheel responds again after touch release");

      const farSolar = async () => {
        await reset();
        await dispatch(Math.log(CONFIG.solarMaxDistance / CONFIG.cameraDistance) / 0.0016);
        return settled();
      };
      const point = (id, x, y) => ({ id, x, y, radiusX: 4, radiusY: 4, force: 1 });
      const send = (type, touchPoints) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
      await farSolar();
      const referenceCenter = await page.evaluate(() => {
        const canvas = document.querySelector("#viewport");
        for (const y of [0.65, 0.52, 0.28, 0.38]) {
          const x = innerWidth / 2, cy = innerHeight * y;
          if ([-40, 40].every((dx) => document.elementFromPoint(x + dx, cy) === canvas)) return { x, y: cy };
        }
        return null;
      });
      assert.ok(referenceCenter, "far-solar reference starts both fingers on canvas");
      const referencePoints = (gap) => [
        point(0, referenceCenter.x - gap / 2, referenceCenter.y),
        point(1, referenceCenter.x + gap / 2, referenceCenter.y),
      ];
      await send("touchStart", referencePoints(80));
      await send("touchMove", referencePoints(160));
      await send("touchEnd", []);
      const canvasPinch = await settled();

      for (const labelFirst of [true, false]) {
        const before = await farSolar();
        const target = await page.evaluate(() => {
          const canvas = document.querySelector("#viewport");
          for (const label of document.querySelectorAll('.sky-label:not([hidden])')) {
            if (!label.style.transform.includes("translateX(")) continue;
            const box = label.getBoundingClientRect();
            const x = box.x + box.width / 2, y = box.y + box.height / 2;
            for (const direction of [-1, 1]) {
              const other = x + direction * 80, end = x + direction * 160;
              if (end > 8 && end < innerWidth - 8
                && document.elementFromPoint(x, y) === label
                && document.elementFromPoint(other, y) === canvas) {
                return { id: label.dataset.bodyId, x, y, other, end };
              }
            }
          }
          return null;
        });
        assert.ok(target, "mixed pinch begins on an actually displaced label and the canvas");
        const labelPoint = point(0, target.x, target.y);
        const canvasPoint = point(1, target.other, target.y);
        const starts = (await observer.evaluate((item) => item.touchStarts())).length;
        await send("touchStart", [labelFirst ? labelPoint : canvasPoint]);
        await send("touchStart", [labelPoint, canvasPoint]);
        assert.deepEqual((await observer.evaluate((item) => item.touchStarts())).slice(starts),
          labelFirst ? [target.id, "canvas"] : ["canvas", target.id],
          "native pointer events actually begin on both intended surfaces");
        await send("touchMove", [labelPoint, point(1, target.end, target.y)]);
        // CDP touchEnd releases all points; the live-handler regression covers
        // the separate finger-release orders and subsequent lost capture.
        await send("touchEnd", []);
        const mixedPinch = await settled();
        assert.ok(relativeGap(canvasPinch.geometry, mixedPinch.geometry) <= 1e-6,
          `${labelFirst ? "label" : "canvas"}-first pinch matches canvas camera input`);
        assert.deepEqual(mixedPinch.ui, before.ui, "mixed pinch cannot select its starting label");

        // Start the same mixed gesture again, then let Chromium cancel it.
        const cancelBefore = await farSolar();
        const cancelStarts = (await observer.evaluate((item) => item.touchStarts())).length;
        await send("touchStart", [labelFirst ? labelPoint : canvasPoint]);
        await send("touchStart", [labelPoint, canvasPoint]);
        assert.deepEqual((await observer.evaluate((item) => item.touchStarts())).slice(cancelStarts),
          labelFirst ? [target.id, "canvas"] : ["canvas", target.id],
          "cancel regression still begins on the intended label and canvas after reset");
        await send("touchCancel", []);
        equal(cancelBefore, await settled(), "canceled mixed touches neither select nor move the scene");
        await page.touchscreen.tap(target.x, target.y);
        await page.locator("#body-card:not([hidden])").waitFor();
        assert.equal(await page.locator("#card-name").textContent(), findBody(target.id).name,
          "a fresh native label tap works after pinch cancellation");

        const dragBefore = await farSolar();
        const dragStarts = (await observer.evaluate((item) => item.touchStarts())).length;
        await send("touchStart", [labelPoint]);
        assert.deepEqual((await observer.evaluate((item) => item.touchStarts())).slice(dragStarts), [target.id],
          "lone-label drag begins on the displaced label after reset");
        await send("touchMove", [point(0,
          target.x + Math.sign(target.other - target.x) * (CONFIG.tapMovePx + 8), target.y)]);
        await send("touchEnd", []);
        equal(dragBefore, await settled(), "lone-label drag neither selects nor moves the scene");
        await page.touchscreen.tap(target.x, target.y);
        await page.locator("#body-card:not([hidden])").waitFor();
        assert.equal(await page.locator("#card-name").textContent(), findBody(target.id).name,
          "a fresh native label tap works after dragging past tap slop");
      }
    } else {
      const focusFloor = async (id) => {
        await reset();
        await page.locator(`[data-body-id="${id}"]`).evaluate((label) => label.click());
        await dispatch(-10000);
        return settled();
      };
      const cases = [
        { name: "solar outward", prepare: reset, pixels: 48, solar: /the Sun/ },
        { name: "solar inward", prepare: reset, pixels: -48, solar: /the Sun/ },
        { name: "Jupiter floor", prepare: () => focusFloor("jupiter"), pixels: -48, same: true, solar: /Jupiter/ },
        { name: "leave Jupiter floor", prepare: () => focusFloor("jupiter"), pixels: 48, solar: /Jupiter/ },
        { name: "selected Earth crosses Solar boundary", prepare: async () => {
          await focusFloor("earth");
          return pixelSeat(minimumFocusDistance(visualBodyRadius(findBody("earth"))),
            CONFIG.solarMaxDistance / Math.exp(24 * 0.0016));
        }, pixels: 48, extra: true },
        { name: "return across Solar boundary", prepare: async () => {
          await reset();
          return pixelSeat(CONFIG.cameraDistance, CONFIG.solarMaxDistance * Math.exp(24 * 0.0016));
        }, pixels: -48, solar: /the Sun/ },
        { name: "maximum clamp", prepare: async () => {
          await reset(); await dispatch(10000); return settled();
        }, pixels: 48, same: true, maximum: true },
        { name: "leave maximum", prepare: async () => {
          await reset(); await dispatch(10000); return settled();
        }, pixels: -48, maximum: true },
      ];
      for (const test of cases) {
        let reference;
        for (const mode of [0, 1, 2]) {
          const before = await test.prepare();
          await dispatch(equivalent(test.pixels, mode), mode);
          const after = await settled();
          if (test.same) equal(before, after, `${test.name}: finite limit holds`);
          else assert.ok(relativeGap(before.geometry, after.geometry) > 1e-5, `${test.name}: input actually moves camera`);
          if (test.solar) {
            assert.match(after.ui.scene, /^Solar system\./);
            assert.match(after.ui.scene, test.solar);
          }
          if (test.extra) {
            assert.match(after.ui.scene, /^Leaving the solar system/);
            assert.equal(after.ui.cardHidden, true, "outbound boundary clears the selected Earth card");
          }
          if (test.maximum) assert.match(after.ui.scene, /^Schematic observable universe\./);
          if (reference) equal(reference, after, `${test.name}: pixel and mode ${mode} agree`);
          else reference = after;
        }
      }
      await reset();
      const neutral = await settled();
      for (const mode of [0, 1, 2]) {
        for (const value of [0, NaN, Infinity, -Infinity]) {
          await dispatch(value, mode);
          equal(neutral, await settled(), `mode ${mode}: ${value} is a safe no-op`);
        }
      }
      for (const direction of [-1, 1]) {
        await reset(); await dispatch(direction * 10000);
        const limit = await settled();
        for (const mode of [0, 1, 2]) {
          await reset(); await dispatch(direction * Number.MAX_VALUE, mode);
          equal(limit, await settled(), `mode ${mode}: extreme input retains the finite ${direction} limit`);
        }
      }
      await reset(); await dispatch(48); const ordinary = await settled();
      await reset(); await dispatch(48, 0, true);
      equal(ordinary, await settled(), "browser ctrl-wheel pinch retains the pixel curve");
    }
    assert.deepEqual(errors, [], `wheel delta modes ${touch ? "touch" : "desktop"} has no browser errors`);
    console.log(`wheel delta modes ${touch ? "touch" : "desktop"} ok`);
  } finally {
    if (cdp) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }).catch(() => {});
      await cdp.detach().catch(() => {});
    }
    if (observer) {
      await observer.evaluate((item) => item.restore()).catch(() => {});
      await observer.dispose().catch(() => {});
    }
    await context.close();
  }
}

async function waitForTwoAnimationFrames(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => {
    requestAnimationFrame(resolve);
  })));
}

async function unobstructedCanvasPoint(page, candidates, spread = 0) {
  return page.locator("#viewport").evaluate((viewport, options) => {
    const box = viewport.getBoundingClientRect();
    for (const [x, y] of options.candidates) {
      const clientX = box.left + box.width * x;
      const clientY = box.top + box.height * y;
      if ([-options.spread, 0, options.spread].every((offset) => (
        document.elementFromPoint(clientX + offset, clientY) === viewport
      ))) {
        return { x: clientX, y: clientY };
      }
    }
    return null;
  }, { candidates, spread });
}

async function touchPinch(page, cdp, startGap, endGap, label) {
  const spread = Math.max(startGap, endGap) / 2;
  const center = await unobstructedCanvasPoint(
    page,
    [[0.5, 0.38], [0.5, 0.52], [0.5, 0.28], [0.5, 0.65]],
    spread,
  );
  assert.ok(center, `${label} has an unobstructed pinch corridor`);
  const touches = (gap) => [
    { id: 0, x: center.x - gap / 2, y: center.y, radiusX: 4, radiusY: 4, force: 1 },
    { id: 1, x: center.x + gap / 2, y: center.y, radiusX: 4, radiusY: 4, force: 1 },
  ];
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: touches(startGap),
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: touches(endGap),
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await waitForTwoAnimationFrames(page);
}

async function selectionSnapshot(page) {
  return page.evaluate(() => ({
    cardHidden: document.querySelector("#body-card").hidden,
    cardName: document.querySelector("#card-name").textContent,
    status: document.querySelector("#status-live").textContent,
    context: document.querySelector("#scene-context").textContent,
  }));
}

async function setSkyLabelPointerEvents(page, pointerEvents) {
  await page.locator(".sky-label").evaluateAll((labels, value) => {
    for (const label of labels) label.style.pointerEvents = value;
  }, pointerEvents);
}

async function dispatchCanvasPointer(page, type, { pointerId, x, y, pointerType = "mouse" }) {
  await page.locator("#viewport").evaluate((canvas, input) => {
    canvas.dispatchEvent(new PointerEvent(input.type, {
      bubbles: true,
      cancelable: true,
      pointerId: input.pointerId,
      pointerType: input.pointerType,
      isPrimary: input.pointerId === 1,
      clientX: input.x,
      clientY: input.y,
      buttons: input.type === "pointerdown" || input.type === "pointermove" ? 1 : 0,
    }));
  }, { type, pointerId, x, y, pointerType });
}

async function beginCanvasPointer(page, point, cdp, touchId = 0) {
  await page.evaluate(() => {
    window.__heliosPointerDownId = null;
    document.querySelector("#viewport").addEventListener(
      "pointerdown",
      (event) => {
        window.__heliosPointerDownId = event.pointerId;
      },
      { once: true },
    );
  });
  if (cdp) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{
        id: touchId,
        x: point.x,
        y: point.y,
        radiusX: 4,
        radiusY: 4,
        force: 1,
      }],
    });
  } else {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  }
  await page.waitForFunction(() => window.__heliosPointerDownId != null);
  return page.evaluate(() => window.__heliosPointerDownId);
}

async function moveCanvasPointer(page, point, pointerId, cdp, touchId = 0) {
  if (cdp) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{
        id: touchId,
        x: point.x,
        y: point.y,
        radiusX: 4,
        radiusY: 4,
        force: 1,
      }],
    });
    return;
  }
  await page.mouse.move(point.x, point.y);
  await dispatchCanvasPointer(page, "pointermove", { pointerId, x: point.x, y: point.y });
}

async function endCanvasPointer(page, cdp) {
  if (cdp) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }).catch(() => {});
    return;
  }
  await page.mouse.up();
}

async function clickCanvasPoint(page, point, cdp) {
  if (cdp) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 0, x: point.x, y: point.y, radiusX: 4, radiusY: 4, force: 1 }],
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    return;
  }
  await page.mouse.click(point.x, point.y);
}

async function findCanvasPickPoint(page, cdp) {
  const candidates = [
    [0.5, 0.5], [0.5, 0.46], [0.48, 0.5], [0.52, 0.52], [0.5, 0.42], [0.46, 0.48],
  ];
  for (const [xFrac, yFrac] of candidates) {
    const point = await unobstructedCanvasPoint(page, [[xFrac, yFrac]]);
    if (!point) continue;
    await clickCanvasPoint(page, point, cdp);
    await waitForTwoAnimationFrames(page);
    const snapshot = await selectionSnapshot(page);
    if (!snapshot.cardHidden) {
      await page.locator("#reset-button").click();
      await page.locator("#body-card[hidden]").waitFor({ state: "attached" });
      await waitForTwoAnimationFrames(page);
      return { point, cardName: snapshot.cardName };
    }
  }
  return null;
}

async function auditPointerCancelAbort(context, prefix, touch = false) {
  const page = await context.newPage();
  const errors = captureErrors(page);
  let cdp;
  try {
    await openReady(page);
    if (await page.locator("#play-button").getAttribute("aria-pressed") === "true") {
      await page.locator("#play-button").click();
    }
    await page.locator("#reset-button").click();
    if (touch) cdp = await context.newCDPSession(page);
    await setSkyLabelPointerEvents(page, "none");

    const pick = await findCanvasPickPoint(page, cdp);
    assert.ok(pick, `${prefix}: canvas has a point that would select a body`);

    const assertUnchanged = async (label, before) => {
      await waitForTwoAnimationFrames(page);
      assert.deepEqual(
        await selectionSnapshot(page),
        before,
        `${prefix} ${label} must not select, clear, or retarget focus/card`,
      );
    };

    const abortAt = async (label, point, afterStart, type = "pointercancel") => {
      const before = await selectionSnapshot(page);
      const pointerId = await beginCanvasPointer(page, point, cdp);
      if (afterStart) await afterStart(pointerId, point);
      await dispatchCanvasPointer(page, type, {
        pointerId,
        x: point.x,
        y: point.y,
        pointerType: touch ? "touch" : "mouse",
      });
      await endCanvasPointer(page, cdp);
      await assertUnchanged(label, before);
    };

    await abortAt("pointercancel during tap", pick.point);
    await abortAt("pointercancel after sub-threshold move", pick.point, async (pointerId, point) => {
      await moveCanvasPointer(
        page,
        { x: point.x + Math.min(6, CONFIG.tapMovePx - 2), y: point.y },
        pointerId,
        cdp,
      );
    });
    await abortAt("lostpointercapture during tap", pick.point, async (pointerId) => {
      await page.locator("#viewport").evaluate((canvas, id) => {
        if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
      }, pointerId);
    }, "lostpointercapture");

    await abortAt("pointercancel during drag", pick.point, async (pointerId, point) => {
      await moveCanvasPointer(
        page,
        { x: point.x + CONFIG.tapMovePx + 28, y: point.y + 16 },
        pointerId,
        cdp,
      );
    });

    await page.locator("#reset-button").click();
    await page.evaluate((id) => document.querySelector(`[data-body-id="${id}"]`).click(), "earth");
    await page.locator("#body-card:not([hidden])").waitFor();
    assert.equal(await page.locator("#card-name").textContent(), "Earth");

    const missCandidates = [
      [0.08, 0.22], [0.92, 0.22], [0.08, 0.78], [0.92, 0.78],
      [0.1, 0.5], [0.9, 0.5], [0.5, 0.14], [0.5, 0.86],
    ];
    let miss = null;
    for (const candidate of missCandidates) {
      const point = await unobstructedCanvasPoint(page, [candidate]);
      if (!point) continue;
      await clickCanvasPoint(page, point, cdp);
      await waitForTwoAnimationFrames(page);
      if ((await selectionSnapshot(page)).cardHidden) {
        miss = point;
        await page.evaluate((id) => document.querySelector(`[data-body-id="${id}"]`).click(), "earth");
        await page.locator("#body-card:not([hidden])").waitFor();
        break;
      }
    }
    assert.ok(miss, `${prefix}: focused Earth still has an empty-space canvas point`);

    await abortAt("pointercancel over empty space with a card open", miss);

    {
      const before = await selectionSnapshot(page);
      const touches = (gap) => [
        { id: 0, x: miss.x - gap / 2, y: miss.y, radiusX: 4, radiusY: 4, force: 1 },
        { id: 1, x: miss.x + gap / 2, y: miss.y, radiusX: 4, radiusY: 4, force: 1 },
      ];
      let ids;
      if (cdp) {
        await page.evaluate(() => {
          window.__heliosPinchIds = [];
          const canvas = document.querySelector("#viewport");
          const onDown = (event) => {
            window.__heliosPinchIds.push(event.pointerId);
            if (window.__heliosPinchIds.length >= 2) canvas.removeEventListener("pointerdown", onDown);
          };
          canvas.addEventListener("pointerdown", onDown);
        });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touches(80) });
        await page.waitForFunction(() => window.__heliosPinchIds.length >= 2, null, { timeout: 5_000 });
        ids = await page.evaluate(() => window.__heliosPinchIds.slice());
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: touches(96),
        });
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchCancel",
          touchPoints: touches(96),
        }).catch(() => {});
      } else {
        ids = [101, 102];
        await dispatchCanvasPointer(page, "pointerdown", {
          pointerId: 101, x: miss.x - 40, y: miss.y, pointerType: "touch",
        });
        await dispatchCanvasPointer(page, "pointerdown", {
          pointerId: 102, x: miss.x + 40, y: miss.y, pointerType: "touch",
        });
        await dispatchCanvasPointer(page, "pointermove", {
          pointerId: 101, x: miss.x - 48, y: miss.y, pointerType: "touch",
        });
        await dispatchCanvasPointer(page, "pointermove", {
          pointerId: 102, x: miss.x + 48, y: miss.y, pointerType: "touch",
        });
      }
      for (const pointerId of ids) {
        await dispatchCanvasPointer(page, "pointercancel", {
          pointerId,
          x: miss.x,
          y: miss.y,
          pointerType: "touch",
        });
      }
      await endCanvasPointer(page, cdp);
      await assertUnchanged("pointercancel during two-pointer pinch", before);
    }

    await abortAt("pointercancel during drag with a card open", miss, async (pointerId, point) => {
      await moveCanvasPointer(
        page,
        { x: point.x + CONFIG.tapMovePx + 36, y: point.y },
        pointerId,
        cdp,
      );
    });

    await page.locator("#reset-button").click();
    await page.locator("#body-card[hidden]").waitFor({ state: "attached" });
    await waitForMoonCameraSettled(page);
    const stillPicks = await findCanvasPickPoint(page, cdp);
    assert.ok(stillPicks, `${prefix}: ordinary tap selection still works after abort cleanup`);
    assert.equal(
      stillPicks.cardName,
      pick.cardName,
      `${prefix}: ordinary tap selection still works after abort cleanup`,
    );

    await page.evaluate((id) => document.querySelector(`[data-body-id="${id}"]`).click(), "earth");
    await page.locator("#body-card:not([hidden])").waitFor();
    await waitForMoonCameraSettled(page);
    let cleared = false;
    for (const candidate of missCandidates) {
      const point = await unobstructedCanvasPoint(page, [candidate]);
      if (!point) continue;
      await clickCanvasPoint(page, point, cdp);
      await waitForTwoAnimationFrames(page);
      if ((await selectionSnapshot(page)).cardHidden) {
        cleared = true;
        break;
      }
      await page.evaluate((id) => document.querySelector(`[data-body-id="${id}"]`).click(), "earth");
      await page.locator("#body-card:not([hidden])").waitFor();
    }
    assert.equal(cleared, true, `${prefix}: ordinary empty-space tap still clears after abort cleanup`);
    assert.equal(
      await page.locator("#status-live").textContent(),
      "Selection cleared",
      `${prefix}: ordinary empty-space tap still clears after abort cleanup`,
    );

    await setSkyLabelPointerEvents(page, "");
    assert.deepEqual(errors, [], `${prefix} pointer-cancel abort has no browser errors`);
  } finally {
    if (cdp) await cdp.detach().catch(() => {});
    await page.close();
  }
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

async function dispatchBoundaryWheel(page, deltaY) {
  await page.locator("#viewport").evaluate((canvas, delta) => {
    canvas.dispatchEvent(new WheelEvent("wheel", {
      deltaY: delta,
      bubbles: true,
      cancelable: true,
    }));
  }, deltaY);
}

async function auditDeepLoadingFailure(context, prefix) {
  const source = await readFile(path.join(root, "js/galaxy.js"), "utf8");
  const entry = "export function startGalaxyLayer(THREE) {";
  assert.equal(source.split(entry).length, 2, "one deferred layer entry for fault injection");
  for (const failAt of ["start", "advance"]) {
    const page = await context.newPage();
    const errors = captureErrors(page);
    try {
      await page.route("**/js/galaxy.js", (route) => route.fulfill({
        contentType: "text/javascript",
        body: source.replace(entry, `${entry}
          globalThis.__heliosBuildFailure.attempts += 1;
          if (${JSON.stringify(failAt)} === "start") throw new Error("Injected layer start failure");
          return { done: false, advance() { throw new Error("Injected layer advance failure"); } };
        `),
      }));
      await openReady(page);
      await page.locator("#play-button").click();
      await page.evaluate(() => {
        const status = document.querySelector("#status-live");
        globalThis.__heliosBuildFailure = { attempts: 0, announcements: 0 };
        new MutationObserver(() => {
          if (status.textContent === "Deep sky unavailable.") {
            globalThis.__heliosBuildFailure.announcements += 1;
          }
        }).observe(status, { childList: true, characterData: true, subtree: true });
      });
      for (let entryCount = 0; entryCount < 3; entryCount += 1) {
        await dispatchBoundaryWheel(page, 2_400);
        if (entryCount === 0) {
          await page.waitForFunction(() => globalThis.__heliosBuildFailure.announcements > 0);
        }
        await page.evaluate(() => new Promise((resolve) => {
          let frames = 0;
          const tick = () => { if (++frames === 30) resolve(); else requestAnimationFrame(tick); };
          requestAnimationFrame(tick);
        }));
        const result = await page.evaluate(() => ({
          ...globalThis.__heliosBuildFailure,
          loading: !document.querySelector("#loading").hidden,
          busy: document.querySelector("#viewport").getAttribute("aria-busy"),
          galaxyReady: document.documentElement.dataset.galaxyReady === "1",
        }));
        assert.deepEqual(result, {
          attempts: 1, announcements: 1, loading: false, busy: "false", galaxyReady: false,
        }, `${prefix} ${failAt}: failure stays latched after entry ${entryCount + 1}`);
        await page.locator("#reset-button").click();
      }
      assert.deepEqual(errors, [], `${prefix} ${failAt}: the application handles the injected failure`);
      console.log(`deep-load failure latch ${prefix}/${failAt}: three entries, 30 continued frames each, one attempt/announcement, idle and not ready`);
    } finally {
      await page.close();
    }
  }
}

async function auditStagedDeepLoading(context, prefix, touch = false) {
  await auditDeepLoadingFailure(context, prefix);
  const page = await context.newPage();
  const errors = captureErrors(page);
  await openReady(page);
  if (await page.locator("#play-button").getAttribute("aria-pressed") === "true") {
    if (touch) await page.locator("#play-button").tap();
    else await page.locator("#play-button").click();
  }
  assert.equal(await page.getAttribute("html", "data-galaxy-ready"), null, `${prefix}: default startup keeps the deferred galaxy layer lazy`);
  assert.equal(await page.locator("#loading").getAttribute("hidden"), "");
  assert.equal(await page.locator("#viewport").getAttribute("aria-busy"), "false");
  await page.locator("#viewport").focus();
  assert.notEqual(
    await page.evaluate(() => document.activeElement?.id),
    "loading",
    `${prefix}: loading chrome is not a focus target`,
  );

  await page.evaluate(() => {
    const canvas = document.querySelector("#viewport");
    const loading = document.querySelector("#loading");
    const live = document.querySelector("#status-live");
    const longTasks = [];
    let observer = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({ duration: entry.duration, startTime: entry.startTime });
        }
      });
      observer.observe({ type: "longtask" });
    } catch {
      observer = null;
    }
    globalThis.__heliosStagingAudit = {
      longTasks,
      disconnect() { observer?.disconnect(); },
      snapshot() {
        return {
          loading: !loading.hidden,
          busy: canvas.getAttribute("aria-busy"),
          galaxyReady: document.documentElement.dataset.galaxyReady === "1",
          status: live.textContent,
          focus: document.activeElement?.id || document.activeElement?.dataset.bodyId || null,
        };
      },
    };
  });

  const firstCrossing = await page.evaluate((budgetMs) => {
    const audit = globalThis.__heliosStagingAudit;
    const started = performance.now();
    document.querySelector("#viewport").dispatchEvent(new WheelEvent("wheel", {
      deltaY: 2_400,
      bubbles: true,
      cancelable: true,
    }));
    const handlerEnd = performance.now();
    return { handlerMs: handlerEnd - started, handlerEnd, budgetMs, ...audit.snapshot() };
  }, CONFIG.inputFrameBudgetMs);
  assert.ok(
    firstCrossing.handlerMs <= CONFIG.inputFrameBudgetMs,
    `${prefix}: first boundary wheel returned in ${firstCrossing.handlerMs}ms, budget ${CONFIG.inputFrameBudgetMs}ms`,
  );
  assert.equal(firstCrossing.galaxyReady, false, `${prefix}: boundary input does not finish the galaxy layer inline`);
  assert.equal(firstCrossing.loading, true, `${prefix}: loading chrome is visible before remaining work`);
  assert.equal(firstCrossing.busy, "true", `${prefix}: viewport is busy while deep prep is pending`);
  assert.equal(firstCrossing.status, "Loading", `${prefix}: loading is announced once at first show`);
  assert.notEqual(firstCrossing.focus, "loading", `${prefix}: showing loading does not steal focus`);

  await waitForTwoAnimationFrames(page);
  const afterPaint = await page.evaluate(() => globalThis.__heliosStagingAudit.snapshot());
  assert.equal(afterPaint.galaxyReady, false, `${prefix}: first paint yield happens before the layer is usable`);
  assert.equal(afterPaint.loading, true, `${prefix}: loading remains visible after the first paint yield`);
  await saveScreenshot(page, `${prefix}-deep-loading`);

  await page.waitForFunction(
    () => document.documentElement.dataset.galaxyReady === "1"
      && document.querySelector("#loading").hidden
      && document.querySelector("#viewport").getAttribute("aria-busy") === "false",
    null,
    { timeout: 20_000 },
  );
  const ready = await page.evaluate(() => {
    const audit = globalThis.__heliosStagingAudit;
    audit.disconnect();
    return { ...audit.snapshot(), longTasks: audit.longTasks.slice() };
  });
  assert.equal(ready.loading, false, `${prefix}: loading hides once the layer is usable`);
  assert.equal(ready.busy, "false");
  assert.notEqual(ready.status, "Loading", `${prefix}: loading is not re-announced after it is ready`);
  const blockingDuringHandler = ready.longTasks.filter((entry) => entry.startTime < firstCrossing.handlerEnd);
  assert.deepEqual(
    blockingDuringHandler,
    [],
    `${prefix}: no long task ran inside the boundary handler: ${JSON.stringify(ready.longTasks)}`,
  );
  console.log(`${prefix} staged deep loading: handler ${firstCrossing.handlerMs}ms, longTasks ${JSON.stringify(ready.longTasks)}`);

  const cancelPage = await context.newPage();
  const cancelErrors = captureErrors(cancelPage);
  await openReady(cancelPage);
  if (await cancelPage.locator("#play-button").getAttribute("aria-pressed") === "true") {
    if (touch) await cancelPage.locator("#play-button").tap();
    else await cancelPage.locator("#play-button").click();
  }
  await cancelPage.locator("#viewport").focus();
  const reversal = await cancelPage.evaluate(() => {
    const canvas = document.querySelector("#viewport");
    const loading = document.querySelector("#loading");
    const started = performance.now();
    canvas.dispatchEvent(new WheelEvent("wheel", {
      deltaY: 2_400,
      bubbles: true,
      cancelable: true,
    }));
    const outboundMs = performance.now() - started;
    const outbound = {
      loading: !loading.hidden,
      busy: canvas.getAttribute("aria-busy"),
      galaxyReady: document.documentElement.dataset.galaxyReady === "1",
    };
    const inboundStarted = performance.now();
    canvas.dispatchEvent(new WheelEvent("wheel", {
      deltaY: -2_400,
      bubbles: true,
      cancelable: true,
    }));
    return {
      outboundMs,
      inboundMs: performance.now() - inboundStarted,
      outbound,
      inbound: {
        loading: !loading.hidden,
        busy: canvas.getAttribute("aria-busy"),
        galaxyReady: document.documentElement.dataset.galaxyReady === "1",
        skyHidden: document.querySelector("#sky-control").hidden,
      },
    };
  });
  assert.ok(reversal.outboundMs <= CONFIG.inputFrameBudgetMs, `${prefix} reversal outbound ${reversal.outboundMs}ms`);
  assert.ok(reversal.inboundMs <= CONFIG.inputFrameBudgetMs, `${prefix} reversal inbound ${reversal.inboundMs}ms`);
  assert.equal(reversal.outbound.loading, true, `${prefix}: outbound reversal path shows loading`);
  assert.equal(reversal.inbound.loading, false, `${prefix}: reversing into Solar hides loading`);
  assert.equal(reversal.inbound.busy, "false", `${prefix}: reversed Solar view is not kept busy`);
  assert.equal(reversal.inbound.skyHidden, false, `${prefix}: constellation control returns with the Solar sky`);
  await cancelPage.waitForFunction(
    () => document.documentElement.dataset.galaxyReady === "1",
    null,
    { timeout: 20_000 },
  );
  assert.equal(await cancelPage.locator("#loading").getAttribute("hidden"), "");
  const reuse = await cancelPage.evaluate((budgetMs) => {
    const canvas = document.querySelector("#viewport");
    const loading = document.querySelector("#loading");
    const started = performance.now();
    canvas.dispatchEvent(new WheelEvent("wheel", {
      deltaY: 2_400,
      bubbles: true,
      cancelable: true,
    }));
    return {
      handlerMs: performance.now() - started,
      budgetMs,
      loading: !loading.hidden,
      galaxyReady: document.documentElement.dataset.galaxyReady === "1",
      status: document.querySelector("#status-live").textContent,
    };
  }, CONFIG.inputFrameBudgetMs);
  assert.ok(reuse.handlerMs <= CONFIG.inputFrameBudgetMs, `${prefix} already-ready handler ${reuse.handlerMs}ms`);
  assert.equal(reuse.galaxyReady, true);
  assert.equal(reuse.loading, false, `${prefix}: already-ready transition has no artificial loading delay`);
  assert.notEqual(reuse.status, "Loading", `${prefix}: already-ready transition does not re-announce loading`);
  assert.deepEqual(cancelErrors, [], `${prefix} cancellation path has no browser errors`);
  await cancelPage.close();

  const resourcePage = await context.newPage();
  const resourceErrors = captureErrors(resourcePage);
  await openReady(resourcePage, "?look=solarfar");
  if (await resourcePage.locator("#play-button").getAttribute("aria-pressed") === "true") {
    if (touch) await resourcePage.locator("#play-button").tap();
    else await resourcePage.locator("#play-button").click();
  }
  assert.equal(await resourcePage.getAttribute("html", "data-galaxy-ready"), null);
  await resourcePage.evaluate(async () => {
    const THREE = await import(new URL("vendor/three.module.min.js", location.href).href);
    const prototype = THREE.Scene.prototype;
    const previous = prototype.onAfterRender;
    let latest = null;
    prototype.onAfterRender = function onAfterRender(renderer, scene) {
      if (typeof previous === "function") previous.call(this, renderer, scene);
      let galaxyCount = 0;
      let galaxyUuid = null;
      scene.traverse((object) => {
        if (object.name === "galaxy-layer") {
          galaxyCount += 1;
          galaxyUuid = object.uuid;
        }
      });
      latest = {
        textureCount: renderer.info.memory.textures,
        geometries: renderer.info.memory.geometries,
        galaxyCount,
        galaxyUuid,
        heap: performance.memory?.usedJSHeapSize ?? null,
      };
    };
    globalThis.__heliosGalaxyResourceAudit = {
      snapshot: () => (latest ? { ...latest } : null),
    };
  });
  await dispatchBoundaryWheel(resourcePage, 2_400);
  await resourcePage.waitForFunction(() => document.documentElement.dataset.galaxyReady === "1");
  const settleGalaxyResources = async () => {
    let previous = null;
    let stable = 0;
    let latest = null;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      await waitForTwoAnimationFrames(resourcePage);
      latest = await resourcePage.evaluate(() => globalThis.__heliosGalaxyResourceAudit.snapshot());
      if (
        latest
        && previous
        && latest.textureCount === previous.textureCount
        && latest.geometries === previous.geometries
        && latest.galaxyUuid === previous.galaxyUuid
      ) {
        stable += 1;
        if (stable >= 6) return latest;
      } else {
        stable = 0;
      }
      previous = latest;
    }
    return latest;
  };
  const first = await settleGalaxyResources();
  assert.equal(first?.galaxyCount, 1, `${prefix}: one canonical galaxy layer after first deep zoom`);
  let distance = CONFIG.solarMaxDistance * Math.exp(2_400 * 0.0016);
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await dispatchBoundaryWheel(resourcePage, Math.log(CONFIG.solarMaxDistance / distance) / 0.0016);
    distance = CONFIG.solarMaxDistance;
    await dispatchBoundaryWheel(resourcePage, Math.log((CONFIG.solarMaxDistance * Math.exp(2_400 * 0.0016)) / distance) / 0.0016);
    distance = CONFIG.solarMaxDistance * Math.exp(2_400 * 0.0016);
    const again = await settleGalaxyResources();
    assert.equal(again.galaxyCount, 1, `${prefix} cycle ${cycle + 1}: still one galaxy layer`);
    assert.equal(again.galaxyUuid, first.galaxyUuid, `${prefix} cycle ${cycle + 1}: galaxy singleton is reused`);
    assert.equal(again.geometries, first.geometries, `${prefix} cycle ${cycle + 1}: renderer geometry count plateaus`);
    assert.equal(again.textureCount, first.textureCount, `${prefix} cycle ${cycle + 1}: renderer texture count plateaus`);
    console.log(`${prefix} cycle ${cycle + 1}: geometries ${again.geometries}, textures ${again.textureCount}, heap ${again.heap}`);
  }
  assert.deepEqual(resourceErrors, [], `${prefix} singleton reuse has no browser errors`);
  await resourcePage.close();
  assert.deepEqual(errors, [], `${prefix} staged loading has no browser errors`);
  await page.close();
}

const M31_PLACEHOLDER_SIZE = 256;
const M31_LOADED_SIZE = { width: 384, height: 348 };

function placeholderDisposals(snapshot) {
  return (snapshot?.disposals ?? []).filter((entry) => (
    entry.isCanvas && entry.width === M31_PLACEHOLDER_SIZE && entry.height === M31_PLACEHOLDER_SIZE
  ));
}

async function installM31TextureAudit(page) {
  await page.evaluate(async () => {
    if (globalThis.__heliosM31TextureAudit) return;
    const THREE = await import(new URL("vendor/three.module.min.js", location.href).href);
    const originalDispose = THREE.Texture.prototype.dispose;
    const disposals = [];
    THREE.Texture.prototype.dispose = function disposeTexture() {
      const image = this.image || this.source?.data;
      disposals.push({
        uuid: this.uuid,
        width: image?.width ?? null,
        height: image?.height ?? null,
        isCanvas: typeof HTMLCanvasElement !== "undefined" && image instanceof HTMLCanvasElement,
      });
      return originalDispose.apply(this, arguments);
    };
    const prototype = THREE.Scene.prototype;
    const previous = prototype.onAfterRender;
    let latest = null;
    prototype.onAfterRender = function onAfterRender(renderer, scene, camera) {
      if (typeof previous === "function") previous.call(this, renderer, scene, camera);
      const layer = scene.getObjectByName("galaxy-layer");
      const sprite = scene.getObjectByName("m31");
      const map = sprite?.material?.map;
      const image = map?.image || map?.source?.data;
      latest = {
        textureCount: renderer.info.memory.textures,
        galaxyUuid: layer?.uuid ?? null,
        m31: sprite ? {
          uuid: map?.uuid ?? null,
          width: image?.width ?? null,
          height: image?.height ?? null,
          isCanvas: typeof HTMLCanvasElement !== "undefined" && image instanceof HTMLCanvasElement,
        } : null,
      };
    };
    globalThis.__heliosM31TextureAudit = {
      snapshot: () => ({
        textureCount: latest?.textureCount ?? null,
        galaxyUuid: latest?.galaxyUuid ?? null,
        m31: latest?.m31 ? { ...latest.m31 } : null,
        disposals: disposals.map((entry) => ({ ...entry })),
      }),
    };
  });
}

async function waitForM31TextureAudit(page, predicate, message) {
  let last = null;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    await waitForTwoAnimationFrames(page);
    last = await page.evaluate(() => globalThis.__heliosM31TextureAudit.snapshot());
    if (last && predicate(last)) return last;
  }
  assert.fail(`${message}: ${JSON.stringify(last)}`);
}

async function auditM31PlaceholderDisposal(context) {
  const successPage = await context.newPage();
  const successErrors = captureErrors(successPage);
  await openReady(successPage, "?look=solarfar");
  if (await successPage.locator("#play-button").getAttribute("aria-pressed") === "true") {
    await successPage.locator("#play-button").click();
  }
  assert.equal(await successPage.getAttribute("html", "data-galaxy-ready"), null);
  await installM31TextureAudit(successPage);
  await zoomBetweenAuditDistances(successPage, CONFIG.solarMaxDistance, CONFIG.neighborhoodViewDistance);
  await successPage.waitForFunction(() => document.documentElement.dataset.galaxyReady === "1");
  await waitForM31TextureAudit(
    successPage,
    (snapshot) => snapshot.m31?.width === M31_LOADED_SIZE.width
      && snapshot.m31?.height === M31_LOADED_SIZE.height
      && placeholderDisposals(snapshot).length === 1,
    "successful M31 load should replace the 256 canvas placeholder and dispose it once",
  );
  await waitForTwoAnimationFrames(successPage);
  await waitForTwoAnimationFrames(successPage);
  const replaced = await successPage.evaluate(() => globalThis.__heliosM31TextureAudit.snapshot());
  const placeholder = placeholderDisposals(replaced);
  assert.equal(placeholder.length, 1, `placeholder disposed once: ${JSON.stringify(replaced.disposals)}`);
  assert.notEqual(replaced.m31.uuid, placeholder[0].uuid, "the visible M31 map is not the disposed placeholder");
  assert.equal(replaced.m31.isCanvas, true, "the loaded M31 map remains the brightened canvas sprite");
  assert.equal(
    replaced.disposals.filter((entry) => entry.uuid === replaced.m31.uuid).length,
    0,
    "the real loaded M31 map is not disposed",
  );
  const galaxyUuid = replaced.galaxyUuid;
  const textureCount = replaced.textureCount;
  assert.ok(galaxyUuid, "galaxy singleton exists after the first outbound zoom");
  assert.ok(textureCount > 0, "renderer reports live textures after replacement");
  await saveScreenshot(successPage, "desktop-m31-placeholder-disposed");

  let distance = CONFIG.neighborhoodViewDistance;
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await zoomBetweenAuditDistances(successPage, distance, CONFIG.solarMaxDistance);
    distance = CONFIG.solarMaxDistance;
    await zoomBetweenAuditDistances(successPage, distance, CONFIG.neighborhoodViewDistance);
    distance = CONFIG.neighborhoodViewDistance;
    const again = await waitForM31TextureAudit(
      successPage,
      (snapshot) => snapshot.galaxyUuid === galaxyUuid
        && snapshot.m31?.uuid === replaced.m31.uuid
        && placeholderDisposals(snapshot).length === 1,
      "repeated Solar/deep transitions must keep the galaxy singleton and skip a second placeholder dispose",
    );
    assert.equal(again.galaxyUuid, galaxyUuid, "galaxy layer remains the same singleton");
    assert.equal(again.m31.uuid, replaced.m31.uuid, "the loaded M31 map is reused");
    assert.equal(placeholderDisposals(again).length, 1, "placeholder dispose stays one-shot");
    assert.equal(again.textureCount, textureCount, "GPU texture count does not grow across zoom cycles");
  }
  assert.deepEqual(successErrors, [], "M31 placeholder disposal success path has no browser errors");
  await successPage.close();

  const failurePage = await context.newPage();
  const failureErrors = [];
  failurePage.on("pageerror", (error) => failureErrors.push(`page: ${error.message}`));
  failurePage.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.includes("andromeda.png") || text.includes("net::ERR_FAILED")) return;
    failureErrors.push(`console: ${text}`);
  });
  failurePage.on("requestfailed", (request) => {
    if (request.url().includes("andromeda.png")) return;
    failureErrors.push(`request: ${request.url()} ${request.failure()?.errorText ?? "failed"}`);
  });
  await failurePage.route("**/assets/sky/andromeda.png", (route) => route.abort());
  await openReady(failurePage, "?look=solarfar");
  if (await failurePage.locator("#play-button").getAttribute("aria-pressed") === "true") {
    await failurePage.locator("#play-button").click();
  }
  await installM31TextureAudit(failurePage);
  await zoomBetweenAuditDistances(failurePage, CONFIG.solarMaxDistance, CONFIG.neighborhoodViewDistance);
  await failurePage.waitForFunction(() => document.documentElement.dataset.galaxyReady === "1");
  const fallback = await waitForM31TextureAudit(
    failurePage,
    (snapshot) => snapshot.m31?.width === M31_PLACEHOLDER_SIZE
      && snapshot.m31?.height === M31_PLACEHOLDER_SIZE
      && snapshot.m31?.isCanvas === true,
    "failed M31 load should keep the generated placeholder visible",
  );
  const fallbackUuid = fallback.m31.uuid;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await waitForTwoAnimationFrames(failurePage);
  }
  const retained = await failurePage.evaluate(() => globalThis.__heliosM31TextureAudit.snapshot());
  assert.equal(placeholderDisposals(retained).length, 0, "load failure does not dispose the visible placeholder");
  assert.equal(retained.m31.uuid, fallbackUuid, "the same placeholder map stays bound");
  assert.equal(retained.m31.width, M31_PLACEHOLDER_SIZE);
  assert.equal(retained.m31.height, M31_PLACEHOLDER_SIZE);
  assert.equal(retained.m31.isCanvas, true);
  await assertRenderedCanvas(failurePage);
  await saveScreenshot(failurePage, "desktop-m31-placeholder-retained");
  assert.deepEqual(failureErrors, [], "M31 placeholder retention on load failure has no unrelated browser errors");
  await failurePage.close();
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
  const start = await unobstructedCanvasPoint(page, [
    [0.28, 0.45], [0.72, 0.45], [0.5, 0.35], [0.15, 0.35], [0.85, 0.35],
  ]);
  assert.ok(start, "moon orbit drag has an unobstructed canvas start");
  const startX = start.x;
  const startY = start.y;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(
    startX + box.width * dxFrac,
    startY + box.height * dyFrac,
    { steps: 12 },
  );
  await page.mouse.up();
  await waitForTwoAnimationFrames(page);
}

function moonWorldOffset(body, days) {
  const parent = findBody(body.parent);
  const offset = keplerOffset(body, parent, days);
  if (moonOrbitAttachment(body) !== "parent-equatorial") return offset;
  const basis = bodyOrientationBasis(parent);
  const xAxis = equatorialVectorToScene(basis.xAxis);
  const yAxis = equatorialVectorToScene(basis.yAxis);
  const zAxis = equatorialVectorToScene(basis.zAxis);
  return {
    x: offset.x * xAxis.x + offset.y * zAxis.x - offset.z * yAxis.x,
    y: offset.x * xAxis.y + offset.y * zAxis.y - offset.z * yAxis.y,
    z: offset.x * xAxis.z + offset.y * zAxis.z - offset.z * yAxis.z,
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

async function touchOrbitBy(page, cdp, viewport, dx, dy) {
  let remainX = dx;
  let remainY = dy;
  for (let step = 0; step < 12 && (Math.abs(remainX) > 2 || Math.abs(remainY) > 2); step += 1) {
    const startXFraction = remainX < -2 ? 0.86 : remainX > 2 ? 0.14 : 0.5;
    const startYFraction = remainY < -2 ? 0.78 : remainY > 2 ? 0.22 : 0.4;
    const start = await unobstructedCanvasPoint(page, [
      [startXFraction, startYFraction],
      [startXFraction, 0.4],
      [0.5, startYFraction],
      [startXFraction, 0.55],
      [0.5, 0.35],
    ]);
    assert.ok(start, "moon touch orbit has an unobstructed canvas start");
    const startX = start.x;
    const startY = start.y;
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
  assert.ok(
    Math.abs(remainX) <= 2 && Math.abs(remainY) <= 2,
    `moon touch orbit applies its full delta (remaining ${remainX}, ${remainY})`,
  );
  await waitForTwoAnimationFrames(page);
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
    if (prefix === "desktop" && bodyId === "sun") {
      const earthLabel = page.locator('.sky-label[data-body-id="earth"]');
      await earthLabel.waitFor();
      await earthLabel.focus();
      assert.equal(
        await page.evaluate(() => document.activeElement?.dataset.bodyId),
        "earth",
        "the Earth label owns focus before its edge cull",
      );
    }
    await page.evaluate(
      (id) => document.querySelector(`[data-body-id="${id}"]`).click(),
      bodyId,
    );
    await page.locator("#body-card:not([hidden])").waitFor();

    if (cdp) {
      await touchPinch(page, cdp, 40, 370, `${prefix} ${bodyId} minimum zoom`);
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

    await waitForTwoAnimationFrames(page);
    await waitForMoonCameraSettled(page);
    await waitForCenteredBodyLabel(page, bodyId);
    await page.waitForTimeout(250);
    assert.equal(await page.locator("#card-name").textContent(), findBody(bodyId).name);
    await assertRenderedCanvas(page);
    await saveScreenshot(page, `${prefix}-minimum-zoom-${bodyId}`);
    if (["sun", "jupiter", "saturn"].includes(bodyId)) {
      await assertFocusedGlobeSurfaceVisible(page, `${prefix} ${bodyId}`);
    }
    await assertPersistentChromeContrast(page, `${prefix} ${bodyId}`);
    await assertVisibleBodyLabelsClearChrome(page, `${prefix} ${bodyId} minimum zoom`);
    if (prefix === "desktop" && bodyId === "sun") {
      assert.equal(
        await page.locator('.sky-label[data-body-id="earth"]').getAttribute("hidden"),
        "",
        "desktop Sun minimum zoom hides the unsafe Earth edge label",
      );
      assert.equal(
        await page.evaluate(() => document.activeElement?.id),
        "viewport",
        "hiding a focused edge label returns focus to the scene",
      );
      await page.locator("#viewport").evaluate((element) => element.blur());
    }
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
      ["#play-button", "#dock"],
      ["#slower-button", "#dock"],
      ["#faster-button", "#dock"],
      ["#speed-readout", "#dock"],
      ["#clock", "#dock"],
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
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      if (document.documentElement?.dataset.heliosReady !== "1") return;
      const play = document.querySelector("#play-button");
      if (play?.getAttribute("aria-pressed") === "true") play.click();
      globalThis.__heliosPausedAtReady = play?.getAttribute("aria-pressed") === "false";
      observer.disconnect();
    });
    observer.observe(document, {
      attributes: true,
      attributeFilter: ["data-helios-ready"],
      subtree: true,
    });
  });
  await openReady(page);
  const play = page.locator("#play-button");
  assert.equal(await play.getAttribute("aria-pressed"), "false");
  assert.equal(await page.evaluate(() => globalThis.__heliosPausedAtReady), true);
  const canvas = page.locator("#viewport");
  const cdp = touch ? await context.newCDPSession(page) : null;
  const bodies = touch
    ? ["moon", "phobos", "io", "triton"]
    : ["moon", "phobos", "deimos", "io", "europa", "ganymede", "callisto", "titan", "triton"];

  for (const bodyId of bodies) {
    await beginViewportBusyAudit(page);
    await page.locator("#reset-button").click();
    await page.evaluate(
      (id) => document.querySelector(`[data-body-id="${id}"]`).click(),
      bodyId,
    );
    await page.locator("#body-card:not([hidden])").waitFor();

    if (cdp) {
      await touchPinch(page, cdp, 40, 370, `${prefix} ${bodyId} parent close zoom`);
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

    if (bodyId === "io") {
      assert.equal(await canvas.getAttribute("aria-busy"), "true");
      await waitForTwoAnimationFrames(page);
      await saveScreenshot(page, `${prefix}-moon-parent-transition-${bodyId}-start`);
      await page.waitForTimeout(350);
      assert.equal(await canvas.getAttribute("aria-busy"), "true");
      await saveScreenshot(page, `${prefix}-moon-parent-transition-${bodyId}-mid`);
    }
    await waitForMoonCameraSettled(page);
    await waitForCenteredBodyLabel(page, bodyId);
    await page.waitForTimeout(250);
    assert.equal(await page.locator("#card-name").textContent(), findBody(bodyId).name);
    await assertRenderedCanvas(page);
    await saveScreenshot(page, `${prefix}-moon-parent-min-${bodyId}`);

    const viewport = page.viewportSize();
    assert.ok(viewport);
    const towardParent = parentFacingPointerDelta(bodyId, viewport.width, viewport.height);
    if (cdp) {
      await touchOrbitBy(page, cdp, viewport, towardParent.dx, towardParent.dy);
    } else {
      await orbitCameraDrag(page, towardParent.dxFrac, towardParent.dyFrac);
    }
    await waitForMoonCameraSettled(page);
    await waitForCenteredBodyLabel(page, bodyId);
    await page.waitForTimeout(250);
    assert.equal(await page.locator("#card-name").textContent(), findBody(bodyId).name);
    await assertRenderedCanvas(page);
    if (touch && bodyId === "moon") {
      assert.deepEqual(viewport, { width: 390, height: 844 }, "portrait Moon regression uses its recorded viewport");
      const layout = await page.evaluate(() => ({
        dockHeight: document.querySelector("#dock").getBoundingClientRect().height,
        cardTop: document.querySelector("#body-card").getBoundingClientRect().top,
        cameraClosed: document.querySelector("#camera-panel").hidden,
      }));
      assert.equal(layout.cameraClosed, true, "portrait Moon retains the closed Camera baseline");
      // PR124's pre-change 390×844 close-Moon frame had a 100px dock and
      // card top at 493.625px. A taller dock raised the card over the globe.
      assert.ok(layout.dockHeight <= 100.5, `portrait Moon preserves the 100px dock: ${JSON.stringify(layout)}`);
      assert.ok(layout.cardTop >= 493.125, `portrait Moon preserves card/globe clearance: ${JSON.stringify(layout)}`);
      await assertSimulationDateInDock(page, "portrait-Moon-close");
    }
    await saveScreenshot(page, `${prefix}-moon-parent-close-${bodyId}`);

    if (cdp) {
      await touchPinch(page, cdp, 370, 40, `${prefix} ${bodyId} parent crossing zoom`);
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
    assert.equal(
      await canvas.getAttribute("aria-busy"),
      "true",
      `${prefix} ${bodyId} parent-crossing zoom uses a continuous flight`,
    );
    await waitForTwoAnimationFrames(page);
    await waitForMoonCameraSettled(page);
    await waitForCenteredBodyLabel(page, bodyId);
    await page.waitForTimeout(250);
    assert.equal(
      await page.locator("#card-name").textContent(),
      findBody(bodyId).name,
      `${prefix} ${bodyId} zoom through the parent keeps the moon focused`,
    );
    await assertRenderedCanvas(page);
    await assertVisibleBodyLabelsClearChrome(page, `${prefix} ${bodyId} parent-cross labels`);
    await saveScreenshot(page, `${prefix}-moon-parent-cross-${bodyId}`);

    if (cdp) {
      await touchOrbitBy(page, cdp, viewport, -towardParent.dx, -towardParent.dy);
    } else {
      await orbitCameraDrag(page, -towardParent.dxFrac, -towardParent.dyFrac);
    }
    await waitForMoonCameraSettled(page);
    await waitForCenteredBodyLabel(page, bodyId);
    await page.waitForTimeout(250);
    assert.equal(
      await page.locator("#card-name").textContent(),
      findBody(bodyId).name,
      `${prefix} ${bodyId} reverse orbit keeps the moon focused`,
    );
    await assertRenderedCanvas(page);
    await saveScreenshot(page, `${prefix}-moon-parent-reverse-${bodyId}`);

    if (cdp) {
      await touchOrbitBy(page, cdp, viewport, towardParent.dx, towardParent.dy);
    } else {
      await orbitCameraDrag(page, towardParent.dxFrac, towardParent.dyFrac);
    }
    await waitForMoonCameraSettled(page);
    await waitForCenteredBodyLabel(page, bodyId, 0.25);
    await page.waitForTimeout(250);
    await assertCenteredCanvasPicksMoon(page, bodyId, prefix, cdp);
    await assertViewportBusyChanges(page, `${prefix} ${bodyId} focus, parent crossing, reverse and pick`);
  }

  if (cdp) await cdp.detach();
  assert.deepEqual(errors, [], `${prefix} moon-parent close views have no browser errors`);
  await page.close();
}

async function assertCenteredCanvasPicksMoon(page, bodyId, prefix, cdp) {
  const canvas = page.locator("#viewport");
  await saveScreenshot(page, `${prefix}-moon-parent-pick-target-${bodyId}`);
  await page.locator("#card-close").click();
  await page.locator("#body-card[hidden]").waitFor({ state: "attached" });
  await page.locator(".sky-label").evaluateAll((labels) => {
    for (const label of labels) label.style.pointerEvents = "none";
  });
  const bounds = await canvas.boundingBox();
  assert.ok(bounds);
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  if (cdp) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 0, x, y, radiusX: 4, radiusY: 4, force: 1 }],
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await page.mouse.click(x, y);
  }
  await waitForTwoAnimationFrames(page);
  await page.locator("#body-card:not([hidden])").waitFor();
  assert.equal(
    await page.locator("#card-name").textContent(),
    findBody(bodyId).name,
    `${prefix} ${bodyId} real center ${cdp ? "tap" : "click"} raycasts the focused moon`,
  );
  assert.equal(
    await page.locator("#status-live").textContent(),
    `Focused ${findBody(bodyId).name}`,
  );
  await waitForMoonCameraSettled(page);
  await saveScreenshot(page, `${prefix}-moon-parent-picked-${bodyId}`);
  await page.locator(".sky-label").evaluateAll((labels) => {
    for (const label of labels) label.style.pointerEvents = "";
  });
}

async function waitForCenteredBodyLabel(page, bodyId, tolerance = 2) {
  await page.waitForFunction(({ id, tolerance }) => {
    const label = document.querySelector(`[data-body-id="${id}"]`);
    if (!label || label.hidden) return false;
    const match = label.style.transform.match(
      /translate\(([-\d.eE]+)px,\s*([-\d.eE]+)px\)$/,
    );
    if (!match) return false;
    return Math.abs(Number(match[1]) - innerWidth / 2) <= tolerance
      && Math.abs(Number(match[2]) - innerHeight / 2) <= tolerance;
  }, { id: bodyId, tolerance }, { timeout: 20_000 });
}

async function waitForMoonCameraSettled(page) {
  await page.waitForFunction(
    () => document.querySelector("#viewport")?.getAttribute("aria-busy") === "false",
    null,
    { timeout: 20_000 },
  );
  await waitForTwoAnimationFrames(page);
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

async function outerPlanetSurfaceMetrics(
  page, bodyId, distance,
  azimuth = CONFIG.cameraAzimuth, elevation = CONFIG.cameraElevation,
) {
  const body = findBody(bodyId);
  const png = await stableCanvasFrame(page, page.locator("#viewport"));
  return page.evaluate(async ({ source, center, radius, distance, azimuth, elevation }) => {
    const THREE = await import("./vendor/three.module.min.js");
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
    const viewport = document.querySelector("#viewport").getBoundingClientRect();
    // Element screenshots include overlaid HTML. Exclude every label and
    // persistent panel, including their antialiased borders, from both masks.
    const obstacles = [...document.querySelectorAll(
      ".sky-label, #stage .topbar, #body-card, #dock, #version-label",
    )].filter((element) => element.getClientRects().length > 0)
      .map((element) => element.getBoundingClientRect());
    const globeCenter = new THREE.Vector3(center.x, center.y, center.z);
    const camera = new THREE.PerspectiveCamera(52, surface.width / surface.height, 0.05, 7000000);
    camera.position.copy(globeCenter).add(new THREE.Vector3(
      Math.cos(elevation) * Math.sin(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.cos(azimuth),
    ).multiplyScalar(distance));
    camera.lookAt(globeCenter);
    camera.updateMatrixWorld();
    const sphere = new THREE.Sphere(globeCenter, radius);
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hit = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const direction = new THREE.Vector3();
    const night = [];
    const day = [];
    for (let y = 1; y < surface.height; y += 2) {
      for (let x = 1; x < surface.width; x += 2) {
        const cssX = viewport.left + (x + 0.5) * viewport.width / surface.width;
        const cssY = viewport.top + (y + 0.5) * viewport.height / surface.height;
        if (obstacles.some((box) => cssX >= box.left - 3 && cssX <= box.right + 3
          && cssY >= box.top - 3 && cssY <= box.bottom + 3)) continue;
        ndc.set((x + 0.5) / surface.width * 2 - 1, 1 - (y + 0.5) / surface.height * 2);
        raycaster.setFromCamera(ndc, camera);
        if (!raycaster.ray.intersectSphere(sphere, hit)) continue;
        normal.copy(hit).sub(globeCenter).normalize();
        // Discard the limb, where sphere tessellation and antialiasing can
        // disagree with the analytic sphere; never count sky as globe pixels.
        if (normal.dot(direction.copy(camera.position).sub(hit).normalize()) < 0.2) continue;
        const sunCosine = normal.dot(direction.copy(hit).negate().normalize());
        const offset = (y * surface.width + x) * 4;
        const luma = pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152
          + pixels[offset + 2] * 0.0722;
        if (sunCosine < -0.2) night.push(luma);
        if (sunCosine > 0.08) day.push(luma);
      }
    }
    const summarize = (values) => {
      values.sort((a, b) => a - b);
      return {
        samples: values.length,
        mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
        p10: values[Math.floor(values.length * 0.1)] ?? 0,
      };
    };
    return { night: summarize(night), day: summarize(day) };
  }, {
    source: png.toString("base64"),
    center: keplerOffset(body, findBody(body.parent), 0),
    radius: visualBodyRadius(body),
    distance,
    azimuth,
    elevation,
  });
}

async function assertOuterPlanetNightSides(context, prefix, touch = false) {
  const page = await context.newPage();
  const errors = captureErrors(page);
  const textures = new Map();
  page.on("response", (response) => {
    for (const id of ["uranus", "neptune"]) {
      if (response.url().endsWith(`/assets/textures/${id}.jpg`)) textures.set(id, response.status());
    }
  });
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      if (document.documentElement?.dataset.heliosReady !== "1") return;
      const play = document.querySelector("#play-button");
      if (play?.getAttribute("aria-pressed") === "true") play.click();
      observer.disconnect();
    });
    observer.observe(document, {
      attributes: true,
      attributeFilter: ["data-helios-ready"],
      subtree: true,
    });
  });
  await openReady(page);
  assert.equal(await page.locator("#play-button").getAttribute("aria-pressed"), "false");
  assert.equal(await page.locator("#clock").textContent(), "2000-01-01");
  const cdp = touch ? await context.newCDPSession(page) : null;
  for (const bodyId of ["uranus", "neptune"]) {
    assert.equal(textures.get(bodyId), 200, `${bodyId} source texture loads successfully`);
    await page.locator("#reset-button").click();
    await page.evaluate((id) => document.querySelector(`[data-body-id="${id}"]`).click(), bodyId);
    await page.locator("#body-card:not([hidden])").waitFor();
    await waitForCenteredBodyLabel(page, bodyId, 0.1);
    const radius = visualBodyRadius(findBody(bodyId));
    const framedDistance = Math.max(radius * 7.5, 5.5);
    // A camera near the globe sees less than a hemisphere. At Neptune's
    // closest J2000 seat there is no visible sunlit crescent; check it in
    // the unchanged, farther focus-arrival seat instead of inventing a phase.
    for (const [seat, distance] of [
      ["framed", framedDistance],
      ["minimum", minimumFocusDistance(radius)],
    ]) {
      if (seat === "minimum") {
        if (cdp) await touchPinch(page, cdp, 40, 370, `${prefix} ${bodyId} night side`);
        else await zoomBetweenAuditDistances(page, framedDistance, distance);
        await waitForTwoAnimationFrames(page);
      }
      const label = `${prefix} ${bodyId} ${seat}`;
      const metrics = await outerPlanetSurfaceMetrics(page, bodyId, distance);
      console.log(`${label} globe-only luminance ${JSON.stringify(metrics)}`);
      await saveScreenshot(page, `${prefix}-night-side-${seat}-${bodyId}`);
      // Display-readability floors, not astronomical brightness or WCAG claims.
      assert.ok(metrics.night.samples >= 500, `${label} has a substantial actual-night-globe ROI`);
      assert.ok(metrics.night.mean >= 10, `${label} night surface mean stays readable`);
      assert.ok(metrics.night.p10 >= 8, `${label} night surface does not collapse to black`);
      if (seat === "framed") {
        assert.ok(metrics.day.samples >= 30, `${label} samples a genuine sunlit crescent`);
        assert.ok(metrics.day.mean >= metrics.night.mean * 2
          && metrics.day.mean >= metrics.night.mean + 20,
        `${label} sunlight stays distinctly brighter than the inspection fill`);
      }
    }
    const body = findBody(bodyId);
    const position = keplerOffset(body, findBody(body.parent), 0);
    const sunAzimuth = Math.atan2(-position.x, -position.z);
    const sunElevation = Math.asin(-position.y / Math.hypot(position.x, position.y, position.z));
    for (const [seat, azimuth, elevation] of [
      // Horizontal perpendicular to the Sun direction: a true 90-degree phase.
      ["half-lit", sunAzimuth + Math.PI / 2, 0],
      ["sunward", sunAzimuth, sunElevation],
    ]) {
      await page.locator("#reset-button").click();
      await page.evaluate((id) => document.querySelector(`[data-body-id="${id}"]`).click(), bodyId);
      await waitForCenteredBodyLabel(page, bodyId, 0.1);
      const deltaAzimuth = Math.atan2(
        Math.sin(azimuth - CONFIG.cameraAzimuth), Math.cos(azimuth - CONFIG.cameraAzimuth),
      );
      const dx = -deltaAzimuth / 0.005;
      const dy = (elevation - CONFIG.cameraElevation) / 0.004;
      if (cdp) await touchOrbitBy(page, cdp, page.viewportSize(), dx, dy);
      else await dragCamera(page, dx, dy);
      await waitForCenteredBodyLabel(page, bodyId, 0.1);
      const metrics = await outerPlanetSurfaceMetrics(page, bodyId, framedDistance, azimuth, elevation);
      const label = `${prefix} ${bodyId} ${seat}`;
      console.log(`${label} globe-only luminance ${JSON.stringify(metrics)}`);
      await saveScreenshot(page, `${prefix}-night-side-${seat}-${bodyId}`);
      assert.ok(metrics.day.samples >= 500, `${label} has a substantial sunlit-globe ROI`);
      if (seat === "half-lit") {
        assert.ok(metrics.night.samples >= 500, `${label} also contains genuine night surface`);
        assert.ok(metrics.day.mean >= metrics.night.mean * 2
          && metrics.day.mean >= metrics.night.mean + 20,
        `${label} preserves the physical terminator and bright-side hierarchy`);
      } else {
        assert.equal(metrics.night.samples, 0, `${label} geometry faces the Sun`);
      }
    }
  }
  if (cdp) await cdp.detach();
  assert.deepEqual(errors, [], `${prefix} outer-planet night views have no browser errors`);
  await page.close();
}

// Radial bands of the ring strip texture as fractions of the inner→outer
// span, with margins away from every band edge (see assets/textures/saturn-ring.png).
const SATURN_RING_BANDS = Object.freeze({
  gap: [0.01, 0.045],
  c: [0.1, 0.29],
  b: [0.33, 0.65],
  cassini: [0.678, 0.705],
  a: [0.73, 0.88],
});

async function saturnRingSurfaceMetrics(page, distance, azimuth, elevation) {
  const saturn = findBody("saturn");
  const png = await stableCanvasFrame(page, page.locator("#viewport"));
  return page.evaluate(async ({ source, center, pole, globeRadius, inner, outer, bands, distance, azimuth, elevation }) => {
    const THREE = await import("./vendor/three.module.min.js");
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
    const viewport = document.querySelector("#viewport").getBoundingClientRect();
    const obstacles = [...document.querySelectorAll(
      ".sky-label, #stage .topbar, #body-card, #dock, #version-label",
    )].filter((element) => element.getClientRects().length > 0)
      .map((element) => element.getBoundingClientRect());
    const globeCenter = new THREE.Vector3(center.x, center.y, center.z);
    const camera = new THREE.PerspectiveCamera(52, surface.width / surface.height, 0.05, 7000000);
    camera.position.copy(globeCenter).add(new THREE.Vector3(
      Math.cos(elevation) * Math.sin(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.cos(azimuth),
    ).multiplyScalar(distance));
    camera.lookAt(globeCenter);
    camera.updateMatrixWorld();
    const sphere = new THREE.Sphere(globeCenter, globeRadius);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      new THREE.Vector3(pole.x, pole.y, pole.z), globeCenter,
    );
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hit = new THREE.Vector3();
    const values = Object.fromEntries(Object.keys(bands).map((name) => [name, []]));
    const annulus = [];
    for (let y = 1; y < surface.height; y += 2) {
      for (let x = 1; x < surface.width; x += 2) {
        const cssX = viewport.left + (x + 0.5) * viewport.width / surface.width;
        const cssY = viewport.top + (y + 0.5) * viewport.height / surface.height;
        if (obstacles.some((box) => cssX >= box.left - 3 && cssX <= box.right + 3
          && cssY >= box.top - 3 && cssY <= box.bottom + 3)) continue;
        ndc.set((x + 0.5) / surface.width * 2 - 1, 1 - (y + 0.5) / surface.height * 2);
        raycaster.setFromCamera(ndc, camera);
        // Only ring pixels seen against the sky: rays that meet the globe
        // either occlude the ring or blend it over the lit globe.
        if (raycaster.ray.intersectsSphere(sphere)) continue;
        if (!raycaster.ray.intersectPlane(plane, hit)) continue;
        const u = (hit.distanceTo(globeCenter) - inner) / (outer - inner);
        if (u < 0 || u > 1) continue;
        const offset = (y * surface.width + x) * 4;
        const luma = pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152
          + pixels[offset + 2] * 0.0722;
        annulus.push(luma);
        for (const [name, [start, end]] of Object.entries(bands)) {
          if (u >= start && u <= end) values[name].push(luma);
        }
      }
    }
    const summarize = (list) => {
      list.sort((a, b) => a - b);
      return {
        samples: list.length,
        mean: list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : 0,
        p10: list[Math.floor(list.length * 0.1)] ?? 0,
        p90: list[Math.floor(list.length * 0.9)] ?? 0,
      };
    };
    return {
      annulus: summarize(annulus),
      ...Object.fromEntries(Object.entries(values).map(([name, list]) => [name, summarize(list)])),
    };
  }, {
    source: png.toString("base64"),
    center: keplerOffset(saturn, findBody(saturn.parent), 0),
    pole: equatorialVectorToScene(bodyOrientationBasis(saturn).zAxis),
    globeRadius: visualBodyRadius(saturn),
    inner: visualRingRadius(saturn, saturn.ringInnerKm),
    outer: visualRingRadius(saturn, saturn.ringOuterKm),
    bands: SATURN_RING_BANDS,
    distance,
    azimuth,
    elevation,
  });
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

  // Issue #44: at J2000 the Sun sits about 21° south of Saturn's ring plane,
  // so this half-turn seat (about 47° north of the plane, Sun behind Saturn)
  // looks at the unlit ring face. The transmitted-light approximation must
  // keep its bands readable and dim, with the globe's night side still dark.
  const saturn = findBody("saturn");
  const framedDistance = Math.max(visualBodyRadius(saturn) * 7.5, 5.5);
  const viewport = page.viewportSize();
  const backAzimuth = CONFIG.cameraAzimuth - viewport.width * 0.44 * 0.005;
  const unlit = await saturnRingSurfaceMetrics(page, framedDistance, backAzimuth, CONFIG.cameraElevation);
  const globe = await outerPlanetSurfaceMetrics(page, "saturn", framedDistance, backAzimuth, CONFIG.cameraElevation);
  console.log(`desktop saturn unlit ring face ${JSON.stringify({ ring: unlit, globe })}`);
  // Display-readability floors and ceilings, not photometric claims.
  assert.ok(unlit.annulus.samples >= 4000, "unlit ring face has a substantial sky-backed annulus ROI");
  for (const [band, floor] of [["c", 13], ["b", 40], ["a", 33], ["cassini", 12]]) {
    assert.ok(unlit[band].samples >= 300, `unlit ${band} ring band has a substantial ROI`);
    assert.ok(unlit[band].mean >= floor, `unlit ${band} ring band stays readable against space (${unlit[band].mean})`);
  }
  assert.ok(unlit.cassini.mean + 16 <= unlit.b.mean && unlit.cassini.mean + 16 <= unlit.a.mean,
    `the Cassini Division stays a visible dark division between the B and A rings (${unlit.cassini.mean} vs ${unlit.b.mean}, ${unlit.a.mean})`);
  assert.ok(unlit.c.mean + 20 <= unlit.b.mean,
    `the translucent C ring stays visibly dimmer than the dense B ring (${unlit.c.mean} vs ${unlit.b.mean})`);
  assert.ok(unlit.annulus.mean <= 64 && unlit.annulus.p90 <= 96,
    `unlit ring face stays plausibly dim rather than glowing (${unlit.annulus.mean}, p90 ${unlit.annulus.p90})`);
  assert.ok(unlit.gap.samples >= 100 && unlit.gap.p90 <= 24,
    `the inner transparent gap still shows sky (${JSON.stringify(unlit.gap)})`);
  assert.ok(globe.night.samples >= 500 && globe.night.mean <= 6,
    `Saturn's night side stays dark behind the transmitted ring light (${JSON.stringify(globe.night)})`);

  // Sunward seat 50° south of the ring plane: the lit face keeps its bright
  // front-lit appearance and the day/night ring hierarchy.
  const position = keplerOffset(saturn, findBody(saturn.parent), 0);
  const sunAzimuth = Math.atan2(-position.x, -position.z);
  const litElevation = -0.5;
  await page.locator("#reset-button").click();
  await page.evaluate(() => document.querySelector('[data-body-id="saturn"]').click());
  await waitForCenteredBodyLabel(page, "saturn", 0.1);
  const deltaAzimuth = Math.atan2(
    Math.sin(sunAzimuth - CONFIG.cameraAzimuth), Math.cos(sunAzimuth - CONFIG.cameraAzimuth),
  );
  await dragCamera(page, -deltaAzimuth / 0.005, (litElevation - CONFIG.cameraElevation) / 0.004);
  await waitForCenteredBodyLabel(page, "saturn", 0.1);
  await saveScreenshot(page, "desktop-saturn-rings-lit");
  const lit = await saturnRingSurfaceMetrics(page, framedDistance, sunAzimuth, litElevation);
  console.log(`desktop saturn lit ring face ${JSON.stringify(lit)}`);
  assert.ok(lit.annulus.samples >= 4000, "lit ring face has a substantial sky-backed annulus ROI");
  assert.ok(lit.b.mean >= 110, `lit B ring keeps its bright front-lit appearance (${lit.b.mean})`);
  assert.ok(lit.b.mean >= unlit.b.mean * 1.8 && lit.a.mean >= unlit.a.mean * 1.35,
    `the lit face stays substantially brighter than the unlit face band for band (B ${lit.b.mean} vs ${unlit.b.mean}, A ${lit.a.mean} vs ${unlit.a.mean})`);
  assert.ok(lit.gap.samples >= 100 && lit.gap.p90 <= 24,
    `the inner transparent gap still shows sky on the lit face (${JSON.stringify(lit.gap)})`);
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
  await waitForMoonCameraSettled(page);
  await saveTritonScreenshot(page, "triton-rotation-a");
  await page.locator("#speed-slider").evaluate((slider, { minimum, maximum }) => {
    const target = 5.876994;
    slider.value = String((Math.log(target) - Math.log(minimum))
      / (Math.log(maximum) - Math.log(minimum)));
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  }, { minimum: CONFIG.minDaysPerSecond, maximum: CONFIG.maxDaysPerSecond });
  await page.locator("#play-button").click();
  await page.waitForTimeout(500);
  await page.locator("#play-button").click();
  await waitForMoonCameraSettled(page);
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
  const setSpeed = (target) => page.locator("#speed-slider").evaluate((slider, { daysPerSecond, minimum, maximum }) => {
    slider.value = String((Math.log(daysPerSecond) - Math.log(minimum))
      / (Math.log(maximum) - Math.log(minimum)));
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  }, { daysPerSecond: target, minimum: CONFIG.minDaysPerSecond, maximum: CONFIG.maxDaysPerSecond });
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

async function assertSimulationDateInDock(page, label) {
  const audit = await page.evaluate(() => {
    const describeHit = (element) => element ? {
      id: element.id,
      tag: element.tagName,
      rectangle: element.getBoundingClientRect().toJSON(),
    } : null;
    const clocks = [...document.querySelectorAll("#clock")];
    const clock = clocks[0];
    const readout = document.querySelector("#speed-readout");
    const topbar = document.querySelector(".topbar");
    const dock = document.querySelector("#dock");
    const speedGroup = document.querySelector(".speed-group");
    const overlaps = (first, second) => (
      first.left < second.right
      && first.right > second.left
      && first.top < second.bottom
      && first.bottom > second.top
    );
    const clockBox = clock.getBoundingClientRect();
    const readoutBox = readout.getBoundingClientRect();
    const readoutRange = document.createRange();
    readoutRange.selectNodeContents(readout);
    const readoutTextBox = readoutRange.getBoundingClientRect();
    const groupBox = speedGroup.getBoundingClientRect();
    const dockBox = dock.getBoundingClientRect();
    const topbarBox = topbar.getBoundingClientRect();
    const clockStyle = getComputedStyle(clock);
    const readoutStyle = getComputedStyle(readout);
    const controls = [...document.querySelectorAll("#dock button, #sky-mode, #speed-slider")]
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return {
          id: element.id,
          ...box.toJSON(),
          hit: hit?.closest("button, input, select") === element,
          hitElement: describeHit(hit),
          hitStack: document.elementsFromPoint(
            box.left + box.width / 2, box.top + box.height / 2,
          ).slice(0, 8).map(describeHit),
          coversClock: overlaps(box, clockBox),
          coversReadout: overlaps(box, readoutBox),
        };
      });
    const hit = document.elementFromPoint(
      clockBox.left + clockBox.width / 2,
      clockBox.top + clockBox.height / 2,
    );
    return {
      at: performance.now(),
      viewport: { width: innerWidth, height: innerHeight },
      dockHeight: dockBox.height,
      dockClearance: Number.parseFloat(getComputedStyle(document.documentElement)
        .getPropertyValue("--dock-clearance")),
      dock: describeHit(dock),
      camera: describeHit(document.querySelector("#camera-controls")),
      cameraToggle: describeHit(document.querySelector("#camera-toggle")),
      clockCount: clocks.length,
      clockInDock: Boolean(clock.closest("#dock")),
      clockInTopbar: Boolean(clock.closest(".topbar")),
      clockAfterReadout: clock.previousElementSibling === readout,
      clockInSpeedGroup: clock.parentElement === speedGroup,
      readoutInSpeedGroup: readout.parentElement === speedGroup,
      topbarOnlyBrand: [...topbar.children].map((child) => child.className).join(" ") === "brand",
      brandLabel: document.querySelector("#brand-label")?.textContent,
      heading: topbar.querySelector("h1")?.textContent,
      clockText: clock.textContent,
      readoutText: readout.textContent,
      clockVisible: clockStyle.visibility !== "hidden"
        && clockStyle.display !== "none"
        && clockBox.width > 0
        && clockBox.height > 0,
      clockPointerEvents: clockStyle.pointerEvents,
      clockTabIndex: clock.tabIndex,
      clockTag: clock.tagName,
      distinctFromReadout: clockStyle.color !== readoutStyle.color
        || clockStyle.letterSpacing !== readoutStyle.letterSpacing
        || clockStyle.textTransform !== readoutStyle.textTransform,
      clockRects: clock.getClientRects().length,
      readoutVisible: readoutStyle.visibility !== "hidden"
        && readoutStyle.display !== "none" && readoutBox.width > 0 && readoutBox.height > 0,
      readoutTextFits: readoutRange.getClientRects().length === 1
        && readoutTextBox.left >= readoutBox.left - 0.5
        && readoutTextBox.right <= readoutBox.right + 0.5
        && readoutTextBox.top >= readoutBox.top - 0.5
        && readoutTextBox.bottom <= readoutBox.bottom + 0.5,
      readoutTabIndex: readout.tabIndex,
      readoutTag: readout.tagName,
      clockInsideDock: clockBox.left >= dockBox.left - 0.5
        && clockBox.right <= dockBox.right + 0.5
        && clockBox.top >= dockBox.top - 0.5
        && clockBox.bottom <= dockBox.bottom + 0.5,
      readoutsInsideGroup: [clockBox, readoutBox].every((box) => (
        box.left >= groupBox.left - 0.5 && box.right <= groupBox.right + 0.5
        && box.top >= groupBox.top - 0.5 && box.bottom <= groupBox.bottom + 0.5
      )),
      sameRowAsReadout: Math.abs((clockBox.top + clockBox.bottom) / 2 - (readoutBox.top + readoutBox.bottom) / 2)
        <= Math.max(clockBox.height, readoutBox.height) / 2 + 1,
      afterReadout: clockBox.left + 0.5 >= readoutBox.right,
      compactReadouts: matchMedia(
        "(max-width: 720px) and (orientation: portrait), (max-width: 840px) and (max-height: 500px) and (orientation: landscape)",
      ).matches,
      sameReadoutColumn: Math.abs(clockBox.right - readoutBox.right) <= 0.5,
      belowReadout: clockBox.top + 0.5 >= readoutBox.bottom,
      verticalReadoutGap: clockBox.top - readoutBox.bottom,
      nearSpeedGroup: overlaps(clockBox, {
        left: groupBox.left - 16,
        right: groupBox.right + 16,
        top: groupBox.top - 16,
        bottom: groupBox.bottom + 16,
      }),
      clockReadoutOverlap: overlaps(clockBox, readoutBox),
      clockTopbarOverlap: overlaps(clockBox, topbarBox),
      horizontalScroll: document.documentElement.scrollWidth > window.innerWidth + 1
        || document.body.scrollWidth > window.innerWidth + 1,
      dockClipped: dockBox.left < -0.5 || dockBox.right > window.innerWidth + 0.5,
      controls,
      controlOverlaps: controls.flatMap((first, index) => controls.slice(index + 1)
        .filter((second) => overlaps(first, second))
        .map((second) => `${first.id}/${second.id}`)),
      hitIsClock: hit === clock,
      hitInteractive: Boolean(hit?.closest("button, input, select, a, [tabindex]")),
    };
  });
  assert.equal(audit.clockCount, 1, `${label}: exactly one #clock`);
  assert.equal(audit.clockInDock, true, `${label}: #clock is in the dock`);
  assert.equal(audit.clockInTopbar, false, `${label}: #clock is not in the topbar`);
  assert.equal(audit.clockAfterReadout, true, `${label}: #clock follows the time-rate readout`);
  assert.equal(audit.clockInSpeedGroup, true, `${label}: #clock stays in the speed group`);
  assert.equal(audit.readoutInSpeedGroup, true, `${label}: rate readout stays in the speed group`);
  assert.equal(audit.topbarOnlyBrand, true, `${label}: topbar contains only brand identity`);
  assert.equal(audit.brandLabel, "MarinsVoyage", `${label}: brand eyebrow is unchanged`);
  assert.equal(audit.heading, "Helios", `${label}: product title is unchanged`);
  assert.match(audit.clockText, /^[+-]?\d{4,}-\d{2}-\d{2}$/, `${label}: clock remains an ISO date`);
  assert.ok(audit.readoutText.includes("/ sec"), `${label}: rate readout stays a rate`);
  assert.equal(audit.clockVisible, true, `${label}: date is visible`);
  assert.equal(audit.clockPointerEvents, "none", `${label}: date does not intercept pointer or touch`);
  assert.equal(audit.clockTabIndex, -1, `${label}: date is not in the tab order`);
  assert.equal(audit.clockTag, "P", `${label}: the existing paragraph clock node is reused`);
  assert.equal(audit.distinctFromReadout, true, `${label}: date and rate remain visually distinct`);
  assert.equal(audit.clockRects, 1, `${label}: date does not wrap`);
  assert.equal(audit.readoutVisible, true, `${label}: rate remains visible`);
  assert.equal(audit.readoutTextFits, true, `${label}: complete rate text fits on one line`);
  assert.equal(audit.readoutTabIndex, -1, `${label}: rate is not in the tab order`);
  assert.equal(audit.readoutTag, "SPAN", `${label}: rate remains noninteractive text`);
  assert.equal(audit.clockInsideDock, true, `${label}: date stays inside the dock`);
  assert.equal(audit.readoutsInsideGroup, true, `${label}: date and rate stay inside the speed group`);
  assert.equal(audit.clockReadoutOverlap, false, `${label}: date does not cover the rate`);
  assert.equal(audit.clockTopbarOverlap, false, `${label}: date does not sit in the brand area`);
  assert.equal(audit.horizontalScroll, false, `${label}: no horizontal scroll`);
  assert.equal(audit.dockClipped, false, `${label}: dock stays inside the viewport`);
  if (audit.viewport.width === 390 && audit.viewport.height === 844) {
    assert.ok(audit.dockHeight <= 100.5,
      `${label}: portrait dock retains its 100px clearance (${audit.dockHeight})`);
  }
  assert.equal(audit.hitIsClock, false, `${label}: date is not the hit target`);
  assert.equal(audit.hitInteractive, false, `${label}: date does not cover an interactive control`);
  assert.deepEqual(audit.controlOverlaps, [], `${label}: dock controls do not overlap`);
  if (audit.compactReadouts) {
    assert.equal(audit.sameReadoutColumn, true, `${label}: date and rate share a compact column`);
    assert.equal(audit.belowReadout, true, `${label}: date sits below the rate`);
    assert.ok(audit.verticalReadoutGap <= 12, `${label}: compact date remains adjacent to the rate`);
  } else {
    assert.equal(audit.sameRowAsReadout, true, `${label}: date stays on the same row as the rate`);
    assert.equal(audit.afterReadout, true, `${label}: date sits after the rate`);
  }
  for (const control of audit.controls) {
    assert.ok(
      control.height >= 43.5,
      `${label}: ${control.id} keeps a 44px-tall target (${control.height})`,
    );
    assert.ok(
      control.width >= 43.5,
      `${label}: ${control.id} keeps a 44px-wide target (${control.width})`,
    );
    try {
      assert.equal(control.hit, true,
        `${label}: ${control.id} remains hit-testable: ${JSON.stringify(audit)}`);
    } catch (error) {
      error.audit = audit; // Retain this sample before a later frame can change it.
      throw error;
    }
    assert.equal(control.coversClock || control.coversReadout, false,
      `${label}: ${control.id} clears the date and rate`);
  }
  return audit;
}

async function resizeAndAssertSimulationDateInDock(page, viewport, label) {
  await page.setViewportSize(viewport);
  // CSS can reflow before resize/ResizeObserver updates the Camera clearance.
  await waitForTwoAnimationFrames(page);
  return assertSimulationDateInDock(page, label);
}

async function assertResizeAuditWaitsForPaint(browser) {
  const context = await browser.newContext({ viewport: { width: 720, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = captureErrors(page);
  const report = { evidence: "controlled resize callback deferral, not a historical CI event trace", errors };
  let check;
  let checkState = "pending";
  const boundedObservation = async (observation) => {
    let deadline;
    try {
      return await Promise.race([observation, new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error("resize audit observation exceeded 15s")), 15_000);
      })]);
    } finally { clearTimeout(deadline); }
  };
  try {
    await page.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window);
      const add = window.addEventListener.bind(window);
      const NativeResizeObserver = window.ResizeObserver;
      const gate = window.resizeAudit = { held: false, frames: [], resize: [], observers: [] };
      gate.delivered = { frames: 0, resize: 0, observers: 0 };
      gate.resized = new Promise((resolve) => { gate.resizeArrived = resolve; });
      gate.framesHeld = new Promise((resolve) => { gate.framesArrived = resolve; });
      window.addEventListener = (type, listener, options) => add(type, type === "resize"
        ? function (event) {
          const deliver = () => { gate.delivered.resize += 1; listener.call(window, event); };
          if (gate.held) { gate.resize.push(deliver); gate.resizeArrived(); }
          else deliver();
        } : listener, options);
      window.ResizeObserver = class extends NativeResizeObserver {
        constructor(callback) {
          super((entries, observer) => {
            const deliver = () => {
              gate.delivered.observers += 1;
              callback.call(observer, entries, observer);
            };
            if (gate.held) gate.observers.push(deliver);
            else deliver();
          });
        }
      };
      window.requestAnimationFrame = (callback) => raf((time) => {
        if (gate.held) {
          gate.frames.push(callback);
          if (gate.frames.length >= 2) gate.framesArrived();
        } else { gate.delivered.frames += 1; callback(time); }
      });
      // Native checkpoints keep layout/observer delivery live while app and audit
      // callbacks wait; no elapsed-time sleep substitutes for a browser frame.
      gate.checkpoint = () => new Promise((resolve) => raf(() => raf(resolve)));
      gate.release = () => {
        gate.held = false;
        for (const deliver of gate.resize.splice(0)) deliver();
        for (const deliver of gate.observers.splice(0)) deliver();
        for (const callback of gate.frames.splice(0)) raf((time) => {
          gate.delivered.frames += 1;
          callback(time);
        });
      };
    });
    await openReady(page);
    await assertCardClearsDock(page, { width: 720, height: 900 });
    report.before = await assertSimulationDateInDock(page, "resize regression 720 card open");
    assert.equal(report.before.dockHeight, 48);
    assert.equal(report.before.dockClearance, 48);
    await page.evaluate(() => {
      window.resizeAudit.held = true;
      window.resizeAudit.delivered = { frames: 0, resize: 0, observers: 0 };
    });
    check = resizeAndAssertSimulationDateInDock(page, { width: 721, height: 900 }, "resize regression 721");
    check.then(() => { checkState = "passed"; }, () => { checkState = "failed"; });
    await boundedObservation(Promise.race([
      page.evaluate(async () => {
        await window.resizeAudit.resized;
        await window.resizeAudit.framesHeld;
        await window.resizeAudit.checkpoint();
      }),
      check.then(() => { throw new Error("resize audit completed before a render frame"); }),
    ]));
    report.pending = await page.evaluate(() => ({
      frames: window.resizeAudit.frames.length,
      resize: window.resizeAudit.resize.length,
      observers: window.resizeAudit.observers.length,
      delivered: window.resizeAudit.delivered,
    }));
    assert.ok(report.pending.frames >= 2, "both application and audit frames are held");
    assert.ok(report.pending.resize > 0 && report.pending.observers > 0,
      "real resize and ResizeObserver callbacks are queued");
    assert.deepEqual(report.pending.delivered, { frames: 0, resize: 0, observers: 0 },
      "no application resize, observer, or frame callback was delivered while held");
    await assert.rejects(assertSimulationDateInDock(page, "resize regression without frame barrier"),
      (error) => {
        report.stale = error.audit;
        return error instanceof assert.AssertionError && /play-button remains hit-testable/.test(error.message);
      });
    assert.equal(report.stale.dockHeight, 100);
    assert.equal(report.stale.dockClearance, 48);
    assert.equal(report.stale.controls.find((control) => control.id === "play-button").hitElement.id,
      "camera-toggle", "stale Camera clearance intercepts the real Play center");
    await saveScreenshot(page, "responsive-resize-audit-stale");
    assert.equal(checkState, "pending", "the real resize audit waits for frame delivery");
    await page.evaluate(() => window.resizeAudit.release());
    report.after = await boundedObservation(check);
    report.delivered = await page.evaluate(() => window.resizeAudit.delivered);
    assert.ok(report.delivered.frames >= 2 && report.delivered.resize > 0 && report.delivered.observers > 0,
      "the original queued resize, observer, and frame callbacks were delivered");
    assert.equal(report.after.dockClearance, 100);
    assert.equal(checkState, "passed");
    await saveScreenshot(page, "responsive-resize-audit-settled");
    assert.deepEqual(errors, [], "held-resize audit has no browser errors");
    report.pass = true;
    console.log("responsive resize audit waits for paint; stale Camera hit rejected, settled controls passed");
  } catch (error) {
    report.failure = String(error);
    throw error;
  } finally {
    await context.close();
    await check?.catch(() => {});
    if (screenshotDir) {
      await mkdir(screenshotDir, { recursive: true });
      await writeFile(path.join(screenshotDir, "responsive-resize-audit.json"), JSON.stringify(report, null, 2) + "\n");
    }
  }
}

function assertCappedDrawingBuffer(shot, expectedRatio, label) {
  const ratio = Math.min(expectedRatio, 2);
  assert.equal(
    shot.bufferWidth,
    Math.floor(shot.innerWidth * ratio),
    `${label}: canvas buffer width follows capped DPR ${ratio}`,
  );
  assert.equal(
    shot.bufferHeight,
    Math.floor(shot.innerHeight * ratio),
    `${label}: canvas buffer height follows capped DPR ${ratio}`,
  );
  assert.equal(
    shot.drawingBufferWidth,
    shot.bufferWidth,
    `${label}: WebGL drawing buffer width matches the canvas buffer`,
  );
  assert.equal(
    shot.drawingBufferHeight,
    shot.bufferHeight,
    `${label}: WebGL drawing buffer height matches the canvas buffer`,
  );
  assert.equal(shot.cssWidth, shot.innerWidth, `${label}: canvas CSS width follows layout`);
  assert.equal(shot.cssHeight, shot.innerHeight, `${label}: canvas CSS height follows layout`);
  assert.equal(shot.aspect, shot.innerWidth / Math.max(1, shot.innerHeight), `${label}: camera aspect follows CSS size`);
  if (shot.pixelRatio !== undefined) {
    assert.equal(shot.pixelRatio, ratio, `${label}: renderer pixel ratio is the capped DPR`);
  }
}

async function attachRendererProbe(page) {
  const probe = await page.evaluateHandle(async () => {
    const THREE = await import(new URL("vendor/three.module.min.js", location.href).href);
    const prototype = THREE.Scene.prototype;
    const original = prototype.onAfterRender;
    let renderer = null;
    let camera = null;
    const pixelRatioCalls = [];
    let wrapped = false;
    prototype.onAfterRender = function onAfterRender(nextRenderer, scene, nextCamera) {
      renderer = nextRenderer;
      camera = nextCamera;
      if (!wrapped && renderer) {
        wrapped = true;
        const originalSet = renderer.setPixelRatio.bind(renderer);
        renderer.setPixelRatio = function setPixelRatio(value) {
          pixelRatioCalls.push(value);
          return originalSet(value);
        };
      }
      original.call(this, nextRenderer, scene, nextCamera);
    };
    return {
      snapshot() {
        if (!renderer || !camera) return null;
        const canvas = document.querySelector("#viewport");
        const gl = canvas.getContext("webgl2");
        const css = canvas.getBoundingClientRect();
        const dock = document.querySelector("#dock")?.getBoundingClientRect();
        return {
          pixelRatio: renderer.getPixelRatio(),
          pixelRatioCalls: pixelRatioCalls.slice(),
          aspect: camera.aspect,
          projection: [...camera.projectionMatrix.elements],
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          bufferWidth: canvas.width,
          bufferHeight: canvas.height,
          drawingBufferWidth: gl.drawingBufferWidth,
          drawingBufferHeight: gl.drawingBufferHeight,
          cssWidth: css.width,
          cssHeight: css.height,
          devicePixelRatio: window.devicePixelRatio,
          dockHeight: dock ? dock.height : 0,
        };
      },
      clearCalls() {
        pixelRatioCalls.length = 0;
      },
      restore() {
        prototype.onAfterRender = original;
      },
    };
  });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await waitForTwoAnimationFrames(page);
    const shot = await probe.evaluate((item) => item.snapshot());
    if (shot) return probe;
  }
  throw new Error("renderer probe did not observe a frame");
}

async function setLiveDevicePixelRatio(page, ratio) {
  await page.evaluate((next) => {
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      get() {
        return next;
      },
    });
    window.dispatchEvent(new Event("resize"));
  }, ratio);
}

async function assertBootCappedDpr(browser, deviceScaleFactor, expectedRatio, label) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor,
  });
  const page = await context.newPage();
  const errors = captureErrors(page);
  try {
    await openReady(page);
    if (await page.locator("#play-button").getAttribute("aria-pressed") === "true") {
      await page.locator("#play-button").click();
    }
    await waitForTwoAnimationFrames(page);
    const shot = await page.locator("#viewport").evaluate((canvas) => {
      const gl = canvas.getContext("webgl2");
      const css = canvas.getBoundingClientRect();
      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        cssWidth: css.width,
        cssHeight: css.height,
        bufferWidth: canvas.width,
        bufferHeight: canvas.height,
        drawingBufferWidth: gl.drawingBufferWidth,
        drawingBufferHeight: gl.drawingBufferHeight,
        devicePixelRatio: window.devicePixelRatio,
        aspect: window.innerWidth / Math.max(1, window.innerHeight),
      };
    });
    assert.equal(shot.devicePixelRatio, deviceScaleFactor, `${label}: context devicePixelRatio`);
    assert.equal(shot.innerWidth, 1440, `${label}: CSS width is unchanged by DPR`);
    assert.equal(shot.innerHeight, 900, `${label}: CSS height is unchanged by DPR`);
    assertCappedDrawingBuffer(shot, expectedRatio, label);
    await saveScreenshot(page, `dpr-boot-${label}`);
    assert.deepEqual(errors, [], `${label} boot has no browser errors`);
  } finally {
    await page.close();
    await context.close();
  }
}

async function auditCappedDprResync(browser) {
  // DPR 1 is the live page below. One extra context covers native DPR 2 at boot;
  // the cap is proven on the live 2 → 3 step instead of a third full load.
  await assertBootCappedDpr(browser, 2, 2, "dpr-2");

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = captureErrors(page);
  let probe;
  try {
    await openReady(page);
    if (await page.locator("#play-button").getAttribute("aria-pressed") === "true") {
      await page.locator("#play-button").click();
    }
    await page.locator("#reset-button").click();
    probe = await attachRendererProbe(page);
    await probe.evaluate((item) => item.clearCalls());

    const settle = async (label) => {
      await waitForTwoAnimationFrames(page);
      const shot = await probe.evaluate((item) => item.snapshot());
      assert.ok(shot, `${label}: renderer probe is live`);
      return shot;
    };

    let shot = await settle("boot");
    assert.equal(shot.devicePixelRatio, 1);
    assertCappedDrawingBuffer(shot, 1, "live boot dpr 1");
    assert.deepEqual(shot.pixelRatioCalls, [], "boot frames after wrapping do not call setPixelRatio");

    await probe.evaluate((item) => item.clearCalls());
    await page.setViewportSize({ width: 1280, height: 800 });
    shot = await settle("same-dpr desktop resize");
    assert.deepEqual(shot.pixelRatioCalls, [], "unchanged DPR resize does not call setPixelRatio");
    assert.equal(shot.innerWidth, 1280);
    assert.equal(shot.innerHeight, 800);
    assert.equal(shot.pixelRatio, 1);
    assertCappedDrawingBuffer(shot, 1, "same-dpr desktop resize");

    await probe.evaluate((item) => item.clearCalls());
    await page.setViewportSize({ width: 390, height: 844 });
    shot = await settle("same-dpr compact resize");
    assert.deepEqual(shot.pixelRatioCalls, [], "compact same-DPR resize does not call setPixelRatio");
    assert.equal(shot.innerWidth, 390);
    assert.equal(shot.innerHeight, 844);
    assertCappedDrawingBuffer(shot, 1, "same-dpr compact resize");
    const compactLayout = {
      innerWidth: shot.innerWidth,
      innerHeight: shot.innerHeight,
      aspect: shot.aspect,
      projection: shot.projection,
      dockHeight: shot.dockHeight,
      cssWidth: shot.cssWidth,
      cssHeight: shot.cssHeight,
    };
    await saveScreenshot(page, "dpr-live-compact-1");

    await probe.evaluate((item) => item.clearCalls());
    await setLiveDevicePixelRatio(page, 2);
    shot = await settle("live 1→2");
    assert.deepEqual(shot.pixelRatioCalls, [2], "raising DPR to 2 calls setPixelRatio once");
    assert.equal(shot.devicePixelRatio, 2);
    assertCappedDrawingBuffer(shot, 2, "live 1→2");
    assert.equal(shot.innerWidth, compactLayout.innerWidth);
    assert.equal(shot.innerHeight, compactLayout.innerHeight);
    assert.equal(shot.aspect, compactLayout.aspect);
    assert.equal(shot.dockHeight, compactLayout.dockHeight);
    assert.deepEqual(shot.projection, compactLayout.projection, "DPR-only change keeps the projection");
    await saveScreenshot(page, "dpr-live-compact-2");

    const highLayout = {
      projection: shot.projection,
      dockHeight: shot.dockHeight,
      aspect: shot.aspect,
    };
    await probe.evaluate((item) => item.clearCalls());
    await setLiveDevicePixelRatio(page, 3);
    shot = await settle("live 2→3 capped");
    assert.deepEqual(shot.pixelRatioCalls, [], "still-capped DPR 3 does not call setPixelRatio");
    assert.equal(shot.devicePixelRatio, 3);
    assertCappedDrawingBuffer(shot, 2, "live 2→3 capped");
    assert.deepEqual(shot.projection, highLayout.projection);
    assert.equal(shot.dockHeight, highLayout.dockHeight);

    await probe.evaluate((item) => item.clearCalls());
    await setLiveDevicePixelRatio(page, 1);
    shot = await settle("live 2→1");
    assert.deepEqual(shot.pixelRatioCalls, [1], "lowering capped DPR to 1 calls setPixelRatio once");
    assert.equal(shot.devicePixelRatio, 1);
    assertCappedDrawingBuffer(shot, 1, "live 2→1");
    assert.equal(shot.innerWidth, compactLayout.innerWidth);
    assert.equal(shot.innerHeight, compactLayout.innerHeight);
    assert.equal(shot.aspect, compactLayout.aspect);
    assert.deepEqual(shot.projection, compactLayout.projection, "return to DPR 1 keeps the projection");
    assert.equal(shot.dockHeight, compactLayout.dockHeight);

    assert.deepEqual(errors, [], "capped DPR resync has no browser errors");
    console.log("capped DPR resync ok");
  } finally {
    if (probe) await probe.evaluate((item) => item.restore()).catch(() => {});
    await page.close();
    await context.close();
  }
}

async function assertCardAuditWaitsForPaint(context) {
  const page = await context.newPage();
  const errors = captureErrors(page);
  let check;
  try {
    await page.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window);
      const gate = window.cardAuditFrames = { held: false, pending: [], delivered: 0 };
      window.requestAnimationFrame = (callback) => raf((time) => {
        if (gate.held) gate.pending.push(callback);
        else { gate.delivered += 1; callback(time); }
      });
      document.addEventListener("click", (event) => {
        if (event.target.closest?.('[data-body-id="earth"]')) {
          gate.held = true;
          gate.beforeHold = gate.delivered;
        }
      }, true);
      gate.release = () => {
        gate.held = false;
        for (const callback of gate.pending.splice(0)) raf(callback);
      };
    });
    await page.setViewportSize({ width: 721, height: 500 });
    await openReady(page);
    check = assertCardClearsDock(page, { width: 721, height: 500 });
    check.catch(() => {}); // Observe early rejection here; propagate it below.
    await Promise.race([
      page.waitForFunction(() => window.cardAuditFrames.pending.length >= 2,
        null, { polling: 10, timeout: 5_000 }),
      check.then(() => { throw new Error("card audit completed before a render frame"); }),
    ]);
    await page.waitForTimeout(150);
    const held = await page.evaluate(() => ({
      painted: window.cardAuditFrames.delivered - window.cardAuditFrames.beforeHold,
      card: document.querySelector("#card-name").textContent,
      hidden: document.querySelector("#body-card").hidden,
      active: document.querySelector('[data-body-id="earth"]').classList.contains("is-active"),
    }));
    assert.deepEqual(held, { painted: 0, card: "Earth", hidden: false, active: false },
      "elapsed time alone does not refresh selected-body labels");
    await page.evaluate(() => window.cardAuditFrames.release());
    await check;
    assert.deepEqual(errors, [], "held-frame card audit has no browser errors");
    console.log("responsive card audit waits for a real frame after delayed selection", held);
  } finally {
    await page.close();
    await check?.catch(() => {});
  }
}

async function assertResponsiveDateWidths(context) {
  const reports = [];
  const maximumDate = simulationDateLabel(MAX_SIMULATION_DAYS);
  for (const [width, height] of [
    [568, 320], [700, 500], [718, 500], [719, 500], [720, 500],
    [721, 500], [840, 500], [841, 500], [844, 390],
    [320, 568], [390, 844], [720, 900], [721, 900], [720, 720],
    [721, 721], [720, 501], [721, 501], [768, 1024], [1024, 768],
    [1440, 900],
  ]) {
    const page = await context.newPage();
    const errors = captureErrors(page);
    const viewport = { width, height };
    const label = `${width > height ? "landscape" : "responsive"}-date-${width}x${height}`;
    try {
      await page.setViewportSize(viewport);
      await openReady(page);
      await page.locator("#play-button").click();
      const initial = await page.evaluate(() => ({
        unit: document.querySelector("#speed-slider").value,
        date: document.querySelector("#clock").textContent,
        text: document.querySelector("#speed-readout").textContent,
      }));
      const rates = [];
      const captureRate = async (rate) => {
        await page.locator("#reset-button").click();
        if (rate.name !== "default") {
          await page.locator("#speed-slider").evaluate((slider, unit) => {
            slider.value = unit;
            slider.dispatchEvent(new Event("input", { bubbles: true }));
          }, rate.unit);
        }
        if (rate.layoutOnlyMaximumDate) {
          // Layout-only maximum-date fixture; the paused simulation time stays unchanged.
          await page.locator("#clock").evaluate((clock, text) => { clock.textContent = text; },
            rate.date);
        }
        await waitForTwoAnimationFrames(page);
        const closed = await assertSimulationDateInDock(page, `${label} ${rate.name}, card closed`);
        assert.equal(closed.clockText, rate.date, `${label}: ${rate.name} date remains visible`);
        if (rate.expectedText) assert.equal(closed.readoutText, rate.expectedText);
        await saveScreenshot(page, `${label}-${rate.name}-closed`);
        await assertCardClearsDock(page, viewport);
        const open = await assertSimulationDateInDock(page, `${label} ${rate.name}, card open`);
        assert.equal(open.clockText, rate.date, `${label}: selection preserves the ${rate.name} date`);
        assert.equal(open.readoutText, closed.readoutText, `${label}: selection preserves the rate`);
        if (rate.name === "default" && width >= 1024) {
          assert.ok([closed, open].every((audit) => audit.dockHeight <= 48.5),
            `${label}: default desktop dock retains its 48px row`);
        }
        await saveScreenshot(page, `${label}-${rate.name}-open`);
        rates.push({ ...rate, closed, open });
      };
      // The initial 1 h/sec state is exact; replaying its rounded native thumb
      // value would select a different rate on the expanded logarithmic range.
      await captureRate({ name: "default", unit: initial.unit, date: initial.date,
        expectedText: initial.text, layoutOnlyMaximumDate: false });
      const widestRate = await page.locator("#speed-slider").evaluate((slider) => {
        const readout = document.querySelector("#speed-readout");
        const range = document.createRange();
        let widest = { unit: "0", text: "", width: 0 };
        // Measure every native slider step: the largest rate need not have the widest label.
        for (let step = 0; step <= 100; step += 1) {
          slider.value = String(step / 100);
          slider.dispatchEvent(new Event("input", { bubbles: true }));
          range.selectNodeContents(readout);
          if (range.getClientRects().length !== 1) {
            throw new Error(`rate label wraps at slider ${slider.value}: ${readout.textContent}`);
          }
          const width = range.getBoundingClientRect().width;
          if (width > widest.width) widest = { unit: slider.value, text: readout.textContent, width };
        }
        return widest;
      });
      for (const rate of [
        { name: "minimum", unit: "0", date: initial.date, expectedText: "1 s / sec", layoutOnlyMaximumDate: false },
        { name: "maximum-date", unit: "1", date: maximumDate, layoutOnlyMaximumDate: true },
        { name: "widest-rate", unit: widestRate.unit, date: maximumDate, expectedText: widestRate.text, layoutOnlyMaximumDate: true },
      ]) await captureRate(rate);
      reports.push({ viewport, initial, maximumDate, widestRate, rates });
      assert.deepEqual(errors, [], `${label}: no browser errors`);
    } catch (error) {
      const geometry = await page.evaluate(() => [...document.querySelectorAll(
        "#dock, .speed-group, #clock, #speed-readout, #dock button, #sky-mode, #speed-slider",
      )].map((element) => ({ id: element.id || element.className, text: element.textContent,
        box: element.getBoundingClientRect().toJSON() })));
      console.error(JSON.stringify({ label, geometry }));
      try { await saveScreenshot(page, `${label}-failure`); }
      catch (captureError) { console.error(`Could not retain responsive date failure evidence: ${captureError}`); }
      throw error;
    } finally { await page.close(); }
  }
  if (screenshotDir) {
    await mkdir(screenshotDir, { recursive: true });
    await writeFile(path.join(screenshotDir, "responsive-date-layout.json"), JSON.stringify(reports, null, 2) + "\n");
  }
  console.log(`responsive minimum, default and maximum-date layout passed at all ${reports.length} viewports`);
}

async function observeTimeControls(page) {
  await page.addInitScript(() => {
    window.timeControlMutations = [];
    window.timeControlInputs = [];
    document.addEventListener("input", (event) => {
      if (event.target.id === "speed-slider") window.timeControlInputs.push({
        focused: document.activeElement?.id, value: event.target.value, trusted: event.isTrusted,
      });
    }, true);
    new MutationObserver((records) => {
      for (const record of records) {
        const id = record.target.id || record.target.parentElement?.id;
        if (record.type === "attributes") {
          if (!["play-button", "speed-slider", "slower-button", "faster-button"].includes(id)) continue;
          window.timeControlMutations.push({ id, attribute: record.attributeName,
            before: record.oldValue, after: record.target.getAttribute(record.attributeName) });
        } else if (id === "time-status") {
          window.timeControlMutations.push({ id, attribute: null,
            before: record.oldValue,
            after: record.type === "childList"
              ? [...record.addedNodes].map((node) => node.textContent).join("")
              : record.target.textContent });
        }
      }
    }).observe(document, { subtree: true, childList: true, characterData: true,
      characterDataOldValue: true, attributes: true, attributeOldValue: true,
      attributeFilter: ["aria-pressed", "aria-valuetext", "disabled"] });
  });
}

async function timeControlEvidence(page) {
  return page.evaluate(() => ({
    mutations: window.timeControlMutations.splice(0),
    inputs: window.timeControlInputs.splice(0),
    status: document.querySelector("#time-status").textContent,
    focused: document.activeElement?.id,
  }));
}

async function assertTimeStartup(page, label, playing) {
  const startup = await timeControlEvidence(page);
  assert.equal(startup.status, "", `${label}: startup has no time announcement`);
  assert.deepEqual(startup.mutations.filter((entry) => entry.id === "time-status"), [],
    `${label}: startup never writes the time live region`);
  assert.equal(await page.getByRole("button", { name: "Play", exact: true, pressed: playing }).count(), 1,
    `${label}: stable Play toggle exposes the startup state`);
  assert.equal(await page.getByRole("slider", { name: "Time speed", exact: true }).count(), 1);
  assert.equal(await page.locator("#speed-slider").getAttribute("aria-valuetext"), "1 hour per second");
  await page.evaluate(() => new Promise((resolve) => {
    let frames = 0;
    const next = () => { if (++frames === 12) resolve(); else requestAnimationFrame(next); };
    requestAnimationFrame(next);
  }));
  const idle = await timeControlEvidence(page);
  assert.deepEqual(idle.mutations, [], `${label}: twelve render frames do not rewrite time semantics`);
  return { label, playing, startup, idle, observedIdleFrames: 12,
    accessibility: await page.locator("#dock").ariaSnapshot(),
    manualScreenReader: "Unverified: DOM and accessibility-tree evidence does not measure speech." };
}

async function auditTimeSpeedControls(browser) {
  const reports = [];
  const minimum = CONFIG.minDaysPerSecond, maximum = CONFIG.maxDaysPerSecond;
  const rateAtUnit = (unit) => unit <= 0 ? minimum : unit >= 1 ? maximum
    : Math.exp(Math.log(minimum) + (Math.log(maximum) - Math.log(minimum)) * unit);
  for (const [width, height, touch] of [[1440, 900, false], [390, 844, true], [568, 320, true]]) {
    const viewport = { width, height };
    const label = `time-speed-${width}x${height}`;
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: touch });
    const page = await context.newPage();
    const errors = captureErrors(page);
    const report = { viewport, input: touch ? "emulated touch" : "mouse", controls: [], views: [],
      accessibility: [], playback: [],
      setup: "The harness clicks Play before the first application tick to preserve J2000. The initial trace includes that intentional pause; unmodified startup is audited separately.",
      manualScreenReader: "Unverified: native semantics and live-region mutations are automated evidence, not observed speech." };
    reports.push(report);
    let observer;
    try {
      await page.clock.install({ time: new Date("2026-09-15T00:00:00Z") });
      await observeTimeControls(page);
      await page.addInitScript(() => {
        const requestFrame = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (callback) => requestFrame((timestamp) => {
          if (callback.name === "tick") {
            if (!window.speedAuditFirstTick) {
              const play = document.querySelector("#play-button");
              if (play?.getAttribute("aria-pressed") === "true") play.click();
              window.speedAuditFirstTick = { timestamp,
                paused: play?.getAttribute("aria-pressed") === "false" };
            }
            window.speedAuditTickTimestamp = timestamp;
          }
          callback(timestamp);
        });
      });
      await openReady(page);
      assert.equal(await page.evaluate(() => window.speedAuditFirstTick?.paused), true,
        `${label}: pause before the first application frame`);
      const slider = page.locator("#speed-slider");
      let previousRate;
      let inputRoute;
      const activate = async (selector) => {
        inputRoute = selector === "#speed-slider" ? "native" : "live";
        const box = await page.locator(selector).boundingBox();
        assert.ok(box, `${label}: ${selector} has a pointer target`);
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        if (touch) await page.touchscreen.tap(x, y);
        else await page.mouse.click(x, y);
      };
      const checkRate = async (name, expectedRate, expectedUnit) => {
        const sample = await page.evaluate(() => ({
          unit: Number(document.querySelector("#speed-slider").value),
          text: document.querySelector("#speed-readout").textContent,
          aria: document.querySelector("#speed-slider").getAttribute("aria-valuetext"),
          playing: document.querySelector("#play-button").getAttribute("aria-pressed"),
          playName: document.querySelector("#play-button").textContent,
          slowerDisabled: document.querySelector("#slower-button").disabled,
          fasterDisabled: document.querySelector("#faster-button").disabled,
          date: document.querySelector("#clock").textContent,
        }));
        const inverse = (Math.log(expectedRate) - Math.log(minimum))
          / (Math.log(maximum) - Math.log(minimum));
        assert.ok(Number.isFinite(sample.unit) && sample.unit >= 0 && sample.unit <= 1,
          `${label} ${name}: finite bounded thumb`);
        assert.ok(Math.abs(sample.unit - inverse) <= 0.005000001,
          `${label} ${name}: native thumb agrees with the rate within its 0.01 step`);
        if (expectedUnit !== undefined) assert.equal(sample.unit, expectedUnit, `${label} ${name}: thumb`);
        assert.equal(sample.text, `${formatDaysPerSecond(expectedRate)} / sec`, `${label} ${name}: visible rate`);
        assert.equal(sample.aria, describeDaysPerSecond(expectedRate), `${label} ${name}: accessible rate`);
        assert.equal(sample.playing, "false", `${label} ${name}: changing rate preserves pause`);
        assert.equal(sample.playName, "Play", `${label} ${name}: toggle name remains stable`);
        assert.equal(sample.slowerDisabled, expectedRate === minimum, `${label} ${name}: exact minimum disables Slower`);
        assert.equal(sample.fasterDisabled, expectedRate === maximum, `${label} ${name}: exact maximum disables Faster`);
        assert.equal(sample.date, "2000-01-01", `${label} ${name}: paused date is unchanged`);
        const evidence = await timeControlEvidence(page);
        report.controls.push({ name, expectedRate, ...sample, inputRoute, evidence });
        if (previousRate !== undefined) {
          const changed = expectedRate !== previousRate;
          const messages = evidence.mutations.filter((entry) => entry.id === "time-status" && entry.after);
          const rateWrites = evidence.mutations.filter((entry) => entry.attribute === "aria-valuetext");
          assert.equal(rateWrites.length, Number(sample.aria !== describeDaysPerSecond(previousRate)),
            `${label} ${name}: accessible rate changes only when its description changes`);
          assert.equal(evidence.mutations.filter((entry) => entry.attribute === "aria-pressed").length, 0,
            `${label} ${name}: rate input never rewrites playback state`);
          if (!changed) {
            assert.deepEqual(evidence.mutations, [], `${label} ${name}: a no-op writes no time semantics`);
          } else if (inputRoute === "native") {
            assert.ok(evidence.inputs.length > 0, `${label} ${name}: native input is recorded`);
            assert.ok(evidence.inputs.every((entry) => entry.trusted),
              `${label} ${name}: native input comes from browser interaction`);
            assert.ok(evidence.inputs.every((entry) => entry.focused === "speed-slider"),
              `${label} ${name}: slider owns focus during every native input`);
            assert.equal(evidence.focused, "speed-slider", `${label} ${name}: native slider owns focus`);
            assert.deepEqual(messages, [], `${label} ${name}: native rate has no duplicate live message`);
            assert.equal(evidence.status, "", `${label} ${name}: native feedback clears stale live text`);
          } else {
            assert.deepEqual(messages.map((entry) => entry.after), [`Time paused, ${sample.aria}.`],
              `${label} ${name}: one complete fallback announcement per changed rate`);
          }
        }
        previousRate = expectedRate;
        return sample;
      };
      const nativeKey = async (key) => {
        inputRoute = "native";
        await slider.focus();
        await page.keyboard.press(key);
      };
      const globalKey = async (key) => {
        inputRoute = "live";
        await page.locator("#viewport").focus();
        await page.keyboard.press(key);
      };
      const captureAccessibility = async (name, expectedRate, playing = false) => {
        assert.equal(await page.getByRole("button", { name: "Play", exact: true, pressed: playing }).count(), 1);
        assert.equal(await page.getByRole("button", { name: "Slower", exact: true, disabled: expectedRate === minimum }).count(), 1);
        assert.equal(await page.getByRole("button", { name: "Faster", exact: true, disabled: expectedRate === maximum }).count(), 1);
        const live = page.locator("#time-status");
        assert.equal(await live.getAttribute("role"), "status");
        assert.equal(await live.getAttribute("aria-live"), "polite");
        assert.equal(await live.getAttribute("aria-atomic"), "true");
        report.accessibility.push({ name, playing, expectedRate,
          dock: await page.locator("#dock").ariaSnapshot(), status: await live.ariaSnapshot() });
      };
      const captureRate = async (name) => {
        await assertCardClearsDock(page, viewport);
        await waitForMoonCameraSettled(page);
        const audit = await assertSimulationDateInDock(page, `${label} ${name}`);
        const box = await page.locator("#dock").boundingBox();
        assert.ok(box);
        const x = Math.max(0, Math.floor(box.x)), y = Math.max(0, Math.floor(box.y));
        const clip = { x, y,
          width: Math.min(width, Math.ceil(box.x + box.width)) - x,
          height: Math.min(height, Math.ceil(box.y + box.height)) - y };
        assert.ok(clip.width > 0 && clip.height > 0);
        await saveScreenshot(page, `${label}-${name}`);
        const sourceFullView = `${label}-${name}.png`;
        if (screenshotDir) {
          // Use the retained full frame: a second dock-only browser capture
          // repeatedly stalled after the minimum-rate frame had already passed.
          const full = await readFile(path.join(screenshotDir, sourceFullView));
          assert.deepEqual([full.readUInt32BE(16), full.readUInt32BE(20)], [width, height]);
          const crop = await page.evaluate(async ({ source, clip }) => {
            const image = new Image();
            const ready = new Promise((resolve, reject) => {
              image.addEventListener("load", resolve, { once: true });
              image.addEventListener("error", reject, { once: true });
            });
            image.src = `data:image/png;base64,${source}`;
            await ready;
            const surface = document.createElement("canvas");
            surface.width = clip.width;
            surface.height = clip.height;
            const context = surface.getContext("2d");
            context.imageSmoothingEnabled = false;
            context.drawImage(image, -clip.x, -clip.y);
            return surface.toDataURL("image/png").split(",")[1];
          }, { source: full.toString("base64"), clip });
          const png = Buffer.from(crop, "base64");
          assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [clip.width, clip.height]);
          await writeFile(path.join(screenshotDir, `${label}-${name}-dock.png`), png);
        }
        report.views.push({ name, audit, crop: { sourceFullView, clip, resized: false } });
      };
      const initial = await checkRate("default", CONFIG.defaultDaysPerSecond);
      assert.equal(initial.text, "1 h / sec");
      assert.equal(initial.aria, "1 hour per second");
      await captureAccessibility("default", CONFIG.defaultDaysPerSecond);
      await captureRate("default");
      for (let step = 1; step <= 12; step += 1) {
        await activate("#slower-button");
        await checkRate(`Slower from default ${step}`,
          Math.max(minimum, CONFIG.defaultDaysPerSecond / (2 ** step)), step === 12 ? 0 : undefined);
      }

      await nativeKey("Home");
      const slowest = await checkRate("native Home", minimum, 0);
      assert.equal(slowest.text, "1 s / sec");
      assert.equal(slowest.aria, "1 second per second");
      await captureAccessibility("minimum", minimum);
      await captureRate("minimum");
      await page.locator("#play-button").focus();
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "speed-slider",
        `${label}: keyboard focus skips disabled Slower at minimum`);
      await nativeKey("ArrowRight");
      await checkRate("native ArrowRight", rateAtUnit(0.01), 0.01);
      await nativeKey("ArrowLeft");
      await checkRate("native ArrowLeft", minimum, 0);
      await nativeKey("ArrowDown");
      await checkRate("native lower clamp", minimum, 0);
      for (let repeat = 0; repeat < 3; repeat += 1) {
        await activate("#slower-button");
        await checkRate(`Slower lower clamp ${repeat + 1}`, minimum, 0);
      }
      await activate("#faster-button");
      await checkRate("Faster doubles the minimum", 2 * minimum);
      await activate("#slower-button");
      await checkRate("Slower restores the minimum", minimum, 0);
      for (let repeat = 0; repeat < 3; repeat += 1) {
        await globalKey("-");
        await checkRate(`global minus lower clamp ${repeat + 1}`, minimum, 0);
      }
      await globalKey("+");
      await checkRate("global plus doubles the minimum", 2 * minimum);
      await globalKey("-");
      await checkRate("global minus restores the minimum", minimum, 0);

      await nativeKey("End");
      const fastest = await checkRate("native End", maximum, 1);
      assert.equal(fastest.text, "1.1 yr / sec");
      assert.equal(fastest.aria, "1.1 years per second");
      await captureAccessibility("maximum", maximum);
      await captureRate("maximum");
      await slider.focus();
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "sky-mode",
        `${label}: keyboard focus skips disabled Faster at maximum`);
      await nativeKey("ArrowLeft");
      await checkRate("native step below maximum", rateAtUnit(0.99), 0.99);
      await nativeKey("ArrowRight");
      await checkRate("native step to maximum", maximum, 1);
      await nativeKey("ArrowUp");
      await checkRate("native upper clamp", maximum, 1);
      for (let repeat = 0; repeat < 3; repeat += 1) {
        await activate("#faster-button");
        await checkRate(`Faster upper clamp ${repeat + 1}`, maximum, 1);
      }
      await activate("#slower-button");
      await checkRate("Slower halves the maximum", maximum / 2);
      await activate("#faster-button");
      await checkRate("Faster restores the maximum", maximum, 1);
      for (let repeat = 0; repeat < 3; repeat += 1) {
        await globalKey("+");
        await checkRate(`global plus upper clamp ${repeat + 1}`, maximum, 1);
      }
      await globalKey("-");
      await checkRate("global minus halves the maximum", maximum / 2);
      await globalKey("+");
      await checkRate("global plus restores the maximum", maximum, 1);
      await activate("#speed-slider");
      const pointerUnit = Number(await slider.inputValue());
      assert.ok(pointerUnit > 0 && pointerUnit < 1, `${label}: pointer selects an interior slider step`);
      await checkRate("pointer slider selection", rateAtUnit(pointerUnit), pointerUnit);
      await nativeKey("Home");
      await checkRate("minimum before rounded-thumb check", minimum, 0);
      for (let step = 1; step <= 4; step += 1) {
        await nativeKey("ArrowRight");
        await checkRate(`low boundary setup ${step}`, rateAtUnit(step / 100), step / 100);
      }
      await activate("#slower-button");
      await checkRate("rounded minimum thumb keeps Slower enabled", rateAtUnit(0.04) / 2, 0);
      await activate("#slower-button");
      await checkRate("exact minimum after rounded thumb", minimum, 0);
      await nativeKey("End");
      await checkRate("maximum before rounded-thumb check", maximum, 1);
      for (let step = 1; step <= 4; step += 1) {
        await nativeKey("ArrowLeft");
        await checkRate(`high boundary setup ${step}`, rateAtUnit((100 - step) / 100), (100 - step) / 100);
      }
      await activate("#faster-button");
      await checkRate("rounded maximum thumb keeps Faster enabled", rateAtUnit(0.96) * 2, 1);
      await activate("#faster-button");
      await checkRate("exact maximum after rounded thumb", maximum, 1);
      await nativeKey("Home");
      await checkRate("minimum before integration", minimum, 0);

      // Read Mercury's live world transform after scene rendering; Mercury
      // need not be visible in this Earth-focused view. The cached THREE
      // observer never changes scene objects, application state, or clock math.
      observer = await page.evaluateHandle(async () => {
        const THREE = await import(new URL("vendor/three.module.min.js", location.href).href);
        const prototype = THREE.Scene.prototype;
        const own = Object.getOwnPropertyDescriptor(prototype, "onAfterRender");
        const original = prototype.onAfterRender;
        const world = new THREE.Vector3();
        let mercury, last, frames = 0;
        prototype.onAfterRender = function (...args) {
          original.apply(this, args);
          if (!mercury) this.traverse((object) => {
            if (object.isMesh && object.userData.bodyId === "mercury") mercury = object;
          });
          if (!mercury) return;
          world.setFromMatrixPosition(mercury.matrixWorld);
          last = { timestamp: window.speedAuditTickTimestamp, performanceNow: performance.now(),
            world: world.toArray(), playing: document.querySelector("#play-button").getAttribute("aria-pressed"),
            date: document.querySelector("#clock").textContent };
          frames += 1;
        };
        return { snapshot: () => ({ frames, last }), restore() {
          if (own) Object.defineProperty(prototype, "onAfterRender", own);
          else delete prototype.onAfterRender;
        } };
      });
      // Leave setup ample headroom from the midnight installation, then place
      // the paused RAF at the boundary before the exact one-second step.
      await page.clock.pauseAt(new Date("2026-09-15T01:00:00Z"));
      await page.clock.fastForward(16);
      const before = await observer.evaluate((value) => value.snapshot());
      assert.ok(before.last && before.frames > 0, `${label}: Mercury scene-transform observer is active`);
      assert.equal(before.last.playing, "false");
      const expectedWorld = (days) => {
        const at = keplerOffset(findBody("mercury"), findBody("sun"), days);
        return [at.x, at.y, at.z];
      };
      const errorFrom = (sample, expected) => Math.hypot(...sample.world.map((value, i) => value - expected[i]));
      report.integration = { before, expectedInitialWorld: expectedWorld(0) };
      assert.ok(errorFrom(before.last, expectedWorld(0)) < 1e-9,
        `${label}: all paused control interactions retain the J2000 orbit`);
      assert.deepEqual((await timeControlEvidence(page)).mutations, [],
        `${label}: idle paused frames do not announce or rewrite time semantics`);
      const checkPlayback = async (name, playing, native) => {
        const evidence = await timeControlEvidence(page);
        const messages = evidence.mutations.filter((entry) => entry.id === "time-status" && entry.after);
        const pressed = evidence.mutations.filter((entry) => entry.attribute === "aria-pressed");
        assert.deepEqual(pressed.map((entry) => entry.after), [String(playing)],
          `${label} ${name}: playback state changes exactly once`);
        assert.equal(evidence.mutations.filter((entry) => entry.attribute === "aria-valuetext").length, 0,
          `${label} ${name}: playback does not repeat the unchanged native rate`);
        if (native) {
          assert.equal(evidence.focused, "play-button", `${label} ${name}: Play owns native feedback`);
          assert.deepEqual(messages, [], `${label} ${name}: focused toggle has no duplicate live message`);
          assert.equal(evidence.status, "", `${label} ${name}: focused toggle clears stale live text`);
        } else {
          assert.equal(evidence.focused, "viewport", `${label} ${name}: shortcut preserves scene focus`);
          assert.deepEqual(messages.map((entry) => entry.after),
            [`Time ${playing ? "running" : "paused"}, 1 second per second.`],
            `${label} ${name}: off-control shortcut announces state and rate once`);
        }
        assert.equal(await page.getByRole("button", { name: "Play", exact: true, pressed: playing }).count(), 1);
        report.playback.push({ name, playing, native, evidence });
      };
      await activate("#play-button");
      await checkPlayback("pointer play", true, true);
      await page.clock.fastForward(1000);
      const running = await observer.evaluate((value) => value.snapshot());
      assert.equal(running.last.timestamp - before.last.timestamp, 1000,
        `${label}: exactly one second between observed application RAFs`);
      assert.equal(running.last.playing, "true");
      const expectedDays = 1 / 86400;
      assert.ok(errorFrom(running.last, expectedWorld(expectedDays)) < 1e-9,
        `${label}: one real second advances the live scene orbit by one simulated second`);
      assert.ok(errorFrom(running.last, before.last.world) > 1e-7,
        `${label}: minimum speed is running, not frozen`);
      assert.deepEqual((await timeControlEvidence(page)).mutations, [],
        `${label}: running frames do not repeat time announcements`);
      await activate("#play-button");
      await checkPlayback("pointer pause", false, true);
      await page.clock.fastForward(1000);
      const paused = await observer.evaluate((value) => value.snapshot());
      assert.equal(paused.last.playing, "false");
      assert.deepEqual(paused.last.world, running.last.world, `${label}: pause holds the live scene orbit`);
      assert.equal(paused.last.date, running.last.date, `${label}: pause holds the date`);
      report.integration = { before, running, paused, elapsedSeconds: 1, expectedDays,
        expectedWorld: expectedWorld(expectedDays), worldError: errorFrom(running.last, expectedWorld(expectedDays)) };
      assert.deepEqual((await timeControlEvidence(page)).mutations, [],
        `${label}: paused frames do not repeat time announcements`);
      await globalKey("Space");
      await checkPlayback("scene Space play", true, false);
      await captureAccessibility("running at minimum", minimum, true);
      await saveScreenshot(page, `${label}-running-minimum`);
      await globalKey("Space");
      await checkPlayback("scene Space pause", false, false);
      await page.locator("#play-button").focus();
      await page.keyboard.press("Space");
      await checkPlayback("focused Space play", true, true);
      await page.keyboard.press("Enter");
      await checkPlayback("focused Enter pause", false, true);
      await page.clock.fastForward(320);
      report.idleAfterControls = await timeControlEvidence(page);
      assert.deepEqual(report.idleAfterControls.mutations, [],
        `${label}: completed controls leave no delayed time announcements`);
      assert.deepEqual(errors, [], `${label}: no browser errors`);
      console.log(`${label}: mouse/touch, native keys, buttons, shortcuts, exact bounds, accessible states, announcement routes and one-second integration passed; actual screen-reader speech unverified`);
    } catch (error) {
      report.failure = error.message;
      console.error(JSON.stringify(report));
      throw error;
    } finally {
      if (observer) {
        await observer.evaluate((value) => value.restore());
        await observer.dispose();
      }
      await context.close();
      if (screenshotDir) {
        await mkdir(screenshotDir, { recursive: true });
        await writeFile(path.join(screenshotDir, "time-speed-controls.json"), JSON.stringify(reports, null, 2) + "\n");
      }
    }
  }
}

async function assertSimulationDatePlayPause(page, label) {
  // This is the page's final audit before close. Replaying a saved native thumb
  // would not restore an exact rate between steps, such as the 1 h/sec default.
  const play = page.locator("#play-button");
  const slider = page.locator("#speed-slider");
  const wasPlaying = await play.getAttribute("aria-pressed") === "true";
  if (wasPlaying) await play.click();
  const pausedDate = await page.locator("#clock").textContent();
  await page.waitForTimeout(400);
  assert.equal(await page.locator("#clock").textContent(), pausedDate, `${label}: paused date stays stable`);
  await slider.evaluate((element) => {
    element.value = "1";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await play.click();
  await page.waitForFunction(
    (start) => document.querySelector("#clock").textContent !== start,
    pausedDate,
    { timeout: 8_000 },
  );
  const playingDate = await page.locator("#clock").textContent();
  assert.notEqual(playingDate, pausedDate, `${label}: playing date advances`);
  await play.click();
  const stoppedDate = await page.locator("#clock").textContent();
  await page.waitForTimeout(400);
  assert.equal(await page.locator("#clock").textContent(), stoppedDate, `${label}: date remains stable after pause`);
}

async function assertCardClearsDock(page, viewport) {
  await page.setViewportSize(viewport);
  await page.locator("#reset-button").click();
  await page.evaluate(() => document.querySelector('[data-body-id="earth"]').click());
  await page.locator("#body-card:not([hidden])").waitFor();
  // The card updates synchronously; labels and viewport geometry update on RAF.
  await waitForTwoAnimationFrames(page);
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
    `${viewport.width}x${viewport.height} card clears the title`,
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
  if (viewport.width >= 720 && viewport.width <= 721 && viewport.height === 500) {
    assert.ok(
      layout.dockHeight <= 56,
      `${viewport.width}x${viewport.height} compact landscape dock stays one control row (${layout.dockHeight})`,
    );
  }
  await assertSimulationDateInDock(page, `${viewport.width}x${viewport.height} card-open date`);
  await assertVisibleBodyLabelsClearChrome(
    page,
    `${viewport.width}x${viewport.height} responsive body labels`,
    false,
  );
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
  await assertResizeAuditWaitsForPaint(browser);
  await auditCappedDprResync(browser);
  const dateLayout = await browser.newContext({ deviceScaleFactor: 1, hasTouch: true });
  try {
    await assertCardAuditWaitsForPaint(dateLayout);
    await assertResponsiveDateWidths(dateLayout);
  } finally { await dateLayout.close(); }
  await auditTimeSpeedControls(browser);
  await runFocusTracking(browser, base, {
    onReport: async (report) => {
      if (screenshotDir) {
        await mkdir(screenshotDir, { recursive: true });
        await writeFile(
          path.join(screenshotDir, `focus-tracking-${report.scenario.id}.json`),
          JSON.stringify(report, null, 2) + "\n",
        );
      }
    },
  });
  await auditCameraNavigation(browser, base, screenshotDir);

  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await auditWheelDeltaModes(browser);
  await auditBodyLabelCollisions(desktop, "desktop");
  await auditCredits(desktop);
  await assertViewportBusyLifecycle(desktop, "desktop");
  // Check the issue's new pixel gate before the longer unchanged scale and
  // moon sweeps, so a calibration failure reports its actual surface promptly.
  await assertOuterPlanetNightSides(desktop, "desktop");
  await auditPointerCancelAbort(desktop, "desktop");
  const desktopPage = await desktop.newPage();
  const desktopErrors = captureErrors(desktopPage);
  const timeStartupReports = [];
  await observeTimeControls(desktopPage);
  await openReady(desktopPage);
  timeStartupReports.push(await assertTimeStartup(desktopPage, "desktop-default", true));
  assert.equal(await desktopPage.locator("#brand-label").textContent(), "MarinsVoyage");
  assert.equal(await desktopPage.getAttribute("html", "data-galaxy-ready"), null);
  await assertRenderedCanvas(desktopPage);
  await assertAccessibleHierarchy(
    desktopPage,
    { layer: /Solar system/, focus: /Focused on the Sun/ },
    "desktop-boot",
  );
  await assertVisibleBodyLabelsClearChrome(desktopPage, "desktop-boot");
  await assertSimulationDateInDock(desktopPage, "desktop-1440x900");
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 720, height: 900 },
    { width: 721, height: 900 },
    { width: 720, height: 500 },
    { width: 721, height: 500 },
  ]) {
    await resizeAndAssertSimulationDateInDock(desktopPage, viewport, `desktop-${viewport.width}x${viewport.height}`);
    await assertCardClearsDock(desktopPage, viewport);
  }
  await desktopPage.setViewportSize({ width: 1440, height: 900 });
  await desktopPage.locator("#reset-button").click();

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
  assert.equal(await desktopPage.locator("#status-live").textContent(), "Returned to the overview");
  await assertAccessibleHierarchy(
    desktopPage,
    { layer: /Solar system/, focus: /Focused on the Sun/ },
    "desktop-reset",
  );

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
  await assertSimulationDatePlayPause(desktopPage, "desktop-date-play-pause");
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
    await observeTimeControls(directPage);
    await openReady(directPage, `?look=${look}`);
    timeStartupReports.push(await assertTimeStartup(directPage, `desktop-${look}`, look !== "sky"));
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
    if (look === "sky") await assertEarthSkyReset(directPage);
    if (look === "universe") await assertCmbTextureVisible(directPage);
    assert.deepEqual(directErrors, [], `${look} has no browser errors`);
    await directPage.close();
  }
  if (screenshotDir) {
    await mkdir(screenshotDir, { recursive: true });
    await writeFile(path.join(screenshotDir, "time-control-startup.json"), JSON.stringify(timeStartupReports, null, 2) + "\n");
  }
  await auditSolarHandoff(desktop);
  await auditStagedDeepLoading(desktop, "desktop");
  await auditM31PlaceholderDisposal(desktop);
  await auditScaleTransitions(desktop);
  await auditFarSkyDirections(desktop);
  await captureEarthSolstice(desktop, "earth-june-solstice", "2000-06-21");
  await captureEarthSolstice(desktop, "earth-december-solstice", "2000-12-21", true);
  await assertMinimumZoomViews(desktop, "desktop", PRIMARY_BODY_IDS);
  await assertMoonParentCloseViews(desktop, "desktop");
  await assertSaturnRingReferenceViews(desktop);
  await desktop.close();

  const touch = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  await auditWheelDeltaModes(browser, true);
  await assertViewportBusyLifecycle(touch, "touch-portrait emulation");
  await assertOuterPlanetNightSides(touch, "touch-portrait", true);
  await auditPointerCancelAbort(touch, "touch-portrait", true);
  await auditBodyLabelCollisions(touch, "touch-portrait", true);
  const touchControlPage = await touch.newPage();
  const touchControlErrors = captureErrors(touchControlPage);
  await openReady(touchControlPage);
  for (const bodyId of ["moon", "phobos", "io", "triton"]) {
    await touchControlPage.locator("#reset-button").click();
    await touchControlPage.evaluate(
      (id) => document.querySelector(`[data-body-id="${id}"]`).click(),
      bodyId,
    );
    await touchControlPage.locator("#body-card:not([hidden])").waitFor();
    await touchControlPage.locator("#card-close").tap();
    await touchControlPage
      .locator("#body-card[hidden]")
      .waitFor({ state: "attached" });
    assert.equal(
      await touchControlPage.locator("#status-live").textContent(),
      "Selection cleared",
      `touch ${bodyId} close control clears the selection`,
    );
  }
  assert.deepEqual(touchControlErrors, []);
  await touchControlPage.close();

  const touchPage = await touch.newPage();
  const touchErrors = captureErrors(touchPage);
  await openReady(touchPage);
  assert.equal(await touchPage.locator("#brand-label").textContent(), "MarinsVoyage");
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
  await touchPage.setViewportSize({ width: 390, height: 844 });
  await touchPage.locator("#reset-button").click();
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
  await auditStagedDeepLoading(touch, "touch-portrait", true);
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
  assert.equal(await failurePage.locator("#loading").getAttribute("hidden"), "");
  await failure.close();

  console.log("browser-smoke ok");
} finally {
  if (browser) await browser.close();
  child.kill("SIGTERM");
}
