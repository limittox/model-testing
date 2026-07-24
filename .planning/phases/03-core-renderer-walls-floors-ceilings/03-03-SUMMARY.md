---
phase: 03-core-renderer-walls-floors-ceilings
plan: 03
subsystem: rendering
tags: [raycaster, floor-casting, ceiling-casting, row-based-cast, flat-color-fallback, distance-shading, canvas2d, uint32-framebuffer, vanilla-js]

# Dependency graph
requires:
  - phase: 03-01
    provides: Raycaster three-pass skeleton, Pass A flat two-tone fill, Game.view swap, zBuffer wall-distance contract
  - phase: 03-02
    provides: shadeFactor/applyShade REND-04 helpers, per-column wall texture sampling, verify-render.cjs harness
provides:
  - Row-based floor/ceiling cast (Pass A) sampling Textures.map.floor/ceiling, distance-shaded per row
  - Real distance-shaded flat-color fallback gated on CONFIG.FLOOR_CAST=false (same shade curve, not dead code)
  - Whole-frame coverage at even AND odd internal height (ceiling mirror skips no row)
  - Extended verify-render.cjs REND-03 assertions (independent floor/ceiling recompute, coverage, fallback, monotonic darkening)
affects: [phase-04-sprites-entities, phase-06-hud, renderer, floor-ceiling]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Row-based floor/ceiling cast: one rowDistance per screen row, linear world-coord walk between leftmost/rightmost ray dirs, mirrored ceiling"
    - "Coverage via y in [horizon,H) with mirror (H-1-y): union is exactly [0,H-1] for both even and odd H — no parity special-case"
    - "FLOOR_CAST flag gates textured-cast vs flat-color fallback; both call the identical shadeFactor(rowDistance,false) so shading is behaviorally identical"
    - "Independent from-the-formula recompute in the harness (byte-exact iterative accumulation) to === the renderer's floor/ceiling pixels"

key-files:
  created: []
  modified:
    - "Doom/Claude Opus 4.8/GSD/js/raycaster.js"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-render.cjs"

key-decisions:
  - "Loop Pass A over y in [horizon,H) (not [horizon+1,H)) and mirror to (H-1-y); the horizon row (p==0) is clamped to p=1 — this guarantees full coverage at odd H where a horizon+1 start would skip the bottom ceiling row"
  - "Whole-frame coverage is asserted with a distinct seeded sentinel (0x0BADF00D), never a CLEAR_COLOR scan — a legitimately-shaded texel can coincidentally equal CLEAR_COLOR, so the sentinel is the only falsifiable coverage probe (same rationale as the existing section-3 check)"
  - "Fallback recomputes rowDistance inline (CONFIG.CAMERA_Z*H)/pf rather than depending on the if-branch's posZ local, keeping each branch self-contained"

patterns-established:
  - "Pattern: full-frame Pass A coverage proven parity-independent by rendering fresh sandboxes at odd (H=201) and even (H=270) internal heights and asserting zero surviving sentinel pixels in BOTH FLOOR_CAST modes"
  - "Pattern: a config flag that selects between two render paths is verified by flipping it in-harness, asserting the alternate path, then restoring the ship default in the same IIFE (no leak into later assertions)"

requirements-completed: [REND-03]

coverage:
  - id: D1
    description: "Row-based floor/ceiling cast (Pass A) samples Textures.map.floor/ceiling with a per-row rowDistance, distance-shaded via shadeFactor/applyShade, filling the whole frame before the wall pass overwrites spans"
    requirement: "REND-03"
    verification:
      - kind: unit
        ref: "tools/verify-render.cjs#11e/11f (rendered floor/ceiling pixel === applyShade(texel,rowShade)) + 11b (sentinel whole-frame coverage)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Real distance-shaded flat-color fallback (CONFIG.FLOOR_CAST=false) fills floor/ceiling with applyShade(FLOOR_COLOR/CEIL_COLOR, rowShade) using the same shade curve — an exercised path, not dead code"
    requirement: "REND-03"
    verification:
      - kind: unit
        ref: "tools/verify-render.cjs#13c/13d/13e (shaded flat pixel exact + differs from raw color) + 13b (coverage) + 13g (flag restored)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Whole-frame coverage (horizon row included, no row skipped) at both odd and even internal height, in both FLOOR_CAST modes"
    requirement: "REND-03"
    verification:
      - kind: unit
        ref: "tools/verify-render.cjs#12a/12b (cast, H=201 odd + H=270 even) + 14a/14b (fallback, both parities)"
        status: pass
    human_judgment: false
  - id: D4
    description: "In-browser visual pass: textured floors/ceilings align to wall base with parallax detail and fog, FLOOR_CAST=false toggle still darkens with distance, no seams on the asymmetric exit arrow, correct on resize, zero console/network errors — from file:// AND a static server"
    requirement: "REND-03"
    verification: []
    human_judgment: true
    rationale: "Visual alignment/parallax/fog readability and file:// vs static-server parity are perceptual judgments no headless harness can make; delegated to the orchestrator's browser pass (autonomous run, no human available)."

# Metrics
duration: ~15min
completed: 2026-07-25
status: complete
---

# Phase 3 Plan 3: Row-Based Floor/Ceiling Casting + Flat-Color Fallback Summary

