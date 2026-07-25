---
phase: 04-sprite-rendering-entities
plan: 02
subsystem: rendering
tags: [raycaster, billboards, sprites, z-buffer, occlusion, fog-shading, transparency, canvas2d]

# Dependency graph
requires:
  - phase: 04-01
    provides: "Entities billboard list + sprite pass (projection, far->near sort, first per-column z-buffer occlusion cut, alpha-key transparency), Raycaster.spritePass seam, verify-sprites.cjs harness"
  - phase: 03-core-renderer-walls-floors-ceilings
    provides: "Raycaster.shadeFactor(dist,isYSide)/applyShade(packed,shade) fog helpers (alpha-forced-opaque), per-column Framebuffer.zBuffer perpendicular wall distance"
  - phase: 02-assets-level-player-input
    provides: "Sprites.map.{enemy,pickup} baked binary alpha + ALPHA_KEY=128, Level.spawns, Player vector camera pose"
provides:
  - "Sprite depth fog: each written sprite texel shaded by transformY via the SAME shadeFactor/applyShade curve as walls (alpha-key tested on raw texel BEFORE shading; written texels forced opaque)"
  - "Hardened partial-wall per-column clipping: one billboard straddling a wall edge is clipped column-by-column against the live zBuffer (near-side drawn, far-side occluded)"
  - "Falsifiable proofs (verify-sprites.cjs 59/59): partial-wall per-column clip (drawn cols == predicted visible+opaque, occluded cols draw zero, +inf-zbuffer control), depth-shade (exact applyShade equality + monotonic near>far fog), no-halo transparency (source-alpha characterization, no fringe), back-to-front sort overlap (nearer wins, list-order-swap control)"
affects: [05-enemies-ai-combat]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-entity depth shade hoisted once above the stripe loop (transformY is constant for a whole billboard), mirroring the wall pass computing colShade once per column"
    - "Sprites fog with the SHARED shadeFactor/applyShade so a distant enemy fades identically to the wall behind it; alpha-key transparency tested on the RAW texel before shading"
    - "Robust pixel proofs: identify written pixels via independent source-alpha recompute + exact shaded-texel equality, never pure background-diff value inequality (addresses plan-checker advisory)"

key-files:
  created: []
  modified:
    - "Doom/Claude Opus 4.8/GSD/js/entities.js"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-sprites.cjs"

key-decisions:
  - "Fog shade computed ONCE per entity (transformY constant per billboard) and applied only to the WRITTEN texel; the alpha-key skip runs on the raw packed texel so shading can neither resurrect a skipped texel nor blank a written one (threat T-04-04)"
  - "No production change was needed for occlusion, transparency, or sort — the tracer's per-column occlusion test and far->near sort were already correct; Task 2 added only falsifiable proofs"
  - "No-halo proof characterizes EVERY in-box pixel by source alpha (opaque => equals applyShade(raw,shade) and opaque dest; transparent => bg byte-for-byte intact), avoiding any reliance on background-diff value inequality"

patterns-established:
  - "Partial-wall clip proof: a single billboard straddling an isolated pillar edge, with drawn==predicted-visible-and-opaque, occluded==zero, and a +inf-zBuffer no-wall control"
  - "Sort-overlap proof: two same-bearing enemies at different depths, nearer wins at contested pixels, with a list-order-swap control proving distance (not list index) drives layering"

requirements-completed: [ENT-02, ENT-03]

coverage:
  - id: D1
    description: "Distant sprites fog-shade with depth via the shared shadeFactor/applyShade (same curve as walls); written texels forced opaque, transparent texels skipped before shading"
    requirement: "ENT-03"
    verification:
      - kind: integration
        ref: "tools/verify-sprites.cjs#6c,6e,6g (exact applyShade equality + RAW-differs control + monotonic near>far brightness)"
        status: pass
      - kind: manual_procedural
        ref: "in-browser visual pass (distant sprites visibly darken like walls) — delegated to orchestrator"
        status: unknown
    human_judgment: true
    rationale: "The harness proves the shade math is the shared wall curve exactly and that far is dimmer than near; whether the on-screen fog READS as consistent with the wall behind it needs a human eye in a real browser."
  - id: D2
    description: "Partial walls clip a single billboard PER COLUMN via the z-buffer — near-side columns drawn, far-side columns occluded"
    requirement: "ENT-02"
    verification:
      - kind: integration
        ref: "tools/verify-sprites.cjs#5c,5e,5f,5h,5i (straddle split, drawn==predicted visible+opaque, occluded==zero, +inf-zbuffer no-wall control)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Overlapping sprites layer nearest-on-top via the back-to-front sort (nearer texels win in the overlap region)"
    requirement: "ENT-02"
    verification:
      - kind: integration
        ref: "tools/verify-sprites.cjs#8b,8c,8d,8f (505 contested pixels, nearer wins, _order far->near, list-order-swap control)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Transparency is halo-free — transparent texels leave the background byte-for-byte intact, written texels are fully opaque"
    requirement: "ENT-03"
    verification:
      - kind: integration
        ref: "tools/verify-sprites.cjs#7c,7d,7e,7f (non-vacuity control, opaque-source==applyShade, written opaque, transparent-source leaves bg intact)"
        status: pass
    human_judgment: false

