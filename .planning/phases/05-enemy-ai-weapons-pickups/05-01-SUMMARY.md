---
phase: 05-enemy-ai-weapons-pickups
plan: 01
subsystem: enemy-ai-combat
tags: [enemy-ai, state-machine, projectiles, player-combat, armor, collision-reuse, tracer]
status: complete

requires:
  - "Level.isSolid / Level.lineOfSight / Level.spawns (Phase 2)"
  - "Player pose + the D-06 per-axis leading-edge slide (Phase 2)"
  - "Entities.list + Entities.render sprite pass with z-buffer occlusion (Phase 4)"
  - "Sprites shape-then-colorize builders + ALPHA_KEY (Phase 2)"
  - "Game.frame/Game.step loop with the CONFIG.DT_MAX clamp (Phase 2)"
  - "tools/boot.cjs manual rAF scheduler + virtual clock (Phase 2)"
provides:
  - "Combat global: player health/armor/ammo/weapon/dead + damagePlayer with the locked armor formula"
  - "Combat.heal / Combat.addArmor (declared for 05-04's pickups)"
  - "Enemies global: adoption build(), reset(), add(), initEnemy, idle/chase/attack machine"
  - "Enemies.hurt(enemy, dmg) — the single enemy-damage entry point 05-02's hitscan calls"
  - "Enemies.projectiles — the preallocated fireball pool"
  - "Player.canOccupyXFor / canOccupyYFor / slideMove — the shared radius-parameterised slide"
  - "Entity `kind` field + Entities.SPRITE_FOR descriptors carrying it (the adoption handle)"
  - "Strict active===false skip in the sprite pass"
  - "Game.time as SIMULATION time accumulated inside Game.step"
  - "Enemies.reset()'s Pickups.build() hook (guarded) for 05-04"
  - "enemyIdle/enemyWalk1/enemyWalk2/enemyAttack + fireball sprite frames"
  - "tools/verify-combat.cjs — 67-assertion headless combat harness"
affects:
  - "05-02 (weapons): calls Enemies.hurt, filters targets on the alive flag, reads Combat.ammo/weapon"
  - "05-03 (damage response): fills the death/pain/corpse branch the corpse-skip predicate leaves reachable"
  - "05-04 (pickups): adopts pickup entities by `kind`, relies on the Pickups.build() hook, calls Combat.heal/addArmor"
  - "Phase 6 (HUD/audio): reads Combat.health/armor/ammo/lastDamageAt/totalDamageTaken"

tech-stack:
  added: []
  patterns:
    - "ADOPTION over creation: a behaviour module stamps fields onto the entities the sprite builder already emitted, matched by a `kind` field — never appends a parallel object"
    - "Radius-parameterised collision: one slide routine serves the player and every enemy; slideMove returns distance travelled so callers can detect a jam"
    - "Bounded corner recovery: full-speed free-axis slide (self-correcting, re-decided per frame) then a latched quarter-turn wall-follow — no pathfinder, no unbounded loop"
    - "Simulation time owned by step, not frame, so a direct step advances the clock and age-based proofs are non-vacuous"
    - "Paired falsifiability controls: every zero-result proof has a sibling that makes the same measurement non-zero"

key-files:
  created:
    - "Doom/Claude Opus 4.8/GSD/js/combat.js"
    - "Doom/Claude Opus 4.8/GSD/js/enemies.js"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-combat.cjs"
  modified:
    - "Doom/Claude Opus 4.8/GSD/js/config.js"
    - "Doom/Claude Opus 4.8/GSD/js/player.js"
    - "Doom/Claude Opus 4.8/GSD/js/sprites.js"
    - "Doom/Claude Opus 4.8/GSD/js/entities.js"
    - "Doom/Claude Opus 4.8/GSD/js/game.js"
    - "Doom/Claude Opus 4.8/GSD/js/main.js"
    - "Doom/Claude Opus 4.8/GSD/index.html"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-sprites.cjs"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-input-view.cjs"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-motion.cjs"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-phase02.cjs"

