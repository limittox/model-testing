/*
 * topdown.js — the Phase 2 top-down verification view (D-09).
 *
 * LOAD ORDER: loaded AFTER js/player.js (reads Player.RADIUS and the pose) and
 * AFTER js/level.js (reads the parsed grid) and BEFORE js/game.js (Game.view
 * points here). It reads Framebuffer.width/height/buf32 and writes into buf32.
 *
 * TEMPORARY SCAFFOLDING — deliberately isolated (D-09). This view exists only to
 * make the level, the pose, the clamped loop and the collision observable BEFORE
 * any 3D exists. It lives entirely in this file behind TopDown.ENABLED and is
 * attached through the Game.view seam. PHASE 3 SWAPS IN THE RAYCASTER BY
 * RE-POINTING THAT ONE ASSIGNMENT — nothing else changes.
 *
 * THE VIEW CONTRACT (locked by Game.render):
 *
 *   render() WRITES INTO Framebuffer.buf32 AND DOES NOT PRESENT. Game.render()
 *   owns the single putImageData per frame, so present count == frame count on
 *   EVERY frame including a resync frame. Every write routes through a
 *   bounds-checked primitive, so no layout or viewport can push a write outside
 *   buf32 (threat T-02-14). Nothing is allocated per frame beyond loop scalars.
 */

var TopDown = {
  // The flag Phase 3 flips to false when it re-points Game.view at the raycaster.
  ENABLED: true,

  // Packed colours (little-endian RGBA via packRGBA).
  BG: packRGBA(10, 10, 14),      // letterbox behind the map
  FLOOR: packRGBA(40, 40, 48),   // open floor cells
  GRID: packRGBA(64, 64, 76),    // cell-boundary grid lines (Task 2)
  PLAYER: packRGBA(255, 240, 40),// the player disc
  RAY: packRGBA(255, 90, 40),    // the centre facing ray

  // Wall colour per wall ID, INDEX-ALIGNED to Level.WALL_TEXTURES
  // ([null, 'stone', 'brick', 'tech', 'door', 'exit']). Index 0 is unused (floor
  // is drawn there); 1..5 are the five materials.
  WALL_COLORS: [
    0,                        // 0 — no wall (floor is drawn instead)
    packRGBA(120, 120, 128),  // 1 stone   — grey
    packRGBA(158, 74, 52),    // 2 brick   — red-brown
    packRGBA(72, 116, 168),   // 3 tech    — steel-blue
    packRGBA(206, 156, 44),   // 4 door    — amber
    packRGBA(58, 220, 96)     // 5 exit    — bright green
  ],

  // Live layout, recomputed by layout() every render (never hardcoded).
  cell: 0,
  originX: 0,
  originY: 0
};

