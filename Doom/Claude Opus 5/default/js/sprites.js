'use strict';

/* All sprite art -- monsters, pickups, projectiles and the first-person
   weapons -- is drawn procedurally into Uint32Array bitmaps at boot.
   A texel of 0 is fully transparent. */
var SPR = (function () {

  /* ---------- tiny drawing surface ---------------------------------- */

  function Sprite(w, h) {
    this.w = w; this.h = h;
    this.data = new Uint32Array(w * h);
  }

  Sprite.prototype.px = function (x, y, c) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data[y * this.w + x] = c;
  };

  Sprite.prototype.get = function (x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[y * this.w + x];
  };

  Sprite.prototype.rect = function (x0, y0, w, h, c) {
    for (var y = y0; y < y0 + h; y++)
      for (var x = x0; x < x0 + w; x++) this.px(x, y, c);
  };

  Sprite.prototype.hline = function (x0, x1, y, c) {
    for (var x = x0; x <= x1; x++) this.px(x, y, c);
  };

  Sprite.prototype.vline = function (x, y0, y1, c) {
    for (var y = y0; y <= y1; y++) this.px(x, y, c);
  };

  /* Filled axis-aligned ellipse. */
  Sprite.prototype.ellipse = function (cx, cy, rx, ry, c) {
    if (rx <= 0 || ry <= 0) return;
    for (var y = -ry; y <= ry; y++) {
      var s = 1 - (y * y) / (ry * ry);
      if (s <= 0) continue;
      var xw = Math.sqrt(s) * rx;
      for (var x = -xw; x <= xw; x++) this.px(cx + x, cy + y, c);
    }
  };

  Sprite.prototype.frame = function (x0, y0, w, h, c) {
    this.hline(x0, x0 + w - 1, y0, c);
    this.hline(x0, x0 + w - 1, y0 + h - 1, c);
    this.vline(x0, y0, y0 + h - 1, c);
    this.vline(x0 + w - 1, y0, y0 + h - 1, c);
  };

  /* Draw both x and its mirror about cx -- keeps monsters symmetric. */
  Sprite.prototype.mrect = function (cx, dx, y0, w, h, c) {
    this.rect(cx + dx, y0, w, h, c);
    this.rect(cx - dx - w + 1, y0, w, h, c);
  };

  Sprite.prototype.mellipse = function (cx, dx, cy, rx, ry, c) {
    this.ellipse(cx + dx, cy, rx, ry, c);
    this.ellipse(cx - dx, cy, rx, ry, c);
  };

  /* ---------- sprite transforms -------------------------------------- */

  function tinted(sp, c, t) {
    var out = new Sprite(sp.w, sp.h);
    for (var i = 0; i < sp.data.length; i++) {
      var s = sp.data[i];
      out.data[i] = s === 0 ? 0 : U.mix(s, c, t);
    }
    return out;
  }

  function darkened(sp, f) {
    var out = new Sprite(sp.w, sp.h);
    for (var i = 0; i < sp.data.length; i++) {
      var s = sp.data[i];
      out.data[i] = s === 0 ? 0 : U.shade(s, f);
    }
    return out;
  }

  /* Vertically squash toward the floor -- the basis of the death animation. */
  function squashed(sp, keep, spread) {
    var out = new Sprite(sp.w, sp.h);
    var newH = Math.max(1, Math.round(sp.h * keep));
    var y0 = sp.h - newH;
    for (var y = 0; y < newH; y++) {
      var sy = Math.min(sp.h - 1, (y / keep) | 0);
      for (var x = 0; x < sp.w; x++) {
        var sx = Math.round((x - sp.w / 2) / (1 + spread) + sp.w / 2);
        var c = sp.get(sx, sy);
        if (c) out.px(x, y0 + y, c);
      }
    }
    return out;
  }

  /* ---------- monsters ------------------------------------------------ */

  /* One shared biped builder covers the zombie, the imp and the baron.
     frame: 0/1 = walk cycle, 2 = attack pose. */
  function biped(o, frame) {
    var w = o.w, h = o.h;
    var sp = new Sprite(w, h);
    var cx = (w / 2) | 0;

    var headH = Math.round(h * 0.20);
    var headW = Math.round(w * 0.34);
    var torsoTop = 2 + headH;
    var torsoH = Math.round(h * 0.38);
    var legTop = torsoTop + torsoH;
    var legH = h - legTop - 1;
    var bodyHW = Math.round(o.bodyW / 2);

    var swing = frame === 1 ? 1 : 0;

    /* legs */
    var legW = Math.max(4, Math.round(w * 0.16));
    var legGap = Math.round(bodyHW * 0.45);
    sp.rect(cx + legGap - 1, legTop, legW, legH - (swing ? 2 : 0), o.legDark);
    sp.rect(cx - legGap - legW + 1, legTop + (swing ? 2 : 0), legW, legH - (swing ? 0 : 2), o.leg);
    // feet / hooves
    sp.rect(cx + legGap - 2, h - 3, legW + 2, 3, o.foot);
    sp.rect(cx - legGap - legW, h - 3 - (swing ? 1 : 0), legW + 2, 3, o.foot);

    /* torso */
    sp.ellipse(cx, torsoTop + Math.round(torsoH / 2), bodyHW, Math.round(torsoH / 2) + 1, o.body);
    // chest shading + highlight
    sp.ellipse(cx - Math.round(bodyHW * 0.35), torsoTop + Math.round(torsoH * 0.4),
               Math.round(bodyHW * 0.4), Math.round(torsoH * 0.3), o.bodyLit);
    sp.rect(cx - bodyHW, torsoTop + torsoH - 3, bodyHW * 2, 3, o.bodyDark);

    if (o.belt) {
      sp.rect(cx - bodyHW + 1, legTop - 3, bodyHW * 2 - 2, 3, o.belt);
    }

    /* arms */
    var armW = Math.max(3, Math.round(w * 0.11));
    var armLen = Math.round(torsoH * 0.95);
    if (frame === 2 && o.attackArms) {
      // both arms thrust forward: read as a wide bar across the chest
      sp.rect(cx - bodyHW - armW, torsoTop + 3, bodyHW * 2 + armW * 2, armW + 2, o.skin);
      sp.rect(cx - bodyHW - armW, torsoTop + 3, bodyHW * 2 + armW * 2, 1, o.skinLit);
    } else {
      sp.rect(cx + bodyHW - 1, torsoTop + 2 + (swing ? 1 : 0), armW, armLen, o.skin);
      sp.rect(cx - bodyHW - armW + 1, torsoTop + 2 + (swing ? 0 : 1), armW, armLen, o.skinDark);
    }

    /* head */
    var hy = 2 + Math.round(headH / 2);
    sp.ellipse(cx, hy, Math.round(headW / 2), Math.round(headH / 2) + 1, o.skin);
    sp.ellipse(cx - 2, hy - 1, Math.round(headW / 3), Math.round(headH / 3), o.skinLit);
    // eyes
    var ex = Math.max(2, Math.round(headW * 0.22));
    sp.mellipse(cx, ex, hy, 1, 1, o.eye);
    // brow
    sp.hline(cx - ex - 2, cx + ex + 2, hy - 3, o.skinDark);
    // mouth / snarl
    sp.hline(cx - 2, cx + 2, hy + Math.round(headH * 0.28), o.mouth);

    if (o.horns) {
      for (var i = 0; i < 5; i++) {
        sp.px(cx + ex + 2 + i, hy - 4 - i, o.horn);
        sp.px(cx + ex + 3 + i, hy - 4 - i, o.horn);
        sp.px(cx - ex - 2 - i, hy - 4 - i, o.horn);
        sp.px(cx - ex - 3 - i, hy - 4 - i, o.horn);
      }
    }

    if (o.shoulders) {
      sp.ellipse(cx + bodyHW - 1, torsoTop + 3, 4, 3, o.shoulders);
      sp.ellipse(cx - bodyHW + 1, torsoTop + 3, 4, 3, o.shoulders);
    }

    if (o.gun && frame !== 2) {
      // rifle held across the body
      sp.rect(cx + bodyHW - 2, torsoTop + 8, 12, 3, U.rgb(48, 46, 44));
      sp.rect(cx + bodyHW + 8, torsoTop + 8, 4, 2, U.rgb(28, 28, 28));
    } else if (o.gun) {
      sp.rect(cx + bodyHW - 2, torsoTop + 6, 16, 4, U.rgb(56, 54, 50));
      sp.rect(cx + bodyHW + 12, torsoTop + 6, 4, 3, U.rgb(30, 30, 30));
    }

    return sp;
  }

  /* The pinky demon: low, wide, all jaw. */
  function demon(frame) {
    var w = 56, h = 46;
    var sp = new Sprite(w, h);
    var cx = 28;
    var pink = U.rgb(196, 116, 116), pinkD = U.rgb(140, 74, 76), pinkL = U.rgb(226, 158, 156);
    var hoof = U.rgb(58, 46, 42);
    var swing = frame === 1 ? 1 : 0;
    var open = frame === 2;

    /* legs */
    sp.rect(cx + 12, 34 - swing, 7, 12, pinkD);
    sp.rect(cx - 19, 34 - (1 - swing), 7, 12, pinkD);
    sp.rect(cx + 3, 36 + swing, 6, 10, pink);
    sp.rect(cx - 9, 36 + (1 - swing), 6, 10, pink);
    sp.rect(cx + 11, 43, 9, 3, hoof);
    sp.rect(cx - 20, 43, 9, 3, hoof);

    /* bulky body */
    sp.ellipse(cx, 26, 22, 13, pink);
    sp.ellipse(cx - 6, 22, 12, 7, pinkL);
    sp.ellipse(cx, 33, 20, 5, pinkD);

    /* head, jammed onto the front of the body */
    sp.ellipse(cx, 13, 15, 11, pink);
    sp.ellipse(cx - 4, 10, 8, 6, pinkL);
    // horns
    for (var i = 0; i < 6; i++) {
      sp.px(cx + 12 + (i >> 1), 6 - i, U.rgb(226, 214, 190));
      sp.px(cx + 13 + (i >> 1), 6 - i, U.rgb(180, 168, 148));
      sp.px(cx - 12 - (i >> 1), 6 - i, U.rgb(226, 214, 190));
      sp.px(cx - 13 - (i >> 1), 6 - i, U.rgb(180, 168, 148));
    }
    // eyes
    sp.mellipse(cx, 6, 11, 2, 1, U.rgb(250, 230, 90));
    sp.mellipse(cx, 6, 11, 1, 1, U.rgb(20, 10, 10));

    /* the mouth: shut into a grin, or a gaping bite */
    var mouthY = open ? 17 : 19;
    var mouthH = open ? 8 : 3;
    sp.rect(cx - 12, mouthY, 24, mouthH, U.rgb(52, 14, 16));
    for (var t = 0; t < 6; t++) {
      var tx = cx - 11 + t * 4;
      sp.rect(tx, mouthY, 2, 3, U.rgb(238, 232, 210));
      sp.rect(tx + 2, mouthY + mouthH - 3, 2, 3, U.rgb(238, 232, 210));
    }
    if (open) {
      sp.ellipse(cx, mouthY + mouthH - 2, 7, 2, U.rgb(150, 40, 44));
    }
    return sp;
  }

  /* ---------- projectiles & effects ----------------------------------- */

  function fireball(frame) {
    var sp = new Sprite(20, 20);
    var wob = frame ? 1 : 0;
    sp.ellipse(10, 10, 9 - wob, 9, U.rgba(190, 60, 10, 210));
    sp.ellipse(10, 10, 7 - wob, 7, U.rgb(240, 130, 30));
    sp.ellipse(10 - wob, 9, 4, 4, U.rgb(255, 216, 110));
    sp.ellipse(10 - wob, 9, 2, 2, U.rgb(255, 255, 220));
    return sp;
  }

  function plasmaBall(frame) {
    var sp = new Sprite(18, 18);
    var wob = frame ? 1 : 0;
    sp.ellipse(9, 9, 8 - wob, 8, U.rgba(40, 200, 90, 200));
    sp.ellipse(9, 9, 5, 5, U.rgb(120, 250, 150));
    sp.ellipse(9, 8, 2, 2, U.rgb(230, 255, 235));
    return sp;
  }

  function puff(frame) {
    var sp = new Sprite(16, 16);
    var r = 2 + frame * 2;
    var c = [U.rgb(220, 220, 210), U.rgb(170, 170, 165), U.rgb(110, 110, 108)][frame];
    sp.ellipse(8, 8, r, r, c);
    sp.ellipse(8 - r, 8 - 1, Math.max(1, r - 2), Math.max(1, r - 2), c);
    sp.ellipse(8 + r - 1, 8 + 1, Math.max(1, r - 3), Math.max(1, r - 3), c);
    return sp;
  }

  function bloodPuff(frame) {
    var sp = new Sprite(16, 16);
    var r = 2 + frame * 2;
    var c = [U.rgb(220, 40, 30), U.rgb(160, 20, 18), U.rgb(96, 12, 12)][frame];
    sp.ellipse(8, 8, r, r, c);
    sp.ellipse(8 - r, 8 + 2, Math.max(1, r - 2), Math.max(1, r - 2), c);
    return sp;
  }

  function explosion(frame) {
    var sp = new Sprite(40, 40);
    var r = 8 + frame * 8;
    sp.ellipse(20, 20, r, r, U.rgba(200, 70, 20, 190));
    sp.ellipse(20, 20, Math.max(1, r - 5), Math.max(1, r - 5), U.rgb(250, 150, 40));
    if (frame < 2) sp.ellipse(20, 20, Math.max(1, r - 10), Math.max(1, r - 10), U.rgb(255, 240, 180));
    return sp;
  }

  /* ---------- pickups -------------------------------------------------- */

  function healthBonus() {
    var sp = new Sprite(16, 18);
    sp.ellipse(8, 11, 5, 6, U.rgb(40, 90, 190));
    sp.ellipse(6, 9, 2, 3, U.rgb(140, 190, 255));
    sp.rect(6, 2, 4, 4, U.rgb(180, 190, 210));
    sp.rect(5, 5, 6, 2, U.rgb(120, 130, 150));
    sp.hline(6, 9, 2, U.rgb(230, 240, 255));
    return sp;
  }

  function medkit() {
    var sp = new Sprite(22, 18);
    sp.rect(1, 3, 20, 14, U.rgb(232, 232, 228));
    sp.frame(1, 3, 20, 14, U.rgb(150, 150, 148));
    sp.rect(2, 4, 18, 2, U.rgb(255, 255, 255));
    sp.rect(8, 6, 6, 9, U.rgb(210, 30, 30));
    sp.rect(5, 8, 12, 5, U.rgb(210, 30, 30));
    sp.rect(8, 1, 6, 2, U.rgb(120, 120, 118));
    return sp;
  }

  function armorVest() {
    var sp = new Sprite(20, 20);
    sp.ellipse(10, 11, 9, 9, U.rgb(30, 150, 60));
    sp.rect(1, 2, 18, 9, U.rgb(30, 150, 60));
    sp.ellipse(7, 8, 4, 4, U.rgb(90, 220, 120));
    sp.frame(1, 2, 18, 9, U.rgb(16, 90, 36));
    sp.vline(10, 3, 18, U.rgb(16, 90, 36));
    return sp;
  }

  function clip() {
    var sp = new Sprite(16, 12);
    sp.rect(2, 3, 12, 8, U.rgb(90, 88, 84));
    sp.frame(2, 3, 12, 8, U.rgb(50, 48, 46));
    for (var i = 0; i < 4; i++) sp.rect(3 + i * 3, 1, 2, 3, U.rgb(212, 176, 60));
    sp.hline(3, 12, 4, U.rgb(140, 138, 132));
    return sp;
  }

  function shellBox() {
    var sp = new Sprite(20, 14);
    sp.rect(1, 3, 18, 10, U.rgb(150, 34, 28));
    sp.frame(1, 3, 18, 10, U.rgb(88, 18, 14));
    for (var i = 0; i < 5; i++) {
      sp.rect(2 + i * 3.5, 1, 3, 3, U.rgb(214, 168, 60));
      sp.px(3 + i * 3.5, 1, U.rgb(250, 220, 140));
    }
    sp.hline(2, 17, 4, U.rgb(200, 70, 60));
    return sp;
  }

  function keycard() {
    var sp = new Sprite(12, 16);
    sp.rect(2, 1, 8, 14, U.rgb(220, 40, 36));
    sp.frame(2, 1, 8, 14, U.rgb(255, 160, 150));
    sp.rect(4, 4, 4, 3, U.rgb(90, 10, 10));
    sp.hline(3, 8, 11, U.rgb(150, 20, 18));
    return sp;
  }

  function shotgunPickup() {
    var sp = new Sprite(30, 12);
    sp.rect(2, 5, 24, 3, U.rgb(60, 58, 56));       // barrel
    sp.rect(2, 4, 24, 1, U.rgb(110, 108, 104));
    sp.rect(8, 7, 9, 3, U.rgb(120, 80, 40));       // pump
    sp.rect(20, 7, 8, 5, U.rgb(96, 62, 32));       // stock
    sp.rect(17, 8, 3, 4, U.rgb(50, 48, 46));
    return sp;
  }

  function chaingunPickup() {
    var sp = new Sprite(30, 16);
    for (var i = 0; i < 3; i++) sp.rect(2, 3 + i * 3, 20, 2, U.rgb(70, 70, 74));
    sp.rect(2, 3, 20, 1, U.rgb(130, 130, 136));
    sp.rect(20, 2, 7, 11, U.rgb(84, 84, 88));
    sp.frame(20, 2, 7, 11, U.rgb(40, 40, 44));
    sp.rect(14, 12, 5, 4, U.rgb(60, 44, 28));
    return sp;
  }

  /* ---------- first-person weapons ------------------------------------ */

  var SKIN = U.rgb(198, 152, 116), SKIN_D = U.rgb(150, 108, 80), SKIN_L = U.rgb(228, 190, 156);
  var GLOVE = U.rgb(96, 82, 66), GLOVE_D = U.rgb(62, 52, 42);
  var STEEL = U.rgb(84, 84, 90), STEEL_D = U.rgb(44, 44, 50), STEEL_L = U.rgb(140, 140, 150);

  /* A gloved fist. Sized generously -- these read at arm's length on screen. */
  function hand(sp, x, y, w, h) {
    sp.rect(x, y, w, h, GLOVE);
    sp.rect(x, y, w, 3, U.rgb(128, 112, 92));            // cuff highlight
    sp.rect(x, y, 2, h, U.rgb(120, 104, 84));
    sp.rect(x + w - 2, y, 2, h, GLOVE_D);
    var fingersY = y + h - 12;
    sp.rect(x + 2, fingersY, w - 4, 12, SKIN);           // knuckles
    sp.rect(x + 2, fingersY, w - 4, 2, SKIN_L);
    for (var i = 1; i < 4; i++) {
      var fx = x + 2 + Math.round(i * (w - 4) / 4);
      sp.vline(fx, fingersY, y + h - 1, SKIN_D);
      sp.vline(fx, y + 4, fingersY - 1, GLOVE_D);
    }
    sp.rect(x, y + h - 2, w, 2, SKIN_D);
  }

  function pistolView(fire) {
    var sp = new Sprite(150, 140);
    var by = 20 - (fire ? 8 : 0);

    sp.rect(52, by, 52, 22, STEEL);                      // slide
    sp.rect(52, by, 52, 3, STEEL_L);
    sp.rect(52, by + 19, 52, 3, STEEL_D);
    for (var s = 0; s < 4; s++) sp.vline(58 + s * 4, by + 5, by + 16, U.rgb(66, 66, 72));
    sp.rect(100, by + 6, 14, 12, STEEL_D);               // muzzle block
    sp.rect(114, by + 9, 3, 6, U.rgb(24, 24, 28));       // bore
    sp.rect(96, by - 4, 5, 5, STEEL_L);                  // front sight

    sp.rect(56, by + 22, 32, 20, STEEL);                 // frame
    sp.rect(56, by + 22, 32, 2, STEEL_L);
    sp.frame(60, by + 28, 24, 18, STEEL_D);              // trigger guard
    sp.rect(66, by + 32, 5, 10, U.rgb(30, 30, 34));      // trigger

    sp.rect(58, by + 40, 36, 54, U.rgb(62, 50, 40));     // grip
    sp.rect(58, by + 40, 36, 3, U.rgb(98, 82, 66));
    for (var g = 0; g < 6; g++) sp.hline(60, 91, by + 48 + g * 7, U.rgb(44, 34, 26));

    hand(sp, 52, by + 46, 46, 62);                       // firing hand
    sp.rect(94, by + 54, 10, 26, SKIN);                  // thumb
    sp.rect(94, by + 54, 10, 2, SKIN_L);
    return sp;
  }

  function shotgunView(state) {
    // state: 0 idle, 1 firing, 2 pump racked back
    var sp = new Sprite(210, 150);
    var by = 20 - (state === 1 ? 10 : (state === 2 ? 14 : 0));
    var pumpX = state === 2 ? 62 : 86;

    sp.rect(46, by, 130, 22, STEEL);                     // barrel
    sp.rect(46, by, 130, 3, STEEL_L);
    sp.rect(46, by + 19, 130, 3, STEEL_D);
    sp.rect(168, by + 4, 18, 14, STEEL_D);               // muzzle
    sp.rect(186, by + 8, 3, 7, U.rgb(20, 20, 22));
    sp.rect(160, by - 4, 5, 5, STEEL_L);                 // bead sight

    sp.rect(52, by + 22, 108, 14, U.rgb(74, 72, 78));    // magazine tube
    sp.rect(52, by + 22, 108, 2, U.rgb(120, 118, 126));

    sp.rect(pumpX, by + 22, 48, 24, U.rgb(126, 86, 44)); // wooden pump
    sp.rect(pumpX, by + 22, 48, 3, U.rgb(168, 122, 72));
    sp.rect(pumpX, by + 43, 48, 3, U.rgb(84, 54, 26));
    for (var i = 0; i < 7; i++) sp.vline(pumpX + 4 + i * 6, by + 26, by + 42, U.rgb(92, 60, 30));

    sp.rect(28, by + 14, 34, 46, U.rgb(78, 78, 84));     // receiver
    sp.frame(28, by + 14, 34, 46, STEEL_D);
    sp.rect(34, by + 22, 20, 10, U.rgb(30, 30, 34));     // ejection port
    sp.rect(4, by + 26, 28, 48, U.rgb(102, 66, 34));     // stock
    sp.rect(4, by + 26, 28, 3, U.rgb(146, 100, 56));

    hand(sp, pumpX + 4, by + 42, 42, 58);                // forward hand
    hand(sp, 14, by + 52, 44, 60);                       // trigger hand
    return sp;
  }

  function chaingunView(spin, fire) {
    var sp = new Sprite(200, 140);
    var by = 16 - (fire ? 5 : 0);
    var NB = 6;

    // barrel cluster: vertical offsets around the axis fake the rotation
    for (var i = 0; i < NB; i++) {
      var phase = ((i + spin) % NB) / NB * Math.PI * 2;
      var yo = Math.round(Math.sin(phase) * 6);
      var f = 150 + Math.round(Math.cos(phase) * 90);
      sp.rect(66, by + 22 + i * 8 + yo, 106, 7, U.shade(STEEL, f));
      sp.rect(66, by + 22 + i * 8 + yo, 106, 1, U.shade(STEEL_L, f));
      sp.rect(166, by + 22 + i * 8 + yo, 10, 7, U.shade(STEEL_D, f));
    }

    sp.rect(52, by + 12, 22, 70, U.rgb(72, 72, 78));     // barrel shroud
    sp.frame(52, by + 12, 22, 70, STEEL_D);
    sp.rect(56, by + 18, 14, 4, U.rgb(40, 40, 46));
    sp.rect(56, by + 70, 14, 4, U.rgb(40, 40, 46));

    sp.rect(22, by + 18, 32, 62, U.rgb(90, 90, 96));     // receiver body
    sp.frame(22, by + 18, 32, 62, STEEL_D);
    sp.rect(22, by + 18, 32, 2, STEEL_L);
    for (var v = 0; v < 4; v++) sp.rect(28, by + 26 + v * 12, 20, 6, U.rgb(46, 46, 52));

    sp.rect(60, by + 78, 44, 16, U.rgb(64, 46, 28));     // fore grip
    hand(sp, 12, by + 62, 42, 58);
    hand(sp, 70, by + 66, 40, 56);
    return sp;
  }

  function muzzleFlash(size, seed) {
    var sp = new Sprite(size, size);
    var r = U.rng(seed);
    var c = size / 2;
    sp.ellipse(c, c, size * 0.30, size * 0.24, U.rgba(255, 210, 90, 220));
    sp.ellipse(c, c, size * 0.18, size * 0.14, U.rgb(255, 250, 210));
    for (var i = 0; i < 9; i++) {
      var a = r() * Math.PI * 2;
      var len = size * (0.25 + r() * 0.28);
      for (var t = 0; t < len; t++) {
        var w = Math.max(0, 3 - t / (len / 3));
        for (var k = -w; k <= w; k++) {
          sp.px(c + Math.cos(a) * t + k * Math.sin(a),
                c + Math.sin(a) * t - k * Math.cos(a),
                t < len * 0.4 ? U.rgb(255, 240, 170) : U.rgba(250, 170, 50, 200));
        }
      }
    }
    return sp;
  }

  /* ---------- the player's face on the status bar ---------------------- */

  /* health 0..100, hurt = recently damaged, mood cycles the eye direction. */
  function face(healthBucket, hurt, look, dead) {
    var sp = new Sprite(28, 32);
    var skin = U.rgb(214, 168, 130);
    var hair = U.rgb(122, 76, 38);
    var dark = U.rgb(146, 100, 70);
    var blood = U.rgb(180, 30, 26);

    if (dead) {
      sp.ellipse(14, 20, 12, 9, U.rgb(150, 96, 74));
      sp.rect(2, 22, 24, 9, U.rgb(120, 20, 18));
      for (var i = 0; i < 40; i++) sp.px(2 + (i * 7) % 24, 12 + (i * 13) % 18, blood);
      // X eyes
      for (var k = 0; k < 4; k++) {
        sp.px(8 + k, 16 + k, U.rgb(30, 20, 20)); sp.px(11 - k, 16 + k, U.rgb(30, 20, 20));
        sp.px(17 + k, 16 + k, U.rgb(30, 20, 20)); sp.px(20 - k, 16 + k, U.rgb(30, 20, 20));
      }
      return sp;
    }

    sp.ellipse(14, 17, 11, 13, skin);
    sp.ellipse(11, 13, 6, 6, U.rgb(232, 192, 158));
    // hair
    sp.ellipse(14, 6, 11, 5, hair);
    sp.rect(3, 6, 22, 3, hair);
    // brow: angrier as health drops
    var browY = 12 + (healthBucket >= 4 ? 0 : 1);
    var browTilt = healthBucket >= 3 ? 0 : 1;
    sp.rect(6, browY, 7, 2, dark);
    sp.rect(15, browY, 7, 2, dark);
    if (browTilt) { sp.rect(6, browY + 1, 4, 2, dark); sp.rect(18, browY + 1, 4, 2, dark); }
    // eyes, looking left/centre/right
    var ex = look;
    sp.rect(7, 15, 6, 4, U.rgb(240, 240, 235));
    sp.rect(15, 15, 6, 4, U.rgb(240, 240, 235));
    sp.rect(9 + ex, 16, 2, 3, U.rgb(30, 40, 70));
    sp.rect(17 + ex, 16, 2, 3, U.rgb(30, 40, 70));
    // nose + mouth
    sp.rect(13, 19, 2, 3, dark);
    if (healthBucket >= 4) sp.rect(9, 24, 10, 2, U.rgb(120, 60, 50));
    else if (healthBucket >= 2) { sp.rect(9, 24, 10, 3, U.rgb(110, 46, 40)); }
    else { sp.rect(8, 23, 12, 5, U.rgb(90, 30, 26)); sp.rect(9, 24, 10, 2, U.rgb(200, 200, 190)); }

    // injuries accumulate as health drops
    var wounds = 4 - healthBucket;
    for (var wI = 0; wI < wounds; wI++) {
      var wx = 5 + wI * 6, wy = 9 + ((wI * 5) % 12);
      sp.rect(wx, wy, 3, 2, blood);
      sp.px(wx + 1, wy + 2, blood);
    }
    if (hurt) {
      sp.rect(4, 8, 20, 3, blood);
      sp.rect(6, 11, 4, 6, blood);
    }
    return sp;
  }

  /* ---------- assembly -------------------------------------------------- */

  var lib = {};

  function deathFrames(base, n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var t = (i + 1) / n;
      var s = squashed(tinted(base, U.rgb(150, 20, 18), 0.18 + t * 0.3), 1 - t * 0.76, t * 0.55);
      out.push(darkened(s, 256 - Math.round(t * 60)));
    }
    return out;
  }

  function build() {
    var zombieOpts = {
      w: 40, h: 58, bodyW: 20,
      skin: U.rgb(126, 148, 106), skinDark: U.rgb(88, 106, 74), skinLit: U.rgb(158, 180, 134),
      body: U.rgb(96, 86, 62), bodyDark: U.rgb(62, 56, 40), bodyLit: U.rgb(126, 114, 84),
      leg: U.rgb(74, 70, 56), legDark: U.rgb(56, 52, 42), foot: U.rgb(38, 34, 30),
      belt: U.rgb(44, 38, 30), eye: U.rgb(240, 230, 120), mouth: U.rgb(50, 26, 24),
      shoulders: U.rgb(120, 110, 82), gun: true, attackArms: false
    };

    var impOpts = {
      w: 44, h: 62, bodyW: 24,
      skin: U.rgb(160, 96, 52), skinDark: U.rgb(110, 62, 32), skinLit: U.rgb(196, 132, 78),
      body: U.rgb(146, 86, 46), bodyDark: U.rgb(96, 54, 28), bodyLit: U.rgb(184, 120, 70),
      leg: U.rgb(128, 74, 40), legDark: U.rgb(96, 54, 28), foot: U.rgb(52, 34, 22),
      belt: null, eye: U.rgb(250, 220, 90), mouth: U.rgb(60, 20, 18),
      shoulders: U.rgb(178, 116, 66), horns: true, horn: U.rgb(224, 210, 186),
      attackArms: true
    };

    var baronOpts = {
      w: 60, h: 80, bodyW: 34,
      skin: U.rgb(206, 154, 118), skinDark: U.rgb(150, 106, 80), skinLit: U.rgb(232, 190, 156),
      body: U.rgb(190, 138, 104), bodyDark: U.rgb(128, 88, 66), bodyLit: U.rgb(220, 176, 140),
      leg: U.rgb(96, 118, 72), legDark: U.rgb(64, 82, 48), foot: U.rgb(44, 40, 30),
      belt: U.rgb(70, 58, 40), eye: U.rgb(255, 90, 60), mouth: U.rgb(70, 18, 16),
      shoulders: U.rgb(226, 176, 140), horns: true, horn: U.rgb(238, 228, 208),
      attackArms: true
    };

    function monster(opts, drawFn) {
      var walk0 = drawFn ? drawFn(0) : biped(opts, 0);
      var walk1 = drawFn ? drawFn(1) : biped(opts, 1);
      var atk = drawFn ? drawFn(2) : biped(opts, 2);
      return {
        walk: [walk0, walk1],
        attack: atk,
        pain: tinted(walk0, U.rgb(255, 60, 40), 0.5),
        die: deathFrames(walk0, 5)
      };
    }

    lib.zombie = monster(zombieOpts, null);
    lib.imp = monster(impOpts, null);
    lib.baron = monster(baronOpts, null);
    lib.demon = monster(null, demon);

    lib.fireball = [fireball(0), fireball(1)];
    lib.plasma = [plasmaBall(0), plasmaBall(1)];
    lib.puff = [puff(0), puff(1), puff(2)];
    lib.blood = [bloodPuff(0), bloodPuff(1), bloodPuff(2)];
    lib.boom = [explosion(0), explosion(1), explosion(2)];

    lib.items = {
      healthBonus: healthBonus(),
      medkit: medkit(),
      armor: armorVest(),
      clip: clip(),
      shells: shellBox(),
      redkey: keycard(),
      shotgun: shotgunPickup(),
      chaingun: chaingunPickup()
    };

    lib.weaponViews = {
      pistol: [pistolView(false), pistolView(true)],
      shotgun: [shotgunView(0), shotgunView(1), shotgunView(2)],
      chaingun: [chaingunView(0, false), chaingunView(1, false),
                 chaingunView(2, true), chaingunView(3, true),
                 chaingunView(4, false)]
    };

    lib.flash = [muzzleFlash(64, 3), muzzleFlash(88, 91), muzzleFlash(72, 17)];

    // 5 health buckets x normal/hurt x 3 look directions, plus the death mug
    lib.faces = [];
    for (var b = 0; b <= 4; b++) {
      var row = [];
      for (var l = -1; l <= 1; l++) row.push([face(b, false, l, false), face(b, true, l, false)]);
      lib.faces.push(row);
    }
    lib.faceDead = face(0, false, 0, true);
  }

  return {
    build: build,
    lib: lib,
    Sprite: Sprite,
    tinted: tinted,
    darkened: darkened
  };
})();
