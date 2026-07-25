/*
 * tools/verify-combat.cjs — the Phase 5 COMBAT TRACER harness (05-01).
 *
 * NODE-ONLY (never referenced by index.html). Built on tools/boot.cjs: it boots
 * the SHIPPED script list in the SHIPPED order into one vm context with a stubbed
 * DOM, fires the window load event (main.js builds the level, spawns the player,
 * calls Combat.reset() + Enemies.build() and starts the loop), then drives the
 * simulation deterministically.
 *
 * TWO DRIVERS, both legitimate, chosen per proof:
 *   - h.raf.step(ms) — the REAL loop. Section 1 (the end-to-end tracer chain) uses
 *     it exclusively, so what is under test is the actual Game.frame -> Game.step
 *     -> Enemies.update wiring plus the render/present path, not a hand-called
 *     subset of it.
 *   - Game.step(dt) — a DIRECT simulation step with an exact delta and no render.
 *     Section 2's scenario proofs use it: they need an exact dt and thousands of
 *     frames, and rendering each one would buy nothing. Game.time accumulates
 *     inside Game.step (05-01 moved it there from Game.frame), so every age-based
 *     assertion is meaningful under EITHER driver — assertion 2y proves that.
 *
 * FALSIFIABILITY DISCIPLINE (the idiom verify-sprites sections 5/8 established):
 * every zero-result proof is PAIRED with a control that makes the same
 * measurement non-zero. A "the enemy stayed idle" proof is worthless unless the
 * same enemy, same harness, same measurement, provably DOES move when the gate it
 * is being blocked by is removed. Every expected number is DERIVED from the
 * CONFIG constants so a future retune cannot silently invalidate a proof.
 *
 * Prints PASS/FAIL per assertion and the terminal token ALL_COMBAT_CONTRACTS_PASS
 * only when every assertion passed.
 */

'use strict';

const { boot, assert, finish } = require('./boot.cjs');

const h = boot({});
h.fireLoad();

const s = h.sandbox;
const CONFIG = s.CONFIG;
const Level = s.Level;
const Player = s.Player;
const Game = s.Game;
const Entities = s.Entities;
const Enemies = s.Enemies;
const Combat = s.Combat;
const raf = h.raf;

// ---------------------------------------------------------------------------
// Harness helpers
// ---------------------------------------------------------------------------

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const distToPlayer = (e) => dist(e.x, e.y, Player.x, Player.y);

// The frame delta every stepped drive uses, and its seconds form. 60 fps.
const FRAME_MS = 1000 / 60;
const FRAME_DT = FRAME_MS / 1000;

// A scripted intent source so the harness — not a keyboard — decides what the
// player tries to do. The player is parked (all-zero intent) for every proof
// except the dead-player pair, which holds a full movement intent.
const ZERO = { forward: 0, strafe: 0, turn: 0, mouseDX: 0, run: false };
const scriptedInput = {
  intent: ZERO,
  readIntent: function () { return this.intent; },
  reset: function () { this.intent = ZERO; }
};
Game.input = scriptedInput;
function setIntent(o) {
  scriptedInput.intent = Object.assign({ forward: 0, strafe: 0, turn: 0, mouseDX: 0, run: false }, o || {});
}

// Drive N frames through the REAL loop (renders + presents each frame).
function loopFrames(n) { for (let i = 0; i < n; i++) raf.step(FRAME_MS); }
// Drive N frames as DIRECT simulation steps (no render).
function simFrames(n, dt) { const d = dt === undefined ? FRAME_DT : dt; for (let i = 0; i < n; i++) Game.step(d); }

function place(o, x, y) { o.x = x; o.y = y; return o; }

// The number of Level.spawns entries that have a SPRITE_FOR descriptor — the
// spawn-derived billboard count, COMPUTED from the level rather than hardcoded.
function spawnDerivedCount() {
  let n = 0;
  for (const sp of Level.spawns) if (Entities.SPRITE_FOR[sp.type]) n++;
  return n;
}
function enemyMarkerCount() {
  let n = 0;
  for (const sp of Level.spawns) if (sp.type === 'enemy') n++;
  return n;
}

// ---------------------------------------------------------------------------
// Projectile spawn instrumentation. Enemies.update calls Enemies.spawnProjectile
// through the namespace, so wrapping it here records every shot WITH the exact
// enemy and player positions at the moment of the shot — which is what makes the
// aim assertion (1e) and the cooldown counts (2h, 2i) exact rather than inferred.
// ---------------------------------------------------------------------------
let spawnLog = [];
const realSpawnProjectile = Enemies.spawnProjectile;
Enemies.spawnProjectile = function (e) {
  const rec = { ex: e.x, ey: e.y, px: Player.x, py: Player.y };
  const p = realSpawnProjectile.call(Enemies, e);
  rec.p = p;
  spawnLog.push(rec);
  return p;
};
function resetSpawnLog() { spawnLog = []; }
function activeProjectiles() {
  let n = 0;
  for (const p of Enemies.projectiles) if (p.active === true) n++;
  return n;
}

// ===========================================================================
// 1. THE TRACER CHAIN — driven entirely through the REAL loop (h.raf.step), so
//    every assertion below is also an assertion that Game.step actually
//    dispatches the AI and that the render/present path survives it.
// ===========================================================================

