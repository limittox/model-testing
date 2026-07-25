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

// ===========================================================================
// 2. THE SHOTGUN: MULTI-PELLET SPREAD, PER-WEAPON AMMO, AND WEAPON SWITCHING.
// ===========================================================================

// --- 2a / 2b: the shotgun is GATED on the grant -------------------------------
(function () {
  scenario(2.5, 4.5, 1, 0);
  Combat.hasShotgun = false;
  Combat.ammo.shells = 8;

  setIntent({ weaponSlot: 2, fire: true });
  simFrames(5);
  setIntent(null);

  assert(Combat.weapon === Combat.PISTOL,
    '2a. with hasShotgun FALSE a slot-2 select leaves Combat.weapon at the pistol (D-10)');
  assert(Combat.ammo.shells === 8,
    '2a-ii. and no shell was spent — the refused weapon never got to fire');

  // --- 2b CONTROL: grant it, replay the IDENTICAL intent --------------------
  scenario(2.5, 4.5, 1, 0);
  Combat.hasShotgun = true;
  Combat.ammo.shells = 8;
  setIntent({ weaponSlot: 2 });
  simFrames(1);
  setIntent(null);

  assert(Combat.weapon === Combat.SHOTGUN,
    '2b. CONTROL: after Combat.hasShotgun becomes true the IDENTICAL slot-2 intent ' +
    'selects the shotgun');
  assert(Combat.selectWeapon('rocketLauncher') === false && Combat.weapon === Combat.SHOTGUN,
    '2b-ii. Combat.selectWeapon refuses an UNKNOWN weapon name and leaves the selection alone');

  // The real Input path DRAINS the pending slot, so one key press selects once.
  Game.input = Input;
  Input.reset();
  h.dispatch('window', 'keydown', { code: 'Digit2' });
  const firstRead = Input.readIntent().weaponSlot;
  const secondRead = Input.readIntent().weaponSlot;
  Game.input = scriptedInput;
  Input.reset();
  assert(firstRead === 2 && secondRead === 0,
    '2b-iii. a real Digit2 keydown yields weaponSlot 2 on the FIRST read and 0 on the next ' +
    '— the slot is drained exactly like the mouse delta, so a held key selects once');
})();

// --- 2c: each weapon spends its OWN ammo type --------------------------------
(function () {
  scenario(2.5, 4.5, 1, 0);
  Combat.hasShotgun = true;
  Combat.weapon = Combat.SHOTGUN;
  Combat.ammo.shells = 8;
  const b0 = Combat.ammo.bullets, sh0 = Combat.ammo.shells;

  Weapons.fire();

  assert(sh0 - Combat.ammo.shells === 1 && Combat.ammo.bullets === b0,
    '2c. one shotgun shot spends exactly 1 SHELL and leaves bullets untouched (' + b0 +
    ') — each weapon spends only its own Combat.ammo field');
})();

// --- 2d: pellet COUNT is the weapon's, not a constant ------------------------
(function () {
  scenario(2.5, 4.5, 1, 0);
  Combat.hasShotgun = true;
  Combat.ammo.shells = 8;

  Combat.weapon = Combat.SHOTGUN;
  Weapons.fire();
  const shotgunRays = Weapons.lastRayCount;

  Combat.weapon = Combat.PISTOL;
  Weapons.fire();
  const pistolRays = Weapons.lastRayCount;

  assert(shotgunRays === CONFIG.SHOTGUN_PELLETS,
    '2d. one shotgun shot casts CONFIG.SHOTGUN_PELLETS rays (' + CONFIG.SHOTGUN_PELLETS +
    ', got ' + shotgunRays + ')');
  assert(pistolRays === 1,
    '2d-ii. one pistol shot casts EXACTLY one ray (got ' + pistolRays + ') — WEAP-03');
})();

