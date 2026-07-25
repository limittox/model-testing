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
  WEAPON_SEED_SALT: 7331
};
