---
phase: 02-level-player-movement-input
plan: 03
subsystem: input-and-view
tags: [intent-only-input, pointer-lock, mouse-look, arrow-key-fallback, event-code, held-key-set, mouse-delta-drain, delta-clamp, top-down-view, view-seam, input-seam, tab-refocus-resync, no-tunneling, headless-harness]

# Dependency graph
requires:
  - "02-02: Game.input / Game.view seams, Game.step reads readIntent(), Game.render owns the single present, resync frame, Game.attach (visibilitychange + focus); Player pose {x,y,dirX,dirY,planeX,planeY}, setDir, rotate, update(dt,intent), RADIUS/WALK_SPEED/RUN_MULT/TURN_SPEED/MOUSE_SENSITIVITY, CONFIG.DT_MAX"
  - "02-01: Level.build, Level.cells / cellAt / isSolid, Level.WIDTH/HEIGHT, Level.spawns, Level.WALL_TEXTURES, Level.LANDMARKS (openCell / wallFaceEast+wf / corridorCell+blockedAxis+slideDir), tools/boot.cjs (manual rAF, setVisibility, setPointerLockElement, dispatch)"
  - "01-01: Framebuffer.buf32 / width / height / present(), packRGBA, classic-script load order"
provides:
  - "Input global: intent-only keyboard + pointer-lock mouse. keys (null-proto held physical-code set), mouseDX (drained accumulator), BINDINGS, PREVENT, MOUSE_MAX_DX 200, lockAttempts, locked, lockError. attach(canvas), requestLock(), readIntent()->{forward,strafe,turn,run,mouseDX}, reset()"
  - "TopDown global: temporary Phase 2 verification view behind TopDown.ENABLED. render() writes Framebuffer.buf32 and does NOT present; layout()/toScreen() live viewport-derived mapping; bounds-checked pixel/rect/disc/line primitives; WALL_COLORS index-aligned to Level.WALL_TEXTURES, MARKER_COLORS, facing + FOV-edge rays"
  - "Wiring: main.js assigns Game.input = Input and Game.view = TopDown.ENABLED ? TopDown : null; index.html load order config->framebuffer->textures->sprites->preview->level->player->input->topdown->game->main"
  - "tools/verify-input-view.cjs: 17-assertion end-to-end tracer (ALL_TRACER_CONTRACTS_PASS)"
  - "tools/verify-phase02.cjs: 38-assertion Phase 2 success-criteria roll-up (ALL_PHASE02_CONTRACTS_PASS)"
affects: [03-raycaster-walls-floors, 04-sprites-entities, 05-enemies-weapons-pickups, 06-title-hud-state]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Intent-only input: keydown/keyup maintain a null-prototype set of PHYSICAL event.code values; mousemove accumulates a raw delta only while document.pointerLockElement is the canvas; readIntent() recomputes the four slots from BINDINGS, copies AND drains mouseDX, and returns ONE reused record — no per-frame allocation, no pose mutation in a handler"
    - "Drain-on-read for the mouse: the accumulated delta is applied exactly once because readIntent zeroes it, so a delta cannot double-apply or leak across frames"
    - "Arrow-key turn is computed purely from the held-key set with zero dependency on lock state — the CTRL-03 fallback is a first-class control path, proven functional after a pointerlockerror and with a null lock element"
    - "Pointer-lock hygiene: lock requested only from the canvas click gesture (lockAttempts proves it), request wrapped against a sync throw AND a rejected promise, per-event movement magnitude-clamped to MOUSE_MAX_DX and non-finite-guarded, lock loss / blur / refocus all clear the held-key set"
    - "View through the seam: TopDown.render writes buf32 and never presents; Game.render owns the one putImageData, so present count == frame count on every frame including resync — Phase 3 swaps the raycaster in by re-pointing Game.view alone"
    - "Every top-down write routes through bounds-checked primitives and the cell size floors to >= 1, so no viewport aspect can push a write outside buf32; layout is recomputed every render from the live framebuffer dimensions"
    - "Rays drawn before the player disc so the disc covers the shared origin — the pixel at toScreen(Player.x,Player.y) is unambiguously the player colour"

