/* Klirr management views: setups (speakers) and the driver library. */
function driverOptions() {
  const meas = LIB.filter((d) => d.badge === 'measured'), est = LIB.filter((d) => d.badge !== 'measured');
  const g = [{ group: 'Measured large-signal curves', items: meas.map((d) => [d.id, d.label]) }];
  if (est.length) g.push({ group: 'Estimates', items: est.map((d) => [d.id, d.label + ' (estimate)']) });
  if (App.userDrivers.length) g.push({ group: 'Your drivers', items: App.userDrivers.map((d) => [d.id, d.label]) });
  return g;
}
function newWay(driverId) { return { driverId: driverId || 'eac-ptt65x', count: 1, enclosure: { type: 'sealed', Vb: 10 }, filters: [], gainDb: 0, invert: false, delayMs: 0, dT: 0, Rs: 0, drive: 'voltage', kmsSource: 'table' }; }
function freeColor() { const used = new Set(App.setups.map((s) => s.colorIdx)); for (let i = 0; i < 5; i++) if (!used.has(i)) return i; return App.setups.length % 5; }
function refreshAll() { renderChips(); for (const v of Object.values(App.views)) v.onSetups && v.onSetups(); }

// ================================================================== setups
App.views.setups = (() => {
  const root = $('#view-setups');
  let listHost, edHost, pv = {};
  let previewT = 0;
  function build() {
    root.innerHTML = ''; root.className = 'view';
    listHost = h('div', { class: 'stack' }); edHost = h('div', { class: 'stack' });
    root.append(h('div', { class: 'stack sticky-side' }, h('div', { class: 'card' },
      h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Setups'), h('h2', null, 'Speakers to simulate')), h('button', { class: 'btn sm primary', type: 'button', onclick: () => addSetup() }, 'New setup')),
      listHost,
      h('div', { class: 'btn-row', style: { marginTop: '12px' } },
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => exportBundle() }, 'Export drivers and setups'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => showTab('drivers') }, 'Import in Drivers')),
      h('p', { class: 'hint', style: { marginTop: '10px' } }, 'A setup is one speaker: up to four ways, each with a driver, an enclosure and an electrical filter in front of it. Box volume is per driver.'))), edHost);
    renderList(); renderEditor();
  }
  function selected() { const id = App.settings.setupSel; return App.setups.find((s) => s.id === id) || App.setups[0] || null; }
  function renderList() {
    listHost.innerHTML = '';
    if (!App.setups.length) { listHost.append(h('p', { class: 'empty' }, 'No setups yet.')); return; }
    const cur = selected();
    for (const s of App.setups) {
      const ways = s.ways.map((w) => { const d = driverFor(w.driverId); return (w.count > 1 ? w.count + '× ' : '') + (d ? d.model || d.label : 'missing driver') + ', ' + encText(w.enclosure); }).join(' + ');
      listHost.append(h('button', { class: 'drv-item', type: 'button', 'aria-current': cur && cur.id === s.id ? 'true' : 'false', onclick: () => { App.settings.setupSel = s.id; saveSettings(); renderList(); renderEditor(); } },
        h('span', { class: 'l1' }, h('span', { class: 'row', style: { gap: '8px', flexWrap: 'nowrap' } }, h('span', { class: 'sw', style: { background: setupColor(s) } }), s.name), s.active ? h('span', { class: 'badge user' }, 'compared') : null),
        h('span', { class: 'l2' }, ways)));
    }
  }
  function encText(e) {
    e = e || { type: 'ib' };
    if (e.type === 'ib') return 'infinite baffle';
    if (e.type === 'sealed') return fmt(e.Vb, 1) + ' L sealed';
    if (e.type === 'vented') return fmt(e.Vb, 1) + ' L vented, ' + fmt((e.port || {}).Fb, 1) + ' Hz';
    return fmt(e.Vb, 1) + ' L, passive radiator';
  }
  function addSetup() {
    const s = { id: uid('s'), name: 'New setup', colorIdx: freeColor(), active: activeSetups().length < 5, space: 'half', order: Date.now(), ways: [newWay(App.settings.driverSel || 'eac-ptt65x')] };
    App.setups.push(s); App.settings.setupSel = s.id; saveSettings(); persistSetup(s); renderList(); renderEditor(); refreshAll();
  }
  function changed(s, rerender) { persistSetup(s); renderList(); refreshAll(); if (rerender) renderEditor(); else schedulePreview(s); }
  function renderEditor() {
    edHost.innerHTML = ''; const s = selected();
    if (!s) { edHost.append(h('div', { class: 'card' }, h('p', { class: 'empty' }, 'Create a setup to start.'))); return; }
    const nameIn = h('input', { id: 'su-name', value: s.name }); nameIn.addEventListener('change', () => { s.name = nameIn.value.trim() || 'Setup'; changed(s); });
    const colors = h('div', { class: 'row', role: 'group', 'aria-label': 'Colour' }, PALETTE.map((c, i) => h('button', { type: 'button', class: 'btn sm', title: 'Colour ' + (i + 1), 'aria-pressed': s.colorIdx === i ? 'true' : 'false', style: { padding: '5px', borderColor: s.colorIdx === i ? c : null }, onclick: () => { s.colorIdx = i; changed(s, true); } }, h('span', { class: 'sw', style: { background: c, width: '14px', height: '14px' } }))));
    const basics = h('div', { class: 'card' },
      h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Setup'), h('h2', null, s.name)),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn sm', type: 'button', onclick: () => { const c = clone(s); c.id = uid('s'); c.name = s.name + ' (copy)'; c.colorIdx = freeColor(); c.active = false; c.order = Date.now(); App.setups.push(c); App.settings.setupSel = c.id; saveSettings(); persistSetup(c); renderList(); renderEditor(); refreshAll(); } }, 'Duplicate'),
          delButton(() => { App.setups = App.setups.filter((x) => x.id !== s.id); Store.local('setups', App.setups); Store.remove('setups', s.id); App.settings.setupSel = (App.setups[0] || {}).id || ''; saveSettings(); renderList(); renderEditor(); refreshAll(); }))),
      h('div', { class: 'fs-body' },
        h('div', { class: 'grid2' }, field('Name', nameIn), field('Radiation', selectInput('su-space', s.space || 'half', [['half', 'Half space (baffle, 2π)'], ['full', 'Full space (4π)']], (v) => { s.space = v; changed(s); }))),
        h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Colour'), colors, checkbox('su-active', s.active, 'Include in comparisons', (v) => { if (v && !s.active && activeSetups().length >= 5) { toast('Up to five setups can be compared at once'); renderEditor(); return; } s.active = v; changed(s); }))));
    edHost.append(basics);
    s.ways.forEach((w, i) => edHost.append(wayEditor(s, w, i)));
    if (s.ways.length < 4) edHost.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: () => { const w = newWay(s.ways[s.ways.length - 1].driverId); s.ways.push(w); changed(s, true); } }, 'Add a way')));
    // linear preview
    pv = { spl: h('div'), z: h('div'), x: h('div'), v: h('div'), info: h('div', { class: 'tiles' }) };
    edHost.append(h('div', { class: 'card' },
      h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Linear preview'), h('h3', null, 'Small-signal response for 2.83 V in'))),
      pv.info, h('div', { style: { height: '10px' } }), pv.spl, h('div', { style: { height: '14px' } }),
      h('div', { class: 'grid2' }, h('div', null, h('p', { class: 'small muted' }, 'Impedance, Ω'), pv.z), h('div', null, h('p', { class: 'small muted' }, 'Peak excursion, mm'), pv.x)),
      pv.v));
    App._pvSpl = new Plot(pv.spl, { height: 260, x: { type: 'log', min: 10, max: 20000, label: 'Hz' }, y: { mode: 'db', span: 60, label: 'dB SPL at 1 m' }, tipY: (v) => v.toFixed(1) + ' dB' });
    App._pvZ = new Plot(pv.z, { height: 190, x: { type: 'log', min: 10, max: 20000 }, y: { label: 'Ω', zero: true }, tipY: (v) => v.toFixed(2) + ' Ω' });
    App._pvX = new Plot(pv.x, { height: 190, x: { type: 'log', min: 10, max: 2000 }, y: { label: 'mm', zero: true }, tipY: (v) => v.toFixed(2) + ' mm' });
    updatePreview(s);
  }
  function schedulePreview(s) { clearTimeout(previewT); previewT = setTimeout(() => updatePreview(s), 120); }
  function updatePreview(s) {
    let es; try { es = engineSetup(s); } catch (e) { pv.info.innerHTML = ''; pv.info.append(h('div', { class: 'note warn' }, e.message)); return; }
    const freqs = KE.util.fracOctaveFreqs(10, 20000, 24);
    let lc; try { lc = KE.API.linearCurves(es, freqs); } catch (e) { pv.info.innerHTML = ''; pv.info.append(h('div', { class: 'note warn' }, e.message)); return; }
    const g = 2.83, gdb = db20(g);
    const spl = [{ id: 'sum', name: s.ways.length > 1 ? 'Sum' : s.name, color: setupColor(s), pts: freqs.map((f, i) => [f, lc.spl[i] + gdb]) }];
    if (s.ways.length > 1) lc.ways.forEach((w, k) => spl.push({ id: 'w' + k, name: 'Way ' + (k + 1), color: [GREY, '#9aa3b1', '#7d8594', '#6b7280'][k], width: 1.5, dash: [5, 4], pts: freqs.map((f, i) => [f, w.spl[i] + gdb]) }));
    App._pvSpl.setData(spl);
    App._pvZ.setData(lc.ways.map((w, k) => ({ id: 'z' + k, name: 'Way ' + (k + 1), color: k ? GREY : setupColor(s), pts: freqs.map((f, i) => [f, w.zmag[i]]) })).filter((q) => q.pts.some((p) => isFinite(p[1]))));
    App._pvX.setData(lc.ways.map((w, k) => ({ id: 'x' + k, name: 'Way ' + (k + 1), color: k ? GREY : setupColor(s), pts: freqs.filter((f) => f <= 2000).map((f, i) => [f, w.xmm[i] * g]) })));
    // info tiles
    pv.info.innerHTML = '';
    const tile = (k, v, sub) => h('div', { class: 'tile' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v), sub ? h('span', { class: 's' }, sub) : null);
    es.ways.forEach((w, k) => {
      const cw = KE.API.compileSetup({ ways: [w] }).ways[0]; const e = cw.enc; const der = cw.cd.der; const lbl = es.ways.length > 1 ? 'Way ' + (k + 1) + ': ' : '';
      if (e.type === 'sealed') { const r = Math.sqrt(1 + der.Vas / e.V0); pv.info.append(tile(lbl + 'Closed-box resonance', fmt(der.fs * r, 1) + ' Hz', 'Qtc ' + fmt(der.Qts * r, 2) + ' (fs ' + fmt(der.fs, 1) + ' Hz, Qts ' + fmt(der.Qts, 2) + ')')); }
      else if (e.type === 'vented') pv.info.append(tile(lbl + 'Port', fmt(e.Leff * 1000, 0) + ' mm effective', (e.nPorts > 1 ? e.nPorts + ' ports, ' : '') + 'area ' + fmt(e.Sp * 1e4, 1) + ' cm²' + (e.Lphys ? ', about ' + fmt(e.Lphys * 1000, 0) + ' mm physical' : '') + ', jet loss above ' + fmt(e.vc, 1) + ' m/s'));
      else if (e.type === 'pr') pv.info.append(tile(lbl + 'Radiator tuning', fmt(e.fp, 1) + ' Hz', 'in the box, ' + (e.nPR > 1 ? e.nPR + ' radiators' : 'one radiator')));
      else pv.info.append(tile(lbl + 'Driver', 'fs ' + fmt(der.fs, 1) + ' Hz', 'Qts ' + fmt(der.Qts, 2) + ', Vas ' + fmt(der.Vas * 1000, 1) + ' L'));
    });
    const i500 = freqs.findIndex((f) => f >= 500); pv.info.append(tile('Level at 500 Hz', fmt(lc.spl[i500] + gdb, 1) + ' dB', 'for 2.83 V, ' + (s.space === 'full' ? '4π' : '2π') + ', 1 m'));
  }
  function wayEditor(s, w, i) {
    const d = driverFor(w.driverId);
    const encHost = h('div', { class: 'fs-body' }); const fltHost = h('div', { class: 'fs-body' }); const fltSum = h('summary', null, 'Filters (' + (w.filters || []).length + ')');
    const upd = (rer) => changed(s, rer);
    const renderEnc = () => {
      encHost.innerHTML = ''; const e = w.enclosure || (w.enclosure = { type: 'ib' });
      encHost.append(field('Enclosure', selectInput('su-enc-' + i, e.type, [['ib', 'Infinite baffle'], ['sealed', 'Sealed box'], ['vented', 'Vented box'], ['pr', 'Passive radiator']], (v) => { e.type = v; if (v !== 'ib' && !e.Vb) e.Vb = 10; if (v === 'vented') e.port = Object.assign({ shape: 'round', d_mm: 60, n: 1, Fb: 35, Qp: 60, xi: 1 }, e.port || {}); if (v === 'pr') e.pr = Object.assign({ Sd: 200, Mmp: 60, Cmp: 0.8, Qmp: 8, n: 1, xlim: 12, thr: 0.5 }, e.pr || {}); if (v === 'vented' || v === 'pr') { if (e.Ql == null) e.Ql = 10; } renderEnc(); upd(); })));
      if (e.type === 'ib') { encHost.append(h('p', { class: 'hint' }, 'No box: the rear wave is ignored and the cone sees only its own suspension, as in an IEC baffle measurement.')); return; }
      const g = h('div', { class: 'grid3' });
      g.append(field('Net volume', numInput('su-vb-' + i, e.Vb, (v) => { e.Vb = clamp(v || 10, 0.1, 5000); upd(); }), 'L'));
      g.append(field('Leakage Ql', numInput('su-ql-' + i, e.Ql, (v) => { e.Ql = v && v > 0 ? v : null; upd(); }, { placeholder: 'none' })));
      if (e.type === 'vented') {
        const p = e.port || (e.port = {});
        g.append(field('Tuning Fb', numInput('su-fb-' + i, p.Fb, (v) => { p.Fb = clamp(v || 30, 5, 500); upd(); }), 'Hz'));
        encHost.append(g);
        const g2 = h('div', { class: 'grid3' });
        g2.append(field('Port shape', selectInput('su-ps-' + i, p.shape || 'round', [['round', 'Round'], ['slot', 'Slot']], (v) => { p.shape = v; if (v === 'slot') { p.h_mm = p.h_mm || 20; p.w_mm = p.w_mm || 150; } renderEnc(); upd(); })));
        if ((p.shape || 'round') === 'round') g2.append(field('Diameter', numInput('su-pd-' + i, p.d_mm, (v) => { p.d_mm = clamp(v || 50, 5, 1000); upd(); }), 'mm'));
        else { g2.append(field('Slot height', numInput('su-ph-' + i, p.h_mm, (v) => { p.h_mm = clamp(v || 10, 2, 500); upd(); }), 'mm')); g2.append(field('Slot width', numInput('su-pw-' + i, p.w_mm, (v) => { p.w_mm = clamp(v || 100, 5, 2000); upd(); }), 'mm')); }
        g2.append(field('Ports', numInput('su-pn-' + i, p.n || 1, (v) => { p.n = clamp(Math.round(v || 1), 1, 8); upd(); })));
        g2.append(field('Port loss Qp', numInput('su-pq-' + i, p.Qp || 60, (v) => { p.Qp = clamp(v || 60, 1, 1000); upd(); })));
        g2.append(field('Jet loss ξ', numInput('su-px-' + i, p.xi == null ? 1 : p.xi, (v) => { p.xi = clamp(v == null ? 1 : v, 0, 5); upd(); })));
        encHost.append(g2, h('p', { class: 'hint' }, 'Port nonlinearity follows Vanderkooy (AES 1998): a loss ½·ρ·ξ·v·|v| that switches on smoothly above a critical air speed, which scales inversely with port diameter (5 m/s at 75 mm). ξ = 1 is his jet model; 0 turns the port loss off. Qp sets the small-signal port loss.'));
      } else if (e.type === 'pr') {
        const p = e.pr || (e.pr = {});
        g.append(field('Radiators', numInput('su-rn-' + i, p.n || 1, (v) => { p.n = clamp(Math.round(v || 1), 1, 8); upd(); })));
        encHost.append(g);
        encHost.append(h('div', { class: 'grid3' },
          field('Area Sd', numInput('su-rs-' + i, p.Sd, (v) => { p.Sd = clamp(v || 200, 5, 20000); upd(); }), 'cm²'),
          field('Moving mass', numInput('su-rm-' + i, p.Mmp, (v) => { p.Mmp = clamp(v || 50, 1, 5000); upd(); }), 'g'),
          field('Compliance', numInput('su-rc-' + i, p.Cmp, (v) => { p.Cmp = clamp(v || 0.5, 0.001, 50); upd(); }), 'mm/N'),
          field('Qmp', numInput('su-rq-' + i, p.Qmp, (v) => { p.Qmp = clamp(v || 8, 0.5, 200); upd(); })),
          field('Compliance halves at', numInput('su-rx-' + i, p.xlim, (v) => { p.xlim = v && v > 0 ? v : 0; upd(); }, { placeholder: 'linear' }), 'mm')));
      } else encHost.append(g);
    };
    const renderFlt = () => {
      fltHost.innerHTML = ''; fltSum.textContent = 'Filters (' + (w.filters || []).length + ')';
      (w.filters || []).forEach((fl, j) => {
        const row = h('div', { class: 'flt' });
        row.append(field('Filter', selectInput('su-ft-' + i + '-' + j, fl.type, [['hp', 'High-pass'], ['lp', 'Low-pass'], ['lt', 'Linkwitz transform'], ['peq', 'Parametric EQ'], ['lowshelf', 'Low shelf'], ['highshelf', 'High shelf']], (v) => { fl.type = v; if (v === 'lt') Object.assign(fl, { f0: fl.f0 || 40, q0: fl.q0 || 0.9, fp: fl.fp || 20, qp: fl.qp || 0.6 }); if (v === 'peq' || v === 'lowshelf' || v === 'highshelf') Object.assign(fl, { q: fl.q || 0.7, gain: fl.gain || 0 }); renderFlt(); upd(); })));
        if (fl.type === 'hp' || fl.type === 'lp') {
          row.append(field('Type', selectInput('su-fa-' + i + '-' + j, (fl.align || 'lr') + fl.order, [['lr2', 'LR 12 dB/oct'], ['lr4', 'LR 24 dB/oct'], ['lr8', 'LR 48 dB/oct'], ['bw1', 'BW 6 dB/oct'], ['bw2', 'BW 12 dB/oct'], ['bw3', 'BW 18 dB/oct'], ['bw4', 'BW 24 dB/oct'], ['bw6', 'BW 36 dB/oct'], ['bw8', 'BW 48 dB/oct']], (v) => { fl.align = v.slice(0, 2); fl.order = +v.slice(2); upd(); })));
          row.append(field('Freq', numInput('su-ff-' + i + '-' + j, fl.f, (v) => { fl.f = clamp(v || 100, 5, 20000); upd(); }), 'Hz'));
          row.append(h('span'));
        } else if (fl.type === 'lt') {
          row.append(field('f0 / Q0', h('div', { class: 'row', style: { flexWrap: 'nowrap', gap: '4px' } }, numInput('su-l0-' + i + '-' + j, fl.f0, (v) => { fl.f0 = clamp(v || 40, 5, 500); upd(); }), numInput('su-lq-' + i + '-' + j, fl.q0, (v) => { fl.q0 = clamp(v || 0.7, 0.2, 5); upd(); }))));
          row.append(field('fp / Qp', h('div', { class: 'row', style: { flexWrap: 'nowrap', gap: '4px' } }, numInput('su-lp-' + i + '-' + j, fl.fp, (v) => { fl.fp = clamp(v || 20, 5, 500); upd(); }), numInput('su-lpq-' + i + '-' + j, fl.qp, (v) => { fl.qp = clamp(v || 0.6, 0.2, 5); upd(); }))));
          row.append(h('span'));
        } else {
          row.append(field('Freq', numInput('su-ff-' + i + '-' + j, fl.f, (v) => { fl.f = clamp(v || 100, 5, 20000); upd(); }), 'Hz'));
          row.append(field('Q', numInput('su-fq-' + i + '-' + j, fl.q, (v) => { fl.q = clamp(v || 0.7, 0.1, 30); upd(); })));
          row.append(field('Gain', numInput('su-fg-' + i + '-' + j, fl.gain, (v) => { fl.gain = clamp(v || 0, -30, 30); upd(); }), 'dB'));
        }
        row.append(h('button', { class: 'btn sm ghost danger', type: 'button', title: 'Remove this filter', 'aria-label': 'Remove this filter', onclick: () => { w.filters.splice(j, 1); renderFlt(); upd(); } }, '×'));
        fltHost.append(row);
      });
      fltHost.append(h('div', { class: 'btn-row' },
        h('button', { class: 'btn sm', type: 'button', onclick: () => { (w.filters || (w.filters = [])).push({ type: 'hp', align: 'lr', order: 4, f: 300 }); renderFlt(); upd(); } }, 'Add high-pass'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => { (w.filters || (w.filters = [])).push({ type: 'lp', align: 'lr', order: 4, f: 2000 }); renderFlt(); upd(); } }, 'Add low-pass'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { (w.filters || (w.filters = [])).push({ type: 'peq', f: 1000, q: 2, gain: -3 }); renderFlt(); upd(); } }, 'Add EQ')));
      fltHost.append(h('p', { class: 'hint' }, 'Filters act on the voltage in front of the driver, as in an active crossover. They shape excursion and therefore intermodulation.'));
    };
    renderEnc(); renderFlt();
    const est = d && d.badge === 'estimate';
    const hasK = d && d.nl && d.nl.kms && d.nl.kms.type === 'points';
    return h('div', { class: 'card' },
      h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker amber' }, 'Way ' + (i + 1)), h('h3', null, d ? d.label : 'Pick a driver')),
        s.ways.length > 1 ? h('button', { class: 'btn sm ghost danger', type: 'button', onclick: () => { s.ways.splice(i, 1); upd(true); } }, 'Remove way') : null),
      h('div', { class: 'fs-body' },
        h('div', { class: 'grid2' },
          field('Driver', selectInput('su-drv-' + i, w.driverId, driverOptions(), (v) => { w.driverId = v; upd(true); })),
          field('Number of drivers', numInput('su-cnt-' + i, w.count || 1, (v) => { w.count = clamp(Math.round(v || 1), 1, 16); upd(); }))),
        est ? h('div', { class: 'note' }, 'This driver\'s nonlinear curves are an estimate, not a measurement. See Drivers for the basis.') : null,
        h('details', { class: 'sec' }, h('summary', null, 'Drive and gain'),
          h('div', { class: 'fs-body' },
            h('div', { class: 'grid3' },
              field('Gain', numInput('su-g-' + i, w.gainDb || 0, (v) => { w.gainDb = clamp(v || 0, -40, 40); upd(); }), 'dB'),
              field('Delay', numInput('su-dl-' + i, w.delayMs || 0, (v) => { w.delayMs = clamp(v || 0, 0, 50); upd(); }), 'ms'),
              field('Series resistance', numInput('su-rs2-' + i, w.Rs || 0, (v) => { w.Rs = clamp(v || 0, 0, 100); upd(); }), 'Ω')),
            h('div', { class: 'grid2' },
              field('Drive', selectInput('su-dr-' + i, w.drive || 'voltage', [['voltage', 'Voltage source'], ['current', 'Current source (i = u / Re)']], (v) => { w.drive = v; upd(); })),
              field('Voice-coil heating', numInput('su-dt-' + i, w.dT || 0, (v) => { w.dT = clamp(v || 0, 0, 250); upd(); }), 'K')),
            checkbox('su-inv-' + i, w.invert, 'Invert polarity', (v) => { w.invert = v; upd(); }),
            hasK ? field('Suspension stiffness at rest', selectInput('su-ks-' + i, w.kmsSource || 'table', [['table', 'Small-signal table (Klippel LPM)'], ['curve', 'Large-signal curve Kms(0) (Klippel LSI)']], (v) => { w.kmsSource = v; upd(); })) : null,
            h('p', { class: 'hint' }, 'Series resistance models amplifier output impedance, cable or a passive part in series. Current drive removes the electrical nonlinearities of Le(x) and Bl(x)·v but also the electrical damping. Heating raises Re by 0.39 % per kelvin.'))),
        h('details', { class: 'sec', open: true }, h('summary', null, 'Enclosure'), encHost),
        h('details', { class: 'sec', open: (w.filters || []).length > 0 }, fltSum, fltHost)));
  }
  return { build, onShow() { build(); } };
})();
function delButton(onConfirm) {
  const wrap = h('span', { class: 'row', style: { gap: '6px' } });
  const b = h('button', { class: 'btn sm ghost danger', type: 'button' }, 'Delete');
  b.addEventListener('click', () => {
    wrap.innerHTML = '';
    wrap.append(h('span', { class: 'small muted' }, 'Delete for good?'), h('button', { class: 'btn sm danger', type: 'button', onclick: onConfirm }, 'Delete'), h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { wrap.innerHTML = ''; wrap.append(b); } }, 'Keep'));
  });
  wrap.append(b); return wrap;
}
async function exportBundle() {
  const data = JSON.stringify({ klirr: 1, exported: new Date().toISOString().slice(0, 10), drivers: App.userDrivers, setups: App.setups }, null, 1);
  const ok = await Store.download('klirr-drivers-and-setups.json', data);
  if (ok === null) { await copyText(data); showExportBox(data); }
}
function showExportBox(text) {
  const ta = h('textarea', { rows: '8', readonly: true }, text);
  const box = h('div', { class: 'card', style: { position: 'fixed', inset: 'auto 16px calc(env(safe-area-inset-bottom,0px) + 16px) 16px', zIndex: 60, maxWidth: '760px', margin: '0 auto' } },
    h('div', { class: 'card-h' }, h('h3', null, 'Your export'), h('button', { class: 'btn sm', type: 'button', onclick: () => box.remove() }, 'Close')), ta,
    h('p', { class: 'hint', style: { marginTop: '8px' } }, 'Downloads are not available here, so the JSON is shown instead. Select it and copy it.'));
  document.body.append(box); ta.focus(); ta.select();
}

