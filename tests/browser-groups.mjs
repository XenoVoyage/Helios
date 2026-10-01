import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const browserGroups = Object.freeze(["platform", "desktop-scenes", "desktop-bodies", "touch"]);

export function parseBrowserGroup(args) {
  if (args.length === 0) return "all";
  assert.ok(args.length === 2 && args[0] === "--group" && browserGroups.includes(args[1]),
    `Expected --group ${browserGroups.join("|")}, or no arguments for the complete suite`);
  return args[1];
}

// These are the existing successful suite's filenames, not new captures or
// baselines. Exact membership prevents a missing scenario being hidden by a
// replacement file or an equal-sized shard.
export function expectedBrowserEvidence(group) {
  assert.ok(browserGroups.includes(group), "known browser group required");
  const files = [];
  const png = (...names) => files.push(...names.map((name) => `${name}.png`));
  const json = (...names) => files.push(...names.map((name) => `${name}.json`));
  const moonViews = (prefix, ids) => {
    for (const id of ids) {
      for (const seat of ["min", "close", "cross", "reverse", "pick-target", "picked"]) png(`${prefix}-moon-parent-${seat}-${id}`);
    }
    for (const seat of ["start", "mid"]) png(`${prefix}-moon-parent-transition-io-${seat}`);
  };
  const nightViews = (prefix) => {
    for (const id of ["uranus", "neptune"]) {
      for (const seat of ["framed", "minimum", "half-lit", "sunward"]) png(`${prefix}-night-side-${seat}-${id}`);
    }
  };
  if (group === "platform") {
    png("responsive-resize-audit-stale", "responsive-resize-audit-settled", "dpr-boot-dpr-2", "dpr-live-compact-1", "dpr-live-compact-2");
    json("responsive-resize-audit", "responsive-date-layout", "time-speed-controls");
    for (const [width, height] of [
      [568, 320], [700, 500], [718, 500], [719, 500], [720, 500],
      [721, 500], [840, 500], [841, 500], [844, 390], [320, 568],
      [390, 844], [720, 900], [721, 900], [720, 720], [721, 721],
      [720, 501], [721, 501], [768, 1024], [1024, 768], [1440, 900],
    ]) {
      for (const rate of ["default", "minimum", "maximum-date", "widest-rate"]) {
        for (const state of ["closed", "open"]) png(`${width > height ? "landscape" : "responsive"}-date-${width}x${height}-${rate}-${state}`);
      }
    }
    for (const size of ["1440x900", "390x844", "568x320"]) {
      for (const rate of ["default", "minimum", "maximum"]) png(`time-speed-${size}-${rate}`, `time-speed-${size}-${rate}-dock`);
      png(`time-speed-${size}-running-minimum`);
    }
    for (const id of ["desktop-mercury-1", "desktop-mercury-10", "desktop-mercury-400", "desktop-io-400", "portrait-mercury-1", "portrait-mercury-400"]) json(`focus-tracking-${id}`);
    for (const profile of ["desktop", "compact", "portrait", "landscape"]) {
      json(`camera-${profile}-accessibility`);
      for (const seat of ["closed", "open", "minimum", "maximum", "cmb"]) png(`camera-${profile}-${seat}`);
    }
    png("camera-desktop-jupiter-minimum", "camera-desktop-moon-minimum", "camera-desktop-virgo-controls", "camera-desktop-cmb-controls");
    for (const [profile, sizes] of [["portrait", ["320x568", "390x844"]], ["landscape", ["568x320", "844x390"]]]) {
      for (const size of sizes) for (const state of ["closed", "open"]) png(`camera-${profile}-selected-earth-${size}-${state}`);
    }
    for (const size of ["320x568", "390x844", "844x390"]) png(`camera-portrait-universe-framed-${size}`);
  } else if (group === "desktop-scenes") {
    png("desktop-solarfar-label-collisions", "desktop-label-collision-pointer", "desktop-label-collision-keyboard");
    nightViews("desktop");
    for (const mode of ["major-initial", "off", "all", "major-restored"]) png(`desktop-constellations-${mode}`);
    png("desktop-overview", "triton-rotation-a", "triton-rotation-b");
    for (const look of ["sky", "solarfar", "tailsky", "growing", "disk", "milkyway", "mwedge", "mwbelow", "neighborhood", "localgroup", "virgo", "preweb", "web", "universe"]) png(`desktop-${look}`);
    png("desktop-sky-button", "desktop-sky-escape");
    json("time-control-startup");
    for (const seat of ["start", "mid", "end"]) png(`desktop-solar-handoff-${seat}`);
    png("desktop-deep-loading", "desktop-m31-placeholder-disposed", "desktop-m31-placeholder-retained");
    for (const seat of ["15", "35", "55", "75", "92"]) png(`desktop-transition-virgo-web-${seat}`);
    for (const seat of ["15", "35", "55", "68", "70", "72", "74", "76", "78", "80", "82", "85", "90", "95", "101"]) png(`desktop-transition-web-universe-${seat}`);
    for (const seat of ["forward", "yaw-quarter", "yaw-180", "pitch-high", "pitch-low", "diagonal"]) png(`desktop-far-sky-${seat}`);
    png("earth-june-solstice", "earth-december-solstice");
  } else if (group === "desktop-bodies") {
    for (const id of ["sun", "mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto", "ceres"]) png(`desktop-minimum-zoom-${id}`);
    moonViews("desktop", ["moon", "phobos", "deimos", "io", "europa", "ganymede", "callisto", "titan", "triton"]);
    for (const seat of ["front", "back", "lit"]) png(`desktop-saturn-rings-${seat}`);
  } else {
    nightViews("touch-portrait");
    png("touch-portrait-solarfar-label-collisions", "touch-portrait-label-collision-pointer", "touch-portrait-label-collision-keyboard",
      "touch-landscape-compact-labels", "touch-landscape-compact-mars-touch", "touch-landscape-compact-mars-keyboard",
      "touch-card", "touch-landscape-card", "touch-portrait-deep-loading");
    for (const profile of ["portrait", "landscape"]) {
      for (const look of ["localgroup", "virgo", "web", "universe"]) png(`touch-${profile}-${look}`);
    }
    for (const id of ["sun", "jupiter", "saturn"]) png(`touch-portrait-minimum-zoom-${id}`);
    moonViews("touch-portrait", ["moon", "phobos", "io", "triton"]);
    for (const size of ["320x568", "568x320"]) {
      for (const look of ["web", "universe"]) {
        for (const state of ["closed", "open"]) png(`touch-minimum-${size}-${look}-camera-${state}`);
      }
    }
    json("touch-minimum-deep-caption-layouts");
    png("webgl-fallback");
  }
  assert.equal(new Set(files).size, files.length, "no duplicate browser evidence names");
  return files.sort();
}

