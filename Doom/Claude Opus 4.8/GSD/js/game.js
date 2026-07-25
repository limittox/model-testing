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

  // --- Progression counters (ENEM-05, Phase 5 plan 05-03) ---
  // kills      — incremented EXACTLY ONCE per enemy death, by Enemies.hurt, inside
  //              the same branch that clears the enemy's alive flag.
  // totalKills — the enemy count Enemies.build() ADOPTED from the spawn table, so
  //              the tally always reads out of the real total.
  //
  // They live on Game rather than on Enemies because they are PROGRESSION, not AI:
  // Phase 6's HUD readout (HUD-01/HUD-02) and its victory condition both read them,
  // and neither should have to reach into the AI module. Phase 5 produces the
  // numbers and draws nothing.
  kills: 0,
  totalKills: 0,

  // --- The message QUEUE (PICK-05, Phase 5 plan 05-04) ---
  // A PREALLOCATED RING of CONFIG.MESSAGE_MAX records, filled in below at module
  // load. Each record is {text, at} where `at` is the Game.time the message was
  // posted (-1 = the slot has never been written). message(text) writes the slot
  // at `messageHead` and advances the head — nothing is allocated per message and
  // the ring cannot grow, so a player standing on a pile of pickups cannot make
  // the queue unbounded (threat T-05-26).
  //
  // Phase 5 PRODUCES the queue and draws one minimal line (Game.renderMessage);
  // Phase 6's HUD owns the real presentation.
  messages: [],
  messageHead: 0,
  messagesPosted: 0,

  // --- Seams (defaults; assigned by Plan 03 / Phase 3) ---
  input: null,    // { readIntent(): intent, reset?() }
  view: null,     // { render(): void }  — writes buf32, does NOT present

  // The intent record used whenever no input source is attached — and, since
  // Phase 5, substituted for the sampled intent while the player is dead. Frozen
  // and shared so no per-frame allocation happens in the hot loop.
  //
  // EVERY FIELD OF THE INTENT CONTRACT MUST APPEAR HERE. `fire` and `weaponSlot`
  // are Phase 5's additions (Weapons.update consumes them): a missing field would
  // read `undefined` for a dead player, and `undefined === true` is false only by
  // luck of how the consumer happens to be written.
  ZERO_INTENT: Object.freeze({
    forward: 0, strafe: 0, turn: 0, mouseDX: 0, run: false,
    fire: false, weaponSlot: 0
  })
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

    // THE PLAYER'S WEAPONS run LAST, with the SAME intent record sampled once at
    // the top of this function — so the "intent is read exactly once per frame"
    // contract holds across every consumer. Weapons.update owns every cooldown and
    // ammo decision; passing the (possibly ZERO_INTENT-substituted) intent through
    // is what makes the dead-player freeze cover firing for free.
    if (typeof Weapons !== 'undefined') Weapons.update(dt, intent);

    // PICKUPS run LAST, after every actor has finished moving, so the proximity
    // test sees the pose the frame actually ended on rather than a stale one.
    // Collection is position-driven and takes no intent (PICK-05: there is no
    // interact key) — which also means a DEAD player still cannot collect, because
    // the ZERO_INTENT substitution above froze them where they stood.
    if (typeof Pickups !== 'undefined') Pickups.update(dt);
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
  // RESET STATS (ENEM-05) — zero the kill tally. Called from main.js during boot
  // alongside Combat.reset(), and again by Enemies.build() (a rebuild resurrects
  // every enemy, so a carried-over tally would be counting the living).
  //
  // totalKills is deliberately NOT touched here: Enemies.build() owns it, because
  // only the AI knows how many enemies the level actually produced.
  // ===========================================================================
  Game.resetStats = function () {
    Game.kills = 0;
    Game.clearMessages();
    return Game;
  };

  // ===========================================================================
  // THE MESSAGE QUEUE (PICK-05, 05-04) — the EVENT half of "picking something up
  // tells you what you got". Phase 5 posts; Game.renderMessage draws one minimal
  // line into the framebuffer; Phase 6's HUD owns the real presentation.
  // ===========================================================================

  // Preallocate the ring ONCE, here at module load. CONFIG is loaded first (it is
  // script 1 in the load-order contract), so the size is available. Every record
  // is created here and MUTATED thereafter — message() allocates nothing.
  (function allocateMessageRing() {
    var n = CONFIG.MESSAGE_MAX;
    Game.messages.length = 0;
    for (var i = 0; i < n; i++) Game.messages.push({ text: '', at: -1 });
    Game.messageHead = 0;
    Game.messagesPosted = 0;
  })();

  // POST a message. Writes the next slot and advances the head. Returns whether
  // anything was posted, so a caller can tell a real post from a rejected one.
  //
  // Stamped with Game.time — SIMULATION time, accumulated inside Game.step
  // (contract 1b) — so a message ages under BOTH the rAF loop and a direct
  // Game.step(dt). Stamping with wall-clock time here is what would make every
  // age-based proof in this phase vacuous.
  Game.message = function (text) {
    if (typeof text !== 'string' || text.length === 0) return false;
    var n = Game.messages.length;
    if (n === 0) return false;
    var slot = Game.messages[Game.messageHead];
    slot.text = text;
    slot.at = Game.time;
    Game.messageHead = (Game.messageHead + 1) % n;
    Game.messagesPosted += 1;
    return true;
  };

  // The NEWEST message whose age is below CONFIG.MESSAGE_TIME, or null.
  //
  // Only the newest slot needs testing, and that is a property of the data rather
  // than a shortcut: Game.time is monotonic, so posting times are non-decreasing
  // around the ring — if the newest record has expired, every older one expired
  // earlier. Two pickups collected in quick succession therefore leave the SECOND
  // message on screen, which is the intended behaviour.
  Game.activeMessage = function () {
    var n = Game.messages.length;
    if (n === 0) return null;
    var slot = Game.messages[(Game.messageHead - 1 + n) % n];
    if (slot.at < 0 || slot.text.length === 0) return null;
    var age = Game.time - slot.at;
    // `!(age >= 0)` catches NaN, which `age < 0` would not.
    if (!(age >= 0) || age >= CONFIG.MESSAGE_TIME) return null;
    return slot;
  };

  // Age of the active message in seconds, or -1 when there is none. Exposed so the
  // draw pass (and a future HUD) derives its fade from one place.
  Game.messageAge = function () {
    var slot = Game.activeMessage();
    return slot ? (Game.time - slot.at) : -1;
  };

  // Clear the ring IN PLACE — the records and the array keep their identities, so
  // nothing holding a reference is orphaned. Called by resetStats(), which means a
  // world rebuild also wipes the messages the previous world posted.
  Game.clearMessages = function () {
    for (var i = 0; i < Game.messages.length; i++) {
      Game.messages[i].text = '';
      Game.messages[i].at = -1;
    }
    Game.messageHead = 0;
    Game.messagesPosted = 0;
    return Game;
  };

  // ===========================================================================
  // THE MESSAGE LINE (PICK-05) — the one piece of on-screen text Phase 5 draws.
  //
  // Pushed onto Raycaster.overlayPasses by main.js AFTER the weapon viewmodel, so
  // it composites on top of the gun inside the SAME Raycaster.render() call — no
  // second present, so the once-per-frame blit contract is untouched.
  //
  // IT IS NOT IN THE WORLD, exactly like the viewmodel:
  //   . it NEVER writes Framebuffer.zBuffer (nothing in the world can be occluded
  //     by a line of text, and the next frame's wall pass owns every column);
  //   . every written pixel is forced OPAQUE by Raycaster.applyShade, and a texel
  //     the alpha key rejects is skipped entirely — so there is no fringe and no
  //     halo, structurally, by the same binary-alpha argument the sprite pass uses;
  //   . the FADE is a colour scale through applyShade, never a partial alpha.
  //
  // INDEX SAFETY (threat T-05-25): the destination loop bounds are clamped into
  // [0,W) x [0,H) per glyph, and a character with no glyph is SKIPPED rather than
  // looked up out of range. The integer scale is additionally clamped DOWN so the
  // whole line fits the frame width, so no message length can push the box off the
  // right-hand edge in the first place.
  //
  // BOUNDARY: this is deliberately ONE LINE and nothing else. The HUD readouts, the
  // crosshair, the minimap and the damage flash are Phase 6.
  // ===========================================================================

  // The last drawn text box, recorded (never allocated — one reused record) so a
  // harness and Phase 6's HUD can ask where the line ended up without re-deriving
  // the centring and scale arithmetic. Same discipline as Weapons.viewmodelBox.
  Game.messageBox = { x: 0, y: 0, w: 0, h: 0, scale: 0, shade: 0, drawn: false };

  // The fade shade for an age, as an INTEGER fixed-point value in [0,256] — the
  // same representation Raycaster.shadeFactor returns, so applyShade consumes it
  // directly. Full brightness for the first (1 - MESSAGE_FADE_FRAC) of the
  // message's life, then a linear ramp down to MESSAGE_MIN_SHADE.
  Game.messageShade = function (age) {
    var life = CONFIG.MESSAGE_TIME;
    if (!(life > 0)) return 256;
    var fade = CONFIG.MESSAGE_FADE_FRAC * life;
    var holdUntil = life - fade;
    var s;
    if (!(fade > 0) || age <= holdUntil) {
      s = 1;
    } else {
      s = 1 - (age - holdUntil) / fade;               // 1 -> 0 across the fade
      s = CONFIG.MESSAGE_MIN_SHADE + (1 - CONFIG.MESSAGE_MIN_SHADE) * s;
      if (s < CONFIG.MESSAGE_MIN_SHADE) s = CONFIG.MESSAGE_MIN_SHADE;
      if (s > 1) s = 1;
    }
    return (s * 256) | 0;
  };

  // Draw `text` with its top-left at (x0, y0) at an integer scale, every texel
  // shaded by `shade`. Nearest-neighbour by construction (an integer scale means
  // each source texel is a scale x scale block), so there is no sampling at all.
  function drawText(text, x0, y0, scale, shade) {
    var font = Sprites.font;
    var glyphs = font.glyphs;
    var gw = font.width, gh = font.height;
    var advance = (gw + font.spacing) * scale;
    var W = Framebuffer.width, H = Framebuffer.height;
    var buf = Framebuffer.buf32;
    var ALPHA_KEY = Sprites.ALPHA_KEY;
    var applyShade = Raycaster.applyShade;

    var penX = x0;
    for (var i = 0; i < text.length; i++) {
      var g = glyphs[text.charAt(i)];
      // An unknown character draws NOTHING and still advances the pen — a blank,
      // never an out-of-range lookup.
      if (g !== undefined) {
        var gbuf = g.buf32;
        for (var sy = 0; sy < gh; sy++) {
          var dy0 = y0 + sy * scale;
          for (var sx = 0; sx < gw; sx++) {
            var packed = gbuf[sy * gw + sx];
            // The alpha key on the RAW texel, before anything touches it.
            if (((packed >>> 24) & 0xff) < ALPHA_KEY) continue;
            var shaded = applyShade(packed, shade);   // forces alpha OPAQUE
            var dx0 = penX + sx * scale;
            for (var py = 0; py < scale; py++) {
              var dy = dy0 + py;
              if (dy < 0 || dy >= H) continue;        // clamped into range
              var rowBase = dy * W;
              for (var px = 0; px < scale; px++) {
                var dx = dx0 + px;
                if (dx < 0 || dx >= W) continue;      // clamped into range
                buf[rowBase + dx] = shaded;
              }
            }
          }
        }
      }
      penX += advance;
    }
  }

  Game.renderMessage = function () {
    var box = Game.messageBox;
    box.drawn = false;

    var slot = Game.activeMessage();
    if (slot === null) return;
    if (typeof Sprites === 'undefined' || !Sprites.font) return;
    if (typeof Raycaster === 'undefined' || !Raycaster.applyShade) return;

    var font = Sprites.font;
    var gw = font.width, gh = font.height, gap = font.spacing;
    var W = Framebuffer.width, H = Framebuffer.height;
    var text = slot.text;
    if (text.length === 0) return;

    // The line's width in GLYPH units: one advance per character, minus the
    // trailing inter-glyph gap the last character does not need.
    var unitsW = text.length * (gw + gap) - gap;

    // Integer scale DERIVED from the frame height (legible at any internal
    // resolution), then CLAMPED DOWN so the line fits the width. The clamp is
    // structural: no text length can overflow the right-hand edge.
    var scale = Math.floor(H / CONFIG.MESSAGE_SCALE_DIV);
    if (scale < 1) scale = 1;
    var maxScale = Math.floor(W / unitsW);
    if (maxScale < 1) maxScale = 1;
    if (scale > maxScale) scale = maxScale;

    var textW = unitsW * scale;
    var textH = gh * scale;
    var x0 = Math.floor((W - textW) / 2);              // horizontally CENTRED
    var y0 = Math.floor(H * CONFIG.MESSAGE_Y_FRAC);    // in the LOWER THIRD

    var shade = Game.messageShade(Game.time - slot.at);
    var shadowShade = (shade * CONFIG.MESSAGE_SHADOW_SHADE) | 0;
    if (shadowShade < 0) shadowShade = 0;

    // THE DROP SHADOW FIRST, offset by one pixel down-right, so the text overwrites
    // its own shadow where they overlap and the line reads over any background.
    drawText(text, x0 + 1, y0 + 1, scale, shadowShade);
    drawText(text, x0, y0, scale, shade);

    // The box covers BOTH copies, which is what makes it the true written extent.
    box.x = x0; box.y = y0;
    box.w = textW + 1; box.h = textH + 1;
    box.scale = scale; box.shade = shade;
    box.drawn = true;
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
