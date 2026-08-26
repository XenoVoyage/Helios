# Helios contributor instructions

Read this file and [REPOSITORY_STANDARD.md](REPOSITORY_STANDARD.md) at the start
of every task. Together they are the repository-local contract for human and AI
contributors. This file supplies the Helios-specific overlay; the linked
standard owns reusable policy.

**Repository Standard:** [Repository Standard](REPOSITORY_STANDARD.md)
**Standard Status:** adopting

`adopting` is intentional until the required physical touch-device review, the
remaining third-party provenance gaps, and the required-check source binding or
documented exception are closed. Do not claim `verified` from automated checks
alone.

## Priorities

1. Keep the orrery local, private, and working on both desktop and touch.
2. Ship the smallest complete change with one owner per responsibility.
3. Preserve published NASA, JPL, IAU, SIMBAD, Planck, and NED values. Only the
   documented visual scale, galaxy kpc/cluster Mpc/universe Gpc mapping, and
   time slider intentionally diverge from 1:1.
4. Resolve one issue at a time through protected Alpha Development, except for
   the documented emergency hotfix path.
5. Verify the complete frozen candidate before opening or updating a pull
   request.

## Ownership

| Area | Owner |
| --- | --- |
| Runtime tunables and visual scale | `js/config.js` |
| Body catalog, Kepler math, visual mapping | `js/bodies.js` |
| Simulation clock and date boundary | `js/time.js` |
| Scene, camera, input, HUD | `js/app.js` |
| Focus orbit, axis, and spin marks | `js/helpers.js` |
| Celestial sphere | `js/sky.js`, `js/sky-catalog.js`, `assets/sky/` |
| Galactic neighborhood, Local Group, Virgo, 2MRS, outer density, CMB, and observable universe | `js/galaxy.js`, `js/galaxy-catalog.js`, `js/cosmic-web.js`, `js/2mrs-data.js` |
| Semantic shell and CSP | `index.html` |
| Presentation | `styles.css` |
| Public product version | `VERSION.txt` (`js/config.js` must match) |
| Scientific and asset provenance | `PROVENANCE.md` |
| Reusable contributor policy | `REPOSITORY_STANDARD.md` |
| Helios-specific contributor contract | `AGENTS.md` |
| Human introduction | `README.md` |

`js/2mrs-data.js` is a generated, hash-verified payload. Read its metadata
header—not the base64 body—unless the task specifically owns catalog
regeneration or data integrity. `scripts/build-2mrs.mjs` is its canonical
generator.

Public product releases use `vYYYY.M.D<suffix>` without zero-padding. Increment
the lowercase suffix for another release on the same date. `VERSION.txt` is
canonical; `CONFIG.VERSION` and the README badge are intentional mirrors.

## Product boundaries

- Helios is a local interactive orrery. GitHub Pages serves the repository root
  from `/Helios/`.
- Runtime is HTML, CSS, ES modules, and the pinned Three.js modules in `vendor/`
  (`three.module.min.js` plus its `three.core.min.js` import). Three.js owns
  graphics primitives only; orbits, time, and focus remain project modules.
- Touch is required: one-finger orbit, pinch zoom, tap-to-select, 44px controls,
  and no hover-only UI. Desktop requires mouse orbit/zoom, click-to-select,
  Space, `+`, `-`, and Escape.
- The supported body set is exactly the Sun, eight planets, Moon, Phobos,
  Deimos, Io, Europa, Ganymede, Callisto, Titan, Triton, Pluto, and Ceres as
  listed in `js/bodies.js`. Do not add extra moons.
- Do not add accounts, telemetry, runtime CDNs, a physics engine, or speculative
  application architecture.

## Frozen approved behavior

Unless the selected issue explicitly requires a bounded change, preserve the
owner-approved J2000 scientific data and object coordinates; Solar System;
camera and scale transitions; label and visual hierarchy; spherical distant
sky; 2MRS and cosmic-web transition; warm CMB observable-universe view;
controls; accessibility; performance; responsive behavior; dependencies;
product version; provenance; and all unrelated runtime behavior.

