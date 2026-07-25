/*
 * tools/verify-motion.cjs — the Phase 2 Plan 02 motion contract harness.
 *
 * NODE-ONLY (never referenced by index.html). Built on tools/boot.cjs: it boots
 * the SHIPPED script list into a vm, initialises the framebuffer, builds the
 * level, spawns the player, starts the Game loop, and attaches a SCRIPTED intent
 * source to Game.input so the harness controls exactly what the player tries to
 * do each frame — while the manual requestAnimationFrame scheduler lets it
 * manufacture arbitrary frame deltas (a two-second hitch, a hundred-second hitch,
 * a negative delta, a NaN delta) deterministically.
 *
 * It proves the two most silently-breakable properties in the project:
 *   - FRAME-RATE INDEPENDENCE: one second of motion is identical at 60 and 250 fps.
 *   - NO TUNNELING: a run-speed player driving into a NAMED wall face under a
 *     multi-second hitch stays on the near side of that face and in its cell,
 *     proven by SIDE PRESERVATION plus a per-frame no-cell-skip / no-corner-cut
 *     check across 5000 randomized frames.
 *
 * Every wall-relative assertion anchors on Level.LANDMARKS by NAME (openCell,
 * wallFaceEast, corridorCell) — never a searched or hardcoded coordinate. Floats
 * are compared with explicit tolerances, never equality.
 *
 * Prints PASS/FAIL per assertion and the terminal token ALL_MOTION_CONTRACTS_PASS
 * only when every assertion passed.
 */

'use strict';

const { boot, assert, finish } = require('./boot.cjs');

// ---------------------------------------------------------------------------
// Boot the shipped game, then run main.js's load handler: it calls
// Framebuffer.init, Textures/Sprites.build, Level.build, Player.spawn,
// Game.attach and Game.start. After this the loop is running with a resync frame
// pending and exactly one frame callback queued, but NO frame has executed yet.
// ---------------------------------------------------------------------------
const h = boot({});
h.fireLoad();

const s = h.sandbox;
const CONFIG = s.CONFIG;
const Level = s.Level;
const Player = s.Player;
const Game = s.Game;
const raf = h.raf;

// ---------------------------------------------------------------------------
// SCOPE ISOLATION (added in 05-01; NO assertion below is changed by it).
//
// This harness is the PLAYER MOTION contract set. From Phase 5 the game loop
// also simulates enemies that hunt and shoot the player, and a drive of several
// thousand frames can reduce the player to 0 health — at which point a dead
// player is DELIBERATELY inert (Game.step substitutes the frozen zero intent per
// D-04) and every "the player moved" assertion would fail for a reason that has
// nothing to do with motion. Truncating Enemies.list IN PLACE removes the
// enemies from the AI's update set while leaving them in Entities.list as the
// static billboards Phase 4 rendered. Enemy behaviour is proven end to end in
// tools/verify-combat.cjs.
// ---------------------------------------------------------------------------
if (s.Enemies && Array.isArray(s.Enemies.list)) s.Enemies.list.length = 0;

// A scripted intent source. readIntent() returns the CURRENT intent object each
// frame; the harness mutates `intent` between drives. reset() proves the loop's
// focus/visibility reset path only calls it when present.
const scriptedInput = {
  intent: { forward: 0, strafe: 0, turn: 0, mouseDX: 0, run: false },
  resetCount: 0,
  readIntent: function () { return this.intent; },
  reset: function () {
    this.resetCount += 1;
    this.intent = { forward: 0, strafe: 0, turn: 0, mouseDX: 0, run: false };
  }
};
Game.input = scriptedInput;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Replace the whole intent so no stale field leaks between drives.
function setIntent(o) {
  scriptedInput.intent = Object.assign(
    { forward: 0, strafe: 0, turn: 0, mouseDX: 0, run: false }, o || {});
}

// Place the player at a named landmark's world coordinate, facing (dx,dy).
function placeAt(landmark, dx, dy) {
  Player.x = landmark.x;
  Player.y = landmark.y;
  Player.setDir(dx, dy);
}
function placeOpen(dx, dy) {
  placeAt(Level.LANDMARKS.openCell, dx == null ? 1 : dx, dy == null ? 0 : dy);
}

