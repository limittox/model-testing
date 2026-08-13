'use strict';
/* ------------------------------------------------------------------
   input.js — physical-key state map + mouse. Handlers never touch game
   state; the update step samples this every frame.
------------------------------------------------------------------ */

const Input = {
  down: Object.create(null),
  pressed: Object.create(null),   // edge-triggered, cleared each frame
  mx: 0, my: 0,
  mouseDown: false,
  mouseClicked: false,
  wheel: 0,
  enabled: true,

  attach(el) {
    const BLOCK = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown',
      'ArrowLeft', 'ArrowRight', 'KeyE', 'KeyQ', 'KeyF', 'Tab', 'KeyM', 'KeyH', 'KeyR']);

    addEventListener('keydown', (ev) => {
      if (BLOCK.has(ev.code)) ev.preventDefault();
      if (!this.enabled) return;
      if (!this.down[ev.code]) this.pressed[ev.code] = true;
      this.down[ev.code] = true;
    });
    addEventListener('keyup', (ev) => { this.down[ev.code] = false; });
    addEventListener('blur', () => { this.down = Object.create(null); this.mouseDown = false; });

    el.addEventListener('mousemove', (ev) => {
      const r = el.getBoundingClientRect();
      this.mx = ev.clientX - r.left;
      this.my = ev.clientY - r.top;
    });
    el.addEventListener('mousedown', (ev) => {
      if (ev.button === 0) { this.mouseDown = true; this.mouseClicked = true; }
      ev.preventDefault();
    });
    addEventListener('mouseup', (ev) => { if (ev.button === 0) this.mouseDown = false; });
    el.addEventListener('contextmenu', (ev) => ev.preventDefault());
    el.addEventListener('wheel', (ev) => { this.wheel += Math.sign(ev.deltaY); ev.preventDefault(); }, { passive: false });
  },

  key(c) { return !!this.down[c]; },
  hit(c) { return !!this.pressed[c]; },

  /** -1..1 raw movement intent in screen space */
  axisX() { return (this.key('KeyD') || this.key('ArrowRight') ? 1 : 0) - (this.key('KeyA') || this.key('ArrowLeft') ? 1 : 0); },
  axisY() { return (this.key('KeyW') || this.key('ArrowUp') ? 1 : 0) - (this.key('KeyS') || this.key('ArrowDown') ? 1 : 0); },

  endFrame() {
    this.pressed = Object.create(null);
    this.mouseClicked = false;
    this.wheel = 0;
  }
};
