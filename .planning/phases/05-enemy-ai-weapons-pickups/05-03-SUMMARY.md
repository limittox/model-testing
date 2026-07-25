---
phase: 05-enemy-ai-weapons-pickups
plan: 03
subsystem: enemy-damage-response
tags: [pain-stagger, death-animation, corpse, kill-count, pose-table, falsifiable-controls]
status: complete

requires:
  - "Enemies.hurt(enemy, dmg) — the single enemy-damage entry point (05-01)"
  - "Enemies.update's CORPSE-state skip predicate, never the alive flag (05-01)"
  - "Enemies.build's ADOPTION of the spawn-derived enemy billboards (05-01)"
  - "The pose-parameterised enemy frame builder in js/sprites.js (05-01)"
  - "Weapons.castRay's alive-only target filter + Weapons.lastTarget (05-02)"
  - "Entities.render's strict active===false skip + Sprites.map per-frame lookup (Phase 4)"
  - "Game.time accumulated inside Game.step + tools/boot.cjs manual rAF (Phase 2/05-01)"
provides:
  - "Enemies.PAIN state + the pain branch (chance-based stagger, windup-cancelling)"
  - "The death branch: three death frames played once, latching into the terminal corpse"
  - "Enemies.DEATH_FRAMES / CORPSE_FRAME / PAIN_FRAME — the frame names as data"
  - "Enemies.rand / Enemies.seedRand — the allocation-free deterministic pain-roll stream"
  - "enemy.painTime + enemy.deathFrame on the enemy field set"
  - "Game.kills / Game.totalKills / Game.resetStats() — the ENEM-05 progression counters"
  - "Sprites enemyPain / enemyDeath1 / enemyDeath2 / enemyDeath3 / enemyCorpse"
  - "tools/verify-combat.cjs sections 3, 4 and 5 (67 -> 117 assertions)"
affects:
  - "05-04 (pickups): unchanged interfaces; the corpse keeps its Entities.list slot so the pickup adoption walk is untouched"
  - "Phase 6 (HUD/victory): reads Game.kills / Game.totalKills for the kill readout (HUD-01/HUD-02) and the cleared-level condition"
  - "Phase 6 (audio): the death and pain transitions are the natural Sound.play hooks"

tech-stack:
  added: []
  patterns:
    - "SPARSE POSE OVERRIDES over an explicit written-out default row, so the shipped pose is literally the defaults and cannot drift when a new pose is added"
    - "Face features DERIVED from the head centre (brow at headCY-5, eyes at headCY-1, mouth at headCY+mouthDy), so a pose that drops the head drags the whole face with it"
    - "A chance-based mechanic is proven STATISTICALLY against its CONFIG constant AND with forced-0 / forced-1 controls — the controls are what prove the constant is read live"
    - "The kill increment lives INSIDE the one branch that clears the alive flag, with an early return above it — so exactly-once is structural, not a counter check"
    - "A rebuild that resurrects entities must also reset the counter derived from them, or the tally counts the living"

key-files:
  created: []
  modified:
    - "Doom/Claude Opus 4.8/GSD/js/config.js"
    - "Doom/Claude Opus 4.8/GSD/js/sprites.js"
    - "Doom/Claude Opus 4.8/GSD/js/enemies.js"
    - "Doom/Claude Opus 4.8/GSD/js/game.js"
    - "Doom/Claude Opus 4.8/GSD/js/main.js"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-combat.cjs"

decisions:
  - "The pain roll is a module-scope function over Enemies.randState rather than a mulberry32() closure — identical stream, but re-seeding is one integer assignment and nothing allocates per hit (the same call 05-02 made for the pellet spread)"
  - "Enemies.build() zeroes Game.kills as well as setting Game.totalKills: a rebuild resurrects every enemy at full health, so a carried-over tally would be counting the living"
  - "hurt() sets the FIRST death frame itself rather than leaving it to update(), so the sprite is already correct if the world renders before the next step"
  - "The corpse is the ONE pose that does not use the standing skeleton — a `flat` branch inside the same builder with the same palette, because a flattened floor mass is not expressible as limb offsets on a standing figure"
  - "Section 5's scripted player holds fire only AFTER it has been hit and releases it the moment the enemy dies — one uninterrupted run, but the ammo accounting stays exact and the causal ordering the plan asks for is real rather than lucky"
  - "5a claims 'closed by more than a full cell and never nearer than ENEMY_STOP_RANGE' rather than 'landed exactly on the stop range': the fight kills the enemy before it arrives, and 1d already owns the exact-landing proof in open space"

