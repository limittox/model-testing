'use strict';
/* ------------------------------------------------------------------
   mesh.js — MeshBuilder. Everything visible in the game (city, cars,
   people, props) is assembled from prisms, quads and cylinders here.

   Conventions
     • +X east, +Y up, +Z south. Ground plane is y = 0.
     • Corner order for a prism footprint is CCW seen from above:
         0=(x0,z1) 1=(x1,z1) 2=(x1,z0) 3=(x0,z0)
     • `o.hull` is the point outline vertices are pushed away from.
       Pass `o.noHull = true` for flat decals that must not be inked.
------------------------------------------------------------------ */

const WHITE = [1, 1, 1];

class MeshBuilder {
  constructor() {
    this.v = [];
    this.i = [];
    this.n = 0;
    this.tx = 0; this.ty = 0; this.tz = 0; this.tc = 1; this.ts = 0; this.xf = false;
  }

  /** All subsequent geometry is rotated by `yaw` then moved to x,y,z. */
  setXform(x, y, z, yaw) {
    this.tx = x; this.ty = y; this.tz = z;
    this.tc = Math.cos(yaw); this.ts = Math.sin(yaw);
    this.xf = true;
  }
  clearXform() { this.xf = false; this.tx = this.ty = this.tz = 0; this.tc = 1; this.ts = 0; }

  vert(x, y, z, nx, ny, nz, u, vv, layer, r, g, b, e, hx, hy, hz, bone) {
    if (this.xf) {
      const c = this.tc, s = this.ts;
      const X = x * c + z * s, Z = -x * s + z * c;
      x = X + this.tx; y = y + this.ty; z = Z + this.tz;
      const NX = nx * c + nz * s, NZ = -nx * s + nz * c; nx = NX; nz = NZ;
      const HX = hx * c + hz * s, HZ = -hx * s + hz * c; hx = HX; hz = HZ;
    }
    this.v.push(x, y, z, nx, ny, nz, u, vv, layer, r, g, b, e, hx, hy, hz, bone);
    return this.n++;
  }

  tri(a, b, c) { this.i.push(a, b, c); }

  /* ---- core primitive: one textured, inked quad ---- */
  /** p = [ax,ay,az, bx,by,bz, cx,cy,cz, dx,dy,dz] wound CCW from the front */
  quad(p, o) {
    o = o || {};
    const layer = o.layer === undefined ? TEX.BLANK : o.layer;
    const col = o.color || WHITE;
    const e = o.emis || 0;
    const bone = o.bone || 0;
    const s = o.uv === undefined ? 0.25 : o.uv;   // texture repeats per world unit
    const uo = o.uOff || 0, vo = o.vOff || 0;

    // geometric normal
    let nx = 0, ny = 0, nz = 0;
    {
      const ax = p[3] - p[0], ay = p[4] - p[1], az = p[5] - p[2];
      const bx = p[6] - p[0], by = p[7] - p[1], bz = p[8] - p[2];
      nx = ay * bz - az * by; ny = az * bx - ax * bz; nz = ax * by - ay * bx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    }
    if (o.flipN) { nx = -nx; ny = -ny; nz = -nz; }

    const hc = o.hull;
    const noHull = !!o.noHull;
    const ax_ = Math.abs(nx), ay_ = Math.abs(ny), az_ = Math.abs(nz);
    const ids = [0, 0, 0, 0];
    const UVQ = o.uvQuad ? [0, 1, 1, 1, 1, 0, 0, 0] : null;

    for (let k = 0; k < 4; k++) {
      const x = p[k * 3], y = p[k * 3 + 1], z = p[k * 3 + 2];
      let u, v;
      if (UVQ) { u = UVQ[k * 2] + uo; v = UVQ[k * 2 + 1] + vo; }
      else if (ay_ >= ax_ && ay_ >= az_) { u = x * s + uo; v = z * s + vo; }
      else if (ax_ >= az_) { u = z * s + uo; v = -y * s + vo; }
      else { u = x * s + uo; v = -y * s + vo; }

      let hx = 0, hy = 0, hz = 0;
      if (!noHull) {
        if (hc) { hx = x - hc[0]; hy = y - hc[1]; hz = z - hc[2]; }
        else { hx = nx; hy = ny; hz = nz; }
        const hl = Math.hypot(hx, hy, hz) || 1; hx /= hl; hy /= hl; hz /= hl;
      }

      let r = col[0], g = col[1], b = col[2];
      if (o.ao) {                            // bake a dark gradient near the ground
        const [y0, y1, k2] = o.ao;
        const t = clamp((y - y0) / (y1 - y0), 0, 1);
        const m = lerp(k2, 1, t);
        r *= m; g *= m; b *= m;
      }
      if (o.jitter) {                        // subtle per-face value variation
        const j = o.jitter;
        r *= j; g *= j; b *= j;
      }
      ids[k] = this.vert(x, y, z, nx, ny, nz, u, v, layer, r, g, b, e, hx, hy, hz, bone);
    }
    this.tri(ids[0], ids[1], ids[2]);
    this.tri(ids[0], ids[2], ids[3]);
  }

