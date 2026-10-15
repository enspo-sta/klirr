/* Klirr analysis views: harmonic distortion, intermodulation, multitone, maximum SPL. */
function ratioVal(r, unit) { return unit === 'pct' ? r * 100 : db20(r); }
function ratioAxis(unit) { return unit === 'pct' ? { type: 'log', label: '%', floor: 1e-4 } : { mode: 'db', span: 100, maxCap: 0, label: 'dB re fundamental' }; }
function ratioFmt(unit) { return unit === 'pct' ? (v) => (v >= 1 ? v.toFixed(2) : v.toPrecision(2)) + ' %' : (v) => v.toFixed(1) + ' dB'; }
function levelOf(st) { return st.mode === 'voltage' ? { mode: 'voltage', value: st.volts } : st.mode === 'spl' ? { mode: 'spl', value: st.level } : { mode: 'splref', value: st.level, fref: st.fref }; }
function levelText(st) { return st.mode === 'voltage' ? fmt(st.volts, 2) + ' V' : st.mode === 'spl' ? fmt(st.level, 1) + ' dB SPL at every frequency' : fmt(st.level, 1) + ' dB at ' + fmtHz(st.fref) + ' (constant voltage)'; }

// ================================================================== harmonic distortion
App.views.distortion = (() => {
  const root = $('#view-distortion'); const S = () => App.settings.hd;
  let pb, rb, pHd, pX, pC, pM, pW1, pW2, tableHost, noteHost, mechSel, mechHost, wfHost, wfTitle, overlaySel;
  let mechWhich = 'H2';
  function build() {
    root.innerHTML = ''; root.className = 'view';
    const st = S();
    const levelFields = h('div', { class: 'fs-body' });
    const renderLevel = () => {
      levelFields.innerHTML = '';
      levelFields.append(field('Level', selectInput('hd-mode', st.mode, [['splref', 'Voltage set by SPL at one frequency'], ['spl', 'Same SPL at every frequency'], ['voltage', 'Fixed voltage']], (v) => { st.mode = v; saveSettings(); renderLevel(); })));
      if (st.mode === 'voltage') levelFields.append(field('Voltage (RMS)', numInput('hd-volts', st.volts, (v) => { st.volts = clamp(v || 2.83, 0.01, 500); saveSettings(); }), 'V'));
      else {
        const g = h('div', { class: 'grid2' }, field('SPL at 1 m', numInput('hd-level', st.level, (v) => { st.level = clamp(v || 94, 40, 140); saveSettings(); }), 'dB'));
        if (st.mode === 'splref') g.append(field('Reference frequency', numInput('hd-fref', st.fref, (v) => { st.fref = clamp(v || 500, 10, 20000); saveSettings(); }), 'Hz'));
        levelFields.append(g);
        levelFields.append(h('p', { class: 'hint' }, st.mode === 'splref' ? 'Like a measurement: one voltage for the whole sweep, chosen so the linear model gives this SPL at the reference frequency. Your driver database convention is 94 dB at 500 Hz for mids and 100 Hz for bass.' : 'Each frequency is driven to this SPL in the linear model, so low frequencies get large excursion. Useful for comparing at equal output.'));
      }
    };
    renderLevel();
    const show = h('div', { class: 'row' }, ['H2', 'H3', 'H4', 'H5', 'THD'].map((k) => checkbox('hd-show-' + k, st.show[k], k, (v) => { st.show[k] = v; saveSettings(); draw(); })));
    overlaySel = h('select', { id: 'hd-overlay' });
    overlaySel.addEventListener('change', () => { st.overlay = overlaySel.value; saveSettings(); draw(); });
    pb = progressBlock(); rb = runButtons(run);
    const ctl = h('div', { class: 'stack sticky-side' },
      h('div', { class: 'card' },
        h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Harmonic distortion'), h('h2', null, 'Stepped-sine sweep'))),
        h('div', { class: 'fs-body' },
          levelFields,
          h('div', { class: 'grid3' },
            field('From', numInput('hd-f0', st.f0, (v) => { st.f0 = clamp(v || 20, 5, 20000); saveSettings(); }), 'Hz'),
            field('To', numInput('hd-f1', st.f1, (v) => { st.f1 = clamp(v || 2000, 10, 20000); saveSettings(); }), 'Hz'),
            field('Points', selectInput('hd-ppo', st.ppo, [[3, '1/3 oct'], [6, '1/6 oct'], [12, '1/12 oct']], (v) => { st.ppo = +v; saveSettings(); }))),
          checkbox('hd-mech', st.mech, 'Split the first setup by mechanism', (v) => { st.mech = v; saveSettings(); }),
          rb.el, pb.el)),
      h('div', { class: 'card' },
        h('div', { class: 'fs-body' },
          h('span', { class: 'kicker' }, 'Display'),
          show,
          h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Units'), seg('hd-unit', st.unit, [['db', 'dB'], ['pct', '%']], (v) => { st.unit = v; saveSettings(); draw(); })),
          field('Measured overlay', overlaySel),
          h('p', { class: 'hint' }, 'Measured curves come from the driver entry, with the source linked under the chart. They include mechanisms the model leaves out, so compare the low-frequency region first.'))));
    pHd = h('div'); pX = h('div'); pC = h('div'); pM = h('div'); tableHost = h('div', { class: 'tbl-wrap' }); noteHost = h('div');
    mechSel = h('select', { id: 'hd-mech-setup' }); mechHost = h('div', { class: 'fs-body' });
    wfHost = h('div', { class: 'grid2' }); wfTitle = h('p', { class: 'small muted' }, 'Click a frequency in the distortion chart to see the displacement and pressure waveforms of the first setup there.');
    const res = h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Result'), h('h2', { id: 'hd-title' }, 'Harmonic distortion')), exportButtons(() => App._hdPlot, 'klirr-harmonic-distortion')), pHd, noteHost),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Summary'), h('h3', null, 'Worst case in the sweep'))), tableHost),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Voice coil'), h('h3', null, 'Peak excursion (solid) and dynamic DC offset (dashed)')), exportButtons(() => App._hdX, 'klirr-excursion')), pX, h('p', { class: 'hint' }, 'Horizontal lines mark the lower of the Klippel limits X_Bl (Bl falls to 82 %) and X_C (compliance falls to 75 %) for the first way of each setup. A DC offset shows rectification by asymmetric Bl(x), Kms(x) or Le(x).')),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Compression'), h('h3', null, 'Fundamental SPL minus the linear model')), exportButtons(() => App._hdC, 'klirr-compression')), pC),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Mechanisms'), h('h3', null, 'Where the distortion comes from')), h('div', { class: 'row' }, seg('hd-mech-which', mechWhich, [['H2', 'H2'], ['H3', 'H3'], ['THD', 'THD']], (v) => { mechWhich = v; drawMech(); }), mechSel, h('button', { class: 'btn sm', type: 'button', onclick: () => runMech() }, 'Break down'))), mechHost),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Waveforms'), h('h3', null, 'Displacement and pressure over time')), null), wfTitle, wfHost));
    root.append(ctl, res);
    const cl = (f) => showWaveform(f);
    App._hdPlot = new Plot(pHd, { height: 360, x: { type: 'log', label: 'Hz' }, y: ratioAxis(st.unit), onClick: cl, aria: 'Harmonic distortion versus frequency' });
    App._hdX = new Plot(pX, { height: 250, x: { type: 'log', label: 'Hz' }, y: { label: 'mm', zero: true }, aria: 'Peak excursion versus frequency' });
    App._hdC = new Plot(pC, { height: 220, x: { type: 'log', label: 'Hz' }, y: { label: 'dB' }, aria: 'Compression versus frequency' });
    App._hdM = new Plot(pM, { height: 300, x: { type: 'log', label: 'Hz' }, y: ratioAxis(st.unit), aria: 'Distortion by mechanism' });
    mechHost.append(pM);
    fillMechSel(); fillOverlay();
    draw();
  }
  function fillMechSel() {
    const act = activeSetups(); mechSel.innerHTML = '';
    for (const s of act) mechSel.append(h('option', { value: s.id }, s.name));
    const r = App.res.hd; if (r && r.mech && act.some((s) => s.id === r.mech.id)) mechSel.value = r.mech.id;
  }
  function fillOverlay() {
    const st = S(); overlaySel.innerHTML = ''; overlaySel.append(h('option', { value: '' }, 'None'));
    const seen = new Set();
    for (const s of activeSetups()) for (const w of s.ways) {
      const d = driverFor(w.driverId); if (!d || !d.measurements || seen.has(d.id)) continue; seen.add(d.id);
      d.measurements.forEach((m, i) => { if (m.kind === 'hd') overlaySel.append(h('option', { value: d.id + '|' + i }, d.label + ': ' + m.label)); });
    }
    overlaySel.value = [...overlaySel.options].some((o) => o.value === st.overlay) ? st.overlay : '';
  }
  async function run() {
    const act = activeSetups(); if (!act.length) { pb.err('Select at least one setup in the Compare bar.'); return; }
    const st = S(); const freqs = freqList(st.f0, st.f1, st.ppo);
    let setups; try { setups = act.map(engineSetup); } catch (e) { pb.err(e.message); return; }
    const level = levelOf(st);
    const r = await guard(pb, rb, () => Compute.run('hdSweep', { setups, freqs, level, harmonics: 5, mechanisms: false }, (p, info) => pb.set(p, 'Simulating ' + (info && info.f ? fmtHz(info.f) : '') + ' · ' + Math.round(p * 100) + ' %')));
    if (!r) return;
    App.res.hd = { st: clone(st), level, meta: act.map((s) => ({ id: s.id, name: s.name, color: setupColor(s), ways: s.ways.map((w) => w.driverId) })), data: r, mech: null };
    draw();
    if (st.mech) { mechSel.value = act[0].id; await runMech(); }
  }
  async function runMech() {
    const r = App.res.hd; if (!r) { pb.err('Run the sweep first.'); return; }
    const s = App.setups.find((x) => x.id === mechSel.value) || activeSetups()[0]; if (!s) return;
    const freqs = r.data[0].f.slice();
    const out = await guard(pb, rb, () => Compute.run('hdSweep', { setups: [engineSetup(s)], freqs, level: r.level, harmonics: 5, mechanisms: true }, (p) => pb.set(p, 'Splitting ' + s.name + ' by mechanism · ' + Math.round(p * 100) + ' %')));
    if (!out) return;
    r.mech = { id: s.id, name: s.name, color: setupColor(s), data: out[0] };
    drawMech();
  }
  function draw() {
    const st = S(); const r = App.res.hd;
    const unit = st.unit;
    App._hdPlot.setAxes(null, ratioAxis(unit)); App._hdM.setAxes(null, ratioAxis(unit));
    App._hdPlot.o.tipY = ratioFmt(unit); App._hdM.o.tipY = ratioFmt(unit);
    if (!r) { App._hdPlot.setData([]); return; }
    $('#hd-title').textContent = 'Harmonic distortion at ' + levelText(r.st);
    const series = [];
    r.data.forEach((d, k) => {
      const m = r.meta[k];
      ['H2', 'H3', 'H4', 'H5'].forEach((hn, n) => { if (!st.show[hn]) return; series.push({ id: m.id + hn, name: m.name + ' · ' + hn, color: m.color, dash: DASH[hn], pts: d.f.map((f, i) => [f, ratioVal(d.hd[i][n], unit)]) }); });
      if (st.show.THD) series.push({ id: m.id + 'THD', name: m.name + ' · THD', color: m.color, dash: DASH.THD, width: 2, pts: d.f.map((f, i) => [f, ratioVal(d.thd[i], unit)]) });
    });
    // measured overlay
    noteHost.innerHTML = '';
    if (st.overlay) {
      const [did, mi] = st.overlay.split('|'); const d = driverFor(did); const m = d && d.measurements && d.measurements[+mi];
      if (m) {
        for (const hn of ['H2', 'H3']) if (m.series[hn] && st.show[hn]) series.push({ id: 'meas' + hn, name: 'Measured ' + hn + ' (' + d.model + ')', color: GREY, width: 1.5, dash: hn === 'H2' ? [] : [6, 4], pts: m.series[hn].map((p) => [p[0], unit === 'pct' ? Math.pow(10, p[1] / 20) * 100 : p[1]]) });
        const src = (d.sources || []).find((x) => x.sid === m.source) || (d.sources || [])[0];
        noteHost.append(h('p', { class: 'hint', style: { marginTop: '8px' } }, 'Grey: ', m.conditions, '. ', src ? h('a', { href: src.url, target: '_blank', rel: 'noopener' }, src.publisher + ' review') : null, m.image ? [', ', h('a', { href: m.image, target: '_blank', rel: 'noopener' }, 'original plot')] : null, '. Pixel-extracted; the simulation above uses the level you set, so match it to the measurement level to compare.'));
      }
    }
    const fr = r.data[0] ? [r.data[0].f[0], r.data[0].f[r.data[0].f.length - 1]] : [20, 20000];
    App._hdPlot.setData(series, { x: { min: fr[0], max: fr[1] } });
    // excursion
    const xs = [], hl = [];
    r.data.forEach((d, k) => {
      const m = r.meta[k]; const nW = d.ways[0].length;
      for (let w = 0; w < nW; w++) {
        const nm = m.name + (nW > 1 ? ' · way ' + (w + 1) : '');
        xs.push({ id: m.id + 'x' + w, name: nm + ' peak', color: m.color, pts: d.f.map((f, i) => [f, d.ways[i][w].xpk]), fmt: (v) => v.toFixed(2) + ' mm' });
        xs.push({ id: m.id + 'dc' + w, name: nm + ' DC', color: m.color, dash: [6, 4], width: 1.5, pts: d.f.map((f, i) => [f, d.ways[i][w].xdc]), fmt: (v) => v.toFixed(3) + ' mm' });
      }
      const d0 = driverFor(m.ways[0]); const lim = d0 ? klippelLimit(d0) : null;
      if (lim) hl.push({ y: lim, color: m.color, dash: [2, 4], label: 'limit ' + lim.toFixed(1) + ' mm', include: true });
    });
    App._hdX.setData(xs, { hlines: hl, x: { min: fr[0], max: fr[1] } });
    App._hdC.setData(r.data.map((d, k) => ({ id: r.meta[k].id + 'c', name: r.meta[k].name, color: r.meta[k].color, pts: d.f.map((f, i) => [f, d.spl[i] - d.splLin[i]]), fmt: (v) => v.toFixed(2) + ' dB' })), { x: { min: fr[0], max: fr[1] } });
    // table
    const rows = r.data.map((d, k) => {
      const m = r.meta[k]; let wx = { v: -1 }, wdc = { v: 0 }, w2 = { v: -1 }, w3 = { v: -1 }, oor = false;
      d.f.forEach((f, i) => {
        d.ways[i].forEach((w) => { if (w.xpk > wx.v) wx = { v: w.xpk, f }; if (Math.abs(w.xdc) > Math.abs(wdc.v)) wdc = { v: w.xdc, f }; if (w.outOfRange) oor = true; });
        if (d.hd[i][0] > w2.v) w2 = { v: d.hd[i][0], f }; if (d.hd[i][1] > w3.v) w3 = { v: d.hd[i][1], f };
      });
      return h('tr', null, h('td', { class: 'nm' }, h('span', { class: 'row', style: { flexWrap: 'nowrap', gap: '6px' } }, h('span', { class: 'sw', style: { background: m.color } }), m.name)),
        h('td', { class: 'n' }, fmt(d.V[0], 2) + (r.st.mode === 'spl' ? '–' + fmt(Math.max(...d.V), 1) : '') + ' V'),
        h('td', { class: 'n' }, fmt(wx.v, 2) + ' mm @ ' + fmtHz(wx.f) + (oor ? ' ⚠' : '')),
        h('td', { class: 'n' }, fmt(wdc.v, 3) + ' mm @ ' + fmtHz(wdc.f || 0)),
        h('td', { class: 'n' }, fmtRatio(w2.v, st.unit) + ' @ ' + fmtHz(w2.f)),
        h('td', { class: 'n' }, fmtRatio(w3.v, st.unit) + ' @ ' + fmtHz(w3.f)));
    });
    tableHost.innerHTML = '';
    tableHost.append(h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Setup'), h('th', { class: 'n' }, 'Drive'), h('th', { class: 'n' }, 'Peak excursion'), h('th', { class: 'n' }, 'Largest DC offset'), h('th', { class: 'n' }, 'Worst H2'), h('th', { class: 'n' }, 'Worst H3'))), h('tbody', null, rows)));
    if (r.data.some((d) => d.ways.some((ws) => ws.some((w) => w.outOfRange)))) tableHost.append(h('p', { class: 'hint', style: { marginTop: '8px' } }, '⚠ The voice coil left the displacement range covered by the driver\'s measured curves; beyond that range the curves are extended with their end slopes, so treat those points as rough.'));
    drawMech();
  }
  function drawMech() {
    const r = App.res.hd; const st = S();
    if (!r || !r.mech) { App._hdM.setData([]); return; }
    const d = r.mech.data; const idx = mechWhich === 'H2' ? 0 : mechWhich === 'H3' ? 1 : -1;
    const val = (hd, thd) => ratioVal(idx < 0 ? thd : hd[idx], st.unit);
    const series = [{ id: 'all', name: 'All mechanisms', color: GREY, width: 2.5, pts: d.f.map((f, i) => [f, val(d.hd[i], d.thd[i])]) }];
    for (const k of Object.keys(d.mech)) series.push({ id: k, name: MECH[k].name, color: MECH[k].color, width: 1.8, pts: d.f.map((f, i) => [f, val(d.mech[k].hd[i], d.mech[k].thd[i])]) });
    App._hdM.setData(series, { x: { min: d.f[0], max: d.f[d.f.length - 1] } });
  }
  async function showWaveform(f) {
    const r = App.res.hd; const s = r ? App.setups.find((x) => x.id === r.meta[0].id) : activeSetups()[0]; if (!s) return;
    wfTitle.textContent = 'Computing ' + s.name + ' at ' + fmtHz(f) + '…';
    try {
      const w = await Compute.run('waveform', { setup: engineSetup(s), f, level: levelOf(S()) });
      wfTitle.textContent = s.name + ' at ' + fmtHz(w.f) + ', ' + fmt(w.V, 2) + ' V. Colour: full nonlinear model. Grey: linear model.';
      wfHost.innerHTML = '';
      const a = h('div'), b = h('div'); wfHost.append(a, b);
      const t = w.all.t.map((v) => v * 1000);
      const p1 = new Plot(a, { height: 200, x: { type: 'lin', label: 'ms' }, y: { label: 'excursion, mm' }, tipX: (x) => x.toFixed(2) + ' ms' });
      const ser = [{ id: 'l', name: 'Linear', color: GREY, width: 1.5, pts: t.map((x, i) => [x, w.none.ways[0].x[i]]) }, { id: 'n', name: 'Nonlinear', color: setupColor(s), pts: t.map((x, i) => [x, w.all.ways[0].x[i]]) }];
      p1.setData(ser, { hlines: [{ y: 0, color: '#3a414d', dash: [], include: false }] });
      const p2 = new Plot(b, { height: 200, x: { type: 'lin', label: 'ms' }, y: { label: 'pressure at 1 m, Pa' }, tipX: (x) => x.toFixed(2) + ' ms' });
      p2.setData([{ id: 'l', name: 'Linear', color: GREY, width: 1.5, pts: t.map((x, i) => [x, w.none.p[i]]) }, { id: 'n', name: 'Nonlinear', color: setupColor(s), pts: t.map((x, i) => [x, w.all.p[i]]) }]);
    } catch (e) { wfTitle.textContent = e.message; }
  }
  return { build, onShow() { if (!pHd) build(); }, onSetups() { if (pHd) { fillMechSel(); fillOverlay(); } }, autoRun() { if (!pHd) build(); return run(); } };
})();

