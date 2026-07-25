/*
 * entities.js — the spawn-derived billboard list + the sprite render pass.
 *
 * LOAD ORDER: loaded AFTER js/raycaster.js (it uses the z-buffer the wall pass
 * fills and mirrors the raycaster's pose-snapshot discipline) and BEFORE
 * js/game.js (main.js wires Raycaster.spritePass = Entities.render before the
 * loop runs). It reads Framebuffer (buf32, zBuffer, width/height), Player (the
 * vector camera pose), Level.spawns, and Sprites (map + ALPHA_KEY); it is read
 * by nothing before game.js.
 *
 * WHAT THIS IS (Phase 4 tracer — 04-01): the thinnest end-to-end sprite slice —
 * a STATIC billboard list built from Level.spawns, projected through the
 * inverted [dir|plane] camera matrix (Lodev sprite casting), depth-sorted
 * far->near, and drawn into buf32 with the FIRST per-column z-buffer occlusion
 * cut and the Phase-1 alpha-key transparency skip.
 *
 * THE SPRITE-PASS CONTRACT (locked — 04-CONTEXT decisions 2,3,4):
 *
 *   (1) RUNS AFTER THE WALL PASS, BEFORE PRESENT. Raycaster.render() invokes
 *       Raycaster.spritePass() (== Entities.render) as its LAST statement, once
 *       Pass B has filled Framebuffer.zBuffer for every column. Game.render()
 *       still owns the single putImageData, so present-count == frame-count is
 *       untouched.
 *
 *   (2) READS THE Z-BUFFER, NEVER WRITES IT. A stripe is drawn ONLY when
 *       transformY (the sprite's perpendicular depth) is nearer than the wall
 *       distance already in zBuffer[stripe]. Sprites do not write zBuffer, so a
 *       later (nearer) sprite in the same frame still tests only against wall
 *       distance — this matches Doom and is what the back-to-front sort relies
 *       on to let a nearer sprite overwrite a farther one.
 *
 *   (3) ALLOCATION-FREE HOT PATH. The list is preallocated and the sort runs
 *       over two preallocated scratch buffers (_order indices + _dist2 squared
 *       distances) with an in-place INSERTION sort — no Array.sort closure, no
 *       per-frame allocation.
 *
 * DEFERRED (04-02, not an architecture gap): sprite fog-shading via
 * Raycaster.shadeFactor/applyShade by transformY. This tracer writes texels
 * UNSHADED so the projection + occlusion coupling is proven in isolation first;
 * 04-02 is a functionality fill that adds the shade on the written texel.
 *
 * BEHAVIOUR fields (health/state/AI) are NOT here — Phase 5 owns them. Phase 4
 * renders static billboards only.
 */

var Entities = {
  // The billboard list: preallocated plain objects {x, y, sprite, scale,
  // onFloor}, rebuilt fresh (idempotently) by build() from Level.spawns.
  list: [],

  // Spawn-type -> billboard descriptor (04-CONTEXT decision 1). 'exit' and
  // 'player' are intentionally absent: no exit sprite exists this phase (Phase 6
  // owns exit markers) and the player is the camera, not a billboard.
  SPRITE_FOR: {
    enemy:   { sprite: 'enemy',  scale: 1.0, onFloor: true },
    health:  { sprite: 'pickup', scale: 0.5, onFloor: true },
    armor:   { sprite: 'pickup', scale: 0.5, onFloor: true },
    ammo:    { sprite: 'pickup', scale: 0.5, onFloor: true },
    shotgun: { sprite: 'pickup', scale: 0.5, onFloor: true }
  },

  // Small positive depth clip: a sprite at or behind the camera plane
  // (transformY <= NEAR) is skipped so the 1/transformY projection never blows
  // up (04-CONTEXT decision 3).
  NEAR: 0.05,

  // Allocation-free sort scratch — index permutation and squared distances,
  // (re)sized by _ensureScratch() only when the list grows.
  _order: new Int32Array(0),
  _dist2: new Float64Array(0),

  built: false
};

