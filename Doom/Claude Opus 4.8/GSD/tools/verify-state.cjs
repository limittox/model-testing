/*
 * tools/verify-state.cjs — the PHASE 6 GAME-STATE MACHINE harness (LVL-03..06).
 *
 * NODE-ONLY (never referenced by index.html). Built on tools/boot.cjs: it boots the
 * SHIPPED script list in the SHIPPED order into one vm context with a stubbed DOM,
 * fires the window load event (which wires the seams and starts the loop), then
 * drives REAL FRAMES through the manual requestAnimationFrame scheduler and REAL
 * canvas click events through the recorded DOM handlers.
 *
 * WHAT THIS HARNESS OWNS, AND WHY IT HAS TO EXIST SEPARATELY:
 *   Game.frame gates the STEP on Game.state === playing; Game.step itself is
 *   deliberately UN-GATED, because every Phase 1-5 harness drives it directly with
 *   a manufactured delta. That asymmetry means NO Phase 1-5 harness can prove the
 *   freeze — they would all pass whether the gate existed or not. This file is the
 *   one place the gate is proven, and it proves it through the REAL LOOP
 *   (h.raf.step), never through a direct step call.
 *
 * EVERY NEGATIVE CLAIM IS CONTROL-PAIRED. A freeze proof that cannot distinguish
 * "the gate froze the sim" from "the scenario never moved anything" proves nothing,
 * so each freeze assertion is followed by the SAME frames, the SAME held intent and
 * the SAME driver in the playing state, asserted to MOVE.
 *
 * Prints PASS/FAIL per assertion and the terminal token ALL_STATE_CONTRACTS_PASS
 * only when every assertion passed.
 */

'use strict';

const { boot, assert, finish } = require('./boot.cjs');

const h = boot({});
h.fireLoad();

const s = h.sandbox;
const CONFIG = s.CONFIG;
const Level = s.Level;
const Player = s.Player;
const Input = s.Input;
const Sound = s.Sound;
const Combat = s.Combat;
const Enemies = s.Enemies;
const Entities = s.Entities;
const Pickups = s.Pickups;
const Weapons = s.Weapons;
const Raycaster = s.Raycaster;
const Framebuffer = s.Framebuffer;
const Textures = s.Textures;
const HUD = s.HUD;
const Game = s.Game;
const raf = h.raf;
const S = Game.STATES;

const FRAME_MS = 1000 / 60;
const FRAME_DT = FRAME_MS / 1000;
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('--- game-state machine harness ---');
console.log('boot state "' + Game.state + '", ' + Level.spawns.length + ' spawns, exit ' +
  (Level.exit ? '(' + Level.exit.mx + ',' + Level.exit.my + ')' : 'MISSING'));
console.log('');

// ---------------------------------------------------------------------------
// THE #hud OVERLAY RECORDER.
//
// h.canvas('hud').getContext('2d') returns a CACHED object — the very same object
// Framebuffer.hudCtx holds — so wrapping its drawing methods here observes exactly
// what HUD.render draws. Each wrapper records the method name, its arguments and
// the fillStyle / globalAlpha in force at the time, then delegates to the original
// no-op, so the recording never changes behaviour.
//
// putImageData / getImageData are wrapped TOO, deliberately: the D-01 contract says
// the overlay must never blit, and a recorder that did not watch for it could not
// catch a violation. (The stub's putImageData also increments the SHARED putCount,
// so a violation would additionally break the once-per-frame present assertions.)
// ---------------------------------------------------------------------------
const hudCtx = h.canvas('hud').getContext('2d');
const hudCalls = [];
let recording = false;

for (const name of ['clearRect', 'fillRect', 'strokeRect', 'fillText', 'strokeText',
  'drawImage', 'putImageData', 'getImageData', 'save', 'restore', 'beginPath',
  'closePath', 'moveTo', 'lineTo', 'arc', 'rect', 'fill', 'stroke', 'translate',
  'rotate', 'scale', 'setTransform', 'resetTransform', 'measureText']) {
  const orig = hudCtx[name];
  if (typeof orig !== 'function') continue;
  hudCtx[name] = function () {
    if (recording) {
      hudCalls.push({
        m: name,
        args: Array.prototype.slice.call(arguments),
        fillStyle: hudCtx.fillStyle,
        globalAlpha: hudCtx.globalAlpha
      });
    }
    return orig.apply(hudCtx, arguments);
  };
}

// Clear the recording, drive ONE REAL FRAME through the loop, and return the calls
// that frame made on the hud context. Returns a copy, so a later frame's recording
// cannot mutate an earlier snapshot a control assertion is still holding.
function recordFrame(ms) {
  hudCalls.length = 0;
  recording = true;
  raf.step(ms === undefined ? FRAME_MS : ms);
  recording = false;
  return hudCalls.slice();
}

const textsOf = (calls) => calls.filter((c) => c.m === 'fillText').map((c) => String(c.args[0]));
const hasText = (calls, needle) => textsOf(calls).some((t) => t.indexOf(needle) >= 0);
const blitsOf = (calls) => calls.filter((c) => c.m === 'putImageData' || c.m === 'getImageData').length;

