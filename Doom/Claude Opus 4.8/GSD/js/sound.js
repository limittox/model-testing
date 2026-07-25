/*
 * sound.js — the Sound.play(name) EVENT HOOK.
 *
 * LOAD ORDER: loaded AFTER js/weapons.js and BEFORE js/pickups.js and js/game.js
 * (see index.html). It depends on CONFIG only for nothing at all — it reads no
 * other global, touches no DOM, holds no canvas and no timers, so the Node vm
 * harness runs this exact file unchanged.
 *
 * ============================================================================
 * WHAT THIS IS, AND WHAT PHASE 6 DOES TO IT
 * ============================================================================
 * The 05-CONTEXT domain block puts synthesized audio in PHASE 6 (AUD-01/02/03)
 * and keeps Phase 5 to the game LOGIC. But PICK-05 says collecting a pickup makes
 * a sound, so the CALL SITE has to exist now or Phase 6 would be adding both the
 * synthesis AND the plumbing through every gameplay module at once.
 *
 * So this file is the seam: `Sound.play(name)` is called from the real code path
 * at the real moment, and its BODY is a recorder. Phase 6 replaces the body with
 * a Web Audio graph (an AudioContext resumed on the first user gesture, oscillator
 * and noise sources through gain envelopes) and adds the remaining call sites —
 * weapon fire, the dry click, enemy pain and death, and player damage. THIS PLAN
 * WIRES EXACTLY ONE CALL SITE: the pickup collection PICK-05 requires.
 *
 * IT CREATES NO AudioContext. Constructing one here would be worse than useless:
 * browsers start it `suspended` and it must be resumed from a user gesture, so an
 * AudioContext built at load is a dead object that only Phase 6 could revive —
 * and it would immediately break the harnesses, which have no Web Audio at all.
 *
 * ============================================================================
 * WHY THE HOOK RECORDS
 * ============================================================================
 * A hook whose body is `return;` is UNVERIFIABLE — no assertion can tell "the
 * pickup called the sound hook" from "the pickup silently forgot to". Recording
 * the event is what turns the boundary into something a harness can actually
 * prove, and it costs one array store: the last CONFIG-free RING_SIZE names in a
 * PREALLOCATED ring, a total count, and the most recent name. Nothing is
 * allocated per call and the ring cannot grow, so this stays true in the hot path
 * once Phase 6 hangs firing sounds off it at several calls a second.
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

  // --- PHASE 6 AUDIO SEAM (AUD-03) -----------------------------------------
  // THERE IS DELIBERATELY NO `ctx` FIELD HERE, AND THAT IS LOAD-BEARING.
  //
  // Plan 06-01's action text asked for a `Sound.ctx: null` placeholder. It is
  // omitted on purpose: tools/verify-pickups.cjs assertion 0d proves "Sound
  // created NO AudioContext" by asserting that NO context field exists on this
  // object at all (`!('ctx' in Sound) && !('audioContext' in Sound)`), and a
  // declared-but-null placeholder would fail that Phase 5 assertion. The only
  // legitimate fix for a moved Phase 1-5 assertion is to correct the production
  // code, never to relax the assertion — so the placeholder is deferred to 06-03,
  // which is the plan that genuinely constructs a context and therefore genuinely
  // owns re-stating 0d's claim.
  //
  // tools/verify-state.cjs asserts the STRONGER form in its place: no context
  // field on Sound at all, and no AudioContext / webkitAudioContext binding
  // anywhere in the sandbox. 06-03 should prefer keeping the context in a
  // module-scope variable behind an accessor over adding a public field, which
  // would let 0d survive untouched.

  // unlockCalls — how many times the gesture seam has been invoked since the last
  // reset(). This is what makes "one click unlocked the audio" a falsifiable
  // assertion instead of an unobservable side effect, exactly as `count` does for
  // Sound.play.
  unlockCalls: 0
};

(function () {
  'use strict';

  // The event NAMES this project uses, exposed as data so call sites and proofs
  // share one spelling rather than re-typing string literals. Phase 6 hangs a
  // synthesis recipe off each of these.
  Sound.NAMES = {
    HEALTH: 'pickupHealth',
    ARMOR: 'pickupArmor',
    AMMO: 'pickupAmmo',
    WEAPON: 'pickupWeapon'
  };

  // ===========================================================================
  // PLAY — the hook. Records the event and returns.
  //
  // PHASE 6 REPLACES THIS BODY with Web Audio synthesis (and keeps the recording,
  // which costs nothing and keeps every Phase 5 assertion meaningful).
  //
  // Guards first: a non-string name is ignored entirely rather than recorded, so
  // a future typo'd call site fails the "the hook was called with the item's
  // name" assertion loudly instead of quietly inflating the count.
  // ===========================================================================
  Sound.play = function (name) {
    if (typeof name !== 'string' || name.length === 0) return false;
    Sound.last = name;
    Sound.count += 1;
    Sound.ring[Sound.head] = name;
    // Advance the head with a wrap — a preallocated ring, never a growing array.
    Sound.head = (Sound.head + 1) % Sound.RING_SIZE;
    return true;
  };

  // ===========================================================================
  // UNLOCK (AUD-03) — THE GESTURE-SCOPED AUDIO SEAM.
  //
  // Called by Game.handleGesture on EVERY canvas click, inside the same user
  // activation that requests pointer lock — because that is the only place a
  // browser will let an AudioContext leave the `suspended` state it is born in.
  //
  // TODAY it counts the call and returns false. THIS PLAN CONSTRUCTS NO
  // AudioContext: an AudioContext built before a gesture is a dead object that
  // only a later gesture could revive, and it would immediately break every
  // harness (there is no Web Audio in the Node vm sandbox at all).
  //
  // 06-03 REPLACES THIS BODY with the AudioContext construction and resume() plus
  // the master gain / compressor chain. Two invariants must survive that
  // replacement, and both are why the signature is shaped like this:
  //
  //   . IT MUST BE SAFE TO CALL ANY NUMBER OF TIMES. Every click calls it, so the
  //     new body tests for an existing context first and only ever builds ONE;
  //     the second click is a resume(), never a second graph.
  //   . IT MUST NEVER THROW. Audio can be unavailable, blocked by policy, or
  //     refused outright, and none of those may stop the game from starting — the
  //     click that unlocks audio is the same click that starts play.
  //
  // Returns whether audio is believed to be running (false while there is none).
  // ===========================================================================
  Sound.unlock = function () {
    Sound.unlockCalls += 1;
    return false;
  };

  // ===========================================================================
  // RESET — clear the recorder. Called by main.js at boot, by Game.restart(), and
  // by any harness scenario that wants to count the events of one specific
  // action. Assigns, never accumulates, and reuses the SAME ring array (its
  // identity is stable).
  //
  // It zeroes unlockCalls too — the counter is part of the recorder, so a scenario
  // that wants "how many unlocks did THIS action cause" gets the same clean slate
  // it gets for play() counts. It touches nothing else: once 06-03 owns a real
  // audio graph, resetting the RECORDER must never tear that graph down.
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
