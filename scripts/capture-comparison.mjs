import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const labels = ["main", "develop", "candidate"];
const groupCounts = { "bodies-inner": 48, "bodies-giants": 23, "bodies-outer": 13, "moons-inner": 31, "moons-outer": 30, "touch-controls": 47, responsive: 40, "desktop-states": 26, "touch-states": 28, ordinary: 63 };
const defaultHarness = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
const sorted = (items) => [...items].sort();
const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);

async function outputPath(requested, checkouts) {
  const destination = path.resolve(requested);
  let ancestor = destination;
  while (true) {
    try {
      const resolved = path.join(await realpath(ancestor), path.relative(ancestor, destination));
      for (const root of checkouts) assert.ok(!inside(destination, root) && !inside(resolved, root), "evidence stays outside all immutable checkouts");
      await mkdir(resolved, { recursive: true });
      return realpath(resolved);
    } catch (error) {
      if (error.code !== "ENOENT" || ancestor === path.dirname(ancestor)) throw error;
      ancestor = path.dirname(ancestor);
    }
  }
}

function failSource(source, error) {
  source.status = "failed";
  source.error = String(error);
  for (const field of ["evidence", "capturedBy", "reused", "manifest", "coverage", "timing"]) delete source[field];
}

function identity(root) {
  assert.equal(git(root, "rev-parse", "--show-toplevel"), root, "source must be a checkout root");
  return { commit: git(root, "rev-parse", "HEAD"), tree: git(root, "rev-parse", "HEAD^{tree}") };
}

function assertFrozen(root, frozen) {
  assert.deepEqual(identity(root), frozen, `${root} commit and tree remain frozen`);
  assert.equal(git(root, "status", "--porcelain", "--untracked-files=all"), "", `${root} remains clean`);
}

async function harnessIdentity(root) {
  const frozen = identity(root);
  assertFrozen(root, frozen);
  const observer = await readFile(path.join(root, "tests/focus-tracking.mjs"));
  return {
    ...frozen, clean: true,
    sha256: sha256(await readFile(path.join(root, "tests/visual-capture.mjs"))),
    focusTracking: { file: "tests/focus-tracking.mjs", sha256: sha256(observer), bytes: observer.length },
  };
}

// main permits a historical pick mismatch. An identical stricter source owns
// shared evidence so deduplication cannot turn a candidate failure into a pass.
export function captureClasses(sources) {
  const classes = new Map();
  for (const label of labels) {
    const source = sources.find((item) => item.label === label);
    if (!source || source.status === "failed") continue;
    const entry = classes.get(source.tree) || { tree: source.tree, members: [] };
    entry.members.push(label);
    entry.capturedBy = label;
    classes.set(source.tree, entry);
  }
  return [...classes.values()].sort((a, b) => labels.indexOf(a.capturedBy) - labels.indexOf(b.capturedBy));
}

function captureArgs({ root, label, group, output }) {
  return ["--source-root", root, "--source-label", label, "--group", group,
    ...(output ? ["--output", output] : ["--inventory-only"])];
}

async function inventoryFor(options) {
  return JSON.parse(execFileSync(process.execPath,
    [path.join(options.harnessRoot, "tests/visual-capture.mjs"), ...captureArgs(options)],
    { cwd: options.harnessRoot, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 }));
}

async function capture(options) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath,
      [path.join(options.harnessRoot, "tests/visual-capture.mjs"), ...captureArgs(options)],
      { cwd: options.harnessRoot, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0
      ? resolve() : reject(new Error(`capture exited ${code ?? signal}`)));
  });
}

function validateInventory(inventory, { group, source, harness }) {
  assert.equal(inventory.group, group, "inventory group matches request");
  assert.deepEqual(inventory.source, source, "inventory source matches frozen checkout");
  assert.deepEqual(inventory.harness, harness, "inventory uses frozen harness");
  assert.equal(inventory.completeMatrixCount, 349, "complete comparison matrix is retained");
  assert.equal(inventory.fullExpected.length, 349, "full inventory is retained");
  assert.equal(new Set(inventory.fullExpected).size, 349, "full inventory contains no duplicates");
  const names = inventory.expected.map((entry) => entry.name);
  assert.equal(names.length, groupCounts[group], "complete group coverage is retained");
  assert.equal(new Set(names).size, names.length, "group inventory contains no duplicates");
  for (const name of names) {
    assert.match(name, /^[a-z0-9][a-z0-9-]*$/, "safe capture name");
    assert.ok(inventory.fullExpected.includes(name), "group belongs to the full inventory");
  }
  return names;
}

async function regularFile(file) {
  assert.equal((await lstat(file)).isFile(), true, `${file} is a regular evidence file`);
  return readFile(file);
}

