'use strict';

/* Top-level state machine and the per-frame update/render orchestration. */
var Game = (function () {

  var state = 'title';           // title | play | pause | dead | win
  var g = {
    kills: 0, totalKills: 0,
    items: 0, totalItems: 0,
    time: 0, clearTime: 0,
    foundSecret: false,
    showMap: false,
    player: null
  };

  var blockers = [];             // reused each frame for door crush checks
  var deathHold = 0;

  /* The left annex behind the door on the lower west side. */
  var SECRET = { x0: 4, x1: 9, y0: 17, y1: 20 };

  function reset() {
    LEVEL.parse();
    R.bindLevel();
    Weapons.reset();
    Player.reset();
    g.player = Player.p;
    Ents.reset(g);
    g.kills = 0; g.items = 0;
    g.totalKills = Ents.countEnemies();
    g.totalItems = Ents.countItems();
    g.time = 0; g.clearTime = 0;
    g.foundSecret = false;
    g.showMap = false;
    deathHold = 0;
    HUD.message('FIND THE RED KEYCARD, THEN THE EXIT SWITCH.');
  }

  function startPlay() {
    if (state === 'title' || state === 'dead' || state === 'win') reset();
    state = 'play';
  }

  function setState(s) { state = s; }
  function getState() { return state; }

  function pause() {
    if (state === 'play') { state = 'pause'; Input.clearFire(); }
  }

  function unpause() {
    if (state === 'pause') state = 'play';
  }

  /* ---------- update ----------------------------------------------------- */

  function update(dt) {
    g.time += dt;
    HUD.updateMessages(dt);
    HUD.updateFace(dt);
    R.decayLight(dt);

    if (Input.wasPressed('KeyM')) {
      var m = Sound.toggleMute();
      HUD.message(m ? 'SOUND MUTED' : 'SOUND ON');
    }

    if (state === 'title') {
      if (Input.wasPressed('Enter') || Input.wasPressed('Space')) {
        startPlay();
        Input.requestLock();
      }
      return;
    }

    if (Input.wasPressed('KeyR')) {
      reset();
      state = 'play';
      Input.requestLock();
      return;
    }

    if (state === 'win' || state === 'dead') {
      if (state === 'dead') {
        // let the world keep animating while the death camera settles
        Player.update(dt, g);
        Ents.update(dt, Player.p);
        updateDoors(dt);
      }
      return;
    }

    if (state === 'pause') {
      // Escape deliberately does NOT resume: browsers deliver the Esc keydown
      // and the pointerlockchange that pauses us in an order we cannot rely on,
      // so accepting it here can unpause on the very frame we paused.
      if (Input.wasPressed('Enter')) unpause();
      return;
    }

    /* --- playing --- */
    if (Input.wasPressed('Escape')) { pause(); Input.exitLock(); return; }
    if (Input.wasPressed('Tab')) g.showMap = !g.showMap;

    for (var i = 1; i <= 3; i++) {
      if (Input.wasPressed('Digit' + i)) {
        if (Player.p.hasWeapon[i]) Weapons.requestSwitch(Player.p, i);
        else HUD.message('YOU DO NOT HAVE THAT WEAPON.');
      }
    }
    var wheel = Input.wheel();
    if (wheel) Weapons.cycle(Player.p, wheel > 0 ? 1 : -1);

    Player.update(dt, g);
    Weapons.update(dt, Player.p);
    Ents.update(dt, Player.p);
    updateDoors(dt);

    var p = Player.p;
    if (!g.foundSecret && p.x >= SECRET.x0 && p.x < SECRET.x1 &&
        p.y >= SECRET.y0 && p.y < SECRET.y1) {
      g.foundSecret = true;
      HUD.message('A SECRET IS REVEALED!');
      Sound.play('switchUp');
    }

    if (LEVEL.exitReached()) {
      state = 'win';
      g.clearTime = g.time;
      Sound.play('win');
      Input.exitLock();
      return;
    }

    if (!p.alive) {
      deathHold += dt;
      if (deathHold > 1.4) { state = 'dead'; Input.exitLock(); }
    }
  }

  function updateDoors(dt) {
    blockers.length = 0;
    blockers.push(Player.p);
    var l = Ents.list();
    for (var i = 0; i < l.length; i++) {
      if (l[i].kind === 'enemy' && !l[i].dead) blockers.push(l[i]);
    }
    LEVEL.update(dt, blockers);
  }

  /* ---------- render ------------------------------------------------------ */

  function render() {
    if (state === 'title') {
      HUD.drawTitle(g.time);
      return;
    }

    var p = Player.p;

    if (g.showMap && state === 'play') {
      R.fillRect(0, 0, CFG.W, CFG.VIEW_H, U.rgb(6, 6, 8));
      HUD.drawAutomap(p, Ents.list());
    } else {
      R.renderWorld(Player.camera());
      R.renderSprites(Player.camera(), Ents.list());
      drawTints(p);
      if (p.alive) Weapons.draw(p);
      if (p.alive && state === 'play') HUD.drawCrosshair();
    }

    HUD.drawStatusBar(p, g);
    HUD.drawMessage();

    if (state === 'pause') HUD.drawPause();
    else if (state === 'dead') HUD.drawDead(g);
    else if (state === 'win') HUD.drawWin(g);
    else if (!Input.isLocked() && state === 'play') {
      HUD.textCentered('CLICK TO CAPTURE THE MOUSE', CFG.VIEW_H - 26,
                       U.rgb(230, 210, 160), 1, U.rgb(10, 8, 6));
    }
  }

  /* Full-screen colour washes for pain, pickups and low health. */
  function drawTints(p) {
    if (p.painFlash > 0.01) {
      R.blendRect(0, 0, CFG.W, CFG.VIEW_H, U.rgb(190, 20, 10),
                  U.clamp(p.painFlash * 130, 0, 150) | 0);
    }
    if (p.pickupFlash > 0.01) {
      R.blendRect(0, 0, CFG.W, CFG.VIEW_H, U.rgb(220, 190, 90),
                  U.clamp(p.pickupFlash * 60, 0, 70) | 0);
    }
    if (p.alive && p.health < 30) {
      var pulse = 0.5 + 0.5 * Math.sin(g.time * 6);
      R.blendRect(0, 0, CFG.W, CFG.VIEW_H, U.rgb(120, 0, 0),
                  (12 + pulse * 26 * (1 - p.health / 30)) | 0);
    }
  }

  return {
    reset: reset, update: update, render: render,
    startPlay: startPlay, pause: pause, unpause: unpause,
    setState: setState, getState: getState,
    data: g
  };
})();