// --- 1h FIRST: the ghost-billboard gate, measured on the SHIPPED level -------
// This runs before any scenario mutates anything, because it is a statement
// about what Enemies.build() produced from the spawn table.
(function () {
  Enemies.build();

  const spawnCount = spawnDerivedCount();
  const enemyCount = enemyMarkerCount();

  assert(Entities.list.length === spawnCount + CONFIG.PROJ_POOL,
    '1h-i. Entities.list is EXACTLY the spawn-derived billboards plus the projectile pool (' +
    spawnCount + ' + ' + CONFIG.PROJ_POOL + ' = ' + (spawnCount + CONFIG.PROJ_POOL) +
    ', got ' + Entities.list.length + ') — the AI ADOPTED, it did not append');

  assert(Enemies.list.length === enemyCount,
    '1h-ii. Enemies.list holds exactly one entry per enemy marker (' + enemyCount + ')');

  // Every enemy the AI owns is the SAME OBJECT as an entity the sprite builder
  // emitted — strict reference identity, not an equal-looking copy.
  let allAdopted = true;
  for (const e of Enemies.list) if (Entities.list.indexOf(e) < 0) allAdopted = false;
  assert(allAdopted,
    '1h-iii. every Enemies.list entry is the SAME OBJECT (strict ===) as an Entities.list entry');

  // No two ACTIVE entities share a position AND a sprite. The inactive pool is
  // excluded because every pooled projectile legitimately sits at the origin.
  function noActiveDuplicates() {
    const seen = new Set();
    for (const e of Entities.list) {
      if (e.active === false) continue;
      const key = e.x + '|' + e.y + '|' + e.sprite;
      if (seen.has(key)) return false;
      seen.add(key);
    }
    return true;
  }
  assert(noActiveDuplicates(),
    '1h-iv. no two ACTIVE entities share both position and sprite — no inert ghost is drawn ' +
    'on top of a live enemy');

  // Idempotence: a second build leaves all of it unchanged.
  const before = [Entities.list.length, Enemies.list.length, Enemies.projectiles.length];
  Enemies.build();
  const after = [Entities.list.length, Enemies.list.length, Enemies.projectiles.length];
  assert(before[0] === after[0] && before[1] === after[1] && before[2] === after[2] &&
    Entities.list.length === spawnCount + CONFIG.PROJ_POOL && noActiveDuplicates(),
    '1h-v. Enemies.build() is IDEMPOTENT: a second call yields the same three lengths (' +
    after.join('/') + ') and the same one-billboard-per-enemy invariant');
})();

// --- 1a..1g: the end-to-end chain on ONE enemy -------------------------------
(function () {
  Enemies.build();
  Combat.reset();

  // The tracer observes exactly ONE actor. The other spawn-derived enemies stay
  // in Entities.list as billboards; truncating Enemies.list IN PLACE simply
  // takes them out of the AI's update set for this scenario.
  while (Enemies.list.length > 1) Enemies.list.pop();
  const e = Enemies.list[0];

  const framesBefore = Game.frames;
  const putBefore = h.putCount();

  // --- 1a: freshly built state ---------------------------------------------
  assert(e.state === 'idle' && e.alive === true && e.active === true &&
    e.health === CONFIG.ENEMY_HEALTH && e.sprite === 'enemyIdle',
    '1a. the built enemy is idle/alive/active with health ENEMY_HEALTH and the idle sprite frame');

  // --- 1b: no line of sight => no behaviour --------------------------------
  // Player at (2.5,2.5), enemy at (13.5,2.5): 11 cells apart (INSIDE the 12-cell
  // sight range) with the cols 9..12 wall block on row 2 between them.
  Player.x = 2.5; Player.y = 2.5; Player.setDir(1, 0);
  place(e, 13.5, 2.5);
  e.state = 'idle';
  setIntent(null);
  resetSpawnLog();

  assert(distToPlayer(e) < CONFIG.ENEMY_SIGHT_RANGE &&
    Level.lineOfSight(e.x, e.y, Player.x, Player.y) === false,
    '1b-i. precondition: the enemy is INSIDE sight range (' + distToPlayer(e).toFixed(1) +
    ' < ' + CONFIG.ENEMY_SIGHT_RANGE + ') but line of sight is BLOCKED');

  const bx = e.x, by = e.y;
  loopFrames(60);
  assert(e.state === 'idle' && e.x === bx && e.y === by && activeProjectiles() === 0 &&
    spawnLog.length === 0,
    '1b-ii. 60 stepped frames with no line of sight: still idle, position byte-identical, ' +
    'zero projectiles spawned');

  // --- 1c: the CONTROL that makes 1b falsifiable ---------------------------
  // The SAME enemy, teleported into clear line of sight inside sight range.
  place(e, 8.5, 2.5);
  assert(distToPlayer(e) < CONFIG.ENEMY_SIGHT_RANGE &&
    Level.lineOfSight(e.x, e.y, Player.x, Player.y) === true,
    '1c-i. precondition: the SAME enemy now has clear line of sight inside sight range');
  let chaseFrame = -1;
  for (let i = 0; i < 10; i++) {
    raf.step(FRAME_MS);
    if (e.state === 'chase') { chaseFrame = i; break; }
  }
  assert(chaseFrame >= 0,
    '1c-ii. CONTROL: with sight restored the SAME enemy enters chase within 10 frames (frame ' +
    chaseFrame + ') — 1b was a real gate, not a dead state machine');

  // --- 1d: chase strictly closes the distance IN OPEN SPACE ----------------
  // Both actors stand in the open west start room on row 2 with no wall between
  // them and none in the closing path. Strict per-frame monotonicity is an
  // OPEN-SPACE property only; the walled cases are 2a-2c and 2v-2x.
  place(e, 5.5, 2.5);
  e.state = 'chase';
  e.stuck = 0;
  // Park the attack gate for this measurement: an enemy that enters the attack
  // state stops moving during its windup, which is correct behaviour but is not
  // what this assertion is about (1e proves the attack).
  e.cooldown = 1e9;

  let strictlyClosing = true, everBelowStop = false, reachedStop = false;
  let prev = distToPlayer(e);
  for (let i = 0; i < 60; i++) {
    raf.step(FRAME_MS);
    const d = distToPlayer(e);
    if (d < CONFIG.ENEMY_STOP_RANGE - 1e-9) everBelowStop = true;
    if (d <= CONFIG.ENEMY_STOP_RANGE + 1e-9) reachedStop = true;
    if (!reachedStop && !(d < prev - 1e-12)) strictlyClosing = false;
    prev = d;
  }
  assert(strictlyClosing && reachedStop && !everBelowStop,
    '1d. in OPEN SPACE the chase strictly reduces the enemy-to-player distance every frame ' +
    'until ENEMY_STOP_RANGE (' + CONFIG.ENEMY_STOP_RANGE + '), and never closes past it (final ' +
    distToPlayer(e).toFixed(3) + ')');

  // --- 1e: attack spawns exactly one pooled, aimed projectile --------------
  resetSpawnLog();
  e.cooldown = 0;                       // release the attack gate
  const poolBefore = Enemies.projectiles.length;
  let fired = null;
  for (let i = 0; i < 60 && !fired; i++) {
    raf.step(FRAME_MS);
    if (spawnLog.length > 0) fired = spawnLog[0];
  }
  assert(fired !== null && fired.p !== null,
    '1e-i. with line of sight inside attack range a pooled projectile becomes active');

  if (fired && fired.p) {
    const p = fired.p;
    const aimX = fired.px - fired.ex, aimY = fired.py - fired.ey;
    const aimLen = Math.hypot(aimX, aimY);
    const vLen = Math.hypot(p.vx, p.vy);
    const dot = (p.vx / vLen) * (aimX / aimLen) + (p.vy / vLen) * (aimY / aimLen);
    assert(dot > 1 - 1e-9,
      '1e-ii. the projectile velocity points from the enemy toward the PLAYER POSITION AT SPAWN ' +
      'TIME (dot ' + dot.toFixed(9) + ')');
    assert(near(vLen, CONFIG.PROJ_SPEED, 1e-9),
      '1e-iii. the projectile speed is exactly CONFIG.PROJ_SPEED (' + vLen.toFixed(6) + ')');
    assert(Entities.list.indexOf(p) >= 0 && Enemies.projectiles.indexOf(p) >= 0 &&
      Enemies.projectiles.length === poolBefore,
      '1e-iv. the projectile is a member of BOTH Entities.list and the preallocated pool, ' +
      'and the pool did not grow');
  }

  // --- 1f: the projectile reaches the player and takes health --------------
  const healthBefore = Combat.health;
  assert(healthBefore === CONFIG.PLAYER_START_HEALTH,
    '1f-i. precondition: the player is still at PLAYER_START_HEALTH before impact');
  let hitFrame = -1, activeAtHit = null;
  const firstShot = fired ? fired.p : null;
  for (let i = 0; i < 200 && hitFrame < 0; i++) {
    raf.step(FRAME_MS);
    if (Combat.health < healthBefore) {
      hitFrame = i;
      activeAtHit = firstShot ? firstShot.active : null;
    }
  }
  assert(hitFrame >= 0 && Combat.health < CONFIG.PLAYER_START_HEALTH,
    '1f-ii. the fireball closed on the player and reduced Combat.health (' + Combat.health +
    ' < ' + CONFIG.PLAYER_START_HEALTH + ') at frame ' + hitFrame);
  assert(activeAtHit === false,
    '1f-iii. the projectile that landed is DEACTIVATED on the hit frame (returned to the pool)');

  // --- 1g: the render/present path survived the whole sequence -------------
  const framesRun = Game.frames - framesBefore;
  const putRun = h.putCount() - putBefore;
  assert(framesRun > 0 && putRun === framesRun,
    '1g. across the whole tracer sequence the frame was presented exactly once per stepped ' +
    'frame (' + putRun + ' presents / ' + framesRun + ' frames) — Entities.render never threw');
})();

