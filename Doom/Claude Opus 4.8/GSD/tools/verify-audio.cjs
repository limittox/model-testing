/*
 * tools/verify-audio.cjs — the PHASE 6 SYNTHESIZED-AUDIO harness (AUD-01/02/03).
 *
 * NODE-ONLY (never referenced by index.html). Built on tools/boot.cjs: it boots the
 * SHIPPED script list in the SHIPPED order into one vm context with a stubbed DOM,
 * fires the window load event, and then drives REAL gameplay and reads back the
 * audio graph the engine actually BUILT.
 *
 * ============================================================================
 * HOW AUDIO IS MADE FALSIFIABLE WITHOUT LISTENING TO IT
 * ============================================================================
 * tools/boot.cjs deliberately has NO AudioContext and NO webkitAudioContext
 * binding, so the shipped files run in Node with audio simply absent. This harness
 * installs a MINIMAL RECORDING AudioContext stub on h.sandbox AFTER boot, which
 * captures every constructor call, every node factory call, every connect(), every
 * AudioParam schedule and every source start/stop.
 *
 * THAT POST-BOOT INSTALL IS ITSELF THE PROOF OF AUD-03's MECHANISM. js/sound.js
 * resolves the AudioContext constructor off the global INSIDE Sound.unlock(), at
 * call time — never at module load. If it captured the constructor at load it would
 * capture `undefined` here, the stub installed afterwards would never be reached,
 * and assertion 1b ("one click constructs exactly one context") could not pass at
 * all. The laziness is not a convention; it is the only thing that makes this
 * harness work, which is why 1a can then drive a full frame run AND a full
 * gameplay burst before the gesture and assert the constructor count is still 0.
 *
 * ============================================================================
 * EVERY NEGATIVE AND EVERY NUMBER IS CONTROL-PAIRED
 * ============================================================================
 * "No context was created" proves nothing if nothing could have created one, and
 * "no scheduled gain hit zero" proves nothing if the gain never moved. So every
 * negative claim here is paired with the positive recording that proves the
 * measurement is live, and every count is taken with Sound.reset() IMMEDIATELY
 * before the measured action. Expectations are DERIVED — from CONFIG.SFX, from
 * Sound.NAMES, from Sound.RECIPE_FOR, from Weapons.TABLE — never hardcoded.
 *
 * Prints PASS/FAIL per assertion and the terminal token ALL_AUDIO_CONTRACTS_PASS
 * only when every assertion passed.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { boot, assert, finish, GAME_DIR } = require('./boot.cjs');

const FRAME_MS = 1000 / 60;
const FRAME_DT = 1 / 60;

// ---------------------------------------------------------------------------
// THE RECORDING AudioContext STUB.
//
// It implements exactly the surface js/sound.js touches and nothing else — the
// six node factories, createBuffer, a settable `state`, a resume(), a currentTime
// and a destination — and every AudioParam it hands out records the VALUE, the
// TIME and the context's currentTime AT THE MOMENT OF THE CALL, which is what
// makes "everything is scheduled on the context's own clock" measurable.
//
// The four fault switches (throwOnCtor / rejectResume / throwOnFactory / no
// install at all) are what assertion 1i's four broken-audio scenarios are built
// from. A stub that could only succeed would make "it never throws" unfalsifiable.
// ---------------------------------------------------------------------------
function makeAudioStub(cfg) {
  const o = Object.assign({
    initialState: 'suspended',
    throwOnCtor: false,
    rejectResume: false,
    throwOnFactory: null,      // a factory name, e.g. 'createOscillator'
    sampleRate: 44100
  }, cfg || {});

  const rec = {
    ctors: 0,
    instances: [],
    resumes: 0,
    nodes: [],           // every node ever created, in creation order
    connects: [],        // {from, to} — the real recorded graph edges
    schedules: [],       // {nodeType,nodeId,param,method,value,time,now}
    starts: [],          // {nodeType,nodeId,time}
    stops: [],
    buffersCreated: 0,
    counts: Object.create(null)
  };

  let nextId = 1;

  function makeParam(node, name) {
    const p = { value: 0 };
    function push(method, v, t) {
      rec.schedules.push({
        nodeType: node.__type, nodeId: node.__id, param: name,
        method: method, value: v, time: t, now: node.__ctx.currentTime
      });
      p.value = v;
      return p;
    }
    p.setValueAtTime = (v, t) => push('setValueAtTime', v, t);
    p.linearRampToValueAtTime = (v, t) => push('linearRampToValueAtTime', v, t);
    p.exponentialRampToValueAtTime = (v, t) => push('exponentialRampToValueAtTime', v, t);
    p.setTargetAtTime = (v, t) => push('setTargetAtTime', v, t);
    p.cancelScheduledValues = () => p;
    return p;
  }

  function mkNode(ctx, type, params) {
    const node = { __type: type, __id: nextId++, __ctx: ctx };
    node.connect = function (dest) { rec.connects.push({ from: node, to: dest }); return dest; };
    node.disconnect = function () {};
    for (const pn of params) node[pn] = makeParam(node, pn);
    rec.nodes.push(node);
    rec.counts[type] = (rec.counts[type] || 0) + 1;
    return node;
  }

  function addSource(node) {
    node.start = function (t) {
      rec.starts.push({
        nodeType: node.__type, nodeId: node.__id,
        time: (t === undefined ? node.__ctx.currentTime : t)
      });
    };
    node.stop = function (t) {
      rec.stops.push({
        nodeType: node.__type, nodeId: node.__id,
        time: (t === undefined ? node.__ctx.currentTime : t)
      });
    };
    return node;
  }

  function AudioContextStub() {
    rec.ctors += 1;
    if (o.throwOnCtor) throw new Error('AudioContext construction refused by policy');
    const ctx = this;
    ctx.state = o.initialState;
    ctx.sampleRate = o.sampleRate;
    ctx.currentTime = 0;
    ctx.destination = mkNode(ctx, 'destination', []);
    ctx.resume = function () {
      rec.resumes += 1;
      ctx.state = 'running';
      return o.rejectResume
        ? Promise.reject(new Error('autoplay policy refused resume'))
        : Promise.resolve();
    };
    ctx.close = function () { ctx.state = 'closed'; return Promise.resolve(); };

    function guard(factoryName) {
      if (o.throwOnFactory === factoryName) throw new Error(factoryName + ' refused');
    }
    ctx.createGain = function () {
      guard('createGain');
      return mkNode(ctx, 'gain', ['gain']);
    };
    ctx.createBiquadFilter = function () {
      guard('createBiquadFilter');
      const n = mkNode(ctx, 'biquad', ['frequency', 'Q', 'gain', 'detune']);
      n.type = 'lowpass';
      return n;
    };
    ctx.createOscillator = function () {
      guard('createOscillator');
      const n = addSource(mkNode(ctx, 'oscillator', ['frequency', 'detune']));
      n.type = 'sine';
      return n;
    };
    ctx.createBufferSource = function () {
      guard('createBufferSource');
      const n = addSource(mkNode(ctx, 'bufferSource', ['playbackRate', 'detune']));
      n.buffer = null;
      n.loop = false;
      return n;
    };
    ctx.createDynamicsCompressor = function () {
      guard('createDynamicsCompressor');
      return mkNode(ctx, 'compressor',
        ['threshold', 'knee', 'ratio', 'attack', 'release', 'reduction']);
    };
    ctx.createBuffer = function (channels, length, sampleRate) {
      rec.buffersCreated += 1;
      const data = new Float32Array(length);
      return {
        numberOfChannels: channels,
        length: length,
        sampleRate: sampleRate,
        duration: length / sampleRate,
        getChannelData: function () { return data; }
      };
    };

    rec.instances.push(ctx);
  }

  return { ctor: AudioContextStub, rec: rec, options: o };
}

// ---------------------------------------------------------------------------
// A FRESH WORLD. Several assertions (a context born RUNNING, a constructor that
// throws, a resume that rejects, a factory that throws) can only be observed from
// a process state where the context has not already been built — Sound.unlock()
// is idempotent by contract, which is exactly what 1d asserts. So each of those
// gets its own boot.
//
// The stub is installed BEFORE h.fireLoad(), so main.js's whole boot sequence runs
// with a constructor available on the global. That is what turns 1a from "nothing
// could have built one" into "something could, and nothing did".
// ---------------------------------------------------------------------------
function freshWorld(stubCfg, bootOpts) {
  const hh = boot(bootOpts || {});
  const stub = (stubCfg === null) ? null : makeAudioStub(stubCfg);
  if (stub) hh.sandbox.AudioContext = stub.ctor;
  hh.fireLoad();
  return {
    h: hh,
    rec: stub ? stub.rec : null,
    s: hh.sandbox,
    click() { return hh.dispatch('game', 'click'); },
    frames(n) { for (let i = 0; i < n; i++) hh.raf.step(FRAME_MS); }
  };
}

// The primary world, used by sections 1a-1h, 2 and 4.
const W = freshWorld({});
const h = W.h;
const s = h.sandbox;
const rec = W.rec;

const CONFIG = s.CONFIG;
const Level = s.Level;
const Player = s.Player;
const Input = s.Input;
const Combat = s.Combat;
const Enemies = s.Enemies;
const Entities = s.Entities;
const Pickups = s.Pickups;
const Weapons = s.Weapons;
const Sound = s.Sound;
const Game = s.Game;
const S = Game.STATES;

console.log('--- synthesized audio harness ---');
console.log('recipes ' + Object.keys(CONFIG.SFX).join(', '));
console.log('events  ' + Object.keys(CONFIG.SFX_EVENTS).length + ', level ' + Level.WIDTH + 'x' +
  Level.HEIGHT + ', ' + Enemies.list.length + ' enemies, ' + Pickups.list.length + ' pickups');
console.log('');

// ---------------------------------------------------------------------------
// SHARED HELPERS.
// ---------------------------------------------------------------------------

// RECIPE KEY -> a representative EVENT name, derived by INVERTING Sound.RECIPE_FOR
// rather than typed out, so a renamed event moves the expectation with it.
function eventForRecipe(recipeKey) {
  const names = Object.keys(Sound.RECIPE_FOR);
  for (const n of names) if (Sound.RECIPE_FOR[n] === recipeKey) return n;
  return null;
}

const RECIPE_KEYS = Object.keys(CONFIG.SFX);
// The SIX AUD-02 effects, in the order the requirement names them.
const SIX = ['pistol', 'shotgun', 'enemyAttack', 'enemyDeath', 'pickup', 'playerHurt'];

// Play one event and return everything the stub recorded for it alone.
function recordPlay(eventName) {
  const n0 = rec.nodes.length, c0 = rec.connects.length,
    s0 = rec.schedules.length, st0 = rec.starts.length, sp0 = rec.stops.length,
    b0 = rec.buffersCreated;
  Sound.play(eventName);
  return {
    event: eventName,
    nodes: rec.nodes.slice(n0),
    connects: rec.connects.slice(c0),
    schedules: rec.schedules.slice(s0),
    starts: rec.starts.slice(st0),
    stops: rec.stops.slice(sp0),
    buffers: rec.buffersCreated - b0
  };
}

function typeSig(win) { return win.nodes.map((n) => n.__type).join('>'); }

function firstFreq(win) {
  for (const sc of win.schedules) if (sc.param === 'frequency') return sc.value;
  return null;
}

function nearestEnemy() {
  let best = null, bd = Infinity;
  for (const e of Enemies.list) {
    if (e.alive !== true) continue;
    const d = Math.hypot(e.x - Player.x, e.y - Player.y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function placeAt(x, y, dx, dy) {
  Player.x = x; Player.y = y;
  Player.setDir(dx === undefined ? 1 : dx, dy === undefined ? 0 : dy);
}

// ===========================================================================
// 0. THE ENGINE EXISTS AND ITS SURFACE IS THE PHASE 5 SURFACE.
// ===========================================================================
(function () {
  assert(typeof Sound === 'object' && Sound !== null && typeof Sound.play === 'function' &&
    typeof Sound.unlock === 'function' && typeof Sound.reset === 'function',
    '0a. the Sound surface is intact (play / unlock / reset) after the engine replaced the stub');

  // THE CONSTRAINT THAT OUTRANKS EVERYTHING ELSE IN THIS PLAN: no context FIELD.
  // verify-pickups 0d and verify-state 1g both assert this, and the engine keeps it
  // true by holding the context in a module-scope variable behind an accessor.
  assert(!('ctx' in Sound) && !('audioContext' in Sound),
    '0b. AUD-03: there is still NO context field on Sound (no `ctx`, no ' +
    '`audioContext`) — the context lives in a module-scope variable behind ' +
    'Sound.context(), which is what keeps verify-pickups 0d and verify-state 1g green');

  assert(typeof Sound.context === 'function' && typeof Sound.isAvailable === 'function',
    '0c. the accessors exist (Sound.context() / Sound.isAvailable()) — observability ' +
    'without a public field');

  assert(typeof CONFIG.SFX === 'object' && RECIPE_KEYS.length >= SIX.length &&
    SIX.every((k) => CONFIG.SFX[k] !== undefined),
    '0d. CONFIG.SFX holds a recipe for each of AUD-02\'s six effects (' +
    RECIPE_KEYS.length + ' recipes: ' + RECIPE_KEYS.join(',') + ')');

  assert(typeof Sound.RECIPE_FOR === 'object' &&
    Object.keys(Sound.RECIPE_FOR).length === Object.keys(CONFIG.SFX_EVENTS).length,
    '0e. Sound.RECIPE_FOR maps EVERY one of the ' + Object.keys(CONFIG.SFX_EVENTS).length +
    ' CONFIG.SFX_EVENTS names onto a recipe (' + Object.keys(Sound.RECIPE_FOR).length + ' entries)');

  const everyRecipeReal = Object.keys(Sound.RECIPE_FOR)
    .every((n) => CONFIG.SFX[Sound.RECIPE_FOR[n]] !== undefined);
  assert(everyRecipeReal,
    '0f. every recipe key Sound.RECIPE_FOR names EXISTS in CONFIG.SFX — no event ' +
    'resolves to a recipe that was never written');

  // js/pickups.js's four sound names must still be the four Phase 5 strings.
  const pickupNames = ['pickupHealth', 'pickupArmor', 'pickupAmmo', 'pickupWeapon'];
  const kept = pickupNames.every((n) => Object.keys(Sound.RECIPE_FOR).indexOf(n) >= 0) &&
    Sound.NAMES.HEALTH === 'pickupHealth' && Sound.NAMES.ARMOR === 'pickupArmor' &&
    Sound.NAMES.AMMO === 'pickupAmmo' && Sound.NAMES.WEAPON === 'pickupWeapon';
  assert(kept,
    '0g. the four Phase 5 pickup event names are UNCHANGED (' + pickupNames.join(',') +
    ') — every Phase 5 assertion that reads Sound.last still measures the same strings');

  assert(Game.state === S.TITLE,
    '0h. setup: the world booted into the TITLE state — every 1a measurement below ' +
    'happens strictly BEFORE the start gesture');
})();

// ===========================================================================
// 1a. NOTHING AT LOAD, AND NOTHING BEFORE THE GESTURE (AUD-03, threat T-06-16).
//
// The stub was installed BEFORE fireLoad, so a constructor WAS available on the
// global for the whole of main.js's boot and for every frame and every gameplay
// event below. The count staying at 0 is therefore a real refusal, not an absence
// of opportunity.
// ===========================================================================
(function () {
  assert(rec.ctors === 0 && Sound.context() === null,
    '1a-i. AUD-03: after the load handler — with an AudioContext constructor sitting ' +
    'on the global — ZERO contexts were constructed and Sound.context() is null');

  assert(Sound.isAvailable() === false,
    '1a-ii. before the gesture the engine reports audio UNAVAILABLE (so every play ' +
    'below exercises the no-audio path)');

  // A full frame run in the title state.
  W.frames(60);
  assert(rec.ctors === 0,
    '1a-iii. AUD-03: 60 real rAF frames before any gesture constructed ZERO contexts');

  // A full GAMEPLAY BURST, driven directly (the title state freezes Game.frame's
  // step, so the events are provoked through the simulation primitives).
  const before = Sound.count;
  placeAt(Level.LANDMARKS.openCell.x, Level.LANDMARKS.openCell.y, 1, 0);
  Weapons.fire();                                   // pistol fire
  Combat.damagePlayer(11);                          // player damage
  const e = nearestEnemy();
  if (e) Enemies.hurt(e, 99999);                    // enemy death
  Enemies.spawnProjectile(Enemies.list[0] || { x: Player.x + 2, y: Player.y }); // enemy attack
  for (const p of Pickups.list) { if (p.active === true) { Pickups.collect(p); break; } }
  for (let i = 0; i < 30; i++) Game.step(FRAME_DT);

  assert(Sound.count > before,
    '1a-iv. CONTROL: that pre-gesture burst really did reach the hook — Sound.count ' +
    before + ' -> ' + Sound.count + ' (so 1a-v is about a refusal, not about silence)');

  assert(rec.ctors === 0 && Sound.context() === null && rec.nodes.length === 0,
    '1a-v. AUD-03: a full pre-gesture gameplay burst (' + (Sound.count - before) +
    ' recorded events: fire, damage, a kill, a projectile, a collection, 30 steps) ' +
    'constructed ZERO contexts and ZERO audio nodes — audio is GESTURE-scoped, not ' +
    'lazily-on-first-sound');
})();

// ===========================================================================
// 1b/1e. THE GESTURE CONSTRUCTS EXACTLY ONE CONTEXT AND BUILDS THE MASTER CHAIN.
// ===========================================================================
const gestureWindow = (function () {
  const n0 = rec.nodes.length;
  const c0 = rec.connects.length;
  const unlocks0 = Sound.unlockCalls;

  W.click();

  const created = rec.nodes.slice(n0);
  const edges = rec.connects.slice(c0);

  assert(rec.ctors === 1 && rec.instances.length === 1,
    '1b-i. AUD-03: ONE canvas click took the AudioContext constructor count from 0 to ' +
    'EXACTLY 1 (' + rec.ctors + ')');
  assert(Sound.context() === rec.instances[0],
    '1b-ii. Sound.context() holds that very instance (strict identity)');
  assert(Sound.unlockCalls - unlocks0 === 1 && Game.state === S.PLAYING,
    '1b-iii. the same click invoked the unlock seam exactly once AND started play — ' +
    'one gesture, both effects');
  assert(Sound.isAvailable() === true,
    '1b-iv. audio is now reported AVAILABLE (the flag moved with the construction)');

  // --- 1c: RESUME, and its control ------------------------------------------
  assert(rec.resumes === 1 && rec.instances[0].state === 'running',
    '1c-i. the context was constructed SUSPENDED and the gesture called resume() ' +
    'EXACTLY once (' + rec.resumes + '), leaving it running');

  // --- 1e: THE MASTER CHAIN, walked from the recorded edges ------------------
  const gains = created.filter((n) => n.__type === 'gain');
  const comps = created.filter((n) => n.__type === 'compressor');
  assert(gains.length === 1 && comps.length === 1,
    '1e-i. the gesture created EXACTLY one gain node and one compressor for the ' +
    'master bus (' + gains.length + ' gain, ' + comps.length + ' compressor)');

  const master = gains[0], comp = comps[0], dest = rec.instances[0].destination;
  const hasEdge = (from, to) => edges.some((e) => e.from === from && e.to === to);
  assert(hasEdge(master, comp) && hasEdge(comp, dest),
    '1e-ii. the RECORDED connections form master gain -> compressor -> destination ' +
    '(walked from the connect() log, not read off a field the code could set without ' +
    'connecting anything)');
  assert(!hasEdge(master, dest),
    '1e-iii. the master gain does NOT connect to the destination directly — the ' +
    'compressor is genuinely in the path (threat T-06-20)');
  assert(Sound.masterNode() === master && Sound.compressorNode() === comp,
    '1e-iv. the accessors name the same two nodes the connect log implicates');
  assert(rec.buffersCreated === 1 && Sound.noiseBufferRef() !== null,
    '1e-v. the ONE shared white-noise buffer was created at unlock (' +
    rec.buffersCreated + ' createBuffer call)');

  return { master, comp, dest, created, edges };
})();

// --- 1c CONTROL: a context born RUNNING must record ZERO resumes -------------
(function () {
  const R = freshWorld({ initialState: 'running' });
  R.click();
  assert(R.rec.ctors === 1 && R.rec.resumes === 0,
    '1c-ii. CONTROL: a context constructed already RUNNING records ZERO resume calls ' +
    '(' + R.rec.resumes + ') — the engine resumes when it needs to, not unconditionally');
  assert(R.s.Sound.isAvailable() === true && R.s.Sound.context() !== null,
    '1c-iii. CONTROL: and audio is still AVAILABLE without a resume — the availability ' +
    'flag is not a side effect of resuming');
})();

// ===========================================================================
// 1d. IDEMPOTENT — every click unlocks, only the first one builds.
// ===========================================================================
(function () {
  const first = Sound.context();
  const unlocks0 = Sound.unlockCalls;
  const nodes0 = rec.nodes.length;
  for (let i = 0; i < 5; i++) W.click();

  assert(rec.ctors === 1 && Sound.context() === first,
    '1d-i. five FURTHER clicks left the constructor count at 1 and Sound.context() at ' +
    'the SAME instance by reference — the second click is a resume, never a second graph');
  assert(Sound.unlockCalls - unlocks0 === 5,
    '1d-ii. CONTROL: those five clicks each DID reach the seam (unlockCalls +' +
    (Sound.unlockCalls - unlocks0) + ') — 1d-i is idempotence, not a dropped call');
  assert(rec.nodes.length === nodes0,
    '1d-iii. and they created ZERO further nodes (' + nodes0 + ' -> ' + rec.nodes.length +
    ') — the master chain is built exactly once');
})();

// ===========================================================================
// 1f. PER-SOUND ROUTING — every sound mixes into the MASTER, never the output.
// ===========================================================================
(function () {
  const master = gestureWindow.master;
  const dest = gestureWindow.dest;

  Sound.reset();
  const win = recordPlay(Sound.NAMES.PISTOL);

  const toMaster = win.connects.filter((e) => e.to === master);
  const toDest = win.connects.filter((e) => e.to === dest);
  assert(toMaster.length === 1 && toMaster[0].from.__type === 'gain',
    '1f-i. one Sound.play created a FRESH per-sound gain and connected EXACTLY that ' +
    'one node to the master gain (' + toMaster.length + ' edge into master, from a ' +
    (toMaster[0] ? toMaster[0].from.__type : 'none') + ')');
  assert(toMaster[0].from !== master,
    '1f-ii. that per-sound gain is a DIFFERENT node from the master gain (a fresh ' +
    'node per sound, not the bus reused)');
  assert(toDest.length === 0,
    '1f-iii. NOTHING the sound created connects to ctx.destination directly (' +
    toDest.length + ' such edges) — the compressor cannot be bypassed');
  assert(win.nodes.length > 0 && Sound.count === 1,
    '1f-iv. CONTROL: that play really did build a graph (' + win.nodes.length +
    ' nodes: ' + typeSig(win) + ') and the recorder still counted it exactly once');
})();

// ===========================================================================
// 1g. ENVELOPES NEVER HIT ZERO (threat T-06-19) — with a live-decay control.
//
// exponentialRampToValueAtTime(0, t) is the classic Web Audio throw. Every recipe
// therefore ramps to its own positive `epsilon` floor.
// ===========================================================================
(function () {
  let allGain = [];
  for (const key of RECIPE_KEYS) {
    const ev = eventForRecipe(key);
    Sound.reset();
    const win = recordPlay(ev);
    allGain = allGain.concat(win.schedules.filter((sc) => sc.param === 'gain'));
  }

  assert(allGain.length >= RECIPE_KEYS.length * 2,
    '1g-0. setup: playing all ' + RECIPE_KEYS.length + ' recipes scheduled ' +
    allGain.length + ' gain values (the measurement is live)');

  const positive = allGain.every((sc) => sc.value > 0);
  const worst = allGain.reduce((m, sc) => Math.min(m, sc.value), Infinity);
  assert(positive,
    '1g-i. T-06-19: across EVERY recipe, every scheduled gain value is strictly ' +
    'greater than 0 (smallest ' + worst.toExponential(3) + ') — no envelope ramps to ' +
    'exactly zero');

  // The control: at least one scheduled value must be TINY, or "all values are
  // positive" would pass on a constant loud gain that never decays at all.
  const TINY = 0.01;
  const small = allGain.filter((sc) => sc.value < TINY);
  assert(small.length >= RECIPE_KEYS.length,
    '1g-ii. CONTROL: at least one scheduled value per recipe is below ' + TINY + ' (' +
    small.length + ' of ' + allGain.length + ') — these are real DECAYS to a floor, ' +
    'not a constant gain that trivially satisfies 1g-i');

  const everyEpsUsed = RECIPE_KEYS.every((k) =>
    allGain.some((sc) => sc.value === CONFIG.SFX[k].epsilon));
  assert(everyEpsUsed,
    '1g-iii. every recipe\'s floor is the epsilon from ITS OWN CONFIG record (derived, ' +
    'not a shared literal in js/sound.js)');

  const expo = allGain.filter((sc) => sc.method === 'exponentialRampToValueAtTime');
  assert(expo.length === RECIPE_KEYS.length && expo.every((sc) => sc.value > 0),
    '1g-iv. each recipe ends on exactly one EXPONENTIAL gain ramp and its target is ' +
    'positive (' + expo.length + ' ramps) — the exact call that would throw on 0');
})();

// ===========================================================================
// 1h. SCHEDULING IS ON THE CONTEXT'S OWN CLOCK.
//
// The stub's currentTime is ADVANCED before the measured plays, so "times are >=
// now" is a real test rather than a comparison against a frozen 0.
// ===========================================================================
(function () {
  const ctx = rec.instances[0];
  const CLOCKS = [0, 1.5, 37.25];
  let sched = [], starts = [], stops = [];

  for (const t of CLOCKS) {
    ctx.currentTime = t;
    for (const key of RECIPE_KEYS) {
      Sound.reset();
      const win = recordPlay(eventForRecipe(key));
      sched = sched.concat(win.schedules);
      starts = starts.concat(win.starts);
      stops = stops.concat(win.stops);
    }
  }

  assert(sched.length > 0 && new Set(sched.map((sc) => sc.now)).size === CLOCKS.length,
    '1h-0. setup: the recipes were scheduled at ' + CLOCKS.length + ' DIFFERENT context ' +
    'clock readings (' + CLOCKS.join(', ') + ') — ' + sched.length + ' schedules recorded');

  const notPast = sched.every((sc) => isFinite(sc.time) && sc.time >= sc.now);
  assert(notPast,
    '1h-i. every recorded schedule time is >= the context\'s currentTime AT THE MOMENT ' +
    'OF THE CALL — nothing is scheduled into the past and nothing uses a wall clock');

  const movedWithClock = sched.some((sc) => sc.now === 37.25 && sc.time >= 37.25);
  assert(movedWithClock,
    '1h-ii. CONTROL: the schedule times MOVED with the context clock (values at or past ' +
    '37.25 exist) — 1h-i is not passing because every time is 0');

  // Every source starts and stops, and the stop is strictly after the start.
  let paired = starts.length > 0 && starts.length === stops.length;
  for (const st of starts) {
    const sp = stops.find((x) => x.nodeId === st.nodeId);
    if (!sp || !(sp.time > st.time)) { paired = false; break; }
  }
  assert(paired,
    '1h-iii. every source records a start AND a stop (' + starts.length + '/' +
    stops.length + ') with the stop strictly AFTER the start — nodes drain themselves ' +
    'instead of accumulating (threat T-06-18)');

  ctx.currentTime = 0;
})();

// ===========================================================================
// 1i. NEVER THROWS, FOUR WAYS (threat T-06-17).
//
// Each scenario gets its OWN boot, because unlock() is idempotent and a context
// already built cannot be un-built. In every case the RECORDER must still have
// advanced: it runs BEFORE the synthesis attempt, so a broken audio stack cannot
// make a single Phase 5 assertion vacuous.
// ===========================================================================
function brokenAudioCase(label, stubCfg, expectCtors) {
  const B = freshWorld(stubCfg);
  const bs = B.s;
  let threw = null;

  try {
    B.click();                                   // may construct / resume
    bs.Sound.reset();
    for (const key of Object.keys(bs.CONFIG.SFX)) {
      const names = Object.keys(bs.Sound.RECIPE_FOR);
      const ev = names.find((n) => bs.Sound.RECIPE_FOR[n] === key);
      bs.Sound.play(ev);
    }
    // And gameplay must keep running: real frames, in the playing state.
    B.frames(60);
  } catch (err) {
    threw = err;
  }

  const played = Object.keys(bs.CONFIG.SFX).length;
  const ok = threw === null && bs.Sound.count === played &&
    bs.Game.time > 0 && bs.Sound.isAvailable() === false;
  assert(ok,
    '1i-' + label + '. Sound.play did not throw, the recorder still counted every event (' +
    bs.Sound.count + '/' + played + '), 60 further frames ran (Game.time ' +
    bs.Game.time.toFixed(3) + ') and audio reports itself unavailable' +
    (threw ? ' — THREW: ' + threw.message : ''));

  if (expectCtors !== undefined && B.rec) {
    assert(B.rec.ctors === expectCtors,
      '1i-' + label + '-c. CONTROL: the scenario really was exercised (constructor ' +
      'calls ' + B.rec.ctors + ', expected ' + expectCtors + ')');
  }
  return B;
}

// (i) NO AudioContext binding at all — exactly the shipped Node sandbox.
(function () {
  const B = freshWorld(null);
  let threw = null;
  try {
    B.click();
    B.s.Sound.reset();
    B.s.Sound.play(B.s.Sound.NAMES.SHOTGUN);
    B.frames(60);
  } catch (err) { threw = err; }
  assert(threw === null && B.s.Sound.count === 1 && B.s.Sound.context() === null &&
    B.s.Sound.isAvailable() === false && B.s.Game.time > 0,
    '1i-i. NO AudioContext binding on the global at all: the gesture built nothing, ' +
    'Sound.play still recorded (count ' + B.s.Sound.count + ') and returned, and 60 ' +
    'frames ran' + (threw ? ' — THREW: ' + threw.message : ''));
  assert(typeof B.s.Sound.lastError === 'string' &&
    B.s.Sound.lastError.indexOf('AudioContext') >= 0,
    '1i-i-c. CONTROL: the engine RECORDED why (' + B.s.Sound.lastError + ') — the path ' +
    'was genuinely taken rather than skipped');
})();

// (ii) the constructor throws.
(function () {
  const B = brokenAudioCase('ii', { throwOnCtor: true }, 1);
  assert(B.s.Sound.context() === null,
    '1i-ii-d. a THROWING constructor leaves Sound.context() null, so a later gesture ' +
    'is still free to try again');
})();

// (iii) resume() rejects.
(function () {
  const B = freshWorld({ rejectResume: true });
  let threw = null;
  try {
    B.click();
    B.s.Sound.reset();
    B.s.Sound.play(B.s.Sound.NAMES.ENEMY_DEATH);
    B.frames(60);
  } catch (err) { threw = err; }
  assert(threw === null && B.rec.resumes === 1 && B.s.Sound.count === 1 &&
    B.s.Game.time > 0,
    '1i-iii. a REJECTING resume() does not throw and does not stop the game (resumes ' +
    B.rec.resumes + ', recorded ' + B.s.Sound.count + ', Game.time ' +
    B.s.Game.time.toFixed(3) + ')' + (threw ? ' — THREW: ' + threw.message : ''));
  assert(B.s.Sound.isAvailable() === true && B.rec.nodes.length > 0,
    '1i-iii-c. CONTROL: a refused resume leaves the GRAPH usable (' + B.rec.nodes.length +
    ' nodes built) — a policy refusal is not a broken context, and the next gesture ' +
    'may well succeed');
})();

// (iv) a node factory throws MID-RECIPE.
(function () {
  const B = freshWorld({ throwOnFactory: 'createOscillator' });
  let threw = null;
  const evs = ['PISTOL', 'SHOTGUN', 'ENEMY_ATTACK', 'ENEMY_DEATH', 'PLAYER_HURT', 'HEALTH'];
  try {
    B.click();
    B.s.Sound.reset();
    for (const k of evs) B.s.Sound.play(B.s.Sound.NAMES[k]);
    B.frames(60);
  } catch (err) { threw = err; }
  assert(threw === null && B.s.Sound.count === evs.length && B.s.Game.time > 0,
    '1i-iv. a node factory throwing MID-RECIPE does not throw out of Sound.play — all ' +
    evs.length + ' events still recorded (' + B.s.Sound.count + ') and 60 frames ran' +
    (threw ? ' — THREW: ' + threw.message : ''));
  assert(B.s.Sound.lastError !== null && B.s.Sound.lastError.indexOf('play(') === 0,
    '1i-iv-c. CONTROL: the failure was recorded from inside play (' +
    B.s.Sound.lastError + ') — the throwing factory really was reached');
  // The shotgun and the dry click have no oscillator layer, so THEY still build a
  // full graph: the failure is per-recipe, not a global audio shutdown.
  const built = B.rec.nodes.filter((n) => n.__type === 'bufferSource').length;
  assert(built > 0,
    '1i-iv-d. CONTROL: the noise-only recipes still built their graphs (' + built +
    ' buffer sources) — one broken layer does not disable the whole engine');
})();

// ===========================================================================
// 1j. THE PHASE 5 RECORDER SEMANTICS ARE INTACT, WITH NO AUDIO AT ALL.
//
// Measured in the NO-BINDING world, because that is the state every Phase 1-5
// harness runs in: if the engine only kept its contract when audio worked, roughly
// a dozen Phase 5 assertions would be measuring nothing.
// ===========================================================================
(function () {
  const B = freshWorld(null);
  const So = B.s.Sound;
  So.reset();

  const ringBefore = So.ring;
  const rejected = [So.play(''), So.play(null), So.play(undefined), So.play(7), So.play({})];
  assert(rejected.every((r) => r === false) && So.count === 0 && So.last === null,
    '1j-i. with no audio available: an empty or non-string name returns FALSE and ' +
    'records NOTHING (count ' + So.count + ') — the Phase 5 guard is byte-identical');

  const ok = So.play(So.NAMES.AMMO);
  assert(ok === true && So.count === 1 && So.last === So.NAMES.AMMO &&
    So.ring[0] === So.NAMES.AMMO && So.head === 1,
    '1j-ii. a valid name returns TRUE, sets last, increments count and writes the ring ' +
    'at the head with a wrap — exactly as Phase 5 asserts');

  // An unknown name has no recipe, and must still record exactly as before.
  const unknown = So.play('somethingNobodyWired');
  assert(unknown === true && So.count === 2 && So.last === 'somethingNobodyWired',
    '1j-iii. an UNKNOWN event name still records and still returns true (it simply has ' +
    'no recipe to play) — the hook is not a whitelist');

  So.reset();
  assert(So.last === null && So.count === 0 && So.head === 0 &&
    So.unlockCalls === 0 && So.ring === ringBefore &&
    So.ring.length === So.RING_SIZE && So.ring.every((v) => v === null),
    '1j-iv. Sound.reset() clears last, count, head and unlockCalls and nulls the ring ' +
    'IN PLACE — the ring array identity is preserved (RING_SIZE ' + So.RING_SIZE + ')');
})();

// ===========================================================================
// 1k. NO AUDIO FILE EXISTS (AUD-01, threat T-06-22) — the first pass; section 3
//     is the full self-containment gate with the index.html reference check.
// ===========================================================================

// Strip comments so a header paragraph EXPLAINING the rule cannot fail its own
// rule. The `[^:]` guard on the line-comment pattern keeps a `http://`-style token
// in real code from being mistaken for a comment start.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const JS_DIR = path.join(GAME_DIR, 'js');
const JS_FILES = fs.readdirSync(JS_DIR).filter((f) => /\.js$/i.test(f)).sort();
const STRIPPED = JS_FILES.map((f) => ({
  file: f,
  src: stripComments(fs.readFileSync(path.join(JS_DIR, f), 'utf8'))
}));

const FORBIDDEN = [
  { label: 'fetch(', re: /\bfetch\s*\(/ },
  { label: 'XMLHttpRequest', re: /\bXMLHttpRequest\b/ },
  { label: 'decodeAudioData', re: /\bdecodeAudioData\b/ },
  { label: 'new Audio(', re: /\bnew\s+Audio\s*\(/ },
  { label: 'importScripts', re: /\bimportScripts\b/ },
  { label: 'audio file extension', re: /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)\b/i }
];

(function () {
  const hits = [];
  for (const f of STRIPPED) {
    for (const t of FORBIDDEN) if (t.re.test(f.src)) hits.push(f.file + ':' + t.label);
  }
  assert(hits.length === 0,
    '1k-i. AUD-01: a comment-stripped scan of all ' + JS_FILES.length + ' files under js/ ' +
    'finds NO fetch, XMLHttpRequest, decodeAudioData, Audio constructor, importScripts ' +
    'or audio file extension' + (hits.length ? ' — FOUND ' + hits.join(', ') : ''));

  // THE CONTROL: the scanner must find a token that IS there, or 1k-i could be
  // passing against an empty string.
  const found = STRIPPED.filter((f) => /\bAudioContext\b/.test(f.src)).map((f) => f.file);
  assert(found.length > 0 && found.indexOf('sound.js') >= 0,
    '1k-ii. CONTROL: the SAME stripped scan DOES find `AudioContext` in [' +
    found.join(', ') + '] — it is reading real source, not an empty string');

  const osc = STRIPPED.filter((f) => /createOscillator|createBufferSource/.test(f.src))
    .map((f) => f.file);
  assert(osc.indexOf('sound.js') >= 0,
    '1k-iii. CONTROL: and it finds the SYNTHESIS calls (createOscillator / ' +
    'createBufferSource) in [' + osc.join(', ') + '] — the effects are built, not loaded');
})();

// ===========================================================================
finish("ALL_AUDIO_CONTRACTS_PASS");
