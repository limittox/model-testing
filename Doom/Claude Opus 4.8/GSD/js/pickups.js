/*
 * pickups.js — the typed world items: proximity collection and the four effects.
 *
 * LOAD ORDER: loaded AFTER js/entities.js (it ADOPTS the billboards that builder
 * emitted), js/combat.js (every effect routes through a Combat grant) and
 * js/sound.js (it calls the event hook), and BEFORE js/game.js (whose step
 * dispatches Pickups.update). It reads CONFIG, Player (the pose), Entities,
 * Combat, Game (the message queue) and Sound; it touches no DOM, no canvas and no
 * timers, so the Node vm harness runs this exact file unchanged.
 *
 * ============================================================================
 * ADOPTION, NOT CREATION — the same mechanism js/enemies.js uses
 * ============================================================================
 * Entities.SPRITE_FOR already carries a descriptor for every pickup marker type,
 * so Entities.build() ALREADY emits exactly one billboard per health / armor /
 * ammo / shotgun marker in Level.spawns. Pickups.build() therefore walks
 * Entities.list and records the entities whose `kind` is 'pickup' — the SAME
 * OBJECTS. It never walks Level.spawns and never pushes a second object.
 *
 * Pickups.list is a filtered VIEW of Entities.list. It holds references, never
 * copies, and it is truncated IN PLACE (never reassigned), so its array identity
 * is stable and anything holding a reference keeps watching the live view.
 *
 * ============================================================================
 * WHY build() MUST BE RE-RUNNABLE, AND WHY Enemies.reset() CALLS IT
 * ============================================================================
 * Entities.build() assigns a FRESH Entities.list array. A view captured before a
 * rebuild therefore holds ORPHANED objects: still scanned by this module, but no
 * longer in the list the sprite pass reads, so they would be collectable while
 * invisible — a ghost world. Every derived view must be rebuilt in the same
 * breath as the rebuild.
 *
 * Enemies.reset() calls Pickups.build() under a typeof guard (the hook 05-01 put
 * there for exactly this), so the only thing THIS file has to get right is that
 * build() REBUILDS FROM SCRATCH rather than appending — i.e. that it is
 * idempotent. It truncates first, then re-walks. Calling it twice yields a list
 * of the same length holding the same objects.
 *
 * ============================================================================
 * THE EFFECTS ARE A DATA TABLE, NOT A SWITCH (D-07)
 * ============================================================================
 * Pickups.EFFECTS maps an itemType to the name of the Combat grant to call, the
 * name of the CONFIG constant holding the amount, the message text and the Sound
 * hook name. Two consequences worth having:
 *   . adding an item later is a data edit plus a descriptor in Entities.SPRITE_FOR
 *     — no new branch anywhere;
 *   . the amount is read from CONFIG at COLLECTION TIME through its key, never
 *     captured at load, so a harness that varies the constant around fixed
 *     geometry proves the constant is genuinely live.
 * Every CLAMP lives inside the Combat grant (threat T-05-22). This file names an
 * amount; it never touches health, armor, ammo or hasShotgun directly, so there
 * is no path by which a pickup could push a field past its maximum.
 *
 * COLLECTION IS UNCONDITIONAL ON CONTACT (D-07). A medkit is collected even at
 * full health. Doom skips a full-health pickup; this project deliberately does
 * not, because "walking over it collects it" (PICK-05) is then a statement with
 * NO exceptions — the outcome is a function of position alone and every proof is
 * deterministic. Combat.heal still clamps, so the collection is simply worth 0.
 *
 * NO ALLOCATION OUTSIDE build(). The scan compares SQUARED distances against a
 * squared radius (no square root in the loop) over a list built once, and creates
 * no array, closure or object per frame (threat T-05-27).
 */

var Pickups = {
  // The adoption handle — the `kind` Entities.build() stamps from the descriptor.
  KIND: 'pickup',

  // The filtered VIEW of Entities.list: the same objects, never copies. Truncated
  // IN PLACE by build(), so this array's identity never changes.
  list: [],

  // --- Collection bookkeeping (real records, not debug counters: Phase 6's HUD
  // and the harness both read them, and they are what make "exactly one
  // collection" provable without inspecting the world). ---
  collected: 0,
  lastCollected: null,

  built: false
};

