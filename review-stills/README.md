# Review stills — v2026.8.21c defect pass

Review artifacts only. This directory exists for the PR review and must be
dropped before merge; it is not a product asset.

All shots were captured from the running local page (`npm run serve`,
`http://127.0.0.1:4173/Helios/`) in headless Chrome. Desktop shots are
1440×810; touch shots are 390×844 with touch emulation. Time is paused with
Space right after load so every shot is at 2000-01-01 unless noted. "Wheel
step" below means one mouse-wheel notch of deltaY 47.2 on the canvas
(distance ×≈1.078 per step).

| Still | How to reproduce |
| --- | --- |
| `01-earth-moon-sunward.png` | Load `/Helios/`, Space to pause, click the Earth label, then drag the camera four times ~157 px to the right so the view faces the Sun. Earth and the Moon show readable night sides instead of vanishing black-on-black; the Moon body sits under its label. |
| `02-mars-moons.png` | Same, but click the Mars label and drag three times. Phobos and Deimos are visible dots under their labels (they were sub-pixel before the visual floor). |
| `03-solar-sky-denser.png` | Load `/Helios/?look=solarfar`, Space. Solar cap seat: denser faint-star sky, same MW band, same constant brightness. |
| `04-sun-dot.png` | From `look=solarfar`, 4 wheel steps out (distance ≈ 2540). Sun is a tiny dot on the star sky; no early MW disk. |
| `05-handoff-crossfade.png` | 6 wheel steps out (distance ≈ 2960). The 1:1 sky↔MW crossfade happens with the camera parked among the arm stars; the Sun badge fades in. |
| `06-trail-out-a.png` / `07-trail-out-b.png` / `08-disk-forming.png` | 8 / 11 / 16 wheel steps out. Every later frame is strictly farther out — no invert, no bounce. Zooming back in retraces the same frames in reverse. |
| `09-trail-sun-badge-lmc.png` | Load `/Helios/?look=tailsky`, Space. Trail seat: small "Sun" badge at the Sun's spot; the LMC already exists below the disk (bottom cloud). |
| `10-disk-mw-name.png` | Load `/Helios/?look=disk`, Space. Full disk with the "Milky Way" name, LMC/SMC bodies + labels, Andromeda/Triangulum labels. |
| `11-neighborhood.png` / `12-localgroup.png` / `13-web.png` / `14-universe.png` | Load `?look=neighborhood` / `localgroup` / `web` / `universe`, Space. Unchanged from the approved v2026.8.21b looks. |
| `15-touch-earth-moon.png` | 390×844 touch viewport: tap the Earth label, then 3 wheel steps (deltaY 200) out so the Moon's path fits the portrait frustum. Moon visible under its label. |
| `16-touch-trail-badge.png` | 390×844 touch viewport, `?look=tailsky`, Space. Sun badge and LMC present at touch width; 44 px controls intact. |
