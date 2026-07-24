---
phase: 03-core-renderer-walls-floors-ceilings
plan: 01
subsystem: rendering
tags: [raycaster, dda, perpendicular-distance, z-buffer, view-swap, tracer, canvas2d, uint32-framebuffer]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "Framebuffer (buf32 + zBuffer + width/height + present), CONFIG/packRGBA, the Game.view seam and single putImageData"
  - phase: 02-level-player-movement-input
    provides: "Level (isSolid/cellAt/WALL_TEXTURES/LANDMARKS + lineOfSight DDA idiom), Player vector camera pose, TopDown view + boot.cjs harness"
provides:
  - "Raycaster global: a first-person software raycaster wired to Game.view (Pass A whole-frame fill + Pass B perpendicular DDA wall cast)"
  - "Per-column perpendicular depth buffer (Framebuffer.zBuffer[x]) written every column — the REND-06 producer Phase 4 sprite occlusion consumes"
  - "Six renderer CONFIG constants (FLOOR_CAST, CAMERA_Z, FOG_FAR, MIN_SHADE, SIDE_SHADE, FOG_COLOR)"
  - "tools/verify-render.cjs headless render-contract harness with a falsifiable no-fisheye control and an independent z-buffer DDA recompute"
affects: [03-02-wall-texturing, 03-03-floor-ceiling-casting, phase-04-sprites-entities]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Three-pass render skeleton: Pass A fills the whole frame first, Pass B overwrites wall spans and writes the z-buffer (texturing/floor-cast are functionality fills, not architecture changes)"
    - "Perpendicular wall distance (sideDist - deltaDist) as the anti-fisheye — never Euclidean/hypot"
    - "1e30 finite axis-ray sentinel + EPS perpWall floor + WIDTH+HEIGHT+2 DDA iteration cap (mirrors Level.lineOfSight)"
    - "Live Framebuffer.width/height read every render() (aspect-derived height in [200,480]); no per-frame allocation in the hot loop"
    - "Falsifiable headless verification: an independent second-copy DDA + a discriminating Euclidean control that must vary where the real check is flat"

key-files:
  created:
    - "Doom/Claude Opus 4.8/GSD/js/raycaster.js"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-render.cjs"
  modified:
    - "Doom/Claude Opus 4.8/GSD/js/config.js"
    - "Doom/Claude Opus 4.8/GSD/index.html"
    - "Doom/Claude Opus 4.8/GSD/js/main.js"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-input-view.cjs"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-phase02.cjs"

key-decisions:
  - "y-side depth cue OR-backs an opaque alpha (0xFF000000 | ((color>>1)&0x7F7F7F)) — Lodev's bare mask drops the high alpha byte in our ARGB packing and would render y-side walls transparent (Pitfall 6)"
  - "Whole-frame coverage assertion uses a DISTINCT pre-seeded sentinel (0x12345678), not CLEAR_COLOR, so an unwritten 0x00000000 pixel cannot pass the check silently (harness hardening W1)"
  - "Phase 2 regression harnesses updated to the intentional view swap: Game.view is the Raycaster, TopDown is disabled but retained and exercised directly as a debug toggle"

patterns-established:
  - "Pass A/Pass B render skeleton established here so 03-02 (texturing) and 03-03 (floor/ceiling cast) are functionality fills"
  - "Independent-recompute + falsifiability-control harness idiom for numerically-load-bearing render checks"

requirements-completed: [REND-01, REND-06]

coverage:
  - id: D1
    description: "Raycaster renders the level first-person with perpendicular-distance wall columns and NO fisheye (a flat front-facing wall yields a constant zBuffer band)"
    requirement: "REND-01"
    verification:
      - kind: unit
        ref: "tools/verify-render.cjs#1b/1c no-fisheye perpendicular-constant vs Euclidean-varies control"
        status: pass
    human_judgment: true
    rationale: "Automated proof of the perpendicular-distance invariant is complete, but the subjective in-browser look (no visible fisheye on a long wall as the player turns, fog-constant tuning) needs a human eyeball on a file:// open — delegated to the orchestrator."
  - id: D2
    description: "Framebuffer.zBuffer[x] holds the perpendicular wall distance for every column, finite and strictly > 0, matching an independent DDA to 1e-6 (REND-06 producer for Phase 4)"
    requirement: "REND-06"
    verification:
      - kind: unit
        ref: "tools/verify-render.cjs#2a/2b/2c independent perpendicular DDA recompute + finite/positive"
        status: pass
    human_judgment: false
  - id: D3
    description: "Game.view swapped to Raycaster; the view writes buf32 + zBuffer and never presents; Game.render presents exactly once per frame; TopDown disabled but retained"
    verification:
      - kind: unit
        ref: "tools/verify-render.cjs#0a-0d/4a-4b + verify-phase02.cjs#4.4/4.5"
        status: pass
    human_judgment: false
  - id: D4
    description: "Robustness: axis-aligned facings and two viewport aspect ratios (incl. odd internal height) produce no NaN and no out-of-range write; renders are deterministic; whole frame painted, all pixels opaque"
    verification:
      - kind: unit
        ref: "tools/verify-render.cjs#3a/3b/5/6a-6b/7a-7c"
        status: pass
    human_judgment: false

