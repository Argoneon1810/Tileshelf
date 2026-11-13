// 설정 서랍과 처음 실행 안내가 함께 쓰는 고르기 조각: 색 단추(강조색, 단색 배경), 구도 썸네일.

import { ACCENT_PRESETS } from '../gradient.ts';
import type { AccentPreset } from '../gradient.ts';
import { buildScene, AuroraGL, renderCPU, COMPOSITIONS, rng } from '../aurora.ts';
import type { Composition } from '../aurora.ts';
import type { Store, Settings } from '../store.ts';
import { t } from '../i18n.ts';
import type { MessageKey } from '../i18n.ts';

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

// 단색 배경으로 고를 만한 색: color-preset.md의 회색 단계(대표색을 머금은 회색)에서 골랐다
export const BGCOLOR_PRESETS: readonly AccentPreset[] = [
  ['night', '밤', '#0f1720'],
  ['ink', '먹', '#29323c'],
  ['slate', '돌', '#454e59'],
  ['mist', '안개', '#d5dfee'],
  ['snow', '눈', '#eef6ff'],
];

function swatchName(group: 'accent' | 'bgColor', presetKey: string, fallback: string): string {
  const msgKey = (group === 'bgColor' ? `bgcolor_${presetKey}` : `accent_${presetKey}`) as MessageKey;
  return t(msgKey) || fallback;
}

function compName(comp: Composition): string {
  return t(`comp_${comp}` as MessageKey);
}

// 미리 고른 색 단추들 + 직접 고르기(색상환). key는 저장할 설정 이름(accent, bgColor).
// 돌려주는 함수로 선택 표시를 맞춘다.
export interface SwatchOptions {
  key?: 'accent' | 'bgColor';
  labelKey?: MessageKey;
  presets?: readonly AccentPreset[];
  inputId?: string;
  extra?: Partial<Settings>;
}

export function mountSwatches(
  box: HTMLElement,
  store: Store,
  { key = 'accent', labelKey = 'labelAccent', presets = ACCENT_PRESETS, inputId, extra = {} }: SwatchOptions = {},
): (settings: Settings) => void {
  const label = t(labelKey);
  box.classList.add('swatches');
  for (const [presetKey, fallbackName, hex] of presets) {
    const name = swatchName(key, presetKey, fallbackName);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.dataset.v = hex;
    b.title = name;
    b.setAttribute('aria-label', label + ' ' + name);
    b.style.setProperty('--sw', hex);
    box.append(b);
  }
  const custom = document.createElement('label');
  custom.className = 'swatch custom';
  custom.title = t('swatchCustomTitle');
  const input = document.createElement('input');
  input.type = 'color';
  input.setAttribute('aria-label', t('swatchCustomAria', label));
  if (inputId) input.id = inputId;
  custom.append(input);
  box.append(custom);

  box.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('button.swatch');
    if (b) store.setSettings({ [key]: b.dataset.v, ...extra });
  });
  // 직접 고를 때는 끄는 동안 저장하지 않고 손을 뗄 때 한 번만 저장한다 (계정 쓰기 횟수 한도)
  input.addEventListener('change', () => store.setSettings({ [key]: input.value, ...extra }));

  return (settings) => {
    const v = settings[key];
    for (const b of box.querySelectorAll<HTMLElement>('button.swatch')) b.setAttribute('aria-pressed', String(same(b.dataset.v!, v)));
    custom.classList.toggle('chosen', !presets.some((p) => same(p[2], v)));
    custom.style.setProperty('--sw', v);
    input.value = v;
  };
}

const VARIANTS = 3;
const THUMB_W = 192;
const THUMB_H = 120;
let thumbGL: AuroraGL | null | undefined;

// 구도 ci의 k번째 변형 씨앗. 어느 PC에서나 같은 목록이 나오도록 정해진 식으로 만든다.
function variantSeed(ci: number, k: number): number {
  return (rng(ci * 7919 + k * 104729 + 1)() * 2 ** 31) >>> 0 || 1;
}

// 구도마다 변형 3개를 썸네일로 그린다. 지금 고른 변형은 늘 그 구도의 첫 칸에 둔다.
export class CompositionPicker {
  box: HTMLElement;
  store: Store;
  #page = 0; // '다른 변형 보기'를 누른 횟수

  constructor(box: HTMLElement, store: Store) {
    this.box = box;
    this.store = store;
    box.classList.add('thumbs');
    box.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('.thumb-btn');
      if (b) store.setSettings({ bgComposition: b.dataset.comp as Composition, bgSeed: Number(b.dataset.seed), bgType: 'gradient' });
    });
  }

  more(): void {
    this.#page++;
    this.render();
  }

  render(): void {
    const { accent, bgComposition, bgSeed, bgType } = this.store.settings;
    const mode = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    if (thumbGL === undefined) thumbGL = AuroraGL.create();
    this.box.replaceChildren();
    COMPOSITIONS.forEach((comp, ci) => {
      const seeds = Array.from({ length: VARIANTS }, (_, k) => variantSeed(ci, this.#page * VARIANTS + k));
      if (comp === bgComposition && !seeds.includes(bgSeed)) seeds[0] = bgSeed;
      const row = document.createElement('div');
      row.className = 'comp';
      const title = document.createElement('span');
      const labelText = compName(comp);
      title.textContent = labelText;
      const vars = document.createElement('div');
      vars.className = 'vars';
      row.append(title, vars);
      for (const seed of seeds) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'thumb-btn';
        b.dataset.comp = comp;
        b.dataset.seed = String(seed);
        b.setAttribute('aria-label', t('compVariantAria', labelText));
        b.setAttribute('aria-pressed', String(bgType !== 'image' && comp === bgComposition && seed === bgSeed));
        const c = document.createElement('canvas');
        c.width = THUMB_W;
        c.height = THUMB_H;
        const sc = buildScene({ accent, mode, seed, composition: comp, aspect: THUMB_W / THUMB_H });
        if (thumbGL) {
          thumbGL.draw(sc, 0, THUMB_W, THUMB_H);
          c.getContext('2d')!.drawImage(thumbGL.canvas, 0, 0);
        } else {
          c.getContext('2d')!.drawImage(renderCPU(sc, { width: THUMB_W / 2 }), 0, 0, THUMB_W, THUMB_H);
        }
        b.append(c);
        vars.append(b);
      }
      this.box.append(row);
    });
  }
}
