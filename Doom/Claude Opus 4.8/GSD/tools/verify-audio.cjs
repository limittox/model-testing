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
//
// THE COUNT IS TAKEN BEFORE THE FRAME RUN, DELIBERATELY. The five call sites plan
// 06-03 wired mean 60 real frames of a live level fire genuine sounds of their own
// (an enemy attack, a fireball landing), so an exact count taken afterwards would
// be measuring the level rather than the recorder. The explicit plays are counted
// first; the frame run afterwards is the "gameplay continues" half of the claim,
// and it drives every one of those new call sites through the broken audio stack.
function brokenAudioCase(label, stubCfg, expectCtors) {
  const B = freshWorld(stubCfg);
  const bs = B.s;
  let threw = null;
  let counted = -1;

  try {
    B.click();                                   // may construct / resume
    bs.Sound.reset();
    for (const key of Object.keys(bs.CONFIG.SFX)) {
      const names = Object.keys(bs.Sound.RECIPE_FOR);
      const ev = names.find((n) => bs.Sound.RECIPE_FOR[n] === key);
      bs.Sound.play(ev);
    }
    counted = bs.Sound.count;
    // And gameplay must keep running: real frames, in the playing state.
    B.frames(60);
  } catch (err) {
    threw = err;
  }

  const played = Object.keys(bs.CONFIG.SFX).length;
  const ok = threw === null && counted === played &&
    bs.Game.time > 0 && bs.Sound.isAvailable() === false;
  assert(ok,
    '1i-' + label + '. Sound.play did not throw, the recorder still counted every event (' +
    counted + '/' + played + '), 60 further frames ran (Game.time ' +
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
  let counted = -1;
  try {
    B.click();
    B.s.Sound.reset();
    B.s.Sound.play(B.s.Sound.NAMES.SHOTGUN);
    counted = B.s.Sound.count;      // counted BEFORE the frame run — see the note above
    B.frames(60);
  } catch (err) { threw = err; }
  assert(threw === null && counted === 1 && B.s.Sound.context() === null &&
    B.s.Sound.isAvailable() === false && B.s.Game.time > 0,
    '1i-i. NO AudioContext binding on the global at all: the gesture built nothing, ' +
    'Sound.play still recorded (count ' + counted + ') and returned, and 60 ' +
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
  let counted = -1;
  try {
    B.click();
    B.s.Sound.reset();
    B.s.Sound.play(B.s.Sound.NAMES.ENEMY_DEATH);
    counted = B.s.Sound.count;
    B.frames(60);
  } catch (err) { threw = err; }
  assert(threw === null && B.rec.resumes === 1 && counted === 1 &&
    B.s.Game.time > 0,
    '1i-iii. a REJECTING resume() does not throw and does not stop the game (resumes ' +
    B.rec.resumes + ', recorded ' + counted + ', Game.time ' +
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
  let counted = -1;
  try {
    B.click();
    B.s.Sound.reset();
    for (const k of evs) B.s.Sound.play(B.s.Sound.NAMES[k]);
    counted = B.s.Sound.count;
    B.frames(60);
  } catch (err) { threw = err; }
  assert(threw === null && counted === evs.length && B.s.Game.time > 0,
    '1i-iv. a node factory throwing MID-RECIPE does not throw out of Sound.play — all ' +
    evs.length + ' events still recorded (' + counted + ') and 60 frames ran' +
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
// 2. THE SIX EFFECTS FIRE FROM THE REAL GAMEPLAY CODE PATHS (AUD-02).
//
// EVERY COUNT IS TAKEN WITH Sound.reset() IMMEDIATELY BEFORE THE MEASURED ACTION,
// so no unrelated event can inflate it, and every measured action produces at most
// RING_SIZE events so the per-NAME read out of the ring is complete rather than
// clipped (assertCompleteRing enforces exactly that).
//
// The expected names are DERIVED — from Weapons.TABLE for the two weapons, from
// CONFIG.SFX_EVENTS everywhere else — so a renamed event moves the expectation
// with it instead of silently passing against a stale literal.
// ===========================================================================

const EV = CONFIG.SFX_EVENTS;

function intent(fire, slot) {
  return {
    forward: 0, strafe: 0, turn: 0, mouseDX: 0, run: false,
    fire: fire === true, weaponSlot: slot || 0
  };
}

// A clean PLAYING world with the level's own enemies OUT of the AI update set —
// this section counts sounds, and a fireball landing mid-proof would add a
// player-damage event for a reason that has nothing to do with the proof. The
// enemies stay in Entities.list as billboards, so nothing is orphaned. Each proof
// composes exactly the actors it wants with Enemies.add.
function scenario(px, py) {
  Game.setState(S.PLAYING);
  Level.build();
  Combat.reset();
  Enemies.reset();                 // Entities.build() + Pickups.build(), together
  Enemies.list.length = 0;
  for (const p of Enemies.projectiles) p.active = false;
  Weapons.reset();
  Game.resetStats();
  placeAt(px === undefined ? Level.LANDMARKS.openCell.x : px,
    py === undefined ? Level.LANDMARKS.openCell.y : py, 1, 0);
  Sound.reset();
}

// The names recorded since the last reset, newest first. Only complete while at
// most RING_SIZE events have happened, which every caller asserts.
function playedNames() { return Sound.recent(Sound.RING_SIZE); }
function countName(name) { return playedNames().filter((n) => n === name).length; }
function ringComplete() { return Sound.count <= Sound.RING_SIZE; }
function ammoField() { return Weapons.TABLE[Combat.weapon].ammo; }
function activeProjectiles() {
  return Enemies.projectiles.filter((p) => p.active === true).length;
}
function freshEnemy(x, y) {
  const e = Enemies.add(x, y);
  e.state = Enemies.CHASE;
  e.cooldown = 1e9;               // park the attack gate unless a proof wants it
  return e;
}

const PISTOL_EV = Weapons.TABLE.pistol.sound;
const SHOTGUN_EV = Weapons.TABLE.shotgun.sound;

// --- 2a PISTOL: one shot, one report ---------------------------------------
(function () {
  assert(PISTOL_EV === EV.PISTOL && SHOTGUN_EV === EV.SHOTGUN,
    '2a-0. setup: each Weapons.TABLE entry NAMES its own sound event (' + PISTOL_EV +
    ' / ' + SHOTGUN_EV + ') — the fire path routes through data, not a branch');

  scenario();
  const bullets0 = Combat.ammo[ammoField()];
  Sound.reset();
  const fired = Weapons.fire();
  assert(fired === true && ringComplete() && Sound.count === 1 &&
    countName(PISTOL_EV) === 1,
    '2a-i. AUD-02: ONE successful pistol shot records EXACTLY one play of ' + PISTOL_EV +
    ' (count ' + Sound.count + ', names [' + playedNames().join(',') + '])');
  assert(Combat.ammo[ammoField()] === bullets0 - 1,
    '2a-ii. and it still spent exactly one round (' + bullets0 + ' -> ' +
    Combat.ammo[ammoField()] + ') — the sound is inert with respect to ammo');

  // CONTROL: the same trigger with an EMPTY weapon records nothing at all.
  Combat.ammo[ammoField()] = 0;
  Weapons.cooldown = 0;
  Sound.reset();
  const refused = Weapons.fire();
  assert(refused === false && Sound.count === 0,
    '2a-iii. CONTROL: the same trigger press at ZERO ammo records ZERO plays (count ' +
    Sound.count + ') — the sound is below the ammo gate, not above it');
})();

// --- 2b SHOTGUN: one blast, one report — NOT one per pellet -----------------
(function () {
  scenario();
  Combat.grantShotgun();
  Combat.selectWeapon(Combat.SHOTGUN);
  const pellets = Weapons.TABLE.shotgun.pellets;
  assert(Combat.weapon === Combat.SHOTGUN && pellets > 1 &&
    Combat.ammo[ammoField()] > 0,
    '2b-0. setup: the shotgun is granted, selected and loaded, and it fires ' + pellets +
    ' pellets — so "one per shot" and "one per pellet" are distinguishable');

  Weapons.cooldown = 0;
  Sound.reset();
  const fired = Weapons.fire();
  assert(fired === true && ringComplete() && Sound.count === 1 &&
    countName(SHOTGUN_EV) === 1 && countName(PISTOL_EV) === 0,
    '2b-i. AUD-02: one shotgun blast records EXACTLY one play of ' + SHOTGUN_EV +
    ' and zero of ' + PISTOL_EV + ' — ONE report, not ' + pellets + ' (count ' +
    Sound.count + ')');
  assert(Weapons.lastRayCount === pellets,
    '2b-ii. CONTROL: that single report really did cast all ' + Weapons.lastRayCount +
    ' pellet rays — the sound is outside the pellet loop, not instead of it');
})();

// --- 2c THE DRY CLICK IS EDGE-GATED, AND THE EDGE RE-ARMS -------------------
(function () {
  scenario();
  Combat.ammo[ammoField()] = 0;
  Weapons.cooldown = 0;
  Sound.reset();

  const dry0 = Weapons.dryFires;
  for (let i = 0; i < 120; i++) Weapons.update(FRAME_DT, intent(true, 0));
  assert(Weapons.dryFires - dry0 === 120,
    '2c-0. setup: the held trigger really DID refuse on all 120 frames (' +
    (Weapons.dryFires - dry0) + ' refusals) — a refused shot never charges the ' +
    'cooldown, which is exactly why an unguarded click would fire 60 times a second');
  assert(ringComplete() && Sound.count === 1 && countName(EV.DRY_FIRE) === 1,
    '2c-i. AUD-02: 120 frames of a held trigger at zero ammo record EXACTLY ONE ' +
    EV.DRY_FIRE + ' play (count ' + Sound.count + ') — the click hangs on the SAME ' +
    'false-to-true edge of Weapons.lastDryFire that 06-02\'s message uses');

  // THE EDGE RE-ARMS: one real shot clears the flag, so running dry again clicks
  // again. Without this control "exactly one" could be satisfied by a latch that
  // never fires a second time in a whole session.
  Combat.ammo[ammoField()] = 1;
  Weapons.cooldown = 0;
  Weapons.update(FRAME_DT, intent(true, 0));
  assert(Weapons.lastDryFire === false && Combat.ammo[ammoField()] === 0 &&
    countName(PISTOL_EV) === 1,
    '2c-1. setup: one real shot left the barrel (recording its own ' + PISTOL_EV +
    '), clearing the dry-fire flag and emptying the weapon again');

  Weapons.update(Weapons.cooldown + 0.01, intent(false, 0));   // wait out the cooldown
  for (let i = 0; i < 120; i++) Weapons.update(FRAME_DT, intent(true, 0));
  assert(ringComplete() && countName(EV.DRY_FIRE) === 2,
    '2c-ii. CONTROL: after that successful shot, holding the trigger dry again takes the ' +
    EV.DRY_FIRE + ' count to EXACTLY two (' + countName(EV.DRY_FIRE) + ') — the edge ' +
    're-arms rather than latching forever');
})();

// --- 2d ENEMY ATTACK: one per SPAWNED projectile, not per attempt -----------
(function () {
  scenario(6.5, 2.5);
  const e = freshEnemy(2.5, 2.5);
  e.cooldown = 0;                              // let it attack as soon as it can
  assert(Level.lineOfSight(Player.x, Player.y, e.x, e.y) &&
    Math.hypot(e.x - Player.x, e.y - Player.y) <= CONFIG.ENEMY_ATTACK_RANGE,
    '2d-0. setup: one enemy, in clear sight, inside ENEMY_ATTACK_RANGE, with a fully ' +
    'elapsed cooldown');

  Sound.reset();
  let frames = 0;
  while (activeProjectiles() === 0 && frames < 300) { Enemies.update(FRAME_DT); frames += 1; }
  assert(activeProjectiles() === 1 && frames < 300,
    '2d-1. setup: the AI released EXACTLY one projectile after ' + frames + ' frames ' +
    '(the windup, driven through the real Enemies.update)');
  assert(ringComplete() && countName(EV.ENEMY_ATTACK) === 1 && Sound.count === 1,
    '2d-i. AUD-02: that one spawned projectile records EXACTLY one ' + EV.ENEMY_ATTACK +
    ' play (count ' + Sound.count + ', names [' + playedNames().join(',') + '])');

  // CONTROL: with EVERY pool entry in flight, spawnProjectile returns null and the
  // sound must not fire — it follows the projectile, not the attempt.
  for (const p of Enemies.projectiles) p.active = true;
  Sound.reset();
  const got = Enemies.spawnProjectile(e);
  assert(got === null && Sound.count === 0,
    '2d-ii. CONTROL: with the whole pool committed, spawnProjectile returns null and ' +
    'records ZERO ' + EV.ENEMY_ATTACK + ' plays (count ' + Sound.count + ') — the sound ' +
    'follows the PROJECTILE, not the attempt');
})();

// --- 2e ENEMY DEATH: one per death, never per overkill hit ------------------
(function () {
  scenario();
  const e = freshEnemy(6.5, Player.y);
  const nonLethal = CONFIG.PISTOL_DAMAGE;
  assert(nonLethal < CONFIG.ENEMY_HEALTH,
    '2e-0. setup: one PISTOL_DAMAGE hit (' + nonLethal + ') is NON-lethal against ' +
    'ENEMY_HEALTH (' + CONFIG.ENEMY_HEALTH + ')');

  // CONTROL FIRST: a survivable hit says nothing.
  Sound.reset();
  Enemies.hurt(e, nonLethal);
  assert(e.alive === true && Sound.count === 0,
    '2e-i. CONTROL: a NON-lethal hit records ZERO ' + EV.ENEMY_DEATH + ' plays (count ' +
    Sound.count + ') — the sound is in the lethal branch, not in hurt()');

  const kills0 = Game.kills;
  Sound.reset();
  Enemies.hurt(e, CONFIG.ENEMY_HEALTH * 10);
  assert(e.alive === false && ringComplete() && Sound.count === 1 &&
    countName(EV.ENEMY_DEATH) === 1,
    '2e-ii. AUD-02: the lethal hit records EXACTLY one ' + EV.ENEMY_DEATH + ' play ' +
    '(count ' + Sound.count + ')');
  assert(Game.kills === kills0 + 1,
    '2e-iii. and it still tallied EXACTLY one kill (' + kills0 + ' -> ' + Game.kills +
    ') — the sound rides the same branch as the tally and changes nothing about it');

  Sound.reset();
  for (let i = 0; i < 5; i++) Enemies.hurt(e, CONFIG.ENEMY_HEALTH * 10);
  assert(Sound.count === 0 && Game.kills === kills0 + 1,
    '2e-iv. CONTROL: five further hits on the same corpse record ZERO further plays ' +
    'and add ZERO kills — hurt() returns early for an enemy already not alive, so ' +
    'overkill is STRUCTURALLY unable to double-trigger either (threat T-06-21)');
})();

// --- 2f PLAYER DAMAGE: one per LANDED hit, never per blocked one ------------
(function () {
  scenario();
  const DMG = 11;
  Sound.reset();
  const lost = Combat.damagePlayer(DMG);
  // The locked armor formula, recomputed here INDEPENDENTLY of combat.js.
  const expected = DMG - Math.min(CONFIG.PLAYER_START_ARMOR,
    Math.floor(DMG / CONFIG.ARMOR_ABSORB_DIVISOR));
  assert(lost > 0 && ringComplete() && Sound.count === 1 &&
    countName(EV.PLAYER_HURT) === 1,
    '2f-i. AUD-02: a hit that removes health records EXACTLY one ' + EV.PLAYER_HURT +
    ' play (' + lost + ' health lost, count ' + Sound.count + ')');
  assert(lost === expected,
    '2f-ii. and damagePlayer still returned the health the LOCKED formula says it ' +
    'should (' + lost + ' === ' + expected + ') — the sound changed no arithmetic');

  // CONTROLS: nothing that costs no health may make a sound.
  Sound.reset();
  const blocked = [Combat.damagePlayer(0), Combat.damagePlayer(-5),
    Combat.damagePlayer(NaN), Combat.damagePlayer(Infinity), Combat.damagePlayer(0.4)];
  assert(blocked.every((v) => v === 0) && Sound.count === 0,
    '2f-iii. CONTROL: a zero, negative, non-finite or sub-one damage value returns 0 ' +
    'and records ZERO plays (count ' + Sound.count + ')');

  // An already-dead player takes no further damage and therefore says nothing.
  Combat.damagePlayer(Combat.health + Combat.armor + 10);
  assert(Combat.dead === true && Combat.health === 0,
    '2f-1. setup: the player is dead with health floored at 0');
  Sound.reset();
  const post = Combat.damagePlayer(50);
  assert(post === 0 && Sound.count === 0,
    '2f-iv. CONTROL: a hit landing on an already-dead, zero-health player returns 0 ' +
    'and records ZERO plays (count ' + Sound.count + ') — a stray fireball after death ' +
    'is silent');
})();

// --- 2g PICKUP: the Phase 5 call site is UNTOUCHED --------------------------
(function () {
  const PICK_TYPES = ['health', 'armor', 'ammo', 'shotgun'];
  const seen = [];
  let allOk = true, offender = null;

  for (const type of PICK_TYPES) {
    scenario();
    // Deactivate every pickup except the first of `type`, and put that one under
    // the player, exactly as verify-pickups isolates an item.
    let target = null;
    for (const p of Pickups.list) {
      if (target === null && p.itemType === type) {
        target = p; p.active = true; p.x = Player.x; p.y = Player.y;
      } else { p.active = false; }
    }
    Sound.reset();
    Game.step(FRAME_DT);
    const expected = Pickups.EFFECTS[type].sound;
    const ok = target !== null && target.active === false && ringComplete() &&
      Sound.count === 1 && countName(expected) === 1;
    if (!ok) { allOk = false; offender = type + ' count=' + Sound.count + ' last=' + Sound.last; }
    seen.push(Sound.last);
  }

  assert(allOk,
    '2g-i. AUD-02 / PICK-05: collecting each of the four item types still records ' +
    'EXACTLY one play with the ITEM\'S OWN name [' + seen.join(', ') + '] — the ' +
    'existing call site is untouched' + (allOk ? '' : ' — offender ' + offender));
  assert(new Set(seen).size === PICK_TYPES.length,
    '2g-ii. and the four names are still PAIRWISE DISTINCT — four events sharing one ' +
    'recipe, not one generic "pickup" event (Sound.RECIPE_FOR is what collapses them)');
  const allToPickup = PICK_TYPES.every((t) =>
    Sound.RECIPE_FOR[Pickups.EFFECTS[t].sound] === 'pickup');
  assert(allToPickup,
    '2g-iii. all four resolve through Sound.RECIPE_FOR to the SAME `pickup` recipe — ' +
    'the event/recipe cardinalities differ on purpose');
})();

// --- 2h SIX DISTINCT RECIPES, compared FIELD BY FIELD ----------------------
(function () {
  const SIX_EVENTS = [EV.PISTOL, EV.SHOTGUN, EV.ENEMY_ATTACK, EV.ENEMY_DEATH,
    EV.PICKUP_HEALTH, EV.PLAYER_HURT];
  const keys = SIX_EVENTS.map((n) => Sound.RECIPE_FOR[n]);
  assert(keys.every((k) => k !== undefined) && new Set(keys).size === SIX_EVENTS.length,
    '2h-i. AUD-02: the six events resolve through Sound.RECIPE_FOR to SIX DIFFERENT ' +
    'CONFIG.SFX entries [' + keys.join(', ') + ']');

  // The defining parameters, compared pairwise. A copy-pasted recipe fails loudly.
  const FIELDS = ['tone', 'wave', 'freqStart', 'freqEnd', 'noise', 'noiseLevel',
    'filter', 'cutoffStart', 'cutoffEnd', 'q', 'gain', 'attack', 'decay', 'epsilon'];
  let identical = null, differing = 0;
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = CONFIG.SFX[keys[i]], b = CONFIG.SFX[keys[j]];
      const diffs = FIELDS.filter((f) => a[f] !== b[f]);
      if (diffs.length === 0) identical = keys[i] + ' === ' + keys[j];
      else differing += 1;
    }
  }
  const pairs = keys.length * (keys.length - 1) / 2;
  assert(identical === null && differing === pairs,
    '2h-ii. all ' + pairs + ' pairs of the six recipes differ across the ' + FIELDS.length +
    ' defining parameters' + (identical ? ' — IDENTICAL PAIR: ' + identical : ''));

  // And the differences are SUBSTANTIVE rather than a single decimal: every recipe
  // has a distinct peak gain AND a distinct decay, and the layer combinations are
  // not all the same shape.
  const gains = new Set(keys.map((k) => CONFIG.SFX[k].gain));
  const decays = new Set(keys.map((k) => CONFIG.SFX[k].decay));
  const shapes = new Set(keys.map((k) =>
    CONFIG.SFX[k].tone + '/' + CONFIG.SFX[k].noise + '/' + CONFIG.SFX[k].filter));
  assert(gains.size === keys.length && decays.size === keys.length && shapes.size >= 4,
    '2h-iii. the six have pairwise distinct peak gains (' + gains.size + ') and decays (' +
    decays.size + '), across ' + shapes.size + ' different layer/filter shapes — they ' +
    'read as different instruments, not as one sound retuned');

  // The one ASCENDING sweep is the pickup, and the longest decay is the death.
  const rising = keys.filter((k) => CONFIG.SFX[k].tone === true &&
    CONFIG.SFX[k].freqEnd > CONFIG.SFX[k].freqStart);
  assert(rising.length === 1 && rising[0] === 'pickup',
    '2h-iv. exactly ONE of the six sweeps UPWARD and it is the pickup (' +
    rising.join(',') + ') — the "you gained something" idiom is unmistakable ' +
    'because nothing else rises');
})();

// --- 2i AUDIBLY different, not just named differently ----------------------
(function () {
  const SIX_EVENTS = [EV.PISTOL, EV.SHOTGUN, EV.ENEMY_ATTACK, EV.ENEMY_DEATH,
    EV.PICKUP_HEALTH, EV.PLAYER_HURT];
  assert(Sound.isAvailable() === true,
    '2i-0. setup: the stub context is still live, so these are REAL recorded graphs');

  const sigs = SIX_EVENTS.map((ev) => {
    Sound.reset();
    const win = recordPlay(ev);
    return { ev, types: typeSig(win), freq: firstFreq(win), nodes: win.nodes.length };
  });

  assert(sigs.every((x) => x.nodes > 0 && x.freq !== null),
    '2i-i. CONTROL: all six built a real node graph with a scheduled frequency [' +
    sigs.map((x) => x.types + '@' + x.freq).join(' | ') + ']');

  let same = null;
  for (let i = 0; i < sigs.length; i++) {
    for (let j = i + 1; j < sigs.length; j++) {
      if (sigs[i].types === sigs[j].types && sigs[i].freq === sigs[j].freq) {
        same = sigs[i].ev + ' === ' + sigs[j].ev;
      }
    }
  }
  assert(same === null,
    '2i-ii. AUD-02: the six produce PAIRWISE DIFFERENT recorded graphs — the sequence of ' +
    'created node types plus the first scheduled frequency differs for every pair' +
    (same ? ' — IDENTICAL: ' + same : ''));

  assert(new Set(sigs.map((x) => x.freq)).size === SIX_EVENTS.length,
    '2i-iii. and the six first scheduled frequencies are all distinct (' +
    sigs.map((x) => x.freq).join(', ') + ') — no two effects start in the same place');
})();

// --- 2j THE HOSTS ARE UNCHANGED — the additions are inert ------------------
(function () {
  scenario();
  // Firing: exactly one round per shot, over many shots.
  const field = ammoField();
  const start = Combat.ammo[field];
  const SHOTS = 12;
  for (let i = 0; i < SHOTS; i++) { Weapons.cooldown = 0; Weapons.fire(); }
  assert(Combat.ammo[field] === start - SHOTS && Weapons.shotsFired === SHOTS,
    '2j-i. ' + SHOTS + ' shots spent EXACTLY ' + SHOTS + ' rounds (' + start + ' -> ' +
    Combat.ammo[field] + ') and recorded ' + Weapons.shotsFired + ' shots — the fire ' +
    'sound is inert with respect to ammo and the shot tally');

  // Kills: exactly one per death, over many enemies.
  scenario();
  const N = 5;
  const made = [];
  for (let i = 0; i < N; i++) made.push(freshEnemy(6.5 + i, Player.y));
  const kills0 = Game.kills;
  for (const e of made) Enemies.hurt(e, CONFIG.ENEMY_HEALTH * 10);
  assert(Game.kills === kills0 + N && made.every((e) => e.alive === false),
    '2j-ii. ' + N + ' deaths tallied EXACTLY ' + N + ' kills (' + kills0 + ' -> ' +
    Game.kills + ') — the death sound is inert with respect to the tally');

  // Damage: the locked formula, recomputed independently, over a range of values.
  scenario();
  let allMatch = true, bad = null;
  for (const dmg of [1, 2, 3, 7, 11, 30]) {
    Combat.reset();
    const absorbed = Math.min(CONFIG.PLAYER_START_ARMOR,
      Math.floor(dmg / CONFIG.ARMOR_ABSORB_DIVISOR));
    const want = dmg - absorbed;
    const got = Combat.damagePlayer(dmg);
    if (got !== want) { allMatch = false; bad = dmg + ': got ' + got + ' want ' + want; }
  }
  assert(allMatch,
    '2j-iii. damagePlayer returns the health the LOCKED armor formula predicts for ' +
    'every tested damage value — the player-damage sound is inert with respect to the ' +
    'arithmetic' + (allMatch ? '' : ' — offender ' + bad));

  assert(Sound.count > 0,
    '2j-iv. CONTROL: all of 2j\'s inertness proofs were running with the sound call ' +
    'sites LIVE (' + Sound.count + ' events recorded during them) — the additions are ' +
    'proven inert, not proven absent');
})();

// ===========================================================================
finish("ALL_AUDIO_CONTRACTS_PASS");