// ---------------------------------------------------------------------------
// Scenario helpers.
// ---------------------------------------------------------------------------
const enemyPoses = () => Enemies.list.map((e) => e.x + ',' + e.y + ',' + e.state + ',' + e.health);
const projFlags = () => Enemies.projectiles.map((p) => (p.active ? 1 : 0)).join('');
// The enemy marker count, DERIVED from the spawn table — never a literal, so a map
// edit moves the expectation with the map.
const enemyMarkers = () => Level.spawns.filter((sp) => sp.type === 'enemy').length;
// The spawn-derived BILLBOARD count: one entity per spawn that has a sprite
// descriptor. The exit deliberately has none (assertion 3d).
const spawnBillboards = () =>
  Level.spawns.filter((sp) => Object.prototype.hasOwnProperty.call(Entities.SPRITE_FOR, sp.type)).length;

function hold(code) { Input.keys[code] = true; }
function releaseAll() { Input.reset(); }

// Drive n REAL frames through the loop (the only driver that exercises the gate).
function frames(n, ms) {
  for (let i = 0; i < n; i++) raf.step(ms === undefined ? FRAME_MS : ms);
}

// Put the player exactly on a spawn-derived cell centre.
function placeAt(x, y, dx, dy) {
  Player.x = x;
  Player.y = y;
  if (dx !== undefined) Player.setDir(dx, dy);
}

// ===========================================================================
// 1a. BOOT — the machine exists, and it booted to the TITLE state.
// ===========================================================================
(function () {
  const names = Object.keys(Game.STATES).map((k) => Game.STATES[k]).sort().join(',');
  assert(Game.state === S.TITLE && S.TITLE === 'title',
    '1a-i. the game booted into the TITLE state (Game.state === "' + Game.state + '")');
  assert(names === 'dead,playing,title,victory' && Object.keys(Game.STATES).length === 4 &&
    Object.isFrozen(Game.STATES),
    '1a-ii. Game.STATES is a FROZEN record of exactly the four names title/playing/victory/dead');
  assert(Game.result !== null && typeof Game.result === 'object' &&
    typeof Game.result.kills === 'number' && typeof Game.result.totalKills === 'number' &&
    typeof Game.result.time === 'number',
    '1a-iii. Game.result exists as a preallocated {kills,totalKills,time} record');
  assert(typeof Game.setState === 'function' && typeof Game.handleGesture === 'function' &&
    typeof Game.restart === 'function' && typeof Game.checkEndConditions === 'function',
    '1a-iv. the state API is present (setState / handleGesture / restart / checkEndConditions)');
  assert(Input.gestureHook === Game.handleGesture,
    '1a-v. main.js wired Input.gestureHook STRICTLY to Game.handleGesture (the LVL-06 seam)');
})();

// ===========================================================================
// 1g (first half). NO AUDIO CONTEXT — asserted before anything else can build
// one, and re-asserted at the very end of the run.
// ===========================================================================
function noAudioContext(label) {
  const noGlobal = typeof s.AudioContext === 'undefined' &&
    typeof s.webkitAudioContext === 'undefined';
  // The STRONGER form of "Sound.ctx is null": no context field on Sound AT ALL.
  // 06-01 deliberately ships no placeholder, so that tools/verify-pickups.cjs
  // assertion 0d ('!("ctx" in Sound)') survives this plan untouched.
  const noField = !('ctx' in Sound) && !('audioContext' in Sound);
  assert(noGlobal && noField, label);
}
noAudioContext('1g-i. at boot: no AudioContext/webkitAudioContext binding in the sandbox and no ' +
  'context field on Sound — this plan creates no audio context');

// ===========================================================================
// 1h. THE EXIT IS DERIVED FROM THE SPAWN TABLE, never hardcoded.
// ===========================================================================
(function () {
  const exitSpawns = Level.spawns.filter((sp) => sp.type === 'exit');
  const e = Level.exit;
  assert(e !== null && typeof e === 'object',
    '1h-i. Level.exit is a non-null record');
  assert(exitSpawns.length === 1 && e === exitSpawns[0],
    '1h-ii. Level.exit IS (by reference) the single spawn of type "exit" in Level.spawns — ' +
    'read from the spawn table, not a copy and not a literal');
  assert(Level.cells[e.my * Level.WIDTH + e.mx] === 0,
    '1h-iii. the exit cell (' + e.mx + ',' + e.my + ') is FLOOR in Level.cells — a cell the ' +
    'player can actually stand on');
  assert(near(e.x, e.mx + 0.5, 1e-12) && near(e.y, e.my + 0.5, 1e-12),
    '1h-iv. Level.exit x/y is that cell\'s CENTRE (' + e.x + ',' + e.y + ')');
})();

// ===========================================================================
// 1e. GESTURE PRECONDITIONS — measured BEFORE any click exists in the timeline.
// ===========================================================================
assert(Game.state === S.TITLE && Input.lockAttempts === 0 && Sound.unlockCalls === 0,
  '1e. before any click: state is title, Input.lockAttempts is 0 and Sound.unlockCalls is 0 — ' +
  'nothing was requested at load');

// ===========================================================================
// 1b + 1d. FREEZE, AND RENDER-WHILE-FROZEN. A fully-held forward intent, 60 REAL
//          frames through the loop: nothing in the simulation moves, and the
//          world still presents exactly once per frame.
// ===========================================================================
const frozen = (function () {
  hold('KeyW');
  hold('ShiftLeft');   // held RUN as well — the largest possible per-frame step

  const before = {
    x: Player.x, y: Player.y, dirX: Player.dirX, dirY: Player.dirY,
    time: Game.time, enemies: enemyPoses().join('|'), puts: h.putCount()
  };

  frames(60);

  const poseSame = Player.x === before.x && Player.y === before.y &&
    Player.dirX === before.dirX && Player.dirY === before.dirY;
  const timeSame = Game.time === before.time;
  const enemiesSame = enemyPoses().join('|') === before.enemies;
  const puts = h.putCount() - before.puts;

  assert(poseSame && timeSame,
    '1b-i. 60 real frames in TITLE with forward+run HELD leave Player.x/y/dirX/dirY and ' +
    'Game.time byte-identical (the simulation is frozen)');
  assert(enemiesSame,
    '1b-ii. those same 60 frozen frames leave every enemy position/state/health identical (' +
    Enemies.list.length + ' enemies)');
  assert(puts === 60,
    '1d. across those 60 FROZEN frames h.putCount() advanced by exactly 60 (' + puts +
    ') — the world still renders and still presents ONCE PER FRAME; frozen never means black');

  return before;
})();

