---
phase: 01-scaffold-config-procedural-assets
plan: 02
subsystem: assets
tags: [procedural-generation, textures, sprites, alpha-color-key, packed-color, uint32array, mulberry32, determinism, preview-atlas]

# Dependency graph
requires:
  - "01-01: Framebuffer (buf32/width/height/clear/present) + CONFIG (packRGBA, mulberry32, SEED, TEX_SIZE, CEIL_COLOR) + the classic-script load-order contract"
provides:
  - "Asset-buffer contract: every texture/sprite is a flat {width, height, data:Uint8ClampedArray, buf32:Uint32Array} with buf32 aliasing data.buffer (same packed little-endian format as Framebuffer.buf32)"
  - "Textures global: Textures.map / Textures.names / Textures.build() — 7 deterministic 64x64 textures (stone, brick, tech, door, exit, floor, ceiling)"
  - "Sprites global: Sprites.map / Sprites.names / Sprites.build() / Sprites.ALPHA_KEY — enemy 64x64, pickup 32x32, weapon viewmodel 96x64 with strictly binary per-pixel alpha"
  - "Color-key contract: a texel is transparent when ((packed >>> 24) & 0xff) < Sprites.ALPHA_KEY (128); Phase 4's sprite pass reuses this exact test"
  - "Preview global: Preview.render() / Preview.blit(asset, dx, dy, colorKey) — clipped, allocation-free color-keyed blit into Framebuffer.buf32"
  - "Extended classic-script load order: config -> framebuffer -> textures -> sprites -> preview -> main"
affects: [03-raycaster-walls-floors, 04-sprites, 06-hud-audio-states]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-pass sprite build: material mask + 1px auto-outline (shape), then palette colorize (color) — guarantees alpha is only ever 0 or 255"
    - "Seamlessly-tiling two-octave value noise (bilinear lattice with smoothstep fade, wrapped modulo cell count) for surface grain"
    - "Per-asset PRNG salt: mulberry32(CONFIG.SEED + salt) so each asset has its own stable, independent noise stream"
    - "Bounds-checked primitive helpers (px/rect/mset/mrect/mellipse) so no generator can write outside width*height"
    - "Precompute the dither/noise field in raster order so the PRNG stream is independent of which texels happen to be filled"

key-files:
  created:
    - "Doom/Claude Opus 4.8/GSD/js/textures.js"
    - "Doom/Claude Opus 4.8/GSD/js/sprites.js"
    - "Doom/Claude Opus 4.8/GSD/js/preview.js"
  modified:
    - "Doom/Claude Opus 4.8/GSD/index.html"
    - "Doom/Claude Opus 4.8/GSD/js/main.js"

key-decisions:
  - "Direct typed-array fills (not offscreen-canvas drawing + getImageData) — keeps generation pure, synchronous, canvas-taint-free and unit-testable headlessly"
  - "Sprites built via a material mask then colorized, so alpha is assigned exactly once and is always 0 or 255 — structurally impossible to emit a half-alpha fringe texel"
  - "Every sprite gets a 1px auto-outline (empty texels adjacent to the silhouette) so shapes read against any background"
  - "Preview backdrop is CEIL_COLOR + a subtle 8px checker rather than a flat fill, so an opaque bounding box or halo around a sprite would be immediately visible"
  - "Textures.names / Sprites.names arrays give an explicit stable display/id order rather than relying on object key enumeration"

patterns-established:
  - "Asset shape {width,height,data,buf32} is identical for textures and sprites; only the color key distinguishes them at blit time"
  - "Textures are 64x64 power-of-two (mask with & 63); sprites are arbitrary-size, so always read width/height from the asset"
  - "Color-keyed blit clips on all four sides and allocates nothing per texel"

requirements-completed: [PLAT-03, REND-05]

