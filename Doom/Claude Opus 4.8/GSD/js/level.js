/*
 * level.js — the hand-designed grid level: authored source, parser, wall-ID to
 * texture table, marker tables, derived landmarks and the grid query API.
 *
 * LOAD ORDER: loaded AFTER js/preview.js and BEFORE js/main.js (see index.html).
 * This file has NO hard load-order dependency of its own: it reads `Textures.map`
 * lazily, inside the accessor bodies, so it parses and builds correctly even if
 * textures.js had not run yet. Keeping it late in the list is purely so the
 * documented chain stays "assets first, world second, entry point last".
 *
 * PURITY: pure data plus synchronous parsing — no DOM, no canvas, no timers, no
 * I/O. That is what lets the Node harnesses under tools/ run this exact file
 * unchanged inside a vm sandbox.
 *
 * THE LEVEL CONTRACTS (Phase 3's wall pass and Phase 5's spawner stand on these):
 *
 *   (1) FLAT WALL-ID GRID. `Level.cells` is a Uint8Array addressed row-major as
 *       `my * Level.WIDTH + mx`. Value 0 unambiguously means "no wall" (open
 *       floor); 1..5 are wall material IDs.
 *
 *   (2) FORCED SOLID BORDER. The whole outer ring is overwritten with the stone
 *       ID AFTER the character pass, and every row is padded/truncated to WIDTH.
 *       A ragged or mistyped hand-edit therefore cannot open a hole to the
 *       outside world. `Level.isSolid` additionally returns true for every
 *       out-of-bounds coordinate, so a grid query fails closed.
 *
 *   (3) WALL-ID -> TEXTURE TABLE AS DATA. `Level.WALL_TEXTURES` is a real array
 *       (index 0 === null) whose entries are keys of `Textures.map`. Phase 3
 *       consumes the table; it never re-derives a naming convention.
 *
 *   (4) MARKERS ARE NOT WALLS. Player/enemy/pickup/exit markers are parsed OUT
 *       of the grid into `Level.playerStart` and `Level.spawns`, leaving those
 *       cells as plain floor. Phase 5 reads `Level.spawns`.
 *
 *   (5) LANDMARKS ARE DERIVED. `Level.LANDMARKS` is recomputed from the parsed
 *       cells on every build(), never hardcoded, so it can never drift from the
 *       map. Plan 02's and Plan 03's motion harnesses anchor their wall-relative
 *       assertions on these named features.
 */

