---
phase: 05-enemy-ai-weapons-pickups
plan: 02
subsystem: player-weapons-hitscan
tags: [hitscan, dda-wall-stop, ammo, weapon-switching, viewmodel, overlay-seam, procedural-sprites]
status: complete

requires:
  - "Enemies.hurt(enemy, dmg) — the single enemy-damage entry point (05-01)"
  - "Enemies.list + the alive flag; the corpse-state update skip that leaves alive as the TARGET filter (05-01)"
  - "Combat.ammo.bullets / ammo.shells / weapon / hasShotgun / dead (05-01)"
  - "Game.step's ZERO_INTENT substitution while Combat.dead, and Game.time accumulated inside step (05-01)"
  - "Level.isSolid + Level.lineOfSight strictly-between DDA (Phase 2)"
  - "Player pose {x,y,dirX,dirY} + WALK_SPEED/RUN_MULT (Phase 2)"
  - "Raycaster.render's three-pass skeleton + spritePass seam; Framebuffer.buf32/zBuffer (Phases 3-4)"
  - "Sprites shape-then-colorize builders + the binary ALPHA_KEY contract (Phase 2)"
  - "tools/boot.cjs manual rAF scheduler + virtual clock (Phase 2)"
provides:
  - "Weapons global: TABLE, wallDistance, castRay, fire, update, reset, updateViewmodel, renderViewmodel"
  - "Weapons.wallDistance(x,y,dirX,dirY) — along-ray distance to the first solid cell, bounded"
  - "Weapons.lastRayCount / lastHitCount / lastTarget / lastDryFire / shotsFired / dryFires — allocation-free shot inspection"
  - "Weapons.viewmodelBox + Weapons.recoilOffset() — where the gun ended up, for Phase 6's HUD"
  - "Raycaster.overlayPasses — the ORDERED post-sprite overlay seam (05-04 appends the message line)"
  - "Combat.selectWeapon(name) — the one place Combat.weapon changes, with the hasShotgun grant gate"
  - "intent.fire + intent.weaponSlot on the Input contract and on the frozen Game.ZERO_INTENT"
  - "Input.mouseFire (pointer-lock gated) + Input.pendingSlot (drained on read) + Input.SLOT_KEYS"
  - "Sprites weaponPistol / weaponShotgun / muzzleFlash ('weapon' stays a strict-identity alias)"
  - "tools/verify-weapons.cjs — 90-assertion headless hitscan + viewmodel harness"
affects:
  - "05-03 (damage response): every hitscan hit enters through Enemies.hurt, so the pain/death/corpse branch it adds is reached by pistol and shotgun alike with no weapon change"
  - "05-04 (pickups): grants hasShotgun + shells (Combat.selectWeapon then admits slot 2) and bullets; appends its message line to Raycaster.overlayPasses AFTER the viewmodel"
  - "Phase 6 (HUD/audio): reads Combat.weapon/ammo and Weapons.lastDryFire/shotsFired for the click and gunshot hooks; draws the rest of the HUD over the same overlay seam"

tech-stack:
  added: []
  patterns:
    - "ONE fire path for every weapon: the pistol is a one-pellet weapon with a tiny spread, not a special case — two implementations would drift on the first retune"
    - "ORDERED ARRAY seam instead of a nullable hook, once more than one consumer wants the slot and their order matters"
    - "The PRNG as a module-scope function over an integer state field rather than a returned closure, so re-seeding is allocation-free"
    - "Falsifiable occlusion proofs by toggling exactly ONE map cell, so the blocked and connecting shots differ by nothing else"
    - "Screen-space overlays are UNFOGGED and never write zBuffer; world passes own depth"
    - "Where a proof cannot be built by moving geometry, hold the geometry fixed and vary the CONFIG constant — which additionally proves the constant is read live"