// --- 2e: the spread is a real cone around the aim direction ------------------
(function () {
  scenario(2.5, 4.5, 1, 0);
  Combat.hasShotgun = true;
  Combat.weapon = Combat.SHOTGUN;
  Combat.ammo.shells = 8;

  const aim = Math.atan2(Player.dirY, Player.dirX);
  Weapons.fire();

  const n = Weapons.lastRayCount;
  const offsets = [];
  for (let i = 0; i < n; i++) offsets.push(Weapons.rayAngles[i] - aim);

  const allEqual = offsets.every((o) => o === offsets[0]);
  const distinct = new Set(offsets).size;
  const worst = Math.max(...offsets.map(Math.abs));

  assert(!allEqual && distinct === n,
    '2e. the ' + n + ' pellet angles are NOT all equal (' + distinct + ' distinct offsets) ' +
    '— the cone is real, not one ray repeated');
  assert(worst <= CONFIG.SHOTGUN_SPREAD + 1e-12,
    '2e-ii. every pellet lies within CONFIG.SHOTGUN_SPREAD (' + CONFIG.SHOTGUN_SPREAD +
    ') of the aim direction — worst offset ' + worst.toFixed(5) + ' rad');
  assert(worst > 0,
    '2e-iii. CONTROL (non-vacuity): the worst offset is non-zero, so the spread was applied');
})();

// --- 2f: a point-blank blast lands MULTIPLE pellets --------------------------
(function () {
  scenario(2.5, 4.5, 1, 0);
  Combat.hasShotgun = true;
  Combat.ammo.shells = 8;
  const e = Enemies.add(3.5, 4.5);             // one cell — every pellet inside the body
  // Raise the health above a full blast so the kill does not TRUNCATE the total:
  // Enemies.hurt's re-entry guard correctly stops damaging a dead enemy, which
  // would clamp 49 damage to the 40 it started with and hide the multiple.
  e.health = 500;

  Combat.weapon = Combat.SHOTGUN;
  const h0 = e.health;
  Weapons.fire();
  const shotgunDamage = h0 - e.health;

  Combat.weapon = Combat.PISTOL;
  const h1 = e.health;
  Weapons.fire();
  const pistolDamage = h1 - e.health;

  assert(shotgunDamage > pistolDamage,
    '2f. a point-blank shotgun blast removes MORE health (' + shotgunDamage + ') than one ' +
    'pistol shot (' + pistolDamage + ') — multiple pellets connected');
  assert(shotgunDamage % CONFIG.SHOTGUN_DAMAGE === 0 && shotgunDamage > 0,
    '2f-ii. the health removed is an exact multiple of CONFIG.SHOTGUN_DAMAGE (' +
    shotgunDamage + ' = ' + (shotgunDamage / CONFIG.SHOTGUN_DAMAGE) + ' x ' +
    CONFIG.SHOTGUN_DAMAGE + ') — every pellet applied its own damage through Enemies.hurt');
  assert(shotgunDamage === CONFIG.SHOTGUN_PELLETS * CONFIG.SHOTGUN_DAMAGE,
    '2f-iii. at one cell EVERY pellet is inside HITSCAN_TARGET_RADIUS, so the blast is the ' +
    'full CONFIG.SHOTGUN_PELLETS * CONFIG.SHOTGUN_DAMAGE (' +
    (CONFIG.SHOTGUN_PELLETS * CONFIG.SHOTGUN_DAMAGE) + ')');
})();

// --- 2g: THE WALL STOP APPLIES PER PELLET, with the opened-wall control ------
(function () {
  scenario(2.5, 6.5, 1, 0);
  Combat.hasShotgun = true;
  Combat.weapon = Combat.SHOTGUN;
  Combat.ammo.shells = 8;
  const e = Enemies.add(7.5, 6.5);             // behind the single brick cell (6,6)
  e.health = 500;

  const h0 = e.health;
  Weapons.fire();
  const blockedDamage = h0 - e.health;

  setCell(6, 6, 0);                            // open that ONE cell
  const h1 = e.health;
  Weapons.fire();
  const openDamage = h1 - e.health;

  assert(blockedDamage === 0,
    '2g. WALL STOP PER PELLET: with the wall on the aim line a shotgun blast removes ZERO ' +
    'health — not one of the ' + CONFIG.SHOTGUN_PELLETS + ' pellets got through');
  assert(openDamage > 0 && openDamage % CONFIG.SHOTGUN_DAMAGE === 0,
    '2g-ii. CONTROL: with that ONE cell opened the identical blast removes a POSITIVE ' +
    'multiple of CONFIG.SHOTGUN_DAMAGE (' + openDamage + ' = ' +
    (openDamage / CONFIG.SHOTGUN_DAMAGE) + ' pellets)');
})();