# Metrics
duration: ~35min
completed: 2026-07-25
status: complete
---

# Phase 3 Plan 01: Raycaster Tracer Summary

**Perpendicular-distance DDA raycaster wired to Game.view — solid-shaded first-person wall columns with a per-column z-buffer, proven no-fisheye and z-buffer-correct by a falsifiable headless harness.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-24T23:25Z (approx)
- **Completed:** 2026-07-24T14:00Z (2026-07-25 local)
- **Tasks:** 2
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments
- New `Raycaster` view replaces the top-down debug view as the default render path: the level now renders in first-person 3D.
- Per-column DDA wall cast using **perpendicular** distance (`sideDist - deltaDist`) — the anti-fisheye — with the `1e30` axis-ray sentinel, an `EPS` perpWall floor, and a `WIDTH+HEIGHT+2` iteration cap mirroring `Level.lineOfSight`.
- `Framebuffer.zBuffer[x]` written for **every** column with the perpendicular distance (REND-06) — the depth producer Phase 4 sprite occlusion consumes.
- Three-pass render skeleton established (Pass A fills the whole frame, Pass B overwrites wall spans + writes zBuffer) so 03-02 texturing and 03-03 floor/ceiling casting are functionality fills, not re-architectures.
- `tools/verify-render.cjs` (24 assertions, `ALL_RENDER_CONTRACTS_PASS`): a falsifiable no-fisheye check (constant perpendicular band while an independent Euclidean recompute visibly varies) and an independent second-copy perpendicular DDA reproducing the z-buffer to 1e-6.

## Task Commits

Each task was committed atomically:

1. **Task 1: Raycaster wall pass + CONFIG constants + Game.view swap + wiring** - `f07a663` (feat)
2. **Task 2: Headless render-contract harness (no-fisheye + independent z-buffer DDA)** - `93d5877` (test; includes the Rule 1 alpha fix and Rule 3 regression-harness updates)

## Files Created/Modified
- `js/raycaster.js` (created) - The `Raycaster` view: Pass A whole-frame two-tone fill + Pass B per-column perpendicular DDA wall cast, solid-shaded columns with a y-side depth cue, z-buffer write, no present.
- `tools/verify-render.cjs` (created) - Headless render-contract harness on `boot.cjs`: REND-01 falsifiable no-fisheye, REND-06 independent z-buffer DDA, whole-frame coverage (W1), two aspect ratios incl. odd height (W2), present/determinism/axis-ray robustness, self-containment.
- `js/config.js` (modified) - Six renderer constants: `FLOOR_CAST`, `CAMERA_Z` (load-bearing 0.5), `FOG_FAR`/`MIN_SHADE`/`SIDE_SHADE` (aesthetic tunables), `FOG_COLOR`.
- `index.html` (modified) - Loads `js/raycaster.js` after `topdown.js` and before `game.js`; load-order contract comment extended to 12 scripts.
- `js/main.js` (modified) - `Game.view = Raycaster`, `TopDown.ENABLED = false` (TopDown kept loaded as a debug toggle).
- `tools/verify-input-view.cjs` (modified) - Updated the Plan 03 tracer harness for the view swap (12-script order, Raycaster is the active view, TopDown exercised directly).
- `tools/verify-phase02.cjs` (modified) - Updated criterion 4 for the view swap; the top-down pose checks now render TopDown directly.

