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

// SCENARIO SETUP (Phase 6, 06-01) — NOT an assertion change.
// The game now boots to a TITLE screen, and Game.frame gates the STEP on
// Game.state === playing (render and present stay unconditional). Every Phase 1-5
// scenario in this file is a GAMEPLAY scenario, so enter the playing state here,
// once, immediately after the boot. Game.step itself is deliberately UN-GATED, so
// the sections that drive it directly are unaffected either way; this line is what
// keeps the raf-driven drives advancing the simulation. tools/verify-state.cjs owns
// proving the gate (with a paired control that the same frames freeze in title).
h.sandbox.Game.setState('playing');

const s = h.sandbox;
const CONFIG = s.CONFIG;
const Level = s.Level;
const Player = s.Player;
const Game = s.Game;
const Entities = s.Entities;
const Enemies = s.Enemies;
const Combat = s.Combat;
const Weapons = s.Weapons;
const Raycaster = s.Raycaster;
const Framebuffer = s.Framebuffer;
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

// ---------------------------------------------------------------------------
// HOW MANY FRAMEBUFFER PIXELS DOES ONE ENTITY WRITE?
//
// Renders the world three times through the REAL Raycaster: once with an EMPTY
// entity list (walls and floor only), once with just this entity, and once with
// just this entity's `active` flag forced false. The difference against the
// background is the count of pixels that entity drew, and the forced-inactive
// render is the paired control that makes a non-zero count meaningful.
//
// The entity list is narrowed and the weapon overlay is lifted for the duration
// (the viewmodel draws over the bottom-centre — exactly where a floor-anchored
// corpse projects), and BOTH are restored before returning. Rendering directly
// through Raycaster.render() never presents, so the frame/present accounting the
// rest of this harness asserts is untouched.
// ---------------------------------------------------------------------------
function measureDrawn(entity) {
  const savedList = Entities.list;
  const savedOverlays = Raycaster.overlayPasses.slice();
  const savedActive = entity.active;
  Raycaster.overlayPasses.length = 0;

  function renderInto(list) {
    Entities.list = list;
    Entities._ensureScratch(Math.max(1, list.length));
    Raycaster.render();
    return Framebuffer.buf32.slice();
  }
  function diffCount(a, b) {
    let n = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
    return n;
  }

  const bg = renderInto([]);
  entity.active = true;
  const withIt = renderInto([entity]);
  entity.active = false;
  const without = renderInto([entity]);

  entity.active = savedActive;
  Entities.list = savedList;
  Entities._ensureScratch(savedList.length);
  for (const p of savedOverlays) Raycaster.overlayPasses.push(p);

  return {
    drawn: diffCount(bg, withIt),
    drawnInactive: diffCount(bg, without),
    restored: Entities.list === savedList &&
              Raycaster.overlayPasses.length === savedOverlays.length
  };
}

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

  // The snapshot covers EVERY mutable behaviour field, including 05-03's painTime
  // and deathFrame — a delta guard that misses a field is not a guard.
  const snapE = [e.x, e.y, e.state, e.health, e.cooldown, e.windup, e.animTime, e.stuck,
                 e.painTime, e.deathFrame];
  const snapP = [p.x, p.y, p.vx, p.vy, p.active];

  for (const bad of [NaN, Infinity, -Infinity, -1, -0.016]) {
    Enemies.update(bad);
    Enemies.updateProjectiles(bad);
  }
  const enemyIntact = e.x === snapE[0] && e.y === snapE[1] && e.state === snapE[2] &&
    e.health === snapE[3] && e.cooldown === snapE[4] && e.windup === snapE[5] &&
    e.animTime === snapE[6] && e.stuck === snapE[7] &&
    e.painTime === snapE[8] && e.deathFrame === snapE[9];
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

// ===========================================================================
// 3. THE PAIN REACTION (ENEM-04, plan 05-03 Task 1).
//
// The stagger is chance-based, so "it happened once" proves nothing. 3b is a real
// STATISTICAL check against CONFIG.ENEMY_PAIN_CHANCE over 200 independent hits,
// and 3c is the pair of controls that proves the roll is wired to the constant:
// forcing the chance to 0 must produce ZERO staggers and forcing it to 1 must
// stagger EVERY non-lethal hit. Without those two, 3b would pass against a
// hardcoded 0.3 that ignores CONFIG entirely.
// ===========================================================================

// A fresh full-health enemy at (x,y), added to the scenario's update set.
function freshEnemy(x, y) {
  const e = Enemies.add(x, y);
  e.state = Enemies.CHASE;
  e.cooldown = 1e9;               // park the attack gate unless a proof wants it
  return e;
}

// --- 3a: a non-lethal hit takes exactly the damage passed --------------------
(function () {
  scenario(2.5, 2.5);
  const e = freshEnemy(6.5, 2.5);
  const DMG = CONFIG.PISTOL_DAMAGE;
  assert(DMG < CONFIG.ENEMY_HEALTH,
    '3a-0. precondition: one PISTOL_DAMAGE hit (' + DMG + ') is NON-lethal against ENEMY_HEALTH (' +
    CONFIG.ENEMY_HEALTH + '), so 3a measures a survivable hit');

  const dealt = Enemies.hurt(e, DMG);
  assert(dealt === DMG && e.health === CONFIG.ENEMY_HEALTH - DMG && e.alive === true,
    '3a. ENEM-04: a non-lethal hit reduces health by EXACTLY the damage passed (' +
    CONFIG.ENEMY_HEALTH + ' -> ' + e.health + ') and the enemy stays alive');

  // Health never goes below zero, and the overkill report is only what was lost.
  const e2 = freshEnemy(7.5, 2.5);
  const lost = Enemies.hurt(e2, CONFIG.ENEMY_HEALTH * 10);
  assert(e2.health === 0 && lost === CONFIG.ENEMY_HEALTH,
    '3a-ii. overkill clamps health to EXACTLY 0 and reports only the ' + lost + ' actually lost');
})();

