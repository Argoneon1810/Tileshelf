// 아이콘 배경·여백 정리 대화상자(#icon-inspector, 일괄 설정 + 아이콘별 개별 설정) 및 베이킹 경고 모달(#icon-bake).

import { fillIcon } from './grid.ts';
import {
  extractIconCanvas,
  processIconPixels,
  renderCanvasFromProcessed,
  clearIconRenderCache,
} from '../icon-effects.ts';
import type { IconEffects, ThemeAdaptPolicy } from '../icon-effects.ts';
import type { Store, SyncDoc } from '../store.ts';
import { toast } from './toast.ts';
import { t } from '../i18n.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

interface DraftEntry {
  id: string;
  name: string;
  url: string;
  // 자동 아이콘(직접 고른 이미지가 없음). 정리할 수 없어 화면 그대로 보여 주고 고르지 못하게 한다.
  autoIcon: boolean;
  rawRgba: Uint8ClampedArray | null;
  rawDataUrl: string;
  enabled: boolean;
  bgRemove: boolean;
  trimAlpha: boolean;
  opticalSize: boolean;
  themeAdapt: ThemeAdaptPolicy;
  recommended: boolean;
  shouldRemoveOuterBg: boolean;
  isMeaningfulChromaticBadge: boolean;
  emptyMarginRatio: number;
  asymmetryPx: number;
  clashesWithDarkTheme: boolean;
}

