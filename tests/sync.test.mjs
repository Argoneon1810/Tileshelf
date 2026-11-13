// 실행: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

import { encode, decode, splitChunks, joinChunks, staleChunks, checkQuota } from '../src/ts/syncdoc.ts';
import { Store } from '../src/ts/store.ts';
import { Sync, LEGACY_ROOT } from '../src/ts/sync.ts';
import { newAccount, newDevice, tick } from './fake-chrome.mjs';

const FAST = { pushDelay: 5, pullDelay: 5 };

async function boot(storage) {
  const store = new Store(storage.local);
  await store.load();
  const sync = new Sync(store, storage, FAST);
  await sync.start();
  return { store, sync, storage };
}

// 계정에 쓰는 횟수를 센다
function countWrites(account) {
  const writes = [];
  const set = account.set.bind(account);
  const remove = account.remove.bind(account);
  account.set = async (obj) => {
    writes.push('set ' + Object.keys(obj).join(','));
    return set(obj);
  };
  account.remove = async (keys) => {
    writes.push('remove ' + [].concat(keys).join(','));
    return remove(keys);
  };
  return writes;
}

function fakeIcon(seed) {
  // 실제 아이콘 데이터처럼 압축이 잘 안 되는 문자열
  let s = 'data:image/webp;base64,';
  let x = seed >>> 0;
  for (let i = 0; i < 2400; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    s += 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'[x >>> 26];
  }
  return s;
}

const names = (d) => d.store.shortcuts.map((s) => s.name);

// 0.7에서 쓰던 기기를 흉내 낸다: 바로가기와 '맞춘 적 있음'(lastRev)이 local에 있다
async function legacyDevice(account, shortcuts, updatedAt) {
  const dev = newDevice(account);
  await dev.local.set({ shortcuts, syncState: { lastRev: 'old', dirty: false, updatedAt } });
  return dev;
}

test('압축·조각낸 값을 다시 합치면 그대로 돌아오고, 다른 판의 조각이 섞이면 합치지 않는다', async () => {
  const value = { list: Array.from({ length: 3000 }, (_, i) => 'item ' + i) };
  const enc = await encode(value);
  const a = splitChunks(enc, 'p:A:', 'r1');
  assert.ok(a.n > 1);
  assert.equal(checkQuota(a.items), null);
  assert.deepEqual(await decode(joinChunks(a.items, 'p:A:', 'r1', a.n)), value);
  const b = splitChunks(enc, 'p:A:', 'r2');
  assert.equal(joinChunks({ ...a.items, 'p:A:1': b.items['p:A:1'] }, 'p:A:', 'r1', a.n), null);
  assert.deepEqual(staleChunks({ 'p:A:0': 1, 'p:A:1': 1, 'p:A:2': 1, 'p:B:5': 1 }, 'p:A:', 1).sort(), ['p:A:1', 'p:A:2']);
});

test('한 기기에서 바꾸면 다른 기기에 나타나고, 반대 방향도 된다', async () => {
  const account = newAccount();
  const A = await boot(newDevice(account));
  await A.store.addShortcut({ name: 'Claude', url: 'https://claude.ai' });
  await A.store.addShortcut({ name: '네이버', url: 'https://naver.com' });
  await tick(60);
  const B = await boot(newDevice(account));
  assert.deepEqual(names(B), ['Claude', '네이버']);

  await B.store.reorder([...B.store.shortcuts].reverse().map((s) => s.id));
  await tick(80);
  assert.deepEqual(names(A), ['네이버', 'Claude']);
  assert.equal(A.sync.status.state, 'ok');
});

test('새로 설치한 기기는 계정이 비어 있으면 아무것도 쓰지 않고 기다린다', async () => {
  const account = newAccount();
  const writes = countWrites(account);
  const A = await boot(newDevice(account));
  await A.store.setSettings({ theme: 'light' }); // 처음 실행 안내에서 고른 것
  await tick(60);
  assert.deepEqual(writes, []);
  assert.equal(A.sync.status.state, 'empty');
});

test('새로 설치한 기기가 먼저 켜지고 계정 기록이 늦게 와도, 빈 상태로 덮지 않고 그 기록을 받는다', async () => {
  // PC 1에서 실제로 있었던 일: 새로 설치한 확장이 계정 데이터를 받기 전에 0개짜리 판을 올렸다
  const account = newAccount();
  const fresh = await boot(newDevice(account));
  await fresh.store.setSettings({ theme: 'light' });
  await tick(30);

  const old = await boot(await legacyDevice(account, [{ id: 'g', name: 'GitHub', url: 'https://github.com', addedAt: 1 }], 1000));
  await tick(80);
  assert.deepEqual(names(old), ['GitHub']);
  assert.deepEqual(names(fresh), ['GitHub']);
  assert.equal(fresh.store.syncState.root, LEGACY_ROOT);
});