// ================================================================== two-tone intermodulation
const IMD_PRESETS = {
  p250: { name: '250 Hz + 2125 Hz, equal voltages', f1: 250, f2: 2125, ratioDb: 0, ref: 'f2', level: 94 },
  p500: { name: '500 Hz + 4250 Hz, equal voltages', f1: 500, f2: 4250, ratioDb: 0, ref: 'f2', level: 94 },
  p30: { name: '30 Hz + 255 Hz, 4:1', f1: 30, f2: 255, ratioDb: 12.04, ref: 'f1', level: 90 },
  iec: { name: 'Klippel Xmax test: f1 = fs, f2 = 8.5·fs, 4:1', ratioDb: 12.04, ref: 'f1', level: 90, iec: true },
  custom: { name: 'Custom' },
};
App.views.imd = (() => {
  const root = $('#view-imd'); const S = () => App.settings.imd;
  let pb, rb, pD, pS, tbl, mechHost, specTitle, specSetupSel, freqBox;
  let sel = { setup: null, idx: null };
  function build() {
    root.innerHTML = ''; root.className = 'view';
    const st = S();
    freqBox = h('div', { class: 'fs-body' });
    const renderFreq = () => {
      freqBox.innerHTML = '';
      const iec = st.preset === 'iec';
      freqBox.append(h('div', { class: 'grid3' },
        field('Bass tone f1', numInput('imd-f1', iec ? null : st.f1, (v) => { st.f1 = clamp(v || 40, 5, 10000); st.preset = 'custom'; saveSettings(); renderFreq(); }, iec ? { disabled: true, placeholder: 'fs' } : null), 'Hz'),
        field('Voice tone f2', numInput('imd-f2', iec ? null : st.f2, (v) => { st.f2 = clamp(v || 400, 20, 20000); st.preset = 'custom'; saveSettings(); renderFreq(); }, iec ? { disabled: true, placeholder: '8.5·fs' } : null), 'Hz'),
        field('U1 : U2', numInput('imd-ratio', st.ratioDb, (v) => { st.ratioDb = clamp(v || 0, -40, 40); saveSettings(); }), 'dB')));
      freqBox.append(h('p', { class: 'hint' }, iec ? 'Each setup gets f1 at the small-signal resonance of its first driver (the X_D limit in Drivers uses the large-signal resonance) and f2 = 8.5·f1, with U1 = 4·U2 (12.04 dB), as in Klippel\'s Xmax method.' : '12.04 dB is the 4:1 voltage ratio of IEC 60268; 0 dB gives equal voltages.'));
    };
    renderFreq();
    const sweepBox = h('div', { class: 'fs-body' });
    const renderSweep = () => {
      sweepBox.innerHTML = '';
      sweepBox.append(field('Sweep', selectInput('imd-sweep', st.sweep, [['level', 'Level'], ['f1', 'Bass tone frequency f1'], ['single', 'Single point']], (v) => { st.sweep = v; saveSettings(); renderSweep(); })));
      const lvl = field('Level (' + (st.ref === 'voltage' ? 'V' : 'dB SPL') + ')', numInput('imd-level', st.level, (v) => { st.level = v == null ? 94 : v; saveSettings(); }));
      if (st.sweep === 'level') sweepBox.append(h('div', { class: 'grid3' }, field('From', numInput('imd-l0', st.l0, (v) => { st.l0 = v; saveSettings(); }), st.ref === 'voltage' ? 'V' : 'dB'), field('To', numInput('imd-l1', st.l1, (v) => { st.l1 = v; saveSettings(); }), st.ref === 'voltage' ? 'V' : 'dB'), field('Step', numInput('imd-lstep', st.lstep, (v) => { st.lstep = clamp(v || 2, 0.1, 20); saveSettings(); }), st.ref === 'voltage' ? 'V' : 'dB')));
      else if (st.sweep === 'f1') sweepBox.append(h('div', { class: 'grid3' }, field('f1 from', numInput('imd-s0', st.s0, (v) => { st.s0 = clamp(v || 20, 5, 5000); saveSettings(); }), 'Hz'), field('f1 to', numInput('imd-s1', st.s1, (v) => { st.s1 = clamp(v || 200, 6, 10000); saveSettings(); }), 'Hz'), field('Points', selectInput('imd-sppo', st.sppo, [[3, '1/3 oct'], [6, '1/6 oct'], [12, '1/12 oct']], (v) => { st.sppo = +v; saveSettings(); }))), lvl);
      else sweepBox.append(lvl);
    };
    renderSweep();
    pb = progressBlock(); rb = runButtons(run);
    const ctl = h('div', { class: 'stack sticky-side' }, h('div', { class: 'card' },
      h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Intermodulation'), h('h2', null, 'Two-tone test'))),
      h('div', { class: 'fs-body' },
        field('Test signal', selectInput('imd-preset', st.preset, Object.entries(IMD_PRESETS).map(([k, v]) => [k, v.name]), (v) => { st.preset = v; const p = IMD_PRESETS[v]; for (const k of ['f1', 'f2', 'ratioDb', 'ref', 'level']) if (p[k] != null) st[k] = p[k]; saveSettings(); build(); })),
        freqBox,
        field('Level refers to', selectInput('imd-ref', st.ref, [['f2', 'SPL of the voice tone f2'], ['f1', 'SPL of the bass tone f1'], ['voltage', 'Voltage of the bass tone U1']], (v) => { st.ref = v; saveSettings(); renderSweep(); })),
        sweepBox,
        checkbox('imd-mech', st.mech, 'Split the first setup by mechanism', (v) => { st.mech = v; saveSettings(); }),
        h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Units'), seg('imd-unit', st.unit, [['db', 'dB'], ['pct', '%']], (v) => { st.unit = v; saveSettings(); draw(); })),
        rb.el, pb.el,
        h('p', { class: 'hint' }, 'd2 = (|P(f2−f1)| + |P(f2+f1)|) / |P(f2)| and d3 = (|P(f2−2f1)| + |P(f2+2f1)|) / |P(f2)|, the IEC 60268 definitions quoted by Klippel. Both are relative to the voice tone.'))));
    pD = h('div'); pS = h('div'); tbl = h('div', { class: 'tbl-wrap' }); mechHost = h('div', { class: 'tbl-wrap' });
    specTitle = h('h3', null, 'Output spectrum'); specSetupSel = h('select', { id: 'imd-spec-setup' });
    specSetupSel.addEventListener('change', () => { sel.setup = specSetupSel.value; showSpectrum(); });
    const res = h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Result'), h('h2', { id: 'imd-title' }, 'Intermodulation distortion')), exportButtons(() => App._imdPlot, 'klirr-intermodulation')), pD, h('p', { class: 'hint' }, 'Solid: d2 (second order). Dashed: d3 (third order). Click a point to show its spectrum.')),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Spectrum'), specTitle), h('div', { class: 'row' }, specSetupSel, exportButtons(() => App._imdSpec, 'klirr-imd-spectrum'))), pS),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Sidebands'), h('h3', null, 'Products at the selected point'))), tbl),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Mechanisms'), h('h3', null, 'd2 and d3 with one nonlinearity at a time'))), mechHost));
    root.append(ctl, res);
    App._imdPlot = new Plot(pD, { height: 330, x: { type: st.sweep === 'f1' ? 'log' : 'lin', label: '' }, y: ratioAxis(st.unit), onClick: (x) => pick(x), aria: 'Intermodulation distortion' });
    App._imdSpec = new Plot(pS, { height: 300, x: { type: 'log', label: 'Hz' }, y: { mode: 'db', span: 130, label: 'dB SPL at 1 m' }, aria: 'Output spectrum' });
    draw();
  }
  function pointsFor(s) {
    const st = S(); const p = IMD_PRESETS[st.preset] || {};
    let f1 = st.f1, f2 = st.f2;
    if (p.iec) { const d = driverFor(s.ways[0].driverId); const sm = d ? driverSummaryCached(d) : null; f1 = sm && sm.der ? sm.der.fs : 40; f2 = 8.5 * f1; }
    const lvl = (v) => ({ ref: st.ref, value: v });
    if (st.sweep === 'level') { const out = []; const a = Math.min(st.l0, st.l1), b = Math.max(st.l0, st.l1); for (let v = a; v <= b + 1e-9 && out.length < 60; v += st.lstep) out.push({ f1, f2, ratioDb: st.ratioDb, level: lvl(+v.toFixed(4)), x: v }); return out; }
    if (st.sweep === 'f1') return freqList(st.s0, st.s1, st.sppo).map((f) => ({ f1: f, f2: p.iec ? 8.5 * f : Math.max(f2, 3.2 * f), ratioDb: st.ratioDb, level: lvl(st.level), x: f }));
    return [{ f1, f2, ratioDb: st.ratioDb, level: lvl(st.level), x: st.level }];
  }
  async function run() {
    const act = activeSetups(); if (!act.length) { pb.err('Select at least one setup in the Compare bar.'); return; }
    const st = S(); let ess; try { ess = act.map(engineSetup); } catch (e) { pb.err(e.message); return; }
    const out = await guard(pb, rb, async () => {
      const res = [];
      for (let k = 0; k < act.length; k++) {
        const pts = pointsFor(act[k]);
        const r = await Compute.run('imdSweep', { setups: [ess[k]], points: pts, mechanisms: st.mech && k === 0, spectrumIndex: pts.length - 1 }, (p) => pb.set((k + p) / act.length, 'Simulating ' + act[k].name + ' · ' + Math.round(p * 100) + ' %'));
        res.push({ id: act[k].id, name: act[k].name, color: setupColor(act[k]), pts, r: r[0] });
      }
      return res;
    });
    if (!out) return;
    App.res.imd = { st: clone(st), data: out };
    sel = { setup: out[0].id, idx: out[0].pts.length - 1 };
    draw();
  }
  function xLabel(st) { return st.sweep === 'f1' ? 'Hz (bass tone)' : st.ref === 'voltage' ? 'V (bass tone)' : 'dB SPL (' + (st.ref === 'f1' ? 'bass tone' : 'voice tone') + ')'; }
  function draw() {
    const R = App.res.imd; const st = S();
    const unit = st.unit; App._imdPlot.o.tipY = ratioFmt(unit);
    if (!R) { App._imdPlot.setData([]); App._imdSpec.setData([]); return; }
    const rst = R.st; App._imdPlot.o.x = { type: rst.sweep === 'f1' ? 'log' : 'lin', label: xLabel(rst) }; App._imdPlot.o.y = ratioAxis(unit);
    App._imdPlot.o.tipX = rst.sweep === 'f1' ? fmtHz : (x) => fmt(x, 1) + (rst.ref === 'voltage' ? ' V' : ' dB');
    $('#imd-title').textContent = 'Intermodulation, ' + (IMD_PRESETS[rst.preset] || {}).name;
    const series = [];
    for (const d of R.data) {
      series.push({ id: d.id + 'd2', name: d.name + ' · d2', color: d.color, dash: DASH.d2, markers: d.pts.length < 16, pts: d.pts.map((p, i) => [p.x, ratioVal(d.r.points[i].d2, unit), 'x_pk ' + fmt(d.r.points[i].ways[0].xpk, 2) + ' mm']) });
      series.push({ id: d.id + 'd3', name: d.name + ' · d3', color: d.color, dash: DASH.d3, pts: d.pts.map((p, i) => [p.x, ratioVal(d.r.points[i].d3, unit)]) });
    }
    App._imdPlot.setData(series);
    specSetupSel.innerHTML = ''; for (const d of R.data) specSetupSel.append(h('option', { value: d.id }, d.name)); specSetupSel.value = sel.setup;
    showSpectrum(); drawTable(); drawMech();
  }
  function pick(x) {
    const R = App.res.imd; if (!R) return; const d = R.data.find((q) => q.id === sel.setup) || R.data[0];
    let bi = 0, bd = Infinity; d.pts.forEach((p, i) => { const dd = R.st.sweep === 'f1' ? Math.abs(Math.log(p.x / x)) : Math.abs(p.x - x); if (dd < bd) { bd = dd; bi = i; } });
    sel.idx = bi; showSpectrum(); drawTable();
  }
  async function showSpectrum() {
    const R = App.res.imd; if (!R) return; const d = R.data.find((q) => q.id === sel.setup) || R.data[0]; const i = clamp(sel.idx == null ? d.pts.length - 1 : sel.idx, 0, d.pts.length - 1);
    let q = d.r.points[i];
    if (!q.spectrum) {
      const s = App.setups.find((x) => x.id === d.id); if (!s) return;
      specTitle.textContent = 'Computing spectrum…';
      try { const r = await Compute.run('imdSweep', { setups: [engineSetup(s)], points: [d.pts[i]], mechanisms: false, spectrumIndex: 0 }); q.spectrum = r[0].points[0].spectrum; } catch (e) { specTitle.textContent = e.message; return; }
    }
    const sp = q.spectrum; const peak = Math.max(...sp.mag);
    const pts = []; sp.mag.forEach((m, k) => { if (k > 0 && m > peak - 125) pts.push([k * sp.df, m]); });
    const labels = [];
    const tag = (f, t) => { const k = Math.round(f / sp.df); if (k > 0 && k < sp.mag.length && sp.mag[k] > peak - 110) labels.push({ x: k * sp.df, y: sp.mag[k], text: t }); };
    tag(q.f1, 'f1'); tag(q.f2, 'f2'); tag(q.f2 - q.f1, '−1'); tag(q.f2 + q.f1, '+1'); tag(q.f2 - 2 * q.f1, '−2'); tag(q.f2 + 2 * q.f1, '+2'); tag(2 * q.f1, '2f1'); tag(3 * q.f1, '3f1');
    App._imdSpec.o.labels = labels;
    App._imdSpec.setData([{ id: 'sp', name: d.name, color: d.color, kind: 'stem', width: 1.4, r: 2.5, pts, fmt: (v) => v.toFixed(1) + ' dB' }], { x: { min: Math.max(5, q.f1 / 2), max: Math.min(sp.df * sp.mag.length, Math.max(q.f2 * 2.2, q.f2 + 5 * q.f1)) } });
    specTitle.textContent = d.name + ': f1 ' + fmtHz(q.f1) + ' at ' + fmt(q.spl1, 1) + ' dB, f2 ' + fmtHz(q.f2) + ' at ' + fmt(q.spl2, 1) + ' dB';
    App._imdPlot.vlines = [{ x: d.pts[i].x, color: 'rgba(231,234,240,.4)', dash: [3, 3] }]; App._imdPlot.draw();
  }
  function drawTable() {
    const R = App.res.imd; if (!R) return; const st = S();
    const i0 = sel.idx == null ? null : sel.idx;
    // one column per setup, one row per product, so a row compares the setups directly
    const cols = R.data.map((d) => { const i = clamp(i0 == null ? d.pts.length - 1 : i0, 0, d.pts.length - 1); return { d, i, q: d.r.points[i] }; });
    const rel = (c, v) => fmt(db20(v / c.f2), 1);
    const rows = [
      ['Bass tone f1, dB SPL', (q) => fmt(q.spl1, 1)],
      ['Voice tone f2, dB SPL', (q) => fmt(q.spl2, 1)],
      ['f2 − f1, dB re f2', (q) => rel(q.comp, q.comp.m1)],
      ['f2 + f1, dB re f2', (q) => rel(q.comp, q.comp.p1_)],
      ['f2 − 2f1, dB re f2', (q) => rel(q.comp, q.comp.m2)],
      ['f2 + 2f1, dB re f2', (q) => rel(q.comp, q.comp.p2_)],
      ['f2 − 3f1, dB re f2', (q) => rel(q.comp, q.comp.m3)],
      ['f2 + 3f1, dB re f2', (q) => rel(q.comp, q.comp.p3_)],
      ['d2', (q) => fmtRatio(q.d2, st.unit), true],
      ['d3', (q) => fmtRatio(q.d3, st.unit), true],
      ['d2 re f1, dB', (q) => fmt(db20((q.comp.m1 + q.comp.p1_) / q.comp.f1), 1)],
      ['Peak excursion, mm', (q) => fmt(q.ways[0].xpk, 2)],
      ['DC offset, mm', (q) => fmt(q.ways[0].xdc, 3)],
    ];
    const rst = R.st; const c0 = cols[0];
    const at = rst.sweep === 'f1' ? 'f1 = ' + fmtHz(c0.d.pts[c0.i].x) : rst.ref === 'voltage' ? fmt(c0.d.pts[c0.i].x, 2) + ' V on the bass tone' : fmt(c0.d.pts[c0.i].x, 1) + ' dB SPL on the ' + (rst.ref === 'f1' ? 'bass' : 'voice') + ' tone';
    tbl.innerHTML = '';
    tbl.append(h('p', { class: 'small muted', style: { marginBottom: '6px' } }, 'At ' + at + (rst.sweep === 'single' ? '' : '. Click another point in the chart to change it.')));
    tbl.append(h('table', { class: 't' },
      h('thead', null, h('tr', null, h('th', null, 'Product'), cols.map(({ d }) => h('th', { class: 'n wrap' }, h('span', { class: 'row', style: { justifyContent: 'flex-end', gap: '6px', flexWrap: 'nowrap' } }, h('span', { class: 'sw', style: { background: d.color } }), d.name))))),
      h('tbody', null, rows.map(([label, fn, strong]) => h('tr', null, h('td', { class: 'nm' }, strong ? h('b', null, label) : label), cols.map(({ q }) => h('td', { class: 'n' }, strong ? h('b', null, fn(q)) : fn(q))))))));
    tbl.append(h('p', { class: 'hint', style: { marginTop: '8px' } }, '"d2 re f1" is the same sideband sum referred to the bass tone instead of the voice tone. Some published intermodulation figures use that reference, so keep the two apart when comparing sources.'));
  }
  function drawMech() {
    const R = App.res.imd; mechHost.innerHTML = ''; if (!R) return;
    const d = R.data[0]; const mech = d.r.mech || {}; const keys = Object.keys(mech);
    if (!keys.length) { mechHost.append(h('p', { class: 'hint' }, 'Tick "Split the first setup by mechanism" and run again to see this table.')); return; }
    const st = S(); const i = clamp(sel.idx == null ? d.pts.length - 1 : sel.idx, 0, d.pts.length - 1);
    const all = d.r.points[i];
    const bar = (v, max) => h('span', { style: { display: 'inline-block', height: '8px', borderRadius: '2px', width: Math.max(2, 90 * v / max) + 'px', background: 'currentColor', opacity: .8, marginLeft: '8px', verticalAlign: 'middle' } });
    const mx2 = Math.max(all.d2, ...keys.map((k) => mech[k][i].d2)), mx3 = Math.max(all.d3, ...keys.map((k) => mech[k][i].d3));
    const rows = [['All mechanisms', GREY, all.d2, all.d3]].concat(keys.map((k) => [MECH[k].name, MECH[k].color, mech[k][i].d2, mech[k][i].d3]));
    mechHost.append(h('p', { class: 'small muted', style: { marginBottom: '6px' } }, d.name + ' at the selected point. Mechanisms interact, so the parts do not add up to the whole.'),
      h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Mechanism'), h('th', { class: 'n' }, 'd2'), h('th', null, ''), h('th', { class: 'n' }, 'd3'), h('th', null, ''))),
        h('tbody', null, rows.map(([n, c, a, b]) => h('tr', null, h('td', null, h('span', { class: 'row', style: { flexWrap: 'nowrap', gap: '6px' } }, h('span', { class: 'sw', style: { background: c } }), n)), h('td', { class: 'n' }, fmtRatio(a, st.unit)), h('td', { style: { color: c } }, bar(a, mx2)), h('td', { class: 'n' }, fmtRatio(b, st.unit)), h('td', { style: { color: c } }, bar(b, mx3)))))));
  }
  return { build, onShow() { if (!pD) build(); } };
})();