// ===========================================================================
// 1o. THE TITLE SCREEN IS DRAWN — recorded on the real overlay context, while
//     still in the title state.
// ===========================================================================
const titleFrame = (function () {
  const calls = recordFrame();
  const texts = textsOf(calls);
  assert(texts.some((t) => t.indexOf('CLICK') >= 0),
    '1o-i. a title frame records a fillText containing the word CLICK (the start prompt: "' +
    (texts.filter((t) => t.indexOf('CLICK') >= 0)[0] || '') + '")');
  assert(texts.some((t) => t.indexOf('WASD') >= 0) && texts.some((t) => t.indexOf('FIRE') >= 0),
    '1o-ii. a title frame records fillText lines NAMING the movement and fire controls (' +
    texts.length + ' text lines drawn)');
  assert(blitsOf(calls) === 0,
    '1o-iii. the title frame recorded ZERO putImageData/getImageData calls on the hud context ' +
    '(D-01: the overlay composites, it never blits)');
  assert(calls.some((c) => c.m === 'clearRect') &&
    calls.some((c) => c.m === 'fillRect' && c.globalAlpha === CONFIG.SCREEN_SCRIM_ALPHA),
    '1o-iv. the title frame cleared the whole overlay and painted the translucent scrim ' +
    'under the text (alpha ' + CONFIG.SCREEN_SCRIM_ALPHA + ')');
  return calls;
})();

// ===========================================================================
// 1f. THE SINGLE GESTURE — ONE click does all three things.
// ===========================================================================
(function () {
  const locks0 = Input.lockAttempts;
  const unlocks0 = Sound.unlockCalls;

  h.dispatch('game', 'click');

  assert(Game.state === S.PLAYING,
    '1f-i. ONE canvas click moved the state title -> playing');
  assert(Input.lockAttempts - locks0 === 1,
    '1f-ii. that SAME click requested pointer lock exactly once (lockAttempts +' +
    (Input.lockAttempts - locks0) + ')');
  assert(Sound.unlockCalls - unlocks0 === 1,
    '1f-iii. that SAME click invoked the audio unlock seam exactly once (unlockCalls +' +
    (Sound.unlockCalls - unlocks0) + ') — one gesture, three effects');
  assert(Input.gestureError === null,
    '1f-iv. the gesture hook did not throw (Input.gestureError is null)');
})();

// ===========================================================================
// 1c. THE CONTROL FOR 1b — the SAME 60 frames with the SAME held intent, in the
//     playing state, DO move the player and DO advance simulated time. The
//     freeze above was a real gate, not a broken scenario.
//
//     The held keys are re-installed because the title -> playing transition
//     DRAINED the input source, which is itself the subject of 1n.
// ===========================================================================
(function () {
  // Anchor in the open block so a 60-frame run cannot clip a wall and corrupt the
  // distance measurement.
  const o = Level.LANDMARKS.openCell;
  placeAt(o.x, o.y, 1, 0);
  hold('KeyW');

  const x0 = Player.x, y0 = Player.y, t0 = Game.time;
  frames(60);
  const moved = Math.hypot(Player.x - x0, Player.y - y0);
  const advanced = Game.time - t0;

  assert(moved > 0.5,
    '1c-i. CONTROL for 1b: the SAME 60 frames with forward HELD, in PLAYING, moved the ' +
    'player ' + moved.toFixed(3) + ' cells (non-zero) — the gate is real');
  assert(near(advanced, 60 * FRAME_DT, 1e-6),
    '1c-ii. CONTROL for 1b: Game.time advanced by 60 frame deltas (' + advanced.toFixed(6) +
    ' vs ' + (60 * FRAME_DT).toFixed(6) + ')');
  releaseAll();
})();

// ===========================================================================
// 1i. VICTORY — standing on the derived exit ends the run and FREEZES the stats
//     taken at that instant.
// ===========================================================================
(function () {
  // Perturb the counters first, so the stamp is provably read from the live values
  // rather than from something that happened to already be zero.
  Game.kills = 3;
  Game.totalKills = 9;
  const e = Level.exit;
  placeAt(e.x, e.y, 1, 0);

  const tAt = Game.time;
  assert(tAt > 0, '1i-0. setup: the scenario has already stepped, so Game.time > 0 (' +
    tAt.toFixed(4) + ')');

  Game.step(FRAME_DT);

  assert(Game.state === S.VICTORY,
    '1i-i. ONE step standing on Level.exit moved the state playing -> VICTORY');
  assert(Game.result.kills === 3 && Game.result.totalKills === 9,
    '1i-ii. Game.result.kills/totalKills were stamped from the LIVE counters at the transition (' +
    Game.result.kills + '/' + Game.result.totalKills + ')');
  assert(Game.result.time === Game.time && Game.result.time > 0,
    '1i-iii. Game.result.time is Game.time at the transition and is strictly > 0 (' +
    Game.result.time.toFixed(4) + ')');
  assert(near(Game.stateEnteredAt, Game.time, 1e-12),
    '1i-iv. Game.stateEnteredAt was stamped from simulated time at the transition');
})();

