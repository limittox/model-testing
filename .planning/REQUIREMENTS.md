# Requirements: DOOM Clone (Browser)

**Defined:** 2026-07-23
**Core Value:** You can open it in a browser and immediately play a fun, recognizably-Doom first-person shooter — move, fight, shoot, manage health/ammo, and win or die.

## v1 Requirements

Requirements for the initial playable release. Each maps to a roadmap phase.
All code lives under `Doom/Claude Opus 4.8/GSD/`.

### Platform

- [x] **PLAT-01**: Game runs in a current desktop browser with no build step and no npm install
- [x] **PLAT-02**: Game loads and plays from `file://` (double-click `index.html`) as well as from a static server
- [x] **PLAT-03**: Game is fully self-contained — no network requests, no external textures, sprites, fonts, or audio files
- [x] **PLAT-04**: Game loop uses `requestAnimationFrame` with a clamped delta-time so motion is frame-rate independent and survives tab refocus

### Rendering

- [ ] **REND-01**: Walls are drawn with a DDA raycaster using perpendicular wall distance (no fisheye distortion)
- [ ] **REND-02**: Walls are textured, with the correct texture column sampled per screen column
- [ ] **REND-03**: Floors and ceilings are cast and shaded (textured, with a flat-color fallback path if needed)
- [ ] **REND-04**: Distance-based shading/fog darkens surfaces with depth for atmosphere
- [x] **REND-05**: The world renders into a fixed low-resolution Uint32 framebuffer that is CSS-upscaled with pixelated scaling for the retro look and real-time performance
- [ ] **REND-06**: A per-column depth (z) buffer is produced by the wall pass for later sprite occlusion

### Controls

- [x] **CTRL-01**: Player moves forward/back and strafes left/right (WASD) with a run modifier
- [ ] **CTRL-02**: Player turns via mouse-look using the Pointer Lock API
- [ ] **CTRL-03**: Player can also turn with the keyboard (arrow keys) as a fallback when pointer lock is unavailable
- [x] **CTRL-04**: Player collides with walls and cannot pass through geometry (no tunneling at high speed)

### Entities

- [ ] **ENT-01**: Enemies and pickups render as billboarded sprites that always face the camera
- [ ] **ENT-02**: Sprites are depth-sorted back-to-front and occluded correctly against walls via the z-buffer
- [ ] **ENT-03**: Sprites use transparent pixels (alpha/color-key) with no halo artifacts

### Enemies

- [ ] **ENEM-01**: Enemies follow an AI state machine: idle → chase (on line-of-sight) → attack, on an attack cooldown
- [ ] **ENEM-02**: Enemies move toward the player when they have line of sight, respecting wall collision
- [ ] **ENEM-03**: Enemies attack the player (ranged projectile or melee) and reduce player health
- [ ] **ENEM-04**: Enemies take damage from the player, show a hit reaction, and die with a multi-frame death animation leaving a corpse
- [ ] **ENEM-05**: A kill count tracks enemies defeated out of the total

### Weapons

- [ ] **WEAP-01**: Player has at least two weapons — a pistol and a shotgun — switchable by key
- [ ] **WEAP-02**: Firing is hitscan: it damages the nearest enemy along the aim line if not blocked by a wall
- [ ] **WEAP-03**: The shotgun fires a multi-pellet spread; the pistol fires a single accurate shot
- [ ] **WEAP-04**: Weapons show a viewmodel with movement bob, a firing/recoil animation, and a muzzle flash
- [ ] **WEAP-05**: Firing consumes ammo and is blocked when ammo is empty

### Pickups

- [ ] **PICK-01**: Health pickups restore player health up to the maximum
- [ ] **PICK-02**: Armor pickups grant armor that absorbs a portion of incoming damage
- [ ] **PICK-03**: Ammo pickups replenish weapon ammunition
- [ ] **PICK-04**: A shotgun pickup grants the shotgun weapon (and shells)
- [ ] **PICK-05**: Walking over a pickup collects it, shows an on-screen message, and plays a sound

### HUD

- [ ] **HUD-01**: HUD displays current health, armor, and ammo
- [ ] **HUD-02**: HUD displays the current weapon and the kill count
- [ ] **HUD-03**: A crosshair is drawn at screen center
- [ ] **HUD-04**: On-screen messages appear for pickups/events and fade out
- [ ] **HUD-05**: A minimap shows the level layout, the player, and nearby entities
- [ ] **HUD-06**: A red damage flash overlays the screen when the player takes damage

### Level & Progression

