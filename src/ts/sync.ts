// 구글 계정 동기화. 바뀔 때마다 체크포인트를 만들어 계정에 쌓고, 가장 최근 체크포인트를 모든 기기가 따른다.
//
// 계정(chrome.storage.sync)의 키
//   h:<기기>        그 기기의 머리글 { rev, n, top, seen }. top은 그 기기의 최신 체크포인트,
//                   seen은 그 기기가 지금 따르고 있는 체크포인트 (다른 기기에게 '받았음'을 알린다)
//   p:<기기>:<i>    그 기기의 체크포인트 묶음(checkpoints.ts)을 압축해 나눈 조각. 기기마다 자기 키만 쓴다.
//   i:<아이콘 id>   직접 고른 아이콘 그림. 여러 체크포인트가 같은 그림을 나눠 쓴다.
// 기기마다 자기 키만 쓰므로 두 기기가 동시에 써도 서로의 기록을 덮지 않는다.
//
// 판단 (reconcile)
//   1. 바꾼 것이 있으면(dirty) 이 기기의 체크포인트로 남긴다.
//   2. 같은 계보(root)의 체크포인트 중 바꾼 시각이 가장 늦은 것을 따른다. 내 것이 졌으면 기록에서 되돌릴 수 있다.
//   3. 한 번도 맞춘 적 없는 기기(root 없음)는 계정에 기록이 있으면 그것을 따르고, 없으면 바로가기를 바꾸기
//      전까지 아무것도 쓰지 않는다. 새로 설치한 빈 확장이 다른 기기의 바로가기를 0개로 덮지 않게 하려는 것이다.
//   4. 다른 계보의 체크포인트는 저절로 따르지 않고 알리기만 한다. 사용자가 기록 목록에서 고르면 그 계보에 들어간다.
//   5. 지금 상태가 된 체크포인트가 계정 어디에도 없으면(다른 기기의 기록이 지워졌다) 이 기기 묶음에 다시 남긴다.
//      내 묶음이 계정에서 지워졌으면 다시 쓴다. 확장을 삭제하면 Chrome이 그 확장의 계정 데이터를 지운다는
//      보고가 있어서다.
// 이 기기의 묶음은 chrome.storage.local에도 두어, 동기화를 끈 동안에도 기록이 남고 계정이 지워져도 되살린다.

import { encode, decode, splitChunks, joinChunks, staleChunks, totalBytes, itemBytes, TOTAL_LIMIT, ITEM_LIMIT } from './syncdoc.ts';
import type { SyncItems } from './syncdoc.ts';
import { newId } from './store.ts';
import type { Store, StorageArea, SyncState, Icons } from './store.ts';
import { appendCheckpoint, checkpointsOf, latestOf, stateAt, iconsUsed, newer, prune } from './checkpoints.ts';
import type { Pack, Checkpoint, What, DocState } from './checkpoints.ts';

const HEAD = 'h:';
const PACK = 'p:';
const ICON = 'i:';
const packPrefix = (dev: string): string => `${PACK}${dev}:`;
// 0.7까지 쓰던 계정 키. 옮긴 뒤 지운다.
const LEGACY_KEY = /^(meta|c\d+|ack:.*)$/;
// 아이콘 그림은 계정에 이만큼을 남기고 채운다. 다른 기기가 기록을 쓸 자리다.
const ICON_ROOM = 20 * 1024;
// 0.7까지 동기화하던 기기들이 옮겨 오며 함께 쓰는 계보. 그래야 옮긴 뒤에도 서로 따른다.
export const LEGACY_ROOT = 'legacy';

interface Header {
  rev: string;
  n: number;
  top: Checkpoint | null;
  seen: string | null;
  at: number;
}

export type SyncStateName = 'idle' | 'syncing' | 'waiting' | 'empty' | 'ok' | 'off' | 'error' | 'too-big';

export interface SyncStatus {
  state: SyncStateName;
  at?: number;
  // 기기 사이에 실제로 전달된 적이 있는지 (#setStatus 참고)
  received?: boolean;
  message?: string;
  bytes?: number;
  iconsOmitted?: boolean;
  trimmed?: boolean; // 계정 한도 때문에 이 기기의 오래된 체크포인트를 덜어 냈다
}

