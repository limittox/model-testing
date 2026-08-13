'use strict';

/* The map is authored as ASCII. Wall glyphs become texture ids, everything
   else becomes a spawn record that entities.js turns into a real thing. */
var LEVEL = (function () {

  var MAP = [
    '################################',
    '#......p.....#........#........#',
    '#............#........#........#',
    '#...#####....D...c....#....a...#',
    '#...#...#....#........#........#',
    '#...#.h.#....#........D........#',
    '#...#...#....#........#........#',
    '#...#.###....#........#........#',
    '#............#........#...c....#',
    '#....1.......#....2...#...s....#',
    '#............#........#........#',
    '######D############D############',
    '#....h........................h#',
    '#..........c.##....##.....c....#',
    '#....S..1....##....##..........#',
    '#............##....##...3......#',
    '#..#######...##....##....1.....#',
    '#..#.....#...##....##..###M###.#',
    '#..#.HC..D...##....##..#..k..#.#',
    '#..#.....#...##....##..#.....#.#',
    '#..#######...##....##..###D###.#',
    '#..c.........##....##....s.....#',
    '#............##....##....2.....#',
    '#..............................#',
    '###############RR###############',
    '#B............................B#',
    '#B............................B#',
    '#B...3.....2....4.....2...3...B#',
    '#B............................B#',
    '#B......a........H.....s......B#',
    '#B.........XXXXXX.............B#',
    '################################'
  ];

  /* glyph -> wall texture index (see TEX.build) */
  var WALLS = { '#': 1, '=': 2, 'B': 3, 'M': 4, 'W': 5, 'X': 6, 'D': 7, 'R': 8 };

  /* glyph -> spawn record */
  var THINGS = {
    '1': { kind: 'enemy', what: 'zombie' },
    '2': { kind: 'enemy', what: 'imp' },
    '3': { kind: 'enemy', what: 'demon' },
    '4': { kind: 'enemy', what: 'baron' },
    'h': { kind: 'item', what: 'healthBonus' },
    'H': { kind: 'item', what: 'medkit' },
    'a': { kind: 'item', what: 'armor' },
    'c': { kind: 'item', what: 'clip' },
    's': { kind: 'item', what: 'shells' },
    'k': { kind: 'item', what: 'redkey' },
    'S': { kind: 'item', what: 'shotgun' },
    'C': { kind: 'item', what: 'chaingun' }
  };

  var W = 0, H = 0;
  var grid = null;        // wall texture id, 0 = open floor
  var doors = null;       // parallel array: door object or null
  var isExit = null;      // Uint8Array flag
  var zone = null;        // 0 = base, 1 = the blood arena
  var doorList = [];
  var things = [];
  var start = { x: 2.5, y: 2.5, ang: 0 };
  var exitTriggered = false;

  function idx(x, y) { return y * W + x; }

  function parse() {
    H = MAP.length;
    W = MAP[0].length;
    for (var r = 0; r < H; r++) {
      if (MAP[r].length !== W) {
        throw new Error('LEVEL: row ' + r + ' is ' + MAP[r].length + ' chars, expected ' + W);
      }
    }

    grid = new Uint8Array(W * H);
    doors = new Array(W * H);
    isExit = new Uint8Array(W * H);
    zone = new Uint8Array(W * H);
    doorList.length = 0;
    things.length = 0;
    exitTriggered = false;

    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var ch = MAP[y][x];
        var i = idx(x, y);
        zone[i] = y >= 24 ? 1 : 0;

        if (WALLS[ch] !== undefined) {
          grid[i] = WALLS[ch];
          if (ch === 'X') isExit[i] = 1;
          if (ch === 'D' || ch === 'R') {
            var d = {
              x: x, y: y, open: 0, state: 'closed', hold: 0,
              locked: ch === 'R' ? 'red' : null,
              // a door in a north/south wall run slides along X, and vice versa
              tex: ch === 'R' ? 8 : 7
            };
            doors[i] = d;
            doorList.push(d);
          }
          continue;
        }

        if (ch === 'p') {
          start.x = x + 0.5; start.y = y + 0.5; start.ang = 0.0;
        } else if (THINGS[ch]) {
          things.push({ kind: THINGS[ch].kind, what: THINGS[ch].what, x: x + 0.5, y: y + 0.5 });
        }
      }
    }

    groupDoors();
  }

  /* A run of adjacent door tiles is one door, the way a Doom door is one
     sector. Without this, opening half of a two-tile doorway still leaves the
     other half solid, and the player's collision circle catches on it. */
  function groupDoors() {
    for (var i = 0; i < doorList.length; i++) doorList[i].group = null;
    for (var j = 0; j < doorList.length; j++) {
      var seed = doorList[j];
      if (seed.group) continue;
      var group = [];
      var stack = [seed];
      seed.group = group;
      while (stack.length) {
        var d = stack.pop();
        group.push(d);
        var n = [doorAt(d.x + 1, d.y), doorAt(d.x - 1, d.y),
                 doorAt(d.x, d.y + 1), doorAt(d.x, d.y - 1)];
        for (var k = 0; k < 4; k++) {
          var o = n[k];
          if (!o || o.group || o.locked !== d.locked) continue;
          o.group = group;
          stack.push(o);
        }
      }
    }
  }

  function tileAt(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return 1;
    return grid[idx(x, y)];
  }

  function doorAt(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return null;
    return doors[idx(x, y)];
  }

  /* Blocks movement / sight. A door only stops being solid once it is most
     of the way open, which matches how it renders. */
  function solid(x, y) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= W || y >= H) return true;
    var i = idx(x, y);
    if (grid[i] === 0) return false;
    var d = doors[i];
    if (d) return d.open < 0.78;
    return true;
  }

  /* Circle-vs-grid test used by every moving thing. */
  function blocked(px, py, r) {
    var x0 = Math.floor(px - r), x1 = Math.floor(px + r);
    var y0 = Math.floor(py - r), y1 = Math.floor(py + r);
    for (var y = y0; y <= y1; y++)
      for (var x = x0; x <= x1; x++)
        if (solid(x, y)) return true;
    return false;
  }

  /* Slide-along-walls movement: try both axes, then each separately. */
  function moveWithCollision(ent, dx, dy, r) {
    if (!blocked(ent.x + dx, ent.y, r)) ent.x += dx;
    if (!blocked(ent.x, ent.y + dy, r)) ent.y += dy;
  }

  /* Grid-marched line of sight, ignoring open doors. */
  function lineOfSight(x0, y0, x1, y1) {
    var dx = x1 - x0, dy = y1 - y0;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.001) return true;
    var steps = Math.ceil(dist * 8);
    var sx = dx / steps, sy = dy / steps;
    var x = x0, y = y0;
    for (var i = 0; i < steps; i++) {
      x += sx; y += sy;
      if (solid(x, y)) return false;
    }
    return true;
  }

  /* Called when the player presses Use facing a wall tile. */
  function activate(x, y, player, onMessage) {
    var i = idx(x, y);
    if (x < 0 || y < 0 || x >= W || y >= H) return false;

    if (isExit[i]) {
      exitTriggered = true;
      Sound.play('exit');
      return true;
    }

    var d = doors[i];
    if (!d) return false;

    if (d.locked === 'red' && !player.keys.red) {
      onMessage('YOU NEED A RED KEYCARD TO OPEN THIS DOOR');
      Sound.play('locked');
      return true;
    }
    var group = d.group || [d];
    var announced = false;
    for (var g = 0; g < group.length; g++) {
      var leaf = group[g];
      if (leaf.state === 'closed' || leaf.state === 'closing') {
        leaf.state = 'opening';
        announced = true;
      }
      leaf.hold = 4.5;
    }
    if (announced) Sound.play('doorOpen');
    return true;
  }

  function update(dt, blockers) {
    for (var i = 0; i < doorList.length; i++) {
      var d = doorList[i];
      if (d.state === 'opening') {
        d.open += dt * 1.6;
        if (d.open >= 1) { d.open = 1; d.state = 'open'; d.hold = 4.5; }
      } else if (d.state === 'open') {
        d.hold -= dt;
        if (d.hold <= 0 && !occupied(d, blockers)) {
          d.state = 'closing';
          // one sound for the whole doorway, not one per leaf
          if (!d.group || d.group[0] === d) Sound.play('doorClose');
        }
      } else if (d.state === 'closing') {
        d.open -= dt * 1.2;
        if (occupied(d, blockers)) { d.state = 'opening'; }
        if (d.open <= 0) { d.open = 0; d.state = 'closed'; }
      }
    }
  }

  /* Don't crush anything standing anywhere in the doorway. */
  function occupied(d, blockers) {
    var group = d.group || [d];
    for (var i = 0; i < blockers.length; i++) {
      var b = blockers[i];
      if (b.dead) continue;
      var bx = Math.floor(b.x), by = Math.floor(b.y);
      for (var g = 0; g < group.length; g++) {
        if (bx === group[g].x && by === group[g].y) return true;
      }
    }
    return false;
  }

  /* Raw arrays for the renderer's inner loops -- a property read beats a
     function call several hundred thousand times per frame. */
  function arrays() {
    return { grid: grid, doors: doors, zone: zone, W: W, H: H };
  }

  return {
    parse: parse,
    arrays: arrays,
    get W() { return W; },
    get H() { return H; },
    grid: function () { return grid; },
    tileAt: tileAt,
    doorAt: doorAt,
    isExitAt: function (x, y) {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      return isExit[idx(x, y)] === 1;
    },
    zoneAt: function (x, y) {
      if (x < 0 || y < 0 || x >= W || y >= H) return 0;
      return zone[idx(x, y)];
    },
    solid: solid,
    blocked: blocked,
    moveWithCollision: moveWithCollision,
    lineOfSight: lineOfSight,
    activate: activate,
    update: update,
    things: function () { return things; },
    start: function () { return start; },
    exitReached: function () { return exitTriggered; },
    doorList: function () { return doorList; }
  };
})();
