/* Klirr UI core: DOM helpers, formatting, canvas plot, worker client, storage. */
'use strict';
const KE = window.KlirrEngine;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) { if (kid == null || kid === false) continue; el.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
  return el;
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const uid = (p) => (p || 'id') + '-' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d) => { const x = parseFloat(String(v).replace(',', '.')); return isFinite(x) ? x : d; };
const db20 = (x) => 20 * Math.log10(Math.max(x, 1e-15));
function fmt(v, d = 2) { if (v == null || !isFinite(v)) return '–'; const t = (+v).toFixed(d); return /^-0(\.0+)?$/.test(t) ? t.slice(1) : t; } // no "-0.000"
function fmtSig(v, s = 3) { if (v == null || !isFinite(v)) return '–'; if (v === 0) return '0'; const a = Math.abs(v); const d = Math.max(0, Math.min(6, s - 1 - Math.floor(Math.log10(a)))); return v.toFixed(d); }
function fmtHz(f) { if (!isFinite(f)) return '–'; if (f >= 1000) { const k = f / 1000; return (k >= 10 ? k.toFixed(1) : k.toFixed(2)).replace(/\.?0+$/, '') + ' kHz'; } return (f >= 100 ? f.toFixed(0) : f >= 10 ? f.toFixed(1) : f.toFixed(2)).replace(/\.0$/, '') + ' Hz'; }
function fmtFreqTick(f) { if (f >= 1000) return (f / 1000) + 'k'; return String(+f.toPrecision(3)); }
function fmtPct(r) { const p = r * 100; if (!isFinite(p)) return '–'; if (p >= 10) return p.toFixed(1) + ' %'; if (p >= 1) return p.toFixed(2) + ' %'; if (p >= 0.1) return p.toFixed(3) + ' %'; return p.toPrecision(2) + ' %'; }
function fmtRatio(r, unit) { return unit === 'pct' ? fmtPct(r) : fmt(db20(r), 1) + ' dB'; }
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const PALETTE = ['#56b6c2', '#d9a441', '#e06c75', '#98c379', '#c678dd'];
const GREY = '#d0d4dc';
const MECH = { bl: { name: 'Bl(x)', color: '#56b6c2' }, kms: { name: 'Kms(x)', color: '#d9a441' }, le: { name: 'Le(x) + reluctance', color: '#e06c75' }, doppler: { name: 'Doppler', color: '#98c379' }, box: { name: 'Box air + port', color: '#c678dd' } };
const DASH = { H2: [], H3: [7, 5], H4: [2, 4], H5: [10, 4, 2, 4], THD: [1, 3], d2: [], d3: [7, 5] };

function toast(msg, ms = 2600) {
  for (const old of document.querySelectorAll('.toast')) old.remove(); // one message at a time
  const t = h('div', { class: 'toast', role: 'status' }, msg); document.body.append(t);
  setTimeout(() => t.remove(), ms);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); return true; }
  catch (e) { toast('Copy was blocked here; select the text in the box and copy it manually'); return false; }
}

