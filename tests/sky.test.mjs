import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "../js/config.js";
import {
  ANDROMEDA,
  CONSTELLATION_LINES,
  MAJOR_CONSTELLATIONS,
  STARS,
} from "../js/sky-catalog.js";
import {
  CELESTIAL_RENDER_THRESHOLD,
  CONSTELLATION_LABEL_FALLBACK_HIPS,
  CONSTELLATION_LAYOUT,
  CONSTELLATION_MODES,
  CONSTELLATION_STAR_BOOST,
  GALACTIC_NGP_DEC_DEG,
  GALACTIC_NGP_RA_DEG,
  celestialLayerRenderable,
  constellationAnchor,
  constellationAnchorHips,
  constellationHasStar,
  constellationLabelBudget,
  constellationLabelFitsViewport,
  constellationLabelPixelHeight,
  createConstellationLabelWorkspace,
  equatorialToGalactic,
  equatorialToScene,
  findConstellation,
  findStarByHip,
  findStarByName,
  galacticToScene,
  galacticToUv,
  isConstellationLineStar,
  normalizeConstellationMode,
  selectConstellationLabelIds,
  setConstellationMode,
  sizeFromMag,
  updateConstellationLabels,
} from "../js/sky.js";

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

test("named stars have sane J2000 RA/Dec and magnitudes", () => {
  const sirius = findStarByName("Sirius");
  const betelgeuse = findStarByName("Betelgeuse");
  const rigel = findStarByName("Rigel");
  const vega = findStarByName("Vega");
  const polaris = findStarByName("Polaris");
  const alpharatz = findStarByName("Alpheratz");

  assert.ok(sirius && betelgeuse && rigel && vega && polaris && alpharatz);
  assert.equal(sirius.hip, 32349);
  assert.ok(sirius.raDeg > 100.8 && sirius.raDeg < 101.8);
  assert.ok(sirius.decDeg > -17.2 && sirius.decDeg < -16.3);
  assert.ok(sirius.mag < -1);

  assert.ok(betelgeuse.raDeg > 88.3 && betelgeuse.raDeg < 89.3);
  assert.ok(betelgeuse.decDeg > 7.0 && betelgeuse.decDeg < 7.8);
  assert.ok(rigel.raDeg > 78.2 && rigel.raDeg < 79.1);
  assert.ok(rigel.decDeg > -8.7 && rigel.decDeg < -7.7);

  assert.ok(vega.raDeg > 278.7 && vega.raDeg < 279.8);
  assert.ok(vega.decDeg > 38.3 && vega.decDeg < 39.3);
  assert.ok(polaris.decDeg > 89.0);
  assert.ok(alpharatz.raDeg > 1.5 && alpharatz.raDeg < 2.7);
  assert.ok(alpharatz.decDeg > 28.5 && alpharatz.decDeg < 29.6);
});

test("IAU stick figures connect the right bright stars", () => {
  assert.equal(CONSTELLATION_LINES.length, 88);
  assert.equal(findConstellation("Ori").name, "Orion");
  assert.ok(constellationHasStar("Ori", findStarByName("Betelgeuse").hip));
  assert.ok(constellationHasStar("Ori", findStarByName("Rigel").hip));
  assert.ok(constellationHasStar("UMa", findStarByHip(54061).hip));
  assert.ok(constellationHasStar("UMa", findStarByHip(67301).hip));
  assert.ok(constellationHasStar("Cas", 8886));
  assert.ok(constellationHasStar("And", findStarByName("Alpheratz").hip));
  assert.equal(findConstellation("And").name, "Andromeda");
});

