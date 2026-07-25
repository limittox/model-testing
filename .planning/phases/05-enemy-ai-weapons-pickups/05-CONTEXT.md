# Phase 5: Enemy AI, Weapons & Pickups - Context

**Gathered:** 2026-07-25
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss) — grey areas resolved at Claude's discretion. This is the biggest phase (16 requirements); decisions are locked so the 4 plans stay coherent.

<domain>
## Phase Boundary

The core combat loop works — enemies hunt and attack the player, weapons deal hitscan damage, and pickups are collectible across a populated level.

**In scope:** enemy AI state machine (idle/chase/attack/pain/death) with LOS + wall collision; player weapons (pistol + shotgun) with hitscan, ammo, viewmodel bob + muzzle flash, switching; enemies taking damage, hit reaction, death animation + corpse, kill count; pickups (health/armor/ammo/shotgun) collection + effects; and populating the level with enemies + pickups at the designed spawn positions.
**Out of scope:** the HUD readouts / crosshair / minimap / on-screen message RENDERING, synthesized audio, and the title/victory/death screens — all Phase 6. This phase implements the game LOGIC and a weapon viewmodel; Phase 6 draws the HUD and adds sound. Where a requirement here needs a message or a sound (e.g. PICK-05), Phase 5 fires an EVENT (a `Game.message(text)` queue entry) and calls a `Sound.play(name)` HOOK — Phase 6 renders the queue and synthesizes the audio. A minimal in-framebuffer message line is acceptable so PICK-05 is observable now.

**Requirements covered:** ENEM-01..05, WEAP-01..05, PICK-01..05, LVL-02.
**All code under `Doom/Claude Opus 4.8/GSD/`** (quote paths — spaces in folder name).
</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion (resolved)

1. **Entity model evolution.** Phase 4 `Entities.list` items are plain `{x,y,sprite,scale,onFloor}`. Phase 5 gives entities a `kind` (`'enemy'` | `'pickup'` | `'projectile'`) plus behavior fields, and an `active`/`alive` flag. The sprite pass (Phase 4) must: skip entities with `active===false` (collected pickups, despawned projectiles), and render an enemy's CURRENT animation frame as its `sprite`. Keep the list preallocated where possible; projectiles use a small preallocated pool (no per-frame allocation). Update logic lives in a new module (e.g. `js/enemies.js`, `js/weapons.js`, `js/pickups.js`) dispatched from `Game.update(dt)`.

2. **Enemy AI state machine (ENEM-01/02, lock the states).** States: `idle → chase → attack → (pain) → dead(anim) → corpse`.
   - `idle`: stand until `Level.lineOfSight(enemy, player)` is clear AND within sight range → `chase`.
   - `chase`: move toward the player at `ENEMY_SPEED*dt` using PER-AXIS wall collision (reuse/generalize Player's slide-collision so enemies can't walk through walls); stop closing at attack range. If LOS + within attack range + cooldown elapsed → `attack`.
   - `attack`: play the attack frame; at the attack point spawn a projectile toward the player (see 3); set cooldown; return to `chase`.
   - `pain`: entered only EXTERNALLY when damaged (chance-based, e.g. 30%); brief stagger on the pain frame, then resume `chase`. Pain can interrupt but is not entered on its own.
   - `dead`: play death frames once (multi-frame) → `corpse`: a static final frame, `alive=false`, non-colliding, not targetable by hitscan, still rendered (a floor decal).
   Animate walk with 2 frames; use `Level.lineOfSight` (already exists). Enemies do not collide with each other or push the player (they stop at attack range) — keep it simple and robust.

3. **Enemy attack = ranged projectile (fireball) (ENEM-03).** More Doom-like and dodgeable than pure hitscan, and it reuses the sprite/entity + z-buffer render for free. A projectile is an entity `{kind:'projectile', x,y, vx,vy, speed, damage, active}` spawned at the enemy toward the player. Each frame: advance; if `Level.isSolid` at the new cell → despawn; if within `~0.35` of the player → damage the player + despawn. Optional close-range melee bite if within `~1.2` cells (small instant damage) — acceptable but projectile is the primary attack. Fireball sprite + a small impact are new assets.

