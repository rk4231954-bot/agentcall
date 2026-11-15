import { createSurface, GLSL_COMMON, type Tier } from "./gl";
import cast from "./wormhole-cast.webp";

// Ellis wormhole, ray traced per pixel. It is the router in the flow diagram:
// the issue arrives along the gold line on our side, and the throat opens onto
// a second sky. The agentcall characters take turns flying in from that far
// side: each one grows through the throat, bent by the lensing, then steps
// out on our side as the next one starts its approach.
//
// Metric: ds² = -dt² + dl² + (b² + l²) dΩ², throat radius b = 1. The proper
// radial distance l runs from +∞ (our universe) through the throat at l = 0 to
// -∞ (the other universe). Areal radius r = √(b² + l²).
//
// A ray lives in a plane with conserved h = r²·dφ/dλ, and
//     d²l/dλ² = h²·l / r⁴,   dφ/dλ = h / r².
// Rays with h < b cross the throat. The Einstein ring of our sky around the
// rim and the distortion of the characters seen through it come out of this
// integration.
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
uniform vec3 uFar;     // cell, angular radius on the far sky, opacity
uniform vec3 uNear;    // cell, half size (screen), opacity

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

// Composite one character cell at cell-local uv (0..1, y up). Sampled on
// every pixel so texture derivatives stay defined; \`use\` only masks it.
vec3 overCast(vec3 col, float cell, vec2 cuv, float opacity, bool use) {
  vec2 q = clamp(cuv, 0.004, 0.996);
  vec3 c = texture2D(uCast, vec2((cell + q.x) * 0.25, 0.5 + q.y * 0.5)).rgb;
  float m = texture2D(uCast, vec2((cell + q.x) * 0.25, q.y * 0.5)).r;
  bool inside = all(greaterThanEqual(cuv, vec2(0.0))) && all(lessThanEqual(cuv, vec2(1.0)));
  float k = use && inside ? opacity : 0.0;
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
  bool far = l < 0.0;
  vec3 col = far ? farSky(dir, ddx, ddy) : nearSky(dir, ddx, ddy);
  // A faint warm rim where light skims the throat.
  col += vec3(1.0, 0.7, 0.35) * exp(-abs(h - 1.0) * 26.0) * 0.12;
  col = tonemap(col * 1.15);

  // Characters are display-referred art, so they composite after tone mapping.
  // The far one is centred on the far sky's axis, mapped by angle from it, so
  // at an angular radius of π it covers that whole sky and so the whole throat.
  // The near one has come through and is drawn straight on screen.
  float axisAng = acos(clamp(-dir.z, -1.0, 1.0));
  float sxy = length(dir.xy);
  vec2 ap = sxy > 1e-6 ? dir.xy / sxy * axisAng : vec2(0.0);
  col = overCast(col, uFar.x, ap / (2.0 * uFar.y) + 0.5, uFar.z, far);
  col = overCast(col, uNear.x, uv / (2.0 * uNear.y) + 0.5, uNear.z, true);

  vec2 q = (gl_FragCoord.xy - 0.5 * uRes) / (0.5 * uRes);
  float alpha = 1.0 - smoothstep(0.62, 1.0, length(q));
  col += (hash13(vec3(gl_FragCoord.xy, uTime)) - 0.5) / 255.0;
  gl_FragColor = vec4(max(col, 0.0) * alpha, alpha);
}
`;

/** Seconds each character takes to come through. */
export const CAST_PERIOD = 3.4;
const CAST_COUNT = 4;
const CAM_L = 3;
const FOV = 1.45;
/** Half size, in screen units, of a cell whose art just fills the throat. */
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

    // Each character lives for 1.4 periods (phase s). Until s = 0.82 it
    // approaches on the far side, its angular size growing exponentially (a
    // steady approach) until it fills the throat. Around that point it hands
    // over to its near-side copy, drawn at throat size, which keeps growing
    // toward the viewer and fades. The next character starts at s = 1.
    const k = Math.floor(time / CAST_PERIOD);
    const t = time / CAST_PERIOD - k;
    const cell = (n: number) => ((n % CAST_COUNT) + CAST_COUNT) % CAST_COUNT;
    const on = ready ? 1 : 0;

    const farSize = 0.22 * Math.pow(Math.PI / 0.22, Math.min(t / 0.82, 1));
    const farOpacity = on * smooth(0, 0.14, t) * (1 - smooth(0.76, 0.86, t));
    gl.uniform3f(u("uFar"), cell(k), farSize, farOpacity);

    const ns = t >= 0.76 ? t : t + 1;
    const nearSize = THROAT * Math.exp(Math.max(ns - 0.82, 0) * 1.7);
    const nearOpacity = on * smooth(0.76, 0.86, ns) * (1 - smooth(0.96, 1.4, ns));
    gl.uniform3f(u("uNear"), cell(t >= 0.76 ? k : k - 1), nearSize, nearOpacity);

    surface.draw();
  };

  const dispose = () => {
    img.onload = null;
    gl.deleteTexture(tex);
    surface.dispose();
  };

  return { render, resize, dispose };
}