// Drive exactly one frame with a raw delta of `ms`. The Game loop derives
// dt = (now - Game.last)/1000 clamped to DT_MAX; because every frame writes
// Game.last = now, Game.last always tracks the virtual clock between steps, so a
// single raf.step(ms) produces a raw delta of exactly `ms`.
function step(ms) { raf.step(ms); }

// Drive one frame whose RAW delta is non-finite or negative WITHOUT corrupting
// the shared virtual clock: force Game.last to a crafted value, then step. The
// frame overwrites Game.last back to the (finite) current now, so the running
// loop is undisturbed afterward.
function stepWithForcedLast(lastValue, ms) {
  Game.last = lastValue;
  raf.step(ms);
}

const APPROX = 1e-9;
function near(a, b, tol) { return Math.abs(a - b) <= tol; }
function dirAngle() { return Math.atan2(Player.dirY, Player.dirX); }
// Shortest signed angular difference b - a, wrapped to (-PI, PI].
function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

// ===========================================================================
// Assertion 0 (Phase 5 preparation, 05-01 Task 1) — THE SHARED SLIDE.
//
// The D-06 per-axis collision is now a radius-parameterised routine that the
// enemy AI reuses (Player.slideMove). Assertions 1-13 below are UNCHANGED and
// are themselves the proof that extracting it did not alter observed PLAYER
// behaviour; these assertions prove the GENERALIZED contract the enemies need:
// an arbitrary object, at an arbitrary radius, gets the player's exact semantics
// and the travelled distance is reported back.
// ===========================================================================
(function () {
  const R = CONFIG.ENEMY_RADIUS;

  // --- 0b(i) blocked axis is arrested while the free axis still resolves ------
  const L = Level.LANDMARKS.wallFaceEast;
  const obj = { x: L.wf - 0.5, y: L.my + 0.5 };
  const x0 = obj.x, y0 = obj.y;
  const travelled = Player.slideMove(obj, 0.3, 0.2, R);
  const blockedOk = near(obj.x, x0, 1e-12);      // X pushed into the face: rejected
  const freeOk = near(obj.y, y0 + 0.2, 1e-12);   // Y still resolved
  assert(blockedOk && freeOk,
    '0b. slideMove on a PLAIN object at radius ENEMY_RADIUS: the wall-blocked axis is unchanged ' +
    'while the free axis still resolves');
  assert(near(travelled, 0.2, 1e-12),
    '0c. slideMove RETURNS the distance actually travelled (' + travelled.toFixed(4) +
    ' == the free-axis move, not the requested diagonal)');

  // Both axes blocked -> zero travel reported (what the chase steer detects).
  const jam = { x: L.wf - 0.5, y: L.my + 0.5 };
  const jamTravel = Player.slideMove(jam, 0.3, 0, R);
  assert(near(jamTravel, 0, 1e-12) && near(jam.x, L.wf - 0.5, 1e-12),
    '0d. a fully rejected slide reports travelled 0 and leaves the object where it was');

  // --- 0b(ii) X COMMITS BEFORE Y ---------------------------------------------
  // The corridor down column 4: (3,9) is solid, (4,9) is open, (3,8)/(4,8) open.
  // From (3.5, 8.8) a (+0.9, +0.3) step is a DISCRIMINATING case: the Y move is
  // legal against the POST-X x (4.4) and ILLEGAL against the pre-move x (3.5).
  assert(Level.isSolid(3, 9) && !Level.isSolid(4, 9) && !Level.isSolid(3, 8) && !Level.isSolid(4, 8),
    '0e. precondition: (3,9) solid, (4,9)/(3,8)/(4,8) open — an inside corner at the corridor mouth');

  const preX = 3.5, preY = 8.8, newY = 9.1;
  const staleWouldReject = Player.canOccupyYFor(preX, preY, newY, R) === false;
  const committedAccepts = Player.canOccupyYFor(4.4, preY, newY, R) === true;
  assert(staleWouldReject && committedAccepts,
    '0f. the discriminating case is real: the Y move is REJECTED against the pre-move x (3.5) ' +
    'and ACCEPTED against the committed x (4.4)');

  const corner = { x: preX, y: preY };
  Player.slideMove(corner, 0.9, 0.3, R);
  assert(near(corner.x, 4.4, 1e-12) && near(corner.y, newY, 1e-12),
    '0g. slideMove resolves X, COMMITS it, then tests Y against the committed x ' +
    '(landed at ' + corner.x.toFixed(2) + ',' + corner.y.toFixed(2) + ')');
})();