decisions:
  - "The attack cooldown is charged on ENTERING the attack state, not at the end of the windup — charging it at the end makes the real firing period COOLDOWN+WINDUP and drifts a whole shot behind the requirement over a long fight"
  - "The chase closing step is clamped to the remaining gap to ENEMY_STOP_RANGE, so the enemy lands exactly on the stop range instead of overshooting by up to one step and jittering back out"
  - "The corner recovery leads with a full-speed slide along whichever single axis is still free (signed toward the player) and only falls back to the latched quarter-turn when BOTH axes are walled — the planned quarter-turn-only recovery cannot free an off-centre enemy at a corridor mouth"
  - "The latched wall-follow moves ONLY through the latch, so ENEMY_UNSTICK_TIME 0 fully disables the recovery and is a true falsifiability control"
  - "verify-motion and verify-phase02 are scoped to player kinematics (enemies removed from the AI update set); a dead player is deliberately inert, which is a Phase 5 feature, not a Phase 2 regression"
  - "verify-sprites 0e strengthened from 'no entity carries behaviour fields' to 'behaviour fields exist on exactly the enemy-kind entities'"

requirements: [ENEM-01, ENEM-02, ENEM-03, PICK-02]

metrics:
  duration: ~65 min
  tasks: 4
  commits: 3
  files-created: 3
  files-modified: 11
  lines-added: 2126
  assertions-added: 74
  completed: 2026-07-25
---

# Phase 5 Plan 01: Enemy AI State Machine, Projectile Attack & Combat Stats Summary

The Phase 5 tracer: an enemy now stands idle until it can genuinely see the player,
chases it around walls and through one-cell corridors, telegraphs and throws
fireballs on a fixed cooldown, and takes the player's health through the locked
armor-absorption formula — proven end to end by a 67-assertion headless harness in
which every gate has a control that makes the same measurement come out the other way.

## What was built

**`js/combat.js` — the player's stats, separate from the pose.** `Combat` holds
health, armor, ammo (bullets/shells), weapon selection, `hasShotgun`, the `dead`
flag, and the `lastDamageAt` / `totalDamageTaken` pair Phase 6's damage flash needs.
`damagePlayer(dmg)` is the single place player health drops and owns the locked D-04
formula `absorbed = min(armor, floor(dmg/3))` — guards first (non-finite, non-positive
and already-dead all mutate nothing and return 0), then arithmetic, health floored at
0 and the `dead` flag latched. `heal` and `addArmor` are declared here too so 05-04's
pickups have somewhere to land rather than re-deriving caps.

**`js/enemies.js` — the AI.** The state machine is `idle → chase → attack → chase`,
with the death state present but inert (05-03 fills it). Chase animates the two walk
frames off accumulated simulated time, steers on a **normalised** direction, stops
closing at `ENEMY_STOP_RANGE`, and moves through the *shared* slide. Attack shows the
telegraph frame for `ENEMY_ATTACK_WINDUP` and **re-tests line of sight at the release
point** — testing only on entry is the classic shoot-through-a-wall bug, and the harness
proves the enemy stays silent when sight is broken. `hurt()` is the one damage entry
point 05-02's hitscan will call.

**The adoption pattern (the architectural point of the tracer).** `Entities.SPRITE_FOR`
now carries a `kind` on every descriptor and `Entities.build()` copies it onto each
entity. `Enemies.build()` calls `Entities.build()`, then **walks `Entities.list` and
stamps behaviour onto the objects already there** — it never walks `Level.spawns` and
never pushes a second enemy. Assertion 1h is the gate: `Entities.list.length` is
exactly the spawn-derived count plus `CONFIG.PROJ_POOL` (7 + 24 = 31), `Enemies.list`
is a strict-reference subset of `Entities.list`, and no two active entities share a
position and a sprite. `Enemies.add(x, y)` remains the scenario primitive for a marker-less
enemy; `build()` does not call it. 05-04 attaches pickups by the identical mechanism.

**The shared slide.** The D-06 collision is now `canOccupyXFor` / `canOccupyYFor` /
`slideMove(obj, dx, dy, radius)`; `Player.canOccupyX/canOccupyY/moveBy` are thin
delegations, so observed player behaviour is unchanged (the 28 motion assertions
passing unedited is the proof). `slideMove` returns the **distance actually travelled**,
which is what makes a corner jam detectable.

**The projectile pool.** Exactly `CONFIG.PROJ_POOL` entities preallocated at build,
living in `Entities.list` so the sprite pass draws them for free and skips them for
free when inactive. `spawnProjectile` takes the first free slot and returns `null`
when exhausted; `updateProjectiles` advances **then** tests the cell just entered
(testing first lets a projectile settle inside a wall) and compares squared distance
against a squared radius.

