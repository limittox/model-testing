/*
 * sound.js — THE WEB AUDIO ENGINE (AUD-01/02/03) behind Sound.play(name).
 *
 * LOAD ORDER: loaded AFTER js/weapons.js and BEFORE js/pickups.js and js/game.js
 * (see index.html). It reads CONFIG (the whole SFX block — every frequency,
 * duration, gain and filter number lives there, not here) and resolves the
 * AudioContext constructor from the GLOBAL at call time. It touches no DOM, holds
 * no canvas and no timers, so the Node vm harness runs this exact file unchanged
 * even though that sandbox has no Web Audio at all.
 *
 * ============================================================================
 * WHAT PLAN 06-03 REPLACED, AND WHAT IT DELIBERATELY DID NOT
 * ============================================================================
 * Phase 5 shipped this file as a RECORDING STUB: Sound.play(name) noted the event
 * in a preallocated ring and returned, because PICK-05 needed the call site to
 * exist before Phase 6 owned the synthesis. Plan 06-03 replaced the INTERNALS —
 * one gesture-scoped AudioContext, a master gain into a compressor into the
 * destination, and a generic interpreter of the CONFIG.SFX recipes — and left the
 * SURFACE byte-for-byte alone.
 *
 * THE RECORDER IS RETAINED ON PURPOSE, AND IT RUNS FIRST. Roughly a dozen Phase 5
 * assertions measure Sound.count / Sound.last / Sound.ring / Sound.recent() to
 * prove things like "collecting a pickup calls the sound hook EXACTLY once with
 * the item's own name". If the recorder moved below the synthesis, or ran only
 * when audio happened to be available, every one of those assertions would go
 * VACUOUS the moment audio was missing — which is exactly the state the headless
 * harnesses run in. So: guard, record, return value decided; and only THEN, and
 * only inside a try/catch, any audio at all.
 *
 * NO AUDIO FILE EXISTS ANYWHERE IN THIS PROJECT. There is no fetch, no
 * XMLHttpRequest, no decodeAudioData, no Audio element and no media file in the
 * shipped surface: every effect is built at play time from an oscillator, ONE
 * shared white-noise buffer, a biquad filter and a gain envelope. That is AUD-01,
 * and tools/verify-audio.cjs section 3 asserts it with a comment-stripped source
 * scan (plus a live control proving the scanner really reads the source).
 *
 * ============================================================================
 * THERE IS STILL NO `ctx` FIELD ON Sound, AND THAT IS LOAD-BEARING (AUD-03)
 * ============================================================================
 * The context lives in the module-scope `audioCtx` variable below, behind the
 * Sound.context() accessor. It is NOT a property of Sound, because:
 *
 *   . tools/verify-pickups.cjs assertion 0d proves "Sound created NO AudioContext"
 *     with `!('ctx' in Sound) && !('audioContext' in Sound)`, and
 *   . tools/verify-state.cjs 1g-i/1g-ii assert the same, stronger, at boot AND at
 *     the end of a full run of clicks, restarts and hundreds of frames.
 *
 * Both are Phase 5 / earlier-Phase-6 assertions, and the only legitimate way to
 * keep a prior assertion green is to shape the PRODUCTION code so the claim stays
 * true — never to relax the assertion. A module-scope variable behind an accessor
 * costs nothing and keeps all three assertions honest: in the harness sandbox
 * there is no AudioContext binding at all, so no context is ever built, so the
 * claim is not merely unbroken but unbreakable.
 *
 * ============================================================================
 * THE CONSTRUCTOR IS RESOLVED LAZILY, AND THAT IS THE WHOLE OF AUD-03
 * ============================================================================
 * resolveContextCtor() reads AudioContext (then webkitAudioContext) off the global
 * INSIDE Sound.unlock(), at CALL time. It is never captured at module load. Two
 * consequences, and both are the point:
 *
 *   . NO CONTEXT CAN EXIST BEFORE THE START-SCREEN GESTURE. Sound.unlock() is the
 *     only place `new Ctor()` appears in this file, and Game.handleGesture is the
 *     only caller — invoked from Input.onClick inside a real user activation. A
 *     context built before that gesture would be born `suspended` with no
 *     activation to revive it: audio would be dead for the whole session.
 *   . THE PROPERTY IS STRUCTURALLY TESTABLE. tools/boot.cjs has no AudioContext
 *     binding, so a harness can only install a stub AFTER boot — which only works
 *     if resolution is lazy. Assertion 1b (one click takes the constructor count
 *     from 0 to exactly 1) therefore cannot pass against a module-load capture,
 *     and 1a drives a full frame run and a full gameplay burst BEFORE the gesture
 *     and asserts the count is still 0.
 *
 * ============================================================================
 * NOTHING HERE CAN REACH THE FRAME LOOP (threat T-06-17)
 * ============================================================================
 * Audio is the one subsystem the browser is allowed to refuse outright. So the
 * whole of unlock() and the whole of the synthesis block sit inside try/catch,
 * resume()'s promise gets a rejection handler, and play() has already decided its
 * return value before any node is created. A missing constructor, a throwing
 * constructor, a rejecting resume and a throwing node factory are all covered by
 * assertion 1i, each paired with a proof that Sound.count still advanced.
 *
 * ============================================================================
 * ALLOCATION IN THE HOT PATH
 * ============================================================================
 * The ring is preallocated at module load and never grows. The white-noise buffer
 * is filled ONCE inside unlock() and replayed through fresh (cheap, disposable)
 * buffer sources forever after — a firefight allocates no audio buffers at all
 * (threat T-06-18). Every source is stopped at the end of its own envelope, so
 * the graph drains itself instead of accumulating nodes.
 */