key-files:
  created:
    - "Doom/Claude Opus 4.8/GSD/js/input.js"
    - "Doom/Claude Opus 4.8/GSD/js/topdown.js"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-input-view.cjs"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-phase02.cjs"
  modified:
    - "Doom/Claude Opus 4.8/GSD/js/main.js"
    - "Doom/Claude Opus 4.8/GSD/index.html"

key-decisions:
  - "Handlers set intent only and never touch the player; the loop samples once per frame (D-07). The held-key set uses event.code (physical key) so bindings survive non-QWERTY layouts and modifier combinations"
  - "The mouse delta is drained on read, so it is applied exactly once; accumulation is gated on document.pointerLockElement === canvas at event time, so lock loss stops camera drift instantly"
  - "Arrow-key turn never consults Input.locked or the lock element — turning stays fully functional when pointer lock is denied, unsupported, or released with Escape (CTRL-03)"
  - "Each mouse event's own contribution is magnitude-clamped to MOUSE_MAX_DX (200) and non-finite-coerced before accumulating, so one enormous movementX after regaining focus cannot spin the camera; cross-event accumulation within a frame is preserved"
  - "The top-down view lives entirely in its own file behind TopDown.ENABLED and is attached through Game.view; Phase 3 replaces it by re-pointing that single assignment and flipping the flag — nothing else changes"
  - "The run-ratio and per-key symmetry drives measure over short unclipped intervals from openCell (openCell has ~5.28 cells of eastward room; a full run-second would clip wallFaceEast), matching the interval reasoning Plan 02 established"

patterns-established:
  - "The tracer proves ONE end-to-end path (real key + pointer-locked mouse -> pose -> visible top-down pixel) before any expansion; the roll-up harness then asserts each of the four Phase 2 success criteria directly"
  - "Randomized / arbitrary-intent drives inject a scripted intent source into Game.input; discrete key-driven drives dispatch real DOM key events through the wired Input — both run the REAL Game loop via boot.cjs's manual rAF scheduler"
  - "Every wall-relative / distance assertion anchors on Level.LANDMARKS by name; the resync frame is consumed with one step before any timed measurement"

requirements-completed: [CTRL-01, CTRL-02, CTRL-03, LVL-01]

coverage:
  - id: D-07
    description: "Intent-only key state: held physical-code set, page-scroll suppression, blur/lock-loss reset; handlers never mutate the player"
    requirement: "CTRL-01"
    verification:
      - kind: unit
        ref: "verify-input-view.cjs 4a-4c / verify-phase02.cjs 1.1-1.4, 2.7 — real KeyW/S/A/D drive the pose in the expected direction, exact-negative pairs, keyup stops motion, blur clears the held key"
        status: pass
    human_judgment: false
  - id: D-08
    description: "Pointer lock from a click preferring unadjusted movement, lifecycle handling, arrow-key fallback not a debug affordance, per-event mouse clamp"
    requirement: "CTRL-02"
    verification:
      - kind: unit
        ref: "verify-phase02.cjs 2.1-2.6 — mouse rotates under lock by movementX*SENS, click increments lockAttempts, no rotation without lock, arrow turn = TURN_SPEED unlocked, pointerlockerror leaves turning working, movementX 100000 clamps to MOUSE_MAX_DX"
        status: pass
    human_judgment: false
  - id: CTRL-03
    description: "Keyboard turn fallback works whether or not pointer lock is active"
    requirement: "CTRL-03"
    verification:
      - kind: unit
        ref: "verify-phase02.cjs 2.4, 2.5 — with a null lock element and after a pointerlockerror, ArrowLeft/ArrowRight rotate -/+ TURN_SPEED over one second"
        status: pass
    human_judgment: false
  - id: PLAT-04
    description: "A tab refocus is absorbed by a resync frame (dt 0, unchanged pose, still presents, held key cleared, next frame advances)"
    requirement: "PLAT-04"
    verification:
      - kind: unit
        ref: "verify-phase02.cjs 1.8-1.11 (x2, visibilitychange AND focus) — trigger sets resync and clears the held key; the resync frame carries dt exactly 0 with a bit-identical pose even with forward re-pressed, still presents, clears resync; the next frame advances ~WALK_SPEED*0.016"
        status: pass
    human_judgment: false
  - id: CTRL-04
    description: "No tunneling at run speed; slides along walls; never inside geometry (re-verified through the wired input path)"
    requirement: "CTRL-04"
    verification:
      - kind: unit
        ref: "verify-phase02.cjs 3.1-3.5 — 6000-frame no-cell-skip / no-corner-cut drive, wallFaceEast.wf side preservation under a 2 s hitch, corridor slide with the blocked axis arrested and the free axis sliding > 0.3"
        status: pass
    human_judgment: false
  - id: LVL-01
    description: "Hand-designed grid level loaded and verifiable on the top-down view (grid coloured by material, spawn markers, player, facing + FOV rays)"
    requirement: "LVL-01"
    verification:
      - kind: unit
        ref: "verify-phase02.cjs 4.1-4.9 — >=3 disjoint 4x4 blocks + corridor + all five wall IDs, TopDown does not present, player + two wall colours drawn, facing ray rotates with the pose, extreme viewports keep every write in bounds"
        status: pass
    human_judgment: false
  - id: D-08-browser
    description: "Live browser confirmation of the interactive/visual qualities no headless harness can assert"
    verification:
      - kind: automated_ui
        ref: "orchestrator browser pass of Doom/Claude Opus 4.8/GSD/index.html — the 8-step human-check in Task 3 (file:// AND static server)"
        status: unknown
    human_judgment: true
    rationale: "Autonomous run, no human available. The headless harnesses prove the mechanism exhaustively (input model, mouse-look math, arrow fallback, resync, no-tunneling, view drawing, bounds safety, present==frame). Only a real browser can confirm the FEEL of mouse-look smoothness, the slide-vs-stick sensation, resize crispness, the Escape->arrow-key handoff, tab-switch survival, and an empty DevTools console/network pane. Delegated to the orchestrator's browser pass."

