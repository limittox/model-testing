/*
 * weapons.js — the player's hitscan weapons: the weapon table, the per-ray
 * nearest-enemy resolution with a DDA wall stop, ammo gating, and the viewmodel
 * state (bob, recoil, muzzle flash).
 *
 * LOAD ORDER: loaded AFTER js/enemies.js (it calls Enemies.hurt and scans
 * Enemies.list) and BEFORE js/game.js (whose step dispatches Weapons.update). It
 * reads CONFIG, Level (isSolid + lineOfSight), Player (the pose), Combat (ammo +
 * weapon selection) and Enemies; it touches no DOM, no canvas and no timers, so
 * the Node vm harness runs this exact file unchanged.
 *
 * ============================================================================
 * ONE DAMAGE ENTRY POINT, ONE FIRE PATH
 * ============================================================================
 * Every landed ray calls Enemies.hurt(enemy, damage) — the single enemy-damage
 * entry point js/enemies.js owns. This file never touches enemy.health directly,
 * so the re-entry guard inside hurt() (a second pellet from the same blast must
 * not re-kill a dying enemy) and plan 05-03's death/pain branch cannot be
 * bypassed by a weapon.
 *
 * Likewise there is ONE fire path. The pistol is not a special case: it is a
 * one-pellet weapon with a tiny spread running the same loop the shotgun's seven
 * pellets run. Two implementations would drift the instant either is retuned.
 *
 * ============================================================================
 * HITSCAN RESOLUTION PER RAY (05-CONTEXT D-05 — LOCKED)
 * ============================================================================
 * For a UNIT ray direction, a candidate enemy is accepted only when ALL of:
 *   . its `alive` flag is true          — a corpse is scenery, not a target. This
 *                                         is where the alive flag belongs; the AI
 *                                         update deliberately skips on the CORPSE
 *                                         STATE instead (see enemies.js).
 *   . along-ray distance > 0            — it is IN FRONT of the player
 *   . along-ray distance <= HITSCAN_RANGE
 *   . along-ray distance < wallDistance — THE WALL STOP: you cannot shoot through
 *                                         a wall (WEAP-02, threat T-05-10)
 *   . perpendicular distance < HITSCAN_TARGET_RADIUS
 *   . Level.lineOfSight to it is clear  — belt and braces with the wall stop: the
 *                                         DDA bounds the ray, LOS bounds the
 *                                         segment to that specific body
 * and the NEAREST surviving candidate wins. An enemy that fails only the LOS test
 * does not consume the win, so a farther VISIBLE enemy can still be hit past it.
 *
 * THE ORDER OF THE AMMO GATE IS LOAD-BEARING (threat T-05-11). Ammo is read and
 * gated BEFORE anything else happens: an empty weapon casts no ray, mutates
 * nothing, and — critically — does NOT charge the cooldown. Charging it would
 * silently lock a player out of firing for a third of a second after every dry
 * click, including the click right before they pick ammo up.
 *
 * ============================================================================
 * ALLOCATION: NONE, ANYWHERE IN THIS FILE
 * ============================================================================
 * The pellet angle array is preallocated once at module scope to the largest
 * pellet count in the table. The spread PRNG is a module-scope function over an
 * integer state field on Weapons — NOT a closure returned by mulberry32() — so
 * even reset() allocates nothing while producing the identical mulberry32 stream.
 * The last-shot records (lastRayCount / lastHitCount / lastTarget) let a harness
 * inspect a shot without the shot having to build a result object.
 */

var Weapons = {
  // --- Fire timing ---
  // ONE shared cooldown for the whole weapon set, never one per weapon. A
  // per-weapon timer would let a player alternate 1-2-1-2 and fire at the sum of
  // both rates (threat T-05-12).
  cooldown: 0,

  // --- The deterministic spread stream (mulberry32 over an integer state) ---
  randState: 0,

  // --- Last-shot records (allocation-free shot inspection) ---
  rayAngles: null,        // Float64Array(MAX_PELLETS) — ABSOLUTE world angles
  lastRayCount: 0,
  lastHitCount: 0,
  lastTarget: null,
  lastDryFire: false,
  shotsFired: 0,
  dryFires: 0,

  // --- Viewmodel state (WEAP-04; drawn by renderViewmodel) ---
  bobPhase: 0,            // radians, advanced by distance travelled
  bobAmp: 0,              // current amplitude in internal pixels
  speed: 0,              // cells per second, measured from the pose delta
  recoil: 0,              // seconds left of the recoil kick
  flash: 0,               // seconds left of the muzzle flash
  prevX: 0,               // previous frame's player position (speed measurement)
  prevY: 0,

  // The weapon table, filled from CONFIG below. Keyed by the Combat.weapon string.
  TABLE: null,

  // Weapon-select SLOT -> weapon name. Index 0 is null: "no selection this frame".
  SLOTS: [null, 'pistol']
};