var Sound = {
  // The most recent event name, or null before anything has played. The cheapest
  // possible assertion target.
  last: null,

  // Total Sound.play() calls since the last reset(). Monotonic — a caller that
  // fires twice is distinguishable from one that fires once, which is exactly what
  // the "exactly one sound per collection" proof needs.
  count: 0,

  // How many recent names the ring keeps. Small and fixed: this is a debug/proof
  // window, not a log.
  RING_SIZE: 8,

  // The PREALLOCATED ring of recent names and the index of the next slot to
  // write. Allocated once, here, at module load — never inside play().
  ring: new Array(8),
  head: 0,

  // --- THE AUDIO SEAM (AUD-03) ---------------------------------------------
  // THERE IS DELIBERATELY NO `ctx` FIELD HERE, AND THAT IS LOAD-BEARING — see the
  // header. The context lives in the module-scope `audioCtx` variable and is read
  // through Sound.context(). verify-pickups 0d and verify-state 1g-i/1g-ii all
  // assert that no context field exists on this object at all.

  // unlockCalls — how many times the gesture seam has been invoked since the last
  // reset(). This is what makes "one click unlocked the audio" a falsifiable
  // assertion instead of an unobservable side effect, exactly as `count` does for
  // Sound.play.
  unlockCalls: 0,

  // The most recent audio failure, as a string, or null. Audio failing is NORMAL
  // (no Web Audio in Node, a browser that refuses the policy, a muted tab), so it
  // is recorded rather than thrown — and recording it is what lets assertion 1i
  // prove the four broken-audio paths were actually EXERCISED rather than simply
  // not reached.
  lastError: null
};