# Metrics
duration: 16min
completed: 2026-07-24
status: complete
---

# Phase 2 Plan 03: Pointer-Lock Mouse-Look, Intent-Only Input & the Top-Down Verification View Summary

**Live keyboard and pointer-lock mouse feeding the intent seam as pure intent (a held physical-key set plus a drain-on-read mouse delta, never a pose mutation), an arrow-key turn fallback that works with or without lock, and a temporary top-down view feeding the render seam — closing Phase 2's end-to-end loop so the level, the pose, the clamped loop and the collision all become something you can drive and watch, with all four success criteria turned into 38 mechanically-asserted facts anchored on named level landmarks.**

## Performance

- **Duration:** ~16 min
- **Completed:** 2026-07-24
- **Tasks:** 3 (Task 1 `type="tracer"`, Tasks 2-3 `type="auto"`; no checkpoints)
- **Files:** 4 created, 2 modified

## Accomplishments

- **The whole path is drivable end to end.** A real `KeyW` keydown and a real pointer-locked `mousemove` reach the player through `Input.readIntent()`, the clamped `Game` loop advances the pose, and the top-down view draws the grid, the player and the facing ray into `Framebuffer.buf32` — proven by the 17-assertion tracer before a single fallback was added.
- **Input is intent, never mutation (D-07).** `keydown`/`keyup` maintain a null-prototype set of PHYSICAL `event.code` values; `mousemove` accumulates a raw horizontal delta only while `document.pointerLockElement` is the canvas, read at event time. `readIntent()` recomputes the four numeric slots from a `BINDINGS` data table, copies and **drains** the mouse delta into ONE reused record, and returns it. The player is never touched in a handler; the loop samples once per frame.
- **Mouse-look is correct and defensive (CTRL-02, D-08).** Lock is requested only from the canvas click gesture (`lockAttempts` proves it), preferring `{unadjustedMovement:true}`, wrapped against both a synchronous throw and a rejected promise. Each event's own `movementX` is non-finite-guarded and magnitude-clamped to `MOUSE_MAX_DX` (200) before accumulating, so one huge delta after refocus cannot spin the camera. Pointer-lock loss, window blur and the loop's refocus resync all clear the held-key set.
- **The arrow-key fallback is a first-class control path (CTRL-03).** The turn slot is computed purely from the held-key set with zero dependency on `Input.locked` or the lock element — turning is proven to work with a null lock element and after a `pointerlockerror`, at exactly `TURN_SPEED` radians per second.
- **The top-down view is clean scaffolding (LVL-01, D-09).** `TopDown.render()` writes `buf32` and never presents; it draws the grid coloured by wall material, the spawn markers, one-pixel grid lines, the player disc, the centre facing ray and the two FOV edge rays (`dir ± plane` — exactly Phase 3's leftmost/rightmost rays). Every write routes through bounds-checked pixel/rect/disc/line primitives and the cell size floors to `>= 1`, so no viewport aspect can escape the buffer. It lives behind `TopDown.ENABLED` and is attached through `Game.view`.
- **All four Phase 2 success criteria are asserted directly.** The 38-assertion roll-up drives the real loop through the manual rAF scheduler and the stubbed DOM: movement/strafe/run with exact-negative symmetry and frame-rate independence, the tab-refocus resync through **both** `visibilitychange` and `focus`, mouse-look under lock and the arrow fallback without it, a 6000-frame no-tunneling drive plus `wallFaceEast.wf` side preservation and a corridor slide, and the top-down structure/pose/bounds checks — closing with self-containment and present==frame gates.

## Task Commits

1. **Task 1 (tracer): end-to-end tracer — WASD + pointer-lock mouse drive the top-down view** — `2cda26e` (feat)
2. **Task 2: pointer-lock lifecycle, arrow-key fallback, delta clamping, markers + FOV rays** — `2ea9350` (feat)
3. **Task 3: Phase 2 success-criteria roll-up harness** — `9af8841` (test)

## Files Created/Modified

- `Doom/Claude Opus 4.8/GSD/js/input.js` (created) — the `Input` global.
- `Doom/Claude Opus 4.8/GSD/js/topdown.js` (created) — the `TopDown` global.
- `Doom/Claude Opus 4.8/GSD/tools/verify-input-view.cjs` (created) — 17-assertion end-to-end tracer, `ALL_TRACER_CONTRACTS_PASS`.
- `Doom/Claude Opus 4.8/GSD/tools/verify-phase02.cjs` (created) — 38-assertion success-criteria roll-up, `ALL_PHASE02_CONTRACTS_PASS`.
- `Doom/Claude Opus 4.8/GSD/js/main.js` (modified) — wires `Input.attach(game)`, `Game.input = Input`, `Game.view = TopDown.ENABLED ? TopDown : null` after `Player.spawn()`.
- `Doom/Claude Opus 4.8/GSD/index.html` (modified) — two new classic `<script>` tags (`js/input.js`, `js/topdown.js`) between `js/player.js` and `js/game.js`; load-order contract extended to 11 entries naming both files and the temporary-scaffolding status of the view.

## The `Input` API surface (contract for Phase 3+)

### State

| Member | Meaning |
|--------|---------|
| `Input.keys` | Null-prototype set of held PHYSICAL `event.code` values -> true |
| `Input.mouseDX` | Running sum of raw horizontal mouse movement (pixels); drained by `readIntent` |
| `Input.locked` | Mirrors whether the attached canvas holds pointer lock |
| `Input.canvas` | The element lock is requested on |
| `Input.lockError` | Last pointer-lock failure (a throw, a rejected promise, or `'pointerlockerror'`), recorded not propagated |
| `Input.lockAttempts` | Count of pointer-lock requests (proves lock is gesture-scoped) |
| `Input.BINDINGS` | Data table: `KeyW/S` forward ±, `KeyA/D` strafe ∓/±, `ArrowLeft/Right` turn ∓/±, `ShiftLeft/Right` run |
| `Input.PREVENT` | Codes whose default action is suppressed: every bound code + `ArrowUp/Down` + `Space` |
| `Input.MOUSE_MAX_DX` | 200 — per-event mouse magnitude clamp |
| `Input.intent` | The ONE reused record `{forward, strafe, turn, run, mouseDX}` |

### Methods

| Method | Behaviour |
|--------|-----------|
| `Input.attach(canvas)` | Registers window `keydown`/`keyup`/`blur`, canvas `click`, and document `mousemove`/`pointerlockchange`/`pointerlockerror`. |
| `Input.requestLock()` | Requests pointer lock from the canvas preferring `{unadjustedMovement:true}`; increments `lockAttempts`; swallows a sync throw AND a rejected promise into `lockError`. |
| `Input.readIntent()` | Recomputes the four slots + `run` from `keys` via `BINDINGS`, copies AND drains `mouseDX`, returns the reused record. No allocation. |
| `Input.reset()` | Clears every held key and zeroes `mouseDX`. Called by blur, pointer-lock loss, and the loop's refocus resync. |

### Handlers (all set intent only)

`keydown` ignores auto-repeat, sets `keys[code]`, and `preventDefault()`s a `PREVENT` code. `keyup` deletes the code (also `preventDefault` for `PREVENT`). `mousemove` accumulates a finite, `MOUSE_MAX_DX`-clamped `movementX` only while the canvas holds lock. `pointerlockchange` mirrors `Input.locked` and, on loss, zeroes `mouseDX` and calls `reset()`. `pointerlockerror` clears `locked` and records `lockError` — nothing else, so arrow turning stays live. `blur` calls `reset()`.

## The `TopDown` API surface and the Phase 3 swap

### Surface

| Member | Meaning |
|--------|---------|
| `TopDown.ENABLED` | `true`; the flag Phase 3 flips to `false` |
| `TopDown.WALL_COLORS` | Packed colour per wall ID, **index-aligned to `Level.WALL_TEXTURES`** (0 unused; 1 stone, 2 brick, 3 tech, 4 door, 5 exit) |
| `TopDown.MARKER_COLORS` / `MARKER_DEFAULT` | Colour per `Level.spawns` type (enemy/health/armor/ammo/shotgun/exit) |
| `TopDown.BG / FLOOR / GRID / PLAYER / RAY / FOV_RAY` | Packed colours for background, floor, grid lines, player disc, centre facing ray, FOV edge rays |
| `TopDown.cell / originX / originY` | Live layout, recomputed by `layout()` every render |
| `TopDown.layout()` | Integer cell size (`>= 1`) fitting the map in ~90% of the smaller framebuffer dimension, centred origin. |
| `TopDown.toScreen(wx, wy)` | World -> framebuffer pixel `{sx, sy}` through the stored layout (same math `render` uses). |
| `TopDown.render()` | Writes `buf32` (BG, cells, grid lines, spawn markers, FOV edge rays, facing ray, player disc) and does **NOT** present. |

### Exactly what Phase 3 does to swap in the raycaster

1. **Flip the flag:** set `TopDown.ENABLED = false` (or leave the file entirely — it is self-contained).
2. **Re-point one assignment** in `main.js`: `Game.view = Raycaster;` instead of `TopDown`. Nothing else in the loop, the input, or the present path changes.
3. **Honour the view contract:** the new view's `render()` MUST write into `Framebuffer.buf32` and MUST NOT call `Framebuffer.present()` — `Game.render()` owns the single `putImageData` per frame (present count == frame count, resync frames included). The raycaster consumes the same `{dirX,dirY,planeX,planeY}` pose as `rayDir = dir + plane*cameraX`.

## The key-binding table

| `event.code` | Intent effect |
|--------------|---------------|
| `KeyW` / `KeyS` | forward +1 / −1 |
| `KeyA` / `KeyD` | strafe −1 / +1 |
| `ArrowLeft` / `ArrowRight` | turn −1 / +1 (dt-scaled by `TURN_SPEED`; the CTRL-03 fallback) |
| `ShiftLeft` / `ShiftRight` | run (boolean) |
| Mouse `movementX` under lock | camera yaw, `× MOUSE_SENSITIVITY`, NOT dt-scaled |
| Suppressed defaults (`PREVENT`) | all of the above + `ArrowUp` / `ArrowDown` / `Space` |

## The pointer-lock lifecycle

- **Request:** only from the canvas `click`, preferring `{unadjustedMovement:true}`; wrapped against a synchronous throw and a rejected promise; `lockAttempts` increments so a harness (and a reviewer) can prove the request was gesture-scoped, not fired at load.
- **Engage (`pointerlockchange`, element == canvas):** `Input.locked = true`. Mouse deltas now accumulate (checked at each `mousemove`).
- **Release (`pointerlockchange`, element != canvas — e.g. Escape):** `Input.locked = false`, `mouseDX` zeroed, `Input.reset()` — no stale delta, no stuck key.
- **Error (`pointerlockerror`):** `Input.locked = false`, `lockError` recorded, and **nothing else** — arrow-key turning stays fully functional (CTRL-03).
- **Blur / refocus:** window `blur` and the loop's `visibilitychange`/`focus` resync all call `reset()`.

## Verification Results

**Per-task automated gates (all pass):** `node --check` on `js/input.js`, `js/topdown.js`, `js/main.js`, `tools/verify-input-view.cjs`, `tools/verify-phase02.cjs`; contract greps (`event.code`/`pointerLockElement`/`movementX`/`ENABLED`/`Game.view`/`Game.input`; then `pointerlockchange`/`pointerlockerror`/`MOUSE_MAX_DX`/`PREVENT`/`preventDefault`/`'blur'`/`lockAttempts`/`spawns`/`planeX`); the `awk` load-order gate proving player -> input -> topdown -> game.

**Four harnesses — all print their all-pass tokens:**

| Harness | Command | Assertions | Token |
|---------|---------|-----------|-------|
| Level | `node "tools/verify-level.cjs"` | 56 | `ALL_LEVEL_CONTRACTS_PASS` |
| Motion | `node "tools/verify-motion.cjs"` | 22 | `ALL_MOTION_CONTRACTS_PASS` |
| Tracer | `node "tools/verify-input-view.cjs"` | 17 | `ALL_TRACER_CONTRACTS_PASS` |
| Phase 2 roll-up | `node "tools/verify-phase02.cjs"` | 38 | `ALL_PHASE02_CONTRACTS_PASS` |

**Self-containment negative gate — pass:** zero matches for `type="module"` / `import ` / `export ` / `require(` / `fetch(` / `XMLHttpRequest` / `new Image` / `http(s)://` / `cdn.` across `js/`, `index.html`, `style.css`. (`tools/*.cjs` legitimately uses `require` and is outside the browser-loaded surface.) The roll-up also asserts from inside the harness that every `index.html` `src`/`href` is a relative `js/*.js` or `style.css` path.

## Decisions Made

- **Intent-only, physical-key, drain-on-read.** Handlers set a held-code set (`event.code`, layout-independent) and accumulate a mouse delta; `readIntent()` drains the delta so it applies exactly once. This is the property that keeps input decoupled from the frame clock — the thing Plan 02's clamp depends on.
- **The lock check is read at event time.** `mousemove` consults `document.pointerLockElement` on every event, so releasing lock (Escape) stops camera accumulation instantly rather than one frame late.
- **Arrow turn is independent of lock by construction.** The turn slot is derived from the held-key set alone; a comment marks it as the CTRL-03 fallback, and two assertions drive it with a null lock element and after a `pointerlockerror`.
- **Per-event magnitude clamp, not a per-frame clamp.** Clamping each event to `MOUSE_MAX_DX` bounds a single pathological delta while still summing several normal events within one frame — the correct place to bound a refocus spike.
- **The view is disposable and isolated.** `TopDown` writes `buf32`, never presents, floors its cell size to `>= 1`, and routes every write through bounds-checked primitives; Phase 3 replaces it by re-pointing `Game.view` and flipping `TopDown.ENABLED`.

## Deviations from Plan

### Adaptations

**1. [Rule 3 - Blocking] Short unclipped intervals for the run-ratio and per-key symmetry drives (inherited from Plan 02's reasoning)**
- **Found during:** Task 3
- **Issue:** Measuring the run modifier or per-key symmetry over a full second from `openCell` would clip `wallFaceEast` (openCell has ~5.28 cells of eastward room; a full run-second is ~7.8 cells) and corrupt the ratio/negation.
- **Fix:** The run ratio is measured over 0.5 s and the direction/symmetry over 10 frames — both unclipped from `openCell`. The frame-rate-independence drive (forward, 1 s, ~3 cells) stays within the eastward room. Over any equal unclipped interval the RUN_MULT ratio and exact-negation are exact, which is the property under test. This mirrors Plan 02's assertion-9 interval decision.
- **Files modified:** `Doom/Claude Opus 4.8/GSD/tools/verify-phase02.cjs`
- **Verification:** assertions 1.3-1.6 pass with margins far inside tolerance.

Otherwise the plan was executed exactly as written: every locked decision (D-07 intent-only physical-key input with page-scroll suppression and blur reset, D-08 pointer lock from a click preferring unadjusted movement with full lifecycle handling and the arrow-key fallback, D-09 top-down view through the existing framebuffer in its own file behind a flag, D-10 reuse of the Phase 1 framebuffer and load order) is implemented as specified, and every assertion in all three tasks is present.

## Issues Encountered

- Git emitted the usual benign LF->CRLF warnings on Windows. Content is unaffected.

## Known Stubs

None. Every member of the documented `Input` and `TopDown` API is implemented and exercised by the harnesses. `TopDown` is temporary Phase 2 scaffolding by design (D-09), attached through the `Game.view` seam and replaced in Phase 3 by re-pointing one assignment — a documented, wired view, not an unwired stub.

## Threat Flags

None. No new network endpoint, auth path, file access pattern, or trust-boundary schema change beyond the plan's register. All six `mitigate` dispositions are implemented and asserted: T-02-11 (mouse consumed only under lock — 2.3), T-02-12 (per-event `MOUSE_MAX_DX` clamp + non-finite guard, lock-loss zeroes the accumulator — 2.6), T-02-13 (blur + lock-loss + refocus reset the held-key set — 2.7, 1.9), T-02-14 (bounds-checked primitives + cell size `>= 1` under extreme viewports — 4.9), T-02-15 (lock requested only from the click gesture, request wrapped, error only records — 2.2, 2.5), T-02-16 (self-containment negative gate + in-harness relative-path assertion — SC). T-02-17 and T-02-SC are `accept` dispositions.

## Checkpoint Disposition

The plan contains **no** checkpoint tasks — Task 1 is `type="tracer"` and Tasks 2-3 are `type="auto"`. In autonomous mode the tracer feedback gate re-ran the tracer `<verify>` end to end (`ALL_TRACER_CONTRACTS_PASS`) before expansion, and did not halt. The only residue is the human-judgment coverage item **D-08-browser**: the 8-step browser confirmation in Task 3.

## Delegated Browser Confirmation

Everything automatable is done and green. The following live, in-browser qualities that no headless harness can assert are **delegated to the orchestrator's browser pass** (autonomous run, no human available), from BOTH `file://` (double-click `index.html`) and a static server (e.g. `python -m http.server` from the game directory), which must behave identically:

1. The top-down map draws immediately with distinct wall colours, spawn markers, a player dot and a facing ray.
2. W/S/A/D move/strafe and stop dead at walls; Shift sprints (faster, still wall-stopped).
3. Running diagonally into an angled wall **slides** rather than sticking.
4. Clicking the canvas takes pointer lock; mouse left/right rotates the facing + FOV rays smoothly and stops the instant the mouse stops.
5. Escape releases lock — mouse does nothing, but Left/Right arrows still turn (CTRL-03).
6. Tab away while holding W, then back: the map is drawn instantly (no black frame), the player has not teleported or left the level, movement resumes with no stuck key.
7. Resizing (including very wide and very tall) keeps the map centred, fully inside the view, crisp and undistorted.
8. DevTools Console and Network show zero errors and zero requests.

## Next Phase Readiness

- **Phase 3 (raycaster)** swaps the view in three steps documented above: flip `TopDown.ENABLED`, re-point `Game.view = Raycaster` in `main.js`, and honour the view contract (write `buf32`, never present). It consumes the `{dirX,dirY,planeX,planeY}` pose and the `Level.cells` / `Level.WALL_TEXTURES` grid directly.
- The `Input` seam is stable and needs no changes for 3D — the same intent record already carries `mouseDX` for look and the four movement slots.
- No blockers.

## Self-Check: PASSED

All 4 created files (`js/input.js`, `js/topdown.js`, `tools/verify-input-view.cjs`, `tools/verify-phase02.cjs`) and both modified files (`js/main.js`, `index.html`) exist on disk. All 3 task commits (`2cda26e`, `2ea9350`, `9af8841`) exist in git history.

---
*Phase: 02-level-player-movement-input*
*Completed: 2026-07-24*