// --- 2h: the cooldown is the WEAPON'S, and switching cannot bypass it --------
(function () {
  scenario(2.5, 4.5, 1, 0);
  Combat.hasShotgun = true;
  Combat.weapon = Combat.SHOTGUN;
  Combat.ammo.shells = 8;
  Combat.ammo.bullets = 50;

  Weapons.fire();
  assert(near(Weapons.cooldown, CONFIG.SHOTGUN_COOLDOWN, 1e-12),
    '2h. a shotgun shot charges the cooldown to CONFIG.SHOTGUN_COOLDOWN (' +
    CONFIG.SHOTGUN_COOLDOWN + ', got ' + Weapons.cooldown + ')');

  const settleFrames = 6;
  setIntent(null);
  simFrames(settleFrames);

  // Now switch to the pistol WHILE the shotgun cooldown is still running, and ask
  // to fire on the same frame. The switch must take effect and the shot must NOT.
  const shotsBefore = Weapons.shotsFired;
  const bulletsBefore = Combat.ammo.bullets;
  setIntent({ weaponSlot: 1, fire: true });
  simFrames(1);
  setIntent(null);

  const expectedCooldown = CONFIG.SHOTGUN_COOLDOWN - (settleFrames + 1) * FRAME_DT;
  assert(Combat.weapon === Combat.PISTOL,
    '2h-ii. the slot-1 select took effect on the SAME frame it was intended (Weapons.update ' +
    'resolves the switch before the fire decision)');
  assert(near(Weapons.cooldown, expectedCooldown, 1e-9),
    '2h-iii. switching did NOT reset the in-progress cooldown: it is still the shotgun ' +
    'timer counting down (' + Weapons.cooldown.toFixed(4) + ', expected ' +
    expectedCooldown.toFixed(4) + ') — ONE shared timer, so 1-2-1-2 cannot double the ' +
    'rate of fire (threat T-05-12)');
  assert(Weapons.shotsFired === shotsBefore && Combat.ammo.bullets === bulletsBefore,
    '2h-iv. and no shot came out of the freshly selected pistol while that timer ran');
})();

// --- 2i: an empty shotgun does not fire and does not fall back to bullets ----
(function () {
  scenario(2.5, 4.5, 1, 0);
  Combat.hasShotgun = true;
  Combat.weapon = Combat.SHOTGUN;
  Combat.ammo.shells = 0;
  const e = Enemies.add(3.5, 4.5);
  const b0 = Combat.ammo.bullets, h0 = e.health;

  const fired = Weapons.fire();

  assert(fired === false && e.health === h0,
    '2i. firing the shotgun with ZERO shells does not fire and damages nothing');
  assert(Combat.ammo.bullets === b0 && Combat.ammo.shells === 0,
    '2i-ii. and does NOT fall back to the pistol\'s bullets (' + b0 + ' still there)');
  assert(Weapons.cooldown === 0,
    '2i-iii. and the refused shotgun shot left the cooldown at 0');
})();

// --- 2j: the spread stream is DETERMINISTIC under reset() -------------------
(function () {
  function replay() {
    scenario(2.5, 4.5, 1, 0);                  // scenario() ends with Weapons.reset()
    Combat.hasShotgun = true;
    Combat.weapon = Combat.SHOTGUN;
    Combat.ammo.shells = 8;
    const out = [];
    for (let shot = 0; shot < 3; shot++) {
      Weapons.cooldown = 0;
      Weapons.fire();
      for (let i = 0; i < Weapons.lastRayCount; i++) out.push(Weapons.rayAngles[i]);
    }
    return out;
  }

  const runA = replay();
  const runB = replay();

  let identical = runA.length === runB.length && runA.length > 0;
  let firstDrift = -1;
  for (let i = 0; identical && i < runA.length; i++) {
    if (runA[i] !== runB[i]) { identical = false; firstDrift = i; }
  }

  assert(identical,
    '2j. re-seeding through Weapons.reset() and replaying the scenario reproduces all ' +
    runA.length + ' pellet angles ELEMENT FOR ELEMENT' +
    (identical ? '' : ' — drifted at index ' + firstDrift));
  assert(new Set(runA).size > 1,
    '2j-ii. CONTROL (non-vacuity): the reproduced sequence has ' + new Set(runA).size +
    ' distinct angles, so determinism is not just a constant repeated');
})();

