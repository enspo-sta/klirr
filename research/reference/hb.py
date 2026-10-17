"""Independent harmonic-balance reference for the Klirr audit.

Solves the periodic steady state of Klippel's lumped-parameter driver model directly in the frequency
domain (Newton iteration on truncated Fourier series), with no time stepping, no settling logic and no
lookup tables. The equations are written from first principles here, not copied from engine.js:

  u   = Re i + d/dt(Le(x) i) + uL2 + Bl(x) v
  uL2 = R2(x) (i - i2),   d/dt(L2(x) i2) = uL2
  Mms a = Bl(x) i - Rms v - Fk(x) + 1/2 i^2 dLe/dx + 1/2 i2^2 dL2/dx + Sd p_box
  p_box = P0 [ (V0 / (V0 + Sd x + Sp xp + Sr xr))^gamma - 1 ]      (adiabatic, no leak)
  port:  Map ap = Sp p_box - Rp vp - 1/2 rho xi Sp vp |vp| s(|vp|)
  radiator: Mr ar = Sr p_box - Rr vr - Kr(xr) xr
  far field (no Doppler): p = rho/(Omega r) (Sd a + Sp ap + Sr ar)

Curves: Chebyshev least squares of the library points (numpy), normalised to their value at x = 0,
Bl and Kms scaled to the small-signal table, L2 and R2 following Le, as the Guide describes; Kms optionally as the
curve measured it, or the small-signal value plus the curve's change.
"""
import json
import numpy as np

RHO, C0, P0, GAMMA = 1.196, 344.4, 101325.0, 1.4
KAPPA = GAMMA * P0


# ------------------------------------------------------------------ curves
class Curve:
    """shape r(x) = y(x)/y(0) of a library curve; x in metres"""

    def __init__(self, spec, kind, order=None):
        self.kind = kind
        self.const = spec is None
        if self.const:
            return
        t = spec['type']
        if t == 'points':
            x = np.asarray(spec['x'], float)
            y = np.asarray(spec['y'], float)
            if kind == 'kms' and spec.get('quantity') == 'cms':
                y = 1 / y
            o = order or spec.get('fit', 8)
            o = max(1, min(o, len(x) - 1, 16))
            self.m = (x.max() + x.min()) / 2
            self.s = (x.max() - x.min()) / 2
            self.c = np.polynomial.chebyshev.chebfit((x - self.m) / self.s, y, o)
            self.lo, self.hi = x.min(), x.max()
            self.f = lambda xm: np.polynomial.chebyshev.chebval((xm - self.m) / self.s, self.c)
        elif t == 'poly':
            c = np.asarray(spec['coef'], float)
            if kind == 'kms' and spec.get('quantity') == 'cms':
                R = spec.get('range', 10)
                xs = np.linspace(-R, R, 201)
                ys = 1 / np.polynomial.polynomial.polyval(xs, c)
                self.m, self.s = 0.0, R
                self.c = np.polynomial.chebyshev.chebfit(xs / R, ys, 10)
                self.f = lambda xm: np.polynomial.chebyshev.chebval(xm / self.s, self.c)
            else:
                self.f = lambda xm: np.polynomial.polynomial.polyval(xm, c)
            R = spec.get('range', 10)
            self.lo, self.hi = -R, R
        elif t == 'param':
            X = max(0.05, spec.get('xlim', 5)); off = spec.get('offset', 0); p = spec.get('shape', 2)
            if kind == 'bl':
                thr = spec.get('thr', 0.82)
                self.f = lambda xm: thr ** (np.abs((xm - off) / X) ** p)
            elif kind == 'kms':
                thr = spec.get('thr', 0.75)
                self.f = lambda xm: 1 / thr ** (np.abs((xm - off) / X) ** p)
            else:
                xr = max(0.1, spec.get('xref', 5))
                rin = 1 + spec.get('inPct', 0) / 100; rout = 1 + spec.get('outPct', 0) / 100
                a = (np.log(rout) - np.log(rin)) / (2 * xr); b = (np.log(rout) + np.log(rin)) / (2 * xr * xr)
                self.f = lambda xm: np.exp(a * np.clip(xm, -1.5 * xr, 1.5 * xr) + b * np.clip(xm, -1.5 * xr, 1.5 * xr) ** 2)
            self.lo, self.hi = -np.inf, np.inf
        else:
            raise ValueError(t)
        self.y0 = float(self.f(0.0))

    def r(self, x_m):
        if self.const:
            return np.ones_like(x_m)
        return self.f(x_m * 1e3) / self.y0

    def dr(self, x_m, h=1e-7):
        """derivative of the shape per metre (central difference on the analytic fit)"""
        if self.const:
            return np.zeros_like(x_m)
        return (self.r(x_m + h) - self.r(x_m - h)) / (2 * h)


