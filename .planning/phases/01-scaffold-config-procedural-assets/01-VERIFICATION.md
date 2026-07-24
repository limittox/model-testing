---
phase: 01-scaffold-config-procedural-assets
verified: 2026-07-24T00:04:18Z
status: passed
score: 14/14 must-haves verified
behavior_unverified: 0
overrides_applied: 0
warnings:
  - id: W-1
    item: "key_link (01-01): 'Framebuffer.resize keeps the internal aspect approximately equal to the viewport aspect so the CSS-stretched #game canvas is not distorted'"
    status: partial
    measured: "Holds only for viewport aspect in [1.60, 2.00]. Outside the MIN_H/MAX_H clamp band the CSS stretch is anamorphic: 4:3 (1024x768) = 20.0% stretch, ultrawide (2560x1080) = 15.6%, tall window (900x1200) = 113.3%."
    disposition: "Not a defect — 01-CONTEXT.md decision 4 explicitly mandates the clamp ('height derived from the viewport aspect and clamped, e.g. 240-300'). A fixed width plus a clamped height cannot preserve arbitrary aspect; the plan key_link and the context decision are mutually exclusive by construction, and the implementation honored the more authoritative context decision."
    forward_risk: "Phase 3 SC1 ('correct first-person perspective'). At 4:3 or ultrawide the rendered world is horizontally stretched up to 20%. Decide before Phase 3: (a) accept as period-authentic non-square pixels (original Doom stretched 320x200 to 4:3), (b) widen the clamp band, or (c) letterbox/pillarbox in CSS."
    human_decision_requested: true
  - id: W-2
    item: "ROADMAP declares Phase 1 as '**Mode:** mvp' but the phase Goal is not in User Story form"
    status: discrepancy
    measured: "gsd-tools query user-story.validate on the Phase 1 goal returns valid:false (missing 'As a [role]', 'I want to [capability]', 'so that [outcome]')."
    disposition: "Per references/verify-mvp-mode.md the verifier surfaces this rather than fabricating a User Flow Coverage table. Goal-backward verification proceeded against the three ROADMAP Success Criteria, which are the actual phase contract. Planner already recorded this as a known note in 01-01-PLAN.md."
    recommendation: "Run /gsd mvp-phase 1 to reformat the goal, or drop the 'Mode: mvp' marker for this infrastructure phase."
    human_decision_requested: true
info:
  - id: I-1
    item: "Over a static HTTP server the browser makes an unsolicited GET /favicon.ico which 404s and prints one console error. Not present on file:// (zero console messages there). Browser-initiated, not an app request."
    fix: "Optional one-liner in index.html <head>: <link rel=\"icon\" href=\"data:,\"> makes the console literally zero-error over HTTP too."
  - id: I-2
    item: "Framebuffer.resize() assigns hudCanvas.width/height on every call, which clears the #hud canvas and resets its 2D context state even when dimensions are unchanged."
    fix: "Harmless in Phase 1 (nothing drawn to #hud yet). Phase 6 must repaint the HUD after any resize — the same way main.js already repaints the atlas."
  - id: I-3
    item: "Preview._list caches asset references on first render; a later Textures.build()/Sprites.build() would leave the cache stale."
    fix: "Preview is Phase-1 scaffolding and is expected to be replaced by the raycaster in Phase 3. No action needed unless Preview survives."
  - id: I-4
    item: "Textures.names documents the wall-id order in a comment ('wall id N maps to names[N-1]') but there is no explicit id->texture data structure yet."
    fix: "Phase 3 (03-02 wall texturing) should materialize this as real data rather than relying on array position."
deferred: []
---

# Phase 1: Scaffold, Config & Procedural Assets — Verification Report

**Phase Goal:** A self-contained game shell opens in a browser with zero build step and renders procedurally-generated art into a pixel-perfect low-resolution framebuffer.
**Verified:** 2026-07-24T00:04:18Z
**Status:** passed (2 warnings, both requesting a human decision; 0 blockers)
**Re-verification:** No — initial verification

## Verification Method

SUMMARY.md claims were treated as unverified assertions. Evidence was produced independently:

