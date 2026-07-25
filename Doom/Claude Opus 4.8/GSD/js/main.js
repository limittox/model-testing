/*
 * main.js — entry point.
 *
 * LOAD ORDER: loaded LAST (needs CONFIG, Framebuffer, Textures, Sprites, Preview,
 * Level, Player and Game). On window load it boots the framebuffer, generates ALL
 * art in code (nothing is fetched from disk or the network), builds the level,
 * spawns the player, and starts the requestAnimationFrame loop.
 *
 * Phase 2 adds the running loop: Game now owns what is on screen. Preview.render()
 * is no longer the persistent screen — but js/preview.js stays loaded because
 * Preview.blit remains the reference color-keyed blit for Phase 4. The resize
 * handler only resizes the framebuffer; the loop repaints on the very next frame,
 * so no manual repaint is needed any more.
 *
 * PHASE 5 ADDITIONS: the bare Entities.build() call is replaced by Combat.reset()
 * (seed the player's health/armor/ammo from CONFIG), Game.resetStats() (zero the
 * ENEM-05 kill tally) and then Enemies.build().
 * Enemies.build() calls Entities.build() ITSELF and then ADOPTS the enemy
 * billboards it produced, so calling both here would rebuild the list twice for
 * nothing. Weapons.reset() then seeds the weapon state. Everything else about the
 * boot sequence is unchanged.
 */

window.addEventListener('load', function () {
  var game = document.getElementById('game');
  var hud = document.getElementById('hud');

  Framebuffer.init(game, hud);

  // Generate every texture and sprite procedurally, once, at load.
  Textures.build();
  Sprites.build();

  // Build the world, place the player, and register the refocus resync triggers.
  Level.build();
  Player.spawn();

  // Seed the player's combat state, then build the world's entities. Built AFTER
  // Level.build() (needs Level.spawns) and Sprites.build() (needs the sprite
  // atlas). Enemies.build() runs Entities.build() itself and then ADOPTS the
  // enemy billboards it emitted — attaching behaviour to those exact objects
  // rather than appending duplicates — and preallocates the fireball pool.
  // Game.resetStats() zeroes the ENEM-05 kill tally; Enemies.build() then sets
  // Game.totalKills from the enemies it adopted, so the tally is out of the real
  // spawn-derived total from the first frame.
  Combat.reset();
  Game.resetStats();
  Enemies.build();

  // The pickup VIEW is built from the SAME Entities.build() Enemies.build() just
  // ran, adopting the pickup billboards it emitted. It MUST come after
  // Enemies.build(), not before: Entities.build() assigns a FRESH Entities.list, so
  // a view built first would be holding orphans. Enemies.reset() re-runs this pair
  // together for exactly that reason.
  Sound.reset();
  Pickups.build();

  // Seed the weapon state: the shared cooldown, the viewmodel timers and bob
  // phase, and the deterministic pellet-spread stream. Called AFTER Player.spawn()
  // because it seeds the viewmodel's travel tracker from the current pose — a
  // weapon must not snap into a full-amplitude bob on the first frame.
  Weapons.reset();

  // Wire the two seams. Input feeds intent (keyboard + pointer-lock mouse) into
  // Game.step; Game.view feeds the rendered frame into Game.render.
  //
  // PHASE 3 SWAP: the first-person Raycaster is now the default render path. The
  // Phase 2 TopDown view is disabled (TopDown.ENABLED = false) but LEFT LOADED —
  // it stays a debug toggle, not deleted. Flip ENABLED back to true (and point
  // Game.view at TopDown) to bring the top-down map back for debugging.
  Input.attach(game);
  Game.input = Input;
  TopDown.ENABLED = false;
  Game.view = Raycaster;

  // PHASE 4 SPRITE SEAM: the sprite pass runs INSIDE Raycaster.render() (its last
  // statement), after the wall pass fills the z-buffer and before Game.render's
  // single present(). This keeps Game.view === Raycaster and one present per
  // frame while drawing occluded billboards on top of the walls.
  Raycaster.spritePass = Entities.render;

  // PHASE 5 OVERLAY SEAM: the weapon viewmodel is a SCREEN-SPACE overlay, so it
  // runs after every world pass through Raycaster.overlayPasses — still inside the
  // one Raycaster.render() call, still before Game.render's single present(). The
  // array is ordered; plan 05-04 appends the message line AFTER this so text lands
  // on top of the gun.
  // ORDER IS LOAD-BEARING HERE. The array is iterated front to back, so the
  // viewmodel goes down first and the message line lands ON TOP of the gun. Pushing
  // them the other way round would bury the text behind the weapon at exactly the
  // moment it matters — the message is centred in the lower third, which is where
  // the viewmodel lives.
  Raycaster.overlayPasses.push(Weapons.renderViewmodel);
  Raycaster.overlayPasses.push(Game.renderMessage);

  Game.attach();

  // Start the heartbeat. The first frame is a resync frame (dt 0): it skips the
  // step but still renders and presents, so the screen is painted immediately.
  Game.start();

  // The loop repaints every frame, so the resize handler only needs to resize the
  // framebuffer — the next frame paints the new dimensions.
  window.addEventListener('resize', function () {
    Framebuffer.resize();
  });
});
