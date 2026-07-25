---
phase: 05-enemy-ai-weapons-pickups
plan: 04
subsystem: pickups-level-population-message
tags: [pickups, adoption, effect-table, level-population, bitmap-font, overlay-order, sound-hook]
status: complete

requires:
  - "Entities.build's `kind` adoption handle + the fresh-array rebuild semantics (05-01)"
  - "Enemies.reset()'s guarded Pickups.build() hook (05-01)"
  - "Combat.heal / Combat.addArmor + the LOCKED armor absorption formula (05-01)"
  - "Combat.selectWeapon's hasShotgun grant gate (05-02)"
  - "Raycaster.overlayPasses — the ORDERED post-sprite draw seam (05-02)"
  - "Game.time accumulated inside Game.step, not Game.frame (05-01)"
  - "Entities.render's strict active===false skip (05-01)"
  - "Level.SOURCE marker contract: a marker cell parses as plain FLOOR (Phase 2)"
  - "Sprites mask-then-colorize builders + the binary ALPHA_KEY contract (Phase 2)"
provides:
  - "Pickups global: the adopted view, the EFFECTS data table, proximity collection"
  - "Pickups.build() — re-runnable, truncate-in-place, the anti-orphan gate"
  - "Sound global: the Sound.play(name) event hook + Sound.NAMES (Phase 6 replaces the body)"
  - "Combat.addBullets / addShells / grantShotgun — the remaining inventory grants"
  - "Entity `itemType` field + the four typed pickup descriptors"
  - "Game.messages ring + message() / activeMessage() / messageAge() / clearMessages()"
  - "Game.renderMessage + Game.messageBox + Game.messageShade — the framebuffer line"
  - "Sprites.font — a reusable 5x7 uppercase bitmap font (Phase 6's HUD text builds on it)"
  - "Sprites pickupHealth / pickupArmor / pickupAmmo / pickupShotgun ('pickup' stays an alias)"
  - "The populated level: 8 enemy markers, 9 item markers (LVL-02)"
  - "tools/verify-pickups.cjs — 84-assertion headless pickup, population and message harness"
affects:
  - "Phase 6 (HUD): reads Combat.health/armor/ammo/hasShotgun and Game.kills/totalKills, and draws its text with Sprites.font over the same overlayPasses seam"
  - "Phase 6 (audio): replaces the Sound.play body with Web Audio synthesis and adds the firing / enemy-death / player-damage call sites"
  - "Phase 6 (victory): Game.totalKills is now 8, out of the real populated marker count"

tech-stack:
  added: []
  patterns:
    - "ADOPTION extended to a second module: `kind` selects the owner, `itemType` selects the behaviour WITHIN that owner, so four items are four rows of data rather than four branches"
    - "A derived VIEW is truncated in place and rebuilt in the same breath as the list it derives from — never reassigned, so its array identity is stable and it can never hold orphans"
    - "The effect table stores the CONFIG KEY, not the value, so the constant is read at collection time and a harness that varies it proves the read is live"
    - "Every clamp lives in the grant, never in the caller: there is no second path by which a field could exceed its maximum"
    - "A hook that RECORDS is verifiable; a hook whose body is `return` is not — the recording is what makes the Phase 5/6 boundary provable rather than assumed"
    - "A marker edit that touches only FLOOR characters is byte-neutral on the parsed grid — proven by an explicit before/after diff, not asserted by intent"
    - "Layout claims are made about the ADVANCE BOX, not the ink: an edge glyph's ink need not reach its cell border"

key-files:
  created:
    - "Doom/Claude Opus 4.8/GSD/js/pickups.js"
    - "Doom/Claude Opus 4.8/GSD/js/sound.js"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-pickups.cjs"
  modified:
    - "Doom/Claude Opus 4.8/GSD/js/config.js"
    - "Doom/Claude Opus 4.8/GSD/js/sprites.js"
    - "Doom/Claude Opus 4.8/GSD/js/combat.js"
    - "Doom/Claude Opus 4.8/GSD/js/entities.js"
    - "Doom/Claude Opus 4.8/GSD/js/game.js"
    - "Doom/Claude Opus 4.8/GSD/js/level.js"
    - "Doom/Claude Opus 4.8/GSD/js/main.js"
    - "Doom/Claude Opus 4.8/GSD/index.html"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-level.cjs"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-sprites.cjs"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-render.cjs"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-input-view.cjs"

