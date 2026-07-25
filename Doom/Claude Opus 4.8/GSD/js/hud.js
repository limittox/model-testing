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
 * WHAT THIS FILE OWNS (06-01 built the screens; 06-02 built the in-game overlay)
 * ============================================================================
 *   . THE THREE FULL-SCREEN STATE SCREENS — title, victory, death (06-01).
 *   . THE IN-GAME OVERLAY (06-02): the bottom status bar (health, armor, the ammo
 *     for the weapon in hand, the weapon name, the kill tally), the centre
 *     crosshair, the corner minimap, and the red damage flash.
 * The two are mutually exclusive by construction — HUD.render dispatches on
 * Game.state, so exactly one of them paints on any given frame (D-06).
 *
 * IT ADDS NO MESSAGE RENDERER (06-CONTEXT D-02, resolved). Game.renderMessage
 * stays registered in Raycaster.overlayPasses as the ONE AND ONLY renderer of the
 * event line. Adding a second one here is exactly the double-draw the decision
 * exists to prevent; tools/verify-state.cjs section 4 is the gate that keeps it
 * that way, and tools/verify-hud.cjs section 3 extends that gate to 06-02's
 * weapon-switch and out-of-ammo event messages.
 */

var HUD = {
  // The screen name drawn by the last HUD.render(), or null when it drew none (a
  // missing or degenerate overlay context, or an unknown state). Recorded rather
  // than inferred so a harness can ask what was painted without re-deriving the
  // state dispatch. Same discipline as Game.messageBox and Weapons.viewmodelBox.
  //
  // 06-02 NOTE: this now reads Game.STATES.PLAYING on a playing frame. In 06-01 it
  // was null there, because the playing branch deliberately drew nothing; that
  // branch now paints the in-game overlay, so recording null would be a lie.
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
    cy: 0,       // vertical centre — the crosshair's anchor (HUD-03)
    heading: 0,  // heading text size, px
    body: 0,     // body text size, px
    prompt: 0,   // prompt text size, px
    line: 0,     // baseline-to-baseline spacing for stacked lines, px

    // --- The in-game overlay (06-02). Same record, same rule: recomputed IN
    // PLACE from the LIVE canvas size every frame, never reallocated. ---
    inset: 0,    // the shared edge inset, px
    barX: 0,     // the status bar rectangle
    barY: 0,
    barW: 0,
    barH: 0,
    colW: 0,     // one readout column's width (barW / the readout count)
    label: 0,    // label text size, px
    value: 0,    // value text size, px
    labelY: 0,   // the label row's centre line inside the bar
    valueY: 0,   // the value row's centre line inside the bar
    mapBox: 0,   // the minimap box's side length, px
    mapX: 0,     // the minimap box's top-left corner on the hud canvas
    mapY: 0
  },

  // --- THE PREBUILT MINIMAP (HUD-05, 06-02) ---------------------------------
  // The STATIC level grid, painted ONCE into an offscreen canvas and composited
  // with a SINGLE drawImage per frame. Rebuilt by HUD.reset() (so a restarted,
  // reparsed level regenerates it) and on a real change of the derived box size —
  // never per frame. Null until the first build.
  minimapCanvas: null,
  minimapScale: 0,    // px per level cell (an INTEGER — no half-pixel cells)
  minimapGridX: 0,    // the grid's origin INSIDE the minimap canvas (centring)
  minimapGridY: 0,
  minimapBuilds: 0    // how many times the grid has been painted; a harness reads
                      // this to prove the prebuild is not happening every frame
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

  // The `label` and `value` entries are 06-02's additions — the status bar's two
  // text sizes. They are keyed on the SAME canvas height as the screen fonts, so
  // one height change rebuilds all five strings and nothing else ever does.
  var fonts = { h: -1, heading: '', body: '', prompt: '', label: '', value: '' };

  function updateFonts(h) {
    if (fonts.h === h) return;
    fonts.h = h;
    var family = CONFIG.SCREEN_FONT_FAMILY;
    fonts.heading = Math.round(CONFIG.SCREEN_HEADING_FRAC * h) + 'px ' + family;
    fonts.body = Math.round(CONFIG.SCREEN_BODY_FRAC * h) + 'px ' + family;
    fonts.prompt = Math.round(CONFIG.SCREEN_PROMPT_FRAC * h) + 'px ' + family;
    fonts.label = Math.round(CONFIG.HUD_LABEL_FRAC * h) + 'px ' + family;
    fonts.value = Math.round(CONFIG.HUD_VALUE_FRAC * h) + 'px ' + family;
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
  // ===========================================================================
  // THE IN-GAME OVERLAY (plan 06-02) — HUD-01, HUD-02, HUD-03, HUD-06.
  //
  // Five phases of simulation produce health, armor, ammo, a weapon and a kill
  // tally that the player cannot see. Everything below turns that state into
  // feedback, and it does so by READING THE LIVE OBJECTS the simulation mutates —
  // Combat and Game — with no HUD-local copy of any stat anywhere. A cached
  // readout is a readout that can go stale and lie (threat T-06-09); the only
  // things cached here are the derived STRINGS, keyed on the values they came
  // from, because the Canvas 2D text API takes strings and nothing else.
  // ===========================================================================
  // ===========================================================================

  // THE FIVE STATUS-BAR COLUMNS, LEFT TO RIGHT (D-03). Data, in layout order, so
  // "which readout is which" is one ordering in one place rather than five
  // hand-placed draw calls that can drift out of step with each other.
  var READOUT_LABELS = ['HEALTH', 'ARMOR', 'AMMO', 'WEAPON', 'KILLS'];
  var READOUTS = READOUT_LABELS.length;

  // Combat.weapon -> the display name. A TABLE, not a chain of comparisons: a
  // third weapon is a one-line data edit here and every readout picks it up.
  var WEAPON_NAMES = { pistol: 'PISTOL', shotgun: 'SHOTGUN' };

  // THE READOUT STRING CACHE — the third cache in this file, and it exists for
  // exactly the reason the other two do: `'' + health` allocates a string, and
  // doing that five times a frame is 300 strings a second of pure garbage. Keyed
  // on EVERY value it derives from, so any change to any stat rebuilds the row and
  // nothing else can.
  var bar = {
    health: -1, armor: -1, ammo: -1, weapon: '', kills: -1, total: -1,
    values: ['', '', '', '', '']
  };

  function updateReadouts(health, armor, ammo, weapon, kills, total) {
    if (bar.health === health && bar.armor === armor && bar.ammo === ammo &&
        bar.weapon === weapon && bar.kills === kills && bar.total === total) return;
    bar.health = health;
    bar.armor = armor;
    bar.ammo = ammo;
    bar.weapon = weapon;
    bar.kills = kills;
    bar.total = total;
    var v = bar.values;
    v[0] = '' + health;
    v[1] = '' + armor;
    v[2] = '' + ammo;
    // An unknown weapon still reads out as something rather than 'undefined'.
    v[3] = WEAPON_NAMES[weapon] || String(weapon).toUpperCase();
    v[4] = kills + ' / ' + total;
  }

  // THE AMMO READOUT RESOLVES ITS FIELD THROUGH Weapons.TABLE (HUD-01, threat
  // T-06-09). The table entry for the weapon in hand names the Combat.ammo field
  // that FIRING ACTUALLY SPENDS, so the number on the bar and the number the
  // trigger decrements are the same number by construction — there is no second
  // opinion about which weapon uses which ammo, and switching weapons moves the
  // readout for free. A chain of `if (weapon === 'shotgun')` comparisons here is
  // exactly how a HUD ends up showing bullets while a shotgun eats shells.
  function ammoInHand() {
    var table = (typeof Weapons !== 'undefined' && Weapons) ? Weapons.TABLE : null;
    var entry = table ? table[Combat.weapon] : null;
    if (!entry) return 0;
    var n = Combat.ammo ? Combat.ammo[entry.ammo] : 0;
    return (typeof n === 'number' && isFinite(n)) ? n : 0;
  }
  HUD.ammoInHand = ammoInHand;

  // ---------------------------------------------------------------------------
  // THE STATUS BAR (HUD-01 / HUD-02) — a translucent backing rectangle and five
  // labelled columns across it.
  //
  // EACH COLUMN DRAWS ITS LABEL AND THEN ITS VALUE, in that order, and that
  // ordering is part of the contract: it makes the recorded call sequence
  // self-describing (label, value, label, value, ...), so a harness can PAIR each
  // value with the label above it instead of guessing which number is which.
  // ---------------------------------------------------------------------------
  function drawStatusBar(ctx, m) {
    ctx.globalAlpha = CONFIG.HUD_BAR_ALPHA;
    ctx.fillStyle = CONFIG.HUD_BAR_COLOR;
    ctx.fillRect(m.barX, m.barY, m.barW, m.barH);
    ctx.globalAlpha = 1;

    var health = Combat.health;
    updateReadouts(health, Combat.armor, ammoInHand(), Combat.weapon,
      Game.kills, Game.totalKills);

    // ONE COMPARISON, not a gradient (see CONFIG.HUD_WARN_FRAC).
    var warn = (Combat.maxHealth > 0) &&
      (health < CONFIG.HUD_WARN_FRAC * Combat.maxHealth);

    for (var i = 0; i < READOUTS; i++) {
      var cx = m.barX + m.colW * (i + 0.5);
      ctx.font = fonts.label;
      ctx.fillStyle = CONFIG.HUD_LABEL_COLOR;
      ctx.fillText(READOUT_LABELS[i], cx, m.labelY);
      ctx.font = fonts.value;
      ctx.fillStyle = (i === 0 && warn) ? CONFIG.HUD_WARN_COLOR : CONFIG.HUD_VALUE_COLOR;
      ctx.fillText(bar.values[i], cx, m.valueY);
    }
  }

  // ---------------------------------------------------------------------------
  // THE CROSSHAIR (HUD-03) — two rectangles derived from the LIVE canvas midpoint,
  // so it recentres on a resize for free rather than needing a resize hook.
  //
  // The horizontal arm spans [cx - arm, cx + arm] and the vertical arm spans
  // [cy - arm, cy + arm], so the drawn extent is symmetric about the midpoint by
  // construction — not by arithmetic that happens to come out even. The darker
  // one-pixel-larger cross underneath is the same trick the message line's drop
  // shadow uses: it keeps the aim point visible against a brightly lit wall
  // without a second asset or any partial alpha.
  // ---------------------------------------------------------------------------
  function drawCrosshair(ctx, m) {
    var arm = Math.round(CONFIG.HUD_CROSSHAIR_ARM_FRAC * m.h);
    if (arm < 2) arm = 2;
    var th = Math.round(CONFIG.HUD_CROSSHAIR_THICK_FRAC * m.h);
    if (th < 1) th = 1;
    var half = th >> 1;
    var cx = Math.round(m.cx);
    var cy = Math.round(m.cy);

    ctx.fillStyle = CONFIG.HUD_CROSSHAIR_OUTLINE_COLOR;
    ctx.fillRect(cx - arm - 1, cy - half - 1, 2 * arm + 2, th + 2);
    ctx.fillRect(cx - half - 1, cy - arm - 1, th + 2, 2 * arm + 2);

    ctx.fillStyle = CONFIG.HUD_CROSSHAIR_COLOR;
    ctx.fillRect(cx - arm, cy - half, 2 * arm, th);
    ctx.fillRect(cx - half, cy - arm, th, 2 * arm);
  }

  // ---------------------------------------------------------------------------
  // THE DAMAGE FLASH (HUD-06) — the current alpha of the red wash, or 0.
  //
  // BOTH OPERANDS ARE SIMULATION TIME. Combat.lastDamageAt is stamped from
  // Game.time inside Combat.damagePlayer, and Game.time is accumulated inside
  // Game.step — so the flash freezes with the sim on an end screen, ages under a
  // direct Game.step(dt) in a harness, and is measurable headlessly. A wall-clock
  // flash would decay behind the victory screen and could not be proved at all.
  //
  // EVERY DEGENERATE CASE FAILS TO "NO FLASH", never to a stuck full-alpha wash
  // the player has to look through for the rest of the run: the never-damaged
  // sentinel (-1) and NaN are both rejected by `!(at >= 0)`, a negative age (a
  // stamp in the future of a clock that went backwards) by `!(age >= 0)`.
  // ---------------------------------------------------------------------------
  function flashAlpha() {
    var life = CONFIG.DAMAGE_FLASH_TIME;
    if (!(life > 0)) return 0;
    var at = (typeof Combat !== 'undefined') ? Combat.lastDamageAt : -1;
    if (!(at >= 0)) return 0;
    var now = (typeof Game !== 'undefined') ? Game.time : 0;
    var age = now - at;
    if (!(age >= 0) || age >= life) return 0;
    var a = CONFIG.DAMAGE_FLASH_ALPHA * (1 - age / life);
    return (a > 0) ? a : 0;
  }
  HUD.flashAlpha = flashAlpha;

  function drawDamageFlash(ctx, m) {
    var a = flashAlpha();
    if (!(a > 0)) return false;
    ctx.globalAlpha = a;
    ctx.fillStyle = CONFIG.DAMAGE_FLASH_COLOR;
    ctx.fillRect(0, 0, m.w, m.h);
    // RESTORED IMMEDIATELY — the context is shared with everything else drawn
    // here, and a leaked alpha would tint the whole bar for the rest of the frame.
    ctx.globalAlpha = 1;
    return true;
  }

  // ===========================================================================
  // THE MINIMAP (HUD-05, 06-CONTEXT D-04).
  //
  // THE STATIC GRID IS PREBUILT ONCE (threat T-06-10). A 24x24 level is 576 cells;
  // painting them cell by cell every frame is 34,560 fillRects a second for a
  // picture that only changes when the LEVEL does. So the grid is painted once into
  // an offscreen canvas and the frame path composites it with ONE drawImage — the
  // per-frame cost is a constant plus one dot per live entity, and it does not
  // scale with the cell count at all.
  //
  // IT IS REBUILT EXACTLY WHEN IT IS STALE, and never otherwise:
  //   . HUD.reset() — called at boot and by Game.restart() AFTER Level.build() has
  //     reparsed the map, which is precisely when a derived picture of the map is
  //     out of date;
  //   . a real change of the derived box size (a window resize), tested with one
  //     integer comparison at the top of the per-frame draw.
  // ===========================================================================

  // The box's side length for a given hud canvas height. Floored to a minimum so a
  // degenerate viewport yields a tiny map rather than a zero-sized canvas.
  function mapBoxSize(h) {
    var box = Math.round(CONFIG.MINIMAP_BOX_FRAC * h);
    return (box > 8) ? box : 8;
  }

  function hudHeight() {
    var c = (typeof Framebuffer !== 'undefined') ? Framebuffer.hudCanvas : null;
    return (c && c.height > 0) ? c.height : 0;
  }

  HUD.buildMinimap = function () {
    if (typeof document === 'undefined' || !document.createElement) return null;
    if (typeof Level === 'undefined' || !Level.cells) return null;
    var W = Level.WIDTH, H = Level.HEIGHT;
    if (!(W > 0) || !(H > 0)) return null;

    var box = mapBoxSize(hudHeight());
    // An INTEGER cell size, from the LARGER of the two level dimensions, so a
    // non-square level is scaled uniformly (never stretched to fill the box) and no
    // cell lands on a half pixel.
    var scale = Math.floor(box / (W > H ? W : H));
    if (scale < 1) scale = 1;
    var gridW = scale * W;
    var gridH = scale * H;
    var gx = Math.floor((box - gridW) * 0.5);
    var gy = Math.floor((box - gridH) * 0.5);

    var canvas = document.createElement('canvas');
    canvas.width = box;
    canvas.height = box;
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.globalAlpha = CONFIG.MINIMAP_BG_ALPHA;
    ctx.fillStyle = CONFIG.MINIMAP_BG_COLOR;
    ctx.fillRect(0, 0, box, box);
    ctx.globalAlpha = 1;

    // ONE FILLED RECTANGLE PER CELL, coloured by Level.isSolid — the SAME predicate
    // the collision resolver and the raycaster ask, so the drawn map is the map the
    // player is actually walking around in and cannot drift from it.
    for (var my = 0; my < H; my++) {
      for (var mx = 0; mx < W; mx++) {
        ctx.fillStyle = Level.isSolid(mx, my)
          ? CONFIG.MINIMAP_SOLID_COLOR : CONFIG.MINIMAP_FLOOR_COLOR;
        ctx.fillRect(gx + mx * scale, gy + my * scale, scale, scale);
      }
    }

    ctx.strokeStyle = CONFIG.MINIMAP_BORDER_COLOR;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, box - 1, box - 1);

    HUD.minimapCanvas = canvas;
    HUD.minimapScale = scale;
    HUD.minimapGridX = gx;
    HUD.minimapGridY = gy;
    HUD.minimapBuilds += 1;
    return canvas;
  };

  function updateMapMetrics(m, w, h) {
    var inset = Math.round(CONFIG.MINIMAP_INSET_FRAC * h);
    m.mapBox = mapBoxSize(h);
    m.mapX = inset;
    m.mapY = inset;
  }

  // THE ONE WORLD-TO-BOX PROJECTION (threat T-06-12). Every plotted point — the
  // player, every enemy, every pickup, the exit and the facing tick — goes through
  // these two functions, which use the SAME scale and origin the grid was painted
  // with. Two projections would be two chances for the dots and the walls to
  // disagree about where a corridor is.
  //
  // The clamp is written `!(v > lo)` so a NaN coordinate lands on the box edge
  // rather than escaping it: nothing this function returns can be outside the box.
  function mapPX(m, wx) {
    var v = m.mapX + HUD.minimapGridX + wx * HUD.minimapScale;
    var hi = m.mapX + m.mapBox;
    if (!(v > m.mapX)) return m.mapX;
    return (v < hi) ? v : hi;
  }

  function mapPY(m, wy) {
    var v = m.mapY + HUD.minimapGridY + wy * HUD.minimapScale;
    var hi = m.mapY + m.mapBox;
    if (!(v > m.mapY)) return m.mapY;
    return (v < hi) ? v : hi;
  }

  // A square marker CENTRED on a world position and clamped so the WHOLE rectangle
  // stays inside the box (clamping the centre alone would leave half a dot hanging
  // over the border).
  function marker(ctx, m, wx, wy, d, color) {
    var x = mapPX(m, wx) - d * 0.5;
    var y = mapPY(m, wy) - d * 0.5;
    var maxX = m.mapX + m.mapBox - d;
    var maxY = m.mapY + m.mapBox - d;
    if (!(x > m.mapX)) x = m.mapX; else if (x > maxX) x = maxX;
    if (!(y > m.mapY)) y = m.mapY; else if (y > maxY) y = maxY;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, d, d);
  }

  // ---------------------------------------------------------------------------
  // THE PER-FRAME COMPOSITE: one drawImage, then only the things that move.
  //
  // ALLOCATES NOTHING. The entity lists are walked BY INDEX — no filter, no map, no
  // closure — and every number is a local. The dots read the SAME flags the render
  // passes read (`alive`/`state` for enemies, `active` for pickups), so a killed
  // enemy and a collected item leave the map at the same instant they leave the
  // world rather than through a second, separately-maintained list.
  // ---------------------------------------------------------------------------
  function drawMinimap(ctx, m) {
    // REBUILD ONLY ON A REAL CHANGE — one integer comparison, not a rebuild.
    var canvas = HUD.minimapCanvas;
    if (!canvas || canvas.width !== m.mapBox) canvas = HUD.buildMinimap();
    if (!canvas) return false;

    ctx.drawImage(canvas, m.mapX, m.mapY);

    var box = m.mapBox;
    var d = Math.round(CONFIG.MINIMAP_DOT_FRAC * box);
    if (d < 2) d = 2;
    var pd = Math.round(CONFIG.MINIMAP_PLAYER_DOT_FRAC * box);
    if (pd < 3) pd = 3;

    // THE EXIT FIRST, and underneath everything else: it never moves, and the map's
    // whole job is answering "where do I go" as well as "where am I".
    var exit = (typeof Level !== 'undefined') ? Level.exit : null;
    if (exit) marker(ctx, m, exit.x, exit.y, d, CONFIG.MINIMAP_EXIT_COLOR);

    if (typeof Pickups !== 'undefined' && Pickups.list) {
      var pl = Pickups.list;
      for (var i = 0; i < pl.length; i++) {
        if (pl[i].active !== true) continue;
        marker(ctx, m, pl[i].x, pl[i].y, d, CONFIG.MINIMAP_PICKUP_COLOR);
      }
    }

    if (typeof Enemies !== 'undefined' && Enemies.list) {
      var el = Enemies.list;
      for (var j = 0; j < el.length; j++) {
        var e = el[j];
        // A CORPSE IS NOT A THREAT and is deliberately not plotted: the map exists
        // to show what is still coming for you.
        if (e.alive !== true || e.state === Enemies.CORPSE) continue;
        marker(ctx, m, e.x, e.y, d, CONFIG.MINIMAP_ENEMY_COLOR);
      }
    }

    // THE PLAYER LAST, so nothing can be drawn over the one marker that matters
    // most, with a facing tick along the pose's direction vector.
    if (typeof Player !== 'undefined') {
      var tick = CONFIG.MINIMAP_FACING_FRAC * box;
      var cx = mapPX(m, Player.x);
      var cy = mapPY(m, Player.y);
      ctx.strokeStyle = CONFIG.MINIMAP_PLAYER_COLOR;
      ctx.lineWidth = (d > 2) ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      // The endpoint goes through the SAME clamp as every other plotted point, so a
      // player standing in a corner cannot draw a tick out over the status bar.
      ctx.lineTo(mapPX(m, Player.x + Player.dirX * tick / HUD.minimapScale),
        mapPY(m, Player.y + Player.dirY * tick / HUD.minimapScale));
      ctx.stroke();
      marker(ctx, m, Player.x, Player.y, pd, CONFIG.MINIMAP_PLAYER_COLOR);
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // RENDER THE PLAYING OVERLAY. Called by HUD.render in the playing state.
  //
  // ORDER IS DELIBERATE: the damage flash goes down FIRST, so the readouts and the
  // crosshair sit ON TOP of it — the one moment a player most needs to read their
  // health is the moment the screen has just gone red.
  //
  // ALLOCATES NOTHING. No array, no object, no closure: the labels and the weapon
  // names are module-scope data, the values come out of the keyed cache above, and
  // the geometry is recomputed in place into the one METRICS record.
  // ---------------------------------------------------------------------------
  HUD.renderPlaying = function (ctx, m) {
    if (!ctx) ctx = (typeof Framebuffer !== 'undefined') ? Framebuffer.hudCtx : null;
    if (!ctx) return false;
    if (!m) m = HUD.METRICS;

    drawDamageFlash(ctx, m);
    drawMinimap(ctx, m);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    drawStatusBar(ctx, m);
    drawCrosshair(ctx, m);
    return true;
  };

  // ===========================================================================
  // THE LAYOUT — every field of the ONE metrics record, recomputed IN PLACE from
  // the LIVE canvas size. Called once per frame, before the state dispatch, so the
  // screens and the in-game overlay are laid out on the same grid and a window
  // resize is picked up by both without a resize handler anywhere.
  // ===========================================================================
  function updateMetrics(w, h) {
    var m = HUD.METRICS;
    m.w = w;
    m.h = h;
    m.cx = w * 0.5;
    m.cy = h * 0.5;

    m.heading = Math.round(CONFIG.SCREEN_HEADING_FRAC * h);
    m.body = Math.round(CONFIG.SCREEN_BODY_FRAC * h);
    m.prompt = Math.round(CONFIG.SCREEN_PROMPT_FRAC * h);
    m.line = Math.round(CONFIG.SCREEN_LINE_FRAC * h);

    var inset = Math.round(CONFIG.HUD_BAR_INSET_FRAC * h);
    m.inset = inset;
    m.barH = Math.round(CONFIG.HUD_BAR_HEIGHT_FRAC * h);
    if (m.barH < 1) m.barH = 1;
    m.barX = inset;
    m.barW = w - inset * 2;
    if (m.barW < 1) m.barW = 1;
    m.barY = h - inset - m.barH;
    if (m.barY < 0) m.barY = 0;
    m.colW = m.barW / READOUTS;
    m.label = Math.round(CONFIG.HUD_LABEL_FRAC * h);
    m.value = Math.round(CONFIG.HUD_VALUE_FRAC * h);
    // The two text rows sit at fixed fractions of the bar's own height, so they
    // stay inside it at every window size.
    m.labelY = m.barY + m.barH * 0.30;
    m.valueY = m.barY + m.barH * 0.70;

    updateMapMetrics(m, w, h);
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

    // THE LAYOUT IS COMPUTED ONCE, BEFORE THE DISPATCH, for every state — so the
    // screens and the in-game overlay are laid out on the same grid from the same
    // live canvas size, and neither can be looking at stale geometry after a
    // resize.
    var m = HUD.METRICS;
    updateMetrics(w, h);
    updateFonts(h);

    // THE PLAYING STATE (06-02): the status bar, the crosshair, the minimap and the
    // damage flash — and DELIBERATELY NO SCRIM and no message text. The scrim's job
    // is to push the frozen world back behind a menu; while playing, the world IS
    // the thing being looked at.
    if (state === S.PLAYING) {
      HUD.renderPlaying(ctx, m);
      HUD.screen = S.PLAYING;
      return true;
    }

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

    // The readout cache is invalidated the same way and for the same reason: the
    // next playing frame must rebuild its row from the LIVE stats rather than
    // trusting strings derived from the run that just ended.
    bar.health = -1;
    bar.armor = -1;
    bar.ammo = -1;
    bar.weapon = '';
    bar.kills = -1;
    bar.total = -1;
    for (var i = 0; i < bar.values.length; i++) bar.values[i] = '';

    // THE MINIMAP PREBUILD HANGS HERE (HUD-05). Game.restart() calls Level.build()
    // — which reassigns Level.cells and re-derives Level.exit — and then calls this,
    // so the one moment a picture derived from the map goes stale is the one moment
    // it is regenerated. Painting 576 cells is a boot/restart cost, never a frame
    // cost.
    HUD.buildMinimap();

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
  // 06-02's data, exposed for the same reason: a harness asserts against the exact
  // labels and display names rather than re-typing them, so a rename cannot leave a
  // stale expectation passing.
  HUD.READOUT_LABELS = READOUT_LABELS;
  HUD.WEAPON_NAMES = WEAPON_NAMES;

})();
