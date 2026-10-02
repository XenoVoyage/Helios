import assert from "node:assert/strict";
import { BODIES, visualBodyRadius, visualRingRadius } from "../js/bodies.js";

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
      let sample = null, targetId = "earth", drawn = false;
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
        const controls = [".topbar", "#body-card", "#camera-controls", "#dock", "#version-label"]
          .map((selector) => document.querySelector(selector)).filter((element) => !element.hidden && element.getClientRects().length)
          .map((element) => ({ id: element.id || element.className, ...element.getBoundingClientRect().toJSON() }));
        const label = document.querySelector(`[data-body-id="${id}"]`);
        const labelBox = label.getBoundingClientRect().toJSON();
        const labelAnchor = label.style.transform.match(/translate\(([-+\deE.]+)px,\s*([-+\deE.]+)px\)/);
        sample = { id, x, y, radius: pixels, worldRadius: radius, depth, verticalProjection: camera.projectionMatrix.elements[5], ndc: projected.toArray(), drawn,
          label: { hidden: label.hidden, active: label.classList.contains("is-active"), box: labelBox,
            anchor: labelAnchor ? { x: Number(labelAnchor[1]), y: Number(labelAnchor[2]) } : null },
          camera: camera.position.toArray(), zoom: camera.zoom,
          principalPoint: { x: (1 - camera.projectionMatrix.elements[8]) * innerWidth / 2,
            y: (1 + camera.projectionMatrix.elements[9]) * innerHeight / 2 },
          cardHidden: document.querySelector("#body-card").hidden,
          busy: document.querySelector("#viewport").getAttribute("aria-busy"),
          viewport: { width: innerWidth, height: innerHeight }, controls };
      };
      return { sample: () => sample, target: (id) => { targetId = id; }, restore: () => {
        THREE.Scene.prototype.onAfterRender = original;
        THREE.Scene.prototype.onBeforeRender = before;
        THREE.Mesh.prototype.onAfterRender = meshAfter;
      } };
    });
    const settled = async (id) => {
      let previous;
      for (let attempt = 0; attempt < 140; attempt += 1) {
        await page.clock.fastForward(50);
        const sample = await observer.evaluate((value) => value.sample());
        if (sample?.id === id && sample.busy === "false" && previous?.id === id
          && Math.hypot(sample.x - sample.principalPoint.x, sample.y - sample.principalPoint.y) < 0.05
          && Math.hypot(sample.x - previous.x, sample.y - previous.y) < 0.02
          && Math.hypot(...sample.camera.map((value, index) => value - previous.camera[index])) < 0.0001) return sample;
        previous = sample;
      }
      throw new Error(`Compact selection failed to settle: ${JSON.stringify(previous)}`);
    };
    const inspect = async (id, expanded, name) => {
      const sample = await settled(id);
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
      assert.ok(label.width >= 44 && label.height >= 44 && label.left >= 7 && label.right <= sample.viewport.width - 7
        && label.top >= 7 && label.bottom <= sample.viewport.height - 7, `${name}: full-size label stays on screen`);
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
      const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, sample);
      assert.equal(hit, "viewport", `${name}: the globe center is reachable`);
      assert.equal(await page.locator("#camera-toggle").getAttribute("aria-expanded"), String(expanded));
      report.observations.push({ name, expanded, ...sample });
      return sample;
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
          if (["earth", "saturn", "ganymede"].includes(body.id)) await onStill(page, name);
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
      await onStill(page, name);
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
  } finally {
    if (observer) { await observer.evaluate((value) => value.restore()); await observer.dispose(); }
    await onReport(report);
    await context.close();
  }
}
