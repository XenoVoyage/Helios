# Helios contributor instructions

Read this file at the start of every task. It is the repository-local contract for human and AI contributors.

**Project Engineering Standard:** v1.1
**Standard Status:** adopting

`adopting` is intentional until the required physical touch-device review and
the remaining third-party provenance gaps are closed. Do not claim a stronger
status from automated checks alone.

## Priorities

1. Keep the orrery local, private, and working on both desktop and touch.
2. Ship the smallest complete change. One owner per responsibility.
3. Preserve published NASA / JPL / IAU / SIMBAD / Planck / NED values. Only the visual scale, the galaxy kpc / cluster Mpc / universe Gpc mapping, and the time slider are allowed to diverge from 1:1.
4. Resolve one issue at a time through the Alpha Development integration gate,
   except for the documented emergency hotfix path.
5. Verify before opening or updating a pull request.

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

## Issue workflow

Search open and closed issues and pull requests before filing or implementing
work. Update the canonical report instead of creating a duplicate. Use the
repository issue form; its required title is
`[CRITICAL|HIGH|MEDIUM|LOW][Area] Imperative outcome`.

- **Critical:** release-blocking security, privacy, data-loss, availability, or
  scientific-integrity failure requiring immediate owner attention.
- **High:** core correctness, accessibility, security, or scientific behavior
  is materially wrong and has no reasonable workaround.
- **Medium:** important but recoverable behavior, compatibility, performance,
  or cross-device defect.
- **Low:** bounded edge case, maintenance, documentation, QA, or hardening work
  without current severe user impact.

Every issue must identify the exact baseline commit/tree and environment;
expected and actual behavior; reproducible evidence; smallest scope and
explicit non-goals; dependencies and recommended order; objective acceptance
criteria; test and visual evidence requirements; risks; and rollback. Mark
measured, inferred, automated, simulated, and physical-device evidence
honestly. Never include secrets or private data.

Implement one issue per branch and pull request. Order work by dependency first,
then Critical, High, Medium, and Low severity. Finish the full regression,
visual, and diff audit for the current issue before starting the next one. If a
fix reveals a separate problem, file or update a separate issue instead of
silently expanding scope.

## Dependencies and maintenance

Use the latest suitable production-supported LTS line when an ecosystem offers
LTS releases; otherwise use the latest suitable stable line. A Current-only,
preview, release-candidate, or nightly release is compatibility evidence, not
the production baseline, unless the owner explicitly approves it after the
full gate. Do not retain an unsupported or end-of-life runtime without a
documented, time-bounded owner exception.

- Review runtime support/EOL status, advisories, and relevant stable releases at
  release gates and when a security notice or compatibility need appears.
- Update one dependency or tightly coupled toolchain group per issue. Read
  release notes and migration guidance; measure bundle/startup/runtime impact;
  run the complete gate; and keep a clear rollback. Do not mix upgrades into an
  unrelated behavioral fix.
- Add a dependency only when it is genuinely needed and smaller/safer than clear
  project-owned code. Require an official source, available source code, a
  compatible free/open-source license or explicit owner exception, active
  maintenance, security health, useful documentation, and broad ecosystem
  trust or a documented exception. Popularity is evidence, not proof of safety.
- Pin and lock reproducible versions. Keep GitHub Actions pinned to immutable
  commit SHAs with readable version comments. Review material transitive code,
  licenses, install/build scripts, runtime network behavior, and maintenance
  cost. Remove dependencies that no longer justify themselves.
- Do not adopt or retain a dependency with a known unresolved critical
  vulnerability unless no safer path exists and the owner approves documented
  compensating controls plus a time-bounded removal or upgrade plan.
- Treat urgent security fixes separately from routine currency. Never upgrade
  merely to claim the highest version number, and never retain an unsupported
  runtime without an owner-approved, time-bounded reason.

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
- The issue remains the only behavior owner for the branch, and a final audit
  confirms that unrelated approved behavior is unchanged.

## Git and release flow

`main` is the protected, owner-approved production branch. `develop` is the
protected long-lived **Alpha Development** integration branch. Neither branch
accepts direct changes, force-pushes, deletion, or bypassed checks. GitHub Pages
deploys only from `main`.

After the v1.1 bootstrap is merged and `develop` is created from that exact
`main` commit:

1. Refresh `develop`, confirm its commit/tree and open work, and choose the next
   dependency-ready issue.
2. Create `agent/issue-<number>-<description>` from the latest `develop`. Do not
   reuse a branch or combine issues.
3. Open a draft pull request back to `develop`. Required CI, the full issue
   acceptance gate, complete diff audit, and owner approval must pass before the
   owner merges it.
4. Delete the merged short-lived branch explicitly after proving it is merged,
   has no open PR or unique commit, is not protected/default/release, and is
   unused by a worktree. Do not enable repository-wide automatic deletion
   unless protected `develop` is proven exempt.
5. Re-audit `develop`, complete owner Alpha testing, and promote the accepted
   issue through the release path before beginning the next issue. The owner
   may explicitly authorize a small ordered batch of independent issues, but
   each issue still receives its own branch, PR, acceptance gate, and audit.

For a production release, freeze new issue work, run the complete integrated
desktop/touch/WebGL/visual audit on `develop`, record owner testing, and open a
release pull request from `develop` to `main`. The promotion candidate must pass
`Audit / audit` before owner merge. After merge, both the new `main` Audit and
Pages deployment must pass before the release is declared complete. Verify that
`develop` is contained in `main` and tree-equivalent to the released content;
do not manufacture an empty synchronization PR. If `main` gained a hotfix,
release-only change, or other main-only content, merge it back into `develop`
through a reviewed non-force workflow before new issue work.

The v1.1 bootstrap pull request is the one documented exception: it targets
`main` under the existing v1.0 workflow so CI can be taught about `develop`.
Only after that PR is owner-approved and merged should the owner create and
protect `develop` at the exact new `main` revision.

An emergency production fix uses `hotfix/issue-<number>-<description>` from the
latest `main`, follows the same draft-PR, full-audit, and owner-approval gate,
and is then synchronized into `develop` before any other issue work. Do not use
the hotfix path for routine priority or convenience.

Agents must not merge and must not change GitHub repository settings. The owner
must protect both `main` and `develop` with pull requests, blocked deletion and
force-pushes, and the required `Audit / audit` check.

Draft PRs must identify their type and base, issue, base/candidate commit and
tree, changed files, exact commands/results, desktop/touch and visual evidence,
risks, rollback, and any unavailable manual or physical verification.
