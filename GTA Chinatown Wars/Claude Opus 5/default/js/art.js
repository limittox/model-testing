'use strict';
/* ------------------------------------------------------------------
   art.js — every pixel in SALTGRAVE is drawn here at boot time.
   No image files, no fonts to download: a 2D canvas paints each 256px
   material tile, which is then uploaded as one layer of a GL array
   texture. Style target: flat saturated ink-and-paper, heavy contrast,
   very little gradient noise.
------------------------------------------------------------------ */

const TEXSIZE = 256;

const TEX = {
  BLANK: 0, ASPHALT: 1, ASPHALT2: 2, CONCRETE: 3, CURB: 4,
  BRICK_RED: 5, BRICK_TAN: 6, STUCCO: 7, PANEL: 8, TILEWALL: 9,
  WIN_OFFICE: 10, WIN_APT: 11, WIN_LIT: 12, CORRUGATED: 13, ROOFTOP: 14,
  GRASS: 15, PLAZA: 16, DIRT: 17, WOOD: 18, METAL: 19,
  FOLIAGE: 20, CARPAINT: 21, GLASS: 22, RUST: 23, AWNING: 24,
  SIGN0: 25 // …SIGN0+11
};
const SIGN_COUNT = 12;
const TEX_LAYERS = TEX.SIGN0 + SIGN_COUNT;

