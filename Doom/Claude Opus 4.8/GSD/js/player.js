/*
 * player.js — the player pose: a vector camera (direction + camera plane), a
 * single-matrix rotation, and per-axis radius collision that slides along walls.
 *
 * LOAD ORDER: loaded AFTER js/level.js and BEFORE js/game.js / js/main.js (see
 * index.html). It reads CONFIG (FOV_PLANE, DT_MAX, WALK_SPEED budget) and the
 * Level query API (Level.isSolid, Level.playerStart); it writes nothing to the
 * DOM and holds no timers or rendering — pure simulation state and math, so the
 * Node vm harness runs this exact file unchanged.
 *
 * THE CAMERA MODEL (D-01 — LOCKED; Phase 3's raycaster, Phase 4's billboard
 * projection and Phase 5's hitscan all consume this pose):
 *
 *   The pose is a POSITION plus a DIRECTION vector plus a CAMERA PLANE:
 *   {x, y, dirX, dirY, planeX, planeY}. The plane is ALWAYS the direction
 *   rotated a quarter turn and scaled by the field of view:
 *       planeX = dirY * FOV_PLANE
 *       planeY = -dirX * FOV_PLANE
 *   That relationship is written in exactly ONE place (setDir). Turning applies
 *   ONE 2D rotation matrix to BOTH vectors (rotate), which keeps them
 *   orthonormal and preserves the plane-from-direction relationship exactly —
 *   because 2D rotations commute, rotating both is identical to rotating the
 *   direction and recomputing the plane, but avoids per-column trig later. There
 *   is NO authoritative stored angle; a convenience angle for the top-down view
 *   is derived on demand from the direction vector.
 *
 * PER-AXIS COLLISION (D-06 — LOCKED): the X axis resolves and COMMITS first,
 * then the Y axis resolves against the POST-X-resolution x. A rejected axis does
 * not cancel the other axis's attempt — that independence is what makes the
 * player slide along a wall instead of sticking.
 *
 * PHASE 5 — THE SLIDE IS NOW SHARED (05-CONTEXT D-11 "reuse, don't
 * re-architect"): the D-06 routine is generalized into three RADIUS-PARAMETERISED
 * helpers — canOccupyXFor / canOccupyYFor / slideMove — that operate on ANY
 * object carrying {x, y}. js/enemies.js moves every chasing enemy through
 * Player.slideMove(enemy, dx, dy, CONFIG.ENEMY_RADIUS), so an enemy collides with
 * walls with the PLAYER'S EXACT semantics rather than a second, drifting
 * implementation. Player.canOccupyX / canOccupyY / moveBy are thin delegations
 * that pass Player and Player.RADIUS: the public API and the observed player
 * behaviour are unchanged (tools/verify-motion.cjs is the proof — every existing
 * assertion passes unedited).
 *
 * slideMove additionally RETURNS THE DISTANCE ACTUALLY TRAVELLED. The enemy chase
 * steer needs that number: comparing it against the requested step is how a
 * corner jam is detected (a raw steer alone jams a 0.70-footprint enemy on a
 * one-cell corridor mouth forever).
 */

var Player = {
  // --- Pose (D-01) ---
  x: 0,        // world position, in cells
  y: 0,
  dirX: 1,     // unit direction vector
  dirY: 0,
  planeX: 0,   // camera plane — always dir rotated -90deg and scaled by FOV_PLANE
  planeY: -CONFIG.FOV_PLANE,

  // --- Tuning constants (units named per constant) ---
  RADIUS: 0.22,            // collision radius, in cells (< half a cell)
  WALK_SPEED: 3.0,         // cells per second
  RUN_MULT: 1.8,           // run multiplies WALK_SPEED by this and nothing else
  TURN_SPEED: 2.6,         // radians per second for keyboard turning (dt-scaled)
  MOUSE_SENSITIVITY: 0.0022, // radians per raw mouse pixel — per-EVENT, deliberately NOT dt-scaled

  // Set by spawn() only when it had to fall back (no Level.playerStart).
  spawnWarning: null
};

