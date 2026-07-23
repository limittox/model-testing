/*
 * textures.js — procedural wall / floor / ceiling texture generation.
 *
 * LOAD ORDER: loaded AFTER config.js and framebuffer.js, BEFORE main.js.
 * Needs the globals `CONFIG`, `packRGBA` and `mulberry32` from config.js.
 *
 * THE ASSET-BUFFER CONTRACT (locked — Phases 3 and 4 consume this shape):
 *
 *   { width, height, data: Uint8ClampedArray, buf32: Uint32Array }
 *
 *   - `data` is width*height*4 RGBA bytes.
 *   - `buf32` is a Uint32Array view over THE SAME ArrayBuffer as `data`, so one
 *     packed little-endian store (a<<24)|(b<<16)|(g<<8)|r writes a whole texel.
 *     This matches the Framebuffer.buf32 contract exactly, which is why the
 *     renderer can copy a texel into the framebuffer with a plain assignment.
 *   - Every texture here is CONFIG.TEX_SIZE (64) square — a power of two, so the
 *     raycaster masks texel coordinates with `& 63` instead of a modulo.
 *   - buf32.length === width*height === 4096 for every texture.
 *
 * DETERMINISM: all procedural noise draws from mulberry32(CONFIG.SEED + salt),
 * with a distinct stable salt per texture. Two builds with the same SEED produce
 * byte-identical buffers, so the art never changes across reloads.
 *
 * ALLOCATION: everything is built once at load. No allocation happens after
 * build() returns; the render loop only ever reads these buffers.
 */

