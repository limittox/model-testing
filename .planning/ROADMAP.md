# Roadmap: DOOM Clone (Browser)

## Overview

This roadmap builds a self-contained, browser-based Doom clone as a software raycaster in six dependency-ordered phases, all under `Doom/Claude Opus 4.8/GSD/`. It front-loads the two non-negotiable contracts (a fixed low-resolution Uint32 framebuffer and frame-rate-independent motion) and the highest-risk rendering math, then layers gameplay on top: scaffold + procedural assets, a movable player in a hand-designed level, the first-person textured renderer, billboarded sprites, the combat loop (AI, weapons, pickups), and finally the HUD, synthesized audio, and win/lose flow that ties it into a playable game. Each phase leaves the project in a runnable, demoable vertical slice so progress is continuously verifiable, and every phase respects the zero-dependency, no-build, `file://`-capable, classic-script constraints.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Scaffold, Config & Procedural Assets** - Self-contained game shell that generates all art in code and blits a pixel-perfect framebuffer
- [ ] **Phase 2: Level, Player Movement & Input** - Move, strafe, run, and look around a hand-designed level with wall collision, verified top-down
- [ ] **Phase 3: Core Renderer — Walls, Floors & Ceilings** - First-person textured 3D world with distance shading and a per-column depth buffer
- [ ] **Phase 4: Sprite Rendering & Entities** - Billboarded sprites that scale, sort, and are occluded correctly by walls
- [ ] **Phase 5: Enemy AI, Weapons & Pickups** - The core combat loop: enemies hunt and attack, weapons deal hitscan damage, pickups are collectible
- [ ] **Phase 6: HUD, Audio & Game-State Machine** - HUD, synthesized SFX, and title/victory/death flow that complete the playable game

## Phase Details

### Phase 1: Scaffold, Config & Procedural Assets

**Goal**: A self-contained game shell opens in a browser with zero build step and renders procedurally-generated art into a pixel-perfect low-resolution framebuffer.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: PLAT-01, PLAT-02, PLAT-03, REND-05
**Success Criteria** (what must be TRUE):

  1. Double-clicking `Doom/Claude Opus 4.8/GSD/index.html` opens the game in a current desktop browser with no build step, no npm install, and no console or network errors (works from `file://` and a static server).
  2. All wall/floor textures and enemy/weapon/pickup sprites are generated in code at load time — nothing is fetched from disk or the network.
  3. The fixed low-resolution Uint32 framebuffer blits to the canvas and is crisply upscaled with pixelated scaling, shown by a visible load-time preview of the generated textures.

**Plans**: 2/2 plans executed

Plans:

- [x] 01-01-PLAN.md — Game shell tracer: `index.html` + `config.js` + two-canvas composite + one-time Uint32 framebuffer/present() + per-column z-buffer + CSS `image-rendering: pixelated` upscale; classic-script load-order contract locked
- [x] 01-02-PLAN.md — Procedural wall/floor/ceiling textures + enemy/pickup/weapon sprites into flat `{width,height,data,buf32}` buffers (seeded PRNG) with a load-time preview atlas blit

### Phase 2: Level, Player Movement & Input

**Goal**: The player can move, strafe, run, and look around a hand-designed level with correct wall collision, validated on a top-down view before any 3D exists.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: PLAT-04, CTRL-01, CTRL-02, CTRL-03, CTRL-04, LVL-01
**Success Criteria** (what must be TRUE):

  1. The player moves forward/back and strafes left/right with WASD and sprints with a run modifier, with motion that stays consistent regardless of frame rate (clamped delta-time survives tab refocus).
  2. The player turns with the mouse via the Pointer Lock API, and can still turn with the arrow keys when pointer lock is unavailable.
  3. The player cannot pass through walls and slides along them — no tunneling even at run speed.
  4. A hand-designed grid level with rooms, corridors, and multiple wall types is loaded, and the player's position and facing are verifiable on a top-down view.

**Plans**: 3/3 plans executed

Plans:

- [x] 02-01-PLAN.md — Grid level map: wall/texture-type IDs, forced-solid border + row normalization, materialized wall-ID→texture table, spawn/marker tables, grid line-of-sight helper, and the reusable headless harness bootstrap (wave 1)
- [x] 02-02-PLAN.md — Player pose (`{x,y,dirX,dirY,planeX,planeY}`, one rotation matrix for dir+plane) + per-axis radius collision that slides; `requestAnimationFrame` loop with clamped delta-time and the input/view seams (wave 2)
- [x] 02-03-PLAN.md — Tracer: pointer-lock mouse-look + arrow-key turn fallback + intent-only key-state map, and the flag-isolated top-down verification view drawn through the Phase 1 framebuffer (wave 3)

### Phase 3: Core Renderer — Walls, Floors & Ceilings

**Goal**: The level renders as a first-person textured 3D world with correct perspective, distance shading, and a per-column depth buffer that later passes consume.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: REND-01, REND-02, REND-03, REND-04, REND-06
**Success Criteria** (what must be TRUE):

  1. Walking through the level shows textured walls in correct first-person perspective with no fisheye distortion (perpendicular wall distance).
  2. Walls sample the correct texture column per screen column, and floors and ceilings are cast and shaded beneath and above them (with a flat-color fallback if the row-caster underperforms).
  3. Surfaces darken with distance so far geometry fades for atmosphere.
  4. The wall pass produces a per-column depth (z) buffer, verifiable as correct sprite occlusion once entities exist.

**Plans**: 3/3 plans executed

Plans:

- [x] 03-01-PLAN.md — Tracer: Raycaster view + DDA wall pass (perpendicular distance, no fisheye), per-column `zBuffer[x]`, solid-shaded columns, `Game.view` swap + CONFIG constants + wiring, and the falsifiable render harness (REND-01, REND-06)
- [x] 03-02-PLAN.md — Distance shading/fog + constant y-side darken, then wall texture-column sampling with side-based flips + seam/index masking (REND-04, REND-02)
- [x] 03-03-PLAN.md — Row-based floor/ceiling casting behind `CONFIG.FLOOR_CAST` + a real distance-shaded flat-color fallback path (REND-03)

### Phase 4: Sprite Rendering & Entities

**Goal**: Billboarded sprites for enemies and pickups render in the 3D world, correctly scaled, depth-sorted, and occluded by walls.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: ENT-01, ENT-02, ENT-03
**Success Criteria** (what must be TRUE):

  1. Enemy and pickup sprites appear as billboards that always face the camera and scale correctly with distance.
  2. Sprites behind walls are hidden and partial walls clip them correctly via the z-buffer, with nearer sprites drawn over farther ones (back-to-front sort).
  3. Sprite transparency is clean — no halo or fringe artifacts around edges.

**Plans**: 2/2 plans executed

Plans:

- [x] 04-01-PLAN.md — Tracer: Entities list from Level.spawns + billboard projection (inverted dir|plane matrix) with distance scaling, back-to-front depth sort, and a first per-column z-buffer occlusion cut; falsifiable sprite harness (ENT-01, ENT-02)
- [x] 04-02-PLAN.md — Partial-wall per-column z-buffer clipping + back-to-front sort overlap + clean alpha-tested transparency (no halo) + sprite fog shading (ENT-02, ENT-03)

### Phase 5: Enemy AI, Weapons & Pickups

**Goal**: The core combat loop works — enemies hunt and attack the player, weapons deal hitscan damage, and pickups are collectible across a populated level.
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: ENEM-01, ENEM-02, ENEM-03, ENEM-04, ENEM-05, WEAP-01, WEAP-02, WEAP-03, WEAP-04, WEAP-05, PICK-01, PICK-02, PICK-03, PICK-04, PICK-05, LVL-02
**Success Criteria** (what must be TRUE):

  1. Enemies stay idle until they see the player (line of sight), then chase and attack on a cooldown while respecting wall collision; they take damage, show a hit reaction, and die with a multi-frame death animation that leaves a corpse.
  2. The player can fire a single-shot pistol and switch to a spread-firing shotgun; hitscan shots damage the nearest enemy along the aim line, are blocked by walls, consume ammo, and stop firing when ammo is empty — with a bobbing viewmodel and muzzle flash.
  3. Walking over health, armor, ammo, and shotgun pickups collects them and applies the effect (heal to max, armor absorbs a portion of damage, ammo/shells replenished, shotgun granted).
  4. The level is populated with enemy spawns and pickups at designed positions, and a kill count tracks enemies defeated out of the total.

**Plans**: 4 plans

Plans:

- [ ] 05-01-PLAN.md — Tracer: enemy AI state machine (idle/chase/attack) with grid line-of-sight, shared per-axis wall collision, pooled fireball projectile, player combat state + armor absorption; enemy walk/attack frames (wave 1)
- [ ] 05-02-PLAN.md — Hitscan weapons: pistol (single ray) + shotgun (multi-pellet spread), DDA wall-stop, ammo gating, weapon switching, viewmodel bob + recoil + muzzle flash via an ordered overlay seam (wave 2)
- [ ] 05-03-PLAN.md — Enemy damage response: chance-based pain stagger, multi-frame death animation, non-targetable corpse, kill count out of the spawn-derived total (wave 3)
- [ ] 05-04-PLAN.md — Pickups (health/armor/ammo/shotgun) collection + effects, message queue + sound hook + framebuffer message line, and the populated level (8 enemies, 9 pickups) (wave 4)

### Phase 6: HUD, Audio & Game-State Machine

**Goal**: The game becomes a complete, self-contained arcade loop with a HUD, synthesized sound, and a title/victory/death flow driven by reaching the exit or dying.
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: HUD-01, HUD-02, HUD-03, HUD-04, HUD-05, HUD-06, AUD-01, AUD-02, AUD-03, LVL-03, LVL-04, LVL-05, LVL-06
**Success Criteria** (what must be TRUE):

  1. The HUD shows health, armor, ammo, current weapon, kill count, a center crosshair, and fading pickup/event messages, plus a minimap of the level layout, the player, and nearby entities; a red flash overlays the screen when the player takes damage.
  2. Distinct Web-Audio-synthesized sound effects play for pistol fire, shotgun fire, enemy attack, enemy death, pickups, and player damage — with no audio files.
  3. A title/start screen shows the controls and, on a single click, starts play while unlocking pointer lock and resuming the AudioContext (audio is never blocked by autoplay policy).
  4. Reaching the visibly-marked, reachable exit triggers a victory screen with stats (kills, time), and health reaching zero triggers a death screen with a restart option.

**Plans**: 3 plans (estimated)

Plans:

- [ ] 06-01: HUD (health/armor/ammo/weapon/kills/crosshair/messages/minimap) + red damage flash
- [ ] 06-02: Web Audio SFX synthesis (oscillators + noise + gain envelopes) with AudioContext resume on the start gesture
- [ ] 06-03: Game-state machine — title/victory/death screens, exit-reached win, health-zero lose, restart

**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Scaffold, Config & Procedural Assets | 2/2 | In Progress|  |
| 2. Level, Player Movement & Input | 3/3 | In Progress|  |
| 3. Core Renderer — Walls, Floors & Ceilings | 3/3 | In Progress|  |
| 4. Sprite Rendering & Entities | 2/2 | In Progress|  |
| 5. Enemy AI, Weapons & Pickups | 0/4 | Planned | - |
| 6. HUD, Audio & Game-State Machine | 0/3 | Not started | - |
