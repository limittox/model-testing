# Project Research Summary

**Project:** DOOM Clone (Browser)
**Domain:** Browser software raycasting FPS (zero-dependency, no-build, `file://`-capable Canvas 2D + Web Audio)
**Researched:** 2026-07-23
**Confidence:** HIGH

## Executive Summary

This is a "2.5D" Doom/Wolfenstein-style first-person shooter that runs entirely client-side with no build step and no external assets. The domain is mature and exhaustively documented — 30+ years of raycaster clones and Lode Vandevenne's canonical tutorial mean the architecture, math, and feature set are effectively settled. Experts build these as a single-pass software renderer: a DDA ray march per screen column for textured walls (writing a per-column z-buffer), row-based floor/ceiling casting, and billboarded sprites depth-sorted and occluded against that z-buffer — all rendered into one `Uint32Array` framebuffer at a fixed low internal resolution and CSS-upscaled with `image-rendering: pixelated`. The "stack" is deliberately native browser APIs (Canvas 2D `ImageData`, Pointer Lock, Web Audio, `requestAnimationFrame`, classic non-module scripts), not packages.

The recommended approach is prescriptive and low-ambiguity: use the **vector camera-plane model** (dir + plane, not angle+trig), a **one-time-allocated Uint32 framebuffer + 1D z-buffer**, **per-axis collision with a radius**, **clamped delta-time**, and **procedural textures/sprites + synthesized audio** so the game runs from `file://`. Feature scope is well-bounded: table stakes (textured renderer, movement+mouselook, sprite enemies with AI, hitscan weapons, pickups, HUD, one level, win/lose, SFX) are all P1; differentiators (multi-weapon, armor, minimap, screen flashes, enemy variety) are P2 polish; and several tempting features (variable floor heights, vertical look, multiplayer, WAD loading, save/load) are explicit anti-features that break the raycaster's assumptions or blow the one-shot budget.

The risk axis is **rendering math and performance, not security** (there is no server, network, or user data). The critical risks concentrate in two places: the core wall renderer (fisheye if you use euclidean instead of perpendicular distance; slow rendering if you misuse `ImageData` or render at full resolution) and the sprite pass (occlusion/sort-order bugs, transparent-sprite halos). Both are prevented by well-known techniques applied from the first commit. The two cross-cutting must-get-right-early decisions are the **Uint32 framebuffer contract** (retrofitting per-byte writes is a full rewrite) and **delta-time** (retrofitting touches every motion call site). Browser gesture policies (Pointer Lock + audio unlock) are a guaranteed gotcha, cleanly solved by a single "click to start" screen.

## Key Findings

### Recommended Stack

A curated set of native, Baseline browser APIs — no packages, no bundler, no transpiler (adding any violates the no-build constraint). The load-bearing decision is a **fixed low internal resolution** (320x200 classic or 480x270/640x360 widescreen) written into one packed `Uint32Array` framebuffer and CSS-upscaled, making per-frame cost independent of window size. See STACK.md.

**Core technologies:**
- **HTML5 Canvas 2D (`getContext("2d")`) + `ImageData`** — the software render surface with direct per-pixel RGBA access, exactly what floor/ceiling casting and sprites need (WebGL would force a different architecture)
- **`Uint32Array` view over `ImageData.data` + typed-array textures** — one packed 32-bit write per pixel (~4x fewer memory ops than per-byte); precompute all colors in packed little-endian `(a<<24)|(b<<16)|(g<<8)|r`
- **`requestAnimationFrame` + clamped delta-time** — the only correct vsync-aligned loop primitive; clamp `dt` to ~0.05s to prevent tunneling/spiral-of-death after tab refocus
- **Pointer Lock API (`movementX`)** — the only way to do proper FPS mouse-look; request inside a click handler, keyboard-turn fallback
- **Web Audio API (oscillators + noise + gain envelopes)** — all SFX synthesized at runtime, zero audio files; `resume()` on first gesture
- **Classic (non-module) `<script>` tags** — mandatory: ES modules are blocked by CORS on `file://`; this dictates the whole module strategy (globals/IIFE, load order = dependency order)
- **CSS `image-rendering: pixelated`** — free GPU nearest-neighbor upscale, delivering both the retro look and the performance win

