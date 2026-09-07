import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { CONFIG } from "../js/config.js";
import { sceneHierarchyId } from "../js/galaxy.js";

const controls = [
  ["orbit-left", "Orbit left", "ArrowLeft", 24, 0],
  ["orbit-right", "Orbit right", "ArrowRight", -24, 0],
  ["orbit-up", "Orbit up", "ArrowUp", 0, 30],
  ["orbit-down", "Orbit down", "ArrowDown", 0, -30],
  ["zoom-in", "Zoom in", "i"],
  ["zoom-out", "Zoom out", "o"],
];

async function settled(page) {
  await page.waitForFunction(() => document.querySelector("#viewport")?.getAttribute("aria-busy") === "false");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function activate(page, id, touch) {
  await page.locator(`#${id}`)[touch ? "tap" : "click"]();
  await settled(page);
}

async function canvasSample(page) {
  // Read only rendered pixels in an animation frame; no application state hooks.
  await settled(page);
  return page.locator("#viewport").evaluate((canvas) => new Promise((resolve) => requestAnimationFrame(() => {
    const sample = document.createElement("canvas");
    sample.width = 128;
    sample.height = 96;
    const context = sample.getContext("2d", { willReadFrequently: true });
    context.drawImage(canvas, 0, 0, sample.width, sample.height);
    resolve([...context.getImageData(0, 0, sample.width, sample.height).data]);
  })));
}

function pixelDifference(before, after) {
  let total = 0;
  for (let index = 0; index < before.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) total += Math.abs(before[index + channel] - after[index + channel]);
  }
  return total / (before.length / 4 * 3);
}

async function stableSample(page) {
  let before = await canvasSample(page);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.waitForTimeout(100);
    const after = await canvasSample(page);
    if (pixelDifference(before, after) <= 0.03) return after;
    before = after;
  }
  throw new Error("camera rendering did not settle before comparison");
}

async function auditLayout(page, label) {
  const overlaps = await page.locator("#camera-controls").evaluate((camera) => {
    const box = camera.getBoundingClientRect();
    return [...document.querySelectorAll("#body-card, .topbar, #dock, #version-label")]
      .filter((element) => element.getClientRects().length)
      .filter((element) => {
        const other = element.getBoundingClientRect();
        return box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top;
      }).map((element) => element.id || element.className);
  });
  assert.deepEqual(overlaps, [], `${label}: camera controls clear card, header, dock, and credits`);
  const audit = await page.locator("#camera-toggle, #camera-panel button").evaluateAll((buttons) => buttons.map((button) => {
    const box = button.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return {
      id: button.id,
      width: box.width,
      height: box.height,
      inside: box.x >= 0 && box.y >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
      hit: hit === button || button.contains(hit),
    };
  }));
  assert.equal(audit.length, 7);
  for (const item of audit) {
    assert.ok(item.width >= 44 && item.height >= 44, `${label}: 44px control ${JSON.stringify(item)}`);
    assert.equal(item.inside, true, `${label}: control stays in viewport ${JSON.stringify(item)}`);
    assert.equal(item.hit, true, `${label}: control is reachable ${JSON.stringify(item)}`);
  }
  return audit;
}

async function pointerOrbit(page, dx, dy) {
  const start = await page.evaluate(({ dx, dy }) => {
    const canvas = document.querySelector("#viewport");
    for (const y of [0.4, 0.5, 0.6, 0.7]) {
      for (const x of [0.3, 0.5, 0.7]) {
        const sx = innerWidth * x;
        const sy = innerHeight * y;
        if ([0, 0.5, 1].every((t) => document.elementFromPoint(sx + dx * t, sy + dy * t) === canvas)) {
          return { x: sx, y: sy };
        }
      }
    }
    return null;
  }, { dx, dy });
  assert.ok(start, "reference drag has an unobstructed canvas path");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy);
  await page.mouse.up();
}

async function wheel(page, deltaY) {
  const point = await page.evaluate(() => {
    for (const y of [0.4, 0.5, 0.6, 0.25, 0.75]) {
      for (const x of [0.5, 0.7, 0.9]) {
        if (document.elementFromPoint(innerWidth * x, innerHeight * y)?.id === "viewport") {
          return { x: innerWidth * x, y: innerHeight * y };
        }
      }
    }
    return null;
  });
  assert.ok(point, "wheel reference has an unobstructed canvas point");
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, deltaY);
  await page.waitForTimeout(50);
}

