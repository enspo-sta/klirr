/* Klirr listening mode: run music or test signals through the nonlinear model and hear the difference. */
const SYNTH = {
  bassvoice: { name: 'Bass line and a sung vowel', gen: synthBassVoice },
  kick: { name: 'Kick drum and piano chords', gen: synthKickPiano },
  organ: { name: 'Organ pedal and flute', gen: synthOrgan },
  imd: { name: 'Swelling 40 Hz tone under a steady 1 kHz tone', gen: synthImd },
};
function synthBassVoice(fs, dur) {
  const n = Math.round(fs * dur), L = new Float32Array(n), R = new Float32Array(n);
  const notes = [41.2, 41.2, 55, 49, 36.7, 41.2, 55, 61.7]; const nd = 1.5;
  let ph = 0, vph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / fs; const k = Math.floor(t / nd) % notes.length; const tn = t - Math.floor(t / nd) * nd;
    const f = notes[k]; ph += 2 * Math.PI * f / fs;
    const env = Math.min(1, tn * 40) * Math.exp(-tn * 1.1);
    const bass = env * (Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph));
    const vib = 1 + 0.012 * Math.sin(2 * Math.PI * 5.2 * t);
    vph += 2 * Math.PI * 220 * vib / fs;
    let v = 0; for (let hN = 1; hN <= 18; hN++) { const fh = 220 * hN; const w = Math.exp(-Math.pow((fh - 750) / 260, 2)) + 0.6 * Math.exp(-Math.pow((fh - 1200) / 300, 2)) + 0.25 / hN; v += w * Math.sin(hN * vph); }
    const venv = 0.5 + 0.5 * Math.sin(2 * Math.PI * t / 6 - 1.2);
    const s = 0.55 * bass + 0.09 * v * venv;
    L[i] = s; R[i] = 0.55 * bass + 0.09 * v * venv * 0.9;
  }
  return [L, R];
}
function synthKickPiano(fs, dur) {
  const n = Math.round(fs * dur), L = new Float32Array(n), R = new Float32Array(n);
  const chords = [[261.6, 329.6, 392], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]];
  let kph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / fs; const tk = t % 0.5; const fk = 45 + 70 * Math.exp(-tk * 30); kph += 2 * Math.PI * fk / fs;
    if (tk < 1 / fs) kph = 0;
    const kick = Math.exp(-tk * 7) * Math.sin(kph);
    const tc = t % 2; const ch = chords[Math.floor(t / 2) % chords.length];
    let p = 0; for (const f of ch) for (let hN = 1; hN <= 6; hN++) p += Math.exp(-tc * (0.8 + hN * 0.5)) / hN * Math.sin(2 * Math.PI * f * hN * t);
    L[i] = 0.7 * kick + 0.06 * p; R[i] = 0.7 * kick + 0.055 * p;
  }
  return [L, R];
}
function synthOrgan(fs, dur) {
  const n = Math.round(fs * dur), L = new Float32Array(n), R = new Float32Array(n);
  const mel = [784, 880, 988, 1047, 988, 880, 784, 659];
  for (let i = 0; i < n; i++) {
    const t = i / fs; const ped = 32.7;
    const pedal = Math.min(1, t * 2) * (Math.sin(2 * Math.PI * ped * t) + 0.5 * Math.sin(4 * Math.PI * ped * t) + 0.25 * Math.sin(6 * Math.PI * ped * t));
    const k = Math.floor(t / 0.75) % mel.length; const tn = t % 0.75; const f = mel[k];
    const fl = Math.min(1, tn * 20) * Math.min(1, (0.75 - tn) * 20) * (Math.sin(2 * Math.PI * f * t) + 0.15 * Math.sin(4 * Math.PI * f * t));
    L[i] = 0.5 * pedal + 0.12 * fl; R[i] = 0.5 * pedal + 0.1 * fl;
  }
  return [L, R];
}
function synthImd(fs, dur) {
  const n = Math.round(fs * dur), L = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / fs; const sw = 0.5 - 0.5 * Math.cos(2 * Math.PI * t / dur); L[i] = 0.75 * sw * Math.sin(2 * Math.PI * 40 * t) + 0.12 * Math.sin(2 * Math.PI * 1000 * t); }
  return [L, L.slice()];
}