test('새 기기가 계정 기록을 받기 전에 따로 바로가기를 더했으면, 다른 기기는 그것을 저절로 따르지 않고 알리기만 한다', async () => {
  const account = newAccount();
  const old = await boot(await legacyDevice(account, [{ id: 'g', name: 'GitHub', url: 'https://github.com', addedAt: 1 }], 1000));
  const foreign = [];
  old.sync.addEventListener('foreign', (e) => foreign.push(e.detail.cp));

  // 새 기기는 원래 계정 기록이 도착하기 전의 상태(빈 계정 사본)에서 시작한다
  const lonely = newAccount();
  const fresh = await boot(newDevice(lonely));
  await fresh.store.addShortcut({ name: '새 기기에서 추가', url: 'https://new.example' });
  await tick(40);
  // 양쪽 기록이 서로에게 도착한다
  await lonely.set(await account.get(null));
  await account.set(await lonely.get(null));
  await tick(120);

  assert.deepEqual(names(old), ['GitHub'], '기존 기기는 다른 계보를 따르지 않는다');
  assert.equal(foreign.length, 1);
  assert.equal(foreign[0].count, 1);
  // 사용자가 기록에서 고르면 그 계보에 들어간다
  assert.ok(await old.sync.restore(foreign[0].id));
  assert.deepEqual(names(old), ['새 기기에서 추가']);
});

test('계정 기록이 지워지면(확장 삭제) 맞춘 적 있는 기기가 다시 채우고, 다시 설치한 기기가 그것을 받는다', async () => {
  const account = newAccount();
  const A = await boot(newDevice(account));
  await A.store.addShortcut({ name: 'x', url: 'https://x.com' });
  await tick(40);
  const B = await boot(newDevice(account));
  assert.deepEqual(names(B), ['x']);

  // A를 삭제: Chrome이 계정 데이터를 지운다. 다시 설치한 A는 빈 상태로 켜진다.
  await account.remove(Object.keys(await account.get(null)));
  const A2 = await boot(newDevice(account));
  await tick(150);
  assert.deepEqual(names(B), ['x'], 'B는 빈 계정을 빈 상태로 받아들이지 않는다');
  assert.deepEqual(names(A2), ['x'], '다시 설치한 A는 B가 다시 채운 기록을 받는다');
});

test('받기만 한 기기도, 따르던 체크포인트가 계정에서 지워지면 지금 상태를 자기 기록으로 다시 남긴다', async () => {
  const account = newAccount();
  const A = await boot(newDevice(account));
  await A.store.addShortcut({ name: 'x', url: 'https://x.com' });
  await tick(40);
  const B = await boot(newDevice(account));
  assert.equal(B.sync.pack, null, 'B는 아직 자기 체크포인트가 없다');
  await account.remove(Object.keys(await account.get(null)).filter((k) => k.includes(A.sync.device)));
  await tick(80);
  assert.ok(B.sync.pack, 'B가 자기 묶음을 만들었다');
  assert.deepEqual(names(B), ['x']);
});

test('동시에 바꾸면 늦게 바꾼 쪽을 따르고, 진 쪽은 기록에서 되돌릴 수 있다', async () => {
  const account = newAccount();
  const A = await boot(newDevice(account));
  await A.store.addShortcut({ name: '공통', url: 'https://common.com' });
  await tick(40);
  const B = await boot(newDevice(account));

  // 둘 다 동기화를 끈 채 B가 먼저, A가 나중에 바꾼다
  await B.store.setSettings({ syncEnabled: false });
  await A.store.setSettings({ syncEnabled: false });
  await B.store.addShortcut({ name: 'B에서 추가', url: 'https://b.com' });
  await tick(10);
  await A.store.addShortcut({ name: 'A에서 추가', url: 'https://a.com' });
  await tick(30);

  let applied = null;
  B.sync.addEventListener('applied', (e) => (applied = e.detail));
  await A.store.setSettings({ syncEnabled: true });
  await A.sync.reconcile();
  await B.store.setSettings({ syncEnabled: true });
  await B.sync.reconcile();
  await tick(60);

  assert.deepEqual(names(B), ['공통', 'A에서 추가']);
  assert.equal(applied.overwroteLocal, true);
  assert.ok(await B.sync.restore(applied.mine));
  await tick(80);
  assert.deepEqual(names(B), ['공통', 'B에서 추가']);
  assert.deepEqual(names(A), ['공통', 'B에서 추가'], '되돌린 것도 새 체크포인트라 A가 따른다');
});