// ===========================================================================
// 1j. THE CONTROL FOR 1i — at EXIT_RADIUS plus a margin, 300 steps do NOT win.
//     The radius is a real threshold, not an always-true test.
//
//     SCENARIO ISOLATION: the enemy sight/attack ranges are temporarily zeroed so
//     the 5 seconds this drive covers cannot end in death instead (the claim under
//     test is the radius threshold, not enemy behaviour). Restored immediately.
// ===========================================================================
(function () {
  const sight = CONFIG.ENEMY_SIGHT_RANGE;
  const range = CONFIG.ENEMY_ATTACK_RANGE;
  CONFIG.ENEMY_SIGHT_RANGE = 0;
  CONFIG.ENEMY_ATTACK_RANGE = 0;

  Game.setState(S.PLAYING);
  const snapshot = { kills: Game.result.kills, total: Game.result.totalKills, time: Game.result.time };
  const e = Level.exit;
  const margin = 0.05;
  const d = CONFIG.EXIT_RADIUS + margin;
  // Approach the alcove from the open west side, so the pose is a legal standing
  // position at exactly radius+margin from the exit centre.
  placeAt(e.x - d, e.y, 1, 0);
  assert(!Level.isSolid(Math.floor(Player.x), Math.floor(Player.y)),
    '1j-0. setup: the control pose (' + Player.x.toFixed(2) + ',' + Player.y.toFixed(2) +
    ') is a legal floor cell exactly ' + d.toFixed(2) + ' cells from the exit centre');

  for (let i = 0; i < 300; i++) Game.step(FRAME_DT);

  assert(Game.state === S.PLAYING,
    '1j-i. CONTROL for 1i: 300 steps at EXIT_RADIUS + ' + margin + ' from the exit leave the ' +
    'state at PLAYING — the radius is a real threshold');
  assert(Game.result.kills === snapshot.kills && Game.result.totalKills === snapshot.total &&
    Game.result.time === snapshot.time,
    '1j-ii. CONTROL for 1i: Game.result was not touched by those 300 steps');

  CONFIG.ENEMY_SIGHT_RANGE = sight;
  CONFIG.ENEMY_ATTACK_RANGE = range;
})();

// ===========================================================================
// 1k. TRANSITIONS HAPPEN ONLY FROM PLAYING — a victory screen cannot re-win.
// ===========================================================================
(function () {
  Game.setState(S.VICTORY);
  const e = Level.exit;
  placeAt(e.x, e.y, 1, 0);
  const stamped = { kills: Game.result.kills, total: Game.result.totalKills, time: Game.result.time };
  // Perturb the LIVE counters, so a re-stamp would be unmistakable.
  Game.kills = 777;
  Game.totalKills = 888;

  for (let i = 0; i < 300; i++) Game.step(FRAME_DT);

  assert(Game.state === S.VICTORY,
    '1k-i. 300 further steps standing ON the exit while already in VICTORY leave the state at ' +
    'victory (checkEndConditions returns immediately outside playing)');
  assert(Game.result.kills === stamped.kills && Game.result.totalKills === stamped.total &&
    Game.result.time === stamped.time,
    '1k-ii. Game.result was NOT re-stamped, even though the live counters moved to 777/888');
})();

// ===========================================================================
// 1p. SCREEN SWITCHING — the victory recording carries the victory word and BOTH
//     stat readouts, and does NOT carry the title screen's start prompt. The
//     title recording from 1o is the paired control.
// ===========================================================================
(function () {
  const calls = recordFrame();
  const texts = textsOf(calls);
  const joined = texts.join(' | ');

  assert(texts.some((t) => t.indexOf('VICTORY') >= 0),
    '1p-i. a victory frame records the VICTORY heading');
  assert(texts.some((t) => t.indexOf('KILLS') >= 0) && texts.some((t) => t.indexOf('TIME') >= 0),
    '1p-ii. a victory frame records BOTH stat readouts — the kill tally and a time reading [' +
    joined + ']');
  assert(texts.some((t) => /\d+\s*\/\s*\d+/.test(t)) && texts.some((t) => /\d\d:\d\d/.test(t)),
    '1p-iii. the kill tally reads as a count OUT OF a total and the time reads as mm:ss');
  assert(!texts.some((t) => t.indexOf(HUD.TITLE_PROMPT) >= 0),
    '1p-iv. the victory frame does NOT contain the title screen\'s start prompt ("' +
    HUD.TITLE_PROMPT + '") — the screens really switched');
  assert(textsOf(titleFrame).some((t) => t.indexOf(HUD.TITLE_PROMPT) >= 0) &&
    !textsOf(titleFrame).some((t) => t.indexOf('VICTORY') >= 0),
    '1p-v. CONTROL for 1p: the TITLE recording does contain that prompt and does NOT contain ' +
    'the victory heading — the two recordings are genuinely different screens');
  assert(blitsOf(calls) === 0,
    '1p-vi. the victory frame recorded ZERO blits on the hud context');
})();

