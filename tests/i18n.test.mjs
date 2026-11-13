import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MESSAGES, setLocaleForTest, t } from '../src/ts/i18n.ts';
import { buildSearchGroups } from '../src/ts/search.ts';
import { describe } from '../src/ts/checkpoints.ts';
import { parseBackup, backupFilename, BACKUP_APP } from '../src/ts/backup.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('내장 한·영 사전과 _locales/en·ko JSON이 1:1 일치하고 Chrome 규격을 지킨다', () => {
  const koKeys = Object.keys(MESSAGES.ko).sort();
  const enKeys = Object.keys(MESSAGES.en).sort();
  assert.deepEqual(enKeys, koKeys, 'MESSAGES.en과 MESSAGES.ko의 키 집합이 일치해야 한다');

  for (const locale of ['en', 'ko']) {
    const jsonPath = join(root, 'src', '_locales', locale, 'messages.json');
    const json = JSON.parse(readFileSync(jsonPath, 'utf8'));
    assert.deepEqual(Object.keys(json).sort(), koKeys, `_locales/${locale}/messages.json 키 목록 일치`);

    for (const key of koKeys) {
      const expected = MESSAGES[locale][key];
      assert.ok(expected.length > 0, `${locale}.${key}는 비어 있으면 안 된다`);
      assert.equal(json[key]?.message, expected, `_locales/${locale}/messages.json[${key}] 값 일치`);
      assert.equal(json[key].message.includes('$'), false, `_locales/${locale}에 미정의 $ 자리표시자가 없어야 한다: ${key}`);
    }
    assert.ok(json.extDescription.message.length <= 132, `${locale} extDescription은 132자 이하여야 한다`);
  }
});

test('newtab.html의 모든 data-i18n* 속성이 사전에 정의되어 있다', () => {
  const html = readFileSync(join(root, 'src', 'newtab.html'), 'utf8');
  const attrs = ['data-i18n', 'data-i18n-placeholder', 'data-i18n-aria-label', 'data-i18n-title'];
  let count = 0;
  for (const attr of attrs) {
    const re = new RegExp(`\\b${attr}="([^"]+)"`, 'g');
    for (const m of html.matchAll(re)) {
      const key = m[1];
      assert.ok(key in MESSAGES.ko, `newtab.html의 ${attr}="${key}"가 MESSAGES.ko에 없다`);
      assert.ok(key in MESSAGES.en, `newtab.html의 ${attr}="${key}"가 MESSAGES.en에 없다`);
      count++;
    }
  }
  assert.ok(count >= 80, `번역 연결 속성 수 점검 (${count}개)`);
});

test('영어 로케일 전환 시 검색·기록·백업 문구와 새·옛 백업 식별자가 모두 동작한다', (tCtx) => {
  tCtx.after(() => setLocaleForTest(null));
  setLocaleForTest('en');

  assert.equal(BACKUP_APP, 'tileshelf');
  assert.equal(backupFilename(new Date(2026, 10, 13)), 'tileshelf-backup-20261113.json');
  assert.equal(t('cpAdd', 3), 'Added 3 shortcut(s)');
  assert.equal(describe({ add: 2 }), 'Added 2 shortcut(s)');

  const groups = buildSearchGroups('example.com', [{ id: '1', name: 'Example', url: 'https://example.com', addedAt: 1 }], ['shortcuts', 'url', 'web']);
  assert.deepEqual(groups.map((g) => g.title), ['Shortcuts (1)', 'Go to address', 'Web search']);

  // 이전 개발판('shortcuts-newtab')에서 내보낸 백업 파일도 그대로 읽혀야 한다
  const legacy = parseBackup(JSON.stringify({
    app: 'shortcuts-newtab',
    version: 1,
    shortcuts: [{ id: 's1', name: 'Docs', url: 'https://docs.example' }],
  }));
  assert.equal(legacy.doc.shortcuts.length, 1);

  assert.throws(() => parseBackup('{"foo":1}'), /not a Tileshelf backup/);
});