key-files:
  created:
    - "Doom/Claude Opus 4.8/GSD/js/weapons.js"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-weapons.cjs"
  modified:
    - "Doom/Claude Opus 4.8/GSD/js/config.js"
    - "Doom/Claude Opus 4.8/GSD/js/combat.js"
    - "Doom/Claude Opus 4.8/GSD/js/input.js"
    - "Doom/Claude Opus 4.8/GSD/js/game.js"
    - "Doom/Claude Opus 4.8/GSD/js/raycaster.js"
    - "Doom/Claude Opus 4.8/GSD/js/sprites.js"
    - "Doom/Claude Opus 4.8/GSD/js/main.js"
    - "Doom/Claude Opus 4.8/GSD/index.html"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-render.cjs"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-sprites.cjs"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-input-view.cjs"

decisions:
  - "The bob amplitude scales against MAX ground speed (WALK_SPEED * RUN_MULT), not WALK_SPEED — clamping the ratio at walking pace saturates the amplitude there and makes running look identical to walking, contradicting the plan's own run-vs-walk assertion"
  - "The ammo gate refuses BEFORE touching the cooldown, so a dry click does not lock the player out for a third of a second — including the click immediately before they pick ammo up"
  - "ONE shared cooldown on Weapons, never one per weapon: a per-weapon timer lets 1-2-1-2 fire at the sum of both rates"
  - "The overlay seam is an ORDERED ARRAY, not a second nullable hook, because 05-04's message line must land on top of the viewmodel without wrapping it"
  - "Line of sight is tested LAST in castRay and a candidate that fails it does not consume the win, so a farther VISIBLE enemy behind an occluded one is still a legal target"
  - "The spread PRNG is a module-scope function over Weapons.randState rather than a mulberry32() closure, so reset() re-seeds with an integer assignment and allocates nothing"
  - "The recoil is measured in the harness AFTER the flash window closes: the flash burst reaches above the weapon's top edge, so a bounding box taken on the shot frame is the FLASH's box, not the weapon's"
  - "The HITSCAN_RANGE proof varies the CONFIG constant around fixed geometry, because the shipped 24-cell range exceeds the longest clear line (~21 cells) in a 24x24 level"

requirements: [WEAP-01, WEAP-02, WEAP-03, WEAP-04, WEAP-05]

metrics:
  duration: ~55 min
  tasks: 3
  commits: 3
  files-created: 2
  files-modified: 11
  lines-added: 2079
  assertions-added: 90
  completed: 2026-07-25
---

# Phase 5 Plan 02: Hitscan Weapons, Ammo & Weapon Viewmodel Summary

The player can now shoot: a pistol that puts one accurate ray into the nearest living
enemy and a shotgun that throws seven, both stopped dead by a single cell of wall,
both spending their own ammo and refusing to fire when empty, and both presented with
a viewmodel that bobs with the player's actual speed, kicks on fire and flashes at the
muzzle — proven by a 90-assertion headless harness in which every zero-result claim has
a sibling that makes the same measurement come out the other way.

05-01 proved enemy-to-player. This plan proves player-to-enemy, and closes the loop.

## What was built

**`js/weapons.js` — the whole weapon subsystem, in three layers.**

*The table.* `Weapons.TABLE` is data read straight out of CONFIG: damage, pellet
count, spread, cooldown, the `Combat.ammo` field the weapon spends, and the viewmodel
asset it draws. Two entries with the **identical shape running the identical fire
path** — the pistol is a one-pellet weapon with a 0.01 rad spread, not a special case.
`Weapons.MAX_PELLETS` is computed from the table (not hardcoded) and sizes the
preallocated `Float64Array` of pellet angles, so adding a third weapon cannot silently
overflow it.

*The resolution.* `wallDistance` is a grid DDA in world coordinates mirroring
`Level.lineOfSight`'s structure exactly — the finite `1e30` substitute for a zero
direction component (an `Infinity` would produce `NaN` against a zero fractional
offset), sideDist seeded from the fractional position inside the start cell, and a hard
`WIDTH + HEIGHT + 2` iteration cap. Because the ray is **unit length**, the sideDist
*before* it is advanced already *is* the along-ray distance at which the next cell
boundary is crossed, so the wall distance falls out with no extra arithmetic.
`js/raycaster.js`'s inline DDA was deliberately **not** refactored to share it: the
Phase 3 exact-pixel contracts depend on that function staying byte-stable.