// ===========================================================================
// 3. THE VIEWMODEL (WEAP-04): the ordered overlay seam, the bottom-centre draw,
//    the no-halo unfogged blit, the movement bob, the recoil kick and the muzzle
//    flash window — each with a control.
//
//    NOTE ON DRIVERS: this section renders with Raycaster.render() and NEVER calls
//    Framebuffer.present() by hand, because Game.render owns the single present. That
//    is what lets 3h assert present-count == frame-count over the whole harness.
// ===========================================================================

const W = Framebuffer.width;
const H = Framebuffer.height;

// Render the frame with the overlay seam TRUNCATED (the background the viewmodel
// will be composited over), restoring the seam exactly as it was.
function renderBg() {
  const saved = Raycaster.overlayPasses.slice();
  Raycaster.overlayPasses.length = 0;
  Raycaster.render();
  const bg = Framebuffer.buf32.slice();
  for (let i = 0; i < saved.length; i++) Raycaster.overlayPasses.push(saved[i]);
  return bg;
}
function renderWithOverlay() {
  Raycaster.render();
  return Framebuffer.buf32.slice();
}

// The bounding box (and count) of the pixels the overlay changed.
function diffBox(bg, cur) {
  let n = 0, minx = 1e9, maxx = -1, miny = 1e9, maxy = -1;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      if (cur[row + x] !== bg[row + x]) {
        n += 1;
        if (x < minx) minx = x;
        if (x > maxx) maxx = x;
        if (y < miny) miny = y;
        if (y > maxy) maxy = y;
      }
    }
  }
  return { n, minx, maxx, miny, maxy };
}

// The set of OPAQUE packed texel values in an asset — the only values the unfogged
// viewmodel blit is allowed to write.
function opaqueTexels(tex) {
  const set = new Set();
  for (let i = 0; i < tex.buf32.length; i++) {
    const p = tex.buf32[i] >>> 0;
    if (((p >>> 24) & 0xff) >= Sprites.ALPHA_KEY) set.add(p);
  }
  return set;
}

// AN INDEPENDENT recompute of the destination box — written from the documented
// formula (a bottom-centre anchor, plus the bob offsets, plus the eased recoil),
// NOT read out of Weapons.viewmodelBox, so a bug shared with the renderer cannot
// hide behind a self-reported number.
function expectedBox() {
  const w = Weapons.TABLE[Combat.weapon];
  const tex = Sprites.map[w.sprite];
  const destH = Math.floor(H * CONFIG.VIEWMODEL_HEIGHT_FRAC);
  const destW = Math.floor(destH * tex.width / tex.height);
  const amp = Weapons.bobAmp;
  const bobX = Math.round(Math.sin(Weapons.bobPhase) * amp);
  const bobY = Math.round(Math.abs(Math.sin(2 * Weapons.bobPhase)) * amp);
  const kick = (Weapons.recoil > 0 && CONFIG.RECOIL_TIME > 0)
    ? Math.round(CONFIG.RECOIL_PIXELS * (Weapons.recoil / CONFIG.RECOIL_TIME))
    : 0;
  return {
    tex,
    x: ((W - destW) >> 1) + bobX,
    y: H - destH + bobY + kick,
    w: destW, h: destH
  };
}

