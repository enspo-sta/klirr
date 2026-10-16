# Klirr

A nonlinear loudspeaker simulator that runs in your browser: **[enspo-sta.github.io/klirr](https://enspo-sta.github.io/klirr/)**

Klirr predicts the distortion a driver adds when its voice coil moves far enough for its large-signal parameters
to change. It integrates Klippel's lumped-parameter model in time, with force factor Bl(x), suspension stiffness
Kms(x) and inductance Le(x), plus Doppler, the air in the box and jet losses in a port. From that one model it reports:

- harmonic distortion in stepped-sine sweeps, split by mechanism;
- two-tone intermodulation (d2 and d3 as in IEC 60268), including Klippel's Xmax test;
- multitone distortion per third octave;
- the highest clean sine level per frequency, with excursion, distortion, compression, port and amplifier limits;
- a listening test on a test signal or your own audio file, switching between original, linear model, nonlinear model and the distortion alone.

Setups take up to four ways, each with a driver, an infinite baffle, sealed, vented or passive-radiator enclosure,
and active filters (Linkwitz-Riley, Butterworth, Linkwitz transform, parametric and shelving EQ).

## Built-in drivers

Nine drivers carry Klippel LSI curves pixel-extracted from [Erin's Audio Corner](https://www.erinsaudiocorner.com/)
reviews, with small-signal parameters taken as text from the same pages: Purifi PTT8.0X04-NAB-02, PTT6.5X04-NAA-08,
PTT6.5M08-NFA-01A, PTT6.5W04-01A and PTT4.0W04-01A, SB Acoustics SB17CAC35-4, ScanSpeak Illuminator 18WU/4741T-00,
Dynaudio MW182 and SEAS W18NX-001. The SB Acoustics SB34NRXL75-8 is included as a labelled estimate. Every entry
links its source and records how each axis was calibrated.

You can add drivers by pasting datasheet text or Klippel polynomial coefficients, by pasting curve points, or by
importing a driver database file whose harmonic distortion measurements become overlays.

## How far to trust it

The model covers the excursion-driven nonlinearities. Against Erin's measured distortion at 96 dB, driven at the
voltages printed on his intermodulation charts, it lands within about 4 dB on average where those dominate (PTT6.5M
below 150 Hz, PTT6.5X below 60 Hz). It reads 5 to 30 dB low where the motor is very linear, as on the PTT8. Mechanisms
the model leaves out (current-dependent inductance, eddy currents, suspension creep and hysteresis) are candidates for
that gap, as are differences between samples; none of them has been tested here.
The suspension stiffness is a modelling choice with a large effect: Klippel's large-signal curve puts it at rest at
37 to 59 % of the small-signal table. By default Klirr scales the curve's shape to the small-signal value; Setups also
offers the curve as measured and the small-signal value plus the curve's change. On five drivers that played no part
in choosing the default, at six levels each, the default has the smallest bias at high level, and the three options'
mean absolute errors lie within 0.8 dB of each other.
The Guide tab in the app has the full validation tables and sources.

## Working on it

```bash
python3 build.py          # writes dist/index.html (open it in a browser) and dist/klirr.html
npm test                  # engine and Guide checks
npm install && npm run test:browser   # headless browser tests (Playwright)
```

`CLAUDE.md` describes the layout and the rules for changes. The workflow in `.github/workflows` runs the tests on
every push and publishes `dist/` to GitHub Pages from `main`.

## Sources

- W. Klippel, [Loudspeaker Nonlinearities: Causes, Parameters, Symptoms](https://www.klippel.de/fileadmin/_migrated/content_uploads/Loudspeaker_Nonlinearities%E2%80%93Causes_Parameters_Symptoms_01.pdf)
- W. Klippel, [Assessment of Voice Coil Peak Displacement Xmax](https://www.klippel.de/fileadmin/klippel/Files/Know_How/Literature/Papers/Assessment_of_Voice_coil_peak_displacement_XMAX_02.pdf)
- Klippel [application note 5, Displacement Limits due to Driver Nonlinearities](https://www.klippel.de/fileadmin/klippel/Files/Know_How/Application_Notes/AN_05_Displacement_Limits.pdf)
- G. L. Beers and H. Belar, [Frequency-Modulation Distortion in Loudspeakers](https://ieeexplore.ieee.org/document/1694699) (1943)
- E. Czerwinski et al., [Multitone Testing of Sound System Components, Part 2](https://www.aes.org/e-lib/browse.cfm?elib=10168) (2001)
- Driver data: [Erin's Audio Corner](https://www.erinsaudiocorner.com/), [SB Acoustics SB34NRXL75-8](https://sbacoustics.com/product/12-sb34nrxl75-8-norex/)

The plot images the extraction reads belong to Erin's Audio Corner and are not stored here;
`research/lsi/fetch_sources.py` downloads them from their original addresses.