export class IconInspectorDialog {
  store: Store;
  dlg: HTMLDialogElement;
  bakeDlg: HTMLDialogElement;
  #drafts = new Map<string, DraftEntry>();
  #previewBg: 'dark' | 'light' = 'dark';
  #batch = {
    bgRemove: true,
    trimAlpha: true,
    opticalSize: true,
    themeAdapt: 'auto' as ThemeAdaptPolicy,
  };

  constructor(store: Store) {
    this.store = store;
    this.dlg = $<HTMLDialogElement>('icon-inspector');
    this.bakeDlg = $<HTMLDialogElement>('icon-bake');

    // 일괄 선택은 정리할 수 있는 줄(픽셀을 읽은 직접 고른 아이콘)에만 적용한다.
    $('insp-select-recommended').addEventListener('click', () => {
      for (const d of this.#editable()) {
        d.enabled = d.recommended;
        d.bgRemove = d.shouldRemoveOuterBg;
        d.trimAlpha = true;
        d.opticalSize = true;
        d.themeAdapt = d.clashesWithDarkTheme ? 'auto' : 'none';
      }
      this.#renderList();
    });
    $('insp-select-all').addEventListener('click', () => {
      for (const d of this.#editable()) d.enabled = true;
      this.#renderList();
    });
    $('insp-select-invert').addEventListener('click', () => {
      for (const d of this.#editable()) d.enabled = !d.enabled;
      this.#renderList();
    });
    $('insp-select-none').addEventListener('click', () => {
      for (const d of this.#drafts.values()) d.enabled = false;
      this.#renderList();
    });

    $('insp-preview-bg').addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('button[data-v]');
      if (!b) return;
      this.#previewBg = b.dataset.v === 'light' ? 'light' : 'dark';
      for (const el of $('insp-preview-bg').querySelectorAll('button')) {
        el.setAttribute('aria-pressed', String(el === b));
      }
      this.#renderList();
    });

    $('batch-bg').addEventListener('click', () => {
      this.#batch.bgRemove = !this.#batch.bgRemove;
      this.#syncBatchButtons();
      for (const d of this.#drafts.values()) {
        if (d.enabled) d.bgRemove = this.#batch.bgRemove;
      }
      this.#renderList();
    });
    $('batch-trim').addEventListener('click', () => {
      this.#batch.trimAlpha = !this.#batch.trimAlpha;
      this.#syncBatchButtons();
      for (const d of this.#drafts.values()) {
        if (d.enabled) d.trimAlpha = this.#batch.trimAlpha;
      }
      this.#renderList();
    });
    $('batch-optical').addEventListener('click', () => {
      this.#batch.opticalSize = !this.#batch.opticalSize;
      this.#syncBatchButtons();
      for (const d of this.#drafts.values()) {
        if (d.enabled) d.opticalSize = this.#batch.opticalSize;
      }
      this.#renderList();
    });
    $('batch-theme-adapt').addEventListener('change', (e) => {
      this.#batch.themeAdapt = (e.target as HTMLSelectElement).value as ThemeAdaptPolicy;
      for (const d of this.#drafts.values()) {
        if (d.enabled) d.themeAdapt = this.#batch.themeAdapt;
      }
      this.#renderList();
    });

    $('insp-apply-btn').addEventListener('click', () => void this.#apply());
    $('btn-confirm-bake').addEventListener('click', () => void this.#confirmBake());
  }

  #editable(): DraftEntry[] {
    return [...this.#drafts.values()].filter((d) => d.rawRgba);
  }

  #syncBatchButtons(): void {
    const setChip = (id: string, labelKey: 'inspChipBg' | 'inspChipTrim' | 'inspChipOptical', on: boolean) => {
      const btn = $(id);
      btn.setAttribute('aria-pressed', String(on));
      btn.textContent = `${t(labelKey)}: ${t(on ? 'syncStatusOn' : 'syncStatusOff')}`;
    };
    setChip('batch-bg', 'inspChipBg', this.#batch.bgRemove);
    setChip('batch-trim', 'inspChipTrim', this.#batch.trimAlpha);
    setChip('batch-optical', 'inspChipOptical', this.#batch.opticalSize);
    $<HTMLSelectElement>('batch-theme-adapt').value = this.#batch.themeAdapt;
  }

  async open(): Promise<void> {
    this.#previewBg = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    for (const el of $('insp-preview-bg').querySelectorAll('button')) {
      el.setAttribute('aria-pressed', String(el.dataset.v === this.#previewBg));
    }
    this.#syncBatchButtons();
    $('insp-list').textContent = t('inspLoading');
    if (!this.dlg.open) this.dlg.showModal();

    this.#drafts.clear();
    const { shortcuts, icons } = this.store;
    const anyExisting = shortcuts.some((s) => s.iconEffects?.enabled);

    for (const s of shortcuts) {
      // 자동 아이콘은 픽셀을 읽지 않는다(바깥 서버 그림이라 CORS로 막힘). 직접 고른 아이콘만 읽는다.
      const custom = s.icon ? icons[s.icon] : undefined;
      const extracted = custom ? await extractIconCanvas([custom], 64) : null;
      if (!extracted) {
        this.#drafts.set(s.id, {
          id: s.id,
          name: s.name,
          url: s.url,
          autoIcon: !custom,
          rawRgba: null,
          rawDataUrl: '',
          enabled: false,
          bgRemove: false,
          trimAlpha: true,
          opticalSize: true,
          themeAdapt: 'none',
          recommended: false,
          shouldRemoveOuterBg: false,
          isMeaningfulChromaticBadge: false,
          emptyMarginRatio: 0,
          asymmetryPx: 0,
          clashesWithDarkTheme: false,
        });
        continue;
      }

      const probe = processIconPixels(extracted.rgba, 64, 64, {
        removeBg: true,
        trimAlpha: true,
        opticalSize: true,
        themeAdapt: 'auto',
        currentTheme: 'dark',
      });
      const prev = s.iconEffects;
      this.#drafts.set(s.id, {
        id: s.id,
        name: s.name,
        url: s.url,
        autoIcon: false,
        rawRgba: extracted.rgba,
        rawDataUrl: extracted.dataUrl,
        enabled: prev ? prev.enabled : !anyExisting && probe.recommended,
        bgRemove: prev ? prev.bgRemove : probe.shouldRemoveOuterBg,
        trimAlpha: prev ? prev.trimAlpha : true,
        opticalSize: prev ? prev.opticalSize : true,
        themeAdapt: prev ? prev.themeAdapt : probe.clashesWithDarkTheme ? 'auto' : 'none',
        recommended: probe.recommended,
        shouldRemoveOuterBg: probe.shouldRemoveOuterBg,
        isMeaningfulChromaticBadge: probe.isMeaningfulChromaticBadge,
        emptyMarginRatio: probe.emptyMarginRatio,
        asymmetryPx: probe.asymmetryPx,
        clashesWithDarkTheme: probe.clashesWithDarkTheme,
      });
    }

    this.#renderList();
  }

  openBakeWarning(): void {
    if (!this.bakeDlg.open) this.bakeDlg.showModal();
  }

  #renderList(): void {
    const listEl = $('insp-list');
    listEl.replaceChildren();

    if (!this.#drafts.size) {
      const empty = document.createElement('p');
      empty.className = 'note';
      empty.textContent = t('inspEmptyShortcuts');
      listEl.append(empty);
      this.#updateSummary();
      return;
    }

    for (const d of this.#drafts.values()) {
      const card = document.createElement('div');
      card.className = 'insp-card';
      card.dataset.id = d.id;
      card.dataset.checked = String(d.enabled);

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = d.enabled;
      chk.disabled = !d.rawRgba;
      chk.style.width = '18px';
      chk.style.height = '18px';
      chk.style.accentColor = 'var(--btn)';
      chk.style.cursor = d.rawRgba ? 'pointer' : 'default';

      const info = document.createElement('div');
      info.className = 'insp-info';

      const titleRow = document.createElement('div');
      titleRow.className = 'insp-title';

      const controlsRow = document.createElement('div');
      controlsRow.className = 'insp-controls';

      const makeChip = (label: string, key: 'bgRemove' | 'trimAlpha' | 'opticalSize') => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'insp-chip';
        btn.textContent = label;
        btn.disabled = !d.rawRgba;
        btn.setAttribute('aria-pressed', String(d[key]));
        btn.addEventListener('click', () => {
          d[key] = !d[key];
          d.enabled = true;
          chk.checked = true;
          card.dataset.checked = 'true';
          btn.setAttribute('aria-pressed', String(d[key]));
          refreshCard();
          this.#updateSummary();
        });
        return btn;
      };

      const chipBg = makeChip(t('inspChipBg'), 'bgRemove');
      const chipTrim = makeChip(t('inspChipTrim'), 'trimAlpha');
      const chipOpt = makeChip(t('inspChipOptical'), 'opticalSize');

      const selAdapt = document.createElement('select');
      selAdapt.className = 'insp-select';
      selAdapt.disabled = !d.rawRgba;
      const options: Array<[ThemeAdaptPolicy, string]> = [
        ['none', t('inspAdaptNone')],
        ['auto', t('inspAdaptAuto')],
        ['luma-lift', t('inspAdaptLuma')],
        ['invert-mark', t('inspAdaptInvert')],
        ['keyline', t('inspAdaptKeyline')],
      ];
      for (const [val, text] of options) {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = text;
        selAdapt.append(opt);
      }
      selAdapt.value = d.themeAdapt;
      selAdapt.addEventListener('change', () => {
        d.themeAdapt = selAdapt.value as ThemeAdaptPolicy;
        d.enabled = true;
        chk.checked = true;
        card.dataset.checked = 'true';
        refreshCard();
        this.#updateSummary();
      });

      if (d.autoIcon) {
        // 정리 단추 대신, 어떻게 하면 정리할 수 있는지 알린다.
        const hint = document.createElement('span');
        hint.className = 'insp-hint';
        hint.textContent = t('inspAutoIconHint');
        controlsRow.append(hint);
      } else {
        controlsRow.append(chipBg, chipTrim, chipOpt, selAdapt);
      }

      const compare = document.createElement('div');
      compare.className = 'insp-compare';
      compare.dataset.previewBg = this.#previewBg;

      const refreshCard = (): void => {
        const nameSpan = document.createElement('span');
        nameSpan.textContent = d.name;
        titleRow.replaceChildren(nameSpan);

        const addTag = (text: string, cls = ''): void => {
          const tag = document.createElement('span');
          tag.className = `insp-tag ${cls}`.trim();
          tag.textContent = text;
          titleRow.append(tag);
        };

        if (d.autoIcon) {
          // 새 탭과 같은 방법(그리기만 함)으로 지금 아이콘을 보여 준다. 픽셀은 읽지 않는다.
          addTag(t('inspTagAutoIcon'));
          const box = document.createElement('div');
          box.className = 'insp-preview-box';
          fillIcon(box, { name: d.name, url: d.url });
          compare.replaceChildren(box);
          return;
        }
        if (!d.rawRgba) {
          addTag(t('inspTagUnreadable'));
          compare.replaceChildren();
          return;
        }

        const proc = processIconPixels(d.rawRgba, 64, 64, {
          removeBg: d.bgRemove,
          trimAlpha: d.trimAlpha,
          opticalSize: d.opticalSize,
          themeAdapt: d.themeAdapt,
          currentTheme: this.#previewBg,
        });
        const afterUrl = d.enabled ? renderCanvasFromProcessed(proc) : d.rawDataUrl;

        if (proc.shouldRemoveOuterBg) addTag(t('inspTagOuterBg'), 'warn');
        if (proc.isMeaningfulChromaticBadge) addTag(t('inspTagBadgeProtected'), 'good');
        if (proc.emptyMarginRatio >= 0.08) addTag(t('inspTagMargin', Math.round(proc.emptyMarginRatio * 100)), 'good');
        if (proc.asymmetryPx >= 1.8) addTag(t('inspTagAsymmetric'), 'accent');
        if (proc.clashesWithDarkTheme) addTag(t('inspTagDarkClash'), 'accent');

        const beforeBox = document.createElement('div');
        beforeBox.className = 'insp-preview-box';
        const beforeImg = new Image();
        beforeImg.src = d.rawDataUrl;
        beforeImg.alt = '';
        beforeBox.append(beforeImg);

        const arrow = document.createElement('span');
        arrow.className = 'insp-arrow';
        arrow.textContent = '→';

        const afterBox = document.createElement('div');
        afterBox.className = 'insp-preview-box';
        const afterImg = new Image();
        afterImg.src = afterUrl;
        afterImg.alt = '';
        afterBox.append(afterImg);

        compare.replaceChildren(beforeBox, arrow, afterBox);
      };

      chk.addEventListener('change', () => {
        d.enabled = chk.checked;
        card.dataset.checked = String(chk.checked);
        refreshCard();
        this.#updateSummary();
      });

      refreshCard();
      info.append(titleRow, controlsRow);
      card.append(chk, info, compare);
      listEl.append(card);
    }

    this.#updateSummary();
  }

  #updateSummary(): void {
    const n = [...this.#drafts.values()].filter((d) => d.enabled).length;
    $('insp-summary-note').textContent = t('inspSummaryCount', this.#drafts.size, n);
    $('insp-apply-btn').textContent = t('inspBtnApplyCount', n);
  }

  async #apply(): Promise<void> {
    const before: SyncDoc = this.store.syncDoc();
    const patches: Array<{ id: string; iconEffects: IconEffects | null; iconData?: string }> = [];

    for (const d of this.#drafts.values()) {
      if (!d.rawRgba) continue;
      patches.push({
        id: d.id,
        iconEffects: d.enabled
          ? {
              enabled: true,
              bgRemove: d.bgRemove,
              trimAlpha: d.trimAlpha,
              opticalSize: d.opticalSize,
              themeAdapt: d.themeAdapt,
            }
          : null,
      });
    }

    clearIconRenderCache();
    await this.store.applyIconEffectsBatch(patches);
    const appliedCount = [...this.#drafts.values()].filter((d) => d.enabled).length;
    this.dlg.close();
    toast(t('toastIconEffectsApplied', appliedCount), {
      kind: 'success',
      action: {
        label: t('actionUndo'),
        run: () => {
          clearIconRenderCache();
          return this.store.applyDoc(before, { origin: 'restore', bgImage: this.store.bgImage });
        },
      },
    });
  }

  async #confirmBake(): Promise<void> {
    const before: SyncDoc = this.store.syncDoc();
    const currentTheme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    const entries: Array<{ id: string; bakedDataUrl: string }> = [];

    for (const s of this.store.shortcuts) {
      if (!s.iconEffects?.enabled) continue;
      // 베이킹도 직접 고른 아이콘만 한다. 자동 아이콘은 픽셀을 읽을 수 없어 다른 그림이 굳어 버린다.
      const custom = s.icon ? this.store.icons[s.icon] : undefined;
      if (!custom) continue;
      const extracted = await extractIconCanvas([custom], 64);
      if (!extracted) continue;
      const proc = processIconPixels(extracted.rgba, 64, 64, {
        removeBg: s.iconEffects.bgRemove,
        trimAlpha: s.iconEffects.trimAlpha,
        opticalSize: s.iconEffects.opticalSize,
        themeAdapt: s.iconEffects.themeAdapt,
        currentTheme,
      });
      const bakedDataUrl = renderCanvasFromProcessed(proc, 'image/webp', 0.88);
      entries.push({ id: s.id, bakedDataUrl });
    }

    clearIconRenderCache();
    const count = await this.store.bakeIconEffectsBatch(entries);
    this.bakeDlg.close();
    if (count > 0) {
      toast(t('toastIconsBaked', count), {
        kind: 'warning',
        action: {
          label: t('actionUndo'),
          run: () => {
            clearIconRenderCache();
            return this.store.applyDoc(before, { origin: 'restore', bgImage: this.store.bgImage });
          },
        },
      });
    }
  }
}
