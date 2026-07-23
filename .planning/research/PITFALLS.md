# Pitfalls Research

**Domain:** Browser-based raycasting FPS ("2.5D" Doom/Wolfenstein-style software renderer, Canvas 2D + Web Audio, zero-dependency, `file://`-capable)
**Researched:** 2026-07-23
**Confidence:** HIGH (canonical raycasting technique is stable and well-documented — Lode Vandevenne's raycasting tutorial is the definitive reference; browser autoplay/pointer-lock behavior verified current)

> Scope note: this is an **offline, single-player, client-side game**. There is no server, no user data, and no network I/O by design. "Security" and "integration" sections are therefore intentionally light and honest about that — the real risk surface here is **rendering math, performance, and browser-gesture policies**, not auth or data.

---

## Critical Pitfalls

### Pitfall 1: Fisheye distortion (euclidean instead of perpendicular wall distance)

**What goes wrong:**
Walls bulge toward the viewer at screen edges; a flat wall looks curved/warped, and the distortion swings as you turn. The classic "everything looks like a fishbowl" bug.

**Why it happens:**
The naive instinct is to use the true (euclidean) ray length from player to hit point to compute wall column height. That length is longer for rays near the edges of the FOV even when the wall is flat, so edge columns get drawn shorter. The correct value is the **perpendicular distance** to the camera plane (project the ray distance onto the camera's forward direction).

**How to avoid:**
- Use the DDA "which side did we cross" formula for perpendicular distance: `perpWallDist = (sideDistX - deltaDistX)` / `(sideDistY - deltaDistY)` depending on the side hit — this already yields perpendicular distance and avoids a `sqrt`.
- If you compute distance any other way, divide the euclidean distance by `cos(rayAngle - playerAngle)` before turning it into a wall height.
- Compute ray directions via the **camera-plane model** (dir + plane*cameraX), not by adding/subtracting an angle per column — the plane model gives perpendicular distances naturally and keeps FOV consistent.

**Warning signs:**
Straight walls appear convex; the effect is strongest at the left/right screen edges and vanishes at screen center; turning makes walls "breathe."

**Phase to address:** Wall raycaster / core renderer phase (the very first rendering phase). Fix it the moment the first wall column is drawn.

---

### Pitfall 2: Frame-rate-dependent movement (no delta time)

**What goes wrong:**
The player moves/turns faster on a 144 Hz monitor than a 60 Hz one; on a slow frame everything lurches; physics and enemy speeds feel different machine-to-machine. Collision tunneling (Pitfall 5) also gets worse.

**Why it happens:**
Movement written as `x += speed` inside `requestAnimationFrame` assumes a fixed step. `requestAnimationFrame` fires at the display's refresh rate, which is not guaranteed to be 60 Hz.

**How to avoid:**
- Measure `dt = (now - last) / 1000` each frame and scale all motion by it: `x += speed * dt`.
- **Clamp `dt`** (e.g. cap at ~0.05 s / 3–4 frames) so a tab-switch or GC pause doesn't teleport the player through a wall.
- For anything that must be deterministic/stable (collision, projectiles), consider a **fixed-timestep accumulator** loop and render interpolation; for a one-shot clone, clamped delta-time is usually enough.

**Warning signs:**
Game feels "too fast" on some machines; QA on a high-refresh laptop reports rocket-speed movement; behavior changes when devtools throttles CPU.

**Phase to address:** Game-loop / movement phase (as soon as the loop and input exist). Bake delta-time in from the first movement commit — retrofitting it later touches every motion call site.

---

### Pitfall 3: Slow per-pixel rendering (misusing ImageData / too-high internal resolution)

**What goes wrong:**
Frame rate tanks to single digits once floors/ceilings or many columns are drawn. The renderer can't hit 60 fps.

**Why it happens:** Several common mistakes stack up:
- Calling `getImageData`/`putImageData` **per column or per pixel** instead of once per frame. `getImageData` is a readback that can stall the pipeline; do it once (or allocate the buffer once) and `putImageData` once per frame.
- Writing pixels one byte at a time into the `Uint8ClampedArray` (`data[i]=r; data[i+1]=g; …`) instead of using a **`Uint32Array` view** over the same `ArrayBuffer` and writing one 32-bit `0xAABBGGRR` value per pixel.
- Rendering at the canvas's full CSS pixel resolution instead of a **low fixed internal resolution** (e.g. 320×200 or ~640×400) scaled up with CSS + `image-rendering: pixelated`.
- Using `fillRect` per column via the 2D context (state churn) instead of writing into the pixel buffer.
- Per-frame allocation of a new ImageData/typed array (GC churn).

**How to avoid:**
- Allocate one `ImageData` + one `Uint32Array` view **once**, write `buf32[y*w+x] = color`, `ctx.putImageData` once per frame.
- Pick a low internal resolution and scale up; make it a tunable constant so you can trade sharpness for speed.
- Pre-pack all texture pixels into `Uint32` (ABGR little-endian) at load time so the inner loop is a straight array copy with a shade multiply, no per-pixel channel math.
- Set `ctx.imageSmoothingEnabled = false` and use CSS `image-rendering: pixelated` for the upscale.

**Warning signs:**
`putImageData`/`getImageData` showing up hot in a profiler; fps collapses specifically when floor/ceiling casting is enabled; memory sawtooth from per-frame allocations.

**Phase to address:** Core renderer phase (establish the Uint32 framebuffer contract immediately) and revisit in the floor/ceiling phase and a dedicated performance/polish phase.

---

### Pitfall 4: Sprite z-buffer occlusion and sort-order bugs

**What goes wrong:**
Enemies draw **in front of** walls they should be hidden behind; a far enemy paints over a near one; sprites flicker or "pop" through geometry.

**Why it happens:**
Billboarded sprites need two things the wall pass didn't: (a) a **per-column depth buffer** recording each wall column's perpendicular distance, checked per sprite column so sprite pixels behind a wall are skipped; and (b) sprites drawn **back-to-front** (painter's algorithm), sorted by distance from the camera each frame. Skipping either causes the artifacts. A common subtle bug is sorting sprites **near-to-far** (backwards).

**How to avoid:**
- During the wall pass, store `zBuffer[column] = perpWallDist`.
- Each frame, sort visible sprites by squared distance **descending** (farthest first) and draw in that order.
- Transform each sprite into camera space; for each sprite screen-column, draw the pixel only if the sprite's transformed depth `< zBuffer[column]`.
- Reuse the sort array (don't allocate per frame); sort by distance-squared to skip the `sqrt`.

**Warning signs:**
Enemies visible through walls; overlapping enemies render in the wrong stacking order; sprites clip incorrectly when partially behind a corner.

**Phase to address:** Sprite/enemy rendering phase — but the **z-buffer must be produced in the wall phase**, so define that contract early. Verify with two enemies overlapping and one behind a wall.

---

### Pitfall 5: Wall collision tunneling at high speed

**What goes wrong:**
Running (or a lag spike) lets the player pass **through** thin walls; or the player sticks to walls, or slides to a dead stop instead of gliding along them.

**Why it happens:**
- Collision tested only at the destination point with a large step can skip over a thin wall between old and new position (tunneling), especially with unclamped delta-time.
- Testing X and Y movement **together** (single combined check) means hitting a wall on one axis blocks all movement — no wall-sliding. Real games resolve **each axis independently**.
- Using a zero-radius point for the player lets you clip into corners; you need a small collision radius/margin.

**How to avoid:**
- Resolve movement **per axis**: attempt X, check the target cell (plus a radius margin), keep it if free; then independently attempt Y. This yields natural wall-sliding.
- Add a player collision **radius** (e.g. 0.2–0.3 cells) so you can't hug into wall corners or peek through seams.
- Clamp delta-time (Pitfall 2) so a single frame's movement can't exceed roughly one cell; for very high speeds, sub-step the movement.
- Since the map is a grid, collision is a cheap array lookup — no excuse to skip the margin.

**Warning signs:**
Player occasionally ends up outside the level; running into a wall at an angle stops you dead instead of sliding; you can wedge into corners.

**Phase to address:** Movement/collision phase. Verify by sprinting straight into a wall and along it at an angle, and by CPU-throttling to force big frames.

---

### Pitfall 6: Texture seams / off-by-one in texX / texY mapping

**What goes wrong:**
Vertical seam lines, a column of wrong-colored pixels at wall edges, textures that appear mirrored on one wall side, or a shimmering top/bottom row.

**Why it happens:**
- `texX` (horizontal texture coordinate) comes from `wallX` (the exact fractional hit position along the wall). If you don't **flip texX** for walls hit on the opposite side (based on ray direction and which side was hit), adjacent walls mirror and seams appear at corners.
- `texY` stepping: computing texture Y as `(y - screenMidOffset) * texHeight / lineHeight` without a proper **fixed-point step + accumulator** accumulates rounding error, and un-clamped indices read out of the texture (garbage row) when the wall is taller than the screen.
- Reading `texX = int(wallX * texWidth)` can equal `texWidth` exactly at the boundary → out-of-bounds by one. Mask/clamp it (`& (texWidth-1)` for power-of-two textures).

**How to avoid:**
- Use power-of-two textures and bit-mask coordinates (`texX & (texW-1)`), which also makes wrap cheap.
- Apply the standard side-based `texX` flip: if `side==0 && rayDirX>0` or `side==1 && rayDirY<0`, `texX = texW-1-texX`.
- Step `texY` with a precomputed `step = texHeight/lineHeight` and a running `texPos`, clamping when `lineHeight > screenHeight` (compute `drawStart`/`drawEnd` clamped to screen but keep `texPos` referenced to the *unclamped* line so the visible slice maps correctly).

**Warning signs:**
Hairline seams at wall corners; texture looks mirrored across a corner; a flickering single row at the top/bottom of tall near walls; occasional stray pixel of a wrong texture.

**Phase to address:** Wall texturing phase (right after untextured walls work). Test against a texture with an obvious asymmetric pattern (e.g. a number or arrow) so mirroring/seams are visible.

---

### Pitfall 7: Floor and ceiling casting — performance and precision

**What goes wrong:**
Floors/ceilings either destroy frame rate, or "swim"/warp as you move, or show a visible seam at the horizon, or the texture doesn't line up with the walls above it.

**Why it happens:**
- Floor casting is inherently per-pixel over the bottom half of the screen — the single most expensive pass. Done naively (per-pixel trig, per-pixel `getImageData`, or drawn with the 2D context) it's brutally slow.
- Precision: computing floor world coordinates with accumulated float error, or an off-by-one at the horizon row (`y == screenHeight/2` → division by zero for the row distance), produces swimming textures and a seam.
- Mixing a **row-based** floor caster with a **column-based** wall caster is correct and fast, but you must interleave them carefully (draw walls, then fill floor/ceiling per row using `rowDistance = posZ / (y - horizon)`).

**How to avoid:**
- Use the **row-based** floor/ceiling algorithm: for each screen row below the horizon, compute one `rowDistance`, derive the left/right floor world positions once, and step a `floorStepX/Y` per column — no per-pixel trig.
- Guard the horizon row (`y - horizon == 0`) to avoid divide-by-zero.
- Write into the same `Uint32` framebuffer; pack floor/ceiling textures as `Uint32` like walls.
- If performance is still short, this is the first thing to drop to lower internal resolution or replace with flat/shaded colors — treat textured floors as a **tunable**, not a hard requirement.

**Warning signs:**
fps halves the moment floors turn on; floor texture "swims" or shears while walking; a bright/dark seam line exactly at mid-screen; textures on floor don't meet the wall base cleanly.

**Phase to address:** Floor/ceiling phase (after textured walls). Keep a flat-color fallback path so the game stays shippable if textured floors underperform.

---

### Pitfall 8: Pointer lock and audio require a user gesture

**What goes wrong:**
- Mouse-look silently does nothing; `requestPointerLock()` throws or is ignored.
- No sound plays; console warns *"An AudioContext was prevented from starting automatically. It must be created or resumed after a user gesture."* The `AudioContext` sits in `suspended` state forever.

**Why it happens:**
Browsers gate both features behind a **user activation**. `requestPointerLock()` must be called from within a user-gesture event handler (a click), and pointer lock also generally requires the document to be focused/served appropriately. An `AudioContext` created before any user interaction starts **suspended** and will not produce sound until `resume()` is called after a gesture (verified current across Chrome/Firefox/Safari; `resume()` has been baseline since April 2021).

**How to avoid:**
- Put a **title/start screen with a "Click to play" button**. In that click handler: (a) call `canvas.requestPointerLock()`, and (b) call `audioCtx.resume()` (or create the AudioContext there).
- Handle `pointerlockchange` / `pointerlockerror`; re-request lock on canvas click after the user presses Esc (Esc always exits pointer lock — design the UI around that, it can't be prevented).
- Provide a keyboard-turn fallback (arrow keys) so the game is playable even if pointer lock is denied.
- Check `document.pointerLockElement` before consuming `movementX/Y`.

**Warning signs:**
Mouse-look works only after clicking; audio works only after some interaction; console autoplay warning; QA reports "no sound on load."

**Phase to address:** Input/pointer-lock phase and the audio-init phase, unified by the **title-screen / game-state phase** (the start button is the single gesture that unlocks both). Design the state machine so nothing needing a gesture runs before the start click.

---

### Pitfall 9: Transparent-sprite handling (color-key / alpha)

**What goes wrong:**
Enemy and weapon sprites render with an opaque rectangular box of background color around them, or the "transparent" color bleeds a halo, or fully transparent pixels still get depth-tested/drawn.

**Why it happens:**
Billboarded sprites are rectangular; the silhouette must be cut out. If you color-key a magic color (e.g. `0xFF00FF`) but your procedural generation or scaling **interpolates** edges, near-key colors survive and show as halos. If you draw sprite pixels without an alpha/transparency test, the whole quad is opaque.

**How to avoid:**
- Since sprites are **generated procedurally to offscreen canvases**, bake a real **alpha channel** and test `alpha !== 0` (or a high threshold) per pixel — cleaner than color-keying.
- If color-keying, pick a color that never appears in the art and compare exactly; **disable image smoothing** (`imageSmoothingEnabled=false`) everywhere so no interpolation creates near-key pixels.
- Pack sprite pixels as `Uint32` with alpha in the high byte; skip pixels where the top byte is 0 in the draw loop (this also skips the z-test cheaply).

**Warning signs:**
Rectangular halos around enemies; pink/magenta fringe; sprite corners occlude walls behind them (opaque box).

**Phase to address:** Sprite generation phase and sprite rendering phase. Verify enemies over a contrasting wall so any box/halo is obvious.

---

### Pitfall 10: `file://` and ES-module / asset-loading breakage

**What goes wrong:**
Opening `index.html` directly gives a blank page and console errors: modules blocked by CORS, `fetch()`/XHR of local files failing, or textures loaded from external files not appearing.

**Why it happens:**
`file://` origins block ES module loading (CORS), and `fetch`/`XMLHttpRequest` of local files is disallowed. Anything assuming a web server won't run when double-clicked.

**How to avoid (mostly already decided in PROJECT.md):**
- Use **classic `<script>` tags**, not `type="module"` — confirmed as the project's decision. Keep it that way; don't reintroduce `import`/`export`.
- Generate **all textures/sprites procedurally** (canvas) and **synthesize all audio** (Web Audio) — no `fetch`, no `<img src>` to external files, no audio files. Already the plan; the pitfall is *drifting* from it (e.g. someone base64-inlines an asset via `fetch('data:...')` or adds a module during refactor).
- If you ever must namespace, use a single global object or an IIFE, not modules.

**Warning signs:**
Works via `python -m http.server` but blank on double-click; console shows "Cross-Origin Request Blocked" or "access to script at file:// blocked"; any `import` statement in the codebase.

**Phase to address:** Foundation/scaffold phase (set the classic-script + procedural-asset contract on day one) and guard it in every later phase's review. Verify by **always testing from `file://`**, not just a dev server.

---

## Moderate Pitfalls

### DDA edge cases — division by zero and grid-aligned rays
A ray with `rayDirX == 0` or `rayDirY == 0` makes `deltaDist` infinite. The standard fix is to let `deltaDistX = (rayDirX == 0) ? 1e30 : abs(1/rayDirX)` — Infinity actually works in JS math here, but guarding with a large constant is safer and avoids NaN when multiplied by zero. Also: a ray hitting exactly on a grid intersection can pick the "wrong" side; consistent tie-breaking prevents a flickering column.

### Mouse-look sensitivity and `movementX` accumulation
Multiply `movementX` by a sensitivity constant and rotate; do **not** scale mouse delta by delta-time (mouse input is already per-event, not per-time). Accumulate `movementX` across the multiple mouse events that can fire per frame. Watch for huge single deltas after regaining focus — clamp them.

### Distance shading banding / darkness
Linear `1/dist` shading either blows out near walls or crushes far ones to black too fast. Use a capped/tuned falloff and precompute a **shade lookup table** (multiply packed Uint32 channels) rather than per-pixel float math. Ensure fully-dark still shows silhouette so enemies aren't invisible in dark rooms.

### Sprite vertical placement and scale
Billboards must be scaled by `screenHeight / transformedDepth` and **vertically anchored** correctly (floor-standing enemies vs centered), with an optional vertical offset (`vMove`) for floating things. Getting the anchor wrong makes enemies float or sink into the floor as you approach.

### Hitscan weapons firing through walls
A hitscan shot must **DDA-march like a ray** and stop at the first wall, only hitting an enemy if the enemy is closer than that wall along the shot. Skipping the wall check lets you shoot enemies through walls. The **same DDA** powers enemy line-of-sight for AI.

### Web Audio node lifecycle
Creating oscillator/gain nodes per sound is correct (they're one-shot and GC after `stop()`), but **forgetting to `stop()`** or holding references leaks; ramping gain to avoid clicks (`setValueAtTime` + `linearRampToValueAtTime`) prevents pops. Don't create a new `AudioContext` per sound — one shared context.

### Minimap redraw cost
Redrawing the whole map with per-cell `fillRect` every frame is wasteful. Pre-render the static map to an offscreen canvas once; each frame just blit it and draw the moving player/enemy dots.

### `putImageData` ignores canvas transforms
`putImageData` is **not** affected by `ctx.scale()` or `imageSmoothingEnabled`. To upscale a low-res framebuffer, either draw the small framebuffer to a small canvas and CSS-scale it with `image-rendering: pixelated`, or `drawImage` the small canvas onto the big one — don't expect `putImageData` to scale.

---

## Minor Pitfalls

- **Sticky keys after focus loss:** if the window blurs mid-keypress, `keyup` may never fire → player runs forever. Clear the input state on `blur`.
- **Canvas backing-store vs CSS size:** set `canvas.width/height` (internal resolution) separately from CSS size (display size); confusing them causes blur or wrong aspect.
- **Aspect ratio / FOV coupling:** FOV is set by the camera-plane length; a wrong plane length gives a stretched or pinched view. ~66° (plane length 0.66 for dir length 1) is the Wolfenstein-standard.
- **Angle wraparound:** keep player angle in `[0, 2π)`; unbounded growth is fine mathematically but can hurt float precision over a long session.
- **`requestAnimationFrame` not pausing:** keep ticking (or explicitly pause) when the tab is hidden; combined with unclamped dt this is a tunneling source (covered in Pitfall 2/5).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Per-byte writes to `Uint8ClampedArray` instead of `Uint32` view | Simpler to write first | 2–4× slower inner loop; forces later rewrite of every draw path | Never for the hot path — establish Uint32 framebuffer from the start |
| Flat-color floors/ceilings instead of textured | Big perf headroom, simpler | Less "Doom-like" look | Acceptable as a shippable fallback; keep the textured path behind a flag |
| Combined-axis collision (no wall sliding) | A few lines less code | Feels terrible; movement gets stuck; players notice immediately | Never — per-axis sliding is table stakes |
| No delta-time ("assume 60fps") | Simplest loop | Breaks on high-refresh displays and lag; retrofitting touches all motion | Never — bake dt in from first movement |
| Color-key transparency (vs baked alpha) | Slightly simpler sprite gen | Halos with any smoothing; fragile | Only if smoothing is globally off and key color is guaranteed unused |
| Euclidean distance + `cos` correction (vs camera-plane perpDist) | Intuitive to derive | Extra `cos`/`sqrt` per column; easy to forget correction → fisheye | Fine if you *always* apply the correction; camera-plane model is cleaner and faster |
| Recomputing sprite sort every frame with `sqrt` and fresh arrays | Easy | GC churn + slower with many enemies | Fine at low enemy counts; use dist² and a reused array |

---

## Integration Gotchas

This game integrates with **browser platform APIs only** (no external services). The gotchas are gesture/state policies, not network integrations.

| Browser API | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Pointer Lock | Calling `requestPointerLock()` on load or outside a user gesture | Call it inside a click handler (start button / canvas click); handle `pointerlockerror` and Esc-exit; provide keyboard-turn fallback |
| Web Audio | Creating/using `AudioContext` before interaction → stuck `suspended` | Create or `resume()` the single shared context in the start-button click handler; check `state === 'running'` |
| Canvas ImageData | Expecting `putImageData` to honor `scale()`/smoothing for upscale | Render low-res, then CSS `image-rendering: pixelated` or `drawImage` to upscale |
| `requestAnimationFrame` | Assuming fixed 60 Hz cadence | Use measured, clamped delta-time |
| Keyboard input | Not clearing keys on `blur`; letting game keys scroll the page | Reset input on blur; `preventDefault()` on game keys (WASD/space/arrows) |
| `file://` origin | Reintroducing ES modules or `fetch` during refactor | Keep classic scripts + procedural assets; test from `file://` every phase |

---

## Performance Traps

Expected scale for this project is a **single level, one screen, tens of enemies, ~60 fps on a mid desktop**. Traps below are framed to that scale, not hypothetical MMO scale.

| Trap | Symptoms | Prevention | When it breaks |
|------|----------|------------|----------------|
| Full-CSS-resolution rendering | fps scales inversely with window size; fullscreen kills it | Fixed low internal resolution (e.g. 320×200) upscaled | Immediately on a large/hi-DPI monitor |
| Floor/ceiling per-pixel trig | fps halves when floors enabled | Row-based caster + Uint32 packing; flat-color fallback | As soon as textured floors turn on |
| Per-frame allocations (ImageData, sort arrays, temp objects) | Sawtooth memory, periodic GC hitches | Allocate once, reuse buffers; object pools for projectiles/particles | ~1–2 min into play, worse with many entities |
| `getImageData` in the render loop | Constant low fps, pipeline stalls in profiler | Never read back per frame; keep a CPU-side framebuffer | Immediately |
| Sorting/updating all enemies every frame regardless of visibility | fps drops as enemy count grows | Cheap distance²; only fully process nearby/active enemies | Dozens of enemies |
| Creating audio nodes without stopping them | Rising memory, eventual crackle | `stop()` one-shot nodes; ramp gain; one shared context | Rapid fire (shotgun spam) |
| Redrawing static minimap per frame with fillRect | Minor but real per-frame cost | Pre-render map to offscreen canvas, blit + dynamic dots | Larger maps / many cells |

---

## Security Mistakes

This is an **offline, single-player, no-network, no-user-data** game. Classic web-app risks (XSS, CSRF, injection, auth) are largely **N/A by design**. The honest, domain-relevant items:

| Mistake | Risk | Prevention |
|---------|------|------------|
| Injecting dynamic strings into the DOM via `innerHTML` for HUD/messages | If any text ever came from a URL param or external source, XSS | Use `textContent`; if HUD text is ever templated, never `innerHTML` untrusted input (game text is all internal, so low risk) |
| Reintroducing external asset fetches later | CSP/CORS breakage and a new network attack surface; breaks `file://` | Keep the zero-network, procedural-asset contract |
| Assuming `file://` = safe to add `eval`/dynamic script | Habits that would be unsafe in a hosted context | Avoid `eval`/`new Function` entirely; not needed here |

> Bottom line: security is **not** the risk axis for this project; correctness and performance are. Don't over-invest here.

---

## UX Pitfalls

| Pitfall | User impact | Better approach |
|---------|-------------|-----------------|
| No "click to start" screen | Mouse-look and audio silently dead on load (gesture policy) | Title screen with a start button that grabs pointer lock + resumes audio |
| Esc exits pointer lock unexpectedly | Player thinks the game froze / lost mouse | Show a "click to resume" overlay on pointer-lock loss; re-grab on click |
| No keyboard-turn fallback | Unplayable if pointer lock is denied/unsupported | Arrow keys turn as a fallback |
| Enemies invisible in dark rooms (over-aggressive shading) | Players get shot by things they can't see | Floor shading to a minimum brightness; keep silhouettes readable |
| No hit/damage feedback | Combat feels dead; unclear if shots land | Muzzle flash, hit flinch/sound, red screen flash on player damage, kill count |
| Mouse sensitivity un-tunable or frame-coupled | Feels sluggish or twitchy | Constant sensitivity, event-based (not dt-scaled); optionally expose a slider |
| Weapon/HUD not conveying ammo/health state clearly | Player dies confused | Always-visible HUD (health/armor/ammo/weapon/crosshair) + on-screen messages |
| Audio too loud / clicky | Unpleasant; startles | Gain ramps to kill clicks; sane master volume; synthesized SFX mixed low |

---

## "Looks Done But Isn't" Checklist

- [ ] **Walls render:** but verify **no fisheye** — stand parallel to a long wall and confirm it's straight edge-to-edge.
- [ ] **Textures applied:** but verify **no seams/mirroring** — use an asymmetric test texture at a corner.
- [ ] **Movement works:** but verify it's **delta-timed** — test on a 120/144 Hz display or with CPU throttling; speed must be constant.
- [ ] **Collision works:** but verify **no tunneling at run speed** and **wall-sliding** along angled walls; throttle CPU to force big frames.
- [ ] **Enemies render:** but verify **z-buffer occlusion** (enemy behind wall is hidden) and **back-to-front sort** (overlapping enemies stack correctly).
- [ ] **Sprites transparent:** but verify **no rectangular halo/box** over a contrasting background.
- [ ] **Floors/ceilings render:** but verify **no swim, no horizon seam**, and fps still acceptable; confirm flat-color fallback exists.
- [ ] **Mouse-look works:** but verify it only starts **after the gesture**, survives **Esc-exit + re-grab**, and has a **keyboard fallback**.
- [ ] **Audio plays:** but verify the context isn't stuck **suspended** — check it resumes on the start click, and no autoplay warning in console.
- [ ] **Shooting works:** but verify hitscan **stops at walls** (can't shoot through geometry) and AI **line-of-sight** does too.
- [ ] **It runs on a dev server:** but verify it **also runs from `file://`** (double-click `index.html`) — no modules, no fetch.
- [ ] **Performance at start:** but verify **no memory sawtooth / GC hitching** after a few minutes and during shotgun spam.
- [ ] **Win/lose exists:** but verify **both** the exit-reached win and health-depleted death transition to their screens and can restart.

---

## Recovery Strategies

| Pitfall | Recovery cost | Recovery steps |
|---------|---------------|----------------|
| Fisheye distortion | LOW | Switch to camera-plane perpDist, or divide by `cos(rayAngle - playerAngle)`; one formula, one place |
| No delta-time (retrofit) | MEDIUM | Thread `dt` through every motion call site; add clamp; re-tune all speed constants |
| Per-byte / high-res rendering | MEDIUM–HIGH | Introduce Uint32 framebuffer + low internal res; rewrite all pixel writes and texture packing |
| Sprite z/sort bugs | LOW | Add per-column zBuffer in wall pass; sort sprites dist² descending; per-pixel depth test |
| Collision tunneling / no sliding | LOW–MEDIUM | Split into per-axis resolution + radius margin + dt clamp/substep |
| Texture seams/mirroring | LOW | Apply side-based texX flip; mask indices; fixed-point texY step with clamp |
| Floor caster perf/precision | MEDIUM | Swap to row-based caster; guard horizon; provide flat-color fallback |
| Audio stuck suspended | LOW | Move context create/resume into the start-button click handler |
| Pointer lock not engaging | LOW | Move `requestPointerLock` into a click handler; add `pointerlockerror` + keyboard fallback |
| Sprite halos | LOW | Bake alpha channel + disable smoothing; skip alpha==0 pixels |
| `file://` broken by modules | LOW | Remove `import/export`; use classic scripts / IIFE globals |

---

## Pitfall-to-Phase Mapping

Phase names are by **topic** (roadmap ordering may differ); each pitfall's prevention is anchored to the earliest phase that owns the relevant code.

| Pitfall | Prevention phase (topic) | Verification |
|---------|--------------------------|--------------|
| Fisheye distortion | Core wall raycaster | Long parallel wall is straight edge-to-edge |
| Frame-rate-dependent movement | Game loop / movement | Constant speed on 60 vs 144 Hz and under CPU throttle |
| Slow ImageData rendering | Core renderer (framebuffer contract) + perf phase | Profiler shows no per-frame getImageData; 60 fps at target res |
| Sprite z-buffer / sort | Wall phase (produce zBuffer) + sprite phase (consume) | Enemy behind wall hidden; overlapping enemies stack right |
| Wall collision tunneling | Movement / collision | Sprint into wall, slide along angled wall, throttled frames |
| Texture seams / off-by-one | Wall texturing | Asymmetric test texture shows no seam/mirror at corners |
| Floor/ceiling perf & precision | Floor/ceiling phase | No swim/seam; fps holds; flat-color fallback exists |
| Pointer lock + audio gesture | Input/pointer-lock + audio-init, unified in title/state phase | Mouse-look + sound only after start click; Esc re-grab works |
| Transparent sprites | Sprite generation + sprite render | No halo/box over contrasting wall |
| `file://` / ES modules | Foundation/scaffold (contract) + every review | Double-click `index.html` runs fully |
| Hitscan/AI through walls | Weapons + enemy AI | Can't shoot/see enemies through geometry |
| Audio node lifecycle / clicks | Audio phase | No pops; stable memory under shotgun spam |

---

## Sources

- Lode Vandevenne, *Raycasting* tutorial (lodev.org/cgtutor) — the canonical reference for perpendicular-distance/camera-plane math, DDA wall casting, texture coordinate flipping and stepping, row-based floor/ceiling casting, and sprite z-buffer + back-to-front sorting. HIGH confidence; stable, widely-implemented technique.
- MDN — Pointer Lock API (user-gesture requirement, `pointerlockchange`/`pointerlockerror`, Esc-exit behavior). HIGH confidence.
- MDN / Chrome for Developers — Autoplay policy & [`AudioContext.resume()`](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume): AudioContext starts `suspended` before a user gesture; `resume()` after a gesture; `resume()` baseline since April 2021. Verified current 2026-07-23. HIGH confidence.
- MDN — Canvas `ImageData` / `putImageData` semantics (ignores context transforms and smoothing; typed-array pixel access). HIGH confidence.
- MDN — `requestAnimationFrame` (fires at display refresh rate, not fixed 60 Hz) → delta-time necessity. HIGH confidence.
- Domain/practitioner experience with browser software raycasters (Uint32 framebuffer packing, per-axis collision + radius, procedural-asset + classic-script pattern for `file://`). MEDIUM–HIGH confidence (well-established community practice).

---
*Pitfalls research for: browser-based raycasting FPS (Doom clone)*
*Researched: 2026-07-23*