// --- 3-0: boot wired the seam ------------------------------------------------
(function () {
  assert(Array.isArray(Raycaster.overlayPasses),
    '3-0a. Raycaster.overlayPasses is an ARRAY (an ORDERED seam — 05-04 appends the ' +
    'message line after the viewmodel so text lands on top of the gun)');
  assert(Raycaster.overlayPasses.indexOf(Weapons.renderViewmodel) >= 0,
    '3-0b. main.js pushed Weapons.renderViewmodel onto Raycaster.overlayPasses at boot');
  assert(Sprites.map.weaponPistol && Sprites.map.weaponShotgun && Sprites.map.muzzleFlash &&
    Sprites.map.weapon === Sprites.map.weaponPistol,
    '3-0c. the two viewmodels and the muzzle flash resolve, and the legacy ' +
    'Sprites.map.weapon key IS the pistol viewmodel (strict identity alias)');
  // Every viewmodel asset obeys the binary-alpha contract every other sprite obeys —
  // this is the structural reason the blit cannot produce a halo.
  let binary = true, bad = null;
  for (const name of ['weaponPistol', 'weaponShotgun', 'muzzleFlash']) {
    const tex = Sprites.map[name];
    for (let i = 0; i < tex.buf32.length; i++) {
      const a = (tex.buf32[i] >>> 24) & 0xff;
      if (a !== 0 && a !== 255) { binary = false; bad = name; break; }
    }
  }
  assert(binary,
    '3-0d. every texel alpha in both viewmodels and the muzzle flash is exactly 0 or 255' +
    (binary ? '' : ' — ' + bad + ' has a partial-alpha texel'));
  // The flash palette is DISJOINT from both weapon palettes — the precondition that
  // makes 3f's "flash pixels are present / absent" measurement meaningful.
  const flashSet = opaqueTexels(Sprites.map.muzzleFlash);
  const gunSet = new Set([...opaqueTexels(Sprites.map.weaponPistol),
                          ...opaqueTexels(Sprites.map.weaponShotgun)]);
  let overlap = 0;
  for (const v of flashSet) if (gunSet.has(v)) overlap += 1;
  assert(overlap === 0 && flashSet.size > 0,
    '3-0e. the muzzle flash\'s ' + flashSet.size + ' emissive colours are DISJOINT from ' +
    'both weapon palettes — so counting flash-coloured pixels in a frame is a real ' +
    'measurement of the flash (overlap ' + overlap + ')');
})();

// --- 3a: the seam draws, and it draws BOTTOM-CENTRE ---------------------------
(function () {
  scenario(2.5, 4.5, 1, 0);
  const bg = renderBg();
  const cur = renderWithOverlay();
  const d = diffBox(bg, cur);

  assert(d.n > 0,
    '3a. a rendered frame DIFFERS from the same frame with the overlay seam truncated (' +
    d.n + ' pixels changed) — the viewmodel is actually composited');
  assert(d.miny >= H / 2 && d.maxy <= H - 1,
    '3a-ii. every changed pixel is in the BOTTOM half of the frame (rows ' + d.miny +
    '..' + d.maxy + ' of ' + H + ')');
  assert(d.minx >= W / 4 && d.maxx <= 3 * W / 4,
    '3a-iii. and horizontally CENTRED (cols ' + d.minx + '..' + d.maxx + ' of ' + W + ')');
})();

