// 백업 파일 만들기와 읽기. 계정 동기화와 달리 배경 사진까지 모두 담는다.

import { isSafeImageDataUrl, isSafeShortcutUrl, newId, normalizeUrl } from './store.ts';
import type { Icons, Shortcut, Store, SyncDoc } from './store.ts';
import { sanitizeIconEffects } from './icon-effects.ts';
import { t } from './i18n.ts';

export const BACKUP_APP = 'tileshelf';
export const LEGACY_BACKUP_APPS = ['shortcuts-newtab'] as const;

export interface Backup extends SyncDoc {
  app: typeof BACKUP_APP | (typeof LEGACY_BACKUP_APPS)[number];
  version: 1;
  exportedAt: string;
  bgImage: string | null;
}

export function makeBackup(store: Store): Backup {
  return {
    app: BACKUP_APP,
    version: 1,
    exportedAt: new Date().toISOString(),
    ...store.syncDoc(),
    bgImage: store.bgImage,
  };
}

function isKnownBackupApp(app: unknown): boolean {
  return app === BACKUP_APP || (LEGACY_BACKUP_APPS as readonly unknown[]).includes(app);
}

// 돌려주는 값: { doc, bgImage } — doc은 Store.applyDoc에 그대로 넣을 수 있는 모양이다.
export function parseBackup(text: string): { doc: SyncDoc; bgImage: string | null } {
  let data: Partial<Backup> | null;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(t('errInvalidJson'));
  }

  if (isKnownBackupApp(data?.app) && Array.isArray(data?.shortcuts)) {
    const safeIcons: Icons = {};
    if (data.icons && typeof data.icons === 'object') {
      for (const [k, v] of Object.entries(data.icons)) {
        if (k && isSafeImageDataUrl(v)) safeIcons[k] = v;
      }
    }
    const shortcuts: Shortcut[] = [];
    for (const raw of data.shortcuts) {
      if (!raw || typeof raw !== 'object' || typeof raw.url !== 'string') continue;
      const url = normalizeUrl(raw.url);
      if (!isSafeShortcutUrl(url)) continue;
      const item: Shortcut = {
        id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
        name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : hostLabel(url),
        url,
        addedAt: typeof raw.addedAt === 'number' && Number.isFinite(raw.addedAt) ? raw.addedAt : Date.now(),
      };
      if (typeof raw.icon === 'string' && raw.icon in safeIcons) item.icon = raw.icon;
      const effects = sanitizeIconEffects(raw.iconEffects);
      if (effects && effects.enabled) item.iconEffects = effects;
      shortcuts.push(item);
    }
    if (data.shortcuts.length > 0 && shortcuts.length === 0) {
      throw new Error(t('errNoValidShortcuts'));
    }
    const bgImage = isSafeImageDataUrl(data.bgImage) ? data.bgImage : null;
    return { doc: { v: 1, shortcuts, settings: data.settings ?? {}, icons: safeIcons }, bgImage };
  }
  throw new Error(t('errForeignBackup'));
}

export function hostLabel(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') {
      const clean = decodeURIComponent(u.pathname).replace(/\/+$/, '');
      return clean.split('/').pop() || clean || url;
    }
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function downloadJson(obj: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function backupFilename(d: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `tileshelf-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`;
}
