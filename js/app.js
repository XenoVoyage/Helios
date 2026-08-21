import * as THREE from "../vendor/three.module.min.js";
import { CONFIG, formatDaysPerSecond, pinchZoomDistance, wheelZoomMultiplier } from "./config.js";
import {
  BODIES,
  describeBody,
  findBody,
  keplerOffset,
  ringTextureU,
  visualBodyRadius,
  visualOrbit,
  visualRingRadius,
} from "./bodies.js";
import {
  attachSkyToCamera,
  createCelestialSphere,
  placeCameraForSkyLook,
  setCelestialFade,
  setConstellationsVisible,
  setSkyBandBrightness,
  wantsEarthSkyLook,
} from "./sky.js";
import {
  bindFocusHelpers,
  createFocusHelpers,
  setHelperVisibility,
} from "./helpers.js";
import {
  attachFarGalaxySky,
  celestialSkyOpacity,
  createGalaxyLayer,
  galaxyOpacity,
  localGroupCameraAim,
  milkyWayBelowCameraAim,
  milkyWayEdgeCameraAim,
  milkyWayInteriorCameraAim,
  neighborhoodCameraAim,
  orbitLineOpacity,
  orreryScale,
  requestedGalaxyLook,
  scaleLayer,
  setGalaxyLayerVisible,
  skyBandBrightness,
  skyStaysOn,
  solarOpacity,
  universeCameraAim,
  virgoCameraAim,
  webCameraAim,
} from "./galaxy.js";

const DEG = Math.PI / 180;
const pointerIds = new Map();
const ndc = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const world = new THREE.Vector3();
const projected = new THREE.Vector3();
const focusPoint = new THREE.Vector3();
const desiredTarget = new THREE.Vector3();

const state = {
  days: 0,
  playing: true,
  daysPerSecond: CONFIG.defaultDaysPerSecond,
  focusedId: "sun",
  selectedId: null,
  showConstellations: true,
  showOrbitHelper: false,
  showAxisHelper: false,
  showSpinHelper: false,
  azimuth: CONFIG.cameraAzimuth,
  elevation: CONFIG.cameraElevation,
  distance: CONFIG.cameraDistance,
  tap: null,
  pinching: false,
  pinchStart: 0,
  pinchDistance: CONFIG.cameraDistance,
};

const ui = {};
const nodes = new Map();
let renderer;
let scene;
let camera;
let celestial;
let asteroidBelt;
let kuiperBelt;
let orbitLines;
let galaxy;
let helpers;
let lastStamp = 0;
const earthSkyLook = wantsEarthSkyLook();

