// 바로가기와 설정을 들고 있는 저장소. 모든 데이터는 이 PC의 chrome.storage.local에 저장하고,
// 바뀔 때마다 'change' 이벤트를 낸다. 계정 동기화(sync.ts)는 이 이벤트를 듣고 체크포인트를 만들어 올린다.
//
// local 키
//   shortcuts  [{ id, name, url, icon?, addedAt }]   icon은 icons의 키
//   settings   DEFAULT_SETTINGS 모양
//   icons      { [iconId]: dataURL }                 직접 고른 아이콘
//   bgImage    dataURL | null                         배경 사진 (용량 때문에 계정 동기화에서 뺌)
//   syncState  SyncState                              동기화가 쓰는 이 기기의 상태
// 되돌리기는 체크포인트 기록(sync.ts)으로 한다.

import type { Composition } from './aurora.ts';
import { mergeWhat } from './checkpoints.ts';
import type { What, DocState } from './checkpoints.ts';
import { sanitizeIconEffects } from './icon-effects.ts';
import type { IconEffects } from './icon-effects.ts';
import { DEFAULT_PANEL_TONE, clampPanelTone } from './panel-tone.ts';

export interface Shortcut {
  id: string;
  name: string;
  url: string;
  icon?: string;
  iconEffects?: IconEffects;
  addedAt: number;
}

export type Theme = 'system' | 'dark' | 'light';
export type TileSize = 'sm' | 'md' | 'lg';
export type BgType = 'gradient' | 'color' | 'image';
export type Legibility = 'shadow' | 'dim' | 'card';
export type LegibilityMethod = Legibility | 'plain';
export type BgMotion = 'static' | 'motion';
export type BgFit = 'cover' | 'contain' | 'center' | 'repeat';
export type SearchGroupKind = 'shortcuts' | 'url' | 'web';

export const DEFAULT_SEARCH_ORDER: readonly SearchGroupKind[] = ['shortcuts', 'url', 'web'];

export interface Settings {
  theme: Theme;
  tileSize: TileSize;
  iconScale: number;
  panelTone: number;
  showLabel: boolean;
  hoverLabel: boolean;
  suppressTooltip: boolean;
  openInNewTab: boolean;
  searchOrder: SearchGroupKind[];
  bgType: BgType;
  bgColor: string;
  accent: string;
  bgComposition: Composition;
  bgSeed: number;
  legibility: Legibility;
  bgMotion: BgMotion;
  bgFit: BgFit;
  dim: number;
  syncEnabled: boolean;
}

export type Icons = Record<string, string>;

// 백업 파일에 담는 문서. 다른 PC나 체크포인트에서 받은 상태도 이 모양으로 applyDoc에 넣는다.
export interface SyncDoc {
  v: 1;
  shortcuts: Shortcut[];
  settings?: Partial<Settings>;
  icons: Icons;
  iconsOmitted?: boolean; // 옛 버전이 만든 백업에 있을 수 있다. 지금은 쓰지 않는다.
}

export interface SyncState {
  head: string | null; // 지금 이 기기의 상태가 된 체크포인트
  headAt: number; // 그 체크포인트를 바꾼 시각
  root: string | null; // 이 기기가 따르는 계보. 한 번도 맞춘 적 없으면 null
  dirty: boolean; // head 뒤로 이 기기에서 바꾼 것이 있음
  updatedAt: number; // 이 기기에서 마지막으로 바꾼 시각
  what?: What; // head 뒤로 바꾼 것들 (다음 체크포인트에 적는다)
  receivedFrom?: string; // 다른 기기의 체크포인트를 받은 적이 있으면 그 기기
  ackedBy?: string; // 이 기기의 체크포인트를 다른 기기가 받아 갔으면 그 기기
  foreign?: string[]; // 이미 알린, 이 기기와 다른 계보들
  lastRev?: string | null; // 0.7 이전 동기화가 남긴 값. 옮길 때 '맞춘 적 있는 기기'인지 보는 데만 쓴다.
}

export type Part = 'shortcuts' | 'settings' | 'icons' | 'bgImage';
export type Origin = 'local' | 'remote' | 'import' | 'restore';

export interface ChangeDetail {
  parts: Part[];
  origin: Origin;
  markDirty: boolean;
  keys?: (keyof Settings)[];
  what?: What;
}

export interface Removed {
  shortcut: Shortcut;
  index: number;
  iconData?: string;
}

