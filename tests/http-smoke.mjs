import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.SMOKE_PORT || 4174);
const base = `http://127.0.0.1:${port}/Helios/`;
const child = spawn(process.execPath, ["tests/serve.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  const [line] = await Promise.race([
    once(child.stdout, "data"),
    once(child, "exit").then(([code]) => {
      throw new Error(`server exited ${code}`);
    }),
  ]);
  assert.match(String(line), /Helios local server/);

  const paths = [
    "",
    "js/app.js",
    "js/bodies.js",
    "js/config.js",
    "js/sky.js",
    "js/sky-catalog.js",
    "js/galaxy.js",
    "js/galaxy-catalog.js",
    "js/cosmic-web.js",
    "js/2mrs-data.js",
    "js/helpers.js",
    "js/time.js",
    "PROVENANCE.md",
    "styles.css",
    "vendor/three.module.min.js",
    "vendor/three.core.min.js",
    "assets/textures/earth.jpg",
    "assets/textures/saturn-ring.png",
    "assets/sky/milky-way.jpg",
    "assets/sky/andromeda.png",
    "assets/sky/cmb.jpg",
    "docs/assets/helios-overview.webp",
  ];
  for (const relative of paths) {
    const response = await fetch(base + relative);
    assert.equal(response.status, 200, relative || "index.html");
    if (relative.endsWith(".webp")) {
      assert.match(response.headers.get("content-type") ?? "", /image\/webp/);
    } else if (relative.endsWith(".md")) {
      assert.match(response.headers.get("content-type") ?? "", /text\/markdown/);
    }
  }

  const html = await (await fetch(base)).text();
  assert.match(html, /id="play-button"/);
  assert.match(html, /id="speed-slider"/);
  assert.match(html, /touch-action: none|\.css/);
  console.log("http-smoke ok");
} finally {
  child.kill("SIGTERM");
}