  /** Flat horizontal quad (road surface, painted markings, grass…). */
  slab(x0, z0, x1, z1, y, o) {
    this.quad([x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0], o);
  }

  /** General prism: bottom footprint b[8], top footprint t[8], CCW from above. */
  prism(b, y0, t, y1, o) {
    o = o || {};
    let hull = o.hull;
    if (hull === undefined && !o.noHull) {
      let cx = 0, cz = 0;
      for (let k = 0; k < 4; k++) { cx += b[k * 2] + t[k * 2]; cz += b[k * 2 + 1] + t[k * 2 + 1]; }
      hull = [cx / 8, (y0 + y1) / 2, cz / 8];
    }
    const oo = Object.assign({}, o, { hull });
    const side = o.sideOpt ? Object.assign({}, oo, o.sideOpt) : oo;
    const topO = o.topOpt ? Object.assign({}, oo, o.topOpt) : oo;

    for (let k = 0; k < 4; k++) {
      if (o.skipSides && o.skipSides[k]) continue;
      const k2 = (k + 1) & 3;
      const jitter = o.faceJitter ? (1 - o.faceJitter * (k & 1 ? 0.6 : 0)) : undefined;
      this.quad([
        b[k * 2], y0, b[k * 2 + 1],
        b[k2 * 2], y0, b[k2 * 2 + 1],
        t[k2 * 2], y1, t[k2 * 2 + 1],
        t[k * 2], y1, t[k * 2 + 1]
      ], jitter ? Object.assign({}, side, { jitter }) : side);
    }
    if (!o.noTop) {
      this.quad([t[0], y1, t[1], t[2], y1, t[3], t[4], y1, t[5], t[6], y1, t[7]], topO);
    }
    if (!o.noBottom) {
      this.quad([b[6], y0, b[7], b[4], y0, b[5], b[2], y0, b[3], b[0], y0, b[1]], oo);
    }
  }

  static rect(x0, z0, x1, z1) { return [x0, z1, x1, z1, x1, z0, x0, z0]; }

  box(x0, y0, z0, x1, y1, z1, o) {
    const f = MeshBuilder.rect(x0, z0, x1, z1);
    this.prism(f, y0, f, y1, o);
  }

  /** Box whose top face is pulled in by (ix, iz) — buildings, car bodies. */
  taper(x0, y0, z0, x1, y1, z1, ix, iz, o) {
    const b = MeshBuilder.rect(x0, z0, x1, z1);
    const t = MeshBuilder.rect(x0 + ix, z0 + iz, x1 - ix, z1 - iz);
    this.prism(b, y0, t, y1, o);
  }

