// 오른쪽 설정 서랍. 조작을 Store에 반영하고, Store·동기화 상태가 바뀌면 다시 그린다.

import { TOTAL_LIMIT } from '../syncdoc.ts';
import { readFile, makeBackground } from '../images.ts';
import { mountSwatches, CompositionPicker, BGCOLOR_PRESETS } from './pickers.ts';
import { toast } from './toast.ts';
import { t, formatCheckpointTime } from '../i18n.ts';
import type { MessageKey } from '../i18n.ts';
import type { Store, Settings, BgFit, Legibility, SearchGroupKind, Theme, TileSize, BgType } from '../store.ts';
import type { Sync, SyncStatus, SyncStateName, HistoryEntry } from '../sync.ts';
import type { Background } from '../background.ts';
import { describe } from '../checkpoints.ts';
import { applyPanelTone } from '../panel-tone.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

export type SubPage = 'background' | 'legibility' | 'display' | 'sync' | 'history' | 'backup';

const PAGE_TITLE_KEYS: Record<SubPage, MessageKey> = {
  background: 'pageBackground',
  legibility: 'pageLegibility',
  display: 'pageDisplay',
  sync: 'pageSync',
  history: 'pageHistory',
  backup: 'pageBackup',
};

const SECTION_TO_PAGE: Record<string, SubPage> = {
  'sec-background': 'background',
  'sec-legibility': 'legibility',
  'sec-display': 'display',
  'sec-sync': 'sync',
  'sec-history': 'history',
  'sec-backup': 'backup',
  background: 'background',
  legibility: 'legibility',
  display: 'display',
  sync: 'sync',
  history: 'history',
  backup: 'backup',
};

const BG_LABEL_KEYS: Record<BgType, MessageKey> = {
  gradient: 'bgGradient',
  color: 'bgColor',
  image: 'bgImage',
};

const THEME_LABEL_KEYS: Record<Theme, MessageKey> = {
  system: 'themeSystem',
  dark: 'themeDark',
  light: 'themeLight',
};

const SIZE_LABEL_KEYS: Record<TileSize, MessageKey> = {
  sm: 'sizeSm',
  md: 'sizeMd',
  lg: 'sizeLg',
};

const SEARCH_GROUP_LABEL_KEYS: Record<SearchGroupKind, MessageKey> = {
  shortcuts: 'searchLabelShortcuts',
  url: 'searchGroupUrl',
  web: 'searchGroupWeb',
};

const GRIP_DOTS: readonly [number, number][] = [
  [5.5, 3.5],
  [10.5, 3.5],
  [5.5, 8],
  [10.5, 8],
  [5.5, 12.5],
  [10.5, 12.5],
];

function createGripIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  for (const [cx, cy] of GRIP_DOTS) {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', String(cx));
    c.setAttribute('cy', String(cy));
    c.setAttribute('r', '1.3');
    svg.append(c);
  }
  return svg;
}

const STATUS_TEXT_KEYS: Record<string, MessageKey> = {
  idle: 'syncStatusIdle',
  syncing: 'syncStatusSyncing',
  waiting: 'syncStatusWaiting',
  empty: 'syncStatusEmpty',
  ok: 'syncStatusOk',
  uploaded: 'syncStatusUploaded',
  off: 'syncStatusOff',
  error: 'syncStatusError',
  'too-big': 'syncStatusTooBig',
};

// 계정에 쓰기만 하고 다른 PC의 판을 받은 적이 없으면 '맞춰짐'으로 보이지 않게 한다
export function shownState(st: SyncStatus): SyncStateName | 'uploaded' {
  return st.state === 'ok' && !st.received ? 'uploaded' : st.state;
}

// 글씨 처리 방법마다 무엇을 하는지 (대비 실측 결과는 README '바로가기 이름 글씨' 절)
const LEGIBILITY_NOTE_KEYS: Record<string, MessageKey> = {
  shadow: 'legNoteShadow',
  dim: 'legNoteDim',
  card: 'legNoteCard',
  plain: 'legNotePlain',
};

// 흐르기를 골랐는데 멈춰 보일 때의 이유 (background.ts motionStatus)
export function motionBlockedNote(reason?: string): string {
  if (reason === 'reduced') return t('motionBlockedReduced');
  if (reason === 'nogl') return t('motionBlockedNoGl');
  return '';
}

