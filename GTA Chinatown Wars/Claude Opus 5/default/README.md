# SALTGRAVE — A Port Verrano Story

A 2.5D top-down open-world action game: one dense city district rendered as real
3D geometry under an elevated, diagonal chase camera. Steal a car, drive it badly,
start a fight, pull a wanted level, lose the police in the alleys, and run three
short jobs for a woman who owns a garage.

Everything is original — city, characters, vehicles, businesses, signage, dialogue,
story. There are no third-party assets of any kind, and nothing is downloaded at
runtime: every texture is painted into a canvas at boot and every sound is
synthesised through Web Audio.

**Built one-shot by Claude Opus 5.**

---

## Run it

Open `index.html` in a current desktop Chrome, Edge or Firefox. It works straight
from `file://` — classic scripts, no modules, no build step, no dependencies.

Or serve the folder statically:

```bash
python -m http.server 8092 -d "GTA Chinatown Wars/Claude Opus 5/default"
```

Requires **WebGL2** (universal on current desktop browsers).

---

## Controls

### On foot
| Key | |
|---|---|
| `W A S D` | move — **relative to the camera**, not to the character |
| `Shift` | sprint |
| Mouse | aim &nbsp;•&nbsp; **Left button** attack / fire |
| `Q` `E` / wheel / `1`–`5` | change weapon |
| `F` | enter or steal the nearest vehicle |
| `E` | talk to a local (when one is in reach) |

### Driving
| Key | |
|---|---|
| `W` / `S` | throttle • brake, then reverse |
| `A` / `D` | steer |
| `Space` | handbrake — hold it into a corner and the back end comes round |
| `F` | get out |
| `H` | horn |
| `C` | camera: chase (swings behind the car) or north-up |

### General
`M` district map · `P` pause · `N` mute · `H` / `F1` controls

---

## The district

Saltgrave is a 5×5 block grid — two wide avenues and four narrow streets each way,
about 500m across, walled in by a solid perimeter. Roughly a minute to drive corner
to corner if the lights go your way.

It contains apartment blocks and shopfronts, alleys cut through the middle of
blocks, two parking yards, a park with a fountain, a plaza around the Salt Pillar,
street lights, traffic signals on a real cycle, hydrants, benches, bins, dumpsters,
rooftop water tanks and AC plant, and about forty saturated storefront signs.

Everything is generated from one seed, so the layout is stable while the art
varies.

**Landmarks used by the story:** Sable Autobody (the yard you start beside),
the impound yard across the district, and the plaza.

---

## Systems

**Driving.** Arcade, not simulation. Velocity is split into forward and sideways
components each frame and the sideways one is bled off exponentially — that decay
*is* the grip model. Drop it (handbrake, or a wrecked car) and it slides. Seven
vehicle types with genuinely different handling: the Kite GT will out-run anything
and understeer into a wall, the Ferro Courier will not.

**Living city.** Traffic drives the intersection graph, holds a lane by projecting
onto the lane centreline, stops for red lights, brakes for the car in front and for
people in the road, and leans on the horn when blocked. Pedestrians walk the
pavements, cross where they shouldn't, and scatter from gunfire, corpses, speeding
cars and anyone swinging a pipe. Pull a driver out of their car and they run.

**Wanted system.** Heat only accrues when somebody actually *sees* you do it — a
pedestrian with line of sight, or a cop. Five star levels. Units spawn on the road
graph well outside the camera, drive at you, and bail out on foot when you're
walking. Lose line of sight and they stop tracking and start *sweeping* the last
place they saw you, their search radius widening as they lose confidence. No fresh
units are dispatched while they've lost you, which is what makes escaping possible.
Stay unseen long enough (7s + 2.5s per star) and the whole thing drops.

**Combat.** Fists, pipe, sidearm, SMG, scattergun. Hitscan against people, cops and
vehicles, with walls blocking shots. Cars take damage, smoke, then go up — and the
explosion hurts whatever is standing near it.

**Missions.** Three, in order, each triggered by walking into its marker:

1. **BOOST** — steal a marked Kite GT and deliver it to Sable Autobody. Fails if
   you total it.
2. **HOT PACKAGE** — collect a package. Taking it hands you two stars on the spot.
   Deliver it across the district. Fails if you die or get busted.
3. **GETAWAY** — destroy the Tallow Boys' van, take four stars for it, and escape.

Objectives, checkpoints, failure conditions, rewards and dialogue are all wired
through one small framework in `missions.js`.

---

## Rendering

Hand-written WebGL2. No engine, no libraries.

- **Camera** — perspective, ~53° down, following with easing. It pulls back and
  flattens as you speed up, swings behind the car in chase mode, and stands itself
  up (and pulls in) when a building would otherwise be between you and the lens.
- **Ink outlines** — an inverted-hull pass. Back faces are inflated along a
  per-vertex "hull" direction and drawn in near-black, scaled with distance so the
  line stays a constant thickness on screen.
- **Toon lighting** — direct light is quantised into three flat bands, so surfaces
  read as blocks of colour with hard shadow terminators rather than smooth shading.
- **Shadows** — a real 2048² directional shadow map with 3×3 PCF, following the
  player and snapped to texels so the edges don't crawl.
- **Materials** — one `TEXTURE_2D_ARRAY` of 37 procedurally painted 256px layers
  (brick, stucco, tile, corrugated steel, window walls, foliage, twelve storefront
  signs…), so textures tile freely with no atlas seams.
- **Skinning** — every mesh tags vertices with a bone index and the renderer feeds
  eight world matrices per draw. Vehicles use it for steering and spinning wheels;
  people use it for swinging arms and legs.

Comfortably over 60fps with ~60 vehicles and ~50 pedestrians on screen-adjacent
streets (~9ms/frame, ~200k triangles across all passes, ~140 draw calls).

---

## Layout

```
index.html          script tags, boot + title screens
style.css           title, boot, layout
js/
  math.js           mat4, damping, seeded RNG, the heading convention
  gl.js             WebGL2 context, programs, vertex format, shadow FBO
  art.js            every texture, painted at boot into a canvas
  mesh.js           MeshBuilder — prisms, quads, cylinders, hull normals
  models.js         vehicles, people, weapons, markers, particles
  city.js           district generation, collision boxes, road graph, landmarks
  collide.js        circle-vs-box push-out, ray casts, line of sight
  camera.js         the 2.5D chase camera + occlusion avoidance
  input.js          key-state map, mouse
  audio.js          synthesised SFX, engine loop, siren
  renderer.js       shaders and the shadow/ink/opaque/blend passes
  vehicle.js        arcade driving and collision response
  player.js         Rook: movement, aiming, weapons, enter/exit, talking
  ped.js            pedestrian AI
  traffic.js        AI drivers + traffic population
  combat.js         hitscan, melee, explosions, particles
  police.js         heat, stars, units, foot cops, search behaviour
  missions.js       mission framework + the three jobs
  hud.js            HUD, minimap, map, dialogue, pause, help
  game.js           world state, streaming, update order, cross-system hooks
  main.js           boot, resize, frame loop
tools/
  shotsrv.cjs       dev-only: receives screenshots posted by window.SG.shot()
```

### Debug hook

`window.SG` is exposed for headless testing: `SG.step(n)` advances `n` frames
deterministically (useful when `requestAnimationFrame` is throttled), `SG.grab()`
returns the current frame as a data URL, and `SG.shot(name)` posts it to
`tools/shotsrv.cjs` if that server is running. None of it affects normal play.