1. **Full source read** of all 8 shipped files (`index.html`, `style.css`, `js/{config,framebuffer,textures,sprites,preview,main}.js`).
2. **Headless contract harness** — executed the *delivered* code in a `vm` sandbox with a DOM/canvas stub, booting through the real `main.js` `load` handler. 59 assertions across 10 groups. **57 pass / 2 fail** (the 2 failures are adversarial aspect-fidelity probes this verifier added, not plan must-haves — see W-1).
3. **Live browser inspection over CDP** — headless Chrome driven against **both** `file:///.../index.html` (the double-click path named in SC1) **and** a static HTTP server, capturing computed styles, live `Framebuffer`/`Textures`/`Sprites` state, a full canvas readback, every network request, and all console/exception events.
4. Static self-containment scan, load-order scan, and anti-pattern scan over the shipped tree.

This closed a real evidence gap: both plan checkpoints were auto-verified headlessly and delegated the browser pass onward, and the orchestrator's live pass covered the **static server only**. SC1 explicitly requires `file://`. That half is now directly observed.

## Goal Achievement

### ROADMAP Success Criteria

| # | Success Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Double-clicking `index.html` opens in a desktop browser, no build step, no npm install, no console/network errors (file:// **and** static server) | ✓ VERIFIED | Live Chrome on `file:///D:/.../GSD/index.html`: **8 requests, all `file://` local, 0 external, 0 failed loads, 0 exceptions, 0 console errors**. Static server: same 8 local requests + a browser-initiated `favicon.ico` (see I-1). No `package.json`/`node_modules`/bundler config in the tree; 8 plain files total. |
| 2 | All wall/floor textures and enemy/weapon/pickup sprites generated in code at load — nothing fetched | ✓ VERIFIED | Live page: `Textures.map` = `stone,brick,tech,door,exit,floor,ceiling` (7), `Sprites.map` = `enemy,pickup,weapon` (3). Every texel computed by `packRGBA`+`mulberry32` in `textures.js`/`sprites.js`. Static scan: **zero** `type="module"` / `fetch(` / `require(` / `import ` / `XMLHttpRequest` / `new Image(` / `http(s)://` / `cdn.` tokens anywhere in the shipped tree. Network trace confirms nothing beyond the 8 co-located files. |
| 3 | The fixed low-res Uint32 framebuffer blits and is crisply upscaled with pixelated scaling, shown by a visible load-time preview of generated textures | ✓ VERIFIED | Live page: `#game` backing store **480x240** vs CSS **1258x622**; computed `image-rendering: pixelated`; `buf32.length` 115200 = 480x240; canvas readback shows **2893 distinct colors** and **239 transitions across the mid row** — real generated art, not a flat clear. `preview.js` issues exactly **one** `putImageData`. |

**Score: 3/3 ROADMAP success criteria verified.**

### Plan Must-Have Truths

