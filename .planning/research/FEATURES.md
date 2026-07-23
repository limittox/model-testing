# Feature Research

**Domain:** Browser-based Doom-style FPS (single-level, one-shot software raycaster)
**Researched:** 2026-07-23
**Confidence:** HIGH

This is a mature, exhaustively-documented domain (Wolfenstein 3D 1992, Doom 1993, and 30+ years
of hobbyist raycaster clones + Lode Vandevenne's canonical tutorial). The feature set that reads
as "Doom" is well settled; the design work is drawing the line between authentic-feel table stakes,
polish that elevates the build, and complexity traps that a software raycaster should refuse.

## Feature Landscape

### Table Stakes (Users Expect These)

Without these the build does not read as "Doom." Users penalize their absence immediately.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Textured raycast walls + floor/ceiling + distance shading | The defining visual of the genre; flat-shaded walls read as "unfinished tech demo" | HIGH | DDA ray march per screen column for walls; row-based floor/ceiling cast. Distance fog/shading (darker with depth) is what sells "Doom" over "Wolfenstein." Write to a typed-array `ImageData` buffer. |
| First-person movement: WASD + strafe + run | Core locomotion; players muscle-memory this instantly | LOW | Forward/back + strafe left/right; hold-to-run modifier. Movement in world units per second, frame-rate independent (delta time). |
| Mouse-look via Pointer Lock + keyboard turn fallback | Modern players expect mouselook; arrow/Q-E turn is the authentic 1993 fallback | MEDIUM | Yaw only (no pitch needed — raycaster has no true vertical look). Pointer Lock API; handle lock loss/regain gracefully. |
| Wall collision | Walking through walls breaks the illusion entirely | LOW | Circle-vs-grid collision against the map array; check X and Y axes separately so the player slides along walls instead of sticking. |
| Sprite enemies: billboarded, depth-sorted, z-buffer occluded | Enemies are the game; they must correctly hide behind walls | HIGH | Per-column depth buffer from the wall pass; sort sprites far-to-near; project sprite width/height by distance. Occlusion against the z-buffer is the make-or-break correctness detail. |
| Enemy AI: idle -> sight -> chase -> attack -> pain -> death | "Doom" enemies wake on line-of-sight, pursue, and shoot back | MEDIUM | State machine (see Expected Behaviors below). Line-of-sight via a ray/grid walk to the player. Chase = step toward player with basic obstacle handling. |
| Hitscan weapons with ammo cost | Instant-hit pistol/shotgun is the Doom firing model | MEDIUM | Cast a ray from player along facing (plus spread for shotgun); first enemy hit takes damage. Decrement ammo; block fire at zero. |
| Weapon feel: view-model + bob + muzzle flash | A static gun sprite feels dead; bob + flash is the minimum "juice" | MEDIUM | Sinusoidal bob hooked to movement speed; muzzle flash = 1-2 frame overlay + brief screen/light flash; fire animation frames. |
| HUD: health, ammo, current weapon, crosshair | Players must read their survival state at a glance | LOW | Bottom status bar (classic) or corner readouts. Crosshair centered. Numeric health/ammo. |
| Pickups: health + ammo (at minimum) | Resource loop is the core tension; nothing to pick up = no gameplay arc | LOW | Billboarded pickup sprites; proximity trigger; clamp health/ammo to max; remove sprite + play sound + HUD message. |
| Win + lose conditions with screens | A game without an end state is a tech demo | LOW | Win = touch exit tile/trigger. Lose = health <= 0. Title / victory / death screens gate the play loop. |
| Synthesized SFX: shoot, hit, pickup, enemy attack, player pain | Silence reads as broken; audio is half of "feel" | MEDIUM | Web Audio API oscillators/noise bursts + envelopes. No external files. Gate on a user gesture (browsers block autoplay audio). |
| Designed level: rooms, corridors, spawns, reachable exit | One hand-crafted level is the whole game here | MEDIUM | 2D grid map. Must be verified traversable start->exit with combat pacing and pickup placement. |
| Self-contained assets (procedural textures/sprites + synth audio) | Project constraint: must run from `file://` with zero downloads | MEDIUM | Draw textures/sprites to offscreen canvases at load; classic (non-module) scripts so `file://` works. |

### Differentiators (Polish That Elevates It)

Not required to read as Doom, but each meaningfully raises perceived quality. Aligns with PROJECT.md's stated Active requirements.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Multiple weapons + weapon switching | Pistol -> shotgun progression is the classic power fantasy; drives the shotgun pickup | MEDIUM | Number keys / scroll to switch; per-weapon damage, spread, fire rate, ammo type, view-model. Shotgun = multi-ray spread + punchy sound. Depends on hitscan + view-model. |
| Armor + armor pickups | Adds a second defensive resource and a second pickup type; deepens the survival loop | LOW | Armor absorbs a fraction of incoming damage before health. Cheap once health/damage exists. |
| Minimap | Aids navigation of the level and looks authentically HUD-like | MEDIUM | Top-down grid render of walls + player facing + optionally enemies. Purely additive overlay. |
| Screen effects: damage flash, pickup flash, muzzle light | Full-screen color tints on hurt/pickup are strong, cheap feedback | LOW | Tint the frame red on damage, green/white on pickup. A few lines once the frame buffer exists. |
| Enemy variety (2-3 types) | Different speeds/damage/health create tactical texture instead of one repeated foe | MEDIUM | Reuse the AI state machine with per-type stats + sprites (e.g. slow melee brute vs. fast ranged shooter). Depends on enemy AI + sprite system. |
| Kill counter / on-screen messages | "Picked up shotgun", kill tally — small readability + goal-feedback wins | LOW | Transient text queue in the HUD. Trivial once HUD exists. |
| Enemy death animation + corpse sprite | A multi-frame death sells impact far more than an instant despawn | LOW-MEDIUM | Play death frames, then leave a static corpse sprite (still z-buffered). Depends on sprite + AI death state. |
| Weapon recoil / kick | Extra firing juice beyond muzzle flash | LOW | Brief downward/back view-model offset on fire, eased back. Additive to weapon bob. |
| Pixelated low-res upscale (`image-rendering: pixelated`) | Cheap authentic retro look AND the performance strategy | LOW | Render at low internal resolution, CSS-scale up. Doubles as the frame-rate budget. |

### Anti-Features (Deliberately NOT Built for a One-Shot Raycaster)

Each looks appealing but breaks the raycaster's core assumptions or blows the one-shot budget. Documented to prevent scope creep.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Variable floor/ceiling heights (rooms above rooms, stairs, lifts) | "Real Doom has them" | Breaks the raycaster's single-height assumption; requires a BSP/portal renderer or sector-based engine — an order-of-magnitude more work, unachievable one-shot | Single floor height; imply depth with lighting + level layout. Explicitly out of scope per PROJECT.md. |
| Vertical look (pitch) / jumping / crouching | Feels "modern" | A column raycaster has no true vertical dimension; pitch requires y-shearing hacks that look wrong, jumping needs a z-axis the engine lacks | Yaw-only mouselook, flat movement. This is authentic to 1993 Doom, not a compromise. |
| Multiplayer / networking | "Deathmatch was iconic" | Netcode, state sync, matchmaking, and a server dwarf the entire game's budget | Single-player only. Non-negotiable for a browser one-shot. |
| WAD loading / original Doom assets | "Use the real art" | Legal (id/ZeniMax IP) and practical (parser + external files break `file://` self-containment) | Procedural textures/sprites + synthesized audio. Also dodges CSP/asset-licensing issues. |
| Level editor / multiple episodes | "More content" | Editor UI + level format + serialization is a project unto itself; padding levels adds no validation value | One hand-crafted level defined as a code-side grid. |
| Save/load game state | "Standard for games" | Serialization + slot UI for a single 5-minute level nobody replays across sessions | Restart-on-death. Level is short enough that persistence is pointless. |
| Physics-simulated projectiles for all weapons | "More realistic ballistics" | Per-bullet entities + collision integration cost frames in a software renderer for no felt benefit on a hitscan-native genre | Hitscan for pistol/shotgun. A single slow visible projectile (e.g. an enemy fireball) is fine if desired, but not the default model. |
| Mobile / touch controls | "Reach more players" | Virtual joysticks + on-screen fire are a second control scheme to design and tune; desktop is the stated target | Desktop keyboard + mouse only. Out of scope per PROJECT.md. |
| Full lighting engine (dynamic lights, shadows, sector light diffusion) | "Looks better" | Real-time lighting in a CPU software renderer is a frame-rate killer | Static distance shading + occasional full-screen flash. Reads as atmospheric for free. |

## Feature Dependencies

```
Raycast wall renderer (+ per-column z-buffer)
    |
    +--requires--> Map grid (2D array)
    |
    +--enables---> Sprite rendering (billboard + depth sort + z-buffer occlusion)
                       |
                       +--enables--> Enemy AI (sight/chase/attack/pain/death)
                       |                  |
                       |                  +--requires--> Line-of-sight ray walk
                       |
                       +--enables--> Pickups (health / armor / ammo / weapon)
                       |
                       +--enables--> Enemy variety (per-type stats + sprites)

Player movement (WASD/strafe/run)
    |
    +--requires--> Wall collision (needs map grid)
    +--enhanced-by--> Mouse-look (Pointer Lock)
    +--drives--> Weapon bob (bob amplitude from move speed)

Hitscan fire (ray + damage)
    |
    +--requires--> Enemy AI (targets with health)
    +--requires--> Ammo model
    +--enables--> Multiple weapons + weapon switching
    +--enhanced-by--> Muzzle flash / recoil / view-model

HUD  --requires--> health / armor / ammo / weapon / kill state
Minimap  --requires--> Map grid + player pose (+ optional enemy positions)
Screen effects  --requires--> Frame buffer (damage flash on player-pain event)
Win/Lose  --requires--> Exit trigger (map) + health depletion (combat)
Audio  --requires--> User-gesture unlock (browser autoplay policy)
```

### Dependency Notes

- **Sprites require the wall pass's z-buffer:** enemies/pickups can only occlude correctly if the wall renderer has already written per-column depth. Build walls-with-depth-buffer before any sprite work.
- **Enemy AI requires line-of-sight:** the "wake on sight then chase" behavior needs a ray/grid walk from enemy to player; this is a distinct subsystem from wall casting though it reuses the grid.
- **Hitscan requires enemies with health before it is meaningful:** shooting into an empty level validates nothing; sequence enemy entities + damage model alongside firing.
- **Multiple weapons depend on the view-model + hitscan foundation:** switching is cheap only once one weapon (view-model, fire, ammo, flash) fully works. Build one weapon end-to-end first.
- **Audio depends on a user gesture:** browsers block `AudioContext` until interaction — resume/unlock it on the title-screen click, or all SFX silently fail.
- **Screen effects depend on the frame buffer existing:** damage/pickup tints are a post-pass over `ImageData`, so they slot in only after rendering is in place (but are then near-free).

## Expected Behaviors (Genre Conventions)

These are the specific behaviors players unconsciously expect; getting them subtly wrong reads as "off."

**Mouse-look:** Pointer Lock captures the cursor; horizontal mouse delta rotates yaw only. Sensitivity tunable. Losing lock (Esc / tab-out) pauses or stops input cleanly; clicking the canvas re-locks. Keyboard turn (arrows or Q/E) is the always-available fallback.

**Weapon feel:** View-model sprite anchored bottom-center. Bob = sinusoidal X/Y offset scaled by movement speed (still when standing). On fire: swap to a fire frame, emit a 1-2 frame muzzle flash overlay + brief light/screen flash, optional short recoil kick, play the shot SFX, decrement ammo, apply hitscan. Fire rate gated by a cooldown. Empty = click/no-fire feedback, not a crash.

**Enemy AI state machine (verified against DoomWiki monster behavior):**
- **Idle/Look:** stationary (or idle anim) until it gains line-of-sight to the player (Doom also wakes on sound; sight alone is sufficient here).
- **Chase/See:** move toward the player each tick, re-checking LOS; step around/along walls rather than clipping through them.
- **Attack (Missile/Melee):** when in range with LOS, fire a hitscan/projectile at the player (ranged) or deal contact damage (melee), then return to Chase. Attacks are on a cooldown, not every frame.
- **Pain:** entered only when damaged — brief flinch frame + pain SFX, chance-based so heavy fire staggers the enemy. Optionally interrupts the current action.
- **Death:** at health <= 0, play a multi-frame death animation + death SFX, stop AI, then leave a corpse sprite (still z-buffered) or despawn. Increment the kill counter.

**Pickups:** billboarded item sprites in the world; walking within a small radius auto-collects (no interact key). Health/armor/ammo clamp to their max (and can be refused if already full, per Doom); weapon pickups grant the weapon + some ammo and may auto-switch. Collection plays a sound, shows a HUD message, and removes the sprite.

**Level exit:** a marked exit tile or switch; touching/activating it triggers the victory screen and ends the level. Should be clearly reachable and, ideally, gated behind traversing the combat so winning feels earned.

## MVP Definition

### Launch With (v1) — the end-to-end playable loop from PROJECT.md Core Value

- [ ] Textured raycast renderer (walls + floor/ceiling + distance shading) with per-column z-buffer — the genre-defining visual
- [ ] Movement (WASD/strafe/run) + mouse-look + wall collision — core locomotion
- [ ] Billboarded, depth-sorted, z-buffer-occluded sprite enemies — enemies are the game
- [ ] Enemy AI: idle -> sight -> chase -> attack -> pain -> death — makes enemies threats
- [ ] At least pistol + shotgun hitscan with bob + muzzle flash + ammo — the shooting
- [ ] Pickups: health + ammo (+ armor + shotgun) — the resource loop
- [ ] HUD: health/armor/ammo/weapon/crosshair/kills/messages + minimap — readable state
- [ ] One designed, traversable level with a reachable exit — the content
- [ ] Win (reach exit) + lose (health depleted) + title/victory/death screens — the arc
- [ ] Synthesized SFX for shoot/hit/pickup/enemy-attack/player-pain — the feel
- [ ] Fully self-contained (procedural art + synth audio, classic scripts, runs from `file://`) — the constraint

### Add After Validation (v1.x) — only if the core loop is solid and budget remains

- [ ] Third enemy type — trigger: two-enemy combat proves the AI + variety framework
- [ ] Additional weapon (e.g. chaingun) — trigger: two-weapon switching feels good
- [ ] Richer screen effects (screen shake, palette flashes) — trigger: base feedback is in
- [ ] Ambient/atmosphere audio — trigger: SFX layer is complete

### Future Consideration (v2+) — deliberately deferred

- [ ] Second level — deferred: one polished level is the v1 target; more is content padding
- [ ] Doors/switches/keys — deferred: adds interaction systems beyond the core loop
- [ ] Difficulty settings — deferred: tune one good difficulty first

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Raycast textured renderer + z-buffer | HIGH | HIGH | P1 |
| Movement + collision + mouse-look | HIGH | MEDIUM | P1 |
| Sprite enemies (billboard/depth/occlude) | HIGH | HIGH | P1 |
| Enemy AI state machine | HIGH | MEDIUM | P1 |
| Hitscan pistol + shotgun + ammo | HIGH | MEDIUM | P1 |
| Weapon bob + muzzle flash | MEDIUM | LOW | P1 |
| Health/ammo pickups | HIGH | LOW | P1 |
| HUD (health/ammo/weapon/crosshair) | HIGH | LOW | P1 |
| Win/lose + screens | HIGH | LOW | P1 |
| Synthesized SFX | MEDIUM | MEDIUM | P1 |
| Designed level + exit | HIGH | MEDIUM | P1 |
| Weapon switching (multi-weapon) | MEDIUM | MEDIUM | P2 |
| Armor + armor pickup | MEDIUM | LOW | P2 |
| Minimap | MEDIUM | MEDIUM | P2 |
| Screen damage/pickup flash | MEDIUM | LOW | P2 |
| Enemy variety (2-3 types) | MEDIUM | MEDIUM | P2 |
| Kill counter + HUD messages | LOW | LOW | P2 |
| Enemy death animation + corpse | MEDIUM | LOW | P2 |
| Weapon recoil kick | LOW | LOW | P3 |
| Third+ weapon / enemy | LOW | MEDIUM | P3 |

**Priority key:** P1 = must have for launch · P2 = should have, add when possible · P3 = nice to have, future

## Competitor Feature Analysis

| Feature | Wolfenstein 3D (1992) | Doom (1993) | Our Approach |
|---------|-----------------------|-------------|--------------|
| Renderer | Flat-height raycaster | BSP, variable heights, non-orthogonal walls | Raycaster (Wolf-style geometry) + Doom-style distance shading & atmosphere |
| Floor/ceiling | Solid color | Textured, variable height | Textured, single height (no variable heights) |
| Walls | Grid-aligned textured | Arbitrary-angle textured | Grid-aligned textured (raycaster constraint) |
| Enemies | Billboard sprites, simple AI | Billboard sprites, sight/chase/attack/pain/death | Doom-style state machine on billboard sprites |
| Weapons | Knife/pistol/MG/chaingun, hitscan | Hitscan + projectiles, 8 weapons | Hitscan pistol + shotgun (multi-weapon as P2) |
| Vertical | None | None (no free look/jump) | None — authentic, matches raycaster |
| Look control | Keyboard turn | Keyboard turn (mouselook added by ports) | Mouse-look (Pointer Lock) + keyboard fallback |
| Assets | Fixed art/audio | WAD-based art/audio | Procedural art + synthesized audio (self-contained) |

## Sources

- [Monster behavior — DoomWiki.org](https://doomwiki.org/wiki/Monster_behavior) — authoritative enemy AI state machine (Look/See/Melee/Missile/Pain/Death), LOS-based waking, `A_Chase`/`P_LookForPlayers`. Curated, HIGH confidence.
- [The AI of DOOM (1993) — Game Developer](https://www.gamedeveloper.com/blogs/the-ai-of-doom-1993) — narrative confirmation of sight/chase/attack behavioral flow.
- [Doom's Enemy AI and Behavior — Coconote](https://coconote.app/notes/d36285be-4acf-432b-9ece-8e91dbba0b33) — supporting summary of pain/death/see states.
- Weapon-feel conventions (sinusoidal bob hooked to velocity, muzzle-flash overlay) corroborated across FPS tutorial sources; cross-checked against genre knowledge. MEDIUM-HIGH confidence.
- Domain knowledge: Wolfenstein 3D / Doom architecture and the canonical raycasting technique (DDA wall casting, billboard sprites, per-column depth buffer). Stable, well-documented, HIGH confidence.

---
*Feature research for: browser-based Doom-style FPS (single-level software raycaster)*
*Researched: 2026-07-23*
