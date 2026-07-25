/*
 * tools/verify-pickups.cjs — the Phase 5 PICKUP + LEVEL POPULATION harness (05-04).
 *
 * NODE-ONLY (never referenced by index.html). Built on tools/boot.cjs: it boots
 * the SHIPPED script list in the SHIPPED order into one vm context with a stubbed
 * DOM, fires the window load event (main.js builds the level, spawns the player,
 * resets Combat + Weapons + Sound, builds the enemies and the pickup view, wires
 * the seams and starts the loop), then drives the simulation deterministically.
 *
 * THREE DRIVERS, chosen per proof (the idiom verify-combat and verify-weapons
 * established):
 *   - Pickups.collect(e) / Combat grants — DIRECT, for statements about ONE
 *     effect and nothing else.
 *   - Game.step(dt) — a direct simulation step with an exact delta. Every
 *     COLLECTION proof uses it, because "walking over it collects it" is a
 *     statement about the dispatch path Game.step owns.
 *   - h.raf.step(ms) — the REAL loop, for the message-expiry proofs, so what is
 *     under test is the actual frame -> step -> render -> present chain.
 *
 * FALSIFIABILITY DISCIPLINE: every zero-result proof is PAIRED with a control
 * that makes the SAME measurement non-zero. "The pickup out of range collected
 * nothing" is worthless unless the same pickup, same harness, same measurement,
 * provably DOES collect once it is inside the radius. Every expected number is
 * DERIVED from the CONFIG constants (read through the effect table's KEY, so the
 * proof also shows the constant is read live) rather than typed in.
 *
 * Prints PASS/FAIL per assertion and the terminal token ALL_PICKUP_CONTRACTS_PASS
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
const Pickups = s.Pickups;
const Sound = s.Sound;
const Sprites = s.Sprites;
const Raycaster = s.Raycaster;
const Framebuffer = s.Framebuffer;
const raf = h.raf;

// ---------------------------------------------------------------------------
// Harness helpers
// ---------------------------------------------------------------------------

const FRAME_MS = 1000 / 60;
const FRAME_DT = FRAME_MS / 1000;

// The four pickup marker types, written out here rather than read from the module
// under test — reading Pickups.EFFECTS to build the expectation would make every
// census assertion tautological.
const PICK_TYPES = ['health', 'armor', 'ammo', 'shotgun'];
const PICKUP_SPRITE = {
  health: 'pickupHealth',
  armor: 'pickupArmor',
  ammo: 'pickupAmmo',
  shotgun: 'pickupShotgun'
};

// A scripted intent source so the harness — not a keyboard — decides what the
// player tries to do.
const ZERO = { forward: 0, strafe: 0, turn: 0, mouseDX: 0, run: false, fire: false, weaponSlot: 0 };
const scriptedInput = {
  intent: ZERO,
  readIntent: function () { return this.intent; },
  reset: function () { this.intent = ZERO; }
};
function setIntent(o) {
  scriptedInput.intent = Object.assign({}, ZERO, o || {});
}
Game.input = scriptedInput;

function simFrames(n, dt) {
  const d = dt === undefined ? FRAME_DT : dt;
  for (let i = 0; i < n; i++) Game.step(d);
}

// A CLEAN SLATE. Rebuilds the authored map, reseeds the player's combat, weapon
// and sound state, rebuilds the entity world AND the pickup view together
// (Enemies.reset() is the one call that does both), and takes the level's own
// enemies OUT of the AI update set by truncating Enemies.list IN PLACE — this
// harness is about items, and a fireball landing mid-proof would change health
// for a reason that has nothing to do with a pickup. The enemies stay in
// Entities.list as the billboards Phase 4 rendered, so nothing is orphaned.
function scenario(px, py, dx, dy) {
  Level.build();
  Combat.reset();
  Enemies.reset();                 // Entities.build() + Pickups.build(), together
  Enemies.list.length = 0;
  Player.x = px;
  Player.y = py;
  Player.setDir(dx === undefined ? 1 : dx, dy === undefined ? 0 : dy);
  Weapons.reset();
  Sound.reset();
  Game.clearMessages();
  setIntent(null);
}

// Deactivate every pickup except the FIRST of `itemType`, and move that one to
// (x, y). Deactivating (rather than moving the others away) is deliberate: the
// sprite pass skips an inactive entity outright, so the pixel proofs measure the
// ONE item under test and nothing else.
function isolate(itemType, x, y) {
  let target = null;
  for (const e of Pickups.list) {
    if (target === null && e.itemType === itemType) {
      target = e;
      e.active = true;
      e.x = x;
      e.y = y;
    } else {
      e.active = false;
    }
  }
  return target;
}

// Render ONE frame into buf32 with the overlay passes suppressed, and return a
// copy. Overlay suppression keeps the world-pass diffs free of the viewmodel and
// the message line, which are proven separately in section 3.
function renderWorld() {
  const saved = Raycaster.overlayPasses.slice();
  Raycaster.overlayPasses.length = 0;
  Game.view.render();
  const out = Framebuffer.buf32.slice();
  for (let i = 0; i < saved.length; i++) Raycaster.overlayPasses.push(saved[i]);
  return out;
}

function diffCount(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n += 1;
  return n;
}

// The pickup marker census straight out of Level.spawns — the INDEPENDENT source
// every count assertion is measured against.
function markerCensus() {
  const c = { enemy: 0, health: 0, armor: 0, ammo: 0, shotgun: 0, exit: 0, total: 0 };
  for (const sp of Level.spawns) {
    if (c[sp.type] === undefined) continue;
    c[sp.type] += 1;
    if (PICK_TYPES.indexOf(sp.type) >= 0) c.total += 1;
  }
  return c;
}

console.log('--- pickup + population harness ---');
console.log('spawns ' + Level.spawns.length + ', entities ' + Entities.list.length +
  ', pickups ' + Pickups.list.length + ', enemies ' + Enemies.list.length);
console.log('');

// ===========================================================================
// 0. THE MODULES EXIST AND BOOT WIRED THEM.
// ===========================================================================
(function () {
  assert(typeof Pickups === 'object' && Pickups !== null,
    '0a. Pickups global exists (js/pickups.js loaded in the shipped order)');
  assert(typeof Pickups.build === 'function' && typeof Pickups.update === 'function' &&
    typeof Pickups.collect === 'function' && typeof Pickups.EFFECTS === 'object',
    '0b. the pickup API is present (build / update / collect / EFFECTS)');
  assert(typeof Sound === 'object' && Sound !== null && typeof Sound.play === 'function',
    '0c. Sound global exists with a play() hook (js/sound.js loaded before pickups.js)');

  // The hook must NOT have reached for Web Audio: an AudioContext built at load is
  // a dead suspended object, and it would take the whole harness down.
  assert(typeof s.AudioContext === 'undefined' && !('audioContext' in Sound) &&
    !('ctx' in Sound),
    '0d. Sound created NO AudioContext — Phase 6 (AUD-01/02/03) owns the synthesis');

  assert(typeof Game.message === 'function' && typeof Game.activeMessage === 'function' &&
    Array.isArray(Game.messages) && Game.messages.length === CONFIG.MESSAGE_MAX,
    '0e. the message queue is a PREALLOCATED ring of CONFIG.MESSAGE_MAX (' +
    CONFIG.MESSAGE_MAX + ') records (got ' + Game.messages.length + ')');

  assert(Pickups.built === true && Pickups.list.length > 0,
    '0f. main.js called Pickups.build() at boot — the view is populated (' +
    Pickups.list.length + ' items)');

  // The Combat grants every effect routes through must all exist: an undefined
  // grant would make a collection silently no-op.
  assert(typeof Combat.heal === 'function' && typeof Combat.addArmor === 'function' &&
    typeof Combat.addBullets === 'function' && typeof Combat.grantShotgun === 'function',
    '0g. every Combat grant the effect table names exists (heal / addArmor / ' +
    'addBullets / grantShotgun)');

  // The dispatch is real: Pickups.update must actually run from Game.step. Proven
  // by behaviour rather than by reading source — a pickup placed under the player
  // is collected by a plain step, with a control at a distance that is not.
  scenario(Level.LANDMARKS.openCell.x, Level.LANDMARKS.openCell.y);
  const oc = Level.LANDMARKS.openCell;
  isolate('health', oc.x, oc.y);
  const before = Pickups.collected;
  Game.step(FRAME_DT);
  assert(Pickups.collected === before + 1,
    '0h. Game.step DISPATCHES Pickups.update — a step with the player on an item ' +
    'collects it (' + before + ' -> ' + Pickups.collected + ')');
})();

// ===========================================================================
// 1. THE PICKUP CONTRACTS (PICK-01..05, D-07).
// ===========================================================================

const OC = Level.LANDMARKS.openCell;
console.log('    openCell ' + JSON.stringify(OC));

// --- 1a: the built pickups carry the right identity ------------------------
(function () {
  scenario(OC.x, OC.y);
  const census = markerCensus();

  // Expected itemType at each pickup cell centre, derived from Level.spawns.
  const expectAt = new Map();
  for (const sp of Level.spawns) {
    if (PICK_TYPES.indexOf(sp.type) >= 0) expectAt.set(sp.x + ',' + sp.y, sp.type);
  }

  let idOk = true, offender = null;
  for (const e of Pickups.list) {
    const want = expectAt.get(e.x + ',' + e.y);
    const ok = e.kind === 'pickup' &&
      typeof e.itemType === 'string' && e.itemType === want &&
      e.active === true &&
      e.sprite === PICKUP_SPRITE[e.itemType] &&
      !!Sprites.map[e.sprite] && !!Sprites.map[e.sprite].buf32;
    if (!ok) { idOk = false; offender = JSON.stringify({ k: e.kind, t: e.itemType, want: want, a: e.active, s: e.sprite }); }
  }
  assert(idOk,
    '1a. every built pickup carries kind "pickup", the itemType of the MARKER IT ' +
    'STANDS ON, active true, and a sprite that resolves in Sprites.map' +
    (idOk ? '' : ' — offender ' + offender));

  assert(Pickups.list.length === census.total && census.total > 0,
    '1a-ii. Pickups.list length (' + Pickups.list.length + ') equals the pickup ' +
    'marker count in Level.spawns (' + census.total + ')');

  // STRICT REFERENCE subset — the view holds the SAME OBJECTS, never copies.
  let subset = true;
  for (const e of Pickups.list) if (Entities.list.indexOf(e) < 0) subset = false;
  assert(subset,
    '1a-iii. every Pickups.list entry is the SAME OBJECT (strict ===) as an ' +
    'Entities.list entry — an adopted view, not a copy');

  // Idempotence: a second build() must not append.
  const n = Pickups.list.length;
  const identity = Pickups.list;
  Pickups.build();
  assert(Pickups.list.length === n && Pickups.list === identity,
    '1a-iv. a second Pickups.build() rebuilds from scratch: same length (' +
    Pickups.list.length + ') and the SAME ARRAY (truncated in place, never reassigned)');
})();

// --- 1b / 1c: the radius is real, with the matched in-range control ---------
(function () {
  const R = CONFIG.COLLECT_RADIUS;

  // 1b — OUT OF RANGE. The pickup sits just OUTSIDE the radius; the player stands
  // still for a full simulated second.
  scenario(OC.x, OC.y);
  const target = isolate('health', OC.x + R + 0.05, OC.y);
  Combat.health = 50;
  const healthBefore = Combat.health;
  simFrames(60);
  assert(target.active === true && Combat.health === healthBefore &&
    Pickups.collected === 0 && Sound.count === 0 && Game.activeMessage() === null,
    '1b. a pickup ' + (R + 0.05).toFixed(2) + ' cells away (radius ' + R + ') is NOT ' +
    'collected across 60 frames: still active, health ' + Combat.health +
    ', 0 collections, 0 sounds, no message');

  // 1c — THE CONTROL. The SAME pickup, the SAME frame count budget, the SAME
  // measurement — the ONLY thing that changes is that the player steps 0.10 cells
  // closer, putting it INSIDE the radius. One frame is enough.
  Player.x = target.x - (R - 0.05);
  Game.step(FRAME_DT);
  assert(target.active === false && Combat.health === healthBefore + CONFIG.HEALTH_PICKUP &&
    Pickups.collected === 1,
    '1c. CONTROL: moving the player 0.10 cells closer (to ' + (R - 0.05).toFixed(2) +
    ' cells, inside the radius) collects it in ONE frame — health ' + healthBefore +
    ' -> ' + Combat.health);
})();

// --- 1d HEALTH (PICK-01): the amount, and the clamp at the boundary ---------
(function () {
  scenario(OC.x, OC.y);
  isolate('health', OC.x, OC.y);
  Combat.health = 50;
  Game.step(FRAME_DT);
  assert(Combat.health === 50 + CONFIG.HEALTH_PICKUP,
    '1d. PICK-01: at health 50 a health pickup restores exactly CONFIG.HEALTH_PICKUP (' +
    CONFIG.HEALTH_PICKUP + ') — health is ' + Combat.health);

  // The boundary case: the grant would overshoot, so the clamp has to bite.
  scenario(OC.x, OC.y);
  isolate('health', OC.x, OC.y);
  Combat.health = 90;
  Game.step(FRAME_DT);
  assert(Combat.health === CONFIG.PLAYER_MAX_HEALTH,
    '1d-ii. PICK-01: at health 90 (+' + CONFIG.HEALTH_PICKUP + ' would overshoot) it ' +
    'CLAMPS to exactly CONFIG.PLAYER_MAX_HEALTH (' + CONFIG.PLAYER_MAX_HEALTH +
    ') — health is ' + Combat.health);
})();

// --- 1e ARMOR (PICK-02): the grant, and that the granted armor ABSORBS -------
(function () {
  scenario(OC.x, OC.y);
  isolate('armor', OC.x, OC.y);
  Combat.armor = 0;
  Combat.health = 100;
  Game.step(FRAME_DT);

  const expectArmor = Math.min(CONFIG.PLAYER_MAX_ARMOR, 0 + CONFIG.ARMOR_PICKUP);
  assert(Combat.armor === expectArmor,
    '1e. PICK-02: an armor pickup sets armor to min(PLAYER_MAX_ARMOR, armor + ' +
    'ARMOR_PICKUP) = ' + expectArmor + ' — armor is ' + Combat.armor);

  // THE POINT OF THE REQUIREMENT: the armor it granted must measurably change the
  // NEXT hit through 05-01's locked formula, absorbed = min(armor, floor(dmg/3)).
  const DMG = 12;
  const expectAbsorbed = Math.min(Combat.armor, Math.floor(DMG / CONFIG.ARMOR_ABSORB_DIVISOR));
  const hBefore = Combat.health, aBefore = Combat.armor;
  Combat.damagePlayer(DMG);
  assert(hBefore - Combat.health === DMG - expectAbsorbed &&
    aBefore - Combat.armor === expectAbsorbed,
    '1e-ii. PICK-02: a ' + DMG + '-damage hit then removes exactly ' +
    (DMG - expectAbsorbed) + ' health and ' + expectAbsorbed + ' armor — the granted ' +
    'armor feeds the SAME damagePlayer formula 05-01 locked (health -' +
    (hBefore - Combat.health) + ', armor -' + (aBefore - Combat.armor) + ')');

  // The CONTROL that makes 1e-ii meaningful: the identical hit with NO armor takes
  // the FULL damage off health. Without this the absorption number could be a
  // coincidence of the arithmetic.
  scenario(OC.x, OC.y);
  const h0 = Combat.health;
  Combat.armor = 0;
  Combat.damagePlayer(DMG);
  assert(h0 - Combat.health === DMG,
    '1e-iii. CONTROL: the identical ' + DMG + '-damage hit with armor 0 takes the ' +
    'FULL ' + DMG + ' off health (' + (h0 - Combat.health) + ') — so the ' +
    expectAbsorbed + ' absorbed above came from the pickup');

  // The clamp at the boundary.
  scenario(OC.x, OC.y);
  isolate('armor', OC.x, OC.y);
  Combat.armor = CONFIG.PLAYER_MAX_ARMOR - 10;
  Game.step(FRAME_DT);
  assert(Combat.armor === CONFIG.PLAYER_MAX_ARMOR,
    '1e-iv. PICK-02: at armor ' + (CONFIG.PLAYER_MAX_ARMOR - 10) + ' the grant CLAMPS ' +
    'to exactly PLAYER_MAX_ARMOR (' + CONFIG.PLAYER_MAX_ARMOR + ') — armor is ' + Combat.armor);
})();

// --- 1f AMMO (PICK-03) ------------------------------------------------------
(function () {
  scenario(OC.x, OC.y);
  isolate('ammo', OC.x, OC.y);
  const bBefore = Combat.ammo.bullets;
  const sBefore = Combat.ammo.shells;
  Game.step(FRAME_DT);
  assert(Combat.ammo.bullets === bBefore + CONFIG.AMMO_PICKUP,
    '1f. PICK-03: an ammo pickup adds exactly CONFIG.AMMO_PICKUP (' + CONFIG.AMMO_PICKUP +
    ') bullets (' + bBefore + ' -> ' + Combat.ammo.bullets + ')');
  assert(Combat.ammo.shells === sBefore,
    '1f-ii. PICK-03: it leaves SHELLS alone (' + Combat.ammo.shells +
    ') — each pickup feeds only its own ammo pool');
})();

// --- 1g SHOTGUN (PICK-04): the refusal, then the grant ----------------------
(function () {
  scenario(OC.x, OC.y);
  isolate('shotgun', OC.x, OC.y);

  // THE CONTROL, captured BEFORE the pickup: the shotgun is refused and nothing
  // mutates. Without this, "selectWeapon succeeded" proves nothing.
  const refused = Combat.selectWeapon(Combat.SHOTGUN);
  assert(refused === false && Combat.weapon === Combat.PISTOL && Combat.hasShotgun === false,
    '1g. CONTROL: before the pickup, Combat.selectWeapon(shotgun) is REFUSED and ' +
    'the weapon stays "' + Combat.weapon + '"');

  const shellsBefore = Combat.ammo.shells;
  Game.step(FRAME_DT);
  assert(Combat.hasShotgun === true,
    '1g-ii. PICK-04: the shotgun pickup sets Combat.hasShotgun');
  assert(Combat.ammo.shells === shellsBefore + CONFIG.SHOTGUN_PICKUP_SHELLS,
    '1g-iii. PICK-04: it adds exactly CONFIG.SHOTGUN_PICKUP_SHELLS (' +
    CONFIG.SHOTGUN_PICKUP_SHELLS + ') shells (' + shellsBefore + ' -> ' +
    Combat.ammo.shells + ')');

  const granted = Combat.selectWeapon(Combat.SHOTGUN);
  assert(granted === true && Combat.weapon === Combat.SHOTGUN,
    '1g-iv. PICK-04: the IDENTICAL selectWeapon call that was refused above now ' +
    'SUCCEEDS — the weapon is "' + Combat.weapon + '"');

  // And it is genuinely usable, not just selectable: the shells it came with fire.
  const firedShells = Combat.ammo.shells;
  Weapons.fire();
  assert(Combat.ammo.shells === firedShells - 1,
    '1g-v. PICK-04: the granted shotgun actually FIRES, spending one of the shells ' +
    'the pickup came with (' + firedShells + ' -> ' + Combat.ammo.shells + ')');
})();

// --- 1h ONE-SHOT (PICK-05, threat T-05-21) ----------------------------------
(function () {
  scenario(OC.x, OC.y, 1, 0);
  const target = isolate('health', OC.x + 2.0, OC.y);

  // The CONTROL FIRST: at this exact pose the ACTIVE pickup draws real pixels.
  // Everything below measures against this frame, so the "0 pixels" claim cannot
  // be vacuously true because the item was off-screen all along.
  const frameActive = renderWorld();
  target.active = false;
  const frameInactive = renderWorld();
  const drawnPixels = diffCount(frameActive, frameInactive);
  assert(drawnPixels > 0,
    '1h. CONTROL: an ACTIVE pickup 2.0 cells ahead draws ' + drawnPixels +
    ' pixels into the framebuffer (the measurement is live)');

  // Now collect it for real.
  target.active = true;
  Player.x = target.x;
  Game.step(FRAME_DT);
  assert(target.active === false,
    '1h-ii. PICK-05: collecting sets active FALSE in the same operation that ' +
    'applies the effect');

  // Standing ON it for 120 further frames must change nothing at all.
  const snap = {
    health: Combat.health, armor: Combat.armor,
    bullets: Combat.ammo.bullets, shells: Combat.ammo.shells,
    hasShotgun: Combat.hasShotgun,
    collected: Pickups.collected, sounds: Sound.count,
    posted: Game.messagesPosted
  };
  simFrames(120);
  const same = Combat.health === snap.health && Combat.armor === snap.armor &&
    Combat.ammo.bullets === snap.bullets && Combat.ammo.shells === snap.shells &&
    Combat.hasShotgun === snap.hasShotgun &&
    Pickups.collected === snap.collected && Sound.count === snap.sounds &&
    Game.messagesPosted === snap.posted && target.active === false;
  assert(same,
    '1h-iii. PICK-05: standing ON the collected pickup for 120 MORE frames changes ' +
    'NOTHING — health ' + Combat.health + ', collections ' + Pickups.collected +
    ', sounds ' + Sound.count + ', messages ' + Game.messagesPosted +
    ' (it can never be collected twice)');

  // And it has stopped drawing: back at the ORIGINAL pose, the frame is
  // byte-identical to the inactive control frame.
  Player.x = OC.x;
  Player.y = OC.y;
  Player.setDir(1, 0);
  const frameCollected = renderWorld();
  assert(diffCount(frameCollected, frameInactive) === 0,
    '1h-iv. PICK-05: from the SAME pose the collected pickup draws ZERO pixels — ' +
    'the frame is byte-identical to the inactive control (against ' + drawnPixels +
    ' pixels when active)');
})();

// --- 1i EVENTS (PICK-05): one message and one sound, naming the item --------
(function () {
  // The word each message must contain — written out here, INDEPENDENTLY of the
  // effect table, so "the text names the item" is a real claim.
  const NAMES_IN_TEXT = {
    health: 'MEDIKIT', armor: 'ARMOR', ammo: 'CLIP', shotgun: 'SHOTGUN'
  };
  const seenTexts = [];
  const seenSounds = [];
  let allOk = true, offender = null;

  for (const type of PICK_TYPES) {
    scenario(OC.x, OC.y);
    isolate(type, OC.x, OC.y);
    Game.step(FRAME_DT);

    const msg = Game.activeMessage();
    const ok = Game.messagesPosted === 1 && msg !== null &&
      msg.text.indexOf(NAMES_IN_TEXT[type]) >= 0 &&
      Sound.count === 1 && typeof Sound.last === 'string' && Sound.last.length > 0;
    if (!ok) { allOk = false; offender = type + ' msg=' + (msg && msg.text) + ' sounds=' + Sound.count; }
    seenTexts.push(msg ? msg.text : '(none)');
    seenSounds.push(Sound.last);
  }

  assert(allOk,
    '1i. PICK-05: each of the four collections enqueues EXACTLY ONE message whose ' +
    'text names the item, and calls the Sound hook EXACTLY ONCE' +
    (allOk ? ' [' + seenTexts.join(' | ') + ']' : ' — offender ' + offender));

  const distinctTexts = new Set(seenTexts).size === PICK_TYPES.length;
  const distinctSounds = new Set(seenSounds).size === PICK_TYPES.length;
  assert(distinctTexts && distinctSounds,
    '1i-ii. PICK-05: the four messages and the four sound names are PAIRWISE ' +
    'DISTINCT (' + seenSounds.join(',') + ') — the hook is per-ITEM, not one ' +
    'generic "pickup" event');

  // The falsifiability control for the sound hook: a rejected name records nothing,
  // so Sound.count is a real measurement rather than a call counter that always ticks.
  const before = Sound.count;
  const rejected = Sound.play('');
  assert(rejected === false && Sound.count === before,
    '1i-iii. CONTROL: Sound.play with an empty name records NOTHING (count stays ' +
    Sound.count + ') — the counter measures real events');
})();

// --- 1j ALLOCATION (threat T-05-27) -----------------------------------------
(function () {
  scenario(OC.x, OC.y);
  const entitiesBefore = Entities.list.length;
  const viewBefore = Pickups.list.length;
  const total = Pickups.list.length;

  // Teleport onto every pickup in the level in turn and take it.
  for (const e of Pickups.list) {
    Player.x = e.x;
    Player.y = e.y;
    Game.step(FRAME_DT);
  }
  // Then run a long stretch of frames with the scan over a fully-collected list.
  simFrames(300);

  assert(Pickups.collected === total && total > 0,
    '1j. every pickup in the level (' + total + ') was collected by walking onto it (' +
    Pickups.collected + ')');
  assert(Entities.list.length === entitiesBefore && Pickups.list.length === viewBefore,
    '1j-ii. Entities.list (' + Entities.list.length + ') and Pickups.list (' +
    Pickups.list.length + ') are UNCHANGED after every pickup was collected and 300 ' +
    'further frames ran — nothing is allocated or removed per collection');

  let allInactive = true;
  for (const e of Pickups.list) if (e.active !== false) allInactive = false;
  assert(allInactive,
    '1j-iii. every collected pickup is inactive — the objects stay in the list for ' +
    'reuse and the sprite pass skips them for free');

  // The DELTA GUARD, in the same shape every other module's has: one bad frame
  // delta must leave the world byte-identical.
  scenario(OC.x, OC.y);
  isolate('health', OC.x, OC.y);
  const guardSnap = { collected: Pickups.collected, health: Combat.health };
  for (const bad of [NaN, Infinity, -Infinity, -1]) Pickups.update(bad);
  assert(Pickups.collected === guardSnap.collected && Combat.health === guardSnap.health,
    '1j-iv. a non-finite or negative dt collects NOTHING (' + Pickups.collected +
    ' collections) — the delta guard matches Player/Enemies/Weapons');
  Pickups.update(FRAME_DT);
  assert(Pickups.collected === guardSnap.collected + 1,
    '1j-v. CONTROL: the SAME call with a good dt collects the item that was sitting ' +
    'under the player the whole time — the guard rejected the delta, not the contact');
})();

// --- 1k REBUILD IDENTITY (the stale-view gate) ------------------------------
(function () {
  scenario(OC.x, OC.y);
  const census = markerCensus();

  // Collect one pickup, remembering WHICH CELL it stood on (the object itself is
  // about to be replaced by the rebuild).
  const victim = Pickups.list[0];
  const cellX = victim.x, cellY = victim.y, cellType = victim.itemType;
  Player.x = cellX;
  Player.y = cellY;
  Game.step(FRAME_DT);
  assert(victim.active === false,
    '1k. setup: the pickup at (' + cellX + ',' + cellY + ') was collected');

  // THE REBUILD. Enemies.reset() re-runs Entities.build() (a FRESH list) and then
  // Pickups.build() in the same breath — the hook 05-01 put there for this.
  Enemies.reset();
  Enemies.list.length = 0;

  let allLive = true;
  for (const e of Pickups.list) if (Entities.list.indexOf(e) < 0) allLive = false;
  assert(allLive,
    '1k-ii. after Enemies.reset() EVERY Pickups.list entry is still a strict-reference ' +
    'member of the CURRENT Entities.list — no orphans');
  assert(Pickups.list.length === census.total,
    '1k-iii. Pickups.list.length is still the pickup marker count (' +
    Pickups.list.length + '/' + census.total + ') — the rebuild replaced, it did not append');

  // The world was rebuilt, so the item is back on the floor and collectable again.
  let reborn = null;
  for (const e of Pickups.list) {
    if (e.x === cellX && e.y === cellY && e.itemType === cellType) reborn = e;
  }
  assert(reborn !== null && reborn !== victim && reborn.active === true,
    '1k-iv. the collected pickup is a NEW, ACTIVE entity after the rebuild (a rebuilt ' +
    'world resurrects its items, exactly as it resurrects its enemies)');
  Player.x = cellX;
  Player.y = cellY;
  Game.step(FRAME_DT);
  assert(reborn.active === false && Pickups.collected === 1,
    '1k-v. and it is collectable AGAIN (' + Pickups.collected + ' collection since the rebuild)');

  // THE CONTROL — the exact failure the rebuild hook prevents. Calling
  // Entities.build() directly, WITHOUT rebuilding the view, leaves the view holding
  // objects that are no longer in the world: simulated, but never drawn.
  Entities.build();
  let orphans = 0;
  for (const e of Pickups.list) if (Entities.list.indexOf(e) < 0) orphans += 1;
  assert(orphans > 0,
    '1k-vi. CONTROL: rebuilding Entities WITHOUT rebuilding the view orphans ' +
    orphans + ' of ' + Pickups.list.length + ' entries — that is precisely the ' +
    'stale-view failure Enemies.reset()\'s Pickups.build() hook exists to prevent');

  // Restore a coherent world for anything that follows.
  Enemies.reset();
  Enemies.list.length = 0;
  let restored = true;
  for (const e of Pickups.list) if (Entities.list.indexOf(e) < 0) restored = false;
  assert(restored,
    '1k-vii. re-running the rebuild PAIR restores the view to the live entities');
})();

finish('ALL_PICKUP_CONTRACTS_PASS');
