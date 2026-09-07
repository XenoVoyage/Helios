import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { publishPaths, stageSite } from "../scripts/stage-site.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.SMOKE_PORT || 4174);
const origin = `http://127.0.0.1:${port}`;
const base = `${origin}/Helios/`;

async function listFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    assert.equal(entry.isSymbolicLink(), false, `${relative}: staged files are not symlinks`);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path.join(directory, entry.name), `${relative}/`));
    } else {
      assert.ok(entry.isFile(), `${relative}: published entry is a regular file`);
      files.push(relative);
    }
  }
  return files.sort();
}

// fetch normalizes dot segments before sending; keep these request targets raw.
function rawGet(target) {
  return new Promise((resolve, reject) => {
    const outgoing = request({ hostname: "127.0.0.1", port, path: target }, (response) => {
      response.once("error", reject);
      response.resume();
      response.once("end", () => resolve(response));
    });
    outgoing.once("error", reject);
    outgoing.setTimeout(5_000, () => outgoing.destroy(new Error(`request timed out: ${target}`)));
    outgoing.end();
  });
}

const temporary = await mkdtemp(path.join(tmpdir(), "helios-http-"));
const staged = path.join(temporary, "site");
let child;
let serverExited;

try {
  await stageSite(staged);
  await assert.rejects(() => stageSite(staged), undefined, "staging refuses an existing output directory");

  const expected = [];
  for (const entry of publishPaths) {
    if (entry.endsWith("/")) {
      expected.push(...await listFiles(path.join(root, entry), entry));
    } else {
      expected.push(entry);
    }
  }
  expected.sort();
  assert.equal(new Set(expected).size, expected.length, "publish entries do not overlap");
  assert.deepEqual(await listFiles(staged), expected, "staging contains exactly the publish contract");

  child = spawn(process.execPath, ["tests/serve.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4_096); });
  serverExited = once(child, "exit");
  const [line] = await Promise.race([
    once(child.stdout, "data"),
    serverExited.then(([code, signal]) => {
      throw new Error(`server exited ${code ?? signal}: ${stderr}`);
    }),
    delay(10_000, undefined, { ref: false }).then(() => {
      throw new Error(`server startup timed out: ${stderr}`);
    }),
  ]);
  assert.match(String(line), /Helios local server/);

  for (const relative of expected) {
    const [sourceBody, stagedBody] = await Promise.all([
      readFile(path.join(root, relative)),
      readFile(path.join(staged, relative)),
    ]);
    assert.deepEqual(stagedBody, sourceBody, `${relative}: staging preserves exact source bytes`);

    const response = await fetch(base + relative);
    assert.equal(response.status, 200, relative);
    assert.equal(response.headers.get("cache-control"), "no-store", relative);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff", relative);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), stagedBody, `${relative}: HTTP matches staged bytes`);

    const head = await fetch(base + relative, { method: "HEAD" });
    assert.equal(head.status, 200, `HEAD ${relative}`);
    assert.equal(head.headers.get("content-type"), response.headers.get("content-type"), relative);
    assert.equal(head.headers.get("x-content-type-options"), "nosniff", relative);
    assert.equal((await head.arrayBuffer()).byteLength, 0, `HEAD ${relative} has no body`);

    if (relative === "PROVENANCE.md") {
      assert.match(response.headers.get("content-type") ?? "", /^text\/plain;\s*charset=utf-8$/i);
      assert.doesNotMatch(response.headers.get("content-disposition") ?? "", /\battachment\b/i);
      assert.doesNotMatch(head.headers.get("content-disposition") ?? "", /\battachment\b/i);
    }
  }

  for (const relative of [
    ".git/config", ".git/HEAD", "package.json", "package-lock.json",
    "README.md", "VERSION.txt", "AGENTS.md", "REPOSITORY_STANDARD.md",
    "tests/serve.mjs", "tests/fixtures/orbital-provenance.json",
    "scripts/build-2mrs.mjs", "scripts/stage-site.mjs",
    ".github/workflows/pages.yml", "docs/assets/helios-overview.webp",
  ]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await fetch(base + relative, { method });
      assert.equal(response.status, 404, `${method} excludes ${relative}`);
      await response.arrayBuffer();
    }
  }

  for (const relative of ["assets/", "js/", "vendor/", "js/missing-module.js"]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await fetch(base + relative, { method });
      assert.equal(response.status, 404, `${method} missing file or directory index: ${relative}`);
      const body = await response.arrayBuffer();
      if (method === "HEAD") assert.equal(body.byteLength, 0, `HEAD ${relative} has no body`);
    }
  }

  for (const [target, status] of [
    ["/Helios/%", 400],
    ["/Helios/%E0%A4%A", 400],
    ["/Helios/%2e%2e%2foutside.txt", 403],
    ["/Helios/assets/%2e%2e%2fpackage.json", 404],
    ["/Helios/assets/../package.json", 404],
    ["/Helios/%2egit/config", 404],
  ]) {
    assert.equal((await rawGet(target)).statusCode, status, target);
  }

  for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
    const response = await fetch(base, { method });
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get("allow"), "GET, HEAD", method);
    await response.arrayBuffer();
  }
  const redirect = await fetch(`${origin}/Helios`, { redirect: "manual" });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get("location"), "/Helios/");
  await redirect.arrayBuffer();
  for (const target of ["/", "/Helios-other/index.html"]) {
    const response = await fetch(origin + target);
    assert.equal(response.status, 404, target);
    await response.arrayBuffer();
  }

  const htmlResponse = await fetch(base + "?look=sky");
  assert.equal(htmlResponse.status, 200);
  assert.match(htmlResponse.headers.get("content-type") ?? "", /^text\/html;\s*charset=utf-8$/i);
  const html = await htmlResponse.text();
  assert.equal(html, await readFile(path.join(staged, "index.html"), "utf8"));
  assert.match(html, /id="play-button"/);
  assert.match(html, /id="speed-slider"/);
  assert.match(html, /touch-action: none|\.css/);
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /connect-src 'none'/);
  console.log(`http-smoke ok (${expected.length} staged files match exact HTTP bytes)`);
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      serverExited.catch(() => {}),
      delay(2_000, undefined, { ref: false }),
    ]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await serverExited.catch(() => {});
    }
  }
  await rm(temporary, { recursive: true, force: true });
}
