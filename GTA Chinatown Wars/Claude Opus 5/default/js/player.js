'use strict';
/* ------------------------------------------------------------------
   player.js — Rook, on foot and behind the wheel.
   Movement is camera-relative: the stick/keys point where you see, not
   where the character happens to be facing. Aim follows the mouse.
------------------------------------------------------------------ */

const WEAPONS = [
  { id: 'fists', name: 'FISTS', melee: true, dmg: 11, range: 1.75, rate: 0.36, arc: 0.9, ammo: Infinity },
  { id: 'bat', name: 'PIPE', melee: true, dmg: 27, range: 2.15, rate: 0.55, arc: 1.0, ammo: Infinity },
  { id: 'pistol', name: 'SIDEARM', dmg: 26, rate: 0.26, spread: 0.022, range: 46, snd: 'pistol', ammo: 0, max: 250 },
  { id: 'smg', name: 'STUBBY SMG', dmg: 15, rate: 0.078, spread: 0.075, range: 38, snd: 'smg', ammo: 0, max: 400 },
  { id: 'shotgun', name: 'SCATTERGUN', dmg: 13, pellets: 7, rate: 0.82, spread: 0.15, range: 24, snd: 'shotgun', ammo: 0, max: 120 }
];

const Player = {
  x: 0, z: 0, y: 0, yaw: 0, aimYaw: 0,
  vx: 0, vz: 0,
  health: 100, maxHealth: 100, money: 0,
  radius: 0.44,
  weapons: null, wi: 0,
  cool: 0, meleeT: 0, walk: 0, speed: 0,
  inCar: null, enterCool: 0,
  dead: false, deadT: 0,
  hurtFlash: 0, invuln: 0,
  bones: null, gunBones: null,
  sprintDrain: 0,
  lastCrimeT: -99,

  init(x, z) {
    this.x = x; this.z = z; this.yaw = 0; this.aimYaw = 0;
    this.weapons = WEAPONS.map(w => Object.assign({}, w));
    this.weapons[2].ammo = 40;
    this.wi = 0;
    this.health = this.maxHealth;
    this.money = 250;
    this.bones = new Float32Array(8 * 16);
    this.gunBones = new Float32Array(8 * 16);
    for (let i = 0; i < 8; i++) {
      M4.identity(this.bones.subarray(i * 16, i * 16 + 16));
      M4.identity(this.gunBones.subarray(i * 16, i * 16 + 16));
    }
  },

  get weapon() { return this.weapons[this.wi]; },
  get armed() { return !this.weapon.melee; },

  give(id, n) {
    const w = this.weapons.find(w => w.id === id);
    if (!w) return;
    if (w.melee) return;
    w.ammo = Math.min(w.max, w.ammo + n);
    if (this.weapons[this.wi].melee) this.wi = this.weapons.indexOf(w);
  },

  hurt(n, srcX, srcZ) {
    if (this.dead || this.invuln > 0) return;
    this.health -= n;
    this.hurtFlash = 1;
    Camera.addShake(clamp(n / 40, 0.05, 0.5));
    Sound.play('grunt', 0.5);
    if (this.health <= 0) {
      this.health = 0;
      this.die();
    }
  },

  die() {
    if (this.dead) return;
    this.dead = true; this.deadT = 0;
    if (this.inCar) { this.inCar.driver = null; this.inCar = null; }
    Sound.play('busted', 1);
    Game.onPlayerDown();
  },

  respawn(x, z) {
    this.dead = false; this.deadT = 0;
    this.health = this.maxHealth;
    this.x = x; this.z = z; this.vx = this.vz = 0;
    this.invuln = 2.5;
    this.inCar = null;
  },

  /* ---------------------------------------------------------------- */
  update(dt) {
    this.cool = Math.max(0, this.cool - dt);
    this.meleeT = Math.max(0, this.meleeT - dt);
    this.enterCool = Math.max(0, this.enterCool - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2);
    this.invuln = Math.max(0, this.invuln - dt);

    if (this.dead) { this.deadT += dt; return; }

    // aim always tracks the cursor on the ground plane
    const g = Camera.screenToGround(Input.mx, Input.my, Renderer.gl.canvas.clientWidth,
      Renderer.gl.canvas.clientHeight, this.inCar ? 1.0 : 1.1, [0, 0]);
    this.aimX = g[0]; this.aimZ = g[1];
    const ax = g[0] - this.x, az = g[1] - this.z;
    if (ax * ax + az * az > 0.4) this.aimYaw = Math.atan2(ax, -az);

    if (this.inCar) this._drive(dt);
    else this._onFoot(dt);

    if (Input.hit('KeyF') && this.enterCool <= 0) this._toggleVehicle();
    this._talk();
    this._weaponSwitch();
  },

  /** E next to a local gets you a line of Saltgrave attitude. */
  _talk() {
    this.nearNPC = null;
    if (this.inCar || this.dead) return;
    let best = null, bd = 3.0 * 3.0;
    for (const p of Game.peds) {
      if (p.dead) continue;
      const d = dist2(p.x, p.z, this.x, this.z);
      if (d < bd) { bd = d; best = p; }
    }
    this.nearNPC = best;
    if (!best || !Input.hit('KeyE')) return;
    best.talkT = 2.6;
    best.yaw = Math.atan2(this.x - best.x, -(this.z - best.z));
    Missions.say('LOCAL: ' + pick(PED_LINES), 2.6);
    Sound.play('blip', 0.5);
  },

  _weaponSwitch() {
    const n = this.weapons.length;
    let d = 0;
    if (Input.hit('KeyQ')) d = -1;
    if (Input.hit('KeyE') && !this.nearNPC) d = 1;
    if (Input.wheel) d = Input.wheel > 0 ? 1 : -1;
    for (let k = 1; k <= 5; k++) if (Input.hit('Digit' + k)) { this.wi = k - 1; Sound.play('blip', 0.5); return; }
    if (!d) return;
    let i = this.wi;
    for (let k = 0; k < n; k++) {
      i = (i + d + n) % n;
      if (this.weapons[i].melee || this.weapons[i].ammo > 0) break;
    }
    if (i !== this.wi) { this.wi = i; Sound.play('blip', 0.5); }
  },

  _onFoot(dt) {
    const fwd = Camera.groundForward([0, 0]);
    const rgt = Camera.groundRight([0, 0]);
    let ix = Input.axisX(), iy = Input.axisY();
    const l = Math.hypot(ix, iy);
    if (l > 1) { ix /= l; iy /= l; }

    const sprint = Input.key('ShiftLeft') || Input.key('ShiftRight');
    const maxV = sprint ? 7.4 : 4.3;
    const wx = (rgt[0] * ix + fwd[0] * iy) * maxV;
    const wz = (rgt[1] * ix + fwd[1] * iy) * maxV;

    const acc = l > 0.01 ? 26 : 20;
    this.vx = damp(this.vx, wx, acc, dt);
    this.vz = damp(this.vz, wz, acc, dt);

    this.x += this.vx * dt;
    this.z += this.vz * dt;
    const res = Collide.circle(this.x, this.z, this.radius);
    if (res.hit) {
      this.x = res.x; this.z = res.z;
      const vn = this.vx * res.nx + this.vz * res.nz;
      if (vn < 0) { this.vx -= res.nx * vn; this.vz -= res.nz * vn; }
    }
    Game.pushOutOfVehicles(this);

    this.speed = Math.hypot(this.vx, this.vz);
    this.walk += this.speed * dt * 2.3;
    this.yaw = this.aimYaw;

    // footsteps
    if (this.speed > 1.2) {
      const ph = Math.floor(this.walk / Math.PI);
      if (ph !== this._lastStep) { this._lastStep = ph; Sound.play('hit', 0.06); }
    }

    if (Input.mouseDown && this.cool <= 0) this._attack();
  },

  _attack() {
    const w = this.weapon;
    this.cool = w.rate;
    if (w.melee) {
      this.meleeT = 0.28;
      Sound.play('melee', 0.55);
      Combat.melee(this, w);
      Game.noteCrime('melee', this.x, this.z, 0);
      return;
    }
    if (w.ammo <= 0) { Sound.play('blip', 0.3); this.cool = 0.25; return; }
    w.ammo--;
    Sound.play(w.snd, 0.9);
    Camera.addShake(w.id === 'shotgun' ? 0.4 : 0.13);
    const n = w.pellets || 1;
    for (let i = 0; i < n; i++) {
      const a = this.aimYaw + rand(-w.spread, w.spread);
      Combat.shoot(this, this.x, 1.15, this.z, a, w.dmg, w.range, true);
    }
    Combat.muzzle(this.x + Math.sin(this.aimYaw) * 0.75, 1.15, this.z - Math.cos(this.aimYaw) * 0.75);
    Game.noteCrime('gunfire', this.x, this.z, 0);
  },

  _drive(dt) {
    const v = this.inCar;
    const c = v.ctrl;
    c.throttle = (Input.key('KeyW') || Input.key('ArrowUp')) ? 1 : 0;
    c.brake = (Input.key('KeyS') || Input.key('ArrowDown')) ? 1 : 0;
    c.steer = Input.axisX();
    c.hand = Input.key('Space');
    if (Input.hit('KeyH')) { Sound.play('horn', 0.8); Game.scarePeds(v.x, v.z, 12, 0.5); }
    this.x = v.x; this.z = v.z; this.yaw = v.yaw;
    this.speed = Math.abs(v.speed);

    // drive-by with the mouse, at reduced accuracy
    if (Input.mouseDown && this.cool <= 0 && this.armed) {
      const w = this.weapon;
      if (w.ammo > 0) {
        this.cool = w.rate * 1.35;
        w.ammo--;
        Sound.play(w.snd, 0.85);
        const n = w.pellets || 1;
        for (let i = 0; i < n; i++) {
          const a = this.aimYaw + rand(-w.spread - 0.05, w.spread + 0.05);
          Combat.shoot(this, v.x, 1.0, v.z, a, w.dmg * 0.85, w.range, true);
        }
        Game.noteCrime('gunfire', v.x, v.z, 0);
      }
    }
  },

  _toggleVehicle() {
    this.enterCool = 0.45;
    if (this.inCar) {
      const v = this.inCar;
      const p = v.exitPoint([0, 0]);
      this.x = p[0]; this.z = p[1];
      this.vx = v.vx * 0.3; this.vz = v.vz * 0.3;
      v.driver = null;
      v.ctrl.throttle = 0; v.ctrl.brake = 1; v.ctrl.steer = 0;
      this.inCar = null;
      Sound.play('door', 0.7);
      Sound.stopEngine();
      if (Math.abs(v.speed) > 16) this.hurt(14);
      Game.onPlayerExit(v);
      return;
    }
    const v = Game.nearestVehicle(this.x, this.z, 4.2);
    if (!v || v.wrecked) return;
    const hadDriver = v.driver;
    if (hadDriver) Game.ejectDriver(v);
    v.driver = this;
    this.inCar = v;
    v.parked = false;
    Sound.play('door', 0.8);
    Sound.startEngine();
    Game.onPlayerEnter(v, !!hadDriver || !!v.owner);
  },

  /* ---------------------------------------------------------------- */
  submit() {
    if (this.inCar || this.dead) return;
    const b = this.bones;
    const y = this.y;
    M4.trsFull(b.subarray(0, 16), this.x, y, this.z, this.yaw, 0, 0, 1);

    const sw = Math.sin(this.walk) * clamp(this.speed / 5, 0, 1.25) * 0.62;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const leg = (i, sign) => {
      const lx = sign * 0.115;
      M4.trsFull(b.subarray((i) * 16, (i + 1) * 16),
        this.x + c * lx, y + 0.78, this.z + s * lx, this.yaw, sign > 0 ? sw : -sw, 0, 1);
    };
    leg(1, -1); leg(2, 1);

    const meleeSwing = this.meleeT > 0 ? Math.sin((1 - this.meleeT / 0.28) * Math.PI) * 2.0 : 0;
    const arm = (i, sign) => {
      const lx = sign * 0.295;
      let pitch = sign > 0 ? -sw * 0.75 : sw * 0.75;
      if (sign > 0) {   // right arm holds the weapon
        if (this.armed) pitch = -1.45;
        else if (meleeSwing) pitch = -0.4 - meleeSwing;
      } else if (this.armed) pitch = -0.9;
      M4.trsFull(b.subarray(i * 16, (i + 1) * 16),
        this.x + c * lx, y + 1.28, this.z + s * lx, this.yaw, pitch, 0, 1);
    };
    arm(3, -1); arm(4, 1);

    Renderer.draw(Models.playerPed, b, WHITE, 0.055, 0);

    // weapon in the right hand
    const w = this.weapon;
    if (w.id !== 'fists') {
      this.gunBones.set(b.subarray(4 * 16, 5 * 16), 0);
      Renderer.draw(w.melee ? Models.bat : Models.gun, this.gunBones, WHITE, 0.03, 0);
    }
  }
};