function $(id) {
  return document.getElementById(id);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function seedRandom(seed) {
  let n = seed >>> 0;
  return () => {
    n = (n + 0x6d2b79f5) | 0;
    let t = Math.imul(n ^ (n >>> 15), 1 | n);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function boot() {
  ui.viewport = $("viewport");
  ui.labels = $("labels");
  ui.clock = $("clock");
  ui.play = $("play-button");
  ui.slower = $("slower-button");
  ui.faster = $("faster-button");
  ui.speed = $("speed-slider");
  ui.speedReadout = $("speed-readout");
  ui.reset = $("reset-button");
  ui.card = $("body-card");
  ui.cardName = $("card-name");
  ui.cardKind = $("card-kind");
  ui.cardMeta = $("card-meta");
  ui.cardClose = $("card-close");
  ui.sky = $("sky-button");
  ui.helperOrbit = $("helper-orbit");
  ui.helperAxis = $("helper-axis");
  ui.helperSpin = $("helper-spin");
  ui.status = $("status-live");
  ui.unsupported = $("unsupported");
  ui.version = $("version-label");

  ui.version.textContent = CONFIG.VERSION;
  paintSpeed();
  paintClock();
  paintSkyButton();
  paintCard();

  try {
    if (!createRenderer()) throw new Error("WebGL unavailable");
  } catch {
    ui.unsupported.hidden = false;
    return;
  }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02050c);
  camera = new THREE.PerspectiveCamera(52, 1, 0.05, CONFIG.cameraFar);
  celestial = createCelestialSphere(THREE);
  scene.add(celestial);
  galaxy = createGalaxyLayer(THREE);
  scene.add(galaxy);
  asteroidBelt = createBeltField({
    count: CONFIG.beltCount,
    innerAu: CONFIG.beltInnerAu,
    outerAu: CONFIG.beltOuterAu,
    height: 1.8,
    color: 0xb7b3a8,
    size: 0.1,
    opacity: 0.7,
    seed: 88421,
  });
  kuiperBelt = createBeltField({
    count: CONFIG.kuiperCount,
    innerAu: CONFIG.kuiperInnerAu,
    outerAu: CONFIG.kuiperOuterAu,
    height: 16,
    color: 0x7f8ca3,
    size: 0.16,
    opacity: 0.48,
    seed: 11973,
  });
  orbitLines = new THREE.Group();
  orbitLines.name = "orbit-lines";
  scene.add(asteroidBelt);
  scene.add(kuiperBelt);
  scene.add(orbitLines);
  helpers = createFocusHelpers(THREE);
  scene.add(helpers.group);
  // Faint fill so the night side is readable. Day, night, and terminator
  // come from the Sun point light, not from this ambient.
  scene.add(new THREE.AmbientLight(0x1a2436, 0.025));
  const sunLight = new THREE.PointLight(0xfff1d4, 14, 0, 0);
  sunLight.position.set(0, 0, 0);
  scene.add(sunLight);

  for (const body of BODIES) {
    nodes.set(body.id, createBodyNode(body));
  }
  for (const body of BODIES) {
    const node = nodes.get(body.id);
    if (body.parent) {
      const parentNode = nodes.get(body.parent);
      // Moons follow the parent's equatorial plane so Titan stays in the
      // ring plane instead of punching through a tilted disc.
      const attach = body.kind === "moon" ? parentNode.tilt : parentNode.pivot;
      attach.add(node.pivot);
    } else {
      scene.add(node.pivot);
    }
    if (body.parent === "sun") {
      orbitLines.add(createOrbitLine(body));
    }
  }

  bindInput();
  resize();
  if (!renderer.domElement.width || !renderer.domElement.height) {
    ui.unsupported.hidden = false;
    return;
  }
  if (earthSkyLook) {
    state.playing = false;
    state.focusedId = "earth";
    state.selectedId = "earth";
    bindSelectionHelpers();
    paintSpeed();
    paintCard();
  } else {
    const galaxyLook = requestedGalaxyLook();
    if (galaxyLook === "milkyway" || galaxyLook === "handoff" || galaxyLook === "mwinterior") {
      const aim = milkyWayInteriorCameraAim();
      state.distance = CONFIG.handoffViewDistance;
      state.azimuth = aim.azimuth;
      state.elevation = aim.elevation;
      state.focusedId = "sun";
    } else if (galaxyLook === "mwedge") {
      const aim = milkyWayEdgeCameraAim();
      state.distance = CONFIG.mwViewDistance;
      state.azimuth = aim.azimuth;
      state.elevation = aim.elevation;
      state.focusedId = "sun";
    } else if (galaxyLook === "mwbelow") {
      const aim = milkyWayBelowCameraAim();
      state.distance = CONFIG.mwViewDistance;
      state.azimuth = aim.azimuth;
      state.elevation = aim.elevation;
      state.focusedId = "sun";
    } else if (galaxyLook === "neighborhood") {
      const aim = neighborhoodCameraAim();
      state.distance = CONFIG.neighborhoodViewDistance;
      state.azimuth = aim.azimuth;
      state.elevation = aim.elevation;
      state.focusedId = "sun";
    } else if (galaxyLook === "localgroup") {
      const aim = localGroupCameraAim();
      state.distance = CONFIG.localGroupViewDistance;
      state.azimuth = aim.azimuth;
      state.elevation = aim.elevation;
      state.focusedId = "sun";
    } else if (galaxyLook === "virgo") {
      const aim = virgoCameraAim();
      state.distance = CONFIG.virgoViewDistance;
      state.azimuth = aim.azimuth;
      state.elevation = aim.elevation;
      state.focusedId = "sun";
    } else if (galaxyLook === "preweb") {
      const aim = virgoCameraAim();
      state.distance = CONFIG.virgoViewDistance
        + (CONFIG.webViewDistance - CONFIG.virgoViewDistance) * 0.55;
      state.azimuth = aim.azimuth;
      state.elevation = aim.elevation;
      state.focusedId = "sun";
    } else if (galaxyLook === "web") {
      const aim = webCameraAim();
      state.distance = CONFIG.webViewDistance;
      state.azimuth = aim.azimuth;
      state.elevation = aim.elevation;
      state.focusedId = "sun";
    } else if (galaxyLook === "universe") {
      const aim = universeCameraAim();
      state.distance = CONFIG.universeViewDistance;
      state.azimuth = aim.azimuth;
      state.elevation = aim.elevation;
      state.focusedId = "sun";
    }
  }
  updateBodies();
  placeCamera(1);
  lastStamp = performance.now();
  requestAnimationFrame(tick);
  say("Helios is ready. Drag to orbit, pinch or scroll to zoom, tap a world to focus.");
}

function createRenderer() {
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: ui.viewport,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
  } catch {
    return false;
  }
  if (!renderer.getContext()) return false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  return true;
}

function loadMap(path) {
  const texture = new THREE.TextureLoader().load(path);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function createBodyNode(body) {
  const radius = visualBodyRadius(body);
  const segments = body.id === "sun" ? 64 : body.kind === "moon" ? 32 : 48;
  const pivot = new THREE.Group();
  pivot.name = body.id;
  const tilt = new THREE.Group();
  tilt.rotation.z = body.tiltDeg * DEG;
  pivot.add(tilt);

  const material = body.id === "sun"
    ? new THREE.MeshBasicMaterial({ map: loadMap(body.texture), color: 0xfff0c8 })
    : new THREE.MeshStandardMaterial({
      map: loadMap(body.texture),
      roughness: body.kind === "planet" ? 0.72 : 0.88,
      metalness: 0,
    });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, segments), material);
  mesh.userData.bodyId = body.id;
  tilt.add(mesh);

  let glow = null;
  if (body.id === "sun") {
    glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: createGlowMap(),
      color: 0xffc35a,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    glow.userData.bodyId = body.id;
    glow.scale.set(radius * 6.4, radius * 6.4, 1);
    pivot.add(glow);
  }

  if (body.ring) {
    tilt.add(createRing(body));
  }

  const label = document.createElement("button");
  label.type = "button";
  label.className = "sky-label";
  label.textContent = body.name;
  label.dataset.bodyId = body.id;
  label.hidden = true;
  ui.labels.append(label);

  return { body, pivot, tilt, mesh, label, radius, glow };
}

