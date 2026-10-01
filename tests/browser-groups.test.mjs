import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  browserGroups, expectedBrowserEvidence, parseBrowserGroup, prepareBrowserEvidence,
  runBrowserGroups, writeBrowserGroupEvidence,
} from "./browser-groups.mjs";

const source = { commit: "a".repeat(40), tree: "b".repeat(40), clean: true };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRz8AAAAASUVORK5CYII=", "base64");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const runners = (run) => Object.fromEntries(browserGroups.map((group) => [group, () => run(group)]));

async function temporaryEvidence(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "helios-browser-groups-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function writeFixtures(directory, group) {
  await Promise.all(expectedBrowserEvidence(group).map((name) =>
    writeFile(path.join(directory, name), name.endsWith(".png") ? png : "{}\n")));
}

test("browser CLI defaults to the whole suite and accepts exactly one known group", () => {
  assert.equal(parseBrowserGroup([]), "all");
  for (const group of browserGroups) assert.equal(parseBrowserGroup(["--group", group]), group);
  for (const args of [["--group"], ["platform"], ["--group", ""], ["--group", "all"],
    ["--group", "unknown"], ["--skip", "touch"], ["--group", "touch", "extra"],
    ["--group", "touch", "--group", "platform"]]) {
    assert.throws(() => parseBrowserGroup(args), /Expected --group/);
  }
});

test("full and individual dispatch retain every group once in the original order", async () => {
  assert.deepEqual(browserGroups, ["platform", "desktop-scenes", "desktop-bodies", "touch"]);
  for (const selected of ["all", ...browserGroups]) {
    const events = [];
    const completed = await runBrowserGroups(selected, runners((group) => events.push(`run:${group}`)), (result) => {
      assert.ok(Number.isFinite(result.wallMilliseconds) && result.wallMilliseconds >= 0);
      events.push(`complete:${result.group}`);
    });
    const expected = selected === "all" ? [...browserGroups] : [selected];
    assert.deepEqual(completed, expected);
    assert.deepEqual(events, expected.flatMap((group) => [`run:${group}`, `complete:${group}`]));
  }
});

test("unknown or incomplete dispatch fails before any group can run", async () => {
  const calls = [];
  const registry = runners((group) => calls.push(group));
  await assert.rejects(runBrowserGroups("unknown", registry), /known browser group/);
  for (const missing of browserGroups) {
    const incomplete = { ...registry };
    delete incomplete[missing];
    await assert.rejects(runBrowserGroups("platform", incomplete), /exactly one runner/);
  }
  await assert.rejects(runBrowserGroups("all", { ...registry, extra: () => {} }), /exactly one runner/);
  await assert.rejects(runBrowserGroups("all", { ...registry, touch: null }), /touch has a runner/);
  assert.deepEqual(calls, []);
});

test("runner and evidence failures cannot produce successful completion or run later groups", async () => {
  for (const failEvidence of [false, true]) {
    const ran = [], completed = [];
    await assert.rejects(runBrowserGroups("all", runners((group) => {
      ran.push(group);
      if (!failEvidence && group === "desktop-scenes") throw new Error("scenario failed");
    }), ({ group }) => {
      if (failEvidence && group === "desktop-scenes") throw new Error("evidence failed");
      completed.push(group);
    }), /(?:scenario|evidence) failed/);
    assert.deepEqual(ran, ["platform", "desktop-scenes"]);
    assert.deepEqual(completed, ["platform"]);
  }
});

test("the disjoint evidence inventory retains all 422 PNGs and 15 original reports", () => {
  // Independent filename pins from the successful pre-sharding run 36860838260.
  // These pin membership only, never rendered pixels or a replacement baseline.
  const pins = {
    platform: [221, 13, "b3284672eb83df5f274d5e3bb3e257f46bc8d0b65dccf7eacfe2637e2d0d2f83"],
    "desktop-scenes": [68, 1, "7d96fbd59dc28412953692bfc9835e3b3b43a12d7dcbd8c42dfdcf195d4b91e3"],
    "desktop-bodies": [70, 0, "67db579730568df33784a3c2cc011e28fd2b671728a15c15f5464dfb9421b173"],
    touch: [63, 1, "5bfee7c5147af0e0098126a9f2e366ed48e375006e795059ee15b989c169d257"],
  };
  const all = [];
  for (const group of browserGroups) {
    const files = expectedBrowserEvidence(group);
    assert.equal(files.filter((file) => file.endsWith(".png")).length, pins[group][0]);
    assert.equal(files.filter((file) => file.endsWith(".json")).length, pins[group][1]);
    assert.equal(sha256(files.join("\n") + "\n"), pins[group][2]);
    all.push(...files);
  }
  assert.equal(all.length, 437);
  assert.equal(new Set(all).size, 437);
  assert.equal(all.filter((file) => file.endsWith(".png")).length, 422);
  assert.equal(all.filter((file) => file.endsWith(".json")).length, 15);
  assert.throws(() => expectedBrowserEvidence("unknown"), /known browser group/);
});

