'use strict';
/* ------------------------------------------------------------------
   traffic.js — AI drivers and the traffic population manager.

   A driver walks the intersection graph, holds a lane by projecting
   itself onto the lane centreline and aiming a few metres ahead, obeys
   the signal cycle, and brakes for whatever is in front of it. Police
   use the same driver with `chase` set, which just changes how the
   next junction is picked and lets it cut the corner at the target.
------------------------------------------------------------------ */

class Driver {
  constructor(v, opts) {
    opts = opts || {};
    this.v = v;
    this.chase = opts.chase || null;      // entity to hunt, or null
    this.cruise = opts.cruise || 0.62;
    this.aggro = opts.aggro || 0;
    this.from = 0; this.to = 0; this.lane = 0;
    this.stuck = 0; this.reverseT = 0;
    this.blockT = 0;
    this.honk = rand(2, 8);
    v.parked = false;
  }

  placeOnRoad(fromIdx, toIdx, t) {
    const a = City.nodes[fromIdx], b = City.nodes[toIdx];
    this.from = fromIdx; this.to = toIdx;
    this.lane = City.lanesOn(a, b) > 1 ? randInt(0, 1) : 0;
    const dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    const ux = dx / l, uz = dz / l;
    const rx = -uz, rz = ux;
    const off = City.laneOffset(a, b, this.lane);
    this.v.x = a.x + ux * l * t + rx * off;
    this.v.z = a.z + uz * l * t + rz * off;
    this.v.yaw = Math.atan2(ux, -uz);
    const s = this.v.spec.topSpeed * this.cruise;
    this.v.vx = ux * s; this.v.vz = uz * s;
  }

  _seg() {
    const a = City.nodes[this.from], b = City.nodes[this.to];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    return { a, b, ux: dx / len, uz: dz / len, len };
  }

  _advance() {
    const cur = this.to;
    const node = City.nodes[cur];
    const links = node.links;
    let best = -1;
    if (this.chase && !this.chase.dead) {
      let bd = 1e9;
      for (const n of links) {
        const nn = City.nodes[n];
        const d = dist2(nn.x, nn.z, this.chase.x, this.chase.z);
        if (d < bd && (n !== this.from || links.length === 1)) { bd = d; best = n; }
      }
    } else {
      // prefer carrying straight on
      const a = City.nodes[this.from];
      const ni = node.i + Math.sign(node.i - a.i), nj = node.j + Math.sign(node.j - a.j);
      let straight = -1;
      if (ni >= 0 && ni < City.N && nj >= 0 && nj < City.N) {
        const idx = nj * City.N + ni;
        if (links.indexOf(idx) >= 0) straight = idx;
      }
      const options = links.filter(n => n !== this.from);
      if (!options.length) best = this.from;
      else if (straight >= 0 && options.indexOf(straight) >= 0 && chance(0.62)) best = straight;
      else best = pick(options);
    }
    this.from = cur;
    this.to = best < 0 ? pick(links) : best;
    const a2 = City.nodes[this.from], b2 = City.nodes[this.to];
    const lanes = City.lanesOn(a2, b2);
    if (this.lane >= lanes) this.lane = lanes - 1;
    else if (lanes > 1 && chance(0.25)) this.lane = randInt(0, lanes - 1);
  }

