/*
 * tools/verify-phase02.cjs — the Phase 2 success-criteria ROLL-UP harness.
 *
 * NODE-ONLY (never referenced by index.html). Built on tools/boot.cjs: it boots
 * the SHIPPED script list in the SHIPPED order into one vm context with a stubbed
 * DOM, fires window load (which wires the seams and starts the loop), and then
 * asserts each of Phase 2's FOUR success criteria directly:
 *
 *   1. Moves / strafes / runs, frame-rate independent, survives tab refocus.
 *   2. Mouse-look under pointer lock; arrow-key turn without it.
 *   3. Cannot pass through walls; slides; no tunneling at run speed.
 *   4. Level loads and the pose is verifiable on the top-down view.
 *
 * TWO HARNESS-WIDE RULES:
 *   - After firing load, step ONE frame to consume the resync frame Game.start()
 *     armed (dt 0, step skipped, still renders + presents) before any timed
 *     measurement, so a drive's simulated duration is never one frame short.
 *   - Anchor every wall-relative / distance assertion on Level.LANDMARKS by NAME
 *     (openCell / wallFaceEast / corridorCell) — never a searched or hardcoded
 *     coordinate. A map edit that removes a needed feature then fails loudly in
 *     the level harness, not subtly here.
 *
 * Prints PASS/FAIL per assertion, grouped by criterion, and the terminal token
 * ALL_PHASE02_CONTRACTS_PASS only when every assertion passed.
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
const TopDown = s.TopDown;
const Game = s.Game;
const Framebuffer = s.Framebuffer;
const raf = h.raf;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const dirAngle = () => Math.atan2(Player.dirY, Player.dirX);
function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}
const step = (ms) => raf.step(ms);
function heading(t) { console.log(''); console.log('== ' + t + ' =='); }

function placeAt(landmark, dx, dy) {
  Player.x = landmark.x;
  Player.y = landmark.y;
  Player.setDir(dx == null ? 1 : dx, dy == null ? 0 : dy);
}
function placeOpen(dx, dy) { placeAt(Level.LANDMARKS.openCell, dx, dy); }

// Drive real key events through the wired Input global for `frames` steps of
// `dtMs`, from the openCell anchor facing (dx,dy). Returns the displacement.
function driveKeys(codes, frames, dtMs, dx, dy) {
  Input.reset();
  placeOpen(dx == null ? 1 : dx, dy == null ? 0 : dy);
  const sx = Player.x, sy = Player.y;
  for (let i = 0; i < codes.length; i++) h.dispatch('window', 'keydown', { code: codes[i] });
  for (let i = 0; i < frames; i++) step(dtMs);
  for (let i = 0; i < codes.length; i++) h.dispatch('window', 'keyup', { code: codes[i] });
  return { dx: Player.x - sx, dy: Player.y - sy };
}

// Consume the resync frame Game.start() armed.
step(1000 / 60);

// ===========================================================================
// CRITERION 1 — moves, strafes, runs, frame-rate independent, survives refocus.
// ===========================================================================
heading('CRITERION 1: move / strafe / run / frame-rate independence / tab refocus');

(function () {
  // Direction of each key relative to the current dir/plane, and exact-negative
  // opposite pairs. Short 10-frame drives stay well within openCell clearance.
  placeOpen(1, 0);
  const dirX = Player.dirX, dirY = Player.dirY;
  const planeLen = Math.hypot(Player.planeX, Player.planeY);
  const pnx = Player.planeX / planeLen, pny = Player.planeY / planeLen;

  const fwd = driveKeys(['KeyW'], 10, 16, 1, 0);
  const back = driveKeys(['KeyS'], 10, 16, 1, 0);
  const left = driveKeys(['KeyA'], 10, 16, 1, 0);
  const right = driveKeys(['KeyD'], 10, 16, 1, 0);

  const dotF = (fwd.dx * dirX + fwd.dy * dirY) / Math.hypot(fwd.dx, fwd.dy);
  const dotB = (back.dx * dirX + back.dy * dirY) / Math.hypot(back.dx, back.dy);
  const dotR = (right.dx * pnx + right.dy * pny) / Math.hypot(right.dx, right.dy);
  const dotL = (left.dx * pnx + left.dy * pny) / Math.hypot(left.dx, left.dy);
  assert(dotF > 1 - 1e-9 && dotB < -1 + 1e-9,
    '1.1 KeyW moves along +dir and KeyS along -dir');
  assert(dotR > 1 - 1e-9 && dotL < -1 + 1e-9,
    '1.2 KeyD strafes along +plane and KeyA along -plane');
  assert(near(fwd.dx, -back.dx, 1e-9) && near(fwd.dy, -back.dy, 1e-9),
    '1.3 forward and back displacements are exact negatives (1e-9)');
  assert(near(right.dx, -left.dx, 1e-9) && near(right.dy, -left.dy, 1e-9),
    '1.4 strafe-right and strafe-left displacements are exact negatives (1e-9)');

  // Run modifier travels RUN_MULT as far over the same 0.5 s duration.
  const walk = driveKeys(['KeyW'], 30, 1000 / 60, 1, 0);
  const run = driveKeys(['KeyW', 'ShiftLeft'], 30, 1000 / 60, 1, 0);
  const ratio = Math.hypot(run.dx, run.dy) / Math.hypot(walk.dx, walk.dy);
  assert(Math.abs(ratio - Player.RUN_MULT) < 0.01 * Player.RUN_MULT,
    '1.5 holding ShiftLeft travels RUN_MULT times as far in the same duration (within 1%)');

  // Frame-rate independence: one second at 60 fps vs 250 fps (eastward has ample
  // room from openCell), each ~WALK_SPEED.
  const d60 = driveKeys(['KeyW'], 60, 1000 / 60, 1, 0);
  const d250 = driveKeys(['KeyW'], 250, 4, 1, 0);
  const dist60 = Math.hypot(d60.dx, d60.dy);
  const dist250 = Math.hypot(d250.dx, d250.dy);
  assert(Math.abs(dist60 - dist250) / dist60 < 0.02 &&
    near(dist60, Player.WALK_SPEED, 0.02 * Player.WALK_SPEED),
    '1.6 one simulated second of forward travels the same distance at 60 and 250 fps (within 2%)');

  // A 2000 ms frame clamps dt to at most DT_MAX.
  Input.reset();
  step(2000);
  assert(Game.dt <= CONFIG.DT_MAX + 1e-12,
    '1.7 after a frame whose raw delta is 2000 ms, Game.dt <= CONFIG.DT_MAX');
})();

// Tab-refocus resync — driven directly through the stub for BOTH triggers.
function tabRefocusTest(trigger, label) {
  // Start held-forward from openCell so a SKIPPED step is visible as no motion.
  Input.reset();
  placeOpen(1, 0);
  h.dispatch('window', 'keydown', { code: 'KeyW' });

  // Fire the trigger. Both set Game.resync AND call Input.reset() (via the loop's
  // resetInput), clearing the held key.
  if (trigger === 'visibility') h.setVisibility('visible');
  else h.dispatch('window', 'focus', {});

  const resyncSet = Game.resync === true;
  const clearedForward = Input.readIntent().forward === 0; // held key was cleared
  assert(resyncSet, '1.8 (' + label + ') the trigger set Game.resync');
  assert(clearedForward, '1.9 (' + label + ') Input.reset() cleared the held key (forward slot 0, no keyup)');

  // The reset cleared the key, so re-press forward NOW (before the resync frame)
  // to model the player pressing forward again on return. Snapshot AFTER re-press.
  h.dispatch('window', 'keydown', { code: 'KeyW' });
  const px = Player.x, py = Player.y, pdx = Player.dirX, pdy = Player.dirY;
  const put0 = h.putCount();

  // The resync frame: a huge raw delta, but dt is exactly 0, the step is skipped
  // (pose bit-identical even with forward held), resync clears, and it STILL
  // presents.
  step(5000);
  const resyncFrameOk =
    Game.dt === 0 &&
    Player.x === px && Player.y === py && Player.dirX === pdx && Player.dirY === pdy &&
    Game.resync === false &&
    h.putCount() === put0 + 1;
  assert(resyncFrameOk,
    '1.10 (' + label + ') resync frame: dt exactly 0, pose bit-identical with forward held, resync cleared, still presented');

  // The next normal frame advances the pose — the loop was not left stalled.
  const nx = Player.x;
  step(16);
  assert(Player.x > nx && near(Player.x - nx, Player.WALK_SPEED * 0.016, 0.10 * Player.WALK_SPEED * 0.016),
    '1.11 (' + label + ') the frame after resync advances ~WALK_SPEED*0.016 with forward still held');

  h.dispatch('window', 'keyup', { code: 'KeyW' });
}
tabRefocusTest('visibility', 'visibilitychange');
tabRefocusTest('focus', 'focus');

// ===========================================================================
// CRITERION 2 — mouse-look under pointer lock; arrow-key turn without it.
// ===========================================================================
heading('CRITERION 2: mouse-look under lock / arrow-key fallback / lock hygiene');

(function () {
  const SENS = Player.MOUSE_SENSITIVITY;
  const TURN = Player.TURN_SPEED;

  // Mouse rotates the camera under lock.
  h.setPointerLockElement('game');
  Input.reset();
  Player.setDir(1, 0);
  let a0 = dirAngle();
  h.dispatch('document', 'mousemove', { movementX: 60 });
  step(16);
  assert(near(angleDiff(a0, dirAngle()), 60 * SENS, 1e-6),
    '2.1 under pointer lock, a mousemove turns the camera by movementX * MOUSE_SENSITIVITY');

  // The click handler requests lock (gesture-scoped, not requested at load).
  const la0 = Input.lockAttempts;
  h.dispatch('game', 'click', {});
  assert(Input.lockAttempts === la0 + 1,
    '2.2 the canvas click handler requests pointer lock (lockAttempts increments)');

  // No lock -> no rotation from a large movement (the lock check is honoured).
  h.setPointerLockElement(null);
  Input.reset();
  Player.setDir(1, 0);
  a0 = dirAngle();
  h.dispatch('document', 'mousemove', { movementX: 100000 });
  step(16);
  assert(near(angleDiff(a0, dirAngle()), 0, 1e-9),
    '2.3 with no pointer lock, a large mousemove produces NO rotation');

  // Arrow-key turn works with no lock (the CTRL-03 fallback), opposite directions.
  Input.reset();
  Player.setDir(1, 0);
  a0 = dirAngle();
  h.dispatch('window', 'keydown', { code: 'ArrowLeft' });
  for (let i = 0; i < 60; i++) step(1000 / 60);
  h.dispatch('window', 'keyup', { code: 'ArrowLeft' });
  const rotLeft = angleDiff(a0, dirAngle());

  Player.setDir(1, 0);
  a0 = dirAngle();
  h.dispatch('window', 'keydown', { code: 'ArrowRight' });
  for (let i = 0; i < 60; i++) step(1000 / 60);
  h.dispatch('window', 'keyup', { code: 'ArrowRight' });
  const rotRight = angleDiff(a0, dirAngle());
  assert(near(rotLeft, -TURN, 1e-6) && near(rotRight, TURN, 1e-6),
    '2.4 unlocked: ArrowLeft rotates -TURN_SPEED and ArrowRight +TURN_SPEED over one second (1e-6)');

  // A pointer-lock error then a null-element change leaves turning functional and
  // clears Input.locked.
  h.dispatch('document', 'pointerlockerror', {});
  h.setPointerLockElement(null);
  const lockedCleared = Input.locked === false;
  Input.reset();
  Player.setDir(1, 0);
  a0 = dirAngle();
  h.dispatch('window', 'keydown', { code: 'ArrowRight' });
  for (let i = 0; i < 20; i++) step(16);
  h.dispatch('window', 'keyup', { code: 'ArrowRight' });
  const stillTurns = angleDiff(a0, dirAngle()) > 1e-3;
  assert(lockedCleared && stillTurns,
    '2.5 after pointerlockerror + null pointerlockchange: Input.locked is false and arrow turning still works');

  // A single enormous movement is magnitude-clamped to MOUSE_MAX_DX.
  h.setPointerLockElement('game');
  Input.reset(); // mouseDX -> 0
  h.dispatch('document', 'mousemove', { movementX: 100000 });
  assert(Input.mouseDX <= Input.MOUSE_MAX_DX + 1e-9 && Input.mouseDX === Input.MOUSE_MAX_DX,
    '2.6 a single mousemove of 100000 contributes no more than MOUSE_MAX_DX');

  // A held key plus a window blur clears the held-key set.
  h.dispatch('window', 'keydown', { code: 'KeyW' });
  h.dispatch('window', 'blur', {});
  assert(Input.readIntent().forward === 0,
    '2.7 keydown KeyW then a window blur leaves the next readIntent forward slot at 0');
})();

// ===========================================================================
// CRITERION 3 — cannot pass through walls; slides; no tunneling at run speed.
// Reuses the falsifiable invariants Plan 02 established, driven through a scripted
// intent source so arbitrary continuous intents and frame deltas can be crafted.
// ===========================================================================
heading('CRITERION 3: no tunneling / side preservation / wall sliding');

(function () {
  const scripted = {
    intent: { forward: 0, strafe: 0, turn: 0, run: false, mouseDX: 0 },
    readIntent: function () { return this.intent; },
    reset: function () { this.intent = { forward: 0, strafe: 0, turn: 0, run: false, mouseDX: 0 }; }
  };
  const realInput = Game.input;
  Game.input = scripted;
  Game.resync = false; // clear any resync armed by criterion 1 so hitch frames bite

  // (a) 6000-frame randomized drive with occasional 2 s hitches.
  const rng = s.mulberry32(CONFIG.SEED + 7);
  placeOpen(1, 0);
  let insideOk = true, skipOk = true, cornerOk = true;
  for (let f = 0; f < 6000; f++) {
    scripted.intent = {
      forward: rng() * 2 - 1, strafe: rng() * 2 - 1, turn: rng() * 2 - 1,
      run: rng() < 0.5, mouseDX: 0
    };
    const pmx = Math.floor(Player.x), pmy = Math.floor(Player.y);
    step(rng() < 0.03 ? 2000 : 16);
    const mx = Math.floor(Player.x), my = Math.floor(Player.y);

    if (!isFinite(Player.x) || !isFinite(Player.y)) insideOk = false;
    if (mx < 0 || my < 0 || mx >= Level.WIDTH || my >= Level.HEIGHT) insideOk = false;
    if (Level.isSolid(mx, my)) insideOk = false;
    if (Math.abs(mx - pmx) > 1 || Math.abs(my - pmy) > 1) skipOk = false;
    if (mx !== pmx && my !== pmy && Level.isSolid(mx, pmy)) cornerOk = false;
  }
  assert(insideOk, '3.1 6000 frames: player is always finite, in bounds and never inside a solid cell');
  assert(skipOk, '3.2 6000 frames: never skips a cell on either axis (|dmx|<=1 and |dmy|<=1)');
  assert(cornerOk, '3.3 6000 frames: never cuts a solid corner (intermediate cell (mx,pmy) non-solid)');

  // (b) Side preservation against the NAMED east wall face under a 2 s hitch.
  const L = Level.LANDMARKS.wallFaceEast;
  const R = Player.RADIUS;
  placeAt(L, 1, 0);
  scripted.intent = { forward: 1, strafe: 0, turn: 0, run: true, mouseDX: 0 };
  let sideOk = true;
  function checkSide() {
    if (!(Player.x < L.wf - R + 1e-9)) sideOk = false;
    if (Math.floor(Player.x) !== L.mx) sideOk = false;
    if (Math.floor(Player.y) !== L.my) sideOk = false;
  }
  step(2000); checkSide();
  for (let i = 0; i < 200; i++) { step(16); checkSide(); }
  assert(sideOk,
    '3.4 a 2 s hitch at run speed into wallFaceEast never crosses wf - RADIUS or leaves the cell');

  // (c) Diagonal into a corridor wall slides: blocked axis arrested, free slides.
  const C = Level.LANDMARKS.corridorCell;
  const intoX = C.blockedAxis === 'x' ? 1 : 0;
  const intoY = C.blockedAxis === 'y' ? 1 : 0;
  placeAt(C, intoX + C.slideDir.x, intoY + C.slideDir.y);
  scripted.intent = { forward: 1, strafe: 0, turn: 0, run: false, mouseDX: 0 };
  const blockedKey = C.blockedAxis;
  const freeKey = C.blockedAxis === 'x' ? 'y' : 'x';
  const blocked = [], free = [];
  for (let i = 0; i < 60; i++) {
    step(16);
    blocked.push(Player[blockedKey]);
    free.push(Player[freeKey]);
  }
  let blockedRest = true;
  for (let i = 40; i < 60; i++) if (Math.abs(blocked[i] - blocked[59]) > 1e-9) blockedRest = false;
  const freeMoved = Math.abs(free[59] - C[freeKey]) > 0.3;
  const stillInCell = Math.floor(Player[blockedKey]) === Math.floor(C[blockedKey]);
  assert(blockedRest && freeMoved && stillInCell,
    '3.5 diagonal into a corridor wall: blocked axis arrested (final 20 frames), free axis slides > 0.3, stays in cell');

  Game.input = realInput;
  Input.reset();
})();

// ===========================================================================
// CRITERION 4 — level loads and the pose is verifiable top-down.
// ===========================================================================
heading('CRITERION 4: level structure and top-down pose verification');

(function () {
  // Level structure: >=3 disjoint 4x4 open blocks, a corridor cell, all five IDs.
  function disjoint4x4Count() {
    const W = Level.WIDTH, H = Level.HEIGHT;
    const claimed = new Uint8Array(W * H);
    let count = 0;
    for (let my = 0; my + 4 <= H; my++) {
      for (let mx = 0; mx + 4 <= W; mx++) {
        let ok = true;
        for (let oy = 0; oy < 4 && ok; oy++) {
          for (let ox = 0; ox < 4; ox++) {
            const i = (my + oy) * W + (mx + ox);
            if (Level.cellAt(mx + ox, my + oy) !== 0 || claimed[i]) { ok = false; break; }
          }
        }
        if (!ok) continue;
        for (let oy = 0; oy < 4; oy++) for (let ox = 0; ox < 4; ox++) claimed[(my + oy) * W + (mx + ox)] = 1;
        count++;
      }
    }
    return count;
  }
  const ids = new Set();
  for (let i = 0; i < Level.cells.length; i++) ids.add(Level.cells[i]);
  const allIds = [1, 2, 3, 4, 5].every((id) => ids.has(id));
  assert(disjoint4x4Count() >= 3, '4.1 the level exposes at least three disjoint 4x4 open blocks');
  assert(!!Level.LANDMARKS.corridorCell, '4.2 the level exposes at least one one-cell-wide corridor cell');
  assert(allIds, '4.3 all five wall IDs (1..5) are in use in the grid');

  // The view is wired and does NOT itself present.
  assert(TopDown.ENABLED === true && Game.view === TopDown,
    '4.4 TopDown.ENABLED is true and Game.view is TopDown');
  const putBefore = h.putCount();
  TopDown.render();
  assert(h.putCount() === putBefore,
    '4.5 a direct TopDown.render() does not present (putImageData count unchanged)');

  // The framebuffer carries the pose and the map after a frame.
  placeOpen(1, 0);
  step(16);
  const buf = Framebuffer.buf32;
  const p = TopDown.toScreen(Player.x, Player.y);
  assert(buf[p.sy * Framebuffer.width + p.sx] === TopDown.PLAYER,
    '4.6 the player pixel at TopDown.toScreen(Player.x, Player.y) is the player colour');
  const wallSet = new Set(TopDown.WALL_COLORS.slice(1));
  const seen = new Set();
  for (let i = 0; i < buf.length; i++) { if (wallSet.has(buf[i])) seen.add(buf[i]); if (seen.size >= 2) break; }
  assert(seen.size >= 2, '4.7 the framebuffer contains at least two distinct wall colours');

  // Facing is drawn from the direction vector: a 90-degree rotation changes the
  // set of facing-ray pixels, and both renders draw at least one ray pixel.
  function rayPixels() {
    const set = new Set();
    for (let i = 0; i < buf.length; i++) if (buf[i] === TopDown.RAY) set.add(i);
    return set;
  }
  placeOpen(1, 0);
  TopDown.render();
  const rayA = rayPixels();
  Player.rotate(Math.PI / 2);
  TopDown.render();
  const rayB = rayPixels();
  let sameSet = rayA.size === rayB.size;
  if (sameSet) { for (const i of rayA) if (!rayB.has(i)) { sameSet = false; break; } }
  assert(rayA.size > 0 && rayB.size > 0 && !sameSet,
    '4.8 rotating 90 degrees changes the facing-ray pixels, and both renders draw the ray');

  // Extreme viewports: cell size stays >= 1 and no write escapes the buffer.
  function viewportOk(w, hh) {
    let threw = false, cellOk = false, lenSame = false;
    try {
      h.resize(w, hh);
      const lenBefore = Framebuffer.buf32.length;
      TopDown.layout();
      cellOk = TopDown.cell >= 1;
      placeOpen(1, 0);
      TopDown.render();
      lenSame = Framebuffer.buf32.length === lenBefore;
    } catch (e) { threw = true; }
    return !threw && cellOk && lenSame;
  }
  const tall = viewportOk(400, 4000);   // framebuffer height clamps to MAX_H
  const wide = viewportOk(4000, 400);   // framebuffer height clamps to MIN_H
  assert(tall && wide,
    '4.9 tall-narrow and wide-short viewports both yield cell >= 1 with no out-of-bounds write');
  h.resize(1280, 720); // restore
})();

// ===========================================================================
// SELF-CONTAINMENT + PRESENT-COUNT gates (harness-wide).
// ===========================================================================
heading('SELF-CONTAINMENT and present-count gates');

(function () {
  // Every browser-loaded reference is relative and resolves under js/ or is
  // style.css — nothing under tools/ is reachable from the browser.
  const refs = h.resourceRefs;
  let selfOk = refs.length > 0;
  for (let i = 0; i < refs.length; i++) {
    const r = refs[i];
    if (/:\/\//.test(r) || r.charAt(0) === '/' || !(/^js\/[^/]+\.js$/.test(r) || r === 'style.css')) {
      selfOk = false;
    }
  }
  assert(selfOk, 'SC. every index.html src/href is a relative js/*.js or style.css path');

  // Present count == frame count across the WHOLE harness (every frame presented
  // exactly once, resync and hitch frames included).
  assert(h.putCount() === Game.frames,
    'PC. putImageData count equals frame count across the whole harness');
})();

finish('ALL_PHASE02_CONTRACTS_PASS');