const Art = {
  layers: null,

  build() {
    const c = document.createElement('canvas');
    c.width = c.height = TEXSIZE;
    const g = c.getContext('2d');
    const out = new Array(TEX_LAYERS);

    const grab = () => new Uint8Array(g.getImageData(0, 0, TEXSIZE, TEXSIZE).data.buffer.slice(0));
    const clear = (col) => { g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.fillStyle = col; g.fillRect(0, 0, TEXSIZE, TEXSIZE); };

    // speckle: cheap per-pixel grain that still tiles (random == tileable)
    const grain = (amount, dark, light) => {
      const img = g.getImageData(0, 0, TEXSIZE, TEXSIZE), d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() * 2 - 1) * amount;
        const k = n < 0 ? (dark === undefined ? 1 : dark) : (light === undefined ? 1 : light);
        d[i] = clamp(d[i] + n * k, 0, 255);
        d[i + 1] = clamp(d[i + 1] + n * k, 0, 255);
        d[i + 2] = clamp(d[i + 2] + n * k, 0, 255);
      }
      g.putImageData(img, 0, 0);
    };
    const splotch = (n, col, rMin, rMax, alpha) => {
      g.globalAlpha = alpha; g.fillStyle = col;
      for (let i = 0; i < n; i++) {
        g.beginPath();
        g.arc(rand(0, TEXSIZE), rand(0, TEXSIZE), rand(rMin, rMax), 0, TAU);
        g.fill();
      }
      g.globalAlpha = 1;
    };

    /* ---------------- ground ---------------- */
    clear('#3a3f47'); grain(16); splotch(26, '#2f343b', 6, 26, .35); splotch(14, '#464c55', 5, 18, .25);
    out[TEX.ASPHALT] = grab();

    clear('#33383f'); grain(20); splotch(40, '#2a2e35', 4, 20, .4);
    g.strokeStyle = '#282c32'; g.lineWidth = 2;
    for (let i = 0; i < 7; i++) { // cracks
      g.beginPath(); let x = rand(0, 256), y = rand(0, 256);
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += rand(-40, 40); y += rand(-40, 40); g.lineTo(x, y); }
      g.stroke();
    }
    out[TEX.ASPHALT2] = grab();

    clear('#7e858e'); grain(12);
    g.strokeStyle = 'rgba(44,49,56,.6)'; g.lineWidth = 3;
    for (let i = 0; i <= 4; i++) { // paving joints, 4 slabs per tile
      const p = i * 64;
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 256); g.moveTo(0, p); g.lineTo(256, p); g.stroke();
    }
    splotch(18, '#6f767e', 6, 22, .3);
    out[TEX.CONCRETE] = grab();

    clear('#a49d90'); grain(9); g.fillStyle = 'rgba(60,57,52,.45)'; g.fillRect(0, 236, 256, 20);
    out[TEX.CURB] = grab();

    clear('#4a7c3f'); grain(22, 1.3, .7); splotch(60, '#3e6c36', 6, 26, .5); splotch(30, '#589149', 5, 18, .4);
    out[TEX.GRASS] = grab();

    clear('#968b78'); grain(10);
    g.strokeStyle = 'rgba(80,73,62,.6)'; g.lineWidth = 2;
    for (let i = 0; i <= 8; i++) { const p = i * 32; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 256); g.moveTo(0, p); g.lineTo(256, p); g.stroke(); }
    out[TEX.PLAZA] = grab();

    clear('#7a6248'); grain(18); splotch(40, '#6b5540', 8, 30, .4);
    out[TEX.DIRT] = grab();

    /* ---------------- walls ---------------- */
    const brick = (mortar, a, b) => {
      clear(mortar);
      const bw = 64, bh = 32;
      for (let row = 0; row < 8; row++) {
        const off = (row % 2) * bw * .5;
        for (let col = -1; col < 5; col++) {
          const x = col * bw + off + 2, y = row * bh + 2;
          g.fillStyle = chance(.5) ? a : b;
          g.globalAlpha = rand(.82, 1);
          g.fillRect(x, y, bw - 4, bh - 4);
        }
      }
      g.globalAlpha = 1; grain(11);
    };
    brick('#5d5049', '#9c4b39', '#8a4030'); out[TEX.BRICK_RED] = grab();
    brick('#6b6255', '#c2a077', '#b08f68'); out[TEX.BRICK_TAN] = grab();

    clear('#cfc4ae'); grain(14); splotch(30, '#bdb29c', 10, 40, .35);
    g.fillStyle = 'rgba(120,110,95,.25)';
    for (let i = 0; i < 4; i++) g.fillRect(0, i * 64 + 60, 256, 3);
    out[TEX.STUCCO] = grab();

    clear('#8d99a8');
    g.fillStyle = 'rgba(40,48,58,.5)'; g.lineWidth = 0;
    for (let i = 0; i <= 4; i++) { g.fillRect(i * 64 - 2, 0, 4, 256); g.fillRect(0, i * 64 - 2, 256, 4); }
    g.fillStyle = 'rgba(255,255,255,.10)';
    for (let i = 0; i < 4; i++) g.fillRect(i * 64 + 4, 4, 56, 6);
    grain(7);
    out[TEX.PANEL] = grab();

    clear('#2f6f74');
    for (let r = 0; r < 16; r++) for (let cN = 0; cN < 16; cN++) {
      g.fillStyle = chance(.5) ? '#35787e' : '#2a656a';
      g.globalAlpha = rand(.75, 1);
      g.fillRect(cN * 16 + 1, r * 16 + 1, 14, 14);
    }
    g.globalAlpha = 1; grain(8);
    out[TEX.TILEWALL] = grab();

    clear('#6e737b');
    for (let i = 0; i < 32; i++) {
      g.fillStyle = i % 2 ? '#7b8189' : '#5f646b';
      g.fillRect(i * 8, 0, 8, 256);
    }
    g.fillStyle = 'rgba(255,255,255,.12)';
    for (let i = 0; i < 32; i++) g.fillRect(i * 8 + 1, 0, 2, 256);
    grain(6);
    out[TEX.CORRUGATED] = grab();

    clear('#57493c'); grain(20); splotch(50, '#4a3e33', 8, 30, .4);
    g.fillStyle = 'rgba(30,26,22,.5)';
    for (let i = 0; i < 3; i++) g.fillRect(0, 80 * i + 30, 256, 5);
    out[TEX.ROOFTOP] = grab();

    clear('#7b5a3a');
    for (let i = 0; i < 8; i++) {
      g.fillStyle = chance(.5) ? '#8a663f' : '#6d4f33';
      g.fillRect(0, i * 32, 256, 30);
      g.strokeStyle = 'rgba(45,32,20,.6)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, i * 32 + 31); g.lineTo(256, i * 32 + 31); g.stroke();
    }
    grain(14);
    out[TEX.WOOD] = grab();

    clear('#8b9199'); grain(10); splotch(20, '#7d838a', 10, 34, .3);
    out[TEX.METAL] = grab();

    clear('#8a4a2a'); grain(24); splotch(50, '#6d3a20', 8, 34, .5); splotch(30, '#a9613a', 6, 22, .4);
    out[TEX.RUST] = grab();

    clear('#ffffff'); out[TEX.BLANK] = grab();

    clear('#d8d2c4'); grain(6);
    out[TEX.CARPAINT] = grab();

    clear('#1d2b3a');
    g.fillStyle = 'rgba(150,200,230,.20)';
    g.beginPath(); g.moveTo(0, 200); g.lineTo(256, 40); g.lineTo(256, 90); g.lineTo(0, 250); g.fill();
    out[TEX.GLASS] = grab();

    clear('#2b6b4a');
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#e8e2d2' : '#c0392b'; g.fillRect(i * 32, 0, 32, 256); }
    out[TEX.AWNING] = grab();

    clear('#264d24'); grain(26, 1.4, .8);
    splotch(90, '#2f5d2b', 8, 26, .6); splotch(60, '#3d7433', 6, 18, .5); splotch(30, '#1c3b1c', 8, 22, .4);
    out[TEX.FOLIAGE] = grab();

    /* ---------------- window walls ---------------- */
    const windows = (wallCol, frameCol, glassCols, cols, rows, lit) => {
      clear(wallCol);
      grain(8);
      const cw = 256 / cols, rh = 256 / rows;
      for (let r = 0; r < rows; r++) for (let cN = 0; cN < cols; cN++) {
        const x = cN * cw, y = r * rh;
        g.fillStyle = frameCol;
        g.fillRect(x + cw * .12, y + rh * .12, cw * .76, rh * .70);
        const on = lit && chance(.42);
        g.fillStyle = on ? pick(['#ffd98a', '#ffb45e', '#e8f0a0', '#9fd8ff']) : pick(glassCols);
        g.fillRect(x + cw * .18, y + rh * .18, cw * .64, rh * .58);
        if (!on) { // glass highlight streak
          g.globalAlpha = .10; g.fillStyle = '#cfe6ff';
          g.beginPath();
          g.moveTo(x + cw * .18, y + rh * .62); g.lineTo(x + cw * .82, y + rh * .22);
          g.lineTo(x + cw * .82, y + rh * .40); g.lineTo(x + cw * .18, y + rh * .76);
          g.fill(); g.globalAlpha = 1;
        }
        // sill
        g.fillStyle = 'rgba(0,0,0,.30)';
        g.fillRect(x + cw * .10, y + rh * .82, cw * .80, rh * .06);
      }
    };
    windows('#5a6472', '#2c333d', ['#243040', '#1b2532', '#2b3a4c'], 4, 4, false); out[TEX.WIN_OFFICE] = grab();
    windows('#9c7f63', '#4a3b2e', ['#2a2f38', '#20252d', '#333a44'], 3, 3, false); out[TEX.WIN_APT] = grab();
    windows('#4c4658', '#241f2e', ['#221d2c'], 4, 4, true); out[TEX.WIN_LIT] = grab();

    /* ---------------- storefront signage ---------------- */
    const SIGNS = [
      ['GOLDEN CRANE', '#c0392b', '#ffd83d'],
      ['NOODLE 88', '#1f6f4a', '#ffe9a8'],
      ['PAWN & LOAN', '#2c3e70', '#ffd83d'],
      ['SABLE AUTOBODY', '#20242c', '#ff8a3d'],
      ['WASH-O-RAMA', '#0f7f8f', '#f4f7ff'],
      ['OPEN 24 HRS', '#7a1f4f', '#ffb8e0'],
      ['SALT & SMOKE', '#8a3a12', '#ffe0a0'],
      ['TIKI ROOM', '#1b7a5a', '#ffd83d'],
      ['VERRANO DRUGS', '#b3252b', '#ffffff'],
      ['ARCADE', '#3b1f6f', '#7ef0ff'],
      ['FISH MARKET', '#12556f', '#a8f0ff'],
      ['HOTEL RIALTO', '#232833', '#ff5f5f']
    ];
    for (let i = 0; i < SIGN_COUNT; i++) {
      const [txt, bg, fg] = SIGNS[i];
      clear(bg);
      // border ticks
      g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 0, 256, 14); g.fillRect(0, 242, 256, 14);
      g.fillStyle = fg; g.globalAlpha = .85;
      for (let k = 0; k < 12; k++) { g.fillRect(k * 22 + 6, 4, 8, 6); g.fillRect(k * 22 + 6, 246, 8, 6); }
      g.globalAlpha = 1;
      // text, squeezed to fit
      g.textAlign = 'center'; g.textBaseline = 'middle';
      let size = 54;
      g.font = '900 ' + size + 'px "Trebuchet MS", sans-serif';
      while (g.measureText(txt).width > 226 && size > 14) {
        size -= 2; g.font = '900 ' + size + 'px "Trebuchet MS", sans-serif';
      }
      g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,.65)';
      g.strokeText(txt, 128, 130);
      g.fillStyle = fg; g.fillText(txt, 128, 128);
      grain(6);
      out[TEX.SIGN0 + i] = grab();
    }

    this.layers = out;
    return out;
  }
};
