---
phase: 06-hud-audio-game-state-machine
verified: 2026-07-25T17:57:29Z
status: passed
score: 17/17 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
closes_deferred_from_phase_05:
  - truth: "PICK-05's 'plays a sound' — real audible synthesis"
    closed_by: "AUD-01/02/03 — gesture-scoped AudioContext, 7 distinct recipes, verify-audio 114/114"
  - truth: "The kill count is DISPLAYED to the player"
    closed_by: "HUD-02 — verify-hud 1e-i ('0 / 8' === Game.kills / Game.totalKills) + 1e-ii control"
  - truth: "The remaining Sound.play call sites (weapon fire, dry click, enemy pain, enemy death, player damage) are wired"
    closed_by: "06-03 commit 2634d31 — all six call sites wired; verify-audio section 2 asserts each by name"
  - truth: "The exit marker drives a victory state and health-zero drives a death screen"
    closed_by: "LVL-04/LVL-05 — Game.checkEndConditions; verify-state 1i/2a with paired controls 1j/2b"
---

# Phase 6: HUD, Audio & Game-State Machine — Verification Report

**Phase Goal:** The game becomes a complete, self-contained arcade loop with a HUD, synthesized sound, and a title/victory/death flow driven by reaching the exit or dying.
**Verified:** 2026-07-25
**Status:** passed
**Re-verification:** No — initial verification
**Note on MVP mode:** ROADMAP marks every phase (1–6) `Mode: mvp`, but no phase goal is written in `As a … I want to … so that …` form. This is a project-wide convention established at roadmap creation and followed by all five prior verifications. Verified with the standard goal-backward methodology for consistency; recorded as informational, not a gap.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | HUD shows live health, armor, ammo | VERIFIED | verify-hud 1a-i/ii/iii read back drawn text === `Combat.health`/`armor`/`ammo`; 1b-i control proves all three CHANGE with their fields |
| 2 | HUD shows current weapon + kill count | VERIFIED | 1d-i "PISTOL"/"SHOTGUN"; 1d-ii control proves it is not a constant. 1e-i tally "0 / 8"; 1e-ii control — one real kill moves it by exactly one, total untouched |
| 3 | Ammo readout follows the weapon, not a fixed field | VERIFIED | 1c-i/ii — pistol shows `bullets` (33), shotgun moves the SAME readout to `shells` (7); expectation derived from `Weapons.TABLE`, not hardcoded |
| 4 | Crosshair at screen centre | VERIFIED | 1f-i/ii — drawn extent contains the midpoint and is symmetric within 1px at 1280x720 AND 900x540; 1f-iii proves it is recomputed live, not positioned at boot |
| 5 | Fading pickup/event messages, drawn exactly once | VERIFIED | verify-state 4a (`Game.renderMessage` in `Raycaster.overlayPasses` EXACTLY once, counted not indexOf), 4b control (3034 px differ when active), 4c gate (ZERO hud fillText offenders). verify-hud 3e-iii: `js/hud.js` exposes no message renderer at all |
| 6 | Minimap shows layout, player facing, exit, live entities | VERIFIED | verify-hud section 2 — offscreen 187x187 grid, ONE `drawImage` per frame, rebuilt only on resize/restart (2b-iv, 2i-i/ii) |
| 7 | Red damage flash on taking damage, decaying to nothing | VERIFIED | 1g-ii alpha 0.3967 ≤ `DAMAGE_FLASH_ALPHA`; 1g-iii world stays visible; 1h-i decays; 1h-ii not drawn at all past the window; 1i control — never-damaged sentinel draws zero flashes |
| 8 | Six distinct Web-Audio-synthesized SFX, no audio files | VERIFIED | 7 recipes (6 required + `dryClick`) with distinct wave/filter/frequency envelopes. verify-audio 1k-i and 3b: comment-stripped scan of all 19 `js/` files finds ZERO of 14 network/media tokens |
| 9 | All six SFX call sites wired to real gameplay events | VERIFIED | `weapons.js:402` (pistol/shotgun via `w.sound`), `enemies.js:538` (attack), `enemies.js:627` (death), `pickups.js:210`, `combat.js:140` (player hurt), `weapons.js:629` (dry click). verify-audio section 2 asserts each by name |
| 10 | AUD-03 is STRUCTURAL — no AudioContext before the gesture | VERIFIED | Context lives in module-scope `audioCtx` (sound.js:139); constructor resolved at CALL time inside `unlock()` (resolveContextCtor, sound.js:203). No `ctx` field. Asserted independently by verify-state 1g-i/ii, verify-pickups 0d, verify-audio 0b |
| 11 | A SINGLE click starts play + pointer lock + audio resume | VERIFIED | `Input.onClick` → `Input.gestureHook` (= `Game.handleGesture`, main.js:81) → `Sound.unlock()` unconditionally, THEN `setState`, THEN `requestPointerLock`. verify-audio 1b-iii: one click, both effects; 1c-i: context born suspended, resume called exactly once |
| 12 | Title screen shows the controls | VERIFIED | verify-state 1o-ii — a title frame records 8 fillText lines naming movement and fire controls |
| 13 | The state gate freezes the sim WITHOUT going black | VERIFIED | Gate is at `game.js:198` in `Game.frame`, NOT `Game.step`; `Game.render()` at :199 is unconditional. verify-state 1b-i/ii frozen, **1d putCount advanced by exactly 60**, 1c-i paired control moves 3.000 cells in playing. Same shape for death at 2c-i..iv |
| 14 | Reaching the exit triggers victory with stats | VERIFIED | `checkEndConditions` stamps result then `setState(VICTORY)`. verify-state 1i + 1j control (300 steps at `EXIT_RADIUS + 0.05` stay PLAYING — a real threshold, and `Game.result` untouched) |
| 15 | Health zero triggers death with restart | VERIFIED | Death branch tested FIRST (precedence proven by 2e-i/ii). verify-state 2a/2b control (non-lethal 5 damage stays PLAYING — tracks the dead LATCH, not the fact of damage) |
| 16 | Restart yields a genuinely clean slate | VERIFIED | Ordered rebuild (game.js:674-697): time=0 → Level.build → Player.spawn → Combat.reset → Weapons.reset → resetStats → **Enemies.reset** (which chains Entities.build + Pickups.build) → Sound/HUD.reset → setState LAST. 1m-iv control: `Entities.build()` ALONE orphans 9 `Pickups.list` entries — the chain is what prevents it |
| 17 | LVL-03: exit is reachable and visibly marked, with no exit billboard | VERIFIED | verify-level 10c flood-fill from player start reaches the exit; **10d control** seals the alcove mouth → same helper reports UNREACHABLE, unsealing restores. verify-state 3b/3c: 34643 green px vs 0 at a plain stone wall. 3d-i/ii/iii: no exit sprite, `Entities.list` is 41 === 17 + 24 exactly |

