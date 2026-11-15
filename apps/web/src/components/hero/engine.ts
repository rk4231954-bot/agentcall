import { fragmentShader, vertexShader } from "./shader";

type Vec3 = [number, number, number];

const TAU = Math.PI * 2;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
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

// Star orbit: logarithmic spiral from R0 to just outside the ISCO over 3 turns.
const R0 = 16;
const TURNS = 3 * TAU;
const K = Math.log(R0 / 3.05) / TURNS;
const A0 = -0.35;
const STAR_RADIUS = 0.42;

export type Tier = "low" | "high";

export function detectTier(): Tier {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const cores = nav.hardwareConcurrency ?? 4;
  const mem = nav.deviceMemory ?? 8;
  return coarse || cores <= 4 || mem <= 4 ? "low" : "high";
}

export interface Engine {
  render(progress: number, time: number): void;
  resize(): void;
  /** Feed the frame interval (ms) so resolution can adapt. */
  sample(frameMs: number): void;
  dispose(): void;
}

export function createEngine(canvas: HTMLCanvasElement, tier: Tier): Engine | null {
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: tier === "high" ? "high-performance" : "default",
  });
  if (!gl) return null;

  const steps = tier === "high" ? 150 : 96;
  const stepK = tier === "high" ? 0.05 : 0.075;

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, vertexShader);
  const fs = compile(gl.FRAGMENT_SHADER, fragmentShader(steps, stepK));
  if (!vs || !fs) return null;
  const prog = gl.createProgram()!;
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

  const u = (name: string) => gl.getUniformLocation(prog, name);
  const U = {
    res: u("uRes"),
    time: u("uTime"),
    camPos: u("uCamPos"),
    camFw: u("uCamFw"),
    camRight: u("uCamRight"),
    camUp: u("uCamUp"),
    fov: u("uFov"),
    shift: u("uShift"),
    feed: u("uFeed"),
    heat: u("uHeat"),
    rOut: u("uROut"),
    exposure: u("uExposure"),
    starPos: u("uStarPos"),
    starAx: u("uStarAx"),
    starAy: u("uStarAy"),
    starAz: u("uStarAz"),
    starI: u("uStarI"),
    stream: u("uStream"),
    spiral: u("uSpiral"),
  };
  gl.uniform3f(U.spiral, R0, K, A0);

  // Adaptive resolution: drop quickly when frames are slow, climb back slowly.
  const dprCap = tier === "high" ? 1.5 : 1.25;
  let resScale = tier === "high" ? 0.7 : 0.55;
  let maxScale = tier === "high" ? 1 : 0.8;
  const minScale = 0.3;
  let acc = 0;
  let count = 0;
  let goodWindows = 0;

  let cssW = 0;
  let cssH = 0;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    cssW = rect.width;
    cssH = rect.height;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const w = Math.max(1, Math.round(cssW * dpr * resScale));
    const h = Math.max(1, Math.round(cssH * dpr * resScale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(U.res, w, h);
  };
  resize();

  const sample = (ms: number) => {
    if (ms > 250) return; // tab switch or stall, not a real frame
    acc += ms;
    count += 1;
    if (count < 45) return;
    const avg = acc / count;
    acc = 0;
    count = 0;
    if (avg > 1000 / 45 && resScale > minScale) {
      resScale = Math.max(minScale, resScale * 0.8);
      maxScale = Math.min(maxScale, resScale * 1.1);
      goodWindows = 0;
      resize();
    } else if (avg < 1000 / 57) {
      goodWindows += 1;
      if (goodWindows >= 3 && resScale < maxScale) {
        resScale = Math.min(maxScale, resScale * 1.08);
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

    // Camera drifts in and slightly up as the disk ignites.
    const dist = mix(portrait ? 30 : 27, portrait ? 23 : 20, e);
    const el = mix(0.075, 0.15, e);
    const camPos: Vec3 = [0, dist * Math.sin(el), -dist * Math.cos(el)];
    const fw = norm(scale(camPos, -1));
    const right = norm(cross([0, 1, 0], fw));
    const up = cross(fw, right);
    gl.uniform3fv(U.camPos, camPos);
    gl.uniform3fv(U.camFw, fw);
    gl.uniform3fv(U.camRight, right);
    gl.uniform3fv(U.camUp, up);
    gl.uniform1f(U.fov, portrait ? 1.35 : 0.95);
    gl.uniform2f(U.shift, 0, portrait ? -0.08 : -0.13);
    gl.uniform1f(U.time, time);

    // Infall: the star spirals in, stretches past the tidal radius, then the
    // stream wraps the hole and the disk brightens.
    const q = clamp01((p - 0.03) / 0.72);
    const head = TURNS * (q < 0.5 ? 2 * q * q : 1 - Math.pow(-2 * q + 2, 2) / 2);
    const r = R0 * Math.exp(-K * head);
    const a = A0 + head;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const starPos: Vec3 = [r * c, 0, r * s];
    const tangent = norm([-K * c - s, 0, -K * s + c]);
    const normal: Vec3 = [tangent[2], 0, -tangent[0]];
    const stretch = 1 + 11 * Math.pow(smooth(0.2, 0.72, q), 1.6);
    const along = STAR_RADIUS * stretch;
    const across = STAR_RADIUS / Math.sqrt(stretch);
    gl.uniform3fv(U.starPos, starPos);
    gl.uniform3fv(U.starAx, scale(tangent, 1 / along));
    gl.uniform3fv(U.starAy, scale(normal, 1 / across));
    gl.uniform3f(U.starAz, 0, 1 / across, 0);
    gl.uniform1f(U.starI, 1 - smooth(0.5, 0.82, q));

    const tail = Math.max(0, head - TURNS * 0.92 * smooth(0.26, 1, q));
    const streamI = smooth(0.26, 0.45, q) * (1 - smooth(0.84, 1, p));
    gl.uniform4f(U.stream, tail, head, streamI, 0);

    const feed = mix(0.2, 1, smooth(0.5, 0.96, p));
    gl.uniform1f(U.feed, feed);
    gl.uniform1f(U.heat, mix(0.72, 1.12, feed));
    gl.uniform1f(U.rOut, mix(8.5, 15, smooth(0.45, 1, p)));
    gl.uniform1f(U.exposure, mix(1.25, 1.05, feed));

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const dispose = () => {
    gl.deleteBuffer(buf);
    gl.deleteProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
  };

  return { render, resize, sample, dispose };
}