export interface AppliedDetail {
  overwroteLocal: boolean; // 이 기기에서 바꾼 것이 더 늦게 바꾼 다른 기기에 졌다
  count: number;
  from: string;
  mine?: string; // 진 쪽(이 기기)의 체크포인트. 되돌리기에 쓴다.
}

export interface ForeignDetail {
  cp: Checkpoint;
}

export interface HistoryEntry {
  cp: Checkpoint;
  mine: boolean;
  current: boolean;
  sameRoot: boolean;
}

// chrome.storage와 같은 모양. 시험에서는 가짜를 넣는다.
export interface ChromeStorage {
  local: StorageArea;
  sync: StorageArea;
  onChanged: {
    addListener(fn: (changes: Record<string, { newValue?: any; oldValue?: any }>, area: string) => void): void;
  };
}

// 이벤트의 detail 타입을 알려 준다
export interface Sync {
  addEventListener(type: 'status', listener: (e: CustomEvent<SyncStatus>) => void, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: 'applied', listener: (e: CustomEvent<AppliedDetail>) => void, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: 'foreign', listener: (e: CustomEvent<ForeignDetail>) => void, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
}

// 바로가기 쪽을 바꾼 것인지 (설정만 바꾼 새 기기는 계정에 쓰지 않는다)
function touchesShortcuts(what: What | undefined): boolean {
  return Boolean(what && (what.add || what.remove || what.edit || what.order || what.import || what.restore));
}

const newRev = (): string => Date.now().toString(36) + newId().slice(0, 4);

export class Sync extends EventTarget {
  status: SyncStatus = { state: 'idle' };
  store: Store;
  storage: ChromeStorage;
  pushDelay: number;
  pullDelay: number;
  device = '';
  pack: Pack | null = null;
  packRev = '';
  #others = new Map<string, { rev: string; pack: Pack }>();
  #items: SyncItems = {};
  #pushTimer: ReturnType<typeof setTimeout> | undefined;
  #pullTimer: ReturnType<typeof setTimeout> | undefined;
  #running: Promise<void> | null = null;
  #again = false;

  // storage: chrome.storage와 같은 모양({ local, sync, onChanged }). 시험에서는 가짜를 넣는다.
  // pushDelay: 바뀐 뒤 체크포인트를 만들기까지 모으는 시간. 끌어서 옮기기처럼 연달아 바뀌면 하나로 모은다.
  constructor(store: Store, storage: ChromeStorage = chrome.storage, { pushDelay = 1500, pullDelay = 400 } = {}) {
    super();
    this.store = store;
    this.storage = storage;
    this.pushDelay = pushDelay;
    this.pullDelay = pullDelay;
  }

  get enabled(): boolean {
    return this.store.settings.syncEnabled;
  }

  async start(): Promise<void> {
    let { deviceId, pack, packRev } = (await this.storage.local.get(['deviceId', 'pack', 'packRev'])) as { deviceId?: string; pack?: Pack; packRev?: string };
    if (!deviceId) {
      deviceId = newId();
      await this.storage.local.set({ deviceId });
    }
    this.device = deviceId;
    this.pack = pack ?? null;
    this.packRev = packRev ?? '';
    await this.#migrate();

    this.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      const me = this.device;
      const relevant = Object.entries(changes).some(([k, c]) => {
        // 내 기록은 지워졌을 때만 (다시 채워야 한다)
        if (k === HEAD + me || k.startsWith(packPrefix(me))) return c.newValue === undefined;
        return k.startsWith(HEAD) || k.startsWith(PACK);
      });
      if (!relevant) return;
      clearTimeout(this.#pullTimer);
      this.#pullTimer = setTimeout(() => this.reconcile(), this.pullDelay);
    });
    this.store.addEventListener('change', (e) => {
      if (e.detail.markDirty) this.schedulePush();
    });
    await this.reconcile();
  }

  schedulePush(): void {
    clearTimeout(this.#pushTimer);
    this.#pushTimer = setTimeout(() => this.reconcile(), this.pushDelay);
  }

  // 계정과 이 기기를 맞춘다. 한 번에 하나씩만 돌고, 도는 중에 다시 불리면 끝난 뒤 한 번 더 돈다.
  reconcile(): Promise<void> {
    if (this.#running) {
      this.#again = true;
      return this.#running;
    }
    this.#running = (async () => {
      try {
        do {
          this.#again = false;
          await this.#run();
        } while (this.#again);
      } finally {
        this.#running = null;
      }
    })();
    return this.#running;
  }