// ===========================================================================
// 2. THE FALSIFIABLE AI / PROJECTILE / DAMAGE PROOFS.
//
// Every scenario is built from scratch through scenario() so none of them can
// leak into the next, and the sim is driven with DIRECT Game.step(dt) calls: they
// need an exact delta and thousands of frames, and section 1 already proved the
// rAF wiring. Every expected number is derived from the CONFIG constants.
// ===========================================================================

// Rebuild the entity world, reset the player, park it at (px,py), and hand the
// AI an EMPTY update set — each scenario then composes exactly the enemies it
// wants with Enemies.add. The spawn-derived enemies stay in Entities.list as
// billboards, so nothing is orphaned; they are simply not this scenario's actors.
function scenario(px, py, dx, dy) {
  Enemies.reset();
  Combat.reset();
  Enemies.list.length = 0;
  for (const p of Enemies.projectiles) p.active = false;
  Player.x = px; Player.y = py;
  Player.setDir(dx === undefined ? 1 : dx, dy === undefined ? 0 : dy);
  setIntent(null);
  resetSpawnLog();
}

// Temporarily overwrite a run of cells on one row, returning a restore function.
// Used by the wall-removal controls: the SAME scenario with the wall gone must
// produce the opposite result, or the "a wall stopped it" claim is unfalsifiable.
function openCells(row, fromX, toX) {
  const saved = [];
  for (let x = fromX; x <= toX; x++) {
    saved.push(Level.cells[row * Level.WIDTH + x]);
    Level.cells[row * Level.WIDTH + x] = 0;
  }
  return function restore() {
    for (let x = fromX; x <= toX; x++) Level.cells[row * Level.WIDTH + x] = saved[x - fromX];
  };
}
function setCell(mx, my, id) {
  const was = Level.cells[my * Level.WIDTH + mx];
  Level.cells[my * Level.WIDTH + mx] = id;
  return function restore() { Level.cells[my * Level.WIDTH + mx] = was; };
}