// ================================================================== drivers
const TS_FIELDS = [['Re', 'Re', 'Ω'], ['Le', 'Le', 'mH'], ['L2', 'L2', 'mH'], ['R2', 'R2', 'Ω'], ['Bl', 'Bl', 'T·m'], ['Mms', 'Mms', 'g'], ['Cms', 'Cms', 'mm/N'], ['Rms', 'Rms', 'kg/s'], ['Sd', 'Sd', 'cm²'], ['Xmax', 'Xmax', 'mm'], ['Pe', 'Rated power', 'W']];
App.views.drivers = (() => {
  const root = $('#view-drivers');
  let listHost, detHost, search = '', pCurves = null, importMsg = '';
  function build() {
    root.innerHTML = ''; root.className = 'view';
    listHost = h('div', { class: 'drv-list' }); detHost = h('div', { class: 'stack' });
    const q = h('input', { id: 'dr-search', type: 'search', placeholder: 'Search drivers', value: search }); q.addEventListener('input', () => { search = q.value.toLowerCase(); renderList(); });
    root.append(h('div', { class: 'stack sticky-side' },
      h('div', { class: 'card' },
        h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Library'), h('h2', null, 'Drivers')), h('button', { class: 'btn sm primary', type: 'button', onclick: newDriver }, 'New driver')),
        h('div', { class: 'fs-body' }, q, listHost)),
      importCard()), detHost);
    renderList(); renderDetail();
  }
  function renderList() {
    listHost.innerHTML = '';
    const groups = [['Measured (Erin\'s Audio Corner)', LIB.filter((d) => d.badge === 'measured')], ['Estimates', LIB.filter((d) => d.badge === 'estimate')], ['Your drivers', App.userDrivers]];
    for (const [g, arr] of groups) {
      const items = arr.filter((d) => !search || (d.label + ' ' + (d.role || '')).toLowerCase().includes(search));
      if (!items.length) continue;
      listHost.append(h('div', { class: 'kicker', style: { margin: '8px 0 2px' } }, g));
      for (const d of items) {
        let sub = ''; try { const der = KE.API.derived(KE.API.tsOf(d)); sub = 'fs ' + fmt(der.fs, 1) + ' Hz · Qts ' + fmt(der.Qts, 2) + ' · Sd ' + fmt(d.ts.Sd, 0) + ' cm²'; } catch (e) { sub = 'incomplete parameters'; }
        listHost.append(h('button', { class: 'drv-item', type: 'button', 'aria-current': App.settings.driverSel === d.id ? 'true' : 'false', onclick: () => { App.settings.driverSel = d.id; saveSettings(); renderList(); renderDetail(); } },
          h('span', { class: 'l1' }, h('span', null, d.label), h('span', { class: 'badge ' + (d.builtin ? d.badge : 'user') }, d.builtin ? d.badge : 'yours')), h('span', { class: 'l2' }, sub)));
      }
    }
  }
  function cur() { return driverFor(App.settings.driverSel) || LIB[0]; }
  function newDriver() {
    const d = { id: uid('drv'), brand: '', model: 'New driver', label: 'New driver', role: 'woofer', ts: { Re: 6, Le: 0.4, L2: 0, R2: 0, Bl: 7, Mms: 15, Cms: 1, Rms: 1, Sd: 130, Xmax: 5 }, nl: {}, sources: [], notes: 'Enter the parameters from your datasheet or Klippel report.' };
    App.userDrivers.push(d); App.settings.driverSel = d.id; saveSettings(); persistDriver(d); renderList(); renderDetail();
  }
  function useInSetup(d) {
    const s = { id: uid('s'), name: d.label + ' in ' + (d.ts.Sd > 300 ? 60 : 10) + ' L sealed', colorIdx: freeColor(), active: activeSetups().length < 5, space: 'half', order: Date.now(), ways: [Object.assign(newWay(d.id), { enclosure: { type: 'sealed', Vb: d.ts.Sd > 300 ? 60 : 10 } })] };
    App.setups.push(s); App.settings.setupSel = s.id; saveSettings(); persistSetup(s); refreshAll(); showTab('setups');
  }
  function driverChanged(d, rerenderDetail) { App._sumCache && App._sumCache.clear(); persistDriver(d); renderList(); refreshAll(); if (rerenderDetail !== false) renderDetail(); }
  function renderDetail() {
    detHost.innerHTML = ''; const d = cur(); if (!d) return;
    const editable = !d.builtin;
    const sm = driverSummaryCached(d);
    // header
    detHost.append(h('div', { class: 'card' },
      h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, d.role || 'driver'), h('h2', null, d.label)),
        h('div', { class: 'btn-row' },
          h('span', { class: 'badge ' + (d.builtin ? d.badge : 'user') }, d.builtin ? d.badge : 'yours'),
          h('button', { class: 'btn sm primary', type: 'button', onclick: () => useInSetup(d) }, 'New setup with this driver'),
          h('button', { class: 'btn sm', type: 'button', onclick: () => { const c = clone(d); delete c.builtin; c.id = uid('drv'); c.label = d.label + ' (copy)'; c.model = (d.model || '') + ' (copy)'; c.badge = undefined; c.derivedFrom = d.id; App.userDrivers.push(c); App.settings.driverSel = c.id; saveSettings(); persistDriver(c); renderList(); renderDetail(); } }, editable ? 'Duplicate' : 'Make an editable copy'),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => { const t = JSON.stringify(Object.assign({}, d, { builtin: undefined }), null, 1); const ok = await Store.download((d.model || 'driver').replace(/[^\w.-]+/g, '_') + '.klirr.json', t); if (ok === null) { await copyText(t); showExportBox(t); } } }, 'Export'),
          editable ? delButton(() => { App.userDrivers = App.userDrivers.filter((x) => x.id !== d.id); Store.local('drivers', App.userDrivers); Store.remove('drivers', d.id); App.settings.driverSel = LIB[0].id; saveSettings(); renderList(); renderDetail(); refreshAll(); }) : null)),
      d.notes ? h('p', { class: 'small', style: { color: d.badge === 'estimate' ? '#d9a441' : null } }, d.notes) : null,
      sm.error ? h('div', { class: 'note warn', style: { marginTop: '10px' } }, sm.error) : null));
    // parameters
    const tsGrid = h('div', { class: 'grid3' });
    for (const [k, name, unit] of TS_FIELDS) {
      const inp = numInput('dr-ts-' + k, d.ts[k], (v) => { if (v == null) delete d.ts[k]; else d.ts[k] = v; if (k === 'Cms') delete d.ts.Kms; driverChanged(d); }, editable ? null : { readonly: true });
      tsGrid.append(field(name, inp, unit));
    }
    const der = sm.der;
    const derived = der ? h('dl', { class: 'kv', style: { marginTop: '10px' } },
      h('dt', null, 'fs'), h('dd', null, fmt(der.fs, 2) + ' Hz'), h('dt', null, 'Qms / Qes / Qts'), h('dd', null, fmt(der.Qms, 2) + ' / ' + fmt(der.Qes, 3) + ' / ' + fmt(der.Qts, 3)),
      h('dt', null, 'Vas'), h('dd', null, fmt(der.Vas * 1000, 1) + ' L'), h('dt', null, 'Sensitivity, 2π, 1 m'), h('dd', null, fmt(der.spl283, 1) + ' dB at 2.83 V · ' + fmt(der.spl1w, 1) + ' dB at 1 W into Re'),
      h('dt', null, 'Reference efficiency'), h('dd', null, fmt(der.eta0 * 100, 3) + ' %')) : null;
    const pasteBox = editable ? h('details', { class: 'sec' }, h('summary', null, 'Fill from pasted datasheet text'), tsPaste(d)) : null;
    detHost.append(h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Small signal'), h('h3', null, 'Parameters')), editable ? null : h('span', { class: 'small muted' }, 'Read-only. Make an editable copy to change them.')), tsGrid, derived, pasteBox));
    // curves
    const cHost = h('div');
    const limHost = h('div', { class: 'tbl-wrap' });
    detHost.append(h('div', { class: 'card' },
      h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Large signal'), h('h3', null, 'Nonlinear parameters relative to x = 0'))),
      cHost, h('p', { class: 'hint' }, 'Lines: the fitted curves the simulation uses. Dots: the data points. Shaded ends: outside the measured range, where the curves are continued with their end slopes.'),
      limHost));
    pCurves = new Plot(cHost, { height: 300, x: { type: 'lin', label: 'x, mm (coil out →)' }, y: { label: '% of value at rest' }, tipX: (x) => fmt(x, 2) + ' mm', tipY: (v) => v.toFixed(1) + ' %' });
    const ser = []; const col = { bl: '#56b6c2', kms: '#d9a441', le: '#e06c75' }; const nm = { bl: 'Bl(x)', kms: 'Kms(x)', le: 'Le(x)' };
    let bands = [];
    if (!sm.error) {
      for (const k of ['bl', 'kms', 'le']) {
        const c = sm.curves[k]; if (!c) continue;
        ser.push({ id: k, name: nm[k] + (c.fitOrder ? ' (fit order ' + c.fitOrder + ')' : ''), color: col[k], pts: c.x.map((x, i) => [x, c.r[i] * 100]) });
        if (c.px) { const step = Math.max(1, Math.floor(c.px.length / 60)); ser.push({ id: k + 'p', name: nm[k] + ' data', color: col[k], kind: 'dots', r: 2.2, legend: false, pts: c.px.filter((_, i) => i % step === 0).map((x, i) => [x, c.py[i * step] * 100]) }); }
      }
      const R = sm.dataRange; const xs = ser.length ? ser[0].pts.map((p) => p[0]) : [-10, 10];
      if (isFinite(R[0])) bands = [{ x0: Math.min(...xs), x1: R[0], color: 'rgba(154,163,177,.07)' }, { x0: R[1], x1: Math.max(...xs), color: 'rgba(154,163,177,.07)' }];
    }
    pCurves.o.bands = bands;
    const vl = [];
    if (sm.lim) { if (sm.lim.xbl82 && !sm.lim.xbl82.beyond) vl.push({ x: sm.lim.xbl82.x, color: '#56b6c2', dash: [3, 3], label: 'X_Bl' }, { x: -sm.lim.xbl82.x, color: '#56b6c2', dash: [3, 3] }); if (sm.lim.xc75 && !sm.lim.xc75.beyond) vl.push({ x: sm.lim.xc75.x, color: '#d9a441', dash: [3, 3], label: 'X_C' }, { x: -sm.lim.xc75.x, color: '#d9a441', dash: [3, 3] }); }
    pCurves.setData(ser, { vlines: vl });
    if (!ser.length) cHost.append(h('p', { class: 'hint' }, 'No large-signal curves: this driver is simulated with constant Bl, Kms and Le. Doppler, box air and port nonlinearities still apply.'));
    // limits table
    if (sm.lim) {
      const L = sm.lim; const cell = (o) => (o ? (o.beyond ? '> ' : '') + fmt(o.x, 1) + ' mm' : '–');
      limHost.append(h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Displacement limit (Klippel, IEC 62458)'), h('th', { class: 'n' }, '10 % set'), h('th', { class: 'n' }, '20 % set'))),
        h('tbody', null,
          h('tr', null, h('td', null, 'X_Bl: Bl falls to 82 % / 70 %'), h('td', { class: 'n' }, cell(L.xbl82)), h('td', { class: 'n' }, cell(L.xbl70))),
          h('tr', null, h('td', null, 'X_C: compliance falls to 75 % / 50 %'), h('td', { class: 'n' }, cell(L.xc75)), h('td', { class: 'n' }, cell(L.xc50))),
          h('tr', null, h('td', null, 'X_L: impedance at 8.5·fs changes 10 % / 17 %'), h('td', { class: 'n' }, cell(L.xl10)), h('td', { class: 'n' }, cell(L.xl17))),
          h('tr', null, h('td', null, 'X_D: Doppler d2 = 10 % at f2 = 8.5·fs (' + L.xd10.basis + ', ' + fmt(L.xd10.fs, 1) + ' Hz)'), h('td', { class: 'n' }, cell(L.xd10)), h('td', { class: 'n' }, '–')))));
      limHost.append(h('p', { class: 'hint', style: { marginTop: '6px' } }, '"> value" means the threshold is not reached inside the measured range. The 82/75/10 % set gives about 10 % distortion in a two-tone test; the 70/50/17 % set about 20 %, the usual subwoofer criterion.'));
    }
    if (editable) detHost.append(curveEditor(d));
    // provenance
    const prov = h('div', { class: 'fs-body' });
    for (const s of (d.sources || [])) prov.append(h('div', null, h('div', null, h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.title || s.publisher), ' · ', h('span', { class: 'muted small' }, s.publisher + (s.retrieved ? ', retrieved ' + s.retrieved : ''))), s.what ? h('p', { class: 'small muted' }, s.what) : null));
    if (d.extraction && d.extraction.curves) {
      const ex = d.extraction; const rows = Object.entries(ex.curves).map(([k, c]) => h('tr', null, h('td', null, nm[k]), h('td', null, h('a', { href: c.image, target: '_blank', rel: 'noopener' }, 'plot')), h('td', { class: 'n' }, c.x_axis.refs.length + ' / ' + c.y_axis.refs.length), h('td', { class: 'n' }, fmt(c.x_axis.max_resid_px, 2) + ' / ' + fmt(c.y_axis.max_resid_px, 2) + ' px'), h('td', { class: 'n' }, fmt(c.range_mm[0], 1) + ' to ' + fmt(c.range_mm[1], 1) + ' mm')));
      prov.append(h('p', { class: 'small' }, 'Extraction: ' + ex.tool + '.'), h('div', { class: 'tbl-wrap' }, h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Curve'), h('th', null, 'Source'), h('th', { class: 'n' }, 'Check ticks x / y'), h('th', { class: 'n' }, 'Max residual x / y'), h('th', { class: 'n' }, 'Range'))), h('tbody', null, rows))));
    }
    if (d.measurements && d.measurements.length) prov.append(h('p', { class: 'small' }, 'Measured data for overlays: ', d.measurements.map((m, i) => [i ? ', ' : '', m.image ? h('a', { href: m.image, target: '_blank', rel: 'noopener' }, m.label) : m.label])));
    if (!(d.sources || []).length && !(d.measurements || []).length) prov.append(h('p', { class: 'hint' }, 'No sources recorded. Add a note with where the numbers came from.'));
    detHost.append(h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Provenance'), h('h3', null, 'Where the numbers come from'))), prov));
  }
  function tsPaste(d) {
    const ta = h('textarea', { rows: '5', placeholder: 'Paste a datasheet table, e.g.\nRe 5.6 Ω\nLe 0.35 mH\nBl 7.1 Tm\nMms 17.9 g\nCms 0.98 mm/N\nRms 1.2 kg/s\nSd 132 cm²\nXmax 6 mm' });
    const out = h('p', { class: 'hint' });
    const btn = h('button', { class: 'btn sm', type: 'button', onclick: () => {
      const got = parseTS(ta.value); const keys = Object.keys(got);
      if (!keys.length) { out.textContent = 'No parameters recognised. Use lines like "Re 5.6" or "Bl = 7.1 Tm".'; return; }
      Object.assign(d.ts, got); if (got.Cms != null) delete d.ts.Kms;
      completeTS(d.ts);
      driverChanged(d); toast('Filled ' + keys.join(', '));
    } }, 'Fill parameters');
    return h('div', { class: 'fs-body' }, ta, h('div', { class: 'btn-row' }, btn), out, h('p', { class: 'hint' }, 'Recognised: Re, Le, L2, R2, Bl, Mms, Cms, Kms, Rms, Sd, Xmax, Pe, and fs, Qms, Qes, Qts, Vas (used to fill Mms, Cms and Rms when they are missing).'));
  }
  function curveEditor(d) {
    d.nl = d.nl || {};
    const host = h('div', { class: 'fs-body' });
    const names = { bl: ['Bl(x)', 'T·m'], kms: ['Kms(x)', 'N/mm'], le: ['Le(x)', 'mH'] };
    for (const k of ['bl', 'kms', 'le']) {
      const spec = d.nl[k] || { type: 'none' };
      const box = h('div', { class: 'way' });
      const body = h('div', { class: 'fs-body' });
      const setType = (t) => {
        if (t === 'none') delete d.nl[k];
        else if (t === 'points') d.nl[k] = { type: 'points', x: spec.x || [], y: spec.y || [], fit: spec.fit || 8, quantity: k === 'kms' ? spec.quantity : undefined };
        else if (t === 'poly') d.nl[k] = { type: 'poly', coef: spec.coef || [k === 'bl' ? d.ts.Bl : k === 'kms' ? 1 / (d.ts.Cms || 1) : d.ts.Le || 0.3], range: spec.range || (d.ts.Xmax ? 1.5 * d.ts.Xmax : 10), quantity: k === 'kms' ? spec.quantity : undefined };
        else d.nl[k] = k === 'le' ? { type: 'param', xref: d.ts.Xmax || 5, inPct: 15, outPct: -10 } : { type: 'param', xlim: d.ts.Xmax ? d.ts.Xmax * 1.1 : 5, thr: k === 'bl' ? 0.82 : 0.75, shape: 2, offset: 0 };
        driverChanged(d);
      };
      box.append(h('div', { class: 'way-h' }, h('h3', null, names[k][0]), selectInput('dr-ct-' + k, spec.type, [['none', 'Constant (linear)'], ['points', 'Points x, value'], ['poly', 'Polynomial coefficients'], ['param', 'Shape from limits']], setType)), body);
      if (spec.type === 'points') {
        const ta = h('textarea', { rows: '6', placeholder: 'x in mm, value in ' + names[k][1] + ' per line\n-6, 4.2\n-3, 4.9\n0, 5.05\n3, 4.8\n6, 3.7' }, spec.x.map((x, i) => x + ', ' + spec.y[i]).join('\n'));
        ta.addEventListener('change', () => { const pts = ta.value.split(/\n+/).map((l) => l.trim().split(/[\s,;\t]+/).map(Number)).filter((p) => p.length >= 2 && isFinite(p[0]) && isFinite(p[1])); spec.x = pts.map((p) => p[0]); spec.y = pts.map((p) => p[1]); d.nl[k] = spec; driverChanged(d); });
        body.append(ta, h('div', { class: 'grid2' }, field('Fit order', numInput('dr-fo-' + k, spec.fit || 8, (v) => { spec.fit = clamp(Math.round(v || 8), 1, 14); d.nl[k] = spec; driverChanged(d); })), k === 'kms' ? field('Values are', selectInput('dr-q-' + k, spec.quantity || 'kms', [['kms', 'Stiffness Kms, N/mm'], ['cms', 'Compliance Cms, mm/N']], (v) => { spec.quantity = v === 'cms' ? 'cms' : undefined; d.nl[k] = spec; driverChanged(d); })) : h('span')));
      } else if (spec.type === 'poly') {
        const ta = h('textarea', { rows: '2', placeholder: 'coefficients c0 c1 c2 … per mm^n' }, (spec.coef || []).join(' '));
        ta.addEventListener('change', () => { spec.coef = ta.value.split(/[\s,;]+/).map(Number).filter(isFinite); d.nl[k] = spec; driverChanged(d); });
        body.append(ta, h('div', { class: 'grid2' }, field('Valid range ±', numInput('dr-pr-' + k, spec.range, (v) => { spec.range = clamp(v || 10, 0.5, 100); d.nl[k] = spec; driverChanged(d); }), 'mm'), k === 'kms' ? field('Coefficients are', selectInput('dr-pq-' + k, spec.quantity || 'kms', [['kms', 'Stiffness k0 … (N/mm)'], ['cms', 'Compliance c0 … (mm/N)']], (v) => { spec.quantity = v === 'cms' ? 'cms' : undefined; d.nl[k] = spec; driverChanged(d); })) : h('span')));
      } else if (spec.type === 'param') {
        if (k === 'le') body.append(h('div', { class: 'grid3' }, field('Reference ±x', numInput('dr-lx', spec.xref, (v) => { spec.xref = clamp(v || 5, 0.1, 100); driverChanged(d); }), 'mm'), field('Change at −x (coil in)', numInput('dr-li', spec.inPct, (v) => { spec.inPct = clamp(v || 0, -90, 500); driverChanged(d); }), '%'), field('Change at +x (coil out)', numInput('dr-lo', spec.outPct, (v) => { spec.outPct = clamp(v || 0, -90, 500); driverChanged(d); }), '%')));
        else body.append(h('div', { class: 'grid2' },
          field(k === 'bl' ? 'X where Bl reaches the threshold' : 'X where compliance reaches the threshold', numInput('dr-px-' + k, spec.xlim, (v) => { spec.xlim = clamp(v || 5, 0.1, 100); driverChanged(d); }), 'mm'),
          field('Threshold', selectInput('dr-pt-' + k, spec.thr, k === 'bl' ? [[0.82, '82 %'], [0.7, '70 %']] : [[0.75, '75 %'], [0.5, '50 %']], (v) => { spec.thr = +v; driverChanged(d); })),
          field('Shape', selectInput('dr-ps-' + k, spec.shape, [[2, 'Rounded (x²)'], [4, 'Flatter top (x⁴)'], [6, 'Flat top (x⁶)']], (v) => { spec.shape = +v; driverChanged(d); })),
          field('Offset of the centre', numInput('dr-po-' + k, spec.offset || 0, (v) => { spec.offset = clamp(v || 0, -50, 50); driverChanged(d); }), 'mm')));
        body.append(h('p', { class: 'hint' }, 'A shape built from a single limit is an estimate. Prefer measured Klippel curves.'));
      } else body.append(h('p', { class: 'hint' }, 'Treated as constant.'));
      host.append(box);
    }
    const kl = h('textarea', { rows: '4', placeholder: 'Paste Klippel LSI coefficients, e.g.\nb0 7.23 b1 -0.051 b2 -0.012 …\nk0 1.41 k1 0.012 k2 0.004 … (or c0 c1 … for compliance)\nl0 0.35 l1 -0.004 …' });
    const klRange = numInput('dr-klr', d.ts.Xmax ? 1.5 * d.ts.Xmax : 10, () => {});
    const klBtn = h('button', { class: 'btn sm', type: 'button', onclick: () => {
      const got = parseKlippel(kl.value); const R = num(klRange.value, 10); const done = [];
      if (got.b) { d.nl.bl = { type: 'poly', coef: got.b, range: R }; done.push('Bl'); }
      if (got.k) { d.nl.kms = { type: 'poly', coef: got.k, range: R }; done.push('Kms'); }
      else if (got.c) { d.nl.kms = { type: 'poly', coef: got.c, range: R, quantity: 'cms' }; done.push('Cms'); }
      if (got.l) { d.nl.le = { type: 'poly', coef: got.l, range: R }; done.push('Le'); }
      if (!done.length) { toast('No coefficients recognised'); return; }
      driverChanged(d); toast('Set ' + done.join(', ') + ' from coefficients');
    } }, 'Use coefficients');
    host.append(h('details', { class: 'sec' }, h('summary', null, 'Paste Klippel polynomial coefficients'), h('div', { class: 'fs-body' }, kl, h('div', { class: 'grid2' }, field('Measured range ±', klRange, 'mm'), h('span')), h('div', { class: 'btn-row' }, klBtn), h('p', { class: 'hint' }, 'Units per mm^n as in LSI reports: b in N/A, k in N/mm, c in mm/N, l in mH. Polynomials are only valid inside the measured range; outside it Klirr continues each curve with its end slope.'))));
    return h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Edit'), h('h3', null, 'Large-signal curves'))), host);
  }
  function importCard() {
    const ta = h('textarea', { id: 'imp-text', rows: '5', placeholder: 'Paste Klirr JSON or your driver database (drivers.json)' });
    const file = h('input', { id: 'imp-file', type: 'file', accept: '.json,application/json' });
    const out = h('p', { class: 'hint', id: 'imp-msg' }, importMsg); // kept across rebuilds, which a sync from the account store can trigger
    file.addEventListener('change', async () => { const f = file.files && file.files[0]; if (!f) return; ta.value = await f.text(); });
    const btn = h('button', { class: 'btn sm primary', type: 'button', onclick: () => { try { importMsg = importText(ta.value); out.textContent = importMsg; ta.value = ''; renderList(); renderDetail(); refreshAll(); } catch (e) { importMsg = e.message; out.textContent = e.message; } } }, 'Import');
    return h('div', { class: 'card' }, h('details', { class: 'sec', open: !!importMsg, style: { borderTop: 0, paddingTop: 0 } }, h('summary', null, 'Import drivers or setups'),
      h('div', { class: 'fs-body' }, ta, file, h('div', { class: 'btn-row' }, btn, h('button', { class: 'btn sm ghost', type: 'button', onclick: exportBundle }, 'Export yours')), out,
        h('p', { class: 'hint' }, 'Accepted: a Klirr export, single Klirr driver files, and the driver database format with a drivers list (small-signal "ts" and "hd-frequency" measurements). Imported measurements appear as overlays in Distortion.'))));
  }
  return { build, onShow() { build(); } };
})();

