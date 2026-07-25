/*
 * tools/verify-input-view.cjs — the Plan 03 END-TO-END TRACER harness.
 *
 * NODE-ONLY (never referenced by index.html). This is not a per-layer unit test:
 * it drives ONE path through the WHOLE remaining stack and proves it works end to
 * end — a real keyboard event and a real pointer-locked mouse delta reach the
 * player through Input.readIntent, the clamped Game loop advances the pose, and
 * the TopDown view draws the grid, the player and the facing ray into the shared
 * framebuffer with exactly one present per frame.
 *
 * Built on tools/boot.cjs: it boots the SHIPPED script list in the SHIPPED order
 * into one vm context with a stubbed DOM, fires the window load event (which wires
 * the seams and starts the loop), then dispatches real DOM events and steps the
 * manual requestAnimationFrame scheduler.
 *
 * Every wall-relative / distance assertion anchors on Level.LANDMARKS by NAME —
 * never a searched or hardcoded coordinate. The seam + boot assertions
 * deliberately use the REAL spawn pose (they assert what boot produced); the
 * timed drives below re-place the player at LANDMARKS.openCell first, because a
 * 1.44-cell drive from an authored spawn could clip a wall and corrupt the
 * magnitude/direction checks.
 *
 * Prints PASS/FAIL per assertion and the terminal token ALL_TRACER_CONTRACTS_PASS
 * only when every assertion passed.
 */

'use strict';

const { boot, assert, finish } = require('./boot.cjs');

// ---------------------------------------------------------------------------
// Boot the shipped game and run main.js's load handler: Framebuffer.init,
// Textures/Sprites.build, Level.build, Player.spawn, Input.attach, the seam
// assignments, Game.attach and Game.start. After this the loop is running with a
// resync frame pending and one frame callback queued, but NO frame has executed.
// ---------------------------------------------------------------------------
const h = boot({});
h.fireLoad();

const s = h.sandbox;
const CONFIG = s.CONFIG;
const Level = s.Level;
const Player = s.Player;
const Input = s.Input;
const TopDown = s.TopDown;
const Raycaster = s.Raycaster;
const Game = s.Game;
const raf = h.raf;

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const dirAngle = () => Math.atan2(Player.dirY, Player.dirX);
function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}
function placeOpen(dx, dy) {
  const o = Level.LANDMARKS.openCell;
  Player.x = o.x;
  Player.y = o.y;
  Player.setDir(dx == null ? 1 : dx, dy == null ? 0 : dy);
}
const step = (ms) => raf.step(ms);

