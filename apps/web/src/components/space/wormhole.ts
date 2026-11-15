import { createSurface, GLSL_COMMON, type Tier } from "./gl";
import cast from "./wormhole-cast.webp";

// Ellis wormhole, ray traced per pixel. It is the router in the flow diagram:
// the issue arrives along the gold line on our side, and the throat opens onto
// a second sky. An agentcall character sits in the throat; to hand over to
// the next one it is twisted into a spiral and swallowed by the centre, a
// small burst of light goes off, and the next one unwinds out of it.
//
// Metric: ds² = -dt² + dl² + (b² + l²) dΩ², throat radius b = 1. The proper
// radial distance l runs from +∞ (our universe) through the throat at l = 0 to
// -∞ (the other universe). Areal radius r = √(b² + l²).
//
// A ray lives in a plane with conserved h = r²·dφ/dλ, and
//     d²l/dλ² = h²·l / r⁴,   dφ/dλ = h / r².
// Rays with h < b cross the throat. The Einstein ring of our sky around the
// rim comes out of this integration.
//
// Cast atlas: 4 cells across. Top half is color on black, bottom half the
// matching silhouette mask. Color outside the mask is glow and is added.

const SHADER = /* glsl */ `#extension GL_OES_standard_derivatives : enable
precision highp float;

uniform vec2 uRes;
uniform float uTime;
uniform float uCamL;
uniform float uFov;
uniform sampler2D uCast;
uniform float uSize;   // character half size, screen units
uniform vec3 uOut;     // outgoing: cell, twist 0..1, visible 0/1
uniform vec3 uIn;      // incoming: cell, twist 0..1, visible 0/1
uniform float uBurst;  // light burst at the hand-over, 0..1

${GLSL_COMMON}

float gPx;

// The far side: a cool nebula and its stars.
vec3 farSky(vec3 d, vec3 ddx, vec3 ddy) {
  float n = fbm(d * 2.2 + 3.0);
  float m = fbm(d * 4.5 - 7.0);
  vec3 c = vec3(0.012, 0.016, 0.035);
  c += vec3(0.10, 0.06, 0.16) * smoothstep(0.45, 0.85, n) * 0.5;
  c += vec3(0.03, 0.10, 0.14) * smoothstep(0.6, 0.9, m) * 0.35;
  c += starfield(d, ddx, ddy, gPx, 1.6);
  return c;
}

// Our side: sparse warm stars and a thin gold lane along the flow line, which
// the throat wraps into a ring.
vec3 nearSky(vec3 d, vec3 ddx, vec3 ddy) {
  float lane = exp(-d.y * d.y * 1400.0) * (0.7 + 0.3 * fbm(d * 9.0 + uTime * 0.05));
  vec3 c = vec3(1.0, 0.72, 0.36) * lane * 0.8;
  c += vec3(0.6, 0.36, 0.14) * exp(-d.y * d.y * 60.0) * 0.035;
  c += starfield(d, ddx, ddy, gPx, 0.8) * 0.7;
  return c;
}

// Composite one character at screen position p (character spans -0.5..0.5).
// Twist w winds it into a spiral that tightens toward the centre and pulls it
// inward until it vanishes. Sampled on every pixel so texture derivatives stay
// defined; \`on\` only masks the result.
vec3 overCast(vec3 col, float cell, vec2 p, float w, float on) {
  float r = length(p);
  float ang = w * 10.0 * (1.0 - smoothstep(0.0, 0.8, r)) + w * 2.0;
  float cs = cos(ang);
  float sn = sin(ang);
  p = mat2(cs, sn, -sn, cs) * p * (1.0 + 9.0 * w * w);
  vec2 cuv = p + 0.5;
  vec2 q = clamp(cuv, 0.004, 0.996);
  vec3 c = texture2D(uCast, vec2((cell + q.x) * 0.25, 0.5 + q.y * 0.5)).rgb;
  float m = texture2D(uCast, vec2((cell + q.x) * 0.25, q.y * 0.5)).r;
  bool inside = all(greaterThanEqual(cuv, vec2(0.0))) && all(lessThanEqual(cuv, vec2(1.0)));
  // Only the last sliver fades, once it is already a speck.
  float k = inside ? on * (1.0 - smoothstep(0.85, 1.0, w)) : 0.0;
  return col * (1.0 - m * k) + c * k;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y);
  gPx = uFov / min(uRes.x, uRes.y);
  // Camera on the -z axis of our side, looking at the throat.
  vec3 rd = normalize(vec3(uFov * uv, 1.0));
  vec3 e1 = vec3(0.0, 0.0, -1.0);
  float sp = length(rd.xy);
  vec3 e2 = sp > 1e-6 ? vec3(rd.xy / sp, 0.0) : vec3(1.0, 0.0, 0.0);

  float l = uCamL;
  float r0 = sqrt(1.0 + l * l);
  float h = r0 * sp;
  float pl = -rd.z;     // dl/dλ, inward
  float phi = 0.0;

  for (int i = 0; i < 96; i++) {
    float r2 = 1.0 + l * l;
    float dl = 0.06 * max(sqrt(r2) - 0.6, 0.25);
    // Midpoint step; the potential is smooth so this is plenty.
    float a1 = h * h * l / (r2 * r2);
    float lm = l + 0.5 * dl * pl;
    float pm = pl + 0.5 * dl * a1;
    float rm2 = 1.0 + lm * lm;
    phi += dl * h / rm2;
    pl += dl * h * h * lm / (rm2 * rm2);
    l += dl * pm;
    if (abs(l) > uCamL * 2.4 && l * pl > 0.0) break;
  }

  float r = sqrt(1.0 + l * l);
  // Exit direction: radial part points outward in whichever universe we are.
  vec3 er = cos(phi) * e1 + sin(phi) * e2;
  vec3 ep = -sin(phi) * e1 + cos(phi) * e2;
  float rad = l > 0.0 ? pl : -pl;
  vec3 dir = normalize(rad * er + (h / r) * ep);

  vec3 ddx = dFdx(dir);
  vec3 ddy = dFdy(dir);
  vec3 col = l < 0.0 ? farSky(dir, ddx, ddy) : nearSky(dir, ddx, ddy);
  // A faint warm rim where light skims the throat.
  col += vec3(1.0, 0.7, 0.35) * exp(-abs(h - 1.0) * 26.0) * 0.12;
  col = tonemap(col * 1.15);

  // Characters are display-referred art, so they composite after tone mapping.
  vec2 cp = uv / (2.0 * uSize);
  col = overCast(col, uOut.x, cp, uOut.y, uOut.z);
  col = overCast(col, uIn.x, cp, uIn.y, uIn.z);
  float rr = dot(cp, cp);
  col += vec3(1.0, 0.78, 0.45) * uBurst * (exp(-rr * 90.0) * 1.2 + exp(-rr * 9.0) * 0.25);

  vec2 q = (gl_FragCoord.xy - 0.5 * uRes) / (0.5 * uRes);
  float alpha = 1.0 - smoothstep(0.62, 1.0, length(q));
  col += (hash13(vec3(gl_FragCoord.xy, uTime)) - 0.5) / 255.0;
  gl_FragColor = vec4(max(col, 0.0) * alpha, alpha);
}
`;

