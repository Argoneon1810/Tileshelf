// 새 탭 화면의 시작점. Store를 읽어 화면을 그리고, 동기화와 각 화면 조각을 잇는다.

import { Store } from './store.ts';
import type { Settings, SyncDoc } from './store.ts';
import type { SyncStateName } from './sync.ts';
import type { CalmRect } from './aurora.ts';
import { Sync } from './sync.ts';
import { makeBackup, parseBackup, downloadJson, backupFilename } from './backup.ts';
import { Grid } from './ui/grid.ts';
import { SearchResults } from './ui/results.ts';
import { EditDialog } from './ui/edit.ts';
import { SettingsDrawer } from './ui/settings.ts';
import { IconInspectorDialog } from './ui/icon-inspector.ts';
import { toast } from './ui/toast.ts';
import { Intro } from './ui/intro.ts';
import { Background } from './background.ts';
import { readableOn } from './gradient.ts';
import { applyI18n, t } from './i18n.ts';
import { applyPanelTone } from './panel-tone.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const root = document.documentElement;
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

applyI18n();

const store = new Store();
await store.load();
const sync = new Sync(store);

// ---- 모양 ----

// 검색창과 바로가기들이 차지한 자리(화면 비율). 배경은 이 자리를 조용하게 그려 이름이 읽히게 한다.
// 검색 중(#grid 숨김)에는 조용한 구역을 다시 재지 않고 직전 값을 유지해 배경이 번쩍이지 않게 한다.
let lastCalm: CalmRect | undefined;
function calmRect(): CalmRect | undefined {
  if (!$('results').hidden && lastCalm) return lastCalm;
  const pad = 10;
  const rects = [$('search'), ...(store.isEmpty() ? [$('empty')] : document.querySelectorAll('#grid .tile'))]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width && r.height);
  if (!rects.length) return lastCalm;
  const clamp = (v: number): number => Math.min(1, Math.max(0, v));
  lastCalm = {
    x0: clamp((Math.min(...rects.map((r) => r.left)) - pad) / innerWidth),
    y0: clamp((Math.min(...rects.map((r) => r.top)) - pad) / innerHeight),
    x1: clamp((Math.max(...rects.map((r) => r.right)) + pad) / innerWidth),
    y1: clamp((Math.max(...rects.map((r) => r.bottom)) + pad) / innerHeight),
  };
  return lastCalm;
}

const background = new Background($('bg'), { calm: calmRect });

let prevThemeMode: string | null = null;

function applyLook(): void {
  const { theme, tileSize, iconScale, showLabel, hoverLabel, bgColor, accent, bgFit, dim, bgComposition, bgSeed, bgMotion } = store.settings;
  const mode = theme === 'system' ? (darkQuery.matches ? 'dark' : 'light') : theme;
  const themeSwitched = prevThemeMode !== null && prevThemeMode !== mode;
  prevThemeMode = mode;

  root.dataset.theme = mode;
  root.dataset.size = tileSize;
  root.dataset.showLabel = String(showLabel);
  root.dataset.hoverLabel = String(hoverLabel);
  root.style.setProperty('--icon-scale', `${iconScale}%`);
  root.style.setProperty('--dim', String(dim));
  applyPanelTone(root, mode, store.settings.panelTone);

  if (themeSwitched && store.shortcuts.some((s) => s.iconEffects?.enabled)) {
    renderGrid();
    if (results.active) results.render();
  }

  const kind = store.bgKind;
  const method = store.legibilityMethod;
  root.dataset.bg = kind;
  root.dataset.legibility = method;
  root.style.setProperty('--on-bg', readableOn(bgColor));
  // 중앙 음영은 더 좋은 방법을 찾을 때까지 쓰지 않는다 (BACKLOG). 그리는 코드는 남겨 둔다
  const calmZone = false;
  if (kind === 'image') background.showImage(store.bgImage!, bgFit, { theme: mode, calmZone });
  else if (kind === 'color') background.showColor(bgColor, { theme: mode });
  else background.showGradient({ accent, mode, composition: bgComposition, seed: bgSeed, motion: bgMotion, calmZone });
}
darkQuery.addEventListener('change', applyLook);

// ---- 바로가기·검색 ----

const edit = new EditDialog(store);
const grid = new Grid($('grid'), store, {
  onEdit: (id) => edit.open(id),
  onAdd: () => edit.open(),
});
const results = new SearchResults($('results'), $<HTMLInputElement>('q'), store, {
  onActiveChange: () => syncMainVisibility(),
});