// ------------------------------------------------------------------ canvas plot
function niceStep(range, target) {
  const raw = range / Math.max(1, target); const p = Math.pow(10, Math.floor(Math.log10(raw))); const f = raw / p;
  return (f < 1.5 ? 1 : f < 2.25 ? 2 : f < 3.5 ? 2.5 : f < 7.5 ? 5 : 10) * p;
}
class Plot {
  constructor(host, o) {
    this.o = Object.assign({ height: 300, x: { type: 'log', min: 20, max: 20000, label: 'Frequency' }, y: { min: null, max: null, label: '' }, onClick: null, xfmt: null, yfmt: null }, o || {});
    this.host = host; host.classList.add('plot'); host.innerHTML = '';
    this.wrap = h('div', { class: 'plot-canvas-wrap' });
    this.canvas = h('canvas', { class: 'plot-canvas', role: 'img', 'aria-label': this.o.aria || 'chart' });
    this.tip = h('div', { class: 'plot-tip', hidden: true });
    this.wrap.append(this.canvas, this.tip);
    this.legendEl = h('div', { class: 'plot-legend' });
    host.append(this.wrap, this.legendEl);
    this.series = []; this.hidden = new Set(); this.vlines = []; this.hlines = [];
    this.hover = null;
    this.ro = new ResizeObserver(() => this.draw()); this.ro.observe(this.wrap);
    this.canvas.addEventListener('pointermove', (e) => { this.hover = this.evPos(e); this.draw(); });
    this.canvas.addEventListener('pointerleave', () => { this.hover = null; this.tip.hidden = true; this.draw(); });
    this.canvas.addEventListener('click', (e) => { const p = this.evPos(e); if (this.o.onClick && p && this.map) { const x = this.map.xinv(p.x); if (x != null) this.o.onClick(x); } });
  }
  evPos(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  setAxes(x, y) { if (x) this.o.x = Object.assign({}, this.o.x, x); if (y) this.o.y = Object.assign({}, this.o.y, y); this.draw(); }
  setData(series, extra) {
    this.series = series || [];
    this.vlines = (extra && extra.vlines) || []; this.hlines = (extra && extra.hlines) || [];
    if (extra && extra.x) this.o.x = Object.assign({}, this.o.x, extra.x);
    if (extra && extra.y) this.o.y = Object.assign({}, this.o.y, extra.y);
    const ids = new Set(this.series.map((s) => s.id)); for (const id of [...this.hidden]) if (!ids.has(id)) this.hidden.delete(id);
    this.renderLegend(); this.draw();
  }
  renderLegend() {
    this.legendEl.innerHTML = '';
    for (const s of this.series) {
      if (s.legend === false) continue;
      const on = !this.hidden.has(s.id);
      const sw = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); sw.setAttribute('width', '22'); sw.setAttribute('height', '10');
      if (s.kind === 'dots' || s.kind === 'stem') { const c = document.createElementNS(sw.namespaceURI, 'circle'); c.setAttribute('cx', '11'); c.setAttribute('cy', '5'); c.setAttribute('r', '4'); c.setAttribute('fill', s.color); sw.append(c); }
      else { const l = document.createElementNS(sw.namespaceURI, 'line'); l.setAttribute('x1', '1'); l.setAttribute('x2', '21'); l.setAttribute('y1', '5'); l.setAttribute('y2', '5'); l.setAttribute('stroke', s.color); l.setAttribute('stroke-width', String(s.width || 2)); if (s.dash && s.dash.length) l.setAttribute('stroke-dasharray', s.dash.join(' ')); sw.append(l); }
      const b = h('button', { class: 'lg', type: 'button', 'aria-pressed': on ? 'true' : 'false', title: on ? 'Hide ' + s.name : 'Show ' + s.name, onclick: () => { if (this.hidden.has(s.id)) this.hidden.delete(s.id); else this.hidden.add(s.id); this.renderLegend(); this.draw(); } }, sw, s.name);
      this.legendEl.append(b);
    }
  }
  visible() { return this.series.filter((s) => !this.hidden.has(s.id) && s.pts && s.pts.length); }
  computeRange() {
    const xo = this.o.x, yo = this.o.y;
    let ymin = Infinity, ymax = -Infinity, xmin = Infinity, xmax = -Infinity;
    for (const s of this.visible()) for (const p of s.pts) {
      const x = p[0], y = p[1]; if (!isFinite(x) || !isFinite(y)) continue;
      if (xo.type === 'log' && x <= 0) continue;
      if (x < xmin) xmin = x; if (x > xmax) xmax = x;
      if (xo.min != null && x < xo.min) continue; if (xo.max != null && x > xo.max) continue;
      if (yo.type === 'log' && y <= 0) continue;
      if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    }
    for (const l of this.hlines) { if (isFinite(l.y) && l.include !== false) { ymin = Math.min(ymin, l.y); ymax = Math.max(ymax, l.y); } }
    let x0 = xo.min != null ? xo.min : xmin, x1 = xo.max != null ? xo.max : xmax;
    if (!isFinite(x0) || !isFinite(x1)) { x0 = xo.type === 'log' ? 20 : 0; x1 = xo.type === 'log' ? 20000 : 1; }
    if (x1 <= x0) x1 = x0 * (xo.type === 'log' ? 10 : 1) + 1;
    let y0, y1;
    if (!isFinite(ymin)) { ymin = yo.type === 'log' ? 0.01 : 0; ymax = yo.type === 'log' ? 1 : 1; }
    if (yo.type === 'log') {
      const lo = Math.max(ymin, yo.floor || 1e-6), hi = Math.max(ymax, lo * 10);
      y0 = Math.pow(10, Math.floor(Math.log10(lo) + 1e-9)); y1 = Math.pow(10, Math.ceil(Math.log10(hi) - 1e-9));
      if (y1 / y0 < 100) y0 = y1 / 100;
      if (yo.min != null) y0 = yo.min; if (yo.max != null) y1 = yo.max;
      return { x0, x1, y0, y1 };
    }
    if (yo.mode === 'db') {
      const span = yo.span || 80;
      y1 = Math.ceil((ymax + 2) / 10) * 10; if (yo.maxCap != null) y1 = Math.min(y1, yo.maxCap);
      y0 = Math.max(Math.floor((ymin - 2) / 10) * 10, y1 - span);
      if (y1 - y0 < (yo.minSpan || 30)) y0 = y1 - (yo.minSpan || 30);
    } else {
      const pad = (ymax - ymin) * 0.06 || Math.abs(ymax) * 0.1 || 1;
      y0 = ymin - pad; y1 = ymax + pad;
      if (yo.zero && y0 > 0) y0 = 0;
      const st = niceStep(y1 - y0, 6); y0 = Math.floor(y0 / st) * st; y1 = Math.ceil(y1 / st) * st;
    }
    if (yo.min != null) y0 = yo.min; if (yo.max != null) y1 = yo.max;
    if (y1 <= y0) y1 = y0 + 1;
    return { x0, x1, y0, y1 };
  }
  draw() {
    const cv = this.canvas, W = this.wrap.clientWidth; if (!W) return;
    const H = this.o.height; const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px'; }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const R = this.computeRange();
    const L = this.o.left || 54, Rm = 12, T = 10, B = 30; const pw = Math.max(10, W - L - Rm), ph = Math.max(10, H - T - B);
    const xo = this.o.x;
    const lx0 = xo.type === 'log' ? Math.log10(R.x0) : R.x0, lx1 = xo.type === 'log' ? Math.log10(R.x1) : R.x1;
    const X = (x) => L + ((xo.type === 'log' ? Math.log10(x) : x) - lx0) / (lx1 - lx0) * pw;
    const ylog = this.o.y.type === 'log';
    const Y = ylog ? (y) => T + (Math.log10(R.y1) - Math.log10(Math.max(y, 1e-300))) / (Math.log10(R.y1) - Math.log10(R.y0)) * ph : (y) => T + (R.y1 - y) / (R.y1 - R.y0) * ph;
    const xinv = (px) => { if (px < L - 2 || px > L + pw + 2) return null; const v = lx0 + (px - L) / pw * (lx1 - lx0); return xo.type === 'log' ? Math.pow(10, v) : v; };
    this.map = { X, Y, xinv, L, T, pw, ph, R };
    const text = '#e7eaf0', muted = '#9aa3b1', grid = '#232831', axis = '#3a414d';
    g.font = '11px ' + getComputedStyle(document.body).fontFamily; g.textBaseline = 'middle';
    // y grid
    g.lineWidth = 1;
    if (ylog) {
      for (let d = Math.floor(Math.log10(R.y0)); d <= Math.ceil(Math.log10(R.y1)); d++) for (const m of [1, 2, 5]) {
        const v = m * Math.pow(10, d); if (v < R.y0 * 0.999 || v > R.y1 * 1.001) continue;
        const py = Math.round(Y(v)) + 0.5; g.strokeStyle = m === 1 ? grid : 'rgba(35,40,49,.55)'; g.beginPath(); g.moveTo(L, py); g.lineTo(L + pw, py); g.stroke();
        if (m === 1 || (Math.log10(R.y1 / R.y0) <= 3)) { g.fillStyle = muted; g.textAlign = 'right'; g.fillText(this.o.yfmt ? this.o.yfmt(v) : String(+v.toPrecision(3)), L - 7, py); }
      }
    } else {
      const yst = this.o.y.step || (this.o.y.mode === 'db' ? (R.y1 - R.y0 > 90 ? 20 : 10) : niceStep(R.y1 - R.y0, Math.max(3, Math.round(ph / 48))));
      for (let v = Math.ceil(R.y0 / yst - 1e-9) * yst; v <= R.y1 + 1e-9; v += yst) {
        const py = Math.round(Y(v)) + 0.5; g.strokeStyle = grid; g.beginPath(); g.moveTo(L, py); g.lineTo(L + pw, py); g.stroke();
        g.fillStyle = muted; g.textAlign = 'right'; g.fillText(this.o.yfmt ? this.o.yfmt(v) : String(+v.toPrecision(6)), L - 7, py);
      }
    }
    // x grid
    g.textAlign = 'center'; g.textBaseline = 'top';
    if (xo.type === 'log') {
      for (let d = Math.floor(lx0); d <= Math.ceil(lx1); d++) for (let m = 1; m <= 9; m++) {
        const v = m * Math.pow(10, d); if (v < R.x0 * 0.999 || v > R.x1 * 1.001) continue;
        const px = Math.round(X(v)) + 0.5; const major = m === 1 || m === 2 || m === 5;
        g.strokeStyle = major ? grid : 'rgba(35,40,49,.55)'; g.beginPath(); g.moveTo(px, T); g.lineTo(px, T + ph); g.stroke();
        if (major) { g.fillStyle = muted; g.fillText(fmtFreqTick(v), px, T + ph + 7); }
      }
    } else {
      const xst = this.o.x.step || niceStep(R.x1 - R.x0, Math.max(3, Math.round(pw / 90)));
      for (let v = Math.ceil(R.x0 / xst - 1e-9) * xst; v <= R.x1 + 1e-9; v += xst) {
        const px = Math.round(X(v)) + 0.5; g.strokeStyle = grid; g.beginPath(); g.moveTo(px, T); g.lineTo(px, T + ph); g.stroke();
        g.fillStyle = muted; g.fillText(this.o.xfmt ? this.o.xfmt(v) : String(+v.toPrecision(6)), px, T + ph + 7);
      }
    }
    // axes box
    g.strokeStyle = axis; g.strokeRect(L + 0.5, T + 0.5, pw - 1, ph - 1);
    // axis labels
    g.fillStyle = muted; g.textAlign = 'left'; g.textBaseline = 'top';
    if (this.o.y.label) { g.save(); g.fillText(this.o.y.label, L + 6, T + 4); g.restore(); }
    if (this.o.x.label) { g.textAlign = 'right'; g.fillText(this.o.x.label, L + pw - 6, T + ph - 16); }
    // clip plot area
    g.save(); g.beginPath(); g.rect(L, T, pw, ph); g.clip();
    for (const b of (this.o.bands || [])) { g.fillStyle = b.color; g.fillRect(X(b.x0), T, X(b.x1) - X(b.x0), ph); }
    const placed = []; // label boxes already drawn, so close lines do not print on top of each other
    for (const l of [...this.hlines].sort((a, b) => b.y - a.y)) {
      if (!isFinite(l.y)) continue; const py = Math.round(Y(l.y)) + 0.5;
      g.strokeStyle = l.color || axis; g.setLineDash(l.dash || [4, 4]); g.lineWidth = 1; g.beginPath(); g.moveTo(L, py); g.lineTo(L + pw, py); g.stroke(); g.setLineDash([]);
      if (l.label) {
        const w = g.measureText(l.label).width; let xr = L + pw - 6;
        for (let guard = 0; guard < 8; guard++) {
          const hit = placed.find((b) => Math.abs(b.y - py) < 16 && xr > b.x0 - 8 && xr - w < b.x1 + 8);
          if (!hit) break; xr = hit.x0 - 12;
        }
        placed.push({ y: py, x0: xr - w, x1: xr });
        g.fillStyle = l.color || muted; g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillText(l.label, xr, py - 2);
      }
    }
    const vplaced = [];
    for (const l of [...this.vlines].sort((a, b) => a.x - b.x)) {
      if (!isFinite(l.x) || l.x < R.x0 || l.x > R.x1) continue; const px = Math.round(X(l.x)) + 0.5;
      g.strokeStyle = l.color || axis; g.setLineDash(l.dash || []); g.lineWidth = l.width || 1; g.beginPath(); g.moveTo(px, T); g.lineTo(px, T + ph); g.stroke(); g.setLineDash([]);
      if (l.label) {
        const w = g.measureText(l.label).width; let ty = T + 4;
        for (let guard = 0; guard < 8; guard++) { const hit = vplaced.find((b) => Math.abs(b.y - ty) < 13 && px + 4 < b.x1 + 6 && px + 4 + w > b.x0 - 6); if (!hit) break; ty = hit.y + 14; }
        vplaced.push({ y: ty, x0: px + 4, x1: px + 4 + w });
        g.fillStyle = l.color || muted; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(l.label, px + 4, ty);
      }
    }
    for (const s of this.visible()) {
      g.strokeStyle = s.color; g.fillStyle = s.color; g.lineWidth = s.width || 2; g.setLineDash(s.dash || []); g.lineJoin = 'round'; g.lineCap = 'round';
      if (s.kind === 'stem') {
        g.setLineDash([]);
        for (const p of s.pts) { if (!isFinite(p[1]) || p[0] < R.x0 || p[0] > R.x1) continue; const px = X(p[0]), py = Y(Math.max(p[1], R.y0)); g.beginPath(); g.moveTo(px, T + ph); g.lineTo(px, py); g.lineWidth = s.width || 1.5; g.stroke(); g.beginPath(); g.arc(px, py, s.r || 3, 0, 7); g.fill(); }
      } else if (s.kind === 'dots') {
        g.setLineDash([]);
        for (const p of s.pts) { if (!isFinite(p[1])) continue; g.beginPath(); g.arc(X(p[0]), Y(p[1]), s.r || 3.5, 0, 7); g.fill(); if (s.ring) { g.strokeStyle = '#181b21'; g.lineWidth = 2; g.stroke(); g.strokeStyle = s.color; } }
      } else if (s.kind === 'step') {
        g.beginPath(); let pen = false;
        for (let i = 0; i < s.pts.length; i++) { const p = s.pts[i]; if (!isFinite(p[1])) { pen = false; continue; } const px = X(p[0]), py = Y(p[1]); if (!pen) { g.moveTo(px, py); pen = true; } else g.lineTo(px, py); }
        g.stroke();
      } else {
        if (s.fill) {
          g.save(); g.globalAlpha = s.fillAlpha || 0.12; g.beginPath(); let started = false, lastX = 0;
          for (const p of s.pts) { if (!isFinite(p[1])) continue; const px = X(p[0]), py = Y(p[1]); if (!started) { g.moveTo(px, T + ph); g.lineTo(px, py); started = true; } else g.lineTo(px, py); lastX = px; }
          g.lineTo(lastX, T + ph); g.closePath(); g.fill(); g.restore();
        }
        g.beginPath(); let pen = false;
        for (const p of s.pts) { if (!isFinite(p[1]) || !isFinite(p[0]) || (xo.type === 'log' && p[0] <= 0)) { pen = false; continue; } const px = X(p[0]), py = Y(p[1]); if (!pen) { g.moveTo(px, py); pen = true; } else g.lineTo(px, py); }
        g.stroke();
        if (s.markers) { g.setLineDash([]); for (const p of s.pts) { if (!isFinite(p[1])) continue; g.beginPath(); g.arc(X(p[0]), Y(p[1]), 3, 0, 7); g.fill(); } }
      }
      g.setLineDash([]);
    }
    for (const lb of (this.o.labels || [])) { if (!isFinite(lb.x) || !isFinite(lb.y)) continue; g.fillStyle = lb.color || text; g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(lb.text, X(lb.x), Y(lb.y) - 6); }
    g.restore();
    // hover
    this.tip.hidden = true;
    if (this.hover && this.hover.x >= L && this.hover.x <= L + pw && this.hover.y >= T && this.hover.y <= T + ph) {
      const hx = xinv(this.hover.x); const vis = this.visible();
      if (hx != null && vis.length) {
        const rows = []; let snapX = hx;
        const anyStem = vis.some((s) => s.kind === 'stem' || s.kind === 'dots');
        if (anyStem) { // snap to nearest stem/dot in pixels
          let best = null;
          for (const s of vis) if (s.kind === 'stem' || s.kind === 'dots') for (const p of s.pts) { const d = Math.abs(X(p[0]) - this.hover.x); if (!best || d < best.d) best = { d, x: p[0] }; }
          if (best && best.d < 14) snapX = best.x;
        }
        for (const s of vis) {
          let y = null;
          if (s.kind === 'stem' || s.kind === 'dots') { const p = s.pts.find((q) => Math.abs(q[0] - snapX) <= Math.abs(snapX) * 1e-9 + 1e-12); if (p) y = p[1]; }
          else y = interpAt(s.pts, snapX, xo.type === 'log');
          let extra = null;
          if (y != null && s.pts.length && s.pts[0].length > 2) { let bi = 0, bd = Infinity; s.pts.forEach((q, qi) => { const dd = Math.abs(X(q[0]) - X(snapX)); if (dd < bd) { bd = dd; bi = qi; } }); if (bd < 12) extra = s.pts[bi][2]; }
          if (y != null && isFinite(y)) rows.push({ s, y, extra });
        }
        const px = X(snapX);
        g.save(); g.strokeStyle = 'rgba(231,234,240,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(px) + 0.5, T); g.lineTo(Math.round(px) + 0.5, T + ph); g.stroke();
        for (const r of rows) { if (r.s.kind === 'stem' || r.s.kind === 'dots') continue; g.fillStyle = r.s.color; g.beginPath(); g.arc(px, Y(r.y), 3.5, 0, 7); g.fill(); g.strokeStyle = '#181b21'; g.lineWidth = 2; g.stroke(); }
        g.restore();
        if (rows.length) {
          const tf = this.o.tipX || ((x) => (xo.type === 'log' ? fmtHz(x) : String(+x.toPrecision(5))));
          this.tip.innerHTML = '';
          this.tip.append(h('div', { class: 'tx' }, tf(snapX)));
          rows.sort((a, b) => b.y - a.y);
          for (const r of rows.slice(0, 14)) {
            this.tip.append(h('div', { class: 'ti' }, h('span', { class: 'n' }, h('span', { class: 'sw', style: { background: r.s.color } }), r.s.name), h('span', { class: 'v' }, (r.s.fmt || this.o.tipY || ((v) => fmtSig(v, 4)))(r.y))));
            if (r.extra) this.tip.append(h('div', { class: 'ti', style: { color: '#9aa3b1', paddingLeft: '16px' } }, r.extra));
          }
          this.tip.hidden = false;
          const tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
          let tx = px + 14; if (tx + tw > W - 4) tx = px - tw - 14; if (tx < 4) tx = 4;
          let ty = this.hover.y - th / 2; ty = clamp(ty, 2, H - th - 2);
          this.tip.style.left = tx + 'px'; this.tip.style.top = ty + 'px';
        }
      }
    }
  }
  toCSV() {
    const lines = ['series,x,y'];
    for (const s of this.series) for (const p of (s.pts || [])) if (isFinite(p[1])) lines.push(`"${s.name.replace(/"/g, "'")}",${p[0]},${p[1]}`);
    return lines.join('\n');
  }
}
function interpAt(pts, x, log) {
  if (!pts.length) return null;
  let i = 0; while (i < pts.length && !(pts[i][0] >= x)) i++;
  if (i === 0) { return Math.abs(pts[0][0] - x) <= Math.abs(x) * 0.02 ? pts[0][1] : null; }
  if (i >= pts.length) { const p = pts[pts.length - 1]; return Math.abs(p[0] - x) <= Math.abs(x) * 0.02 ? p[1] : null; }
  const a = pts[i - 1], b = pts[i]; if (!isFinite(a[1]) || !isFinite(b[1])) return null;
  const t = log ? (Math.log(x) - Math.log(a[0])) / (Math.log(b[0]) - Math.log(a[0])) : (x - a[0]) / (b[0] - a[0]);
  return a[1] + t * (b[1] - a[1]);
}

