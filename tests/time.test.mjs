import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  CONFIG,
  describeDaysPerSecond,
  formatDaysPerSecond,
  isShortcutTargetInteractive,
  sliderFromSpeed,
  speedFromSlider,
} from "../js/config.js";
import {
  MAX_SIMULATION_DAYS,
  advanceSimulationDays,
  elapsedSeconds,
  simulationDateLabel,
} from "../js/time.js";

// Exercise the shipped handler without initializing the WebGL scene.
const appSource = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
const handlerStart = appSource.indexOf("function onTimeKey(event) {");
const handlerEnd = appSource.indexOf("\nfunction pointerGap()", handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, "time shortcut handler is available");
const handlerSource = appSource.slice(handlerStart, handlerEnd);

function timeShortcuts() {
  const state = { playing: false, rate: 1, focus: "earth" };
  const handle = runInNewContext(`${handlerSource}\nonTimeKey`, {
    isShortcutTargetInteractive,
    togglePlay: () => { state.playing = !state.playing; },
    scaleSpeed: (factor) => { state.rate *= factor; },
    resetView: () => { state.focus = "sun"; },
  });
  return {
    state,
    press({ target = { tagName: "CANVAS" }, ...input }) {
      const event = new Event("keydown", { cancelable: true });
      Object.assign(event, input);
      Object.defineProperty(event, "target", { value: target });
      handle(event);
      return event.defaultPrevented;
    },
  };
}

const timeKeys = [
  { key: " ", code: "Space" },
  { key: "+", code: "Equal", shiftKey: true },
  { key: "=", code: "Equal" },
  { key: "-", code: "Minus" },
  { key: "_", code: "Minus", shiftKey: true },
  { key: "Escape", code: "Escape" },
];

test("browser and composition shortcuts keep their default behavior and simulation state", () => {
  for (const modifier of ["ctrlKey", "metaKey", "altKey", "isComposing"]) {
    for (const input of timeKeys) {
      const { state, press } = timeShortcuts();
      assert.equal(press({ ...input, [modifier]: true }), false, `${modifier} ${input.code}`);
      assert.deepEqual(state, { playing: false, rate: 1, focus: "earth" });
    }
  }
});

test("plain time shortcuts and Shift-plus retain their existing actions", () => {
  const { state, press } = timeShortcuts();
  for (const [input, rate] of [
    [timeKeys[1], 2], [timeKeys[2], 4], [timeKeys[3], 2], [timeKeys[4], 1],
  ]) {
    assert.equal(press(input), false);
    assert.equal(state.rate, rate);
  }
  assert.equal(press(timeKeys[0]), true, "plain Space prevents page scrolling");
  assert.equal(state.playing, true);
  assert.equal(press(timeKeys[0]), true);
  assert.equal(state.playing, false);
  assert.equal(press(timeKeys[5]), false);
  assert.equal(state.focus, "sun");
});

test("repeated shortcuts and interactive targets keep their existing guards", () => {
  const guards = [
    { repeat: true },
    ...["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"].map((tagName) => ({ target: { tagName } })),
    { target: { tagName: "DIV", isContentEditable: true } },
    { target: { tagName: "SPAN", parentElement: { tagName: "BUTTON" } } },
  ];
  for (const guard of guards) {
    for (const input of timeKeys) {
      const { state, press } = timeShortcuts();
      assert.equal(press({ ...input, ...guard }), false);
      assert.deepEqual(state, { playing: false, rate: 1, focus: "earth" });
    }
  }
});

function runFrames(fps, seconds, rate) {
  let days = 0;
  let prior = 0;
  for (let frame = 1; frame <= fps * seconds; frame += 1) {
    const now = frame * 1000 / fps;
    days = advanceSimulationDays(days, elapsedSeconds(now, prior), rate, true);
    prior = now;
  }
  return days;
}

test("simulation time is frame-rate independent", () => {
  for (const rate of [CONFIG.minDaysPerSecond, CONFIG.defaultDaysPerSecond, 8, CONFIG.maxDaysPerSecond]) {
    const expected = 10 * rate;
    for (const fps of [10, 20, 60, 120]) {
      assert.ok(Math.abs(runFrames(fps, 10, rate) - expected)
        <= Number.EPSILON * 512 * expected, `${fps} FPS at ${rate} days/sec`);
    }
  }
});

