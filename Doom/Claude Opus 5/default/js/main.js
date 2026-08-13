'use strict';

/* Boot, canvas sizing and the requestAnimationFrame loop. */
(function () {

  var canvas = document.getElementById('screen');
  var last = 0;
  var bootStep = 0;

  function resize() {
    var pad = 8;
    var availW = Math.max(160, window.innerWidth - pad);
    var availH = Math.max(120, window.innerHeight - pad);
    var scale = Math.min(availW / CFG.W, availH / CFG.H);
    if (scale < 1) scale = Math.max(scale, 0.4);
    canvas.style.width = Math.round(CFG.W * scale) + 'px';
    canvas.style.height = Math.round(CFG.H * scale) + 'px';
  }

  /* Texture and sprite generation is spread over a few frames so the loading
     bar actually paints instead of the tab locking up. */
  function boot() {
    if (bootStep === 0) {
      HUD.drawLoading(0.08);
      R.present();
      bootStep = 1;
      requestAnimationFrame(boot);
      return;
    }
    if (bootStep === 1) {
      TEX.build();
      R.bindFlats();
      HUD.drawLoading(0.55);
      R.present();
      bootStep = 2;
      requestAnimationFrame(boot);
      return;
    }
    if (bootStep === 2) {
      SPR.build();
      HUD.drawLoading(1);
      R.present();
      bootStep = 3;
      requestAnimationFrame(boot);
      return;
    }

    Game.reset();
    Game.setState('title');
    last = performance.now();
    requestAnimationFrame(frame);
  }

  function frame(now) {
    var dt = (now - last) / 1000;
    last = now;
    if (dt > CFG.DT_CLAMP) dt = CFG.DT_CLAMP;
    if (dt < 0) dt = 0;

    Game.update(dt);
    Game.render();
    R.present();
    Input.endFrame();

    requestAnimationFrame(frame);
  }

  function onClick() {
    Sound.resume();
    var s = Game.getState();
    if (s === 'title') {
      Game.startPlay();
      Input.requestLock();
    } else if (s === 'pause') {
      Game.unpause();
      Input.requestLock();
    } else if (s === 'play') {
      Input.requestLock();
    } else if (s === 'dead' || s === 'win') {
      Game.startPlay();
      Input.requestLock();
    }
  }

  function onLockChange(locked) {
    if (!locked && Game.getState() === 'play') Game.pause();
  }

  window.addEventListener('resize', resize);
  window.addEventListener('DOMContentLoaded', resize);

  R.init(canvas);
  Input.attach(canvas, onLockChange);
  canvas.addEventListener('mousedown', onClick);
  canvas.classList.add('unlocked');
  resize();

  requestAnimationFrame(boot);
})();
