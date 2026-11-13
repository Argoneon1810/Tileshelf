// 체크포인트 묶음(pack). 기기마다 자기가 만든 체크포인트를 하나의 묶음에 쌓는다.
// 브라우저 API에 기대지 않는 순수 함수라 node에서 그대로 시험한다.
//
// 묶음 = 가장 오래된 체크포인트의 전체 상태(base) + 그 뒤 체크포인트마다 '바로 앞 항목과 달라진 부분'(steps).
// 바로 앞 항목은 같은 묶음 안의 것이라, 묶음 하나만 있으면 그 안의 모든 체크포인트를 되살릴 수 있다.
// 다른 기기의 변경을 받은 뒤 고쳤다면 그 변경도 이 기기의 다음 변경분에 함께 들어간다.
// 바로가기 300개라도 변경분은 체크포인트마다 수십 바이트라서, 100개를 쌓아도 묶음은 기준 상태와 비슷한 크기다.
//
// 체크포인트의 계보(root): 처음 만든 체크포인트의 id를 자식들이 물려받는다. 기기는 자기 계보의 체크포인트만
// 저절로 따라간다. 새로 설치한 기기가 계정 데이터를 받기 전에 따로 시작한 기록은 다른 계보가 되어,
// 다른 기기의 바로가기를 저절로 덮지 못한다.

import type { Shortcut, Settings } from './store.ts';
import { t } from './i18n.ts';

export const MAX_CHECKPOINTS = 100;

// 체크포인트 하나가 담는 상태. 아이콘 그림은 계정에 따로 한 번만 둔다(바로가기는 아이콘 id만 가진다).
export interface DocState {
  shortcuts: Shortcut[];
  settings: Partial<Settings>;
}

// 무엇을 바꿔서 생긴 체크포인트인지. 기록 목록에 보여 줄 말을 만든다.
export interface What {
  add?: number;
  remove?: number;
  edit?: number;
  order?: boolean;
  settings?: boolean;
  import?: boolean;
  restore?: boolean;
  migrate?: boolean;
  reseed?: boolean;
}

export interface Checkpoint {
  id: string;
  at: number; // 사용자가 바꾼 시각
  dev: string; // 만든 기기
  parent: string | null; // 만들 때 이 기기가 보고 있던 체크포인트
  root: string; // 계보
  count: number; // 바로가기 수
  what: What;
}

export interface Diff {
  put?: Shortcut[]; // 새로 생기거나 바뀐 바로가기
  del?: string[]; // 지운 바로가기 id
  order?: { move: string; to: number } | string[]; // 한 칸 옮김, 또는 전체 순서
  settings?: Partial<Settings>; // 바뀐 설정
  unset?: string[]; // 없어진 설정 이름
}

export interface Pack {
  v: 2;
  dev: string;
  base: { cp: Checkpoint; state: DocState };
  steps: { cp: Checkpoint; d: Diff }[];
}

const clone = <T>(v: T): T => structuredClone(v);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// ---- 변경분 ----

// put·del만 적용했을 때의 순서: 남은 것은 원래 순서대로, 새것은 b에서의 순서대로 뒤에 붙는다
function naturalOrder(prev: string[], next: string[]): string[] {
  const keep = new Set(next);
  const had = new Set(prev);
  return [...prev.filter((id) => keep.has(id)), ...next.filter((id) => !had.has(id))];
}

function moveOne(order: string[], id: string, to: number): string[] {
  const out = order.filter((x) => x !== id);
  out.splice(to, 0, id);
  return out;
}

export function diff(a: DocState, b: DocState): Diff {
  const d: Diff = {};
  const before = new Map(a.shortcuts.map((s) => [s.id, s]));
  const after = new Set(b.shortcuts.map((s) => s.id));

  const put = b.shortcuts.filter((s) => !same(before.get(s.id), s));
  if (put.length) d.put = clone(put);
  const del = a.shortcuts.filter((s) => !after.has(s.id)).map((s) => s.id);
  if (del.length) d.del = del;

  const want = b.shortcuts.map((s) => s.id);
  const natural = naturalOrder(a.shortcuts.map((s) => s.id), want);
  if (natural.join() !== want.join()) {
    // 한 칸만 옮긴 것이면 처음 어긋나는 자리에 있는 둘 중 하나가 옮겨진 것이다
    const i = natural.findIndex((id, k) => id !== want[k]);
    const moved = [want[i], natural[i]].find((id) => moveOne(natural, id, want.indexOf(id)).join() === want.join());
    d.order = moved ? { move: moved, to: want.indexOf(moved) } : want;
  }

  const settings: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b.settings)) if (!same((a.settings as Record<string, unknown>)[k], v)) settings[k] = clone(v);
  if (Object.keys(settings).length) d.settings = settings as Partial<Settings>;
  const unset = Object.keys(a.settings).filter((k) => !(k in b.settings));
  if (unset.length) d.unset = unset;
  return d;
}

