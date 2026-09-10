/**
 * Shared browser regression and full-frame evidence for moving Solar targets.
 * The cached, served THREE module supplies read-only render observers: no app
 * closure, orbital reconstruction, target repositioning, or screenshot settling.
 * Public range inputs retain their native step; effectiveRate records rounding.
 * Capture callers use assertTracking:false, lifecycle:false for honest baselines.
 */
export const focusTrackingScenarios = Object.freeze([
  { id: "desktop-mercury-1", bodyId: "mercury", touch: false, requestedRate: 1 },
  { id: "desktop-mercury-10", bodyId: "mercury", touch: false, requestedRate: 10 },
  { id: "desktop-mercury-400", bodyId: "mercury", touch: false, requestedRate: 400 },
  { id: "desktop-io-400", bodyId: "io", touch: false, requestedRate: 400 },
  { id: "portrait-mercury-1", bodyId: "mercury", touch: true, requestedRate: 1 },
  { id: "portrait-mercury-400", bodyId: "mercury", touch: true, requestedRate: 400 },
].map(Object.freeze));

export const focusTrackingOffsets = Object.freeze([0, 500, 1000, 1500, 2000]);

const anchorTolerance = 1;
const maxFrames = 2048;
const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]));

async function installObserver(page, bodyId) {
  return page.evaluateHandle(async ({ bodyId, maxFrames }) => {
    // The app imports this exact URL. A second THREE copy would miss every hook.
    const THREE = await import(new URL("vendor/three.module.min.js", location.href).href);
    const { CONFIG } = await import(new URL("js/config.js", location.href).href);
    const descriptors = [
      [THREE.Scene.prototype, "onBeforeRender"],
      [THREE.Scene.prototype, "onAfterRender"],
      [THREE.Mesh.prototype, "onAfterRender"],
    ].map(([prototype, name]) => ({ prototype, name, own: Object.getOwnPropertyDescriptor(prototype, name), original: prototype[name] }));
    const meshes = new Map();
    const frames = [];
    const world = new THREE.Vector3(), projected = new THREE.Vector3(), cameraWorld = new THREE.Vector3();
    let phase = "initial", targetId = bodyId, drawn = false, overflow = false;
    let previousTimestamp = null, expectedDays = 0;
    const minimum = CONFIG.minDaysPerSecond, maximum = CONFIG.maxDaysPerSecond;
    const rate = () => Math.exp(Math.log(minimum) + (Math.log(maximum) - Math.log(minimum)) * Number(document.querySelector("#speed-slider").value));
    THREE.Scene.prototype.onBeforeRender = function (...args) {
      descriptors[0].original.apply(this, args);
      drawn = false;
      if (!meshes.size) this.traverse((object) => {
        if (object.isMesh && object.userData.bodyId) meshes.set(object.userData.bodyId, object);
      });
    };
    THREE.Mesh.prototype.onAfterRender = function (...args) {
      descriptors[2].original.apply(this, args);
      if (this === meshes.get(targetId)) drawn = true;
    };
    THREE.Scene.prototype.onAfterRender = function (renderer, scene, camera) {
      descriptors[1].original.call(this, renderer, scene, camera);
      const mesh = meshes.get(targetId);
      if (!mesh) return;
      if (frames.length >= maxFrames) { overflow = true; return; }
      const timestamp = globalThis.__heliosTrackingLastTick?.timestamp;
      if (!Number.isFinite(timestamp)) throw new Error("Render observer has no application RAF timestamp");
      const playing = document.querySelector("#play-button")?.getAttribute("aria-pressed") === "true";
      const effectiveRate = rate();
      if (previousTimestamp !== null && playing) {
        expectedDays = Math.min((8640000000000000 - Date.UTC(2000, 0, 1, 12)) / 86400000,
          expectedDays + Math.max(0, timestamp - previousTimestamp) / 1000 * effectiveRate);
      }
      previousTimestamp = timestamp;
      // matrixWorld is the matrix just used for the real render. Do not call an
      // update method or rely on label coordinates to reconstruct this position.
      world.setFromMatrixPosition(mesh.matrixWorld);
      projected.copy(world).project(camera);
      cameraWorld.setFromMatrixPosition(camera.matrixWorld);
      const canvas = document.querySelector("#viewport");
      const viewport = canvas.getBoundingClientRect();
      const label = document.querySelector(`[data-body-id="${targetId}"]`);
      const rect = label?.getBoundingClientRect();
      const transform = label?.style.transform ?? "";
      const match = transform.match(/translate\(([-+\deE.]+)px,\s*([-+\deE.]+)px\)/);
      const style = label ? getComputedStyle(label) : null;
      const sceneText = document.querySelector("#scene-context")?.textContent ?? "";
      // The public scene description contains focus prose, but exposes no ID.
      // The stable announcement distinguishes the two handoff layers we visit.
      const sceneHierarchy = /^Solar system\./.test(sceneText) ? "solar"
        : /^Leaving the solar system/.test(sceneText) ? "transition"
          : /^Milky Way\./.test(sceneText) ? "milkyway" : "other";
      const expectedStamp = Math.min(8640000000000000, Date.UTC(2000, 0, 1, 12) + expectedDays * 86400000);
      frames.push({
        index: frames.length, timestamp, performanceNow: performance.now(), phase, bodyId: targetId,
        world: world.toArray(), ndc: projected.toArray(),
        projected: { x: (projected.x * 0.5 + 0.5) * viewport.width + viewport.x,
          y: (-projected.y * 0.5 + 0.5) * viewport.height + viewport.y },
        camera: { world: cameraWorld.toArray(), quaternion: camera.quaternion.toArray(), near: camera.near, far: camera.far },
        drawn, playing, effectiveRate,
        clockText: document.querySelector("#clock")?.textContent,
        expectedClockText: new Date(expectedStamp).toISOString().split("T")[0], expectedDays,
        label: label ? { hidden: label.hidden || style.display === "none" || style.visibility === "hidden",
          active: label.classList.contains("is-active"), transform,
          anchor: match ? { x: Number(match[1]), y: Number(match[2]) } : null,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } } : null,
        busy: canvas.getAttribute("aria-busy"), scene: sceneText, sceneHierarchy,
        card: { name: document.querySelector("#card-name")?.textContent, hidden: document.querySelector("#body-card")?.hidden },
      });
    };
    return {
      setPhase(value, target = targetId) { phase = value; targetId = target; },
      snapshot() { return { frames, overflow, meshIds: [...meshes.keys()], minimum, maximum }; },
      restore() {
        for (const { prototype, name, own } of descriptors) {
          if (own) Object.defineProperty(prototype, name, own);
          else delete prototype[name];
        }
      },
    };
  }, { bodyId, maxFrames });
}