test("Andromeda sits in Andromeda at the catalog M31 position", () => {
  assert.equal(ANDROMEDA.constellation, "And");
  assert.equal(ANDROMEDA.messier, "M31");
  assert.ok(ANDROMEDA.raDeg > 10.4 && ANDROMEDA.raDeg < 11.0);
  assert.ok(ANDROMEDA.decDeg > 40.9 && ANDROMEDA.decDeg < 41.6);

  const andromeda = findConstellation("And");
  const stars = andromeda.paths.flat().map((hip) => findStarByHip(hip)).filter(Boolean);
  assert.ok(stars.length >= 6);
  const ras = stars.map((star) => ((star.raDeg + 180) % 360) - 180);
  const decs = stars.map((star) => star.decDeg);
  const minRa = Math.min(...ras);
  const maxRa = Math.max(...ras);
  const minDec = Math.min(...decs);
  const maxDec = Math.max(...decs);
  const m31Ra = ((ANDROMEDA.raDeg + 180) % 360) - 180;
  assert.ok(m31Ra > minRa - 15 && m31Ra < maxRa + 15);
  assert.ok(ANDROMEDA.decDeg > minDec - 10 && ANDROMEDA.decDeg < maxDec + 10);
});

test("galactic equator and Andromeda map onto the Milky Way texture", () => {
  const gc = equatorialToGalactic(266.4051, -28.936175);
  assert.ok(Math.abs(gc.lDeg) < 0.4 || Math.abs(gc.lDeg - 360) < 0.4);
  assert.ok(Math.abs(gc.bDeg) < 0.4);
  const gcUv = galacticToUv(gc.lDeg, gc.bDeg);
  assert.ok(Math.abs(gcUv.u - 0.5) < 0.01);
  assert.ok(Math.abs(gcUv.v - 0.5) < 0.01);

  const m31 = equatorialToGalactic(ANDROMEDA.raDeg, ANDROMEDA.decDeg);
  assert.ok(m31.lDeg > 120 && m31.lDeg < 122.5);
  assert.ok(m31.bDeg > -22.2 && m31.bDeg < -20.8);
  assert.ok(Math.abs(m31.bDeg) > 15, "Andromeda is off the galactic plane");
});

test("equatorial J2000 lands on the orrery ecliptic axes", () => {
  const equinox = equatorialToScene(0, 0);
  assert.ok(Math.abs(equinox.x - 1) < 1e-9);
  assert.ok(Math.abs(equinox.y) < 1e-9);
  assert.ok(Math.abs(equinox.z) < 1e-9);

  const eclipticNorth = equatorialToScene(270, 90 - 23.43927944);
  assert.ok(eclipticNorth.y > 0.999, "ecliptic north is +Y");
  assert.ok(Math.abs(eclipticNorth.x) < 0.02);
  assert.ok(Math.abs(eclipticNorth.z) < 0.02);
});

test("IAU Galactic axes form a right-handed J2000 scene frame", () => {
  const x = galacticToScene(1, 0, 0);
  const y = galacticToScene(0, 1, 0);
  const z = galacticToScene(0, 0, 1);
  for (const axis of [x, y, z]) {
    assert.ok(Math.abs(dot(axis, axis) - 1) < 1e-12, "axis stays unit length");
  }
  assert.ok(Math.abs(dot(x, y)) < 1e-12);
  assert.ok(Math.abs(dot(x, z)) < 1e-12);
  assert.ok(Math.abs(dot(y, z)) < 1e-12);
  const crossXY = {
    x: x.y * y.z - x.z * y.y,
    y: x.z * y.x - x.x * y.z,
    z: x.x * y.y - x.y * y.x,
  };
  assert.ok(dot(crossXY, z) > 1 - 1e-12, "basis determinant is +1");

  const galacticCenter = equatorialToScene(266.4049948, -28.936174);
  const northPole = equatorialToScene(GALACTIC_NGP_RA_DEG, GALACTIC_NGP_DEC_DEG);
  assert.ok(dot(x, galacticCenter) > 1 - 1e-12, "Galactic +X is the J2000 center");
  assert.ok(dot(z, northPole) > 1 - 1e-12, "Galactic +Z is the J2000 north pole");
});