requirements: [ENEM-04, ENEM-05]

metrics:
  duration: ~45 min
  tasks: 3
  commits: 3
  files-created: 0
  files-modified: 6
  lines-added: 1115
  assertions-added: 50
  completed: 2026-07-25
---

# Phase 5 Plan 03: Enemy Damage Response — Pain, Death, Corpse & Kill Count Summary

Shooting an enemy now reads as shooting an enemy: it flinches on roughly three
hits in ten, and the killing blow drops it through a three-frame fall onto the
floor, where it stays as a corpse that can never be shot again while a tally
counts the dead out of the level's real total — proven by 50 new assertions in
which every zero-result claim has a sibling that makes the same measurement come
out the other way.

05-01 built the enemy and left the ENEM-04/ENEM-05 half deliberately empty. This
plan fills it, and the 05-01 functionality gap is now closed: **every LOCKED D-02
state has a real branch.**

## What was built

**The pain stagger (ENEM-04).** `Enemies.hurt` now rolls a deterministic stream
against `CONFIG.ENEMY_PAIN_CHANCE` after a **non-lethal** hit and, on a hit, sets
the pain state, arms a `CONFIG.ENEMY_PAIN_TIME` timer and **zeroes the attack
windup** so an interrupted attack genuinely fires nothing. The **cooldown is left
alone** — resetting it would let a player hand the enemy a free immediate attack
by shooting it (T-05-19). The update loop's pain branch only ever *serves out*
that timer: it holds the pain frame, moves nothing, attacks nothing, and returns
to chase. Pain is never entered by the loop itself, and because the lethal branch
of `hurt()` **returns before the roll**, it can never trigger on the killing blow.
Entering pain from idle is allowed and also resumes into chase — being shot wakes
an enemy up.

**The death animation and the corpse (ENEM-04).** The lethal branch clamps health
to 0, clears `alive`, sets the death state, resets the animation timer, sets the
frame index to 0 and shows the first death frame. The update loop's death branch
advances the index **monotonically** off the same per-enemy animation timer the
walk cycle uses, one step per `CONFIG.ENEMY_DEATH_FRAME_TIME`, and when the index
runs past the end of `DEATH_FRAMES` it **latches into the terminal corpse state**.
The corpse's entire behaviour is the skip at the top of the loop: no movement, no
sight test, no cooldown, no attack — while `active` stays **true**, so the sprite
pass keeps drawing it as a floor decal, and `alive` stays **false**, so 05-02's
hitscan filter refuses it. Nothing anywhere transitions out of the corpse state.

**The kill tally (ENEM-05).** `Game.kills` / `Game.totalKills` / `Game.resetStats()`
live on `Game` rather than on `Enemies` because they are *progression*, not AI:
Phase 6's HUD readout and victory condition both read them and neither should
reach into the AI module. The increment sits **inside the one branch that clears
the alive flag**, with `hurt()`'s early return for an already-dead enemy above it,
so overkill and repeat pellets cannot inflate it. `Enemies.build()` sets
`totalKills` from the enemies it **adopted** — which *is* the marker count,
because build adopts one entity per spawn and never appends a duplicate.

**Art — five frames, one builder, one palette.** The pose table was generalised
from "limb deltas" to **sparse overrides on an explicitly written-out idle row**,
with every face feature derived from the head centre. That is what makes the fall
expressible at all: `death1` buckles at the knees (hips drop, legs shorten, feet
stay planted), `death2` folds forward at roughly half height, `death3` collapses
into the bottom quarter — measured top rows 7 → 22 → 34, so the silhouette
genuinely descends. `pain` throws the head back and foreshortened, flings the arms
outward, widens the mouth and burns the eyes hot. `corpse` is the one pose that
opts out of the standing skeleton (a `flat` branch in the same function, same
palette): a low flattened mass of body and limb colour with the horn-bone
highlights, confined to rows **51-63** so the floor-anchored billboard lies on the
ground rather than hovering.

The generalisation is byte-safe by construction — idle is *literally* the default
row — and the proof is that verify-sprites' and verify-render's exact-pixel
contracts on the legacy `enemy` alias passed **unedited**.

## Verification results

All eight harnesses print their all-pass tokens **in one chained command**, with
no assertion weakened:

| Harness | Assertions | Before | Token |
|---|---|---|---|
| verify-combat | **117** | 67 | ALL_COMBAT_CONTRACTS_PASS |
| verify-weapons | 90 | 90 | ALL_WEAPON_CONTRACTS_PASS |
| verify-sprites | 67 | 67 | ALL_SPRITE_CONTRACTS_PASS |
| verify-render | 65 | 65 | ALL_RENDER_CONTRACTS_PASS |
| verify-input-view | 17 | 17 | ALL_TRACER_CONTRACTS_PASS |
| verify-level | 56 | 56 | ALL_LEVEL_CONTRACTS_PASS |
| verify-motion | 28 | 28 | ALL_MOTION_CONTRACTS_PASS |
| verify-phase02 | 38 | 38 | ALL_PHASE02_CONTRACTS_PASS |

**The pain roll is checked statistically, not observed (3b/3c).** 200 independent
non-lethal hits — one fresh enemy each, no reset in the loop, so every trial draws
the next value from the stream — produced **51 staggers, a fraction of 0.255**,
within 0.10 of `CONFIG.ENEMY_PAIN_CHANCE` (0.3). The paired controls are what make
that meaningful: the constant forced to **0 gives 0/60** staggers and forced to
**1 gives 60/60**, so the roll is wired to CONFIG and read *live*, not hardcoded.
`3c-ii` asserts the shipped value is restored.

**The stagger interrupts, and does not pay (3d-3g).** Across the 14 CONFIG-derived
frames inside the pain window the enemy holds `enemyPain`, its position is
byte-identical and it spawns nothing; after the window it is back in chase and
moving (0.2667 cells over 10 frames). **3e is a matched pair on the same setup**:
an enemy hit mid-windup has its windup zeroed and fires **0** projectiles from it,
while the identical *uninterrupted* windup fires **1**. **3g**: the cooldown is
`1.6000 → 1.6000` at the moment of the hit and has only ticked down by the elapsed
time after the whole window (1.3333, still > 0) with zero shots fired.

**Pain never on the killing blow (3h).** With the chance forced to **1** — the
worst case for the claim — an exactly-lethal hit and an overkill hit both go
straight to the death state, while the control in the same breath (one point
*less* damage, same forced chance, same call) survives on 1 health and *does*
stagger. The difference is lethality and nothing else.

**The skip predicate is pinned directly (4-0).** An enemy with `alive === false`
that is not a corpse is **still updated** (it closed 0.187 cells), while a corpse
is skipped entirely (byte-identical position). This is the assertion that fails
loudly if anyone ever reintroduces an alive-flag skip — which would otherwise make
4b, 4c and 4d fail with nothing pointing at the cause.

**The fall plays once (4b/4c).** The observed sprite sequence is exactly
`[enemyDeath1, enemyDeath2, enemyDeath3, enemyCorpse]`, held **9/8/9** frames
against a CONFIG-derived 8.40, pairwise distinct so nothing repeats or reverses.
**300 further frames** leave it on the corpse frame with the index latched at 3.

**The corpse is a decal, not a despawn (4d/4e/4f).** A framebuffer **diff** against
the same frame with no corpse in the world shows **950 pixels drawn**, and **0**
with the same corpse's `active` forced false. Across 300 frames with the player
standing at **0.50 cells** in clear sight and the cooldown fully elapsed, the
corpse's position is byte-identical, it spawns **0** projectiles and the player
takes no damage. And a real `Weapons.fire()` straight at it hits **nothing** —
paired with a **live enemy at the same position in the same list** that the
identical shot hits for exactly `PISTOL_DAMAGE`.

**Exactly one kill, whatever you do to the body (4g-4j).** A non-lethal hit adds
nothing, the lethal hit adds 1, five further overkill hits leave it at 1, and
seven lethal shotgun pellets on one enemy count as one. `Game.totalKills` equals
the enemy marker count (3) at build with `kills` at 0, and killing every enemy in
the level drives kills to exactly totalKills (3/3) with all three settling into
corpses that keep rendering. `Entities.list` is **unchanged at 31** after every
enemy has died and 300 further frames ran.

**The whole loop in one run (section 5).** One continuous stream of **137 real
loop frames** — `Game.frame → Game.step → Enemies.update / updateProjectiles /
Weapons.update`, plus the render and present path, every frame — in which nothing
but the actors' positions and the scripted player's *intent* is touched:

| Event | Frame | Evidence |
|---|---|---|
| enemy wakes and closes | 0 | 4.00 → 2.240 cells, never nearer than ENEMY_STOP_RANGE |
| enemy fires | 23 | after waking |
| player's health falls | 66 | after the shot — 100 → 88 |
| player opens fire | 66 | the moment it is hit |
| enemy dies | 110 | after **exactly 3** shots, alive `[true, true, false]` |
| bullets spent | — | 50 → 47, exactly those 3 |
| kills | — | exactly **1**, on the death frame and at the end |
| corpse settles | 136 | corpse state, corpse frame, active true, alive false |
| corpse still renders | — | 1747 pixels drawn, 0 with active false |
| corpse re-shot | — | 0 hits, tally untouched, still costs the bullet |
| presents / frames | — | **137 / 137** |

