---
phase: 06-hud-audio-game-state-machine
plan: 02
subsystem: ui
tags: [hud, canvas-2d-overlay, minimap, damage-flash, crosshair, event-messages, headless-harness]

# Dependency graph
requires:
  - phase: 01-foundation-render-loop
    provides: the #hud transparent display-resolution overlay canvas, Framebuffer.hudCtx/hudCanvas, and the once-per-frame putImageData contract
  - phase: 03-raycaster
    provides: Raycaster.overlayPasses — the ordered array Game.renderMessage stays registered in
  - phase: 05-enemy-ai-weapons-pickups
    provides: Combat (health/armor/ammo/weapon/hasShotgun/lastDamageAt), Weapons.TABLE + lastDryFire, Enemies.list/CORPSE, Pickups.list, Game.kills/totalKills and the message ring
  - plan: 06-01
    provides: js/hud.js with the state dispatch, HUD.METRICS, HUD.reset as the rebuild hook, Level.exit, and the armed double-draw gate (verify-state section 4)
provides:
  - "HUD.renderPlaying — the in-game overlay: status bar, crosshair, minimap and damage flash, dispatched from HUD.render in the playing state"
  - "HUD.buildMinimap / HUD.minimapCanvas / minimapScale / minimapGridX/Y / minimapBuilds — the prebuilt static level grid, rebuilt on HUD.reset and on a real box-size change only"
  - "HUD.flashAlpha() — the damage-flash alpha derived from Game.time - Combat.lastDamageAt, exposed so the expectation is derived rather than re-typed"
  - "HUD.ammoInHand() — the ammo count resolved through Weapons.TABLE for the weapon actually in hand"
  - "Weapons.EVENT_TEXT — the weapon-switch and out-of-ammo message texts, posted from Weapons.update on real edges only"
  - "CONFIG.HUD_* / DAMAGE_FLASH_* / MINIMAP_* overlay tunables"
  - "tools/verify-hud.cjs — 87 control-paired assertions, ALL_HUD_CONTRACTS_PASS"
affects: [06-03-web-audio-synthesis]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Prebuild-once, composite-once: a static picture derived from the level is painted into an offscreen canvas at reset time and blitted with ONE drawImage per frame, so the frame cost is constant in the cell count"
    - "One clamped world-to-box projection shared by the grid and every marker, so a dot and a wall can never disagree about where a corridor is"
    - "Readouts read the LIVE simulation objects; only the derived STRINGS are cached, keyed on every value they came from"
    - "Event posts hang on state-transition EDGES (selectWeapon's did-it-change return, lastDryFire's false-to-true), never on the input that requested them"
    - "Self-describing recordings: each status-bar column draws its label then its value, so a harness pairs values with labels structurally instead of guessing"

key-files:
  created:
    - "Doom/Claude Opus 4.8/GSD/tools/verify-hud.cjs"
  modified:
    - "Doom/Claude Opus 4.8/GSD/js/hud.js"
    - "Doom/Claude Opus 4.8/GSD/js/config.js"
    - "Doom/Claude Opus 4.8/GSD/js/weapons.js"

key-decisions:
  - "The minimap's static grid is prebuilt ONCE into an offscreen canvas and composited with a single drawImage; the whole overlay frame is 40 recorded calls against the level's 576 cells, and the rebuild test is one integer comparison"
  - "The ammo readout resolves its Combat.ammo field through Weapons.TABLE — the same table Weapons.fire() spends from — so the bar and the trigger cannot disagree about which weapon eats which ammo"
  - "The damage flash derives its age from two SIMULATION-time values (Game.time - Combat.lastDamageAt), so it freezes with the sim on an end screen and is exactly measurable headlessly"
  - "D-02 held: NO message renderer was added to js/hud.js. The two new event messages ride Game.renderMessage, and the 06-01 gate was EXTENDED (verify-hud section 3) rather than replaced — verify-state section 4 is byte-identical"
  - "The out-of-ammo post hangs on the false-to-true edge of Weapons.lastDryFire, captured before the fire() call: a held trigger at zero ammo refuses 60 times a second (proved: 120 refusals across 120 frames) and an unguarded post would overwrite the four-slot ring fifteen times a second"
  - "Status-bar columns draw label-then-value, making the recorded fillText sequence self-describing — this is what lets the harness pair each number with its own readout instead of matching on value"

