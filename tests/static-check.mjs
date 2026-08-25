import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

async function sha256(relative) {
  const content = await readFile(path.join(root, relative));
  return createHash("sha256").update(content).digest("hex");
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
const cosmicWeb = await read("js/cosmic-web.js");
const twoMrsData = await read("js/2mrs-data.js");
const helpers = await read("js/helpers.js");
const time = await read("js/time.js");
const version = (await read("VERSION.txt")).trim();
const license = await read("LICENSE");
const threeLicense = await read("vendor/THREE-LICENSE");
const threeMetadata = JSON.parse(await read("vendor/three-metadata.json"));
const packageJson = JSON.parse(await read("package.json"));
const packageLock = JSON.parse(await read("package-lock.json"));
const readme = await read("README.md");
const provenance = await read("PROVENANCE.md");
const agents = await read("AGENTS.md");
const auditWorkflow = await read(".github/workflows/ci.yml");
const pagesWorkflow = await read(".github/workflows/pages.yml");

assert.equal(version, CONFIG.VERSION);
assert.match(version, /^v\d{4}\.\d{1,2}\.\d{1,2}[a-z]$/);
assert.ok(readme.includes(`Version ${version}`));
assert.match(agents, /\*\*Project Engineering Standard:\*\* v1\.0/);
assert.match(agents, /\*\*Standard Status:\*\* adopting/);
assert.equal(packageJson.engines.node, "22.x");
assert.equal(packageJson.devDependencies.playwright, "1.62.1");
assert.equal(packageLock.packages[""].devDependencies.playwright, "1.62.1");
for (const workflow of [auditWorkflow, pagesWorkflow]) {
  for (const action of workflow.matchAll(/uses:\s*[^@\s]+@([^\s]+)/g)) {
    assert.match(action[1], /^[0-9a-f]{40}$/, action[0]);
  }
}
assert.match(pagesWorkflow, /cp index\.html styles\.css \.nojekyll LICENSE PROVENANCE\.md _site\//);
assert.match(pagesWorkflow, /cp -R assets js vendor _site\//);
assert.match(pagesWorkflow, /path: _site/);
assert.match(pagesWorkflow, /actions\/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9/);
assert.match(pagesWorkflow, /include-hidden-files: true/);
assert.match(html, /Content-Security-Policy/);
assert.match(html, /connect-src 'none'/);
assert.match(html, /id="play-button"/);
assert.match(html, /id="speed-slider"/);
assert.match(html, /id="zoom-out-button"/);
assert.match(html, /id="zoom-in-button"/);
assert.match(html, /id="keyboard-help"/);
assert.match(html, /id="dock"[^>]*tabindex="-1"/);
assert.match(html, /id="reset-button"/);
assert.match(html, /id="unsupported"[^>]*role="alert"[^>]*tabindex="-1"/);
assert.match(html, /href="\.\/PROVENANCE\.md"/);
assert.match(html, /Credits, licenses, and scientific provenance/);
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
assert.doesNotMatch(time, remote);
assert.match(html, /id="sky-control"/);
assert.match(html, /<select id="sky-mode" aria-label="Constellations">/);
assert.match(html, /value="off"[^>]*>Constellations: Off/);
assert.match(html, /value="major"[^>]*selected>Constellations: Major/);
assert.match(html, /value="all"[^>]*>Constellations: All/);
assert.doesNotMatch(html, /id="sky-mode"[^>]*aria-pressed/);
assert.match(html, /id="helper-orbit"/);
assert.match(html, /id="helper-axis"/);
assert.match(html, /id="helper-spin"/);
assert.match(app, /kuiperInnerAu/);
assert.match(app, /selectedId/);
assert.match(app, /visualBodyRadius/);
assert.match(
  app,
  /node\.tilt\.quaternion\.premultiply\(parentNode\.tilt\.quaternion\.clone\(\)\.invert\(\)\)/,
  "absolute moon axes must cancel an inherited parent-equatorial rotation",
);
assert.doesNotMatch(app, /https?:\/\//);
assert.doesNotMatch(bodies, /https?:\/\//);
assert.doesNotMatch(configSource, /https?:\/\//);
assert.doesNotMatch(skyCatalog, /https?:\/\//);
assert.doesNotMatch(galaxy, /https?:\/\//);
assert.doesNotMatch(helpers, /https?:\/\//);
assert.match(helpers, /keplerPathOffset/);
assert.doesNotMatch(helpers, /\bkeplerOffset\b/);
assert.match(html, /vendor\/three|js\/app\.js/);
assert.match(license, /MIT License/);
assert.match(threeLicense, /three\.js authors/);
assert.match(provenance, /MIT license covers first-party code only/);
assert.match(provenance, /not a live Horizons feed or a perturbation ephemeris/);
assert.match(provenance, /Dark Moons, Dark Rings/);
assert.match(provenance, /No inpainting or synthetic terrain/);
assert.match(provenance, /doi:10\.1093\/mnras\/staa1946/);
assert.match(galaxyCatalog, /doi:10\.1093\/mnras\/staa1946/);
assert.doesNotMatch(`${provenance}\n${galaxyCatalog}`, /staa1689/);
assert.match(css, /min-height: 44px/);
assert.match(
  css,
  /\.sky-label\[hidden\]\s*\{[^}]*display:\s*none/,
  "author CSS must preserve native hidden semantics for 44px body-label buttons",
);
assert.match(css, /--dock-clearance/);
assert.doesNotMatch(css, /\.speed-group\s*\{[^}]*overflow:\s*hidden/);
assert.doesNotMatch(css, /:hover\s*\{[^}]*display:\s*block/);
assert.doesNotMatch(css, /--gold|#e8c872/i);
assert.match(css, /--cyan:\s*#66f7ff/);
assert.match(css, /--void:\s*#02050c/);
assert.match(css, /--magenta:\s*#ff57d8/);
assert.equal(CONFIG.defaultDaysPerSecond, 1 / 86400);
assert.equal(CONFIG.minDaysPerSecond, 1 / 86400);
assert.match(html, /1 sec \/ sec/);
assert.doesNotMatch(html, /8 d \/ sec/);
assert.match(app, /PointLight/);
assert.match(app, /MeshStandardMaterial/);
assert.match(app, /ringInnerKm/);
assert.match(app, /emissiveMap: ringMap/);
assert.match(app, /saturnRingHighPhaseFactor/);
assert.match(configSource, /saturnRingHighPhaseLight: 0\.01/);
assert.doesNotMatch(app, /HemisphereLight/);
assert.doesNotMatch(app, /createStarfield/);
assert.match(app, /createCelestialSphere/);
assert.match(app, /createGalaxyLayer/);
assert.match(app, /solarMaxDistance/);
assert.match(app, /localGroupViewDistance/);
assert.match(app, /virgoViewDistance/);
assert.match(app, /webViewDistance/);
assert.match(app, /2MRS galaxy distribution/);
assert.doesNotMatch(app, /Seeded filaments and clusters/);
assert.match(app, /universeViewDistance/);
assert.match(app, /handoffViewDistance/);
assert.match(app, /galaxyLook === "solarfar"/);
assert.match(app, /galaxyLook === "tailsky"/);
assert.match(app, /galaxyLook === "growing"/);
assert.match(app, /handoffViewDistance\) \* 0\.90/);
assert.match(app, /galaxyLook === "disk"/);
assert.match(sky, /gl_PointSize = size \* brightness \* brightness/);
assert.match(app, /orreryScale/);
assert.match(app, /orbitLineOpacity/);
assert.match(app, /solarDebrisOpacity/);
assert.match(app, /ensureGalaxyLayer/);
assert.doesNotMatch(app, /warmExtraZoom|renderer\.compile/);
assert.match(app, /createGalaxyLayer\(THREE, \{ defer: true \}\)/);
assert.match(app, /advanceGalaxyLayer\(layer, GALAXY_IDLE_WORK_BUDGET\)/);
assert.match(app, /buildGalaxyLayerToDistance\(layer, distance\)/);
assert.match(app, /scheduleGalaxyWarmup\(true\)/);
assert.match(app, /GALAXY_IDLE_WORK_BUDGET = 2400/);
assert.match(app, /GALAXY_URGENT_TIME_BUDGET_MS = 24/);
assert.match(app, /lastRenderedControlDistance/);
assert.match(app, /let renderDirty = true/);
assert.match(app, /if \(dirty\) renderDirty = true/);
assert.match(app, /invalidateRender\(pendingGalaxyDistance == null\)/);
assert.match(app, /DefaultLoadingManager\.onProgress = invalidateAssetRender/);
assert.match(app, /TextureLoader\(\)\.load\(path, invalidateAssetRender\)/);
assert.match(app, /pendingGalaxyDistance == null \|\| renderDirty/);
assert.match(app, /heldFrameSkips \+= 1/);
assert.match(app, /if \(state\.playing \|\| cameraSettling\) invalidateRender\(false\)/);
assert.match(app, /height === measuredDockHeight/);
assert.equal((app.match(/requestAnimationFrame\(tick\)/g) ?? []).length, 1);
assert.match(app, /paintConstellations/);
assert.match(app, /ui\.skyControl\.hidden = !available/);
assert.match(app, /ui\.sky\.disabled = !available/);
assert.match(app, /constellationsAvailable\(state\.distance\)/);
assert.match(app, /setConstellationMode\(celestial, state\.constellationMode, available\)/);
assert.match(app, /ui\.sky\.addEventListener\("change", changeConstellationMode\)/);
assert.doesNotMatch(app, /showConstellations|toggleConstellations|aria-pressed[^\n]*ui\.sky/);
assert.match(app, /setCelestialFade/);
assert.match(app, /setSkyBandBrightness/);
assert.match(app, /attachFarGalaxySky/);
assert.doesNotMatch(app, /milkyWayTailSeat/, "no tail seat: orbit input stays live at every zoom");
assert.doesNotMatch(app, /extraZoomTailMix/);
assert.match(app, /pinchZoomDistance/);
assert.match(app, /wheelZoomMultiplier/);
assert.match(app, /clearSelection/);
assert.match(app, /function showUnsupported/);
assert.match(app, /ui\.version\.hidden = true/);
assert.match(app, /ui\.stage\.inert = true/);
assert.match(app, /ResizeObserver/);
assert.match(app, /renderer\.getPixelRatio\(\)/);
assert.match(app, /hidePlanets = scaleLayer\(state\.distance\) !== "solar"/);
assert.match(app, /camera\.updateMatrixWorld\(true\);[\s\S]*updateConstellationLabels/);
assert.ok(
  app.indexOf("camera.updateMatrixWorld(true);") < app.indexOf("projected.copy(world).project(camera)"),
  "camera world matrices refresh before DOM body-label projection",
);
const bodyLabelSuppressor = app.slice(
  app.indexOf("function suppressBodyLabelCollisions"),
  app.indexOf("function canShowLabel"),
);
assert.doesNotMatch(
  bodyLabelSuppressor,
  /\.sort\(|for \(const|labelRight \+|labelLeft -|labelBottom \+|labelTop -/,
  "body-label suppression uses strict overlap and allocation-free priority passes",
);
for (const rootName of ["sun.pivot", "asteroidBelt", "kuiperBelt", "orbitLines"]) {
  assert.ok(
    app.includes(`${rootName}.position.set(handoff.x, handoff.y, handoff.z);`),
    `${rootName} follows the one shared Solar handoff offset`,
  );
}
assert.match(html, /id="card-close"/);
assert.match(html, /aria-label="Close"/);
assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1/);
assert.match(css, /#card-close/);
assert.match(configSource, /pinchZoomDistance/);
assert.match(galaxy, /milkyWayInteriorCameraAim/);
assert.match(galaxy, /skyStaysOn/);
assert.match(galaxy, /export function skyStaysOn/);
assert.match(galaxy, /extraZoomCameraDistance/);
assert.match(galaxy, /responsiveExtraZoomCameraDistance/);
assert.match(galaxy, /extraZoomCameraNear/);
assert.match(app, /setStarBrightness/);
assert.match(app, /responsiveExtraZoomCameraDistance/);
assert.match(app, /extraZoomCameraNear/);
assert.match(sky, /setStarBrightness/);
assert.match(sky, /setSkyBandBrightness/);
assert.match(sky, /CELESTIAL_RENDER_THRESHOLD = 0\.04/);
assert.match(sky, /CONSTELLATION_MODES/);
assert.match(sky, /CONSTELLATION_LABEL_FALLBACK_HIPS/);
assert.match(sky, /selectConstellationLabelIds/);
assert.match(sky, /updateConstellationLabels/);
assert.match(sky, /createConstellationLabelWorkspace/);
const constellationUpdater = sky.slice(
  sky.indexOf("export function updateConstellationLabels"),
  sky.indexOf("export function setSkyBandBrightness"),
);
assert.doesNotMatch(
  constellationUpdater,
  /createElement\("canvas"\)|new THREE\.(CanvasTexture|SpriteMaterial|Sprite)/,
  "the per-frame All-label updater allocates no render resources",
);
assert.doesNotMatch(
  constellationUpdater,
  /new Set\(|const candidates = \[\]|\.filter\(/,
  "the live All-label updater reuses CPU working storage instead of replacing it",
);
for (const buffer of ["candidates", "retained", "selected"]) {
  assert.match(
    constellationUpdater,
    new RegExp(`${buffer}\\.(?:length = 0|clear\\(\\))`),
    `${buffer} working storage is cleared in place`,
  );
}
assert.match(app, /const constellationViewport = \{[^}]+\}/);
assert.match(app, /updateConstellationLabels\(celestial, camera, constellationViewport\)/);
assert.doesNotMatch(
  app.slice(app.indexOf("function updateLabels"), app.indexOf("function animate")),
  /updateConstellationLabels\([^;]+\{\s*width:/,
  "the animation hot path reuses its viewport options object",
);
assert.match(sky, /toneMapped:\s*false/);
assert.match(css, /\.labels[\s\S]*z-index:\s*1/);
assert.match(css, /\.constellation-control/);
assert.match(css, /\.constellation-control\[hidden\]/);
assert.match(css, /select:focus-visible/);
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
assert.match(galaxy, /generateFarGalaxySkySamples/);
assert.match(galaxy, /export function advanceGalaxyLayer/);
assert.match(galaxy, /export function buildGalaxyLayerToDistance/);
assert.match(galaxy, /export function galaxyLayerReadyForDistance/);
assert.match(galaxy, /createMilkyWayDiskMapJob/);
assert.match(galaxy, /advanceSpiralStarsJob/);
assert.match(galaxy, /far-galaxy-density/);
assert.doesNotMatch(galaxy, /CubeTexture|samplerCube|textureCube/);
assert.doesNotMatch(galaxy, /deep-field/);
assert.match(galaxy, /2mrs-galaxies/);
assert.match(cosmicWeb, /createTwoMrsSamples/);
assert.match(cosmicWeb, /createTwoMrsSampleJob/);
assert.match(cosmicWeb, /createCosmicDensityJob/);
assert.match(cosmicWeb, /seeded Voronoi-proximity/);
assert.match(twoMrsData, /NASA HEASARC TWOMASSRSC/);
assert.match(galaxy, /mw-disk-edge/);
assert.doesNotMatch(galaxy, /You are here/);
assert.doesNotMatch(galaxyCatalog, /SUPERCLUSTERS/);
assert.doesNotMatch(galaxyCatalog, /Perseus-Pisces/);
assert.match(galaxyCatalog, /Large Magellanic Cloud/);
assert.match(galaxyCatalog, /Small Magellanic Cloud/);
assert.match(galaxyCatalog, /LOCAL_GROUP/);
assert.match(galaxyCatalog, /VIRGO_CLUSTER/);
assert.match(galaxyCatalog, /POST_VIRGO_CLUSTERS/);
assert.match(galaxyCatalog, /CMB_SHELL/);
assert.match(galaxyCatalog, /PARTICLE_HORIZON/);
assert.match(sky, /milky-way\.jpg/);
assert.match(sky, /andromeda\.png/);
assert.match(galaxy, /andromeda\.png|SKY_ASSETS/);
assert.ok(CONFIG.cameraFar > CONFIG.skyRadius);
assert.ok(CONFIG.solarMaxDistance < CONFIG.skyRadius);
assert.ok(CONFIG.maxDistance > CONFIG.solarMaxDistance);
assert.ok(CONFIG.cameraFar > CONFIG.maxDistance);

await stat(path.join(root, "vendor/three.module.min.js"));
await stat(path.join(root, "vendor/three.core.min.js"));
await stat(path.join(root, "PROVENANCE.md"));
await stat(path.join(root, ".nojekyll"));
await stat(path.join(root, "assets/sky/milky-way.jpg"));
await stat(path.join(root, "assets/sky/andromeda.png"));
await stat(path.join(root, "assets/sky/cmb.jpg"));
await stat(path.join(root, "js/sky.js"));
await stat(path.join(root, "js/sky-catalog.js"));
await stat(path.join(root, "js/galaxy.js"));
await stat(path.join(root, "js/galaxy-catalog.js"));
await stat(path.join(root, "js/cosmic-web.js"));
await stat(path.join(root, "js/2mrs-data.js"));
await stat(path.join(root, "js/helpers.js"));
await stat(path.join(root, "js/time.js"));
await stat(path.join(root, "docs/assets/helios-overview.webp"));
await stat(path.join(root, "docs/assets/helios-titan-rings.webp"));
await stat(path.join(root, "docs/assets/helios-constellations.webp"));
await stat(path.join(root, "docs/assets/helios-solar-far.webp"));
await stat(path.join(root, "docs/assets/helios-milky-way.webp"));
await stat(path.join(root, "docs/assets/helios-tail-sky.webp"));
await stat(path.join(root, "docs/assets/helios-growing.webp"));
await stat(path.join(root, "docs/assets/helios-disk.webp"));
await stat(path.join(root, "docs/assets/helios-neighborhood.webp"));
await stat(path.join(root, "docs/assets/helios-preweb.webp"));
await stat(path.join(root, "docs/assets/helios-local-group.webp"));
await stat(path.join(root, "docs/assets/helios-virgo.webp"));
await stat(path.join(root, "docs/assets/helios-web.webp"));
await stat(path.join(root, "docs/assets/helios-universe.webp"));
assert.match(readme, /docs\/assets\/helios-overview\.webp/);
assert.match(readme, /docs\/assets\/helios-solar-far\.webp/);
assert.match(readme, /docs\/assets\/helios-milky-way\.webp/);
assert.match(readme, /docs\/assets\/helios-tail-sky\.webp/);
assert.match(readme, /docs\/assets\/helios-growing\.webp/);
assert.match(readme, /docs\/assets\/helios-disk\.webp/);
assert.match(readme, /docs\/assets\/helios-preweb\.webp/);
assert.match(readme, /docs\/assets\/helios-local-group\.webp/);
assert.match(readme, /docs\/assets\/helios-virgo\.webp/);
assert.match(readme, /docs\/assets\/helios-web\.webp/);
assert.match(readme, /docs\/assets\/helios-universe\.webp/);
assert.doesNotMatch(readme, /grow brighter|brightens that sky/);
assert.doesNotMatch(readme, /helios-superclusters\.webp/);
assert.doesNotMatch(readme, /You are here/);
assert.match(readme, /Play Helios in your browser/);

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
assert.equal(threeMetadata.version, "0.185.0");
assert.equal(threeMetadata.source, "https://registry.npmjs.org/three/-/three-0.185.0.tgz");
for (const entry of [threeMetadata.module, threeMetadata.core]) {
  assert.equal((await stat(path.join(root, entry.path))).size, entry.bytes);
  assert.equal(await sha256(entry.path), entry.sha256);
}
assert.equal(
  await sha256("assets/textures/triton.jpg"),
  "7962d4997fc8c8f47e7f54304174a565f59d3cc01e5de119329f59673c684ba9",
);

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
