---
phase: 05-enemy-ai-weapons-pickups
verified: 2026-07-25T16:20:00Z
status: passed
score: 32/32 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
deferred:
  - truth: "PICK-05's 'plays a sound' — real audible synthesis (Phase 5 ships a wired, recording Sound.play hook, not Web Audio)"
    addressed_in: "Phase 6"
    evidence: "Phase 6 SC2: 'Distinct Web-Audio-synthesized sound effects play for pistol fire, shotgun fire, enemy attack, enemy death, pickups, and player damage — with no audio files' (AUD-01/02/03)"
  - truth: "The kill count is DISPLAYED to the player (Phase 5 produces Game.kills / Game.totalKills; nothing draws them)"
    addressed_in: "Phase 6"
    evidence: "Phase 6 SC1: 'The HUD shows health, armor, ammo, current weapon, kill count...' (HUD-01/HUD-02)"
  - truth: "The remaining Sound.play call sites (weapon fire, dry click, enemy pain, enemy death, player damage) are wired"
    addressed_in: "Phase 6"
    evidence: "Phase 6 SC2 enumerates exactly those six sounds; 05-CONTEXT domain block scopes Phase 5 to the pickup call site only"
  - truth: "The exit marker drives a victory state and health-zero drives a death screen"
    addressed_in: "Phase 6"
    evidence: "Phase 6 SC4 + LVL-03/04/05; 05-CONTEXT deferred block lists title/victory/death screens as Phase 6"
---

# Phase 5: Enemy AI, Weapons & Pickups — Verification Report

**Phase Goal:** The core combat loop works — enemies hunt and attack the player, weapons deal hitscan damage, and pickups are collectible across a populated level.
**Verified:** 2026-07-25
**Status:** passed
**Re-verification:** No — initial verification

## Verification Method

Nothing below rests on SUMMARY.md prose. Every row was established by one or more of:

1. **Direct source reading** of all 9 shipped modules touched by this phase (`enemies.js`, `combat.js`, `weapons.js`, `pickups.js`, `sound.js`, `entities.js`, `game.js`, `level.js`, `config.js`) plus `main.js`, `input.js`, `raycaster.js`, `player.js`, `index.html`.
2. **All 9 headless harnesses re-run by the verifier**, each confirmed to print its all-pass token (571 assertions total, listed under Probe Execution).
3. **Independent adversarial probes written by the verifier** (not the phase's own harnesses) — ~60 checks across 6 scripts, including an exhaustive armor-formula sweep, a 1016-run wall-collision sweep, an independently chosen wall-stop geometry with an open/close control, pool-exhaustion, NaN/Infinity delta guards, a projectile-tunnelling sweep, and framebuffer byte-diffs for corpse/projectile rendering.
4. **The orchestrator's live browser drive** across all four waves (treated as evidence for browser-observable criteria only).

**Note on phase mode:** ROADMAP.md marks this phase `Mode: mvp`, but its goal is an outcome statement, not the `As a … I want to … so that ….` User Story form the MVP verification path expects. This mismatch is project-wide (phases 1–4 carry the same shape and were verified the same way), so verification proceeded goal-backward against the four ROADMAP Success Criteria rather than halting. Flagged as INFO, not a Phase 5 defect.

## Goal Achievement

### Observable Truths

Merged from ROADMAP Success Criteria (SC1–SC4, the contract) and all four plans' `must_haves.truths` (05-01 T1–T9, 05-02 T10–T16, 05-03 T17–T21, 05-04 T22–T28). No plan reduced the roadmap scope.

| #    | Truth | Status | Evidence |
| ---- | ----- | ------ | -------- |
| SC1 | Enemies idle until LOS, then chase + attack on cooldown respecting wall collision; take damage, show hit reaction, die with a multi-frame death animation leaving a corpse | ✓ VERIFIED | Covered by T1–T5, T17–T21 below; state machine read in `enemies.js:378-492`; live browser: IDLE→CHASE at 6 cells, closed 6.00→2.00 |
| SC2 | Pistol single-shot; switch to spread-firing shotgun; hitscan damages nearest enemy along the aim line, blocked by walls, consumes ammo, blocked when empty; bobbing viewmodel + muzzle flash | ✓ VERIFIED | Covered by T10–T16; verifier probe C1/C2/C3, D1–D5, S5–S9; live browser: pistol kill 40→0, ammo 50→42, empty gate held |
| SC3 | Health/armor/ammo/shotgun pickups collect and apply effects | ✓ VERIFIED | Covered by T22–T25; verifier probe G1–G8 (all four types + both caps + double-collect) |
| SC4 | Level populated with enemies + pickups at designed positions; kill count tracks defeated/total | ✓ VERIFIED | Covered by T26–T28; verifier grid diff (0/576 cells changed), probe A1–A8, F4–F7 |
| T1 | An enemy with no clear LOS stays idle, does not move, spawns no projectile (ENEM-01) | ✓ VERIFIED | `enemies.js:404-406` — IDLE branch has no movement path; verify-combat 1b/1c/2d–2g with sight-restored controls; verifier probe N1 (0 fireballs in 15 s at close range through a wall) + N2 control (10 fireballs with that one cell opened) |
| T2 | An enemy that gains LOS within `ENEMY_SIGHT_RANGE` chases and, in open space, strictly reduces distance each frame until stop range | ✓ VERIFIED | `enemies.js:406-426`; verify-combat 1d asserts strict per-frame monotonicity, reaches stop range, never crosses it; verifier probe: 381/383 LOS-acquiring starts reach stop range |
| T3 | A chasing enemy in a one-cell corridor reaches attack range within a bounded number of frames rather than jamming on the mouth | ✓ VERIFIED | verify-combat 2v/2w — both corridors (col 4, col 18), on-centre AND off-centre, against a CONFIG-derived frame budget, never entering a solid cell |
| T4 | A chasing enemy never occupies a solid cell; a wall on one axis blocks that axis while the other resolves | ✓ VERIFIED | Chase routes through the shared `Player.slideMove` (`enemies.js:332/344/358-359`, `player.js:182-190`); **verifier sweep: 1016 chase runs from every floor cell against 4 player positions — 0 solid-cell occupancies**; second sweep 383 LOS runs — 0 violations |
| T5 | An enemy with LOS inside attack range spawns exactly one fireball per `ENEMY_ATTACK_COOLDOWN`, none while LOS is blocked | ✓ VERIFIED | Cooldown taken on attack ENTRY (`enemies.js:414-420`) and sight RE-TESTED at release (`:477-484`); verify-combat 2i + control; verifier probe M1: 10 fireballs in 16 s vs 16/1.6 = 10 expected |
| T6 | A fireball reaching the player reduces `Combat.health`, armor absorbing exactly `min(armor, floor(dmg/3))` first | ✓ VERIFIED | `combat.js:106-112`, `CONFIG.ARMOR_ABSORB_DIVISOR: 3` (D-04 lock); **verifier exhaustive sweep: 900 (armor × damage) cases, 0 mismatches**; live browser 100→28 |
| T7 | A fireball entering a solid cell deactivates, returns to the pool, and draws zero pixels | ✓ VERIFIED | `enemies.js:547-553` (advance-then-test order); verify-combat 2j–2l with the wall-opened control; **verifier probe R4: framebuffer byte-identical to the empty scene after despawn (0 px differ)**; probe E7: 0 tunnels at DT_MAX across every 1-cell wall geometry |
| T8 | A player at zero health stops moving, turning and firing while the world keeps simulating | ✓ VERIFIED | `combat.js:113-116` latches `dead`; `game.js:168` substitutes the frozen `ZERO_INTENT`; verifier probe H1/H2 — 120 frames of a fully-held intent moves nothing and spends no ammo |
| T9 | Exactly ONE billboard per enemy spawn — the AI adopts the entity the sprite builder emitted; no inert ghost | ✓ VERIFIED | `enemies.js:197-231` adopts by `kind`, never pushes; **verifier probe A3: `Entities.list.length === 41` exact (8 enemies + 9 pickups + 24 pool)**, A4 no duplicate object refs, A5 no shared enemy positions, A6 identity membership |
| T10 | Firing a loaded pistol damages the nearest ALIVE enemy along the aim line and decrements bullets by one | ✓ VERIFIED | `weapons.js:251-292` (dot/cross resolution, `alive!==true` filter, nearest wins); verify-weapons 1a/1b; verifier probe D2 |
| T11 | A shot whose aim line crosses a wall damages nothing; the identical shot with the wall removed connects | ✓ VERIFIED | DDA wall stop `weapons.js:218-245`, gate `:274`; verify-weapons 1d/1e; **verifier probe with independently chosen geometry (16.5,3.5)→(18.5,3.5): blocked 0 dmg, cell opened → exactly 15 dmg, cell re-closed → 0 dmg again** |
| T12 | Firing with zero ammo does not fire, damages nothing, and does not advance the cooldown | ✓ VERIFIED | Ammo gate precedes every mutation (`weapons.js:302-310`); verify-weapons 1g; verifier probe D1 (cooldown byte-identical) + D2 control |
| T13 | A dead player cannot fire: a held fire intent spends no ammo and damages no enemy | ✓ VERIFIED | Same `ZERO_INTENT` seam as T8; verify-weapons 1k + live-player control; verifier probe H2 |
| T14 | Pistol casts exactly one ray; shotgun casts `SHOTGUN_PELLETS` rays with differing angles inside `SHOTGUN_SPREAD` | ✓ VERIFIED | One shared fire path (`weapons.js:316-332`); verify-weapons 2e; **verifier probe D5: 7 distinct angles, all within ±0.08 rad of the aim** |
| T15 | Weapon-select keys switch pistol/shotgun; the shotgun cannot be selected until `Combat.hasShotgun` | ✓ VERIFIED | Grant gate in `combat.js:154-160` (inventory owns it); `input.js` SLOT_KEYS Digit1/Digit2 drained on read; verify-weapons 2a/2b; verifier probe D3/D4 |
| T16 | The viewmodel draws bottom-centre every frame, bobs with speed-scaled amplitude, kicks on fire, flashes for `MUZZLE_FLASH_TIME` | ✓ VERIFIED | `weapons.js:455-504`; verify-weapons 3f/3g (838 flash px present, 0 after expiry; 8133 px shift on weapon switch); **verifier probe S5: excursion standing 0 < walking 4 < running 8 px**, S7–S9 timers arm and expire |
| T17 | A non-lethal hit reduces health and, on a chance roll, staggers into a pain frame that interrupts the current action before resuming chase | ✓ VERIFIED | `enemies.js:603-612` (roll reads CONFIG live, zeroes windup, leaves cooldown) + PAIN branch `:428-443`; verify-combat 3a–3e with the forced-0 / forced-1 control pair |
| T18 | A lethal hit starts a multi-frame death animation playing each frame once in order, ending in a static corpse that stays rendered | ✓ VERIFIED | `enemies.js:445-472`; **verifier probe S10: observed sprite sequence exactly `enemyDeath1→enemyDeath2→enemyDeath3→enemyCorpse`**; probe R1: corpse contributes 712 drawn px (frame differs when deactivated) |
| T19 | A corpse is never targeted by hitscan, never moves, never attacks, and can never be killed twice | ✓ VERIFIED | `alive!==true` target filter (`weapons.js:265`) + re-entry guard (`enemies.js:575`) + corpse skip (`:387`); verify-combat 4e (300 point-blank frames: byte-identical position, 0 projectiles) and 4f with a LIVE enemy control in the SAME spot; verifier probe F6: terminal across 10 000 updates |
| T20 | `Game.kills` increments exactly once per death regardless of overkill; `Game.totalKills` equals the spawned enemy count | ✓ VERIFIED | Tally inside the one branch that clears `alive` (`enemies.js:599`), guarded by the early return at `:575`; **verifier probe F4/F5: 50 deaths + 5 overkill hits each → kills exactly 50**; A8: `totalKills === 8 === enemy marker count` |
| T21 | Pain never triggers on the killing blow — a lethal hit goes straight to the death animation | ✓ VERIFIED | The lethal branch returns before the roll (`enemies.js:579-601`); **verifier probe F1: with `ENEMY_PAIN_CHANCE` forced to 1, 0 of 50 lethal hits entered PAIN; all 50 entered DEATH** |
| T22 | Walking within `COLLECT_RADIUS` collects: effect applies, entity deactivates and stops rendering, message enqueued, sound hook called | ✓ VERIFIED | `pickups.js:186-253` (deactivate-first ordering); verifier probe G1 (health 40→65, `active===false`, `Sound.last==='pickupHealth'`, 1 message posted); live browser confirmed removal from render |
| T23 | A health pickup restores `HEALTH_PICKUP` capped at `PLAYER_MAX_HEALTH` | ✓ VERIFIED | Clamp lives in `Combat.heal` (`combat.js:132-137`); verifier probe G1 (+25) and G2 (90 → capped 100) |
| T24 | An armor pickup raises armor toward `PLAYER_MAX_ARMOR` and that armor then absorbs through the 05-01 formula | ✓ VERIFIED | `combat.js:162-167` + the single `damagePlayer` formula; verifier probe G3 (50), G4 (80 → capped 100), E1 exhaustive absorption sweep |
| T25 | An ammo pickup adds `AMMO_PICKUP` bullets; a shotgun pickup sets `hasShotgun` and adds `SHOTGUN_PICKUP_SHELLS` so the shotgun becomes selectable | ✓ VERIFIED | `combat.js:186-213`; verifier probe G5 (50→70), G6 (`hasShotgun`, 8 shells), D4 (now selectable) |
| T26 | A collected pickup can never be collected twice and never re-renders | ✓ VERIFIED | Strict `active!==true` scan skip (`pickups.js:246`) + strict `active===false` render skip (`entities.js:232`); verifier probe G7 (second scan takes 0) and G8 |
| T27 | The level carries enemy and pickup markers at designed, reachable positions; `Game.totalKills` equals the enemy marker count | ✓ VERIFIED | **Verifier-run flood fill from the player start: 0 of 18 markers unreachable**; nearest enemy 5.10 cells / nearest item 5.83 cells from spawn (no spawn-camping); 8 enemies + 9 items (4 health, 3 ammo, 1 shotgun, 1 armor); probe A8 |
| T28 | The newest queued message is drawn into the framebuffer and fades after `MESSAGE_TIME` | ✓ VERIFIED | `game.js:392-439` + `messageShade`; verify-pickups 3e-i..v (drawn box tracks the newest message; ring stays at `MESSAGE_MAX` 4 after 20 posts); live browser: overlayPasses = 2, message draws over the weapon |

**Score: 32/32 truths verified (0 present, behavior-unverified)**

### Deferred Items

Not yet true, but explicitly owned by a later milestone phase — informational, not gaps.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | PICK-05's audible sound (Phase 5 ships a wired recording hook, not Web Audio) | Phase 6 | Phase 6 SC2 (AUD-01/02/03); 05-CONTEXT domain block scopes audio to Phase 6 |
| 2 | Kill count DISPLAY (numbers produced, nothing draws them) | Phase 6 | Phase 6 SC1 (HUD-01/HUD-02) |
| 3 | The other five `Sound.play` call sites (fire, dry click, enemy pain, enemy death, player damage) | Phase 6 | Phase 6 SC2 enumerates exactly those sounds |
| 4 | Exit-triggered victory and health-zero death screens | Phase 6 | Phase 6 SC4; LVL-03/04/05 |

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `js/enemies.js` | Entity model, idle/chase/attack/pain/death/corpse machine, projectile pool | ✓ VERIFIED | 616 lines; every locked D-02 state has a real branch; adopted by `game.js`; 0 debt markers |
| `js/combat.js` | Player vitals/ammo/weapon + `damagePlayer` armor formula | ✓ VERIFIED | 215 lines; single damage entry point; every clamp lives in a grant method |
| `js/weapons.js` | Weapon table, hitscan with DDA wall-stop, ammo gating, viewmodel state + draw | ✓ VERIFIED | 538 lines; one fire path for both weapons; preallocated `Float64Array(7)` angle scratch |
| `js/pickups.js` | Typed pickup entities, proximity collection, per-type effects | ✓ VERIFIED | 255 lines; data-table effects, no switch; deactivate-before-grant ordering |
| `js/sound.js` | `Sound.play(name)` event hook Phase 6 replaces | ✓ VERIFIED | 123 lines; recorder with a preallocated 8-slot ring; **creates no AudioContext** (verifier probe I1) |
| `js/game.js` additions | `kills`/`totalKills`, preallocated message ring, `Game.message`, `Game.renderMessage`, `Game.step` dispatch | ✓ VERIFIED | Ring allocated once at module load (`MESSAGE_MAX` 4); `Game.time` moved into `step` so direct-step ages are real |
| `js/level.js` SOURCE population | 8 enemy + 9 item markers on FLOOR cells only | ✓ VERIFIED | **Verifier re-derived both grids from git and diffed: 0 of 576 cells differ; LANDMARKS byte-identical; 0 markers on previously-solid cells** |
| Phase 5 sprites in `js/sprites.js` | idle/walk1/walk2/attack/pain/death1-3/corpse, fireball, 2 viewmodels, muzzle flash, 4 pickups, bitmap font | ✓ VERIFIED | Verifier probe S1: all 17 keys present; S3: pain/death/corpse pairwise distinct; S4: byte-identical across a rebuild (seeded) |
| `tools/verify-combat.cjs` | Falsifiable AI/projectile/damage/death harness | ✓ VERIFIED | 117/117, `ALL_COMBAT_CONTRACTS_PASS` |
| `tools/verify-weapons.cjs` | Falsifiable weapon harness | ✓ VERIFIED | 90/90, `ALL_WEAPON_CONTRACTS_PASS` |
| `tools/verify-pickups.cjs` | Falsifiable pickup + population harness | ✓ VERIFIED | 84/84, `ALL_PICKUP_CONTRACTS_PASS` |
| `Raycaster.overlayPasses` | Ordered post-sprite overlay seam | ✓ VERIFIED | `raycaster.js:307-308` — index-iterated, no closure, last statement of `render()` |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `Game.step` | `Enemies.update` / `updateProjectiles` | direct dispatch after `Player.update` | ✓ WIRED | `game.js:175-178`; probe M1/N1 prove the AI only runs because of it |
| `Enemies.build` | `Entities.build` output | adoption by `kind`, never a push | ✓ WIRED | `enemies.js:206-212`; probe A3 exact-equality 41 = 8+9+24 |
| `Enemies` chase | `Player.slideMove` | shared per-axis leading-edge slide | ✓ WIRED | `enemies.js:332/344/358-359` → `player.js:182-190`; the same routine `Player.moveBy` uses (`player.js:207`) |
| `Enemies.update` skip | corpse STATE (never `alive`) | `e.state === Enemies.CORPSE` | ✓ WIRED | `enemies.js:387`; this is exactly why probe S10's death sequence is reachable |
| `Entities.render` skip | `active === false` (strict) | render-pass guard | ✓ WIRED | `entities.js:232`; probe R4: 0 px after despawn, and Phase-4 literals without `active` still render |
| `Game.time` | accumulated in `Game.step` | contract 1b | ✓ WIRED | `game.js:157`; verify-combat 2y + control proves ages are non-vacuous under a direct step |
| `Combat.dead` | `Game.ZERO_INTENT` substitution | `game.js:168` | ✓ WIRED | probe H2 |
| `Enemies.reset` | `Pickups.build()` | typeof-guarded hook | ✓ WIRED | `enemies.js:275-277`; probe A9–A11: array identity survives, 0 orphans |
| `index.html` | classic-script order | entities → combat → enemies → weapons → sound → pickups → game → main | ✓ WIRED | probe I3 (indices 10,11,12,13,14,15,16,17); I4: no `type="module"` |
| `Input.readIntent` | `Weapons.update` | intent-only `fire` / `weaponSlot` | ✓ WIRED | `input.js:72` shape matches `Game.ZERO_INTENT` field-for-field; `game.js:185` passes the once-sampled record |
| Weapons hitscan | `Enemies.hurt` | single damage entry point | ✓ WIRED | `weapons.js:290`; no direct `enemy.health` write anywhere in `weapons.js` |
| Weapons wall-stop | own DDA over `Level.isSolid` | mirrors `lineOfSight` idiom; `raycaster.render()` untouched | ✓ WIRED | `weapons.js:218-245`; verify-render still 66/66 |
| `Raycaster.overlayPasses` | viewmodel then message | pushed in order by `main.js:92-93` | ✓ WIRED | verify-weapons 3h + verify-pickups 3f: present count == frame count with both passes live |
| Pickup collection | `Combat` grant methods | `pickups.js:191-198` by name | ✓ WIRED | no direct field writes in `pickups.js`; probes G2/G4 show the caps are unreachable from outside |
| `Game.renderMessage` | `Raycaster.overlayPasses` (after the viewmodel) | `main.js:93` | ✓ WIRED | live browser: message drew over the weapon; overlayPasses = 2 |
| `Level.SOURCE` markers | parse to FLOOR | `MARKER_CHARS` → `cells[idx] = 0` | ✓ WIRED | `level.js:144-152, 229-231`; verifier grid diff 0/576 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `Entities.render` | `e.sprite` per frame | set by `Enemies.update` state branches | Yes — probe S10 observed 4 distinct frames | ✓ FLOWING |
| `Enemies.list` | adopted entities | `Entities.build()` ← `Level.spawns` ← `Level.SOURCE` | Yes — 8 real markers, all reachable | ✓ FLOWING |
| `Pickups.list` | filtered view | same `Entities.list` objects (identity, not copies) | Yes — probe A7/A11 | ✓ FLOWING |
| `Weapons.renderViewmodel` | `Sprites.map[w.sprite]` | procedurally built at boot | Yes — probe S1; 8133 px change on switch | ✓ FLOWING |
| `Game.renderMessage` | `Game.activeMessage()` | ring stamped with `Game.time` at collection | Yes — verify-pickups 3e; probe G1 posts 1 | ✓ FLOWING |
| `Game.kills` / `totalKills` | counters | `Enemies.hurt` lethal branch / `Enemies.build` | Yes — probe F5/F7 | ✓ FLOWING |
| `Combat.health` / `armor` / `ammo` | vitals | `damagePlayer` + grant methods | Yes — 900-case sweep, all four pickup types | ✓ FLOWING |

### Behavioral Spot-Checks (verifier-authored, independent of the phase harnesses)

| Behavior | Check | Result | Status |
| -------- | ----- | ------ | ------ |
| Enemies cannot walk through walls | 1016 chase runs (every floor cell × 4 player positions, 400 frames each) | 0 solid-cell occupancies | ✓ PASS |
| Chase actually closes | 383 LOS-acquiring starts, 600 frames | 381 reach stop range (99.5%), 0 wall violations | ✓ PASS |
| Hitscan cannot shoot through walls, discriminating | Independently chosen geometry; cell closed → open → closed | 0 dmg / 15 dmg / 0 dmg | ✓ PASS |
| Armor formula (D-04 divisor 3) | Exhaustive 900 (armor × damage) cases | 0 mismatches | ✓ PASS |
| Pain never on the killing blow | `ENEMY_PAIN_CHANCE` forced to 1, 50 lethal hits | 0 PAIN, 50 DEATH | ✓ PASS |
| Corpse terminal | 10 000 updates on a corpse | state unchanged | ✓ PASS |
| Kill tally vs overkill | 50 deaths + 5 overkill hits each | kills == 50 exactly | ✓ PASS |
| Enemy adoption exact equality | `Entities.list.length` | 41 == 8+9+24, 0 duplicate refs | ✓ PASS |
| `Pickups.build` re-runnable / identity-stable | reset + double build | array identity preserved, length stable at 9, 0 orphans | ✓ PASS |
| Level population changed FLOOR only | git-derived parsed-grid diff | 0 of 576 cells differ; LANDMARKS identical | ✓ PASS |
| Marker reachability | flood fill from player start | 0 of 18 markers unreachable | ✓ PASS |
| Attack cadence | 16 s of sustained attacking | 10 fireballs vs 10 expected (`16/1.6`) | ✓ PASS |
| No attack without LOS + control | 15 s blind / 15 s with the cell opened | 0 fireballs / 10 fireballs | ✓ PASS |
| Projectile despawn draws nothing | framebuffer byte-diff vs empty scene | 0 px differ | ✓ PASS |
| Corpse still renders | framebuffer byte-diff with `active` toggled | 712 px differ | ✓ PASS |
| Death animation frame order | observed sprite sequence | `Death1→Death2→Death3→Corpse`, once | ✓ PASS |
| Viewmodel bob scales with speed | excursion at 0 / walk / run | 0 / 4 / 8 px | ✓ PASS |
| Pool exhaustion | 34 spawn attempts against a 24-pool | 24 spawns then 10 nulls, pool never grew | ✓ PASS |
| Bad-delta guards | NaN / −1 / ±Infinity into all four update fns | state byte-identical | ✓ PASS |
| Projectile tunnelling at `DT_MAX` | every 1-cell wall geometry in the map | 0 tunnels | ✓ PASS |
| No per-frame allocation | list/pool length over 4000 steps; heap over 20 000 steps | 41/41, 24/24; **26.3 KiB total** | ✓ PASS |
| Single `putImageData` per frame | 200 real rAF frames with combat + input | 200 presents / 200 frames | ✓ PASS |
| Phase 6 boundary | comment-stripped scan of all `js/` | 0 Web Audio constructs, 0 HUD/title/victory/death code | ✓ PASS |

### Probe Execution

All nine harnesses were run by the verifier from the repo, in its own process. Not one result was taken from SUMMARY.md.

| Probe | Command | Result | Status |
| ----- | ------- | ------ | ------ |
| `tools/verify-phase02.cjs` | `node tools/verify-phase02.cjs` | 38/38 · `ALL_PHASE02_CONTRACTS_PASS` | PASS |
| `tools/verify-input-view.cjs` | `node tools/verify-input-view.cjs` | 17/17 · `ALL_TRACER_CONTRACTS_PASS` | PASS |
| `tools/verify-motion.cjs` | `node tools/verify-motion.cjs` | 28/28 · `ALL_MOTION_CONTRACTS_PASS` | PASS |
| `tools/verify-level.cjs` | `node tools/verify-level.cjs` | 63/63 · `ALL_LEVEL_CONTRACTS_PASS` | PASS |
| `tools/verify-render.cjs` | `node tools/verify-render.cjs` | 66/66 · `ALL_RENDER_CONTRACTS_PASS` | PASS |
| `tools/verify-sprites.cjs` | `node tools/verify-sprites.cjs` | 68/68 · `ALL_SPRITE_CONTRACTS_PASS` | PASS |
| `tools/verify-pickups.cjs` | `node tools/verify-pickups.cjs` | 84/84 · `ALL_PICKUP_CONTRACTS_PASS` | PASS |
| `tools/verify-weapons.cjs` | `node tools/verify-weapons.cjs` | 90/90 · `ALL_WEAPON_CONTRACTS_PASS` | PASS |
| `tools/verify-combat.cjs` | `node tools/verify-combat.cjs` | 117/117 · `ALL_COMBAT_CONTRACTS_PASS` | PASS |

**571/571 assertions.** Crucially, the four pre-Phase-5 harnesses (level 63, render 66, motion 28, input-view 17) still pass unchanged — that is the independent evidence that the LVL-02 population perturbed no wall-dependent contract.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| ENEM-01 | 05-01 | AI state machine idle → chase (on LOS) → attack, on cooldown | ✓ SATISFIED | T1, T2, T5 |
| ENEM-02 | 05-01 | Move toward the player on LOS, respecting wall collision | ✓ SATISFIED | T3, T4 (1016-run sweep, 0 violations) |
| ENEM-03 | 05-01 | Attack reduces player health (ranged projectile) | ✓ SATISFIED | T5, T6, T7 |
| ENEM-04 | 05-03 | Take damage, hit reaction, multi-frame death animation, corpse | ✓ SATISFIED | T17, T18, T19, T21 |
| ENEM-05 | 05-03 | Kill count tracks defeated out of total | ✓ SATISFIED | T20 (display deferred to HUD-02) |
| WEAP-01 | 05-02 | Pistol + shotgun, switchable by key | ✓ SATISFIED | T15 (Digit1/Digit2, ownership-gated) |
| WEAP-02 | 05-02 | Hitscan damages nearest enemy along the aim line unless walled | ✓ SATISFIED | T10, T11 (independent open/close control) |
| WEAP-03 | 05-02 | Shotgun multi-pellet spread; pistol single accurate shot | ✓ SATISFIED | T14 |
| WEAP-04 | 05-02 | Viewmodel with bob, recoil, muzzle flash | ✓ SATISFIED | T16 |
| WEAP-05 | 05-02 | Firing consumes ammo, blocked when empty | ✓ SATISFIED | T12, T13 |
| PICK-01 | 05-04 | Health pickups restore up to maximum | ✓ SATISFIED | T23 |
| PICK-02 | 05-04 | Armor absorbs a portion of incoming damage | ✓ SATISFIED | T24 (exhaustive sweep) |
| PICK-03 | 05-04 | Ammo pickups replenish ammunition | ✓ SATISFIED | T25 |
| PICK-04 | 05-04 | Shotgun pickup grants the weapon and shells | ✓ SATISFIED | T25 |
| PICK-05 | 05-04 | Walk-over collects, shows a message, plays a sound | ✓ SATISFIED (audio deferred) | T22, T28; hook wired and proven called — audible synthesis is Phase 6 AUD-01/02/03 per the CONTEXT boundary |
| LVL-02 | 05-04 | Level populated with enemy spawns and pickups at designed positions | ✓ SATISFIED | T27 (0/576 grid cells changed, 0 unreachable markers) |

**Orphaned requirements:** none. REQUIREMENTS.md maps exactly these 16 IDs to Phase 5, and all 16 are claimed by a plan.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | `TODO` / `FIXME` / `XXX` / `TBD` / `HACK` / `PLACEHOLDER` | — | **Zero across all of `js/` and `tools/`** (verifier scan, probe J1) |
| `js/sound.js` | 19, 24, 26 | The word "AudioContext" in prose | ℹ️ INFO | Comment text only — a comment-stripped scan finds 0 executable Web Audio constructs. This is the documented Phase 6 seam, not a stub of an unfinished feature |
| `js/enemies.js` | 402 | `Level.lineOfSight` computed for every non-corpse enemy every frame, including PAIN and DEATH which never read it | ℹ️ INFO | 8 enemies × one grid DDA per frame — negligible, and the corpse skip already removes the growing majority as a fight progresses. Not a correctness issue |

No 🛑 blockers and no ⚠️ warnings. Every "empty" return in the phase modules is a guarded refusal on an invalid input (verified as a no-op by probes E2–E6), not an unimplemented path.

### Disconfirmation Pass

Per the Confirmation Bias Counter, run after the main pass:

1. **A partially-met requirement.** PICK-05 — "plays a sound". The call site is wired and provably called, but nothing is audible; the synthesis is Phase 6. This is the explicit CONTEXT boundary and Phase 6 SC2 owns it, so it is recorded as *deferred*, not as a gap. Same shape for ENEM-05's readout.
2. **A test that passes without testing the stated behavior.** `verify-weapons` 1f (the `HITSCAN_RANGE` gate) cannot place an out-of-range enemy — the shipped range (24) exceeds the longest clear line in a 24×24 map (~21) — so it varies the CONSTANT around fixed geometry instead. The summary documents this openly, and the substitute proof is arguably stronger (it shows the constant is read live at shot time). Accepted, noted.
3. **An error path with no coverage.** `Enemies.spawnProjectile` returning `null` on a fully-committed pool is not asserted by any phase harness (2r proves the pool never *grows*, not what happens at the ceiling). The verifier covered it directly: 24 spawns then 10 clean `null`s with no growth and no throw. No defect — a coverage seam, now closed by this report's evidence.

### Executor Self-Report Assessment

**05-04 Task 1 was not executed test-first despite `tdd="true"`** — self-declared in `05-04-SUMMARY.md` §Deviations.

**Judgment: the resulting coverage is sound.** The value a RED phase provides is proof that an assertion can fail. Here that proof comes instead from the harness's paired controls, and those controls are real: every zero-result pickup assertion has a matched non-zero measurement on the same code path (1c, 1e-iii, 1g, 1h, 1i-iii, 1j-v, 1k-vi). The verifier did not take that on trust — the pickup contract was re-derived from scratch in an independent probe (G1–G8: all four item types, both caps, deactivation, double-collect, sound hook, message post) with no reference to `verify-pickups.cjs`, and every result matched. Recording the deviation rather than glossing it is the right call and does not change the verdict.

### Human Verification Required

None. Every browser-observable criterion was independently confirmed by the orchestrator's live four-wave drive (zero console errors), and every logic criterion is covered by control-paired headless assertions plus the verifier's own probes. No truth was left present-but-behaviorally-unverified.

### Notes for Phase 6

1. **`Sound.play` has exactly ONE call site** (pickup collection). Phase 6 must add fire, dry-click (`Weapons.lastDryFire` / `dryFires` are already recorded), enemy pain, enemy death, and player damage (`Combat.lastDamageAt` / `totalDamageTaken` are already stamped). Keep the recorder body when replacing it — every Phase 5 assertion depends on it.
2. **`Game.renderMessage` is already in `Raycaster.overlayPasses`.** HUD-05 must either take it over or remove it from the array — leaving both would double-draw the message line.
3. **The overlay array is ordered and load-bearing:** `[Weapons.renderViewmodel, Game.renderMessage]`. Anything the HUD appends lands on top of both, inside the same `Raycaster.render()` call, preserving one `putImageData` per frame. The `#hud` display-resolution canvas exists and is currently unused — it is the natural home for crisp HUD text.
4. **Ready-to-read state:** `Combat.{health,armor,ammo,weapon,hasShotgun,dead,lastDamageAt,totalDamageTaken}`, `Game.{kills,totalKills,time,messages,activeMessage(),messageAge()}`, `Weapons.viewmodelBox`, `Game.messageBox`, and the `exit` marker still in `Level.spawns` (`Entities.SPRITE_FOR` deliberately has no `exit` descriptor yet).
5. **Enemy AI has no global pathfinding — by design (D-02).** A verifier sweep found 2 of 383 LOS-acquiring start positions (a pillar-adjacent pocket in the NE hall) where the enemy ends hovering at ~3.9 cells with LOS lost, still chasing, unable to close. No wall penetration, no crash, no stall in the loop. If Phase 6 tuning makes this visible, it is a steering local minimum, not a regression.
6. **Headless caveat unchanged:** rAF is throttled on a non-composited pane, so live verification must drive frames manually (`Game.step(dt)` + `Game.view.render()` + `Framebuffer.present()`).

### Gaps Summary

None. All 32 merged must-haves verified, all 16 requirements satisfied, all 24 key links wired, all 9 harnesses green (571/571), and every phase-boundary deferral is explicitly owned by Phase 6 in ROADMAP.md. The one process deviation the executor self-reported (05-04 Task 1 not test-first) was independently compensated by verifier-authored probes and does not affect the verdict.

---

_Verified: 2026-07-25T16:20:00Z_
_Verifier: Claude (gsd-verifier)_