**Score:** 17/17 truths verified (0 present, behavior-unverified)

### Harness Execution — all 12 run in this verifier's own process

| Harness | Assertions | Result |
|---------|-----------|--------|
| verify-phase02 | 38/38 | ALL_PHASE02_CONTRACTS_PASS |
| verify-input-view | 17/17 | ALL_TRACER_CONTRACTS_PASS |
| verify-motion | 28/28 | ALL_MOTION_CONTRACTS_PASS |
| verify-render | 66/66 | ALL_RENDER_CONTRACTS_PASS |
| verify-sprites | 68/68 | ALL_SPRITE_CONTRACTS_PASS |
| verify-combat | 117/117 | ALL_COMBAT_CONTRACTS_PASS |
| verify-weapons | 90/90 | ALL_WEAPON_CONTRACTS_PASS |
| verify-pickups | 84/84 | ALL_PICKUP_CONTRACTS_PASS |
| verify-level | 65/65 | ALL_LEVEL_CONTRACTS_PASS |
| verify-state | 121/121 | ALL_STATE_CONTRACTS_PASS |
| verify-hud | 87/87 | ALL_HUD_CONTRACTS_PASS |
| verify-audio | 114/114 | ALL_AUDIO_CONTRACTS_PASS |
| **Total** | **895/895** | Matches the expected count exactly |

