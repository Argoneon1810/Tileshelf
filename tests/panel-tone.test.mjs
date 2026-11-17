import test from 'node:test';
import assert from 'node:assert/strict';

import { panelColor, clampPanelTone, DEFAULT_PANEL_TONE } from '../src/ts/panel-tone.ts';
import { Store } from '../src/ts/store.ts';
import { makeBackup, parseBackup } from '../src/ts/backup.ts';
import { newDevice } from './fake-chrome.mjs';

test('판 밝기는 0이 원래 유리색, 가운데(50)가 모든 판을 맞춘 중간색, 100이 아이콘 쪽 회색이다', () => {
  assert.equal(DEFAULT_PANEL_TONE, 50);
  assert.deepEqual(panelColor('dark', 0), [25, 29, 35]);
  assert.deepEqual(panelColor('dark', 50), [69, 78, 89]);
  assert.deepEqual(panelColor('dark', 100), [96, 106, 118]);
  assert.deepEqual(panelColor('light', 0), [244, 247, 251]);
  assert.deepEqual(panelColor('light', 50), [213, 223, 238]);
  assert.deepEqual(panelColor('light', 100), [194, 205, 219]);
});

test('판 밝기를 올리면 어두운 테마는 판이 밝아지고 밝은 테마는 어두워진다 (한 방향으로만)', () => {
  const sum = (c) => c[0] + c[1] + c[2];
  for (let t = 0; t < 100; t++) {
    assert.ok(sum(panelColor('dark', t + 1)) >= sum(panelColor('dark', t)), `dark ${t}`);
    assert.ok(sum(panelColor('light', t + 1)) <= sum(panelColor('light', t)), `light ${t}`);
  }
});

test('저장소·동기화·백업에서 들어온 이상한 판 밝기 값은 0~100 정수로 맞추고, 모르면 기본값', () => {
  assert.equal(clampPanelTone(-5), 0);
  assert.equal(clampPanelTone(140), 100);
  assert.equal(clampPanelTone(33.6), 34);
  assert.equal(clampPanelTone('80'), 50);
  assert.equal(clampPanelTone(undefined), 50);
  assert.equal(clampPanelTone(Number.NaN), 50);
});

test('판 밝기 설정은 기본 50으로 시작하고, 바꾼 값이 백업 파일로 옮겨진다', async () => {
  const store = new Store(newDevice().local);
  await store.load();
  assert.equal(store.settings.panelTone, 50);
  await store.setSettings({ panelTone: 80 });
  assert.equal(store.settings.panelTone, 80);

  const restored = new Store(newDevice().local);
  await restored.load();
  await restored.applyDoc(parseBackup(JSON.stringify(makeBackup(store))).doc, { origin: 'import' });
  assert.equal(restored.settings.panelTone, 80);
});
