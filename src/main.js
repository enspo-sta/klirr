/* Klirr start-up. */
function buildGuideToc() {
  const body = $('#guide-body'), nav = $('#guide-toc'); if (!body || !nav) return;
  nav.innerHTML = ''; nav.append(h('span', { class: 'kicker' }, 'Contents'));
  const heads = [...body.querySelectorAll('h2')].slice(1); // the first h2 is the guide title
  const btns = heads.map((hd, i) => {
    hd.id = hd.id || 'guide-' + (i + 1);
    const b = h('button', { type: 'button', onclick: () => hd.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, hd.textContent);
    nav.append(b); return b;
  });
  // mark the section being read
  const mark = () => {
    if (App.tab !== 'guide') return;
    let cur = 0; heads.forEach((hd, i) => { if (hd.getBoundingClientRect().top < 140) cur = i; });
    btns.forEach((b, i) => b.setAttribute('aria-current', i === cur ? 'true' : 'false'));
  };
  window.addEventListener('scroll', mark, { passive: true }); mark();
}
(function init() {
  buildGuideToc();
  loadLocal();
  App.setups.forEach((s, i) => { if (s.order == null) s.order = i; });
  renderTabs(); renderChips(); renderStoreState();
  Compute.start();
  const initial = (location.hash || '').slice(1);
  showTab(TABS.some((t) => t[0] === initial) ? initial : 'distortion');
  window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id && id !== App.tab && TABS.some((t) => t[0] === id)) showTab(id); });
  // open in a working state: run the default comparison once
  setTimeout(() => { if (!App.res.hd && activeSetups().length) App.views.distortion.autoRun(); }, 60);
  const editing = () => { const a = document.activeElement; return a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.id && !a.id.startsWith('hd-') && !a.id.startsWith('imd-'); };
  let firstDrivers = true;
  Store.init((kind, items) => {
    if (kind === 'ready') { renderStoreState(); return; }
    if (kind === 'drivers') {
      const next = items.slice();
      if (firstDrivers) { // drivers made in this browser before the account store answered are uploaded, not dropped
        firstDrivers = false;
        // a local driver the account once had but no longer has was deleted on another device: keep it deleted
        const synced = new Set(Store.local('syncedDrivers') || []);
        for (const d of App.userDrivers) if (!next.some((x) => x.id === d.id) && !synced.has(d.id)) { next.push(d); Store.save('drivers', d); }
      }
      Store.local('syncedDrivers', next.map((x) => x.id));
      next.sort((a, b) => String(a.label).localeCompare(String(b.label)));
      if (JSON.stringify(next) === JSON.stringify(App.userDrivers)) return;
      App.userDrivers = next; App._sumCache && App._sumCache.clear(); Store.local('drivers', App.userDrivers);
    }
    if (kind === 'setups') {
      if (!items.length) { App.remoteSetupsEmpty = true; return; } // first visit with this account: keep the example setups until something is edited
      App.remoteSetupsEmpty = false;
      const next = items.sort((a, b) => (a.order || 0) - (b.order || 0));
      if (JSON.stringify(next) === JSON.stringify(App.setups)) return;
      App.setups = next; Store.local('setups', App.setups);
    }
    renderChips();
    for (const v of Object.values(App.views)) v.onSetups && v.onSetups();
    if ((App.tab === 'setups' || App.tab === 'drivers') && !editing()) App.views[App.tab].build();
  }).then(renderStoreState);
})();