// ===========================================================================
// 1l. RESTART FROM VICTORY — one click on the victory screen rebuilds the world.
// ===========================================================================
(function () {
  // Perturb everything the restart must undo, so nothing can pass by never moving.
  Combat.health = 7;
  Combat.armor = 55;
  Combat.hasShotgun = true;
  Game.kills = 5;
  Game.message('PERTURBED');
  placeAt(Level.LANDMARKS.openCell.x, Level.LANDMARKS.openCell.y, 0, 1);

  h.dispatch('game', 'click');

  const ps = Level.playerStart;
  assert(Game.state === S.PLAYING,
    '1l-i. one click on the VICTORY screen returned the state to playing');
  assert(Game.time === 0,
    '1l-ii. the restart zeroed Game.time (' + Game.time + ')');
  assert(Combat.health === CONFIG.PLAYER_START_HEALTH && Combat.armor === CONFIG.PLAYER_START_ARMOR,
    '1l-iii. Combat.health/armor are back at their CONFIG start values (' + Combat.health + '/' +
    Combat.armor + ') from a perturbed 7/55');
  assert(Game.kills === 0 && Game.totalKills === enemyMarkers(),
    '1l-iv. Game.kills is 0 and Game.totalKills is the SPAWN-DERIVED enemy marker count (' +
    Game.totalKills + ' === ' + enemyMarkers() + ')');
  assert(near(Player.x, ps.x, 1e-12) && near(Player.y, ps.y, 1e-12) &&
    near(Player.dirX, ps.dirX, 1e-12) && near(Player.dirY, ps.dirY, 1e-12),
    '1l-v. the player is back at Level.playerStart with the start facing');
  assert(Game.messagesPosted === 0 && Game.activeMessage() === null,
    '1l-vi. the message ring was cleared by the rebuild (the previous world\'s messages are gone)');
})();

// ===========================================================================
// 1m. NO ORPHANED ENTITY REFERENCES AFTER A RESTART — with the exact failure the
//     reset chain prevents as its control.
// ===========================================================================
(function () {
  const list = Entities.list;
  const inList = (e) => list.indexOf(e) >= 0;

  const pickupsOk = Pickups.list.length > 0 && Pickups.list.every(inList);
  const enemiesOk = Enemies.list.length > 0 && Enemies.list.every(inList);
  const expectLen = spawnBillboards() + CONFIG.PROJ_POOL;

  assert(pickupsOk,
    '1m-i. every one of the ' + Pickups.list.length + ' Pickups.list entries is STRICTLY (by ' +
    'reference) an entry of the CURRENT Entities.list');
  assert(enemiesOk,
    '1m-ii. every one of the ' + Enemies.list.length + ' Enemies.list entries is strictly an ' +
    'entry of the CURRENT Entities.list');
  assert(list.length === expectLen,
    '1m-iii. Entities.list.length is the spawn-derived billboard count plus CONFIG.PROJ_POOL ' +
    'exactly (' + list.length + ' === ' + spawnBillboards() + ' + ' + CONFIG.PROJ_POOL + ')');

  // THE CONTROL: Entities.build() ALONE assigns a fresh list and leaves every
  // derived view holding orphans. This is precisely the failure Game.restart's
  // Enemies.reset() chain exists to prevent — if this control passed, 1m-i would be
  // proving nothing.
  Entities.build();
  const fresh = Entities.list;
  const orphans = Pickups.list.filter((e) => fresh.indexOf(e) < 0).length;
  assert(orphans > 0,
    '1m-iv. CONTROL for 1m: Entities.build() ALONE orphans ' + orphans + ' Pickups.list ' +
    'entries — the reset chain is what makes 1m-i true');

  // Restore a clean world for the sections below.
  Game.restart();
  assert(Pickups.list.every((e) => Entities.list.indexOf(e) >= 0) &&
    Enemies.list.every((e) => Entities.list.indexOf(e) >= 0),
    '1m-v. a further Game.restart() re-heals the orphaned views (the chain is re-runnable)');
})();

// ===========================================================================
// 1n. THE INPUT DRAIN ON TRANSITION — a mouse delta accumulated while the sim was
//     frozen cannot release as a spin on the first playing frame.
// ===========================================================================
(function () {
  const BIG = 500;

  Game.setState(S.TITLE);
  Input.mouseDX = BIG;                 // accumulated while FROZEN — nothing samples it
  Game.setState(S.PLAYING);            // the transition DRAINS the input source
  const dx0 = Player.dirX, dy0 = Player.dirY;
  frames(1);
  const drainedTurn = Math.abs(Player.dirX - dx0) + Math.abs(Player.dirY - dy0);

  assert(Input.mouseDX === 0 && drainedTurn === 0,
    '1n-i. a ' + BIG + '-pixel delta accumulated while frozen was DRAINED by the transition: ' +
    'the first playing frame leaves Player.dirX/dirY byte-identical');

  // CONTROL: the same delta injected while ALREADY playing does turn the player, so
  // the drain is what made the difference above — not a dead input path.
  const cx0 = Player.dirX, cy0 = Player.dirY;
  Input.mouseDX = BIG;
  frames(1);
  const liveTurn = Math.abs(Player.dirX - cx0) + Math.abs(Player.dirY - cy0);
  assert(liveTurn > 0.1,
    '1n-ii. CONTROL for 1n: the SAME ' + BIG + '-pixel delta injected while already PLAYING ' +
    'does turn the player (|d dir| ' + liveTurn.toFixed(4) + ') — the drain is the difference');
})();

// ===========================================================================
// ===========================================================================
// SECTION 2 — THE DEATH BRANCH, THE FOUR-STATE RENDER MATRIX, AND THE
//             EXHAUSTIVE RESTART RESET (LVL-05).
// ===========================================================================
// ===========================================================================

// Put the world into a known playing state: a clean rebuild, then enter playing.
function freshPlaying() {
  Game.restart();
  releaseAll();
}

