/*
 * main.js — entry point.
 *
 * LOAD ORDER: loaded LAST (needs CONFIG, Framebuffer, Textures, Sprites and
 * Preview). On window load it boots the framebuffer, generates ALL art in code
 * (nothing is fetched from disk or the network), and paints the preview atlas.
 *
 * Phase 1 has NO animation loop, so the atlas must be explicitly repainted
 * after any resize that reallocates the framebuffer.
 */

window.addEventListener('load', function () {
  var game = document.getElementById('game');
  var hud = document.getElementById('hud');

  Framebuffer.init(game, hud);

  // Generate every texture and sprite procedurally, once, at load.
  Textures.build();
  Sprites.build();

  // Blit the generated art into the framebuffer and present it.
  Preview.render();

  window.addEventListener('resize', function () {
    Framebuffer.resize();
    Preview.render();
  });
});