`castRay` then applies D-05's six gates — `alive`, in front, inside range, **strictly
nearer than the wall**, inside `HITSCAN_TARGET_RADIUS` perpendicular, and clear line of
sight — and hurts the nearest survivor through `Enemies.hurt`. Along-ray distance is
the dot product with the unit ray and perpendicular distance the magnitude of the
cross product: both exact, neither needing a divide or any trig.

*The presentation.* `updateViewmodel` measures speed from the **pose delta**, not the
intent, so a player pressing forward into a wall correctly has a still weapon.
`renderViewmodel` anchors the asset bottom-centre at `VIEWMODEL_HEIGHT_FRAC` of the
frame height with the width derived from the source aspect (so it never stretches on
widescreen), offsets it by a figure-of-eight bob (the fundamental in x, the second
harmonic in y — a stride, not a sway), pushes it down by the linearly-eased recoil, and
composites the flash **relative to the weapon box** so the flash rides the bob and the
kick for free rather than needing its own offsets.

**`Raycaster.overlayPasses` — an ordered seam, not a second hook.** More than one thing
wants the slot after the sprite pass and the order between them matters: this plan
appends the viewmodel, 05-04 appends the message line, which must land *on top* of the
gun. A single nullable `spritePass`-style hook would force the second consumer to wrap
the first. It defaults to an empty array, so a harness that wants isolation truncates
it — which is exactly what `verify-render` and `verify-sprites` now do, in place.

**`Combat.selectWeapon(name)` — the grant gate lives in the inventory.** Three silent
refusals that mutate nothing: an unknown name, the shotgun before `hasShotgun`, and a
no-op reselect. It sits in `js/combat.js` rather than in the weapon module on purpose —
"do you own a shotgun" is an inventory question, so 05-04's pickup only has to set the
flag and every path agrees.

**Input stays intent-only.** Space and both Control keys are a new **held-boolean**
`fire` slot handled exactly like `run` (a `BOOL_SLOTS` data set replaced the old
`slot === 'run'` comparison). The Control keys are bound but excluded from `PREVENT`
via a `NO_PREVENT` set, so binding them does not swallow every browser shortcut. The
mouse trigger is armed only while the canvas holds pointer lock, **checked at event
time** like `mousemove`, and disarmed unconditionally on mouseup. The weapon select is a
one-shot edge — `Input.pendingSlot` recorded on keydown and **drained on read** exactly
as the mouse delta is drained — so a held digit key selects once, not sixty times a
second. `Input.reset()` clears both, so losing focus or lock mid-click cannot leave the
trigger stuck down.

**Art.** The pistol viewmodel is now registered as `weaponPistol` with `Sprites.map
.weapon` kept as a **strict-identity alias** (the same discipline `m.enemy` uses for the
idle frame), which is why every earlier consumer and every Phase 4 pixel proof needed no
edit. The shotgun is the same 96x64 framing and the same mask-then-colorize style —
twin barrels, a grooved wooden pump fore-end and stock, the same gloved hands — sharing
the pistol's gunmetal and glove palette entries so the two read as one character's
weapons while the wood tone makes them instantly distinguishable. The muzzle flash is a
48x48 four-point burst with **every material flat** (a key-lit flash would read as a
rock) and **no `outline()` call** (a dark rim around a flash reads as a hole), which is
what gives it alpha exactly 0 outside the burst and a four-value palette provably
disjoint from both weapons.

## The wall-stop proof (the one worth reading)

The research calls "shooting through walls" out explicitly, so it gets the strongest
form of falsifiability available: **the blocked shot and the connecting shot differ by
exactly one map cell and nothing else.**

Row 6 of the authored level carries a single brick cell at column 6 with open floor on
both sides. The player stands at (2.5, 6.5) facing east; the enemy stands at (7.5, 6.5),
five cells away.

