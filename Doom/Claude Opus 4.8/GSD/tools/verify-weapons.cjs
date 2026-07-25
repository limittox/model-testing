/*
 * tools/verify-weapons.cjs — the Phase 5 HITSCAN WEAPON harness (05-02).
 *
 * NODE-ONLY (never referenced by index.html). Built on tools/boot.cjs: it boots
 * the SHIPPED script list in the SHIPPED order into one vm context with a stubbed
 * DOM, fires the window load event (main.js builds the level, spawns the player,
 * resets Combat + Weapons, wires the seams and starts the loop), then drives the
 * simulation deterministically.
 *
 * THREE DRIVERS, chosen per proof:
 *   - Weapons.fire() — a DIRECT shot with no cooldown and no loop. The geometry
 *     proofs (nearest target, perpendicular gate, wall stop, range) use it because
 *     they are statements about ONE ray resolution and nothing else.
 *   - Game.step(dt) — a direct simulation step with an exact delta. The GATE proofs
 *     (cooldown rate, the dead-player freeze, allocation) use it, because those are
 *     statements about the dispatch path Game.step owns.
 *   - h.raf.step(ms) — the REAL loop. The INTENT proof (1i) uses it exclusively, so
 *     what is under test is the actual keydown -> Input.readIntent -> Game.step ->
 *     Weapons.update chain plus the render/present path.
 *
 * FALSIFIABILITY DISCIPLINE (the idiom verify-sprites and verify-combat
 * established): every zero-result proof is PAIRED with a control that makes the
 * SAME measurement non-zero. "The wall blocked the shot" is worthless unless the
 * same shot, same harness, same measurement, provably CONNECTS once that one wall
 * cell is opened. Every expected number is DERIVED from the CONFIG constants so a
 * future retune cannot silently invalidate a proof.
 *
 * Prints PASS/FAIL per assertion and the terminal token ALL_WEAPON_CONTRACTS_PASS
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
const Weapons = s.Weapons;
const Input = s.Input;
const Sprites = s.Sprites;
const Raycaster = s.Raycaster;
const Framebuffer = s.Framebuffer;
const raf = h.raf;

// ---------------------------------------------------------------------------
// Harness helpers
// ---------------------------------------------------------------------------

const near = (a, b, tol) => Math.abs(a - b) <= tol;

const FRAME_MS = 1000 / 60;
const FRAME_DT = FRAME_MS / 1000;

// A scripted intent source so the harness — not a keyboard — decides what the
// player tries to do. Section 1i swaps the REAL Input back in for one proof.
const ZERO = { forward: 0, strafe: 0, turn: 0, mouseDX: 0, run: false, fire: false, weaponSlot: 0 };
const scriptedInput = {
  intent: ZERO,
  readIntent: function () { return this.intent; },
  reset: function () { this.intent = ZERO; }
};
function setIntent(o) {
  scriptedInput.intent = Object.assign(
    { forward: 0, strafe: 0, turn: 0, mouseDX: 0, run: false, fire: false, weaponSlot: 0 },
    o || {});
}
Game.input = scriptedInput;

// Drive N frames as DIRECT simulation steps (no render, exact delta).
function simFrames(n, dt) {
  const d = dt === undefined ? FRAME_DT : dt;
  for (let i = 0; i < n; i++) Game.step(d);
}

// Grid mutation for the wall-stop pair. Level.build() in scenario() restores the
// authored map exactly, so an opened cell can never leak into a later proof.
function setCell(mx, my, id) { Level.cells[my * Level.WIDTH + mx] = id; }
function cellOf(mx, my) { return Level.cells[my * Level.WIDTH + mx]; }

// A CLEAN SLATE. Rebuilds the authored map (undoing any opened cell), reseeds the
// player's combat state, rebuilds the entity world, and takes the level's own
// enemies OUT of both the AI update set and the hitscan TARGET set by truncating
// Enemies.list IN PLACE — every scenario composes its own targets with
// Enemies.add so distances are exact. Weapons.reset() runs LAST, after the player
// is placed, so the viewmodel's previous-position tracker does not see a jump.
function scenario(px, py, dx, dy) {
  Level.build();
  Combat.reset();
  Enemies.reset();
  Enemies.list.length = 0;
  Player.x = px;
  Player.y = py;
  Player.setDir(dx === undefined ? 1 : dx, dy === undefined ? 0 : dy);
  Weapons.reset();
  setIntent(null);
}

// ===========================================================================
// 0. THE MODULE EXISTS AND BOOT WIRED IT.
// ===========================================================================
(function () {
  assert(typeof Weapons === 'object' && Weapons !== null,
    '0a. Weapons global exists (js/weapons.js loaded in the shipped order)');
  assert(typeof Weapons.reset === 'function',
    '0b. Weapons.reset() is DEFINED — main.js calls it during boot, so an undefined ' +
    'call here would take the whole page down');
  assert(typeof Weapons.fire === 'function' && typeof Weapons.update === 'function' &&
    typeof Weapons.castRay === 'function' && typeof Weapons.wallDistance === 'function',
    '0c. the weapon API is present (fire / update / castRay / wallDistance)');
  // ZERO_INTENT is FROZEN and SHARED: any new intent field must exist on it too, or
  // a dead player's substituted intent would read `undefined` for that field.
  assert('fire' in Game.ZERO_INTENT && 'weaponSlot' in Game.ZERO_INTENT &&
    Game.ZERO_INTENT.fire === false && Game.ZERO_INTENT.weaponSlot === 0 &&
    Object.isFrozen(Game.ZERO_INTENT),
    '0d. Game.ZERO_INTENT carries fire:false and weaponSlot:0 and is still frozen');
  // Every weapon in the table spends a REAL Combat.ammo field and reads its numbers
  // from CONFIG (05-CONTEXT D-11: no magic numbers outside config.js).
  let tableOk = true, bad = null;
  for (const name in Weapons.TABLE) {
    const w = Weapons.TABLE[name];
    if (!(w.ammo in Combat.ammo)) { tableOk = false; bad = name + '/' + w.ammo; }
    if (!(w.pellets >= 1) || !(w.damage > 0) || !(w.cooldown > 0) || !(w.spread >= 0)) {
      tableOk = false; bad = name;
    }
  }
  assert(tableOk,
    '0e. every Weapons.TABLE entry has >=1 pellet, positive damage/cooldown and spends a ' +
    'real Combat.ammo field' + (tableOk ? '' : ' — offender ' + bad));
})();

// ===========================================================================
// 1. THE PISTOL: NEAREST-ENEMY HITSCAN, THE DDA WALL STOP, AMMO AND THE GATES.
//
//    GEOMETRY NOTE — every scenario below is anchored on the authored map, not on
//    searched coordinates:
//      row 4  is open floor from col 1 to col 22 (the east-west link), so a shot
//             along it has a clear 20-cell lane.
//      row 6  carries a SINGLE brick cell at col 6 ('%' in the authored source)
//             with open floor either side. That one cell is the wall-stop toggle:
//             the strongest form of the proof, because 1d and 1e differ by exactly
//             one map cell and nothing else.
// ===========================================================================

// --- 1a: one shot damages the enemy ahead and costs exactly one bullet -------
(function () {
  scenario(2.5, 4.5, 1, 0);
  const e = Enemies.add(7.5, 4.5);             // 5 cells dead ahead
  const h0 = e.health, b0 = Combat.ammo.bullets;

  const fired = Weapons.fire();

  assert(fired === true && h0 - e.health === CONFIG.PISTOL_DAMAGE &&
    b0 - Combat.ammo.bullets === 1,
    '1a. one pistol shot at an enemy 5 cells ahead removes exactly CONFIG.PISTOL_DAMAGE (' +
    CONFIG.PISTOL_DAMAGE + ', got ' + (h0 - e.health) + ') and exactly 1 bullet (got ' +
    (b0 - Combat.ammo.bullets) + ')');
  assert(Weapons.lastTarget === e && Weapons.lastHitCount === 1,
    '1a-ii. the shot recorded THAT enemy as lastTarget with lastHitCount 1');
})();

// --- 1b: NEAREST wins --------------------------------------------------------
(function () {
  scenario(2.5, 4.5, 1, 0);
  const nearE = Enemies.add(6.5, 4.5);         // 4 cells
  const farE = Enemies.add(10.5, 4.5);         // 8 cells, same bearing
  const hn = nearE.health, hf = farE.health;

  Weapons.fire();

  assert(hn - nearE.health === CONFIG.PISTOL_DAMAGE && farE.health === hf,
    '1b. NEAREST wins: with two enemies on the same bearing at 4 and 8 cells the shot ' +
    'damages ONLY the nearer (near -' + (hn - nearE.health) + ', far -' + (hf - farE.health) + ')');
})();

// --- 1c: the perpendicular-distance gate is real ------------------------------
//     IDENTICAL geometry to 1a — the enemy has not moved a millimetre. The ONLY
//     difference is that the player's aim is rotated 30 degrees off it, so 1a is
//     this assertion's control and vice versa.
(function () {
  scenario(2.5, 4.5, Math.cos(Math.PI / 6), Math.sin(Math.PI / 6));
  const e = Enemies.add(7.5, 4.5);
  const h0 = e.health;

  // The measurement being made: perpendicular offset 5*sin(30deg) = 2.5 cells,
  // which is far outside CONFIG.HITSCAN_TARGET_RADIUS.
  const perp = 5 * Math.sin(Math.PI / 6);
  Weapons.fire();

  assert(e.health === h0 && Weapons.lastHitCount === 0 && Weapons.lastTarget === null,
    '1c. an enemy 30 degrees off the aim line at the same 5-cell range takes NO damage ' +
    '(perpendicular offset ' + perp.toFixed(2) + ' cells > HITSCAN_TARGET_RADIUS ' +
    CONFIG.HITSCAN_TARGET_RADIUS + ') — the perpendicular gate is real');
})();

// --- 1d / 1e: THE WALL STOP AND ITS OPENED-WALL CONTROL ----------------------
//     One map cell is the only variable between these two assertions.
(function () {
  scenario(2.5, 6.5, 1, 0);
  const e = Enemies.add(7.5, 6.5);             // 5 cells ahead, wall cell (6,6) between
  const wallId = cellOf(6, 6);
  const h0 = e.health;

  // Sanity on the authored geometry, so a future map edit fails loudly here rather
  // than silently turning 1d into a vacuous pass.
  assert(wallId > 0 && Level.isSolid(6, 6) && !Level.isSolid(5, 6) && !Level.isSolid(7, 6),
    '1d-i. the authored map really has ONE solid cell at (6,6) with open floor either ' +
    'side (wall id ' + wallId + ') — the wall-stop toggle is genuine geometry');

  const wallDist = Weapons.wallDistance(Player.x, Player.y, Player.dirX, Player.dirY);
  assert(near(wallDist, 3.5, 1e-9),
    '1d-ii. Weapons.wallDistance along the aim ray is exactly 3.5 (the (6,6) face at ' +
    'x=6 from x=2.5), NEARER than the enemy at 5.0 — got ' + wallDist);

  Weapons.fire();
  assert(e.health === h0 && Weapons.lastHitCount === 0,
    '1d. WALL STOP: an enemy behind a solid cell on the aim line takes ZERO damage ' +
    '(you cannot shoot through walls — WEAP-02)');

  // --- 1e CONTROL: open that ONE cell and fire the identical shot ------------
  setCell(6, 6, 0);
  const h1 = e.health;
  const wallDist2 = Weapons.wallDistance(Player.x, Player.y, Player.dirX, Player.dirY);
  Weapons.fire();

  assert(h1 - e.health === CONFIG.PISTOL_DAMAGE,
    '1e. CONTROL for 1d: with that ONE map cell opened the IDENTICAL shot removes exactly ' +
    'CONFIG.PISTOL_DAMAGE (' + CONFIG.PISTOL_DAMAGE + ', got ' + (h1 - e.health) +
    ') — 1d measured OCCLUSION, not a missed target');
  assert(wallDist2 > 5.0,
    '1e-ii. with the cell opened the wall distance moved out to ' + wallDist2.toFixed(2) +
    ' (> the enemy at 5.0), which is exactly why the shot now connects');
})();

// --- 1f: the range gate is real ----------------------------------------------
//     NOTE (documented in 05-02-SUMMARY): the shipped CONFIG.HITSCAN_RANGE is 24
//     cells and the LONGEST clear line inside a 24x24 level is ~21 cells, so "an
//     enemy beyond the range" cannot be placed geometrically. The pair therefore
//     holds the geometry FIXED and varies the CONSTANT around it — which proves
//     something slightly stronger: the range is read from CONFIG live, at shot
//     time, not captured at load.
(function () {
  scenario(2.5, 4.5, 1, 0);
  const e = Enemies.add(7.5, 4.5);             // fixed at 5 cells
  const savedRange = CONFIG.HITSCAN_RANGE;

  CONFIG.HITSCAN_RANGE = 4.0;                  // enemy is BEYOND the range
  const h0 = e.health;
  Weapons.fire();
  const blocked = (e.health === h0);

  CONFIG.HITSCAN_RANGE = 6.0;                  // same enemy, now INSIDE the range
  const h1 = e.health;
  Weapons.fire();
  const connected = (h1 - e.health === CONFIG.PISTOL_DAMAGE);

  CONFIG.HITSCAN_RANGE = savedRange;

  assert(blocked,
    '1f. an enemy at 5.0 cells with HITSCAN_RANGE 4.0 takes NO damage (the range gate is real)');
  assert(connected,
    '1f-ii. CONTROL: the SAME enemy at the SAME 5.0 cells with HITSCAN_RANGE 6.0 takes ' +
    'exactly CONFIG.PISTOL_DAMAGE — the range is read from CONFIG at shot time');
  assert(CONFIG.HITSCAN_RANGE === savedRange,
    '1f-iii. the harness restored CONFIG.HITSCAN_RANGE to its shipped value (' + savedRange + ')');
})();

// --- 1g: THE AMMO GATE — empty must not fire AND must not eat the cooldown ---
(function () {
  scenario(2.5, 4.5, 1, 0);
  const e = Enemies.add(7.5, 4.5);
  Combat.ammo.bullets = 0;
  const h0 = e.health;
  const dry0 = Weapons.dryFires;

  const fired = Weapons.fire();

  assert(fired === false && e.health === h0 && Combat.ammo.bullets === 0,
    '1g. AMMO GATE: with bullets at 0 a fire attempt damages nothing and leaves bullets ' +
    'at 0 (WEAP-05)');
  assert(Weapons.cooldown === 0,
    '1g-ii. a refused shot leaves the cooldown at 0 — an empty gun does not silently ' +
    'lock the player out of firing once they reload (got ' + Weapons.cooldown + ')');
  assert(Weapons.dryFires - dry0 === 1 && Weapons.lastDryFire === true,
    '1g-iii. the refused shot was RECORDED as a dry fire (Phase 6 gets a real event to ' +
    'hang the click sound on)');

  // CONTROL: one bullet, same geometry — it fires, and NOW the cooldown is charged.
  Combat.ammo.bullets = 1;
  const h1 = e.health;
  const firedNow = Weapons.fire();
  assert(firedNow === true && h1 - e.health === CONFIG.PISTOL_DAMAGE &&
    Combat.ammo.bullets === 0 && near(Weapons.cooldown, CONFIG.PISTOL_COOLDOWN, 1e-12),
    '1g-iv. CONTROL: with ONE bullet the identical attempt fires, damages, empties the ' +
    'magazine and charges the cooldown to CONFIG.PISTOL_COOLDOWN');
})();

// --- 1h: THE COOLDOWN rate-limits a held trigger -----------------------------
(function () {
  scenario(2.5, 4.5, 1, 0);
  Combat.ammo.bullets = 1000;                  // the cooldown, not ammo, is under test
  setIntent({ fire: true });

  const framesPerSecond = Math.round(1 / FRAME_DT);
  simFrames(framesPerSecond);                  // one simulated second of held fire

  const expected = Math.floor(1 / CONFIG.PISTOL_COOLDOWN);
  const shots = Weapons.shotsFired;

  assert(Math.abs(shots - expected) <= 1,
    '1h. COOLDOWN: one second of held fire produced ' + shots + ' shots, within one of ' +
    'floor(1/PISTOL_COOLDOWN) = ' + expected + ' — never one per frame');
  assert(shots < framesPerSecond / 2,
    '1h-ii. CONTROL (non-vacuity): ' + shots + ' shots is nowhere near the ' + framesPerSecond +
    ' frames driven, so the rate limit genuinely bit');
  setIntent(null);
})();

// --- 1i: THE INTENT PATH — a REAL keydown through the REAL loop ---------------
(function () {
  scenario(2.5, 4.5, 1, 0);
  const e = Enemies.add(7.5, 4.5);
  Game.input = Input;                          // the shipped intent source
  Input.reset();

  const b0 = Combat.ammo.bullets;
  h.dispatch('window', 'keydown', { code: 'Space' });

  // INTENT ONLY: the handler must have changed NOTHING but the held-key set.
  assert(Combat.ammo.bullets === b0 && e.health === CONFIG.ENEMY_HEALTH,
    '1i-i. the fire keydown handler set INTENT ONLY — no ammo spent and no damage dealt ' +
    'before a single frame ran (D-07)');

  const h0 = e.health;
  for (let i = 0; i < 5; i++) raf.step(FRAME_MS);
  h.dispatch('window', 'keyup', { code: 'Space' });

  assert(Combat.ammo.bullets < b0 && h0 - e.health === CONFIG.PISTOL_DAMAGE,
    '1i. INTENT PATH: a real Space keydown dispatched through the boot harness, then ' +
    'stepped frames through the REAL loop, produces a shot that damages the enemy — ' +
    'Weapons.update is what acts on the intent');

  // The mouse trigger is gated on pointer lock, checked AT EVENT TIME.
  Input.reset();
  h.setPointerLockElement(null);
  h.dispatch('document', 'mousedown', { button: 0 });
  const unlockedFire = Input.readIntent().fire;
  h.setPointerLockElement('game');
  h.dispatch('document', 'mousedown', { button: 0 });
  const lockedFire = Input.readIntent().fire;
  h.dispatch('document', 'mouseup', { button: 0 });
  const afterUp = Input.readIntent().fire;

  assert(unlockedFire === false,
    '1i-ii. a mousedown WITHOUT pointer lock does not arm the trigger (checked at event time)');
  assert(lockedFire === true,
    '1i-iii. CONTROL: the identical mousedown WHILE the canvas holds pointer lock DOES arm it');
  assert(afterUp === false,
    '1i-iv. mouseup disarms the trigger');

  // Losing pointer lock must not leave the trigger stuck down (threat T-05-15).
  h.dispatch('document', 'mousedown', { button: 0 });
  h.setPointerLockElement(null);               // fires pointerlockchange -> Input.reset
  assert(Input.mouseFire === false && Input.readIntent().fire === false,
    '1i-v. losing pointer lock mid-click clears the mouse trigger — no stuck fire');

  Game.input = scriptedInput;
  Input.reset();
})();

// --- 1j: the shot touches no z-buffer and allocates nothing -------------------
(function () {
  scenario(2.5, 4.5, 1, 0);
  Enemies.add(7.5, 4.5);
  Combat.ammo.bullets = 100000;

  // Give the z-buffer real content first, then prove a shot cannot perturb it.
  Raycaster.render();
  const z0 = Framebuffer.zBuffer.slice();
  for (let i = 0; i < 20; i++) { Weapons.cooldown = 0; Weapons.fire(); }
  let zSame = true;
  for (let i = 0; i < z0.length; i++) {
    if (Framebuffer.zBuffer[i] !== z0[i]) { zSame = false; break; }
  }
  assert(zSame,
    '1j. 20 shots left Framebuffer.zBuffer byte-for-byte identical — hitscan reads the ' +
    'world, it does not write the depth buffer');

  const listLen = Entities.list.length;
  const poolLen = Enemies.projectiles.length;
  setIntent({ fire: true });
  simFrames(300);
  setIntent(null);
  assert(Entities.list.length === listLen && Enemies.projectiles.length === poolLen,
    '1j-ii. 300 frames of CONTINUOUS firing left Entities.list at ' + listLen + ' and the ' +
    'projectile pool at ' + poolLen + ' — nothing is allocated per shot (threat T-05-03)');
  assert(Combat.ammo.bullets < 100000 && Combat.ammo.bullets > 0,
    '1j-iii. CONTROL (non-vacuity): those 300 frames really did fire (bullets ' +
    Combat.ammo.bullets + ' of 100000 left)');
})();

// --- 1k: A DEAD PLAYER CANNOT FIRE (the ammo half of D-04) -------------------
(function () {
  scenario(2.5, 4.5, 1, 0);
  const e = Enemies.add(7.5, 4.5);

  Combat.damagePlayer(1000);                   // drive health to 0 and latch dead
  assert(Combat.health === 0 && Combat.dead === true,
    '1k-i. the player is dead (health 0, dead latched) before the held-fire drive');

  const b0 = Combat.ammo.bullets;
  const h0 = e.health;
  const px0 = Player.x, py0 = Player.y;

  setIntent({ fire: true, forward: 1, strafe: 1, turn: 1, mouseDX: 25 });
  simFrames(60);

  assert(Combat.ammo.bullets === b0,
    '1k. a DEAD player holding fire for 60 frames spends NO ammo (bullets still ' + b0 + ')');
  assert(e.health === h0,
    '1k-ii. and damages no enemy (health still ' + h0 + ')');
  assert(Player.x === px0 && Player.y === py0,
    '1k-iii. and does not move — Game.step substitutes the frozen ZERO_INTENT (D-04)');

  // CONTROL: the IDENTICAL held intent on a LIVE player spends ammo and damages.
  Combat.reset();
  Weapons.reset();
  Player.x = 2.5; Player.y = 4.5; Player.setDir(1, 0);
  e.x = 7.5; e.y = 4.5; e.health = CONFIG.ENEMY_HEALTH; e.alive = true; e.state = Enemies.IDLE;
  const b1 = Combat.ammo.bullets;
  const h1 = e.health;
  setIntent({ fire: true });
  simFrames(60);
  setIntent(null);

  assert(Combat.ammo.bullets < b1 && e.health < h1,
    '1k-iv. CONTROL: the identical held fire intent on a LIVE player spends ammo (' +
    (b1 - Combat.ammo.bullets) + ') and damages the enemy (' + (h1 - e.health) + ')');
})();

finish('ALL_WEAPON_CONTRACTS_PASS');