// --- 3b: THE NO-HALO PROOF — exact texels in, background untouched out --------
(function () {
  scenario(2.5, 4.5, 1, 0);
  // No flash and no recoil: this proof is about the weapon blit alone.
  Weapons.flash = 0;
  Weapons.recoil = 0;

  const bg = renderBg();
  const cur = renderWithOverlay();
  const box = expectedBox();
  const tex = box.tex;

  let opaqueExact = 0, opaqueWrong = 0;
  let skippedExact = 0, skippedWrong = 0;
  let outsideWrong = 0;

  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const inside = (x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h);
      if (!inside) {
        // OUTSIDE the recomputed box nothing may have changed at all.
        if (cur[row + x] !== bg[row + x]) outsideWrong += 1;
        continue;
      }
      // INSIDE: the nearest-neighbour source texel decides exactly what must be there.
      let sy = Math.floor((y - box.y) * tex.height / box.h);
      if (sy < 0) sy = 0; else if (sy > tex.height - 1) sy = tex.height - 1;
      let sx = Math.floor((x - box.x) * tex.width / box.w);
      if (sx < 0) sx = 0; else if (sx > tex.width - 1) sx = tex.width - 1;
      const packed = tex.buf32[sy * tex.width + sx] >>> 0;

      if (((packed >>> 24) & 0xff) < Sprites.ALPHA_KEY) {
        // A skipped texel must leave the pre-overlay pixel byte-for-byte intact.
        if ((cur[row + x] >>> 0) === (bg[row + x] >>> 0)) skippedExact += 1;
        else skippedWrong += 1;
      } else {
        // A written texel must be the RAW source value — UNFOGGED — and opaque.
        if ((cur[row + x] >>> 0) === packed && ((cur[row + x] >>> 24) & 0xff) === 0xff) {
          opaqueExact += 1;
        } else {
          opaqueWrong += 1;
        }
      }
    }
  }

  assert(opaqueWrong === 0 && opaqueExact > 0,
    '3b. every pixel the viewmodel WRITES equals the RAW source texel and is fully ' +
    'opaque — unfogged, nearest-neighbour, no shading (' + opaqueExact + ' exact, ' +
    opaqueWrong + ' wrong)');
  assert(skippedWrong === 0 && skippedExact > 0,
    '3b-ii. every pixel the alpha key SKIPS is byte-for-byte the pre-overlay frame (' +
    skippedExact + ' preserved, ' + skippedWrong + ' corrupted) — structurally no halo');
  assert(outsideWrong === 0,
    '3b-iii. nothing OUTSIDE the independently recomputed destination box changed (' +
    outsideWrong + ' stray writes) — the blit indices are clamped, not lucky ' +
    '(threat T-05-13)');
})();

// --- 3c: the overlay never writes the z-buffer -------------------------------
(function () {
  scenario(2.5, 4.5, 1, 0);
  const bg = renderBg();                        // fills zBuffer via the wall pass
  const z0 = Framebuffer.zBuffer.slice();

  Weapons.flash = CONFIG.MUZZLE_FLASH_TIME;     // exercise BOTH blits
  Weapons.recoil = CONFIG.RECOIL_TIME;
  Weapons.renderViewmodel();                    // the overlay pass IN ISOLATION

  let same = true, at = -1;
  for (let i = 0; i < z0.length; i++) {
    if (Framebuffer.zBuffer[i] !== z0[i]) { same = false; at = i; break; }
  }
  // Non-vacuity: the pass we just isolated really did draw something.
  const d = diffBox(bg, Framebuffer.buf32);

  assert(same,
    '3c. Framebuffer.zBuffer is byte-for-byte identical before and after the overlay ' +
    'pass (weapon + flash)' + (same ? '' : ' — diverged at column ' + at));
  assert(d.n > 0,
    '3c-ii. CONTROL (non-vacuity): that isolated overlay pass did write ' + d.n +
    ' framebuffer pixels, so 3c is not measuring a no-op');
  Weapons.flash = 0;
  Weapons.recoil = 0;
})();

// --- 3d: THE BOB scales with movement speed, and a standing gun is still ------
(function () {
  // Measure the drawn bounding box once per stepped frame.
  function drive(frames, intent) {
    scenario(2.5, 4.5, 1, 0);
    setIntent(intent);
    const boxes = [];
    for (let f = 0; f < frames; f++) {
      Game.step(FRAME_DT);
      const bg = renderBg();
      const cur = renderWithOverlay();
      boxes.push(diffBox(bg, cur));
    }
    setIntent(null);
    return boxes;
  }

  // STANDING: no travel => zero amplitude => a frozen phase => an identical box.
  const still = drive(30, null);
  const stillKey = (b) => b.minx + '|' + b.maxx + '|' + b.miny + '|' + b.maxy;
  const stillDistinct = new Set(still.map(stillKey));
  assert(stillDistinct.size === 1 && still[0].n > 0,
    '3d. with the player STATIONARY the drawn bounding box is IDENTICAL across 30 frames (' +
    stillDistinct.size + ' distinct box, ' + still[0].n + ' pixels) — a standing weapon ' +
    'is dead still');

  // WALKING: the box must genuinely move.
  const walk = drive(30, { forward: 1 });
  const walkDistinct = new Set(walk.map(stillKey));
  const walkX = walk.map((b) => b.minx);
  const walkExcursion = Math.max(...walkX) - Math.min(...walkX);
  assert(walkDistinct.size >= 2,
    '3d-ii. after 30 frames of forward movement the bounding box takes at least two ' +
    'distinct positions (' + walkDistinct.size + ' distinct) — the weapon bobs');

  // RUNNING: a LARGER horizontal excursion than walking. The amplitude scales with
  // speed relative to the MAXIMUM ground speed (walk * RUN_MULT), which is what
  // makes running visibly different — see 05-02-SUMMARY's deviation note.
  const run = drive(30, { forward: 1, run: true });
  const runX = run.map((b) => b.minx);
  const runExcursion = Math.max(...runX) - Math.min(...runX);
  assert(runExcursion > walkExcursion,
    '3d-iii. the horizontal excursion is LARGER at run speed than at walk speed (run ' +
    runExcursion + ' px > walk ' + walkExcursion + ' px)');
  assert(walkExcursion > 0,
    '3d-iv. CONTROL (non-vacuity): the walking excursion is itself non-zero (' +
    walkExcursion + ' px), so 3d-iii compares two real motions');
})();

