---
phase: 01-scaffold-config-procedural-assets
plan: 01
subsystem: infra
tags: [canvas2d, imagedata, uint32array, framebuffer, zbuffer, raycaster, classic-scripts, pixelated, packed-color]

# Dependency graph
requires: []
provides:
  - "Self-contained game shell (index.html + style.css + js/config.js + js/framebuffer.js + js/main.js) under Doom/Claude Opus 4.8/GSD/ that opens with zero build step and zero network requests"
  - "Framebuffer contract: one reusable ImageData at internal resolution, buf32 Uint32Array view aliasing ImageData.data, clear(packed), present() (single putImageData)"
  - "Per-column Float32Array zBuffer sized to internal width (depth contract for Phases 3-4)"
  - "Two-canvas composite: #game internal-res CSS-upscaled + #hud transparent display-res overlay (pointer-events:none)"
  - "CONFIG namespace (INTERNAL_W/MIN_H/MAX_H/FOV_PLANE/TEX_SIZE/SEED/CLEAR_COLOR/CEIL_COLOR/FLOOR_COLOR) + global helpers packRGBA and mulberry32"
  - "Classic-script load-order contract (config -> framebuffer -> [Plan 02 assets] -> main)"
affects: [02-procedural-assets, 03-raycaster-walls-floors, 04-sprites, 06-hud-audio-states]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Global-namespace classic-script modules (no ES modules), load order = dependency graph"
    - "Uint32Array view aliasing ImageData.data.buffer for packed little-endian color writes"
    - "Fixed low internal resolution + CSS image-rendering:pixelated GPU upscale"
    - "Preallocate-once typed-array buffers; reallocate only on real resolution change"

key-files:
  created:
    - "Doom/Claude Opus 4.8/GSD/index.html"
    - "Doom/Claude Opus 4.8/GSD/style.css"
    - "Doom/Claude Opus 4.8/GSD/js/config.js"
    - "Doom/Claude Opus 4.8/GSD/js/framebuffer.js"
    - "Doom/Claude Opus 4.8/GSD/js/main.js"
  modified: []

key-decisions:
  - "INTERNAL_W=480 widescreen low-res; INTERNAL_H derived from viewport aspect, clamped 240-300 (16:9 -> 270)"
  - "buf32 Uint32Array aliases the same ArrayBuffer as ImageData.data so packed writes flow through putImageData with no copy"
  - "#hud backing store sized to display resolution (not internal) so Phase 6 HUD text stays crisp"
  - "Degenerate-viewport (0/NaN) guard added to resize() so a minimized window cannot corrupt the allocation"

patterns-established:
  - "Packed color contract: packRGBA(r,g,b,a)=((a<<24)|(b<<16)|(g<<8)|r)>>>0, every color precomputed packed"
  - "Framebuffer as single source of truth for internal width/height; clear()/present() are the only blit path"
  - "Deterministic procedural seed via mulberry32(CONFIG.SEED) exposed from day one for Plan 02"

requirements-completed: [PLAT-01, PLAT-02, REND-05]

coverage:
  - id: D1
    description: "Shell opens from file:// and a static server rendering a crisp pixelated solid-color framebuffer that fills the viewport with zero console/network errors"
    requirement: "PLAT-02"
    verification:
      - kind: automated_ui
        ref: "orchestrator browser screenshot of Doom/Claude Opus 4.8/GSD/index.html (file:// + static server)"
        status: unknown
    human_judgment: true
    rationale: "Final visual/crispness/zero-network confirmation requires opening in a real browser; headless node harness proves the logic but not the GPU upscale render. Delegated to the orchestrator's browser screenshot pass."
  - id: D2
    description: "No build step / no npm / no dependencies — plain co-located .html/.css/.js, no module-loader or network tokens anywhere under the game directory"
    requirement: "PLAT-01"
    verification:
      - kind: unit
        ref: "negative grep gate: ! grep -rnE 'type=\"module\"|fetch\\(|require\\(|import |cdn.|https?://...' returns NONE; all referenced assets relative and present"
        status: pass
    human_judgment: false
  - id: D3
    description: "Fixed low-res Uint32 framebuffer + Float32 z-buffer + two-canvas composite: buf32 aliases ImageData, buf32.length==width*height, zBuffer.length==width, single putImageData present(), aspect-clamped resize"
    requirement: "REND-05"
    verification:
      - kind: unit
        ref: "headless node vm harness — 17 contract assertions (ALL_CONTRACTS_PASS)"
        status: pass
      - kind: unit
        ref: "node --check on config.js/framebuffer.js/main.js + contract greps (putImageData, Uint32Array, Float32Array, zBuffer, pixelated, pointer-events:none)"
        status: pass
    human_judgment: false