### Falsifiability — 7 independent mutation tests

SUMMARY claims of "falsifiable proofs" are not evidence. I mutated a scratch copy of the delivered code and re-ran the suite. Every mutation was caught:

| # | Mutation | Caught by | Result |
|---|----------|-----------|--------|
| 1 | Remove the state gate (`Game.step` unconditional) | verify-state 1b-i/ii, 2c-i/ii/iii | 116/121 — 5 FAILs |
| 2 | Add a second message renderer on the hud canvas | verify-state 4c AND verify-hud 3d-ii | 120/121, 86/87 — the double-draw gate discriminates in both |
| 3 | Capture `AudioContext` at module load + expose `Sound.ctx` | verify-state 1g-i/ii, verify-pickups 0d, verify-audio 0b | Caught in **three independent harnesses** |
| 4 | Unwire the `ENEMY_DEATH` SFX call site | verify-audio 2e-ii | 113/114 |
| 5 | Break the dry-fire edge (fire every frame) | verify-audio 2c-i/ii AND verify-hud 3b-i/ii | Confirms sound + message hang on the SAME single `lastDryFire` edge |
| 6 | Swap death/victory precedence | verify-state 2e-ii | 119/121 |
| 7 | Rebuild the minimap every frame | verify-hud 2b-iv, 2i-i/ii | Confirms the ONE-drawImage composite is real |

Working tree confirmed unmodified after mutation testing (`git status --porcelain` clean).

### Harness Integrity — no prior assertion weakened

Full diff of `tools/` from the last Phase 5 commit (`86df237`) to HEAD, inspected line by line:

| Harness | Change | Verdict |
|---------|--------|---------|
| verify-phase02, verify-motion, verify-pickups, verify-render, verify-sprites, verify-weapons | +10 each: comment block + `h.sandbox.Game.setState('playing')` | Pure additive scenario setup |
| verify-combat | +21: same setup line in its world-rebuild helper (2 hunks) | Pure additive scenario setup |
| verify-input-view | +28/-8: setup line, plus script-order assertion 18 → 19 scripts (adds `hud`) | Assertion **strengthened** — still exact-order equality, now over one more element |
| verify-level | +56: new 10c/10d | Net new (63 → 65) |
| verify-state, verify-hud, verify-audio | New files | Net new |

**Zero assertions deleted. Zero labels, expectations or thresholds relaxed.**

Correction to the executor's reported claim: 06-01 made setup edits to **seven** prior harnesses, not one. The claim as relayed understated the blast radius. All seven are byte-identical additive setup, so the conclusion (no assertion weakened) holds — but the claim itself was inaccurate and is corrected here.

Confirmed accurate: 06-02 and 06-03 touched **no** prior harness (only `verify-hud.cjs` and `verify-audio.cjs` respectively). The 8 deletions inside `verify-audio.cjs` at commit `2634d31` are 06-03 refining its own new assertions — `bs.Sound.count` → a `counted` snapshot captured BEFORE the 60 follow-on frames, initialized to `-1` so it fails closed if the try block throws. A precision fix, not a relaxation.

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|------------|-------------|--------|----------|
| HUD-01 | Health, armor, ammo | SATISFIED | verify-hud 1a-i/ii/iii + 1b-i control |
| HUD-02 | Current weapon + kill count | SATISFIED | 1d-i/ii, 1e-i/ii |
| HUD-03 | Centre crosshair | SATISFIED | 1f-i/ii/iii, 1j-iii (absent on title) |
| HUD-04 | Fading pickup/event messages | SATISFIED | 3a–3e; single-renderer gate in two harnesses |
| HUD-05 | Minimap: layout, player, entities | SATISFIED | verify-hud section 2 |
| HUD-06 | Red damage flash | SATISFIED | 1g/1h/1i with sentinel control |
| AUD-01 | Runtime synthesis, no audio files | SATISFIED | 1k-i, 3b — 14-token scan over all 19 files |
| AUD-02 | Six distinct SFX | SATISFIED | 7 distinct recipes; all call sites asserted by name |
| AUD-03 | Gesture-scoped AudioContext | SATISFIED | Structural; 1a-iii/v — a full pre-gesture gameplay burst constructs ZERO contexts and ZERO nodes |
| LVL-03 | Reachable, visibly-marked exit | SATISFIED | verify-level 10c + 10d control; verify-state 3b/3c |
| LVL-04 | Victory with stats | SATISFIED | verify-state 1i + 1j threshold control |
| LVL-05 | Death with restart | SATISFIED | verify-state 2a/2b + restart section |
| LVL-06 | Title screen, single gesture | SATISFIED | 1o-ii controls; verify-audio 1b-iii |

