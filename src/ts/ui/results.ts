// 검색창 아래의 칩 결과 판(#results). 묶음별 칩 그리기, 방향키·Enter·Esc 이동, 칩 실행을 맡는다.

import { buildSearchGroups } from '../search.ts';
import type { SearchChip } from '../search.ts';
import type { Store } from '../store.ts';
import { fillIcon } from './grid.ts';
import { isLocalFileUrl, openLocalFileUrl } from './open-url.ts';

const GLOBE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>';
const SEARCH_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

function isPrintableKey(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.key.length === 1;
}

export class SearchResults {
  el: HTMLElement;
  input: HTMLInputElement;
  store: Store;
  onActiveChange: (active: boolean) => void;

  constructor(
    el: HTMLElement,
    input: HTMLInputElement,
    store: Store,
    { onActiveChange }: { onActiveChange: (active: boolean) => void },
  ) {
    this.el = el;
    this.input = input;
    this.store = store;
    this.onActiveChange = onActiveChange;

    input.addEventListener('input', () => this.render());
    input.addEventListener('keydown', (e) => this.#onInputKey(e));
    el.addEventListener('keydown', (e) => this.#onResultsKey(e));
  }

  get active(): boolean {
    return this.input.value.trim().length > 0;
  }

  render(): void {
    const groups = buildSearchGroups(this.input.value, this.store.shortcuts, this.store.settings.searchOrder);
    if (!groups.length) {
      this.el.hidden = true;
      this.el.replaceChildren();
      this.onActiveChange(false);
      return;
    }

    const frag = document.createDocumentFragment();
    for (const g of groups) {
      const sec = document.createElement('section');
      sec.className = 'result-group';
      sec.dataset.kind = g.kind;

      const h = document.createElement('h3');
      h.className = 'result-title';
      h.textContent = g.title;
      sec.append(h);

      if (g.chips.length) {
        const list = document.createElement('div');
        list.className = 'chips';
        for (const c of g.chips) list.append(this.#makeChip(c));
        sec.append(list);
      } else if (g.emptyText) {
        const empty = document.createElement('p');
        empty.className = 'result-empty';
        empty.textContent = g.emptyText;
        sec.append(empty);
      }
      frag.append(sec);
    }

    this.el.replaceChildren(frag);
    this.el.hidden = false;
    this.onActiveChange(true);
  }

  focusFirst(): boolean {
    const first = this.el.querySelector<HTMLButtonElement>('.chip');
    if (!first) return false;
    first.focus();
    return true;
  }

  #makeChip(chip: SearchChip): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.dataset.kind = chip.kind;

    const ic = document.createElement('span');
    ic.className = 'chip-ic';
    if (chip.kind === 'shortcut') {
      const s = chip.shortcut;
      btn.dataset.id = s.id;
      btn.title = `${s.name}\n${s.url}`;
      fillIcon(ic, {
        id: s.id,
        name: s.name,
        url: s.url,
        customData: s.icon && this.store.icons[s.icon],
        effects: s.iconEffects,
      });
    } else if (chip.kind === 'url') {
      ic.innerHTML = GLOBE_SVG;
    } else {
      ic.innerHTML = SEARCH_SVG;
    }

    const lb = document.createElement('span');
    lb.className = 'chip-lb';
    lb.textContent = chip.label;
    btn.append(ic, lb);

    btn.addEventListener('click', () => this.#runChip(chip));
    return btn;
  }

  #runChip(chip: SearchChip): void {
    if (chip.kind === 'shortcut') {
      if (isLocalFileUrl(chip.shortcut.url)) {
        void openLocalFileUrl(chip.shortcut.url, this.store.settings.openInNewTab);
      } else if (this.store.settings.openInNewTab) {
        window.open(chip.shortcut.url, '_blank', 'noopener');
      } else {
        location.href = chip.shortcut.url;
      }
    } else if (chip.kind === 'url') {
      if (isLocalFileUrl(chip.url)) void openLocalFileUrl(chip.url, false);
      else location.href = chip.url;
    } else {
      chrome.search.query({ text: chip.query, disposition: 'CURRENT_TAB' });
    }
  }

  #onInputKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.isComposing || e.keyCode === 229 || !this.active) return;
      this.focusFirst();
      return;
    }
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'ArrowDown') {
      if (!this.active) return;
      e.preventDefault();
      this.focusFirst();
    } else if (e.key === 'Escape') {
      if (!this.input.value) return;
      e.preventDefault();
      this.input.value = '';
      this.render();
    }
  }

  #onResultsKey(e: KeyboardEvent): void {
    const cur = (e.target as Element).closest<HTMLButtonElement>('.chip');
    if (!cur) return;

    const groups = [...this.el.querySelectorAll<HTMLElement>('.result-group')]
      .map((g) => [...g.querySelectorAll<HTMLButtonElement>('.chip')])
      .filter((list) => list.length > 0);
    const gi = groups.findIndex((list) => list.includes(cur));
    if (gi < 0) return;
    const row = groups[gi];
    const ci = row.indexOf(cur);

    if (e.key === 'Enter') {
      e.preventDefault();
      cur.click();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (ci > 0) row[ci - 1].focus();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (ci + 1 < row.length) row[ci + 1].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (gi > 0) groups[gi - 1][0].focus();
      else this.input.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (gi + 1 < groups.length) groups[gi + 1][0].focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.input.focus();
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      this.input.focus();
      this.input.value = this.input.value.slice(0, -1);
      const end = this.input.value.length;
      this.input.setSelectionRange(end, end);
      this.render();
    } else if (isPrintableKey(e)) {
      e.preventDefault();
      this.input.focus();
      this.input.value += e.key;
      const end = this.input.value.length;
      this.input.setSelectionRange(end, end);
      this.render();
    } else if (e.key === 'Process') {
      this.input.focus();
    }
  }
}
