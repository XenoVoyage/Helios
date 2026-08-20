import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BODIES } from "../js/bodies.js";
import { CONFIG } from "../js/config.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const remote = /cdn\.|jsdelivr|unpkg|googleapis|cloudflare|fastly|analytics|gtag|telemetry/i;

async function read(relative) {
  return readFile(path.join(root, relative), "utf8");
}

const html = await read("index.html");
const css = await read("styles.css");
const app = await read("js/app.js");
const version = (await read("VERSION.txt")).trim();
const license = await read("LICENSE");
const threeLicense = await read("vendor/THREE-LICENSE");

assert.equal(version, CONFIG.VERSION);
assert.match(html, /Content-Security-Policy/);
assert.match(html, /connect-src 'none'/);
assert.match(html, /id="play-button"/);
assert.match(html, /id="speed-slider"/);
assert.match(html, /id="reset-button"/);
assert.match(html, /viewport-fit=cover/);
assert.doesNotMatch(html, remote);
assert.doesNotMatch(css, remote);
assert.doesNotMatch(app, remote);
assert.match(html, /vendor\/three|js\/app\.js/);
assert.match(license, /MIT License/);
assert.match(threeLicense, /three\.js authors/);
assert.match(css, /min-height: 44px/);
assert.doesNotMatch(css, /:hover\s*\{[^}]*display:\s*block/);

await stat(path.join(root, "vendor/three.module.min.js"));
await stat(path.join(root, "vendor/three.core.min.js"));
await stat(path.join(root, ".nojekyll"));

const threeRoot = path.join(root, "vendor");
const seenThree = new Set();
const pendingThree = ["three.module.min.js"];
while (pendingThree.length) {
  const relative = pendingThree.pop();
  if (seenThree.has(relative)) continue;
  seenThree.add(relative);
  const source = await read(path.join("vendor", relative));
  for (const spec of source.matchAll(/from\s*["']([^"']+)["']/g)) {
    assert.match(spec[1], /^\.\//, spec[1]);
    const resolved = path.relative(threeRoot, path.resolve(threeRoot, spec[1]));
    assert.equal(resolved, path.normalize(spec[1].slice(2)));
    pendingThree.push(resolved);
  }
}

const three = await import(pathToFileURL(path.join(root, "vendor/three.module.min.js")).href);
assert.equal(three.REVISION, "185");
assert.equal(typeof three.WebGLRenderer, "function");
assert.equal(typeof three.Scene, "function");
assert.equal(typeof three.TextureLoader, "function");

for (const body of BODIES) {
  await stat(path.join(root, body.texture));
  if (body.ring) await stat(path.join(root, body.ring));
}

console.log("static-check ok");
