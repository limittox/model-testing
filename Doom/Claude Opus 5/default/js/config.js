'use strict';

var CFG = {
  /* Internal framebuffer. Everything -- world, HUD, menus -- is drawn here and
     blitted once per frame; CSS scales it up with nearest-neighbour. */
  W: 480,
  H: 300,
  HUD_H: 46,

  TEX: 64,              // wall / floor texture edge length

  FOV_PLANE: 0.70,      // camera plane half-length -> ~70 degree horizontal FOV
  MAX_LIGHT_DIST: 13,   // distance at which walls fade to black

  MOVE_SPEED: 3.4,      // world units / sec
  RUN_MULT: 1.75,
  TURN_SPEED: 2.6,      // rad / sec for keyboard turning
  MOUSE_SENS: 0.0022,
  PITCH_LIMIT: 70,      // max horizon shear in pixels

  PLAYER_RADIUS: 0.22,
  MAX_PITCH_BOB: 2.2,

  MAX_HEALTH: 100,
  MAX_ARMOR: 100,
  OVERHEAL: 200,

  MAX_BULLETS: 200,
  MAX_SHELLS: 50,

  DT_CLAMP: 0.05
};

CFG.VIEW_H = CFG.H - CFG.HUD_H;
CFG.HALF_VIEW = CFG.VIEW_H / 2;
