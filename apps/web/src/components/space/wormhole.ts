import { createSurface, GLSL_COMMON, type Tier } from "./gl";

// Ellis wormhole, ray traced per pixel. It is the router in the flow diagram:
// the issue arrives through our side and the throat opens onto a second sky
// where each agent is a star. One of them flares at a time as work is routed
// to it.
//
// Metric: ds² = -dt² + dl² + (b² + l²) dΩ², throat radius b = 1. The proper
// radial distance l runs from +∞ (our universe) through the throat at l = 0 to
// -∞ (the other universe). Areal radius r = √(b² + l²).
//
// A ray lives in a plane with conserved h = r²·dφ/dλ, and
//     d²l/dλ² = h²·l / r⁴,   dφ/dλ = h / r².
// Rays with h < b cross the throat. Lensing, the Einstein ring of our sky
// around the rim and the multiple images of each agent star all come out of
// this integration.

const SHADER = /* glsl */ `#extension GL_OES_standard_derivatives : enable
precision highp float;

uniform vec2 uRes;
uniform float uTime;
uniform float uCamL;
uniform float uFov;
uniform vec3 uAgent0;
uniform vec3 uAgent1;
uniform vec3 uAgent2;
uniform vec3 uPulse;   // per-agent flare 0..1

${GLSL_COMMON}

float gPx;

vec3 beacon(vec3 d, vec3 a, vec3 tint, float flare) {
  float c = max(1.0 - dot(d, a), 0.0);
  float core = exp(-c / 0.00035);
  float halo = exp(-c / 0.003) * 0.4 + exp(-c / 0.025) * 0.07;
  return tint * (core * 4.0 + halo) * (0.45 + 2.2 * flare);
}

// The far side: a cool nebula and the three agent stars.
vec3 farSky(vec3 d, vec3 ddx, vec3 ddy) {
  float n = fbm(d * 2.2 + 3.0);
  float m = fbm(d * 4.5 - 7.0);
  vec3 c = vec3(0.012, 0.016, 0.035);
  c += vec3(0.10, 0.06, 0.16) * smoothstep(0.45, 0.85, n) * 0.5;
  c += vec3(0.03, 0.10, 0.14) * smoothstep(0.6, 0.9, m) * 0.35;
  c += starfield(d, ddx, ddy, gPx, 1.6);
  c += beacon(d, uAgent0, vec3(1.0, 0.55, 0.38), uPulse.x);
  c += beacon(d, uAgent1, vec3(0.70, 0.84, 1.0), uPulse.y);
  c += beacon(d, uAgent2, vec3(1.0, 0.86, 0.55), uPulse.z);
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
  vec3 col = l > 0.0 ? nearSky(dir, ddx, ddy) : farSky(dir, ddx, ddy);
  // A faint warm rim where light skims the throat.
  col += vec3(1.0, 0.7, 0.35) * exp(-abs(h - 1.0) * 26.0) * 0.12;

  col = tonemap(col * 1.15);
  vec2 q = (gl_FragCoord.xy - 0.5 * uRes) / (0.5 * uRes);
  float alpha = 1.0 - smoothstep(0.62, 1.0, length(q));
  col += (hash13(vec3(gl_FragCoord.xy, uTime)) - 0.5) / 255.0;
  gl_FragColor = vec4(max(col, 0.0) * alpha, alpha);
}
`;

const CYCLE = 6;

export function createWormhole(canvas: HTMLCanvasElement, tier: Tier) {
  const surface = createSurface(canvas, SHADER, { tier, transparent: true });
  if (!surface) return null;
  const { gl, uniform: u } = surface;

  const resize = () => surface.resize(Math.min(window.devicePixelRatio || 1, 2));
  resize();

  // Agent stars sit just off the axis of the far sky and drift around it, so
  // their images swing through the throat and flare into arcs.
  const agent = (base: number, tilt: number, t: number): [number, number, number] => {
    const a = base + t * 0.05;
    const s = Math.sin(tilt);
    return [Math.cos(a) * s, Math.sin(a) * s, -Math.cos(tilt)];
  };

  const render = (time: number) => {
    gl.uniform1f(u("uTime"), time);
    gl.uniform1f(u("uCamL"), 3.0);
    gl.uniform1f(u("uFov"), 1.45);
    gl.uniform3fv(u("uAgent0"), agent(0.4, 0.62, time));
    gl.uniform3fv(u("uAgent1"), agent(2.5, 0.75, time));
    gl.uniform3fv(u("uAgent2"), agent(4.6, 0.55, time));
    // Route to one agent at a time.
    const phase = (time / CYCLE) % 3;
    const flare = (k: number) => {
      const x = phase - k;
      const d = x < 0 ? x + 3 : x;
      return d < 1 ? Math.sin(Math.PI * d) ** 2 : 0;
    };
    gl.uniform3f(u("uPulse"), flare(0), flare(1), flare(2));
    surface.draw();
  };

  return { render, resize, dispose: surface.dispose };
}
