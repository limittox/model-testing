'use strict';
/* ------------------------------------------------------------------
   vehicle.js — arcade driving.

   The model is the classic "split the velocity into forward and
   sideways, then kill the sideways component" trick: grip is just an
   exponential decay on lateral speed. Drop the decay rate (handbrake,
   or a wrecked car) and it slides. It is not a simulation and that is
   the point — it turns in immediately and holds a drift.
------------------------------------------------------------------ */

class Vehicle {
  constructor(type, x, z, yaw, color) {
    const model = Models.cars[type];
    this.type = type;
    this.model = model;
    this.spec = model.spec;
    this.color = color || pick(CAR_COLORS);

    this.x = x; this.z = z; this.y = 0; this.yaw = yaw || 0;
    this.vx = 0; this.vz = 0;
    this.speed = 0;            // signed forward speed (m/s)
    this.lat = 0;
    this.yawRate = 0;
    this.steer = 0;
    this.wheelSpin = 0;
    this.roll = 0; this.pitch = 0;

    this.ctrl = { throttle: 0, brake: 0, steer: 0, hand: false };
    this.hp = this.spec.hp;
    this.maxHp = this.spec.hp;
    this.wrecked = false;
    this.burnT = 0;
    this.driver = null;        // Player or Ped currently at the wheel
    this.owner = null;         // ped that walked away from it
    this.isPolice = type === 'police';
    this.parked = true;
    this.locked = false;
    this.missionCar = false;
    this.skid = 0;
    this.hornT = 0;
    this.bones = new Float32Array(8 * 16);
    for (let i = 0; i < 8; i++) M4.identity(this.bones.subarray(i * 16, i * 16 + 16));
    this.tint = this.color.slice();
    this.dead = false;
    this.despawnT = 0;
  }

  get name() { return this.spec.name; }
  get forwardX() { return Math.sin(this.yaw); }
  get forwardZ() { return -Math.cos(this.yaw); }

