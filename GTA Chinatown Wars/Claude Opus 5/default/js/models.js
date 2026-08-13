'use strict';
/* ------------------------------------------------------------------
   models.js — every moving thing, built once at boot.

   Local space convention for anything that "faces forward": forward is
   -Z, right is +X, so yaw 0 points up the screen in the default camera.

   Skinning: meshes tag vertices with a bone index and the renderer
   feeds 8 world matrices per draw.
     vehicles: 0 body, 1..4 wheels (FL FR RL RR)
     people:   0 torso+head, 1 L leg, 2 R leg, 3 L arm, 4 R arm
------------------------------------------------------------------ */

const VEHICLE_TYPES = {
  hatch: {
    name: 'Kestrel Mite', len: 3.7, wid: 1.72, ride: 0.30, wheelR: 0.33,
    topSpeed: 25, accel: 15, brake: 26, grip: 12.5, steer: 0.72, mass: 1.0, hp: 100,
    roofH: 0.62, hoodH: 0.42, cabFront: -0.10, cabBack: 0.34, style: 'hatch'
  },
  sedan: {
    name: 'Vantry Sable', len: 4.45, wid: 1.86, ride: 0.31, wheelR: 0.35,
    topSpeed: 29, accel: 15.5, brake: 27, grip: 12.0, steer: 0.62, mass: 1.15, hp: 120,
    roofH: 0.60, hoodH: 0.40, cabFront: -0.06, cabBack: 0.30, style: 'sedan'
  },
  sport: {
    name: 'Verrano Kite GT', len: 4.35, wid: 1.94, ride: 0.24, wheelR: 0.34,
    topSpeed: 39, accel: 22, brake: 30, grip: 11.0, steer: 0.58, mass: 1.0, hp: 95,
    roofH: 0.44, hoodH: 0.28, cabFront: 0.02, cabBack: 0.36, style: 'sport'
  },
  pickup: {
    name: 'Halloran Mule', len: 5.0, wid: 2.02, ride: 0.42, wheelR: 0.42,
    topSpeed: 27, accel: 14, brake: 24, grip: 10.6, steer: 0.60, mass: 1.4, hp: 165,
    roofH: 0.72, hoodH: 0.52, cabFront: -0.22, cabBack: 0.10, style: 'pickup'
  },
  van: {
    name: 'Ferro Courier', len: 5.2, wid: 2.10, ride: 0.40, wheelR: 0.40,
    topSpeed: 24, accel: 12, brake: 23, grip: 10.2, steer: 0.55, mass: 1.6, hp: 190,
    roofH: 1.25, hoodH: 0.55, cabFront: -0.40, cabBack: 0.44, style: 'van'
  },
  taxi: {
    name: 'Sable Cab', len: 4.45, wid: 1.86, ride: 0.31, wheelR: 0.35,
    topSpeed: 28, accel: 15, brake: 26, grip: 12.0, steer: 0.62, mass: 1.15, hp: 120,
    roofH: 0.60, hoodH: 0.40, cabFront: -0.06, cabBack: 0.30, style: 'taxi'
  },
  police: {
    name: 'PVPD Interceptor', len: 4.7, wid: 1.96, ride: 0.30, wheelR: 0.37,
    topSpeed: 34, accel: 19, brake: 30, grip: 12.8, steer: 0.62, mass: 1.25, hp: 175,
    roofH: 0.58, hoodH: 0.40, cabFront: -0.06, cabBack: 0.30, style: 'police'
  }
};

const CAR_COLORS = [
  [0.82, 0.18, 0.16], [0.14, 0.32, 0.62], [0.94, 0.72, 0.12], [0.10, 0.10, 0.12],
  [0.88, 0.88, 0.90], [0.16, 0.48, 0.36], [0.55, 0.20, 0.48], [0.90, 0.44, 0.10],
  [0.42, 0.46, 0.52], [0.20, 0.62, 0.66], [0.68, 0.66, 0.58], [0.35, 0.20, 0.14]
];