(function () {
  'use strict';

  // Grow the sort scratch to hold at least n entries. Reallocates ONCE when the
  // list outgrows the current capacity — never per frame (the hot path only ever
  // reads these). Capacity can exceed n; render() indexes strictly by list
  // length, so trailing slack is harmless.
  Entities._ensureScratch = function (n) {
    if (Entities._order.length < n) {
      Entities._order = new Int32Array(n);
      Entities._dist2 = new Float64Array(n);
    }
  };

  // ===========================================================================
  // BUILD — instantiate the billboard list from Level.spawns. Idempotent: it
  // rebuilds Entities.list fresh, so calling it twice yields an identical list
  // and never grows unbounded. Call AFTER Level.build() and Sprites.build().
  // ===========================================================================
  Entities.build = function () {
    var spawns = (typeof Level !== 'undefined' && Level.spawns) ? Level.spawns : [];
    var out = [];
    for (var i = 0; i < spawns.length; i++) {
      var sp = spawns[i];
      var desc = Entities.SPRITE_FOR[sp.type];
      if (!desc) continue;               // exit/player/unknown -> not a billboard
      out.push({
        x: sp.x,                         // cell-centre world coords (from Level)
        y: sp.y,
        sprite: desc.sprite,
        scale: desc.scale,
        onFloor: desc.onFloor
      });
    }
    Entities.list = out;
    Entities._ensureScratch(out.length);
    Entities.built = true;
    return out;
  };

  // ===========================================================================
  // RENDER — the per-frame sprite pass (04-CONTEXT decisions 2,3,4). Runs AFTER
  // the wall pass has filled zBuffer and BEFORE Game.render's present(). Reads
  // Framebuffer.width/height/buf32/zBuffer LIVE (internal height is aspect-
  // derived every frame). Writes buf32 only; NEVER writes zBuffer.
  // ===========================================================================
  Entities.render = function () {
    var list = Entities.list;
    var n = list.length;
    if (n === 0) return;

    var W = Framebuffer.width;
    var H = Framebuffer.height;
    var buf = Framebuffer.buf32;
    var zbuf = Framebuffer.zBuffer;

    // Pose + alpha key snapshot into locals ONCE (no per-entity property reads).
    var px = Player.x, py = Player.y;
    var dirX = Player.dirX, dirY = Player.dirY;
    var planeX = Player.planeX, planeY = Player.planeY;
    var ALPHA_KEY = Sprites.ALPHA_KEY;
    var NEAR = Entities.NEAR;

    Entities._ensureScratch(n);
    var order = Entities._order;
    var dist2 = Entities._dist2;

    // 1. Squared distance to the player for each entity, and the identity
    //    permutation. Squared distance suffices: the sort only needs an ordering
    //    and squaring is monotonic, so no sqrt in the hot path.
    var i, e, rx, ry;
    for (i = 0; i < n; i++) {
      e = list[i];
      rx = e.x - px; ry = e.y - py;
      dist2[i] = rx * rx + ry * ry;
      order[i] = i;
    }

    // In-place INSERTION sort of `order` by dist2 DESCENDING (far first) — an
    // allocation-free sort over the preallocated index array. Array.sort with a
    // closure comparator is forbidden here (it allocates and boxes). Insertion
    // sort is the right call: the list is tiny and near-sorted frame to frame.
    var a, b, idx, key;
    for (a = 1; a < n; a++) {
      idx = order[a];
      key = dist2[idx];
      b = a - 1;
      while (b >= 0 && dist2[order[b]] < key) {
        order[b + 1] = order[b];
        b--;
      }
      order[b + 1] = idx;
    }

    // 2. Inverse camera matrix determinant — constant for the whole frame.
    var invDet = 1 / (planeX * dirY - dirX * planeY);
    var halfW = W / 2;
    var halfH = H / 2;

    // 3-8. Project + draw each entity far->near so nearer billboards overwrite
    //      farther ones (the sort is what makes this correct without a sprite
    //      z-buffer write).
    var k;
    for (k = 0; k < n; k++) {
      e = list[order[k]];
      var relX = e.x - px, relY = e.y - py;

      // Camera-space coordinates. transformY is the sprite DEPTH (perpendicular
      // distance) that the z-buffer occlusion test compares against.
      var transformX = invDet * (dirY * relX - dirX * relY);
      var transformY = invDet * (-planeY * relX + planeX * relY);
      if (transformY <= NEAR) continue;                 // behind camera / at plane

      // 4. Projection. Screen HEIGHT H drives BOTH width and height scale so the
      //    billboard stays square on any viewport aspect (using W would stretch
      //    it on widescreen — 04-CONTEXT decision 3).
      var spriteScreenX = Math.floor(halfW * (1 + transformX / transformY));
      var spriteDim = Math.abs(Math.floor(H / transformY)) * e.scale;
      // Floor-resting sprites: drop the sprite so its BASE sits on the floor line
      // rather than centring on the horizon (a scale<1 pickup would otherwise
      // float). vMove is 0 for a non-floor sprite.
      var vMove = e.onFloor ? (H * (1 - e.scale) / 2) : 0;
      var vMoveScreen = Math.floor(vMove / transformY);

      // 5. UNCLAMPED span origins — kept as the texel-mapping reference even
      //    after the loop bounds are clamped (the same discipline as the wall
      //    pass's unclamped texPos).
      var originX = -spriteDim / 2 + spriteScreenX;
      var originY = -spriteDim / 2 + halfH + vMoveScreen;

      // Clamped INTEGER loop bounds. drawEndX/Y are exclusive.
      var drawStartX = Math.floor(originX);
      var drawEndX = Math.floor(originX + spriteDim);
      if (drawStartX < 0) drawStartX = 0;
      if (drawEndX > W) drawEndX = W;
      var drawStartY = Math.floor(originY);
      var drawEndY = Math.floor(originY + spriteDim);
      if (drawStartY < 0) drawStartY = 0;
      if (drawEndY > H) drawEndY = H;

      // 6. Resolve the sprite asset. Sprites are NOT square / not power-of-two,
      //    so read width/height from the asset (never assume TEX_SIZE).
      var tex = Sprites.map[e.sprite];
      if (!tex) continue;
      var TEXW = tex.width, TEXH = tex.height, tbuf = tex.buf32;

      // 7. Per stripe: OCCLUSION (04-CONTEXT decision 4, ENT-02). Draw the column
      //    ONLY when the sprite is nearer than the wall recorded in zBuffer for
      //    that column. transformY > 0 holds (NEAR clip above) and the stripe is
      //    already within [0,W); both are re-tested to keep the guard literal and
      //    self-contained.
      var stripe;
      for (stripe = drawStartX; stripe < drawEndX; stripe++) {
        if (!(transformY > 0 && stripe >= 0 && stripe < W &&
              transformY < zbuf[stripe])) continue;

        var texX = Math.floor((stripe - originX) * TEXW / spriteDim);
        if (texX < 0) texX = 0; else if (texX > TEXW - 1) texX = TEXW - 1;

        var col = texX;
        var yy;
        for (yy = drawStartY; yy < drawEndY; yy++) {
          var texY = Math.floor((yy - originY) * TEXH / spriteDim);
          if (texY < 0) texY = 0; else if (texY > TEXH - 1) texY = TEXH - 1;

          var packed = tbuf[texY * TEXW + col];
          // 8. TRANSPARENCY (04-CONTEXT decision 5, ENT-03) — the Phase-1 color
          //    key: a texel with alpha byte < ALPHA_KEY (128) is transparent;
          //    leave the background pixel intact. Opaque texels are written
          //    UNSHADED in this tracer (04-02 adds the depth fog). Never writes
          //    zBuffer.
          if (((packed >>> 24) & 0xff) < ALPHA_KEY) continue;
          buf[yy * W + stripe] = packed;
        }
      }
    }
  };

})();
