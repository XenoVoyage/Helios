import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

// Delay the real caller's next target without replacing it with a test target.
export function delayNextClockPause(page) {
  const originalPauseAt = page.clock.pauseAt;
  const pauseAt = originalPauseAt.bind(page.clock);
  page.clock.pauseAt = async (target) => {
    page.clock.pauseAt = originalPauseAt;
    const staleTarget = await page.evaluate(() => Date.now() + 1000);
    await delay(1500);
    assert.ok(await page.evaluate(() => Date.now()) > staleTarget,
      "the running browser clock outlives the former one-second target");
    await assert.rejects(pauseAt(staleTarget), /Cannot fast-forward to the past/);
    // A rejected pauseAt also stops real-time synchronization. Restore it so
    // the actual setup call still exercises the running-clock race.
    await page.clock.resume();
    await pauseAt(target);
    console.log("delayed clock.pauseAt regression ok (stale target rejected; actual caller target accepted)");
  };
}