patterns-established:
  - "Offscreen observability: the harness patches document.createElement BEFORE fireLoad so an offscreen prebuild is as recordable as a frame, and 'the prebuild touched the hud context zero times' gets its own positive control on the offscreen surface"
  - "Colour-keyed counting: distinct CONFIG colours per marker class make dot counts a measurement, with a setup assertion that the colours really are all distinct so two counts can never silently be one"

requirements-completed: [HUD-01, HUD-02, HUD-03, HUD-04, HUD-05, HUD-06]

coverage:
  - id: D1
    description: "While playing, the overlay reads out health, armor and the ammo for the weapon actually in hand, and each readout tracks its Combat field"
    requirement: "HUD-01"
    verification:
      - kind: integration
        ref: "node \"Doom/Claude Opus 4.8/GSD/tools/verify-hud.cjs\" # 1a-i..iv, 1b-i/ii, 1c-0..ii"
        status: pass
    human_judgment: false
  - id: D2
    description: "While playing, the overlay names the weapon in hand and shows the kill tally as defeated out of total"
    requirement: "HUD-02"
    verification:
      - kind: integration
        ref: "node \"Doom/Claude Opus 4.8/GSD/tools/verify-hud.cjs\" # 1d-i/ii, 1e-i/ii"
        status: pass
    human_judgment: false
  - id: D3
    description: "A crosshair is drawn at the exact centre of the overlay while playing, and recentres on a resize"
    requirement: "HUD-03"
    verification:
      - kind: integration
        ref: "node \"Doom/Claude Opus 4.8/GSD/tools/verify-hud.cjs\" # 1f-0..iii, 1j-iii"
        status: pass
    human_judgment: false
  - id: D4
    description: "Pickup and event messages appear and fade, drawn by EXACTLY ONE renderer — no message is drawn twice"
    requirement: "HUD-04"
    verification:
      - kind: integration
        ref: "node \"Doom/Claude Opus 4.8/GSD/tools/verify-hud.cjs\" # 3a-0..iv, 3b-0..ii, 3c-0..ii, 3d-0..iii, 3e-i..iii"
        status: pass
      - kind: integration
        ref: "node \"Doom/Claude Opus 4.8/GSD/tools/verify-state.cjs\" # 4a, 4b, 4c (unchanged, still green)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A minimap shows the level layout, the player with a facing indicator, the exit, and the live enemies and uncollected pickups, updating as the world changes"
    requirement: "HUD-05"
    verification:
      - kind: integration
        ref: "node \"Doom/Claude Opus 4.8/GSD/tools/verify-hud.cjs\" # 2a-i..iii, 2b-i..iv, 2c-0..iii, 2d-i..iv, 2e-0..iv, 2f-i/ii, 2g, 2h, 2i-i..iii"
        status: pass
    human_judgment: false
  - id: D6
    description: "Taking damage overlays a red flash that decays to nothing over CONFIG.DAMAGE_FLASH_TIME"
    requirement: "HUD-06"
    verification:
      - kind: integration
        ref: "node \"Doom/Claude Opus 4.8/GSD/tools/verify-hud.cjs\" # 1g-0..iii, 1h-0..ii, 1i"
        status: pass
    human_judgment: false
  - id: D7
    description: "The in-game overlay draws only while playing; the title, victory and death screens draw only outside it, and the overlay never blits or allocates per frame"
    verification:
      - kind: integration
        ref: "node \"Doom/Claude Opus 4.8/GSD/tools/verify-hud.cjs\" # 1j-i..iii, 1k-i..iii"
        status: pass
    human_judgment: false
  - id: D8
    description: "The overlay reads correctly in a real browser at real window sizes from file:// and from a static server: legible bar, dead-centre crosshair through a resize, a red flash that fades rather than sticking, one message per event, and a minimap whose dots disappear as you kill and collect — with zero console errors and zero network requests"
    verification: []
    human_judgment: true
    rationale: "Legibility at real window sizes, the aesthetic weight of the flash and the bar over a lit scene, real resize behaviour and the zero-network/zero-error claims cannot be established from the Node vm sandbox — the DOM, the compositor and the network stack are all stubbed. Delegated to the orchestrator."

# Metrics
duration: 48min
completed: 2026-07-25
status: complete
---

# Phase 6 Plan 02: The HUD — Readouts, Crosshair, Minimap and Damage Flash Summary

