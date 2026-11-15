// Schwarzschild black hole, ray traced in the fragment shader.
//
// Units: Schwarzschild radius r_s = 1 (so M = 0.5, photon sphere at 1.5,
// innermost stable circular orbit at 3).
//
// Light paths: a photon in the Schwarzschild metric obeys, in Cartesian
// coordinates with affine parameter λ,
//     d²x/dλ² = -(3/2) · h² · x / r⁵      (r_s = 1)
// where h = |x × dx/dλ| is the conserved specific angular momentum. We march
// rays backwards from the camera with that law, so lensing, the photon ring and
// the "disk wrapped over the top" image all fall out of the integration.
//
// Disk: thin disk with a Novikov–Thorne-like flux profile
//     F(r) ∝ (1 - √(r_in / r)) / r³
// rotating at the Keplerian rate Ω = √(M / r³), with relativistic Doppler and
// gravitational shift g = √(1 - 1/r) / (γ (1 + β·n)). Observed temperature
// scales with g and intensity with g³.
//
// Tidal disruption: the star follows a logarithmic spiral r(φ) = R0·e^(-Kφ)
// in the disk plane. Past the tidal radius it is stretched along its orbit and
// becomes a stream that winds into the disk and lights it up.

export const vertexShader = /* glsl */ `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export function fragmentShader(steps: number, stepK: number): string {
  return /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uRes;
uniform float uTime;
uniform vec3 uCamPos;
uniform vec3 uCamFw;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uFov;
uniform vec2 uShift;
uniform float uFeed;
uniform float uHeat;
uniform float uROut;
uniform float uExposure;
uniform vec3 uStarPos;
uniform vec3 uStarAx;
uniform vec3 uStarAy;
uniform vec3 uStarAz;
uniform float uStarI;
uniform vec4 uStream;   // tail φ, head φ, intensity, -
uniform vec3 uSpiral;   // R0, K, start angle

#define STEPS ${steps}
const float STEP_K = ${stepK.toFixed(4)};
const float RIN = 3.0;
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

// Approximate blackbody tint. t ≈ 1 is a warm gold, higher is whiter.
vec3 blackbody(float t) {
  t = max(t, 0.0);
  vec3 c = vec3(1.0, 0.30, 0.05);
  c = mix(c, vec3(1.0, 0.66, 0.26), smoothstep(0.30, 0.90, t));
  c = mix(c, vec3(1.0, 0.90, 0.72), smoothstep(0.90, 1.55, t));
  c = mix(c, vec3(0.82, 0.88, 1.0), smoothstep(1.80, 2.80, t));
  return c * smoothstep(0.0, 0.32, t);
}

// Redshift factor for gas on a circular prograde orbit at radius r.
float shift(vec3 p, float r, vec3 rd) {
  float beta = clamp(sqrt(0.5 / max(r - 1.0, 0.5)), 0.0, 0.75);
  vec3 vdir = vec3(-p.z, 0.0, p.x) / r;
  float gam = inversesqrt(1.0 - beta * beta);
  return sqrt(max(1.0 - 1.0 / r, 0.02)) / (gam * (1.0 + beta * dot(vdir, rd)));
}

vec4 disk(vec3 p, vec3 rd) {
  float r = length(p.xz);
  if (r < RIN - 0.6 || r > uROut) return vec4(0.0);
  float ang = atan(p.z, p.x);
  float ph = ang - sqrt(0.5 / (r * r * r)) * uTime;
  vec3 q = vec3(cos(ph) * 1.7, sin(ph) * 1.7, r * 3.1);
  float n = noise(q) * 0.55 + noise(q * 2.13 + 7.1) * 0.30 + noise(q * 4.7 + 3.3) * 0.15;
  float dens = smoothstep(0.16, 0.86, n);
  float inner = smoothstep(RIN - 0.6, RIN + 0.5, r);
  float outer = 1.0 - smoothstep(uROut * 0.5, uROut, r);
  float rr = max(r, RIN + 0.05);
  float flux = max(1.0 - sqrt(RIN / rr), 0.0) / (rr * rr * rr) * 476.0;
  float g = shift(p, r, rd);
  float t = pow(flux, 0.25) * uHeat * g;
  float a = dens * inner * outer;
  vec3 col = blackbody(t) * pow(flux, 0.8) * g * g * g * a * (0.22 + 1.7 * uFeed);
  return vec4(col, clamp(a * (0.42 + 0.5 * uFeed), 0.0, 0.93));
}

vec4 stream(vec3 p, vec3 rd) {
  float r = length(p.xz);
  if (r < RIN * 0.85 || r > uSpiral.x) return vec4(0.0);
  float phiR = log(uSpiral.x / r) / uSpiral.y;
  float ends = smoothstep(uStream.x, uStream.x + 1.4, phiR)
             * (1.0 - smoothstep(uStream.y - 0.2, uStream.y + 0.05, phiR));
  if (ends <= 0.0) return vec4(0.0);
  float ang = atan(p.z, p.x);
  float d = mod(ang - (uSpiral.z + phiR) + PI, TAU) - PI;
  float dist = abs(d) * r;
  float w = 0.10 + 0.04 * (uStream.y - phiR);
  float clump = 0.55 + 0.45 * noise(vec3(phiR * 3.0, dist * 5.0, uTime * 0.25));
  float dens = exp(-dist * dist / (w * w)) * ends * clump;
  float g = shift(p, r, rd);
  vec3 col = blackbody(1.35 * g) * dens * uStream.z * 2.6 * g * g * g;
  return vec4(col, clamp(dens * uStream.z * 0.8, 0.0, 0.9));
}

void star(vec3 a0, vec3 b0, inout vec3 col, inout float T) {
  vec3 a = a0 - uStarPos;
  vec3 b = b0 - uStarPos;
  a = vec3(dot(a, uStarAx), dot(a, uStarAy), dot(a, uStarAz));
  b = vec3(dot(b, uStarAx), dot(b, uStarAy), dot(b, uStarAz));
  vec3 ab = b - a;
  float h = clamp(-dot(a, ab) / max(dot(ab, ab), 1e-5), 0.0, 1.0);
  float d = length(a + ab * h);
  if (d < 3.0) {
    float core = smoothstep(1.0, 0.55, d);
    float halo = exp(-2.4 * max(d - 0.55, 0.0)) * 0.3;
    col += T * vec3(1.0, 0.93, 0.80) * (core * 2.4 + halo) * uStarI;
    T *= 1.0 - core * uStarI;
  }
}

vec3 sky(vec3 d) {
  vec3 c = vec3(0.0);
  vec3 p = d * 150.0;
  vec3 id = floor(p);
  float h = hash13(id);
  if (h > 0.962) {
    vec3 sp = id + 0.2 + 0.6 * vec3(hash13(id + 1.7), hash13(id + 3.1), hash13(id + 5.3));
    float b = (h - 0.962) / 0.038;
    vec3 tint = mix(vec3(0.70, 0.80, 1.0), vec3(1.0, 0.86, 0.70), hash13(id + 9.0));
    c += tint * smoothstep(0.24, 0.0, length(p - sp)) * b * b * 1.8;
  }
  float n = noise(d * 2.4 + 11.0);
  c += vec3(0.10, 0.07, 0.20) * n * n * n * n * 0.22;
  return c;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y) - uShift;
  vec3 rd = normalize(uCamFw + uFov * (uv.x * uCamRight + uv.y * uCamUp));
  vec3 pos = uCamPos;
  vec3 vel = rd;
  vec3 hv = cross(pos, vel);
  float h2 = dot(hv, hv);

  vec3 col = vec3(0.0);
  float T = 1.0;
  bool captured = false;
  vec3 haze = vec3(1.0, 0.58, 0.22);

  for (int i = 0; i < STEPS; i++) {
    float r2 = dot(pos, pos);
    float r = sqrt(r2);
    float dt = max(STEP_K * r, 0.022);
    vel += -1.5 * h2 * pos / (r2 * r2 * r) * dt;
    vec3 np = pos + vel * dt;

    if (pos.y * np.y < 0.0) {
      vec3 cp = mix(pos, np, pos.y / (pos.y - np.y));
      vec3 vn = normalize(vel);
      vec4 dk = disk(cp, vn);
      vec4 st = uStream.z > 0.001 ? stream(cp, vn) : vec4(0.0);
      col += T * (dk.rgb + st.rgb);
      T *= (1.0 - dk.a) * (1.0 - st.a);
    }
    if (uStarI > 0.001) star(pos, np, col, T);

    float rx = length(np.xz);
    col += T * haze * (0.15 + 0.85 * uFeed)
         * exp(-abs(np.y) * 2.2 - max(rx - 4.0, 0.0) * 0.28)
         * smoothstep(1.3, 3.3, rx) * dt * 0.03;

    pos = np;
    if (dot(pos, pos) < 1.0) { captured = true; break; }
    if (T < 0.01) break;
    if (r > 48.0 && dot(pos, vel) > 0.0) break;
  }

  if (!captured && dot(pos, vel) > 0.0) col += T * sky(normalize(vel));

  col *= uExposure;
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
  col = pow(clamp(col, 0.0, 1.0), vec3(0.4545));
  col *= 1.0 - 0.22 * dot(uv, uv);
  col += (hash13(vec3(gl_FragCoord.xy, uTime)) - 0.5) / 255.0;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;
}
