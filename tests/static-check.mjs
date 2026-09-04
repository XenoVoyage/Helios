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
const repositoryStandard = await read("REPOSITORY_STANDARD.md");
const auditWorkflow = await read(".github/workflows/ci.yml");
const pagesWorkflow = await read(".github/workflows/pages.yml");
const issueTemplate = await read(".github/ISSUE_TEMPLATE/repository-issue.yml");
const issueConfig = await read(".github/ISSUE_TEMPLATE/config.yml");
const pullRequestTemplate = await read(".github/pull_request_template.md");

assert.equal(version, CONFIG.VERSION);
assert.match(version, /^v\d{4}\.\d{1,2}\.\d{1,2}[a-z]$/);
assert.ok(readme.includes(`Version ${version}`));
assert.match(agents, /\*\*Repository Standard:\*\* \[Repository Standard\]\(REPOSITORY_STANDARD\.md\)/);
assert.match(agents, /\*\*Standard Status:\*\* adopting/);
assert.match(agents, /`develop` is the\s+protected\s+long-lived \*\*Alpha Development\*\*/);
assert.match(agents, /`\[SEVERITY\]\[Area\] Imperative outcome`/);
for (const severity of ["CRITICAL", "HIGH", "MEDIUM", "LOW"]) {
  assert.match(agents, new RegExp(`\\b${severity}\\b`));
}
assert.match(agents, /Node 22 baseline/);
assert.match(agents, /Issue #44 exclusively owns Saturn's back-facing ring-shading correction/);
assert.match(readme, /\[Repository Standard\]\(REPOSITORY_STANDARD\.md\)/);
assert.match(provenance, /`AGENTS\.md` is the sole owner of Helios's Repository Standard status/);
assert.match(provenance, /provenance blockers contributing to its `adopting` state/);
assert.match(provenance, /hyg_v31\.csv\.gz/);
assert.match(provenance, /hyg_v34\.csv\.gz/);
assert.match(provenance, /CC BY-SA 2\.5/);
assert.match(provenance, /HIP 55203/);
assert.match(provenance, /HIP 7751/);
assert.match(provenance, /p Eridani/);
assert.match(provenance, /first non-empty `proper`/);
assert.match(
  provenance,
  /^The latest source evidence recorded in this ledger is dated 2026-09-03;\nsource-specific retrieval and check dates are recorded per entry when known\./m,
);
assert.match(provenance, /`round\(float\(ra\) \* 15, 5\)`/);
assert.match(provenance, /`round\(float\(dec\), 5\)`/);
assert.match(provenance, /`round\(float\(mag\), 2\)`/);
assert.match(provenance, /`round\(float\(ci\), 2\)`/);
assert.match(provenance, /IEEE-754 binary64/);
assert.match(provenance, /not exact-decimal half-even rounding/);
assert.doesNotMatch(provenance, /B-V is HYG `ci` quantized to 2 decimals/);
assert.doesNotMatch(provenance, /identical, field-for-field, to a first-HIP/);
assert.match(provenance, /600ce39342ee1452da5fdd9d9b7b8f51a1e1b5f7892abeace61f7c56f4382fce/);
assert.match(provenance, /b39c1d6dbab932bb624965241b6a13995886370781b9a398d0f1fb36d098b325/);
assert.match(provenance, /193dee77cbfef7179bf1eb6188cfdede9fd0d622760e4bc658ab775c1965c375/);
assert.match(provenance, /01736aeafecb7f5082c9d2bbed1c6bb36bb9ea6bc4c9ebb3429ed2e8a3a0a4e1/);
assert.match(provenance, /e504b4c96a10eca759157959b6b0b5ca2cbe33781ff980601ed3274e9b08da34/);
assert.match(provenance, /inherited image\s+transformation records/);
assert.doesNotMatch(
  provenance,
  /exact upstream HYG release and its matching license version were not retained/,
);
assert.match(readme, /v3\.1–v3\.4 \(CC BY-SA 2\.5\)/);
assert.match(readme, /Ceres's stored heliocentric state is one Horizons/);
assert.match(readme, /Neptune's six orbital elements are one JPL Approximate Positions Table 1/);
assert.doesNotMatch(readme, /not JPL Horizons or a perturbation ephemeris/);
assert.equal(
  await sha256("js/sky-catalog.js"),
  "e504b4c96a10eca759157959b6b0b5ca2cbe33781ff980601ed3274e9b08da34",
);
assert.match(repositoryStandard, /canonical, versionless standard/);
assert.match(repositoryStandard, /### New repository/);
assert.match(repositoryStandard, /### Existing repository/);
assert.match(repositoryStandard, /Do not keep\s+parallel new-project and existing-project prompt files/);
assert.match(repositoryStandard, /poll periodically for updates/);
assert.match(repositoryStandard, /explicit, documented owner exception/);
assert.match(repositoryStandard, /Use `\[SEVERITY\]\[Area\] Imperative outcome`/);
assert.match(repositoryStandard, /baseline commits and trees/);
assert.match(repositoryStandard, /latest suitable production-supported LTS line/);
assert.match(repositoryStandard, /known unresolved critical\s+vulnerability/);
assert.match(repositoryStandard, /Audit every direct dependency and the\s+relevant transitive graph/);
assert.match(repositoryStandard, /Bind required checks to their expected\s+trusted CI app or source/);
assert.match(repositoryStandard, /non-`main` default or production branch/);
assert.match(repositoryStandard, /direct-to-production\s+model/);
assert.match(repositoryStandard, /protected `develop` as\s+the long-lived pre-release branch/);
assert.match(repositoryStandard, /Update affected canonical documentation and intentional mirrors/);
assert.match(repositoryStandard, /owner-approved visual baseline/);
assert.match(repositoryStandard, /browser, WebGL/);
assert.match(repositoryStandard, /Audit the complete final diff and tree/);
assert.match(repositoryStandard, /unrelated behavior and data/);
const activeStandardFiles = [
  agents,
  repositoryStandard,
  readme,
  provenance,
  auditWorkflow,
  issueTemplate,
  pullRequestTemplate,
].join("\n");
assert.doesNotMatch(activeStandardFiles, /\bv1\.[01]\b/i);
assert.doesNotMatch(activeStandardFiles, /issue-74-standard-v1-1/i);
assert.doesNotMatch(activeStandardFiles, /authorized bootstrap|bootstrap exception/i);
assert.equal(packageJson.engines.node, "22.x");
assert.equal(packageJson.devDependencies.playwright, "1.62.1");
assert.equal(packageLock.packages[""].devDependencies.playwright, "1.62.1");
for (const workflow of [auditWorkflow, pagesWorkflow]) {
  for (const action of workflow.matchAll(/uses:\s*[^@\s]+@([^\s]+)/g)) {
    assert.match(action[1], /^[0-9a-f]{40}$/, action[0]);
  }
}
assert.match(auditWorkflow, /branches:\s*\[main, develop\]/g);
assert.equal((auditWorkflow.match(/branches:\s*\[main, develop\]/g) || []).length, 2);
assert.equal((auditWorkflow.match(/^  workflow_dispatch:\s*$/gm) || []).length, 1);
assert.match(
  auditWorkflow,
  /group:\s*audit-\$\{\{ github\.event_name \}\}-\$\{\{ github\.event_name == 'workflow_dispatch' && github\.run_id \|\| github\.ref \}\}/,
);
assert.match(auditWorkflow, /cancel-in-progress:\s*true/);
assert.match(
  auditWorkflow,
  /github\.event_name == 'workflow_dispatch' &&\s*github\.ref != 'refs\/heads\/main'/,
);
assert.match(auditWorkflow, /Manual audits are restricted to main\./);
assert.doesNotMatch(
  auditWorkflow,
  /group:\s*audit-\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}/,
);
assert.match(auditWorkflow, /github\.base_ref == 'main'/);
assert.match(auditWorkflow, /head\.repo\.full_name != github\.repository/);
assert.match(auditWorkflow, /github\.head_ref != 'develop'/);
assert.match(auditWorkflow, /startsWith\(github\.head_ref, 'hotfix\/'\)/);
assert.doesNotMatch(auditWorkflow, /issue-74|bootstrap/i);
assert.equal((pagesWorkflow.match(/branches:\s*\[main\]/g) || []).length, 1);
assert.doesNotMatch(pagesWorkflow, /branches:\s*\[[^\]]*develop/);
assert.match(issueTemplate, /title:\s*"\[SEVERITY\]\[Area\] "/);
assert.match(
  issueTemplate,
  /id:\s*effort[\s\S]*?validations:\s*\n\s*required:\s*true/,
);
for (const severity of ["CRITICAL", "HIGH", "MEDIUM", "LOW"]) {
  assert.match(issueTemplate, new RegExp(`\\b${severity}\\b`));
}
for (const field of [
  "Discovery baseline and environment",
  "Implementation base",
  "Production and visual baseline",
  "Expected and actual behavior",
  "Smallest scope and non-goals",
  "Dependencies and recommended order",
  "Acceptance criteria",
  "Verification and visual evidence",
  "Risks and rollback",
]) {
  assert.match(issueTemplate, new RegExp(field));
}
assert.match(issueConfig, /blank_issues_enabled:\s*false/);
assert.match(issueTemplate, /name:\s*Repository issue/);
assert.match(pullRequestTemplate, /issue branch → develop/);
assert.match(pullRequestTemplate, /develop → main release/);
assert.match(pullRequestTemplate, /hotfix\/\* → main/);
assert.match(pullRequestTemplate, /Candidate commit and tree/);
assert.match(pagesWorkflow, /cp index\.html styles\.css \.nojekyll LICENSE PROVENANCE\.md _site\//);
assert.match(pagesWorkflow, /cp -R assets js vendor _site\//);
assert.match(pagesWorkflow, /path: _site/);
assert.match(pagesWorkflow, /actions\/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9/);
assert.match(pagesWorkflow, /include-hidden-files: true/);
assert.match(html, /Content-Security-Policy/);
assert.match(html, /connect-src 'none'/);
assert.match(html, /id="play-button"/);
assert.match(html, /id="speed-slider"/);
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
assert.match(provenance, /not JPL Horizons ephemerides/);
assert.match(provenance, /JPL#48/);
assert.match(provenance, /DE441/);
assert.match(provenance, /2451545\.0 TDB/);
assert.match(provenance, /geometric osculating-element snapshot/);
assert.match(provenance, /Ecliptic of J2000\.0/);
assert.match(provenance, /469\.7 km/);
assert.match(provenance, /JPL Approximate Positions of the Planets/);
assert.match(provenance, /Table 1/);
assert.match(provenance, /1800 AD – 2050 AD/);
assert.match(provenance, /mean ecliptic and equinox of J2000/);
assert.match(provenance, /ω = ϖ − Ω/);
assert.match(provenance, /M = L − ϖ/);
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
assert.match(app, /minimumFocusDistance/);
assert.match(configSource, /minimumFocusDistance/);
assert.match(configSource, /focusSurfaceClearance/);
assert.match(configSource, /parentGlobeClearance/);
assert.match(configSource, /resolveParentGlobePoint/);
assert.match(app, /resolveParentGlobePoint/);
assert.doesNotMatch(app, /transitioned\.dot\(/, "plain flight coordinates use scalar math");
assert.match(app, /kind === "moon" && Boolean\(focused\.body\.parent\)/);
assert.match(app, /clearSelection/);
assert.match(app, /function showUnsupported/);
assert.match(app, /ui\.version\.hidden = true/);
assert.match(app, /ui\.stage\.inert = true/);
assert.match(app, /ResizeObserver/);
assert.match(app, /hidePlanets = scaleLayer\(state\.distance\) !== "solar"/);
assert.match(app, /camera\.updateMatrixWorld\(true\);[\s\S]*updateConstellationLabels/);
assert.ok(
  app.indexOf("camera.updateMatrixWorld(true);") < app.indexOf("projected.copy(world).project(camera)"),
  "camera world matrices refresh before DOM body-label projection",
);
for (const rootName of ["sun.pivot", "asteroidBelt", "kuiperBelt", "orbitLines"]) {
  assert.ok(
    app.includes(`${rootName}.position.set(handoff.x, handoff.y, handoff.z);`),
    `${rootName} follows the one shared Solar handoff offset`,
  );
}
assert.match(html, /id="card-close"/);
assert.match(html, /aria-label="Close"/);
assert.match(html, /id="viewport"[^>]*role="img"[^>]*aria-label="Helios scene"/);
assert.match(html, /aria-describedby="scene-context"/);
assert.doesNotMatch(html, /Interactive solar system/);
assert.match(html, /id="scene-context"[^>]*class="visually-hidden"/);
assert.match(html, /id="status-live"[^>]*aria-live="polite"/);
assert.match(app, /sceneHierarchyId/);
assert.match(app, /paintSceneSemantics/);
assert.match(app, /ui\.sceneContext/);
assert.doesNotMatch(app, /lastScaleLayer/);
assert.match(galaxy, /export function sceneHierarchyId/);
assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1/);
assert.match(css, /#card-close/);
assert.match(configSource, /pinchZoomDistance/);
assert.match(galaxy, /milkyWayInteriorCameraAim/);
assert.match(galaxy, /skyStaysOn/);
assert.match(galaxy, /export function skyStaysOn/);
assert.match(galaxy, /extraZoomCameraDistance/);
assert.match(galaxy, /extraZoomCameraNear/);
assert.match(app, /setStarBrightness/);
assert.match(app, /extraZoomCameraDistance/);
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
assert.match(galaxy, /far-galaxy-density/);
assert.doesNotMatch(galaxy, /CubeTexture|samplerCube|textureCube/);
assert.doesNotMatch(galaxy, /deep-field/);
assert.match(galaxy, /2mrs-galaxies/);
assert.match(cosmicWeb, /createTwoMrsSamples/);
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
await stat(path.join(root, "REPOSITORY_STANDARD.md"));
await assert.rejects(
  () => stat(path.join(root, ".github/ISSUE_TEMPLATE/engineering-issue.yml")),
  (error) => error?.code === "ENOENT",
  "the retired engineering issue form must not coexist with the Repository issue form",
);
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