// ---------------------------------------------------------------------------
// 2a / 2b / 2c — WALL COLLISION.
// ---------------------------------------------------------------------------
(function () {
  // The row-2 wall block spans cols 9..12. The enemy chases from the west side
  // toward a player on the east side, so the wall is squarely on the axis it
  // wants to cross.
  scenario(13.5, 2.5);
  const e = Enemies.add(8.5, 2.5);
  e.state = Enemies.CHASE;   // already hunting: there is no sight through a wall

  const faceX = 9;           // the world x of the wall face on row 2
  assert(Level.isSolid(9, 2) && !Level.isSolid(8, 2) && !Level.isSolid(13, 2) &&
    Level.lineOfSight(e.x, e.y, Player.x, Player.y) === false,
    '2a-i. precondition: a solid wall at (9,2) sits between the chasing enemy (8.5,2.5) and the ' +
    'player (13.5,2.5), with no line of sight');

  let onRowFrames = 0, arrestedOnRow = true;
  let neverInSolid = true, neverSkippedCell = true, neverCutCorner = true;
  for (let i = 0; i < 120; i++) {
    const pmx = Math.floor(e.x), pmy = Math.floor(e.y);
    Game.step(FRAME_DT);
    const mx = Math.floor(e.x), my = Math.floor(e.y);

    // The blocked axis is arrested for as long as the enemy is on the wall's row.
    // (It is free to wall-follow OFF that row and legitimately go around, which
    // is why this is scoped to the row rather than to the coordinate globally.)
    if (my === 2) {
      onRowFrames++;
      if (!(e.x < faceX - CONFIG.ENEMY_RADIUS + 1e-9)) arrestedOnRow = false;
    }
    if (Level.isSolid(mx, my)) neverInSolid = false;
    if (Math.abs(mx - pmx) > 1 || Math.abs(my - pmy) > 1) neverSkippedCell = false;
    // X commits before Y, so the intermediate cell of a diagonal is (mx, pmy).
    if (mx !== pmx && my !== pmy && Level.isSolid(mx, pmy)) neverCutCorner = false;
  }
  assert(arrestedOnRow && onRowFrames > 0,
    '2a. ENEM-02: while on the wall\'s row the chasing enemy never gets past the face minus its ' +
    'radius — the blocked axis is arrested (' + onRowFrames + ' frames measured on the row)');
  assert(neverInSolid && neverSkippedCell && neverCutCorner,
    '2b. ENEM-02: across 120 frames the enemy never occupies a solid cell, never skips a cell on ' +
    'either axis, and never cuts a solid corner');

  // --- CONTROL 2c: the SAME positions with the wall cells temporarily open ---
  const restore = openCells(2, 9, 12);
  scenario(13.5, 2.5);
  const e2 = Enemies.add(8.5, 2.5);
  e2.state = Enemies.CHASE;
  e2.cooldown = 1e9;                 // keep it closing rather than standing to fire
  const d0 = distToPlayer(e2);
  for (let i = 0; i < 120; i++) Game.step(FRAME_DT);
  const d1 = distToPlayer(e2);
  restore();
  assert(d1 < d0 - 1 && d1 <= CONFIG.ENEMY_STOP_RANGE + 1e-6,
    '2c. CONTROL: with the wall cells opened the SAME enemy closes the distance ' +
    d0.toFixed(2) + ' -> ' + d1.toFixed(2) + ' — 2a/2b was the wall, not a broken chase');
})();

// ---------------------------------------------------------------------------
// 2d / 2e / 2f / 2g — SIGHT GATING. 2e and 2f are a DISTANCE-MATCHED pair: the
// same enemy, at the same position, at the same 11-cell distance. The ONLY
// difference is one cell of wall, so the pair isolates line of sight exactly.
// ---------------------------------------------------------------------------
(function () {
  const D = 11;   // (2.5,4.5) -> (13.5,4.5) along the fully open row 4

  // --- 2d/2e: sight BLOCKED by a single cell -> idle forever ---------------
  const restore = setCell(9, 4, Level.STONE_ID);
  scenario(2.5, 4.5);
  const e = Enemies.add(13.5, 4.5);
  assert(near(distToPlayer(e), D, 1e-9) && distToPlayer(e) < CONFIG.ENEMY_SIGHT_RANGE &&
    Level.lineOfSight(e.x, e.y, Player.x, Player.y) === false,
    '2d. precondition: the enemy is ' + D + ' cells away — INSIDE ENEMY_SIGHT_RANGE (' +
    CONFIG.ENEMY_SIGHT_RANGE + ') — with exactly one cell of wall blocking sight');

  const bx = e.x, by = e.y;
  let stayedIdle = true;
  for (let i = 0; i < 120; i++) {
    Game.step(FRAME_DT);
    if (e.state !== Enemies.IDLE) stayedIdle = false;
  }
  assert(stayedIdle && e.x === bx && e.y === by && spawnLog.length === 0,
    '2e. ENEM-01: 120 frames with sight blocked leave the enemy idle, unmoved and silent');
  restore();

  // --- 2f: the CONTROL. Same enemy, same distance, wall removed -----------
  scenario(2.5, 4.5);
  const e2 = Enemies.add(13.5, 4.5);
  assert(near(distToPlayer(e2), D, 1e-9) &&
    Level.lineOfSight(e2.x, e2.y, Player.x, Player.y) === true,
    '2f-i. CONTROL precondition: the SAME position at the SAME ' + D +
    '-cell distance now has clear sight (only the one wall cell changed)');
  let woke = -1;
  for (let i = 0; i < 10 && woke < 0; i++) {
    Game.step(FRAME_DT);
    if (e2.state === Enemies.CHASE) woke = i;
  }
  assert(woke >= 0,
    '2f-ii. CONTROL: with sight clear the enemy enters chase within 10 frames (frame ' + woke +
    ') — the idle in 2e was the SIGHT gate');

  // --- 2g: the SECOND control. Clear sight, but BEYOND sight range ---------
  scenario(2.5, 4.5);
  const e3 = Enemies.add(16.5, 4.5);
  assert(distToPlayer(e3) > CONFIG.ENEMY_SIGHT_RANGE &&
    Level.lineOfSight(e3.x, e3.y, Player.x, Player.y) === true,
    '2g-i. precondition: clear sight at ' + distToPlayer(e3).toFixed(1) +
    ' cells — BEYOND ENEMY_SIGHT_RANGE (' + CONFIG.ENEMY_SIGHT_RANGE + ')');
  let stayedIdleFar = true;
  for (let i = 0; i < 120; i++) {
    Game.step(FRAME_DT);
    if (e3.state !== Enemies.IDLE) stayedIdleFar = false;
  }
  assert(stayedIdleFar,
    '2g-ii. ENEM-01: clear sight BEYOND sight range still leaves the enemy idle — the RANGE test ' +
    'is real and is not subsumed by the sight test');
})();

