/*
 * hud.js — the #hud OVERLAY renderer (06-CONTEXT D-01).
 *
 * LOAD ORDER: loaded AFTER js/pickups.js and BEFORE js/game.js (see index.html).
 * game.js DISPATCHES it (Game.render calls HUD.render under a typeof guard), so it
 * has to exist before game.js runs its first frame; it needs Framebuffer for the
 * overlay context, and it reads CONFIG, Game and Combat AT CALL TIME rather than at
 * load time, so nothing here depends on a module that loads after it.
 *
 * ============================================================================
 * THE OVERLAY CONTRACT (D-01) — three rules, all load-bearing
 * ============================================================================
 *
 *   (1) IT DRAWS ON #hud, NEVER ON THE FRAMEBUFFER. Framebuffer.hudCtx is a
 *       transparent, DISPLAY-resolution 2D context with pointer-events:none,
 *       reserved for exactly this since Phase 1. Text drawn here is crisp at
 *       native resolution instead of being upscaled with the 480-wide 3D view.
 *
 *   (2) IT NEVER CALLS putImageData OR getImageData ON EITHER CONTEXT. The single
 *       putImageData per frame belongs to Framebuffer.present(), called from
 *       Game.render — that is the Phase 1 once-per-frame blit contract, and this
 *       module composites through the 2D drawing API instead so the contract is
 *       untouched. (getImageData is additionally a tainting trap.)
 *
 *   (3) IT REPAINTS EVERY FRAME, FROM SCRATCH. Framebuffer.resize() re-sizes the
 *       #hud backing store, and re-sizing a canvas CLEARS it — so anything painted
 *       once and left would silently vanish the first time the window moved.
 *       clearRect + full repaint every frame is the simplest correct answer and is
 *       what the Phase 1 verification forward-note asked for.
 *
 * ============================================================================
 * NO PER-FRAME ALLOCATION (threat T-06-06)
 * ============================================================================
 * The render path creates no object, no array and no closure. Specifically:
 *   . HUD.METRICS is ONE preallocated record, recomputed IN PLACE each frame;
 *   . the controls list is a module-scope array built once at load;
 *   . the canvas 2D text API takes STRINGS, which is unavoidable — so the two
 *     places strings would otherwise be rebuilt 60 times a second are CACHED and
 *     rebuilt only when their inputs actually change: the `NNpx family` font
 *     strings (keyed on the canvas height) and the stat readouts (keyed on the
 *     kill counts and the whole-second time).
 *
 * ============================================================================
 * BOUNDARY (this plan, 06-01)
 * ============================================================================
 * This file owns the THREE FULL-SCREEN STATE SCREENS and nothing else. In the
 * PLAYING state HUD.render draws NOTHING AT ALL — plan 06-02 fills that in with
 * the status bar, the crosshair, the minimap and the damage flash.
 *
 * IT ADDS NO MESSAGE RENDERER (06-CONTEXT D-02, resolved). Game.renderMessage
 * stays registered in Raycaster.overlayPasses as the ONE AND ONLY renderer of the
 * event line. Adding a second one here is exactly the double-draw the decision
 * exists to prevent; tools/verify-state.cjs section 4 is the gate that keeps it
 * that way as 06-02 builds on this file.
 */

var HUD = {
  // The screen name drawn by the last HUD.render(), or null when it drew none
  // (the playing state, or a missing/degenerate overlay context). Recorded rather
  // than inferred so a harness can ask what was painted without re-deriving the
  // state dispatch. Same discipline as Game.messageBox and Weapons.viewmodelBox.
  screen: null,

  // Frames on which a repaint actually happened. Monotonic until reset().
  renders: 0,

  // THE ONE PREALLOCATED METRICS RECORD. Every field is recomputed in place at the
  // top of each render from the LIVE hud canvas size, so the layout tracks a
  // window resize for free and nothing is allocated to do it.
  METRICS: {
    w: 0,        // hud canvas width, display pixels
    h: 0,        // hud canvas height, display pixels
    cx: 0,       // horizontal centre — every screen is centre-aligned
    heading: 0,  // heading text size, px
    body: 0,     // body text size, px
    prompt: 0,   // prompt text size, px
    line: 0      // baseline-to-baseline spacing for stacked lines, px
  }
};

