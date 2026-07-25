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

finish('ALL_COMBAT_CONTRACTS_PASS');