Issue #44 exclusively owns Saturn's back-facing ring-shading correction. Do not
change Saturn ring material, shading, texture, UVs, geometry, lighting, or
related rendering unless #44 is the selected current issue and its live
acceptance criteria have been read. Testing Saturn in another issue does not
activate #44; any unrelated ring delta is a regression.

## Verification

- From a clean checkout, run `npm ci` and `npx playwright install chromium`.
  CI uses Playwright's `--with-deps` variant on Linux.
- `npm test` runs the static contract, body, scale, Kepler, sky, galaxy,
  cosmic-web, time, HTTP, browser, WebGL, desktop, and touch-sized checks.
- `npm run test:static` runs deterministic and HTTP checks without a browser.
- `npm run serve` serves the Pages-equivalent path at
  `http://127.0.0.1:4173/Helios/`.
- Add a focused regression for every confirmed math, catalog, or behavior
  defect. Inspect console/runtime errors and perform the issue's applicable
  accessibility, performance, responsive, keyboard, pointer, and touch checks.
- Compare rendered output with the recorded task base and the owner-approved
  visual baseline. Browser automation is not physical-device proof.

## Helios issues and release flow

Search open and closed issues and pull requests before acting. Use the
repository issue form and the standard title
`[SEVERITY][Area] Imperative outcome`, where severity is `CRITICAL`, `HIGH`,
`MEDIUM`, or `LOW`. Keep one independently testable issue per branch and pull
request; the issue body is its scope and acceptance contract.

`main` is protected owner-approved production. `develop` is the protected
long-lived **Alpha Development** integration branch. Neither accepts direct
changes, force pushes, deletion, or bypassed checks. Both require pull requests
and the exact `Audit / audit` check. GitHub Pages deploys only from `main`.

1. Refresh protected `develop`; confirm its commit/tree, passing Audit, and open
   work; then select the next dependency-ready issue.
2. Create `agent/issue-<number>-<description>` from that exact `develop` head.
   Do not reuse a branch or combine issues.
3. Open a draft pull request to `develop`. The issue gate, complete diff and
   visual audit, required checks, and explicit owner approval must pass before
   owner integration.
4. Prove the merged task branch is inactive, unprotected, has no open pull
   request or unique commit, and is unused before deleting it. Never delete
   `main`, `develop`, a release branch, or unique work.
5. Re-audit exact `develop`, complete owner Alpha testing, and promote the
   accepted issue through a protected `develop` to `main` release pull request
   before starting the next issue unless the owner explicitly authorizes a
   small ordered independent group.
6. After owner merge, require the new exact-main Audit and Pages deployment,
   verify production, and prove `develop` is contained in `main` and
   tree-equivalent. Synchronize genuine main-only hotfix or release content back
   through reviewed non-force history; never manufacture an empty sync pull
   request.

An emergency production fix uses `hotfix/issue-<number>-<description>` from the
latest `main`, follows the same draft-PR, complete-audit, and owner-approval
gate, and is integrated into `develop` before other work. It is not a routine
shortcut.

Agents must not merge or change repository settings. The owner controls
protection and merge approval. Draft pull requests must record their type and
base, issue, base and candidate commits/trees, files, commands/results, desktop
and touch evidence, visual comparison, risks, rollback, and unavailable manual
or physical verification.

## Cleanup and definition of done

- Delete code or assets only after proving they have no runtime, test,
  documentation, provenance, build, or deployment owner. Preserve unfamiliar,
  unrelated, or unclear work.
- Record primary evidence and transformations in `PROVENANCE.md`; never invent
  missing scientific data or imagery.
- The diff is the smallest complete fix, contains no unrelated redesign, and
  accounts for every changed, added, generated, and deleted file.
- `npm test` passes from a clean checkout on the Node 22 baseline declared in
  `package.json` and the workflows, including browser/WebGL checks. CI on the
  exact candidate is authoritative.
- Documentation, provenance, product-version mirrors, tests, templates,
  workflows, and `Audit / audit` agree with the candidate.
- Desktop and touch-sized rendered evidence is reviewed. Physical observations
  remain separately labelled.
- A final audit proves this issue is the only behavior owner for the branch and
  all unrelated approved behavior remains unchanged.