| # | Plan | Truth | Status | Evidence |
|---|---|---|---|---|
| 1 | 01-01 | file:// + static server render a solid framebuffer, crisp pixelated upscale, zero console/network errors | ✓ VERIFIED | Live CDP both schemes; fingerprints identical (below) |
| 2 | 01-01 | Internal res is one fixed config value (`INTERNAL_W`), height derived from aspect and clamped; `#game` backing store = internal res, not display | ✓ VERIFIED | `CONFIG.INTERNAL_W`=480; live `#game` 480x240 while CSS 1258x622; harness A2/A3/A8 |
| 3 | 01-01 | One reusable ImageData + `Uint32Array` view over the same buffer, allocated once; `clear()` fills, `present()` blits with a single `putImageData` | ✓ VERIFIED | Live `buf32Aliases=true`; harness A6/A7/B7/A10 — and B4 proves a packed store lands as `[10,20,30,255]` bytes in `ImageData.data` |
| 4 | 01-01 | Per-column `Float32Array` z-buffer sized to internal width allocated up front | ✓ VERIFIED | Live: `zBufferType=Float32Array`, `zBufferLen=480` = `fbWidth`; harness A5/C5 |
| 5 | 01-01 | Transparent `#hud` overlay stacked above `#game` at display resolution with pointer-events disabled | ✓ VERIFIED | Live: `hudBacking=1258x622` (= display), `hudPointerEvents=none`; harness A9/I5 |
| 6 | 01-01 | All JS loads as classic `<script src>` in a fixed documented order; nothing over the network | ✓ VERIFIED | 6 classic tags in order config→framebuffer→textures→sprites→preview→main (harness I3, index.html:55-60); load-order contract documented at index.html:28-37 |
| 7 | 01-02 | Opening index.html shows a crisp pixelated preview atlas of textures + sprites, blitted and presented at load | ✓ VERIFIED | Live readback 2893 distinct colors, 239 mid-row transitions; harness H1/H3/H5 |
| 8 | 01-02 | Every texture and sprite generated in code — nothing fetched | ✓ VERIFIED | Same as SC2 |
| 9 | 01-02 | Flat `{width,height,data,buf32}` shape; textures 64x64 power-of-two; sprites carry per-pixel alpha with alpha<128 = transparent | ✓ VERIFIED | Harness E3/E4/F3/F4: all 7 textures 64x64 with `buf32.length`=4096, `buf32.buffer === data.buffer` for all 10 assets; live `stoneDims = 64x64 buf32=4096`; `Sprites.ALPHA_KEY`=128 |
| 10 | 01-02 | Generation deterministic via `mulberry32(CONFIG.SEED)` — identical across reloads | ✓ VERIFIED | Harness G1: two independent sandbox loads produce **byte-identical** buffers for all 10 assets. G3: changing `SEED` changes the art (so the seed is genuinely load-bearing, not decorative). G2: in-place rebuild idempotent. Live: file:// and HTTP canvas fingerprints match exactly |
| 11 | 01-02 | The preview blit honors sprite transparency: alpha<128 skipped, no halo | ✓ VERIFIED | Harness F5: alpha is **strictly binary** — 0 partial-alpha texels across all 3 sprites (4343 opaque / 6921 transparent), so a fringe is structurally impossible. F7: every transparent texel is packed `0` (no ghost RGB). Live: `nonOpaquePixels=0` after the atlas blit and 93k checkerboard pixels survive → sprites painted no opaque bounding box |

**Score: 14/14 must-have truths verified** (3 ROADMAP SC + 11 plan truths).

### Required Artifacts

| Artifact | Expected | Exists | Substantive | Wired | Data Flows | Status |
|---|---|---|---|---|---|---|
| `Doom/Claude Opus 4.8/GSD/index.html` | Two-canvas doc + classic script order + contract notes | ✓ | ✓ 62 lines, full contract block | ✓ loads all 6 scripts | ✓ | ✓ VERIFIED |
| `Doom/Claude Opus 4.8/GSD/style.css` | Absolute-fill canvases, pixelated, pointer-events:none | ✓ | ✓ 27 lines | ✓ linked | ✓ computed styles confirmed live | ✓ VERIFIED |
| `js/config.js` | CONFIG + packRGBA + mulberry32 | ✓ | ✓ 62 lines | ✓ consumed by all 5 other modules | ✓ | ✓ VERIFIED |
| `js/framebuffer.js` | init/resize/clear/present, img/buf8/buf32/zBuffer | ✓ | ✓ 92 lines | ✓ driven by main.js + preview.js | ✓ | ✓ VERIFIED |
| `js/textures.js` | 7 procedural 64x64 textures | ✓ | ✓ 405 lines, real generators | ✓ built by main.js, read by preview.js | ✓ 7 distinct non-flat assets | ✓ VERIFIED |
| `js/sprites.js` | enemy/pickup/weapon with binary alpha | ✓ | ✓ 328 lines, two-pass mask→colorize | ✓ built by main.js, read by preview.js | ✓ 3 assets, binary alpha | ✓ VERIFIED |
| `js/preview.js` | Clipped color-keyed atlas blit + present | ✓ | ✓ 175 lines | ✓ called by main.js on load + resize | ✓ real texels reach buf32 | ✓ VERIFIED |
| `js/main.js` | Boot, build assets, render, repaint on resize | ✓ | ✓ 29 lines (appropriately thin) | ✓ entry point | ✓ | ✓ VERIFIED |

