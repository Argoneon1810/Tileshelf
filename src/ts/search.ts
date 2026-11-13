// 검색창 입력으로 아래에 보여 줄 칩 묶음(바로가기, 주소 이동, 웹 검색)을 만든다.
// 화면(DOM)에 기대지 않는 순수 함수라 node에서 그대로 시험한다.

import { normalizeUrl, isSafeShortcutUrl } from './store.ts';
import type { Shortcut, SearchGroupKind } from './store.ts';
import { t } from './i18n.ts';

export type SearchChip =
  | { kind: 'shortcut'; shortcut: Shortcut; label: string }
  | { kind: 'url'; url: string; label: string }
  | { kind: 'web'; query: string; label: string };

export interface SearchGroup {
  kind: SearchGroupKind;
  title: string;
  chips: SearchChip[];
  emptyText?: string;
}

export function looksLikeUrl(text: string): boolean {
  const s = text.trim();
  if (!s || /\s/.test(s)) return false;
  const matched =
    /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ||
    /^localhost(:\d+)?(\/|$)/i.test(s) ||
    /^[^/]+\.[a-z]{2,}(:\d+)?(\/|$)/i.test(s);
  if (!matched) return false;
  return isSafeShortcutUrl(normalizeUrl(s));
}

export function filterShortcuts(shortcuts: readonly Shortcut[], query: string): Shortcut[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...shortcuts];
  return shortcuts.filter((s) => s.name.toLowerCase().includes(q) || s.url.toLowerCase().includes(q));
}

export function buildSearchGroups(
  rawQuery: string,
  shortcuts: readonly Shortcut[],
  order: readonly SearchGroupKind[],
): SearchGroup[] {
  const query = rawQuery.trim();
  if (!query) return [];
  const matched = filterShortcuts(shortcuts, query);
  const isUrl = looksLikeUrl(query);

  const groups: SearchGroup[] = [];
  for (const kind of order) {
    if (kind === 'shortcuts') {
      groups.push({
        kind: 'shortcuts',
        title: t('searchGroupShortcuts', matched.length),
        chips: matched.map((shortcut) => ({ kind: 'shortcut', shortcut, label: shortcut.name })),
        ...(matched.length === 0 ? { emptyText: t('searchEmptyShortcuts') } : {}),
      });
    } else if (kind === 'url') {
      if (!isUrl) continue;
      groups.push({
        kind: 'url',
        title: t('searchGroupUrl'),
        chips: [{ kind: 'url', url: normalizeUrl(query), label: t('searchGoToUrl', query) }],
      });
    } else if (kind === 'web') {
      groups.push({
        kind: 'web',
        title: t('searchGroupWeb'),
        chips: [{ kind: 'web', query, label: t('searchWebChip', query) }],
      });
    }
  }
  return groups;
}
