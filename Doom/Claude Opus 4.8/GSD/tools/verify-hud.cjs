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

finish('ALL_HUD_CONTRACTS_PASS');