**Loop dispatch.** `Game.time` moved from `Game.frame` into the top of `Game.step` —
behaviour-identical through the rAF loop (a resync frame takes dt 0 and never stepped
anyway), but it makes simulated time advance under a **direct** `Game.step(dt)`, without
which every age-based proof in this phase would pass against a frozen clock.
`Game.step` substitutes `Game.ZERO_INTENT` when `Combat.dead`, which is the entire
mechanism behind the dead flag, then dispatches `Enemies.update` and
`Enemies.updateProjectiles`.

**Art.** One pose-parameterised enemy builder emits `enemyIdle` / `enemyWalk1` /
`enemyWalk2` / `enemyAttack` (limb offsets, a widened mouth and a hotter emissive eye
palette entry — idle is the all-zero row, so it cannot drift), plus a 24×24 fully
emissive `fireball`. The legacy `Sprites.map.enemy` key is a strict-identity alias for
the idle frame, which is why every Phase 4 pixel proof kept passing byte for byte.

## The corner recovery (the one design change worth reading)

The plan's premise was that the per-axis slide already handles the one-axis-blocked
case, so only a concave corner needs recovery. That is not true in this level. With
`ENEMY_RADIUS` 0.35 the enemy footprint is 0.70 in a one-cell corridor, and an enemy
approaching the mouth off the centre-line has its Y blocked while X remains free — but
only at X's *component* of the desired direction, about 0.03 of a step. It creeps at
the mouth essentially forever, which is indistinguishable from being stuck.

The shipped recovery therefore has two tiers, both bounded and deterministic:

1. **One axis still free → put the FULL step into that axis**, signed toward the
   player. This is what actually walks an off-centre enemy sideways onto the corridor
   centre-line. It is re-decided every frame precisely *because* it is self-correcting:
   the sign follows the player, so it cannot overshoot and oscillate. (A latched version
   overshot the corridor and ping-ponged — that was the first thing tried.)
2. **Both axes blocked → a LATCHED quarter-turn wall-follow**, fixed handedness,
   mirrored only when that side is also walled, held for `ENEMY_UNSTICK_TIME`. The
   recovery moves *only* through the latch, which is what makes `ENEMY_UNSTICK_TIME = 0`
   a true "recovery disabled" control.

`CONFIG.ENEMY_STUCK_EPSILON` is documented, and the predicate written out literally, as
a **dimensionless fraction of the requested step** (`travelled < EPSILON * requested`).
Read as an absolute cell distance it would flag every enemy as stuck forever, since a
60 fps request is only ~0.027 cells.

## Verification results

All seven harnesses print their all-pass tokens in one chained command, with no
assertion weakened:

| Harness | Assertions | Before | Token |
|---|---|---|---|
| verify-combat | **67** | (new) | ALL_COMBAT_CONTRACTS_PASS |
| verify-sprites | **67** | 59 | ALL_SPRITE_CONTRACTS_PASS |
| verify-render | **65** | 65 | ALL_RENDER_CONTRACTS_PASS |
| verify-input-view | **17** | 17 | ALL_TRACER_CONTRACTS_PASS |
| verify-level | **56** | 56 | ALL_LEVEL_CONTRACTS_PASS |
| verify-motion | **28** | 22 | ALL_MOTION_CONTRACTS_PASS |
| verify-phase02 | **38** | 38 | ALL_PHASE02_CONTRACTS_PASS |

**LOS gating (the distance-matched pair, 2d/2e/2f).** Stronger than planned: the same
enemy, at the *same position*, at the *same 11-cell distance*, with **one cell of wall**
toggled. Wall present → idle for 120 frames, unmoved, silent. Wall removed → chase within
10 frames. The only variable is line of sight. Second control 2g: clear sight at 14 cells
(beyond the 12-cell range) still idle, so the range test is real and not subsumed.

**Corner recovery / corridor navigation (2v/2w/2x).** Both one-cell corridors traversed
from both an on-centre and an off-centre entry, each inside a CONFIG-derived frame budget
and never entering a solid cell: column 4 at frame 313/1014 and 342/1020 off-centre;
column 18 at 351/1125 and 380/1131 off-centre — all four ending at y 15.50, i.e. through
the corridor and parked exactly on the stop range. The unstick proof: a jammed enemy moved
0.617 cells within two windows (> `ENEMY_RADIUS`), while the zero-unstick control moved
**0.0000** — so the recovery, not the plain steer, is what freed it.