**Five phases of simulation become visible: a bottom status bar reading health, armor, the ammo the weapon in hand actually spends, the weapon name and the kill tally; a crosshair provably centred through a resize; a whole-level minimap prebuilt once and composited with a single `drawImage`; a red flash decaying over simulation time; and two new event messages that ride the ONE message renderer — proven by 87 new control-paired assertions with all 571 Phase 1-5 assertions untouched.**

## Performance

- **Duration:** ~48 min
- **Tasks:** 3 of 3
- **Files created:** 1
- **Files modified:** 3
- **Assertions:** 87 new (verify-hud); **781 total across eleven harnesses**

## Accomplishments

- **The numbers are on screen and provably live.** Every readout reads the object the simulation mutates. `1b` changes health, armor and ammo and re-records: all three move, and each moves *to* the new value of its own field. A HUD that painted a picture of a number would fail that pair.
- **The ammo readout cannot lie about the weapon.** It resolves its `Combat.ammo` field through `Weapons.TABLE` — the same entry `Weapons.fire()` decrements. `1c` grants and selects the shotgun and asserts the *same* readout moves from the bullet count to the shell count, with the field name **derived from the table**, not typed into the harness.
- **The crosshair is centred by construction, not by arithmetic that happened to come out even.** The arms span `[cx-arm, cx+arm]` and `[cy-arm, cy+arm]` around the live canvas midpoint. `1f` measures the drawn extent (`630..650, 350..370` on 1280x720), then resizes to 900x540 and measures again (`442..458, 262..278`) — contained, symmetric within one pixel, and *moved*.
- **The minimap costs one blit, not 576 fillRects.** The static grid is painted once into an offscreen canvas at `HUD.reset` time. A whole playing frame is **40 recorded overlay calls** against the level's **576 cells** — and 30 further frames rebuild the grid **zero** times. `2c` counts the prebuilt wall rectangles against `Level.cells` (322 of 576) and then makes one more cell solid: the count moves by exactly one.
- **The dots track the world through the same flags the render passes read.** Killing one enemy removes exactly one enemy dot; walking onto one item removes exactly one pickup dot; a restart brings all 8 enemies and 9 pickups back. Driven to all four level corners *and to two poses outside the grid entirely*, all 240 plotted coordinates stay inside the box.
- **The damage flash is measurable because it is made of simulation time.** `Game.time - Combat.lastDamageAt` — both values the sim owns. Peak alpha `0.3967` on the frame after a hit, decayed to `0.1167` past half the window, **not drawn at all** past `CONFIG.DAMAGE_FLASH_TIME`, and with the never-damaged sentinel in place it is absent on the first frame *and* half a second of simulation later. That last control is what separates "tracks the damage stamp" from "tracks the clock".
- **HUD-04 closed without a second renderer.** The two new event messages post through `Game.message` and are drawn by `Game.renderMessage` alone. `3d` proves it on a *single frame*: zero hud text calls carrying the message, while `Game.messageBox.drawn` is true and the framebuffer differs from the message-free render in 2,399 pixels. `3e` re-counts the overlay array strictly (still exactly 2, viewmodel first) and asserts `js/hud.js` exposes no message-shaped key at all.
- **Neither event message can flood the four-slot ring.** The switch post hangs on `Combat.selectWeapon` reporting a *real* change (30 repeat presses post nothing; a shotgun the player does not own posts nothing). The out-of-ammo post hangs on the false-to-true edge of `Weapons.lastDryFire` — and `3b` proves the hazard is real by asserting the held trigger produced **120 refusals across 120 frames** while posting **exactly one** message, then fires one real shot and runs dry again to prove the edge **re-arms**.

## Task Commits

1. **Task 1: status bar, crosshair, damage flash (HUD-01/02/03/06)** — `d95ac64` (feat)
2. **Task 2: the minimap (HUD-05)** — `90af8af` (feat)
3. **Task 3: event messages, the exactly-once proof, full regression (HUD-04)** — `2bccd29` (feat)

## Files Created/Modified

**Created**
- `tools/verify-hud.cjs` — 87 assertions in three sections: the status bar / crosshair / flash (1a-1k), the minimap (2a-2i), the event messages and the double-draw gate (3a-3e). It patches `document.createElement` **before** `fireLoad` so the offscreen minimap prebuild is recordable, and wraps the cached `#hud` context so the overlay is assertable without a screen.

