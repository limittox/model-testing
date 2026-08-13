'use strict';
/* ------------------------------------------------------------------
   gl.js — WebGL2 boilerplate: context, shader programs, vertex format,
   meshes and the shadow-map framebuffer.

   Vertex layout (17 floats / 68 bytes), shared by every mesh in the game:
     0 aPos   vec3   position (object space)
     1 aNrm   vec3   normal
     2 aUV    vec2   texture coords (tile freely — array texture REPEATs)
     3 aLayer float  layer index into the procedural texture array
     4 aCol   vec4   rgb tint + emissive amount
     5 aHull  vec3   "inflate" direction for the inked outline pass
     6 aBone  float  which of uBones[] transforms this vertex
------------------------------------------------------------------ */

const VTX_FLOATS = 17;
const VTX_BYTES = VTX_FLOATS * 4;

const GLX = {
  gl: null,
  canvas: null,

  init(canvas) {
    const gl = canvas.getContext('webgl2', {
      antialias: true, alpha: false, depth: true,
      powerPreference: 'high-performance', preserveDrawingBuffer: false
    });
    if (!gl) throw new Error('WebGL2 is required to run SALTGRAVE.\nTry a current Chrome, Edge or Firefox.');
    this.gl = gl; this.canvas = canvas;
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0.07, 0.09, 0.13, 1);
    return gl;
  },

  compile(type, src, tag) {
    const gl = this.gl, s = gl.createShader(type);
    gl.shaderSource(s, src.trim());
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(tag + ' shader:\n' + gl.getShaderInfoLog(s));
    }
    return s;
  },

  program(vsSrc, fsSrc, tag) {
    const gl = this.gl, p = gl.createProgram();
    gl.attachShader(p, this.compile(gl.VERTEX_SHADER, vsSrc, tag + '.vert'));
    gl.attachShader(p, this.compile(gl.FRAGMENT_SHADER, fsSrc, tag + '.frag'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(tag + ' link:\n' + gl.getProgramInfoLog(p));
    }
    // cache every active uniform location up front
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, name);
      if (info.size > 1) {
        for (let k = 0; k < info.size; k++) {
          u[name + '[' + k + ']'] = gl.getUniformLocation(p, name + '[' + k + ']');
        }
      }
    }
    return { prog: p, u };
  },

  /** Upload an interleaved vertex array + index array as a VAO. */
  mesh(verts, idx) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

    const F = gl.FLOAT, S = VTX_BYTES;
    const attrs = [[0, 3, 0], [1, 3, 12], [2, 2, 24], [3, 1, 32], [4, 4, 36], [5, 3, 52], [6, 1, 64]];
    for (const [loc, size, off] of attrs) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, F, false, S, off);
    }
    gl.bindVertexArray(null);
    return { vao, count: idx.length, verts: verts.length / VTX_FLOATS };
  },

  /** Procedural 2D array texture (one 256x256 RGBA layer per material). */
  arrayTexture(layers, size) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, size, size, layers.length, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (let i = 0; i < layers.length; i++) {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1,
        gl.RGBA, gl.UNSIGNED_BYTE, layers[i]);
    }
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) {
      const max = Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT));
      gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, max);
    }
    return tex;
  },

  /** Depth-only framebuffer used for the sun shadow map. */
  shadowTarget(size) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0,
      gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return ok ? { fb, tex, size } : null;
  }
};