// KILL THE PLAYER through the real damage path. The amount has to clear health
// AND armor: js/combat.js's locked formula absorbs min(armor, floor(dmg/3)), so
// health + armor + 10 is the smallest amount that is lethal at ANY armor value.
// (A naive health + 10 is NOT lethal once the player is wearing armor — which is
// exactly the trap this helper exists to keep out of the scenarios.)
function killPlayer() {
  return Combat.damagePlayer(Combat.health + Combat.armor + 10);
}

// The enemy nearest the player, DERIVED rather than indexed. Enemies.list is in
// row-major spawn order, so list[0] is whichever marker the map happens to declare
// first — in the shipped map that is the north-east hall enemy, which cannot see
// the start room and correctly never moves. A pursuit control has to name the
// enemy that is actually in pursuit.
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
// 2a + 2b. DEATH — the transition tracks the Combat.dead LATCH, not the mere
//          fact that damage happened.
// ===========================================================================
(function () {
  freshPlaying();
  const lost = killPlayer();
  assert(Combat.dead === true && Combat.health === 0 && lost > 0,
    '2a-0. setup: a lethal hit (' + lost + ' health lost) latched Combat.dead and floored ' +
    'health at 0');
  Game.kills = 2;
  Game.step(FRAME_DT);
  assert(Game.state === S.DEAD,
    '2a-i. ONE step after the dead latch moved the state playing -> DEAD');
  assert(Game.result.kills === 2 && Game.result.totalKills === Game.totalKills &&
    Game.result.time === Game.time,
    '2a-ii. Game.result was stamped from the live counters at the death transition (' +
    Game.result.kills + '/' + Game.result.totalKills + ' at ' + Game.result.time.toFixed(3) + 's)');

  // CONTROL: the IDENTICAL setup with a NON-lethal amount. Damage happened, the
  // player is hurt, and the state does not move.
  freshPlaying();
  const before = Combat.health;
  const minor = Combat.damagePlayer(5);
  Game.step(FRAME_DT);
  assert(minor > 0 && Combat.health > 0 && Combat.health < before && Combat.dead === false &&
    Game.state === S.PLAYING,
    '2b. CONTROL for 2a: the same setup with a NON-lethal 5 damage leaves health at ' +
    Combat.health + ' (> 0, and really lost ' + lost + ') and the state at PLAYING — the ' +
    'transition tracks the dead LATCH, not the fact that damage occurred');
})();

// ===========================================================================
// 2c + 2d. THE DEATH FREEZE, AND THE CONTROL THAT MAKES IT NON-VACUOUS.
// ===========================================================================
(function () {
  // 2d FIRST, so the control establishes that this exact pose DOES produce enemy
  // movement before 2c claims 120 frames of it produced none.
  freshPlaying();
  // The start-room enemies see the player from the spawn pose, so a plain playing
  // drive is enough to put the NEAREST one in pursuit.
  const chased = nearestEnemy();
  const cx = chased.x, cy = chased.y;
  frames(120);
  const movedEnemy = Math.hypot(chased.x - cx, chased.y - cy);
  assert(movedEnemy > 0.05,
    '2d. CONTROL for 2c: 120 real frames in PLAYING move the pursuing enemy ' +
    movedEnemy.toFixed(3) + ' cells — the frozen measurement below is non-vacuous');

  // 2c: the SAME driver, the SAME world, in the DEAD state.
  killPlayer();
  Game.step(FRAME_DT);
  assert(Game.state === S.DEAD, '2c-0. setup: the world is now in the DEAD state');

  const before = {
    enemies: enemyPoses().join('|'),
    projectiles: projFlags(),
    time: Game.time,
    health: Combat.health,
    puts: h.putCount()
  };
  frames(120);
  const puts = h.putCount() - before.puts;

  assert(enemyPoses().join('|') === before.enemies,
    '2c-i. 120 real frames in DEAD leave every enemy position/state/health byte-identical');
  assert(projFlags() === before.projectiles,
    '2c-ii. those 120 frames leave every projectile active flag identical (' +
    before.projectiles + ')');
  assert(Game.time === before.time && Combat.health === before.health,
    '2c-iii. those 120 frames leave Game.time and Combat.health byte-identical');
  assert(puts === 120,
    '2c-iv. h.putCount() STILL advanced by exactly 120 across the frozen frames (' + puts +
    ') — the death screen sits over a rendered world, not a black one');
})();

// ===========================================================================
// 2i. THE DEATH SCREEN IS DRAWN — with the PLAYING recording as the control.
// ===========================================================================
(function () {
  const dead = recordFrame();
  const deadTexts = textsOf(dead);
  assert(deadTexts.some((t) => t.indexOf(HUD.DEAD_HEADING) >= 0),
    '2i-i. a DEAD frame records the death heading ("' + HUD.DEAD_HEADING + '")');
  assert(deadTexts.some((t) => t.indexOf(HUD.DEAD_PROMPT) >= 0),
    '2i-ii. a DEAD frame records the restart prompt ("' + HUD.DEAD_PROMPT + '") — LVL-05\'s ' +
    'restart affordance is on screen');
  assert(deadTexts.some((t) => t.indexOf('KILLS') >= 0) &&
    deadTexts.some((t) => t.indexOf('TIME') >= 0),
    '2i-iii. the DEAD frame draws the SAME two stat readouts as the victory screen [' +
    deadTexts.join(' | ') + ']');

  // CONTROL: a PLAYING frame contains neither. (06-02 will fill the playing state
  // with the status bar; this assertion is about the END-SCREEN copy, which must
  // never appear during play.)
  //
  // freshPlaying(), not a bare setState: Combat.dead is still LATCHED from the
  // scenario above, so a mere state assignment would be undone by the very first
  // frame — the death branch would correctly fire again and this "playing" control
  // would record the death screen. Clearing the latch is what makes it a control.
  freshPlaying();
  const playing = recordFrame();
  const playTexts = textsOf(playing);
  assert(!playTexts.some((t) => t.indexOf(HUD.DEAD_HEADING) >= 0) &&
    !playTexts.some((t) => t.indexOf(HUD.DEAD_PROMPT) >= 0),
    '2i-iv. CONTROL for 2i: a PLAYING frame records NEITHER the death heading nor the restart ' +
    'prompt (' + playTexts.length + ' text lines)');
})();

