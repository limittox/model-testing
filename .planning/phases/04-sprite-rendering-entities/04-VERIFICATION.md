---
phase: 04-sprite-rendering-entities
verified: 2026-07-25T00:00:00Z
status: passed
score: 12/12 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
---

# Phase 4: Sprite Rendering & Entities Verification Report

**Phase Goal:** Billboarded sprites for enemies and pickups render in the 3D world, correctly scaled, depth-sorted, and occluded by walls.
**Verified:** 2026-07-25
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

Truths merged from ROADMAP success criteria (SC1-3) and both plans' `must_haves.truths` (04-01: T1-5, 04-02: T6-9). Every truth is exercised by an actually-executing headless harness (`verify-sprites.cjs`, 59/59) that renders real frames and asserts at pixel granularity on `Framebuffer.buf32`, plus live browser confirmation from the orchestrator.

| #  | Truth | Status | Evidence |
| -- | ----- | ------ | -------- |
| SC1 | Enemy & pickup sprites are camera-facing billboards, scale correctly with distance | VERIFIED | Billboard projection is camera-facing by construction (inverted `[dir\|plane]` matrix); orchestrator live: bbox centered at x=240 of W=480 head-on; Proof B distance scaling |
| SC2 | Sprites behind walls hidden; partial walls clip per column; nearer drawn over farther (back-to-front) | VERIFIED | Proof A (2h/2i), Proof D (5e-5i), Proof G (8c/8f) |
| SC3 | Sprite transparency clean — no halo/fringe | VERIFIED | Proof F (7c-7f); orchestrator live: 0 non-opaque texels written |
| T1 | Entities built from `Level.spawns` project as billboards (ENT-01) | VERIFIED | `verify-sprites` 0c/1a; `Entities.build()` maps 5 spawn types; orchestrator live: 7 entities (3 enemy + 4 pickup), exit/player skipped |
| T2 | Billboard size scales ~2:1 between distance d and 2d (ENT-01) | VERIFIED | Proof B: `spriteDim` ratio 3c (~2.0), drawn pixel-height ratio 3e (~2.0), `transformY`==true distance 3b; orchestrator ~inverse-square area |
| T3 | Billboards square on any aspect (H drives both scale) | VERIFIED | Proof C at W=480,H=270: pxPerTexX/Y ratio ~1 (4c); W-driven falsifiability control fails (4d); formula control 4e |
| T4 | Sprite fully behind wall draws ZERO columns; in front draws columns (ENT-02 first cut) | VERIFIED | Proof A: behind=0 cols + box byte-identical to bg (2h); in-front>0 control (2i); independent zBuffer<transformY check (2g) |
| T5 | Entities sorted far→near every frame, no per-frame allocation (ENT-02) | VERIFIED | In-place insertion sort over preallocated `_order`/`_dist2` Int32/Float64 scratch; `_ensureScratch` reallocates only on growth; Proof G 8d/8e confirms descending sort |
| T6 | Partial walls clip sprites PER COLUMN via z-buffer (ENT-02) | VERIFIED | Proof D: 19 visible + 19 occluded cols from one billboard; drawn set == predicted visible+opaque (5e); occluded cols zero (5f); +inf-zBuffer control draws all + strictly more (5h/5i) |
| T7 | Overlapping sprites: nearer texel wins (back-to-front, ENT-02) | VERIFIED | Proof G: nearer wins in list order [near,far] (8c) AND swapped [far,near] (8f) — order governs, not list sequence |
| T8 | Transparent texels leave background intact — no halo (ENT-03) | VERIFIED | Proof F: transparent-source pixels byte-for-byte == bg (7f); written pixels opaque 0xFF (7e); non-vacuity control box has both texel kinds (7c) |
| T9 | Distant sprites fog-shade consistently with walls | VERIFIED | Proof E: drawn pixel === `applyShade(raw, shadeFactor(transformY,false))` exact (6c); monotonic far<near mean brightness (6g); raw-differs control (6e); shares wall `shadeFactor`/`applyShade` |

**Score:** 12/12 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `js/entities.js` | Entities model + sprite pass | VERIFIED | 277 lines; `Entities.build()` (spawn-derived, idempotent), `Entities.render()` (project→sort→occluded shaded draw); wired via `Raycaster.spritePass` |
| `tools/verify-sprites.cjs` | Falsifiable headless harness | VERIFIED | 838 lines, 59/59 assertions, `ALL_SPRITE_CONTRACTS_PASS`; independent `projectSprite` recompute + falsifiability controls per proof |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `main.js` | `Raycaster.spritePass` | `Raycaster.spritePass = Entities.render` after `Game.view = Raycaster` | WIRED | main.js:52; harness 0b asserts identity |
| `raycaster.js render()` | sprite pass | `if (Raycaster.spritePass) Raycaster.spritePass()` as LAST statement | WIRED | raycaster.js:281, after Pass B fills zBuffer |
| `Entities.render` | `Framebuffer.zBuffer` | per-column `transformY < zbuf[stripe]`, never writes zbuf | WIRED | entities.js:247-248; grep confirms no zbuf write |
| `Entities.build` | `Level.spawns` | after `Level.build()` + `Sprites.build()` | WIRED | main.js:24/27/34 order correct |
| `index.html` | `js/entities.js` | script after raycaster.js, before game.js | WIRED | index.html:130 (raycaster:129, game:131) |
| `Entities.render` texel | `Raycaster.applyShade`/`shadeFactor` | fog shade shared with walls | WIRED | entities.js:205,270; applyShade forces opaque alpha (raycaster.js:88) |

