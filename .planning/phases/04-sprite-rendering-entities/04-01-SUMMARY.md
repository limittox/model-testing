---
phase: 04-sprite-rendering-entities
plan: 01
subsystem: rendering
tags: [raycaster, billboards, sprites, z-buffer, occlusion, canvas2d, uint32-framebuffer]

# Dependency graph
requires:
  - phase: 03-core-renderer-walls-floors-ceilings
    provides: "Raycaster.render() three-pass renderer, per-column Framebuffer.zBuffer (perpendicular wall distance), shadeFactor/applyShade helpers, single present() in Game.render"
  - phase: 02-assets-level-player-input
    provides: "Level.spawns marker list, Sprites.map.{enemy,pickup} with baked binary alpha + ALPHA_KEY, Player vector camera pose"
provides:
  - "Entities global: spawn-derived static billboard list (Level.spawns -> {x,y,sprite,scale,onFloor})"
  - "Entities.render sprite pass: Lodev billboard projection, allocation-free far->near insertion sort, per-column z-buffer occlusion cut, alpha-key transparency"
  - "Raycaster.spritePass seam: sprite pass runs as the last statement of Raycaster.render(), after the wall pass fills zBuffer, before the single present"
  - "tools/verify-sprites.cjs: falsifiable headless sprite-contract harness (ALL_SPRITE_CONTRACTS_PASS)"
affects: [05-enemies-ai-combat, 04-02-sprite-clipping-transparency-fog]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sprite pass as a nullable seam (Raycaster.spritePass) invoked at the end of render() — keeps Game.view === Raycaster and one present per frame"
    - "Allocation-free far->near depth sort via preallocated Int32Array index array + Float64Array squared-distance, in-place insertion sort (no Array.sort closure)"
    - "Billboard projection uses screen HEIGHT for BOTH width and height scale so sprites stay square on any viewport aspect"
    - "Sprites READ Framebuffer.zBuffer for per-column occlusion, NEVER write it (matches Doom; back-to-front sort resolves sprite-vs-sprite)"

key-files:
  created:
    - "Doom/Claude Opus 4.8/GSD/js/entities.js"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-sprites.cjs"
  modified:
    - "Doom/Claude Opus 4.8/GSD/js/raycaster.js"
    - "Doom/Claude Opus 4.8/GSD/index.html"
    - "Doom/Claude Opus 4.8/GSD/js/main.js"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-render.cjs"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-input-view.cjs"

key-decisions:
  - "Sprite pass is UNSHADED in this tracer; fog-shading via shadeFactor/applyShade by transformY is deferred to 04-02 (documented functionality gap, not an architecture gap)"
  - "spritePass is disabled in verify-render.cjs after fireLoad() so the Phase-3 exact-pixel wall/floor contracts stay unperturbed; sprite contracts live in verify-sprites.cjs"
  - "Draw-bound integers are floored from the unclamped float origins; the unclamped originX/originY are retained for texel mapping (same discipline as the wall pass texPos)"

patterns-established:
  - "Nullable render seam: an optional pass wired by main.js and disabled in the isolation harness"
  - "Falsifiable pixel proof: identify sprite-drawn pixels by bg-vs-cur diff AND cross-check against an independent source-alpha recompute + raw-texel equality"

requirements-completed: [ENT-01, ENT-02]

coverage:
  - id: D1
    description: "Enemy and pickup entities built from Level.spawns project into the 3D view as camera-facing billboards"
    requirement: "ENT-01"
    verification:
      - kind: integration
        ref: "tools/verify-sprites.cjs#0c,1a,1b,1c (Entities.list built spawn-derived, 7 billboards)"
        status: pass
      - kind: manual_procedural
        ref: "in-browser visual pass (billboards appear at spawn positions, face camera) — delegated to orchestrator"
        status: unknown
    human_judgment: true
    rationale: "Headless harness proves the projection/scale/occlusion math on buf32; the actual on-screen appearance (billboards face the camera, read as enemies/pickups) needs a human eye in a real browser."
  - id: D2
    description: "A billboard's on-screen size scales inversely with distance (~2:1 between d and 2d); billboards are square on any aspect (H drives both dimensions)"
    requirement: "ENT-01"
    verification:
      - kind: integration
        ref: "tools/verify-sprites.cjs#3e (drawn pixel-height ratio d:2d ~2:1), #4c/#4d (squareness with W-vs-H control)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A sprite fully behind a wall draws zero columns; the same sprite in front draws columns (first z-buffer occlusion cut); entities sorted far->near allocation-free"
    requirement: "ENT-02"
    verification:
      - kind: integration
        ref: "tools/verify-sprites.cjs#2h (behind-wall=0 cols), #2i (in-front>0 control), #2j (raw-texel written)"
        status: pass
    human_judgment: false

