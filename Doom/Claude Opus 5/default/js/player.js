'use strict';

/* The player: movement, look, damage bookkeeping and pickups.
   A single instance lives for the whole session and is reset per level. */
var Player = (function () {

  var p = {
    x: 2.5, y: 2.5, ang: 0,
    pitch: 0, recoilPitch: 0,
    health: 100, armor: 0,
    ammo: { bullets: 50, shells: 0 },
    keys: { red: false },
    hasWeapon: [false, true, false, false],
    weaponIndex: 1,
    weapon: null,
    alive: true,
    bobPhase: 0, bobAmount: 0, viewBob: 0,
    painFlash: 0, pickupFlash: 0, damageDir: 0,
    deathTimer: 0,
    lastDamageAt: 0
  };

  function reset() {
    var s = LEVEL.start();
    p.x = s.x; p.y = s.y; p.ang = s.ang;
    p.pitch = 0; p.recoilPitch = 0;
    p.health = 100; p.armor = 0;
    p.ammo.bullets = 50; p.ammo.shells = 0;
    p.keys.red = false;
    p.hasWeapon = [false, true, false, false];
    p.weaponIndex = 1;
    p.weapon = Weapons.def(1);
    p.alive = true;
    p.bobPhase = 0; p.bobAmount = 0; p.viewBob = 0;
    p.painFlash = 0; p.pickupFlash = 0;
    p.deathTimer = 0;
  }

  function update(dt, game) {
    p.painFlash = Math.max(0, p.painFlash - dt * 1.6);
    p.pickupFlash = Math.max(0, p.pickupFlash - dt * 2.4);
    p.recoilPitch = Math.max(0, p.recoilPitch - dt * 34);

    if (!p.alive) {
      p.deathTimer += dt;
      // camera sinks toward the floor
      p.viewBob = -U.lerp(0, 34, U.clamp(p.deathTimer / 1.2, 0, 1));
      return;
    }

    look(dt);
    move(dt, game);
    useKey(game);
  }

  function look(dt) {
    var mdx = Input.mouseDX(), mdy = Input.mouseDY();
    if (Input.isLocked()) {
      p.ang += mdx * CFG.MOUSE_SENS;
      p.pitch = U.clamp(p.pitch - mdy * CFG.MOUSE_SENS * 90, -CFG.PITCH_LIMIT, CFG.PITCH_LIMIT);
    }
    if (Input.isDown('ArrowLeft')) p.ang -= CFG.TURN_SPEED * dt;
    if (Input.isDown('ArrowRight')) p.ang += CFG.TURN_SPEED * dt;
    if (Input.isDown('PageUp')) p.pitch = U.clamp(p.pitch + 90 * dt, -CFG.PITCH_LIMIT, CFG.PITCH_LIMIT);
    if (Input.isDown('PageDown')) p.pitch = U.clamp(p.pitch - 90 * dt, -CFG.PITCH_LIMIT, CFG.PITCH_LIMIT);
    if (Input.wasPressed('KeyC')) p.pitch = 0;

    if (p.ang > Math.PI) p.ang -= Math.PI * 2;
    if (p.ang < -Math.PI) p.ang += Math.PI * 2;
  }

  function move(dt, game) {
    var fwd = 0, strafe = 0;
    if (Input.isDown('KeyW') || Input.isDown('ArrowUp')) fwd += 1;
    if (Input.isDown('KeyS') || Input.isDown('ArrowDown')) fwd -= 1;
    if (Input.isDown('KeyD')) strafe += 1;
    if (Input.isDown('KeyA')) strafe -= 1;
    if (Input.isDown('KeyQ')) strafe -= 1;

    var run = Input.isDown('ShiftLeft') || Input.isDown('ShiftRight');
    var speed = CFG.MOVE_SPEED * (run ? CFG.RUN_MULT : 1);

    var len = Math.sqrt(fwd * fwd + strafe * strafe);
    if (len > 0) {
      fwd /= len; strafe /= len;
      var cs = Math.cos(p.ang), sn = Math.sin(p.ang);
      var dx = (cs * fwd - sn * strafe) * speed * dt;
      var dy = (sn * fwd + cs * strafe) * speed * dt;
      stepWithEnemies(dx, dy);
      p.bobPhase += dt * (run ? 13 : 9);
      p.bobAmount = U.lerp(p.bobAmount, run ? 1 : 0.62, dt * 8);
    } else {
      p.bobAmount = U.lerp(p.bobAmount, 0, dt * 6);
    }
    p.viewBob = Math.sin(p.bobPhase * 2) * CFG.MAX_PITCH_BOB * p.bobAmount;
  }

  /* Walls slide, monsters are solid. */
  function stepWithEnemies(dx, dy) {
    var r = CFG.PLAYER_RADIUS;
    if (!LEVEL.blocked(p.x + dx, p.y, r) && !Ents.anyEnemyBlocking(p.x + dx, p.y, r, null)) p.x += dx;
    if (!LEVEL.blocked(p.x, p.y + dy, r) && !Ents.anyEnemyBlocking(p.x, p.y + dy, r, null)) p.y += dy;
  }

  function useKey(game) {
    if (!Input.wasPressed('KeyE') && !Input.wasPressed('Space')) return;
    var cs = Math.cos(p.ang), sn = Math.sin(p.ang);
    for (var t = 0.2; t <= 1.7; t += 0.15) {
      var tx = Math.floor(p.x + cs * t), ty = Math.floor(p.y + sn * t);
      if (!LEVEL.solid(tx, ty) && !LEVEL.doorAt(tx, ty)) continue;
      if (LEVEL.activate(tx, ty, p, HUD.message)) return;
    }
    HUD.message('NOTHING TO USE HERE.');
  }

  /* ---------- damage & pickups ------------------------------------------ */

  function damage(amount, srcX, srcY) {
    if (!p.alive) return;
    var absorbed = 0;
    if (p.armor > 0) {
      absorbed = Math.min(p.armor, Math.floor(amount / 3));
      p.armor -= absorbed;
    }
    var taken = amount - absorbed;
    p.health -= taken;
    p.painFlash = Math.min(1, p.painFlash + 0.25 + taken / 90);
    if (srcX !== undefined) p.damageDir = Math.atan2(srcY - p.y, srcX - p.x);

    if (p.health <= 0) {
      p.health = 0;
      p.alive = false;
      p.deathTimer = 0;
      Sound.play('playerDie');
      HUD.message('YOU DIED - PRESS R TO RESTART');
    } else {
      Sound.play('playerPain');
    }
  }

  /* Returns false when the pickup would be wasted, so it stays on the floor. */
  function tryPickup(type) {
    switch (type) {
      case 'healthBonus':
        if (p.health >= CFG.OVERHEAL) return false;
        p.health = Math.min(CFG.OVERHEAL, p.health + 2);
        break;
      case 'medkit':
        if (p.health >= CFG.MAX_HEALTH) return false;
        p.health = Math.min(CFG.MAX_HEALTH, p.health + 25);
        break;
      case 'armor':
        if (p.armor >= CFG.MAX_ARMOR) return false;
        p.armor = Math.min(CFG.MAX_ARMOR, p.armor + 50);
        break;
      case 'clip':
        if (p.ammo.bullets >= CFG.MAX_BULLETS) return false;
        p.ammo.bullets = Math.min(CFG.MAX_BULLETS, p.ammo.bullets + 15);
        break;
      case 'shells':
        if (p.ammo.shells >= CFG.MAX_SHELLS) return false;
        p.ammo.shells = Math.min(CFG.MAX_SHELLS, p.ammo.shells + 8);
        break;
      case 'redkey':
        p.keys.red = true;
        break;
      case 'shotgun':
        p.hasWeapon[2] = true;
        p.ammo.shells = Math.min(CFG.MAX_SHELLS, p.ammo.shells + 8);
        Weapons.requestSwitch(p, 2);
        break;
      case 'chaingun':
        p.hasWeapon[3] = true;
        p.ammo.bullets = Math.min(CFG.MAX_BULLETS, p.ammo.bullets + 40);
        Weapons.requestSwitch(p, 3);
        break;
      default:
        return false;
    }
    p.pickupFlash = 0.6;
    return true;
  }

  /* Camera basis for the renderer. */
  var cam = { x: 0, y: 0, dirX: 1, dirY: 0, planeX: 0, planeY: 1, pitch: 0, bob: 0 };

  function camera() {
    cam.x = p.x; cam.y = p.y;
    cam.dirX = Math.cos(p.ang); cam.dirY = Math.sin(p.ang);
    // plane is perpendicular to dir, scaled to the horizontal FOV
    cam.planeX = -cam.dirY * CFG.FOV_PLANE;
    cam.planeY = cam.dirX * CFG.FOV_PLANE;
    cam.pitch = p.pitch - p.recoilPitch;
    cam.bob = p.viewBob;
    return cam;
  }

  return {
    p: p, reset: reset, update: update, damage: damage,
    tryPickup: tryPickup, camera: camera
  };
})();