// ===========================================================================
// Assertion 1 — clamp constant.
// ===========================================================================
assert(near(CONFIG.DT_MAX, 0.05, 1e-12), '1. CONFIG.DT_MAX is 0.05');

// ===========================================================================
// Assertion 2 — resync contract at the loop boundary, then clamp behaviour.
// The FIRST raf.step runs the resync frame Game.start() armed.
// ===========================================================================
(function () {
  // Resync contract. Hold a non-zero forward intent so a SKIPPED step is visible
  // as an unchanged pose (with zero intent the pose would not move regardless).
  placeOpen(1, 0);
  setIntent({ forward: 1 });
  const x0 = Player.x, y0 = Player.y;
  const put0 = h.putCount(), frames0 = Game.frames;

  step(1000 / 60); // frame 1 — the resync frame
  const resyncOk =
    near(Game.dt, 0, 1e-12) &&           // dt exactly 0 on a resync frame
    Game.resync === false &&             // flag cleared
    near(Player.x, x0, 1e-12) &&         // step SKIPPED — pose unchanged
    near(Player.y, y0, 1e-12) &&
    h.putCount() === put0 + 1 &&         // render + present STILL happened
    Game.frames === frames0 + 1;
  assert(resyncOk, '2a. first frame after start is a resync frame: dt 0, step skipped, still presented');

  step(1000 / 60); // frame 2 — a normal frame
  const advanceOk =
    Game.dt > 0 && near(Game.dt, 1 / 60, 1e-9) &&
    Player.x > x0 + APPROX &&            // now the pose advances (moved east)
    h.putCount() === put0 + 2;
  assert(advanceOk, '2b. second frame advances the pose normally and presents again');

  // Clamp behaviour: a battery of raw deltas. After EACH, dt must be finite, in
  // [0, DT_MAX], and the pose finite.
  const deltas = [
    { ms: 16, forcedLast: undefined, label: '16 ms' },
    { ms: 2000, forcedLast: undefined, label: '2000 ms (two-second hitch)' },
    { ms: 100000, forcedLast: undefined, label: '100000 ms (hundred-second hitch)' },
    { ms: 0, forcedLast: undefined, label: '0 ms' },
    { ms: 16, forcedLast: 1e12, label: 'negative raw delta' },
    { ms: 16, forcedLast: NaN, label: 'non-finite (NaN) raw delta' }
  ];
  let clampOk = true;
  for (let i = 0; i < deltas.length; i++) {
    const d = deltas[i];
    if (d.forcedLast === undefined) step(d.ms);
    else stepWithForcedLast(d.forcedLast, d.ms);
    if (!isFinite(Game.dt) || Game.dt < 0 || Game.dt > CONFIG.DT_MAX) clampOk = false;
    if (!isFinite(Player.x) || !isFinite(Player.y)) clampOk = false;
  }
  assert(clampOk, '2c. every raw delta (16/2000/100000/0/negative/NaN ms) clamps dt into [0, DT_MAX] and keeps the pose finite');
})();

// ===========================================================================
// Assertion 3 — max-step invariant (the ARITHMETIC half of no-tunneling).
// ===========================================================================
assert(Player.maxStepPerFrame() < 0.5 && Player.maxStepPerFrame() > 0,
  '3. maxStepPerFrame() is strictly < 0.5 (comfortably under a one-cell wall step)');

// ===========================================================================
// Assertion 4 — frame-rate independence: one second at 60 fps vs 250 fps.
// ===========================================================================
(function () {
  const WALK = Player.WALK_SPEED;
  placeOpen(1, 0);
  setIntent({ forward: 1 });
  let x0 = Player.x;
  for (let i = 0; i < 60; i++) step(1000 / 60); // 60 frames * 16.67 ms = 1.000 s
  const dist60 = Player.x - x0;

  placeOpen(1, 0);
  setIntent({ forward: 1 });
  x0 = Player.x;
  for (let i = 0; i < 250; i++) step(4);          // 250 frames * 4 ms = 1.000 s
  const dist250 = Player.x - x0;

  const agree = Math.abs(dist60 - dist250) / dist60 < 0.02;
  const both = Math.abs(dist60 - WALK) < 0.02 * WALK && Math.abs(dist250 - WALK) < 0.02 * WALK;
  assert(agree && both,
    '4. one simulated second of forward travels the same distance (~WALK_SPEED) at 60 and 250 fps (within 2%)');
})();

