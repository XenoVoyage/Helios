# Helios provenance

This ledger records what Helios imports, what it transforms, and what remains
unresolved. The repository's MIT license covers first-party code only.
Third-party images, data, and Three.js retain their own terms and attribution.

Sources were last checked on 2026-08-21. Hashes are SHA-256 of the tracked
local files.

## Scientific data and model boundaries

| Area | Source snapshot | How Helios uses it |
| --- | --- | --- |
| Planet properties and heliocentric elements | [NASA planetary fact sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/) and published J2000 mean elements | Fixed J2000 Keplerian approximations with two-body propagation. Calendar positions are not JPL Horizons ephemerides and do not model perturbations. |
| Moon properties and mean elements | [JPL satellite physical parameters and mean elements](https://ssd.jpl.nasa.gov/sats/elem/) (`DE405/LE405`, `MAR099`, `JUP365`, `SAT441`, `NEP097`) | One J2000 snapshot. JPL describes these mean elements as adequate for describing orbits, not for ephemeris computation. Laplace-plane rows are transformed once into the parent-equatorial display basis. |
| Body poles | [NAIF generic PCK `pck00011.tpc`](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc) | IAU pole polynomials and periodic terms are evaluated at J2000 to provide the parent-equatorial basis; the approved visual obliquity remains a separate scene transform. |
| Bright stars | Hipparcos ESA I/239 through the [HYG compilation](https://www.astronexus.com/projects/hyg) | Equatorial J2000 positions, Johnson V magnitude, and B-V color for a bright subset in `js/sky-catalog.js`. The exact upstream HYG release and its matching license version were not retained; this is an adoption blocker. |
| Constellation figures | [IAU / Alan MacRobert constellation charts](https://www.iau.org/public/themes/constellations/), CC BY 4.0 | HIP-number line paths in `js/sky-catalog.js`; these are conventional stick figures, not constellation boundaries. |
| Galactic and Local Group values | Sources cited beside each value in `js/galaxy-catalog.js`: GRAVITY 2019, SIMBAD, NED, Pietrzyński 2019, Graczyk 2020, de Grijs & Bono 2014, McConnachie 2012, Mei 2007, and Tully 2014 | Published positions, distances, and scale references. Visible Milky Way arms, far-field galaxies, cluster hubs, and cosmic-web filaments are deterministic illustrations, not survey reconstructions. |
| Outer cosmological scale | [Planck 2018 VI](https://arxiv.org/abs/1807.06209) | The particle-horizon display uses about 46.5 Gly / 14.25 Gpc. The physical last-scattering surface is distinct; the illustrative CMB sphere is deliberately co-located with the outer display radius. Seeing that sphere “from outside” is a camera/scale metaphor. |

Runtime mapping and the source values live in `js/bodies.js`,
`js/sky-catalog.js`, and `js/galaxy-catalog.js`. Display compression lives in
`js/config.js` and the corresponding rendering modules.

## Image assets

| Files | Origin, terms, projection, and transformations | Local SHA-256 |
| --- | --- | --- |
| `assets/textures/sun.jpg`, `mercury.jpg`, `venus.jpg`, `earth.jpg`, `moon.jpg`, `mars.jpg`, `jupiter.jpg`, `saturn.jpg`, `uranus.jpg`, `neptune.jpg`, `ceres.jpg`, `saturn-ring.png` | [Solar System Scope textures](https://www.solarsystemscope.com/textures/), CC BY 4.0. Equirectangular color maps and a radial ring strip were resized/compressed before import; the exact upstream revision and transformation chain were not retained. The publisher discloses saturation and fictional gap filling; its Ceres map is categorized as fictional. | Family manifest: `f566beedf75afa2fd1b7ae0536423ab77bfec59ae2413ba2cf5262fe01231ae7` |
| `assets/textures/phobos.jpg`, `deimos.jpg`, `io.jpg`, `europa.jpg`, `ganymede.jpg`, `callisto.jpg`, `titan.jpg`, `pluto.jpg` | [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources), subject to [NASA media guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/). Imported as 2:1 atlases and JPEG-compressed; exact upstream commits and prior resize settings were not retained. Phobos and Deimos are approximate atlases displayed on spheres. Io has limited polar coverage. | Family manifest: `6ecc31814ef1d61922ba9ee827be7ba0cdaada38e07e18b61e8ccd457569586b` |
| `assets/textures/triton.jpg` | [LPI/JPL PIA18668 cylindrical mosaic](https://www.lpi.usra.edu/icy_moons/neptune/triton/), NASA/JPL-Caltech/LPI; Voyager coverage is incomplete. Full `14138×7069` source, no crop; observed pixels retained, connected black no-data region replaced by uniform `#8f9480`, then Lanczos-resized to `2048×1024`, JPEG 4:2:0 progressive quality 88. Source hash: `ff533af3163f53cc5560cd983cfe0f06b1c2cd0f3db36518d4c5cc5f5ddfeabb`. No inpainting or synthetic terrain. | `7962d4997fc8c8f47e7f54304174a565f59d3cc01e5de119329f59673c684ba9` |
| `assets/sky/milky-way.jpg` | [ESA Gaia DR2 all-sky colour](https://sci.esa.int/web/gaia/-/60196-gaia-s-sky-in-colour-equirectangular-projection), ESA/Gaia/DPAC, CC BY-SA 3.0 IGO. Equirectangular galactic projection, resized/compressed to `2000×1000`; exact prior settings were not retained. | `95bca25ca3f2001b883e11e8317b5cda728b24ff80137ef749941d0fd4cbf899` |
| `assets/sky/andromeda.png` | NASA/JPL-Caltech [Spitzer PIA04921](https://images.nasa.gov/details/PIA04921), subject to NASA media guidelines. Cropped to a transparent `384×348` sprite; the exact crop/matte recipe was not retained. | `f620a22e3f70db72a0c4a4a144a80e1d84106da716ad82a6d3088dafec7e9f8f` |
| `assets/sky/cmb.jpg` | First-party `1536×768` Planck-style illustration. It contains no claimed Planck mission pixels or scientific map values. The original generator settings were not retained. | `59c0e76f91b8d81f67e06a61671d116a9456ef51b9e335a84c341ecd6ae58b3a` |
| `docs/assets/*.webp` | Screenshots rendered from Helios for repository documentation. They are evidence of older project revisions, not the immutable v2026.8.21d review baseline. | Family manifest: `b484a99d8ac7cb795133ec5fc10bd1317dd43fa8f8c9c2c2dd228d4699fb7e02` |

For a family manifest, its listed paths are bytewise-sorted, hashed individually
with `sha256sum`, and that textual manifest is hashed once with `sha256sum`.

## Vendored code

Three.js `0.185.0` is vendored from the immutable npm artifact recorded in
`vendor/three-metadata.json`. It is MIT-licensed; the upstream license is
retained in `vendor/THREE-LICENSE`. Static verification checks both vendored
module hashes before tests pass.

Playwright `1.62.1` is an exact, lockfile-pinned Apache-2.0 development
dependency used only by the browser/WebGL smoke test. It is not deployed.

## Adoption gaps

The engineering standard remains `adopting` until the exact HYG snapshot and
license are identified, inherited image transformation records are recovered
where practical, and the required physical touch-device review is recorded.
Unknown provenance is stated here rather than guessed.
