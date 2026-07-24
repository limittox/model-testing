---
phase: 03-core-renderer-walls-floors-ceilings
verified: 2026-07-25T00:00:00Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 3: Core Renderer — Walls, Floors & Ceilings Verification Report

**Phase Goal:** The level renders as a first-person textured 3D world with correct perspective, distance shading, and a per-column depth buffer that later passes consume.
**Verified:** 2026-07-25
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (mapped to the 4 ROADMAP success criteria)

| # | Truth (Success Criterion) | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Textured walls in correct first-person perspective, no fisheye (perpendicular wall distance) | ✓ VERIFIED | `raycaster.js:211` computes `perpWall = sideDistX - deltaDistX` (or Y) — the lodev perpendicular distance, explicitly NOT `hypot`. Harness §1 proves the perpendicular zBuffer band is constant (spread < 1e-3) across a flat named wall face while an INDEPENDENT Euclidean recompute (`referenceDDA` line 106, `pw * |rayDir|`) visibly VARIES (spread > 1e-2) — the control genuinely discriminates. Orchestrator live: flat wall ahead → 0 z-spread across 80-col center band. |
| 2 | Correct per-column texture sampling; floors & ceilings cast and shaded; flat-color fallback exists | ✓ VERIFIED | Texture: `raycaster.js:243-262` — side-flipped texX (both `side==0 && rayDirX>0` and `side==1 && rayDirY<0`), power-of-two `& MASK`, unclamped texPos anchored to the full span (`:256-257`). Harness §10 proves against the ASYMMETRIC exit arrow (id 5) that `texX !== texXnoflip` and the rendered pixel matches the FLIPPED (not mirrored) texel (10f/10g), and exercises the tall-wall unclamped-texPos path (10h, lineHeight > H). Floor/ceiling cast: `raycaster.js:115-154`; fallback: `:155-178`. Harness §11–§14 prove whole-frame coverage at odd (H=201) AND even (H=270) height, distinct floor/ceiling buffers, and the FLOOR_CAST=false path is shaded (13c-e: `applyShade(FLOOR_COLOR, rowShade)` ≠ raw color). |
| 3 | Surfaces darken with distance | ✓ VERIFIED | `shadeFactor` (`:66-72`) linear fog to MIN_SHADE floor + constant y-side darken, fixed-point 0..256; `applyShade` (`:74-80`) preserves rgb layout and forces alpha 0xFF. Harness §9 asserts boundary values (256 at camera, floor at FOG_FAR), monotonic non-increasing (9d), y-side < x-side (9e-f), alpha-forced-opaque (9h, 3b), and near-brighter-than-far on the same face via the render path (9k). Orchestrator live: near z=2.28 lum 69.4 → far z=20.5 lum 33.2 (monotonic). |
| 4 | Wall pass produces a per-column z-buffer, correct for later sprite occlusion | ✓ VERIFIED | `raycaster.js:214` `zbuf[x] = perpWall` for EVERY column, after the EPS guard (`:212`) catches 0/negative/NaN. Harness §2 reproduces `zBuffer[x]` to 1e-6 for all 480 columns against an INDEPENDENT from-formula perpendicular DDA (`referenceDDA`, not a call into Raycaster), and asserts every entry finite & > 0 and written (2a-c). §6 confirms axis-aligned facings (rayDir component 0) yield no NaN via the 1e30 sentinel. This is the strongest evidence short of Phase-4 sprites. |