**Row-based floor/ceiling cast sampling Textures.map.floor/ceiling with a per-row rowDistance, plus a real distance-shaded flat-color fallback behind CONFIG.FLOOR_CAST — both shading by distance through the same shadeFactor, with whole-frame coverage proven at even and odd internal height.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-25
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Replaced the 03-01 tracer's flat two-tone Pass A with a proper row-based floor/ceiling cast (REND-03): one `rowDistance = CAMERA_Z*H/(y-horizon)` per screen row, world coords walked linearly between the leftmost (dir−plane) and rightmost (dir+plane) ray directions, sampling `Textures.map.floor` and the mirrored `Textures.map.ceiling`, each distance-shaded once per row via the 03-02 `shadeFactor`/`applyShade` helpers.
- Added a real distance-shaded flat-color fallback (`CONFIG.FLOOR_CAST === false`) that fills the floor/ceiling halves with `applyShade(FLOOR_COLOR/CEIL_COLOR, rowShade)` — the same shade curve as the textured path, so it darkens with distance identically. Default stays `FLOOR_CAST = true`.
- Guaranteed whole-frame coverage for both parities of internal height: iterating `y` over `[horizon, H)` and mirroring to `(H-1-y)` makes the floor range and ceiling range union to exactly `[0, H-1]` for even AND odd `H`, with the horizon row (`p==0`) clamped to the nearest-row distance to avoid the `(y-horizon)==0` divide.
- Extended `verify-render.cjs` with an independent, byte-exact floor/ceiling recompute and REND-03 assertions covering: sentinel whole-frame coverage, exact floor-vs-ceiling shaded-texel match, monotonic darkening toward the horizon, the fallback path (shaded flat colors distinct from raw), flag restore, and odd/even-H coverage in both modes. Harness now 65/65 → `ALL_RENDER_CONTRACTS_PASS`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Row-based floor/ceiling casting behind CONFIG.FLOOR_CAST (REND-03)** - `5992de8` (feat)
2. **Task 2: Distance-shaded flat-color fallback (CONFIG.FLOOR_CAST === false) (REND-03)** - `8f8a561` (feat)

## Files Created/Modified
- `Doom/Claude Opus 4.8/GSD/js/raycaster.js` - Pass A rewritten: `if (CONFIG.FLOOR_CAST)` row-based textured cast, `else` distance-shaded flat-color fallback; both never touch zBuffer, both run before the wall Pass B overwrites spans.
- `Doom/Claude Opus 4.8/GSD/tools/verify-render.cjs` - Added `expectedFloorRow()` independent recompute helper and REND-03 harness sections 11–14 (textured cast, odd/even-H cast coverage, flat fallback, odd/even-H fallback coverage).

## Decisions Made
- **Loop `[horizon, H)` + mirror, not `[horizon+1, H)`:** the RESEARCH sketch started the cast at `horizon+1` and filled the horizon row separately, but analysis showed that for **even** `H` this leaves the bottom ceiling row (`horizon-1`) unwritten, and the separate horizon-mirror fill collides with the center row for **odd** `H`. Looping `y ∈ [horizon, H)` with the horizon row clamped to `p=1` makes coverage provably complete and disjoint at both parities with no special-casing. This is the W2 odd-H correctness requirement, verified at H=201 and H=270.
- **Sentinel-only coverage probe:** the added coverage assertions use a distinct seeded sentinel (`0x0BADF00D`) rather than scanning for residual `CLEAR_COLOR`. A shaded floor/ceiling texel can legitimately equal `CLEAR_COLOR = packRGBA(24,26,34)`, which would make a CLEAR-scan a flaky false failure; the sentinel is a value the renderer never writes, so surviving it is the only falsifiable "gap" signal (matching the existing section-3 rationale).
- **Byte-exact harness recompute:** `expectedFloorRow()` accumulates `floorX/floorY` iteratively per column (matching the renderer's `+= step` order exactly) so rendered floor/ceiling pixels are compared with `===`, not a tolerance — tying the render path to `Textures.map.floor/ceiling` and the shade helpers with no ULP drift.

## Deviations from Plan

None - plan executed exactly as written. (Both tasks implemented as specified; the loop-range choice above is a correctness refinement of the RESEARCH pseudocode within the plan's own stated W2 odd-H requirement, not a scope change.)

## Issues Encountered
- An initial extra assertion (11c) scanning for residual `CLEAR_COLOR` failed because a legitimately-shaded texel coincided with `CLEAR_COLOR`. Resolved by removing the redundant CLEAR scan and relying on the falsifiable seeded-sentinel coverage check (11b), which is the harness's established coverage method. No renderer change was needed — the sentinel check confirmed the frame was fully written.

## User Setup Required
None - no external service configuration required. Pure client-side renderer code.

## Next Phase Readiness
- The core renderer is complete: walls (REND-01/02/04/06) plus floors and ceilings (REND-03) with a real fallback. The per-column `zBuffer` remains the sole wall-distance producer (floors/ceilings never write it), so **Phase 4 sprites can occlude against `Framebuffer.zBuffer[x]` unchanged**.
- Delegated to the orchestrator's browser pass (autonomous run, no human available): the in-browser visual gate — floor/ceiling meet the wall base cleanly (CAMERA_Z alignment), textured parallax reads, `FLOOR_CAST=false` still darkens with distance, no seams on the exit arrow, correct on resize, zero console/network errors — from both `file://` and a static server.

## Self-Check: PASSED

- Files created/modified exist on disk: `js/raycaster.js`, `tools/verify-render.cjs`, `03-03-SUMMARY.md` — all present.
- Task commits present in history: `5992de8` (Task 1), `8f8a561` (Task 2).
- No stubs / TODO / placeholder patterns in the modified renderer.
- Full render harness: 65/65 assertions, `ALL_RENDER_CONTRACTS_PASS`. All Phase 1/2 harnesses still print their all-pass tokens.

---
*Phase: 03-core-renderer-walls-floors-ceilings*
*Completed: 2026-07-25*