test("isolated evidence records exact source, completed group, and hashes of every original", async (t) => {
  const directory = await temporaryEvidence(t);
  await prepareBrowserEvidence(directory);
  const completedGroups = [];
  for (const group of browserGroups) {
    await writeFixtures(directory, group);
    const report = await writeBrowserGroupEvidence({ directory, group, source, completedGroups, wallMilliseconds: 123 });
    assert.equal(report.group, group);
    assert.equal(report.completed, true);
    assert.equal(report.isolated, true);
    assert.deepEqual(report.source, source);
    assert.deepEqual(report.sourceAfter, source);
    assert.equal(report.wallMilliseconds, 123);
    assert.deepEqual(report.files.map(({ file }) => file), expectedBrowserEvidence(group));
    for (const entry of report.files) {
      const bytes = await readFile(path.join(directory, entry.file));
      assert.equal(entry.bytes, bytes.length);
      assert.equal(entry.sha256, sha256(bytes));
    }
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, `browser-audit-${group}.json`))), report);
    completedGroups.push(group);
  }
  assert.equal((await readdir(directory)).length, 441);
});

test("stale, empty, missing, extra, wrong-group and invalid evidence fail closed", async (t) => {
  const directory = await temporaryEvidence(t);
  const options = { directory, group: "desktop-scenes", source, wallMilliseconds: 1 };
  await assert.rejects(writeBrowserGroupEvidence(options), /every requested browser evidence/);
  await writeFixtures(directory, options.group);
  await assert.rejects(prepareBrowserEvidence(directory), /must start empty/);
  await assert.rejects(writeBrowserGroupEvidence({ ...options, group: "desktop-bodies" }), /every requested browser evidence/);
  const name = "desktop-overview.png", file = path.join(directory, name);
  await unlink(file);
  await assert.rejects(writeBrowserGroupEvidence(options), /every requested browser evidence/);
  await writeFile(file, png);
  const extra = path.join(directory, "unexpected.png");
  await writeFile(extra, png);
  await assert.rejects(writeBrowserGroupEvidence(options), /every requested browser evidence/);
  await unlink(extra);
  await writeFile(file, "not a PNG");
  await assert.rejects(writeBrowserGroupEvidence(options), /is a PNG/);
  await unlink(file);
  await symlink("desktop-sky.png", file);
  await assert.rejects(writeBrowserGroupEvidence(options), /regular evidence file/);
  await unlink(file);
  await writeFile(file, png);
  const reportFile = path.join(directory, "time-control-startup.json");
  await writeFile(reportFile, "not JSON");
  await assert.rejects(writeBrowserGroupEvidence(options), SyntaxError);
  await writeFile(reportFile, "{}\n");
  for (const invalidSource of [null, { ...source, clean: false }, { ...source, commit: "branch" }, { ...source, tree: "" }]) {
    await assert.rejects(writeBrowserGroupEvidence({ ...options, source: invalidSource }));
  }
  for (const sourceAfter of [{ ...source, clean: false }, { ...source, commit: "c".repeat(40) }, { ...source, tree: "d".repeat(40) }]) {
    await assert.rejects(writeBrowserGroupEvidence({ ...options, sourceAfter }), /clean and frozen/);
  }
  await assert.rejects(writeBrowserGroupEvidence({ ...options, completedGroups: [options.group] }), /completed once/);
  await assert.rejects(writeBrowserGroupEvidence({ ...options, completedGroups: ["platform", "platform"] }), /are unique/);
  await writeBrowserGroupEvidence(options);
  await assert.rejects(writeBrowserGroupEvidence(options), /every requested browser evidence/);
});

test("local full-suite evidence permits dirty checkouts and reruns without deleting other files", async (t) => {
  const directory = await temporaryEvidence(t);
  const unrelated = path.join(directory, "retained-local-note.txt");
  await writeFile(unrelated, "keep this");
  await prepareBrowserEvidence(directory, { requireEmpty: false });
  await writeFixtures(directory, "desktop-bodies");
  const options = { directory, group: "desktop-bodies", source: { ...source, clean: false },
    sourceAfter: { ...source, clean: false }, wallMilliseconds: 1, isolated: false };
  for (let run = 0; run < 2; run += 1) {
    const report = await writeBrowserGroupEvidence(options);
    assert.equal(report.isolated, false);
    assert.equal(report.source.clean, false);
    assert.match(report.evidencePolicy, /not isolated CI evidence/);
    assert.equal(await readFile(unrelated, "utf8"), "keep this");
  }
});
