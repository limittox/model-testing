'use strict';

/* Bitmap font, status bar, automap and the full-screen text pages.
   Everything draws into the same framebuffer as the world. */
var HUD = (function () {

  /* ---------- 5x7 bitmap font ---------------------------------------- */

  var GLYPHS = {
    '0': '01110,10001,10011,10101,11001,10001,01110',
    '1': '00100,01100,00100,00100,00100,00100,01110',
    '2': '01110,10001,00001,00010,00100,01000,11111',
    '3': '11111,00010,00100,00010,00001,10001,01110',
    '4': '00010,00110,01010,10010,11111,00010,00010',
    '5': '11111,10000,11110,00001,00001,10001,01110',
    '6': '00110,01000,10000,11110,10001,10001,01110',
    '7': '11111,00001,00010,00100,01000,01000,01000',
    '8': '01110,10001,10001,01110,10001,10001,01110',
    '9': '01110,10001,10001,01111,00001,00010,01100',
    'A': '01110,10001,10001,11111,10001,10001,10001',
    'B': '11110,10001,10001,11110,10001,10001,11110',
    'C': '01110,10001,10000,10000,10000,10001,01110',
    'D': '11100,10010,10001,10001,10001,10010,11100',
    'E': '11111,10000,10000,11110,10000,10000,11111',
    'F': '11111,10000,10000,11110,10000,10000,10000',
    'G': '01110,10001,10000,10111,10001,10001,01111',
    'H': '10001,10001,10001,11111,10001,10001,10001',
    'I': '01110,00100,00100,00100,00100,00100,01110',
    'J': '00111,00010,00010,00010,00010,10010,01100',
    'K': '10001,10010,10100,11000,10100,10010,10001',
    'L': '10000,10000,10000,10000,10000,10000,11111',
    'M': '10001,11011,10101,10101,10001,10001,10001',
    'N': '10001,11001,10101,10011,10001,10001,10001',
    'O': '01110,10001,10001,10001,10001,10001,01110',
    'P': '11110,10001,10001,11110,10000,10000,10000',
    'Q': '01110,10001,10001,10001,10101,10010,01101',
    'R': '11110,10001,10001,11110,10100,10010,10001',
    'S': '01111,10000,10000,01110,00001,00001,11110',
    'T': '11111,00100,00100,00100,00100,00100,00100',
    'U': '10001,10001,10001,10001,10001,10001,01110',
    'V': '10001,10001,10001,10001,10001,01010,00100',
    'W': '10001,10001,10001,10101,10101,11011,10001',
    'X': '10001,10001,01010,00100,01010,10001,10001',
    'Y': '10001,10001,01010,00100,00100,00100,00100',
    'Z': '11111,00001,00010,00100,01000,10000,11111',
    '.': '00000,00000,00000,00000,00000,01100,01100',
    ',': '00000,00000,00000,00000,01100,01100,11000',
    ':': '00000,01100,01100,00000,01100,01100,00000',
    '-': '00000,00000,00000,11111,00000,00000,00000',
    '+': '00000,00100,00100,11111,00100,00100,00000',
    '/': '00001,00010,00010,00100,01000,01000,10000',
    '%': '11001,11010,00010,00100,01000,01011,10011',
    '!': '00100,00100,00100,00100,00100,00000,00100',
    '?': '01110,10001,00001,00110,00100,00000,00100',
    "'": '00100,00100,00000,00000,00000,00000,00000',
    '(': '00010,00100,01000,01000,01000,00100,00010',
    ')': '01000,00100,00010,00010,00010,00100,01000',
    '*': '00000,10101,01110,11111,01110,10101,00000',
    '<': '00010,00100,01000,10000,01000,00100,00010',
    '>': '01000,00100,00010,00001,00010,00100,01000',
    '=': '00000,00000,11111,00000,11111,00000,00000'
  };

  var glyphRows = {};
  for (var k in GLYPHS) glyphRows[k] = GLYPHS[k].split(',');

  var GW = 5, GH = 7;

  function charWidth(s) { return GW * s + s; }

  function textWidth(str, s) {
    return str.length * charWidth(s) - s;
  }

  function text(str, x, y, color, s, shadow) {
    s = s || 1;
    str = String(str).toUpperCase();
    var cx = x;
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      if (ch === ' ') { cx += charWidth(s); continue; }
      var rows = glyphRows[ch];
      if (!rows) { cx += charWidth(s); continue; }
      for (var ry = 0; ry < GH; ry++) {
        var row = rows[ry];
        for (var rx = 0; rx < GW; rx++) {
          if (row[rx] !== '1') continue;
          if (shadow) R.fillRect(cx + rx * s + s, y + ry * s + s, s, s, shadow);
          R.fillRect(cx + rx * s, y + ry * s, s, s, color);
        }
      }
      cx += charWidth(s);
    }
    return cx;
  }

  function textCentered(str, y, color, s, shadow) {
    text(str, ((CFG.W - textWidth(String(str), s)) / 2) | 0, y, color, s, shadow);
  }

  /* ---------- palette -------------------------------------------------- */

  var C = {
    bar: U.rgb(58, 52, 44),
    barLit: U.rgb(96, 88, 74),
    barDark: U.rgb(30, 26, 22),
    label: U.rgb(146, 132, 104),
    num: U.rgb(226, 60, 44),
    numDim: U.rgb(90, 30, 26),
    good: U.rgb(90, 210, 110),
    white: U.rgb(232, 226, 210),
    shadow: U.rgb(12, 10, 8)
  };

  /* ---------- messages -------------------------------------------------- */

  var msg = '', msgTime = 0;

  function message(s) { msg = s; msgTime = 3.2; }

  function updateMessages(dt) { if (msgTime > 0) msgTime -= dt; }

  function drawMessage() {
    if (msgTime <= 0 || !msg) return;
    var a = U.clamp(msgTime * 2, 0, 1);
    var c = U.shade(C.white, (a * 256) | 0);
    text(msg, 6, 6, c, 1, C.shadow);
  }

  /* ---------- status bar ------------------------------------------------ */

  function panel(x, y, w, h) {
    R.fillRect(x, y, w, h, C.bar);
    R.fillRect(x, y, w, 1, C.barLit);
    R.fillRect(x, y + h - 1, w, 1, C.barDark);
    R.fillRect(x, y, 1, h, C.barLit);
    R.fillRect(x + w - 1, y, 1, h, C.barDark);
  }

  function bigNumber(value, rightX, y, color) {
    var s = String(value);
    var w = textWidth(s, 3);
    text(s, rightX - w, y, color, 3, C.shadow);
  }

  function drawStatusBar(p, game) {
    var y0 = CFG.VIEW_H;
    R.fillRect(0, y0, CFG.W, CFG.HUD_H, C.bar);
    R.fillRect(0, y0, CFG.W, 2, U.rgb(120, 108, 88));
    R.fillRect(0, y0 + 2, CFG.W, 1, C.barDark);

    // rivets along the top edge
    for (var rx = 6; rx < CFG.W; rx += 24) {
      R.fillRect(rx, y0 + 4, 2, 2, U.rgb(140, 128, 104));
    }

    /* AMMO */
    panel(4, y0 + 8, 62, 32);
    text('AMMO', 8, y0 + 11, C.label, 1);
    var wpn = p.weapon;
    var ammoTxt = wpn.ammoType ? p.ammo[wpn.ammoType] : '--';
    bigNumber(ammoTxt, 62, y0 + 19, wpn.ammoType && p.ammo[wpn.ammoType] === 0 ? C.numDim : C.num);

    /* HEALTH */
    panel(70, y0 + 8, 74, 32);
    text('HEALTH', 74, y0 + 11, C.label, 1);
    bigNumber(Math.max(0, Math.ceil(p.health)) + '%', 140, y0 + 19,
              p.health > 30 ? C.num : U.rgb(255, 120, 60));

    /* ARMS */
    panel(148, y0 + 8, 62, 32);
    text('ARMS', 152, y0 + 11, C.label, 1);
    for (var i = 0; i < 3; i++) {
      var have = p.hasWeapon[i + 1];
      var sel = p.weaponIndex === i + 1;
      text(String(i + 1), 154 + i * 18, y0 + 22, sel ? U.rgb(255, 210, 90) : (have ? C.num : C.numDim), 2);
    }

    /* FACE */
    var fx = 216, fy = y0 + 6;
    R.fillRect(fx - 2, fy - 2, 32, 36, C.barDark);
    R.blit(faceSprite(p, game), fx, fy);

    /* ARMOR */
    panel(252, y0 + 8, 74, 32);
    text('ARMOR', 256, y0 + 11, C.label, 1);
    bigNumber(Math.max(0, Math.ceil(p.armor)) + '%', 322, y0 + 19, C.num);

    /* KEYS */
    panel(330, y0 + 8, 34, 32);
    text('KEY', 333, y0 + 11, C.label, 1);
    if (p.keys.red) R.blit(SPR.lib.items.redkey, 341, y0 + 20);
    else R.fillRect(342, y0 + 22, 10, 14, U.rgb(44, 38, 32));

    /* KILLS / ITEMS */
    panel(368, y0 + 8, 108, 32);
    text('KILLS ' + game.kills + '/' + game.totalKills, 373, y0 + 14, C.label, 1);
    text('ITEMS ' + game.items + '/' + game.totalItems, 373, y0 + 26, C.label, 1);
  }

  var faceTimer = 0, faceLook = 0;

  function updateFace(dt) {
    faceTimer -= dt;
    if (faceTimer <= 0) {
      faceTimer = 0.7 + Math.random() * 1.4;
      faceLook = U.randInt(-1, 1);
    }
  }

  function faceSprite(p, game) {
    if (p.health <= 0) return SPR.lib.faceDead;
    var bucket = U.clamp(Math.ceil(p.health / 25), 0, 4);
    var hurt = p.painFlash > 0.12;
    return SPR.lib.faces[bucket][faceLook + 1][hurt ? 1 : 0];
  }

  /* ---------- crosshair -------------------------------------------------- */

  function drawCrosshair() {
    var cx = CFG.W >> 1, cy = (CFG.VIEW_H >> 1) | 0;
    var c = U.rgb(210, 210, 200);
    R.fillRect(cx - 5, cy, 3, 1, c);
    R.fillRect(cx + 3, cy, 3, 1, c);
    R.fillRect(cx, cy - 5, 1, 3, c);
    R.fillRect(cx, cy + 3, 1, 3, c);
    R.pixel(cx, cy, U.rgb(255, 90, 60));
  }

  /* ---------- automap ---------------------------------------------------- */

  function drawAutomap(p, ents) {
    R.blendRect(0, 0, CFG.W, CFG.VIEW_H, U.rgb(4, 4, 6), 225);
    var cell = 7;
    var ox = (CFG.W / 2 - p.x * cell) | 0;
    var oy = (CFG.VIEW_H / 2 - p.y * cell) | 0;

    for (var y = 0; y < LEVEL.H; y++) {
      for (var x = 0; x < LEVEL.W; x++) {
        var t = LEVEL.tileAt(x, y);
        if (t === 0) continue;
        var sx = ox + x * cell, sy = oy + y * cell;
        if (sx < -cell || sy < -cell || sx > CFG.W || sy > CFG.VIEW_H) continue;
        var col = U.rgb(120, 108, 88);
        var d = LEVEL.doorAt(x, y);
        if (d) col = d.locked ? U.rgb(220, 60, 50) : U.rgb(200, 170, 60);
        else if (LEVEL.isExitAt(x, y)) col = U.rgb(80, 230, 120);
        else if (t === 3) col = U.rgb(150, 70, 66);
        else if (t === 2) col = U.rgb(90, 130, 160);
        else if (t === 4) col = U.rgb(90, 150, 100);
        R.fillRect(sx, sy, cell - 1, cell - 1, col);
      }
    }

    for (var i = 0; i < ents.length; i++) {
      var e = ents[i];
      if (e.dead && e.kind === 'enemy') continue;
      var c = null;
      if (e.kind === 'enemy') c = U.rgb(230, 60, 40);
      else if (e.kind === 'item') c = U.rgb(80, 200, 220);
      if (!c) continue;
      R.fillRect(ox + e.x * cell - 1, oy + e.y * cell - 1, 3, 3, c);
    }

    // player arrow
    var px = CFG.W / 2, py = CFG.VIEW_H / 2;
    var ax = Math.cos(p.ang), ay = Math.sin(p.ang);
    for (var t2 = 0; t2 < 10; t2++) {
      R.pixel(px + ax * t2, py + ay * t2, U.rgb(255, 255, 120));
    }
    R.fillRect(px - 2, py - 2, 4, 4, U.rgb(255, 240, 90));

    // sits at the bottom of the view so it never collides with the message line
    textCentered('AUTOMAP  -  TAB TO CLOSE', CFG.VIEW_H - 14, C.white, 1, C.shadow);
  }

  /* ---------- full screen pages ------------------------------------------ */

  function drawBanner(lines, colors, scales, topY) {
    var y = topY;
    for (var i = 0; i < lines.length; i++) {
      textCentered(lines[i], y, colors[i], scales[i], C.shadow);
      y += scales[i] * GH + 8;
    }
    return y;
  }

  function drawTitle(t) {
    R.clear(U.rgb(10, 8, 10));
    // smouldering backdrop
    for (var y = 0; y < CFG.H; y++) {
      var f = 1 - y / CFG.H;
      var c = U.rgb((30 * f) | 0, (10 * f) | 0, (8 * f) | 0);
      R.fillRect(0, y, CFG.W, 1, c);
    }
    for (var i = 0; i < 60; i++) {
      var ex = (Math.sin(i * 12.9898 + t * 0.4) * 0.5 + 0.5) * CFG.W;
      var ey = CFG.H - ((t * 26 + i * 43) % CFG.H);
      R.fillRect(ex, ey, 1, 2, U.rgb(180, 70 + (i % 60), 20));
    }

    textCentered('DOOM', 34, U.rgb(230, 40, 30), 8, U.rgb(70, 8, 6));
    textCentered('KNEE-DEEP IN THE BROWSER', 100, U.rgb(210, 170, 90), 2, C.shadow);

    var blink = (t % 1.2) < 0.75;
    if (blink) textCentered('CLICK TO PLAY', 138, U.rgb(255, 230, 150), 2, C.shadow);

    var y2 = 174;
    var lines = [
      'WASD MOVE      MOUSE LOOK      SHIFT RUN',
      'CLICK FIRE     1 2 3 WEAPONS   E USE DOOR',
      'TAB MAP        M MUTE          ESC PAUSE'
    ];
    for (var l = 0; l < lines.length; l++) {
      textCentered(lines[l], y2 + l * 14, U.rgb(150, 140, 120), 1, C.shadow);
    }
    textCentered('FIND THE RED KEYCARD, THEN HIT THE EXIT SWITCH', 232, U.rgb(120, 180, 130), 1, C.shadow);
    textCentered('CLAUDE OPUS 5  /  DEFAULT', 264, U.rgb(80, 74, 66), 1);
  }

  function drawPause() {
    R.blendRect(0, 0, CFG.W, CFG.VIEW_H, U.rgb(0, 0, 0), 150);
    textCentered('PAUSED', 96, U.rgb(240, 200, 90), 5, C.shadow);
    textCentered('CLICK OR PRESS ENTER TO RESUME', 150, U.rgb(200, 190, 170), 1, C.shadow);
    textCentered('R RESTART LEVEL      M ' + (Sound.isMuted() ? 'UNMUTE' : 'MUTE'),
                 168, U.rgb(140, 132, 116), 1, C.shadow);
  }

  function drawDead(game) {
    R.blendRect(0, 0, CFG.W, CFG.VIEW_H, U.rgb(120, 0, 0), 130);
    textCentered('YOU DIED', 90, U.rgb(255, 60, 40), 5, C.shadow);
    textCentered('KILLS ' + game.kills + ' / ' + game.totalKills, 142, U.rgb(220, 200, 170), 2, C.shadow);
    var blink = (game.time % 1.2) < 0.8;
    if (blink) textCentered('PRESS R TO TRY AGAIN', 176, U.rgb(255, 230, 150), 2, C.shadow);
  }

  function drawWin(game) {
    R.blendRect(0, 0, CFG.W, CFG.VIEW_H, U.rgb(0, 20, 6), 150);
    textCentered('LEVEL COMPLETE', 60, U.rgb(90, 240, 130), 4, C.shadow);
    var mins = Math.floor(game.clearTime / 60), secs = Math.floor(game.clearTime % 60);
    var lines = [
      'TIME    ' + mins + ':' + (secs < 10 ? '0' : '') + secs,
      'KILLS   ' + game.kills + ' / ' + game.totalKills,
      'ITEMS   ' + game.items + ' / ' + game.totalItems,
      'SECRET  ' + (game.foundSecret ? 'FOUND' : 'MISSED')
    ];
    for (var i = 0; i < lines.length; i++) {
      textCentered(lines[i], 112 + i * 22, U.rgb(220, 210, 180), 2, C.shadow);
    }
    var blink = (game.time % 1.2) < 0.8;
    if (blink) textCentered('PRESS R TO PLAY AGAIN', 214, U.rgb(255, 230, 150), 2, C.shadow);
  }

  function drawLoading(pct) {
    R.clear(U.rgb(8, 6, 8));
    textCentered('GENERATING TEXTURES', 130, U.rgb(200, 60, 40), 2);
    R.fillRect(120, 160, 240, 10, U.rgb(40, 34, 30));
    R.fillRect(122, 162, (236 * pct) | 0, 6, U.rgb(210, 60, 40));
  }

  return {
    text: text, textCentered: textCentered, textWidth: textWidth,
    message: message, updateMessages: updateMessages, drawMessage: drawMessage,
    drawStatusBar: drawStatusBar, drawCrosshair: drawCrosshair,
    drawAutomap: drawAutomap, updateFace: updateFace,
    drawTitle: drawTitle, drawPause: drawPause, drawDead: drawDead,
    drawWin: drawWin, drawLoading: drawLoading,
    colors: C
  };
})();
