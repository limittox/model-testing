'use strict';

/* Keyboard state is sampled in update(), never acted on inside the handler.
   event.code is used throughout so non-QWERTY layouts still work. */
var Input = (function () {

  var down = Object.create(null);
  var pressed = Object.create(null);   // edge-triggered, cleared each frame
  var mouseDX = 0, mouseDY = 0;
  var fireHeld = false;
  var firePressed = false;
  var wheel = 0;
  var locked = false;
  var canvas = null;
  var onLockChange = null;

  var PREVENT = {
    ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Space: 1, Tab: 1,
    KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, KeyQ: 1, KeyE: 1, Slash: 1
  };

  function attach(cv, lockChangeCb) {
    canvas = cv;
    onLockChange = lockChangeCb;

    window.addEventListener('keydown', function (e) {
      if (e.repeat) { if (PREVENT[e.code]) e.preventDefault(); return; }
      down[e.code] = true;
      pressed[e.code] = true;
      if (PREVENT[e.code]) e.preventDefault();
    });

    window.addEventListener('keyup', function (e) {
      down[e.code] = false;
      if (PREVENT[e.code]) e.preventDefault();
    });

    window.addEventListener('blur', function () {
      for (var k in down) down[k] = false;
      fireHeld = false;
    });

    canvas.addEventListener('mousedown', function (e) {
      if (e.button === 0) { fireHeld = true; firePressed = true; }
      if (e.button === 2) { pressed.MouseRight = true; }
    });

    window.addEventListener('mouseup', function (e) {
      if (e.button === 0) fireHeld = false;
    });

    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    window.addEventListener('mousemove', function (e) {
      if (!locked) return;
      mouseDX += e.movementX || 0;
      mouseDY += e.movementY || 0;
    });

    canvas.addEventListener('wheel', function (e) {
      wheel += e.deltaY > 0 ? 1 : (e.deltaY < 0 ? -1 : 0);
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('pointerlockchange', function () {
      locked = document.pointerLockElement === canvas;
      canvas.classList.toggle('unlocked', !locked);
      if (onLockChange) onLockChange(locked);
    });

    document.addEventListener('pointerlockerror', function () {
      locked = false;
      if (onLockChange) onLockChange(false);
    });
  }

  function requestLock() {
    if (!canvas || locked) return;
    try {
      // unadjustedMovement gives raw deltas in Chromium; other engines ignore it.
      var p = canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && typeof p.catch === 'function') {
        p.catch(function () { try { canvas.requestPointerLock(); } catch (e) {} });
      }
    } catch (e) {
      try { canvas.requestPointerLock(); } catch (e2) {}
    }
  }

  function exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /* Called once at the end of every frame. */
  function endFrame() {
    for (var k in pressed) pressed[k] = false;
    mouseDX = 0; mouseDY = 0;
    wheel = 0;
    firePressed = false;
  }

  return {
    attach: attach,
    requestLock: requestLock,
    exitLock: exitLock,
    endFrame: endFrame,
    isDown: function (code) { return !!down[code]; },
    wasPressed: function (code) { return !!pressed[code]; },
    anyPressed: function () {
      for (var k in pressed) if (pressed[k]) return true;
      return false;
    },
    mouseDX: function () { return mouseDX; },
    mouseDY: function () { return mouseDY; },
    wheel: function () { return wheel; },
    fireHeld: function () { return fireHeld; },
    firePressed: function () { return firePressed; },
    isLocked: function () { return locked; },
    clearFire: function () { fireHeld = false; }
  };
})();