4. **Player combat state (lock this).** Add player combat fields (on `Player` or a small `Combat`/player-stats object — keep pose vs. stats readable): `health` (max 100, start 100), `armor` (0, max 100), `ammo {bullets: start 50, shells: 0}`, `weapon` (`'pistol'|'shotgun'`), `hasShotgun` (false until pickup). **Damage to player:** armor absorbs a fraction (Doom green-armor style ≈ 1/3): `absorbed = min(armor, floor(dmg/3)); armor -= absorbed; health -= (dmg - absorbed)`. `health <= 0` sets a dead flag (Phase 6 shows the death screen; Phase 5 just stops the player / flags it).

5. **Hitscan weapons (WEAP-01..05, lock this).** Two weapons switchable by key (`1`/`2`, optional wheel):
   - **Pistol:** 1 bullet/shot, a SINGLE accurate ray along `Player.dir` (tiny spread), damage ≈ 15, cooldown ≈ 0.35 s.
   - **Shotgun:** 1 shell/shot, ≈ 7 pellets each with random spread (≈ ±0.08 rad), damage ≈ 7 each, cooldown ≈ 0.8 s (needs `hasShotgun`).
   - **Hitscan resolution per ray:** find the nearest ALIVE enemy such that the perpendicular distance from the aim ray to the enemy center `< enemy radius (~0.35)`, the enemy is in front, `Level.lineOfSight(player, enemy)` is clear, the enemy distance `<` the wall distance along that ray (DDA wall-stop so you can't shoot through walls — WEAP-02), and within max range. Apply `enemy.hurt(dmg)`. Firing is gated by ammo; **empty → does not fire** (WEAP-05) (a click event/hook is fine).
   - **Viewmodel (WEAP-04):** draw the weapon viewmodel sprite into the framebuffer bottom-center each frame with a sinusoidal BOB whose amplitude scales with movement speed, a RECOIL kick on fire, and a MUZZLE FLASH overlay for ~0.06 s after firing. Pistol + shotgun viewmodels + a muzzle-flash are new assets. (Drawing into the framebuffer keeps Phase 5 self-contained; Phase 6 adds the rest of the HUD on `#hud`.)

6. **Enemy damage / death / kill count (ENEM-04/05).** `enemy.hurt(dmg)`: subtract health, chance → `pain`, and if `health <= 0` → `dead` (start death animation), increment `Game.kills` (out of `Game.totalKills` = enemy count). A blood-puff effect on hit is a nice touch (optional). Corpses remain rendered, not targetable.

7. **Pickups (PICK-01..05).** Pickup entity `{kind:'pickup', itemType:'health'|'armor'|'ammo'|'shotgun', active}`. Collection when the player is within `COLLECT_RADIUS (~0.5)` of an ACTIVE pickup: apply the effect, set `active=false` (removed from render), enqueue `Game.message(text)` and call `Sound.play(hook)`. Effects: **health** +25 (cap 100); **armor** → `min(100, armor+50)` (armor then absorbs per 4); **ammo** bullets +20; **shotgun** → `hasShotgun=true`, `shells += 8` (grant the weapon). Only collect what helps if you want Doom fidelity (e.g., skip full-health medkits) — optional; simplest is always collect.

8. **Populate the level (LVL-02).** Instantiate enemies at `Level.spawns` enemy markers and pickups at the item markers (health/armor/ammo/shotgun) — Phase 4 already placed static billboards from these; Phase 5 gives them behavior/type. `Game.totalKills` = number of enemies. The exit marker stays for Phase 6 (LVL-03/04).

9. **New procedural assets (extend `js/sprites.js`, same style, seeded).** Enemy animation frames: idle, walk1, walk2, attack, pain, death1, death2, death3, corpse. Plus fireball, pistol viewmodel, shotgun viewmodel, muzzle flash. Keep them recognizable and in the existing generated-art style; all deterministic from `mulberry32(CONFIG.SEED + salt)`. The Phase 4 sprite pass already handles alpha-keyed billboards; viewmodels are drawn separately bottom-center.

10. **Input additions.** Extend the intent-only Input: `fire` (mouse click / Ctrl / Space), `switch weapon` (`1`/`2`), maybe `use`. Handlers set intent only; `Game.update(dt)` reads and acts (cooldowns, ammo). No state mutation in handlers.

11. **Reuse, don't re-architect.** `CONFIG`, `Framebuffer` (buf32/zBuffer/present), `Level` (isSolid, lineOfSight, spawns, LANDMARKS), `Player` (pose + slide-collision helper — generalize it for enemies), `Sprites`/`Textures`, `Raycaster` (+ spritePass seam, shadeFactor/applyShade), `Entities`, `Game` loop (update/render, single putImageData), `Input`. New `<script>`s in dependency order before `js/main.js` per the load-order contract. All tuning numbers go in `CONFIG`.
</decisions>

<code_context>
## Existing Code Insights

Phases 1-4 shipped and verified (18/47 requirements). Key reusable pieces:
- `Entities.list` (from `Level.spawns`) + `Raycaster.spritePass` seam render billboards with z-buffer occlusion, back-to-front sort, alpha-key transparency, and depth fog. Phase 5 attaches behavior to these entities and picks the per-frame animation sprite; the sprite pass must skip inactive entities.
- `Level.lineOfSight(ax,ay,bx,by)` (grid DDA) is ready for enemy sight + hitscan wall-blocking. `Level.isSolid` for projectile/enemy wall collision.
- `Player` has a per-axis slide-collision routine (`canOccupyX/Y` / `moveBy`) — generalize it so enemies collide with walls too. `Player` pose is `{x,y,dirX,dirY,planeX,planeY}`.
- `Raycaster.shadeFactor`/`applyShade` for consistent fog on any drawn pixel (viewmodel can stay unfogged/bright).
- `Game.update(dt)` / `Game.render()` (single putImageData), clamped dt, `Game.input`/`Game.view` seams. `Input.readIntent()` is where to add fire/switch.
- rAF-throttle caveat for headless verification: drive a frame manually (`Game.view.render(0)` + `Framebuffer.present()`), and drive `Game.update(dt)` manually with a stepped scheduler (the `tools/boot.cjs` harness already supports a manual rAF + virtual clock) — that is how AI/projectile/cooldown logic gets tested headlessly.
</code_context>

<specifics>
## Specific Ideas

- The combat loop is the CORE VALUE ("fight sprite enemies, shoot weapons, manage health/ammo"). Prioritize a working end-to-end slice: one enemy that sees you, chases, attacks, and can be shot dead with the pistol — before generalizing to shotgun/pickups/all enemies.
- Make the load headlessly testable with the stepped scheduler: assert LOS gating (idle until seen), chase reduces distance, attack spawns a projectile on cooldown, hitscan kills after N pistol shots, ammo decrements and blocks at 0, shotgun spreads to multiple pellets, wall blocks a shot, pickup within radius applies its effect and deactivates, armor absorbs the right fraction, kill count increments on death.
- Verify from file:// and a static server. Watch: enemies walking through walls (collision), shooting through walls (LOS/DDA stop), projectiles tunneling (dt clamp), per-frame allocation in AI/projectile loops, and the classic "enemy attacks with no LOS" bug.
</specifics>

<deferred>
## Deferred Ideas

- HUD readouts (health/armor/ammo/weapon/kills), crosshair, on-screen message RENDERING, minimap, damage flash — Phase 6 (this phase fires the message events + a `Sound.play` hook).
- Synthesized audio for shooting/hits/pickups/enemy sounds/player damage — Phase 6.
- Title / victory (reach exit) / death (health 0) screens, LVL-03/04/05/06 — Phase 6.
- Enemy variety, directional sprites — v2 (out of scope).
</deferred>
