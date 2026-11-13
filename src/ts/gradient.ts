// 강조색 목록과 OKLCH 색 변환. 배경 그림 자체는 aurora.ts가 그린다.

export type AccentPreset = readonly [key: string, name: string, hex: string];

export const ACCENT_PRESETS: readonly AccentPreset[] = [
  // [키, 이름, 색] 색은 OKLCH에서 고르고 mcp-color-convert로 hex로 바꾼 값
  ['blue', '블루', '#4087de'],
  ['purple', '퍼플', '#9163d5'],
  ['pink', '핑크', '#df5e97'],
  ['red', '레드', '#db4241'],
  ['orange', '오렌지', '#e87f25'],
  ['yellow', '옐로', '#ecbe24'],
  ['green', '그린', '#3eab5e'],
  ['teal', '틸', '#12a7a7'],
  ['graphite', '그래파이트', '#767b80'],
];

export interface Oklch {
  L: number;
  C: number;
  h: number;
}

type Rgb = [number, number, number];

// ---- OKLab (Björn Ottosson, https://bottosson.github.io/posts/oklab/) ----

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

const channels = (n: number): Rgb => [(n >> 16) & 255, (n >> 8) & 255, n & 255];

export function hexToOklch(hex: string): Oklch {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const [r, g, b] = channels(n).map((v) => toLinear(v / 255)) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  const h = C < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { L, C, h };
}

function oklchToLinear(L: number, C: number, h: number): Rgb {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: Rgb): boolean => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

// sRGB 밖의 색이면 명도·색상각은 두고 채도만 줄여서 안으로 들인다.
export function oklchToRgb(L: number, C: number, h: number): Rgb {
  let rgb = oklchToLinear(L, C, h);
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear(L, mid, h))) lo = mid;
      else hi = mid;
    }
    rgb = oklchToLinear(L, lo, h);
  }
  return rgb.map((v) => Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, v))))) * 255)) as Rgb;
}

// 배경색 위에서 더 잘 읽히는 글자색: 흰색과 판 글자색(#1d2229) 중 대비가 큰 쪽 (WCAG 상대 휘도)
export function readableOn(hex: string): '#ffffff' | '#1d2229' {
  const lum = (h: string): number => {
    const n = parseInt(h.slice(1), 16);
    const [r, g, b] = channels(n).map((v) => toLinear(v / 255)) as Rgb;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const bg = lum(hex);
  const ratio = (t: number): number => (Math.max(t, bg) + 0.05) / (Math.min(t, bg) + 0.05);
  return ratio(lum('#ffffff')) >= ratio(lum('#1d2229')) ? '#ffffff' : '#1d2229';
}

export function oklchToHex(L: number, C: number, h: number): string {
  return '#' + oklchToRgb(L, C, h).map((v) => v.toString(16).padStart(2, '0')).join('');
}