// 편집 모드: 오른쪽 위 편집 단추로 켜고 끈다. 켜져 있으면 모든 바로가기에 편집 단추가 뜨고,
// 타일을 누르거나 Enter를 치면 사이트 대신 편집 창이 열린다. Esc로도 끝낸다(열린 대화상자가 없을 때).
const editModeBtn = $('edit-mode-btn');
function setEditing(on: boolean): void {
  grid.editing = on;
  document.documentElement.toggleAttribute('data-editing', on);
  editModeBtn.setAttribute('aria-pressed', String(on));
}
editModeBtn.addEventListener('click', () => setEditing(!grid.editing));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && grid.editing && !e.defaultPrevented && !document.querySelector('dialog[open]')) setEditing(false);
});

function syncMainVisibility(): void {
  const searching = results.active;
  $('grid').hidden = searching || store.isEmpty();
  $('empty').hidden = searching || !store.isEmpty();
}

function renderGrid(): void {
  grid.render();
  syncMainVisibility();
}

$('search').addEventListener('submit', (e) => {
  e.preventDefault();
  if (results.active) results.focusFirst();
});

// ---- 백업 ----

let pendingImport: { doc: SyncDoc; bgImage: string | null } | null = null;

function exportBackup(): void {
  downloadJson(makeBackup(store), backupFilename());
  toast(t('toastBackupExported'), { kind: 'success' });
}

$('backup-file').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    pendingImport = parseBackup(await file.text());
  } catch (err) {
    toast((err as Error).message, { kind: 'danger' });
    return;
  }
  const { doc, bgImage } = pendingImport;
  const parts = [t('importPartShortcuts', doc.shortcuts.length), t('importPartSettings')];
  if (bgImage) parts.push(t('importPartPhoto'));
  $('import-summary').textContent = t(bgImage ? 'importSummaryWithPhoto' : 'importSummaryNoPhoto', parts.join(', '));
  $('import-append').hidden = store.isEmpty();
  $<HTMLDialogElement>('import').showModal();
});

// 불러오기 직전 상태(배경 사진 포함)로 돌아간다. 되돌린 것도 기록에 남아 다른 기기가 따른다.
function undoTo(before: SyncDoc, bgImage: string | null): () => Promise<void> {
  return () => store.applyDoc(before, { origin: 'restore', bgImage });
}

$('import-replace').addEventListener('click', async () => {
  const { doc, bgImage } = pendingImport!;
  const undo = undoTo(store.syncDoc(), store.bgImage);
  await store.applyDoc(doc, { origin: 'import', bgImage: bgImage ?? undefined });
  $<HTMLDialogElement>('import').close();
  toast(t('toastImportedShortcuts', doc.shortcuts.length), {
    kind: 'success',
    action: { label: t('actionUndo'), run: undo },
  });
});

$('import-append').addEventListener('click', async () => {
  const { doc } = pendingImport!;
  const undo = undoTo(store.syncDoc(), store.bgImage);
  await store.appendShortcuts(doc.shortcuts, doc.icons);
  $<HTMLDialogElement>('import').close();
  toast(t('toastAppendedShortcuts', doc.shortcuts.length), {
    kind: 'success',
    action: { label: t('actionUndo'), run: undo },
  });
});

const openImport = () => $('backup-file').click();
$('empty-add').addEventListener('click', () => edit.open());
$('empty-import').addEventListener('click', openImport);

// ---- 설정·동기화 표시 ----

const inspector = new IconInspectorDialog(store);
const settings = new SettingsDrawer(store, sync, {
  onExport: exportBackup,
  onImportClick: openImport,
  onOpenInspector: () => void inspector.open(),
  onOpenBake: () => inspector.openBakeWarning(),
  background,
});
// 동기화는 손을 써야 할 때(실패, 용량 초과)만 설정 단추 위에 점으로 알린다. 평소 상태는 설정 서랍에서 본다.
const SYNC_PROBLEMS: SyncStateName[] = ['error', 'too-big'];
let syncProblem = false;
$('settings-btn').addEventListener('click', () => settings.open(syncProblem ? 'sec-sync' : undefined));

