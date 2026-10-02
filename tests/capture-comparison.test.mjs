import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { captureClasses, runComparison, validateEvidence } from "../scripts/capture-comparison.mjs";

const labels = ["main", "develop", "candidate"];
const counts = { "bodies-inner": 48, "bodies-giants": 23, "bodies-outer": 13, "moons-inner": 31, "moons-jovian": 18, "moons-outer": 12, "touch-controls": 47, responsive: 40, "desktop-phases": 8, "desktop-lifecycle": 10, "desktop-states": 8, "touch-states": 28, "cosmic-scenes": 40, ordinary: 23 };
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const commit = (root, message) => {
  git(root, "add", ".");
  git(root, "-c", "user.name=Comparison test", "-c", "user.email=comparison@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", message);
};
const sourceIdentity = (root, label) => ({ label, commit: git(root, "rev-parse", "HEAD"), tree: git(root, "rev-parse", "HEAD^{tree}") });
const fullExpected = Object.entries(counts).flatMap(([group, count]) => Array.from({ length: count }, (_, index) =>
  group === "moons-inner" && index < 5 ? `focus-tracking-desktop-io-400-${index * 500}ms` : `${group}-fixture-${index}`));

async function fixture(t, trees = ["same", "same", "same"]) {
  const root = await mkdtemp(path.join(os.tmpdir(), "helios-comparison-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const roots = {};
  for (const [index, label] of labels.entries()) {
    roots[label] = path.join(root, label);
    await mkdir(roots[label]);
    git(roots[label], "init", "--quiet");
    await writeFile(path.join(roots[label], "renderer.txt"), trees[index]);
    commit(roots[label], `${label} source identity`);
  }
  const harnessRoot = path.join(root, "harness");
  await mkdir(path.join(harnessRoot, "tests"), { recursive: true });
  git(harnessRoot, "init", "--quiet");
  await writeFile(path.join(harnessRoot, "tests/visual-capture.mjs"), "frozen capture harness\n");
  await writeFile(path.join(harnessRoot, "tests/focus-tracking.mjs"), "frozen tracking observer\n");
  commit(harnessRoot, "harness");
  const harness = {
    commit: git(harnessRoot, "rev-parse", "HEAD"), tree: git(harnessRoot, "rev-parse", "HEAD^{tree}"), clean: true,
    sha256: digest(await readFile(path.join(harnessRoot, "tests/visual-capture.mjs"))),
    focusTracking: { file: "tests/focus-tracking.mjs", sha256: digest(await readFile(path.join(harnessRoot, "tests/focus-tracking.mjs"))), bytes: 25 },
  };
  harness.focusTracking.bytes = (await readFile(path.join(harnessRoot, "tests/focus-tracking.mjs"))).length;
  const options = { roots, output: path.join(root, "evidence"), harnessRoot, group: "moons-inner" };
  const captures = [], inventories = new Map();
  const operations = {
    inventoryFor: async ({ root, label, group }) => {
      const start = Object.keys(counts).slice(0, Object.keys(counts).indexOf(group)).reduce((sum, key) => sum + counts[key], 0);
      const inventory = {
        group, completeMatrixCount: 349, fullExpected, source: sourceIdentity(root, label), harness,
        expected: fullExpected.slice(start, start + counts[group]).map((name) => ({ name })),
      };
      inventories.set(label, inventory);
      return inventory;
    },
    capture: async ({ label, output }) => {
      captures.push(label);
      const inventory = inventories.get(label);
      const manifest = {
        schema: 1, group: inventory.group, completeMatrixCount: 349, fullExpected,
        source: inventory.source, harness, expected: inventory.expected.map(({ name }) => name),
        failures: [], browserErrors: [], missing: [], missingTrackingReports: [],
        sourceCleanAfter: true, sourceCommitAfter: inventory.source.commit, sourceTreeAfter: inventory.source.tree,
        harnessCleanAfter: true, captures: [], focusTrackingExpectedReports: [], focusTrackingReports: [],
        timings: [{ operation: "page.screenshot", wallMilliseconds: 10 }],
      };
      for (const { name } of inventory.expected) {
        const bytes = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from(name)]);
        const file = `${name}.png`;
        await writeFile(path.join(output, file), bytes);
        manifest.captures.push({ name, file, bytes: bytes.length, sha256: digest(bytes) });
        const match = name.match(/^focus-tracking-(.+)-[0-9]+ms$/);
        if (match && !manifest.focusTrackingExpectedReports.includes(match[1])) manifest.focusTrackingExpectedReports.push(match[1]);
      }
      for (const scenario of manifest.focusTrackingExpectedReports) {
        const report = { scenario: { id: scenario }, completed: true, browserErrors: [], failures: [{ diagnostic: "historical tracking observation is retained" }] };
        const bytes = Buffer.from(JSON.stringify(report));
        const file = `focus-tracking-${scenario}.json`;
        await writeFile(path.join(output, file), bytes);
        manifest.focusTrackingReports.push({ scenario, completed: true, file, bytes: bytes.length, sha256: digest(bytes) });
      }
      await writeFile(path.join(output, "capture-details.json"), JSON.stringify(manifest));
    },
  };
  return { root, roots, harness, options, operations, captures, inventories };
}