App.views.listen = (() => {
  const root = $('#view-listen'); const S = () => App.settings.listen;
  let pb, rb, fileIn, srcBox, setupSel, playerHost, statsHost, pT, pLv;
  let audio = null; // {buffers:{orig,lin,nl,resid}, fs, len, peakResid}
  let ctx = null, nodes = null, playing = false, sel = 'nl', boostDb = 20, loop = true, startedAt = 0, offset = 0, raf = 0, fileData = null;
  function build() {
    root.innerHTML = ''; root.className = 'view'; const st = S();
    pb = progressBlock(); rb = runButtons(run); rb.el.firstChild.textContent = 'Process';
    srcBox = h('div', { class: 'fs-body' });
    fileIn = h('input', { id: 'ls-file', type: 'file', accept: 'audio/*,.wav,.mp3,.flac,.m4a,.aac,.ogg' });
    fileIn.addEventListener('change', loadFile);
    const renderSrc = () => {
      srcBox.innerHTML = '';
      srcBox.append(h('div', { class: 'row' }, seg('ls-src', st.src, [['synth', 'Test signal'], ['file', 'Your audio file']], (v) => { st.src = v; saveSettings(); renderSrc(); })));
      if (st.src === 'synth') srcBox.append(field('Signal', selectInput('ls-synth', st.synth, Object.entries(SYNTH).map(([k, v]) => [k, v.name]), (v) => { st.synth = v; saveSettings(); })));
      else srcBox.append(field('Audio file (WAV, MP3, FLAC, AAC)', fileIn), h('p', { class: 'hint' }, fileData ? 'Loaded: ' + fileData.name + ', ' + fmt(fileData.dur, 1) + ' s, ' + fileData.ch.length + ' channel(s), ' + fileData.fs + ' Hz.' : 'The file is decoded in your browser and never leaves it.'));
    };
    renderSrc();
    setupSel = h('select', { id: 'ls-setup' }); setupSel.addEventListener('change', () => { st.setup = setupSel.value; saveSettings(); });
    fillSetups();
    const ctl = h('div', { class: 'stack sticky-side' }, h('div', { class: 'card' },
      h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Listen'), h('h2', null, 'Hear the distortion'))),
      h('div', { class: 'fs-body' },
        srcBox,
        h('div', { class: 'grid2' },
          field('Start', numInput('ls-start', st.start, (v) => { st.start = Math.max(0, v || 0); saveSettings(); }), 's'),
          field('Length (max 30)', numInput('ls-dur', st.dur, (v) => { st.dur = clamp(v || 12, 1, 30); saveSettings(); }), 's')),
        checkbox('ls-stereo', st.stereo, 'Process both channels (twice the time)', (v) => { st.stereo = v; saveSettings(); }),
        field('Setup', setupSel),
        field('Loudness: RMS SPL of the linear output at 1 m', numInput('ls-level', st.level, (v) => { st.level = clamp(v || 85, 50, 130); saveSettings(); }), 'dB'),
        rb.el, pb.el,
        h('p', { class: 'hint' }, 'Klirr runs the excerpt through the linear model and the full nonlinear model at 2 to 4 times the sample rate. "Distortion only" is the sample-by-sample difference: everything the nonlinearities added, including intermodulation between instruments.'))));
    playerHost = h('div', { class: 'player' }); statsHost = h('div', { class: 'tiles' }); pT = h('div'); pLv = h('div');
    const res = h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Player'), h('h2', null, 'A/B at the same level'))), playerHost),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Numbers'), h('h3', null, 'For this excerpt'))), statsHost),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Over time'), h('h3', null, 'Distortion relative to the music, per 100 ms'))), pT, h('p', { class: 'hint' }, 'The level of the difference signal relative to the linear output in each 100 ms window.')),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('div', { class: 't' }, h('span', { class: 'kicker' }, 'Over time'), h('h3', null, 'Programme level, RMS per 100 ms'))), pLv));
    root.append(ctl, res);
    App._lsT = new Plot(pT, { height: 220, x: { type: 'lin', label: 's' }, y: { label: 'dB re music' }, tipX: (x) => x.toFixed(1) + ' s', tipY: (v) => v.toFixed(1) + ' dB', aria: 'Distortion over time' });
    App._lsL = new Plot(pLv, { height: 180, x: { type: 'lin', label: 's' }, y: { label: 'dB SPL at 1 m' }, tipX: (x) => x.toFixed(1) + ' s', tipY: (v) => v.toFixed(1) + ' dB', aria: 'Programme level over time' });
    drawPlayer(); drawStats();
  }
  function fillSetups() {
    if (!setupSel) return; const st = S(); setupSel.innerHTML = '';
    for (const s of App.setups) setupSel.append(h('option', { value: s.id }, s.name));
    setupSel.value = App.setups.some((s) => s.id === st.setup) ? st.setup : (activeSetups()[0] || App.setups[0] || {}).id || '';
    st.setup = setupSel.value;
  }
  async function loadFile() {
    const f = fileIn.files && fileIn.files[0]; if (!f) return;
    pb.set(0.05, 'Decoding ' + f.name + '…');
    try {
      const buf = await f.arrayBuffer();
      const AC = window.AudioContext || window.webkitAudioContext; const tmp = new AC();
      const ab = await new Promise((res, rej) => { const p = tmp.decodeAudioData(buf, res, rej); if (p && p.then) p.then(res, rej); });
      tmp.close && tmp.close();
      const ch = []; for (let c = 0; c < Math.min(2, ab.numberOfChannels); c++) ch.push(ab.getChannelData(c).slice());
      fileData = { name: f.name, fs: ab.sampleRate, ch, dur: ab.duration };
      pb.done('Loaded ' + f.name + ' (' + fmt(ab.duration, 1) + ' s). Pick the start and length, then press Process.');
      build();
    } catch (e) { pb.err('This file could not be decoded here. Try a WAV or MP3 file.'); }
  }
  function excerpt() {
    const st = S();
    if (st.src === 'file') {
      if (!fileData) throw new Error('Choose an audio file first.');
      const fs = fileData.fs; const a = Math.floor(clamp(st.start, 0, fileData.dur - 0.5) * fs); const n = Math.min(Math.floor(st.dur * fs), fileData.ch[0].length - a);
      let ch = fileData.ch.map((c) => c.slice(a, a + n));
      if (!st.stereo && ch.length > 1) { const m = new Float32Array(n); for (let i = 0; i < n; i++) m[i] = 0.5 * (ch[0][i] + ch[1][i]); ch = [m]; }
      return { fs, ch, label: fileData.name };
    }
    const fs = 48000; let ch = SYNTH[st.synth].gen(fs, st.dur);
    if (!st.stereo) ch = [ch[0]];
    return { fs, ch, label: SYNTH[st.synth].name };
  }
  async function run() {
    stop();
    const st = S(); const s = App.setups.find((x) => x.id === setupSel.value); if (!s) { pb.err('Create a setup first.'); return; }
    let ex, es; try { ex = excerpt(); es = engineSetup(s); } catch (e) { pb.err(e.message); return; }
    const r = await guard(pb, rb, () => Compute.run('auralize', { setup: es, fsAudio: ex.fs, channels: ex.ch, level: st.level }, (p, info) => pb.set(p, (info && info.stage ? info.stage[0].toUpperCase() + info.stage.slice(1) : 'Processing') + ' · ' + Math.round(p * 100) + ' %')));
    if (!r) return;
    // level-match the original to the linear output (RMS) so switching compares like with like
    let so = 0, sl = 0; for (let c = 0; c < ex.ch.length; c++) for (let i = 0; i < ex.ch[c].length; i++) { so += ex.ch[c][i] * ex.ch[c][i]; sl += r.channels[c].lin[i] * r.channels[c].lin[i]; }
    const og = so > 0 ? Math.sqrt(sl / so) : 1;
    let pk = 0, pkR = 0;
    for (let c = 0; c < r.channels.length; c++) { const C = r.channels[c]; for (let i = 0; i < C.lin.length; i++) { pk = Math.max(pk, Math.abs(C.lin[i]), Math.abs(C.nl[i]), Math.abs(ex.ch[c][i] * og)); pkR = Math.max(pkR, Math.abs(C.resid[i])); } }
    const sc = 0.89 / (pk || 1);
    audio = { fs: ex.fs, label: ex.label, setup: s.name, color: setupColor(s), r, og, sc, peakResid: pkR * sc, ch: ex.ch };
    App.res.listen = { level: st.level };
    drawPlayer(); drawStats();
  }
  function makeBuffers() {
    const AC = window.AudioContext || window.webkitAudioContext; if (!ctx) ctx = new AC();
    const nC = audio.r.channels.length; const len = audio.r.channels[0].lin.length;
    const mk = (fn) => { const b = ctx.createBuffer(Math.max(nC, 1), len, audio.fs); for (let c = 0; c < nC; c++) { const d = b.getChannelData(c); fn(c, d); } return b; };
    return {
      orig: mk((c, d) => { const x = audio.ch[c]; for (let i = 0; i < len; i++) d[i] = x[i] * audio.og * audio.sc; }),
      lin: mk((c, d) => { const x = audio.r.channels[c].lin; for (let i = 0; i < len; i++) d[i] = x[i] * audio.sc; }),
      nl: mk((c, d) => { const x = audio.r.channels[c].nl; for (let i = 0; i < len; i++) d[i] = x[i] * audio.sc; }),
      resid: mk((c, d) => { const x = audio.r.channels[c].resid; for (let i = 0; i < len; i++) d[i] = x[i] * audio.sc; }),
    };
  }
  function gains() { const maxBoost = audio.peakResid > 0 ? 20 * Math.log10(0.95 / audio.peakResid) : 40; const b = Math.min(boostDb, maxBoost); return { orig: sel === 'orig' ? 1 : 0, lin: sel === 'lin' ? 1 : 0, nl: sel === 'nl' ? 1 : 0, resid: sel === 'resid' ? Math.pow(10, b / 20) : 0 }; }
  function applyGains() { if (!nodes) return; const g = gains(); for (const k in g) nodes[k].gain.setTargetAtTime(g[k], ctx.currentTime, 0.012); }
  function play() {
    if (!audio) return; const AC = window.AudioContext || window.webkitAudioContext; if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
    if (!audio.buffers) audio.buffers = makeBuffers();
    const g = gains(); nodes = {}; const t0 = ctx.currentTime + 0.05;
    const dur = audio.buffers.lin.duration;
    for (const k of ['orig', 'lin', 'nl', 'resid']) {
      const src = ctx.createBufferSource(); src.buffer = audio.buffers[k]; src.loop = loop;
      const gn = ctx.createGain(); gn.gain.value = g[k]; src.connect(gn).connect(ctx.destination);
      src.start(t0, offset % dur); nodes[k] = gn; nodes['src_' + k] = src;
      if (k === 'lin') src.onended = () => { if (playing && !loop) { playing = false; offset = 0; drawPlayer(); } };
    }
    startedAt = t0 - (offset % dur); playing = true; drawPlayer(); tick();
  }
  function stop() {
    if (nodes) { for (const k of ['orig', 'lin', 'nl', 'resid']) { try { nodes['src_' + k].onended = null; nodes['src_' + k].stop(); } catch (e) {} } }
    if (playing && ctx) offset = (ctx.currentTime - startedAt);
    nodes = null; playing = false; cancelAnimationFrame(raf);
  }
  function tick() {
    cancelAnimationFrame(raf);
    const el = $('#ls-pos'); if (el && ctx && playing) { const dur = audio.buffers.lin.duration; const t = ((ctx.currentTime - startedAt) % dur + dur) % dur; el.textContent = t.toFixed(1) + ' / ' + dur.toFixed(1) + ' s'; if (App._lsT) { App._lsT.vlines = [{ x: t, color: 'rgba(231,234,240,.5)' }]; App._lsT.draw(); } }
    if (playing) raf = requestAnimationFrame(tick);
  }
  function drawPlayer() {
    playerHost.innerHTML = '';
    if (!audio) { playerHost.append(h('div', { class: 'plot-empty' }, 'Choose a signal and a setup, then press Process. Processing a 12 s excerpt takes a few seconds.')); return; }
    const names = [['orig', 'Original'], ['lin', 'Linear model'], ['nl', 'Nonlinear model'], ['resid', 'Distortion only']];
    const btns = h('div', { class: 'src-btns', role: 'group', 'aria-label': 'What to hear' }, names.map(([k, n]) => h('button', { class: 'btn', type: 'button', 'aria-pressed': sel === k ? 'true' : 'false', onclick: () => { sel = k; applyGains(); drawPlayer(); } }, n)));
    const maxBoost = audio.peakResid > 0 ? Math.floor(20 * Math.log10(0.95 / audio.peakResid)) : 40;
    const boost = h('input', { id: 'ls-boost', type: 'range', min: '0', max: String(Math.max(0, Math.min(40, maxBoost))), step: '1', value: String(Math.min(boostDb, Math.max(0, maxBoost))) });
    boost.addEventListener('input', () => { boostDb = +boost.value; $('#ls-boost-v').textContent = '+' + boostDb + ' dB'; applyGains(); });
    const loopCb = checkbox('ls-loop', loop, 'Loop', (v) => { loop = v; if (nodes) for (const k of ['orig', 'lin', 'nl', 'resid']) nodes['src_' + k].loop = v; });
    playerHost.append(
      h('p', { class: 'small muted' }, h('span', { class: 'sw', style: { background: audio.color, marginRight: '6px' } }), audio.setup + ' · ' + audio.label + ' · ' + fmt(App.res.listen.level, 0) + ' dB RMS at 1 m'),
      btns,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => { if (playing) { stop(); drawPlayer(); } else play(); } }, playing ? 'Stop' : 'Play'), loopCb, h('span', { class: 'mono small muted', id: 'ls-pos' }, playing ? '' : 'stopped')),
      field('Boost for "Distortion only"', h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, boost, h('span', { class: 'mono small', id: 'ls-boost-v', style: { whiteSpace: 'nowrap', flex: 'none', minWidth: '5ch', textAlign: 'right' } }, '+' + Math.min(boostDb, Math.max(0, maxBoost)) + ' dB'))),
      h('p', { class: 'hint' }, 'All four play in sync, so switching is instant. Playback loudness is set by your device; the SPL above only sets how hard the model is driven. The boost is capped so the difference signal cannot clip.'));
  }
  function drawStats() {
    statsHost.innerHTML = '';
    if (!audio) { App._lsT && App._lsT.setData([]); App._lsL && App._lsL.setData([]); return; }
    const r = audio.r; const c0 = r.channels[0];
    const tile = (k, v, s) => h('div', { class: 'tile' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v), s ? h('span', { class: 's' }, s) : null);
    const cells = [
      tile('Distortion re music', fmt(r.stats.ratioDb, 1) + ' dB', 'whole excerpt, all channels'),
      tile('Level', fmt(r.stats.rmsSpl, 1) + ' dB RMS', 'peak ' + fmt(r.stats.peakSpl, 1) + ' dB SPL at 1 m'),
      c0.xpk.map((x, w) => tile('Peak excursion' + (c0.xpk.length > 1 ? ', way ' + (w + 1) : ''), fmt(x, 2) + ' mm', 'linear model ' + fmt(c0.xpkLin[w], 2) + ' mm · mean ' + fmt(c0.xdc[w], 3) + ' mm')),
      c0.vpk.map((v, w) => (v > 0 ? tile('Port air speed' + (c0.vpk.length > 1 ? ', way ' + (w + 1) : ''), fmt(v, 1) + ' m/s', 'peak') : null)),
      c0.xrpk.map((v, w) => (v > 0 ? tile('Radiator excursion' + (c0.xrpk.length > 1 ? ', way ' + (w + 1) : ''), fmt(v, 2) + ' mm', 'peak') : null)),
      tile('Simulation rate', fmt(r.fs * r.M / 1000, 0) + ' kHz', r.M + '× oversampling')];
    statsHost.append(...cells.flat(Infinity).filter(Boolean));
    const t = r.stats.ratio.map((_, i) => (i + 0.5) * r.stats.win);
    App._lsT.setData([{ id: 'ratio', name: 'Distortion re music', color: audio.color, pts: t.map((x, i) => [x, r.stats.ratio[i] < -190 ? NaN : r.stats.ratio[i]]) }]);
    App._lsL.setData([{ id: 'lvl', name: 'Linear output level', color: GREY, width: 1.5, pts: t.map((x, i) => [x, r.stats.level[i]]) }]);
  }
  return { build, onShow() { if (!playerHost) build(); else fillSetups(); }, onSetups() { fillSetups(); } };
})();
