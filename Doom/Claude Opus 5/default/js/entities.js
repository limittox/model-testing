'use strict';

/* Every drawable, updatable thing in the world: monsters, their corpses,
   pickups, fireballs and the little puff effects. */
var Ents = (function () {

  var list = [];
  var game = null;      // set by Game.reset

  /* ---------- monster definitions -------------------------------------- */

  var MONSTERS = {
    zombie: {
      hp: 24, speed: 1.55, size: 0.80, radius: 0.30,
      art: 'zombie', attack: 'hitscan',
      range: 14, cooldown: 1.5, windup: 0.32, painChance: 0.62,
      dmgMin: 3, dmgMax: 9, accuracy: 0.62,
      seeSound: 'enemySee', painSound: 'enemyPain', dieSound: 'enemyDie',
      score: 1
    },
    imp: {
      hp: 46, speed: 1.85, size: 0.88, radius: 0.32,
      art: 'imp', attack: 'fireball',
      range: 16, cooldown: 1.7, windup: 0.42, painChance: 0.50,
      projSpeed: 6.5, projDmg: 14, projSprite: 'fireball',
      seeSound: 'enemySee', painSound: 'enemyPain', dieSound: 'enemyDie',
      score: 1
    },
    demon: {
      hp: 95, speed: 3.15, size: 0.62, radius: 0.38,
      art: 'demon', attack: 'melee',
      range: 1.35, cooldown: 0.85, windup: 0.28, painChance: 0.28,
      dmgMin: 7, dmgMax: 19,
      seeSound: 'enemySee', painSound: 'enemyPain', dieSound: 'enemyDie',
      score: 1
    },
    baron: {
      hp: 320, speed: 1.7, size: 1.18, radius: 0.42,
      art: 'baron', attack: 'fireball',
      range: 18, cooldown: 1.6, windup: 0.5, painChance: 0.10,
      projSpeed: 7.5, projDmg: 26, projSprite: 'plasma',
      seeSound: 'baronSee', painSound: 'enemyPain', dieSound: 'baronDie',
      score: 1
    }
  };

  /* ---------- pickup definitions ---------------------------------------- */

  var ITEMS = {
    healthBonus: { sprite: 'healthBonus', size: 0.30, z: 0.05, msg: 'PICKED UP A HEALTH BONUS.', sound: 'health' },
    medkit:      { sprite: 'medkit',      size: 0.40, z: 0.04, msg: 'PICKED UP A MEDIKIT.', sound: 'health' },
    armor:       { sprite: 'armor',       size: 0.44, z: 0.04, msg: 'PICKED UP A COMBAT ARMOR.', sound: 'pickupItem' },
    clip:        { sprite: 'clip',        size: 0.24, z: 0.04, msg: 'PICKED UP A CLIP.', sound: 'pickupItem' },
    shells:      { sprite: 'shells',      size: 0.30, z: 0.04, msg: 'PICKED UP 8 SHOTGUN SHELLS.', sound: 'pickupItem' },
    redkey:      { sprite: 'redkey',      size: 0.40, z: 0.07, msg: 'PICKED UP A RED KEYCARD.', sound: 'pickupKey' },
    shotgun:     { sprite: 'shotgun',     size: 0.38, z: 0.04, msg: 'YOU GOT THE SHOTGUN!', sound: 'pickupWeapon' },
    chaingun:    { sprite: 'chaingun',    size: 0.42, z: 0.04, msg: 'YOU GOT THE CHAINGUN!', sound: 'pickupWeapon' }
  };

  /* ---------- construction ---------------------------------------------- */

  function reset(g) {
    game = g;
    list.length = 0;
    var things = LEVEL.things();
    for (var i = 0; i < things.length; i++) {
      var t = things[i];
      if (t.kind === 'enemy') spawnEnemy(t.what, t.x, t.y);
      else if (t.kind === 'item') spawnItem(t.what, t.x, t.y);
    }
  }

  function spawnEnemy(what, x, y) {
    var def = MONSTERS[what];
    var art = SPR.lib[def.art];
    var e = {
      kind: 'enemy', type: what, def: def, art: art,
      x: x, y: y, z: 0, size: def.size, radius: def.radius,
      hp: def.hp, maxHp: def.hp,
      state: 'idle', timer: 0, cooldown: Math.random() * 0.8,
      animT: Math.random(), frame: 0,
      sprite: art.walk[0], dead: false, awake: false,
      dieFrame: 0, dieT: 0, wanderT: 0, strafe: 0
    };
    list.push(e);
    return e;
  }

  function spawnItem(what, x, y) {
    var def = ITEMS[what];
    var e = {
      kind: 'item', type: what, def: def,
      x: x, y: y, z: def.z, size: def.size,
      sprite: SPR.lib.items[def.sprite],
      bobT: Math.random() * 6.28, dead: false
    };
    list.push(e);
    return e;
  }

  function spawnProjectile(owner, x, y, ang, def) {
    var frames = SPR.lib[def.projSprite];
    var e = {
      kind: 'proj', owner: owner,
      x: x, y: y, z: 0.42, size: 0.30,
      vx: Math.cos(ang) * def.projSpeed, vy: Math.sin(ang) * def.projSpeed,
      dmg: def.projDmg, frames: frames, sprite: frames[0],
      animT: 0, life: 6, fullbright: true, dead: false
    };
    list.push(e);
    Sound.playAt('fireball', x, y, game.player);
    return e;
  }

  function spawnPuff(x, y, z, kind) {
    var frames = kind === 'blood' ? SPR.lib.blood : SPR.lib.puff;
    list.push({
      kind: 'fx', x: x, y: y, z: z, size: 0.22,
      frames: frames, sprite: frames[0], t: 0, life: 0.28,
      fullbright: kind !== 'blood', dead: false, rise: kind === 'blood' ? -0.25 : 0.4
    });
  }

  function spawnBoom(x, y, z) {
    list.push({
      kind: 'fx', x: x, y: y, z: z, size: 0.75,
      frames: SPR.lib.boom, sprite: SPR.lib.boom[0], t: 0, life: 0.34,
      fullbright: true, dead: false, rise: 0.2
    });
    R.addLight(0.7);
    Sound.playAt('boom', x, y, game.player);
  }

  /* ---------- queries ---------------------------------------------------- */

  /* Nearest living enemy along a ray, stopping at maxDist. Used by hitscans. */
  function rayHitEnemy(x0, y0, ang, maxDist) {
    var dx = Math.cos(ang), dy = Math.sin(ang);
    var best = null, bestT = maxDist;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.kind !== 'enemy' || e.dead) continue;
      var ex = e.x - x0, ey = e.y - y0;
      var t = ex * dx + ey * dy;                 // projection onto the ray
      if (t <= 0 || t >= bestT) continue;
      var px = ex - dx * t, py = ey - dy * t;    // perpendicular offset
      var perp2 = px * px + py * py;
      var r = e.radius + 0.06;
      if (perp2 > r * r) continue;
      best = e; bestT = t;
    }
    return best ? { ent: best, dist: bestT } : null;
  }

  /* Distance to the first wall along a ray -- caps every hitscan.
     Same DDA the renderer uses, so shots agree with what is on screen. */
  function rayWallDist(x0, y0, ang, maxDist) {
    var rayX = Math.cos(ang), rayY = Math.sin(ang);
    var mapX = x0 | 0, mapY = y0 | 0;
    var deltaX = rayX === 0 ? 1e30 : Math.abs(1 / rayX);
    var deltaY = rayY === 0 ? 1e30 : Math.abs(1 / rayY);
    var stepX, stepY, sideDistX, sideDistY;

    if (rayX < 0) { stepX = -1; sideDistX = (x0 - mapX) * deltaX; }
    else { stepX = 1; sideDistX = (mapX + 1 - x0) * deltaX; }
    if (rayY < 0) { stepY = -1; sideDistY = (y0 - mapY) * deltaY; }
    else { stepY = 1; sideDistY = (mapY + 1 - y0) * deltaY; }

    for (var guard = 0; guard < 128; guard++) {
      var side;
      if (sideDistX < sideDistY) { sideDistX += deltaX; mapX += stepX; side = 0; }
      else { sideDistY += deltaY; mapY += stepY; side = 1; }
      var perp = side === 0 ? (sideDistX - deltaX) : (sideDistY - deltaY);
      if (perp > maxDist) return maxDist;
      if (LEVEL.solid(mapX, mapY)) return perp;
    }
    return maxDist;
  }

  function anyEnemyBlocking(x, y, r, ignore) {
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.kind !== 'enemy' || e.dead || e === ignore) continue;
      var dx = e.x - x, dy = e.y - y;
      var rr = e.radius + r;
      if (dx * dx + dy * dy < rr * rr) return e;
    }
    return null;
  }

  function alertNear(x, y, radius) {
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.kind !== 'enemy' || e.dead || e.awake) continue;
      var dx = e.x - x, dy = e.y - y;
      if (dx * dx + dy * dy > radius * radius) continue;
      wake(e);
    }
  }

  function wake(e) {
    if (e.awake || e.dead) return;
    e.awake = true;
    e.state = 'chase';
    Sound.playAt(e.def.seeSound, e.x, e.y, game.player);
  }

  function hurt(e, dmg, byPlayer) {
    if (e.dead) return;
    e.hp -= dmg;
    if (!e.awake) wake(e);
    if (e.hp <= 0) {
      kill(e);
      return;
    }
    if (Math.random() < e.def.painChance && e.state !== 'attack') {
      e.state = 'pain';
      e.timer = 0.18;
      e.sprite = e.art.pain;
      Sound.playAt(e.def.painSound, e.x, e.y, game.player);
    }
  }

  function kill(e) {
    e.dead = true;
    e.state = 'dying';
    e.dieFrame = 0;
    e.dieT = 0;
    e.sprite = e.art.die[0];
    Sound.playAt(e.def.dieSound, e.x, e.y, game.player);
    if (game) game.kills++;
  }

  /* ---------- update ------------------------------------------------------ */

  function update(dt, player) {
    for (var i = list.length - 1; i >= 0; i--) {
      var e = list[i];
      switch (e.kind) {
        case 'enemy': updateEnemy(e, dt, player); break;
        case 'item': updateItem(e, dt, player, i); break;
        case 'proj': updateProjectile(e, dt, player, i); break;
        case 'fx': updateFx(e, dt, i); break;
      }
    }
  }

  function updateItem(e, dt, player, i) {
    e.bobT += dt * 3;
    e.z = e.def.z + Math.sin(e.bobT) * 0.02;
    var dx = player.x - e.x, dy = player.y - e.y;
    if (dx * dx + dy * dy > 0.36) return;
    if (!Player.tryPickup(e.type)) return;   // full on this resource: leave it
    Sound.play(e.def.sound);
    HUD.message(e.def.msg);
    game.items++;
    list.splice(i, 1);
  }

  function updateProjectile(e, dt, player, i) {
    e.animT += dt;
    e.sprite = e.frames[((e.animT * 14) | 0) % e.frames.length];
    e.life -= dt;

    var steps = 3;
    for (var s = 0; s < steps; s++) {
      var nx = e.x + e.vx * dt / steps, ny = e.y + e.vy * dt / steps;
      if (LEVEL.solid(nx, ny)) { explode(e, i); return; }
      e.x = nx; e.y = ny;

      var dx = player.x - e.x, dy = player.y - e.y;
      if (dx * dx + dy * dy < 0.14) {
        Player.damage(e.dmg, e.x, e.y);
        explode(e, i);
        return;
      }
    }
    if (e.life <= 0) explode(e, i);
  }

  function explode(e, i) {
    spawnBoom(e.x, e.y, e.z);
    var idx = list.indexOf(e);
    if (idx >= 0) list.splice(idx, 1);
  }

  function updateFx(e, dt, i) {
    e.t += dt;
    e.z += e.rise * dt;
    var f = (e.t / e.life * e.frames.length) | 0;
    if (f >= e.frames.length) { list.splice(i, 1); return; }
    e.sprite = e.frames[f];
  }

  function updateEnemy(e, dt, player) {
    if (e.state === 'dying') {
      e.dieT += dt;
      var f = (e.dieT / 0.11) | 0;
      if (f >= e.art.die.length) {
        e.state = 'corpse';
        e.sprite = e.art.die[e.art.die.length - 1];
      } else {
        e.sprite = e.art.die[f];
      }
      return;
    }
    if (e.state === 'corpse') return;

    var dx = player.x - e.x, dy = player.y - e.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var sees = dist < 20 && LEVEL.lineOfSight(e.x, e.y, player.x, player.y);

    if (!e.awake) {
      if (sees && dist < 16) wake(e);
      else return;
    }

    e.cooldown -= dt;

    if (e.state === 'pain') {
      e.timer -= dt;
      if (e.timer <= 0) e.state = 'chase';
      return;
    }

    if (e.state === 'attack') {
      e.timer -= dt;
      e.sprite = e.art.attack;
      if (!e.fired && e.timer <= 0) {
        e.fired = true;
        performAttack(e, player, dist, sees);
        e.timer = 0.22;
      } else if (e.fired && e.timer <= 0) {
        e.state = 'chase';
        e.fired = false;
      }
      return;
    }

    /* chase */
    e.animT += dt * (e.def.speed * 1.6);
    e.frame = ((e.animT * 3) | 0) & 1;
    e.sprite = e.art.walk[e.frame];

    if (sees && e.cooldown <= 0 && dist < e.def.range) {
      e.state = 'attack';
      e.timer = e.def.windup;
      e.fired = false;
      e.cooldown = e.def.cooldown + Math.random() * 0.5;
      e.sprite = e.art.attack;
      return;
    }

    // stop closing once comfortably inside melee/firing range
    var stopAt = e.def.attack === 'melee' ? e.def.range * 0.7 : 1.6;
    if (dist <= stopAt) return;

    var ang = Math.atan2(dy, dx);

    // strafe a little when a direct step is blocked, so they round corners
    e.wanderT -= dt;
    if (e.wanderT <= 0) { e.wanderT = 0.5 + Math.random(); e.strafe = (Math.random() - 0.5) * 1.1; }

    var speed = e.def.speed * dt;
    var mx = Math.cos(ang) * speed, my = Math.sin(ang) * speed;
    var sx = Math.cos(ang + Math.PI / 2) * speed * e.strafe;
    var sy = Math.sin(ang + Math.PI / 2) * speed * e.strafe;

    tryStep(e, mx + sx, my + sy);

    // shove apart so monsters do not stack into a single column
    var other = anyEnemyBlocking(e.x, e.y, e.radius, e);
    if (other) {
      var ox = e.x - other.x, oy = e.y - other.y;
      var l = Math.sqrt(ox * ox + oy * oy) || 1;
      tryStep(e, (ox / l) * speed * 0.8, (oy / l) * speed * 0.8);
    }
  }

  function tryStep(e, dx, dy) {
    if (!LEVEL.blocked(e.x + dx, e.y, e.radius)) e.x += dx;
    if (!LEVEL.blocked(e.x, e.y + dy, e.radius)) e.y += dy;
  }

  function performAttack(e, player, dist, sees) {
    if (!sees) return;
    var def = e.def;
    var ang = Math.atan2(player.y - e.y, player.x - e.x);

    if (def.attack === 'hitscan') {
      Sound.playAt('pistol', e.x, e.y, player);
      if (Math.random() < def.accuracy * U.clamp(1 - dist / def.range * 0.5, 0.35, 1)) {
        Player.damage(U.randInt(def.dmgMin, def.dmgMax), e.x, e.y);
      } else {
        spawnPuff(player.x + Math.cos(ang) * 0.4, player.y + Math.sin(ang) * 0.4, 0.5, 'puff');
      }
    } else if (def.attack === 'melee') {
      if (dist < def.range + 0.15) {
        Sound.playAt('bite', e.x, e.y, player);
        Player.damage(U.randInt(def.dmgMin, def.dmgMax), e.x, e.y);
      } else {
        Sound.playAt('bite', e.x, e.y, player);
      }
    } else if (def.attack === 'fireball') {
      var sx = e.x + Math.cos(ang) * (e.radius + 0.25);
      var sy = e.y + Math.sin(ang) * (e.radius + 0.25);
      if (!LEVEL.solid(sx, sy)) spawnProjectile(e, sx, sy, ang, def);
      if (e.type === 'baron') {
        spawnProjectile(e, sx, sy, ang + 0.16, def);
        spawnProjectile(e, sx, sy, ang - 0.16, def);
      }
    }
  }

  function countEnemies() {
    var n = 0;
    for (var i = 0; i < list.length; i++) if (list[i].kind === 'enemy') n++;
    return n;
  }

  function countItems() {
    var n = 0;
    for (var i = 0; i < list.length; i++) if (list[i].kind === 'item') n++;
    return n;
  }

  return {
    reset: reset, update: update, list: function () { return list; },
    spawnPuff: spawnPuff, spawnBoom: spawnBoom,
    rayHitEnemy: rayHitEnemy, rayWallDist: rayWallDist,
    anyEnemyBlocking: anyEnemyBlocking,
    alertNear: alertNear, hurt: hurt,
    countEnemies: countEnemies, countItems: countItems,
    MONSTERS: MONSTERS, ITEMS: ITEMS
  };
})();
