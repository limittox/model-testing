# DOOM Clone (Browser)

## What This Is

A playable, browser-based clone of the classic FPS *Doom* — a "2.5D" raycasting
shooter that runs entirely client-side in a web browser with no build step and no
external asset downloads. It is one of several one-shot model-generation entries in
this model-testing repository; this particular entry is authored by **Claude Opus 4.8**
using the **GSD** workflow, and all of its code lives under `Doom/Claude Opus 4.8/GSD/`.

## Core Value

**You can open it in a browser and immediately play a fun, recognizably-Doom
first-person shooter** — move through a level, fight sprite enemies, shoot weapons,
manage health/ammo, and win or die. If everything else is cut, that end-to-end
playable loop must work.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Raycasting 3D renderer with textured walls, floors, and ceilings + distance shading
- [ ] Smooth first-person movement (WASD + strafe + run) with mouse-look (pointer lock) and keyboard turning
- [ ] Wall collision so the player cannot pass through geometry
- [ ] Sprite-based enemies with billboarded rendering, depth sorting, and z-buffer occlusion against walls
- [ ] Enemy AI: idle → chase (with line-of-sight) → ranged attack, plus taking damage and dying with an animation
- [ ] Player weapons with hitscan fire (at least a pistol and a shotgun), muzzle flash, weapon bob, and ammo cost
- [ ] Pickups: health, armor, ammo, and a shotgun weapon pickup
- [ ] HUD: health, armor, ammo, current weapon, kill count, crosshair, on-screen messages, and a minimap
- [ ] A designed level with rooms/corridors, enemy spawns, pickups, and a reachable exit
- [ ] Win condition (reach the exit) and lose condition (health depleted) with title / victory / death screens
- [ ] Synthesized sound effects (Web Audio) for shooting, hits, pickups, enemy attacks, and player damage
- [ ] Runs self-contained: procedural textures/sprites + synthesized audio, no external files or network requests

### Out of Scope

- True Doom BSP renderer with variable floor/ceiling heights — a raycaster delivers the feel at far less complexity for a one-shot build
- Multiplayer / networking — single-player only; out of scope for a browser one-shot
- Loading original Doom WAD assets — legally and practically avoided; all art/audio is generated procedurally
- Level editor / multiple episodes — one solid hand-crafted level is the target for v1
- Mobile touch controls — desktop keyboard + mouse is the primary target

## Context

- **Repository purpose:** This repo exists to test what different large language models
  produce for the same one-shot prompt. Each model's output is isolated in its own
  folder so multiple entries can coexist. This entry: `Doom/Claude Opus 4.8/GSD/`.
- **Prompt framing:** The user asked for a from-scratch, finish-to-completion browser Doom
  clone, leaving all implementation details to the author, with an explicit instruction
  not to ask clarifying questions — hence recommended defaults are chosen autonomously.
- **Technical approach:** Classic Wolfenstein/Doom-style raycasting is the proven path to
  a browser FPS: a DDA ray march per screen column for walls, row-based floor/ceiling
  casting, and billboarded sprite projection with a per-column depth buffer. Rendering
  targets a low internal resolution scaled up with `image-rendering: pixelated` for both
  performance and the authentic retro look.
- **Self-containment:** To guarantee it "just runs," there are no external dependencies.
  Textures and enemy/weapon sprites are drawn procedurally to canvases at load time, and
  all sound effects are synthesized with the Web Audio API. Scripts are classic (non-module)
  so the game also works when opened directly via `file://`.

## Constraints

- **Location**: All code for this entry MUST live under `Doom/Claude Opus 4.8/GSD/` — [keeps model entries isolated in the shared model-testing repo]
- **Tech stack**: Vanilla HTML5 + CSS + JavaScript, Canvas 2D `ImageData` for the software raycaster, Web Audio API for sound — [zero dependencies, no build step, runs by opening a file]
- **No external assets**: Textures, sprites, and audio are generated at runtime — [self-contained, avoids network/CSP/asset-licensing issues]
- **Compatibility**: Must run in a current desktop browser (Chrome/Edge/Firefox) and load from `file://` as well as a static server — [use classic scripts, not ES modules]
- **Performance**: Maintain a smooth frame rate (~60fps target) via a fixed low internal render resolution and typed-array pixel buffers — [software rendering must stay real-time]
- **Autonomy**: Built one-shot without clarifying questions; recommended GSD options chosen by the author — [per the user's explicit instruction]

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Raycasting engine (not a true BSP/Doom renderer) | Delivers the Doom feel with tractable, one-shot-achievable complexity | — Pending |
| Procedural textures/sprites + synthesized audio | Guarantees a self-contained game with no external files | — Pending |
| Classic (non-module) scripts, low internal resolution scaled up | Works from `file://` and keeps software rendering real-time with a retro look | — Pending |
| Hitscan weapons + billboarded sprite enemies with z-buffer occlusion | Standard, robust techniques for a raycaster FPS | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-23 after initialization*
