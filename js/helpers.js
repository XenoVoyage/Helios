/**
 * Selection-only orbit, spin-axis, and spin-direction marks.
 * Visual helpers. They do not change NASA / JPL motion.
 */
import {
  findBody,
  keplerPathOffset,
  moonOrbitAttachment,
  renderedSpinPeriod,
  visualBodyRadius,
} from "./bodies.js";

const AXIS_COLOR = 0xff57d8;
const SPIN_COLOR = 0x66f7ff;
const ORBIT_COLOR = 0x66f7ff;

export function createFocusHelpers(THREE) {
  const group = new THREE.Group();
  group.name = "focus-helpers";

  const orbit = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: ORBIT_COLOR, transparent: true, opacity: 0.9 }),
  );
  orbit.name = "helper-orbit";
  orbit.frustumCulled = false;

  const axis = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: AXIS_COLOR, transparent: true, opacity: 0.95 }),
  );
  axis.name = "helper-axis";

  const spin = new THREE.Group();
  spin.name = "helper-spin";

  group.add(orbit);
  group.add(axis);
  group.add(spin);
  group.visible = false;
  return { group, orbit, axis, spin };
}

export function setHelperVisibility(helpers, { selected, orbit, axis, spin }) {
  const on = Boolean(selected);
  helpers.group.visible = on;
  helpers.orbit.visible = on && Boolean(orbit);
  helpers.axis.visible = on && Boolean(axis);
  helpers.spin.visible = on && Boolean(spin);
}

export function bindFocusHelpers(THREE, helpers, { body, node, parentNode, scene }) {
  const radius = visualBodyRadius(body);
  rebuildAxis(THREE, helpers.axis, radius);
  rebuildSpin(THREE, helpers.spin, radius, renderedSpinPeriod(body) < 0);
  node.tilt.add(helpers.axis);
  node.tilt.add(helpers.spin);

  const hasOrbit = Boolean(body.orbitDays);
  helpers.orbit.visible = helpers.orbit.visible && hasOrbit;
  if (!hasOrbit) {
    if (helpers.orbit.parent) helpers.orbit.parent.remove(helpers.orbit);
    helpers.group.add(helpers.orbit);
    return;
  }

  const parent = body.parent ? findBody(body.parent) : null;
  const points = [];
  for (let i = 0; i <= 180; i += 1) {
    const at = keplerPathOffset(body, parent, i / 180);
    points.push(new THREE.Vector3(at.x, at.y, at.z));
  }
  helpers.orbit.geometry.dispose();
  helpers.orbit.geometry = new THREE.BufferGeometry().setFromPoints(points);

  const attach = !parentNode
    ? scene
    : body.kind === "moon" && moonOrbitAttachment(body) === "parent-equatorial"
      ? parentNode.tilt
      : parentNode.pivot;
  attach.add(helpers.orbit);
}

function rebuildAxis(THREE, axis, radius) {
  const height = radius * 2.6;
  axis.geometry.dispose();
  axis.geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -height, 0),
    new THREE.Vector3(0, height, 0),
  ]);
}

function rebuildSpin(THREE, spin, radius, retrograde) {
  while (spin.children.length) {
    const child = spin.children.pop();
    child.geometry?.dispose();
    if (child.material) child.material.dispose();
  }

  const ring = radius * 1.55;
  const sweep = Math.PI * 1.55;
  const points = [];
  for (let i = 0; i <= 48; i += 1) {
    const t = i / 48;
    const angle = retrograde ? -t * sweep : t * sweep;
    points.push(new THREE.Vector3(Math.cos(angle) * ring, 0, Math.sin(angle) * ring));
  }
  spin.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: SPIN_COLOR, transparent: true, opacity: 0.92 }),
  ));

  const tipAngle = retrograde ? -sweep : sweep;
  const tangent = new THREE.Vector3(
    retrograde ? Math.sin(tipAngle) : -Math.sin(tipAngle),
    0,
    retrograde ? -Math.cos(tipAngle) : Math.cos(tipAngle),
  ).normalize();
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(radius * 0.14, radius * 0.36, 10),
    new THREE.MeshBasicMaterial({ color: SPIN_COLOR }),
  );
  cone.position.copy(points[points.length - 1]);
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
  spin.add(cone);
}