// ================================================================== multitone
App.views.multitone = (() => {
  const root = $('#view-multitone'); const S = () => App.settings.mt;
  let pb, rb, pB, pS, tiles, mechHost, specSel;
  function build() {
    root.innerHTML = ''; root.className = 'view'; const st = S();
    pb = progressBlock(); rb = runButtons(run);
    const ctl = h('div', { class: 'stack sticky-side' }, h('div', { class: 'card' },
      h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Multitone'), h('h2', null, 'Music-like test signal'))),
      h('div', { class: 'fs-body' },
        h('div', { class: 'grid3' },
          field('From', numInput('mt-f0', st.f0, (v) => { st.f0 = clamp(v || 20, 10, 5000); saveSettings(); }), 'Hz'),
          field('To', numInput('mt-f1', st.f1, (v) => { st.f1 = clamp(v || 2000, 40, 20000); saveSettings(); }), 'Hz'),
          field('Tones', selectInput('mt-ppo', st.ppo, [[3, '3 / oct'], [6, '6 / oct'], [12, '12 / oct']], (v) => { st.ppo = +v; saveSettings(); }))),
        field('Level: RMS SPL of the linear output at 1 m', numInput('mt-level', st.level, (v) => { st.level = clamp(v || 90, 40, 135); saveSettings(); }), 'dB'),
        checkbox('mt-mech', st.mech, 'Split the first setup by mechanism', (v) => { st.mech = v; saveSettings(); }),
        rb.el, pb.el,
        h('p', { class: 'hint' }, 'Log-spaced tones of equal amplitude (equal power per octave), Schroeder phases for a low crest factor, placed on odd FFT bins. Every harmonic and intermodulation product that lands between the tones is counted as distortion, the approach of Czerwinski, Voishvillo and colleagues.'))));
    pB = h('div'); pS = h('div'); tiles = h('div', { class: 'tiles' }); mechHost = h('div', { class: 'tbl-wrap' }); specSel = h('select', { id: 'mt-spec-setup' });
    specSel.addEventListener('change', drawSpec);
    const res = h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Result'), h('h2', null, 'Distortion between the tones, per third octave')), exportButtons(() => App._mtB, 'klirr-multitone-bands')), pB, h('p', { class: 'hint' }, 'Power of all non-tone bins in each third-octave band relative to the tone power in the same band.')),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Totals'), h('h3', null, 'Whole band'))), tiles),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Spectrum'), h('h3', null, 'Tones and the distortion floor')), h('div', { class: 'row' }, specSel, exportButtons(() => App._mtS, 'klirr-multitone-spectrum'))), pS, h('p', { class: 'hint' }, 'Dots: tones. Line: the highest distortion bin in each 1/24 octave. Faint line: the mean.')),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Mechanisms'), h('h3', null, 'Total distortion with one nonlinearity at a time'))), mechHost));
    root.append(ctl, res);
    App._mtB = new Plot(pB, { height: 320, x: { type: 'log', label: 'Hz (band centre)' }, y: { mode: 'db', span: 90, label: 'dB re tones' }, tipY: (v) => v.toFixed(1) + ' dB', aria: 'Multitone distortion per band' });
    App._mtS = new Plot(pS, { height: 300, x: { type: 'log', label: 'Hz' }, y: { mode: 'db', span: 110, label: 'dB SPL at 1 m' }, tipY: (v) => v.toFixed(1) + ' dB', aria: 'Multitone spectrum' });
    draw();
  }
  async function run() {
    const act = activeSetups(); if (!act.length) { pb.err('Select at least one setup in the Compare bar.'); return; }
    const st = S(); let ess; try { ess = act.map(engineSetup); } catch (e) { pb.err(e.message); return; }
    const out = await guard(pb, rb, async () => {
      const r = await Compute.run('multitone', { setups: ess, fLo: st.f0, fHi: st.f1, perOct: st.ppo, level: st.level, mechanisms: false }, (p) => pb.set(p * (st.mech ? 0.5 : 1), 'Simulating · ' + Math.round(p * 100) + ' %'));
      let mech = null;
      if (st.mech) { const m = await Compute.run('multitone', { setups: [ess[0]], fLo: st.f0, fHi: st.f1, perOct: st.ppo, level: st.level, mechanisms: true }, (p) => pb.set(0.5 + p * 0.5, 'Splitting ' + act[0].name + ' by mechanism · ' + Math.round(p * 100) + ' %')); mech = m[0]; }
      return { r, mech };
    });
    if (!out) return;
    App.res.mt = { st: clone(st), meta: act.map((s) => ({ id: s.id, name: s.name, color: setupColor(s) })), data: out.r, mech: out.mech };
    draw();
  }
  function draw() {
    const R = App.res.mt; if (!R) { App._mtB.setData([]); App._mtS.setData([]); return; }
    App._mtB.setData(R.data.map((d, k) => ({ id: R.meta[k].id, name: R.meta[k].name, color: R.meta[k].color, markers: true, pts: d.bands.map((b) => [b.fc, b.ratioDb, 'distortion ' + fmt(b.distDb, 1) + ' dB SPL']) })));
    tiles.innerHTML = '';
    R.data.forEach((d, k) => {
      const w = d.ways[0];
      tiles.append(h('div', { class: 'tile' }, h('span', { class: 'k' }, h('span', { class: 'sw', style: { background: R.meta[k].color } }), R.meta[k].name), h('span', { class: 'v' }, fmt(d.totalDb, 1) + ' dB'), h('span', { class: 's' }, d.nTones + ' tones · x_pk ' + fmt(w.xpk, 2) + ' mm · DC ' + fmt(w.xdc, 3) + ' mm')));
    });
    specSel.innerHTML = ''; R.meta.forEach((m) => specSel.append(h('option', { value: m.id }, m.name)));
    drawSpec();
    mechHost.innerHTML = '';
    if (R.mech && R.mech.mech) {
      const rows = [['All mechanisms', GREY, R.mech.totalDb]].concat(Object.keys(R.mech.mech).map((k) => [MECH[k].name, MECH[k].color, R.mech.mech[k].totalDb]));
      mechHost.append(h('p', { class: 'small muted', style: { marginBottom: '6px' } }, R.meta[0].name + '. Mechanisms interact, so the parts do not add up to the whole.'), h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Mechanism'), h('th', { class: 'n' }, 'Total distortion re tones'))), h('tbody', null, rows.map(([n, c, v]) => h('tr', null, h('td', null, h('span', { class: 'row', style: { flexWrap: 'nowrap', gap: '6px' } }, h('span', { class: 'sw', style: { background: c } }), n)), h('td', { class: 'n' }, fmt(v, 1) + ' dB'))))));
    } else mechHost.append(h('p', { class: 'hint' }, 'Tick "Split the first setup by mechanism" and run again to see this table.'));
  }
  function drawSpec() {
    const R = App.res.mt; if (!R) return; const k = Math.max(0, R.meta.findIndex((m) => m.id === specSel.value)); const d = R.data[k]; const m = R.meta[k];
    App._mtS.setData([
      { id: 'dmean', name: 'Distortion, mean per 1/24 oct', color: GREY, width: 1, pts: d.dist.map((p) => [p.f, p.meanDb]), legend: true },
      { id: 'dmax', name: 'Distortion, highest bin per 1/24 oct', color: '#e7eaf0', width: 1.5, pts: d.dist.map((p) => [p.f, p.maxDb]) },
      { id: 'tones', name: 'Tones · ' + m.name, color: m.color, kind: 'dots', r: 3.5, ring: true, pts: d.tones.map((t) => [t.f, t.db]) },
    ]);
  }
  return { build, onShow() { if (!pB) build(); } };
})();

