/*
 * config.js — global tuning constants + shared helpers.
 *
 * LOAD ORDER: this file is loaded FIRST (see index.html). It defines the
 * `CONFIG` namespace and the global helpers `packRGBA` / `mulberry32` that
 * framebuffer.js and main.js (and later Plan 02 asset code) consume. Nothing
 * here depends on any other project file.
 *
 * PACKED COLOR CONTRACT: target platforms are little-endian, so the RGBA byte
 * sequence [r,g,b,a] read back as a Uint32 is (a<<24)|(b<<16)|(g<<8)|r. Every
 * color is precomputed in this packed form so the render inner loops are a
 * single Uint32 store.
 */

// Pack an [r,g,b,a] color into a little-endian Uint32. Alpha defaults to opaque.
// `>>> 0` forces an unsigned 32-bit result (JS bitwise ops are signed 32-bit).
function packRGBA(r, g, b, a) {
  if (a === undefined) a = 255;
  return (((a << 24) | (b << 16) | (g << 8) | r) >>> 0);
}

// mulberry32 — a tiny, fast, seeded PRNG. Returns a closure producing floats in
// [0, 1). Deterministic per seed so procedural art (Plan 02) is stable across
// loads. Consumed by the asset generators; defined here so the seed contract
// exists from day one.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The single global namespace object later files read from.
var CONFIG = {
  // --- Internal render resolution ---
  // Fixed low width; height is DERIVED from the viewport aspect and clamped to
  // [MIN_H, MAX_H] by Framebuffer.resize(). Keeping width fixed makes per-frame
  // cost independent of window size.
  INTERNAL_W: 480,
  MIN_H: 240,
  MAX_H: 300,

  // --- Camera / renderer tuning (consumed by later phases) ---
  // FOV_PLANE: camera-plane half-length; ~0.66 gives the classic ~66deg FOV.
  FOV_PLANE: 0.66,
  // TEX_SIZE: 64, a power of two so the renderer masks texel coords with `& 63`.
  TEX_SIZE: 64,
  // SEED: integer feeding mulberry32 for deterministic procedural generation.
  SEED: 1337,

  // --- Colors (packed via packRGBA to exercise the packed-color contract) ---
  // A distinct dark, non-black slate so a successful clear is unambiguous.
  CLEAR_COLOR: packRGBA(24, 26, 34),
  // Flat-fill fallbacks for the floor/ceiling pass before textured casting
  // lands (Phase 3): ceiling a dim blue-grey, floor a warmer brown-grey.
  CEIL_COLOR: packRGBA(48, 52, 66),
  FLOOR_COLOR: packRGBA(58, 50, 42)
};