const Models = {
  cars: {},        // key -> { mesh, spec, wheels:[[x,y,z]x4] }
  peds: [],
  cop: null, playerPed: null,
  gun: null, bat: null,
  marker: null, arrow: null, spark: null, tracer: null,
  coin: null, crate: null, smoke: null, flash: null,
  lightRed: null, lightBlue: null,

  build() {
    for (const k in VEHICLE_TYPES) this.cars[k] = this._car(VEHICLE_TYPES[k]);
    for (let i = 0; i < 10; i++) this.peds.push(this._person(this._civOutfit(i)));
    this.cop = this._person({
      skin: [0.72, 0.55, 0.42], shirt: [0.13, 0.17, 0.34], pants: [0.11, 0.13, 0.24],
      hair: [0.15, 0.12, 0.10], cap: [0.10, 0.13, 0.28], vest: true
    });
    this.playerPed = this._person({
      skin: [0.80, 0.62, 0.47], shirt: [0.62, 0.13, 0.12], pants: [0.16, 0.17, 0.22],
      hair: [0.12, 0.10, 0.09], jacket: true
    });

    this.gun = this._gun();
    this.bat = this._bat();
    this.marker = this._marker();
    this.arrow = this._arrow();
    this.spark = this._blob([1, 0.85, 0.4], 0.16);
    this.smoke = this._blob([0.6, 0.6, 0.62], 0.5);
    this.blood = this._blob([0.55, 0.05, 0.06], 0.14);
    this.flash = this._flash();
    this.tracer = this._tracer();
    this.coin = this._coin();
    this.crate = this._crate();
    this.lightRed = this._lightbar([1, 0.1, 0.12], -1);
    this.lightBlue = this._lightbar([0.2, 0.4, 1], 1);
    this.ring = this._ring();
  },

  /* ------------------------------ vehicles ------------------------------ */
  _car(sp) {
    const mb = new MeshBuilder();
    const L = sp.len, W = sp.wid, R = sp.wheelR;
    const y0 = sp.ride, hoodY = y0 + sp.hoodH + 0.28;
    const bodyTop = y0 + 0.55;
    const hw = W / 2, hl = L / 2;
    const paint = { layer: TEX.CARPAINT, uv: 0.5, color: [1, 1, 1] };
    const dark = { layer: TEX.METAL, uv: 0.6, color: [0.16, 0.17, 0.2] };
    const glass = { layer: TEX.GLASS, uv: 0.6, color: [0.55, 0.7, 0.85] };

    // --- lower body: a single tapered slab, nose slightly narrower ---
    const nb = sp.style === 'van' || sp.style === 'pickup' ? 0.02 : 0.10;
    mb.prism(
      [-hw + 0.06, hl, hw - 0.06, hl, hw - 0.10, -hl, -hw + 0.10, -hl],
      y0 - 0.02,
      [-hw, hl - 0.05, hw, hl - 0.05, hw - nb, -hl + 0.08, -hw + nb, -hl + 0.08],
      bodyTop, Object.assign({ noBottom: false }, paint));

    // --- bonnet / bed deck ---
    if (sp.style === 'pickup') {
      mb.box(-hw + 0.04, bodyTop, -hl + 0.05, hw - 0.04, hoodY - 0.06, hl * 0.05, paint);   // cab base filled below
      mb.box(-hw + 0.06, bodyTop, hl * 0.06, hw - 0.06, bodyTop + 0.55, hl - 0.05, paint);   // bed walls
      mb.box(-hw + 0.22, bodyTop - 0.02, hl * 0.10, hw - 0.22, bodyTop + 0.12, hl - 0.18,
        { layer: TEX.METAL, uv: 0.5, color: [0.3, 0.31, 0.34] });
    } else {
      mb.taper(-hw + 0.05, bodyTop, -hl + 0.04, hw - 0.05, hoodY, hl - 0.04, 0.05, 0.0, paint);
    }

    // --- cabin ---
    const cf = L * sp.cabFront, cb = L * sp.cabBack;
    const roofY = hoodY + sp.roofH;
    if (sp.style === 'van') {
      mb.prism([-hw + 0.05, cb, hw - 0.05, cb, hw - 0.05, -hl + 0.10, -hw + 0.05, -hl + 0.10], hoodY,
        [-hw + 0.16, cb - 0.06, hw - 0.16, cb - 0.06, hw - 0.16, -hl + 0.30, -hw + 0.16, -hl + 0.30], roofY, paint);
    } else {
      mb.prism([-hw + 0.10, cb, hw - 0.10, cb, hw - 0.10, cf, -hw + 0.10, cf], hoodY,
        [-hw + 0.34, cb - 0.34, hw - 0.34, cb - 0.34, hw - 0.34, cf + 0.30, -hw + 0.34, cf + 0.30], roofY, paint);
    }

    // --- glazing (sits just proud of the cabin) ---
    const gy0 = hoodY + 0.06, gy1 = roofY - 0.07;
    const gi = 0.14;
    if (sp.style !== 'van') {
      // windscreen
      mb.quad([-hw + 0.24, gy0, cf - 0.02, hw - 0.24, gy0, cf - 0.02,
        hw - 0.42, gy1, cf + 0.30, -hw + 0.42, gy1, cf + 0.30], glass);
      // rear glass
      mb.quad([-hw + 0.24, gy0, cb + 0.02, hw - 0.24, gy0, cb + 0.02,
        hw - 0.42, gy1, cb - 0.32, -hw + 0.42, gy1, cb - 0.32], glass);
    }
    // side glass
    const sx = hw - gi;
    mb.quad([sx, gy0, cb - 0.10, sx, gy0, cf + 0.10, sx - 0.22, gy1, cf + 0.34, sx - 0.22, gy1, cb - 0.36], glass);
    mb.quad([-sx, gy0, cf + 0.10, -sx, gy0, cb - 0.10, -sx + 0.22, gy1, cb - 0.36, -sx + 0.22, gy1, cf + 0.34], glass);

    // --- bumpers, lights, grille ---
    mb.box(-hw + 0.02, y0 + 0.06, -hl - 0.10, hw - 0.02, y0 + 0.34, -hl + 0.10, dark);
    mb.box(-hw + 0.02, y0 + 0.06, hl - 0.10, hw - 0.02, y0 + 0.34, hl + 0.10, dark);
    const head = { layer: TEX.BLANK, uv: 1, color: [1, 0.96, 0.82], emis: 0.85 };
    const tail = { layer: TEX.BLANK, uv: 1, color: [0.9, 0.12, 0.10], emis: 0.7 };
    for (const s of [-1, 1]) {
      mb.box(s * (hw - 0.62), y0 + 0.30, -hl - 0.04, s * (hw - 0.22), y0 + 0.52, -hl + 0.02, head);
      mb.box(s * (hw - 0.58), y0 + 0.32, hl - 0.02, s * (hw - 0.18), y0 + 0.52, hl + 0.04, tail);
    }

    // --- style extras ---
    if (sp.style === 'taxi') {
      mb.box(-0.42, roofY, -0.30, 0.42, roofY + 0.26, 0.30,
        { layer: TEX.BLANK, uv: 1, color: [1.0, 0.8, 0.15], emis: 0.6 });
      mb.box(-hw - 0.005, y0 + 0.22, -0.5, hw + 0.005, y0 + 0.5, 0.9,
        { layer: TEX.BLANK, uv: 1, color: [0.1, 0.1, 0.12] });
    }
    if (sp.style === 'police') {
      mb.box(-0.62, roofY, -0.22, 0.62, roofY + 0.10, 0.22, dark);
      mb.box(-hw - 0.006, y0 + 0.30, -0.9, hw + 0.006, y0 + 0.56, 0.7,
        { layer: TEX.BLANK, uv: 1, color: [0.12, 0.14, 0.2] });
    }

    // --- wheels (bones 1..4) ---
    const wx = hw - 0.10, wz = hl * (sp.style === 'van' || sp.style === 'pickup' ? 0.62 : 0.66);
    const wheels = [[-wx, R, -wz], [wx, R, -wz], [-wx, R, wz], [wx, R, wz]];
    for (let i = 0; i < 4; i++) {
      const bone = i + 1;
      mb.cyl(0, 0, 0, R, R, 0.30, 12, {
        axis: 'x', bone, layer: TEX.METAL, uv: 0.7, color: [0.10, 0.10, 0.12],
        capLayer: TEX.METAL, capColor: [0.10, 0.10, 0.12], hull: [0, 0, 0]
      });
      // hub cap, offset outward on the correct side
      const s = wheels[i][0] < 0 ? -1 : 1;
      mb.cyl(s * 0.16, 0, 0, R * 0.55, R * 0.5, 0.05 * s, 10, {
        axis: 'x', bone, layer: TEX.METAL, uv: 0.7, color: [0.66, 0.68, 0.72], hull: [0, 0, 0]
      });
    }

    return { mesh: mb.upload(), spec: sp, wheels, half: [hw, hl], roofY };
  },

  _lightbar(col, side) {
    const p = VEHICLE_TYPES.police;
    const y = p.ride + p.hoodH + 0.28 + p.roofH + 0.09;   // just above the roof box
    const mb = new MeshBuilder();
    mb.box(side * 0.06, y, -0.16, side * 0.58, y + 0.17, 0.16,
      { layer: TEX.BLANK, uv: 1, color: col, emis: 1 });
    return mb.upload();
  },

  /* ------------------------------ people ------------------------------ */
  _civOutfit(i) {
    const skins = [[0.86, 0.68, 0.52], [0.66, 0.47, 0.34], [0.48, 0.33, 0.24], [0.92, 0.76, 0.62], [0.74, 0.56, 0.40]];
    const shirts = [[0.85, 0.30, 0.25], [0.20, 0.42, 0.70], [0.95, 0.80, 0.25], [0.25, 0.60, 0.45],
    [0.90, 0.90, 0.88], [0.55, 0.30, 0.62], [0.20, 0.22, 0.26], [0.95, 0.55, 0.20],
    [0.35, 0.65, 0.72], [0.72, 0.36, 0.42]];
    const pants = [[0.22, 0.26, 0.38], [0.18, 0.18, 0.20], [0.40, 0.34, 0.26], [0.30, 0.30, 0.34], [0.24, 0.32, 0.28]];
    const hair = [[0.12, 0.09, 0.07], [0.35, 0.22, 0.10], [0.55, 0.45, 0.22], [0.10, 0.10, 0.12], [0.45, 0.30, 0.25]];
    return {
      skin: skins[i % skins.length], shirt: shirts[i % shirts.length],
      pants: pants[(i * 3) % pants.length], hair: hair[(i * 7) % hair.length]
    };
  },

  _person(o) {
    const mb = new MeshBuilder();
    const skin = { layer: TEX.BLANK, uv: 1, color: o.skin };
    const shirt = { layer: TEX.BLANK, uv: 1, color: o.shirt };
    const pants = { layer: TEX.BLANK, uv: 1, color: o.pants };
    const hairO = { layer: TEX.BLANK, uv: 1, color: o.hair };

    // bone 0: torso + head, authored in world-ish upright space
    mb.taper(-0.21, 0.74, -0.12, 0.21, 1.32, 0.12, 0.03, 0.01, shirt);
    if (o.jacket) {
      mb.box(-0.235, 0.74, -0.14, -0.15, 1.30, 0.14, { layer: TEX.BLANK, uv: 1, color: [o.shirt[0] * 0.7, o.shirt[1] * 0.7, o.shirt[2] * 0.7] });
      mb.box(0.15, 0.74, -0.14, 0.235, 1.30, 0.14, { layer: TEX.BLANK, uv: 1, color: [o.shirt[0] * 0.7, o.shirt[1] * 0.7, o.shirt[2] * 0.7] });
    }
    if (o.vest) mb.box(-0.225, 0.80, -0.135, 0.225, 1.16, 0.135, { layer: TEX.BLANK, uv: 1, color: [0.86, 0.88, 0.35], emis: 0.15 });
    mb.box(-0.09, 1.32, -0.08, 0.09, 1.40, 0.08, skin);                       // neck
    mb.taper(-0.145, 1.40, -0.135, 0.145, 1.66, 0.135, 0.02, 0.02, skin);     // head
    if (o.cap) {
      mb.box(-0.155, 1.62, -0.145, 0.155, 1.72, 0.145, { layer: TEX.BLANK, uv: 1, color: o.cap });
      mb.box(-0.14, 1.62, -0.29, 0.14, 1.68, -0.14, { layer: TEX.BLANK, uv: 1, color: o.cap });
    } else {
      mb.box(-0.152, 1.56, -0.142, 0.152, 1.70, 0.142, hairO);
    }
    // eyes read at distance and make facing obvious
    mb.box(-0.085, 1.50, -0.145, -0.025, 1.545, -0.138, { layer: TEX.BLANK, uv: 1, color: [0.1, 0.1, 0.12] });
    mb.box(0.025, 1.50, -0.145, 0.085, 1.545, -0.138, { layer: TEX.BLANK, uv: 1, color: [0.1, 0.1, 0.12] });

    // bones 1/2: legs (pivot at origin, hanging down)
    for (let i = 0; i < 2; i++) {
      const bone = i + 1;
      mb.box(-0.085, -0.72, -0.085, 0.085, 0.02, 0.085, Object.assign({ bone, hull: [0, -0.35, 0] }, pants));
      mb.box(-0.095, -0.78, -0.15, 0.095, -0.70, 0.06,
        { bone, hull: [0, -0.35, 0], layer: TEX.BLANK, uv: 1, color: [0.14, 0.13, 0.15] });
    }
    // bones 3/4: arms
    for (let i = 0; i < 2; i++) {
      const bone = i + 3;
      mb.box(-0.072, -0.42, -0.072, 0.072, 0.06, 0.072,
        Object.assign({ bone, hull: [0, -0.2, 0] }, o.jacket || o.vest ? shirt : shirt));
      mb.box(-0.065, -0.56, -0.065, 0.065, -0.40, 0.065,
        { bone, hull: [0, -0.2, 0], layer: TEX.BLANK, uv: 1, color: o.skin });
    }
    return mb.upload();
  },

  _gun() {
    const mb = new MeshBuilder();
    const o = { layer: TEX.METAL, uv: 1, color: [0.16, 0.17, 0.20] };
    mb.box(-0.045, -0.50, -0.34, 0.045, -0.38, 0.02, o);
    mb.box(-0.04, -0.60, -0.05, 0.04, -0.46, 0.06, o);
    return mb.upload();
  },

  _bat() {
    const mb = new MeshBuilder();
    mb.cyl(0, -0.46, 0, 0.045, 0.085, 0.86, 8,
      { axis: 'z', layer: TEX.WOOD, uv: 0.9, color: [0.72, 0.55, 0.36], hull: [0, -0.46, 0.4] });
    return mb.upload();
  },

  // Markers and rings are drawn in the blended pass with culling off,
  // so a single-sided shell reads correctly from every angle.
  _marker() {
    const mb = new MeshBuilder();
    mb.cyl(0, 0, 0, 1, 1, 2.6, 20,
      { layer: TEX.BLANK, uv: 1, color: [1, 1, 1], emis: 1, noCaps: true, noHull: true });
    return mb.upload();
  },

  _ring() {
    const mb = new MeshBuilder();
    const seg = 28;
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * TAU, a1 = (i + 1) / seg * TAU;
      const r0 = 0.82, r1 = 1.0;
      mb.quad([
        Math.cos(a0) * r0, 0, Math.sin(a0) * r0,
        Math.cos(a0) * r1, 0, Math.sin(a0) * r1,
        Math.cos(a1) * r1, 0, Math.sin(a1) * r1,
        Math.cos(a1) * r0, 0, Math.sin(a1) * r0
      ], { layer: TEX.BLANK, uv: 1, color: [1, 1, 1], emis: 1, noHull: true });
    }
    return mb.upload();
  },

  _arrow() {
    const mb = new MeshBuilder();
    const o = { layer: TEX.BLANK, uv: 1, color: [1, 1, 1], emis: 1 };
    mb.prism([-0.5, 0.5, 0.5, 0.5, 0, -0.7, 0, -0.7], 0, [-0.5, 0.5, 0.5, 0.5, 0, -0.7, 0, -0.7], 0.28, o);
    return mb.upload();
  },

  _blob(col, r) {
    const mb = new MeshBuilder();
    mb.box(-r, -r, -r, r, r, r, { layer: TEX.BLANK, uv: 1, color: col, emis: 0.5, noHull: true });
    return mb.upload();
  },

  _flash() {
    const mb = new MeshBuilder();
    const o = { layer: TEX.BLANK, uv: 1, color: [1, 0.92, 0.6], emis: 1, noHull: true };
    mb.box(-0.34, -0.06, -0.06, 0.34, 0.06, 0.06, o);
    mb.box(-0.06, -0.34, -0.06, 0.06, 0.34, 0.06, o);
    mb.box(-0.06, -0.06, -0.34, 0.06, 0.06, 0.34, o);
    return mb.upload();
  },

  _tracer() {
    const mb = new MeshBuilder();
    mb.box(-0.035, -0.035, -1.7, 0.035, 0.035, 1.7,
      { layer: TEX.BLANK, uv: 1, color: [1, 0.85, 0.45], emis: 1, noHull: true });
    return mb.upload();
  },

  _coin() {
    const mb = new MeshBuilder();
    mb.cyl(0, 0, 0, 0.26, 0.26, 0.07, 10,
      { axis: 'z', layer: TEX.BLANK, uv: 1, color: [0.35, 0.72, 0.36], emis: 0.45 });
    return mb.upload();
  },

  _crate() {
    const mb = new MeshBuilder();
    mb.box(-0.34, 0, -0.26, 0.34, 0.52, 0.26, { layer: TEX.WOOD, uv: 0.9, color: [0.78, 0.62, 0.4] });
    mb.box(-0.36, 0.20, -0.28, 0.36, 0.30, 0.28, { layer: TEX.BLANK, uv: 1, color: [0.8, 0.2, 0.15], emis: 0.3 });
    return mb.upload();
  }
};