// ================================================================== maximum SPL
App.views.maxspl = (() => {
  const root = $('#view-maxspl'); const S = () => App.settings.max;
  let pb, rb, pM, tbl;
  function build() {
    root.innerHTML = ''; root.className = 'view'; const st = S();
    pb = progressBlock(); rb = runButtons(run);
    const xBox = h('div', { class: 'fs-body' });
    const renderX = () => {
      xBox.innerHTML = '';
      xBox.append(field('Excursion limit', selectInput('max-xmode', st.xmode, [['klippel', 'Klippel: X_Bl 82 % or X_C 75 %'], ['xmax', 'Datasheet Xmax'], ['fixed', 'Fixed value'], ['off', 'No excursion limit']], (v) => { st.xmode = v; saveSettings(); renderX(); })));
      if (st.xmode === 'fixed') xBox.append(field('Peak excursion', numInput('max-xmm', st.xmm, (v) => { st.xmm = clamp(v || 10, 0.1, 100); saveSettings(); }), 'mm'));
    };
    renderX();
    const ctl = h('div', { class: 'stack sticky-side' }, h('div', { class: 'card' },
      h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Maximum SPL'), h('h2', null, 'Highest clean sine level'))),
      h('div', { class: 'fs-body' },
        h('div', { class: 'grid3' },
          field('From', numInput('max-f0', st.f0, (v) => { st.f0 = clamp(v || 20, 5, 5000); saveSettings(); }), 'Hz'),
          field('To', numInput('max-f1', st.f1, (v) => { st.f1 = clamp(v || 1000, 10, 20000); saveSettings(); }), 'Hz'),
          field('Points', selectInput('max-ppo', st.ppo, [[3, '1/3 oct'], [6, '1/6 oct']], (v) => { st.ppo = +v; saveSettings(); }))),
        h('div', { class: 'grid3' },
          field('THD ≤', numInput('max-thd', st.thd, (v) => { st.thd = v == null ? 0 : clamp(v, 0, 100); saveSettings(); }), '%'),
          field('HD3 ≤', numInput('max-hd3', st.hd3, (v) => { st.hd3 = v == null ? 0 : clamp(v, 0, 100); saveSettings(); }), '%'),
          field('Compression ≤', numInput('max-comp', st.comp, (v) => { st.comp = v == null ? 0 : clamp(v, 0, 20); saveSettings(); }), 'dB')),
        xBox,
        h('div', { class: 'grid2' },
          field('Port air speed ≤', numInput('max-vport', st.vport, (v) => { st.vport = v == null ? 0 : clamp(v, 0, 200); saveSettings(); }), 'm/s'),
          field('Amplifier limit, RMS', numInput('max-vmax', st.vmax, (v) => { st.vmax = clamp(v || 40, 1, 1000); saveSettings(); }), 'V')),
        checkbox('max-power', st.power, 'Limit input power to the rated power when the driver has one', (v) => { st.power = v; saveSettings(); }),
        rb.el, pb.el,
        h('p', { class: 'hint' }, 'A criterion set to 0 is off. At each frequency a search finds the highest drive level that passes every criterion, usually to within 0.1 dB. 40 V RMS is 400 W into 4 Ω or 200 W into 8 Ω. Power is the heat in the voice coil, Re·I² with Re at the temperature set in the setup. A rated power is usually defined with a noise signal over hours, so this sine comparison is approximate; long-term thermal compression is not modelled.'))));
    pM = h('div'); tbl = h('div', { class: 'tbl-wrap' });
    const res = h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Result'), h('h2', null, 'Maximum fundamental SPL at 1 m')), exportButtons(() => App._maxP, 'klirr-max-spl')), pM, h('p', { class: 'hint' }, 'Hover a point to see which criterion stopped it.')),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Table'), h('h3', null, 'Limits by frequency'))), tbl));
    root.append(ctl, res);
    App._maxP = new Plot(pM, { height: 340, x: { type: 'log', label: 'Hz' }, y: { label: 'dB SPL at 1 m' }, tipY: (v) => v.toFixed(1) + ' dB', aria: 'Maximum SPL versus frequency' });
    draw();
  }
  function criteriaFor(s) {
    const st = S();
    const xlim = s.ways.map((w) => {
      const d = driverFor(w.driverId); if (!d || st.xmode === 'off') return null;
      if (st.xmode === 'fixed') return st.xmm;
      if (st.xmode === 'xmax') return d.ts.Xmax || null;
      return klippelLimit(d) || d.ts.Xmax || null;
    });
    const power = s.ways.map((w) => { const d = driverFor(w.driverId); return st.power && d && d.ts.Pe ? +d.ts.Pe : null; });
    return { thd: st.thd || 0, hd3: st.hd3 || 0, comp: st.comp || 0, xlim, vport: st.vport || 0, power, vmax: st.vmax };
  }
  async function run() {
    const act = activeSetups(); if (!act.length) { pb.err('Select at least one setup in the Compare bar.'); return; }
    const st = S(); const freqs = freqList(st.f0, st.f1, st.ppo);
    let ess; try { ess = act.map(engineSetup); } catch (e) { pb.err(e.message); return; }
    const out = await guard(pb, rb, async () => {
      const res = [];
      for (let k = 0; k < act.length; k++) {
        const r = await Compute.run('maxSpl', { setups: [ess[k]], freqs, criteria: criteriaFor(act[k]) }, (p, info) => pb.set((k + p) / act.length, 'Searching ' + act[k].name + (info && info.f ? ' at ' + fmtHz(info.f) : '') + ' · ' + Math.round(((k + p) / act.length) * 100) + ' %'));
        res.push({ id: act[k].id, name: act[k].name, color: setupColor(act[k]), crit: criteriaFor(act[k]), r: r[0] });
      }
      return res;
    });
    if (!out) return;
    App.res.max = { st: clone(st), data: out }; draw();
  }
  function draw() {
    const R = App.res.max; if (!R) { App._maxP.setData([]); return; }
    App._maxP.setData(R.data.map((d) => ({ id: d.id, name: d.name, color: d.color, markers: true, pts: d.r.f.map((f, i) => [f, d.r.spl[i] == null ? NaN : d.r.spl[i], 'limit: ' + d.r.limit[i]]) })));
    tbl.innerHTML = '';
    const fsel = R.data[0].r.f;
    tbl.append(h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Hz'), R.data.map((d) => h('th', { class: 'n wrap' }, h('span', { class: 'row', style: { justifyContent: 'flex-end', gap: '6px', flexWrap: 'nowrap' } }, h('span', { class: 'sw', style: { background: d.color } }), d.name))))),
      h('tbody', null, fsel.map((f, i) => h('tr', null, h('td', { class: 'n', style: { textAlign: 'left' } }, fmtHz(f)), R.data.map((d) => h('td', { class: 'n' }, d.r.spl[i] == null ? '–' : fmt(d.r.spl[i], 1) + ' dB', h('div', { class: 'small muted' }, d.r.limit[i]))))))));
    const notes = R.data.map((d) => d.name + ': excursion limit ' + d.crit.xlim.map((x) => (x ? fmt(x, 1) + ' mm' : 'none')).join(' / ') + (d.crit.power.some(Boolean) ? ', power ' + d.crit.power.map((p) => (p ? p + ' W' : 'none')).join(' / ') : ''));
    tbl.append(h('p', { class: 'hint', style: { marginTop: '8px' } }, notes.join('. ') + '.'));
  }
  return { build, onShow() { if (!pM) build(); } };
})();
