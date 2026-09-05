/**
 * Canonical tunables. VERSION must match VERSION.txt.
 *
 * NASA / JPL catalog numbers stay in js/bodies.js. Galactic kpc, Virgo Mpc,
 * web Mpc, particle-horizon Gpc, and illustrative CMB display radius stay in
 * js/galaxy-catalog.js.
 * Only visual scale, the galaxy kpc / cluster / universe mapping, and the
 * time slider may diverge from 1:1. Time is not tied to scale.
 *
 * visualScale is the one spacing knob: it multiplies the compressed orbit
 * curve (orbitScale * AU^orbitPower). Raise it to spread the system; do not
 * invent fake AU values. sizeScale / sizePower size the spheres the same way.
 * Moons share that size curve (moonSizeScale 1). Galaxy zoom uses mwScale /
 * neighborhoodScale / virgoScale / webScale / universeScale; those are kpc,
 * compressed-Mpc, or compressed-Gpc mappings, not AU.
 */
export const CONFIG = Object.freeze({
  VERSION: "v2026.8.23a",
  earthRadiusKm: 6371,
  auKm: 149597870.7,
  visualScale: 2.6,
  sizeScale: 0.4,
  sizePower: 0.82,
  orbitScale: 40,
  orbitPower: 0.58,
  moonPad: 0.4,
  moonSpread: 0.35,
  // Extra visual space between sibling moon paths after radii are reserved.
  moonSiblingGap: 1.5,
  moonOrbitCap: 6,
  // Moons sit just outside rings; do not push them to 1.5× the ring radius.
  moonRingGap: 0.25,
  // 1 = no extra moon shrink; Phobos/Deimos stay tiny from sizePower alone.
  moonSizeScale: 1,
  // Visual floor so Phobos / Deimos never fall below a visible dot. The
  // published radiusKm stays 1:1 in the catalog; only the display size
  // is floored, like every other visual-scale knob.
  moonMinRadius: 0.05,
  // Display-only textured fill for the two unreadable ice-giant night sides;
  // not physical emission. Neptune's darker source map needs a larger factor.
  // All other globes, scene lights, and Saturn's rings retain their treatment.
  nightSideInspectionFill: Object.freeze({ uranus: 0.03, neptune: 0.25 }),
  defaultDaysPerSecond: 1 / 24,
  minDaysPerSecond: 1 / 24,
  maxDaysPerSecond: 400,
  // Debris fields: sparse point clouds, not rock catalogs. One owner for both.
  beltCount: 2400,
  beltInnerAu: 2.2,
  beltOuterAu: 3.3,
  kuiperCount: 880,
  kuiperInnerAu: 30.2,
  kuiperOuterAu: 50,
  cameraDistance: 880,
  cameraElevation: 0.5,
  cameraAzimuth: 0.55,
  minDistance: 2.4,
  // Focused zoom stops just outside the rendered globe, not inside it.
  focusSurfaceClearance: 1.05,
  // Solar overview / Kuiper camera cap. Further zoom is the galaxy layer.
  solarMaxDistance: 1880,
  maxDistance: 2600000,
  mwViewDistance: 11000,
  neighborhoodViewDistance: 24000,
  localGroupViewDistance: 40000,
  virgoViewDistance: 75000,
  // Inside the volume-filling web (o's universe camera), not outside the local ball.
  webViewDistance: 480000,
  // Far enough outside the CMB shell that the sphere reads as a ball.
  universeViewDistance: 2000000,
  galaxyFadeStart: 1880,
  // Extra-zoom pin shrink after the handoff. Not a solar/MW opacity blend.
  galaxyFadeEnd: 11000,
  // Solar sky and MW crossfade over the last stretch before this distance,
  // so zooming out never shows an empty black sky.
  handoffViewDistance: 2800,
  // Extra-zoom near range: first frames sit among Orion-arm stars, not a postcard.
  mwTailNearDistance: 36,
  // kpc → scene for the Milky Way disk. Not the AU orbit curve.
  mwScale: 82,
  mwPower: 0.95,
  // Visual disk half-thickness so the MW reads as a 3D disk, not a plane.
  // Catalog heightKpc stays the published thin-disk scale height.
  mwVisualHeightKpc: 1.55,
  mwHaloRadiusKpc: 18,
  // Second compressed scale for LMC / SMC / M31 / M33 and Local Group members.
  neighborhoodScale: 340,
  neighborhoodPower: 0.55,
  // Third compressed scale for Virgo. Input is catalog kpc / 1000 (Mpc).
  virgoScale: 4800,
  virgoPower: 0.5,
  // Visual core mark for the cluster, not a 1:1 member catalog.
  virgoMarkRadiusMpc: 2.2,
  // Fourth compressed scale for the local cosmic web. Input is catalog Mpc.
  // Keeps the 300 Mpc 2MRS boundary beyond the web camera so the measured
  // distribution reads as a surrounding volume, not an outside-view ball.
  webScale: 55000,
  webPower: 0.42,
  // 2MRS display cutoff. Radial velocity / H0 is an approximate Mpc mapping.
  webRadiusMpc: 300,
  // Visual home-hub glow. Not the published Laniakea diameter.
  laniakeaMarkRadiusMpc: 3.6,
  // Fifth compressed scale for the observable universe. Input is catalog Gpc.
  universeScale: 200000,
  universePower: 0.48,
  // Faint seeded backdrop stars so the solar sky reads as a full universe.
  // Hipparcos / IAU stay the catalog sky; these are dim dressing only and
  // never brighten with zoom.
  skyFaintStarCount: 9200,
  // Celestial sphere sits around the camera; far plane must clear the universe layer.
  skyRadius: 2000,
  cameraFar: 7000000,
  // Pointer travel below this is a tap/click, not an orbit gesture.
  tapMovePx: 12,
  focusLerp: 6,
  // Parent-safe moon focus flight rates; log radius is scale-independent.
  moonFocusRadialLogRatePerSecond: 2.5,
  moonFocusAngularRateRadiansPerSecond: 3.5,
  moonFocusEasingSeconds: 5 / 6,
});