coverage:
  - id: D4
    description: "All wall/floor/ceiling textures and enemy/pickup/weapon sprites are generated in code at load — nothing fetched from disk or network (PLAT-03)"
    requirement: "PLAT-03"
    verification:
      - kind: unit
        ref: "negative token scan over the whole game dir: type=\"module\" | import | export | require( | fetch( | XMLHttpRequest | new Image | http(s):// | cdn. | node_modules -> ZERO matches"
        status: pass
      - kind: unit
        ref: "headless texture harness (13 assertions) + sprite harness (11 assertions): both asset sets build fully inside a vm sandbox with NO DOM, no canvas and no I/O"
        status: pass
    human_judgment: false
  - id: D5
    description: "Each asset is the locked flat {width,height,data,buf32} shape; textures 64x64 with buf32.length 4096; sprites use alpha<128 as the transparent color key with strictly binary alpha"
    requirement: "REND-05"
    verification:
      - kind: unit
        ref: "texture harness: 64x64 / buf32.length===4096 / buf32 aliases data.buffer / all texels alpha 255 / >=8 distinct colors / mutually distinct"
        status: pass
      - kind: unit
        ref: "sprite harness: buf32.length===w*h / alpha strictly in {0,255} (no fringe) / every transparent texel is packed 0 / all four corners transparent / enemy 64x64, pickup 32x32, weapon 96x64"
        status: pass
    human_judgment: false
  - id: D6
    description: "Opening index.html shows a crisp pixelated preview atlas of the generated art with clean sprite transparency, identical across reloads (success criterion 3)"
    requirement: "REND-05"
    verification:
      - kind: unit
        ref: "E2E harness parses index.html's real script order, loads all 6 files into a stubbed-DOM vm, fires 'load': exactly one putImageData of the Framebuffer ImageData, 480x270, all 7 textures + 3 sprites present in the atlas, ZERO non-opaque pixels in the framebuffer (proves the color key skipped every alpha<128 texel), checker visible in both shades, resize repaints, second boot byte-identical"
        status: pass
      - kind: automated_ui
        ref: "orchestrator browser screenshot of Doom/Claude Opus 4.8/GSD/index.html (file:// + static server) — visual crispness / halo-free transparency / zero console errors"
        status: unknown
    human_judgment: true
    rationale: "Headless harness proves the pixel math, the color key and reload determinism exhaustively, but the GPU nearest-neighbour upscale and DevTools console/network panes require a real browser. Delegated to the orchestrator's screenshot pass (autonomous run, no human available)."
  - id: D7
    description: "Behavior is identical from file:// and a static server with zero network requests"
    requirement: "PLAT-03"
    verification:
      - kind: integration
        ref: "static-server check: real http.createServer over the game dir — GET / is 200 text/html and byte-identical to disk; all 7 referenced resources (style.css + 6 scripts) serve 200 with disk-identical bytes; no absolute/protocol-relative/file: URLs referenced"
        status: pass
    human_judgment: false

# Metrics
duration: 9min
completed: 2026-07-23
status: complete
---

# Phase 1 Plan 02: Procedural Assets + Preview Atlas Summary

**All Phase-1 art — 7 tiling 64x64 textures and 3 binary-alpha sprites — generated deterministically from mulberry32(SEED+salt) into flat packed-Uint32 buffers, tiled into the framebuffer by a clipped color-keyed blit and presented as a load-time atlas.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-07-23T23:42:21Z
- **Completed:** 2026-07-23T23:51:44Z
- **Tasks:** 3 implemented + 1 checkpoint (auto-verified headlessly; visual pass delegated)
- **Files:** 3 created, 2 modified

## Accomplishments

- **The asset pipeline is real and proven end to end.** Plan 01 blitted a solid color; the framebuffer now receives actual generated art — asset buffer -> `Framebuffer.buf32` -> one `putImageData` -> CSS pixelated upscale.
- **10 procedural assets, zero bytes fetched.** Every texel is computed in JS at load; the negative token scan confirms nothing anywhere under the game directory can trigger a network or module load (PLAT-03).
- **Sprite transparency is structurally correct, not approximately correct.** The two-pass build makes half-alpha texels impossible, and the E2E harness proves the consequence: after the full atlas blit, **zero** framebuffer pixels are non-opaque — every `alpha < 128` source texel was skipped, so there is no halo and no punched-through hole.
- **Determinism is enforced, not assumed.** Independent rebuilds in fresh sandboxes are byte-identical for every texture, every sprite, and the composed 480x270 atlas.

## Task Commits

Each task was committed atomically:

1. **Task 1: Procedural wall/floor/ceiling textures** — `084883c` (feat)
2. **Task 2: Enemy/pickup/weapon sprites with per-pixel alpha** — `0917038` (feat)
3. **Task 3: Load-time preview blit + shell wiring** — `d558f00` (feat)
4. **Task 4: Checkpoint (verify the atlas renders crisply with clean transparency)** — auto-verified headlessly; visual browser confirmation delegated to the orchestrator (verification-only, no commit)

## Files Created/Modified

