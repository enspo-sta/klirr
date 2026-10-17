# Research inputs

Everything `build_library.py` reads to make `library.json`.

| Path | Contents |
| --- | --- |
| `erin/index.json` | For each Erin's Audio Corner review: the page URL and title, the plot image URLs, and the small-signal (Klippel LPM) parameters read as text from the page. Retrieved 2026-09-26. |
| `lsi/lsi_extract.py` | Extracts Bl(x), Kms(x) and Le(x) curves from Klippel LSI plot images. |
| `lsi/hd_extract.py` | Extracts H2 and H3 curves from harmonic distortion plots. |
| `lsi/cfg_separate.json`, `lsi/cfg_combined.json`, `lsi/cfg_li.json`, `lsi/cfg_hd.json`, `lsi/cfg_hd2020.json` | Per-image settings: curve colour, expected tick values, crop. The 2020 harmonic distortion charts draw dotted minor gridlines, so their settings raise the gridline threshold and give the plot's left edge. |
| `lsi/sources.json` | Image file name to original URL, for every image the configs name. |
| `lsi/fetch_sources.py` | Downloads those images into `lsi/images/` (not committed), and splits each animated GIF into one PNG per frame. |
| `lsi/out/`, `lsi/outc/`, `lsi/outli/`, `lsi/outhd/`, `lsi/outhd2020/` | Extraction results (`outli/`: Klippel's inductance at rest against current, L(X=0, I), from the five 2020 reviews): points plus the axis calibration of every curve (tick pixel positions, largest residual). |
| `reference/hb.py`, `reference/run_reference.py`, `reference/reference.json` | An independent harmonic-balance solver of the same model (frequency domain, Newton iteration, no time stepping) and its solution of 28 cases: infinite baffle, sealed, vented, passive radiator, current drive, all three stiffness options. `tests/reference_test.js` compares the engine with it; rerun `run_reference.py` (numpy and node) when the built-in curves change. |
| `lsi/xp_extract.py`, `lsi/xp/fit_ranges.json` | Klippel's fit range ±xp: where each plot draws its curve in black (legend "Xp- < X < Xp+"), measured with the extraction's own axis calibration; per plot and, as the median of the three plots, per driver. |
| `erin/limits.json` | Klippel's displacement limits as printed in each review's limits table (text). Retrieved 2026-10-15. `tests/test_engine.js` checks the Guide's limits table against it. |
| `erin/drive_levels.json` | The drive voltages printed on the intermodulation charts of the 2022 PTT8, PTT6.5X and PTT6.5M reviews, with the chart titles and links. Retrieved 2026-10-15. `tests/cmp_erin.js` drives Klirr at them. |
| `erin/drive_levels_2020.json` | For the 2020 reviews of the PTT4.0W04, SB17CAC35-4, PTT6.5W04, 18WU/4741T-00 and MW182: each harmonic distortion frame's title and level, the multitone legend (voltage and level on the same band), the first intermodulation chart's level at 2.83 V, and the voltage this gives each frame. Retrieved 2026-10-16. `tests/cmp_erin2020.js` compares the three stiffness options at those voltages. |

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
python3 ../lsi_extract.py ../cfg_li.json ../outli
python3 ../hd_extract.py ../cfg_hd.json ../outhd
python3 ../hd_extract.py ../cfg_hd2020.json ../outhd2020
python3 ../xp_extract.py . ../out/extracted.json ../outc/extracted.json ../xp/fit_ranges.json
cd ../../..
python3 build_library.py
git diff library.json research/      # should show no changes apart from overlay paths
```

Needs Python 3 with numpy and Pillow, and the tesseract program.
