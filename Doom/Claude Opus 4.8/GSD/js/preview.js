/*
 * preview.js — load-time preview atlas.
 *
 * LOAD ORDER: loaded AFTER config.js, framebuffer.js, textures.js and
 * sprites.js; BEFORE main.js (which calls Preview.render()).
 *
 * WHAT THIS PROVES (Phase 1 success criterion 3): it is the first end-to-end
 * run of the asset -> framebuffer -> canvas -> CSS-upscale path. Every generated
 * texture and sprite is tiled into Framebuffer.buf32 and pushed out with a
 * single Framebuffer.present(), so opening index.html shows a crisp, pixelated
 * atlas of procedurally-generated art before any raycaster exists.
 *
 * THE COLOR-KEY BLIT (locked — Phase 4's sprite pass reuses this exact test):
 *   a source texel is skipped when  ((packed >>> 24) & 0xff) < Sprites.ALPHA_KEY
 * i.e. alpha < 128 means transparent. Because both asset buffers and the
 * framebuffer use the SAME packed little-endian Uint32 layout, an accepted texel
 * is copied with a plain array assignment — no unpack/repack, no blending.
 *
 * The checkerboard backdrop exists to make transparency unmistakable: any
 * fringe or opaque bounding box around a sprite would show up immediately as a
 * rectangle interrupting the checker.
 *
 * ALLOCATION: the asset list is collected once and cached. The blit loops
 * allocate nothing beyond loop scalars.
 */

var Preview = {
  PAD: 6,                              // padding around each asset inside its cell
  BG_A: CONFIG.CEIL_COLOR,             // checker shade A (config color)
  BG_B: packRGBA(62, 66, 82),          // checker shade B (a touch lighter)
  CELL_FRAME: packRGBA(96, 102, 122),  // cell delimiter
  CHECK: 8,                            // checker square size, in framebuffer px

  // Cached [{ name, asset, colorKey }] — built on first render, reused on resize.
  _list: null,

  // Collect every generated asset in a stable order: textures first (opaque),
  // then sprites (color-keyed).
  collect: function () {
    var list = [];
    var i, n;
    for (i = 0; i < Textures.names.length; i++) {
      n = Textures.names[i];
      if (Textures.map[n]) list.push({ name: n, asset: Textures.map[n], colorKey: false });
    }
    for (i = 0; i < Sprites.names.length; i++) {
      n = Sprites.names[i];
      if (Sprites.map[n]) list.push({ name: n, asset: Sprites.map[n], colorKey: true });
    }
    return list;
  },

  // Copy an asset into the framebuffer at (dx, dy), clipped to the framebuffer
  // bounds. When colorKey is true, source texels with alpha < 128 are skipped so
  // the backdrop shows through.
  blit: function (a, dx, dy, colorKey) {
    var dst = Framebuffer.buf32;
    var src = a.buf32;
    var fw = Framebuffer.width;
    var fh = Framebuffer.height;
    var w = a.width;
    var h = a.height;

    // Clip the source rectangle against the framebuffer on all four sides.
    var sx0 = dx < 0 ? -dx : 0;
    var sy0 = dy < 0 ? -dy : 0;
    var sx1 = (dx + w > fw) ? (fw - dx) : w;
    var sy1 = (dy + h > fh) ? (fh - dy) : h;
    if (sx1 <= sx0 || sy1 <= sy0) return;

    var key = Sprites.ALPHA_KEY;
    for (var y = sy0; y < sy1; y++) {
      var srow = y * w;
      var drow = (dy + y) * fw + dx;
      for (var x = sx0; x < sx1; x++) {
        var p = src[srow + x];
        // The color-key test: high byte is alpha in the packed little-endian
        // layout (a<<24)|(b<<16)|(g<<8)|r.
        if (colorKey && ((p >>> 24) & 0xff) < key) continue;
        dst[drow + x] = p;
      }
    }
  },

  // Checkerboard backdrop over the whole framebuffer.
  checker: function () {
    var dst = Framebuffer.buf32;
    var fw = Framebuffer.width;
    var fh = Framebuffer.height;
    var cs = Preview.CHECK;
    var a = Preview.BG_A;
    var b = Preview.BG_B;
    for (var y = 0; y < fh; y++) {
      var band = ((y / cs) | 0) & 1;
      var row = y * fw;
      for (var x = 0; x < fw; x++) {
        dst[row + x] = ((((x / cs) | 0) & 1) ^ band) ? b : a;
      }
    }
  },

  // 1px unfilled rectangle, clipped.
  frame: function (x0, y0, w, h, packed) {
    var dst = Framebuffer.buf32;
    var fw = Framebuffer.width;
    var fh = Framebuffer.height;
    var x, y;
    for (x = x0; x < x0 + w; x++) {
      if (x < 0 || x >= fw) continue;
      if (y0 >= 0 && y0 < fh) dst[y0 * fw + x] = packed;
      y = y0 + h - 1;
      if (y >= 0 && y < fh) dst[y * fw + x] = packed;
    }
    for (y = y0; y < y0 + h; y++) {
      if (y < 0 || y >= fh) continue;
      if (x0 >= 0 && x0 < fw) dst[y * fw + x0] = packed;
      x = x0 + w - 1;
      if (x >= 0 && x < fw) dst[y * fw + x] = packed;
    }
  },

  // Lay every generated asset out as a centred grid and present it.
  render: function () {
    if (!Framebuffer || !Framebuffer.buf32) return;
    if (!Textures.built) Textures.build();
    if (!Sprites.built) Sprites.build();
    if (!Preview._list) Preview._list = Preview.collect();

    var list = Preview._list;
    var fw = Framebuffer.width;
    var fh = Framebuffer.height;

    // Backdrop first, so sprite transparency has something to show through.
    Framebuffer.clear(CONFIG.CEIL_COLOR);
    Preview.checker();

    // Uniform cells sized to the largest asset (the 96x64 weapon viewmodel).
    var maxW = 1, maxH = 1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].asset.width > maxW) maxW = list[i].asset.width;
      if (list[i].asset.height > maxH) maxH = list[i].asset.height;
    }
    var cw = maxW + Preview.PAD * 2;
    var ch = maxH + Preview.PAD * 2;

    var cols = (fw / cw) | 0;
    if (cols < 1) cols = 1;
    if (cols > list.length) cols = list.length;
    var rows = Math.ceil(list.length / cols);

    // Centre the grid; never start off the top/left edge.
    var ox = ((fw - cols * cw) / 2) | 0;
    var oy = ((fh - rows * ch) / 2) | 0;
    if (ox < 0) ox = 0;
    if (oy < 0) oy = 0;

    for (var k = 0; k < list.length; k++) {
      var entry = list[k];
      var a = entry.asset;
      var cx = ox + (k % cols) * cw;
      var cy = oy + ((k / cols) | 0) * ch;

      Preview.frame(cx + 1, cy + 1, cw - 2, ch - 2, Preview.CELL_FRAME);
      Preview.blit(
        a,
        cx + (((cw - a.width) / 2) | 0),
        cy + (((ch - a.height) / 2) | 0),
        entry.colorKey
      );
    }

    // One putImageData; CSS `image-rendering: pixelated` does the upscale.
    Framebuffer.present();
  }
};
