# Phase 3: Core Renderer — Walls, Floors & Ceilings - Research

**Researched:** 2026-07-24
**Domain:** Software raycasting renderer (DDA walls + row-based floor/ceiling casting), Canvas 2D `Uint32Array` framebuffer, zero-dependency vanilla JS
**Confidence:** HIGH — the raycaster math is a 30-year-stable, textbook technique (Lode Vandevenne's reference implementation), cross-checked here against the *actual* Phase 1–2 code contracts in this repo (`Framebuffer`, `Level`, `Player`, `Textures`, `CONFIG`). Every formula below is grounded in the real global names the executors will call.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
The raycaster math is **LOCKED** in `03-CONTEXT.md`. Research does not re-litigate stack or architecture; it makes the math and pitfalls exact. Copied verbatim:

1. **Swap mechanism.** Add a `Raycaster` global with `render()` that writes `Framebuffer.buf32` and does **NOT** present (same contract as `TopDown`). Point `Game.view` at it. Keep `TopDown` in the tree behind `TopDown.ENABLED = false` (debug toggle; do not delete). `Game.render()` still owns the single `putImageData`.

2. **Per-column DDA wall cast.** For each screen column `x` in `[0, W)`:
   - `cameraX = 2*x/W - 1`; `rayDirX = dirX + planeX*cameraX`; `rayDirY = dirY + planeY*cameraX`.
   - `mapX/mapY = floor(px/py)`. `deltaDistX = abs(1/rayDirX)`, `deltaDistY = abs(1/rayDirY)` (guard divide-by-zero with a large finite sentinel).
   - Step/sideDist init from fractional position; DDA loop steps to the nearer side until `Level.isSolid(mapX,mapY)`.
   - **Perpendicular distance (kills fisheye — REND-01):** `perpWall = side==0 ? (sideDistX - deltaDistX) : (sideDistY - deltaDistY)`. NEVER Euclidean.
   - `lineHeight = floor(H / perpWall)`; `drawStart = -lineHeight/2 + H/2` (clamp ≥0); `drawEnd = lineHeight/2 + H/2` (clamp <H).
   - **Write `Framebuffer.zBuffer[x] = perpWall`** for every column (REND-06). Floor `perpWall` to a small positive value.
   - Bound the DDA iteration count against a malformed/borderless map.

3. **Wall texturing (REND-02).**
   - `wallX = side==0 ? py + perpWall*rayDirY : px + perpWall*rayDirX`; `wallX -= floor(wallX)`.
   - `texX = floor(wallX * TEX)`; flip: `if (side==0 && rayDirX>0) texX = TEX-1-texX; if (side==1 && rayDirY<0) texX = TEX-1-texX;`
   - Vertical: `step = TEX/lineHeight`, `texPos = (drawStart - H/2 + lineHeight/2)*step`; per row `texY = floor(texPos) & (TEX-1)`; advance `texPos += step`.
   - Texture from `Level.WALL_TEXTURES[cellId]`. Texel copy is a packed `buf32` assignment.

4. **Side shading + distance fog (REND-04).** `side==1` walls get a constant multiplier (~0.7). Then distance fog: monotonic factor of `perpWall` fading far geometry toward a fog/ambient color. Shade by multiplying the texel r/g/b (unpack/scale/repack), branch-light. Fog constants in `CONFIG`.

5. **Floor/ceiling casting (REND-03).**
   - Row-based cast: for each screen row `y` below horizon, `rowDist = (0.5*H)/(y - H/2)`; leftmost/rightmost ray dirs give a per-row world step; walk `floorX/floorY`; mirrored row samples ceiling. Shade by `rowDist` with the same fog curve.
   - **Fallback (explicit):** gate textured floor/ceiling behind `CONFIG.FLOOR_CAST`. When off, fill floor/ceiling with distance-shaded FLAT colors. A real, correct code path — not dead code. Default ON; both paths shade with distance.
   - Draw order: cast floor/ceiling for the whole frame first (fills every pixel), then the wall pass overwrites wall spans and sets the z-buffer. Floors/ceilings never write the z-buffer.

6. **Performance.** Internal resolution `CONFIG.INTERNAL_W` × derived height. Hot loops must not allocate. Precompute per-row/per-column invariants. Target ~60fps; keep the fallback ready. No `getImageData` in the loop.

7. **Reuse, don't re-architect.** `CONFIG`, `Framebuffer`, `Textures.map.*`, `Level`, `Player`, `Game.view`/`Game.render` all exist. New `<script>` before `js/main.js`. `tools/boot.cjs` harness is reusable for headless frame assertions.

### Claude's Discretion
- The exact fog curve shape and its constants (`FOG_FAR`, `MIN_SHADE`, `SIDE_SHADE`) — recommendations below; tunable.
- Whether to use a float multiply or an integer fixed-point shade in the inner loop — recommendation below.
- The precise headless assertion set and tolerances — recommendations below.

### Deferred Ideas (OUT OF SCOPE)
- Billboarded sprites + entity system (Phase 4) — will consume this phase's z-buffer.
- Enemies/weapons/pickups (Phase 5); HUD/minimap/audio/title-victory-death (Phase 6).
- Any variable floor/ceiling height / verticality — breaks the raycaster assumption.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REND-01 | Perpendicular-distance DDA, no fisheye | Pattern 1 (DDA + perpWall). The single load-bearing correctness property. Falsifiable headless check in Validation Architecture. |
| REND-02 | Correct per-column texture sampling | Pattern 2 (wallX/texX flip + fixed-point texY). Off-by-one/seam prevention in Pitfalls 2. Power-of-two mask `& 63`. |
| REND-03 | Floor/ceiling casting + flat-color fallback | Pattern 3 (row-based cast) + Pattern 4 (flat fallback sharing the shade function). Gated by `CONFIG.FLOOR_CAST`. |
| REND-04 | Distance shading / fog | Pattern 5 (monotonic fog curve + side darken + efficient packed-color shade). Constant-per-column / constant-per-row shade hoist. |
| REND-06 | Per-column z-buffer | `Framebuffer.zBuffer[x] = perpWall` written in the wall pass for every column. Independent-recompute cross-check in Validation Architecture. |
</phase_requirements>

## Summary

This phase implements a textbook Lodev-style software raycaster as a new `Raycaster` global that plugs into the existing `Game.view` seam. All the hard contracts are already shipped and verified: the `Uint32Array` framebuffer (`Framebuffer.buf32`) with its packed little-endian color, the per-column `Framebuffer.zBuffer` (`Float32Array(width)`), the orthonormal vector camera (`Player.{x,y,dirX,dirY,planeX,planeY}` with `|plane| = CONFIG.FOV_PLANE = 0.66`), the wall-ID→texture table (`Level.WALL_TEXTURES` + `Level.textureFor(id)`), the 64×64 power-of-two textures (`Textures.map[name].buf32`), and the single `putImageData` owned by `Game.render()`. There is nothing to install and nothing to architect — the entire risk is getting three pieces of math exactly right and not allocating in the hot loop.

The three pieces of math are: (1) the DDA wall cast that must use **perpendicular** distance (`sideDist - deltaDist`), never Euclidean, or every wall bulges into a fishbowl; (2) the wall texture-column mapping with the side-based `texX` flip and the fixed-point `texY` accumulator referenced to the *unclamped* wall span, or you get seams and mirrored corners; (3) the row-based floor/ceiling cast that computes one `rowDistance` per screen row and linearly walks world coordinates across it, mirroring the floor row to draw the ceiling. Distance shading is layered on top as a monotonic function of the per-column `perpWall` (walls) or per-row `rowDistance` (floors), with a constant extra darken for `side==1` walls. The single biggest performance insight is that **shade is constant for an entire wall column and constant for an entire floor row**, so the per-pixel cost is one packed read, one integer multiply-shift, one packed write.

**Primary recommendation:** Implement `Raycaster.render()` in three ordered passes — (A) floor/ceiling fills the whole frame, (B) the DDA wall pass overwrites wall spans and writes `zBuffer[x]`, (C) shading folded into A and B via a single `shade(packed, distance, isYSide)` helper that unpacks/scales/repacks with alpha preserved. Read `Framebuffer.width/height` every frame (internal height varies with aspect — never hardcode 480×270). Guard axis-aligned rays with a `1e30` sentinel (same idiom already proven in `Level.lineOfSight`). Verify headlessly by re-implementing an independent perpendicular-distance DDA in the harness and asserting `zBuffer[x]` matches it column-by-column, plus a falsifiable no-fisheye check (a flat front-facing wall yields a *constant* `zBuffer` band while a Euclidean computation would visibly vary).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Wall distance + geometry (DDA) | Renderer (`Raycaster`) | Level (grid query `isSolid`) | Pure read over `Level` grid + `Player` pose; writes only `buf32` + `zBuffer`. |
| Wall texture sampling | Renderer (`Raycaster`) | Assets (`Textures.map`, `Level.WALL_TEXTURES`) | Renderer resolves the ID→texture via the existing `Level.textureFor(id)` seam; never re-derives a naming convention. |
| Floor/ceiling surfaces | Renderer (`Raycaster`) | Assets (`Textures.map.floor/ceiling`), `CONFIG` (flat fallback colors) | Row-cast or flat-fill, both owned by the renderer; fallback colors already exist in `CONFIG`. |
| Distance shading / fog | Renderer (`Raycaster`) | `CONFIG` (fog constants) | Read-only transform of packed color; constants centralized in `CONFIG`. |
| Depth buffer (`zBuffer`) | Renderer (`Raycaster`) — producer | Framebuffer (owns the array); Phase 4 sprites — consumer | Wall pass is the sole writer; the array is preallocated by `Framebuffer`. |
| Frame present | `Game.render()` | Framebuffer (`present()`) | Single `putImageData` stays out of the view; the view only writes `buf32`. |

## Standard Stack

This phase adds **zero dependencies** (hard project constraint: vanilla classic-script JS, no build, runs from `file://`). The "stack" is the browser platform plus the already-shipped globals. No package installation, no registry lookup, no legitimacy audit applies (no external packages). Sections *Package Legitimacy Audit* and *Environment Availability* are intentionally omitted — this is a code-only phase over an existing self-contained codebase.

### Already-shipped contracts this phase consumes (real names)

| Global | Members used | Notes |
|--------|--------------|-------|
| `Framebuffer` | `.buf32` (Uint32Array), `.zBuffer` (Float32Array(width)), `.width`, `.height`, `.clear(packed)` | `buf32` aliases the `ImageData` buffer; a packed write flows straight to `present()`. Read `width`/`height` every frame. |
| `Player` | `.x`, `.y`, `.dirX`, `.dirY`, `.planeX`, `.planeY` | Orthonormal; `|dir|=1`, `|plane|=0.66`. No stored angle — do not reintroduce trig-per-column. |
| `Level` | `.isSolid(mx,my)`, `.cellAt(mx,my)`, `.WALL_TEXTURES[id]`, `.textureFor(id)`, `.WIDTH`, `.HEIGHT` | `isSolid`/`cellAt` fail closed (OOB → stone). `textureFor(id)` returns the `{width,height,data,buf32}` asset or `null`. |
| `Textures` | `.map[name].buf32`, `.map[name].width` (=64), `.map.floor`, `.map.ceiling` | 64×64 power-of-two; `buf32.length === 4096`. Packed identically to the framebuffer → texel copy is one assignment. |
| `CONFIG` | `.FOV_PLANE`, `.TEX_SIZE` (64), `.CEIL_COLOR`, `.FLOOR_COLOR`, `.CLEAR_COLOR` + **new** `.FLOOR_CAST`, `.FOG_FAR`, `.MIN_SHADE`, `.SIDE_SHADE`, `.CAMERA_Z` | Add the new renderer constants here (one edit site). `TEX_SIZE` power-of-two enables `& 63` masking. |
| `Game` | `.view` (assign `Raycaster`), `.render()` (owns present) | Assign `Game.view = Raycaster` and set `TopDown.ENABLED = false` in `main.js` load. |
| `packRGBA(r,g,b,a)` | color packing | Little-endian `(a<<24)|(b<<16)|(g<<8)|r`. Use for `CONFIG` fog/flat colors. |

### New `CONFIG` constants to add (recommended values — `[ASSUMED]` tunables)

```javascript
// config.js additions
FLOOR_CAST: true,                 // textured floor/ceiling ON; false => flat-shaded fallback
CAMERA_Z: 0.5,                    // camera height as a fraction of wall height; 0.5 aligns floor to wall base
FOG_FAR: 14.0,                    // world distance (cells) at which shading reaches MIN_SHADE (linear curve)
MIN_SHADE: 0.28,                  // brightness floor — keep silhouettes readable (enemies visible in Phase 5)
SIDE_SHADE: 0.70,                 // constant multiplier for side==1 (y-side) walls — cheap depth cue
FOG_COLOR: packRGBA(24, 26, 34),  // ambient the far distance fades toward (matches CLEAR_COLOR)
```

`[ASSUMED]` — the numeric values (`FOG_FAR`, `MIN_SHADE`, `SIDE_SHADE`) are aesthetic starting points from the Doom/Wolfenstein look, not derived from a spec. They should be eyeballed in-browser and tuned; the *shape* (linear falloff clamped to a floor, plus a constant side darken) is the standard [CITED: lodev.org/cgtutor/raycasting.html] and is safe.

## Architecture Patterns

### System Architecture Diagram

```
                 Player pose {x,y,dirX,dirY,planeX,planeY}
                              │  (read-only)
                              ▼
  Game.render() ─────► Raycaster.render()  [writes Framebuffer.buf32 + zBuffer, NO present]
                              │
        ┌─────────────────────┼─────────────────────────────────────┐
        │ PASS A: floor/ceiling (fills the WHOLE frame first)        │
        │   for each row y below horizon:                            │
        │     rowDist = CAMERA_Z*H / (y - horizon)                   │
        │     step world coords across the row (leftmost→rightmost)  │
        │     FLOOR_CAST ? sample Textures.map.floor/ceiling         │
        │                : flat CONFIG.FLOOR_COLOR / CEIL_COLOR      │
        │     shade(texel, rowDist, false) ──► buf32[y*W+x]          │
        │     mirror row (H-1-y) ──► ceiling                         │
        ├────────────────────────────────────────────────────────────┤
        │ PASS B: walls (per column x, DDA) — OVERWRITES A           │
        │   cameraX = 2x/W-1; rayDir = dir + plane*cameraX           │
        │   DDA march grid until Level.isSolid(mapX,mapY)            │
        │   perpWall = side==0 ? sideDistX-deltaDistX                │
        │                      : sideDistY-deltaDistY                │
        │   zBuffer[x] = perpWall            ◄── REND-06 producer     │
        │   lineHeight = H / perpWall; drawStart/drawEnd (clamped)   │
        │   texX (side-flipped); texPos accumulator (unclamped ref)  │
        │   colShade = shadeFactor(perpWall, side)  (ONCE per column)│
        │   for y in span: texel = tex.buf32[texY*64+texX]          │
        │                  buf32[y*W+x] = applyShade(texel,colShade) │
        └────────────────────────────────────────────────────────────┘
                              │
                              ▼
              Framebuffer.present()  [single putImageData, owned by Game.render]
                              │
                    <canvas> CSS-upscaled (image-rendering: pixelated)

  Later: Phase 4 sprite pass READS zBuffer[x] for occlusion (do not touch here).
```

### Recommended file/structure

```
Doom/Claude Opus 4.8/GSD/
├── js/
│   ├── raycaster.js     # NEW — Raycaster global: render() = passes A+B + shade helpers
│   └── main.js          # EDIT — Game.view = Raycaster; TopDown.ENABLED = false
├── index.html           # EDIT — <script src="js/raycaster.js"> BEFORE js/game.js/main.js
└── tools/
    └── verify-render.cjs # NEW — headless frame assertions (built on boot.cjs)
```

Load order: `raycaster.js` reads `CONFIG`, `Framebuffer`, `Level`, `Player`, `Textures` — place it **after** `player.js`/`level.js`/`textures.js` and **before** `game.js`/`main.js` (mirror where `topdown.js` sits today).

### Pattern 1: DDA wall cast with PERPENDICULAR distance (REND-01, REND-06)

**What:** March each column's ray cell-by-cell, stepping to the nearer grid line, until a solid cell. The perpendicular distance falls out of the DDA for free — no `sqrt`, no cosine table.

**Exact algorithm** (grounded in real names; `W = Framebuffer.width`, `H = Framebuffer.height`):

```javascript
// Source: lodev.org/cgtutor/raycasting.html — adapted to this repo's globals.
var EPS = 1e-4;          // perpWall floor: a hit at ~0 distance must not div-by-zero
var BIG = 1e30;          // axis-aligned ray sentinel (same idiom as Level.lineOfSight)

var px = Player.x, py = Player.y;
var dirX = Player.dirX, dirY = Player.dirY;
var planeX = Player.planeX, planeY = Player.planeY;
var W = Framebuffer.width, H = Framebuffer.height;
var horizon = H >> 1;                        // integer center row; H can be 200..480

for (var x = 0; x < W; x++) {
  var cameraX = 2 * x / W - 1;               // -1 (left) .. +1 (right)
  var rayDirX = dirX + planeX * cameraX;
  var rayDirY = dirY + planeY * cameraX;

  var mapX = Math.floor(px);
  var mapY = Math.floor(py);

  // Divide-by-zero guard: a FINITE sentinel, not Infinity — 0*Infinity = NaN.
  var deltaDistX = (rayDirX === 0) ? BIG : Math.abs(1 / rayDirX);
  var deltaDistY = (rayDirY === 0) ? BIG : Math.abs(1 / rayDirY);

  var stepX, stepY, sideDistX, sideDistY;
  if (rayDirX < 0) { stepX = -1; sideDistX = (px - mapX) * deltaDistX; }
  else             { stepX =  1; sideDistX = (mapX + 1 - px) * deltaDistX; }
  if (rayDirY < 0) { stepY = -1; sideDistY = (py - mapY) * deltaDistY; }
  else             { stepY =  1; sideDistY = (mapY + 1 - py) * deltaDistY; }

  // DDA. Bound the iterations so a borderless/malformed map cannot spin (the
  // border IS forced solid, but defend anyway — same posture as lineOfSight's cap).
  var side = 0, hit = false;
  var guard = Level.WIDTH + Level.HEIGHT + 2;
  while (guard-- > 0) {
    if (sideDistX < sideDistY) { sideDistX += deltaDistX; mapX += stepX; side = 0; }
    else                       { sideDistY += deltaDistY; mapY += stepY; side = 1; }
    if (Level.isSolid(mapX, mapY)) { hit = true; break; }
  }

  // PERPENDICULAR distance — the anti-fisheye. NEVER hypot(hitX-px, hitY-py).
  var perpWall = (side === 0) ? (sideDistX - deltaDistX) : (sideDistY - deltaDistY);
  if (!(perpWall > EPS)) perpWall = EPS;     // catches 0, negative, NaN

  Framebuffer.zBuffer[x] = perpWall;         // REND-06 — every column, always.

  var lineHeight = Math.floor(H / perpWall);
  var drawStart = -(lineHeight >> 1) + horizon;
  var drawEnd   =  (lineHeight >> 1) + horizon;
  var clampedStart = drawStart < 0 ? 0 : drawStart;
  var clampedEnd   = drawEnd > H ? H : drawEnd;   // exclusive loop bound
  // ... texture sampling (Pattern 2) fills [clampedStart, clampedEnd) ...
}
```

**Why perpendicular:** the wall stripe height is `H / perpWall`. `perpWall` is the depth *along the camera direction*, i.e. the projection onto the view axis, which is exactly what a flat projection plane needs. A Euclidean ray length is longer at screen edges for the same flat wall → shorter stripes at the edges → fishbowl bulge. [CITED: lodev.org/cgtutor/raycasting.html; ARCHITECTURE.md Anti-Pattern 1]

### Pattern 2: Wall texture-column mapping — seams & off-by-one (REND-02)

**What:** Find the fractional hit position along the wall (`wallX`), convert to a texture column (`texX`) with the side-based flip for consistent orientation, then step the texture row (`texY`) down the stripe with a fixed-point accumulator referenced to the **unclamped** wall span.

```javascript
// Source: lodev.org/cgtutor/raycasting.html (Untextured→Textured section).
var TEX = tex.width;                 // 64 for every Textures.map asset; power of two
var MASK = TEX - 1;                  // 63 — bitmask instead of modulo

// Exact hit coordinate along the wall face (the OTHER axis from `side`).
var wallX = (side === 0) ? (py + perpWall * rayDirY)
                         : (px + perpWall * rayDirX);
wallX -= Math.floor(wallX);          // fractional part in [0, 1)

var texX = Math.floor(wallX * TEX);
// Flip so both faces of a wall read with a consistent handedness (no mirror at corners):
if (side === 0 && rayDirX > 0) texX = TEX - texX - 1;
if (side === 1 && rayDirY < 0) texX = TEX - texX - 1;
texX &= MASK;                        // belt-and-braces: wallX*64 can reach 64.0 at the boundary

// Fixed-point vertical step. NOTE: texPos is referenced to the UNCLAMPED line
// (drawStart may be negative), so a wall taller than the screen samples the
// correct visible slice. Do NOT reference it to clampedStart.
var step   = TEX / lineHeight;
var texPos = (drawStart - horizon + (lineHeight >> 1)) * step;
// If you clamped the top, advance texPos over the hidden rows first:
if (clampedStart > drawStart) texPos += (clampedStart - drawStart) * step;

var texBuf = tex.buf32;
var colBase = /* precomputed per-column shade — see Pattern 5 */;
for (var y = clampedStart; y < clampedEnd; y++) {
  var texY = (texPos | 0) & MASK;    // `| 0` = fast floor for non-negative
  texPos += step;
  var texel = texBuf[(texY << 6) + texX];   // texY*64 + texX  (64 = 1<<6)
  Framebuffer.buf32[y * W + x] = applyShade(texel, colBase);
}
```

**The three classic bugs and their fixes:**
1. **Mirrored texture across a corner** → the side-based `texX` flip (both `if` lines). Test with an *asymmetric* texture (the `exit` texture has a right-pointing arrow — perfect).
2. **`texX == 64` out of bounds** → `texX &= 63` after the flip. `wallX` can equal exactly `1.0 - ε` but float rounding at a grid boundary can push `wallX*64` to `64.0`.
3. **Swimming / wrong slice on tall near walls** → `texPos` must be referenced to the *unclamped* `drawStart`, then advanced over any clipped top rows. Referencing it to the clamped start re-anchors the texture to the screen edge and the wall "slides" as you approach. [CITED: lodev.org/cgtutor/raycasting.html; PITFALLS.md Pitfall 6]

Resolve the texture once per column *before* the row loop:
```javascript
var id  = Level.cellAt(mapX, mapY);          // 1..5
var tex = Level.textureFor(id);              // {width,height,data,buf32} or null
if (!tex) tex = Textures.map.stone;          // fail-safe; validateTextures() guarantees none missing
```

### Pattern 3: Row-based floor/ceiling casting (REND-03)

**What:** For each screen row below the horizon the floor is at a constant world distance, so world coordinates interpolate linearly across the row. Sample the floor texture per pixel; the mirrored row above the horizon samples the ceiling. Runs as **Pass A**, filling the whole frame before walls overwrite.

```javascript
// Source: lodev.org/cgtutor/raycasting2.html (Floor and ceiling casting).
// Leftmost ray (x=0, cameraX=-1) and rightmost ray (x=W-1≈+1) directions:
var rayDirX0 = dirX - planeX, rayDirY0 = dirY - planeY;
var rayDirX1 = dirX + planeX, rayDirY1 = dirY + planeY;
var posZ = CONFIG.CAMERA_Z * H;              // camera height in screen units; 0.5*H aligns floor to wall base
var floorTex = Textures.map.floor, ceilTex = Textures.map.ceiling;
var fBuf = floorTex.buf32, cBuf = ceilTex.buf32;
var TEX = CONFIG.TEX_SIZE, MASK = TEX - 1;

for (var y = horizon + 1; y < H; y++) {      // start at horizon+1 => (y-horizon) >= 1, never 0
  var p = y - horizon;
  var rowDistance = posZ / p;                 // constant for the whole row; also the shade distance

  // World step per screen column, and the leftmost world position:
  var floorStepX = rowDistance * (rayDirX1 - rayDirX0) / W;
  var floorStepY = rowDistance * (rayDirY1 - rayDirY0) / W;
  var floorX = px + rowDistance * rayDirX0;
  var floorY = py + rowDistance * rayDirY0;

  var rowShade = shadeFactor(rowDistance, false);   // ONCE per row (Pattern 5)
  var floorRowBase = y * W;
  var ceilRowBase  = (H - 1 - y) * W;               // mirror across the horizon

  for (var x = 0; x < W; x++) {
    var tx = ((floorX * TEX) | 0) & MASK;    // fract*TEX via masking the cell offset
    var ty = ((floorY * TEX) | 0) & MASK;    // (floor coords are >=0 inside the level)
    floorX += floorStepX;
    floorY += floorStepY;
    var ti = (ty << 6) + tx;                 // ty*64 + tx
    Framebuffer.buf32[floorRowBase + x] = applyShade(fBuf[ti], rowShade);
    Framebuffer.buf32[ceilRowBase  + x] = applyShade(cBuf[ti], rowShade);
  }
}
// Fill the exact horizon row (y == horizon) too, so no seam pixel is left as CLEAR_COLOR.
```

**Precision & perf notes:**
- `(floorX * TEX) | 0 & MASK` relies on `floorX >= 0`. The forced-solid border means every visible floor coordinate is inside `[0, WIDTH)` — safe. If you ever cast outside the grid, add `Math.floor` (which handles negatives) instead of `| 0`.
- The `y - horizon == 0` divide-by-zero is avoided structurally by starting at `horizon + 1` (mirrors `lineOfSight`'s structural guards). [CITED: PITFALLS.md Pitfall 7]
- Hoist `rowDistance`, the two steps, and `rowShade` **out** of the inner loop (shown). The inner loop is then two masks, two adds, two packed reads, two shaded writes — no divides, no trig, no allocation.

### Pattern 4: Flat-color fallback that shades identically (REND-03)

**What:** When `CONFIG.FLOOR_CAST` is false, fill the floor/ceiling halves with `CONFIG.FLOOR_COLOR` / `CONFIG.CEIL_COLOR` — but **still shade per row by `rowDistance`** using the *same* `shadeFactor`, so the fallback is a real, correct, distance-shaded path (not dead code, not a flat slab).

```javascript
if (CONFIG.FLOOR_CAST) {
  // ... Pattern 3 ...
} else {
  for (var y = horizon + 1; y < H; y++) {
    var rowDistance = (CONFIG.CAMERA_Z * H) / (y - horizon);
    var rowShade = shadeFactor(rowDistance, false);
    var floorC = applyShade(CONFIG.FLOOR_COLOR, rowShade);
    var ceilC  = applyShade(CONFIG.CEIL_COLOR,  rowShade);
    var fRow = y * W, cRow = (H - 1 - y) * W;
    for (var x = 0; x < W; x++) {
      Framebuffer.buf32[fRow + x] = floorC;
      Framebuffer.buf32[cRow + x] = ceilC;
    }
  }
}
```

Because both branches call `shadeFactor(rowDistance, false)`, a headless test can assert identical *shading behavior* (monotonic darkening toward the horizon) regardless of the flag — the difference is only whether the base color is a texel or a flat constant. This satisfies the CONTEXT requirement that the fallback "shade by distance identically."

### Pattern 5: Distance shading, side darken, and efficient packed-color scaling (REND-04)

**The curve (monotonic, Doom-like):** linear falloff to a brightness floor, plus a constant `side==1` darken. Simple, stable, cheap:

```javascript
// Returns an INTEGER fixed-point shade in [0, 256]. Fixed-point keeps the inner
// loop free of float multiplies: (channel * shade) >> 8.
function shadeFactor(dist, isYSide) {
  var s = 1 - dist / CONFIG.FOG_FAR;         // linear: 1 at camera, 0 at FOG_FAR
  if (s < CONFIG.MIN_SHADE) s = CONFIG.MIN_SHADE;   // brightness floor (readability)
  if (s > 1) s = 1;
  if (isYSide) s *= CONFIG.SIDE_SHADE;       // constant y-side darken
  return (s * 256) | 0;                      // 0..256 fixed point
}
```

**Applying it to a packed little-endian texel** — unpack r/g/b, scale, repack, **preserve alpha (0xFF)** so the framebuffer stays opaque:

```javascript
function applyShade(packed, shade /* 0..256 */) {
  var r = (packed & 0xFF) * shade >> 8;
  var g = (packed >> 8 & 0xFF) * shade >> 8;
  var b = (packed >> 16 & 0xFF) * shade >> 8;
  // High byte forced to 0xFF (opaque). Packing matches packRGBA's little-endian layout.
  return (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0;
}
```

**The key perf insight (bakes REND-04 into ~free):** `perpWall` is **constant for an entire wall column**, and `rowDistance` is **constant for an entire floor/ceiling row**. So compute the fixed-point `shade` **once per column** (walls) or **once per row** (floors), then every pixel is `(chan * shade) >> 8` — three multiplies and one OR. No per-pixel float, no per-pixel branch. For walls, pass `isYSide = (side === 1)` into the single per-column `shadeFactor` call.

**Optional fog-toward-color:** the multiply above fades toward *black*. If you want to fade toward `CONFIG.FOG_COLOR` (atmospheric), lerp instead: `out = fog*texel + (1-fog)*FOG_COLOR` per channel. This costs a couple more ops per pixel; since it's still constant-per-column/row you can precompute the two endpoint contributions per column/row and keep the inner loop cheap. Recommendation: ship the multiply-to-black version first (matches classic Doom shading and the existing dark `CLEAR_COLOR`), add the fog-color lerp only if the look needs it. [CITED: lodev.org/cgtutor/raycasting.html side-darken; PITFALLS.md "Distance shading banding" moderate pitfall]

**Cheap alternative for the side darken** (Lodev's exact trick): `color = (color >> 1) & 0x7F7F7F` halves all channels in one op (=0.5 multiplier). Use it only if you want exactly 0.5; the `SIDE_SHADE = 0.7` multiply reads better. [CITED: lodev.org/cgtutor/raycasting.html]

### Anti-Patterns to Avoid

- **Euclidean distance for wall height** → fisheye. Use `sideDist - deltaDist`. (Pattern 1)
- **Angle-per-column + trig/cos correction table** → the vector camera already gives perpendicular distance for free; `Player` has no angle by design. Do not reintroduce one. [CITED: ARCHITECTURE.md Anti-Pattern 2]
- **`getImageData` / `new ImageData` / new typed array inside `render()`** → the #1 perf killer and a GC-hitch source. Everything is preallocated (`Framebuffer`, `Textures`); the loop only reads/writes. [CITED: PITFALLS.md Pitfall 3]
- **Per-byte writes into `buf8`** → 2–4× the memory ops. Always write `buf32` packed. [CITED: PITFALLS.md tech-debt table]
- **Hardcoding 480×270** → internal height varies in `[200,480]`. Read `Framebuffer.width/height` every frame; derive `horizon = H>>1`. [CITED: 03-CONTEXT.md code_context]
- **Referencing `texPos` to the clamped `drawStart`** → texture swims on tall near walls. Reference to the unclamped line. (Pattern 2)
- **Presenting from the view** → breaks the single-blit contract. `Raycaster.render()` writes `buf32` and returns; `Game.render()` calls `present()`. (Pattern 1 / locked decision 1)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Ray→grid traversal | A float ray-marcher with a fixed step | The DDA in Pattern 1 (same shape as `Level.lineOfSight`) | Exact, no drift, no tunneling, O(cells crossed). A stepped marcher misses thin walls and drifts. |
| Wall ID → texture | A `"wall" + id` string convention | `Level.textureFor(id)` / `Level.WALL_TEXTURES[id]` | The table is the locked data contract (D-03); re-deriving names drifts from the map. |
| Texture wrap | `% 64` modulo | `& 63` bitmask | Power-of-two textures (`TEX_SIZE`) make mask correct and faster; masking also fixes the boundary off-by-one. |
| Color packing | Manual `<<`/`|` at each call site | `packRGBA` for constants; `applyShade` for the hot loop | Single little-endian contract already defined in `config.js`; consistency prevents R/B swaps. |
| Divide-by-zero on axis rays | `try/catch` or `isFinite` checks per pixel | The `1e30` sentinel at `deltaDist` init | Proven idiom in `lineOfSight` (`LOS_BIG`); `0*Infinity=NaN`, a finite sentinel never produces NaN. |
| Depth buffer allocation | `new Float32Array(...)` in render | The preallocated `Framebuffer.zBuffer` | Allocated once at resize (contract 4); allocating per frame is a GC hitch. |
| Frame present | A `putImageData` in the view | `Game.render()` owns the single present | Single-blit-per-frame contract survives the view swap. |

**Key insight:** almost everything this phase needs is already a shipped, tested contract. The only genuinely new code is the arithmetic in three loops; resist re-solving grid traversal, color packing, or buffer allocation — those are done.

## Common Pitfalls

Ranked most-likely-to-bite for *this specific renderer*.

### Pitfall 1: Fisheye (Euclidean instead of perpendicular distance) — CRITICAL
**What goes wrong:** flat walls bulge toward the viewer at screen edges; the bulge "breathes" as you turn.
**Why:** the naive instinct computes `hypot(hitX-px, hitY-py)`; edge rays are longer for the same flat wall.
**How to avoid:** `perpWall = side==0 ? sideDistX-deltaDistX : sideDistY-deltaDistY`. Never a hypot/sqrt. The camera-plane model makes this fall out for free.
**Warning signs:** the no-fisheye headless check (below) fails: `zBuffer` across a flat front-facing wall is not constant.

### Pitfall 2: Texture seams / mirroring / swim (off-by-one) — HIGH
**What goes wrong:** hairline seams at corners, mirrored texture across a corner, or a texture that slides on tall near walls.
**Why:** missing the side-based `texX` flip; `texX==64` OOB; `texPos` anchored to the clamped span.
**How to avoid:** both `texX` flip `if`s; `texX &= 63`; `texY = texPos|0 & 63`; `texPos` referenced to unclamped `drawStart`, advanced over clipped top rows.
**Warning signs:** test with the asymmetric `exit` arrow texture — any mirror/seam is obvious. Headless: assert a sampled pixel equals `applyShade(tex.buf32[texY*64+texX], colShade)` for a hand-computed `texX/texY`.

### Pitfall 3: Z-buffer wrong / not written every column — HIGH (blocks Phase 4)
**What goes wrong:** Phase 4 sprites clip through walls or vanish; can't be seen until sprites exist unless verified now.
**Why:** writing `zBuffer` only on hit, or storing `lineHeight`/Euclidean instead of `perpWall`, or leaving a column unwritten when the DDA guard trips.
**How to avoid:** write `Framebuffer.zBuffer[x] = perpWall` unconditionally per column (the forced border guarantees a hit; if the guard ever trips, still write the floored `perpWall`). Store perpendicular distance, not stripe height.
**Warning signs:** the independent-recompute check (below) mismatches, or any `zBuffer[x]` is `0`, negative, `NaN`, or `Infinity`.

### Pitfall 4: Floor-cast precision / perf / horizon seam — MEDIUM
**What goes wrong:** fps halves when floors turn on; floor "swims"; a bright/dark line at mid-screen; floor doesn't meet the wall base.
**Why:** per-pixel divides/trig in the inner loop; `y-horizon==0` div-by-zero; `posZ != 0.5*H` misaligns floor with wall base.
**How to avoid:** row-based cast with all divides hoisted per row; start at `horizon+1`; `posZ = 0.5*H`; fill the horizon row explicitly so no pixel stays `CLEAR_COLOR`.
**Warning signs:** profiler shows the floor loop hot; a row of `CLEAR_COLOR` pixels at `y==horizon`; floor and wall base don't align in-browser.

### Pitfall 5: Aspect-ratio / variable internal height — MEDIUM
**What goes wrong:** walls stretched/squashed or a crash after a resize; works at one window size only.
**Why:** hardcoding `H=270`, or caching `horizon`/`W`/`H` across a resize.
**How to avoid:** read `Framebuffer.width/height` at the top of `render()` every frame; derive `horizon = H>>1`; never cache across frames.
**Warning signs:** resize the window → geometry jumps or an index goes out of range. Headless: boot at two `innerWidth/innerHeight` ratios and assert both render without OOB and with the expected `H`.

### Pitfall 6: Packed-color / endianness / alpha mistakes — MEDIUM
**What goes wrong:** red/blue swapped, or walls semi-transparent/black.
**Why:** repacking as `(r<<16)|(g<<8)|b` (big-endian order), or dropping the alpha byte so the high byte is 0.
**How to avoid:** match `packRGBA`'s little-endian layout exactly: `(0xFF000000 | (b<<16) | (g<<8) | r)`. Force alpha `0xFF`. Texture `buf32` is already this layout, so an *unshaded* copy is a straight assignment.
**Warning signs:** everything tinted wrong, or the frame looks translucent over the canvas background.

### Pitfall 7: Per-frame allocation in the hot loop — MEDIUM
**What goes wrong:** memory sawtooth, periodic GC hitches after a minute of play.
**Why:** creating scratch arrays/objects, or resolving textures into a new structure per column.
**How to avoid:** only loop scalars; reuse `Framebuffer`/`Textures` buffers; `shadeFactor` returns a number, not an object. No closures created inside the loop.
**Warning signs:** DevTools memory graph sawtooths; frame-time spikes at a regular cadence.

### Pitfall 8: Divide-by-zero on axis-aligned rays — LOW (guarded) 
**What goes wrong:** a `NaN` column (garbage or black stripe) when the player faces exactly along an axis (`rayDirX==0` or `rayDirY==0`).
**Why:** `1/0 = Infinity`, then `0*Infinity = NaN` in the `sideDist` seed.
**How to avoid:** the `1e30` finite sentinel (Pattern 1), exactly as `Level.lineOfSight` already does with `LOS_BIG`.
**Warning signs:** headless: set `Player` to `dirX=1,dirY=0` (and `0,1`) and assert no `NaN` in `buf32` or `zBuffer`.

## Code Examples

The three patterns above are the implementation-ready code. One additional glue example — the view object and the swap:

```javascript
// js/raycaster.js — the new view. Writes buf32 + zBuffer, does NOT present.
var Raycaster = {
  render: function () {
    var W = Framebuffer.width, H = Framebuffer.height;
    // Pass A: floor/ceiling (fills whole frame)  — Pattern 3 or 4 by CONFIG.FLOOR_CAST
    // Pass B: walls (overwrites spans, writes zBuffer) — Patterns 1 + 2 + 5
    // (No Framebuffer.present() here — Game.render owns it.)
  }
};
```

```javascript
// js/main.js — swap the view (mirrors how TopDown was attached).
TopDown.ENABLED = false;      // keep the file; just disable the debug view
Game.view = Raycaster;        // Phase 3: 3D is now the default render path
```

```html
<!-- index.html — new script BEFORE game.js/main.js, AFTER its reads -->
<script src="js/player.js"></script>
<script src="js/input.js"></script>
<script src="js/topdown.js"></script>
<script src="js/raycaster.js"></script>   <!-- NEW -->
<script src="js/game.js"></script>
<script src="js/main.js"></script>
```

## Runtime State Inventory

Not applicable — this is a greenfield rendering phase (new `Raycaster` view + a view-seam reassignment), not a rename/refactor/migration. No stored data, live-service config, OS-registered state, secrets, or build artifacts carry any renamed identifier. **None — verified by reading the phase scope (03-CONTEXT.md) and the swap mechanism (one `Game.view` assignment + `TopDown.ENABLED=false`).**

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Angle + per-column `sin/cos` + fisheye-correction cosine table | Vector camera (`dir`+`plane`), perpendicular distance from DDA | Standard since Lode's tutorial (~2000s) | Already the repo's model (`Player`); no trig per column, no correction table. |
| Per-column floor casting | Row-based floor/ceiling casting | Lode's raycasting II | Fewer divides, no per-pixel trig; the locked D-05 method. |
| Byte-by-byte `ImageData.data` writes | `Uint32Array` view, packed color | Canonical fast-blit | Already the repo's `Framebuffer.buf32` contract. |

**Deprecated/outdated (do not use):** trig-table raycasters, Euclidean-distance-with-cosine-correction, per-frame `getImageData`, `% TEX` modulo wrapping. All superseded by the patterns above.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `FOG_FAR≈14`, `MIN_SHADE≈0.28`, `SIDE_SHADE≈0.70`, `CAMERA_Z=0.5` are good defaults | Standard Stack / Pattern 5 | Purely aesthetic; wrong values look too dark/flat but nothing breaks. Tune in-browser. `CAMERA_Z=0.5` is load-bearing for floor/wall-base alignment and is standard, not arbitrary. |
| A2 | Multiply-to-black shading is the right first choice over fog-toward-color lerp | Pattern 5 | If the look needs atmospheric fog, add the lerp (documented). Low risk — both are monotonic and cheap. |
| A3 | The `exit` texture's asymmetric arrow is the best seam/mirror test target | Pitfall 2 | If it were symmetric the test would be weak; verified asymmetric by reading `textures.js` `makeExit` (arrow points right). Low risk. |
| A4 | Floor coordinates are always ≥0 inside the level, so `| 0` (not `Math.floor`) is safe for `tx/ty` | Pattern 3 | If a ray ever samples outside the grid, `| 0` truncates toward zero incorrectly for negatives. The forced-solid border makes this safe; if ever unsure, use `Math.floor`. Low risk. |

All other claims are `[CITED]` (Lodev tutorials / the repo's own research docs) or `[VERIFIED]` against the actual source files read this session.

## Validation Architecture

`workflow.nyquist_validation` is **true** in `.planning/config.json` — this section is required.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Custom Node `vm` harness on `tools/boot.cjs` (no external test runner — matches Phases 1–2). Assertions via `assert(cond, label)` / `finish(TOKEN)`. |
| Config file | none — harnesses are standalone `.cjs` under `tools/`. |
| Quick run command | `node "Doom/Claude Opus 4.8/GSD/tools/verify-render.cjs"` |
| Full suite command | Run every `tools/verify-*.cjs` and require each terminal token (`ALL_*_PASS`). |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REND-01 | No fisheye: flat front-facing wall → constant `zBuffer` band; Euclidean recompute would visibly vary | unit (headless frame) | `node tools/verify-render.cjs` | ❌ Wave 0 |
| REND-06 | `zBuffer[x]` matches an independent perpendicular-distance DDA, all columns finite/positive | unit | `node tools/verify-render.cjs` | ❌ Wave 0 |
| REND-02 | A hand-computed `texX/texY` pixel equals the shaded texel at that column | unit | `node tools/verify-render.cjs` | ❌ Wave 0 |
| REND-03 | Whole frame filled (no `CLEAR_COLOR` left); FLOOR_CAST on vs off both fill + shade by distance | unit | `node tools/verify-render.cjs` | ❌ Wave 0 |
| REND-04 | Near column brighter than far; `side==1` darker than `side==0` at equal distance; `MIN_SHADE` floor respected | unit | `node tools/verify-render.cjs` | ❌ Wave 0 |
| (all) | `Raycaster.render()` does not present; `Game.render()` still presents exactly once; two renders byte-identical (determinism); axis-aligned rays produce no `NaN` | unit | `node tools/verify-render.cjs` | ❌ Wave 0 |

### Concrete headless assertions (built on `boot.cjs`)

The harness boots the shipped scripts, `h.fireLoad()`, sets `Game.view = Raycaster` (or main.js already did), positions `Player`, calls `Raycaster.render()` (or `raf.step()`), and asserts on `Framebuffer.buf32` / `Framebuffer.zBuffer`. Anchor positions on `Level.LANDMARKS` by name (e.g. `wallFaceEast`) — never a searched/hardcoded coordinate (the Phase 2 harness idiom).

1. **No-fisheye (REND-01) — falsifiable.** Place `Player` at `LANDMARKS.wallFaceEast.{x,y}` facing `+x` (`setDir(1,0)`) toward the axis-aligned wall face. Render. For the band of columns whose ray hits that wall plane, assert `max(zBuffer) - min(zBuffer) < 1e-3` (perpendicular distance to a front-facing plane is constant). **Falsifiability control:** in the harness compute the *Euclidean* ray length to each hit and assert `max-min` of that set is `> 1e-2` — proving the test discriminates: perpendicular is flat where Euclidean bulges. If both were constant the test would be vacuous.

2. **Z-buffer correctness (REND-06).** Re-implement an *independent* perpendicular-distance DDA in the harness (a second, separately-written copy — not a call into `Raycaster`) and, for every column `x`, assert `abs(Framebuffer.zBuffer[x] - refPerp[x]) < 1e-6`. Also assert every `zBuffer[x]` is finite and `> 0`.

3. **Texture sampling (REND-02).** For a chosen column hitting a known wall, hand-compute `wallX → texX (with flip) → texY` for a specific screen row `y` using the documented formulas, then assert `Framebuffer.buf32[y*W+x] === applyShade(tex.buf32[texY*64+texX], shadeFactor(zBuffer[x], side))`. Assert `texX`/`texY` land in `[0,63]`. Point the player at the asymmetric `exit` wall so a missing flip would change the sampled column.

4. **Floor/ceiling fill + fallback (REND-03).** With `CONFIG.FLOOR_CAST=true`, render and assert **no** pixel in `buf32` still equals `CONFIG.CLEAR_COLOR` (whole frame covered, including the horizon row). Assert a below-horizon pixel derives from `Textures.map.floor` and an above-horizon pixel from `Textures.map.ceiling` (compare against the shaded expected texel). Flip `CONFIG.FLOOR_CAST=false`, render again, assert floor pixels equal `applyShade(FLOOR_COLOR, rowShade)` and that rows get monotonically darker toward the horizon in *both* modes.

5. **Distance shading (REND-04).** Assert a near wall column's average brightness `>` a far wall column's (drive `Player` forward one cell between two renders, or use two walls at different depths). Assert a `side==1` column is darker than a `side==0` column at equal `perpWall`. Assert no shaded channel drops below `floor(MIN_SHADE*255)` for the nearest geometry (readability floor).

6. **Contract & robustness.** Assert `h.putCount()` is unchanged by a direct `Raycaster.render()` call (the view does not present) but increments by exactly 1 per `raf.step()` (Game.render presents once). Assert two consecutive `Raycaster.render()` calls with an unchanged pose produce byte-identical `buf32` (determinism / no per-frame RNG). Set `Player.setDir(1,0)` then `setDir(0,1)` and assert `buf32`/`zBuffer` contain no `NaN` (axis-aligned div-by-zero guard). Boot at two `innerWidth/innerHeight` aspect ratios and assert both render without an out-of-range write and with `Framebuffer.height` in `[200,480]`.

### Sampling Rate
- **Per task commit:** `node "Doom/Claude Opus 4.8/GSD/tools/verify-render.cjs"` (fast, deterministic, no browser).
- **Per wave merge:** run all `tools/verify-*.cjs`; every token must print.
- **Phase gate:** full suite green + one manual `file://` open (no-fisheye eyeball on a long wall, seam check on the `exit` arrow, floor/wall-base alignment, resize the window) before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `tools/verify-render.cjs` — new harness covering REND-01/02/03/04/06 + contract/robustness, terminal token e.g. `ALL_RENDER_CONTRACTS_PASS`.
- [ ] The independent reference perpendicular-distance DDA lives *inside* the harness (a second implementation, so a shared bug can't hide).
- [ ] No framework install needed — `boot.cjs` is the reusable bootstrap and already exports `assert`/`finish`.

## Security Domain

`security_enforcement` is enabled (ASVS L1). This phase is an **offline, single-player, no-network, no-user-data, no-DOM-string** software renderer. It reads game state and writes a pixel buffer; it accepts no external input, performs no I/O, no `innerHTML`, no `eval`, no `fetch`.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface. |
| V3 Session Management | no | No sessions. |
| V4 Access Control | no | No resources to access. |
| V5 Input Validation | partial | The only "inputs" are `Player` floats and `Level` cells. Defensive: `1e30` sentinel + `EPS`/`NaN` floors on `perpWall` + DDA iteration cap keep a malformed pose/map from producing `NaN`, `Infinity`, or an unbounded loop (availability). All buffer writes are index-bounded by `W*H`. |
| V6 Cryptography | no | No cryptography (never hand-roll — none present). |

### Known Threat Patterns for a Canvas software renderer
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unbounded DDA loop on a borderless/malformed map | Denial of Service | Iteration cap `Level.WIDTH+Level.HEIGHT+2`, mirroring `lineOfSight`; break on cap. |
| `NaN`/`Infinity` poisoning the framebuffer (axis rays, distance→0) | Tampering (of the render) | Finite `1e30` sentinel; `perpWall` floored to `EPS`; `!(x>0)` guards that also catch `NaN`. |
| Out-of-bounds buffer write | Tampering | All writes are `buf32[y*W+x]` with `y<H`, `x<W`; texel indices masked `& 63`. |
| Reintroducing `fetch`/ES module/`innerHTML` during refactor | (breaks `file://`; new surface) | Keep classic-script + procedural-asset contract; harness verifies self-containment. |

Bottom line: correctness and availability (no infinite loop, no `NaN`) are the real risk axis; there is no confidentiality/integrity attack surface. No security controls beyond the numeric/loop guards already specified are warranted.

## Sources

### Primary (HIGH confidence)
- [Lode's Computer Graphics Tutorial — Raycasting (DDA, camera plane, perpendicular distance, wall texturing, texX flip, texPos step, side darken)](https://lodev.org/cgtutor/raycasting.html) — the canonical reference; every wall formula above traces to it.
- [Lode's Raycasting II — Floor and ceiling casting (row-based, `rowDistance`, `posZ`, linear world-coord walk, ceiling mirror)](https://lodev.org/cgtutor/raycasting2.html) — the floor/ceiling pass.
- Repo source read this session (VERIFIED against real contracts): `js/framebuffer.js` (buf32/zBuffer/present), `js/level.js` (isSolid/cellAt/WALL_TEXTURES/textureFor/lineOfSight DDA + `LOS_BIG` idiom), `js/player.js` (vector camera), `js/config.js` (packRGBA/FOV_PLANE/TEX_SIZE/CEIL_COLOR/FLOOR_COLOR), `js/textures.js` (64×64 buf32 asset shape, `exit` asymmetric arrow), `js/game.js` (view seam + single present), `js/topdown.js` (the view contract to mirror), `tools/boot.cjs` + `tools/verify-motion.cjs` (harness idiom).

### Secondary (HIGH confidence, repo-internal cross-checks)
- `.planning/research/ARCHITECTURE.md` — render pass ordering, camera model, z-buffer coupling, anti-patterns.
- `.planning/research/PITFALLS.md` — the ranked domain pitfalls (fisheye, seams, floor perf, packed color, allocation) folded into the checklist above.

## Metadata

**Confidence breakdown:**
- Wall DDA + perpendicular distance (REND-01/06): HIGH — textbook, cross-checked against the repo's own `lineOfSight` DDA and the locked CONTEXT formulas.
- Wall texturing (REND-02): HIGH — Lodev formulas grounded in the real 64×64 power-of-two `Textures.map` buf32 shape.
- Floor/ceiling + fallback (REND-03): HIGH for the method; the `CAMERA_Z=0.5` alignment and fill-the-horizon-row detail are the only easy-to-miss bits, both called out.
- Distance shading (REND-04): HIGH for shape; specific constants are ASSUMED aesthetic tunables (A1/A2).
- Verification approach: HIGH — mirrors the shipped Phase 2 harness idiom; the falsifiable no-fisheye control is the notable rigor addition.

**Research date:** 2026-07-24
**Valid until:** stable domain — the raycaster math does not change. Revisit only if `Framebuffer`/`Textures`/`Player` contracts change (they are locked). ~90 days.
