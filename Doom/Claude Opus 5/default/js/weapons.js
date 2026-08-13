'use strict';

/* Weapon behaviour and the first-person view sprite. */
var Weapons = (function () {

  var DEFS = [
    null,
    {
      name: 'PISTOL', ammoType: 'bullets', use: 1,
      pellets: 1, dmgMin: 9, dmgMax: 16, spread: 0.012,
      rate: 0.34, auto: false, sound: 'pistol', light: 0.30,
      view: 'pistol', flash: [118, 32], viewY: 34, alert: 11,
      recoil: 5
    },
    {
      name: 'SHOTGUN', ammoType: 'shells', use: 1,
      pellets: 8, dmgMin: 5, dmgMax: 13, spread: 0.10,
      rate: 0.90, auto: false, sound: 'shotgun', light: 0.55,
      view: 'shotgun', flash: [190, 30], viewY: 24, alert: 17,
      recoil: 12, pumpAt: 0.34
    },
    {
      name: 'CHAINGUN', ammoType: 'bullets', use: 1,
      pellets: 1, dmgMin: 7, dmgMax: 14, spread: 0.038,
      rate: 0.095, auto: true, sound: 'chaingun', light: 0.26,
      view: 'chaingun', flash: [180, 54], viewY: 28, alert: 13,
      recoil: 4
    }
  ];

  /* Per-weapon animation state lives on the player; this module is stateless
     apart from the view timers below. */
  var view = {
    lower: 0,          // 0 = fully raised, 1 = fully lowered
    switching: 0,      // >0 while a swap is in progress
    pendingIndex: 0,
    fireTimer: 0,      // counts down to the next allowed shot
    animT: 0,
    flashT: 0,
    flashIdx: 0,
    spin: 0,
    recoil: 0,
    pumpT: 0
  };

  function def(i) { return DEFS[i]; }

  function reset() {
    view.lower = 0; view.switching = 0; view.pendingIndex = 0;
    view.fireTimer = 0; view.animT = 0; view.flashT = 0;
    view.spin = 0; view.recoil = 0; view.pumpT = 0;
  }

  function requestSwitch(p, index) {
    if (index < 1 || index >= DEFS.length) return;
    if (!p.hasWeapon[index] || index === p.weaponIndex) return;
    view.pendingIndex = index;
    view.switching = 1;
  }

  function cycle(p, dir) {
    var i = p.weaponIndex;
    for (var n = 0; n < DEFS.length; n++) {
      i += dir;
      if (i >= DEFS.length) i = 1;
      if (i < 1) i = DEFS.length - 1;
      if (p.hasWeapon[i]) { requestSwitch(p, i); return; }
    }
  }

  function update(dt, p) {
    view.fireTimer -= dt;
    view.flashT -= dt;
    view.pumpT -= dt;
    view.recoil = Math.max(0, view.recoil - dt * 70);

    if (view.switching === 1) {
      view.lower += dt * 7;
      if (view.lower >= 1) {
        view.lower = 1;
        p.weaponIndex = view.pendingIndex;
        p.weapon = DEFS[p.weaponIndex];
        view.switching = 2;
        view.fireTimer = Math.max(view.fireTimer, 0.12);
      }
    } else if (view.switching === 2) {
      view.lower -= dt * 7;
      if (view.lower <= 0) { view.lower = 0; view.switching = 0; }
    }

    var firing = p.alive && view.switching === 0 &&
                 (p.weapon.auto ? Input.fireHeld() : Input.firePressed());

    if (firing) tryFire(p);

    if (p.weapon.view === 'chaingun' && Input.fireHeld() && p.alive) {
      view.spin += dt * 26;
    } else {
      view.spin += dt * 4;
    }
    view.animT += dt;
  }

  function tryFire(p) {
    if (view.fireTimer > 0) return;
    var w = p.weapon;
    if (w.ammoType && p.ammo[w.ammoType] < w.use) {
      view.fireTimer = 0.45;
      Sound.play('dryfire');
      HUD.message('OUT OF AMMO - PRESS 1 FOR THE PISTOL');
      return;
    }
    if (w.ammoType) p.ammo[w.ammoType] -= w.use;
    view.fireTimer = w.rate;
    view.flashT = 0.07;
    view.flashIdx = (Math.random() * SPR.lib.flash.length) | 0;
    view.recoil = w.recoil;
    if (w.pumpAt) view.pumpT = w.pumpAt;

    Sound.play(w.sound);
    R.addLight(w.light);
    Ents.alertNear(p.x, p.y, w.alert);

    for (var i = 0; i < w.pellets; i++) {
      var ang = p.ang + (Math.random() - 0.5) * 2 * w.spread;
      shootRay(p, ang, w);
    }
    p.recoilPitch += w.recoil * 0.35;
  }

  function shootRay(p, ang, w) {
    var maxD = 26;
    var wallD = Ents.rayWallDist(p.x, p.y, ang, maxD);
    var hit = Ents.rayHitEnemy(p.x, p.y, ang, wallD);
    if (hit) {
      var dmg = U.randInt(w.dmgMin, w.dmgMax);
      Ents.hurt(hit.ent, dmg, true);
      Sound.play('hitFlesh');
      Ents.spawnPuff(p.x + Math.cos(ang) * hit.dist,
                     p.y + Math.sin(ang) * hit.dist,
                     0.35 + Math.random() * 0.3, 'blood');
    } else {
      var d = Math.max(0.1, wallD - 0.04);
      Sound.play('hitWall');
      Ents.spawnPuff(p.x + Math.cos(ang) * d, p.y + Math.sin(ang) * d,
                     0.45 + Math.random() * 0.15, 'puff');
    }
  }

  /* ---------- view drawing ---------------------------------------------- */

  function currentViewSprite(p) {
    var lib = SPR.lib.weaponViews;
    var w = p.weapon;
    if (w.view === 'pistol') {
      return lib.pistol[view.flashT > 0 ? 1 : 0];
    }
    if (w.view === 'shotgun') {
      if (view.flashT > 0) return lib.shotgun[1];
      if (view.pumpT > 0) return lib.shotgun[2];
      return lib.shotgun[0];
    }
    var f = lib.chaingun;
    return f[((view.spin | 0) % f.length + f.length) % f.length];
  }

  function draw(p) {
    var sp = currentViewSprite(p);
    var bobX = Math.sin(p.bobPhase) * 7 * p.bobAmount;
    var bobY = Math.abs(Math.cos(p.bobPhase)) * 6 * p.bobAmount;

    var x = ((CFG.W - sp.w) / 2 + bobX) | 0;
    // viewY sinks the weapon so the fist runs off the bottom behind the status
    // bar, the way the originals do -- the top of the gun stays clear of the sights.
    var y = (CFG.VIEW_H - sp.h + p.weapon.viewY + bobY +
             view.lower * (sp.h + 20) + view.recoil * 0.4) | 0;

    if (view.flashT > 0) {
      var fl = SPR.lib.flash[view.flashIdx];
      var fx = x + p.weapon.flash[0] - (fl.w >> 1);
      var fy = y + p.weapon.flash[1] - (fl.h >> 1);
      R.blit(fl, fx, fy);
    }
    R.blit(sp, x, y);
  }

  return {
    DEFS: DEFS, def: def, reset: reset, update: update, draw: draw,
    requestSwitch: requestSwitch, cycle: cycle,
    view: view
  };
})();