/**
 * Pinch-out (larger gap) moves the camera closer: zoom in.
 * Pinch-in (smaller gap) moves farther: zoom out. Touch only uses this path.
 */
export function pinchZoomDistance(startDistance, startGap, gap) {
  if (!(startGap > 0) || !(gap > 0)) return startDistance;
  return startDistance * (startGap / gap);
}

/** Mouse wheel and browser pinch both follow the platform's delivered direction. */
export function wheelZoomMultiplier(deltaY) {
  return Math.exp(deltaY * 0.0016);
}

/** Camera floor for the currently focused rendered globe. */
export function minimumFocusDistance(renderedRadius) {
  const radius = Number.isFinite(renderedRadius) && renderedRadius > 0 ? renderedRadius : 0;
  return Math.max(CONFIG.minDistance, radius * CONFIG.focusSurfaceClearance);
}

/** Camera / near-plane standoff from a parent globe center. */
export function parentGlobeClearance(renderedRadius, near) {
  const radius = Number.isFinite(renderedRadius) && renderedRadius > 0 ? renderedRadius : 0;
  if (!(radius > 0)) return 0;
  const clip = Number.isFinite(near) && near > 0 ? near : 0;
  return Math.max(radius * CONFIG.focusSurfaceClearance, radius + clip);
}

/** Widest polar angle whose endpoint and rendered-moon sightline clear a parent. */
export function parentGlobeMaximumViewAngle(
  separation,
  cameraRadius,
  renderedRadius,
  near,
  moonRadius = 0,
) {
  const need = parentGlobeCapDot(
    separation,
    cameraRadius,
    renderedRadius,
    near,
    moonRadius,
  );
  return need == null ? 0 : Math.acos(clampUnit(need));
}

/** Widest moon-relative polar angle whose camera endpoint clears a parent. */
export function parentGlobeMaximumEndpointAngle(
  separation,
  cameraRadius,
  renderedRadius,
  near,
) {
  const safe = parentGlobeClearance(renderedRadius, near);
  if (!(separation > 1e-12) || !(cameraRadius > 1e-12)) return 0;
  const need = (
    safe * safe - separation * separation - cameraRadius * cameraRadius
  ) / (2 * cameraRadius * separation);
  return Math.acos(clampUnit(need));
}

/**
 * Follow a bounded, parent-clear three-leg moon focus route. The mutable route
 * stores wall-clock progress and parallel-transports its initial tangent as the
 * moon moves. Start and target are moon-relative; parentAxis points outward
 * from the parent through the moon. Start must clear the parent endpoint; the
 * latched target must pass the complete parent sightline guard.
 */