export async function runBrowserGroups(group, runners, onComplete = async () => {}) {
  assert.ok(group === "all" || browserGroups.includes(group), "known browser group required");
  assert.deepEqual(Object.keys(runners).sort(), [...browserGroups].sort(), "every browser group has exactly one runner");
  for (const name of browserGroups) assert.equal(typeof runners[name], "function", `${name} has a runner`);
  const completed = [];
  for (const name of group === "all" ? browserGroups : [group]) {
    const started = performance.now();
    await runners[name]();
    const result = { group: name, wallMilliseconds: Math.round(performance.now() - started) };
    await onComplete(result);
    completed.push(name);
  }
  return completed;
}

export async function prepareBrowserEvidence(directory, { requireEmpty = true } = {}) {
  await mkdir(directory, { recursive: true });
  if (requireEmpty) assert.deepEqual(await readdir(directory), [], "browser evidence directory must start empty");
}

export async function writeBrowserGroupEvidence({ directory, group, source, sourceAfter = source,
  isolated = true, completedGroups = [], wallMilliseconds }) {
  assert.match(source?.commit ?? "", /^[0-9a-f]{40}$/, "exact browser source commit required");
  assert.match(source?.tree ?? "", /^[0-9a-f]{40}$/, "exact browser source tree required");
  assert.equal(typeof source?.clean, "boolean", "browser source clean state is recorded");
  if (isolated) {
    assert.equal(source.clean, true, "isolated browser source must be clean");
    assert.deepEqual(sourceAfter, source, "isolated browser source remains clean and frozen");
  }
  assert.ok(Number.isFinite(wallMilliseconds) && wallMilliseconds >= 0, "finite browser group duration required");
  assert.equal(new Set(completedGroups).size, completedGroups.length, "completed browser groups are unique");
  assert.ok(!completedGroups.includes(group), "browser group is completed once");
  const expected = expectedBrowserEvidence(group);
  const previous = completedGroups.flatMap((name) => [...expectedBrowserEvidence(name), `browser-audit-${name}.json`]);
  if (isolated) {
    assert.deepEqual((await readdir(directory)).sort(), [...previous, ...expected].sort(), "every requested browser evidence file exists, with no extras");
  }
  const files = [];
  for (const name of expected) {
    const file = path.join(directory, name);
    assert.equal((await lstat(file)).isFile(), true, `${name} is a regular evidence file`);
    const bytes = await readFile(file);
    if (name.endsWith(".png")) {
      assert.ok(bytes.length >= 24 && bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a", `${name} is a PNG`);
      assert.ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0, `${name} has nonempty image dimensions`);
    } else {
      JSON.parse(bytes.toString("utf8"));
    }
    files.push({ file: name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  const report = { schema: 1, group, completed: true, isolated, source, sourceAfter, wallMilliseconds,
    evidencePolicy: isolated ? "Fresh isolated shard; exact frozen source and file inventory required."
      : "Local full suite; checkout may be dirty and output may contain files from earlier runs. This is not isolated CI evidence.",
    pngCount: files.filter(({ file }) => file.endsWith(".png")).length,
    jsonCount: files.filter(({ file }) => file.endsWith(".json")).length, files };
  await writeFile(path.join(directory, `browser-audit-${group}.json`), JSON.stringify(report, null, 2) + "\n", { flag: isolated ? "wx" : "w" });
  return report;
}