# Metrics
duration: 14min
completed: 2026-07-25
status: complete
---

# Phase 4 Plan 02: Sprite Clipping, Transparency & Fog Summary

**Sprite texels now fog-shade by depth through the shared wall shadeFactor/applyShade curve, a single billboard is clipped per-column against partial walls, and four falsifiable proofs (partial-wall clip, depth shade, no-halo transparency, back-to-front sort overlap) lock the phase's hardest correctness properties — verify-sprites 59/59, full Phase 1-3 regression green.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-07-25
- **Completed:** 2026-07-25
- **Tasks:** 2
- **Files modified:** 2 (0 created, 2 modified)

## Accomplishments
- **Fog shading (fills the 04-01 tracer gap):** `Entities.render()` now computes `spriteShade = shadeFactor(transformY, false)` ONCE per entity (transformY is constant for a whole billboard, hoisted above the stripe loop exactly as the wall pass computes colShade once per column) and writes each opaque texel as `applyShade(packed, spriteShade)`. The alpha-key transparency skip runs on the RAW packed texel BEFORE shading, so shading can neither resurrect a skipped texel nor blank a written one; applyShade forces the written texel opaque. Sprites fog with the identical curve walls use, so a distant enemy fades consistently with the wall behind it.
- **Partial-wall per-column clip (hardened + proven):** confirmed the occlusion test is evaluated INSIDE the stripe loop against the LIVE `zbuf[stripe]` for every column, with all index math clamped (`stripe` in `[0,W)`, `texX` in `[0,TEXW-1]`, rows in `[drawStartY,drawEndY)`, `texY` in `[0,TEXH-1]`) — a single billboard straddling a wall edge has its far-side columns skipped and near-side columns drawn. The sprite pass still never writes zBuffer.
- **Four falsifiable proofs added to `verify-sprites.cjs`** (31 -> 59 assertions):
  - *Partial-wall clip (5a-5i):* one enemy straddling the isolated pillar at cell (6,6) splits into 19 visible + 19 occluded columns; drawn columns EXACTLY equal the predicted visible-and-opaque set, every occluded column draws zero, and a +inf-zBuffer control shows the same entity then draws ALL its in-bounds opaque columns.
  - *Depth shade (6a-6g):* a drawn far pixel equals `applyShade(raw, shadeFactor(transformY,false))` exactly; far mean drawn brightness (82.2) is strictly less than near (142.2); a control confirms the raw texel differs from the shaded pixel (shading is applied, not a no-op).
  - *No-halo transparency (7a-7f):* every in-box pixel characterized by source alpha — opaque-source pixels equal the shaded texel and are fully opaque (0xFF), transparent-source pixels leave the background byte-for-byte intact; a non-vacuity control confirms the box holds 2079 opaque + 2410 transparent texels.
  - *Back-to-front sort overlap (8a-8f):* two same-bearing enemies at d=4 and 2d=8 produce 505 contested pixels where the nearer wins; `Entities._order` is far->near; a list-order-swap control (same positions, list reordered to `[far,near]`) shows the nearer STILL wins, proving distance (not list index) drives layering.

## Task Commits

Each task was committed atomically:

1. **Task 1: Sprite fog shading + partial-wall per-column clipping (harden + prove)** - `6ac5853` (feat)
2. **Task 2: Clean transparency (no-halo) proof + back-to-front sort overlap proof** - `26e9679` (test)

## Files Created/Modified
- `Doom/Claude Opus 4.8/GSD/js/entities.js` - Hoisted shadeFactor/applyShade to locals; compute per-entity depth shade once; write each opaque texel via `applyShade(packed, spriteShade)`; updated header to document the fog fill.
- `Doom/Claude Opus 4.8/GSD/tools/verify-sprites.cjs` - Made assertion 2j shade-aware; added the partial-wall clip proof (§5), depth-shade proof (§6), no-halo transparency proof (§7), and back-to-front sort overlap proof (§8) with helpers `predictedDrawnColumns`, `meanShadedBrightness`, `opaqueTexelAt`, `setsEqual`.

