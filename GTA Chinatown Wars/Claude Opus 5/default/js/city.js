'use strict';
/* ------------------------------------------------------------------
   city.js — Saltgrave: one dense district of Port Verrano.

   A 5x5 grid of blocks bounded by six avenues each way (two of them
   wide, four narrow), wrapped in a solid perimeter so the player can't
   wander off the map. Everything is generated from a seed: road strips,
   sidewalks, markings, buildings, alleys, parks, parking, and props.

   The same pass also produces:
     • solids[]    axis-aligned boxes for collision
     • nodes[]     intersection graph the traffic + police AI drive on
     • parkSpots[] where parked cars start
     • pedSpots[]  where pedestrians spawn
     • landmarks   named places the missions hang off
------------------------------------------------------------------ */

const SW = 3.6;      // sidewalk width
const SH = 0.18;     // sidewalk height

const City = {
  RX: [], RZ: [],
  N: 6,                       // roads per axis (=> 5 blocks per axis)
  blocks: [],
  nodes: [],
  solids: [],
  grid: null, gridCell: 22, gx0: 0, gz0: 0, gw: 0, gh: 0,
  parkSpots: [],
  pedSpots: [],
  lampPosts: [],
  landmarks: {},
  minX: 0, maxX: 0, minZ: 0, maxZ: 0,
  lightT: 0,

  /* ------------------------------------------------------------ */
  build(seed) {
    const rng = makeRNG(seed || 20260813);
    this._rng = rng;

    const widthsX = [16, 10, 10, 16, 10, 10];
    const gapsX = [76, 64, 84, 68, 72];
    const widthsZ = [10, 16, 10, 10, 16, 10];
    const gapsZ = [70, 80, 66, 76, 70];
    this.RX = this._axis(widthsX, gapsX);
    this.RZ = this._axis(widthsZ, gapsZ);

    const last = this.N - 1;
    this.minX = this.RX[0].c - this.RX[0].w / 2 - 30;
    this.maxX = this.RX[last].c + this.RX[last].w / 2 + 30;
    this.minZ = this.RZ[0].c - this.RZ[0].w / 2 - 30;
    this.maxZ = this.RZ[last].c + this.RZ[last].w / 2 + 30;

    const ground = new MeshBuilder();   // flat, never inked
    const struct = new MeshBuilder();   // everything with height

    this._ground(ground);
    this._markings(ground);
    this._blocks(ground, struct, rng);
    this._streetProps(ground, struct, rng);
    this._perimeter(ground, struct, rng);

    this.groundMesh = ground.upload();
    this.structMesh = struct.upload();
    Renderer.addStatic(this.groundMesh, false, false);
    Renderer.addStatic(this.structMesh, true, true);

    this._buildGrid();
    this._buildGraph();
    return { groundTris: ground.i.length / 3, structTris: struct.i.length / 3 };
  },

  _axis(widths, gaps) {
    const out = [];
    let c = 0;
    for (let i = 0; i < widths.length; i++) {
      if (i > 0) c += widths[i - 1] / 2 + gaps[i - 1] + widths[i] / 2;
      out.push({ c, w: widths[i], major: widths[i] >= 15, lanes: widths[i] >= 15 ? 2 : 1 });
    }
    return out;
  },

  /* ------------------------- geometry ------------------------- */
  _ground(g) {
    // one worn slab under the whole district (shows through in alleys)
    g.slab(this.minX, this.minZ, this.maxX, this.maxZ, 0,
      { layer: TEX.ASPHALT2, uv: 0.15, noHull: true, color: [0.92, 0.93, 0.96] });

    // fresher asphalt on the carriageways themselves
    for (const r of this.RX) {
      g.slab(r.c - r.w / 2, this.minZ, r.c + r.w / 2, this.maxZ, 0.02,
        { layer: TEX.ASPHALT, uv: 0.17, noHull: true, color: [1, 1, 1] });
    }
    for (const r of this.RZ) {
      g.slab(this.minX, r.c - r.w / 2, this.maxX, r.c + r.w / 2, 0.021,
        { layer: TEX.ASPHALT, uv: 0.17, noHull: true, color: [1, 1, 1] });
    }
  },

  _markings(g) {
    const paint = (col, emis) => ({ layer: TEX.BLANK, uv: 1, noHull: true, color: col, emis: emis || 0 });
    const YEL = paint([0.95, 0.76, 0.13]);
    const WHT = paint([0.92, 0.93, 0.90]);
    const Y = 0.05;

    const dash = (x0, z0, x1, z1, along, len, gap, o) => {
      if (along === 'z') {
        for (let z = z0; z < z1; z += len + gap) g.slab(x0, z, x1, Math.min(z + len, z1), Y, o);
      } else {
        for (let x = x0; x < x1; x += len + gap) g.slab(x, z0, Math.min(x + len, x1), z1, Y, o);
      }
    };

    // segments between intersections, per road
    for (let i = 0; i < this.N; i++) {
      const r = this.RX[i];
      for (let j = -1; j < this.N; j++) {
        const z0 = j < 0 ? this.minZ : this.RZ[j].c + this.RZ[j].w / 2 + 1.2;
        const z1 = j + 1 >= this.N ? this.maxZ : this.RZ[j + 1].c - this.RZ[j + 1].w / 2 - 1.2;
        if (z1 - z0 < 3) continue;
        if (r.major) {
          g.slab(r.c - 0.55, z0, r.c - 0.18, z1, Y, YEL);
          g.slab(r.c + 0.18, z0, r.c + 0.55, z1, Y, YEL);
          dash(r.c - 4.1, z0, r.c - 3.85, z1, 'z', 3.0, 3.2, WHT);
          dash(r.c + 3.85, z0, r.c + 4.1, z1, 'z', 3.0, 3.2, WHT);
        } else {
          dash(r.c - 0.17, z0, r.c + 0.17, z1, 'z', 2.6, 3.0, YEL);
        }
        // kerb edge lines
        g.slab(r.c - r.w / 2 + 0.5, z0, r.c - r.w / 2 + 0.78, z1, Y, WHT);
        g.slab(r.c + r.w / 2 - 0.78, z0, r.c + r.w / 2 - 0.5, z1, Y, WHT);
      }
    }
    for (let j = 0; j < this.N; j++) {
      const r = this.RZ[j];
      for (let i = -1; i < this.N; i++) {
        const x0 = i < 0 ? this.minX : this.RX[i].c + this.RX[i].w / 2 + 1.2;
        const x1 = i + 1 >= this.N ? this.maxX : this.RX[i + 1].c - this.RX[i + 1].w / 2 - 1.2;
        if (x1 - x0 < 3) continue;
        if (r.major) {
          g.slab(x0, r.c - 0.55, x1, r.c - 0.18, Y, YEL);
          g.slab(x0, r.c + 0.18, x1, r.c + 0.55, Y, YEL);
          dash(x0, r.c - 4.1, x1, r.c - 3.85, 'x', 3.0, 3.2, WHT);
          dash(x0, r.c + 3.85, x1, r.c + 4.1, 'x', 3.0, 3.2, WHT);
        } else {
          dash(x0, r.c - 0.17, x1, r.c + 0.17, 'x', 2.6, 3.0, YEL);
        }
        g.slab(x0, r.c - r.w / 2 + 0.5, x1, r.c - r.w / 2 + 0.78, Y, WHT);
        g.slab(x0, r.c + r.w / 2 - 0.78, x1, r.c + r.w / 2 - 0.5, Y, WHT);
      }
    }

    // crosswalks + stop bars at every intersection
    for (let i = 0; i < this.N; i++) for (let j = 0; j < this.N; j++) {
      const rx = this.RX[i], rz = this.RZ[j];
      const hx = rx.w / 2, hz = rz.w / 2;
      const zebra = (cx, cz, horiz, span) => {
        const n = Math.max(4, Math.round(span / 1.7));
        for (let k = 0; k < n; k++) {
          const t = -span / 2 + (k + 0.25) * (span / n);
          if (horiz) g.slab(cx + t, cz - 1.5, cx + t + span / n * 0.5, cz + 1.5, Y, WHT);
          else g.slab(cx - 1.5, cz + t, cx + 1.5, cz + t + span / n * 0.5, Y, WHT);
        }
      };
      zebra(rx.c, rz.c - hz - 1.9, true, rx.w - 1.4);
      zebra(rx.c, rz.c + hz + 1.9, true, rx.w - 1.4);
      zebra(rx.c - hx - 1.9, rz.c, false, rz.w - 1.4);
      zebra(rx.c + hx + 1.9, rz.c, false, rz.w - 1.4);
    }
  },

  _blocks(g, s, rng) {
    const N = this.N;
    // block plan: mostly buildings, with a park, a plaza and two lots
    const plan = {};
    plan['2,2'] = 'plaza';
    plan['0,3'] = 'park';
    plan['4,0'] = 'park';
    plan['3,1'] = 'lot';
    plan['1,4'] = 'lot';

    for (let i = 0; i < N - 1; i++) for (let j = 0; j < N - 1; j++) {
      const x0 = this.RX[i].c + this.RX[i].w / 2;
      const x1 = this.RX[i + 1].c - this.RX[i + 1].w / 2;
      const z0 = this.RZ[j].c + this.RZ[j].w / 2;
      const z1 = this.RZ[j + 1].c - this.RZ[j + 1].w / 2;
      const type = plan[i + ',' + j] || 'block';
      const b = { i, j, x0, z0, x1, z1, type };
      this.blocks.push(b);
      this._block(g, s, b, rng);
    }
  },

  _sidewalkBox(g, s, x0, z0, x1, z1) {
    if (x1 - x0 < 0.4 || z1 - z0 < 0.4) return;
    s.box(x0, 0, z0, x1, SH, z1, {
      layer: TEX.CONCRETE, uv: 0.16, color: [1, 1, 1],
      topOpt: { layer: TEX.CONCRETE, uv: 0.16 },
      sideOpt: { layer: TEX.CURB, uv: 0.5, color: [0.95, 0.93, 0.88] },
      noBottom: true
    });
  },

  _block(g, s, b, rng) {
    const { x0, z0, x1, z1 } = b;
    const lx0 = x0 + SW, lz0 = z0 + SW, lx1 = x1 - SW, lz1 = z1 - SW;

    if (b.type === 'lot') {
      // sidewalk ring with a driveway gap on the south side
      const gapA = lerp(x0, x1, 0.42), gapB = lerp(x0, x1, 0.64);
      this._sidewalkBox(g, s, x0, z0, x1, z0 + SW);
      this._sidewalkBox(g, s, x0, z0 + SW, x0 + SW, z1 - SW);
      this._sidewalkBox(g, s, x1 - SW, z0 + SW, x1, z1 - SW);
      this._sidewalkBox(g, s, x0, z1 - SW, gapA, z1);
      this._sidewalkBox(g, s, gapB, z1 - SW, x1, z1);
      this._parkingLot(g, s, b, lx0, lz0, lx1, lz1, rng);
      this._ringPedSpots(b);
      return;
    }

    if (b.type === 'park' || b.type === 'plaza') {
      this._sidewalkBox(g, s, x0, z0, x1, z1);
      if (b.type === 'park') this._park(g, s, b, lx0, lz0, lx1, lz1, rng);
      else this._plaza(g, s, b, lx0, lz0, lx1, lz1, rng);
      this._ringPedSpots(b);
      return;
    }

    // ---- built block, sometimes cut by an alley ----
    const wantAlley = rng() < 0.55 && (lx1 - lx0) > 34 && (lz1 - lz0) > 34;
    let lots = [[lx0, lz0, lx1, lz1]];
    if (wantAlley) {
      const vertical = (lx1 - lx0) > (lz1 - lz0) ? true : rng() < 0.5;
      const aw = 6.4;
      if (vertical) {
        const ax = lerp(lx0 + 16, lx1 - 16, 0.3 + rng() * 0.4);
        lots = [[lx0, lz0, ax - aw / 2, lz1], [ax + aw / 2, lz0, lx1, lz1]];
        this._sidewalkBox(g, s, x0, z0, ax - aw / 2, z1);
        this._sidewalkBox(g, s, ax + aw / 2, z0, x1, z1);
        b.alley = { x0: ax - aw / 2, z0: z0, x1: ax + aw / 2, z1: z1, vertical: true };
      } else {
        const az = lerp(lz0 + 16, lz1 - 16, 0.3 + rng() * 0.4);
        lots = [[lx0, lz0, lx1, az - aw / 2], [lx0, az + aw / 2, lx1, lz1]];
        this._sidewalkBox(g, s, x0, z0, x1, az - aw / 2);
        this._sidewalkBox(g, s, x0, az + aw / 2, x1, z1);
        b.alley = { x0: x0, z0: az - aw / 2, x1: x1, z1: az + aw / 2, vertical: false };
      }
      this._alleyProps(g, s, b.alley, rng);
    } else {
      this._sidewalkBox(g, s, x0, z0, x1, z1);
    }

    for (const lot of lots) {
      const rects = [];
      this._split(lot[0], lot[1], lot[2], lot[3], 2 + (rng() < 0.6 ? 1 : 0), rects, rng);
      for (const r of rects) this._building(g, s, r, b, rng);
    }
    this._ringPedSpots(b);
  },

  _split(x0, z0, x1, z1, depth, out, rng) {
    const w = x1 - x0, h = z1 - z0;
    if (depth <= 0 || (w < 26 && h < 26)) { out.push([x0, z0, x1, z1]); return; }
    if (w >= h) {
      const t = lerp(0.34, 0.66, rng());
      const m = x0 + w * t;
      this._split(x0, z0, m, z1, depth - 1, out, rng);
      this._split(m, z0, x1, z1, depth - 1, out, rng);
    } else {
      const t = lerp(0.34, 0.66, rng());
      const m = z0 + h * t;
      this._split(x0, z0, x1, m, depth - 1, out, rng);
      this._split(x0, m, x1, z1, depth - 1, out, rng);
    }
  },

  /* ------------------------- buildings ------------------------- */
  _building(g, s, r, block, rng) {
    let [x0, z0, x1, z1] = r;
    // varied setback so the street wall isn't a flat plane
    const pad = () => 0.2 + rng() * 1.0;
    x0 += pad(); z0 += pad(); x1 -= pad(); z1 -= pad();
    if (x1 - x0 < 6.5 || z1 - z0 < 6.5) return;

    const roll = rng();
    const tall = roll > 0.86, mid = !tall && roll > 0.55;
    const h = tall ? rand(25, 37) : mid ? rand(14, 23) : rand(7.5, 13);
    const y0 = SH;

    const wallSets = [
      { layer: TEX.BRICK_RED, tint: [1.02, 0.92, 0.86], uv: 0.13 },
      { layer: TEX.BRICK_TAN, tint: [1.0, 0.97, 0.9], uv: 0.13 },
      { layer: TEX.STUCCO, tint: [1.0, 0.95, 0.86], uv: 0.10 },
      { layer: TEX.STUCCO, tint: [0.79, 0.88, 0.92], uv: 0.10 },
      { layer: TEX.TILEWALL, tint: [0.95, 1.0, 1.0], uv: 0.16 },
      { layer: TEX.PANEL, tint: [0.86, 0.9, 0.98], uv: 0.11 }
    ];
    let wall;
    if (tall) wall = { layer: rng() < 0.6 ? TEX.WIN_OFFICE : TEX.PANEL, tint: pick([[0.86, 0.92, 1.0], [0.95, 0.9, 0.86], [0.8, 0.86, 0.9]]), uv: 0.075 };
    else if (mid) wall = { layer: TEX.WIN_APT, tint: pick([[1.02, 0.94, 0.84], [0.92, 0.9, 0.94], [1.0, 0.86, 0.78]]), uv: 0.085 };
    else wall = wallSets[(rng() * wallSets.length) | 0];

    const inset = tall ? rand(0.2, 0.9) : 0;
    const bodyOpt = {
      layer: wall.layer, uv: wall.uv, color: wall.tint,
      ao: [y0, y0 + 7, 0.55], noBottom: true
    };
    s.taper(x0, y0, z0, x1, y0 + h, z1, inset, inset, bodyOpt);

    // roof deck, then a parapet *ring* around it (a solid box would cap
    // the roof and hide everything standing on it)
    const top = y0 + h;
    const rx0 = x0 + inset, rz0 = z0 + inset, rx1 = x1 - inset, rz1 = z1 - inset;
    const par = { layer: TEX.CONCRETE, uv: 0.22, color: [0.62, 0.62, 0.65], noBottom: true };
    const pw = 0.45, ph = 0.62;
    s.box(rx0 - 0.3, top, rz0 - 0.3, rx1 + 0.3, top + ph, rz0 - 0.3 + pw, par);
    s.box(rx0 - 0.3, top, rz1 + 0.3 - pw, rx1 + 0.3, top + ph, rz1 + 0.3, par);
    s.box(rx0 - 0.3, top, rz0 - 0.3 + pw, rx0 - 0.3 + pw, top + ph, rz1 + 0.3 - pw, par);
    s.box(rx1 + 0.3 - pw, top, rz0 - 0.3 + pw, rx1 + 0.3, top + ph, rz1 + 0.3 - pw, par);
    s.slab(rx0, rz0, rx1, rz1, top + 0.05, {
      layer: TEX.ROOFTOP, uv: 0.13, noHull: true,
      color: pick([[1, 1, 1], [0.86, 0.9, 0.92], [1.05, 0.95, 0.86], [0.78, 0.82, 0.8]])
    });
    this._rooftop(s, x0 + inset, z0 + inset, x1 - inset, z1 - inset, top + 0.6, rng);

    // ground-floor shopfront + signage on street-facing sides
    const faces = this._streetFaces(x0, z0, x1, z1, block);
    if (!tall && h > 6) this._storefront(s, x0, z0, x1, z1, y0, faces, rng);
    if (h > 14 && rng() < 0.5) this._rooftopSign(s, x0, z0, x1, z1, top + 0.6, faces, rng);

    this.solids.push({ x0, z0, x1, z1, h: top });
  },

  /** which sides of this footprint look onto a street (0:+Z 1:+X 2:-Z 3:-X) */
  _streetFaces(x0, z0, x1, z1, b) {
    const t = 4.0;
    return [
      z1 > b.z1 - SW - t, x1 > b.x1 - SW - t, z0 < b.z0 + SW + t, x0 < b.x0 + SW + t
    ];
  },

  _storefront(s, x0, z0, x1, z1, y0, faces, rng) {
    const bandH = 4.2;
    const shopCol = pick([[0.85, 0.25, 0.2], [0.15, 0.45, 0.35], [0.2, 0.3, 0.55], [0.7, 0.55, 0.15], [0.35, 0.2, 0.42], [0.1, 0.42, 0.5]]);
    s.box(x0 - 0.14, y0, z0 - 0.14, x1 + 0.14, y0 + bandH, z1 + 0.14, {
      layer: TEX.TILEWALL, uv: 0.2, color: shopCol, noBottom: true, noTop: true
    });
    // glass + door strip
    const gY0 = y0 + 0.7, gY1 = y0 + 3.1;
    const gl = { layer: TEX.GLASS, uv: 0.12, color: [0.8, 0.9, 1.0], emis: 0.18, noHull: true };
    const m = 1.3;
    if (faces[0]) s.quad([x0 + m, gY0, z1 + 0.2, x1 - m, gY0, z1 + 0.2, x1 - m, gY1, z1 + 0.2, x0 + m, gY1, z1 + 0.2], gl);
    if (faces[2]) s.quad([x1 - m, gY0, z0 - 0.2, x0 + m, gY0, z0 - 0.2, x0 + m, gY1, z0 - 0.2, x1 - m, gY1, z0 - 0.2], gl);
    if (faces[1]) s.quad([x1 + 0.2, gY0, z1 - m, x1 + 0.2, gY0, z0 + m, x1 + 0.2, gY1, z0 + m, x1 + 0.2, gY1, z1 - m], gl);
    if (faces[3]) s.quad([x0 - 0.2, gY0, z0 + m, x0 - 0.2, gY0, z1 - m, x0 - 0.2, gY1, z1 - m, x0 - 0.2, gY1, z0 + m], gl);

    // awning + sign board over each street face
    const sign = TEX.SIGN0 + ((rng() * SIGN_COUNT) | 0);
    const awnCol = pick([[0.9, 0.3, 0.25], [0.15, 0.5, 0.4], [0.95, 0.75, 0.2], [0.25, 0.35, 0.7]]);
    const sy0 = y0 + bandH + 0.1, sy1 = sy0 + 1.5;
    const xa = lerp(x0, x1, 0.16), xb = lerp(x0, x1, 0.84);
    const za = lerp(z0, z1, 0.16), zb = lerp(z0, z1, 0.84);
    const put = (fi) => {
      if (!faces[fi]) return;
      const o = { layer: sign, uvQuad: true, color: [1, 1, 1], emis: 0.5, noHull: true };
      const a = { layer: TEX.AWNING, uvQuad: true, color: awnCol, noHull: true };
      if (fi === 0) {
        s.quad([x0 + 0.4, sy0, z1 + 0.22, x1 - 0.4, sy0, z1 + 0.22, x1 - 0.4, sy1, z1 + 0.22, x0 + 0.4, sy1, z1 + 0.22], o);
        s.quad([xa, y0 + 3.4, z1 + 1.45, xb, y0 + 3.4, z1 + 1.45, xb, y0 + 4.05, z1 + 0.2, xa, y0 + 4.05, z1 + 0.2], a);
      } else if (fi === 2) {
        s.quad([x1 - 0.4, sy0, z0 - 0.22, x0 + 0.4, sy0, z0 - 0.22, x0 + 0.4, sy1, z0 - 0.22, x1 - 0.4, sy1, z0 - 0.22], o);
        s.quad([xb, y0 + 3.4, z0 - 1.45, xa, y0 + 3.4, z0 - 1.45, xa, y0 + 4.05, z0 - 0.2, xb, y0 + 4.05, z0 - 0.2], a);
      } else if (fi === 1) {
        s.quad([x1 + 0.22, sy0, z1 - 0.4, x1 + 0.22, sy0, z0 + 0.4, x1 + 0.22, sy1, z0 + 0.4, x1 + 0.22, sy1, z1 - 0.4], o);
        s.quad([x1 + 1.45, y0 + 3.4, zb, x1 + 1.45, y0 + 3.4, za, x1 + 0.2, y0 + 4.05, za, x1 + 0.2, y0 + 4.05, zb], a);
      } else {
        s.quad([x0 - 0.22, sy0, z0 + 0.4, x0 - 0.22, sy0, z1 - 0.4, x0 - 0.22, sy1, z1 - 0.4, x0 - 0.22, sy1, z0 + 0.4], o);
        s.quad([x0 - 1.45, y0 + 3.4, za, x0 - 1.45, y0 + 3.4, zb, x0 - 0.2, y0 + 4.05, zb, x0 - 0.2, y0 + 4.05, za], a);
      }
    };
    for (let f = 0; f < 4; f++) put(f);
  },

  _rooftopSign(s, x0, z0, x1, z1, y, faces, rng) {
    const sign = TEX.SIGN0 + ((rng() * SIGN_COUNT) | 0);
    const h = 3.4;
    const o = { layer: sign, uvQuad: true, color: [1, 1, 1], emis: 0.85 };
    const frame = { layer: TEX.METAL, uv: 0.4, color: [0.3, 0.32, 0.36] };
    if (faces[0] && x1 - x0 > 11) {
      s.box(x0 + 1.4, y, z1 - 1.0, x1 - 1.4, y + h, z1 - 0.55, frame);
      s.quad([x0 + 1.4, y + 0.2, z1 - 0.5, x1 - 1.4, y + 0.2, z1 - 0.5, x1 - 1.4, y + h - 0.2, z1 - 0.5, x0 + 1.4, y + h - 0.2, z1 - 0.5], o);
    } else if (faces[1] && z1 - z0 > 11) {
      s.box(x1 - 1.0, y, z0 + 1.4, x1 - 0.55, y + h, z1 - 1.4, frame);
      s.quad([x1 - 0.5, y + 0.2, z1 - 1.4, x1 - 0.5, y + 0.2, z0 + 1.4, x1 - 0.5, y + h - 0.2, z0 + 1.4, x1 - 0.5, y + h - 0.2, z1 - 1.4], o);
    }
  },

  _rooftop(s, x0, z0, x1, z1, y, rng) {
    const w = x1 - x0, d = z1 - z0;
    if (w < 6 || d < 6) return;
    const n = 1 + ((rng() * 3) | 0);
    for (let k = 0; k < n; k++) {
      const bw = rand(1.6, Math.min(4.2, w * 0.35)), bd = rand(1.6, Math.min(4.2, d * 0.35));
      const bx = rand(x0 + 1, x1 - 1 - bw), bz = rand(z0 + 1, z1 - 1 - bd);
      s.box(bx, y, bz, bx + bw, y + rand(1.0, 2.2), bz + bd,
        { layer: TEX.METAL, uv: 0.35, color: [0.48, 0.5, 0.54], noBottom: true });
    }
    if (rng() < 0.4) { // water tank
      const cx = rand(x0 + 3, x1 - 3), cz = rand(z0 + 3, z1 - 3);
      s.cyl(cx, y + 1.8, cz, 1.7, 1.7, 2.6, 10, { layer: TEX.WOOD, uv: 0.28, color: [0.85, 0.7, 0.55] });
      for (const [ox, oz] of [[-1.2, -1.2], [1.2, -1.2], [1.2, 1.2], [-1.2, 1.2]])
        s.box(cx + ox - 0.12, y, cz + oz - 0.12, cx + ox + 0.12, y + 1.8, cz + oz + 0.12,
          { layer: TEX.METAL, uv: 0.5, color: [0.4, 0.4, 0.44] });
    }
    if (rng() < 0.35) { // antenna mast
      const cx = rand(x0 + 2, x1 - 2), cz = rand(z0 + 2, z1 - 2);
      s.cyl(cx, y, cz, 0.14, 0.07, rand(3, 7), 6, { layer: TEX.METAL, uv: 0.5, color: [0.45, 0.35, 0.32] });
    }
  },

  /* ------------------------- open blocks ------------------------- */
  _park(g, s, b, x0, z0, x1, z1, rng) {
    g.slab(x0, z0, x1, z1, SH + 0.012, { layer: TEX.GRASS, uv: 0.14, noHull: true, color: [1, 1, 1] });
    // crossing paths
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    g.slab(x0, cz - 2.2, x1, cz + 2.2, SH + 0.024, { layer: TEX.PLAZA, uv: 0.18, noHull: true, color: [1, 1, 1] });
    g.slab(cx - 2.2, z0, cx + 2.2, z1, SH + 0.025, { layer: TEX.PLAZA, uv: 0.18, noHull: true, color: [1, 1, 1] });

    // fountain
    s.cyl(cx, SH, cz, 3.4, 3.4, 0.75, 16, { layer: TEX.CONCRETE, uv: 0.25, color: [0.85, 0.85, 0.82] });
    s.cyl(cx, SH + 0.7, cz, 2.9, 2.9, 0.12, 16, { layer: TEX.BLANK, uv: 0.2, color: [0.35, 0.62, 0.75], emis: 0.25 });
    s.cyl(cx, SH + 0.7, cz, 0.6, 0.35, 1.6, 8, { layer: TEX.CONCRETE, uv: 0.4, color: [0.88, 0.88, 0.85] });

    for (let k = 0; k < 12; k++) {
      const tx = rand(x0 + 3, x1 - 3), tz = rand(z0 + 3, z1 - 3);
      if (Math.abs(tx - cx) < 6 && Math.abs(tz - cz) < 6) continue;
      if (Math.abs(tx - cx) < 3 || Math.abs(tz - cz) < 3) continue;
      this._tree(s, tx, tz, rng);
    }
    for (let k = 0; k < 4; k++) {
      const bx = cx + (k < 2 ? -6.5 : 6.5), bz = cz + (k % 2 ? -5 : 5);
      this._bench(s, bx, bz, k < 2 ? Math.PI / 2 : -Math.PI / 2);
    }
    b.open = true;
  },

  _plaza(g, s, b, x0, z0, x1, z1, rng) {
    g.slab(x0, z0, x1, z1, SH + 0.012, { layer: TEX.PLAZA, uv: 0.16, noHull: true, color: [1, 1, 1] });
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    // civic monument — the district's "Salt Pillar"
    s.box(cx - 3.2, SH, cz - 3.2, cx + 3.2, SH + 0.9, cz + 3.2,
      { layer: TEX.CONCRETE, uv: 0.24, color: [0.86, 0.84, 0.8], noBottom: true });
    s.taper(cx - 1.5, SH + 0.9, cz - 1.5, cx + 1.5, SH + 11, cz + 1.5, 0.9, 0.9,
      { layer: TEX.STUCCO, uv: 0.16, color: [0.95, 0.9, 0.78], noBottom: true });
    s.cyl(cx, SH + 11, cz, 0.9, 0, 2.4, 8, { layer: TEX.BLANK, uv: 0.4, color: [1.0, 0.82, 0.25], emis: 0.75 });
    this.solids.push({ x0: cx - 3.2, z0: cz - 3.2, x1: cx + 3.2, z1: cz + 3.2, h: SH + 11 });

    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * TAU, r = 13;
      this._tree(s, cx + Math.cos(a) * r, cz + Math.sin(a) * r, rng, 0.8);
    }
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + 0.4, r = 8.5;
      this._bench(s, cx + Math.cos(a) * r, cz + Math.sin(a) * r, -a);
    }
    this.landmarks.plaza = { x: cx, z: cz };
    b.open = true;
  },

  _parkingLot(g, s, b, x0, z0, x1, z1, rng) {
    g.slab(x0 - SW, z0 - SW, x1 + SW, z1 + SW, 0.03, { layer: TEX.ASPHALT, uv: 0.11, noHull: true, color: [0.9, 0.9, 0.92] });
    const paint = { layer: TEX.BLANK, uv: 1, noHull: true, color: [0.9, 0.9, 0.85] };
    // two rows of stalls with an aisle
    const rows = 2, stallW = 3.2, stallD = 6.0;
    const cz = (z0 + z1) / 2;
    for (let r = 0; r < rows; r++) {
      const sz = r === 0 ? cz - 2.5 - stallD : cz + 2.5;
      const n = Math.floor((x1 - x0 - 2) / stallW);
      for (let k = 0; k <= n; k++) {
        const px = x0 + 1 + k * stallW;
        g.slab(px - 0.12, sz, px + 0.12, sz + stallD, 0.06, paint);
        if (k < n && rng() < 0.5) {
          this.parkSpots.push({ x: px + stallW / 2, z: sz + stallD / 2, yaw: r === 0 ? Math.PI : 0, lot: true });
        }
      }
      g.slab(x0 + 1, r === 0 ? sz : sz + stallD - 0.12, x0 + 1 + n * stallW, (r === 0 ? sz : sz + stallD) + 0.12, 0.06, paint);
    }
    // perimeter fence posts
    for (let px = x0; px <= x1; px += 5.5) {
      s.cyl(px, 0.03, z0 - 0.4, 0.12, 0.12, 1.5, 6, { layer: TEX.METAL, uv: 0.6, color: [0.45, 0.47, 0.5] });
    }
    (this.landmarks.lots = this.landmarks.lots || []).push({
      x: (x0 + x1) / 2, z: (z0 + z1) / 2, x0, z0, x1, z1, entryZ: z1 + SW + 3, block: b
    });
    b.open = true;
  },

  /* ------------------------- props ------------------------- */
  _tree(s, x, z, rng, scale) {
    const k = scale || 1;
    const th = rand(2.0, 3.2) * k;
    s.cyl(x, SH, z, 0.34 * k, 0.26 * k, th, 7, { layer: TEX.WOOD, uv: 0.5, color: [0.55, 0.42, 0.3] });
    const r = rand(2.0, 3.0) * k;
    s.cyl(x, SH + th - 0.3, z, r * 0.75, r, 1.4 * k, 9, { layer: TEX.FOLIAGE, uv: 0.16, color: [1, 1, 1], noCaps: false });
    s.cyl(x, SH + th + 0.9 * k, z, r, r * 0.55, 1.8 * k, 9, { layer: TEX.FOLIAGE, uv: 0.16, color: [0.92, 1.0, 0.9] });
    s.cyl(x, SH + th + 2.4 * k, z, r * 0.55, 0, 1.5 * k, 9, { layer: TEX.FOLIAGE, uv: 0.16, color: [0.86, 0.96, 0.85] });
  },

  _bench(s, x, z, yaw) {
    s.setXform(x, 0, z, yaw);
    const o = { layer: TEX.WOOD, uv: 0.5, color: [0.75, 0.55, 0.38] };
    s.box(-1.3, SH + 0.42, -0.35, 1.3, SH + 0.55, 0.35, o);
    s.box(-1.3, SH + 0.55, -0.42, 1.3, SH + 1.15, -0.28, o);
    const m = { layer: TEX.METAL, uv: 0.6, color: [0.3, 0.32, 0.35] };
    s.box(-1.15, SH, -0.3, -0.95, SH + 0.45, 0.3, m);
    s.box(0.95, SH, -0.3, 1.15, SH + 0.45, 0.3, m);
    s.clearXform();
  },

  _alleyProps(g, s, a, rng) {
    const cx = (a.x0 + a.x1) / 2, cz = (a.z0 + a.z1) / 2;
    const n = 3 + ((rng() * 3) | 0);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const px = a.vertical ? cx + rand(-1.4, 1.4) : lerp(a.x0 + 6, a.x1 - 6, t);
      const pz = a.vertical ? lerp(a.z0 + 6, a.z1 - 6, t) : cz + rand(-1.4, 1.4);
      if (rng() < 0.55) {   // dumpster
        const yaw = a.vertical ? 0 : Math.PI / 2;
        s.setXform(px, 0, pz, yaw);
        s.taper(-1.5, 0, -0.9, 1.5, 1.5, 0.9, 0.1, 0.1,
          { layer: TEX.PANEL, uv: 0.3, color: pick([[0.2, 0.45, 0.3], [0.5, 0.3, 0.2], [0.25, 0.3, 0.45]]), noBottom: true });
        s.clearXform();
        this.solids.push({ x0: px - 1.6, z0: pz - 1.0, x1: px + 1.6, z1: pz + 1.0, h: 1.5 });
      } else {              // stacked crates
        for (let c = 0; c < 2 + ((rng() * 2) | 0); c++) {
          const sz2 = rand(0.5, 0.8);
          s.box(px - sz2, c * sz2 * 2, pz - sz2, px + sz2, (c + 1) * sz2 * 2, pz + sz2,
            { layer: TEX.WOOD, uv: 0.6, color: [0.7, 0.55, 0.4], noBottom: true });
        }
      }
    }
  },

  _streetLamp(s, x, z, yaw) {
    s.setXform(x, 0, z, yaw);
    const m = { layer: TEX.METAL, uv: 0.5, color: [0.24, 0.26, 0.3] };
    s.cyl(0, SH, 0, 0.28, 0.22, 0.5, 8, m);
    s.cyl(0, SH + 0.4, 0, 0.17, 0.13, 6.2, 8, m);
    s.box(-0.11, SH + 6.4, -0.11, 0.11, SH + 6.66, 1.7, m);
    s.box(-0.3, SH + 6.28, 1.3, 0.3, SH + 6.44, 2.0, m);
    s.box(-0.24, SH + 6.2, 1.36, 0.24, SH + 6.3, 1.94,
      { layer: TEX.BLANK, uv: 0.5, color: [1.0, 0.93, 0.7], emis: 0.45 });
    s.clearXform();
    this.lampPosts.push({ x, z });
  },

  _trafficLight(s, x, z, yaw) {
    s.setXform(x, 0, z, yaw);
    const m = { layer: TEX.METAL, uv: 0.5, color: [0.2, 0.22, 0.26] };
    s.cyl(0, SH, 0, 0.26, 0.2, 0.4, 8, m);
    s.cyl(0, SH + 0.3, 0, 0.16, 0.14, 5.0, 8, m);
    s.box(-0.1, SH + 5.1, -0.1, 0.1, SH + 5.3, 3.2, m);
    // hanging head
    s.box(-0.38, SH + 3.6, 2.4, 0.38, SH + 5.1, 2.9, m);
    const lamp = (yy, col) => s.box(-0.24, yy, 2.36, 0.24, yy + 0.34, 2.42,
      { layer: TEX.BLANK, uv: 0.5, color: col, emis: 0.8 });
    lamp(SH + 4.55, [0.9, 0.15, 0.12]);
    lamp(SH + 4.12, [0.95, 0.7, 0.1]);
    lamp(SH + 3.7, [0.2, 0.85, 0.35]);
    s.clearXform();
  },

  _streetProps(g, s, rng) {
    const N = this.N;
    // lamps down every road, alternating sides
    for (let i = 0; i < N; i++) {
      const r = this.RX[i];
      let flip = false;
      for (let z = this.minZ + 18; z < this.maxZ - 12; z += 27) {
        if (this._nearIntersection(r.c, z, 16)) continue;
        const side = flip ? 1 : -1; flip = !flip;
        this._streetLamp(s, r.c + side * (r.w / 2 + 1.6), z, side > 0 ? -Math.PI / 2 : Math.PI / 2);
      }
    }
    for (let j = 0; j < N; j++) {
      const r = this.RZ[j];
      let flip = true;
      for (let x = this.minX + 30; x < this.maxX - 12; x += 29) {
        if (this._nearIntersection(x, r.c, 16)) continue;
        const side = flip ? 1 : -1; flip = !flip;
        this._streetLamp(s, x, r.c + side * (r.w / 2 + 1.6), side > 0 ? Math.PI : 0);
      }
    }

    // traffic signals + corner clutter at intersections
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const rx = this.RX[i], rz = this.RZ[j];
      const hx = rx.w / 2 + 1.8, hz = rz.w / 2 + 1.8;
      this._trafficLight(s, rx.c - hx, rz.c - hz, 0);
      this._trafficLight(s, rx.c + hx, rz.c + hz, Math.PI);
      if (rx.major || rz.major) {
        this._trafficLight(s, rx.c + hx, rz.c - hz, -Math.PI / 2);
        this._trafficLight(s, rx.c - hx, rz.c + hz, Math.PI / 2);
      }
    }

    // sidewalk clutter + curbside parking spots along block edges
    for (const b of this.blocks) {
      const edges = [
        { x: (b.x0 + b.x1) / 2, z: b.z0, dir: 'x', len: b.x1 - b.x0, out: -1 },
        { x: (b.x0 + b.x1) / 2, z: b.z1, dir: 'x', len: b.x1 - b.x0, out: 1 },
        { x: b.x0, z: (b.z0 + b.z1) / 2, dir: 'z', len: b.z1 - b.z0, out: -1 },
        { x: b.x1, z: (b.z0 + b.z1) / 2, dir: 'z', len: b.z1 - b.z0, out: 1 }
      ];
      for (const e of edges) {
        const steps = Math.floor(e.len / 12);
        for (let k = 1; k < steps; k++) {
          const t = k / steps;
          const px = e.dir === 'x' ? lerp(b.x0, b.x1, t) : e.x;
          const pz = e.dir === 'x' ? e.z : lerp(b.z0, b.z1, t);
          if (this._nearIntersection(px, pz, 15)) continue;
          const ox = e.dir === 'z' ? e.out * 1.5 : 0;
          const oz = e.dir === 'x' ? e.out * 1.5 : 0;
          const roll = rng();
          if (roll < 0.22) this._hydrant(s, px + ox * 0.6, pz + oz * 0.6);
          else if (roll < 0.5) this._bin(s, px + ox * 0.6, pz + oz * 0.6, rng);
          else if (roll < 0.62) this._bench(s, px + ox * 0.4, pz + oz * 0.4, e.dir === 'x' ? (e.out > 0 ? 0 : Math.PI) : (e.out > 0 ? -Math.PI / 2 : Math.PI / 2));
          // kerbside parking bay just off the sidewalk
          if (roll > 0.30) {
            const yaw = e.dir === 'x' ? (e.out > 0 ? Math.PI / 2 : -Math.PI / 2) : (e.out > 0 ? Math.PI : 0);
            this.parkSpots.push({
              x: px + (e.dir === 'z' ? e.out * 3.2 : 0),
              z: pz + (e.dir === 'x' ? e.out * 3.2 : 0),
              yaw
            });
          }
        }
      }
    }
  },

  _hydrant(s, x, z) {
    const o = { layer: TEX.BLANK, uv: 0.6, color: [0.85, 0.18, 0.12] };
    s.cyl(x, SH, z, 0.26, 0.24, 0.72, 8, o);
    s.cyl(x, SH + 0.72, z, 0.3, 0.14, 0.24, 8, o);
    s.box(x - 0.44, SH + 0.32, z - 0.1, x + 0.44, SH + 0.52, z + 0.1, o);
  },

  _bin(s, x, z, rng) {
    s.cyl(x, SH, z, 0.42, 0.48, 1.05, 9,
      { layer: TEX.METAL, uv: 0.6, color: pick([[0.25, 0.35, 0.3], [0.35, 0.3, 0.25], [0.2, 0.28, 0.38]]) });
    s.cyl(x, SH + 1.05, z, 0.52, 0.42, 0.18, 9, { layer: TEX.METAL, uv: 0.6, color: [0.2, 0.2, 0.22] });
  },

  _ringPedSpots(b) {
    const inset = SW * 0.5;
    const per = 9;
    for (let k = 0; k < per; k++) {
      const t = (k + 0.5) / per;
      this.pedSpots.push({ x: lerp(b.x0 + 2, b.x1 - 2, t), z: b.z0 + inset });
      this.pedSpots.push({ x: lerp(b.x0 + 2, b.x1 - 2, t), z: b.z1 - inset });
      this.pedSpots.push({ x: b.x0 + inset, z: lerp(b.z0 + 2, b.z1 - 2, t) });
      this.pedSpots.push({ x: b.x1 - inset, z: lerp(b.z0 + 2, b.z1 - 2, t) });
    }
  },

  /* ------------------------- perimeter ------------------------- */
  _perimeter(g, s, rng) {
    const pad = 30;
    const X0 = this.minX, X1 = this.maxX, Z0 = this.minZ, Z1 = this.maxZ;
    const strips = [
      [X0 - 2, Z0 - 2, X1 + 2, Z0 + pad - 4],
      [X0 - 2, Z1 - pad + 4, X1 + 2, Z1 + 2],
      [X0 - 2, Z0 + pad - 4, X0 + pad - 4, Z1 - pad + 4],
      [X1 - pad + 4, Z0 + pad - 4, X1 + 2, Z1 - pad + 4]
    ];
    for (const [x0, z0, x1, z1] of strips) {
      // a wall of slabs so the district reads as continuing outward
      const along = (x1 - x0) > (z1 - z0);
      const len = along ? x1 - x0 : z1 - z0;
      let t = 0;
      while (t < len) {
        const seg = Math.min(rand(14, 26), len - t);
        if (seg < 6) break;
        const a0 = along ? x0 + t : x0, a1 = along ? x0 + t + seg : x1;
        const b0 = along ? z0 : z0 + t, b1 = along ? z1 : z0 + t + seg;
        const h = rand(16, 44);
        s.taper(a0, 0, b0, a1, h, b1, 0.4, 0.4, {
          layer: rng() < 0.5 ? TEX.WIN_OFFICE : TEX.PANEL, uv: 0.075,
          color: pick([[0.62, 0.68, 0.8], [0.7, 0.68, 0.72], [0.58, 0.63, 0.74]]),
          ao: [0, 8, 0.5], noBottom: true
        });
        this.solids.push({ x0: a0, z0: b0, x1: a1, z1: b1, h });
        t += seg;
      }
    }
    this.solids.push({ x0: X0 - 60, z0: Z0 - 60, x1: X0 - 2, z1: Z1 + 60, h: 30 });
    this.solids.push({ x0: X1 + 2, z0: Z0 - 60, x1: X1 + 60, z1: Z1 + 60, h: 30 });
    this.solids.push({ x0: X0 - 60, z0: Z0 - 60, x1: X1 + 60, z1: Z0 - 2, h: 30 });
    this.solids.push({ x0: X0 - 60, z0: Z1 + 2, x1: X1 + 60, z1: Z1 + 60, h: 30 });
  },

  /* ------------------------- queries ------------------------- */
  _nearIntersection(x, z, r) {
    for (let i = 0; i < this.N; i++) {
      if (Math.abs(x - this.RX[i].c) < this.RX[i].w / 2 + r) {
        for (let j = 0; j < this.N; j++) {
          if (Math.abs(z - this.RZ[j].c) < this.RZ[j].w / 2 + r) return true;
        }
      }
    }
    return false;
  },

  onRoad(x, z) {
    for (const r of this.RX) if (Math.abs(x - r.c) <= r.w / 2) return true;
    for (const r of this.RZ) if (Math.abs(z - r.c) <= r.w / 2) return true;
    return false;
  },

  _buildGrid() {
    const cell = this.gridCell;
    this.gx0 = Math.floor((this.minX - 70) / cell);
    this.gz0 = Math.floor((this.minZ - 70) / cell);
    this.gw = Math.ceil((this.maxX + 70) / cell) - this.gx0 + 1;
    this.gh = Math.ceil((this.maxZ + 70) / cell) - this.gz0 + 1;
    this.grid = new Array(this.gw * this.gh);
    for (let k = 0; k < this.grid.length; k++) this.grid[k] = null;
    for (let s = 0; s < this.solids.length; s++) {
      const b = this.solids[s];
      const i0 = clamp(Math.floor(b.x0 / cell) - this.gx0, 0, this.gw - 1);
      const i1 = clamp(Math.floor(b.x1 / cell) - this.gx0, 0, this.gw - 1);
      const j0 = clamp(Math.floor(b.z0 / cell) - this.gz0, 0, this.gh - 1);
      const j1 = clamp(Math.floor(b.z1 / cell) - this.gz0, 0, this.gh - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * this.gw + i;
        if (!this.grid[k]) this.grid[k] = [];
        this.grid[k].push(b);
      }
    }
  },

  /** Call cb(box) for every solid whose cell overlaps the query circle. */
  eachSolid(x, z, r, cb) {
    const cell = this.gridCell;
    const i0 = clamp(Math.floor((x - r) / cell) - this.gx0, 0, this.gw - 1);
    const i1 = clamp(Math.floor((x + r) / cell) - this.gx0, 0, this.gw - 1);
    const j0 = clamp(Math.floor((z - r) / cell) - this.gz0, 0, this.gh - 1);
    const j1 = clamp(Math.floor((z + r) / cell) - this.gz0, 0, this.gh - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const list = this.grid[j * this.gw + i];
      if (!list) continue;
      for (let k = 0; k < list.length; k++) {
        const b = list[k];
        if (b._mark === this._mark) continue;
        b._mark = this._mark;
        cb(b);
      }
    }
  },
  _mark: 0,
  beginQuery() { this._mark++; },

  /* ------------------------- road graph ------------------------- */
  _buildGraph() {
    const N = this.N;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      this.nodes.push({
        i, j, x: this.RX[i].c, z: this.RZ[j].c,
        wx: this.RX[i].w, wz: this.RZ[j].w,
        links: []
      });
    }
    const idx = (i, j) => j * N + i;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const n = this.nodes[idx(i, j)];
      if (i > 0) n.links.push(idx(i - 1, j));
      if (i < N - 1) n.links.push(idx(i + 1, j));
      if (j > 0) n.links.push(idx(i, j - 1));
      if (j < N - 1) n.links.push(idx(i, j + 1));
    }
  },

  nodeAt(i, j) { return this.nodes[j * this.N + i]; },

  nearestNode(x, z) {
    let best = 0, bd = 1e9;
    for (let k = 0; k < this.nodes.length; k++) {
      const d = dist2(x, z, this.nodes[k].x, this.nodes[k].z);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  },

  /** lane centre offset (right of travel) for the road linking a->b */
  laneOffset(a, b, laneIdx) {
    const horiz = a.j === b.j;   // travelling along X
    const road = horiz ? this.RZ[a.j] : this.RX[a.i];
    if (road.lanes > 1) return laneIdx > 0 ? 5.8 : 2.1;
    return road.w * 0.25 + 0.3;
  },
  lanesOn(a, b) {
    const horiz = a.j === b.j;
    return (horiz ? this.RZ[a.j] : this.RX[a.i]).lanes;
  },

  /* traffic-signal cycle: 0 = travel along X has green */
  LIGHT_PERIOD: 20,
  update(dt) { this.lightT = (this.lightT + dt) % this.LIGHT_PERIOD; },
  /** returns 'green' | 'amber' | 'red' for a car travelling along X or Z */
  signal(alongX) {
    const t = this.lightT;
    if (alongX) {
      if (t < 8) return 'green';
      if (t < 9.6) return 'amber';
      return 'red';
    }
    if (t < 10) return 'red';
    if (t < 18) return 'green';
    if (t < 19.6) return 'amber';
    return 'red';
  }
};
