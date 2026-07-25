# Phase 6: HUD, Audio & Game-State Machine - Context

**Gathered:** 2026-07-25
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss) — grey areas resolved at Claude's discretion. FINAL PHASE: this closes the arcade loop and makes the game shippable.

<domain>
## Phase Boundary

The game becomes a complete, self-contained arcade loop with a HUD, synthesized sound, and a title/victory/death flow driven by reaching the exit or dying.

**In scope:** the HUD (health/armor/ammo/weapon/kill count/crosshair/fading messages/minimap/damage flash), Web Audio SFX synthesis wired to the existing `Sound.play` hook, and the game-state machine (title → playing → victory/death → restart) including the exit trigger.
**Out of scope:** new gameplay mechanics, enemy variety, extra levels, save/load — all v2/out-of-scope. This phase presents and frames what Phase 5 already simulates.

**Requirements covered:** HUD-01..06, AUD-01..03, LVL-03, LVL-04, LVL-05, LVL-06.
**All code under `Doom/Claude Opus 4.8/GSD/`** (quote paths — spaces in folder name).
</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion (resolved)

1. **HUD renders on the `#hud` canvas (the Phase 1 contract), NOT the framebuffer.** `#hud` is a transparent, DISPLAY-resolution overlay with `pointer-events:none` — reserved for exactly this since Phase 1. Draw crisp text/shapes there with the 2D context (`Framebuffer.hudCtx`). Two caveats, both load-bearing:
   - `Framebuffer.resize()` CLEARS the `#hud` backing store, so the HUD must repaint every frame (or on a resize hook). Repaint-every-frame is simplest and correct.
   - The Phase 1 verification forward-note flagged this exact hazard. Honor it.

2. **CRITICAL — take over the existing message line (Phase 5 verification finding).** `Game.renderMessage` is ALREADY registered in `Raycaster.overlayPasses` and draws the pickup message into the framebuffer. HUD-04 must either (a) remove that overlay pass and render messages on `#hud`, or (b) keep it and NOT add a second message renderer. Do ONE. Otherwise the message double-draws. Recommended: move messages to `#hud` (crisper text, consistent with the rest of the HUD) and de-register the framebuffer pass — but keep the 5x7 bitmap font module if the minimap or an in-world need remains.

3. **HUD layout (HUD-01/02/03/06).** A bottom status bar on `#hud`: HEALTH, ARMOR, AMMO (for the current weapon), WEAPON name, KILLS `n/total`. Center crosshair (small cross/dot, HUD-03). Damage flash (HUD-06): a translucent red fullscreen rect whose alpha decays over ~0.3s, triggered when `Combat.health` drops — read a `Combat.lastDamageAt` (already exists) or a damage event. Keep text legible at display resolution; scale sizes from the canvas height so it works at any window size.

4. **Minimap (HUD-05).** A small corner overlay on `#hud`: the level grid (solid vs floor), the player as a dot with a facing tick, and NEARBY entities (live enemies one color, pickups another, corpses dimmed or omitted). Scale to a fixed pixel box; either show the whole 24x24 level or a window around the player — whole-level is simpler and fine at this size. Do not leak enemy positions the player could not plausibly know if you want fairness, but full-level is acceptable and classic for a minimap.

5. **Audio (AUD-01/02/03) — synthesize, never load.** New `js/audio.js` replacing the `js/sound.js` stub's internals (keep the `Sound.play(name)` call-site API so Phase 5 call sites keep working — the verifier notes ONE call site exists and FIVE more need wiring: pistol fire, shotgun fire, enemy attack, enemy death, pickup, player damage).
   - Single `AudioContext`, created/resumed on the START-SCREEN CLICK gesture (the same single gesture that requests pointer lock) — this is AUD-03 and the classic autoplay-policy trap. Context starts `suspended`; `resume()` on that gesture.
   - Master chain: per-sound gain → master `GainNode` → optional `DynamicsCompressorNode` → destination (prevents clipping when several SFX overlap).
   - Per-sound recipes (oscillators + white-noise buffers + gain envelopes + biquad filters), all scheduled against `ctx.currentTime`, envelopes ramping to a small epsilon (never exactly 0):
     - pistol: short square/saw blip + noise transient, fast decay
     - shotgun: louder low-passed noise burst, longer decay
     - enemy attack: descending/growly tone (distinct from player weapons)
     - enemy death: noise + falling pitch
     - pickup: bright ascending sine/triangle blip
     - player damage: low thud / filtered noise
   - Must be robust when audio is unavailable/blocked: `Sound.play` must never throw and never block gameplay.

