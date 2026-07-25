/*
 * sprites.js — procedural enemy / pickup / weapon-viewmodel sprite generation.
 *
 * LOAD ORDER: loaded AFTER config.js (needs CONFIG, packRGBA, mulberry32) and
 * alongside textures.js; BEFORE main.js.
 *
 * SAME FLAT ASSET SHAPE as textures.js:
 *   { width, height, data: Uint8ClampedArray, buf32: Uint32Array }
 * with buf32 aliasing data.buffer. Sprites are NOT square and NOT power-of-two
 * constrained (the sprite pass scales them per-column), so always read
 * width/height from the asset rather than assuming CONFIG.TEX_SIZE.
 *
 * THE COLOR-KEY CONTRACT (locked — Phase 4's sprite pass reuses it):
 *   A texel is TRANSPARENT when its alpha byte is < 128, i.e.
 *       ((packed >>> 24) & 0xff) < 128
 *   Background texels are packed value 0 (alpha 0, fully transparent) and
 *   silhouette texels are packed with alpha 255 — nothing in between. Keeping
 *   edges strictly 0-or-255 means there are no half-alpha fringe pixels, so a
 *   plain skip-if-transparent blit produces no halo against any background.
 *
 * HOW A SPRITE IS BUILT (two passes — this is why edges stay binary):
 *   1. SHAPE pass: draw primitives into a Uint8Array *material mask* where 0 is
 *      empty and each non-zero id names a material. An auto-outline step then
 *      promotes empty texels adjacent to the silhouette into the outline
 *      material, giving every sprite a crisp dark rim.
 *   2. COLOR pass: map each material id through a palette with directional
 *      shading and deterministic dither. Mask 0 -> packed 0; everything else ->
 *      alpha 255. Alpha is therefore never a computed value.
 *
 * DETERMINISM: every sprite's dither comes from mulberry32(CONFIG.SEED + salt)
 * with its own stable salt, so the art is byte-identical across reloads.
 */