export function moonFocusFlightPoint(
  route,
  start,
  target,
  parentAxis,
  elapsedSeconds,
  minimumRadius,
  maximumStartAngle = Math.PI,
  maximumTargetAngle = Math.PI,
  orbitNormal = null,
  minimumTargetRadius = minimumRadius,
) {
  const safeStart = Number.isFinite(minimumRadius) && minimumRadius > 0 ? minimumRadius : 0;
  const safeTarget = Number.isFinite(minimumTargetRadius) && minimumTargetRadius > 0
    ? minimumTargetRadius
    : 0;
  const dt = Number.isFinite(elapsedSeconds) && elapsedSeconds > 0 ? elapsedSeconds : 0;
  const measuredAxis = Math.hypot(parentAxis.x, parentAxis.y, parentAxis.z);
  const hasAxis = Number.isFinite(measuredAxis) && measuredAxis > 1e-12;
  const axisX = hasAxis ? parentAxis.x / measuredAxis : 1;
  const axisY = hasAxis ? parentAxis.y / measuredAxis : 0;
  const axisZ = hasAxis ? parentAxis.z / measuredAxis : 0;
  const measuredTargetRadius = Math.hypot(target.x, target.y, target.z);
  const hasTarget = Number.isFinite(measuredTargetRadius) && measuredTargetRadius > 1e-12;
  const targetRadius = Math.max(safeTarget, hasTarget ? measuredTargetRadius : safeTarget);
  const targetX = hasTarget ? target.x / measuredTargetRadius : axisX;
  const targetY = hasTarget ? target.y / measuredTargetRadius : axisY;
  const targetZ = hasTarget ? target.z / measuredTargetRadius : axisZ;

  if (!route.ready) {
    const measuredStartRadius = Math.hypot(start.x, start.y, start.z);
    const hasStart = Number.isFinite(measuredStartRadius) && measuredStartRadius > 1e-12;
    route.startRadius = Math.max(
      safeStart,
      hasStart ? measuredStartRadius : targetRadius,
    );
    const startX = hasStart ? start.x / measuredStartRadius : axisX;
    const startY = hasStart ? start.y / measuredStartRadius : axisY;
    const startZ = hasStart ? start.z / measuredStartRadius : axisZ;
    const startDot = clampUnit(startX * axisX + startY * axisY + startZ * axisZ);
    route.startAngle = Math.acos(startDot);
    let tangentX = startX - axisX * startDot;
    let tangentY = startY - axisY * startDot;
    let tangentZ = startZ - axisZ * startDot;
    const tangentLength = Math.hypot(tangentX, tangentY, tangentZ);
    if (tangentLength > 1e-12) {
      tangentX /= tangentLength;
      tangentY /= tangentLength;
      tangentZ /= tangentLength;
    } else {
      const tangent = perpendicularTo(axisX, axisY, axisZ);
      tangentX = tangent.x;
      tangentY = tangent.y;
      tangentZ = tangent.z;
    }
    route.axisX = axisX;
    route.axisY = axisY;
    route.axisZ = axisZ;
    route.anchorX = tangentX;
    route.anchorY = tangentY;
    route.anchorZ = tangentZ;
    const targetDot = clampUnit(
      targetX * axisX + targetY * axisY + targetZ * axisZ,
    );
    route.targetAngle = Math.acos(targetDot);
    let targetTangentX = targetX - axisX * targetDot;
    let targetTangentY = targetY - axisY * targetDot;
    let targetTangentZ = targetZ - axisZ * targetDot;
    const targetTangentLength = Math.hypot(
      targetTangentX,
      targetTangentY,
      targetTangentZ,
    );
    if (targetTangentLength > 1e-12) {
      targetTangentX /= targetTangentLength;
      targetTangentY /= targetTangentLength;
      targetTangentZ /= targetTangentLength;
    } else {
      targetTangentX = tangentX;
      targetTangentY = tangentY;
      targetTangentZ = tangentZ;
    }
    route.targetMotion = {
      axisX,
      axisY,
      axisZ,
      anchorX: targetTangentX,
      anchorY: targetTangentY,
      anchorZ: targetTangentZ,
    };
    route.targetRadius = targetRadius;
    route.outwardSeconds = route.startAngle
      / CONFIG.moonFocusAngularRateRadiansPerSecond;
    route.radialSeconds = Math.abs(Math.log(targetRadius / route.startRadius))
      / CONFIG.moonFocusRadialLogRatePerSecond;
    route.targetSeconds = Math.PI / CONFIG.moonFocusAngularRateRadiansPerSecond;
    route.elapsed = 0;
    const initialStartCap = Number.isFinite(maximumStartAngle)
      ? Math.max(0, Math.min(Math.PI, maximumStartAngle))
      : 0;
    route.outputAngle = Math.min(route.startAngle, initialStartCap);
    route.done = false;
    route.ready = true;
  }

  const tangent = transportParentTangent(route, axisX, axisY, axisZ, orbitNormal);
  const targetTangent = transportParentTangent(
    route.targetMotion,
    axisX,
    axisY,
    axisZ,
    orbitNormal,
  );
  route.elapsed += dt;
  const outwardEnd = route.outwardSeconds;
  const radialEnd = outwardEnd + route.radialSeconds;
  const targetEnd = radialEnd + route.targetSeconds;
  let radius;
  let directionX;
  let directionY;
  let directionZ;

  if (route.elapsed < outwardEnd && route.outwardSeconds > 1e-12) {
    const progress = route.elapsed / route.outwardSeconds;
    const startCap = Number.isFinite(maximumStartAngle)
      ? Math.max(0, Math.min(Math.PI, maximumStartAngle))
      : 0;
    // A hidden start initially uses the endpoint-only cap. Store the emitted
    // angle so switching to the stricter full-moon cap cannot rebase the
    // remaining route or make a visible jump.
    const nominal = route.startAngle * (1 - progress);
    const angle = Math.min(route.outputAngle, nominal, startCap);
    route.outputAngle = angle;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    radius = route.startRadius;
    directionX = axisX * cosine + tangent.x * sine;
    directionY = axisY * cosine + tangent.y * sine;
    directionZ = axisZ * cosine + tangent.z * sine;
  } else if (route.elapsed < radialEnd && route.radialSeconds > 1e-12) {
    const progress = (route.elapsed - outwardEnd) / route.radialSeconds;
    radius = Math.exp(
      Math.log(route.startRadius)
        + progress * (Math.log(route.targetRadius) - Math.log(route.startRadius)),
    );
    directionX = axisX;
    directionY = axisY;
    directionZ = axisZ;
    route.outputAngle = 0;
  } else if (route.elapsed < targetEnd && route.targetSeconds > 1e-12) {
    const progress = (route.elapsed - radialEnd) / route.targetSeconds;
    const targetCap = Number.isFinite(maximumTargetAngle)
      ? Math.max(0, Math.min(Math.PI, maximumTargetAngle))
      : 0;
    const desiredAngle = Math.min(
      route.targetAngle * Math.max(0, Math.min(1, progress)),
      targetCap,
    );
    const previousAngle = Number.isFinite(route.outputAngle) ? route.outputAngle : 0;
    const maximumMove = CONFIG.moonFocusAngularRateRadiansPerSecond * dt;
    const theta = desiredAngle < previousAngle
      ? desiredAngle
      : Math.min(desiredAngle, previousAngle + maximumMove);
    route.outputAngle = theta;
    const cosine = Math.cos(theta);
    const sine = Math.sin(theta);
    radius = route.targetRadius;
    directionX = axisX * cosine + targetTangent.x * sine;
    directionY = axisY * cosine + targetTangent.y * sine;
    directionZ = axisZ * cosine + targetTangent.z * sine;
  } else {
    const targetCap = Number.isFinite(maximumTargetAngle)
      ? Math.max(0, Math.min(Math.PI, maximumTargetAngle))
      : 0;
    const desiredAngle = Math.min(route.targetAngle, targetCap);
    const previousAngle = Number.isFinite(route.outputAngle) ? route.outputAngle : 0;
    const maximumMove = CONFIG.moonFocusAngularRateRadiansPerSecond * dt;
    const angle = desiredAngle < previousAngle
      ? desiredAngle
      : Math.min(desiredAngle, previousAngle + maximumMove);
    route.outputAngle = angle;
    route.done = Math.abs(desiredAngle - angle) <= 1e-12;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return {
      x: (axisX * cosine + targetTangent.x * sine) * route.targetRadius,
      y: (axisY * cosine + targetTangent.y * sine) * route.targetRadius,
      z: (axisZ * cosine + targetTangent.z * sine) * route.targetRadius,
    };
  }

  route.done = false;
  return {
    x: directionX * radius,
    y: directionY * radius,
    z: directionZ * radius,
  };
}

