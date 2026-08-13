'use strict';
/* ------------------------------------------------------------------
   renderer.js — the look of the game.

   Passes, in order:
     1. sky        fullscreen gradient (no depth)
     2. shadow     depth-only render of casters from the sun
     3. ink        inverted-hull outline pass (back faces, pushed out)
     4. opaque     toon-banded lighting + PCF shadows + fog
     5. blend      markers, glows, tracers, blood, glass

   Lighting is deliberately quantised into three bands so surfaces read
   as flat blocks of colour with hard shadow terminators — the
   graphic-novel look — rather than smooth shading.
------------------------------------------------------------------ */

const VS_MAIN = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUV;
layout(location=3) in float aLayer;
layout(location=4) in vec4 aCol;
layout(location=5) in vec3 aHull;
layout(location=6) in float aBone;

uniform mat4 uViewProj;
uniform mat4 uBones[8];
uniform float uOutline;

out vec3 vNrm;
out vec2 vUV;
out float vLayer;
out vec4 vCol;
out vec3 vWorld;

uniform vec3 uEyeV;

void main(){
  mat4 M = uBones[int(aBone + 0.5)];
  vec4 wp = M * vec4(aPos, 1.0);
  if (uOutline > 0.0) {
    // widen the hull with distance so the ink line stays a constant
    // thickness on screen instead of thinning out across the district
    float k = length(wp.xyz - uEyeV) * 0.035 + 0.35;
    wp = M * vec4(aPos + aHull * uOutline * k, 1.0);
  }
  vWorld = wp.xyz;
  vNrm = mat3(M) * aNrm;
  vUV = aUV;
  vLayer = aLayer;
  vCol = aCol;
  gl_Position = uViewProj * wp;
}`;

const FS_MAIN = `#version 300 es
precision highp float;
precision highp sampler2DArray;

in vec3 vNrm;
in vec2 vUV;
in float vLayer;
in vec4 vCol;
in vec3 vWorld;

uniform sampler2DArray uTex;
uniform sampler2D uShadowMap;
uniform mat4 uLightVP;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmbTop;
uniform vec3 uAmbBot;
uniform vec3 uFogCol;
uniform vec2 uFogRange;
uniform vec3 uEye;
uniform vec3 uTint;
uniform vec3 uInk;
uniform float uAlpha;
uniform float uEmis;
uniform float uInkMode;
uniform float uShadowOn;
uniform float uShadowTexel;

out vec4 frag;

float shadowAt(vec3 wp, float ndl){
  vec4 lp = uLightVP * vec4(wp, 1.0);
  vec3 pc = lp.xyz / lp.w * 0.5 + 0.5;
  if (pc.x < 0.002 || pc.x > 0.998 || pc.y < 0.002 || pc.y > 0.998 || pc.z > 0.999) return 1.0;
  float bias = max(0.0035 * (1.0 - ndl), 0.0011);
  float sum = 0.0;
  for (int y = -1; y <= 1; y++){
    for (int x = -1; x <= 1; x++){
      float d = texture(uShadowMap, pc.xy + vec2(float(x), float(y)) * uShadowTexel).r;
      sum += (pc.z - bias > d) ? 0.0 : 1.0;
    }
  }
  return sum / 9.0;
}