// --- 3b: the pain fraction matches CONFIG.ENEMY_PAIN_CHANCE -----------------
// Each of 200 fresh enemies takes ONE non-lethal hit, so every trial is
// independent and draws the next value from the deterministic stream. No reset
// happens inside the loop (a reset would re-seed and replay one draw 200 times).
(function () {
  scenario(2.5, 2.5);
  const N = 200;
  const DMG = 1;                          // emphatically non-lethal
  let painCount = 0;
  for (let i = 0; i < N; i++) {
    const e = Enemies.add(3.5, 3.5);
    e.state = Enemies.CHASE;
    Enemies.hurt(e, DMG);
    if (e.state === Enemies.PAIN) painCount++;
  }
  const frac = painCount / N;
  assert(Math.abs(frac - CONFIG.ENEMY_PAIN_CHANCE) <= 0.10,
    '3b. ENEM-04: over ' + N + ' independent non-lethal hits ' + painCount + ' staggered — a ' +
    'fraction of ' + frac.toFixed(3) + ', within 0.10 of CONFIG.ENEMY_PAIN_CHANCE (' +
    CONFIG.ENEMY_PAIN_CHANCE + ')');
})();

// --- 3c: the two CONTROLS that prove the roll reads the constant ------------
(function () {
  const saved = CONFIG.ENEMY_PAIN_CHANCE;
  const N = 60, DMG = 1;

  CONFIG.ENEMY_PAIN_CHANCE = 0;
  scenario(2.5, 2.5);
  let painsAtZero = 0;
  for (let i = 0; i < N; i++) {
    const e = Enemies.add(3.5, 3.5);
    e.state = Enemies.CHASE;
    Enemies.hurt(e, DMG);
    if (e.state === Enemies.PAIN) painsAtZero++;
  }

  CONFIG.ENEMY_PAIN_CHANCE = 1;
  scenario(2.5, 2.5);
  let painsAtOne = 0;
  for (let i = 0; i < N; i++) {
    const e = Enemies.add(3.5, 3.5);
    e.state = Enemies.CHASE;
    Enemies.hurt(e, DMG);
    if (e.state === Enemies.PAIN) painsAtOne++;
  }
  CONFIG.ENEMY_PAIN_CHANCE = saved;

  assert(painsAtZero === 0 && painsAtOne === N,
    '3c. CONTROL PAIR: ENEMY_PAIN_CHANCE forced to 0 gives ' + painsAtZero + '/' + N +
    ' staggers and forced to 1 gives ' + painsAtOne + '/' + N + ' — the roll is wired to the ' +
    'CONFIG constant and read LIVE, not hardcoded');
  assert(CONFIG.ENEMY_PAIN_CHANCE === saved,
    '3c-ii. the shipped ENEMY_PAIN_CHANCE (' + saved + ') is restored after the controls');
})();

// --- 3d / 3f: the stagger freezes the enemy, then it resumes ----------------
(function () {
  const saved = CONFIG.ENEMY_PAIN_CHANCE;
  CONFIG.ENEMY_PAIN_CHANCE = 1;           // make the stagger certain, not lucky

  scenario(2.5, 2.5);
  const e = freshEnemy(6.5, 2.5);
  Enemies.hurt(e, 1);
  assert(e.state === Enemies.PAIN && near(e.painTime, CONFIG.ENEMY_PAIN_TIME, 1e-12),
    '3d-0. precondition: the hit staggered the enemy and armed the timer at ' +
    'CONFIG.ENEMY_PAIN_TIME (' + CONFIG.ENEMY_PAIN_TIME + ')');

  // Hold the pain window and watch: the pain frame, no movement, no projectile.
  const px = e.x, py = e.y;
  // Frames STRICTLY INSIDE the pain window, derived from CONFIG: one short of the
  // frame that would expire it, so this measurement is about the window's
  // interior and 3f below owns the expiry.
  const painFrames = Math.max(1, Math.ceil(CONFIG.ENEMY_PAIN_TIME / FRAME_DT) - 1);
  resetSpawnLog();
  let alwaysPainFrame = true, alwaysPainState = true, moved = false;
  for (let i = 0; i < painFrames; i++) {
    Game.step(FRAME_DT);
    if (e.sprite !== 'enemyPain') alwaysPainFrame = false;
    if (e.state !== Enemies.PAIN) alwaysPainState = false;
    if (e.x !== px || e.y !== py) moved = true;
  }
  assert(alwaysPainFrame && alwaysPainState && !moved && spawnLog.length === 0,
    '3d. ENEM-04: across the ' + painFrames + ' frames of the pain window the enemy holds the ' +
    'enemyPain frame, its position is BYTE-IDENTICAL, and it spawns no projectile');

  // 3f: the stagger EXPIRES back into chase and the enemy moves again.
  let resumed = -1;
  const totalFrames = Math.ceil(CONFIG.ENEMY_PAIN_TIME / FRAME_DT) + 2;
  for (let i = painFrames; i < totalFrames && resumed < 0; i++) {
    Game.step(FRAME_DT);
    if (e.state === Enemies.CHASE) resumed = i;
  }
  const rx = e.x, ry = e.y;
  for (let i = 0; i < 10; i++) Game.step(FRAME_DT);
  const movedAfter = dist(rx, ry, e.x, e.y);
  assert(resumed >= 0 && e.state === Enemies.CHASE && movedAfter > 0,
    '3f. ENEM-04: after CONFIG.ENEMY_PAIN_TIME the enemy is back in CHASE (frame ' + resumed +
    ' of ' + totalFrames + ') and moving again (' + movedAfter.toFixed(4) +
    ' cells over the next 10 frames) — the stagger is BRIEF, not a permanent freeze');

  CONFIG.ENEMY_PAIN_CHANCE = saved;
})();