### Behavioral Spot-Checks / Probe Execution

| Harness | Command | Result | Status |
| ------- | ------- | ------ | ------ |
| verify-sprites | `node tools/verify-sprites.cjs` | 59/59, ALL_SPRITE_CONTRACTS_PASS, exit 0 | PASS |
| verify-render | `node tools/verify-render.cjs` | 65/65, ALL_RENDER_CONTRACTS_PASS, exit 0 | PASS |
| verify-level | `node tools/verify-level.cjs` | 56/56, ALL_LEVEL_CONTRACTS_PASS, exit 0 | PASS |
| verify-motion | `node tools/verify-motion.cjs` | 22/22, ALL_MOTION_CONTRACTS_PASS, exit 0 | PASS |
| verify-input-view | `node tools/verify-input-view.cjs` | 17/17, ALL_TRACER_CONTRACTS_PASS, exit 0 | PASS |
| verify-phase02 | `node tools/verify-phase02.cjs` | 38/38, ALL_PHASE02_CONTRACTS_PASS, exit 0 | PASS |
| boot | `node tools/boot.cjs` | exit 0 | PASS |

Full Phase 1-4 regression green (257 assertions across the suite).

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
| ----------- | ----------- | ------ | -------- |
| ENT-01 (billboards, distance scaling, squareness) | 04-01 | SATISFIED | T1/T2/T3/SC1, Proofs B+C |
| ENT-02 (z-buffer occlusion, partial-wall clip, back-to-front sort) | 04-01, 04-02 | SATISFIED | T4/T5/T6/T7/SC2, Proofs A+D+G |
| ENT-03 (clean alpha-key transparency, no halo) | 04-02 | SATISFIED | T8/SC3, Proof F |

### Anti-Patterns Found

None. No debt markers (TODO/FIXME/XXX/TBD/HACK/PLACEHOLDER) in `entities.js`, `raycaster.js`, `main.js`, or `verify-sprites.cjs`. No per-frame allocation in `Entities.render` (scratch buffers reused; insertion sort over index array; no `Array.sort` closure; primitives only in the hot loop). No second `putImageData` — the single present stays in `Game.render`.

### Harness Falsifiability Assessment (the core scrutiny)

Each proof genuinely discriminates rather than merely passing:

- **Occlusion (A):** behind-wall entity is proven to project on-screen with positive width (2f) and to have wall depth nearer than `transformY` at every column (2g) — so its zero-draw cannot be blamed on off-screen/degenerate projection. The in-front control (2i) draws >0. Discriminating.
- **Partial-wall clip (D):** drawn columns must EXACTLY equal the independently-predicted visible+opaque set (5e), an occluded column that WOULD carry an opaque texel exists (5g, so it clips real content not empty margin), and the +inf-zBuffer control draws strictly more (5i). Discriminating.
- **Back-to-front sort (G):** nearer wins under BOTH list orders including the swapped control (8f) — proving order, not list sequence, governs. Discriminating.
- **No-halo (F):** transparent-source pixels asserted byte-identical to bg (7f) with a non-vacuity control proving the box contains both texel kinds (7c). Discriminating.
- **Independent recompute:** `projectSprite`/`predictedDrawnColumns`/`opaqueTexelAt` recompute from the formula (not calls into `Entities`), cross-checked against ground-truth invariants (`transformY`==true distance, `Level.lineOfSight`, live `zBuffer`), so a bug shared between renderer and recompute is caught by the invariants.

### Phase 5 Readiness

Clean seam. `Entities.list` holds plain `{x,y,sprite,scale,onFloor}` objects with NO behavior fields (harness 0e enforces this) — Phase 5 attaches health/state/AI without re-architecting. `Raycaster.spritePass` seam and the far→near sort are the documented extension points. Fog/occlusion/transparency are fully in the draw path, so AI-driven position changes render correctly with no additional wiring.

### Human Verification Required

None outstanding. The browser-observable criteria (billboards appear at spawn positions, face camera, scale with distance, disappear behind walls, crisp edges, floor-resting pickups, zero console errors) were driven live by the orchestrator over a static HTTP server and confirmed. The rAF-throttle on the non-composited pane is a documented verification artifact (frames driven manually), not a defect.

### Gaps Summary

No gaps. All 3 ROADMAP success criteria, all 9 plan truths, all 3 requirements (ENT-01/02/03) are verified with executing pixel-level evidence and falsifiability controls. The only tracer-scope deferral (unshaded draw in 04-01) was filled in 04-02 and is proven (Proof E). Full Phase 1-4 regression is green.

---

_Verified: 2026-07-25_
_Verifier: Claude (gsd-verifier)_