// ---------------------------------------------------------------------------
// 2h — ATTACK COOLDOWN. The firing rate is the cooldown, not the frame rate.
// ---------------------------------------------------------------------------
(function () {
  scenario(2.5, 2.5);
  const e = Enemies.add(6.5, 2.5);
  assert(distToPlayer(e) <= CONFIG.ENEMY_ATTACK_RANGE &&
    Level.lineOfSight(e.x, e.y, Player.x, Player.y) === true,
    '2h-i. precondition: the enemy is inside ENEMY_ATTACK_RANGE with clear sight');

  const SECONDS = 10;
  const frames = Math.round(SECONDS / FRAME_DT);
  for (let i = 0; i < frames; i++) Game.step(FRAME_DT);
  const shots = spawnLog.length;

  // The coarse contract: roughly one shot per cooldown, and emphatically NOT one
  // per frame.
  const coarse = Math.floor(SECONDS / CONFIG.ENEMY_ATTACK_COOLDOWN);
  assert(Math.abs(shots - coarse) <= 1,
    '2h. ENEM-01/ENEM-03: ' + shots + ' fireballs in ' + SECONDS + ' simulated seconds — within ' +
    'one of floor(N / ENEMY_ATTACK_COOLDOWN) = ' + coarse + ' (and nowhere near the ' + frames +
    ' frames driven)');

  // The exact model, derived from CONFIG: the first shot lands one windup after
  // the fight starts, and every subsequent shot one cooldown apart.
  const exact = Math.floor((SECONDS - CONFIG.ENEMY_ATTACK_WINDUP) / CONFIG.ENEMY_ATTACK_COOLDOWN) + 1;
  assert(Math.abs(shots - exact) <= 1,
    '2h-ii. the count also matches the exact CONFIG-derived model floor((N - WINDUP)/COOLDOWN)+1 = ' +
    exact + ' within one');
})();

// ---------------------------------------------------------------------------
// 2i — NO SIGHT, NO ATTACK (threat T-05-07), with a matched control.
// The enemy is parked at exactly ENEMY_STOP_RANGE behind the one-cell pillar at
// (6,6), so it does not move at all and its cooldown elapses repeatedly.
// ---------------------------------------------------------------------------
(function () {
  scenario(7.5, 6.5);
  const e = Enemies.add(5.5, 6.5);
  e.state = Enemies.CHASE;
  e.cooldown = 0.1;                 // so "the cooldown elapsed" is observable

  assert(Level.isSolid(6, 6) && near(distToPlayer(e), CONFIG.ENEMY_STOP_RANGE, 1e-9) &&
    Level.lineOfSight(e.x, e.y, Player.x, Player.y) === false,
    '2i-i. precondition: a chasing enemy at exactly ENEMY_STOP_RANGE with the (6,6) pillar ' +
    'blocking sight');

  const frames = 120;                                   // 2 s > ENEMY_ATTACK_COOLDOWN
  for (let i = 0; i < frames; i++) Game.step(FRAME_DT);
  assert(spawnLog.length === 0 && e.cooldown === 0 &&
    frames * FRAME_DT > CONFIG.ENEMY_ATTACK_COOLDOWN,
    '2i. ENEM-03: a CHASING enemy with sight blocked spawns ZERO projectiles across ' + frames +
    ' frames even though its cooldown fully elapsed');

  // CONTROL: move the player to a clear-sight position at the SAME distance —
  // straight NORTH of the enemy instead of straight through the pillar. Nothing
  // else changes: same enemy object, same state, same elapsed cooldown.
  Player.x = e.x; Player.y = e.y - CONFIG.ENEMY_STOP_RANGE;
  assert(Level.lineOfSight(e.x, e.y, Player.x, Player.y) === true &&
    near(distToPlayer(e), CONFIG.ENEMY_STOP_RANGE, 1e-9),
    '2i-ii. CONTROL precondition: sight restored at the SAME distance');
  for (let i = 0; i < 120 && spawnLog.length === 0; i++) Game.step(FRAME_DT);
  assert(spawnLog.length > 0,
    '2i-iii. CONTROL: the SAME enemy fires as soon as sight is restored — the silence above was ' +
    'the SIGHT gate, not a broken attack');
})();

// ---------------------------------------------------------------------------
// 2j / 2k / 2l — PROJECTILE WALL DESPAWN, with the wall-removed control.
// The projectile is seeded directly into the pool and advanced through
// Enemies.updateProjectiles, which isolates the projectile contract from the AI.
// ---------------------------------------------------------------------------
(function () {
  function fireEast(fromX, fromY) {
    const p = Enemies.projectiles[0];
    p.x = fromX; p.y = fromY;
    p.vx = CONFIG.PROJ_SPEED; p.vy = 0;
    p.damage = CONFIG.PROJ_DAMAGE;
    p.active = true;
    return p;
  }

  // The player is parked far away in the south chamber so no proof here can be
  // confused by a player hit.
  scenario(3.5, 16.5);
  let p = fireEast(8.0, 2.5);
  let maxX = p.x;
  for (let i = 0; i < 200 && p.active; i++) {
    Enemies.updateProjectiles(FRAME_DT);
    if (p.x > maxX) maxX = p.x;
  }
  assert(p.active === false,
    '2j. ENEM-03: a fireball flown into the row-2 wall DEACTIVATES and returns to the pool');
  assert(p.x >= 9 && p.x < 10 && maxX < 13,
    '2k. it stops inside the FIRST wall cell it entered (x ' + p.x.toFixed(3) +
    ') and never reaches the far side (max x ' + maxX.toFixed(3) + ' < 13)');

  // --- CONTROL 2l: the identical shot with the wall cells open -------------
  const restore = openCells(2, 9, 12);
  scenario(3.5, 16.5);
  p = fireEast(8.0, 2.5);
  let reachedFarSide = false;
  for (let i = 0; i < 90 && p.active; i++) {
    Enemies.updateProjectiles(FRAME_DT);
    if (p.active && p.x > 13) reachedFarSide = true;
  }
  restore();
  assert(reachedFarSide,
    '2l. CONTROL: with the wall cells opened the SAME shot flies past x=13 and stays active — ' +
    '2j/2k was the wall, not a projectile that dies on its own');
})();

