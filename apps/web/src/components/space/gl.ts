// Minimal WebGL plumbing shared by the hero, the black hole tile and the
// wormhole: one full-screen triangle and one fragment shader per canvas.

export type Tier = "low" | "high";

export function detectTier(): Tier {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const cores = nav.hardwareConcurrency ?? 4;
  const mem = nav.deviceMemory ?? 8;
  return coarse || cores <= 4 || mem <= 4 ? "low" : "high";
}

const VERTEX = /* glsl */ `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export interface Surface {
  gl: WebGLRenderingContext;
  uniform(name: string): WebGLUniformLocation | null;
  /** Match the drawing buffer to the canvas' CSS size times `scale`. */
  resize(scale: number): { w: number; h: number; cssW: number; cssH: number };
  draw(): void;
  dispose(): void;
}

export function createSurface(
  canvas: HTMLCanvasElement,
  fragment: string,
  opts: { transparent?: boolean; tier: Tier },
): Surface | null {
  const gl = canvas.getContext("webgl", {
    alpha: !!opts.transparent,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: opts.tier === "high" ? "high-performance" : "default",
  });
  if (!gl) return null;
  // Needed for screen-space derivatives in the star field.
  if (!gl.getExtension("OES_standard_derivatives")) return null;

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl.FRAGMENT_SHADER, fragment);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(prog));
    return null;
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const cache = new Map<string, WebGLUniformLocation | null>();
  const uniform = (name: string) => {
    if (!cache.has(name)) cache.set(name, gl.getUniformLocation(prog, name));
    return cache.get(name) ?? null;
  };

  const resize = (scale: number) => {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * scale));
    const h = Math.max(1, Math.round(rect.height * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uniform("uRes"), w, h);
    return { w, h, cssW: rect.width, cssH: rect.height };
  };

  return {
    gl,
    uniform,
    resize,
    draw: () => gl.drawArrays(gl.TRIANGLES, 0, 3),
    dispose: () => {
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    },
  };
}

// Shared GLSL: hashing, value noise, an approximate blackbody ramp, erf and an
// anti-aliased star field on a cube-mapped grid (stars never straddle cells, so
// they stay round instead of being clipped into slivers).
export const GLSL_COMMON = /* glsl */ `
const float PI = 3.14159265;
const float TAU = 6.28318531;

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}

float fbm(vec3 p) {
  return noise(p) * 0.5 + noise(p * 2.03 + 1.7) * 0.3 + noise(p * 4.01 + 4.1) * 0.2;
}

// t ~ 1 is warm gold, higher runs to white and then blue-white.
vec3 blackbody(float t) {
  t = max(t, 0.0);
  vec3 c = vec3(1.0, 0.28, 0.04);
  c = mix(c, vec3(1.0, 0.62, 0.24), smoothstep(0.30, 0.90, t));
  c = mix(c, vec3(1.0, 0.88, 0.70), smoothstep(0.90, 1.55, t));
  c = mix(c, vec3(0.80, 0.87, 1.0), smoothstep(1.80, 2.90, t));
  return c * smoothstep(0.0, 0.32, t);
}

float erf(float x) {
  float s = sign(x);
  x = abs(x);
  float t = 1.0 / (1.0 + 0.47047 * x);
  return s * (1.0 - t * (0.3480242 + t * (-0.0958798 + t * 0.7478556)) * exp(-x * x));
}

// Stars are point sources. Each is drawn as a round blob about a pixel wide
// in screen space, found by mapping its sky offset back through the inverse
// of the screen to sky Jacobian (from derivatives of the traced direction).
// Lensing therefore moves and brightens stars (flux scales with the
// magnification) without smearing them, the way a real camera sees them.
vec3 starLayer(vec2 f, vec2 fx, vec2 fy, float face, float n, float density, float seed) {
  vec2 g = f * n;
  vec2 id = floor(g);
  float h = hash13(vec3(id, face * 13.0 + seed));
  if (h < 1.0 - density) return vec3(0.0);
  vec2 o = 0.3 + 0.4 * vec2(hash13(vec3(id, seed + 1.3)), hash13(vec3(id, seed + 2.9)));
  vec2 dd = (id + o - g) / n;
  float det = fx.x * fy.y - fy.x * fx.y;
  if (abs(det) < 1e-14) return vec3(0.0);
  vec2 sp = vec2(dd.x * fy.y - dd.y * fy.x, fx.x * dd.y - fx.y * dd.x) / det;
  // A pixel that spans a good part of a cell would only alias; fade those out.
  float foot = sqrt(abs(det)) * n;
  float b = (h - (1.0 - density)) / density;
  vec3 tint = mix(vec3(0.66, 0.78, 1.0), vec3(1.0, 0.84, 0.66), hash13(vec3(id, seed + 7.7)));
  return tint * b * b * exp(-dot(sp, sp) / (0.55 + 0.5 * b)) * smoothstep(0.3, 0.12, foot);
}

vec2 faceDeriv(vec3 d, vec3 dd, float m) {
  if (m == 0.0) return (dd.yz - (d.yz / d.x) * dd.x) / abs(d.x);
  if (m == 1.0) return (dd.xz - (d.xz / d.y) * dd.y) / abs(d.y);
  return (dd.xy - (d.xy / d.z) * dd.z) / abs(d.z);
}

// px = unlensed pixel angle, so brightness can follow the magnification.
vec3 starfield(vec3 d, vec3 ddx, vec3 ddy, float px, float density) {
  vec3 a = abs(d);
  vec2 f;
  float face;
  float m;
  if (a.x > a.y && a.x > a.z) { f = d.yz / a.x; face = d.x > 0.0 ? 0.0 : 1.0; m = 0.0; }
  else if (a.y > a.z) { f = d.xz / a.y; face = d.y > 0.0 ? 2.0 : 3.0; m = 1.0; }
  else { f = d.xy / a.z; face = d.z > 0.0 ? 4.0 : 5.0; m = 2.0; }
  vec2 fx = faceDeriv(d, ddx, m);
  vec2 fy = faceDeriv(d, ddy, m);
  float mag = px * px / max(length(cross(ddx, ddy)), 1e-12);
  float boost = clamp(sqrt(mag), 0.35, 3.0);
  return (starLayer(f, fx, fy, face, 90.0, 0.10 * density, 0.0) * 0.9
        + starLayer(f, fx, fy, face, 34.0, 0.10 * density, 5.0) * 2.0) * boost;
}

vec3 tonemap(vec3 c) {
  c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
  return pow(clamp(c, 0.0, 1.0), vec3(0.4545));
}
`;
