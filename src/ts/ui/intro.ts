// 처음 실행 안내. 설치하고 처음 새 탭을 열면, 미리 정해 두는 대신 사용자가 하나씩 고른다.
// 고르는 즉시 Store에 저장해서 뒤 화면이 바로 바뀌고, 다 고르면(또는 건너뛰면) 이 PC에 '봤음'을 남긴다.
//
// 첫 페이지에서 이 확장을 써 본 적이 있는지 묻고 길을 나눈다.
//   처음이에요: 판 색 → 배경 종류(그라데이션·단색·내 사진) → 고른 종류의 세부 → 이름 글씨
//   써 봤어요:  쓰던 설정 가져오기 (구글 계정 동기화를 기다리거나, 이 확장의 백업 파일을 불러온다)
// 다른 PC에서 고른 설정이 계정 동기화로 이미 들어왔으면 안내를 띄우지 않는다.
// 'PC 감지'(background.recommendMotion)는 흐르기 스위치 아래 참고 문구로만 쓴다.

import { mountSwatches, CompositionPicker, BGCOLOR_PRESETS } from './pickers.ts';
import { motionBlockedNote } from './settings.ts';
import { toast } from './toast.ts';
import { t } from '../i18n.ts';
import type { Store, Settings, BgType } from '../store.ts';
import type { Sync } from '../sync.ts';
import type { Background } from '../background.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const DONE_KEY = 'introDone';
type Path = 'new' | 'existing';
const PATHS: Record<Path, string[]> = {
  new: ['welcome', 'theme', 'bgtype', 'detail', 'legibility'],
  existing: ['welcome', 'existing'],
};

function motionHint(reason?: string): string {
  if (reason === 'software') return t('motionHintSoftware');
  if (reason === 'battery') return t('motionHintBattery');
  if (reason === 'reduced' || reason === 'nogl') return motionBlockedNote(reason);
  return t('motionHintOk');
}

function legibilityChoices(): [value: string, name: string, note: string][] {
  return [
    ['shadow', t('legShadow'), t('legNoteShadow')],
    ['dim', t('legDim'), t('legNoteDimIntro')],
    ['card', t('legCard'), t('legNoteCard')],
  ];
}

export class Intro {
  store: Store;
  background: Background;
  sync: Sync;
  dlg: HTMLDialogElement;
  updateAccent: (settings: Settings) => void;
  updateBgColor: (settings: Settings) => void;
  thumbs: CompositionPicker;
  // 배경 종류 페이지에서 누른 것. 사진은 고르는 중에도 사진 세부를 보이려고 따로 기억한다.
  chosenType: BgType | null = null;
  #path: Path = 'new';
  #index = 0;