// ---------------------------------------------------------------------------
// 2m — NO TUNNELING. The arithmetic half is derived from CONFIG; the empirical
// half drives a projectile at the DELTA CLAMP straight at a ONE-CELL pillar.
// ---------------------------------------------------------------------------
(function () {
  const stepAtClamp = CONFIG.PROJ_SPEED * CONFIG.DT_MAX;
  assert(stepAtClamp < 1.0 && stepAtClamp > 0,
    '2m-i. the per-frame projectile step at CONFIG.DT_MAX is ' + stepAtClamp.toFixed(3) +
    ' cells — strictly under the one-cell wall thickness (derived, not hardcoded)');

  assert(Level.isSolid(6, 6) && !Level.isSolid(5, 6) && !Level.isSolid(7, 6),
    '2m-ii. precondition: (6,6) is a ONE-cell-thick pillar with open floor on both sides');

  scenario(3.5, 16.5);
  const p = Enemies.projectiles[0];
  p.x = 5.0; p.y = 6.5; p.vx = CONFIG.PROJ_SPEED; p.vy = 0;
  p.damage = CONFIG.PROJ_DAMAGE; p.active = true;
  let everPastPillar = false;
  for (let i = 0; i < 60 && p.active; i++) {
    Enemies.updateProjectiles(CONFIG.DT_MAX);   // the WORST legal delta
    if (p.x >= 7) everPastPillar = true;
  }
  assert(p.active === false && !everPastPillar,
    '2m-iii. ENEM-03 (T-05-05): driven at DT_MAX a projectile cannot skip the one-cell pillar — ' +
    'it deactivated at x ' + p.x.toFixed(3) + ' and never appeared on the far side');
})();

// ---------------------------------------------------------------------------
// 2n / 2o / 2p — THE ARMOR FRACTION at three armor levels (PICK-02, D-04).
// ---------------------------------------------------------------------------
(function () {
  const DMG = CONFIG.PROJ_DAMAGE;                                   // 12
  const share = Math.floor(DMG / CONFIG.ARMOR_ABSORB_DIVISOR);      // 4

  // 2n — plenty of armor: the full fraction is absorbed.
  Combat.reset();
  Combat.armor = 50;
  let lost = Combat.damagePlayer(DMG);
  assert(Combat.armor === 50 - share && lost === DMG - share &&
    Combat.health === CONFIG.PLAYER_START_HEALTH - (DMG - share),
    '2n. PICK-02: armor 50 vs a ' + DMG + '-damage hit absorbs exactly floor(' + DMG + '/' +
    CONFIG.ARMOR_ABSORB_DIVISOR + ') = ' + share + ' -> armor ' + Combat.armor + ', health lost ' + lost);

  // 2o — barely any armor: absorption CLAMPS to what is left.
  Combat.reset();
  Combat.armor = 1;
  lost = Combat.damagePlayer(DMG);
  assert(Combat.armor === 0 && lost === DMG - 1 &&
    Combat.health === CONFIG.PLAYER_START_HEALTH - (DMG - 1),
    '2o. PICK-02: armor 1 CLAMPS absorption to 1 (not ' + share + ') -> armor 0, health lost ' + lost);

  // 2p — no armor: the whole hit lands on health.
  Combat.reset();
  Combat.armor = 0;
  lost = Combat.damagePlayer(DMG);
  assert(Combat.armor === 0 && lost === DMG &&
    Combat.health === CONFIG.PLAYER_START_HEALTH - DMG,
    '2p. PICK-02: armor 0 puts the FULL ' + DMG + ' damage on health');

  // Guards: nothing non-positive or non-finite may mutate anything.
  Combat.reset();
  const snap = [Combat.health, Combat.armor, Combat.totalDamageTaken, Combat.lastDamageAt];
  const rets = [Combat.damagePlayer(0), Combat.damagePlayer(-5), Combat.damagePlayer(NaN),
                Combat.damagePlayer(Infinity), Combat.damagePlayer(0.4)];
  const allZero = rets.every((r) => r === 0);
  assert(allZero && Combat.health === snap[0] && Combat.armor === snap[1] &&
    Combat.totalDamageTaken === snap[2] && Combat.lastDamageAt === snap[3],
    '2p-ii. damagePlayer(0 / -5 / NaN / Infinity / 0.4) all return 0 and mutate NOTHING (T-05-06)');
})();

// ---------------------------------------------------------------------------
// 2q — THE DEATH LATCH.
// ---------------------------------------------------------------------------
(function () {
  Combat.reset();
  const lost = Combat.damagePlayer(CONFIG.PLAYER_START_HEALTH * 10);
  assert(Combat.health === 0 && Combat.dead === true && lost === CONFIG.PLAYER_START_HEALTH,
    '2q-i. D-04: overkill clamps health to EXACTLY 0, latches the dead flag, and reports only the ' +
    'health actually lost (' + lost + ')');

  const snap = [Combat.health, Combat.armor, Combat.totalDamageTaken, Combat.lastDamageAt];
  const again = Combat.damagePlayer(50);
  assert(again === 0 && Combat.health === snap[0] && Combat.armor === snap[1] &&
    Combat.totalDamageTaken === snap[2] && Combat.lastDamageAt === snap[3],
    '2q-ii. further damage to a dead player returns 0 and changes nothing');
})();

// ---------------------------------------------------------------------------
// 2r — POOL DISCIPLINE (threat T-05-03). Ten seconds of continuous attacking
// must not grow Entities.list by a single entry.
// ---------------------------------------------------------------------------
(function () {
  scenario(2.5, 2.5);
  Enemies.add(6.5, 2.5);
  const listBefore = Entities.list.length;
  let maxActive = 0, everNull = false;
  for (let i = 0; i < 600; i++) {
    Game.step(FRAME_DT);
    const a = activeProjectiles();
    if (a > maxActive) maxActive = a;
  }
  for (const rec of spawnLog) if (rec.p === null) everNull = true;
  assert(Entities.list.length === listBefore,
    '2r-i. T-05-03: after 600 frames of continuous attacking Entities.list is UNCHANGED (' +
    listBefore + ') — nothing allocates per frame');
  assert(maxActive <= CONFIG.PROJ_POOL && Enemies.projectiles.length === CONFIG.PROJ_POOL,
    '2r-ii. the active projectile count never exceeded CONFIG.PROJ_POOL (peak ' + maxActive +
    ' of ' + CONFIG.PROJ_POOL + ') and the pool never grew');
  assert(spawnLog.length > 0 && !everNull,
    '2r-iii. CONTROL (non-vacuity): ' + spawnLog.length + ' shots were actually fired during the ' +
    'run and none exhausted the pool');
})();