decisions:
  - "Pickups.collect DEACTIVATES the entity BEFORE applying the grant, not after: deactivation is then unconditional on anything the grant does, so no ordering exists in which an effect lands while the item stays on the floor"
  - "Combat.addShells was added so grantShotgun routes its shells through a grant like everything else — without it the 'the pickup never touches an inventory field directly' invariant had a hole in its own implementation"
  - "The message glyph scale is derived from HEIGHT and then CLAMPED DOWN BY WIDTH; height alone lets a long message overflow the frame at large internal resolutions"
  - "Entities.build copies itemType onto EVERY entity (null for an enemy) rather than only onto pickups, keeping one object shape for the whole list so the sprite pass's property reads stay monomorphic"
  - "The shotgun's SOUND name is 'pickupWeapon' while its SPRITE is 'pickupShotgun' — sound-event and sprite-asset names stay in disjoint namespaces so a future lookup cannot cross-hit"
  - "05-CONTEXT D-07's parenthetical 'armor then absorbs per 4' contradicts D-04's LOCKED divisor of 3 and the plan's own must-have; the D-04 lock wins and ARMOR_ABSORB_DIVISOR is untouched"
  - "The bitmap font is built into Sprites.font, deliberately NOT into Sprites.map or Sprites.names — glyphs are text assets, and the preview atlas walks Sprites.names"

requirements: [PICK-01, PICK-02, PICK-03, PICK-04, PICK-05, LVL-02]

metrics:
  duration: ~50 min
  tasks: 3
  commits: 3
  files-created: 3
  files-modified: 12
  lines-added: 2415
  assertions-added: 94
  completed: 2026-07-25
---

# Phase 5 Plan 04: Pickups, Level Population & the Message Line Summary

Walking over an item now takes it: health, armor, ammo and the shotgun apply their
real effects, vanish from the world, name themselves on screen and fire a sound
event — across a level that finally has something in it, eight enemies and nine
items placed for pacing. **This closes the phase's whole loop.** A populated level
you fight through, enemies that hunt you, weapons that kill them, and pickups that
keep you alive.

Proven by an 84-assertion headless harness in which every zero-result claim has a
sibling that makes the same measurement come out the other way.

## What was built

**`js/pickups.js` — adoption, a second time.** `Entities.build()` already emits one
billboard per item marker, so `Pickups.build()` walks `Entities.list` and records
the objects whose `kind` is `'pickup'`. It never walks `Level.spawns` and never
pushes a second object. `Pickups.list` is a **filtered view**: the same objects,
truncated *in place* so its array identity is stable.

The load-bearing property is that `build()` is **re-runnable**. `Entities.build()`
assigns a *fresh* array, so a view captured before a rebuild holds orphans —
still scanned, but no longer in the list the sprite pass reads, i.e. collectable
while invisible. `Enemies.reset()` calls `Pickups.build()` under a typeof guard
(the hook 05-01 put there for exactly this), so all this file had to get right was
truncate-then-rewalk. **Assertion 1k is the gate, and 1k-vi is its control**:
calling `Entities.build()` *without* rebuilding the view orphans 4 of 4 entries —
the exact failure the hook exists to prevent, demonstrated rather than described.

**The effects are a data table, not a switch.** `Pickups.EFFECTS` maps an
`itemType` to the *name* of the Combat grant, the *key* of the CONFIG constant
holding the amount, the message text and the sound name. Storing the CONFIG **key**
rather than the value means the constant is read at collection time, so the harness
proves the read is live. Adding a fifth item is a data row plus a descriptor.

**Every clamp lives in the grant (T-05-22).** `js/pickups.js` names an amount and
nothing else — it never touches `health`, `armor`, `ammo` or `hasShotgun`. There is
no second path by which a field could exceed its maximum, which is why 1d-ii and
1e-iv (the boundary cases where the grant *would* overshoot) are the whole proof.

