import * as THREE from "../vendor/three.module.min.js";
import {
  CONFIG,
  describeDaysPerSecond,
  formatDaysPerSecond,
  isShortcutTargetInteractive,
  pinchZoomDistance,
  saturnRingHighPhaseFactor,
  wheelZoomMultiplier,
} from "./config.js";
import { advanceSimulationDays, elapsedSeconds, simulationDateLabel } from "./time.js";
import {
  BODIES,
  bodyOrientationBasis,
  describeBody,
  findBody,
  keplerOffset,
  moonOrbitAttachment,
  ringTextureU,
  visualBodyRadius,
  visualOrbit,
  visualRingRadius,
} from "./bodies.js";
import {
  attachSkyToCamera,
  CONSTELLATION_MODES,
  createCelestialSphere,
  equatorialVectorToScene,
  normalizeConstellationMode,
  placeCameraForSkyLook,
  setCelestialFade,
  setConstellationMode,
  setSkyBandBrightness,
  setStarBrightness,
  updateConstellationLabels,
  wantsEarthSkyLook,
} from "./sky.js";
import {
  bindFocusHelpers,
  createFocusHelpers,
  setHelperVisibility,
} from "./helpers.js";
import {
  advanceGalaxyLayer,
  attachFarGalaxySky,
  buildGalaxyLayerToDistance,
  celestialSkyOpacity,
  constellationsAvailable,
  createGalaxyLayer,
  galaxyOpacity,
  galaxyLayerBuildStage,
  galaxyLayerReadyForDistance,
  localGroupCameraAim,
  extraZoomCameraNear,
  milkyWayBelowCameraAim,
  milkyWayCameraAim,
  milkyWayEdgeCameraAim,
  milkyWayInteriorCameraAim,
  skyStarBrightness,
  neighborhoodCameraAim,
  orbitLineOpacity,
  orreryScale,
  requestedGalaxyLook,
  responsiveExtraZoomCameraDistance,
  scaleLayer,
  setGalaxyLayerVisible,
  skyBandBrightness,
  solarSystemHandoffSceneOffset,
  solarDebrisOpacity,
  solarOpacity,
  universeCameraAim,
  virgoCameraAim,
  webCameraAim,
} from "./galaxy.js";

const DEG = Math.PI / 180;
const KEY_ORBIT_STEP = 0.12;
const KEY_ELEVATION_STEP = 0.1;
const KEY_ZOOM_FACTOR = 0.8;
const SUN_CAMERA_EPSILON = 1e-6;
const GALAXY_IDLE_WORK_BUDGET = 2400;
const GALAXY_URGENT_TIME_BUDGET_MS = 24;
const pointerIds = new Map();
const ndc = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const world = new THREE.Vector3();
const projected = new THREE.Vector3();
const focusPoint = new THREE.Vector3();
const desiredTarget = new THREE.Vector3();
const ringCenter = new THREE.Vector3();
const ringViewDirection = new THREE.Vector3();
const ringLightDirection = new THREE.Vector3();
const sunPosition = new THREE.Vector3();
const constellationViewport = { width: 0, height: 0, topInset: 64, bottomInset: 72 };
const bodyLabelCandidates = [];
const bodyLabelsAccepted = [];

