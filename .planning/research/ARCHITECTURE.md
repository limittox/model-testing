# Architecture Research

**Domain:** Browser raycasting FPS engine (software renderer, "2.5D" Doom/Wolfenstein-style)
**Researched:** 2026-07-23
**Confidence:** HIGH

Canonical, stable domain. The architecture below matches the reference implementations documented by Lode Vandevenne (lodev.org/cgtutor) and Permadi, cross-checked against multiple independent engines. The core math is textbook and unchanged for 30 years.

## Standard Architecture

A raycaster is a pipeline that turns a 2D grid + player pose into a 2D framebuffer, once per frame. There is no true 3D geometry: "height" is faked by drawing vertical wall stripes whose on-screen height is inversely proportional to distance. All modules share one global scope (classic scripts), so "boundaries" here are conceptual/file boundaries, not module imports.

### System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                         GAME LOOP (RAF)                            │
│      input → update(dt) → render() → present → repeat             │
├──────────────────────────────────────────────────────────────────┤
│   INPUT          │            SIMULATION (update)                 │
│  ┌──────────┐    │   ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Keyboard │    │   │  Player  │ │ Entities │ │   Weapons /  │  │
│  │ Mouse /  │───▶│   │  move +  │ │  AI /    │ │   hitscan    │  │
│  │ ptrlock  │    │   │ collide  │ │ projec.  │ │   + pickups  │  │
│  └──────────┘    │   └────┬─────┘ └────┬─────┘ └──────┬───────┘  │
│                  │        │            │              │           │
│                  │        ▼            ▼              ▼           │
│                  │   ┌────────────────────────────────────────┐  │
│                  │   │        GAME STATE (single source)       │  │
│                  │   │  player{x,y,dir,plane}  map[][]         │  │
│                  │   │  entities[]  items[]  hud/score/msgs    │  │
│                  │   └────────────────────┬───────────────────┘  │
├───────────────────────────────────────────┼──────────────────────┤
│                       RENDERER (read-only over state)             │
│                                            ▼                       │
│   ┌────────────┐  writes zBuffer[x]  ┌──────────────┐            │
│   │ 1. Floor/  │────────────────────▶│              │            │
│   │   ceiling  │                     │  ImageData   │            │
│   ├────────────┤                     │  framebuffer │            │
│   │ 2. Walls   │──── DDA per column ▶│  (Uint32/8)  │            │
│   │   (fills   │  sets zBuffer[x]    │              │            │
│   │   zBuffer) │                     │              │            │
│   ├────────────┤                     │              │            │
│   │ 3. Sprites │  tests zBuffer[x]   │              │            │
│   │  (sorted,  │────────────────────▶│              │            │
│   │  occluded) │                     │              │            │
│   ├────────────┤                     └──────┬───────┘            │
│   │ 4. Weapon/ │                            │ putImageData        │
│   │   HUD/msgs │───────────────────────────▶│ then DOM/2D overlay │
│   └────────────┘                            ▼                     │
│                                    <canvas> (scaled, pixelated)   │
├──────────────────────────────────────────────────────────────────┤
│              ASSETS (built once at load, read-only)               │
│   ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────────┐  │
│   │  Textures  │ │  Sprites   │ │   Level    │ │ Audio (Web   │  │
│   │ (proc gen) │ │ (proc gen) │ │  (grid +   │ │ Audio graph, │  │
│   │            │ │            │ │  spawns)   │ │ synth SFX)   │  │
│   └────────────┘ └────────────┘ └────────────┘ └──────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **Assets: Textures** | Provide wall/floor/ceiling texel arrays | N textures drawn procedurally to offscreen canvases at load; pixels read once into flat `Uint32Array`/`Uint8ClampedArray` per texture (reading `getImageData` per-frame is a fatal perf mistake) |
| **Assets: Sprites** | Provide enemy/weapon/pickup frames | Same as textures; per animation-frame texel arrays plus width/height + a transparent/color-key channel |
| **Level** | Static world: wall grid, spawn points, item placements, exit | 2D array of ints (0 = empty, >0 = wall texture id); parallel lists of spawn descriptors. Often a string map decoded at load |
| **Player** | Position/orientation + movement, strafe, run, collision, health/armor/ammo/current weapon | `{x, y, dirX, dirY, planeX, planeY}` (vector form) plus stats. Owns collision vs. grid |
| **Input** | Translate raw events → intent flags | Key state map + accumulated mouse dX (pointer lock). Never mutate game state directly from event handlers; set flags read by `update()` |
| **Entities** | Enemies, projectiles, pickups as world objects | Array of `{x, y, type, state, health, sprite, ...}`. Uniform update loop; type/state switch for behavior |
| **AI** | Per-enemy state machine: idle → chase (LOS) → attack → hurt → die | Line-of-sight via a ray march on the grid; simple pursue toward player; timers for attack cadence and death animation |
| **Weapons** | Fire (hitscan), ammo cost, muzzle flash, weapon bob | Hitscan = one DDA-style ray from player; first entity hit within wall distance takes damage |
| **Renderer** | Read state → produce one framebuffer | 4 ordered passes: floor/ceiling, walls (+zBuffer), sprites (occluded), weapon+HUD. Pure over state — writes only the framebuffer + zBuffer |
| **HUD** | Health/armor/ammo/weapon/kills/crosshair/messages/minimap | Cheap items drawn into framebuffer or as a separate 2D/DOM overlay on top of the scaled canvas |
| **Audio** | Synthesized SFX for shots/hits/pickups/pain | Web Audio graph built lazily on first user gesture (autoplay policy); short oscillator/noise-buffer voices per event |
| **Game Loop** | Orchestrate input→update→render; manage screens | `requestAnimationFrame`; fixed or clamped `dt`; title/play/victory/death state machine |

