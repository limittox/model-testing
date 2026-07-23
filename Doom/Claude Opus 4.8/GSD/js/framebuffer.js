/*
 * framebuffer.js — the software render surface.
 *
 * LOAD ORDER: loaded AFTER config.js (needs CONFIG). Extends the global
 * `Framebuffer` object; main.js drives it.
 *
 * THE FOUR LOCKED CONTRACTS (Phases 3, 4, 6 stand on these — do not change the
 * architecture, only extend it):
 *
 *   (1) TWO-CANVAS COMPOSITE. #game backing store = the internal resolution,
 *       CSS-upscaled with `image-rendering: pixelated`; #hud is a transparent
 *       overlay at DISPLAY resolution for crisp HUD/text (Phase 6). The GPU
 *       compositor is the ONLY upscaler.
 *
 *   (2) UINT32 FRAMEBUFFER. One reusable ImageData at internal size. `buf32` is
 *       a Uint32Array view aliasing the SAME ArrayBuffer as the ImageData's
 *       Uint8ClampedArray (`buf8`); colors are packed little-endian
 *       (a<<24)|(b<<16)|(g<<8)|r, so a packed write flows straight through the
 *       next present() — a SINGLE ctx.putImageData — with no copy.
 *
 *   (3) PER-COLUMN Z-BUFFER. A Float32Array sized to the internal width. The
 *       wall pass (Phase 3) FILLS it; the sprite pass (Phase 4) READS it for
 *       occlusion. The contract exists from day one, before its consumers.
 *
 *   (4) PREALLOCATE ONCE. The ImageData, buf8, buf32, and zBuffer are allocated
 *       once and reallocated ONLY when the internal resolution actually changes
 *       (a real resize) — never per frame (no GC churn in the hot loop).
 */

var Framebuffer = {
  ctx: null,       // #game 2D context (internal-resolution backing store)
  hudCtx: null,    // #hud 2D context (display-resolution overlay)
  img: null,       // the reusable ImageData
  buf8: null,      // ImageData.data — Uint8ClampedArray RGBA bytes
  buf32: null,     // Uint32Array view over buf8.buffer — the authoritative buffer
  zBuffer: null,   // per-column Float32Array depth buffer (Phases 3-4)
  width: 0,        // authoritative internal width (== CONFIG.INTERNAL_W)
  height: 0,       // authoritative internal height (varies with viewport aspect)

  // Store the two canvas contexts and size everything for the first time.
  init: function (gameCanvas, hudCanvas) {
    this.gameCanvas = gameCanvas;
    this.hudCanvas = hudCanvas;
    this.ctx = gameCanvas.getContext('2d');
    this.hudCtx = hudCanvas.getContext('2d');
    this.resize();
  },

  // Recompute the internal height from the viewport aspect (clamped), resize the
  // #game backing store to the internal resolution, and — only when the internal
  // dimensions actually change — (re)allocate the ImageData, its typed-array
  // views, and the z-buffer. The #hud backing store is sized to the display.
  resize: function () {
    var w = CONFIG.INTERNAL_W;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    // Guard against a zero/degenerate viewport (e.g. a minimized/hidden window):
    // a 0 or NaN would corrupt the aspect math and produce a bad allocation.
    var h = (vw > 0 && vh > 0) ? Math.round(w * vh / vw) : CONFIG.MIN_H;
    if (!(h > 0)) h = CONFIG.MIN_H; // catch NaN as well as <= 0
    // clamp(h, MIN_H, MAX_H)
    if (h < CONFIG.MIN_H) h = CONFIG.MIN_H;
    if (h > CONFIG.MAX_H) h = CONFIG.MAX_H;

    if (w !== this.width || h !== this.height) {
      this.width = w;
      this.height = h;
      this.gameCanvas.width = w;
      this.gameCanvas.height = h;
      this.img = this.ctx.createImageData(w, h);
      this.buf8 = this.img.data;
      this.buf32 = new Uint32Array(this.buf8.buffer);
      this.zBuffer = new Float32Array(w);
    }

    // #hud backing store tracks the display so HUD text (Phase 6) is crisp at
    // native resolution. Never let a degenerate viewport drop it to 0.
    this.hudCanvas.width = vw > 0 ? vw : 1;
    this.hudCanvas.height = vh > 0 ? vh : 1;
  },

  // Fill the whole framebuffer with one packed color.
  clear: function (packed) {
    this.buf32.fill(packed >>> 0);
  },

  // Blit the framebuffer to the #game canvas with a single putImageData at 1:1;
  // CSS `image-rendering: pixelated` upscales it to the viewport.
  present: function () {
    this.ctx.putImageData(this.img, 0, 0);
  }
};