**Score:** 4/4 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `js/raycaster.js` | First-person software raycaster (3-pass: floor/ceiling cast, wall DDA, z-buffer) | ✓ VERIFIED | 267 lines, substantive, wired as `Game.view` in `main.js:40`. Reads `Framebuffer.width/height/buf32/zBuffer` live each `render()` call (`:88-92`); writes buf32 + zBuffer; never presents. |
| `js/config.js` | Renderer tunables (FLOOR_CAST, CAMERA_Z, FOG_FAR, MIN_SHADE, SIDE_SHADE, colors) | ✓ VERIFIED | All constants present (`:83-97`); FLOOR_CAST defaults true. |
| `tools/verify-render.cjs` | Headless render-contract harness printing ALL_RENDER_CONTRACTS_PASS | ✓ VERIFIED | Ran: **65/65 assertions passed, ALL_RENDER_CONTRACTS_PASS**. Independent DDA / texel / floor-row recomputes make the load-bearing checks falsifiable. |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `main.js` | `Raycaster` | `Game.view = Raycaster` (`main.js:40`), `TopDown.ENABLED = false` (`:39`) | ✓ WIRED | Harness 0a-0d confirm at runtime. |
| `Raycaster.render` | `Framebuffer.buf32` + `.zBuffer` | direct typed-array writes, NO `present()` | ✓ WIRED | Harness 4a: direct render() does not present; 4b: one rAF present exactly once (Game.render owns the single putImageData, `game.js:116-123`). |
| `Raycaster` | `Level.isSolid/cellAt/textureFor` | DDA + texture resolution | ✓ WIRED | `level.js:389-484`; `textureFor` falls back to stone; `validateTextures` guarantees no missing id. |
| `Raycaster` | `Textures.map.floor/ceiling/stone` | buf32 texel reads | ✓ WIRED | `textures.js:41-48`; distinct buffers proven by harness 11g. |

### Behavioral Spot-Checks / Probe Execution

| Harness | Command | Result | Status |
| --- | --- | --- | --- |
| verify-render.cjs | `node tools/verify-render.cjs` | 65/65, ALL_RENDER_CONTRACTS_PASS | ✓ PASS |
| verify-input-view.cjs | `node …` | 17/17, ALL_TRACER_CONTRACTS_PASS | ✓ PASS |
| verify-level.cjs | `node …` | 56/56, ALL_LEVEL_CONTRACTS_PASS | ✓ PASS |
| verify-motion.cjs | `node …` | 22/22, ALL_MOTION_CONTRACTS_PASS | ✓ PASS |
| verify-phase02.cjs | `node …` | 38/38, ALL_PHASE02_CONTRACTS_PASS | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| REND-01 | 03-01 | DDA raycaster, perpendicular wall distance (no fisheye) | ✓ SATISFIED | Truth 1; harness §1 |
| REND-02 | 03-02 | Per-column texture sampling | ✓ SATISFIED | Truth 2; harness §10 |
| REND-03 | 03-03 | Floors/ceilings cast + shaded, flat-color fallback | ✓ SATISFIED | Truth 2; harness §11–§14 |
| REND-04 | 03-02 | Distance shading/fog | ✓ SATISFIED | Truth 3; harness §9 |
| REND-06 | 03-01 | Per-column z-buffer for occlusion | ✓ SATISFIED | Truth 4; harness §2 |

### Anti-Patterns Found

None. No TODO/FIXME/XXX/HACK/PLACEHOLDER debt markers in `js/raycaster.js`. The `CONFIG.FLOOR_CAST=false` branch is not dead code — harness §13/§14 exercise it as a real distance-shaded path. The `if (!tex) tex = Textures.map.stone` fallback (`:229`) is defence, not a routine stub (`validateTextures` guarantees coverage). No per-frame allocation in `render()` (only scalar locals; preallocated buf32/zBuffer reused). `Framebuffer.width/height` read live every call (`:90-91`) — never cached across frames. Single `putImageData` isolated in `Game.render` (`game.js:122`).

### Human Verification Required

None. The browser-observable criteria were confirmed live by the orchestrator (three textured bands, 1058 distinct colors, monotonic distance fog 69.4→33.2, zero uncovered pixels in both cast and fallback modes, zero console errors, no fisheye). The z-buffer's correctness for Phase-4 sprite occlusion is proven now by an independent perpendicular-distance recompute (harness §2) rather than deferred to a runtime observation.

### Gaps Summary

No gaps. All four success criteria are met in the delivered code with independently-falsifiable harness evidence and corroborating live-browser observation. The renderer establishes exactly the contract Phase 4 depends on: `Framebuffer.zBuffer[x]` holds finite, strictly-positive PERPENDICULAR wall distance for every column, byte-verified against an independent DDA. Phase goal achieved.

---

_Verified: 2026-07-25_
_Verifier: Claude (gsd-verifier)_