**`js/sound.js` — a hook that records.** The CONTEXT defers audio to Phase 6, but
PICK-05 needs the call site to exist now or Phase 6 would be adding the synthesis
*and* the plumbing through every gameplay module at once. So `Sound.play(name)` is
called from the real code path at the real moment and its body is a recorder (a
preallocated ring, a count, the last name). **A hook whose body is `return;` is
unverifiable** — no assertion can tell "the pickup called it" from "the pickup
forgot to". It creates **no AudioContext**: one built at load is a dead suspended
object only a user gesture could revive, and it would take every harness down.

**`js/game.js` — the message ring and the line.** `Game.messages` is a preallocated
ring of `CONFIG.MESSAGE_MAX` records stamped with `Game.time`; `message()` writes a
slot and rotates the head, allocating nothing. `activeMessage()` tests only the
newest slot — and that is a property of the data, not a shortcut: `Game.time` is
monotonic, so if the newest has expired every older one expired earlier.

`Game.renderMessage()` draws it centred in the lower third at an integer scale,
with a one-pixel dark offset copy behind it, fading through
`Raycaster.applyShade` — a **colour ramp, never partial alpha**, which is what
keeps every written pixel opaque. It never writes `zBuffer`. `main.js` pushes it
onto `Raycaster.overlayPasses` **after** the viewmodel, so text lands on top of the
gun inside the same `render()` call and the once-per-frame present is untouched.

**Art.** Three new 32x32 pickups in the shipped mask-then-colorize style, each on
its own stable salt: a green plated armor vest with a lighter rim bevel, an olive
ammo crate with a brass-topped clip band, and a world shotgun laid at a shallow
diagonal so it reads as something *dropped* rather than a floating bar — sharing
the shotgun viewmodel's wood tone, so the item you walk over is visibly the weapon
you end up holding. The medkit becomes `pickupHealth` with `Sprites.map.pickup`
kept as a **strict-identity alias**, the same discipline `enemy` and `weapon` use.

Plus a **5x7 uppercase bitmap font**, authored as row-bit strings. Letter shapes are
not organic, so generating them from primitives would be worse in every way; as
data a mistake is visible at a glance. A set bit is opaque, an unset bit is exactly
0 — so it is deterministic without a PRNG at all, and the binary alpha is the
structural reason the line has no halo. It is a **real, reusable asset**: Phase 6's
HUD text builds on this lookup rather than adding a second font.

## The population (LVL-02), and why nothing else moved

The marker set grew from 3 enemies + 4 items to **8 + 9**, placed for pacing rather
than sprinkled: two in the west start room (one standing over its medkit), two in
the north-east hall covering its tech pillars, one guarding each one-cell corridor,
two in the south chamber with one covering the approach to the exit alcove. Ammo
sits at the *mouth* of each corridor where a player runs dry; health sits *after*
the heaviest engagements; the shotgun is reachable by the short route (start room →
col-4 corridor → south chamber) so it lands early enough to matter, but only after
the start-room and corridor fights. The exit marker was not touched.

**Only floor characters were replaced.** A marker cell parses as plain floor, so
that constraint makes the edit byte-neutral on the wall grid — and that was
*measured*, not assumed:

| Check | Result |
|---|---|
| `Level.cells` before vs after | **0 of 576 cells differ** |
| `Level.LANDMARKS` re-derived | byte-identical (`openCell`, `wallFaceEast`, `corridorCell`) |
| `Level.warnings` | empty |
| `verify-render` | **65 → 66**, and the 65 wall/floor pixel assertions passed **unedited** |
| `verify-motion` | **28 → 28**, unedited |

The two harness deltas are additions (an isolation assertion each), not changes to
any wall-dependent expectation. That is the independent check on T-05-23.

## Verification results

All nine harnesses print their all-pass tokens **in one chained command**, with no
assertion weakened:

