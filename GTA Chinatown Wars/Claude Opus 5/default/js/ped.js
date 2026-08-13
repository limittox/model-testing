'use strict';
/* ------------------------------------------------------------------
   ped.js — the people of Saltgrave.

   Deliberately dumb: pick a nearby point on a sidewalk, walk to it,
   pick another. What sells them as alive is the reaction layer —
   they scream and scatter from gunfire, corpses, speeding cars and
   anyone swinging a pipe, then sheepishly go back to walking.
------------------------------------------------------------------ */

const PED_LINES = [
  'Watch it!', 'You got a problem?', 'Move along.', 'Nice night for it.',
  'Not today, pal.', 'Spare a coin?', 'I saw nothing.', 'Keep walking.',
  'This district is finished.', 'Ferro pays late, always.'
];

class Ped {
  constructor(x, z, variant) {
    this.x = x; this.z = z; this.y = 0;
    this.yaw = rand(0, TAU);
    this.vx = 0; this.vz = 0;
    this.variant = variant === undefined ? randInt(0, Models.peds.length - 1) : variant;
    this.mesh = Models.peds[this.variant];
    this.hp = 42; this.dead = false; this.deadT = 0;
    this.hitRadius = 0.5;
    this.radius = 0.36;
    this.state = 'walk';
    this.tx = x; this.tz = z;
    this.think = rand(0, 2);
    this.panic = 0;
    this.walk = 0; this.speed = 0;
    this.bones = new Float32Array(8 * 16);
    for (let i = 0; i < 8; i++) M4.identity(this.bones.subarray(i * 16, i * 16 + 16));
    this.cash = randInt(8, 60);
    this.talkT = 0;
    this.isCop = false;
    this._pick();
  }

  _pick() {
    const spots = City.pedSpots;
    for (let k = 0; k < 12; k++) {
      const s = spots[(Math.random() * spots.length) | 0];
      const d2 = dist2(s.x, s.z, this.x, this.z);
      if (d2 > 36 && d2 < 5200) { this.tx = s.x; this.tz = s.z; return; }
    }
    this.tx = this.x + rand(-14, 14); this.tz = this.z + rand(-14, 14);
  }

  scare(fromX, fromZ, secs) {
    if (this.dead) return;
    if (this.panic <= 0) Sound.play('scream', 0.5 * Game.audible(this.x, this.z));
    this.panic = Math.max(this.panic, secs);
    const dx = this.x - fromX, dz = this.z - fromZ;
    const l = Math.hypot(dx, dz) || 1;
    this.fx = dx / l; this.fz = dz / l;
    this.state = 'flee';
  }

  knock(vx, vz) { this.vx += vx; this.vz += vz; }

  hurt(n, by, byPlayer) {
    if (this.dead) return;
    this.hp -= n;
    this.panic = Math.max(this.panic, 9);
    this.state = 'flee';
    if (by && by !== this) {
      const dx = this.x - by.x, dz = this.z - by.z, l = Math.hypot(dx, dz) || 1;
      this.fx = dx / l; this.fz = dz / l;
    }
    Sound.play('grunt', 0.4 * Game.audible(this.x, this.z));
    if (this.hp <= 0) {
      this.hp = 0; this.dead = true; this.deadT = 0;
      Sound.play('scream', 0.7 * Game.audible(this.x, this.z));
      Game.onPedKilled(this, byPlayer);
    } else if (byPlayer) {
      Game.noteCrime('assault', this.x, this.z, 1);
    }
    Game.scarePeds(this.x, this.z, 16, 6);
  }

