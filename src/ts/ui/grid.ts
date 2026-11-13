// 바로가기 격자. 그리기와 끌어서 순서 바꾸기를 맡는다.

import { NEW_BADGE_MS } from '../store.ts';
import type { Store } from '../store.ts';
import { autoIconSources } from '../images.ts';
import { t } from '../i18n.ts';
import { isLocalFileUrl, openLocalFileUrl } from './open-url.ts';

const PLUS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const MORE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
const DRAG_START_PX = 6;

// 이벤트가 일어난 요소에서 위로 올라가며 selector에 맞는 첫 요소
const hit = (e: Event, selector: string): HTMLElement | null => (e.target as Element).closest<HTMLElement>(selector);

interface Drag {
  tile: HTMLElement;
  x: number;
  y: number;
  started: boolean;
  dx?: number;
  dy?: number;
  ghost?: HTMLElement;
}

function letterOf(name: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'letter';
  span.textContent = (name.trim()[0] ?? '?').toUpperCase();
  return span;
}

// 아이콘 칸 하나를 채운다. 직접 고른 아이콘 → 자동 아이콘 → 첫 글자 순서로 시도한다.
export function fillIcon(box: HTMLElement, { name, url, customData }: { name: string; url: string; customData?: string | null }): void {
  box.replaceChildren();
  const img = new Image();
  img.alt = '';
  img.draggable = false;
  if (customData) {
    img.src = customData;
    img.className = 'custom';
    box.append(img);
    return;
  }
  const sources = autoIconSources(url);
  if (!sources.length) {
    box.replaceChildren(letterOf(name || url));
    return;
  }
  let i = 0;
  img.addEventListener('error', () => {
    i++;
    if (i < sources.length) img.src = sources[i];
    else box.replaceChildren(letterOf(name || url));
  });
  img.src = sources[0];
  box.append(img);
}

export class Grid {
  el: HTMLElement;
  store: Store;
  onEdit: (id: string) => void;
  onAdd: () => void;
  #suppressClick = false;

  constructor(el: HTMLElement, store: Store, { onEdit, onAdd }: { onEdit: (id: string) => void; onAdd: () => void }) {
    this.el = el;
    this.store = store;
    this.onEdit = onEdit;
    this.onAdd = onAdd;

    el.addEventListener('click', (e) => this.#onClick(e), true);
    el.addEventListener('contextmenu', (e) => {
      const tile = hit(e, '.tile[data-id]');
      if (!tile) return;
      e.preventDefault();
      onEdit(tile.dataset.id!);
    });
    this.#bindDrag();
  }

  render(): void {
    const { shortcuts, icons, settings } = this.store;
    const now = Date.now();
    const frag = document.createDocumentFragment();
    for (const s of shortcuts) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.dataset.id = s.id;

      const a = document.createElement('a');
      a.className = 'link';
      a.href = s.url;
      a.draggable = false;
      a.title = `${s.name}\n${s.url}`;
      if (settings.openInNewTab) a.target = '_blank';

      const ic = document.createElement('span');
      ic.className = 'ic glass';
      fillIcon(ic, { name: s.name, url: s.url, customData: s.icon && icons[s.icon] });

      const lb = document.createElement('span');
      lb.className = 'lb';
      lb.textContent = s.name;
      a.append(ic, lb);

      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'more glass';
      more.setAttribute('aria-label', t('ariaEditTile', s.name));
      more.innerHTML = MORE_SVG;

      tile.append(a, more);
      if (s.addedAt && now - s.addedAt < NEW_BADGE_MS) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.title = t('badgeNew');
        tile.append(badge);
      }
      frag.append(tile);
    }

    const add = document.createElement('div');
    add.className = 'tile add';
    const addLink = document.createElement('a');
    addLink.className = 'link';
    addLink.href = '#';
    addLink.draggable = false;
    const addIc = document.createElement('span');
    addIc.className = 'ic glass';
    addIc.innerHTML = PLUS_SVG;
    const addLb = document.createElement('span');
    addLb.className = 'lb';
    addLb.textContent = t('tileAdd');
    addLink.append(addIc, addLb);
    add.append(addLink);
    frag.append(add);

