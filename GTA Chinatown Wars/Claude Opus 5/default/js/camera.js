'use strict';
/* ------------------------------------------------------------------
   camera.js — the 2.5D chase camera.
   High above the district, tilted steeply down, perspective projection
   so buildings visibly lean and have depth. It eases toward the player,
   pulls back and flattens with speed, and (in chase mode) slowly swings
   round to line up behind the car.
------------------------------------------------------------------ */

const Camera = {
  // orbit state
  yaw: 0, pitch: 0.99, dist: 30,
  fov: 44 * Math.PI / 180,
  near: 0.6, far: 900,

  // smoothed look target
  tx: 0, ty: 0, tz: 0,
  ex: 0, ey: 40, ez: 40,

  // basis (rebuilt every frame)
  fx: 0, fy: 0, fz: -1,
  rx: 1, ry: 0, rz: 0,
  ux: 0, uy: 1, uz: 0,

  aspect: 16 / 9,
  view: M4.create(),
  proj: M4.create(),
  viewProj: M4.create(),

  mode: 'chase',      // 'chase' | 'north'
  shake: 0, shakeT: 0,

  reset(x, z, yaw) {
    this.tx = x; this.tz = z; this.ty = 1.2;
    this.yaw = yaw || 0;
    this._apply();
  },

  addShake(a) { this.shake = Math.min(1.6, this.shake + a); },

  /**
   * focus: { x, y, z, yaw, speed, inCar, vx, vz }
   */
  update(dt, f) {
    const speed = Math.abs(f.speed || 0);
    const sN = clamp(speed / 34, 0, 1);

    // look a little ahead of where the player is going
    const lead = f.inCar ? 7.5 * sN : 2.0;
    const dirx = Math.sin(f.yaw), dirz = -Math.cos(f.yaw);
    const wantX = f.x + dirx * lead;
    const wantZ = f.z + dirz * lead;

    const follow = f.inCar ? 6.5 : 8.5;
    this.tx = damp(this.tx, wantX, follow, dt);
    this.tz = damp(this.tz, wantZ, follow, dt);
    this.ty = damp(this.ty, f.y + 1.2, 6, dt);

    // distance + tilt react to speed
    let wantDist = (f.inCar ? 37 : 31) + sN * 16;
    let wantPitch = (f.inCar ? 0.87 : 0.92) - sN * 0.10;

    // If a building sits between the player and the eye, stand the camera
    // up (and pull it in) until the shot is clear rather than clipping
    // through the wall. Capped, so it never flips to a flat top-down view.
    let boost = 0, shrink = 1;
    for (let k = 0; k <= 4; k++) {
      const p = wantPitch + k * 0.062;
      const d = wantDist * (1 - k * 0.062);
      boost = p - wantPitch; shrink = 1 - k * 0.062;
      if (!this._occluded(this.tx, this.ty, this.tz, p, d)) break;
    }
    // Last resort: if the eye itself would end up buried in a wall (a
    // respawn or a shove can put the player inside a block), climb over
    // the roof rather than render the inside of a building.
    for (let k = 0; k < 8 && this._eyeInside(wantPitch + boost, wantDist * shrink); k++) {
      boost += 0.06;
      shrink = Math.max(0.5, shrink - 0.05);
    }
    this.occ = damp(this.occ || 0, boost, 7, dt);
    this.occD = damp(this.occD === undefined ? 1 : this.occD, shrink, 7, dt);
    this.dist = damp(this.dist, wantDist * this.occD, 4.5, dt);
    this.pitch = damp(this.pitch, wantPitch + this.occ, 4.0, dt);

    // heading
    if (this.mode === 'chase' && f.inCar) {
      // Camera and entities share one heading convention:
      //   forward(yaw) = (sin yaw, 0, -cos yaw)   — yaw 0 faces "up" on screen.
      // So sitting behind the car is simply matching its yaw.
      const blend = 1.4 + sN * 3.2;
      this.yaw = dampAngle(this.yaw, f.yaw, blend, dt);
    } else {
      this.yaw = dampAngle(this.yaw, 0, 3.0, dt);
    }

    if (this.shake > 0) {
      this.shakeT += dt * 34;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }
    this._apply();
  },

  /** true if the eye position sits inside a solid */
  _eyeInside(pitch, dist) {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const ex = this.tx - sy * cp * dist, ey = this.ty + sp * dist, ez = this.tz + cy * cp * dist;
    let bad = false;
    City.beginQuery();
    City.eachSolid(ex, ez, 1.5, (b) => {
      if (bad || b.h <= ey + 1.0) return;
      if (ex > b.x0 - 1.2 && ex < b.x1 + 1.2 && ez > b.z0 - 1.2 && ez < b.z1 + 1.2) bad = true;
    });
    return bad;
  },

  /** true if any building blocks the line from the focus point to the eye */
  _occluded(tx, ty, tz, pitch, dist) {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const ex = tx - sy * cp * dist, ey = ty + sp * dist, ez = tz + cy * cp * dist;
    const N = 8;
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      const px = lerp(tx, ex, t), py = lerp(ty, ey, t), pz = lerp(tz, ez, t);
      let bad = false;
      City.beginQuery();
      City.eachSolid(px, pz, 1.0, (b) => {
        if (bad || b.h <= py + 0.4) return;
        if (px > b.x0 - 0.8 && px < b.x1 + 0.8 && pz > b.z0 - 0.8 && pz < b.z1 + 0.8) bad = true;
      });
      if (bad) return true;
    }
    return false;
  },

  _apply() {
    // forward is the horizontal direction the camera looks along
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);

    let tx = this.tx, ty = this.ty, tz = this.tz;
    if (this.shake > 0.001) {
      const s = this.shake * this.shake * 0.85;
      tx += Math.sin(this.shakeT * 1.7) * s;
      ty += Math.sin(this.shakeT * 2.3) * s * 0.6;
      tz += Math.cos(this.shakeT * 1.3) * s;
    }

    // look direction (sy, 0, -cy); the eye sits back along it and up by the pitch
    this.ex = tx - sy * cp * this.dist;
    this.ey = ty + sp * this.dist;
    this.ez = tz + cy * cp * this.dist;

    M4.lookAt(this.view, this.ex, this.ey, this.ez, tx, ty, tz, 0, 1, 0);
    M4.perspective(this.proj, this.fov, this.aspect, this.near, this.far);
    M4.multiply(this.viewProj, this.proj, this.view);

    // camera basis, extracted from the view matrix (rows)
    this.rx = this.view[0]; this.ry = this.view[4]; this.rz = this.view[8];
    this.ux = this.view[1]; this.uy = this.view[5]; this.uz = this.view[9];
    this.fx = -this.view[2]; this.fy = -this.view[6]; this.fz = -this.view[10];
  },

  /** Ground-plane heading the player's "up" input should move along. */
  groundForward(out) {
    let x = this.fx, z = this.fz;
    const l = Math.hypot(x, z) || 1;
    out[0] = x / l; out[1] = z / l;
    return out;
  },
  groundRight(out) {
    let x = this.rx, z = this.rz;
    const l = Math.hypot(x, z) || 1;
    out[0] = x / l; out[1] = z / l;
    return out;
  },

  /** Screen pixel -> point on the horizontal plane y = planeY. */
  screenToGround(px, py, w, h, planeY, out) {
    const ndcX = (px / w) * 2 - 1;
    const ndcY = 1 - (py / h) * 2;
    const th = Math.tan(this.fov / 2);
    const cxv = ndcX * th * this.aspect, cyv = ndcY * th;
    const dx = this.rx * cxv + this.ux * cyv + this.fx;
    const dy = this.ry * cxv + this.uy * cyv + this.fy;
    const dz = this.rz * cxv + this.uz * cyv + this.fz;
    if (Math.abs(dy) < 1e-5) { out[0] = this.ex; out[1] = this.ez; return out; }
    const t = (planeY - this.ey) / dy;
    out[0] = this.ex + dx * t;
    out[1] = this.ez + dz * t;
    return out;
  },

  /** World point -> screen pixel (used for HUD arrows over the world). */
  project(x, y, z, w, h, out) {
    const m = this.viewProj;
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    if (cw <= 0.0001) { out[0] = 0; out[1] = 0; out[2] = -1; return out; }
    out[0] = (cx / cw * 0.5 + 0.5) * w;
    out[1] = (1 - (cy / cw * 0.5 + 0.5)) * h;
    out[2] = cw;
    return out;
  }
};
