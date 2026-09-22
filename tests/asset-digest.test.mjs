import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { BODIES } from "../js/bodies.js";
import { CMB_SHELL } from "../js/galaxy-catalog.js";
import { SKY_ASSETS } from "../js/sky.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(new URL("./fixtures/asset-digest-manifest.json", import.meta.url), "utf8"),
);
const textureProvenance = JSON.parse(
  await readFile(new URL("./fixtures/texture-provenance.json", import.meta.url), "utf8"),
);
const readme = await readFile(path.join(root, "README.md"), "utf8");
const provenance = await readFile(path.join(root, "PROVENANCE.md"), "utf8");

const requiredFamilies = [
  "solar-system-scope-2k",
  "nasa-3d-resources-jpeg",
  "lpi-triton-mosaic",
  "esa-gaia-milky-way",
  "nasa-spitzer-andromeda",
  "cmb-illustration",
  "documentation-screenshots",
  "saturn-ring-backface-evidence",
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function familyManifestText(entries) {
  return `${entries
    .slice()
    .sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)))
    .map((entry) => `${entry.sha256}  ${entry.path}`)
    .join("\n")}\n`;
}

function cloneManifest(value = manifest) {
  return structuredClone(value);
}

async function listRootFiles(relativeDir) {
  const files = [];
  async function walk(current) {
    for (const entry of await readdir(path.join(root, current), { withFileTypes: true })) {
      const relative = `${current}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(relative);
        continue;
      }
      files.push(relative);
    }
  }
  await walk(relativeDir);
  return files.sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
}

async function observedFilesFromDisk() {
  const paths = [];
  for (const relativeDir of manifest.roots) {
    paths.push(...await listRootFiles(relativeDir));
  }
  const files = [];
  for (const relative of paths) {
    files.push({ path: relative, sha256: sha256(await readFile(path.join(root, relative))) });
  }
  return files;
}

function assetIntegrityFailures(expected, observed) {
  const failures = [];
  const expectedPaths = expected.files.map((file) => file.path);
  const observedPaths = observed.map((file) => file.path);
  if (new Set(expectedPaths).size !== expectedPaths.length) failures.push("duplicate expected path");
  if (new Set(observedPaths).size !== observedPaths.length) failures.push("duplicate observed path");

  const expectedSet = new Set(expectedPaths);
  const observedSet = new Set(observedPaths);
  for (const filePath of expectedPaths) {
    if (!observedSet.has(filePath)) failures.push(`missing ${filePath}`);
  }
  for (const filePath of observedPaths) {
    if (!expectedSet.has(filePath)) failures.push(`unexpected ${filePath}`);
  }

  const observedByPath = new Map(observed.map((file) => [file.path, file]));
  for (const file of expected.files) {
    const actual = observedByPath.get(file.path);
    if (actual && actual.sha256 !== file.sha256) failures.push(`digest ${file.path}`);
  }

  const digestOwners = new Map();
  for (const file of expected.files) {
    if (digestOwners.has(file.sha256)) failures.push(`duplicate bytes ${file.path}`);
    else digestOwners.set(file.sha256, file.path);
  }

  const familyIds = expected.families.map((family) => family.id);
  if (new Set(familyIds).size !== familyIds.length) failures.push("duplicate family");
  const filesByFamily = new Map(familyIds.map((id) => [id, []]));
  for (const file of expected.files) {
    if (!filesByFamily.has(file.family)) {
      failures.push(`unknown family ${file.path}`);
      continue;
    }
    filesByFamily.get(file.family).push({
      path: file.path,
      sha256: observedByPath.get(file.path)?.sha256 ?? file.sha256,
    });
  }
  for (const family of expected.families) {
    const members = filesByFamily.get(family.id) ?? [];
    if (members.length === 0) failures.push(`empty family ${family.id}`);
    if (sha256(familyManifestText(members)) !== family.manifestSha256) {
      failures.push(`family ${family.id}`);
    }
  }
  return failures;
}

const diskFiles = await observedFilesFromDisk();

test("image-asset digest fixture owns every documented family and tracked file", () => {
  assert.match(manifest.scope, /2mrs-integrity\.json/);
  assert.match(manifest.algorithm, /sha256sum/);
  assert.deepEqual(manifest.roots, ["assets/textures", "assets/sky", "docs/assets", "docs/issues"]);
  assert.deepEqual(manifest.families.map((family) => family.id), requiredFamilies);
  assert.equal(manifest.files.length, 39);
  assert.deepEqual(
    [...manifest.files].map((file) => file.path).sort(),
    manifest.files.map((file) => file.path),
  );
  assert.match(provenance, /tests\/fixtures\/asset-digest-manifest\.json/);
  assert.doesNotMatch(manifest.scope, /js\/2mrs-data\.js/);
  assert.ok(!manifest.files.some((file) => file.path.includes("2mrs")));
  for (const family of requiredFamilies) {
    assert.match(provenance, new RegExp(`\`${family}\``), `${family} remains named in provenance`);
  }
});

