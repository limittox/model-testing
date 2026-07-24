/*
 * tools/verify-render.cjs — the Phase 3 tracer END-TO-END render-contract harness.
 *
 * NODE-ONLY (never referenced by index.html). Built on tools/boot.cjs: it boots the
 * SHIPPED script list in the SHIPPED order into one vm context with a stubbed DOM,
 * fires the window load event (main.js has already pointed Game.view at the
 * Raycaster and started the loop), then asserts the tracer's render contracts
 * DIRECTLY on Framebuffer.buf32 / Framebuffer.zBuffer.
 *
 * This is NOT a per-layer unit test. It proves the ONE path the tracer wired —
 * Player pose -> Raycaster DDA -> buf32 + zBuffer, presented once by Game.render —
 * is correct end to end. Its two load-bearing checks are DELIBERATELY FALSIFIABLE:
 *
 *   - REND-01 (no fisheye): a flat, front-facing wall yields a CONSTANT
 *     perpendicular-distance band in zBuffer, while an independent EUCLIDEAN
 *     recompute over the SAME columns visibly VARIES. If both were constant the
 *     test would be vacuous; the Euclidean control proves it discriminates.
 *   - REND-06 (z-buffer): a SECOND, separately-written perpendicular-distance DDA
 *     (not a call into Raycaster) reproduces zBuffer[x] to 1e-6 for every column.
 *
 * Every pose anchors on Level.LANDMARKS BY NAME (wallFaceEast / openCell) — never a
 * searched or hardcoded coordinate (the Phase 2 harness idiom).
 *
 * Prints PASS/FAIL per assertion and the terminal token ALL_RENDER_CONTRACTS_PASS
 * only when every assertion passed.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { boot, assert, finish, GAME_DIR } = require('./boot.cjs');

// ---------------------------------------------------------------------------
// Boot the shipped game and run main.js's load handler. After this Game.view is
// the Raycaster, TopDown is disabled, and the loop is running with a resync frame
// pending and one frame callback queued — but NO frame has executed yet.
// ---------------------------------------------------------------------------
const h = boot({});
h.fireLoad();

const s = h.sandbox;
const CONFIG = s.CONFIG;
const Level = s.Level;
const Player = s.Player;
const TopDown = s.TopDown;
const Raycaster = s.Raycaster;
const Game = s.Game;
const Framebuffer = s.Framebuffer;
const Textures = s.Textures;
const raf = h.raf;

// ===========================================================================
// INDEPENDENT reference DDA — a SECOND, separately-written perpendicular-distance
// cast (NOT a call into Raycaster). A shared bug cannot hide because this copy is
// written from the formula, not shared with the renderer. Returns, per column:
// perp (perpendicular distance), eucl (Euclidean ray length to the hit point),
// side, and the hit cell (hx,hy).
// ===========================================================================
function referenceDDA(pose, W) {
  const EPS = 1e-4;
  const BIG = 1e30;
  const px = pose.px, py = pose.py;
  const dirX = pose.dirX, dirY = pose.dirY;
  const planeX = pose.planeX, planeY = pose.planeY;

  const perp = new Float64Array(W);
  const eucl = new Float64Array(W);
  const side = new Int8Array(W);
  const hx = new Int32Array(W);
  const hy = new Int32Array(W);

  for (let x = 0; x < W; x++) {
    const cameraX = 2 * x / W - 1;
    const rayDirX = dirX + planeX * cameraX;
    const rayDirY = dirY + planeY * cameraX;

    let mapX = Math.floor(px);
    let mapY = Math.floor(py);

    const deltaDistX = (rayDirX === 0) ? BIG : Math.abs(1 / rayDirX);
    const deltaDistY = (rayDirY === 0) ? BIG : Math.abs(1 / rayDirY);

    let stepX, stepY, sideDistX, sideDistY;
    if (rayDirX < 0) { stepX = -1; sideDistX = (px - mapX) * deltaDistX; }
    else { stepX = 1; sideDistX = (mapX + 1 - px) * deltaDistX; }
    if (rayDirY < 0) { stepY = -1; sideDistY = (py - mapY) * deltaDistY; }
    else { stepY = 1; sideDistY = (mapY + 1 - py) * deltaDistY; }

    let sd = 0;
    let guard = Level.WIDTH + Level.HEIGHT + 2;
    while (guard-- > 0) {
      if (sideDistX < sideDistY) { sideDistX += deltaDistX; mapX += stepX; sd = 0; }
      else { sideDistY += deltaDistY; mapY += stepY; sd = 1; }
      if (Level.isSolid(mapX, mapY)) break;
    }

    let pw = (sd === 0) ? (sideDistX - deltaDistX) : (sideDistY - deltaDistY);
    if (!(pw > EPS)) pw = EPS;

    perp[x] = pw;
    // Euclidean length to the hit point: hit = pos + pw*rayDir, so the ray-length
    // is pw * |rayDir|. |rayDir| = 1 only at the centre column (rayDir == dir);
    // it grows toward the edges — which is exactly the fisheye that perpendicular
    // distance removes.
    eucl[x] = pw * Math.sqrt(rayDirX * rayDirX + rayDirY * rayDirY);
    side[x] = sd;
    hx[x] = mapX;
    hy[x] = mapY;
  }
  return { perp, eucl, side, hx, hy };
}

function poseOf() {
  return {
    px: Player.x, py: Player.y,
    dirX: Player.dirX, dirY: Player.dirY,
    planeX: Player.planeX, planeY: Player.planeY
  };
}

// ===========================================================================
// INDEPENDENT wall-texel recompute (REND-02). A SECOND, from-the-formula copy of
// the renderer's per-column texture math (NOT a call into Raycaster), so a shared
// bug cannot hide. Reads the LIVE Player pose. For screen row `yRow` (which must
// lie in the wall span) it reproduces: side, perpWall, the side-flipped texX (and
// the UN-flipped texXnoflip as a discriminator), the texPos-accumulated texY, and
// the fully shaded expected pixel. Its texPos accumulation is iterative — byte-for-
// byte the renderer's — so `expected` can be compared with === (no ULP drift).
// ===========================================================================
function expectedWallPixel(W, H, x, yRow) {
  const EPS = 1e-4, BIG = 1e30;
  const horizon = H >> 1;
  const px = Player.x, py = Player.y;
  const dirX = Player.dirX, dirY = Player.dirY;
  const planeX = Player.planeX, planeY = Player.planeY;

  const cameraX = 2 * x / W - 1;
  const rayDirX = dirX + planeX * cameraX;
  const rayDirY = dirY + planeY * cameraX;

  let mapX = Math.floor(px), mapY = Math.floor(py);
  const deltaDistX = (rayDirX === 0) ? BIG : Math.abs(1 / rayDirX);
  const deltaDistY = (rayDirY === 0) ? BIG : Math.abs(1 / rayDirY);

  let stepX, stepY, sideDistX, sideDistY;
  if (rayDirX < 0) { stepX = -1; sideDistX = (px - mapX) * deltaDistX; }
  else { stepX = 1; sideDistX = (mapX + 1 - px) * deltaDistX; }
  if (rayDirY < 0) { stepY = -1; sideDistY = (py - mapY) * deltaDistY; }
  else { stepY = 1; sideDistY = (mapY + 1 - py) * deltaDistY; }

  let side = 0, guard = Level.WIDTH + Level.HEIGHT + 2;
  while (guard-- > 0) {
    if (sideDistX < sideDistY) { sideDistX += deltaDistX; mapX += stepX; side = 0; }
    else { sideDistY += deltaDistY; mapY += stepY; side = 1; }
    if (Level.isSolid(mapX, mapY)) break;
  }

  let perpWall = (side === 0) ? (sideDistX - deltaDistX) : (sideDistY - deltaDistY);
  if (!(perpWall > EPS)) perpWall = EPS;

  const lineHeight = Math.floor(H / perpWall);
  const drawStart = -(lineHeight >> 1) + horizon;
  const drawEnd = (lineHeight >> 1) + horizon;
  const clampedStart = drawStart < 0 ? 0 : drawStart;
  const clampedEnd = drawEnd > H ? H : drawEnd;

  const id = Level.cellAt(mapX, mapY);
  let tex = Level.textureFor(id);
  if (!tex) tex = Textures.map.stone;
  const TEX = tex.width, MASK = TEX - 1;

  let wallX = (side === 0) ? (py + perpWall * rayDirY) : (px + perpWall * rayDirX);
  wallX -= Math.floor(wallX);
  let texX = Math.floor(wallX * TEX);
  const texXnoflip = texX & MASK;
  if (side === 0 && rayDirX > 0) texX = TEX - texX - 1;
  if (side === 1 && rayDirY < 0) texX = TEX - texX - 1;
  texX &= MASK;

  const step = TEX / lineHeight;
  let texPos = (drawStart - horizon + (lineHeight >> 1)) * step;
  if (clampedStart > drawStart) texPos += (clampedStart - drawStart) * step;

  let texY = (texPos | 0) & MASK;
  for (let y = clampedStart; y < clampedEnd && y < yRow; y++) {
    texPos += step;
    texY = (texPos | 0) & MASK;
  }

  const shade = Raycaster.shadeFactor(perpWall, side === 1);
  const texel = tex.buf32[(texY << 6) + texX];
  return {
    side, perpWall, id, tex, TEX, MASK,
    texX, texXnoflip, texY, lineHeight, clampedStart, clampedEnd,
    shade, expected: (Raycaster.applyShade(texel, shade) >>> 0)
  };
}

// ===========================================================================
// INDEPENDENT floor/ceiling recompute (REND-03). A SECOND, from-the-formula copy
// of Pass A's row-cast math (NOT a call into Raycaster). It accumulates floorX/
// floorY ITERATIVELY per column — byte-for-byte the renderer's addition order — so
// `floorExpected`/`ceilExpected` compare with === (no ULP drift). Reads the LIVE
// Player pose. For loop-row `loopY` (a FLOOR screen row in [horizon, H)) it returns
// the floor pixel produced at screen row `loopY` and the mirrored ceiling pixel at
// screen row H-1-loopY, plus the shared per-row shade/distance.
// ===========================================================================
function expectedFloorRow(W, H, x, loopY) {
  const horizon = H >> 1;
  const px = Player.x, py = Player.y;
  const dirX = Player.dirX, dirY = Player.dirY;
  const planeX = Player.planeX, planeY = Player.planeY;
  const rayDirX0 = dirX - planeX, rayDirY0 = dirY - planeY;
  const rayDirX1 = dirX + planeX, rayDirY1 = dirY + planeY;
  const posZ = CONFIG.CAMERA_Z * H;
  const TEX = CONFIG.TEX_SIZE, MASK = TEX - 1;

  let p = loopY - horizon;
  if (p < 1) p = 1;                       // horizon row clamp, mirrors the renderer
  const rowDistance = posZ / p;
  const floorStepX = rowDistance * (rayDirX1 - rayDirX0) / W;
  const floorStepY = rowDistance * (rayDirY1 - rayDirY0) / W;
  let floorX = px + rowDistance * rayDirX0;
  let floorY = py + rowDistance * rayDirY0;
  for (let i = 0; i < x; i++) { floorX += floorStepX; floorY += floorStepY; }  // iterative → byte-exact
  const tx = ((floorX * TEX) | 0) & MASK;
  const ty = ((floorY * TEX) | 0) & MASK;
  const ti = (ty << 6) + tx;
  const rowShade = Raycaster.shadeFactor(rowDistance, false);
  return {
    rowDistance, rowShade,
    floorScreenY: loopY,
    ceilScreenY: H - 1 - loopY,
    floorExpected: (Raycaster.applyShade(Textures.map.floor.buf32[ti], rowShade) >>> 0),
    ceilExpected: (Raycaster.applyShade(Textures.map.ceiling.buf32[ti], rowShade) >>> 0)
  };
}

// ===========================================================================
// 0. BOOT WIRED THE VIEW SWAP.
// ===========================================================================
(function () {
  assert(Game.view === Raycaster, '0a. Game.view is the Raycaster global');
  assert(TopDown.ENABLED === false, '0b. TopDown.ENABLED is false (disabled but still loaded)');
  assert(typeof TopDown.render === 'function', '0c. TopDown is still loaded (debug toggle, not deleted)');
  assert(Game.running === true, '0d. the loop is running after start');
})();

// ===========================================================================
// 1. REND-01 — NO FISHEYE, FALSIFIABLE. Player at the NAMED east wall face,
//    facing +x straight at the axis-aligned plane at x = wallFaceEast.wf. Over the
//    band of columns that hit that plane on an x-step (side==0, hit cell (wf,my)),
//    the PERPENDICULAR band is constant; the EUCLIDEAN band visibly varies.
// ===========================================================================
(function () {
  const L = Level.LANDMARKS.wallFaceEast;
  Player.x = L.x; Player.y = L.y;
  Player.setDir(1, 0);
  Raycaster.render();

  const W = Framebuffer.width;
  const ref = referenceDDA(poseOf(), W);

  // The band: columns whose ray hit the wf plane on an x-step, in the player's row.
  const band = [];
  for (let x = 0; x < W; x++) {
    if (ref.side[x] === 0 && ref.hx[x] === L.wf && ref.hy[x] === L.my) band.push(x);
  }
  assert(band.length >= 8, '1a. a band of >=8 columns hits the named east wall face on an x-step (' + band.length + ')');

  let perpMin = Infinity, perpMax = -Infinity;
  let euclMin = Infinity, euclMax = -Infinity;
  for (const x of band) {
    const p = Framebuffer.zBuffer[x];
    if (p < perpMin) perpMin = p;
    if (p > perpMax) perpMax = p;
    const e = ref.eucl[x];
    if (e < euclMin) euclMin = e;
    if (e > euclMax) euclMax = e;
  }
  const perpSpread = perpMax - perpMin;
  const euclSpread = euclMax - euclMin;
  assert(perpSpread < 1e-3,
    '1b. REND-01: perpendicular zBuffer band is CONSTANT across the flat wall (spread ' +
    perpSpread.toExponential(2) + ' < 1e-3)');
  assert(euclSpread > 1e-2,
    '1c. FALSIFIABILITY CONTROL: the Euclidean recompute over the SAME band VARIES (spread ' +
    euclSpread.toExponential(2) + ' > 1e-2) — the test discriminates, not vacuous');
})();

// ===========================================================================
// 2. REND-06 — Z-BUFFER CORRECTNESS. The independent DDA reproduces zBuffer[x] for
//    EVERY column to 1e-6, and every zBuffer[x] is finite and strictly > 0.
// ===========================================================================
(function () {
  const o = Level.LANDMARKS.openCell;
  Player.x = o.x; Player.y = o.y;
  Player.setDir(1, 0);
  Raycaster.render();

  const W = Framebuffer.width;
  const ref = referenceDDA(poseOf(), W);

  let maxErr = 0, allFinitePos = true, wrote = 0;
  for (let x = 0; x < W; x++) {
    const z = Framebuffer.zBuffer[x];
    if (!(isFinite(z) && z > 0)) allFinitePos = false;
    const err = Math.abs(z - ref.perp[x]);
    if (err > maxErr) maxErr = err;
    if (z !== 0) wrote++;
  }
  assert(wrote === W, '2a. REND-06: zBuffer is written for every one of the ' + W + ' columns (' + wrote + ')');
  assert(maxErr < 1e-6,
    '2b. REND-06: zBuffer matches the independent perpendicular DDA to 1e-6 (max err ' +
    maxErr.toExponential(2) + ')');
  assert(allFinitePos, '2c. REND-06: every zBuffer[x] is finite and strictly > 0 (no 0/negative/NaN/Infinity)');
})();

// ===========================================================================
// 3. WHOLE-FRAME COVERAGE (harness hardening W1) — PRE-SEED buf32 with a DISTINCT
//    sentinel the renderer never writes, render, then assert NO pixel still equals
//    it. A fresh/stale buffer is 0x00000000, not the sentinel, so a naive "no clear
//    colour" check could pass over a real gap; a distinct sentinel makes the
//    coverage check genuinely falsifiable. This tracer fills the WHOLE frame in
//    Pass A (ceiling/floor) before Pass B overwrites wall spans, so full-frame
//    coverage holds now; 03-03 keeps the invariant when it refines Pass A.
// ===========================================================================
(function () {
  const SENTINEL = 0x12345678 >>> 0; // a value neither CEIL/FLOOR nor any wall colour
  const o = Level.LANDMARKS.openCell;
  Player.x = o.x; Player.y = o.y;
  Player.setDir(1, 0);

  Framebuffer.buf32.fill(SENTINEL);
  Raycaster.render();

  const buf = Framebuffer.buf32;
  let leftover = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === SENTINEL) leftover++;
  assert(leftover === 0,
    '3a. W1: every pixel is written each frame — no seeded sentinel survives (' + leftover + ' left)');

  // Every written pixel is fully OPAQUE (alpha high byte 0xFF). This catches the
  // Pitfall-6 alpha-drop bug in the y-side depth cue: a bare (color>>1)&0x7F7F7F
  // would zero the alpha byte and leave transparent wall columns.
  let opaque = true;
  for (let i = 0; i < buf.length; i++) { if ((buf[i] >>> 24) !== 0xFF) { opaque = false; break; } }
  assert(opaque, '3b. every framebuffer pixel is fully opaque (alpha 0xFF) — no dropped-alpha wall columns');
})();

// ===========================================================================
// 4. CONTRACT — the view WRITES but does NOT present; Game.render presents once.
// ===========================================================================
(function () {
  const put0 = h.putCount();
  Raycaster.render();
  assert(h.putCount() === put0, '4a. a direct Raycaster.render() does NOT present (putImageData count unchanged)');

  const put1 = h.putCount();
  raf.step(16);
  assert(h.putCount() === put1 + 1, '4b. one raf.step() presents exactly once (Game.render owns the single putImageData)');
})();

// ===========================================================================
// 5. DETERMINISM — two consecutive renders with an unchanged pose are byte-identical
//    (no per-frame RNG, no allocation-driven nondeterminism).
// ===========================================================================
(function () {
  const o = Level.LANDMARKS.openCell;
  Player.x = o.x; Player.y = o.y;
  Player.setDir(1, 0);

  Raycaster.render();
  const snap = Framebuffer.buf32.slice(); // copy
  Raycaster.render();

  let identical = snap.length === Framebuffer.buf32.length;
  if (identical) {
    for (let i = 0; i < snap.length; i++) { if (snap[i] !== Framebuffer.buf32[i]) { identical = false; break; } }
  }
  assert(identical, '5. two consecutive Raycaster.render() calls with an unchanged pose are byte-identical');
})();

// ===========================================================================
// 6. AXIS-ALIGNED ROBUSTNESS — facing exactly +x and exactly +y (rayDir component
//    == 0) produces NO NaN in zBuffer and a fully-written, all-opaque buf32 (the
//    1e30 divide-by-zero sentinel holds).
// ===========================================================================
(function () {
  const o = Level.LANDMARKS.openCell;
  Player.x = o.x; Player.y = o.y;

  function renderAndCheck(dx, dy, label) {
    Player.setDir(dx, dy);
    Framebuffer.buf32.fill(0); // so an unwritten column shows as a 0 (non-opaque) pixel
    Raycaster.render();

    const z = Framebuffer.zBuffer;
    let zOk = true;
    for (let x = 0; x < z.length; x++) if (!(isFinite(z[x]) && z[x] > 0)) zOk = false;

    const buf = Framebuffer.buf32;
    let opaque = true;
    for (let i = 0; i < buf.length; i++) { if ((buf[i] >>> 24) !== 0xFF) { opaque = false; break; } }

    assert(zOk, '6' + label + '1. setDir(' + dx + ',' + dy + '): zBuffer finite and > 0 (no NaN — axis-ray sentinel holds)');
    assert(opaque, '6' + label + '2. setDir(' + dx + ',' + dy + '): buf32 fully written and opaque (no NaN pixel)');
  }
  renderAndCheck(1, 0, 'a');
  renderAndCheck(0, 1, 'b');
})();

// ===========================================================================
// 7. TWO ASPECT RATIOS (harness hardening W2) — boot fresh sandboxes at distinct
//    viewport aspects, INCLUDING one that derives an ODD internal height (horizon =
//    H>>1 must still behave), render, and assert each completes with height in
//    [MIN_H, MAX_H], a finite/positive zBuffer, and no out-of-range write.
// ===========================================================================
(function () {
  // 1000x419 derives H = round(480*419/1000) = 201 (ODD) so horizon = 100 exercises
  // the H>>1 truncation; 1280x720 -> 270 (even); 900x900 -> 480 (clamp boundary).
  const cases = [
    { w: 1000, h: 419, label: '7a (1000x419, odd H)' },
    { w: 1280, h: 720, label: '7b (1280x720)' },
    { w: 900, h: 900, label: '7c (900x900)' }
  ];
  for (const c of cases) {
    const hb = boot({ innerWidth: c.w, innerHeight: c.h });
    hb.fireLoad();
    const sb = hb.sandbox;
    const FB = sb.Framebuffer;
    const RC = sb.Raycaster;
    const LV = sb.Level;

    // Anchor on the fresh sandbox's own landmark, then render.
    const o = LV.LANDMARKS.openCell;
    sb.Player.x = o.x; sb.Player.y = o.y;
    sb.Player.setDir(1, 0);

    let threw = false;
    try { RC.render(); } catch (e) { threw = true; }

    const H = FB.height;
    const W = FB.width;
    const heightOk = H >= sb.CONFIG.MIN_H && H <= sb.CONFIG.MAX_H;

    // No out-of-range write: the buf32 length is exactly W*H (every index the wall
    // pass can produce, y*W+x with y<H and x<W, is in range) and zBuffer length W.
    const sizeOk = FB.buf32.length === W * H && FB.zBuffer.length === W;

    let zOk = true;
    for (let x = 0; x < FB.zBuffer.length; x++) if (!(isFinite(FB.zBuffer[x]) && FB.zBuffer[x] > 0)) zOk = false;

    assert(!threw && heightOk && sizeOk && zOk,
      c.label + ': renders with H=' + H + ' in [' + sb.CONFIG.MIN_H + ',' + sb.CONFIG.MAX_H +
      '], buf32.length==W*H, finite/positive zBuffer, no out-of-range write');
  }
})();

// ===========================================================================
// 8. SELF-CONTAINMENT — the new renderer source introduces no ES-module or network
//    construct, so the file:// + zero-dependency contract survives the add.
// ===========================================================================
(function () {
  const src = fs.readFileSync(path.join(GAME_DIR, 'js/raycaster.js'), 'utf8');
  const forbidden = [
    [/\bimport\s+[\w{*]/, 'ES import'],
    [/\bexport\s+(default|const|function|var|let|class|\{)/, 'ES export'],
    [/\brequire\s*\(/, 'CommonJS require'],
    [/\bmodule\.exports\b/, 'module.exports'],
    [/\bfetch\s*\(/, 'fetch'],
    [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
    [/\bimportScripts\s*\(/, 'importScripts'],
    [/\bnew\s+Image\b/, 'Image (external asset load)'],
    [/\beval\s*\(/, 'eval']
  ];
  const hits = [];
  for (const [re, name] of forbidden) if (re.test(src)) hits.push(name);
  assert(hits.length === 0,
    '8. js/raycaster.js contains no ES-module/network construct (self-contained)' +
    (hits.length ? ' [' + hits.join(', ') + ']' : ''));

  // index.html still references NOTHING under tools/ (the harness is never loaded).
  assert(!h.resourceRefs.some((r) => r.indexOf('tools/') >= 0),
    '8b. index.html references nothing under tools/ — the harness is never browser-loaded');
})();

// ===========================================================================
// 9. REND-04 — DISTANCE SHADING + FOG + CONSTANT Y-SIDE DARKEN.
//    Part A asserts the exposed fixed-point helpers directly (boundary values,
//    monotonicity, the MIN_SHADE floor, the y-side darken, alpha preservation).
//    Part B drives the render path: the SAME wall face at two depths must get
//    brighter as it nears, and a rendered wall pixel must equal exactly
//    applyShade(base, shadeFactor(perpWall, side==1)).
// ===========================================================================
(function () {
  const shadeFactor = Raycaster.shadeFactor;
  const applyShade = Raycaster.applyShade;
  const FLOOR256 = (CONFIG.MIN_SHADE * 256) | 0;

  // --- Part A: the helpers in isolation ------------------------------------
  assert(shadeFactor(0, false) === 256,
    '9a. REND-04: shadeFactor(0,false) === 256 (full brightness at the camera)');

  assert(shadeFactor(CONFIG.FOG_FAR, false) === FLOOR256,
    '9b. REND-04: shadeFactor(FOG_FAR,false) reaches the MIN_SHADE floor ((MIN_SHADE*256)|0 = ' +
    FLOOR256 + ')');

  assert(shadeFactor(CONFIG.FOG_FAR * 4, false) === FLOOR256,
    '9c. REND-04: shadeFactor never drops below the floor past FOG_FAR (clamped at ' +
    FLOOR256 + ')');

  // Monotonic non-increasing brightness with distance (no fog banding reversal).
  let mono = true, prev = 257;
  for (let d = 0; d <= CONFIG.FOG_FAR * 1.5; d += 0.25) {
    const v = shadeFactor(d, false);
    if (v > prev) { mono = false; break; }
    prev = v;
  }
  assert(mono, '9d. REND-04: shadeFactor is monotonically non-increasing with distance');

  // Y-side darker than X-side at equal distance, and EXACTLY the pre-side value
  // scaled by SIDE_SHADE (the fixed-point relationship, no clamp biting at dmid).
  const dmid = CONFIG.FOG_FAR * 0.4;
  const expectYSide = (((1 - dmid / CONFIG.FOG_FAR) * CONFIG.SIDE_SHADE) * 256) | 0;
  assert(shadeFactor(dmid, true) < shadeFactor(dmid, false),
    '9e. REND-04: a y-side column is darker than an x-side column at equal distance');
  assert(shadeFactor(dmid, true) === expectYSide,
    '9f. REND-04: shadeFactor(d,true) === pre-side value * SIDE_SHADE in fixed point (' +
    expectYSide + ')');

  // applyShade(_, 256) preserves rgb and forces opaque alpha; no R/B swap.
  const probe = s.packRGBA(200, 100, 50);
  const expectId = (0xFF000000 | (50 << 16) | (100 << 8) | 200) >>> 0;
  assert(applyShade(probe, 256) === expectId,
    '9g. REND-04: applyShade(packed,256) preserves rgb in packRGBA layout (no R/B swap)');
  assert((applyShade(0x00000000, 256) >>> 24) === 0xFF,
    '9h. REND-04: applyShade forces the alpha byte opaque (0xFF) — no translucent pixels');

  // --- Part B: the render path (near-vs-far on the SAME wall face) ----------
  const L = Level.LANDMARKS.wallFaceEast;
  const W = Framebuffer.width;
  const H = Framebuffer.height;
  const horizon = H >> 1;
  const xc = W >> 1;                        // centre column: cameraX ~ 0, ray ~ dir

  // Near: standing half a cell off the east wall face, looking straight at it.
  Player.x = L.x; Player.y = L.y;
  Player.setDir(1, 0);
  Raycaster.render();
  const zNear = Framebuffer.zBuffer[xc];
  const pxNear = Framebuffer.buf32[horizon * W + xc];
  const nearLum = (pxNear & 0xFF) + ((pxNear >> 8) & 0xFF) + ((pxNear >> 16) & 0xFF);

  // Exact-pixel check: the centre column hits the east wall face on an x-step
  // (side 0). The rendered pixel must equal the independently-recomputed shaded
  // texel exactly — tying the render path to shadeFactor/applyShade + the texture.
  const smpNear = expectedWallPixel(W, H, xc, horizon);
  assert(pxNear === smpNear.expected,
    '9i. REND-04: a rendered wall pixel === applyShade(texel, shadeFactor(perpWall, side==1)) exactly');

  // Far: step back one whole cell along -x (still open floor west of the face);
  // the same face is now farther, so the same column must be dimmer.
  Player.x = L.x - 1; Player.y = L.y;
  Player.setDir(1, 0);
  Raycaster.render();
  const zFar = Framebuffer.zBuffer[xc];
  const pxFar = Framebuffer.buf32[horizon * W + xc];
  const farLum = (pxFar & 0xFF) + ((pxFar >> 8) & 0xFF) + ((pxFar >> 16) & 0xFF);

  assert(zFar > zNear,
    '9j. REND-04: stepping back increases the perpendicular distance to the same face (' +
    zNear.toFixed(3) + ' -> ' + zFar.toFixed(3) + ')');
  assert(nearLum > farLum,
    '9k. REND-04: the SAME wall face is brighter up close than far away (near ' +
    nearLum + ' > far ' + farLum + ') — distance fog is applied');
})();

// ===========================================================================
// 10. REND-02 — TEXTURE-COLUMN SAMPLING with side flips + seam masking, proven
//     against the ASYMMETRIC exit texture (makeExit's right-pointing arrow — the
//     strongest discriminator for a dropped texX flip). The wall face is found by
//     a deterministic row-major first-match scan (a floor cell whose +x neighbour
//     is an exit wall, id 5), mirroring Level's own landmark-derivation idiom
//     rather than a hardcoded coordinate.
// ===========================================================================
(function () {
  let ex = null;
  for (let my = 0; my < Level.HEIGHT && !ex; my++) {
    for (let mx = 0; mx < Level.WIDTH; mx++) {
      if (Level.cellAt(mx, my) === 0 && Level.cellAt(mx + 1, my) === 5) {
        ex = { mx: mx, my: my, wf: mx + 1 };
        break;
      }
    }
  }
  assert(ex !== null,
    '10a. REND-02: a floor cell facing an exit wall (id 5) exists by row-major scan');

  // Stand at that floor cell's centre, look straight +x at the exit face.
  Player.x = ex.mx + 0.5; Player.y = ex.my + 0.5;
  Player.setDir(1, 0);
  Raycaster.render();

  const W = Framebuffer.width, H = Framebuffer.height;
  const horizon = H >> 1, xc = W >> 1;

  const smp = expectedWallPixel(W, H, xc, horizon);
  assert(smp.id === 5,
    '10b. REND-02: the centre column hits the exit wall (id 5, asymmetric arrow)');
  assert(smp.texX >= 0 && smp.texX <= smp.MASK && smp.texY >= 0 && smp.texY <= smp.MASK,
    '10c. REND-02: texX/texY stay within [0,' + smp.MASK + '] (T-03-05 index-bounds)');

  const rendered = Framebuffer.buf32[horizon * W + xc] >>> 0;
  assert(rendered === smp.expected,
    '10d. REND-02: rendered exit pixel === applyShade(tex.buf32[(texY<<6)+texX], shade) with BOTH flips');

  // The side==0 && rayDirX>0 flip is active here: the flipped column differs from
  // the unflipped one, so a dropped flip would sample a different (mirrored) column.
  assert(smp.texX !== smp.texXnoflip,
    '10e. REND-02: the side-based texX flip changes the sampled column (' +
    smp.texXnoflip + ' -> ' + smp.texX + ') — a dropped flip mirrors the arrow');

  // Find a visible row where the FLIPPED vs UN-FLIPPED shaded texels genuinely
  // differ on the asymmetric arrow, and prove the renderer used the flipped one.
  const tb = smp.tex.buf32;
  let proven = false;
  for (let y = smp.clampedStart; y < smp.clampedEnd; y++) {
    const row = expectedWallPixel(W, H, xc, y);
    const flipShaded = Raycaster.applyShade(tb[(row.texY << 6) + row.texX], row.shade) >>> 0;
    const noflipShaded = Raycaster.applyShade(tb[(row.texY << 6) + row.texXnoflip], row.shade) >>> 0;
    if (flipShaded === noflipShaded) continue;   // this row can't discriminate
    const px = Framebuffer.buf32[y * W + xc] >>> 0;
    assert(px === flipShaded,
      '10f. REND-02: on an asymmetric-arrow row the rendered pixel matches the FLIPPED texel, ' +
      'not the mirrored one (y=' + y + ', texX ' + row.texX + ' vs noflip ' + row.texXnoflip + ')');
    proven = true;
    break;
  }
  assert(proven,
    '10g. REND-02: at least one visible row discriminates the flip on the exit arrow');

  // Tall-near-wall / unclamped-texPos guard: at this near face the wall overspills
  // the screen (drawStart < 0, so the span is clamped to the whole height). The
  // texPos referenced to the UNCLAMPED span (not clampedStart) is what keeps the
  // slice correct — assert the span is genuinely clamped so this case is exercised.
  assert(smp.clampedStart === 0 && smp.clampedEnd === H && smp.lineHeight > H,
    '10h. REND-02: the near exit wall overspills the screen (lineHeight ' + smp.lineHeight +
    ' > H ' + H + '), exercising the unclamped-texPos path');
})();

// ===========================================================================
// 11. REND-03 — ROW-BASED FLOOR/CEILING CAST (CONFIG.FLOOR_CAST true, the ship
//     path). Whole frame covered (horizon row included, no CLEAR/sentinel left); a
//     below-horizon non-wall pixel derives from Textures.map.floor and an above-
//     horizon pixel from Textures.map.ceiling (== applyShade(texel, rowShade)); and
//     rows darken monotonically toward the horizon.
// ===========================================================================
(function () {
  const W = Framebuffer.width, H = Framebuffer.height;
  const horizon = H >> 1;
  // A DISTINCT seeded sentinel is the falsifiable coverage probe (same rationale as
  // section 3): a real "no background left" test cannot use CLEAR_COLOR, because a
  // legitimately-shaded floor/ceiling/wall texel can coincidentally equal it — the
  // sentinel is a value the renderer never writes, so surviving it means a true gap.
  const SENTINEL = 0x0BADF00D >>> 0;

  // Stand in derived open space so some columns see a wall far enough that the top
  // and bottom screen rows are ceiling/floor rather than wall.
  const o = Level.LANDMARKS.openCell;
  Player.x = o.x; Player.y = o.y;
  Player.setDir(1, 0);

  assert(CONFIG.FLOOR_CAST === true,
    '11a. REND-03: FLOOR_CAST defaults to true (textured cast is the ship path)');

  Framebuffer.buf32.fill(SENTINEL);
  Raycaster.render();

  // Whole frame covered (horizon row included) — no seeded sentinel survives.
  let leftover = 0;
  for (let i = 0; i < Framebuffer.buf32.length; i++) {
    if ((Framebuffer.buf32[i] >>> 0) === SENTINEL) leftover++;
  }
  assert(leftover === 0,
    '11b. REND-03: the textured cast fills every pixel, horizon row included — no seeded sentinel survives (' + leftover + ')');

  // The farthest-wall column has the shortest stripe, so its span frees the top
  // (ceiling) and bottom (floor) rows for probing.
  let col = 0, maxZ = -Infinity;
  for (let x = 0; x < W; x++) { const z = Framebuffer.zBuffer[x]; if (z > maxZ) { maxZ = z; col = x; } }
  const wsp = expectedWallPixel(W, H, col, horizon);
  assert(wsp.clampedStart >= 1 && wsp.clampedEnd <= H - 1,
    '11d. REND-03: the farthest-wall column frees the top/bottom rows (span [' +
    wsp.clampedStart + ',' + wsp.clampedEnd + ') within (0,' + (H - 1) + '])');

  // loopY = H-1 => floor screen row H-1 and ceiling screen row 0, both non-wall.
  const fr = expectedFloorRow(W, H, col, H - 1);
  const floorPix = Framebuffer.buf32[fr.floorScreenY * W + col] >>> 0;
  const ceilPix = Framebuffer.buf32[fr.ceilScreenY * W + col] >>> 0;
  assert(floorPix === fr.floorExpected,
    '11e. REND-03: a below-horizon floor pixel === applyShade(Textures.map.floor texel, rowShade) exactly');
  assert(ceilPix === fr.ceilExpected,
    '11f. REND-03: an above-horizon ceiling pixel === applyShade(Textures.map.ceiling texel, rowShade) exactly');
  assert(Textures.map.floor.buf32 !== Textures.map.ceiling.buf32 && fr.floorExpected !== fr.ceilExpected,
    '11g. REND-03: floor and ceiling sample DISTINCT texture buffers (separable in the frame)');

  // Monotonic darkening toward the horizon: the per-row rowShade the renderer uses
  // (proven applied by 11e/11f) is non-increasing as the floor row nears the horizon.
  let mono = true, prev = 257;
  for (let ly = H - 1; ly >= horizon + 1; ly--) {
    const s = expectedFloorRow(W, H, 0, ly).rowShade;
    if (s > prev) { mono = false; break; }
    prev = s;
  }
  assert(mono, '11h. REND-03: rows darken monotonically toward the horizon in textured-cast mode');
})();

// ===========================================================================
// 12. REND-03 WHOLE-FRAME COVERAGE at ODD **and** EVEN internal height (harness
//     hardening W1/W2). The ceiling mirror must independently reach rows
//     [0, horizon-1] with NO row skipped when H is odd (horizon = H>>1 truncates).
//     Boot fresh sandboxes at both parities, seed a sentinel, render the textured
//     cast, and assert every row is written.
// ===========================================================================
(function () {
  const SENTINEL = 0x0BADF00D >>> 0;
  const cases = [
    { w: 1000, h: 419, oddExpected: true, label: '12a odd-H' },   // -> H = 201 (odd), horizon 100
    { w: 1280, h: 720, oddExpected: false, label: '12b even-H' }  // -> H = 270 (even), horizon 135
  ];
  for (const c of cases) {
    const hb = boot({ innerWidth: c.w, innerHeight: c.h });
    hb.fireLoad();
    const sb = hb.sandbox;
    const FB = sb.Framebuffer, RC = sb.Raycaster, LV = sb.Level;
    const H = FB.height;
    assert((H % 2 === 1) === c.oddExpected,
      c.label + '1: derived internal height parity is as expected (H=' + H + ')');

    const o = LV.LANDMARKS.openCell;
    sb.Player.x = o.x; sb.Player.y = o.y; sb.Player.setDir(1, 0);

    sb.CONFIG.FLOOR_CAST = true;
    FB.buf32.fill(SENTINEL);
    RC.render();
    let left = 0;
    for (let i = 0; i < FB.buf32.length; i++) if ((FB.buf32[i] >>> 0) === SENTINEL) left++;
    assert(left === 0,
      c.label + '2: the textured cast fills every row at H=' + H + ' (horizon ' + (H >> 1) +
      ') — no row skipped (' + left + ' left)');
  }
})();

// ===========================================================================
// 13. REND-03 — REAL DISTANCE-SHADED FLAT-COLOUR FALLBACK (CONFIG.FLOOR_CAST
//     false). Flip the flag, render, and assert: the whole frame is still covered;
//     a floor pixel === applyShade(CONFIG.FLOOR_COLOR, rowShade) and a ceiling pixel
//     === applyShade(CONFIG.CEIL_COLOR, rowShade) (shaded, NOT a raw flat slab); and
//     rows darken monotonically toward the horizon exactly as the textured path
//     does. Restores FLOOR_CAST = true so the flag does not leak into other checks.
// ===========================================================================
(function () {
  const W = Framebuffer.width, H = Framebuffer.height;
  const horizon = H >> 1;
  const SENTINEL = 0x0BADF00D >>> 0;

  const o = Level.LANDMARKS.openCell;
  Player.x = o.x; Player.y = o.y;
  Player.setDir(1, 0);

  // A column whose farthest-wall stripe frees the top/bottom rows (as in §11).
  Raycaster.render();                    // FLOOR_CAST still true here — populate zBuffer
  let col = 0, maxZ = -Infinity;
  for (let x = 0; x < W; x++) { const z = Framebuffer.zBuffer[x]; if (z > maxZ) { maxZ = z; col = x; } }
  const wsp = expectedWallPixel(W, H, col, horizon);
  assert(wsp.clampedStart >= 1 && wsp.clampedEnd <= H - 1,
    '13a. REND-03 fallback: the farthest-wall column frees the top/bottom rows (span [' +
    wsp.clampedStart + ',' + wsp.clampedEnd + '])');

  // Flip to the flat-colour fallback and render.
  CONFIG.FLOOR_CAST = false;
  Framebuffer.buf32.fill(SENTINEL);
  Raycaster.render();

  let leftover = 0;
  for (let i = 0; i < Framebuffer.buf32.length; i++) {
    if ((Framebuffer.buf32[i] >>> 0) === SENTINEL) leftover++;
  }
  assert(leftover === 0,
    '13b. REND-03 fallback: FLOOR_CAST=false still fills every pixel, horizon row included (' + leftover + ' left)');

  // Independently recompute the expected flat, distance-shaded colours for the
  // bottom floor row (loopY = H-1) and its ceiling mirror (screen row 0).
  let pF = (H - 1) - horizon; if (pF < 1) pF = 1;
  const rowDistFb = (CONFIG.CAMERA_Z * H) / pF;
  const rowShadeFb = Raycaster.shadeFactor(rowDistFb, false);
  const expFloorFlat = Raycaster.applyShade(CONFIG.FLOOR_COLOR >>> 0, rowShadeFb) >>> 0;
  const expCeilFlat = Raycaster.applyShade(CONFIG.CEIL_COLOR >>> 0, rowShadeFb) >>> 0;
  const flatFloorPix = Framebuffer.buf32[(H - 1) * W + col] >>> 0;
  const flatCeilPix = Framebuffer.buf32[0 * W + col] >>> 0;
  assert(flatFloorPix === expFloorFlat,
    '13c. REND-03 fallback: a floor pixel === applyShade(CONFIG.FLOOR_COLOR, rowShade) — shaded, not a raw slab');
  assert(flatCeilPix === expCeilFlat,
    '13d. REND-03 fallback: a ceiling pixel === applyShade(CONFIG.CEIL_COLOR, rowShade)');
  assert(expFloorFlat !== (CONFIG.FLOOR_COLOR >>> 0) && expCeilFlat !== (CONFIG.CEIL_COLOR >>> 0),
    '13e. REND-03 fallback: the shaded flat colours differ from the raw CONFIG colours (distance shading IS applied)');

  // Monotonic darkening toward the horizon in the fallback, same curve as the cast.
  let mono = true, prev = 257;
  for (let ly = H - 1; ly >= horizon + 1; ly--) {
    let pp = ly - horizon; if (pp < 1) pp = 1;
    const s = Raycaster.shadeFactor((CONFIG.CAMERA_Z * H) / pp, false);
    if (s > prev) { mono = false; break; }
    prev = s;
  }
  assert(mono, '13f. REND-03 fallback: rows darken monotonically toward the horizon in flat-colour mode');

  // Restore the ship default so the flag never leaks into any later assertion.
  CONFIG.FLOOR_CAST = true;
  assert(CONFIG.FLOOR_CAST === true,
    '13g. REND-03 fallback: CONFIG.FLOOR_CAST restored to true after the fallback probe (no leak)');
})();

// ===========================================================================
// 14. REND-03 FALLBACK WHOLE-FRAME COVERAGE at ODD **and** EVEN H (W1/W2). The
//     flat-colour path shares the cast's y-range/mirror, so it too must skip no row
//     at either parity. Boot fresh sandboxes, seed a sentinel, render with
//     FLOOR_CAST=false, and assert full coverage; restore the flag each time.
// ===========================================================================
(function () {
  const SENTINEL = 0x0BADF00D >>> 0;
  const cases = [
    { w: 1000, h: 419, oddExpected: true, label: '14a odd-H' },
    { w: 1280, h: 720, oddExpected: false, label: '14b even-H' }
  ];
  for (const c of cases) {
    const hb = boot({ innerWidth: c.w, innerHeight: c.h });
    hb.fireLoad();
    const sb = hb.sandbox;
    const FB = sb.Framebuffer, RC = sb.Raycaster, LV = sb.Level;
    const H = FB.height;
    assert((H % 2 === 1) === c.oddExpected,
      c.label + '1: derived internal height parity is as expected (H=' + H + ')');

    const o = LV.LANDMARKS.openCell;
    sb.Player.x = o.x; sb.Player.y = o.y; sb.Player.setDir(1, 0);

    sb.CONFIG.FLOOR_CAST = false;
    FB.buf32.fill(SENTINEL);
    RC.render();
    let left = 0;
    for (let i = 0; i < FB.buf32.length; i++) if ((FB.buf32[i] >>> 0) === SENTINEL) left++;
    sb.CONFIG.FLOOR_CAST = true;
    assert(left === 0,
      c.label + '2: the flat-colour fallback fills every row at H=' + H + ' (horizon ' + (H >> 1) +
      ') — no row skipped (' + left + ' left)');
  }
})();

finish('ALL_RENDER_CONTRACTS_PASS');