// chrome.storage.local과 같은 모양의 저장소. 시험에서는 가짜를 넣는다.
export interface StorageArea {
  get(keys: string | string[] | null): Promise<Record<string, any>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system', // system | dark | light
  tileSize: 'md', // sm | md | lg
  iconScale: 50, // 35..75 (%) — 타일 상자 안에서 아이콘이 차지하는 기본 비율
  panelTone: DEFAULT_PANEL_TONE, // 0..100 — 판 밝기. 0 글자 쪽, 100 아이콘 쪽 (panel-tone.ts)
  showLabel: true, // 바로가기 이름 항상 표시 여부
  hoverLabel: true, // 평소 이름 숨김일 때 마우스를 올리면 이름 표시 여부
  suppressTooltip: true, // 평소 이름 숨김일 때 브라우저 기본 title 풍선 숨김 여부
  openInNewTab: false,
  searchOrder: [...DEFAULT_SEARCH_ORDER], // shortcuts | url | web — 검색 결과 묶음 우선순위
  bgType: 'gradient', // gradient | color | image  (image인데 이 PC에 사진이 없으면 gradient로 보인다)
  bgColor: '#29323c', // 단색 배경의 색
  accent: '#4087de', // 그라데이션을 만드는 강조색. gradient.ts의 ACCENT_PRESETS 첫 색
  bgComposition: 'aurora', // aurora.ts의 COMPOSITIONS 중 하나
  bgSeed: 1, // 같은 구도 안의 변형. 씨앗이 같으면 어느 PC에서나 같은 그림
  legibility: 'dim', // shadow | dim | card — 배경 위 바로가기 이름을 읽히게 하는 방법
  bgMotion: 'static', // static | motion — 처음 실행 안내(intro.ts)에서 사용자가 고른다
  bgFit: 'cover', // cover | contain | center | repeat
  dim: 0.57, // 흰 글자가 순백색 배경 위에서도 대비 5:1을 넘는 농도 (README 실측)
  syncEnabled: true,
};

// 이 PC에만 적용하고 다른 PC로 보내지 않는 설정
const DEVICE_ONLY: readonly (keyof Settings)[] = ['syncEnabled'];

export const NEW_BADGE_MS = 24 * 60 * 60 * 1000;

const EMPTY_SYNC_STATE: SyncState = { head: null, headAt: 0, root: null, dirty: false, updatedAt: 0 };

function validSearchOrder(v: unknown): v is SearchGroupKind[] {
  return (
    Array.isArray(v) &&
    v.length === DEFAULT_SEARCH_ORDER.length &&
    DEFAULT_SEARCH_ORDER.every((k) => v.includes(k))
  );
}

