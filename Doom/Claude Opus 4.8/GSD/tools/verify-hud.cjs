/*
 * tools/verify-hud.cjs — the PHASE 6 IN-GAME OVERLAY harness (HUD-01..HUD-06).
 *
 * NODE-ONLY (never referenced by index.html). Built on tools/boot.cjs: it boots the
 * SHIPPED script list in the SHIPPED order into one vm context with a stubbed DOM,
 * fires the window load event (which wires the seams and starts the loop), then
 * drives REAL FRAMES through the manual requestAnimationFrame scheduler and reads
 * back what the overlay actually PAINTED.
 *
 * ============================================================================
 * HOW AN OVERLAY IS MADE FALSIFIABLE WITHOUT A SCREEN
 * ============================================================================
 * h.canvas('hud').getContext('2d') returns a CACHED recording surface — the very
 * same object Framebuffer.hudCtx holds — so wrapping its drawing methods observes
 * exactly what HUD.render draws, argument for argument, with the fillStyle, font
 * and globalAlpha in force at the moment of each call. The wrappers delegate to the
 * original no-ops, so the recording never changes behaviour.
 *
 * document.createElement('canvas') returns a stub of the same shape, so the
 * minimap's OFFSCREEN prebuild is observable too — the createElement patch is
 * installed BEFORE h.fireLoad(), because main.js calls HUD.reset() (which builds
 * the minimap) during boot.
 *
 * ============================================================================
 * EVERY NEGATIVE AND EVERY NUMBER IS CONTROL-PAIRED
 * ============================================================================
 * A readout that never moves is not a readout, and "no flash was drawn" proves
 * nothing if the flash could never have been drawn in that scenario. So each
 * readout assertion is followed by the SAME recording with the SOURCE FIELD
 * CHANGED, and each negative is paired with the positive recording that proves the
 * measurement is live. Every expectation is DERIVED — from CONFIG, from
 * Weapons.TABLE, from Level.cells, from Enemies.list and Pickups.list — never
 * hardcoded, so a retune or a map edit moves the expectation with it.
 *
 * Prints PASS/FAIL per assertion and the terminal token ALL_HUD_CONTRACTS_PASS only
 * when every assertion passed.
 */

'use strict';

const { boot, assert, finish } = require('./boot.cjs');

const h = boot({});

// ---------------------------------------------------------------------------
// THE OFFSCREEN RECORDER — installed BEFORE fireLoad, because the minimap prebuild
// runs inside main.js's HUD.reset() during boot. Every canvas the game creates
// through document.createElement gets its 2D context wrapped by the same recorder
// the hud context uses, so a prebuild is as observable as a frame.
// ---------------------------------------------------------------------------
const DRAW_METHODS = ['clearRect', 'fillRect', 'strokeRect', 'fillText', 'strokeText',
  'drawImage', 'putImageData', 'getImageData', 'save', 'restore', 'beginPath',
  'closePath', 'moveTo', 'lineTo', 'arc', 'rect', 'fill', 'stroke', 'translate',
  'rotate', 'scale', 'setTransform', 'resetTransform', 'measureText'];

// One shared recording flag: a frame's calls and a prebuild's calls are captured
// into separate sinks but gated by the same switch, so "clear, do one thing, look"
// is the only shape a scenario ever needs.
let recording = false;

function wrapContext(ctx, sink) {
  if (!ctx || ctx.__gsdWrapped) return ctx;
  ctx.__gsdWrapped = true;
  for (const name of DRAW_METHODS) {
    const orig = ctx[name];
    if (typeof orig !== 'function') continue;
    ctx[name] = function () {
      if (recording) {
        sink.push({
          m: name,
          args: Array.prototype.slice.call(arguments),
          fillStyle: ctx.fillStyle,
          strokeStyle: ctx.strokeStyle,
          font: ctx.font,
          globalAlpha: ctx.globalAlpha
        });
      }
      return orig.apply(ctx, arguments);
    };
  }
  return ctx;
}

const offCalls = [];        // everything drawn on any OFFSCREEN canvas
const offCanvases = [];     // the offscreen canvases the game created, in order

const origCreateElement = h.document.createElement;
h.document.createElement = function (tag) {
  const canvas = origCreateElement.call(h.document, tag);
  offCanvases.push(canvas);
  const origGetContext = canvas.getContext;
  canvas.getContext = function (kind) {
    return wrapContext(origGetContext.call(canvas, kind), offCalls);
  };
  return canvas;
};

const hudCalls = [];
wrapContext(h.canvas('hud').getContext('2d'), hudCalls);

h.fireLoad();

const s = h.sandbox;
const CONFIG = s.CONFIG;
const Level = s.Level;
const Player = s.Player;
const Input = s.Input;
const Combat = s.Combat;
const Enemies = s.Enemies;
const Entities = s.Entities;
const Pickups = s.Pickups;
const Weapons = s.Weapons;
const Raycaster = s.Raycaster;
const Framebuffer = s.Framebuffer;
const HUD = s.HUD;
const Game = s.Game;
const raf = h.raf;
const S = Game.STATES;

const FRAME_MS = 1000 / 60;
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('--- in-game overlay (HUD) harness ---');
console.log('hud canvas ' + Framebuffer.hudCanvas.width + 'x' + Framebuffer.hudCanvas.height +
  ', level ' + Level.WIDTH + 'x' + Level.HEIGHT + ', ' + Enemies.list.length + ' enemies, ' +
  Pickups.list.length + ' pickups');
console.log('');

// ---------------------------------------------------------------------------
// RECORDING HELPERS.
// ---------------------------------------------------------------------------

// Clear the recording, drive ONE REAL FRAME through the loop, and return the calls
// that frame made on the hud context. Returns a COPY, so a later recording cannot
// mutate a snapshot an earlier control assertion is still holding.
function recordFrame(ms) {
  hudCalls.length = 0;
  recording = true;
  raf.step(ms === undefined ? FRAME_MS : ms);
  recording = false;
  return hudCalls.slice();
}

