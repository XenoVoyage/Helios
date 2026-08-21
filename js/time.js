const DAY_MS = 86400000;
const J2000_MS = Date.UTC(2000, 0, 1, 12);
const MAX_DATE_MS = 8640000000000000;

export const MAX_SIMULATION_DAYS = (MAX_DATE_MS - J2000_MS) / DAY_MS;

export function elapsedSeconds(now, previous) {
  if (!Number.isFinite(now) || !Number.isFinite(previous)) return 0;
  return Math.max(0, (now - previous) / 1000);
}

/** Background time continues normally; only JavaScript's final valid date clamps it. */
export function advanceSimulationDays(days, elapsed, rate, playing) {
  const current = Math.max(0, Math.min(MAX_SIMULATION_DAYS, days));
  if (!playing) return current;
  return Math.min(MAX_SIMULATION_DAYS, current + Math.max(0, elapsed) * rate);
}

export function simulationDateLabel(days) {
  const bounded = Math.max(0, Math.min(MAX_SIMULATION_DAYS, days));
  const stamp = Math.min(MAX_DATE_MS, J2000_MS + bounded * DAY_MS);
  return new Date(stamp).toISOString().split("T")[0];
}
