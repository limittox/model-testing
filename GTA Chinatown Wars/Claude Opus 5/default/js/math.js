'use strict';
/* ------------------------------------------------------------------
   math.js — tiny 4x4 matrix / vector helpers and general utilities.
   Everything is plain arrays of numbers; no allocation in hot loops
   (pass an `out` array whenever a function can write into one).
------------------------------------------------------------------ */

const TAU = Math.PI * 2;

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
/** frame-rate independent exponential smoothing */
function damp(a, b, rate, dt) { return lerp(a, b, 1 - Math.exp(-rate * dt)); }
function wrapAngle(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
function dampAngle(a, b, rate, dt) { return a + wrapAngle(b - a) * (1 - Math.exp(-rate * dt)); }
function approach(v, target, step) {
  if (v < target) return Math.min(v + step, target);
  return Math.max(v - target > 0 ? v - step : target, target);
}
function rand(a, b) { return a + Math.random() * (b - a); }
function randInt(a, b) { return a + ((Math.random() * (b - a + 1)) | 0); }
function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
function chance(p) { return Math.random() < p; }
function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }
function len2(x, z) { return Math.sqrt(x * x + z * z); }
function smoothstep(e0, e1, x) { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }

/** deterministic-ish hash noise for procedural art */
function hash2(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

/* seeded RNG so a city layout is reproducible while art stays varied */
function makeRNG(seed) {
  let s = seed >>> 0;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/* ---------------------------- mat4 ---------------------------- */
const M4 = {
  create() { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },

  identity(o) {
    o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = 1; o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[10] = 1; o[11] = 0;
    o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
    return o;
  },

  multiply(o, a, b) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
      a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
      a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
      a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    for (let i = 0; i < 4; i++) {
      const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
      o[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      o[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      o[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      o[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    }
    return o;
  },

  perspective(o, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    o[0] = f / aspect; o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = f; o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[10] = (far + near) * nf; o[11] = -1;
    o[12] = 0; o[13] = 0; o[14] = 2 * far * near * nf; o[15] = 0;
    return o;
  },

  ortho(o, l, r, b, t, n, f) {
    const lr = 1 / (l - r), bt = 1 / (b - t), nf = 1 / (n - f);
    o[0] = -2 * lr; o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = -2 * bt; o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[10] = 2 * nf; o[11] = 0;
    o[12] = (l + r) * lr; o[13] = (t + b) * bt; o[14] = (f + n) * nf; o[15] = 1;
    return o;
  },

  lookAt(o, ex, ey, ez, cx, cy, cz, ux, uy, uz) {
    let zx = ex - cx, zy = ey - cy, zz = ez - cz;
    let l = 1 / Math.hypot(zx, zy, zz); zx *= l; zy *= l; zz *= l;
    let xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx;
    l = Math.hypot(xx, xy, xz); if (l < 1e-6) { xx = 1; xy = 0; xz = 0; } else { l = 1 / l; xx *= l; xy *= l; xz *= l; }
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
    o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
    o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
    o[12] = -(xx * ex + xy * ey + xz * ez);
    o[13] = -(yx * ex + yy * ey + yz * ez);
    o[14] = -(zx * ex + zy * ey + zz * ez);
    o[15] = 1;
    return o;
  },

  /* Heading convention for the whole game:
       forward(yaw) = ( sin yaw, 0, -cos yaw )
       right(yaw)   = ( cos yaw, 0,  sin yaw )
     so yaw 0 faces "up" on screen in the default camera. The rotation
     below is built to satisfy exactly that. */

  /** T * Ry(yaw) * S */
  trs(o, x, y, z, yaw, sx, sy, sz) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    o[0] = c * sx; o[1] = 0; o[2] = s * sx; o[3] = 0;
    o[4] = 0; o[5] = sy; o[6] = 0; o[7] = 0;
    o[8] = -s * sz; o[9] = 0; o[10] = c * sz; o[11] = 0;
    o[12] = x; o[13] = y; o[14] = z; o[15] = 1;
    return o;
  },

  /** T * Ry(yaw) * Rx(pitch) * Rz(roll) * S — wheels, limbs, wrecks */
  trsFull(o, x, y, z, yaw, pitch, roll, s) {
    const c = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    o[0] = (c * cr - sy * sp * sr) * s;
    o[1] = (cp * sr) * s;
    o[2] = (sy * cr + c * sp * sr) * s;
    o[3] = 0;
    o[4] = (-c * sr - sy * sp * cr) * s;
    o[5] = (cp * cr) * s;
    o[6] = (-sy * sr + c * sp * cr) * s;
    o[7] = 0;
    o[8] = (-sy * cp) * s;
    o[9] = (-sp) * s;
    o[10] = (c * cp) * s;
    o[11] = 0;
    o[12] = x; o[13] = y; o[14] = z; o[15] = 1;
    return o;
  },

  /** local offset -> world, for an entity at (x,z) with heading yaw */
  localToWorld(out, x, z, yaw, lx, lz) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    out[0] = x + c * lx - s * lz;
    out[1] = z + s * lx + c * lz;
    return out;
  },

  transformPoint(out, m, x, y, z) {
    const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
    out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
    out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
    return out;
  }
};
