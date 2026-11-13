// 강조색·판 톤·구도·씨앗(seed)으로 배경 그림을 그린다.
//
// 조사한 원칙 (출처는 README의 '배경 그라데이션' 절)
//   - 원 몇 개를 겹친 게 아니라, 흐린 색 덩어리가 '흐르는' 한 덩어리의 빛으로 보여야 한다
//     → 색 점의 좌표를 사인파 합으로 비틀고(warp) 중심을 둘러 감는다(swirl).
//   - 주인공이 되는 큰 빛 하나를 비대칭으로 두고, 화면 밖까지 이어지게 한다.
//   - 색상은 이웃한 3~4개까지. 많으면 겹친 곳이 갈색으로 탁해진다. 섞기는 OKLab에서 한다.
//   - 어두운 바탕에서는 '빛'이, 밝은 바탕에서는 옅은 '물감 번짐'이 어울린다.
//   - 바로가기가 놓이는 띠는 조용하게 둔다.
//   - 움직일 때는 8~20초 주기로 아주 천천히.
//
// 구조
//   buildScene()  입력 → 장면 데이터(색 점, 비틀기, 감기). 씨앗이 같으면 늘 같다.
//   sceneAt()     장면을 시각 t(초)만큼 흘려 놓은 값. 움직임 계산은 여기 한 곳에만 있다.
//   fieldAt()     한 점의 색(OKLab). CPU로 그릴 때 쓰고, GPU 셰이더(FRAG)가 같은 식을 옮겨 적었다.
//   renderCPU()   캔버스에 CPU로 그린다 (WebGL이 없을 때, 시험할 때).
//   AuroraGL      같은 그림을 WebGL로 그린다 (배경, 움직임, 썸네일).

import { hexToOklch } from './gradient.ts';

export const COMPOSITIONS = ['aurora', 'horizon', 'bloom', 'currents'] as const;
export type Composition = (typeof COMPOSITIONS)[number];
export const COMPOSITION_NAMES: Record<Composition, string> = { aurora: '오로라 띠', horizon: '지평선 빛', bloom: '한쪽 빛무리', currents: '두 물결' };
export const MAX_SPOTS = 8;

export type Mode = 'dark' | 'light';
export type Lab = [L: number, a: number, b: number];

// 색 점 하나. x는 0~A(가로세로비), y는 0~1 (위가 0).
export interface Spot {
  x: number;
  y: number;
  rx: number;
  ry: number;
  rot: number;
  col: Lab;
  a: number;
}

export interface CalmRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Orbit {
  w: number;
  p: number;
  ax: number;
  ay: number;
}

export interface Scene {
  A: number;
  base: [Lab, Lab];
  quiet: number;
  calm: CalmRect;
  spots: Spot[];
  warp: { amp: number; freq: number };
  swirl: { x: number; y: number; s: number; r: number };
  ph: number[];
  orbits: Orbit[];
}

export interface SceneParams {
  accent: string;
  mode: Mode;
  seed: number;
  composition?: Composition;
  aspect?: number;
  calm?: CalmRect;
  quiet?: number;
}

interface Palette {
  base: [Lab, Lab];
  dominant: Lab;
  neighbor: Lab;
  counter: Lab;
  deep: Lab;
  sheen: Lab;
  quiet: number;
}

type Layout = Pick<Scene, 'spots' | 'warp' | 'swirl'>;

// ---- 색 변환 (OKLab ↔ sRGB) ----

function oklchToLab(L: number, C: number, h: number): Lab {
  const r = (h * Math.PI) / 180;
  return [L, C * Math.cos(r), C * Math.sin(r)];
}