// 바뀌지 않은 바로가기는 a의 것을 그대로 쓴다(복제하지 않는다). 밖으로 내줄 때는 stateAt처럼 한 번 복제한다.
export function applyDiff(a: DocState, d: Diff): DocState {
  const put = new Map((d.put ?? []).map((s) => [s.id, s]));
  const del = new Set(d.del ?? []);
  const had = new Set(a.shortcuts.map((s) => s.id));
  let shortcuts = a.shortcuts.filter((s) => !del.has(s.id)).map((s) => put.get(s.id) ?? s);
  shortcuts.push(...(d.put ?? []).filter((s) => !had.has(s.id)));
  if (d.order) {
    const byId = new Map(shortcuts.map((s) => [s.id, s]));
    const ids = Array.isArray(d.order) ? d.order : moveOne(shortcuts.map((s) => s.id), d.order.move, d.order.to);
    shortcuts = ids.map((id) => byId.get(id)).filter((s): s is Shortcut => Boolean(s));
  }
  const settings: Record<string, unknown> = { ...clone(a.settings), ...clone(d.settings ?? {}) };
  for (const k of d.unset ?? []) delete settings[k];
  return { shortcuts, settings: settings as Partial<Settings> };
}

// ---- 묶음 ----

export function checkpointsOf(pack: Pack | null): Checkpoint[] {
  return pack ? [pack.base.cp, ...pack.steps.map((s) => s.cp)] : [];
}

export function latestOf(pack: Pack | null): Checkpoint | null {
  const all = checkpointsOf(pack);
  return all[all.length - 1] ?? null;
}

// id까지 되살린 상태. 묶음에 없으면 null.
// 돌려주는 상태는 복제본이라 고쳐도 묶음에 영향이 없다.
export function stateAt(pack: Pack, id: string): DocState | null {
  let state = pack.base.state;
  if (pack.base.cp.id === id) return clone(state);
  for (const step of pack.steps) {
    state = applyDiff(state, step.d);
    if (step.cp.id === id) return clone(state);
  }
  return null;
}

// 새 체크포인트를 묶음 끝에 붙인다. 묶음이 없으면 이것이 기준 상태가 된다. 넘치면 오래된 것부터 기준에 합친다.
export function appendCheckpoint(pack: Pack | null, cp: Checkpoint, state: DocState, max = MAX_CHECKPOINTS): Pack {
  if (!pack) return { v: 2, dev: cp.dev, base: { cp, state: clone(state) }, steps: [] };
  const last = latestOf(pack)!;
  const next: Pack = { ...pack, steps: [...pack.steps, { cp, d: diff(stateAt(pack, last.id)!, state) }] };
  return prune(next, max);
}

// 체크포인트를 max개만 남긴다. 버리는 것들은 다음 체크포인트의 기준 상태에 합쳐진다.
export function prune(pack: Pack, max = MAX_CHECKPOINTS): Pack {
  let base = pack.base;
  const steps = [...pack.steps];
  while (steps.length + 1 > Math.max(1, max)) {
    const first = steps.shift()!;
    base = { cp: first.cp, state: applyDiff(base.state, first.d) };
  }
  return { ...pack, base, steps };
}

// 이 묶음이 쓰는 아이콘 id (어느 체크포인트에서든)
export function iconsUsed(pack: Pack): Set<string> {
  const used = new Set<string>();
  const add = (list: Shortcut[] | undefined) => list?.forEach((s) => s.icon && used.add(s.icon));
  add(pack.base.state.shortcuts);
  for (const s of pack.steps) add(s.d.put);
  return used;
}

// 기록 목록에 보여 줄 말
export function describe(what: What): string {
  if (what.migrate) return t('cpMigrate');
  if (what.reseed) return t('cpReseed');
  if (what.import) return t('cpImport');
  if (what.restore) return t('cpRestore');
  const parts: string[] = [];
  if (what.add) parts.push(t('cpAdd', what.add));
  if (what.remove) parts.push(t('cpRemove', what.remove));
  if (what.edit) parts.push(t('cpEdit', what.edit));
  if (what.order) parts.push(t('cpOrder'));
  if (what.settings) parts.push(t('cpSettings'));
  return parts.join(', ') || t('cpGeneric');
}

// 두 What을 합친다 (연달아 바뀐 것을 체크포인트 하나로 모을 때)
export function mergeWhat(a: What, b: What): What {
  const out: What = { ...a };
  for (const k of ['add', 'remove', 'edit'] as const) if (b[k]) out[k] = (out[k] ?? 0) + b[k]!;
  for (const k of ['order', 'settings', 'import', 'restore', 'migrate', 'reseed'] as const) if (b[k]) out[k] = true;
  return out;
}

// 최신 판단: 바꾼 시각이 늦은 쪽, 같으면 id로 정한다 (어느 기기에서나 같은 답이 나오게)
export function newer(a: Checkpoint, b: Checkpoint): Checkpoint {
  if (a.at !== b.at) return a.at > b.at ? a : b;
  return a.id > b.id ? a : b;
}
