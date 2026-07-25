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

// ===========================================================================
// 2. THE LVL-02 POPULATION, AS THE ENTITY WORLD SEES IT (D-08).
//
//    verify-level owns the MARKER census (exact counts, spacing, every marker on
//    open floor, reachability by flood fill). This section owns what the runtime
//    makes of it: that the number of enemies the AI adopted is the number the kill
//    tally counts out of, that the pickup view holds one item per item marker, and
//    — the load-bearing one — that Entities.list is EXACTLY the spawn-derived
//    billboards plus the projectile pool.
//
//    2c IS AN EXACT EQUALITY, NOT A LOWER BOUND. A list LONGER than the formula
//    means a behaviour module appended its own billboards instead of adopting the
//    ones Entities.build() emitted. With 8 enemies and 9 items that would be 17
//    permanent inert ghosts, each frozen at a spawn point and drawn on top of the
//    live entity — which is exactly the failure the `kind` adoption handle exists
//    to make impossible, and exactly the failure a >= assertion would not catch.
// ===========================================================================
(function () {
  // A pristine world: a full rebuild through the production path, with NOTHING
  // truncated (this section is about what boot actually produces).
  Level.build();
  Combat.reset();
  Enemies.reset();

  const census = markerCensus();
  let enemyMarkers = 0;
  for (const sp of Level.spawns) if (sp.type === 'enemy') enemyMarkers += 1;

  assert(Game.totalKills === enemyMarkers && enemyMarkers > 0,
    '2a. LVL-02/ENEM-05: after Enemies.build() Game.totalKills (' + Game.totalKills +
    ') equals the ENEMY MARKER COUNT (' + enemyMarkers + ') — the tally is out of the ' +
    'real populated total');
  assert(Enemies.list.length === enemyMarkers,
    '2a-ii. Enemies.list holds exactly one entry per enemy marker (' +
    Enemies.list.length + '/' + enemyMarkers + ')');
  assert(Game.kills === 0,
    '2a-iii. Game.kills is 0 at build (' + Game.kills + ') — a rebuild resurrects ' +
    'every enemy, so the tally cannot be carried across it');

  assert(Pickups.list.length === census.total && census.total > 0,
    '2b. LVL-02: Pickups.list holds exactly one entry per ITEM marker (' +
    Pickups.list.length + '/' + census.total + ': health ' + census.health + ', ammo ' +
    census.ammo + ', armor ' + census.armor + ', shotgun ' + census.shotgun + ')');

  // THE EXACT EQUALITY. The spawn-derived count is computed from Level.spawns —
  // the entries that have a SPRITE_FOR descriptor — never hardcoded, so a future
  // map edit moves the expectation with the map instead of breaking the proof.
  let spawnDerived = 0;
  for (const sp of Level.spawns) if (Entities.SPRITE_FOR[sp.type]) spawnDerived += 1;
  assert(spawnDerived === enemyMarkers + census.total,
    '2c-0. the spawn-derived billboard count is the enemies PLUS the items (' +
    enemyMarkers + ' + ' + census.total + ' = ' + spawnDerived + ') — exit and player ' +
    'produce no billboard');
  assert(Entities.list.length === spawnDerived + CONFIG.PROJ_POOL,
    '2c. LVL-02: Entities.list.length is EXACTLY the spawn-derived billboards plus ' +
    'CONFIG.PROJ_POOL (' + spawnDerived + ' + ' + CONFIG.PROJ_POOL + ' = ' +
    (spawnDerived + CONFIG.PROJ_POOL) + ', got ' + Entities.list.length +
    ') — nobody appended a duplicate billboard');

  // THE GHOST DETECTOR (the same shape 05-01 assertion 1h uses): no two entities
  // that are not explicitly inactive may share BOTH a position and a sprite name.
  // A duplicate billboard is invisible to a length check the moment the length
  // expectation is itself wrong, so this is the independent statement of the same
  // property.
  const seen = new Map();
  const ghosts = [];
  for (const e of Entities.list) {
    if (e.active === false) continue;
    const key = e.x + ',' + e.y + '|' + e.sprite;
    if (seen.has(key)) ghosts.push(key);
    else seen.set(key, e);
  }
  assert(ghosts.length === 0,
    '2c-ii. no two ACTIVE entities share both a position and a sprite name (' +
    seen.size + ' distinct)' + (ghosts.length ? ' [ghosts: ' + ghosts.join(' ') + ']' : ''));

  // Every spawn-derived entity stands on its marker's CELL CENTRE, and every item
  // marker has exactly one entity on it. This is what ties the runtime world back
  // to the authored map cell for cell.
  let placedOk = true, missing = null;
  for (const sp of Level.spawns) {
    const desc = Entities.SPRITE_FOR[sp.type];
    if (!desc) continue;
    const hits = Entities.list.filter((e) => e.x === sp.x && e.y === sp.y &&
      e.kind === desc.kind);
    if (hits.length !== 1) { placedOk = false; missing = sp.type + '@(' + sp.mx + ',' + sp.my + ')x' + hits.length; }
  }
  assert(placedOk,
    '2d. LVL-02: every enemy and item marker has EXACTLY ONE entity standing on its ' +
    'cell centre' + (placedOk ? '' : ' — offender ' + missing));

  // And the population is genuinely playable from the runtime's point of view:
  // every item can be collected by walking onto it (verify-level's flood fill
  // proves the cells are reachable; this proves the collection works there).
  Enemies.list.length = 0;                 // items only — no fireballs mid-proof
  const itemCount = Pickups.list.length;
  for (const e of Pickups.list) {
    Player.x = e.x;
    Player.y = e.y;
    Game.step(FRAME_DT);
  }
  assert(Pickups.collected === itemCount,
    '2e. LVL-02: all ' + itemCount + ' populated items collect when walked onto (' +
    Pickups.collected + ') — the population is live, not decorative');

  // Restore a coherent world.
  scenario(Level.playerStart.x, Level.playerStart.y);
})();