- `Doom/Claude Opus 4.8/GSD/js/textures.js` (405 lines, created) — `Textures` global; 7 generators plus shared noise/primitive helpers.
- `Doom/Claude Opus 4.8/GSD/js/sprites.js` (328 lines, created) — `Sprites` global; mask-then-colorize sprite builder, auto-outline, `ALPHA_KEY`.
- `Doom/Claude Opus 4.8/GSD/js/preview.js` (175 lines, created) — `Preview` global; checker backdrop, cell grid, clipped color-keyed blit, `present()`.
- `Doom/Claude Opus 4.8/GSD/index.html` (modified) — three new classic `<script src>` tags before `main.js`; load-order contract comment updated and an asset-buffer/color-key contract note added.
- `Doom/Claude Opus 4.8/GSD/js/main.js` (modified) — boots the framebuffer, calls `Textures.build()` -> `Sprites.build()` -> `Preview.render()`, and re-renders on resize.

## Contracts Established (for Phases 3, 4 and 6)

**Asset buffer shape (locked — identical for textures and sprites):**

```js
{ width, height, data: Uint8ClampedArray, buf32: Uint32Array }
```

`buf32` is a `Uint32Array` view over the SAME `ArrayBuffer` as `data`, using the same packed little-endian layout as `Framebuffer.buf32` — `(a<<24)|(b<<16)|(g<<8)|r`. A texel therefore copies into the framebuffer with a plain assignment: no unpack, no repack, no blend.

**`Textures.map` keys** (order = `Textures.names`, also the intended Phase 3 wall-id order):

| Key | Size | Character |
|-----|------|-----------|
| `stone` | 64x64 | Mottled grey rock, dark vein cracks, chipped highlights |
| `brick` | 64x64 | Running-bond courses, pale mortar joints, per-brick tint + bevel |
| `tech` | 64x64 | Dark steel plate, beveled frame, vent louvers, bolt studs, dim cyan strip |
| `door` | 64x64 | Framed metal, centre seam, window slot, hazard-striped kick plate |
| `exit` | 64x64 | Emissive green border + bright right-pointing arrow (highest contrast) |
| `floor` | 64x64 | Warm brown gravel, 32px tile seams, speckle |
| `ceiling` | 64x64 | Cold concrete on a 16px panel grid, recessed seams, two dim lamps |

All textures are **64x64 power-of-two** (`buf32.length === 4096`), fully opaque, and generated with seamlessly-tiling noise so they repeat without a visible seam — mask texel coords with `& 63`.

**`Sprites.map` keys** (order = `Sprites.names`):

| Key | Size | Content |
|-----|------|---------|
| `enemy` | 64x64 | Standing horned demon: emissive eyes, fanged mouth, clawed arms, planted feet (bottom-aligned for billboarding) |
| `pickup` | 32x32 | Medkit: white case, red cross, carry handle |
| `weapon` | 96x64 | First-person pistol viewmodel: barrel, slide, grip, two gloved hands (wider than tall, drawn bottom-centre) |

**Color-key contract (locked):**

```js
if (((packed >>> 24) & 0xff) < Sprites.ALPHA_KEY /* 128 */) continue; // transparent
```

Sprite alpha is **strictly binary**: background texels are packed value `0` (alpha 0) and silhouette texels are alpha `255`. Nothing in between exists, verified by assertion — so a plain skip-if-transparent blit produces no fringe. Phase 4's sprite pass should reuse `Sprites.ALPHA_KEY` rather than re-hardcoding 128.

**Determinism:** every asset draws from `mulberry32(CONFIG.SEED + salt)` with its own stable salt (textures 11/22/33/44/55/66/77, sprites 101/202/303). Changing `CONFIG.SEED` regenerates all art coherently; leaving it alone guarantees pixel-identical output on every load.

**Reusable blit:** `Preview.blit(asset, dx, dy, colorKey)` clips on all four sides and allocates nothing per texel — the reference implementation for Phase 4's sprite column loop.

**Extended load order (load-bearing):** `js/config.js` -> `js/framebuffer.js` -> `js/textures.js` -> `js/sprites.js` -> `js/preview.js` -> `js/main.js`.

## Verification Results

**Per-task automated gates (all pass):** `node --check` on textures.js, sprites.js, preview.js and main.js; contract greps for `buf32` / `Uint32Array` / `packRGBA` / `mulberry32` / `build` / `present` / `>>> 24`; the three new script tags in index.html; and the awk ordering gate proving `js/textures.js` precedes `js/main.js`.