6. **Game-state machine (LVL-03..06) — lock the states.** `Game.state` ∈ `title | playing | victory | dead`.
   - `title`: shown on load. Draws title + controls on `#hud`. A single CLICK starts play: sets `state='playing'`, requests pointer lock, and `resume()`s the AudioContext (ONE gesture does all three — AUD-03/LVL-06).
   - `playing`: current behavior. `Game.update` only simulates in this state (title/victory/dead freeze the sim but keep rendering, so the world sits behind the overlay).
   - `victory`: entered when the player reaches the EXIT (LVL-03/04). The exit marker already exists in `Level.spawns` (type `exit`) and the level has exit-textured wall cells — make it visibly marked and REACHABLE, and trigger on proximity (a radius test like pickups). Show stats: kills `n/total` and elapsed time (`Game.time` already accumulates in `Game.step`).
   - `dead`: entered when `Combat.dead` latches (health ≤ 0) — LVL-05. Show a death screen with a restart option.
   - RESTART from victory/dead: rebuild to a clean initial state — `Level.build()` / `Enemies.build()` (which zeroes the kill tally) / `Pickups.build()` / `Player.spawn()` / `Combat.reset()` / `Weapons.reset()` / `Game.resetStats()` — then `state='playing'`. Beware the Phase 5 finding: `Entities.build()` assigns a FRESH array, so anything caching entity references must rebuild in the right order (`Enemies.reset()` already chains `Pickups.build()`).
   - Pointer lock: releasing (Esc) should pause or at least not break; re-click to re-lock. Don't fight the browser.

7. **Reuse, don't re-architect.** `Framebuffer` (incl. `hudCtx`), `Raycaster` (+ `overlayPasses`), `Entities`/`Enemies`/`Pickups`, `Combat` (health/armor/ammo/weapon/hasShotgun/dead), `Weapons`, `Game` (state/time/kills/totalKills/message queue/step/render), `Input` (intent-only; add a click/start handler), `Level`, `Sprites`/`Textures`, `CONFIG` (all tuning numbers). New `<script>`s in dependency order before `js/main.js` per the load-order contract.

8. **Verification approach.** Continue the established discipline: headless `tools/boot.cjs` harnesses driving `Game.step(dt)` with the virtual clock, each with an all-pass token, every negative claim paired with a falsifiability control. Audio is testable headlessly by STUBBING a minimal AudioContext in the harness and asserting the node graph/scheduling calls (not by listening) — assert `Sound.play` is called for each of the six events, that it never throws when the context is unavailable, and that no `AudioContext` is constructed before the start gesture. State machine: assert sim frozen in title/victory/dead, exit proximity → victory with correct stats, health 0 → dead, restart returns every stat/entity to initial. Keep the full Phase 1-5 regression green (9 harnesses, 571 assertions) — never weaken an assertion.
</decisions>

<code_context>
## Existing Code Insights

Phases 1-5 shipped and verified (34/47 requirements, 571 assertions across 9 harnesses). Directly relevant:
- **`#hud` canvas + `Framebuffer.hudCtx`** exist and are unused since Phase 1 — this phase's home. `Framebuffer.resize()` clears it (repaint every frame).
- **`Game.renderMessage` is already in `Raycaster.overlayPasses`** (Phase 5 verification finding) — the HUD must take it over or remove it, or messages double-draw. `overlayPasses` is an ORDERED array.
- **`Sound.play(name)` stub** in `js/sound.js` with exactly ONE call site wired; five more events need call sites (pistol, shotgun, enemy attack, enemy death, pickup, player damage). Keep the API, replace the internals.
- **`Combat`** exposes health/armor/ammo{bullets,shells}/weapon/hasShotgun/dead/lastDamageAt. **`Game`** exposes state-ready fields: `time` (accumulates in `Game.step`), `kills`, `totalKills`, `resetStats()`, the message queue + `activeMessage()`. **`Weapons.reset()`**, **`Enemies.reset()`** (chains `Pickups.build()`), **`Enemies.build()`** (zeroes the tally) all exist for restart.
- **`Level.spawns`** includes the `exit` marker (Phase 4/5 deliberately skipped rendering it — this phase owns it). Exit-textured wall cells exist in the map.
- **A 5x7 bitmap font** exists from Phase 5 for the framebuffer message line — reusable if in-framebuffer text is still wanted.
- rAF-throttle caveat for verification: on a non-composited tab the loop doesn't tick; drive frames manually (`Game.step(0.016)` + `Game.view.render()` + `Framebuffer.present()`).
</code_context>

<specifics>
## Specific Ideas

- This phase makes the CORE VALUE true end-to-end: "open it in a browser and immediately play... win or die." Prioritize the complete loop (title → play → win/lose → restart) over HUD polish.
- The single start-screen gesture doing THREE things (start, pointer lock, AudioContext resume) is the highest-risk item — it's the classic autoplay/pointer-lock trap. Get it right and assert it.
- The exit must be genuinely REACHABLE and visibly marked (LVL-03) — verify a path exists from spawn (the level's flood-fill reachability already holds).
- Verify from `file://` AND a static server. Confirm zero console errors and zero network requests (the self-containment gate still applies — synthesized audio, no files).
</specifics>

<deferred>
## Deferred Ideas

- Enemy variety / directional sprites, extra levels, palette effects beyond the damage flash, animated doors, save/load — v2 / out of scope.
- Pathfinding for the 2-of-383 enemy steering local minimum near the NE-hall pillar (Phase 5 finding; no pathfinding is a deliberate D-02 design choice) — only revisit if it reads badly in play.
</deferred>