test('체크포인트는 기기마다 100개까지 계정에 남고, 기록 목록으로 어느 것이든 되돌릴 수 있다', async () => {
  const account = newAccount();
  const A = await boot(newDevice(account));
  for (let i = 0; i < 120; i++) {
    await A.store.addShortcut({ name: 'n' + i, url: `https://n${i}.com` });
    await A.sync.push();
  }
  const B = await boot(newDevice(account));
  const list = B.sync.history();
  assert.equal(list.length, 100);
  assert.equal(list[0].current, true);
  assert.equal(list[0].cp.count, 120);
  assert.equal(list[99].cp.count, 21);
  assert.ok(await B.sync.restore(list[99].cp.id));
  assert.equal(B.store.shortcuts.length, 21);
});

test("올리기만 한 기기는 '맞춰짐'이 아니고, 다른 기기가 받아 가면 '맞춰짐'이 된다", async () => {
  const account = newAccount();
  const A = await boot(newDevice(account));
  await A.store.addShortcut({ name: 'x', url: 'https://x.com' });
  await tick(40);
  assert.equal(A.sync.status.state, 'ok');
  assert.equal(A.sync.status.received, false);

  const B = await boot(newDevice(account));
  assert.equal(B.sync.status.received, true);
  await tick(80);
  assert.equal(A.sync.status.received, true, 'B가 A의 체크포인트를 따른다고 머리글에 적었다');
});

test('주고받기가 끝나면 계정 쓰기가 더 일어나지 않는다 (서로 맞받아 쓰는 고리 없음)', async () => {
  const account = newAccount();
  const writes = countWrites(account);
  const A = await boot(newDevice(account));
  await boot(newDevice(account));
  const C = await boot(newDevice(account));
  await A.store.addShortcut({ name: 'x', url: 'https://x.com' });
  await tick(200);
  const settled = writes.length;
  await tick(300);
  assert.equal(writes.length, settled, '더 쓴 것: ' + writes.slice(settled).join(' | '));
  assert.deepEqual(names(C), ['x']);
  assert.equal(A.sync.status.received, true);
});

test('계정 저장이 실패하면 성공이라고 하지 않고, 다음에 다시 올린다', async () => {
  const account = newAccount();
  const A = await boot(newDevice(account));
  const set = account.set.bind(account);
  account.set = async () => {
    throw new Error('MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded');
  };
  await A.store.addShortcut({ name: 'x', url: 'https://x.com' });
  await A.sync.push();
  assert.equal(A.sync.status.state, 'error');
  assert.match(A.sync.status.message, /quota/i);

  account.set = set;
  await A.sync.reconcile();
  assert.equal(A.sync.status.state, 'ok');
  const B = await boot(newDevice(account));
  assert.deepEqual(names(B), ['x']);
});

test('배경 사진과 이 기기 전용 설정은 다른 기기로 가지 않는다', async () => {
  const account = newAccount();
  const A = await boot(newDevice(account));
  await A.store.addShortcut({ name: 'x', url: 'https://x.com' });
  await tick(40);
  const B = await boot(newDevice(account));
  await A.store.setBgImage('data:image/jpeg;base64,' + 'A'.repeat(500000));
  await A.store.setSettings({ dim: 0.4, bgType: 'image' });
  await tick(80);
  assert.equal(B.store.settings.dim, 0.4);
  assert.equal(B.store.bgImage, null);

  await B.store.setSettings({ syncEnabled: false });
  await tick(80);
  assert.equal(A.store.settings.syncEnabled, true);
});

test('직접 고른 아이콘은 계정에 한 번만 올라가 다른 기기로 가고, 넘치면 아이콘만 빼며 받는 쪽 아이콘을 지우지 않는다', async () => {
  const account = newAccount();
  const A = await boot(newDevice(account));
  await A.store.addShortcut({ name: 'i0', url: 'https://i0.com', iconData: fakeIcon(1) });
  await tick(40);
  const B = await boot(newDevice(account));
  assert.equal(Object.values(B.store.icons)[0], fakeIcon(1));

  for (let i = 1; i < 60; i++) await A.store.addShortcut({ name: 'i' + i, url: `https://i${i}.com`, iconData: fakeIcon(i + 1) });
  await A.sync.push();
  await tick(120);
  assert.equal(A.sync.status.state, 'ok');
  assert.equal(A.sync.status.iconsOmitted, true);
  assert.equal(B.store.shortcuts.length, 60);

  // B가 바꾼 것을 A가 받아도 A의 아이콘은 남는다
  await B.store.updateShortcut(B.store.shortcuts[0].id, { name: '바뀐 이름' });
  await tick(120);
  assert.equal(A.store.shortcuts[0].name, '바뀐 이름');
  assert.equal(Object.keys(A.store.icons).length, 60);
});