### Expected Features

Mature, well-settled domain. The design work is drawing the line between authentic table stakes, polish, and complexity traps. See FEATURES.md.

**Must have (table stakes, all P1):**
- Textured raycast walls + floor/ceiling + distance shading with per-column z-buffer — the genre-defining visual
- Movement (WASD/strafe/run) + mouse-look + wall collision — core locomotion
- Billboarded, depth-sorted, z-buffer-occluded sprite enemies — enemies are the game
- Enemy AI state machine: idle -> sight -> chase -> attack -> pain -> death (LOS-based waking)
- Hitscan pistol + shotgun with bob, muzzle flash, ammo cost
- Pickups (health/armor/ammo/shotgun), HUD (health/armor/ammo/weapon/kills/crosshair/messages/minimap)
- One designed traversable level with reachable exit; win/lose + title/victory/death screens
- Synthesized SFX; fully self-contained (procedural art + synth audio, runs from `file://`)

**Should have (P2 differentiators):**
- Multiple weapons + switching, armor absorption, minimap, screen damage/pickup flashes
- Enemy variety (2-3 types via per-type stats), death animation + corpse, kill counter/messages

**Defer (v1.x / v2+):**
- Third enemy type, additional weapon (chaingun), richer screen effects, ambient audio (v1.x)
- Second level, doors/switches/keys, difficulty settings (v2+)

**Explicit anti-features:** variable floor/ceiling heights, vertical look/jump/crouch, multiplayer, WAD loading, level editor, save/load, physics projectiles, mobile controls, full lighting engine. Each breaks the raycaster's single-height assumption or blows the one-shot budget.

### Architecture Approach

A single-frame pipeline: `input -> update(dt) -> render() -> present`, over one authoritative game state that only `update()` mutates. The renderer is a read-only, four-pass function (floor/ceiling -> walls+zBuffer -> sprites -> weapon/HUD) producing one framebuffer. All modules share global scope via classic scripts; file boundaries are the module boundaries, and load order encodes the dependency graph. See ARCHITECTURE.md.

**Major components:**
1. **Assets (textures/sprites/audio/level)** — pure producers built once at load into flat typed arrays; no gameplay deps
2. **Player + Input** — pose (`{x,y,dirX,dirY,planeX,planeY}`) + per-axis grid collision; input sets intent flags only, never mutates state directly
3. **Entities + AI** — plain objects in an array; per-enemy state machine with grid line-of-sight ray march
4. **Weapons** — hitscan = one DDA ray reusing wall traversal; ammo, muzzle flash, bob
5. **Renderer** — four ordered passes; wall pass fills the shared 1D `zBuffer[x]` that the sprite pass consumes
6. **Game loop / state machine** — RAF loop with clamped dt; title/play/win/lose screens; audio fired as side effects of state transitions

**Key patterns:** vector camera-plane model (not angle+trig), DDA grid traversal with perpendicular distance, shared 1D z-buffer with back-to-front sprite sort, row-based floor/ceiling casting.

### Critical Pitfalls

1. **Fisheye distortion** — use perpendicular distance (`sideDist - deltaDist` from DDA), never euclidean ray length; the camera-plane model gives this for free. Fix at the first wall column.
2. **Slow per-pixel rendering** — allocate one `ImageData` + `Uint32Array` view once, `putImageData` once per frame, render at low internal resolution, prepack textures as `Uint32`. Never `getImageData` in the loop or write per-byte.
3. **Frame-rate-dependent movement** — measure and clamp `dt`, scale all motion by it. Bake in from the first movement commit; retrofitting touches every call site.
4. **Sprite z-buffer occlusion / sort order** — wall pass writes `zBuffer[column]`; sprite pass sorts far-to-near (dist^2 descending) and skips texels where `spriteDepth >= zBuffer[column]`. Define the z-buffer contract in the wall phase.
5. **Collision tunneling / no wall-sliding** — resolve X and Y independently with a collision radius (~0.2-0.3 cells) and clamped dt. Combined-axis checks feel terrible.
6. **Pointer Lock + audio need a user gesture** — a single "Click to play" button requests pointer lock AND resumes the AudioContext; keyboard-turn fallback, handle Esc re-grab.