const state = {
  days: 0,
  playing: true,
  daysPerSecond: CONFIG.defaultDaysPerSecond,
  focusedId: "sun",
  selectedId: null,
  constellationMode: CONSTELLATION_MODES.major,
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
let galaxyActivated = false;
let galaxyWarmupHandle = null;
let galaxyWarmupKind = null;
let pendingGalaxyDistance = null;
let helpers;
let dockObserver;
let dockClearance = 72;
let measuredDockHeight = 0;
let lastStamp = 0;
let lastClockLabel = "";
let saturnRingViewLightDot = 1;
let frameRequest = 0;
let renderDirty = true;
let cameraSettling = true;
let renderCount = 0;
let heldFrameSkips = 0;
let lastRenderedControlDistance = null;
let galaxyWarmupChunks = 0;
let galaxyWarmupMaxMs = 0;
const earthSkyLook = wantsEarthSkyLook();

function $(id) {
  return document.getElementById(id);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function invalidateRender(dirty = true) {
  if (dirty) renderDirty = true;
  if (!renderer || frameRequest) return;
  frameRequest = requestAnimationFrame(tick);
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
  ui.stage = $("stage");
  ui.viewport = $("viewport");
  ui.labels = $("labels");
  ui.clock = $("clock");
  ui.play = $("play-button");
  ui.slower = $("slower-button");
  ui.faster = $("faster-button");
  ui.zoomOut = $("zoom-out-button");
  ui.zoomIn = $("zoom-in-button");
  ui.speed = $("speed-slider");
  ui.speedReadout = $("speed-readout");
  ui.reset = $("reset-button");
  ui.card = $("body-card");
  ui.cardName = $("card-name");
  ui.cardKind = $("card-kind");
  ui.cardMeta = $("card-meta");
  ui.cardClose = $("card-close");
  ui.skyControl = $("sky-control");
  ui.sky = $("sky-mode");
  ui.helperOrbit = $("helper-orbit");
  ui.helperAxis = $("helper-axis");
  ui.helperSpin = $("helper-spin");
  ui.status = $("status-live");
  ui.unsupported = $("unsupported");
  ui.version = $("version-label");
  ui.dock = $("dock");
  ui.skip = $("skip-link");

  ui.version.textContent = CONFIG.VERSION;
  document.documentElement.dataset.assetsLoading = "0";
  THREE.DefaultLoadingManager.onStart = () => {
    document.documentElement.dataset.assetsLoading = "1";
    invalidateRender();
  };
  THREE.DefaultLoadingManager.onProgress = invalidateRender;
  THREE.DefaultLoadingManager.onLoad = () => {
    document.documentElement.dataset.assetsLoading = "0";
    invalidateRender();
  };
  THREE.DefaultLoadingManager.onError = invalidateRender;
  const galaxyLook = earthSkyLook ? null : requestedGalaxyLook();
  paintSpeed();
  paintClock();
  paintSkyControl();
  paintCard();

  try {
    if (!createRenderer()) throw new Error("WebGL unavailable");
  } catch {
    showUnsupported();
    return;
  }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02050c);
  camera = new THREE.PerspectiveCamera(52, 1, 0.05, CONFIG.cameraFar);
  celestial = createCelestialSphere(THREE);
  scene.add(celestial);
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
  // Faint fill so night sides stay readable instead of vanishing black on
  // black (Earth's Moon and the Mars moons in sunward seats). Day, night,
  // and the terminator still come from the Sun point light.
  scene.add(new THREE.AmbientLight(0x24334a, 0.21));
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
      const attach = body.kind === "moon" && moonOrbitAttachment(body) === "parent-equatorial"
        ? parentNode.tilt
        : parentNode.pivot;
      if (attach === parentNode.tilt && body.orientationJ2000) {
        // The orbit inherits its parent's equatorial frame, but PCK body axes
        // are absolute J2000 orientations. Cancel that inherited rotation once.
        node.tilt.quaternion.premultiply(parentNode.tilt.quaternion.clone().invert());
      }
      attach.add(node.pivot);
    } else {
      scene.add(node.pivot);
    }
    if (body.parent === "sun") {
      orbitLines.add(createOrbitLine(body));
    }
  }

  resize();
  if (!renderer.domElement.width || !renderer.domElement.height) {
    showUnsupported();
    return;
  }
  bindInput();
  observeDock();
  if (earthSkyLook) {
    state.playing = false;
    state.focusedId = "earth";
    state.selectedId = "earth";
    bindSelectionHelpers();
    paintSpeed();
    paintCard();
  } else {
    if (galaxyLook === "solarfar") {
      state.distance = CONFIG.solarMaxDistance;
      state.azimuth = CONFIG.cameraAzimuth;
      state.elevation = CONFIG.cameraElevation;
      state.focusedId = "sun";
    } else if (galaxyLook === "tailsky") {
      const aim = milkyWayInteriorCameraAim();
      state.distance = CONFIG.handoffViewDistance
        + (CONFIG.mwViewDistance - CONFIG.handoffViewDistance) * 0.32;
      state.azimuth = aim.azimuth;
      state.elevation = aim.elevation;
      state.focusedId = "sun";
    } else if (galaxyLook === "growing") {
      const aim = milkyWayCameraAim();
      state.distance = CONFIG.handoffViewDistance
        + (CONFIG.mwViewDistance - CONFIG.handoffViewDistance) * 0.90;
      state.azimuth = aim.azimuth;
      state.elevation = aim.elevation;
      state.focusedId = "sun";
    } else if (galaxyLook === "disk") {
      const aim = milkyWayCameraAim();
      state.distance = CONFIG.mwViewDistance;
      state.azimuth = aim.azimuth;
      state.elevation = aim.elevation;
      state.focusedId = "sun";
    } else if (galaxyLook === "milkyway" || galaxyLook === "handoff" || galaxyLook === "mwinterior") {
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
  if (galaxyOpacity(state.distance) > 0) ensureGalaxyLayer(state.distance);
  updateBodies();
  placeCamera(1);
  paintScaleLayer();
  lastStamp = performance.now();
  invalidateRender();
  scheduleGalaxyWarmup();
  say("Helios is ready. Drag to orbit, pinch or scroll to zoom, tap a world to focus.");
}

function showUnsupported() {
  ui.stage.hidden = true;
  ui.stage.inert = true;
  ui.skip.hidden = true;
  ui.version.hidden = true;
  ui.unsupported.hidden = false;
  ui.unsupported.focus({ preventScroll: true });
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
  const texture = new THREE.TextureLoader().load(path, invalidateRender);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function applyBodyOrientation(tilt, body) {
  const basis = bodyOrientationBasis(body);
  if (!basis) {
    tilt.rotation.z = body.tiltDeg * DEG;
    return 0;
  }
  const xAxis = equatorialVectorToScene(basis.xAxis);
  const bodyYAxis = equatorialVectorToScene(basis.yAxis);
  const pole = equatorialVectorToScene(basis.zAxis);
  const matrix = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(xAxis.x, xAxis.y, xAxis.z),
    new THREE.Vector3(pole.x, pole.y, pole.z),
    new THREE.Vector3(-bodyYAxis.x, -bodyYAxis.y, -bodyYAxis.z),
  );
  tilt.setRotationFromMatrix(matrix);
  if (basis.primeMeridianDeg !== null) return basis.primeMeridianDeg * DEG;
  // Keep an unverified texture's previous prime direction as closely as the
  // corrected pole permits; this display phase is not an IAU longitude claim.
  const legacyPrime = new THREE.Vector3(
    Math.cos(body.tiltDeg * DEG),
    Math.sin(body.tiltDeg * DEG),
    0,
  );
  return Math.atan2(
    legacyPrime.dot(new THREE.Vector3(bodyYAxis.x, bodyYAxis.y, bodyYAxis.z)),
    legacyPrime.dot(new THREE.Vector3(xAxis.x, xAxis.y, xAxis.z)),
  );
}

function createBodyNode(body) {
  const radius = visualBodyRadius(body);
  const segments = body.id === "sun" ? 64 : body.kind === "moon" ? 32 : 48;
  const pivot = new THREE.Group();
  pivot.name = body.id;
  const tilt = new THREE.Group();
  const spinPhase = applyBodyOrientation(tilt, body);
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

  let ring = null;
  if (body.ring) {
    ring = createRing(body);
    tilt.add(ring);
  }

  const label = document.createElement("button");
  label.type = "button";
  label.className = "sky-label";
  label.textContent = body.name;
  label.dataset.bodyId = body.id;
  label.hidden = true;
  ui.labels.append(label);

  return {
    body,
    pivot,
    tilt,
    mesh,
    label,
    radius,
    glow,
    ring,
    spinPhase,
    labelWidth: 0,
    labelHeight: 0,
    labelLeft: 0,
    labelRight: 0,
    labelTop: 0,
    labelBottom: 0,
  };
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
      emissive: 0xffffff,
      emissiveMap: ringMap,
      emissiveIntensity: 0,
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
  ui.zoomOut.addEventListener("click", () => zoomBy(1 / KEY_ZOOM_FACTOR));
  ui.zoomIn.addEventListener("click", () => zoomBy(KEY_ZOOM_FACTOR));
  ui.speed.addEventListener("input", () => {
    state.daysPerSecond = speedFromSlider(Number(ui.speed.value));
    paintSpeed();
    invalidateRender();
  });
  ui.reset.addEventListener("click", resetView);
  ui.cardClose.addEventListener("click", clearSelection);
  ui.sky.addEventListener("change", changeConstellationMode);
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
    state.pinchDistance = requestedCameraDistance();
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
    invalidateRender();
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
  zoomTo(requestedCameraDistance() * wheelZoomMultiplier(event.deltaY));
}

function onKey(event) {
  if (isShortcutTargetInteractive(event.target) || event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }
  const cameraKey = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown"]
    .includes(event.key);
  if (event.repeat && !cameraKey) return;
  if (event.code === "Space") {
    event.preventDefault();
    togglePlay();
  } else if (event.key === "+" || event.key === "=") {
    scaleSpeed(2);
  } else if (event.key === "-" || event.key === "_") {
    scaleSpeed(0.5);
  } else if (event.key === "Escape") {
    resetView();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    orbitCamera(-KEY_ORBIT_STEP, 0);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    orbitCamera(KEY_ORBIT_STEP, 0);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    orbitCamera(0, KEY_ELEVATION_STEP);
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    orbitCamera(0, -KEY_ELEVATION_STEP);
  } else if (event.key === "PageUp") {
    event.preventDefault();
    zoomBy(KEY_ZOOM_FACTOR);
  } else if (event.key === "PageDown") {
    event.preventDefault();
    zoomBy(1 / KEY_ZOOM_FACTOR);
  }
}

function pointerGap() {
  const points = [...pointerIds.values()];
  if (points.length < 2) return 0;
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

function requestedCameraDistance() {
  return pendingGalaxyDistance ?? state.distance;
}

function minimumCameraDistance() {
  const focused = nodes.get(state.focusedId);
  if (focused?.body.id !== "sun") return CONFIG.minDistance;
  // The near plane grows with camera distance. Solve its small fixed point so
  // the complete near plane, not only the camera position, stays outside the Sun.
  let distance = Math.max(CONFIG.minDistance, focused.radius + SUN_CAMERA_EPSILON);
  for (let iteration = 0; iteration < 8; iteration += 1) {
    distance = Math.max(
      CONFIG.minDistance,
      focused.radius + extraZoomCameraNear(distance) + SUN_CAMERA_EPSILON,
    );
  }
  return distance;
}

function applyZoomTo(next) {
  pendingGalaxyDistance = null;
  if (next > CONFIG.solarMaxDistance) ensureGalaxyLayer(next);
  if (next > CONFIG.solarMaxDistance && state.distance <= CONFIG.solarMaxDistance) {
    cameraSettling = state.focusedId !== "sun" || cameraSettling;
    state.focusedId = "sun";
    state.selectedId = null;
    paintCard();
  }
  state.distance = next;
  paintConstellations();
  invalidateRender();
}

function zoomTo(distance) {
  const next = clamp(distance, minimumCameraDistance(), CONFIG.maxDistance);
  if (next > CONFIG.solarMaxDistance) {
    const layer = prepareGalaxyLayer();
    if (layer && !galaxyLayerReadyForDistance(layer, next)) {
      // Retain the exact input target, but never finish a cold catalog/density
      // build inside the input event. The urgent scheduler yields every chunk.
      pendingGalaxyDistance = next;
      scheduleGalaxyWarmup(true);
      return;
    }
  }
  applyZoomTo(next);
}

function zoomBy(factor) {
  zoomTo(requestedCameraDistance() * factor);
  say(factor < 1 ? "Zoomed in" : "Zoomed out");
}

function orbitCamera(azimuth, elevation) {
  state.azimuth += azimuth;
  state.elevation = clamp(state.elevation + elevation, -1.2, 1.2);
  invalidateRender();
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
  const pickables = [...nodes.values()].map((node) => node.mesh);
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
  cameraSettling = true;
  pendingGalaxyDistance = null;
  const ideal = Math.max(node.radius * 7.5, 5.5);
  state.distance = clamp(ideal, CONFIG.minDistance, CONFIG.maxDistance);
  paintConstellations();
  bindSelectionHelpers();
  paintCard();
  invalidateRender();
  say(`Focused ${node.body.name}`);
}

function clearSelection() {
  if (!state.selectedId) return;
  state.selectedId = null;
  paintCard();
  invalidateRender();
  say("Selection cleared");
}

function resetView() {
  pendingGalaxyDistance = null;
  state.focusedId = "sun";
  state.selectedId = null;
  state.azimuth = CONFIG.cameraAzimuth;
  state.elevation = CONFIG.cameraElevation;
  state.distance = CONFIG.cameraDistance;
  cameraSettling = true;
  paintCard();
  paintConstellations();
  invalidateRender();
  say("Returned to the overview");
}

function changeConstellationMode() {
  if (!constellationsAvailable(state.distance)) {
    paintConstellations();
    return;
  }
  state.constellationMode = normalizeConstellationMode(ui.sky.value);
  paintConstellations();
  invalidateRender();
  say(`Constellations ${state.constellationMode}`);
}

function toggleHelper(key) {
  state[key] = !state[key];
  paintCard();
  invalidateRender();
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
  if (state.playing) lastStamp = performance.now();
  paintSpeed();
  invalidateRender();
  say(state.playing ? "Time is running" : "Time is paused");
}

function scaleSpeed(factor) {
  state.daysPerSecond = clamp(
    state.daysPerSecond * factor,
    CONFIG.minDaysPerSecond,
    CONFIG.maxDaysPerSecond,
  );
  paintSpeed();
  invalidateRender();
  say(`Time speed ${describeDaysPerSecond(state.daysPerSecond)}`);
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
  ui.speed.setAttribute("aria-valuetext", describeDaysPerSecond(state.daysPerSecond));
  ui.speedReadout.textContent = `${formatDaysPerSecond(state.daysPerSecond)} / sec`;
}

function paintClock() {
  const label = simulationDateLabel(state.days);
  if (label === lastClockLabel) return;
  lastClockLabel = label;
  ui.clock.textContent = label;
}

function paintSkyControl() {
  const available = constellationsAvailable(state.distance);
  if (!available && document.activeElement === ui.sky) canvasFocus();
  ui.skyControl.hidden = !available;
  ui.sky.disabled = !available;
  ui.sky.value = state.constellationMode;
}

function paintConstellations() {
  const available = constellationsAvailable(state.distance);
  paintSkyControl();
  if (celestial) {
    celestial.userData.constellationMode = state.constellationMode;
    setConstellationMode(celestial, state.constellationMode, available);
  }
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
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  paintDockClearance();
  invalidateRender();
}

function paintDockClearance() {
  const height = Math.ceil(ui.dock.getBoundingClientRect().height);
  if (height <= 0 || height === measuredDockHeight) return;
  measuredDockHeight = height;
  dockClearance = height;
  document.documentElement.style.setProperty("--dock-clearance", `${height}px`);
  invalidateRender();
}

function observeDock() {
  paintDockClearance();
  if (!("ResizeObserver" in window)) return;
  dockObserver = new ResizeObserver(paintDockClearance);
  dockObserver.observe(ui.dock);
}

function tick(now) {
  frameRequest = 0;
  const elapsed = elapsedSeconds(now, lastStamp);
  const cameraDt = Math.min(0.05, elapsed);
  lastStamp = now;
  state.days = advanceSimulationDays(
    state.days,
    elapsed,
    state.daysPerSecond,
    state.playing,
  );
  updateBodies();
  asteroidBelt.rotation.y = state.days * (Math.PI * 2) / 1682;
  kuiperBelt.rotation.y = state.days * (Math.PI * 2) / 90560;
  paintScaleLayer();
  cameraSettling = placeCamera(1 - Math.exp(-CONFIG.focusLerp * cameraDt));
  updateSaturnRingShading();
  paintClock();
  // A cold extra-zoom keeps the last complete frame visible while its exact
  // target is built. Do not resubmit that unchanged frame to software WebGL:
  // it can starve the bounded builder tasks without improving what is shown.
  // Explicit input, resize, and asset invalidations still refresh immediately.
  const submitFrame = pendingGalaxyDistance == null || renderDirty;
  renderDirty = false;
  if (submitFrame) {
    updateLabels();
    renderer.render(scene, camera);
    renderCount += 1;
    lastRenderedControlDistance = state.distance;
  } else {
    heldFrameSkips += 1;
  }
  if (state.playing || cameraSettling) invalidateRender(false);
}

function updateBodies() {
  for (const node of nodes.values()) {
    const parent = node.body.parent ? findBody(node.body.parent) : null;
    const at = keplerOffset(node.body, parent, state.days);
    node.pivot.position.set(at.x, at.y, at.z);
    node.mesh.rotation.y = node.spinPhase + at.spin;
  }
}

function updateSaturnRingShading() {
  const saturn = nodes.get("saturn");
  const sun = nodes.get("sun");
  if (!saturn?.ring || !sun || !camera) return;
  saturn.ring.getWorldPosition(ringCenter);
  sun.mesh.getWorldPosition(sunPosition);
  ringViewDirection.copy(camera.position).sub(ringCenter).normalize();
  ringLightDirection.copy(sunPosition).sub(ringCenter).normalize();
  saturnRingViewLightDot = ringViewDirection.dot(ringLightDirection);
  saturn.ring.material.emissiveIntensity = CONFIG.saturnRingHighPhaseLight
    * saturnRingHighPhaseFactor(saturnRingViewLightDot);
}

function placeCamera(blend) {
  const focused = nodes.get(state.focusedId);
  focused.mesh.getWorldPosition(desiredTarget);
  if (earthSkyLook) {
    placeCameraForSkyLook(camera, desiredTarget, focused.radius * 1.25);
    attachSkyToCamera(celestial, camera);
    return false;
  }
  const mix = clamp(blend, 0, 1);
  const radius = responsiveExtraZoomCameraDistance(state.distance, camera.aspect);
  const worldPerPixel = 2 * radius * Math.tan(camera.fov * DEG / 2)
    / Math.max(1, renderer.domElement.clientHeight);
  const settling = mix < 1 && focusPoint.distanceTo(desiredTarget) > worldPerPixel * 0.01;
  if (settling) focusPoint.lerp(desiredTarget, mix);
  else focusPoint.copy(desiredTarget);
  // Orbit input stays live at every zoom; extra-zoom never seats or
  // locks the camera, it only remaps the orbit radius.
  const cosE = Math.cos(state.elevation);
  camera.position.set(
    focusPoint.x + radius * cosE * Math.sin(state.azimuth),
    focusPoint.y + radius * Math.sin(state.elevation),
    focusPoint.z + radius * cosE * Math.cos(state.azimuth),
  );
  camera.lookAt(focusPoint);
  camera.near = extraZoomCameraNear(state.distance);
  camera.far = CONFIG.cameraFar;
  camera.updateProjectionMatrix();
  attachSkyToCamera(celestial, camera);
  if (galaxy) attachFarGalaxySky(galaxy, camera);
  return settling;
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

function prepareGalaxyLayer() {
  if (galaxy || !scene || earthSkyLook) return galaxy;
  galaxy = createGalaxyLayer(THREE, { defer: true });
  return galaxy;
}

function finishGalaxyPreparation() {
  if (!galaxy || galaxyLayerBuildStage(galaxy) !== "complete") return;
  document.documentElement.dataset.galaxyPrepared = "1";
}

function warmGalaxyLayer() {
  const started = performance.now();
  const urgent = galaxyWarmupKind === "urgent";
  let advanced = false;
  galaxyWarmupHandle = null;
  galaxyWarmupKind = null;
  try {
    const layer = prepareGalaxyLayer();
    if (!layer) return;
    // Urgent input amortizes task/render scheduling without enlarging any
    // deterministic builder step; background preparation still advances once.
    do {
      advanceGalaxyLayer(layer, GALAXY_IDLE_WORK_BUDGET);
      advanced = true;
      if (galaxyActivated && pendingGalaxyDistance == null) invalidateRender();
      if (pendingGalaxyDistance != null
        && galaxyLayerReadyForDistance(layer, pendingGalaxyDistance)) {
        applyZoomTo(pendingGalaxyDistance);
      }
    } while (
      urgent
      && pendingGalaxyDistance != null
      && galaxyLayerBuildStage(layer) !== "complete"
      && performance.now() - started < GALAXY_URGENT_TIME_BUDGET_MS
    );
    finishGalaxyPreparation();
    if (galaxyLayerBuildStage(layer) !== "complete") {
      scheduleGalaxyWarmup(pendingGalaxyDistance != null);
    }
  } finally {
    if (advanced) {
      galaxyWarmupChunks += 1;
      galaxyWarmupMaxMs = Math.max(galaxyWarmupMaxMs, performance.now() - started);
    }
  }
}

function cancelGalaxyWarmup() {
  if (galaxyWarmupHandle == null) return;
  if (galaxyWarmupKind === "idle") window.cancelIdleCallback(galaxyWarmupHandle);
  else window.clearTimeout(galaxyWarmupHandle);
  galaxyWarmupHandle = null;
  galaxyWarmupKind = null;
}

function scheduleGalaxyWarmup(urgent = false) {
  if (earthSkyLook) return;
  if (galaxy && galaxyLayerBuildStage(galaxy) === "complete") return;
  if (galaxyWarmupHandle != null) {
    if (!urgent || galaxyWarmupKind === "urgent") return;
    cancelGalaxyWarmup();
  }
  if (urgent) {
    galaxyWarmupKind = "urgent";
    galaxyWarmupHandle = window.setTimeout(warmGalaxyLayer, 0);
    return;
  }
  if ("requestIdleCallback" in window) {
    galaxyWarmupKind = "idle";
    galaxyWarmupHandle = window.requestIdleCallback(warmGalaxyLayer, { timeout: 100 });
  } else {
    galaxyWarmupKind = "timer";
    galaxyWarmupHandle = window.setTimeout(warmGalaxyLayer, 16);
  }
}

function ensureGalaxyLayer(distance = state.distance) {
  const layer = prepareGalaxyLayer();
  if (!layer) return layer;
  buildGalaxyLayerToDistance(layer, distance);
  finishGalaxyPreparation();
  if (!galaxyActivated) {
    scene.add(layer);
    galaxyActivated = true;
    document.documentElement.dataset.galaxyReady = "1";
  }
  return layer;
}

function paintScaleLayer() {
  if (earthSkyLook) {
    document.documentElement.dataset.heliosReady = "1";
    return;
  }
  const solar = solarOpacity(state.distance);
  const galactic = galaxyOpacity(state.distance);
  if (galactic > 0) ensureGalaxyLayer(state.distance);
  const shrink = orreryScale(state.distance);
  const sun = nodes.get("sun");
  if (sun) {
    sun.pivot.scale.setScalar(shrink);
    const handoff = solarSystemHandoffSceneOffset(state.distance);
    sun.pivot.position.set(handoff.x, handoff.y, handoff.z);
    asteroidBelt.position.set(handoff.x, handoff.y, handoff.z);
    kuiperBelt.position.set(handoff.x, handoff.y, handoff.z);
    orbitLines.position.set(handoff.x, handoff.y, handoff.z);
  }
  asteroidBelt.scale.setScalar(shrink);
  kuiperBelt.scale.setScalar(shrink);
  orbitLines.scale.setScalar(shrink);
  orbitLines.visible = orbitLineOpacity(state.distance) > 0.04;
  const debris = solarDebrisOpacity(state.distance);
  fadeRoot(asteroidBelt, debris);
  fadeRoot(kuiperBelt, debris);
  fadeRoot(orbitLines, orbitLineOpacity(state.distance));
  setCelestialFade(celestial, celestialSkyOpacity(state.distance));
  setSkyBandBrightness(celestial, skyBandBrightness(state.distance));
  setStarBrightness(celestial, skyStarBrightness(state.distance));
  paintConstellations();
  if (galaxy) setGalaxyLayerVisible(galaxy, galactic, state.distance);
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
    else if (layer === "web") say("2MRS galaxy distribution. Approximate redshift distances, with no invented links.");
    else if (layer === "universe") say("Schematic observable universe. The illustrative CMB shell shares the outer display radius.");
    else if (layer === "solar") say("Solar system.");
  }
  document.documentElement.dataset.heliosReady = "1";
}

function updateLabels() {
  camera.updateMatrixWorld(true);
  if (celestial) celestial.updateMatrixWorld(true);
  constellationViewport.width = window.innerWidth;
  constellationViewport.height = window.innerHeight;
  constellationViewport.bottomInset = dockClearance + 8;
  updateConstellationLabels(celestial, camera, constellationViewport);
  if (earthSkyLook) {
    for (const node of nodes.values()) node.label.hidden = true;
    return;
  }
  const hidePlanets = scaleLayer(state.distance) !== "solar";
  const width = window.innerWidth;
  const height = window.innerHeight;
  const focused = findBody(state.focusedId);
  bodyLabelCandidates.length = 0;
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
    const screenX = (projected.x * 0.5 + 0.5) * width;
    const screenY = (-projected.y * 0.5 + 0.5) * height;
    node.label.style.transform = `translate(-50%, -120%) translate(${screenX}px, ${screenY}px)`;
    if (!(node.labelWidth > 0)) {
      node.labelWidth = node.label.offsetWidth;
      node.labelHeight = node.label.offsetHeight;
    }
    node.labelLeft = screenX - node.labelWidth * 0.5;
    node.labelRight = node.labelLeft + node.labelWidth;
    node.labelTop = screenY - node.labelHeight * 1.2;
    node.labelBottom = node.labelTop + node.labelHeight;
    bodyLabelCandidates.push(node);
  }
  suppressBodyLabelCollisions();
}

function suppressBodyLabelCollisions() {
  bodyLabelsAccepted.length = 0;
  const selected = nodes.get(state.selectedId);
  const focused = nodes.get(state.focusedId);
  acceptBodyLabel(selected);
  if (focused !== selected) acceptBodyLabel(focused);
  for (let index = 0; index < bodyLabelCandidates.length; index += 1) {
    const candidate = bodyLabelCandidates[index];
    if (candidate !== selected && candidate !== focused) acceptBodyLabel(candidate);
  }
}

function acceptBodyLabel(candidate) {
  if (!candidate || candidate.label.hidden) return;
  let overlaps = false;
  for (let index = 0; index < bodyLabelsAccepted.length; index += 1) {
    const accepted = bodyLabelsAccepted[index];
    if (
      candidate.labelRight > accepted.labelLeft
      && candidate.labelLeft < accepted.labelRight
      && candidate.labelBottom > accepted.labelTop
      && candidate.labelTop < accepted.labelBottom
    ) {
      overlaps = true;
      break;
    }
  }
  candidate.label.hidden = overlaps;
  if (!overlaps) bodyLabelsAccepted.push(candidate);
}

function canShowLabel(body, focused) {
  if (body.id === focused.id) return true;
  if (body.kind === "moon") {
    return body.parent === focused.id || focused.parent === body.parent;
  }
  return true;
}

/** Read-only camera geometry used by interaction and boundary regressions. */
export function currentCameraMetrics() {
  const focused = nodes.get(state.focusedId);
  if (!camera || !focused) return null;
  const target = new THREE.Vector3();
  focused.mesh.getWorldPosition(target);
  const saturn = nodes.get("saturn");
  return {
    focusedId: state.focusedId,
    controlDistance: state.distance,
    requestedControlDistance: requestedCameraDistance(),
    cameraDistance: camera.position.distanceTo(target),
    near: camera.near,
    focusRadius: focused.radius,
    azimuth: state.azimuth,
    elevation: state.elevation,
    renderCount,
    heldFrameSkips,
    lastRenderedControlDistance,
    framePending: Boolean(frameRequest),
    cameraSettling,
    galaxyStage: galaxyLayerBuildStage(galaxy),
    galaxyWarmup: {
      chunks: galaxyWarmupChunks,
      maxMs: galaxyWarmupMaxMs,
    },
    saturnRing: {
      viewLightDot: saturnRingViewLightDot,
      emissiveIntensity: saturn?.ring?.material?.emissiveIntensity ?? 0,
    },
  };
}

boot();