(function () {
  'use strict';

  // ===========================================================================
  // SCREEN COPY — data, not literals buried in the draw calls.
  //
  // THE THREE PROMPTS ARE DELIBERATELY DISTINCT STRINGS, not one string with a
  // suffix. tools/verify-state.cjs proves the screens SWITCH by asserting that the
  // victory recording does NOT contain the title screen's prompt — which a
  // "CLICK TO PLAY" / "CLICK TO PLAY AGAIN" pair would satisfy vacuously, because
  // one contains the other as a substring.
  // ===========================================================================
  var TITLE_HEADING = 'DOOM CLONE';
  var TITLE_PROMPT = 'CLICK TO BEGIN';

  // (The victory and death prompts are likewise distinct rather than variations
  // on one stem, for the same falsifiability reason.)
  var VICTORY_HEADING = 'VICTORY';
  var VICTORY_PROMPT = 'CLICK TO PLAY AGAIN';

  var DEAD_HEADING = 'YOU DIED';
  var DEAD_PROMPT = 'CLICK TO TRY AGAIN';

  // The controls list (LVL-06: the title screen must SHOW the controls). Built
  // once, here, at module load. Each entry names a physical control and what it
  // does, in the same order a new player needs them.
  var CONTROLS = [
    'WASD  -  MOVE AND STRAFE',
    'ARROWS / MOUSE  -  TURN',
    'SHIFT  -  RUN',
    'SPACE / CTRL / MOUSE  -  FIRE',
    '1 / 2  -  SELECT WEAPON',
    'ESC  -  RELEASE THE MOUSE'
  ];

  // Vertical anchors, as fractions of the hud canvas height. Local to the layout
  // rather than in CONFIG because they are composition, not tuning: they exist to
  // keep the three screens on the same grid, and moving one without the others
  // would only break that alignment.
  var TITLE_HEADING_Y = 0.24;
  var TITLE_LIST_Y = 0.42;
  var TITLE_PROMPT_Y = 0.82;
  var END_HEADING_Y = 0.30;
  var END_STATS_Y = 0.48;
  var END_PROMPT_Y = 0.74;

  // ===========================================================================
  // THE TWO STRING CACHES. Both exist for exactly one reason: the Canvas 2D text
  // API consumes strings, so a naive implementation would build fresh strings 60
  // times a second and hand the GC a steady drip of garbage in the frame path.
  // Each rebuilds ONLY when its inputs change — the font strings when the window
  // height changes, the stat readouts when a counter or the whole-second clock
  // ticks. Both are module-scope records mutated in place, never reallocated.
  // ===========================================================================

  var fonts = { h: -1, heading: '', body: '', prompt: '' };

  function updateFonts(h) {
    if (fonts.h === h) return;
    fonts.h = h;
    var family = CONFIG.SCREEN_FONT_FAMILY;
    fonts.heading = Math.round(CONFIG.SCREEN_HEADING_FRAC * h) + 'px ' + family;
    fonts.body = Math.round(CONFIG.SCREEN_BODY_FRAC * h) + 'px ' + family;
    fonts.prompt = Math.round(CONFIG.SCREEN_PROMPT_FRAC * h) + 'px ' + family;
  }

  var stats = { kills: -1, total: -1, secs: -1, killsText: '', timeText: '' };

  // THE ONE STAT FORMATTER. The victory screen and the death screen both go
  // through it, so the two readouts cannot drift apart into different wordings or
  // different time formats — the reason 06-01's victory screen and 06-02's
  // additions share this function rather than each formatting their own.
  function updateStats(kills, total, time) {
    var secs = (isFinite(time) && time > 0) ? Math.floor(time) : 0;
    if (stats.kills === kills && stats.total === total && stats.secs === secs) return;
    stats.kills = kills;
    stats.total = total;
    stats.secs = secs;
    stats.killsText = 'KILLS   ' + kills + ' / ' + total;
    var mm = Math.floor(secs / 60);
    var ss = secs % 60;
    stats.timeText = 'TIME   ' + (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
  }

  // ===========================================================================
  // DRAW HELPERS. One centred line at a time; the caller owns the vertical rhythm.
  // ===========================================================================
  function centred(ctx, text, y, font, color) {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.fillText(text, HUD.METRICS.cx, y);
  }

  // THE SCRIM. A translucent full-canvas wash under every screen, so the frozen
  // world behind the overlay reads as a BACKDROP rather than competing with the
  // text. globalAlpha is restored to 1 immediately: the context is shared with
  // everything 06-02 will draw, so leaving it modified would tint the HUD.
  function scrim(ctx, m) {
    ctx.globalAlpha = CONFIG.SCREEN_SCRIM_ALPHA;
    ctx.fillStyle = CONFIG.SCREEN_SCRIM_COLOR;
    ctx.fillRect(0, 0, m.w, m.h);
    ctx.globalAlpha = 1;
  }

  // ===========================================================================
  // THE TITLE SCREEN (LVL-06) — the game name, the controls, and the ONE-CLICK
  // start prompt. This is the first thing a player ever sees, and the click it
  // asks for is the single gesture that starts play, captures the mouse and
  // unlocks the audio.
  // ===========================================================================
  function drawTitle(ctx, m) {
    centred(ctx, TITLE_HEADING, m.h * TITLE_HEADING_Y, fonts.heading,
      CONFIG.SCREEN_HEADING_COLOR);
    var y = m.h * TITLE_LIST_Y;
    for (var i = 0; i < CONTROLS.length; i++) {
      centred(ctx, CONTROLS[i], y, fonts.body, CONFIG.SCREEN_TEXT_COLOR);
      y += m.line;
    }
    centred(ctx, TITLE_PROMPT, m.h * TITLE_PROMPT_Y, fonts.prompt,
      CONFIG.SCREEN_PROMPT_COLOR);
  }

  // ===========================================================================
  // AN END SCREEN — the victory screen here, and the death screen through the
  // SAME function so the two can only ever differ by their heading and prompt.
  //
  // THE STATS COME FROM Game.result, NOT FROM THE LIVE COUNTERS. Game.result was
  // stamped at the instant of the transition, so the numbers on screen are the
  // numbers the run actually ended on and cannot move while the screen is up
  // (threat T-06-08). The sim is frozen anyway, so this is belt and braces — but
  // it is the belt that keeps 06-02's HUD from having to care.
  // ===========================================================================
  function drawEnd(ctx, m, heading, prompt) {
    var r = Game.result;
    updateStats(r.kills, r.totalKills, r.time);
    centred(ctx, heading, m.h * END_HEADING_Y, fonts.heading,
      CONFIG.SCREEN_HEADING_COLOR);
    var y = m.h * END_STATS_Y;
    centred(ctx, stats.killsText, y, fonts.body, CONFIG.SCREEN_TEXT_COLOR);
    y += m.line;
    centred(ctx, stats.timeText, y, fonts.body, CONFIG.SCREEN_TEXT_COLOR);
    centred(ctx, prompt, m.h * END_PROMPT_Y, fonts.prompt, CONFIG.SCREEN_PROMPT_COLOR);
  }

  // ===========================================================================
  // RENDER — called by Game.render AFTER Framebuffer.present(), every frame,
  // in every state.
  //
  // Returns whether anything was painted, so a harness can tell "drew a screen"
  // from "deliberately drew nothing" without reading state back.
  // ===========================================================================
  HUD.render = function () {
    HUD.screen = null;

    // Fail closed and silently on a missing overlay: the 3D view has already been
    // presented by the time this runs, so a HUD that cannot draw must cost the
    // player the overlay, never the frame.
    if (typeof Framebuffer === 'undefined' || !Framebuffer.hudCtx) return false;
    var ctx = Framebuffer.hudCtx;
    var canvas = Framebuffer.hudCanvas;
    var w = canvas ? canvas.width : 0;
    var h = canvas ? canvas.height : 0;
    // `!(a > 0)` catches NaN as well as 0 — a degenerate (minimised) viewport.
    if (!(w > 0) || !(h > 0)) return false;

    // RULE 3: the whole overlay, cleared and repainted, every frame.
    ctx.clearRect(0, 0, w, h);
    HUD.renders += 1;

    if (typeof Game === 'undefined' || !Game.STATES) return false;
    var S = Game.STATES;
    var state = Game.state;

    // THE PLAYING STATE DRAWS NOTHING IN THIS PLAN. Not an oversight and not a
    // stub that breaks anything: the frame is already complete without it. Plan
    // 06-02 fills this branch with the status bar, crosshair, minimap and damage
    // flash. The clearRect above has already run, so 06-02 inherits a clean
    // surface and the repaint-every-frame contract for free.
    if (state === S.PLAYING) return false;

    var m = HUD.METRICS;
    m.w = w;
    m.h = h;
    m.cx = w * 0.5;
    m.heading = Math.round(CONFIG.SCREEN_HEADING_FRAC * h);
    m.body = Math.round(CONFIG.SCREEN_BODY_FRAC * h);
    m.prompt = Math.round(CONFIG.SCREEN_PROMPT_FRAC * h);
    m.line = Math.round(CONFIG.SCREEN_LINE_FRAC * h);
    updateFonts(h);

    scrim(ctx, m);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (state === S.TITLE) {
      drawTitle(ctx, m);
      HUD.screen = S.TITLE;
      return true;
    }
    if (state === S.VICTORY) {
      drawEnd(ctx, m, VICTORY_HEADING, VICTORY_PROMPT);
      HUD.screen = S.VICTORY;
      return true;
    }
    // THE DEATH SCREEN (LVL-05) goes through the SAME drawEnd as the victory
    // screen — same layout, same stat formatter, same Game.result source. Only the
    // heading and the prompt differ, which is the whole reason they cannot drift
    // apart into two subtly different readouts. The prompt IS the restart
    // affordance LVL-05 asks for: a click here calls Game.restart().
    if (state === S.DEAD) {
      drawEnd(ctx, m, DEAD_HEADING, DEAD_PROMPT);
      HUD.screen = S.DEAD;
      return true;
    }
    // An UNKNOWN state falls through here having painted only the scrim — fails
    // closed to "something is covering the world", never to a silent playing HUD.
    return false;
  };

  // ===========================================================================
  // RESET — clear the recorded bookkeeping and invalidate both string caches, so
  // the next render rebuilds them from the live values rather than trusting a
  // cache seeded by the world that just ended.
  //
  // Called by main.js at boot and by Game.restart(). It is ALSO the hook plan
  // 06-02 will hang its minimap prebuild off: the minimap is derived from
  // Level.cells, and Game.restart() calls Level.build() before this, so a rebuild
  // is exactly when a derived minimap must be regenerated.
  // ===========================================================================
  HUD.reset = function () {
    HUD.screen = null;
    HUD.renders = 0;
    fonts.h = -1;
    fonts.heading = '';
    fonts.body = '';
    fonts.prompt = '';
    stats.kills = -1;
    stats.total = -1;
    stats.secs = -1;
    stats.killsText = '';
    stats.timeText = '';
    return HUD;
  };

  // Exposed as data so a harness (and 06-02) can assert against the exact copy
  // rather than re-typing it. Read-only by convention — nothing writes these.
  HUD.TITLE_HEADING = TITLE_HEADING;
  HUD.TITLE_PROMPT = TITLE_PROMPT;
  HUD.VICTORY_HEADING = VICTORY_HEADING;
  HUD.VICTORY_PROMPT = VICTORY_PROMPT;
  HUD.DEAD_HEADING = DEAD_HEADING;
  HUD.DEAD_PROMPT = DEAD_PROMPT;
  HUD.CONTROLS = CONTROLS;

})();
