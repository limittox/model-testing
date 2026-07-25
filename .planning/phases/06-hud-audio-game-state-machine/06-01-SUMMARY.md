---
phase: 06-hud-audio-game-state-machine
plan: 01
subsystem: ui
tags: [game-state-machine, canvas-2d, pointer-lock, web-audio-seam, raycaster, overlay-hud, headless-harness]

# Dependency graph
requires:
  - phase: 01-foundation-render-loop
    provides: the #hud transparent display-resolution overlay canvas, Framebuffer.hudCtx/hudCanvas, and the once-per-frame putImageData contract
  - phase: 02-input-motion-loop
    provides: Game.frame/step/render, the clamped delta-time, the resync frame, and Input as an intent-only source with the canvas click handler
  - phase: 03-raycaster
    provides: Raycaster.render + overlayPasses, the per-column z-buffer, and the exit wall material in Textures.map
  - phase: 04-sprites-entities
    provides: Entities.build/SPRITE_FOR (deliberately no exit descriptor) and the spawn-derived billboard list
  - phase: 05-enemy-ai-weapons-pickups
    provides: Combat (health/armor/ammo/dead latch), Weapons.reset, Enemies.reset/build, Pickups.build, the Sound.play hook, Game.time/kills/totalKills and the message ring
provides:
  - "Game.STATES / state / stateEnteredAt / setState / checkEndConditions / handleGesture / restart / result — the four-state arcade machine"
  - "The step gate in Game.frame (render + present stay unconditional), with Game.step left un-gated as the raw simulation primitive"
  - "Level.exit — the exit spawn record derived from Level.spawns after the forced-border filter"
  - "Input.gestureHook / Input.gestureError — the LVL-06 single-gesture seam, invoked before requestLock and try-wrapped"
  - "Sound.unlock() / Sound.unlockCalls — the AUD-03 gesture-scoped audio seam (06-03 fills the body)"
  - "js/hud.js — the #hud overlay renderer with the title, victory and death screens; HUD.render/reset/METRICS"
  - "CONFIG.EXIT_RADIUS and the SCREEN_* overlay tunables"
  - "tools/verify-state.cjs — 121 control-paired assertions, ALL_STATE_CONTRACTS_PASS"
affects: [06-02-hud-readouts-minimap-damage-flash, 06-03-web-audio-synthesis]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "State gate in the LOOP, never in the simulation primitive — Game.frame gates the step so harnesses can still drive Game.step directly"
    - "Single user gesture carrying three effects (state change + audio unlock + pointer lock) in one user-activation task, hook first and try-wrapped"
    - "Overlay rendering on the second canvas through the 2D API, never putImageData — the single-blit-per-frame contract is structurally untouched"
    - "Frozen result record stamped at the transition, so end screens read numbers that cannot move"
    - "String caches keyed on their inputs (canvas height, whole-second clock) so the Canvas 2D text API costs no per-frame garbage"

key-files:
  created:
    - "Doom/Claude Opus 4.8/GSD/js/hud.js"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-state.cjs"
  modified:
    - "Doom/Claude Opus 4.8/GSD/js/game.js"
    - "Doom/Claude Opus 4.8/GSD/js/level.js"
    - "Doom/Claude Opus 4.8/GSD/js/input.js"
    - "Doom/Claude Opus 4.8/GSD/js/sound.js"
    - "Doom/Claude Opus 4.8/GSD/js/config.js"
    - "Doom/Claude Opus 4.8/GSD/js/main.js"
    - "Doom/Claude Opus 4.8/GSD/index.html"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-level.cjs"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-combat.cjs"