def driver_model(d, abs_kms='table'):
    t = d['ts']
    ts = dict(Re=t['Re'], Le=t.get('Le', 0) * 1e-3, L2=t.get('L2', 0) * 1e-3, R2=t.get('R2', 0), Bl=t['Bl'],
              Mms=t['Mms'] * 1e-3, Sd=t['Sd'] * 1e-4, Rms=t['Rms'])
    ts['Kms'] = t['Kms'] * 1e3 if t.get('Kms') else 1 / (t['Cms'] * 1e-3)
    nl = d.get('nl') or {}
    cb, ck, cl = Curve(nl.get('bl'), 'bl'), Curve(nl.get('kms'), 'kms'), Curve(nl.get('le'), 'le')
    if abs_kms == 'curve' and not ck.const:
        ts['Kms'] = ck.y0 * 1e3
    # 'offset': the small-signal stiffness at rest plus the curve's change in N/m, Kms + Kc(x) - Kc(0)
    ts['kOff'] = ck.y0 * 1e3 / ts['Kms'] if abs_kms == 'offset' and not ck.const else None
    return ts, cb, ck, cl


# ------------------------------------------------------------------ harmonic balance
class HB:
    def __init__(self, K, Nt):
        self.K, self.Nt = K, Nt
        n = np.arange(Nt)
        th = 2 * np.pi * n / Nt
        cols = [np.ones(Nt)]
        for k in range(1, K + 1):
            cols += [np.cos(k * th), np.sin(k * th)]
        self.B = np.stack(cols, 1)                      # Nt x (2K+1)
        self.P = np.linalg.pinv(self.B)                 # projection to coefficients
        self.M = 2 * K + 1

    def Dmat(self, w):
        D = np.zeros((self.M, self.M))
        for k in range(1, self.K + 1):
            ia, ib = 2 * k - 1, 2 * k
            D[ia, ib] = k * w      # d/dt sin -> k w cos
            D[ib, ia] = -k * w     # d/dt cos -> -k w sin
        return D


