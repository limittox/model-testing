/*
 * tools/verify-level.cjs — the level contract harness.
 *
 * NODE-ONLY (never referenced by index.html). Boots config + framebuffer +
 * textures + level through tools/boot.cjs — i.e. the REAL shipped files in the
 * REAL shipped order — builds the textures and the level, and proves every
 * contract Plans 02/03 and Phases 3/5 are about to stand on.
 *
 * Run:  node "tools/verify-level.cjs"
 * Pass: prints ALL_LEVEL_CONTRACTS_PASS and exits 0.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { boot, assert, finish, GAME_DIR } = require('./boot.cjs');

const harness = boot({ only: ['config', 'framebuffer', 'textures', 'level'] });
const Level = harness.sandbox.Level;
const Textures = harness.sandbox.Textures;

Textures.build();
Level.build();

const W = Level.WIDTH;
const H = Level.HEIGHT;
const idx = (mx, my) => my * Level.WIDTH + mx;

console.log('--- level contract harness ---');
console.log('grid ' + W + 'x' + H + ', ' + Level.cells.length + ' cells, ' +
  Level.spawns.length + ' spawns, ' + Level.warnings.length + ' warnings');
console.log('');

// ===========================================================================
// 1. Dimensions
// ===========================================================================
assert(W >= 20 && W <= 32, '1a. WIDTH ' + W + ' is within [20,32]');
assert(H >= 20 && H <= 32, '1b. HEIGHT ' + H + ' is within [20,32]');
// `instanceof` is useless across a vm realm boundary (the sandbox has its own
// Uint8Array), so brand-check instead.
assert(Object.prototype.toString.call(Level.cells) === '[object Uint8Array]',
  '1c. cells is a Uint8Array');
assert(Level.cells.length === W * H,
  '1d. cells.length ' + Level.cells.length + ' === WIDTH*HEIGHT');

// ===========================================================================
// 2. Zero warnings — every authored character is in the legend
// ===========================================================================
assert(Level.warnings.length === 0,
  '2. shipped map parses with zero warnings' +
  (Level.warnings.length ? ' [' + Level.warnings.join(' | ') + ']' : ''));

// ===========================================================================
// 3. Border solid
// ===========================================================================
function borderIsSolid() {
  for (let mx = 0; mx < W; mx++) {
    if (!Level.isSolid(mx, 0)) return 'top col ' + mx;
    if (!Level.isSolid(mx, H - 1)) return 'bottom col ' + mx;
  }
  for (let my = 0; my < H; my++) {
    if (!Level.isSolid(0, my)) return 'left row ' + my;
    if (!Level.isSolid(W - 1, my)) return 'right row ' + my;
  }
  return null;
}
assert(borderIsSolid() === null, '3. every cell of the outer ring is solid');

// ===========================================================================
// 4. Border is FORCED, not merely authored
//    Deliberately hole the top row and the left column, and truncate an
//    interior row to half length. The border must come back solid anyway and
//    the grid must stay a perfect rectangle (D-02 / threat T-02-01).
// ===========================================================================
function setChar(str, i, ch) {
  return str.slice(0, i) + ch + str.slice(i + 1);
}

const originalSource = Level.SOURCE.slice();
const midX = Math.floor(W / 2);
const midY = Math.floor(H / 2);
const truncRow = 3;

const sabotaged = originalSource.slice();
sabotaged[0] = setChar(sabotaged[0], midX, '.');              // hole in the top row
sabotaged[midY] = setChar(sabotaged[midY], 0, '.');           // hole in the left column
sabotaged[H - 1] = setChar(sabotaged[H - 1], midX, '.');      // hole in the bottom row
sabotaged[midY + 1] = setChar(sabotaged[midY + 1], W - 1, '.'); // hole in the right column
const truncLen = Math.floor(W / 2);
sabotaged[truncRow] = sabotaged[truncRow].slice(0, truncLen); // ragged interior row

Level.SOURCE = sabotaged;
Level.build();

assert(borderIsSolid() === null,
  '4a. border is STILL fully solid after punching holes in all four sides');
assert(Level.WIDTH === W && Level.HEIGHT === H,
  '4b. dimensions unchanged by a ragged row (' + Level.WIDTH + 'x' + Level.HEIGHT + ')');
assert(Level.cells.length === W * H,
  '4c. cells.length is still WIDTH*HEIGHT after a truncated row');
let raggedFilled = true;
for (let mx = truncLen; mx < W; mx++) {
  if (!Level.isSolid(mx, truncRow)) { raggedFilled = false; break; }
}
assert(raggedFilled,
  '4d. the truncated row\'s missing cells (' + truncLen + '..' + (W - 1) + ') came back solid');

// Restore and rebuild — every later assertion sees the SHIPPED map.
Level.SOURCE = originalSource;
Level.build();
assert(Level.warnings.length === 0 && Level.cells.length === W * H,
  '4e. original source restored and rebuilt clean');

// ===========================================================================
// 5. Out of bounds is solid (threat T-02-02 — the query fails closed)
// ===========================================================================
const oob = [
  [-1, 5], [W, 5], [5, -1], [5, H],
  [-1, -1], [W, H], [-999999, 5], [999999, 5], [5, -999999], [5, 999999]
];
let oobSolid = true;
for (const [mx, my] of oob) if (!Level.isSolid(mx, my)) { oobSolid = false; break; }
assert(oobSolid, '5a. isSolid is true for all four sides and large magnitudes outside the grid');
assert(Level.cellAt(-1, -1) === Level.STONE_ID && Level.cellAt(W, H) === Level.STONE_ID,
  '5b. cellAt returns the stone ID out of bounds');
assert(Level.isSolid(NaN, 3) && Level.isSolid(3, NaN),
  '5c. a NaN coordinate also fails closed (solid)');

// ===========================================================================
// 6. Wall-ID -> texture table is real data (D-03)
// ===========================================================================
assert(Level.WALL_TEXTURES[0] === null, '6a. WALL_TEXTURES[0] is null (0 means NO WALL)');
assert(Level.textureFor(0) === null, '6b. textureFor(0) is null');

let tableOk = true;
const tableReport = [];
for (let id = 1; id <= 5; id++) {
  const name = Level.WALL_TEXTURES[id];
  const tex = Level.textureFor(id);
  const ok = typeof name === 'string' &&
    Object.prototype.hasOwnProperty.call(Textures.map, name) &&
    tex && tex.width === 64 && tex.height === 64 && tex.buf32.length === 4096;
  if (!ok) tableOk = false;
  tableReport.push(id + '->' + name);
}
assert(tableOk, '6c. IDs 1..5 (' + tableReport.join(', ') +
  ') each resolve to a real 64x64 Textures.map entry with buf32.length 4096');
assert(Level.textureNameFor(3) === 'tech' && Level.textureNameFor(0) === null,
  '6d. textureNameFor returns the name for a wall ID and null for 0');
const missing = Level.validateTextures();
assert(Array.isArray(missing) && missing.length === 0,
  '6e. validateTextures() returns [] — the table is fully wired');

// ===========================================================================
// 7. Material coverage (LVL-01)
// ===========================================================================
const idCounts = new Array(6).fill(0);
for (let i = 0; i < Level.cells.length; i++) {
  const v = Level.cells[i];
  if (v >= 0 && v <= 5) idCounts[v] += 1;
}
let allMaterials = true;
for (let id = 1; id <= 5; id++) if (idCounts[id] < 1) allMaterials = false;
assert(allMaterials, '7a. every wall ID 1..5 occurs in the grid (counts: ' +
  idCounts.slice(1).map((c, i) => (i + 1) + ':' + c).join(' ') + ')');
let onlyKnownIds = true;
for (let i = 0; i < Level.cells.length; i++) {
  if (Level.cells[i] > 5) { onlyKnownIds = false; break; }
}
assert(onlyKnownIds, '7b. no cell holds an ID outside 0..5 (no marker char survived as a wall)');

// ===========================================================================
// 8. Markers parsed OUT of the grid (D-04)
// ===========================================================================
const ps = Level.playerStart;
assert(!!ps, '8a. playerStart exists');
assert(!!ps && ps.mx > 0 && ps.my > 0 && ps.mx < W - 1 && ps.my < H - 1,
  '8b. playerStart cell (' + (ps && ps.mx) + ',' + (ps && ps.my) + ') is inside the grid');
assert(!!ps && Level.cells[idx(ps.mx, ps.my)] === 0,
  '8c. the player start cell is plain FLOOR — the marker left no wall behind');
assert(!!ps && ps.x === ps.mx + 0.5 && ps.y === ps.my + 0.5,
  '8d. playerStart x/y (' + (ps && ps.x) + ',' + (ps && ps.y) + ') are the cell centre');
assert(!!ps && Math.abs(ps.dirX * ps.dirX + ps.dirY * ps.dirY - 1) < 1e-12,
  '8e. playerStart direction is a unit vector');

assert(Level.spawns.length >= 6,
  '8f. spawns.length ' + Level.spawns.length + ' >= 6');
const markerTypes = Object.keys(Level.MARKER_CHARS).map((k) => Level.MARKER_CHARS[k]);
let spawnTypesOk = true;
let spawnCellsFloor = true;
for (const sp of Level.spawns) {
  if (markerTypes.indexOf(sp.type) < 0) spawnTypesOk = false;
  if (Level.cells[idx(sp.mx, sp.my)] !== 0) spawnCellsFloor = false;
  if (sp.x !== sp.mx + 0.5 || sp.y !== sp.my + 0.5) spawnCellsFloor = false;
}
assert(spawnTypesOk, '8g. every spawn type is a value of MARKER_CHARS (' +
  Level.spawns.map((s) => s.type).join(',') + ')');
assert(spawnCellsFloor,
  '8h. every spawn cell is floor (value 0) and its x/y is the cell centre');
assert(Level.spawns.every((s) => s.type !== 'player'),
  '8i. the player marker is NOT in spawns — it lives in playerStart');

// ===========================================================================
// 8j-8o. THE LVL-02 POPULATION CENSUS (05-04, D-08).
//
//   These are EXACT equalities, not lower bounds. The marker set is the single
//   source of the level's difficulty AND of Game.totalKills, so a hand-edit that
//   silently drops or duplicates a marker has to fail HERE — loudly, in the level
//   harness — rather than surface two plans later as a kill tally that can never
//   be reached.
//
//   The population edit replaced FLOOR characters only, which is what keeps
//   Level.cells byte-identical and every wall-dependent contract intact (threat
//   T-05-23). 8m re-proves the "markers are not walls" half of that directly, and
//   verify-render / verify-motion are the independent check on the other half.
// ===========================================================================
const EXPECTED_ENEMIES = 8;
const EXPECTED_ITEMS = { health: 4, ammo: 3, armor: 1, shotgun: 1 };
const EXPECTED_EXITS = 1;
// No enemy may stand within this many cells of the player start (the player must
// not be shot at spawn), and no item within this many (an item under the player's
// feet at spawn is collected before they have moved).
const MIN_ENEMY_DIST = 3;
const MIN_ITEM_DIST = 2;

const census = {};
for (const sp of Level.spawns) census[sp.type] = (census[sp.type] || 0) + 1;
const censusText = Object.keys(census).sort().map((k) => k + ':' + census[k]).join(' ');

assert(census.enemy === EXPECTED_ENEMIES,
  '8j. LVL-02: exactly ' + EXPECTED_ENEMIES + ' ENEMY markers (' + census.enemy +
  ') — this number IS Game.totalKills');

const itemsOk = Object.keys(EXPECTED_ITEMS)
  .every((t) => census[t] === EXPECTED_ITEMS[t]);
const itemTotal = Object.keys(EXPECTED_ITEMS)
  .reduce((n, t) => n + (census[t] || 0), 0);
const itemExpectedTotal = Object.keys(EXPECTED_ITEMS)
  .reduce((n, t) => n + EXPECTED_ITEMS[t], 0);
assert(itemsOk && itemTotal === itemExpectedTotal,
  '8k. LVL-02: exactly ' + JSON.stringify(EXPECTED_ITEMS) + ' item markers, ' +
  itemExpectedTotal + ' in total (got ' + itemTotal + '; full census ' + censusText + ')');

assert(census.exit === EXPECTED_EXITS,
  '8l. the exit marker is still there and still unique (' + census.exit +
  ') — Phase 6 owns LVL-03/04, so this plan left it exactly where it was');

// Every marker cell — the player start included — must be open floor. This is the
// direct statement of "a marker replaced a floor character, never a wall".
let allFloor = Level.cells[idx(ps.mx, ps.my)] === 0;
for (const sp of Level.spawns) if (Level.cells[idx(sp.mx, sp.my)] !== 0) allFloor = false;
assert(allFloor,
  '8m. LVL-02: every one of the ' + (Level.spawns.length + 1) +
  ' marker cells (player start included) is OPEN FLOOR — no marker replaced a wall');

// No two markers share a cell. A doubled cell would be a silently swallowed
// marker: the second character wins the parse and the first item simply vanishes.
const cellKeys = [ps.mx + ',' + ps.my].concat(Level.spawns.map((sp) => sp.mx + ',' + sp.my));
const dupes = cellKeys.filter((k, i) => cellKeys.indexOf(k) !== i);
assert(dupes.length === 0,
  '8n. LVL-02: no two markers share a cell (' + cellKeys.length + ' distinct)' +
  (dupes.length ? ' [duplicated: ' + dupes.join(' ') + ']' : ''));

// Spacing from the player start, measured between cell CENTRES.
const dist = (sp) => Math.hypot(sp.x - ps.x, sp.y - ps.y);
const nearEnemies = Level.spawns
  .filter((sp) => sp.type === 'enemy' && dist(sp) < MIN_ENEMY_DIST)
  .map((sp) => '(' + sp.mx + ',' + sp.my + ')@' + dist(sp).toFixed(2));
const itemTypes = Object.keys(EXPECTED_ITEMS);
const nearItems = Level.spawns
  .filter((sp) => itemTypes.indexOf(sp.type) >= 0 && dist(sp) < MIN_ITEM_DIST)
  .map((sp) => '(' + sp.mx + ',' + sp.my + ')@' + dist(sp).toFixed(2));
const closestEnemy = Math.min.apply(null,
  Level.spawns.filter((sp) => sp.type === 'enemy').map(dist));
const closestItem = Math.min.apply(null,
  Level.spawns.filter((sp) => itemTypes.indexOf(sp.type) >= 0).map(dist));
assert(nearEnemies.length === 0,
  '8o. LVL-02: no enemy marker is within ' + MIN_ENEMY_DIST + ' cells of the player ' +
  'start (nearest ' + closestEnemy.toFixed(2) + ') — the player is not shot at spawn' +
  (nearEnemies.length ? ' [' + nearEnemies.join(' ') + ']' : ''));
assert(nearItems.length === 0,
  '8p. LVL-02: no item marker is within ' + MIN_ITEM_DIST + ' cells of the player ' +
  'start (nearest ' + closestItem.toFixed(2) + ')' +
  (nearItems.length ? ' [' + nearItems.join(' ') + ']' : ''));

// ===========================================================================
// 9. Rooms and corridors (LVL-01)
// ===========================================================================
function blocksOfSize(n) {
  const found = [];
  for (let my = 0; my <= H - n; my++) {
    for (let mx = 0; mx <= W - n; mx++) {
      let ok = true;
      for (let oy = 0; oy < n && ok; oy++) {
        for (let ox = 0; ox < n; ox++) {
          if (Level.cellAt(mx + ox, my + oy) !== 0) { ok = false; break; }
        }
      }
      if (ok) found.push([mx, my]);
    }
  }
  return found;
}
function greedyDisjoint(blocks, n) {
  const chosen = [];
  for (const b of blocks) {
    const clear = chosen.every((c) =>
      b[0] + n <= c[0] || c[0] + n <= b[0] || b[1] + n <= c[1] || c[1] + n <= b[1]);
    if (clear) chosen.push(b);
  }
  return chosen;
}
const rooms4 = greedyDisjoint(blocksOfSize(4), 4);
assert(rooms4.length >= 3, '9a. at least three mutually disjoint 4x4 all-floor rooms exist (' +
  rooms4.length + ' found: ' + rooms4.slice(0, 3).map((b) => '(' + b + ')').join(' ') + ')');
assert(blocksOfSize(5).length >= 1,
  '9b. at least one 5x5 block of contiguous floor exists (' + blocksOfSize(5).length + ')');

let narrowCells = 0;
let longRuns = 0;
for (let my = 0; my < H; my++) {
  for (let mx = 0; mx < W; mx++) {
    if (Level.cellAt(mx, my) !== 0) continue;
    const xBlocked = Level.isSolid(mx - 1, my) && Level.isSolid(mx + 1, my);
    const yBlocked = Level.isSolid(mx, my - 1) && Level.isSolid(mx, my + 1);
    if (xBlocked || yBlocked) narrowCells += 1;
    if (xBlocked && Level.cellAt(mx, my + 1) === 0 && Level.cellAt(mx, my + 2) === 0) longRuns += 1;
    if (yBlocked && Level.cellAt(mx + 1, my) === 0 && Level.cellAt(mx + 2, my) === 0) longRuns += 1;
  }
}
assert(narrowCells >= 1, '9c. at least one one-cell-wide corridor cell exists (' + narrowCells + ')');
assert(longRuns >= 1,
  '9d. at least one corridor runs 3+ cells along its open axis (' + longRuns + ' such cells)');

// A dead-end alcove faced with the exit material, for Phase 6's exit.
let exitAlcoves = 0;
for (let my = 0; my < H; my++) {
  for (let mx = 0; mx < W; mx++) {
    if (Level.cellAt(mx, my) !== 0) continue;
    const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => Level.cellAt(mx + dx, my + dy));
    if (n.filter((v) => v === 0).length === 1 && n.indexOf(5) >= 0) exitAlcoves += 1;
  }
}
assert(exitAlcoves >= 1, '9e. a dead-end alcove faced with the exit material exists (' + exitAlcoves + ')');

// ===========================================================================
// 10. Reachability — no sealed pocket
// ===========================================================================
const seen = new Set();
const stack = [idx(ps.mx, ps.my)];
seen.add(stack[0]);
while (stack.length) {
  const c = stack.pop();
  const cx = c % W;
  const cy = (c - cx) / W;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = cx + dx;
    const ny = cy + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    if (Level.isSolid(nx, ny)) continue;
    const ni = idx(nx, ny);
    if (!seen.has(ni)) { seen.add(ni); stack.push(ni); }
  }
}
let floorCells = 0;
const sealed = [];
for (let i = 0; i < Level.cells.length; i++) {
  if (Level.cells[i] !== 0) continue;
  floorCells += 1;
  if (!seen.has(i)) sealed.push('(' + (i % W) + ',' + ((i - (i % W)) / W) + ')');
}
assert(sealed.length === 0 && seen.size === floorCells,
  '10a. every one of the ' + floorCells + ' floor cells is walkable from the player start' +
  (sealed.length ? ' [sealed: ' + sealed.slice(0, 8).join(' ') + ']' : ''));
assert(Level.spawns.every((s) => seen.has(idx(s.mx, s.my))),
  '10b. every spawn cell is reachable from the player start');

// ---------------------------------------------------------------------------
// 10c / 10d — LVL-03: THE EXIT IS REACHABLE, ASSERTED BY NAME.
//
// 10b already covers it INCIDENTALLY (the exit is a spawn), but "the win
// condition is reachable" is a requirement in its own right and deserves to fail
// with its own name rather than inside a set-wide every(). 10d is the
// falsifiability control: the SAME helper, run against a map whose alcove mouth
// has been deliberately sealed, must report the exit UNREACHABLE. A reachability
// test that cannot report failure proves nothing.
// ---------------------------------------------------------------------------
function reachableFrom(sx, sy) {
  const found = new Set();
  if (Level.isSolid(sx, sy)) return found;
  const st = [idx(sx, sy)];
  found.add(st[0]);
  while (st.length) {
    const c = st.pop();
    const cx = c % W;
    const cy = (c - cx) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (Level.isSolid(nx, ny)) continue;
      const ni = idx(nx, ny);
      if (!found.has(ni)) { found.add(ni); st.push(ni); }
    }
  }
  return found;
}

const ex = Level.exit;
assert(ex !== null && Level.cellAt(ex.mx, ex.my) === 0 &&
  reachableFrom(ps.mx, ps.my).has(idx(ex.mx, ex.my)) && seen.has(idx(ex.mx, ex.my)),
  '10c. LVL-03: Level.exit' + (ex ? ' (' + ex.mx + ',' + ex.my + ')' : ' [MISSING]') +
  ' is non-null, its cell is FLOOR, and it is a member of the flood-filled reachable set — ' +
  'the level can actually be won on foot from the player start');

// The control. The exit alcove has exactly one floor neighbour; sealing it must
// cut the exit off from the flood fill. Restored immediately afterwards.
(function () {
  const mouths = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    .map(([dx, dy]) => [ex.mx + dx, ex.my + dy])
    .filter(([mx, my]) => Level.cellAt(mx, my) === 0);
  const saved = mouths.map(([mx, my]) => Level.cells[idx(mx, my)]);
  for (const [mx, my] of mouths) Level.cells[idx(mx, my)] = Level.STONE_ID;
  const sealedSet = reachableFrom(ps.mx, ps.my);
  const nowUnreachable = !sealedSet.has(idx(ex.mx, ex.my));
  mouths.forEach(([mx, my], i) => { Level.cells[idx(mx, my)] = saved[i]; });
  const restored = reachableFrom(ps.mx, ps.my).has(idx(ex.mx, ex.my));
  assert(mouths.length > 0 && nowUnreachable && restored,
    '10d. CONTROL for 10c: sealing the alcove\'s ' + mouths.length + ' floor neighbour(s) makes ' +
    'the SAME helper report the exit UNREACHABLE, and unsealing restores it — the reachability ' +
    'test can report failure, so 10c is not vacuous');
})();

// ===========================================================================
// 11. Line of sight
// ===========================================================================
assert(Level.lineOfSight(ps.x, ps.y, ps.x, ps.y) === true,
  '11a. a point sees itself (same-cell short circuit)');

const openBlock = blocksOfSize(4)[0];
const ax = openBlock[0] + 0.5;
const ay = openBlock[1] + 0.5;
const bx = openBlock[0] + 3.5;
const by = openBlock[1] + 3.5;
assert(Level.lineOfSight(ax, ay, bx, by) === true && Level.lineOfSight(bx, by, ax, ay) === true,
  '11b. two cells in the same open 4x4 block see each other in BOTH argument orders');

let rowTriple = null;
let colTriple = null;
for (let my = 0; my < H && (!rowTriple || !colTriple); my++) {
  for (let mx = 0; mx < W; mx++) {
    if (!rowTriple && Level.cellAt(mx, my) === 0 && Level.isSolid(mx + 1, my) &&
      Level.cellAt(mx + 2, my) === 0) rowTriple = [mx, my];
    if (!colTriple && Level.cellAt(mx, my) === 0 && Level.isSolid(mx, my + 1) &&
      Level.cellAt(mx, my + 2) === 0) colTriple = [mx, my];
  }
}
assert(!!rowTriple && Level.lineOfSight(rowTriple[0] + 0.5, rowTriple[1] + 0.5,
  rowTriple[0] + 2.5, rowTriple[1] + 0.5) === false,
  '11c. a wall on the ROW between two floor cells blocks sight (triple at ' + rowTriple + ')');
assert(!!colTriple && Level.lineOfSight(colTriple[0] + 0.5, colTriple[1] + 0.5,
  colTriple[0] + 0.5, colTriple[1] + 2.5) === false,
  '11d. a wall on the COLUMN between two floor cells blocks sight (triple at ' + colTriple + ')');

const far = [
  Level.lineOfSight(ps.x, ps.y, ps.x + 1e6, ps.y),
  Level.lineOfSight(ps.x, ps.y, ps.x, ps.y - 1e6),
  Level.lineOfSight(ps.x, ps.y, ps.x + 1e6, ps.y + 1e6),
  Level.lineOfSight(ps.x, ps.y, -1e6, -1e6)
];
assert(far.every((r) => r === false),
  '11e. a line that leaves the grid terminates and returns false (4 directions)');

// ===========================================================================
// 12. Idempotence
// ===========================================================================
const cellsBefore = Array.from(Level.cells);
const spawnsBefore = Level.spawns.length;
const lmBefore = JSON.stringify(Level.LANDMARKS);
Level.build();
const cellsAfter = Array.from(Level.cells);
let identical = cellsBefore.length === cellsAfter.length;
if (identical) {
  for (let i = 0; i < cellsBefore.length; i++) {
    if (cellsBefore[i] !== cellsAfter[i]) { identical = false; break; }
  }
}
assert(identical, '12a. a second build() produces byte-identical cells');
assert(Level.spawns.length === spawnsBefore,
  '12b. spawns did not grow across builds (' + Level.spawns.length + ')');
assert(JSON.stringify(Level.LANDMARKS) === lmBefore,
  '12c. LANDMARKS resolve to the same records across builds');
assert(Level.warnings.length === 0, '12d. the rebuild is still warning-free');

// ===========================================================================
// 13. Landmarks are real AND match the predicates they claim
//     (These are the anchors Plans 02 and 03 assert against, so a map edit that
//     removes the feature must fail HERE, not two plans later.)
// ===========================================================================
const LM = Level.LANDMARKS;
assert(!!LM.openCell && !!LM.wallFaceEast && !!LM.corridorCell,
  '13a. all three landmarks are non-null');
console.log('    openCell     ' + JSON.stringify(LM.openCell));
console.log('    wallFaceEast ' + JSON.stringify(LM.wallFaceEast));
console.log('    corridorCell ' + JSON.stringify(LM.corridorCell));

const oc = LM.openCell;
let ocOk = !!oc;
if (ocOk) {
  for (let oy = -2; oy <= 2 && ocOk; oy++) {
    for (let ox = -2; ox <= 2; ox++) {
      if (Level.cellAt(oc.mx + ox, oc.my + oy) !== 0) { ocOk = false; break; }
    }
  }
  ocOk = ocOk && oc.x === oc.mx + 0.5 && oc.y === oc.my + 0.5;
}
assert(ocOk, '13b. openCell\'s whole 5x5 neighbourhood is floor and x/y is the cell centre');

const wf = LM.wallFaceEast;
assert(!!wf && Level.cellAt(wf.mx, wf.my) === 0 && Level.isSolid(wf.mx + 1, wf.my) &&
  !Level.isSolid(wf.mx - 1, wf.my),
  '13c. wallFaceEast stands on floor with a SOLID +x neighbour and a FLOOR -x neighbour');
assert(!!wf && wf.wf === wf.mx + 1 && wf.x === wf.wf - 0.5 && wf.y === wf.my + 0.5,
  '13d. wallFaceEast.wf is the wall-face world x (' + (wf && wf.wf) +
  '), x = wf-0.5 and y = my+0.5 (' + (wf && wf.x) + ',' + (wf && wf.y) + ')');

const cc = LM.corridorCell;
let ccOk = !!cc && Level.cellAt(cc.mx, cc.my) === 0;
if (ccOk) {
  if (cc.blockedAxis === 'x') {
    ccOk = Level.isSolid(cc.mx - 1, cc.my) && Level.isSolid(cc.mx + 1, cc.my);
  } else if (cc.blockedAxis === 'y') {
    ccOk = Level.isSolid(cc.mx, cc.my - 1) && Level.isSolid(cc.mx, cc.my + 1);
  } else {
    ccOk = false;
  }
}
assert(ccOk, '13e. corridorCell has BOTH neighbours along blockedAxis "' +
  (cc && cc.blockedAxis) + '" solid');
const slideOk = !!cc &&
  Level.cellAt(cc.mx + cc.slideDir.x, cc.my + cc.slideDir.y) === 0 &&
  Level.cellAt(cc.mx + 2 * cc.slideDir.x, cc.my + 2 * cc.slideDir.y) === 0 &&
  (Math.abs(cc.slideDir.x) + Math.abs(cc.slideDir.y)) === 1 &&
  (cc.blockedAxis === 'x' ? cc.slideDir.x === 0 : cc.slideDir.y === 0);
assert(slideOk, '13f. stepping once and twice along corridorCell.slideDir (' +
  (cc && JSON.stringify(cc.slideDir)) + ') lands on floor, perpendicular to blockedAxis');

// ===========================================================================
// Self-containment gate at the harness level (threat T-02-04)
//   Everything index.html references must be RELATIVE, must exist, and must be
//   either style.css or under js/ — so nothing under tools/ can ever be loaded
//   by the browser.
// ===========================================================================
const refs = harness.resourceRefs;
assert(refs.length > 0, '14a. index.html references at least one resource (' + refs.length + ')');

const badRefs = [];
for (const ref of refs) {
  const isRelative = !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(ref) && !ref.startsWith('//') && !ref.startsWith('/');
  const inAllowedDir = ref === 'style.css' || ref.startsWith('js/');
  const exists = fs.existsSync(path.join(GAME_DIR, ref));
  if (!isRelative || !inAllowedDir || !exists) {
    badRefs.push(ref + ' [relative=' + isRelative + ' allowed=' + inAllowedDir + ' exists=' + exists + ']');
  }
}
assert(badRefs.length === 0,
  '14b. every referenced resource is relative, exists, and lives in js/ or is style.css' +
  (badRefs.length ? ' [' + badRefs.join(' | ') + ']' : ''));
assert(!refs.some((r) => r.indexOf('tools/') >= 0),
  '14c. index.html references NOTHING under tools/ — the harnesses are never browser-loaded');
assert(harness.scriptOrder.indexOf('js/level.js') > harness.scriptOrder.indexOf('js/preview.js') &&
  harness.scriptOrder.indexOf('js/level.js') < harness.scriptOrder.indexOf('js/main.js'),
  '14d. the SHIPPED script order loads js/level.js after preview.js and before main.js (D-10)');

finish('ALL_LEVEL_CONTRACTS_PASS');
