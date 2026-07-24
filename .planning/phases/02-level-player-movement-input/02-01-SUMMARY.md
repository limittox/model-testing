---
phase: 02-level-player-movement-input
plan: 01
subsystem: level
tags: [grid-level, raycaster-map, uint8array, dda, line-of-sight, forced-border, spawn-markers, landmarks, headless-harness, vm-sandbox]

# Dependency graph
requires:
  - "01-01: CONFIG + packRGBA/mulberry32 + Framebuffer + the classic-script load-order contract in index.html"
  - "01-02: Textures.map / Textures.names / Textures.build() — the 7 deterministic 64x64 assets the wall-ID table resolves into"
provides:
  - "Level global: SOURCE (24x24 authored rows), WALL_CHARS / FLOOR_CHARS / MARKER_CHARS legend tables, build(), cells (Uint8Array, row-major, 0 === no wall)"
  - "Forced-solid border + row padding/truncation — the player cannot leave the grid regardless of how the source is hand-edited"
  - "Level.WALL_TEXTURES as REAL DATA: [null,'stone','brick','tech','door','exit'] + textureNameFor / textureFor / validateTextures (lazy Textures.map resolution)"
  - "Level.playerStart {x,y,mx,my,dirX,dirY} and Level.spawns[] [{type,x,y,mx,my}] — markers parsed OUT of the grid, cells left floor (Phase 5 consumes spawns)"
  - "Level.cellAt / Level.isSolid — fail-closed grid queries (stone / true for every out-of-bounds or NaN coordinate)"
  - "Level.LANDMARKS: openCell {mx,my,x,y}, wallFaceEast {mx,my,x,y,wf}, corridorCell {mx,my,x,y,blockedAxis,slideDir} — derived row-major from the parsed grid on every build"
  - "Level.lineOfSight(x0,y0,x1,y1) — bounded grid DDA, strictly-between semantics, ready for Phase 5 AI and hitscan"
  - "tools/boot.cjs: the reusable headless harness bootstrap (shipped script order into a vm, stubbed DOM, manual rAF scheduler, setVisibility / setPointerLockElement, assert / finish)"
  - "tools/verify-level.cjs: 56-assertion level contract harness printing ALL_LEVEL_CONTRACTS_PASS"
  - "Extended classic-script load order: config -> framebuffer -> textures -> sprites -> preview -> level -> main"
affects: [02-02-player-movement-collision, 02-03-topdown-view, 03-raycaster-walls-floors, 05-enemies-weapons-pickups, 06-hud-audio-states]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Legend-as-data: wall/floor/marker character tables are object literals on the Level global, so the parser contains zero scattered character literals"
    - "Normalize-then-force: pad/truncate every row to WIDTH during the character pass, then overwrite the whole outer ring LAST so no authored character can survive on the border"
    - "Fail-closed grid queries: cellAt returns the stone ID for out-of-bounds AND NaN via the !(a >= b) comparison form, so isSolid can never report open floor outside the world"
    - "Derived landmarks: named map anchors are recomputed row-major from the parsed cells on every build and re-verified against their own geometric predicates in the harness, so they cannot drift from the map"
    - "Lazy cross-global resolution: Textures.map is read inside the accessor bodies, so level.js carries no hard load-order dependency"
    - "Bounded DDA with a finite zero-direction constant (1e30) instead of Infinity, plus a WIDTH+HEIGHT+2 iteration cap — termination is structural, not incidental"
    - "Node-only tools/*.cjs harnesses that evaluate index.html's REAL script list in a vm, so every harness verifies the shipped load order rather than a hand-written list"
    - "Manual requestAnimationFrame scheduler over a virtual clock, so a harness can manufacture an arbitrarily large frame delta deterministically"

key-files:
  created:
    - "Doom/Claude Opus 4.8/GSD/js/level.js"
    - "Doom/Claude Opus 4.8/GSD/tools/boot.cjs"
    - "Doom/Claude Opus 4.8/GSD/tools/verify-level.cjs"
  modified:
    - "Doom/Claude Opus 4.8/GSD/index.html"

key-decisions:
  - "WIDTH is the LONGEST source row, so short rows pad with stone and the mx < WIDTH loop bound structurally truncates — a ragged hand-edit can only ever ADD wall, never remove it"
  - "Markers buried by the forced border (authored on or padded into the outer ring) are DROPPED with a warning rather than handed to Phase 5 as an unreachable spawn"
  - "lineOfSight tests the destination cell for arrival BEFORE testing it for solidity, giving strictly-between semantics so a target standing in a doorway is still visible"
  - "Zero ray-direction components substitute a large FINITE constant (1e30) rather than Infinity, because Infinity * 0 (a point exactly on a grid line) is NaN and would silently break the march"
  - "tools/ is Node-only CommonJS and is never referenced by index.html, so the Phase 1 self-containment gate is re-scoped to index.html + style.css + js/ and the harness now asserts that scoping mechanically"

