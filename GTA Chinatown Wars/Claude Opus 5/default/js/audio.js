'use strict';
/* ------------------------------------------------------------------
   audio.js — all sound is synthesised at runtime through Web Audio.
   No files, no licences. Master bus: gain -> compressor -> speakers.
------------------------------------------------------------------ */

const Sound = {
  ctx: null, master: null, comp: null, noiseBuf: null,
  ready: false, muted: false,
  engine: null, siren: null,
  _last: Object.create(null),

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 22;
    this.comp.ratio.value = 8;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    const n = ctx.sampleRate * 1.5;
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    this.ready = true;
  },

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.85; },

  /** rate-limit a sound key so overlapping triggers don't turn to mush */
  _gate(key, ms) {
    const t = performance.now();
    if (this._last[key] && t - this._last[key] < ms) return false;
    this._last[key] = t;
    return true;
  },

  _noise(dur, gain, type, f0, f1, q) {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const flt = ctx.createBiquadFilter();
    flt.type = type; flt.Q.value = q || 1;
    flt.frequency.setValueAtTime(f0, t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt); flt.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
    return g;
  },

  _tone(type, f0, f1, dur, gain, delay) {
    const ctx = this.ctx, t = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.012, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
    return o;
  },

  /* ---------------- one-shots ---------------- */
  play(name, vol) {
    if (!this.ready || this.muted) return;
    const v = vol === undefined ? 1 : clamp(vol, 0, 1);
    if (v < 0.02) return;
    switch (name) {
      case 'pistol':
        if (!this._gate('pistol', 55)) return;
        this._noise(0.13, 0.55 * v, 'bandpass', 2600, 320, 1.1);
        this._tone('square', 240, 60, 0.09, 0.22 * v);
        break;
      case 'smg':
        if (!this._gate('smg', 45)) return;
        this._noise(0.09, 0.42 * v, 'bandpass', 3200, 500, 1.4);
        this._tone('square', 300, 90, 0.06, 0.16 * v);
        break;
      case 'shotgun':
        if (!this._gate('shotgun', 120)) return;
        this._noise(0.34, 0.75 * v, 'lowpass', 2400, 160, 0.8);
        this._tone('sine', 120, 42, 0.28, 0.34 * v);
        break;
      case 'melee':
        this._noise(0.11, 0.4 * v, 'lowpass', 1400, 220, 1);
        this._tone('triangle', 180, 70, 0.1, 0.2 * v);
        break;
      case 'hit':
        this._noise(0.09, 0.35 * v, 'bandpass', 900, 260, 2);
        break;
      case 'ricochet':
        this._tone('sawtooth', 2200, 480, 0.11, 0.10 * v);
        break;
      case 'crash':
        if (!this._gate('crash', 90)) return;
        this._noise(0.30, 0.62 * v, 'lowpass', 1800, 130, 0.7);
        this._tone('sine', 96, 34, 0.30, 0.38 * v);
        break;
      case 'scrape':
        if (!this._gate('scrape', 130)) return;
        this._noise(0.16, 0.20 * v, 'highpass', 1800, 3000, 1.5);
        break;
      case 'pickup':
        this._tone('sine', 620, 940, 0.10, 0.24 * v);
        this._tone('sine', 940, 1400, 0.12, 0.18 * v, 0.08);
        break;
      case 'cash':
        this._tone('triangle', 880, 1320, 0.09, 0.22 * v);
        this._tone('triangle', 1320, 1760, 0.11, 0.16 * v, 0.07);
        break;
      case 'door':
        this._noise(0.10, 0.28 * v, 'lowpass', 900, 200, 1);
        this._tone('square', 150, 90, 0.07, 0.12 * v);
        break;
      case 'scream':
        if (!this._gate('scream', 260)) return;
        this._tone('sawtooth', rand(420, 620), rand(240, 340), 0.42, 0.13 * v);
        break;
      case 'grunt':
        this._tone('sawtooth', rand(160, 230), rand(90, 130), 0.20, 0.15 * v);
        break;
      case 'horn':
        if (!this._gate('horn', 400)) return;
        this._tone('square', 392, 392, 0.35, 0.14 * v);
        this._tone('square', 494, 494, 0.35, 0.11 * v);
        break;
      case 'blip':
        this._tone('square', 760, 760, 0.05, 0.11 * v);
        break;
      case 'star':
        this._tone('square', 660, 660, 0.09, 0.16 * v);
        this._tone('square', 990, 990, 0.14, 0.14 * v, 0.09);
        break;
      case 'success':
        [523, 659, 784, 1047].forEach((f, i) => this._tone('triangle', f, f, 0.24, 0.2, i * 0.11));
        break;
      case 'fail':
        [392, 330, 262].forEach((f, i) => this._tone('sawtooth', f, f * 0.98, 0.3, 0.16, i * 0.14));
        break;
      case 'busted':
        [220, 208].forEach((f, i) => this._tone('square', f, f * 0.9, 0.5, 0.18, i * 0.18));
        this._noise(0.6, 0.2, 'lowpass', 700, 150, 1);
        break;
      case 'skid':
        if (!this._gate('skid', 220)) return;
        this._noise(0.34, 0.16 * v, 'bandpass', 1500, 900, 3);
        break;
      case 'reload':
        this._noise(0.07, 0.2 * v, 'highpass', 2400, 1800, 2);
        this._tone('square', 340, 240, 0.05, 0.1 * v, 0.09);
        break;
      case 'explode':
        this._noise(0.8, 0.85 * v, 'lowpass', 1600, 60, 0.6);
        this._tone('sine', 90, 26, 0.7, 0.5 * v);
        break;
    }
  },

  /* ---------------- engine loop ---------------- */
  startEngine() {
    if (!this.ready || this.engine) return;
    const ctx = this.ctx;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 60;
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 30;
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 620; flt.Q.value = 3;
    const g = ctx.createGain(); g.gain.value = 0;
    o1.connect(flt); o2.connect(flt); flt.connect(g); g.connect(this.master);
    o1.start(); o2.start();
    this.engine = { o1, o2, flt, g };
  },
  stopEngine() {
    if (!this.engine) return;
    const e = this.engine; this.engine = null;
    try {
      e.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      e.o1.stop(this.ctx.currentTime + 0.3);
      e.o2.stop(this.ctx.currentTime + 0.3);
    } catch (err) { /* already stopped */ }
  },
  engineParams(rpm01, load) {
    if (!this.engine) return;
    const t = this.ctx.currentTime;
    const f = 42 + rpm01 * 138;
    this.engine.o1.frequency.setTargetAtTime(f, t, 0.05);
    this.engine.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.engine.flt.frequency.setTargetAtTime(380 + rpm01 * 1500, t, 0.06);
    this.engine.g.gain.setTargetAtTime(this.muted ? 0 : 0.055 + load * 0.075, t, 0.08);
  },

  /* ---------------- police siren ---------------- */
  startSiren() {
    if (!this.ready || this.siren) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 700;
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.9;
    const lg = ctx.createGain(); lg.gain.value = 240;
    const g = ctx.createGain(); g.gain.value = 0;
    lfo.connect(lg); lg.connect(o.frequency);
    o.connect(g); g.connect(this.master);
    o.start(); lfo.start();
    this.siren = { o, lfo, lg, g };
  },
  stopSiren() {
    if (!this.siren) return;
    const s = this.siren; this.siren = null;
    try {
      s.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      s.o.stop(this.ctx.currentTime + 0.5);
      s.lfo.stop(this.ctx.currentTime + 0.5);
    } catch (err) { /* already stopped */ }
  },
  sirenLevel(v) {
    if (!this.siren) return;
    this.siren.g.gain.setTargetAtTime(this.muted ? 0 : clamp(v, 0, 1) * 0.05, this.ctx.currentTime, 0.15);
  }
};