test("catalog is a few thousand brightest Hipparcos stars and the far plane clears the sky", () => {
  assert.ok(STARS.length > 3000 && STARS.length < 8000);
  assert.ok(STARS.every((row) => row[0] > 0 && Number.isFinite(row[1]) && Number.isFinite(row[2])));
  assert.ok(CONFIG.cameraFar > CONFIG.skyRadius);
  assert.equal(CONFIG.VERSION, "v2026.8.23a");
});

test("constellation names stay readable at overview", () => {
  assert.equal(CONSTELLATION_LINES.length, 88);
  assert.equal(MAJOR_CONSTELLATIONS.length, 10);
  assert.ok(MAJOR_CONSTELLATIONS.every((id) => findConstellation(id)));
  assert.ok(constellationLabelPixelHeight() > 22);
  assert.ok(constellationLabelPixelHeight(800, 52) > 16);
  for (const id of MAJOR_CONSTELLATIONS) {
    const legacyHips = findConstellation(id).paths.flat().filter((hip) => findStarByHip(hip));
    assert.deepEqual(
      constellationAnchorHips(id),
      legacyHips,
      `${id} keeps the original duplicate-weighted Major anchor inputs`,
    );
  }
});

test("all 88 constellations have deterministic label anchors", () => {
  assert.equal(new Set(CONSTELLATION_LINES.map((item) => item.id)).size, 88);
  assert.deepEqual(CONSTELLATION_LABEL_FALLBACK_HIPS.Men, [29271]);
  assert.deepEqual(CONSTELLATION_LABEL_FALLBACK_HIPS.Mic, [102831]);
  for (const constellation of CONSTELLATION_LINES) {
    const hips = constellationAnchorHips(constellation.id);
    const anchor = constellationAnchor(constellation.id);
    assert.ok(hips.length > 0, `${constellation.id} has an anchor star`);
    assert.ok(anchor, `${constellation.id} has a scene anchor`);
    assert.ok([anchor.x, anchor.y, anchor.z].every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(anchor.x, anchor.y, anchor.z) - 1) < 1e-12);
    if (!Object.hasOwn(CONSTELLATION_LABEL_FALLBACK_HIPS, constellation.id)) {
      assert.ok(constellation.paths.flat().length > 0, `${constellation.id} uses its figure`);
    }
  }
});

test("constellation mode and celestial availability share explicit semantics", () => {
  assert.equal(CELESTIAL_RENDER_THRESHOLD, 0.04);
  assert.equal(celestialLayerRenderable(0.04), false);
  assert.equal(celestialLayerRenderable(0.040001), true);
  assert.equal(celestialLayerRenderable(Number.NaN), false);
  assert.equal(normalizeConstellationMode(true), CONSTELLATION_MODES.major);
  assert.equal(normalizeConstellationMode(false), CONSTELLATION_MODES.off);
  for (const mode of Object.values(CONSTELLATION_MODES)) {
    assert.equal(normalizeConstellationMode(mode), mode);
  }
  assert.equal(normalizeConstellationMode("unexpected"), CONSTELLATION_MODES.major);

  const lines = { visible: true };
  const labels = {
    visible: true,
    userData: {},
    children: [
      { visible: true, userData: { majorRank: 0 } },
      { visible: true, userData: { majorRank: -1 } },
    ],
  };
  const sky = {
    userData: {},
    getObjectByName(name) {
      return name === "constellation-lines" ? lines : labels;
    },
  };
  setConstellationMode(sky, CONSTELLATION_MODES.off, true);
  assert.equal(lines.visible, false);
  assert.equal(labels.visible, false);
  assert.ok(labels.children.every((sprite) => !sprite.visible));
  setConstellationMode(sky, CONSTELLATION_MODES.major, true);
  assert.equal(lines.visible, true);
  assert.equal(labels.visible, true);
  assert.deepEqual(labels.children.map((sprite) => sprite.visible), [true, false]);
  setConstellationMode(sky, CONSTELLATION_MODES.all, true);
  assert.equal(lines.visible, true);
  assert.equal(labels.visible, true);
  assert.ok(labels.children.every((sprite) => !sprite.visible), "All defers names to packing");
  setConstellationMode(sky, CONSTELLATION_MODES.all, false);
  assert.equal(lines.visible, false);
  assert.equal(labels.visible, false);
  assert.equal(sky.userData.constellationMode, CONSTELLATION_MODES.all);
});

