/* Klirr engine: nonlinear lumped-parameter loudspeaker simulation.
   Runs inside a Web Worker in the browser and under Node for tests. No dependencies.

   Model (Klippel's lumped-parameter model, see the in-app guide for sources):
     u = Re'·i + d(Le(x)·i)/dt + uL2 + Bl(x)·v
     L2 branch: uL2 = R2(x)·(i − i2),  d(L2(x)·i2)/dt = uL2      (same-shape assumption)
     Mms·dv/dt = Bl(x)·i − Rms·v − Kms(x)·x + ½i²·dLe/dx + ½i2²·dL2/dx + Sd·pbox
     pbox = P0·[((V0 − z)/(V0 + Sd·x + Sp·xp + Sr·xr))^γ − 1]           (adiabatic air, leak volume z)
     port plug: Map·dvp/dt = Sp·pbox − Rp·vp − ½ρ·ξ·Sp·vp·|vp|·s(|vp|)   (Vanderkooy jet loss)
     passive radiator: Mr·dvr/dt = Sr·pbox − Rr·vr − Fr(xr)
     far field: p(t) = ρ/(Ω·r)·[Sd·a(t + x/c) + Sp·ap + Sr·ar]          (first-order Doppler on the cone)
   Units inside the engine are SI. Driver files use datasheet units (mH, g, mm/N, cm², mm). */