key-decisions:
  - "The step gate lives in Game.frame, not Game.step — Game.step stays the un-gated simulation primitive that every Phase 1-5 harness drives directly, so the freeze is a property of the loop (the only driver in the browser) and ~500 existing assertions stay meaningful"
  - "Sound.ctx was NOT added in this plan (the plan's action text asked for a null placeholder). verify-pickups assertion 0d proves 'no AudioContext' by asserting no context field exists on Sound at all; adding the placeholder would have failed that Phase 5 assertion, and the only permitted fix for a moved Phase 1-5 assertion is correcting production code. Deferred to 06-03, which genuinely constructs a context and therefore genuinely owns restating 0d"
  - "D-02 resolved by KEEPING Game.renderMessage in Raycaster.overlayPasses as the sole message renderer and adding no HUD-side renderer — the option that leaves all 571 Phase 1-5 assertions intact. verify-state section 4 arms the double-draw gate for 06-02"
  - "The death branch is tested BEFORE the exit branch in checkEndConditions: a player killed as they step into the alcove lost, and the two conditions genuinely overlap because the (14,20) enemy guards that approach"
  - "The three screen prompts are deliberately distinct strings rather than variations on one stem ('CLICK TO BEGIN' / 'CLICK TO PLAY AGAIN' / 'CLICK TO TRY AGAIN'), so the screen-switching assertion cannot pass on a substring"
  - "Game.setState drains the input source on every real transition, so a mouse delta accumulated while the sim was frozen cannot release as a spin on the first playing frame"

patterns-established:
  - "Derived-not-hardcoded world facts: Level.exit is a reference into Level.spawns, and every harness expectation is derived from CONFIG or the spawn table so a map edit moves the expectation with the map"
  - "Overlay observability: harnesses wrap the cached #hud 2D context's drawing methods to record calls, arguments, fillStyle and globalAlpha — the overlay becomes assertable without a real canvas"
  - "Freeze proofs are always control-paired: the same frames, the same held intent and the same driver in the playing state must MOVE"

requirements-completed: [LVL-03, LVL-04, LVL-05, LVL-06]

coverage:
  - id: D1
    description: "A title screen listing the controls is shown on load, with the simulation frozen behind it while the world keeps rendering and presenting once per frame"
    requirement: "LVL-06"
    verification:
      - kind: integration
        ref: "node \"Doom/Claude Opus 4.8/GSD/tools/verify-state.cjs\" # 1a, 1b-i/ii, 1c-i/ii, 1d, 1o-i..iv"
        status: pass
    human_judgment: false
  - id: D2
    description: "ONE click on the canvas starts play, requests pointer lock and invokes the audio unlock seam — all from a single gesture, with a throwing hook unable to block the lock"
    requirement: "LVL-06"
    verification:
      - kind: integration
        ref: "node \"Doom/Claude Opus 4.8/GSD/tools/verify-state.cjs\" # 1e, 1f-i..iv, 1g-i/ii"
        status: pass
    human_judgment: false
  - id: D3
    description: "Walking within CONFIG.EXIT_RADIUS of the derived exit marker ends the run in victory with kills-out-of-total and elapsed time frozen at the transition"
    requirement: "LVL-04"
    verification:
      - kind: integration
        ref: "node \"Doom/Claude Opus 4.8/GSD/tools/verify-state.cjs\" # 1h, 1i-i..iv, 1j-i/ii, 1k-i/ii, 1p-i..vi"
        status: pass
    human_judgment: false
  - id: D4
    description: "The Combat.dead latch ends the run on a drawn death screen with a restart affordance, taking precedence over the exit"
    requirement: "LVL-05"
    verification:
      - kind: integration
        ref: "node \"Doom/Claude Opus 4.8/GSD/tools/verify-state.cjs\" # 2a, 2b, 2c-i..iv, 2d, 2e-i/ii, 2i-i..iv"
        status: pass
    human_judgment: false
  - id: D5
    description: "A click on either end screen rebuilds the world to a clean initial state — every stat, entity, pickup and pose at boot values, with no orphaned entity references and no growth across repeated restarts"
    requirement: "LVL-04"
    verification:
      - kind: integration
        ref: "node \"Doom/Claude Opus 4.8/GSD/tools/verify-state.cjs\" # 1l, 1m-i..v, 2f, 2g-V, 2g-D, 2h-i..iii"
        status: pass
    human_judgment: false
  - id: D6
    description: "The exit is a reachable floor cell derived from the spawn table and is visibly marked by the emissive exit wall material, producing no billboard"
    requirement: "LVL-03"
    verification:
      - kind: integration
        ref: "node \"Doom/Claude Opus 4.8/GSD/tools/verify-level.cjs\" # 10c, 10d"
        status: pass
      - kind: integration
        ref: "node \"Doom/Claude Opus 4.8/GSD/tools/verify-state.cjs\" # 3a-i..iii, 3b, 3c, 3d-i..iii"
        status: pass
    human_judgment: false
  - id: D7
    description: "The message line has exactly one renderer (Game.renderMessage in Raycaster.overlayPasses) and the double-draw gate is armed for 06-02"
    verification:
      - kind: integration
        ref: "node \"Doom/Claude Opus 4.8/GSD/tools/verify-state.cjs\" # 4a, 4b, 4c"
        status: pass
    human_judgment: false
  - id: D8
    description: "The arcade loop plays correctly in a real browser from file:// and from a static server: a readable title screen over a still world, a click that captures the cursor and starts the frame advancing, the green alcove yielding a victory screen, a fresh run on the next click, and a deliberate death yielding the death screen — with zero console errors and zero network requests"
    verification: []
    human_judgment: true
    rationale: "Legibility, aesthetic readability of the screens at real window sizes, real pointer-lock capture, real autoplay-policy behaviour and the zero-network/zero-error claims cannot be established from the Node vm sandbox — the DOM, the compositor and the network stack are all stubbed. Delegated to the orchestrator."