| Assertion | The one variable | Wall distance | Damage |
|---|---|---|---|
| 1d | cell (6,6) as authored (brick) | 3.50 | **0** |
| 1e | cell (6,6) set to 0 | 6.50 | **15** (exactly `PISTOL_DAMAGE`) |
| 2g | cell (6,6) as authored, shotgun | 3.50 | **0** of 7 pellets |
| 2g-ii | cell (6,6) set to 0, shotgun | 6.50 | **28** = 4 pellets |

`1d-i` additionally asserts the authored geometry itself (one solid cell, open floor
either side), so a future map edit fails loudly here rather than quietly turning the
wall-stop proof vacuous. `1d-ii` pins the wall distance to exactly 3.50 — the (6,6)
face at x=6 measured from x=2.5 — so the proof is that the *mechanism* fired, not just
that the damage was zero.

## Verification results

All eight harnesses print their all-pass tokens **in one chained command**, with no
assertion weakened:

| Harness | Assertions | Before | Token |
|---|---|---|---|
| verify-weapons | **90** | (new) | ALL_WEAPON_CONTRACTS_PASS |
| verify-combat | 67 | 67 | ALL_COMBAT_CONTRACTS_PASS |
| verify-sprites | 67 | 67 | ALL_SPRITE_CONTRACTS_PASS |
| verify-render | 65 | 65 | ALL_RENDER_CONTRACTS_PASS |
| verify-input-view | 17 | 17 | ALL_TRACER_CONTRACTS_PASS |
| verify-level | 56 | 56 | ALL_LEVEL_CONTRACTS_PASS |
| verify-motion | 28 | 28 | ALL_MOTION_CONTRACTS_PASS |
| verify-phase02 | 38 | 38 | ALL_PHASE02_CONTRACTS_PASS |

**Section 1 — the pistol (37 assertions).** 1a lands exactly `PISTOL_DAMAGE` for exactly
one bullet at five cells. 1b's nearest-wins pair damages the enemy at 4 cells and leaves
the one at 8 untouched. **1c and 1a are each other's control**: identical positions, the
only difference being a 30-degree aim rotation, putting the enemy 2.50 cells off the
ray — far outside the 0.35 target radius, zero damage. 1f holds the geometry fixed at
5.0 cells and varies `HITSCAN_RANGE` (4.0 → blocked, 6.0 → exactly `PISTOL_DAMAGE`),
restoring the shipped value afterwards and asserting the restore. 1g proves the ammo
gate mutates nothing **and leaves the cooldown at 0**, with a one-bullet control that
fires and *does* charge it. 1h: one simulated second of held fire produced 3 shots
against `floor(1/0.35) = 2`, within one, and nowhere near the 60 frames driven. 1i
drives a **real Space keydown through the real loop** and separately proves the mouse
trigger is pointer-lock gated at event time, disarms on mouseup, and cannot survive a
lock loss mid-click. 1j: 20 shots leave the z-buffer byte-identical, and 300 frames of
continuous firing leave `Entities.list` at 32 and the pool at 24. 1k completes 05-01's
2t: a dead player holding fire, forward, strafe, turn and a mouse delta for 60 frames
spends no ammo, damages nothing and does not move — with the identical intent on a live
player spending 3 bullets and killing the enemy.

**Section 2 — the shotgun (25 assertions).** The grant gate 2a/2b is a matched pair on
the identical intent. 2c proves each weapon spends only its own field. 2d: 7 rays versus
exactly 1. 2e: seven **distinct** offsets, worst 0.06897 rad, inside the 0.08 spread,
and non-zero. 2f is exact: point-blank, every pellet inside the target radius, 49 damage
= `SHOTGUN_PELLETS * SHOTGUN_DAMAGE` (the target's health is raised above a full blast
first, because `Enemies.hurt`'s re-entry guard would correctly clamp 49 to the 40 it
started with and hide the multiple). 2h is the switch-cannot-bypass-cooldown proof: the
slot-1 select lands on the same frame while the shotgun's timer is still at 0.6833 —
CONFIG-derived to the fourth decimal — and no pistol shot comes out. 2j replays three
shotgun blasts through `Weapons.reset()` and reproduces all 21 pellet angles element for
element, with a control confirming 21 *distinct* values so determinism is not a constant.

