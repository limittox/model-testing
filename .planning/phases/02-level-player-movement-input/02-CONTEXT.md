# Phase 2: Level, Player Movement & Input - Context

**Gathered:** 2026-07-24
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss) — grey areas resolved at Claude's discretion and recorded below.

<domain>
## Phase Boundary

The player can move, strafe, run, and look around a hand-designed level with correct wall collision, validated on a top-down view before any 3D exists.

**In scope:** the level grid + map format, the player pose, the delta-time game loop, wall collision, keyboard + pointer-lock input, and a temporary top-down debug view that proves it all works.
**Out of scope:** the 3D raycaster (Phase 3), sprites/entities (Phase 4), enemies/weapons/pickups (Phase 5), HUD/audio/game states (Phase 6). Populating the level with enemies and pickups is **LVL-02 → Phase 5**; this phase only defines the map and the data structures those spawns will use.

**Requirements covered:** PLAT-04, CTRL-01, CTRL-02, CTRL-03, CTRL-04, LVL-01.
**All code goes under `Doom/Claude Opus 4.8/GSD/`** (quote paths — the folder name has spaces).
</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion (resolved)

1. **Camera model — direction vector + camera plane, NOT angle+trig (lock this).** Player pose is `{x, y, dirX, dirY, planeX, planeY}`. Turning rotates BOTH vectors with one 2D rotation matrix. This is the standard raycaster camera: it makes Phase 3's `rayDir = dir + plane * cameraX` fall out directly and yields perpendicular wall distance for free (the thing that prevents fisheye). Keep an `angle` only if convenient for the top-down view — the vectors are authoritative. Plane length comes from `CONFIG.FOV_PLANE`.

2. **Level format.** A hand-designed grid authored as an array of equal-length strings for readability, parsed once into a flat typed array of wall IDs (0 = empty/floor). **Force the outer border to solid wall during parsing** so a malformed row can never let the player escape the map, and validate/pad row lengths rather than trusting them. Include several distinct wall types (stone / brick / tech / door / exit) plus rooms and corridors so Phase 3 has visual variety.

3. **Materialize the wall-ID → texture mapping (Phase 1 verification forward-note).** Phase 1 left this as a comment only. Define it here as real data (e.g. `Level.WALL_TEXTURES[id] -> Textures.map.*` key) so Phase 3 consumes a table, not a convention. `0` must be unambiguously "no wall".

4. **Entity marker tables.** The map may carry non-wall markers (player spawn, and placeholders for enemies/pickups/exit). Parse them OUT of the grid into `Level.playerStart` and `Level.spawns[]` tables, leaving those cells as floor. Phase 5 consumes `spawns[]`. Only the player spawn is *used* this phase.

5. **Delta-time (PLAT-04, lock this).** `requestAnimationFrame` loop with `dt = Math.min((now - last) / 1000, 0.05)`. Every movement/turn value is expressed in units-per-second and multiplied by `dt`. The clamp is what prevents a huge post-tab-refocus delta from tunneling the player through a wall. Never move by a per-frame constant.

6. **Collision — per-axis with a radius (CTRL-04, lock this).** Player has a collision radius (~0.2 world units). Resolve the X move and the Y move **separately**, each rejected independently if the destination cell is solid. This is what produces natural wall *sliding* instead of sticking. Check the cell at the moved coordinate offset by ±radius on the moving axis. Combined with the dt clamp this makes tunneling structurally impossible at run speed.

7. **Input — intent-only key state (lock this).** `keydown`/`keyup` maintain a set of currently-held `event.code` values (physical keys, layout-independent). Handlers set intent ONLY; they never mutate player state. `update(dt)` samples the set. `preventDefault()` on movement/arrow keys so the page never scrolls. Bindings: WASD move/strafe, Shift run, arrows turn, Escape releases pointer lock.

8. **Mouse-look (CTRL-02/CTRL-03).** Request pointer lock from a click handler, preferring `{ unadjustedMovement: true }` (Chromium gives raw deltas; other browsers ignore the option harmlessly). Read `movementX` in `mousemove`, scale by a sensitivity constant, rotate the camera. Handle `pointerlockchange` and `pointerlockerror`. **Arrow-key turning must work whether or not pointer lock is active** — that is the CTRL-03 fallback, not a debug affordance.

9. **Top-down verification view (this phase's vertical slice).** Draw the parsed grid, the player position, and a facing ray into the existing Phase 1 `Framebuffer` (reuse `present()`; do not add a second render path). This is how success criteria 1–4 become observable before any 3D exists. It is temporary scaffolding — keep it in its own file behind a flag so Phase 3 can switch to the raycaster without unpicking it.

10. **Reuse Phase 1 contracts, do not re-architect.** `CONFIG`, `packRGBA`, `mulberry32`, `Framebuffer` (incl. `buf32`, `zBuffer`, `present()`), `Textures`, `Sprites` already exist. Add new classic `<script>` tags BEFORE `js/main.js`, preserving the documented load-order contract in `index.html`.
</decisions>

<code_context>
## Existing Code Insights

Phase 1 shipped and is verified (14/14): `js/config.js` (CONFIG + packRGBA + mulberry32), `js/framebuffer.js` (Uint32 framebuffer, per-column `Float32Array` z-buffer, `present()`, aspect-correct `resize()`), `js/textures.js` (7 tiling 64x64 textures), `js/sprites.js` (3 alpha-keyed sprites, `ALPHA_KEY = 128`), `js/preview.js` (load-time atlas — this phase's top-down view replaces it as the default screen), `js/main.js` (entry point).

Note: `Framebuffer.resize()` clears the `#hud` backing store, and the internal height is derived from viewport aspect within `[MIN_H, MAX_H]` = `[200, 480]` (widened in Phase 1 so no realistic window stretches). Anything drawn to `#hud` must be repainted after a resize.
</code_context>

<specifics>
## Specific Ideas

- Verify from `file://` (double-click) AND the static server — a standing check every phase.
- The dt clamp + per-axis collision are the two things most likely to be silently wrong; make them observably testable (e.g. simulate a 2-second frame hitch and assert the player did not pass through a wall).
- Keep the level a reasonable size (roughly 24x24) — big enough for rooms and corridors, small enough to hand-author and reason about.
</specifics>

<deferred>
## Deferred Ideas

- Raycasting / walls / floors / ceilings — Phase 3.
- Billboarded sprites and the entity system — Phase 4.
- Enemy spawns and pickup population (LVL-02), weapons, AI — Phase 5.
- HUD, minimap, audio, title/victory/death states — Phase 6.
</deferred>