// ------------------------------------------------------------------ worker client
const Compute = {
  w: null, seq: 0, pending: new Map(), inline: false,
  start() {
    try {
      const src = $('#engine-src').textContent;
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      this.w = new Worker(url);
      this.w.onmessage = (ev) => {
        const m = ev.data; const p = this.pending.get(m.id); if (!p) return;
        if (m.type === 'progress') { p.onProgress && p.onProgress(m.p, m.info); return; }
        this.pending.delete(m.id);
        if (m.type === 'done') p.res(m.res); else p.rej(new Error(m.message));
      };
      this.w.onerror = (e) => { for (const p of this.pending.values()) p.rej(new Error(e.message || 'The simulation worker stopped')); this.pending.clear(); };
    } catch (e) { this.inline = true; this.w = null; }
  },
  run(cmd, args, onProgress) {
    if (this.inline || !this.w) {
      return new Promise((res, rej) => setTimeout(() => { try { res(KE.API[cmd](args, onProgress)); } catch (e) { rej(e); } }, 30));
    }
    return new Promise((res, rej) => { const id = ++this.seq; this.pending.set(id, { res, rej, onProgress }); this.w.postMessage({ id, cmd, args }); });
  },
  cancel() {
    if (this.w) this.w.terminate();
    for (const p of this.pending.values()) p.rej(new Error('Cancelled'));
    this.pending.clear(); this.start();
  },
};

