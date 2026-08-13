'use strict';
/* ------------------------------------------------------------------
   game.js — the world: entity lists, population streaming, the update
   order, and every cross-system hook (crime reporting, deaths,
   explosions, pickups, respawns).
------------------------------------------------------------------ */

const Game = {
  vehicles: [], peds: [], pickups: [],
  paused: false, godMode: false,
  time: 0,
  respawnT: 0,
  _hostiles: [], _targets: [], _actors: [],
  parkedWant: 26, pedWant: 46,
  parkT: 0, pedT: 0,
  crimeGate: Object.create(null),
  spawnPoint: { x: 0, z: 0 },

  init() {
    Models.build();
    const stats = City.build(20260813);
    Combat.init();

    // start on the pavement outside Sable Autobody
    const lots = City.landmarks.lots || [];
    const home = lots[0] || { x: City.RX[1].c, z: City.RZ[1].c };
    // start on the kerb just outside Sable Autobody's yard
    this.spawnPoint = { x: home.x - 4, z: (home.z1 !== undefined ? home.z1 : home.z) + SW + 4 };
    Player.init(this.spawnPoint.x, this.spawnPoint.z);
    Camera.reset(Player.x, Player.z, 0);

    // fill the yards first so they don't read as empty tarmac
    for (const s of City.parkSpots) {
      if (!s.lot || chance(0.45)) continue;
      if (this.spaceOccupied(s.x, s.z, 3.0)) continue;
      const v = new Vehicle(pick(['sedan', 'hatch', 'pickup', 'van', 'taxi']), s.x, s.z, s.yaw);
      v.parked = true;
      this.vehicles.push(v);
    }
    for (let i = 0; i < 26; i++) this._spawnParked(true);
    for (let i = 0; i < this.pedWant; i++) this._spawnPed(true);
    for (let i = 0; i < 10; i++) this._seedTraffic();

    // a few permanent health/ammo caches so the district is survivable
    const plaza = City.landmarks.plaza;
    if (plaza) {
      this.dropPickup(plaza.x + 14, plaza.z, 'health', true);
      this.dropPickup(plaza.x - 14, plaza.z, 'ammo', true);
    }
    for (const b of City.blocks) {
      if (b.alley && chance(0.5)) {
        this.dropPickup((b.alley.x0 + b.alley.x1) / 2, (b.alley.z0 + b.alley.z1) / 2,
          chance(0.5) ? 'health' : 'ammo', true);
      }
    }
    Missions.init();
    return stats;
  },

  /* ------------------------- queries ------------------------- */
  hostiles() { return this._hostiles; },
  playerTargets() { return this._targets; },
  allActors() { return this._actors; },

  audible(x, z) {
    const d = Math.hypot(x - Camera.tx, z - Camera.tz);
    return clamp(1 - d / 95, 0, 1);
  },

  onScreen(x, z, margin) {
    const p = Camera.project(x, 1, z, 1, 1, [0, 0, 0]);
    if (p[2] <= 0) return false;
    const m = (margin || 0) / 100;
    return p[0] > -m && p[0] < 1 + m && p[1] > -m && p[1] < 1 + m;
  },

  spaceOccupied(x, z, r, ignore) {
    if (Collide.circle(x, z, r * 0.75).hit) return true;
    for (const v of this.vehicles) {
      if (v === ignore) continue;
      if (dist2(v.x, v.z, x, z) < (r + v.spec.len * 0.5) * (r + v.spec.len * 0.5)) return true;
    }
    return false;
  },

  nearestVehicle(x, z, maxD) {
    let best = null, bd = maxD * maxD;
    for (const v of this.vehicles) {
      if (v.dead) continue;
      const d = dist2(v.x, v.z, x, z);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  },

  /** keep people from standing inside cars */
  pushOutOfVehicles(e) {
    for (const v of this.vehicles) {
      if (v === e.inCar || v.dead) continue;
      const pts = v.circles([0, 0, 0, 0]);
      for (let k = 0; k < 2; k++) {
        const dx = e.x - pts[k * 2], dz = e.z - pts[k * 2 + 1];
        const rr = v.radius + (e.radius || 0.4);
        const d2 = dx * dx + dz * dz;
        if (d2 > rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        e.x += dx / d * (rr - d); e.z += dz / d * (rr - d);
      }
    }
  },

  /* ------------------------- population ------------------------- */
  _spawnParked(anywhere) {
    const spots = City.parkSpots;
    for (let k = 0; k < 24; k++) {
      const s = spots[(Math.random() * spots.length) | 0];
      const d = Math.hypot(s.x - Player.x, s.z - Player.z);
      if (!anywhere && (d < 26 || d > 150)) continue;
      if (anywhere && d > 260) continue;
      if (this.spaceOccupied(s.x, s.z, 3.2)) continue;
      if (!anywhere && this.onScreen(s.x, s.z, 10)) continue;
      const type = pick(['sedan', 'hatch', 'hatch', 'pickup', 'van', 'taxi', 'sport', 'sedan']);
      const v = new Vehicle(type, s.x, s.z, s.yaw + (s.lot ? 0 : 0));
      v.parked = true;
      this.vehicles.push(v);
      return v;
    }
    return null;
  },

  _seedTraffic() {
    const n = randInt(0, City.nodes.length - 1);
    const a = City.nodes[n];
    const v = new Vehicle(pick(['sedan', 'hatch', 'taxi', 'van', 'pickup']), 0, 0, 0);
    const drv = new Driver(v, { cruise: rand(0.5, 0.78) });
    drv.placeOnRoad(n, pick(a.links), rand(0.15, 0.85));
    if (this.spaceOccupied(v.x, v.z, v.spec.len * 0.7, v)) return;
    v.driverAI = drv;
    this.vehicles.push(v);
  },

  _spawnPed(anywhere) {
    const spots = City.pedSpots;
    for (let k = 0; k < 20; k++) {
      const s = spots[(Math.random() * spots.length) | 0];
      const d = Math.hypot(s.x - Player.x, s.z - Player.z);
      if (!anywhere && (d < 30 || d > 105)) continue;
      if (anywhere && d > 200) continue;
      if (!anywhere && this.onScreen(s.x, s.z, 6)) continue;
      if (Collide.circle(s.x, s.z, 0.5).hit) continue;
      const p = new Ped(s.x, s.z);
      this.peds.push(p);
      return p;
    }
    return null;
  },

  _stream(dt) {
    // ----- pedestrians -----
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      const d2 = dist2(p.x, p.z, Player.x, Player.z);
      if (p.dead && p.deadT > 16) { this.peds.splice(i, 1); continue; }
      if (d2 > 190 * 190) this.peds.splice(i, 1);
    }
    this.pedT -= dt;
    if (this.pedT <= 0) {
      this.pedT = 0.16;
      let live = 0;
      for (const p of this.peds) if (!p.dead) live++;
      if (live < this.pedWant) this._spawnPed(false);
    }

    // ----- parked cars -----
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      if (v === Player.inCar || v.missionCar || v.driverAI || v.isPolice) continue;
      if (dist2(v.x, v.z, Player.x, Player.z) > 240 * 240) this.removeVehicle(v);
    }
    this.parkT -= dt;
    if (this.parkT <= 0) {
      this.parkT = 0.4;
      let parked = 0;
      for (const v of this.vehicles) if (!v.driverAI && !v.isPolice) parked++;
      if (parked < this.parkedWant) this._spawnParked(false);
    }
  },

  /* ------------------------- events ------------------------- */
  toast(text, color) { Hud.toast(text, color); },

  /** Was there anyone around to see it? */
  witnessed(x, z, r) {
    for (const c of Police.cops) if (!c.dead && dist2(c.x, c.z, x, z) < r * r) return true;
    for (const u of Police.units) if (u.car && !u.car.wrecked && dist2(u.car.x, u.car.z, x, z) < (r * 1.6) * (r * 1.6)) return true;
    for (const p of this.peds) {
      if (p.dead) continue;
      if (dist2(p.x, p.z, x, z) < r * r && Collide.clear(p.x, p.z, x, z)) return true;
    }
    return false;
  },

  noteCrime(kind, x, z, heat) {
    const HEAT = { gunfire: 0.9, assault: 1.1, kill: 3.2, jack: 2.0, jackParked: 0.5, roadkill: 2.6, melee: 0 };
    const h = heat || HEAT[kind] || 0;
    if (h <= 0) return;
    const t = this.time;
    if (this.crimeGate[kind] && t - this.crimeGate[kind] < 0.45) return;
    this.crimeGate[kind] = t;
    if (Police.wanted > 0 || this.witnessed(x, z, 34)) Police.addHeat(h);
    this.scarePeds(x, z, kind === 'gunfire' ? 26 : 18, kind === 'gunfire' ? 5 : 7);
  },

  scarePeds(x, z, r, secs) {
    for (const p of this.peds) {
      if (p.dead) continue;
      if (dist2(p.x, p.z, x, z) < r * r) p.scare(x, z, secs);
    }
  },

  onPedKilled(p, byPlayer) {
    this.dropPickup(p.x, p.z, 'cash', false, p.cash);
    if (byPlayer) this.noteCrime('kill', p.x, p.z, 3.2);
  },

  onVehicleWrecked(v) {
    if (v.isPolice) Police.addHeat(3, true);
  },

  explodeVehicle(v) {
    if (v.dead) return;
    v.dead = true;
    Combat.explode(v.x, v.z, 9.5, 78, v === Player.inCar ? false : true);
    if (Player.inCar === v) { Player.inCar = null; Player.hurt(60, v.x, v.z); Sound.stopEngine(); }
    if (Missions.targetVehicle === v && Missions.active && Missions.active.id === 'getaway') {
      // handled by the mission tick
    }
    this.removeVehicle(v);
  },

  impact(x, z, force, byPlayer) {
    Sound.play('crash', clamp(force / 16, 0.2, 1) * (byPlayer ? 1 : this.audible(x, z)));
    Combat.burst(x, 0.9, z, Math.min(12, (force | 0)), [1, 0.9, 0.5], 4);
    if (byPlayer) Camera.addShake(clamp(force / 22, 0.08, 0.7));
    this.scarePeds(x, z, 16, 4);
  },

  ejectDriver(v) {
    const ai = v.driverAI;
    v.driverAI = null;
    const p = v.exitPoint([0, 0]);
    const ped = new Ped(p[0], p[1]);
    ped.scare(v.x, v.z, 12);
    this.peds.push(ped);
    Sound.play('scream', 0.7);
    this.toast('CARJACKED', '#ff8a3d');
  },

  onPlayerEnter(v, stolen) {
    v.owner = null;
    if (stolen) this.noteCrime('jack', v.x, v.z, 2.0);
    else if (v.parked || !v.driverAI) this.noteCrime('jackParked', v.x, v.z, 0.5);
    v.driverAI = null;
  },

  onPlayerExit(v) {
    if (v.isPolice) return;
  },

  onPlayerDown() {
    this.respawnT = 2.6;
  },

  onBusted() {
    if (Player.dead) return;
    Police.bustT = 0;
    Player.money = Math.max(0, Player.money - 350);
    this.toast('BUSTED  -$350', '#ff6b5a');
    Sound.play('busted', 1);
    Police.clearWanted(null);
    Police.cops.length = 0;
    for (const u of Police.units) u.disband = true;
    const p = City.landmarks.lots && City.landmarks.lots[1];
    Player.respawn(p ? p.x : this.spawnPoint.x, p ? p.z : this.spawnPoint.z);
    Player.health = Player.maxHealth * 0.6;
    if (Missions.active) Missions.fail('busted');
  },

  respawnPlayer() {
    const plaza = City.landmarks.plaza || this.spawnPoint;
    Player.money = Math.max(0, Player.money - 200);
    Police.clearWanted(null);
    Police.cops.length = 0;
    for (const u of Police.units) u.disband = true;
    Player.respawn(plaza.x + 10, plaza.z + 10);
    this.toast('PATCHED UP  -$200', '#8fc9d8');
  },

  dropPickup(x, z, kind, permanent, amount) {
    this.pickups.push({
      x, z, kind, amount: amount || 0, t: 0,
      permanent: !!permanent, respawn: 0, taken: false
    });
  },

  removeVehicle(v) {
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
    if (Player.inCar === v) { Player.inCar = null; Sound.stopEngine(); }
    v.dead = true;
  },

  spawnMissionVehicle(type, x, z, yaw, color) {
    const v = new Vehicle(type, x, z, yaw, color);
    v.missionCar = true;
    v.parked = true;
    this.vehicles.push(v);
    return v;
  },

  /* ------------------------- frame ------------------------- */
  update(dt) {
    this.time += dt;
    City.update(dt);

    if (Player.dead) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.respawnPlayer();
    }

    // rebuild the shared target lists once per frame
    this._hostiles.length = 0;
    this._actors.length = 0;
    for (const p of this.peds) if (!p.dead) { this._hostiles.push(p); this._actors.push(p); }
    for (const c of Police.cops) if (!c.dead) { this._hostiles.push(c); this._actors.push(c); }
    this._targets.length = 0;
    if (!Player.dead && !Player.inCar) this._targets.push(Player);
    this._actors.push(Player);

    Player.update(dt);

    // drivers first so their control inputs apply this frame
    for (const v of this.vehicles) {
      if (v.driverAI && v !== Player.inCar) v.driverAI.update(dt);
      else if (!v.driver && !v.driverAI) { v.ctrl.throttle = 0; v.ctrl.brake = 1; v.ctrl.steer = 0; }
    }
    for (const v of this.vehicles) v.update(dt);
    this._vehicleVsVehicle();
    this._vehicleVsPeds(dt);

    for (const p of this.peds) p.update(dt);
    Police.update(dt);
    Combat.update(dt);
    Missions.update(dt);
    this._pickups(dt);
    this._stream(dt);
    Traffic.update(dt);

    if (Player.inCar) {
      const v = Player.inCar;
      Sound.engineParams(clamp(Math.abs(v.speed) / v.spec.topSpeed, 0.05, 1),
        clamp(v.ctrl.throttle, 0, 1));
    }
  },

  _vehicleVsVehicle() {
    const vs = this.vehicles;
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      if (a.dead) continue;
      for (let j = i + 1; j < vs.length; j++) {
        const b = vs[j];
        if (b.dead) continue;
        const d2 = dist2(a.x, a.z, b.x, b.z);
        const rr = (a.spec.len + b.spec.len) * 0.55;
        if (d2 > rr * rr) continue;
        Vehicle.collide(a, b);
      }
    }
  },

  _vehicleVsPeds(dt) {
    for (const v of this.vehicles) {
      if (v.dead) continue;
      const sp = Math.abs(v.speed);
      if (sp < 1.2) continue;
      const pts = v.circles([0, 0, 0, 0]);
      const byPlayer = v === Player.inCar;
      for (const list of [this.peds, Police.cops]) {
        for (const p of list) {
          if (p.dead) continue;
          for (let k = 0; k < 2; k++) {
            const rr = v.radius + p.radius;
            if (dist2(p.x, p.z, pts[k * 2], pts[k * 2 + 1]) > rr * rr) continue;
            const nx = p.x - v.x, nz = p.z - v.z;
            const l = Math.hypot(nx, nz) || 1;
            p.knock(nx / l * sp * 0.85 + v.vx * 0.4, nz / l * sp * 0.85 + v.vz * 0.4);
            // Only the player runs people down. Traffic clips them, they swear
            // and scatter — otherwise the district turns into a morgue in a
            // minute of hands-off driving.
            if (byPlayer) {
              p.hurt(sp * 3.4, null, true);
              this.noteCrime('roadkill', p.x, p.z, 2.6);
            } else {
              p.hurt(Math.max(0, sp - 6) * 0.9, null, false);
              p.scare(v.x, v.z, 5);
            }
            Sound.play('hit', 0.7 * this.audible(p.x, p.z));
            v.vx *= 0.985; v.vz *= 0.985;
            break;
          }
        }
      }
    }
  },

  _pickups(dt) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.t += dt;
      if (p.taken) {
        p.respawn -= dt;
        if (p.respawn <= 0) p.taken = false;
        continue;
      }
      // dropped loot doesn't litter the district forever
      if (!p.permanent && (p.t > 50 || dist2(p.x, p.z, Player.x, Player.z) > 220 * 220)) {
        this.pickups.splice(i, 1);
        continue;
      }
      if (Player.dead) continue;
      if (dist2(p.x, p.z, Player.x, Player.z) > 2.6 * 2.6) continue;
      if (p.kind === 'cash') { Player.money += p.amount; Sound.play('cash', 0.9); this.toast('+$' + p.amount, '#7ef0a0'); }
      else if (p.kind === 'health') {
        if (Player.health >= Player.maxHealth) continue;
        Player.health = Player.maxHealth; Sound.play('pickup', 0.9); this.toast('PATCHED UP', '#7ef0a0');
      } else if (p.kind === 'ammo') {
        Player.give(chance(0.35) ? 'smg' : 'pistol', chance(0.35) ? 60 : 34);
        Sound.play('reload', 0.9); this.toast('AMMO', '#ffd83d');
      }
      if (p.permanent) { p.taken = true; p.respawn = 26; }
      else this.pickups.splice(i, 1);
    }
  },

  /* ------------------------- render ------------------------- */
  submit() {
    const cx = Camera.tx, cz = Camera.tz;
    const R2 = 215 * 215;
    for (const v of this.vehicles) {
      if (dist2(v.x, v.z, cx, cz) > R2) continue;
      v.submit();
      if (v.wrecked && !v.dead) {
        if (chance(0.5)) Combat.smoke(v.x + rand(-0.6, 0.6), 1.0, v.z + rand(-0.6, 0.6), 1, 1.2);
      }
      if (v.marked) {
        const b = Renderer.boneSlot();
        M4.trsFull(b, v.x, 0.06, v.z, 0, 0, 0, v.spec.len * 0.55);
        Renderer.drawBlend(Models.ring, b, [1, 0.35, 0.2], 0.8, 1, dist2(v.x, v.z, Camera.ex, Camera.ez));
      }
    }
    for (const p of this.peds) {
      if (dist2(p.x, p.z, cx, cz) > R2) continue;
      p.submit();
    }
    Police.submit();
    Player.submit();
    Missions.submit();
    Combat.submit();

    for (const p of this.pickups) {
      if (p.taken || dist2(p.x, p.z, cx, cz) > 160 * 160) continue;
      const b = Renderer.boneSlot();
      const y = 0.55 + Math.sin(p.t * 2.6) * 0.14;
      M4.trsFull(b, p.x, y, p.z, p.t * 1.9, Math.PI / 2, 0, 1);
      const tint = p.kind === 'cash' ? [0.35, 0.95, 0.45]
        : p.kind === 'health' ? [1, 0.3, 0.3] : [1, 0.85, 0.2];
      Renderer.draw(Models.coin, b, tint, 0.03, 0.7);
    }
  }
};