No orphaned requirements: all 13 declared in ROADMAP appear in plans and are verified. Project-wide, all 47 requirements are now Complete.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| — | none | — | Scan of `js/*.js`, `index.html`, `style.css` for `TBD`/`FIXME`/`XXX`/`HACK`/`PLACEHOLDER`/`TODO`/"not yet implemented"/"coming soon" returned **zero** matches |

### Live Browser Evidence (orchestrator)

Independently corroborates the static analysis: boots to `title` with the sim frozen (30 frames, no movement) and 19 script tags; no AudioContext before the gesture; single gesture → `playing` with the HUD rendering; pistol kill → `corpse`, kills 1/8, ammo 50→37, 17 SFX fired; exit → `victory` with stats, sim frozen but still rendering; health 0 → `dead`; restart from BOTH end states → clean slate (health 100, kills 0/8, 8 enemies, 9 pickups, 41 entities, 50 bullets, `hasShotgun` false). Zero console errors, zero external network requests.

## Milestone Judgement

**This is a complete, shippable browser Doom clone.** The Core Value — "open it in a browser and immediately play a fun, recognizably-Doom FPS: move, fight, shoot, manage health/ammo, and win or die" — is met end to end:

- **Move** — textured raycast world, WASD + strafe + run + pointer-lock mouse-look, slide collision (Phases 2–3, 111 assertions).
- **Fight** — 8 enemies that wake, hunt, and shoot fireballs; pain stagger; multi-frame death into a terminal corpse (Phase 5).
- **Shoot** — hitscan pistol and spread shotgun with viewmodel bob, recoil, muzzle flash, ammo gating (Phase 5).
- **Manage health/ammo** — armor-mitigated damage, 9 pickups across four effect types, a live HUD reading all of it.
- **Win or die** — reachable marked exit → victory with stats; health zero → death; both restart to a genuinely clean world.

All constraints hold: 19 classic scripts (no ES modules), zero dependencies, no build step, zero external assets or network calls, and a single `putImageData` per frame preserved in **every** state across all 895 assertions.

**Genuinely outstanding (non-blocking, not phase success criteria):**

1. **Audio timbre is unlistened.** The harnesses prove the node graphs, distinct recipes, finite/positive AudioParams, and one shared noise buffer — and the live run fired 17 SFX without error. Nobody has confirmed the pistol *sounds* like a pistol. SC2's verifiable content ("distinct", "synthesized", "no audio files") is fully established; subjective timbre is not part of the criterion, so this is a polish recommendation rather than an unmet must-have. A 60-second listen before shipping is advised.
2. **`file://` load is verified structurally, not executed.** Assertions prove relative-only paths, no module tags, and no network tokens — the exact properties that break `file://`. An actual double-click open was not performed in this verification.
3. **ROADMAP bookkeeping.** The Progress table still shows all six phases "In Progress" with no completion dates, and every phase carries `Mode: mvp` without User Story goals. Cosmetic; worth cleaning at milestone completion.

None of these block the phase or the milestone.

### Gaps Summary

No gaps. All 17 observable truths verified, all 13 requirements satisfied, all 895 assertions passing under this verifier's own execution, all 7 adversarial mutations caught, no prior assertion weakened, and all four items Phase 5 deferred to Phase 6 are closed. Phase 6 is the final phase, so nothing is deferred forward.

---

_Verified: 2026-07-25T17:57:29Z_
_Verifier: Claude (gsd-verifier)_
