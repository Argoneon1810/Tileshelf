import test from 'node:test';
import assert from 'node:assert/strict';

import { looksLikeUrl, filterShortcuts, buildSearchGroups } from '../src/ts/search.ts';
import { Store, DEFAULT_SEARCH_ORDER } from '../src/ts/store.ts';
import { newDevice } from './fake-chrome.mjs';

const SHORTCUTS = [
  { id: '1', name: 'GitHub', url: 'https://github.com', addedAt: 1 },
  { id: '2', name: '네이버', url: 'https://naver.com', addedAt: 2 },
  { id: '3', name: '네이버 지도', url: 'https://map.naver.com', addedAt: 3 },
];

test('올바른 주소 판정: 도메인, 스킴이 있는 주소, localhost는 참이고 일반 검색어나 잘못된 주소는 거짓이다', () => {
  for (const ok of [
    'naver.com',
    'www.example.com/page?q=1#top',
    'https://claude.ai',
    'http://localhost:3000/test',
    'localhost',
    'localhost:8080',
    'sub.domain.co.kr:8443/path',
  ]) {
    assert.equal(looksLikeUrl(ok), true, `참이어야 함: ${ok}`);
  }
  for (const bad of [
    '',
    '   ',
    '고양이',
    'git',
    'naver .com',
    'https://exa mple.com',
    'http://',
    'justword',
    'a.b',
    'example.com:999999',
    'javascript://alert(1)',
    'data://text/html,hi',
    'vbscript://run',
    'blob://local/1',
  ]) {
    assert.equal(looksLikeUrl(bad), false, `거짓이어야 함: ${bad}`);
  }
});

test('키워드로 바로가기를 거를 때 이름이나 주소에 대소문자 구분 없이 들어 있으면 남긴다', () => {
  assert.deepEqual(
    filterShortcuts(SHORTCUTS, 'GIT').map((s) => s.id),
    ['1'],
  );
  assert.deepEqual(
    filterShortcuts(SHORTCUTS, 'naver').map((s) => s.id),
    ['2', '3'],
  );
  assert.deepEqual(
    filterShortcuts(SHORTCUTS, '지도').map((s) => s.id),
    ['3'],
  );
  assert.deepEqual(filterShortcuts(SHORTCUTS, '없는키워드'), []);
});

test('묶음 순서는 설정(searchOrder)을 그대로 따르고, 주소가 아니면 주소 묶음은 빼며 웹 검색은 늘 둔다', () => {
  const g1 = buildSearchGroups('네이버', SHORTCUTS, ['shortcuts', 'url', 'web']);
  assert.deepEqual(
    g1.map((g) => g.kind),
    ['shortcuts', 'web'],
  );
  assert.equal(g1[0].title, '바로가기 2개');
  assert.equal(g1[0].chips.length, 2);
  assert.equal(g1[1].title, '웹 검색');
  assert.equal(g1[1].chips[0].label, "'네이버' 검색");

  const g2 = buildSearchGroups('naver.com', SHORTCUTS, ['web', 'url', 'shortcuts']);
  assert.deepEqual(
    g2.map((g) => g.kind),
    ['web', 'url', 'shortcuts'],
  );
  assert.equal(g2[1].title, '주소로 이동');
  assert.deepEqual(g2[1].chips[0], {
    kind: 'url',
    url: 'https://naver.com',
    label: 'naver.com(으)로 이동',
  });
});

test('맞는 바로가기가 하나도 없어도 바로가기 묶음은 남고 안내 문구를 담는다', () => {
  const groups = buildSearchGroups('없는검색어', SHORTCUTS, DEFAULT_SEARCH_ORDER);
  assert.deepEqual(
    groups.map((g) => g.kind),
    ['shortcuts', 'web'],
  );
  assert.equal(groups[0].title, '바로가기 0개');
  assert.equal(groups[0].chips.length, 0);
  assert.equal(groups[0].emptyText, '맞는 바로가기가 없습니다');
});

test('입력이 비어 있으면 빈 묶음 배열을 돌려준다', () => {
  assert.deepEqual(buildSearchGroups('   ', SHORTCUTS, DEFAULT_SEARCH_ORDER), []);
});

test('migrateSettings는 잘못된 searchOrder를 기본값으로 되돌리고 옛 searchDefault를 지운다', async () => {
  for (const bad of [undefined, null, 'web', ['shortcuts', 'web'], ['shortcuts', 'shortcuts', 'web'], ['a', 'b', 'c']]) {
    const dev = newDevice();
    await dev.local.set({ settings: { searchOrder: bad, searchDefault: 'web' } });
    const s = new Store(dev.local);
    await s.load();
    assert.deepEqual(s.settings.searchOrder, ['shortcuts', 'url', 'web']);
    assert.equal('searchDefault' in s.settings, false);
  }

  const dev = newDevice();
  await dev.local.set({ settings: { searchOrder: ['web', 'shortcuts', 'url'], searchDefault: 'shortcuts' } });
  const s = new Store(dev.local);
  await s.load();
  assert.deepEqual(s.settings.searchOrder, ['web', 'shortcuts', 'url']);
  assert.equal('searchDefault' in s.settings, false);
});