# Metrics
duration: 62min
completed: 2026-07-25
status: complete
---

# Phase 6 Plan 01: Game-State Machine + Title/Victory/Death/Restart Summary

**The arcade loop closes: a four-state machine gated in `Game.frame` (never in `Game.step`), a derived exit trigger, one click that starts play + captures the mouse + unlocks audio, and a new `js/hud.js` overlay drawing the title, victory and death screens — proven by 121 new control-paired assertions with all 571 Phase 1-5 assertions intact.**

## Performance

- **Duration:** ~62 min
- **Tasks:** 3 of 3
- **Files created:** 2
- **Files modified:** 16
- **Assertions:** 121 new (verify-state) + 2 new (verify-level 10c/10d); 694 total across ten harnesses

## Accomplishments

- **The core value is now true end to end.** Open the page → a title screen with the controls over a rendered but frozen world → one click starts play, captures the mouse and unlocks audio → fight to the green alcove → a victory screen with kills-out-of-total and elapsed time → click → a clean fresh run. Die instead and you get the death screen and the same restart.
- **The state gate went where it belongs.** `Game.frame` gates the step on `Game.state === 'playing'`; render and present stay unconditional so the frozen world sits *behind* the overlay rather than going black (proven: `putCount` advanced by exactly 60 across 60 frozen frames, and exactly 120 across 120 dead frames). `Game.step` stays un-gated, so the ~500 Phase 1-5 assertions that drive it directly are still measuring a simulation that actually runs.
- **The single gesture works and is fault-isolated.** `Input.onClick` invokes `Input.gestureHook` *before* `Input.requestLock()`, inside one try/catch: a refused lock cannot stop the game starting, and a throwing hook cannot cost the player their mouse. One click, three effects, asserted as three deltas of exactly 1.
- **Restart is provably clean.** `Game.restart()` sequences `Level.build → Player.spawn → Combat.reset → Weapons.reset → Game.resetStats → Enemies.reset` (which re-runs `Entities.build` and *then* `Pickups.build`). Every `Pickups.list` and `Enemies.list` entry is strictly identical by reference to an entry of the *current* `Entities.list`, with `Entities.build()` alone orphaning 9 pickups as the paired control. Three consecutive restarts leave every list length identical and the ghost detector empty.
- **LVL-03 is measured, not inspected.** Facing the exit wall from 1.5 cells, 34,643 of 129,600 framebuffer pixels (26.7%) are strongly green; the same measurement 1.5 cells from a plain stone wall yields **0**. Reachability is asserted by name in `verify-level` with a sealed-alcove control that proves the helper *can* report failure.
- **The D-02 double-draw hazard is closed and gated.** `Game.renderMessage` is counted (not `indexOf`-ed) exactly once in `Raycaster.overlayPasses`, its framebuffer draw is proven by difference, and a recorded frame with an active message makes zero `#hud` text calls carrying that text. 06-02 must extend that section, not replace it.

