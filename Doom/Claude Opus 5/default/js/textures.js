'use strict';

/* Every wall / floor texture is generated into a Uint32Array at boot.
   No image files, so nothing can taint the canvas and nothing has to load. */
var TEX = (function () {

  var N = CFG.TEX;          // 64
  var walls = [];           // index -> Uint32Array(N*N)
  var floors = [];

  function blank() { return new Uint32Array(N * N); }

  function px(d, x, y, c) {
    if (x < 0 || y < 0 || x >= N || y >= N) return;
    d[(y * N + x) | 0] = c;
  }

  function fill(d, c) { d.fill(c); }

  function rect(d, x0, y0, w, h, c) {
    for (var y = y0; y < y0 + h; y++)
      for (var x = x0; x < x0 + w; x++) px(d, x, y, c);
  }

  function hline(d, x0, x1, y, c) { for (var x = x0; x <= x1; x++) px(d, x, y, c); }
  function vline(d, x, y0, y1, c) { for (var y = y0; y <= y1; y++) px(d, x, y, c); }

  function frameRect(d, x0, y0, w, h, c) {
    hline(d, x0, x0 + w - 1, y0, c);
    hline(d, x0, x0 + w - 1, y0 + h - 1, c);
    vline(d, x0, y0, y0 + h - 1, c);
    vline(d, x0 + w - 1, y0, y0 + h - 1, c);
  }

  function disc(d, cx, cy, r, c) {
    var r2 = r * r;
    for (var y = -r; y <= r; y++)
      for (var x = -r; x <= r; x++)
        if (x * x + y * y <= r2) px(d, cx + x, cy + y, c);
  }

  /* Multiply an existing texel by a factor -- used for grain and bevels. */
  function tint(d, x, y, f) {
    if (x < 0 || y < 0 || x >= N || y >= N) return;
    var i = (y * N + x) | 0;
    d[i] = U.shade(d[i], f);
  }

  function grain(d, seed, amount) {
    var r = U.rng(seed);
    for (var i = 0; i < N * N; i++) {
      var f = 256 + ((r() * 2 - 1) * amount) | 0;
      d[i] = U.shade(d[i], f < 0 ? 0 : f);
    }
  }

  /* --- individual wall textures ------------------------------------- */

  function stone() {
    var d = blank();
    var r = U.rng(11);
    fill(d, U.rgb(104, 100, 94));
    var mortar = U.rgb(58, 56, 52);
    var rows = 4, bh = N / rows;            // 16px tall bricks
    for (var row = 0; row < rows; row++) {
      var y0 = row * bh;
      var off = (row & 1) ? bh : 0;
      for (var x = 0; x < N; x++) {
        for (var y = y0; y < y0 + bh; y++) {
          var base = 96 + (r() * 34) | 0;
          d[y * N + x] = U.rgb(base + 8, base + 4, base - 4);
        }
      }
      // mortar between courses
      hline(d, 0, N - 1, y0, mortar);
      hline(d, 0, N - 1, y0 + 1, U.shade(mortar, 200));
      // vertical joints
      for (var b = 0; b < 2; b++) {
        var jx = ((off + b * bh * 2) % N) | 0;
        vline(d, jx, y0, y0 + bh - 1, mortar);
        vline(d, jx + 1, y0 + 2, y0 + bh - 1, U.shade(mortar, 210));
      }
      // top-edge highlight on each brick
      for (var x2 = 0; x2 < N; x2++) tint(d, x2, y0 + 2, 128 + 60);
    }
    grain(d, 7, 26);
    return d;
  }

  function tech() {
    var d = blank();
    fill(d, U.rgb(58, 66, 78));
    // two stacked panels with bevels
    for (var p = 0; p < 2; p++) {
      var y0 = p * 32 + 3;
      rect(d, 4, y0, 56, 26, U.rgb(72, 82, 96));
      // bevel: light top/left, dark bottom/right
      hline(d, 4, 59, y0, U.rgb(112, 126, 144));
      vline(d, 4, y0, y0 + 25, U.rgb(104, 118, 136));
      hline(d, 4, 59, y0 + 25, U.rgb(34, 40, 50));
      vline(d, 59, y0, y0 + 25, U.rgb(34, 40, 50));
      // vent slots
      for (var s = 0; s < 4; s++) {
        rect(d, 12 + s * 10, y0 + 8, 5, 10, U.rgb(30, 36, 44));
        vline(d, 12 + s * 10, y0 + 8, y0 + 17, U.rgb(20, 24, 30));
      }
      // rivets
      disc(d, 8, y0 + 4, 1, U.rgb(150, 162, 178));
      disc(d, 55, y0 + 4, 1, U.rgb(150, 162, 178));
      disc(d, 8, y0 + 21, 1, U.rgb(150, 162, 178));
      disc(d, 55, y0 + 21, 1, U.rgb(150, 162, 178));
    }
    // glowing strip down the seam
    rect(d, 0, 30, N, 4, U.rgb(24, 28, 34));
    hline(d, 0, N - 1, 31, U.rgb(70, 160, 190));
    hline(d, 0, N - 1, 32, U.rgb(40, 100, 130));
    grain(d, 23, 16);
    return d;
  }

  function bloodMarble() {
    var d = blank();
    var r = U.rng(99);
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        var v = 60 + (r() * 30) | 0;
        d[y * N + x] = U.rgb(v + 40, v - 20 < 0 ? 0 : v - 20, v - 24 < 0 ? 0 : v - 24);
      }
    }
    // marble veins: a few wandering bright lines
    for (var v2 = 0; v2 < 7; v2++) {
      var x2 = (r() * N) | 0;
      for (var y2 = 0; y2 < N; y2++) {
        x2 += ((r() * 3) | 0) - 1;
        if (x2 < 0) x2 += N; if (x2 >= N) x2 -= N;
        px(d, x2, y2, U.rgb(150, 60, 56));
        px(d, x2 + 1, y2, U.rgb(112, 44, 42));
      }
    }
    // dripping highlights along the top
    for (var x3 = 0; x3 < N; x3 += 5) {
      var len = 4 + (r() * 14) | 0;
      for (var y3 = 0; y3 < len; y3++) tint(d, x3 + ((r() * 2) | 0), y3, 300);
    }
    grain(d, 43, 20);
    return d;
  }

  function metal() {
    var d = blank();
    fill(d, U.rgb(52, 74, 56));
    rect(d, 2, 2, 60, 60, U.rgb(64, 92, 68));
    frameRect(d, 2, 2, 60, 60, U.rgb(96, 132, 100));
    frameRect(d, 3, 3, 58, 58, U.rgb(38, 56, 42));
    // cross braces
    rect(d, 6, 30, 52, 4, U.rgb(44, 64, 48));
    hline(d, 6, 57, 30, U.rgb(92, 126, 96));
    // bolt heads in the corners
    var bolts = [[8, 8], [55, 8], [8, 55], [55, 55], [31, 8], [31, 55]];
    for (var i = 0; i < bolts.length; i++) {
      disc(d, bolts[i][0], bolts[i][1], 2, U.rgb(110, 146, 112));
      px(d, bolts[i][0] - 1, bolts[i][1] - 1, U.rgb(160, 196, 160));
    }
    // rust streaks
    var r = U.rng(5);
    for (var s = 0; s < 10; s++) {
      var x = (r() * N) | 0, y0 = (r() * 30) | 0, len = 8 + (r() * 24) | 0;
      for (var y = y0; y < y0 + len && y < N; y++) {
        px(d, x, y, U.rgb(96, 66, 34));
        if (r() > 0.6) px(d, x + 1, y, U.rgb(74, 52, 28));
      }
    }
    grain(d, 17, 18);
    return d;
  }

  function wood() {
    var d = blank();
    var r = U.rng(77);
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        var v = 88 + (Math.sin(x * 0.7 + Math.sin(y * 0.08) * 3) * 10) + r() * 14;
        d[y * N + x] = U.rgb(v | 0, (v * 0.62) | 0, (v * 0.34) | 0);
      }
    }
    for (var p = 0; p <= N; p += 16) vline(d, p % N, 0, N - 1, U.rgb(46, 30, 16));
    grain(d, 3, 14);
    return d;
  }

  function exitSwitch() {
    var d = metal();
    // recessed panel
    rect(d, 16, 14, 32, 36, U.rgb(26, 30, 26));
    frameRect(d, 16, 14, 32, 36, U.rgb(120, 156, 120));
    // big red switch plate
    rect(d, 22, 20, 20, 24, U.rgb(150, 26, 22));
    hline(d, 22, 41, 20, U.rgb(212, 70, 60));
    hline(d, 22, 41, 43, U.rgb(80, 12, 10));
    // chevron pointing down
    for (var i = 0; i < 7; i++) {
      hline(d, 26 + i, 41 - i, 26 + i, U.rgb(240, 200, 60));
    }
    return d;
  }

  function door() {
    var d = blank();
    fill(d, U.rgb(96, 82, 56));
    // vertical ribs
    for (var x = 0; x < N; x++) {
      var f = 210 + Math.floor(Math.sin(x * 0.9) * 45);
      for (var y = 0; y < N; y++) tint(d, x, y, f);
    }
    // heavy top and bottom rails
    rect(d, 0, 0, N, 6, U.rgb(70, 60, 40));
    rect(d, 0, N - 6, N, 6, U.rgb(70, 60, 40));
    hline(d, 0, N - 1, 6, U.rgb(140, 120, 82));
    hline(d, 0, N - 1, N - 7, U.rgb(46, 38, 24));
    // centre seam
    vline(d, 31, 0, N - 1, U.rgb(40, 34, 22));
    vline(d, 32, 0, N - 1, U.rgb(132, 114, 78));
    // hazard stripes across the middle
    for (var i = 0; i < N; i++) {
      var band = ((i + 100) / 6 | 0) & 1;
      var c = band ? U.rgb(200, 170, 40) : U.rgb(40, 36, 26);
      px(d, i, 29, c); px(d, i, 30, c); px(d, i, 33, c); px(d, i, 34, c);
    }
    grain(d, 61, 14);
    return d;
  }

  function redDoor() {
    var d = door();
    for (var i = 0; i < N * N; i++) {
      var c = d[i];
      d[i] = U.rgb(U.clamp(U.red(c) + 60, 0, 255), (U.green(c) * 0.35) | 0, (U.blue(c) * 0.3) | 0);
    }
    // keycard emblem on both leaves
    for (var s = 0; s < 2; s++) {
      var cx = 15 + s * 32;
      rect(d, cx - 5, 16, 10, 14, U.rgb(230, 60, 50));
      frameRect(d, cx - 5, 16, 10, 14, U.rgb(255, 180, 170));
      rect(d, cx - 2, 19, 4, 3, U.rgb(80, 10, 10));
    }
    return d;
  }

  /* --- flats ---------------------------------------------------------- */

  function floorGravel() {
    var d = blank();
    var r = U.rng(1234);
    for (var i = 0; i < N * N; i++) {
      var v = 52 + (r() * 26) | 0;
      d[i] = U.rgb(v, (v * 0.94) | 0, (v * 0.82) | 0);
    }
    // scattered pebbles
    for (var p = 0; p < 90; p++) {
      var x = (r() * N) | 0, y = (r() * N) | 0;
      var c = U.rgb(92, 88, 78);
      px(d, x, y, c); px(d, x + 1, y, c); px(d, x, y + 1, U.rgb(38, 36, 32));
    }
    // grid grout so motion reads clearly
    for (var g = 0; g < N; g += 16) { hline(d, 0, N - 1, g, U.rgb(36, 34, 30)); vline(d, g, 0, N - 1, U.rgb(36, 34, 30)); }
    return d;
  }

  function floorBlood() {
    var d = blank();
    var r = U.rng(555);
    for (var i = 0; i < N * N; i++) {
      var v = 40 + (r() * 22) | 0;
      d[i] = U.rgb(v + 46, (v * 0.3) | 0, (v * 0.26) | 0);
    }
    for (var p = 0; p < 40; p++) {
      var x = (r() * N) | 0, y = (r() * N) | 0;
      disc(d, x, y, 1 + ((r() * 2) | 0), U.rgb(112, 18, 16));
    }
    return d;
  }

  function ceilTech() {
    var d = blank();
    var r = U.rng(808);
    for (var i = 0; i < N * N; i++) {
      var v = 34 + (r() * 12) | 0;
      d[i] = U.rgb(v, v + 2, v + 6);
    }
    // ceiling girders + light panels
    rect(d, 0, 0, N, 6, U.rgb(26, 28, 34));
    rect(d, 0, 32, N, 6, U.rgb(26, 28, 34));
    rect(d, 20, 14, 24, 12, U.rgb(96, 96, 84));
    frameRect(d, 20, 14, 24, 12, U.rgb(140, 140, 120));
    rect(d, 20, 46, 24, 12, U.rgb(96, 96, 84));
    frameRect(d, 20, 46, 24, 12, U.rgb(140, 140, 120));
    return d;
  }

  function build() {
    walls[0] = null;               // 0 means "no wall"
    walls[1] = stone();
    walls[2] = tech();
    walls[3] = bloodMarble();
    walls[4] = metal();
    walls[5] = wood();
    walls[6] = exitSwitch();
    walls[7] = door();
    walls[8] = redDoor();

    floors[0] = floorGravel();
    floors[1] = floorBlood();
    floors[2] = ceilTech();
  }

  return {
    build: build,
    wall: function (i) { return walls[i]; },
    floor: function (i) { return floors[i]; },
    N: N,
    // exported so sprites.js can reuse the primitive drawing helpers
    _px: px, _rect: rect, _disc: disc, _frameRect: frameRect
  };
})();