// 모르는 배경 종류는 그라데이션으로 둔다
function migrateSettings(s: Settings & { searchDefault?: unknown }): Settings {
  if (!['gradient', 'color', 'image'].includes(s.bgType)) s.bgType = 'gradient';
  if (!validSearchOrder(s.searchOrder)) s.searchOrder = [...DEFAULT_SEARCH_ORDER];
  s.iconScale =
    typeof s.iconScale === 'number' && Number.isFinite(s.iconScale)
      ? Math.min(75, Math.max(35, Math.round(s.iconScale)))
      : DEFAULT_SETTINGS.iconScale;
  s.panelTone = clampPanelTone(s.panelTone);
  if (typeof s.showLabel !== 'boolean') s.showLabel = DEFAULT_SETTINGS.showLabel;
  if (typeof s.hoverLabel !== 'boolean') s.hoverLabel = DEFAULT_SETTINGS.hoverLabel;
  if (typeof s.suppressTooltip !== 'boolean') s.suppressTooltip = DEFAULT_SETTINGS.suppressTooltip;
  // '자동'과 중앙 음영은 뺐다 (BACKLOG). 이 값은 다른 기기나 백업에서도 들어온다.
  // 효과를 직접 고른 적이 없으니 예전 기본 농도(24%)도 새 기본값으로 함께 옮긴다
  if (['auto', 'calm'].includes(s.legibility as string)) {
    s.legibility = 'dim';
    if (s.dim === 0.24) s.dim = DEFAULT_SETTINGS.dim;
  }
  delete s.searchDefault;
  return s;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

const BLOCKED_SCHEME_PREFIX = /^(?:javascript|data|vbscript|blob)\s*:/i;
const BLOCKED_PROTOCOLS = new Set(['javascript:', 'data:', 'vbscript:', 'blob:']);
const SAFE_IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i;

export function isSafeImageDataUrl(v: unknown): v is string {
  return typeof v === 'string' && SAFE_IMAGE_DATA_URL.test(v);
}

export function normalizeUrl(raw: string): string {
  const s = raw.trim();
  const compact = s.replace(/[\u0000-\u001f\u007f]+/g, '');
  if (!compact || BLOCKED_SCHEME_PREFIX.test(compact)) return '';
  if (/^[a-z]:[\\/]/i.test(s)) {
    try {
      return new URL('file:///' + s.replace(/\\/g, '/').replace(/^\/+/, '')).href;
    } catch {
      return '';
    }
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  return 'https://' + s;
}

export function isSafeShortcutUrl(url: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    const proto = u.protocol.toLowerCase();
    if (BLOCKED_PROTOCOLS.has(proto)) return false;
    if ((proto === 'http:' || proto === 'https:') && (!u.hostname || /\s/.test(url))) return false;
    return true;
  } catch {
    return false;
  }
}

// 'change' 이벤트의 detail 타입을 알려 준다
export interface Store {
  addEventListener(type: 'change', listener: (e: CustomEvent<ChangeDetail>) => void, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
}

export class Store extends EventTarget {
  local: StorageArea;

  constructor(local: StorageArea = chrome.storage.local) {
    super();
    this.local = local;
  }

  shortcuts: Shortcut[] = [];
  settings: Settings = { ...DEFAULT_SETTINGS };
  icons: Icons = {};
  bgImage: string | null = null;
  syncState: SyncState = { ...EMPTY_SYNC_STATE };

  // 사진을 골랐는데 이 PC에 사진이 없으면 그라데이션으로 보인다
  get bgKind(): BgType {
    const { bgType } = this.settings;
    return bgType === 'image' && !this.bgImage ? 'gradient' : bgType;
  }

  // 단색은 글자색을 배경색에 맞춰 고르므로 유리 카드 말고는 따로 처리하지 않는다(plain).
  get legibilityMethod(): LegibilityMethod {
    const { legibility } = this.settings;
    if (this.bgKind === 'color') return legibility === 'card' ? 'card' : 'plain';
    return legibility;
  }

  async load(): Promise<void> {
    const d = await this.local.get(['shortcuts', 'settings', 'icons', 'bgImage', 'syncState']);
    this.shortcuts = d.shortcuts ?? [];
    this.settings = migrateSettings({ ...DEFAULT_SETTINGS, ...d.settings });
    this.icons = d.icons ?? {};
    this.bgImage = d.bgImage ?? null;
    this.syncState = { ...EMPTY_SYNC_STATE, ...d.syncState };
  }

  isEmpty(): boolean {
    return this.shortcuts.length === 0;
  }

  // ---- 바꾸기 ----

  async addShortcut({ name, url, iconData }: { name: string; url: string; iconData?: string }): Promise<Shortcut> {
    const s: Shortcut = { id: newId(), name, url, addedAt: Date.now() };
    if (iconData) s.icon = this.#putIcon(iconData);
    this.shortcuts.push(s);
    await this.#commit(['shortcuts', 'icons'], { what: { add: 1 } });
    return s;
  }

  // iconData: undefined는 그대로 두기, null은 자동 아이콘으로 되돌리기, 문자열은 새 아이콘
  async updateShortcut(
    id: string,
    {
      name,
      url,
      iconData,
      iconEffects,
    }: { name?: string; url?: string; iconData?: string | null; iconEffects?: IconEffects | null },
  ): Promise<void> {
    const s = this.shortcuts.find((x) => x.id === id);
    if (!s) return;
    if (name !== undefined) s.name = name;
    if (url !== undefined) s.url = url;
    if (iconData !== undefined) {
      delete s.icon;
      if (iconData) s.icon = this.#putIcon(iconData);
    }
    if (iconEffects !== undefined) {
      const clean = iconEffects ? sanitizeIconEffects(iconEffects) : undefined;
      if (clean && clean.enabled) s.iconEffects = clean;
      else delete s.iconEffects;
    }
    this.#dropOrphanIcons();
    await this.#commit(['shortcuts', 'icons'], { what: { edit: 1 } });
  }

  // 검사기 모달에서 여러 아이콘의 비파괴 효과 스택을 한 번에 반영한다.
  async applyIconEffectsBatch(
    patches: Array<{ id: string; iconEffects: IconEffects | null; iconData?: string }>,
  ): Promise<number> {
    let changed = 0;
    for (const p of patches) {
      const s = this.shortcuts.find((x) => x.id === p.id);
      if (!s) continue;
      const prevJson = JSON.stringify(s.iconEffects ?? null);
      let iconAdded = false;
      if (p.iconData && !s.icon && isSafeImageDataUrl(p.iconData)) {
        s.icon = this.#putIcon(p.iconData);
        iconAdded = true;
      }
      const clean = p.iconEffects ? sanitizeIconEffects(p.iconEffects) : undefined;
      if (clean && clean.enabled) s.iconEffects = clean;
      else delete s.iconEffects;
      if (iconAdded || JSON.stringify(s.iconEffects ?? null) !== prevJson) {
        changed++;
      }
    }
    if (!changed) return 0;
    this.#dropOrphanIcons();
    await this.#commit(['shortcuts', 'icons'], { what: { edit: changed } });
    return changed;
  }

  // 저사양 기기용 파괴적 베이킹: 현재 합성된 비트맵을 아이콘에 구워 넣고 비파괴 스택을 비운다.
  async bakeIconEffectsBatch(entries: Array<{ id: string; bakedDataUrl: string }>): Promise<number> {
    let count = 0;
    for (const e of entries) {
      if (!isSafeImageDataUrl(e.bakedDataUrl)) continue;
      const s = this.shortcuts.find((x) => x.id === e.id);
      if (!s) continue;
      s.icon = this.#putIcon(e.bakedDataUrl);
      delete s.iconEffects;
      count++;
    }
    if (!count) return 0;
    this.#dropOrphanIcons();
    await this.#commit(['shortcuts', 'icons'], { what: { edit: count } });
    return count;
  }

  // 지운 바로가기와 그 아이콘을 돌려준다. 되돌리기에서 insertShortcut에 그대로 넘긴다.
  async removeShortcut(id: string): Promise<Removed | null> {
    const index = this.shortcuts.findIndex((x) => x.id === id);
    if (index < 0) return null;
    const [removed] = this.shortcuts.splice(index, 1);
    const iconData = removed.icon ? this.icons[removed.icon] : undefined;
    this.#dropOrphanIcons();
    await this.#commit(['shortcuts', 'icons'], { what: { remove: 1 } });
    return { shortcut: removed, index, iconData };
  }

  async insertShortcut({ shortcut, index, iconData }: Removed): Promise<void> {
    const s = { ...shortcut };
    if (iconData && s.icon) this.icons[s.icon] = iconData;
    this.shortcuts.splice(Math.min(index, this.shortcuts.length), 0, s);
    await this.#commit(['shortcuts', 'icons'], { what: { add: 1 } });
  }

  async reorder(ids: string[]): Promise<void> {
    const byId = new Map(this.shortcuts.map((s) => [s.id, s]));
    const next = ids.map((id) => byId.get(id)).filter((s): s is Shortcut => Boolean(s));
    if (next.length !== this.shortcuts.length) return;
    if (next.every((s, i) => s === this.shortcuts[i])) return;
    this.shortcuts = next;
    await this.#commit(['shortcuts'], { what: { order: true } });
  }

  async setSettings(patch: Partial<Settings>): Promise<void> {
    this.settings = migrateSettings({ ...this.settings, ...patch });
    const keys = Object.keys(patch) as (keyof Settings)[];
    const deviceOnly = keys.every((k) => DEVICE_ONLY.includes(k));
    await this.#commit(['settings'], { markDirty: !deviceOnly, keys, what: { settings: true } });
  }

  async setBgImage(dataUrl: string | null): Promise<void> {
    this.bgImage = dataUrl;
    // 배경 사진은 계정으로 보내지 않으므로 동기화 대상 변경으로 치지 않는다
    await this.#commit(['bgImage'], { markDirty: false });
  }

  // ---- 동기화·백업용 문서 ----

  // 백업 파일에 담을 내용. 배경 사진은 makeBackup이 따로 붙이고, 이 PC 전용 설정은 뺀다.
  syncDoc(): SyncDoc {
    const { shortcuts, settings } = this.docState();
    return { v: 1, shortcuts, settings, icons: this.icons };
  }

  // 체크포인트에 담을 상태. 아이콘 그림과 배경 사진, 이 PC 전용 설정은 뺀다.
  docState(): DocState {
    const settings: Partial<Settings> = { ...this.settings };
    for (const k of DEVICE_ONLY) delete settings[k];
    return { shortcuts: this.shortcuts, settings };
  }

  // 다른 PC, 체크포인트, 백업 파일에서 온 문서로 현재 상태를 바꾼다.
  // 문서에 그림이 없는 아이콘은 이 PC가 가진 그림을 그대로 쓴다 (아이콘 id는 그림이 바뀌지 않는다).
  async applyDoc(doc: SyncDoc, { origin, bgImage }: { origin?: Origin; bgImage?: string | null } = {}): Promise<void> {
    const keep = Object.fromEntries(DEVICE_ONLY.map((k) => [k, this.settings[k]])) as Partial<Settings>;
    const had = this.icons;
    this.shortcuts = (doc.shortcuts ?? [])
      .filter((s) => Boolean(s && typeof s.url === 'string' && isSafeShortcutUrl(s.url)))
      .map((s) => {
        const copy: Shortcut = { id: s.id, name: s.name, url: s.url, addedAt: s.addedAt };
        if (s.icon) copy.icon = s.icon;
        const eff = sanitizeIconEffects(s.iconEffects);
        if (eff && eff.enabled) copy.iconEffects = eff;
        return copy;
      });
    this.settings = migrateSettings({ ...DEFAULT_SETTINGS, ...doc.settings, ...keep });
    this.icons = Object.fromEntries(Object.entries(doc.icons ?? {}).filter(([k, v]) => Boolean(k) && isSafeImageDataUrl(v)));
    for (const s of this.shortcuts) if (s.icon && !this.icons[s.icon] && had[s.icon]) this.icons[s.icon] = had[s.icon];
    this.#dropOrphanIcons();
    const parts: Part[] = ['shortcuts', 'settings', 'icons'];
    if (bgImage === null || isSafeImageDataUrl(bgImage)) {
      this.bgImage = bgImage;
      parts.push('bgImage');
    }
    // 다른 PC에서 받은 내용은 이미 계정에 있으니 다시 올리지 않는다
    const what = origin === 'import' ? { import: true } : origin === 'restore' ? { restore: true } : {};
    await this.#commit(parts, { markDirty: origin !== 'remote', origin, what });
  }

  // 백업 파일의 바로가기를 지금 목록 뒤에 덧붙인다. 설정은 건드리지 않는다.
  async appendShortcuts(shortcuts: Shortcut[], icons: Icons = {}): Promise<void> {
    for (const s of shortcuts) {
      const copy: Shortcut = { id: newId(), name: s.name, url: s.url, addedAt: s.addedAt };
      if (s.icon && icons[s.icon]) copy.icon = this.#putIcon(icons[s.icon]);
      const eff = sanitizeIconEffects(s.iconEffects);
      if (eff && eff.enabled) copy.iconEffects = eff;
      this.shortcuts.push(copy);
    }
    await this.#commit(['shortcuts', 'icons'], { what: { add: shortcuts.length } });
  }

  async setSyncState(patch: Partial<SyncState>): Promise<void> {
    this.syncState = { ...this.syncState, ...patch };
    await this.local.set({ syncState: this.syncState });
  }

  // ---- 내부 ----

  #putIcon(dataUrl: string): string {
    const id = newId();
    this.icons[id] = dataUrl;
    return id;
  }

  #dropOrphanIcons(): void {
    const used = new Set(this.shortcuts.map((s) => s.icon).filter(Boolean));
    for (const id of Object.keys(this.icons)) if (!used.has(id)) delete this.icons[id];
  }

  // keys: 설정 중 바뀐 이름들. 화면이 필요한 부분만 다시 그리게 한다. 없으면 설정 전체가 바뀐 것이다.
  // what: 무엇을 바꿨는지. 다음 체크포인트에 모아 적는다.
  async #commit(
    parts: Part[],
    { markDirty = true, origin = 'local', keys, what }: { markDirty?: boolean; origin?: Origin; keys?: (keyof Settings)[]; what?: What } = {},
  ): Promise<void> {
    const data: Record<string, unknown> = {};
    for (const p of parts) data[p] = this[p];
    if (markDirty) {
      this.syncState = { ...this.syncState, dirty: true, updatedAt: Date.now(), what: mergeWhat(this.syncState.what ?? {}, what ?? {}) };
      data.syncState = this.syncState;
    }
    await this.local.set(data);
    const detail: ChangeDetail = { parts, origin, markDirty, keys, what };
    this.dispatchEvent(new CustomEvent('change', { detail }));
  }
}