## Decisions Made
- **Opaque-alpha y-side cue:** our framebuffer packs alpha in the high byte (`0xAARRGGBB`), so Lodev's bare `(color>>1)&0x7F7F7F` zeroes alpha. The cue OR-backs `0xFF000000` to keep walls opaque.
- **Distinct coverage sentinel:** pre-seed `buf32` with `0x12345678` (a value the renderer never writes) before the whole-frame coverage assertion, so a stale/unwritten `0x00000000` pixel cannot slip through.
- **Odd internal height in W2:** boot at `1000x419` (derives `H=201`) so `horizon = H>>1` truncation is exercised, alongside `1280x720` (270) and `900x900` (480, clamp boundary).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] y-side depth cue dropped the alpha byte (transparent walls)**
- **Found during:** Task 2 (while designing the opacity assertion)
- **Issue:** The plan's literal snippet `(color >> 1) & 0x7F7F7F` is Lodev's trick for `0x00RRGGBB` colors. In this repo's little-endian ARGB packing, alpha is the high byte; `& 0x7F7F7F` masks it to `0x00`, so every side==1 wall pixel becomes fully transparent (Pitfall 6). `putImageData` would composite the page background through those columns.
- **Fix:** `if (side === 1) color = (0xFF000000 | ((color >> 1) & 0x7F7F7F)) >>> 0;` — halves the RGB channels while forcing opaque alpha.
- **Files modified:** js/raycaster.js
- **Verification:** verify-render.cjs assertion 3b (every framebuffer pixel alpha 0xFF) + 6a2/6b2 fail with the original snippet, pass after the fix.
- **Committed in:** 93d5877 (Task 2 commit)

**2. [Rule 3 - Blocking] Phase 2 regression harnesses encoded the pre-swap view**
- **Found during:** Task 2 (running the regression suite)
- **Issue:** verify-input-view.cjs and verify-phase02.cjs hardcoded `Game.view === TopDown` / `TopDown.ENABLED === true` and an 11-script load order — a Phase 2 state this tracer intentionally supersedes. Four/three assertions respectively failed purely because of the deliberate view swap.
- **Fix:** Updated the stale view-coupled assertions to the new reality (Raycaster is the active view; 12-script order) while preserving input/motion/level coverage and still exercising the retained TopDown view by calling `TopDown.render()` directly (proving the debug toggle still works).
- **Files modified:** tools/verify-input-view.cjs, tools/verify-phase02.cjs
- **Verification:** both harnesses now print their all-pass tokens (17/17 and 38/38).
- **Committed in:** 93d5877 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** The alpha fix is a correctness requirement (opaque framebuffer contract). The harness updates keep the regression suite green under the intended view swap without weakening coverage. No scope creep — no new features, no dependencies.

## Issues Encountered
None beyond the two deviations above. All five harnesses pass: verify-level (56/56), verify-motion (22/22), verify-input-view (17/17), verify-phase02 (38/38), verify-render (24/24).

## Verification Results
- **REND-01 (no fisheye):** perpendicular zBuffer band spread `0.00e+0` (< 1e-3) across the flat named east wall face; the independent Euclidean recompute over the SAME band spread `9.91e-2` (> 1e-2) — the control proves the test discriminates.
- **REND-06 (z-buffer):** all 480 columns written; matches the independent perpendicular DDA to max err `4.29e-7` (< 1e-6); every value finite and > 0.
- **Contract:** direct `Raycaster.render()` does not present; one `raf.step()` presents exactly once; two renders byte-identical (determinism); axis-aligned `setDir(1,0)`/`(0,1)` produce no NaN; three aspect ratios (H = 201/270/480) render in range with no out-of-range write.

## Delegated to Orchestrator (in-browser visual pass)
The automated proofs are complete, but the following subjective/visual checks require a human `file://` open and are **delegated to the orchestrator** (no human was available during autonomous execution):
- Confirm the 3D actually **looks** right — a long wall reads flat with no visible fisheye bulge as the player turns.
- Tune the aesthetic fog constants (`FOG_FAR`, `MIN_SHADE`, `SIDE_SHADE`) — these are eyeballed starting points that need one in-browser pass.
- Confirm the y-side depth cue reads as intended (side walls visibly darker, fully opaque).

Note: this tracer draws SOLID-shaded (untextured) walls and a flat two-tone floor/ceiling. Texturing (03-02) and row-based floor/ceiling casting (03-03) expand from this proven slice.

## Next Phase Readiness
- The three-pass skeleton, the perpendicular DDA, and the per-column z-buffer are in place and verified — 03-02 (wall texturing) replaces the solid column fill with the sampled/fog-shaded texel; 03-03 (floor/ceiling casting) refines Pass A behind `CONFIG.FLOOR_CAST`.
- Phase 4 sprite occlusion has a correct, finite, per-column perpendicular depth buffer to consume.
- No blockers.

## Self-Check: PASSED
- Created files present: js/raycaster.js, tools/verify-render.cjs, 03-01-SUMMARY.md
- Task commits present: f07a663 (Task 1), 93d5877 (Task 2)

---
*Phase: 03-core-renderer-walls-floors-ceilings*
*Completed: 2026-07-25*
