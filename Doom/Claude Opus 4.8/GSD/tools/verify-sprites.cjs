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
  // the rendered pixel equals the DEPTH-SHADED source texel written there —
  // applyShade(rawTexel, shadeFactor(transformY, false)), tying the render to the
  // shared shade helpers with no ULP drift.
  const tex = Sprites.map.enemy;
  const TEXW = tex.width, TEXH = tex.height, tbuf = tex.buf32;
  const zbuf = Framebuffer.zBuffer; // wall depth for the front pose (just rendered)
  const frontShade = Raycaster.shadeFactor(pf.transformY, false);
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
      const shaded = Raycaster.applyShade(packed, frontShade) >>> 0;
      assert((r.cur[y * W + x] >>> 0) === shaded,
        '2j. a drawn front-sprite pixel === the depth-SHADED source texel ' +
        'applyShade(raw, shadeFactor(transformY,false)) at column ' + x + ', row ' + y);
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

// ---------------------------------------------------------------------------
// The full projection recompute (origins + bounds) used by the per-column
// clipping/shading proofs. Extends projectSprite's return with the fields those
// proofs index (originX/originY/drawStartY/drawEndY are already returned).
// ---------------------------------------------------------------------------

// The set of columns the sprite pass WOULD write given a zBuffer: a column is
// written iff (optionally) occlusion passes AND at least one of its texels is
// opaque (source alpha >= ALPHA_KEY). Recomputed from the renderer's exact texel
// mapping — NOT a call into Entities — so a shared bug cannot hide.
function predictedDrawnColumns(pose, e, zbuf, W, H, requireOcclusion) {
  const tex = Sprites.map[e.sprite];
  const TEXW = tex.width, TEXH = tex.height, tb = tex.buf32;
  const p = projectSprite(pose, e, W, H);
  const cols = new Set();
  for (let x = p.drawStartX; x < p.drawEndX; x++) {
    if (requireOcclusion && !(p.transformY > 0 && p.transformY < zbuf[x])) continue;
    let texX = Math.floor((x - p.originX) * TEXW / p.spriteDim);
    if (texX < 0) texX = 0; else if (texX > TEXW - 1) texX = TEXW - 1;
    let anyOpaque = false;
    for (let y = p.drawStartY; y < p.drawEndY; y++) {
      let texY = Math.floor((y - p.originY) * TEXH / p.spriteDim);
      if (texY < 0) texY = 0; else if (texY > TEXH - 1) texY = TEXH - 1;
      if (((tb[texY * TEXW + texX] >>> 24) & 0xff) >= Sprites.ALPHA_KEY) { anyOpaque = true; break; }
    }
    if (anyOpaque) cols.add(x);
  }
  return cols;
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

// Mean RGB brightness read at EXACTLY the pixels the sprite pass writes (occlusion
// passes AND source alpha >= ALPHA_KEY), sampled from `cur`. Independent of the
// background-diff, so a shaded-equals-bg coincidence cannot bias it (harness note).
function meanShadedBrightness(pose, e, zbuf, cur, W, H) {
  const tex = Sprites.map[e.sprite];
  const TEXW = tex.width, TEXH = tex.height, tb = tex.buf32;
  const p = projectSprite(pose, e, W, H);
  let sum = 0, cnt = 0;
  for (let x = p.drawStartX; x < p.drawEndX; x++) {
    if (!(p.transformY > 0 && p.transformY < zbuf[x])) continue;
    let texX = Math.floor((x - p.originX) * TEXW / p.spriteDim);
    if (texX < 0) texX = 0; else if (texX > TEXW - 1) texX = TEXW - 1;
    for (let y = p.drawStartY; y < p.drawEndY; y++) {
      let texY = Math.floor((y - p.originY) * TEXH / p.spriteDim);
      if (texY < 0) texY = 0; else if (texY > TEXH - 1) texY = TEXH - 1;
      if (((tb[texY * TEXW + texX] >>> 24) & 0xff) < Sprites.ALPHA_KEY) continue;
      const c = cur[y * W + x] >>> 0;
      sum += (c & 0xff) + ((c >> 8) & 0xff) + ((c >> 16) & 0xff);
      cnt++;
    }
  }
  return { mean: cnt ? sum / cnt : 0, cnt };
}

// ===========================================================================
// 5. PROOF D — PARTIAL-WALL PER-COLUMN CLIPPING (ENT-02, 04-CONTEXT decision 7a).
//    A SINGLE billboard whose projected column span STRADDLES a wall edge: the
//    isolated pillar at cell (6,6) sits between the player at (3.5,8.5) [facing
//    up-right, setDir(1,-1)] and an enemy at (8.5,3.5). Some columns of the ONE
//    sprite are nearer than the wall depth (drawn) and some are behind it
//    (occluded) — a finer test than 04-01's whole-sprite cut. The drawn columns
//    must EXACTLY equal the columns the renderer would write (occlusion passes AND
//    the column has an opaque texel); occluded columns draw nothing. The
//    falsifiability control forces zBuffer to +inf (no wall) and shows the SAME
//    entity then draws ALL its in-bounds opaque columns.
// ===========================================================================
(function () {
  const W = Framebuffer.width, H = Framebuffer.height;

  assert(Level.isSolid(6, 6),
    '5a. precondition: an isolated pillar occupies cell (6,6)');

  Player.x = 3.5; Player.y = 8.5;
  Player.setDir(1, -1);
  const pose = poseOf();

  const e = { x: 8.5, y: 3.5, sprite: 'enemy', scale: 1.0, onFloor: true };
  const p = projectSprite(pose, e, W, H);
  assert(p.onScreen && p.spriteDim > 0 && p.drawEndX > p.drawStartX,
    '5b. the straddling enemy projects on-screen with positive width (spriteDim ' + p.spriteDim + ')');

  // Snapshot the wall zBuffer for this pose (the exact buffer the sprite pass reads).
  Raycaster.spritePass = null;
  Raycaster.render();
  const zbuf = Framebuffer.zBuffer.slice();

  // Partition the projected columns into predicted-visible vs predicted-occluded.
  const occludedCols = new Set(), visibleCols = new Set();
  for (let x = p.drawStartX; x < p.drawEndX; x++) {
    if (p.transformY < zbuf[x]) visibleCols.add(x); else occludedCols.add(x);
  }
  assert(visibleCols.size > 0 && occludedCols.size > 0,
    '5c. the ONE billboard straddles a wall edge: ' + visibleCols.size + ' visible + ' +
    occludedCols.size + ' occluded columns (per-column clip, not whole-sprite)');

  // The renderer would write only the visible columns that also carry an opaque
  // texel; occluded columns must write nothing.
  const predictedDrawn = predictedDrawnColumns(pose, e, zbuf, W, H, true);
  assert(predictedDrawn.size > 0,
    '5d. some visible columns carry opaque texels (predicted-drawn is non-empty)');

  // Render for real and compare the actual drawn columns to the prediction.
  setEntities([e]);
  const r = renderBgAndSprites();
  const actualDrawn = drawnColumns(r.bg, r.cur, W, H);
  assert(setsEqual(actualDrawn, predictedDrawn),
    '5e. ENT-02: drawn columns EXACTLY equal the predicted per-column-visible+opaque set (' +
    actualDrawn.size + ' drawn)');

  // Every occluded column drew zero sprite pixels.
  let occludedAllZero = true, sampleBad = -1;
  for (const x of occludedCols) {
    for (let y = p.drawStartY; y < p.drawEndY; y++) {
      if (r.cur[y * W + x] !== r.bg[y * W + x]) { occludedAllZero = false; sampleBad = x; break; }
    }
    if (!occludedAllZero) break;
  }
  assert(occludedAllZero,
    '5f. ENT-02: EVERY occluded column drew zero sprite pixels (partial wall clips per column)' +
    (occludedAllZero ? '' : ' — column ' + sampleBad + ' leaked'));

  // There is at least one occluded column that DOES carry an opaque texel, so the
  // clip is genuinely hiding sprite content (not just clipping empty margin).
  const wouldDrawNoOcc = predictedDrawnColumns(pose, e, zbuf, W, H, false);
  let occludedOpaqueExists = false;
  for (const x of wouldDrawNoOcc) if (occludedCols.has(x)) { occludedOpaqueExists = true; break; }
  assert(occludedOpaqueExists,
    '5g. at least one occluded column WOULD have drawn an opaque texel — the clip hides real content');

  // Falsifiability CONTROL: force zBuffer to +inf (no wall) and draw the SAME
  // entity directly; every in-bounds opaque column now draws (nothing occluded).
  Raycaster.spritePass = null;
  Raycaster.render();
  const bg2 = Framebuffer.buf32.slice();
  for (let i = 0; i < Framebuffer.zBuffer.length; i++) Framebuffer.zBuffer[i] = Infinity;
  setEntities([e]);
  Entities.render();                       // draw with no occlusion, onto bg2
  const ctrl = Framebuffer.buf32.slice();
  const ctrlDrawn = drawnColumns(bg2, ctrl, W, H);
  assert(setsEqual(ctrlDrawn, wouldDrawNoOcc),
    '5h. CONTROL: with zBuffer=+inf the SAME entity draws ALL its in-bounds opaque columns (' +
    ctrlDrawn.size + ') — the partial clip above was the wall, not the projection');
  assert(ctrlDrawn.size > actualDrawn.size,
    '5i. CONTROL: the no-wall render draws strictly MORE columns than the occluded render (' +
    ctrlDrawn.size + ' > ' + actualDrawn.size + ')');
})();

// ===========================================================================
// 6. PROOF E — DEPTH FOG SHADING (04-CONTEXT decision 6). The SAME enemy near
//    (d=4) and far (2d=8) on the open row 4 with clear LOS. (a) a sampled drawn
//    pixel equals applyShade(rawTexel, shadeFactor(transformY,false)) EXACTLY
//    (=== , tying the render to the shared shade helpers with no ULP drift); (b)
//    the far sprite's mean drawn brightness is strictly LESS than the near
//    sprite's (monotonic fog, same curve as walls). Falsifiability control: the
//    RAW (unshaded) far texel differs from the shaded drawn pixel — shading is
//    actually applied, not a no-op.
// ===========================================================================
(function () {
  const W = Framebuffer.width, H = Framebuffer.height;

  assert(Level.lineOfSight(2.5, 4.5, 6.5, 4.5) && Level.lineOfSight(2.5, 4.5, 10.5, 4.5),
    '6a. precondition: clear LOS to the near (d=4) and far (2d=8) enemy on the open row 4');

  Player.x = 2.5; Player.y = 4.5;
  Player.setDir(1, 0);
  const pose = poseOf();

  const near = { x: 6.5,  y: 4.5, sprite: 'enemy', scale: 1.0, onFloor: true };
  const far  = { x: 10.5, y: 4.5, sprite: 'enemy', scale: 1.0, onFloor: true };
  const pNear = projectSprite(pose, near, W, H);
  const pFar = projectSprite(pose, far, W, H);
  const shadeNear = Raycaster.shadeFactor(pNear.transformY, false);
  const shadeFar = Raycaster.shadeFactor(pFar.transformY, false);
  assert(shadeFar < shadeNear,
    '6b. shadeFactor(far) < shadeFactor(near) (' + shadeFar + ' < ' + shadeNear +
    ') — the shared fog curve darkens the farther sprite');

  const tex = Sprites.map.enemy;
  const TEXW = tex.width, TEXH = tex.height, tbuf = tex.buf32;

  // --- Exact per-pixel tie to the shared helpers, at the FAR distance ---------
  setEntities([far]);
  Raycaster.spritePass = null; Raycaster.render();
  const zFar = Framebuffer.zBuffer.slice();
  let rFar = renderBgAndSprites();
  let farProven = false, rawDiffered = false;
  for (let x = pFar.drawStartX; x < pFar.drawEndX && !farProven; x++) {
    if (!(pFar.transformY > 0 && pFar.transformY < zFar[x])) continue;
    let texX = Math.floor((x - pFar.originX) * TEXW / pFar.spriteDim);
    if (texX < 0) texX = 0; else if (texX > TEXW - 1) texX = TEXW - 1;
    for (let y = pFar.drawStartY; y < pFar.drawEndY; y++) {
      let texY = Math.floor((y - pFar.originY) * TEXH / pFar.spriteDim);
      if (texY < 0) texY = 0; else if (texY > TEXH - 1) texY = TEXH - 1;
      const raw = tbuf[texY * TEXW + texX] >>> 0;
      if (((raw >>> 24) & 0xff) < Sprites.ALPHA_KEY) continue;
      const shaded = Raycaster.applyShade(raw, shadeFar) >>> 0;
      assert((rFar.cur[y * W + x] >>> 0) === shaded,
        '6c. a drawn FAR sprite pixel === applyShade(raw, shadeFactor(transformY,false)) at (' + x + ',' + y + ')');
      rawDiffered = ((raw >>> 0) !== shaded); // shading actually changed the value
      farProven = true;
      break;
    }
  }
  assert(farProven, '6d. a far opaque, occlusion-passing texel was located and its shade verified');
  assert(rawDiffered,
    '6e. CONTROL: the RAW far texel differs from the shaded drawn pixel — fog shading is applied, not a no-op');
  const meanFar = meanShadedBrightness(pose, far, zFar, rFar.cur, W, H);

  // --- Near distance mean brightness -----------------------------------------
  setEntities([near]);
  Raycaster.spritePass = null; Raycaster.render();
  const zNear = Framebuffer.zBuffer.slice();
  const rNear = renderBgAndSprites();
  const meanNear = meanShadedBrightness(pose, near, zNear, rNear.cur, W, H);

  assert(meanNear.cnt > 0 && meanFar.cnt > 0,
    '6f. both near and far enemies drew shaded pixels (' + meanNear.cnt + ', ' + meanFar.cnt + ')');
  assert(meanFar.mean < meanNear.mean,
    '6g. MONOTONIC FOG: far mean drawn brightness < near mean (' + meanFar.mean.toFixed(1) +
    ' < ' + meanNear.mean.toFixed(1) + ') — distant sprites fog like the wall behind them');
})();

// The raw opaque source texel a sprite maps to a given screen pixel, or 0 if that
// pixel is outside the sprite's box or maps to a TRANSPARENT texel. Recomputed
// from the renderer's texel mapping (no call into Entities).
function opaqueTexelAt(pose, e, W, H, x, y) {
  const tex = Sprites.map[e.sprite];
  const TEXW = tex.width, TEXH = tex.height, tb = tex.buf32;
  const p = projectSprite(pose, e, W, H);
  if (x < p.drawStartX || x >= p.drawEndX || y < p.drawStartY || y >= p.drawEndY) return 0;
  let texX = Math.floor((x - p.originX) * TEXW / p.spriteDim);
  if (texX < 0) texX = 0; else if (texX > TEXW - 1) texX = TEXW - 1;
  let texY = Math.floor((y - p.originY) * TEXH / p.spriteDim);
  if (texY < 0) texY = 0; else if (texY > TEXH - 1) texY = TEXH - 1;
  const packed = tb[texY * TEXW + texX] >>> 0;
  return ((packed >>> 24) & 0xff) >= Sprites.ALPHA_KEY ? packed : 0;
}

// ===========================================================================
// 7. PROOF F — CLEAN TRANSPARENCY / NO HALO (ENT-03, 04-CONTEXT decisions 5+7d).
//    A single enemy fully in front of a wall (clear LOS, whole box unoccluded) so
//    the property under test is TRANSPARENCY, not occlusion. Characterise EVERY
//    in-box pixel WITHOUT relying on value inequality (harness note): an opaque
//    source texel => the destination equals applyShade(raw, shade) AND is opaque
//    (alpha 0xFF); a transparent source texel => the destination is byte-for-byte
//    the background (no fringe written). Non-vacuity control: the box provably
//    contains BOTH transparent and opaque texels, else the no-halo claim is empty.
// ===========================================================================
(function () {
  const W = Framebuffer.width, H = Framebuffer.height;

  assert(Level.lineOfSight(2.5, 4.5, 6.5, 4.5),
    '7a. precondition: clear LOS to the enemy so its whole box is visible (isolates transparency)');

  Player.x = 2.5; Player.y = 4.5;
  Player.setDir(1, 0);
  const pose = poseOf();
  const e = { x: 6.5, y: 4.5, sprite: 'enemy', scale: 1.0, onFloor: true };
  const p = projectSprite(pose, e, W, H);

  Raycaster.spritePass = null; Raycaster.render();
  const zbuf = Framebuffer.zBuffer.slice();

  // Whole box unoccluded by the wall — so any unchanged pixel is transparency, not
  // occlusion.
  let boxUnoccluded = true;
  for (let x = p.drawStartX; x < p.drawEndX; x++) if (!(p.transformY < zbuf[x])) boxUnoccluded = false;
  assert(boxUnoccluded,
    '7b. every column of the sprite box is nearer than the wall (box fully unoccluded)');

  const r = renderBgAndSprites();
  const shade = Raycaster.shadeFactor(p.transformY, false);

  // Characterise every in-box pixel by the SOURCE alpha (independent recompute).
  let opaqueCount = 0, transparentCount = 0;
  let writtenExact = true, writtenOpaque = true, transparentIntact = true;
  let badWritten = null, badIntact = null;
  for (let y = p.drawStartY; y < p.drawEndY; y++) {
    for (let x = p.drawStartX; x < p.drawEndX; x++) {
      const raw = opaqueTexelAt(pose, e, W, H, x, y);
      const cur = r.cur[y * W + x] >>> 0;
      if (raw !== 0) {
        opaqueCount++;
        const shaded = Raycaster.applyShade(raw, shade) >>> 0;
        if (cur !== shaded) { writtenExact = false; if (!badWritten) badWritten = [x, y]; }
        if (((cur >>> 24) & 0xff) !== 0xff) { writtenOpaque = false; }
      } else {
        transparentCount++;
        if (cur !== (r.bg[y * W + x] >>> 0)) { transparentIntact = false; if (!badIntact) badIntact = [x, y]; }
      }
    }
  }

  assert(opaqueCount > 0 && transparentCount > 0,
    '7c. CONTROL (non-vacuity): the box contains BOTH opaque (' + opaqueCount + ') and transparent (' +
    transparentCount + ') source texels — the no-halo proof is not vacuous');
  assert(writtenExact,
    '7d. ENT-03: every OPAQUE-source pixel === applyShade(raw, shade)' +
    (writtenExact ? '' : ' — mismatch at ' + JSON.stringify(badWritten)));
  assert(writtenOpaque,
    '7e. ENT-03: every written sprite pixel is fully opaque (alpha byte 0xFF)');
  assert(transparentIntact,
    '7f. ENT-03 NO HALO: every TRANSPARENT-source pixel left the background byte-for-byte intact' +
    (transparentIntact ? '' : ' — fringe written at ' + JSON.stringify(badIntact)));
})();

// ===========================================================================
// 8. PROOF G — BACK-TO-FRONT SORT OVERLAP (ENT-02, 04-CONTEXT decision 7c). Two
//    enemies on the SAME bearing (straight ahead on open row 4) at different
//    distances so their boxes overlap on screen (the far box is inside the near
//    box). Where BOTH would draw an opaque texel, the NEARER enemy's texel must
//    win. Falsifiability control: keep the positions but SWAP the list order — the
//    NEARER enemy still wins, proving layering follows the far->near distance sort
//    and not the draw sequence in the list. Also confirm Entities._order is sorted
//    by DESCENDING squared distance for the injected pair.
// ===========================================================================
(function () {
  const W = Framebuffer.width, H = Framebuffer.height;

  assert(Level.lineOfSight(2.5, 4.5, 6.5, 4.5) && Level.lineOfSight(2.5, 4.5, 10.5, 4.5),
    '8a. precondition: clear LOS to both the near (d=4) and far (2d=8) enemy (no wall between)');

  Player.x = 2.5; Player.y = 4.5;
  Player.setDir(1, 0);
  const pose = poseOf();
  const nearObj = { x: 6.5,  y: 4.5, sprite: 'enemy', scale: 1.0, onFloor: true };
  const farObj  = { x: 10.5, y: 4.5, sprite: 'enemy', scale: 1.0, onFloor: true };
  const pNear = projectSprite(pose, nearObj, W, H);
  const pFar = projectSprite(pose, farObj, W, H);
  const shadeNear = Raycaster.shadeFactor(pNear.transformY, false);

  Raycaster.spritePass = null; Raycaster.render();
  const zbuf = Framebuffer.zBuffer.slice();

  // Contest pixels: inside the (smaller) far box, BOTH enemies map to an opaque
  // texel, and the wall does not occlude the column. There the nearer must win.
  const contest = [];
  for (let y = pFar.drawStartY; y < pFar.drawEndY; y++) {
    for (let x = pFar.drawStartX; x < pFar.drawEndX; x++) {
      if (!(pNear.transformY < zbuf[x])) continue;
      const nRaw = opaqueTexelAt(pose, nearObj, W, H, x, y);
      const fRaw = opaqueTexelAt(pose, farObj, W, H, x, y);
      if (nRaw !== 0 && fRaw !== 0) contest.push([x, y, nRaw]);
    }
  }
  assert(contest.length > 0,
    '8b. the two boxes overlap with ' + contest.length + ' contested pixels (both enemies opaque there)');

  // Case A — list order [near, far]. The nearer must win despite being FIRST in
  // the list (naive list-order draw would put far on top; the sort prevents that).
  setEntities([nearObj, farObj]);
  let r = renderBgAndSprites();
  let nearWinsA = true, badA = null;
  for (const [x, y, nRaw] of contest) {
    const shaded = Raycaster.applyShade(nRaw, shadeNear) >>> 0;
    if ((r.cur[y * W + x] >>> 0) !== shaded) { nearWinsA = false; badA = [x, y]; break; }
  }
  assert(nearWinsA,
    '8c. ENT-02: at every contested pixel the NEARER enemy texel wins (list order [near,far])' +
    (nearWinsA ? '' : ' — lost at ' + JSON.stringify(badA)));

  // Entities._order must be sorted by DESCENDING dist2 (far first) for the pair.
  const ord = Entities._order, d2 = Entities._dist2;
  assert(d2[ord[0]] >= d2[ord[1]],
    '8d. Entities._order is far->near (dist2 desc): dist2[order0]=' + d2[ord[0]].toFixed(1) +
    ' >= dist2[order1]=' + d2[ord[1]].toFixed(1));
  assert(Entities.list[ord[0]] === farObj && Entities.list[ord[1]] === nearObj,
    '8e. the sort placed the FAR enemy first and the NEAR enemy last (drawn last = on top)');

  // Case B — CONTROL: SWAP the list order to [far, near], same positions. The
  // nearer must STILL win, proving distance (not list index) determines layering.
  setEntities([farObj, nearObj]);
  r = renderBgAndSprites();
  let nearWinsB = true, badB = null;
  for (const [x, y, nRaw] of contest) {
    const shaded = Raycaster.applyShade(nRaw, shadeNear) >>> 0;
    if ((r.cur[y * W + x] >>> 0) !== shaded) { nearWinsB = false; badB = [x, y]; break; }
  }
  assert(nearWinsB,
    '8f. CONTROL: with the list order SWAPPED to [far,near] the NEARER enemy STILL wins — ' +
    'layering follows the far->near sort, not list order' + (nearWinsB ? '' : ' — lost at ' + JSON.stringify(badB)));
})();

finish('ALL_SPRITE_CONTRACTS_PASS');