(function () {
  'use strict';

  // ===========================================================================
  // BOUNDS-CHECKED PIXEL PRIMITIVES — every write in this file routes through
  // these, so no drawing call can escape buf32 regardless of layout or viewport
  // (threat T-02-14). buf/fw/fh are passed in so the hot loops read locals.
  // ===========================================================================

  function setPixel(x, y, color, buf, fw, fh) {
    if (x < 0 || y < 0 || x >= fw || y >= fh) return;
    buf[y * fw + x] = color;
  }

  function fillRect(x, y, w, h, color, buf, fw, fh) {
    var x0 = x < 0 ? 0 : x;
    var y0 = y < 0 ? 0 : y;
    var x1 = x + w; if (x1 > fw) x1 = fw;
    var y1 = y + h; if (y1 > fh) y1 = fh;
    for (var yy = y0; yy < y1; yy++) {
      var base = yy * fw;
      for (var xx = x0; xx < x1; xx++) buf[base + xx] = color;
    }
  }

  function fillDisc(cx, cy, r, color, buf, fw, fh) {
    if (r < 1) r = 1;
    var r2 = r * r;
    for (var yy = -r; yy <= r; yy++) {
      for (var xx = -r; xx <= r; xx++) {
        if (xx * xx + yy * yy <= r2) setPixel(cx + xx, cy + yy, color, buf, fw, fh);
      }
    }
  }

  // Bresenham with a hard step guard so no input can spin it.
  function drawLine(x0, y0, x1, y1, color, buf, fw, fh) {
    var dx = Math.abs(x1 - x0);
    var dy = Math.abs(y1 - y0);
    var sx = x0 < x1 ? 1 : -1;
    var sy = y0 < y1 ? 1 : -1;
    var err = dx - dy;
    var guard = dx + dy + 2;
    while (guard-- > 0) {
      setPixel(x0, y0, color, buf, fw, fh);
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }

  // ===========================================================================
  // LAYOUT — from the LIVE framebuffer dimensions and the grid size, an integer
  // cell size (>= 1) that fits the whole map inside ~90% of the smaller
  // framebuffer dimension, plus the top-left origin that centres it. Stored on
  // the object so render() and the harness read the same mapping.
  // ===========================================================================
  TopDown.layout = function () {
    var fw = Framebuffer.width;
    var fh = Framebuffer.height;
    var mapW = Level.WIDTH || 1;
    var mapH = Level.HEIGHT || 1;

    var smaller = fw < fh ? fw : fh;
    var budget = smaller * 0.9;
    var cell = Math.floor(Math.min(budget / mapW, budget / mapH));
    if (!(cell >= 1)) cell = 1; // floor to at least one pixel (catches NaN too)

    var gridW = cell * mapW;
    var gridH = cell * mapH;
    TopDown.cell = cell;
    TopDown.originX = Math.floor((fw - gridW) / 2);
    TopDown.originY = Math.floor((fh - gridH) / 2);
    return TopDown;
  };

  // World coordinate -> framebuffer pixel coordinate, through the stored layout.
  // render() uses the SAME two helpers, so the pixel the harness probes with
  // toScreen(Player.x, Player.y) is exactly the pixel render drew the disc at.
  function pxOf(wx) { return TopDown.originX + Math.floor(wx * TopDown.cell); }
  function pyOf(wy) { return TopDown.originY + Math.floor(wy * TopDown.cell); }

  TopDown.toScreen = function (wx, wy) {
    return { sx: pxOf(wx), sy: pyOf(wy) };
  };

  // ===========================================================================
  // RENDER — write the map, the player and the facing ray into buf32. NO present.
  // ===========================================================================
  TopDown.render = function () {
    TopDown.layout(); // recompute every frame so a resize is handled (Task 2)

    var buf = Framebuffer.buf32;
    var fw = Framebuffer.width;
    var fh = Framebuffer.height;
    var cell = TopDown.cell;
    var ox = TopDown.originX;
    var oy = TopDown.originY;
    var mapW = Level.WIDTH;
    var mapH = Level.HEIGHT;
    var wallColors = TopDown.WALL_COLORS;

    // Background (letterbox).
    fillRect(0, 0, fw, fh, TopDown.BG, buf, fw, fh);

    // Grid cells: floor tone or the wall's material colour.
    for (var my = 0; my < mapH; my++) {
      for (var mx = 0; mx < mapW; mx++) {
        var id = Level.cellAt(mx, my);
        var color = id > 0 ? wallColors[id] : TopDown.FLOOR;
        fillRect(ox + mx * cell, oy + my * cell, cell, cell, color, buf, fw, fh);
      }
    }

    // The facing ray is drawn BEFORE the player disc so the disc covers the ray
    // origin — the pixel at the player's position reads back as the player colour.
    var pcx = pxOf(Player.x);
    var pcy = pyOf(Player.y);
    var rayLen = 2 * cell; // ~two cells
    drawLine(pcx, pcy,
      pcx + Math.round(Player.dirX * rayLen),
      pcy + Math.round(Player.dirY * rayLen),
      TopDown.RAY, buf, fw, fh);

    // The player, drawn last so its centre pixel is unambiguously the player
    // colour. Radius proportional to Player.RADIUS, at least 2px to stay visible.
    var pr = Math.floor(Player.RADIUS * cell);
    if (pr < 2) pr = 2;
    fillDisc(pcx, pcy, pr, TopDown.PLAYER, buf, fw, fh);
  };

})();