test('0.7에서 옮겨 온 두 기기는 같은 계보가 되어 더 늦게 바꾼 쪽을 따르고, 옛 계정 키를 지운다', async () => {
  const account = newAccount();
  await account.set({ meta: { rev: 'r', n: 1 }, c0: 'r:xxxx', 'ack:zz': { rev: 'r' } });
  // PC 1처럼 더 늦게 바꾼 쪽이 0개인 경우
  const P1 = await boot(await legacyDevice(account, [], 2000));
  const P2 = await boot(await legacyDevice(account, [{ id: 'a', name: '백업에서', url: 'https://a.com', addedAt: 1 }], 1000));
  await tick(80);
  assert.equal(P1.store.syncState.root, LEGACY_ROOT);
  assert.equal(P2.store.syncState.root, LEGACY_ROOT);
  assert.deepEqual(names(P2), []);
  // P2의 이전 상태는 기록에 남아 있어 되돌릴 수 있다
  const p2before = P2.sync.history().find((h) => h.mine && h.cp.count === 1);
  assert.ok(p2before);
  assert.ok(await P2.sync.restore(p2before.cp.id));
  await tick(80);
  assert.deepEqual(names(P1), ['백업에서']);
  const keys = Object.keys(await account.get(null));
  assert.ok(!keys.some((k) => /^(meta|c\d+|ack:)/.test(k)), keys.join(','));
});

test('동기화를 꺼 둔 동안에도 바꾼 기록이 이 기기에 남아 되돌릴 수 있다', async () => {
  const account = newAccount();
  const writes = countWrites(account);
  const A = await boot(newDevice(account));
  await A.store.addShortcut({ name: 'x', url: 'https://x.com' });
  await tick(40);
  await A.store.setSettings({ syncEnabled: false });
  await tick(40);
  const before = writes.length;
  await A.store.addShortcut({ name: 'y', url: 'https://y.com' });
  await tick(40);
  assert.equal(writes.length, before, '꺼져 있으면 계정에 쓰지 않는다');
  const first = A.sync.history().find((h) => h.cp.count === 1);
  assert.ok(await A.sync.restore(first.cp.id));
  assert.deepEqual(names(A), ['x']);
});

test('바꾼 뒤 pushDelay 안에 예전 기록으로 되돌려도 직전 변경이 체크포인트로 남아 다시 복구할 수 있다', async () => {
  const account = newAccount();
  const storage = newDevice(account);
  const store = new Store(storage.local);
  await store.load();
  const sync = new Sync(store, storage, { pushDelay: 5000, pullDelay: 10 });
  await sync.start();

  await store.addShortcut({ name: '처음', url: 'https://first.example' });
  await sync.push();
  const firstCpId = sync.history()[0].cp.id;

  // 같은 밀리초 안에 변경과 되돌리기가 연달아 일어나도 시간 순서가 뒤집히지 않아야 한다
  for (let round = 0; round < 10; round++) {
    await store.addShortcut({ name: '연속' + round, url: `https://r${round}.example` });
    assert.ok(await sync.restore(firstCpId));
    assert.deepEqual(store.shortcuts.map((s) => s.name), ['처음']);
  }
  await store.addShortcut({ name: '직전 추가', url: 'https://just-added.example' });
  assert.equal(store.syncState.dirty, true);
  assert.ok(await sync.restore(firstCpId));
  assert.deepEqual(store.shortcuts.map((s) => s.name), ['처음']);

  // 덮어써지기 직전의 2개짜리 상태가 체크포인트로 보존되어 다시 돌아갈 수 있어야 한다
  const savedPending = sync.history().find((h) => h.cp.count === 2);
  assert.ok(savedPending, '되돌리기 직전의 미저장 변경이 기록에 남아야 한다');
  assert.ok(await sync.restore(savedPending.cp.id));
  assert.deepEqual(store.shortcuts.map((s) => s.name), ['처음', '직전 추가']);
});
