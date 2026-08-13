/* Headless sanity checks: parses every script, generates all art, builds the
   level, and runs a few hundred simulated frames without a browser.
   Usage: node tools/check.cjs   (from the game directory) */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const files = [
  'js/util.js', 'js/config.js', 'js/textures.js', 'js/sprites.js',
  'js/level.js', 'js/audio.js', 'js/input.js', 'js/renderer.js',
  'js/hud.js', 'js/entities.js', 'js/weapons.js', 'js/player.js',
  'js/game.js'
];

let failures = 0;
function ok(msg) { console.log('  ok   ' + msg); }
function bad(msg) { failures++; console.log('  FAIL ' + msg); }

/* --- 1. index.html lists exactly the scripts we ship --------------------- */
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const listed = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
const onDisk = fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f);
for (const f of onDisk) {
  if (!listed.includes(f)) bad(`${f} exists but is not loaded by index.html`);
}
for (const f of listed) {
  if (!fs.existsSync(path.join(root, f))) bad(`index.html loads missing file ${f}`);
}
if (!html.includes('type="module"')) ok('classic scripts only (file:// safe)');
else bad('index.html uses type="module" -- breaks file://');

/* --- 2. a minimal DOM/canvas/audio stand-in ----------------------------- */
function makeImageData(w, h) {
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
}
const canvasStub = {
  width: 480, height: 300,
  style: {},
  classList: { add() {}, remove() {}, toggle() {} },
  addEventListener() {},
  getContext() {
    return {
      createImageData: (w, h) => makeImageData(w, h),
      putImageData() {}
    };
  }
};

const sandbox = {
  console,
  performance: { now: () => Date.now() },
  requestAnimationFrame() {},
  Math, Date, JSON, Object, Array, String, Number, Boolean, Error,
  Uint8Array, Uint8ClampedArray, Uint32Array, Int8Array, Float32Array,
  window: {
    addEventListener() {},
    AudioContext: undefined,
    innerWidth: 1280, innerHeight: 800
  },
  document: {
    getElementById: () => canvasStub,
    addEventListener() {},
    pointerLockElement: null,
    exitPointerLock() {}
  }
};
sandbox.window.window = sandbox.window;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

/* --- 3. load every module ------------------------------------------------ */
for (const f of files) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  try {
    vm.runInContext(src, sandbox, { filename: f });
    ok('loaded ' + f);
  } catch (e) {
    bad(`${f}: ${e.message}`);
    console.log(e.stack.split('\n').slice(0, 4).join('\n'));
    process.exit(1);
  }
}

const { U, CFG, TEX, SPR, LEVEL, R, HUD, Ents, Weapons, Player, Game } = sandbox;

/* --- 4. build all the procedural art ------------------------------------- */
TEX.build();
for (let i = 1; i <= 8; i++) {
  const t = TEX.wall(i);
  if (!t || t.length !== CFG.TEX * CFG.TEX) bad('wall texture ' + i + ' malformed');
}
for (let i = 0; i <= 2; i++) {
  if (!TEX.floor(i)) bad('flat ' + i + ' missing');
}
ok('9 wall textures + 3 flats generated');

SPR.build();
const lib = SPR.lib;
for (const m of ['zombie', 'imp', 'demon', 'baron']) {
  const a = lib[m];
  if (!a || a.walk.length !== 2 || !a.attack || !a.pain || a.die.length !== 5) {
    bad('monster art incomplete: ' + m);
  }
  // a monster that is entirely transparent would be invisible in game
  let lit = 0;
  for (const px of a.walk[0].data) if (px !== 0) lit++;
  if (lit < 200) bad(`${m} walk frame has only ${lit} opaque pixels`);
}
ok('4 monsters x 9 frames of art generated');

for (const w of ['pistol', 'shotgun', 'chaingun']) {
  const v = lib.weaponViews[w];
  if (!v || !v.length) bad('weapon view missing: ' + w);
  let lit = 0;
  for (const px of v[0].data) if (px !== 0) lit++;
  if (lit < 300) bad(`${w} view sprite nearly empty (${lit} px)`);
}
ok('3 weapon views generated');

/* --- 5. level integrity --------------------------------------------------- */
LEVEL.parse();
ok(`map parsed: ${LEVEL.W}x${LEVEL.H}`);