# Metrics
duration: 22min
completed: 2026-07-25
status: complete
---

# Phase 4 Plan 01: Sprite Tracer (Entities + Billboard Projection + Z-Buffer Occlusion) Summary

**Static billboard list built from Level.spawns, projected through the inverted [dir|plane] camera matrix with H-driven square scaling, depth-sorted far->near allocation-free, and drawn into buf32 with the first per-column z-buffer occlusion cut and alpha-key transparency — wired into Raycaster.render() via a nullable spritePass seam.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-07-25T00:00:00Z
- **Completed:** 2026-07-25
- **Tasks:** 2
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments
- `js/entities.js`: the `Entities` global — a preallocated static billboard list (`{x,y,sprite,scale,onFloor}`) built from `Level.spawns` (enemy -> `enemy` scale 1; health/armor/ammo/shotgun -> `pickup` scale 0.5; exit/player skipped), plus the per-frame sprite pass.
- Billboard projection locked exactly to CONTEXT decision 3 (invDet / transformX / transformY, NEAR clip, `spriteScreenX`, `spriteDim = |floor(H/transformY)|*scale`, `vMove`/`vMoveScreen`), with screen HEIGHT driving both width and height so billboards stay square on any aspect.
- Allocation-free far->near depth sort: preallocated `Int32Array _order` + `Float64Array _dist2`, in-place insertion sort (no `Array.sort` closure), reallocated only when the list grows.
- First per-column z-buffer occlusion cut (ENT-02): a stripe draws only when `transformY > 0 && stripe in [0,W) && transformY < zBuffer[stripe]`; the pass reads zBuffer and never writes it. Alpha-key transparency skip (`alpha < ALPHA_KEY`).
- `Raycaster.spritePass` seam invoked as the last statement of `render()` (after the wall pass fills zBuffer, before the single present); `main.js` builds `Entities` and wires `Raycaster.spritePass = Entities.render`. Load-order contract extended to 13 scripts (entities.js after raycaster.js, before game.js).
- `tools/verify-sprites.cjs`: 31 falsifiable assertions — occlusion first-cut (behind-wall=0 / in-front>0 control), distance scaling ~2:1 vs an independent `projectSprite` recompute, and squareness with a W-vs-H falsifiability control — printing `ALL_SPRITE_CONTRACTS_PASS`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Entities model + billboard sprite pass, wired end-to-end (unshaded)** - `0e4bcc5` (feat)
2. **Task 2: Falsifiable sprite harness + Phase-3 regression update** - `1df5de5` (test)

## Files Created/Modified
- `Doom/Claude Opus 4.8/GSD/js/entities.js` - Entities billboard list + the sprite render pass (projection, sort, occlusion, transparency).
- `Doom/Claude Opus 4.8/GSD/js/raycaster.js` - Added the `spritePass: null` field and the `if (Raycaster.spritePass) Raycaster.spritePass();` invocation as render()'s last statement.
- `Doom/Claude Opus 4.8/GSD/index.html` - Added `<script src="js/entities.js">` after raycaster.js, before game.js; extended the numbered load-order contract to 13 scripts.
- `Doom/Claude Opus 4.8/GSD/js/main.js` - Call `Entities.build()` after Level/Sprites build; set `Raycaster.spritePass = Entities.render`.
- `Doom/Claude Opus 4.8/GSD/tools/verify-sprites.cjs` - New falsifiable sprite-contract harness.
- `Doom/Claude Opus 4.8/GSD/tools/verify-render.cjs` - Disable the sprite seam after fireLoad() so the Phase-3 wall/floor exact-pixel assertions stay unperturbed.
- `Doom/Claude Opus 4.8/GSD/tools/verify-input-view.cjs` - Expect 13 scripts (entities inserted) in the shipped load-order assertion.