  update(dt) {
    const v = this.v;
    if (v.wrecked) { v.ctrl.throttle = 0; v.ctrl.brake = 1; v.ctrl.steer = 0; return; }

    const s = this._seg();
    const off = City.laneOffset(s.a, s.b, this.lane);
    const rx = -s.uz, rz = s.ux;
    const ox = s.a.x + rx * off, oz = s.a.z + rz * off;
    // how far along the segment we are
    let along = (v.x - ox) * s.ux + (v.z - oz) * s.uz;

    if (along > s.len - 3.5) { this._advance(); return; }

    const look = clamp(6 + Math.abs(v.speed) * 0.55, 6, 18);
    let tX, tZ;
    if (this.chase && !this.chase.dead &&
      dist2(v.x, v.z, this.chase.x, this.chase.z) < 900 &&
      Collide.clear(v.x, v.z, this.chase.x, this.chase.z)) {
      tX = this.chase.x; tZ = this.chase.z;                 // straight for the target
    } else {
      const at = Math.min(along + look, s.len - 0.5);
      tX = ox + s.ux * at; tZ = oz + s.uz * at;
    }

    const dx = tX - v.x, dz = tZ - v.z;
    const want = Math.atan2(dx, -dz);
    const err = wrapAngle(want - v.yaw);
    v.ctrl.steer = clamp(err * 2.4, -1, 1);

    // --- desired speed ---
    let desired = v.spec.topSpeed * this.cruise * (1 - Math.min(0.55, Math.abs(err) * 0.75));

    // signal at the junction we're approaching
    const distToNode = s.len - along;
    const alongX = Math.abs(s.ux) > Math.abs(s.uz);
    if (!this.chase && distToNode < 22) {
      const sig = City.signal(alongX);
      const stopAt = City.nodes[this.to];
      const halfW = (alongX ? stopAt.wx : stopAt.wz) / 2 + 2.5;
      if ((sig === 'red' || (sig === 'amber' && distToNode > halfW + 6)) && distToNode > halfW) {
        desired = Math.max(0, (distToNode - halfW - 1.5) * 1.4);
      }
    }

    // --- traffic ahead ---
    const fx = Math.sin(v.yaw), fz = -Math.cos(v.yaw);
    let blocked = 0;
    const near = Game.vehicles;
    for (let i = 0; i < near.length; i++) {
      const o = near[i];
      if (o === v || o.dead) continue;
      const ddx = o.x - v.x, ddz = o.z - v.z;
      const d = Math.hypot(ddx, ddz);
      if (d > 15 || d < 0.01) continue;
      const fwd = (ddx * fx + ddz * fz) / d;
      if (fwd < 0.82) continue;
      const gap = d - v.spec.len * 0.5 - o.spec.len * 0.5;
      if (gap < 8) { blocked = Math.max(blocked, 1 - clamp(gap / 8, 0, 1)); }
    }
    // people in the road
    if (!this.aggro) {
      for (const p of Game.peds) {
        if (p.dead) continue;
        const ddx = p.x - v.x, ddz = p.z - v.z;
        const d = Math.hypot(ddx, ddz);
        if (d > 8) continue;
        if ((ddx * fx + ddz * fz) / (d || 1) > 0.8) blocked = Math.max(blocked, 1 - d / 8);
      }
    }
    if (blocked > 0) desired *= (1 - blocked);
    if (blocked > 0.75) {
      this.blockT += dt;
      if (this.blockT > 1.6 && (this.honk -= dt) < 0) {
        Sound.play('horn', 0.35 * Game.audible(v.x, v.z));
        this.honk = rand(3, 9);
      }
    } else this.blockT = 0;

    // --- pedals ---
    const cur = v.speed;
    if (desired < 0.4 && cur < 1.2) { v.ctrl.throttle = 0; v.ctrl.brake = 1; }
    else if (cur < desired - 0.6) { v.ctrl.throttle = clamp((desired - cur) / 5, 0.15, 1); v.ctrl.brake = 0; }
    else if (cur > desired + 1.2) { v.ctrl.throttle = 0; v.ctrl.brake = clamp((cur - desired) / 6, 0.15, 1); }
    else { v.ctrl.throttle = 0.25; v.ctrl.brake = 0; }
    v.ctrl.hand = false;

    // --- unstick ---
    if (Math.abs(cur) < 0.6 && desired > 2) this.stuck += dt; else this.stuck = 0;
    if (this.stuck > 2.2) { this.reverseT = 1.1; this.stuck = 0; }
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      v.ctrl.throttle = 0; v.ctrl.brake = 1; v.ctrl.steer = -v.ctrl.steer;
    }
  }
}

const Traffic = {
  MAX: 34,
  spawnT: 0,

  update(dt) {
    this.spawnT -= dt;
    const px = Player.x, pz = Player.z;

    // retire cars that have driven off into the fog
    for (let i = Game.vehicles.length - 1; i >= 0; i--) {
      const v = Game.vehicles[i];
      if (!v.driverAI || v.missionCar || v === Player.inCar || v.isPolice) continue;
      const d2 = dist2(v.x, v.z, px, pz);
      if (d2 > 300 * 300 || (v.dead)) Game.removeVehicle(v);
    }

    let live = 0;
    for (const v of Game.vehicles) if (v.driverAI && !v.isPolice) live++;
    if (live >= this.MAX || this.spawnT > 0) return;
    this.spawnT = 0.28;
    this._spawn(px, pz);
  },

  _spawn(px, pz) {
    for (let attempt = 0; attempt < 14; attempt++) {
      const n = randInt(0, City.nodes.length - 1);
      const a = City.nodes[n];
      const d = Math.hypot(a.x - px, a.z - pz);
      if (d < 52 || d > 155) continue;
      const toIdx = pick(a.links);
      const t = rand(0.18, 0.82);
      const type = pick(['sedan', 'sedan', 'hatch', 'hatch', 'taxi', 'van', 'pickup', 'sport']);
      const v = new Vehicle(type, 0, 0, 0);
      const drv = new Driver(v, { cruise: rand(0.5, 0.78) });
      drv.placeOnRoad(n, toIdx, t);
      if (Game.spaceOccupied(v.x, v.z, v.spec.len * 0.75, v)) continue;
      if (Game.onScreen(v.x, v.z, 12)) continue;
      v.driverAI = drv;
      Game.vehicles.push(v);
      return;
    }
  }
};
