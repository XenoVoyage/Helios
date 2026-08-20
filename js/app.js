import * as THREE from "../vendor/three.module.min.js";
import { CONFIG } from "./config.js";
import {
  BODIES,
  describeBody,
  findBody,
  keplerOffset,
  visualOrbit,
  visualRadius,
} from "./bodies.js";

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
let belt;
let lastStamp = 0;

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
  ui.status = $("status-live");
  ui.unsupported = $("unsupported");
  ui.version = $("version-label");

  ui.version.textContent = CONFIG.VERSION;
  paintSpeed();
  paintClock();
  paintCard();

  if (!createRenderer()) {
    ui.unsupported.hidden = false;
    return;
  }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060a);
  camera = new THREE.PerspectiveCamera(52, 1, 0.05, 900);
  scene.add(createStarfield());
  belt = createBelt();
  scene.add(belt);
  scene.add(new THREE.AmbientLight(0x6b7280, 0.42));
  scene.add(new THREE.HemisphereLight(0x9eb6ff, 0x1a120c, 0.22));
  const sunLight = new THREE.PointLight(0xffe6b0, 3.4, 0, 1.15);
  sunLight.position.set(0, 0, 0);
  scene.add(sunLight);

  for (const body of BODIES) {
    nodes.set(body.id, createBodyNode(body));
  }
  for (const body of BODIES) {
    const node = nodes.get(body.id);
    if (body.parent) nodes.get(body.parent).pivot.add(node.pivot);
    else scene.add(node.pivot);
    if (body.parent === "sun") {
      scene.add(createOrbitLine(body));
    }
  }

  bindInput();
  resize();
  placeCamera(1);
  lastStamp = performance.now();
  renderer.setAnimationLoop(tick);
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
  renderer.toneMappingExposure = 1.05;
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
  const radius = visualRadius(body.radiusKm);
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
      roughness: body.kind === "planet" ? 0.78 : 0.92,
      metalness: 0.02,
    });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, segments), material);
  mesh.userData.bodyId = body.id;
  tilt.add(mesh);

  if (body.id === "sun") {
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: createGlowMap(),
      color: 0xffc35a,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    glow.scale.set(radius * 6.4, radius * 6.4, 1);
    pivot.add(glow);
  }

  if (body.ring) {
    const inner = radius * body.ringInner;
    const outer = radius * body.ringOuter;
    const ringGeo = new THREE.RingGeometry(inner, outer, 128, 1);
    const uv = ringGeo.attributes.uv;
    for (let i = 0; i < uv.count; i += 1) {
      uv.setXY(i, uv.getY(i), 0.5);
    }
    const ringMap = loadMap(body.ring);
    ringMap.colorSpace = THREE.SRGBColorSpace;
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        map: ringMap,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    tilt.add(ring);
  }

  const label = document.createElement("button");
  label.type = "button";
  label.className = "sky-label";
  label.textContent = body.name;
  label.dataset.bodyId = body.id;
  label.hidden = true;
  ui.labels.append(label);

  return { body, pivot, tilt, mesh, label, radius };
}

function createOrbitLine(body) {
  if (body.id === "sun") return new THREE.Group();
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
    new THREE.LineBasicMaterial({ color: 0x8d8878, transparent: true, opacity: 0.22 }),
  );
}

function createStarfield() {
  const count = 3200;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const rand = seedRandom(20260820);
  for (let i = 0; i < count; i += 1) {
    const radius = 280 + rand() * 180;
    const phi = Math.acos(2 * rand() - 1);
    const theta = rand() * Math.PI * 2;
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.cos(phi);
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    const tint = 0.78 + rand() * 0.22;
    colors[i * 3] = tint;
    colors[i * 3 + 1] = tint * (0.94 + rand() * 0.06);
    colors[i * 3 + 2] = tint * (0.88 + rand() * 0.12);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ size: 0.55, vertexColors: true, sizeAttenuation: true }),
  );
}

