import { blackholeShader } from "./blackhole-shader";
import { createSurface, type Tier } from "./gl";

type Vec3 = [number, number, number];

const TAU = Math.PI * 2;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];

// Star orbit: log spiral from R0 down to just outside the ISCO.
const R0 = 20;
const TURNS = 2.1 * TAU;
const K = Math.log(R0 / 3.05) / TURNS;
const A0 = 0.25;
const STAR_RADIUS = 0.45;
const TIDAL_RADIUS = 9.5;

/** Progress at which the scene stops being static (the star appears). */
export const LIVE_FROM = 0.04;

export type Framing = "hero" | "tile";

export interface BlackHole {
  /** p: 0 = empty sky with an unseen hole, 1 = the fully fed disk. */
  render(p: number, time: number): void;
  resize(): void;
  /** Feed frame intervals (ms) so resolution can adapt. */
  sample(frameMs: number): void;
  dispose(): void;
}

export function createBlackHole(canvas: HTMLCanvasElement, tier: Tier, framing: Framing): BlackHole | null {
  const tile = framing === "tile";
  const surface = createSurface(canvas, blackholeShader(tier === "high" ? 170 : 110), {
    tier,
    transparent: tile,
  });
  if (!surface) return null;
  const { gl, uniform: u } = surface;
  gl.uniform3f(u("uSpiral"), R0, K, A0);

  // Adaptive resolution: drop quickly when frames are slow, climb back slowly.
  const dprCap = tile ? 2 : tier === "high" ? 1.75 : 1.3;
  let resScale = tile ? 1 : tier === "high" ? 1 : 0.7;
  let maxScale = 1;
  const minScale = 0.4;
  let acc = 0;
  let count = 0;
  let goodWindows = 0;
  let cssW = 1;
  let cssH = 1;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const size = surface.resize(dpr * resScale);
    cssW = size.cssW;
    cssH = size.cssH;
  };
  resize();

  const sample = (ms: number) => {
    if (ms > 250) return; // tab switch or stall, not a real frame
    acc += ms;
    count += 1;
    if (count < 40) return;
    const avg = acc / count;
    acc = 0;
    count = 0;
    if (avg > 1000 / 48 && resScale > minScale) {
      resScale = Math.max(minScale, resScale * 0.85);
      maxScale = Math.min(maxScale, resScale * 1.15);
      goodWindows = 0;
      resize();
    } else if (avg < 1000 / 58) {
      goodWindows += 1;
      if (goodWindows >= 4 && resScale < maxScale) {
        resScale = Math.min(maxScale, resScale * 1.07);
        goodWindows = 0;
        resize();
      }
    } else {
      goodWindows = 0;
    }
  };

  const render = (p: number, time: number) => {
    const portrait = cssH > cssW;
    const e = smooth(0, 1, p);

    // Camera: far and level over an empty sky, then drifts in and rises as
    // the disk ignites.
    let dist: number;
    let el: number;
    let fov: number;
    let shiftY: number;
    if (tile) {
      dist = 31;
      el = 0.12;
      fov = 0.6;
      shiftY = -0.03;
    } else {
      dist = mix(portrait ? 40 : 36, portrait ? 26 : 21, e);
      el = mix(0.05, 0.14, e);
      fov = portrait ? 1.3 : 0.92;
      shiftY = portrait ? -0.06 : mix(-0.15, -0.1, e);
    }
    const camPos: Vec3 = [0, dist * Math.sin(el), -dist * Math.cos(el)];
    const fw = norm(scale(camPos, -1));
    const right = norm(cross([0, 1, 0], fw));
    const up = cross(fw, right);
    gl.uniform3fv(u("uCamPos"), camPos);
    gl.uniform3fv(u("uCamFw"), fw);
    gl.uniform3fv(u("uCamRight"), right);
    gl.uniform3fv(u("uCamUp"), up);
    gl.uniform1f(u("uFov"), fov);
    gl.uniform2f(u("uShift"), 0, shiftY);
    gl.uniform2f(u("uFade"), tile ? 0.55 : 0, tile ? 0.98 : 0);
    gl.uniform1f(u("uTime"), time);
    gl.uniform1f(u("uSky"), tile ? 0.45 : 1);

    // Infall: the star spirals in, is stretched past the tidal radius into a
    // stream that wraps the hole, and the stream circularizes into the disk.
    const q = clamp01((p - LIVE_FROM) / 0.62);
    const head = TURNS * (q < 0.5 ? 2 * q * q : 1 - Math.pow(-2 * q + 2, 2) / 2);
    const r = R0 * Math.exp(-K * head);
    const a = A0 + head;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const tangent = norm([-K * c - s, 0, -K * s + c]);
    const normal: Vec3 = [tangent[2], 0, -tangent[0]];
    const tidal = smooth(TIDAL_RADIUS, 3.4, r);
    // The body only stretches a little before it dissolves; the stream
    // carries the rest of the spaghettification.
    const stretch = 1 + 4 * tidal;
    const along = STAR_RADIUS * stretch;
    const across = STAR_RADIUS / Math.sqrt(stretch);
    gl.uniform3fv(u("uStarPos"), [r * c, 0, r * s]);
    gl.uniform3fv(u("uStarAx"), scale(tangent, 1 / along));
    gl.uniform3fv(u("uStarAy"), scale(normal, 1 / across));
    gl.uniform3f(u("uStarAz"), 0, 1 / across, 0);
    gl.uniform1f(u("uStarI"), tile ? 0 : smooth(0.0, 0.05, q) * (1 - smooth(0.25, 0.8, tidal)));
    gl.uniform1f(u("uStarGlow"), 1.1);

    const tail = Math.max(0, head - TURNS * 0.95 * smooth(0.25, 1, q));
    const streamI = tile ? 0 : smooth(0.05, 0.5, tidal) * (1 - smooth(0.8, 0.97, p));
    gl.uniform4f(u("uStream"), tail, head, streamI, 0);

    const form = smooth(0.42, 0.93, p);
    const bright = Math.pow(smooth(0.45, 0.96, p), 1.3);
    gl.uniform4f(u("uDisk"), form, bright, mix(0.78, 1.12, bright), mix(9, 15, form));
    gl.uniform1f(u("uExposure"), mix(1.3, 1.05, bright));

    surface.draw();
  };

  return { render, resize, sample, dispose: surface.dispose };
}
