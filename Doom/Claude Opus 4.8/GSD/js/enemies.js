/*
 * enemies.js — the enemy AI: the idle/chase/attack state machine, the shared-slide
 * chase movement, and the pooled ranged fireball.
 *
 * LOAD ORDER: loaded AFTER js/entities.js and js/combat.js (it ADOPTS the
 * entities the sprite builder emitted and calls Combat.damagePlayer) and BEFORE
 * js/game.js (whose step dispatches Enemies.update / Enemies.updateProjectiles).
 * It reads CONFIG, Level (isSolid + lineOfSight), Player (the pose and the shared
 * slide) and Entities; it touches no DOM, no canvas and no timers, so the Node vm
 * harness runs this exact file unchanged.
 *
 * ============================================================================
 * ADOPTION, NOT CREATION — the single most important thing in this file
 * ============================================================================
 * Entities.SPRITE_FOR already carries an `enemy` descriptor, so Entities.build()
 * ALREADY emits exactly one billboard per enemy marker in Level.spawns.
 * Enemies.build() therefore walks Entities.list and stamps behaviour fields onto
 * THOSE SAME OBJECTS (matched by the `kind` field Entities.build copies off the
 * descriptor). It NEVER walks Level.spawns and NEVER pushes a second enemy
 * object.
 *
 * Getting this wrong is not a cosmetic bug: a duplicate would leave an INERT
 * GHOST billboard frozen at every spawn point, drawn every frame on top of the
 * live enemy, killable by nothing and confusing every distance proof. The
 * `kind` field is the general ADOPTION HANDLE — plan 05-04 attaches pickup
 * behaviour to its own entities exactly the same way.
 *
 * Enemies.add(x, y) is the SCENARIO PRIMITIVE for an enemy that has no level
 * marker (a scripted spawn, or a harness-composed scenario). It is production
 * code, not a test hook — but build() does NOT call it, because the
 * spawn-derived enemies already exist as entities.
 *
 * ============================================================================
 * THE STATE MACHINE (05-CONTEXT D-02 — LOCKED)
 * ============================================================================
 *   idle   — stand still until the player is within CONFIG.ENEMY_SIGHT_RANGE AND
 *            Level.lineOfSight is clear, then chase. BOTH gates are real and are
 *            proven separately (a clear view at 14 cells does not wake it).
 *   chase  — walk toward the player at ENEMY_SPEED through the SHARED per-axis
 *            slide, animating the two walk frames; stop closing at
 *            ENEMY_STOP_RANGE; enter attack on sight + range + elapsed cooldown.
 *   attack — show the attack frame for ENEMY_ATTACK_WINDUP, then RE-TEST line of
 *            sight and only then release the fireball, and return to chase.
 *   pain   — a brief stagger on the pain frame, entered ONLY EXTERNALLY from
 *            hurt() on a CONFIG.ENEMY_PAIN_CHANCE roll after a NON-LETHAL hit.
 *            The update loop never enters pain on its own. It moves nothing and
 *            attacks nothing, and resumes into chase — including when it
 *            interrupted idle, because being shot wakes an enemy up.
 *
 * PAIN ZEROES THE WINDUP AND LEAVES THE COOLDOWN ALONE. Zeroing the windup is
 * what makes the stagger genuinely interrupt an attack in progress; leaving the
 * cooldown is what stops a player from handing the enemy a free immediate attack
 * by shooting it mid-cooldown (threat T-05-19). And because the lethal branch of
 * hurt() returns BEFORE the roll, pain can never trigger on the killing blow.
 *
 * THE COOLDOWN IS TAKEN ON ENTERING ATTACK, not at the end of the windup. That
 * makes the firing period exactly ENEMY_ATTACK_COOLDOWN, which is what the
 * requirement says ("exactly one fireball per ENEMY_ATTACK_COOLDOWN"); charging
 * it at the end of the windup would silently make the real period
 * COOLDOWN + WINDUP and drift a whole shot behind over a long fight.
 *
 * THE WINDUP RE-TEST IS NOT OPTIONAL. Testing line of sight only on ENTRY to the
 * attack state is the classic "enemy shoots you through a wall" bug: the player
 * steps behind cover during the 0.35 s telegraph and gets hit anyway. Sight is
 * therefore tested twice — once to enter, once to release (threat T-05-07).
 *
 * ============================================================================
 * THE UPDATE SKIP PREDICATE IS THE CORPSE STATE, NEVER THE ALIVE FLAG
 * ============================================================================
 * Enemies.update skips an enemy whose state is the terminal corpse state — the
 * only genuinely inert state. It does NOT skip on a cleared `alive` flag.
 * Enemies.hurt clears that flag on the lethal hit, so an alive-flag skip would
 * make plan 05-03's death animation UNREACHABLE: the frame index could never
 * advance and the corpse state could never be entered. The alive flag stays the
 * filter where it IS correct — plan 05-02's hitscan target filter, and the
 * re-entry guard inside hurt().
 *
 * ============================================================================
 * THE 05-01 FUNCTIONALITY GAP IS CLOSED (plan 05-03)
 * ============================================================================
 * This file owns ENEM-01 (the state machine), ENEM-02 (chase + wall collision),
 * ENEM-03 (the ranged attack) and — since plan 05-03 — ENEM-04 (the chance-based
 * pain reaction, the multi-frame death animation and the corpse) and ENEM-05 (the
 * kill tally). EVERY LOCKED D-02 STATE IS NOW IMPLEMENTED: idle, chase, attack,
 * pain, death and corpse each have a real branch, and 05-01's documented
 * do-nothing fall-through for the death state is gone.
 *
 * CORPSE IS THE SINGLE TERMINAL STATE AND THE ONLY STATE THE UPDATE LOOP SKIPS.
 * Nothing anywhere transitions out of it. The `alive` flag is a TARGETING filter
 * (plan 05-02's hitscan) and a RE-ENTRY guard (inside hurt) — never an update
 * skip, for the reason spelled out above.
 *
 * THE KILL TALLY LIVES ON Game: Game.kills is incremented by hurt() inside the
 * one branch that clears `alive`, and Game.totalKills is set by build() from the
 * adopted enemy count. Phase 6's HUD and victory screen read both; this file only
 * produces the numbers (drawing them is HUD-01/HUD-02).
 *
 * ALLOCATION: build() and reset() are the ONLY allocation points. Nothing in
 * update / updateProjectiles / spawnProjectile allocates (threat T-05-03), and
 * both lists are truncated IN PLACE so any holder of a reference keeps watching
 * the live list.
 */

