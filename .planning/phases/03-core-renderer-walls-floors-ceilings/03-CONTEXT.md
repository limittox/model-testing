# Phase 3: Core Renderer — Walls, Floors & Ceilings - Context

**Gathered:** 2026-07-24
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss) — grey areas resolved at Claude's discretion and recorded below. This is the highest math-risk phase (research flag); decisions are precise on purpose.

<domain>
## Phase Boundary

The level renders as a first-person textured 3D world with correct perspective, distance shading, and a per-column depth buffer that later passes consume.

**In scope:** the DDA wall raycaster (perpendicular distance, textured columns, side shading), row-based floor/ceiling casting (with a flat-color fallback), distance fog, and populating `Framebuffer.zBuffer` per column. This REPLACES the top-down view as the default render path.
**Out of scope:** sprites/entities (Phase 4 — but the z-buffer this phase fills is exactly what Phase 4 tests against), enemies/weapons/pickups (Phase 5), HUD/minimap/audio/states (Phase 6). No new gameplay — just rendering what Phase 2 already simulates.

**Requirements covered:** REND-01, REND-02, REND-03, REND-04, REND-06.
**All code under `Doom/Claude Opus 4.8/GSD/`** (quote paths — spaces in folder name).
</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion (resolved) — the raycaster math is LOCKED here

1. **Swap mechanism (lock this).** Add a `Raycaster` global with `render()` that writes `Framebuffer.buf32` and does NOT present (same contract as `TopDown`). Point `Game.view` at it. Keep `TopDown` in the tree behind `TopDown.ENABLED = false` so it remains a debug toggle; do not delete it. `Game.render()` still owns the single `putImageData`.

2. **Per-column DDA wall cast (lock the formulas).** For each screen column `x` in `[0, W)`:
   - `cameraX = 2*x/W - 1`; `rayDirX = dirX + planeX*cameraX`; `rayDirY = dirY + planeY*cameraX`.
   - Integer map cell `mapX/mapY = floor(px/py)`. `deltaDistX = abs(1/rayDirX)`, `deltaDistY = abs(1/rayDirY)` (guard divide-by-zero with a large finite sentinel).
   - Step/sideDist init from fractional position; DDA loop steps to the nearer side until `Level.isSolid(mapX,mapY)`.
   - **Perpendicular distance (this is what kills fisheye — REND-01):** `perpWall = side==0 ? (sideDistX - deltaDistX) : (sideDistY - deltaDistY)`. NEVER use Euclidean distance to the hit point.
   - `lineHeight = floor(H / perpWall)`; `drawStart = -lineHeight/2 + H/2` (clamp ≥0); `drawEnd = lineHeight/2 + H/2` (clamp <H).
   - **Write `Framebuffer.zBuffer[x] = perpWall`** for every column (REND-06). Guard perpWall to a small positive floor so a hit at distance ~0 can't divide-by-zero.
   - Bound the DDA iteration count so a malformed/borderless map can't infinite-loop (the border is forced solid, but defend anyway).