## Decisions Made
- **Unshaded tracer:** sprite texels are written raw (no fog). This is the deliberate tracer scope — the projection + occlusion coupling is proven first; 04-02 fills in `shadeFactor`/`applyShade` by transformY. Documented in the file header and this summary as a functionality gap, not an architecture gap.
- **Robust pixel identification:** the harness identifies sprite-drawn pixels by a bg-vs-cur diff but never relies on value inequality alone — the positive proofs cross-check against an independent source-alpha recompute and assert the rendered pixel equals the raw opaque texel (addresses the plan-checker's background-diff advisory).
- **Squareness proof via silhouette bbox:** because the enemy sprite does not fill its 64x64 frame, the proof relates drawn extents to the sprite's own opaque-texel bbox and compares horizontal vs vertical pixels-per-texel (equal => H drives both), with the W-driven prediction as the control.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated verify-input-view.cjs load-order assertion for the new 13th script**
- **Found during:** Task 2 (full regression run)
- **Issue:** Adding `js/entities.js` made the shipped script count 13; `verify-input-view.cjs` hardcoded exactly 12 scripts, so assertion `1a` failed (16/17).
- **Fix:** Updated the expected script list to include `entities` after `raycaster` and before `game`, and the assertion label to say 13 scripts. No assertion weakened — the check still verifies exact order and count.
- **Files modified:** Doom/Claude Opus 4.8/GSD/tools/verify-input-view.cjs
- **Verification:** verify-input-view.cjs returns 17/17 ALL_TRACER_CONTRACTS_PASS.
- **Committed in:** `1df5de5` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking regression update)
**Impact on plan:** Necessary to keep the load-order contract harness in sync with the new script. No scope creep; the plan already anticipated the verify-render.cjs regression update, and this is the analogous update for verify-input-view.cjs.

## Issues Encountered
None — the projection, sort, and occlusion math worked as specified; all falsifiable proofs (including the controls) passed on the first harness run.

## Verification

Automated (all exit 0):
- `node "Doom/Claude Opus 4.8/GSD/tools/verify-sprites.cjs"` -> `ALL_SPRITE_CONTRACTS_PASS` (31/31), including the falsifiable occlusion first-cut (behind=0 / front>0 control), distance scaling ~2:1 vs the independent `projectSprite` recompute, and squareness with the W-vs-H control.
- Full Phase 1-3 regression green: verify-render 65/65 (`ALL_RENDER_CONTRACTS_PASS`), verify-level 56/56, verify-motion 22/22, verify-input-view 17/17, verify-phase02 38/38.
- `node --check` clean on js/entities.js, js/raycaster.js, js/main.js.
- Self-containment preserved: index.html adds exactly one classic `<script src="js/entities.js">`; no ES module, no network load; nothing under tools/ is browser-referenced.

Delegated to the orchestrator (in-browser visual pass, rAF-throttle caveat):
- On a non-composited/headless open the rAF loop does not tick — drive one frame manually (`Game.view.render()` then `Framebuffer.present()`). Confirm from `file://` AND a static server: enemy/pickup billboards appear at spawn positions, face the camera, and grow/shrink correctly when walking toward/away; a sprite disappears when a wall comes between it and the player; zero console/network errors. (Fine polish — clean edges, sort overlap, fog — is 04-02.)

## Known Stubs
- **Sprite fog shading (intentional, tracer scope):** `js/entities.js` writes opaque sprite texels UNSHADED. This is a documented deferral — 04-02 adds distance fog via `Raycaster.shadeFactor`/`applyShade` on transformY so sprites fog consistently with the wall behind them. The seam, projection, sort and occlusion are complete; only the per-texel shade multiply is deferred. Not a data stub (real spawn-derived entities render); no UI path shows placeholder data.

## Next Phase Readiness
- 04-02 can layer partial-wall clipping refinement, transparency hardening, and fog shading directly onto the proven projection + occlusion coupling; the `Raycaster.spritePass` seam and `Entities.render` structure are the extension points.
- Phase 5 (enemy AI/combat) can add behaviour fields to the entity objects and mutate `Entities.list`; the render pass already re-sorts far->near every frame and re-reads the live pose, so moving entities render correctly with no render-side change.

## Self-Check: PASSED
- FOUND: js/entities.js, tools/verify-sprites.cjs, 04-01-SUMMARY.md
- FOUND commits: 0e4bcc5 (Task 1), 1df5de5 (Task 2)

---
*Phase: 04-sprite-rendering-entities*
*Completed: 2026-07-25*
