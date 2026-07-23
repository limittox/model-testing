# Phase 1: Scaffold, Config & Procedural Assets - Context

**Gathered:** 2026-07-23
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss) — grey areas resolved at Claude's discretion and recorded below.

<domain>
## Phase Boundary

A self-contained game shell opens in a browser with zero build step and renders procedurally-generated art into a pixel-perfect low-resolution framebuffer.

**In scope:** the HTML/CSS shell, the config module, the framebuffer contract, the classic-script load-order contract, procedural texture + sprite generation into typed-array buffers, and a visible load-time preview blit. **Out of scope for this phase:** the raycaster, movement, entities, HUD, audio, game states — those belong to later phases. Build ONLY the foundation those phases will stand on.

**Requirements covered:** PLAT-01, PLAT-02, PLAT-03, REND-05.
**All code goes under `Doom/Claude Opus 4.8/GSD/`** (note the spaces in the folder name). The directory is currently empty — build the canonical structure fresh.
</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion (resolved)

These grey areas are pre-resolved so planning has firm ground. A planner may refine, but should honor the contracts other phases will depend on.

1. **Module strategy — classic scripts + shared global namespace.** No ES modules (they break on `file://`). Use plain `<script src>` tags in a fixed load order. Expose a single global namespace object (e.g. `window.DOOM`) that later files extend, OR a small set of named globals (`CONFIG`, `Assets`, `Framebuffer`). Document the load-order contract in a comment in `index.html` since order is load-bearing.

2. **Two-canvas compositing contract (lock this — later phases depend on it).**
   - `#game` canvas: backing store = the fixed internal resolution; CSS-scaled to fill the viewport with `image-rendering: pixelated` (+ `crisp-edges` fallback). The raycaster (Phase 3) writes here via one `putImageData` per frame.
   - `#hud` canvas: overlay at display resolution for crisp HUD/crosshair/weapon/text (Phase 6). Transparent, `pointer-events:none`.
   Both fill the viewport and are stacked.

3. **Framebuffer contract (lock this).** One reusable `ImageData` at internal size; a `Uint32Array` view over `img.data.buffer` is the authoritative pixel buffer. Colors are packed little-endian `(a<<24)|(b<<16)|(g<<8)|r`. Provide a `present()` that does a single `ctx.putImageData`. Provide a per-column `Float32Array` z-buffer allocated here (consumed in Phases 3–4) so the contract exists from day one. Preallocate everything once — no per-frame allocation.

4. **Internal resolution.** Default to a widescreen low resolution defined in `config.js` (recommended width ~480, height derived from the viewport aspect and clamped, e.g. 240–300, recomputed on resize) so the world fills the screen without distortion while keeping pixel count low enough for 60fps software rendering. Keep it a single easy-to-tune constant. `320x200` is an acceptable classic alternative — planner's call, but it MUST be one config value.

5. **Texture/sprite representation (lock this).** Generate all art at load time into flat buffers exposed as `{ width, height, data:Uint8ClampedArray, buf32:Uint32Array }`. Textures 64x64 (power-of-two so the renderer can mask with `&63`). Sprites carry per-pixel alpha; the renderer treats alpha < 128 as transparent (color-key/alpha). Generate via offscreen `<canvas>` 2D drawing then `getImageData` (simplest reliable path) OR direct typed-array fills — either is fine. Nothing is fetched from disk/network.
   - Minimum asset set to generate this phase: a few wall textures (stone/brick/tech/door/exit variety), a floor and a ceiling texture, at least one enemy sprite, at least one pickup sprite, and a weapon viewmodel sprite — enough to prove the pipeline and preview it. Later phases may add frames/variants.

6. **Load-time preview (satisfies success criterion 3).** After generating assets, blit them tiled into the framebuffer and `present()` so opening the file shows a crisp, pixelated atlas of the generated art — visible proof the framebuffer + upscale pipeline works before any raycaster exists. A short "click to start" title text is acceptable but not required this phase.

7. **Determinism.** Use a small seeded PRNG (e.g. mulberry32) for procedural noise so textures are stable across loads.
</decisions>

<code_context>
## Existing Code Insights

Greenfield — `Doom/Claude Opus 4.8/GSD/` is empty. No prior code to integrate. Follow the STACK.md and ARCHITECTURE.md research in `.planning/research/` — they prescribe the Canvas 2D `ImageData` + `Uint32Array` framebuffer, fixed-internal-resolution + CSS-`pixelated` upscale, classic-script/`file://` constraints, and the per-column z-buffer contract this phase must establish.
</code_context>

<specifics>
## Specific Ideas

- Verify success by opening `index.html` from `file://` (double-click) AND from a static server — both must work with zero console/network errors.
- The framebuffer, z-buffer, two-canvas, and packed-color contracts established here are consumed by Phases 3 (walls/floors), 4 (sprites), and 6 (HUD). Name and document them clearly.
- Keep the shell tiny and dependency-free. No frameworks, no bundler, no npm.
</specifics>

<deferred>
## Deferred Ideas

- Actual raycasting, input, entities, AI, weapons, HUD, audio, and game states — all later phases.
- Title/menu polish beyond a minimal preview — Phase 6.
</deferred>