test("family manifests match sha256sum of bytewise-sorted sha256sum lines", () => {
  for (const family of manifest.families) {
    const sorted = manifest.files
      .filter((file) => file.family === family.id)
      .map((file) => file.path)
      .sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
    const text = execFileSync("sha256sum", sorted, { cwd: root, encoding: "utf8" });
    const digest = execFileSync("sha256sum", { input: text, encoding: "utf8" }).trim().split(/\s+/)[0];
    assert.equal(digest, family.manifestSha256, family.id);
  }
});

test("tracked image bytes recompute the fixture digests and family manifests", () => {
  assert.deepEqual(assetIntegrityFailures(manifest, diskFiles), []);
});

test("runtime, README, and issue-evidence images stay inside the digest fixture", () => {
  const owned = new Set(manifest.files.map((file) => file.path));
  const required = new Set([
    ...BODIES.flatMap((body) => [body.texture, body.ring].filter(Boolean)),
    SKY_ASSETS.milkyWay,
    SKY_ASSETS.andromeda,
    CMB_SHELL.map,
    "docs/issues/saturn-ring-backface.webp",
    ...[...readme.matchAll(/docs\/assets\/[A-Za-z0-9._-]+\.webp/g)].map((match) => match[0]),
  ]);
  for (const filePath of required) {
    assert.ok(owned.has(filePath), `${filePath} must remain in the image-asset digest fixture`);
  }
});

test("texture provenance points at the image-asset digest fixture", () => {
  assert.match(textureProvenance.scope, /asset-digest-manifest\.json/);
});

test("byte-changed, added, removed, and renamed assets fail integrity checks", () => {
  const changed = diskFiles.map((file) => (
    file.path === "assets/textures/triton.jpg"
      ? { ...file, sha256: sha256(Buffer.from(`${file.sha256}mutated`)) }
      : file
  ));
  assert.deepEqual(
    assetIntegrityFailures(manifest, changed).sort(),
    ["digest assets/textures/triton.jpg", "family lpi-triton-mosaic"],
  );

  const added = [...diskFiles, { path: "assets/textures/extra.jpg", sha256: "0".repeat(64) }];
  assert.deepEqual(
    assetIntegrityFailures(manifest, added),
    ["unexpected assets/textures/extra.jpg"],
  );

  const removed = diskFiles.filter((file) => file.path !== "assets/sky/cmb.jpg");
  assert.deepEqual(
    assetIntegrityFailures(manifest, removed),
    ["missing assets/sky/cmb.jpg"],
  );

  const renamed = diskFiles.map((file) => (
    file.path === "docs/assets/helios-overview.webp"
      ? { ...file, path: "docs/assets/helios-overview-renamed.webp" }
      : file
  ));
  assert.deepEqual(
    assetIntegrityFailures(manifest, renamed).sort(),
    [
      "missing docs/assets/helios-overview.webp",
      "unexpected docs/assets/helios-overview-renamed.webp",
    ],
  );
});

test("family-membership drift fails unless the fixture is reviewed with it", () => {
  const drifted = cloneManifest();
  const pluto = drifted.files.find((file) => file.path === "assets/textures/pluto.jpg");
  pluto.family = "solar-system-scope-2k";
  assert.deepEqual(
    assetIntegrityFailures(drifted, diskFiles).sort(),
    ["family nasa-3d-resources-jpeg", "family solar-system-scope-2k"],
  );
});