patterns-established:
  - "Grid addressing is row-major my*WIDTH + mx everywhere; callers floor world coordinates before calling cellAt/isSolid"
  - "Landmark records carry BOTH cell coordinates (mx,my) and world coordinates (x,y), plus any derived geometry (wf, blockedAxis, slideDir), so consumers never recompute"
  - "Every headless harness requires tools/boot.cjs, boots a named subset of the shipped scripts, and ends with finish('<TOKEN>')"

requirements-completed: [LVL-01]

coverage:
  - id: D1
    description: "A hand-designed 24x24 grid level with 3+ rooms, one-cell corridors, an exit-faced dead-end alcove and all five wall materials parses into a flat Uint8Array of wall IDs where 0 means no wall (LVL-01, D-02)"
    requirement: "LVL-01"
    verification:
      - kind: unit
        ref: "node \"Doom/Claude Opus 4.8/GSD/tools/verify-level.cjs\" — assertions 1a-1d, 2, 7a-7b, 9a-9e (24x24, 576 cells, 0 warnings, material counts 1:282 2:13 3:20 4:2 5:5, 10 disjoint 4x4 rooms, 19 5x5 blocks, 27 one-cell corridor cells, 1 exit alcove)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The outer border is solid no matter what the source rows say, and ragged rows are normalized — a hand-edit can never open a hole to the outside (D-02, threat T-02-01)"
    requirement: "LVL-01"
    verification:
      - kind: unit
        ref: "verify-level.cjs assertions 3, 4a-4e — holes punched into all four border sides plus a half-length interior row; border still fully solid, grid still WIDTH*HEIGHT, truncated cells came back solid"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every solid cell resolves through a real wall-ID to texture-name TABLE into a Phase 1 Textures.map entry; the table is data, not a naming convention, and index 0 is unambiguously null (D-03)"
    requirement: "LVL-01"
    verification:
      - kind: unit
        ref: "verify-level.cjs assertions 6a-6e — WALL_TEXTURES[0] === null, IDs 1..5 each resolve to a 64x64 entry with buf32.length 4096, validateTextures() returns []"
        status: pass
    human_judgment: false
  - id: D4
    description: "Non-wall markers are parsed OUT of the grid into Level.playerStart and Level.spawns, leaving those cells plain floor for Phase 5 (D-04)"
    requirement: "LVL-01"
    verification:
      - kind: unit
        ref: "verify-level.cjs assertions 8a-8i — playerStart at (2,2) on floor with a unit direction, 8 spawns, every spawn type a MARKER_CHARS value, every spawn cell 0, no marker char survives as a wall ID"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every non-solid cell and every spawn is reachable on foot from the player start — the level has no sealed pocket"
    requirement: "LVL-01"
    verification:
      - kind: unit
        ref: "verify-level.cjs assertions 10a-10b — four-connected flood fill from the start cell visits all 254 floor cells and all 8 spawn cells"
        status: pass
    human_judgment: false
  - id: D6
    description: "Level.LANDMARKS exports named anchors (open cell, east-facing wall face carrying the world coordinate of the face, one-cell corridor carrying its blocked axis and slide direction) derived from the grid, so Plans 02 and 03 assert against named features instead of hardcoded coordinates"
    verification:
      - kind: unit
        ref: "verify-level.cjs assertions 13a-13f — each landmark re-verified against its own geometric predicate (5x5 neighbourhood all floor; +x solid / -x floor with wf === mx+1, x === wf-0.5, y === my+0.5; both blockedAxis neighbours solid with two floor cells along slideDir)"
        status: pass
      - kind: unit
        ref: "verify-level.cjs assertions 12a-12c — landmarks resolve identically across rebuilds"
        status: pass
    human_judgment: false
  - id: D7
    description: "A grid line-of-sight helper answers whether two world points can see each other, ready for Phase 5 enemy AI and hitscan, and provably terminates (threat T-02-03)"
    verification:
      - kind: unit
        ref: "verify-level.cjs assertions 11a-11e — self-visibility, symmetry in both argument orders across an open 4x4 block, blocked by a wall on a row and on a column, and false-with-termination for four lines that leave the grid"
        status: pass
    human_judgment: false
  - id: D8
    description: "tools/boot.cjs boots index.html's REAL script list into a Node vm with a stubbed DOM, a manual rAF scheduler, a settable pointer-lock element and a settable visibility state — the shared bootstrap for every later Phase 2 harness"
    verification:
      - kind: integration
        ref: "verify-level.cjs runs entirely through boot.cjs (56/56 assertions); assertion 14d proves the SHIPPED order places js/level.js after preview.js and before main.js; a full-boot regression check (all 7 scripts + fireLoad) still produces exactly one putImageData into a 480x270 framebuffer and repaints on resize"
        status: pass
    human_judgment: false
  - id: D9
    description: "The browser-loaded surface stays self-contained: index.html references only relative paths under js/ or style.css, and nothing under tools/ can ever be loaded by the browser (PLAT-02/PLAT-03, threat T-02-04)"
    verification:
      - kind: unit
        ref: "negative token scan over js/, index.html and style.css for type=\"module\" | import | export | require( | fetch( | XMLHttpRequest | new Image | http(s):// | cdn. -> ZERO matches"
        status: pass
      - kind: unit
        ref: "verify-level.cjs assertions 14a-14c — all 8 index.html references are relative, exist on disk, and are style.css or under js/; none mention tools/"
        status: pass
    human_judgment: false
  - id: D10
    description: "The page still opens and renders correctly in a real browser from file:// and a static server with js/level.js added to the load order"
    verification:
      - kind: automated_ui
        ref: "orchestrator browser check of Doom/Claude Opus 4.8/GSD/index.html — Phase 1 preview atlas unchanged, zero console errors"
        status: unknown
    human_judgment: true
    rationale: "level.js defines a global and renders nothing, so the headless full-boot regression (one putImageData, 480x270, resize repaint, no thrown errors) covers the mechanism exhaustively; only a real browser can confirm an empty DevTools console. Autonomous run with no human available — delegated to the orchestrator's browser pass."

