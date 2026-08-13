'use strict';

/* Small maths / colour helpers shared by every module.
   Colours are stored packed little-endian as 0xAABBGGRR so a single
   Uint32Array write puts a whole pixel down. */
var U = (function () {

  function rgb(r, g, b) {
    return (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0;
  }

  function rgba(r, g, b, a) {
    return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }

  function red(c)   { return c & 0xFF; }
  function green(c) { return (c >> 8) & 0xFF; }
  function blue(c)  { return (c >> 16) & 0xFF; }
  function alpha(c) { return (c >>> 24) & 0xFF; }

  /* f is 0..256 fixed point: 256 = unchanged, 0 = black. */
  function shade(c, f) {
    var r = ((c & 0xFF) * f) >> 8;
    var g = (((c >> 8) & 0xFF) * f) >> 8;
    var b = (((c >> 16) & 0xFF) * f) >> 8;
    return (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0;
  }

  /* Blend src over dst, t is 0..256. */
  function mix(dst, src, t) {
    var it = 256 - t;
    var r = (((dst & 0xFF) * it) + ((src & 0xFF) * t)) >> 8;
    var g = ((((dst >> 8) & 0xFF) * it) + (((src >> 8) & 0xFF) * t)) >> 8;
    var b = ((((dst >> 16) & 0xFF) * it) + (((src >> 16) & 0xFF) * t)) >> 8;
    return (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* Deterministic RNG so procedural art is identical every run. */
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Shortest signed difference between two angles. */
  function angDiff(a, b) {
    var d = (a - b) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function randRange(lo, hi) { return lo + Math.random() * (hi - lo); }
  function randInt(lo, hi) { return (lo + Math.random() * (hi - lo + 1)) | 0; }

  return {
    rgb: rgb, rgba: rgba, red: red, green: green, blue: blue, alpha: alpha,
    shade: shade, mix: mix, clamp: clamp, lerp: lerp, rng: rng,
    angDiff: angDiff, randRange: randRange, randInt: randInt
  };
})();
