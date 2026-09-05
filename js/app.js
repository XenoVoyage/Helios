import * as THREE from "../vendor/three.module.min.js";
import {
  CONFIG,
  describeDaysPerSecond,
  formatDaysPerSecond,
  isShortcutTargetInteractive,
  minimumFocusDistance,
  moonFocusFlightPoint,
  parentGlobeClearance,
  parentGlobeMaximumEndpointAngle,
  parentGlobeMaximumViewAngle,
  pinchZoomDistance,
  resetParentGlobeContinuity,
  resolveParentGlobePoint,
  wheelZoomMultiplier,
} from "./config.js";
import { advanceSimulationDays, elapsedSeconds, simulationDateLabel } from "./time.js";
import {
  BODIES,
  bodyOrientationBasis,
  describeBody,
  findBody,
  keplerOffset,
  keplerOrbitNormal,
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
  attachFarGalaxySky,
  celestialSkyOpacity,
  constellationsAvailable,
  createGalaxyLayer,
  galaxyOpacity,
  localGroupCameraAim,
  extraZoomCameraDistance,
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
  scaleLayer,
  sceneHierarchyId,
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
const pointerIds = new Map();
const ndc = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const world = new THREE.Vector3();
const projected = new THREE.Vector3();
const focusPoint = new THREE.Vector3();
const desiredTarget = new THREE.Vector3();
const parentPoint = new THREE.Vector3();
const transitionStartOffset = new THREE.Vector3();
const transitionTargetOffset = new THREE.Vector3();
const transitionParentAxis = new THREE.Vector3();
const moonOrbitNormal = new THREE.Vector3();
const orbitFrameQuaternion = new THREE.Quaternion();
const parentGlobeContinuity = {};
const parentGlobeOptions = {
  continuity: parentGlobeContinuity,
  key: null,
  moonRadius: 0,
  maximumAngularStep: 0,
  orbitNormal: moonOrbitNormal,
};
const parentGlobeTargetOptions = { moonRadius: 0, orbitNormal: moonOrbitNormal };
const BODY_LABEL_CLEARANCE = 8;
const moonFocusTransition = {
  active: false,
  flightDistance: null,
  progress: 1,
  focusStart: new THREE.Vector3(),
  startCamera: new THREE.Vector3(),
  route: {},
};
const constellationViewport = { width: 0, height: 0, topInset: 64, bottomInset: 72 };

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
const bodyLabelObstacles = [];
let renderer;
let scene;
let camera;
let celestial;
let asteroidBelt;
let kuiperBelt;
let orbitLines;
let galaxy;
let helpers;
let chromeObserver;
let dockClearance = 72;
let lastStamp = 0;
let lastClockLabel = "";
let bodyLabelLayoutDirty = true;
const earthSkyLook = wantsEarthSkyLook();

function $(id) {
  return document.getElementById(id);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function syncViewportBusy() {
  if (!ui.viewport) return;
  const busy = String(Boolean(
    moonFocusTransition.active
      || (parentGlobeContinuity.active && !parentGlobeContinuity.settled),
  ));
  if (ui.viewport.getAttribute("aria-busy") !== busy) {
    ui.viewport.setAttribute("aria-busy", busy);
  }
}

function setMoonFocusTransition(active) {
  moonFocusTransition.active = active;
  if (!active) {
    moonFocusTransition.progress = 1;
    moonFocusTransition.route = {};
  }
  syncViewportBusy();
}

function beginMoonFocusTransition(targetDistance, progress, startVisible = null) {
  resetParentGlobeContinuity(parentGlobeContinuity);
  setMoonFocusTransition(true);
  moonFocusTransition.progress = progress;
  moonFocusTransition.focusStart.copy(focusPoint);
  moonFocusTransition.startCamera.copy(camera.position);
  moonFocusTransition.flightDistance = targetDistance;
  moonFocusTransition.route = {
    startNear: camera.near,
    targetNear: extraZoomCameraNear(targetDistance),
  };
  if (startVisible !== null) moonFocusTransition.route.startVisible = startVisible;
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
  ui.topbar = document.querySelector(".topbar");
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
  ui.skyControl = $("sky-control");
  ui.sky = $("sky-mode");
  ui.helperOrbit = $("helper-orbit");
  ui.helperAxis = $("helper-axis");
  ui.helperSpin = $("helper-spin");
  ui.status = $("status-live");
  ui.sceneContext = $("scene-context");
  ui.unsupported = $("unsupported");
  ui.version = $("version-label");
  ui.dock = $("dock");
  ui.skip = $("skip-link");
  setMoonFocusTransition(false);

  ui.version.textContent = CONFIG.VERSION;
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
  measureBodyLabels();
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
  if (galaxyOpacity(state.distance) > 0) ensureGalaxyLayer();
  updateBodies();
  placeCamera(1);
  paintScaleLayer();
  lastStamp = performance.now();
  requestAnimationFrame(tick);
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
  const texture = new THREE.TextureLoader().load(path);
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
  const orbitNormal = body.kind === "moon" && body.parent
    ? keplerOrbitNormal(body, findBody(body.parent))
    : null;
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
  const inspectionFill = CONFIG.nightSideInspectionFill[body.id];
  if (inspectionFill) {
    // Reuse the same color texture for a subtle presentation floor. This is
    // not a light source: the Sun still owns the terminator, and rings and
    // unrelated bodies receive no extra light or material change.
    material.emissiveMap = material.map;
    material.emissive.set(0xffffff);
    material.emissiveIntensity = inspectionFill;
  }
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

  return {
    body,
    pivot,
    tilt,
    mesh,
    label,
    labelWidth: 0,
    labelHeight: 0,
    radius,
    glow,
    spinPhase,
    orbitNormal,
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
    // A parent guard can finish just beyond the normal input latitude. Keep
    // the first horizontal drag exact and only let out-of-range seats move
    // back toward the standard orbit band instead of snapping into it.
    state.elevation = clamp(
      state.elevation + dy * 0.004,
      Math.min(-1.2, state.elevation),
      Math.max(1.2, state.elevation),
    );
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
  zoomTo(state.distance * wheelZoomMultiplier(event.deltaY));
}

function onKey(event) {
  if (event.repeat || isShortcutTargetInteractive(event.target)) return;
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

function moonZoomNeedsTransition(node, distance) {
  if (parentGlobeContinuity.active) return true;
  const parentNode = nodes.get(node.body.parent);
  if (!parentNode) return false;
  node.mesh.getWorldPosition(desiredTarget);
  parentNode.mesh.getWorldPosition(parentPoint);
  worldMoonOrbitNormal(node, parentNode);
  const radius = extraZoomCameraDistance(distance);
  const near = extraZoomCameraNear(distance);
  const cosE = Math.cos(state.elevation);
  const x = desiredTarget.x + radius * cosE * Math.sin(state.azimuth);
  const y = desiredTarget.y + radius * Math.sin(state.elevation);
  const z = desiredTarget.z + radius * cosE * Math.cos(state.azimuth);
  parentGlobeTargetOptions.moonRadius = node.radius;
  const resolved = resolveParentGlobePoint(
    x,
    y,
    z,
    parentPoint.x,
    parentPoint.y,
    parentPoint.z,
    parentNode.radius,
    near,
    desiredTarget.x - parentPoint.x,
    desiredTarget.y - parentPoint.y,
    desiredTarget.z - parentPoint.z,
    parentGlobeTargetOptions,
  );
  return Math.hypot(resolved.x - x, resolved.y - y, resolved.z - z) > 1e-9;
}

function zoomTo(distance) {
  const focusedRadius = nodes.get(state.focusedId)?.radius ?? 0;
  const next = clamp(distance, minimumFocusDistance(focusedRadius), CONFIG.maxDistance);
  const focused = nodes.get(state.focusedId);
  if (next > CONFIG.solarMaxDistance) ensureGalaxyLayer();
  if (next > CONFIG.solarMaxDistance && state.distance <= CONFIG.solarMaxDistance) {
    resetParentGlobeContinuity(parentGlobeContinuity);
    setMoonFocusTransition(false);
    moonFocusTransition.flightDistance = null;
    state.focusedId = "sun";
    state.selectedId = null;
    paintCard();
  } else if (
    next !== state.distance
    && focused?.body.kind === "moon"
    && focused.body.parent
  ) {
    if (!moonFocusTransition.active && moonZoomNeedsTransition(focused, next)) {
      beginMoonFocusTransition(next, 1, true);
    } else if (moonFocusTransition.active) {
      resetParentGlobeContinuity(parentGlobeContinuity);
      moonFocusTransition.startCamera.copy(camera.position);
      moonFocusTransition.flightDistance = next;
      moonFocusTransition.route = {
        startNear: camera.near,
        targetNear: extraZoomCameraNear(next),
      };
      syncViewportBusy();
    }
  }
  state.distance = next;
  paintConstellations();
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
  const ideal = Math.max(node.radius * 7.5, 5.5);
  const nextDistance = clamp(ideal, minimumFocusDistance(node.radius), CONFIG.maxDistance);
  if (state.focusedId !== id) {
    if (node.body.kind === "moon" && node.body.parent) {
      beginMoonFocusTransition(nextDistance, 0);
    } else {
      resetParentGlobeContinuity(parentGlobeContinuity);
      setMoonFocusTransition(false);
      moonFocusTransition.flightDistance = null;
    }
  } else if (
    nextDistance !== state.distance
    && node.body.kind === "moon"
    && node.body.parent
  ) {
    if (moonFocusTransition.active) {
      resetParentGlobeContinuity(parentGlobeContinuity);
      moonFocusTransition.startCamera.copy(camera.position);
      moonFocusTransition.flightDistance = nextDistance;
      moonFocusTransition.route = {
        startNear: camera.near,
        targetNear: extraZoomCameraNear(nextDistance),
      };
    } else if (moonZoomNeedsTransition(node, nextDistance)) {
      beginMoonFocusTransition(nextDistance, 1, true);
    }
  }
  state.focusedId = id;
  state.selectedId = id;
  state.distance = nextDistance;
  paintConstellations();
  bindSelectionHelpers();
  paintCard();
  say(`Focused ${node.body.name}`);
  paintSceneSemantics();
}

function clearSelection() {
  if (!state.selectedId) return;
  state.selectedId = null;
  paintCard();
  say("Selection cleared");
}

function resetView() {
  resetParentGlobeContinuity(parentGlobeContinuity);
  setMoonFocusTransition(false);
  moonFocusTransition.flightDistance = null;
  state.focusedId = earthSkyLook ? "earth" : "sun";
  state.selectedId = null;
  state.azimuth = CONFIG.cameraAzimuth;
  state.elevation = CONFIG.cameraElevation;
  state.distance = CONFIG.cameraDistance;
  paintCard();
  paintConstellations();
  paintSceneSemantics();
  say(earthSkyLook ? "Returned to the Earth sky" : "Returned to the overview");
}

function changeConstellationMode() {
  if (!constellationsAvailable(state.distance)) {
    paintConstellations();
    return;
  }
  state.constellationMode = normalizeConstellationMode(ui.sky.value);
  paintConstellations();
  say(`Constellations ${state.constellationMode}`);
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
  ui.speed.setAttribute("aria-valuetext", describeDaysPerSecond(state.daysPerSecond));
  ui.speedReadout.textContent = `${formatDaysPerSecond(state.daysPerSecond)} / sec`;
  bodyLabelLayoutDirty = true;
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
  if (ui.skyControl.hidden === available) bodyLabelLayoutDirty = true;
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
    bodyLabelLayoutDirty = true;
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
  bodyLabelLayoutDirty = true;
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

const SCENE_HIERARCHY_ANNOUNCEMENTS = {
  solar: "Solar system.",
  transition: "Leaving the solar system toward the Milky Way.",
  milkyway: "Milky Way. The Sun sits in the Orion Arm.",
  neighborhood: "Nearby galaxies.",
  localgroup: "Local Group.",
  virgo: "Virgo Cluster. The Local Group is a nearby family; Virgo is the nearest large cluster.",
  virgoSupercluster: "Local (Virgo) Supercluster.",
  laniakea: "Laniakea Supercluster.",
  web: "2MRS galaxy distribution. Approximate redshift distances, with no invented links.",
  cmb: "Cosmic microwave background. The illustrative CMB shell is becoming visible.",
  universe: "Schematic observable universe. The illustrative CMB shell shares the outer display radius.",
  earthsky: "Earth sky.",
};

function sceneSemantics() {
  if (earthSkyLook) {
    const announcement = SCENE_HIERARCHY_ANNOUNCEMENTS.earthsky;
    const focused = findBody(state.focusedId);
    const focusName = focused.id === "sun" ? "the Sun" : focused.name;
    return {
      id: "earthsky",
      description: `${announcement} Focused on ${focusName}.`,
      announcement,
    };
  }
  const id = sceneHierarchyId(state.distance);
  const announcement = SCENE_HIERARCHY_ANNOUNCEMENTS[id];
  let description = announcement;
  if (id === "solar") {
    const focused = findBody(state.focusedId);
    const focusName = focused.id === "sun" ? "the Sun" : focused.name;
    description = `${announcement} Focused on ${focusName}.`;
  }
  return { id, description, announcement };
}

function paintSceneSemantics() {
  const { id, description, announcement } = sceneSemantics();
  if (ui.sceneContext.textContent !== description) {
    ui.sceneContext.textContent = description;
  }
  if (lastHierarchyId !== null && id !== lastHierarchyId && announcement) {
    say(announcement);
  }
  lastHierarchyId = id;
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  paintDockClearance();
  bodyLabelLayoutDirty = true;
}

function paintDockClearance() {
  const height = Math.ceil(ui.dock.getBoundingClientRect().height);
  if (height > 0) {
    dockClearance = height;
    document.documentElement.style.setProperty("--dock-clearance", `${height}px`);
  }
  bodyLabelLayoutDirty = true;
}

function observeDock() {
  paintDockClearance();
  if (!("ResizeObserver" in window)) return;
  chromeObserver = new ResizeObserver((entries) => {
    bodyLabelLayoutDirty = true;
    if (entries.some((entry) => entry.target === ui.dock)) paintDockClearance();
  });
  chromeObserver.observe(ui.dock);
  chromeObserver.observe(ui.topbar);
  chromeObserver.observe(ui.card);
  chromeObserver.observe(ui.version);
}

function tick(now) {
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
  placeCamera(1 - Math.exp(-CONFIG.focusLerp * cameraDt));
  updateLabels();
  paintClock();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

function updateBodies() {
  for (const node of nodes.values()) {
    const parent = node.body.parent ? findBody(node.body.parent) : null;
    const at = keplerOffset(node.body, parent, state.days);
    node.pivot.position.set(at.x, at.y, at.z);
    node.mesh.rotation.y = node.spinPhase + at.spin;
  }
}

function worldMoonOrbitNormal(node, parentNode) {
  const attachment = moonOrbitAttachment(node.body) === "parent-equatorial"
    ? parentNode.tilt
    : parentNode.pivot;
  attachment.getWorldQuaternion(orbitFrameQuaternion);
  return moonOrbitNormal
    .set(node.orbitNormal.x, node.orbitNormal.y, node.orbitNormal.z)
    .applyQuaternion(orbitFrameQuaternion)
    .normalize();
}

function placeCamera(blend) {
  const focused = nodes.get(state.focusedId);
  focused.mesh.getWorldPosition(desiredTarget);
  if (earthSkyLook) {
    placeCameraForSkyLook(camera, desiredTarget, focused.radius * 1.25);
    attachSkyToCamera(celestial, camera);
    return;
  }
  const parentedMoon = focused.body.kind === "moon" && Boolean(focused.body.parent);
  const boundedBlend = clamp(blend, 0, 1);
  const transitionSeconds = parentedMoon
    ? -Math.log1p(-Math.min(1 - Number.EPSILON, boundedBlend)) / CONFIG.focusLerp
    : 0;
  let transitionBlend = 1;
  if (parentedMoon) {
    if (moonFocusTransition.active) {
      // Recover the capped frame delta encoded by the exponential camera blend.
      moonFocusTransition.progress = Math.min(
        1,
        moonFocusTransition.progress
          + transitionSeconds / CONFIG.moonFocusEasingSeconds,
      );
      const progress = moonFocusTransition.progress;
      transitionBlend = progress * progress * (3 - 2 * progress);
      focusPoint.lerpVectors(
        moonFocusTransition.focusStart,
        desiredTarget,
        transitionBlend,
      );
    } else {
      focusPoint.copy(desiredTarget);
    }
  } else {
    focusPoint.lerp(desiredTarget, boundedBlend);
  }
  // Orbit input stays live at every zoom; extra-zoom never seats or
  // locks the camera, it only remaps the orbit radius.
  const flightDistance = moonFocusTransition.active
    ? moonFocusTransition.flightDistance ?? state.distance
    : state.distance;
  const radius = extraZoomCameraDistance(flightDistance);
  let near = extraZoomCameraNear(flightDistance);
  const cosE = Math.cos(state.elevation);
  const orbitCenter = parentedMoon ? desiredTarget : focusPoint;
  if (
    moonFocusTransition.active
    && moonFocusTransition.route.ready
    && (
      moonFocusTransition.route.viewAzimuth !== state.azimuth
      || moonFocusTransition.route.viewElevation !== state.elevation
    )
  ) {
    moonFocusTransition.startCamera.copy(camera.position);
    moonFocusTransition.route = {
      startNear: camera.near,
      targetNear: moonFocusTransition.route.targetNear,
    };
    resetParentGlobeContinuity(parentGlobeContinuity);
  }
  camera.position.set(
    orbitCenter.x + radius * cosE * Math.sin(state.azimuth),
    orbitCenter.y + radius * Math.sin(state.elevation),
    orbitCenter.z + radius * cosE * Math.cos(state.azimuth),
  );
  if (parentedMoon) {
    const parentNode = nodes.get(focused.body.parent);
    if (parentNode) {
      parentNode.mesh.getWorldPosition(parentPoint);
      worldMoonOrbitNormal(focused, parentNode);
      parentGlobeOptions.key = focused.body.id;
      parentGlobeOptions.moonRadius = focused.radius;
      parentGlobeOptions.maximumAngularStep = (
        CONFIG.moonFocusAngularRateRadiansPerSecond * transitionSeconds
      );
      parentGlobeTargetOptions.moonRadius = focused.radius;
      const guardOptions = moonFocusTransition.active
        ? parentGlobeTargetOptions
        : parentGlobeOptions;
      const startNear = moonFocusTransition.active
        ? moonFocusTransition.route.startNear ?? camera.near
        : near;
      const targetNear = moonFocusTransition.active
        ? moonFocusTransition.route.targetNear ?? near
        : near;
      const resolved = resolveParentGlobePoint(
        camera.position.x,
        camera.position.y,
        camera.position.z,
        parentPoint.x,
        parentPoint.y,
        parentPoint.z,
        parentNode.radius,
        targetNear,
        desiredTarget.x - parentPoint.x,
        desiredTarget.y - parentPoint.y,
        desiredTarget.z - parentPoint.z,
        guardOptions,
      );
      if (moonFocusTransition.active) {
        if (!moonFocusTransition.route.ready) {
          const start = resolveParentGlobePoint(
            moonFocusTransition.startCamera.x,
            moonFocusTransition.startCamera.y,
            moonFocusTransition.startCamera.z,
            parentPoint.x,
            parentPoint.y,
            parentPoint.z,
            parentNode.radius,
            startNear,
          );
          transitionStartOffset.set(
            start.x - desiredTarget.x,
            start.y - desiredTarget.y,
            start.z - desiredTarget.z,
          );
          const visibleStart = resolveParentGlobePoint(
            start.x,
            start.y,
            start.z,
            parentPoint.x,
            parentPoint.y,
            parentPoint.z,
            parentNode.radius,
            startNear,
            desiredTarget.x - parentPoint.x,
            desiredTarget.y - parentPoint.y,
            desiredTarget.z - parentPoint.z,
            parentGlobeTargetOptions,
          );
          moonFocusTransition.route.startVisible = Math.hypot(
            visibleStart.x - start.x,
            visibleStart.y - start.y,
            visibleStart.z - start.z,
          ) <= 1e-9;
        }
        transitionTargetOffset.set(
          resolved.x - desiredTarget.x,
          resolved.y - desiredTarget.y,
          resolved.z - desiredTarget.z,
        );
        transitionParentAxis.copy(desiredTarget).sub(parentPoint);
        const beginningRoute = !moonFocusTransition.route.ready;
        const separation = transitionParentAxis.length();
        const minimumStartRadius = parentGlobeClearance(focused.radius, startNear);
        const minimumTargetRadius = parentGlobeClearance(focused.radius, targetNear);
        const startRadius = moonFocusTransition.route.ready
          ? moonFocusTransition.route.startRadius
          : Math.max(minimumStartRadius, transitionStartOffset.length());
        const targetRadius = moonFocusTransition.route.ready
          ? moonFocusTransition.route.targetRadius
          : Math.max(minimumTargetRadius, transitionTargetOffset.length());
        const maximumStartAngle = moonFocusTransition.route.startVisible
          ? parentGlobeMaximumViewAngle(
            separation,
            startRadius,
            parentNode.radius,
            startNear,
            focused.radius,
          )
          : parentGlobeMaximumEndpointAngle(
            separation,
            startRadius,
            parentNode.radius,
            startNear,
          );
        const maximumTargetAngle = parentGlobeMaximumViewAngle(
          separation,
          targetRadius,
          parentNode.radius,
          targetNear,
          focused.radius,
        );
        const transitioned = moonFocusFlightPoint(
          moonFocusTransition.route,
          transitionStartOffset,
          transitionTargetOffset,
          transitionParentAxis,
          transitionSeconds,
          minimumStartRadius,
          maximumStartAngle,
          maximumTargetAngle,
          moonOrbitNormal,
          minimumTargetRadius,
        );
        if (beginningRoute) {
          moonFocusTransition.route.viewAzimuth = state.azimuth;
          moonFocusTransition.route.viewElevation = state.elevation;
        }
        const outwardEnd = moonFocusTransition.route.outwardSeconds;
        const radialEnd = outwardEnd + moonFocusTransition.route.radialSeconds;
        near = moonFocusTransition.route.elapsed < outwardEnd
          ? startNear
          : moonFocusTransition.route.elapsed < radialEnd
            ? Math.min(startNear, targetNear)
            : targetNear;
        if (!moonFocusTransition.route.startVisible) {
          const transitionedRadius = Math.hypot(
            transitioned.x,
            transitioned.y,
            transitioned.z,
          ) || 1;
          const fullCap = parentGlobeMaximumViewAngle(
            separation,
            transitionedRadius,
            parentNode.radius,
            near,
            focused.radius,
          );
          const angle = Math.acos(clamp(
            (
              transitioned.x * transitionParentAxis.x
                + transitioned.y * transitionParentAxis.y
                + transitioned.z * transitionParentAxis.z
            ) / (transitionedRadius * Math.max(1e-12, separation)),
            -1,
            1,
          ));
          if (angle <= fullCap + 1e-10) moonFocusTransition.route.startVisible = true;
        }
        camera.position.set(
          desiredTarget.x + transitioned.x,
          desiredTarget.y + transitioned.y,
          desiredTarget.z + transitioned.z,
        );
        if (
          moonFocusTransition.progress === 1
          && moonFocusTransition.route.done
        ) {
          const transitionedRadius = Math.hypot(
            transitioned.x,
            transitioned.y,
            transitioned.z,
          ) || 1;
          state.azimuth = Math.atan2(transitioned.x, transitioned.z);
          state.elevation = Math.asin(clamp(transitioned.y / transitionedRadius, -1, 1));
          resetParentGlobeContinuity(parentGlobeContinuity);
          if (state.distance !== flightDistance) {
            moonFocusTransition.progress = 1;
            moonFocusTransition.focusStart.copy(desiredTarget);
            moonFocusTransition.startCamera.copy(camera.position);
            moonFocusTransition.flightDistance = state.distance;
            moonFocusTransition.route = {
              startNear: near,
              targetNear: extraZoomCameraNear(state.distance),
              startVisible: true,
            };
          } else {
            moonFocusTransition.flightDistance = null;
            setMoonFocusTransition(false);
          }
        }
      } else {
        camera.position.set(resolved.x, resolved.y, resolved.z);
      }
    }
  } else {
    resetParentGlobeContinuity(parentGlobeContinuity);
    moonFocusTransition.flightDistance = null;
  }
  syncViewportBusy();
  camera.lookAt(focusPoint);
  camera.near = near;
  camera.far = CONFIG.cameraFar;
  camera.updateProjectionMatrix();
  attachSkyToCamera(celestial, camera);
  if (galaxy) attachFarGalaxySky(galaxy, camera);
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

let lastHierarchyId = null;

function ensureGalaxyLayer() {
  if (galaxy || !scene || earthSkyLook) return galaxy;
  galaxy = createGalaxyLayer(THREE);
  scene.add(galaxy);
  document.documentElement.dataset.galaxyReady = "1";
  return galaxy;
}

function paintScaleLayer() {
  if (earthSkyLook) {
    paintSceneSemantics();
    document.documentElement.dataset.heliosReady = "1";
    return;
  }
  const solar = solarOpacity(state.distance);
  const galactic = galaxyOpacity(state.distance);
  if (galactic > 0) ensureGalaxyLayer();
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
  paintSceneSemantics();
  document.documentElement.dataset.heliosReady = "1";
}

function measureBodyLabels() {
  const previous = [];
  for (const node of nodes.values()) {
    previous.push({ node, hidden: node.label.hidden });
    node.label.hidden = false;
    node.label.style.visibility = "hidden";
  }
  for (const { node } of previous) {
    node.labelWidth = node.label.offsetWidth;
    node.labelHeight = node.label.offsetHeight;
  }
  for (const { node, hidden } of previous) {
    node.label.hidden = hidden;
    node.label.style.visibility = "";
  }
  bodyLabelLayoutDirty = true;
}

function paintBodyLabelObstacles() {
  bodyLabelObstacles.length = 0;
  for (const element of [ui.topbar, ui.card, ui.dock, ui.version]) {
    if (!element || element.hidden || element.getClientRects().length === 0) continue;
    const box = element.getBoundingClientRect();
    bodyLabelObstacles.push({
      left: box.left - BODY_LABEL_CLEARANCE,
      right: box.right + BODY_LABEL_CLEARANCE,
      top: box.top - BODY_LABEL_CLEARANCE,
      bottom: box.bottom + BODY_LABEL_CLEARANCE,
    });
  }
  bodyLabelLayoutDirty = false;
}

function bodyLabelFits(anchorX, anchorY, node, viewportWidth, viewportHeight) {
  const left = anchorX - node.labelWidth / 2;
  const right = left + node.labelWidth;
  const top = anchorY - node.labelHeight * 1.2;
  const bottom = top + node.labelHeight;
  if (
    left < BODY_LABEL_CLEARANCE
    || right > viewportWidth - BODY_LABEL_CLEARANCE
    || top < BODY_LABEL_CLEARANCE
    || bottom > viewportHeight - BODY_LABEL_CLEARANCE
  ) return false;
  for (const obstacle of bodyLabelObstacles) {
    const separate = right <= obstacle.left
      || left >= obstacle.right
      || bottom <= obstacle.top
      || top >= obstacle.bottom;
    if (!separate) return false;
  }
  return true;
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
  if (bodyLabelLayoutDirty) paintBodyLabelObstacles();
  for (const node of nodes.values()) {
    node.mesh.getWorldPosition(world);
    projected.copy(world).project(camera);
    const onScreen = projected.z > -1 && projected.z < 1
      && Math.abs(projected.x) < 1.12
      && Math.abs(projected.y) < 1.12;
    const anchorX = (projected.x * 0.5 + 0.5) * width;
    const anchorY = (-projected.y * 0.5 + 0.5) * height;
    const show = !hidePlanets
      && onScreen
      && canShowLabel(node.body, focused)
      && bodyLabelFits(anchorX, anchorY, node, width, height);
    if (!show && document.activeElement === node.label) canvasFocus();
    node.label.hidden = !show;
    if (!show) continue;
    node.label.classList.toggle("is-active", node.body.id === state.selectedId);
    node.label.style.transform = `translate(-50%, -120%) translate(${anchorX}px, ${anchorY}px)`;
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