async function auditDirections(page, touch, label) {
  const canvas = page.locator("#viewport");
  for (const [id, name, key, dx, dy] of controls) {
    await activate(page, "reset-button", touch);
    const before = await stableSample(page);
    await activate(page, id, touch);
    const byButton = await stableSample(page);
    assert.ok(pixelDifference(before, byButton) > 0.05, `${label}: ${name} changes the view`);
    await activate(page, "reset-button", touch);
    await canvas.focus();
    await page.keyboard.press(key);
    const byKey = await stableSample(page);
    assert.ok(pixelDifference(byButton, byKey) < 0.1, `${label}: ${name} key and button agree`);
    await activate(page, "reset-button", touch);
    if (dx !== undefined) {
      await pointerOrbit(page, dx * CONFIG.cameraOrbitStep / 0.12, dy * CONFIG.cameraOrbitStep / 0.12);
    } else {
      const multiplier = id === "zoom-in" ? 1 / CONFIG.cameraZoomFactor : CONFIG.cameraZoomFactor;
      await wheel(page, Math.log(multiplier) / 0.0016);
    }
    const byPointer = await stableSample(page);
    assert.ok(pixelDifference(byButton, byPointer) < 0.1, `${label}: ${name} preserves existing pointer direction and step`);
  }
  await activate(page, "reset-button", touch);
  const initial = await stableSample(page);
  await canvas.focus();
  const ignored = await canvas.evaluate((element, keys) => {
    const observations = [];
    for (const modifier of ["shiftKey", "altKey", "ctrlKey", "metaKey", "isComposing"]) {
      for (const key of keys) {
        const event = new KeyboardEvent("keydown", { key, [modifier]: true, bubbles: true, cancelable: true });
        element.dispatchEvent(event);
        observations.push({ key, modifier, prevented: event.defaultPrevented });
      }
    }
    return observations;
  }, controls.map(([, , key]) => key));
  assert.ok(ignored.every((event) => !event.prevented), `${label}: modified/composing events retain browser defaults: ${JSON.stringify(ignored)}`);
  assert.ok(pixelDifference(initial, await stableSample(page)) < 0.1, `${label}: modified camera keys are ignored`);
  for (const [upper, lower] of [["I", "i"], ["O", "o"]]) {
    await activate(page, "reset-button", touch);
    await canvas.focus();
    const prevented = await canvas.evaluate((element, key) => {
      const event = new KeyboardEvent("keydown", { key, code: `Key${key}`, bubbles: true, cancelable: true });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    }, upper);
    assert.equal(prevented, true, `${label}: unmodified Caps Lock ${upper} is handled`);
    const capsLock = await stableSample(page);
    await activate(page, "reset-button", touch);
    await canvas.focus();
    await page.keyboard.press(lower);
    assert.ok(pixelDifference(capsLock, await stableSample(page)) < 0.1, `${label}: Caps Lock ${upper} agrees with ${lower}`);
  }
  await activate(page, "reset-button", touch);
  await canvas.focus();
  await page.keyboard.down("ArrowLeft");
  const first = await stableSample(page);
  await page.keyboard.down("ArrowLeft");
  await page.keyboard.up("ArrowLeft");
  assert.ok(pixelDifference(first, await stableSample(page)) > 0.05, `${label}: held-key repeat continues orbiting`);
  for (const [key, reverse] of [["ArrowUp", "ArrowDown"], ["ArrowDown", "ArrowUp"]]) {
    for (let index = 0; index < 25; index += 1) await page.keyboard.press(key);
    const limit = await stableSample(page);
    await page.keyboard.press(key);
    assert.ok(pixelDifference(limit, await stableSample(page)) < 0.1, `${label}: elevation clamps at ${key} boundary`);
    await page.keyboard.press(reverse);
    assert.ok(pixelDifference(limit, await stableSample(page)) > 0.05, `${label}: orbit can leave ${key} boundary`);
  }
}