// ------------------------------------------------------------------ parsing helpers
function parseTS(text) {
  const out = {}; const t = text.replace(/,(?=\d)/g, '.');
  const grab = (re) => { const m = t.match(re); return m ? parseFloat(m[1]) : null; };
  const pat = (names) => new RegExp('(?:^|[\\s(|;:])(?:' + names + ')\\s*(?:\\([^)]*\\))?\\s*[:=]?\\s*(-?\\d+(?:\\.\\d+)?(?:e-?\\d+)?)', 'im');
  const map = { Re: 'Re|R_e|Rdc|DC resistance', Le: 'Le|L_e|Voice coil inductance', L2: 'L2', R2: 'R2', Bl: 'Bl|BL|Force factor', Mms: 'Mms|M_ms|Moving mass', Cms: 'Cms|C_ms|Compliance', Kms: 'Kms|K_ms|Stiffness', Rms: 'Rms|R_ms|Mechanical (?:loss|resistance)', Sd: 'Sd|S_d|Effective (?:piston )?area', Xmax: 'Xmax|X_max|Linear excursion', Pe: 'Pe|Rated power|Power handling', fs: 'fs|Fs|f_s|Resonance(?: frequency)?', Qms: 'Qms|Q_ms', Qes: 'Qes|Q_es', Qts: 'Qts|Q_ts', Vas: 'Vas|V_as|Equivalent volume' };
  for (const [k, names] of Object.entries(map)) { const v = grab(pat(names)); if (v != null && isFinite(v)) out[k] = v; }
  return out;
}
function completeTS(ts) {
  const kappa = KE.AIR.kappa;
  if (ts.Kms && !ts.Cms) ts.Cms = 1 / ts.Kms;
  const Sd = ts.Sd ? ts.Sd * 1e-4 : null;
  if (!ts.Cms && ts.Vas && Sd) ts.Cms = ts.Vas * 1e-3 / (kappa * Sd * Sd) * 1e3;
  if (!ts.Mms && ts.fs && ts.Cms) ts.Mms = 1 / (Math.pow(2 * Math.PI * ts.fs, 2) * ts.Cms * 1e-3) * 1e3;
  if (!ts.Rms && ts.fs && ts.Mms) {
    let Qms = ts.Qms;
    if (!Qms && ts.Qts && ts.Qes && ts.Qes > ts.Qts) Qms = 1 / (1 / ts.Qts - 1 / ts.Qes);
    if (!Qms && ts.Qts && ts.Bl && ts.Re) { const Qes = 2 * Math.PI * ts.fs * ts.Mms * 1e-3 * ts.Re / (ts.Bl * ts.Bl); if (Qes > ts.Qts) Qms = 1 / (1 / ts.Qts - 1 / Qes); }
    if (Qms) ts.Rms = 2 * Math.PI * ts.fs * ts.Mms * 1e-3 / Qms;
  }
  if (!ts.Bl && ts.Qes && ts.fs && ts.Mms && ts.Re) ts.Bl = Math.sqrt(2 * Math.PI * ts.fs * ts.Mms * 1e-3 * ts.Re / ts.Qes);
  for (const k of ['Cms', 'Mms', 'Rms', 'Bl']) if (ts[k] != null) ts[k] = +(+ts[k]).toPrecision(5);
  delete ts.fs; delete ts.Qms; delete ts.Qes; delete ts.Qts; delete ts.Vas; delete ts.Kms;
  return ts;
}
function parseKlippel(text) {
  const out = {}; const re = /\b([bkcl])\s*_?\s*(\d)\b\s*(?:\([^)]*\))?\s*[=:]?\s*(-?\d+(?:[.,]\d+)?(?:[eE][-+]?\d+)?)/g; let m;
  while ((m = re.exec(text))) { const k = m[1].toLowerCase(), n = +m[2], v = parseFloat(m[3].replace(',', '.')); (out[k] = out[k] || [])[n] = v; }
  for (const k in out) out[k] = Array.from(out[k], (v) => (v == null ? 0 : v));
  return out;
}
function importText(text) {
  if (!text.trim()) throw new Error('Paste some JSON first.');
  let data; try { data = JSON.parse(text); } catch (e) { throw new Error('This is not valid JSON: ' + e.message); }
  let nD = 0, nS = 0, skipped = 0, incomplete = 0; const remap = {};
  // document ids in the account store allow letters, digits and _ - . ~ : @ + only
  const safeId = (v) => { const t = String(v || '').replace(/[^A-Za-z0-9_\-.~:@+]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120); return t && t !== '.' && t !== '..' ? t : null; };
  const addDriver = (d) => { const old = d.id; const sid = safeId(d.id); d.id = sid && !LIB.some((x) => x.id === sid) ? sid : uid('drv'); if (old && old !== d.id) remap[old] = d.id; delete d.builtin; if (!(d.ts && d.ts.Mms && (d.ts.Cms || d.ts.Kms) && d.ts.Rms != null)) incomplete++; const i = App.userDrivers.findIndex((x) => x.id === d.id); if (i >= 0) App.userDrivers[i] = d; else App.userDrivers.push(d); persistDriver(d); nD++; };
  const isKlirrDriver = (o) => o && typeof o === 'object' && o.ts && (o.label || o.model) && (o.nl || o.sources || o.ts.Mms || o.ts.Cms);
  if (data && data.klirr) {
    for (const d of (data.drivers || [])) addDriver(d);
    for (const s of (data.setups || [])) { if (!s.id || !Array.isArray(s.ways)) { skipped++; continue; } s.id = safeId(s.id) || uid('su'); if (s.order == null) s.order = Date.now() + nS; for (const w of s.ways) if (w && remap[w.driverId]) w.driverId = remap[w.driverId]; const i = App.setups.findIndex((x) => x.id === s.id); if (i >= 0) App.setups[i] = s; else App.setups.push(s); persistSetup(s); nS++; }
  } else if (Array.isArray(data) && data.every(isKlirrDriver)) data.forEach(addDriver);
  else if (isKlirrDriver(data)) addDriver(data);
  else if (data && Array.isArray(data.drivers)) {
    for (const x of data.drivers) {
      const ts = completeTS(Object.assign({}, x.ts || {}));
      const hdMs = (x.measurements || []).filter((m) => m.kind === 'hd-frequency' && Array.isArray(m.series));
      const meas = hdMs.map((m) => {
        const spl = m.conditions && +m.conditions.spl_db; const unit = ((m.axes && m.axes.y && (m.axes.y.unit + ' ' + (m.axes.y.label || ''))) || '').toLowerCase();
        const rel = /re |rel|ratio|dbc/.test(unit);
        const ser = {}; for (const s of m.series) { const nm = (s.name || '').toUpperCase().match(/H[2-5]/); if (!nm) continue; ser[nm[0]] = s.points.map((p) => [p.x, rel || !isFinite(spl) ? p.y : p.y - spl]); }
        return { kind: 'hd', level_db: spl, label: 'Driver database HD' + (isFinite(spl) ? ', ' + spl + ' dB' : ''), conditions: (m.method || '') + (m.source ? '; ' + m.source : '') + (m.confidence ? '; confidence ' + m.confidence : ''), source: 's1', series: ser };
      }).filter((m) => Object.keys(m.series).length);
      const d = { id: 'db-' + (x.id || uid('d')), brand: x.manufacturer || '', model: x.name || x.id, label: (x.name || x.id), role: x.role || 'driver', ts, nl: {}, sources: [{ sid: 's1', publisher: 'Your driver database', title: x.source || 'drivers.json', url: 'https://enspo-sta.github.io/elementval-drivers/', what: 'Imported small-signal parameters and harmonic distortion measurements.' }], notes: (x.findings || '').slice(0, 600), measurements: meas };
      addDriver(d);
    }
  } else throw new Error('Unrecognised format. Expected a Klirr export, a Klirr driver, or a database with a "drivers" list.');
  Store.local('drivers', App.userDrivers); Store.local('setups', App.setups);
  return 'Imported ' + nD + ' driver(s)' + (nS ? ' and ' + nS + ' setup(s)' : '') + (skipped ? ', skipped ' + skipped : '') + '.' + (incomplete ? ' ' + incomplete + ' of the drivers lack moving mass, compliance or mechanical resistance; fill those in before simulating them.' : '');
}