No stubs. No placeholder returns. No orphaned files. All 8 files tracked in git with no uncommitted changes.

### Key Link Verification

| From | To | Via | Status | Detail |
|---|---|---|---|---|
| `config.js` | `framebuffer.js`, `textures.js`, `sprites.js`, `preview.js`, `main.js` | Classic-script load order supplies `CONFIG`/`packRGBA`/`mulberry32` globals | ✓ WIRED | All consumers resolve at runtime; live page shows no ReferenceError |
| `framebuffer.js` `buf32` | `ImageData.data` | `new Uint32Array(buf8.buffer)` — same ArrayBuffer | ✓ WIRED | Live `buf32Aliases=true`; harness B4 proves byte layout end-to-end |
| `style.css` `image-rendering: pixelated` + internal-res backing store | GPU compositor | CSS upscale is the only scaler | ✓ WIRED | Live computed `pixelated`, 480x240 store vs 1258x622 CSS box; game never calls `getImageData` |
| `Framebuffer.resize` | viewport aspect | Aspect-derived clamped height | ⚠️ PARTIAL | Exact within aspect [1.60, 2.00]; anamorphic outside — see **W-1** |
| `textures.js`/`sprites.js` | `config.js` | `packRGBA` + `mulberry32(SEED+salt)` | ✓ WIRED | Harness G1/G3 confirm the seed genuinely drives output |
| Each asset `buf32` | its own `data.buffer` | `new Uint32Array(data.buffer)` | ✓ WIRED | Harness E4/F4 across all 10 assets |
| `preview.js` | `Textures.map`/`Sprites.map` → `Framebuffer.buf32` → `present()` | Color-keyed copy loop | ✓ WIRED | Harness H3: 109 stone texel colors present verbatim in the framebuffer |
| `index.html` script order | `main.js` build sequence | config→framebuffer→textures→sprites→preview→main | ✓ WIRED | Harness I3 (byte offsets strictly increasing) |
| `alpha < 128` test in preview blit | Phase 4 sprite pass | `Sprites.ALPHA_KEY` shared constant | ✓ WIRED | `preview.js:71` reads `Sprites.ALPHA_KEY`, not a magic number — single definition |

**8/9 key links fully wired; 1 partial (W-1).**

### Shared Contracts for Phases 2-6 (the specific check requested)

