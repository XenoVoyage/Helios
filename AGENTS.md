# Helios contributor instructions

Read this file at the start of every task. It is the repository-local contract for human and AI contributors.

## Priorities

1. Keep the orrery local, private, and working on both desktop and touch.
2. Ship the smallest complete change. One owner per responsibility.
3. Preserve published NASA / JPL values. Only the visual scale and time slider are allowed to diverge from 1:1.
4. Verify before opening or updating a pull request.

## Ownership

| Area | Owner |
| --- | --- |
| Runtime tunables and visual scale | `js/config.js` |
| Body catalog, Kepler math, visual mapping | `js/bodies.js` |
| Scene, camera, input, HUD | `js/app.js` |
| Semantic shell and CSP | `index.html` |
| Presentation | `styles.css` |
| Public version label | `VERSION.txt` (`js/config.js` must match) |
| Agent contract | `AGENTS.md` |
| Human introduction | `README.md` |

Do not add managers, services, factories, event buses, plugin systems, accounts, telemetry, CDNs, or a physics engine. Split a file only when a new boundary has a small explicit interface.

## Product boundaries

- Helios is a local interactive orrery. GitHub Pages serves the repository root from `/Helios/`.
- Runtime is HTML, CSS, ES modules, and the pinned Three.js modules in `vendor/` (`three.module.min.js` plus its `three.core.min.js` import).
- Three.js owns graphics primitives only. Orbits, time, and focus live in our modules.
- Touch is required: one-finger orbit, pinch zoom, tap-to-select, 44px controls, no hover-only UI.
- Desktop: mouse orbit/zoom, click-to-select, Space / `+` / `-` / Escape.
- v1 bodies are exactly those listed in `js/bodies.js`. Do not add extra moons.

## Verification

- `npm test` runs the static contract check, body/scale/Kepler tests, and an HTTP smoke of the Pages path.
- `npm run serve` is the Pages-equivalent local path: `http://127.0.0.1:4173/Helios/`.
- Add a regression for a confirmed math or catalog defect.
- Audit desktop and touch before calling a change done. Browser automation is not physical-device proof.

## Git

Treat `main` as protected. Never push to it, force-push it, delete it, or bypass it.

Work on a short-lived `agent/<description>` branch from the current default-branch head. Open a draft pull request when the work is ready. Required CI must pass on that pull request before merge.

Agents must not merge and must not change GitHub repository settings. Until the first playable phase is on `main`, **Smarty** (the coordinating developer) may merge this repository after required checks pass. After that phase, merge only with a new explicit authorization. Smarty enables branch protection in the GitHub UI; this repository only supplies the files and the `Test` workflow.

Draft PRs must include how to run tests and what was verified on desktop and touch.
