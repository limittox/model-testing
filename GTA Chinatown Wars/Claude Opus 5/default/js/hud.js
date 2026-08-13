'use strict';
/* ------------------------------------------------------------------
   hud.js — 2D overlay: health, money, stars, weapon, objective,
   dialogue, toasts, and the district minimap (baked once, panned
   every frame).
------------------------------------------------------------------ */

const Hud = {
  cv: null, g: null, w: 0, h: 0, dpr: 1,
  map: null, mapG: null, mapScale: 1.0, mapPad: 24,
  toasts: [],
  showMap: false, showHelp: false,
  fps: 60, _fpsAcc: 0, _fpsN: 0,

  init(canvas) {
    this.cv = canvas;
    this.g = canvas.getContext('2d');
    this._bakeMap();
  },

  resize(w, h) {
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = w; this.h = h;
    this.cv.width = Math.round(w * this.dpr);
    this.cv.height = Math.round(h * this.dpr);
  },

  toast(text, color) {
    this.toasts.push({ text, color: color || '#ffd83d', t: 2.6 });
    if (this.toasts.length > 4) this.toasts.shift();
  },

  /* ---------------- minimap bake ---------------- */
  _bakeMap() {
    const pad = this.mapPad;
    const W = City.maxX - City.minX, H = City.maxZ - City.minZ;
    const S = 1.25;                       // px per world unit
    this.mapScale = S;
    const c = document.createElement('canvas');
    c.width = Math.ceil(W * S) + pad * 2;
    c.height = Math.ceil(H * S) + pad * 2;
    const g = c.getContext('2d');
    const tx = (x) => (x - City.minX) * S + pad;
    const tz = (z) => (z - City.minZ) * S + pad;

    g.fillStyle = '#141922';
    g.fillRect(0, 0, c.width, c.height);

    // blocks
    g.fillStyle = '#232c3a';
    for (const b of City.blocks) {
      g.fillRect(tx(b.x0), tz(b.z0), (b.x1 - b.x0) * S, (b.z1 - b.z0) * S);
      if (b.type === 'park') { g.fillStyle = '#2c4433'; g.fillRect(tx(b.x0), tz(b.z0), (b.x1 - b.x0) * S, (b.z1 - b.z0) * S); g.fillStyle = '#232c3a'; }
      if (b.type === 'plaza') { g.fillStyle = '#3a3a2e'; g.fillRect(tx(b.x0), tz(b.z0), (b.x1 - b.x0) * S, (b.z1 - b.z0) * S); g.fillStyle = '#232c3a'; }
      if (b.type === 'lot') { g.fillStyle = '#2a2a33'; g.fillRect(tx(b.x0), tz(b.z0), (b.x1 - b.x0) * S, (b.z1 - b.z0) * S); g.fillStyle = '#232c3a'; }
    }
    // roads
    g.fillStyle = '#4b5566';
    for (const r of City.RX) g.fillRect(tx(r.c - r.w / 2), tz(City.minZ), r.w * S, (City.maxZ - City.minZ) * S);
    for (const r of City.RZ) g.fillRect(tx(City.minX), tz(r.c - r.w / 2), (City.maxX - City.minX) * S, r.w * S);
    // centrelines on the big avenues
    g.strokeStyle = 'rgba(255,216,61,.45)'; g.lineWidth = 1;
    for (const r of City.RX) if (r.major) { g.beginPath(); g.moveTo(tx(r.c), tz(City.minZ)); g.lineTo(tx(r.c), tz(City.maxZ)); g.stroke(); }
    for (const r of City.RZ) if (r.major) { g.beginPath(); g.moveTo(tx(City.minX), tz(r.c)); g.lineTo(tx(City.maxX), tz(r.c)); g.stroke(); }

    this.map = c; this.mapG = g;
  },
  _mx(x) { return (x - City.minX) * this.mapScale + this.mapPad; },
  _mz(z) { return (z - City.minZ) * this.mapScale + this.mapPad; },

  /* ---------------- frame ---------------- */
  draw(dt) {
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);

    this._fpsAcc += dt; this._fpsN++;
    if (this._fpsAcc > 0.5) { this.fps = this._fpsN / this._fpsAcc; this._fpsAcc = 0; this._fpsN = 0; }

    for (let i = this.toasts.length - 1; i >= 0; i--) {
      this.toasts[i].t -= dt;
      if (this.toasts[i].t <= 0) this.toasts.splice(i, 1);
    }

    this._vignette(g);
    this._stats(g);
    this._weapon(g);
    this._objective(g);
    this._minimap(g);
    this._prompt(g);
    this._dialogue(g);
    this._toasts(g);
    if (Player.dead) this._deadScreen(g);
    if (this.showMap) this._bigMap(g);
    if (this.showHelp) this._help(g);
    if (Game.paused && !this.showMap && !this.showHelp) this._paused(g);
  },

  _panel(g, x, y, w, h, a) {
    g.fillStyle = 'rgba(12,15,21,' + (a === undefined ? 0.62 : a) + ')';
    g.strokeStyle = 'rgba(255,255,255,.14)';
    g.lineWidth = 2;
    g.beginPath();
    g.rect(x, y, w, h);
    g.fill(); g.stroke();
  },

  _vignette(g) {
    const f = Math.max(Player.hurtFlash * 0.55, (1 - Player.health / Player.maxHealth) * 0.4);
    if (f < 0.02) return;
    const grd = g.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.28, this.w / 2, this.h / 2, this.h * 0.78);
    grd.addColorStop(0, 'rgba(150,10,10,0)');
    grd.addColorStop(1, 'rgba(150,10,10,' + clamp(f, 0, 0.75) + ')');
    g.fillStyle = grd;
    g.fillRect(0, 0, this.w, this.h);
  },

  _stats(g) {
    const x = 22, y = 20;
    // health
    const hw = 220, hh = 16;
    g.fillStyle = 'rgba(10,12,18,.75)';
    g.fillRect(x - 3, y - 3, hw + 6, hh + 6);
    const p = clamp(Player.health / Player.maxHealth, 0, 1);
    const grd = g.createLinearGradient(x, 0, x + hw, 0);
    grd.addColorStop(0, p > 0.3 ? '#39d17a' : '#e04545');
    grd.addColorStop(1, p > 0.3 ? '#9ff06a' : '#ff8a5a');
    g.fillStyle = grd;
    g.fillRect(x, y, hw * p, hh);
    g.strokeStyle = '#0d1017'; g.lineWidth = 2;
    g.strokeRect(x - 3, y - 3, hw + 6, hh + 6);
    g.font = '700 11px Consolas, monospace';
    g.fillStyle = 'rgba(255,255,255,.85)';
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('HEALTH', x + 4, y + hh / 2 + 1);

    // money
    g.font = '900 30px "Trebuchet MS", sans-serif';
    g.textAlign = 'left';
    g.lineWidth = 5; g.strokeStyle = '#0d1017';
    const cash = '$' + Player.money.toLocaleString();
    g.strokeText(cash, x, y + 54);
    g.fillStyle = '#7ef0a0';
    g.textBaseline = 'top';
    g.fillText(cash, x, y + 40);
  },

  _weapon(g) {
    const w = Player.weapon;
    const x = this.w - 22, y = 22;
    g.textAlign = 'right'; g.textBaseline = 'top';

    // stars
    const stars = Police.wanted;
    for (let i = 0; i < 5; i++) {
      const sx = x - i * 30 - 14, sy = y + 12;
      const on = i < stars;
      this._star(g, sx, sy, 12, on ? '#ffd83d' : 'rgba(255,255,255,.12)',
        on && (Police.seenT <= 0 && Police.wanted > 0) ? (Math.sin(Renderer.time * 8) > 0 ? 0.35 : 1) : 1);
    }

    g.font = '900 20px "Trebuchet MS", sans-serif';
    g.lineWidth = 4; g.strokeStyle = '#0d1017';
    g.strokeText(w.name, x, y + 40);
    g.fillStyle = '#f2ead7';
    g.fillText(w.name, x, y + 40);

    g.font = '900 26px Consolas, monospace';
    const ammo = w.melee ? '—' : String(w.ammo);
    g.strokeText(ammo, x, y + 64);
    g.fillStyle = w.melee ? '#8fa0b8' : (w.ammo > 0 ? '#ffd83d' : '#ff6b5a');
    g.fillText(ammo, x, y + 64);

    if (Player.inCar) {
      const v = Player.inCar;
      g.font = '700 12px Consolas, monospace';
      g.fillStyle = 'rgba(255,255,255,.6)';
      g.fillText(v.name.toUpperCase(), x, y + 100);
      g.font = '900 30px Consolas, monospace';
      g.fillStyle = '#8fc9d8';
      g.fillText(Math.round(Math.abs(v.speed) * 3.6) + ' KPH', x, y + 116);
      // damage bar
      const dw = 130, dy = y + 152;
      g.fillStyle = 'rgba(10,12,18,.7)'; g.fillRect(x - dw, dy, dw, 8);
      const hp = clamp(v.hp / v.maxHp, 0, 1);
      g.fillStyle = hp > 0.35 ? '#8fc9d8' : '#ff6b5a';
      g.fillRect(x - dw, dy, dw * hp, 8);
    }
  },

  _star(g, cx, cy, r, color, alpha) {
    g.save();
    g.globalAlpha = alpha === undefined ? 1 : alpha;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const rr = i % 2 ? r * 0.44 : r;
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath();
    g.fillStyle = color;
    g.strokeStyle = '#0d1017'; g.lineWidth = 3;
    g.stroke(); g.fill();
    g.restore();
  },

  _objective(g) {
    const o = Missions.objective;
    if (!o) return;
    g.textAlign = 'center'; g.textBaseline = 'top';
    g.font = '900 19px "Trebuchet MS", sans-serif';
    const cx = this.w / 2;
    g.lineWidth = 5; g.strokeStyle = '#0d1017';
    g.strokeText(o.toUpperCase(), cx, 22);
    g.fillStyle = Missions.active ? '#ffd83d' : '#8fc9d8';
    g.fillText(o.toUpperCase(), cx, 22);
    if (Missions.hint) {
      g.font = '700 13px "Trebuchet MS", sans-serif';
      g.lineWidth = 4;
      g.strokeText(Missions.hint, cx, 48);
      g.fillStyle = 'rgba(230,235,245,.75)';
      g.fillText(Missions.hint, cx, 48);
    }
  },

  _prompt(g) {
    let text = null;
    if (!Player.dead) {
      if (Player.inCar) text = '[F] GET OUT';
      else {
        const v = Game.nearestVehicle(Player.x, Player.z, 4.2);
        if (v && !v.wrecked) text = (v.driverAI || v.driver ? '[F] JACK ' : '[F] GET IN ') + v.name.toUpperCase();
        else if (Player.nearNPC) text = '[E] TALK';
      }
    }
    if (!text) return;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 15px "Trebuchet MS", sans-serif';
    const y = this.h - 116;
    g.lineWidth = 5; g.strokeStyle = '#0d1017';
    g.strokeText(text, this.w / 2, y);
    g.fillStyle = '#ffd83d';
    g.fillText(text, this.w / 2, y);
  },

  _dialogue(g) {
    const d = Missions.dialog;
    if (!d) return;
    const w = Math.min(720, this.w - 80), h = 62;
    const x = (this.w - w) / 2, y = this.h - h - 26;
    this._panel(g, x, y, w, h, 0.78);
    g.fillStyle = '#ffd83d';
    g.fillRect(x, y, 5, h);
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.font = '700 16px "Trebuchet MS", sans-serif';
    const idx = d.line.indexOf(':');
    if (idx > 0 && idx < 22) {
      g.fillStyle = '#ff8a3d';
      g.fillText(d.line.slice(0, idx + 1), x + 18, y + h / 2);
      const off = g.measureText(d.line.slice(0, idx + 1)).width;
      g.fillStyle = '#f2ead7';
      g.fillText(d.line.slice(idx + 1), x + 22 + off, y + h / 2);
    } else {
      g.fillStyle = '#f2ead7';
      g.fillText(d.line, x + 18, y + h / 2);
    }
  },

  _toasts(g) {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    let y = this.h * 0.30;
    for (const t of this.toasts) {
      const a = clamp(t.t / 0.6, 0, 1);
      g.globalAlpha = a;
      g.font = '900 30px "Trebuchet MS", sans-serif';
      g.lineWidth = 6; g.strokeStyle = '#0d1017';
      g.strokeText(t.text, this.w / 2, y);
      g.fillStyle = t.color;
      g.fillText(t.text, this.w / 2, y);
      g.globalAlpha = 1;
      y += 38;
    }
  },

  _minimap(g) {
    const R = Math.min(112, this.h * 0.17);
    const cx = 26 + R, cy = this.h - 26 - R;
    const zoom = Player.inCar ? 0.62 : 0.85;

    g.save();
    g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.closePath();
    g.fillStyle = '#0d1017'; g.fill();
    g.clip();

    const s = this.mapScale * zoom;
    const px = this._mx(Player.x) * zoom, pz = this._mz(Player.z) * zoom;
    g.translate(cx - px, cy - pz);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.map, 0, 0, this.map.width, this.map.height,
      0, 0, this.map.width * zoom, this.map.height * zoom);

    const blip = (x, z, col, r) => {
      g.fillStyle = col;
      g.beginPath(); g.arc(this._mx(x) * zoom, this._mz(z) * zoom, r, 0, TAU); g.fill();
    };
    for (const v of Game.vehicles) {
      if (v === Player.inCar) continue;
      if (v.isPolice) blip(v.x, v.z, '#4aa3ff', 3.4);
      else if (v.marked) blip(v.x, v.z, '#ff5a3d', 3.6);
      else if (v.driverAI) blip(v.x, v.z, 'rgba(230,230,235,.5)', 2);
    }
    for (const c of Police.cops) if (!c.dead) blip(c.x, c.z, '#4aa3ff', 2.6);
    const mk = Missions.marker;
    if (mk) {
      g.fillStyle = '#ffd83d';
      const mx = this._mx(mk.x) * zoom, my = this._mz(mk.z) * zoom;
      g.beginPath();
      g.moveTo(mx, my - 7); g.lineTo(mx + 5.5, my + 5); g.lineTo(mx - 5.5, my + 5);
      g.closePath(); g.fill();
      g.strokeStyle = '#0d1017'; g.lineWidth = 1.5; g.stroke();
    }
    // player arrow
    g.translate(px, pz);
    g.rotate(Player.yaw);
    g.beginPath();
    g.moveTo(0, -8); g.lineTo(6, 7); g.lineTo(0, 3.5); g.lineTo(-6, 7);
    g.closePath();
    g.fillStyle = '#7ef0a0'; g.fill();
    g.strokeStyle = '#0d1017'; g.lineWidth = 2; g.stroke();
    g.restore();

    // frame + compass
    g.beginPath(); g.arc(cx, cy, R, 0, TAU);
    g.strokeStyle = '#0d1017'; g.lineWidth = 6; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 2; g.stroke();
    g.font = '900 11px Consolas, monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.fillText('N', cx, cy - R + 11);

    // wanted-escape ring
    if (Police.wanted > 0 && Police.seenT <= 0) {
      const p = clamp(Police.evadeT / Police.evadeNeeded, 0, 1);
      g.beginPath();
      g.arc(cx, cy, R - 5, -Math.PI / 2, -Math.PI / 2 + p * TAU);
      g.strokeStyle = '#7ef0a0'; g.lineWidth = 4; g.stroke();
    }
  },

  _deadScreen(g) {
    g.fillStyle = 'rgba(60,6,6,' + clamp(Player.deadT * 0.5, 0, 0.62) + ')';
    g.fillRect(0, 0, this.w, this.h);
    if (Player.deadT < 0.5) return;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 64px "Trebuchet MS", sans-serif';
    g.lineWidth = 8; g.strokeStyle = '#0d1017';
    g.strokeText('WASTED', this.w / 2, this.h / 2 - 10);
    g.fillStyle = '#e04545';
    g.fillText('WASTED', this.w / 2, this.h / 2 - 10);
    g.font = '700 15px "Trebuchet MS", sans-serif';
    g.fillStyle = 'rgba(255,255,255,.7)';
    g.fillText('patching you up…', this.w / 2, this.h / 2 + 40);
  },

  _bigMap(g) {
    g.fillStyle = 'rgba(8,10,16,.88)';
    g.fillRect(0, 0, this.w, this.h);
    const pad = 60;
    const sc = Math.min((this.w - pad * 2) / this.map.width, (this.h - pad * 2) / this.map.height);
    const ox = (this.w - this.map.width * sc) / 2, oy = (this.h - this.map.height * sc) / 2;
    g.drawImage(this.map, ox, oy, this.map.width * sc, this.map.height * sc);
    const P = (x, z) => [ox + this._mx(x) * sc, oy + this._mz(z) * sc];

    for (const v of Game.vehicles) {
      if (v.isPolice || v.marked) {
        const [a, b] = P(v.x, v.z);
        g.fillStyle = v.isPolice ? '#4aa3ff' : '#ff5a3d';
        g.beginPath(); g.arc(a, b, 4, 0, TAU); g.fill();
      }
    }
    const mk = Missions.marker;
    if (mk) {
      const [a, b] = P(mk.x, mk.z);
      g.fillStyle = '#ffd83d';
      g.beginPath(); g.moveTo(a, b - 9); g.lineTo(a + 7, b + 6); g.lineTo(a - 7, b + 6); g.closePath(); g.fill();
    }
    const [pa, pb] = P(Player.x, Player.z);
    g.save(); g.translate(pa, pb); g.rotate(Player.yaw);
    g.beginPath(); g.moveTo(0, -10); g.lineTo(7, 8); g.lineTo(0, 4); g.lineTo(-7, 8); g.closePath();
    g.fillStyle = '#7ef0a0'; g.fill(); g.strokeStyle = '#0d1017'; g.lineWidth = 2; g.stroke();
    g.restore();

    g.textAlign = 'center'; g.textBaseline = 'top';
    g.font = '900 26px "Trebuchet MS", sans-serif';
    g.fillStyle = '#ffd83d';
    g.fillText('SALTGRAVE DISTRICT', this.w / 2, 18);
    g.font = '700 13px "Trebuchet MS", sans-serif';
    g.fillStyle = 'rgba(255,255,255,.6)';
    g.fillText('M to close', this.w / 2, 50);
  },

  _paused(g) {
    g.fillStyle = 'rgba(8,10,16,.72)';
    g.fillRect(0, 0, this.w, this.h);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 54px "Trebuchet MS", sans-serif';
    g.lineWidth = 8; g.strokeStyle = '#0d1017';
    g.strokeText('PAUSED', this.w / 2, this.h / 2);
    g.fillStyle = '#ffd83d';
    g.fillText('PAUSED', this.w / 2, this.h / 2);
    g.font = '700 14px "Trebuchet MS", sans-serif';
    g.fillStyle = 'rgba(255,255,255,.65)';
    g.fillText('P to resume  •  H for controls  •  M for map', this.w / 2, this.h / 2 + 46);
  },

  _help(g) {
    g.fillStyle = 'rgba(8,10,16,.9)';
    g.fillRect(0, 0, this.w, this.h);
    const lines = [
      ['ON FOOT', ''],
      ['W A S D', 'move (relative to the camera)'],
      ['Shift', 'sprint'],
      ['Mouse', 'aim    •    Left button: attack / fire'],
      ['Q / E / Wheel / 1-5', 'change weapon'],
      ['F', 'enter or steal the nearest vehicle'],
      ['', ''],
      ['DRIVING', ''],
      ['W / S', 'throttle  •  brake then reverse'],
      ['A / D', 'steer'],
      ['Space', 'handbrake (slide it round the corner)'],
      ['F', 'get out'],
      ['C', 'camera: chase or north-up'],
      ['H', 'horn'],
      ['', ''],
      ['GENERAL', ''],
      ['M', 'district map'],
      ['P', 'pause'],
      ['N', 'mute sound'],
      ['F1', 'this screen']
    ];
    g.textBaseline = 'middle';
    let y = this.h / 2 - lines.length * 13;
    for (const [k, v] of lines) {
      if (!k && !v) { y += 14; continue; }
      if (!v) {
        g.textAlign = 'center';
        g.font = '900 15px "Trebuchet MS", sans-serif';
        g.fillStyle = '#ff8a3d';
        g.fillText(k, this.w / 2, y);
      } else {
        g.textAlign = 'right';
        g.font = '700 14px Consolas, monospace';
        g.fillStyle = '#ffd83d';
        g.fillText(k, this.w / 2 - 18, y);
        g.textAlign = 'left';
        g.font = '400 14px "Trebuchet MS", sans-serif';
        g.fillStyle = 'rgba(240,244,250,.85)';
        g.fillText(v, this.w / 2 + 18, y);
      }
      y += 26;
    }
    g.textAlign = 'center';
    g.font = '700 13px "Trebuchet MS", sans-serif';
    g.fillStyle = 'rgba(255,255,255,.5)';
    g.fillText('H or F1 to close', this.w / 2, this.h - 40);
  }
};