| Harness | Assertions | Before | Token |
|---|---|---|---|
| verify-pickups | **84** | (new) | ALL_PICKUP_CONTRACTS_PASS |
| verify-combat | 117 | 117 | ALL_COMBAT_CONTRACTS_PASS |
| verify-weapons | 90 | 90 | ALL_WEAPON_CONTRACTS_PASS |
| verify-sprites | **68** | 67 | ALL_SPRITE_CONTRACTS_PASS |
| verify-render | **66** | 65 | ALL_RENDER_CONTRACTS_PASS |
| verify-input-view | 17 | 17 | ALL_TRACER_CONTRACTS_PASS |
| verify-level | **63** | 56 | ALL_LEVEL_CONTRACTS_PASS |
| verify-motion | 28 | 28 | ALL_MOTION_CONTRACTS_PASS |
| verify-phase02 | 38 | 38 | ALL_PHASE02_CONTRACTS_PASS |

**The radius is real (1b/1c).** The matched pair differs by 0.10 cells and nothing
else: at 0.55 cells (radius 0.50) sixty frames collect nothing — still active,
health unchanged, zero sounds, no message. Move the player 0.10 cells closer and it
is taken **in one frame**, health 50 → 75.

**The clamps bite at the boundary (1d/1e).** Health 50 → exactly 75; health 90,
where +25 *would* overshoot, → exactly 100. Armor 0 → 50; armor 90 → exactly 100.

**The granted armor changes the next hit (1e-ii/1e-iii).** A 12-damage hit after
the pickup removes exactly 8 health and 4 armor through 05-01's locked formula —
paired with the control that the **identical** hit at armor 0 takes the full 12 off
health. Without that control the 4 could be an arithmetic coincidence.

**The shotgun grant is a matched pair (1g).** `selectWeapon(shotgun)` is captured as
**refused** *before* the pickup, and the **identical call** succeeds after it —
then 1g-v fires the weapon and spends one of the shells it came with, so it is
genuinely usable rather than merely selectable.

**One shot, forever (1h).** The control comes first: an *active* pickup 2.0 cells
ahead draws **3406 pixels**, so the measurement is live. It is then collected,
stood on for **120 further frames** with every stat byte-identical, and from the
*same pose* draws **zero** — the frame is byte-identical to the inactive control.

**The events are per-item (1i).** Each of the four collections posts exactly one
message and calls the hook exactly once; the four texts and the four sound names
are **pairwise distinct**, so the hook is per-item rather than one generic event.
1i-iii is its control: a rejected name records nothing, so the counter measures
real events instead of always ticking.

**The exact equality that catches ghosts (2c).** `Entities.list.length` is
**exactly** the spawn-derived billboards plus `CONFIG.PROJ_POOL` — 17 + 24 = 41,
computed from `Level.spawns`, never hardcoded. A `>=` would not catch it: a longer
list means a module appended instead of adopting, which with 8 enemies and 9 items
would be 17 permanent inert ghosts. Paired with the independent ghost detector (no
two active entities sharing a position and a sprite) and 2d (every marker has
exactly one entity on its cell centre).

**The message proofs cannot pass vacuously (3-0).** Every one is age-based, so the
section *opens* by asserting the clock moves in both drivers: 30 direct
`Game.step(dt)` calls elapse exactly 0.500000 s, 30 `raf.step` frames elapse
0.483333 s, and `MESSAGE_TIME` is 150 frames away — reachable, and more than one
frame, so "drawn then absent" is a real transition rather than a boundary the
scenario never approaches.

**No halo, no stray writes, no depth (3b/3c).** The destination box is
**recomputed independently** from the documented formula rather than read out of
`Game.messageBox`: all **3081** written pixels are fully opaque, **0** lie outside
the box, and the **4795** alpha-key-skipped pixels inside it are byte-for-byte the
pre-overlay frame — the gaps between glyphs show the world through, not a dark rim.
The z-buffer is byte-identical across the pass, with the non-vacuity control
confirming that same isolated pass wrote 3081 pixels.

**Drawn, then gone (3d).** Just before expiry (age 2.4667 s of 2.5) the line still
differs from the blank frame in 3081 pixels; one boundary crossing later the frame
is **byte-identical** to the blank one, with the pose and the world unchanged
throughout. The fade is monotonic and floored: shade 256 → 160 → 64.