function kb(bytes: number): string {
  return (bytes / 1024).toFixed(1) + 'KB';
}

const HISTORY_PAGE = 10;

function historyItem(h: HistoryEntry, onRestore: (id: string) => void): HTMLLIElement {
  const li = document.createElement('li');
  li.classList.toggle('current', h.current);
  const text = document.createElement('div');
  const title = document.createElement('b');
  title.textContent = describe(h.cp.what);
  const sub = document.createElement('span');
  const who = h.mine ? t('historyThisDevice') : t('historyOtherDevice', h.cp.dev.slice(0, 4));
  sub.textContent = [
    formatCheckpointTime(h.cp.at),
    who,
    t('historyShortcutCount', h.cp.count),
    h.sameRoot ? '' : t('historyForeignBranch'),
  ]
    .filter(Boolean)
    .join(' · ');
  text.append(title, sub);
  li.append(text);
  if (h.current) {
    const now = document.createElement('span');
    now.className = 'now';
    now.textContent = t('historyNow');
    li.append(now);
  } else {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ghost small';
    b.textContent = t('historyRestoreBtn');
    b.addEventListener('click', () => onRestore(h.cp.id));
    li.append(b);
  }
  return li;
}

export class SettingsDrawer {
  store: Store;
  sync: Sync;
  background: Background;
  dlg: HTMLDialogElement;
  thumbs: CompositionPicker;
  updateAccent: (settings: Settings) => void;
  updateBgColor: (settings: Settings) => void;
  #historyShown = HISTORY_PAGE;
  #historyOpen = false;
  #currentPage: SubPage | null = null;
  #lastPage: SubPage | null = null;
  #escHandledAt = -1e9;
  #draggingOrder = false;