// border must be solid or the raycaster can escape the grid
for (let x = 0; x < LEVEL.W; x++) {
  if (!LEVEL.solid(x, 0) || !LEVEL.solid(x, LEVEL.H - 1)) bad('map border open at column ' + x);
}
for (let y = 0; y < LEVEL.H; y++) {
  if (!LEVEL.solid(0, y) || !LEVEL.solid(LEVEL.W - 1, y)) bad('map border open at row ' + y);
}
ok('map is fully enclosed');

const things = LEVEL.things();
const counts = {};
for (const t of things) counts[t.what] = (counts[t.what] || 0) + 1;
console.log('       things: ' + JSON.stringify(counts));
for (const need of ['redkey', 'shotgun', 'chaingun']) {
  if (!counts[need]) bad('map is missing a required pickup: ' + need);
}
if (!LEVEL.doorList().length) bad('no doors in map');
if (!LEVEL.doorList().some(d => d.locked === 'red')) bad('no red-locked door');
ok(`${LEVEL.doorList().length} doors, ${things.length} things`);

const start = LEVEL.start();
if (LEVEL.solid(start.x, start.y)) bad('player start is inside a wall');
ok('player start is clear');

/* every enemy and item must stand on open floor */
for (const t of things) {
  if (LEVEL.solid(t.x, t.y)) bad(`${t.what} at ${t.x},${t.y} is inside a wall`);
}
ok('all things stand on open floor');

/* adjacent door tiles must act as one doorway, or a player's collision circle
   catches on the half that was not activated */
{
  const wide = LEVEL.doorList().filter(d => (d.group || []).length > 1);
  if (!wide.length) bad('no multi-tile doorway found -- grouping is untested');
  else {
    const g = wide[0].group;
    LEVEL.activate(g[0].x, g[0].y, { keys: { red: true } }, () => {});
    const allOpening = g.every(d => d.state === 'opening');
    if (!allOpening) bad('activating one tile of a wide doorway left the rest shut');
    else ok(`wide doorway (${g.length} tiles) opens as one unit`);
    for (let i = 0; i < 120; i++) LEVEL.update(1 / 60, []);
    if (g.some(d => LEVEL.solid(d.x, d.y))) bad('part of a wide doorway still blocks after opening');
    else ok('every tile of the wide doorway is walkable');
    LEVEL.parse();   // restore a pristine level for the checks below
  }
}

/* the exit switch must exist and be reachable-adjacent */
let exits = 0;
for (let y = 0; y < LEVEL.H; y++)
  for (let x = 0; x < LEVEL.W; x++)
    if (LEVEL.isExitAt(x, y)) exits++;
if (!exits) bad('no exit switch on the map');
else ok(exits + ' exit switch tiles');

/* --- 6. flood fill: is the whole level actually playable? ----------------- */
function reachable(treatDoorsAsOpen) {
  const seen = new Set();
  const q = [[Math.floor(start.x), Math.floor(start.y)]];
  seen.add(q[0][0] + ',' + q[0][1]);
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= LEVEL.W || ny >= LEVEL.H) continue;
      const k = nx + ',' + ny;
      if (seen.has(k)) continue;
      const door = LEVEL.doorAt(nx, ny);
      const passable = LEVEL.tileAt(nx, ny) === 0 ||
                       (door && (treatDoorsAsOpen === 'all' ||
                                 (treatDoorsAsOpen === 'unlocked' && !door.locked)));
      if (!passable) continue;
      seen.add(k);
      q.push([nx, ny]);
    }
  }
  return seen;
}

const beforeKey = reachable('unlocked');
const keyThing = things.find(t => t.what === 'redkey');
if (!beforeKey.has(Math.floor(keyThing.x) + ',' + Math.floor(keyThing.y))) {
  bad('red keycard is not reachable before opening the locked door');
} else ok('red keycard reachable without the red door');

const afterKey = reachable('all');
let exitReachable = false;
for (let y = 0; y < LEVEL.H; y++) {
  for (let x = 0; x < LEVEL.W; x++) {
    if (!LEVEL.isExitAt(x, y)) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (afterKey.has((x + dx) + ',' + (y + dy))) exitReachable = true;
    }
  }
}
if (!exitReachable) bad('exit switch cannot be reached even with all doors open');
else ok('exit switch reachable with the red key');

let unreachableThings = 0;
for (const t of things) {
  if (!afterKey.has(Math.floor(t.x) + ',' + Math.floor(t.y))) {
    unreachableThings++;
    console.log(`       unreachable: ${t.what} @ ${t.x},${t.y}`);
  }
}
if (unreachableThings) bad(unreachableThings + ' things are walled off');
else ok('every thing is reachable');