**Frame accounting.** 90 real loop frames with a collection, its message and both
overlay passes running produce 90 presents — the message line added no second blit.

**Self-containment gate.** `index.html` references exactly 19 local relative
resources (`style.css` + 18 `js/` files), no absolute or remote URL, no
`type="module"`, and grew by **exactly two** script tags. `node --check` is clean on
all 18 `js/` files.

## Deviations from Plan

### 1. [Process] Task 1 was not executed test-first, despite `tdd="true"`

- **What happened:** the plan marks Task 1 `tdd="true"` and says the section 1
  assertions are "written before the production code". They were not: the modules
  went in first and `tools/verify-pickups.cjs` followed in the same task, before
  the task was verified or committed.
- **Why it is recorded rather than glossed:** the assertions all pass, but they
  passed *on first run*, which is exactly the outcome a RED phase exists to make
  meaningful. Nothing here was proven to fail before it was made to pass, so the
  harness's value rests on its paired controls (which do independently demonstrate
  each measurement moving both ways — 1c, 1e-iii, 1g, 1h, 1i-iii, 1j-v, 1k-vi,
  3c-ii, 3d-iv) rather than on a red-to-green transition.
- **Files:** `tools/verify-pickups.cjs`
- **Commit:** 74cd2a3

### 2. [Rule 2 - Missing critical functionality] `Combat.addShells` was not in the plan

- **Found during:** Task 1, step 4
- **Issue:** the plan lists four grants — `heal`, `addArmor`, `addBullets`,
  `grantShotgun`. But `grantShotgun` has to *add shells*, and written as the plan
  specifies it would do that by touching `Combat.ammo.shells` directly. The stated
  invariant — every clamp and every inventory mutation lives in a grant, so no
  caller can reach a field — would then have a hole **in its own implementation**.
- **Fix:** `Combat.addShells(amount)` added beside the others, with the same
  non-finite/non-positive guard; `grantShotgun()` calls it. It also gives Phase 6 a
  shells grant for free if a shell box is ever added.
- **Files:** `js/combat.js`
- **Commit:** 74cd2a3

### 3. [Rule 1 - Bug] A height-derived glyph scale overflows the frame width

- **Found during:** Task 3, sizing the message line
- **Issue:** the plan specifies the scale as "an integer factor derived from
  `Framebuffer.height`". Height alone is not sufficient. Internal width is fixed at
  480 while height is aspect-derived in [200, 480]; at H = 480 a height-only rule
  gives scale 5, and `YOU GOT THE SHOTGUN!` is 119 glyph units — 595 px in a 480 px
  frame. The line would be silently cropped at the right edge on a tall viewport,
  and the "horizontally centred" claim would be false there.
- **Fix:** the height-derived scale is **clamped down** by
  `floor(W / unitsW)`. The clamp is structural rather than a consequence of the
  tuning, so no message length can overflow horizontally. Documented beside
  `CONFIG.MESSAGE_SCALE_DIV` and in `renderMessage`.
- **Files:** `js/config.js`, `js/game.js`
- **Commit:** 86df237

### 4. [Scenario correction] The centring proof measured the ink, not the layout

- **Found during:** Task 3, first run of 3a-iv (**failed**: left margin 61, right
  margin 67)
- **Issue:** the plan asks that the changed pixels "are horizontally centred". Taken
  as the *ink* extent that is not a property the layout has, and the failure was the
  assertion's, not the code's: the message ends in a period, whose ink sits in
  columns 1-2 of its 5-wide cell, so the rightmost ink stops short of the box edge.
  The box itself was centred to within one pixel all along.
- **Fix:** split into the exact claim and a structurally-bounded one. **3a-iv**
  asserts the recomputed **advance box** is centred within 1 px (61 vs 62, the
  integer-division remainder of 123 px of slack). **3a-v** asserts the ink lies
  inside that box and is off-centre by at most **one glyph cell** — 15 px at scale
  3, the real bound on how far a narrow edge glyph can pull ink in. Measured: 6 px.
- **Files:** `tools/verify-pickups.cjs`
- **Commit:** 86df237

