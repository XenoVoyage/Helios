import assert from "node:assert/strict";
import { BODIES, visualBodyRadius, visualRingRadius } from "../js/bodies.js";

export function compactLayoutMatches(sample, live) {
  return Boolean(sample && live && sample.resizeEpoch === live.resizeEpoch
    && sample.viewport.width === live.viewport.width && sample.viewport.height === live.viewport.height
    && sample.cameraExpanded === live.cameraExpanded
    && sample.clearances.camera === live.clearances.camera && sample.clearances.dock === live.clearances.dock
    && sample.controls.length === live.controls.length
    && sample.controls.every((box, index) => box.id === live.controls[index].id
      && ["left", "right", "top", "bottom", "width", "height"].every((key) => box[key] === live.controls[index][key])));
}

export function compactClearancesReady(layout) {
  return ["camera", "dock"].every((name) => {
    const box = layout.controls.find((control) => control.id === (name === "camera" ? "camera-controls" : "dock"));
    return box && layout.clearances[name] === Math.ceil(box.height);
  });
}

export function compactLayoutSettled(previous, sample, live) {
  return Boolean(previous && sample && live && sample.frame === previous.frame + 1
    && compactLayoutMatches(previous, sample) && compactLayoutMatches(sample, live)
    && compactClearancesReady(sample) && compactClearancesReady(live));
}

export function assertCompactLabelBounds(label, viewport, name) {
  const box = label.box;
  assert.ok(label.layoutWidth >= 44 && label.layoutHeight >= 44, `${name}: label layout retains a 44px target`);
  // Fractional translate coordinates can make a 44px DOMRect read 43.999996px.
  const epsilon = 1e-4;
  assert.ok(box.width + epsilon >= 44 && box.height + epsilon >= 44, `${name}: rendered label retains its full target size`);
  assert.ok(box.left >= 7 && box.right <= viewport.width - 7
    && box.top >= 7 && box.bottom <= viewport.height - 7, `${name}: full-size label stays on screen`);
}

export function compactCaptureMetrics({ data, width, height, left, top }, sample, exclusions) {
  let samples = 0, colored = 0, totalDifference = 0, luminance = 0, squaredLuminance = 0;
  const radius = sample.radius * 0.6;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const screenX = left + x + 0.5, screenY = top + y + 0.5;
    if (Math.hypot(screenX - sample.x, screenY - sample.y) > radius) continue;
    if (exclusions.some((box) => screenX >= box.left - 3 && screenX <= box.right + 3
      && screenY >= box.top - 3 && screenY <= box.bottom + 3)) continue;
    const offset = (y * width + x) * 4;
    const difference = Math.abs(data[offset] - 2) + Math.abs(data[offset + 1] - 5) + Math.abs(data[offset + 2] - 12);
    const value = data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
    samples += 1;
    totalDifference += difference;
    luminance += value;
    squaredLuminance += value * value;
    if (difference > 12) colored += 1;
  }
  return { samples, coloredFraction: samples ? colored / samples : 0,
    meanBackgroundDifference: samples ? totalDifference / samples : 0,
    luminanceStdDev: samples ? Math.sqrt(Math.max(0, squaredLuminance / samples - (luminance / samples) ** 2)) : 0 };
}

export function assertCompactCaptureContent(metrics, name) {
  assert.ok(metrics.samples >= 64, `${name}: saved PNG has enough unobstructed globe pixels`);
  assert.ok(metrics.coloredFraction >= 0.5 && metrics.meanBackgroundDifference > 20 && metrics.luminanceStdDev > 3,
    `${name}: saved PNG contains the rendered globe, not a cleared WebGL surface: ${JSON.stringify(metrics)}`);
}