// --- 3e: THE RECOIL kicks the weapon down and eases back ---------------------
//     ISOLATION NOTE: the muzzle flash is anchored near the weapon's MUZZLE and its
//     burst reaches ABOVE the weapon's top edge, so a bounding box measured on the
//     shot frame itself is the FLASH's box, not the weapon's. The recoil is
//     therefore measured on the first frame after the flash window has closed while
//     the kick is still easing — which CONFIG guarantees exists, and 3e-0 asserts.
(function () {
  assert(CONFIG.MUZZLE_FLASH_TIME < CONFIG.RECOIL_TIME,
    '3e-0. CONFIG.MUZZLE_FLASH_TIME (' + CONFIG.MUZZLE_FLASH_TIME + ') is shorter than ' +
    'CONFIG.RECOIL_TIME (' + CONFIG.RECOIL_TIME + '), so there is a window in which the ' +
    'recoil can be measured with no flash contaminating the bounding box');

  scenario(2.5, 4.5, 1, 0);
  setIntent(null);

  // Resting position: stationary, nothing fired, no flash, no kick.
  Game.step(FRAME_DT);
  const restTop = diffBox(renderBg(), renderWithOverlay()).miny;

  Weapons.fire();
  const flashFrames = Math.ceil(CONFIG.MUZZLE_FLASH_TIME / FRAME_DT);
  for (let f = 0; f < flashFrames; f++) Game.step(FRAME_DT);

  assert(Weapons.flash === 0 && Weapons.recoil > 0,
    '3e-i. after ' + flashFrames + ' frames the flash has closed while the recoil is ' +
    'still easing (' + Weapons.recoil.toFixed(4) + 's left) — the isolation precondition holds');

  const kick = Weapons.recoilOffset();
  const kickedTop = diffBox(renderBg(), renderWithOverlay()).miny;

  assert(kick > 0 && kickedTop === restTop + kick,
    '3e. after a shot the drawn bounding box TOP is LOWER on screen by EXACTLY the eased ' +
    'recoil offset (' + kickedTop + ' === resting ' + restTop + ' + ' + kick +
    ') — the kick pushes the weapon down and decays linearly over CONFIG.RECOIL_TIME');

  // Within CONFIG.RECOIL_TIME of stepped frames it must be back at rest.
  const recoilFrames = Math.ceil(CONFIG.RECOIL_TIME / FRAME_DT) + 1;
  for (let f = 0; f < recoilFrames; f++) Game.step(FRAME_DT);
  const easedTop = diffBox(renderBg(), renderWithOverlay()).miny;

  assert(Weapons.recoil === 0 && easedTop === restTop,
    '3e-ii. and it has eased all the way back to the resting position within ' +
    'CONFIG.RECOIL_TIME (' + recoilFrames + ' frames; top ' + easedTop + ' === ' +
    restTop + ')');
})();