// ------------------------------------------------------------------ storage: account database when available, browser storage otherwise
const Store = {
  mode: 'memory', db: null, uid: null, dl: null, subs: [], timers: new Map(), inflight: new Map(),
  local(k, v) {
    try { if (v === undefined) { const s = localStorage.getItem('klirr.v1.' + k); return s ? JSON.parse(s) : null; } localStorage.setItem('klirr.v1.' + k, JSON.stringify(v)); return true; } catch (e) { return null; }
  },
  async init(onRemote) {
    if (this.local('probe', 1)) this.mode = 'local';
    const use = window.claude && typeof window.claude.use === 'function' ? window.claude.use.bind(window.claude) : null;
    if (!use) return;
    use('downloads').then((d) => { this.dl = d; }).catch(() => {});
    try {
      const [db, user] = await Promise.all([use('db'), use('user')]);
      if (!db || !user) return;
      const id = await user.id(); if (!id) return;
      this.db = db; this.uid = id; this.mode = 'db';
      const base = 'data/users/' + id + '/library';
      for (const kind of ['drivers', 'setups']) {
        const unsub = db.doc(base).collection(kind).onSnapshot((snap) => {
          const items = snap.docs.filter((d) => d.exists).map((d) => Object.assign(clone(d.data()), { id: d.id }));
          onRemote(kind, items, snap.metadata);
        }, (err) => { console.warn('db', err); });
        this.subs.push(unsub);
      }
      onRemote('ready');
    } catch (e) { console.warn('storage', e); }
  },
  save(kind, obj) { // debounced per document, and one write at a time per document
    if (this.mode !== 'db') { return; }
    const key = kind + '/' + obj.id; clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => {
      const prev = this.inflight.get(key) || Promise.resolve();
      const next = prev.then(async () => {
        try { await this.db.doc('data/users/' + this.uid + '/library').collection(kind).doc(obj.id).set(clone(obj)); }
        catch (e) { console.warn('save', e); toast('Could not save to your account (' + (e.code || e.message) + '). Changes stay in this browser.'); }
      });
      this.inflight.set(key, next);
      next.then(() => { if (this.inflight.get(key) === next) this.inflight.delete(key); });
    }, 700));
  },
  async remove(kind, id) {
    if (this.mode !== 'db') return;
    const key = kind + '/' + id; clearTimeout(this.timers.get(key)); this.timers.delete(key); // a pending save must not bring it back
    const prev = this.inflight.get(key) || Promise.resolve();
    const next = prev.then(async () => { try { await this.db.doc('data/users/' + this.uid + '/library').collection(kind).doc(id).delete(); } catch (e) { console.warn('delete', e); } });
    this.inflight.set(key, next); await next;
    if (this.inflight.get(key) === next) this.inflight.delete(key);
  },
  async download(filename, data) {
    if (this.dl) {
      try { await this.dl.save({ filename, data }); return true; }
      catch (e) { if (e && e.code === 'declined') return false; }
    }
    // an ordinary web page (GitHub Pages, a local file) can save through a link; inside a Claude artifact such links do nothing
    if (!window.claude) {
      try {
        const url = URL.createObjectURL(new Blob([data], { type: /\.csv$/.test(filename) ? 'text/csv' : 'application/json' }));
        const a = h('a', { href: url, download: filename, style: { display: 'none' } }); document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000); return true;
      } catch (e) { /* fall through to the copy box */ }
    }
    return null; // caller falls back to copy
  },
};