### 5. [Rule 2 - Missing critical functionality] The overlay isolation was unasserted

- **Found during:** Task 3, step 3 ("confirm that still holds with two entries")
- **Issue:** `verify-render` and `verify-sprites` truncate `Raycaster.overlayPasses`
  at boot, but as a bare statement with no assertion. Confirming it by *reading the
  source* would leave the isolation unguarded the moment a third overlay pass is
  added — and this plan had just added the second.
- **Fix:** both harnesses now record the installed count, truncate, and **assert**
  both that boot installed ≥ 2 (so the truncation is non-vacuous and cannot pass by
  doing nothing) and that the array is empty afterwards. Strengthening, not
  weakening: no existing assertion changed.
- **Files:** `tools/verify-render.cjs`, `tools/verify-sprites.cjs`
- **Commit:** 86df237

### 6. [Strengthened, not re-pointed] verify-sprites 1c

The plan asks to "re-point section 1's pickup descriptor assertion at the new
sprite names". Re-pointed *and* strengthened: it now keys off `kind === 'pickup'`
rather than off a sprite-name literal, so it can never again pass vacuously if the
names change, and it demands each pickup name the sprite **its own `itemType`
maps to** — a shotgun drawn as a medkit now fails. The expectation table is written
out independently in the harness rather than read from `Entities.SPRITE_FOR`, which
would have made it tautological.

### 7. [Resolved contradiction in the CONTEXT] The armor divisor stays 3

05-CONTEXT D-07 says an armor pickup grants armor that "then absorbs per 4", while
D-04 **locks** `absorbed = min(armor, floor(dmg/3))` and the plan's own must-have
1e requires a 12-damage hit to cost 8 health and 4 armor — which is divisor 3. The
D-04 lock wins; `CONFIG.ARMOR_ABSORB_DIVISOR` was not touched. Assertion 1e-ii
pins the resulting 8/4 split exactly, with 1e-iii as its no-armor control.

### 8. [Implementation choice] Deactivate before granting

The plan's order is "applies the effect …, sets active false". Shipped the other
way round: `Pickups.collect` sets `active = false` **first**. Deactivation is then
unconditional on anything the grant does or fails to do, so there is no ordering in
which an effect lands while the item stays on the floor. Strictly stronger for
T-05-21, and behaviourally identical in every non-pathological case.

## Delegated to the orchestrator (real browser, `file://` and a static server)

Automated verification cannot see the screen, so the visual/feel pass is delegated:

- Walk the populated level and confirm it now plays as a **combat level**: a fight
  in the start room, guards on both corridors, and enemies waiting in the hall and
  the south chamber — nothing shooting you at spawn.
- Walk over a medkit at reduced health and confirm the item **disappears**, the
  message line appears centred low on screen **over the weapon**, and it **fades
  out** on its own after a couple of seconds.
- Confirm the four pickups are **visually distinguishable at a few cells' distance**
  — white medkit, green vest, olive/brass crate, wood-and-steel shotgun on the floor
  — and that the shotgun item reads as lying on the ground rather than hovering.
- Pick up armor, then take a fireball, and confirm the hit **lands softer** than the
  same hit did before.
- Fire until nearly dry, pick up a clip, and confirm firing resumes immediately.
- Pick up the shotgun, press `2`, and confirm the drawn weapon changes and a blast
  is visibly more lethal point-blank.
- Walk back over every collected item and confirm **nothing happens** — no message,
  no effect, nothing drawn.
- Confirm the message text is **legible** at the shipped internal resolution, and
  check it at a very tall/short window (the scale is height-derived and
  width-clamped, so it should stay on screen and stay centred).
- Confirm **zero console and network errors** from both origins.
- **rAF-throttle caveat:** on a non-composited or headless open the loop does not
  tick. Drive frames manually with `Game.step(0.016)`, then `Game.view.render()`,
  then `Framebuffer.present()`.

A headless proxy for that path was run and is green, driving real frames exactly
that way — 435 frames, 435 presents, 435 `putImageData`:

