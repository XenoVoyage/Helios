import assert from "node:assert/strict";
import test from "node:test";
import { describeDaysPerSecond } from "../js/config.js";
import {
  MAX_SIMULATION_DAYS,
  advanceSimulationDays,
  elapsedSeconds,
  simulationDateLabel,
} from "../js/time.js";

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
  for (const fps of [10, 20, 60]) {
    assert.ok(Math.abs(runFrames(fps, 10, 8) - 80) < 1e-10, `${fps} FPS`);
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