(function () {
  'use strict';

  var has = function (obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  };

  // ===========================================================================
  // THE EFFECT TABLE (D-07). itemType -> what collecting it does.
  //
  //   grant      — the Combat method name. Combat owns every clamp.
  //   amountKey  — the CONFIG key holding the amount, read LIVE at collection
  //                time. null means the grant takes no amount.
  //   text       — the message enqueued through Game.message. UPPERCASE because
  //                the 05-04 bitmap font is an uppercase font (an unknown glyph
  //                renders blank rather than reading out of range).
  //   sound      — the Sound.play hook name. Phase 6 hangs the synthesis on it.
  // ===========================================================================
  Pickups.EFFECTS = {
    health: {
      grant: 'heal',
      amountKey: 'HEALTH_PICKUP',
      text: 'PICKED UP A MEDIKIT.',
      sound: Sound.NAMES.HEALTH
    },
    armor: {
      grant: 'addArmor',
      amountKey: 'ARMOR_PICKUP',
      text: 'PICKED UP ARMOR.',
      sound: Sound.NAMES.ARMOR
    },
    ammo: {
      grant: 'addBullets',
      amountKey: 'AMMO_PICKUP',
      text: 'PICKED UP A CLIP.',
      sound: Sound.NAMES.AMMO
    },
    shotgun: {
      grant: 'grantShotgun',
      amountKey: null,
      text: 'YOU GOT THE SHOTGUN!',
      sound: Sound.NAMES.WEAPON
    }
  };

  // ===========================================================================
  // BUILD — ADOPT the pickup billboards Entities.build() already emitted.
  //
  // Truncates IN PLACE and re-walks from scratch, so it is IDEMPOTENT and safe to
  // re-run after every Entities.build(). It never appends.
  //
  // It also (re)arms every pickup as ACTIVE. Entities.build() emits entities with
  // no `active` property at all, and a rebuild RESURRECTS the world — so a pickup
  // collected before a reset is collectable again afterwards, exactly as a rebuilt
  // enemy is alive again. The counters are zeroed for the same reason 05-03's
  // Enemies.build() zeroes the kill tally: a count carried across a rebuild would
  // be counting items that are back on the floor.
  // ===========================================================================
  Pickups.build = function () {
    // Truncate IN PLACE — never `Pickups.list = []`.
    Pickups.list.length = 0;

    var src = (typeof Entities !== 'undefined' && Entities.list) ? Entities.list : [];
    for (var i = 0; i < src.length; i++) {
      var e = src[i];
      if (e.kind !== Pickups.KIND) continue;
      // A fresh world: every item is on the floor and drawn.
      e.active = true;
      Pickups.list.push(e);
    }

    Pickups.collected = 0;
    Pickups.lastCollected = null;
    Pickups.built = true;
    return Pickups.list;
  };

  // Rebuild the whole entity world and this view with it. Production code (a
  // restart uses it) and the harness's clean scenario primitive. Delegating to
  // Enemies.reset() is deliberate: it is the ONE place that rebuilds the world and
  // every view derived from it TOGETHER, which is the invariant this file exists
  // to protect.
  Pickups.reset = function () {
    if (typeof Enemies !== 'undefined' && Enemies &&
        typeof Enemies.reset === 'function') {
      Enemies.reset();          // calls Entities.build() then Pickups.build()
    } else {
      Pickups.build();
    }
    return Pickups.list;
  };

  // ===========================================================================
  // COLLECT — apply one pickup's effect. The ONE place a pickup is consumed.
  //
  // Returns whether the pickup was actually taken.
  //
  // ORDER (threat T-05-21): the entity is DEACTIVATED FIRST, before the grant
  // runs. Deactivation is then unconditional on anything the grant does or fails
  // to do — there is no ordering in which an effect could be applied while the
  // item stayed on the floor. The scan skips anything whose active flag is not
  // strictly true, so the item is gone from both the world and this loop from
  // this instant on.
  // ===========================================================================
  Pickups.collect = function (e) {
    if (!e || typeof e.itemType !== 'string') return false;
    if (!has(Pickups.EFFECTS, e.itemType)) return false;
    var entry = Pickups.EFFECTS[e.itemType];

    var grant = Combat[entry.grant];
    if (typeof grant !== 'function') return false;

    e.active = false;                    // FIRST — see the ordering note above

    // The amount is read from CONFIG through the table's KEY, at collection time.
    if (entry.amountKey === null) grant.call(Combat);
    else grant.call(Combat, CONFIG[entry.amountKey]);

    Pickups.collected += 1;
    Pickups.lastCollected = e.itemType;

    // THE TWO PHASE-5 EVENTS (PICK-05). The message is queued, not drawn, and the
    // sound is a hook, not audio — Phase 6 owns the HUD and the synthesis. Both
    // are guarded by typeof so this module stays loadable in isolation.
    if (typeof Game !== 'undefined' && Game && typeof Game.message === 'function') {
      Game.message(entry.text);
    }
    if (typeof Sound !== 'undefined' && Sound && typeof Sound.play === 'function') {
      Sound.play(entry.sound);
    }
    return true;
  };

  // ===========================================================================
  // UPDATE — the per-frame proximity scan, dispatched from Game.step.
  //
  // Collection is PROXIMITY-DRIVEN: there is no interact key. Walking over an item
  // takes it (PICK-05).
  //
  // `dt` is not integrated by anything here — position is the only input — but the
  // delta is still GUARDED exactly as Player.update, Enemies.update and
  // Weapons.update guard theirs, so one bad frame delta leaves the world
  // byte-identical across every module rather than in one module only.
  //
  // Returns the number of pickups taken this frame (0 on almost every frame).
  // ===========================================================================
  Pickups.update = function (dt) {
    if (!isFinite(dt) || dt < 0) return 0;

    var list = Pickups.list;
    var n = list.length;
    if (n === 0) return 0;

    // Pose + radius snapshot into locals ONCE (no per-entity property reads).
    var px = Player.x, py = Player.y;
    var r = CONFIG.COLLECT_RADIUS;
    var r2 = r * r;                      // SQUARED on both sides — no sqrt in the loop

    var taken = 0;
    for (var i = 0; i < n; i++) {
      var e = list[i];
      // STRICT: only a genuinely active pickup is collectable. A collected item
      // (active false) can never be seen by this scan again, which is the whole
      // of the "can never be collected twice" guarantee.
      if (e.active !== true) continue;
      var dx = e.x - px;
      var dy = e.y - py;
      if (dx * dx + dy * dy > r2) continue;
      if (Pickups.collect(e)) taken += 1;
    }
    return taken;
  };

})();