**Section 3 — the viewmodel (28 assertions).** 3b is the no-halo proof done properly:
the destination box is **recomputed independently from the documented formula** (not read
out of `Weapons.viewmodelBox`), and then every pixel inside it is checked against the
nearest-neighbour source texel — 5100 written pixels each equal to the **raw** texel and
fully opaque (unfogged), 13997 alpha-key-skipped pixels each byte-for-byte the
pre-overlay frame, and **0 stray writes outside the box**. 3c snapshots the z-buffer,
runs the overlay pass *in isolation* with both blits active, and finds it byte-identical
— with a non-vacuity control confirming that pass really wrote 5120 framebuffer pixels.
3d measures the drawn bounding box once per frame across 30 stepped frames: standing
gives **1 distinct box**, walking gives 7, and the horizontal excursion is **8 px at run
speed against 4 px at walk**. 3e matches the box top to the eased recoil offset exactly
(173 = 170 + 3). 3f walks the flash window with a no-fire control at 0 pixels, 838 at the
shot, 838 still present with 0.0100 s left, and 0 once elapsed — meaningful because 3-0e
first proves the flash's four emissive colours are **disjoint** from both weapon
palettes. 3g goes past "the frames differ" to "the shotgun frame contains 3256 pixels in
colours that exist **only** in the shotgun asset". 3h confirms present count still equals
frame count.

**Self-containment gate.** `index.html` references exactly 17 local relative resources
(`style.css` + 16 `js/` files), no absolute or remote URL, no `type="module"`, and grew
by **exactly one** script tag.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] The planned bob amplitude scaling contradicts the plan's own assertion**
- **Found during:** Task 3, designing assertion 3d-iii
- **Issue:** The plan specifies the amplitude as `BOB_AMP_PIXELS` scaled by "the speed relative to `Player.WALK_SPEED` and clamped to 1", and then asks 3d to prove "its horizontal excursion is larger at run speed than at walk speed". Those cannot both hold: walking already produces a ratio of exactly 1, so the clamp saturates there and running is pixel-identical to walking. The requirement (WEAP-04, "bob with movement") is only observable if speed actually modulates it across the whole range.
- **Fix:** The ratio is `speed / (Player.WALK_SPEED * Player.RUN_MULT)` — the player's real maximum ground speed — still clamped to 1 as a structural guard. Walking now gives 0.556 of full amplitude and running gives 1.0. Measured: 4 px excursion walking, 8 px running, 0 px standing. Documented in `js/weapons.js`'s `updateViewmodel` header.
- **Files:** `js/weapons.js`
- **Commit:** effa19b

**2. [Rule 3 - Blocking] The `HITSCAN_RANGE` proof cannot be built from geometry**
- **Found during:** Task 1, writing assertion 1f
- **Issue:** The plan asks for "an enemy beyond `CONFIG.HITSCAN_RANGE` takes no damage; the same enemy just inside the range does". `HITSCAN_RANGE` is 24.0 cells (per D-11) and the longest clear line inside the 24x24 level is about 21 cells, so no reachable position is beyond the range. Written literally the assertion would have been unbuildable, and quietly dropping it would have left the constant untested.
- **Fix:** The pair holds the enemy fixed at 5.0 cells and varies the constant around it (4.0 → blocked, 6.0 → exactly `PISTOL_DAMAGE`), then restores the shipped value and asserts the restore in `1f-iii`. This proves something slightly *stronger* than the planned version: the range is read from CONFIG **at shot time**, not captured at load. The situation is documented in `config.js` beside `HITSCAN_RANGE` (in practice the DDA wall stop, never the range, is what bounds a shot in this level) and in the harness beside 1f.
- **Files:** `js/config.js`, `tools/verify-weapons.cjs`
- **Commit:** 7f0b6e7