(function () {
  'use strict';

  // Axis-aligned ray sentinel — the Level.lineOfSight / Raycaster.BIG idiom. Large
  // enough that a zero-direction axis is never the smaller sideDist, FINITE enough
  // that 0 * BIG is 0 rather than NaN.
  var BIG = 1e30;

  // ===========================================================================
  // THE WEAPON TABLE — data, read straight out of CONFIG (D-11). Task 05-02/2
  // appends the shotgun; the pistol entry is the shape both share.
  // ===========================================================================
  Weapons.TABLE = {
    pistol: {
      name: 'pistol',
      damage: CONFIG.PISTOL_DAMAGE,
      pellets: 1,
      spread: CONFIG.PISTOL_SPREAD,
      cooldown: CONFIG.PISTOL_COOLDOWN,
      ammo: CONFIG.PISTOL_AMMO,
      sprite: 'weapon'
    }
  };

  // The angle scratch is sized to the LARGEST pellet count in the table, computed
  // rather than hardcoded so adding a weapon cannot silently overflow it.
  var MAX_PELLETS = 1;
  for (var wn in Weapons.TABLE) {
    if (Weapons.TABLE[wn].pellets > MAX_PELLETS) MAX_PELLETS = Weapons.TABLE[wn].pellets;
  }
  Weapons.MAX_PELLETS = MAX_PELLETS;
  Weapons.rayAngles = new Float64Array(MAX_PELLETS);

  // ===========================================================================
  // THE SPREAD STREAM — mulberry32, written as a module-scope function over
  // Weapons.randState instead of the closure mulberry32() returns. Identical
  // output sequence for the same seed; the difference is that re-seeding is a
  // single integer assignment and allocates nothing.
  // ===========================================================================
  Weapons.rand = function () {
    var a = Weapons.randState | 0;
    a = (a + 0x6d2b79f5) | 0;
    Weapons.randState = a;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // ===========================================================================
  // RESET — REQUIRED PRODUCTION CODE, not a test hook: js/main.js calls it during
  // boot, and an undefined call there throws inside the load handler and takes the
  // whole page down with it. A future restart uses it too, and the harness calls it
  // between scenarios so no cooldown, no viewmodel timer and no PRNG stream
  // position can leak from one proof into the next.
  //
  // RE-SEEDING IS PART OF THE CONTRACT: the spread stream is restored to its
  // starting position, so replaying a scenario draws the identical pellet angles
  // element for element (assertion 2j depends on exactly this).
  //
  // Reuses the preallocated angle array; allocates nothing.
  // ===========================================================================
  Weapons.reset = function () {
    Weapons.cooldown = 0;
    Weapons.randState = (CONFIG.SEED + CONFIG.WEAPON_SEED_SALT) >>> 0;

    Weapons.lastRayCount = 0;
    Weapons.lastHitCount = 0;
    Weapons.lastTarget = null;
    Weapons.lastDryFire = false;
    Weapons.shotsFired = 0;
    Weapons.dryFires = 0;

    Weapons.bobPhase = 0;
    Weapons.bobAmp = 0;
    Weapons.speed = 0;
    Weapons.recoil = 0;
    Weapons.flash = 0;
    // Seed the travel tracker from the CURRENT pose, so the first frame after a
    // reset (or after a scenario teleports the player) measures no travel and the
    // weapon does not snap into a full-amplitude bob.
    Weapons.prevX = Player.x;
    Weapons.prevY = Player.y;

    return Weapons;
  };

  // ===========================================================================
  // WALL DISTANCE — a grid DDA in WORLD coordinates returning the distance along a
  // UNIT ray to the first solid cell, or CONFIG.HITSCAN_RANGE when none is found
  // inside the range.
  //
  // Structure MIRRORS Level.lineOfSight exactly (one technique learned once):
  //   deltaX/deltaY = |1 / dir| per axis — the along-ray distance one whole cell of
  //                   that axis costs. A ZERO direction component substitutes the
  //                   large FINITE sentinel rather than relying on Infinity, which
  //                   would produce NaN when multiplied by a zero fractional offset.
  //   sideX/sideY   = along-ray distance to the first grid line on each axis,
  //                   seeded from the fractional position inside the start cell.
  //   step          = advance whichever axis has the smaller sideDist.
  //
  // Because the ray is UNIT length, the sideDist BEFORE it is advanced IS the
  // along-ray distance at which the boundary into the next cell is crossed — which
  // is exactly the wall distance the caller needs, with no extra arithmetic.
  //
  // TERMINATION IS STRUCTURAL (threat T-05-09): capped at WIDTH + HEIGHT + 2 steps,
  // more than the longest possible grid traversal, so no player-controlled aim can
  // spin the loop. js/raycaster.js render()'s inline DDA is deliberately NOT
  // refactored to share this: the Phase 3 exact-pixel contracts depend on that
  // function staying byte-stable.
  // ===========================================================================
  Weapons.wallDistance = function (x, y, dirX, dirY) {
    var range = CONFIG.HITSCAN_RANGE;
    var mapX = Math.floor(x);
    var mapY = Math.floor(y);

    // Fail closed: a muzzle somehow inside rock stops the ray at zero rather than
    // marching out of the world.
    if (Level.isSolid(mapX, mapY)) return 0;

    var deltaX = (dirX === 0) ? BIG : Math.abs(1 / dirX);
    var deltaY = (dirY === 0) ? BIG : Math.abs(1 / dirY);

    var stepX, stepY, sideX, sideY;
    if (dirX < 0) { stepX = -1; sideX = (x - mapX) * deltaX; }
    else { stepX = 1; sideX = (mapX + 1 - x) * deltaX; }
    if (dirY < 0) { stepY = -1; sideY = (y - mapY) * deltaY; }
    else { stepY = 1; sideY = (mapY + 1 - y) * deltaY; }

    var cap = Level.WIDTH + Level.HEIGHT + 2;
    for (var i = 0; i < cap; i++) {
      var d;
      if (sideX < sideY) { d = sideX; sideX += deltaX; mapX += stepX; }
      else { d = sideY; sideY += deltaY; mapY += stepY; }
      if (d > range) return range;
      if (Level.isSolid(mapX, mapY)) return d;
    }
    return range;
  };

  // ===========================================================================
  // CAST ONE RAY (D-05). Resolves the nearest acceptable ALIVE enemy and hurts it.
  // Returns true when something was hit. Records lastTarget either way.
  // ===========================================================================
  Weapons.castRay = function (dirX, dirY, damage) {
    var px = Player.x, py = Player.y;
    var wall = Weapons.wallDistance(px, py, dirX, dirY);
    var range = CONFIG.HITSCAN_RANGE;
    var targetR = CONFIG.HITSCAN_TARGET_RADIUS;

    var list = Enemies.list;
    var best = null;
    var bestD = Infinity;

    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      // THE ALIVE FLAG IS THE CORRECT FILTER HERE (and only here): a corpse is a
      // floor decal, not a target.
      if (e.alive !== true) continue;

      var rx = e.x - px, ry = e.y - py;
      // Along-ray distance is the DOT product with the unit ray; perpendicular
      // distance is the magnitude of the CROSS product. Both are exact for a unit
      // ray with no divide and no trig.
      var along = rx * dirX + ry * dirY;
      if (!(along > 0)) continue;            // behind the player (also catches NaN)
      if (along > range) continue;           // out of range
      if (!(along < wall)) continue;         // THE WALL STOP
      if (!(along >= bestD)) {
        var perp = Math.abs(rx * dirY - ry * dirX);
        if (!(perp < targetR)) continue;     // the aim ray misses the body
        // LOS LAST: it is the only test that costs a DDA march, and a candidate
        // that fails it must NOT consume the win — a farther VISIBLE enemy behind
        // an occluded one is still a legal target.
        if (!Level.lineOfSight(px, py, e.x, e.y)) continue;
        bestD = along;
        best = e;
      }
    }

    Weapons.lastTarget = best;
    if (!best) return false;
    // THE SINGLE ENEMY DAMAGE ENTRY POINT (built by 05-01).
    Enemies.hurt(best, damage);
    return true;
  };

  // ===========================================================================
  // FIRE — the ammo gate, then the pellet loop, then the viewmodel triggers.
  // Returns true when a shot actually left the barrel.
  // ===========================================================================
  Weapons.fire = function () {
    var w = Weapons.TABLE[Combat.weapon];
    if (!w) { Weapons.lastDryFire = true; Weapons.dryFires += 1; return false; }

    // THE AMMO GATE COMES FIRST AND TOUCHES NOTHING WHEN IT REFUSES — including
    // the cooldown (D-05, threat T-05-11).
    var field = w.ammo;
    var have = Combat.ammo[field];
    if (!(have > 0)) {
      Weapons.lastDryFire = true;
      Weapons.dryFires += 1;
      return false;
    }

    Combat.ammo[field] = have - 1;
    Weapons.cooldown = w.cooldown;
    Weapons.lastDryFire = false;

    // ONE code path for every weapon. The aim angle comes from the pose; each
    // pellet offsets it by a deterministic draw in [-spread, +spread].
    var base = Math.atan2(Player.dirY, Player.dirX);
    var angles = Weapons.rayAngles;
    var n = w.pellets;
    if (n > angles.length) n = angles.length;   // structural: cannot overflow

    var hits = 0;
    for (var i = 0; i < n; i++) {
      var a = base + (Weapons.rand() * 2 - 1) * w.spread;
      angles[i] = a;
      if (Weapons.castRay(Math.cos(a), Math.sin(a), w.damage)) hits += 1;
    }

    Weapons.lastRayCount = n;
    Weapons.lastHitCount = hits;
    Weapons.shotsFired += 1;

    // The viewmodel triggers (WEAP-04). Both are plain countdown timers ticked by
    // updateViewmodel and read by renderViewmodel.
    Weapons.recoil = CONFIG.RECOIL_TIME;
    Weapons.flash = CONFIG.MUZZLE_FLASH_TIME;
    return true;
  };

  // ===========================================================================
  // VIEWMODEL STATE (WEAP-04) — measured from the POSE, never from the intent, so
  // a player walking into a wall (intent held, no travel) correctly has a still
  // weapon.
  //
  // The bob amplitude scales with speed relative to the player's MAXIMUM ground
  // speed (walk * run multiplier) and is clamped to 1. Scaling against WALK_SPEED
  // instead would saturate the amplitude at walking pace and make running look
  // identical to walking — see 05-02-SUMMARY's deviation note.
  // ===========================================================================
  Weapons.updateViewmodel = function (dt) {
    if (!isFinite(dt) || dt <= 0) return;

    var dx = Player.x - Weapons.prevX;
    var dy = Player.y - Weapons.prevY;
    Weapons.prevX = Player.x;
    Weapons.prevY = Player.y;

    var travelled = Math.sqrt(dx * dx + dy * dy);
    var speed = travelled / dt;
    if (!isFinite(speed) || speed < 0) speed = 0;
    Weapons.speed = speed;

    var maxSpeed = Player.WALK_SPEED * Player.RUN_MULT;
    var ratio = (maxSpeed > 0) ? (speed / maxSpeed) : 0;
    if (ratio > 1) ratio = 1;
    Weapons.bobAmp = CONFIG.BOB_AMP_PIXELS * ratio;

    // The phase advances with SPEED, so the stride rate rises when running and
    // freezes completely when standing (a standing weapon must be dead still).
    Weapons.bobPhase += speed * CONFIG.BOB_FREQ * dt;
    // Keep the phase bounded so a long session cannot lose sine precision.
    if (Weapons.bobPhase > 1e6) Weapons.bobPhase = Weapons.bobPhase % (Math.PI * 2);

    if (Weapons.recoil > 0) {
      Weapons.recoil -= dt;
      if (Weapons.recoil < 0) Weapons.recoil = 0;
    }
    if (Weapons.flash > 0) {
      Weapons.flash -= dt;
      if (Weapons.flash < 0) Weapons.flash = 0;
    }
  };

  // ===========================================================================
  // UPDATE — dispatched from Game.step with the intent that frame SAMPLED ONCE.
  // Weapons owns every cooldown and ammo decision; the intent only ever says what
  // the player is asking for (D-07/D-10).
  // ===========================================================================
  Weapons.update = function (dt, intent) {
    // One bad number must never corrupt the weapon state (mirrors Player.update
    // and Enemies.update).
    if (!isFinite(dt) || dt < 0) return;

    if (Weapons.cooldown > 0) {
      Weapons.cooldown -= dt;
      if (Weapons.cooldown < 0) Weapons.cooldown = 0;
    }

    Weapons.updateViewmodel(dt);

    if (!intent) return;
    if (intent.fire === true && Weapons.cooldown <= 0) Weapons.fire();
  };

})();