async function editManifest(directory, mutate) {
  const file = path.join(directory, "capture-details.json");
  const manifest = JSON.parse(await readFile(file, "utf8"));
  await mutate(manifest);
  await writeFile(file, JSON.stringify(manifest));
}

test("identical full trees choose the strictest source, with distinct baselines before candidate", () => {
  const plan = (trees) => captureClasses(labels.map((label, index) => ({ label, tree: trees[index] })));
  assert.deepEqual(plan(["x", "x", "x"]), [{ tree: "x", members: labels, capturedBy: "candidate" }]);
  assert.deepEqual(plan(["x", "x", "y"]).map(({ capturedBy }) => capturedBy), ["develop", "candidate"]);
  assert.deepEqual(plan(["x", "y", "x"]).map(({ capturedBy }) => capturedBy), ["develop", "candidate"]);
  assert.deepEqual(plan(["x", "y", "y"]).map(({ capturedBy }) => capturedBy), ["main", "candidate"]);
  assert.deepEqual(plan(["x", "y", "z"]).map(({ capturedBy }) => capturedBy), labels);
});

test("identical trees capture once and alias verified originals without fake manifests", async (t) => {
  const context = await fixture(t);
  const index = await runComparison(context.options, context.operations);
  assert.equal(index.status, "passed");
  assert.deepEqual(context.captures, ["candidate"]);
  assert.equal(new Set(index.sources.map(({ commit }) => commit)).size, 3, "different commits may share a complete tree");
  for (const source of index.sources) {
    assert.equal(source.status, "passed");
    assert.equal(source.capturedBy, "candidate");
    assert.equal(source.reused, source.label !== "candidate");
    assert.equal(source.evidence, "candidate/moons-inner/capture-details.json");
    assert.deepEqual(source.coverage, { expected: 31, captured: 31, trackingReports: 1, completeMatrix: 349 });
    assert.match(source.manifest.sha256, /^[a-f0-9]{64}$/);
    assert.equal(source.timing["page.screenshot"].wallMilliseconds, 10);
  }
  assert.deepEqual((await readdir(context.options.output)).sort(), ["candidate", "comparison-index-moons-inner.json"]);
  assert.deepEqual(JSON.parse(await readFile(path.join(context.options.output, "comparison-index-moons-inner.json"), "utf8")), index);
});

test("changed trees capture independently while identical main/develop use strict develop evidence", async (t) => {
  for (const trees of [["base", "base", "changed"], ["main", "develop", "candidate"]]) {
    const context = await fixture(t, trees);
    const index = await runComparison(context.options, context.operations);
    assert.equal(index.status, "passed");
    assert.deepEqual(context.captures, trees[0] === trees[1] ? ["develop", "candidate"] : labels);
    assert.equal(index.sources[2].capturedBy, "candidate");
  }
});