3. **Wall texturing (REND-02, lock the seam handling).**
   - `wallX = side==0 ? py + perpWall*rayDirY : px + perpWall*rayDirX`; `wallX -= floor(wallX)`.
   - `texX = floor(wallX * TEX)`; flip for consistent orientation: `if (side==0 && rayDirX>0) texX = TEX-1-texX; if (side==1 && rayDirY<0) texX = TEX-1-texX;`
   - Vertical sample via fixed-point step: `step = TEX/lineHeight`, `texPos = (drawStart - H/2 + lineHeight/2)*step`; per row `texY = floor(texPos) & (TEX-1)` (TEX is 64, power of two — mask, don't modulo). Advance `texPos += step`.
   - Texture chosen from `Level.WALL_TEXTURES[cellId]` (real table from Phase 2). One texel copy is a packed `buf32` assignment.

4. **Side shading + distance fog (REND-04, lock this).** Give `side==1` (y-side) walls a constant multiplier (~0.7) so perpendicular walls read as lit differently — cheap depth cue. Then apply distance fog: a monotonic factor of `perpWall` (e.g. `fog = clamp(1 - perpWall/FAR, MINSHADE, 1)` or an inverse-distance curve), so far geometry fades toward a fog/ambient color. Shade by multiplying the texel's r/g/b (unpack from packed, scale, repack) — keep it branch-light. Define the fog constants in `CONFIG`.

5. **Floor/ceiling casting (REND-03, lock the row-based method + fallback).**
   - Row-based (efficient) cast: for each screen row `y` below the horizon, `rowDist = (0.5*H) / (y - H/2)`; leftmost/rightmost ray dirs give a per-row world step; walk `floorX/floorY` across the row sampling the floor texture; the mirrored row above the horizon samples the ceiling texture. Shade by `rowDist` with the same fog curve.
   - **Fallback path (REND-03 explicit):** gate textured floor/ceiling behind `CONFIG.FLOOR_CAST` (or similar). When off, fill floor and ceiling with distance-shaded FLAT colors. The fallback must be a real, correct code path — not dead code — so if the row-caster ever underperforms the game still ships. Default ON; both paths shade with distance.
   - Draw order that keeps it correct and simple: cast floor/ceiling for the whole frame first (fills every pixel), then the wall pass overwrites wall spans and sets the z-buffer. (Walls are opaque; floors/ceilings never write the z-buffer, which is correct — sprites in Phase 4 test only against wall distance.)

6. **Performance (perf is a real risk here).** Internal resolution is `CONFIG.INTERNAL_W` × derived height (≤ ~172k px at 4:3 after the Phase 1 fix). Hot loops must not allocate: reuse scratch, read packed texels, write packed buf32. Precompute per-row/per-column invariants out of the inner loop. Target ~60fps mid-desktop; measure and keep the fallback ready. No `getImageData` in the render loop — only the single `present()` `putImageData`.

7. **Reuse, don't re-architect.** `CONFIG`, `Framebuffer` (buf32, zBuffer, present, width/height), `Textures.map.*` (64×64 `{width,height,data,buf32}`, power-of-two), `Level` (grid, `isSolid`, `WALL_TEXTURES`), `Player` pose, `Game.view`/`Game.render` all exist. New `<script>` tag(s) before `js/main.js` per the load-order contract. The headless `tools/boot.cjs` harness bootstrap is reusable — Phase 3 harnesses can render a frame headlessly and assert on `buf32`/`zBuffer` values.
</decisions>

<code_context>
## Existing Code Insights

Phases 1–2 shipped and verified. Relevant to this phase: `Framebuffer.zBuffer` is a `Float32Array(width)` already allocated and waiting to be filled by the wall pass. `Game.view` is the single swap seam — assign `Raycaster` to it and the loop renders 3D with no other change (top-down proved this seam works). `Level.WALL_TEXTURES[id]` maps wall IDs to `Textures.map` entries (index 0 = null/no-wall) and `Level.validateTextures()` returns `[]`. `Player` exposes `{x,y,dirX,dirY,planeX,planeY}` orthonormal (|dir|=1, |plane|=FOV_PLANE=0.66). Internal height is aspect-derived within `[MIN_H,MAX_H]=[200,480]`, so the renderer must read `Framebuffer.width/height` every frame — never hardcode 480×270.
</code_context>

<specifics>
## Specific Ideas

- The single most important correctness property is REND-01: use PERPENDICULAR wall distance. A quick headless check: a ray straight ahead and a ray at column edge to the same flat wall must yield wall-heights consistent with a flat (non-curved) surface — i.e. no fisheye bulge. Make this assertable.
- Make the z-buffer correctness checkable now (before sprites exist): after a frame, `zBuffer[x]` must be finite, positive, and match the perpendicular distance to the first solid cell along column `x`'s ray. Phase 4 depends on this being right.
- Keep the textured-vs-flat floor/ceiling behind a real flag so the fallback is exercised by a harness, not just claimed.
- Verify from file:// and a static server. Watch for texture seams (off-by-one at column edges) and the classic fisheye bug.
</specifics>

<deferred>
## Deferred Ideas

- Billboarded sprites + entity system (Phase 4) — will consume this phase's z-buffer.
- Enemies/weapons/pickups (Phase 5), HUD/minimap/audio/title-victory-death (Phase 6).
- Any variable floor/ceiling height / verticality — explicitly out of scope (breaks the raycaster assumption).
</deferred>