/** Clear caller-owned path history when a moon camera context changes. */
export function resetParentGlobeContinuity(continuity, key = null) {
  if (!continuity) return;
  continuity.key = key;
  continuity.active = false;
  delete continuity.axisX;
  delete continuity.axisY;
  delete continuity.axisZ;
  delete continuity.anchorX;
  delete continuity.anchorY;
  delete continuity.anchorZ;
  delete continuity.normalX;
  delete continuity.normalY;
  delete continuity.normalZ;
  delete continuity.outputAngle;
  delete continuity.turnSign;
  delete continuity.inCore;
  delete continuity.settled;
}

function clampUnit(value) {
  return Math.min(1, Math.max(-1, value));
}

function parentGlobeCapDot(separation, cameraRadius, renderedRadius, near, moonRadius) {
  const safe = parentGlobeClearance(renderedRadius, near);
  const visibility = parentGlobeClearance(renderedRadius, 0);
  const diskRadius = Number.isFinite(moonRadius) && moonRadius > 0 ? moonRadius : 0;
  if (
    !(separation > visibility + diskRadius + 1e-12)
    || !(cameraRadius > diskRadius + 1e-12)
  ) return null;
  const endpointDot = (safe * safe - separation * separation - cameraRadius * cameraRadius)
    / (2 * cameraRadius * separation);
  let sightlineDot = -1;
  if (cameraRadius > separation - visibility) {
    const endpointSightline = Math.sqrt(Math.max(
      0,
      separation * separation
        - visibility * visibility
        - 2 * visibility * diskRadius,
    ));
    if (cameraRadius <= endpointSightline) {
      sightlineDot = (
        visibility * visibility - separation * separation - cameraRadius * cameraRadius
      ) / (2 * cameraRadius * separation);
    } else {
      const taper = 1 - (diskRadius / cameraRadius) ** 2;
      const clearSeparation = separation * separation - (visibility + diskRadius) ** 2;
      sightlineDot = -(
        (visibility + diskRadius) * diskRadius / cameraRadius
          + Math.sqrt(Math.max(0, taper * clearSeparation))
      ) / separation;
    }
  }
  return Math.max(-1, endpointDot, sightlineDot);
}

