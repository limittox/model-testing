---
phase: 03-core-renderer-walls-floors-ceilings
plan: 02
subsystem: rendering
tags: [wall-texturing, texx-flip, seam-masking, texpos-unclamped, distance-shading, fog, side-darken, packed-color, fixed-point-shade, headless-harness]

# Dependency graph
requires:
  - phase: 03-core-renderer-walls-floors-ceilings
    plan: 01
    provides: "Raycaster three-pass skeleton (Pass A whole-frame fill, Pass B perpendicular DDA wall cast + zBuffer), the CONFIG fog constants (FOG_FAR/MIN_SHADE/SIDE_SHADE), tools/verify-render.cjs harness with the independent DDA + falsifiability control"
  - phase: 02-level-player-movement-input
    provides: "Level.textureFor / WALL_TEXTURES / cellAt, Textures.map 64x64 buf32 assets (incl. the asymmetric exit arrow), LANDMARKS"
provides:
  - "Raycaster.shadeFactor(dist,isYSide) — integer fixed-point [0,256] linear fog to the MIN_SHADE floor + constant SIDE_SHADE y-side darken"
  - "Raycaster.applyShade(packed,shade) — alpha-preserving little-endian channel scale ((chan*shade)>>8), forces opaque alpha"
  - "Textured, distance-shaded Pass B wall pass: side-flipped texX, power-of-two masking, texPos referenced to the UNCLAMPED span"
  - "verify-render.cjs REND-02/REND-04 assertions (independent expectedWallPixel recompute + asymmetric exit-arrow flip proof) under the same ALL_RENDER_CONTRACTS_PASS token"
affects: [03-03-floor-ceiling-casting, phase-04-sprites-entities]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shade computed ONCE per wall column (perpWall is column-constant) then applied per texel as one packed read + integer multiply-shift + one packed write — no per-pixel float, no allocation"
    - "Fixed-point [0,256] shade so the inner loop avoids float multiplies; alpha forced 0xFF on repack (keeps the 03-01 Pitfall-6 alpha-drop bug from returning)"
    - "Wall texture-column mapping: wallX per side, BOTH side-based texX flips for consistent handedness, texX &= 63 boundary guard, texPos referenced to the unclamped drawStart and advanced over clipped top rows"
    - "Harness independent-recompute idiom extended: a second from-the-formula wall-texel recompute (expectedWallPixel) plus a row-scanning flip discriminator against the asymmetric exit arrow"

key-files:
  created: []
  modified:
    - "Doom/Claude Opus 4.8/GSD/js/raycaster.js"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-render.cjs"

key-decisions:
  - "shadeFactor returns integer fixed-point [0,256] (research Pattern 5) so the hot loop is (chan*shade)>>8, not a float multiply; y-side darken multiplies s by SIDE_SHADE before the *256"
  - "Removed the tracer's solid WALL_COLORS/WALL_FALLBACK table entirely rather than leaving it dead — texturing fully supersedes it; the wall id now selects a texture, not a flat colour"
  - "Flip proof is a ROW-SCANNING discriminator (10f), not a single fixed row: a single fixed row can coincidentally sample equal texels on both columns, so the harness searches the column for a row where the flipped vs unflipped shaded texels genuinely differ and asserts the renderer used the flipped one"

patterns-established:
  - "Compute-shade-once-per-column then per-pixel packed read/scale/write — the shared shade path 03-03 floor/ceiling casting reuses per-row"
  - "expectedWallPixel independent recompute: harness reproduces the renderer's texture math from the formula so a shared bug can't hide"

requirements-completed: [REND-02, REND-04]