  constructor(store: Store, background: Background, sync: Sync, { onImport, pickPhoto }: { onImport: () => void; pickPhoto: () => void }) {
    this.store = store;
    this.background = background;
    this.sync = sync;
    this.dlg = $<HTMLDialogElement>('intro');

    $('intro-path').addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('button[data-v]');
      if (!b) return;
      this.#path = b.dataset.v as Path;
      this.#go(1);
    });

    this.updateAccent = mountSwatches($('intro-accent'), store);
    this.updateBgColor = mountSwatches($('intro-bgcolor'), store, { key: 'bgColor', labelKey: 'labelBgColor', presets: BGCOLOR_PRESETS });
    this.thumbs = new CompositionPicker($('intro-thumbs'), store);
    $('intro-more').addEventListener('click', () => this.thumbs.more());
    $('intro-photo').addEventListener('click', pickPhoto);
    $('intro-motion').addEventListener('change', (e) => store.setSettings({ bgMotion: (e.target as HTMLInputElement).checked ? 'motion' : 'static' }));

    // 배경 종류: 사진은 아직 없으면 고르는 단계(안내 → 파일)를 거친 뒤에야 '내 사진'이 된다
    $('intro-bgtype').addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('button[data-v]');
      if (!b) return;
      this.chosenType = b.dataset.v as BgType;
      if (b.dataset.v === 'image' && !store.bgImage) pickPhoto();
      else store.setSettings({ bgType: b.dataset.v as BgType });
      this.render();
    });

    const leg = $('intro-legibility');
    for (const [v, name, note] of legibilityChoices()) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.v = v;
      const b = document.createElement('b');
      b.textContent = name;
      const span = document.createElement('span');
      span.textContent = note;
      btn.append(b, span);
      leg.append(btn);
    }
    for (const group of this.dlg.querySelectorAll<HTMLElement>('[data-intro-setting]')) {
      group.addEventListener('click', (e) => {
        const b = (e.target as Element).closest<HTMLElement>('button[data-v]');
        if (b) store.setSettings({ [group.dataset.introSetting!]: b.dataset.v });
      });
    }

    // 쓰던 설정 가져오기
    $('intro-import').addEventListener('click', onImport);
    $('intro-sync-now').addEventListener('click', () => sync.reconcile());
    sync.addEventListener('status', () => this.dlg.open && this.render());

    $('intro-prev').addEventListener('click', () => this.#go(this.#index - 1));
    $('intro-next').addEventListener('click', () => (this.#isLast() ? this.dlg.close() : this.#go(this.#index + 1)));
    $('intro-skip').addEventListener('click', () => this.dlg.close());
    // 다 고르든, 건너뛰든, Esc로 닫든 다시 띄우지 않는다
    this.dlg.addEventListener('close', async () => {
      await chrome.storage.local.set({ [DONE_KEY]: true });
      toast(t('toastSettingsAnytime'));
    });
    store.addEventListener('change', () => this.dlg.open && this.render());
  }

  // 처음 새 탭이면 띄운다. sync.start()가 끝난 뒤에 부른다.
  async maybeShow(): Promise<void> {
    const done = (await chrome.storage.local.get(DONE_KEY))[DONE_KEY];
    if (done) return;
    if (this.store.syncState.receivedFrom) {
      await chrome.storage.local.set({ [DONE_KEY]: true });
      return;
    }
    this.open();
  }

  open(): void {
    this.chosenType = null;
    this.#path = 'new';
    this.#go(0);
    if (!this.dlg.open) this.dlg.showModal();
  }

  get #pages(): string[] {
    return PATHS[this.#path];
  }

  #isLast(): boolean {
    return this.#index === this.#pages.length - 1;
  }

  #go(index: number): void {
    this.#index = Math.min(this.#pages.length - 1, Math.max(0, index));
    this.render();
  }

  render(): void {
    const { settings, bgImage } = this.store;
    const page = this.#pages[this.#index];
    // 세부 페이지는 배경 종류에서 고른 것만 보인다. 사진을 고르는 중이면 사진 세부를 보인다.
    const type = this.chosenType ?? settings.bgType;
    for (const sec of this.dlg.querySelectorAll<HTMLElement>('section[data-page]')) {
      sec.hidden = sec.dataset.page !== page || Boolean(sec.dataset.bgtype && sec.dataset.bgtype !== type);
    }
    // 몇 단계인지는 길을 고른 뒤에야 정해지므로 첫 페이지에서는 점을 감춘다
    $('intro-dots').hidden = page === 'welcome';
    $('intro-dots').replaceChildren(
      ...Array.from({ length: this.#pages.length }, (_, i) => {
        const dot = document.createElement('i');
        dot.classList.toggle('on', i <= this.#index);
        return dot;
      }),
    );
    // 첫 페이지는 두 길 중 하나를 눌러야 넘어간다
    $('intro-next').hidden = page === 'welcome';
    $('intro-prev').hidden = page === 'welcome';
    $('intro-next').textContent = this.#isLast() ? t('btnStart') : t('btnNext');

    for (const group of this.dlg.querySelectorAll<HTMLElement>('[data-intro-setting]')) {
      const v = settings[group.dataset.introSetting as keyof Settings];
      for (const b of group.querySelectorAll<HTMLElement>('button[data-v]')) b.setAttribute('aria-pressed', String(b.dataset.v === v));
    }
    for (const b of $('intro-bgtype').querySelectorAll<HTMLElement>('button')) b.setAttribute('aria-pressed', String(b.dataset.v === type));

    if (page === 'detail' && type === 'gradient') {
      this.updateAccent(settings);
      this.thumbs.render();
      $<HTMLInputElement>('intro-motion').checked = settings.bgMotion === 'motion';
      $('intro-motion-hint').textContent = motionHint(this.background.recommendMotion().reason);
    }
    if (page === 'detail' && type === 'color') this.updateBgColor(settings);
    if (page === 'detail' && type === 'image') {
      // 이미 저장된 사진이 있으면 그 사진이 어디서 왔는지 밝히고, 다른 사진으로 바꿀 수 있게 한다
      $('intro-photo-thumb').style.backgroundImage = bgImage ? `url("${bgImage}")` : 'none';
      $('intro-photo-origin').hidden = !bgImage;
      $('intro-photo').textContent = bgImage ? t('btnPickOtherPhoto') : t('btnPickPhoto');
    }
    if (page === 'existing') this.#renderSync();
  }

  // 구글 계정 동기화로 다른 PC의 설정을 받았는지
  #renderSync(): void {
    const st = this.sync.status;
    let state = 'idle';
    let text = t('introSyncIdle');
    if (this.store.syncState.receivedFrom) {
      state = 'ok';
      text = t('introSyncReceived', this.store.shortcuts.length);
    } else if (st.state === 'off') {
      state = 'off';
      text = t('introSyncOff');
    } else if (st.state === 'error') {
      state = 'error';
      text = t('toastSyncFailed', st.message ?? '');
    } else if (st.state === 'syncing' || st.state === 'waiting') {
      text = t('introSyncChecking');
    }
    $('intro-sync-dot').dataset.state = state;
    $('intro-sync-text').textContent = text;
  }
}
