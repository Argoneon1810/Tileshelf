// 판 밝기(설정 panelTone, 0~100) → 유리 판 색.
// 판 밝기 하나를 두고 글자 시인성과 아이콘 시인성이 맞바뀐다. 어느 쪽을 택할지는 앱 사용자가 고른다.
//   0   글자 쪽 끝: 원래 유리색. 판 위 글자가 가장 잘 읽히고, 바탕 없는 로고는 판에 묻힐 수 있다.
//   50  기본: 모든 판을 하나로 맞춘 중간색(어두운 테마 #454e59, 밝은 테마 #d5dfee).
//   100 아이콘 쪽 끝: 아이콘이 가장 잘 보이는 회색. 흐린 설명 글자는 약해진다.
// 세 기준점 사이를 sRGB로 곧게 잇는다. 색의 출처와 까닭은 color-preset.md(1.3.1).
// 유리 판(--glass)과 아이콘 판(--ic-panel)은 같은 색을 쓴다(판끼리 색이 어긋나지 않게).

export type Rgb = readonly [number, number, number];
export type ThemeMode = 'dark' | 'light';

export const DEFAULT_PANEL_TONE = 50;

const ANCHORS: Record<ThemeMode, readonly [Rgb, Rgb, Rgb]> = {
  dark: [
    [25, 29, 35], // 원래 유리 #191d23
    [69, 78, 89], // 중립 800 #454e59
    [96, 106, 118], // 중립 700 #606a76
  ],
  light: [
    [244, 247, 251], // 원래 유리 #f4f7fb
    [213, 223, 238], // 중립 200 #d5dfee
    [194, 205, 219], // 중립 300 #c2cddb
  ],
};

// 저장소·동기화·백업에서 들어온 값을 0~100 정수로 맞춘다. 알 수 없는 값은 기본값.
export function clampPanelTone(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : DEFAULT_PANEL_TONE;
}

export function panelColor(mode: ThemeMode, tone: number): Rgb {
  const t = clampPanelTone(tone);
  const [a, mid, b] = ANCHORS[mode];
  const [from, to, f] = t <= 50 ? [a, mid, t / 50] : [mid, b, (t - 50) / 50];
  return [0, 1, 2].map((i) => Math.round(from[i] + (to[i] - from[i]) * f)) as unknown as Rgb;
}

// CSS의 rgba(var(--glass), a) 꼴에 그대로 넣는 'r, g, b' 글
export const rgbTriplet = (c: Rgb): string => `${c[0]}, ${c[1]}, ${c[2]}`;

// 판 색을 화면에 입힌다. 유리 판과 아이콘 판이 같은 색을 쓴다.
// main.ts가 테마나 설정이 바뀔 때, 설정 화면이 슬라이더를 움직이는 동안(저장 전 미리보기) 부른다.
export function applyPanelTone(root: HTMLElement, mode: ThemeMode, tone: number): void {
  const rgb = rgbTriplet(panelColor(mode, tone));
  root.style.setProperty('--glass', rgb);
  root.style.setProperty('--ic-panel', rgb);
  // 다음 새 탭에서 boot.ts가 저장소를 읽기 전에 같은 판 색을 먼저 깔도록 남긴다(가운데 값이 잠깐 비치지 않게)
  try {
    localStorage.setItem(BOOT_PANEL_KEY, rgb);
  } catch {
    /* 저장할 수 없으면 다음 새 탭에서 잠깐 기본 판 색이 보일 뿐이다 */
  }
}

export const BOOT_PANEL_KEY = 'bootPanel';