| Event | Evidence |
|---|---|
| boot | 8 enemies, 9 pickups, 41 entities, `totalKills` 8 |
| health pickup | active false, health 60 → 85, `"PICKED UP A MEDIKIT."`, sound `pickupHealth` |
| pistol kill | alive false, state `corpse`, sprite `enemyCorpse`, bullets 50 → 47, kills 1/8 |
| armor pickup | active false, armor 50, `"PICKED UP ARMOR."` |
| armor absorbs | a 12-damage hit costs **8** health with armor against **12** with none |
| ammo pickup | bullets 2 → 22, `"PICKED UP A CLIP."` |
| shotgun pickup | refused before, `hasShotgun` true, 8 shells, weapon now `"shotgun"`, `"YOU GOT THE SHOTGUN!"` |
| no double collect | 20 frames standing on each collected item: collections 4 → 4, health 65 → 65, bullets 22 → 22 |
| message fades | shade 256 → 256 → 256 → 172 → **gone**, drawn on 338 frames |
| level cleared | kills **8/8**, `Entities.list` still **41** |
| sprites drawn | all 9 enemy frames, the fireball, and all four typed pickups |

## Known Stubs

**One, intentional and named in the plan's own artifact list.**

`Sound.play(name)` (`js/sound.js`) **records the event and returns — it makes no
sound.** This is the 05-CONTEXT phase boundary, not an oversight: the domain block
puts synthesized audio in **Phase 6 (AUD-01/02/03)**, which replaces the body with
a Web Audio graph and adds the remaining call sites (weapon fire, the dry click,
enemy pain and death, player damage). This plan wires exactly **one** call site —
the pickup collection PICK-05 requires. The hook deliberately creates no
`AudioContext` (asserted by 0d), because one built at load is a dead suspended
object only a user gesture could revive.

It is not silently inert: the recording is real, tested-by-construction code
(1i, 1i-ii, 1i-iii), which is what makes the boundary provable rather than assumed.
Recorded in `.planning/WINDOWS.md` as entry 4.

Two items are live-but-awaiting-callers, documented in their own file headers:

- `Game.messageBox` / `Game.messageShade` / `Game.messageAge` — real,
  tested-by-construction (3b, 3d-v) records Phase 6's HUD reads when it needs to
  know where the line ended up.
- `Sprites.font` — fully built and exercised by the message line; Phase 6's HUD
  text readouts are its second consumer.

The delegated browser play-test is recorded in `.planning/WINDOWS.md` as entry 5.

## Threat Flags

None. No network endpoint, auth path, file access or trust-boundary schema was
introduced. Every disposition in the plan's `<threat_model>` is covered by a named
assertion:

| Threat | Covered by |
|---|---|
| T-05-21 (repeat collection) | **1h-ii/1h-iii** (120 further frames), **1h-iv**, with 1h as the control |
| T-05-22 (clamps bypassed) | **1d-ii**, **1e-iv** at the boundary values; every clamp inside a Combat grant |
| T-05-23 (marker edit changing wall geometry) | the **0-of-576-cell** parsed-grid diff, `8m`, and verify-render + verify-motion unedited |
| T-05-24 (unreachable/buried spawns) | verify-level `2`, `8m`, `10b` (flood fill), `12d` |
| T-05-25 (glyph rasteriser out of range) | **3b-iii** (0 writes outside the recomputed box), the per-glyph index clamps, unknown character → blank |
| T-05-26 (unbounded message queue) | **3e-v** (20 extra posts leave the ring at MESSAGE_MAX), 0e |
| T-05-27 (per-frame allocation) | **1j-ii** (lists unchanged after every collection + 300 frames), squared-distance scan |
| T-05-SC (package installs) | no package manager anywhere; self-containment gate green |

## Self-Check: PASSED

- `js/pickups.js`, `js/sound.js`, `tools/verify-pickups.cjs` — FOUND
- All 12 modified files — FOUND
- Commits 74cd2a3, 46a884e, 86df237 — FOUND in git log
- All nine all-pass tokens print in one chained command (84/117/90/68/66/17/63/28/38)
- `node --check` clean on all 18 `js/` files
- No file deletions in any of the three commits; working tree clean under `Doom/`
