# Phase 4: Sprite Rendering & Entities - Context

**Gathered:** 2026-07-25
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss) — grey areas resolved at Claude's discretion and recorded below. Second math-risk phase (sprite projection); the formulas are locked precisely.

<domain>
## Phase Boundary

Billboarded sprites for enemies and pickups render in the 3D world, correctly scaled, depth-sorted, and occluded by walls (via the z-buffer the wall pass fills).

**In scope:** an entity list, the billboard projection + distance scaling, back-to-front depth sort, per-column z-buffer occlusion, and clean alpha-tested transparency. This is a RENDERING phase — sprites are drawn correctly in 3D.
**Out of scope:** enemy AI, movement, attacks, health, pickups being collected, weapons — all Phase 5. Phase 4 renders STATIC billboards at the level's spawn positions so occlusion/scaling/sort are testable; behavior comes next phase. HUD/audio/states are Phase 6.

**Requirements covered:** ENT-01, ENT-02, ENT-03.
**All code under `Doom/Claude Opus 4.8/GSD/`** (quote paths — spaces in folder name).
</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion (resolved) — sprite projection math LOCKED

1. **Entity model.** Add an `Entities` global: a preallocated list of `{x, y, sprite, scale, onFloor}` instantiated from `Level.spawns[]` (which already carries type + position). Map spawn types to `Sprites.map` entries: enemy spawns → `enemy`, health/armor/ammo/shotgun → `pickup` (Phase 5 can differentiate icons), exit → a marker sprite or leave to Phase 6. Enemies: `scale ≈ 1`, `onFloor: true`. Pickups: `scale ≈ 0.5`, `onFloor: true` (rest on the floor). Behavior fields (health, state, …) are NOT added here — Phase 5 owns them. Keep the list stable/preallocated (no per-frame allocation).

2. **Sprite render pass — runs AFTER the wall pass (lock the order).** The z-buffer must already be filled by the wall pass before sprites test against it. Add `Raycaster` a sprite pass (or a `Sprites`-adjacent renderer invoked by the Raycaster after walls) that runs each frame after floor/ceiling + walls, before `present()`. Sort entities far→near each frame by squared distance to the player (reuse a scratch array + indices; no allocation in the hot path).

3. **Billboard projection (Lodev sprite casting — lock these formulas).** With player `{x,y,dirX,dirY,planeX,planeY}` and screen `W×H` (read live from `Framebuffer.width/height`):
   - `invDet = 1 / (planeX*dirY - dirX*planeY)` (compute once per frame).
   - Per entity: `relX = e.x - px; relY = e.y - py;`
   - `transformX = invDet * (dirY*relX - dirX*relY);`
   - `transformY = invDet * (-planeY*relX + planeX*relY);`  ← this is the sprite DEPTH; skip the sprite if `transformY <= NEAR` (small positive clip, e.g. 0.02–0.1) so sprites behind the camera / at the plane don't blow up.
   - `spriteScreenX = floor((W/2) * (1 + transformX/transformY));`
   - Use screen HEIGHT `H` as the projection scale for BOTH width and height so billboards stay square regardless of viewport aspect: `spriteDim = abs(floor(H / transformY)) * scale;`
   - `vMoveScreen` for floor-resting sprites so a `scale<1` sprite's BASE sits on the floor line (not floating): `vMove = onFloor ? H*(1-scale)/2 : 0; vMoveScreen = floor(vMove / transformY);`
   - `drawStartY = -spriteDim/2 + H/2 + vMoveScreen` (clamp ≥0); `drawEndY = spriteDim/2 + H/2 + vMoveScreen` (clamp <H). `drawStartX = -spriteDim/2 + spriteScreenX` (clamp ≥0); `drawEndX = spriteDim/2 + spriteScreenX` (clamp <W).
   - Per stripe `stripe` in `[drawStartX, drawEndX)`: `texX = floor((stripe - (-spriteDim/2 + spriteScreenX)) * TEXW / spriteDim)` (clamp to `[0,TEXW)`).

4. **Z-buffer occlusion (ENT-02, lock this).** For each sprite stripe: draw the column ONLY if `transformY > 0 && stripe >= 0 && stripe < W && transformY < Framebuffer.zBuffer[stripe]`. This is what hides sprites behind walls and clips them against partial walls per-column. Back-to-front sort makes nearer sprites overwrite farther ones. (Sprites do NOT write the z-buffer — later sprites test only against wall distance, which matches Doom.)