## Recommended Project Structure

Classic (non-module) scripts loaded in dependency order from `index.html`. All share global scope; treat file boundaries as the module boundaries. Load order encodes the dependency graph.

```
Doom/Claude Opus 4.8/GSD/
├── index.html          # <canvas> + ordered <script> tags + pointer-lock hooks
├── style.css           # canvas sizing, image-rendering: pixelated, letterbox
└── js/
    ├── config.js       # constants: internal W/H, FOV/plane len, tile size, colors
    ├── textures.js     # procedural texture generation → flat texel arrays
    ├── sprites.js      # procedural enemy/weapon/pickup frames → texel arrays
    ├── audio.js        # Web Audio graph + synth SFX voices (lazy-init)
    ├── level.js        # map grid, spawn/item tables, exit marker, LOS helper
    ├── player.js       # player state, movement, strafe/run, grid collision
    ├── input.js        # keyboard/mouse/pointer-lock → intent flags
    ├── entities.js     # entity list, spawn, update dispatch, projectiles, pickups
    ├── ai.js           # enemy state machine (idle/chase/attack/hurt/die), LOS use
    ├── weapons.js      # weapon defs, hitscan fire, ammo, muzzle flash, bob
    ├── renderer.js     # framebuffer, zBuffer, walls/floor/sprites passes
    ├── hud.js          # health/ammo/weapon/kills/crosshair/messages/minimap
    └── game.js         # state machine (title/play/win/lose) + RAF main loop
```

### Structure Rationale

- **`config.js` first:** Internal render resolution, FOV (via camera-plane length), and tile size are referenced everywhere. Centralize so tuning is one edit.
- **Assets before world:** `textures.js`/`sprites.js`/`audio.js` are pure producers with no dependencies — they can be built and eyeballed in isolation before any gameplay exists.
- **`renderer.js` depends on `level.js` + `player.js` + `textures.js`:** It only *reads* them, so those must be stable first. It also exposes the shared `zBuffer` that the sprite pass and (optionally) hitscan reuse.
- **`game.js` last:** It wires everything and owns the loop; nothing depends on it, so it changes most and sits at the top of the load order.
- **One global namespace, thin objects:** For a one-shot classic-script build, a handful of top-level objects (`Player`, `Level`, `Renderer`, `Input`, `Game`) is clearer than faux-modules. Avoid deep inheritance; entities are plain objects in an array.

## Architectural Patterns

### Pattern 1: Vector camera model (dir + camera plane), not angle + trig tables

**What:** Represent the player as a direction vector `(dirX, dirY)` and a perpendicular camera plane `(planeX, planeY)`. The plane length relative to dir sets the FOV. Each column's ray is `rayDir = dir + plane * cameraX` where `cameraX = 2*x/W - 1` runs from -1 (left) to +1 (right).

**When to use:** Always, for a DDA raycaster. Rotation is a single 2D rotation applied to both dir and plane — no per-column `atan`/`cos` and no fisheye-correction table.

**Trade-offs:** Slightly less intuitive than "player angle," but faster, simpler rotation, and makes perpendicular-distance correction fall out naturally. This is the modern standard.

```javascript
// FOV ≈ 2*atan(|plane|/|dir|); 0.66 plane over unit dir ≈ 66°
let dirX=-1, dirY=0, planeX=0, planeY=0.66;
// rotate by rot (both vectors, same matrix):
const c=Math.cos(rot), s=Math.sin(rot);
[dirX,dirY]   = [dirX*c - dirY*s,   dirX*s + dirY*c];
[planeX,planeY]=[planeX*c-planeY*s, planeX*s+planeY*c];
```

