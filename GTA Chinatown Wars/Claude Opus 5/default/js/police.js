'use strict';
/* ------------------------------------------------------------------
   police.js — heat, stars, and the PVPD.

   Heat only accrues when somebody sees you do it. Stars come off the
   heat curve. Units spawn on the road graph well outside the camera,
   drive at you, bail out when you're on foot, and — once they lose
   sight — converge on the last place they saw you and sweep it.
   Stay out of their eyeline long enough and the whole thing drops.
------------------------------------------------------------------ */

const STAR_HEAT = [0, 1, 6, 14, 26, 42];

class Cop {
  constructor(x, z, unit) {
    this.x = x; this.z = z; this.y = 0;
    this.yaw = 0; this.vx = 0; this.vz = 0;
    this.hp = 62; this.dead = false; this.deadT = 0;
    this.hitRadius = 0.54; this.radius = 0.38;
    this.unit = unit;
    this.walk = 0; this.speed = 0;
    this.cool = rand(0.3, 1.2);
    this.state = 'chase';
    this.tx = x; this.tz = z;
    this.think = 0;
    this.isCop = true;
    this.aimYaw = 0;
    this.bones = new Float32Array(8 * 16);
    this.gunBones = new Float32Array(8 * 16);
    for (let i = 0; i < 8; i++) {
      M4.identity(this.bones.subarray(i * 16, i * 16 + 16));
      M4.identity(this.gunBones.subarray(i * 16, i * 16 + 16));
    }
  }

  knock(vx, vz) { this.vx += vx; this.vz += vz; }

  hurt(n, by, byPlayer) {
    if (this.dead) return;
    this.hp -= n;
    Sound.play('grunt', 0.4 * Game.audible(this.x, this.z));
    if (this.hp <= 0) {
      this.hp = 0; this.dead = true; this.deadT = 0;
      if (byPlayer) {
        Police.addHeat(6, true);
        Game.toast('COP DOWN', '#ff6b5a');
        Game.dropPickup(this.x, this.z, 'ammo');
      }
      Game.scarePeds(this.x, this.z, 20, 7);
    } else if (byPlayer) Police.addHeat(1.5, true);
  }

  update(dt) {
    if (this.dead) {
      this.deadT += dt;
      this.vx *= 1 - 6 * dt; this.vz *= 1 - 6 * dt;
      this.x += this.vx * dt; this.z += this.vz * dt;
      return;
    }
    this.cool = Math.max(0, this.cool - dt);
    const P = Player;
    const dx = P.x - this.x, dz = P.z - this.z;
    const d = Math.hypot(dx, dz);
    const los = d < 42 && Collide.clear(this.x, this.z, P.x, P.z);
    if (los && !P.dead) { Police.sight(this.x, this.z); this.state = 'chase'; }
    else if (this.state === 'chase') { this.state = 'search'; this.tx = Police.lastX; this.tz = Police.lastZ; this.think = 0; }

    let tx, tz, maxV;
    if (this.state === 'chase') {
      tx = P.x; tz = P.z;
      maxV = P.inCar ? 7.4 : 6.9;
      this.aimYaw = Math.atan2(dx, -dz);
      // open fire from two stars up
      if (Police.wanted >= 2 && this.cool <= 0 && d < 26 && d > 2.2 && los) {
        this.cool = rand(0.55, 1.15) - Police.wanted * 0.05;
        Sound.play('pistol', 0.55 * Game.audible(this.x, this.z));
        Combat.muzzle(this.x + Math.sin(this.aimYaw) * 0.7, 1.15, this.z - Math.cos(this.aimYaw) * 0.7);
        Combat.shoot(this, this.x, 1.15, this.z,
          this.aimYaw + rand(-0.10, 0.10), 8 + Police.wanted * 1.5, 30, false);
      } else if (d < 1.9 && this.cool <= 0) {
        this.cool = 0.7;
        Sound.play('melee', 0.5);
        P.hurt(7, this.x, this.z);
      }
    } else {
      // sweep around the last known position
      maxV = 4.6;
      this.think -= dt;
      if (this.think <= 0 || dist2(this.x, this.z, this.tx, this.tz) < 6) {
        this.think = rand(1.6, 3.2);
        const a = rand(0, TAU), r = rand(4, Police.searchRadius);
        this.tx = Police.lastX + Math.cos(a) * r;
        this.tz = Police.lastZ + Math.sin(a) * r;
      }
      tx = this.tx; tz = this.tz;
      this.aimYaw = Math.atan2(tx - this.x, -(tz - this.z));
    }

    const l = Math.hypot(tx - this.x, tz - this.z) || 1;
    const stop = this.state === 'chase' && d < 7 && Police.wanted >= 2 ? 0.25 : 1;
    this.vx = damp(this.vx, (tx - this.x) / l * maxV * stop, 10, dt);
    this.vz = damp(this.vz, (tz - this.z) / l * maxV * stop, 10, dt);
    this.x += this.vx * dt; this.z += this.vz * dt;
    const res = Collide.circle(this.x, this.z, this.radius);
    if (res.hit) {
      this.x = res.x; this.z = res.z;
      const vn = this.vx * res.nx + this.vz * res.nz;
      if (vn < 0) { this.vx -= res.nx * vn; this.vz -= res.nz * vn; }
    }
    this.speed = Math.hypot(this.vx, this.vz);
    this.yaw = this.state === 'chase' ? this.aimYaw : (this.speed > 0.3 ? Math.atan2(this.vx, -this.vz) : this.yaw);
    this.walk += this.speed * dt * 2.3;

    // arrest
    if (!P.dead && !P.inCar && d < 1.7 && P.speed < 2.6) {
      Police.bustT += dt;
      if (Police.bustT > 1.0) Game.onBusted();
    }
  }

