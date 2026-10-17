# Handover

State on 18 October 2026, after pull request #9 and the fixes that followed it. Read this together with `CLAUDE.md`.

## Where Klirr is published

| What | Where |
| --- | --- |
| GitHub Pages, rebuilt and deployed by the workflow on every push to `main` | https://enspo-sta.github.io/klirr/ |
| Klirr as a private Claude artifact, republished from `main` after each merge | https://claude.ai/artifact/U2prUaNQ8LgdTLk9wSGnTA |
| First-principles audit of Klirr (report; its status section lists what was done) | https://claude.ai/artifact/UGqcs83abhvEUHF21JKoZT |
| Hold-out test against HiFiCompass's PTT8 measurements (report, written before #1 to #7) | https://claude.ai/artifact/SH4C9pjVv6n4WWLw4eMKHL |
| AM versus FM distortion (report) | https://claude.ai/artifact/TsVdh7KFnjtuPGU9QwNwYi |

The Klirr artifact declares the capabilities `db`, `user` and `downloads`. Republish it by publishing `dist/klirr.html`
with that link as `url` and without a `capabilities` field, so the stored declaration is kept and saved drivers and setups
survive.

## What the audit led to

| Pull request | Change |
| --- | --- |
| [#1](https://github.com/enspo-sta/klirr/pull/1) | The amplifier limit in Max SPL applies to each way's voltage at the driver terminals, after filters and gain. `tests/cmp_erin.js` drives Klirr at the voltages Erin prints on his intermodulation charts (`research/erin/drive_levels.json`). |
| [#2](https://github.com/enspo-sta/klirr/pull/2) | Settling time from the slowest resonance, a "not reached a steady state" flag in every view, and a guard for very small voice-coil inductance. |
| [#3](https://github.com/enspo-sta/klirr/pull/3) | Klippel's fit range ±xp measured from the plots and stored per driver; limits are evaluated inside it, and Distortion marks a coil that leaves it. The published limits are stored in `research/erin/limits.json` and tested. |
| [#4](https://github.com/enspo-sta/klirr/pull/4) | Small fixes: units in pasted datasheets, unsafe links from imported files, deletions on another device, the X_D label, the power criterion, multitone tone spacing, theme colours, the MW182 size label, and port-onset wording. |
| [#5](https://github.com/enspo-sta/klirr/pull/5) | An independent harmonic-balance solver (`research/reference/`) as a regression test (`tests/reference_test.js`). |
| [#6](https://github.com/enspo-sta/klirr/pull/6) | A third suspension-stiffness option (small-signal value plus the curve's change) and a test of all three on Erin's 2020 measurements of five drivers that played no part in choosing the default. The default stays. |
| [#7](https://github.com/enspo-sta/klirr/pull/7) | Inductance against current, Le(i), from Klippel's L(X=0, I) plots for the five 2020 drivers. On by default where measured. |

The Guide (`src/template.html`) has the tables and their sources; `tests/test_engine.js`, `tests/cmp_erin.js` and
`tests/cmp_erin2020.js` fail when the engine no longer reproduces them.

## Since the audit

| Pull request | Change |
| --- | --- |
| [#9](https://github.com/enspo-sta/klirr/pull/9) | Import from David's driver database as it is now: the driver files in its `database/drivers`, its viewer's JSON export and the older `drivers.json`. Harmonic distortion sets become overlays in Distortion, read as the database's own viewer reads them (the driver database section of `src/views_manage.js`; `tests/import_test.js`). The extraction readers in `research/lsi` run on Windows. |

## Where the newer data lives

| Path | Contents |
| --- | --- |
| `research/erin/drive_levels.json` | The 2022 reviews' printed drive voltages (PTT8, PTT6.5X, PTT6.5M). |
| `research/erin/drive_levels_2020.json` | The 2020 reviews (PTT4.0W04, SB17CAC35-4, PTT6.5W04, 18WU/4741T-00, MW182): harmonic-chart frame titles and levels, the multitone legend that fixes the level at 1 V, and the voltage this gives each frame. |
| `research/lsi/cfg_hd2020.json`, `research/lsi/outhd2020/` | H2 and H3 extracted from the 30 frames of the 2020 harmonic charts (animated GIFs; `fetch_sources.py` splits them). |
| `research/lsi/cfg_li.json`, `research/lsi/outli/` | Klippel's inductance at rest against current, L(X=0, I), for the same five drivers. |
| `research/reference/` | The harmonic-balance solver and its 31 solved cases, covering all three stiffness options and Le(i). |

Rerunning any extraction: `research/lsi/fetch_sources.py` downloads the images (from `erinsaudiocorner.com` and
`dl.dropboxusercontent.com`), then the commands in `research/README.md`. It needs numpy, Pillow and `tesseract`; all
three were available in the cloud session, and so was the headless browser for `npm run test:browser`.

## Open questions, most useful first

1. **The midrange gap that remains.** With Le(i), the SB17CAC35-4's H3 at 300 to 2000 Hz matches the measurement on
   average, but H2 reads 6 to 26 dB low on all five 2020 drivers and H3 19 to 46 dB low on four of them. The Guide names the
   remaining candidates (flux modulation of Bl, eddy currents beyond the L2/R2 branch, hysteresis, the cone); none has been
   tested, and these reviews publish no data for them.
2. **The bass gap on the long-coil PTT8**, 5 to 30 dB low above 30 Hz. The 2022 reviews (PTT8, PTT6.5X, PTT6.5M) plot no
   L(X=0, I), so Le(i) is not in the model for them. Check whether another source publishes it before testing.
3. **The port.** #4 presents the jet-loss onset as Klirr's own assumption. The audit's other port items are still open: a
   frequency-dependent onset, and checking compression against measured port data.
4. **The suspension stiffness.** On the five 2020 drivers the default is the only option without a bias at high level,
   but the errors are as large as the differences between options and the drivers split three to two. The physics is
   unresolved (`src/template.html`, "Suspension stiffness against five more drivers").
5. **Multitone validation** was not done: in the 80 to 1600 Hz band the stiffness option moves Klirr's result by at most
   0.6 dB, less than the expected difference between Klippel's multitone measure and Klirr's.
6. **The hold-out report** predates #1 to #7. Rerun it before citing its numbers.

## Things worth knowing

- **Drive levels of the 2020 charts.** They rest on whole-decibel labels (±0.5 dB in voltage). Erin's two-tone charts
  print a "Calculated Xmax" about twice what the voltage implies; it is not used.
- **The 18WU/4741T-00 Le(i) trace** stops at −4 A, because the curve runs within 2 px of the frame line there. Below −4 A
  the engine holds the end value, as for every curve. The PTT4.0W04's whole Le(i) change spans 3 px, so its Le(i) result
  is the least certain.
- **`tests/reference_test.js`** accepts a harmonic difference beyond 0.02 dB only when its own size is below −110 dB re the
  fundamental, and prints each such case. One exists: an H4 at −94 dB with Le(i), which is time-step error and converges
  to the reference at a smaller step.
- **When the built-in curves change**, rerun `python3 research/reference/run_reference.py` (needs numpy) and commit
  `reference.json` with them.
- **The driver database** is the private repository [enspo-sta/elementval-drivers](https://github.com/enspo-sta/elementval-drivers)
  (it holds HiFiCompass Premium data), with its viewer at https://elementval-drivers.pages.dev/ behind a family login.
  Read it read-only (another session works in it) and never copy its data into this public repository: the import test
  uses made-up records in its formats. Its rules for levels and comparisons are in its `CLAUDE.md` and in David's
  driver-analysis skill (`references/comparison-rules.md`, `references/sources.md`). Of its 831 live harmonic sets on
  17 October 2026, 800 import as overlays; the other 31 give total harmonic distortion only, which Distortion does not
  overlay.

## How the owner works

- Plain English, no invented abbreviations. Substantive answers as HTML pages, with links to every source.
- Measurement first; keep the measured and the inferred apart.
- Work goes on a branch with a pull request; CI runs on every pull request. The owner merges, or says "Merge" and
  then I merge.
- After a merge, republish the Klirr artifact as above.
- Stacked pull requests: merge the lower one first, then retarget the upper one to `main`.