- [x] **LVL-01**: A hand-designed grid level with rooms, corridors, and multiple wall/texture types
- [ ] **LVL-02**: The level is populated with enemy spawns and pickups at designed positions
- [ ] **LVL-03**: The level has a reachable, visibly-marked exit
- [ ] **LVL-04**: Reaching the exit triggers a victory state showing stats (kills, time)
- [ ] **LVL-05**: Player health reaching zero triggers a death state with a restart option
- [ ] **LVL-06**: A title/start screen shows controls and is the single user gesture that starts play, unlocks pointer lock, and resumes audio

### Audio

- [ ] **AUD-01**: All sound effects are synthesized at runtime with the Web Audio API (no audio files)
- [ ] **AUD-02**: Distinct SFX play for pistol fire, shotgun fire, enemy attack, enemy death, pickup, and player damage
- [ ] **AUD-03**: The AudioContext is created/resumed on the start-screen gesture so audio is not blocked by autoplay policy

## v2 Requirements

Deferred to a future release. Tracked but not in the current roadmap.

### Enemy Variety

- **EVAR-01**: More than one enemy type with distinct behavior/stats
- **EVAR-02**: Directional (8-angle) enemy sprites that show the side you view them from

### Presentation

- **PRES-01**: Fullscreen palette/damage screen effects beyond the basic damage flash
- **PRES-02**: Additional levels / an episode structure
- **PRES-03**: Animated sliding doors (v1 uses open doorways / simple openable doors)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| True BSP renderer with variable floor/ceiling heights, verticality, jumping | Breaks the raycaster's single-height assumption; order-of-magnitude more work for a one-shot build |
| Loading original Doom WAD assets | Licensing + practicality; all art/audio is generated procedurally |
| Multiplayer / networking | Single-player browser one-shot; out of scope |
| Level editor | One hand-crafted level is the v1 target |
| Mobile touch controls | Desktop keyboard + mouse is the primary target |
| Save/load | Single-session arcade loop; not needed for v1 |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PLAT-01 | Phase 1 | Complete |
| PLAT-02 | Phase 1 | Complete |
| PLAT-03 | Phase 1 | Complete |
| REND-05 | Phase 1 | Complete |
| PLAT-04 | Phase 2 | Complete |
| CTRL-01 | Phase 2 | Complete |
| CTRL-02 | Phase 2 | Pending |
| CTRL-03 | Phase 2 | Pending |
| CTRL-04 | Phase 2 | Complete |
| LVL-01 | Phase 2 | Complete |
| REND-01 | Phase 3 | Pending |
| REND-02 | Phase 3 | Pending |
| REND-03 | Phase 3 | Pending |
| REND-04 | Phase 3 | Pending |
| REND-06 | Phase 3 | Pending |
| ENT-01 | Phase 4 | Pending |
| ENT-02 | Phase 4 | Pending |
| ENT-03 | Phase 4 | Pending |
| ENEM-01 | Phase 5 | Pending |
| ENEM-02 | Phase 5 | Pending |
| ENEM-03 | Phase 5 | Pending |
| ENEM-04 | Phase 5 | Pending |
| ENEM-05 | Phase 5 | Pending |
| WEAP-01 | Phase 5 | Pending |
| WEAP-02 | Phase 5 | Pending |
| WEAP-03 | Phase 5 | Pending |
| WEAP-04 | Phase 5 | Pending |
| WEAP-05 | Phase 5 | Pending |
| PICK-01 | Phase 5 | Pending |
| PICK-02 | Phase 5 | Pending |
| PICK-03 | Phase 5 | Pending |
| PICK-04 | Phase 5 | Pending |
| PICK-05 | Phase 5 | Pending |
| LVL-02 | Phase 5 | Pending |
| HUD-01 | Phase 6 | Pending |
| HUD-02 | Phase 6 | Pending |
| HUD-03 | Phase 6 | Pending |
| HUD-04 | Phase 6 | Pending |
| HUD-05 | Phase 6 | Pending |
| HUD-06 | Phase 6 | Pending |
| AUD-01 | Phase 6 | Pending |
| AUD-02 | Phase 6 | Pending |
| AUD-03 | Phase 6 | Pending |
| LVL-03 | Phase 6 | Pending |
| LVL-04 | Phase 6 | Pending |
| LVL-05 | Phase 6 | Pending |
| LVL-06 | Phase 6 | Pending |

**Coverage:**

- v1 requirements: 47 total (prior "41" footer was a miscount; corrected during roadmap creation)
- Mapped to phases: 47 ✓
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-23*
*Last updated: 2026-07-23 after roadmap creation (traceability populated, count corrected 41 → 47)*
