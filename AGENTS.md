# Helios contributor instructions

Read this file at the start of every task. It is the repository-local contract for human and AI contributors.

**Project Engineering Standard:** v1.0
**Standard Status:** adopting

`adopting` is intentional until the required physical touch-device review and
the remaining third-party provenance gaps are closed. Do not claim a stronger
status from automated checks alone.

## Priorities

1. Keep the orrery local, private, and working on both desktop and touch.
2. Ship the smallest complete change. One owner per responsibility.
3. Preserve published NASA / JPL / IAU / SIMBAD / Planck / NED values. Only the visual scale, the galaxy kpc / cluster Mpc / universe Gpc mapping, and the time slider are allowed to diverge from 1:1.
4. Verify before opening or updating a pull request.

## Ownership

| Area | Owner |
| --- | --- |
| Runtime tunables and visual scale | `js/config.js` |
| Body catalog, Kepler math, visual mapping | `js/bodies.js` |
| Simulation clock and date boundary | `js/time.js` |
| Scene, camera, input, HUD | `js/app.js` |
| Focus orbit / axis / spin marks | `js/helpers.js` |
| Celestial sphere | `js/sky.js`, `js/sky-catalog.js`, `assets/sky/` |
| Galactic neighborhood, Local Group, Virgo, 2MRS / outer density, CMB / observable universe | `js/galaxy.js`, `js/galaxy-catalog.js`, `js/cosmic-web.js`, `js/2mrs-data.js` |
| Semantic shell and CSP | `index.html` |
| Presentation | `styles.css` |
| Public version label | `VERSION.txt` (`js/config.js` must match) |
| Scientific and asset provenance | `PROVENANCE.md` |
| Agent contract | `AGENTS.md` |
| Human introduction | `README.md` |

`js/2mrs-data.js` is a generated, hash-verified payload. Read its metadata
header—not the base64 body—unless the task is specifically catalog regeneration
or data-integrity work; `scripts/build-2mrs.mjs` is its canonical generator.

Do not add managers, services, factories, event buses, plugin systems, accounts, telemetry, CDNs, or a physics engine. Split a file only when a new boundary has a small explicit interface.

Public releases use `vYYYY.M.D<suffix>` without zero-padding. Increment the
lowercase suffix for another release on the same date. `VERSION.txt` is
canonical; `CONFIG.VERSION` and the README badge are intentional mirrors.

## Product boundaries

- Helios is a local interactive orrery. GitHub Pages serves the repository root from `/Helios/`.
- Runtime is HTML, CSS, ES modules, and the pinned Three.js modules in `vendor/` (`three.module.min.js` plus its `three.core.min.js` import).
- Three.js owns graphics primitives only. Orbits, time, and focus live in our modules.
- Touch is required: one-finger orbit, pinch zoom, tap-to-select, 44px controls, no hover-only UI.
- Desktop: mouse orbit/zoom, click-to-select, Space / `+` / `-` / Escape.
- v1 bodies are exactly those listed in `js/bodies.js`: Sun, 8 planets, the Moon, Phobos, Deimos, Io, Europa, Ganymede, Callisto, Titan, Triton, Pluto, and Ceres. Do not add extra moons.

## Verification

- From a clean checkout, run `npm ci` and `npx playwright install chromium` before the test suite. CI uses Playwright's `--with-deps` variant on Linux.
- `npm test` runs the static contract check, body/scale/Kepler tests, HTTP smoke, and browser/WebGL smoke.
- `npm run test:static` runs the deterministic checks without launching a browser.
- `npm run serve` is the Pages-equivalent local path: `http://127.0.0.1:4173/Helios/`.
- Add a regression for a confirmed math or catalog defect.
- Audit desktop and touch before calling a change done. Browser automation is not physical-device proof.

## Cleanup policy

- Preserve behavior and the approved visual baseline unless a confirmed issue requires a documented delta.
- Delete code or assets only after proving they have no runtime, test, documentation, or provenance owner.
- Prefer removing a false claim or unused abstraction over expanding the implementation to justify it.
- Keep one canonical owner and verify every intentional mirror. Do not add speculative compatibility layers.
- Record primary evidence and transformations in `PROVENANCE.md`; never invent missing scientific data or imagery.

## Definition of done

- The diff is the smallest complete fix, with no unrelated feature or visual redesign.
- `npm test` passes from a clean checkout on Node 22, including the browser/WebGL smoke.
- The complete branch diff is compared with the frozen base; expected visual or behavioral changes are listed.
- Normal desktop and touch-sized rendered evidence is reviewed. Physical-device observations remain separately labeled.
- Documentation, provenance, version mirrors, tests, and the `Audit / audit` required check match the candidate.

## Git

Treat `main` as protected. Never push to it, force-push it, delete it, or bypass it.

Work on a short-lived `agent/<description>` branch from the current default-branch head. Open a draft pull request when the work is ready. Required CI must pass on that pull request before merge.

Agents must not merge and must not change GitHub repository settings. Merge only after explicit user authorization and a passing `Audit / audit` check.

Draft PRs must include how to run tests and what was verified on desktop and touch.