function labToLinear([L, a, b]: Lab): Lab {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function labToRgb8(lab: Lab): Lab {
  return labToLinear(lab).map((v) => {
    const c = Math.min(1, Math.max(0, v));
    return Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
  }) as Lab;
}

// sRGB 밖으로 나가는 색은 명도·색상각을 두고 채도만 줄인다
function safeLab(L: number, C: number, h: number): Lab {
  const ok = (c: number): boolean => labToLinear(oklchToLab(L, c, h)).every((v) => v >= -0.001 && v <= 1.001);
  if (ok(C)) return oklchToLab(L, C, h);
  let lo = 0;
  let hi = C;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return oklchToLab(L, lo, h);
}

// ---- 씨앗으로 정해지는 난수 (mulberry32) ----

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 팔레트 ----

function palette(accent: string, mode: Mode): Palette {
  const { C, h: h0 } = hexToOklch(accent);
  const gray = C < 0.03;
  const c = gray ? 0.02 : Math.min(0.19, Math.max(0.09, C));
  const h = gray ? 255 : h0;
  const H = (d: number): number => (h + d + 360) % 360;
  if (mode === 'light') {
    return {
      base: [safeLab(0.975, c * 0.07, H(0)), safeLab(0.952, c * 0.12, H(25))],
      dominant: safeLab(0.83, c * 0.8, H(0)),
      neighbor: safeLab(0.86, c * 0.7, H(32)),
      counter: safeLab(0.875, c * 0.6, H(-48)),
      deep: safeLab(0.8, c * 0.65, H(14)),
      sheen: safeLab(0.995, 0.005, H(0)),
      quiet: 0.3,
    };
  }
  return {
    base: [safeLab(0.17, c * 0.28, H(8)), safeLab(0.12, c * 0.22, H(28))],
    dominant: safeLab(0.6, c, H(0)),
    neighbor: safeLab(0.53, c * 0.95, H(32)),
    counter: safeLab(0.5, c * 0.85, H(-48)),
    deep: safeLab(0.3, c * 0.7, H(16)),
    sheen: safeLab(0.76, c * 0.55, H(8)),
    // 흰 글자와 5:1이 되려면 글자 뒤 명도가 OKLab 0.5 아래여야 한다. 가장 밝은 점(0.76)도
    // 바탕(0.15) 쪽으로 이만큼 되돌리면 0.5 아래로 내려온다.
    quiet: 0.62,
  };
}

// ---- 구도 ----
// 좌표: x는 0~A(가로세로비), y는 0~1 (위가 0). 색 점마다 { x, y, rx, ry, rot, col, a }.

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

type Builder = (P: Palette, r: () => number, A: number) => Layout;

function aurora(P: Palette, r: () => number, A: number): Layout {
  // 한쪽 아래에서 반대쪽 위로 휘어지며 지나가는 빛의 띠. 바로가기 띠(위 15~55%)는 비켜 간다.
  const flip = r() < 0.5;
  const sx = flip ? A * 1.05 : -0.05;
  const ex = flip ? -0.05 : A * 1.05;
  const sy = lerp(0.85, 1.05, r());
  const ey = lerp(-0.05, 0.12, r());
  const bend = lerp(0.18, 0.32, r());
  const ang = Math.atan2(ey - sy, ex - sx);
  const cols = [P.counter, P.dominant, P.neighbor, P.dominant, P.counter];
  const spots: Spot[] = cols.map((col, i) => {
    const t = i / (cols.length - 1);
    const x = lerp(sx, ex, t);
    const y = lerp(sy, ey, t) + Math.sin(t * Math.PI) * bend;
    return { x, y, rx: lerp(0.32, 0.42, r()) * A, ry: lerp(0.13, 0.2, r()), rot: ang + (r() - 0.5) * 0.5, col, a: lerp(0.75, 0.95, r()) };
  });
  spots.push({ x: flip ? 0.1 * A : 0.9 * A, y: 0.05, rx: 0.45 * A, ry: 0.4, rot: 0, col: P.deep, a: 0.7 });
  const k = 1 + Math.floor(r() * 3);
  spots.push({ x: spots[k].x, y: spots[k].y, rx: 0.12 * A, ry: 0.07, rot: ang, col: P.sheen, a: 0.45 });
  return { spots, warp: { amp: 0.09, freq: 3.2 }, swirl: { x: spots[2].x, y: spots[2].y, s: 0.5, r: 0.5 } };
}

function horizon(P: Palette, r: () => number, A: number): Layout {
  // 화면 아래에서 떠오르는 큰 빛. 한쪽 옆으로 다른 색이 번져 올라간다.
  const cx = lerp(0.35, 0.65, r()) * A;
  const side = r() < 0.5 ? 0.08 * A : 0.92 * A;
  const spots = [
    { x: cx, y: 1.2, rx: 0.85 * A, ry: 0.5, rot: (r() - 0.5) * 0.3, col: P.dominant, a: 0.95 },
    { x: cx + (r() - 0.5) * 0.4 * A, y: 1.02, rx: 0.42 * A, ry: 0.16, rot: 0, col: P.neighbor, a: 0.85 },
    { x: side, y: lerp(0.62, 0.8, r()), rx: 0.22 * A, ry: 0.42, rot: (r() - 0.5) * 0.6, col: P.counter, a: 0.75 },
    { x: A - side, y: 0.02, rx: 0.5 * A, ry: 0.32, rot: 0, col: P.deep, a: 0.6 },
    { x: cx, y: 0.98, rx: 0.2 * A, ry: 0.05, rot: 0, col: P.sheen, a: 0.5 },
  ];
  return { spots, warp: { amp: 0.07, freq: 2.6 }, swirl: { x: cx, y: 1, s: 0.25, r: 0.6 } };
}

function bloom(P: Palette, r: () => number, A: number): Layout {
  // 한쪽 위에 놓인 큰 빛무리를 다른 색들이 감아 돈다.
  const left = r() < 0.5;
  const bx = (left ? lerp(0.08, 0.22, r()) : lerp(0.78, 0.92, r())) * A;
  const by = lerp(0.0, 0.12, r());
  const away = left ? 1 : -1;
  const spots = [
    { x: bx, y: by, rx: 0.5 * A, ry: 0.55, rot: 0, col: P.dominant, a: 0.92 },
    { x: bx + away * 0.28 * A, y: by + 0.32, rx: 0.3 * A, ry: 0.22, rot: away * 0.6, col: P.neighbor, a: 0.8 },
    { x: bx - away * 0.05 * A, y: by + 0.5, rx: 0.22 * A, ry: 0.3, rot: 0.3, col: P.counter, a: 0.7 },
    { x: A - bx, y: 1.05, rx: 0.45 * A, ry: 0.3, rot: 0, col: P.counter, a: 0.55 },
    { x: bx, y: by + 0.05, rx: 0.14 * A, ry: 0.12, rot: 0, col: P.sheen, a: 0.55 },
  ];
  return { spots, warp: { amp: 0.06, freq: 3.6 }, swirl: { x: bx, y: by + 0.15, s: 1.4 * away, r: 0.55 } };
}

function currents(P: Palette, r: () => number, A: number): Layout {
  // 서로 다른 각도로 화면을 가로지르는 두 물결.
  const band = (y0: number, y1: number, cols: Lab[], w: number): Spot[] =>
    cols.map((col, i) => {
      const t = i / (cols.length - 1);
      return { x: lerp(-0.1, 1.1, t) * A, y: lerp(y0, y1, t) + (r() - 0.5) * 0.08, rx: 0.36 * A, ry: w, rot: Math.atan2(y1 - y0, A * 1.2), col, a: 0.85 };
    });
  const up = r() < 0.5;
  const spots = [
    ...band(up ? 0.02 : -0.08, up ? -0.1 : 0.06, [P.dominant, P.neighbor, P.dominant], 0.17),
    ...band(up ? 1.02 : 0.82, up ? 0.8 : 1.02, [P.counter, P.dominant, P.neighbor], 0.15),
    { x: lerp(0.3, 0.7, r()) * A, y: 0.5, rx: 0.5 * A, ry: 0.22, rot: 0, col: P.deep, a: 0.45 },
  ];
  return { spots, warp: { amp: 0.12, freq: 2.2 }, swirl: { x: 0.5 * A, y: 0.5, s: 0.35, r: 0.7 } };
}

const BUILDERS: Record<Composition, Builder> = { aurora, horizon, bloom, currents };

// ---- 장면 ----

// 화면 요소가 없을 때(썸네일 등) 쓰는 조용한 구역: 검색창과 바로가기 서너 줄이 놓이는 자리
export const DEFAULT_CALM: CalmRect = { x0: 0.16, y0: 0.1, x1: 0.84, y1: 0.58 };

// calm: 바로가기 이름이 놓이는 사각형(0~1, 위가 0). 그 안은 바탕 쪽으로 되돌려 조용하게 둔다.
// quiet: 그 구역을 되돌리는 정도. 주지 않으면 판 톤의 기본값, 0이면 조용한 구역이 없다.
export function buildScene({ accent, mode, seed, composition = 'aurora', aspect = 16 / 10, calm = DEFAULT_CALM, quiet }: SceneParams): Scene {
  const P = palette(accent, mode);
  const r = rng(seed);
  const { spots, warp, swirl } = BUILDERS[composition](P, r, aspect);
  const ph = [r(), r(), r(), r()].map((v) => v * Math.PI * 2);
  // 움직임: 색 점마다 작은 타원 궤도. 주기 14~24초
  const orbits = spots.map(() => ({
    w: (Math.PI * 2) / lerp(14, 24, r()),
    p: r() * Math.PI * 2,
    ax: lerp(0.025, 0.05, r()) * aspect,
    ay: lerp(0.02, 0.04, r()),
  }));
  return { A: aspect, base: P.base, quiet: quiet ?? P.quiet, calm, spots: spots.slice(0, MAX_SPOTS), warp, swirl, ph, orbits };
}

// 시각 t(초)의 모습. t = 0이면 정지 그림과 같다.
export function sceneAt(sc: Scene, t: number): Scene {
  if (!t) return sc;
  const spots = sc.spots.map((s, i) => {
    const o = sc.orbits[i];
    return { ...s, x: s.x + o.ax * Math.sin(o.w * t + o.p), y: s.y + o.ay * Math.sin(o.w * 0.8 * t + o.p * 1.3), rot: s.rot + 0.05 * Math.sin(o.w * 0.6 * t) };
  });
  const ph = sc.ph.map((p, i) => p + t * ((Math.PI * 2) / (18 + i * 3)));
  const swirl = { ...sc.swirl, s: sc.swirl.s * (1 + 0.25 * Math.sin((Math.PI * 2 * t) / 20)) };
  return { ...sc, spots, ph, swirl };
}

// 조용한 구역 안이면 1, 밖으로 CALM_FEATHER(화면 높이 비율)만큼 가며 0으로 부드럽게 줄어든다
export const CALM_FEATHER = 0.14;
function calmWeight(sc: Scene, u: number, v: number): number {
  const c = sc.calm;
  const dx = Math.max(c.x0 - u, 0, u - c.x1) * sc.A;
  const dy = Math.max(c.y0 - v, 0, v - c.y1);
  const d = Math.hypot(dx, dy) / CALM_FEATHER;
  if (d >= 1) return 0;
  return 1 - d * d * (3 - 2 * d);
}

// 한 점(u, v: 0~1, v는 위가 0)의 색. FRAG 셰이더와 같은 식이다.
export function fieldAt(sc: Scene, u: number, v: number): Lab {
  const A = sc.A;
  let x = u * A;
  let y = v;
  const f = sc.warp.freq;
  x += sc.warp.amp * (Math.sin(y * f + sc.ph[0]) + 0.5 * Math.sin((x + y) * f * 1.7 + sc.ph[1]));
  y += sc.warp.amp * (Math.sin(x * f * 0.9 + sc.ph[2]) + 0.5 * Math.sin((x - y) * f * 1.3 + sc.ph[3]));
  const sx = x - sc.swirl.x;
  const sy = y - sc.swirl.y;
  const ang = sc.swirl.s * Math.exp(-(sx * sx + sy * sy) / (sc.swirl.r * sc.swirl.r));
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  x = sc.swirl.x + sx * ca - sy * sa;
  y = sc.swirl.y + sx * sa + sy * ca;

  const t = Math.min(1, Math.max(0, (u + v) / 2));
  const b0 = sc.base[0];
  const b1 = sc.base[1];
  const base: Lab = [lerp(b0[0], b1[0], t), lerp(b0[1], b1[1], t), lerp(b0[2], b1[2], t)];
  const c: Lab = [...base];
  for (const s of sc.spots) {
    const dx = x - s.x;
    const dy = y - s.y;
    const cs = Math.cos(s.rot);
    const sn = Math.sin(s.rot);
    const p = (dx * cs + dy * sn) / s.rx;
    const q = (-dx * sn + dy * cs) / s.ry;
    const w = Math.exp(-(p * p + q * q)) * s.a;
    c[0] += (s.col[0] - c[0]) * w;
    c[1] += (s.col[1] - c[1]) * w;
    c[2] += (s.col[2] - c[2]) * w;
  }
  const k = sc.quiet * calmWeight(sc, u, v);
  return [c[0] + (base[0] - c[0]) * k, c[1] + (base[1] - c[1]) * k, c[2] + (base[2] - c[2]) * k];
}

// CPU로 그린다. 가로 width 픽셀.
export function renderCPU(sc: Scene, { width = 320, t = 0, canvas = document.createElement('canvas') }: { width?: number; t?: number; canvas?: HTMLCanvasElement } = {}): HTMLCanvasElement {
  const s = sceneAt(sc, t);
  const W = width;
  const H = Math.round(W / sc.A);
  const img = new ImageData(W, H);
  const d = img.data;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const [R, G, B] = labToRgb8(fieldAt(s, (px + 0.5) / W, (py + 0.5) / H));
      const i = (py * W + px) * 4;
      d[i] = R;
      d[i + 1] = G;
      d[i + 2] = B;
      d[i + 3] = 255;
    }
  }
  canvas.width = W;
  canvas.height = H;
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  return canvas;
}