test("All-mode label budgets are responsive and bounded", () => {
  assert.equal(constellationLabelBudget(1440, 900), 16);
  assert.equal(constellationLabelBudget(390, 844), 4);
  assert.equal(constellationLabelBudget(568, 320), 4);
  assert.equal(constellationLabelBudget(844, 390), 4);
  for (let width = 240; width <= 2560; width += 137) {
    for (let height = 240; height <= 1440; height += 131) {
      const budget = constellationLabelBudget(width, height);
      assert.ok(budget >= 4 && budget <= 18);
    }
  }
});

test("Major labels hide only when visible ink crosses a raw viewport edge", () => {
  const candidate = (x, y, width = 80, height = 24, eligible = true) => ({
    x, y, width, height, eligible,
  });
  const viewport = { width: 800, height: 400, topInset: 40, bottomInset: 60 };
  assert.equal(constellationLabelFitsViewport(candidate(200, 150), viewport), true);
  assert.equal(constellationLabelFitsViewport(candidate(20, 150), viewport), false, "left edge clips");
  assert.equal(constellationLabelFitsViewport(candidate(780, 150), viewport), false, "right edge clips");
  assert.equal(constellationLabelFitsViewport(candidate(200, 6), viewport), false, "top edge clips");
  assert.equal(constellationLabelFitsViewport(candidate(200, 394), viewport), false, "bottom edge clips");
  assert.equal(constellationLabelFitsViewport(candidate(-100, 150), viewport), true, "offscreen stays baseline-visible");
  assert.equal(constellationLabelFitsViewport(candidate(200, 150, 80, 24, false), viewport), true);
});

test("Major-mode live layout only hides clipped labels and does not pack them", () => {
  const vector = () => ({
    x: 0,
    y: 0,
    z: 0,
    copy(other) {
      this.x = other.x;
      this.y = other.y;
      this.z = other.z;
      return this;
    },
    applyMatrix4() { return this; },
    project() {
      this.z = 0;
      return this;
    },
  });
  const sprite = (id, x, majorRank) => ({
    visible: true,
    scale: { x: 1, y: 0.4 },
    getWorldPosition(target) {
      target.x = x;
      target.y = 0;
      target.z = -10;
      return target;
    },
    userData: {
      constellationId: id,
      majorRank,
      inkWidthRatio: 0.8,
      world: vector(),
      cameraSpace: vector(),
      projected: vector(),
      layoutCandidate: {
        id,
        majorRank,
        catalogRank: 0,
        retained: false,
        eligible: false,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      },
    },
  });
  const overlappingA = sprite("Ori", 0, 0);
  const overlappingB = sprite("UMa", 0, 1);
  const clipped = sprite("Sco", -0.99, 2);
  const minor = sprite("Men", 0.5, -1);
  const labels = {
    visible: true,
    userData: { layoutWorkspace: createConstellationLabelWorkspace() },
    children: [overlappingA, overlappingB, clipped, minor],
  };
  const sky = {
    userData: { constellationMode: CONSTELLATION_MODES.major },
    getObjectByName(name) {
      return name === "constellation-labels" ? labels : null;
    },
  };
  const selected = updateConstellationLabels(
    sky,
    { fov: 52, near: 0.1, matrixWorldInverse: {} },
    { width: 800, height: 400, topInset: 40, bottomInset: 60 },
  );
  assert.deepEqual(selected, ["Ori", "UMa"], "overlapping Major labels keep their legacy visibility");
  assert.deepEqual(
    labels.children.map((label) => label.visible),
    [true, true, false, false],
    "only the clipped Major and the non-Major label are hidden",
  );
});