`5c` measures "not one shot fewer" rather than inferring it: the enemy's alive
flag is recorded *as each shot resolves*.

**Self-containment gate.** `index.html` is untouched — it still references exactly
17 local relative resources (`style.css` + 16 `js/` files), no absolute or remote
URL, and no `type="module"`. `node --check` is clean on every modified `js/` file.

## Deviations from Plan

### 1. [Scenario correction] The end-to-end run cannot both hold fire from frame 0 and see the enemy land a hit first

- **Found during:** Task 3, designing section 5
- **Issue:** The plan asks to "step frames while holding the fire intent" and then
  assert, *in order*, that the enemy fires and the player's health falls **before**
  the kill. Those cannot both hold with fire held from frame 0: the pistol kills in
  ~0.70 s (three shots on a 0.35 s cooldown) while the enemy's first fireball needs
  a 0.35 s windup **plus** ~0.4 s of flight. Worse, a pain stagger on the first
  shot cancels the enemy's windup and pushes its next attack past its 1.6 s
  cooldown — so "the enemy fired at least one projectile" would have been decided
  by the pain roll, not by the combat loop.
- **Fix:** Still **one uninterrupted run**, but the scripted player's *intent*
  changes on observed events exactly as a real player's would: watch until you are
  hit, then hold fire until the thing is dead, then stop. Every assertion in the
  ordered chain is now causally real (`projF > wokeF`, `hurtF > projF`,
  `deathF > firingF`) instead of accidentally true, and the ammo accounting stays
  exact because the player is not dry-firing at a corpse.
- **Files:** `tools/verify-combat.cjs`
- **Commit:** 66741d8

### 2. [Scenario correction] 5a cannot claim the enemy lands on ENEMY_STOP_RANGE

- **Found during:** Task 3, first run of section 5 (5a failed at 2.240 against 2.0)
- **Issue:** The enemy stands still through every attack windup on the way in and
  the fight kills it before it arrives, so it closes to 2.240 rather than exactly
  2.0. Written as "stopped where the constant says", the assertion was measuring
  the fight's length, not the chase.
- **Fix:** 5a claims what is actually true and load-bearing here — it woke, it
  closed by more than a full cell, and it **never came nearer than
  ENEMY_STOP_RANGE**. The exact landing-on-the-stop-range proof already exists in
  1d, in open space with the attack gate deliberately parked, which is the right
  place for it.
- **Files:** `tools/verify-combat.cjs`
- **Commit:** 66741d8

### 3. [Rule 2 - Missing critical functionality] A rebuild must reset the kill tally

- **Found during:** Task 2, against must-have truth 4h ("Game.kills is 0 at build")
- **Issue:** The plan specifies `Game.resetStats()` called from `main.js` at boot
  and `Enemies.build()` setting `Game.totalKills`. But `build()` **resurrects every
  enemy at full health**, and a restart (or any harness scenario) that rebuilt
  without re-zeroing would leave a tally counting enemies that are alive again —
  and Phase 6's victory condition reads exactly that number.
- **Fix:** `Enemies.build()` zeroes the tally through `Game.resetStats()` in the
  same breath as setting `totalKills`, documented as the invariant. `main.js` keeps
  its explicit boot call alongside `Combat.reset()`, which is where a reader looks
  for the boot seed.
- **Files:** `js/enemies.js`, `js/game.js`, `js/main.js`
- **Commit:** 5dad554

### 4. [Implementation choice] The pose table was generalised, not extended

- **Found during:** Task 1
- **Issue:** 05-01's pose table is a set of **limb offsets on hardcoded standing
  geometry**. A fall is not a limb offset: `death1`-`death3` have to drop the hips,
  shorten the legs, compress the torso and move the head — and the face features
  were hardcoded at the idle head position, so a dropped head would have left the
  eyes and horns floating where the head used to be.
- **Fix:** The table became **sparse overrides on an explicitly written-out idle
  row**, with the face derived from the head centre. Idle is now literally "the
  defaults", which is a *stronger* anti-drift guarantee than the previous all-zero
  convention. Byte-identity for all four shipped poses is proven by verify-sprites'
  and verify-render's exact-pixel contracts passing unedited.
- **Files:** `js/sprites.js`
- **Commit:** 4916524