void main(){
  if (uInkMode > 0.5){
    float d = length(vWorld - uEye);
    float f = clamp((d - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);
    frag = vec4(mix(uInk, uFogCol, f * 0.9), uAlpha);
    return;
  }

  vec4 t = texture(uTex, vec3(vUV, vLayer));
  vec3 base = t.rgb * vCol.rgb * uTint;
  vec3 n = normalize(vNrm);

  float ndl = max(dot(n, uSunDir), 0.0);
  float sh = uShadowOn > 0.5 ? shadowAt(vWorld, ndl) : 1.0;
  float lit = ndl * sh;

  // three flat bands => hard, printed-looking shading
  float band = lit < 0.18 ? 0.06 : (lit < 0.55 ? 0.58 : 1.0);
  band = mix(band, lit, 0.28);

  vec3 amb = mix(uAmbBot, uAmbTop, n.y * 0.5 + 0.5);
  vec3 col = base * (amb + uSunCol * band);

  // a touch of sky bounce on upward faces keeps roofs from going muddy
  col += base * uAmbTop * 0.10 * max(n.y, 0.0);

  float em = max(vCol.a, uEmis);
  col = mix(col, base * 1.55 + vec3(0.06), em);

  float d = length(vWorld - uEye);
  float f = clamp((d - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);
  col = mix(col, uFogCol, f * 0.92);

  frag = vec4(col, uAlpha);
}`;

const FS_DEPTH = `#version 300 es
precision highp float;
out vec4 frag;
void main(){ frag = vec4(1.0); }`;

const VS_SKY = `#version 300 es
precision highp float;
out vec2 vUV;
void main(){
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.999, 1.0);
}`;

const FS_SKY = `#version 300 es
precision highp float;
in vec2 vUV;
uniform vec3 uTop;
uniform vec3 uHaze;
uniform float uTime;
out vec4 frag;
void main(){
  float h = vUV.y;
  vec3 c = mix(uHaze, uTop, pow(clamp(h, 0.0, 1.0), 0.85));
  // lazy smog bands
  float b = sin(vUV.x * 6.0 + uTime * 0.05) * 0.5 + 0.5;
  float band = smoothstep(0.34, 0.62, h) * (1.0 - smoothstep(0.62, 0.92, h));
  c = mix(c, c * 1.10 + vec3(0.05, 0.04, 0.02), band * b * 0.55);
  frag = vec4(c, 1.0);
}`;

const SHADOW_SIZE = 2048;
const SHADOW_EXTENT = 132;   // half-width of the sun's ortho box, in world units

const Renderer = {
  gl: null,
  main: null, depth: null, sky: null,
  tex: null, shadow: null,
  identityBank: null,
  lightVP: M4.create(),
  _lv: M4.create(), _lp: M4.create(),

  sun: [0.44, 0.80, 0.41],
  sunCol: [0.80, 0.74, 0.60],
  ambTop: [0.36, 0.40, 0.52],
  ambBot: [0.17, 0.18, 0.24],
  fogCol: [0.47, 0.53, 0.64],
  fogRange: [80, 225],
  skyTop: [0.24, 0.38, 0.62],
  ink: [0.05, 0.055, 0.075],

  statics: [],       // { mesh, outline }
  queue: [],
  qn: 0,
  blend: [],
  bn: 0,
  time: 0,
  tris: 0,

  init(canvas) {
    const gl = GLX.init(canvas);
    this.gl = gl;
    this.main = GLX.program(VS_MAIN, FS_MAIN, 'main');
    this.depth = GLX.program(VS_MAIN, FS_DEPTH, 'depth');
    this.sky = GLX.program(VS_SKY, FS_SKY, 'sky');

    const layers = Art.build();
    this.tex = GLX.arrayTexture(layers, TEXSIZE);
    this.shadow = GLX.shadowTarget(SHADOW_SIZE);

    // 8 identity matrices — used by any mesh that isn't skinned
    this.identityBank = new Float32Array(8 * 16);
    for (let i = 0; i < 8; i++) M4.identity(this.identityBank.subarray(i * 16, i * 16 + 16));
    this.emptyVAO = gl.createVertexArray();
    return gl;
  },

  resize(w, h) {
    const gl = this.gl;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const W = Math.max(2, Math.round(w * dpr)), H = Math.max(2, Math.round(h * dpr));
    if (gl.canvas.width !== W || gl.canvas.height !== H) {
      gl.canvas.width = W; gl.canvas.height = H;
    }
    Camera.aspect = W / H;
    this.vw = W; this.vh = H;
  },

  /** Register a mesh that never moves. group: 'ground' (no ink) | 'struct' (inked) */
  addStatic(mesh, outline, castsShadow) {
    this.statics.push({ mesh, outline: !!outline, cast: castsShadow !== false });
  },
  clearStatics() { this.statics.length = 0; },

  /* ---- per-frame dynamic submissions ---- */
  reset() { this.qn = 0; this.bn = 0; this.tris = 0; this._poolN = 0; },

  _pool: [], _poolN: 0,
  /** Scratch bone bank for throwaway draws (particles, markers, tracers).
      Draws are deferred to end-of-frame, so each needs its own storage. */
  boneSlot() {
    let a = this._pool[this._poolN];
    if (!a) {
      a = this._pool[this._poolN] = new Float32Array(8 * 16);
      for (let i = 0; i < 8; i++) M4.identity(a.subarray(i * 16, i * 16 + 16));
    }
    this._poolN++;
    return a;
  },

  /** bones: Float32Array(128) owned by the caller. */
  draw(mesh, bones, tint, outline, emis, noShadow) {
    let e = this.queue[this.qn];
    if (!e) e = this.queue[this.qn] = {};
    e.mesh = mesh; e.bones = bones || this.identityBank;
    e.tint = tint || WHITE; e.outline = outline === undefined ? 0.05 : outline;
    e.emis = emis || 0; e.cast = !noShadow;
    this.qn++;
  },

  drawBlend(mesh, bones, tint, alpha, emis, depth) {
    let e = this.blend[this.bn];
    if (!e) e = this.blend[this.bn] = {};
    e.mesh = mesh; e.bones = bones || this.identityBank;
    e.tint = tint || WHITE; e.alpha = alpha; e.emis = emis || 0;
    e.depth = depth || 0;
    this.bn++;
  },

  _bindCommon(p, viewProj) {
    const gl = this.gl, u = p.u;
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(u.uViewProj, false, viewProj);
    if (u.uTex) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
      gl.uniform1i(u.uTex, 0);
    }
    if (u.uShadowMap && this.shadow) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.shadow.tex);
      gl.uniform1i(u.uShadowMap, 1);
      gl.uniform1f(u.uShadowTexel, 1 / SHADOW_SIZE);
      gl.uniformMatrix4fv(u.uLightVP, false, this.lightVP);
      gl.uniform1f(u.uShadowOn, 1);
    } else if (u.uShadowOn) {
      gl.uniform1f(u.uShadowOn, 0);
    }
    if (u.uSunDir) {
      gl.uniform3fv(u.uSunDir, this.sun);
      gl.uniform3fv(u.uSunCol, this.sunCol);
      gl.uniform3fv(u.uAmbTop, this.ambTop);
      gl.uniform3fv(u.uAmbBot, this.ambBot);
      gl.uniform3fv(u.uFogCol, this.fogCol);
      gl.uniform2fv(u.uFogRange, this.fogRange);
      gl.uniform3f(u.uEye, Camera.ex, Camera.ey, Camera.ez);
      gl.uniform3fv(u.uInk, this.ink);
    }
    if (u.uEyeV) gl.uniform3f(u.uEyeV, Camera.ex, Camera.ey, Camera.ez);
  },

  _drawMesh(p, mesh, bones, tint, alpha, emis, outline, inkMode) {
    const gl = this.gl, u = p.u;
    gl.uniformMatrix4fv(u.uBones, false, bones);
    if (u.uTint) gl.uniform3fv(u.uTint, tint);
    if (u.uAlpha) gl.uniform1f(u.uAlpha, alpha);
    if (u.uEmis) gl.uniform1f(u.uEmis, emis);
    if (u.uOutline) gl.uniform1f(u.uOutline, outline);
    if (u.uInkMode) gl.uniform1f(u.uInkMode, inkMode);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
    this.tris += mesh.count / 3;
  },

  _shadowPass(focusX, focusZ) {
    if (!this.shadow) return;
    const gl = this.gl;
    // ortho box centred a bit ahead of the player, snapped to texels so
    // shadow edges don't crawl as the camera moves
    const texel = (SHADOW_EXTENT * 2) / SHADOW_SIZE;
    const cx = Math.round(focusX / texel) * texel;
    const cz = Math.round(focusZ / texel) * texel;
    const d = 190;
    M4.lookAt(this._lv,
      cx + this.sun[0] * d, this.sun[1] * d, cz + this.sun[2] * d,
      cx, 0, cz, 0, 1, 0);
    M4.ortho(this._lp, -SHADOW_EXTENT, SHADOW_EXTENT, -SHADOW_EXTENT, SHADOW_EXTENT, 1, 420);
    M4.multiply(this.lightVP, this._lp, this._lv);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadow.fb);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);   // thin geometry (signs, fences) still casts

    const p = this.depth;
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(p.u.uViewProj, false, this.lightVP);
    gl.uniform1f(p.u.uOutline, 0);
    for (const s of this.statics) {
      if (!s.cast) continue;
      gl.uniformMatrix4fv(p.u.uBones, false, this.identityBank);
      gl.bindVertexArray(s.mesh.vao);
      gl.drawElements(gl.TRIANGLES, s.mesh.count, gl.UNSIGNED_INT, 0);
    }
    for (let i = 0; i < this.qn; i++) {
      const e = this.queue[i];
      if (!e.cast) continue;
      gl.uniformMatrix4fv(p.u.uBones, false, e.bones);
      gl.bindVertexArray(e.mesh.vao);
      gl.drawElements(gl.TRIANGLES, e.mesh.count, gl.UNSIGNED_INT, 0);
    }
    gl.enable(gl.CULL_FACE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },

  render(dt, focusX, focusZ) {
    const gl = this.gl;
    this.time += dt;
    this._shadowPass(focusX, focusZ);

    gl.viewport(0, 0, this.vw, this.vh);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // --- sky ---
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.useProgram(this.sky.prog);
    gl.uniform3fv(this.sky.u.uTop, this.skyTop);
    gl.uniform3fv(this.sky.u.uHaze, this.fogCol);
    gl.uniform1f(this.sky.u.uTime, this.time);
    gl.bindVertexArray(this.emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);

    const p = this.main;
    this._bindCommon(p, Camera.viewProj);

    // --- ink pass: back faces, inflated along the hull normal ---
    gl.cullFace(gl.FRONT);
    for (const s of this.statics) {
      if (!s.outline) continue;
      this._drawMesh(p, s.mesh, this.identityBank, WHITE, 1, 0, 0.13, 1);
    }
    for (let i = 0; i < this.qn; i++) {
      const e = this.queue[i];
      if (e.outline <= 0) continue;
      this._drawMesh(p, e.mesh, e.bones, WHITE, 1, 0, e.outline, 1);
    }
    gl.cullFace(gl.BACK);

    // --- opaque ---
    for (const s of this.statics) {
      this._drawMesh(p, s.mesh, this.identityBank, WHITE, 1, 0, 0, 0);
    }
    for (let i = 0; i < this.qn; i++) {
      const e = this.queue[i];
      this._drawMesh(p, e.mesh, e.bones, e.tint, 1, e.emis, 0, 0);
    }

    // --- blended ---
    if (this.bn) {
      const list = this.blend.slice(0, this.bn);
      list.sort((a, b) => b.depth - a.depth);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);   // markers/rings are single-sided shells
      for (const e of list) {
        this._drawMesh(p, e.mesh, e.bones, e.tint, e.alpha, e.emis, 0, 0);
      }
      gl.enable(gl.CULL_FACE);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  }
};