// ===========================================================================
// Assertion 5 — NO TUNNELING under a hitch (the EMPIRICAL half). Side
// preservation against the NAMED east wall face, not mere resting-cell legality.
// ===========================================================================
(function () {
  const L = Level.LANDMARKS.wallFaceEast;
  const R = Player.RADIUS;

  function drive(hitchMs, preFrames) {
    placeAt(L, 1, 0); // due east, half a cell short of the face, centred in the row
    setIntent({ forward: 1, run: true });
    let ok = true;
    function check() {
      if (!(Player.x < L.wf - R + 1e-9)) ok = false;   // leading edge never reached THE face
      if (Math.floor(Player.x) !== L.mx) ok = false;   // still in the starting cell (x)
      if (Math.floor(Player.y) !== L.my) ok = false;   // still in the starting cell (y)
    }
    for (let i = 0; i < preFrames; i++) { step(16); check(); }
    step(hitchMs); check();                            // the hitch frame itself
    for (let i = 0; i < 200; i++) { step(16); check(); }
    return ok;
  }

  assert(drive(2000, 0),
    '5a. a two-second hitch at run speed never carries the player past wallFaceEast.wf or out of its cell');
  assert(drive(2000, 30),
    '5b. a two-second hitch AFTER 30 frames of run-speed motion still preserves the near side of the wall');
  assert(drive(100000, 0),
    '5c. a hundred-second hitch at run speed still preserves the near side of the wall');
})();

// ===========================================================================
// Assertion 6 — never inside geometry, never skipping a cell, never cutting a
// corner, across 5000 randomized frames.
// ===========================================================================
(function () {
  const rng = s.mulberry32(CONFIG.SEED);
  placeOpen(1, 0);
  let insideOk = true, skipOk = true, cornerOk = true;

  for (let f = 0; f < 5000; f++) {
    setIntent({
      forward: rng() * 2 - 1,
      strafe: rng() * 2 - 1,
      turn: rng() * 2 - 1,
      run: rng() < 0.5
    });
    const pmx = Math.floor(Player.x), pmy = Math.floor(Player.y);
    // Mix normal frames with the occasional two-second hitch.
    step(rng() < 0.03 ? 2000 : 16);
    const mx = Math.floor(Player.x), my = Math.floor(Player.y);

    // (a) finite and never inside geometry
    if (!isFinite(Player.x) || !isFinite(Player.y) || Level.isSolid(mx, my)) insideOk = false;
    // (b) no cell skipped on either axis (a jump of 2 is unreachable under maxStep < 0.5)
    if (Math.abs(mx - pmx) > 1 || Math.abs(my - pmy) > 1) skipOk = false;
    // (c) no corner cut: X resolves before Y, so the intermediate cell is (mx, pmy)
    if ((mx !== pmx) && (my !== pmy)) {
      if (Level.isSolid(mx, pmy)) cornerOk = false;
    }
  }

  assert(insideOk, '6a. 5000 randomized frames: never finite-fails, never ends inside a solid cell');
  assert(skipOk, '6b. 5000 randomized frames: never skips a cell on either axis (|dmx|<=1 and |dmy|<=1)');
  assert(cornerOk, '6c. 5000 randomized frames: never cuts a solid corner (intermediate cell (mx,pmy) is non-solid)');
})();