**Texture contract harness — 13/13 (`ALL_TEXTURE_CONTRACTS_PASS`):** 7 keys present; every texture 64x64 with `buf32.length === 4096`, `data.length === 16384`, and `buf32.buffer === data.buffer`; every texel fully opaque; every texture has >= 8 distinct colors (not a flat fill); two fresh builds byte-identical; all 7 mutually distinct.

**Sprite contract harness — 11/11 (`ALL_SPRITE_CONTRACTS_PASS`):** flat shape with `buf32.length === width*height` and shared ArrayBuffer; **alpha strictly binary (only 0 or 255 — no fringe texels, hence no halo)**; every transparent texel is packed `0` exactly; every sprite has both transparent and opaque texels; all four corners transparent (no opaque bounding box); enemy 64x64 / pickup 32x32 / weapon 96x64; byte-identical across builds. ASCII silhouettes rendered from the buffers confirm the shapes read correctly (horns + glowing eyes + limbs; cross-marked case with handle; barrel + receiver + two hands). Coverage: enemy 1921 opaque / 2175 transparent, pickup 762 / 262, weapon 1660 / 4484.

**End-to-end harness — 11/11 (`ALL_E2E_CONTRACTS_PASS`):** parses `index.html` for its real `<script>` order (asserted to be config -> framebuffer -> textures -> sprites -> preview -> main), loads all six files into a vm with a stubbed DOM/canvas, and fires `load`:
- exactly **one** `putImageData`, receiving the `Framebuffer.img` instance;
- framebuffer is 480x270 for a 16:9 viewport;
- **zero non-opaque pixels and zero packed-zero pixels in the framebuffer** — the color key skipped every `alpha < 128` texel, so there is neither a halo nor a transparent hole;
- checker backdrop visible in both shades (transparency demonstrably shows through);
- all 7 textures and all 3 sprites verifiably present in the atlas;
- resize triggers a repaint;
- a second independent boot produces a **pixel-identical** 480x270 atlas;
- a tall/narrow viewport (height clamped to MAX_H=300) renders a fully-opaque atlas without error.
A 6x-downsampled ASCII dump of the composed atlas confirms the 4x3 centred grid layout with every asset in its cell.

**Self-containment negative gate — pass:** zero matches for `type="module"`, `import `, `export `, `require(`, `fetch(`, `XMLHttpRequest`, `new Image`, `http(s)://`, `cdn.`, `node_modules` anywhere under the game directory. All 7 referenced resources exist on disk.

**Static-server check — 5/5 (`STATIC_SERVER_CHECKS_PASS`):** a real `http.createServer` over the game folder returns `200 text/html` for `/`, byte-identical to disk; all 7 referenced resources (style.css + 6 scripts) serve `200` with disk-identical bytes; no absolute, protocol-relative or `file:` URLs are referenced; unknown paths 404 correctly.

## Decisions Made

- **Direct typed-array fills over offscreen-canvas drawing.** CONTEXT decision 5 allowed either. Direct fills keep generation pure and synchronous, avoid any canvas-taint surface entirely, and — decisively — make the generators unit-testable in a headless `vm` sandbox with no DOM, which is what let this autonomous run verify the art contract exhaustively.
- **Mask-then-colorize sprite construction.** Rather than drawing colors and hoping edges stay binary, shapes are drawn into a material mask and alpha is assigned exactly once during colorization. Half-alpha fringe texels become structurally impossible instead of merely unlikely.
- **1px auto-outline on every sprite.** Empty texels touching the silhouette are promoted to a dark rim material, so sprites read against light walls and dark floors alike — computed from a snapshot so the outline cannot cascade.
- **Checker backdrop in the preview.** The plan suggested a flat `CEIL_COLOR` fill; a flat fill can hide a same-colored halo. The checker makes any opaque bounding box or fringe visually unmissable, directly serving checkpoint step 2.
- **Explicit `names` arrays** on both globals, so display order and future wall-id mapping do not depend on object key enumeration order.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Bounds-checked write primitives in every generator**
- **Found during:** Tasks 1 and 2
- **Issue:** The plan required "keep every write index inside `0..width*height-1`" (threat T-01-04) but the natural way to draw shapes — rects, ellipses, tapering spans, horns extending off the top of the head — routinely produces coordinates outside the asset. Unguarded, those become silent wrap-around writes that corrupt the opposite edge of the buffer.
- **Fix:** All texel/mask writes funnel through guarded primitives (`px`, `rect`, `mset`, `mrect`, `mellipse`, `mspan`) that reject out-of-range coordinates, and `Preview.blit` clips its source rectangle on all four sides before looping. Off-canvas geometry now clips cleanly instead of corrupting memory.
- **Files modified:** js/textures.js, js/sprites.js, js/preview.js
- **Verification:** Harness assertions that every texture has plausible structure, that sprite corners are transparent, and that a clamped-height viewport still renders a fully-opaque atlas.
- **Committed in:** 084883c, 0917038, d558f00