// ---------------------------------------------------------------------------
// 2s — THE DELTA GUARD (threat T-05-02).
// ---------------------------------------------------------------------------
(function () {
  scenario(2.5, 2.5);
  const e = Enemies.add(6.5, 2.5);
  e.state = Enemies.CHASE;
  Game.step(FRAME_DT);                       // get it genuinely mid-behaviour

  const p = Enemies.projectiles[0];
  p.x = 5.0; p.y = 2.5; p.vx = CONFIG.PROJ_SPEED; p.vy = 0;
  p.damage = CONFIG.PROJ_DAMAGE; p.active = true;

  const snapE = [e.x, e.y, e.state, e.health, e.cooldown, e.windup, e.animTime, e.stuck];
  const snapP = [p.x, p.y, p.vx, p.vy, p.active];

  for (const bad of [NaN, Infinity, -Infinity, -1, -0.016]) {
    Enemies.update(bad);
    Enemies.updateProjectiles(bad);
  }
  const enemyIntact = e.x === snapE[0] && e.y === snapE[1] && e.state === snapE[2] &&
    e.health === snapE[3] && e.cooldown === snapE[4] && e.windup === snapE[5] &&
    e.animTime === snapE[6] && e.stuck === snapE[7];
  const projIntact = p.x === snapP[0] && p.y === snapP[1] && p.vx === snapP[2] &&
    p.vy === snapP[3] && p.active === snapP[4];
  assert(enemyIntact && projIntact,
    '2s. T-05-02: Enemies.update / updateProjectiles with a non-finite or negative dt leave every ' +
    'enemy field and every projectile field BYTE-IDENTICAL');
})();

// ---------------------------------------------------------------------------
// 2t / 2u — A DEAD PLAYER IS INERT WHILE THE WORLD KEEPS SIMULATING (D-04).
// ---------------------------------------------------------------------------
(function () {
  const HELD = { forward: 1, strafe: 1, turn: 1, mouseDX: 40, run: true };

  scenario(3.5, 3.5);
  const e = Enemies.add(7.5, 3.5);
  e.state = Enemies.CHASE;
  e.cooldown = 1e9;                      // pure chase, so "the enemy moved" is clean

  Combat.damagePlayer(CONFIG.PLAYER_START_HEALTH * 10);
  assert(Combat.dead === true, '2t-i. precondition: the player is dead');

  setIntent(HELD);
  const px = Player.x, py = Player.y, pdx = Player.dirX, pdy = Player.dirY;
  const ex = e.x, ey = e.y;
  for (let i = 0; i < 60; i++) Game.step(FRAME_DT);

  const frozen = Player.x === px && Player.y === py && Player.dirX === pdx && Player.dirY === pdy;
  const worldMoved = dist(ex, ey, e.x, e.y) > 0.1;
  assert(frozen,
    '2t. D-04: with a FULL movement-and-turn intent held for 60 frames a dead player\'s x, y, dirX ' +
    'and dirY are all byte-identical to the moment of death');
  assert(worldMoved,
    '2t-ii. and the world kept simulating around it — the enemy moved ' +
    dist(ex, ey, e.x, e.y).toFixed(3) + ' cells over the same run (this is not a frozen simulation)');

  // --- CONTROL 2u: the identical held intent on a LIVE player --------------
  scenario(3.5, 3.5);
  setIntent(HELD);
  const lx = Player.x, ly = Player.y, ldx = Player.dirX, ldy = Player.dirY;
  for (let i = 0; i < 60; i++) Game.step(FRAME_DT);
  const moved = dist(lx, ly, Player.x, Player.y);
  const turned = Player.dirX !== ldx || Player.dirY !== ldy;
  assert(moved > 0.1 && turned,
    '2u. CONTROL: the IDENTICAL held intent on a live player moves it ' + moved.toFixed(3) +
    ' cells and turns it — the freeze above was the dead flag');
})();

// ---------------------------------------------------------------------------
// 2v / 2w — CORRIDOR NAVIGATION with a 0.70-cell footprint in a ONE-cell
// corridor, on-centre (2v) and OFF-centre (2w). The frame budget is DERIVED from
// CONFIG, and "reached the player" is paired with "actually traversed the
// corridor" so stalling at the mouth cannot pass.
// ---------------------------------------------------------------------------
(function () {
  // Frames needed to walk `cells` at ENEMY_SPEED, times a generous slack factor
  // (the enemy also stands still through each attack windup en route).
  function budget(cells) {
    return Math.ceil(cells / (CONFIG.ENEMY_SPEED * FRAME_DT)) * 3;
  }

  // corridorName, enemy start, player, the y the enemy must pass to have
  // traversed the corridor.
  const runs = [
    { name: 'column 4 (rows 9-14)',  ex: 4.5,  ey: 8.5, px: 4.5,  py: 17.5, exitY: 15, centred: true },
    { name: 'column 18 (rows 8-16)', ex: 18.5, ey: 7.5, px: 18.5, py: 17.5, exitY: 15, centred: true },
    { name: 'column 4, OFF-centre',  ex: 3.5,  ey: 8.5, px: 4.5,  py: 17.5, exitY: 15, centred: false },
    { name: 'column 18, OFF-centre', ex: 17.5, ey: 7.5, px: 18.5, py: 17.5, exitY: 15, centred: false }
  ];

  for (const r of runs) {
    scenario(r.px, r.py);
    const e = Enemies.add(r.ex, r.ey);
    // An off-centre enemy has NO sight line into the corridor from its start
    // cell, so it is already hunting: the property under test is navigation, not
    // acquisition (2d-2g own acquisition).
    if (!r.centred) e.state = Enemies.CHASE;

    const startDist = distToPlayer(e);
    const frames = budget(startDist - CONFIG.ENEMY_STOP_RANGE + 2);
    let neverInSolid = true;
    let reached = -1;
    for (let i = 0; i < frames; i++) {
      Game.step(FRAME_DT);
      if (Level.isSolid(Math.floor(e.x), Math.floor(e.y))) neverInSolid = false;
      if (reached < 0 && distToPlayer(e) <= CONFIG.ENEMY_ATTACK_RANGE && e.y >= r.exitY) reached = i;
    }
    const label = r.centred ? '2v' : '2w';
    assert(reached >= 0 && neverInSolid,
      label + '. ENEM-02: ' + r.name + ' — the enemy traversed the one-cell corridor (past y=' +
      r.exitY + ', final y ' + e.y.toFixed(2) + ') and reached ENEMY_ATTACK_RANGE of the player at ' +
      'frame ' + reached + ' of a CONFIG-derived budget of ' + frames + ', never entering a solid cell');
  }
})();