export async function validateEvidence(directory, inventory, { group, source, harness }) {
  const names = validateInventory(inventory, { group, source, harness });
  const bytes = await regularFile(path.join(directory, "capture-details.json"));
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.schema, 1, "supported capture manifest schema");
  assert.equal(manifest.group, group, "manifest group matches request");
  assert.deepEqual(manifest.source, source, "manifest source matches frozen checkout");
  assert.deepEqual(manifest.harness, harness, "manifest uses frozen harness");
  assert.equal(manifest.completeMatrixCount, inventory.completeMatrixCount);
  assert.deepEqual(manifest.fullExpected, inventory.fullExpected, "full scenario inventory matches preflight");
  assert.deepEqual(manifest.expected, names, "requested scenario inventory matches preflight");
  for (const field of ["failures", "browserErrors", "missing", "missingTrackingReports"]) {
    assert.deepEqual(manifest[field], [], `${field} must be empty`);
  }
  assert.equal(manifest.sourceCleanAfter, true, "captured source stayed clean");
  assert.equal(manifest.sourceCommitAfter, source.commit, "captured commit stayed frozen");
  assert.equal(manifest.sourceTreeAfter, source.tree, "captured tree stayed frozen");
  assert.equal(manifest.harnessCleanAfter, true, "capture harness stayed clean");
  assert.deepEqual(sorted(manifest.captures.map((entry) => entry.name)), sorted(names), "every requested original exists exactly once");
  const reportIds = [...new Set(names.flatMap((name) => {
    const match = name.match(/^focus-tracking-(.+)-[0-9]+ms$/);
    return match ? [match[1]] : [];
  }))];
  assert.deepEqual(sorted(manifest.focusTrackingExpectedReports), sorted(reportIds), "all dense tracking reports remain required");
  assert.deepEqual(sorted(manifest.focusTrackingReports.map((entry) => entry.scenario)), sorted(reportIds), "all dense tracking reports exist exactly once");
  const files = ["capture-details.json"];
  for (const entry of [...manifest.captures, ...manifest.focusTrackingReports]) {
    const expectedFile = entry.name ? `${entry.name}.png` : `focus-tracking-${entry.scenario}.json`;
    assert.equal(entry.file, expectedFile, "evidence uses its expected filename");
    const original = await regularFile(path.join(directory, expectedFile));
    assert.equal(original.length, entry.bytes, `${expectedFile} byte count matches`);
    assert.equal(sha256(original), entry.sha256, `${expectedFile} hash matches`);
    if (entry.name) {
      assert.equal(original.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "original is a PNG");
    } else {
      const report = JSON.parse(original);
      assert.equal(report.scenario.id, entry.scenario, "dense report identifies its scenario");
      assert.equal(entry.completed, true, "tracking capture completed");
      assert.equal(report.completed, true, "dense tracking report completed");
      assert.ok(!entry.infrastructureError && !report.infrastructureError, "no tracking infrastructure error");
      assert.deepEqual(report.browserErrors, [], "no tracking browser errors");
      // Baseline tracking diagnostics remain evidence, not a replacement for
      // npm test's candidate tracking regression assertions.
    }
    files.push(expectedFile);
  }
  assert.deepEqual(sorted(await readdir(directory)), sorted(files), "directory contains exactly the requested evidence");
  assert.ok(Array.isArray(manifest.timings), "capture timing observations are retained");
  const timing = {};
  for (const entry of manifest.timings) {
    assert.ok(Number.isFinite(entry.wallMilliseconds) && entry.wallMilliseconds >= 0, "finite capture timing");
    const summary = timing[entry.operation] ??= { count: 0, wallMilliseconds: 0 };
    summary.count += 1;
    summary.wallMilliseconds += entry.wallMilliseconds;
  }
  return {
    manifest: { file: "capture-details.json", sha256: sha256(bytes), bytes: bytes.length },
    coverage: { expected: names.length, captured: manifest.captures.length, trackingReports: reportIds.length, completeMatrix: 349 },
    timing,
  };
}