const HOLD = 2.6;
const SWAP = 1.1;
// Seconds each character is on screen, including its hand-over.
const CAST_PERIOD = HOLD + SWAP;
const CAST_COUNT = 4;
const CAM_L = 3;
const FOV = 1.45;
/** Half size, in screen units, of the throat's opening. */
const THROAT = Math.tan(Math.asin(1 / Math.sqrt(1 + CAM_L * CAM_L))) / FOV;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createWormhole(canvas: HTMLCanvasElement, tier: Tier) {
  const surface = createSurface(canvas, SHADER, { tier, transparent: true });
  if (!surface) return null;
  const { gl, uniform: u } = surface;

  // Empty until the atlas arrives; until then no character is drawn.
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  gl.uniform1i(u("uCast"), 0);
  let ready = false;
  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    ready = true;
  };
  img.src = cast.src;

  const resize = () => surface.resize(Math.min(window.devicePixelRatio || 1, 2));
  resize();
  gl.uniform1f(u("uCamL"), CAM_L);
  gl.uniform1f(u("uFov"), FOV);

  const render = (time: number) => {
    gl.uniform1f(u("uTime"), time);

    // Character k holds for HOLD seconds, then over SWAP seconds it winds
    // into the centre while character k + 1 unwinds out of it, overlapping
    // in the middle where the burst hides the seam.
    const k = Math.floor(time / CAST_PERIOD);
    const t = time - k * CAST_PERIOD;
    const x = t < HOLD ? 0 : (t - HOLD) / SWAP;
    const cell = (n: number) => ((n % CAST_COUNT) + CAST_COUNT) % CAST_COUNT;
    const on = ready ? 1 : 0;
    // A slow breath while it holds.
    gl.uniform1f(u("uSize"), THROAT * 0.92 * (1 + 0.02 * Math.sin(time * 1.6)));
    gl.uniform3f(u("uOut"), cell(k), Math.pow(smooth(0, 0.62, x), 1.3), on);
    gl.uniform3f(u("uIn"), cell(k + 1), 1 - smooth(0.38, 1, x), x > 0.38 ? on : 0);
    gl.uniform1f(u("uBurst"), on * Math.pow(Math.sin(Math.PI * smooth(0.3, 0.7, x)), 2));

    surface.draw();
  };

  const dispose = () => {
    img.onload = null;
    gl.deleteTexture(tex);
    surface.dispose();
  };

  return { render, resize, dispose };
}
