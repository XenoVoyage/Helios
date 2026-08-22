import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.BROWSER_SMOKE_PORT || 4175);
const base = `http://127.0.0.1:${port}/Helios/`;
const screenshotDir = process.env.HELIOS_SCREENSHOT_DIR;
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
  await page.waitForTimeout(500);
  await saveTritonScreenshot(page, "triton-rotation-b");
}

async function captureEarthSolstice(context, name, targetDate, lookSouth = false) {
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
    Date.parse(`${targetDate}T00:00:00Z`) - 30 * 86_400_000,
  ).toISOString().slice(0, 10);
  await setSpeed(80);
  await page.locator("#play-button").click();
  await page.waitForFunction(
    (target) => document.querySelector("#clock").textContent >= target,
    approachDate,
    { timeout: 10_000 },
  );
  await setSpeed(2);
  await page.waitForFunction(
    (target) => document.querySelector("#clock").textContent >= target,
    targetDate,
    { timeout: 25_000 },
  );
  await page.locator("#play-button").click();
  await page.waitForTimeout(350);

  const observedDate = await page.locator("#clock").textContent();
  const overshootDays = (Date.parse(`${observedDate}T00:00:00Z`)
    - Date.parse(`${targetDate}T00:00:00Z`)) / 86_400_000;
  assert.ok(overshootDays >= 0 && overshootDays <= 5, `${name} captured near ${targetDate}`);

  if (lookSouth) {
    const bounds = await page.locator("#viewport").boundingBox();
    assert.ok(bounds);
    await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.65);
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width * 0.5,
      bounds.y + bounds.height * 0.4,
      { steps: 8 },
    );
    await page.mouse.up();
    await page.waitForTimeout(350);
  }
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
    const overlaps = card.left < dock.right
      && card.right > dock.left
      && card.top < dock.bottom
      && card.bottom > dock.top;
    return {
      card: { top: card.top, right: card.right, bottom: card.bottom, left: card.left },
      dock: { top: dock.top, right: dock.right, bottom: dock.bottom, left: dock.left },
      overlaps,
      clearance: Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--dock-clearance"),
      ),
      dockHeight: dock.height,
      speedOverflow: getComputedStyle(document.querySelector(".speed-group")).overflow,
    };
  });
  assert.equal(layout.overlaps, false, `${viewport.width}x${viewport.height} card clears dock`);
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
  await saveScreenshot(touchPage, "touch-card");
  assert.deepEqual(touchErrors, []);
  await touch.close();

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