(function () {
  'use strict';

  // ===========================================================================
  // MODULE-SCOPE AUDIO STATE. None of this is a property of Sound (see header).
  // ===========================================================================
  var audioCtx = null;      // the ONE AudioContext, or null before the gesture
  var masterGain = null;    // every per-sound gain connects HERE, never to output
  var compressor = null;    // the anti-clipping limiter between master and output
  var noiseBuffer = null;   // the ONE white-noise buffer, filled once at unlock
  var audioReady = false;   // is the graph believed usable right now

  // The event NAMES this project uses, exposed as data so call sites and proofs
  // share one spelling rather than re-typing string literals. The strings
  // themselves live in CONFIG.SFX_EVENTS, because js/combat.js, js/enemies.js and
  // js/weapons.js all load BEFORE this file and therefore cannot read Sound.NAMES
  // at their own module-evaluation time (see the CONFIG block's comment).
  //
  // The four pickup names are UNCHANGED from Phase 5: js/pickups.js's effect table
  // reads them from here, and verify-pickups asserts they are pairwise distinct.
  var EV = CONFIG.SFX_EVENTS;
  Sound.NAMES = {
    // Phase 5 (PICK-05) — the four pickup events.
    HEALTH: EV.PICKUP_HEALTH,
    ARMOR: EV.PICKUP_ARMOR,
    AMMO: EV.PICKUP_AMMO,
    WEAPON: EV.PICKUP_WEAPON,
    // Plan 06-03 (AUD-02) — the five gameplay events this plan wired, plus the
    // dry click that rides the same out-of-ammo edge as 06-02's message.
    PISTOL: EV.PISTOL,
    SHOTGUN: EV.SHOTGUN,
    DRY_FIRE: EV.DRY_FIRE,
    ENEMY_ATTACK: EV.ENEMY_ATTACK,
    ENEMY_DEATH: EV.ENEMY_DEATH,
    PLAYER_HURT: EV.PLAYER_HURT
  };

  // ===========================================================================
  // EVENT -> RECIPE. A TABLE, not a chain of comparisons.
  //
  // This indirection is the whole reason the four pickup events can stay four
  // DISTINCT events at the call sites (which Phase 5 asserts) while sharing ONE
  // synthesis recipe: an event is what happened, a recipe is what it sounds like,
  // and they are not the same cardinality. An unknown name simply has no entry,
  // which is how play() stays silent for it without a branch.
  // ===========================================================================
  Sound.RECIPE_FOR = {};
  Sound.RECIPE_FOR[EV.PISTOL] = 'pistol';
  Sound.RECIPE_FOR[EV.SHOTGUN] = 'shotgun';
  Sound.RECIPE_FOR[EV.DRY_FIRE] = 'dryClick';
  Sound.RECIPE_FOR[EV.ENEMY_ATTACK] = 'enemyAttack';
  Sound.RECIPE_FOR[EV.ENEMY_DEATH] = 'enemyDeath';
  Sound.RECIPE_FOR[EV.PLAYER_HURT] = 'playerHurt';
  Sound.RECIPE_FOR[EV.PICKUP_HEALTH] = 'pickup';
  Sound.RECIPE_FOR[EV.PICKUP_ARMOR] = 'pickup';
  Sound.RECIPE_FOR[EV.PICKUP_AMMO] = 'pickup';
  Sound.RECIPE_FOR[EV.PICKUP_WEAPON] = 'pickup';

  // ===========================================================================
  // RESOLVE THE CONSTRUCTOR FROM THE GLOBAL, AT CALL TIME (AUD-03).
  //
  // NEVER hoisted to module scope. See the header: the laziness is what keeps "no
  // context before the gesture" structurally true and what makes it testable at
  // all. The standard name first, then the webkit-prefixed legacy name.
  // ===========================================================================
  function resolveContextCtor() {
    var g = null;
    if (typeof globalThis !== 'undefined' && globalThis) g = globalThis;
    else if (typeof window !== 'undefined' && window) g = window;
    if (!g) return null;
    if (typeof g.AudioContext === 'function') return g.AudioContext;
    if (typeof g.webkitAudioContext === 'function') return g.webkitAudioContext;
    return null;
  }

  // Record a failure without ever propagating it. Every catch in this file lands
  // here, so "why is there no sound" has exactly one place to look.
  function noteError(where, err) {
    var msg = (err && err.message) ? err.message : String(err);
    Sound.lastError = where + ': ' + msg;
    return false;
  }

  // ===========================================================================
  // THE MASTER BUS — gain -> compressor -> destination, built ONCE.
  //
  // The compressor is what makes overlapping effects safe (threat T-06-20): a
  // shotgun blast on top of two enemy deaths and a pickup sums well past 1.0, and
  // without a limiter that wraps into distortion. Every per-sound gain connects to
  // masterGain and NOTHING in this file ever connects to ctx.destination directly
  // — assertion 1e walks the recorded connections to prove the chain, and 1f
  // proves the per-sound routing.
  // ===========================================================================
  function buildMasterChain() {
    masterGain = audioCtx.createGain();
    masterGain.gain.value = CONFIG.SFX_MASTER_GAIN;

    compressor = audioCtx.createDynamicsCompressor();
    // Set through .value rather than scheduled: these are static settings, not an
    // envelope. Guarded per-param because the compressor's parameter set has
    // varied across engines and a missing one must not take the bus down.
    if (compressor.threshold) compressor.threshold.value = CONFIG.SFX_COMP_THRESHOLD;
    if (compressor.knee) compressor.knee.value = CONFIG.SFX_COMP_KNEE;
    if (compressor.ratio) compressor.ratio.value = CONFIG.SFX_COMP_RATIO;
    if (compressor.attack) compressor.attack.value = CONFIG.SFX_COMP_ATTACK;
    if (compressor.release) compressor.release.value = CONFIG.SFX_COMP_RELEASE;

    masterGain.connect(compressor);
    compressor.connect(audioCtx.destination);
  }

  // ===========================================================================
  // THE ONE WHITE-NOISE BUFFER (threat T-06-18) — filled once, here, and replayed
  // by every noise layer for the rest of the session. Buffer SOURCES are cheap and
  // single-use by design; buffer CONTENTS are not, and filling 44,100 floats on
  // every shotgun shell would be a GC source in exactly the hot path.
  // ===========================================================================
  function buildNoiseBuffer() {
    var rate = audioCtx.sampleRate;
    if (!(rate > 0)) rate = 44100;
    var frames = Math.floor(rate * CONFIG.SFX_NOISE_SECONDS);
    if (!(frames > 0)) frames = 1;
    var buf = audioCtx.createBuffer(1, frames, rate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ===========================================================================
  // UNLOCK (AUD-03) — THE GESTURE-SCOPED AUDIO SEAM, AND THE ONLY PLACE IN THE
  // PROJECT WHERE AN AudioContext IS CONSTRUCTED.
  //
  // Called by Game.handleGesture on EVERY canvas click, inside the same user
  // activation that requests pointer lock — because that is the only place a
  // browser will let an AudioContext leave the `suspended` state it is born in.
  //
  // TWO INVARIANTS, both inherited from the 06-01 seam and both still true:
  //
  //   . IT IS SAFE TO CALL ANY NUMBER OF TIMES. Every click calls it. The context
  //     and the graph are built at most ONCE (the `audioCtx === null` test); the
  //     second click is a resume(), never a second graph. Assertion 1d clicks five
  //     more times and asserts the constructor count is still 1 and the instance
  //     is the same by reference.
  //   . IT NEVER THROWS. The whole body is wrapped, resume()'s promise gets a
  //     rejection handler, and a failure leaves audio simply unavailable.
  //
  // resume() is called ONLY when the context reports itself suspended — resuming a
  // running context is a pointless round trip, and asserting the conditional is how
  // 1c's control ("a context born running records ZERO resumes and audio is still
  // available") distinguishes "resumes when it needs to" from "resumes blindly".
  //
  // Always increments unlockCalls (the counter is the observable), and always
  // returns whether audio is believed available.
  // ===========================================================================
  Sound.unlock = function () {
    Sound.unlockCalls += 1;
    try {
      if (audioCtx === null) {
        var Ctor = resolveContextCtor();
        if (!Ctor) {
          audioReady = false;
          Sound.lastError = 'unlock: no AudioContext constructor on the global';
          return false;
        }
        // If this throws, audioCtx stays null and the next gesture may try again.
        var created = new Ctor();
        audioCtx = created;
        buildMasterChain();
        noiseBuffer = buildNoiseBuffer();
        audioReady = true;
      }
      if (audioCtx.state === 'suspended' && typeof audioCtx.resume === 'function') {
        var p = audioCtx.resume();
        // A REJECTED resume is a refusal, not an error: swallow it here so it
        // cannot surface as an unhandled rejection, and leave audio marked
        // available (a later gesture may well succeed).
        if (p && typeof p.catch === 'function') {
          p.catch(function (err) { noteError('resume', err); });
        }
      }
      return audioReady;
    } catch (err) {
      audioReady = false;
      return noteError('unlock', err);
    }
  };

  // Read-only accessors over the module-scope state (see the header for why these
  // are functions and not fields). Harness observability and a future debug
  // overlay; no game code calls them.
  Sound.context = function () { return audioCtx; };
  Sound.isAvailable = function () { return audioReady === true && audioCtx !== null; };
  Sound.masterNode = function () { return masterGain; };
  Sound.compressorNode = function () { return compressor; };
  Sound.noiseBufferRef = function () { return noiseBuffer; };

  // ===========================================================================
  // SYNTH — the ONE generic interpreter of a CONFIG.SFX record (AUD-01).
  //
  // There is no per-effect code anywhere: an effect IS its record. The graph, in
  // creation order, is
  //
  //     [oscillator] --\
  //                     >-- [biquad] -- [per-sound gain] -- masterGain -- comp -- out
  //     [noise src] -- [noise trim gain] --/
  //
  // with the biquad omitted when `filter` is null, the oscillator omitted when
  // `tone` is false, and the noise pair omitted when `noise` is false. The
  // per-sound gain is ALWAYS created and is ALWAYS the only thing that touches
  // masterGain — that is the routing claim 1f asserts.
  //
  // EVERYTHING IS SCHEDULED AGAINST audioCtx.currentTime, never against a
  // wall-clock or a frame counter, and every ramp target is strictly positive:
  // exponentialRampToValueAtTime(0, t) throws (threat T-06-19), which is what the
  // per-recipe `epsilon` floor exists to avoid. Assertion 1g asserts every
  // scheduled gain value is > 0 and pairs it with a proof that at least one really
  // is tiny, so the claim is about a real decay and not a constant loud gain.
  //
  // Every source is STOPPED at the end of its own envelope, so the graph drains
  // itself and a long firefight does not accumulate nodes (threat T-06-18).
  // ===========================================================================
  function synth(r) {
    var t0 = audioCtx.currentTime;
    var peak = t0 + r.attack;
    var end = peak + r.decay;
    var eps = r.epsilon;

    // THE PER-SOUND GAIN — the bus every layer of this effect mixes into, and the
    // only node that connects to the master.
    var bus = audioCtx.createGain();
    bus.connect(masterGain);
    bus.gain.setValueAtTime(eps, t0);
    bus.gain.linearRampToValueAtTime(r.gain, peak);
    bus.gain.exponentialRampToValueAtTime(eps, end);

    // The node every layer feeds: the filter when there is one, the bus otherwise.
    var sink = bus;
    if (r.filter !== null) {
      var bq = audioCtx.createBiquadFilter();
      bq.type = r.filter;
      bq.Q.value = r.q;
      bq.frequency.setValueAtTime(r.cutoffStart, t0);
      bq.frequency.exponentialRampToValueAtTime(r.cutoffEnd, end);
      bq.connect(bus);
      sink = bq;
    }

    if (r.tone === true) {
      var osc = audioCtx.createOscillator();
      osc.type = r.wave;
      osc.frequency.setValueAtTime(r.freqStart, t0);
      // A SWEEP, not a beep. Exponential because pitch is perceived
      // logarithmically — a linear sweep sounds like it stalls at the bottom.
      osc.frequency.exponentialRampToValueAtTime(r.freqEnd, end);
      osc.connect(sink);
      osc.start(t0);
      osc.stop(end);
    }

    if (r.noise === true && noiseBuffer !== null) {
      // The trim sets the noise layer's level RELATIVE to the tone layer, which
      // runs at unity. A separate node rather than a second envelope: the shape is
      // the bus's job, the balance is this node's.
      var trim = audioCtx.createGain();
      trim.gain.setValueAtTime(r.noiseLevel, t0);
      trim.connect(sink);

      var src = audioCtx.createBufferSource();
      src.buffer = noiseBuffer;          // THE SHARED buffer — never a fresh fill
      src.connect(trim);
      src.start(t0);
      src.stop(end);
    }
  }

  // ===========================================================================
  // PLAY — the event hook AND the synthesis trigger, in that order.
  //
  // THE GUARD AND THE RECORDER ARE UNCHANGED FROM PHASE 5, DOWN TO THE RETURN
  // VALUES, and they run BEFORE any audio is attempted. See the header: a dozen
  // Phase 5 assertions measure this recorder, and a broken, blocked or absent
  // audio stack must not be able to make a single one of them vacuous.
  //
  // Guards first: a non-string or empty name is ignored ENTIRELY rather than
  // recorded, so a typo'd call site fails the "the hook was called with the item's
  // name" assertion loudly instead of quietly inflating the count.
  //
  // Then, and only if a context exists and audio is available, the recipe is
  // resolved and synthesized inside a try/catch — so no audio failure of any kind
  // can propagate into the frame (threat T-06-17). An unknown name records and
  // returns exactly as before, and simply has no recipe to play.
  // ===========================================================================
  Sound.play = function (name) {
    if (typeof name !== 'string' || name.length === 0) return false;
    Sound.last = name;
    Sound.count += 1;
    Sound.ring[Sound.head] = name;
    // Advance the head with a wrap — a preallocated ring, never a growing array.
    Sound.head = (Sound.head + 1) % Sound.RING_SIZE;

    // --- everything below this line is AUDIO, and none of it can fail loudly ---
    if (audioReady === true && audioCtx !== null && masterGain !== null) {
      try {
        var key = Sound.RECIPE_FOR[name];
        if (key !== undefined) {
          var recipe = CONFIG.SFX[key];
          if (recipe) synth(recipe);
        }
      } catch (err) {
        noteError('play(' + name + ')', err);
      }
    }
    return true;
  };

  // ===========================================================================
  // RESET — clear the RECORDER. Called by main.js at boot, by Game.restart(), and
  // by any harness scenario that wants to count the events of one specific
  // action. Assigns, never accumulates, and reuses the SAME ring array (its
  // identity is stable).
  //
  // IT DOES NOT TOUCH THE AUDIO GRAPH, and that is deliberate: the recorder and
  // the engine are separate concerns, and tearing the context down on a restart
  // would mean the player loses audio the moment they click "play again" — the
  // gesture that restarts is a gesture, but rebuilding a whole graph on it would be
  // pure waste. It zeroes unlockCalls for the same reason it zeroes count: the
  // counter is part of the recorder.
  // ===========================================================================
  Sound.reset = function () {
    Sound.last = null;
    Sound.count = 0;
    Sound.head = 0;
    Sound.unlockCalls = 0;
    for (var i = 0; i < Sound.RING_SIZE; i++) Sound.ring[i] = null;
    return Sound;
  };

  // The most recent `n` names, newest FIRST, as a fresh array. A read-only
  // convenience for proofs and for a future debug overlay — deliberately NOT used
  // by any game code, because it allocates.
  Sound.recent = function (n) {
    var want = (n === undefined) ? Sound.RING_SIZE : n;
    if (want > Sound.RING_SIZE) want = Sound.RING_SIZE;
    var out = [];
    for (var i = 1; i <= want; i++) {
      var v = Sound.ring[(Sound.head - i + Sound.RING_SIZE) % Sound.RING_SIZE];
      if (v === null || v === undefined) break;
      out.push(v);
    }
    return out;
  };

  Sound.reset();
})();