// --- 3e: pain INTERRUPTS an attack windup ----------------------------------
// The enemy is caught mid-telegraph. The windup it was serving must produce
// NOTHING — with a matched control proving the identical windup, left alone,
// DOES fire.
(function () {
  const saved = CONFIG.ENEMY_PAIN_CHANCE;

  function windUp() {
    scenario(2.5, 2.5);
    const e = freshEnemy(6.5, 2.5);
    e.cooldown = 0;                       // let it enter the attack
    let entered = false;
    for (let i = 0; i < 30 && !entered; i++) {
      Game.step(FRAME_DT);
      if (e.state === Enemies.ATTACK && e.windup > 0) entered = true;
    }
    resetSpawnLog();
    return { e: e, entered: entered };
  }

  CONFIG.ENEMY_PAIN_CHANCE = 1;
  const a = windUp();
  assert(a.entered && a.e.windup > 0,
    '3e-0. precondition: the enemy is mid-windup with ' + a.e.windup.toFixed(4) + ' s left');
  Enemies.hurt(a.e, 1);
  const windupAfterHit = a.e.windup;
  for (let i = 0; i < 30; i++) Game.step(FRAME_DT);
  const firedAfterPain = spawnLog.length;

  // CONTROL: the identical windup, never interrupted.
  CONFIG.ENEMY_PAIN_CHANCE = saved;
  const b = windUp();
  assert(b.entered, '3e-ii. CONTROL precondition: the same setup reaches the windup again');
  for (let i = 0; i < 30; i++) Game.step(FRAME_DT);
  const firedUninterrupted = spawnLog.length;

  assert(windupAfterHit === 0 && firedAfterPain === 0 && firedUninterrupted > 0,
    '3e. ENEM-04 (T-05-19): a hit landing mid-windup ZEROES the windup and that attack fires ' +
    'NOTHING (' + firedAfterPain + ' projectiles), while the identical UNINTERRUPTED windup does ' +
    'fire (' + firedUninterrupted + ') — the stagger really interrupted an action');
})();

// --- 3g: pain does NOT reset the attack cooldown ---------------------------
(function () {
  const saved = CONFIG.ENEMY_PAIN_CHANCE;
  CONFIG.ENEMY_PAIN_CHANCE = 1;

  scenario(2.5, 2.5);
  const e = freshEnemy(6.5, 2.5);
  e.cooldown = CONFIG.ENEMY_ATTACK_COOLDOWN;      // freshly charged
  const before = e.cooldown;
  Enemies.hurt(e, 1);
  const after = e.cooldown;

  // Serve out the whole stagger and check the cooldown only ever ticked DOWN by
  // the elapsed time — it was never handed back to zero.
  const frames = Math.ceil(CONFIG.ENEMY_PAIN_TIME / FRAME_DT) + 1;
  resetSpawnLog();
  for (let i = 0; i < frames; i++) Game.step(FRAME_DT);
  const expected = before - frames * FRAME_DT;

  assert(after === before && near(e.cooldown, expected, 1e-9) && e.cooldown > 0 &&
    spawnLog.length === 0,
    '3g. ENEM-04 (T-05-19): the stagger leaves the cooldown UNTOUCHED at the moment of the hit (' +
    before.toFixed(4) + ' -> ' + after.toFixed(4) + ') and after the whole pain window it has only ' +
    'ticked down by the elapsed time (' + e.cooldown.toFixed(4) + ' ~ ' + expected.toFixed(4) +
    ', still > 0) with zero shots fired — shooting an enemy cannot buy it a free attack');

  CONFIG.ENEMY_PAIN_CHANCE = saved;
})();