test("failed strict canonical capture never supplies an alias pass", async (t) => {
  const context = await fixture(t);
  const capture = context.operations.capture;
  context.operations.capture = async (options) => {
    await capture(options);
    throw new Error("centered pick failed in strict candidate capture");
  };
  const index = await runComparison(context.options, context.operations);
  assert.equal(index.status, "failed");
  assert.deepEqual(context.captures, ["candidate"]);
  for (const source of index.sources) {
    assert.equal(source.status, "failed");
    assert.equal(source.evidence, undefined);
    assert.match(source.error, /centered pick failed/);
  }
});

test("a failed baseline does not stop independent candidate diagnostic captures", async (t) => {
  const context = await fixture(t, ["base", "base", "changed"]);
  const capture = context.operations.capture;
  context.operations.capture = async (options) => {
    await capture(options);
    if (options.label === "develop") throw new Error("baseline failed");
  };
  const index = await runComparison(context.options, context.operations);
  assert.equal(index.status, "failed");
  assert.deepEqual(context.captures, ["develop", "candidate"]);
  assert.deepEqual(index.sources.map(({ status }) => status), ["failed", "failed", "passed"]);
});

test("incomplete, corrupt, mismatched, or failed manifests cannot satisfy shared evidence", async (t) => {
  const cases = {
    "missing manifest": (directory) => rm(path.join(directory, "capture-details.json")),
    "invalid JSON": (directory) => writeFile(path.join(directory, "capture-details.json"), "{"),
    "missing original": (directory) => rm(path.join(directory, "focus-tracking-desktop-io-400-0ms.png")),
    "corrupt original": (directory) => writeFile(path.join(directory, "focus-tracking-desktop-io-400-0ms.png"), "corrupt"),
    "corrupt report": (directory) => writeFile(path.join(directory, "focus-tracking-desktop-io-400.json"), "{}"),
    "missing report record": (directory) => editManifest(directory, (manifest) => { manifest.focusTrackingReports = []; }),
    "source mismatch": (directory) => editManifest(directory, (manifest) => { manifest.source.commit = "0".repeat(40); }),
    "harness mismatch": (directory) => editManifest(directory, (manifest) => { manifest.harness.sha256 = "0".repeat(64); }),
    "capture failure": (directory) => editManifest(directory, (manifest) => { manifest.failures.push({ reason: "unsettled" }); }),
    "browser error": (directory) => editManifest(directory, (manifest) => { manifest.browserErrors.push("WebGL error"); }),
    "missing scenario": (directory) => editManifest(directory, (manifest) => { manifest.captures.pop(); }),
    "duplicate scenario": (directory) => editManifest(directory, (manifest) => { manifest.captures[1] = manifest.captures[0]; }),
    "unexpected file": (directory) => writeFile(path.join(directory, "stale.png"), "stale"),
    "dirty source report": (directory) => editManifest(directory, (manifest) => { manifest.sourceCleanAfter = false; }),
  };
  for (const [name, corrupt] of Object.entries(cases)) await t.test(name, async (t) => {
    const context = await fixture(t);
    const capture = context.operations.capture;
    context.operations.capture = async (options) => { await capture(options); await corrupt(options.output); };
    const index = await runComparison(context.options, context.operations);
    assert.equal(index.status, "failed");
    assert.ok(index.sources.every(({ status, evidence }) => status === "failed" && evidence === undefined));
  });
});

test("dirty and moved alias checkouts fail closed", async (t) => {
  for (const move of [false, true]) await t.test(move ? "moved alias" : "dirty alias", async (t) => {
    const context = await fixture(t);
    const capture = context.operations.capture;
    context.operations.capture = async (options) => {
      await capture(options);
      if (move) commit(context.roots.main, "moved while identical tree was captured");
      else await writeFile(path.join(context.roots.main, "renderer.txt"), "dirty");
    };
    const index = await runComparison(context.options, context.operations);
    assert.equal(index.status, "failed");
    assert.ok(index.sources.every(({ status }) => status === "failed"));
  });
});

