// 새 탭의 배경을 그린다: 내 사진, 단색, 정지 그라데이션, 흐르는 그라데이션.
//
// 흐르는 그라데이션은 GPU(WebGL)로 초당 30장까지 그리고, 다음 때는 멈춘다.
//   - 탭이 보이지 않을 때 (visibilitychange)
//   - 시스템의 '동작 줄이기'가 켜져 있을 때 (정지 화면으로 둔다)
//   - WebGL을 쓸 수 없을 때 (CPU로는 한 장에 80ms쯤 걸려 움직임을 감당하지 못한다)
// 흐르기를 쓸지는 사용자가 처음 실행 안내(intro.ts)에서 고른다. recommendMotion()은 그때 보여 줄
// 권장만 낸다: 그래픽 장치가 소프트웨어(SwiftShader, llvmpipe, Microsoft Basic Render)이거나
// 배터리로 돌며 20% 아래면 정지를 권한다. 소프트웨어 장치에서는 CPU가 대신 그린다.
// 그라데이션은 색 변화가 매끄러워서 화면 해상도의 절반으로 그려도 늘렸을 때 차이가 없다.
//
// 그림이 바뀔 때(강조색, 판 색, 구도, 조용한 구역, 정지로 돌아가기)는 바뀌기 직전 그림을 위에 덮어 두고
// FADE_MS 동안 걷어 내어 섞이듯 바뀌게 한다. 같은 그림이면 다시 그리지 않는다.
// 정지 그림은 늘 0초의 모습이고, 흐르기는 0초에서 시작한다. 그래서 정지 → 흐르기는 튀지 않고,
// 흐르기 → 정지는 0초 모습으로 섞으며 돌아간다.
//
// 새 탭을 열 때 그림이 늦게 떠서 깜빡이지 않도록, 마지막 배경(0초 모습)을 작은 jpeg로 localStorage에
// 남긴다. boot.ts가 페이지 맨 처음에 그것을 깔아 둔다.

import { buildScene, AuroraGL, renderCPU, grainCss } from './aurora.ts';
import type { Scene, Mode, Composition, CalmRect } from './aurora.ts';
import type { BgMotion } from './store.ts';

export interface GradientParams {
  accent: string;
  mode: Mode;
  composition: Composition;
  seed: number;
  motion: BgMotion;
  calmZone: boolean;
}

export type MotionReason = 'nogl' | 'reduced' | 'software' | 'battery';

// navigator.getBattery는 DOM 타입 정의에 없다 (Chrome에만 있는 Battery Status API)
interface BatteryManager extends EventTarget {
  charging: boolean;
  level: number;
}
type BatteryNavigator = Navigator & { getBattery?: () => Promise<BatteryManager> };

interface ShownImage {
  url?: string;
  fit?: string;
  color?: string;
  theme?: Mode;
  calmZone: boolean;
}

interface BootEntry {
  theme?: Mode;
  bg: 'image' | 'color' | 'gradient';
  key: string;
  source?: string;
  color?: string;
}

const FPS = 30;
const SCALE = 0.5;
const FADE_MS = 600;
const BOOT_KEY = 'bootBg';
const BOOT_W = 480;

export class Background {
  el: HTMLElement;
  calm: () => CalmRect | undefined;
  canvas: HTMLCanvasElement;
  fade: HTMLCanvasElement;
  grain: HTMLElement;
  gl: AuroraGL | null;
  renderer: string;
  software: boolean;
  reduced: MediaQueryList;
  #scene: Scene | null = null;
  #sceneKey = '';
  #params: GradientParams | null = null;
  #motion = false;
  #raf = 0;
  #start = 0;
  #last = 0;
  #batteryLow = false;
  #image: ShownImage | null = null;