function createRing(body) {
  const inner = visualRingRadius(body, body.ringInnerKm);
  const outer = visualRingRadius(body, body.ringOuterKm);
  const ringGeo = new THREE.RingGeometry(inner, outer, 256, 2);
  const pos = ringGeo.attributes.position;
  const uv = ringGeo.attributes.uv;
  for (let i = 0; i < pos.count; i += 1) {
    const u = ringTextureU(Math.hypot(pos.getX(i), pos.getY(i)), inner, outer);
    uv.setXY(i, u, 0.5);
  }
  uv.needsUpdate = true;
  const ringMap = loadMap(body.ring);
  const ring = new THREE.Mesh(
    ringGeo,
    new THREE.MeshStandardMaterial({
      map: ringMap,
      transparent: true,
      alphaTest: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
      roughness: 0.58,
      metalness: 0.12,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  return ring;
}

function createOrbitLine(body) {
  const parent = findBody(body.parent);
  const points = [];
  for (let i = 0; i <= 160; i += 1) {
    const days = (Math.abs(body.orbitDays) * i) / 160;
    const at = keplerOffset(body, parent, days);
    points.push(new THREE.Vector3(at.x, at.y, at.z));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({ color: 0x6d8294, transparent: true, opacity: 0.22 }),
  );
}

function createBeltField({ count, innerAu, outerAu, height, color, size, opacity, seed }) {
  const positions = new Float32Array(count * 3);
  const rand = seedRandom(seed);
  const inner = visualOrbit(innerAu);
  const outer = visualOrbit(outerAu);
  for (let i = 0; i < count; i += 1) {
    const radius = Math.sqrt(inner * inner + (outer * outer - inner * inner) * rand());
    const angle = rand() * Math.PI * 2;
    const lift = (rand() - 0.5) * height;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = lift;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const group = new THREE.Group();
  group.add(new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color, size, sizeAttenuation: true, transparent: true, opacity }),
  ));
  return group;
}

function createGlowMap() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const glow = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  glow.addColorStop(0, "rgba(255, 230, 160, 0.95)");
  glow.addColorStop(0.35, "rgba(255, 170, 60, 0.28)");
  glow.addColorStop(1, "rgba(255, 140, 40, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function bindInput() {
  ui.play.addEventListener("click", togglePlay);
  ui.slower.addEventListener("click", () => scaleSpeed(0.5));
  ui.faster.addEventListener("click", () => scaleSpeed(2));
  ui.speed.addEventListener("input", () => {
    state.daysPerSecond = speedFromSlider(Number(ui.speed.value));
    paintSpeed();
  });
  ui.reset.addEventListener("click", resetView);
  ui.cardClose.addEventListener("click", clearSelection);
  ui.sky.addEventListener("click", toggleConstellations);
  ui.helperOrbit.addEventListener("click", () => toggleHelper("showOrbitHelper"));
  ui.helperAxis.addEventListener("click", () => toggleHelper("showAxisHelper"));
  ui.helperSpin.addEventListener("click", () => toggleHelper("showSpinHelper"));
  ui.labels.addEventListener("click", (event) => {
    const button = event.target.closest("[data-body-id]");
    if (button) selectBody(button.dataset.bodyId);
  });

  const canvas = ui.viewport;
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("lostpointercapture", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", resize);
}

function onPointerDown(event) {
  canvasFocus();
  ui.viewport.setPointerCapture(event.pointerId);
  pointerIds.set(event.pointerId, { x: event.clientX, y: event.clientY });
  state.tap = { x: event.clientX, y: event.clientY, moved: 0 };
  if (pointerIds.size === 2) {
    state.pinching = true;
    state.tap = null;
    state.pinchStart = pointerGap();
    state.pinchDistance = state.distance;
  }
}

function onPointerMove(event) {
  const prior = pointerIds.get(event.pointerId);
  if (!prior) return;
  const dx = event.clientX - prior.x;
  const dy = event.clientY - prior.y;
  pointerIds.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (state.pinching && pointerIds.size >= 2) {
    const gap = pointerGap();
    if (state.pinchStart > 0) {
      zoomTo(pinchZoomDistance(state.pinchDistance, state.pinchStart, gap));
    }
    return;
  }

  if (state.tap) {
    state.tap.moved += Math.hypot(dx, dy);
  }
  if (!state.tap || state.tap.moved >= CONFIG.tapMovePx) {
    state.azimuth -= dx * 0.005;
    state.elevation = clamp(state.elevation + dy * 0.004, -1.2, 1.2);
  }
}

function onPointerUp(event) {
  const tap = state.tap;
  pointerIds.delete(event.pointerId);
  if (pointerIds.size < 2) state.pinching = false;
  if (pointerIds.size === 0) {
    if (tap && tap.moved < CONFIG.tapMovePx) {
      pickAt(tap.x, tap.y);
    }
    state.tap = null;
  }
}

function onWheel(event) {
  event.preventDefault();
  if (state.pinching) return;
  const touchPinch = Boolean(event.ctrlKey)
    || event.pointerType === "touch"
    || Boolean(event.sourceCapabilities?.firesTouchEvents);
  zoomTo(state.distance * wheelZoomMultiplier(event.deltaY, touchPinch));
}

function onKey(event) {
  if (event.target instanceof HTMLInputElement) return;
  if (event.code === "Space") {
    event.preventDefault();
    togglePlay();
  } else if (event.key === "+" || event.key === "=") {
    scaleSpeed(2);
  } else if (event.key === "-" || event.key === "_") {
    scaleSpeed(0.5);
  } else if (event.key === "Escape") {
    resetView();
  }
}

function pointerGap() {
  const points = [...pointerIds.values()];
  if (points.length < 2) return 0;
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

function zoomTo(distance) {
  const next = clamp(distance, CONFIG.minDistance, CONFIG.maxDistance);
  if (next > CONFIG.solarMaxDistance && state.distance <= CONFIG.solarMaxDistance) {
    state.focusedId = "sun";
    state.selectedId = null;
    paintCard();
  }
  if (state.distance < CONFIG.handoffViewDistance && next >= CONFIG.handoffViewDistance) {
    const aim = milkyWayInteriorCameraAim();
    state.azimuth = aim.azimuth;
    state.elevation = aim.elevation;
  }
  state.distance = next;
}

function canvasFocus() {
  ui.viewport.focus({ preventScroll: true });
}

function pickAt(clientX, clientY) {
  if (scaleLayer(state.distance) !== "solar") {
    clearSelection();
    return;
  }
  const bounds = ui.viewport.getBoundingClientRect();
  ndc.x = ((clientX - bounds.left) / bounds.width) * 2 - 1;
  ndc.y = -((clientY - bounds.top) / bounds.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const pickables = [...nodes.values()].flatMap((node) => (
    node.glow ? [node.mesh, node.glow] : [node.mesh]
  ));
  const hit = raycaster.intersectObjects(pickables, false)[0];
  if (hit?.object.userData.bodyId) {
    selectBody(hit.object.userData.bodyId);
    return;
  }
  clearSelection();
}

function selectBody(id) {
  const node = nodes.get(id);
  if (!node) return;
  state.focusedId = id;
  state.selectedId = id;
  const ideal = Math.max(node.radius * 7.5, 5.5);
  state.distance = clamp(ideal, CONFIG.minDistance, CONFIG.maxDistance);
  bindSelectionHelpers();
  paintCard();
  say(`Focused ${node.body.name}`);
}

function clearSelection() {
  if (!state.selectedId) return;
  state.selectedId = null;
  paintCard();
  say("Selection cleared");
}

function resetView() {
  state.focusedId = "sun";
  state.selectedId = null;
  state.azimuth = CONFIG.cameraAzimuth;
  state.elevation = CONFIG.cameraElevation;
  state.distance = CONFIG.cameraDistance;
  paintCard();
  say("Returned to the overview");
}

function toggleConstellations() {
  if (!skyStaysOn(state.distance)) return;
  state.showConstellations = !state.showConstellations;
  paintConstellations();
  say(state.showConstellations ? "Constellations on" : "Constellations off");
}

function toggleHelper(key) {
  state[key] = !state[key];
  paintCard();
}

function bindSelectionHelpers() {
  if (!helpers || !state.selectedId) return;
  const node = nodes.get(state.selectedId);
  if (!node) return;
  const parentNode = node.body.parent ? nodes.get(node.body.parent) : null;
  bindFocusHelpers(THREE, helpers, {
    body: node.body,
    node,
    parentNode,
    scene,
  });
}

function togglePlay() {
  state.playing = !state.playing;
  paintSpeed();
  say(state.playing ? "Time is running" : "Time is paused");
}

function scaleSpeed(factor) {
  state.daysPerSecond = clamp(
    state.daysPerSecond * factor,
    CONFIG.minDaysPerSecond,
    CONFIG.maxDaysPerSecond,
  );
  paintSpeed();
}

function speedFromSlider(unit) {
  const min = Math.log(CONFIG.minDaysPerSecond);
  const max = Math.log(CONFIG.maxDaysPerSecond);
  return Math.exp(min + (max - min) * unit);
}

function sliderFromSpeed(daysPerSecond) {
  const min = Math.log(CONFIG.minDaysPerSecond);
  const max = Math.log(CONFIG.maxDaysPerSecond);
  return (Math.log(daysPerSecond) - min) / (max - min);
}

function paintSpeed() {
  ui.play.textContent = state.playing ? "Pause" : "Play";
  ui.play.setAttribute("aria-pressed", String(state.playing));
  ui.speed.value = String(sliderFromSpeed(state.daysPerSecond));
  ui.speedReadout.textContent = `${formatDaysPerSecond(state.daysPerSecond)} / sec`;
}

function paintClock() {
  const stamp = Date.UTC(2000, 0, 1, 12) + state.days * 86400000;
  ui.clock.textContent = new Date(stamp).toISOString().slice(0, 10);
}

function paintSkyButton() {
  const inSolar = skyStaysOn(state.distance);
  ui.sky.textContent = "Constellations";
  ui.sky.hidden = !inSolar;
  ui.sky.setAttribute("aria-pressed", String(state.showConstellations));
}

function paintConstellations() {
  const inSolar = skyStaysOn(state.distance);
  paintSkyButton();
  if (celestial) setConstellationsVisible(celestial, inSolar && state.showConstellations);
}

function paintHelperButtons() {
  const selected = Boolean(state.selectedId);
  const body = selected ? findBody(state.selectedId) : null;
  const hasOrbit = Boolean(body?.orbitDays);
  ui.helperOrbit.hidden = !hasOrbit;
  ui.helperOrbit.setAttribute("aria-pressed", String(state.showOrbitHelper && hasOrbit));
  ui.helperAxis.setAttribute("aria-pressed", String(state.showAxisHelper));
  ui.helperSpin.setAttribute("aria-pressed", String(state.showSpinHelper));
  if (helpers) {
    setHelperVisibility(helpers, {
      selected,
      orbit: state.showOrbitHelper && hasOrbit,
      axis: state.showAxisHelper,
      spin: state.showSpinHelper,
    });
  }
}

function paintCard() {
  const body = state.selectedId ? findBody(state.selectedId) : null;
  if (!body) {
    ui.card.hidden = true;
    if (helpers) {
      setHelperVisibility(helpers, { selected: false, orbit: false, axis: false, spin: false });
    }
    return;
  }
  const info = describeBody(body);
  ui.card.hidden = false;
  ui.cardName.textContent = info.name;
  ui.cardKind.textContent = kindLabel(info.kind);
  ui.cardMeta.textContent = info.facts.join(" · ");
  paintHelperButtons();
}

function kindLabel(kind) {
  if (kind === "star") return "Star";
  if (kind === "planet") return "Planet";
  if (kind === "dwarf") return "Dwarf planet";
  return "Moon";
}

function say(message) {
  ui.status.textContent = message;
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function tick(now) {
  const dt = Math.min(0.05, (now - lastStamp) / 1000);
  lastStamp = now;
  if (state.playing) state.days += dt * state.daysPerSecond;
  updateBodies();
  asteroidBelt.rotation.y = state.days * (Math.PI * 2) / 1682;
  kuiperBelt.rotation.y = state.days * (Math.PI * 2) / 90560;
  paintScaleLayer();
  placeCamera(1 - Math.exp(-CONFIG.focusLerp * dt));
  updateLabels();
  paintClock();
  renderer.render(scene, camera);
  if (extraZoomWarmState === 0 && !earthSkyLook) {
    extraZoomWarmState = 1;
    const later = typeof requestIdleCallback === "function"
      ? (fn) => requestIdleCallback(fn, { timeout: 280 })
      : (fn) => requestAnimationFrame(fn);
    later(warmExtraZoom);
  }
  requestAnimationFrame(tick);
}

function updateBodies() {
  for (const node of nodes.values()) {
    const parent = node.body.parent ? findBody(node.body.parent) : null;
    const at = keplerOffset(node.body, parent, state.days);
    node.pivot.position.set(at.x, at.y, at.z);
    node.mesh.rotation.y = at.spin;
  }
}

function placeCamera(blend) {
  const focused = nodes.get(state.focusedId);
  focused.mesh.getWorldPosition(desiredTarget);
  if (earthSkyLook) {
    placeCameraForSkyLook(camera, desiredTarget, focused.radius * 1.25);
    attachSkyToCamera(celestial, camera);
    return;
  }
  focusPoint.lerp(desiredTarget, clamp(blend, 0, 1));
  const cosE = Math.cos(state.elevation);
  camera.position.set(
    focusPoint.x + state.distance * cosE * Math.sin(state.azimuth),
    focusPoint.y + state.distance * Math.sin(state.elevation),
    focusPoint.z + state.distance * cosE * Math.cos(state.azimuth),
  );
  camera.lookAt(focusPoint);
  camera.near = Math.max(0.05, state.distance / 2500);
  camera.far = CONFIG.cameraFar;
  camera.updateProjectionMatrix();
  attachSkyToCamera(celestial, camera);
  attachFarGalaxySky(galaxy, camera);
}

function fadeRoot(root, factor) {
  if (!root) return;
  root.visible = factor > 0.03;
  root.traverse((child) => {
    const mat = child.material;
    if (!mat || mat.opacity == null) return;
    if (mat.userData.baseOpacity == null) mat.userData.baseOpacity = mat.opacity;
    mat.transparent = true;
    mat.opacity = mat.userData.baseOpacity * factor;
  });
}

function fadeBodyNode(node, factor) {
  fadeRoot(node.mesh, factor);
  if (node.glow) fadeRoot(node.glow, factor);
  for (const child of node.tilt.children) {
    if (child === node.mesh) continue;
    if (nodes.has(child.name)) continue;
    if (String(child.name).startsWith("helper-")) continue;
    fadeRoot(child, factor);
  }
}

let lastScaleLayer = "solar";
let extraZoomWarmState = 0;

function warmExtraZoom() {
  if (extraZoomWarmState === 2 || !galaxy || !renderer || earthSkyLook) return;
  extraZoomWarmState = 2;
  setGalaxyLayerVisible(galaxy, 0.001, CONFIG.mwViewDistance);
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  setGalaxyLayerVisible(galaxy, galaxyOpacity(state.distance), state.distance);
}

function paintScaleLayer() {
  if (earthSkyLook) return;
  const solar = solarOpacity(state.distance);
  const galactic = galaxyOpacity(state.distance);
  const shrink = orreryScale(state.distance);
  const sun = nodes.get("sun");
  if (sun) sun.pivot.scale.setScalar(shrink);
  asteroidBelt.scale.setScalar(shrink);
  kuiperBelt.scale.setScalar(shrink);
  orbitLines.scale.setScalar(shrink);
  orbitLines.visible = orbitLineOpacity(state.distance) > 0.04;
  fadeRoot(asteroidBelt, solar);
  fadeRoot(kuiperBelt, solar);
  fadeRoot(orbitLines, orbitLineOpacity(state.distance));
  setCelestialFade(celestial, celestialSkyOpacity(state.distance));
  setSkyBandBrightness(celestial, skyBandBrightness(state.distance));
  paintConstellations();
  setGalaxyLayerVisible(galaxy, galactic, state.distance);
  for (const node of nodes.values()) {
    const extra = node.body.id === "sun" || scaleLayer(state.distance) === "solar";
    fadeBodyNode(node, extra ? solar : 0);
  }
  if (helpers && galactic > 0.5) {
    setHelperVisibility(helpers, { selected: false, orbit: false, axis: false, spin: false });
  }
  const layer = scaleLayer(state.distance);
  if (layer !== lastScaleLayer) {
    lastScaleLayer = layer;
    if (layer === "milkyway") say("Milky Way. The Sun sits in the Orion Arm.");
    else if (layer === "neighborhood") say("Nearby galaxies.");
    else if (layer === "localgroup") say("Local Group.");
    else if (layer === "virgo") say("Virgo Cluster. The Local Group is a nearby family; Virgo is the nearest large cluster.");
    else if (layer === "web") say("Cosmic web. Filaments and clusters around the Milky Way.");
    else if (layer === "universe") say("Observable universe. The CMB sphere is the last outside layer.");
    else if (layer === "solar") say("Solar system.");
  }
}

function updateLabels() {
  if (earthSkyLook) {
    for (const node of nodes.values()) node.label.hidden = true;
    return;
  }
  const hidePlanets = scaleLayer(state.distance) !== "solar";
  const width = window.innerWidth;
  const height = window.innerHeight;
  const focused = findBody(state.focusedId);
  for (const node of nodes.values()) {
    node.mesh.getWorldPosition(world);
    projected.copy(world).project(camera);
    const onScreen = projected.z > -1 && projected.z < 1
      && Math.abs(projected.x) < 1.12
      && Math.abs(projected.y) < 1.12;
    const show = !hidePlanets && onScreen && canShowLabel(node.body, focused);
    node.label.hidden = !show;
    if (!show) continue;
    node.label.classList.toggle("is-active", node.body.id === state.selectedId);
    node.label.style.transform = `translate(-50%, -120%) translate(${(projected.x * 0.5 + 0.5) * width}px, ${(-projected.y * 0.5 + 0.5) * height}px)`;
  }
}

function canShowLabel(body, focused) {
  if (body.id === focused.id) return true;
  if (body.kind === "moon") {
    return body.parent === focused.id || focused.parent === body.parent;
  }
  return true;
}

boot();