async function auditShortcutIsolation(page, touch, label) {
  await activate(page, "reset-button", touch);
  const before = await stableSample(page);
  const mode = await page.locator("#sky-mode").inputValue();
  for (const selector of ["#speed-slider", "#sky-mode", "#camera-toggle", "#orbit-left", "#reset-button", "#version-label"]) {
    await page.locator(selector).focus();
    for (const [, , key] of controls) await page.keyboard.press(key);
    await page.locator("#sky-mode").selectOption(mode);
  }
  assert.ok(pixelDifference(before, await stableSample(page)) < 0.1, `${label}: controls and links keep their native keys`);
  const slider = page.locator("#speed-slider");
  await slider.focus();
  const speed = await slider.inputValue();
  await page.keyboard.press("ArrowRight");
  assert.notEqual(await slider.inputValue(), speed, `${label}: native time slider arrow still works`);
  const canvas = page.locator("#viewport");
  await canvas.focus();
  const rate = await page.locator("#speed-readout").textContent();
  await page.keyboard.press("+");
  assert.notEqual(await page.locator("#speed-readout").textContent(), rate, `${label}: + still changes time speed`);
  await page.keyboard.press("-");
  assert.equal(await page.locator("#speed-readout").textContent(), rate, `${label}: - reverses time speed`);
  await page.keyboard.press("Space");
  assert.equal(await page.locator("#play-button").getAttribute("aria-pressed"), "true");
  await page.keyboard.press("Space");
  assert.equal(await page.locator("#play-button").getAttribute("aria-pressed"), "false");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Escape");
  assert.match(await page.locator("#status-live").textContent(), /Returned to the overview/);
  assert.ok(pixelDifference(before, await stableSample(page)) < 0.1, `${label}: Escape still resets the camera`);
}

async function auditRange(page, touch, label, save) {
  await activate(page, "reset-button", touch);
  const outward = [];
  const inward = [];
  const zoomSteps = Math.ceil(Math.log(CONFIG.maxDistance / CONFIG.cameraDistance) / Math.log(CONFIG.cameraZoomFactor)) + 2;
  for (let index = 0; index < zoomSteps; index += 1) {
    await activate(page, "zoom-out", touch);
    outward.push(await page.locator("#scene-context").textContent());
  }
  for (const layer of ["Milky Way", "Nearby galaxies", "Local Group", "Local (Virgo) Supercluster", "Laniakea", "2MRS", "observable universe"]) {
    assert.ok(outward.some((text) => text.includes(layer)), `${label}: single-pointer zoom crosses ${layer}`);
  }
  assert.equal(await page.locator("#sky-mode").isDisabled(), true);
  const maximum = await stableSample(page);
  assert.ok(maximum.some((channel, index) => index % 4 !== 3 && channel > 40), `${label}: maximum renders real pixels`);
  await activate(page, "zoom-out", touch);
  assert.ok(pixelDifference(maximum, await stableSample(page)) < 0.1, `${label}: zoom stops at the maximum`);
  await wheel(page, 100_000);
  assert.ok(pixelDifference(maximum, await stableSample(page)) < 0.1, `${label}: button maximum agrees with existing wheel limit`);
  await save("maximum");
  await page.locator("#viewport").focus();
  const inwardSteps = Math.ceil(Math.log(CONFIG.maxDistance / CONFIG.minDistance) / Math.log(CONFIG.cameraZoomFactor)) + 2;
  for (let index = 0; index < inwardSteps; index += 1) {
    await page.keyboard.press("i");
    await settled(page);
    inward.push(await page.locator("#scene-context").textContent());
  }
  assert.match(inward.at(-1), /Solar system.*Focused on the Sun/);
  for (const layer of ["2MRS", "Laniakea", "Local (Virgo) Supercluster", "Local Group", "Nearby galaxies", "Milky Way"]) {
    assert.ok(inward.some((text) => text.includes(layer)), `${label}: keyboard zoom returns through ${layer}`);
  }
  assert.equal(await page.locator("#sky-mode").isEnabled(), true);
  const minimum = await stableSample(page);
  await page.keyboard.press("i");
  assert.ok(pixelDifference(minimum, await stableSample(page)) < 0.1, `${label}: zoom stops at the minimum`);
  await wheel(page, -100_000);
  assert.ok(pixelDifference(minimum, await stableSample(page)) < 0.1, `${label}: keyboard minimum agrees with existing wheel limit`);
  await save("minimum");
  for (let index = 0; index < 6; index += 1) await page.keyboard.press("o");
  assert.ok(pixelDifference(minimum, await stableSample(page)) > 0.1, `${label}: keyboard zoom can leave the minimum`);
  return { outward: [...new Set(outward)], inward: [...new Set(inward)] };
}

async function focusBody(page, id, touch) {
  await activate(page, "reset-button", touch);
  // Match the full suite's public label-click setup for initially hidden moons.
  await page.locator(`[data-body-id="${id}"]`).evaluate((label) => label.click());
  await settled(page);
  await stableSample(page);
  assert.match(await page.locator("#scene-context").textContent(), new RegExp(`Focused on ${id === "moon" ? "Moon" : "Jupiter"}`));
}