## Task Commits

1. **Task 1 (tracer): end-to-end title → victory → play again** — `64ac66c` (feat)
2. **Task 2: death branch, four-state render matrix, exhaustive restart reset** — `b801742` (feat)
3. **Task 3: exit reachability + visible marking, the single message renderer, full regression** — `b6dd24b` (test)

## Files Created/Modified

**Created**
- `Doom/Claude Opus 4.8/GSD/js/hud.js` — the `#hud` overlay renderer. Clears and repaints the whole overlay every frame (because `Framebuffer.resize()` clears the backing store), draws the title/victory/death screens through one preallocated `METRICS` record and two input-keyed string caches, and never calls `putImageData`/`getImageData`. Draws nothing in the playing state — that is 06-02's branch.
- `Doom/Claude Opus 4.8/GSD/tools/verify-state.cjs` — 121 assertions across four sections: the state machine (1a-1p), the death branch and reset (2a-2j), exit marking (3a-3d), the single message renderer (4a-4c). Wraps the cached `#hud` 2D context's drawing methods to make the overlay assertable.

**Modified**
- `js/game.js` — `STATES`/`state`/`stateEnteredAt`/`result` on the literal; `IS_STATE` derived from `STATES`; `setState`, `stampResult`, `checkEndConditions` (dead before exit), `handleGesture`, `restart`; the step gate in `Game.frame`; `HUD.render()` dispatched from `Game.render` after `present()`.
- `js/level.js` — `Level.exit`, derived from the kept spawn list after the forced-border filter, as a *reference* into `Level.spawns`.
- `js/input.js` — `gestureHook`/`gestureError`; `onClick` invokes the hook first, try-wrapped, then requests lock.
- `js/sound.js` — `unlockCalls`, `unlock()`, and `reset()` zeroing the counter.
- `js/config.js` — `EXIT_RADIUS` (bracketed from both sides: below one cell, above the 0.27-cell running per-frame budget) and the `SCREEN_*` overlay tunables as fractions of the hud canvas height.
- `js/main.js` — wires `Input.gestureHook = Game.handleGesture`, calls `HUD.reset()`, leaves the boot state at title.
- `index.html` — one classic script tag (`js/hud.js`, between pickups and game) and its numbered paragraph in the load-order contract (19 scripts).
- `tools/verify-input-view.cjs` — the 19-name expected script list and its label.
- `tools/verify-{phase02,motion,render,sprites,combat,weapons,pickups,input-view}.cjs` — one `Game.setState('playing')` scenario-setup line after `h.fireLoad()`.
- `tools/verify-combat.cjs` — additionally, `Game.setState('playing')` at the top of its `scenario()` world-rebuild helper (see Deviations).
- `tools/verify-level.cjs` — new assertions 10c/10d (exit reachability by name + sealed-alcove control).

## Verification Results

**All ten harnesses print their all-pass tokens.** Assertion counts, against the Phase 5 baseline:

| Harness | Baseline | Now | Δ |
|---|---|---|---|
| verify-phase02 | 38 | 38 | — |
| verify-input-view | 17 | 17 | — |
| verify-motion | 28 | 28 | — |
| verify-render | 66 | 66 | — |
| verify-sprites | 68 | 68 | — |
| verify-combat | 117 | 117 | — |
| verify-weapons | 90 | 90 | — |
| verify-pickups | 84 | 84 | — |
| verify-level | 63 | **65** | +2 (Task 3, deliberate) |
| verify-state | — | **121** | new |
| **Total** | **571** | **694** | |

Eight of the nine Phase 1-5 harnesses are byte-identical in count. `verify-level` grew by exactly the two assertions Task 3 explicitly instructed be added (10c names the exit as reachable; 10d is its sealed-map falsifiability control). **No assertion was weakened, relabelled or removed anywhere.**

`node --check` is clean on all 19 shipped JS files. `index.html` grew by exactly one classic `<script src>` tag.

## Decisions Made