test("All-mode label packing is deterministic, clipped, prioritized, and collision-free", () => {
  const candidate = (id, x, y, {
    majorRank = -1,
    catalogRank = 0,
    retained = false,
    eligible = true,
    width = 80,
    height = 24,
  } = {}) => ({
    id, x, y, majorRank, catalogRank, retained, eligible, width, height,
  });
  const rows = [
    candidate("minor-new", 200, 150, { catalogRank: 1 }),
    candidate("major", 200, 150, { majorRank: 0, catalogRank: 7 }),
    candidate("minor-retained", 330, 150, { catalogRank: 8, retained: true }),
    candidate("minor-next", 460, 150, { catalogRank: 2 }),
    candidate("behind", 600, 150, { catalogRank: 3, eligible: false }),
    candidate("edge", 20, 150, { catalogRank: 4 }),
  ];
  const options = { width: 800, height: 400, topInset: 40, bottomInset: 60, budget: 3 };
  const selected = selectConstellationLabelIds(rows, options);
  assert.deepEqual(selected, ["major", "minor-retained", "minor-next"]);
  assert.deepEqual(
    selectConstellationLabelIds([...rows].reverse(), options),
    selected,
    "catalog ranking, not input order, controls the result",
  );
  assert.equal(selected.includes("minor-new"), false, "Major displaces a colliding minor");
  assert.equal(selected.includes("behind"), false, "ineligible projections stay hidden");
  assert.equal(selected.includes("edge"), false, "partially clipped labels stay hidden");

  const retainedCollision = [
    candidate("new-higher-catalog", 300, 150, { catalogRank: 0 }),
    candidate("retained-lower-catalog", 300, 150, { catalogRank: 80, retained: true }),
  ];
  assert.deepEqual(
    selectConstellationLabelIds(retainedCollision, options),
    ["retained-lower-catalog"],
    "a retained minor keeps its seat ahead of a newly entering colliding minor",
  );

  const spaced = [
    candidate("a", 100, 120, { catalogRank: 0, width: 60 }),
    candidate("b", 220, 120, { catalogRank: 1, width: 60 }),
    candidate("c", 340, 120, { catalogRank: 2, width: 60 }),
  ];
  assert.deepEqual(
    selectConstellationLabelIds(spaced, { width: 500, height: 300, topInset: 0, bottomInset: 0, budget: 2 }),
    ["a", "b"],
    "the centralized budget is enforced",
  );
});

test("All-mode live layout reuses candidate, packing, rectangle, and Set storage", () => {
  let viewShift = 0;
  const vector = () => ({
    x: 0,
    y: 0,
    z: 0,
    copy(other) {
      this.x = other.x;
      this.y = other.y;
      this.z = other.z;
      return this;
    },
    applyMatrix4() { return this; },
    project() {
      this.x += viewShift;
      this.z = 0;
      return this;
    },
  });
  const sprite = (id, x, majorRank, catalogRank) => ({
    visible: false,
    scale: { x: 1, y: 0.4 },
    getWorldPosition(target) {
      target.x = x;
      target.y = 0;
      target.z = -10;
      return target;
    },
    userData: {
      constellationId: id,
      inkWidthRatio: 0.8,
      world: vector(),
      cameraSpace: vector(),
      projected: vector(),
      layoutCandidate: {
        id,
        majorRank,
        catalogRank,
        retained: false,
        eligible: false,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      },
    },
  });
  const workspace = createConstellationLabelWorkspace();
  const references = {
    candidates: workspace.candidates,
    ordered: workspace.ordered,
    accepted: workspace.accepted,
    rects: workspace.rects,
    firstRect: workspace.rects[0],
    retained: workspace.retained,
    selected: workspace.selected,
    options: workspace.options,
    viewport: workspace.viewport,
  };
  const labels = {
    visible: true,
    userData: { layoutWorkspace: workspace },
    children: [
      sprite("Ori", -0.5, 0, 0),
      sprite("Men", 0.5, -1, 50),
    ],
  };
  const sky = {
    userData: { constellationMode: CONSTELLATION_MODES.all },
    getObjectByName(name) {
      return name === "constellation-labels" ? labels : null;
    },
  };
  const camera = { fov: 52, near: 0.1, matrixWorldInverse: {} };
  const viewport = { width: 800, height: 400, topInset: 40, bottomInset: 60 };

  const first = updateConstellationLabels(sky, camera, viewport);
  assert.strictEqual(first, references.accepted);
  assert.deepEqual(first, ["Ori", "Men"]);
  assert.deepEqual([...workspace.retained], ["Men"]);
  assert.deepEqual([...workspace.selected], ["Ori", "Men"]);
  const rectCount = workspace.rects.length;

  for (let frame = 1; frame <= 256; frame += 1) {
    viewShift = frame % 2 === 0 ? 0.012 : -0.012;
    const current = updateConstellationLabels(sky, camera, viewport);
    assert.strictEqual(current, first, "the accepted result array is the live reusable buffer");
    for (const [name, reference] of Object.entries(references)) {
      if (name === "firstRect") continue;
      assert.strictEqual(workspace[name], reference, `${name} storage keeps its identity`);
    }
    assert.strictEqual(workspace.rects[0], references.firstRect, "rectangle objects are reused");
    assert.equal(workspace.rects.length, rectCount, "the bounded live layout grows no rectangle pool");
    assert.deepEqual(current, ["Ori", "Men"], "camera motion preserves deterministic selection");
  }
  assert.equal(workspace.rects.length, CONSTELLATION_LAYOUT.maxBudget);
});

