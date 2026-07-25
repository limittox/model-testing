/*
 * game.js — the orchestrator that owns the frame: a requestAnimationFrame loop
 * with a CLAMPED delta-time, a refocus RESYNC, and the two seams (intent + view)
 * that Plan 03 and Phase 3 plug into.
 *
 * LOAD ORDER: loaded AFTER js/player.js and BEFORE js/main.js (see index.html).
 * It reads CONFIG (DT_MAX, CLEAR_COLOR), drives Player.update, and presents
 * through Framebuffer. No rendering logic of its own beyond the clear fallback.
 *
 * THE TWO LOCKED LOOP CONTRACTS (Phase 3 re-points the view seam at the
 * raycaster without touching any of this):
 *
 *   (1) THE CLAMP IS THE WHOLE POINT (PLAT-04, D-05). dt = min(raw, DT_MAX).
 *       An unclamped delta after a tab switch or a GC pause is the documented
 *       tunneling source; the clamp bounds one frame's movement to well under one
 *       cell. A non-finite or negative raw delta coerces to 0 — a backwards clock
 *       must never move the player backwards.
 *
 *   (1b) Game.time IS SIMULATION TIME, OWNED BY step — NOT frame time. The
 *       accumulation lives at the top of Game.step (Phase 5 moved it there out of
 *       Game.frame). Through the rAF loop this is behaviour-identical, because a
 *       resync frame takes dt 0 and never called step anyway. What it buys is
 *       that simulated time ALSO advances under a DIRECT Game.step(dt) call:
 *       without it, Combat.lastDamageAt and plan 05-04's message-age arithmetic
 *       would be frozen at 0 in every harness scenario that needs an exact delta,
 *       and every age-based proof in this phase would pass vacuously.
 *
 *   (2) A PRESENT HAPPENS EXACTLY ONCE PER FRAME — INCLUDING RESYNC FRAMES.
 *       A resync frame (set by start() and by a tab refocus) skips ONLY the step;
 *       it still renders and still presents, so the first frame after start is
 *       painted rather than a black flash, and frames-presented == frames-run
 *       unconditionally. The single putImageData lives HERE (via Game.render),
 *       not in each view, so Phase 1's single-blit-per-frame contract survives
 *       every future view swap.
 *
 * THE SEAMS (this is why the loop is written before its consumers exist):
 *   Game.input — null, or an object exposing readIntent() -> intent record (and
 *                optionally reset()). Plan 03 attaches live keyboard/mouse input.
 *   Game.view  — null, or an object exposing render() that writes into
 *                Framebuffer.buf32 and does NOT present. Plan 03 attaches the
 *                top-down view; Phase 3 swaps in the raycaster.
 */

var Game = {
  // --- Frame state ---
  running: false, // is the loop scheduled?
  last: 0,        // previous frame timestamp, milliseconds
  dt: 0,          // last clamped delta, seconds
  time: 0,        // accumulated simulated seconds
  frames: 0,      // frames run since start
  rafId: 0,       // pending requestAnimationFrame handle
  resync: false,  // when set, the NEXT frame takes dt=0 and skips only the step

  // --- Seams (defaults; assigned by Plan 03 / Phase 3) ---
  input: null,    // { readIntent(): intent, reset?() }
  view: null,     // { render(): void }  — writes buf32, does NOT present

  // The intent record used whenever no input source is attached. Frozen and
  // shared so no per-frame allocation happens in the hot loop.
  ZERO_INTENT: Object.freeze({ forward: 0, strafe: 0, turn: 0, mouseDX: 0, run: false })
};