// Clear both recordings, run `fn`, and return the OFFSCREEN calls it made. Used to
// observe the minimap prebuild (and to prove it touched no hud context).
function recordOffscreen(fn) {
  hudCalls.length = 0;
  offCalls.length = 0;
  recording = true;
  fn();
  recording = false;
  return { off: offCalls.slice(), hud: hudCalls.slice() };
}

const textsOf = (calls) => calls.filter((c) => c.m === 'fillText').map((c) => String(c.args[0]));
const hasText = (calls, needle) => textsOf(calls).some((t) => t.indexOf(needle) >= 0);
const blitsOf = (calls) =>
  calls.filter((c) => c.m === 'putImageData' || c.m === 'getImageData').length;
const fillRectsWith = (calls, color) =>
  calls.filter((c) => c.m === 'fillRect' && c.fillStyle === color);

// THE READOUT PAIRING. js/hud.js draws each column as its LABEL and then its VALUE,
// in that order, so the recorded fillText sequence is self-describing: the text
// after a known label IS that label's value. This is why the harness never has to
// guess which recorded number is the health and which is the ammo.
const LABELS = HUD.READOUT_LABELS;
function readouts(calls) {
  const texts = textsOf(calls);
  const out = Object.create(null);
  for (let i = 0; i < texts.length; i++) {
    if (LABELS.indexOf(texts[i]) >= 0 && i + 1 < texts.length) out[texts[i]] = texts[i + 1];
  }
  return out;
}

// The ammo count the weapon in hand actually SPENDS, derived through the weapon
// table exactly as the production readout derives it — never a literal, and never
// a second opinion about which weapon uses which field.
const ammoField = () => Weapons.TABLE[Combat.weapon].ammo;
const ammoInHand = () => Combat.ammo[ammoField()];

// Parse '#rrggbb' into [r,g,b] so a colour claim ("red-dominant") is a measurement.
function rgb(css) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(css).trim());
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

// ---------------------------------------------------------------------------
// Scenario helpers.
// ---------------------------------------------------------------------------
function releaseAll() { Input.reset(); }

// A known playing world: a clean rebuild, then playing, with no key held.
function freshPlaying() {
  Game.restart();
  releaseAll();
}

function frames(n, ms) {
  for (let i = 0; i < n; i++) raf.step(ms === undefined ? FRAME_MS : ms);
}

const liveEnemies = () =>
  Enemies.list.filter((e) => e.alive === true && e.state !== Enemies.CORPSE).length;
const activePickups = () => Pickups.list.filter((e) => e.active === true).length;

