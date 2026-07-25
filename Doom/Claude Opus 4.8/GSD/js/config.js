/*
 * config.js — global tuning constants + shared helpers.
 *
 * LOAD ORDER: this file is loaded FIRST (see index.html). It defines the
 * `CONFIG` namespace and the global helpers `packRGBA` / `mulberry32` that
 * framebuffer.js and main.js (and later Plan 02 asset code) consume. Nothing
 * here depends on any other project file.
 *
 * PACKED COLOR CONTRACT: target platforms are little-endian, so the RGBA byte
 * sequence [r,g,b,a] read back as a Uint32 is (a<<24)|(b<<16)|(g<<8)|r. Every
 * color is precomputed in this packed form so the render inner loops are a
 * single Uint32 store.
 */

// Pack an [r,g,b,a] color into a little-endian Uint32. Alpha defaults to opaque.
// `>>> 0` forces an unsigned 32-bit result (JS bitwise ops are signed 32-bit).
function packRGBA(r, g, b, a) {
  if (a === undefined) a = 255;
  return (((a << 24) | (b << 16) | (g << 8) | r) >>> 0);
}

// mulberry32 — a tiny, fast, seeded PRNG. Returns a closure producing floats in
// [0, 1). Deterministic per seed so procedural art (Plan 02) is stable across
// loads. Consumed by the asset generators; defined here so the seed contract
// exists from day one.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The single global namespace object later files read from.
var CONFIG = {
  // --- Internal render resolution ---
  // Fixed low width; height is DERIVED from the viewport aspect and clamped to
  // [MIN_H, MAX_H] by Framebuffer.resize(). Keeping width fixed makes per-frame
  // cost independent of window size.
  //
  // The band MUST be wide enough that every realistic window aspect passes
  // through UNCLAMPED — a clamp that bites changes the rendered aspect and
  // stretches the world anamorphically (Phase 1 verification W-1). Derived
  // heights at 480 wide: 21:9 -> 206, 16:9 -> 270, 16:10 -> 300, 4:3 -> 360.
  // The band below covers all of them; it now only bites on degenerate
  // (extremely tall/short) windows, where bounding cost matters more than
  // aspect fidelity. Widened from [240,300], which stretched 4:3 by 20%.
  INTERNAL_W: 480,
  MIN_H: 200,
  MAX_H: 480,

  // --- Camera / renderer tuning (consumed by later phases) ---
  // FOV_PLANE: camera-plane half-length; ~0.66 gives the classic ~66deg FOV.
  FOV_PLANE: 0.66,
  // DT_MAX: the delta-time CLAMP (seconds). Every frame's dt is min(raw, DT_MAX),
  // so one frame — even after a multi-second tab-refocus or GC pause — can move
  // the player at most WALK_SPEED*RUN_MULT*DT_MAX cells. That derived budget must
  // stay well under one cell so tunneling through a one-cell wall is impossible
  // (D-05). This is the SINGLE source of the per-frame step bound; game.js applies
  // it and player.js reads it via maxStepPerFrame() — never duplicated.
  DT_MAX: 0.05,
  // TEX_SIZE: 64, a power of two so the renderer masks texel coords with `& 63`.
  TEX_SIZE: 64,
  // SEED: integer feeding mulberry32 for deterministic procedural generation.
  SEED: 1337,

  // --- Colors (packed via packRGBA to exercise the packed-color contract) ---
  // A distinct dark, non-black slate so a successful clear is unambiguous.
  CLEAR_COLOR: packRGBA(24, 26, 34),
  // Flat-fill fallbacks for the floor/ceiling pass before textured casting
  // lands (Phase 3): ceiling a dim blue-grey, floor a warmer brown-grey.
  CEIL_COLOR: packRGBA(48, 52, 66),
  FLOOR_COLOR: packRGBA(58, 50, 42),

  // --- Renderer constants (Phase 3 — consumed by the Raycaster view) ---
  // FLOOR_CAST: textured floor/ceiling casting ON. When false, the 03-03 fallback
  // fills floor/ceiling with distance-shaded FLAT colours — a real, correct path,
  // not dead code. This tracer only flat-fills (Pass A two-tone); the flag is
  // wired now so 03-03 is a functionality fill, not an architecture change.
  FLOOR_CAST: true,
  // CAMERA_Z: camera height as a fraction of wall height. LOAD-BEARING (not
  // arbitrary): 0.5 places the eye at wall mid-height so the row-cast floor
  // (03-03) aligns exactly to the wall base. posZ = CAMERA_Z * H.
  CAMERA_Z: 0.5,
  // FOG_FAR / MIN_SHADE / SIDE_SHADE: AESTHETIC TUNABLES — starting points from the
  // classic Doom/Wolfenstein look, not derived from a spec. They need ONE in-browser
  // tuning pass (does the far distance read, are silhouettes still visible). The
  // shape (linear falloff to a brightness floor + a constant y-side darken) is the
  // standard and is safe; only the numbers are eyeballed.
  FOG_FAR: 14.0,     // world distance (cells) at which shading reaches MIN_SHADE
  MIN_SHADE: 0.28,   // brightness floor — keep silhouettes readable
  SIDE_SHADE: 0.70,  // constant multiplier for side==1 (y-side) walls — depth cue
  // FOG_COLOR: the ambient the far distance fades toward (matches CLEAR_COLOR).
  FOG_COLOR: packRGBA(24, 26, 34),

  // ===========================================================================
  // PHASE 5 — ENEMY AI, PROJECTILES AND PLAYER COMBAT STATE (05-CONTEXT D-11:
  // ALL tuning numbers live here; js/enemies.js and js/combat.js contain no
  // magic numbers).
  // ===========================================================================

  // --- Enemy body + movement ---
  // ENEMY_RADIUS: collision radius in cells, fed to the SHARED per-axis slide
  // (Player.slideMove). 0.35 gives a 0.70-cell footprint, which fits a one-cell
  // corridor with 0.30 cells of total slack — that tightness is exactly why the
  // chase steer needs the corner recovery below.
  ENEMY_RADIUS: 0.35,
  // ENEMY_SPEED: cells per second. DERIVED PER-FRAME STEP at the delta clamp:
  // ENEMY_SPEED * DT_MAX = 1.6 * 0.05 = 0.08 cells. That MUST stay well under
  // one cell, for exactly the reason Player.maxStepPerFrame() documents: the
  // slide tests the LEADING EDGE of the destination, so tunneling a one-cell
  // wall requires a single-frame step of at least one whole cell.
  ENEMY_SPEED: 1.6,
  ENEMY_HEALTH: 40,           // hit points; Enemies.hurt subtracts from this

  // --- Enemy senses + attack timing (seconds / cells) ---
  ENEMY_SIGHT_RANGE: 12.0,    // idle -> chase needs BOTH range AND clear LOS
  ENEMY_ATTACK_RANGE: 8.0,    // chase -> attack needs LOS + this range + cooldown
  ENEMY_STOP_RANGE: 2.0,      // stop closing at this distance (never body-blocks)
  ENEMY_ATTACK_COOLDOWN: 1.6, // seconds between attack ENTRIES — one fireball per
  ENEMY_ATTACK_WINDUP: 0.35,  // telegraph before the projectile leaves the hand
  ENEMY_WALK_FRAME_TIME: 0.22,// seconds per walk frame (two-frame walk cycle)

  // --- Enemy damage response (ENEM-04, 05-03 — D-02 + D-06) ---------------
  // ENEMY_PAIN_CHANCE: the probability that a NON-LETHAL hit staggers the enemy
  // into the pain state. Read LIVE by Enemies.hurt on every hit (never captured
  // at load), which is what lets the harness force it to 0 and to 1 as paired
  // falsifiability controls: 0 must produce no pain at all and 1 must produce
  // pain on every non-lethal hit. The roll is drawn from Enemies.rand(), so a
  // chance of 0 cannot pass by luck of the stream and a chance of 1 cannot fail.
  ENEMY_PAIN_CHANCE: 0.3,
  // ENEMY_PAIN_TIME: seconds the stagger holds the pain frame. Deliberately
  // SHORTER than ENEMY_ATTACK_COOLDOWN (1.6): pain must interrupt an attack in
  // progress without ever handing the enemy a free extra shot, which is why the
  // stagger zeroes the WINDUP and leaves the COOLDOWN untouched.
  ENEMY_PAIN_TIME: 0.25,
  // ENEMY_DEATH_FRAME_TIME: seconds each of the three death frames is held. The
  // whole fall therefore takes 3 * this = 0.42 s before the terminal corpse
  // state latches. The frame index advances MONOTONICALLY and the corpse is
  // terminal, so the animation plays exactly once and cannot loop (T-05-18).
  ENEMY_DEATH_FRAME_TIME: 0.14,
  // ENEMY_HURT_SEED_SALT: the distinct salt added to CONFIG.SEED for the pain
  // roll stream, so the stagger pattern is deterministic and reproducible
  // headlessly and cannot correlate with the procedural-art streams or with
  // CONFIG.WEAPON_SEED_SALT's pellet scatter.
  ENEMY_HURT_SEED_SALT: 4243,

  // --- Corner recovery (the bounded wall-follow) ---
  // A chasing enemy that presses into a wall face or a concave corner makes no
  // progress: the direct steer keeps pushing into geometry forever. These two
  // constants bound the recovery.
  //
  // ENEMY_STUCK_EPSILON is a DIMENSIONLESS FRACTION OF THE REQUESTED STEP, not
  // an absolute cell distance. The predicate is written literally as
  //     travelled < CONFIG.ENEMY_STUCK_EPSILON * requested
  // where `requested` is ENEMY_SPEED * dt. Read as an absolute distance it would
  // flag EVERY enemy as stuck (a 60 fps request is only ~0.027 cells).
  ENEMY_STUCK_EPSILON: 0.2,
  // ENEMY_UNSTICK_TIME: seconds the concave-corner wall-follow is latched for.
  // Latching (rather than re-deciding every frame) is what keeps the escape
  // stable and reproducible headlessly instead of dithering on the corner.
  ENEMY_UNSTICK_TIME: 0.5,

  // --- Enemy projectile (the fireball) ---
  // PROJ_SPEED derived per-frame step at the clamp: 5.0 * 0.05 = 0.25 cells —
  // again well under one cell, so a projectile can never skip over a one-cell
  // wall between two solidity tests (threat T-05-05).
  PROJ_SPEED: 5.0,
  PROJ_DAMAGE: 12,            // raw damage BEFORE the armor absorption formula
  PROJ_HIT_RADIUS: 0.35,      // cells; distance to the player that counts as a hit
  PROJ_POOL: 24,              // preallocated projectile entities — never grown
  PROJ_SCALE: 0.30,           // billboard scale (small, bright orb)

  // --- Player combat state (D-04) ---
  PLAYER_MAX_HEALTH: 100,
  PLAYER_MAX_ARMOR: 100,
  PLAYER_START_HEALTH: 100,
  PLAYER_START_ARMOR: 0,
  PLAYER_START_BULLETS: 50,
  PLAYER_START_SHELLS: 0,
  // ARMOR_ABSORB_DIVISOR: the Doom green-armor fraction. The LOCKED formula is
  //   absorbed = min(armor, floor(dmg / ARMOR_ABSORB_DIVISOR))
  ARMOR_ABSORB_DIVISOR: 3,

  // ===========================================================================
  // PHASE 5 — HITSCAN WEAPONS AND THE VIEWMODEL (05-CONTEXT D-05 + D-11: ALL
  // tuning numbers live here; js/weapons.js contains no magic numbers).
  // ===========================================================================

  // --- Pistol: one accurate ray per bullet ---------------------------------
  PISTOL_DAMAGE: 15,          // per ray; CONFIG.ENEMY_HEALTH 40 => 3 shots to kill
  PISTOL_COOLDOWN: 0.35,      // seconds between shots — ~2.8 rounds per second
  // A DELIBERATELY TINY spread, not zero. It runs the pistol down the SAME
  // spread-and-cast code path as the shotgun (one implementation, not two) while
  // staying far inside HITSCAN_TARGET_RADIUS at every usable range: at 20 cells
  // the worst-case offset is 20*sin(0.01) = 0.20 cells, still under the 0.35
  // target radius, so the pistol remains an accurate weapon.
  PISTOL_SPREAD: 0.01,        // radians, plus or minus
  PISTOL_AMMO: 'bullets',     // the Combat.ammo field this weapon spends

  // --- Shotgun: a cone of pellets per shell -------------------------------
  SHOTGUN_DAMAGE: 7,          // PER PELLET — a full 7-pellet hit is 49
  SHOTGUN_PELLETS: 7,
  SHOTGUN_COOLDOWN: 0.8,      // seconds — deliberately slower than the pistol
  // At 5 cells the worst-case pellet offset is 5*sin(0.08) = 0.40 cells, just
  // outside HITSCAN_TARGET_RADIUS — which is the point: the shotgun is lethal
  // point-blank and leaks pellets at range.
  SHOTGUN_SPREAD: 0.08,       // radians, plus or minus
  SHOTGUN_AMMO: 'shells',

  // --- Shared hitscan resolution (D-05) -----------------------------------
  // HITSCAN_RANGE: the maximum along-ray distance a target may sit at, and the
  // value Weapons.wallDistance returns when no solid cell is found inside it.
  // NOTE: this deliberately EXCEEDS the longest clear line in the shipped 24x24
  // level (~21 cells), so in practice the DDA wall stop — never the range — is
  // what bounds a shot. The constant exists so a bigger future level cannot make
  // the target scan unbounded.
  HITSCAN_RANGE: 24.0,
  // HITSCAN_TARGET_RADIUS: how far the enemy CENTRE may sit from the aim ray, as
  // a PERPENDICULAR distance in cells. Matches CONFIG.ENEMY_RADIUS so the
  // hittable silhouette is the enemy's actual body, not a generous halo.
  HITSCAN_TARGET_RADIUS: 0.35,

  // --- Viewmodel presentation (WEAP-04) -----------------------------------
  MUZZLE_FLASH_TIME: 0.06,    // seconds the flash overlay is composited for
  RECOIL_TIME: 0.12,          // seconds for the kick to ease back to rest
  RECOIL_PIXELS: 6,           // peak downward kick, in INTERNAL framebuffer pixels
  BOB_FREQ: 9.0,              // bob phase radians per cell travelled per second
  BOB_AMP_PIXELS: 4,          // bob amplitude at FULL speed, in internal pixels
  // VIEWMODEL_HEIGHT_FRAC: drawn height as a fraction of Framebuffer.height. The
  // width is derived from the source aspect, so the viewmodel never stretches on
  // a widescreen viewport.
  VIEWMODEL_HEIGHT_FRAC: 0.42,
  // The muzzle flash is sized and anchored RELATIVE to the drawn weapon box, so
  // it tracks the bob and the recoil for free: its side length is this fraction
  // of the weapon's drawn height, and its centre sits this fraction of that
  // height below the weapon's top edge (i.e. at the muzzle).
  MUZZLE_FLASH_SCALE: 0.55,
  MUZZLE_FLASH_ANCHOR_Y: 0.08,

  // WEAPON_SEED_SALT: the distinct salt added to CONFIG.SEED for the weapon
  // spread stream, so pellet scatter is deterministic and reproducible headlessly
  // and cannot correlate with any procedural-art stream.
  WEAPON_SEED_SALT: 7331,

  // ===========================================================================
  // PHASE 5 — PICKUPS AND THE MESSAGE EVENT (05-CONTEXT D-07 + D-11: ALL tuning
  // numbers live here; js/pickups.js contains no magic numbers).
  // ===========================================================================

  // COLLECT_RADIUS: how near the player's CENTRE must come to a pickup's centre
  // for it to be collected, in cells. Compared SQUARED on both sides inside the
  // scan (no square root in the per-frame loop). 0.5 is half a cell: the player
  // has to actually walk over the item, not merely into its cell corner.
  //
  // DERIVED SAFETY: the player's largest single-frame step is
  // WALK_SPEED * RUN_MULT * DT_MAX. That must stay comfortably under
  // 2 * COLLECT_RADIUS or a running player could straddle a pickup between two
  // frames and never register a contact — the same "test the step, not just the
  // endpoint" hazard the projectile radius documents.
  COLLECT_RADIUS: 0.5,

  // --- Per-item effects (D-07). Every clamp lives in the Combat grant methods,
  // never in the pickup, so no caller can push a field past its maximum.
  HEALTH_PICKUP: 25,          // health restored, clamped to PLAYER_MAX_HEALTH
  ARMOR_PICKUP: 50,           // armor granted, clamped to PLAYER_MAX_ARMOR
  AMMO_PICKUP: 20,            // bullets added by an ammo box
  SHOTGUN_PICKUP_SHELLS: 8,   // shells that come WITH the shotgun grant

  // --- The message EVENT (the Phase 5 half of PICK-05) ---------------------
  // MESSAGE_TIME: seconds a posted message stays visible before it expires. Ages
  // are measured against Game.time (SIMULATION time, accumulated inside
  // Game.step), so a message ages under both the rAF loop and a direct step.
  MESSAGE_TIME: 2.5,
  // MESSAGE_MAX: the size of the PREALLOCATED message ring. The ring cannot grow
  // and nothing is allocated per message, so a player standing on a pile of
  // pickups cannot make the queue unbounded (threat T-05-26).
  MESSAGE_MAX: 4,

  // --- The minimal in-framebuffer message LINE ------------------------------
  // The 05-CONTEXT domain block defers the HUD to Phase 6 and allows exactly one
  // exception: a minimal message line, so PICK-05 is observable now. These are its
  // only tunables.
  //
  // MESSAGE_SCALE_DIV: the integer glyph scale is floor(Framebuffer.height /
  // this), so the line stays legible at every internal resolution instead of
  // shrinking to one pixel per glyph row on a tall viewport. It is then CLAMPED
  // DOWN so the whole line fits the frame width — the clamp is structural, not a
  // consequence of the tuning, so no message length can overflow horizontally.
  MESSAGE_SCALE_DIV: 90,
  // MESSAGE_Y_FRAC: the top of the line, as a fraction of Framebuffer.height.
  // Inside the LOWER THIRD (> 2/3) at every height in the [MIN_H, MAX_H] band, and
  // deliberately over the weapon viewmodel — the message pass runs AFTER the
  // viewmodel in Raycaster.overlayPasses precisely so text lands on top of the gun.
  MESSAGE_Y_FRAC: 0.72,
  // MESSAGE_FADE_FRAC: the fraction of MESSAGE_TIME spent fading. The line holds
  // full brightness for the first (1 - this) of its life, then ramps down.
  MESSAGE_FADE_FRAC: 0.4,
  // MESSAGE_MIN_SHADE: the brightness the fade ramps DOWN TO (never 0). Same
  // readability-floor reasoning as CONFIG.MIN_SHADE: the line should dim out and
  // then vanish at MESSAGE_TIME, not become an unreadable smear first.
  MESSAGE_MIN_SHADE: 0.25,
  // MESSAGE_SHADOW_SHADE: the one-pixel offset copy drawn BEHIND the text is the
  // same glyph at this fraction of the text's shade — a near-black drop shadow, so
  // the line reads over a lit wall, a dark corridor and a sprite alike without
  // needing a second asset or any partial alpha.
  MESSAGE_SHADOW_SHADE: 0.12,

  // ===========================================================================
  // PHASE 6 — THE GAME-STATE MACHINE AND THE OVERLAY SCREENS (06-CONTEXT D-06 +
  // D-07: ALL tuning numbers live here; js/game.js and js/hud.js contain no
  // magic numbers of their own).
  // ===========================================================================

  // EXIT_RADIUS: how near the player's CENTRE must come to Level.exit's centre
  // for the run to end in VICTORY (LVL-04), in cells. Compared SQUARED on both
  // sides inside Game.checkEndConditions — no square root and no allocation in
  // the per-frame test — exactly the shape COLLECT_RADIUS uses.
  //
  // DERIVED, not eyeballed: it is bracketed from BOTH sides.
  //
  //   UPPER BOUND (< 1 cell). The exit alcove at (19,20) is ONE cell wide and its
  //   three remaining sides are exit-faced wall. A radius of a whole cell would
  //   fire from the corridor outside the alcove, so the player would win by
  //   walking PAST the exit. Half a cell means they must actually stand in it.
  //
  //   LOWER BOUND (> the per-frame travel budget). The player's largest possible
  //   single-frame step is WALK_SPEED * RUN_MULT * DT_MAX = 3.0 * 1.8 * 0.05 =
  //   0.27 cells. The trigger's diameter, 2 * EXIT_RADIUS = 1.0 cells, is
  //   comfortably larger, so a RUNNING player cannot straddle the trigger between
  //   two frames and sprint straight through their own win. This is the same
  //   "test the step, not just the endpoint" hazard COLLECT_RADIUS and
  //   PROJ_HIT_RADIUS both document.
  EXIT_RADIUS: 0.5,

  // --- The title / victory / death SCREENS (js/hud.js, D-01) ----------------
  // These are drawn on the #hud OVERLAY canvas with the Canvas 2D text API, so
  // unlike every colour above they are CSS colour STRINGS in DISPLAY pixels, not
  // packed little-endian framebuffer words. Nothing here ever reaches buf32.
  //
  // EVERY SIZE IS A FRACTION OF THE HUD CANVAS HEIGHT, never a pixel count: #hud
  // is sized to the viewport, so a fixed pixel size would be a shout in a small
  // window and a whisper on a 4K display. js/hud.js multiplies each fraction by
  // the live canvas height every frame.
  //
  // The scrim is the translucent full-canvas wash painted UNDER every screen, so
  // the frozen world behind the overlay reads as a backdrop rather than competing
  // with the text. Alpha is a real partial alpha here — legitimate on the 2D
  // overlay context, which composites, unlike the framebuffer's binary alpha key.
  SCREEN_SCRIM_COLOR: '#05070c',
  SCREEN_SCRIM_ALPHA: 0.74,
  SCREEN_HEADING_FRAC: 0.085,  // the one big word (DOOM CLONE / VICTORY / YOU DIED)
  SCREEN_BODY_FRAC: 0.030,     // the controls list and the stat readouts
  SCREEN_PROMPT_FRAC: 0.038,   // the click-to-continue line
  SCREEN_LINE_FRAC: 0.046,     // baseline-to-baseline spacing for stacked lines
  SCREEN_TEXT_COLOR: '#d8d2c4',
  SCREEN_HEADING_COLOR: '#c8302a',
  SCREEN_PROMPT_COLOR: '#e8c14a',
  // A GENERIC SYSTEM FONT STACK — family names only. No @font-face, no font file,
  // no network fetch: the self-containment gate (no runtime loads, runs from
  // file://) is untouched. The monospace families come first so the stat columns
  // line up; the generic keyword is the guaranteed fallback.
  SCREEN_FONT_FAMILY: '"Courier New", Courier, monospace',

  // ===========================================================================
  // PHASE 6 — THE IN-GAME OVERLAY: STATUS BAR, CROSSHAIR, DAMAGE FLASH
  // (06-CONTEXT D-03; plan 06-02. Same discipline as the SCREEN_* block above:
  // CSS colour STRINGS on the #hud 2D context, and EVERY SIZE IS A FRACTION OF
  // THE HUD CANVAS HEIGHT so the bar is proportionate in a 600px window and on a
  // 4K display alike. js/hud.js multiplies each fraction by the live canvas
  // height every frame — there is not one pixel count in that file.)
  // ===========================================================================

  // --- The bottom status bar (HUD-01 / HUD-02) ------------------------------
  // HUD_BAR_HEIGHT_FRAC: the bar's total height. Two stacked text rows (a small
  // label over a larger value) have to fit inside it, so it is bounded BELOW by
  // HUD_LABEL_FRAC + HUD_VALUE_FRAC (0.058) with room for the leading — and
  // bounded above by taste: much more than a tenth of the screen and the bar
  // starts eating the world it is reporting on.
  HUD_BAR_HEIGHT_FRAC: 0.085,
  // The gap between the bar and the bottom/side edges of the viewport.
  HUD_BAR_INSET_FRAC: 0.014,
  HUD_LABEL_FRAC: 0.020,       // the small caps label (HEALTH, ARMOR, ...)
  HUD_VALUE_FRAC: 0.038,       // the number or name under it
  // The bar backing. A REAL partial alpha, legitimate on the compositing 2D
  // overlay (unlike the framebuffer's binary alpha key): the world stays faintly
  // visible through the bar rather than being replaced by a black band.
  HUD_BAR_COLOR: '#05070c',
  HUD_BAR_ALPHA: 0.58,
  HUD_LABEL_COLOR: '#8d8676',   // dimmer than the value — the value is the datum
  HUD_VALUE_COLOR: '#d8d2c4',
  // THE LOW-HEALTH WARNING is ONE COMPARISON, not a gradient: health strictly
  // below this fraction of Combat.maxHealth draws in the warning colour. A ramp
  // would be prettier and unfalsifiable; a threshold is a claim a harness can
  // straddle from both sides.
  HUD_WARN_COLOR: '#c8302a',
  HUD_WARN_FRAC: 0.30,

  // --- The crosshair (HUD-03) ----------------------------------------------
  // Arm length and thickness as fractions of the canvas height. The cross is
  // built from two rectangles derived from the LIVE canvas midpoint every frame,
  // so it recentres on a resize for free.
  HUD_CROSSHAIR_ARM_FRAC: 0.014,
  HUD_CROSSHAIR_THICK_FRAC: 0.0035,
  HUD_CROSSHAIR_COLOR: '#e6e0cc',
  // The one-pixel-larger darker cross drawn UNDERNEATH, so the crosshair reads
  // against a brightly lit wall as well as against a dark corridor — the same
  // reasoning as the message line's drop shadow, and for the same reason it needs
  // no second asset and no partial alpha.
  HUD_CROSSHAIR_OUTLINE_COLOR: '#0b0d12',

  // --- The damage flash (HUD-06) -------------------------------------------
  // DAMAGE_FLASH_TIME: how long the red wash takes to decay to nothing, in
  // SIMULATION seconds. Both operands of the age (Game.time and
  // Combat.lastDamageAt) are simulation time, so the flash freezes with the sim
  // and is measurable headlessly — which is the whole reason it is not a
  // wall-clock timer.
  DAMAGE_FLASH_TIME: 0.3,
  // DAMAGE_FLASH_ALPHA: the PEAK alpha, at the instant of the hit, ramping
  // linearly to 0 across DAMAGE_FLASH_TIME. Deliberately kept well below 1: the
  // player is being shot at, and a wash they cannot see through is a wash that
  // gets them killed by the next fireball. Under half is the readability bound.
  DAMAGE_FLASH_ALPHA: 0.42,
  DAMAGE_FLASH_COLOR: '#c81410',

  // --- The corner minimap (HUD-05, 06-CONTEXT D-04) -------------------------
  // THE WHOLE LEVEL IS SHOWN, not a window around the player. At this box size the
  // entire 24x24 grid is legible, it is the classic behaviour, and it answers the
  // question a minimap exists to answer — where is the exit and what have I not
  // been to yet — which a scrolling window around the player cannot. D-04 records
  // the fairness trade explicitly (threat T-06-15, accepted).
  //
  // MINIMAP_BOX_FRAC: the box's side length as a fraction of the hud canvas
  // HEIGHT (not the width — a square box on a widescreen viewport must not grow
  // with the window's aspect). The grid inside it is drawn at an INTEGER cell size
  // and centred, so cells never land on half pixels.
  MINIMAP_BOX_FRAC: 0.26,
  MINIMAP_INSET_FRAC: 0.018,     // gap from the top-left corner of the viewport
  MINIMAP_BG_COLOR: '#05070c',
  MINIMAP_BG_ALPHA: 0.62,        // the world stays faintly visible behind it
  MINIMAP_BORDER_COLOR: '#8d8676',
  MINIMAP_SOLID_COLOR: '#6b6455',  // walls
  MINIMAP_FLOOR_COLOR: '#23262f',  // open floor — a DIFFERENT fill, so the drawn
                                   // grid is the parsed map and not a flat tile
  // The four marker colours. ALL DISTINCT, and distinct from the two grid colours:
  // the whole point of the map is telling the four kinds of thing apart at a
  // glance, and a harness counts dots BY colour, so a collision would silently
  // make two counts into one.
  MINIMAP_PLAYER_COLOR: '#e8c14a',
  MINIMAP_ENEMY_COLOR: '#c8302a',
  MINIMAP_PICKUP_COLOR: '#4ea3d8',
  MINIMAP_EXIT_COLOR: '#3fbf5a',
  // Marker sizes as fractions of the BOX (so they scale with it, not with the
  // window). The player is drawn slightly larger than the entities: it is the one
  // marker the player is looking for.
  MINIMAP_DOT_FRAC: 0.055,
  MINIMAP_PLAYER_DOT_FRAC: 0.075,
  // The facing tick's length, as a fraction of the box. Long enough to read as a
  // direction at a glance, short enough that it cannot be mistaken for a wall.
  MINIMAP_FACING_FRAC: 0.115
};
