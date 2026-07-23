/*
 * main.js — entry point.
 *
 * LOAD ORDER: loaded LAST (needs CONFIG and Framebuffer). On window load it
 * boots the framebuffer and paints the clear color. Phase 1 has NO animation
 * loop, so the color must be explicitly repainted after any resize that
 * reallocates the buffer.
 */

window.addEventListener('load', function () {
  var game = document.getElementById('game');
  var hud = document.getElementById('hud');

  Framebuffer.init(game, hud);
  Framebuffer.clear(CONFIG.CLEAR_COLOR);
  Framebuffer.present();

  window.addEventListener('resize', function () {
    Framebuffer.resize();
    Framebuffer.clear(CONFIG.CLEAR_COLOR);
    Framebuffer.present();
  });
});
