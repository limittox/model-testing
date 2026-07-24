/*
 * raycaster.js — the first-person software raycaster (Phase 3).
 *
 * LOAD ORDER: loaded AFTER js/topdown.js (it reads the same globals TopDown does —
 * CONFIG, Framebuffer, Level, Player) and BEFORE js/game.js (Game.view points
 * here). It reads Framebuffer.width/height/buf32/zBuffer and writes into buf32 and
 * zBuffer; it is read by nothing before game.js.
 *
 * THE VIEW CONTRACT (identical to TopDown — locked by Game.render):
 *
 *   render() WRITES INTO Framebuffer.buf32 (and Framebuffer.zBuffer) AND DOES NOT
 *   PRESENT. Game.render() owns the single putImageData per frame, so present
 *   count == frame count on EVERY frame. Nothing is allocated per frame beyond
 *   loop scalars; the preallocated buf32/zBuffer are reused; pixels are never read
 *   back from the 2D context.
 *
 * THIS TRACER (03-01) is the thinnest end-to-end slice: it establishes the
 * THREE-PASS SKELETON but only fills two of the passes with real work —
 *
 *   PASS A — whole-frame two-tone fill (ceiling above the horizon, floor below).
 *            Every pixel is written so the horizon reads. 03-03 expands this into
 *            the row-based floor/ceiling cast + shaded flat-colour fallback; the
 *            skeleton (Pass A always fills first) does not change.
 *   PASS B — the per-column DDA wall cast: PERPENDICULAR wall distance (REND-01,
 *            kills fisheye), the per-column z-buffer write (REND-06), and (03-02)
 *            per-column TEXTURE SAMPLING (REND-02, side-flipped texX + unclamped
 *            texPos + power-of-two masking) shaded through the distance-fog +
 *            y-side-darken path (REND-04). The tracer's solid base colour is gone.
 *
 * The DDA mirrors Level.lineOfSight exactly: a 1e30 finite sentinel for a zero
 * rayDir component (0*Infinity would be NaN), and a WIDTH+HEIGHT+2 iteration cap so
 * a malformed/borderless map cannot spin the loop (threat T-03-01).
 */

var Raycaster = {
  // Perpendicular-distance floor: a hit at ~0 distance (or a NaN/negative from a
  // degenerate ray) must never poison the z-buffer or divide the line height by 0.
  EPS: 1e-4,
  // Axis-aligned ray sentinel — the LOS_BIG idiom. Large enough that a zero-
  // direction axis is never the smaller sideDist, finite enough that 0*BIG === 0.
  BIG: 1e30,

  // 03-02 Task 2 replaced the tracer's SOLID base-colour-per-id table with real
  // per-column texture sampling (Level.textureFor -> Textures.map 64x64 buf32).
  // The wall id now selects a texture, not a flat colour.
};

