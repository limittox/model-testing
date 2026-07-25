/*
 * combat.js — the PLAYER's combat state: health, armor, ammo, weapon selection,
 * and the one function that takes health away from the player.
 *
 * LOAD ORDER: loaded AFTER js/entities.js and BEFORE js/enemies.js and
 * js/game.js (see index.html). It reads CONFIG for every starting value and
 * Game.time for the damage timestamp; it writes nothing to the DOM, holds no
 * canvas and no timers, so the Node vm harness runs this exact file unchanged.
 *
 * WHY THIS IS A SEPARATE GLOBAL FROM Player: js/player.js owns the POSE (where
 * the camera is and where it looks). This file owns the STATS (what the player
 * has and how hurt they are). Keeping them apart is what lets the raycaster and
 * the sprite pass depend on the pose without dragging combat state into the
 * render path — and it gives Phase 6's HUD exactly one object to read.
 *
 * THE ARMOR ABSORPTION FORMULA (05-CONTEXT D-04 — LOCKED). Doom green-armor
 * style: armor eats a fixed FRACTION of each hit, capped by how much armor is
 * left, and the remainder lands on health.
 *
 *     absorbed = min(armor, floor(dmg / CONFIG.ARMOR_ABSORB_DIVISOR))
 *     armor   -= absorbed
 *     health  -= (dmg - absorbed)
 *
 * The clamp to the CURRENT armor is the load-bearing half: 1 point of armor
 * absorbs 1 point of a 12-damage hit, not 4. Written in exactly one place here
 * so plan 05-04's armor pickup and Phase 6's HUD cannot re-derive it differently.
 *
 * THE DEAD FLAG ACTS (D-04). Reaching 0 health LATCHES Combat.dead, and
 * Game.step reads that flag and substitutes Game.ZERO_INTENT before the intent
 * reaches Player.update. A dead player therefore neither moves, turns nor fires
 * while enemies and projectiles keep simulating around the corpse. Phase 6 draws
 * the death screen; this flag is the whole of Phase 5's obligation.
 *
 * FIELDS DECLARED HERE, MUTATED ELSEWHERE (deliberate — one home for the state):
 *   ammo.bullets / ammo.shells / weapon / hasShotgun are declared and reset here.
 *   Plan 05-02 spends and switches them; plan 05-04's pickups grant them.
 *   lastDamageAt / totalDamageTaken exist so Phase 6's damage flash has a real
 *   source rather than a number invented at HUD time.
 */

var Combat = {
  // --- Vitals ---
  health: 0,
  armor: 0,
  maxHealth: 0,
  maxArmor: 0,

  // --- Inventory (declared here; 05-02 spends, 05-04 grants) ---
  ammo: { bullets: 0, shells: 0 },
  weapon: 'pistol',
  hasShotgun: false,

  // --- Damage bookkeeping ---
  dead: false,
  lastDamageAt: -1,      // Game.time of the most recent damaging hit; -1 = never
  totalDamageTaken: 0    // cumulative HEALTH lost (not raw damage) — Phase 6 stat
};