1. **The gate goes in `Game.frame`, not `Game.step`** — and the asymmetry is commented at the site. Gating `Game.step` would have collapsed roughly 500 Phase 1-5 assertions into vacuous passes against a simulation that never ran. The loop is the only driver in the browser, so gating the loop is a complete freeze where it matters. An unknown state value fails *closed* (frozen), because the gate is an equality test against the playing constant rather than an inequality against the others.
2. **`Sound.ctx` deferred to 06-03** (see Deviations for the full reasoning).
3. **D-02 resolved as "keep one renderer"** rather than moving messages to the HUD. Moving them would have required rewriting `verify-pickups` assertion 3-0-vi and its whole section 3 framebuffer proof; keeping them costs nothing and 06-02 gets a gate instead of a hazard.
4. **Death before victory in `checkEndConditions`.** The alcove approach is guarded by the (14,20) enemy, so the overlap is real, not theoretical.
5. **Distinct prompt strings per screen.** `'CLICK TO PLAY'` / `'CLICK TO PLAY AGAIN'` would have made the screen-switching assertion pass on a substring; `'CLICK TO BEGIN'` / `'CLICK TO PLAY AGAIN'` / `'CLICK TO TRY AGAIN'` cannot.
6. **`Game.restart()` drains input unconditionally** as well as through `setState`, so a restart requested from the playing state (where `setState` correctly no-ops) still cannot hand the fresh world a stale delta.

## Deviations from Plan

### 1. [Rule 3 - Blocking] `Sound.ctx` deferred to 06-03 rather than added as a null placeholder

- **Found during:** Task 1, at the first full regression run.
- **Issue:** The plan's action step 4 asked for `Sound.ctx` (null) alongside `Sound.unlockCalls` and `Sound.unlock()`. Phase 5's `verify-pickups` assertion **0d** proves "Sound created NO AudioContext" by asserting `typeof AudioContext === 'undefined' && !('audioContext' in Sound) && !('ctx' in Sound)`. Declaring a null `ctx` placeholder fails that Phase 5 assertion (84 → 83).
- **Fix:** Corrected the *production* side — omitted the placeholder — rather than relaxing the Phase 5 assertion, per the plan-checker's W3 rule that editing a Phase 1-5 assertion is forbidden. `js/sound.js` carries a comment block explaining exactly why the field is absent and recommending that 06-03 keep its context in a module-scope variable behind an accessor so 0d can survive that plan too.
- **Consequence for assertion 1g:** the plan's wording ("Sound.ctx is null") is replaced by a **stronger** claim — no context field on `Sound` *at all*, and no `AudioContext`/`webkitAudioContext` binding anywhere in the sandbox — asserted at boot **and** re-asserted at the end of the run after every click, restart and hundreds of frames. This is a strengthening, not a weakening.
- **Forward note for 06-03:** it will genuinely construct a context and therefore genuinely owns restating 0d's claim, or avoids the collision entirely via an accessor.
- **Committed in:** `64ac66c`.

### 2. [Rule 1 - Bug] `verify-combat`'s `scenario()` helper needed the state machine reset

- **Found during:** Task 2, immediately after the death branch landed. `verify-combat` went 117 → 110.
- **Issue:** Section 2t kills the player and drives 60 *direct* `Game.step` calls. Those steps now run `checkEndConditions`, which correctly latches `Game.state` to `'dead'` for the rest of the process. Section 5 — the only rAF-driven scenario in that file — was then correctly frozen, and its seven assertions reported "frame -1" (never happened). `Combat.reset()` clears the dead *latch* but deliberately does not touch the state machine (combat.js owns stats, game.js owns state); in production the only thing that rebuilds the world is `Game.restart()`, which ends by entering the playing state.
- **Fix:** Added `Game.setState('playing')` as the first line of `verify-combat`'s `scenario()` world-rebuild helper, giving that helper the same property `Game.restart()` has. This is **scenario setup**, of exactly the kind the plan sanctions after `fireLoad()` — it restores the preconditions the Phase 5 assertions were written against. **No assertion, label, expectation or count in that file was touched**; it is back at 117/117.
- **Reported explicitly** here per the plan-checker's W3 instruction ("if something else moves, report it explicitly in the SUMMARY"). This is the only edit to a Phase 1-5 harness beyond the one sanctioned setup line per file and the `verify-input-view` script-list update the plan required.
- **Committed in:** `b801742`.

