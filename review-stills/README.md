# review-stills — review-only

**This directory is review evidence for the v2026.8.21d pull request only.**
It is not part of the Helios runtime, is not referenced by `index.html`,
`js/`, or `tests/`, and can be deleted after review. Extra-zoom stills go to
Marins first.

## Reproduction

All stills are real PNG bytes captured from the running local page
(`npm run serve` → `http://127.0.0.1:4173/Helios/`), rendered by headless
Chrome with SwiftShader WebGL:

```
npm run serve
google-chrome --headless=new --enable-unsafe-swiftshader --use-angle=swiftshader \
  --window-size=1440,900 --hide-scrollbars --virtual-time-budget=15000 \
  --screenshot=out.png "http://127.0.0.1:4173/Helios/?look=<look>"
```

- Desktop stills: 1440×900. Touch stills: 390×844.
- `?look=` values used: none (overview), `sky`, `solarfar`, `milkyway`
  (first trail frame / handoff), `tailsky` (mid-trail), `growing`
  (late trail), `disk`, `neighborhood`, `localgroup`, `virgo`, `web`,
  `universe`.
- Stills 05, 06, 08 add a mouse-drag orbit at the same slider distance to
  aim the trail camera at M31 / Virgo (drag deltas from screen center:
  05 = +520,+72 · 06 = −48,−320 · 08 = −48,−260). Orbit input is live at
  every zoom, so this is plain dragging, no code changes.
- `base-21c-*.png` are the same captures from an unmodified v2026.8.21c
  checkout (`git worktree` at f879c8a, served on another port) for A/B.

Note: SwiftShader + PNG reads darker than a physical display; the A/B pair
against `base-21c-*` is the honest comparison, not absolute brightness.

## What each still shows

| Still | Claim |
| --- | --- |
| 01, 16 | Inner orrery unchanged (desktop and touch width). |
| 02 vs `base-21c-solar-sky` | Solar sky brighter; same MW band; constellation-figure stars brighter than field stars. |
| 03, 17 vs `base-21c-solar-far` | Far-Sun view, brighter field, same layout. |
| 04, 18 | First trail frame: white "Solar System" seat particle with its badge, no bare Sun badge. |
| 05 | Trail aimed at M31: Andromeda and Triangulum bodies already present, faint Local Group labels present. |
| 06 | Trail aimed up: Virgo Cluster already faintly present on the first trail frame. |
| 07, 08 | Mid-trail: badge almost dead, disk and Virgo present, no empty Sun badge (compare `base-21c-trail-empty-sun-badge`). |
| 09 | Late trail: badge fully gone, galaxy names taking over, neighbors present. |
| 10, 19 | Full disk: Local Group identity unchanged (MW, LMC/SMC, M31, M33). |
| 11–15 | Neighborhood, Local Group, Virgo, web, universe layers unchanged. The web and universe stills are pixel-identical to the v2026.8.21c captures except the HUD version label in the corner (diff bounding box x 1340–1426, y 875–883). |