// --- 3h: pain is NEVER entered on the killing blow ------------------------
(function () {
  const saved = CONFIG.ENEMY_PAIN_CHANCE;
  CONFIG.ENEMY_PAIN_CHANCE = 1;           // the worst case for this claim

  scenario(2.5, 2.5);
  // Exactly lethal, and a second enemy taken well past zero.
  const e = freshEnemy(6.5, 2.5);
  Enemies.hurt(e, CONFIG.ENEMY_HEALTH);
  const e2 = freshEnemy(7.5, 2.5);
  Enemies.hurt(e2, CONFIG.ENEMY_HEALTH * 3);

  // The CONTROL is in the same breath: one point less is non-lethal and DOES
  // stagger, so the difference is lethality and nothing else.
  const e3 = freshEnemy(8.5, 2.5);
  Enemies.hurt(e3, CONFIG.ENEMY_HEALTH - 1);

  assert(e.state === Enemies.DEATH && e2.state === Enemies.DEATH &&
    e.alive === false && e2.alive === false,
    '3h. ENEM-04: with the pain chance forced to 1, an exactly-lethal hit and an overkill hit BOTH ' +
    'go straight to the DEATH state (never pain) and clear the alive flag');
  assert(e3.state === Enemies.PAIN && e3.alive === true && e3.health === 1,
    '3h-ii. CONTROL: one point LESS damage, same forced chance, same call — the enemy survives on ' +
    '1 health and DOES stagger, so 3h measured lethality, not a broken roll');

  CONFIG.ENEMY_PAIN_CHANCE = saved;
})();

// --- 3i: hurt() on a dead or corpse enemy changes nothing at all ----------
(function () {
  const saved = CONFIG.ENEMY_PAIN_CHANCE;
  CONFIG.ENEMY_PAIN_CHANCE = 1;

  scenario(2.5, 2.5);
  const e = freshEnemy(6.5, 2.5);
  Enemies.hurt(e, CONFIG.ENEMY_HEALTH);           // kill it
  const snapDead = [e.health, e.alive, e.state, e.windup, e.painTime, e.x, e.y];
  const r1 = Enemies.hurt(e, 99);
  const deadIntact = e.health === snapDead[0] && e.alive === snapDead[1] &&
    e.state === snapDead[2] && e.windup === snapDead[3] && e.painTime === snapDead[4] &&
    e.x === snapDead[5] && e.y === snapDead[6];

  // Force it all the way to the corpse state and repeat.
  e.state = Enemies.CORPSE;
  e.sprite = 'enemyCorpse';
  const snapCorpse = [e.health, e.alive, e.state, e.sprite, e.painTime];
  const r2 = Enemies.hurt(e, 99);
  const corpseIntact = e.health === snapCorpse[0] && e.alive === snapCorpse[1] &&
    e.state === snapCorpse[2] && e.sprite === snapCorpse[3] && e.painTime === snapCorpse[4];

  assert(r1 === 0 && r2 === 0 && deadIntact && corpseIntact,
    '3i. ENEM-04: hurt() on an already-dead enemy and on a CORPSE both return 0 and leave every ' +
    'field byte-identical — the alive flag is the re-entry guard and a corpse can never be ' +
    'killed a second time');

  CONFIG.ENEMY_PAIN_CHANCE = saved;
})();

// ===========================================================================
// 4. THE DEATH ANIMATION, THE CORPSE AND THE KILL TALLY (ENEM-04/ENEM-05, plan
//    05-03 Task 2).
//
// The death animation is reachable at all ONLY because Enemies.update's skip
// predicate is the CORPSE STATE and never the `alive` flag: a lethal hit clears
// `alive`, so an alive-flag skip would refuse to update the very enemy the death
// branch is about. 4b/4c/4d are the assertions that would fail — silently and
// with nothing pointing at the cause — if that predicate were ever changed, so
// 4-0 pins it directly.
// ===========================================================================

// --- 4-0: the skip predicate itself, pinned ---------------------------------
(function () {
  scenario(2.5, 2.5);
  const e = Enemies.add(6.5, 2.5);
  e.alive = false;                        // not alive, but NOT a corpse
  e.state = Enemies.CHASE;
  const before = distToPlayer(e);
  for (let i = 0; i < 30; i++) Game.step(FRAME_DT);
  const movedWhileNotAlive = before - distToPlayer(e);

  const c = Enemies.add(8.5, 2.5);
  c.state = Enemies.CORPSE;
  const cx = c.x, cy = c.y;
  for (let i = 0; i < 30; i++) Game.step(FRAME_DT);

  assert(movedWhileNotAlive > 0 && c.x === cx && c.y === cy,
    '4-0. THE UPDATE SKIP IS THE CORPSE STATE, NOT THE ALIVE FLAG: an enemy with alive===false ' +
    'is STILL updated (it closed ' + movedWhileNotAlive.toFixed(3) + ' cells) while a CORPSE is ' +
    'skipped entirely (byte-identical position) — the death animation below is reachable');
})();

// --- 4a: the lethal transition, all on one call ----------------------------
(function () {
  scenario(2.5, 2.5);
  const e = freshEnemy(6.5, 2.5);
  Enemies.hurt(e, CONFIG.ENEMY_HEALTH * 4);
  assert(e.health === 0 && e.alive === false && e.state === Enemies.DEATH &&
    e.deathFrame === 0 && e.sprite === Enemies.DEATH_FRAMES[0],
    '4a. ENEM-04: a lethal hit sets health to EXACTLY 0, clears alive and sets the DEATH state on ' +
    'the SAME call, with the frame index at 0 and the first death frame already showing');
})();

