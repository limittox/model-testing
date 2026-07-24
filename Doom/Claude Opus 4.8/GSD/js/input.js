/*
 * input.js — live keyboard + pointer-lock input as INTENT ONLY (D-07, D-08).
 *
 * LOAD ORDER: loaded AFTER js/player.js and BEFORE js/game.js (see index.html).
 * It reads Player.MOUSE_SENSITIVITY only indirectly (the loop applies it); this
 * file itself never mutates the pose. It is a browser-facing module — it touches
 * window/document/canvas — so the headless harnesses drive it through boot.cjs's
 * stubbed DOM rather than importing it in isolation.
 *
 * THE INTENT-ONLY CONTRACT (D-07 — the reason this file exists):
 *
 *   Handlers set INTENT, never state. keydown/keyup maintain a set of held
 *   PHYSICAL key codes (event.code, layout-independent); mousemove accumulates a
 *   raw horizontal delta. The player is NEVER touched here. Game.step samples the
 *   intent ONCE per frame via readIntent(), which drains the mouse delta so a
 *   delta is applied exactly once. This is what keeps input, simulation and the
 *   frame clock decoupled — the property Plan 02's clamp depends on.
 *
 * THE POINTER-LOCK CONTRACT (D-08):
 *
 *   Lock is requested only from a real user gesture (the canvas click), preferring
 *   unadjustedMovement (Chromium delivers raw deltas; other browsers ignore the
 *   unknown option harmlessly). Mouse deltas accumulate ONLY while the canvas holds
 *   pointer lock, checked at event time, so lock loss immediately stops camera
 *   drift. Arrow-key turning is computed purely from the held-key set and never
 *   consults the lock state — that is the CTRL-03 fallback (built out in Task 2).
 */

var Input = {
  // Held physical key codes -> true. Null-prototype so a code can never collide
  // with an inherited Object property (e.g. 'constructor').
  keys: Object.create(null),

  // Running sum of raw horizontal mouse movement (pixels) since the last drain.
  mouseDX: 0,

  // Mirrors pointer-lock state; the attached canvas lock is requested on.
  locked: false,
  canvas: null,

  // The last pointer-lock failure (a thrown error or a rejected promise), recorded
  // rather than propagated so a refused lock never breaks the running loop.
  lockError: null,

  // ONE reused intent record — never allocate per frame (threat T-02-09). Shape
  // is exactly what Player.update consumes: {forward, strafe, turn, run, mouseDX}.
  intent: { forward: 0, strafe: 0, turn: 0, run: false, mouseDX: 0 }
};

(function () {
  'use strict';

  // ===========================================================================
  // BINDINGS — a data table mapping a PHYSICAL key code to an intent effect.
  // Null-prototype so `BINDINGS[code]` is a pure lookup with no prototype leaks.
  // ===========================================================================
  var BINDINGS = Object.create(null);
  BINDINGS.KeyW = { slot: 'forward', value: 1 };
  BINDINGS.KeyS = { slot: 'forward', value: -1 };
  BINDINGS.KeyA = { slot: 'strafe', value: -1 };
  BINDINGS.KeyD = { slot: 'strafe', value: 1 };
  BINDINGS.ArrowLeft = { slot: 'turn', value: -1 };
  BINDINGS.ArrowRight = { slot: 'turn', value: 1 };
  BINDINGS.ShiftLeft = { slot: 'run' };
  BINDINGS.ShiftRight = { slot: 'run' };
  Input.BINDINGS = BINDINGS;

  // ===========================================================================
  // EVENT HANDLERS — module-scope functions bound ONCE (no per-attach closures,
  // no per-frame allocation). Each sets intent only.
  // ===========================================================================

  function onKeyDown(e) {
    Input.keys[e.code] = true;
  }

  function onKeyUp(e) {
    delete Input.keys[e.code];
  }

  function onClick() {
    Input.requestLock();
  }

  // Accumulate the raw horizontal delta ONLY while the attached canvas holds
  // pointer lock — read at event time so releasing lock stops accumulation
  // immediately (threat T-02-11).
  function onMouseMove(e) {
    if (document.pointerLockElement !== Input.canvas) return;
    Input.mouseDX += e.movementX;
  }

  // ===========================================================================
  // ATTACH — register the listeners against the real window/document/canvas.
  // ===========================================================================
  Input.attach = function (canvas) {
    Input.canvas = canvas;
    // Physical-key state on the window so focus anywhere on the page is captured.
    addEventListener('keydown', onKeyDown);
    addEventListener('keyup', onKeyUp);
    // Lock is requested from a user gesture on the canvas (D-08).
    canvas.addEventListener('click', onClick);
    // Mouse movement is a document-level signal while locked.
    document.addEventListener('mousemove', onMouseMove);
    return Input;
  };

  // ===========================================================================
  // POINTER LOCK — request from a gesture, preferring unadjusted movement, and
  // swallow BOTH a synchronous throw and a rejected promise (D-08, threat
  // T-02-15) so a refused lock never propagates into the loop.
  // ===========================================================================
  Input.requestLock = function () {
    var canvas = Input.canvas;
    if (!canvas || typeof canvas.requestPointerLock !== 'function') return;
    try {
      var p = canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && typeof p.then === 'function') {
        p.then(function () {}, function (err) { Input.lockError = err; });
      }
    } catch (err) {
      Input.lockError = err;
    }
  };

  // ===========================================================================
  // READ INTENT — recompute the four numeric slots and the run boolean from the
  // held-key set, copy in and DRAIN the accumulated mouse delta, return the ONE
  // reused record. Draining on read is what guarantees a mouse delta is applied
  // exactly once (D-07). No allocation.
  // ===========================================================================
  Input.readIntent = function () {
    var intent = Input.intent;
    intent.forward = 0;
    intent.strafe = 0;
    intent.turn = 0;
    intent.run = false;

    var keys = Input.keys;
    for (var code in keys) {
      var b = BINDINGS[code];
      if (!b) continue;
      if (b.slot === 'run') intent.run = true;
      else intent[b.slot] += b.value;
    }

    intent.mouseDX = Input.mouseDX;
    Input.mouseDX = 0;
    return intent;
  };

  // ===========================================================================
  // RESET — clear every held key and zero the mouse accumulator. Called by the
  // loop's refocus resync (and, once Task 2 lands, by blur and lock loss) so a
  // key held when focus was lost cannot stay stuck down (D-07, threat T-02-13).
  // ===========================================================================
  Input.reset = function () {
    var keys = Input.keys;
    for (var code in keys) delete keys[code];
    Input.mouseDX = 0;
  };

})();
