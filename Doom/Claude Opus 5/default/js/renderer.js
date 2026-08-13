'use strict';

/* Software raycaster. Writes packed 32-bit pixels into one preallocated
   Uint32Array; nothing in here allocates per frame. */
var R = (function () {

  var W = CFG.W, H = CFG.H, VH = CFG.VIEW_H, TN = CFG.TEX;

  var imageData = null;
  var fb = null;            // Uint32Array view over imageData.data
  var zbuf = new Float32Array(W);
  var ctx2d = null;

  /* Extra light from a muzzle flash / explosion, decays every frame. */
  var lightBoost = 0;

  function init(canvas) {
    ctx2d = canvas.getContext('2d', { alpha: false });
    imageData = ctx2d.createImageData(W, H);
    fb = new Uint32Array(imageData.data.buffer);
  }

  function addLight(v) { lightBoost = Math.min(1.2, lightBoost + v); }
  function decayLight(dt) { lightBoost = Math.max(0, lightBoost - dt * 4.5); }

  function clear(c) { fb.fill(c); }

  /* Coordinates are floored here rather than at every call site: a fractional
     index into a typed array silently drops the write. */
  function fillRect(x0, y0, w, h, c) {
    var x1 = U.clamp(Math.round(x0 + w), 0, W) | 0, y1 = U.clamp(Math.round(y0 + h), 0, H) | 0;
    x0 = U.clamp(Math.round(x0), 0, W) | 0; y0 = U.clamp(Math.round(y0), 0, H) | 0;
    for (var y = y0; y < y1; y++) {
      var row = y * W;
      for (var x = x0; x < x1; x++) fb[row + x] = c;
    }
  }

  function blendRect(x0, y0, w, h, c, t) {
    var x1 = U.clamp(Math.round(x0 + w), 0, W) | 0, y1 = U.clamp(Math.round(y0 + h), 0, H) | 0;
    x0 = U.clamp(Math.round(x0), 0, W) | 0; y0 = U.clamp(Math.round(y0), 0, H) | 0;
    for (var y = y0; y < y1; y++) {
      var row = y * W;
      for (var x = x0; x < x1; x++) fb[row + x] = U.mix(fb[row + x], c, t);
    }
  }

  function pixel(x, y, c) {
    x = Math.round(x) | 0; y = Math.round(y) | 0;
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    fb[y * W + x] = c;
  }

  /* Blit a sprite 1:1 in screen space (weapons, HUD, menus). */
  function blit(sp, dx, dy, shadeF) {
    var d = sp.data, sw = sp.w, sh = sp.h;
    for (var y = 0; y < sh; y++) {
      var ty = dy + y;
      if (ty < 0 || ty >= H) continue;
      var srow = y * sw, drow = ty * W;
      for (var x = 0; x < sw; x++) {
        var c = d[srow + x];
        if (c === 0) continue;
        var tx = dx + x;
        if (tx < 0 || tx >= W) continue;
        var a = (c >>> 24) & 0xFF;
        if (shadeF !== undefined && shadeF !== 256) c = U.shade(c, shadeF);
        fb[drow + tx] = a === 255 ? c : U.mix(fb[drow + tx], c, a);
      }
    }
  }

  /* Same, but scaled by an integer factor -- used for the big HUD digits. */
  function blitScaled(sp, dx, dy, s, shadeF) {
    var d = sp.data, sw = sp.w, sh = sp.h;
    for (var y = 0; y < sh; y++) {
      for (var x = 0; x < sw; x++) {
        var c = d[y * sw + x];
        if (c === 0) continue;
        if (shadeF !== undefined && shadeF !== 256) c = U.shade(c, shadeF);
        var a = (c >>> 24) & 0xFF;
        for (var oy = 0; oy < s; oy++) {
          var ty = dy + y * s + oy;
          if (ty < 0 || ty >= H) continue;
          var drow = ty * W;
          for (var ox = 0; ox < s; ox++) {
            var tx = dx + x * s + ox;
            if (tx < 0 || tx >= W) continue;
            fb[drow + tx] = a === 255 ? c : U.mix(fb[drow + tx], c, a);
          }
        }
      }
    }
  }

  /* ---------- world pass ---------------------------------------------- */

  function renderWorld(cam) {
    var dirX = cam.dirX, dirY = cam.dirY;
    var planeX = cam.planeX, planeY = cam.planeY;
    var posX = cam.x, posY = cam.y;
    var horiz = CFG.HALF_VIEW + cam.pitch + cam.bob;

    castFlats(posX, posY, dirX, dirY, planeX, planeY, horiz);
    castWalls(posX, posY, dirX, dirY, planeX, planeY, horiz);
  }

  var floorTexA = null, floorTexB = null, ceilTex = null;

  /* Cached level arrays: the flat/wall loops touch these hundreds of
     thousands of times a frame, so they are read directly, not via LEVEL.*() */
  var LGRID = null, LDOORS = null, LZONE = null, LW = 0, LH = 0;

  function bindFlats() {
    floorTexA = TEX.floor(0);
    floorTexB = TEX.floor(1);
    ceilTex = TEX.floor(2);
  }

  function bindLevel() {
    var a = LEVEL.arrays();
    LGRID = a.grid; LDOORS = a.doors; LZONE = a.zone; LW = a.W; LH = a.H;
  }

  function lightFor(dist) {
    var l = 1.18 - dist / CFG.MAX_LIGHT_DIST + lightBoost * (1 - U.clamp(dist / 9, 0, 1));
    return U.clamp(l * 256, 26, 256) | 0;
  }

  /* Floor and ceiling are cast row-by-row: every row is one constant distance. */
  function castFlats(posX, posY, dirX, dirY, planeX, planeY, horiz) {
    var rayX0 = dirX - planeX, rayY0 = dirY - planeY;
    var rayX1 = dirX + planeX, rayY1 = dirY + planeY;
    var posZ = 0.5 * VH;

    var y, p, rowDist, stepX, stepY, fx, fy, x, cellX, cellY, tx, ty, f, row, c;

    // floor: rows below the horizon
    for (y = Math.max(0, Math.floor(horiz) + 1); y < VH; y++) {
      p = y - horiz;
      if (p < 0.5) continue;
      rowDist = posZ / p;
      if (rowDist > 42) continue;
      stepX = rowDist * (rayX1 - rayX0) / W;
      stepY = rowDist * (rayY1 - rayY0) / W;
      fx = posX + rowDist * rayX0;
      fy = posY + rowDist * rayY0;
      f = lightFor(rowDist);
      row = y * W;
      for (x = 0; x < W; x++) {
        cellX = fx | 0; cellY = fy | 0;
        tx = ((fx - cellX) * TN) | 0;
        ty = ((fy - cellY) * TN) | 0;
        var inside = cellX >= 0 && cellY >= 0 && cellX < LW && cellY < LH;
        c = (inside && LZONE[cellY * LW + cellX] ? floorTexB : floorTexA)[(ty << 6) + tx];
        fb[row + x] = U.shade(c, f);
        fx += stepX; fy += stepY;
      }
    }

    // ceiling: rows above the horizon
    for (y = Math.min(VH - 1, Math.ceil(horiz) - 1); y >= 0; y--) {
      p = horiz - y;
      if (p < 0.5) continue;
      rowDist = posZ / p;
      if (rowDist > 42) { fillRow(y, 0xFF000000); continue; }
      stepX = rowDist * (rayX1 - rayX0) / W;
      stepY = rowDist * (rayY1 - rayY0) / W;
      fx = posX + rowDist * rayX0;
      fy = posY + rowDist * rayY0;
      f = (lightFor(rowDist) * 0.78) | 0;
      row = y * W;
      for (x = 0; x < W; x++) {
        cellX = fx | 0; cellY = fy | 0;
        tx = ((fx - cellX) * TN) | 0;
        ty = ((fy - cellY) * TN) | 0;
        fb[row + x] = U.shade(ceilTex[(ty << 6) + tx], f);
        fx += stepX; fy += stepY;
      }
    }
  }

  function fillRow(y, c) {
    var row = y * W;
    for (var x = 0; x < W; x++) fb[row + x] = c;
  }

  function castWalls(posX, posY, dirX, dirY, planeX, planeY, horiz) {
    for (var x = 0; x < W; x++) {
      var cameraX = 2 * x / W - 1;
      var rayX = dirX + planeX * cameraX;
      var rayY = dirY + planeY * cameraX;

      var mapX = posX | 0, mapY = posY | 0;
      var deltaX = rayX === 0 ? 1e30 : Math.abs(1 / rayX);
      var deltaY = rayY === 0 ? 1e30 : Math.abs(1 / rayY);

      var stepX, stepY, sideDistX, sideDistY;
      if (rayX < 0) { stepX = -1; sideDistX = (posX - mapX) * deltaX; }
      else { stepX = 1; sideDistX = (mapX + 1 - posX) * deltaX; }
      if (rayY < 0) { stepY = -1; sideDistY = (posY - mapY) * deltaY; }
      else { stepY = 1; sideDistY = (mapY + 1 - posY) * deltaY; }

      var hit = 0, side = 0, tile = 0, perp = 0, wallU = 0, guard = 0;

      while (!hit && guard++ < 128) {
        if (sideDistX < sideDistY) { sideDistX += deltaX; mapX += stepX; side = 0; }
        else { sideDistY += deltaY; mapY += stepY; side = 1; }

        if (mapX < 0 || mapY < 0 || mapX >= LW || mapY >= LH) break;
        var cellI = mapY * LW + mapX;
        tile = LGRID[cellI];
        if (tile === 0) continue;

        perp = side === 0 ? (sideDistX - deltaX) : (sideDistY - deltaY);
        if (perp < 0.0001) perp = 0.0001;
        wallU = side === 0 ? (posY + perp * rayY) : (posX + perp * rayX);
        wallU -= Math.floor(wallU);

        var door = LDOORS[cellI];
        if (door && door.open > 0) {
          // the leaf slides into a pocket, so the gap opens from the far edge
          if (wallU > 1 - door.open) continue;
          wallU += door.open;
          if (wallU >= 1) wallU -= 1;
        }
        hit = 1;
      }

      if (!hit) { zbuf[x] = 1e30; continue; }
      zbuf[x] = perp;

      var lineH = (VH / perp) | 0;
      var yStart = Math.floor(horiz - lineH / 2);
      var yEnd = yStart + lineH;

      var tex = TEX.wall(tile);
      var texX = (wallU * TN) | 0;
      if (side === 0 && rayX > 0) texX = TN - texX - 1;
      if (side === 1 && rayY < 0) texX = TN - texX - 1;
      texX &= (TN - 1);

      var f = lightFor(perp);
      if (side === 1) f = (f * 0.72) | 0;

      var step = TN / lineH;
      var texPos = (yStart < 0 ? -yStart : 0) * step;
      var y0 = yStart < 0 ? 0 : yStart;
      var y1 = yEnd > VH ? VH : yEnd;

      for (var y = y0; y < y1; y++) {
        var texY = texPos | 0;
        if (texY > TN - 1) texY = TN - 1;
        texPos += step;
        fb[y * W + x] = U.shade(tex[(texY << 6) + texX], f);
      }
    }
  }

  /* ---------- sprite pass ---------------------------------------------- */

  var order = [];
  /* Hoisted so the sprite pass allocates nothing per frame. */
  function byDepth(a, b) { return b._dist - a._dist; }

  function renderSprites(cam, list) {
    var dirX = cam.dirX, dirY = cam.dirY, planeX = cam.planeX, planeY = cam.planeY;
    var horiz = CFG.HALF_VIEW + cam.pitch + cam.bob;

    order.length = 0;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e.sprite) continue;
      var dx = e.x - cam.x, dy = e.y - cam.y;
      e._dist = dx * dx + dy * dy;
      if (e._dist > 900) continue;
      order.push(e);
    }
    order.sort(byDepth);

    var invDet = 1.0 / (planeX * dirY - dirX * planeY);

    for (var s = 0; s < order.length; s++) {
      var ent = order[s];
      var sp = ent.sprite;
      var spx = ent.x - cam.x, spy = ent.y - cam.y;

      var tX = invDet * (dirY * spx - dirX * spy);
      var tY = invDet * (-planeY * spx + planeX * spy);
      if (tY <= 0.08) continue;

      var screenX = ((W / 2) * (1 + tX / tY)) | 0;
      var hPx = (VH / tY) * ent.size;
      var wPx = hPx * (sp.w / sp.h);

      var yBottom = horiz + (VH / (2 * tY)) - (VH / tY) * (ent.z || 0);
      var yTop = yBottom - hPx;

      var xStart = Math.floor(screenX - wPx / 2);
      var xEnd = Math.ceil(screenX + wPx / 2);

      var f = ent.fullbright ? 256 : lightFor(tY);
      var sd = ent.data !== undefined ? ent.data : sp.data;
      var sw = sp.w, sh = sp.h;

      var yA = Math.max(0, Math.floor(yTop));
      var yB = Math.min(VH, Math.ceil(yBottom));
      if (yB <= yA) continue;

      for (var x = xStart; x < xEnd; x++) {
        if (x < 0 || x >= W) continue;
        if (tY >= zbuf[x]) continue;
        var texX = ((x - (screenX - wPx / 2)) * sw / wPx) | 0;
        if (texX < 0 || texX >= sw) continue;
        for (var y = yA; y < yB; y++) {
          var texY = ((y - yTop) * sh / hPx) | 0;
          if (texY < 0 || texY >= sh) continue;
          var c = sd[texY * sw + texX];
          if (c === 0) continue;
          var a = (c >>> 24) & 0xFF;
          if (f !== 256) c = U.shade(c, f);
          var di = y * W + x;
          fb[di] = a === 255 ? c : U.mix(fb[di], c, a);
        }
      }
    }
  }

  function present() {
    ctx2d.putImageData(imageData, 0, 0);
  }

  return {
    init: init, bindFlats: bindFlats, bindLevel: bindLevel,
    clear: clear, fillRect: fillRect, blendRect: blendRect, pixel: pixel,
    blit: blit, blitScaled: blitScaled,
    renderWorld: renderWorld, renderSprites: renderSprites, present: present,
    addLight: addLight, decayLight: decayLight,
    fb: function () { return fb; },
    zbuf: function () { return zbuf; },
    lightFor: lightFor
  };
})();