**3. [Rule 1 - Bug] The planned recoil measurement measures the muzzle flash**
- **Found during:** Task 3 — assertion 3e failed on first run with a bounding-box top of 144 against a resting 170, i.e. *higher*, not lower
- **Issue:** The plan asks for the bounding box top "on the frame after a shot". On that frame the muzzle flash is also active, and the flash burst is anchored at the muzzle and reaches roughly 35 px **above** the weapon's top edge — so the measured box was the flash's, and it moved the wrong way. Restricting the diff to weapon-coloured pixels does not fix it either: the flash overdraws the barrel's topmost rows.
- **Fix:** The recoil is measured on the first frame after the flash window has **closed** while the kick is still easing, which `CONFIG.MUZZLE_FLASH_TIME < CONFIG.RECOIL_TIME` guarantees exists — asserted as a CONFIG-derived precondition in `3e-0` so a future retune fails loudly instead of silently re-contaminating the measurement, with `3e-i` confirming the window (flash 0, recoil 0.0533 s left). The claim was also **strengthened** from "lower than resting" to an exact match against the independently recomputed eased offset: top 173 === resting 170 + kick 3.
- **Files:** `tools/verify-weapons.cjs`
- **Commit:** effa19b

**4. [Rule 2 - Missing critical functionality] Binding the Control keys would have swallowed browser shortcuts**
- **Found during:** Task 1, step 3
- **Issue:** The plan correctly says not to `preventDefault` on the Control keys — but `PREVENT` is built by iterating `BINDINGS`, so simply adding `ControlLeft`/`ControlRight` to `BINDINGS` (as the plan's own instruction to add fire bindings requires) would have added them to `PREVENT` automatically and suppressed Ctrl+R, Ctrl+W and Ctrl+Shift+I for anyone playing.
- **Fix:** A `NO_PREVENT` data set is subtracted while `PREVENT` is built, so the exclusion is declarative and visible rather than a `delete` after the fact. `Space` remains in `PREVENT` (it was already there explicitly, and a scrolling page while firing is the bug that entry exists to stop).
- **Files:** `js/input.js`
- **Commit:** 7f0b6e7

### Sequencing note (not a behaviour change)

The plan assigns the `fire` intent field to Task 1 and `weaponSlot` to Task 2. Both
intent fields ship in Task 1, because they are the same edit region in `js/input.js` and
the same frozen literal in `js/game.js`, and shipping half a frozen record would have
left `Game.ZERO_INTENT` inconsistent between two commits. Task 2 adds what *acts* on the
slot: `Combat.selectWeapon` and the resolution inside `Weapons.update`. Each task is
still independently verified and independently green.

### Two implementation choices worth recording

- **The spread PRNG is not a `mulberry32()` closure.** The plan asks for a
  `mulberry32` stream seeded from `CONFIG.SEED + CONFIG.WEAPON_SEED_SALT`, and for
  `reset()` to allocate nothing. A returned closure is an allocation per reset, so the
  generator is written as a module-scope function over an integer `Weapons.randState`
  field. The output sequence is byte-identical to `mulberry32`'s (same state update, same
  scramble); the difference is that re-seeding is one integer assignment. 2j proves the
  stream reproduces element for element.
- **`castRay` tests line of sight LAST, and a candidate that fails it does not consume
  the win.** LOS is the only gate costing a DDA march, so it runs after the cheap
  arithmetic — but more importantly, an occluded nearer enemy must not shadow a farther
  *visible* one, which it would if `bestD` were updated before the LOS test.

## Delegated to the orchestrator (real browser, `file://` and a static server)

Automated verification cannot see the screen, so the visual/feel pass is delegated:

- Click to lock the pointer, fire the pistol at an enemy: confirm the muzzle flash, the
  downward kick and the enemy visibly taking hits.
- Walk and confirm the weapon bobs in a figure-of-eight; stop and confirm it goes
  completely still; hold Shift and confirm the bob is visibly bigger and faster.