### Enhancements Beyond the Plan

**2. Checker backdrop instead of a flat clear** — the plan said "`Framebuffer.clear(CONFIG.CEIL_COLOR)` (or another config color)". Implemented as `clear(CEIL_COLOR)` followed by a subtle 8px two-shade checker, because a flat backdrop can conceal a halo of a similar color. This makes the checkpoint's transparency criterion objectively observable, and the harness asserts both shades survive the blit.

**3. Cell frames and a centred grid** — each asset is drawn inside a 1px-framed cell in a grid centred in the framebuffer, so individual assets are visually delimited rather than abutting.

---

**Total deviations:** 1 auto-fixed (missing-critical memory-safety guard), 2 presentation enhancements
**Impact on plan:** No architectural change. Every locked contract (asset shape, 64x64 textures, alpha<128 color key, seeded determinism, load order) is implemented exactly as specified.

## Issues Encountered

- The static-server harness prints a libuv `UV_HANDLE_CLOSING` assertion on Windows when `process.exit()` races the closing listen socket. All 5 checks print `PASS` and `STATIC_SERVER_CHECKS_PASS` before it fires — this is a Node-on-Windows teardown artifact in the throwaway harness, not a product defect.
- Git emitted the usual benign LF->CRLF warnings on Windows. Content is unaffected.

## Checkpoint Disposition (Task 4)

This is a fully autonomous run with no human available, so every automatable step of the checkpoint was executed:

- **Step 1 (atlas of distinct textures + sprites renders):** proven headlessly — all 7 textures and 3 sprites verifiably land in the framebuffer, all mutually distinct, laid out in a 4x3 centred grid (ASCII dump of the composed 480x270 atlas inspected). Final *visual* crispness in a real browser is delegated.
- **Step 2 (clean sprite transparency, no halo box):** proven stronger than visually — sprite alpha is strictly binary, every sprite's corners are transparent, and after the full atlas blit **zero** framebuffer pixels are non-opaque, which can only happen if every `alpha < 128` texel was skipped and none leaked through.
- **Step 3 (zero errors, zero network requests):** the negative token scan finds no module/fetch/XHR/Image/URL construct anywhere in the game directory; all six scripts parse under `node --check` and execute cleanly under the stubbed-DOM harness with no thrown errors.
- **Step 4 (pixel-identical across reloads):** two independent boots produce a byte-identical 480x270 atlas.
- **Step 5 (static server parity):** a real HTTP server serves index.html and all 7 referenced resources byte-identically with no absolute/`file:` URLs — behavior is path-identical to `file://`.
- **Step 6 (Console inspection of `Textures.map` / `Sprites.map`):** fully covered by assertion — every texture 64x64 with `buf32.length === 4096`; every sprite exposes numeric width/height with `buf32.length === width*height`.

The only residue is the human-judgment part of coverage item **D6**: confirming in a real browser that the GPU nearest-neighbour upscale looks crisp and that DevTools shows an empty console and network pane. That is delegated to the orchestrator's browser screenshot pass. The checkpoint is marked satisfied to the full extent verifiable headlessly and the plan is complete.

## Next Phase Readiness

- **Phase 3 (walls/floors)** can consume `Textures.map` immediately: 5 wall variants plus floor and ceiling, all 64x64 power-of-two so texel coords mask with `& 63`, all seamlessly tiling, all sharing the framebuffer's packed format for single-assignment texel copies.
- **Phase 4 (sprites)** has `Sprites.map`, `Sprites.ALPHA_KEY`, and `Preview.blit` as the reference clipped color-keyed blit; it pairs with the `Float32Array` z-buffer already allocated in Plan 01.
- **Phase 6 (HUD)** can draw the `weapon` viewmodel bottom-centre and the `pickup` art as an icon.
- Later phases needing more art (enemy animation frames, more pickups) extend `Textures.build()` / `Sprites.build()` with new salts — no structural change required.
- No blockers.

## Self-Check: PASSED

All 3 created files and both modified files exist on disk; all 3 task commits (`084883c`, `0917038`, `d558f00`) exist in git history.

---
*Phase: 01-scaffold-config-procedural-assets*
*Completed: 2026-07-23*
