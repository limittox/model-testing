/*
 * tools/verify-sprites.cjs — the Phase 4 sprite-tracer END-TO-END harness (04-01).
 *
 * NODE-ONLY (never referenced by index.html). Built on tools/boot.cjs: it boots
 * the SHIPPED script list in the SHIPPED order into one vm context with a stubbed
 * DOM, fires the window load event (main.js has already built Entities from
 * Level.spawns and wired Raycaster.spritePass = Entities.render), then asserts the
 * tracer's sprite contracts DIRECTLY on Framebuffer.buf32.
 *
 * This is NOT a per-layer unit test. It proves the ONE path the tracer wired —
 * Level.spawns -> Entities.list -> billboard projection -> far->near sort ->
 * per-column z-buffer occluded draw, run inside Raycaster.render() before
 * Game.render's single present() — is correct end to end.
 *
 * FALSIFIABILITY DISCIPLINE (mirrors verify-render.cjs's referenceDDA idiom):
 *   - projectSprite() recomputes the billboard projection FROM THE FORMULA (not a
 *     call into Entities), so a shared projection bug cannot hide.
 *   - The occlusion proof pairs a behind-wall entity (must draw ZERO columns) with
 *     an in-front entity on the SAME view ray (must draw > 0) — the in-front case
 *     is the control proving the zero-draw is real occlusion, not an off-screen or
 *     degenerate projection.
 *
 * BACKGROUND-DIFF ROBUSTNESS (plan-checker advisory): a drawn pixel is normally
 * identified by buf32[i] !== bg[i] (render once with the sprite pass OFF for the
 * background, once ON). Because a coincidental value match could false-NEGATIVE,
 * the positive proofs ALSO cross-check against an independent source-alpha
 * recompute (source texel alpha >= ALPHA_KEY) and assert the rendered pixel equals
 * the RAW (unshaded) sprite texel — value inequality is never the sole evidence.
 *
 * Prints PASS/FAIL per assertion and the terminal token ALL_SPRITE_CONTRACTS_PASS
 * only when every assertion passed.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { boot, assert, finish, GAME_DIR } = require('./boot.cjs');

// ---------------------------------------------------------------------------
// Boot the shipped game and run main.js's load handler. After this Entities.list
// is built from Level.spawns and Raycaster.spritePass === Entities.render.
// ---------------------------------------------------------------------------
const h = boot({});
h.fireLoad();

const s = h.sandbox;
const CONFIG = s.CONFIG;
const Level = s.Level;
const Player = s.Player;
const Raycaster = s.Raycaster;
const Entities = s.Entities;
const Framebuffer = s.Framebuffer;
const Sprites = s.Sprites;

const NEAR = 0.05; // must match Entities.NEAR

// ===========================================================================
// INDEPENDENT billboard projection recompute — a SECOND, from-the-formula copy
// of Entities.render's projection math (NOT a call into Entities), so a shared
// bug cannot hide. Byte-for-byte the renderer's operations and clamp order, so
// spriteDim / originX / originY / draw bounds compare exactly.
// ===========================================================================
function projectSprite(pose, e, W, H) {
  const invDet = 1 / (pose.planeX * pose.dirY - pose.dirX * pose.planeY);
  const relX = e.x - pose.px, relY = e.y - pose.py;
  const transformX = invDet * (pose.dirY * relX - pose.dirX * relY);
  const transformY = invDet * (-pose.planeY * relX + pose.planeX * relY);

  const spriteScreenX = Math.floor((W / 2) * (1 + transformX / transformY));
  const spriteDim = Math.abs(Math.floor(H / transformY)) * e.scale;
  const vMove = e.onFloor ? (H * (1 - e.scale) / 2) : 0;
  const vMoveScreen = Math.floor(vMove / transformY);

  const originX = -spriteDim / 2 + spriteScreenX;
  const originY = -spriteDim / 2 + H / 2 + vMoveScreen;

  let drawStartX = Math.floor(originX); if (drawStartX < 0) drawStartX = 0;
  let drawEndX = Math.floor(originX + spriteDim); if (drawEndX > W) drawEndX = W;
  let drawStartY = Math.floor(originY); if (drawStartY < 0) drawStartY = 0;
  let drawEndY = Math.floor(originY + spriteDim); if (drawEndY > H) drawEndY = H;

  return {
    invDet, transformX, transformY,
    onScreen: transformY > NEAR,
    spriteScreenX, spriteDim, vMoveScreen, originX, originY,
    drawStartX, drawEndX, drawStartY, drawEndY
  };
}

function poseOf() {
  return {
    px: Player.x, py: Player.y,
    dirX: Player.dirX, dirY: Player.dirY,
    planeX: Player.planeX, planeY: Player.planeY
  };
}

// Render the background (walls/floor, NO sprites) into a fresh copy, then render
// again WITH the sprite pass. Returns { bg, cur } Uint32Array snapshots.
function renderBgAndSprites() {
  Raycaster.spritePass = null;
  Raycaster.render();
  const bg = Framebuffer.buf32.slice();
  Raycaster.spritePass = Entities.render;
  Raycaster.render();
  const cur = Framebuffer.buf32.slice();
  return { bg, cur };
}

// The set of columns that changed between bg and cur (i.e. sprite-drawn columns).
function drawnColumns(bg, cur, W, H) {
  const cols = new Set();
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      if (cur[row + x] !== bg[row + x]) cols.add(x);
    }
  }
  return cols;
}

// Install a controlled entity list and make sure the sort scratch covers it.
function setEntities(list) {
  Entities.list = list;
  Entities._ensureScratch(list.length);
}

// ===========================================================================
// 0. BOOT WIRED THE SPRITE SEAM AND BUILT THE LIST.
// ===========================================================================
(function () {
  assert(typeof Entities === 'object' && Entities !== null,
    '0a. Entities global exists (js/entities.js loaded)');
  assert(Raycaster.spritePass === Entities.render,
    '0b. main.js wired Raycaster.spritePass = Entities.render');
  assert(Array.isArray(Entities.list) && Entities.list.length > 0,
    '0c. Entities.list is non-empty, built from Level.spawns (' + Entities.list.length + ' billboards)');
  // Every built entity resolves to a real sprite asset and carries no behaviour
  // fields (Phase 5 owns those) — the static-billboard contract.
  let allValid = true, noBehaviour = true;
  for (const e of Entities.list) {
    if (!Sprites.map[e.sprite]) allValid = false;
    if ('health' in e || 'state' in e || 'ai' in e) noBehaviour = false;
  }
  assert(allValid, '0d. every entity maps to a real Sprites.map asset (enemy/pickup)');
  assert(noBehaviour, '0e. entities carry no behaviour fields (health/state/ai) — Phase 5 owns them');
})();

// ===========================================================================
// 1. BUILD IS SPAWN-DERIVED AND IDEMPOTENT. enemy spawns -> 'enemy' scale 1;
//    health/armor/ammo/shotgun -> 'pickup' scale 0.5; exit/player skipped.
// ===========================================================================
(function () {
  const spawns = Level.spawns;
  let expected = 0;
  for (const sp of spawns) {
    if (sp.type === 'enemy' || sp.type === 'health' || sp.type === 'armor' ||
        sp.type === 'ammo' || sp.type === 'shotgun') expected++;
  }
  const before = Entities.list.length;
  Entities.build();  // idempotent rebuild
  assert(Entities.list.length === before && Entities.list.length === expected,
    '1a. build() is spawn-derived and idempotent (' + expected + ' billboards, exit/player skipped)');

  // Type mapping spot-check: an enemy spawn -> scale 1 onFloor; a pickup -> 0.5.
  let enemyOk = true, pickupOk = true;
  for (const e of Entities.list) {
    if (e.sprite === 'enemy' && !(e.scale === 1.0 && e.onFloor === true)) enemyOk = false;
    if (e.sprite === 'pickup' && !(e.scale === 0.5 && e.onFloor === true)) pickupOk = false;
  }
  assert(enemyOk, '1b. enemy billboards are scale 1.0, onFloor true');
  assert(pickupOk, '1c. pickup billboards are scale 0.5, onFloor true');

  // No 'exit'/'player' leaked into the list.
  let noExit = true;
  const hasExitSpawn = spawns.some((sp) => sp.type === 'exit');
  for (const e of Entities.list) if (e.sprite === 'exit') noExit = false;
  assert(noExit && hasExitSpawn,
    '1d. the exit spawn exists in Level.spawns but produces NO billboard this phase');
})();

// ===========================================================================
// 2. PROOF A — OCCLUSION FIRST CUT (ENT-02, 04-CONTEXT decision 7a).
//    Player at (3.5,2.5) facing +x. The map has a solid block at cols 9..12 on
//    row 2. An enemy at (6.5,2.5) is IN FRONT of that block (clear LOS); an enemy
//    at (13.5,2.5) is BEHIND it (LOS false). Along the SAME view ray:
//      behind-wall enemy => ZERO sprite-drawn columns (occluded),
//      in-front enemy    => > 0 sprite-drawn columns (the falsifiability control).
// ===========================================================================
(function () {
  const W = Framebuffer.width, H = Framebuffer.height;

  // --- Geometry preconditions (fail loudly if the map is edited) ------------
  assert(Level.cellAt(3, 2) === 0 && Level.cellAt(6, 2) === 0 && Level.cellAt(13, 2) === 0,
    '2a. precondition: (3,2),(6,2),(13,2) are floor cells on row 2');
  assert(Level.isSolid(9, 2) && Level.isSolid(10, 2) && Level.isSolid(11, 2) && Level.isSolid(12, 2),
    '2b. precondition: a solid wall block spans cols 9..12 on row 2');
  assert(Level.lineOfSight(3.5, 2.5, 6.5, 2.5) === true,
    '2c. precondition: clear line of sight player -> in-front position');
  assert(Level.lineOfSight(3.5, 2.5, 13.5, 2.5) === false,
    '2d. precondition: NO line of sight player -> behind-wall position (a wall intervenes)');

  Player.x = 3.5; Player.y = 2.5;
  Player.setDir(1, 0);
  const pose = poseOf();

  const front = { x: 6.5, y: 2.5, sprite: 'enemy', scale: 1.0, onFloor: true };
  const behind = { x: 13.5, y: 2.5, sprite: 'enemy', scale: 1.0, onFloor: true };

  const pf = projectSprite(pose, front, W, H);
  const pb = projectSprite(pose, behind, W, H);

  // Both project on-screen with a positive dimension (so the behind case's zero
  // draw cannot be blamed on an off-screen/degenerate projection).
  assert(pf.onScreen && pf.spriteDim > 0 && pf.drawEndX > pf.drawStartX,
    '2e. in-front enemy projects on-screen with positive width (spriteDim ' + pf.spriteDim + ')');
  assert(pb.onScreen && pb.spriteDim > 0 && pb.drawEndX > pb.drawStartX,
    '2f. behind-wall enemy ALSO projects on-screen with positive width (spriteDim ' + pb.spriteDim +
    ') — its zero draw is occlusion, not a degenerate projection');

  // Independently: at the behind entity's columns the wall depth (zBuffer) is
  // NEARER than the sprite depth (transformY), so every column must be occluded.
  Raycaster.spritePass = null;
  Raycaster.render();                         // fills zBuffer for this pose
  let behindOccludedEverywhere = true;
  for (let x = pb.drawStartX; x < pb.drawEndX; x++) {
    if (!(pb.transformY >= Framebuffer.zBuffer[x])) behindOccludedEverywhere = false;
  }
  assert(behindOccludedEverywhere,
    '2g. at EVERY behind-enemy column the wall zBuffer is nearer than transformY (' +
    pb.transformY.toFixed(2) + ') — the occlusion test must reject all of them');

  // --- Render the behind case and assert ZERO columns drawn -----------------
  setEntities([behind]);
  let r = renderBgAndSprites();
  const behindCols = drawnColumns(r.bg, r.cur, W, H);
  // Robustness: assert the entire projected bbox is byte-identical to bg (no
  // sprite pixel written anywhere it could have appeared), not merely a column
  // count — equality-to-bg cannot false-negative.
  let behindUntouched = true;
  for (let y = pb.drawStartY; y < pb.drawEndY && behindUntouched; y++) {
    for (let x = pb.drawStartX; x < pb.drawEndX; x++) {
      if (r.cur[y * W + x] !== r.bg[y * W + x]) { behindUntouched = false; break; }
    }
  }
  assert(behindCols.size === 0 && behindUntouched,
    '2h. ENT-02: the behind-wall enemy draws ZERO columns (fully occluded) — ' +
    behindCols.size + ' drawn');

  // --- Render the in-front case: the falsifiability CONTROL -----------------
  setEntities([front]);
  r = renderBgAndSprites();
  const frontCols = drawnColumns(r.bg, r.cur, W, H);
  assert(frontCols.size > 0,
    '2i. CONTROL: the SAME enemy in front of the wall draws > 0 columns (' + frontCols.size +
    ') — proving the zero-draw above is real occlusion');

  // Positive cross-check (independent of value inequality): find one opaque
  // source texel of the front sprite whose column passes occlusion, and assert
  // the rendered pixel equals the RAW (unshaded) sprite texel written there.
  const tex = Sprites.map.enemy;
  const TEXW = tex.width, TEXH = tex.height, tbuf = tex.buf32;
  const zbuf = Framebuffer.zBuffer; // wall depth for the front pose (just rendered)
  let proven = false;
  for (let x = pf.drawStartX; x < pf.drawEndX && !proven; x++) {
    if (!(pf.transformY > 0 && pf.transformY < zbuf[x])) continue; // occlusion must pass
    let texX = Math.floor((x - pf.originX) * TEXW / pf.spriteDim);
    if (texX < 0) texX = 0; else if (texX > TEXW - 1) texX = TEXW - 1;
    for (let y = pf.drawStartY; y < pf.drawEndY; y++) {
      let texY = Math.floor((y - pf.originY) * TEXH / pf.spriteDim);
      if (texY < 0) texY = 0; else if (texY > TEXH - 1) texY = TEXH - 1;
      const packed = tbuf[texY * TEXW + texX] >>> 0;
      if (((packed >>> 24) & 0xff) < Sprites.ALPHA_KEY) continue; // transparent texel
      assert((r.cur[y * W + x] >>> 0) === packed,
        '2j. a drawn front-sprite pixel === the RAW opaque source texel (unshaded tracer) ' +
        'at column ' + x + ', row ' + y);
      proven = true;
      break;
    }
  }
  assert(proven, '2k. at least one opaque, occlusion-passing front-sprite texel was located and verified');
})();

// ---------------------------------------------------------------------------
// The opaque-texel bounding box of a sprite asset (independent of any render).
// Used by the scaling + squareness proofs to relate DRAWN pixel extents back to
// the sprite's own silhouette, so the proofs survive a non-full-frame sprite.
// ---------------------------------------------------------------------------
function spriteTexelBBox(tex) {
  const TEXW = tex.width, TEXH = tex.height, tb = tex.buf32;
  let minX = TEXW, maxX = -1, minY = TEXH, maxY = -1;
  for (let ty = 0; ty < TEXH; ty++) {
    for (let tx = 0; tx < TEXW; tx++) {
      if (((tb[ty * TEXW + tx] >>> 24) & 0xff) >= Sprites.ALPHA_KEY) {
        if (tx < minX) minX = tx; if (tx > maxX) maxX = tx;
        if (ty < minY) minY = ty; if (ty > maxY) maxY = ty;
      }
    }
  }
  return { minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// The drawn (sprite-touched) bounding box between bg and cur.
function drawnBBox(bg, cur, W, H) {
  let minX = W, maxX = -1, minY = H, maxY = -1;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      if (cur[row + x] !== bg[row + x]) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// The tallest drawn column's vertical extent (robust "drawn pixel-height").
function drawnColumnExtent(bg, cur, W, H) {
  let best = 0;
  for (let x = 0; x < W; x++) {
    let lo = -1, hi = -1;
    for (let y = 0; y < H; y++) {
      if (cur[y * W + x] !== bg[y * W + x]) { if (lo < 0) lo = y; hi = y; }
    }
    if (lo >= 0 && (hi - lo + 1) > best) best = hi - lo + 1;
  }
  return best;
}

// ===========================================================================
// 3. PROOF B — DISTANCE SCALING ~2:1 (ENT-01, 04-CONTEXT decision 7b). The SAME
//    enemy directly ahead (clear LOS on the long open row 4) at distance d and
//    2d has drawn pixel-height in ~2:1 ratio, cross-checked against the locked
//    projectSprite() spriteDim (which uses H). Player at (2.5,4.5) facing +x;
//    enemy at (6.5,4.5) [d=4] and (10.5,4.5) [2d=8].
// ===========================================================================
(function () {
  const W = Framebuffer.width, H = Framebuffer.height;

  assert(Level.cellAt(6, 4) === 0 && Level.cellAt(10, 4) === 0 &&
         Level.lineOfSight(2.5, 4.5, 6.5, 4.5) && Level.lineOfSight(2.5, 4.5, 10.5, 4.5),
    '3a. precondition: enemy positions at d and 2d are open floor with clear LOS');

  Player.x = 2.5; Player.y = 4.5;
  Player.setDir(1, 0);
  const pose = poseOf();

  const near = { x: 6.5,  y: 4.5, sprite: 'enemy', scale: 1.0, onFloor: true };  // d = 4
  const far  = { x: 10.5, y: 4.5, sprite: 'enemy', scale: 1.0, onFloor: true };  // 2d = 8

  const pNear = projectSprite(pose, near, W, H);
  const pFar = projectSprite(pose, far, W, H);
  assert(Math.abs(pNear.transformY - 4) < 1e-9 && Math.abs(pFar.transformY - 8) < 1e-9,
    '3b. transformY equals the true forward distance (d=4, 2d=8) — projection depth is correct');

  // The locked formula: spriteDim uses H, so it halves as distance doubles.
  const dimRatio = pNear.spriteDim / pFar.spriteDim;
  assert(dimRatio > 1.8 && dimRatio < 2.2,
    '3c. projectSprite spriteDim(d)/spriteDim(2d) ~ 2 (' + dimRatio.toFixed(3) + ') — H/transformY halves');

  setEntities([near]);
  let r = renderBgAndSprites();
  const extNear = drawnColumnExtent(r.bg, r.cur, W, H);

  setEntities([far]);
  r = renderBgAndSprites();
  const extFar = drawnColumnExtent(r.bg, r.cur, W, H);

  assert(extNear > 0 && extFar > 0,
    '3d. both the near and far enemy actually draw (drawn heights ' + extNear + ', ' + extFar + ')');

  const drawnRatio = extNear / extFar;
  assert(drawnRatio > 1.8 && drawnRatio < 2.2,
    '3e. ENT-01: the DRAWN pixel-height ratio d:2d ~ 2:1 (' + drawnRatio.toFixed(3) +
    ') — billboards scale inversely with distance');

  // Tie the drawn output to the locked formula: the drawn height tracks spriteDim
  // (a fixed silhouette fraction of the frame), so drawn/spriteDim is stable
  // across the two distances.
  const fracNear = extNear / pNear.spriteDim;
  const fracFar = extFar / pFar.spriteDim;
  assert(Math.abs(fracNear - fracFar) < 0.05,
    '3f. the drawn-height : spriteDim fraction is stable across d and 2d (' +
    fracNear.toFixed(3) + ' vs ' + fracFar.toFixed(3) + ') — output tracks the locked projection');
})();

// ===========================================================================
// 4. PROOF C — SQUARENESS / H-FOR-BOTH (ENT-01, 04-CONTEXT decision 3). At a
//    NON-square framebuffer (W=480, H=270) a scale-1 enemy directly ahead is
//    drawn with EQUAL horizontal and vertical scale (screen HEIGHT drives both).
//    Falsifiability control: if the projection used W for width, the horizontal
//    scale — and thus the drawn aspect ratio — would be off by W/H; assert the
//    ACTUAL drawn ratio matches the H-driven (square-scale) expectation and NOT
//    the W-driven one.
// ===========================================================================
(function () {
  const W = Framebuffer.width, H = Framebuffer.height;
  assert(W === 480 && H === 270 && W !== H,
    '4a. the framebuffer is a NON-square aspect (W=' + W + ', H=' + H + ') so W-vs-H is discriminable');

  Player.x = 2.5; Player.y = 4.5;
  Player.setDir(1, 0);
  const pose = poseOf();

  const enemy = { x: 6.5, y: 4.5, sprite: 'enemy', scale: 1.0, onFloor: true }; // d=4, unclamped
  const p = projectSprite(pose, enemy, W, H);

  // The frame projects fully on-screen (no clamp), so the drawn silhouette bbox
  // reflects the true horizontal/vertical scale.
  assert(p.drawStartX > 0 && p.drawEndX < W && p.drawStartY > 0 && p.drawEndY < H,
    '4b. the scale-1 enemy projects fully on-screen at d=4 (unclamped bbox), so scale is measurable');

  setEntities([enemy]);
  const r = renderBgAndSprites();
  const drawn = drawnBBox(r.bg, r.cur, W, H);
  const texBox = spriteTexelBBox(Sprites.map.enemy);

  // pixels-per-texel horizontally vs vertically. With H driving BOTH, these are
  // equal (the frame is spriteDim x spriteDim over a TEXW x TEXH source).
  const pxPerTexX = drawn.w / texBox.w;
  const pxPerTexY = drawn.h / texBox.h;
  const scaleRatio = pxPerTexX / pxPerTexY;
  assert(scaleRatio > 0.9 && scaleRatio < 1.1,
    '4c. ENT-01: horizontal and vertical pixels-per-texel are EQUAL (ratio ' + scaleRatio.toFixed(3) +
    ') — the billboard is square; H drives both dimensions');

  // W-vs-H falsifiability control: had width used W instead of H, pxPerTexX would
  // be scaled by W/H, so the scaleRatio would be ~W/H (1.78), not ~1. Assert the
  // ACTUAL ratio is far from the W-driven prediction.
  const wDistortRatio = W / H; // ~1.78
  assert(Math.abs(scaleRatio - wDistortRatio) > 0.3,
    '4d. CONTROL: the drawn scale ratio (' + scaleRatio.toFixed(3) + ') does NOT match the W-driven ' +
    'prediction (~' + wDistortRatio.toFixed(3) + ') — using W would distort width, but H is used');

  // Formula-level control mirroring the pixel proof: spriteDim uses H; the W-based
  // width would be a different integer.
  const wBasedDim = Math.abs(Math.floor(W / p.transformY)) * enemy.scale;
  assert(p.spriteDim !== wBasedDim && p.spriteDim === Math.abs(Math.floor(H / p.transformY)) * enemy.scale,
    '4e. projectSprite spriteDim uses H (' + p.spriteDim + '), not W (' + wBasedDim + ')');
})();

finish('ALL_SPRITE_CONTRACTS_PASS');
