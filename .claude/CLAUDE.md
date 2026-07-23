<!-- GSD:project-start source:PROJECT.md -->

## Project

**DOOM Clone (Browser)**

A playable, browser-based clone of the classic FPS *Doom* — a "2.5D" raycasting
shooter that runs entirely client-side in a web browser with no build step and no
external asset downloads. It is one of several one-shot model-generation entries in
this model-testing repository; this particular entry is authored by **Claude Opus 4.8**
using the **GSD** workflow, and all of its code lives under `Doom/Claude Opus 4.8/GSD/`.

**Core Value:** **You can open it in a browser and immediately play a fun, recognizably-Doom
first-person shooter** — move through a level, fight sprite enemies, shoot weapons,
manage health/ammo, and win or die. If everything else is cut, that end-to-end
playable loop must work.

### Constraints

- **Location**: All code for this entry MUST live under `Doom/Claude Opus 4.8/GSD/` — [keeps model entries isolated in the shared model-testing repo]
- **Tech stack**: Vanilla HTML5 + CSS + JavaScript, Canvas 2D `ImageData` for the software raycaster, Web Audio API for sound — [zero dependencies, no build step, runs by opening a file]
- **No external assets**: Textures, sprites, and audio are generated at runtime — [self-contained, avoids network/CSP/asset-licensing issues]
- **Compatibility**: Must run in a current desktop browser (Chrome/Edge/Firefox) and load from `file://` as well as a static server — [use classic scripts, not ES modules]
- **Performance**: Maintain a smooth frame rate (~60fps target) via a fixed low internal render resolution and typed-array pixel buffers — [software rendering must stay real-time]
- **Autonomy**: Built one-shot without clarifying questions; recommended GSD options chosen by the author — [per the user's explicit instruction]

<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

## Recommended Stack

### Core Technologies

| Technology | Version / Baseline | Purpose | Why Recommended |
|------------|--------------------|---------|-----------------|
| **HTML5 `<canvas>` + Canvas 2D (`getContext("2d")`)** | Baseline (universal) | The render surface and the blit path for the software framebuffer | The whole renderer is a software raycaster that computes each pixel on the CPU. Canvas 2D's `ImageData` gives direct, per-pixel RGBA memory access — exactly what floor/ceiling casting and textured sprites require. WebGL would force a different architecture; the constraint (and the correct call) is Canvas 2D. |
| **`ImageData` + `Uint32Array` framebuffer** | Baseline | The single mutable pixel buffer the raycaster writes into | One 32-bit write per pixel (packed RGBA) is ~4x fewer memory ops than writing R,G,B,A bytes separately. This is the canonical fast-blit technique for JS software renderers. |
| **`Uint8ClampedArray` / `Float32Array` typed arrays** | Baseline | Pixel bytes (`ImageData.data`), texture atlases, and the per-column z-buffer | Contiguous, unboxed numeric storage. `Float32Array(W)` z-buffer for sprite occlusion; typed-array textures for branch-free inner loops. |
| **`requestAnimationFrame`** | Baseline | The game loop, synced to the display refresh | vsync-aligned, throttles on hidden tabs, provides a high-resolution timestamp for delta-time. The only correct loop primitive for a browser game. |
| **Pointer Lock API (`requestPointerLock`, `movementX/Y`)** | Baseline (Promise + `unadjustedMovement` in Chromium; graceful fallback elsewhere) | Mouse-look (yaw, optional pitch shear) | Captures the cursor and delivers relative mouse deltas with no screen-edge clamping — the only way to do proper FPS mouse-look in a browser. |
| **Web Audio API (`AudioContext`, `OscillatorNode`, `GainNode`, noise `BufferSource`)** | Baseline | All SFX, synthesized at runtime | Full DSP graph in the browser: oscillators + noise + gain envelopes + filters produce shooting, hits, pickups, and enemy sounds with zero audio files. |
| **CSS `image-rendering: pixelated`** | Baseline | Crisp nearest-neighbor upscale of the low-res canvas to the viewport | Lets the GPU compositor scale a tiny internal framebuffer up to full-screen for free, giving both the retro look and the performance win. |
| **Vanilla ES (classic, non-module scripts)** | ES2017+ (async/await, etc. all fine) | Application language | Classic `<script>` tags execute from `file://`; ES modules do **not** (blocked by module CORS on the `file:` scheme). This constraint dictates the whole module strategy. |

### Supporting Techniques (native, no libraries)

| Technique | Purpose | When to Use |
|-----------|---------|-------------|
| **Packed 32-bit color** `(a<<24)|(b<<16)|(g<<8)|r` | Store/write colors as a single little-endian `Uint32` | Always. Precompute every texture texel and shaded color in packed form so the raycaster inner loop is one array assignment. |
| **Offscreen procedural texture canvases** (a detached `<canvas>` or `OffscreenCanvas`, or direct typed-array generation) | Draw/generate wall, floor, sprite, and weapon art once at load, then read out to `Uint32Array` texture buffers | At init only. Generating textures into typed arrays at boot avoids any external image files (and thus avoids canvas tainting). |
| **Per-column z-buffer** `Float32Array(INTERNAL_W)` | Store perpendicular wall distance per screen column | Populate during the wall pass; test against it in the sprite pass so walls occlude enemies correctly. One entry per column suffices for a raycaster (walls are vertical spans). |
| **Delta-time with a clamp** `dt = min((now-last)/1000, 0.05)` | Frame-rate-independent movement/physics; prevents tunneling and spiral-of-death after tab refocus | Every frame. Multiply movement (units/sec) and turn (rad/sec) by `dt`. |
| **`DynamicsCompressorNode` + master `GainNode`** | Master bus: prevent clipping when many one-shot SFX overlap; single volume control | Optional but recommended once several sounds can fire at once. |
| **`keydown`/`keyup` → key-state map, read in update** using `event.code` | Buffered, layout-independent keyboard input (WASD/strafe/run/fire) | Always. Never mutate game state directly inside key handlers; sample the state map in the update step. `code` (physical key) survives non-QWERTY layouts. |

### "Development Tools"

| Tool | Purpose | Notes |
|------|---------|-------|
| A modern desktop browser (Chrome/Edge/Firefox) | Run + debug target | Open `index.html` directly via `file://`, or serve statically. Both must work. |
| Browser DevTools Performance panel | Frame budget profiling | Confirm the frame stays under ~16.6 ms; watch for GC pauses from per-frame allocations. |
| (No bundler, no transpiler, no package manager) | — | Deliberately absent. Adding any of these violates the no-build constraint. |

## Rendering Architecture (the load-bearing decisions)

- **Recommended:** Backing store = internal resolution. Do a single `ctx.putImageData(img, 0, 0)` per frame at 1:1, and let CSS `image-rendering: pixelated` scale the element up. No extra per-frame draw; the compositor does the nearest-neighbor upscale on the GPU.
- **Alternative:** Backing store = display size. `putImageData` into a small offscreen canvas, then `ctx.drawImage(offscreen, 0,0,IW,IH, 0,0,W,H)` with `ctx.imageSmoothingEnabled = false`. `drawImage`-based scaling is fast and also nearest-neighbor when smoothing is off, but it costs an extra draw each frame. Prefer the CSS approach unless you need sub-canvas HUD compositing at native resolution.

## Input Details

- **Pointer Lock:** call `canvas.requestPointerLock({ unadjustedMovement: true })` from a click handler. In Chrome/Edge it returns a Promise and disables OS mouse acceleration (raw deltas → consistent aim); Firefox/Safari ignore the option and fall back to OS-adjusted deltas — this degrades gracefully, so feature-detect but don't block on it. Read `event.movementX` (yaw) / `movementY` (optional vertical shear) in a `mousemove` handler, scaled by a sensitivity constant. Handle `pointerlockchange` (pause/resume on unlock via Esc) and `pointerlockerror`.
- **Keyboard:** maintain a `Set`/object of currently-down `event.code` values; sample it in `update(dt)`. Support WASD + arrows (turn), Shift (run), plus fire/use. `preventDefault()` on movement keys so the page doesn't scroll.
- **Autoplay/audio unlock:** create/`resume()` the `AudioContext` on the same first user gesture that requests pointer lock (browsers start it `suspended`).

## Audio Synthesis Details

- **Oscillators** (`square`/`sawtooth`/`triangle`/`sine`) for pitched tones (pistol, pickups, enemy attack pings).
- **White-noise `AudioBufferSourceNode`** (fill an `AudioBuffer` with `Math.random()*2-1`) for shotgun blasts, explosions, hits.
- **`GainNode` envelopes** via `setValueAtTime` + `exponentialRampToValueAtTime` (ramp to a small epsilon like `0.0001`, never exactly 0) for punchy attack/decay.
- **`BiquadFilterNode`** (lowpass/bandpass) to shape noise into distinct textures.
- Schedule everything against `ctx.currentTime`. Route through a master `GainNode` → optional `DynamicsCompressorNode` → `destination`.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Canvas 2D `ImageData` software raycaster | WebGL fragment-shader raycaster | If you needed a much higher internal resolution or true per-pixel lighting. Rejected here: different architecture, against the stated constraint, and unnecessary at a fixed low internal res where Canvas 2D is comfortably real-time. |
| CSS `image-rendering: pixelated` upscale | `drawImage` scale with `imageSmoothingEnabled=false` | If you composite a native-resolution HUD/overlay on top of the upscaled 3D view in the same canvas. Otherwise the CSS path is cheaper (no extra per-frame draw). |
| Clamped variable delta-time | Fixed-timestep accumulator | If collision/AI need determinism or you see tunneling at low frame rates. For a one-shot clone, clamped variable dt is simpler and sufficient; keep the accumulator as a fallback. |
| Classic `<script>` tags | ES modules / bundler | Only if you drop the `file://` requirement and always serve over HTTP. Since `file://` support is a hard constraint, classic scripts are mandatory. |
| Per-shot Web Audio node graphs | Pre-rendered `AudioBuffer` SFX cached at load | If a specific effect is expensive to build every trigger; render it once into a buffer at init and replay. Minor optimization, not needed for typical SFX volumes. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Game engines: Phaser, Three.js, Babylon.js, PixiJS, Unity/Godot (WASM) | Violate zero-dependency + no-build; massive overkill; most don't even solve software raycasting | Hand-written Canvas 2D raycaster |
| **ES modules** (`import`/`export`, `<script type="module">`) | Module scripts are blocked by CORS on the `file:` scheme — the game would fail to load from `file://` | Classic scripts (IIFE / global namespace, or concatenate into one file) |
| Bundlers/transpilers (Webpack, Vite, esbuild, Babel, TypeScript, JSX) | Introduce a build step the project explicitly forbids; add nothing for one self-contained file | Ship plain `.html`/`.js` directly |
| WebGL/WebGPU | Different rendering architecture; unnecessary complexity for a fixed low-res software raycaster | Canvas 2D `ImageData` |
| External textures/sprites/fonts/audio files | Network/CSP/latency issues; loading images from `file://` can **taint** the canvas and break `getImageData`; licensing risk | Procedural textures/sprites into typed arrays + Web Audio synthesis |
| `getImageData` every frame to *read* pixels | Slow and unnecessary; also a tainting trap | Keep your own authoritative `Uint32Array` framebuffer; only `putImageData` out |
| Byte-by-byte pixel writes into `ImageData.data` | ~4x the memory writes of a packed 32-bit write in the hot loop | `Uint32Array` view + packed color |
| `event.key` for movement input | Breaks on non-QWERTY / different layouts and with modifiers | `event.key` only for text; use `event.code` (physical key) for controls |
| `devicePixelRatio`-scaled backing store for the 3D view | Would inflate the pixel count and kill the fixed-cost guarantee | Fixed internal resolution; let CSS + `pixelated` handle display scaling |
| Per-frame allocations (new arrays/objects in the render/update loop) | Triggers GC pauses → frame hitches | Preallocate framebuffer, z-buffer, and scratch arrays once; reuse |

## Stack Patterns by Variant

- Internal resolution `320x200`, aspect-corrected, `image-rendering: pixelated`.
- Because it matches original Doom's pixel density and is the cheapest to render.
- Internal resolution `480x270` or `640x360` (16:9), still upscaled via CSS.
- Because it fills widescreen monitors without letterboxing while keeping pixel count low enough for 60 fps software rendering.
- Lower `INTERNAL_W/H` (fewer rays/pixels) before touching anything else — it's the dominant cost and scales quadratically.
- Because the CSS upscale absorbs the resolution drop with minimal visible impact given the intentional pixel-art aesthetic.

## Version / Compatibility Notes

| Capability | Compatibility | Notes |
|------------|---------------|-------|
| Canvas 2D `ImageData` + `Uint32Array` view | All current desktop browsers; works from `file://` (no cross-origin images, so no taint) | Little-endian assumption holds on all real targets |
| `image-rendering: pixelated` | Chrome/Edge/Firefox/Safari (current) | Safari historically also honored `-webkit-crisp-edges`; include `crisp-edges` as a fallback value |
| Pointer Lock Promise + `unadjustedMovement` | Promise: Chrome/Edge/Firefox. `unadjustedMovement`: Chrome/Edge honor it; Firefox/Safari ignore and fall back gracefully | `await canvas.requestPointerLock({unadjustedMovement:true})` is safe everywhere — `await` on a non-Promise is fine and unknown options are ignored |
| Web Audio API | All current desktop browsers | `AudioContext` starts `suspended`; must `resume()` on a user gesture |
| Classic scripts on `file://` | Universal | ES modules are the thing that breaks here — this is the reason for the classic-script constraint |

## Sources

- MDN — [Element.requestPointerLock()](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestPointerLock) and [Pointer Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API) — confirmed Promise return, `unadjustedMovement` semantics, and cross-browser fallback behavior (HIGH)
- [Intent to Ship: Pointer Lock Unadjusted Movement (Chromium blink-dev)](https://groups.google.com/a/chromium.org/g/blink-dev/c/cQn7OwcMQ64/m/OWmA9KMKBQAJ) — Chromium support for raw movement (HIGH)
- MDN — [CanvasRenderingContext2D.imageSmoothingEnabled](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/imageSmoothingEnabled) and [Crisp pixel art look with image-rendering](https://developer.mozilla.org/en-US/docs/Games/Techniques/Crisp_pixel_art_look) — nearest-neighbor upscale for pixel art (HIGH)
- WHATWG list — [Canvas putImageData: can we scale?](https://lists.w3.org/Archives/Public/public-whatwg-archive/2010Jun/0071.html) — confirmation that `putImageData` ignores the CTM and cannot scale (HIGH)
- Established prior art: Lode Vandevenne's raycasting tutorial (lodev.org/cgtutor/raycasting.html) and the classic Wolfenstein/Doom raycaster technique — architecture for DDA wall casting, floor/ceiling casting, and billboarded sprites with a per-column z-buffer (HIGH, cross-checked against PROJECT.md's stated approach)

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `$gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `$gsd-debug` for investigation and bug fixing
- `$gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `$gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