function perpendicularTo(x, y, z) {
  let px;
  let py;
  let pz;
  if (Math.abs(y) < 0.9) {
    px = z;
    py = 0;
    pz = -x;
  } else {
    px = 0;
    py = z;
    pz = -y;
  }
  const length = Math.hypot(px, py, pz) || 1;
  return { x: px / length, y: py / length, z: pz / length };
}

function normalizedOrbitNormal(orbitNormal, continuity) {
  let x = orbitNormal?.x;
  let y = orbitNormal?.y;
  let z = orbitNormal?.z;
  const length = Math.hypot(x, y, z);
  if (!(length > 1e-12)) return null;
  x /= length;
  y /= length;
  z /= length;
  if (
    Number.isFinite(continuity.normalX)
    && x * continuity.normalX + y * continuity.normalY + z * continuity.normalZ < 0
  ) {
    x = -x;
    y = -y;
    z = -z;
  }
  continuity.normalX = x;
  continuity.normalY = y;
  continuity.normalZ = z;
  return { x, y, z };
}

function tangentFromNormal(normal, axisX, axisY, axisZ) {
  if (!normal) return null;
  const along = normal.x * axisX + normal.y * axisY + normal.z * axisZ;
  const x = normal.x - axisX * along;
  const y = normal.y - axisY * along;
  const z = normal.z - axisZ * along;
  const length = Math.hypot(x, y, z);
  return length > 1e-12 ? { x: x / length, y: y / length, z: z / length } : null;
}

function rotateAroundAxis(x, y, z, axisX, axisY, axisZ, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const dot = axisX * x + axisY * y + axisZ * z;
  const turnX = axisY * z - axisZ * y;
  const turnY = axisZ * x - axisX * z;
  const turnZ = axisX * y - axisY * x;
  return {
    x: x * cosine + turnX * sine + axisX * dot * (1 - cosine),
    y: y * cosine + turnY * sine + axisY * dot * (1 - cosine),
    z: z * cosine + turnZ * sine + axisZ * dot * (1 - cosine),
  };
}