  submit() {
    const b = this.bones;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    if (this.dead) {
      const t = clamp(this.deadT * 4, 0, 1);
      M4.trsFull(b.subarray(0, 16), this.x, 0.12 * t, this.z, this.yaw, 0, -Math.PI / 2 * t, 1);
      for (let i = 1; i < 5; i++) b.copyWithin(i * 16, 0, 16);
      Renderer.draw(Models.cop, b, [0.8, 0.8, 0.85], 0.035, 0);
      return;
    }
    M4.trsFull(b.subarray(0, 16), this.x, this.y, this.z, this.yaw, 0, 0, 1);
    const sw = Math.sin(this.walk) * clamp(this.speed / 4, 0, 1.3) * 0.6;
    const leg = (i, sign) => {
      const lx = sign * 0.115;
      M4.trsFull(b.subarray(i * 16, (i + 1) * 16),
        this.x + c * lx, 0.78, this.z + s * lx, this.yaw, sign > 0 ? sw : -sw, 0, 1);
    };
    leg(1, -1); leg(2, 1);
    const arm = (i, sign) => {
      const lx = sign * 0.295;
      const pitch = sign > 0 ? -1.45 : (this.state === 'chase' ? -0.9 : sw * 0.75);
      M4.trsFull(b.subarray(i * 16, (i + 1) * 16),
        this.x + c * lx, 1.28, this.z + s * lx, this.yaw, pitch, 0, 1);
    };
    arm(3, -1); arm(4, 1);
    Renderer.draw(Models.cop, b, WHITE, 0.055, 0);
    this.gunBones.set(b.subarray(4 * 16, 5 * 16), 0);
    Renderer.draw(Models.gun, this.gunBones, WHITE, 0.03, 0);
  }
}