# Metrics
duration: 4min
completed: 2026-07-23
status: complete
---

# Phase 1 Plan 01: Game Shell Tracer Summary

**Self-contained zero-build browser game shell: a two-canvas composite driving a preallocated Uint32 ImageData framebuffer (buf32 view + Float32 z-buffer) that clears to a packed color and CSS-pixelated-upscales from a fixed 480xaspect internal resolution.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-07-23T12:08:30Z
- **Completed:** 2026-07-23T12:12:35Z
- **Tasks:** 2 implemented + 1 checkpoint (auto-verified headlessly; visual pass delegated)
- **Files modified:** 5 created

## Accomplishments
- End-to-end tracer: config -> framebuffer -> canvas -> CSS upscale proven to clear a blank framebuffer to CLEAR_COLOR and blit it with a single putImageData.
- Four locked contracts established and documented for every later phase: (1) two-canvas composite, (2) Uint32 packed-color framebuffer with one-putImageData present(), (3) per-column Float32Array z-buffer, (4) preallocate-once / reallocate-only-on-resolution-change.
- Aspect-derived, clamped internal resolution (INTERNAL_W=480, height clamped 240-300) recomputed on resize with a degenerate-viewport guard; #hud backing store tracks the display for crisp Phase 6 HUD.
- Full CONFIG surface + packRGBA / mulberry32 helpers wired so Plan 02 procedural generation has deterministic seeding and packed-color tooling ready.

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end shell tracer** - `378ea82` (feat)
2. **Task 2: Harden the four locked contracts** - `455cebf` (feat)
3. **Task 3: Checkpoint (verify shell opens crisply from file:// and static server)** - auto-verified headlessly; visual browser confirmation delegated to orchestrator (no per-task commit — verification-only checkpoint)

**Plan metadata:** committed separately (docs: complete plan)

## Files Created/Modified
- `Doom/Claude Opus 4.8/GSD/index.html` - Two-canvas (#game/#hud) document; classic `<script src>` load order with the canonical four-contract note.
- `Doom/Claude Opus 4.8/GSD/style.css` - Absolute-fill canvases; `image-rendering: pixelated` (+ crisp-edges fallback) on #game; `pointer-events:none` on #hud.
- `Doom/Claude Opus 4.8/GSD/js/config.js` - CONFIG namespace + packRGBA/mulberry32 globals.
- `Doom/Claude Opus 4.8/GSD/js/framebuffer.js` - Framebuffer object: init/resize/clear/present; ImageData + buf8 + buf32 + zBuffer; four-contract header.
- `Doom/Claude Opus 4.8/GSD/js/main.js` - Entry point: boot on load, clear to CLEAR_COLOR, present, repaint on resize (no RAF loop in Phase 1).

## Contracts Established (for Plan 02 and Phases 3/4/6)

**Framebuffer API surface** (global `Framebuffer`):
- Properties: `ctx`, `hudCtx`, `img` (ImageData), `buf8` (Uint8ClampedArray), `buf32` (Uint32Array view over buf8.buffer — authoritative pixel buffer), `zBuffer` (Float32Array, length == width), `width` (== CONFIG.INTERNAL_W), `height` (aspect-derived, clamped), `gameCanvas`, `hudCanvas`.
- Methods: `init(gameCanvas, hudCanvas)`, `resize()` (aspect-clamped; reallocates buffers only on real resolution change; sizes #hud to display), `clear(packed)` (buf32.fill), `present()` (single ctx.putImageData).

**CONFIG constants:** `INTERNAL_W`=480, `MIN_H`=240, `MAX_H`=300, `FOV_PLANE`=0.66, `TEX_SIZE`=64 (power-of-two, mask with `&63`), `SEED`=1337, `CLEAR_COLOR`, `CEIL_COLOR`, `FLOOR_COLOR` (all packed via packRGBA).

**Global helpers:** `packRGBA(r,g,b,a=255)` -> packed little-endian Uint32; `mulberry32(seed)` -> deterministic PRNG closure.

**Classic-script load order (load-bearing):** `js/config.js` -> `js/framebuffer.js` -> `(Plan 02 assets)` -> `js/main.js`. Plan 02 must insert asset generators before main.js.

## Verification Results
- `node --check` passes on all three JS files.
- Contract greps pass: putImageData, Uint32Array, Float32Array, zBuffer, `image-rendering: pixelated`, `pointer-events: none`, `CEIL_COLOR`, `id="hud"`, `js/config.js` first.
- Negative self-containment gate passes: no `type="module"`, `fetch(`, `require(`, `import `, CDN, or absolute-URL asset tokens anywhere under the game directory; all four referenced assets are relative and present on disk.
- Headless node vm harness (DOM/canvas stub): 17/17 contract assertions pass (ALL_CONTRACTS_PASS), including buf32 aliases ImageData.data buffer, buf32.length==width*height (480*270), zBuffer.length==width==480, little-endian byte order [r,g,b,a]=[24,26,34,255], single putImageData per present(), no realloc when resolution unchanged, realloc + MAX_H clamp on a tall viewport, degenerate-viewport guard, and mulberry32 determinism.

## Decisions Made
- Used a global-object module strategy (`CONFIG`, `Framebuffer`) rather than a single `window.DOOM` root — matches the SKELETON's named-globals decision and keeps file boundaries as module boundaries.
- Kept height derivation as `round(INTERNAL_W * innerHeight / innerWidth)` clamped to [MIN_H, MAX_H]; for a 16:9 viewport this yields 270, comfortably inside the clamp.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Degenerate-viewport guard in Framebuffer.resize()**
- **Found during:** Task 2 (harden contracts)
- **Issue:** The plan's `resize()` height formula divides by `window.innerWidth`; a minimized/hidden window (innerWidth/innerHeight == 0) would produce NaN/0 and corrupt the ImageData allocation and #hud backing store.
- **Fix:** Guard `vw>0 && vh>0` before the aspect math (fall back to MIN_H), catch NaN via `!(h>0)`, and floor the #hud backing store to a minimum of 1px.
- **Files modified:** Doom/Claude Opus 4.8/GSD/js/framebuffer.js
- **Verification:** Headless harness "degenerate viewport guarded (height>=MIN_H)" assertion passes.
- **Committed in:** 455cebf (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing-critical robustness guard)
**Impact on plan:** Guard is a correctness safeguard around the preallocation contract; no architectural change, no scope creep.

## Issues Encountered
- Git emitted benign LF->CRLF warnings on Windows checkout; content is unaffected. No `.gitattributes` change made this phase.

## Checkpoint Disposition (Task 3)
This is a fully autonomous run with no human available. All automatable verification was executed and passed (node --check, contract greps, negative self-containment gate, and a 17-assertion headless runtime harness covering every Console-inspection expectation in the checkpoint — width==INTERNAL_W, buf32.length==width*height, zBuffer.length==width). The remaining step — opening index.html in a real browser from file:// and a static server to confirm the visual pixelated upscale, zero console/network errors, and undistorted resize — is delegated to the orchestrator's browser screenshot pass (coverage D1, human_judgment:true). The checkpoint is marked satisfied to the extent verifiable headlessly and the plan is completed.

## Next Phase Readiness
- Plan 02 (procedural assets) can consume CONFIG, packRGBA, mulberry32, and Framebuffer.buf32 immediately; it must register its asset-generator script(s) before main.js per the documented load order and add a preview blit in main.js.
- Phases 3-4 have the buf32 framebuffer + Float32 zBuffer contract ready; Phase 6 has the #hud display-res overlay ready.
- No blockers.

## Self-Check: PASSED

All 5 created source files + the SUMMARY exist on disk; both task commits (378ea82, 455cebf) exist in git history.

---
*Phase: 01-scaffold-config-procedural-assets*
*Completed: 2026-07-23*
