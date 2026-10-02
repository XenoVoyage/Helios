# Helios contributor instructions

Read this file and [REPOSITORY_STANDARD.md](REPOSITORY_STANDARD.md) at the start
of every task. Together they are the repository-local contract for human and AI
contributors. This file supplies the Helios-specific overlay; the linked
standard owns reusable policy.

**Repository Standard:** [Repository Standard](REPOSITORY_STANDARD.md)
**Standard Status:** adopting

`adopting` is intentional until retained physical touch-device evidence and the
remaining provenance gaps are complete. The owner reported earlier manual
testing and waived its missing record for that release in
[#73](https://github.com/XenoVoyage/Helios/issues/73#issuecomment-5823496477);
that historical exception is not a verified device matrix. Do not claim
`verified` from automated checks alone.

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
| Public product version | `VERSION.txt` (`CONFIG.VERSION` and README badge must match) |
| Scientific and asset provenance | `PROVENANCE.md` |
| Tracked image membership and SHA-256 | `tests/fixtures/asset-digest-manifest.json` |
| Reusable contributor policy | `REPOSITORY_STANDARD.md` |
| Helios-specific contributor contract | `AGENTS.md` |
| Human introduction | `README.md` (short human intro; depth stays in this file and `PROVENANCE.md`) |

`js/2mrs-data.js` is a generated, hash-verified payload. Read its metadata
header—not the base64 body—unless the task specifically owns catalog
regeneration or data integrity. `scripts/build-2mrs.mjs` is its canonical
generator. The independent payload pin is `tests/fixtures/2mrs-integrity.json`.
`tests/fixtures/asset-digest-manifest.json` owns tracked image-file membership
and SHA-256 values recorded in `PROVENANCE.md`.

Every issue PR landing on `develop` increments the public product version in
all three mirrors together: canonical `VERSION.txt`, `CONFIG.VERSION` in
`js/config.js`, and the README badge's displayed text and URL. The first version
on a new date is `vYYYY.M.D` without zero-padding or a suffix; subsequent versions
on that date append `a`, `b`, `c`, etc. Refresh the live mirrors before choosing
the next version; never downgrade or overwrite a newer concurrent version.
Reconcile a concurrent bump before integration and rerun the candidate gate.

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

## Camera, time, and visual scale

`README.md` is the short human introduction. This section keeps the play,
camera, and scale contract. Survey limits, orbital source identity, and asset
terms stay in [PROVENANCE.md](PROVENANCE.md). Runtime knobs stay in
`js/config.js`.

Tap or click a world, including the Sun, to focus it. Drag to orbit. Pinch-out
zooms in; pinch-in zooms out. Play, pause, and the speed of time live on the
bottom bar. Close the body card with the X or by tapping empty space. Open
**Camera** for orbit and zoom buttons that work with a click, tap, or keyboard.
With the scene focused, the arrow keys orbit, **I** zooms in, and **O** zooms
out; hold a key to repeat. **Play** stays selected while time runs; activate it
again to pause. **Space** toggles the same state, **+ / −** change time speed,
and **Escape** resets the view. Camera commands preserve the same globe safety,
zoom limits, and scale transitions as drag, wheel, and pinch. The fixed
`?look=sky` diagnostic view has no camera navigation.

On viewports at most 840px wide or 500px high, normal body focus fits the
selected globe, rings, and label into the space left by visible controls.
This adjusts the projection without moving the physical camera or changing
moon safety paths. User zoom can still intentionally crop a globe at minimum
distance. Closing the card or returning to an unobstructed desktop view
restores the centered projection; picking and labels use the rendered view.

Zoom out past the solar overview and the orrery shrinks to a Sun among the
stars. The Hipparcos sky, IAU figures, and Gaia band stay at constant brightness
through the solar cap, so the first extra-zoom frame is already inside the
Milky Way tail. The moment the camera leaves that tail, that solar sky and the
Constellations control go off. The control offers Off, Major (the ten familiar
default names), and All; All packs eligible names inside the viewport with a
responsive collision budget. Extra-zoom sky from the tail through Virgo is a
camera-centered spherical point-density illustration with unresolved bright
concentrations and dark gaps. It has no cube faces, named generated objects, or
claimed survey coordinates. The neighborhood and Local Group use catalog
neighbors against that field. Virgo's center uses the catalog M87 direction
and cluster distance; its 58 unnamed galaxy sprites are a fixed-seed
illustration, not measured member positions. After Virgo, seven measured group
anchors lead into 42,927 public 2MRS galaxy directions with approximate
redshift distances; there are no
invented web connections. Beyond the survey's 300 Mpc display cap, a small
first-party density illustration provides continuity to the Planck-style CMB
shell. That shell is deliberately drawn at the particle-horizon display radius.
Leaving it is only an outside-camera/scale metaphor, not a physically possible
observer. We sit in the Local Group, inside Laniakea; Virgo is the nearest
large cluster, not our cluster in the same sense. Deep-space views include a
compact scene caption identifying the 2MRS survey, illustrative outer density,
and schematic CMB/observable-universe view. Reported catalog display limits and
display radii are context, not a linear on-screen ruler.

Time is independent of visual scale. Minimum: 1 simulated second per real
second. Default: 1 simulated hour per real second. Maximum: 400 simulated days
per real second. Background time catches up on return; JavaScript's last valid
date is the hard stop (`js/time.js`). The asteroid field sits between Mars and
Jupiter. The nominal Kuiper field runs about 30–50 AU. Both are sparse points,
not rock catalogs. Pluto's eccentric visual path crosses the Kuiper field's
drawn edges.

True 1:1 distances make every planet vanish beside the Sun. Helios combines
NASA / JPL reference data with inherited catalog approximations, then
compresses distances more than sizes so the system can be read at a glance.
The one planet-spacing knob is `CONFIG.visualScale` in `js/config.js`; it
multiplies a compressed AU curve (`orbitScale * AU^orbitPower`). Body sizes use
the same kind of curve (`sizeScale * (radius/Earth)^sizePower`). Moons share
that size curve. Moon distances stay a compressed real-radii map: outside their
parent, just outside any rings, and outside a readable gap from the next inner
sibling. Calendar positions use frozen two-body Kepler ellipses. They are not a
live Horizons ephemeris and they do not model perturbations.
Ceres's stored heliocentric state is one Horizons J2000 geometric snapshot; Neptune's six orbital elements are one JPL Approximate Positions Table 1 J2000 snapshot at T=0; other heliocentric rows retain inherited Keplerian approximations. Their
sidereal periods match dated NASA NSSDCA fact-sheet printings recorded in
[the orbital ledger](PROVENANCE.md#orbital-row-ledger); the remaining six
orbital fields still have explicit source gaps there. The Sun, planets, Ceres,
Pluto, the Moon, and Triton use fixed J2000 PCK poles. Earth, Moon, and Triton
also use verified prime-meridian phases; inherited maps without a retained
longitude-registration record keep their closest previous display roll rather
than claim an unverified scientific longitude. Except for the Moon and Triton,
synchronous moon rates only prevent secular longitudinal drift: their simple
axes and texture phases are not registered near-side models. The lunar model
shows bounded geometric libration but not the complete time-varying PCK model.
Lighting supplies a terminator and readable night-side fill, not cast shadows
or eclipses. The measured statements behind this summary are in
[PROVENANCE.md](PROVENANCE.md).

The Milky Way disk is a deterministic, stylized four-arm illustration. Its
catalog distances and the Sun's Orion Arm label are sourced, but the visible
arm particles are not a survey reconstruction. The 2MRS view is K-band
flux-limited, omits the Galactic Zone of Avoidance, and maps barycentric radial
velocity to `D=cz/H0` rather than correcting peculiar velocities. It must not
be read as a complete matter-density reconstruction. Cosmological point sizes
and additive brightness, the outer web's false-color palette, and the
strengthened CMB texture opacity are deliberately stylized for readability;
they are not photometrically calibrated measurements or literal structure
boundaries. The label hierarchy fades unreadable galaxy names into Local Group
context, keeps the Local Group and Virgo Cluster separate, and then rolls up
through the historical Local (Virgo) Supercluster and Laniakea Supercluster
before clearing for the web and CMB views. It describes spatial scale during
zoom, not object renaming, physical-size measurement, or cosmological time
evolution.

## Frozen approved behavior

Unless the selected issue explicitly requires a bounded change, preserve the
owner-approved J2000 scientific data and object coordinates; Solar System;
camera and scale transitions; label and visual hierarchy; spherical distant
sky; 2MRS and cosmic-web transition; warm CMB observable-universe view;
controls; accessibility; performance; responsive behavior; dependencies;
provenance; and all unrelated runtime behavior. Apply the required issue-PR
version increment above without bundling unrelated behavior.

Saturn's ring shading is frozen approved behavior. Preserve the owner-approved
back-facing transmitted-light term owned by `CONFIG.ringTransmission` (the
display-only share that keeps the unlit face's bands, divisions, and gaps
readable). Do not change Saturn ring material, shading, texture, UVs,
geometry, lighting, or related rendering unless the selected issue explicitly
requires a bounded change to that behavior. Any unrelated ring delta is a
regression. Issue #44 completed this correction on 2026-09-21 and is historical
context only, not an active owner gate.

## Verification

- From a clean checkout, run `npm ci` and `npx playwright install chromium`.
  CI uses Playwright's `--with-deps` variant on Linux.
- `npm test` runs the static contract, body, scale, Kepler, sky, galaxy,
  cosmic-web, time, HTTP, browser, WebGL, desktop, and touch-sized checks.
- `npm run test:static` runs deterministic and HTTP checks without a browser.
- `HELIOS_SCREENSHOT_DIR=browser-stills npm run test:browser -- --group <group>`
  runs one complete browser section from a clean checkout and empty evidence directory:
  `platform`, `desktop-scenes`, `desktop-bodies`, or `touch`. Without `--group`,
  the browser command retains the complete sequential local audit. CI runs the
  four sections on separate runners after static/HTTP checks pass; each artifact
  includes its source identity, completed section, duration and output hashes.
- Controlled visual captures save the final verified stable PNG for settled
  full-viewport views. The stability intervals, attempt limit, exact-image
  comparison, and semantic checks still apply. Moving views, crops, and failed
  settling acquire fresh images; buffers never carry across capture calls.
- `npm run serve` serves the Pages-equivalent path at
  `http://127.0.0.1:4173/Helios/`.
- Add a focused regression for every confirmed math, catalog, or behavior
  defect. Inspect console/runtime errors and perform the issue's applicable
  accessibility, performance, responsive, keyboard, pointer, and touch checks.
- Compare rendered output with the recorded task base and the owner-approved
  visual baseline. Browser automation is not physical-device proof.

### Physical touch-device verification

When recording physical verification, use Safari on a supported iPhone/iPad
and Chrome on a supported Android device, in portrait and landscape. Record
the exact commit/tree and URL, date, tester, device, OS/browser versions,
viewport, DPR, available WebGL renderer, and network/cache state in the issue
or pull request. Mark each check pass, fail, or untested; a reported earlier
test without this record does not fill a matrix cell.

1. Load the page; check WebGL startup/fallback, first interaction, and errors.
2. Orbit with one finger, pinch both ways, select a body, clear it, and close
   its card. Confirm gestures do not zoom or scroll the page accidentally.
3. Check 44px targets, focus order/visibility with a keyboard when available,
   text scaling, safe areas, and the dock/card/credits in both orientations.
   Focus Earth and Saturn at the normal focus distance and confirm their cards
   leave the selected world visible; rotate while a card is open. Also check
   minimum zoom, where intentional globe cropping is allowed.
4. Traverse the Solar System, Milky Way, Local Group, Virgo, 2MRS/web, and CMB
   views. Check the first deep zoom, label transitions, and lighting, including
   both faces of Saturn's rings without changing their approved shading.
5. Exercise maximum time speed, background/resume, and repeated rotation/zoom;
   record freezes, reloads, lost gestures, or memory-pressure symptoms.

Attach representative device screenshots or a short recording with the
results. Keep failures in focused issues and unavailable devices explicitly
untested. The historical disposition of #73 does not certify later changes.

### Audit execution and evidence

The required `Audit / audit` job aggregates static/HTTP checks, all four browser
sections, and every comparison job applicable to the event. A failed, cancelled,
or unexpectedly skipped dependency must fail that gate. Same-repository pull requests to
`develop` also run all fourteen visual groups and the historical focus comparison;
pushes, production promotion pull requests, and manual main audits retain the
complete functional suite.

The browser suite retains its original 422 screenshots and adds 14 compact
focus captures plus an 80-state check of all 20 bodies at 320×568 and 568×320,
with Camera closed and open. It checks actual rendered globe/ring and label
clearance, useful size, picking, rotation, and restoration of desktop framing.
Its full inventory is 436 screenshots and 16 reports, before group manifests.

Each comparison run freezes `main` once and uses the event's exact develop base
and candidate head. Functional PR tests use GitHub's proposed merge checkout;
comparison images use the recorded source commits. Keep those identities
distinct in review evidence. Every distinct complete Git tree is captured once
per group, sequentially on the same runner. Identical trees share the strictest
applicable capture validation (candidate, then develop, then main). Changed
trees always receive fresh captures; there is no reuse across workflow runs.

Start review with `comparison-index-<group>.json` in each visual artifact. It
records each requested source's commit/tree and its original evidence path;
an alias is explicitly reused evidence, not another rendering. Only successful,
complete, hash-verified captures may satisfy an alias. All 349 comparison
scenarios and the separate 30 historical focus captures remain required.
Capture success and identical-tree reuse do not replace visual review or
automatically approve a new baseline.

The fourteen visual lanes are `bodies-inner` (48), `bodies-giants` (23),
`bodies-outer` (13), `moons-inner` (31), `moons-jovian` (18), `moons-outer` (12),
`touch-controls` (47), `responsive` (40), `desktop-phases` (8),
`desktop-lifecycle` (10), `desktop-states` (8), `touch-states` (28),
`cosmic-scenes` (40), and `ordinary` (23). Each lane retains complete per-object
or independent page sequences and compares its source trees on one runner.
Keep Moon → Phobos → Deimos → Io together for Io's transient frames; the other
moon lanes begin with a fully settled minimum view. All twenty cosmic zoom
stops and all six far-sky directions retain their original page and input
history. Per-lane elapsed clocks and input histories cover that lane; the local
`all` capture retains the full ordering. Fourteen visual lanes, four browser
sections, and one history job bound the heavy audit work to nineteen jobs;
extra lanes add setup cost, so rebalance from measured timings rather than
splitting indiscriminately. Functional screenshots live in four
`helios-browser-<group>` artifacts; do not mistake one shard for the full suite.

Keep full-resolution originals in the seven-day Actions artifacts, with run
links and exact commit/tree identities in the pull request. The pull-request
reviewer is responsible for preserving evidence needed for a long-lived
accepted baseline before artifact expiry, including the relevant original
images, manifests and comparison indexes. Record where that evidence was
retained; a run link alone cannot preserve expired originals. Do not commit
routine audit screenshots or duplicate reports. Retain referenced README,
provenance, and issue images; age alone is not evidence that a file is unused.

## Helios issues and release flow

Search open and closed issues and pull requests before acting. Use the
repository issue form and the standard title
`[SEVERITY][Area] Imperative outcome`, where severity is `CRITICAL`, `HIGH`,
`MEDIUM`, or `LOW`. Keep one independently testable issue per branch and pull
request; the issue body is its scope and acceptance contract.

`main` is protected owner-approved production. `develop` is the protected
long-lived **Alpha Development** integration branch. Neither accepts direct
changes, force pushes, deletion, or bypassed checks. Both require pull requests
and the exact `Audit / audit` check, bound to GitHub Actions (app `15368`).
GitHub Pages deploys only from `main`.

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
- `npm test` passes from a clean checkout on the Node 24 baseline declared in
  `package.json` and the workflows, including browser/WebGL checks. CI on the
  exact candidate is authoritative.
- Documentation, provenance, product-version mirrors, tests, templates,
  workflows, and `Audit / audit` agree with the candidate.
- Desktop and touch-sized rendered evidence is reviewed. Physical observations
  remain separately labelled.
- A final audit proves this issue is the only behavior owner for the branch and
  all unrelated approved behavior remains unchanged.