### 5. [Consistency with 05-02] The pain stream is not a `mulberry32()` closure

The plan asks for a mulberry32 stream "created once at module load so no allocation
happens per hit". A returned closure allocates on every re-seed, so — exactly as
05-02 did for the pellet spread — the generator is a module-scope function over an
integer `Enemies.randState`. The output sequence is byte-identical to
`mulberry32`'s; re-seeding (`Enemies.seedRand()`, called at module load and from
`Enemies.reset()`) is one integer assignment. Nothing allocates, ever.

### Strengthened, not weakened

`2s`'s delta guard now snapshots `painTime` and `deathFrame` alongside every other
mutable enemy field. A delta guard that misses a field is not a guard.

## Delegated to the orchestrator (real browser, `file://` and a static server)

Automated verification cannot see the screen, so the visual/feel pass is delegated:

- Shoot an enemy repeatedly and confirm it **visibly flinches on some hits but not
  all** — the recoiled pose with the thrown-back head should read at a few cells'
  distance, and the flinch should look like an interruption, not a pause.
- Keep shooting and confirm the death reads as a **fall**: three frames descending,
  not a fade or a pop.
- Confirm the corpse **lies on the floor** rather than hovering at eye level, and
  that it does not disappear when you walk past or around it.
- Shoot the corpse and confirm **nothing happens** (no flinch, no sound cue when
  Phase 6 adds one, no tally movement).
- Clear a room and confirm `Game.kills === Game.totalKills` — read it from the
  console until Phase 6 draws the HUD.
- **rAF-throttle caveat:** on a non-composited or headless open the loop does not
  tick. Drive frames manually with `Game.step(0.016)`, then `Game.view.render()`,
  then `Framebuffer.present()`.

A headless proxy for that path was run and is green, driving real frames exactly
that way — 300 manual `Game.step(0.016)` + `Game.view.render()` +
`Framebuffer.present()` frames, 300 presents, 300 `putImageData` calls, 598
distinct sampled framebuffer colours:

- **Frames seen:** `enemyIdle, enemyAttack, enemyPain, enemyWalk1, enemyDeath1,
  enemyDeath2, enemyDeath3, enemyCorpse` — the whole animation set drew, including
  a real **16-frame pain stagger** produced by the shipped 0.3 chance.
- **End state:** corpse / `enemyCorpse` / active true / alive false / health 0.
- **Tally:** kills 1 of 3, bullets 50 → 47.
- **Corpse re-shot:** 0 hits, `lastTarget` is not the corpse, tally unmoved.
- **Room cleared:** all three enemies killed → `kills 3 / 3`, all three in the
  corpse state, `Entities.list` still 31.

## Known Stubs

None. Every field this plan declares is written by this plan's code. Two items are
live-but-awaiting-callers, documented as such in their own file headers rather
than silently inert:

- `Game.kills` / `Game.totalKills` — real, tested-by-construction counters
  (4g-4j, 5e). **Drawing** them is HUD-01/HUD-02 in Phase 6; this plan's stated
  BOUNDARY is that it produces the numbers and renders nothing.
- `Enemies.DEATH_FRAMES` / `CORPSE_FRAME` / `PAIN_FRAME` — the frame names exposed
  as data so the harness (and Phase 6's audio hooks) derive from them rather than
  re-typing string literals.

## Threat Flags

None. No network endpoint, auth path, file access or trust-boundary schema was
introduced. Every disposition in the plan's `<threat_model>` is covered by a named
assertion:

| Threat | Covered by |
|---|---|
| T-05-16 (kill tally double-counting) | **4g**, 4g-ii, 3i, 5e, 5h |
| T-05-17 (corpse targetable or attacking) | **4e**, **4f** with the live-enemy control, 5h |
| T-05-18 (death animation loop) | 4b, 4b-iii, **4c** (300 further frames) |
| T-05-19 (pain cancelling damage / free attack) | **3e** (paired), **3g**, **3h** (paired) |
| T-05-20 (per-hit allocation from the pain roll) | **4j**, 2r-i |
| T-05-SC (package installs) | no package manager anywhere; self-containment gate green |

## Self-Check: PASSED

- `js/config.js`, `js/sprites.js`, `js/enemies.js`, `js/game.js`, `js/main.js`,
  `tools/verify-combat.cjs` — all FOUND
- Commits 4916524, 5dad554, 66741d8 — FOUND in git log
- All eight all-pass tokens print in one chained command (117/90/67/65/17/56/28/38)
- `node --check` clean on every modified `js/` file
- No file deletions in any of the three commits; working tree clean under `Doom/`
