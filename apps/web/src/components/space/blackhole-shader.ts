import { GLSL_COMMON } from "./gl";

// Schwarzschild black hole, ray traced per pixel.
//
// Units: Schwarzschild radius r_s = 1 (M = 0.5, photon sphere 1.5, ISCO 3).
//
// Geodesics: a light ray stays in the plane through the hole that contains
// the camera and the ray direction. In that plane u = 1/r obeys Binet's
// equation
//     d²u/dφ² = -u + (3/2)·u²
// which we integrate with adaptive RK4 in φ. It is a 1D ODE, so it is cheap
// and accurate, and the disk plane (y = 0) cuts the ray's plane along a known
// line: crossings happen at φ₀ + kπ, where u is recovered exactly with cubic
// Hermite interpolation. k = 0 is the disk you see directly, k = 1 is the
// image lensed over and under the shadow, k = 2 the photon ring.
//
// Disk: thin Novikov–Thorne-like flux F(r) ∝ (1 - √(3/r)) / r³ on Keplerian
// orbits, with Doppler and gravitational shift
//     g = √(1 - 1/r) / (γ (1 + β·n)),
// observed temperature ∝ g and intensity ∝ g³. The turbulent texture is a
// two-phase flow map so differential rotation never winds it into aliasing
// hairlines, and its contrast is filtered by the pixel's footprint on the disk.
//
// Glow: a vertically exponential atmosphere above the disk, integrated in
// closed form along every ray segment, so it is smooth at any step size.
//
// Star: Gaussian emission in a stretched frame, integrated exactly along each
// segment with erf, so it has no seams between steps. It follows a log spiral
// in the disk plane; past the tidal radius it is stretched into a stream that
// wraps the hole and becomes the disk.