**Other paired proofs.** Wall collision 2a/2b (blocked axis arrested on the wall's row;
never in a solid cell, never skips a cell, never cuts a corner) with control 2c closing
5.00 → 2.00 once the wall is opened. Cooldown 2h: 6 fireballs in 10 simulated seconds
across 600 driven frames, checked against both `floor(N/COOLDOWN)` and the exact
CONFIG-derived model. Projectile despawn 2j/2k with the wall-open control 2l. No tunneling
2m: derived step 0.250 cells, driven at `DT_MAX` straight into a one-cell pillar. Armor at
three levels 2n/2o/2p (absorb 4 / clamp to 1 / full damage) plus a guard sweep. Death latch
2q. Pool discipline 2r (`Entities.list` unchanged across 600 frames of attacking). Delta
guard 2s (byte-identical for NaN/±Inf/negative). Dead-player pair 2t/2u (player frozen
byte-for-byte while the enemy moved 1.600 cells; identical intent on a live player moves
it). Simulated-time pair 2y with the no-stepping control.

**Self-containment gate.** `index.html` references only local relative assets
(`style.css` + 15 `js/` files), every script tag is classic with no `type="module"`,
and nothing under `tools/` is referenced. Present count equals frame count throughout.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] The chase overshot `ENEMY_STOP_RANGE` by up to one step**
- **Found during:** Task 2, by assertion 1d (final distance 1.987 against a stop range of 2.0)
- **Issue:** The chase applied a full `ENEMY_SPEED * dt` step even when less than that remained before the stop range, so the enemy closed past it and then jittered back out. "Stop closing at the stop range" has to mean the enemy is never nearer than it, or the constant bounds nothing.
- **Fix:** The closing step is clamped to `d - ENEMY_STOP_RANGE`; recovery steps are deliberately exempt because they steer across the line to the player rather than along it.
- **Files:** `js/enemies.js`
- **Commit:** 0d48907

**2. [Rule 1 - Bug] The planned corner recovery cannot free an off-centre enemy**
- **Found during:** Task 3 design, against must-have "reaches attack range … from an off-centre entry rather than jamming on the corridor mouth"
- **Issue:** The plan assumed the per-axis slide already handles one-axis-blocked, leaving only concave corners to fix. In a one-cell corridor with a 0.70 footprint the free axis advances at only its ~0.03 component of the desired direction. A quarter-turn-only recovery either walks the enemy *away* from the mouth (wrong handedness for one side) or, when latched, overshoots and ping-pongs.
- **Fix:** Two-tier recovery — full-speed free-axis slide (re-decided per frame, self-correcting) first, latched quarter-turn wall-follow only when both axes are walled. Proven by 2v/2w on four corridor entries and by 2x's zero-unstick control.
- **Files:** `js/enemies.js`, `js/config.js` (comments)
- **Commit:** 856bae8

**3. [Rule 1 - Bug] The planned cooldown timing contradicts the requirement**
- **Found during:** Task 2 implementation
- **Issue:** The plan charges the cooldown at the *end* of the windup, which makes the real firing period `COOLDOWN + WINDUP` (1.95 s, not 1.6 s) and drifts a full shot behind the must-have truth "exactly one fireball per `CONFIG.ENEMY_ATTACK_COOLDOWN`" over a long fight.
- **Fix:** The cooldown is charged on *entering* the attack state, so the period is exactly `ENEMY_ATTACK_COOLDOWN`. A sight-blocked release still costs the enemy its turn. Documented in the module header and proven by 2h against both the coarse and the exact CONFIG-derived model.
- **Files:** `js/enemies.js`
- **Commit:** 0d48907

**4. [Rule 3 - Blocking] Live combat broke two Phase 1-2 kinematics harnesses**
- **Found during:** Task 2 regression
- **Issue:** `verify-phase02`'s 6000-frame randomized drive (~100 simulated seconds) reliably reduces the player to 0 health, at which point the player is *deliberately* inert (`Game.step` substitutes the frozen zero intent per D-04). Assertion 3.5 ("free axis slides > 0.3") then failed for a reason with nothing to do with kinematics. `verify-motion`'s 5000-frame drive was passing only by luck of its random stream.
- **Fix:** Both harnesses truncate `Enemies.list` in place at boot, with a documented note. The enemies stay in `Entities.list` as the static billboards Phase 4 rendered, so nothing is orphaned; enemy behaviour is proven in `verify-combat`, where it belongs. **No assertion was changed** — this is scoping, not weakening.
- **Files:** `tools/verify-motion.cjs`, `tools/verify-phase02.cjs`
- **Commit:** 0d48907

