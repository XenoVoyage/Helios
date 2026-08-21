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
const bodies = await read("js/bodies.js");
const configSource = await read("js/config.js");
const sky = await read("js/sky.js");
const skyCatalog = await read("js/sky-catalog.js");
const galaxy = await read("js/galaxy.js");
const galaxyCatalog = await read("js/galaxy-catalog.js");
const helpers = await read("js/helpers.js");
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
assert.doesNotMatch(bodies, remote);
assert.doesNotMatch(configSource, remote);
assert.doesNotMatch(sky, remote);
assert.doesNotMatch(skyCatalog, remote);
assert.doesNotMatch(galaxy, remote);
assert.doesNotMatch(galaxyCatalog, remote);
assert.doesNotMatch(helpers, remote);
assert.match(html, /id="sky-button"/);
assert.match(html, /id="helper-orbit"/);
assert.match(html, /id="helper-axis"/);
assert.match(html, /id="helper-spin"/);
assert.match(app, /kuiperInnerAu/);
assert.match(app, /selectedId/);
assert.match(app, /visualBodyRadius/);
assert.doesNotMatch(app, /https?:\/\//);
assert.doesNotMatch(bodies, /https?:\/\//);
assert.doesNotMatch(configSource, /https?:\/\//);
assert.doesNotMatch(skyCatalog, /https?:\/\//);
assert.doesNotMatch(galaxy, /https?:\/\//);
assert.doesNotMatch(helpers, /https?:\/\//);
assert.match(html, /vendor\/three|js\/app\.js/);
assert.match(license, /MIT License/);
assert.match(threeLicense, /three\.js authors/);
assert.match(css, /min-height: 44px/);
assert.doesNotMatch(css, /:hover\s*\{[^}]*display:\s*block/);
assert.doesNotMatch(css, /--gold|#e8c872/i);
assert.match(css, /--cyan:\s*#66f7ff/);
assert.match(css, /--void:\s*#02050c/);
assert.match(css, /--magenta:\s*#ff57d8/);
assert.equal(CONFIG.defaultDaysPerSecond, 1 / 24);
assert.equal(CONFIG.minDaysPerSecond, 1 / 24);
assert.match(html, /1 h \/ sec/);
assert.doesNotMatch(html, /8 d \/ sec/);
assert.match(app, /PointLight/);
assert.match(app, /MeshStandardMaterial/);
assert.match(app, /ringInnerKm/);
assert.doesNotMatch(app, /HemisphereLight/);
assert.doesNotMatch(app, /createStarfield/);
assert.match(app, /createCelestialSphere/);
assert.match(app, /createGalaxyLayer/);
assert.match(app, /solarMaxDistance/);
assert.match(app, /localGroupViewDistance/);
assert.match(app, /virgoViewDistance/);
assert.match(app, /webViewDistance/);
assert.match(app, /universeViewDistance/);
assert.match(app, /handoffViewDistance/);
assert.match(app, /orreryScale/);
assert.match(app, /orbitLineOpacity/);
assert.match(app, /warmExtraZoom/);
assert.match(app, /paintConstellations/);
assert.match(app, /ui\.sky\.hidden/);
assert.match(app, /skyStaysOn/);
assert.match(app, /const inSolar = skyStaysOn\(state\.distance\)/);
assert.match(app, /setConstellationsVisible\(celestial, inSolar && state\.showConstellations\)/);
assert.match(app, /setCelestialFade/);
assert.match(app, /setSkyBandBrightness/);
assert.match(app, /attachFarGalaxySky/);
assert.match(app, /pinchZoomDistance/);
assert.match(app, /wheelZoomMultiplier/);
assert.match(app, /clearSelection/);
assert.match(app, /hidePlanets = scaleLayer\(state\.distance\) !== "solar"/);
assert.match(html, /id="card-close"/);
assert.match(html, /aria-label="Close"/);
assert.match(html, /user-scalable=no/);
assert.match(css, /#card-close/);
assert.match(configSource, /pinchZoomDistance/);
assert.match(galaxy, /milkyWayInteriorCameraAim/);
assert.match(galaxy, /skyStaysOn/);
assert.match(
  galaxy,
  /export function skyStaysOn\(distance\) \{\s*return scaleLayer\(distance\) === "solar";/,
);
assert.match(sky, /setSkyBandBrightness/);
assert.match(sky, /toneMapped:\s*false/);
assert.match(css, /\.labels[\s\S]*z-index:\s*1/);
assert.match(css, /#sky-button/);
assert.match(galaxy, /export function orreryScale/);
assert.match(galaxy, /export function orbitLineOpacity/);
assert.match(galaxy, /depthTest:\s*false/);
assert.match(galaxy, /rgba\(255, 255, 255, 1\)/);
assert.match(galaxy, /visualVirgo/);
assert.match(galaxy, /visualWeb/);
assert.match(galaxy, /visualUniverse/);
assert.match(galaxy, /cmb-shell|cmb\.jpg/);
assert.match(galaxy, /cosmic-web/);
assert.match(galaxy, /far-galaxy-sky/);
assert.match(galaxy, /deep-field/);
assert.match(galaxy, /mw-disk-edge/);
assert.doesNotMatch(galaxy, /You are here/);
assert.doesNotMatch(galaxyCatalog, /SUPERCLUSTERS/);
assert.doesNotMatch(galaxyCatalog, /Perseus-Pisces/);
assert.match(galaxyCatalog, /Large Magellanic Cloud/);
assert.match(galaxyCatalog, /Small Magellanic Cloud/);
assert.match(galaxyCatalog, /LOCAL_GROUP/);
assert.match(galaxyCatalog, /VIRGO_CLUSTER/);
assert.match(galaxyCatalog, /CMB_SHELL/);
assert.match(galaxyCatalog, /OBSERVABLE_UNIVERSE/);
assert.match(sky, /milky-way\.jpg/);
assert.match(sky, /andromeda\.png/);
assert.match(galaxy, /andromeda\.png|SKY_ASSETS/);
assert.ok(CONFIG.cameraFar > CONFIG.skyRadius);
assert.ok(CONFIG.solarMaxDistance < CONFIG.skyRadius);
assert.ok(CONFIG.maxDistance > CONFIG.solarMaxDistance);
assert.ok(CONFIG.cameraFar > CONFIG.maxDistance);

await stat(path.join(root, "vendor/three.module.min.js"));
await stat(path.join(root, "vendor/three.core.min.js"));
await stat(path.join(root, ".nojekyll"));
await stat(path.join(root, "assets/sky/milky-way.jpg"));
await stat(path.join(root, "assets/sky/andromeda.png"));
await stat(path.join(root, "assets/sky/cmb.jpg"));
await stat(path.join(root, "js/sky.js"));
await stat(path.join(root, "js/sky-catalog.js"));
await stat(path.join(root, "js/galaxy.js"));
await stat(path.join(root, "js/galaxy-catalog.js"));
await stat(path.join(root, "js/helpers.js"));
await stat(path.join(root, "docs/assets/helios-overview.webp"));
await stat(path.join(root, "docs/assets/helios-titan-rings.webp"));
await stat(path.join(root, "docs/assets/helios-constellations.webp"));
await stat(path.join(root, "docs/assets/helios-milky-way.webp"));
await stat(path.join(root, "docs/assets/helios-neighborhood.webp"));
await stat(path.join(root, "docs/assets/helios-local-group.webp"));
await stat(path.join(root, "docs/assets/helios-virgo.webp"));
await stat(path.join(root, "docs/assets/helios-web.webp"));
await stat(path.join(root, "docs/assets/helios-universe.webp"));
assert.match(await read("README.md"), /docs\/assets\/helios-overview\.webp/);
assert.match(await read("README.md"), /docs\/assets\/helios-milky-way\.webp/);
assert.match(await read("README.md"), /docs\/assets\/helios-local-group\.webp/);
assert.match(await read("README.md"), /docs\/assets\/helios-virgo\.webp/);
assert.match(await read("README.md"), /docs\/assets\/helios-web\.webp/);
assert.match(await read("README.md"), /docs\/assets\/helios-universe\.webp/);
assert.doesNotMatch(await read("README.md"), /helios-superclusters\.webp/);
assert.doesNotMatch(await read("README.md"), /You are here/);
assert.match(await read("README.md"), /Play Helios in your browser/);

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

const required = [
  "sun",
  "mercury",
  "venus",
  "earth",
  "moon",
  "mars",
  "phobos",
  "deimos",
  "ceres",
  "jupiter",
  "io",
  "europa",
  "ganymede",
  "callisto",
  "saturn",
  "titan",
  "uranus",
  "neptune",
  "triton",
  "pluto",
];
assert.deepEqual(BODIES.map((body) => body.id).sort(), [...required].sort());

for (const body of BODIES) {
  await stat(path.join(root, body.texture));
  if (body.ring) await stat(path.join(root, body.ring));
}
assert.match(findBodyTexture("phobos"), /assets\/textures\/phobos\.jpg/);
assert.match(findBodyTexture("deimos"), /assets\/textures\/deimos\.jpg/);

function findBodyTexture(id) {
  const body = BODIES.find((item) => item.id === id);
  assert.ok(body, id);
  return body.texture;
}

console.log("static-check ok");