(function () {
  'use strict';

  // The frame callback is bound ONCE at module scope and reused, so scheduling
  // allocates nothing per frame (threat T-02-09: no GC churn in the hot loop).
  function frameCallback(now) {
    Game.frame(now);
  }

  function resetInput() {
    if (Game.input && typeof Game.input.reset === 'function') Game.input.reset();
  }

  // ===========================================================================
  // FRAME (PLAT-04, D-05 — locked).
  // ===========================================================================
  Game.frame = function (now) {
    if (!Game.running) return;

    // Decide the frame kind ONCE, up front, so the step decision is unambiguous:
    // a resync frame skips only the step; every other frame steps normally.
    var isResync = Game.resync;

    var dt;
    if (isResync) {
      // Absorb a tab refocus (or the very first frame after start) without mixing
      // timestamp sources: take dt 0 and clear the flag. This frame still renders
      // and presents — only the step is skipped.
      Game.resync = false;
      dt = 0;
    } else {
      var raw = (now - Game.last) / 1000;
      // A non-finite or negative raw delta coerces to 0 (a backwards clock must
      // never move the player backwards), then THE CLAMP bounds it to DT_MAX.
      if (!isFinite(raw) || raw < 0) raw = 0;
      dt = raw > CONFIG.DT_MAX ? CONFIG.DT_MAX : raw;
    }

    Game.last = now;
    Game.dt = dt;
    Game.frames += 1;
    // NOTE: Game.time is NOT accumulated here — it is simulation time and is
    // accumulated at the top of Game.step (contract 1b). Behaviour through this
    // loop is identical: a resync frame takes dt 0 and skips the step anyway.

    // Step only on a non-resync frame; render and present ALWAYS.
    if (!isResync) Game.step(dt);
    Game.render();
    if (Game.running) Game.rafId = requestAnimationFrame(frameCallback);
  };

  // ===========================================================================
  // STEP — advance the simulation. Reads intent through the seam.
  // ===========================================================================
  Game.step = function (dt) {
    // SIMULATION TIME (contract 1b). Accumulated here so it advances under BOTH
    // the rAF loop and a direct Game.step(dt) call. Guarded so one bad delta
    // cannot poison every age comparison that reads it.
    if (isFinite(dt) && dt > 0) Game.time += dt;

    var intent = Game.input ? Game.input.readIntent() : Game.ZERO_INTENT;

    // A DEAD PLAYER IS INERT (05-CONTEXT D-04). The intent is still SAMPLED (so
    // the input source still drains its accumulated mouse delta and cannot
    // release a stored turn on respawn), but the FROZEN zero intent is what
    // reaches the simulation: a dead player neither moves, turns nor fires while
    // the enemies and projectiles around it keep simulating. This substitution
    // is the entire mechanism behind Combat.dead — the flag does nothing on its
    // own.
    if (typeof Combat !== 'undefined' && Combat.dead) intent = Game.ZERO_INTENT;

    Player.update(dt, intent);

    // Entity simulation. Enemies first (they may release a projectile this
    // frame), then the projectiles they own. Guarded by typeof so game.js stays
    // loadable without the Phase 5 modules. Later phases add weapon updates here.
    if (typeof Enemies !== 'undefined') {
      Enemies.update(dt);
      Enemies.updateProjectiles(dt);
    }
  };

  // ===========================================================================
  // RENDER — view seam, then exactly ONE present(). The present lives here so
  // the single-blit-per-frame contract survives every view swap.
  // ===========================================================================
  Game.render = function () {
    if (Game.view && typeof Game.view.render === 'function') {
      Game.view.render();
    } else {
      Framebuffer.clear(CONFIG.CLEAR_COLOR);
    }
    Framebuffer.present();
  };

  // ===========================================================================
  // CONTROL.
  // ===========================================================================

  // Start the loop. Idempotent (a second call while running is a no-op). Sets
  // resync so the FIRST frame takes dt 0 — and still paints, never a black flash.
  Game.start = function () {
    if (Game.running) return;
    Game.running = true;
    Game.resync = true;
    Game.last = (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : 0;
    Game.rafId = requestAnimationFrame(frameCallback);
  };

  // Stop the loop and cancel the pending frame.
  Game.stop = function () {
    Game.running = false;
    if (Game.rafId) {
      cancelAnimationFrame(Game.rafId);
      Game.rafId = 0;
    }
  };

  // Register the resync triggers: becoming visible again, or the window
  // regaining focus, both set resync AND reset the input source (so a key held
  // when focus was lost cannot stay stuck down — belt and braces alongside the
  // clamp). Idempotent.
  var attached = false;
  function onVisibilityChange() {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      Game.resync = true;
      resetInput();
    }
  }
  function onFocus() {
    Game.resync = true;
    resetInput();
  }
  Game.attach = function () {
    if (attached) return;
    attached = true;
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    if (typeof addEventListener !== 'undefined') {
      addEventListener('focus', onFocus);
    }
  };

})();