| Contract | Verified | Evidence |
|---|---|---|
| Uint32 framebuffer + packed little-endian color | ✓ SOUND | `packRGBA(1,2,3,4)` = `0x04030201`; a packed store round-trips to `[r,g,b,a]` bytes in the live `ImageData`. All colors precomputed packed. Documented `framebuffer.js:1-28`, `config.js:9-12`. |
| Per-column `Float32Array` z-buffer | ✓ SOUND | Allocated up front, `length === Framebuffer.width` (480) and re-tracks width on every real resize. Unpopulated by design — Phase 3 fills, Phase 4 reads. Documented as locked contract (3). |
| Two-canvas composite | ✓ SOUND | `#game` = internal res, CSS-upscaled pixelated; `#hud` = display res, transparent, `pointer-events:none`. Both confirmed live. |
| Flat asset shape `{width,height,data,buf32}` | ✓ SOUND | Identical for textures and sprites; `buf32` aliases `data.buffer` in all 10 assets. Textures uniformly 64x64/4096 so `& 63` masking is safe. Sprites correctly non-power-of-two (96x64 weapon) with width/height read from the asset. |
| `alpha < 128` transparency key | ✓ SOUND — **stronger than specified** | Alpha is strictly binary (0 or 255): **zero** partial-alpha texels across all sprites, and every transparent texel is packed `0`. The two-pass mask→colorize build makes a fringe texel structurally impossible rather than merely unlikely. Exported once as `Sprites.ALPHA_KEY`. |
| Seeded determinism | ✓ SOUND | Byte-identical across independent loads; per-asset salts; noise/dither fields precomputed in raster order so the PRNG stream does not depend on which texels happen to be filled. Changing `SEED` changes output. |
| Preallocate-once / realloc-only-on-change | ✓ SOUND | Harness C1-C3: zero `createImageData` calls when dimensions are unchanged, even across a display-size change that maps to the same internal res. Degenerate/minimized viewport guarded (C7). |
| Classic scripts, `file://`-safe | ✓ SOUND | Zero module/network tokens; verified live on `file://`. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Live `file://` boot (SC1 double-click path) | headless Chrome + CDP on `file:///.../index.html` | 8 local requests, 0 external, 0 exceptions, 0 console errors | ✓ PASS |
| Live static-server boot | headless Chrome + CDP on `http://localhost:8099/index.html` | 8 local requests + browser favicon 404, 0 exceptions | ✓ PASS |
| **file:// vs static-server parity** | Canvas readback fingerprint comparison | `c50a3962-dd9649ac-115200` on **both** — byte-identical render | ✓ PASS |
| Reload determinism | Two independent sandbox loads, buffer diff | All 10 assets byte-identical | ✓ PASS |
| Sprite transparency (no halo) | Post-atlas framebuffer alpha scan | 0 non-opaque pixels; 93,044 checkerboard pixels survive | ✓ PASS |
| Blit bounds safety | Off-edge blits on all 4 sides + right-edge row-wrap probe | No throw; no row wrap | ✓ PASS |
| Resize repaint | Dispatch `resize`, re-read buffer | Atlas repainted into the new buffer, 1 `putImageData` | ✓ PASS |
| Aspect fidelity | Internal res vs viewport aspect across 6 shapes | 0.0% at 16:9 and 16:10; **20.0% at 4:3, 15.6% ultrawide, 113.3% tall** | ✗ FAIL → **W-1** |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| PLAT-01 | 01-01 | No build step, no npm install | ✓ SATISFIED | 8 plain files; no `package.json`/`node_modules`/bundler config; opens by double-click |
| PLAT-02 | 01-01 | Loads from `file://` **and** a static server | ✓ SATISFIED | Both observed live; byte-identical canvas fingerprint |
| PLAT-03 | 01-02 | Fully self-contained — no network, no external assets | ✓ SATISFIED | Network trace: 0 external requests on either scheme; negative token scan clean; all art computed in JS |
| REND-05 | 01-01, 01-02 | Fixed low-res Uint32 framebuffer, CSS pixelated upscale | ✓ SATISFIED | 480x240 backing store, `buf32` aliasing ImageData, single `putImageData`, computed `image-rendering: pixelated`, real art on screen |

No orphaned requirements: REQUIREMENTS.md maps exactly PLAT-01/02/03 and REND-05 to Phase 1, and all four are claimed by the plans and verified here.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| — | — | None | — | Zero `TODO`/`FIXME`/`XXX`/`TBD`/`HACK`/`PLACEHOLDER` markers in the shipped tree. No empty implementations, no `return null`/`return []` stubs, no console-log-only functions, no hardcoded empty props. |

Notable positive: every generator writes through bounds-checked primitives (`px`/`rect`/`mset`/`mrect`/`mellipse`), so threat T-01-04 (memory tampering via bad index math) is mitigated structurally rather than by convention. The preview blit clips on all four sides and allocates nothing per texel.

## Warnings (human decision requested)

### W-1 — Aspect clamp produces anamorphic stretch outside a 1.60-2.00 viewport aspect

`Framebuffer.resize()` fixes width at 480 and clamps height to `[MIN_H=240, MAX_H=300]`. Measured stretch error between the framebuffer aspect and the viewport it is CSS-stretched into:

| Viewport | Internal | View AR | Buffer AR | Stretch error |
|---|---|---|---|---|
| 1920x1080 (16:9) | 480x270 | 1.778 | 1.778 | 0.0% |
| 1680x1050 (16:10) | 480x300 | 1.600 | 1.600 | 0.0% |
| 1200x800 (3:2) | 480x300 | 1.500 | 1.600 | 6.7% |
| 2560x1080 (ultrawide) | 480x240 | 2.370 | 2.000 | 15.6% |
| 1024x768 (4:3) | 480x300 | 1.333 | 1.600 | **20.0%** |
| 900x1200 (tall) | 480x300 | 0.750 | 1.600 | **113.3%** |