function createBelt() {
  const count = CONFIG.beltCount;
  const positions = new Float32Array(count * 3);
  const rand = seedRandom(88421);
  const inner = visualOrbit(CONFIG.beltInnerAu);
  const outer = visualOrbit(CONFIG.beltOuterAu);
  for (let i = 0; i < count; i += 1) {
    const radius = Math.sqrt(inner * inner + (outer * outer - inner * inner) * rand());
    const angle = rand() * Math.PI * 2;
    const height = (rand() - 0.5) * 1.8;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = height;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const group = new THREE.Group();
  group.add(new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: 0xb9a889, size: 0.09, sizeAttenuation: true, transparent: true, opacity: 0.72 }),
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
  ui.cardClose.addEventListener("click", () => focusBody("sun"));
  ui.labels.addEventListener("click", (event) => {
    const button = event.target.closest("[data-body-id]");
    if (button) focusBody(button.dataset.bodyId);
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
        zoomTo(state.pinchDistance * (gap / state.pinchStart));
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
  zoomTo(state.distance * Math.exp(event.deltaY * 0.0016));
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
  state.distance = clamp(distance, CONFIG.minDistance, CONFIG.maxDistance);
}

function canvasFocus() {
  ui.viewport.focus({ preventScroll: true });
}

function pickAt(clientX, clientY) {
  const bounds = ui.viewport.getBoundingClientRect();
  ndc.x = ((clientX - bounds.left) / bounds.width) * 2 - 1;
  ndc.y = -((clientY - bounds.top) / bounds.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const meshes = [...nodes.values()].map((node) => node.mesh);
  const hit = raycaster.intersectObjects(meshes, false)[0];
  if (hit?.object.userData.bodyId) focusBody(hit.object.userData.bodyId);
}

function focusBody(id) {
  const node = nodes.get(id);
  if (!node) return;
  state.focusedId = id;
  const ideal = Math.max(node.radius * 7.5, 5.5);
  state.distance = clamp(ideal, CONFIG.minDistance, CONFIG.maxDistance);
  paintCard();
  say(`Focused ${node.body.name}`);
}

function resetView() {
  state.focusedId = "sun";
  state.azimuth = CONFIG.cameraAzimuth;
  state.elevation = CONFIG.cameraElevation;
  state.distance = CONFIG.cameraDistance;
  paintCard();
  say("Returned to the overview");
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
  ui.speedReadout.textContent = `${formatSpeed(state.daysPerSecond)} / sec`;
}

function formatSpeed(daysPerSecond) {
  if (daysPerSecond >= 365) return `${(daysPerSecond / 365.25).toFixed(1)} yr`;
  if (daysPerSecond >= 30) return `${(daysPerSecond / 30.437).toFixed(1)} mo`;
  if (daysPerSecond >= 1) return `${daysPerSecond.toFixed(daysPerSecond >= 10 ? 0 : 1)} d`;
  return `${(daysPerSecond * 24).toFixed(0)} h`;
}

function paintClock() {
  const stamp = Date.UTC(2000, 0, 1, 12) + state.days * 86400000;
  ui.clock.textContent = new Date(stamp).toISOString().slice(0, 10);
}

function paintCard() {
  const body = findBody(state.focusedId);
  const info = describeBody(body);
  ui.card.hidden = body.id === "sun";
  ui.cardName.textContent = info.name;
  ui.cardKind.textContent = kindLabel(info.kind);
  ui.cardMeta.textContent = [info.orbitLabel, info.spinLabel, info.tiltLabel].join(" · ");
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
  belt.rotation.y = state.days * (Math.PI * 2) / 1682;
  placeCamera(1 - Math.exp(-CONFIG.focusLerp * dt));
  updateLabels();
  paintClock();
  renderer.render(scene, camera);
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
  focusPoint.lerp(desiredTarget, clamp(blend, 0, 1));
  const cosE = Math.cos(state.elevation);
  camera.position.set(
    focusPoint.x + state.distance * cosE * Math.sin(state.azimuth),
    focusPoint.y + state.distance * Math.sin(state.elevation),
    focusPoint.z + state.distance * cosE * Math.cos(state.azimuth),
  );
  camera.lookAt(focusPoint);
}

function updateLabels() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const focused = findBody(state.focusedId);
  for (const node of nodes.values()) {
    node.mesh.getWorldPosition(world);
    projected.copy(world).project(camera);
    const onScreen = projected.z > -1 && projected.z < 1
      && Math.abs(projected.x) < 1.12
      && Math.abs(projected.y) < 1.12;
    const show = onScreen && canShowLabel(node.body, focused);
    node.label.hidden = !show;
    if (!show) continue;
    node.label.classList.toggle("is-active", node.body.id === state.focusedId);
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