var Level = {

  // ---------------------------------------------------------------------------
  // AUTHORED SOURCE (D-02) — one string per grid row, authored for readability.
  // 24 rows of 24 characters. Layout:
  //
  //   . west start room (rows 1-8, cols 1-8) with a brick pillar
  //   . north-east hall (rows 1-7, cols 13-22) with two tech pillars
  //   . south chamber   (rows 15-22, cols 3-14) with a brick pillar
  //   . an east-west link along row 4 flanked by a door-faced entry
  //   . a one-cell north-south corridor down col 4 (start room -> south chamber)
  //   . a one-cell north-south corridor down col 18 (hall -> row-17 link)
  //   . a dead-end alcove at (19,20) faced with the exit material
  //
  // The border characters here are cosmetic only: build() forces the outer ring
  // solid regardless of what these rows say.
  // ---------------------------------------------------------------------------
  SOURCE: [
    '########################', //  0
    '#........####..........#', //  1
    '#.P......####.m.....E..#', //  2
    '#........+###....=.....#', //  3
    '#...............E......#', //  4
    '#........+###.......=..#', //  5
    '#.....%..####..........#', //  6
    '#....h...####..........#', //  7
    '#........########=.=####', //  8
    '####.############=.=####', //  9
    '####.############=.=####', // 10
    '####.############=.=####', // 11
    '####.############=.=####', // 12
    '####.############=.=####', // 13
    '###%.%%%%%%%%%%##=.=####', // 14
    '###............##=.=####', // 15
    '###............##=.=####', // 16
    '###................#####', // 17
    '###...E.%......#########', // 18
    '###.......g....####!!###', // 19
    '###................X!###', // 20
    '###.........r..####!!###', // 21
    '###............#########', // 22
    '########################'  // 23
  ],

  // ---------------------------------------------------------------------------
  // LEGEND — data, not literals scattered through the parser.
  // ---------------------------------------------------------------------------

  // Wall character -> wall ID. IDs index WALL_TEXTURES.
  WALL_CHARS: {
    '#': 1, // stone
    '%': 2, // brick
    '=': 3, // tech
    '+': 4, // door
    '!': 5  // exit
  },

  // Characters meaning open floor. A period and a space, so a row can be spaced
  // out for readability without changing its meaning.
  FLOOR_CHARS: '. ',

  // Marker character -> spawn type string. A marker cell is FLOOR: the marker is
  // metadata ABOUT the cell, never a wall (D-04).
  MARKER_CHARS: {
    'P': 'player',
    'E': 'enemy',
    'h': 'health',
    'r': 'armor',
    'm': 'ammo',
    'g': 'shotgun',
    'X': 'exit'
  },

  // WALL-ID -> TEXTURE NAME TABLE (D-03). Index 0 is null: "no wall". Indices
  // 1..5 are keys of Textures.map (built by js/textures.js).
  WALL_TEXTURES: [null, 'stone', 'brick', 'tech', 'door', 'exit'],

  // The material the border is forced to, and the value returned for every
  // out-of-bounds query.
  STONE_CHAR: '#',
  STONE_ID: 1,

  // Facing applied to the player start marker. A unit vector; default east.
  START_FACING: { x: 1, y: 0 },

  // ---------------------------------------------------------------------------
  // PARSE OUTPUT — all of it (re)written by build().
  // ---------------------------------------------------------------------------
  WIDTH: 0,
  HEIGHT: 0,
  cells: null,         // Uint8Array(WIDTH*HEIGHT), row-major wall IDs
  playerStart: null,   // {x, y, mx, my, dirX, dirY}
  spawns: [],          // [{type, x, y, mx, my}] — consumed by Phase 5
  warnings: [],        // descriptive strings; the shipped map must produce none
  LANDMARKS: { openCell: null, wallFaceEast: null, corridorCell: null },
  built: false
};

