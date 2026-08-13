/* Renders one isolated, hand-composed scene to PNG for eyeballing a sprite.
   Usage: node tools/scene.cjs <name>        (name: imp | items | corpse) */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'tools', 'shots');
fs.mkdirSync(outDir, { recursive: true });

const CRC = (() => { const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length, 0);
  const b = Buffer.concat([Buffer.from(t, 'ascii'), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(b), 0);
  return Buffer.concat([l, b, c]); };
function writePNG(file, rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4);
  ih[8] = 8; ih[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}

const canvasStub = { width: 480, height: 300, style: {}, classList: { add() {}, remove() {}, toggle() {} },
  addEventListener() {}, getContext: () => ({
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) };
const sb = { console, performance: { now: () => Date.now() }, requestAnimationFrame() {},
  Math, Date, JSON, Object, Array, String, Number, Boolean, Error,
  Uint8Array, Uint8ClampedArray, Uint32Array, Int8Array, Float32Array,
  window: { addEventListener() {}, innerWidth: 1280, innerHeight: 800 },
  document: { getElementById: () => canvasStub, addEventListener() {}, pointerLockElement: null, exitPointerLock() {} } };
sb.window.window = sb.window; vm.createContext(sb);
for (const f of ['js/util.js', 'js/config.js', 'js/textures.js', 'js/sprites.js', 'js/level.js',
                 'js/audio.js', 'js/input.js', 'js/renderer.js', 'js/hud.js', 'js/entities.js',
                 'js/weapons.js', 'js/player.js', 'js/game.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sb, { filename: f });

const { CFG, TEX, SPR, LEVEL, R, HUD, Ents, Weapons, Player, Game } = sb;
TEX.build(); SPR.build(); R.init(canvasStub); R.bindFlats(); Game.reset(); R.bindLevel();
Game.setState('play');
const bytes = new Uint8Array(R.fb().buffer);
const p = Player.p;
const name = process.argv[2] || 'imp';

/* Clear the world so only what we place is on camera. */
const list = Ents.list();
list.length = 0;
HUD.message('');

/* Spawn one thing through the real spawner, then splice it into the list we
   are accumulating (Ents.reset clears the list, so preserve it around the call). */
function spawn(kind, what, x, y) {
  const keep = list.slice();
  const things = LEVEL.things();
  const savedThings = things.slice();
  things.length = 0;
  things.push({ kind: kind, what: what, x: x, y: y });
  Ents.reset(Game.data);
  const made = list[0];
  things.length = 0;
  for (const t of savedThings) things.push(t);
  list.length = 0;
  for (const e of keep) list.push(e);
  list.push(made);
  return made;
}

p.x = 17.0; p.y = 12.5; p.ang = Math.PI;      // open hall, looking west
p.health = 88; p.armor = 30; p.alive = true; p.painFlash = 0;
p.hasWeapon = [false, true, true, true]; p.ammo.shells = 20;
Weapons.requestSwitch(p, 2);
for (let i = 0; i < 40; i++) Weapons.update(1 / 60, p);

if (name === 'imp') {
  const imp = spawn('enemy', 'imp', 12.6, 12.5);
  imp.awake = true; imp.state = 'chase'; imp.sprite = imp.art.walk[0];
  // row 12 is the only open row here: y must stay inside 12.05 .. 12.95
  const zom = spawn('enemy', 'zombie', 14.2, 12.85);
  zom.awake = true; zom.sprite = zom.art.walk[1];
  const dem = spawn('enemy', 'demon', 13.4, 12.15);
  dem.awake = true; dem.sprite = dem.art.walk[0];
  // a fireball in flight, held off the centre line
  Ents.list().push({
    kind: 'proj', x: 15.6, y: 12.2, z: 0.42, size: 0.30, vx: 0, vy: 0,
    dmg: 10, frames: SPR.lib.fireball, sprite: SPR.lib.fireball[0],
    animT: 0, life: 9, fullbright: true, dead: false
  });
} else if (name === 'items') {
  p.x = 19.5;                       // stand further back so the floor is visible
  p.pitch = -14;
  spawn('item', 'medkit', 13.2, 12.25);
  spawn('item', 'armor', 14.4, 12.85);
  spawn('item', 'shells', 15.6, 12.25);
  spawn('item', 'redkey', 16.6, 12.80);
  spawn('item', 'chaingun', 12.2, 12.60);
  spawn('item', 'healthBonus', 17.4, 12.40);
} else if (name === 'corpse') {
  const z1 = spawn('enemy', 'zombie', 13.4, 12.30);
  z1.dead = true; z1.state = 'corpse'; z1.sprite = z1.art.die[z1.art.die.length - 1];
  const d1 = spawn('enemy', 'demon', 15.0, 12.80);
  d1.dead = true; d1.state = 'dying'; d1.sprite = d1.art.die[1];
  const b1 = spawn('enemy', 'imp', 14.2, 12.20);
  b1.dead = true; b1.state = 'dying'; b1.sprite = b1.art.die[3];
}

Game.render();
writePNG(path.join(outDir, 'scene-' + name + '.png'), Buffer.from(bytes), CFG.W, CFG.H);
console.log('wrote scene-' + name + '.png with ' + Ents.list().length + ' entities');