### 3. [Planned, but count-affecting] `verify-level` grew from 63 to 65

- Task 3 action 1 explicitly instructs adding an assertion naming the exit as reachable plus a falsifiability control. That is a deliberate *addition* (10c, 10d), not a lost assertion. Flagged here because it is the one number in the nine-harness table that differs from the W2 gate; the gate exists to catch assertions that are *lost*.

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug) + 1 planned count change.
**Impact on plan:** No scope creep. Every deviation preserved a Phase 1-5 assertion that the plan text would otherwise have broken.

## Issues Encountered

Three scenario bugs in the new harness, all found and fixed during Task 2 (production code was correct in every case):

1. **Armor absorbed the "lethal" hit.** `damagePlayer(health + 10)` is not lethal once the player is wearing armor — the locked formula absorbs `min(armor, floor(dmg/3))`. Introduced a `killPlayer()` helper using `health + armor + 10`, the smallest amount lethal at any armor value.
2. **`Enemies.list[0]` is not the nearest enemy.** The list is in row-major spawn order, so index 0 is the north-east hall enemy, which cannot see the start room and correctly never moves — making the 2d pursuit control read as a failure. Replaced with a derived `nearestEnemy()`.
3. **A "playing" control that was really a death screen.** `Combat.dead` was still latched, so the very first frame correctly re-fired the death branch. Fixed by using the full `freshPlaying()` rebuild rather than a bare `setState`.

## Known Stubs

None that block this plan's goal. Two deliberate, documented seams, both owned by later plans in this phase:

- **`HUD.render` draws nothing in the playing state.** Explicit and commented; 06-02 fills that branch with the status bar, crosshair, minimap and damage flash. The frame is complete without it — the 3D view has already been presented.
- **`Sound.unlock()` increments a counter and returns `false`.** Explicit and commented, with the two invariants (idempotent, never throws) that 06-03's replacement must preserve. This is the plan's stated boundary, not an omission.

## User Setup Required

None — no external service configuration. Zero dependencies, no build step.

## Delegated to the Orchestrator (in-browser play-test)

Everything automatable was automated. These need a real browser, from `file://` **and** from a static server:

1. Load the page: a title screen with **readable** controls over a rendered world that is **not moving**.
2. One click: play starts, the cursor is captured, the frame advances.
3. Play to the green arrow alcove in the south-east: victory screen with a kill tally and an elapsed time.
4. Click: a fresh run from the start room, full health, level repopulated.
5. Deliberately die: death screen with its restart prompt; click restarts.
6. Zero console errors and zero network requests from both origins.

**rAF-throttle caveat:** on a non-composited pane the loop does not tick — drive frames manually with `Game.step(0.016)` + `Game.view.render()` + `Framebuffer.present()` (and `HUD.render()` for the overlay).

## Next Phase Readiness

Both remaining plans in this phase hang off seams this plan created, and both are unblocked:

- **06-02 (HUD readouts, crosshair, minimap, damage flash)** inherits `js/hud.js` with a cleared surface every frame, `HUD.METRICS`, `HUD.reset()` as the minimap-prebuild hook, the `SCREEN_*` tunables as a sizing precedent, and the armed double-draw gate (verify-state section 4) it must **extend rather than replace**.
- **06-03 (Web Audio synthesis)** inherits `Sound.unlock()` called from every canvas click inside a real user activation, with its two invariants documented at the call site. It must decide how to hold its context without tripping `verify-pickups` 0d — an accessor over a module-scope variable is the path of least resistance.

No blockers.

## Self-Check: PASSED

- `js/hud.js` — FOUND
- `tools/verify-state.cjs` — FOUND
- `06-01-SUMMARY.md` — FOUND
- Commits `64ac66c`, `b801742`, `b6dd24b` — all FOUND in git log
- `index.html` `<script src>` count — 19, as claimed
- Ten harness all-pass tokens re-verified in two chained commands after the final commit

---
*Phase: 06-hud-audio-game-state-machine*
*Completed: 2026-07-25*
