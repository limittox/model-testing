'use strict';
/* ------------------------------------------------------------------
   collide.js — everything moves as one or more circles on the ground
   plane; the world is axis-aligned boxes. Cheap, stable, and good
   enough for an arcade city.
------------------------------------------------------------------ */

const Collide = {
  out: { x: 0, z: 0, hit: false, nx: 0, nz: 0, depth: 0 },

  /** Push a circle out of every solid it overlaps. Mutates + returns `out`. */
  circle(x, z, r) {
    const o = this.out;
    o.x = x; o.z = z; o.hit = false; o.nx = 0; o.nz = 0; o.depth = 0;
    City.beginQuery();
    City.eachSolid(x, z, r + 1, (b) => {
      const cx = clamp(o.x, b.x0, b.x1);
      const cz = clamp(o.z, b.z0, b.z1);
      let dx = o.x - cx, dz = o.z - cz;
      let d2 = dx * dx + dz * dz;
      if (d2 > r * r) return;

      if (d2 < 1e-8) {
        // centre is inside the box — escape along the shallowest face
        const l = o.x - b.x0, rr = b.x1 - o.x, u = o.z - b.z0, d = b.z1 - o.z;
        const m = Math.min(l, rr, u, d);
        if (m === l) { dx = -1; dz = 0; } else if (m === rr) { dx = 1; dz = 0; }
        else if (m === u) { dx = 0; dz = -1; } else { dx = 0; dz = 1; }
        o.x = dx < 0 ? b.x0 - r : dx > 0 ? b.x1 + r : o.x;
        o.z = dz < 0 ? b.z0 - r : dz > 0 ? b.z1 + r : o.z;
        o.hit = true; o.nx = dx; o.nz = dz; o.depth = r;
        return;
      }
      const d = Math.sqrt(d2);
      const push = r - d;
      const nx = dx / d, nz = dz / d;
      o.x += nx * push; o.z += nz * push;
      o.hit = true; o.depth = Math.max(o.depth, push);
      o.nx += nx * push; o.nz += nz * push;
    });
    if (o.hit) {
      const l = Math.hypot(o.nx, o.nz);
      if (l > 1e-6) { o.nx /= l; o.nz /= l; }
    }
    return o;
  },

  /** Ray vs one box on the ground plane. Returns t in [0,1] or -1. */
  _rayBox(px, pz, dx, dz, b) {
    let tmin = 0, tmax = 1;
    if (Math.abs(dx) < 1e-8) { if (px < b.x0 || px > b.x1) return -1; }
    else {
      let t1 = (b.x0 - px) / dx, t2 = (b.x1 - px) / dx;
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
    if (Math.abs(dz) < 1e-8) { if (pz < b.z0 || pz > b.z1) return -1; }
    else {
      let t1 = (b.z0 - pz) / dz, t2 = (b.z1 - pz) / dz;
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
    return tmin;
  },

  /** Nearest wall hit along a segment. Returns {t, x, z} or null. */
  ray(x0, z0, x1, z1, minHeight) {
    const dx = x1 - x0, dz = z1 - z0;
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const r = Math.hypot(dx, dz) / 2 + 2;
    let best = 2;
    City.beginQuery();
    City.eachSolid(mx, mz, r, (b) => {
      if (minHeight !== undefined && b.h < minHeight) return;
      const t = this._rayBox(x0, z0, dx, dz, b);
      if (t >= 0 && t < best) best = t;
    });
    if (best > 1) return null;
    return { t: best, x: x0 + dx * best, z: z0 + dz * best };
  },

  /** true when a straight line between two points is unobstructed */
  clear(x0, z0, x1, z1) {
    return this.ray(x0, z0, x1, z1, 1.2) === null;
  }
};