var Enemies = {
  // The enemy entities this module owns. Every entry is ALSO an entry of
  // Entities.list (same object). Truncated in place, never reassigned.
  list: [],

  // The preallocated projectile pool. Also all members of Entities.list.
  projectiles: [],

  // The entity `kind` this module adopts. Matches Entities.SPRITE_FOR.enemy.kind.
  KIND: 'enemy',

  // The state names, written once so nothing can typo a transition.
  IDLE: 'idle',
  CHASE: 'chase',
  ATTACK: 'attack',
  PAIN: 'pain',       // entered ONLY from hurt() on a chance roll (05-03)
  DEATH: 'death',     // entered by hurt(); the ANIMATION runs in update (05-03)
  CORPSE: 'corpse',   // the terminal, genuinely inert state — the update skip

  // THE PAIN-ROLL STREAM (05-03). mulberry32 written as a module-scope function
  // over this integer state rather than the closure mulberry32() returns —
  // identical output sequence for the same seed, but re-seeding is a single
  // integer assignment, so NOTHING allocates per hit or per reset (threat
  // T-05-20). Same discipline as Weapons.randState.
  randState: 0,

  built: false
};

(function () {
  'use strict';

  // The three death frames, in the order the fall plays them. A DATA array, so
  // the frame count is derived from it everywhere (the corpse latches when the
  // index runs past the end) and adding a fourth frame needs no logic change.
  var DEATH_FRAMES = ['enemyDeath1', 'enemyDeath2', 'enemyDeath3'];

  // Fire a sound EVENT (AUD-02, plan 06-03). Guarded at CALL time by typeof: this
  // is script 13 and js/sound.js is script 15, so `Sound` does not exist while this
  // module is being evaluated — it always does by the time anything calls hurt() or
  // spawnProjectile(). The event NAMES come from CONFIG.SFX_EVENTS (script 1) for
  // the same reason, so no call site here re-types a string literal.
  //
  // Sound.play never throws, and nothing here reads its return: an enemy must die
  // identically whether or not the browser gave us audio.
  function playSound(event) {
    if (typeof Sound === 'undefined' || !Sound || typeof Sound.play !== 'function') {
      return false;
    }
    return Sound.play(event);
  }
  Enemies.DEATH_FRAMES = DEATH_FRAMES;
  Enemies.CORPSE_FRAME = 'enemyCorpse';
  Enemies.PAIN_FRAME = 'enemyPain';

  // ===========================================================================
  // THE PAIN ROLL STREAM (05-03) — mulberry32 over Enemies.randState. Seeded
  // ONCE at module load (below) and re-seeded by reset(), so a replayed scenario
  // staggers on exactly the same hits. Allocates nothing, ever.
  // ===========================================================================
  Enemies.rand = function () {
    var a = Enemies.randState | 0;
    a = (a + 0x6d2b79f5) | 0;
    Enemies.randState = a;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  Enemies.seedRand = function () {
    Enemies.randState = (CONFIG.SEED + CONFIG.ENEMY_HURT_SEED_SALT) >>> 0;
    return Enemies.randState;
  };
  Enemies.seedRand();

  // ===========================================================================
  // THE ENEMY FIELD SET — written in exactly ONE place so the adoption path and
  // add() can never drift apart.
  // ===========================================================================
  Enemies.initEnemy = function (entity, x, y) {
    entity.kind = Enemies.KIND;
    entity.x = x;
    entity.y = y;
    // Billboard fields (the sprite pass reads these every frame). The sprite is
    // now chosen PER FRAME by this module — it starts on the idle pose.
    entity.sprite = 'enemyIdle';
    entity.scale = 1.0;
    entity.onFloor = true;
    entity.active = true;
    // Behaviour fields.
    entity.alive = true;
    entity.state = Enemies.IDLE;
    entity.health = CONFIG.ENEMY_HEALTH;
    entity.cooldown = 0;     // seconds until the next attack may START
    entity.windup = 0;       // seconds left of the current attack telegraph
    entity.animTime = 0;     // seconds accumulated for the walk / death cycle
    entity.painTime = 0;     // seconds left of the pain stagger (05-03)
    entity.deathFrame = 0;   // index into DEATH_FRAMES while dying (05-03)
    entity.stuck = 0;        // seconds left of the latched corner recovery
    entity.recovX = 0;       // the latched recovery direction (unit)
    entity.recovY = 0;
    return entity;
  };

  // ===========================================================================
  // BUILD — ADOPT the billboards Entities.build() already emitted, then
  // preallocate the projectile pool. Idempotent.
  // ===========================================================================
  Enemies.build = function () {
    // A fresh spawn-derived list. Entities.build assigns a NEW array, which is
    // exactly why everything derived from it must be rebuilt in the same breath.
    Entities.build();
    var list = Entities.list;

    // Truncate IN PLACE — never `Enemies.list = []`.
    Enemies.list.length = 0;
    var i, e;
    for (i = 0; i < list.length; i++) {
      e = list[i];
      if (e.kind !== Enemies.KIND) continue;
      // Stamp behaviour onto THE SAME OBJECT the sprite builder created.
      Enemies.initEnemy(e, e.x, e.y);
      Enemies.list.push(e);
    }

    // The projectile pool: exactly CONFIG.PROJ_POOL entities, allocated ONCE
    // here and reused forever. They live in Entities.list so the sprite pass
    // draws them for free — and start inactive, so it skips them for free too.
    Enemies.projectiles.length = 0;
    for (i = 0; i < CONFIG.PROJ_POOL; i++) {
      var p = {
        kind: 'projectile',
        x: 0, y: 0,
        vx: 0, vy: 0,
        damage: 0,
        sprite: 'fireball',
        scale: CONFIG.PROJ_SCALE,
        onFloor: false,
        active: false
      };
      Enemies.projectiles.push(p);
      list.push(p);
    }

    Entities._ensureScratch(list.length);

    // THE KILL DENOMINATOR (ENEM-05). Set from the enemies actually ADOPTED, which
    // IS the enemy marker count because build() adopts exactly one entity per
    // spawn and never appends a duplicate — so the tally is always out of the real
    // total and nothing has to walk Level.spawns a second time to re-derive it.
    //
    // Zeroing the tally here is not redundant with main.js's boot call: a rebuild
    // RESURRECTS every enemy at full health, so a kill count carried across it
    // would be counting enemies that are alive again.
    if (typeof Game !== 'undefined' && Game) {
      Game.totalKills = Enemies.list.length;
      if (typeof Game.resetStats === 'function') Game.resetStats();
    }

    Enemies.built = true;
    return Enemies.list;
  };

  // ===========================================================================
  // RESET — rebuild the whole entity world from the spawn table, TOGETHER.
  //
  // Production code (a restart uses it), and the harness's clean scenario
  // primitive. Both lists are truncated IN PLACE first, PRESERVING their array
  // identities, so anything holding a reference keeps watching the live list.
  //
  // WHY THE Pickups HOOK: Entities.build() assigns a FRESH Entities.list array.
  // Every view derived from it must therefore be rebuilt in the same breath, or
  // a behaviour module is left holding entities that the rebuild orphaned —
  // simulated but never drawn, because they are no longer in the list the sprite
  // pass reads. The typeof guard is what keeps js/enemies.js loadable in
  // isolation and lets THIS plan ship with no pickup code at all; plan 05-04
  // relies on the hook being here.
  // ===========================================================================
  Enemies.reset = function () {
    Enemies.list.length = 0;
    Enemies.projectiles.length = 0;
    // Re-seed the pain stream so a replayed scenario staggers on exactly the same
    // hits (the same contract Weapons.reset() gives the pellet spread). One
    // integer assignment; allocates nothing.
    Enemies.seedRand();
    Enemies.build();
    if (typeof Pickups !== 'undefined' && Pickups && typeof Pickups.build === 'function') {
      Pickups.build();
    }
    return Enemies.list;
  };

  // ===========================================================================
  // ADD — the scenario primitive: ONE new enemy with no level marker. Pushes to
  // BOTH lists so it is simulated and drawn like any adopted enemy.
  // ===========================================================================
  Enemies.add = function (x, y) {
    var e = Enemies.initEnemy({}, x, y);
    Entities.list.push(e);
    Enemies.list.push(e);
    Entities._ensureScratch(Entities.list.length);
    return e;
  };

  // ===========================================================================
  // CHASE STEERING + THE BOUNDED CORNER RECOVERY
  //
  // The direct steer is D-02's behaviour and stays the behaviour everywhere it
  // works. But the level's corridors are ONE cell wide and ENEMY_RADIUS 0.35
  // gives a 0.70 footprint, so an enemy approaching a corridor mouth off the
  // centre-line presses into the corner: the per-axis slide keeps the free axis
  // alive, but only at that axis's tiny COMPONENT of the desired direction
  // (~0.03 of a step), which is indistinguishable from being stuck. It would
  // creep at the mouth essentially forever.
  //
  // Two bounded recoveries, tried in order. Neither searches, neither loops:
  //
  //   A. ONE AXIS STILL FREE -> put the FULL step into that axis, signed toward
  //      the player. That is what actually walks an off-centre enemy sideways
  //      onto the corridor centre-line, and it is self-correcting: the sign
  //      follows the player, so it cannot overshoot and oscillate. Re-decided
  //      every frame precisely because it is self-correcting.
  //
  //   B. BOTH AXES BLOCKED (a genuine concave corner) -> a LATCHED wall-follow:
  //      steer along the desired direction rotated a quarter turn with a fixed
  //      handedness, mirrored only when that side is also blocked, held for
  //      CONFIG.ENEMY_UNSTICK_TIME. Latching (rather than re-deciding) is what
  //      keeps the escape stable and reproducible headlessly instead of
  //      dithering on the corner. The recovery MOVES ONLY through the latch, so
  //      setting ENEMY_UNSTICK_TIME to 0 disables it completely — which is the
  //      falsifiability control the harness uses.
  // ===========================================================================
  function steerChase(e, dt, ux, uy, maxClose) {
    var R = CONFIG.ENEMY_RADIUS;
    var full = CONFIG.ENEMY_SPEED * dt;
    if (!(full > 0)) return;

    // A latched recovery is in flight: follow it and count it down. The recovery
    // steers ACROSS the line to the player rather than along it, so it takes the
    // full step and is not subject to the closing clamp below.
    if (e.stuck > 0) {
      e.stuck -= dt;
      if (e.stuck < 0) e.stuck = 0;
      Player.slideMove(e, e.recovX * full, e.recovY * full, R);
      return;
    }

    // NEVER CLOSE PAST ENEMY_STOP_RANGE. `maxClose` is the gap still left before
    // the stop range, so the last approach step lands exactly ON it instead of
    // overshooting by up to one whole step and then jittering back out. "Stop
    // closing at the stop range" has to mean the enemy is never nearer than it,
    // or the constant does not bound anything.
    var step = full < maxClose ? full : maxClose;
    if (!(step > 0)) return;

    var travelled = Player.slideMove(e, ux * step, uy * step, R);
    // THE STUCK PREDICATE. ENEMY_STUCK_EPSILON is a DIMENSIONLESS FRACTION of
    // the REQUESTED step, never an absolute distance (a 60 fps request is only
    // ~0.027 cells, so an absolute reading would flag every enemy forever).
    if (travelled >= CONFIG.ENEMY_STUCK_EPSILON * step) return;

    // --- Recovery A: full speed along whichever axis is still free ----------
    // Sign 0 means the player is level with the enemy on that axis, so that axis
    // is not a useful escape; treat it as unavailable rather than picking a
    // direction the player is not in.
    var sx = ux > 0 ? 1 : (ux < 0 ? -1 : 0);
    var sy = uy > 0 ? 1 : (uy < 0 ? -1 : 0);
    var freeX = sx !== 0 && Player.canOccupyXFor(e.x, e.y, e.x + sx * full, R);
    var freeY = sy !== 0 && Player.canOccupyYFor(e.x, e.y, e.y + sy * full, R);
    if (freeX && !freeY) { Player.slideMove(e, sx * full, 0, R); return; }
    if (freeY && !freeX) { Player.slideMove(e, 0, sy * full, R); return; }

    // --- Recovery B: latch the bounded wall-follow --------------------------
    // Primary handedness: the desired direction rotated -90 degrees.
    var ax = uy, ay = -ux;
    if (!Player.canOccupyXFor(e.x, e.y, e.x + ax * full, R) &&
        !Player.canOccupyYFor(e.x, e.y, e.y + ay * full, R)) {
      ax = -uy; ay = ux;   // that side is walled too — take the mirror
    }
    e.recovX = ax;
    e.recovY = ay;
    e.stuck = CONFIG.ENEMY_UNSTICK_TIME;
    // Deliberately NO move this frame: the recovery moves only through the latch
    // above, so ENEMY_UNSTICK_TIME 0 is a true "recovery disabled" control.
  }

  // ===========================================================================
  // UPDATE — the state machine. One pass, no allocation, no unbounded loop.
  // ===========================================================================
  Enemies.update = function (dt) {
    // One bad number must never corrupt the world: bail before touching state
    // (threat T-05-02, mirroring Player.update's guard).
    if (!isFinite(dt) || dt < 0) return;

    var list = Enemies.list;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      // THE SKIP IS THE CORPSE STATE, NEVER THE ALIVE FLAG (see the header).
      if (e.state === Enemies.CORPSE) continue;

      // The cooldown ticks for EVERY non-corpse enemy regardless of which branch
      // runs below — a cooldown that only decremented inside one state would
      // never elapse and the enemy would fire exactly once, ever.
      if (e.cooldown > 0) {
        e.cooldown -= dt;
        if (e.cooldown < 0) e.cooldown = 0;
      }

      var dx = Player.x - e.x, dy = Player.y - e.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      // Both the sight test and the range tests compare UNSQUARED distance
      // against UNSQUARED CONFIG ranges — mixing the two is the classic silent
      // "sees you from 144 cells away" bug.
      var see = Level.lineOfSight(e.x, e.y, Player.x, Player.y);

      if (e.state === Enemies.IDLE) {
        e.sprite = 'enemyIdle';
        if (d <= CONFIG.ENEMY_SIGHT_RANGE && see) e.state = Enemies.CHASE;

      } else if (e.state === Enemies.CHASE) {
        // Two-frame walk cycle, driven by accumulated simulated time.
        e.animTime += dt;
        var frame = Math.floor(e.animTime / CONFIG.ENEMY_WALK_FRAME_TIME) % 2;
        e.sprite = frame === 0 ? 'enemyWalk1' : 'enemyWalk2';

        if (see && d <= CONFIG.ENEMY_ATTACK_RANGE && e.cooldown <= 0) {
          // Enter the attack: take the cooldown NOW (see the header note) and
          // start the telegraph.
          e.state = Enemies.ATTACK;
          e.sprite = 'enemyAttack';
          e.windup = CONFIG.ENEMY_ATTACK_WINDUP;
          e.cooldown = CONFIG.ENEMY_ATTACK_COOLDOWN;
        } else if (d > CONFIG.ENEMY_STOP_RANGE && d > 0) {
          // Close the distance. The direction is NORMALISED — an unnormalised
          // steer would make speed scale with distance. The remaining gap to the
          // stop range is passed through as the closing clamp.
          steerChase(e, dt, dx / d, dy / d, d - CONFIG.ENEMY_STOP_RANGE);
        }

      } else if (e.state === Enemies.PAIN) {
        // THE PAIN STAGGER (ENEM-04, 05-03). Entered ONLY from hurt() — this
        // branch NEVER enters pain on its own, it only serves out the timer that
        // hurt() set. Hold the pain frame, move nothing, attack nothing, and
        // resume the chase on expiry. Resuming into CHASE even from a pain that
        // interrupted IDLE is deliberate: being shot wakes an enemy up.
        //
        // The cooldown ticked at the top of the loop like every other non-corpse
        // state, but it was NOT reset by the hit — a stagger must never hand the
        // enemy a free immediate attack (threat T-05-19).
        e.sprite = Enemies.PAIN_FRAME;
        e.painTime -= dt;
        if (e.painTime <= 0) {
          e.painTime = 0;
          e.state = Enemies.CHASE;
        }

      } else if (e.state === Enemies.DEATH) {
        // THE DEATH ANIMATION (ENEM-04, 05-03). This branch REPLACES 05-01's
        // documented do-nothing fall-through, and it is reachable ONLY because the
        // skip predicate at the top of this loop is the CORPSE state and not the
        // `alive` flag (see the header). hurt() clears `alive` on the lethal hit,
        // so an alive-flag skip would mean the enemy this branch is about is
        // exactly the enemy the loop refuses to update: the frame index could
        // never advance and the corpse could never be entered.
        //
        // The index advances MONOTONICALLY and stops at the end of DEATH_FRAMES,
        // so the fall plays exactly ONCE and then LATCHES into the terminal corpse
        // state (threat T-05-18). The while loop is bounded by the frame count, so
        // even a DT_MAX-sized delta cannot spin it — it just skips frames.
        e.animTime += dt;
        while (e.deathFrame < DEATH_FRAMES.length &&
               e.animTime >= CONFIG.ENEMY_DEATH_FRAME_TIME) {
          e.animTime -= CONFIG.ENEMY_DEATH_FRAME_TIME;
          e.deathFrame += 1;
        }
        if (e.deathFrame >= DEATH_FRAMES.length) {
          // THE CORPSE. `active` stays TRUE so the sprite pass keeps drawing it as
          // a floor decal; `alive` stays FALSE so the hitscan target filter refuses
          // it; and no transition OUT of this state exists anywhere in this file.
          e.state = Enemies.CORPSE;
          e.sprite = Enemies.CORPSE_FRAME;
        } else {
          e.sprite = DEATH_FRAMES[e.deathFrame];
        }

      } else if (e.state === Enemies.ATTACK) {
        e.sprite = 'enemyAttack';
        e.windup -= dt;
        if (e.windup <= 0) {
          e.windup = 0;
          // RE-TEST SIGHT AT THE RELEASE POINT. A player who broke line of sight
          // during the telegraph is not hit; the shot is simply lost (the
          // cooldown was already taken on entry, so a blocked attack still costs
          // the enemy its turn).
          if (see) Enemies.spawnProjectile(e);
          e.state = Enemies.CHASE;
        }
      }
      // EVERY non-corpse state now has a branch — there is no fall-through left.
      // The corpse is handled by the skip at the top of the loop, which is the
      // whole of its behaviour: no movement, no sight test, no cooldown, no
      // attack, while `active` stays true so it keeps rendering (T-05-17).
    }
  };

  // ===========================================================================
  // SPAWN A PROJECTILE — takes the first free pool entry. NEVER allocates and
  // NEVER grows the pool; returns null when every projectile is in flight
  // (threat T-05-03).
  // ===========================================================================
  Enemies.spawnProjectile = function (enemy) {
    var pool = Enemies.projectiles;
    for (var i = 0; i < pool.length; i++) {
      var p = pool[i];
      if (p.active !== false) continue;

      var dx = Player.x - enemy.x, dy = Player.y - enemy.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (!(d > 0)) { dx = 1; dy = 0; d = 1; }   // degenerate overlap: fire east

      p.x = enemy.x;
      p.y = enemy.y;
      p.vx = (dx / d) * CONFIG.PROJ_SPEED;
      p.vy = (dy / d) * CONFIG.PROJ_SPEED;
      p.damage = CONFIG.PROJ_DAMAGE;
      p.sprite = 'fireball';
      p.scale = CONFIG.PROJ_SCALE;
      p.onFloor = false;
      p.active = true;
      // THE ENEMY-ATTACK SOUND (AUD-02) — on the path that ACTUALLY ACTIVATED a
      // pool entry, immediately before returning it. The sound follows the
      // PROJECTILE, not the attempt: the `return null` below (a fully committed
      // pool) stays silent, which is what assertion 2d's control measures. Putting
      // it in the ATTACK release branch instead would fire on a lost shot too.
      playSound(CONFIG.SFX_EVENTS.ENEMY_ATTACK);
      return p;
    }
    return null;
  };

  // ===========================================================================
  // ADVANCE THE PROJECTILES.
  //
  // ORDER IS LOAD-BEARING: advance FIRST, then test the cell the projectile has
  // JUST ENTERED. Testing before advancing lets a projectile settle one step
  // INSIDE a wall before anyone notices. PROJ_SPEED * DT_MAX is 0.25 cells, so
  // no single frame can step over a one-cell wall (threat T-05-05).
  //
  // Deactivation means setting `active = false` and nothing else: the entity
  // object is REUSED and is never removed from Entities.list, which is what
  // keeps the list length constant forever.
  // ===========================================================================
  Enemies.updateProjectiles = function (dt) {
    if (!isFinite(dt) || dt < 0) return;

    var pool = Enemies.projectiles;
    // Squared distance against a SQUARED radius — comparing a squared distance
    // to an unsquared radius is the other classic silent hit-detection bug.
    var hitR2 = CONFIG.PROJ_HIT_RADIUS * CONFIG.PROJ_HIT_RADIUS;

    for (var i = 0; i < pool.length; i++) {
      var p = pool[i];
      if (p.active !== true) continue;

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (Level.isSolid(Math.floor(p.x), Math.floor(p.y))) {
        p.active = false;                       // splashed on a wall
        continue;
      }

      var dx = Player.x - p.x, dy = Player.y - p.y;
      if (dx * dx + dy * dy < hitR2) {
        if (typeof Combat !== 'undefined') Combat.damagePlayer(p.damage);
        p.active = false;
      }
    }
  };

  // ===========================================================================
  // HURT — the SINGLE damage entry point for an enemy. Plan 05-02's hitscan
  // calls exactly this.
  //
  // The alive flag is the correct guard HERE: it is a RE-ENTRY guard (a second
  // pellet from the same shotgun blast must not re-kill a dying enemy), not an
  // update skip. Compare the update loop, which deliberately skips on the corpse
  // state instead — see the header.
  // ===========================================================================
  Enemies.hurt = function (enemy, dmg) {
    if (!enemy) return 0;
    if (!isFinite(dmg) || dmg <= 0) return 0;
    if (enemy.alive === false) return 0;

    var before = enemy.health;
    enemy.health -= dmg;
    if (enemy.health <= 0) {
      enemy.health = 0;
      enemy.alive = false;
      // THE LETHAL BRANCH RETURNS BEFORE THE PAIN ROLL, which is the whole reason
      // pain can never trigger on the killing blow (ENEM-04, threat T-05-19): a
      // lethal hit goes straight to the death animation.
      enemy.state = Enemies.DEATH;
      // Start the fall from frame ONE, here rather than in update(), so the sprite
      // is already correct on the hit frame even if the world is rendered before
      // the next step.
      enemy.animTime = 0;
      enemy.deathFrame = 0;
      enemy.sprite = DEATH_FRAMES[0];
      enemy.painTime = 0;    // a stagger in flight is overridden by dying
      enemy.windup = 0;      // and any telegraphed attack is lost
      // THE KILL TALLY (ENEM-05) lives INSIDE the same branch that clears the
      // alive flag, and hurt() returns immediately above for an enemy already not
      // alive — so overkill, a second shotgun pellet, or any number of repeat hits
      // cannot inflate it (threat T-05-16). The typeof guard keeps this module
      // loadable in isolation.
      if (typeof Game !== 'undefined' && Game) Game.kills += 1;
      // THE DEATH SOUND (AUD-02) rides in the SAME branch as the kill tally, and
      // inherits the same guarantee for the same structural reason (threat T-06-21):
      // hurt() returns immediately above for an enemy whose alive flag is already
      // false, so overkill, a second shotgun pellet from the same blast, or any
      // number of repeat hits CANNOT double-trigger it. Playing it from the update
      // loop's DEATH branch instead would fire once per animation frame.
      playSound(CONFIG.SFX_EVENTS.ENEMY_DEATH);
      return before - enemy.health;
    }

    // THE PAIN ROLL (ENEM-04, 05-03) — a NON-LETHAL hit only. CONFIG.
    // ENEMY_PAIN_CHANCE is read LIVE, so forcing it to 0 or 1 is a real control.
    if (Enemies.rand() < CONFIG.ENEMY_PAIN_CHANCE) {
      enemy.state = Enemies.PAIN;
      enemy.painTime = CONFIG.ENEMY_PAIN_TIME;
      // ZERO THE WINDUP so an attack the stagger interrupted never fires. The
      // COOLDOWN is deliberately left alone: resetting it would let a player
      // grant the enemy a free immediate attack by shooting it (T-05-19).
      enemy.windup = 0;
    }
    return before - enemy.health;
  };

})();