function transportParentTangent(continuity, axisX, axisY, axisZ, orbitNormal = null) {
  const oldX = continuity.axisX;
  const oldY = continuity.axisY;
  const oldZ = continuity.axisZ;
  let anchorX = continuity.anchorX;
  let anchorY = continuity.anchorY;
  let anchorZ = continuity.anchorZ;
  const crossX = oldY * axisZ - oldZ * axisY;
  const crossY = oldZ * axisX - oldX * axisZ;
  const crossZ = oldX * axisY - oldY * axisX;
  const sine = Math.hypot(crossX, crossY, crossZ);
  const cosine = clampUnit(oldX * axisX + oldY * axisY + oldZ * axisZ);
  const normal = normalizedOrbitNormal(orbitNormal, continuity);
  if (normal) {
    const signedSine = normal.x * crossX + normal.y * crossY + normal.z * crossZ;
    let angle = Math.atan2(signedSine, cosine);
    // The supplied normal is signed in the rendered direction of travel. A
    // positive modulo keeps exact and near-antipodal samples on one branch.
    if (angle < -1e-12) angle += Math.PI * 2;
    if (Math.abs(signedSine) <= 1e-12 && cosine < 0) angle = Math.PI;
    const rotated = rotateAroundAxis(
      anchorX,
      anchorY,
      anchorZ,
      normal.x,
      normal.y,
      normal.z,
      angle,
    );
    anchorX = rotated.x;
    anchorY = rotated.y;
    anchorZ = rotated.z;
  } else if (sine > 1e-12) {
    const rotationX = crossX / sine;
    const rotationY = crossY / sine;
    const rotationZ = crossZ / sine;
    const rotated = rotateAroundAxis(
      anchorX,
      anchorY,
      anchorZ,
      rotationX,
      rotationY,
      rotationZ,
      Math.atan2(sine, cosine),
    );
    anchorX = rotated.x;
    anchorY = rotated.y;
    anchorZ = rotated.z;
  }
  // Projection removes harmless floating-point drift from the tangent plane.
  const along = anchorX * axisX + anchorY * axisY + anchorZ * axisZ;
  anchorX -= axisX * along;
  anchorY -= axisY * along;
  anchorZ -= axisZ * along;
  const length = Math.hypot(anchorX, anchorY, anchorZ);
  const anchor = length > 1e-12
    ? { x: anchorX / length, y: anchorY / length, z: anchorZ / length }
    : perpendicularTo(axisX, axisY, axisZ);
  continuity.axisX = axisX;
  continuity.axisY = axisY;
  continuity.axisZ = axisZ;
  continuity.anchorX = anchor.x;
  continuity.anchorY = anchor.y;
  continuity.anchorZ = anchor.z;
  return anchor;
}

function rawParentTangent(ux, uy, uz, axisX, axisY, axisZ, axisDot, fallback) {
  const px = ux - axisX * axisDot;
  const py = uy - axisY * axisDot;
  const pz = uz - axisZ * axisDot;
  const length = Math.hypot(px, py, pz);
  if (length > 1e-12) return { x: px / length, y: py / length, z: pz / length };
  return fallback ?? perpendicularTo(axisX, axisY, axisZ);
}