test("faint backdrop stars densify the solar sky without touching the catalog", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const source = await readFile(path.join(root, "js/sky.js"), "utf8");
  assert.ok(CONFIG.skyFaintStarCount > 4000, "enough dressing stars to read as a universe");
  assert.match(source, /createFaintStars/);
  assert.match(source, /faint-stars/);
  assert.match(
    source,
    /seedRandom/,
    "backdrop stars are seeded and deterministic, not Math.random",
  );
  assert.doesNotMatch(
    source,
    /skyFaintStarCount[^\n]*distance/,
    "backdrop star count never depends on camera distance",
  );
  // The catalog stars stay the only Hipparcos claim; the backdrop layer
  // carries no hip ids and never touches the star shader's brightness.
  assert.match(source, /dressing only/i);
});

test("constellation-figure stars outshine the field and nothing ramps with zoom", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const source = await readFile(path.join(root, "js/sky.js"), "utf8");
  assert.ok(isConstellationLineStar(findStarByName("Betelgeuse").hip));
  assert.ok(isConstellationLineStar(findStarByName("Rigel").hip));
  assert.ok(isConstellationLineStar(findStarByName("Alpheratz").hip));
  const members = new Set(CONSTELLATION_LINES.flatMap((item) => item.paths.flat()));
  const field = STARS.find((row) => !members.has(row[0]));
  assert.ok(field, "the catalog keeps field stars outside the stick figures");
  assert.equal(isConstellationLineStar(field[0]), false);
  assert.ok(CONSTELLATION_STAR_BOOST.size > 1, "figure stars are larger than the field");
  assert.ok(CONSTELLATION_STAR_BOOST.shade > 1, "figure stars are brighter than the field");
  // Same magnitude, figure membership wins: the drawn sky reads.
  assert.ok(sizeFromMag(2) * CONSTELLATION_STAR_BOOST.size > sizeFromMag(2));
  // Regression: the solar-sky raise is static values only. No star size,
  // shade, or faint-layer opacity may depend on camera distance; the old
  // zoom-out brighten ramp stays dead.
  assert.match(source, /isConstellationLineStar/);
  assert.doesNotMatch(source, /shade[^\n]*distance/);
  assert.doesNotMatch(source, /opacity[^\n]*distance/);
  assert.doesNotMatch(source, /size[^\n]*distance/);
  // The band keeps the constant solar look: brightness 0.82 at every zoom.
  assert.match(source, /brightness: \{ value: 0\.82 \}/);
});