  /** Cylinder / cone. axis 'y' (default), 'x' or 'z'. */
  cyl(cx, cy, cz, r0, r1, h, seg, o) {
    o = o || {};
    const axis = o.axis || 'y';
    const layer = o.layer === undefined ? TEX.BLANK : o.layer;
    const col = o.color || WHITE, e = o.emis || 0, bone = o.bone || 0;
    const s = o.uv === undefined ? 0.25 : o.uv;
    const put = (a, rad, hh) => {
      // local: a around the axis, rad from axis, hh along the axis.
      // The 'y' ring runs the other way so all three axes share a winding rule.
      const ca = Math.cos(a), sa = Math.sin(a);
      if (axis === 'y') return [cx + ca * rad, cy + hh, cz - sa * rad];
      if (axis === 'x') return [cx + hh, cy + ca * rad, cz + sa * rad];
      return [cx + ca * rad, cy + sa * rad, cz + hh];
    };
    const centerPt = axis === 'y' ? [cx, cy + h / 2, cz] : axis === 'x' ? [cx + h / 2, cy, cz] : [cx, cy, cz + h / 2];
    const hull = o.hull === undefined ? centerPt : o.hull;

    const ring0 = [], ring1 = [];
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * TAU;
      ring0.push(put(a, r0, 0));
      ring1.push(put(a, r1, h));
    }
    for (let k = 0; k < seg; k++) {
      const k2 = (k + 1) % seg;
      const q = [
        ring0[k][0], ring0[k][1], ring0[k][2],
        ring0[k2][0], ring0[k2][1], ring0[k2][2],
        ring1[k2][0], ring1[k2][1], ring1[k2][2],
        ring1[k][0], ring1[k][1], ring1[k][2]
      ];
      this.quad(q, { layer, color: col, emis: e, bone, uv: s, hull, noHull: o.noHull, ao: o.ao });
    }
    if (!o.noCaps) {
      const capO = { layer: o.capLayer === undefined ? layer : o.capLayer, color: o.capColor || col, emis: e, bone, uv: s, hull, noHull: o.noHull };
      // far cap (hh = h) faces +axis, near cap (hh = 0) faces -axis
      for (const [ring, flip] of [[ring1, false], [ring0, true]]) {
        if ((flip ? r0 : r1) === 0) continue;
        const c0 = this._fanCenter(ring);
        for (let k = 0; k < seg; k++) {
          const k2 = (k + 1) % seg;
          this._fanTri(c0, flip ? ring[k2] : ring[k], flip ? ring[k] : ring[k2], capO, axis, flip);
        }
      }
    }
  }

  _fanCenter(ring) {
    let x = 0, y = 0, z = 0;
    for (const p of ring) { x += p[0]; y += p[1]; z += p[2]; }
    return [x / ring.length, y / ring.length, z / ring.length];
  }

  _fanTri(c, a, b, o, axis, flip) {
    const n = axis === 'y' ? [0, flip ? -1 : 1, 0] : axis === 'x' ? [flip ? -1 : 1, 0, 0] : [0, 0, flip ? -1 : 1];
    const col = o.color, e = o.emis || 0, s = o.uv;
    const mk = (p) => {
      let u, v;
      if (axis === 'y') { u = p[0] * s; v = p[2] * s; } else if (axis === 'x') { u = p[2] * s; v = -p[1] * s; } else { u = p[0] * s; v = -p[1] * s; }
      let hx = 0, hy = 0, hz = 0;
      if (!o.noHull && o.hull) {
        hx = p[0] - o.hull[0]; hy = p[1] - o.hull[1]; hz = p[2] - o.hull[2];
        const l = Math.hypot(hx, hy, hz) || 1; hx /= l; hy /= l; hz /= l;
      }
      return this.vert(p[0], p[1], p[2], n[0], n[1], n[2], u, v, o.layer, col[0], col[1], col[2], e, hx, hy, hz, o.bone || 0);
    };
    const i0 = mk(c), i1 = mk(a), i2 = mk(b);
    this.tri(i0, i1, i2);
  }

  get empty() { return this.n === 0; }

  upload() {
    return GLX.mesh(new Float32Array(this.v), new Uint32Array(this.i));
  }
  data() {
    return { verts: new Float32Array(this.v), idx: new Uint32Array(this.i) };
  }
}
