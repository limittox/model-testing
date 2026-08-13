# DOOM — Claude Opus 5 / default

A playable browser DOOM clone: a software raycasting FPS written in vanilla
HTML + CSS + JavaScript. No build step, no dependencies, no asset files.
Every texture, sprite and sound is generated procedurally at boot.

## Play it

Open `index.html` in a desktop browser. That's it — it works straight off
`file://`, or from any static server:

```bash
python -m http.server 8091
```

Click the canvas to capture the mouse and start.

## Controls

| Input | Action |
|---|---|
| `W` `A` `S` `D` | Move / strafe |
| Mouse | Look (yaw + pitch) |
| Left click | Fire |
| `Shift` | Run |
| `1` `2` `3` / wheel | Pistol / Shotgun / Chaingun |
| `E` or `Space` | Open doors, hit the exit switch |
| `Tab` | Automap |
| `Esc` | Pause (releasing the mouse also pauses) |
| `R` | Restart the level |
| `M` | Mute |
| `C` | Recentre the view |

## The level

One 32×32 map. Find the **red keycard** in the north-east vault, use it on the
red door in the middle of the south wall, then fight through the blood arena and
press the **exit switch**. There is one secret room (the annex behind the door
on the lower west side) holding the chaingun and a medikit.

Eleven monsters: zombiemen (hitscan), imps (fireballs), pinky demons (melee
chargers), and one baron that throws a three-way fireball spread.

## How it works

| Concern | Approach |
|---|---|
| Rendering | 480×300 `Uint32Array` framebuffer, one `putImageData` per frame, upscaled by CSS `image-rendering: pixelated` |
| Walls | DDA raycast per screen column, textured, distance-shaded, with a `Float32Array` per-column z-buffer |
| Floor / ceiling | Row-by-row flat casting — each screen row is one constant distance |
| Sprites | Billboards sorted back-to-front, occluded per column against the z-buffer |
| Doors | The leaf slides into a wall pocket; the ray passes through the open fraction, so what you shoot through matches what you see |
| Textures & sprites | Generated into typed arrays at boot (~14 ms total) with a seeded RNG, so the art is byte-identical every run |
| Audio | Web Audio oscillators + filtered white noise with gain envelopes; 27 effects, no files |
| Modules | Classic `<script>` tags and global namespaces — ES modules are blocked by CORS on `file://` |

Measured in Chrome: **~1.6 ms/frame** for the full software render at 480×300,
against a 16.6 ms budget.

## Layout

```
index.html          script tags + canvas
style.css           pixelated upscale, letterboxing
js/util.js          packed-colour helpers, seeded RNG
js/config.js        resolution, speeds, limits
js/textures.js      9 wall textures + 3 flats, procedural
js/sprites.js       monsters, pickups, projectiles, weapon views, HUD face
js/level.js         ASCII map, doors, spawns, collision, line of sight
js/audio.js         Web Audio synthesis
js/input.js         key-state map (event.code), pointer lock
js/renderer.js      framebuffer, wall/flat casting, sprite pass
js/hud.js           bitmap font, status bar, automap, menus
js/entities.js      monster AI, pickups, projectiles, effects
js/weapons.js       firing, hitscans, first-person view
js/player.js        movement, look, damage, pickups
js/game.js          state machine, per-frame orchestration
js/main.js          boot, canvas sizing, rAF loop
```

## Verification

Two headless Node tools run the real game code against a stubbed DOM — no
browser needed.

```bash
node tools/check.cjs
```

Loads every module, generates all the art, and asserts on the level: that the
map is enclosed, that nothing is spawned inside a wall, that the red key is
reachable *before* the locked door and the exit is reachable *after* it, and
that no thing is walled off. Then it runs 600 frames of real update+render and
checks damage, armour absorption, pickups, the locked door, and level exit.

```bash
node tools/shot.cjs      # renders tools/shots/*.png of the real framebuffer
node tools/scene.cjs imp # one hand-composed scene (imp | items | corpse)
```

These encode the framebuffer straight to PNG, which is how the screenshots in
`tools/shots/` were produced. They are regenerable and not inputs to the game.