// --- 4b: the three death frames play IN ORDER, each held ~DEATH_FRAME_TIME --
(function () {
  scenario(2.5, 2.5);
  const e = freshEnemy(6.5, 2.5);
  Enemies.hurt(e, CONFIG.ENEMY_HEALTH);

  // Record the sprite every frame and collapse it into the sequence of DISTINCT
  // consecutive frames, plus how long each was held.
  const seq = [];
  const held = [];
  for (let i = 0; i < 120; i++) {
    if (seq.length === 0 || seq[seq.length - 1] !== e.sprite) { seq.push(e.sprite); held.push(0); }
    held[held.length - 1] += 1;
    Game.step(FRAME_DT);
  }

  const expected = ['enemyDeath1', 'enemyDeath2', 'enemyDeath3', 'enemyCorpse'];
  const orderOk = seq.length === expected.length && seq.every((n, i) => n === expected[i]);
  assert(orderOk,
    '4b. ENEM-04: the sprite walks the three death frames IN ORDER and ends on the corpse — ' +
    'observed [' + seq.join(', ') + ']');

  // Each death frame held for approximately CONFIG.ENEMY_DEATH_FRAME_TIME, derived
  // from CONFIG rather than hardcoded.
  const expectFrames = CONFIG.ENEMY_DEATH_FRAME_TIME / FRAME_DT;
  const holdsOk = orderOk && held.slice(0, 3).every((n) => Math.abs(n - expectFrames) <= 1);
  assert(holdsOk,
    '4b-ii. each death frame is held for approximately CONFIG.ENEMY_DEATH_FRAME_TIME (' +
    expectFrames.toFixed(2) + ' frames at 60 fps) — observed holds ' + held.slice(0, 3).join('/'));

  // No repeat and no reverse: the four names are pairwise distinct, so no frame
  // was revisited anywhere in the run.
  assert(new Set(seq).size === seq.length,
    '4b-iii. no frame repeats and none reverses across the whole run — the ' + seq.length +
    ' observed frames are pairwise distinct (the animation plays exactly ONCE)');
})();

// --- 4c: the corpse is TERMINAL — 300 further frames change nothing --------
(function () {
  scenario(2.5, 2.5);
  const e = freshEnemy(6.5, 2.5);
  Enemies.hurt(e, CONFIG.ENEMY_HEALTH);
  // Run the fall out with a CONFIG-derived budget plus slack.
  const fallFrames = Math.ceil(
    Enemies.DEATH_FRAMES.length * CONFIG.ENEMY_DEATH_FRAME_TIME / FRAME_DT) + 2;
  for (let i = 0; i < fallFrames; i++) Game.step(FRAME_DT);

  assert(e.state === Enemies.CORPSE && e.sprite === 'enemyCorpse',
    '4c-i. after the sequence (' + fallFrames + ' frames, CONFIG-derived) the state is CORPSE and ' +
    'the sprite is the corpse frame');

  let stayedCorpse = true;
  for (let i = 0; i < 300; i++) {
    Game.step(FRAME_DT);
    if (e.state !== Enemies.CORPSE || e.sprite !== 'enemyCorpse') stayedCorpse = false;
  }
  assert(stayedCorpse && e.deathFrame === Enemies.DEATH_FRAMES.length,
    '4c. ENEM-04 (T-05-18): 300 FURTHER frames leave it in the corpse state on the corpse frame ' +
    'with the frame index latched at ' + e.deathFrame + ' — the death animation does NOT loop');
})();

// --- 4d: a corpse is still RENDERED, with the inactive control -------------
// The corpse is a floor decal, not a despawn: `active` stays true and the sprite
// pass keeps drawing it. Measured as a framebuffer DIFF against the same frame
// with no corpse in the list, so the count is of pixels the CORPSE wrote.
(function () {
  scenario(2.5, 4.5, 1, 0);
  const e = Enemies.add(5.5, 4.5);
  e.alive = false;
  e.state = Enemies.CORPSE;
  e.sprite = 'enemyCorpse';

  assert(Level.lineOfSight(Player.x, Player.y, e.x, e.y) === true && e.active === true,
    '4d-0. precondition: the corpse stands 3 cells in front of the player in clear sight and its ' +
    'active flag is still TRUE (a corpse is a decal, not a despawn)');

  const m = measureDrawn(e);
  assert(m.drawn > 0,
    '4d. ENEM-04: the sprite pass DRAWS the corpse — ' + m.drawn + ' framebuffer pixels differ ' +
    'from the same frame with no corpse in the world');
  assert(m.drawnInactive === 0,
    '4d-ii. CONTROL: with the SAME corpse\'s active flag forced false the frame is byte-identical ' +
    'to the background (' + m.drawnInactive + ' pixels) — 4d measured a real draw, and `active` is ' +
    'genuinely what the sprite pass tests');
  assert(m.restored && e.active === true,
    '4d-iii. the overlay passes, the entity list and the corpse\'s active flag are all RESTORED ' +
    'after the pixel measurement');
})();