(function (root) {
  'use strict';

  const AIR = { rho: 1.196, c: 344.4, P0: 101325, gamma: 1.4 };
  AIR.kappa = AIR.gamma * AIR.P0; // adiabatic bulk modulus (≈ ρc²)
  const PREF = 20e-6;
  const ALPHA_R = 0.0039; // temperature coefficient of copper and aluminium, per kelvin
  const TWO_PI = 2 * Math.PI;
  // 8-point Lagrange interpolation denominators for nodes −3 … +4
  const LW = (() => { const n = [-3, -2, -1, 0, 1, 2, 3, 4]; return n.map((j) => 1 / n.reduce((p, k) => (k === j ? p : p * (j - k)), 1)); })();

  // ------------------------------------------------------------------ small numeric helpers
  const db20 = (a) => 20 * Math.log10(Math.max(a, 1e-300));
  const splOf = (pRms) => db20(pRms / PREF);
  function linspace(a, b, n) { const r = new Float64Array(n); for (let i = 0; i < n; i++) r[i] = a + (b - a) * i / (n - 1); return r; }
  function logspace(a, b, n) { const r = []; const la = Math.log(a), lb = Math.log(b); for (let i = 0; i < n; i++) r.push(Math.exp(la + (lb - la) * i / (n - 1))); return r; }
  function fracOctaveFreqs(f1, f2, perOct) {
    const out = []; const n = Math.max(2, Math.round(Math.log2(f2 / f1) * perOct) + 1);
    for (let i = 0; i < n; i++) out.push(f1 * Math.pow(f2 / f1, i / (n - 1)));
    return out;
  }
  // complex arithmetic on {re, im}
  const cx = (re, im) => ({ re, im: im || 0 });
  const cadd = (a, b) => ({ re: a.re + b.re, im: a.im + b.im });
  const csub = (a, b) => ({ re: a.re - b.re, im: a.im - b.im });
  const cmul = (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
  const cdiv = (a, b) => { const d = b.re * b.re + b.im * b.im; return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }; };
  const cabs = (a) => Math.hypot(a.re, a.im);
  const cscale = (a, s) => ({ re: a.re * s, im: a.im * s });
  const cinv = (a) => cdiv(cx(1), a);
  const cexpj = (ph) => ({ re: Math.cos(ph), im: Math.sin(ph) });

  // ------------------------------------------------------------------ linear algebra (tiny)
  function solveLinear(A, b, n) { // Gaussian elimination with partial pivoting, A row-major n×n
    A = A.slice(); b = b.slice();
    for (let k = 0; k < n; k++) {
      let p = k, mx = Math.abs(A[k * n + k]);
      for (let r = k + 1; r < n; r++) { const v = Math.abs(A[r * n + k]); if (v > mx) { mx = v; p = r; } }
      if (mx < 1e-300) throw new Error('Singular fit matrix');
      if (p !== k) { for (let c = 0; c < n; c++) { const t = A[k * n + c]; A[k * n + c] = A[p * n + c]; A[p * n + c] = t; } const t = b[k]; b[k] = b[p]; b[p] = t; }
      for (let r = k + 1; r < n; r++) {
        const f = A[r * n + k] / A[k * n + k]; if (f === 0) continue;
        for (let c = k; c < n; c++) A[r * n + c] -= f * A[k * n + c];
        b[r] -= f * b[k];
      }
    }
    const x = new Array(n).fill(0);
    for (let k = n - 1; k >= 0; k--) { let s = b[k]; for (let c = k + 1; c < n; c++) s -= A[k * n + c] * x[c]; x[k] = s / A[k * n + k]; }
    return x;
  }

  // Chebyshev least-squares fit of y(x) on [xmin, xmax]
  function chebFit(xs, ys, order) {
    let xmin = Infinity, xmax = -Infinity;
    for (const x of xs) { if (x < xmin) xmin = x; if (x > xmax) xmax = x; }
    const m = (xmax + xmin) / 2, s = (xmax - xmin) / 2 || 1;
    const n = Math.max(1, Math.min(order, xs.length - 1, 16)) + 1;
    const A = new Array(n * n).fill(0), b = new Array(n).fill(0), T = new Array(n);
    for (let p = 0; p < xs.length; p++) {
      const u = (xs[p] - m) / s; T[0] = 1; if (n > 1) T[1] = u;
      for (let k = 2; k < n; k++) T[k] = 2 * u * T[k - 1] - T[k - 2];
      for (let r = 0; r < n; r++) { b[r] += T[r] * ys[p]; for (let c = 0; c < n; c++) A[r * n + c] += T[r] * T[c]; }
    }
    const c = solveLinear(A, b, n);
    const fit = { c, m, s, xmin, xmax };
    let ss = 0; for (let p = 0; p < xs.length; p++) { const e = chebEval(fit, xs[p]) - ys[p]; ss += e * e; }
    fit.rms = Math.sqrt(ss / xs.length);
    return fit;
  }
  function chebEval(fit, x) { // Clenshaw
    const u = (x - fit.m) / fit.s, c = fit.c; let b1 = 0, b2 = 0;
    for (let k = c.length - 1; k >= 1; k--) { const t = 2 * u * b1 - b2 + c[k]; b2 = b1; b1 = t; }
    return u * b1 - b2 + c[0];
  }

  // ------------------------------------------------------------------ driver curves
  // A curve spec describes Bl (T·m), Kms (N/mm) or Le (mH) against displacement x in mm.
  // The engine uses only the SHAPE r(x) = y(x)/y(0); absolute values come from the small-signal parameters.
  function buildCurve(spec, kind) {
    if (!spec || spec.type === 'none') return null;
    let f, lo = -Infinity, hi = Infinity, fit = null, info = {};
    if (spec.type === 'points') {
      const xs = [], ys = [];
      const pts = spec.x.map((x, i) => [x, spec.y[i]]).filter((p) => isFinite(p[0]) && isFinite(p[1])).sort((a, b) => a[0] - b[0]);
      for (const p of pts) { xs.push(p[0]); ys.push(kind === 'kms' && spec.quantity === 'cms' ? 1 / p[1] : p[1]); }
      if (xs.length < 3) return null;
      fit = chebFit(xs, ys, spec.fit || 8);
      lo = fit.xmin; hi = fit.xmax; f = (x) => chebEval(fit, x);
      info.fitRms = fit.rms; info.fitOrder = fit.c.length - 1; info.n = xs.length;
    } else if (spec.type === 'poly') {
      const c = spec.coef.slice();
      if (kind === 'kms' && spec.quantity === 'cms') { // convert compliance polynomial samples to stiffness points
        const R = spec.range || 10, xs = [], ys = [];
        for (let i = 0; i <= 200; i++) { const x = -R + 2 * R * i / 200; let y = 0; for (let k = c.length - 1; k >= 0; k--) y = y * x + c[k]; xs.push(x); ys.push(1 / y); }
        return buildCurve({ type: 'points', x: xs, y: ys, fit: 10 }, kind);
      }
      f = (x) => { let y = 0; for (let k = c.length - 1; k >= 0; k--) y = y * x + c[k]; return y; };
      const R = spec.range || 10; lo = -R; hi = R;
    } else if (spec.type === 'param') {
      const X = Math.max(0.05, spec.xlim || 5), off = spec.offset || 0, p = spec.shape || 2;
      if (kind === 'bl') {
        const thr = spec.thr || 0.82; f = (x) => Math.pow(thr, Math.pow(Math.abs((x - off) / X), p));
      } else if (kind === 'kms') {
        const thr = spec.thr || 0.75; f = (x) => 1 / Math.pow(thr, Math.pow(Math.abs((x - off) / X), p));
      } else {
        const xr = Math.max(0.1, spec.xref || 5);
        const rin = Math.max(0.05, 1 + (spec.inPct || 0) / 100), rout = Math.max(0.05, 1 + (spec.outPct || 0) / 100);
        const a = (Math.log(rout) - Math.log(rin)) / (2 * xr), b = (Math.log(rout) + Math.log(rin)) / (2 * xr * xr);
        const xc = 1.5 * xr;
        f = (x) => { const xx = Math.max(-xc, Math.min(xc, x)); return Math.exp(a * xx + b * xx * xx); };
      }
      lo = -Infinity; hi = Infinity;
    } else return null;
    const y0 = f(0);
    if (!(y0 > 0)) throw new Error('Curve for ' + kind + ' is not positive at x = 0');
    const d = (x, h) => (f(x + h) - f(x - h)) / (2 * h);
    const edgeLo = isFinite(lo) ? { x: lo, y: f(lo), s: d(lo + 1e-3, 1e-3) } : null;
    const edgeHi = isFinite(hi) ? { x: hi, y: f(hi), s: d(hi - 1e-3, 1e-3) } : null;
    // shape with safe extrapolation outside the data range
    const r = (x) => {
      let y;
      if (x < lo) {
        if (kind === 'bl') y = edgeLo.y + Math.max(0, edgeLo.s) * (x - lo); // may only fall outward
        else if (kind === 'kms') y = edgeLo.y + Math.min(0, edgeLo.s) * (x - lo); // may only stiffen outward
        else y = edgeLo.y;
      } else if (x > hi) {
        if (kind === 'bl') y = edgeHi.y + Math.min(0, edgeHi.s) * (x - hi);
        else if (kind === 'kms') y = edgeHi.y + Math.max(0, edgeHi.s) * (x - hi);
        else y = edgeHi.y;
      } else y = f(x);
      y /= y0;
      if (kind === 'bl') return Math.max(0.05, y);
      if (kind === 'kms') return Math.max(0.2, y);
      return Math.min(5, Math.max(0.2, y));
    };
    return { kind, r, raw: f, y0, lo, hi, fit, info };
  }

  // ------------------------------------------------------------------ driver compile
  function tsOf(D) {
    const t = D.ts || {};
    const Re = +t.Re, Le = (+t.Le || 0) * 1e-3, L2 = (+t.L2 || 0) * 1e-3, R2 = +t.R2 || 0;
    const Bl = +t.Bl, Mms = (+t.Mms) * 1e-3, Sd = (+t.Sd) * 1e-4;
    const Kms = t.Kms ? (+t.Kms) * 1e3 : 1 / ((+t.Cms) * 1e-3);
    const Rms = +t.Rms;
    if (!(Re > 0 && Bl > 0 && Mms > 0 && Sd > 0 && Kms > 0 && Rms >= 0)) throw new Error('Driver "' + (D.label || D.id) + '" is missing small-signal parameters (Re, Bl, Mms, Cms or Kms, Rms, Sd).');
    return { Re, Le, L2, R2, Bl, Mms, Kms, Rms, Sd, XmaxMm: +t.Xmax || null, Pe: +t.Pe || null };
  }

  function derived(ts) {
    const ws = Math.sqrt(ts.Kms / ts.Mms), fs = ws / TWO_PI;
    const Qms = ws * ts.Mms / Math.max(ts.Rms, 1e-9), Qes = ws * ts.Mms * ts.Re / (ts.Bl * ts.Bl);
    const Qts = 1 / (1 / Qms + 1 / Qes);
    const Vas = AIR.kappa * ts.Sd * ts.Sd / ts.Kms; // m³
    // mass-controlled half-space sensitivity at 1 m for 2.83 V and for 1 W into Re
    const a283 = ts.Bl * (2.83 / ts.Re) / ts.Mms;
    const spl283 = splOf(AIR.rho * ts.Sd * a283 / TWO_PI / 1);
    const a1w = ts.Bl * Math.sqrt(1 / ts.Re) / ts.Mms;
    const spl1w = splOf(AIR.rho * ts.Sd * a1w / TWO_PI);
    const eta0 = AIR.rho * ts.Bl * ts.Bl * ts.Sd * ts.Sd / (TWO_PI * AIR.c * ts.Re * ts.Mms * ts.Mms);
    return { fs, Qms, Qes, Qts, Vas, spl283, spl1w, eta0 };
  }

  function compileDriver(D) {
    const ts = tsOf(D);
    const cBl = buildCurve(D.nl && D.nl.bl, 'bl');
    const cK = buildCurve(D.nl && D.nl.kms, 'kms');
    const cL = buildCurve(D.nl && D.nl.le, 'le');
    // absolute values: the small-signal table by default; optionally the large-signal curve value at x = 0
    const abs = D.abs || {};
    const kTable = ts.Kms, blTable = ts.Bl;
    if (abs.kms === 'curve' && cK && D.nl.kms.type !== 'param') ts.Kms = cK.y0 * 1e3;
    if (abs.bl === 'curve' && cBl && D.nl.bl.type !== 'param') ts.Bl = cBl.y0;
    ts.KmsTable = kTable; ts.BlTable = blTable;
    const der = derived(ts);
    const rBl = cBl ? cBl.r : () => 1, rK = cK ? cK.r : () => 1, rL = cL ? cL.r : () => 1;
    // data range (mm) used for warnings
    const rng = [cBl, cK, cL].filter(Boolean).map((c) => [c.lo, c.hi]).filter((r) => isFinite(r[0]) && isFinite(r[1]));
    let dataLo = -Infinity, dataHi = Infinity;
    for (const r of rng) { dataLo = Math.max(dataLo, r[0]); dataHi = Math.min(dataHi, r[1]); }
    if (!rng.length) { dataLo = -Infinity; dataHi = Infinity; }
    const refX = Math.max(isFinite(dataHi) ? Math.max(Math.abs(dataLo), Math.abs(dataHi)) : 0, ts.XmaxMm || 0, 10);
    const Xt = Math.max(40, 3 * refX); // mm
    const N = 16385, x0 = -Xt, dx = 2 * Xt / (N - 1);
    const tBl = new Float64Array(N), tF = new Float64Array(N), tL = new Float64Array(N), tdL = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      const xm = x0 + k * dx, x = xm * 1e-3;
      tBl[k] = ts.Bl * rBl(xm);
      tF[k] = ts.Kms * rK(xm) * x;
      tL[k] = rL(xm);
    }
    for (let k = 0; k < N; k++) { // derivative of the inductance ratio per metre
      const a = Math.max(0, k - 1), b = Math.min(N - 1, k + 1);
      tdL[k] = (tL[b] - tL[a]) / ((b - a) * dx * 1e-3);
    }
    // minimum inductance ratio within the data range (for step-size choice)
    let minL = 1; for (let k = 0; k < N; k++) { const xm = x0 + k * dx; if (xm >= Math.max(dataLo, -refX) && xm <= Math.min(dataHi, refX)) minL = Math.min(minL, tL[k]); }
    return {
      id: D.id, label: D.label || [D.brand, D.model].filter(Boolean).join(' ') || D.id, ts, der,
      curves: { bl: cBl, kms: cK, le: cL }, r: { bl: rBl, kms: rK, le: rL },
      tab: { x0: x0 * 1e-3, inv: 1 / (dx * 1e-3), n: N, Bl: tBl, F: tF, L: tL, dL: tdL },
      dataRange: [dataLo, dataHi], minL,
    };
  }

  // Klippel displacement limits (IEC 62458 definitions, see guide). All values in mm.
  function displacementLimits(cd) {
    const out = {};
    const scan = (fn, thr, limitDir) => { // fn(x) returns ratio; limitDir: 'min' threshold or 'maxdev'
      const lo = isFinite(cd.dataRange[0]) ? cd.dataRange[0] : -3 * (cd.ts.XmaxMm || 10);
      const hi = isFinite(cd.dataRange[1]) ? cd.dataRange[1] : 3 * (cd.ts.XmaxMm || 10);
      const R = Math.min(-lo, hi); const step = Math.max(0.002, R / 4000);
      let worst = limitDir === 'min' ? 1 : 0, prevX = 0, prevW = worst;
      for (let X = step; X <= R + 1e-9; X += step) {
        const a = fn(X), b = fn(-X);
        worst = limitDir === 'min' ? Math.min(worst, a, b) : Math.max(worst, a, b);
        const hit = limitDir === 'min' ? worst <= thr : worst >= thr;
        if (hit) { const t = (thr - prevW) / ((worst - prevW) || 1e-12); return { x: prevX + Math.max(0, Math.min(1, t)) * step, beyond: false }; }
        prevX = X; prevW = worst;
      }
      return { x: R, beyond: true };
    };
    const hasBl = !!cd.curves.bl, hasK = !!cd.curves.kms, hasL = !!cd.curves.le;
    if (hasBl) { out.xbl82 = scan(cd.r.bl, 0.82, 'min'); out.xbl70 = scan(cd.r.bl, 0.70, 'min'); }
    if (hasK) { const c = (x) => 1 / cd.r.kms(x); out.xc75 = scan(c, 0.75, 'min'); out.xc50 = scan(c, 0.50, 'min'); }
    if (hasL) {
      const f2 = 8.5 * cd.der.fs, s2 = cx(0, TWO_PI * f2), ts = cd.ts;
      const Ze = (x) => {
        const r = cd.r.le(x); const L2 = ts.L2 * r, R2 = ts.R2 * r;
        let z = cadd(cx(ts.Re), cmul(s2, cx(ts.Le * r)));
        if (L2 > 0 && R2 > 0) z = cadd(z, cdiv(cmul(cx(R2), cmul(s2, cx(L2))), cadd(cx(R2), cmul(s2, cx(L2)))));
        return z;
      };
      const z0 = Ze(0), m0 = cabs(z0);
      const dev = (x) => cabs(csub(Ze(x), z0)) / m0;
      out.xl10 = scan(dev, 0.10, 'maxdev'); out.xl17 = scan(dev, 0.17, 'maxdev');
    }
    // Klippel's X_D = 90.5·d/fs (d = 10 %); LSI reports use the large-signal resonance, so do the same when a Kms(x) curve exists
    let fsD = cd.der.fs, basis = 'small-signal fs';
    if (cd.curves.kms && isFinite(cd.curves.kms.y0) && cd.curves.kms.info && cd.curves.kms.info.n) { fsD = Math.sqrt(cd.curves.kms.y0 * 1e3 / cd.ts.Mms) / TWO_PI; basis = 'large-signal fs from Kms(0) of the curve'; }
    out.xd10 = { x: 905 / fsD, beyond: false, fs: fsD, basis };
    return out;
  }

  // ------------------------------------------------------------------ filters
  // Analog sections: {B:[B0,B1,B2], A:[A0,A1,A2], w: prewarp rad/s}
  function filterSections(fl) {
    const out = [];
    const w = TWO_PI * (+fl.f || 100);
    const bw = (order, type) => {
      const secs = [];
      for (let k = 1; k <= Math.floor(order / 2); k++) {
        const Q = 1 / (2 * Math.sin((2 * k - 1) * Math.PI / (2 * order)));
        secs.push(type === 'lp' ? { B: [w * w, 0, 0], A: [w * w, w / Q, 1], w } : { B: [0, 0, 1], A: [w * w, w / Q, 1], w });
      }
      if (order % 2) secs.push(type === 'lp' ? { B: [w, 0, 0], A: [w, 1, 0], w } : { B: [0, 1, 0], A: [w, 1, 0], w });
      return secs;
    };
    if (fl.type === 'lp' || fl.type === 'hp') {
      const order = Math.max(1, Math.min(8, fl.order | 0 || 2));
      if (fl.align === 'lr') { const h = Math.max(1, Math.round(order / 2)); out.push(...bw(h, fl.type), ...bw(h, fl.type)); }
      else out.push(...bw(order, fl.type));
    } else if (fl.type === 'lt') {
      const w0 = TWO_PI * fl.f0, wp = TWO_PI * fl.fp;
      out.push({ B: [w0 * w0, w0 / fl.q0, 1], A: [wp * wp, wp / fl.qp, 1], w: Math.sqrt(w0 * wp) });
    } else if (fl.type === 'peq') {
      const A = Math.pow(10, (fl.gain || 0) / 40), Q = fl.q || 1;
      out.push({ B: [w * w, A * w / Q, 1], A: [w * w, w / (A * Q), 1], w });
    } else if (fl.type === 'lowshelf' || fl.type === 'highshelf') {
      const A = Math.pow(10, (fl.gain || 0) / 40), Q = fl.q || 0.7071, sA = Math.sqrt(A);
      if (fl.type === 'lowshelf') out.push({ B: [A * A * w * w, A * sA * w / Q, A], A: [w * w, sA * w / Q, A], w });
      else out.push({ B: [A * w * w, A * sA * w / Q, A * A], A: [A * w * w, sA * w / Q, 1], w });
    }
    return out;
  }
  function wayFilterSections(way) {
    const s = [];
    for (const fl of (way.filters || [])) if (fl && fl.on !== false) s.push(...filterSections(fl));
    return s;
  }
  function analogResponse(secs, f) {
    const s = cx(0, TWO_PI * f); let H = cx(1);
    for (const q of secs) {
      const num = cadd(cadd(cx(q.B[0]), cscale(s, q.B[1])), cscale(cmul(s, s), q.B[2]));
      const den = cadd(cadd(cx(q.A[0]), cscale(s, q.A[1])), cscale(cmul(s, s), q.A[2]));
      H = cmul(H, cdiv(num, den));
    }
    return H;
  }
  function bilinear(q, fs) {
    const K = q.w > 0 ? q.w / Math.tan(q.w / (2 * fs)) : 2 * fs;
    const [B0, B1, B2] = q.B, [A0, A1, A2] = q.A;
    const a0 = A0 + A1 * K + A2 * K * K;
    return {
      b0: (B0 + B1 * K + B2 * K * K) / a0, b1: (2 * B0 - 2 * B2 * K * K) / a0, b2: (B0 - B1 * K + B2 * K * K) / a0,
      a1: (2 * A0 - 2 * A2 * K * K) / a0, a2: (A0 - A1 * K + A2 * K * K) / a0,
    };
  }
  function digitalResponse(sos, f, fs) {
    const W = TWO_PI * f / fs, z1 = cexpj(-W), z2 = cexpj(-2 * W); let H = cx(1);
    for (const q of sos) {
      const num = cadd(cadd(cx(q.b0), cscale(z1, q.b1)), cscale(z2, q.b2));
      const den = cadd(cadd(cx(1), cscale(z1, q.a1)), cscale(z2, q.a2));
      H = cmul(H, cdiv(num, den));
    }
    return H;
  }

  // ------------------------------------------------------------------ enclosure compile
  function compileEnclosure(enc, cd) {
    const e = enc || { type: 'ib' };
    const out = { type: e.type || 'ib', V0: 0, Sp: 0, Leff: 0, Map: 0, Rp: 0, xi: 0, vc: 0, vw: 1, Sr: 0, Mr: 0, Kr: 0, Rr: 0, prXlim: 0, prThr: 0.5, prShape: 2, Ral: 0 };
    if (out.type === 'ib') return out;
    out.V0 = Math.max(1e-4, (+e.Vb || 20) * 1e-3);
    const Cab = out.V0 / AIR.kappa;
    let wref;
    if (out.type === 'vented') {
      const p = e.port || {};
      const n = Math.max(1, p.n | 0 || 1);
      let Sp1, dh;
      if (p.shape === 'slot') { const hh = (+p.h_mm || 10) * 1e-3, ww = (+p.w_mm || 100) * 1e-3; Sp1 = hh * ww; dh = 4 * Sp1 / (2 * (hh + ww)); }
      else { const d = (+p.d_mm || 50) * 1e-3; Sp1 = Math.PI * d * d / 4; dh = d; }
      out.Sp = n * Sp1;
      const Fb = +p.Fb || 30; const wb = TWO_PI * Fb;
      out.Leff = AIR.c * AIR.c * out.Sp / (wb * wb * out.V0); // Helmholtz: wb² = c²·Sp/(V0·Leff)
      out.Map = AIR.rho * out.Sp * out.Leff;
      out.Rp = wb * out.Map / Math.max(1, +p.Qp || 60);
      out.xi = p.xi != null ? +p.xi : 1.0;
      out.vc = p.vc ? +p.vc : 0.375 / dh; // Vanderkooy: critical velocity × port diameter held constant (5 m/s at 75 mm)
      out.vw = p.vw ? +p.vw : 0.075 / dh; // transition width (1 m/s at 75 mm)
      out.dh = dh; out.Fb = Fb; out.nPorts = n; out.Sp1 = Sp1;
      // physical length for a round port, end corrections 0.85r + 0.61r; a slot's end correction depends on how it meets the walls, so only its effective length is given
      out.Lphys = p.shape === 'slot' ? null : out.Leff - 1.46 * dh / 2;
      wref = wb;
    } else if (out.type === 'pr') {
      const p = e.pr || {};
      const n = Math.max(1, p.n | 0 || 1);
      const Sdr = (+p.Sd || 200) * 1e-4, Mmp = (+p.Mmp || 100) * 1e-3, Cmp = (+p.Cmp || 0.5) * 1e-3;
      const Kmp = 1 / Cmp;
      out.Sr = n * Sdr; out.Mr = n * Mmp; out.Kr = n * Kmp;
      const wr = Math.sqrt(Kmp / Mmp);
      out.Rr = n * wr * Mmp / Math.max(1, +p.Qmp || 10);
      out.prXlim = (+p.xlim || 0) * 1e-3; out.prThr = +p.thr || 0.5; out.prShape = +p.shape || 2;
      out.nPR = n; out.Sdr = Sdr;
      wref = Math.sqrt((out.Kr + AIR.kappa * out.Sr * out.Sr / out.V0) / out.Mr);
      out.fp = wref / TWO_PI;
    } else { // sealed
      wref = Math.sqrt((cd.ts.Kms + AIR.kappa * cd.ts.Sd * cd.ts.Sd / out.V0) / cd.ts.Mms);
      out.fc = wref / TWO_PI;
    }
    const Ql = e.Ql;
    if (Ql && isFinite(+Ql) && +Ql > 0) out.Ral = (+Ql) / (wref * Cab);
    return out;
  }

  // ------------------------------------------------------------------ setup compile
  // setup: {ways:[{driver (object), count, enclosure, filters, gainDb, invert, delayMs, dT, Rs, drive}], space, distance}
  function compileSetup(setup) {
    const space = setup.space === 'full' ? 4 * Math.PI : 2 * Math.PI;
    const r = +setup.distance || 1;
    const ways = setup.ways.map((w) => {
      const cd = w.cdrv || compileDriver(w.driver);
      const enc = compileEnclosure(w.enclosure, cd);
      const secs = wayFilterSections(w);
      const g = Math.pow(10, (+w.gainDb || 0) / 20) * (w.invert ? -1 : 1);
      const ReHot = cd.ts.Re * (1 + ALPHA_R * (+w.dT || 0)), ReE = ReHot + (+w.Rs || 0);
      return { cd, enc, secs, g, n: Math.max(1, +w.count || 1), delay: Math.max(0, +w.delayMs || 0) * 1e-3, ReE, ReHot, drive: w.drive === 'current' ? 'current' : 'voltage', label: w.label || cd.label };
    });
    return { ways, K: AIR.rho / (space * r), space, r };
  }

  // ------------------------------------------------------------------ linear (small-signal) model
  // Response per 1 V RMS at the driver terminals (filters excluded). Returns complex RMS phasors.
  function linearWay(cw, f) {
    const cd = cw.cd, ts = cd.ts, e = cw.enc;
    const w = TWO_PI * f, s = cx(0, w);
    let Ze = cadd(cx(cw.ReE), cscale(s, ts.Le));
    if (ts.L2 > 0 && ts.R2 > 0) Ze = cadd(Ze, cdiv(cscale(s, ts.L2 * ts.R2), cadd(cx(ts.R2), cscale(s, ts.L2))));
    let Zm = cadd(cadd(cx(ts.Rms), cscale(s, ts.Mms)), cdiv(cx(ts.Kms), s));
    let Y = null, Zp = null, Zr = null;
    if (e.type !== 'ib') {
      Y = cscale(s, e.V0 / AIR.kappa);
      if (e.Ral) Y = cadd(Y, cx(1 / e.Ral));
      if (e.type === 'vented') { Zp = cscale(cadd(cscale(s, e.Map), cx(e.Rp)), 1 / (e.Sp * e.Sp)); Y = cadd(Y, cinv(Zp)); }
      if (e.type === 'pr') { Zr = cscale(cadd(cadd(cscale(s, e.Mr), cx(e.Rr)), cdiv(cx(e.Kr), s)), 1 / (e.Sr * e.Sr)); Y = cadd(Y, cinv(Zr)); }
      Zm = cadd(Zm, cdiv(cx(ts.Sd * ts.Sd), Y));
    }
    let i;
    if (cw.drive === 'current') i = cx(1 / ts.Re);
    else i = cdiv(cx(1), cadd(Ze, cdiv(cx(ts.Bl * ts.Bl), Zm)));
    const v = cdiv(cscale(i, ts.Bl), Zm);
    const x = cdiv(v, s);
    const Uc = cscale(v, ts.Sd);
    let Up = cx(0), Ur = cx(0), pb = cx(0);
    if (Y) { pb = cscale(cdiv(Uc, Y), -1); if (Zp) Up = cdiv(pb, Zp); if (Zr) Ur = cdiv(pb, Zr); }
    const Ut = cadd(cadd(Uc, Up), Ur);
    const Zin = cw.drive === 'current' ? cx(NaN) : cdiv(cx(1), i);
    return { i, v, x, Uc, Up, Ur, Ut, pb, Zin, vp: e.Sp ? cscale(Up, 1 / e.Sp) : cx(0), xr: e.Sr ? cdiv(Ur, cscale(s, e.Sr)) : cx(0) };
  }
  // Total response per 1 V RMS at the setup input, including filters. fsDigital: use digital filter response.
  function linearSetup(cs, f, fsDigital) {
    const s = cx(0, TWO_PI * f);
    let p = cx(0); const ways = [];
    for (const cw of cs.ways) {
      let H = fsDigital ? digitalResponse(cw.sos || cw.secs.map((q) => bilinear(q, fsDigital)), f, fsDigital) : analogResponse(cw.secs, f);
      H = cscale(H, cw.g);
      if (cw.delay) H = cmul(H, cexpj(-TWO_PI * f * cw.delay));
      const lw = linearWay(cw, f);
      const pw = cscale(cmul(cmul(s, lw.Ut), H), cs.K * cw.n); // p = ρ/(Ω r)·jω·U
      p = cadd(p, pw);
      ways.push({ H, lw, p: pw, u: H });
    }
    return { p, ways };
  }
  function linearCurves(setup, freqs) {
    const cs = compileSetup(setup);
    const out = { f: freqs, spl: [], phase: [], ways: cs.ways.map(() => ({ spl: [], zmag: [], zph: [], xmm: [], vport: [], xpr: [], volt: [] })) };
    for (const f of freqs) {
      const r = linearSetup(cs, f, 0);
      out.spl.push(splOf(cabs(r.p))); out.phase.push(Math.atan2(r.p.im, r.p.re) * 180 / Math.PI);
      r.ways.forEach((w, k) => {
        const o = out.ways[k];
        o.spl.push(splOf(cabs(w.p)));
        o.zmag.push(cabs(w.lw.Zin)); o.zph.push(Math.atan2(w.lw.Zin.im, w.lw.Zin.re) * 180 / Math.PI);
        o.xmm.push(cabs(cmul(w.lw.x, w.u)) * Math.SQRT2 * 1e3); // peak mm per 1 V RMS input
        o.vport.push(cabs(cmul(w.lw.vp, w.u)) * Math.SQRT2); // peak m/s per 1 V RMS
        o.xpr.push(cabs(cmul(w.lw.xr, w.u)) * Math.SQRT2 * 1e3);
        o.volt.push(cabs(w.u));
      });
    }
    return out;
  }

  // ------------------------------------------------------------------ time-domain simulation
  const NL_ALL = { bl: true, kms: true, le: true, doppler: true, air: true, port: true, pr: true };
  const NL_NONE = { bl: false, kms: false, le: false, doppler: false, air: false, port: false, pr: false };

  function chooseFs(cs, fMax) {
    let lam = 0;
    for (const cw of cs.ways) {
      const ts = cw.cd.ts, mL = Math.max(0.2, cw.cd.minL);
      let l = 0;
      if (cw.drive === 'voltage' && ts.Le > 1e-7) l += (cw.ReE + ts.R2) / (ts.Le * mL);
      if (ts.L2 > 1e-7 && ts.R2 > 0) l += ts.R2 / (ts.L2 * mL);
      lam = Math.max(lam, l);
    }
    const need = Math.max(96000, lam / 0.75, 12 * (fMax || 0));
    let fs = 48000; while (fs < need) fs += 48000;
    return Math.min(fs, 960000);
  }

  // One driver in its enclosure, integrated with classic RK4 on half-step input samples.
  function WaySim(cw, flags, fs, K) {
    const cd = cw.cd, ts = cd.ts, e = cw.enc, T = cd.tab;
    this.cw = cw; this.fs = fs; this.h = 1 / fs;
    this.sos = cw.secs.map((q) => bilinear(q, 2 * fs));
    this.fz = this.sos.map(() => [0, 0]);
    const dly = Math.round(cw.delay * 2 * fs); this.dline = new Float64Array(dly + 1); this.dpos = 0; this.dly = dly;
    this.y = new Float64Array(9); this.k1 = new Float64Array(9); this.k2 = new Float64Array(9); this.k3 = new Float64Array(9); this.k4 = new Float64Array(9); this.yt = new Float64Array(9);
    this.lastU = null;
    const nlBl = !!flags.bl && !!cd.curves.bl, nlK = !!flags.kms && !!cd.curves.kms, nlL = !!flags.le && !!cd.curves.le;
    const nlAir = !!flags.air && e.type !== 'ib', nlPort = !!flags.port && e.type === 'vented' && e.xi > 0, nlPR = !!flags.pr && e.type === 'pr' && e.prXlim > 0;
    this.doppler = !!flags.doppler;
    const X0 = T.x0, INV = T.inv, NT2 = T.n - 2, tBl = T.Bl, tF = T.F, tL = T.L, tdL = T.dL;
    const Bl0 = ts.Bl, K0 = ts.Kms, Le0 = ts.Le, L20 = ts.L2, R20 = ts.R2, Mms = ts.Mms, Rms = ts.Rms, Sd = ts.Sd;
    const ReE = cw.ReE, ReCold = ts.Re, current = cw.drive === 'current', hasLe = Le0 > 1e-7, hasL2 = L20 > 1e-7 && R20 > 0;
    const box = e.type !== 'ib', V0 = e.V0, P0 = AIR.P0, G = AIR.gamma, KAP = AIR.kappa;
    const Sp = e.Sp, Map = e.Map, Rp = e.Rp, dragC = 0.5 * AIR.rho * e.xi * e.Sp, vc = e.vc, vw = e.vw;
    const Sr = e.Sr, Mr = e.Mr, Kr = e.Kr, Rr = e.Rr, prX = e.prXlim, prThr = e.prThr, prP = e.prShape;
    const hasLeak = !!e.Ral, invRal = e.Ral ? 1 / e.Ral : 0;
    const self = this;
    this.iOut = 0;
    // pr stiffness factor: Kr(x) = Kr / thr^{|x/X|^p} (compliance falls to thr at X)
    const lnThr = Math.log(prThr);
    this.deriv = function (u, y, d) {
      let i = y[0]; const i2 = y[1], x = y[2], v = y[3], vp = y[5], xr = y[6], vr = y[7], z = y[8];
      let Bl = Bl0, Fk = K0 * x, Lr = 1, dLr = 0;
      if (nlBl || nlK || nlL) {
        const fi = (x - X0) * INV; let k = Math.floor(fi); if (k < 0) k = 0; else if (k > NT2) k = NT2; const fr = fi - k;
        if (nlBl) Bl = tBl[k] + fr * (tBl[k + 1] - tBl[k]);
        if (nlK) Fk = tF[k] + fr * (tF[k + 1] - tF[k]);
        if (nlL) { Lr = tL[k] + fr * (tL[k + 1] - tL[k]); dLr = tdL[k] + fr * (tdL[k + 1] - tdL[k]); }
      }
      const Le = Le0 * Lr, dLe = Le0 * dLr;
      let u2 = 0, fRel = 0;
      if (hasL2) {
        const L2x = L20 * Lr, R2x = R20 * Lr, dL2 = L20 * dLr;
        if (current) { i = u / ReCold; }
        else if (!hasLe) { i = (u - Bl * v + R2x * i2) / (ReE + R2x); }
        u2 = R2x * (i - i2);
        d[1] = (u2 - dL2 * v * i2) / L2x;
        fRel = 0.5 * i2 * i2 * dL2;
      } else {
        d[1] = 0;
        if (current) i = u / ReCold; else if (!hasLe) i = (u - Bl * v) / ReE;
      }
      if (!current && hasLe) d[0] = (u - ReE * i - dLe * v * i - u2 - Bl * v) / Le; else d[0] = 0;
      fRel += 0.5 * i * i * dLe;
      self.iOut = i;
      let pb = 0;
      if (box) {
        const dV = Sd * x + Sp * y[4] + Sr * xr;
        if (nlAir) pb = P0 * (Math.pow((V0 - z) / (V0 + dV), G) - 1);
        else pb = -KAP * (dV + z) / V0;
      }
      d[2] = v;
      d[3] = (Bl * i - Rms * v - Fk + fRel + Sd * pb) / Mms;
      if (Sp > 0) {
        d[4] = vp;
        let drag = 0;
        if (nlPort) { const av = Math.abs(vp); const sw = 0.5 * (1 + Math.tanh((av - vc) / vw)); drag = dragC * vp * av * sw; }
        d[5] = (Sp * pb - Rp * vp - drag) / Map;
      } else { d[4] = 0; d[5] = 0; }
      if (Sr > 0) {
        d[6] = vr;
        let Fr = Kr * xr;
        if (nlPR) Fr = Kr * xr * Math.exp(-lnThr * Math.pow(Math.abs(xr / prX), prP));
        d[7] = (Sr * pb - Rr * vr - Fr) / Mr;
      } else { d[6] = 0; d[7] = 0; }
      d[8] = hasLeak ? pb * invRal : 0;
    };
    this.K = K * cw.n; this.Sd = Sd; this.Sp = Sp; this.Sr = Sr; this.current = current; this.hasLe = hasLe;
    // ring buffers for lagged output (Doppler needs a few future samples)
    this.D = Math.ceil(0.08 * fs / AIR.c) + 10;
    let rs = 1; while (rs < 2 * this.D + 16) rs <<= 1; this.RS = rs; this.RM = rs - 1;
    this.rA = new Float64Array(rs); this.rX = new Float64Array(rs); this.rP = new Float64Array(rs); this.rI = new Float64Array(rs); this.rVp = new Float64Array(rs); this.rXr = new Float64Array(rs);
    this.step = 0; this.maxAbsX = 0; this.c = AIR.c;
  }
  WaySim.prototype.filterSample = function (u) {
    // gain, filters, delay at the half-step rate
    let v = u * this.cw.g;
    const sos = this.sos, fz = this.fz;
    for (let j = 0; j < sos.length; j++) {
      const q = sos[j], zz = fz[j];
      const out = q.b0 * v + zz[0];
      zz[0] = q.b1 * v - q.a1 * out + zz[1];
      zz[1] = q.b2 * v - q.a2 * out;
      v = out;
    }
    if (this.dly) { const L = this.dline.length; this.dline[this.dpos] = v; this.dpos = (this.dpos + 1) % L; v = this.dline[this.dpos]; }
    return v;
  };
  // raw: input samples at half steps for this chunk: raw[0..2n-1] = half-step indices (2s+1 .. 2s+2n); raw0 = sample at index 0 (first call only)
  // out: {p: Float64Array(n) accumulate, x, i, vp, xr: Float64Array(n) or null}; outputs are lagged by D steps
  WaySim.prototype.advance = function (raw, n, out, raw0) {
    const h = this.h, y = this.y, k1 = this.k1, k2 = this.k2, k3 = this.k3, k4 = this.k4, yt = this.yt, deriv = this.deriv;
    if (this.lastU === null) this.lastU = this.filterSample(raw0 || 0);
    const F = this._F && this._F.length >= 2 * n ? this._F : (this._F = new Float64Array(2 * n));
    for (let j = 0; j < 2 * n; j++) F[j] = this.filterSample(raw[j]);
    const rA = this.rA, rX = this.rX, rP = this.rP, rI = this.rI, rVp = this.rVp, rXr = this.rXr, RM = this.RM, D = this.D;
    const K = this.K, Sd = this.Sd, Sp = this.Sp, Sr = this.Sr, fsc = this.fs / this.c, dop = this.doppler;
    const hasI = !this.current && this.hasLe;
    for (let j = 0; j < n; j++) {
      const u0 = j === 0 ? this.lastU : F[2 * j - 1], u1 = F[2 * j], u2 = F[2 * j + 1];
      deriv(u0, y, k1);
      const s = this.step, ri = s & RM;
      rA[ri] = k1[3]; rX[ri] = y[2]; rP[ri] = Sp * k1[5] + Sr * k1[7]; rI[ri] = hasI ? y[0] : this.iOut; rVp[ri] = y[5]; rXr[ri] = y[6];
      const ax = Math.abs(y[2]); if (ax > this.maxAbsX) this.maxAbsX = ax;
      for (let q = 0; q < 9; q++) yt[q] = y[q] + 0.5 * h * k1[q];
      deriv(u1, yt, k2);
      for (let q = 0; q < 9; q++) yt[q] = y[q] + 0.5 * h * k2[q];
      deriv(u1, yt, k3);
      for (let q = 0; q < 9; q++) yt[q] = y[q] + h * k3[q];
      deriv(u2, yt, k4);
      for (let q = 0; q < 9; q++) y[q] += h / 6 * (k1[q] + 2 * k2[q] + 2 * k3[q] + k4[q]);
      // lagged output
      const o = s - D;
      if (o >= 0) {
        const oi = o & RM; const xo = rX[oi];
        let ac;
        if (dop) {
          const t = o + xo * fsc; let m = Math.floor(t); const fr = t - m;
          if (m < 3) m = 3; if (m > s - 4) m = s - 4;
          // 8-point Lagrange interpolation, nodes m-3 .. m+4 (error far below the distortion floor)
          const d0 = fr + 3, d1 = fr + 2, d2 = fr + 1, d3 = fr, d4 = fr - 1, d5 = fr - 2, d6 = fr - 3, d7 = fr - 4;
          const p1 = d0, p2 = p1 * d1, p3 = p2 * d2, p4 = p3 * d3, p5 = p4 * d4, p6 = p5 * d5, p7 = p6 * d6;
          const s6 = d7, s5 = s6 * d6, s4 = s5 * d5, s3 = s4 * d4, s2 = s3 * d3, s1 = s2 * d2, s0 = s1 * d1;
          ac = rA[(m - 3) & RM] * (s0 * LW[0]) + rA[(m - 2) & RM] * (p1 * s1 * LW[1]) + rA[(m - 1) & RM] * (p2 * s2 * LW[2]) + rA[m & RM] * (p3 * s3 * LW[3])
            + rA[(m + 1) & RM] * (p4 * s4 * LW[4]) + rA[(m + 2) & RM] * (p5 * s5 * LW[5]) + rA[(m + 3) & RM] * (p6 * s6 * LW[6]) + rA[(m + 4) & RM] * (p7 * LW[7]);
        } else ac = rA[oi];
        out.p[j] += K * (Sd * ac + rP[oi]);
        if (out.x) out.x[j] = xo;
        if (out.i) out.i[j] = rI[oi];
        if (out.vp) out.vp[j] = rVp[oi];
        if (out.xr) out.xr[j] = rXr[oi];
      } else {
        if (out.x) out.x[j] = 0; if (out.i) out.i[j] = 0; if (out.vp) out.vp[j] = 0; if (out.xr) out.xr[j] = 0;
      }
      this.step++;
    }
    this.lastU = F[2 * n - 1];
  };

  // Setup simulator: all ways fed by one input signal generator.
  function SetupSim(cs, flags, fs, opt) {
    this.cs = cs; this.fs = fs; this.flags = flags;
    this.ways = cs.ways.map((cw) => new WaySim(cw, flags, fs, cs.K));
    this.D = Math.max(...this.ways.map((w) => w.D));
    // equalize lag so all ways align
    for (const w of this.ways) { w.extraLag = this.D - w.D; }
    this.half = 0; // next half-step index to generate
    this.rec = opt && opt.rec ? opt.rec : { x: true, i: true, vp: true, xr: true };
  }
  // gen(kStart, count, buf): fill buf[0..count-1] with the raw input at half-step indices kStart..
  SetupSim.prototype.run = function (gen, n) {
    const raw = new Float64Array(2 * n);
    let raw0 = 0;
    if (this.half === 0) { const b = new Float64Array(1); gen(0, 1, b); raw0 = b[0]; this.half = 1; }
    gen(this.half, 2 * n, raw);
    this.half += 2 * n;
    const out = { p: new Float64Array(n), ways: [] };
    for (const w of this.ways) {
      const o = { p: out.p, x: this.rec.x ? new Float64Array(n) : null, i: this.rec.i ? new Float64Array(n) : null, vp: this.rec.vp && w.Sp ? new Float64Array(n) : null, xr: this.rec.xr && w.Sr ? new Float64Array(n) : null };
      if (w.extraLag) { // shift via a small delay: run into temp then delay
        const tmp = { p: new Float64Array(n), x: o.x ? new Float64Array(n) : null, i: o.i ? new Float64Array(n) : null, vp: o.vp ? new Float64Array(n) : null, xr: o.xr ? new Float64Array(n) : null };
        w.advance(raw, n, tmp, raw0);
        if (!w.lagBuf) w.lagBuf = { p: new Float64Array(w.extraLag), x: new Float64Array(w.extraLag), i: new Float64Array(w.extraLag), vp: new Float64Array(w.extraLag), xr: new Float64Array(w.extraLag), pos: 0 };
        const L = w.extraLag, lb = w.lagBuf;
        for (let j = 0; j < n; j++) {
          const pos = lb.pos;
          const po = lb.p[pos]; lb.p[pos] = tmp.p[j]; out.p[j] += po;
          if (o.x) { o.x[j] = lb.x[pos]; lb.x[pos] = tmp.x[j]; }
          if (o.i) { o.i[j] = lb.i[pos]; lb.i[pos] = tmp.i[j]; }
          if (o.vp) { o.vp[j] = lb.vp[pos]; lb.vp[pos] = tmp.vp[j]; }
          if (o.xr) { o.xr[j] = lb.xr[pos]; lb.xr[pos] = tmp.xr[j]; }
          lb.pos = (pos + 1) % L;
        }
      } else w.advance(raw, n, o, raw0);
      out.ways.push(o);
    }
    return out;
  };

  // ------------------------------------------------------------------ signal generators
  function toneGen(tones, fsIn, ramp) { // tones: [{f, A (peak V), ph}], ramp: seconds (raised cosine)
    const nr = Math.max(1, Math.round(ramp * fsIn));
    return function (k0, cnt, buf) {
      for (let j = 0; j < cnt; j++) {
        const k = k0 + j, t = k / fsIn;
        let s = 0;
        for (let q = 0; q < tones.length; q++) { const tn = tones[q]; s += tn.A * Math.sin(TWO_PI * tn.f * t + (tn.ph || 0)); }
        if (k < nr) s *= 0.5 - 0.5 * Math.cos(Math.PI * k / nr);
        buf[j] = s;
      }
    };
  }
  // faster multitone generator using per-tone phasor recurrences re-anchored every block
  function multiToneGen(tones, fsIn, ramp) {
    const nr = Math.max(1, Math.round(ramp * fsIn));
    const T = tones.length, fr = new Float64Array(T), A = new Float64Array(T), ph = new Float64Array(T);
    for (let q = 0; q < T; q++) { fr[q] = TWO_PI * tones[q].f / fsIn; A[q] = tones[q].A; ph[q] = tones[q].ph || 0; }
    const cr = new Float64Array(T), ci = new Float64Array(T), wr = new Float64Array(T), wi = new Float64Array(T);
    for (let q = 0; q < T; q++) { wr[q] = Math.cos(fr[q]); wi[q] = Math.sin(fr[q]); }
    return function (k0, cnt, buf) {
      let j = 0;
      while (j < cnt) {
        const blk = Math.min(256, cnt - j), kb = k0 + j;
        for (let q = 0; q < T; q++) { const a = fr[q] * kb + ph[q]; cr[q] = Math.cos(a); ci[q] = Math.sin(a); }
        for (let b = 0; b < blk; b++) {
          let s = 0;
          for (let q = 0; q < T; q++) {
            s += A[q] * ci[q];
            const nr_ = cr[q] * wr[q] - ci[q] * wi[q]; ci[q] = cr[q] * wi[q] + ci[q] * wr[q]; cr[q] = nr_;
          }
          const k = kb + b;
          if (k < nr) s *= 0.5 - 0.5 * Math.cos(Math.PI * k / nr);
          buf[j + b] = s;
        }
        j += blk;
      }
    };
  }
  function arrayGen(arr) { // arr at the half-step rate
    return function (k0, cnt, buf) { for (let j = 0; j < cnt; j++) { const k = k0 + j; buf[j] = k < arr.length ? arr[k] : 0; } };
  }

  // ------------------------------------------------------------------ spectral analysis
  function dftBin(a, off, N, k) { // complex DFT coefficient scaled to peak amplitude
    const w = TWO_PI * k / N;
    let re = 0, im = 0; let cr = 1, ci = 0; const wr = Math.cos(w), wi = -Math.sin(w);
    for (let n = 0; n < N; n++) {
      if ((n & 1023) === 0) { cr = Math.cos(w * n); ci = -Math.sin(w * n); }
      const v = a[off + n]; re += v * cr; im += v * ci;
      const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
    }
    return { re: 2 * re / N, im: 2 * im / N };
  }
  function fft(re, im) { // in place, radix-2
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -TWO_PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let j = 0; j < len / 2; j++) {
          const a = i + j, b = a + len / 2;
          const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }
  function stats(arr, off, N) { let mn = Infinity, mx = -Infinity, s = 0, s2 = 0; for (let n = 0; n < N; n++) { const v = arr[off + n]; if (v < mn) mn = v; if (v > mx) mx = v; s += v; s2 += v * v; } return { min: mn, max: mx, mean: s / N, rms: Math.sqrt(s2 / N) }; }

  // ------------------------------------------------------------------ steady-state runner with convergence check
  // Runs until two consecutive analysis windows agree, then returns the last window of outputs.
  function steadyState(cs, flags, fs, gen, opt) {
    const sim = new SetupSim(cs, flags, fs, { rec: { x: true, i: true, vp: true, xr: true } });
    const N = opt.N; const settle = Math.max(0, Math.round(opt.settle * fs)) + sim.D;
    const probe = opt.probe; // array of bin indices to compare between windows
    // settle
    let left = settle;
    while (left > 0) { const m = Math.min(left, 65536); sim.run(gen, m); left -= m; }
    let prev = null, last = null, windows = 0;
    const maxW = opt.maxWindows || 5;
    while (windows < maxW) {
      last = sim.run(gen, N); windows++;
      const cur = probe.map((k) => dftBin(last.p, 0, N, k));
      if (prev) {
        const ref = cabs(cur[0]) || 1e-30; let ok = true;
        for (let q = 0; q < cur.length; q++) {
          const a = cabs(cur[q]), b = cabs(prev[q]);
          const tol = Math.max(ref * 3e-6, 0.003 * Math.max(a, b)); // 0.03 dB or −110 dB re fundamental
          if (Math.abs(a - b) > tol) { ok = false; break; }
        }
        if (ok) break;
      }
      prev = cur;
    }
    return { out: last, N, windows, maxAbsX: sim.ways.map((w) => w.maxAbsX) };
  }

  // ------------------------------------------------------------------ analyses
  function wayStats(out, cs, N) {
    return out.ways.map((o, k) => {
      const cw = cs.ways[k];
      const sx = o.x ? stats(o.x, 0, N) : null, si = o.i ? stats(o.i, 0, N) : null;
      const svp = o.vp ? stats(o.vp, 0, N) : null, sxr = o.xr ? stats(o.xr, 0, N) : null;
      const range = cw.cd.dataRange;
      const xpk = sx ? Math.max(Math.abs(sx.min), Math.abs(sx.max)) * 1e3 : 0;
      return {
        xpk, xdc: sx ? sx.mean * 1e3 : 0, xmin: sx ? sx.min * 1e3 : 0, xmax: sx ? sx.max * 1e3 : 0,
        irms: si ? si.rms : 0, pdiss: si ? si.rms * si.rms * cw.ReHot : 0, // heat in the voice coil at its set temperature
        vport: svp ? Math.max(Math.abs(svp.min), Math.abs(svp.max)) : 0,
        xpr: sxr ? Math.max(Math.abs(sxr.min), Math.abs(sxr.max)) * 1e3 : 0,
        outOfRange: sx ? (sx.min * 1e3 < range[0] || sx.max * 1e3 > range[1]) : false,
      };
    });
  }

  function mechanismsFor(cs) {
    const list = [];
    const any = (fn) => cs.ways.some(fn);
    if (any((w) => w.cd.curves.bl)) list.push('bl');
    if (any((w) => w.cd.curves.kms)) list.push('kms');
    if (any((w) => w.cd.curves.le)) list.push('le');
    list.push('doppler');
    if (any((w) => w.enc.type !== 'ib')) list.push('box');
    return list;
  }
  function flagsFor(mech) {
    if (mech === 'all') return NL_ALL;
    if (mech === 'none') return NL_NONE;
    const f = Object.assign({}, NL_NONE);
    if (mech === 'box') { f.air = true; f.port = true; f.pr = true; } else f[mech] = true;
    return f;
  }

  function levelVoltage(cs, fsIn, spec, f) {
    // spec: {mode:'spl'|'voltage'|'splref', value, fref}
    if (spec.mode === 'voltage') return +spec.value;
    const fr = spec.mode === 'splref' ? +spec.fref : f;
    const H = cabs(linearSetup(cs, fr, fsIn).p);
    return Math.pow(10, (spec.value - splOf(H)) / 20);
  }

  function hdPoint(cs, flags, fs, f, Vrms, H) {
    const fsIn = 2 * fs;
    const m = Math.max(4, Math.ceil(0.025 * f));
    const N = Math.round(m * fs / f); const fa = m * fs / N;
    const hasBox = cs.ways.some((w) => w.enc.type === 'vented' || w.enc.type === 'pr');
    const ramp = Math.max(0.01, 4 / fa);
    const settle = ramp + Math.max(0.15, 6 / fa) + (hasBox ? 0.25 : 0);
    const gen = toneGen([{ f: fa, A: Math.SQRT2 * Vrms, ph: 0 }], fsIn, ramp);
    const probe = [m]; for (let h = 2; h <= Math.min(H, 3); h++) probe.push(h * m);
    const r = steadyState(cs, flags, fs, gen, { N, settle, probe });
    const bins = []; for (let h = 1; h <= H; h++) bins.push(dftBin(r.out.p, 0, N, h * m));
    const P1 = cabs(bins[0]);
    const hd = bins.slice(1).map((b) => cabs(b) / P1);
    const thd = Math.sqrt(hd.reduce((s, v) => s + v * v, 0));
    return { f: fa, V: Vrms, spl: splOf(P1 / Math.SQRT2), hd, thd, ways: wayStats(r.out, cs, N), windows: r.windows };
  }

  function hdSweep(args, progress) {
    const res = [];
    const H = Math.max(2, Math.min(9, args.harmonics || 5));
    const freqs = args.freqs;
    const plan = args.setups.map((setup) => { const cs = compileSetup(setup); return { setup, cs, list: args.mechanisms ? mechanismsFor(cs) : [] }; });
    let done = 0; const total = plan.reduce((s, p) => s + freqs.length * (1 + p.list.length), 0);
    for (const { setup, cs, list } of plan) {
      const fs = args.fs || chooseFs(cs, Math.max(...freqs) * H / 4);
      const fsIn = 2 * fs;
      const r = { id: setup.id, fs, f: [], V: [], spl: [], splLin: [], hd: [], thd: [], ways: [], mech: {} };
      for (const mm of list) r.mech[mm] = { hd: [], thd: [] };
      for (const f of freqs) {
        const V = levelVoltage(cs, fsIn, args.level, f);
        const lin = splOf(cabs(linearSetup(cs, f, fsIn).p) * V);
        const pt = hdPoint(cs, NL_ALL, fs, f, V, H);
        r.f.push(pt.f); r.V.push(V); r.spl.push(pt.spl); r.splLin.push(lin); r.hd.push(pt.hd); r.thd.push(pt.thd); r.ways.push(pt.ways);
        done++; progress && progress(done / total, { stage: 'all', f });
        for (const mm of list) {
          const q = hdPoint(cs, flagsFor(mm), fs, f, V, H);
          r.mech[mm].hd.push(q.hd); r.mech[mm].thd.push(q.thd);
          done++; progress && progress(done / total, { stage: mm, f });
        }
      }
      res.push(r);
    }
    return res;
  }

  // two-tone intermodulation (IEC 60268 definitions for d2, d3)
  function imdPoint(cs, flags, fs, f1, f2, U1, U2, wantSpectrum) {
    const fsIn = 2 * fs;
    const df0 = f1 / 8; const N = Math.round(fs / df0); const df = fs / N;
    const k1 = Math.max(1, Math.round(f1 / df)), k2 = Math.max(k1 + 3, Math.round(f2 / df));
    const fa1 = k1 * df, fa2 = k2 * df;
    const hasBox = cs.ways.some((w) => w.enc.type === 'vented' || w.enc.type === 'pr');
    const ramp = Math.max(0.02, 4 / fa1);
    const settle = ramp + Math.max(0.2, 6 / fa1) + (hasBox ? 0.25 : 0);
    const gen = toneGen([{ f: fa1, A: Math.SQRT2 * U1 }, { f: fa2, A: Math.SQRT2 * U2, ph: 0.37 }], fsIn, ramp);
    const r = steadyState(cs, flags, fs, gen, { N, settle, probe: [k2, k2 - k1, k2 + k1, k1] });
    const P = (k) => (k > 0 && k < N / 2 ? cabs(dftBin(r.out.p, 0, N, k)) : 0);
    const p1 = P(k1), p2 = P(k2);
    const comp = {
      f1: p1, f2: p2, h2f1: P(2 * k1), h3f1: P(3 * k1), h2f2: P(2 * k2), h3f2: P(3 * k2),
      m1: P(k2 - k1), p1_: P(k2 + k1), m2: P(k2 - 2 * k1), p2_: P(k2 + 2 * k1), m3: P(k2 - 3 * k1), p3_: P(k2 + 3 * k1),
    };
    const d2 = (comp.m1 + comp.p1_) / p2, d3 = (comp.m2 + comp.p2_) / p2;
    const res = { f1: fa1, f2: fa2, U1, U2, spl1: splOf(p1 / Math.SQRT2), spl2: splOf(p2 / Math.SQRT2), d2, d3, comp, ways: wayStats(r.out, cs, N) };
    if (wantSpectrum) res.spectrum = spectrumOf(r.out.p, N, fs, Math.min(fs / 2, Math.max(4 * fa2, fa2 + 6 * fa1)));
    return res;
  }
  function spectrumOf(p, N, fs, fmax) {
    // the window holds an exact number of periods, so a direct DFT on its own bins is leakage-free
    const df = fs / N;
    const K = Math.min(Math.floor(fmax / df), Math.floor(N / 2) - 1, 6000);
    const mag = new Array(K + 1); mag[0] = -200;
    for (let k = 1; k <= K; k++) mag[k] = splOf(cabs(dftBin(p, 0, N, k)) / Math.SQRT2);
    return { df, mag };
  }

  function imdSweep(args, progress) {
    const res = [];
    const pts = args.points; // [{f1, f2, level:{ref:'f1'|'f2'|'voltage', value}, ratioDb}]
    const plan = args.setups.map((setup) => { const cs = compileSetup(setup); return { setup, cs, list: args.mechanisms ? mechanismsFor(cs) : [] }; });
    let done = 0; const total = plan.reduce((s, p) => s + pts.length * (1 + p.list.length), 0);
    for (const { setup, cs, list } of plan) {
      const fmax = Math.max(...pts.map((p) => p.f2 + 3 * p.f1));
      const fs = args.fs || chooseFs(cs, fmax);
      const fsIn = 2 * fs;
      const r = { id: setup.id, fs, points: [], mech: {} };
      for (const mm of list) r.mech[mm] = [];
      pts.forEach((pt, idx) => {
        const ratio = Math.pow(10, (pt.ratioDb || 0) / 20);
        let U1, U2;
        if (pt.level.ref === 'voltage') { U1 = +pt.level.value; U2 = U1 / ratio; }
        else if (pt.level.ref === 'f1') { U1 = Math.pow(10, (pt.level.value - splOf(cabs(linearSetup(cs, pt.f1, fsIn).p))) / 20); U2 = U1 / ratio; }
        else { U2 = Math.pow(10, (pt.level.value - splOf(cabs(linearSetup(cs, pt.f2, fsIn).p))) / 20); U1 = U2 * ratio; }
        const q = imdPoint(cs, NL_ALL, fs, pt.f1, pt.f2, U1, U2, idx === (args.spectrumIndex != null ? args.spectrumIndex : pts.length - 1));
        r.points.push(q); done++; progress && progress(done / total, { stage: 'all' });
        for (const mm of list) {
          const z = imdPoint(cs, flagsFor(mm), fs, pt.f1, pt.f2, U1, U2, false);
          r.mech[mm].push({ d2: z.d2, d3: z.d3 }); done++; progress && progress(done / total, { stage: mm });
        }
      });
      res.push(r);
    }
    return res;
  }

  // multitone: log-spaced tones on odd FFT bins, Schroeder phases, equal amplitude per tone (equal power per octave)
  function multitone(args, progress) {
    const res = [];
    const plan = args.setups.map((setup) => { const cs = compileSetup(setup); return { setup, cs, list: args.mechanisms ? mechanismsFor(cs) : [] }; });
    let done = 0; const total = plan.reduce((s, p) => s + 1 + p.list.length, 0);
    for (const { setup, cs, list } of plan) {
      const fs = args.fs || chooseFs(cs, Math.min(args.fHi * 3, 30000));
      const fsIn = 2 * fs;
      const freqs = fracOctaveFreqs(args.fLo, args.fHi, args.perOct || 6);
      // tones sit on odd bins, 2·df apart; keep that spacing well below the closest tone spacing (at the lowest tone)
      // so rounding to a free odd bin does not push the lowest tones off their log-spaced positions
      const gap = freqs.length > 1 ? freqs[1] - freqs[0] : args.fLo;
      let N = 1; while (fs / N > Math.min(args.fLo / 10, gap / 4)) N <<= 1;
      const df = fs / N;
      const bins = []; const used = new Set();
      for (const f of freqs) { let k = Math.round(f / df); if (k % 2 === 0) k += 1; while (used.has(k)) k += 2; used.add(k); bins.push(k); }
      const J = bins.length;
      const tones = bins.map((k, j) => ({ f: k * df, A: 1, ph: -Math.PI * j * (j - 1) / J }));
      // level: RMS of the linear output = target
      let p2 = 0; for (const t of tones) { const H = cabs(linearSetup(cs, t.f, fsIn).p); p2 += 0.5 * H * H; }
      const scale = Math.pow(10, (args.level - splOf(Math.sqrt(p2))) / 20);
      for (const t of tones) t.A = scale;
      const run = (flags) => {
        const gen = multiToneGen(tones, fsIn, Math.max(0.05, 8 / args.fLo));
        const hasBox = cs.ways.some((w) => w.enc.type === 'vented' || w.enc.type === 'pr');
        const r = steadyState(cs, flags, fs, gen, { N, settle: Math.max(0.3, 10 / args.fLo) + (hasBox ? 0.3 : 0), probe: [bins[0], bins[Math.floor(J / 2)], bins[J - 1]], maxWindows: 3 });
        const re = new Float64Array(N), im = new Float64Array(N);
        for (let n = 0; n < N; n++) re[n] = r.out.p[n];
        fft(re, im);
        const pw = new Float64Array(N / 2); for (let k = 0; k < N / 2; k++) pw[k] = (re[k] * re[k] + im[k] * im[k]) * 2 / (N * N); // mean-square (Pa²) per bin
        return { pw, ways: wayStats(r.out, cs, N) };
      };
      const analyze = (pw) => {
        const isTone = new Uint8Array(N / 2); for (const k of bins) isTone[k] = 1;
        // third-octave bands
        const bands = []; const fc0 = 1000 * Math.pow(2, Math.floor(Math.log2(args.fLo / 1000) * 3) / 3);
        for (let fc = fc0; fc <= args.fHi * 1.0001; fc *= Math.pow(2, 1 / 3)) {
          const lo = fc / Math.pow(2, 1 / 6), hi = fc * Math.pow(2, 1 / 6);
          let t = 0, d = 0; const klo = Math.max(1, Math.ceil(lo / df)), khi = Math.min(N / 2 - 1, Math.floor(hi / df));
          for (let k = klo; k <= khi; k++) { if (isTone[k]) t += pw[k]; else d += pw[k]; }
          if (t > 0) bands.push({ fc, ratioDb: 10 * Math.log10(Math.max(d, 1e-300) / t), toneDb: 10 * Math.log10(t / (PREF * PREF)), distDb: 10 * Math.log10(Math.max(d, 1e-300) / (PREF * PREF)) });
        }
        let tt = 0, dd = 0; const kLo = Math.max(1, Math.floor(args.fLo / 2 / df)), kHi = Math.min(N / 2 - 1, Math.ceil(args.fHi * 1.1 / df));
        for (let k = kLo; k <= kHi; k++) { if (isTone[k]) tt += pw[k]; else dd += pw[k]; }
        // compact spectrum for display: tones exactly, distortion as max per 1/24 octave
        const tonesOut = bins.map((k) => ({ f: k * df, db: 10 * Math.log10(pw[k] / (PREF * PREF)) }));
        const dist = []; const fTop = Math.min(fs / 2 * 0.9, args.fHi * 4);
        for (let f0 = Math.max(df * 2, args.fLo / 4); f0 < fTop; f0 *= Math.pow(2, 1 / 24)) {
          const k0 = Math.ceil(f0 / df), k1 = Math.min(N / 2 - 1, Math.floor(f0 * Math.pow(2, 1 / 24) / df));
          let mx = 0, sum = 0, cnt = 0; for (let k = k0; k <= k1; k++) if (!isTone[k]) { mx = Math.max(mx, pw[k]); sum += pw[k]; cnt++; }
          if (cnt) dist.push({ f: f0 * Math.pow(2, 1 / 48), maxDb: 10 * Math.log10(Math.max(mx, 1e-300) / (PREF * PREF)), meanDb: 10 * Math.log10(Math.max(sum / cnt, 1e-300) / (PREF * PREF)) });
        }
        return { bands, totalDb: 10 * Math.log10(Math.max(dd, 1e-300) / tt), tones: tonesOut, dist };
      };
      const all = run(NL_ALL); done++; progress && progress(done / total, { stage: 'all' });
      const r = Object.assign({ id: setup.id, fs, df, N, nTones: J }, analyze(all.pw), { ways: all.ways, mech: {} });
      if (list.length) for (const mm of list) { const q = run(flagsFor(mm)); const a = analyze(q.pw); r.mech[mm] = { bands: a.bands, totalDb: a.totalDb }; done++; progress && progress(done / total, { stage: mm }); }
      res.push(r);
    }
    return res;
  }

  // maximum SPL: largest fundamental level with no criterion exceeded.
  // Each trial level returns a margin in dB (the smallest distance to any limit); a secant search on the
  // margin converges in a handful of simulations, and only levels that pass every criterion are kept.
  function maxSpl(args, progress) {
    const res = []; const crit = args.criteria || {};
    let done = 0; const total = args.setups.length * args.freqs.length;
    for (const setup of args.setups) {
      const cs = compileSetup(setup);
      const fs = args.fs || chooseFs(cs, Math.max(...args.freqs) * 2);
      const fsIn = 2 * fs;
      const lo = args.lo || 50, hi = args.hi || 140;
      const r = { id: setup.id, fs, f: [], spl: [], limit: [], splAt: [], details: [] };
      for (const f of args.freqs) {
        const lin = linearSetup(cs, f, fsIn); const splPerV = splOf(cabs(lin.p));
        const evalL = (L) => {
          const V = Math.pow(10, (L - splPerV) / 20);
          const ms = [];
          if (crit.vmax) ms.push([20 * Math.log10(crit.vmax / V), 'amplifier voltage']);
          const pt = hdPoint(cs, NL_ALL, fs, f, Math.min(V, crit.vmax ? crit.vmax * 1.2 : V), 5);
          if (crit.thd) ms.push([20 * Math.log10(crit.thd / 100 / Math.max(pt.thd, 1e-12)), 'THD']);
          if (crit.hd3) ms.push([20 * Math.log10(crit.hd3 / 100 / Math.max(pt.hd[1], 1e-12)), 'HD3']);
          if (crit.comp) ms.push([crit.comp - (L - pt.spl), 'compression']);
          pt.ways.forEach((w, k) => {
            const xl = crit.xlim && crit.xlim[k]; if (xl) ms.push([20 * Math.log10(xl / Math.max(w.xpk, 1e-9)), 'excursion']);
            if (crit.vport && w.vport > 0) ms.push([20 * Math.log10(crit.vport / w.vport), 'port air speed']);
            const pe = crit.power && crit.power[k]; if (pe) ms.push([10 * Math.log10(pe / Math.max(w.pdiss, 1e-12)), 'power']);
            const pr = crit.prx && crit.prx[k]; if (pr && w.xpr > 0) ms.push([20 * Math.log10(pr / w.xpr), 'radiator excursion']);
          });
          ms.sort((a, b) => a[0] - b[0]);
          return { L, V, m: ms.length ? ms[0][0] : Infinity, why: ms.length ? ms[0][1] : 'none', pt };
        };
        // first guess from the linear excursion when an excursion limit exists, otherwise 95 dB
        let L = 95;
        if (crit.xlim) {
          let vx = Infinity;
          lin.ways.forEach((w, k) => { const xl = crit.xlim[k]; if (!xl) return; const xpv = cabs(cmul(w.lw.x, w.H)) * Math.SQRT2 * 1e3; if (xpv > 0) vx = Math.min(vx, xl / xpv); });
          if (isFinite(vx)) L = splPerV + 20 * Math.log10(vx) - 1;
        }
        L = Math.max(lo, Math.min(hi, L));
        let cur = evalL(L), prev = null, best = null;
        for (let it = 0; it < 12; it++) {
          if (cur.m >= 0 && (!best || cur.L > best.L)) best = cur;
          if (cur.m >= 0 && cur.m < 0.1) break;
          if (cur.m === Infinity) { best = cur; break; }
          let Ln;
          if (!prev || Math.abs(cur.m - prev.m) < 1e-6) Ln = cur.L + Math.max(-24, Math.min(24, cur.m * 0.9));
          else { const slope = (cur.m - prev.m) / (cur.L - prev.L); Ln = slope < -0.05 ? cur.L - cur.m / slope : cur.L + Math.max(-24, Math.min(24, cur.m * 0.9)); }
          if (cur.m < 0) Ln = Math.min(Ln, cur.L - 0.05); // never step up from a failing level
          if (best && Ln <= best.L) Ln = best.L + Math.max(0.05, (cur.L - best.L) / 2);
          Ln = Math.max(lo, Math.min(hi, Ln));
          if (Math.abs(Ln - cur.L) < 0.03) break;
          prev = cur; cur = evalL(Ln);
          if (cur.L <= lo + 1e-9 && cur.m < 0) break;
          if (cur.L >= hi - 1e-9 && cur.m >= 0) { best = cur; break; }
        }
        r.f.push(f);
        if (!best) { r.spl.push(null); r.limit.push(cur.why + ' below ' + lo + ' dB'); r.splAt.push(lo); r.details.push(null); }
        else {
          r.spl.push(best.pt.spl); r.splAt.push(best.L);
          r.limit.push(best.L >= hi - 1e-6 ? 'none up to ' + hi + ' dB' : (cur.m < 0 ? cur.why : best.why));
          r.details.push({ thd: best.pt.thd, hd: best.pt.hd, ways: best.pt.ways, V: best.V, margin: best.m });
        }
        done++; progress && progress(done / total, { f });
      }
      res.push(r);
    }
    return res;
  }

  // waveform view: a few periods of steady state for one tone
  function waveform(args) {
    const cs = compileSetup(args.setup);
    const fs = chooseFs(cs, args.f * 10);
    const fsIn = 2 * fs;
    const V = levelVoltage(cs, fsIn, args.level, args.f);
    const out = {};
    for (const mode of ['all', 'none']) {
      const m = 4; const N = Math.round(m * fs / args.f); const fa = m * fs / N;
      const hasBox = cs.ways.some((w) => w.enc.type === 'vented' || w.enc.type === 'pr');
      const ramp = Math.max(0.01, 4 / fa);
      const gen = toneGen([{ f: fa, A: Math.SQRT2 * V }], fsIn, ramp);
      const r = steadyState(cs, flagsFor(mode), fs, gen, { N, settle: ramp + Math.max(0.15, 6 / fa) + (hasBox ? 0.25 : 0), probe: [m, 2 * m, 3 * m] });
      const step = Math.max(1, Math.floor(N / 800));
      const pick = (a) => { const o = []; for (let n = 0; n < N; n += step) o.push(a[n]); return o; };
      out[mode] = { t: pick(Float64Array.from({ length: N }, (_, n) => n / fs)), p: pick(r.out.p), ways: r.out.ways.map((w) => ({ x: w.x ? pick(w.x).map((v) => v * 1e3) : null, i: w.i ? pick(w.i) : null, vp: w.vp ? pick(w.vp) : null })) };
      out.f = fa; out.V = V;
    }
    return out;
  }

  // ------------------------------------------------------------------ audio (listening mode)
  function kaiserBessel0(x) { let s = 1, t = 1; for (let k = 1; k < 30; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; } return s; }
  function designLowpass(taps, fc, beta) { // fc normalized to sample rate (cycles/sample)
    const h = new Float64Array(taps), M = taps - 1, I0b = kaiserBessel0(beta); let sum = 0;
    for (let n = 0; n < taps; n++) {
      const m = n - M / 2; const sinc = m === 0 ? 2 * fc : Math.sin(TWO_PI * fc * m) / (Math.PI * m);
      const w = kaiserBessel0(beta * Math.sqrt(1 - Math.pow(2 * n / M - 1, 2))) / I0b;
      h[n] = sinc * w; sum += h[n];
    }
    for (let n = 0; n < taps; n++) h[n] /= sum;
    return h;
  }
  function upsample(x, L) { // integer factor, Kaiser windowed-sinc, returns length x.length*L, group delay compensated
    const tpp = 24; const taps = tpp * L + 1; const h = designLowpass(taps, 0.45 / L, 8);
    const out = new Float32Array(x.length * L); const D = (taps - 1) / 2;
    for (let m = 0; m < out.length; m++) {
      // y[m] = L * Σ_k x[k] h[m + D - k L]
      let s = 0; const c = m + D; const kmin = Math.max(0, Math.ceil((c - (taps - 1)) / L)), kmax = Math.min(x.length - 1, Math.floor(c / L));
      for (let k = kmin; k <= kmax; k++) s += x[k] * h[c - k * L];
      out[m] = s * L;
    }
    return out;
  }
  function decimate(x, M, outLen) {
    const tpp = 24; const taps = tpp * M + 1; const h = designLowpass(taps, 0.45 / M, 8); const D = (taps - 1) / 2;
    const out = new Float32Array(outLen);
    for (let n = 0; n < outLen; n++) {
      const c = n * M + D; let s = 0; const k0 = Math.max(0, c - taps + 1), k1 = Math.min(x.length - 1, c);
      for (let k = k0; k <= k1; k++) s += x[k] * h[c - k];
      out[n] = s;
    }
    return out;
  }
  function auralize(args, progress) {
    const cs = compileSetup(args.setup);
    const fa = args.fsAudio; const M = Math.max(2, Math.ceil(chooseFs(cs, 16000) / fa)); const fs = M * fa; const fsIn = 2 * fs;
    const chans = args.channels; const nA = chans[0].length;
    // level from the linear response of the mono sum (RMS of linear output)
    const nOut = nA;
    const res = { fs: fa, M, channels: [], stats: {} };
    // first pass: linear run with unit gain to get RMS
    const runOne = (sig, flags, gain, onProg) => {
      const up = upsample(sig, 2 * M); if (gain !== 1) for (let n = 0; n < up.length; n++) up[n] *= gain;
      const sim = new SetupSim(cs, flags, fs, { rec: { x: true, i: false, vp: true, xr: true } });
      const total = nA * M + sim.D + 64; const pOut = new Float64Array(total);
      const xpk = cs.ways.map(() => 0), xsum = cs.ways.map(() => 0), vpk = cs.ways.map(() => 0), xrpk = cs.ways.map(() => 0);
      const gen = arrayGen(up); let pos = 0; const CH = 32768;
      while (pos < total) {
        const n = Math.min(CH, total - pos); const o = sim.run(gen, n);
        pOut.set(o.p, pos);
        o.ways.forEach((w, k) => { if (w.x) for (let j = 0; j < n; j++) { const a = Math.abs(w.x[j]); if (a > xpk[k]) xpk[k] = a; xsum[k] += w.x[j]; } if (w.vp) for (let j = 0; j < n; j++) { const a = Math.abs(w.vp[j]); if (a > vpk[k]) vpk[k] = a; } if (w.xr) for (let j = 0; j < n; j++) { const a = Math.abs(w.xr[j]); if (a > xrpk[k]) xrpk[k] = a; } });
        pos += n; onProg && onProg(pos / total);
      }
      // remove the fixed simulator lag D before decimating
      const shifted = pOut.subarray(sim.D);
      const y = decimate(shifted, M, nOut);
      return { y, xpk: xpk.map((v) => v * 1e3), xdc: xsum.map((v) => v / total * 1e3), vpk, xrpk: xrpk.map((v) => v * 1e3) };
    };
    // calibrate: linear run on mono sum at unit gain
    const mono = new Float64Array(nA); for (const c of chans) for (let n = 0; n < nA; n++) mono[n] += c[n] / chans.length;
    const nTot = chans.length * 2 + 1; let step = 0;
    const cal = runOne(mono, NL_NONE, 1, (p) => progress && progress((step + p) / nTot, { stage: 'calibrating level' })); step++;
    let s2 = 0; for (let n = 0; n < nA; n++) s2 += cal.y[n] * cal.y[n];
    const rms = Math.sqrt(s2 / nA) || 1e-12;
    const gain = Math.pow(10, (args.level - splOf(rms)) / 20);
    res.gain = gain;
    chans.forEach((c, ci) => {
      const lin = runOne(c, NL_NONE, gain, (p) => progress && progress((step + p) / nTot, { stage: 'linear model, channel ' + (ci + 1) })); step++;
      const nl = runOne(c, NL_ALL, gain, (p) => progress && progress((step + p) / nTot, { stage: 'nonlinear model, channel ' + (ci + 1) })); step++;
      const resid = new Float32Array(nA); for (let n = 0; n < nA; n++) resid[n] = nl.y[n] - lin.y[n];
      res.channels.push({ lin: lin.y, nl: nl.y, resid, xpk: nl.xpk, xdc: nl.xdc, vpk: nl.vpk, xrpk: nl.xrpk, xpkLin: lin.xpk });
    });
    // stats: short-term residual ratio (100 ms)
    const win = Math.round(0.1 * fa); const ratio = []; const lev = [];
    for (let s = 0; s + win <= nA; s += win) {
      let a = 0, b = 0; for (const ch of res.channels) for (let n = s; n < s + win; n++) { a += ch.resid[n] * ch.resid[n]; b += ch.lin[n] * ch.lin[n]; }
      ratio.push(b > 0 ? 10 * Math.log10(Math.max(a, 1e-30) / b) : -200); lev.push(splOf(Math.sqrt(b / (win * res.channels.length))));
    }
    let A = 0, B = 0, pk = 0; for (const ch of res.channels) for (let n = 0; n < nA; n++) { A += ch.resid[n] * ch.resid[n]; B += ch.lin[n] * ch.lin[n]; pk = Math.max(pk, Math.abs(ch.nl[n]), Math.abs(ch.lin[n])); }
    res.stats = { ratioDb: 10 * Math.log10(Math.max(A, 1e-30) / B), win: 0.1, ratio, level: lev, peakSpl: splOf(pk / Math.SQRT2) + 3.01, peakPa: pk, rmsSpl: splOf(Math.sqrt(B / (nA * res.channels.length))) };
    return res;
  }

  // ------------------------------------------------------------------ driver summary for the UI
  function driverSummary(D) {
    const cd = compileDriver(D);
    const lim = displacementLimits(cd);
    const curves = {};
    const R = Math.max(isFinite(cd.dataRange[1]) ? Math.max(-cd.dataRange[0], cd.dataRange[1]) : 0, cd.ts.XmaxMm || 0, 10) * 1.25;
    const xs = linspace(-R, R, 241);
    for (const k of ['bl', 'kms', 'le']) {
      const c = cd.curves[k]; if (!c) continue;
      curves[k] = { x: Array.from(xs), r: Array.from(xs, (x) => cd.r[k](x)), lo: c.lo, hi: c.hi, fitRms: c.info.fitRms, fitOrder: c.info.fitOrder, y0: c.y0 };
      if (D.nl[k].type === 'points') { curves[k].px = D.nl[k].x.slice(); curves[k].py = D.nl[k].y.map((y) => (k === 'kms' && D.nl[k].quantity === 'cms' ? 1 / y : y) / c.y0); }
    }
    return { ts: cd.ts, der: cd.der, lim, curves, dataRange: cd.dataRange };
  }

  const API = { linearCurves, hdSweep, imdSweep, multitone, maxSpl, waveform, auralize, driverSummary, displacementLimits, compileDriver, compileSetup, linearSetup, chooseFs, derived, tsOf };
  const Engine = { AIR, API, util: { fracOctaveFreqs, logspace, splOf, cabs, dftBin, fft, chebFit, chebEval, buildCurve, bilinear, analogResponse, digitalResponse, toneGen, SetupSim, NL_ALL, NL_NONE, flagsFor, steadyState, hdPoint, imdPoint } };
  root.KlirrEngine = Engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;

  // worker protocol
  if (typeof self !== 'undefined' && typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
    self.onmessage = function (ev) {
      const { id, cmd, args } = ev.data || {};
      try {
        let last = 0;
        const res = API[cmd](args, (p, info) => { const now = Date.now(); if (now - last > 120 || p >= 1) { last = now; self.postMessage({ id, type: 'progress', p, info }); } });
        const transfer = [];
        if (cmd === 'auralize') for (const ch of res.channels) transfer.push(ch.lin.buffer, ch.nl.buffer, ch.resid.buffer);
        self.postMessage({ id, type: 'done', res }, transfer);
      } catch (err) {
        self.postMessage({ id, type: 'error', message: err && err.message ? err.message : String(err) });
      }
    };
  }
})(typeof self !== 'undefined' ? self : globalThis);