  // calm: 바로가기가 놓인 자리(0~1 사각형)를 돌려주는 함수. 배경은 그 자리를 조용하게 그린다.
  constructor(el: HTMLElement, { calm = () => undefined }: { calm?: () => CalmRect | undefined } = {}) {
    this.el = el;
    this.calm = calm;
    this.canvas = el.querySelector<HTMLCanvasElement>('canvas.main')!;
    this.fade = el.querySelector<HTMLCanvasElement>('canvas.fade')!;
    this.grain = el.querySelector<HTMLElement>('.grain')!;
    this.gl = AuroraGL.create(this.canvas);
    this.renderer = this.gl ? rendererName(this.gl.gl) : '';
    this.software = /swiftshader|llvmpipe|software|basic render/i.test(this.renderer);
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    (navigator as BatteryNavigator).getBattery?.().then((b) => {
      const update = () => (this.#batteryLow = !b.charging && b.level < 0.2);
      update();
      b.addEventListener('chargingchange', update);
      b.addEventListener('levelchange', update);
    }).catch(() => {});
    this.reduced.addEventListener('change', () => this.#params && this.showGradient(this.#params));
    document.addEventListener('visibilitychange', () => (document.hidden ? this.#stop() : this.#motion && this.#run()));
    this.fade.addEventListener('transitionend', () => (this.fade.hidden = true));
    let timer: ReturnType<typeof setTimeout> | undefined;
    addEventListener('resize', () => {
      clearTimeout(timer);
      timer = setTimeout(() => this.updateCalm(), 150);
    });
  }

  // 움직임 설정(static | motion)에 따라 지금 흐를지와, 흐르기를 골랐는데 멈춘다면 그 이유
  // reason: nogl (WebGL 없음) | reduced (시스템의 '동작 줄이기')
  motionStatus(setting: BgMotion): { move: boolean; reason?: 'nogl' | 'reduced' } {
    if (setting !== 'motion') return { move: false };
    if (!this.gl) return { move: false, reason: 'nogl' };
    if (this.reduced.matches) return { move: false, reason: 'reduced' };
    return { move: true };
  }

  // 처음 실행 안내에서 보여 줄 권장. reason: nogl | reduced | software | battery
  recommendMotion(): { recommend: BgMotion; reason?: MotionReason } {
    const st = this.motionStatus('motion');
    if (!st.move) return { recommend: 'static', reason: st.reason };
    if (this.software) return { recommend: 'static', reason: 'software' };
    if (this.#batteryLow) return { recommend: 'static', reason: 'battery' };
    return { recommend: 'motion' };
  }

  // calmZone: 바로가기 자리 뒤에 흐린 그늘을 깐다 ('가운데 그늘' 글씨 처리)
  showImage(url: string, fit: string, { theme, calmZone = false }: { theme?: Mode; calmZone?: boolean } = {}): void {
    this.#leaveGradient();
    this.#image = { url, fit, theme, calmZone };
    this.el.style.backgroundColor = '';
    this.el.style.backgroundImage = `url("${url}")`;
    this.el.dataset.fit = fit;
    this.#placeShade(calmZone);
    this.#saveBoot({ theme, bg: 'image', key: 'image:' + url.length + ':' + url.slice(-64), source: url });
  }

  // 단색 배경
  showColor(color: string, { theme, calmZone = false }: { theme?: Mode; calmZone?: boolean } = {}): void {
    this.#leaveGradient();
    this.#image = { color, theme, calmZone };
    this.el.style.backgroundImage = 'none';
    this.el.style.backgroundColor = color;
    this.el.dataset.fit = 'color';
    this.#placeShade(calmZone);
    this.#saveBoot({ theme, bg: 'color', key: 'color:' + color, color });
  }

  // params: { accent, mode, composition, seed, motion: 'static' | 'motion', calmZone }
  // calmZone이 거짓이면 바로가기 자리를 조용하게 그리지 않는다 (다른 글씨 처리를 고른 경우)
  showGradient(params: GradientParams, { fade = true }: { fade?: boolean } = {}): void {
    const wasShowing = Boolean(this.#params) && !this.canvas.hidden;
    this.#params = params;
    this.#image = null;
    this.#placeShade(false);
    this.el.style.backgroundImage = '';
    this.el.style.backgroundColor = '';
    this.el.dataset.fit = 'gradient';
    this.canvas.hidden = false;
    this.grain.hidden = false;
    this.grain.style.backgroundImage = grainCss(params.mode);

    const calm = this.calm();
    const key = JSON.stringify({ ...params, motion: 0, w: innerWidth, h: innerHeight, calm });
    const move = this.motionStatus(params.motion).move;
    const sceneChanged = key !== this.#sceneKey;
    // 흐르다가 멈출 때는 0초 모습으로 섞으며 돌아간다
    const backToStill = this.#motion && !move;
    if (!sceneChanged && !backToStill && move === this.#motion) return;

    if (wasShowing && fade && (sceneChanged || backToStill)) this.#fadeFrom(this.canvas);
    if (sceneChanged) {
      this.#scene = buildScene({ ...params, aspect: innerWidth / innerHeight, ...(calm && { calm }), ...(!params.calmZone && { quiet: 0 }) });
      this.#sceneKey = key;
    }
    if (move && !this.#motion) this.#last = 0; // 정지(0초) 모습에서 그대로 흐르기 시작
    if (!move) {
      this.#stop();
      this.#last = 0;
    }
    this.#motion = move;
    this.#paint(this.#last / 1000);
    if (sceneChanged) this.#saveBoot({ theme: params.mode, bg: 'gradient', key });
    if (move) this.#run();
  }

  // 바로가기 수가 바뀌거나 창 크기가 바뀌어 자리가 달라졌을 때
  updateCalm(): void {
    if (this.#params) this.showGradient(this.#params);
    else if (this.#image) this.#placeShade(this.#image.calmZone);
  }

  // 시험용: 흐르기를 멈추고 시각 t의 모습으로 둔다
  freezeAt(t: number): void {
    this.#stop();
    this.#motion = false;
    if (this.#scene) this.#paint(t);
  }

  #leaveGradient(): void {
    this.#stop();
    this.#motion = false;
    this.#params = null;
    this.#sceneKey = '';
    this.canvas.hidden = true;
    this.grain.hidden = true;
  }

  // 지금 보이는 그림을 덮개 캔버스에 옮겨 두고 서서히 걷어 낸다
  #fadeFrom(src: HTMLCanvasElement): void {
    if (this.reduced.matches) return;
    const f = this.fade;
    f.width = src.width;
    f.height = src.height;
    f.getContext('2d')!.drawImage(src, 0, 0);
    f.style.transition = 'none';
    f.style.opacity = '1';
    f.hidden = false;
    void f.offsetWidth; // 위 상태를 먼저 그리게 한 뒤 전환을 건다
    f.style.transition = `opacity ${FADE_MS}ms ease-in-out`;
    f.style.opacity = '0';
  }

  // 사진·단색 위 '가운데 그늘': 바로가기 자리만 한 흐린 검은 판
  #placeShade(on: boolean): void {
    const shade = this.el.querySelector<HTMLElement>('.calm-shade')!;
    const c = on && this.calm();
    shade.classList.toggle('on', Boolean(c));
    if (!c) return;
    Object.assign(shade.style, {
      left: c.x0 * 100 + '%',
      top: c.y0 * 100 + '%',
      width: (c.x1 - c.x0) * 100 + '%',
      height: (c.y1 - c.y0) * 100 + '%',
    });
  }

  #paint(t: number): void {
    if (!this.#scene) return;
    if (this.gl) {
      this.gl.draw(this.#scene, t, Math.max(2, Math.round(innerWidth * SCALE)), Math.max(2, Math.round(innerHeight * SCALE)));
    } else {
      renderCPU(this.#scene, { width: 320, t, canvas: this.canvas });
    }
  }

  #run(): void {
    if (this.#raf || document.hidden) return;
    // 이어서 흐르도록 시작 시각을 지금까지 흐른 만큼 당겨 둔다
    this.#start = performance.now() - this.#last;
    const frame = (now: number): void => {
      this.#raf = requestAnimationFrame(frame);
      const t = now - this.#start;
      if (t - this.#last < 1000 / FPS) return;
      this.#last = t;
      this.#paint(t / 1000);
    };
    this.#raf = requestAnimationFrame(frame);
  }

  #stop(): void {
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
  }

  // 다음에 새 탭을 열 때 맨 처음 깔 작은 그림(그라데이션은 0초 모습)을 남긴다. 같은 그림이면 다시 쓰지 않는다.
  #saveBoot({ theme, bg, key, source, color }: BootEntry): void {
    try {
      const prev = JSON.parse(localStorage.getItem(BOOT_KEY) ?? 'null');
      if (prev?.key === key && prev?.theme === theme) return;
    } catch {
      /* 깨진 값이면 새로 쓴다 */
    }
    const write = (url: string | null): void => {
      try {
        localStorage.setItem(BOOT_KEY, JSON.stringify({ key, theme, bg, url, color }));
      } catch {
        /* 공간이 모자라면 깜빡임 방지만 포기한다 */
      }
    };
    if (bg === 'color') return write(null);
    const c = document.createElement('canvas');
    if (bg === 'gradient') {
      const h = Math.round(BOOT_W * (innerHeight / innerWidth));
      c.width = BOOT_W;
      c.height = h;
      // 흐르는 중이면 0초 모습을 잠깐 그려 옮기고 바로 되돌린다 (같은 작업 안이라 화면에는 안 보인다)
      if (this.#last) this.#paint(0);
      c.getContext('2d')!.drawImage(this.canvas, 0, 0, BOOT_W, h);
      if (this.#last) this.#paint(this.#last / 1000);
      write(c.toDataURL('image/jpeg', 0.85));
    } else {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, 960 / img.width);
        c.width = Math.round(img.width * s);
        c.height = Math.round(img.height * s);
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        write(c.toDataURL('image/jpeg', 0.8));
      };
      img.src = source ?? '';
    }
  }
}

function rendererName(gl: WebGLRenderingContext): string {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
}
