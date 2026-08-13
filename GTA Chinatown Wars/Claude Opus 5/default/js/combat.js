'use strict';
/* ------------------------------------------------------------------
   combat.js — hitscan weapons, melee arcs, explosions and the little
   particle system that sells all of it.
------------------------------------------------------------------ */

const Combat = {
  tracers: [],
  parts: [],
  _bones: null,

  init() {
    this._bones = new Float32Array(8 * 16);
    for (let i = 0; i < 8; i++) M4.identity(this._bones.subarray(i * 16, i * 16 + 16));
  },

  /* ---- helpers ---- */
  /** distance along a segment to the closest approach of a circle, or -1 */
  _segCircle(px, pz, dx, dz, len, cx, cz, r) {
    const mx = cx - px, mz = cz - pz;
    const t = clamp(mx * dx + mz * dz, 0, len);
    const qx = px + dx * t, qz = pz + dz * t;
    const d2 = dist2(qx, qz, cx, cz);
    return d2 <= r * r ? t : -1;
  },

  targets(fromPlayer) {
    return fromPlayer ? Game.hostiles() : Game.playerTargets();
  },

  /**
   * One hitscan ray. Returns the thing it hit (or null).
   * y is only used for effects — the world is resolved in 2D.
   */
  shoot(owner, x, y, z, yaw, dmg, range, fromPlayer) {
    const dx = Math.sin(yaw), dz = -Math.cos(yaw);
    let best = range, hit = null;

    const wall = Collide.ray(x, z, x + dx * range, z + dz * range, 1.0);
    if (wall) best = wall.t * range;

    const list = this.targets(fromPlayer);
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e === owner || e.dead) continue;
      const r = e.hitRadius || 0.52;
      const t = this._segCircle(x, z, dx, dz, best, e.x, e.z, r);
      if (t >= 0 && t < best) { best = t; hit = e; }
    }
    // vehicles soak bullets too
    const vs = Game.vehicles;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.dead || v === owner || (owner && owner.inCar === v)) continue;
      const pts = v.circles([0, 0, 0, 0]);
      for (let k = 0; k < 2; k++) {
        const t = this._segCircle(x, z, dx, dz, best, pts[k * 2], pts[k * 2 + 1], v.radius);
        if (t >= 0 && t < best) { best = t; hit = v; }
      }
    }

    const hx = x + dx * best, hz = z + dz * best;
    this.tracer(x + dx * 1.0, y, z + dz * 1.0, yaw, Math.max(0.5, best - 1.0));

    if (hit instanceof Vehicle) {
      hit.hurt(dmg * 0.55, fromPlayer);
      this.burst(hx, y, hz, 5, [1, 0.85, 0.45], 3.2);
      Sound.play('ricochet', 0.35 * Game.audible(hx, hz));
    } else if (hit) {
      hit.hurt(dmg, owner, fromPlayer);
      this.burst(hx, 1.1, hz, 7, [0.6, 0.06, 0.08], 2.6, Models.blood);
      Sound.play('hit', 0.5 * Game.audible(hx, hz));
    } else {
      this.burst(hx, y, hz, 3, [0.8, 0.8, 0.85], 2.2);
    }
    return hit;
  },

  melee(owner, w) {
    const list = this.targets(owner === Player);
    const fx = Math.sin(owner.aimYaw !== undefined ? owner.aimYaw : owner.yaw);
    const fz = -Math.cos(owner.aimYaw !== undefined ? owner.aimYaw : owner.yaw);
    let any = false;
    for (const e of list) {
      if (e === owner || e.dead) continue;
      const dx = e.x - owner.x, dz = e.z - owner.z;
      const d = Math.hypot(dx, dz);
      if (d > w.range + 0.4) continue;
      if ((dx * fx + dz * fz) / (d || 1) < Math.cos(w.arc)) continue;
      e.hurt(w.dmg, owner, owner === Player);
      e.knock && e.knock(fx * 6, fz * 6);
      this.burst(e.x, 1.1, e.z, 5, [0.6, 0.06, 0.08], 2.2, Models.blood);
      any = true;
    }
    if (any) Sound.play('hit', 0.7);
  },

  muzzle(x, y, z) {
    this.parts.push({ x, y, z, vx: 0, vy: 0, vz: 0, life: 0.06, max: 0.06, s: 0.9, mesh: Models.flash, tint: [1, 0.9, 0.6], grav: 0 });
  },

  tracer(x, y, z, yaw, len) {
    this.tracers.push({ x, y, z, yaw, len, life: 0.06 });
  },

  burst(x, y, z, n, tint, spd, mesh) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), p = rand(0.2, 1);
      this.parts.push({
        x, y, z,
        vx: Math.cos(a) * spd * p, vy: rand(1.2, 4.2), vz: Math.sin(a) * spd * p,
        life: rand(0.25, 0.6), max: 0.6, s: rand(0.5, 1.1),
        mesh: mesh || Models.spark, tint: tint, grav: 14
      });
    }
  },

  smoke(x, y, z, n, spd) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      this.parts.push({
        x, y, z, vx: Math.cos(a) * spd, vy: rand(1.5, 3.4), vz: Math.sin(a) * spd,
        life: rand(0.7, 1.5), max: 1.5, s: rand(0.7, 1.6),
        mesh: Models.smoke, tint: [0.35, 0.35, 0.38], grav: -1.6, fade: true
      });
    }
  },

  explode(x, z, radius, dmg, fromPlayer) {
    Sound.play('explode', 1);
    Camera.addShake(clamp(1.4 - dist2(x, z, Camera.tx, Camera.tz) / 12000, 0.2, 1.4));
    this.burst(x, 1.0, z, 26, [1, 0.65, 0.2], 14);
    this.smoke(x, 1.2, z, 16, 5);
    for (const e of Game.allActors()) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - x, e.z - z);
      if (d > radius) continue;
      const k = 1 - d / radius;
      e.hurt(dmg * k, null, fromPlayer);
      if (e.knock) e.knock((e.x - x) / (d || 1) * 12 * k, (e.z - z) / (d || 1) * 12 * k);
    }
    for (const v of Game.vehicles) {
      if (v.dead) continue;
      const d = Math.hypot(v.x - x, v.z - z);
      if (d > radius * 1.2) continue;
      const k = 1 - d / (radius * 1.2);
      v.hurt(dmg * k * 0.9, fromPlayer);
      v.vx += (v.x - x) / (d || 1) * 16 * k;
      v.vz += (v.z - z) / (d || 1) * 16 * k;
    }
    Game.scarePeds(x, z, radius * 3, 6);
  },

  update(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      this.tracers[i].life -= dt;
      if (this.tracers[i].life <= 0) this.tracers.splice(i, 1);
    }
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      p.vy -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.06) { p.y = 0.06; p.vy *= -0.32; p.vx *= 0.6; p.vz *= 0.6; }
      p.vx *= 1 - 1.6 * dt; p.vz *= 1 - 1.6 * dt;
    }
    if (this.parts.length > 380) this.parts.splice(0, this.parts.length - 380);
  },

  submit() {
    for (const t of this.tracers) {
      const b = Renderer.boneSlot();
      M4.trsFull(b, t.x, t.y, t.z, t.yaw, 0, 0, 1);
      Renderer.drawBlend(Models.tracer, b, [1, 0.9, 0.55], t.life / 0.06 * 0.85, 1,
        dist2(t.x, t.z, Camera.ex, Camera.ez));
    }
    for (const p of this.parts) {
      const b = Renderer.boneSlot();
      const k = p.life / p.max;
      M4.trsFull(b, p.x, p.y, p.z, 0, 0, 0, p.s * (p.fade ? (1.4 - k * 0.5) : clamp(k * 1.6, 0.25, 1)));
      Renderer.drawBlend(p.mesh, b, p.tint, p.fade ? k * 0.5 : clamp(k * 2, 0, 1), 0.8,
        dist2(p.x, p.z, Camera.ex, Camera.ez));
    }
  }
};