// ===========================================================================
// 2e. PRECEDENCE — dying ON the exit is a LOSS, not a win.
// ===========================================================================
(function () {
  const e = Level.exit;

  // The control FIRST: the same pose, ALIVE, yields victory.
  freshPlaying();
  placeAt(e.x, e.y, 1, 0);
  Game.step(FRAME_DT);
  assert(Game.state === S.VICTORY,
    '2e-i. CONTROL for 2e: standing on the exit ALIVE yields VICTORY from that exact pose');

  // Now the same pose, dead.
  freshPlaying();
  placeAt(e.x, e.y, 1, 0);
  killPlayer();
  Game.step(FRAME_DT);
  assert(Game.state === S.DEAD,
    '2e-ii. a player who dies while standing ON the exit ends in DEAD, not victory — the dead ' +
    'branch is tested BEFORE the exit branch, so the fireball already in the air still wins');
})();

// ===========================================================================
// 2f. RESTART FROM DEATH — one canvas click on the death screen resumes play.
// ===========================================================================
assert(Game.state === S.DEAD, '2f-0. setup: the world is in the DEAD state');
h.dispatch('game', 'click');
assert(Game.state === S.PLAYING,
  '2f. one canvas click on the DEATH screen returned the state to playing');

// ===========================================================================
// 2g. THE EXHAUSTIVE RESET — run after restarting from BOTH end states.
//
// EVERY field is PERTURBED before the restart, so no assertion here can pass
// because the value never moved in the first place. Expectations are written
// against CONFIG and against counts DERIVED from Level.spawns, never literals, so
// a future map or tuning edit moves the expectation with the map.
// ===========================================================================
function perturbEverything() {
  Combat.damagePlayer(37);                 // health down, lastDamageAt stamped, totalDamageTaken up
  Combat.addArmor(40);                     // armor up
  Combat.grantShotgun();                   // hasShotgun true (+ shells)
  Combat.selectWeapon(Combat.SHOTGUN);     // weapon off the pistol
  Combat.ammo.bullets = 3;                 // ammo spent
  hold('Space');
  Weapons.update(FRAME_DT, Input.readIntent());  // shotsFired up
  releaseAll();
  Weapons.fire();                          // and again, for good measure
  Enemies.hurt(Enemies.list[0], 9999);     // a kill: Game.kills up, an enemy dead
  Pickups.list[0].active = false;           // an item collected
  Game.message('PERTURBED');                // a posted message
  Sound.play('pickupHealth');               // a recorded sound
  placeAt(Level.LANDMARKS.openCell.x, Level.LANDMARKS.openCell.y, 0, 1); // walked away
  for (let i = 0; i < 10; i++) Game.step(FRAME_DT);  // Game.time well off 0
}

function assertCleanWorld(via) {
  const ps = Level.playerStart;
  const p = via + ': ';
  assert(Game.time === 0, p + 'Game.time is 0');
  assert(Game.kills === 0, p + 'Game.kills is 0');
  assert(Game.totalKills === enemyMarkers(),
    p + 'Game.totalKills is the spawn-derived enemy marker count (' + Game.totalKills + ')');
  assert(Game.messagesPosted === 0 && Game.activeMessage() === null,
    p + 'the message ring is empty (messagesPosted 0, no active message)');
  assert(Combat.health === CONFIG.PLAYER_START_HEALTH && Combat.armor === CONFIG.PLAYER_START_ARMOR,
    p + 'health/armor are at their CONFIG start values (' + Combat.health + '/' + Combat.armor + ')');
  assert(Combat.ammo.bullets === CONFIG.PLAYER_START_BULLETS &&
    Combat.ammo.shells === CONFIG.PLAYER_START_SHELLS,
    p + 'ammo is at its CONFIG start values (' + Combat.ammo.bullets + ' bullets / ' +
    Combat.ammo.shells + ' shells)');
  assert(Combat.weapon === Combat.PISTOL && Combat.hasShotgun === false,
    p + 'the weapon is back to the pistol and the shotgun grant is revoked');
  assert(Combat.dead === false && Combat.lastDamageAt === -1 && Combat.totalDamageTaken === 0,
    p + 'the dead latch is clear, lastDamageAt is the -1 sentinel and totalDamageTaken is 0');
  assert(Weapons.shotsFired === 0 && Weapons.dryFires === 0,
    p + 'Weapons.shotsFired and Weapons.dryFires are 0');
  assert(near(Player.x, ps.x, 1e-12) && near(Player.y, ps.y, 1e-12) &&
    near(Player.dirX, ps.dirX, 1e-12) && near(Player.dirY, ps.dirY, 1e-12),
    p + 'the player is at Level.playerStart with the start facing');
  assert(Enemies.list.length === enemyMarkers() &&
    Enemies.list.every((e) => e.alive === true && e.health === CONFIG.ENEMY_HEALTH &&
      e.sprite === 'enemyIdle'),
    p + 'all ' + Enemies.list.length + ' enemies are alive at full health on their idle sprite');
  assert(Pickups.list.length > 0 && Pickups.list.every((e) => e.active === true),
    p + 'all ' + Pickups.list.length + ' pickups are active again');
  assert(Sound.count === 0, p + 'the Sound recorder is clear (count 0)');
}