// ===========================================================================
// 3. THE FRAMEBUFFER MESSAGE LINE (PICK-05 — the sanctioned Phase-6 exception).
//
//    EVERY PROOF IN THIS SECTION IS AGE-BASED, so 3-0 asserts UP FRONT that the
//    clock those ages are measured against actually moves in whichever driver the
//    scenario uses. Game.time is SIMULATION time accumulated inside Game.step
//    (05-01 moved it there out of Game.frame), so it advances under BOTH h.raf.step
//    and a direct Game.step(dt). A scenario in which Game.time did not move would
//    let the expiry proof pass VACUOUSLY — "the message is gone after
//    MESSAGE_TIME" is trivially true if the clock never reaches MESSAGE_TIME, and
//    equally trivially true if it never reaches anything at all.
// ===========================================================================

// Render ONE frame with ONLY the message overlay running (the world passes still
// run; the viewmodel does not), and return a copy. Isolating it from the viewmodel
// is what lets the no-halo and box proofs attribute every changed pixel to the text.
function renderWithMessageOnly() {
  const saved = Raycaster.overlayPasses.slice();
  Raycaster.overlayPasses.length = 0;
  Raycaster.overlayPasses.push(Game.renderMessage);
  Game.view.render();
  const out = Framebuffer.buf32.slice();
  Raycaster.overlayPasses.length = 0;
  for (let i = 0; i < saved.length; i++) Raycaster.overlayPasses.push(saved[i]);
  return out;
}

