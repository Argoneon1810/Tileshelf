// 바로가기 격자. 그리기와 끌어서 순서 바꾸기를 맡는다.

import { NEW_BADGE_MS } from '../store.ts';
import type { Store } from '../store.ts';
import { autoIconSources } from '../images.ts';
import { renderIconWithEffects } from '../icon-effects.ts';
import type { IconEffects } from '../icon-effects.ts';
import { t } from '../i18n.ts';
import { isLocalFileUrl, openLocalFileUrl } from './open-url.ts';

const PLUS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const PEN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>';
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

// 아이콘 칸 하나를 채운다. 직접 고른 아이콘 → 자동 아이콘 → 첫 글자 순서로 시도하며,
// 비파괴 효과 스택(effects?.enabled)이 켜져 있으면 현재 테마에 맞춰 정제된 이미지를 입힌다.
export function fillIcon(
  box: HTMLElement,
  {
    id,
    name,
    url,
    customData,
    effects,
  }: { id?: string; name: string; url: string; customData?: string | null; effects?: IconEffects },
): void {
  box.replaceChildren();
  const img = new Image();
  img.alt = '';
  img.draggable = false;
  const sources = customData ? [customData] : autoIconSources(url);

  // 정리 효과는 직접 고른 아이콘에만 입힌다. 자동 아이콘은 바깥 서버 그림이라 픽셀을 읽을 수 없고,
  // 억지로 읽으면 다른 후보(Chrome 내장 파비콘)의 그림으로 바뀌어 화면과 달라진다(1.2.1).
  if (effects?.enabled && customData) {
    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    const cacheKey = id ?? (customData ? customData.slice(0, 48) : url);
    void renderIconWithEffects(cacheKey, sources, effects, theme).then((refined) => {
      if (refined && img.isConnected) {
        img.src = refined;
        img.className = 'custom';
      }
    });
  }

  if (customData) {
    img.src = customData;
    img.className = 'custom';
    box.append(img);
    return;
  }
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
  // 편집 모드: 타일을 누르면 사이트 대신 편집 창을 연다(main.ts가 켜고 끈다).
  editing = false;
  #suppressClick = false;

  constructor(el: HTMLElement, store: Store, { onEdit, onAdd }: { onEdit: (id: string) => void; onAdd: () => void }) {
    this.el = el;
    this.store = store;
    this.onEdit = onEdit;
    this.onAdd = onAdd;

    el.addEventListener('click', (e) => this.#onClick(e), true);
    // 편집 칩은 눌러도 초점을 가져가지 않는다. 그래야 편집 창이 닫힐 때 초점이 보이지 않는 칩으로
    // 돌아가지 않고, 그 전에 초점이 있던 곳(대개 없음)으로 돌아간다.
    el.addEventListener('mousedown', (e) => {
      if (hit(e, '.more')) e.preventDefault();
    });
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
      // 새로 추가된 바로가기는 배지의 뜻을 화면 읽기 프로그램과 타일 툴팁에도 함께 알린다.
      const isNew = !!s.addedAt && now - s.addedAt < NEW_BADGE_MS;
      a.setAttribute('aria-label', isNew ? `${s.name}, ${t('badgeNew')}` : s.name);
      if (settings.showLabel || !settings.suppressTooltip) {
        a.title = isNew ? `${s.name}\n${s.url}\n${t('badgeNew')}` : `${s.name}\n${s.url}`;
      }
      if (settings.openInNewTab) a.target = '_blank';

      const ic = document.createElement('span');
      ic.className = 'ic glass';
      fillIcon(ic, {
        id: s.id,
        name: s.name,
        url: s.url,
        customData: s.icon && icons[s.icon],
        effects: s.iconEffects,
      });

      const lb = document.createElement('span');
      lb.className = 'lb';
      lb.textContent = s.name;
      a.append(ic, lb);
      if (isNew) {
        // 링크 안에 두어 누르면 사이트가 열리고, 마우스를 올리면 배지 자신의 툴팁이 뜬다.
        // 뜻은 링크의 aria-label에 이미 들어 있으므로 화면 읽기 프로그램에서는 숨긴다.
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.title = t('badgeNew');
        badge.setAttribute('aria-hidden', 'true');
        a.append(badge);
      }

      // 편집 칩(클래스 이름은 예전 ⋮ 단추의 'more'를 그대로 쓴다). 마우스용 단추라 Tab은 멈추지 않는다.
      // 키보드로는 편집 모드(오른쪽 위 편집 단추)나 메뉴 키(Shift+F10)로 편집한다.
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'more glass';
      more.tabIndex = -1;
      more.setAttribute('aria-label', t('ariaEditTile', s.name));
      more.innerHTML = PEN_SVG;

      tile.append(a, more);
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
    if (link && this.editing) {
      e.preventDefault();
      this.onEdit(link.closest<HTMLElement>('.tile')!.dataset.id!);
      return;
    }
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