// --- 4e: a corpse never moves and never attacks ---------------------------
(function () {
  scenario(6.0, 4.5, 1, 0);
  const e = Enemies.add(5.5, 4.5);       // point-blank, clear sight
  e.alive = false;
  e.state = Enemies.CORPSE;
  e.sprite = 'enemyCorpse';
  e.cooldown = 0;                        // the attack gate is WIDE OPEN
  resetSpawnLog();

  assert(distToPlayer(e) < CONFIG.ENEMY_ATTACK_RANGE &&
    Level.lineOfSight(e.x, e.y, Player.x, Player.y) === true && e.cooldown === 0,
    '4e-0. precondition: the corpse is at ' + distToPlayer(e).toFixed(2) + ' cells — well inside ' +
    'ENEMY_ATTACK_RANGE — in clear sight with a fully elapsed cooldown');

  const bx = e.x, by = e.y, bs = e.sprite;
  for (let i = 0; i < 300; i++) Game.step(FRAME_DT);
  assert(e.x === bx && e.y === by && e.sprite === bs && e.cooldown === 0 &&
    spawnLog.length === 0 && Combat.health === CONFIG.PLAYER_START_HEALTH,
    '4e. ENEM-04 (T-05-17): across 300 frames with the player standing at point-blank range in ' +
    'clear sight the corpse\'s position is BYTE-IDENTICAL, it spawns ZERO projectiles, and the ' +
    'player takes no damage');
})();

// --- 4f: a corpse is NOT TARGETABLE, with a live-enemy control at the SAME
//         position (05-02's alive-only filter is what does this) --------------
(function () {
  scenario(2.5, 4.5, 1, 0);
  Weapons.reset();
  const corpse = Enemies.add(5.5, 4.5);
  corpse.alive = false;
  corpse.state = Enemies.CORPSE;
  corpse.sprite = 'enemyCorpse';
  corpse.health = 0;

  Weapons.fire();
  const corpseHits = Weapons.lastHitCount;
  const targetWasCorpse = Weapons.lastTarget === corpse;

  // THE CONTROL, in the same list and at the SAME position: a LIVE enemy on the
  // identical ray. If the shot connects with it, the miss above was the alive
  // filter and not a bad aim, a wall, or an out-of-range target.
  const live = Enemies.add(5.5, 4.5);
  Weapons.cooldown = 0;
  Weapons.fire();

  assert(corpseHits === 0 && !targetWasCorpse && Weapons.lastTarget !== corpse &&
    corpse.health === 0 && corpse.state === Enemies.CORPSE,
    '4f. ENEM-04 (T-05-17): a shot aimed straight at a corpse hits NOTHING (' + corpseHits +
    ' hits), Weapons.lastTarget is not the corpse, and the corpse is unchanged');
  assert(Weapons.lastTarget === live && Weapons.lastHitCount === 1 &&
    live.health === CONFIG.ENEMY_HEALTH - CONFIG.PISTOL_DAMAGE,
    '4f-ii. CONTROL: the IDENTICAL shot at a LIVE enemy in the SAME SPOT connects for exactly ' +
    'PISTOL_DAMAGE (health ' + live.health + ') — the corpse\'s immunity is the alive-flag TARGET ' +
    'filter, not a broken shot');
})();

// --- 4g: the tally increments EXACTLY once per death, overkill and all -----
(function () {
  scenario(2.5, 2.5);
  Game.resetStats();
  assert(Game.kills === 0, '4g-0. precondition: Game.kills starts at 0');

  const e = freshEnemy(6.5, 2.5);
  Enemies.hurt(e, CONFIG.PISTOL_DAMAGE);          // non-lethal: no kill
  const afterNonLethal = Game.kills;
  Enemies.hurt(e, CONFIG.ENEMY_HEALTH);           // lethal
  const afterKill = Game.kills;
  for (let i = 0; i < 5; i++) Enemies.hurt(e, CONFIG.ENEMY_HEALTH * 10);
  const afterOverkill = Game.kills;

  assert(afterNonLethal === 0 && afterKill === 1 && afterOverkill === 1,
    '4g. ENEM-05 (T-05-16): a non-lethal hit adds nothing, the lethal hit adds exactly 1, and FIVE ' +
    'further overkill hits leave Game.kills at ' + afterOverkill + ' — the increment lives inside ' +
    'the one branch that clears the alive flag and hurt() returns early for an enemy already dead');

  // And a shotgun-style multi-pellet blast on a single enemy still counts once.
  const e2 = freshEnemy(7.5, 2.5);
  const killsBefore = Game.kills;
  for (let i = 0; i < CONFIG.SHOTGUN_PELLETS; i++) Enemies.hurt(e2, CONFIG.ENEMY_HEALTH);
  assert(Game.kills === killsBefore + 1,
    '4g-ii. ' + CONFIG.SHOTGUN_PELLETS + ' lethal pellets landing on ONE enemy in the same blast ' +
    'count as exactly ONE kill');
})();

// --- 4h: the denominator is the spawn-derived enemy count ------------------
(function () {
  Enemies.build();
  const markers = enemyMarkerCount();
  assert(Game.totalKills === markers && markers > 0,
    '4h. ENEM-05: after Enemies.build() Game.totalKills (' + Game.totalKills + ') equals the number ' +
    'of enemy markers in Level.spawns (' + markers + ') — the tally is out of the REAL total');
  assert(Game.kills === 0,
    '4h-ii. Game.kills is 0 at build — a rebuild resurrects every enemy, so a carried-over tally ' +
    'would be counting the living');
})();