  constructor(
    store: Store,
    sync: Sync,
    {
      onExport,
      onImportClick,
      onOpenInspector,
      onOpenBake,
      background,
    }: {
      onExport: () => void;
      onImportClick: () => void;
      onOpenInspector: () => void;
      onOpenBake: () => void;
      background: Background;
    },
  ) {
    this.store = store;
    this.sync = sync;
    this.background = background;
    this.dlg = $<HTMLDialogElement>('settings');

    this.thumbs = new CompositionPicker($('bg-thumbs'), store);
    $('bg-variants').addEventListener('click', () => this.thumbs.more());
    this.updateAccent = mountSwatches($('accent-swatches'), store, { inputId: 'set-accent' });
    this.updateBgColor = mountSwatches($('bgcolor-swatches'), store, { key: 'bgColor', labelKey: 'labelBgColor', presets: BGCOLOR_PRESETS, inputId: 'set-bgcolor' });

    $('version').textContent = 'Tileshelf ' + (chrome.runtime.getManifest().version_name ?? chrome.runtime.getManifest().version);

    // 첫 화면 항목 클릭 → 하위 화면 이동
    for (const btn of this.dlg.querySelectorAll<HTMLElement>('[data-goto]')) {
      btn.addEventListener('click', () => this.openSubPage(btn.dataset.goto as SubPage));
    }
    $('drill-back').addEventListener('click', () => this.backToHome());

    // 하위 화면에서 Esc는 첫 화면으로, 첫 화면에서 Esc는 서랍 닫기
    this.dlg.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.#currentPage !== null) {
        e.preventDefault();
        e.stopPropagation();
        this.#escHandledAt = performance.now();
        this.backToHome();
      } else {
        e.preventDefault();
        this.dlg.close();
      }
    });
    this.dlg.addEventListener('cancel', (e) => {
      if (this.#currentPage !== null || performance.now() - this.#escHandledAt < 100) {
        e.preventDefault();
        if (this.#currentPage !== null) this.backToHome();
      }
    });

    // 버튼 묶음(시스템/어둡게/밝게, 작게/보통/크게)
    for (const seg of this.dlg.querySelectorAll<HTMLElement>('.seg[data-setting]')) {
      seg.addEventListener('click', (e) => {
        const b = (e.target as Element).closest<HTMLElement>('button[data-v]');
        if (b) store.setSettings({ [seg.dataset.setting!]: b.dataset.v });
      });
    }
    $('set-sync').addEventListener('change', async (e) => {
      await store.setSettings({ syncEnabled: (e.target as HTMLInputElement).checked });
      await sync.reconcile();
    });
    $('sync-now').addEventListener('click', () => sync.reconcile());
    $('set-newtab').addEventListener('change', (e) => store.setSettings({ openInNewTab: (e.target as HTMLInputElement).checked }));

    // 배경 종류: 사진은 고르기 전에 '이 PC에만 저장된다'를 먼저 알린다
    $('bg-type').addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('button[data-v]');
      if (!b) return;
      if (b.dataset.v === 'image' && !store.bgImage) this.pickPhoto();
      else store.setSettings({ bgType: b.dataset.v as Settings['bgType'] });
    });
    $('set-bgfit').addEventListener('change', (e) => store.setSettings({ bgFit: (e.target as HTMLSelectElement).value as BgFit }));
    $('set-legibility').addEventListener('change', (e) => store.setSettings({ legibility: (e.target as HTMLSelectElement).value as Legibility }));
    $('set-show-label').addEventListener('change', (e) => store.setSettings({ showLabel: (e.target as HTMLInputElement).checked }));
    $('set-hover-label').addEventListener('change', (e) => store.setSettings({ hoverLabel: (e.target as HTMLInputElement).checked }));
    $('set-suppress-title').addEventListener('change', (e) => store.setSettings({ suppressTooltip: (e.target as HTMLInputElement).checked }));

    // 막대를 끄는 동안에는 화면만 바꾸고, 손을 뗄 때 저장한다
    const dim = $<HTMLInputElement>('set-dim');
    dim.addEventListener('input', () => {
      document.documentElement.style.setProperty('--dim', String(Number(dim.value) / 100));
      $('dim-value').textContent = dim.value + '%';
    });
    dim.addEventListener('change', () => store.setSettings({ dim: Number(dim.value) / 100 }));

    const iconScale = $<HTMLInputElement>('set-icon-scale');
    iconScale.addEventListener('input', () => {
      document.documentElement.style.setProperty('--icon-scale', iconScale.value + '%');
      $('icon-scale-value').textContent = iconScale.value + '%';
    });
    iconScale.addEventListener('change', () => store.setSettings({ iconScale: Number(iconScale.value) }));

    // 판 밝기: 움직이는 동안은 화면만 바꾸고(미리보기), 놓으면 저장한다
    const panelTone = $<HTMLInputElement>('set-panel-tone');
    panelTone.addEventListener('input', () => {
      const root = document.documentElement;
      applyPanelTone(root, root.dataset.theme === 'light' ? 'light' : 'dark', Number(panelTone.value));
    });
    panelTone.addEventListener('change', () => store.setSettings({ panelTone: Number(panelTone.value) }));

    $('open-icon-inspector').addEventListener('click', onOpenInspector);
    $('open-icon-bake').addEventListener('click', onOpenBake);

    $('bg-pick').addEventListener('click', () => this.pickPhoto());
    $('photo-notice-ok').addEventListener('click', async () => {
      if ($<HTMLInputElement>('photo-notice-skip').checked) await chrome.storage.local.set({ photoNoticeSkip: true });
      $<HTMLDialogElement>('photo-notice').close();
      $('bg-file').click();
    });
    $('bg-file').addEventListener('change', async (e) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      try {
        await store.setBgImage(await makeBackground(await readFile(file)));
        await store.setSettings({ bgType: 'image' });
      } catch (err) {
        toast((err as Error).message, { kind: 'danger' });
      }
    });

    $('backup-export').addEventListener('click', onExport);
    $('backup-import').addEventListener('click', onImportClick);
    $('history-toggle').addEventListener('click', () => {
      this.#historyOpen = !this.#historyOpen;
      this.renderHistory();
    });
    $('history-more').addEventListener('click', () => {
      this.#historyShown += HISTORY_PAGE;
      this.renderHistory();
    });

    this.renderSearchOrder();
    this.renderSummaries();
    store.addEventListener('change', () => {
      this.renderSearchOrder();
      this.renderSummaries();
      if (this.dlg.open) this.render();
    });
    sync.addEventListener('status', (e) => {
      this.renderSummaries();
      if (!this.dlg.open) return;
      this.renderSync();
      // 맞추기가 끝날 때마다 기록이 늘거나 바뀔 수 있다
      if (e.detail.state === 'ok' || e.detail.state === 'off') this.renderHistory();
    });
  }

  #resetToHome(): void {
    this.#currentPage = null;
    this.#lastPage = null;
    this.#historyOpen = false;
    this.#historyShown = HISTORY_PAGE;
    $('settings-sub').hidden = true;
    $('settings-home').hidden = false;
    for (const p of this.dlg.querySelectorAll<HTMLElement>('[data-drill-page]')) {
      p.hidden = true;
    }
    this.renderHistory();
    this.renderSummaries();
  }

  openSubPage(page: SubPage): void {
    this.#currentPage = page;
    this.#lastPage = page;
    if (page === 'history') {
      this.#historyOpen = false;
      this.#historyShown = HISTORY_PAGE;
      this.renderHistory();
    }
    this.renderSummaries();
    $('settings-home').hidden = true;
    $('settings-sub').hidden = false;
    $('drill-title').textContent = t(PAGE_TITLE_KEYS[page]);
    for (const p of this.dlg.querySelectorAll<HTMLElement>('[data-drill-page]')) {
      p.hidden = p.dataset.drillPage !== page;
    }
    this.dlg.querySelector<HTMLElement>('.sheet')!.scrollTop = 0;
    $('drill-back').focus();
  }

  backToHome(): void {
    const prev = this.#currentPage ?? this.#lastPage;
    this.#currentPage = null;
    this.#historyOpen = false;
    this.#historyShown = HISTORY_PAGE;
    $('settings-sub').hidden = true;
    $('settings-home').hidden = false;
    for (const p of this.dlg.querySelectorAll<HTMLElement>('[data-drill-page]')) {
      p.hidden = true;
    }
    this.renderHistory();
    this.renderSummaries();
    if (prev) {
      this.dlg.querySelector<HTMLElement>(`[data-goto="${prev}"]`)?.focus();
    }
  }

  // 사진을 고르기 전에 '이 PC에만 저장된다'를 먼저 알린다 (처음 실행 안내도 이것을 쓴다)
  async pickPhoto(): Promise<void> {
    const { photoNoticeSkip } = await chrome.storage.local.get('photoNoticeSkip');
    if (photoNoticeSkip) return $('bg-file').click();
    $<HTMLInputElement>('photo-notice-skip').checked = false;
    $<HTMLDialogElement>('photo-notice').showModal();
  }

  open(section?: string): void {
    this.#resetToHome();
    this.render();
    if (!this.dlg.open) this.dlg.showModal();
    const target = section ? SECTION_TO_PAGE[section] : undefined;
    if (target) this.openSubPage(target);
  }

  renderSummaries(): void {
    const { settings } = this.store;
    const dimPct = Math.round(settings.dim * 100);
    const legLabels: Record<Legibility, string> = {
      shadow: t('legShadow'),
      dim: t('sumDimPct', dimPct),
      card: t('legCard'),
    };
    const st = this.sync.status;
    const syncOn = settings.syncEnabled && st.state !== 'off';
    const bytes = st.bytes ?? 0;
    const historyCount = this.sync.history().length;
    const summaries: Record<SubPage, string> = {
      background: t(BG_LABEL_KEYS[settings.bgType]),
      legibility: legLabels[settings.legibility],
      display: t(
        'sumDisplay',
        t(THEME_LABEL_KEYS[settings.theme]),
        t(SIZE_LABEL_KEYS[settings.tileSize]),
        t(SEARCH_GROUP_LABEL_KEYS[settings.searchOrder[0]]),
      ),
      sync: syncOn ? (bytes ? `${t('syncStatusOn')} · ${kb(bytes)}` : t('syncStatusOn')) : t('syncStatusOff'),
      history: t(this.#historyOpen ? 'sumHistoryOpen' : 'sumHistoryClosed', historyCount),
      backup: t('sumBackup'),
    };
    for (const [k, text] of Object.entries(summaries)) {
      const el = this.dlg.querySelector<HTMLElement>(`[data-drill-sum="${k}"]`);
      if (el) el.textContent = text;
    }
  }

  async render(): Promise<void> {
    const { settings, bgImage } = this.store;
    for (const seg of this.dlg.querySelectorAll<HTMLElement>('.seg[data-setting]')) {
      for (const b of seg.querySelectorAll('button')) {
        b.setAttribute('aria-pressed', String(settings[seg.dataset.setting as keyof Settings] === b.dataset.v));
      }
    }
    $<HTMLInputElement>('set-sync').checked = settings.syncEnabled;
    $<HTMLInputElement>('set-newtab').checked = settings.openInNewTab;
    $<HTMLInputElement>('set-show-label').checked = settings.showLabel;
    $<HTMLInputElement>('set-hover-label').checked = settings.hoverLabel;
    $<HTMLInputElement>('set-suppress-title').checked = settings.suppressTooltip;
    $('hover-label-row').hidden = settings.showLabel;
    $('suppress-title-row').hidden = settings.showLabel;
    $<HTMLInputElement>('set-icon-scale').value = String(settings.iconScale);
    $('icon-scale-value').textContent = settings.iconScale + '%';
    $<HTMLInputElement>('set-panel-tone').value = String(settings.panelTone);
    const activeEffectsCount = this.store.shortcuts.filter((s) => s.iconEffects?.enabled).length;
    $('open-icon-bake').hidden = activeEffectsCount === 0;
    this.renderSearchOrder();
    this.updateAccent(settings);
    this.updateBgColor(settings);
    $<HTMLSelectElement>('set-bgfit').value = settings.bgFit;
    $<HTMLInputElement>('set-dim').value = String(Math.round(settings.dim * 100));
    $('dim-value').textContent = Math.round(settings.dim * 100) + '%';

    const note = $('motion-note');
    const motion = this.background.motionStatus(settings.bgMotion);
    note.hidden = settings.bgMotion !== 'motion' || motion.move;
    note.textContent = motionBlockedNote(motion.reason);
    this.thumbs.render();

    // 화면 쪽 표시(dataset)를 읽지 않는다. main의 applyLook이 이 render보다 나중에 돌아 이전 효과가 읽힌다
    const method = this.store.legibilityMethod;
    $<HTMLSelectElement>('set-legibility').value = settings.legibility;
    $('dim-row').hidden = method !== 'dim';
    $('legibility-note').textContent = LEGIBILITY_NOTE_KEYS[method] ? t(LEGIBILITY_NOTE_KEYS[method]) : '';

    const isImage = settings.bgType === 'image';
    for (const b of $('bg-type').querySelectorAll('button')) b.setAttribute('aria-pressed', String(settings.bgType === b.dataset.v));
    $('bg-gradient-rows').hidden = settings.bgType !== 'gradient';
    $('bg-color-rows').hidden = settings.bgType !== 'color';
    $('bg-image-rows').hidden = !isImage;
    $('bg-thumb').style.backgroundImage = bgImage ? `url("${bgImage}")` : 'none';
    $('bg-missing').hidden = !isImage || Boolean(bgImage);

    this.renderSync();
    this.renderHistory();
    this.renderSummaries();
  }

  renderSearchOrder(focusKind?: SearchGroupKind): void {
    if (this.#draggingOrder) return;
    const box = $('search-order');
    const activeKind =
      focusKind ??
      (box.contains(document.activeElement)
        ? (document.activeElement?.closest<HTMLElement>('li[data-kind]')?.dataset.kind as SearchGroupKind | undefined)
        : undefined);
    const order = this.store.settings.searchOrder;

    const moveItem = (fromIdx: number, toIdx: number, keepFocus: SearchGroupKind): void => {
      const cur = [...this.store.settings.searchOrder];
      if (toIdx < 0 || toIdx >= cur.length || fromIdx === toIdx) return;
      const [moved] = cur.splice(fromIdx, 1);
      cur.splice(toIdx, 0, moved);
      void this.store.setSettings({ searchOrder: cur });
      this.renderSearchOrder(keepFocus);
      this.renderSummaries();
    };

    box.replaceChildren(
      ...order.map((kind, idx) => {
        const li = document.createElement('li');
        li.dataset.kind = kind;
        li.dataset.index = String(idx);

        const groupLabel = t(SEARCH_GROUP_LABEL_KEYS[kind]);
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = 'drag-handle';
        handle.setAttribute('aria-label', t('orderMoveAria', groupLabel));
        handle.title = t('orderMoveTitle');
        handle.append(createGripIcon());

        handle.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            moveItem(idx, idx - 1, kind);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            moveItem(idx, idx + 1, kind);
          }
        });

        const label = document.createElement('span');
        label.className = 'order-label';
        label.textContent = groupLabel;

        const rank = document.createElement('span');
        rank.className = 'order-rank';
        rank.textContent = idx === 0 ? t('orderRankFirst') : t('orderRankN', idx + 1);

        const startPointerDrag = (downEvent: PointerEvent): void => {
          if (downEvent.button !== 0) return;
          downEvent.preventDefault();
          handle.focus();
          this.#draggingOrder = true;
          let currentIdx = idx;
          li.classList.add('dragging-item');
          document.body.classList.add('dragging');

          const onMove = (moveEvent: PointerEvent): void => {
            const items = [...box.querySelectorAll<HTMLLIElement>('li')];
            for (let i = 0; i < items.length; i++) {
              if (i === currentIdx) continue;
              const rect = items[i].getBoundingClientRect();
              const midY = rect.top + rect.height / 2;
              if ((currentIdx < i && moveEvent.clientY > midY) || (currentIdx > i && moveEvent.clientY < midY)) {
                const oldIdx = currentIdx;
                currentIdx = i;
                if (oldIdx < i) {
                  box.insertBefore(li, items[i].nextSibling);
                } else {
                  box.insertBefore(li, items[i]);
                }
                const nextOrder = [...box.querySelectorAll<HTMLLIElement>('li')].map((el, rIdx) => {
                  el.dataset.index = String(rIdx);
                  const r = el.querySelector('.order-rank');
                  if (r) r.textContent = rIdx === 0 ? t('orderRankFirst') : t('orderRankN', rIdx + 1);
                  return el.dataset.kind as SearchGroupKind;
                });
                void this.store.setSettings({ searchOrder: nextOrder });
                this.renderSummaries();
                break;
              }
            }
          };

          const onUp = (): void => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
            this.#draggingOrder = false;
            li.classList.remove('dragging-item');
            document.body.classList.remove('dragging');
            this.renderSearchOrder(kind);
            this.renderSummaries();
          };

          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
          window.addEventListener('pointercancel', onUp);
        };

        handle.addEventListener('pointerdown', startPointerDrag);
        li.addEventListener('pointerdown', (e) => {
          if (e.target === handle || handle.contains(e.target as Node)) return;
          startPointerDrag(e);
        });

        li.append(handle, label, rank);
        return li;
      }),
    );

    if (activeKind) {
      box.querySelector<HTMLElement>(`li[data-kind="${activeKind}"] .drag-handle`)?.focus();
    }
  }

  renderHistory(): void {
    const list = this.sync.history();
    const toggle = $('history-toggle');
    const label = $('history-toggle-label');
    const panel = $('history-panel');
    toggle.setAttribute('aria-expanded', String(this.#historyOpen));
    label.textContent = t(this.#historyOpen ? 'historyToggleClose' : 'historyToggleOpen', list.length);
    panel.hidden = !this.#historyOpen;

    const box = $('history');
    const restore = async (id: string) => {
      if (await this.sync.restore(id)) toast(t('toastRestoredHistory'), { kind: 'success' });
    };
    box.replaceChildren(...list.slice(0, this.#historyShown).map((h) => historyItem(h, restore)));
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'none';
      li.textContent = t('historyEmpty');
      box.append(li);
    }
    $('history-more').hidden = list.length <= this.#historyShown;
    this.renderSummaries();
  }

  renderSync(): void {
    const st = this.sync.status;
    const shown = shownState(st);
    $('sync-dot').dataset.state = shown;
    const statusKey = STATUS_TEXT_KEYS[shown];
    let text = statusKey ? t(statusKey) : shown;
    if (shown === 'ok' && st.at) text += ' · ' + new Date(st.at).toLocaleTimeString();
    if (st.state === 'error' && st.message) text += ' · ' + st.message;
    $('sync-text').textContent = text;

    const bytes = st.bytes ?? 0;
    const ratio = Math.min(1, bytes / TOTAL_LIMIT);
    const meter = $('sync-meter');
    meter.hidden = !bytes;
    meter.querySelector('i')!.style.width = ratio * 100 + '%';
    meter.dataset.level = ratio > 0.95 ? 'bad' : ratio > 0.8 ? 'warn' : '';
    $('sync-usage').textContent = bytes ? t('syncUsageText', kb(bytes), kb(TOTAL_LIMIT)) : '';
    $('sync-icons-note').hidden = !st.iconsOmitted;
    $('sync-trimmed-note').hidden = !st.trimmed;
    $<HTMLButtonElement>('sync-now').disabled = st.state === 'off' || st.state === 'syncing';
    this.renderSummaries();
  }
}