let lastState: SyncStateName | null = null;
sync.addEventListener('status', (e) => {
  const st = e.detail;
  syncProblem = SYNC_PROBLEMS.includes(st.state);
  $('settings-btn').querySelector<HTMLElement>('.status-dot')!.dataset.state = syncProblem ? st.state : 'off';
  $('settings-btn').setAttribute('aria-label', t(syncProblem ? 'ariaSettingsProblem' : 'ariaSettings'));

  if (st.state !== lastState) {
    if (st.state === 'error') {
      toast(t('toastSyncFailed', st.message ?? ''), {
        kind: 'danger',
        action: { label: t('actionRetry'), run: () => sync.reconcile() },
      });
    } else if (st.state === 'too-big') {
      toast(t('toastSyncTooBig'), { kind: 'warning', timeout: 9000 });
    }
  }
  lastState = st.state;
});
// 다른 PC에서 끌어 옮기기처럼 연달아 바꾸면 받을 때마다 알리지 않도록 잠시 쉰다
let lastAppliedToast = 0;
sync.addEventListener('applied', (e) => {
  const { overwroteLocal, count, mine } = e.detail;
  if (!overwroteLocal && Date.now() - lastAppliedToast < 10000) return;
  lastAppliedToast = Date.now();
  toast(t(overwroteLocal ? 'toastSyncOverwrote' : 'toastSyncApplied', count), {
    kind: 'success',
    action: overwroteLocal && mine ? { label: t('actionUndo'), run: () => sync.restore(mine) } : undefined,
  });
});
// 다른 기기가 계정 기록을 받기 전에 따로 시작한 기록이 보이면 알린다. 저절로 따르지 않는다.
sync.addEventListener('foreign', (e) => {
  toast(t('toastForeignHistory', e.detail.cp.count), {
    kind: 'warning',
    timeout: 12000,
    action: { label: t('actionViewHistory'), run: () => settings.open('sec-history') },
  });
});

// ---- 공통 ----

document.addEventListener('click', (e) => {
  const closer = (e.target as Element).closest('[data-close]');
  if (closer) closer.closest('dialog')!.close();
  // 대화상자 바깥(어두운 막)을 누르면 닫는다
  if (e.target instanceof HTMLDialogElement) e.target.close();
});

// 바로가기를 먼저 그려야 배경이 그 자리를 알고 조용하게 그린다
// 설정이 바뀌어도 필요한 부분만 다시 그린다. 바로가기 칸을 통째로 다시 만들면 아이콘과
// 유리 효과가 한순간 다시 그려지며 번쩍인다. keys가 없으면(되돌리기·동기화) 설정 전체가 바뀐 것이다.
const LOOK_KEYS: (keyof Settings)[] = [
  'theme',
  'tileSize',
  'iconScale',
  'panelTone',
  'showLabel',
  'hoverLabel',
  'bgType',
  'bgColor',
  'accent',
  'bgFit',
  'dim',
  'bgComposition',
  'bgSeed',
  'bgMotion',
  'legibility',
];
const GRID_KEYS: (keyof Settings)[] = ['openInNewTab', 'showLabel', 'suppressTooltip'];
const SEARCH_KEYS: (keyof Settings)[] = ['searchOrder', 'openInNewTab'];
store.addEventListener('change', (e) => {
  const { parts, keys } = e.detail;
  const settingsChanged = (list: (keyof Settings)[]): boolean => parts.includes('settings') && (!keys || keys.some((k) => list.includes(k)));
  if (parts.includes('shortcuts') || parts.includes('icons') || settingsChanged(GRID_KEYS)) renderGrid();
  if (results.active && (parts.includes('shortcuts') || parts.includes('icons') || settingsChanged(SEARCH_KEYS))) results.render();
  if (settingsChanged(LOOK_KEYS) || parts.includes('bgImage')) applyLook();
  else if (parts.includes('shortcuts') && !results.active) background.updateCalm();
});

const intro = new Intro(store, background, sync, { onImport: openImport, pickPhoto: () => settings.pickPhoto() });
$('intro-again').addEventListener('click', () => {
  $<HTMLDialogElement>('settings').close();
  intro.open();
});

root.dataset.theme = store.settings.theme === 'system' ? (darkQuery.matches ? 'dark' : 'light') : store.settings.theme;
prevThemeMode = root.dataset.theme;
renderGrid();
applyLook();
// 처음 실행 안내는 동기화로 다른 PC의 설정이 들어오는지 먼저 본 뒤에 띄울지 정한다
sync.start().then(() => intro.maybeShow());

// 화면 시험(tests/dev)이 배경을 특정 시각에 멈춰 보기 위한 손잡이
(globalThis as typeof globalThis & { __newtab?: unknown }).__newtab = { background, store, sync };