  update(dt) {
    if (this.dead) {
      this.deadT += dt;
      this.vx *= 1 - 6 * dt; this.vz *= 1 - 6 * dt;
      this.x += this.vx * dt; this.z += this.vz * dt;
      return;
    }
    this.panic = Math.max(0, this.panic - dt);
    this.talkT = Math.max(0, this.talkT - dt);
    this.think -= dt;

    let maxV = 3.0, tx = this.tx, tz = this.tz;
    if (this.panic > 0) {
      maxV = 6.6;
      tx = this.x + this.fx * 12;
      tz = this.z + this.fz * 12;
      if (this.think <= 0) {
        this.think = rand(0.5, 1.2);
        // veer so a crowd doesn't run in one straight line
        const a = Math.atan2(this.fx, -this.fz) + rand(-0.7, 0.7);
        this.fx = Math.sin(a); this.fz = -Math.cos(a);
      }
    } else {
      if (this.state === 'flee') { this.state = 'walk'; this._pick(); }
      if (this.think <= 0) {
        this.think = rand(2.5, 7);
        if (chance(0.25)) { this.state = 'wait'; this.waitT = rand(1.2, 3.4); }
        else { this.state = 'walk'; this._pick(); }
      }
      if (this.state === 'wait') {
        this.waitT -= dt;
        if (this.waitT <= 0) { this.state = 'walk'; this._pick(); }
        maxV = 0;
      }
      if (dist2(this.x, this.z, this.tx, this.tz) < 2.2) this._pick();
    }

    const dx = tx - this.x, dz = tz - this.z;
    const l = Math.hypot(dx, dz) || 1;
    const wx = dx / l * maxV, wz = dz / l * maxV;
    this.vx = damp(this.vx, wx, 9, dt);
    this.vz = damp(this.vz, wz, 9, dt);

    this.x += this.vx * dt;
    this.z += this.vz * dt;
    const res = Collide.circle(this.x, this.z, this.radius);
    if (res.hit) {
      this.x = res.x; this.z = res.z;
      const vn = this.vx * res.nx + this.vz * res.nz;
      if (vn < 0) {
        this.vx -= res.nx * vn; this.vz -= res.nz * vn;
        // slide along the wall rather than stalling against it
        if (this.panic <= 0 && chance(0.3 * dt * 60)) this._pick();
      }
    }

    this.speed = Math.hypot(this.vx, this.vz);
    if (this.speed > 0.2) this.yaw = Math.atan2(this.vx, -this.vz);
    this.walk += this.speed * dt * 2.3;
  }

  submit() {
    const b = this.bones;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    if (this.dead) {
      // fold flat on the ground
      const t = clamp(this.deadT * 4, 0, 1);
      M4.trsFull(b.subarray(0, 16), this.x, 0.12 * t, this.z, this.yaw, 0, -Math.PI / 2 * t, 1);
      for (let i = 1; i < 5; i++) b.copyWithin(i * 16, 0, 16);
      // re-anchor limbs so they don't detach when the body is flat
      Renderer.draw(this.mesh, b, [0.85, 0.8, 0.8], 0.035, 0);
      return;
    }
    M4.trsFull(b.subarray(0, 16), this.x, this.y, this.z, this.yaw, 0, 0, 1);
    const sw = Math.sin(this.walk) * clamp(this.speed / 4, 0, 1.3) * 0.6;
    const leg = (i, sign) => {
      const lx = sign * 0.115;
      M4.trsFull(b.subarray(i * 16, (i + 1) * 16),
        this.x + c * lx, this.y + 0.78, this.z + s * lx, this.yaw, sign > 0 ? sw : -sw, 0, 1);
    };
    leg(1, -1); leg(2, 1);
    const arm = (i, sign) => {
      const lx = sign * 0.295;
      const pitch = this.panic > 0 ? -2.4 + Math.sin(this.walk * 2 + i) * 0.3
        : (sign > 0 ? -sw * 0.75 : sw * 0.75);
      M4.trsFull(b.subarray(i * 16, (i + 1) * 16),
        this.x + c * lx, this.y + 1.28, this.z + s * lx, this.yaw, pitch, 0, 1);
    };
    arm(3, -1); arm(4, 1);
    Renderer.draw(this.mesh, b, WHITE, 0.05, 0);
  }
}