async function auditBodyMinimums(page, save) {
  for (const id of ["jupiter", "moon"]) {
    for (const method of ["button", "keyboard"]) {
      await focusBody(page, id, false);
      await page.locator("#viewport").focus();
      for (let index = 0; index < 24; index += 1) {
        if (method === "button") await activate(page, "zoom-in", false);
        else await page.keyboard.press("i");
      }
      const sample = await stableSample(page);
      // Preserve the parent guard's arrived orientation while comparing floors;
      // different moon flight routes may legitimately choose different seats.
      await wheel(page, -100_000);
      assert.ok(pixelDifference(sample, await stableSample(page)) < 0.1, `${id}: ${method} reaches the existing wheel minimum`);
      assert.equal(await page.locator("#viewport").getAttribute("aria-busy"), "false", `${id}: ${method} focus transition settles`);
    }
    await save(`${id}-minimum`);
  }
}

async function auditSelectedLayouts(page, label, touch, save) {
  await activate(page, "reset-button", touch);
  await page.locator('[data-body-id="earth"]').evaluate((element) => element.click());
  await stableSample(page);
  const original = page.viewportSize();
  const evidence = [];
  for (const viewport of [original, label === "portrait" ? { width: 320, height: 568 } : { width: 568, height: 320 }]) {
    await page.setViewportSize(viewport);
    await settled(page);
    assert.equal(await page.locator("#body-card").isVisible(), true);
    assert.equal(await page.locator("#card-name").textContent(), "Earth");
    const name = `selected-earth-${viewport.width}x${viewport.height}`;
    evidence.push({ ...viewport, controls: await auditLayout(page, `${label} ${name}`) });
    await save(name);
  }
  await page.setViewportSize(original);
  await activate(page, "reset-button", touch);
  return evidence;
}