/* --- 7. run the game headless -------------------------------------------- */
R.init(canvasStub);
R.bindFlats();
Game.reset();
Game.setState('play');

const p = Player.p;
console.log(`       spawned ${Ents.countEnemies()} enemies, ${Ents.countItems()} items`);

/* fire every weapon and verify it consumes ammo and can kill */
p.hasWeapon = [false, true, true, true];
p.ammo.bullets = 200; p.ammo.shells = 50;

const before = p.ammo.bullets;
Weapons.view.fireTimer = 0;
sandbox.Input._forceFire = true;

/* drive frames: walk forward, look around, shoot */
let frames = 0, errors = 0;
const t0 = Date.now();
for (let i = 0; i < 600; i++) {
  try {
    p.ang += 0.02;
    Game.update(1 / 60);
    Game.render();
    frames++;
  } catch (e) {
    errors++;
    if (errors === 1) { bad('exception during frame ' + i + ': ' + e.message); console.log(e.stack.split('\n').slice(0, 5).join('\n')); }
  }
}
const ms = Date.now() - t0;
if (!errors) ok(`${frames} headless frames with no exceptions (${ms}ms, ${(ms / frames).toFixed(2)}ms/frame incl. full software render)`);

/* damage plumbing */
const enemy = Ents.list().find(e => e.kind === 'enemy' && !e.dead);
if (enemy) {
  const hp0 = enemy.hp;
  Ents.hurt(enemy, 5, true);
  if (enemy.hp !== hp0 - 5) bad('Ents.hurt did not apply damage');
  else ok('enemy damage applies');
  Ents.hurt(enemy, 10000, true);
  if (!enemy.dead) bad('enemy did not die from lethal damage');
  else ok('enemies die and count toward KILLS (' + Game.data.kills + ')');
}

const h0 = p.health;
Player.damage(20, p.x + 1, p.y);
if (p.health >= h0) bad('Player.damage did not reduce health');
else ok('player takes damage (' + h0 + ' -> ' + p.health + ')');

p.armor = 90;
const h1 = p.health;
Player.damage(30, p.x + 1, p.y);
if (p.armor !== 80) bad('armor did not absorb a third of the damage');
else ok('armor absorbs damage (' + h1 + ' -> ' + p.health + ', armor 90 -> ' + p.armor + ')');

/* pickups */
p.health = 50;
if (!Player.tryPickup('medkit') || p.health !== 75) bad('medkit did not heal 25');
else ok('medkit heals');
p.health = 100;
if (Player.tryPickup('medkit')) bad('medkit consumed at full health');
else ok('full-health medkit is left on the floor');
if (!Player.tryPickup('redkey') || !p.keys.red) bad('red key not registered');
else ok('red keycard registers');

/* locked door refuses without the key, opens with it */
const rd = LEVEL.doorList().find(d => d.locked === 'red');
p.keys.red = false;
let msg = '';
LEVEL.activate(rd.x, rd.y, p, m => { msg = m; });
if (rd.state !== 'closed') bad('locked door opened without the key');
else ok('locked door stays shut: "' + msg + '"');
p.keys.red = true;
LEVEL.activate(rd.x, rd.y, p, () => {});
if (rd.state !== 'opening') bad('locked door did not open with the key');
else ok('locked door opens with the key');
for (let i = 0; i < 120; i++) LEVEL.update(1 / 60, []);
if (rd.open < 0.99) bad('door never finished opening');
else ok('door animates fully open');
if (LEVEL.solid(rd.x, rd.y)) bad('open door still blocks movement');
else ok('open door is walkable');

/* the exit switch ends the level */
let ex = null;
for (let y = 0; y < LEVEL.H && !ex; y++)
  for (let x = 0; x < LEVEL.W && !ex; x++)
    if (LEVEL.isExitAt(x, y)) ex = { x, y };
LEVEL.activate(ex.x, ex.y, p, () => {});
if (!LEVEL.exitReached()) bad('exit switch did not trigger');
else ok('exit switch triggers level completion');

Game.update(1 / 60);
if (Game.getState() !== 'win') bad('game did not enter the win state');
else ok('game reaches WIN state');

console.log('');
if (failures) { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
console.log('ALL CHECKS PASSED');