**Modified**
- `js/hud.js` — `HUD.renderPlaying` (flash → minimap → status bar → crosshair), `HUD.buildMinimap`, the shared clamped `mapPX`/`mapPY` projection, `updateMetrics` (now run for **every** state before the dispatch), a third keyed string cache for the readout row, and the D-02 resolution restated in the header with its two reasons.
- `js/config.js` — the `HUD_*` bar/label/value/warning/crosshair tunables, `DAMAGE_FLASH_TIME`/`ALPHA`/`COLOR`, and the `MINIMAP_*` block. Every size is a fraction of the hud canvas height; `js/hud.js` contains no pixel count of its own.
- `js/weapons.js` — `Weapons.EVENT_TEXT` (a data table beside the weapon table), the `postEvent` helper, and the two edge-gated posts inside `Weapons.update`. **No ammo, cooldown or viewmodel behaviour changed.**

`index.html` was **not** modified by this plan (no new script; `js/hud.js` was already in the load order). `node --check` is clean on all 19 shipped JS files.

## Verification Results

**All eleven harnesses print their all-pass tokens in one chained command.**

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
| verify-level | 65 | 65 | — |
| verify-state | 121 | 121 | — |
| verify-hud | — | **87** | new |
| **Total** | **694** | **781** | |

**Every Phase 1-5 count is byte-identical, and `verify-state` is byte-identical too.** No assertion was weakened, relabelled, removed or made vacuous anywhere, and **no Phase 1-5 harness file was edited at all in this plan** — the plan's "interaction watch" contingency (action 4 of Task 3) never triggered, because both new posts are gated on real edges that the Phase 5 scenarios never produce (they hold no fire intent and press no select key).

Selected measurements, all derived rather than asserted against literals:

- Overlay frame cost: **40** recorded calls, against **576** level cells and a bound of `40 + dots(19)`.
- Prebuild: **577** offscreen fillRects (576 cells + the background) and **0** hud-context calls.
- Grid: **322** solid rectangles === the solid-cell count from `Level.cells`; one extra wall → **323**.
- Flash: peak **0.3967** ≤ `DAMAGE_FLASH_ALPHA` 0.42, mid-window **0.1167**, past-window **absent**.
- 200 recorded frames: **0** `putImageData`/`getImageData`, 2,000 text calls, `HUD.METRICS` identical by reference.
- Bounds: **240** plotted coordinates across six poses, all inside the box.

## Decisions Made

1. **The minimap is prebuilt and composited, and the rebuild trigger is a real change, not a schedule.** `HUD.reset()` (boot and `Game.restart()`, both of which follow `Level.build()`) plus a single integer comparison of `minimapCanvas.width` against the derived box size at the top of the per-frame draw. Nothing rebuilds on a frame where nothing changed.
2. **One projection, clamped, shared.** The grid's own `scale`/origin are stored on `HUD` and every plotted point — player, enemies, pickups, exit, and the facing tick's endpoint — goes through `mapPX`/`mapPY`. The clamps are written `!(v > lo)` so a NaN coordinate lands on the box edge rather than escaping it.
3. **The whole level is shown rather than a window around the player** (D-04, threat T-06-15 accepted): at 187px the 24x24 grid is legible, it is the classic behaviour, and it answers *where do I go* — which a scrolling window cannot.
4. **Corpses are not plotted.** The map exists to show what is still coming for you; the dot filter is `alive === true && state !== CORPSE`, the same pair of flags the hitscan filter and the AI skip predicate use.
5. **Label-then-value column order is part of the contract**, documented at the draw site. It makes the recorded call sequence self-describing, which is what allows the harness to pair each value with its own label instead of matching on the value (a test that would pass vacuously whenever two stats happened to be equal).
6. **The flash goes down first, under the bar and the crosshair.** The one moment a player most needs to read their health is the moment the screen has just gone red.

## Deviations from Plan

### 1. [Documented behaviour change] `HUD.screen` now reads `'playing'` on a playing frame

- **Found during:** Task 1, wiring the dispatch.
- **Issue:** 06-01 documented `HUD.screen` as "the screen drawn by the last render, or **null** when it drew none (**the playing state**, …)". That branch now paints the in-game overlay, so recording `null` would have been a lie.
- **Fix:** the playing branch sets `HUD.screen = Game.STATES.PLAYING` and returns `true`; the field's comment records the change and why. **No assertion anywhere depended on the old value** (verify-state reads only `HUD.TITLE_PROMPT`/`DEAD_HEADING`/`DEAD_PROMPT`), and verify-state is still 121/121.
- **Committed in:** `d95ac64`.