coverage:
  - id: T1
    description: "Distance fog + MIN_SHADE floor + constant y-side darken applied once per column; near geometry brighter than far, y-side darker than x-side at equal distance"
    requirement: "REND-04"
    verification:
      - kind: unit
        ref: "tools/verify-render.cjs#9a-9k (helper boundaries, monotonicity, floor clamp, y-side<x-side, alpha, exact rendered pixel, near-vs-far same-face brightness)"
        status: pass
    human_judgment: true
    rationale: "The numeric shade curve is proven; the aesthetic tuning of FOG_FAR/MIN_SHADE/SIDE_SHADE (does far read, are silhouettes visible, is the y-side cue too strong/weak) needs one in-browser pass — delegated to the orchestrator."
  - id: T2
    description: "Each wall column samples the correct texture column with both side-based texX flips (asymmetric exit arrow un-mirrored) and texX/texY within [0,63]"
    requirement: "REND-02"
    verification:
      - kind: unit
        ref: "tools/verify-render.cjs#10a-10g exit-arrow flip proof (independent recompute + row-scanning discriminator) + 9i exact rendered-texel match"
        status: pass
    human_judgment: true
    rationale: "The texX/texY math and the flip are proven exactly headless; the subjective 'textures read as recognizably-Doom, no hairline seams at wall edges' check needs a human eyeball — delegated."
  - id: T3
    description: "Vertical texture step referenced to the UNCLAMPED wall span so a tall near wall shows the correct slice without swimming"
    requirement: "REND-02"
    verification:
      - kind: unit
        ref: "tools/verify-render.cjs#10h (near exit wall overspills screen, lineHeight>H, clamped span — exercises the unclamped-texPos path) + 9i exact match on the tall near stone wall"
        status: pass
    human_judgment: false

# Metrics
duration: ~10min
completed: 2026-07-25
status: complete
---

# Phase 3 Plan 02: Wall Texturing + Distance Shading Summary

**The tracer's flat-colored 3D walls are now textured and depth-shaded: per-column texture sampling with side-flipped texX and power-of-two masking (REND-02), shaded once per column through a fixed-point linear fog curve with a MIN_SHADE floor and a constant y-side darken (REND-04) — proven exactly by an independent headless recompute and an asymmetric-exit-arrow flip discriminator.**

## Performance
- **Duration:** ~10 min
- **Completed:** 2026-07-25
- **Tasks:** 2
- **Files modified:** 2 (0 created)

## Accomplishments
- Two module helpers on `Raycaster`: `shadeFactor(dist, isYSide)` (integer fixed-point `[0,256]` linear fog to the `MIN_SHADE` floor, times `SIDE_SHADE` for y-side columns) and `applyShade(packed, shade)` (unpack/scale `(chan*shade)>>8`/repack in `packRGBA` little-endian layout, alpha forced `0xFF`).
- Pass B wall loop now resolves the hit texture once per column (`Level.textureFor`, `Textures.map.stone` fail-safe), computes the side-flipped `texX` with `& 63` boundary masking, and steps `texY` with a fixed-point accumulator referenced to the **unclamped** wall span (advanced over any clipped top rows). Each texel is one packed read + `applyShade` + one packed write, with the shade computed **once per column**.
- The tracer's crude one-op y-side darken and its solid `WALL_COLORS`/`WALL_FALLBACK` table are gone — fully superseded by the texture + shade path (no dead code left).
- `verify-render.cjs` extended from 24 to 43 assertions (same `ALL_RENDER_CONTRACTS_PASS` token): REND-04 helper + render-path checks, and a REND-02 flip proof built on a second, from-the-formula `expectedWallPixel` recompute plus a row-scanning discriminator against the asymmetric exit arrow.

## Task Commits
1. **Task 1: Distance shading + fog + constant y-side darken (REND-04)** — `265bc9c` (feat)
2. **Task 2: Wall texture-column sampling with side flips + seam masking (REND-02)** — `d805a79` (feat)

## Files Modified
- `js/raycaster.js` — added `Raycaster.shadeFactor` / `Raycaster.applyShade`; replaced the solid wall-column write with per-column texture sampling shaded through those helpers; removed the now-dead `WALL_COLORS` table; updated the file header + Pass B comments.
- `tools/verify-render.cjs` — added the independent `expectedWallPixel` wall-texel recompute; REND-04 section 9 (helper boundaries, monotonicity, floor clamp, y-side < x-side, exact fixed-point relationship, alpha preservation, exact rendered-pixel match, near-vs-far same-face brightness); REND-02 section 10 (row-major exit-wall scan, id-5 hit, texX/texY bounds, exact flipped-texel match, flip-is-load-bearing, row-scanning flip discriminator, unclamped-texPos tall-wall case).

