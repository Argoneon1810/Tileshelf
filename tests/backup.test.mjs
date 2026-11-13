import test from 'node:test';
import assert from 'node:assert/strict';

import { makeBackup, parseBackup, hostLabel, BACKUP_APP } from '../src/ts/backup.ts';
import { Store, normalizeUrl, isSafeShortcutUrl } from '../src/ts/store.ts';
import { newDevice } from './fake-chrome.mjs';

test('이 확장의 백업은 배경 사진과 설정까지 그대로 돌아온다', async () => {
  const dev = newDevice();
  const a = new Store(dev.local);
  await a.load();
  await a.addShortcut({ name: 'Claude', url: 'https://claude.ai', iconData: 'data:image/webp;base64,AAAA' });
  await a.setSettings({ theme: 'light', dim: 0.4, bgType: 'image', syncEnabled: false });
  await a.setBgImage('data:image/jpeg;base64,BBBB');

  const parsed = parseBackup(JSON.stringify(makeBackup(a)));

  const b = new Store(newDevice().local);
  await b.load();
  await b.applyDoc(parsed.doc, { origin: 'import', bgImage: parsed.bgImage });
  assert.deepEqual(b.shortcuts, a.shortcuts);
  assert.deepEqual(b.icons, a.icons);
  assert.equal(b.bgImage, 'data:image/jpeg;base64,BBBB');
  assert.equal(b.settings.theme, 'light');
  assert.equal(b.settings.dim, 0.4);
  // 동기화 켜기/끄기는 PC마다 따로라서 백업으로 옮기지 않는다
  assert.equal(b.settings.syncEnabled, true);
});

test('배경 종류는 그라데이션·단색·사진만 남기고, 모르는 값은 그라데이션으로 바꾼다', async () => {
  for (const [given, expected] of [['color', 'color'], ['image', 'image'], ['gradient', 'gradient'], ['photo', 'gradient'], [undefined, 'gradient']]) {
    const dev = newDevice();
    await dev.local.set({ settings: { bgType: given, bgColor: '#000000', dim: 0.3 } });
    const s = new Store(dev.local);
    await s.load();
    assert.equal(s.settings.bgType, expected, String(given));
    assert.equal(s.settings.dim, 0.3);
  }
});

test('알 수 없는 파일은 이유와 함께 거절한다', () => {
  assert.throws(() => parseBackup('not json'), /JSON/);
  assert.throws(() => parseBackup('{"foo":1}'), /백업 파일이 아닙니다/);
  // 다른 앱이 내보낸 바로가기 배열 같은 것도 이 확장의 백업이 아니므로 거절한다
  assert.throws(() => parseBackup('[{"name":"A","url":"https://a.com"}]'), /백업 파일이 아닙니다/);
});

test('위험한 주소 스킴과 비이미지 데이터는 백업과 주소 정규화에서 모두 걸러진다', () => {
  for (const bad of [
    'javascript:alert(1)',
    'javascript://example.com/%0aalert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'blob:https://example.com/1234',
  ]) {
    assert.equal(normalizeUrl(bad), '', `차단되어야 함: ${bad}`);
    assert.equal(isSafeShortcutUrl(bad), false, `차단되어야 함: ${bad}`);
  }

  // Windows 드라이브 경로와 file:// 주소는 허용하고 파일명을 기본 이름으로 쓴다
  const winFile = normalizeUrl('D:\\docs\\report.pdf');
  assert.equal(winFile, 'file:///D:/docs/report.pdf');
  assert.equal(isSafeShortcutUrl(winFile), true);
  assert.equal(hostLabel(winFile), 'report.pdf');

  const mixed = parseBackup(JSON.stringify({
    app: BACKUP_APP,
    version: 1,
    shortcuts: [
      { id: 'ok1', name: '안전', url: 'https://safe.example', icon: 'good', addedAt: 10 },
      { id: 'ok2', name: '', url: 'D:\\work\\memo.txt', icon: 'svgbad', addedAt: 20 },
      { id: 'bad1', name: 'XSS', url: 'javascript:alert(1)', addedAt: 30 },
      { id: 'bad2', name: 'Data', url: 'data:text/html,hi', addedAt: 40 },
    ],
    icons: {
      good: 'data:image/png;base64,AAAA',
      svgbad: 'data:image/svg+xml;base64,BBBB',
      extbad: 'https://evil.example/pixel.png',
    },
    bgImage: 'https://evil.example/bg.jpg',
  }));
  assert.deepEqual(mixed.doc.shortcuts.map((s) => [s.id, s.name, s.url, s.icon]), [
    ['ok1', '안전', 'https://safe.example', 'good'],
    ['ok2', 'memo.txt', 'file:///D:/work/memo.txt', undefined],
  ]);
  assert.deepEqual(mixed.doc.icons, { good: 'data:image/png;base64,AAAA' });
  assert.equal(mixed.bgImage, null);

  // 모든 바로가기가 위험 스킴뿐인 손상 파일은 빈 목록으로 덮어쓰지 않도록 거절한다
  assert.throws(
    () => parseBackup(JSON.stringify({
      app: BACKUP_APP,
      version: 1,
      shortcuts: [{ id: 'x', name: 'X', url: 'javascript:alert(1)' }],
    })),
    /올바른 바로가기/,
  );
});
