# Research inputs

Everything `build_library.py` reads to make `library.json`.

| Path | Contents |
| --- | --- |
| `erin/index.json` | For each Erin's Audio Corner review: the page URL and title, the plot image URLs, and the small-signal (Klippel LPM) parameters read as text from the page. Retrieved 2026-09-26. |
| `lsi/lsi_extract.py` | Extracts Bl(x), Kms(x) and Le(x) curves from Klippel LSI plot images. |
| `lsi/hd_extract.py` | Extracts H2 and H3 curves from harmonic distortion plots. |
| `lsi/cfg_separate.json`, `lsi/cfg_combined.json`, `lsi/cfg_hd.json` | Per-image settings: curve colour, expected tick values, crop. |
| `lsi/sources.json` | Image file name to original URL, for every image the configs name. |
| `lsi/fetch_sources.py` | Downloads those images into `lsi/images/` (not committed). |
| `lsi/out/`, `lsi/outc/`, `lsi/outhd/` | Extraction results: points plus the axis calibration of every curve (tick pixel positions, largest residual). |
| `lsi/xp_extract.py`, `lsi/xp/fit_ranges.json` | Klippel's fit range ±xp: where each plot draws its curve in black (legend "Xp- < X < Xp+"), measured with the extraction's own axis calibration; per plot and, as the median of the three plots, per driver. |
| `erin/limits.json` | Klippel's displacement limits as printed in each review's limits table (text). Retrieved 2026-10-15. `tests/test_engine.js` checks the Guide's limits table against it. |

## Method

Each plot is flattened to RGB and cropped. Both axes are calibrated from tick labels read by OCR (tesseract),
each paired with its detected gridline, by least squares; every labelled tick is also a check, and the largest
residual must stay below 1 px (it is 0.68 px at worst across the 27 curve panels). The curve is masked by its
exact colour, traced column by column with continuity tracking, and resampled to 161 points. Each run also writes
an overlay image of the traced curve on the original plot for checking by eye.

Klippel fits its curves over a working range xp− < x < xp+, where the coil spends more than 99 % of the time, and
draws them further, out to ±Xprot. The plots draw the fitted range in black; `xp_extract.py` measures it, and the
measured shorter side matches every published "greater than" limit within 0.07 mm.

## Reproducing

```bash
cd research/lsi
python3 fetch_sources.py
cd images
python3 ../lsi_extract.py ../cfg_separate.json ../out
python3 ../lsi_extract.py ../cfg_combined.json ../outc
python3 ../hd_extract.py ../cfg_hd.json ../outhd
python3 ../xp_extract.py . ../out/extracted.json ../outc/extracted.json ../xp/fit_ranges.json
cd ../../..
python3 build_library.py
git diff library.json research/      # should show no changes apart from overlay paths
```

Needs Python 3 with numpy and Pillow, and the tesseract program.