## Implementation Detail (the load-bearing math)
- **shadeFactor:** `s = 1 - dist/FOG_FAR`; clamp `s` to `[MIN_SHADE, 1]`; if y-side `s *= SIDE_SHADE`; return `(s*256)|0`. `shadeFactor(0,false)===256`, `shadeFactor(FOG_FAR,false)===(MIN_SHADE*256)|0=71`, and it never drops below that floor past `FOG_FAR`.
- **applyShade:** `r=(packed&0xFF)*shade>>8`, `g=((packed>>8)&0xFF)*shade>>8`, `b=((packed>>16)&0xFF)*shade>>8`, repack `(0xFF000000|(b<<16)|(g<<8)|r)>>>0`. `applyShade(_,256)` is an identity on rgb and always opaque.
- **texX:** `wallX = side==0 ? py+perpWall*rayDirY : px+perpWall*rayDirX`; `wallX-=floor(wallX)`; `texX=floor(wallX*64)`; flip `if(side==0&&rayDirX>0)` and `if(side==1&&rayDirY<0)` → `texX=63-texX`; then `texX&=63`.
- **texY:** `step=64/lineHeight`; `texPos=(drawStart-horizon+(lineHeight>>1))*step` (=0 for a fully-visible wall); if the top was clipped, `texPos += (clampedStart-drawStart)*step`; per row `texY=(texPos|0)&63; texPos+=step`.
- **write:** `buf32[y*W+x] = applyShade(tex.buf32[(texY<<6)+texX], colShade)` with `colShade = shadeFactor(perpWall, side===1)` hoisted once per column.

## Verification Results
- `node --check js/raycaster.js` clean; `verify-render.cjs` prints `ALL_RENDER_CONTRACTS_PASS` (43/43).
- **REND-04:** helper boundaries exact (256 at camera, floor 71 at/after FOG_FAR), monotonic non-increasing over `[0, 1.5*FOG_FAR]`, y-side `107 < 153` x-side at `0.4*FOG_FAR` and exactly the fixed-point `SIDE_SHADE` scaling, `applyShade` rgb-preserving + opaque; rendered wall pixel equals the independently-recomputed shaded texel exactly; the SAME east wall face is brighter at perpWall 0.5 (lum 328) than at 1.5 (lum 304).
- **REND-02:** the centre column at the row-major-scanned exit face hits id 5; `texX/texY` in `[0,63]`; rendered pixel equals `applyShade(tex.buf32[(texY<<6)+texX], shade)` with both flips; the flip changes the column `32 -> 31`; a row-scanning discriminator (y=9) proves the renderer used the FLIPPED column, not the mirrored one; the near exit wall overspills the screen (`lineHeight 540 > H 270`), exercising the unclamped-texPos path.
- **Falsifiability (manual check, reverted):** temporarily dropping the `side==0 && rayDirX>0` flip makes assertions 9i and 10f FAIL (2 failing, 41/43); restoring returns 43/43 — the flip proof is not vacuous. (10d at its single fixed horizon row happened to sample equal texels on both columns and still passed, which is exactly why the row-scanning 10f is the load-bearing discriminator.)
- **Regression:** all five harnesses green — verify-level (`ALL_LEVEL_CONTRACTS_PASS`), verify-motion (`ALL_MOTION_CONTRACTS_PASS`), verify-input-view (`ALL_TRACER_CONTRACTS_PASS`), verify-phase02 (`ALL_PHASE02_CONTRACTS_PASS`), verify-render (`ALL_RENDER_CONTRACTS_PASS`).

