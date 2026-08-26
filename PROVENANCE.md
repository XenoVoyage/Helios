# Helios provenance

This ledger records what Helios imports, what it transforms, and what remains
unresolved. The repository's MIT license covers first-party code only.
Third-party images, data, and Three.js retain their own terms and attribution.

Sources were last checked on 2026-08-23. Hashes are SHA-256 of the tracked
local files.

## Scientific data and model boundaries

| Area | Source snapshot | How Helios uses it |
| --- | --- | --- |
| Planet properties and heliocentric elements | [NASA planetary fact sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/), NASA New Horizons' [Pluto seasons explanation](https://science.nasa.gov/blogs/new-horizons/2015/10/23/a-planet-for-all-seasons/), and published J2000 mean elements | Fixed J2000 Keplerian approximations with two-body propagation. Calendar positions are not JPL Horizons ephemerides and do not model perturbations. Pluto's displayed retrograde obliquity is 119.6°, the angle between its PCK spin axis and this fixed orbit (consistent with NASA's approximately 119.5°); the inherited 122.53° value was not consistent with either. |
| Moon properties and mean elements | [JPL satellite physical parameters and mean elements](https://ssd.jpl.nasa.gov/sats/elem/) (`DE405/LE405`, `MAR099`, `JUP365`, `SAT441`, `NEP097`) and NASA's [tidal-locking explanation](https://science.nasa.gov/moon/tidal-locking/) | One J2000 snapshot. JPL describes the elements as a fitted precessing ellipse useful for general shape and orientation, not ephemeris computation. Helios uses `orbitDays` as the mean-anomaly clock in its frozen Kepler ellipse. For the nine cataloged synchronous moons, `rotationHours` supplies a signed display-longitude rate; the difference between those clocks advances periapsis uniformly to prevent secular longitudinal drift. This is a display correction, not propagation of the published apsidal or nodal periods. The Moon and Triton have source-registered poles and prime meridians. The other moon maps retain unverified phases and simple parent-frame axes, so they are not registered near-side models. Laplace-plane rows are transformed once into the parent-equatorial display basis. |
| Body poles and prime meridians | [NAIF generic PCK `pck00011.tpc`](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc) | The Sun, planets, Ceres, Pluto, the Moon, and Triton use PCK poles evaluated at J2000; this also puts Saturn's rings and each declared parent-equatorial moon frame on the source pole. Earth uses the PCK's low-accuracy `W = 190.147°`. The Moon uses the `IAU_MOON` Mean Earth/Polar Axis pole and prime meridian with all periodic terms evaluated at J2000: `RA = 266.85773344495135°`, `Dec = 65.64110274784535°`, `W = 41.1952639807452°`. Triton likewise uses its complete periodic model at J2000: `RA = 298.4509834088894°`, `Dec = 20.302361260483217°`, `W = 297.01780353391297°`. Their W values intentionally differ from the polynomial constants. Those three verified maps use W; the other inherited maps lack a retained longitude-registration record, so Helios derives the closest phase to their previous display roll and makes no scientific prime-meridian claim for them. Poles then stay fixed and spin advances linearly from the catalog period and PCK direction; this is not the complete time-dependent PCK model. Other moon axes retain their simple catalog obliquity. |
| Bright stars | Hipparcos ESA I/239 through the [HYG compilation](https://www.astronexus.com/projects/hyg) | Equatorial J2000 positions, Johnson V magnitude, and B-V color for a bright subset in `js/sky-catalog.js`. The exact upstream HYG release and its matching license version were not retained; this is an adoption blocker. |
| Constellation figures | [IAU / Alan MacRobert constellation charts](https://www.iau.org/public/themes/constellations/), CC BY 4.0 | HIP-number line paths in `js/sky-catalog.js`; these are conventional stick figures, not constellation boundaries. Major mode preserves the ten existing names. All mode makes all 88 names eligible for deterministic viewport/collision filtering. Mensa and Microscopium have no drawn paths in the tracked figure data, so their label anchors use the existing Hipparcos positions of HIP 29271 (Alpha Mensae) and HIP 102831 (Alpha Microscopii); no star coordinate is added or changed. |
| Galactic and Local Group values | Sources cited beside each value in `js/galaxy-catalog.js`: GRAVITY 2019, SIMBAD, NED, Pietrzyński 2019, Graczyk 2020, de Grijs & Bono 2014, McConnachie 2012, Mei 2007, and Tully 2014 | Published positions, distances, and scale references. Visible Milky Way arms and the far-field sky are deterministic illustrations, not survey reconstructions. The far field uses one camera-centered spherical shell of fixed-seed Voronoi-proximity points plus bounded round highlights; it has no cube faces, named generated objects, or claimed catalog coordinates. During the Milky Way-invisible post-Solar dive, the already-collapsed Solar display hierarchy, its fading debris roots, and their following camera move together to the temporary trail pin's small map-local offset. Relative Solar geometry, orbital calculations, the catalog Sun, scale transforms, and the final Orion-arm marker stay unchanged; the Sun and marker therefore coincide throughout their visible crossfade. Screen-fixed hierarchy labels are semantic zoom cues, not scale measurements or time evolution: the Local Group and Virgo Cluster remain distinct within the historical Local (Virgo) Supercluster, shown within the Laniakea flow-basin context. |
| Post-Virgo galaxy distribution | NASA HEASARC [2MASS Redshift Survey catalog](https://heasarc.gsfc.nasa.gov/w3browse/all/twomassrsc.html), Huchra et al. 2012, ApJS 199, 26. [Data.gov metadata](https://catalog.data.gov/dataset/2mass-redshift-survey-2mrs-catalog) lists public access and the US government-works license link. | `scripts/build-2mrs.mjs` queried `name, lii, bii, radial_velocity, ks_mag_0`, sorted by name, and retained 42,927 of 44,599 rows with `0 < cz <= 21,900 km/s`. It quantizes galactic direction, velocity, and K magnitude into `js/2mrs-data.js`. Radius is the deliberately approximate Hubble-law mapping `D=cz/H0` with `H0=73 km/s/Mpc`, capped at 300 Mpc; peculiar velocities and redshift-space distortions are not corrected. 2MRS is K-limited (`Ks <= 11.75`), 97.6% redshift-complete within its limits, covers 91% of the sky, and retains its Zone of Avoidance (`|b| >= 5°`, or `8°` toward the bulge). The points trace the flux-limited observed galaxy distribution, not total-matter density. Rendered colors retain a bounded K-magnitude cue, while point size, additive intensity, and the uniform stage-driven point-only luminance gain are enlarged for legibility; these are display encodings, not photometrically calibrated measurements, and do not brighten the empty background. Sorted source SHA-256: `236be982e9a172c55d483d40c38ca38b36a3dc8b8af4f402a0fd045f1b87da6f`; derived payload SHA-256: `9c97c9547b88f2f6ab307b9ca733071f0ce12a9549a070cf44be0aac7863b3b9`. |
| Post-Virgo cluster anchors | Lambert et al. 2020, MNRAS 497, 2954, [doi:10.1093/mnras/staa1946](https://doi.org/10.1093/mnras/staa1946), Table 1 | Seven named groups beyond Virgo and within about 100 Mpc are hand-transcribed as a small factual subset in `POST_VIRGO_CLUSTERS`; no bulk 2MRS group-catalog artifact is redistributed. Positions are the table's mean J2000 / galactic coordinates and distances are its comoving `Dc` values for `H0=73`, `OmegaM=0.3`, `OmegaLambda=0.7`. Generated points never receive catalog names. |
| Beyond the 2MRS range | First-party `js/cosmic-web.js`, informed by the Voronoi-foam hierarchy described by van de Weygaert & Icke 1989, A&A 213, 1 | A fixed-seed 7,000-point Voronoi-proximity density illustration occupies a non-overlapping shell outside the 300 Mpc 2MRS display boundary and supplies continuity toward the CMB. The cool-wall, violet-filament, and warm-node palette is deliberately false color. Enlarged point size, additive brightness, and overlapping exposure crossfades preserve legibility between finite display volumes; they do not add objects or connections. The illustration is not observed galaxies, a survey reconstruction, a named structure map, a cosmological simulation, a photometric measurement, or a measured matter-density field. The two density point draws contain 42,927 2MRS samples plus 7,000 illustrative samples (49,927 total), plus one separate seven-point cluster-anchor draw (49,934 plotted positions including anchors). |
| Outer cosmological scale | [Planck 2018 VI](https://arxiv.org/abs/1807.06209) | The particle-horizon display uses about 46.5 Gly / 14.25 Gpc. The physical last-scattering surface is distinct; the illustrative CMB sphere is deliberately co-located with the outer display radius. Seeing that sphere “from outside” is a camera/scale metaphor. The untinted, normally alpha-blended CMB texture begins only once that front-facing display sphere is visible and receives a bounded five-percent opacity lift at the final seat for readability; it is not a literal observable-universe edge or a photometric measurement. |

Runtime mapping and the source values live in `js/bodies.js`,
`js/sky-catalog.js`, and `js/galaxy-catalog.js`. Display compression lives in
`js/config.js` and the corresponding rendering modules.

Celestial and galaxy positions share one rigid coordinate transform in
`js/sky.js`: the IAU J2000 Galactic basis (north pole RA `192.85948°`, Dec
`27.12825°`, north-celestial-pole longitude `122.93192°`) is inverted into
equatorial J2000 and then rotated by the J2000 mean obliquity into Helios's
Y-up ecliptic scene frame. The transform preserves lengths and pairwise angles;
the visual distance-compression curves remain separate and unchanged.

The fixed lunar pole, eccentric Kepler path, and synchronous spin produce
bounded geometric libration (about ±6.4° longitude and ±6.7° latitude in this
model). Helios does not propagate the PCK's time-varying lunar pole or physical
libration terms, the source elements' nodal precession, tides, or perturbations.
It also does not cast astronomical shadows: the Sun point light supplies the
day/night terminator while a deliberate ambient fill keeps night sides
readable. Solar/lunar eclipses and shadow contacts are therefore outside this
orrery model rather than claimed simulations. Saturn's standard ring material
adds a bounded `0.14` emissive floor, masked by the same radial color/alpha map,
as an illustrative approximation of transmitted and backscattered light. It
preserves transparent gaps and radial structure on the anti-solar face without
altering Saturn, the global lights, or exposure; it is not a photometric ring
scattering or shadow model.

## Image assets

| Files | Origin, terms, projection, and transformations | Local SHA-256 |
| --- | --- | --- |
| `assets/textures/sun.jpg`, `mercury.jpg`, `venus.jpg`, `earth.jpg`, `moon.jpg`, `mars.jpg`, `jupiter.jpg`, `saturn.jpg`, `uranus.jpg`, `neptune.jpg`, `ceres.jpg`, `saturn-ring.png` | [Solar System Scope textures](https://www.solarsystemscope.com/textures/), CC BY 4.0. Equirectangular color maps and a radial ring strip were resized/compressed before import; the exact upstream revision and transformation chain were not retained. The publisher discloses saturation and fictional gap filling; its Ceres map is categorized as fictional. | Family manifest: `f566beedf75afa2fd1b7ae0536423ab77bfec59ae2413ba2cf5262fe01231ae7` |
| `assets/textures/phobos.jpg`, `deimos.jpg`, `io.jpg`, `europa.jpg`, `ganymede.jpg`, `callisto.jpg`, `titan.jpg`, `pluto.jpg` | [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources), subject to [NASA media guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/). Imported as 2:1 atlases and JPEG-compressed; exact upstream commits and prior resize settings were not retained. Phobos and Deimos are approximate atlases displayed on spheres. Io has limited polar coverage. | Family manifest: `6ecc31814ef1d61922ba9ee827be7ba0cdaada38e07e18b61e8ccd457569586b` |
| `assets/textures/triton.jpg` | [LPI full-resolution cylindrical mosaic underlying JPL PIA18668](https://www.lpi.usra.edu/icy_moons/neptune/triton/), produced by Dr. Paul Schenk (Lunar and Planetary Institute). Image selection, radiometric calibration, geographic registration, photometric correction, and final mosaic assembly were performed by Schenk; image data are from Voyager 2 (NASA/JPL). The producer's [public-use note](https://stereomoons.blogspot.com/2014/08/triton-at-25.html) states that the Triton maps are public domain and free to use, and requests credit to Dr. P. Schenk/LPI. Voyager coverage is incomplete. Full `14138×7069` source, no crop; observed coverage retained, connected black no-data region replaced by uniform `#8f9480`, then Lanczos-resized to `2048×1024`, JPEG 4:2:0 progressive quality 88. Source hash: `ff533af3163f53cc5560cd983cfe0f06b1c2cd0f3db36518d4c5cc5f5ddfeabb`. No inpainting or synthetic terrain. | `7962d4997fc8c8f47e7f54304174a565f59d3cc01e5de119329f59673c684ba9` |
| `assets/sky/milky-way.jpg` | [ESA Gaia DR2 all-sky colour](https://sci.esa.int/web/gaia/-/60196-gaia-s-sky-in-colour-equirectangular-projection), ESA/Gaia/DPAC, CC BY-SA 3.0 IGO. Equirectangular galactic projection, resized/compressed to `2000×1000`; exact prior settings were not retained. | `95bca25ca3f2001b883e11e8317b5cda728b24ff80137ef749941d0fd4cbf899` |
| `assets/sky/andromeda.png` | NASA/JPL-Caltech [Spitzer PIA04921](https://images.nasa.gov/details/PIA04921), subject to NASA media guidelines. Cropped to a transparent `384×348` sprite; the exact crop/matte recipe was not retained. | `f620a22e3f70db72a0c4a4a144a80e1d84106da716ad82a6d3088dafec7e9f8f` |
| `assets/sky/cmb.jpg` | First-party `1536×768` Planck-style illustration. It contains no claimed Planck mission pixels or scientific map values. The original generator settings were not retained. | `59c0e76f91b8d81f67e06a61671d116a9456ef51b9e335a84c341ecd6ae58b3a` |
| `docs/assets/*.webp` | Current Helios screenshots for repository documentation. Thirteen previews are derived without resizing from the `1440×900` PNG evidence for exact runtime tree `4244250ff5c2394cd17f5c4b0f1c255278697589` in [Audit #160](https://github.com/XenoVoyage/Helios/actions/runs/32756244378). `helios-titan-rings.webp` is a centered `1440×900` crop of the owner's approved `2048×1181` physical-Mac capture of that runtime. All fourteen were converted to lossy VP8 WebP with ImageMagick/libwebp (`quality 82`, method 6). | Family manifest: `872d58b3bda6be63d37fb3e2009367bea8261209decc606f60667defa6049dc4` |
| `docs/issues/saturn-ring-backface.webp` | Owner-supplied `2048×1182` physical-Mac reproduction of the deferred Saturn ring back-face visibility defect on runtime tree `4244250ff5c2394cd17f5c4b0f1c255278697589`. Converted without resizing to lossy VP8 WebP with ImageMagick/libwebp (`quality 90`, method 6); retained as issue evidence until the defect is resolved. | SHA-256 `a3ade073cb69b33424abeb5ce14c9b79540559eabc7e53b87ccf14276aef63c3` |

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
