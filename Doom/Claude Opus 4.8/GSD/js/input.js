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

  // Counts pointer-lock requests, so the harness can prove the click handler
  // actually requested lock (i.e. lock is gesture-scoped, not requested at load).
  lockAttempts: 0,

  // Per-EVENT magnitude clamp for a single mouse movement (pixels). A single huge
  // movementX after regaining focus cannot spin the camera (threat T-02-12);
  // accumulation across several events in one frame is preserved — only each
  // event's own contribution is bounded.
  MOUSE_MAX_DX: 200,

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

  // PREVENT — physical key codes whose browser default action is suppressed, so
  // the page never scrolls while playing (D-07): every bound code plus the
  // remaining arrows and Space. Null-prototype for a clean membership test.
  var PREVENT = Object.create(null);
  for (var code in BINDINGS) PREVENT[code] = true;
  PREVENT.ArrowUp = true;
  PREVENT.ArrowDown = true;
  PREVENT.Space = true;
  Input.PREVENT = PREVENT;

  // ===========================================================================
  // EVENT HANDLERS — module-scope functions bound ONCE (no per-attach closures,
  // no per-frame allocation). Each sets intent only.
  // ===========================================================================

  function onKeyDown(e) {
    // Auto-repeat fires keydown repeatedly while a key is held; the held-key set
    // only needs the first, so ignore repeats (the set is set once per press).
    if (e.repeat) { if (PREVENT[e.code] && e.preventDefault) e.preventDefault(); return; }
    Input.keys[e.code] = true;
    if (PREVENT[e.code] && e.preventDefault) e.preventDefault();
  }

  function onKeyUp(e) {
    delete Input.keys[e.code];
    if (PREVENT[e.code] && e.preventDefault) e.preventDefault();
  }

  function onClick() {
    Input.requestLock();
  }

  // Accumulate the raw horizontal delta ONLY while the attached canvas holds
  // pointer lock — read at event time so releasing lock stops accumulation
  // immediately (threat T-02-11). Each event's contribution is coerced-finite and
  // magnitude-clamped to MOUSE_MAX_DX before accumulating (threat T-02-12).
  function onMouseMove(e) {
    if (document.pointerLockElement !== Input.canvas) return;
    var dx = e.movementX;
    if (!isFinite(dx)) dx = 0;
    if (dx > Input.MOUSE_MAX_DX) dx = Input.MOUSE_MAX_DX;
    else if (dx < -Input.MOUSE_MAX_DX) dx = -Input.MOUSE_MAX_DX;
    Input.mouseDX += dx;
  }

  // POINTER-LOCK LIFECYCLE (CTRL-02, D-08). On any change, mirror whether the
  // attached canvas holds lock. On LOSS (e.g. Escape) both zero the accumulator
  // and reset held keys, so releasing lock cannot leave a stale delta queued or a
  // key stuck down (threat T-02-13). Arrow-key turning is unaffected by any of
  // this — it never consults Input.locked (the CTRL-03 fallback).
  function onPointerLockChange() {
    var held = document.pointerLockElement === Input.canvas;
    Input.locked = held;
    if (!held) {
      Input.mouseDX = 0;
      Input.reset();
    }
  }

  // A lock FAILURE only records — it must NOT disable turning, because the
  // arrow-key fallback has to remain fully functional when lock is refused
  // (CTRL-03, threat T-02-15).
  function onPointerLockError() {
    Input.locked = false;
    Input.lockError = 'pointerlockerror';
  }

  // Losing window focus clears held keys so a key cannot stay stuck down while
  // the game is in the background (D-07, threat T-02-13).
  function onBlur() {
    Input.reset();
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
    // Pointer-lock lifecycle: track lock state, clean up on loss/error.
    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('pointerlockerror', onPointerLockError);
    // Losing focus must never leave a key stuck down.
    addEventListener('blur', onBlur);
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
    Input.lockAttempts += 1; // proves the request came from the click gesture
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

    // The turn slot (ArrowLeft/ArrowRight) is computed PURELY from the held-key
    // set here, with NO dependency on Input.locked or document.pointerLockElement.
    // That independence is the CTRL-03 fallback (D-08): keyboard turning must work
    // when pointer lock is denied, unsupported, or released with Escape — it is a
    // first-class control path, not a debug affordance.
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
