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

async function saveScreenshot(page, name) {
  if (!screenshotDir) return;
  await mkdir(screenshotDir, { recursive: true });
  await writeFile(path.join(screenshotDir, `${name}.png`), await page.screenshot());
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
  await saveScreenshot(page, "triton-rotation-a");
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
  await orbitCameraHalfTurn(page);
  await page.waitForTimeout(500);
  await saveScreenshot(page, "triton-rotation-b");
}

async function captureReviewMatrix(browserInstance) {
  if (!screenshotDir) return;
  const desktopLooks = [
    ["01-desktop-orrery-overview", "", null],
    ["02-desktop-solar-sky-constellations", "sky", null],
    ["03-desktop-solar-far-sun-dot", "solarfar", null],
    ["04-desktop-trail-first-frame-solar-system-particle", "milkyway", null],
    ["05-desktop-trail-andromeda-triangulum-present", "milkyway", [520, 72]],
    ["06-desktop-trail-virgo-present", "milkyway", [-48, -320]],
    ["07-desktop-mid-trail-badge-dying", "tailsky", null],
    ["08-desktop-mid-trail-disk-and-virgo", "tailsky", [-48, -260]],
    ["09-desktop-late-trail-no-badge-neighbors", "growing", null],
    ["10-desktop-disk-local-group-identity", "disk", null],
    ["11-desktop-neighborhood", "neighborhood", null],
    ["12-desktop-local-group", "localgroup", null],
    ["13-desktop-virgo", "virgo", null],
    ["14-desktop-web", "web", null],
    ["15-desktop-universe", "universe", null],
  ];
  const touchLooks = [
    ["16-touch-orrery-overview", ""],
    ["17-touch-solar-far", "solarfar"],
    ["18-touch-trail-solar-system-particle", "milkyway"],
    ["19-touch-disk-local-group", "disk"],
  ];
  const desktopContext = await browserInstance.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  for (const [name, look, drag] of desktopLooks) {
    const page = await desktopContext.newPage();
    await openReady(page, look ? `?look=${look}` : "");
    if (drag) {
      const box = await page.locator("#viewport").boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + drag[0], box.y + box.height / 2 + drag[1]);
      await page.mouse.up();
    }
    await page.waitForTimeout(250);
    await saveScreenshot(page, name);
    await page.close();
  }
  await desktopContext.close();

  const touchContext = await browserInstance.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  for (const [name, look] of touchLooks) {
    const page = await touchContext.newPage();
    await openReady(page, look ? `?look=${look}` : "");
    await page.waitForTimeout(250);
    await saveScreenshot(page, name);
    await page.close();
  }
  await touchContext.close();
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

  const directPage = await desktop.newPage();
  const directErrors = captureErrors(directPage);
  await openReady(directPage, "?look=milkyway");
  assert.equal(await directPage.getAttribute("html", "data-galaxy-ready"), "1");
  await assertRenderedCanvas(directPage);
  await saveScreenshot(directPage, "desktop-milkyway");
  assert.deepEqual(directErrors, []);
  await directPage.close();

  const skyPage = await desktop.newPage();
  const skyErrors = captureErrors(skyPage);
  await openReady(skyPage, "?look=sky");
  await assertRenderedCanvas(skyPage);
  assert.equal(await skyPage.locator("#card-name").textContent(), "Earth");
  assert.deepEqual(skyErrors, []);
  await skyPage.close();
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

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await assertCardClearsDock(touchPage, viewport);
  }
  await saveScreenshot(touchPage, "touch-card");
  assert.deepEqual(touchErrors, []);
  await touch.close();

  const failure = await browser.newContext({ viewport: { width: 390, height: 844 } });
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

  await browser.close();
  browser = await launchBrowser();
  await captureReviewMatrix(browser);

  console.log("browser-smoke ok");
} finally {
  if (browser) await browser.close();
  child.kill("SIGTERM");
}