function continuousParentDirection(
  continuity,
  axisX,
  axisY,
  axisZ,
  ux,
  uy,
  uz,
  axisDot,
  boundaryDot,
  maximumAngularStep,
  orbitNormal,
) {
  const boundaryAngle = Math.acos(clampUnit(boundaryDot));
  const rawAngle = Math.acos(clampUnit(axisDot));
  const targetAngle = Math.min(rawAngle, boundaryAngle);
  const inwardAngle = Math.acos(clampUnit(-axisDot));
  const inwardBoundary = Math.acos(clampUnit(-boundaryDot));
  const inwardRatio = inwardBoundary > 1e-12
    ? inwardAngle / inwardBoundary
    : Infinity;
  if (!continuity.active) {
    const normal = normalizedOrbitNormal(orbitNormal, continuity);
    const fallback = tangentFromNormal(normal, axisX, axisY, axisZ);
    const startsInCore = inwardRatio <= 0.15;
    const anchor = startsInCore
      ? fallback ?? perpendicularTo(axisX, axisY, axisZ)
      : rawParentTangent(
        ux,
        uy,
        uz,
        axisX,
        axisY,
        axisZ,
        axisDot,
        fallback,
      );
    continuity.active = true;
    continuity.axisX = axisX;
    continuity.axisY = axisY;
    continuity.axisZ = axisZ;
    continuity.anchorX = anchor.x;
    continuity.anchorY = anchor.y;
    continuity.anchorZ = anchor.z;
    continuity.outputAngle = targetAngle;
    continuity.turnSign = 1;
    continuity.inCore = startsInCore;
    continuity.settled = true;
    return {
      x: axisX * Math.cos(targetAngle) + anchor.x * Math.sin(targetAngle),
      y: axisY * Math.cos(targetAngle) + anchor.y * Math.sin(targetAngle),
      z: axisZ * Math.cos(targetAngle) + anchor.z * Math.sin(targetAngle),
    };
  }

  let anchor = transportParentTangent(
    continuity,
    axisX,
    axisY,
    axisZ,
    orbitNormal,
  );
  let outputAngle = Math.min(
    Number.isFinite(continuity.outputAngle) ? continuity.outputAngle : targetAngle,
    boundaryAngle,
  );
  if (continuity.inCore) {
    continuity.inCore = inwardRatio < 0.35;
  } else {
    continuity.inCore = inwardRatio <= 0.15;
  }
  const targetTangent = continuity.inCore
    ? anchor
    : rawParentTangent(
      ux,
      uy,
      uz,
      axisX,
      axisY,
      axisZ,
      axisDot,
      anchor,
    );
  const crossX = anchor.y * targetTangent.z - anchor.z * targetTangent.y;
  const crossY = anchor.z * targetTangent.x - anchor.x * targetTangent.z;
  const crossZ = anchor.x * targetTangent.y - anchor.y * targetTangent.x;
  const phaseSine = axisX * crossX + axisY * crossY + axisZ * crossZ;
  const phaseCosine = clampUnit(
    anchor.x * targetTangent.x
      + anchor.y * targetTangent.y
      + anchor.z * targetTangent.z,
  );
  let phase = Math.atan2(phaseSine, phaseCosine);
  if (Math.abs(phaseSine) <= 1e-12 && phaseCosine < 0) {
    const normal = normalizedOrbitNormal(orbitNormal, continuity);
    if (normal) {
      const towardNormal = axisX * (anchor.y * normal.z - anchor.z * normal.y)
        + axisY * (anchor.z * normal.x - anchor.x * normal.z)
        + axisZ * (anchor.x * normal.y - anchor.y * normal.x);
      phase = Math.sign(towardNormal || continuity.turnSign || 1) * Math.PI;
    } else {
      phase = (continuity.turnSign || 1) * Math.PI;
    }
  }
  if (Math.abs(phase) > 1e-12) continuity.turnSign = Math.sign(phase);

  let remaining = Number.isFinite(maximumAngularStep)
    ? Math.max(0, maximumAngularStep)
    : Infinity;
  let phaseMove = phase;
  const polarSine = Math.sin(outputAngle);
  if (Number.isFinite(remaining) && Math.abs(phase) > 1e-12 && polarSine > 1e-12) {
    const allowedCosine = (
      Math.cos(Math.min(Math.PI, remaining)) - Math.cos(outputAngle) ** 2
    ) / (polarSine * polarSine);
    const allowedPhase = Math.acos(clampUnit(allowedCosine));
    phaseMove = Math.sign(phase) * Math.min(Math.abs(phase), allowedPhase);
    const used = Math.acos(clampUnit(
      Math.cos(outputAngle) ** 2 + polarSine * polarSine * Math.cos(phaseMove),
    ));
    remaining = Math.max(0, remaining - used);
  }
  if (phaseMove !== 0) {
    anchor = rotateAroundAxis(
      anchor.x,
      anchor.y,
      anchor.z,
      axisX,
      axisY,
      axisZ,
      phaseMove,
    );
  }
  const polarMove = targetAngle - outputAngle;
  outputAngle += Math.sign(polarMove) * Math.min(Math.abs(polarMove), remaining);
  continuity.anchorX = anchor.x;
  continuity.anchorY = anchor.y;
  continuity.anchorZ = anchor.z;
  continuity.outputAngle = outputAngle;

  const caughtPhase = Math.abs(phase - phaseMove) <= 1e-10
    || Math.sin(targetAngle) <= 1e-12;
  const caughtPolar = Math.abs(targetAngle - outputAngle) <= 1e-10;
  continuity.settled = caughtPhase && caughtPolar;
  if (axisDot >= boundaryDot && caughtPhase && caughtPolar) continuity.active = false;
  const cosine = Math.cos(outputAngle);
  const sine = Math.sin(outputAngle);
  return {
    x: axisX * cosine + anchor.x * sine,
    y: axisY * cosine + anchor.y * sine,
    z: axisZ * cosine + anchor.z * sine,
  };
}

/**
 * Keep a moon-focused camera and its sightline outside the parent globe.
 * Endpoint- and sightline-clear seats stay exact. Blocked seats slide on
 * their focus sphere; optional caller-owned history carries the slide
 * continuously through the singular parent-facing axis. The three focus
 * offsets are the rendered moon center relative to the parent; options may
 * carry `{ moonRadius, continuity, key, maximumAngularStep, orbitNormal }`.
 */