Additional owned-early concerns: texture seams/mirroring (side-based texX flip + index masking), transparent-sprite halos (bake alpha, disable smoothing), floor/ceiling perf (row-based caster + flat-color fallback), and the `file://` contract (no modules/fetch — guard every phase).

## Implications for Roadmap

Research yields a natural, incrementally-demoable phase order that de-risks the renderer early. This maps directly to ARCHITECTURE.md's build-order section and the pitfall-to-phase mapping.

### Phase 1: Scaffold + Config + Procedural Assets
**Rationale:** Assets are pure producers with zero gameplay dependencies; they unblock everything and can be previewed in isolation. Establishes the two non-negotiable contracts on day one.
**Delivers:** `index.html` (classic scripts, canvas), `config.js` (internal W/H, FOV, tile size), procedural texture + sprite generation into flat `Uint32Array`s.
**Addresses:** Self-contained procedural assets (table stakes).
**Avoids:** `file://`/ES-module breakage (Pitfall 10); locks the Uint32 framebuffer + classic-script contracts before any drift.

### Phase 2: Level + Player + Input (2D-verifiable)
**Rationale:** Movement/collision/look are validated top-down before any 3D exists, isolating input correctness from renderer correctness.
**Delivers:** Grid map + spawn/item tables + LOS helper, player pose, per-axis collision, pointer-lock + keyboard look, key-state map.
**Uses:** Pointer Lock API, `event.code` key map, clamped delta-time.
**Avoids:** Frame-rate-dependent movement (Pitfall 2), collision tunneling (Pitfall 5), input-handler state mutation anti-pattern.

### Phase 3: Core Renderer — Walls + Floor/Ceiling (RESEARCH-FLAG)
**Rationale:** Highest-risk math in the project; first "real Doom look." Everything downstream reads its framebuffer + z-buffer.
**Delivers:** DDA wall pass with textures + distance shading filling `zBuffer[x]`; row-based floor/ceiling; single `putImageData` blit with CSS upscale.
**Implements:** Renderer component (passes 1-2), vector camera-plane model, DDA traversal.
**Avoids:** Fisheye (Pitfall 1), slow ImageData rendering (Pitfall 3), texture seams (Pitfall 6), floor/ceiling perf+precision (Pitfall 7). Keep a flat-color floor fallback.

### Phase 4: Sprites + Entities (RESEARCH-FLAG)
**Rationale:** Depends on the wall pass's z-buffer; sprite projection is the second nontrivial-math area.
**Delivers:** Billboard projection (invert the dir|plane matrix), back-to-front sort, per-column z-buffer occlusion, alpha-tested transparency.
**Implements:** Renderer sprite pass + entity list.
**Avoids:** Occlusion/sort bugs (Pitfall 4), transparent-sprite halos (Pitfall 9).

### Phase 5: AI + Weapons + Pickups
**Rationale:** Needs entities + level LOS. Hitscan and AI-sight both reuse the DDA ray, so build one weapon end-to-end first.
**Delivers:** Enemy state machine (idle/chase/attack/pain/death) with grid LOS, hitscan fire with wall-stop, ammo, damage/death, item grants (health/armor/ammo/shotgun), multi-weapon switching.
**Addresses:** Enemy AI, hitscan weapons, pickups, weapon feel (table stakes + P2 multi-weapon).
**Avoids:** Hitscan/AI firing through walls (moderate pitfall — DDA-march and stop at first wall).

### Phase 6: HUD + Audio + Game-State Machine
**Rationale:** Ties the loop together; the title screen is the single user gesture that unlocks both pointer lock and audio.
**Delivers:** HUD (health/armor/ammo/weapon/kills/crosshair/messages/minimap), synthesized SFX, title/victory/death screens, win (exit)/lose (health) conditions, screen flashes.
**Addresses:** HUD, SFX, win/lose + screens (table stakes); minimap + screen effects (P2).
**Avoids:** Pointer-lock/audio gesture gotcha (Pitfall 8), audio node-lifecycle clicks/leaks, per-frame minimap redraw.