### Pattern 2: DDA grid traversal for wall casting

**What:** March a ray cell-by-cell through the grid, always stepping to the nearer of the next vertical or horizontal grid line, until a wall cell is hit. `deltaDist` is the ray length between grid lines on each axis; `sideDist` tracks the running distance to the next line.

**When to use:** The wall pass, once per screen column. O(cells crossed), exact, no floating-point drift.

**Trade-offs:** Only handles a uniform grid of full-height walls — which is exactly the Doom-clone scope (variable floor heights are explicitly out of scope).

```javascript
// per column x:
deltaDistX = Math.abs(1/rayDirX);   // (guard rayDir==0 → Infinity)
deltaDistY = Math.abs(1/rayDirY);
// init step / sideDist from player frac position, then:
while (!hit) {
  if (sideDistX < sideDistY) { sideDistX+=deltaDistX; mapX+=stepX; side=0; }
  else                       { sideDistY+=deltaDistY; mapY+=stepY; side=1; }
  if (map[mapX][mapY] > 0) hit = true;
}
// PERPENDICULAR distance (kills fisheye):
perpDist = (side===0) ? (sideDistX - deltaDistX) : (sideDistY - deltaDistY);
```

Then the wall stripe: `lineHeight = H / perpDist`; draw a vertical column centered on the horizon. Texture column: compute exact hit point `wallX` (fractional part of where the ray crossed), `texX = floor(wallX * TEX_W)`; step the texture V-coordinate down the stripe with a fixed increment. Use `perpDist` for distance shading (darken far / y-side walls).

### Pattern 3: Shared 1D z-buffer for sprite occlusion

**What:** During the wall pass, store `perpDist` for each column into `zBuffer[x]`. Sprites are billboards: project each entity to screen, and for every one of its vertical stripes, draw a texel only if `spriteDist < zBuffer[x]`. Draw sprites **back-to-front** (sort by distance descending) so overlapping sprites layer correctly.

**When to use:** The only sane way to occlude sprites behind walls and each other in a raycaster. 1D (per-column) buffer is enough because walls are full-height per column.

**Trade-offs:** Sprite-vs-sprite needs the sort (a 2D per-pixel z-buffer avoids sorting but costs memory/bandwidth — unnecessary here). Transparent texels must be skipped via a color key / alpha check.

```javascript
// project entity relative to camera, invert the [dir|plane] matrix:
const invDet = 1/(planeX*dirY - dirX*planeY);
const transformX = invDet*(dirY*relX - dirX*relY);
const transformY = invDet*(-planeY*relX + planeX*relY); // depth (>0 = in front)
const screenX = (W/2)*(1 + transformX/transformY);
const spriteH = Math.abs(H/transformY);
// per stripe column x of the sprite:
if (transformY>0 && x>=0 && x<W && transformY < zBuffer[x]) { /* draw texel */ }
```

### Pattern 4: Row-based floor/ceiling casting

**What:** Instead of casting per column, cast per horizontal screen *row* below/above the horizon. For a given row `y`, the world-space distance to the floor is constant, so you can linearly interpolate floor world coordinates across the row and sample the floor (and mirror for the ceiling). Do this pass first — it fills the whole background; walls and sprites overwrite it.

**When to use:** Textured floors/ceilings (a listed requirement). Cheaper and simpler than per-column floor casting.

**Trade-offs:** More math per pixel than a flat-color fill; if perf is tight, a solid/gradient floor+ceiling is an acceptable fallback. Keep the interpolation in the inner loop tight (no per-pixel divides).

## Data Flow

### Per-frame flow (how one frame is produced)

```
raw events ──▶ Input flags ──▶ update(dt):
                                  Player.move/collide ─┐
                                  Entities/AI update  ─┤─▶ mutate GAME STATE
                                  Weapons/pickups     ─┘        │
                                                                ▼
                              render():  (reads state, writes framebuffer)
                                1. floor/ceiling  → framebuffer
                                2. walls (DDA)    → framebuffer + zBuffer[x]
                                3. sprites sorted → framebuffer (test zBuffer[x])
                                4. weapon + HUD   → framebuffer / overlay
                                                                │
                              ctx.putImageData(framebuffer) ────▼
                              canvas scaled up (image-rendering: pixelated)
```

**One-directional rule:** state flows *into* the renderer; the renderer never mutates game state. Input handlers only set flags — they never touch positions/health directly (keeps update deterministic and decouples event timing from the sim).

### State management