// ===========================================================================
// Assertion 7 — wall sliding: the BLOCKED axis is arrested, the FREE axis keeps
// going, and the player never leaves its cell on the blocked axis.
// ===========================================================================
(function () {
  const C = Level.LANDMARKS.corridorCell;
  // Face diagonally: unit vector INTO one blocked-axis wall + the slide direction.
  // corridorCell.blockedAxis is 'x' here, so a forward intent drives into the +x
  // wall while sliding along +y.
  const intoX = 1, intoY = 0;            // unit vector into the +x wall
  placeAt(C, intoX + C.slideDir.x, intoY + C.slideDir.y); // setDir normalizes

  setIntent({ forward: 1 });
  const blockedKey = C.blockedAxis;      // 'x'
  const freeKey = C.blockedAxis === 'x' ? 'y' : 'x';
  const blockedAnchor = C[blockedKey];   // the anchor coordinate on the blocked axis

  const blocked = [];
  const free = [];
  for (let i = 0; i < 60; i++) {
    step(16);
    blocked.push(Player[blockedKey]);
    free.push(Player[freeKey]);
  }
  // Blocked axis at rest across the FINAL 20 frames (neither creeping nor oscillating).
  let blockedRest = true;
  for (let i = 40; i < 60; i++) {
    if (Math.abs(blocked[i] - blocked[59]) > 1e-9) blockedRest = false;
  }
  const freeMoved = Math.abs(free[59] - C[freeKey]) > 0.3;
  const stillInCell = Math.floor(Player[blockedKey]) === Math.floor(blockedAnchor);
  assert(blockedRest && freeMoved && stillInCell,
    '7a. diagonal into a corridor wall: blocked axis arrested (final 20 frames), free axis slides > 0.3, never leaves the cell');

  // Wall-face variant: drive straight east into the named face for 120 frames.
  const L = Level.LANDMARKS.wallFaceEast;
  const R = Player.RADIUS;
  placeAt(L, 1, 0);
  setIntent({ forward: 1 });
  const xs = [];
  let faceOk = true;
  for (let i = 0; i < 120; i++) {
    step(16);
    xs.push(Player.x);
    if (!(Player.x < L.wf - R + 1e-9) || Math.floor(Player.x) !== L.mx) faceOk = false;
  }
  let atRest = true;
  for (let i = 100; i < 120; i++) {
    if (Math.abs(xs[i] - xs[119]) > 1e-9) atRest = false;
  }
  assert(faceOk && atRest,
    '7b. driving straight into wallFaceEast: stays on the near side, in its cell, and comes to rest (no creep/oscillation)');
})();

// ===========================================================================
// Assertion 8 — diagonal is not faster than straight.
// ===========================================================================
(function () {
  placeOpen(1, 0);
  const ox = Player.x, oy = Player.y;

  setIntent({ forward: 1 });
  step(16);
  const dFwd = Math.hypot(Player.x - ox, Player.y - oy);

  placeOpen(1, 0);
  setIntent({ forward: 1, strafe: 1 });
  step(16);
  const dDiag = Math.hypot(Player.x - ox, Player.y - oy);

  assert(near(dFwd, dDiag, 1e-9),
    '8. one forward-only frame and one forward+strafe frame produce equal displacement magnitude');
})();

// ===========================================================================
// Assertion 9 — run modifier scales speed by RUN_MULT.
// Measured over 0.5 s (not a full second): openCell has ~5.28 cells of eastward
// room before wallFaceEast, and a full run-second (5.4 cells) would clip the
// wall and corrupt the ratio. Over any equal UNCLIPPED interval the ratio is
// exactly RUN_MULT, which is the property under test.
// ===========================================================================
(function () {
  const RUN_MULT = Player.RUN_MULT;
  placeOpen(1, 0);
  setIntent({ forward: 1, run: false });
  let x0 = Player.x;
  for (let i = 0; i < 30; i++) step(1000 / 60); // 0.5 s walk
  const walk = Player.x - x0;

  placeOpen(1, 0);
  setIntent({ forward: 1, run: true });
  x0 = Player.x;
  for (let i = 0; i < 30; i++) step(1000 / 60); // 0.5 s run
  const run = Player.x - x0;

  assert(Math.abs(run / walk - RUN_MULT) < 0.01 * RUN_MULT,
    '9. one interval of running travels RUN_MULT times the walking distance (within 1%)');
})();

// ===========================================================================
// Assertion 10 — strafe geometry: strafe displaces along the camera plane, and
// strafe distance equals forward distance.
// ===========================================================================
(function () {
  placeOpen(1, 0);
  const planeLen = Math.hypot(Player.planeX, Player.planeY);
  const pnx = Player.planeX / planeLen, pny = Player.planeY / planeLen;

  const ox = Player.x, oy = Player.y;
  setIntent({ strafe: 1 });
  step(16);
  let dx = Player.x - ox, dy = Player.y - oy;
  const dRight = Math.hypot(dx, dy);
  const dotRight = (dx / dRight) * pnx + (dy / dRight) * pny;

  placeOpen(1, 0);
  setIntent({ strafe: -1 });
  step(16);
  dx = Player.x - ox; dy = Player.y - oy;
  const dLeft = Math.hypot(dx, dy);
  const dotLeft = (dx / dLeft) * pnx + (dy / dLeft) * pny;

  placeOpen(1, 0);
  setIntent({ forward: 1 });
  step(16);
  const dFwd = Math.hypot(Player.x - ox, Player.y - oy);

  const ok = dotRight > 0.999 && dotLeft < -0.999 && near(dRight, dFwd, 1e-9);
  assert(ok,
    '10. strafe-right displaces along +plane, strafe-left along -plane, and strafe distance equals forward distance');
})();

