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
 *            kills fisheye), the per-column z-buffer write (REND-06), and a
 *            SOLID base colour per wall id with a one-op y-side depth cue. 03-02
 *            replaces that solid fill with the sampled, fog-shaded texel.
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

  // SOLID base colour per wall ID, INDEX-ALIGNED to Level.WALL_TEXTURES
  // ([null, 'stone', 'brick', 'tech', 'door', 'exit']). Index 0 is unused (a wall
  // is always id >= 1). 03-02 replaces this table lookup with a texel sample.
  // Chosen distinct from the TopDown palette so a mis-wire is obvious in-browser.
  WALL_COLORS: [
    0,                        // 0 — no wall
    packRGBA(140, 140, 150),  // 1 stone — grey
    packRGBA(170, 84, 60),    // 2 brick — red-brown
    packRGBA(84, 132, 188),   // 3 tech  — steel-blue
    packRGBA(214, 168, 56),   // 4 door  — amber
    packRGBA(72, 210, 110)    // 5 exit  — green
  ],
  // Fail-safe when Level.cellAt returns an unexpected id (0 or out of range).
  WALL_FALLBACK: packRGBA(120, 120, 128)
};

(function () {
  'use strict';

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
    var wallColors = Raycaster.WALL_COLORS;
    var wallFallback = Raycaster.WALL_FALLBACK;

    // ---- PASS A: whole-frame two-tone fill (ceiling above, floor below) ------
    // Every pixel written, so the frame is fully painted and the horizon reads.
    var ceil = CONFIG.CEIL_COLOR >>> 0;
    var floor = CONFIG.FLOOR_COLOR >>> 0;
    var y, base;
    for (y = 0; y < horizon; y++) {
      base = y * W;
      for (var xa = 0; xa < W; xa++) buf[base + xa] = ceil;
    }
    for (y = horizon; y < H; y++) {
      base = y * W;
      for (var xb = 0; xb < W; xb++) buf[base + xb] = floor;
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

      // Solid base colour for the hit wall id (03-02 swaps in the sampled texel).
      var id = Level.cellAt(mapX, mapY);
      var color = (id >= 1 && id < wallColors.length) ? wallColors[id] : wallFallback;
      // One-op y-side depth cue: halve every channel so perpendicular (side==1)
      // faces read as lit differently from side==0 faces.
      if (side === 1) color = (color >> 1) & 0x7F7F7F;
      color = color >>> 0;

      for (var yy = clampedStart; yy < clampedEnd; yy++) {
        buf[yy * W + x] = color;
      }
    }
  };

})();