// ===========================================================================
// 1. SHIPPED SCRIPT ORDER — exactly config, framebuffer, textures, sprites,
//    preview, level, player, input, topdown, game, main, all classic scripts.
// ===========================================================================
(function () {
  // Phase 3 inserted js/raycaster.js after topdown and before game; Phase 4
  // inserted js/entities.js after raycaster and before game; Phase 5 inserted
  // js/combat.js then js/enemies.js after entities and before game (15 scripts).
  // The order is load-bearing: enemies.js adopts the entities entities.js built
  // and calls Combat.damagePlayer, and game.js dispatches both.
  const expected = ['config', 'framebuffer', 'textures', 'sprites', 'preview',
    'level', 'player', 'input', 'topdown', 'raycaster', 'entities', 'combat',
    'enemies', 'game', 'main'];
  const got = h.scriptOrder.map((src) => src.replace(/^js\//, '').replace(/\.js$/i, ''));
  const orderOk = got.length === expected.length &&
    expected.every((name, i) => got[i] === name);
  assert(orderOk, '1a. index.html loads the 15 scripts in the exact shipped order (combat + enemies after entities, before game)');

  // Classic scripts only: no module loader anywhere in the shipped script tags.
  const classicOk = !/<script\b[^>]*\btype\s*=\s*"module"/i.test(h.html);
  assert(classicOk, '1b. every shipped <script> is a classic script (no type="module")');
})();

// ===========================================================================
// 2. BOOT WIRED THE SEAMS — with the REAL spawn pose.
// ===========================================================================
(function () {
  const inputOk = Game.input === Input;
  // Phase 3 swapped the view seam: Game.view is now the Raycaster and TopDown is
  // disabled but still loaded (a debug toggle). Section 7 exercises TopDown directly.
  const viewOk = Game.view === Raycaster && TopDown.ENABLED === false &&
    typeof TopDown.render === 'function';
  const runningOk = Game.running === true;
  const spawnOk = !Level.isSolid(Math.floor(Player.x), Math.floor(Player.y));
  assert(inputOk, '2a. Game.input is the Input global');
  assert(viewOk, '2b. Game.view is the Raycaster global; TopDown is disabled but still loaded (Phase 3 view swap)');
  assert(runningOk, '2c. Game.running is true after start');
  assert(spawnOk, '2d. the player spawned on a non-solid cell (real spawn pose)');
})();

// ===========================================================================
// 3. CONSUME THE RESYNC FRAME — one step before any baseline measurement. The
//    frame Game.start() armed carries dt 0 and skips the step (it still renders
//    and presents); including it in a timed drive would shorten the duration by
//    one frame.
// ===========================================================================
step(1000 / 60);
assert(near(Game.dt, 0, 1e-12) && Game.resync === false,
  '3. the first frame after start was the resync frame (dt 0), now consumed');

// ===========================================================================
// 4. FORWARD DRIVE — a real KeyW keydown moves the player along its facing by
//    ~WALK_SPEED * 0.48, and the displacement direction matches the facing.
// ===========================================================================
(function () {
  const WALK = Player.WALK_SPEED;
  placeOpen(1, 0);
  const x0 = Player.x, y0 = Player.y;

  h.dispatch('window', 'keydown', { code: 'KeyW' });
  for (let i = 0; i < 30; i++) step(16); // 30 * 16ms = 0.48 s

  const dx = Player.x - x0, dy = Player.y - y0;
  const dist = Math.hypot(dx, dy);
  const expected = WALK * 0.48;
  const magOk = Math.abs(dist - expected) <= 0.10 * expected;
  const dot = (dx / dist) * Player.dirX + (dy / dist) * Player.dirY;
  const dirOk = dot > 1 - 1e-6;
  assert(magOk, '4a. a real KeyW keydown drives the player ~WALK_SPEED*0.48 forward (within 10%)');
  assert(dirOk, '4b. the displacement direction matches the facing direction (within 1e-6)');

  // keyup halts motion: 30 more frames must not move the player.
  h.dispatch('window', 'keyup', { code: 'KeyW' });
  const hx = Player.x, hy = Player.y;
  for (let i = 0; i < 30; i++) step(16);
  assert(near(Player.x, hx, 1e-12) && near(Player.y, hy, 1e-12),
    '4c. after keyup the player stops dead (30 frames of no movement)');
})();

// ===========================================================================
// 5. STRAFE DRIVE — a real KeyD keydown displaces along the normalized camera
//    plane (strafe right).
// ===========================================================================
(function () {
  placeOpen(1, 0);
  const planeLen = Math.hypot(Player.planeX, Player.planeY);
  const pnx = Player.planeX / planeLen, pny = Player.planeY / planeLen;
  const x0 = Player.x, y0 = Player.y;

  h.dispatch('window', 'keydown', { code: 'KeyD' });
  for (let i = 0; i < 30; i++) step(16);
  h.dispatch('window', 'keyup', { code: 'KeyD' });

  const dx = Player.x - x0, dy = Player.y - y0;
  const dist = Math.hypot(dx, dy);
  const dot = (dx / dist) * pnx + (dy / dist) * pny;
  assert(dot > 1 - 1e-6,
    '5. a real KeyD keydown displaces along the normalized camera plane (within 1e-6)');
})();

// ===========================================================================
// 6. MOUSE-LOOK UNDER LOCK — with the canvas holding pointer lock, a mousemove
//    rotates the camera by exactly movementX * MOUSE_SENSITIVITY, and a second
//    frame with no further mouse event produces no further rotation (the delta
//    drained on read).
// ===========================================================================
(function () {
  const SENS = Player.MOUSE_SENSITIVITY;
  h.setPointerLockElement('game'); // pointer lock now held by the game canvas
  Player.setDir(1, 0);
  const a0 = dirAngle();

  h.dispatch('document', 'mousemove', { movementX: 100 });
  step(16);
  const rot1 = angleDiff(a0, dirAngle());
  const expected = 100 * SENS;
  assert(near(rot1, expected, 1e-6),
    '6a. a pointer-locked mousemove of 100 rotates right by exactly 100*MOUSE_SENSITIVITY');

  const a1 = dirAngle();
  step(16); // no mouse event this frame
  const rot2 = angleDiff(a1, dirAngle());
  assert(near(rot2, 0, 1e-9),
    '6b. a second frame with no mouse event produces no further rotation (delta drained)');
})();

// ===========================================================================
// 7. THE VIEW DREW — after a stepped frame the ACTIVE view (the Raycaster) drew a
//    non-uniform frame; then, exercising the RETAINED TopDown debug view directly,
//    its map/player pixels appear. One present per frame holds across the whole run.
// ===========================================================================
(function () {
  placeOpen(1, 0);
  step(16); // one clean render at the openCell pose — the ACTIVE view is Raycaster

  const buf = s.Framebuffer.buf32;

  // The active (Raycaster) view produced a non-uniform frame.
  let uniform = true;
  const first = buf[0];
  for (let i = 1; i < buf.length; i++) { if (buf[i] !== first) { uniform = false; break; } }
  assert(!uniform, '7a. the framebuffer is not a single uniform value (the active Raycaster view drew)');

  // Exercise the retained TopDown debug view directly (it no longer auto-attaches
  // to Game.view, but the file stays loaded and must still render correctly).
  TopDown.render();

  // At least two distinct wall colours from TopDown.WALL_COLORS are present.
  const present = new Set();
  const wallSet = new Set(TopDown.WALL_COLORS.slice(1));
  for (let i = 0; i < buf.length; i++) {
    if (wallSet.has(buf[i])) present.add(buf[i]);
    if (present.size >= 2) break;
  }
  assert(present.size >= 2, '7b. at least two distinct TopDown.WALL_COLORS appear in the framebuffer');

  // The pixel at the player's projected position is the player colour.
  const p = TopDown.toScreen(Player.x, Player.y);
  const idx = p.sy * s.Framebuffer.width + p.sx;
  assert(buf[idx] === TopDown.PLAYER,
    '7c. the pixel at TopDown.toScreen(Player.x, Player.y) is the player colour');

  // One present per frame, no exceptions, for the whole harness.
  assert(h.putCount() === Game.frames,
    '7d. putImageData count equals frame count (exactly one present per frame)');
})();

finish('ALL_TRACER_CONTRACTS_PASS');