export function resolveParentGlobePoint(
  cameraX,
  cameraY,
  cameraZ,
  parentX,
  parentY,
  parentZ,
  renderedRadius,
  near,
  focusOffsetX = 0,
  focusOffsetY = 0,
  focusOffsetZ = 0,
  options = null,
) {
  const safe = parentGlobeClearance(renderedRadius, near);
  const dx = cameraX - parentX;
  const dy = cameraY - parentY;
  const dz = cameraZ - parentZ;
  const dist = Math.hypot(dx, dy, dz);
  const continuity = options?.continuity ?? null;
  const key = options?.key ?? null;
  if (continuity && continuity.key !== key) resetParentGlobeContinuity(continuity, key);
  if (!(safe > 0)) {
    if (continuity) continuity.active = false;
    return { x: cameraX, y: cameraY, z: cameraZ };
  }

  const sep = Math.hypot(focusOffsetX, focusOffsetY, focusOffsetZ);
  const ox = cameraX - parentX - focusOffsetX;
  const oy = cameraY - parentY - focusOffsetY;
  const oz = cameraZ - parentZ - focusOffsetZ;
  const radius = Math.hypot(ox, oy, oz);
  const moonRadius = Number.isFinite(options?.moonRadius) && options.moonRadius > 0
    ? options.moonRadius
    : 0;
  const need = parentGlobeCapDot(sep, radius, renderedRadius, near, moonRadius);
  if (need != null) {
    const dhatX = focusOffsetX / sep;
    const dhatY = focusOffsetY / sep;
    const dhatZ = focusOffsetZ / sep;
    const ux = ox / radius;
    const uy = oy / radius;
    const uz = oz / radius;
    const uDot = ux * dhatX + uy * dhatY + uz * dhatZ;
    if (need <= 1 && uDot >= need && !continuity?.active) {
      return { x: cameraX, y: cameraY, z: cameraZ };
    }
    if (need <= 1) {
      if (continuity) {
        const direction = continuousParentDirection(
          continuity,
          dhatX,
          dhatY,
          dhatZ,
          ux,
          uy,
          uz,
          uDot,
          need,
          options?.maximumAngularStep,
          options?.orbitNormal,
        );
        if (!continuity.active && uDot >= need) {
          return { x: cameraX, y: cameraY, z: cameraZ };
        }
        return {
          x: parentX + focusOffsetX + direction.x * radius,
          y: parentY + focusOffsetY + direction.y * radius,
          z: parentZ + focusOffsetZ + direction.z * radius,
        };
      }
      const tangent = rawParentTangent(
        ux,
        uy,
        uz,
        dhatX,
        dhatY,
        dhatZ,
        uDot,
        tangentFromNormal(options?.orbitNormal, dhatX, dhatY, dhatZ),
      );
      const slide = Math.sqrt(Math.max(0, 1 - need * need));
      return {
        x: parentX + focusOffsetX + (dhatX * need + tangent.x * slide) * radius,
        y: parentY + focusOffsetY + (dhatY * need + tangent.y * slide) * radius,
        z: parentZ + focusOffsetZ + (dhatZ * need + tangent.z * slide) * radius,
      };
    }
  }

  if (continuity) continuity.active = false;
  if (dist >= safe) return { x: cameraX, y: cameraY, z: cameraZ };

  let rx = dx;
  let ry = dy;
  let rz = dz;
  let rd = dist;
  if (!(rd > 1e-12)) {
    rx = focusOffsetX;
    ry = focusOffsetY;
    rz = focusOffsetZ;
    rd = sep;
    if (!(rd > 1e-12)) {
      rx = 1;
      ry = 0;
      rz = 0;
      rd = 1;
    }
  }
  const scale = safe / rd;
  return {
    x: parentX + rx * scale,
    y: parentY + ry * scale,
    z: parentZ + rz * scale,
  };
}

/** Global canvas shortcuts must yield to native and editable controls. */
export function isShortcutTargetInteractive(target) {
  for (let node = target; node; node = node.parentElement) {
    const tag = String(node.tagName || "").toUpperCase();
    if (["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"].includes(tag)) return true;
    if (node.isContentEditable || node.getAttribute?.("contenteditable") === "true") return true;
  }
  return false;
}

/** Honest clock-rate label. Hours below 1 day/sec; days, months, years above. */
export function formatDaysPerSecond(daysPerSecond) {
  if (daysPerSecond >= 365) return `${(daysPerSecond / 365.25).toFixed(1)} yr`;
  if (daysPerSecond >= 30) return `${(daysPerSecond / 30.437).toFixed(1)} mo`;
  if (daysPerSecond >= 1) return `${daysPerSecond.toFixed(daysPerSecond >= 10 ? 0 : 1)} d`;
  return `${(daysPerSecond * 24).toFixed(0)} h`;
}

export function describeDaysPerSecond(daysPerSecond) {
  let value;
  let unit;
  if (daysPerSecond >= 365) {
    value = Number((daysPerSecond / 365.25).toFixed(1));
    unit = "year";
  } else if (daysPerSecond >= 30) {
    value = Number((daysPerSecond / 30.437).toFixed(1));
    unit = "month";
  } else if (daysPerSecond >= 1) {
    value = Number(daysPerSecond.toFixed(daysPerSecond >= 10 ? 0 : 1));
    unit = "day";
  } else {
    value = Number((daysPerSecond * 24).toFixed(0));
    unit = "hour";
  }
  return `${value} ${unit}${value === 1 ? "" : "s"} per second`;
}