async function auditFarControls(page, base, save) {
  const cmbSeats = Array.from({ length: 101 }, (_, index) => CONFIG.webViewDistance
    + (CONFIG.universeViewDistance - CONFIG.webViewDistance) * index / 100)
    .filter((distance) => sceneHierarchyId(distance) === "cmb");
  assert.ok(cmbSeats.length, "the CMB transition has a supported camera interval");
  const cmbDistance = (cmbSeats[0] + cmbSeats.at(-1)) / 2;
  for (const look of ["virgo", "cmb"]) {
    await page.goto(`${base}?look=${look === "cmb" ? "web" : look}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.documentElement.dataset.heliosReady === "1");
    if (await page.locator("#play-button").getAttribute("aria-pressed") === "true") await activate(page, "play-button", false);
    if (look === "cmb") await wheel(page, Math.log(cmbDistance / CONFIG.webViewDistance) / 0.0016);
    await activate(page, "camera-toggle", false);
    assert.match(await page.locator("#scene-context").textContent(), look === "cmb" ? /Cosmic microwave background/ : /Virgo Cluster/);
    const initial = await stableSample(page);
    for (const [id, reverse] of [["orbit-left", "ArrowRight"], ["orbit-right", "ArrowLeft"], ["orbit-up", "ArrowDown"], ["orbit-down", "ArrowUp"]]) {
      await activate(page, id, false);
      assert.ok(pixelDifference(initial, await stableSample(page)) > 0.05, `${look}: ${id} changes the non-Solar view`);
      await page.locator("#viewport").focus();
      await page.keyboard.press(reverse);
      assert.ok(pixelDifference(initial, await stableSample(page)) < 0.1, `${look}: ${reverse} reverses ${id}`);
    }
    if (look === "cmb") {
      for (const [key, reverse] of [["i", "o"], ["o", "i"]]) {
        await page.keyboard.press(key);
        assert.ok(pixelDifference(initial, await stableSample(page)) > 0.05, `CMB: ${key} changes the view`);
        await page.keyboard.press(reverse);
        assert.ok(pixelDifference(initial, await stableSample(page)) < 0.1, `CMB: ${reverse} reverses ${key}`);
      }
    }
    await save(`${look}-controls`);
  }
}

export async function auditCameraNavigation(browser, base, screenshotDir) {
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  for (const [label, width, height, touch] of [
    ["desktop", 1440, 900, false], ["compact", 1024, 768, false],
    ["portrait", 390, 844, true], ["landscape", 844, 390, true],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("requestfailed", (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
    const save = async (name) => {
      if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `camera-${label}-${name}.png`) });
    };
    try {
      await page.goto(base, { waitUntil: "networkidle" });
      await page.waitForFunction(() => document.documentElement.dataset.heliosReady === "1");
      await activate(page, "play-button", touch);
      const toggle = page.locator("#camera-toggle");
      const panel = page.locator("#camera-panel");
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      assert.equal(await toggle.getAttribute("aria-controls"), "camera-panel");
      assert.equal(await panel.isHidden(), true);
      assert.equal(await page.locator("#viewport").getAttribute("aria-describedby"), "scene-context camera-help");
      assert.equal(await page.locator("#viewport").getAttribute("aria-keyshortcuts"), "ArrowLeft ArrowRight ArrowUp ArrowDown I O");
      const closed = await page.locator("#stage").ariaSnapshot();
      assert.doesNotMatch(closed, /button "Orbit left"/);
      await save("closed");
      await toggle.focus();
      await page.keyboard.press("Enter");
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      assert.equal(await panel.isVisible(), true);
      const opened = await panel.ariaSnapshot();
      for (const [id, name] of controls) {
        assert.equal(await panel.getByRole("button", { name, exact: true }).getAttribute("id"), id);
        assert.ok(opened.includes(`button "${name}"`), `${label}: accessibility tree names ${name}`);
      }
      const help = await panel.textContent();
      assert.match(help, /Arrow/i);
      assert.match(help, /\bI\b.*zooms? in/i);
      assert.match(help, /\bO\b.*zooms? out/i);
      const layout = await auditLayout(page, label);
      await save("open");
      const reached = new Set();
      for (let index = 0; index < 50 && reached.size < controls.length; index += 1) {
        await page.keyboard.press("Tab");
        const focus = await page.evaluate(() => {
          const element = document.activeElement;
          const style = getComputedStyle(element);
          return { id: element.id, visible: element.matches(":focus-visible") && style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2 };
        });
        if (controls.some(([id]) => id === focus.id)) {
          assert.equal(focus.visible, true, `${label}: ${focus.id} has keyboard-visible focus`);
          reached.add(focus.id);
        }
      }
      assert.equal(reached.size, controls.length, `${label}: Tab reaches every camera control`);
      await toggle.focus();
      await page.keyboard.press("Space");
      assert.equal(await toggle.getAttribute("aria-expanded"), "false", `${label}: native Space closes exactly once`);
      await activate(page, "camera-toggle", touch);
      await auditDirections(page, touch, label);
      await auditShortcutIsolation(page, touch, label);
      const selectedLayouts = touch ? await auditSelectedLayouts(page, label, touch, save) : [];
      const range = await auditRange(page, touch, label, save);
      if (label === "desktop") {
        await auditBodyMinimums(page, save);
        await auditFarControls(page, base, save);
        await page.goto(`${base}?look=sky`, { waitUntil: "networkidle" });
        await page.waitForFunction(() => document.documentElement.dataset.heliosReady === "1");
        assert.equal(await page.locator("#camera-controls").isHidden(), true);
        assert.equal(await page.locator("#viewport").getAttribute("aria-describedby"), "scene-context");
        assert.equal(await page.locator("#viewport").getAttribute("aria-keyshortcuts"), null);
        const diagnostic = await stableSample(page);
        await page.locator("#viewport").focus();
        for (const [, , key] of controls) await page.keyboard.press(key);
        assert.ok(pixelDifference(diagnostic, await stableSample(page)) < 0.1, "fixed Earth-sky diagnostic ignores camera shortcuts");
      }
      assert.deepEqual(errors, [], `${label}: camera navigation has no runtime, console, or network errors`);
      if (screenshotDir) await writeFile(path.join(screenshotDir, `camera-${label}-accessibility.json`), JSON.stringify({ label, width, height, touchEmulation: touch, closed, opened, layout, selectedLayouts, range }, null, 2) + "\n");
      console.log(`camera navigation ${label} ${width}x${height} ok`);
    } finally {
      await context.close();
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const port = Number(process.env.BROWSER_SMOKE_PORT || 4176);
  const server = spawn(process.execPath, ["tests/serve.mjs"], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  let browser;
  try {
    const [line] = await Promise.race([once(server.stdout, "data"), once(server, "exit").then(([code]) => { throw new Error(`server exited ${code}`); })]);
    assert.match(String(line), /Helios local server/);
    browser = await chromium.launch({ headless: true, executablePath: process.env.HELIOS_CHROMIUM_PATH || undefined, args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
    await auditCameraNavigation(browser, `http://127.0.0.1:${port}/Helios/`, process.env.HELIOS_SCREENSHOT_DIR);
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
  }
}
