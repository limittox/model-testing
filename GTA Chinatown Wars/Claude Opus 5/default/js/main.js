'use strict';
/* ------------------------------------------------------------------
   main.js — boot, resize, the frame loop, and top-level key handling.
------------------------------------------------------------------ */

(function () {
  const sceneCv = document.getElementById('scene');
  const hudCv = document.getElementById('hud');
  const bootEl = document.getElementById('boot');
  const bootBar = document.querySelector('#bootbar i');
  const bootMsg = document.getElementById('bootmsg');
  const titleEl = document.getElementById('title');
  const playBtn = document.getElementById('playbtn');
  const oops = document.getElementById('oops');

  let started = false, last = 0, acc = 0;

  function fail(err) {
    console.error(err);
    oops.classList.remove('hidden');
    oops.firstElementChild.textContent =
      'SALTGRAVE could not start.\n\n' + (err && err.stack ? err.stack : err);
    bootEl.classList.add('hidden');
    titleEl.classList.add('hidden');
  }

  function resize() {
    const w = innerWidth, h = innerHeight;
    Renderer.resize(w, h);
    Hud.resize(w, h);
  }

  const steps = [
    ['drawing the textures', () => Renderer.init(sceneCv)],
    ['pouring the streets', () => Game.init()],
    ['hiring the extras', () => { Hud.init(hudCv); resize(); }]
  ];

  function boot(i) {
    if (i >= steps.length) {
      bootEl.classList.add('hidden');
      titleEl.classList.remove('hidden');
      return;
    }
    const [msg, fn] = steps[i];
    bootMsg.textContent = msg + '…';
    bootBar.style.width = Math.round((i / steps.length) * 100) + '%';
    // setTimeout, not rAF: boot must complete even in a background tab
    setTimeout(() => {
      try { fn(); } catch (e) { fail(e); return; }
      boot(i + 1);
    }, 24);
  }

  function start() {
    if (started) return;
    started = true;
    titleEl.classList.add('hidden');
    Sound.init();
    Sound.resume();
    Input.attach(hudCv.parentElement);
    last = performance.now();
    requestAnimationFrame(frame);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 0.016;
    tick(Math.min(dt, 0.05));
  }

  function tick(dt) {
    try {
      // ---- global keys ----
      if (Input.hit('KeyP')) Game.paused = !Game.paused;
      if (Input.hit('KeyM')) { Hud.showMap = !Hud.showMap; Hud.showHelp = false; }
      if (Input.hit('F1') || (Input.hit('KeyH') && !Player.inCar)) Hud.showHelp = !Hud.showHelp;
      if (Input.hit('KeyN')) { Sound.setMuted(!Sound.muted); Hud.toast(Sound.muted ? 'SOUND OFF' : 'SOUND ON', '#8fc9d8'); }
      if (Input.hit('KeyC')) {
        Camera.mode = Camera.mode === 'chase' ? 'north' : 'chase';
        Hud.toast(Camera.mode === 'chase' ? 'CHASE CAM' : 'NORTH-UP CAM', '#8fc9d8');
      }

      const frozen = Game.paused || Hud.showMap || Hud.showHelp;
      if (!frozen) {
        Game.update(dt);
        Camera.update(dt, {
          x: Player.x, y: Player.y, z: Player.z,
          yaw: Player.inCar ? Player.inCar.yaw : Player.yaw,
          speed: Player.inCar ? Player.inCar.speed : 0,
          inCar: !!Player.inCar
        });
      }

      Renderer.reset();
      Game.submit();
      Renderer.render(frozen ? 0 : dt, Camera.tx, Camera.tz);
      Hud.draw(dt);
    } catch (e) {
      fail(e);
      throw e;
    }
    Input.endFrame();
  }

  /* Debug harness: lets the game be stepped and captured without a
     compositing window (rAF is throttled in hidden tabs). */
  window.SG = {
    start, resize, tick,
    step(n, dt) { for (let i = 0; i < (n || 1); i++) tick(dt || 1 / 60); },
    /** render one frame and return it as a jpeg data url */
    grab(w) {
      tick(1 / 60);
      const gl = Renderer.gl;
      const W = gl.canvas.width, H = gl.canvas.height;
      const px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const flip = document.createElement('canvas');
      flip.width = W; flip.height = H;
      const fg = flip.getContext('2d');
      const img = fg.createImageData(W, H);
      for (let y = 0; y < H; y++) {
        const src = (H - 1 - y) * W * 4, dst = y * W * 4;
        img.data.set(px.subarray(src, src + W * 4), dst);
      }
      fg.putImageData(img, 0, 0);
      fg.drawImage(hudCv, 0, 0, W, H);
      const outW = w || 960, outH = Math.round(outW * H / W);
      const out = document.createElement('canvas');
      out.width = outW; out.height = outH;
      out.getContext('2d').drawImage(flip, 0, 0, outW, outH);
      return out.toDataURL('image/jpeg', 0.72);
    },
    shot(name, w) {
      return fetch('http://localhost:8093/shot?name=' + encodeURIComponent(name || 'frame'), {
        method: 'POST', body: this.grab(w)
      }).then(r => r.text());
    }
  };

  addEventListener('resize', () => { if (Renderer.gl) resize(); });
  playBtn.addEventListener('click', start);
  addEventListener('keydown', (e) => {
    if (!started && (e.code === 'Enter' || e.code === 'Space')) start();
  });
  window.addEventListener('error', (e) => fail(e.error || e.message));

  boot(0);
})();