async function openPaused(page, base) {
  await page.clock.install({ time: new Date("2026-09-05T00:00:00Z") });
  await page.addInitScript(() => {
    const requestFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => requestFrame((timestamp) => {
      if (callback.name === "tick" && !globalThis.__heliosTrackingFirstTick) {
        const play = document.querySelector("#play-button");
        const before = play?.getAttribute("aria-pressed");
        if (before === "true") play.click();
        globalThis.__heliosTrackingFirstTick = { callback: callback.name, timestamp, before,
          pausedBeforeCallback: play?.getAttribute("aria-pressed") === "false",
          clockText: document.querySelector("#clock")?.textContent };
      }
      if (callback.name === "tick") globalThis.__heliosTrackingLastTick = { timestamp };
      callback(timestamp);
    });
    const observer = new MutationObserver(() => {
      if (document.documentElement?.dataset.heliosReady !== "1") return;
      const play = document.querySelector("#play-button");
      if (play?.getAttribute("aria-pressed") === "true") play.click();
      globalThis.__heliosTrackingPausedAtReady = play?.getAttribute("aria-pressed") === "false";
      observer.disconnect();
    });
    observer.observe(document, { attributes: true, attributeFilter: ["data-helios-ready"], subtree: true });
  });
  await page.goto(base, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForFunction(() => document.documentElement.dataset.heliosReady === "1");
  await page.clock.pauseAt(new Date("2026-09-05T01:00:00Z"));
  await page.clock.runFor(32);
  const initial = await page.evaluate(() => ({
    pausedAtReady: globalThis.__heliosTrackingPausedAtReady,
    firstApplicationTick: globalThis.__heliosTrackingFirstTick,
    playing: document.querySelector("#play-button")?.getAttribute("aria-pressed"),
    clockText: document.querySelector("#clock")?.textContent,
    clockNow: Date.now(), performanceNow: performance.now(),
  }));
  if (!initial.pausedAtReady || !initial.firstApplicationTick?.pausedBeforeCallback || initial.playing !== "false" || initial.clockText !== "2000-01-01") {
    throw new Error(`Focus tracking cannot establish its paused J2000 baseline: ${JSON.stringify(initial)}`);
  }
  return initial;
}

function frameProblems(frame, report, tracking) {
  const problems = [];
  if (![...frame.world, ...frame.ndc, ...frame.camera.world, ...frame.camera.quaternion, frame.camera.near, frame.camera.far].every(Number.isFinite)) problems.push("nonfinite world projection or camera");
  if (frame.clockText !== frame.expectedClockText) problems.push("simulation date disagrees with full observed elapsed time");
  if (!tracking) return problems;
  const { width, height } = report.viewport;
  if (frame.ndc[2] <= -1 || frame.ndc[2] >= 1 || frame.projected.x < 0 || frame.projected.x > width || frame.projected.y < 0 || frame.projected.y > height) problems.push("target world center left the visible frustum");
  if (!frame.drawn) problems.push("target sphere was not submitted by the real renderer");
  if (!frame.label || frame.label.hidden || !frame.label.active) problems.push("active target label is missing or hidden");
  const rect = frame.label?.rect;
  if (!rect || rect.width <= 0 || rect.height <= 0 || rect.x < 0 || rect.y < 0 || rect.x + rect.width > width || rect.y + rect.height > height) problems.push("active target label left the viewport");
  const labelAnchor = frame.label?.anchor;
  if (!labelAnchor || Math.hypot(labelAnchor.x - frame.projected.x, labelAnchor.y - frame.projected.y) > 0.25) problems.push("label anchor disagrees with independent world projection");
  if (Math.hypot(frame.projected.x - report.anchor.x, frame.projected.y - report.anchor.y) > anchorTolerance) problems.push("world-projected target drift exceeds 1 px");
  return problems;
}

/** onStill receives a complete-to-date JSON report; onReport runs before closing. */
export async function runFocusTracking(browser, base, {
  scenarios = focusTrackingScenarios, assertTracking = true,
  onStill = async () => {}, onReport = async () => {}, lifecycle = true,
} = {}) {
  const reports = [];
  for (const scenario of scenarios) {
    const started = performance.now();
    const viewport = scenario.touch ? { width: 390, height: 844 } : { width: 1440, height: 900 };
    const report = { schema: 1, scenario: { ...scenario }, viewport, touchEmulation: scenario.touch,
      requestedRate: scenario.requestedRate, effectiveRate: null, sliderValue: null,
      initial: null, anchor: null, inputs: [], frames: [], failures: [],
      lifecycle: { performed: false }, browserErrors: [], infrastructureError: null, completed: false,
      tolerancePixels: anchorTolerance, scheduledOffsets: [...focusTrackingOffsets],
      notes: ["Offset 0 is the paused anchor before Play; later offsets use every render from clock.runFor.",
        "Native slider step is preserved; effectiveRate is the logarithmic rate from its actual value.",
        "drawn means the target sphere reached the real renderer; no hidden-mesh raycast is used."] };
    let context, page, observer, checked = 0;
    const fail = (phase, message, details = {}) => report.failures.push({ phase, message, ...details });
    const refresh = async () => {
      const snapshot = await observer.evaluate((value) => value.snapshot());
      report.frames = snapshot.frames;
      report.observer = { meshIds: snapshot.meshIds, overflow: snapshot.overflow, maxFrames };
      if (snapshot.overflow) report.infrastructureError ??= "render observer overflow; dense evidence is incomplete";
      for (; checked < report.frames.length; checked += 1) {
        const frame = report.frames[checked];
        const tracking = ["tracking", "pause", "resume", "catchup", "date-boundary"].includes(frame.phase);
        const problems = frameProblems(frame, report, tracking && report.anchor !== null);
        if (tracking && frame.phase !== "pause" && !frame.playing) problems.push("tracking frame is unexpectedly paused");
        if (problems.length) fail(frame.phase, problems.join("; "), { frame: frame.index,
          details: { timestamp: frame.timestamp, projected: frame.projected, ndc: frame.ndc, clockText: frame.clockText, expectedClockText: frame.expectedClockText } });
      }
      return report.frames.at(-1);
    };
    const phase = async (name, target = scenario.bodyId) => observer.evaluate((value, args) => value.setPhase(...args), [name, target]);
    const input = async (selector, kind = "public button", touch = false) => {
      const at = await page.evaluate(() => performance.now());
      let point;
      if (touch) {
        // Locator actionability waits for stable RAFs, which the controlled clock
        // intentionally pauses. Prove the native touch destination explicitly.
        point = await page.locator(selector).evaluate((element) => {
          const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
          const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
          const hit = document.elementFromPoint(x, y);
          if (element.hidden || element.disabled || style.visibility === "hidden" || style.display === "none"
            || rect.width <= 0 || rect.height <= 0 || rect.x < 0 || rect.y < 0
            || rect.right > innerWidth || rect.bottom > innerHeight || !hit || !element.contains(hit)) {
            throw new Error("Native touch destination is not fully visible and unobstructed");
          }
          return { x, y, hitTag: hit.tagName, hitId: hit.id };
        });
        await page.touchscreen.tap(point.x, point.y);
      } else await page.locator(selector).evaluate((element) => element.click());
      report.inputs.push({ at, kind: touch ? "native touch tap" : kind, selector, ...(point ? { point } : {}) });
    };
    const still = async (offset) => {
      await refresh();
      await onStill({ name: `focus-tracking-${scenario.id}-${offset}ms`, page, scenario, offset, report: structuredClone(report) });
    };
    try {
      context = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: scenario.touch, isMobile: scenario.touch });
      page = await context.newPage();
      page.setDefaultTimeout(15_000);
      page.on("pageerror", (error) => report.browserErrors.push(`page: ${error.message}`));
      page.on("console", (message) => { if (message.type() === "error") report.browserErrors.push(`console: ${message.text()}`); });
      page.on("requestfailed", (request) => report.browserErrors.push(`request: ${request.url()} ${request.failure()?.errorText}`));
      page.on("response", (response) => { if (response.status() >= 400) report.browserErrors.push(`HTTP ${response.status()}: ${response.url()}`); });
      report.initial = await openPaused(page, base);
      observer = await installObserver(page, scenario.bodyId);
      await phase("selection");
      await input(`[data-body-id="${scenario.bodyId}"]`, "public body-label click");
      // Observe the beginning of paused easing densely. Subsequent 50 ms samples
      // keep setup bounded; no moving-tracking frame uses fastForward.
      await page.clock.runFor(64);
      let last = await refresh(), settled = false;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const previous = last;
        await page.clock.fastForward(50);
        last = await refresh();
        if (last && previous && last.busy !== "true" && last.drawn && !last.label?.hidden
          && Math.hypot(last.projected.x - viewport.width / 2, last.projected.y - viewport.height / 2) < 0.25
          && Math.hypot(last.projected.x - previous.projected.x, last.projected.y - previous.projected.y) < 0.02) {
          settled = true;
          break;
        }
      }
      if (!last) throw new Error("Cached THREE observer received no target render callbacks");
      report.anchor = { ...last.projected, ndcZ: last.ndc[2], world: last.world, frame: last.index, timestamp: last.timestamp };
      report.initial.selection = { settled, frames: report.frames.length, anchor: report.anchor };
      if (!settled) fail("selection", "paused selection did not settle to the projected center within the bounded setup");
      const selection = report.frames.filter((frame) => frame.phase === "selection");
      if (selection.some((frame) => frame.playing || frame.clockText !== "2000-01-01") || selection.some((frame) => distance(frame.world, last.world) > 1e-9)) fail("selection", "paused selection advanced the body or date");
      if (scenario.bodyId === "mercury" && !selection.some((frame) => Math.hypot(frame.projected.x - last.projected.x, frame.projected.y - last.projected.y) > 1)) fail("selection", "paused selection skipped its existing easing");
      const speed = await page.locator("#speed-slider").evaluate((slider, { requestedRate, minimum, maximum }) => {
        slider.value = String((Math.log(requestedRate) - Math.log(minimum)) / (Math.log(maximum) - Math.log(minimum)));
        slider.dispatchEvent(new Event("input", { bubbles: true }));
        return { at: performance.now(), requestedRate, sliderValue: Number(slider.value),
          effectiveRate: Math.exp(Math.log(minimum) + (Math.log(maximum) - Math.log(minimum)) * Number(slider.value)),
          readout: document.querySelector("#speed-readout")?.textContent };
      }, { requestedRate: scenario.requestedRate, ...(await observer.evaluate((value) => ({ minimum: value.snapshot().minimum, maximum: value.snapshot().maximum }))) });
      Object.assign(report, { effectiveRate: speed.effectiveRate, sliderValue: speed.sliderValue, speedReadout: speed.readout });
      report.inputs.push({ kind: "public speed slider input", ...speed });
      await still(0);
      await phase("tracking");
      await input("#play-button", "public Play", scenario.touch);
      report.sequenceStartedAt = await page.evaluate(() => performance.now());
      for (const offset of focusTrackingOffsets.slice(1)) {
        await page.clock.runFor(500);
        await still(offset);
      }
      const tracked = report.frames.filter((frame) => frame.phase === "tracking");
      const gaps = tracked.slice(1).map((frame, index) => frame.timestamp - tracked[index].timestamp);
      report.tracking = { frames: tracked.length, duration: 2000,
        firstTimestamp: tracked[0]?.timestamp, lastTimestamp: tracked.at(-1)?.timestamp,
        maximumGapMilliseconds: gaps.length ? Math.max(...gaps) : null,
        worstAnchorErrorPixels: tracked.length ? Math.max(...tracked.map((frame) => Math.hypot(frame.projected.x - report.anchor.x, frame.projected.y - report.anchor.y))) : null };
      if (tracked.length < 100 || tracked[0].timestamp - report.sequenceStartedAt > 34 || report.sequenceStartedAt + 2000 - tracked.at(-1).timestamp > 34 || gaps.some((gap) => gap <= 0 || gap > 34)) report.infrastructureError ??= `two-second sequence did not retain dense render coverage: ${JSON.stringify(report.tracking)}`;
      if (!tracked.some((frame) => distance(frame.world, report.anchor.world) > 1e-6)) fail("tracking", "Play did not move the real target");

      if (lifecycle && scenario.id === "desktop-mercury-400") {
        report.lifecycle.performed = true;
        await phase("pause");
        await input("#play-button", "public Pause");
        const beforePause = await refresh();
        await page.clock.runFor(160);
        const afterPause = await refresh();
        if (afterPause.playing || distance(beforePause.world, afterPause.world) > 1e-9 || beforePause.clockText !== afterPause.clockText) fail("pause", "Pause changed orbital position or simulation date");
        report.lifecycle.pause = { before: beforePause.index, after: afterPause.index };
        await phase("resume");
        await input("#play-button", "public resume");
        await page.clock.runFor(160);
        const resumed = await refresh();
        if (distance(afterPause.world, resumed.world) <= 1e-6) fail("resume", "resume did not advance the real target");
        report.lifecycle.resume = { before: afterPause.index, after: resumed.index };
        await phase("catchup");
        report.inputs.push({ at: await page.evaluate(() => performance.now()), kind: "clock.fastForward background catch-up", milliseconds: 3_600_000 });
        await page.clock.fastForward(3_600_000);
        const caughtUp = await refresh();
        if (caughtUp.clockText === resumed.clockText) fail("catchup", "one-hour background catch-up did not advance the date");
        report.lifecycle.catchup = { before: resumed.index, after: caughtUp.index };
        await phase("date-boundary");
        const toBoundary = Math.ceil(100_000_001 / report.effectiveRate * 1000);
        report.inputs.push({ at: await page.evaluate(() => performance.now()), kind: "clock.fastForward date boundary", milliseconds: toBoundary });
        await page.clock.fastForward(toBoundary);
        const atBoundary = await refresh();
        await page.clock.fastForward(1000);
        const beyondBoundary = await refresh();
        if (atBoundary.clockText !== "+275760-09-13" || beyondBoundary.clockText !== atBoundary.clockText || distance(atBoundary.world, beyondBoundary.world) > 1e-9) fail("date-boundary", "final valid date did not clamp with finite unchanged body position");
        report.lifecycle.dateBoundary = { before: caughtUp.index, at: atBoundary.index, after: beyondBoundary.index };
        await phase("handoff-out", "sun");
        await page.mouse.move(viewport.width / 2, viewport.height / 2);
        await page.mouse.wheel(0, 4000);
        report.inputs.push({ at: await page.evaluate(() => performance.now()), kind: "public wheel", deltaY: 4000 });
        await page.clock.runFor(160);
        const outside = await refresh();
        if (!["transition", "milkyway"].includes(outside.sceneHierarchy) || !outside.card.hidden) fail("handoff-out", "leaving Solar view did not change scene and clear selection");
        await phase("handoff-in", "sun");
        await page.mouse.wheel(0, -4000);
        report.inputs.push({ at: await page.evaluate(() => performance.now()), kind: "public wheel", deltaY: -4000 });
        await page.clock.runFor(160);
        const returned = await refresh();
        if (returned.sceneHierarchy !== "solar" || !returned.card.hidden) fail("handoff-in", "returning to Solar view changed its scene or restored stale selection");
        report.lifecycle.handoff = { outside: outside.index, returned: returned.index };
        await input("#play-button", "public Pause before Reset");
        await phase("reset", "sun");
        await input("#reset-button", "public Reset");
        for (let attempt = 0; attempt < 50; attempt += 1) await page.clock.fastForward(50);
        const reset = await refresh();
        if (!reset.card.hidden || reset.sceneHierarchy !== "solar" || reset.playing || reset.clockText !== beyondBoundary.clockText || !reset.drawn
          || Math.hypot(reset.projected.x - viewport.width / 2, reset.projected.y - viewport.height / 2) > 1) fail("reset", "Reset did not restore the paused Solar overview while preserving the date");
        report.lifecycle.reset = { frame: reset.index };
      }
      report.completed = true;
    } catch (error) {
      report.infrastructureError = String(error?.stack ?? error);
    } finally {
      try { if (observer) await refresh(); } catch (error) { report.infrastructureError ??= `observer finalization: ${error}`; }
      if (report.browserErrors.length) report.infrastructureError ??= `browser errors: ${report.browserErrors.join("; ")}`;
      report.wallMilliseconds = Math.round(performance.now() - started);
      try { await onReport(structuredClone(report)); } catch (error) { report.infrastructureError ??= `onReport: ${error}`; }
      try { if (observer) { await observer.evaluate((value) => value.restore()); await observer.dispose(); } }
      catch (error) { report.infrastructureError ??= `observer cleanup: ${error}`; }
      try { if (context) await context.close(); } catch (error) { report.infrastructureError ??= `context cleanup: ${error}`; }
    }
    reports.push(report);
    console.log(`focus tracking ${scenario.id}: ${report.tracking?.frames ?? 0} moving frames / ${report.frames.length} total, effective ${report.effectiveRate} d/s, worst ${report.tracking?.worstAnchorErrorPixels ?? "unavailable"} px, ${report.failures.length} failures (${(report.wallMilliseconds / 1000).toFixed(1)}s)`);
    if (report.infrastructureError) throw new Error(`Focus tracking ${scenario.id}: ${report.infrastructureError}`);
    if (assertTracking && report.failures.length) throw new Error(`Focus tracking ${scenario.id}: ${report.failures.length} measured failures; ${report.failures.slice(0, 4).map((failure) => `${failure.phase}: ${failure.message}`).join("; ")}`);
  }
  console.log(`focus tracking ${reports.length} scenarios ${assertTracking ? "passed" : "diagnostics complete"}`);
  return reports;
}