There is one authoritative game state (player + map + entities + hud/score), mutated only inside `update()`. The renderer, HUD, and minimap are read-only views of it. Audio is fired as a side effect of state transitions (shot fired, entity damaged, item picked up), triggered from `update()`, not the renderer.

### Key data flows

1. **Turn/move:** input dX/keys → rotate `(dir,plane)` and translate `(x,y)` with grid collision → next frame's wall pass sees new pose.
2. **Wall→sprite occlusion:** wall pass writes `zBuffer[x]`; sprite pass reads it. The zBuffer is the sole coupling between the two passes and must be filled before sprites draw.
3. **Hitscan fire:** weapon fire marches a ray (reuse DDA logic); first entity within wall distance along that ray takes damage → AI transitions to hurt/die → SFX.
4. **Pickup:** player-vs-item proximity check in `update()` → grant health/armor/ammo/weapon → remove item → HUD message + SFX.

## Scaling Considerations

"Scale" here is **frame budget**, not users. Target ~60fps means ~16ms/frame; the software renderer dominates cost, and cost is roughly `internalW * internalH` pixels touched.

| Scale | Architecture adjustments |
|-------|--------------------------|
| Small level, ≤~20 enemies, 320×200 internal | Naïve implementation is fine. Full-resolution walls + row floor casting + sorted sprites all fit the budget. |
| Denser scenes / higher internal res | Lower internal resolution and upscale via CSS (`image-rendering: pixelated`); this is the biggest single lever. Precompute texel arrays; avoid per-frame allocations. |
| Perf still tight | Write the framebuffer as a `Uint32Array` view over the `ImageData.data` buffer (one 32-bit store per pixel). Skip floor casting for a flat fill. Cull entities outside the view frustum before sorting. |

### Perf priorities (what breaks first)

1. **`getImageData`/`getContext` inside the loop, or new `ImageData`/arrays per frame:** the #1 killer. Allocate the framebuffer and zBuffer *once*; reuse them. Read texture pixels once at load.
2. **Per-pixel `Math` in inner loops:** hoist divides out of the wall/floor inner loops (precompute `deltaDist`, step increments); avoid `Math.abs`/`Math.floor` where a bitwise/int trick suffices.
3. **Internal resolution too high:** halving internal W/H is ~4× fewer pixels. Tune `config.js` first before micro-optimizing.

## Anti-Patterns

### Anti-Pattern 1: Euclidean ray distance for wall height

**What people do:** Use straight-line player→hit distance to size the wall stripe.
**Why it's wrong:** Edge rays are longer than center rays for a flat wall → curved/fisheye walls.
**Do this instead:** Use the **perpendicular** distance (`sideDist - deltaDist`), i.e. the depth along the camera direction. It falls out of the DDA for free.

### Anti-Pattern 2: Angle-per-column with trig each ray

**What people do:** Store a player angle and compute `sin/cos` (or `atan`) per column, with a separate fisheye-correction cosine table.
**Why it's wrong:** Slower, error-prone, and reinvents what the dir+plane model gives for free.
**Do this instead:** Vector camera model (Pattern 1); rotation is one matrix on two vectors.

### Anti-Pattern 3: Sprites without (or before) the z-buffer

**What people do:** Draw sprites after walls with no depth test, or sort but skip occlusion.
**Why it's wrong:** Enemies show through walls; nearer enemies get painted under farther ones.
**Do this instead:** Fill `zBuffer[x]` in the wall pass, draw sprites back-to-front, and per stripe skip texels where `spriteDepth >= zBuffer[x]`.

### Anti-Pattern 4: Mutating game state from event handlers

**What people do:** Move/rotate the player or fire weapons directly inside `keydown`/`mousemove`.
**Why it's wrong:** Couples sim to event cadence (frame-rate-dependent movement, missed frames, double-fire), and makes the update non-deterministic.
**Do this instead:** Handlers set intent flags / accumulate mouse delta; `update(dt)` consumes them once per frame and scales by `dt`.

### Anti-Pattern 5: Re-reading texture pixels via canvas per frame

**What people do:** `getImageData` on a texture canvas inside the render loop.
**Why it's wrong:** `getImageData` is slow and allocates; called per column it destroys frame rate.
**Do this instead:** Convert each texture to a flat typed array **once** at load; sample by index.

### Anti-Pattern 6: Initializing Web Audio at page load

**What people do:** Create the `AudioContext` immediately on load.
**Why it's wrong:** Browser autoplay policies start it `suspended`; sound is silent until a gesture.
**Do this instead:** Create/resume the context on the first user interaction (click "Start", first key), then reuse it.

## Integration Points

### Browser APIs