(function () {
  'use strict';

  // ===========================================================================
  // CAMERA — the plane is derived from the direction in exactly one place.
  // ===========================================================================

  // Normalize (dx,dy), store as the unit direction, and RECOMPUTE the plane from
  // it. This is the single site where planeX/planeY are written from dir; every
  // other mutation of the pose goes through rotate(), which preserves the same
  // relationship by construction.
  Player.setDir = function (dx, dy) {
    var len = Math.sqrt(dx * dx + dy * dy);
    if (!(len > 0) || !isFinite(len)) { dx = 1; dy = 0; len = 1; } // fail safe to east
    Player.dirX = dx / len;
    Player.dirY = dy / len;
    Player.planeX = Player.dirY * CONFIG.FOV_PLANE;
    Player.planeY = -Player.dirX * CONFIG.FOV_PLANE;
  };

  // Rotate the pose by `a` radians. cos(a)/sin(a) are computed ONCE and the SAME
  // 2D rotation matrix is applied to BOTH the direction and the plane.
  //
  // SIGN CONVENTION (corrected — this comment previously claimed the opposite and
  // the bug shipped): positive `a` turns the camera LEFT on screen, negative `a`
  // turns RIGHT. That is forced by the plane relationship in setDir, NOT free to
  // choose here: with planeX = dirY*F, planeY = -dirX*F, facing east (1,0) gives
  // plane (0,-F), and since the renderer's cameraX runs -1 (screen left) .. +1
  // (screen right), screen-RIGHT maps to -y. A positive `a` drives dirY toward
  // +y, i.e. toward screen-LEFT. Callers converting player intent into a rotation
  // must therefore NEGATE (see Player.update) — do not "fix" this by flipping the
  // plane sign in setDir, which would mirror the entire rendered image.
  // Verified in-browser by projecting a known world point and confirming it moves
  // toward screen centre when the player turns toward it.
  Player.rotate = function (a) {
    if (!isFinite(a) || a === 0) return;
    var c = Math.cos(a);
    var s = Math.sin(a);
    var dx = Player.dirX, dy = Player.dirY;
    Player.dirX = dx * c - dy * s;
    Player.dirY = dx * s + dy * c;
    var px = Player.planeX, py = Player.planeY;
    Player.planeX = px * c - py * s;
    Player.planeY = px * s + py * c;
  };

  // ===========================================================================
  // SPAWN — the level's authored start is the single source of the initial pose.
  // ===========================================================================

  Player.spawn = function () {
    Player.spawnWarning = null;
    var start = (typeof Level !== 'undefined') ? Level.playerStart : null;
    if (start) {
      Player.x = start.x;
      Player.y = start.y;
      Player.setDir(start.dirX, start.dirY);
      return Player;
    }
    // Fallback: the centre of the first non-solid cell, facing east. Recorded so
    // a missing start marker is visible rather than silent.
    Player.spawnWarning = 'Level.playerStart missing — spawned at first open cell';
    var W = (typeof Level !== 'undefined') ? Level.WIDTH : 0;
    var H = (typeof Level !== 'undefined') ? Level.HEIGHT : 0;
    for (var my = 0; my < H; my++) {
      for (var mx = 0; mx < W; mx++) {
        if (!Level.isSolid(mx, my)) {
          Player.x = mx + 0.5;
          Player.y = my + 0.5;
          Player.setDir(1, 0);
          return Player;
        }
      }
    }
    // No open cell at all — leave the pose at its default and warn.
    Player.setDir(1, 0);
    return Player;
  };

  // ===========================================================================
  // PER-AXIS COLLISION (D-06) — leading-edge radius test, X commits before Y.
  //
  // THE GENERALIZED FORM (Phase 5). These three helpers hold the ONE copy of the
  // maths. They take the mover's CURRENT (curX, curY) and its RADIUS explicitly
  // instead of reading Player, so the player and every enemy share one routine.
  // ===========================================================================

  // Can a body of `radius` centred on row curY stand at x=newX? Tests the
  // LEADING EDGE of the X move (newX offset by +/-radius in the direction of
  // travel) at BOTH corners of the body on the y axis, so the radius protects
  // the corners as well as the centre line. A zero-length move is always allowed
  // (the caller skips it).
  Player.canOccupyXFor = function (curX, curY, newX, radius) {
    var dx = newX - curX;
    if (dx === 0) return true;
    var edge = newX + (dx > 0 ? radius : -radius);
    var ex = Math.floor(edge);
    return !Level.isSolid(ex, Math.floor(curY - radius)) &&
           !Level.isSolid(ex, Math.floor(curY + radius));
  };

  // The mirror image: can a body of `radius` at column curX stand at y=newY? The
  // curX passed here is the POST-X-RESOLUTION x — the column the body actually
  // holds after the X attempt was accepted or rejected — never the pre-move x.
  Player.canOccupyYFor = function (curX, curY, newY, radius) {
    var dy = newY - curY;
    if (dy === 0) return true;
    var edge = newY + (dy > 0 ? radius : -radius);
    var ey = Math.floor(edge);
    return !Level.isSolid(Math.floor(curX - radius), ey) &&
           !Level.isSolid(Math.floor(curX + radius), ey);
  };

  // Move ANY object carrying {x, y} by (dx,dy) with the D-06 semantics.
  // RESOLUTION ORDER is load-bearing: resolve X FIRST and COMMIT it (write obj.x
  // only if accepted), THEN resolve Y against the committed x. "Independent"
  // means a rejected X does not cancel the Y attempt and vice versa — it does NOT
  // mean Y is tested against stale x.
  //
  // RETURNS the distance actually travelled (0 when both axes were rejected).
  // The enemy chase steer compares that against the requested step to detect a
  // corner jam; the player ignores it.
  Player.slideMove = function (obj, dx, dy, radius) {
    var x0 = obj.x, y0 = obj.y;
    if (dx !== 0) {
      var nx = obj.x + dx;
      if (Player.canOccupyXFor(obj.x, obj.y, nx, radius)) obj.x = nx;
    }
    if (dy !== 0) {
      var ny = obj.y + dy;
      if (Player.canOccupyYFor(obj.x, obj.y, ny, radius)) obj.y = ny;
    }
    var mx = obj.x - x0, my = obj.y - y0;
    return Math.sqrt(mx * mx + my * my);
  };

  // --- The unchanged public player API: thin delegations at Player.RADIUS ------

  Player.canOccupyX = function (nx, y) {
    return Player.canOccupyXFor(Player.x, y, nx, Player.RADIUS);
  };

  Player.canOccupyY = function (x, ny) {
    return Player.canOccupyYFor(x, Player.y, ny, Player.RADIUS);
  };

  Player.moveBy = function (dx, dy) {
    Player.slideMove(Player, dx, dy, Player.RADIUS);
  };

  // ===========================================================================
  // UPDATE — consumes the intent contract {forward, strafe, turn, run, mouseDX}.
  // ===========================================================================

  Player.update = function (dt, intent) {
    // One bad number must never corrupt the pose: bail before touching state.
    if (!isFinite(dt) || dt < 0) return;
    if (!intent) return;
    var forward = intent.forward, strafe = intent.strafe;
    var turn = intent.turn, mouseDX = intent.mouseDX;
    if (!isFinite(forward) || !isFinite(strafe) ||
        !isFinite(turn) || !isFinite(mouseDX)) return;

    // TURNING: keyboard turn is delta-time scaled; mouse is per-event (already a
    // per-pixel delta) and deliberately NOT scaled by dt. One combined rotate.
    //
    // The NEGATION is load-bearing, not cosmetic. Intent is expressed in SCREEN
    // terms — ArrowRight is `turn: +1` and a rightward mouse gives a positive
    // movementX, and both must swing the view RIGHT. Player.rotate's positive
    // direction is screen-LEFT (forced by the camera-plane relationship; see the
    // sign-convention note on rotate). Without this negation both the mouse and
    // the arrow keys are inverted — which is exactly how it originally shipped.
    var rot = -(turn * Player.TURN_SPEED * dt + mouseDX * Player.MOUSE_SENSITIVITY);
    if (rot !== 0) Player.rotate(rot);

    // MOVEMENT: build the local intent from forward + strafe.
    if (forward !== 0 || strafe !== 0) {
      var fwd = forward, str = strafe;
      // Normalize only when BOTH are non-zero, so a diagonal is not faster than a
      // straight line (a single-axis intent already has magnitude 1).
      if (fwd !== 0 && str !== 0) {
        var len = Math.sqrt(fwd * fwd + str * str);
        fwd /= len; str /= len;
      }
      // The unit RIGHT vector is the plane divided by its FOV length — the plane
      // is the authoritative "right", and dividing out FOV_PLANE makes strafe
      // speed equal forward speed regardless of the field of view.
      var rightX = Player.planeX / CONFIG.FOV_PLANE;
      var rightY = Player.planeY / CONFIG.FOV_PLANE;
      var speed = Player.WALK_SPEED * (intent.run ? Player.RUN_MULT : 1) * dt;
      var wdx = (Player.dirX * fwd + rightX * str) * speed;
      var wdy = (Player.dirY * fwd + rightY * str) * speed;
      Player.moveBy(wdx, wdy);
    }
  };

  // ===========================================================================
  // TUNNELING BUDGET — the derived per-frame step ceiling.
  // ===========================================================================

  // The largest distance a single frame can move the player: run speed times the
  // clamped delta. INVARIANT: because the collision test is at the LEADING EDGE
  // of the destination and walls are one cell thick, tunneling requires a single
  // frame step of at least one full cell — so this value MUST stay well below
  // 1.0. It is DERIVED (never hardcoded) so retuning the speed constants keeps
  // the invariant honest. At the shipped constants: 3.0 * 1.8 * 0.05 = 0.27.
  Player.maxStepPerFrame = function () {
    return Player.WALK_SPEED * Player.RUN_MULT * CONFIG.DT_MAX;
  };

})();