    this.el.replaceChildren(frag);
  }

  #onClick(e: MouseEvent): void {
    if (this.#suppressClick) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const more = hit(e, '.more');
    if (more) {
      e.preventDefault();
      this.onEdit(more.closest<HTMLElement>('.tile')!.dataset.id!);
      return;
    }
    if (hit(e, '.tile.add')) {
      e.preventDefault();
      this.onAdd();
      return;
    }
    const link = hit(e, '.tile[data-id] .link') as HTMLAnchorElement | null;
    if (link && isLocalFileUrl(link.href)) {
      e.preventDefault();
      const inNewTab = this.store.settings.openInNewTab || e.ctrlKey || e.metaKey || e.shiftKey;
      void openLocalFileUrl(link.href, inNewTab);
    }
  }

  // 위치가 바뀌는 바로가기들이 순간이동하지 않고 미끄러지게 한다 (FLIP)
  #flip(mutate: () => void): void {
    const tiles = [...this.el.querySelectorAll<HTMLElement>('.tile:not(.filtered)')];
    const before = new Map(tiles.map((t) => [t, t.getBoundingClientRect()]));
    mutate();
    for (const t of tiles) {
      const a = before.get(t)!;
      const b = t.getBoundingClientRect();
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (dx || dy) {
        t.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
          duration: 180,
          easing: 'cubic-bezier(.2,.8,.2,1)',
        });
      }
    }
  }

  // 화면에 보이는 위치가 아니라 배치상의 자리로 판정한다.
  // 미끄러지는 중인 바로가기를 옛 자리에 있는 것으로 보고 되돌려 바꾸는 떨림을 막는다.
  #tileAt(clientX: number, clientY: number): HTMLElement | null {
    const g = this.el.getBoundingClientRect();
    const x = clientX - g.left;
    const y = clientY - g.top;
    for (const t of this.el.querySelectorAll<HTMLElement>('.tile[data-id]:not(.filtered)')) {
      if (x >= t.offsetLeft && x < t.offsetLeft + t.offsetWidth && y >= t.offsetTop && y < t.offsetTop + t.offsetHeight) return t;
    }
    return null;
  }

  #bindDrag(): void {
    let d: Drag | null = null;

    this.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const tile = hit(e, '.tile[data-id]');
      if (!tile || hit(e, '.more')) return;
      d = { tile, x: e.clientX, y: e.clientY, started: false };
    });

    window.addEventListener('pointermove', (e) => {
      if (!d) return;
      if (!d.started) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_START_PX) return;
        const r = d.tile.getBoundingClientRect();
        d.dx = d.x - r.left;
        d.dy = d.y - r.top;
        const ghost = d.tile.cloneNode(true) as HTMLElement;
        ghost.classList.add('drag-ghost');
        ghost.style.width = r.width + 'px';
        document.body.append(ghost);
        d.ghost = ghost;
        d.tile.classList.add('placeholder');
        document.body.classList.add('dragging');
        d.started = true;
      }
      d.ghost!.style.left = e.clientX - d.dx! + 'px';
      d.ghost!.style.top = e.clientY - d.dy! + 'px';

      const over = this.#tileAt(e.clientX, e.clientY);
      if (!over || over === d.tile) return;
      const tiles = [...this.el.children];
      const moving = d.tile;
      const movingForward = tiles.indexOf(moving) < tiles.indexOf(over);
      this.#flip(() => (movingForward ? over.after(moving) : over.before(moving)));
    });

    const end = () => {
      if (!d) return;
      if (d.started) {
        d.ghost?.remove();
        d.tile.classList.remove('placeholder');
        document.body.classList.remove('dragging');
        // 끌기를 마친 자리에서 클릭이 일어나 사이트가 열리지 않게 한다
        this.#suppressClick = true;
        setTimeout(() => (this.#suppressClick = false), 0);
        const ids = [...this.el.querySelectorAll<HTMLElement>('.tile[data-id]')].map((t) => t.dataset.id!);
        this.store.reorder(ids);
      }
      d = null;
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }
}