// ---- GPU ----

const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uA;
uniform vec3 uBase0;
uniform vec3 uBase1;
uniform float uQuiet;
uniform vec4 uCalm;
uniform vec2 uWarp;
uniform vec4 uPh;
uniform vec4 uSwirl;
uniform int uN;
uniform vec4 uPos[${MAX_SPOTS}];
uniform vec4 uRot[${MAX_SPOTS}];
uniform vec3 uCol[${MAX_SPOTS}];

vec3 labToSrgb(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.291485548 * c.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  vec3 lin = vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  lin = clamp(lin, 0.0, 1.0);
  vec3 lo = lin * 12.92;
  vec3 hi = 1.055 * pow(lin, vec3(1.0 / 2.4)) - 0.055;
  return mix(hi, lo, step(lin, vec3(0.0031308)));
}

void main() {
  float u = gl_FragCoord.x / uRes.x;
  float v = 1.0 - gl_FragCoord.y / uRes.y;
  float x = u * uA;
  float y = v;
  float f = uWarp.y;
  x += uWarp.x * (sin(y * f + uPh.x) + 0.5 * sin((x + y) * f * 1.7 + uPh.y));
  y += uWarp.x * (sin(x * f * 0.9 + uPh.z) + 0.5 * sin((x - y) * f * 1.3 + uPh.w));
  float sx = x - uSwirl.x;
  float sy = y - uSwirl.y;
  float ang = uSwirl.z * exp(-(sx * sx + sy * sy) / (uSwirl.w * uSwirl.w));
  float ca = cos(ang);
  float sa = sin(ang);
  x = uSwirl.x + sx * ca - sy * sa;
  y = uSwirl.y + sx * sa + sy * ca;

  vec3 base = mix(uBase0, uBase1, clamp((u + v) * 0.5, 0.0, 1.0));
  vec3 c = base;
  for (int i = 0; i < ${MAX_SPOTS}; i++) {
    if (i >= uN) break;
    vec2 d = vec2(x, y) - uPos[i].xy;
    float p = (d.x * uRot[i].x + d.y * uRot[i].y) / uPos[i].z;
    float q = (-d.x * uRot[i].y + d.y * uRot[i].x) / uPos[i].w;
    float w = exp(-(p * p + q * q)) * uRot[i].z;
    c += (uCol[i] - c) * w;
  }
  float cdx = max(max(uCalm.x - u, 0.0), u - uCalm.z) * uA;
  float cdy = max(max(uCalm.y - v, 0.0), v - uCalm.w);
  float cd = min(length(vec2(cdx, cdy)) / ${CALM_FEATHER.toFixed(4)}, 1.0);
  float k = uQuiet * (1.0 - cd * cd * (3.0 - 2.0 * cd));
  c += (base - c) * k;
  gl_FragColor = vec4(labToSrgb(c), 1.0);
}`;

const UNIFORMS = ['uRes', 'uA', 'uBase0', 'uBase1', 'uQuiet', 'uCalm', 'uWarp', 'uPh', 'uSwirl', 'uN', 'uPos', 'uRot', 'uCol'] as const;
type Uniforms = Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;

export class AuroraGL {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  prog: WebGLProgram;
  u: Uniforms;

  // WebGL을 쓸 수 없으면 create()가 null을 돌려준다
  static create(canvas: HTMLCanvasElement = document.createElement('canvas')): AuroraGL | null {
    const gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: true, alpha: false });
    if (!gl) return null;
    const prog = gl.createProgram();
    const stages: [number, string][] = [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]];
    for (const [type, src] of stages) {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.warn('aurora shader', gl.getShaderInfoLog(sh));
        return null;
      }
      gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    return new AuroraGL(canvas, gl, prog);
  }

  constructor(canvas: HTMLCanvasElement, gl: WebGLRenderingContext, prog: WebGLProgram) {
    this.canvas = canvas;
    this.gl = gl;
    this.prog = prog;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(prog, n)])) as Uniforms;
  }

  // 장면 sc를 시각 t로 width×height 크기에 그린다
  draw(sc: Scene, t: number, width: number, height: number): void {
    const { gl, u, canvas } = this;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    const s = sceneAt(sc, t);
    const n = s.spots.length;
    const pos = new Float32Array(MAX_SPOTS * 4);
    const rot = new Float32Array(MAX_SPOTS * 4);
    const col = new Float32Array(MAX_SPOTS * 3);
    s.spots.forEach((p, i) => {
      pos.set([p.x, p.y, p.rx, p.ry], i * 4);
      rot.set([Math.cos(p.rot), Math.sin(p.rot), p.a, 0], i * 4);
      col.set(p.col, i * 3);
    });
    gl.uniform2f(u.uRes, width, height);
    gl.uniform1f(u.uA, s.A);
    gl.uniform3fv(u.uBase0, s.base[0]);
    gl.uniform3fv(u.uBase1, s.base[1]);
    gl.uniform1f(u.uQuiet, s.quiet);
    gl.uniform4f(u.uCalm, s.calm.x0, s.calm.y0, s.calm.x1, s.calm.y1);
    gl.uniform2f(u.uWarp, s.warp.amp, s.warp.freq);
    gl.uniform4fv(u.uPh, s.ph);
    gl.uniform4f(u.uSwirl, s.swirl.x, s.swirl.y, s.swirl.s, s.swirl.r);
    gl.uniform1i(u.uN, n);
    gl.uniform4fv(u.uPos, pos);
    gl.uniform4fv(u.uRot, rot);
    gl.uniform3fv(u.uCol, col);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

// 화면 해상도로 덮는 잡음 무늬 (CSS background로 쓰고 mix-blend-mode: overlay로 얹는다)
// 잡음의 R 채널을 회색 밝기로 쓰고 불투명도는 일정하게 둔다. overlay에서 50% 회색은 '변화 없음'이라,
// 밝기가 점마다 달라야 결이 생긴다.
export function grainCss(mode: Mode): string {
  const op = mode === 'light' ? 0.35 : 0.45;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'>` +
    `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/>` +
    `<feColorMatrix values='1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 0 ${op}'/></filter>` +
    `<rect width='100%' height='100%' filter='url(%23n)'/></svg>`;
  return `url("data:image/svg+xml,${svg.replace(/</g, '%3C').replace(/>/g, '%3E')}")`;
}