// --- 3f: THE MUZZLE FLASH window ---------------------------------------------
(function () {
  scenario(2.5, 4.5, 1, 0);
  setIntent(null);
  Game.step(FRAME_DT);

  const flashSet = opaqueTexels(Sprites.map.muzzleFlash);
  const bg = renderBg();
  // Count only pixels the OVERLAY changed that carry a flash colour, so nothing in
  // the wall/floor background can contribute to the measurement.
  function flashPixels() {
    const cur = renderWithOverlay();
    let n = 0;
    for (let i = 0; i < cur.length; i++) {
      if (cur[i] !== bg[i] && flashSet.has(cur[i] >>> 0)) n += 1;
    }
    return n;
  }

  // CONTROL FIRST: a frame on which nothing was fired has NO flash pixels.
  const beforeShot = flashPixels();
  assert(beforeShot === 0,
    '3f. CONTROL: on a frame where nothing was fired there are ZERO flash-coloured ' +
    'pixels (got ' + beforeShot + ')');

  Weapons.fire();
  const atShot = flashPixels();
  assert(atShot > 0,
    '3f-ii. immediately after a shot flash-coloured pixels are PRESENT (' + atShot + ')');

  // Just BEFORE the window closes: the largest whole frame count still inside it.
  const insideFrames = Math.ceil(CONFIG.MUZZLE_FLASH_TIME / FRAME_DT) - 1;
  for (let f = 0; f < insideFrames; f++) Game.step(FRAME_DT);
  const stillInside = flashPixels();
  assert(Weapons.flash > 0 && stillInside > 0,
    '3f-iii. still present after ' + insideFrames + ' frames, with ' +
    Weapons.flash.toFixed(4) + 's of CONFIG.MUZZLE_FLASH_TIME left (' + stillInside +
    ' pixels)');

  // And gone once the window has elapsed.
  Game.step(FRAME_DT);
  Game.step(FRAME_DT);
  const after = flashPixels();
  assert(Weapons.flash === 0 && after === 0,
    '3f-iv. and ABSENT once CONFIG.MUZZLE_FLASH_TIME has elapsed (' + after + ' pixels)');
})();

// --- 3g: the viewmodel follows the SELECTED weapon ---------------------------
(function () {
  scenario(2.5, 4.5, 1, 0);
  Combat.hasShotgun = true;
  Weapons.flash = 0;
  Weapons.recoil = 0;

  const bg = renderBg();

  Combat.weapon = Combat.PISTOL;
  const pistolFrame = renderWithOverlay();
  Combat.weapon = Combat.SHOTGUN;
  const shotgunFrame = renderWithOverlay();

  let differs = 0;
  for (let i = 0; i < pistolFrame.length; i++) {
    if (pistolFrame[i] !== shotgunFrame[i]) differs += 1;
  }

  // Stronger than "the frames differ": the shotgun frame must contain a colour that
  // exists ONLY in the shotgun asset (its wood tones), so the change is the shotgun
  // being drawn and not a stray pixel.
  const pistolSet = opaqueTexels(Sprites.map.weaponPistol);
  const shotgunOnly = new Set();
  for (const v of opaqueTexels(Sprites.map.weaponShotgun)) {
    if (!pistolSet.has(v)) shotgunOnly.add(v);
  }
  let shotgunOnlyDrawn = 0;
  for (let i = 0; i < shotgunFrame.length; i++) {
    if (shotgunFrame[i] !== bg[i] && shotgunOnly.has(shotgunFrame[i] >>> 0)) shotgunOnlyDrawn += 1;
  }

  assert(differs > 0,
    '3g. switching to the shotgun changes the drawn pixel signature (' + differs +
    ' pixels differ) — the viewmodel follows Combat.weapon');
  assert(shotgunOnlyDrawn > 0,
    '3g-ii. and the shotgun frame contains ' + shotgunOnlyDrawn + ' pixels in colours that ' +
    'exist ONLY in the shotgun asset — it is the shotgun being drawn, not a smear');
  Combat.weapon = Combat.PISTOL;
})();

// --- 3h: ONE present per frame survived the new seam -------------------------
(function () {
  assert(h.putCount() === Game.frames,
    '3h. putImageData count equals frame count across the whole harness (' + h.putCount() +
    ' === ' + Game.frames + ') — the overlay seam runs INSIDE Raycaster.render(), so ' +
    'Game.render still owns exactly one present per frame');
})();

finish('ALL_WEAPON_CONTRACTS_PASS');