var Textures = {
  // name -> asset dictionary. Populated by build(). Insertion order is stable,
  // so Object.keys(Textures.map) is a deterministic display order.
  map: {},

  // Explicit build order / display order (also the Phase 3 wall-id order:
  // wall id N maps to names[N-1] once the map format lands).
  names: ['stone', 'brick', 'tech', 'door', 'exit', 'floor', 'ceiling'],

  built: false,

  build: function () {
    var m = {};
    m.stone = Textures.makeStone(11);
    m.brick = Textures.makeBrick(22);
    m.tech = Textures.makeTech(33);
    m.door = Textures.makeDoor(44);
    m.exit = Textures.makeExit(55);
    m.floor = Textures.makeFloor(66);
    m.ceiling = Textures.makeCeiling(77);
    Textures.map = m;
    Textures.built = true;
    return m;
  }
};

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Shared low-level helpers (module-private: attached to Textures where the
  // build steps need them, never leaked as bare globals).
  // ---------------------------------------------------------------------------

  var TS = CONFIG.TEX_SIZE; // 64 — power of two

  // Allocate one asset in the locked flat shape. `data` and `buf32` alias the
  // same ArrayBuffer, so a packed 32-bit store lands as [r,g,b,a] bytes.
  function makeAsset(w, h) {
    var data = new Uint8ClampedArray(w * h * 4);
    return {
      width: w,
      height: h,
      data: data,
      buf32: new Uint32Array(data.buffer)
    };
  }

  // Clamp to a whole byte. Every color component passes through this so no
  // computed shade can wrap around or land fractional.
  function ci(v) {
    v = v | 0;
    return v < 0 ? 0 : (v > 255 ? 255 : v);
  }

  // Opaque packed color from possibly out-of-range components.
  function rgb(r, g, b) {
    return packRGBA(ci(r), ci(g), ci(b), 255);
  }

  // Bounds-checked texel store. Guarding here means no generator can ever write
  // outside 0..width*height-1 (threat T-01-04) even if its shape math is off.
  function px(t, x, y, packed) {
    if (x < 0 || y < 0 || x >= t.width || y >= t.height) return;
    t.buf32[y * t.width + x] = packed;
  }

  // Filled axis-aligned rectangle (clipped by px()).
  function rect(t, x0, y0, w, h, packed) {
    for (var y = y0; y < y0 + h; y++) {
      for (var x = x0; x < x0 + w; x++) px(t, x, y, packed);
    }
  }

  // Seamlessly-tiling smooth value noise: a cells x cells lattice of random
  // values, bilinearly interpolated with a smoothstep fade and wrapped modulo
  // `cells` so the left/right and top/bottom edges match (textures repeat).
  function noiseField(rand, w, h, cells) {
    var g = new Float32Array(cells * cells);
    var i;
    for (i = 0; i < g.length; i++) g[i] = rand();

    var out = new Float32Array(w * h);
    var sx = cells / w;
    var sy = cells / h;
    for (var y = 0; y < h; y++) {
      var fy = y * sy;
      var y0 = Math.floor(fy);
      var ty = fy - y0;
      var v = ty * ty * (3 - 2 * ty);
      var r0 = (y0 % cells) * cells;
      var r1 = ((y0 + 1) % cells) * cells;
      for (var x = 0; x < w; x++) {
        var fx = x * sx;
        var x0 = Math.floor(fx);
        var tx = fx - x0;
        var u = tx * tx * (3 - 2 * tx);
        var c0 = x0 % cells;
        var c1 = (x0 + 1) % cells;
        var a = g[r0 + c0], b = g[r0 + c1];
        var c = g[r1 + c0], d = g[r1 + c1];
        out[y * w + x] = (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
      }
    }
    return out;
  }

  // Two-octave fractal noise in [0,1]: coarse blobs plus finer detail. Cheap
  // stand-in for Perlin fBm; plenty for 64x64 surface grain.
  function fbm(rand, w, h, coarse, fine) {
    var a = noiseField(rand, w, h, coarse);
    var b = noiseField(rand, w, h, fine);
    var out = new Float32Array(w * h);
    for (var i = 0; i < out.length; i++) out[i] = a[i] * 0.65 + b[i] * 0.35;
    return out;
  }

  // ---------------------------------------------------------------------------
  // Generators — one per texture, each with its own stable PRNG salt.
  // ---------------------------------------------------------------------------

  // STONE — mottled grey rock with dark irregular cracks and a subtle
  // top-lit vertical gradient so flat-shaded walls still read as surfaces.
  Textures.makeStone = function (salt) {
    var t = makeAsset(TS, TS);
    var rand = mulberry32(CONFIG.SEED + salt);
    var n = fbm(rand, TS, TS, 4, 16);
    var crack = noiseField(rand, TS, TS, 6);

    for (var y = 0; y < TS; y++) {
      // Gentle darkening toward the bottom (fake ambient occlusion).
      var grad = 10 - (y / TS) * 20;
      for (var x = 0; x < TS; x++) {
        var i = y * TS + x;
        var v = 96 + n[i] * 56 + grad;
        // Crack: values close to the middle of the noise band form thin veins.
        var c = Math.abs(crack[i] - 0.5);
        if (c < 0.035) v -= 46 * (1 - c / 0.035);
        t.buf32[i] = rgb(v + 4, v + 2, v - 2);
      }
    }
    // Chipped highlights along a few random pits, for surface interest.
    for (var k = 0; k < 26; k++) {
      var px0 = (rand() * TS) | 0;
      var py0 = (rand() * TS) | 0;
      var s = 1 + ((rand() * 2) | 0);
      rect(t, px0, py0, s, s, rgb(150 + rand() * 30, 148 + rand() * 30, 142));
    }
    return t;
  };

  // BRICK — offset courses of bricks separated by pale mortar, each brick given
  // a stable per-brick tint plus fine grain.
  Textures.makeBrick = function (salt) {
    var t = makeAsset(TS, TS);
    var rand = mulberry32(CONFIG.SEED + salt);
    var grain = noiseField(rand, TS, TS, 16);

    var BH = 16;          // brick height (course)
    var BW = 32;          // brick width
    var MORTAR = 2;       // mortar joint thickness
    var rows = TS / BH;   // 4 courses

    // Precompute per-brick tint FIRST so the raster loop is order-independent
    // and the PRNG stream stays stable regardless of iteration details.
    var perBrick = new Float32Array(rows * 4);
    for (var b = 0; b < perBrick.length; b++) perBrick[b] = rand();

    for (var y = 0; y < TS; y++) {
      var row = (y / BH) | 0;
      var yInBrick = y - row * BH;
      // Alternate courses are offset by half a brick (running bond).
      var offset = (row & 1) ? (BW / 2) : 0;
      for (var x = 0; x < TS; x++) {
        var i = y * TS + x;
        var bx = (x + offset) % TS;
        var col = (bx / BW) | 0;
        var xInBrick = bx - col * BW;

        var isMortar = (yInBrick < MORTAR) || (xInBrick < MORTAR);
        if (isMortar) {
          var mv = 122 + grain[i] * 26;
          t.buf32[i] = rgb(mv, mv - 4, mv - 10);
          continue;
        }

        var tint = perBrick[row * 4 + (col % 4)];
        var base = 118 + tint * 40;
        // Bevel: brighter at the top-left of each brick, darker bottom-right.
        var bevel = 0;
        if (yInBrick === MORTAR || xInBrick === MORTAR) bevel = 18;
        if (yInBrick === BH - 1 || xInBrick === BW - 1) bevel = -20;
        var g2 = grain[i] * 22 - 11;
        t.buf32[i] = rgb(base + bevel + g2, base * 0.46 + bevel + g2, base * 0.34 + bevel + g2);
      }
    }
    return t;
  };

  // TECH PANEL — dark steel plate with a beveled border, bolt studs at the
  // corners, horizontal vent slots and a cyan status strip.
  Textures.makeTech = function (salt) {
    var t = makeAsset(TS, TS);
    var rand = mulberry32(CONFIG.SEED + salt);
    var grain = noiseField(rand, TS, TS, 32);

    for (var y = 0; y < TS; y++) {
      for (var x = 0; x < TS; x++) {
        var i = y * TS + x;
        var v = 58 + grain[i] * 18;
        // Outer bevel: 3px frame, lit top/left, shadowed bottom/right.
        var edge = Math.min(x, y, TS - 1 - x, TS - 1 - y);
        if (edge < 3) {
          v += (x < 3 || y < 3) ? 34 : -22;
        }
        t.buf32[i] = rgb(v * 0.92, v, v * 1.16);
      }
    }

    // Vent slots — three recessed horizontal louvers across the middle.
    for (var s = 0; s < 3; s++) {
      var vy = 24 + s * 8;
      rect(t, 12, vy, 40, 3, rgb(24, 27, 33));
      rect(t, 12, vy + 3, 40, 1, rgb(92, 100, 116));
    }

    // Bolt studs: a lit dome with a dark rim at each inner corner.
    var studs = [[7, 7], [56, 7], [7, 56], [56, 56]];
    for (var b = 0; b < studs.length; b++) {
      var sx = studs[b][0], sy = studs[b][1];
      rect(t, sx - 1, sy - 1, 3, 3, rgb(28, 31, 38));
      rect(t, sx, sy, 2, 2, rgb(142, 152, 172));
      px(t, sx, sy, rgb(190, 200, 220));
    }

    // Cyan status strip (kept dim — this is a wall, not a light source).
    rect(t, 14, 12, 36, 3, rgb(20, 24, 30));
    for (var lx = 15; lx < 49; lx++) {
      var lit = grain[12 * TS + lx] > 0.45;
      px(t, lx, 13, lit ? rgb(70, 210, 220) : rgb(30, 90, 100));
    }
    return t;
  };

  // DOOR — heavy framed metal door with a centre seam, brushed vertical
  // striations and a hazard-striped kick plate along the bottom.
  Textures.makeDoor = function (salt) {
    var t = makeAsset(TS, TS);
    var rand = mulberry32(CONFIG.SEED + salt);
    var grain = noiseField(rand, TS, TS, 32);

    for (var y = 0; y < TS; y++) {
      for (var x = 0; x < TS; x++) {
        var i = y * TS + x;
        // Brushed metal: vertical striations from a per-column stable value.
        var stripe = ((x * 7) % 5) - 2;
        var v = 96 + grain[i] * 16 + stripe * 3;
        var edge = Math.min(x, y, TS - 1 - x, TS - 1 - y);
        if (edge < 4) v = 66 + grain[i] * 12;            // dark frame
        if (edge === 4) v += 30;                          // inner highlight
        t.buf32[i] = rgb(v * 1.02, v * 0.96, v * 0.82);
      }
    }

    // Centre seam — where the two door halves meet.
    rect(t, 31, 5, 1, 54, rgb(34, 32, 28));
    rect(t, 32, 5, 1, 54, rgb(140, 134, 116));

    // Recessed window slot in the upper half.
    rect(t, 18, 14, 28, 10, rgb(30, 30, 34));
    rect(t, 19, 15, 26, 8, rgb(58, 76, 70));
    for (var wx = 19; wx < 45; wx++) px(t, wx, 15, rgb(96, 128, 118));

    // Hazard kick plate: diagonal yellow/black stripes near the bottom.
    for (var hy = 46; hy < 58; hy++) {
      for (var hx = 6; hx < 58; hx++) {
        var band = ((hx + hy) / 6) | 0;
        px(t, hx, hy, (band & 1) ? rgb(206, 174, 40) : rgb(38, 34, 26));
      }
    }
    return t;
  };

  // EXIT — the one emissive marker: a bright bordered panel with a chunky
  // right-pointing arrow glyph, deliberately the highest-contrast texture so it
  // is unmistakable both in the atlas and later in-level.
  Textures.makeExit = function (salt) {
    var t = makeAsset(TS, TS);
    var rand = mulberry32(CONFIG.SEED + salt);
    var grain = noiseField(rand, TS, TS, 16);

    // Dark interior field.
    for (var y = 0; y < TS; y++) {
      for (var x = 0; x < TS; x++) {
        var i = y * TS + x;
        var v = 18 + grain[i] * 14;
        t.buf32[i] = rgb(v * 0.7, v * 1.5, v * 0.9);
      }
    }

    // Emissive border: a 5px bright-green frame with a hot inner edge.
    for (var e = 0; e < 5; e++) {
      var glow = 90 + e * 34;
      var c = rgb(30 + e * 10, glow + 60, 60 + e * 12);
      rect(t, e, e, TS - e * 2, 1, c);
      rect(t, e, TS - 1 - e, TS - e * 2, 1, c);
      rect(t, e, e, 1, TS - e * 2, c);
      rect(t, TS - 1 - e, e, 1, TS - e * 2, c);
    }

    // Arrow glyph: a shaft plus a triangular head, pointing right.
    var bright = rgb(150, 255, 170);
    rect(t, 16, 28, 20, 8, bright);
    for (var a = 0; a < 14; a++) {
      var hh = 14 - a;                 // half-height shrinks toward the tip
      rect(t, 36 + a, 32 - hh, 1, hh * 2, bright);
    }
    // Soft inner shadow under the glyph so it reads as raised.
    for (var sx2 = 17; sx2 < 36; sx2++) px(t, sx2, 36, rgb(40, 120, 60));
    return t;
  };

  // FLOOR — grouted gravel tiles: warm brown fbm with a darker seam grid and
  // scattered speckle so the floor pass (Phase 3) has visible parallax detail.
  Textures.makeFloor = function (salt) {
    var t = makeAsset(TS, TS);
    var rand = mulberry32(CONFIG.SEED + salt);
    var n = fbm(rand, TS, TS, 8, 24);

    for (var y = 0; y < TS; y++) {
      for (var x = 0; x < TS; x++) {
        var i = y * TS + x;
        var v = 62 + n[i] * 54;
        // 32x32 tile seams.
        var sxm = x % 32, sym = y % 32;
        if (sxm === 0 || sym === 0) v -= 30;
        else if (sxm === 1 || sym === 1) v += 14;
        t.buf32[i] = rgb(v * 1.12, v * 0.94, v * 0.74);
      }
    }
    // Gravel speckle.
    for (var k = 0; k < 90; k++) {
      var gx = (rand() * TS) | 0;
      var gy = (rand() * TS) | 0;
      var d = rand() > 0.5 ? 1 : -1;
      px(t, gx, gy, rgb(96 + d * 40, 82 + d * 34, 64 + d * 26));
    }
    return t;
  };

  // CEILING — cold concrete panels on a 16px grid with recessed seams and a
  // couple of dim light fittings, so ceiling casting reads distinctly from floor.
  Textures.makeCeiling = function (salt) {
    var t = makeAsset(TS, TS);
    var rand = mulberry32(CONFIG.SEED + salt);
    var n = fbm(rand, TS, TS, 6, 20);

    for (var y = 0; y < TS; y++) {
      for (var x = 0; x < TS; x++) {
        var i = y * TS + x;
        var v = 48 + n[i] * 34;
        var sxm = x % 16, sym = y % 16;
        if (sxm === 0 || sym === 0) v -= 22;          // recessed seam
        else if (sxm === 15 || sym === 15) v += 10;   // lit lip
        t.buf32[i] = rgb(v * 0.9, v * 0.96, v * 1.22);
      }
    }
    // Two dim ceiling lamps.
    var lamps = [[12, 12], [44, 44]];
    for (var l = 0; l < lamps.length; l++) {
      var lx = lamps[l][0], ly = lamps[l][1];
      rect(t, lx - 1, ly - 1, 10, 10, rgb(38, 40, 48));
      rect(t, lx, ly, 8, 8, rgb(126, 128, 116));
      rect(t, lx + 1, ly + 1, 6, 6, rgb(178, 178, 154));
    }
    return t;
  };
})();
