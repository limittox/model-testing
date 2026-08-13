/* Renders frames of the game to PNG without a browser, by loading the same
   classic scripts into a stubbed context and encoding the framebuffer.
   Usage: node tools/shot.cjs [outDir] */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const outDir = process.argv[2] || path.join(root, 'tools', 'shots');
fs.mkdirSync(outDir, { recursive: true });

/* ---- minimal PNG encoder ------------------------------------------------ */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function writePNG(file, rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;                      // filter: none
    rgba.copy
      ? rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
      : Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
  return png.length;
}

/* ---- load the game ------------------------------------------------------ */
const canvasStub = {
  width: 480, height: 300, style: {},
  classList: { add() {}, remove() {}, toggle() {} },
  addEventListener() {},
  getContext: () => ({
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {}
  })
};

const sandbox = {
  console, performance: { now: () => Date.now() }, requestAnimationFrame() {},
  Math, Date, JSON, Object, Array, String, Number, Boolean, Error,
  Uint8Array, Uint8ClampedArray, Uint32Array, Int8Array, Float32Array,
  window: { addEventListener() {}, innerWidth: 1280, innerHeight: 800 },
  document: {
    getElementById: () => canvasStub, addEventListener() {},
    pointerLockElement: null, exitPointerLock() {}
  }
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);

for (const f of ['js/util.js', 'js/config.js', 'js/textures.js', 'js/sprites.js',
                 'js/level.js', 'js/audio.js', 'js/input.js', 'js/renderer.js',
                 'js/hud.js', 'js/entities.js', 'js/weapons.js', 'js/player.js',
                 'js/game.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}

const { CFG, TEX, SPR, LEVEL, R, HUD, Ents, Weapons, Player, Game } = sandbox;

TEX.build();
SPR.build();
R.init(canvasStub);
R.bindFlats();
Game.reset();
R.bindLevel();

const bytes = new Uint8Array(R.fb().buffer);

function shoot(name) {
  Game.render();
  const size = writePNG(path.join(outDir, name + '.png'), Buffer.from(bytes), CFG.W, CFG.H);
  console.log(`  ${name}.png  (${(size / 1024).toFixed(1)} kB)`);
}

/* Put the player somewhere interesting and let the world settle. */
function place(x, y, ang, frames) {
  const p = Player.p;
  p.x = x; p.y = y; p.ang = ang;
  for (let i = 0; i < (frames || 1); i++) { Ents.update(1 / 60, p); }
}

console.log('rendering frames ->', outDir);

Game.setState('title');
Game.data.time = 0.2;
shoot('01-title');

Game.setState('play');
place(LEVEL.start().x, LEVEL.start().y, 0.0);
shoot('02-spawn');

// look down the start room toward the first zombie
place(6.5, 2.5, Math.PI / 2 + 0.15);
shoot('03-corridor');

// wake the zombie in the start room and stare at it mid-chase
const zomb = Ents.list().find(e => e.type === 'zombie');
place(zomb.x, zomb.y - 3.2, Math.PI / 2);
Ents.alertNear(Player.p.x, Player.p.y, 20);
for (let i = 0; i < 40; i++) Ents.update(1 / 60, Player.p);
shoot('04-zombie');

// shotgun in hand, imp room
Player.p.hasWeapon = [false, true, true, true];
Player.p.ammo.shells = 20;
Weapons.requestSwitch(Player.p, 2);
for (let i = 0; i < 30; i++) Weapons.update(1 / 60, Player.p);
place(18.5, 12.5, Math.PI / 2);
Ents.alertNear(Player.p.x, Player.p.y, 25);
for (let i = 0; i < 60; i++) Ents.update(1 / 60, Player.p);
shoot('05-shotgun');

// chaingun, mid-fire, looking at the red door
Weapons.requestSwitch(Player.p, 3);
for (let i = 0; i < 30; i++) Weapons.update(1 / 60, Player.p);
Weapons.view.flashT = 0.05;
Weapons.view.flashIdx = 1;
R.addLight(0.4);
place(16.5, 22.0, Math.PI / 2);
shoot('06-chaingun-reddoor');

// the blood arena with the baron
Player.p.keys.red = true;
Player.p.health = 42;
Player.p.armor = 55;
place(16.0, 28.5, -Math.PI / 2);
Ents.alertNear(Player.p.x, Player.p.y, 30);
for (let i = 0; i < 90; i++) Ents.update(1 / 60, Player.p);
shoot('07-arena');

// automap
Game.data.showMap = true;
place(16.0, 20.0, -Math.PI / 2);
shoot('08-automap');
Game.data.showMap = false;

// hurt + death screens
Player.p.health = 12;
Player.p.painFlash = 0.9;
shoot('09-hurt');

Player.p.health = 0;
Player.p.alive = false;
Game.setState('dead');
Game.data.time = 0.3;
shoot('10-dead');

// a demon and an imp mid-chase, plus a fireball in flight
Game.setState('play');
Player.p.alive = true; Player.p.health = 78; Player.p.armor = 40;
Player.p.painFlash = 0;
Weapons.requestSwitch(Player.p, 2);
for (let i = 0; i < 30; i++) Weapons.update(1 / 60, Player.p);

const dem = Ents.list().find(e => e.type === 'demon' && !e.dead);
place(dem.x, dem.y + 3.4, -Math.PI / 2);
Ents.alertNear(Player.p.x, Player.p.y, 25);
for (let i = 0; i < 30; i++) Ents.update(1 / 60, Player.p);
dem.x = Player.p.x; dem.y = Player.p.y - 2.6;
shoot('12-demon');

// row 12 is the open hall that runs the full width -- clear line of sight
const imp = Ents.list().find(e => e.type === 'imp' && !e.dead);
place(17.0, 12.5, Math.PI);          // face -x down the hall
imp.x = 12.0; imp.y = 12.5;
imp.awake = true;
imp.state = 'attack'; imp.timer = 0; imp.fired = false; imp.cooldown = 99;
let sawBall = false;
for (let i = 0; i < 30; i++) {
  Ents.update(1 / 60, Player.p);
  const ball = Ents.list().find(e => e.kind === 'proj');
  if (ball) {
    sawBall = true;
    // hold it in mid-flight so it is on camera
    ball.x = 13.6; ball.y = 12.5; ball.vx = 0; ball.vy = 0;
  }
}
console.log('  (fireball spawned: ' + sawBall + ')');
shoot('13-imp-fireball');

Game.setState('win');
Game.data.clearTime = 187;
Game.data.kills = 9; Game.data.items = 12; Game.data.foundSecret = true;
shoot('11-win');

console.log('done');