export function blackholeShader(steps: number): string {
  return /* glsl */ `#extension GL_OES_standard_derivatives : enable
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
uniform vec4 uDisk;      // formation, brightness, heat, outer radius
uniform float uExposure;
uniform float uSky;
uniform vec2 uFade;      // elliptical edge fade, 1 = canvas edge; y = 0 means opaque
uniform vec3 uStarPos;
uniform vec3 uStarAx;
uniform vec3 uStarAy;
uniform vec3 uStarAz;
uniform float uStarI;
uniform float uStarGlow;
uniform vec4 uStream;    // tail φ, head φ, intensity, -
uniform vec3 uSpiral;    // R0, K, start angle

#define STEPS ${steps}

${GLSL_COMMON}

float gPx;

// Mass of gas at radius r while the disk forms: a ring where the stream
// circularizes, spreading in to the ISCO and out to the outer radius.
float diskMass(float r) {
  float f = uDisk.x;
  float rin = mix(5.6, 2.4, f);
  float rout = mix(8.0, uDisk.w, f);
  return smoothstep(rin - 0.4, rin + 1.4, r) * (1.0 - smoothstep(rout * 0.5, rout, r));
}

// Redshift factor for gas on a circular prograde orbit at radius r, seen
// along traced direction n.
float shift(vec3 p, float r, vec3 n) {
  float beta = clamp(sqrt(0.5 / max(r - 1.0, 0.5)), 0.0, 0.7);
  vec3 vdir = vec3(-p.z, 0.0, p.x) / r;
  float gam = inversesqrt(1.0 - beta * beta);
  return sqrt(max(1.0 - 1.0 / r, 0.02)) / (gam * (1.0 + beta * dot(vdir, n)));
}

float diskTex(float r, float ang, float foot) {
  const float P = 18.0;
  float c1 = uTime / P;
  float t1 = fract(c1);
  float t2 = fract(c1 + 0.5);
  float w1 = 1.0 - abs(2.0 * t1 - 1.0);
  float w2 = 1.0 - w1;
  float om = sqrt(0.5 / (r * r * r));
  float lr = log(r) * 13.0;
  // Contrast of each octave fades as its radial cell shrinks toward a pixel.
  float cell = r / 13.0;
  float k1 = smoothstep(1.2, 4.0, cell / foot);
  float k2 = smoothstep(1.2, 4.0, cell * 0.45 / foot);

  float ph1 = ang - om * t1 * P;
  float ph2 = ang - om * t2 * P;
  vec3 q1 = vec3(cos(ph1) * 1.9, sin(ph1) * 1.9, lr) + floor(c1) * vec3(3.1, 1.7, 5.9);
  vec3 q2 = vec3(cos(ph2) * 1.9, sin(ph2) * 1.9, lr) + floor(c1 + 0.5) * vec3(2.3, 4.1, 1.3) + 17.0;
  float n1 = (noise(q1) - 0.5) * k1 + (noise(q1 * 2.2 + 3.7) - 0.5) * 0.6 * k2;
  float n2 = (noise(q2) - 0.5) * k1 + (noise(q2 * 2.2 + 3.7) - 0.5) * 0.6 * k2;
  float n = (w1 * n1 + w2 * n2) * inversesqrt(w1 * w1 + w2 * w2);
  return clamp(0.6 + 1.6 * n, 0.05, 1.5);
}

vec4 disk(vec3 p, vec3 n, float foot) {
  float r = length(p.xz);
  float m = diskMass(r);
  if (m < 0.002) return vec4(0.0);
  float ang = atan(p.z, p.x);
  float tex = diskTex(r, ang, foot);
  // Inside the ISCO gas plunges and fades fast.
  float rr = max(r, 3.08);
  float flux = (1.0 - sqrt(3.0 / rr)) / (rr * rr * rr) * 476.0;
  flux *= smoothstep(1.7, 3.3, r);
  flux = max(flux, 0.0);
  float g = shift(p, r, n);
  float t = pow(flux, 0.25) * uDisk.z * g;
  float b = uDisk.y;
  vec3 col = blackbody(t) * pow(flux, 0.75) * g * g * g * m * tex * b * 1.35;
  // Unlit gas is invisible: before the disk is fed it neither glows nor blocks.
  float a = clamp(m * (0.5 + 0.5 * tex) * b * 1.4, 0.0, 0.97);
  return vec4(col, a);
}

vec4 stream(vec3 p, vec3 n, float foot) {
  float r = length(p.xz);
  if (r < 2.6 || r > uSpiral.x) return vec4(0.0);
  float phiR = log(uSpiral.x / r) / uSpiral.y;
  float ends = smoothstep(uStream.x, uStream.x + 1.6, phiR)
             * (1.0 - smoothstep(uStream.y - 0.15, uStream.y + 0.05, phiR));
  if (ends <= 0.0) return vec4(0.0);
  float ang = atan(p.z, p.x);
  float d = mod(ang - (uSpiral.z + phiR) + PI, TAU) - PI;
  float dist = abs(d) * r;
  float w = 0.08 + 0.035 * (uStream.y - phiR);
  // Widen thin parts to at least a pixel and keep their total light.
  float we = max(w, foot * 1.5);
  float clump = 0.6 + 0.4 * noise(vec3(phiR * 4.0, 0.0, uTime * 0.2));
  float dens = exp(-dist * dist / (we * we)) * (w / we) * ends * clump;
  float g = shift(p, r, n);
  vec3 col = blackbody(1.45 * g) * dens * uStream.z * 2.8 * g * g * g;
  return vec4(col, clamp(dens * uStream.z * 0.75, 0.0, 0.9));
}

// ∫₀¹ exp(-|a + t(b - a)|²) dt
float gaussSeg(vec3 a, vec3 b) {
  vec3 ab = b - a;
  float l2 = dot(ab, ab) + 1e-6;
  float l = sqrt(l2);
  float t0 = -dot(a, ab) / l2;
  vec3 c = a + ab * t0;
  float d2 = dot(c, c);
  if (d2 > 14.0) return 0.0;
  return exp(-d2) * 0.886227 / l * (erf(l * (1.0 - t0)) - erf(-l * t0));
}

vec3 starFrame(vec3 p) {
  p -= uStarPos;
  return vec3(dot(p, uStarAx), dot(p, uStarAy), dot(p, uStarAz));
}

// Average of exp(-|y|/s) along a segment whose height runs y0 → y1.
float slabAvg(float a, float b, float s) {
  float d = b - a;
  if (abs(d) < 1e-3 * s) return exp(-0.5 * (a + b) / s);
  return s * (exp(-a / s) - exp(-b / s)) / d;
}
float slab(float y0, float y1, float s) {
  if (y0 * y1 < 0.0) {
    float t = y0 / (y0 - y1);
    return t * slabAvg(abs(y0), 0.0, s) + (1.0 - t) * slabAvg(0.0, abs(y1), s);
  }
  return slabAvg(abs(y0), abs(y1), s);
}

vec3 sky(vec3 d, vec3 ddx, vec3 ddy) {
  // A faint dusty galactic band, so before anything falls in the hole shows
  // itself only by bending the light behind it.
  vec3 pole = normalize(vec3(0.42, 0.86, 0.28));
  float lat = dot(d, pole);
  float band = exp(-lat * lat * 22.0);
  float n = fbm(d * 3.2 + 2.0);
  float dust = smoothstep(0.35, 0.75, fbm(d * 7.0 + 9.0));
  vec3 c = mix(vec3(0.22, 0.17, 0.26), vec3(0.52, 0.38, 0.26), n) * band * n * (1.0 - 0.7 * dust) * 0.1;
  c += starfield(d, ddx, ddy, gPx, 1.0) * (0.45 + 0.55 * band);
  return c * uSky;
}

float acc(float u) { return -u + 1.5 * u * u; }

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y) - uShift;
  gPx = uFov / min(uRes.x, uRes.y);
  vec3 rd = normalize(uCamFw + uFov * (uv.x * uCamRight + uv.y * uCamUp));

  float rc = length(uCamPos);
  vec3 e1 = uCamPos / rc;
  float cr = dot(rd, e1);
  vec3 perp = rd - cr * e1;
  float sp = length(perp);
  vec3 e2 = sp > 1e-5 ? perp / sp : normalize(cross(e1, vec3(0.31, 0.83, 0.47)));
  sp = max(sp, 1e-5);

  float u = 1.0 / rc;
  float v = -u * cr / sp;
  float phi = 0.0;

  // Disk-plane crossings of this ray's plane.
  float A = e1.y;
  float B = e2.y;
  float nextC = mod(atan(-A, B), PI);
  if (nextC < 1e-4) nextC += PI;
  float order = 0.0;

  vec3 col = vec3(0.0);
  float T = 1.0;
  bool captured = false;
  bool done = false;
  float phiEnd = 0.0;
  vec3 p0 = uCamPos;
  float hazeK = uDisk.y * 0.022;

  for (int i = 0; i < STEPS; i++) {
    float h = clamp(0.014 / u + 0.012, 0.028, 0.32);
    h = min(h, 0.35 * (u + 0.03) / max(abs(v), 1e-4));

    float k1u = v;               float k1v = acc(u);
    float k2u = v + 0.5 * h * k1v; float k2v = acc(u + 0.5 * h * k1u);
    float k3u = v + 0.5 * h * k2v; float k3v = acc(u + 0.5 * h * k2u);
    float k4u = v + h * k3v;       float k4v = acc(u + h * k3u);
    float u1 = u + h / 6.0 * (k1u + 2.0 * k2u + 2.0 * k3u + k4u);
    float v1 = v + h / 6.0 * (k1v + 2.0 * k2v + 2.0 * k3v + k4v);
    float phi1 = phi + h;

    if (phi1 >= nextC) {
      float s = (nextC - phi) / h;
      float s2 = s * s;
      float s3 = s2 * s;
      float uc = (2.0 * s3 - 3.0 * s2 + 1.0) * u + (s3 - 2.0 * s2 + s) * h * v
               + (-2.0 * s3 + 3.0 * s2) * u1 + (s3 - s2) * h * v1;
      float vc = ((6.0 * s2 - 6.0 * s) * u + (3.0 * s2 - 4.0 * s + 1.0) * h * v
               + (-6.0 * s2 + 6.0 * s) * u1 + (3.0 * s2 - 2.0 * s) * h * v1) / h;
      if (uc > 0.0 && uc < 1.0) {
        float cs = cos(nextC);
        float sn = sin(nextC);
        vec3 ep = cs * e1 + sn * e2;
        vec3 pc = ep / uc;
        vec3 n = normalize((-sn * e1 + cs * e2) * uc - ep * vc);
        float foot = gPx * length(pc - uCamPos) / max(abs(n.y), 0.03) * (1.0 + order * 3.0);
        vec4 dk = disk(pc, n, foot);
        vec4 st = uStream.z > 0.001 ? stream(pc, n, foot) : vec4(0.0);
        col += T * (dk.rgb + st.rgb);
        T *= (1.0 - dk.a) * (1.0 - st.a);
      }
      nextC += PI;
      order += 1.0;
    }

    bool inside = u1 >= 1.0;
    vec3 p1 = u1 > 0.0 ? (cos(phi1) * e1 + sin(phi1) * e2) / min(u1, 1.0) : p0;
    float seg = length(p1 - p0);

    if (hazeK > 0.0) {
      vec3 mid = 0.5 * (p0 + p1);
      float rx = length(mid.xz);
      float hz = diskMass(rx) * smoothstep(1.4, 3.6, rx) / (0.6 + rx * 0.35);
      if (hz > 0.002) {
        float s = 0.12 + 0.07 * rx;
        col += T * vec3(1.0, 0.56, 0.2) * hazeK * hz * slab(p0.y, p1.y, s) * seg;
      }
    }
    if (uStarI > 0.001) {
      float glow = gaussSeg((p0 - uStarPos) / uStarGlow, (p1 - uStarPos) / uStarGlow);
      if (glow > 0.0) {
        float core = gaussSeg(starFrame(p0), starFrame(p1));
        col += T * vec3(1.0, 0.93, 0.82) * (core * 3.0 + glow * 0.07) * seg * uStarI;
        T *= 1.0 - clamp(core * seg * 1.5 * uStarI, 0.0, 0.9);
      }
    }

    p0 = p1;
    phi = phi1;
    u = u1;
    v = v1;
    if (inside) { captured = true; done = true; break; }
    if (u < 0.0225 && v < 0.0) { phiEnd = phi + atan(u, -v); done = true; break; }
    if (T < 0.01) { done = true; break; }
  }
  if (!done) {
    if (u > 0.2) captured = true;
    else phiEnd = phi + atan(max(u, 0.0), max(-v, 1e-4));
  }

  // Derivatives must be taken outside branches, on every pixel of the quad.
  vec3 skyDir = cos(phiEnd) * e1 + sin(phiEnd) * e2;
  vec3 ddx = dFdx(skyDir);
  vec3 ddy = dFdy(skyDir);
  if (!captured && T > 0.01) col += T * sky(skyDir, ddx, ddy);

  col = tonemap(col * uExposure);
  float alpha = 1.0;
  if (uFade.y > 0.0) {
    alpha = 1.0 - smoothstep(uFade.x, uFade.y, length((gl_FragCoord.xy - 0.5 * uRes) / (0.5 * uRes)));
  } else {
    col *= 1.0 - 0.18 * dot(uv, uv);
  }
  col += (hash13(vec3(gl_FragCoord.xy, uTime)) - 0.5) / 255.0;
  gl_FragColor = vec4(max(col, 0.0) * alpha, alpha);
}
`;
}