### Phase Ordering Rationale

- **Dependency-driven:** assets -> world state -> renderer -> sprites -> gameplay -> glue. Each phase produces something visible/testable; the z-buffer contract (wall phase) precedes its consumer (sprite phase).
- **Risk-front-loaded:** the only nontrivial math (wall math, sprite projection) lands in Phases 3-4 with fallbacks defined; later phases are standard game-loop/state work.
- **Contracts locked early:** Uint32 framebuffer, delta-time, per-axis collision, and classic-script/procedural-asset rules are all established in Phases 1-3 where retrofitting would be most expensive.

### Research Flags

Phases likely needing deeper research during planning (`--research-phase`):
- **Phase 3 (Core Renderer):** the perpendicular-distance/DDA/texture-stepping and row-based floor math carry the project's main correctness+perf risk; allocate spike/verification budget.
- **Phase 4 (Sprites):** camera-space projection, occlusion, and transparency edge cases warrant a focused pass.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Scaffold):** contracts are already decided; pure setup.
- **Phase 2 (Player/Input):** well-documented movement/collision/pointer-lock patterns.
- **Phase 5 (AI/Weapons):** conventional state machine + DDA reuse.
- **Phase 6 (HUD/Audio/State):** standard game-loop and Web Audio work.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All native Baseline browser APIs verified against MDN + Chromium sources; prescriptive with few real alternatives |
| Features | HIGH | 30+ years of documented raycaster clones; AI verified against DoomWiki; scope well-bounded |
| Architecture | HIGH | Canonical, textbook-stable technique cross-checked against Lode Vandevenne + multiple independent engines |
| Pitfalls | HIGH | Stable, well-documented failure modes with known fixes; browser gesture/autoplay behavior verified current |

**Overall confidence:** HIGH

### Gaps to Address

- **Internal resolution choice** (320x200 vs 480x270/640x360): a tunable, not a hard decision — set in `config.js` and adjust if fps dips; lowering resolution is the first perf lever.
- **Textured vs flat-color floors/ceilings:** treat textured floors as a tunable behind a flag; keep the flat-color fallback shippable if the row-caster underperforms on target hardware.
- **Delta-time model** (clamped variable vs fixed-timestep accumulator): clamped variable dt is sufficient for a one-shot; keep the accumulator as a documented fallback if tunneling/nondeterminism appears.
- **Enemy count ceiling:** naive implementation is fine at <=~20 enemies; if variety phases push counts up, add distance^2-based culling before per-frame sprite processing.

## Sources

### Primary (HIGH confidence)
- Lode Vandevenne — Raycasting tutorial I-III (lodev.org/cgtutor) — canonical camera-plane math, DDA wall casting, perpendicular distance, texture coordinate flipping/stepping, row-based floor/ceiling, sprite 1D z-buffer + back-to-front sort
- MDN — Pointer Lock API, `AudioContext.resume()` / autoplay policy, Canvas `ImageData`/`putImageData` semantics, `requestAnimationFrame`, `imageSmoothingEnabled`, Crisp pixel art (`image-rendering`)
- Chromium blink-dev — Pointer Lock unadjusted movement intent-to-ship
- DoomWiki — Monster behavior (Look/See/Melee/Missile/Pain/Death state machine, LOS waking)
- WHATWG — confirmation `putImageData` ignores the CTM and cannot scale

### Secondary (MEDIUM confidence)
- Wikipedia — Z-buffering (1D vs 2D depth test)
- The AI of DOOM (1993) — Game Developer; Coconote enemy-AI summary — narrative confirmation of AI flow
- nielssp.dk raycasting notes; untrustedlife.com custom JS raycasting engine — independent modern JS cross-checks
- FPS weapon-feel conventions (sinusoidal bob hooked to velocity, muzzle-flash overlay) corroborated across tutorial sources

### Tertiary (LOW confidence)
- (None) — the domain is stable enough that no findings rest on single unverified sources

---
*Research completed: 2026-07-23*
*Ready for roadmap: yes*