var Sprites = {
  // name -> asset dictionary, populated by build(). Insertion order is stable.
  map: {},

  names: ['enemy', 'pickup', 'weapon',
          // Phase 5 (05-CONTEXT D-09): the enemy animation frames the AI picks
          // per frame, plus the enemy's ranged attack projectile.
          'enemyIdle', 'enemyWalk1', 'enemyWalk2', 'enemyAttack', 'fireball'],

  built: false,

  // Any texel whose alpha byte is below this is transparent. Exported so the
  // preview blit (and Phase 4's sprite pass) share one definition.
  ALPHA_KEY: 128,

  build: function () {
    var m = {};
    // Phase 5 enemy animation frames. Every frame is the SAME horned-demon
    // silhouette with per-pose limb offsets, each from its OWN stable salt so the
    // dither is deterministic and independent per frame.
    m.enemyIdle = Sprites.makeEnemy(101, 'idle');
    m.enemyWalk1 = Sprites.makeEnemy(111, 'walk1');
    m.enemyWalk2 = Sprites.makeEnemy(112, 'walk2');
    m.enemyAttack = Sprites.makeEnemy(113, 'attack');
    m.fireball = Sprites.makeFireball(121);
    // LEGACY KEY: 'enemy' is an ALIAS for the idle frame (same asset object, same
    // salt 101 the Phase 4 art shipped with), so every Phase 4 consumer that
    // names 'enemy' — including tools/verify-sprites.cjs's pixel proofs — keeps
    // working byte-for-byte untouched.
    m.enemy = m.enemyIdle;
    m.pickup = Sprites.makePickup(202);
    m.weapon = Sprites.makeWeapon(303);
    Sprites.map = m;
    Sprites.built = true;
    return m;
  }
};

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Shape-pass helpers — all operate on a Uint8Array material mask.
  // ---------------------------------------------------------------------------

  function makeAsset(w, h) {
    var data = new Uint8ClampedArray(w * h * 4);
    return {
      width: w,
      height: h,
      data: data,
      buf32: new Uint32Array(data.buffer)
    };
  }

  function ci(v) {
    v = v | 0;
    return v < 0 ? 0 : (v > 255 ? 255 : v);
  }

  // Bounds-checked mask store (threat T-01-04: no write can escape the buffer).
  function mset(m, w, h, x, y, id) {
    x = x | 0; y = y | 0;
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    m[y * w + x] = id;
  }

  function mrect(m, w, h, x0, y0, rw, rh, id) {
    for (var y = y0; y < y0 + rh; y++) {
      for (var x = x0; x < x0 + rw; x++) mset(m, w, h, x, y, id);
    }
  }

  function mellipse(m, w, h, cx, cy, rx, ry, id) {
    for (var y = cy - ry; y <= cy + ry; y++) {
      var dy = (y - cy) / ry;
      for (var x = cx - rx; x <= cx + rx; x++) {
        var dx = (x - cx) / rx;
        if (dx * dx + dy * dy <= 1) mset(m, w, h, x, y, id);
      }
    }
  }

  // Horizontal span centred on cx — used for tapering torsos/limbs.
  function mspan(m, w, h, cx, y, halfW, id) {
    mrect(m, w, h, Math.round(cx - halfW), y, Math.max(1, Math.round(halfW * 2)), 1, id);
  }

  // Promote every EMPTY texel that touches the silhouette (4-neighbourhood) into
  // `id`, producing a 1px rim. Reads from a snapshot so the outline cannot
  // cascade outward on itself.
  function outline(m, w, h, id) {
    var src = m.slice(0);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        if (src[i] !== 0) continue;
        var hit =
          (x > 0 && src[i - 1] !== 0) ||
          (x < w - 1 && src[i + 1] !== 0) ||
          (y > 0 && src[i - w] !== 0) ||
          (y < h - 1 && src[i + w] !== 0);
        if (hit) m[i] = id;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Color pass — mask -> packed pixels. This is the ONLY place alpha is set, and
  // it is always exactly 0 (empty) or 255 (silhouette).
  // ---------------------------------------------------------------------------
  //
  // palette: id -> [r, g, b] or [r, g, b, 'flat'] to opt out of shading
  // (emissive materials such as eye glow must not be dimmed by the light ramp).
  function colorize(t, mask, palette, rand) {
    var w = t.width, h = t.height, n = w * h;
    // Precompute the dither field in raster order so the PRNG stream does not
    // depend on which texels happen to be filled.
    var dither = new Float32Array(n);
    for (var d = 0; d < n; d++) dither[d] = rand();

    for (var i = 0; i < n; i++) {
      var id = mask[i];
      if (id === 0) {
        t.buf32[i] = 0; // alpha 0 -> transparent under the alpha<128 color key
        continue;
      }
      var p = palette[id];
      if (!p) { t.buf32[i] = 0; continue; }
      if (p[3] === 'flat') {
        t.buf32[i] = packRGBA(ci(p[0]), ci(p[1]), ci(p[2]), 255);
        continue;
      }
      var x = i % w;
      var y = (i / w) | 0;
      var lit = 1.14 - 0.32 * (x / w);   // key light from the left
      var vert = 1.0 - 0.14 * (y / h);   // gentle falloff toward the feet
      var jitter = (dither[i] - 0.5) * 14;
      var f = lit * vert;
      t.buf32[i] = packRGBA(
        ci(p[0] * f + jitter),
        ci(p[1] * f + jitter),
        ci(p[2] * f + jitter),
        255 // ALWAYS fully opaque — binary alpha, no fringe
      );
    }
  }

  // ---------------------------------------------------------------------------
  // ENEMY — 64x64 standing horned demon: horns, glowing eyes, fanged mouth,
  // tapering torso, clawed arms, planted feet. Square and bottom-aligned so the
  // Phase 4 billboard pass can anchor it on the floor.
  //
  // POSE-PARAMETERISED (Phase 5, 05-CONTEXT D-09). ONE builder draws every
  // animation frame: the silhouette is identical and the pose only offsets the
  // limbs, widens the mouth or brightens the eyes. Keeping it one function is
  // what stops the frames drifting apart as separate hand-drawn assets would.
  //
  //   idle    — the shipped Phase 4 pose, UNCHANGED (offsets all zero). The
  //             legacy Sprites.map.enemy key aliases this frame, so Phase 4's
  //             pixel-exact proofs keep passing byte for byte.
  //   walk1   — left leg lifted, arms swung forward/back.
  //   walk2   — the mirror image, so alternating the two reads as a stride.
  //   attack  — both arms RAISED, mouth widened, eyes on the hotter emissive
  //             palette entry (the telegraph the attack windup shows).
  // ---------------------------------------------------------------------------

  // Per-pose limb deltas. Every field is a pixel offset applied to the idle
  // geometry, so idle is exactly the all-zero row and cannot drift.
  var ENEMY_POSES = {
    idle:   { legLdy: 0, legRdy: 0, armLdx: 0, armLdy: 0, armRdx: 0, armRdy: 0,
              armTop: 24, armLen: 19, mouthY: 19, mouthH: 4, hotEyes: false },
    walk1:  { legLdy: -3, legRdy: 0, armLdx: -1, armLdy: 2, armRdx: 1, armRdy: -2,
              armTop: 24, armLen: 19, mouthY: 19, mouthH: 4, hotEyes: false },
    walk2:  { legLdy: 0, legRdy: -3, armLdx: 1, armLdy: -2, armRdx: -1, armRdy: 2,
              armTop: 24, armLen: 19, mouthY: 19, mouthH: 4, hotEyes: false },
    attack: { legLdy: 0, legRdy: 0, armLdx: -2, armLdy: 0, armRdx: 2, armRdy: 0,
              armTop: 15, armLen: 17, mouthY: 18, mouthH: 6, hotEyes: true }
  };

  Sprites.makeEnemy = function (salt, pose) {
    var W = 64, H = 64;
    var t = makeAsset(W, H);
    var rand = mulberry32(CONFIG.SEED + salt);
    var m = new Uint8Array(W * H);
    var P = ENEMY_POSES[pose] || ENEMY_POSES.idle;

    var BODY = 1, LIMB = 2, EYE = 3, BONE = 4, MOUTH = 5, TOOTH = 6, RIM = 7,
        EYEHOT = 8;

    // Legs and feet. legLdy/legRdy lift a leg for the walk cycle.
    mrect(m, W, H, 21, 44 + P.legLdy, 8, 16, LIMB);
    mrect(m, W, H, 35, 44 + P.legRdy, 8, 16, LIMB);
    mrect(m, W, H, 19, 60 + P.legLdy, 12, 4, LIMB);
    mrect(m, W, H, 33, 60 + P.legRdy, 12, 4, LIMB);

    // Arms with bone claws at the wrists. armTop/armLen raise and shorten both
    // arms for the attack pose; armLdx/armRdx swing them for the walk cycle.
    var armLy = P.armTop + P.armLdy, armRy = P.armTop + P.armRdy;
    mrect(m, W, H, 11 + P.armLdx, armLy, 7, P.armLen, LIMB);
    mrect(m, W, H, 46 + P.armRdx, armRy, 7, P.armLen, LIMB);
    mrect(m, W, H, 10 + P.armLdx, armLy + P.armLen, 9, 4, BONE);
    mrect(m, W, H, 45 + P.armRdx, armRy + P.armLen, 9, 4, BONE);

    // Torso: broad shoulders tapering to the waist.
    for (var y = 21; y < 46; y++) {
      var k = (y - 21) / 24;
      mspan(m, W, H, 32, y, 15 - k * 5, BODY);
    }

    // Head, brow ridge, horns.
    mellipse(m, W, H, 32, 14, 11, 10, BODY);
    mrect(m, W, H, 22, 9, 20, 3, LIMB);
    for (var i = 0; i < 7; i++) {
      mrect(m, W, H, 23 - i, 9 - i, 2, 2, BONE);
      mrect(m, W, H, 39 + i, 9 - i, 2, 2, BONE);
    }

    // Glowing eyes — the attack pose burns hotter.
    var eyeId = P.hotEyes ? EYEHOT : EYE;
    mrect(m, W, H, 26, 13, 4, 3, eyeId);
    mrect(m, W, H, 34, 13, 4, 3, eyeId);

    // Fanged mouth (widened on the attack pose).
    mrect(m, W, H, 25, P.mouthY, 14, P.mouthH, MOUTH);
    for (var f = 0; f < 7; f++) mrect(m, W, H, 26 + f * 2, P.mouthY, 1, 2, TOOTH);

    outline(m, W, H, RIM);

    colorize(t, m, {
      1: [152, 68, 46],           // body
      2: [104, 44, 30],           // limbs / shadowed mass
      3: [255, 226, 90, 'flat'],  // emissive eyes
      4: [214, 204, 176],         // horn / claw bone
      5: [38, 14, 12],            // mouth cavity
      6: [232, 226, 206],         // teeth
      7: [22, 10, 10],            // silhouette rim
      8: [255, 120, 60, 'flat']   // emissive eyes, attack telegraph
    }, rand);

    return t;
  };

  // ---------------------------------------------------------------------------
  // FIREBALL — 24x24 emissive orb: a hot flat-shaded core ringed by a cooler
  // shell and a deep outer flame, with the standard dark rim. Every material is
  // 'flat' (opted OUT of the directional light ramp) because a projectile emits
  // its own light — a key-lit fireball would read as a rock. Small on purpose:
  // the sprite pass scales by distance, and CONFIG.PROJ_SCALE keeps it compact.
  // ---------------------------------------------------------------------------
  Sprites.makeFireball = function (salt) {
    var W = 24, H = 24;
    var t = makeAsset(W, H);
    var rand = mulberry32(CONFIG.SEED + salt);
    var m = new Uint8Array(W * H);

    var OUTER = 1, SHELL = 2, CORE = 3, SPARK = 4, RIM = 5;

    // Concentric flame shells, outermost first so the inner ones overwrite.
    mellipse(m, W, H, 12, 12, 9, 9, OUTER);
    mellipse(m, W, H, 12, 12, 6, 6, SHELL);
    mellipse(m, W, H, 12, 11, 3, 3, CORE);

    // Four trailing licks so the orb is not a plain circle at any scale.
    mrect(m, W, H, 11, 1, 2, 3, SHELL);
    mrect(m, W, H, 11, 20, 2, 3, SHELL);
    mrect(m, W, H, 1, 11, 3, 2, SHELL);
    mrect(m, W, H, 20, 11, 3, 2, SHELL);

    // A couple of bright sparks inside the core for a bit of life.
    mset(m, W, H, 11, 10, SPARK);
    mset(m, W, H, 13, 12, SPARK);

    outline(m, W, H, RIM);

    colorize(t, m, {
      1: [186, 44, 16, 'flat'],   // deep outer flame
      2: [244, 132, 28, 'flat'],  // orange shell
      3: [255, 226, 140, 'flat'], // hot core
      4: [255, 255, 236, 'flat'], // sparks
      5: [58, 12, 6, 'flat']      // rim — dark so it reads against a lit wall
    }, rand);

    return t;
  };

  // ---------------------------------------------------------------------------
  // PICKUP — 32x32 medkit: white case, red cross, carry handle. Small on
  // purpose; the sprite pass scales by distance, not by source size.
  // ---------------------------------------------------------------------------
  Sprites.makePickup = function (salt) {
    var W = 32, H = 32;
    var t = makeAsset(W, H);
    var rand = mulberry32(CONFIG.SEED + salt);
    var m = new Uint8Array(W * H);

    var CASE = 1, EDGE = 2, CROSS = 3, HILITE = 4, SHADE = 5, RIM = 6;

    // Carry handle (drawn first, then hollowed out).
    mrect(m, W, H, 12, 1, 8, 5, EDGE);
    mrect(m, W, H, 14, 3, 4, 3, 0);

    // Case body with a dark edge.
    mrect(m, W, H, 2, 6, 28, 22, EDGE);
    mrect(m, W, H, 3, 7, 26, 20, CASE);
    mrect(m, W, H, 3, 23, 26, 4, SHADE);   // shadowed lower band
    mrect(m, W, H, 3, 7, 26, 1, HILITE);   // lit top lip
    mrect(m, W, H, 2, 16, 28, 1, EDGE);    // lid seam

    // Red cross.
    mrect(m, W, H, 14, 10, 4, 14, CROSS);
    mrect(m, W, H, 9, 15, 14, 4, CROSS);

    outline(m, W, H, RIM);

    colorize(t, m, {
      1: [226, 226, 220],  // case
      2: [44, 44, 50],     // dark edge
      3: [206, 42, 42],    // cross
      4: [255, 255, 250],  // highlight
      5: [168, 168, 164],  // shaded band
      6: [16, 16, 20]      // rim
    }, rand);

    return t;
  };

  // ---------------------------------------------------------------------------
  // WEAPON VIEWMODEL — 96x64, wider than tall, meant to be drawn bottom-centre
  // over the 3D view: a pistol seen down its own barrel with two gloved hands.
  // ---------------------------------------------------------------------------
  Sprites.makeWeapon = function (salt) {
    var W = 96, H = 64;
    var t = makeAsset(W, H);
    var rand = mulberry32(CONFIG.SEED + salt);
    var m = new Uint8Array(W * H);

    var METAL = 1, DARK = 2, GLOVE = 3, GLOVEDK = 4, HILITE = 5, BORE = 6, RIM = 7;

    // Barrel receding away from the viewer, muzzle at the top.
    mrect(m, W, H, 42, 8, 12, 28, METAL);
    mrect(m, W, H, 43, 8, 2, 28, HILITE);   // top-lit edge along the barrel
    mrect(m, W, H, 52, 8, 2, 28, DARK);     // shadowed edge
    mrect(m, W, H, 41, 8, 14, 3, DARK);     // muzzle ring
    mrect(m, W, H, 45, 8, 6, 2, BORE);      // bore

    // Slide / receiver.
    mrect(m, W, H, 35, 34, 26, 14, METAL);
    mrect(m, W, H, 35, 44, 26, 4, DARK);
    mrect(m, W, H, 35, 34, 26, 1, HILITE);
    mrect(m, W, H, 50, 37, 8, 4, DARK);     // ejection port
    for (var s = 0; s < 5; s++) mrect(m, W, H, 37 + s * 2, 38, 1, 5, DARK); // slide serrations

    // Grip.
    mrect(m, W, H, 40, 46, 16, 18, DARK);
    mrect(m, W, H, 41, 47, 4, 16, GLOVEDK);

    // Gloved hands wrapped around the grip.
    mellipse(m, W, H, 33, 54, 11, 10, GLOVE);
    mellipse(m, W, H, 63, 56, 11, 10, GLOVE);
    mrect(m, W, H, 24, 54, 18, 10, GLOVE);
    mrect(m, W, H, 54, 56, 18, 8, GLOVE);
    // Knuckle creases.
    for (var k = 0; k < 4; k++) {
      mrect(m, W, H, 27 + k * 4, 50, 1, 6, GLOVEDK);
      mrect(m, W, H, 57 + k * 4, 52, 1, 6, GLOVEDK);
    }
    // Thumbs.
    mrect(m, W, H, 38, 48, 5, 8, GLOVE);
    mrect(m, W, H, 54, 50, 5, 8, GLOVE);

    outline(m, W, H, RIM);

    colorize(t, m, {
      1: [126, 132, 142],  // metal
      2: [58, 62, 70],     // dark metal
      3: [96, 78, 60],     // glove leather
      4: [60, 48, 36],     // glove shadow
      5: [192, 200, 212],  // specular highlight
      6: [18, 18, 22],     // bore
      7: [14, 14, 18]      // rim
    }, rand);

    return t;
  };
})();