- Fire at a wall with an enemy behind it and confirm nothing is hit.
- Empty the magazine and confirm firing stops (and that firing resumes immediately once
  ammo is granted — nothing is locked out).
- Press `1`/`2` and confirm the shotgun is refused until granted, then that the drawn
  weapon changes to the wooden double-barrel and that a blast is visibly more lethal
  than a pistol shot at point-blank range.
- Confirm the viewmodel reads as a gun in two gloved hands at the bottom centre and
  stays bright in dark corridors (it is deliberately unfogged).
- **rAF-throttle caveat:** on a non-composited or headless open the loop does not tick.
  Drive frames manually with `Game.step(0.016)`, then `Game.view.render()`, then
  `Framebuffer.present()`.

A headless proxy for that path was run and is green, driving real frames exactly that
way:

- **Pistol:** the enemy died in 45 driven frames (cooldown-limited, three 15-damage
  shots), bullets 50 → 47, `alive` cleared and state `death` — i.e. the hit path enters
  05-03's branch as designed.
- **Bob:** 5 distinct viewmodel x positions across 40 walking frames, **1** across 20
  standing frames.
- **Wall:** an enemy behind the (6,6) brick took **0** damage across 40 frames of
  continuous firing.
- **Ammo:** the magazine emptied to 0 and dry fires were recorded.
- **Switch:** slot 2 resolved to `pistol` before the grant and `shotgun` after it.
- **Frame accounting:** 272 manual presents, 272 `putImageData` calls, non-uniform
  framebuffer.

## Known Stubs

None. Every field this plan declares is written by this plan's code. Three items are
live-but-awaiting-callers, each documented as such in its own file header rather than
silently inert:

- `Weapons.lastDryFire` / `dryFires` — real, tested-by-construction records (1g-iii)
  that Phase 6 hangs the empty-click sound on.
- `Weapons.viewmodelBox` / `recoilOffset()` — real, tested-by-construction (3b, 3e)
  and read by Phase 6's HUD when it needs to know where the gun is.
- `Combat.hasShotgun` — flipped by 05-04's shotgun pickup; the gate that reads it is
  live and proven from both sides (2a/2b).

`CONFIG.HITSCAN_RANGE` at 24.0 does not bound any shot in the shipped 24x24 level (the
DDA wall stop always fires first). That is deliberate and documented beside the constant
— it exists so a larger future level cannot make the target scan unbounded — and the
gate itself is proven live by 1f/1f-ii.

## Threat Flags

None. No network endpoint, auth path, file access or trust-boundary schema was
introduced. Every disposition in the plan's `<threat_model>` is covered by a named
assertion:

| Threat | Covered by |
|---|---|
| T-05-09 (wallDistance DDA spin) | structural cap + 1d-ii / 1e-ii pinning exact distances |
| T-05-10 (hitscan through walls) | **1d/1e** and **2g/2g-ii**, each an opened-wall control |
| T-05-11 (ammo accounting) | 1g, 1g-ii, 1g-iv, 2c, 2i, 2i-ii |
| T-05-12 (switch-to-bypass-cooldown) | 1h, 2h, 2h-iii, 2h-iv |
| T-05-13 (viewmodel blit indices) | 3b, 3b-ii, **3b-iii** (0 writes outside the recomputed box) |
| T-05-14 (overlay perturbing prior contracts) | verify-render + verify-sprites truncation; 3c |
| T-05-15 (stuck fire after focus loss) | 1i-ii, 1i-iii, 1i-iv, **1i-v** |
| T-05-SC (package installs) | no package manager anywhere; self-containment gate green |

## Self-Check: PASSED

- `js/weapons.js`, `tools/verify-weapons.cjs` — FOUND
- All 11 modified files — FOUND
- Commits 7f0b6e7, 1f2584a, effa19b — FOUND in git log
- All eight all-pass tokens print in one chained command
- `node --check` clean on every modified `js/` file
- No file deletions in any of the three commits; working tree clean under `Doom/`