// ---------------------------------------------------------------------------
// 2x — THE CORNER RECOVERY IS REAL AND BOUNDED, with the zero-unstick control.
// The concave corner at (8,8): both (9,8) and (8,9) are solid, and the player is
// beyond it, so BOTH axes of the direct steer are walled.
// ---------------------------------------------------------------------------
(function () {
  assert(!Level.isSolid(8, 8) && Level.isSolid(9, 8) && Level.isSolid(8, 9),
    '2x-i. precondition: (8,8) is a concave corner — both (9,8) and (8,9) are solid');

  const windowFrames = Math.ceil(2 * CONFIG.ENEMY_UNSTICK_TIME / FRAME_DT);

  // --- The claim ----------------------------------------------------------
  scenario(18.5, 10.5);
  const e = Enemies.add(8.6, 8.6);
  e.state = Enemies.CHASE;
  e.cooldown = 1e9;
  let stuckFrame = -1, jx = 0, jy = 0;
  for (let i = 0; i < 20 && stuckFrame < 0; i++) {
    Game.step(FRAME_DT);
    if (e.stuck > 0) { stuckFrame = i; jx = e.x; jy = e.y; }
  }
  assert(stuckFrame >= 0,
    '2x-ii. an enemy pressed into the concave corner registers a POSITIVE stuck timer within a few ' +
    'frames (frame ' + stuckFrame + ')');

  for (let i = 0; i < windowFrames; i++) Game.step(FRAME_DT);
  const escaped = dist(jx, jy, e.x, e.y);
  assert(escaped > CONFIG.ENEMY_RADIUS,
    '2x-iii. T-05-04b: within two ENEMY_UNSTICK_TIME windows it moved ' + escaped.toFixed(3) +
    ' cells from where it jammed — further than ENEMY_RADIUS (' + CONFIG.ENEMY_RADIUS + ')');

  // --- The CONTROL: the recovery disabled, everything else identical ------
  const saved = CONFIG.ENEMY_UNSTICK_TIME;
  CONFIG.ENEMY_UNSTICK_TIME = 0;
  scenario(18.5, 10.5);
  const e2 = Enemies.add(8.6, 8.6);
  e2.state = Enemies.CHASE;
  e2.cooldown = 1e9;
  for (let i = 0; i < 5; i++) Game.step(FRAME_DT);   // let it settle onto the corner
  const cx = e2.x, cy = e2.y;
  let everStuck = false;
  for (let i = 0; i < windowFrames; i++) {
    Game.step(FRAME_DT);
    if (e2.stuck > 0) everStuck = true;
  }
  const crawled = dist(cx, cy, e2.x, e2.y);
  CONFIG.ENEMY_UNSTICK_TIME = saved;
  assert(!everStuck && crawled < CONFIG.ENEMY_RADIUS,
    '2x-iv. CONTROL: with ENEMY_UNSTICK_TIME forced to 0 the SAME enemy is still within a hair of ' +
    'its jam position after the same ' + windowFrames + ' frames (moved ' + crawled.toFixed(4) +
    ') — the RECOVERY freed it above, not the plain steer');
})();

// ---------------------------------------------------------------------------
// 2y — SIMULATED TIME ADVANCES UNDER A DIRECT STEP. Without this, every
// age-based proof in this phase (and 05-04's message ages) passes vacuously
// against a frozen clock.
// ---------------------------------------------------------------------------
(function () {
  scenario(3.5, 3.5);
  const t0 = Game.time;
  const N = 37, dt = 0.011;
  for (let i = 0; i < N; i++) Game.step(dt);
  assert(near(Game.time - t0, N * dt, 1e-9),
    '2y-i. ' + N + ' DIRECT Game.step(' + dt + ') calls advanced Game.time by exactly N*dt (' +
    (Game.time - t0).toFixed(6) + ')');

  // Two damage events separated by stepped frames must carry strictly increasing
  // simulated timestamps.
  Combat.reset();
  Combat.damagePlayer(1);
  const a1 = Combat.lastDamageAt;
  for (let i = 0; i < 10; i++) Game.step(FRAME_DT);
  Combat.damagePlayer(1);
  const a2 = Combat.lastDamageAt;
  assert(a2 > a1,
    '2y-ii. Combat.lastDamageAt strictly increases across stepped frames (' + a1.toFixed(4) +
    ' -> ' + a2.toFixed(4) + ')');

  // CONTROL: with NO stepping in between, the stamp is the SAME — proving 2y-ii
  // measured the clock advancing and not merely a re-assignment.
  Combat.damagePlayer(1);
  const b1 = Combat.lastDamageAt;
  Combat.damagePlayer(1);
  const b2 = Combat.lastDamageAt;
  assert(b1 === b2 && b1 >= a2,
    '2y-iii. CONTROL: two damage calls with NO stepping between them record the SAME timestamp (' +
    b1.toFixed(4) + ') — 2y-ii measured real elapsed simulated time');
})();

finish('ALL_COMBAT_CONTRACTS_PASS');