const Police = {
  wanted: 0, heat: 0,
  seenT: 0, evadeT: 0, bustT: 0,
  lastX: 0, lastZ: 0,
  searchRadius: 26,
  units: [],
  cops: [],
  spawnT: 0,
  sirenLvl: 0,
  justLost: 0,

  reset() {
    for (const u of this.units) if (u.car) Game.removeVehicle(u.car);
    this.units.length = 0;
    this.cops.length = 0;
    this.wanted = 0; this.heat = 0; this.evadeT = 0; this.seenT = 0; this.bustT = 0;
    Sound.stopSiren();
  },

  clearWanted(msg) {
    if (this.wanted > 0 && msg) Game.toast(msg, '#7ef0a0');
    this.heat = 0; this.wanted = 0; this.evadeT = 0;
    for (const u of this.units) u.disband = true;
  },

  addHeat(n, force) {
    if (!force && Game.godMode) return;
    const before = this.wanted;
    this.heat = Math.min(60, this.heat + n);
    this.evadeT = 0;
    this._restar();
    if (this.wanted > before) {
      Sound.play('star', 1);
      Game.toast(this.wanted === 1 ? 'HEAT: THEY MADE YOU' : 'WANTED ' + this.wanted, '#ffd83d');
    }
  },

  _restar() {
    let w = 0;
    for (let i = 1; i < STAR_HEAT.length; i++) if (this.heat >= STAR_HEAT[i]) w = i;
    this.wanted = w;
  },

  /** called by any unit that can currently see the player */
  sight(x, z) {
    this.seenT = 0.35;
    this.lastX = Player.x; this.lastZ = Player.z;
    this.evadeT = 0;
  },

  get evadeNeeded() { return 7 + this.wanted * 2.5; },

  update(dt) {
    this.seenT = Math.max(0, this.seenT - dt);
    this.bustT = Math.max(0, this.bustT - dt * 0.8);
    this.justLost = Math.max(0, this.justLost - dt);

    if (this.wanted > 0) {
      if (this.seenT <= 0) {
        this.evadeT += dt;
        this.searchRadius = Math.min(60, 18 + this.evadeT * 3.4);
        if (this.evadeT > this.evadeNeeded) {
          this.clearWanted('LOST THEM');
          this.justLost = 3;
        }
      } else {
        this.searchRadius = 22;
        this.heat = Math.max(this.heat, STAR_HEAT[this.wanted]);
      }
      // heat cools slowly even under observation so stars don't stick forever
      this.heat = Math.max(0, this.heat - dt * 0.10);
      this._restar();
    }

    this._manageUnits(dt);
    this._audio(dt);

    for (let i = this.cops.length - 1; i >= 0; i--) {
      const c = this.cops[i];
      c.update(dt);
      if (c.dead && c.deadT > 14) this.cops.splice(i, 1);
      else if (dist2(c.x, c.z, Player.x, Player.z) > 340 * 340) this.cops.splice(i, 1);
    }
  },

  _wantedUnits() {
    return [0, 1, 2, 3, 4, 6][this.wanted] || 0;
  },

  _manageUnits(dt) {
    const searching = this.seenT <= 0 && this.evadeT > 1.5;
    // retire units that are wrecked, orphaned or out of the fight
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      const carGone = !u.car || u.car.dead;
      if (u.disband || carGone) {
        if (u.car && !u.car.dead && (u.disband || this.wanted === 0)) Game.removeVehicle(u.car);
        this.units.splice(i, 1);
        continue;
      }
      if (dist2(u.car.x, u.car.z, Player.x, Player.z) > 320 * 320) {
        Game.removeVehicle(u.car);
        this.units.splice(i, 1);
        continue;
      }
      // A patrol car with eyes on you counts as being seen, same as a cop on
      // foot — but a unit that has lost you is sweeping, not tracking, so its
      // eyeline shrinks. Otherwise a converging cordon can never be broken.
      if (!u.car.wrecked && !Player.dead) {
        const d2 = dist2(u.car.x, u.car.z, Player.x, Player.z);
        const range = searching ? 30 : 62;
        if (d2 < range * range && Collide.clear(u.car.x, u.car.z, Player.x, Player.z)) this.sight();
      }
      if (u.car.wrecked && !u.bailed) this._bail(u);
      // bail out on foot when the target is walking
      if (!u.bailed && !Player.inCar && !Player.dead &&
        dist2(u.car.x, u.car.z, Player.x, Player.z) < 26 * 26 &&
        Math.abs(u.car.speed) < 9) this._bail(u);
      if (!u.bailed && u.car.driverAI) {
        u.car.driverAI.chase = (this.seenT > 0 || this.evadeT < 3) ? Player : null;
        if (!u.car.driverAI.chase) {
          u.car.driverAI.chase = { x: this.lastX, z: this.lastZ, dead: false };
        }
      }
    }

    // no fresh dispatches while they've lost you — the ones already out
    // sweep the area instead, which is what makes escaping possible
    if (this.wanted === 0 || searching) return;
    this.spawnT -= dt;
    if (this.units.length >= this._wantedUnits() || this.spawnT > 0) return;
    this.spawnT = 2.6 - this.wanted * 0.28;
    this._spawnUnit();
  },

  _bail(u) {
    u.bailed = true;
    const car = u.car;
    const n = this.wanted >= 3 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const p = car.exitPoint([0, 0]);
      const c = new Cop(p[0] + rand(-0.8, 0.8), p[1] + rand(-0.8, 0.8), u);
      this.cops.push(c);
    }
    if (car.driverAI) { car.driverAI.chase = null; car.driverAI.cruise = 0; }
    car.ctrl.throttle = 0; car.ctrl.brake = 1;
    car.abandoned = true;
    Sound.play('door', 0.6 * Game.audible(car.x, car.z));
  },

  _spawnUnit() {
    for (let attempt = 0; attempt < 18; attempt++) {
      const n = randInt(0, City.nodes.length - 1);
      const a = City.nodes[n];
      const d = Math.hypot(a.x - Player.x, a.z - Player.z);
      if (d < 70 || d > 190) continue;
      const toIdx = pick(a.links);
      const car = new Vehicle('police', 0, 0, 0, [0.92, 0.92, 0.95]);
      const drv = new Driver(car, { cruise: 0.86 + this.wanted * 0.03, chase: Player, aggro: 1 });
      drv.placeOnRoad(n, toIdx, rand(0.2, 0.8));
      if (Game.spaceOccupied(car.x, car.z, car.spec.len * 0.8, car)) continue;
      if (Game.onScreen(car.x, car.z, 20)) continue;
      car.driverAI = drv;
      car.isPolice = true;
      Game.vehicles.push(car);
      this.units.push({ car, bailed: false, disband: false });
      return;
    }
  },

  _audio(dt) {
    let closest = 1e9;
    for (const u of this.units) if (u.car && !u.car.wrecked) closest = Math.min(closest, Math.hypot(u.car.x - Player.x, u.car.z - Player.z));
    const want = this.wanted > 0 && closest < 130 ? clamp(1 - closest / 130, 0, 1) : 0;
    this.sirenLvl = damp(this.sirenLvl, want, 3, dt);
    if (this.sirenLvl > 0.02) { Sound.startSiren(); Sound.sirenLevel(this.sirenLvl); }
    else Sound.stopSiren();
  },

  submit() {
    for (const c of this.cops) c.submit();
  }
};