## Decisions Made
- **Shade once per entity, apply per texel:** transformY is constant for a whole billboard, so the depth shade is hoisted above the stripe loop (mirrors the wall pass). Only the WRITTEN texel is shaded; the alpha-key skip stays on the raw texel.
- **No production change for occlusion/transparency/sort:** the tracer's per-column occlusion test and far->near sort were already correct, so Task 2 added only proofs. Had any proof failed, the fix would have gone into `js/entities.js`, not a weakened assertion — none did.
- **Value-inequality-free proofs (plan-checker advisory):** the no-halo and sort-overlap proofs identify written pixels via an independent source-alpha recompute plus exact shaded-texel equality, and the transparency proof asserts transparent-source pixels equal the background byte-for-byte — so a shaded-equals-background coincidence cannot false-negative.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Made harness assertion 2j shade-aware**
- **Found during:** Task 1 (first harness run after adding fog shading)
- **Issue:** The 04-01 assertion 2j asserted a drawn front-sprite pixel equals the RAW (unshaded) source texel. Once fog shading landed, the drawn pixel is `applyShade(raw, shade)`, so 2j failed (30/31) — the assertion encoded the tracer's now-superseded unshaded behavior.
- **Fix:** Updated 2j to expect `applyShade(raw, shadeFactor(transformY,false))`, tying the render to the shared shade helpers with no ULP drift. No assertion weakened — the check is now stronger (exact shaded equality).
- **Files modified:** Doom/Claude Opus 4.8/GSD/tools/verify-sprites.cjs
- **Verification:** verify-sprites.cjs returns 59/59 ALL_SPRITE_CONTRACTS_PASS.
- **Committed in:** `6ac5853` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — an existing assertion that encoded the deliberately-superseded unshaded tracer behavior).
**Impact on plan:** Expected and necessary — the plan explicitly fills the tracer's unshaded gap, which changes the drawn-pixel value the old 2j checked. No scope creep.

## Issues Encountered
None — the projection, occlusion, transparency, and sort math were already correct from 04-01; all new proofs (including every falsifiability control) passed once the geometry was selected. Partial-wall straddle geometry (player at (3.5,8.5) facing setDir(1,-1), enemy at (8.5,3.5), pillar at cell (6,6)) and the sort-overlap geometry (same-bearing enemies at d=4/2d=8 giving 505 contested pixels) were found by a brief empirical scan before hardcoding.

## Threat Mitigations Verified
- **T-04-04 (fog-shade alpha handling):** applyShade forces alpha 0xFF and preserves the packRGBA layout; the alpha-key test runs on the raw texel BEFORE shading. Proven by §7d/§7e (written pixels equal the shaded texel and are opaque) and §7f (transparent texels untouched).
- **T-04-05 (partial-edge index math):** per-column stripe/texX/row/texY clamps. Proven by §5 driving columns to the wall/screen edge with no out-of-range write.
- **T-04-06 (occlusion bypass / sprite shows through wall):** per-column `transformY < zBuffer[stripe]` retested against live wall depth. Proven by §5f (every occluded column draws zero).

## Verification

Automated (all exit 0):
- `node "Doom/Claude Opus 4.8/GSD/tools/verify-sprites.cjs"` -> `ALL_SPRITE_CONTRACTS_PASS` (59/59), including the partial-wall per-column clip (§5), depth-shade (§6), no-halo transparency (§7), and back-to-front sort overlap (§8) proofs with their falsifiability controls.
- Full Phase 1-3 regression green: verify-render 65/65 (`ALL_RENDER_CONTRACTS_PASS`), verify-level 56/56, verify-motion 22/22, verify-input-view 17/17, verify-phase02 38/38.
- `node --check` clean on js/entities.js and tools/verify-sprites.cjs.
- Self-containment preserved: no new script, no ES module, no network load; only js/entities.js and the node-only harness changed.

Delegated to the orchestrator (in-browser visual pass, rAF-throttle caveat):
- On a non-composited/headless open the rAF loop does not tick — drive one frame manually (`Game.view.render(0)` then `Framebuffer.present()`). From `file://` AND a static server, confirm: sprite edges are crisp with NO halo/fringe against walls, floor, or fog; a sprite partly behind a wall corner is clipped cleanly at the edge (not floating over it); when two sprites overlap the nearer is drawn on top; distant sprites visibly fog/darken like the walls; pickups rest ON the floor; zero console/network errors.

## Known Stubs
None — the 04-01 fog-shading stub is now resolved. Sprite texels are depth-shaded through the shared wall curve; no placeholder or unshaded path remains.

## Next Phase Readiness
- Phase 5 (enemy AI/combat) can add behaviour fields to the entity objects and mutate `Entities.list`; the sprite pass re-sorts far->near and re-reads the live pose + zBuffer every frame, so moving/occluded/overlapping enemies render correctly with no render-side change. A per-entity tint/hurt-flash hook can layer on top of `spriteShade` (multiply a second factor) without touching the projection/occlusion path.
- All three Phase 4 requirements (ENT-01 from 04-01; ENT-02, ENT-03 from this plan) are proven headlessly; only the human visual pass remains, delegated to the orchestrator.

## Self-Check: PASSED
- FOUND: js/entities.js, tools/verify-sprites.cjs, 04-02-SUMMARY.md
- FOUND commits: 6ac5853 (Task 1), 26e9679 (Task 2)

---
*Phase: 04-sprite-rendering-entities*
*Completed: 2026-07-25*