test("real-time minimum advances exactly one simulated second per elapsed second", () => {
  const rate = speedFromSlider(0);
  assert.equal(rate, 1 / 86400);
  const days = advanceSimulationDays(0, elapsedSeconds(1000, 0), rate, true);
  assert.equal(days * 86400, 1);
  assert.equal(advanceSimulationDays(0, 1, rate, false), 0);
  assert.equal(advanceSimulationDays(days, elapsedSeconds(1000, 1000), rate, true), days);
  assert.equal(simulationDateLabel(days), "2000-01-01");
});

test("logarithmic time control has exact clamped endpoints and monotonic round trips", () => {
  for (const unit of [-1, 0]) assert.equal(speedFromSlider(unit), CONFIG.minDaysPerSecond);
  for (const unit of [1, 2]) assert.equal(speedFromSlider(unit), CONFIG.maxDaysPerSecond);
  assert.equal(sliderFromSpeed(0), 0);
  assert.equal(sliderFromSpeed(CONFIG.minDaysPerSecond), 0);
  assert.equal(sliderFromSpeed(CONFIG.maxDaysPerSecond), 1);
  assert.equal(sliderFromSpeed(800), 1);
  let previous = speedFromSlider(0);
  for (let step = 1; step <= 100; step += 1) {
    const unit = step / 100;
    const rate = speedFromSlider(unit);
    assert.ok(rate > previous, `slider step ${step} increases the rate`);
    assert.ok(Math.abs(sliderFromSpeed(rate) - unit) < 1e-14, `slider step ${step} round trip`);
    previous = rate;
  }
  for (const rate of [1 / 86400, 1 / 1440, 1 / 24, 1, 8, 30, 365, 400]) {
    assert.ok(Math.abs(speedFromSlider(sliderFromSpeed(rate)) - rate) <= rate * 1e-14,
      `${rate} days/sec is preserved by the continuous mapping`);
  }
  assert.equal(CONFIG.defaultDaysPerSecond, 1 / 24);
  assert.ok(sliderFromSpeed(CONFIG.defaultDaysPerSecond) > 0);
});

test("rate labels distinguish seconds and minutes while preserving all higher units", () => {
  for (const [rate, compact, accessible] of [
    [1 / 86400, "1 s", "1 second per second"],
    [1.2 / 86400, "1.2 s", "1.2 seconds per second"],
    [9.9 / 86400, "9.9 s", "9.9 seconds per second"],
    [30 / 86400, "30 s", "30 seconds per second"],
    [59 / 86400, "59 s", "59 seconds per second"],
    [1 / 1440, "1 min", "1 minute per second"],
    [1.5 / 1440, "1.5 min", "1.5 minutes per second"],
    [9.9 / 1440, "9.9 min", "9.9 minutes per second"],
    [30 / 1440, "30 min", "30 minutes per second"],
    [59 / 1440, "59 min", "59 minutes per second"],
    [1 / 24, "1 h", "1 hour per second"],
    [0.25, "6 h", "6 hours per second"],
    [1, "1.0 d", "1 day per second"],
    [8, "8.0 d", "8 days per second"],
    [30, "1.0 mo", "1 month per second"],
    [365.25, "1.0 yr", "1 year per second"],
    [400, "1.1 yr", "1.1 years per second"],
  ]) {
    assert.equal(formatDaysPerSecond(rate), compact);
    assert.equal(describeDaysPerSecond(rate), accessible);
  }
  for (let step = 0; step <= 100; step += 1) {
    const rate = speedFromSlider(step / 100);
    assert.doesNotMatch(formatDaysPerSecond(rate), /^0(?:\s|\.0\s)/);
    assert.doesNotMatch(describeDaysPerSecond(rate), /^0\s/);
  }
});

test("long suspension catches up and invalid elapsed time never rewinds", () => {
  assert.equal(advanceSimulationDays(4, elapsedSeconds(3600000, 0), 2, true), 7204);
  assert.equal(advanceSimulationDays(4, 3600, 2, false), 4);
  assert.equal(elapsedSeconds(5, 10), 0);
  assert.equal(elapsedSeconds(Number.NaN, 10), 0);
});

test("date range is bounded and accessible speed text is human-readable", () => {
  assert.equal(simulationDateLabel(0), "2000-01-01");
  assert.match(simulationDateLabel(MAX_SIMULATION_DAYS), /^\+275760-09-13$/);
  assert.equal(advanceSimulationDays(MAX_SIMULATION_DAYS - 1, 10, 400, true), MAX_SIMULATION_DAYS);
  assert.equal(describeDaysPerSecond(1 / 24), "1 hour per second");
  assert.equal(describeDaysPerSecond(8), "8 days per second");
});