export async function auditCompactFocus(browser, base, { onStill, onReport }) {
  const report = { observations: [], errors: [] };
  const context = await browser.newContext({ viewport: { width: 320, height: 568 },
    deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  page.on("pageerror", (error) => report.errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") report.errors.push(message.text()); });
  page.on("requestfailed", (request) => report.errors.push(request.url()));
  let observer;
  try {
    await page.clock.install({ time: new Date("2026-09-05T00:00:00Z") });
    await page.addInitScript(() => {
      const raf = requestAnimationFrame.bind(window);
      let firstTick = true;
      window.requestAnimationFrame = (callback) => raf((timestamp) => {
        if (callback.name === "tick" && firstTick) {
          firstTick = false;
          const play = document.querySelector("#play-button");
          if (play?.getAttribute("aria-pressed") === "true") play.click();
        }
        callback(timestamp);
      });
    });
    await page.goto(base, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.documentElement.dataset.heliosReady === "1");
    if (await page.locator("#play-button").getAttribute("aria-pressed") === "true") await page.locator("#play-button").tap();
    await page.clock.pauseAt(new Date("2026-09-05T01:00:00Z"));
    observer = await page.evaluateHandle(async () => {
      const THREE = await import(new URL("vendor/three.module.min.js", location.href).href);
      const original = THREE.Scene.prototype.onAfterRender;
      const before = THREE.Scene.prototype.onBeforeRender, meshAfter = THREE.Mesh.prototype.onAfterRender;
      const meshes = new Map(), world = new THREE.Vector3(), projected = new THREE.Vector3(), scale = new THREE.Vector3();
      let sample = null, previous = null, targetId = "earth", drawn = false, frame = 0, resizeEpoch = 0;
      const resized = () => { resizeEpoch += 1; };
      window.addEventListener("resize", resized);
      const readLayout = () => {
        const style = getComputedStyle(document.documentElement);
        const clearances = { camera: parseFloat(style.getPropertyValue("--camera-clearance")),
          dock: parseFloat(style.getPropertyValue("--dock-clearance")) };
        const controls = [".topbar", "#body-card", "#camera-controls", "#dock", "#version-label"]
          .map((selector) => document.querySelector(selector)).filter((element) => !element.hidden && element.getClientRects().length)
          .map((element) => ({ id: element.id || element.className, ...element.getBoundingClientRect().toJSON() }));
        return { resizeEpoch, clearances, controls, viewport: { width: innerWidth, height: innerHeight },
          cameraExpanded: document.querySelector("#camera-toggle").getAttribute("aria-expanded") === "true" };
      };
      THREE.Scene.prototype.onBeforeRender = function (...args) { before.apply(this, args); drawn = false; };
      THREE.Mesh.prototype.onAfterRender = function (...args) {
        meshAfter.apply(this, args);
        if (this === meshes.get(targetId)) drawn = true;
      };
      THREE.Scene.prototype.onAfterRender = function (renderer, scene, camera) {
        original.call(this, renderer, scene, camera);
        if (!meshes.size) this.traverse((object) => {
          if (object.isMesh && object.userData.bodyId && !meshes.has(object.userData.bodyId)) meshes.set(object.userData.bodyId, object);
        });
        const id = targetId;
        const mesh = meshes.get(id);
        if (!mesh) return;
        world.setFromMatrixPosition(mesh.matrixWorld);
        projected.copy(world).project(camera);
        const depth = -world.clone().applyMatrix4(camera.matrixWorldInverse).z;
        const radius = mesh.geometry.boundingSphere.radius * scale.setFromMatrixScale(mesh.matrixWorld).x;
        const pixels = radius * camera.projectionMatrix.elements[5] * innerHeight
          / (2 * Math.sqrt(depth * depth - radius * radius));
        const x = (projected.x + 1) * innerWidth / 2, y = (1 - projected.y) * innerHeight / 2;
        const layout = readLayout();
        const label = document.querySelector(`[data-body-id="${id}"]`);
        const labelBox = label.getBoundingClientRect().toJSON();
        const labelAnchor = label.style.transform.match(/translate\(([-+\deE.]+)px,\s*([-+\deE.]+)px\)/);
        const gl = renderer.getContext();
        previous = sample;
        sample = { ...layout, id, frame: ++frame,
          buffer: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight,
            canvasWidth: renderer.domElement.width, canvasHeight: renderer.domElement.height },
          x, y, radius: pixels, worldRadius: radius, depth, verticalProjection: camera.projectionMatrix.elements[5], ndc: projected.toArray(), drawn,
          label: { hidden: label.hidden, active: label.classList.contains("is-active"), box: labelBox,
            layoutWidth: label.offsetWidth, layoutHeight: label.offsetHeight,
            anchor: labelAnchor ? { x: Number(labelAnchor[1]), y: Number(labelAnchor[2]) } : null },
          camera: camera.position.toArray(), zoom: camera.zoom,
          principalPoint: { x: (1 - camera.projectionMatrix.elements[8]) * innerWidth / 2,
            y: (1 + camera.projectionMatrix.elements[9]) * innerHeight / 2 },
          cardHidden: document.querySelector("#body-card").hidden,
          busy: document.querySelector("#viewport").getAttribute("aria-busy") };
      };
      return { sample: () => sample,
        snapshot: (point = sample) => ({ previous, sample, live: readLayout(),
          hit: point ? document.elementFromPoint(point.x, point.y)?.id : null }),
        captureState: () => ({ resizeEpoch, frame, viewport: { width: innerWidth, height: innerHeight } }),
        target: (id) => { targetId = id; }, restore: () => {
        THREE.Scene.prototype.onAfterRender = original;
        THREE.Scene.prototype.onBeforeRender = before;
        THREE.Mesh.prototype.onAfterRender = meshAfter;
        window.removeEventListener("resize", resized);
      } };
    });
    const settled = async (id, name = id) => {
      let snapshot;
      for (let attempt = 0; attempt < 140; attempt += 1) {
        // Deliver consecutive RAFs so ResizeObserver can finish the chrome reflow.
        // Elapsed time alone is insufficient: prove measured layout convergence.
        await page.clock.runFor(50);
        snapshot = await observer.evaluate((value) => value.snapshot());
        const { previous, sample, live } = snapshot;
        if (sample?.id === id && sample.busy === "false" && previous?.id === id
          && compactLayoutSettled(previous, sample, live)
          && Math.hypot(sample.x - sample.principalPoint.x, sample.y - sample.principalPoint.y) < 0.05
          && Math.hypot(sample.x - previous.x, sample.y - previous.y) < 0.02
          && Math.hypot(...sample.camera.map((value, index) => value - previous.camera[index])) < 0.0001) return sample;
      }
      const error = new Error(`Compact selection failed to settle: ${JSON.stringify(snapshot)}`);
      error.compactLayout = snapshot;
      error.compactScenario = name;
      throw error;
    };
    const inspect = async (id, expanded, name, suppliedSample = null, existingObservation = null) => {
      const sample = suppliedSample ?? await settled(id, name);
      const observation = existingObservation ?? { name, expanded };
      Object.assign(observation, sample, { passed: false });
      if (!existingObservation) report.observations.push(observation);
      const current = await observer.evaluate((value, point) => value.snapshot(point), sample);
      observation.liveLayout = current.live;
      observation.hit = current.hit;
      assert.equal(current.sample.frame, sample.frame, `${name}: geometry and hit testing use the same rendered frame`);
      assert.ok(compactLayoutMatches(sample, current.live), `${name}: live chrome matches the rendered geometry`);
      assert.ok(compactLayoutSettled(current.previous, current.sample, current.live), `${name}: chrome reflow is complete`);
      const sphere = { left: sample.x - sample.radius, right: sample.x + sample.radius,
        top: sample.y - sample.radius, bottom: sample.y + sample.radius };
      assert.ok(sample.radius > 0 && Number.isFinite(sample.radius), `${name}: finite rendered sphere`);
      assert.equal(sample.drawn, true, `${name}: real renderer submits the selected globe`);
      assert.equal(sample.label.hidden, false, `${name}: selected label stays visible`);
      assert.equal(sample.label.active, true, `${name}: selected label owns selection`);
      assert.ok(sample.label.anchor, `${name}: selected label has a projected anchor`);
      assert.ok(Math.hypot(sample.label.anchor.x - sample.x, sample.label.anchor.y - sample.y) < 0.25,
        `${name}: label anchor agrees with the independently projected body`);
      const body = BODIES.find((item) => item.id === id), normalRadius = visualBodyRadius(body);
      const normalDistance = Math.max(normalRadius * 7.5, 5.5);
      const normalDiameter = normalRadius * sample.viewport.height
        / (Math.tan(52 * Math.PI / 360) * Math.sqrt(normalDistance ** 2 - normalRadius ** 2));
      // DOM and projected bounds are fractional; a half pixel is not a size regression.
      assert.ok(sample.radius * 2 + 0.5 >= Math.min(32, normalDiameter * 0.75),
        `${name}: framing preserves a useful globe size, including naturally tiny moons`);
      assert.ok(sample.ndc[2] > -1 && sample.ndc[2] < 1, `${name}: body is inside the frustum`);
      assert.ok(sphere.left >= 7 && sphere.right <= sample.viewport.width - 7
        && sphere.top >= 7 && sphere.bottom <= sample.viewport.height - 7, `${name}: whole globe stays on screen`);
      for (const box of sample.controls) assert.ok(sphere.right <= box.left - 7 || sphere.left >= box.right + 7
        || sphere.bottom <= box.top - 7 || sphere.top >= box.bottom + 7,
      `${name}: whole globe clears ${box.id}: ${JSON.stringify(sample)}`);
      const label = sample.label.box;
      assertCompactLabelBounds(sample.label, sample.viewport, name);
      for (const box of sample.controls) assert.ok(label.right <= box.left - 7 || label.left >= box.right + 7
        || label.bottom <= box.top - 7 || label.top >= box.bottom + 7, `${name}: label clears ${box.id}`);
      if (body.ringOuterKm) {
        const outerRadius = visualRingRadius(body, body.ringOuterKm);
        const ringRadius = outerRadius * sample.verticalProjection * sample.viewport.height
          / (2 * Math.sqrt(sample.depth ** 2 - outerRadius ** 2));
        assert.ok(sample.x - ringRadius >= 7 && sample.x + ringRadius <= sample.viewport.width - 7
          && sample.y - ringRadius >= 7 && sample.y + ringRadius <= sample.viewport.height - 7,
        `${name}: entire ring envelope stays on screen`);
        for (const box of sample.controls) assert.ok(sample.x + ringRadius <= box.left - 7 || sample.x - ringRadius >= box.right + 7
          || sample.y + ringRadius <= box.top - 7 || sample.y - ringRadius >= box.bottom + 7, `${name}: entire ring envelope clears ${box.id}`);
      }
      assert.equal(current.hit, "viewport", `${name}: the globe center is reachable`);
      assert.equal(await page.locator("#camera-toggle").getAttribute("aria-expanded"), String(expanded));
      observation.passed = true;
      return sample;
    };
    const capture = async (name) => {
      const observation = report.observations.at(-1);
      observation.passed = false;
      const before = await observer.evaluate((value) => value.sample());
      // fastForward delivers one RAF regardless of its jump. Run consecutive
      // frames before capturing a resized surface, then validate the saved PNG.
      await page.clock.runFor(64);
      const sample = await observer.evaluate((value) => value.sample());
      observation.capture = { frame: sample.frame, previousFrame: before.frame, resizeEpoch: sample.resizeEpoch,
        buffer: sample.buffer, viewport: sample.viewport, metrics: null,
        geometry: { id: sample.id, x: sample.x, y: sample.y, radius: sample.radius,
          principalPoint: sample.principalPoint, ndc: sample.ndc, label: sample.label } };
      assert.ok(sample.frame >= before.frame + 2, `${name}: capture follows consecutive application renders`);
      assert.equal(sample.id, observation.id, `${name}: capture retains the inspected body`);
      assert.deepEqual(sample.viewport, observation.viewport, `${name}: capture retains the inspected viewport`);
      assert.equal(sample.resizeEpoch, observation.resizeEpoch, `${name}: resize is complete before capture`);
      assert.deepEqual(sample.buffer, { width: sample.viewport.width, height: sample.viewport.height,
        canvasWidth: sample.viewport.width, canvasHeight: sample.viewport.height }, `${name}: renderer uses the resized drawing buffer`);
      assert.equal(sample.drawn, true, `${name}: capture follows a submitted globe`);
      await inspect(observation.id, observation.expanded, name, sample, observation);
      observation.passed = false;
      const png = await onStill(page, name);
      const capturedState = await observer.evaluate((value) => value.captureState());
      observation.capture.afterSave = capturedState;
      assert.deepEqual(capturedState.viewport, sample.viewport, `${name}: viewport remains unchanged through PNG acquisition`);
      assert.equal(capturedState.resizeEpoch, sample.resizeEpoch, `${name}: no resize occurs during PNG acquisition`);
      assert.ok(png?.length > 24, `${name}: capture returns the exact saved PNG bytes`);
      const pixels = await page.evaluate(async ({ source, sample }) => {
        const image = new Image();
        const ready = new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = reject;
        });
        image.src = `data:image/png;base64,${source}`;
        await ready;
        if (image.naturalWidth !== sample.viewport.width || image.naturalHeight !== sample.viewport.height) {
          throw new Error("Compact capture dimensions do not match the rendered viewport");
        }
        const radius = sample.radius * 0.6;
        const left = Math.max(0, Math.floor(sample.x - radius)), top = Math.max(0, Math.floor(sample.y - radius));
        const width = Math.min(image.naturalWidth, Math.ceil(sample.x + radius)) - left;
        const height = Math.min(image.naturalHeight, Math.ceil(sample.y + radius)) - top;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, -left, -top);
        const exclusions = [...document.querySelectorAll(".sky-label:not([hidden])")]
          .map((element) => element.getBoundingClientRect().toJSON());
        return { data: [...context.getImageData(0, 0, width, height).data], width, height, left, top, exclusions };
      }, { source: png.toString("base64"), sample });
      const metrics = compactCaptureMetrics(pixels, sample, [...sample.controls, ...pixels.exclusions]);
      observation.capture.metrics = metrics;
      assertCompactCaptureContent(metrics, name);
      observation.passed = true;
    };
    for (const [width, height] of [[320, 568], [568, 320]]) {
      await page.setViewportSize({ width, height });
      for (const body of BODIES) {
        await observer.evaluate((value, id) => value.target(id), body.id);
        await page.evaluate((id) => document.querySelector(`[data-body-id="${id}"]`).click(), body.id);
        let cameraBefore;
        for (const expanded of [false, true]) {
          if ((await page.locator("#camera-toggle").getAttribute("aria-expanded") === "true") !== expanded) await page.locator("#camera-toggle").tap();
          const name = `compact-focus-${width}x${height}-${body.id}-${expanded ? "open" : "closed"}`;
          const sample = await inspect(body.id, expanded, name);
          if (!expanded) cameraBefore = sample.camera;
          else assert.ok(Math.hypot(...sample.camera.map((value, index) => value - cameraBefore[index])) < 0.01,
            `${name}: opening Camera preserves its world position`);
          if (["earth", "saturn", "ganymede"].includes(body.id)) await capture(name);
        }
      }
    }
    await page.locator("#camera-toggle").tap();
    await observer.evaluate((value) => value.target("earth"));
    await page.evaluate(() => document.querySelector('[data-body-id="earth"]').click());
    for (const [width, height] of [[720, 501], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      const name = `compact-focus-rotate-${width}x${height}`;
      const sample = await inspect("earth", false, name);
      if (width === 1440) {
        assert.deepEqual(sample.principalPoint, { x: width / 2, y: height / 2 });
        assert.equal(sample.zoom, 1, "desktop restores the original projection");
      }
      await capture(name);
    }
    await page.setViewportSize({ width: 568, height: 320 });
    const picked = await settled("earth");
    await page.touchscreen.tap(picked.x, picked.y);
    assert.equal(await page.locator("#card-name").textContent(), "Earth", "off-axis globe picking selects the rendered world");
    await page.locator("#card-close").tap();
    await page.clock.fastForward(100);
    const closed = await observer.evaluate((value) => value.sample());
    assert.equal(closed.cardHidden, true);
    assert.deepEqual(closed.principalPoint, { x: 284, y: 160 }, "closing the card restores centered projection");
    assert.equal(closed.zoom, 1);
    assert.deepEqual(report.errors, [], "compact focus has no browser errors");
  } catch (error) {
    report.failure = { message: error.message, scenario: error.compactScenario ?? report.observations.at(-1)?.name ?? null };
    if (error.compactLayout) report.failure.layout = error.compactLayout;
    try {
      await onStill(page, "compact-focus-failure", { timeout: 10_000 });
    } catch (captureError) {
      report.failure.screenshotError = String(captureError);
    }
    throw error;
  } finally {
    if (observer) { await observer.evaluate((value) => value.restore()); await observer.dispose(); }
    await onReport(report);
    await context.close();
  }
}