### 2. [Plan frontmatter vs. plan body] `tools/verify-state.cjs` is listed in `files_modified` but was **not** modified

- The plan's Task 3 action 3 instructs that the double-draw gate be **extended** — "the same gate 06-01 section 4 armed; extend it to the event messages rather than replacing it". The extension is section 3 of the *new* harness, which is where the new messages live. Editing `verify-state.cjs` would have meant touching an existing green assertion for no reason, which W3 forbids.
- `verify-state.cjs` is therefore byte-identical and still at 121/121, and its section 4 (the pickup-message gate) and verify-hud's section 3 (the event-message gate) now both run on every regression.

### 3. [Layout restructure, no behaviour change] `HUD.METRICS` is now computed for **every** state, before the dispatch

- 06-01 computed the metrics record only inside the screens branch (the playing branch returned early). The in-game overlay needs the same record, so the computation moved above the dispatch into one `updateMetrics(w, h)`. The screens' fields are computed from the identical expressions in the identical order; verify-state's screen assertions are unchanged and still green.

**Total deviations:** 1 documented behaviour change, 1 plan-frontmatter clarification, 1 no-behaviour restructure. **No Phase 1-5 harness assertion, label, expectation or count was touched anywhere in this plan.**

## Issues Encountered

None that required a fix. The harness passed 39/39, then 67/67, then 87/87 on first run of each section — the one adjustment was cosmetic (printing a message age with six decimals instead of three, so `2.4999999999999996` did not *display* as the boundary value `2.500` in an assertion label about being strictly below it).

## Known Stubs

**None.** Every branch this plan owns is implemented and measured. The one remaining seam in the phase — `Sound.unlock()` / `Sound.play(name)` — belongs to 06-03 and is untouched here.

## User Setup Required

None — no external service configuration. Zero dependencies, no build step.

## Delegated to the Orchestrator (in-browser play-test)

Everything automatable was automated. These need a real browser, from `file://` **and** from a static server:

1. Start a run: the bar reads HEALTH / ARMOR / AMMO / WEAPON / KILLS, and each moves as you play (take damage, pick up a clip, kill something).
2. The crosshair sits dead centre; **resize the window** and confirm it stays centred.
3. Take a hit: a red flash that **fades** rather than sticking, and the bar stays readable through it.
4. Collect an item: **one** message that fades. Switch weapons and run a weapon dry: **one** message each.
5. The minimap shows the level, your position and facing, the green exit, and dots that disappear as you kill and collect.
6. Confirm health below 30 draws the health value in the warning colour.
7. Zero console errors and zero network requests from both origins.

**rAF-throttle caveat:** on a non-composited pane the loop does not tick — drive frames manually with `Game.step(0.016)` + `Game.view.render()` + `Framebuffer.present()` + `HUD.render()`.

## Next Phase Readiness

**06-03 (Web Audio synthesis)** is unblocked and unaffected by this plan: it inherits `Sound.unlock()` called from every canvas click inside a real user activation, and the six event sites it needs to wire. Two notes carried forward:

- It must still decide how to hold its `AudioContext` without tripping `verify-pickups` **0d** (which asserts no `ctx`/`audioContext` field exists on `Sound` at all) — a module-scope variable behind an accessor is the path of least resistance.
- `Weapons.update` now posts two event messages; a weapon-switch **sound** is the natural companion and hangs off the same `Combat.selectWeapon` return value that already gates the message.

No blockers.

## Self-Check: PASSED

- `Doom/Claude Opus 4.8/GSD/tools/verify-hud.cjs` — FOUND
- `Doom/Claude Opus 4.8/GSD/js/hud.js` / `js/config.js` / `js/weapons.js` — FOUND
- `.planning/phases/06-hud-audio-game-state-machine/06-02-SUMMARY.md` — FOUND
- Commits `d95ac64`, `90af8af`, `2bccd29` — all FOUND in git log
- Eleven all-pass tokens re-verified in one chained command after the final task commit
- `node --check` clean on all 19 shipped JS files; `index.html` unmodified by this plan

---
*Phase: 06-hud-audio-game-state-machine*
*Completed: 2026-07-25*
