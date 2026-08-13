'use strict';
/* ------------------------------------------------------------------
   missions.js — three jobs for Mama Sable, and the small framework
   that runs them: staged objectives, world markers, checkpoints,
   failure conditions, rewards and a line or two of dialogue.

   All characters, businesses and dialogue are original to Saltgrave.
------------------------------------------------------------------ */

const Missions = {
  index: 0,
  active: null,
  stage: 0,
  objective: '',
  hint: '',
  marker: null,          // { x, z, r, color, label, kind }
  targetVehicle: null,
  carried: null,
  dialog: null,
  dialogQ: [],
  flashT: 0,
  done: [],
  bones: null,
  failT: 0, successT: 0,

  init() {
    this.bones = new Float32Array(8 * 16);
    for (let i = 0; i < 8; i++) M4.identity(this.bones.subarray(i * 16, i * 16 + 16));
    this.done = [];
    this.index = 0;
    this._placeStartMarker();
  },

  get all() {
    const L = City.landmarks;
    const lots = L.lots || [];
    const garage = lots[0] || { x: 100, z: 100 };
    const yard = lots[1] || { x: 300, z: 300 };
    const plaza = L.plaza || { x: 200, z: 200 };
    return [
      {
        id: 'boost', title: 'BOOST',
        giver: 'MAMA SABLE', at: { x: garage.x + 8, z: (garage.z1 !== undefined ? garage.z1 : garage.z) + 1 },
        brief: ["MAMA SABLE: There's a Kite GT sitting pretty on Ladder Row.",
          "MAMA SABLE: Bring it to my yard before its owner sobers up."],
        reward: 700
      },
      {
        id: 'package', title: 'HOT PACKAGE',
        giver: 'FERRO', at: { x: plaza.x, z: plaza.z + 16 },
        brief: ["FERRO: Lockup on the north side. Small box, big trouble.",
          "FERRO: The second you lift it, half of Verrano will know."],
        reward: 1000
      },
      {
        id: 'getaway', title: 'GETAWAY',
        giver: 'MAMA SABLE', at: { x: garage.x + 6, z: garage.z - 10 },
        brief: ["MAMA SABLE: The Tallow Boys parked a van full of trouble in my district.",
          "MAMA SABLE: Burn it. Then lose whoever comes running."],
        reward: 1600
      }
    ];
  },

  /* ------------------------------------------------------------ */
  _placeStartMarker() {
    const list = this.all;
    if (this.index >= list.length) {
      this.marker = null;
      this.objective = 'FREE ROAM — the district is yours';
      this.hint = '';
      return;
    }
    const m = list[this.index];
    this.marker = { x: m.at.x, z: m.at.z, r: 2.4, color: [1.0, 0.85, 0.15], kind: 'start' };
    this.objective = 'Meet ' + m.giver + ' — ' + m.title;
    this.hint = '';
  },

  say(line, secs) {
    this.dialogQ.push({ line, t: secs || 3.4 });
  },

  start(m) {
    this.active = m;
    this.stage = 0;
    this.failT = 0;
    for (const l of m.brief) this.say(l, 3.6);
    Sound.play('blip', 1);
    Game.toast(m.title, '#ffd83d');
    this['_setup_' + m.id]();
  },

  complete() {
    const m = this.active;
    if (!m) return;
    Player.money += m.reward;
    Sound.play('success', 1);
    Game.toast('MISSION PASSED  +$' + m.reward, '#7ef0a0');
    this.done.push(m.id);
    this.successT = 3;
    this._cleanup();
    this.index++;
    this.active = null;
    this._placeStartMarker();
    Player.health = Math.min(Player.maxHealth, Player.health + 35);
  },

  fail(reason) {
    if (!this.active) return;
    Sound.play('fail', 1);
    Game.toast('MISSION FAILED — ' + reason, '#ff6b5a');
    this.say('MAMA SABLE: Then don\'t come back until it\'s done.', 3.2);
    this._cleanup();
    this.active = null;
    this.failT = 2;
    this._placeStartMarker();
  },

  _cleanup() {
    if (this.targetVehicle && !this.targetVehicle.dead) {
      this.targetVehicle.missionCar = false;
      this.targetVehicle.marked = false;
    }
    this.targetVehicle = null;
    this.carried = null;
    this.marker = null;
  },

  /* ------------------------- mission setups ------------------------- */
  _roadPointNear(x, z, minD, maxD) {
    for (let k = 0; k < 200; k++) {
      const n = City.nodes[randInt(0, City.nodes.length - 1)];
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < minD || d > maxD) continue;
      const a = rand(0, TAU);
      const px = n.x + Math.cos(a) * (n.wx / 2 + 5), pz = n.z + Math.sin(a) * (n.wz / 2 + 5);
      if (!Collide.circle(px, pz, 1.6).hit) return { x: px, z: pz };
    }
    return { x: City.nodes[0].x + 8, z: City.nodes[0].z + 8 };
  },

  _setup_boost() {
    const spot = this._roadPointNear(Player.x, Player.z, 70, 150);
    const v = Game.spawnMissionVehicle('sport', spot.x, spot.z, rand(0, TAU), [0.95, 0.25, 0.1]);
    this.targetVehicle = v;
    v.marked = true;
    this.stage = 1;
    this.objective = 'Steal the marked Kite GT';
    this.hint = 'Get in and it\'s yours';
    this.marker = { x: v.x, z: v.z, r: 2.2, color: [1, 0.35, 0.15], kind: 'car' };
  },

  _setup_package() {
    const spot = this._roadPointNear(Player.x, Player.z, 60, 130);
    this.stage = 1;
    this.objective = 'Collect the package';
    this.hint = 'It will not go unnoticed';
    this.marker = { x: spot.x, z: spot.z, r: 2.2, color: [0.4, 0.9, 1.0], kind: 'pickup' };
  },

  _setup_getaway() {
    const spot = this._roadPointNear(Player.x, Player.z, 55, 130);
    const v = Game.spawnMissionVehicle('van', spot.x, spot.z, rand(0, TAU), [0.25, 0.22, 0.2]);
    v.hp = v.maxHp = 150;
    this.targetVehicle = v;
    v.marked = true;
    this.stage = 1;
    this.objective = 'Destroy the Tallow Boys\' van';
    this.hint = 'Shoot it or ram it until it goes up';
    this.marker = { x: v.x, z: v.z, r: 2.4, color: [1, 0.3, 0.25], kind: 'car' };
  },

  /* ------------------------- per-frame ------------------------- */
  update(dt) {
    this.flashT += dt;
    this.failT = Math.max(0, this.failT - dt);
    this.successT = Math.max(0, this.successT - dt);

    // dialogue queue
    if (this.dialog) {
      this.dialog.t -= dt;
      if (this.dialog.t <= 0) this.dialog = null;
    }
    if (!this.dialog && this.dialogQ.length) this.dialog = this.dialogQ.shift();

    if (!this.active) {
      if (this.marker && this._inMarker(this.marker, 3.0)) {
        const m = this.all[this.index];
        if (m) this.start(m);
      }
      return;
    }

    const m = this.active;
    if (Player.dead) { this.fail('you died'); return; }

    if (m.id === 'boost') this._tick_boost(dt);
    else if (m.id === 'package') this._tick_package(dt);
    else if (m.id === 'getaway') this._tick_getaway(dt);
  },

  _inMarker(mk, extra) {
    const r = mk.r + (extra || 0);
    return dist2(Player.x, Player.z, mk.x, mk.z) < r * r;
  },

  _tick_boost(dt) {
    const v = this.targetVehicle;
    if (!v || v.dead || v.wrecked) { this.fail('the car was wrecked'); return; }
    if (this.stage === 1) {
      this.marker.x = v.x; this.marker.z = v.z;
      if (Player.inCar === v) {
        this.stage = 2;
        const g = (City.landmarks.lots || [{ x: 100, z: 100 }])[0];
        this.marker = { x: g.x, z: g.z, r: 5.0, color: [0.35, 1.0, 0.5], kind: 'drop' };
        this.objective = 'Deliver the GT to Sable Autobody';
        this.hint = 'Don\'t total it on the way';
        this.say('MAMA SABLE: Good. Now don\'t scratch it.', 3.0);
        Sound.play('blip', 1);
      }
    } else if (this.stage === 2) {
      if (Player.inCar !== v && dist2(Player.x, Player.z, v.x, v.z) > 900) {
        this.objective = 'Get back in the GT';
        this.marker.x = v.x; this.marker.z = v.z; this.marker.kind = 'car';
      } else if (Player.inCar === v) {
        const g = (City.landmarks.lots || [{ x: 100, z: 100 }])[0];
        this.marker = { x: g.x, z: g.z, r: 5.0, color: [0.35, 1.0, 0.5], kind: 'drop' };
        this.objective = 'Deliver the GT to Sable Autobody';
        if (this._inMarker(this.marker, 0) && Math.abs(v.speed) < 6) {
          this.say('MAMA SABLE: Beautiful. Cash is in your pocket.', 3.0);
          this.complete();
        }
      }
    }
  },

  _tick_package(dt) {
    if (this.stage === 1) {
      if (this._inMarker(this.marker, 1.6)) {
        this.stage = 2;
        this.carried = true;
        Sound.play('pickup', 1);
        Police.addHeat(STAR_HEAT[2] + 0.5, true);
        Game.toast('THEY SAW YOU TAKE IT', '#ff6b5a');
        this.say('FERRO: Move! Every scanner in Verrano just lit up.', 3.4);
        const drop = this._roadPointNear(Player.x, Player.z, 150, 400);
        this.marker = { x: drop.x, z: drop.z, r: 4.2, color: [0.35, 1.0, 0.5], kind: 'drop' };
        this.objective = 'Deliver the package across the district';
        this.hint = 'Police are already rolling';
      }
    } else if (this.stage === 2) {
      if (this._inMarker(this.marker, 0.5)) {
        this.say('FERRO: Never saw you. Never met you.', 3.0);
        this.complete();
      }
    }
  },

  _tick_getaway(dt) {
    const v = this.targetVehicle;
    if (this.stage === 1) {
      if (!v || v.dead || v.wrecked) {
        this.stage = 2;
        Police.addHeat(STAR_HEAT[4] + 8, true);
        this.marker = null;
        this.objective = 'ESCAPE — lose the police';
        this.hint = 'Break their line of sight and keep it broken';
        this.say('MAMA SABLE: That\'ll do it. Now run.', 3.0);
      } else {
        this.marker.x = v.x; this.marker.z = v.z;
      }
    } else if (this.stage === 2) {
      this.objective = Police.wanted > 0
        ? 'ESCAPE — lose the police (' + Math.max(0, Math.ceil(Police.evadeNeeded - Police.evadeT)) + 's unseen)'
        : 'ESCAPE — lose the police';
      if (Police.wanted === 0) {
        this.say('MAMA SABLE: Quiet streets again. Good.', 3.0);
        this.complete();
      }
    }
  },

  /* ------------------------- rendering ------------------------- */
  submit() {
    const mk = this.marker;
    if (!mk) return;
    const pulse = 0.62 + Math.sin(this.flashT * 4) * 0.18;
    const b = Renderer.boneSlot();
    M4.trsFull(b, mk.x, 0.05, mk.z, 0, 0, 0, mk.r);
    Renderer.drawBlend(Models.marker, b, mk.color, pulse * 0.45, 1,
      dist2(mk.x, mk.z, Camera.ex, Camera.ez));
    const b2 = Renderer.boneSlot();
    M4.trsFull(b2, mk.x, 0.06, mk.z, 0, 0, 0, mk.r * 1.08);
    Renderer.drawBlend(Models.ring, b2, mk.color, 0.85, 1,
      dist2(mk.x, mk.z, Camera.ex, Camera.ez) + 1);

    if (mk.kind === 'pickup') {
      const b3 = Renderer.boneSlot();
      M4.trsFull(b3, mk.x, 0.5 + Math.sin(this.flashT * 2.4) * 0.16, mk.z, this.flashT * 1.6, 0, 0, 1.1);
      Renderer.draw(Models.crate, b3, WHITE, 0.04, 0.3);
    }
  }
};