  /** two collision circles, front and rear */
  circles(out) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const d = this.spec.len * 0.26;
    out[0] = this.x - s * -d; out[1] = this.z + c * -d;   // front (local -Z)
    out[2] = this.x - s * d; out[3] = this.z + c * d;     // rear
    return out;
  }
  get radius() { return this.spec.wid * 0.56; }

  hurt(n, byPlayer) {
    if (this.wrecked) return;
    this.hp -= n;
    if (this.hp <= 0) {
      this.hp = 0;
      this.wrecked = true;
      this.burnT = rand(2.6, 4.4);
      if (byPlayer) Game.onVehicleWrecked(this);
    }
  }

  update(dt) {
    const sp = this.spec;
    if (this.wrecked) {
      this.ctrl.throttle = 0; this.ctrl.brake = 0; this.ctrl.steer = 0;
      this.burnT -= dt;
      if (this.burnT <= 0 && !this.dead) Game.explodeVehicle(this);
    }

    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const fx = s, fz = -c;         // forward
    const rx = c, rz = s;          // right

    // world velocity -> car frame
    let vLong = this.vx * fx + this.vz * fz;
    let vLat = this.vx * rx + this.vz * rz;

    const ct = this.ctrl;
    const top = sp.topSpeed * (this.wrecked ? 0 : 1);

    // --- engine / brakes ---
    if (ct.throttle > 0.01 && !this.wrecked) {
      const headroom = clamp(1 - Math.abs(vLong) / Math.max(top, 1), 0, 1);
      vLong += ct.throttle * sp.accel * (0.35 + 0.65 * headroom) * dt;
    }
    if (ct.brake > 0.01) {
      if (vLong > 0.4) vLong -= ct.brake * sp.brake * dt;
      else if (!this.wrecked) vLong -= ct.brake * sp.accel * 0.55 * dt;   // reverse
      if (vLong < -top * 0.42) vLong = -top * 0.42;
    }
    // drag + rolling resistance (a locked handbrake slides, it doesn't stop you)
    vLong -= vLong * (0.30 + (ct.hand ? 0.5 : 0)) * dt;
    if (!ct.throttle && !ct.brake) vLong -= Math.sign(vLong) * Math.min(Math.abs(vLong), 2.1 * dt);
    if (Math.abs(vLong) > top) vLong = Math.sign(vLong) * top;

    // --- steering ---
    const speedAbs = Math.abs(vLong);
    const steerLimit = sp.steer / (1 + speedAbs * 0.052);
    const target = ct.steer * steerLimit;
    this.steer = damp(this.steer, target, 12, dt);

    const wheelbase = sp.len * 0.60;
    let grip = sp.grip;
    if (ct.hand) grip *= 0.09;
    if (this.wrecked) grip *= 0.4;
    // losing grip when sliding fast keeps drifts alive instead of snapping
    grip *= clamp(1.25 - Math.abs(vLat) * 0.035, 0.45, 1.25);

    let yawRate = (vLong / wheelbase) * Math.tan(this.steer);
    if (ct.hand && speedAbs > 3) yawRate *= 1.85;
    this.yawRate = damp(this.yawRate, yawRate, 16, dt);
    this.yaw += this.yawRate * dt;

    // --- grip: bleed off sideways speed ---
    const before = vLat;
    vLat *= Math.exp(-grip * dt);
    this.skid = clamp(Math.abs(before) * 0.09 + (ct.hand && speedAbs > 6 ? 0.5 : 0), 0, 1);
    if (this.skid > 0.55 && this === Game.playerVehicle) Sound.play('skid', this.skid * 0.8);

    // recompose with the new heading
    const c2 = Math.cos(this.yaw), s2 = Math.sin(this.yaw);
    this.vx = s2 * vLong + c2 * vLat;
    this.vz = -c2 * vLong + s2 * vLat;
    this.speed = vLong;
    this.lat = vLat;

    // cosmetic body attitude
    this.roll = damp(this.roll, clamp(-this.yawRate * vLong * 0.011 - vLat * 0.008, -0.13, 0.13), 8, dt);
    this.pitch = damp(this.pitch, clamp((ct.brake > 0.1 ? 0.035 : 0) - ct.throttle * 0.022, -0.05, 0.05), 7, dt);
    this.wheelSpin += (vLong / Math.max(0.1, sp.wheelR)) * dt;

    // --- integrate + collide ---
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this._collideWorld(dt);
  }

  _collideWorld(dt) {
    const pts = this.circles([0, 0, 0, 0]);
    const r = this.radius;
    let hitN = 0, nx = 0, nz = 0, worst = 0;
    for (let k = 0; k < 2; k++) {
      const res = Collide.circle(pts[k * 2], pts[k * 2 + 1], r);
      if (!res.hit) continue;
      const dx = res.x - pts[k * 2], dz = res.z - pts[k * 2 + 1];
      this.x += dx; this.z += dz;
      pts[0] += dx; pts[2] += dx; pts[1] += dz; pts[3] += dz;
      nx += res.nx; nz += res.nz; hitN++;
      worst = Math.max(worst, res.depth);
      // glancing hits spin the car a little
      const lever = k === 0 ? -1 : 1;
      this.yaw += lever * (dx * Math.cos(this.yaw) + dz * Math.sin(this.yaw)) * 0.12;
    }
    if (!hitN) return;
    const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    const vn = this.vx * nx + this.vz * nz;
    if (vn < 0) {
      const impact = -vn;
      this.vx -= nx * vn * 1.35;
      this.vz -= nz * vn * 1.35;
      this.vx *= 0.72; this.vz *= 0.72;
      if (impact > 4) {
        this.hurt(impact * 2.4, this === Game.playerVehicle);
        Game.impact(this.x, this.z, impact, this === Game.playerVehicle);
      } else if (impact > 1.2) {
        Sound.play('scrape', clamp(impact / 8, 0, 0.6) * Game.audible(this.x, this.z));
      }
    }
  }

  /** elastic-ish separation between two cars */
  static collide(a, b) {
    const pa = a.circles([0, 0, 0, 0]), pb = b.circles([0, 0, 0, 0]);
    const ra = a.radius, rb = b.radius;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const dx = pb[j * 2] - pa[i * 2], dz = pb[j * 2 + 1] - pa[i * 2 + 1];
      const d2 = dx * dx + dz * dz, rr = ra + rb;
      if (d2 > rr * rr || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d, nz = dz / d;
      const push = (rr - d) * 0.5;
      const ma = a.spec.mass, mb = b.spec.mass, mt = ma + mb;
      a.x -= nx * push * (mb / mt) * 2; a.z -= nz * push * (mb / mt) * 2;
      b.x += nx * push * (ma / mt) * 2; b.z += nz * push * (ma / mt) * 2;

      const rvx = b.vx - a.vx, rvz = b.vz - a.vz;
      const vn = rvx * nx + rvz * nz;
      if (vn < 0) {
        const imp = -vn * 0.9;
        a.vx -= nx * imp * (mb / mt); a.vz -= nz * imp * (mb / mt);
        b.vx += nx * imp * (ma / mt); b.vz += nz * imp * (ma / mt);
        a.yaw -= nz * 0.02 * imp * (i === 0 ? 1 : -1);
        b.yaw += nz * 0.02 * imp * (j === 0 ? 1 : -1);
        if (imp > 3.5) {
          const byPlayer = a === Game.playerVehicle || b === Game.playerVehicle;
          a.hurt(imp * 1.5, byPlayer); b.hurt(imp * 1.5, byPlayer);
          Game.impact((a.x + b.x) / 2, (a.z + b.z) / 2, imp, byPlayer);
        }
      }
      return;
    }
  }

  /** where a person standing next to this car should be */
  exitPoint(out) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const off = this.spec.wid * 0.5 + 0.85;
    for (const side of [-1, 1]) {
      const px = this.x + c * off * side, pz = this.z + s * off * side;
      const res = Collide.circle(px, pz, 0.42);
      if (!res.hit) { out[0] = px; out[1] = pz; return out; }
    }
    out[0] = this.x - Math.sin(this.yaw) * (this.spec.len * 0.5 + 1.2);
    out[1] = this.z + Math.cos(this.yaw) * (this.spec.len * 0.5 + 1.2);
    return out;
  }

  submit() {
    const b = this.bones;
    M4.trsFull(b.subarray(0, 16), this.x, this.y, this.z, this.yaw, this.pitch, this.roll, 1);
    const w = this.model.wheels;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    for (let i = 0; i < 4; i++) {
      const lx = w[i][0], ly = w[i][1], lz = w[i][2];
      const wx = this.x + c * lx - s * lz;
      const wz = this.z + s * lx + c * lz;
      const front = i < 2;
      M4.trsFull(b.subarray((i + 1) * 16, (i + 2) * 16),
        wx, this.y + ly, wz, this.yaw + (front ? this.steer : 0), this.wheelSpin, 0, 1);
    }
    const dmg = this.wrecked ? 0.42 : lerp(0.55, 1, this.hp / this.maxHp);
    this.tint[0] = this.color[0] * dmg;
    this.tint[1] = this.color[1] * dmg;
    this.tint[2] = this.color[2] * dmg;
    Renderer.draw(this.model.mesh, b, this.tint, 0.065, 0);

    if (this.isPolice) {
      const on = ((Renderer.time * 6) | 0) & 1;
      Renderer.draw(Models.lightRed, b, WHITE, 0, on ? 1 : 0.05);
      Renderer.draw(Models.lightBlue, b, WHITE, 0, on ? 0.05 : 1);
    }
  }
}