def solve(model, enc, f, V, K=24, Nt=None, drive='voltage', tol=1e-11, maxit=60, verbose=False, z_init=None):
    ts, cb, ck, cl = model
    Nt = Nt or 8 * K
    hb = HB(K, Nt); M = hb.M
    w = 2 * np.pi * f
    D = hb.Dmat(w)
    B, P = hb.B, hb.P
    th = 2 * np.pi * np.arange(Nt) / Nt
    u = np.sqrt(2) * V * np.sin(th)
    Re, Le0, L20, R20, Bl0, Mms, Rms, Sd, K0 = (ts[k] for k in ('Re', 'Le', 'L2', 'R2', 'Bl', 'Mms', 'Rms', 'Sd', 'Kms'))
    hasLe = Le0 > 1e-7
    hasL2 = L20 > 1e-7 and R20 > 0
    etype = enc.get('type', 'ib')
    V0 = enc.get('V0', 0); Sp = enc.get('Sp', 0); Map = enc.get('Map', 0); Rp = enc.get('Rp', 0)
    xi = enc.get('xi', 0); vc = enc.get('vc', 1); vw = enc.get('vw', 1)
    Sr = enc.get('Sr', 0); Mr = enc.get('Mr', 0); Kr = enc.get('Kr', 0); Rr = enc.get('Rr', 0)
    prX = enc.get('prXlim', 0); prThr = enc.get('prThr', 0.5); prP = enc.get('prShape', 2)
    port = etype == 'vented'; pr = etype == 'pr'; box = etype != 'ib'
    # unknown blocks: x, i (voltage drive with Le), i2 (with L2), xp (port), xr (radiator)
    names = ['x']
    if drive == 'voltage' and hasLe: names.append('i')
    if hasL2: names.append('i2')
    if port: names.append('xp')
    if pr: names.append('xr')
    nb = len(names)

    def unpack(z):
        return {n: z[k * M:(k + 1) * M] for k, n in enumerate(names)}

    def residual(z):
        U = unpack(z)
        X = U['x']; x = B @ X; v = B @ (D @ X); a = B @ (D @ D @ X)
        rb = cb.r(x); rk = ck.r(x); rl = cl.r(x); drl = cl.dr(x)
        if ts['kOff'] is not None: rk = 1 + ts['kOff'] * (rk - 1)
        Bl = Bl0 * rb; Fk = K0 * rk * x
        Le = Le0 * rl; dLe = Le0 * drl
        i2 = B @ U['i2'] if 'i2' in U else np.zeros(Nt)
        if drive == 'current':
            i = u / Re
        elif hasLe:
            i = B @ U['i']
        else:
            if hasL2:
                i = (u - Bl * v + R20 * rl * i2) / (Re + R20 * rl)
            else:
                i = (u - Bl * v) / Re
        res = []
        uL2 = R20 * rl * (i - i2) if hasL2 else np.zeros(Nt)
        if 'i' in U:
            # Re i + d/dt(Le i) + uL2 + Bl v - u = 0
            r1 = Re * (P @ i) + D @ (P @ (Le * i)) + P @ uL2 + P @ (Bl * v) - P @ u
        fr = 0.5 * i * i * dLe
        if hasL2:
            # d/dt(L2(x) i2) - uL2 = 0
            r2 = D @ (P @ (L20 * rl * i2)) - P @ uL2
            fr = fr + 0.5 * i2 * i2 * (L20 * drl)
        pb = np.zeros(Nt)
        xp = B @ U['xp'] if port else np.zeros(Nt)
        xr = B @ U['xr'] if pr else np.zeros(Nt)
        if box:
            dV = Sd * x + Sp * xp + Sr * xr
            pb = P0 * ((V0 / (V0 + dV)) ** GAMMA - 1)
        r3 = Mms * (P @ a) + Rms * (P @ v) + P @ Fk - P @ (Bl * i) - P @ fr - Sd * (P @ pb)
        out = {'x': r3}
        if 'i' in U: out['i'] = r1
        if hasL2: out['i2'] = r2
        if port:
            vp = B @ (D @ U['xp']); ap = B @ (D @ D @ U['xp'])
            sw = 0.5 * (1 + np.tanh((np.abs(vp) - vc) / vw))
            drag = 0.5 * RHO * xi * Sp * vp * np.abs(vp) * sw
            out['xp'] = Map * (P @ ap) + Rp * (P @ vp) + P @ drag - Sp * (P @ pb)
        if pr:
            vr = B @ (D @ U['xr']); ar = B @ (D @ D @ U['xr'])
            Fr = Kr * xr * (np.exp(-np.log(prThr) * np.abs(xr / prX) ** prP) if prX > 0 else 1)
            out['xr'] = Mr * (P @ ar) + Rr * (P @ vr) + P @ Fr - Sr * (P @ pb)
        # scale rows so all blocks are comparable
        sc = {'x': 1 / (K0 * 1e-3 + Mms * w * w * 1e-3), 'i': 1.0, 'i2': 1.0, 'xp': 1 / max(Map * w * w * 1e-3, 1e-9), 'xr': 1 / max(Mr * w * w * 1e-3 + Kr * 1e-3, 1e-9)}
        return np.concatenate([out[n] * sc[n] for n in names])

    # initial guess: linear phasors from an independent small-signal network
    s = 1j * w
    Ze = Re + s * Le0 + ((s * L20 * R20) / (R20 + s * L20) if hasL2 else 0)
    Zm = Rms + s * Mms + K0 / s
    Yb = 0
    if box:
        Yb = s * V0 / KAPPA
        if port: Yb += Sp * Sp / (s * Map + Rp)
        if pr: Yb += Sr * Sr / (s * Mr + Rr + Kr / s)
        Zm = Zm + Sd * Sd / Yb
    I = (np.sqrt(2) * V / Re) if drive == 'current' else np.sqrt(2) * V / (Ze + Bl0 ** 2 / Zm)
    # u = A sin(wt) <-> phasor convention: signal = Im(A e^{jwt}); use complex amplitude c, signal = Im(c e^{jwt})
    vel = Bl0 * I / Zm; xph = vel / s
    def harm(c):
        # Im(c e^{jth}) = Re(c) sin + Im(c) cos
        z = np.zeros(M); z[1] = c.imag; z[2] = c.real; return z
    z0 = [harm(xph)]
    if 'i' in names: z0.append(harm(I))
    if 'i2' in names:
        I2 = I * R20 / (R20 + s * L20); z0.append(harm(I2))
    if port:
        pbph = -(Sd * vel) / Yb
        vp = Sp * pbph / (s * Map + Rp); z0.append(harm(vp / s))
    if pr:
        pbph = -(Sd * vel) / Yb
        vr = Sr * pbph / (s * Mr + Rr + Kr / s); z0.append(harm(vr / s))
    z = np.concatenate(z0) if z_init is None else z_init.copy()
    n = len(z)
    for it in range(maxit):
        r = residual(z)
        nr = np.linalg.norm(r)
        if verbose: print(it, nr)
        if nr < tol: break
        J = np.empty((n, n))
        hstep = 1e-7 * (np.abs(z) + 1e-6 * (np.max(np.abs(z)) + 1e-12))
        for j in range(n):
            zp = z.copy(); zp[j] += hstep[j]
            zm = z.copy(); zm[j] -= hstep[j]
            J[:, j] = (residual(zp) - residual(zm)) / (2 * hstep[j])
        dz = np.linalg.lstsq(J, -r, rcond=None)[0]
        # damped step
        lam = 1.0
        for _ in range(20):
            if np.linalg.norm(residual(z + lam * dz)) < nr: break
            lam *= 0.5
        z = z + lam * dz
    U = unpack(z)
    acc = D @ D @ U['x'] * Sd
    if port: acc = acc + D @ D @ U['xp'] * Sp
    if pr: acc = acc + D @ D @ U['xr'] * Sr
    amp = lambda c, k: np.hypot(c[2 * k - 1], c[2 * k])
    a1 = amp(acc, 1)
    hd = [amp(acc, k) / a1 for k in range(2, min(K, 9) + 1)]
    xt = B @ U['x']
    vpk = float(np.max(np.abs(B @ (D @ U['xp'])))) if port else 0.0
    return dict(hd=hd, xdc=float(U['x'][0] * 1e3), xpk=float(np.max(np.abs(xt)) * 1e3), xmin=float(xt.min() * 1e3), xmax=float(xt.max() * 1e3),
                resid=float(np.linalg.norm(residual(z))), its=it, a1=a1, vport=vpk, z=z,
                spl=20 * np.log10(RHO / (2 * np.pi) * a1 / np.sqrt(2) / 20e-6))


def solve_cont(model, enc, f, V, steps=12, **kw):
    """amplitude continuation: start at a small drive and walk up, so strongly nonlinear branches converge"""
    z = None; r = None
    for s in np.geomspace(0.05, 1.0, steps):
        r = solve(model, enc, f, V * s, z_init=None if z is None else z * 1.0, **kw)
        if z is not None and r['resid'] > 1e-8:
            pass
        z = r['z']
    return r