**This is not an implementation defect.** `01-CONTEXT.md` decision 4 explicitly mandates the clamp, and a fixed width with a clamped height cannot preserve arbitrary aspect — the `01-01-PLAN.md` key_link promising "not distorted" and the context decision are mutually exclusive by construction. The implementation honored the more authoritative context decision. Phase 1's own visuals (solid color, then a tiled atlas) make the stretch invisible, and the maximized 16:9 case is exact.

**Forward risk:** Phase 3 SC1 requires "correct first-person perspective". A player in a non-maximized 4:3-ish window sees the world stretched 20% horizontally. Decide before Phase 3:
- **(a) Accept** as period-authentic non-square pixels (original Doom stretched 320x200 into 4:3), or
- **(b) Widen** the `MIN_H`/`MAX_H` band (costs pixels at extreme aspects), or
- **(c) Letterbox/pillarbox** the `#game` element in CSS instead of stretching to `100vw/100vh`.

To formally accept (a), add to this file's frontmatter:

```yaml
overrides:
  - must_have: "Framebuffer.resize keeps the internal aspect approximately equal to the viewport aspect so the CSS-stretched #game canvas is not distorted"
    reason: "MIN_H/MAX_H clamp is mandated by 01-CONTEXT decision 4; non-square-pixel stretch at extreme aspects is accepted as period-authentic"
    accepted_by: "{your name}"
    accepted_at: "{ISO timestamp}"
```

### W-2 — Phase declared `Mode: mvp` but the goal is not a User Story

`gsd-tools query user-story.validate` on the Phase 1 goal returns `valid: false`. Per `references/verify-mvp-mode.md`, the verifier surfaces this rather than fabricating a low-quality "User Flow Coverage" section, so this report omits that section and verifies goal-backward against the three ROADMAP Success Criteria (the actual contract). `01-01-PLAN.md` already recorded the mismatch as a known planner note.

**Recommendation:** run `/gsd mvp-phase 1` to reformat the goal, or drop the `**Mode:** mvp` marker for this infrastructure phase. Phases 2-6 carry the same `Mode: mvp` marker with non-User-Story goals and will hit this on every verification — worth resolving once at the roadmap level.

## Informational

- **I-1** — Over a static HTTP server the browser auto-requests `/favicon.ico`, which 404s and prints one console error. Absent on `file://` (zero console messages there). Browser-initiated, not an app request, so SC1 is met — but `<link rel="icon" href="data:,">` in `<head>` would make the HTTP console literally zero-error.
- **I-2** — `Framebuffer.resize()` assigns `hudCanvas.width/height` unconditionally, which clears `#hud` and resets its context state even when unchanged. Harmless now; **Phase 6 must repaint the HUD after resize**.
- **I-3** — `Preview._list` caches asset references on first render and would go stale after a rebuild. Preview is Phase-1 scaffolding expected to be replaced in Phase 3.
- **I-4** — The wall-id → texture mapping exists only as a comment on `Textures.names`. Phase 3 (03-02) should materialize it as real data rather than relying on array position.

## Gaps Summary

**None.** All three ROADMAP success criteria, all four requirements, and all fourteen plan must-have truths are verified against the delivered code — with live browser evidence from both `file://` and a static server, not just from SUMMARY.md claims.

The phase goal is achieved. The shell opens with zero build step, all 10 art assets are computed in code from a seeded PRNG, and a fixed 480xN Uint32 framebuffer aliasing `ImageData` blits real generated art in a single `putImageData` under a GPU nearest-neighbor upscale. The four contracts Phases 2-6 stand on — packed Uint32 framebuffer, per-column Float32 z-buffer, two-canvas composite, and the flat `{width,height,data,buf32}` asset shape with a binary alpha key — are sound, documented in-file, and in two respects (binary sprite alpha, bounds-checked generator primitives) stronger than the plan required.

Two items need a human decision (W-1 aspect clamp, W-2 MVP goal format); neither blocks Phase 2.

---

*Verified: 2026-07-24T00:04:18Z*
*Verifier: Claude (gsd-verifier)*
