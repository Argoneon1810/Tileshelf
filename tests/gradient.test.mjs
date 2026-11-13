import test from 'node:test';
import assert from 'node:assert/strict';

import { hexToOklch, oklchToHex, ACCENT_PRESETS } from '../src/ts/gradient.ts';
import { buildScene, sceneAt, fieldAt, COMPOSITIONS, DEFAULT_CALM } from '../src/ts/aurora.ts';

// mcp-color-convert 0.1.3이 낸 값. JS 변환이 색 계산 도구와 같은 답을 내는지 본다.
const ENGINE_TO_OKLCH = {
  '#4c88d3': [0.62076, 0.13028, 254.98982],
  '#ffff00': [0.96798, 0.21101, 109.76944],
  '#0000ff': [0.45201, 0.31322, 264.05151],
  '#808080': [0.59987, 0, 0],
  '#00ff00': [0.86644, 0.29483, 142.49539],
  '#8b4513': [0.47078, 0.11214, 50.84468],
  '#ffd1dc': [0.9032, 0.05348, 2.18613],
  '#e176a1': [0.69896, 0.14055, 355.91584],
};
const ENGINE_TO_HEX = [
  [[0.5, 0.1, 30], '#944b40'],
  [[0.9, 0.05, 200], '#b8e9eb'],
  [[0.2, 0.03, 280], '#131423'],
];

test('hex → OKLCH가 색 계산 도구와 같다', () => {
  for (const [hex, [L, C, h]] of Object.entries(ENGINE_TO_OKLCH)) {
    const got = hexToOklch(hex);
    assert.ok(Math.abs(got.L - L) < 0.002, `${hex} L ${got.L} vs ${L}`);
    assert.ok(Math.abs(got.C - C) < 0.002, `${hex} C ${got.C} vs ${C}`);
    if (C > 0.01) assert.ok(Math.abs(got.h - h) < 0.5, `${hex} h ${got.h} vs ${h}`);
  }
});

test('OKLCH → hex가 색 계산 도구와 같다 (채널당 ±1)', () => {
  for (const [[L, C, h], hex] of ENGINE_TO_HEX) {
    const got = oklchToHex(L, C, h);
    for (let i = 1; i < 7; i += 2) {
      assert.ok(Math.abs(parseInt(got.slice(i, i + 2), 16) - parseInt(hex.slice(i, i + 2), 16)) <= 1, `${got} vs ${hex}`);
    }
  }
});

test('sRGB 밖의 색도 깨지지 않고 hex가 나온다', () => {
  assert.match(oklchToHex(0.7, 0.4, 145), /^#[0-9a-f]{6}$/);
  assert.match(oklchToHex(0.95, 0.3, 90), /^#[0-9a-f]{6}$/);
});

test('같은 씨앗이면 어느 PC에서나 같은 장면이고, 씨앗이 다르면 달라진다', () => {
  const a = buildScene({ accent: '#4087de', mode: 'dark', seed: 7, composition: 'aurora' });
  const b = buildScene({ accent: '#4087de', mode: 'dark', seed: 7, composition: 'aurora' });
  const c = buildScene({ accent: '#4087de', mode: 'dark', seed: 8, composition: 'aurora' });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.spots, c.spots);
});

test('정지 화면은 흐르는 그림의 0초와 같다', () => {
  const sc = buildScene({ accent: '#df5e97', mode: 'dark', seed: 3, composition: 'bloom' });
  assert.equal(sceneAt(sc, 0), sc);
  assert.notDeepEqual(sceneAt(sc, 5).spots, sc.spots);
});

test('어떤 색·구도·시각이어도 색 값이 깨지지 않는다', () => {
  const colors = [...ACCENT_PRESETS.map((p) => p[2]), '#000000', '#ffffff', '#ffff00', '#0000ff'];
  for (const accent of colors) {
    for (const mode of ['dark', 'light']) {
      for (const composition of COMPOSITIONS) {
        const sc = buildScene({ accent, mode, seed: 11, composition });
        for (const t of [0, 13.7]) {
          for (const [u, v] of [[0, 0], [0.5, 0.3], [1, 1], [0.2, 0.9]]) {
            const lab = fieldAt(sceneAt(sc, t), u, v);
            assert.ok(lab.every(Number.isFinite), `${accent} ${mode} ${composition} ${t}`);
            assert.ok(lab[0] >= 0 && lab[0] <= 1);
          }
        }
      }
    }
  }
});

test('어두운 판에서 조용한 구역 한가운데는 흰 글자와 5:1이 되는 밝기(OKLab 0.5) 아래다', () => {
  const mid = [(DEFAULT_CALM.x0 + DEFAULT_CALM.x1) / 2, (DEFAULT_CALM.y0 + DEFAULT_CALM.y1) / 2];
  for (const [, , accent] of ACCENT_PRESETS) {
    for (const composition of COMPOSITIONS) {
      for (const seed of [1, 2, 3, 4, 5]) {
        const sc = buildScene({ accent, mode: 'dark', seed, composition });
        assert.ok(fieldAt(sc, ...mid)[0] < 0.5, `${accent} ${composition} ${seed}`);
      }
    }
  }
});