// --- 4i: clearing the level drives kills to totalKills EXACTLY ------------
(function () {
  Enemies.reset();
  Combat.reset();
  const total = Game.totalKills;
  assert(total === Enemies.list.length && Game.kills === 0,
    '4i-0. precondition: ' + total + ' spawn-derived enemies, tally at 0');

  for (const e of Enemies.list) Enemies.hurt(e, CONFIG.ENEMY_HEALTH * 10);
  assert(Game.kills === total && Game.kills === Game.totalKills,
    '4i. ENEM-05: killing EVERY enemy in the level drives Game.kills to exactly Game.totalKills (' +
    Game.kills + '/' + Game.totalKills + ')');

  // Every one of them settles into a corpse, and none of them is targetable.
  const fallFrames = Math.ceil(
    Enemies.DEATH_FRAMES.length * CONFIG.ENEMY_DEATH_FRAME_TIME / FRAME_DT) + 2;
  for (let i = 0; i < fallFrames; i++) Game.step(FRAME_DT);
  let allCorpses = true;
  for (const e of Enemies.list) {
    if (e.state !== Enemies.CORPSE || e.sprite !== 'enemyCorpse' ||
        e.alive !== false || e.active !== true) allCorpses = false;
  }
  assert(allCorpses,
    '4i-ii. every dead enemy settled into the corpse state on the corpse frame with alive false ' +
    'and active still TRUE (all ' + Enemies.list.length + ' of them keep rendering as floor decals)');
})();

// --- 4j: nothing allocates — the entity list is unchanged -----------------
(function () {
  Enemies.reset();
  Combat.reset();
  const listBefore = Entities.list.length;
  const poolBefore = Enemies.projectiles.length;
  for (const e of Enemies.list) Enemies.hurt(e, CONFIG.ENEMY_HEALTH * 10);
  for (let i = 0; i < 300; i++) Game.step(FRAME_DT);
  assert(Entities.list.length === listBefore && Enemies.projectiles.length === poolBefore,
    '4j. T-05-20: after every enemy has died and 300 further frames, Entities.list is UNCHANGED (' +
    listBefore + ') and the projectile pool never grew (' + poolBefore + ') — the death branch, ' +
    'the corpse and the pain roll all allocate nothing');
})();