# Metrics
duration: 12min
completed: 2026-07-24
status: complete
---

# Phase 2 Plan 01: Grid Level, Landmarks & Line-of-Sight Summary

**A hand-authored 24x24 ASCII level parsed into a flat Uint8Array wall-ID grid with a structurally-forced solid border, a real wall-ID to texture table, marker tables extracted out of the grid, three grid-derived motion landmarks, and a bounded DDA line-of-sight helper — all proven by a 56-assertion headless harness that boots the shipped script list.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-24T00:00:00Z (approx)
- **Completed:** 2026-07-24
- **Tasks:** 3 (all `type="auto"`, no checkpoints)
- **Files:** 3 created, 1 modified

## Accomplishments

- **The world exists as hard data, not a hopeful convention.** `Level.cells` is a row-major `Uint8Array(576)` where `0` unambiguously means "no wall". Phase 3's wall pass reads a **table** (`Level.WALL_TEXTURES`) rather than re-deriving a naming rule — the forward-note Phase 1 verification left open (D-03) is now closed with real data plus a `validateTextures()` self-check that returns `[]`.
- **"The player cannot leave the level" is structural, not aspirational.** Rows are padded/truncated to `WIDTH` during the character pass and the entire outer ring is overwritten with stone **afterwards**, so no authored character and no ragged row survives on the border. The harness proves it adversarially: holes punched into all four border sides *and* an interior row truncated to half length still yield a fully solid ring and a perfect `WIDTH*HEIGHT` rectangle. `isSolid` additionally returns `true` for every out-of-bounds *and* NaN coordinate, so the collision resolver Plan 02 is about to write fails closed.
- **The motion harnesses now have named anchors instead of magic numbers.** `Level.LANDMARKS` is derived row-major from the parsed cells on **every** build and each entry is re-verified against its own geometric predicate in the level harness — so a map edit that removes the feature fails *here*, loudly, rather than as a confusing motion failure two plans later.
- **Every later Phase 2 harness has a shared, deterministic bootstrap.** `tools/boot.cjs` extracts index.html's *real* `<script src>` list and evaluates those exact files in one vm context, with a manual `requestAnimationFrame` scheduler over a virtual clock — which is precisely what will let Plan 02 manufacture a 2-second frame hitch and prove the delta-time clamp stopped it.

## Task Commits

Each task was committed atomically:

1. **Task 1: Hand-designed grid level — parser, forced border, texture table, marker tables, landmarks** — `a52ae5e` (feat)
2. **Task 2: Grid line-of-sight helper + reusable headless harness bootstrap** — `f0fdd63` (feat)
3. **Task 3: Level contract harness** — `0f92c32` (test)

## Files Created/Modified

- `Doom/Claude Opus 4.8/GSD/js/level.js` (created, ~470 lines) — the `Level` global: authored SOURCE, legend tables, `build()`, forced border, marker extraction, landmark derivation, query API, texture resolution, `lineOfSight`.
- `Doom/Claude Opus 4.8/GSD/tools/boot.cjs` (created, ~400 lines) — Node-only harness bootstrap.
- `Doom/Claude Opus 4.8/GSD/tools/verify-level.cjs` (created, ~440 lines) — 56-assertion level contract harness.
- `Doom/Claude Opus 4.8/GSD/index.html` (modified) — one new classic `<script src="js/level.js">` between preview.js and main.js; load-order contract comment extended to 7 entries and annotated with why `tools/` is never browser-loaded.

## The Level API Surface (contract for Plans 02/03 and Phases 3/5/6)

### Data

| Member | Type | Meaning |
|--------|------|---------|
| `Level.SOURCE` | `string[24]` | Authored map, 24 chars per row. Cosmetic border; `build()` forces the real one. |
| `Level.WIDTH` / `Level.HEIGHT` | `24` / `24` | Derived: WIDTH is the longest source row, HEIGHT the row count. |
| `Level.cells` | `Uint8Array(576)` | Row-major wall IDs, index `my * WIDTH + mx`. `0` = no wall. |
| `Level.playerStart` | `{x, y, mx, my, dirX, dirY}` | `{x:2.5, y:2.5, mx:2, my:2, dirX:1, dirY:0}`. |
| `Level.spawns` | `Array<{type, x, y, mx, my}>` | 8 entries. **Phase 5 reads this.** |
| `Level.warnings` | `string[]` | Empty for the shipped map; reset on every build. |
| `Level.LANDMARKS` | `{openCell, wallFaceEast, corridorCell}` | Derived; see below. |
| `Level.built` | `boolean` | `false` until `Level.build()` is called (Plan 02's job — level.js never self-builds). |
| `Level.STONE_ID` / `Level.STONE_CHAR` | `1` / `'#'` | Border material and out-of-bounds return value. |
| `Level.START_FACING` | `{x:1, y:0}` | Unit vector copied into `playerStart.dirX/dirY`. |

### Methods

| Method | Returns |
|--------|---------|
| `Level.build()` | Parses SOURCE into everything above. **Idempotent** — byte-identical cells, tables do not grow. Returns `Level`. |
| `Level.cellAt(mx, my)` | Wall ID. **`STONE_ID` for every out-of-bounds or NaN coordinate.** |
| `Level.isSolid(mx, my)` | `cellAt(mx,my) > 0` — therefore **`true` outside the grid**. The guard that makes leaving the world impossible. |
| `Level.textureNameFor(id)` | `'stone'` … `'exit'`, or `null` for id 0. |
| `Level.textureFor(id)` | The `Textures.map` asset, or `null`. Resolves `Textures.map` **lazily**. |
| `Level.validateTextures()` | `[]` when every wall ID resolves; otherwise `{id, name}` pairs. |
| `Level.lineOfSight(x0,y0,x1,y1)` | `true` when no solid cell lies **strictly between** the two world points. |

Both `cellAt` and `isSolid` take **integer cell coordinates** — callers floor world coordinates first.

### Character legend

| Char | Meaning | Wall ID | Texture |
|------|---------|---------|---------|
| `#` | stone | 1 | `stone` |
| `%` | brick | 2 | `brick` |
| `=` | tech | 3 | `tech` |
| `+` | door | 4 | `door` |
| `!` | exit | 5 | `exit` |
| `.` and space | open floor | 0 | — |
| `P` | player start | 0 (floor) | -> `Level.playerStart` |
| `E` `h` `r` `m` `g` `X` | enemy / health / armor / ammo / shotgun / exit markers | 0 (floor) | -> `Level.spawns[]` |

`Level.WALL_TEXTURES = [null, 'stone', 'brick', 'tech', 'door', 'exit']` — **index 0 is `null`**, which is what makes "no wall" unambiguous for Phase 3.

### The map

```
 0 ########################       west start room  rows 1-8,  cols 1-8   (brick pillar at 6,6)
 1 #........####..........#       north-east hall  rows 1-7,  cols 13-22 (tech pillars 17,3 / 20,5)
 2 #.P......####.m.....E..#       south chamber    rows 15-22,cols 3-14  (brick pillar at 8,18)
 3 #........+###....=.....#
 4 #...............E......#       row 4      = east-west link, door-faced entry at col 9
 5 #........+###.......=..#       col 4      = 1-cell corridor, rows 9-14 (start room -> south chamber)
 6 #.....%..####..........#       col 18     = 1-cell corridor, rows 8-17 (hall -> row-17 link)
 7 #....h...####..........#       row 20     = 1-cell corridor, cols 15-19 -> exit alcove
 8 #........########=.=####
 9 ####.############=.=####       254 floor cells, all reachable from the start
10 ####.############=.=####       10 disjoint 4x4 rooms, 19 5x5 blocks
11 ####.############=.=####       27 one-cell-wide corridor cells
12 ####.############=.=####       material counts: stone 282, brick 13, tech 20, door 2, exit 5
13 ####.############=.=####
14 ###%.%%%%%%%%%%##=.=####
15 ###............##=.=####
16 ###............##=.=####
17 ###................#####
18 ###...E.%......#########
19 ###.......g....####!!###
20 ###................X!###       (19,20) is the dead-end exit alcove, faced with '!' on 3 sides
21 ###.........r..####!!###
22 ###............#########
23 ########################
```

### `Level.spawns[]` — the record shape Phase 5 consumes

```js
{ type: 'enemy', x: 20.5, y: 2.5, mx: 20, my: 2 }
```

`type` is always a **value** of `Level.MARKER_CHARS` (`'enemy' | 'health' | 'armor' | 'ammo' | 'shotgun' | 'exit'`; `'player'` never appears here — it goes to `Level.playerStart`). `x`/`y` are the cell centre; `mx`/`my` are the integer cell. The eight shipped spawns:

| type | cell |
|------|------|
| `ammo` | (14,2) |
| `enemy` | (20,2) |
| `enemy` | (16,4) |
| `health` | (5,7) |
| `enemy` | (6,18) |
| `shotgun` | (10,19) |
| `exit` | (19,20) |
| `armor` | (12,21) |

Every spawn cell is plain floor (`cells[my*WIDTH+mx] === 0`) and every one is reachable from the player start.

### `Level.LANDMARKS` — resolved values (Plans 02 and 03 assert against these by name)

```js
openCell     = { mx: 3,  my: 3, x: 3.5,  y: 3.5 }
wallFaceEast = { mx: 8,  my: 1, x: 8.5,  y: 1.5, wf: 9 }
corridorCell = { mx: 18, my: 8, x: 18.5, y: 8.5,
                 blockedAxis: 'x', slideDir: { x: 0, y: 1 } }
```

- **`openCell`** — the centre of a 5x5 block of all-floor cells. A full cell of room in every direction; the anchor for every "from a fixed pose in open floor" measurement.
- **`wallFaceEast`** — a floor cell whose `+x` neighbour is solid and whose `-x` neighbour is floor. **`wf` is the world x coordinate of the wall FACE itself** (`mx + 1`), i.e. the plane the player drives into; `x = wf - 0.5` is a stand point half a cell short of it on the open side, and `y = my + 0.5` centres the pose in its row so a sub-0.5 collision radius cannot straddle a neighbouring row. Comparing the player's x against `wf` after a huge simulated frame is what makes "never crossed a wall" *provable* rather than merely "still standing somewhere legal".
- **`corridorCell`** — a one-cell-wide corridor: **both** neighbours along `blockedAxis` are solid, and there are at least two further floor cells along `slideDir` (always perpendicular to `blockedAxis`). A guaranteed blocked axis with guaranteed room to slide — the anchor for the wall-sliding test.

All three are recomputed row-major (first match wins, so they are deterministic) on **every** `build()`. If any cannot be derived, `Level.warnings` gains a descriptive entry and the field is `null` — so the harness's zero-warnings assertion catches a map edit that removed the feature.

## The `tools/boot.cjs` harness API (reuse this in Plans 02 and 03)

```js
const { boot, assert, finish, failures, GAME_DIR } = require('./boot.cjs');
const h = boot({ only: ['config', 'framebuffer', 'textures', 'level'] });
```

`boot(options)` reads `index.html`, extracts its **real** ordered `<script src>` list, and evaluates those exact files in one shared `vm` context with a stubbed DOM.

**Options:** `dir` (default: the parent of `tools/`), `only` (array of script basenames, with or without `.js`, to load a subset), `innerWidth` / `innerHeight` (default 1280x720).

| Member | Purpose |
|--------|---------|
| `h.sandbox` / `h.window` | The shared globals — `h.sandbox.Level`, `h.sandbox.Textures`, `h.sandbox.Framebuffer`, … |
| `h.scriptOrder` | The **shipped** order, unfiltered — assert against this, never a hand-written list |
| `h.loaded` | What this boot actually evaluated |
| `h.resourceRefs` | Every `src=`/`href=` in index.html (drives the self-containment gate) |
| `h.document` | Stub document: `getElementById`, `createElement`, settable `pointerLockElement`, `visibilityState`/`hidden`, `exitPointerLock()` |
| `h.canvas(id)` | Canvas stub — `getContext('2d')`, `pointerLockCalls`, `lastPointerLockOptions`, `getBoundingClientRect` |
| `h.raf` | **Manual scheduler:** `raf.step(deltaMs)`, `raf.run(frames, deltaMs)`, `raf.time` (virtual clock, ms), `raf.pending()`, `raf.reset()`. `performance.now()` reads the same clock. |
| `h.putCount()` / `h.lastImageData()` | `putImageData` call count and last argument |
| `h.fireLoad()` | Dispatch the recorded window `load` handlers (boots `main.js`) |
| `h.dispatch(target, type, ev)` | Invoke recorded handlers; `target` is `'window'`, `'document'`, or a canvas id. `preventDefault`/`stopPropagation` stubs are injected. |
| `h.handlerCount(target, type)` | How many handlers were registered — proves a listener was actually wired |
| `h.setPointerLockElement(el)` | Set `document.pointerLockElement` (id string or element) **and** dispatch `pointerlockchange` |
| `h.setVisibility(state)` | Set `visibilityState` + the consistent `hidden` boolean **and** dispatch `visibilitychange` in one call — simulates a tab going away and coming back |
| `h.resize(w, h)` | Set `innerWidth`/`innerHeight` and dispatch `resize` |
| `h.timers` | Captured `setTimeout`/`setInterval` calls — nothing escapes the virtual clock |

**Reporting:** `assert(condition, label)` prints `PASS:`/`FAIL:` and tallies; `finish(token)` prints the total, then the all-pass token **only** when zero assertions failed, otherwise `process.exit(1)`.

> **The manual rAF scheduler is the load-bearing piece for Plan 02.** Callbacks queued during a step run on the *next* step (exactly like a browser), and `raf.step(2000)` advances the virtual clock by a full two seconds — which is how the delta-time clamp gets tested for real rather than by inspection.

## Verification Results

**Per-task automated gates (all pass):** `node --check` on `js/level.js`, `tools/boot.cjs` and `tools/verify-level.cjs`; contract greps for `WALL_TEXTURES` / `playerStart` / `spawns` / `LANDMARKS` / `wallFaceEast` / `Uint8Array` / `lineOfSight` / `deltaDist` / `runInContext` / `scriptOrder` / `visibilityState` / `setVisibility`; the `awk` ordering gate proving `js/level.js` precedes `js/main.js`.

**Level contract harness — 56/56 (`ALL_LEVEL_CONTRACTS_PASS`):**

| Group | Result |
|-------|--------|
| 1. Dimensions | 24x24, `cells` is a `Uint8Array` of 576 |
| 2. Zero warnings | shipped map parses clean — every authored character is in the legend |
| 3. Border solid | all 92 ring cells solid |
| 4. Border **forced** | holes punched into all four sides + an interior row truncated to 12 chars -> ring still fully solid, grid still 24x24x1 byte, cells 12..23 of the ragged row came back solid |
| 5. Out of bounds | `isSolid` true on all four sides, at ±999999, and for `NaN`; `cellAt` returns the stone ID |
| 6. Texture table | `WALL_TEXTURES[0] === null`; 1->stone 2->brick 3->tech 4->door 5->exit each a real 64x64 asset with `buf32.length === 4096`; `textureFor(0) === null`; `validateTextures() === []` |
| 7. Materials (LVL-01) | all five present — stone 282, brick 13, tech 20, door 2, exit 5; no cell holds an ID > 5 |
| 8. Markers (D-04) | playerStart (2,2) on floor, cell-centre coords, unit direction; 8 spawns, all typed from `MARKER_CHARS`, all on floor cells, player absent from `spawns` |
| 9. Rooms/corridors (LVL-01) | 10 disjoint 4x4 rooms, 19 5x5 blocks, 27 one-cell corridor cells, 23 with a 3+ cell run, 1 exit-faced dead-end alcove |
| 10. Reachability | all **254** floor cells and all 8 spawn cells reachable from the start — no sealed pocket |
| 11. Line of sight | self-visible; symmetric across an open 4x4 block in **both** argument orders; blocked by a wall on a row (triple at 16,3) and on a column (triple at 17,2); four lines leaving the grid all terminate and return false |
| 12. Idempotence | second `build()` byte-identical, `spawns` did not grow, LANDMARKS identical, still warning-free |
| 13. Landmarks | all three non-null and each **re-verified against its own predicate** (5x5 neighbourhood all floor; `+x` solid / `-x` floor with `wf === mx+1`, `x === wf-0.5`, `y === my+0.5`; both `blockedAxis` neighbours solid with two floor cells along `slideDir`) |
| 14. Self-containment | all 8 index.html references relative + existing + `js/` or `style.css`; **nothing** under `tools/` referenced; shipped order places `level.js` after `preview.js`, before `main.js` |

**Self-containment negative gate — pass:** zero matches for `type="module"`, `import `, `export `, `require(`, `fetch(`, `XMLHttpRequest`, `new Image`, `http(s)://`, `cdn.` across `js/`, `index.html` and `style.css`. (`tools/*.cjs` legitimately uses `require` and is deliberately outside the gate's scope — the harness itself proves the browser can never reach it.)

**Phase 1 regression check — pass:** a full boot of all 7 scripts plus `fireLoad()` still produces exactly **one** `putImageData` into a 480x270 framebuffer and repaints on resize. Adding `level.js` to the load order changed nothing observable: it defines a global and never self-executes.

## Decisions Made

- **`WIDTH` = the longest source row, so normalization can only ever ADD wall.** Short rows pad with the stone character and the `mx < WIDTH` loop bound structurally truncates. Combined with the forced ring this means the *only* direction a malformed edit can push the grid is "more solid" — it is impossible for a ragged row to open the world.
- **Markers buried by the forced border are dropped, loudly.** A marker authored on (or padded into) the outer ring would sit inside solid rock after the border pass. Rather than hand Phase 5 an unreachable spawn, `build()` filters it out and records a warning — which the zero-warnings assertion then treats as a hard failure. (Rule 2: the plan did not call for this, but silently shipping an unreachable spawn is a correctness defect.)
- **`lineOfSight` checks arrival before solidity.** Testing "did I reach the destination cell?" *before* "is this cell solid?" gives strictly-between semantics, so an enemy standing in a doorway is visible to a hitscan from the room. The alternative (solidity first) would make every doorway occupant permanently unhittable.
- **A finite `1e30` stands in for `1/0`.** With `Infinity`, a point lying exactly on a grid line yields `Infinity * 0 === NaN`, and every subsequent comparison is silently false — the march would step the wrong axis forever until the cap. A large finite constant makes the zero-direction axis simply never win the comparison.
- **`tools/` is Node-only and the harness proves it.** Rather than asserting the scoping in prose, `verify-level.cjs` reads index.html's references and asserts each one is relative, exists, and lives in `js/` or is `style.css` — so the re-scoped self-containment gate is mechanically enforced rather than merely documented.
- **`level.js` does not call `build()` at load.** It defines the global and stops. Driving the parse is the game loop's job (Plan 02), which keeps the file a pure, side-effect-free data module that a harness can load in isolation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Markers buried by the forced border are dropped with a warning**
- **Found during:** Task 1
- **Issue:** The plan specifies the border pass runs *after* the character pass, and separately that markers become `Level.spawns` entries. Nothing reconciled the two: a marker authored on (or padded into) the outer ring would be recorded as a spawn whose cell is then overwritten solid — handing Phase 5 a spawn point inside rock, and silently breaking the harness's "every spawn cell is floor" invariant with no diagnostic.
- **Fix:** After the border pass, `build()` filters `Level.spawns` to entries still standing on floor and pushes a descriptive warning for each drop; the same check nulls `Level.playerStart` with a warning if it was buried. Because the shipped map must parse with zero warnings, a future map edit that pushes a marker onto the border now fails the harness loudly instead of corrupting Phase 5's spawn table.
- **Files modified:** `Doom/Claude Opus 4.8/GSD/js/level.js`
- **Verification:** harness assertions 2 (zero warnings), 8c and 8h (every marker cell is floor)
- **Committed in:** `a52ae5e` (Task 1 commit)

**2. [Rule 1 - Bug] `instanceof` across the vm realm boundary**
- **Found during:** Task 3
- **Issue:** The type assertion for `Level.cells` used `instanceof harness.sandbox.Uint8Array`, which threw `TypeError: Right-hand side of 'instanceof' is not an object` — a contextified sandbox object does not expose the realm's built-ins as own properties, and even if it did, `instanceof` is unreliable across realms.
- **Fix:** Replaced with a brand check, `Object.prototype.toString.call(Level.cells) === '[object Uint8Array]'`, which is realm-independent. Noted inline so later harnesses do not repeat the mistake.
- **Files modified:** `Doom/Claude Opus 4.8/GSD/tools/verify-level.cjs`
- **Verification:** harness assertion 1c passes; the run completes 56/56
- **Committed in:** `0f92c32` (Task 3 commit)

### Enhancements Beyond the Plan

**3. Extra harness assertions beyond the 13 specified groups.** The plan's assertion 4 called for holes in the top row and left column; the implementation punches all four sides. Added: a NaN-coordinate fail-closed check (5c), an explicit "no cell holds an ID outside 0..5" check (7b), a "player marker is not in spawns" check (8i), an explicit 5x5-block existence check (9b), a corridor-run-length check (9d), an exit-alcove existence check (9e), and a load-order check against the shipped script list (14d). Total 56 assertions across 14 groups.

**4. `boot.cjs` captures `setTimeout`/`setInterval` instead of leaving them undefined.** Real timers would escape the virtual clock and make a harness non-deterministic; leaving them undefined would throw. They are recorded on `h.timers` and never fire.

---

**Total deviations:** 2 auto-fixed (1 missing-critical data-integrity guard, 1 cross-realm type-check bug), 2 verification enhancements
**Impact on plan:** No architectural change. Every locked decision (D-02 forced border + normalized rows, D-03 materialized texture table, D-04 markers parsed out of the grid, D-10 reuse Phase 1 contracts and insert before `main.js`) is implemented exactly as specified.

## Issues Encountered

- Git emitted the usual benign LF->CRLF warnings on Windows. Content is unaffected.

## Known Stubs

None. Every member of the documented `Level` API is implemented and exercised by the harness; nothing returns a placeholder value.

## Threat Flags

None. No new network endpoint, auth path, file access pattern, or trust-boundary schema change was introduced beyond the register in the plan. All four `mitigate` dispositions (T-02-01 forced border, T-02-02 fail-closed grid queries, T-02-03 bounded DDA, T-02-04 self-containment gate) are implemented and asserted.

## Checkpoint Disposition

The plan contains **no** checkpoint tasks — all three tasks are `type="auto"`. The only residue is the human-judgment part of coverage item **D10**: confirming in a real browser that `index.html` still opens cleanly from `file://` and a static server with an empty console. `level.js` renders nothing, so the headless full-boot regression covers the mechanism exhaustively; the visual/console confirmation is delegated to the orchestrator's browser pass.

## Next Phase Readiness

- **Plan 02 (player pose, game loop, collision)** has everything it needs: `Level.build()`, `Level.isSolid` (fail-closed), `Level.playerStart` with its direction vector, `Level.LANDMARKS.wallFaceEast.wf` as the provable no-tunneling reference plane, `Level.LANDMARKS.corridorCell` for the wall-sliding test, and `tools/boot.cjs`'s manual rAF scheduler for manufacturing a 2-second frame hitch. Plan 02 must call `Level.build()` from the boot path — `level.js` deliberately does not self-build.
- **Plan 03 (top-down view)** can render `Level.cells` directly into `Framebuffer.buf32`, coloring by wall ID through `Level.WALL_TEXTURES`, and anchor its success-criteria harness on `Level.LANDMARKS.openCell`.
- **Phase 3 (raycaster)** consumes `Level.cells` + `Level.WALL_TEXTURES` + `Level.textureFor(id)` with no further work, and `Level.lineOfSight` already demonstrates the exact `deltaDist`/`sideDist` DDA shape the wall pass needs.
- **Phase 5** reads `Level.spawns[]` (8 entries, all reachable) and reuses `Level.lineOfSight` for enemy AI and hitscan.
- **Phase 6** has the exit-faced dead-end alcove at cell (19,20) with an `exit` spawn marker already parsed.
- No blockers.

## Self-Check: PASSED

All 3 created files and the 1 modified file exist on disk. All 3 task commits (`a52ae5e`, `f0fdd63`, `0f92c32`) exist in git history.

---
*Phase: 02-level-player-movement-input*
*Completed: 2026-07-24*