(function () {
  'use strict';

  // ===========================================================================
  // BUILD — parse SOURCE into cells, force the border, extract markers, derive
  // landmarks. Idempotent: calling it twice produces byte-identical cells and
  // does not grow any table.
  // ===========================================================================
  Level.build = function () {
    var src = Level.SOURCE;
    var H = src.length;
    var W = 0;
    var i, mx, my, idx, ch;

    // WIDTH is the LONGEST row: short rows are padded, and the `mx < W` loop
    // bound structurally truncates anything past it. Either way the grid stays
    // a perfect rectangle no matter how ragged the hand-edit was (D-02).
    for (i = 0; i < H; i++) {
      if (src[i].length > W) W = src[i].length;
    }

    Level.WIDTH = W;
    Level.HEIGHT = H;

    var cells = new Uint8Array(W * H);
    Level.cells = cells;
    Level.warnings = [];
    Level.spawns = [];
    Level.playerStart = null;

    var stone = Level.STONE_ID;
    var pad = Level.STONE_CHAR;
    var wallChars = Level.WALL_CHARS;
    var markerChars = Level.MARKER_CHARS;
    var floorChars = Level.FLOOR_CHARS;
    var has = function (obj, key) {
      return Object.prototype.hasOwnProperty.call(obj, key);
    };

    // --- character pass -----------------------------------------------------
    for (my = 0; my < H; my++) {
      var row = src[my];
      for (mx = 0; mx < W; mx++) {
        ch = (mx < row.length) ? row.charAt(mx) : pad;
        idx = my * W + mx;

        if (has(wallChars, ch)) {
          cells[idx] = wallChars[ch];
        } else if (floorChars.indexOf(ch) >= 0) {
          cells[idx] = 0;
        } else if (has(markerChars, ch)) {
          // A marker leaves plain floor behind and is recorded separately.
          cells[idx] = 0;
          var type = markerChars[ch];
          if (type === 'player') {
            if (Level.playerStart) {
              Level.warnings.push(
                'duplicate player start marker at (' + mx + ',' + my + ') ignored'
              );
            } else {
              Level.playerStart = {
                x: mx + 0.5,
                y: my + 0.5,
                mx: mx,
                my: my,
                dirX: Level.START_FACING.x,
                dirY: Level.START_FACING.y
              };
            }
          } else {
            Level.spawns.push({
              type: type,
              x: mx + 0.5,
              y: my + 0.5,
              mx: mx,
              my: my
            });
          }
        } else {
          cells[idx] = 0;
          Level.warnings.push(
            'unrecognised map character "' + ch + '" at (' + mx + ',' + my +
            ') treated as floor'
          );
        }
      }
    }

    // --- forced border (D-02) ----------------------------------------------
    // Runs LAST, unconditionally, so no authored character and no ragged row can
    // leave a gap. This is the structural reason the player cannot leave.
    for (mx = 0; mx < W; mx++) {
      cells[mx] = stone;
      cells[(H - 1) * W + mx] = stone;
    }
    for (my = 0; my < H; my++) {
      cells[my * W] = stone;
      cells[my * W + (W - 1)] = stone;
    }

    // --- markers that the forced border just buried -------------------------
    // A marker authored on (or padded into) the outer ring would now sit inside
    // solid rock. Drop it loudly rather than handing Phase 5 an unreachable
    // spawn point.
    var kept = [];
    for (i = 0; i < Level.spawns.length; i++) {
      var sp = Level.spawns[i];
      if (cells[sp.my * W + sp.mx] === 0) {
        kept.push(sp);
      } else {
        Level.warnings.push(
          'marker "' + sp.type + '" at (' + sp.mx + ',' + sp.my +
          ') fell inside a forced-solid cell and was dropped'
        );
      }
    }
    Level.spawns = kept;

    if (!Level.playerStart) {
      Level.warnings.push('no player start marker ("P") in the map source');
    } else if (cells[Level.playerStart.my * W + Level.playerStart.mx] !== 0) {
      Level.warnings.push(
        'player start at (' + Level.playerStart.mx + ',' + Level.playerStart.my +
        ') fell inside a forced-solid cell'
      );
      Level.playerStart = null;
    }

    // --- landmarks (derived, never hardcoded) -------------------------------
    Level.LANDMARKS = {
      openCell: deriveOpenCell(),
      wallFaceEast: deriveWallFaceEast(),
      corridorCell: deriveCorridorCell()
    };
    if (!Level.LANDMARKS.openCell) {
      Level.warnings.push(
        'LANDMARKS.openCell could not be derived: no 5x5 block of contiguous ' +
        'floor exists in the map'
      );
    }
    if (!Level.LANDMARKS.wallFaceEast) {
      Level.warnings.push(
        'LANDMARKS.wallFaceEast could not be derived: no floor cell has a solid ' +
        '+x neighbour and a floor -x neighbour'
      );
    }
    if (!Level.LANDMARKS.corridorCell) {
      Level.warnings.push(
        'LANDMARKS.corridorCell could not be derived: no one-cell-wide corridor ' +
        'cell with two cells of slide room exists'
      );
    }

    Level.built = true;
    return Level;
  };

  // ===========================================================================
  // LANDMARK DERIVATION — every scan is row-major and takes the FIRST match, so
  // the result is deterministic for a given map.
  // ===========================================================================

  // The centre of a 5x5 block of all-floor cells: an anchor with a clear cell of
  // room in every direction.
  function deriveOpenCell() {
    var W = Level.WIDTH, H = Level.HEIGHT;
    for (var my = 2; my < H - 2; my++) {
      for (var mx = 2; mx < W - 2; mx++) {
        var ok = true;
        for (var oy = -2; oy <= 2 && ok; oy++) {
          for (var ox = -2; ox <= 2; ox++) {
            if (Level.cellAt(mx + ox, my + oy) !== 0) { ok = false; break; }
          }
        }
        if (ok) return { mx: mx, my: my, x: mx + 0.5, y: my + 0.5 };
      }
    }
    return null;
  }

  // A floor cell whose +x neighbour is solid and whose -x neighbour is floor.
  // `wf` is the world x coordinate of the WALL FACE itself — the plane a
  // no-tunneling test drives the player into. `x` stands half a cell short of it
  // on the open side; `y` is centred in the row so a sub-0.5 collision radius
  // cannot straddle a neighbouring row.
  function deriveWallFaceEast() {
    var W = Level.WIDTH, H = Level.HEIGHT;
    for (var my = 0; my < H; my++) {
      for (var mx = 0; mx < W; mx++) {
        if (Level.cellAt(mx, my) !== 0) continue;
        if (!Level.isSolid(mx + 1, my)) continue;
        if (Level.isSolid(mx - 1, my)) continue;
        var wf = mx + 1;
        return { mx: mx, my: my, x: wf - 0.5, y: my + 0.5, wf: wf };
      }
    }
    return null;
  }

  // A one-cell-wide corridor cell: both neighbours along `blockedAxis` are
  // solid, and there are at least two further floor cells continuing along
  // `slideDir`. Guaranteed blocked axis + guaranteed room to slide.
  function deriveCorridorCell() {
    var W = Level.WIDTH, H = Level.HEIGHT;
    var my, mx;

    // Pass 1 — x-blocked (the common vertical corridor), slide along y.
    for (my = 0; my < H; my++) {
      for (mx = 0; mx < W; mx++) {
        if (Level.cellAt(mx, my) !== 0) continue;
        if (!Level.isSolid(mx - 1, my) || !Level.isSolid(mx + 1, my)) continue;
        var dy = 0;
        if (Level.cellAt(mx, my + 1) === 0 && Level.cellAt(mx, my + 2) === 0) dy = 1;
        else if (Level.cellAt(mx, my - 1) === 0 && Level.cellAt(mx, my - 2) === 0) dy = -1;
        if (dy === 0) continue;
        return {
          mx: mx, my: my, x: mx + 0.5, y: my + 0.5,
          blockedAxis: 'x',
          slideDir: { x: 0, y: dy }
        };
      }
    }

    // Pass 2 (mirror image) — y-blocked horizontal corridor, slide along x.
    for (my = 0; my < H; my++) {
      for (mx = 0; mx < W; mx++) {
        if (Level.cellAt(mx, my) !== 0) continue;
        if (!Level.isSolid(mx, my - 1) || !Level.isSolid(mx, my + 1)) continue;
        var dx = 0;
        if (Level.cellAt(mx + 1, my) === 0 && Level.cellAt(mx + 2, my) === 0) dx = 1;
        else if (Level.cellAt(mx - 1, my) === 0 && Level.cellAt(mx - 2, my) === 0) dx = -1;
        if (dx === 0) continue;
        return {
          mx: mx, my: my, x: mx + 0.5, y: my + 0.5,
          blockedAxis: 'y',
          slideDir: { x: dx, y: 0 }
        };
      }
    }

    return null;
  }

  // ===========================================================================
  // QUERY API — integer CELL coordinates. Callers floor world coordinates first.
  // ===========================================================================

  // Wall ID at a cell. Any out-of-bounds (or NaN) coordinate reads back as
  // stone, so an unguarded index can never masquerade as open floor. The `!(a >=
  // b)` form is deliberate: it catches NaN, which `a < b` would not.
  Level.cellAt = function (mx, my) {
    var cells = Level.cells;
    if (!cells) return Level.STONE_ID;
    if (!(mx >= 0) || !(my >= 0)) return Level.STONE_ID;
    if (!(mx < Level.WIDTH) || !(my < Level.HEIGHT)) return Level.STONE_ID;
    return cells[my * Level.WIDTH + mx];
  };

  // TRUE for every solid cell AND for every coordinate outside the grid. This
  // single guard is what keeps Plan 02's collision resolver from ever letting
  // the player leave the world.
  Level.isSolid = function (mx, my) {
    return Level.cellAt(mx, my) > 0;
  };

  // ===========================================================================
  // LINE OF SIGHT — a grid DDA march in WORLD coordinates.
  //
  // Returns true when no solid cell lies STRICTLY BETWEEN the two points: the
  // two endpoint cells themselves are never tested, so a shot fired from inside
  // a doorway at a target standing in another doorway still connects.
  //
  // This is deliberately the same traversal shape Phase 3's wall pass and Phase
  // 5's hitscan will use — one technique learned once:
  //   deltaDist  = |1 / rayDir| per axis  (how far along the ray one whole cell
  //                of that axis costs). A ZERO direction component substitutes a
  //                large FINITE constant instead of relying on Infinity
  //                arithmetic, which would produce NaN when multiplied by a zero
  //                fractional offset.
  //   sideDist   = distance from the start point to the first grid line on each
  //                axis, seeded from the fractional position inside the start
  //                cell.
  //   step       = advance whichever axis has the smaller sideDist.
  //
  // TERMINATION IS STRUCTURAL (threat T-02-03): the march is capped at
  // WIDTH + HEIGHT + 2 steps — more than the longest possible grid traversal —
  // and returns false if the cap is ever exhausted, so no input can spin it.
  // ===========================================================================

  // Stand-in for 1/0. Large enough that a zero-direction axis is never the
  // smaller sideDist, finite enough that 0 * BIG is 0 rather than NaN.
  var LOS_BIG = 1e30;

  Level.lineOfSight = function (x0, y0, x1, y1) {
    var mapX = Math.floor(x0);
    var mapY = Math.floor(y0);
    var destX = Math.floor(x1);
    var destY = Math.floor(y1);

    // Degenerate case: both points inside the same cell. Nothing can be strictly
    // between them.
    if (mapX === destX && mapY === destY) return true;

    var rayX = x1 - x0;
    var rayY = y1 - y0;

    var deltaX = (rayX === 0) ? LOS_BIG : Math.abs(1 / rayX);
    var deltaY = (rayY === 0) ? LOS_BIG : Math.abs(1 / rayY);

    var stepX, stepY, sideX, sideY;
    if (rayX < 0) { stepX = -1; sideX = (x0 - mapX) * deltaX; }
    else { stepX = 1; sideX = (mapX + 1 - x0) * deltaX; }
    if (rayY < 0) { stepY = -1; sideY = (y0 - mapY) * deltaY; }
    else { stepY = 1; sideY = (mapY + 1 - y0) * deltaY; }

    var cap = Level.WIDTH + Level.HEIGHT + 2;
    for (var i = 0; i < cap; i++) {
      if (sideX < sideY) { sideX += deltaX; mapX += stepX; }
      else { sideY += deltaY; mapY += stepY; }

      // Reaching the destination cell wins BEFORE the solidity test, which is
      // what makes "strictly between" true even when the target stands in a
      // doorway.
      if (mapX === destX && mapY === destY) return true;
      if (Level.isSolid(mapX, mapY)) return false;
    }
    return false;
  };

  // ===========================================================================
  // WALL-ID -> TEXTURE RESOLUTION (D-03). Textures.map is read lazily so this
  // file carries no load-order dependency on textures.js.
  // ===========================================================================

  Level.textureNameFor = function (id) {
    var name = Level.WALL_TEXTURES[id];
    return (typeof name === 'string') ? name : null;
  };

  Level.textureFor = function (id) {
    var name = Level.textureNameFor(id);
    if (name === null) return null;
    if (typeof Textures === 'undefined' || !Textures.map) return null;
    var tex = Textures.map[name];
    return tex ? tex : null;
  };

  // Returns [] when every wall ID resolves to a real texture. Any element is a
  // {id, name} pair whose texture is missing from Textures.map.
  Level.validateTextures = function () {
    var missing = [];
    for (var id = 1; id < Level.WALL_TEXTURES.length; id++) {
      var name = Level.WALL_TEXTURES[id];
      if (typeof name !== 'string') { missing.push({ id: id, name: name }); continue; }
      if (typeof Textures === 'undefined' || !Textures.map || !Textures.map[name]) {
        missing.push({ id: id, name: name });
      }
    }
    return missing;
  };

})();