// ===========================================================================
// Assertion 11 — camera invariants after 1000 random rotations.
// ===========================================================================
(function () {
  const rng = s.mulberry32(CONFIG.SEED + 11);
  const FOV = CONFIG.FOV_PLANE;
  Player.setDir(1, 0);
  for (let i = 0; i < 1000; i++) Player.rotate((rng() * 2 - 1) * Math.PI);

  const dirLen = Math.hypot(Player.dirX, Player.dirY);
  const planeLen = Math.hypot(Player.planeX, Player.planeY);
  const dot = Player.dirX * Player.planeX + Player.dirY * Player.planeY;
  const ok =
    near(dirLen, 1, 1e-6) &&
    near(planeLen, FOV, 1e-6) &&
    near(dot, 0, 1e-6) &&
    near(Player.planeX, Player.dirY * FOV, 1e-6) &&
    near(Player.planeY, -Player.dirX * FOV, 1e-6);
  assert(ok,
    '11. after 1000 rotations: dir is unit, |plane| == FOV_PLANE, dir . plane == 0, and plane is derived from dir');
})();

// ===========================================================================
// Assertion 12 — keyboard turn is delta-time scaled; mouse is not.
// ===========================================================================
(function () {
  const TURN = Player.TURN_SPEED;
  const SENS = Player.MOUSE_SENSITIVITY;

  // Turn: one simulated second of turn=1 rotates TURN_SPEED radians, at 60 or 500 fps.
  Player.setDir(1, 0);
  let a0 = dirAngle();
  setIntent({ turn: 1 });
  for (let i = 0; i < 60; i++) step(1000 / 60);
  const rot60 = angleDiff(a0, dirAngle());

  Player.setDir(1, 0);
  a0 = dirAngle();
  setIntent({ turn: 1 });
  for (let i = 0; i < 500; i++) step(2);
  const rot500 = angleDiff(a0, dirAngle());

  const turnOk = near(rot60, TURN, 1e-6) && near(rot500, TURN, 1e-6) && near(rot60, rot500, 1e-6);
  assert(turnOk, '12a. turn is delta-time scaled: one second of turn=1 rotates TURN_SPEED radians at 60 and 500 fps');

  // Mouse: total mouseDX 300 rotates the same amount whether in one frame or 50.
  const expected = 300 * SENS;
  Player.setDir(1, 0);
  a0 = dirAngle();
  setIntent({ mouseDX: 300 });
  step(16);
  const rotOne = angleDiff(a0, dirAngle());

  Player.setDir(1, 0);
  a0 = dirAngle();
  setIntent({ mouseDX: 6 }); // 6 * 50 = 300
  for (let i = 0; i < 50; i++) step(16);
  const rotFifty = angleDiff(a0, dirAngle());

  const mouseOk = near(rotOne, expected, 1e-6) && near(rotFifty, expected, 1e-6) && near(rotOne, rotFifty, 1e-6);
  assert(mouseOk, '12b. mouse turn is NOT delta-time scaled: total mouseDX 300 rotates the same in 1 frame or 50');
})();

// ===========================================================================
// Assertion 13 — loop contract: present count == frame count for the whole
// harness, and the loop tolerates both seams being null.
// ===========================================================================
(function () {
  assert(h.putCount() === Game.frames,
    '13a. across every drive so far, putImageData count equals frame count (exactly one present per frame)');

  // Null both seams and run 30 more frames: no throw, still one present per frame.
  Game.input = null;
  Game.view = null;
  const f0 = Game.frames, p0 = h.putCount();
  let threw = false;
  try {
    for (let i = 0; i < 30; i++) step(16);
  } catch (e) {
    threw = true;
  }
  const ok = !threw && Game.frames === f0 + 30 && h.putCount() === p0 + 30;
  assert(ok,
    '13b. with Game.input and Game.view both null, the loop runs 30 frames without throwing and presents once per frame');
})();

finish('ALL_MOTION_CONTRACTS_PASS');
