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
    "styles.css",
    "vendor/three.module.min.js",
    "vendor/three.core.min.js",
    "assets/textures/earth.jpg",
    "assets/textures/saturn-ring.png",
    "assets/sky/milky-way.jpg",
    "assets/sky/andromeda.png",
  ];
  for (const relative of paths) {
    const response = await fetch(base + relative);
    assert.equal(response.status, 200, relative || "index.html");
  }

  const html = await (await fetch(base)).text();
  assert.match(html, /id="play-button"/);
  assert.match(html, /id="speed-slider"/);
  assert.match(html, /touch-action: none|\.css/);
  console.log("http-smoke ok");
} finally {
  child.kill("SIGTERM");
}