| Service | Integration pattern | Notes |
|---------|---------------------|-------|
| Canvas 2D `ImageData` | One `ctx.createImageData(W,H)`; write pixels into a `Uint32Array` view of `.data.buffer`; `putImageData` each frame; CSS-scale the canvas up | `image-rendering: pixelated` for the retro look; keep internal buffer small |
| Pointer Lock | Request on canvas click; read `movementX` in `mousemove` for mouse-look yaw | Handle lock loss (Esc) gracefully → pause / show menu |
| Web Audio | Lazy `AudioContext`; short synth voices (oscillator + gain envelope, noise buffer for shots/hits) per SFX | Must init on user gesture; cap concurrent voices |
| `requestAnimationFrame` | Drives the loop; compute/clamp `dt`; skip or clamp huge deltas after tab-switch | Avoid `setInterval`; clamp `dt` to prevent tunneling through walls |
| Classic `<script>` tags | Dependency order = load order; no bundler; works from `file://` | Keep the shared globals few and well-named |

### Internal boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Input ↔ Player | Intent flags read in `update()` | One-way; no direct mutation from handlers |
| Player/Entities ↔ Renderer | Renderer reads state, writes framebuffer | Strictly one-way (render never mutates sim) |
| Wall pass ↔ Sprite pass | Shared `zBuffer[]` | Walls fill it, sprites read it; ordering is mandatory |
| Weapons/AI ↔ Level | Grid lookups + LOS ray march | Reuse the DDA traversal for hitscan and line-of-sight |
| update() ↔ Audio | Fire-and-forget SFX on state transitions | Side effects live in sim, not renderer |

## Build Order Implications (for roadmap decomposition)

The dependency graph yields a natural, incrementally-demoable phase order. Each step produces something visible/testable, de-risking the renderer early.

1. **Scaffold + config + assets** (`index.html`, `config.js`, `textures.js`, `sprites.js`): produce and preview procedural texel arrays. No gameplay, but unblocks everything and is pure/isolated.
2. **Level + player state + input** (`level.js`, `player.js`, `input.js`): grid map, player pose, movement/collision, pointer-lock look — validated via a 2D top-down debug draw before any 3D.
3. **Core renderer: walls + floor/ceiling** (`renderer.js`): DDA wall pass with textures + distance shading, fills `zBuffer`; row-cast floor/ceiling. This is the highest-risk math — schedule research/spike time. First "real Doom look."
4. **Sprites + entities** (`entities.js`, sprite pass): billboard projection with z-buffer occlusion + back-to-front sort. Depends on renderer's zBuffer.
5. **AI + weapons + pickups** (`ai.js`, `weapons.js`, pickup logic): enemy state machine with LOS, hitscan fire, ammo, damage/death, item grants. Depends on entities + level LOS.
6. **HUD + audio + game-state machine** (`hud.js`, `audio.js`, `game.js`): health/ammo/weapon/kills/crosshair/messages/minimap; synth SFX; title/victory/death screens and win/lose conditions. Ties the loop together.

**Research-flag phases:** Phase 3 (wall + floor/ceiling math) and Phase 4 (sprite projection + z-buffer) carry the only nontrivial math risk; everything else is standard game-loop/state work. Recommend the roadmap allocate spike/verification budget to phases 3–4 specifically.

## Sources

- [Lode's Computer Graphics Tutorial — Raycasting (walls, DDA, camera plane, perpendicular distance, texturing)](https://lodev.org/cgtutor/raycasting.html) — HIGH (canonical reference implementation)
- [Lode's Raycasting II — Floor/ceiling casting and untextured→textured surfaces](https://lodev.org/cgtutor/raycasting2.html) — HIGH
- [Lode's Raycasting III — Sprites, 1D z-buffer occlusion, back-to-front sorting](https://lodev.org/cgtutor/raycasting3.html) — HIGH
- [Lode's Raycasting IV — Directional sprites, doors, further techniques](https://lodev.org/cgtutor/raycasting4.html) — MEDIUM (beyond core scope)
- [Wikipedia — Z-buffering (depth test concept, 1D vs 2D buffer)](https://en.wikipedia.org/wiki/Z-buffering) — HIGH
- [Notes on ray casting — nielssp.dk (independent modern JS walkthrough, cross-check)](https://nielssp.dk/2024/11/notes-on-raycasting) — MEDIUM
- [Building a Custom JavaScript Raycasting Engine from Scratch (independent JS engine, cross-check)](https://untrustedlife.com/2025/10/22/my-raycasting-adventure/) — MEDIUM

---
*Architecture research for: browser raycasting FPS (Doom clone)*
*Researched: 2026-07-23*