// ===========================================================================
// 5. THE WHOLE COMBAT LOOP, IN ONE UNINTERRUPTED STEPPED-FRAME RUN.
//
// Every earlier section proves one mechanism in isolation. This one proves they
// compose: a single continuous drive through the REAL loop (h.raf.step, so
// Game.frame -> Game.step -> Enemies.update / updateProjectiles / Weapons.update
// AND the render/present path all run every frame) in which the enemy wakes,
// closes, telegraphs, throws a fireball that takes the player's health, is shot
// exactly as many times as its health requires, dies, is counted, and leaves a
// corpse that still renders and can never be shot again.
//
// NOTHING is poked except the actors' positions and the scripted player's INTENT.
// The intent changes on OBSERVED events, exactly as a real player's would: hold
// fire once you have been hit, stop firing once the thing is dead. It is one run
// throughout — no rebuild, no reset, no state written by hand.
// ===========================================================================
(function () {
  scenario(2.5, 4.5, 1, 0);
  Weapons.reset();
  Game.resetStats();

  const START = 6.5;                     // 4 cells: inside ATTACK_RANGE and SIGHT
  const e = Enemies.add(START, 4.5);
  const killShots = Math.ceil(CONFIG.ENEMY_HEALTH / CONFIG.PISTOL_DAMAGE);

  assert(e.state === Enemies.IDLE && e.health === CONFIG.ENEMY_HEALTH &&
    distToPlayer(e) <= CONFIG.ENEMY_ATTACK_RANGE &&
    Level.lineOfSight(e.x, e.y, Player.x, Player.y) === true &&
    Combat.health === CONFIG.PLAYER_START_HEALTH && Game.kills === 0,
    '5-0. precondition: a full-health IDLE enemy ' + distToPlayer(e).toFixed(1) + ' cells in front ' +
    'of a full-health player in clear sight, inside ENEMY_ATTACK_RANGE, tally at 0. The kill needs ' +
    'ceil(ENEMY_HEALTH / PISTOL_DAMAGE) = ceil(' + CONFIG.ENEMY_HEALTH + '/' +
    CONFIG.PISTOL_DAMAGE + ') = ' + killShots + ' shots');

  const framesBefore = Game.frames;
  const putBefore = h.putCount();
  const bulletsBefore = Combat.ammo.bullets;
  const shotsBefore = Weapons.shotsFired;
  resetSpawnLog();

  // The run. Phase A: the player watches (no fire) until it has been hit. Phase B:
  // the player holds fire until the enemy is dead. Phase C: fire released while
  // the fall plays out. One loop, one continuous stream of frames.
  let wokeF = -1, closedTo = distToPlayer(e), projF = -1, hurtF = -1;
  let firingF = -1, deathF = -1, corpseF = -1;
  let bulletsAtKill = -1, shotsAtKill = -1, killsAtDeath = -1;
  const aliveAfterShot = [];
  let prevShots = Weapons.shotsFired;
  let phase = 'A';
  setIntent(null);

  for (let f = 0; f < 900; f++) {
    raf.step(FRAME_MS);
    const d = distToPlayer(e);
    if (d < closedTo) closedTo = d;
    if (wokeF < 0 && e.state !== Enemies.IDLE) wokeF = f;
    if (projF < 0 && spawnLog.length > 0) projF = f;
    if (hurtF < 0 && Combat.health < CONFIG.PLAYER_START_HEALTH) hurtF = f;

    // Count each shot AS IT LANDS, so "not one shot fewer" is measured rather
    // than inferred: aliveAfterShot[n] is the enemy's alive flag right after the
    // (n+1)th shot resolved.
    if (Weapons.shotsFired > prevShots) {
      prevShots = Weapons.shotsFired;
      aliveAfterShot.push(e.alive);
    }

    if (phase === 'A' && hurtF >= 0) {
      phase = 'B';
      firingF = f;
      setIntent({ fire: true });         // shoot back
    }
    if (phase === 'B' && e.alive === false) {
      phase = 'C';
      deathF = f;
      bulletsAtKill = Combat.ammo.bullets;
      shotsAtKill = Weapons.shotsFired;
      killsAtDeath = Game.kills;
      setIntent(null);                   // stop shooting a dead enemy
    }
    if (corpseF < 0 && e.state === Enemies.CORPSE) corpseF = f;
    if (corpseF >= 0 && hurtF >= 0) break;
  }

  // --- the chain, in order --------------------------------------------------
  // It hunted and it closed by more than a whole cell, and it never came NEARER
  // than ENEMY_STOP_RANGE. It does not reach the stop range exactly here and is
  // not asked to: the fight kills it first, and it stands still through every
  // attack windup on the way in. 1d owns the exact landing-on-the-stop-range proof
  // in open space with the attack gate parked.
  const startDist = START - 2.5;
  assert(wokeF >= 0 && closedTo < startDist - 1 &&
    closedTo >= CONFIG.ENEMY_STOP_RANGE - 1e-9,
    '5a. the enemy WOKE at frame ' + wokeF + ' and CLOSED from ' + startDist.toFixed(2) + ' to ' +
    closedTo.toFixed(3) + ' cells — more than a full cell of hunting, and never nearer than ' +
    'ENEMY_STOP_RANGE (' + CONFIG.ENEMY_STOP_RANGE + ')');

  assert(projF > wokeF && hurtF > projF && Combat.health < CONFIG.PLAYER_START_HEALTH,
    '5b. it then FIRED (frame ' + projF + ', after waking) and the fireball took the player\'s ' +
    'health (frame ' + hurtF + ', after the shot) — ' + CONFIG.PLAYER_START_HEALTH + ' -> ' +
    Combat.health);

  const shotsUsed = shotsAtKill - shotsBefore;
  const notOneFewer = aliveAfterShot.length >= killShots &&
    aliveAfterShot.slice(0, killShots - 1).every((a) => a === true) &&
    aliveAfterShot[killShots - 1] === false;
  assert(shotsUsed === killShots && notOneFewer && deathF > firingF,
    '5c. the player then needed EXACTLY ' + killShots + ' pistol shots to kill it (frame ' + deathF +
    ', after opening fire at ' + firingF + ') — the enemy was still alive after each of the first ' +
    (killShots - 1) + ' shots [' + aliveAfterShot.slice(0, killShots).join(', ') + '], so not one ' +
    'shot fewer would have done it');

  assert(bulletsBefore - bulletsAtKill === killShots,
    '5d. WEAP-05: Combat.ammo.bullets fell by exactly those ' + killShots + ' shots (' +
    bulletsBefore + ' -> ' + bulletsAtKill + ') — no shot was free and none was double-charged');

  assert(killsAtDeath === 1 && Game.kills === 1 && Game.totalKills >= 1,
    '5e. ENEM-05: Game.kills is exactly 1 on the death frame and still 1 at the end of the run (' +
    Game.kills + ' of ' + Game.totalKills + ')');

  assert(corpseF > deathF && e.state === Enemies.CORPSE && e.sprite === 'enemyCorpse' &&
    e.active === true && e.alive === false,
    '5f. the fall PLAYED OUT and settled into a corpse at frame ' + corpseF + ' (after the death at ' +
    deathF + '): corpse state, corpse frame, active TRUE, alive FALSE');

  const m = measureDrawn(e);
  assert(m.drawn > 0 && m.drawnInactive === 0,
    '5g. the corpse STILL RENDERS at the end of the run — ' + m.drawn + ' pixels drawn, and 0 with ' +
    'its active flag forced false');

  // ...and it cannot be shot again. Same run, same corpse, a real Weapons.fire().
  Weapons.cooldown = 0;
  const bulletsPre = Combat.ammo.bullets;
  const killsPre = Game.kills;
  Weapons.fire();
  assert(Weapons.lastHitCount === 0 && Weapons.lastTarget !== e && Game.kills === killsPre &&
    e.health === 0 && e.state === Enemies.CORPSE &&
    Combat.ammo.bullets === bulletsPre - 1,
    '5h. ENEM-04/ENEM-05 (T-05-16/T-05-17): a real shot straight at the corpse hits nothing, does ' +
    'not touch the tally (' + Game.kills + '), and leaves the corpse untouched — while still ' +
    'costing the bullet it fired, because firing at nothing is not free');

  const framesRun = Game.frames - framesBefore;
  const putRun = h.putCount() - putBefore;
  assert(framesRun > 0 && putRun === framesRun,
    '5i. throughout the whole run the frame was presented exactly once per frame (' + putRun +
    ' presents / ' + framesRun + ' frames) — the death animation, the corpse and the tally never ' +
    'perturbed the single-blit-per-frame contract');
})();

finish('ALL_COMBAT_CONTRACTS_PASS');
