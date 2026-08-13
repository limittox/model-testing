'use strict';

/* Every sound is synthesised on the fly with Web Audio -- no audio files.
   The context starts suspended and is resumed on the first user gesture. */
var Sound = (function () {

  var ctx = null, master = null, comp = null, noiseBuf = null;
  var enabled = true;
  var muted = false;
  var lastAt = {};        // per-sound throttle so overlapping fire doesn't stack

  function init() {
    if (ctx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { enabled = false; return; }
    try {
      ctx = new AC();
    } catch (e) { enabled = false; return; }

    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 24;
    comp.ratio.value = 10;
    comp.attack.value = 0.003;
    comp.release.value = 0.20;

    master = ctx.createGain();
    master.gain.value = 0.55;

    master.connect(comp);
    comp.connect(ctx.destination);

    // one second of white noise, reused by every noise-based effect
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function resume() {
    init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function now() { return ctx.currentTime; }

  /* --- primitives ----------------------------------------------------- */

  function env(node, t0, peak, attack, decay) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    node.connect(g);
    return g;
  }

  function tone(type, f0, f1, t0, dur, peak, dest) {
    var o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    var g = env(o, t0, peak, Math.min(0.01, dur * 0.2), dur);
    g.connect(dest || master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    return o;
  }

  function noise(t0, dur, peak, filterType, f0, f1, q, dest) {
    var s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = filterType || 'lowpass';
    f.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    f.Q.value = q || 1;
    s.connect(f);
    var g = env(f, t0, peak, 0.004, dur);
    g.connect(dest || master);
    s.start(t0);
    s.stop(t0 + dur + 0.05);
    return s;
  }

  /* --- the sound bank -------------------------------------------------- */

  var bank = {
    pistol: function (t) {
      noise(t, 0.11, 0.55, 'bandpass', 1800, 500, 1.2);
      tone('square', 320, 90, t, 0.07, 0.28);
      noise(t, 0.03, 0.5, 'highpass', 4000, 4000, 0.7);
    },
    shotgun: function (t) {
      noise(t, 0.30, 0.85, 'lowpass', 2600, 200, 0.9);
      noise(t, 0.06, 0.7, 'highpass', 3000, 1500, 0.7);
      tone('square', 160, 45, t, 0.16, 0.4);
    },
    pump: function (t) {
      noise(t, 0.05, 0.28, 'bandpass', 2400, 1200, 4);
      noise(t + 0.09, 0.05, 0.24, 'bandpass', 1800, 900, 4);
    },
    chaingun: function (t) {
      noise(t, 0.07, 0.42, 'bandpass', 2200, 700, 1.4);
      tone('square', 260, 110, t, 0.05, 0.2);
    },
    dryfire: function (t) {
      noise(t, 0.04, 0.22, 'bandpass', 2600, 1800, 6);
    },
    hitWall: function (t) {
      noise(t, 0.06, 0.20, 'highpass', 2400, 1400, 1);
    },
    hitFlesh: function (t) {
      noise(t, 0.09, 0.34, 'lowpass', 900, 260, 1);
      tone('triangle', 180, 70, t, 0.07, 0.16);
    },
    playerPain: function (t) {
      tone('sawtooth', 300, 150, t, 0.22, 0.34);
      noise(t, 0.16, 0.2, 'bandpass', 700, 400, 1.4);
    },
    playerDie: function (t) {
      tone('sawtooth', 260, 60, t, 0.9, 0.42);
      noise(t, 0.8, 0.3, 'lowpass', 900, 120, 1);
    },
    enemySee: function (t) {
      tone('sawtooth', 220, 340, t, 0.20, 0.26);
      tone('square', 110, 180, t + 0.03, 0.18, 0.16);
    },
    enemyPain: function (t) {
      tone('sawtooth', 420, 200, t, 0.14, 0.24);
      noise(t, 0.10, 0.2, 'bandpass', 1200, 500, 1.2);
    },
    enemyDie: function (t) {
      tone('sawtooth', 300, 70, t, 0.55, 0.34);
      noise(t, 0.45, 0.26, 'lowpass', 1400, 200, 0.9);
    },
    baronSee: function (t) {
      tone('sawtooth', 90, 150, t, 0.55, 0.42);
      tone('square', 60, 100, t, 0.5, 0.3);
      noise(t, 0.45, 0.24, 'lowpass', 700, 200, 1);
    },
    baronDie: function (t) {
      tone('sawtooth', 130, 40, t, 1.2, 0.5);
      noise(t, 1.0, 0.34, 'lowpass', 900, 90, 0.9);
    },
    bite: function (t) {
      noise(t, 0.12, 0.4, 'bandpass', 1400, 300, 1.1);
      tone('square', 200, 80, t, 0.09, 0.22);
    },
    fireball: function (t) {
      noise(t, 0.30, 0.34, 'bandpass', 900, 2400, 0.8);
      tone('sawtooth', 150, 420, t, 0.22, 0.16);
    },
    boom: function (t) {
      noise(t, 0.45, 0.75, 'lowpass', 1800, 90, 0.8);
      tone('square', 110, 34, t, 0.30, 0.35);
    },
    pickupItem: function (t) {
      tone('square', 660, 990, t, 0.09, 0.22);
      tone('square', 990, 1320, t + 0.06, 0.09, 0.16);
    },
    pickupWeapon: function (t) {
      tone('square', 330, 660, t, 0.10, 0.26);
      tone('square', 495, 880, t + 0.08, 0.14, 0.22);
      noise(t, 0.06, 0.16, 'bandpass', 1800, 900, 2);
    },
    pickupKey: function (t) {
      tone('triangle', 880, 880, t, 0.10, 0.24);
      tone('triangle', 1320, 1320, t + 0.09, 0.16, 0.2);
    },
    health: function (t) {
      tone('sine', 520, 780, t, 0.14, 0.26);
    },
    doorOpen: function (t) {
      noise(t, 0.55, 0.30, 'lowpass', 500, 1400, 0.9);
      tone('sawtooth', 60, 92, t, 0.5, 0.12);
    },
    doorClose: function (t) {
      noise(t, 0.45, 0.28, 'lowpass', 1200, 300, 0.9);
      tone('sawtooth', 90, 55, t, 0.42, 0.12);
    },
    locked: function (t) {
      tone('square', 180, 140, t, 0.10, 0.24);
      tone('square', 140, 110, t + 0.12, 0.10, 0.2);
    },
    exit: function (t) {
      noise(t, 0.5, 0.3, 'lowpass', 900, 300, 1);
      tone('square', 220, 440, t, 0.5, 0.3);
    },
    switchUp: function (t) {
      tone('square', 440, 660, t, 0.08, 0.2);
    },
    win: function (t) {
      var notes = [392, 523, 659, 784, 1046];
      for (var i = 0; i < notes.length; i++) {
        tone('square', notes[i], notes[i], t + i * 0.13, 0.16, 0.24);
        tone('triangle', notes[i] / 2, notes[i] / 2, t + i * 0.13, 0.18, 0.16);
      }
    }
  };

  /* Throttle windows keep rapid-fire effects from turning to mush. */
  var THROTTLE = {
    chaingun: 0.04, pistol: 0.05, hitFlesh: 0.05, hitWall: 0.05,
    enemyPain: 0.06, playerPain: 0.25
  };

  function play(name, volume) {
    if (!enabled || muted) return;
    init();
    if (!ctx || ctx.state !== 'running') return;
    var fn = bank[name];
    if (!fn) return;
    var t = now();
    var th = THROTTLE[name];
    if (th) {
      if (lastAt[name] !== undefined && t - lastAt[name] < th) return;
      lastAt[name] = t;
    }
    if (volume !== undefined && volume !== 1) {
      // cheap per-shot attenuation for distant sources
      var g = ctx.createGain();
      g.gain.value = U.clamp(volume, 0, 1);
      g.connect(master);
      var saved = master;
      master = g;
      try { fn(t + 0.001); } finally { master = saved; }
      return;
    }
    fn(t + 0.001);
  }

  /* Attenuate by distance from the listener. */
  function playAt(name, x, y, listener) {
    var dx = x - listener.x, dy = y - listener.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    var v = U.clamp(1 - d / 16, 0.08, 1);
    play(name, v * v);
  }

  function toggleMute() {
    muted = !muted;
    return muted;
  }

  return {
    init: init, resume: resume, play: play, playAt: playAt,
    toggleMute: toggleMute,
    isMuted: function () { return muted; },
    ready: function () { return !!ctx && ctx.state === 'running'; }
  };
})();