// The enemy nearest the player, DERIVED (Enemies.list is in row-major spawn order,
// so list[0] is whichever marker the map declares first — not a meaningful choice).
function nearestEnemy() {
  let best = null;
  let bestD = Infinity;
  for (const e of Enemies.list) {
    if (e.alive !== true) continue;
    const d = Math.hypot(e.x - Player.x, e.y - Player.y);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

// ===========================================================================
// ===========================================================================
// SECTION 1 — THE STATUS BAR, THE CROSSHAIR AND THE DAMAGE FLASH
//             (HUD-01, HUD-02, HUD-03, HUD-06; 06-CONTEXT D-01 + D-03).
// ===========================================================================
// ===========================================================================

freshPlaying();

// ---------------------------------------------------------------------------
// 1a. THE THREE VITAL READOUTS ARE ON SCREEN, each as its own labelled column.
// ---------------------------------------------------------------------------
const firstPlaying = (function () {
  const calls = recordFrame();
  const r = readouts(calls);
  assert(Game.state === S.PLAYING && HUD.screen === S.PLAYING,
    '1a-0. setup: the recorded frame was a PLAYING frame and the overlay recorded ' +
    'painting the playing screen (HUD.screen "' + HUD.screen + '")');
  assert(r.HEALTH === '' + Combat.health,
    '1a-i. HUD-01: the overlay draws the live HEALTH (recorded "' + r.HEALTH +
    '" === Combat.health ' + Combat.health + ')');
  assert(r.ARMOR === '' + Combat.armor,
    '1a-ii. HUD-01: the overlay draws the live ARMOR (recorded "' + r.ARMOR +
    '" === Combat.armor ' + Combat.armor + ')');
  assert(r.AMMO === '' + ammoInHand(),
    '1a-iii. HUD-01: the overlay draws the AMMO for the weapon in hand (recorded "' +
    r.AMMO + '" === Combat.ammo.' + ammoField() + ' ' + ammoInHand() + ')');
  assert(LABELS.every((l) => textsOf(calls).indexOf(l) >= 0),
    '1a-iv. all five readouts are drawn as LABELLED columns (' + LABELS.join(', ') + ')');
  return calls;
})();

// ---------------------------------------------------------------------------
// 1b. CONTROL FOR 1a — change all three source fields and re-record. A readout
//     that does not move is not a readout, it is a picture of a number.
// ---------------------------------------------------------------------------
(function () {
  const before = readouts(firstPlaying);
  Combat.health = 63;
  Combat.armor = 27;
  Combat.ammo.bullets = 11;
  const after = readouts(recordFrame());

  const distinct = before.HEALTH !== after.HEALTH && before.ARMOR !== after.ARMOR &&
    before.AMMO !== after.AMMO;
  assert(distinct,
    '1b-i. CONTROL for 1a: all three readouts CHANGED when their fields changed ' +
    '(health "' + before.HEALTH + '"->"' + after.HEALTH + '", armor "' + before.ARMOR +
    '"->"' + after.ARMOR + '", ammo "' + before.AMMO + '"->"' + after.AMMO + '")');
  assert(after.HEALTH === '' + Combat.health && after.ARMOR === '' + Combat.armor &&
    after.AMMO === '' + ammoInHand(),
    '1b-ii. and each moved TO the new value of its own field (' + Combat.health + '/' +
    Combat.armor + '/' + ammoInHand() + ') — the readouts are not merely different, ' +
    'they are correct');
})();

// ---------------------------------------------------------------------------
// 1c. THE AMMO READOUT FOLLOWS THE WEAPON (HUD-01, threat T-06-09). The field is
//     resolved through Weapons.TABLE — the same table Weapons.fire() spends from —
//     so the bar cannot show bullets while the shotgun eats shells.
// ---------------------------------------------------------------------------
(function () {
  assert(Weapons.TABLE.pistol.ammo !== Weapons.TABLE.shotgun.ammo,
    '1c-0. setup: the two weapons spend DIFFERENT Combat.ammo fields ("' +
    Weapons.TABLE.pistol.ammo + '" vs "' + Weapons.TABLE.shotgun.ammo + '"), so the ' +
    'readout has something to get wrong');

  Combat.grantShotgun();
  Combat.ammo.bullets = 33;
  Combat.ammo.shells = 7;

  assert(Combat.selectWeapon(Combat.PISTOL) === false && Combat.weapon === Combat.PISTOL,
    '1c-1. setup: the pistol is in hand');
  const pistolCalls = recordFrame();
  const withPistol = readouts(pistolCalls);

  assert(Combat.selectWeapon(Combat.SHOTGUN) === true,
    '1c-2. setup: the shotgun is granted and selected');
  const shotgunCalls = recordFrame();
  const withShotgun = readouts(shotgunCalls);

  assert(withPistol.AMMO === '' + Combat.ammo.bullets,
    '1c-i. with the PISTOL in hand the ammo readout shows the ' +
    Weapons.TABLE.pistol.ammo + ' count ("' + withPistol.AMMO + '" === ' +
    Combat.ammo.bullets + ')');
  assert(withShotgun.AMMO === '' + Combat.ammo.shells &&
    withShotgun.AMMO !== withPistol.AMMO,
    '1c-ii. selecting the SHOTGUN moves the SAME readout to the ' +
    Weapons.TABLE.shotgun.ammo + ' count ("' + withShotgun.AMMO + '" === ' +
    Combat.ammo.shells + ', against "' + withPistol.AMMO + '" for the pistol) — the ' +
    'readout follows the weapon, and the expectation is derived from Weapons.TABLE');

  // ---------------------------------------------------------------------------
  // 1d. THE WEAPON NAME (HUD-02) — and it changes with the weapon.
  // ---------------------------------------------------------------------------
  assert(withPistol.WEAPON === HUD.WEAPON_NAMES[Combat.PISTOL] &&
    withShotgun.WEAPON === HUD.WEAPON_NAMES[Combat.SHOTGUN],
    '1d-i. HUD-02: the overlay names the weapon in hand ("' + withPistol.WEAPON +
    '" for the pistol, "' + withShotgun.WEAPON + '" for the shotgun)');
  assert(withPistol.WEAPON !== withShotgun.WEAPON,
    '1d-ii. CONTROL for 1d: the two recordings carry DIFFERENT weapon names — the ' +
    'readout tracks Combat.weapon rather than printing a constant');
})();

// ---------------------------------------------------------------------------
// 1e. THE KILL TALLY (HUD-02) — defeated out of total, and killing one enemy moves
//     the tally by exactly one while the total stays put.
// ---------------------------------------------------------------------------
(function () {
  freshPlaying();
  const before = readouts(recordFrame());
  assert(before.KILLS === Game.kills + ' / ' + Game.totalKills && Game.totalKills > 0,
    '1e-i. HUD-02: the kill tally reads DEFEATED out of TOTAL ("' + before.KILLS +
    '" === ' + Game.kills + ' / ' + Game.totalKills + ')');

  const victim = nearestEnemy();
  const killsBefore = Game.kills;
  const totalBefore = Game.totalKills;
  Enemies.hurt(victim, CONFIG.ENEMY_HEALTH * 100);
  const after = readouts(recordFrame());

  assert(Game.kills === killsBefore + 1 && Game.totalKills === totalBefore,
    '1e-0. setup: one enemy died through the real damage path (kills ' + killsBefore +
    ' -> ' + Game.kills + ', total unchanged at ' + Game.totalKills + ')');
  assert(after.KILLS === (killsBefore + 1) + ' / ' + totalBefore &&
    after.KILLS !== before.KILLS,
    '1e-ii. CONTROL for 1e: killing ONE enemy moved the drawn tally by exactly one ' +
    'and left the total alone ("' + before.KILLS + '" -> "' + after.KILLS + '")');
})();

// ---------------------------------------------------------------------------
// 1f. THE CROSSHAIR IS AT THE EXACT CENTRE (HUD-03) — and it RECENTRES on a
//     resize, which is the control that proves it is derived from the live canvas
//     rather than baked at boot.
// ---------------------------------------------------------------------------
function crosshairExtent(calls) {
  const rects = fillRectsWith(calls, CONFIG.HUD_CROSSHAIR_COLOR);
  if (rects.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of rects) {
    const [x, y, w, wh] = c.args;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x + w > x1) x1 = x + w;
    if (y + wh > y1) y1 = y + wh;
  }
  return { x0, y0, x1, y1, n: rects.length };
}

function assertCentred(calls, label) {
  const e = crosshairExtent(calls);
  const w = Framebuffer.hudCanvas.width;
  const hh = Framebuffer.hudCanvas.height;
  const midX = w * 0.5;
  const midY = hh * 0.5;
  const ok = e !== null && e.n === 2 &&
    e.x0 <= midX && e.x1 >= midX && e.y0 <= midY && e.y1 >= midY &&
    near((e.x0 + e.x1) * 0.5, midX, 1) && near((e.y0 + e.y1) * 0.5, midY, 1);
  assert(ok,
    label + ' on a ' + w + 'x' + hh + ' canvas the crosshair\'s drawn extent [' +
    (e ? e.x0 + '..' + e.x1 + ', ' + e.y0 + '..' + e.y1 : 'NOTHING DRAWN') +
    '] CONTAINS the midpoint (' + midX + ',' + midY + ') and is symmetric about it ' +
    'within one pixel');
  return e;
}

const crosshairBefore = (function () {
  const calls = recordFrame();
  assert(fillRectsWith(calls, CONFIG.HUD_CROSSHAIR_OUTLINE_COLOR).length === 2,
    '1f-0. setup: the crosshair is drawn as two bright arms over two darker outline ' +
    'arms, so it reads against a lit wall as well as a dark corridor');
  return assertCentred(calls, '1f-i. HUD-03:');
})();

(function () {
  const w0 = Framebuffer.hudCanvas.width;
  const h0 = Framebuffer.hudCanvas.height;
  h.resize(900, 540);
  assert(Framebuffer.hudCanvas.width === 900 && Framebuffer.hudCanvas.height === 540,
    '1f-1. setup: the viewport really resized, and Framebuffer.resize() re-sized the ' +
    'hud backing store with it (' + w0 + 'x' + h0 + ' -> ' +
    Framebuffer.hudCanvas.width + 'x' + Framebuffer.hudCanvas.height + ')');
  const after = assertCentred(recordFrame(), '1f-ii. CONTROL for 1f:');
  assert(after !== null && crosshairBefore !== null &&
    (after.x0 !== crosshairBefore.x0 || after.y0 !== crosshairBefore.y0),
    '1f-iii. and the crosshair MOVED with the resize (from x0 ' + crosshairBefore.x0 +
    ' to ' + after.x0 + ') — it is recomputed from the live canvas every frame, not ' +
    'positioned once at boot');
  h.resize(w0, h0);
  recordFrame();
})();

// ---------------------------------------------------------------------------
// 1g / 1h / 1i. THE DAMAGE FLASH (HUD-06) — armed by real damage, decaying to
//     nothing across CONFIG.DAMAGE_FLASH_TIME, and absent entirely when the player
//     has never been hurt.
//
// The flash rectangle is identified by MEASUREMENT, not by trust: a fillRect
// covering the WHOLE canvas whose fill is red-dominant, at a non-zero alpha.
// ---------------------------------------------------------------------------
function flashRects(calls) {
  const w = Framebuffer.hudCanvas.width;
  const hh = Framebuffer.hudCanvas.height;
  return calls.filter((c) => {
    if (c.m !== 'fillRect') return false;
    const [x, y, rw, rh] = c.args;
    if (!(x === 0 && y === 0 && rw === w && rh === hh)) return false;
    const col = rgb(c.fillStyle);
    if (!col) return false;
    return col[0] > col[1] + 40 && col[0] > col[2] + 40 && c.globalAlpha > 0;
  });
}

const flashPeak = (function () {
  freshPlaying();
  Combat.armor = 0;
  const healthBefore = Combat.health;
  const lost = Combat.damagePlayer(20);
  const stamp = Combat.lastDamageAt;
  assert(lost > 0 && Combat.health === healthBefore - lost && stamp >= 0,
    '1g-0. setup: Combat.damagePlayer took ' + lost + ' real health (' + healthBefore +
    ' -> ' + Combat.health + ') and stamped Combat.lastDamageAt at ' + stamp);

  const calls = recordFrame();
  const rects = flashRects(calls);
  const col = rgb(CONFIG.DAMAGE_FLASH_COLOR);
  assert(rects.length === 1,
    '1g-i. HUD-06: the frame after a damaging hit records EXACTLY ONE full-canvas ' +
    'red-dominant rectangle (' + rects.length + ' found; fill ' +
    CONFIG.DAMAGE_FLASH_COLOR + ' = rgb(' + (col || []).join(',') + '))');
  const alpha = rects.length ? rects[0].globalAlpha : 0;
  assert(alpha > 0 && alpha <= CONFIG.DAMAGE_FLASH_ALPHA && alpha === HUD.flashAlpha(),
    '1g-ii. and it is composited at a NON-ZERO alpha bounded by ' +
    'CONFIG.DAMAGE_FLASH_ALPHA (' + alpha.toFixed(4) + ' <= ' +
    CONFIG.DAMAGE_FLASH_ALPHA + '), exactly the value HUD.flashAlpha() derives ' +
    'from Game.time - Combat.lastDamageAt');
  assert(alpha < 1,
    '1g-iii. the peak alpha leaves the world VISIBLE through the flash (' +
    alpha.toFixed(4) + ' < 1) — a player being shot at must still be able to see');
  return { alpha, stamp };
})();

(function () {
  // Advance simulation time past HALF of the flash window using real frames at the
  // delta clamp, so the age is accumulated by the same Game.step the game uses.
  const half = CONFIG.DAMAGE_FLASH_TIME * 0.5;
  const bigMs = CONFIG.DT_MAX * 1000;
  while (Game.time - flashPeak.stamp < half) raf.step(bigMs);
  const midCalls = recordFrame(bigMs);
  const mid = flashRects(midCalls);
  const age = Game.time - Combat.lastDamageAt;

  assert(Combat.lastDamageAt === flashPeak.stamp,
    '1h-0. setup: no NEW damage landed during the decay, so the ages below are all ' +
    'measured against the same stamp (' + flashPeak.stamp.toFixed(4) + ')');
  assert(mid.length === 1 && mid[0].globalAlpha < flashPeak.alpha &&
    mid[0].globalAlpha === HUD.flashAlpha(),
    '1h-i. HUD-06: past half of CONFIG.DAMAGE_FLASH_TIME (age ' + age.toFixed(3) +
    's of ' + CONFIG.DAMAGE_FLASH_TIME + 's) the flash alpha has DECAYED to ' +
    (mid.length ? mid[0].globalAlpha.toFixed(4) : 'n/a') + ', strictly below the peak ' +
    flashPeak.alpha.toFixed(4));

  while (Game.time - Combat.lastDamageAt <= CONFIG.DAMAGE_FLASH_TIME) raf.step(bigMs);
  const goneCalls = recordFrame(bigMs);
  assert(Combat.lastDamageAt === flashPeak.stamp,
    '1h-1. setup: still the same stamp past the end of the window (age ' +
    (Game.time - Combat.lastDamageAt).toFixed(3) + 's)');
  assert(flashRects(goneCalls).length === 0,
    '1h-ii. and past CONFIG.DAMAGE_FLASH_TIME the flash rectangle is NOT DRAWN AT ' +
    'ALL (' + flashRects(goneCalls).length + ' found) — it decays to nothing rather ' +
    'than to a faint permanent tint');
})();

(function () {
  // 1i — THE CONTROL FOR THE WHOLE FLASH: with the never-damaged sentinel in place,
  // no frame at any simulation time draws a flash. This is what separates "the
  // flash tracks the damage stamp" from "the flash tracks the clock".
  freshPlaying();
  assert(Combat.lastDamageAt === -1,
    '1i-0. setup: a rebuilt world leaves Combat.lastDamageAt at the never-damaged ' +
    'sentinel (' + Combat.lastDamageAt + ')');
  const early = flashRects(recordFrame());
  frames(30);
  const late = flashRects(recordFrame());
  assert(Combat.lastDamageAt === -1,
    '1i-1. setup: the player took no damage across those frames, so the sentinel ' +
    'still holds and the claim below is not vacuous');
  assert(early.length === 0 && late.length === 0,
    '1i. CONTROL for 1g/1h: with Combat.lastDamageAt at the never-damaged sentinel, ' +
    'NO frame draws a flash — neither on the first frame nor ' +
    Game.time.toFixed(2) + 's of simulation later (' + early.length + ' and ' +
    late.length + ' rectangles) — so the flash tracks the DAMAGE STAMP, not the clock');
})();

// ---------------------------------------------------------------------------
// 1j. STATE SCOPE (D-06) — the in-game overlay draws ONLY while playing, and the
//     title screen draws only outside it. The two recordings are each other's
//     control, so neither claim can pass by drawing nothing at all.
// ---------------------------------------------------------------------------
(function () {
  const playing = recordFrame();
  Game.setState(S.TITLE);
  const title = recordFrame();

  assert(LABELS.every((l) => textsOf(playing).indexOf(l) >= 0) &&
    !hasText(playing, HUD.TITLE_PROMPT),
    '1j-i. a PLAYING frame records all five status-bar labels and NONE of the title ' +
    'screen\'s prompt ("' + HUD.TITLE_PROMPT + '")');
  assert(hasText(title, HUD.TITLE_PROMPT) &&
    !LABELS.some((l) => textsOf(title).indexOf(l) >= 0),
    '1j-ii. CONTROL for 1j: a TITLE frame records that prompt and NONE of the ' +
    'status-bar readouts — the overlay is scoped to the playing state, and each ' +
    'recording is the other\'s falsifiability control');
  assert(fillRectsWith(title, CONFIG.HUD_CROSSHAIR_COLOR).length === 0 &&
    fillRectsWith(playing, CONFIG.HUD_CROSSHAIR_COLOR).length === 2,
    '1j-iii. and the crosshair is drawn on the playing frame only (2 arms while ' +
    'playing, 0 on the title screen) — you cannot aim at a menu');
  freshPlaying();
})();

// ---------------------------------------------------------------------------
// 1k. NO BLIT, NO CHURN (D-01, threats T-06-06 / T-06-11) — across 200 recorded
//     frames the overlay never touches putImageData or getImageData, and the ONE
//     metrics record is the same object by reference at the end as at the start.
// ---------------------------------------------------------------------------
(function () {
  const metricsBefore = HUD.METRICS;
  Combat.health = Combat.maxHealth;      // keep the run alive across 200 frames
  let blits = 0;
  let texts = 0;
  hudCalls.length = 0;
  recording = true;
  for (let i = 0; i < 200; i++) {
    hudCalls.length = 0;
    raf.step(FRAME_MS);
    blits += blitsOf(hudCalls);
    texts += textsOf(hudCalls).length;
  }
  recording = false;

  assert(blits === 0,
    '1k-i. across 200 recorded frames the hud context received ZERO putImageData and ' +
    'ZERO getImageData calls (' + blits + ') — the once-per-frame blit still belongs ' +
    'to Framebuffer.present() alone, and getImageData is never a tainting risk here');
  assert(texts > 0 && Game.state === S.PLAYING,
    '1k-ii. setup: those frames were really painting a playing overlay (' + texts +
    ' text calls, state "' + Game.state + '") — the zero above is not the zero of a ' +
    'HUD that drew nothing');
  assert(HUD.METRICS === metricsBefore,
    '1k-iii. HUD.METRICS is the SAME OBJECT by reference after 200 frames — the ' +
    'layout is recomputed in place, never reallocated (threat T-06-11)');
})();

// ===========================================================================
// ===========================================================================
// SECTION 2 — THE MINIMAP (HUD-05; 06-CONTEXT D-04).
// ===========================================================================
// ===========================================================================

// The box size the CONFIG fraction derives from the live hud canvas height —
// computed here the same way js/hud.js computes it, from the same constant, so the
// expectation moves with a retune instead of going stale.
const expectedBox = () =>
  Math.max(8, Math.round(CONFIG.MINIMAP_BOX_FRAC * Framebuffer.hudCanvas.height));

// Project a world point into hud-canvas pixels through the SAME scale and origin
// the grid was painted with — the harness's independent copy of the production
// projection, so "the dot is where the map says that cell is" is a real claim.
function projected(wx, wy) {
  const m = HUD.METRICS;
  return {
    x: m.mapX + HUD.minimapGridX + wx * HUD.minimapScale,
    y: m.mapY + HUD.minimapGridY + wy * HUD.minimapScale
  };
}

// The centre of a recorded marker rectangle.
const rectCentre = (c) => ({ x: c.args[0] + c.args[2] * 0.5, y: c.args[1] + c.args[3] * 0.5 });

const solidCells = () => {
  let n = 0;
  for (let my = 0; my < Level.HEIGHT; my++) {
    for (let mx = 0; mx < Level.WIDTH; mx++) if (Level.isSolid(mx, my)) n += 1;
  }
  return n;
};

const MARKER_COLORS = {
  player: CONFIG.MINIMAP_PLAYER_COLOR,
  enemy: CONFIG.MINIMAP_ENEMY_COLOR,
  pickup: CONFIG.MINIMAP_PICKUP_COLOR,
  exit: CONFIG.MINIMAP_EXIT_COLOR
};
const markerCount = (calls, kind) => fillRectsWith(calls, MARKER_COLORS[kind]).length;

// ---------------------------------------------------------------------------
// 2a. THE PREBUILD — HUD.reset() paints the grid into an OFFSCREEN canvas of the
//     derived box size, and touches the hud context not once while doing it.
// ---------------------------------------------------------------------------
(function () {
  freshPlaying();
  const rec = recordOffscreen(() => HUD.reset());
  const canvas = HUD.minimapCanvas;
  const box = expectedBox();

  assert(canvas !== null && canvas.nodeName === 'CANVAS' &&
    canvas.width === box && canvas.height === box,
    '2a-i. HUD-05: after HUD.reset the minimap is an OFFSCREEN canvas of the derived ' +
    'box size (' + (canvas ? canvas.width + 'x' + canvas.height : 'MISSING') + ' === ' +
    box + 'x' + box + ', i.e. CONFIG.MINIMAP_BOX_FRAC ' + CONFIG.MINIMAP_BOX_FRAC +
    ' of the ' + Framebuffer.hudCanvas.height + 'px hud canvas)');
  assert(rec.hud.length === 0,
    '2a-ii. and building it made ZERO calls on the hud context (' + rec.hud.length +
    ') — the prebuild is entirely offscreen, so it can never cost a frame or ' +
    'disturb the overlay');
  assert(rec.off.filter((c) => c.m === 'fillRect').length > 0,
    '2a-iii. CONTROL for 2a-ii: the OFFSCREEN recording of the same reset is full of ' +
    'drawing (' + rec.off.filter((c) => c.m === 'fillRect').length + ' fillRects) — ' +
    'the zero above is the zero of the right surface, not of a reset that did nothing');
})();

// ---------------------------------------------------------------------------
// 2b. ONE BLIT PER FRAME (threat T-06-10) — the static grid is COMPOSITED, never
//     redrawn cell by cell, and the per-frame cost does not scale with the level.
// ---------------------------------------------------------------------------
(function () {
  const buildsBefore = HUD.minimapBuilds;
  const calls = recordFrame();
  const draws = calls.filter((c) => c.m === 'drawImage');
  const ofMap = draws.filter((c) => c.args[0] === HUD.minimapCanvas);
  const cells = Level.WIDTH * Level.HEIGHT;
  const dots = liveEnemies() + activePickups() + 2;   // + the player + the exit

  assert(draws.length === 1 && ofMap.length === 1,
    '2b-i. HUD-05: one playing frame records EXACTLY ONE drawImage, and its source is ' +
    'HUD.minimapCanvas (' + draws.length + ' drawImage(s), ' + ofMap.length +
    ' of the minimap) — the grid is composited, not repainted');
  assert(calls.length < cells,
    '2b-ii. THE WHOLE overlay frame made ' + calls.length + ' recorded calls, fewer ' +
    'than the ' + cells + ' cells of the level — the per-frame cost CANNOT be ' +
    'scaling with Level.WIDTH x Level.HEIGHT');
  assert(calls.length <= 40 + dots,
    '2b-iii. and it is bounded by a small constant plus the dot count (' +
    calls.length + ' <= 40 + ' + dots + ') — a constant number of bar, crosshair and ' +
    'composite calls, plus one marker per live entity');

  frames(30);
  assert(HUD.minimapBuilds === buildsBefore,
    '2b-iv. across 30 further frames the grid was rebuilt ZERO times (builds still ' +
    HUD.minimapBuilds + ') — the rebuild test is an integer comparison, not a rebuild');
})();

// ---------------------------------------------------------------------------
// 2c. THE LAYOUT IS THE REAL PARSED LEVEL — one filled rectangle per solid cell in
//     a DIFFERENT colour from the floor, counted against Level.cells, with a
//     one-extra-wall control that proves the count is measuring the map.
// ---------------------------------------------------------------------------
(function () {
  assert(CONFIG.MINIMAP_SOLID_COLOR !== CONFIG.MINIMAP_FLOOR_COLOR,
    '2c-0. setup: solid and floor cells are drawn in DIFFERENT colours ("' +
    CONFIG.MINIMAP_SOLID_COLOR + '" vs "' + CONFIG.MINIMAP_FLOOR_COLOR + '")');

  const before = recordOffscreen(() => HUD.buildMinimap());
  const solidsDrawn = fillRectsWith(before.off, CONFIG.MINIMAP_SOLID_COLOR).length;
  const floorsDrawn = fillRectsWith(before.off, CONFIG.MINIMAP_FLOOR_COLOR).length;
  const solids = solidCells();
  const cells = Level.WIDTH * Level.HEIGHT;

  assert(solidsDrawn === solids && floorsDrawn === cells - solids,
    '2c-i. HUD-05: the prebuild painted one rectangle per SOLID cell (' + solidsDrawn +
    ' === ' + solids + ' derived from Level.cells) and one per FLOOR cell (' +
    floorsDrawn + ' === ' + (cells - solids) + ') — the grid drawn is the parsed ' +
    'level, not a placeholder');

  // THE CONTROL: turn one floor cell into a wall, rebuild, and the count must move
  // by exactly one. A picture that ignores the map would not notice.
  let target = -1;
  for (let i = 0; i < Level.cells.length && target < 0; i++) if (Level.cells[i] === 0) target = i;
  const saved = Level.cells[target];
  Level.cells[target] = Level.STONE_ID;
  const after = recordOffscreen(() => HUD.buildMinimap());
  const solidsAfter = fillRectsWith(after.off, CONFIG.MINIMAP_SOLID_COLOR).length;
  Level.cells[target] = saved;
  HUD.buildMinimap();

  assert(target >= 0 && solidsAfter === solidsDrawn + 1,
    '2c-ii. CONTROL for 2c: making ONE more cell solid (cell ' + target + ' at ' +
    (target % Level.WIDTH) + ',' + Math.floor(target / Level.WIDTH) + ') moved the ' +
    'drawn wall count by exactly one (' + solidsDrawn + ' -> ' + solidsAfter + ')');
  assert(fillRectsWith(recordOffscreen(() => HUD.buildMinimap()).off,
    CONFIG.MINIMAP_SOLID_COLOR).length === solids,
    '2c-iii. and restoring the cell restored the count (' + solids + ') — the map ' +
    'the rest of this section measures is the shipped one');
})();

// ---------------------------------------------------------------------------
// 2d. THE PLAYER, WITH A FACING INDICATOR — both plotted through the same
//     projection as the grid, and both moving when the pose moves.
// ---------------------------------------------------------------------------
function poseRecording(x, y, dx, dy) {
  Player.x = x;
  Player.y = y;
  Player.setDir(dx, dy);
  const calls = recordFrame();
  const dot = fillRectsWith(calls, CONFIG.MINIMAP_PLAYER_COLOR);
  const line = calls.filter((c) => c.m === 'lineTo');
  return { calls, dot: dot.length ? rectCentre(dot[dot.length - 1]) : null,
    tip: line.length ? { x: line[0].args[0], y: line[0].args[1] } : null };
}

(function () {
  freshPlaying();
  const start = Level.playerStart;
  const a = poseRecording(start.x, start.y, 1, 0);
  const want = projected(Player.x, Player.y);
  assert(a.dot !== null && near(a.dot.x, want.x, 0.6) && near(a.dot.y, want.y, 0.6),
    '2d-i. HUD-05: the player marker sits at the position Player.x/Player.y maps to ' +
    'through the grid\'s own scale (drawn ' + (a.dot ? a.dot.x.toFixed(1) + ',' +
      a.dot.y.toFixed(1) : 'NONE') + ' vs projected ' + want.x.toFixed(1) + ',' +
    want.y.toFixed(1) + ')');
  assert(a.tip !== null,
    '2d-ii. and a facing indicator is drawn from it (tip at ' +
    (a.tip ? a.tip.x.toFixed(1) + ',' + a.tip.y.toFixed(1) : 'NONE') + ')');

  const b = poseRecording(start.x + 3, start.y + 2, 0, 1);
  const want2 = projected(Player.x, Player.y);
  assert(b.dot !== null && near(b.dot.x, want2.x, 0.6) && near(b.dot.y, want2.y, 0.6) &&
    (Math.abs(b.dot.x - a.dot.x) > 0.5 || Math.abs(b.dot.y - a.dot.y) > 0.5),
    '2d-iii. CONTROL for 2d: a DIFFERENT pose moved the marker (' + a.dot.x.toFixed(1) +
    ',' + a.dot.y.toFixed(1) + ' -> ' + b.dot.x.toFixed(1) + ',' + b.dot.y.toFixed(1) +
    ') and it still lands on the projection of the new position');
  assert(b.tip !== null &&
    (Math.abs(b.tip.x - a.tip.x) > 0.5 || Math.abs(b.tip.y - a.tip.y) > 0.5),
    '2d-iv. and the FACING endpoint moved with the direction vector (' +
    a.tip.x.toFixed(1) + ',' + a.tip.y.toFixed(1) + ' -> ' + b.tip.x.toFixed(1) + ',' +
    b.tip.y.toFixed(1) + ') — it tracks Player.dirX/dirY, not merely the position');
})();

// ---------------------------------------------------------------------------
// 2e. THE ENTITIES — every live enemy, every uncollected pickup, the player and
//     the exit, each in its own colour, counted against the live lists.
// ---------------------------------------------------------------------------
(function () {
  freshPlaying();
  const names = Object.keys(MARKER_COLORS);
  const colors = names.map((n) => MARKER_COLORS[n]);
  assert(new Set(colors).size === names.length &&
    colors.indexOf(CONFIG.MINIMAP_SOLID_COLOR) < 0 &&
    colors.indexOf(CONFIG.MINIMAP_FLOOR_COLOR) < 0,
    '2e-0. setup: the four marker colours are all DISTINCT from each other and from ' +
    'the two grid colours (' + colors.join(', ') + ') — otherwise two counts would ' +
    'silently be one');

  const calls = recordFrame();
  const enemies = markerCount(calls, 'enemy');
  const pickups = markerCount(calls, 'pickup');
  const player = markerCount(calls, 'player');
  const exit = markerCount(calls, 'exit');

  assert(enemies === liveEnemies() && enemies > 0,
    '2e-i. HUD-05: one enemy dot per LIVE non-corpse enemy (' + enemies + ' === ' +
    liveEnemies() + ', derived from Enemies.list)');
  assert(pickups === activePickups() && pickups > 0,
    '2e-ii. one pickup dot per ACTIVE pickup (' + pickups + ' === ' + activePickups() +
    ', derived from Pickups.list)');
  assert(player === 1 && exit === 1 && Level.exit !== null,
    '2e-iii. exactly one player marker and exactly one exit marker (' + player + ', ' +
    exit + ')');
  assert(enemies + pickups + player + exit ===
    liveEnemies() + activePickups() + 2,
    '2e-iv. and the total dot count is exactly the live world plus the player and ' +
    'the exit (' + (enemies + pickups + player + exit) + ') — nothing is plotted ' +
    'that is not in a list, and nothing in a list is missing');
})();

// ---------------------------------------------------------------------------
// 2f. THE DOTS TRACK THE WORLD — a killed enemy and a collected item each leave
//     the map, by the SAME flags the render passes read.
// ---------------------------------------------------------------------------
(function () {
  freshPlaying();
  const before = recordFrame();
  const enemiesBefore = markerCount(before, 'enemy');

  const victim = nearestEnemy();
  Enemies.hurt(victim, CONFIG.ENEMY_HEALTH * 100);
  // Let the death animation reach the terminal corpse state — the dot must go when
  // the enemy stops being a threat, and `alive` is cleared on the lethal hit.
  frames(60);
  const afterKill = recordFrame();

  assert(markerCount(afterKill, 'enemy') === enemiesBefore - 1 &&
    markerCount(afterKill, 'enemy') === liveEnemies(),
    '2f-i. HUD-05: killing ONE enemy removed exactly ONE enemy dot (' + enemiesBefore +
    ' -> ' + markerCount(afterKill, 'enemy') + ', still === the live count ' +
    liveEnemies() + ') — the map reads the same flags the sprite pass reads');

  const pickupsBefore = markerCount(afterKill, 'pickup');
  const activeBefore = activePickups();
  let item = null;
  for (const e of Pickups.list) if (e.active === true) { item = e; break; }
  Player.x = item.x;
  Player.y = item.y;
  const afterTake = recordFrame();

  assert(activePickups() === activeBefore - 1 && item.active === false,
    '2f-0. setup: walking onto the item collected exactly one pickup through the real ' +
    'proximity path (' + activeBefore + ' -> ' + activePickups() + ' active)');
  assert(markerCount(afterTake, 'pickup') === pickupsBefore - 1 &&
    markerCount(afterTake, 'pickup') === activePickups(),
    '2f-ii. CONTROL pair for 2f: collecting ONE pickup removed exactly ONE pickup dot ' +
    '(' + pickupsBefore + ' -> ' + markerCount(afterTake, 'pickup') + ', still === the ' +
    'active count ' + activePickups() + ')');
})();

// ---------------------------------------------------------------------------
// 2g. THE EXIT IS ON THE MAP — in its own colour, at the position Level.exit maps
//     to. The map answers WHERE TO GO, not only where you are.
// ---------------------------------------------------------------------------
(function () {
  freshPlaying();
  const calls = recordFrame();
  const marks = fillRectsWith(calls, CONFIG.MINIMAP_EXIT_COLOR);
  const want = projected(Level.exit.x, Level.exit.y);
  const centre = marks.length ? rectCentre(marks[0]) : null;
  assert(marks.length === 1 && near(centre.x, want.x, 0.6) && near(centre.y, want.y, 0.6),
    '2g. HUD-05: the exit at cell (' + Level.exit.mx + ',' + Level.exit.my + ') is ' +
    'marked in its own colour at the position it projects to (drawn ' +
    (centre ? centre.x.toFixed(1) + ',' + centre.y.toFixed(1) : 'NONE') + ' vs ' +
    want.x.toFixed(1) + ',' + want.y.toFixed(1) + ')');
})();

// ---------------------------------------------------------------------------
// 2h. BOUNDS (threat T-06-12) — with the player driven to (and past) all four
//     corners of the level, NOTHING is plotted outside the minimap box.
// ---------------------------------------------------------------------------
(function () {
  freshPlaying();
  const corners = [[0, 0], [Level.WIDTH, 0], [0, Level.HEIGHT],
    [Level.WIDTH, Level.HEIGHT], [-5, -5], [Level.WIDTH + 5, Level.HEIGHT + 5]];
  let worst = null;
  let checked = 0;

  for (const [cx, cy] of corners) {
    Player.x = cx;
    Player.y = cy;
    const calls = recordFrame();
    const m = HUD.METRICS;
    const x0 = m.mapX, y0 = m.mapY, x1 = m.mapX + m.mapBox, y1 = m.mapY + m.mapBox;
    for (const c of calls) {
      let pts = null;
      if (c.m === 'fillRect' && Object.keys(MARKER_COLORS)
        .some((k) => MARKER_COLORS[k] === c.fillStyle)) {
        pts = [[c.args[0], c.args[1]], [c.args[0] + c.args[2], c.args[1] + c.args[3]]];
      } else if (c.m === 'moveTo' || c.m === 'lineTo') {
        pts = [[c.args[0], c.args[1]]];
      }
      if (!pts) continue;
      for (const [px, py] of pts) {
        checked += 1;
        if (!(px >= x0 && px <= x1 && py >= y0 && py <= y1)) {
          worst = 'pose (' + cx + ',' + cy + ') plotted ' + px + ',' + py +
            ' outside [' + x0 + '..' + x1 + ', ' + y0 + '..' + y1 + ']';
        }
      }
    }
  }
  assert(checked > 0 && worst === null,
    '2h. HUD-05: across all four level corners and two poses OUTSIDE the grid ' +
    'entirely, every one of the ' + checked + ' plotted minimap coordinates lies ' +
    'inside the box — every point goes through the one clamped projection' +
    (worst ? ' [OFFENDER: ' + worst + ']' : ''));
})();

// ---------------------------------------------------------------------------
// 2i. A RESTART REBUILDS THE MAP — and the dot counts come back to the full
//     populated level.
// ---------------------------------------------------------------------------
(function () {
  const before = HUD.minimapCanvas;
  const w = before.width, hgt = before.height;
  const builds = HUD.minimapBuilds;

  Game.restart();
  releaseAll();
  const after = HUD.minimapCanvas;
  const calls = recordFrame();
  const ofMap = calls.filter((c) => c.m === 'drawImage' && c.args[0] === after);

  assert(after !== before && HUD.minimapBuilds === builds + 1 &&
    after.width === w && after.height === hgt,
    '2i-i. Game.restart() REBUILT the minimap through HUD.reset (a new canvas, builds ' +
    builds + ' -> ' + HUD.minimapBuilds + ') at the same derived size (' + after.width +
    'x' + after.height + ') — a reparsed level cannot leave a stale picture up');
  assert(ofMap.length === 1 && calls.filter((c) => c.m === 'drawImage').length === 1,
    '2i-ii. and the frame after the restart still composites it with exactly ONE ' +
    'drawImage');
  assert(markerCount(calls, 'enemy') === liveEnemies() &&
    markerCount(calls, 'pickup') === activePickups() &&
    markerCount(calls, 'enemy') === Enemies.list.length &&
    markerCount(calls, 'pickup') === Pickups.list.length,
    '2i-iii. and the dot counts are back to the FULL populated level (' +
    markerCount(calls, 'enemy') + ' enemies of ' + Enemies.list.length + ', ' +
    markerCount(calls, 'pickup') + ' pickups of ' + Pickups.list.length + ') — the ' +
    'restart resurrected the world and the map with it');
})();

finish('ALL_HUD_CONTRACTS_PASS');