// --- 2g via VICTORY --------------------------------------------------------
(function () {
  freshPlaying();
  perturbEverything();
  // Prove the perturbation actually took, or every assertion below is vacuous.
  assert(Game.time > 0 && Game.kills > 0 && Combat.health < CONFIG.PLAYER_START_HEALTH &&
    Combat.hasShotgun === true && Combat.weapon === Combat.SHOTGUN &&
    Combat.ammo.bullets !== CONFIG.PLAYER_START_BULLETS && Weapons.shotsFired > 0 &&
    Combat.lastDamageAt >= 0 && Combat.totalDamageTaken > 0 && Game.messagesPosted > 0 &&
    Sound.count > 0 && Pickups.list.some((e) => e.active !== true) &&
    Enemies.list.some((e) => e.alive !== true),
    '2g-0a. setup: every field 2g asserts was PERTURBED off its boot value first (time ' +
    Game.time.toFixed(2) + ', kills ' + Game.kills + ', health ' + Combat.health + ', shots ' +
    Weapons.shotsFired + ')');

  placeAt(Level.exit.x, Level.exit.y, 1, 0);
  Game.step(FRAME_DT);
  assert(Game.state === S.VICTORY, '2g-0b. setup: reached VICTORY with a perturbed world');

  h.dispatch('game', 'click');
  assertCleanWorld('2g-V (restart from VICTORY)');
})();

// --- 2g via DEATH ----------------------------------------------------------
(function () {
  perturbEverything();
  killPlayer();
  Game.step(FRAME_DT);
  assert(Game.state === S.DEAD, '2g-0c. setup: reached DEAD with a perturbed world');

  h.dispatch('game', 'click');
  assertCleanWorld('2g-D (restart from DEATH)');
})();

// ===========================================================================
// 2h. RESTART IS REPEATABLE — nothing grows and no ghosts accumulate.
// ===========================================================================
(function () {
  const sizes = [];
  const ghostCounts = [];

  // The GHOST DETECTOR: two entities that are not explicitly inactive sharing BOTH
  // a position and a sprite name are the signature of a rebuild that appended
  // instead of replacing.
  function ghosts() {
    const seen = Object.create(null);
    let n = 0;
    for (const e of Entities.list) {
      if (e.active === false) continue;
      const key = e.x + ',' + e.y + ',' + e.sprite;
      if (seen[key]) n += 1;
      else seen[key] = true;
    }
    return n;
  }

  for (let i = 0; i < 3; i++) {
    Game.restart();
    sizes.push(Entities.list.length + '/' + Enemies.list.length + '/' + Pickups.list.length);
    ghostCounts.push(ghosts());
  }

  assert(sizes[0] === sizes[1] && sizes[1] === sizes[2],
    '2h-i. three consecutive restarts leave Entities/Enemies/Pickups list lengths IDENTICAL (' +
    sizes.join('  ') + ') — nothing grows');
  assert(sizes[0] === (spawnBillboards() + CONFIG.PROJ_POOL) + '/' + enemyMarkers() + '/' +
    (spawnBillboards() - enemyMarkers()),
    '2h-ii. and those lengths are exactly the SPAWN-DERIVED counts (' + sizes[0] + ')');
  assert(ghostCounts.every((n) => n === 0),
    '2h-iii. the ghost detector finds no duplicate position+sprite pair after any of the three ' +
    'restarts (' + ghostCounts.join(',') + ')');
})();

// ===========================================================================
// 2j. THE PRESENT MATRIX — across a drive that visits ALL FOUR states, the world
//     presents exactly once per frame and the overlay never blits.
// ===========================================================================
(function () {
  freshPlaying();
  const puts0 = h.putCount();
  let driven = 0;
  let blits = 0;
  const visited = Object.create(null);

  function drive(n) {
    for (let i = 0; i < n; i++) {
      const calls = recordFrame();
      blits += blitsOf(calls);
      driven += 1;
      visited[Game.state] = true;
    }
  }

  Game.setState(S.TITLE);
  drive(10);
  Game.setState(S.PLAYING);
  drive(10);
  Game.setState(S.VICTORY);
  drive(10);
  Game.setState(S.DEAD);
  drive(10);

  const puts = h.putCount() - puts0;
  assert(Object.keys(visited).sort().join(',') === 'dead,playing,title,victory',
    '2j-i. the drive really visited all FOUR states (' + Object.keys(visited).sort().join(',') + ')');
  assert(puts === driven,
    '2j-ii. h.putCount() equals the number of frames driven across all four states (' + puts +
    ' === ' + driven + ') — exactly one present per frame in EVERY state');
  assert(blits === 0,
    '2j-iii. ZERO putImageData/getImageData calls were recorded on the hud context across the ' +
    'whole four-state drive (D-01: the overlay composites, it never blits)');
})();

// ===========================================================================
// 1g (second half). Re-assert at the END of the run: nothing built a context.
// ===========================================================================
noAudioContext('1g-ii. at the END of the run (after clicks, restarts and hundreds of frames): ' +
  'still no AudioContext binding and still no context field on Sound');

finish('ALL_STATE_CONTRACTS_PASS');
