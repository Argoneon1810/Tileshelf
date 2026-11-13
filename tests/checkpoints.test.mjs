// 실행: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

import { diff, applyDiff, appendCheckpoint, stateAt, checkpointsOf, prune, iconsUsed, MAX_CHECKPOINTS } from '../src/ts/checkpoints.ts';
import { encode } from '../src/ts/syncdoc.ts';
import { rng } from '../src/ts/aurora.ts';
import { DEFAULT_SETTINGS } from '../src/ts/store.ts';

// 씨앗으로 정해지는 무작위 편집. 실제 화면에서 일어나는 변경을 고루 섞는다.
function editor(seed) {
  const r = rng(seed);
  const pick = (list) => list[Math.floor(r() * list.length)];
  let n = 0;
  const newShortcut = () => ({ id: 'id' + seed + '-' + n++, name: '사이트 ' + n, url: `https://site${n}.example.com/`, addedAt: 1700000000000 + n, ...(r() < 0.2 && { icon: 'ic' + n }) });
  return (prev) => {
    const s = structuredClone(prev);
    const kind = Math.floor(r() * 7);
    if (kind === 0 || !s.shortcuts.length) s.shortcuts.push(newShortcut());
    else if (kind === 1) s.shortcuts.splice(Math.floor(r() * (s.shortcuts.length + 1)), 0, newShortcut());
    else if (kind === 2) s.shortcuts.splice(Math.floor(r() * s.shortcuts.length), 1);
    else if (kind === 3) pick(s.shortcuts).name += '!';
    else if (kind === 4) {
      const [m] = s.shortcuts.splice(Math.floor(r() * s.shortcuts.length), 1);
      s.shortcuts.splice(Math.floor(r() * (s.shortcuts.length + 1)), 0, m);
    } else if (kind === 5) s.shortcuts.reverse();
    else s.settings = { ...s.settings, bgSeed: Math.floor(r() * 1000), theme: pick(['dark', 'light', 'system']) };
    return s;
  };
}

const start = () => ({ shortcuts: [], settings: { ...DEFAULT_SETTINGS } });
const cp = (i, state) => ({ id: 'cp' + i, at: 1000 + i, dev: 'A', parent: i ? 'cp' + (i - 1) : null, root: 'cp0', count: state.shortcuts.length, what: {} });

test('변경분을 적용하면 다음 상태가 그대로 나온다 (무작위 편집 2000번)', () => {
  for (const seed of [1, 2, 3, 4]) {
    const edit = editor(seed);
    let a = start();
    for (let i = 0; i < 500; i++) {
      const b = edit(a);
      assert.deepEqual(applyDiff(a, diff(a, b)), b, `seed ${seed}, ${i}번째`);
      a = b;
    }
  }
});

test('묶음 안의 모든 체크포인트를 되살릴 수 있고, 오래된 것을 정리해도 남은 것은 같다', () => {
  const edit = editor(7);
  let state = start();
  let pack = null;
  const history = [];
  for (let i = 0; i < 250; i++) {
    state = edit(state);
    pack = appendCheckpoint(pack, cp(i, state), state, Infinity);
    history.push(state);
  }
  history.forEach((s, i) => assert.deepEqual(stateAt(pack, 'cp' + i), s, `cp${i}`));

  const kept = prune(pack, MAX_CHECKPOINTS);
  assert.equal(checkpointsOf(kept).length, MAX_CHECKPOINTS);
  for (let i = 250 - MAX_CHECKPOINTS; i < 250; i++) assert.deepEqual(stateAt(kept, 'cp' + i), history[i], `정리 뒤 cp${i}`);
  assert.equal(stateAt(kept, 'cp0'), null);
});

test('체크포인트를 붙일 때 100개를 넘으면 오래된 것부터 기준 상태에 합친다', () => {
  const edit = editor(9);
  let state = start();
  let pack = null;
  for (let i = 0; i < 130; i++) {
    state = edit(state);
    pack = appendCheckpoint(pack, cp(i, state), state);
  }
  const ids = checkpointsOf(pack).map((c) => c.id);
  assert.equal(ids.length, 100);
  assert.equal(ids[0], 'cp30');
  assert.deepEqual(stateAt(pack, 'cp129'), state);
});

test('묶음이 쓰는 아이콘은 정리된 체크포인트 것까지 빠짐없이 모은다', () => {
  let state = { shortcuts: [{ id: 'a', name: 'a', url: 'https://a', addedAt: 1, icon: 'i1' }], settings: {} };
  let pack = appendCheckpoint(null, cp(0, state), state);
  state = { ...state, shortcuts: [...state.shortcuts, { id: 'b', name: 'b', url: 'https://b', addedAt: 2, icon: 'i2' }] };
  pack = appendCheckpoint(pack, cp(1, state), state);
  state = { ...state, shortcuts: state.shortcuts.slice(1) };
  pack = appendCheckpoint(pack, cp(2, state), state);
  assert.deepEqual([...iconsUsed(pack)].sort(), ['i1', 'i2']);
});

test('바로가기 300개, 체크포인트 100개도 압축하면 계정 한도(100KB)의 한참 아래다', async () => {
  const edit = editor(11);
  let state = start();
  for (let i = 0; i < 300; i++) state.shortcuts.push({ id: 'base' + i, name: '바로가기 ' + i, url: `https://www.site-${i}.example.com/path`, addedAt: 1700000000000 + i });
  let pack = null;
  for (let i = 0; i < 100; i++) {
    state = edit(state);
    pack = appendCheckpoint(pack, cp(i, state), state);
  }
  const bytes = (await encode(pack)).length;
  assert.ok(bytes < 30000, `${bytes} 바이트`);
});
