# Helios

[![Version v2026.8.20e](https://img.shields.io/badge/version-v2026.8.20e-66f7ff)](VERSION.txt)
[![MIT](https://img.shields.io/badge/license-MIT-a77bff)](LICENSE)

An interactive 3D orrery of the solar system.

## [▶ Play Helios in your browser](https://xenovoyage.github.io/Helios/)

[![Overview of the Helios orrery: Sun, planets, asteroid belt, and the outer Kuiper field.](docs/assets/helios-overview.webp)](https://xenovoyage.github.io/Helios/)

![Saturn focused, with Titan sitting just outside the rings.](docs/assets/helios-titan-rings.webp)

![Constellation names readable at overview, with Sagittarius and Scorpius labeled.](docs/assets/helios-constellations.webp)

Tap or click a world — including the Sun — to focus it. Drag to orbit. Pinch or scroll to zoom. Play, pause, and change the speed of time from the bar at the bottom. Click empty space to close the body card.

Helios is a local page: no accounts, no telemetry, and no CDN.

## At a glance

| Detail | Summary |
| --- | --- |
| Worlds | Sun, 8 planets, the Moon, Phobos, Deimos, Io, Europa, Ganymede, Callisto, Titan, Triton, Pluto, and Ceres |
| Sky | Hipparcos bright stars, IAU constellation lines, a Milky Way band, and Andromeda at M31 |
| Belts | Asteroid field between Mars and Jupiter; Kuiper field from about 30–50 AU. Sparse points, not rock catalogs |
| Time | Independent of the visual scale. Default and minimum are 1 simulated hour per real second |
| Play with | Mouse, keyboard, or touch |

## Visual scale

True 1:1 distances make every planet vanish beside the Sun. Helios keeps published NASA / JPL periods, spins, tilts, radii, and Keplerian elements, then compresses **distances more than sizes** so the system can be read at a glance. The one planet-spacing knob is `CONFIG.visualScale` in `js/config.js`; it multiplies a compressed AU curve (`orbitScale * AU^orbitPower`). Body sizes use the same kind of curve (`sizeScale * (radius/Earth)^sizePower`). Moons share that size curve. Moon distances stay a compressed real-radii map: outside their parent, just outside any rings, and outside a readable gap from the next inner sibling. Time is a separate slider.

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
| Focus | Click a world, the Sun, or a label | Tap a world, the Sun, or a label |
| Close card | Click empty space | Tap empty space |
| Play / pause | Space or Pause | Pause |
| Speed | `+` / `-` or the slider | − / + or the slider |
| Constellations | Constellations toggle | Constellations toggle |
| Overview | Escape or Reset view | Reset view / Overview |

## Credits

Planet, Sun, Moon, and Ceres maps are [Solar System Scope](https://www.solarsystemscope.com/textures/) textures (CC BY 4.0), based on NASA elevation and imagery. Io, Europa, Ganymede, Callisto, Titan, Triton, Pluto, Phobos, and Deimos maps are from [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources). Bright-star positions are a Hipparcos / Yale Bright Star subset compiled in [HYG](https://www.astronexus.com/projects/hyg) (ESA Hipparcos I/239). Constellation stick figures are the [IAU / Alan MacRobert figures](https://www.iau.org/public/themes/constellations/) (CC BY 4.0). The Milky Way band is [ESA Gaia DR2](https://sci.esa.int/web/gaia/-/60196-gaia-s-sky-in-colour-equirectangular-projection) all-sky colour in galactic coordinates (ESA/Gaia/DPAC; CC BY-SA 3.0 IGO). Andromeda is NASA / JPL-Caltech [Spitzer PIA04921](https://images.nasa.gov/details/PIA04921). Orbital and physical values follow NASA / JPL published figures, including the [planetary fact sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/) and [JPL satellite elements](https://ssd.jpl.nasa.gov/sats/elem/). Three.js is vendored under MIT.

Released under the [MIT License](LICENSE).
