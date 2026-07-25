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
          'enemyIdle', 'enemyWalk1', 'enemyWalk2', 'enemyAttack', 'fireball',
          // Phase 5 (05-03): the ENEM-04 damage-response frames — the pain
          // stagger, the three-frame fall, and the terminal floor corpse.
          'enemyPain', 'enemyDeath1', 'enemyDeath2', 'enemyDeath3', 'enemyCorpse',
          // Phase 5 (05-02): the two weapon VIEWMODELS the overlay pass draws
          // bottom-centre, plus the muzzle flash composited over the barrel.
          'weaponPistol', 'weaponShotgun', 'muzzleFlash'],

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
    // Phase 5 (05-03) ENEM-04 damage response: the pain stagger, the three-frame
    // fall, and the terminal corpse — the SAME builder, the SAME palette, five
    // more poses, each with its own stable salt.
    m.enemyPain = Sprites.makeEnemy(114, 'pain');
    m.enemyDeath1 = Sprites.makeEnemy(131, 'death1');
    m.enemyDeath2 = Sprites.makeEnemy(132, 'death2');
    m.enemyDeath3 = Sprites.makeEnemy(133, 'death3');
    m.enemyCorpse = Sprites.makeEnemy(141, 'corpse');
    m.fireball = Sprites.makeFireball(121);
    // LEGACY KEY: 'enemy' is an ALIAS for the idle frame (same asset object, same
    // salt 101 the Phase 4 art shipped with), so every Phase 4 consumer that
    // names 'enemy' — including tools/verify-sprites.cjs's pixel proofs — keeps
    // working byte-for-byte untouched.
    m.enemy = m.enemyIdle;
    m.pickup = Sprites.makePickup(202);
    // Phase 5 (05-02) WEAPON VIEWMODELS. The pistol is registered under its own
    // NAME now that there are two weapons, and the original 'weapon' key stays a
    // strict-identity ALIAS for it — the same discipline m.enemy uses for the idle
    // frame, so every earlier consumer (and every Phase 4 pixel proof) that names
    // 'weapon' keeps working byte for byte.
    m.weaponPistol = Sprites.makeWeapon(303);
    m.weapon = m.weaponPistol;
    m.weaponShotgun = Sprites.makeShotgun(313);
    m.muzzleFlash = Sprites.makeMuzzleFlash(323);
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
  //
  // 05-03 (ENEM-04) adds the DAMAGE RESPONSE poses to the SAME builder and the
  // SAME palette — the whole point of the pose table is that a new frame is a
  // data row, not a second hand-drawn asset that drifts on the first retune:
  //   pain    — head thrown back and foreshortened, arms flung outward, mouth
  //             wide, body recoiled, eyes hot. The stagger frame.
  //   death1  — buckling at the knees: the hips drop, the legs shorten, the whole
  //             upper body and head come down while the feet stay planted.
  //   death2  — folded forward at roughly half height: a squat, wide torso with
  //             the head dropped in front of it and the arms splayed low.
  //   death3  — collapsed: almost everything in the bottom quarter, arms flung
  //             wide, the horns the highest thing left.
  //   corpse  — the TERMINAL frame, and the only pose that does NOT use the
  //             standing skeleton (see the `flat` branch): a low flattened mass
  //             of body and limb colour with the horn-bone highlights still
  //             catching the light, drawn entirely in the BOTTOM band of the
  //             frame so the floor-anchored billboard lies ON the ground instead
  //             of hovering at eye level.
  // ---------------------------------------------------------------------------

  // THE IDLE GEOMETRY, written out ONCE. Every pose below is a SPARSE OVERRIDE of
  // this row, which is what makes idle literally "the defaults" — it cannot drift,
  // and the Phase 4 pixel proofs that name the legacy `enemy` alias keep passing
  // byte for byte. The face features are all DERIVED from headCX/headCY (brow at
  // headCY-5, eyes at headCY-1, horns climbing from headCY-5, mouth at
  // headCY+mouthDy), so a pose that drops the head drags the whole face with it
  // instead of leaving the eyes floating where the head used to be.
  var ENEMY_BASE = {
    // Legs + feet. The feet sit directly below the legs, so a shorter leg with a
    // lower hip keeps the feet planted on the same floor line.
    hipY: 44, legH: 16, footH: 4, legLdy: 0, legRdy: 0,
    // Arms, with bone claws at the wrists.
    armTop: 24, armLen: 19, armLdx: 0, armLdy: 0, armRdx: 0, armRdy: 0,
    // Torso: a span-per-row taper from shoulders to waist.
    torsoCX: 32, torsoTop: 21, torsoBot: 46, torsoSpan: 24,
    torsoHalf: 15, torsoTaper: 5,
    // Head.
    headCX: 32, headCY: 14, headRX: 11, headRY: 10,
    // Face.
    mouthDy: 5, mouthH: 4, hotEyes: false,
    // The corpse opts OUT of the standing skeleton entirely.
    flat: false
  };

  // Sparse per-pose overrides. Merged over ENEMY_BASE ONCE at module load (the
  // only allocation, and nowhere near a hot path).
  var ENEMY_POSE_DELTAS = {
    idle:   {},
    walk1:  { legLdy: -3, armLdx: -1, armLdy: 2, armRdx: 1, armRdy: -2 },
    walk2:  { legRdy: -3, armLdx: 1, armLdy: -2, armRdx: -1, armRdy: 2 },
    attack: { armLdx: -2, armRdx: 2, armTop: 15, armLen: 17, mouthDy: 4,
              mouthH: 6, hotEyes: true },
    // --- 05-03 (ENEM-04) ---------------------------------------------------
    pain:   { headCY: 13, headRY: 9, mouthDy: 4, mouthH: 7, hotEyes: true,
              armTop: 20, armLen: 15, armLdx: -6, armLdy: -2, armRdx: 6,
              armRdy: -2, torsoHalf: 14, legLdy: -1, legRdy: -1 },
    death1: { hipY: 49, legH: 11, torsoTop: 26, torsoBot: 51,
              headCY: 19, headRY: 9, armTop: 30, armLen: 17,
              armLdx: -3, armRdx: 3 },
    death2: { hipY: 54, legH: 6, torsoTop: 38, torsoBot: 56, torsoSpan: 18,
              torsoHalf: 16, torsoTaper: 2, headCY: 34, headRX: 12, headRY: 7,
              mouthDy: 4, armTop: 42, armLen: 11, armLdx: -6, armLdy: 2,
              armRdx: 6, armRdy: 2 },
    death3: { hipY: 58, legH: 4, torsoTop: 48, torsoBot: 60, torsoSpan: 12,
              torsoHalf: 18, torsoTaper: 1, headCY: 46, headRX: 12, headRY: 5,
              mouthDy: 3, mouthH: 3, armTop: 52, armLen: 7, armLdx: -10,
              armLdy: 2, armRdx: 10, armRdy: 2 },
    corpse: { flat: true }
  };

  var ENEMY_POSES = {};
  (function buildPoseTable() {
    for (var name in ENEMY_POSE_DELTAS) {
      var row = {};
      for (var k in ENEMY_BASE) row[k] = ENEMY_BASE[k];
      var d = ENEMY_POSE_DELTAS[name];
      for (var j in d) row[j] = d[j];
      ENEMY_POSES[name] = row;
    }
  })();

  Sprites.makeEnemy = function (salt, pose) {
    var W = 64, H = 64;
    var t = makeAsset(W, H);
    var rand = mulberry32(CONFIG.SEED + salt);
    var m = new Uint8Array(W * H);
    var P = ENEMY_POSES[pose] || ENEMY_POSES.idle;

    var BODY = 1, LIMB = 2, EYE = 3, BONE = 4, MOUTH = 5, TOOTH = 6, RIM = 7,
        EYEHOT = 8;

    if (P.flat) {
      // THE CORPSE (05-03). Not a pose of the standing skeleton — a spread,
      // flattened mass confined to the BOTTOM band of the frame, so the
      // floor-anchored billboard reads as something lying on the ground. Same
      // palette as every other frame: body mass, limb mass, a dark pooled
      // cavity, and the horn/claw bone still catching the light.
      mellipse(m, W, H, 32, 57, 21, 5, BODY);
      mellipse(m, W, H, 20, 59, 10, 3, LIMB);
      mellipse(m, W, H, 45, 59, 11, 3, LIMB);
      mrect(m, W, H, 7, 58, 13, 3, LIMB);     // one arm flung out to the left
      mrect(m, W, H, 45, 59, 13, 3, LIMB);    // the other, lower
      mrect(m, W, H, 26, 55, 12, 2, MOUTH);   // the dark of the open mouth
      mrect(m, W, H, 14, 55, 3, 2, BONE);     // claw bone
      mrect(m, W, H, 48, 55, 3, 2, BONE);
      mrect(m, W, H, 29, 53, 2, 2, BONE);     // the horns, still the highlight
      mrect(m, W, H, 34, 53, 2, 2, BONE);
      outline(m, W, H, RIM);
    } else {

    // Legs and feet. legLdy/legRdy lift a leg for the walk cycle; hipY/legH drop
    // and shorten them as the enemy buckles through the death frames.
    var footY = P.hipY + P.legH;
    mrect(m, W, H, P.torsoCX - 11, P.hipY + P.legLdy, 8, P.legH, LIMB);
    mrect(m, W, H, P.torsoCX + 3, P.hipY + P.legRdy, 8, P.legH, LIMB);
    mrect(m, W, H, P.torsoCX - 13, footY + P.legLdy, 12, P.footH, LIMB);
    mrect(m, W, H, P.torsoCX + 1, footY + P.legRdy, 12, P.footH, LIMB);

    // Arms with bone claws at the wrists. armTop/armLen raise and shorten both
    // arms for the attack pose; armLdx/armRdx swing them for the walk cycle and
    // fling them outward for pain and the fall.
    var armLy = P.armTop + P.armLdy, armRy = P.armTop + P.armRdy;
    mrect(m, W, H, P.torsoCX - 21 + P.armLdx, armLy, 7, P.armLen, LIMB);
    mrect(m, W, H, P.torsoCX + 14 + P.armRdx, armRy, 7, P.armLen, LIMB);
    mrect(m, W, H, P.torsoCX - 22 + P.armLdx, armLy + P.armLen, 9, 4, BONE);
    mrect(m, W, H, P.torsoCX + 13 + P.armRdx, armRy + P.armLen, 9, 4, BONE);

    // Torso: broad shoulders tapering to the waist.
    for (var y = P.torsoTop; y < P.torsoBot; y++) {
      var k = (y - P.torsoTop) / P.torsoSpan;
      mspan(m, W, H, P.torsoCX, y, P.torsoHalf - k * P.torsoTaper, BODY);
    }

    // Head, brow ridge, horns — every feature DERIVED from the head centre.
    var hx = P.headCX, hy = P.headCY;
    mellipse(m, W, H, hx, hy, P.headRX, P.headRY, BODY);
    mrect(m, W, H, hx - 10, hy - 5, 20, 3, LIMB);
    for (var i = 0; i < 7; i++) {
      mrect(m, W, H, hx - 9 - i, hy - 5 - i, 2, 2, BONE);
      mrect(m, W, H, hx + 7 + i, hy - 5 - i, 2, 2, BONE);
    }

    // Glowing eyes — the attack and pain poses burn hotter.
    var eyeId = P.hotEyes ? EYEHOT : EYE;
    mrect(m, W, H, hx - 6, hy - 1, 4, 3, eyeId);
    mrect(m, W, H, hx + 2, hy - 1, 4, 3, eyeId);

    // Fanged mouth (widened on the attack and pain poses).
    var mouthY = hy + P.mouthDy;
    mrect(m, W, H, hx - 7, mouthY, 14, P.mouthH, MOUTH);
    for (var f = 0; f < 7; f++) mrect(m, W, H, hx - 6 + f * 2, mouthY, 1, 2, TOOTH);

    outline(m, W, H, RIM);
    }

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

  // ---------------------------------------------------------------------------
  // SHOTGUN VIEWMODEL (05-02) — the SAME 96x64 bottom-centre framing and the same
  // mask-then-colorize style as the pistol, so the two swap in the same drawn box:
  // a wide DOUBLE BARREL over a pump fore-end, a WOODEN stock/fore-end tone that
  // reads instantly differently from the pistol's all-metal silhouette, and the
  // same gloved hands so both weapons belong to one character.
  // ---------------------------------------------------------------------------
  Sprites.makeShotgun = function (salt) {
    var W = 96, H = 64;
    var t = makeAsset(W, H);
    var rand = mulberry32(CONFIG.SEED + salt);
    var m = new Uint8Array(W * H);

    var METAL = 1, DARK = 2, GLOVE = 3, GLOVEDK = 4, HILITE = 5, BORE = 6, RIM = 7,
        WOOD = 8, WOODDK = 9;

    // Twin barrels receding away from the viewer, muzzles at the top.
    mrect(m, W, H, 34, 6, 13, 26, METAL);
    mrect(m, W, H, 49, 6, 13, 26, METAL);
    mrect(m, W, H, 35, 6, 2, 26, HILITE);   // top-lit edge, left barrel
    mrect(m, W, H, 50, 6, 2, 26, HILITE);   // top-lit edge, right barrel
    mrect(m, W, H, 45, 6, 2, 26, DARK);     // shadowed edge, left barrel
    mrect(m, W, H, 60, 6, 2, 26, DARK);     // shadowed edge, right barrel
    mrect(m, W, H, 33, 6, 30, 3, DARK);     // one muzzle ring across both bores
    mrect(m, W, H, 37, 6, 7, 2, BORE);
    mrect(m, W, H, 52, 6, 7, 2, BORE);

    // Pump fore-end: a broad wooden block clamped under the barrels, grooved.
    mrect(m, W, H, 30, 28, 36, 12, WOOD);
    mrect(m, W, H, 30, 28, 36, 1, HILITE);
    mrect(m, W, H, 30, 37, 36, 3, WOODDK);
    for (var g = 0; g < 7; g++) mrect(m, W, H, 33 + g * 4, 30, 2, 6, WOODDK);

    // Receiver / trigger housing.
    mrect(m, W, H, 33, 40, 30, 10, METAL);
    mrect(m, W, H, 33, 47, 30, 3, DARK);
    mrect(m, W, H, 33, 40, 30, 1, HILITE);

    // Wooden stock running down out of frame.
    mrect(m, W, H, 38, 48, 20, 16, WOOD);
    mrect(m, W, H, 39, 49, 5, 15, WOODDK);

    // Gloved hands: the left one pumps the fore-end (higher, further out), the
    // right one holds the grip (lower) — same glove materials as the pistol.
    mellipse(m, W, H, 26, 36, 11, 9, GLOVE);
    mellipse(m, W, H, 68, 54, 11, 10, GLOVE);
    mrect(m, W, H, 18, 36, 16, 10, GLOVE);
    mrect(m, W, H, 58, 54, 18, 10, GLOVE);
    for (var k = 0; k < 4; k++) {
      mrect(m, W, H, 21 + k * 4, 32, 1, 6, GLOVEDK);   // knuckle creases
      mrect(m, W, H, 62 + k * 4, 50, 1, 6, GLOVEDK);
    }
    mrect(m, W, H, 31, 30, 5, 8, GLOVE);               // thumbs
    mrect(m, W, H, 58, 48, 5, 8, GLOVE);

    outline(m, W, H, RIM);

    colorize(t, m, {
      1: [126, 132, 142],  // metal (shared with the pistol — one gunmetal)
      2: [58, 62, 70],     // dark metal
      3: [96, 78, 60],     // glove leather (shared — one character's hands)
      4: [60, 48, 36],     // glove shadow
      5: [192, 200, 212],  // specular highlight
      6: [18, 18, 22],     // bore
      7: [14, 14, 18],     // rim
      8: [138, 92, 48],    // WOOD — the shotgun's distinguishing tone
      9: [92, 58, 28]      // wood shadow / grooves
    }, rand);

    return t;
  };

  // ---------------------------------------------------------------------------
  // MUZZLE FLASH (05-02) — a 48x48 four-point emissive burst composited over the
  // barrel for CONFIG.MUZZLE_FLASH_TIME after a shot.
  //
  // EVERY material is 'flat' (opted OUT of the directional light ramp and the
  // dither) because a muzzle flash EMITS light — a key-lit flash would read as a
  // rock — and because flat materials produce a small, EXACT set of packed values,
  // which is what lets the harness count flash pixels in a rendered frame.
  //
  // Deliberately NO outline() call: a dark rim around a flash would read as a hole
  // punched in the frame. That also gives the asset the property the plan asks for
  // — alpha is exactly 0 everywhere outside the burst.
  // ---------------------------------------------------------------------------
  Sprites.makeMuzzleFlash = function (salt) {
    var W = 48, H = 48;
    var t = makeAsset(W, H);
    var rand = mulberry32(CONFIG.SEED + salt);
    var m = new Uint8Array(W * H);

    var OUTER = 1, MID = 2, CORE = 3, SPARK = 4;
    var cx = 24, cy = 24, reach = 22;

    // Two crossing tapered spikes: the taper exponent is what makes them read as
    // spikes rather than as a diamond.
    var i, half;
    for (i = 0; i < reach; i++) {
      half = Math.max(1, Math.round(9 * Math.pow(1 - i / reach, 1.8)));
      mrect(m, W, H, cx - half, cy - i, half * 2, 1, OUTER);   // upward spike
      mrect(m, W, H, cx - half, cy + i, half * 2, 1, OUTER);   // downward spike
    }
    for (i = 0; i < reach; i++) {
      half = Math.max(1, Math.round(9 * Math.pow(1 - i / reach, 1.8)));
      mrect(m, W, H, cx - i, cy - half, 1, half * 2, OUTER);   // leftward spike
      mrect(m, W, H, cx + i, cy - half, 1, half * 2, OUTER);   // rightward spike
    }

    // Concentric hot shells at the centre, innermost last so it wins.
    mellipse(m, W, H, cx, cy, 11, 11, MID);
    mellipse(m, W, H, cx, cy, 6, 6, CORE);
    mellipse(m, W, H, cx, cy, 3, 3, SPARK);

    colorize(t, m, {
      1: [255, 150, 32, 'flat'],   // outer flame
      2: [255, 206, 84, 'flat'],   // mid
      3: [255, 240, 168, 'flat'],  // hot inner
      4: [255, 255, 246, 'flat']   // white-hot core
    }, rand);

    return t;
  };
})();
