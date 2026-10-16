/* Klirr app state, setups and shared UI pieces. */
const LIB = JSON.parse($('#library-data').textContent).map((d) => Object.assign(d, { builtin: true }));
const TABS = [
  ['distortion', 'Distortion'], ['imd', 'Intermodulation'], ['multitone', 'Multitone'], ['maxspl', 'Max SPL'],
  ['listen', 'Listen'], ['setups', 'Setups'], ['drivers', 'Drivers'], ['guide', 'Guide'],
];
const DEF_SETTINGS = {
  hd: { f0: 20, f1: 2000, ppo: 6, mode: 'splref', level: 94, fref: 500, volts: 2.83, show: { H2: true, H3: true, H4: false, H5: false, THD: false }, unit: 'db', mech: true, overlay: '' },
  imd: { preset: 'p250', f1: 250, f2: 2125, ratioDb: 0, ref: 'f2', level: 94, sweep: 'level', l0: 80, l1: 104, lstep: 2, s0: 20, s1: 200, sppo: 6, mech: true, unit: 'db' },
  mt: { f0: 20, f1: 2000, ppo: 6, level: 90, mech: false },
  max: { f0: 20, f1: 1000, ppo: 6, thd: 10, hd3: 0, comp: 3, xmode: 'klippel', xmm: 10, vport: 17, power: true, vmax: 40 },
  listen: { src: 'synth', synth: 'bassvoice', start: 0, dur: 12, stereo: true, level: 85, setup: '' },
  setupSel: '', driverSel: 'eac-ptt8',
};
const DEF_SETUPS = [
  { id: 'd-ptt8', name: 'PTT8.0X04 in 15 L sealed', colorIdx: 0, active: true, space: 'half', ways: [{ driverId: 'eac-ptt8', count: 1, enclosure: { type: 'sealed', Vb: 15 }, filters: [] }] },
  { id: 'd-ptt65x', name: 'PTT6.5X04 in 8 L sealed', colorIdx: 1, active: true, space: 'half', ways: [{ driverId: 'eac-ptt65x', count: 1, enclosure: { type: 'sealed', Vb: 8 }, filters: [] }] },
  { id: 'd-sb17cac', name: 'SB17CAC35-4 in 8 L sealed', colorIdx: 2, active: true, space: 'half', ways: [{ driverId: 'eac-sb17cac', count: 1, enclosure: { type: 'sealed', Vb: 8 }, filters: [] }] },
  { id: 'd-ss18', name: '18WU/4741T-00 in 12 L sealed', colorIdx: 3, active: false, space: 'half', ways: [{ driverId: 'eac-ss18wu', count: 1, enclosure: { type: 'sealed', Vb: 12 }, filters: [] }] },
  { id: 'd-2way', name: 'Example: SB34NRXL (estimate) 100 L / 27 Hz + PTT6.5M, LR4 at 400 Hz', colorIdx: 4, active: false, space: 'half', ways: [
    { driverId: 'sb-sb34nrxl75-8-est', count: 1, enclosure: { type: 'vented', Vb: 100, Ql: 10, port: { shape: 'round', d_mm: 100, n: 1, Fb: 27, Qp: 60, xi: 1 } }, filters: [{ type: 'lp', align: 'lr', order: 4, f: 400 }] },
    { driverId: 'eac-ptt65m', count: 1, enclosure: { type: 'sealed', Vb: 5.5 }, filters: [{ type: 'hp', align: 'lr', order: 4, f: 400 }] },
  ] },
];
const App = {
  userDrivers: [], setups: clone(DEF_SETUPS), settings: clone(DEF_SETTINGS), tab: 'distortion', res: {}, remoteSeen: { drivers: false, setups: false },
  views: {},
};
function loadLocal() {
  const s = Store.local('settings'); if (s) App.settings = deepMerge(clone(DEF_SETTINGS), s);
  const st = Store.local('setups'); if (Array.isArray(st) && st.length) App.setups = st;
  const dr = Store.local('drivers'); if (Array.isArray(dr)) App.userDrivers = dr;
}
function deepMerge(a, b) { for (const k in b) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') deepMerge(a[k], b[k]); else a[k] = b[k]; } return a; }
let saveSettingsT = 0;
function saveSettings() { clearTimeout(saveSettingsT); saveSettingsT = setTimeout(() => Store.local('settings', App.settings), 300); }
function persistSetup(s) {
  Store.local('setups', App.setups);
  // the account holds no setups yet: store the whole list on the first edit, so another device sees all of them
  if (App.remoteSetupsEmpty && Store.mode === 'db') { App.remoteSetupsEmpty = false; for (const x of App.setups) if (x !== s) Store.save('setups', x); }
  Store.save('setups', s);
}
function persistDriver(d) { Store.local('drivers', App.userDrivers); Store.save('drivers', d); }
function driverFor(id) { return LIB.find((d) => d.id === id) || App.userDrivers.find((d) => d.id === id) || null; }
function allDrivers() { return LIB.concat(App.userDrivers); }
function setupColor(s) { return PALETTE[(s.colorIdx || 0) % PALETTE.length]; }
function activeSetups() { return App.setups.filter((s) => s.active); }
function engineSetup(s) {
  return {
    id: s.id, space: s.space || 'half', distance: 1,
    ways: s.ways.map((w, i) => {
      const d = driverFor(w.driverId);
      if (!d) throw new Error('Setup "' + s.name + '" uses a driver that is no longer in the library. Pick another driver in Setups.');
      const drv = Object.assign({}, d, { abs: { kms: w.kmsSource === 'curve' || w.kmsSource === 'offset' ? w.kmsSource : 'table' } });
      return { driver: drv, count: w.count || 1, enclosure: w.enclosure || { type: 'ib' }, filters: w.filters || [], gainDb: +w.gainDb || 0, invert: !!w.invert, delayMs: +w.delayMs || 0, dT: +w.dT || 0, Rs: +w.Rs || 0, drive: w.drive || 'voltage', label: (s.ways.length > 1 ? 'Way ' + (i + 1) + ': ' : '') + d.label };
    }),
  };
}
function driverSummaryCached(d) {
  App._sumCache = App._sumCache || new Map();
  const key = d.id + '|' + JSON.stringify(d.ts) + '|' + JSON.stringify(d.nl || {}).length + '|' + (d.abs ? d.abs.kms : '');
  if (!App._sumCache.has(key)) { try { App._sumCache.set(key, KE.API.driverSummary(d)); } catch (e) { App._sumCache.set(key, { error: e.message }); } }
  return App._sumCache.get(key);
}
function klippelLimit(d) { // lower of X_Bl 82 % and X_C 75 %, in mm (null when neither curve exists)
  const s = driverSummaryCached(d); if (!s || s.error) return null;
  const c = [s.lim.xbl82, s.lim.xc75].filter(Boolean).map((v) => v.x);
  return c.length ? Math.min(...c) : null;
}

// ------------------------------------------------------------------ header, tabs, chips
function renderTabs() {
  const nav = $('#tabs'); nav.innerHTML = '';
  for (const [id, name] of TABS) nav.append(h('button', { class: 'tab', role: 'tab', type: 'button', id: 'tab-' + id, 'aria-selected': App.tab === id ? 'true' : 'false', 'aria-controls': 'view-' + id, onclick: () => showTab(id) }, name));
}
function showTab(id) {
  if (!TABS.some((t) => t[0] === id)) id = 'distortion';
  App.tab = id; renderTabs();
  for (const [tid] of TABS) { const v = $('#view-' + tid); if (v) v.hidden = tid !== id; }
  const v = App.views[id]; if (v && v.onShow) v.onShow();
  try { if (location.hash.slice(1) !== id) history.replaceState(null, '', '#' + id); } catch (e) {}
  window.scrollTo({ top: 0 });
}
function renderChips() {
  const bar = $('#chips'); bar.innerHTML = '';
  bar.append(h('span', { class: 'lbl' }, 'Compare'));
  for (const s of App.setups) {
    bar.append(h('button', {
      class: 'chip', type: 'button', 'aria-pressed': s.active ? 'true' : 'false', title: (s.active ? 'Remove from' : 'Add to') + ' the comparison',
      onclick: () => {
        if (!s.active && activeSetups().length >= 5) { toast('Up to five setups can be compared at once'); return; }
        s.active = !s.active; persistSetup(s); renderChips(); for (const v of Object.values(App.views)) v.onSetups && v.onSetups();
      },
    }, h('span', { class: 'sw', style: { background: setupColor(s) } }), h('span', { class: 'nm' }, s.name)));
  }
  bar.append(h('button', { class: 'btn sm ghost', type: 'button', onclick: () => showTab('setups') }, 'Edit setups'));
}
function renderStoreState() {
  const el = $('#store-state'); if (!el) return;
  const m = Store.mode;
  el.className = 'store-state ' + m;
  el.innerHTML = '';
  el.append(h('span', { class: 'dot' }), m === 'db' ? 'Saved to your account' : m === 'local' ? 'Saved in this browser' : 'Not saved');
}

// ------------------------------------------------------------------ small form helpers
function field(label, input, hint) { return h('label', { class: 'f' }, h('span', { class: 'l' }, h('span', null, label), hint ? h('span', { class: 'muted' }, hint) : null), input); }
function numInput(id, value, onchange, attrs) {
  const el = h('input', Object.assign({ id, type: 'number', inputmode: 'decimal', value: value == null ? '' : String(value), step: 'any' }, attrs || {}));
  el.addEventListener('change', () => onchange(el.value === '' ? null : num(el.value, null), el));
  return el;
}
function selectInput(id, value, options, onchange) {
  const el = h('select', { id }, options.map((o) => (o.group ? h('optgroup', { label: o.group }, o.items.map((it) => h('option', { value: it[0], selected: String(it[0]) === String(value) ? true : null }, it[1]))) : h('option', { value: o[0], selected: String(o[0]) === String(value) ? true : null }, o[1]))));
  el.addEventListener('change', () => onchange(el.value, el));
  return el;
}
function checkbox(id, checked, label, onchange) {
  const cb = h('input', { id, type: 'checkbox', checked: checked ? true : null });
  cb.addEventListener('change', () => onchange(cb.checked));
  return h('label', { class: 'cb', for: id }, cb, label);
}
function seg(id, value, options, onchange) {
  const wrap = h('div', { class: 'seg', role: 'group', id });
  for (const [v, name] of options) wrap.append(h('button', { type: 'button', 'aria-pressed': String(v) === String(value) ? 'true' : 'false', onclick: () => { for (const b of wrap.children) b.setAttribute('aria-pressed', 'false'); wrap.querySelector(`[data-v="${CSS.escape(String(v))}"]`).setAttribute('aria-pressed', 'true'); onchange(v); }, 'data-v': String(v) }, name));
  return wrap;
}
function progressBlock() {
  const bar = h('div', { class: 'progress' }, h('i'));
  const status = h('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
  return { el: h('div', { class: 'fs-body' }, bar, status), set(p, text) { bar.firstChild.style.width = clamp(p * 100, 0, 100) + '%'; if (text != null) { status.textContent = text; status.classList.remove('err'); } }, err(text) { status.textContent = text; status.classList.add('err'); bar.firstChild.style.width = '0%'; }, done(text) { bar.firstChild.style.width = '0%'; status.textContent = text || ''; status.classList.remove('err'); } };
}
function runButtons(onRun) {
  const run = h('button', { class: 'btn primary', type: 'button' }, 'Run simulation');
  const cancel = h('button', { class: 'btn ghost', type: 'button', hidden: true }, 'Cancel');
  cancel.addEventListener('click', () => { Compute.cancel(); });
  run.addEventListener('click', () => onRun());
  return { el: h('div', { class: 'btn-row' }, run, cancel), busy(b) { run.disabled = b; cancel.hidden = !b; } };
}
function exportButtons(getPlot, name) {
  return h('div', { class: 'btn-row' },
    h('button', { class: 'btn sm ghost', type: 'button', title: 'Download the chart data as CSV', onclick: async () => {
      const p = getPlot(); if (!p) return; const csv = p.toCSV();
      const ok = await Store.download(name + '.csv', csv);
      if (ok === null) await copyText(csv);
    } }, 'CSV'));
}
function freqList(f0, f1, ppo) { return KE.util.fracOctaveFreqs(Math.max(5, f0), Math.max(f0 * 1.01, f1), ppo); }
function noSetupsMsg() { return h('div', { class: 'plot-empty' }, 'No setups are selected. Turn one on in the Compare bar above, or create one in Setups.'); }
async function guard(pb, rb, fn) {
  rb.busy(true); pb.set(0.01, 'Starting…');
  const t = performance.now();
  try { const r = await fn(); pb.done('Finished in ' + ((performance.now() - t) / 1000).toFixed(1) + ' s'); return r; }
  catch (e) { if (/Cancel/.test(e.message)) pb.done('Cancelled'); else pb.err(e.message); console.error(e); return null; }
  finally { rb.busy(false); }
}