5. **Transparency (ENT-03, lock this).** Sprites use the Phase 1 color-key: a texel is transparent when `((packed >>> 24) & 0xff) < Sprites.ALPHA_KEY` (128). Sprite alpha is already BAKED BINARY (0 or 255) from Phase 1, and sampling is nearest-neighbor (manual per-pixel) — so there is no smoothing and structurally no halo/fringe. Skip transparent texels; write opaque ones. Do NOT introduce any canvas image smoothing.

6. **Sprite shading.** Shade sprite texels by `transformY` (depth) using the SAME `Raycaster.shadeFactor`/`applyShade` as walls so a distant enemy fogs consistently with the wall behind it. Keep alpha opaque on written texels. (A per-entity hurt-flash/tint hook may be added in Phase 5 — do not build it now, but a `scale`/shade path that Phase 5 can extend is fine.)

7. **Verification math for the harness.** Provide a falsifiable occlusion proof: place a sprite directly behind a wall (transformY > zBuffer at its columns) and assert NONE of its columns are written; move it in front (transformY < zBuffer) and assert it IS written. Provide a scaling proof: the same sprite at distance d and 2d has drawn pixel-height in ~2:1 ratio. Provide a sort proof: two overlapping sprites, the nearer's texels win. Provide a transparency proof: count non-opaque destination pixels inside a sprite's bounding box remains as expected (transparent texels leave the background wall pixel intact — no halo). Reuse `tools/boot.cjs`; render one frame headlessly and assert on `buf32`/`zBuffer`.

8. **Reuse, don't re-architect.** `CONFIG`, `Framebuffer` (buf32, zBuffer, width/height, present), `Player` pose, `Level.spawns`, `Sprites.map.*` (with `ALPHA_KEY`), `Raycaster` (walls/floor/ceiling + shadeFactor/applyShade), `Game.view`/`Game.render` all exist. New `<script>` before `js/main.js` per the load-order contract. Single `putImageData` stays in `Game.render`.
</decisions>

<code_context>
## Existing Code Insights

Phase 3 shipped and verified (4/4): `js/raycaster.js` is `Game.view`, renders floor/ceiling + textured walls + fog, and writes `Framebuffer.zBuffer[x]` (perpendicular distance) for every column — verified correct to 1e-6 vs an independent DDA, so sprite occlusion has a sound buffer to test against. `Raycaster.shadeFactor(dist,isYSide)` and `Raycaster.applyShade(packed,shade)` (alpha-preserving) are reusable for sprite fog. `Sprites.map.{enemy,pickup,weapon}` are `{width,height,data,buf32}` with baked binary alpha and `Sprites.ALPHA_KEY = 128`. `Level.spawns[]` holds `{mx,my,x,y,type}` markers already parsed out of the grid (3 enemy, health, armor, ammo, shotgun, exit) — the positions to place billboards. Internal height is aspect-derived in [200,480]; read `Framebuffer.width/height` every frame.

Note the rAF-throttle caveat for headless verification: on a non-composited tab the game loop doesn't tick, so harnesses/checks must drive a frame manually (`Game.view.render(0)` + `Framebuffer.present()`); this is a verification artifact, not a bug.
</code_context>

<specifics>
## Specific Ideas

- The single most important correctness property is ENT-02 occlusion: `transformY < zBuffer[stripe]` per column. Make it falsifiable (sprite behind wall → zero columns drawn; in front → drawn).
- Keep the sprite pass allocation-free (scratch arrays, index sort) — it runs every frame over potentially tens of entities.
- Verify from file:// and a static server. Watch for the classic sprite bugs: wrong sign in transformX/Y, using W instead of H for the projection scale (distorts on widescreen), off-by-one in texX, and floating pickups (vMove).
</specifics>

<deferred>
## Deferred Ideas

- Enemy AI (idle/chase/attack/death), enemy movement + collision, projectiles, taking/dealing damage, kill count — Phase 5.
- Pickup collection + effects, weapons/hitscan, LVL-02 population semantics — Phase 5.
- Per-entity hurt-flash/tint, HUD, minimap, audio, title/victory/death — Phases 5-6.
- Directional (8-angle) enemy sprites — v2 (out of scope).
</deferred>