export async function runComparison({ group, roots, output, harnessRoot = defaultHarness }, operations = {}) {
  assert.ok(Object.hasOwn(groupCounts, group), "supported comparison group required");
  harnessRoot = await realpath(harnessRoot);
  const sourceRoots = Object.fromEntries(await Promise.all(labels.map(async (label) => [label, await realpath(roots[label])])));
  output = await outputPath(output, [harnessRoot, ...Object.values(sourceRoots)]);
  for (const label of labels) {
    for (const root of [harnessRoot, ...Object.values(sourceRoots)]) {
      assert.ok(!inside(path.join(output, label, group), root), "capture directories stay outside all immutable checkouts");
    }
  }
  const indexFile = path.join(output, `comparison-index-${group}.json`);
  const index = {
    schema: 1, group, status: "running", startedAt: new Date().toISOString(),
    policy: "Same-run full Git tree identity only; candidate > develop > main owns identical-tree evidence. No cross-run reuse.",
    sources: [], captures: [], failures: [],
  };
  // Reserving the index and each capture directory prevents old files from
  // satisfying a new run, even if a previous attempt stopped halfway through.
  await writeFile(indexFile, JSON.stringify(index, null, 2) + "\n", { flag: "wx" });
  const flush = () => writeFile(indexFile, JSON.stringify(index, null, 2) + "\n");
  const started = performance.now();
  try {
    index.harness = await harnessIdentity(harnessRoot);
    for (const label of labels) {
      const source = { label, ...identity(sourceRoots[label]), status: "pending" };
      index.sources.push(source);
      try {
        assertFrozen(sourceRoots[label], { commit: source.commit, tree: source.tree });
        const parent = await lstat(path.join(output, label)).catch((error) => {
          if (error.code !== "ENOENT") throw error;
          return null;
        });
        assert.ok(parent === null || parent.isDirectory(), `${label} evidence parent must be a real directory, not a symlink`);
        const previous = await lstat(path.join(output, label, group)).catch((error) => {
          if (error.code !== "ENOENT") throw error;
          return null;
        });
        assert.equal(previous, null, `${label}/${group} evidence directory must be fresh`);
      } catch (error) {
        failSource(source, error);
      }
    }
    for (const entry of captureClasses(index.sources)) {
      const source = index.sources.find((item) => item.label === entry.capturedBy);
      const frozenSource = { label: source.label, commit: source.commit, tree: source.tree };
      const directory = path.join(output, source.label, group);
      const record = { ...entry, status: "running", directory: `${source.label}/${group}`, startedAt: new Date().toISOString() };
      index.captures.push(record);
      await flush();
      const captureStarted = performance.now();
      try {
        assert.deepEqual(await harnessIdentity(harnessRoot), index.harness, "harness remains frozen");
        for (const label of entry.members) {
          const item = index.sources.find((item) => item.label === label);
          assertFrozen(sourceRoots[label], { commit: item.commit, tree: item.tree });
        }
        const options = { root: sourceRoots[source.label], label: source.label, group, harnessRoot };
        const inventory = await (operations.inventoryFor || inventoryFor)(options);
        validateInventory(inventory, { group, source: frozenSource, harness: index.harness });
        await mkdir(path.dirname(directory), { recursive: true });
        await mkdir(directory);
        await (operations.capture || capture)({ ...options, output: directory });
        const evidence = await validateEvidence(directory, inventory, { group, source: frozenSource, harness: index.harness });
        assert.deepEqual(await harnessIdentity(harnessRoot), index.harness, "harness remains frozen after capture");
        for (const label of entry.members) {
          const item = index.sources.find((item) => item.label === label);
          assertFrozen(sourceRoots[label], { commit: item.commit, tree: item.tree });
        }
        Object.assign(record, evidence, { status: "passed" });
        for (const label of entry.members) {
          Object.assign(index.sources.find((item) => item.label === label), evidence, {
            status: "passed", capturedBy: source.label, reused: label !== source.label,
            evidence: `${source.label}/${group}/capture-details.json`,
          });
        }
      } catch (error) {
        record.status = "failed";
        record.error = String(error);
        for (const label of entry.members) {
          failSource(index.sources.find((item) => item.label === label), error);
        }
      }
      record.completedAt = new Date().toISOString();
      record.wallMilliseconds = Math.round(performance.now() - captureStarted);
      await flush();
    }
    try {
      assert.deepEqual(await harnessIdentity(harnessRoot), index.harness, "harness remains frozen at completion");
    } catch (error) {
      for (const source of index.sources) failSource(source, error);
      throw error;
    }
    for (const source of index.sources) {
      try {
        assertFrozen(sourceRoots[source.label], { commit: source.commit, tree: source.tree });
      } catch (error) {
        failSource(source, error);
      }
    }
    assert.equal(index.sources.filter((source) => source.status === "passed").length, 3, "every requested source needs complete verified evidence");
    index.status = "passed";
  } catch (error) {
    index.status = "failed";
    index.failures.push(String(error));
  }
  index.completedAt = new Date().toISOString();
  index.wallMilliseconds = Math.round(performance.now() - started);
  await flush();
  return index;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = new Map();
  for (let index = 2; index < process.argv.length; index += 2) {
    const name = process.argv[index];
    assert.ok(["--group", "--main", "--develop", "--candidate", "--output"].includes(name), `unknown argument ${name}`);
    assert.ok(process.argv[index + 1] && !options.has(name), `one value required for ${name}`);
    options.set(name, process.argv[index + 1]);
  }
  for (const name of ["--group", "--main", "--develop", "--candidate", "--output"]) assert.ok(options.has(name), `${name} required`);
  const index = await runComparison({ group: options.get("--group"), output: options.get("--output"),
    roots: Object.fromEntries(labels.map((label) => [label, options.get(`--${label}`)])) });
  console.log(`Comparison ${index.group}: ${index.status}; ${index.captures.length} distinct tree captures for 3 requested sources`);
  if (index.status !== "passed") process.exitCode = 1;
}
