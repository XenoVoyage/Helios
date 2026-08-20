# Helios

[![Version v2026.8.20a](https://img.shields.io/badge/version-v2026.8.20a-66f7ff)](VERSION.txt)
[![MIT](https://img.shields.io/badge/license-MIT-a77bff)](LICENSE)

An interactive 3D orrery of the solar system.

## [▶ Play Helios](https://xenovoyage.github.io/Helios/)

Tap or click a world to focus it. Drag to orbit. Pinch or scroll to zoom. Play, pause, and change the speed of time from the bar at the bottom.

Helios is a local page: no accounts, no telemetry, and no CDN.

## At a glance

| Detail | Summary |
| --- | --- |
| Worlds | Sun, 8 planets, the Moon, Io, Europa, Ganymede, Callisto, Titan, Triton, Pluto, and Ceres |
| Belt | A field between Mars and Jupiter, not a catalog of rocks |
| Time | Independent of the visual scale. Default and minimum are 1 simulated hour per real second |
| Play with | Mouse, keyboard, or touch |

## Visual scale

True 1:1 distances make every planet vanish beside the Sun. Helios keeps published NASA / JPL periods, spins, tilts, radii, and Keplerian elements, then compresses **distances more than sizes** so the system can be read at a glance. The one spacing knob is `CONFIG.visualScale` in `js/config.js`. Moon distances stay outside their parent and outside any rings. Time is a separate slider.

## Run locally

```sh
npm test
npm run serve
```

Then open `http://127.0.0.1:4173/Helios/`. Opening `index.html` through a local static server also works. A WebGL browser is required.

| Action | Desktop | Touch |
| --- | --- | --- |
| Orbit | Drag | One finger |
| Zoom | Scroll | Pinch |
| Focus | Click a world or label | Tap a world or label |
| Play / pause | Space or Pause | Pause |
| Speed | `+` / `-` or the slider | − / + or the slider |
| Overview | Escape or Reset view | Reset view / Overview |

## Credits

Planet, Sun, Moon, and Ceres maps are [Solar System Scope](https://www.solarsystemscope.com/textures/) textures (CC BY 4.0), based on NASA elevation and imagery. Io, Europa, Ganymede, Callisto, Titan, Triton, and Pluto maps are from [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources). Orbital and physical values follow NASA / JPL published figures, including the [planetary fact sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/). Three.js is vendored under MIT.

Released under the [MIT License](LICENSE).
