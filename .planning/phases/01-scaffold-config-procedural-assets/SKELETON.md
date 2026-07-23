# Walking Skeleton — DOOM Clone (Browser)

**Phase:** 1
**Generated:** 2026-07-23

## Capability Proven End-to-End

> One sentence: the smallest user-visible capability that exercises the full stack.

"Opening `Doom/Claude Opus 4.8/GSD/index.html` in a browser (from file:// or a static server) generates all art in code and blits it into a fixed low-resolution Uint32 framebuffer that is crisply upscaled with pixelated scaling — the whole shell -> framebuffer -> generated-art path runs with zero build step and zero network requests."

This is a **canvas game**, not a CRUD app, so the "full stack" is: config constants -> the one-time Uint32 framebuffer + z-buffer -> procedural texture/sprite generation -> a preview blit -> CSS pixelated upscale onto the two-canvas composite. Proving that thin slice end-to-end validates every architectural decision the raycaster (Phases 3-4) and HUD/audio (Phase 6) will build on, before a single ray is cast.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Language / module strategy | Vanilla ES, classic (non-module) `<script src>` tags, shared globals (`CONFIG`, `Framebuffer`, `Textures`, `Sprites`, `Preview`), load order = dependency graph | ES modules are blocked by CORS on the `file:` scheme; classic scripts run from a double-clicked file. No bundler, no npm, no build step (PLAT-01, PLAT-02). |
| Render surface | Canvas 2D `ImageData` software framebuffer (no WebGL) | The renderer is a CPU software raycaster needing direct per-pixel RGBA access; WebGL would force a different architecture (REND-05). |
| Framebuffer | One reusable `ImageData` at internal size + a `Uint32Array` view over `.data.buffer`; packed little-endian color `(a<<24)|(b<<16)|(g<<8)|r`; single `putImageData` present() | ~4x fewer memory ops than per-byte writes; the canonical fast-blit for JS software renderers. Preallocated once, reallocated only on resolution change. |
| Internal resolution | `CONFIG.INTERNAL_W` fixed (default 480); `INTERNAL_H` derived from viewport aspect, clamped 240-300, recomputed on resize; `Framebuffer.width/height` is the source of truth | Fixed low pixel count makes per-frame cost independent of window size; aspect-derived height keeps the CSS-stretched canvas undistorted. |
| Upscale | CSS `image-rendering: pixelated` (+ `crisp-edges` fallback) on the #game canvas whose backing store = internal res | The GPU compositor does nearest-neighbor upscale for free — retro look + performance, no extra per-frame draw. |
| Compositing | Two stacked canvases: `#game` (internal-res, CSS-upscaled 3D view) + `#hud` (transparent, display-res overlay, `pointer-events:none`) | Lets Phase 6 draw crisp HUD/crosshair/text at native resolution over the pixelated 3D view. |
| Depth contract | Per-column `Float32Array` z-buffer sized to internal width, allocated in the framebuffer from day one | The wall pass (Phase 3) fills it and the sprite pass (Phase 4) reads it; the contract must exist before its consumers. |
| Assets | Procedural textures/sprites generated into flat `{width,height,data:Uint8ClampedArray,buf32:Uint32Array}` buffers via a seeded PRNG (`mulberry32` + `CONFIG.SEED`); 64x64 power-of-two textures; sprites color-keyed with alpha<128 = transparent | Fully self-contained (no external files, no canvas taint), deterministic across loads, and shaped for branch-free renderer sampling (REND-05, PLAT-03). |
| Directory layout | Everything under `Doom/Claude Opus 4.8/GSD/`; `index.html` + `style.css` + `js/*.js` one file per concern | Keeps this model entry isolated in the shared model-testing repo; file boundaries are the module boundaries. |

## Stack Touched in Phase 1

- [x] Project scaffold — `index.html`, `style.css`, `js/` with classic-script load order (no build/lint/test tooling by design)
- [x] "Routing" (entry point) — a single real entry: `index.html` boots `js/main.js`
- [x] "Data layer" (real read AND write) — a real WRITE (procedural fills into the Uint32 framebuffer + asset buffers) and a real READ (preview samples asset `buf32` back into the framebuffer)
- [x] UI — the two-canvas composite renders a visible, crisp, pixelated preview atlas; window-resize reflows it
- [x] Deployment / run — runs by double-clicking `index.html` (file://) AND by serving the folder statically; both verified in the plan checkpoints

## Out of Scope (Deferred to Later Slices)

> Explicitly NOT in the skeleton — this list prevents later phases from re-litigating Phase 1's minimalism.

- Raycasting / DDA wall casting, floor/ceiling casting, distance shading (Phase 3)
- Player pose, movement, strafe/run, wall collision, the `requestAnimationFrame` loop + clamped delta-time (Phase 2)
- Input: pointer-lock mouse-look, keyboard turning, key-state map (Phase 2)
- Billboarded sprite projection, depth sort, z-buffer occlusion (Phase 4 — consumes the z-buffer allocated here)
- Enemy AI, hitscan weapons, pickups collection/effects (Phase 5)
- HUD, minimap, Web Audio SFX, title/victory/death state machine (Phase 6 — draws on the #hud overlay allocated here)
- Any title/menu polish beyond the minimal load-time preview

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- Phase 2: Move, strafe, run, and look around a hand-designed grid level with wall collision — validated on a top-down view (uses the RAF loop + clamped dt).
- Phase 3: First-person textured walls + floors/ceilings with distance shading, filling the per-column z-buffer allocated here (consumes `Framebuffer.buf32`, `zBuffer`, and the 64x64 texture buffers).
- Phase 4: Billboarded, depth-sorted, z-buffer-occluded enemy/pickup sprites with alpha<128 color-key transparency (consumes the sprite buffers + `zBuffer` contract).
- Phase 5: Enemy AI (idle/chase/attack/pain/death), hitscan pistol + shotgun, pickups.
- Phase 6: HUD/crosshair/minimap on the #hud overlay, synthesized Web Audio SFX, and the title/victory/death game-state machine.
