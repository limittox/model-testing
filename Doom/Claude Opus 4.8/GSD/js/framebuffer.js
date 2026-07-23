/*
 * framebuffer.js — the software render surface.
 *
 * LOAD ORDER: loaded AFTER config.js (needs CONFIG). Extends the global
 * `Framebuffer` object; main.js drives it.
 *
 * FRAMEBUFFER CONTRACT: one reusable ImageData at the internal resolution.
 * `buf32` is a Uint32Array view aliasing the SAME ArrayBuffer as the
 * ImageData's Uint8ClampedArray (`buf8`), so a packed-color write flows
 * straight through the next putImageData with no copy. Buffers are allocated
 * ONCE and reallocated only when the internal resolution actually changes.
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
    var h = Math.round(w * window.innerHeight / window.innerWidth);
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
    // native resolution.
    this.hudCanvas.width = window.innerWidth;
    this.hudCanvas.height = window.innerHeight;
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