(function () {
  'use strict';

  // The weapon the player starts with. Named here rather than inline so 05-02's
  // switch logic and 05-04's shotgun grant agree on the string.
  Combat.PISTOL = 'pistol';
  Combat.SHOTGUN = 'shotgun';

  // ===========================================================================
  // RESET — seed every field from CONFIG. Called by main.js at boot and by any
  // future restart. Idempotent by construction: it assigns, never accumulates.
  // ===========================================================================
  Combat.reset = function () {
    Combat.maxHealth = CONFIG.PLAYER_MAX_HEALTH;
    Combat.maxArmor = CONFIG.PLAYER_MAX_ARMOR;
    Combat.health = CONFIG.PLAYER_START_HEALTH;
    Combat.armor = CONFIG.PLAYER_START_ARMOR;
    Combat.ammo.bullets = CONFIG.PLAYER_START_BULLETS;
    Combat.ammo.shells = CONFIG.PLAYER_START_SHELLS;
    Combat.weapon = Combat.PISTOL;
    Combat.hasShotgun = false;
    Combat.dead = false;
    Combat.lastDamageAt = -1;
    Combat.totalDamageTaken = 0;
    return Combat;
  };

  // ===========================================================================
  // DAMAGE THE PLAYER (D-04) — the ONE place player health is reduced.
  //
  // Returns the HEALTH actually lost (0 when nothing happened), so a caller can
  // tell a blocked hit from a landed one without reading state back.
  //
  // Guards first, arithmetic second (threat T-05-06): a non-finite or
  // non-positive damage value mutates NOTHING, and an already-dead player takes
  // no further damage — so a stray projectile arriving after death cannot drive
  // health negative or re-stamp lastDamageAt.
  // ===========================================================================
  Combat.damagePlayer = function (dmg) {
    if (!isFinite(dmg) || dmg <= 0) return 0;
    if (Combat.dead) return 0;

    dmg = Math.floor(dmg);
    if (dmg <= 0) return 0;

    // The LOCKED formula. The min() is what clamps absorption to the armor the
    // player actually has.
    var absorbed = Math.floor(dmg / CONFIG.ARMOR_ABSORB_DIVISOR);
    if (absorbed > Combat.armor) absorbed = Combat.armor;
    Combat.armor -= absorbed;

    var toHealth = dmg - absorbed;
    var before = Combat.health;
    Combat.health -= toHealth;
    if (Combat.health <= 0) {
      Combat.health = 0;      // floor at 0 — never a negative readout
      Combat.dead = true;     // LATCHED: Game.step freezes the intent from here
    }

    var lost = before - Combat.health;
    Combat.totalDamageTaken += lost;
    // Simulation time, not wall-clock. Game.time advances inside Game.step, so
    // this is a real, monotonic stamp under both the rAF loop and a direct step.
    Combat.lastDamageAt = (typeof Game !== 'undefined') ? Game.time : 0;
    return lost;
  };

  // ===========================================================================
  // HEAL / ARMOR GRANT — declared here (one home for the vitals) and consumed by
  // plan 05-04's health and armor pickups. Both clamp to their maxima and return
  // the amount actually applied, so a pickup can decide whether it was useful.
  // ===========================================================================

  Combat.heal = function (amount) {
    if (!isFinite(amount) || amount <= 0) return 0;
    var before = Combat.health;
    Combat.health = Math.min(Combat.maxHealth, Combat.health + Math.floor(amount));
    return Combat.health - before;
  };

  // ===========================================================================
  // SELECT A WEAPON (05-CONTEXT D-05/D-10) — the ONE place Combat.weapon changes.
  //
  // Returns whether the selection actually CHANGED, so a caller can decide whether
  // to play a switch sound without reading state back. Three refusals, all silent
  // and all mutating nothing:
  //   . an unknown name (a typo or a future weapon that does not exist yet)
  //   . the shotgun before Combat.hasShotgun has been granted (05-04's pickup)
  //   . re-selecting the weapon already in hand
  //
  // The GRANT GATE lives here rather than in js/weapons.js on purpose: the weapon
  // module owns firing, this file owns the inventory, and "do you own a shotgun"
  // is an inventory question. Putting it here means plan 05-04's shotgun pickup
  // only has to set hasShotgun and every path agrees.
  // ===========================================================================
  Combat.selectWeapon = function (name) {
    if (name !== Combat.PISTOL && name !== Combat.SHOTGUN) return false;
    if (name === Combat.SHOTGUN && !Combat.hasShotgun) return false;
    if (Combat.weapon === name) return false;
    Combat.weapon = name;
    return true;
  };

  Combat.addArmor = function (amount) {
    if (!isFinite(amount) || amount <= 0) return 0;
    var before = Combat.armor;
    Combat.armor = Math.min(Combat.maxArmor, Combat.armor + Math.floor(amount));
    return Combat.armor - before;
  };

})();