  // 시험과 예전 호출을 위한 이름. 모으는 시간을 건너뛰고 바로 맞춘다.
  push(): Promise<void> {
    return this.reconcile();
  }

  // 아직 체크포인트로 남기지 않은 변경이 있으면 지금 남긴다 (불러오기처럼 되돌릴 자리가 필요할 때)
  async flush(): Promise<void> {
    if (this.store.syncState.dirty) await this.reconcile();
  }

  // 기록 목록. 가장 최근 것이 먼저.
  history(): HistoryEntry[] {
    const { head, root } = this.store.syncState;
    return this.#allPacks()
      .flatMap(checkpointsOf)
      .sort((a, b) => (newer(a, b) === a ? -1 : 1))
      .map((cp) => ({ cp, mine: cp.dev === this.device, current: cp.id === head, sameRoot: !root || cp.root === root }));
  }

  // 체크포인트 id의 상태로 되돌린다. 되돌린 것도 새 체크포인트가 되어 다른 기기가 따른다.
  // 다른 계보의 체크포인트를 고르면 이 기기도 그 계보에 들어간다.
  async restore(id: string): Promise<boolean> {
    if (!this.#allPacks().some((p) => checkpointsOf(p).some((c) => c.id === id))) return false;
    clearTimeout(this.#pushTimer);
    const st = this.store.syncState;
    if (st.dirty && (st.root || touchesShortcuts(st.what))) {
      await this.#checkpoint(st.what ?? {}, st.updatedAt);
    }
    const pack = this.#allPacks().find((p) => checkpointsOf(p).some((c) => c.id === id));
    if (!pack) return false;
    const cp = checkpointsOf(pack).find((c) => c.id === id)!;
    const state = stateAt(pack, id)!;
    if (cp.root !== this.store.syncState.root) await this.store.setSyncState({ root: cp.root, head: cp.id, headAt: cp.at });
    await this.store.applyDoc({ v: 1, shortcuts: state.shortcuts, settings: state.settings, icons: this.#iconsFor(state) }, { origin: 'restore' });
    await this.reconcile();
    return true;
  }

  // ---- 내부 ----

  #allPacks(): Pack[] {
    const packs = [...this.#others.values()].map((o) => o.pack);
    if (this.pack) packs.push(this.pack);
    return packs;
  }

  // 0.7까지 쓰던 기기: 맞춘 적이 있거나 바로가기가 있으면 지금 상태를 첫 체크포인트로 삼는다.
  // 옛 계정 문서는 읽지 않는다. 그때 기기들은 이미 서로 맞춰져 있었다.
  async #migrate(): Promise<void> {
    if (this.pack) return;
    const st = this.store.syncState;
    if (st.root || (!st.lastRev && this.store.isEmpty())) return;
    await this.#checkpoint({ migrate: true }, st.updatedAt || Date.now(), { root: LEGACY_ROOT, parent: null });
  }

  // 지금 상태를 이 기기 묶음의 새 체크포인트로 남긴다
  async #checkpoint(what: What, at: number, { root, parent }: { root?: string; parent?: string | null } = {}): Promise<Checkpoint> {
    const before = this.store.syncState;
    const safeAt = before.headAt !== undefined && at <= before.headAt ? before.headAt + 1 : at;
    const id = newRev();
    const state = this.store.docState();
    const cp: Checkpoint = {
      id,
      at: safeAt,
      dev: this.device,
      parent: parent === undefined ? before.head : parent,
      root: root ?? before.root ?? id,
      count: state.shortcuts.length,
      what,
    };
    this.pack = appendCheckpoint(this.pack, cp, state);
    this.packRev = newRev();
    await this.storage.local.set({ pack: this.pack, packRev: this.packRev });
    const patch: Partial<SyncState> = { head: id, headAt: safeAt, root: cp.root };
    // 남기는 동안 또 바뀌었으면 그것은 다음 체크포인트로 간다
    if (this.store.syncState.updatedAt === before.updatedAt) Object.assign(patch, { dirty: false, what: undefined });
    await this.store.setSyncState(patch);
    return cp;
  }

  async #run(): Promise<void> {
    clearTimeout(this.#pushTimer);
    const st = this.store.syncState;
    if (!this.enabled) {
      // 꺼져 있어도 기록은 이 기기에 남긴다 (되돌리기 목록)
      if (st.dirty && (st.root || touchesShortcuts(st.what))) await this.#checkpoint(st.what ?? {}, st.updatedAt);
      return this.#setStatus('off');
    }
    this.#setStatus('syncing');

    let items: SyncItems;
    try {
      items = await this.storage.sync.get(null);
      const legacy = Object.keys(items).filter((k) => LEGACY_KEY.test(k));
      if (legacy.length) {
        await this.storage.sync.remove(legacy);
        for (const k of legacy) delete items[k];
      }
    } catch (e) {
      return this.#setStatus('error', { message: (e as Error).message });
    }
    this.#items = items;

    const { headers, waiting } = await this.#readAccount(items);
    // 다른 기기의 묶음 조각이 아직 다 오지 않았다. 나머지가 오면 onChanged로 다시 불린다.
    if (waiting) return this.#setStatus('waiting');

    let applied: AppliedDetail | null = null;
    if (!this.store.syncState.root) {
      const all = this.#allPacks().flatMap(checkpointsOf);
      if (all.length) {
        // 처음 맞추는 기기는 계정의 가장 최근 기록을 따른다. 그 전에 바로가기를 바꿨다면 이 기기 기록으로 남겨 둔다.
        if (touchesShortcuts(st.what)) await this.#checkpoint(st.what!, st.updatedAt);
        applied = await this.#adopt(all.reduce(newer));
      } else if (st.dirty && touchesShortcuts(st.what)) {
        await this.#checkpoint(st.what!, st.updatedAt);
      } else {
        return this.#setStatus('empty');
      }
    } else {
      const made = st.dirty ? await this.#checkpoint(st.what ?? {}, st.updatedAt) : null;
      const now = this.store.syncState;
      if (!made && now.head && !this.#allPacks().some((p) => checkpointsOf(p).some((c) => c.id === now.head))) {
        // 지금 상태가 된 체크포인트가 어디에도 없다 (만든 기기의 기록이 지워졌다)
        await this.#checkpoint({ reseed: true }, now.headAt || Date.now());
      }
      const pool = this.#allPacks().flatMap(checkpointsOf);
      const same = pool.filter((c) => c.root === this.store.syncState.root);
      const target = same.length ? same.reduce(newer) : null;
      if (target && target.id !== this.store.syncState.head) applied = await this.#adopt(target);
      await this.#noticeForeign(pool);
    }

    const published = await this.#publish(items, headers);
    if (!published) return;
    await this.#noteAcks(headers);
    this.#setStatus('ok', published);
    if (applied) this.dispatchEvent(new CustomEvent('applied', { detail: applied }));
  }

  // 계정의 머리글을 읽고, 다른 기기의 묶음을 푼다 (판이 같으면 전에 푼 것을 쓴다)
  async #readAccount(items: SyncItems): Promise<{ headers: Map<string, Header>; waiting: boolean }> {
    const headers = new Map<string, Header>();
    for (const [k, v] of Object.entries(items)) if (k.startsWith(HEAD)) headers.set(k.slice(HEAD.length), v as Header);
    let waiting = false;
    for (const [dev, h] of headers) {
      if (dev === this.device || !h.n) continue;
      if (this.#others.get(dev)?.rev === h.rev) continue;
      const enc = joinChunks(items, packPrefix(dev), h.rev, h.n);
      if (enc === null) {
        waiting = true;
        continue;
      }
      try {
        this.#others.set(dev, { rev: h.rev, pack: await decode<Pack>(enc) });
      } catch {
        /* 풀 수 없는 묶음은 건너뛴다 */
      }
    }
    for (const dev of [...this.#others.keys()]) if (!headers.get(dev)?.n) this.#others.delete(dev);
    return { headers, waiting };
  }

  // 체크포인트의 상태로 이 기기를 바꾼다.
  // 지금 상태가 이 기기에서 바꾼 체크포인트인데 target이 그것에서 이어진 것이 아니면, 이 기기의 변경이 진 것이다.
  async #adopt(target: Checkpoint): Promise<AppliedDetail | null> {
    const pack = target.dev === this.device ? this.pack : this.#others.get(target.dev)?.pack;
    const state = pack && stateAt(pack, target.id);
    if (!state) return null;
    const head = this.store.syncState.head;
    const mine = head ? checkpointsOf(this.pack).find((c) => c.id === head && !c.what.reseed) : undefined;
    const lost = mine && !this.#descends(target, mine.id) ? mine : undefined;

    await this.store.applyDoc({ v: 1, shortcuts: state.shortcuts, settings: state.settings, icons: this.#iconsFor(state) }, { origin: 'remote' });
    const patch: Partial<SyncState> = { head: target.id, headAt: target.at, root: target.root, dirty: false, what: undefined };
    if (target.dev !== this.device) patch.receivedFrom = target.dev;
    await this.store.setSyncState(patch);
    return { overwroteLocal: Boolean(lost), count: state.shortcuts.length, from: target.dev, mine: lost?.id };
  }

  // cp가 ancestor에서 이어진 것인지 (부모를 따라 거슬러 올라간다)
  #descends(cp: Checkpoint, ancestor: string): boolean {
    const byId = new Map(this.#allPacks().flatMap(checkpointsOf).map((c) => [c.id, c]));
    let cur: Checkpoint | undefined = cp;
    for (let i = 0; cur && i < 10000; i++) {
      if (cur.id === ancestor) return true;
      cur = cur.parent ? byId.get(cur.parent) : undefined;
    }
    return false;
  }

  // 상태가 쓰는 아이콘 그림: 계정에 있는 것, 없으면 이 기기가 가진 것
  #iconsFor(state: DocState): Icons {
    const icons: Icons = {};
    for (const s of state.shortcuts) {
      if (!s.icon) continue;
      const data = this.#items[ICON + s.icon] ?? this.store.icons[s.icon];
      if (typeof data === 'string') icons[s.icon] = data;
    }
    return icons;
  }

  // 다른 계보의 기록이 새로 보이면 한 번 알린다
  async #noticeForeign(pool: Checkpoint[]): Promise<void> {
    const { root, foreign = [] } = this.store.syncState;
    const known = new Set(foreign);
    const fresh = pool.filter((c) => c.root !== root && c.dev !== this.device && !known.has(c.root));
    if (!fresh.length) return;
    await this.store.setSyncState({ foreign: [...known, ...new Set(fresh.map((c) => c.root))] });
    this.dispatchEvent(new CustomEvent('foreign', { detail: { cp: fresh.reduce(newer) } }));
  }

  // 이 기기의 묶음·머리글·아이콘을 계정에 쓴다. 바뀐 것이 없으면 쓰지 않는다.
  async #publish(items: SyncItems, headers: Map<string, Header>): Promise<Partial<SyncStatus> | null> {
    const me = this.device;
    const prefix = packPrefix(me);
    const head = this.store.syncState.head;
    const old = headers.get(me);
    const writes: SyncItems = {};
    const removes: string[] = [];
    let trimmed = false;

    // 쓰고 난 뒤 계정 모습 (용량 계산용)
    const after: SyncItems = { ...items };
    const drop = (k: string) => {
      removes.push(k);
      delete after[k];
    };
    const writeHeader = (h: Header) => {
      writes[HEAD + me] = h;
      after[HEAD + me] = h;
    };

    // 어느 묶음도, 지금 상태도 쓰지 않는 아이콘 그림은 지운다
    const used = new Set<string>(this.store.shortcuts.map((s) => s.icon).filter((x): x is string => Boolean(x)));
    for (const p of this.#allPacks()) for (const id of iconsUsed(p)) used.add(id);
    for (const k of Object.keys(items)) if (k.startsWith(ICON) && !used.has(k.slice(ICON.length))) drop(k);

    let iconsOmitted = false;
    if (this.pack) {
      const intact = old && old.rev === this.packRev && joinChunks(items, prefix, old.rev, old.n) !== null;
      if (!intact) {
        for (const k of Object.keys(after)) if (k.startsWith(prefix)) drop(k);
        let pack = this.pack;
        let enc = await encode(pack);
        const need = () => totalBytes(after) + enc.length * 1.02 + 400;
        // Chrome의 계정 한도(100KB)를 넘으면 아이콘 그림부터 비운다. 받는 기기는 이미 가진 그림을 계속 쓴다.
        for (const k of Object.keys(after)) {
          if (need() <= TOTAL_LIMIT) break;
          if (k.startsWith(ICON)) {
            drop(k);
            iconsOmitted = true;
          }
        }
        // 그래도 넘치면 이 기기의 오래된 체크포인트부터 덜어 낸다
        while (need() > TOTAL_LIMIT && checkpointsOf(pack).length > 1) {
          pack = prune(pack, Math.floor(checkpointsOf(pack).length * 0.8));
          enc = await encode(pack);
          trimmed = true;
        }
        if (trimmed) {
          this.pack = pack;
          this.packRev = newRev();
          await this.storage.local.set({ pack, packRev: this.packRev });
        }
        const { items: chunks, n } = splitChunks(enc, prefix, this.packRev);
        Object.assign(writes, chunks);
        Object.assign(after, chunks);
        writeHeader({ rev: this.packRev, n, top: latestOf(this.pack), seen: head, at: Date.now() });
      } else if (old.seen !== head) {
        writeHeader({ ...old, seen: head, at: Date.now() });
      }
    } else if (head && (!old || old.seen !== head)) {
      // 체크포인트를 만든 적 없이 받기만 한 기기: 받았다는 표시만 남긴다
      writeHeader({ rev: '', n: 0, top: null, seen: head, at: Date.now() });
    }

    // 내 묶음과 지금 상태가 쓰는데 계정에 없는 아이콘은 올린다.
    // 다른 기기가 기록을 쓸 자리(ICON_ROOM)는 남겨 둔다. 기록이 아이콘보다 먼저다.
    const mine = new Set<string>(this.store.shortcuts.map((s) => s.icon).filter((x): x is string => Boolean(x)));
    if (this.pack) for (const id of iconsUsed(this.pack)) mine.add(id);
    let total = totalBytes(after);
    for (const id of mine) {
      const key = ICON + id;
      const data = this.store.icons[id];
      if (key in after || !data) continue;
      const b = itemBytes(key, data);
      if (b > ITEM_LIMIT || total + b > TOTAL_LIMIT - ICON_ROOM) {
        iconsOmitted = true;
        continue;
      }
      writes[key] = data;
      after[key] = data;
      total += b;
    }

    if (total > TOTAL_LIMIT) {
      this.#setStatus('too-big', { bytes: total });
      return null;
    }
    try {
      // 지울 것을 먼저 지워야 새로 쓰는 동안 한도를 넘지 않는다
      const stale = removes.filter((k) => !(k in writes));
      if (stale.length) await this.storage.sync.remove(stale);
      if (Object.keys(writes).length) await this.storage.sync.set(writes);
    } catch (e) {
      this.#setStatus('error', { message: (e as Error).message });
      return null;
    }
    for (const [k, v] of Object.entries(writes)) this.#items[k] = v;
    return { bytes: totalBytes(after), iconsOmitted, trimmed };
  }

  // 다른 기기가 이 기기의 체크포인트를 따르고 있으면 기억한다
  async #noteAcks(headers: Map<string, Header>): Promise<void> {
    if (this.store.syncState.ackedBy || !this.pack) return;
    const mine = new Set(checkpointsOf(this.pack).map((c) => c.id));
    for (const [dev, h] of headers) {
      if (dev !== this.device && h.seen && mine.has(h.seen)) {
        await this.store.setSyncState({ ackedBy: dev });
        return;
      }
    }
  }

  // received: 기기 사이에 실제로 전달된 적이 있는지. 이 기기가 남의 체크포인트를 받았거나,
  // 남이 이 기기의 체크포인트를 따르고 있을 때 참. 계정에 쓰기만 해서는 켜지 않는다.
  #setStatus(state: SyncStateName, extra: Partial<SyncStatus> = {}): void {
    const { receivedFrom, ackedBy } = this.store.syncState;
    this.status = { state, at: Date.now(), received: Boolean(receivedFrom || ackedBy), ...extra };
    this.dispatchEvent(new CustomEvent('status', { detail: this.status }));
  }
}