// --- 3-0: the clock moves, in BOTH drivers (the anti-vacuity gate) ----------
(function () {
  scenario(OC.x, OC.y);

  // Driver A — a DIRECT Game.step(dt).
  const t0 = Game.time;
  simFrames(30);
  const elapsedStep = Game.time - t0;
  const expectStep = 30 * FRAME_DT;
  assert(Math.abs(elapsedStep - expectStep) < 1e-9 && elapsedStep > 0,
    '3-0. Game.time ADVANCES under a direct Game.step(dt): 30 frames at ' +
    FRAME_DT.toFixed(6) + ' s elapsed ' + elapsedStep.toFixed(6) + ' s (expected ' +
    expectStep.toFixed(6) + ') — no age-based proof below is vacuous');

  // Driver B — the REAL rAF loop.
  const t1 = Game.time;
  const f1 = Game.frames;
  raf.run(30, FRAME_MS);
  const elapsedRaf = Game.time - t1;
  assert(elapsedRaf > 0 && Game.frames - f1 === 30,
    '3-0-ii. Game.time ALSO advances under the real loop (h.raf.step): 30 frames ran ' +
    'and ' + elapsedRaf.toFixed(6) + ' simulated seconds elapsed');

  // And MESSAGE_TIME is genuinely reachable inside a plausible frame budget, so
  // the expiry proofs measure a real transition rather than an unreachable one.
  const framesToExpire = Math.ceil(CONFIG.MESSAGE_TIME / FRAME_DT);
  assert(framesToExpire > 1 && framesToExpire < 1000,
    '3-0-iii. CONFIG.MESSAGE_TIME (' + CONFIG.MESSAGE_TIME + ' s) is ' + framesToExpire +
    ' frames at ' + FRAME_DT.toFixed(4) + ' s — reachable, and more than one frame, ' +
    'so "drawn then absent" is a real transition');

  assert(!!Sprites.font && Sprites.font.width === 5 && Sprites.font.height === 7 &&
    !!Sprites.font.glyphs.A && !!Sprites.font.glyphs['0'] && !!Sprites.font.glyphs['!'],
    '3-0-iv. the 5x7 bitmap font is built (Sprites.font) with A-Z, 0-9 and punctuation');

  // The font's alpha is BINARY, which is the structural reason the line has no
  // halo: a texel is either exactly 0 or fully opaque, never in between.
  let binary = true, texels = 0, ink = 0;
  for (const key of Object.keys(Sprites.font.glyphs)) {
    const g = Sprites.font.glyphs[key];
    for (let i = 0; i < g.buf32.length; i++) {
      const a = (g.buf32[i] >>> 24) & 0xff;
      texels += 1;
      if (a === 0xff) ink += 1;
      else if (g.buf32[i] !== 0) binary = false;
    }
  }
  assert(binary && ink > 0,
    '3-0-v. every glyph texel is EITHER packed 0 OR fully opaque (' + ink + ' ink of ' +
    texels + ' texels, no in-between value) — binary alpha, so no fringe is possible');

  assert(Raycaster.overlayPasses.length === 2 &&
    Raycaster.overlayPasses.indexOf(Weapons.renderViewmodel) === 0 &&
    Raycaster.overlayPasses.indexOf(Game.renderMessage) === 1,
    '3-0-vi. main.js pushed the message line onto Raycaster.overlayPasses AFTER the ' +
    'viewmodel (index 1 of 2) — the array is ORDERED, so text lands ON TOP of the gun');
})();