(function () {
  'use strict';

  // ===========================================================================
  // SHADING HELPERS (REND-04) — RESEARCH Pattern 5, CONTEXT decision 4.
  //
  // shadeFactor(dist, isYSide): a monotonic linear fog falloff (1 at the camera,
  // reaching the CONFIG.MIN_SHADE readability floor at CONFIG.FOG_FAR and never
  // dropping below it), with a constant y-side (side==1) darken. Returned as an
  // INTEGER fixed-point shade in [0, 256] so the inner loop is (channel * shade)
  // >> 8 — no float multiply per pixel. perpWall is CONSTANT for a whole wall
  // column, so this is computed ONCE per column, not per texel.
  //
  // applyShade(packed, shade): unpack r/g/b from a little-endian packed texel
  // ((a<<24)|(b<<16)|(g<<8)|r — packRGBA's layout), scale each channel by the
  // fixed-point shade, repack, and force the alpha byte OPAQUE (0xFF). Preserving
  // alpha here is what keeps the 03-01 Pitfall-6 alpha-drop bug from returning.
  // ===========================================================================
  Raycaster.shadeFactor = function (dist, isYSide) {
    var s = 1 - dist / CONFIG.FOG_FAR;      // linear: 1 at camera, 0 at FOG_FAR
    if (s < CONFIG.MIN_SHADE) s = CONFIG.MIN_SHADE;  // brightness floor (readability)
    if (s > 1) s = 1;
    if (isYSide) s *= CONFIG.SIDE_SHADE;    // constant y-side depth cue
    return (s * 256) | 0;                   // 0..256 fixed point
  };

  Raycaster.applyShade = function (packed, shade /* 0..256 */) {
    var r = ((packed & 0xFF) * shade) >> 8;
    var g = (((packed >> 8) & 0xFF) * shade) >> 8;
    var b = (((packed >> 16) & 0xFF) * shade) >> 8;
    // High byte forced 0xFF (opaque); layout matches packRGBA exactly (no R/B swap).
    return (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0;
  };

  // ===========================================================================
  // RENDER — Pass A (whole-frame fill) then Pass B (DDA wall pass). Writes buf32
  // + zBuffer, NEVER presents. Reads Framebuffer.width/height LIVE every call
  // (internal height is aspect-derived in [200,480]; never cache across frames).
  // ===========================================================================
  Raycaster.render = function () {
    var buf = Framebuffer.buf32;
    var zbuf = Framebuffer.zBuffer;
    var W = Framebuffer.width;
    var H = Framebuffer.height;
    var horizon = H >> 1;               // integer centre row; H can be odd

    // Pose snapshot into locals once per frame (no per-column property reads).
    var px = Player.x, py = Player.y;
    var dirX = Player.dirX, dirY = Player.dirY;
    var planeX = Player.planeX, planeY = Player.planeY;

    var EPS = Raycaster.EPS;
    var BIG = Raycaster.BIG;
    // Shade helpers hoisted to locals once per frame (no per-column property read,
    // no per-pixel allocation). REND-04 shading path — see the helper block above.
    var shadeFactor = Raycaster.shadeFactor;
    var applyShade = Raycaster.applyShade;

    // ---- PASS A: row-based floor/ceiling cast (fills the WHOLE frame) ---------
    // REND-03 (RESEARCH Pattern 3, CONTEXT decision 5). For every screen row below
    // the horizon the floor lies at a CONSTANT world distance, so world coords
    // interpolate LINEARLY across the row; the mirrored row (H-1-y) samples the
    // ceiling. This Pass A fills the whole frame FIRST; the wall Pass B then
    // overwrites the wall spans. Floors/ceilings NEVER write zBuffer (Phase 4
    // sprites occlude against wall distance only). Gated on CONFIG.FLOOR_CAST; the
    // real distance-shaded flat-colour fallback is the else branch (03-03 Task 2).
    var y;
    if (CONFIG.FLOOR_CAST) {
      // Leftmost (cameraX = -1) and rightmost (cameraX = +1) ray directions frame
      // the per-row world span; interpolating between them across x is the whole
      // trick (no per-pixel trig, no per-pixel divide).
      var rayDirX0 = dirX - planeX, rayDirY0 = dirY - planeY;
      var rayDirX1 = dirX + planeX, rayDirY1 = dirY + planeY;
      var posZ = CONFIG.CAMERA_Z * H;   // 0.5*H aligns the cast floor to the wall base
      var floorTex = Textures.map.floor, ceilTex = Textures.map.ceiling;
      var fBuf = floorTex.buf32, cBuf = ceilTex.buf32;
      var FTEX = CONFIG.TEX_SIZE, FMASK = FTEX - 1;

      // Iterate y over [horizon, H) and mirror to (H-1-y). The union of the floor
      // range [horizon, H-1] and the ceiling range [0, H-1-horizon] is EXACTLY
      // [0, H-1] for BOTH even and odd H, so no row is ever skipped (odd-H W2). The
      // horizon row (p == 0) is clamped to the nearest row's distance so the
      // (y - horizon) == 0 divide is avoided structurally (threat T-03-07).
      for (y = horizon; y < H; y++) {
        var p = y - horizon;
        if (p < 1) p = 1;                        // horizon row: no /0, no CLEAR seam
        var rowDistance = posZ / p;              // constant for the row; also the shade distance
        var floorStepX = rowDistance * (rayDirX1 - rayDirX0) / W;
        var floorStepY = rowDistance * (rayDirY1 - rayDirY0) / W;
        var floorX = px + rowDistance * rayDirX0;
        var floorY = py + rowDistance * rayDirY0;
        var rowShade = shadeFactor(rowDistance, false);   // ONCE per row (REND-04)
        var floorRowBase = y * W;
        var ceilRowBase = (H - 1 - y) * W;                // mirror across the screen centre
        for (var xf = 0; xf < W; xf++) {
          // ((coord * TEX) | 0) & MASK: the forced-solid border keeps sampled floor
          // coords inside the grid, and the mask lands the index in [0,4095] even at
          // a boundary (threat T-03-08). No divide/trig/allocation in this hot loop.
          var tx = ((floorX * FTEX) | 0) & FMASK;
          var ty = ((floorY * FTEX) | 0) & FMASK;
          floorX += floorStepX;
          floorY += floorStepY;
          var ti = (ty << 6) + tx;                        // ty*64 + tx
          buf[floorRowBase + xf] = applyShade(fBuf[ti], rowShade);
          buf[ceilRowBase + xf] = applyShade(cBuf[ti], rowShade);
        }
      }
    } else {
      // REAL distance-shaded flat-colour fallback (CONFIG.FLOOR_CAST === false) —
      // RESEARCH Pattern 4, CONTEXT decision 5. This ships if the row-caster ever
      // underperforms. It calls the SAME shadeFactor(rowDistance, false) as the
      // textured path, so floor/ceiling still DARKEN with distance IDENTICALLY;
      // only the base colour differs (a flat CONFIG colour instead of a sampled
      // texel). A real, harness-exercised code path — not dead code, not a flat
      // unshaded slab. Same y-range/mirror as the cast, so coverage (even AND odd
      // H, horizon row included) is identical.
      var floorBase = CONFIG.FLOOR_COLOR >>> 0;
      var ceilBase = CONFIG.CEIL_COLOR >>> 0;
      for (y = horizon; y < H; y++) {
        var pf = y - horizon;
        if (pf < 1) pf = 1;                               // horizon row: no /0, no CLEAR seam
        var rowDistF = (CONFIG.CAMERA_Z * H) / pf;        // same distance the cast uses
        var rowShadeF = shadeFactor(rowDistF, false);     // ONCE per row (REND-04)
        var floorC = applyShade(floorBase, rowShadeF);
        var ceilC = applyShade(ceilBase, rowShadeF);
        var fRow = y * W, cRow = (H - 1 - y) * W;
        for (var xg = 0; xg < W; xg++) {
          buf[fRow + xg] = floorC;
          buf[cRow + xg] = ceilC;
        }
      }
    }

    // ---- PASS B: per-column DDA wall cast (overwrites wall spans) -------------
    for (var x = 0; x < W; x++) {
      var cameraX = 2 * x / W - 1;              // -1 (left) .. +1 (right)
      var rayDirX = dirX + planeX * cameraX;
      var rayDirY = dirY + planeY * cameraX;

      var mapX = Math.floor(px);
      var mapY = Math.floor(py);

      // Divide-by-zero guard: a FINITE sentinel, not Infinity (0*Infinity = NaN).
      var deltaDistX = (rayDirX === 0) ? BIG : Math.abs(1 / rayDirX);
      var deltaDistY = (rayDirY === 0) ? BIG : Math.abs(1 / rayDirY);

      var stepX, stepY, sideDistX, sideDistY;
      if (rayDirX < 0) { stepX = -1; sideDistX = (px - mapX) * deltaDistX; }
      else             { stepX =  1; sideDistX = (mapX + 1 - px) * deltaDistX; }
      if (rayDirY < 0) { stepY = -1; sideDistY = (py - mapY) * deltaDistY; }
      else             { stepY =  1; sideDistY = (mapY + 1 - py) * deltaDistY; }

      // DDA — step the nearer side until a solid cell. Bounded so a malformed or
      // borderless map cannot spin (same posture as Level.lineOfSight).
      var side = 0;
      var guard = Level.WIDTH + Level.HEIGHT + 2;
      while (guard-- > 0) {
        if (sideDistX < sideDistY) { sideDistX += deltaDistX; mapX += stepX; side = 0; }
        else                       { sideDistY += deltaDistY; mapY += stepY; side = 1; }
        if (Level.isSolid(mapX, mapY)) break;
      }

      // PERPENDICULAR distance — the anti-fisheye. NEVER hypot(hitX-px, hitY-py).
      var perpWall = (side === 0) ? (sideDistX - deltaDistX) : (sideDistY - deltaDistY);
      if (!(perpWall > EPS)) perpWall = EPS;     // catches 0, negative, NaN

      zbuf[x] = perpWall;                        // REND-06 — every column, always.

      var lineHeight = Math.floor(H / perpWall);
      var half = lineHeight >> 1;
      var drawStart = -half + horizon;
      var drawEnd = half + horizon;
      var clampedStart = drawStart < 0 ? 0 : drawStart;
      var clampedEnd = drawEnd > H ? H : drawEnd;   // exclusive loop bound

      // ---- TEXTURE SAMPLING (REND-02) — RESEARCH Pattern 2, CONTEXT decision 3.
      // Resolve the texture ONCE per column (before the row loop). The fail-safe
      // is Textures.map.stone; Level.validateTextures() guarantees no wall id is
      // missing, so the branch is defence, not a routine path.
      var id = Level.cellAt(mapX, mapY);
      var tex = Level.textureFor(id);
      if (!tex) tex = Textures.map.stone;
      var texBuf = tex.buf32;
      var TEX = tex.width;                 // 64, a power of two
      var MASK = TEX - 1;                   // 63 — mask instead of modulo

      // REND-04: fog+side shade computed ONCE per column (perpWall is constant for
      // the whole column); every texel is one packed read + shade + packed write.
      var colShade = shadeFactor(perpWall, side === 1);

      // Horizontal: fractional hit position along the wall face (the axis OTHER
      // than `side`), then the texture column with BOTH side-based flips so the
      // asymmetric exit arrow reads with one consistent handedness (no mirror at
      // corners). texX &= MASK is belt-and-braces: wallX*TEX can reach TEX at a
      // grid boundary (threat T-03-05).
      var wallX = (side === 0) ? (py + perpWall * rayDirY)
                               : (px + perpWall * rayDirX);
      wallX -= Math.floor(wallX);
      var texX = Math.floor(wallX * TEX);
      if (side === 0 && rayDirX > 0) texX = TEX - texX - 1;
      if (side === 1 && rayDirY < 0) texX = TEX - texX - 1;
      texX &= MASK;

      // Vertical: fixed-point step referenced to the UNCLAMPED wall span, so a
      // tall near wall (drawStart < 0) samples the correct visible slice instead
      // of swimming. If the top was clipped, advance texPos over the hidden rows
      // first — do NOT re-anchor to clampedStart.
      var step = TEX / lineHeight;
      var texPos = (drawStart - horizon + (lineHeight >> 1)) * step;
      if (clampedStart > drawStart) texPos += (clampedStart - drawStart) * step;

      for (var yy = clampedStart; yy < clampedEnd; yy++) {
        var texY = (texPos | 0) & MASK;    // | 0 = fast floor for non-negative
        texPos += step;
        buf[yy * W + x] = applyShade(texBuf[(texY << 6) + texX], colShade);
      }
    }
  };

})();