**5. [Rule 2 - Expectation that legitimately moved] verify-sprites 0e**
- **Found during:** Task 2 regression
- **Issue:** Phase 4 asserted that *no* entity carries behaviour fields, with the standing note "Phase 5 owns them". Phase 5 now owns them, so the assertion had to move — the plan listed only two moving expectations and did not anticipate this third.
- **Fix:** **Strengthened**, not dropped: behaviour fields must now exist on *exactly* the enemy-kind entities. A pickup or projectile that sprouted enemy state, or an enemy that failed to get any, both fail. Task 4's "confirm the three expectations that moved and no others" is satisfied with this as the third.
- **Files:** `tools/verify-sprites.cjs`
- **Commit:** 0d48907

**6. [Scenario correction] 2i's control reused a sight-blocked bearing**
- **Found during:** Task 3
- **Issue:** The control moved the player to a clear-sight position "at the same distance" by translating along +x, which put it straight back behind the same pillar.
- **Fix:** The control moves the player straight north of the enemy instead — same distance, clear bearing.
- **Files:** `tools/verify-combat.cjs`
- **Commit:** 856bae8

### Task 4 made no code changes
The full seven-harness regression was already green when Task 4 ran, because every
failure it was designed to catch had been fixed inside Tasks 2 and 3 (deviations 4 and 5
above). Nothing needed committing; the task's product is the recorded assertion counts
and the self-containment gate result above.

## Requirement Boundary (documented gap, filled inside this phase)

`js/enemies.js`'s header records this explicitly, in the same style 04-01 used for its
deferred fog. This plan does **not** claim ENEM-04 or ENEM-05: the chance-based pain
reaction, the multi-frame death animation, the corpse and the kill count are **plan
05-03's**. `hurt()` sets the death state and clears the alive flag; an enemy in the death
state falls through the state switch doing nothing. That fall-through is the gap 05-03
replaces with the death-animation branch — and it is reachable **only** because the
update skip predicate is the terminal `corpse` state and never the `alive` flag. An
alive-flag skip would make the death animation permanently unreachable, since the frame
index could never advance and the corpse state could never be entered.

## Delegated to the orchestrator (real browser, `file://` and a static server)

Automated verification cannot see the screen, so the visual/feel pass is delegated:

- Open the game, walk toward an enemy: confirm it stands still until it can see you,
  then walks toward you (two-frame stride reads as walking) and throws fireballs that
  visibly hurt you.
- Confirm it does not walk through walls and does not throw fireballs through them.
- Lure one down a one-cell corridor and confirm it follows you through rather than
  sticking on the corner.
- Confirm the fireball reads as an emissive orb against dark walls and the attack
  telegraph (raised arms, hotter eyes) is legible at a few cells' distance.
- **rAF-throttle caveat:** on a non-composited or headless open the loop does not tick.
  Drive frames manually with `Game.view.render()` followed by `Framebuffer.present()`,
  and step the simulation with `Game.step(0.016)`.

A headless proxy for that path was run and is green: 300 manual frames with
`Game.step(0.016)` + `Game.view.render()` + `Framebuffer.present()` produced an enemy
that chased from 6.00 to exactly 2.00 cells, drew both walk frames and the attack frame,
took the player from 100 to 64 health (three 12-damage hits, armor 0), never entered a
solid cell, and presented exactly once per frame with a non-uniform framebuffer.

## Known Stubs

None. Every field declared in this plan is either written by this plan's code or is an
inventory field (`ammo.bullets`, `ammo.shells`, `weapon`, `hasShotgun`) deliberately
declared here as the single home for combat state and mutated by 05-02 (spend/switch)
and 05-04 (pickup grants) — documented as such in `js/combat.js`'s header, not silently
inert. `Combat.heal` / `Combat.addArmor` are likewise live, tested-by-construction
functions awaiting 05-04's callers.

## Threat Flags

None. No new network endpoint, auth path, file access or trust-boundary schema was
introduced; the plan's `<threat_model>` dispositions (T-05-01 through T-05-08, T-05-SC)
are each covered by a named assertion — T-05-02 by 2s, T-05-03 by 2r, T-05-04 by 2a/2b/2c,
T-05-04b by 2v/2w/2x, T-05-05 by 2j-2m, T-05-06 by 2n-2q and 2t/2u, T-05-07 by 2i,
T-05-08 by the unchanged Phase 4 sprite harness.

## Self-Check: PASSED

- `js/combat.js`, `js/enemies.js`, `tools/verify-combat.cjs` — FOUND
- All 11 modified files — FOUND
- Commits 213798b, 0d48907, 856bae8 — FOUND in git log
- All seven all-pass tokens print in one chained command
- `node --check` clean on every modified `js/` file