test("an initially dirty source fails while clean independent sources still capture", async (t) => {
  const context = await fixture(t, ["main", "develop", "candidate"]);
  await writeFile(path.join(context.roots.main, "untracked.txt"), "dirty");
  const index = await runComparison(context.options, context.operations);
  assert.equal(index.status, "failed");
  assert.deepEqual(context.captures, ["develop", "candidate"]);
  assert.deepEqual(index.sources.map(({ status }) => status), ["failed", "passed", "passed"]);
});

test("harness movement invalidates every shared evidence mapping", async (t) => {
  const context = await fixture(t, ["main", "develop", "candidate"]);
  const capture = context.operations.capture;
  context.operations.capture = async (options) => {
    await capture(options);
    if (options.label === "candidate") commit(context.options.harnessRoot, "harness moved during final capture");
  };
  const index = await runComparison(context.options, context.operations);
  assert.equal(index.status, "failed");
  assert.deepEqual(context.captures, labels);
  assert.ok(index.sources.every(({ status, evidence }) => status === "failed" && evidence === undefined));
});

test("every group retains its full inventory and rejects shortened coverage", async (t) => {
  for (const group of Object.keys(counts)) await t.test(group, async (t) => {
    const context = await fixture(t);
    context.options.group = group;
    const index = await runComparison(context.options, context.operations);
    assert.equal(index.status, "passed");
    assert.equal(index.sources[2].coverage.captured, counts[group]);
    const inventory = structuredClone(context.inventories.get("candidate"));
    inventory.expected.pop();
    await assert.rejects(validateEvidence(path.join(context.options.output, "candidate", group), inventory, {
      group, source: inventory.source, harness: context.harness,
    }), /complete group coverage/);
  });
});

test("old evidence cannot satisfy a new attempt, with or without an old index", async (t) => {
  const context = await fixture(t);
  assert.equal((await runComparison(context.options, context.operations)).status, "passed");
  await assert.rejects(runComparison(context.options, context.operations), { code: "EEXIST" });
  await rm(path.join(context.options.output, "comparison-index-moons-inner.json"));
  const index = await runComparison(context.options, context.operations);
  assert.equal(index.status, "failed");
  assert.equal(index.sources[2].status, "failed");
  assert.match(index.sources[2].error, /evidence directory must be fresh/);
});

test("evidence cannot be written inside any source or the harness", async (t) => {
  const context = await fixture(t);
  for (const root of [context.options.harnessRoot, ...Object.values(context.roots)]) {
    await assert.rejects(runComparison({ ...context.options, output: path.join(root, "evidence") }, context.operations), /outside all immutable checkouts/);
    assert.equal(git(root, "status", "--porcelain", "--untracked-files=all"), "", "rejected output did not create files inside checkout");
  }
  await symlink(context.roots.main, path.join(context.root, "source-link"));
  await assert.rejects(runComparison({ ...context.options, output: path.join(context.root, "source-link", "new-evidence") }, context.operations), /outside all immutable checkouts/);
  assert.equal(git(context.roots.main, "status", "--porcelain", "--untracked-files=all"), "");
  await assert.rejects(runComparison({ ...context.options, output: context.root }, context.operations), /capture directories stay outside/);
});

test("a symlink evidence parent cannot redirect a capture outside its output directory", async (t) => {
  const context = await fixture(t, ["main", "develop", "candidate"]);
  const outside = path.join(context.root, "redirected-evidence");
  await mkdir(outside);
  await mkdir(context.options.output);
  await symlink(outside, path.join(context.options.output, "candidate"));
  const index = await runComparison(context.options, context.operations);
  assert.equal(index.status, "failed");
  assert.equal(index.sources[2].status, "failed");
  assert.match(index.sources[2].error, /not a symlink/);
  assert.deepEqual(await readdir(outside), []);
});
