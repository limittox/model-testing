/*
 * tools/boot.cjs — the reusable headless harness bootstrap.
 *
 * NODE-ONLY. Nothing under tools/ is ever referenced by index.html, so the
 * browser never loads any of it. The `.cjs` extension makes the Node-side
 * intent unambiguous and keeps the browser-loaded surface (index.html,
 * style.css, js/) free of any module-loader construct.
 *
 * WHY THIS EXISTS: every Phase 2 harness must exercise the SHIPPED game files in
 * the SHIPPED order. boot() reads index.html, extracts its real ordered list of
 * classic <script src> paths, and evaluates those exact files inside one shared
 * vm context with a stubbed DOM. A harness therefore verifies the load-order
 * contract itself rather than a hand-written approximation of it.
 *
 * WHAT IS DETERMINISTIC HERE (and why it matters):
 *   - requestAnimationFrame is a MANUAL scheduler, not a timer. Queued callbacks
 *     are held until the harness calls raf.step(deltaMs) / raf.run(n, deltaMs),
 *     which advance a virtual clock. That is what lets a harness manufacture an
 *     arbitrarily large frame delta (e.g. a 2-second tab-refocus hitch) and
 *     assert the delta-time clamp survived it.
 *   - performance.now() reads the same virtual clock, so game code sees a
 *     consistent timeline.
 *   - document.visibilityState / .hidden are settable as a consistent pair via
 *     setVisibility(), which also dispatches 'visibilitychange' — the exact
 *     signal a pause-on-blur handler listens for.
 *   - document.pointerLockElement is settable via setPointerLockElement(), and
 *     canvas.requestPointerLock() records its call and its options.
 *
 * EXPORTS: boot(options), assert(condition, label), finish(token),
 *          failures(), GAME_DIR.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// The game directory is the parent of tools/.
const GAME_DIR = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Assertion bookkeeping (shared by every harness that requires this module).
// ---------------------------------------------------------------------------
let _total = 0;
let _failed = 0;

function assert(condition, label) {
  _total += 1;
  if (condition) {
    console.log('PASS: ' + label);
    return true;
  }
  _failed += 1;
  console.log('FAIL: ' + label);
  return false;
}

function failures() {
  return _failed;
}

// Print the all-pass token ONLY when every assertion passed; otherwise exit
// non-zero so a `&&` chain in a verification command fails loudly.
function finish(token) {
  console.log('');
  console.log((_total - _failed) + '/' + _total + ' assertions passed');
  if (_failed === 0) {
    console.log(token);
    return true;
  }
  console.log(_failed + ' FAILING ASSERTION(S)');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// index.html script extraction — the SHIPPED load order.
// ---------------------------------------------------------------------------
// Deliberately narrow: it only matches a real <script ... src="..."> element, so
// the prose inside index.html's contract comment (which mentions the file names
// and the phrase "<script src>") can never be mistaken for a tag.
function readScriptOrder(html) {
  const order = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*"([^"]+)"[^>]*>\s*<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) order.push(m[1]);
  return order;
}

// Every src=/href= reference in index.html, used by the self-containment gate.
function readResourceRefs(html) {
  const refs = [];
  const re = /\b(?:src|href)\s*=\s*"([^"]+)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) refs.push(m[1]);
  return refs;
}

// ---------------------------------------------------------------------------
// DOM stubs
// ---------------------------------------------------------------------------
function makeHandlerBag() {
  const bag = Object.create(null);
  return {
    map: bag,
    add(type, fn) {
      if (!bag[type]) bag[type] = [];
      bag[type].push(fn);
    },
    remove(type, fn) {
      if (!bag[type]) return;
      bag[type] = bag[type].filter((h) => h !== fn);
    },
    fire(type, ev) {
      const list = bag[type] || [];
      for (let i = 0; i < list.length; i++) list[i].call(null, ev);
      return list.length;
    },
    count(type) {
      return (bag[type] || []).length;
    }
  };
}

function makeContext2D(state) {
  const noop = function () {};
  return {
    // The only two calls the framebuffer actually depends on.
    createImageData(w, h) {
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    },
    putImageData(img, dx, dy) {
      state.putCount += 1;
      state.lastImageData = img;
      state.lastPutAt = { x: dx, y: dy };
    },
    getImageData(x, y, w, h) {
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    },
    // No-op drawing surface so HUD/debug code can run without special-casing.
    imageSmoothingEnabled: false,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '10px monospace',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    clearRect: noop,
    fillRect: noop,
    strokeRect: noop,
    drawImage: noop,
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    rect: noop,
    fill: noop,
    stroke: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    setTransform: noop,
    resetTransform: noop,
    fillText: noop,
    strokeText: noop,
    measureText() { return { width: 0 }; }
  };
}

function makeCanvasStub(id, state) {
  const handlers = makeHandlerBag();
  const canvas = {
    id: id,
    nodeName: 'CANVAS',
    tagName: 'CANVAS',
    width: 0,
    height: 0,
    style: {},
    handlers: handlers,
    pointerLockCalls: 0,
    lastPointerLockOptions: null,
    getContext(kind) {
      if (kind !== '2d') return null;
      if (!canvas._ctx) canvas._ctx = makeContext2D(state);
      return canvas._ctx;
    },
    requestPointerLock(options) {
      canvas.pointerLockCalls += 1;
      canvas.lastPointerLockOptions = options === undefined ? null : options;
      state.pointerLockRequests.push({ id: id, options: canvas.lastPointerLockOptions });
      return Promise.resolve();
    },
    addEventListener(type, fn) { handlers.add(type, fn); },
    removeEventListener(type, fn) { handlers.remove(type, fn); },
    dispatchEvent(ev) { handlers.fire(ev && ev.type, ev); return true; },
    getBoundingClientRect() {
      return {
        left: 0, top: 0, right: canvas.width, bottom: canvas.height,
        width: canvas.width, height: canvas.height, x: 0, y: 0
      };
    },
    focus() {},
    setAttribute() {},
    appendChild() {}
  };
  return canvas;
}

// ---------------------------------------------------------------------------
// The manual animation-frame scheduler.
// ---------------------------------------------------------------------------
function makeRaf() {
  const raf = {
    time: 0,          // virtual clock, milliseconds
    nextId: 1,
    queue: [],        // [{id, cb}] — callbacks awaiting the next step
    frames: 0,

    request(cb) {
      const id = raf.nextId++;
      raf.queue.push({ id: id, cb: cb });
      return id;
    },
    cancel(id) {
      raf.queue = raf.queue.filter((e) => e.id !== id);
    },
    pending() {
      return raf.queue.length;
    },
    // Advance the virtual clock by deltaMs and run whatever was queued when the
    // step began. Callbacks that re-queue (the normal game-loop shape) land in
    // the NEXT step, exactly like a real browser.
    step(deltaMs) {
      const d = (deltaMs === undefined) ? 1000 / 60 : deltaMs;
      raf.time += d;
      raf.frames += 1;
      const due = raf.queue;
      raf.queue = [];
      for (let i = 0; i < due.length; i++) due[i].cb(raf.time);
      return raf.time;
    },
    run(frames, deltaMs) {
      for (let i = 0; i < frames; i++) raf.step(deltaMs);
      return raf.time;
    },
    reset() {
      raf.time = 0;
      raf.queue = [];
      raf.frames = 0;
    }
  };
  return raf;
}

// ---------------------------------------------------------------------------
// boot(options)
//
//   options.dir         — game directory (default: the parent of tools/)
//   options.only        — array of script basenames ('config', 'level.js', ...)
//                         to load a SUBSET of the shipped order
//   options.innerWidth  — window.innerWidth  (default 1280)
//   options.innerHeight — window.innerHeight (default 720)
// ---------------------------------------------------------------------------
function boot(options) {
  const opts = options || {};
  const dir = opts.dir || GAME_DIR;
  const htmlPath = path.join(dir, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  const scriptOrder = readScriptOrder(html);
  const resourceRefs = readResourceRefs(html);

  // Subset selection by basename, with or without the .js extension.
  let files = scriptOrder;
  if (Array.isArray(opts.only)) {
    const wanted = opts.only.map((n) => String(n).replace(/\.js$/i, ''));
    files = scriptOrder.filter(
      (src) => wanted.indexOf(path.basename(src).replace(/\.js$/i, '')) >= 0
    );
  }

  const state = {
    putCount: 0,
    lastImageData: null,
    lastPutAt: null,
    pointerLockRequests: []
  };

  const raf = makeRaf();
  const winHandlers = makeHandlerBag();
  const docHandlers = makeHandlerBag();

  const canvases = Object.create(null);
  canvases.game = makeCanvasStub('game', state);
  canvases.hud = makeCanvasStub('hud', state);

  const doc = {
    nodeName: '#document',
    handlers: docHandlers,
    pointerLockElement: null,
    visibilityState: 'visible',
    hidden: false,
    body: { appendChild() {}, style: {} },
    documentElement: { style: {} },
    getElementById(id) {
      if (!canvases[id]) canvases[id] = makeCanvasStub(id, state);
      return canvases[id];
    },
    querySelector(sel) {
      return doc.getElementById(String(sel).replace(/^#/, ''));
    },
    createElement(tag) {
      return makeCanvasStub(String(tag).toLowerCase(), state);
    },
    addEventListener(type, fn) { docHandlers.add(type, fn); },
    removeEventListener(type, fn) { docHandlers.remove(type, fn); },
    dispatchEvent(ev) { docHandlers.fire(ev && ev.type, ev); return true; },
    exitPointerLock() {
      doc.pointerLockElement = null;
      docHandlers.fire('pointerlockchange', { type: 'pointerlockchange' });
    }
  };

  // The sandbox IS the window: top-level `var` declarations in the game files
  // become properties of it, and window.X resolves to the same object.
  const sandbox = {};
  sandbox.console = console;
  sandbox.document = doc;
  sandbox.innerWidth = (opts.innerWidth === undefined) ? 1280 : opts.innerWidth;
  sandbox.innerHeight = (opts.innerHeight === undefined) ? 720 : opts.innerHeight;
  sandbox.devicePixelRatio = 1;
  sandbox.addEventListener = function (type, fn) { winHandlers.add(type, fn); };
  sandbox.removeEventListener = function (type, fn) { winHandlers.remove(type, fn); };
  sandbox.dispatchEvent = function (ev) { winHandlers.fire(ev && ev.type, ev); return true; };
  sandbox.performance = { now: function () { return raf.time; } };
  sandbox.requestAnimationFrame = function (cb) { return raf.request(cb); };
  sandbox.cancelAnimationFrame = function (id) { return raf.cancel(id); };
  // Manual timers too, so nothing escapes the virtual clock.
  const timers = [];
  sandbox.setTimeout = function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; };
  sandbox.clearTimeout = function () {};
  sandbox.setInterval = function (fn, ms) { timers.push({ fn: fn, ms: ms, repeat: true }); return timers.length; };
  sandbox.clearInterval = function () {};
  sandbox.alert = function () {};

  vm.createContext(sandbox);
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;

  // Evaluate the real files, in the shipped order, in the shared context.
  const loaded = [];
  for (let i = 0; i < files.length; i++) {
    const rel = files[i];
    const abs = path.join(dir, rel);
    const code = fs.readFileSync(abs, 'utf8');
    vm.runInContext(code, sandbox, { filename: rel });
    loaded.push(rel);
  }

  return {
    dir: dir,
    html: html,
    htmlPath: htmlPath,
    scriptOrder: scriptOrder,     // the SHIPPED order, unfiltered
    resourceRefs: resourceRefs,   // every src=/href= in index.html
    loaded: loaded,               // what this boot actually evaluated
    sandbox: sandbox,
    window: sandbox,
    document: doc,
    raf: raf,
    timers: timers,
    state: state,

    canvas(id) { return doc.getElementById(id); },
    putCount() { return state.putCount; },
    lastImageData() { return state.lastImageData; },
    pointerLockRequests() { return state.pointerLockRequests; },

    // Fire the recorded window 'load' handlers — how a harness boots main.js.
    fireLoad() {
      return winHandlers.fire('load', { type: 'load' });
    },

    // Invoke the recorded handlers for a type on either the window or document.
    // target: 'window' | 'document' | 'game' | 'hud' (any canvas id).
    dispatch(target, type, eventObject) {
      const ev = Object.assign({ type: type, preventDefault() {}, stopPropagation() {} },
        eventObject || {});
      if (target === 'window' || target === sandbox) return winHandlers.fire(type, ev);
      if (target === 'document' || target === doc) return docHandlers.fire(type, ev);
      const el = (typeof target === 'string') ? doc.getElementById(target) : target;
      if (el && el.handlers) return el.handlers.fire(type, ev);
      return 0;
    },

    handlerCount(target, type) {
      if (target === 'window') return winHandlers.count(type);
      if (target === 'document') return docHandlers.count(type);
      const el = doc.getElementById(target);
      return el && el.handlers ? el.handlers.count(type) : 0;
    },

    // Simulate the pointer lock engaging or releasing, dispatching the change
    // event the game listens for.
    setPointerLockElement(el) {
      doc.pointerLockElement = (typeof el === 'string') ? doc.getElementById(el) : el;
      docHandlers.fire('pointerlockchange', { type: 'pointerlockchange' });
      return doc.pointerLockElement;
    },

    // Simulate the tab going away and coming back. Keeps visibilityState and
    // hidden consistent and dispatches 'visibilitychange' in one call.
    setVisibility(stateName) {
      doc.visibilityState = stateName;
      doc.hidden = (stateName !== 'visible');
      docHandlers.fire('visibilitychange', { type: 'visibilitychange' });
      return doc.visibilityState;
    },

    resize(w, h) {
      sandbox.innerWidth = w;
      sandbox.innerHeight = h;
      return winHandlers.fire('resize', { type: 'resize' });
    }
  };
}

module.exports = {
  boot: boot,
  assert: assert,
  finish: finish,
  failures: failures,
  readScriptOrder: readScriptOrder,
  readResourceRefs: readResourceRefs,
  GAME_DIR: GAME_DIR
};