## Threat Mitigations Applied
- **T-03-05 (texel index OOB):** `texX &= 63` after the flip, `texY = (texPos|0) & 63`; index `(texY<<6)+texX` stays in `[0,4095]`. Harness 10c asserts `texX/texY` in `[0,63]`.
- **T-03-06 (R/B swap or dropped alpha):** `applyShade` matches `packRGBA` little-endian layout and forces alpha `0xFF`; harness 9g/9h + 9i/10d compare probed/rendered pixels exactly, and section 3b (carried) asserts every frame pixel opaque.
- **T-03-02 (NaN/negative perpWall into shadeFactor):** perpWall is EPS-floored in Pass B before `shadeFactor` sees it, and `shadeFactor` clamps `s` to `[MIN_SHADE,1]`; carried assertions 2c/6 re-assert no NaN in zBuffer/buf32.
- **T-03-04 (breaks file://):** classic script only, no per-frame allocation, no present in the view; carried self-containment assertion (section 8) over `js/raycaster.js` stays green.
- **T-03-SC (supply chain):** no dependencies added — code-only edit to two existing self-contained files.

## Deviations from Plan
**1. [Rule 2 - Missing critical correctness] Removed the dead solid `WALL_COLORS`/`WALL_FALLBACK` table**
- **Found during:** Task 2
- **Issue:** The plan said "replace the solid base-color wall write with per-column texture sampling" but did not explicitly say to delete the now-unreferenced `WALL_COLORS`/`WALL_FALLBACK` table and its render locals. Leaving them would be dead code.
- **Fix:** Removed the table, the fallback, and the hoisted `wallColors`/`wallFallback` locals; updated the object + Pass B comments to say the wall id now selects a texture. The Task-1 harness check (9i) that had computed the expected pixel from `WALL_COLORS` was rewritten to the independent texel recompute at the same time (it had to change anyway once walls became textured).
- **Files modified:** js/raycaster.js, tools/verify-render.cjs
- **Committed in:** d805a79 (Task 2)

**2. [Rule 1 - Test robustness] Flip proof made a row-scanning discriminator, not a single fixed row**
- **Found during:** Task 2 (falsifiability self-check)
- **Issue:** A single fixed-row exact-match (10d at the horizon) can coincidentally sample equal texels on the flipped and unflipped columns, so a dropped flip would NOT always fail that one assertion.
- **Fix:** Added 10f/10g which scan the visible column for a row where the flipped vs unflipped shaded texels genuinely differ and assert the renderer used the flipped one — a deterministic, non-vacuous flip proof. Confirmed by the manual falsifiability revert (dropping the flip fails 10f).
- **Files modified:** tools/verify-render.cjs
- **Committed in:** d805a79 (Task 2)

**Total deviations:** 2 (1 dead-code removal, 1 test-robustness hardening). No scope creep, no new dependencies, no architectural change.

## Known Stubs
None. No hardcoded empty values, placeholders, or TODO/FIXME markers in the modified files (scanned).

## Delegated to Orchestrator (in-browser visual pass)
Autonomous run, no human available — the automated proofs are complete but these subjective/visual checks (and the aesthetic constant tuning) need one `file://` + static-server open, delegated to the orchestrator:
1. Walls are textured with the five materials and read as recognizably-Doom, not flat colors.
2. Distance fog fades far geometry smoothly toward the ambient; near geometry stays readable (`MIN_SHADE` floor) — tune `FOG_FAR`/`MIN_SHADE` if too dark or too flat.
3. Y-side walls are visibly (but not jarringly) darker than x-side walls — tune `SIDE_SHADE` if the depth cue is too strong/weak.
4. The exit wall's arrow is NOT mirrored across corners and no hairline texture seams appear at wall edges.
5. DevTools Console and Network show zero errors and zero requests; `file://` and a static server behave identically.

Any constant change flags back to `CONFIG` (FOG_FAR / MIN_SHADE / SIDE_SHADE).

## Next Phase Readiness
- The shared once-per-column shade path and the texture-sampling loop are in place and proven — 03-03 (floor/ceiling casting) reuses `shadeFactor`/`applyShade` per row and refines Pass A behind `CONFIG.FLOOR_CAST` without touching Pass B.
- Phase 4 sprite occlusion still consumes the unchanged, verified per-column perpendicular `zBuffer`.
- No blockers.

## Self-Check: PASSED
- Modified files present: js/raycaster.js, tools/verify-render.cjs, 03-02-SUMMARY.md
- Task commits present: 265bc9c (Task 1), d805a79 (Task 2)

---
*Phase: 03-core-renderer-walls-floors-ceilings*
*Completed: 2026-07-25*