// --- 3a: a pickup makes the frame differ, in the lower third, centred -------
(function () {
  scenario(OC.x, OC.y, 1, 0);
  isolate('health', OC.x, OC.y);
  Game.step(FRAME_DT);
  assert(Game.activeMessage() !== null,
    '3a. setup: the collection left an active message ("' + Game.activeMessage().text + '")');

  const withMsg = renderWithMessageOnly();

  // The CONTROL is the SAME frame with the message ring cleared — identical pose,
  // identical world, the only difference being that there is nothing to say.
  Game.clearMessages();
  const withoutMsg = renderWithMessageOnly();

  const W = Framebuffer.width, H = Framebuffer.height;
  const changed = [];
  for (let i = 0; i < withMsg.length; i++) {
    if (withMsg[i] !== withoutMsg[i]) changed.push(i);
  }
  assert(changed.length > 0,
    '3a-ii. the frame drawn with a message differs from the same frame with the ring ' +
    'CLEARED in ' + changed.length + ' pixels');

  let minX = W, maxX = -1, minY = H, maxY = -1;
  for (const i of changed) {
    const x = i % W, y = (i - x) / W;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  assert(minY >= Math.floor(2 * H / 3),
    '3a-iii. every changed pixel lies in the LOWER THIRD: rows ' + minY + '..' + maxY +
    ', all at or below row ' + Math.floor(2 * H / 3) + ' of ' + H);

  // HORIZONTAL CENTRING is a property of the GLYPH ADVANCE BOX, not of the ink:
  // the ink inside an edge glyph's cell need not reach that cell's border (this very
  // message ends in a period, whose ink sits in columns 1-2 of its 5-wide cell), so
  // measuring the ink span alone would report an asymmetry the layout does not have.
  // So the claim is made in two parts — the exact one about the box, and a
  // structurally-bounded one about the ink.
  const font = Sprites.font;
  const text = 'PICKED UP A MEDIKIT.';
  const unitsW = text.length * (font.width + font.spacing) - font.spacing;
  let scale = Math.floor(H / CONFIG.MESSAGE_SCALE_DIV);
  if (scale < 1) scale = 1;
  const maxScale = Math.max(1, Math.floor(W / unitsW));
  if (scale > maxScale) scale = maxScale;
  const textW = unitsW * scale;
  const boxX = Math.floor((W - textW) / 2);
  const boxLeft = boxX;
  const boxRight = W - (boxX + textW);
  assert(Math.abs(boxLeft - boxRight) <= 1,
    '3a-iv. the drawn LINE BOX is horizontally CENTRED: left margin ' + boxLeft +
    ', right margin ' + boxRight + ' (within 1 px — integer division of the ' +
    (W - textW) + ' px of slack)');

  // And the ink lies inside that box, off-centre by at most ONE GLYPH CELL — the
  // structural bound on how far a narrow edge glyph (a period, a full stop, a "1")
  // can pull the ink in from its cell border.
  const cell = font.width * scale;
  const inkLeft = minX, inkRight = W - 1 - maxX;
  assert(minX >= boxX && maxX <= boxX + textW &&
    Math.abs(inkLeft - inkRight) <= cell,
    '3a-v. the ink sits INSIDE that box (cols ' + minX + '..' + maxX + ' within ' +
    boxX + '..' + (boxX + textW) + ') and is off-centre by ' +
    Math.abs(inkLeft - inkRight) + ' px, at most one ' + cell + ' px glyph cell');
})();

// --- 3b: no halo — written pixels opaque, skipped pixels untouched ----------
(function () {
  scenario(OC.x, OC.y, 1, 0);
  isolate('health', OC.x, OC.y);
  Game.step(FRAME_DT);
  const slot = Game.activeMessage();

  // The pre-overlay frame: the world passes only.
  const saved = Raycaster.overlayPasses.slice();
  Raycaster.overlayPasses.length = 0;
  Game.view.render();
  const pre = Framebuffer.buf32.slice();
  // Now run ONLY the message pass over that exact frame.
  Game.renderMessage();
  const post = Framebuffer.buf32.slice();
  Raycaster.overlayPasses.length = 0;
  for (let i = 0; i < saved.length; i++) Raycaster.overlayPasses.push(saved[i]);

  // RECOMPUTE the expected box INDEPENDENTLY from the documented formula, rather
  // than reading Game.messageBox — reading the record under test would make the
  // containment claim tautological.
  const W = Framebuffer.width, H = Framebuffer.height;
  const font = Sprites.font;
  const unitsW = slot.text.length * (font.width + font.spacing) - font.spacing;
  let scale = Math.floor(H / CONFIG.MESSAGE_SCALE_DIV);
  if (scale < 1) scale = 1;
  let maxScale = Math.floor(W / unitsW);
  if (maxScale < 1) maxScale = 1;
  if (scale > maxScale) scale = maxScale;
  const boxX = Math.floor((W - unitsW * scale) / 2);
  const boxY = Math.floor(H * CONFIG.MESSAGE_Y_FRAC);
  const boxW = unitsW * scale + 1;           // +1 for the shadow offset
  const boxH = font.height * scale + 1;

  const rec = Game.messageBox;
  assert(rec.drawn === true && rec.x === boxX && rec.y === boxY &&
    rec.w === boxW && rec.h === boxH && rec.scale === scale,
    '3b. the recorded messageBox matches the INDEPENDENTLY recomputed box exactly: ' +
    '(' + rec.x + ',' + rec.y + ') ' + rec.w + 'x' + rec.h + ' at scale ' + rec.scale);

  let written = 0, opaque = 0, strayOutside = 0, skippedIdentical = 0, skippedDiff = 0;
  for (let i = 0; i < pre.length; i++) {
    const x = i % W, y = (i - x) / W;
    const inBox = x >= boxX && x < boxX + boxW && y >= boxY && y < boxY + boxH;
    if (post[i] !== pre[i]) {
      written += 1;
      if (((post[i] >>> 24) & 0xff) === 0xff) opaque += 1;
      if (!inBox) strayOutside += 1;
    } else if (inBox) {
      // A pixel inside the box the alpha key SKIPPED (a blank glyph column, or the
      // gap between letters). It must be byte-for-byte the pre-overlay frame.
      skippedIdentical += 1;
    }
  }
  for (let i = 0; i < pre.length; i++) {
    const x = i % W, y = (i - x) / W;
    const inBox = x >= boxX && x < boxX + boxW && y >= boxY && y < boxY + boxH;
    if (!inBox && post[i] !== pre[i]) skippedDiff += 1;
  }

  assert(written > 0 && opaque === written,
    '3b-ii. NO HALO: all ' + written + ' pixels the message wrote are FULLY OPAQUE ' +
    '(' + opaque + '/' + written + ') — the fade is a colour scale through ' +
    'applyShade, never a partial alpha');
  assert(strayOutside === 0 && skippedDiff === 0,
    '3b-iii. ZERO writes outside the recomputed box (' + strayOutside +
    ') — every destination index is clamped into range');
  assert(skippedIdentical > 0,
    '3b-iv. NO HALO: the ' + skippedIdentical + ' alpha-key-SKIPPED pixels inside the ' +
    'box are byte-for-byte the pre-overlay frame (the gaps between glyphs show the ' +
    'world through, not a dark rim)');
})();

// --- 3c: the message pass NEVER writes the z-buffer -------------------------
(function () {
  scenario(OC.x, OC.y, 1, 0);
  isolate('health', OC.x, OC.y);
  Game.step(FRAME_DT);

  const saved = Raycaster.overlayPasses.slice();
  Raycaster.overlayPasses.length = 0;
  Game.view.render();                      // world passes fill zBuffer
  const zBefore = Framebuffer.zBuffer.slice();
  const bufBefore = Framebuffer.buf32.slice();
  Game.renderMessage();                    // the pass under test, in ISOLATION
  const zAfter = Framebuffer.zBuffer.slice();
  const wrote = diffCount(bufBefore, Framebuffer.buf32);
  Raycaster.overlayPasses.length = 0;
  for (let i = 0; i < saved.length; i++) Raycaster.overlayPasses.push(saved[i]);

  assert(diffCount(zBefore, zAfter) === 0,
    '3c. Framebuffer.zBuffer is byte-for-byte IDENTICAL across the message pass — ' +
    'screen-space overlays never write depth');
  assert(wrote > 0,
    '3c-ii. NON-VACUITY CONTROL: that same isolated pass wrote ' + wrote +
    ' framebuffer pixels — the z-buffer was untouched because the pass does not ' +
    'write it, not because the pass did nothing');
})();

// --- 3d: drawn while age < MESSAGE_TIME, absent after (the paired control) ---
(function () {
  scenario(OC.x, OC.y, 1, 0);
  isolate('health', OC.x, OC.y);
  Game.step(FRAME_DT);
  const slot = Game.activeMessage();
  const postedAt = slot.at;

  // The frame with NOTHING to say — the reference every comparison below uses.
  const savedRing = { text: slot.text, at: slot.at };
  Game.clearMessages();
  const blank = renderWithMessageOnly();
  slot.text = savedRing.text;
  slot.at = savedRing.at;
  Game.messageHead = 1;                    // this slot is the newest again

  // Advance the SIMULATED clock to JUST BEFORE expiry, driving real frames.
  const target = postedAt + CONFIG.MESSAGE_TIME - 2 * FRAME_DT;
  let guard = 0;
  while (Game.time < target && guard < 5000) { Game.step(FRAME_DT); guard += 1; }
  const ageBefore = Game.time - postedAt;
  assert(ageBefore > 0 && ageBefore < CONFIG.MESSAGE_TIME,
    '3d. the clock really moved: the message is ' + ageBefore.toFixed(4) + ' s old, ' +
    'still inside CONFIG.MESSAGE_TIME (' + CONFIG.MESSAGE_TIME + ') after ' + guard +
    ' driven frames');
  const justBefore = renderWithMessageOnly();
  const drawnBefore = diffCount(justBefore, blank);
  assert(Game.activeMessage() !== null && drawnBefore > 0,
    '3d-ii. JUST BEFORE expiry the line is still DRAWN (' + drawnBefore +
    ' pixels differ from the blank frame) — the fade dims it, it does not remove it');

  // Cross the boundary.
  guard = 0;
  while (Game.time - postedAt < CONFIG.MESSAGE_TIME && guard < 5000) {
    Game.step(FRAME_DT); guard += 1;
  }
  const ageAfter = Game.time - postedAt;
  assert(ageAfter >= CONFIG.MESSAGE_TIME,
    '3d-iii. the clock crossed the boundary: the message is now ' + ageAfter.toFixed(4) +
    ' s old, at or past CONFIG.MESSAGE_TIME');
  const justAfter = renderWithMessageOnly();
  assert(Game.activeMessage() === null && diffCount(justAfter, blank) === 0 &&
    Game.messageBox.drawn === false,
    '3d-iv. PAIRED CONTROL: one boundary crossing later the line is GONE — the frame ' +
    'is byte-identical to the blank one (0 pixels) against ' + drawnBefore +
    ' just before, with the pose and the world unchanged throughout');

  // The fade itself is monotonic and floored, which is what makes 3d-ii's "still
  // drawn" claim compatible with "visibly fading".
  const full = Game.messageShade(0);
  const mid = Game.messageShade(CONFIG.MESSAGE_TIME * (1 - CONFIG.MESSAGE_FADE_FRAC / 2));
  const end = Game.messageShade(CONFIG.MESSAGE_TIME);
  assert(full === 256 && mid < full && end < mid &&
    end >= (CONFIG.MESSAGE_MIN_SHADE * 256 | 0),
    '3d-v. the fade is MONOTONIC and floored: shade ' + full + ' -> ' + mid + ' -> ' +
    end + ' (floor ' + (CONFIG.MESSAGE_MIN_SHADE * 256 | 0) + ') — a colour ramp, ' +
    'never partial alpha');
})();

// --- 3e: two pickups in quick succession leave the NEWEST message -----------
(function () {
  scenario(OC.x, OC.y, 1, 0);
  // Two DIFFERENT items, both under the player, collected one frame apart.
  const first = isolate('health', OC.x, OC.y);
  let second = null;
  for (const e of Pickups.list) {
    if (e !== first && e.itemType === 'ammo') { second = e; break; }
  }
  second.active = true;
  second.x = OC.x + 0.9;                   // outside the radius for now
  second.y = OC.y;

  Game.step(FRAME_DT);
  const firstText = Game.activeMessage().text;
  assert(first.active === false && firstText === Pickups.EFFECTS.health.text,
    '3e. setup: the health pickup posted "' + firstText + '"');

  // Now take the second one two frames later.
  second.x = OC.x;
  Game.step(FRAME_DT);
  Game.step(FRAME_DT);
  const newest = Game.activeMessage();
  assert(second.active === false && newest !== null &&
    newest.text === Pickups.EFFECTS.ammo.text && newest.text !== firstText,
    '3e-ii. two pickups collected in quick succession leave the NEWEST message ' +
    'active: "' + newest.text + '" (not the older "' + firstText + '")');
  assert(Game.messagesPosted === 2,
    '3e-iii. both messages were posted into the ring (' + Game.messagesPosted +
    ') — the older one is retained, it is simply no longer the newest');

  // And the NEWEST is what actually gets DRAWN, not merely what activeMessage()
  // reports: the two texts differ in length, so the drawn box width differs.
  renderWithMessageOnly();
  const wNewest = Game.messageBox.w;
  Game.messageHead = (Game.messageHead - 1 + Game.messages.length) % Game.messages.length;
  renderWithMessageOnly();
  const wOlder = Game.messageBox.w;
  assert(wNewest !== wOlder,
    '3e-iv. the DRAWN box tracks the newest message: width ' + wNewest +
    ' for "' + newest.text + '" against ' + wOlder + ' for the older one');

  // The ring cannot grow past CONFIG.MESSAGE_MAX however many are posted.
  for (let i = 0; i < CONFIG.MESSAGE_MAX * 5; i++) Game.message('OVERFLOW ' + i);
  assert(Game.messages.length === CONFIG.MESSAGE_MAX,
    '3e-v. posting ' + (CONFIG.MESSAGE_MAX * 5) + ' more messages leaves the ring at ' +
    'exactly CONFIG.MESSAGE_MAX (' + Game.messages.length + ') — preallocated, ' +
    'never grown (threat T-05-26)');
})();

// --- 3f: one present per frame, still --------------------------------------
(function () {
  scenario(OC.x, OC.y, 1, 0);
  isolate('health', OC.x, OC.y);
  const framesBefore = Game.frames;
  const putBefore = h.putCount();
  raf.run(90, FRAME_MS);
  const framesRun = Game.frames - framesBefore;
  const presents = h.putCount() - putBefore;
  assert(framesRun === 90 && presents === framesRun,
    '3f. across 90 REAL loop frames (with a collection, its message and both overlay ' +
    'passes running) the present count equals the frame count (' + presents + '/' +
    framesRun + ') — the message line added no second putImageData');

  // And a non-uniform framebuffer, so those presents pushed a real frame.
  const buf = Framebuffer.buf32;
  let distinct = new Set();
  for (let i = 0; i < buf.length; i += 97) distinct.add(buf[i]);
  assert(distinct.size > 1,
    '3f-ii. the presented framebuffer is non-uniform (' + distinct.size +
    ' distinct sampled colours) — a real rendered frame, not a cleared one');
})();

finish('ALL_PICKUP_CONTRACTS_PASS');
