// 미리보기 페이지(tests/dev/preview.html)를 headless Chrome에 띄워 실제로 눌러 보는 시험.
// 먼저 저장소 맨 위에서 `python tests/dev/make_preview.py`와 `python -m http.server 8765`를 띄워 둔다.
// 실행: node tests/dev/e2e.mjs

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
// 8765를 다른 프로그램이 쓰고 있으면 PREVIEW_PORT=<포트>로 미리보기 서버 포트를 바꾼다.
const PREVIEW = process.env.PREVIEW_PORT ?? '8765';
const URL_ = `http://127.0.0.1:${PREVIEW}/tests/dev/preview.html?bg=lake`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1440,900',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'e2e-'))}`, 'about:blank',
], { stdio: 'ignore' });

let ws;
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
const names = () => js(`chrome.storage.local.get('shortcuts').then(d => d.shortcuts.map(s => s.name))`);
async function mouse(type, x, y) {
  await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
}
async function center(sel) {
  return js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + 30]; })()`);
}

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(['✔', name]);
  } catch (e) {
    results.push(['✖', name, e.message]);
  }
}

try {
  let targets;
  for (let i = 0; i < 50; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      if (targets.some((t) => t.type === 'page')) break;
    } catch {}
    await sleep(200);
  }
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    }
  };
  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 50 && !(await js(`document.querySelectorAll('.tile[data-id]').length`).catch(() => 0)); i++) await sleep(100);

  await step('처음에 바로가기 20개와 추가 칸이 보인다', async () => {
    assert.equal(await js(`document.querySelectorAll('.tile[data-id]').length`), 20);
    assert.equal(await js(`!!document.querySelector('.tile.add')`), true);
  });

  await step('끌어서 순서를 바꾸면 저장되고, 사이트가 열리지 않는다', async () => {
    const [x0, y0] = await center('.tile[data-id="s0"]');
    const [x2, y2] = await center('.tile[data-id="s2"]');
    await mouse('mousePressed', x0, y0);
    for (let i = 1; i <= 12; i++) await mouse('mouseMoved', x0 + ((x2 - x0) * i) / 12, y0 + ((y2 - y0) * i) / 12);
    await sleep(250);
    await mouse('mouseReleased', x2, y2);
    await sleep(300);
    assert.deepEqual((await names()).slice(0, 3), ['YouTube', '네이버', 'Gmail']);
    assert.match(await js('location.href'), /preview\.html/);
    assert.equal(await js(`document.querySelectorAll('.drag-ghost, .placeholder').length`), 0);
  });

  await step('추가 칸으로 바로가기를 더한다 (이름은 주소에서 따옴)', async () => {
    await js(`document.querySelector('.tile.add .link').click()`);
    await sleep(100);
    assert.equal(await js(`document.getElementById('edit').open`), true);
    await js(`(() => { const u = document.getElementById('edit-url'); u.value = 'www.example.com/page'; u.dispatchEvent(new Event('input')); document.querySelector('#edit form').requestSubmit(); })()`);
    await sleep(200);
    const n = await names();
    assert.equal(n.length, 21);
    assert.equal(n.at(-1), 'example.com');
    assert.equal(await js(`document.getElementById('edit').open`), false);
  });

  await step('잘못된 주소는 저장하지 않고 이유를 보여 준다', async () => {
    await js(`document.querySelector('.tile.add .link').click()`);
    await js(`(() => { document.getElementById('edit-url').value = '   '; document.querySelector('#edit form').requestSubmit(); })()`);
    await sleep(100);
    assert.match(await js(`document.getElementById('edit-error').textContent`), /주소/);
    assert.equal((await names()).length, 21);
    await js(`document.getElementById('edit').close()`);
  });

  await step('삭제한 뒤 알림의 되돌리기로 같은 자리에 돌아온다', async () => {
    await js(`document.querySelector('.tile[data-id="s3"] .more').click()`);
    await sleep(100);
    await js(`document.getElementById('edit-delete').click()`);
    await sleep(200);
    assert.ok(!(await names()).includes('Claude'));
    await js(`[...document.querySelectorAll('.toast .btn')].find(b => b.textContent === '되돌리기').click()`);
    await sleep(200);
    const n = await names();
    assert.equal(n[3], 'Claude');
  });

  await step('검색창에 쓰면 격자가 숨고 결과 판에 묶음별 칩이 순서대로 보인다', async () => {
    assert.equal(await js(`document.getElementById('grid').hidden`), false);
    assert.equal(await js(`document.getElementById('results').hidden`), true);

    await js(`(() => { const q = document.getElementById('q'); q.value = 'github.com'; q.dispatchEvent(new Event('input')); })()`);
    assert.equal(await js(`document.getElementById('grid').hidden`), true);
    assert.equal(await js(`document.getElementById('results').hidden`), false);
    assert.deepEqual(
      await js(`[...document.querySelectorAll('#results .result-group')].map(g => g.dataset.kind)`),
      ['shortcuts', 'url', 'web'],
    );
    assert.deepEqual(
      await js(`[...document.querySelectorAll('#results .result-title')].map(h => h.textContent)`),
      ['바로가기 1개', '주소로 이동', '웹 검색'],
    );

    // 주소가 아니면 주소 묶음은 숨고, 맞는 바로가기가 없어도 바로가기 묶음은 안내 문구와 함께 남는다
    await js(`(() => { const q = document.getElementById('q'); q.value = '고양이'; q.dispatchEvent(new Event('input')); })()`);
    assert.deepEqual(
      await js(`[...document.querySelectorAll('#results .result-group')].map(g => g.dataset.kind)`),
      ['shortcuts', 'web'],
    );
    assert.equal(await js(`document.querySelector('#results .result-empty')?.textContent`), '맞는 바로가기가 없습니다');
  });

  await step('Enter 한 번은 첫 칩으로 초점을 옮기고, 두 번이면 그 칩을 실행하며 방향키·Esc로 오간다', async () => {
    // 지금 입력은 '고양이'(바로가기 0개)이므로 Enter 한 번이면 웹 검색 칩으로 초점이 간다
    await js(`document.getElementById('q').focus()`);
    // 한글 조합 확정 중(keyCode 229) Enter는 초점을 검색창에 그대로 남겨야 한다
    await js(`document.getElementById('q').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true }))`);
    assert.equal(await js(`document.activeElement?.id`), 'q');
    await js(`document.getElementById('q').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    assert.deepEqual(await js(`window.__searched ?? []`), []);
    assert.equal(await js(`document.activeElement?.dataset?.kind`), 'web');

    // 두 번째 Enter로 웹 검색 실행
    await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    assert.deepEqual(await js(`window.__searched`), ['고양이']);

    // 여러 바로가기가 걸러질 때 방향키 이동(←/→ 묶음 안, ↓/↑ 묶음 사이, 맨 위에서 ↑는 입력칸)
    await js(`(() => { const q = document.getElementById('q'); q.value = 'o'; q.dispatchEvent(new Event('input')); q.focus(); })()`);
    await js(`document.getElementById('q').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`);
    const firstLabel = await js(`document.activeElement?.querySelector('.chip-lb')?.textContent`);
    assert.ok(firstLabel);
    await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
    const secondLabel = await js(`document.activeElement?.querySelector('.chip-lb')?.textContent`);
    assert.notEqual(secondLabel, firstLabel);
    await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))`);
    assert.equal(await js(`document.activeElement?.querySelector('.chip-lb')?.textContent`), firstLabel);
    await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`);
    assert.equal(await js(`document.activeElement?.dataset?.kind`), 'web');
    await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))`);
    assert.equal(await js(`document.activeElement?.dataset?.kind`), 'shortcut');
    await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))`);
    assert.equal(await js(`document.activeElement?.id`), 'q');

    // 칩에서 글자를 치면 입력칸에 이어서 써지고, Esc로 입력칸 복귀 후 다시 Esc로 입력을 지운다
    await js(`document.getElementById('q').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    assert.equal(await js(`document.activeElement?.classList?.contains('chip')`), true);
    await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }))`);
    assert.equal(await js(`document.activeElement?.id`), 'q');
    assert.equal(await js(`document.getElementById('q').value`), 'ok');
    await js(`document.getElementById('q').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    assert.equal(await js(`document.activeElement?.id`), 'q');
    assert.equal(await js(`document.getElementById('q').value`), 'ok');
    await js(`document.getElementById('q').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    assert.equal(await js(`document.getElementById('q').value`), '');
    assert.equal(await js(`document.getElementById('results').hidden`), true);
    assert.equal(await js(`document.getElementById('grid').hidden`), false);
  });

  await step('설정에서 검색 결과 순서를 바꾸면 묶음 순서와 Enter 두 번의 동작이 바뀐다', async () => {
    await js(`document.getElementById('settings-btn').click()`);
    await sleep(50);
    await js(`document.querySelector('#settings [data-goto="display"]').click()`);
    await sleep(50);
    // 위·아래 버튼은 없고 손잡이만 있다
    assert.equal(await js(`document.querySelectorAll('#search-order button[data-dir]').length`), 0);
    assert.equal(await js(`document.querySelectorAll('#search-order .drag-handle').length`), 3);

    // 손잡이에 초점을 두고 방향키 위로 두 번 옮기면 웹 검색이 맨 위로 오고, 초점은 같은 손잡이에 남는다
    await js(`document.querySelector('#search-order li[data-kind="web"] .drag-handle').focus()`);
    await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))`);
    await sleep(50);
    assert.equal(await js(`document.activeElement === document.querySelector('#search-order li[data-kind="web"] .drag-handle')`), true);
    await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))`);
    await sleep(100);
    assert.equal(await js(`document.activeElement === document.querySelector('#search-order li[data-kind="web"] .drag-handle')`), true);
    assert.deepEqual(
      await js(`chrome.storage.local.get('settings').then(d => d.settings.searchOrder)`),
      ['web', 'shortcuts', 'url'],
    );
    await js(`document.getElementById('settings').close()`);

    await js(`(() => { const q = document.getElementById('q'); q.value = 'git'; q.dispatchEvent(new Event('input')); q.focus(); })()`);
    assert.deepEqual(
      await js(`[...document.querySelectorAll('#results .result-group')].map(g => g.dataset.kind)`),
      ['web', 'shortcuts'],
    );
    await js(`document.getElementById('q').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    assert.equal(await js(`document.activeElement?.dataset?.kind`), 'web');
    await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    assert.deepEqual(await js(`window.__searched`), ['고양이', 'git']);

    // 손잡이를 마우스로 끌어서 한 칸 내리고, 방향키 아래로 한 칸 더 내려 원래대로 되돌린다
    await js(`document.getElementById('settings-btn').click()`);
    await sleep(50);
    await js(`document.querySelector('#settings [data-goto="display"]').click()`);
    await sleep(50);
    const [hx0, hy0] = await js(`(() => { const r = document.querySelector('#search-order li[data-kind="web"] .drag-handle').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    const [hx1, hy1] = await js(`(() => { const r = document.querySelector('#search-order li[data-kind="shortcuts"]').getBoundingClientRect(); return [r.left + 20, r.bottom - 2]; })()`);
    await mouse('mousePressed', hx0, hy0);
    for (let i = 1; i <= 6; i++) await mouse('mouseMoved', hx0 + ((hx1 - hx0) * i) / 6, hy0 + ((hy1 - hy0) * i) / 6);
    await mouse('mouseReleased', hx1, hy1);
    await sleep(80);
    assert.deepEqual(
      await js(`chrome.storage.local.get('settings').then(d => d.settings.searchOrder)`),
      ['shortcuts', 'web', 'url'],
    );
    assert.equal(await js(`document.activeElement === document.querySelector('#search-order li[data-kind="web"] .drag-handle')`), true);
    await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`);
    await sleep(100);
    assert.equal(await js(`document.activeElement === document.querySelector('#search-order li[data-kind="web"] .drag-handle')`), true);
    assert.deepEqual(
      await js(`chrome.storage.local.get('settings').then(d => d.settings.searchOrder)`),
      ['shortcuts', 'url', 'web'],
    );
    await js(`document.getElementById('settings').close()`);
    await js(`(() => { const q = document.getElementById('q'); q.value = ''; q.dispatchEvent(new Event('input')); })()`);
    assert.equal(await js(`document.getElementById('grid').hidden`), false);
  });

  await step('백업 파일을 불러와 바꾸고, 되돌릴 수 있다', async () => {
    const before = await names();
    await js(`(() => {
      const data = JSON.stringify({ app: 'shortcuts-newtab', version: 1, v: 1, shortcuts: [{ id: 'a1', name: 'A', url: 'https://a.com' }, { id: 'b1', name: 'B', url: 'https://b.com' }], settings: { theme: 'dark' }, icons: {} });
      const dt = new DataTransfer();
      dt.items.add(new File([data], 'shortcuts-backup.json', { type: 'application/json' }));
      const input = document.getElementById('backup-file');
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));
    })()`);
    await sleep(200);
    assert.equal(await js(`document.getElementById('import').open`), true);
    assert.match(await js(`document.getElementById('import-summary').textContent`), /바로가기 2개/);
    await js(`document.getElementById('import-replace').click()`);
    await sleep(200);
    assert.deepEqual(await names(), ['A', 'B']);
    await js(`[...document.querySelectorAll('.toast .btn')].find(b => b.textContent === '되돌리기').click()`);
    await sleep(200);
    assert.deepEqual(await names(), before);
  });

  await step('이 확장의 백업이 아닌 파일은 이유와 함께 거절한다', async () => {
    await js(`(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['[{"name":"A","url":"https://a.com"}]'], 'other.json', { type: 'application/json' }));
      const input = document.getElementById('backup-file');
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));
    })()`);
    await sleep(200);
    assert.equal(await js(`document.getElementById('import').open`), false);
    assert.match(await js(`[...document.querySelectorAll('.toast')].map(t => t.textContent).join()`), /백업 파일이 아닙니다/);
  });

  await step('설정 서랍 2단계 구조: 첫 화면 요약, 하위 화면 이동·초점·Esc·기록 여닫기·재열기', async () => {
    await js(`document.getElementById('settings-btn').click()`);
    await sleep(80);
    assert.equal(await js(`document.getElementById('settings').open`), true);
    assert.equal(await js(`document.getElementById('settings-home').hidden`), false);
    assert.equal(await js(`document.getElementById('settings-sub').hidden`), true);
    assert.deepEqual(
      await js(`[...document.querySelectorAll('#settings [data-goto]')].map(b => b.dataset.goto)`),
      ['background', 'legibility', 'display', 'sync', 'history', 'backup'],
    );
    assert.equal(await js(`document.querySelector('#settings [data-drill-sum="background"]').textContent`), '내 사진');
    assert.equal(await js(`document.querySelector('#settings [data-drill-sum="legibility"]').textContent`), '배경 막 57%');
    assert.equal(await js(`document.querySelector('#settings [data-drill-sum="display"]').textContent`), '어둡게 · 보통 · 1순위 바로가기');
    assert.equal(await js(`document.getElementById('intro-again').checkVisibility()`), true);
    assert.equal(await js(`document.getElementById('version').checkVisibility()`), true);

    // 항목을 누르면 하위 화면으로 들어가고 뒤로 가기 버튼에 초점이 온다
    await js(`document.querySelector('#settings [data-goto="legibility"]').click()`);
    await sleep(50);
    assert.equal(await js(`document.getElementById('settings-home').hidden`), true);
    assert.equal(await js(`document.getElementById('settings-sub').hidden`), false);
    assert.equal(await js(`document.getElementById('drill-title').textContent`), '이름 가독성');
    assert.equal(await js(`document.activeElement?.id`), 'drill-back');

    // 하위 화면에서 Esc는 첫 화면으로 돌아가고 방금 누른 항목에 초점을 둔다
    await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await sleep(50);
    assert.equal(await js(`document.getElementById('settings').open`), true);
    assert.equal(await js(`document.getElementById('settings-home').hidden`), false);
    assert.equal(await js(`document.getElementById('settings-sub').hidden`), true);
    assert.equal(await js(`document.activeElement?.dataset?.goto`), 'legibility');

    // 기록 하위 화면: 처음엔 목록이 닫혀 있고 눌러야 열리며, 다시 들어오면 닫혀 있다
    await js(`document.querySelector('#settings [data-goto="history"]').click()`);
    await sleep(50);
    assert.equal(await js(`document.getElementById('history-panel').hidden`), true);
    assert.match(await js(`document.getElementById('history-toggle-label').textContent`), /기록 목록 열기/);
    await js(`document.getElementById('history-toggle').click()`);
    await sleep(50);
    assert.equal(await js(`document.getElementById('history-panel').hidden`), false);
    await js(`document.getElementById('drill-back').click()`);
    await sleep(50);
    assert.equal(await js(`document.activeElement?.dataset?.goto`), 'history');
    await js(`document.querySelector('#settings [data-goto="history"]').click()`);
    await sleep(50);
    assert.equal(await js(`document.getElementById('history-panel').hidden`), true);

    // 하위 화면에서 서랍을 닫았다가 다시 열면 항상 첫 화면이고, 첫 화면에서 Esc는 서랍을 닫는다
    await js(`document.querySelector('#settings-sub [data-close]').click()`);
    await sleep(50);
    assert.equal(await js(`document.getElementById('settings').open`), false);
    await js(`document.getElementById('settings-btn').click()`);
    await sleep(50);
    assert.equal(await js(`document.getElementById('settings').open`), true);
    assert.equal(await js(`document.getElementById('settings-home').hidden`), false);
    assert.equal(await js(`document.getElementById('settings-sub').hidden`), true);
    await js(`document.getElementById('settings').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await sleep(50);
    assert.equal(await js(`document.getElementById('settings').open`), false);
  });

  await step('설정에서 판 색을 밝게 바꾸면 바로 적용된다', async () => {
    await js(`document.getElementById('settings-btn').click()`);
    await sleep(50);
    await js(`document.querySelector('#settings [data-goto="display"]').click()`);
    await sleep(50);
    await js(`document.querySelector('.seg[data-setting="theme"] button[data-v="light"]').click()`);
    await sleep(100);
    assert.equal(await js(`document.documentElement.dataset.theme`), 'light');
    assert.equal(await js(`document.querySelector('.seg[data-setting="theme"] button[data-v="light"]').getAttribute('aria-pressed')`), 'true');
    assert.match(await js(`document.querySelector('#settings [data-drill-sum="display"]').textContent`), /^밝게 ·/);
  });

  await step('어둡게 막대를 옮기면 배경 덮개가 바뀌고 저장된다', async () => {
    await js(`document.getElementById('drill-back').click()`);
    await js(`document.querySelector('#settings [data-goto="legibility"]').click()`);
    await sleep(50);
    await js(`(() => { const r = document.getElementById('set-dim'); r.value = 50; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); })()`);
    await sleep(100);
    assert.equal(await js(`getComputedStyle(document.documentElement).getPropertyValue('--dim').trim()`), '0.5');
    assert.equal(await js(`chrome.storage.local.get('settings').then(d => d.settings.dim)`), 0.5);
    await js(`document.getElementById('drill-back').click()`);
    await sleep(50);
  });

  await step('서랍을 닫으면 미끄러져 나가고, 그동안 보던 화면이 바뀌지 않으며, 다시 열면 첫 화면이다', async () => {
    await js(`document.querySelector('#settings [data-goto="legibility"]').click()`);
    await sleep(50);
    const state = () => js(`(() => { const d = document.getElementById('settings'), c = getComputedStyle(d); return { display: c.display, opacity: Number(c.opacity), x: new DOMMatrix(c.transform).m41, open: d.open, sub: !document.querySelector('#settings [data-drill-page="legibility"]').hidden }; })()`);
    const full = await state();
    assert.equal(full.opacity, 1);
    await js(`document.getElementById('settings').close()`);
    await sleep(60);
    const mid = await state();
    assert.equal(mid.open, false);
    assert.notEqual(mid.display, 'none', '닫는 도중에는 아직 보여야 한다');
    assert.ok(mid.opacity > 0 && mid.opacity < 1, `닫는 도중 투명도 ${mid.opacity}`);
    assert.ok(mid.x > 0, `닫는 도중 이동 ${mid.x}`);
    assert.equal(mid.sub, true, '닫는 동안 첫 화면으로 바뀌면 안 된다');
    await sleep(300);
    assert.equal((await state()).display, 'none');
    await js(`document.getElementById('settings-btn').click()`);
    await sleep(350);
    const again = await state();
    assert.equal(again.sub, false, '다시 열면 첫 화면');
    assert.equal(again.opacity, 1);
    assert.equal(again.x, 0);
  });

  await step('가독성 효과를 바꾸면 농도 막대와 설명이 곧바로 따라온다 (이전 효과를 따라가지 않는다)', async () => {
    await js(`document.querySelector('#settings [data-goto="legibility"]').click()`);
    await sleep(50);
    const pick = async (value) => {
      await js(`(() => { const s = document.getElementById('set-legibility'); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change')); })()`);
      await sleep(100);
      return js(`[document.getElementById('dim-row').hidden, document.documentElement.dataset.legibility, document.getElementById('legibility-note').textContent]`);
    };
    const notes = await js(`Object.fromEntries(['dim', 'shadow', 'card'].map((v) => [v, '']))`);
    for (const value of ['dim', 'shadow', 'dim', 'card', 'shadow', 'dim']) {
      const [hidden, method, note] = await pick(value);
      assert.equal(method, value);
      assert.equal(hidden, method !== 'dim', `${value}: 막대 숨김 ${hidden}`);
      if (notes[method] !== undefined && notes[method] !== '') assert.equal(note, notes[method], `${value}: 설명`);
      if (notes[method] === '') notes[method] = note;
    }
    assert.notEqual(notes.dim, notes.card, '효과마다 설명이 달라야 한다');
    assert.equal(await js(`[...document.getElementById('set-legibility').options].some((o) => o.value === 'calm' || o.value === 'auto')`), false, '중앙 음영과 자동은 고를 수 없다');
    await js(`__newtab.store.setSettings({ legibility: 'calm', dim: 0.24 })`);
    await sleep(100);
    assert.deepEqual(
      await js(`[__newtab.store.settings.legibility, __newtab.store.settings.dim, document.documentElement.dataset.legibility, document.querySelector('#bg .calm-shade').classList.contains('on')]`),
      ['dim', 0.57, 'dim', false],
      '직접 고르지 않은 옛 설정은 새 기본값으로 옮겨진다',
    );
    await js(`document.getElementById('drill-back').click()`);
    await sleep(50);
  });

  await step('설정 서랍의 닫기 버튼이 제목과 겹치지 않는다', async () => {
    const overlap = await js(`(() => {
      const a = document.querySelector('#settings header h2').getBoundingClientRect();
      const b = document.querySelector('#settings header [data-close]').getBoundingClientRect();
      return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    })()`);
    assert.equal(overlap, false);
  });

  // 그림자가 상자에 잘리는 곳이 없는지, 화면 상태마다 계산으로 확인한다
  await js(readFileSync(new URL('./shadow-clip.js', import.meta.url), 'utf8'));
  const noClips = async () => assert.deepEqual(await js('window.__shadowClips()'), []);
  const noDrawerOverflow = async () => {
    const overflows = await js(`(() => {
      const sheet = document.querySelector('#settings .sheet');
      const limit = sheet.getBoundingClientRect().right + 0.5;
      const bad = [];
      for (const el of sheet.querySelectorAll('*')) {
        if (!el.checkVisibility()) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.right > limit) {
          bad.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className ? '.' + String(el.className).trim().replace(/\\s+/g, '.') : '') + ' (' + Math.round(r.right) + ' > ' + Math.round(limit) + ')');
        }
      }
      return bad;
    })()`);
    assert.deepEqual(overflows, []);
  };
  const closeAll = () => js(`document.querySelectorAll('dialog[open]').forEach(d => d.close())`);

  await step('설정 서랍이 화면 높이를 꽉 채운다', async () => {
    assert.equal(await js(`Math.round(document.querySelector('#settings .sheet').getBoundingClientRect().height) === innerHeight`), true);
  });
  await step('그림자 잘림 없음: 설정 서랍 (맨 위와 맨 아래)', async () => {
    await noClips();
    await js(`document.querySelector('#settings .sheet').scrollTop = 1e6`);
    await sleep(50);
    await noClips();
  });
  await step('어두운·밝은 테마의 첫 화면과 하위 화면 6개에서 서랍 오른쪽 경계를 넘는 보이는 요소가 없다', async () => {
    const pages = ['background', 'legibility', 'display', 'sync', 'history', 'backup'];
    for (const theme of ['light', 'dark']) {
      await js(`window.__newtab.store.setSettings({ theme: ${JSON.stringify(theme)} })`);
      await sleep(50);
      await noDrawerOverflow();
      await noClips();
      for (const p of pages) {
        await js(`document.querySelector('#settings [data-goto="${p}"]').click()`);
        await sleep(30);
        await noDrawerOverflow();
        await noClips();
        if (p === 'history') {
          await js(`document.getElementById('history-toggle').click()`);
          await sleep(30);
          await noDrawerOverflow();
          await noClips();
        }
        await js(`document.getElementById('drill-back').click()`);
        await sleep(30);
      }
    }
  });
  await closeAll();
  await step('그림자 잘림 없음: 기본 화면 (어두운 판)', async () => {
    await js(`window.__newtab.store.setSettings({ theme: 'dark' })`);
    await sleep(100);
    await noClips();
  });
  await step('그림자 잘림 없음: 검색 결과 판', async () => {
    await js(`(() => { const q = document.getElementById('q'); q.value = 'github.com'; q.dispatchEvent(new Event('input')); })()`);
    await sleep(50);
    await noClips();
    await js(`(() => { const q = document.getElementById('q'); q.value = ''; q.dispatchEvent(new Event('input')); })()`);
  });
  await step('그림자 잘림 없음: 편집 창', async () => {
    await js(`document.querySelector('.tile[data-id="s3"] .more').click()`);
    await sleep(100);
    await noClips();
  });
  await closeAll();
  await step('그림자 잘림 없음: 불러오기 확인 창과 알림', async () => {
    await js(`document.getElementById('import-summary').textContent = '바로가기 7개, 모양 설정, 배경 사진을(를) 불러옵니다.'`);
    await js(`document.getElementById('import').showModal()`);
    await js(`import('/dist/js/ui/toast.js').then(m => m.toast('알림 그림자 확인', { kind: 'success' }))`);
    await sleep(100);
    await noClips();
  });
  await closeAll();
  // ---- 그라데이션 배경 (사진이 없는 새 설치 상태) ----
  await send('Page.navigate', { url: URL_.replace('bg=lake', 'bg=none') });
  for (let i = 0; i < 50 && !(await js(`document.querySelectorAll('.tile[data-id]').length`).catch(() => 0)); i++) await sleep(100);
  await js(readFileSync(new URL('./shadow-clip.js', import.meta.url), 'utf8'));
  const accentNow = () => js(`chrome.storage.local.get('settings').then(d => d.settings.accent)`);

  const bgPixels = () => js(`document.querySelector('#bg canvas').toDataURL()`);
  const settingNow = (k) => js(`chrome.storage.local.get('settings').then(d => d.settings.${k})`);

  await step('사진이 없으면 기본 배경은 캔버스에 그린 그라데이션이다', async () => {
    assert.equal(await js(`document.documentElement.dataset.bg`), 'gradient');
    assert.equal(await js(`document.querySelector('#bg canvas').hidden`), false);
    assert.ok((await js(`document.querySelector('#bg canvas').width`)) > 100);
  });

  await step('다음 새 탭을 위해 지난 배경을 작은 그림으로 남긴다 (깜빡임 방지)', async () => {
    const boot = JSON.parse(await js(`localStorage.getItem('bootBg')`));
    assert.equal(boot.bg, 'gradient');
    assert.match(boot.url, /^data:image\/jpeg/);
  });

  await step('강조색 단추를 누르면 그라데이션이 바뀌고 저장된다', async () => {
    const before = await bgPixels();
    await js(`document.getElementById('settings-btn').click()`);
    await sleep(50);
    await js(`document.querySelector('#settings [data-goto="background"]').click()`);
    await sleep(100);
    await js(`document.querySelector('#accent-swatches button[title="핑크"]').click()`);
    await sleep(150);
    assert.equal(await accentNow(), '#df5e97');
    assert.notEqual(await bgPixels(), before);
    assert.equal(await js(`document.querySelector('#accent-swatches button[title="핑크"]').getAttribute('aria-pressed')`), 'true');
  });

  await step('구도 썸네일 12개가 그려지고, 누르면 그 구도·변형으로 바뀐다', async () => {
    assert.equal(await js(`document.querySelectorAll('#bg-thumbs .thumb-btn').length`), 12);
    const before = await bgPixels();
    const pick = await js(`(() => { const b = document.querySelectorAll('#bg-thumbs .thumb-btn')[7]; b.click(); return [b.dataset.comp, Number(b.dataset.seed)]; })()`);
    await sleep(150);
    assert.deepEqual([await settingNow('bgComposition'), await settingNow('bgSeed')], pick);
    assert.notEqual(await bgPixels(), before);
    assert.equal(await js(`document.querySelectorAll('#bg-thumbs .thumb-btn[aria-pressed="true"]').length`), 1);
  });

  await step("'다른 변형 보기'는 다른 변형을 보여 주되, 고른 것은 그 구도 첫 칸에 남긴다", async () => {
    const seedsBefore = await js(`[...document.querySelectorAll('#bg-thumbs .thumb-btn')].map(b => b.dataset.seed).join()`);
    await js(`document.getElementById('bg-variants').click()`);
    await sleep(100);
    assert.notEqual(await js(`[...document.querySelectorAll('#bg-thumbs .thumb-btn')].map(b => b.dataset.seed).join()`), seedsBefore);
    assert.equal(await js(`document.querySelectorAll('#bg-thumbs .thumb-btn[aria-pressed="true"]').length`), 1);
  });

  await step("'흐르기'를 고르면 배경이 움직인다", async () => {
    await js(`document.querySelector('.seg[data-setting="bgMotion"] button[data-v="motion"]').click()`);
    await sleep(200);
    const a = await bgPixels();
    await sleep(600);
    assert.notEqual(await bgPixels(), a);
    assert.equal(await js(`document.getElementById('motion-note').hidden`), true);
  });

  await step("시스템의 '동작 줄이기'가 켜져 있으면 멈추고 그 이유를 알린다", async () => {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await sleep(300);
    const a = await bgPixels();
    await sleep(500);
    assert.equal(await bgPixels(), a);
    await js(`document.querySelector('.seg[data-setting="bgMotion"] button[data-v="motion"]').click()`);
    await sleep(100);
    assert.equal(await js(`document.getElementById('motion-note').hidden`), false);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await js(`document.querySelector('.seg[data-setting="bgMotion"] button[data-v="static"]').click()`);
    await sleep(100);
  });

  await step('직접 고른 색도 쓰이고, 색상환 단추가 선택 표시된다', async () => {
    await js(`(() => { const i = document.getElementById('set-accent'); i.value = '#123456'; i.dispatchEvent(new Event('change')); })()`);
    await sleep(150);
    assert.equal(await accentNow(), '#123456');
    assert.equal(await js(`document.querySelector('#accent-swatches .swatch.custom').classList.contains('chosen')`), true);
    assert.equal(await js(`document.querySelectorAll('#accent-swatches button[aria-pressed="true"]').length`), 0);
  });

  await step('강조색 단추 10개가 한 줄에 들어간다', async () => {
    const tops = await js(`[...document.querySelectorAll('#accent-swatches .swatch')].map(e => Math.round(e.getBoundingClientRect().top))`);
    assert.equal(tops.length, 10);
    assert.equal(new Set(tops).size, 1);
  });

  await step("'내 사진'을 누르면 고르기 전에 '이 PC에만 저장' 안내가 먼저 뜬다", async () => {
    await js(`document.querySelector('#bg-type button[data-v="image"]').click()`);
    await sleep(150);
    assert.equal(await js(`document.getElementById('photo-notice').open`), true);
    assert.match(await js(`document.querySelector('#photo-notice h2').textContent`), /기기에만/);
    // 아직 사진을 고르지 않았으니 배경 종류는 그대로다
    assert.equal(await js(`chrome.storage.local.get('settings').then(d => d.settings.bgType)`), 'gradient');
  });

  await step('그림자 잘림 없음: 사진 안내 창', noClips);

  await step("안내에서 '다음부터 바로 고르기'를 고르면 이 PC에 기억한다", async () => {
    await js(`document.getElementById('photo-notice-skip').checked = true`);
    await js(`document.getElementById('photo-notice-ok').click()`);
    await sleep(150);
    assert.equal(await js(`document.getElementById('photo-notice').open`), false);
    assert.equal(await js(`chrome.storage.local.get('photoNoticeSkip').then(d => d.photoNoticeSkip)`), true);
  });

  await step('그림자 잘림 없음: 그라데이션 설정 서랍', noClips);
  await closeAll();

  await step('바로가기 줄은 가운데 정렬된다 (덜 찬 마지막 줄 포함)', async () => {
    const gap = await js(`(() => {
      const g = document.getElementById('grid').getBoundingClientRect();
      const tiles = [...document.querySelectorAll('#grid .tile')];
      const lastTop = Math.max(...tiles.map((t) => t.offsetTop));
      const row = tiles.filter((t) => t.offsetTop === lastTop).map((t) => t.getBoundingClientRect());
      return [Math.round(row[0].left - g.left), Math.round(g.right - row.at(-1).right)];
    })()`);
    assert.ok(Math.abs(gap[0] - gap[1]) <= 2, JSON.stringify(gap));
  });

  await step('동기화에 문제가 없으면 설정 단추에 점이 없다', async () => {
    assert.equal(await js(`getComputedStyle(document.querySelector('#settings-btn .status-dot')).display`), 'none');
    assert.equal(await js(`!!document.getElementById('sync-btn')`), false);
  });

  const visible = () => js(`[...document.querySelectorAll('#intro section[data-page]')].filter((x) => !x.hidden).map((x) => x.dataset.page + (x.dataset.bgtype ?? '')).join()`);
  const click = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).click()`);

  await step('처음 실행 안내: 처음 새 탭에서 뜨고, 첫 페이지에서 써 본 적 있는지 묻는다', async () => {
    await send('Page.navigate', { url: URL_.replace('bg=lake', 'bg=none&intro=1') });
    for (let i = 0; i < 50 && !(await js(`document.getElementById('intro')?.open`).catch(() => false)); i++) await sleep(100);
    assert.equal(await js(`document.getElementById('intro').open`), true);
    assert.equal(await visible(), 'welcome');
    // 둘 중 하나를 눌러야 넘어간다
    assert.equal(await js(`document.getElementById('intro-next').hidden`), true);
  });

  await step("'처음이에요' 길: 판 색 → 배경 종류 → 세부 → 이름 글씨, 고르는 대로 바로 저장된다", async () => {
    await click('#intro-path button[data-v="new"]');
    await sleep(100);
    assert.equal(await visible(), 'theme');
    await click('#intro [data-intro-setting="theme"] button[data-v="light"]');
    await sleep(100);
    assert.equal(await settingNow('theme'), 'light');
    assert.equal(await js(`document.documentElement.dataset.theme`), 'light');
    await click('#intro-next');
    await sleep(100);
    assert.equal(await visible(), 'bgtype');
    // 배경 종류를 먼저 고르면 다음 페이지에 그 종류의 세부만 보인다
    await click('#intro-bgtype button[data-v="color"]');
    await sleep(150);
    assert.equal(await settingNow('bgType'), 'color');
    assert.equal(await js(`document.documentElement.dataset.bg`), 'color');
    await click('#intro-next');
    await sleep(100);
    assert.equal(await visible(), 'detailcolor');
    await click('#intro-bgcolor button[title="눈"]');
    await sleep(450); // 이름 글자색은 0.3초 동안 바뀐다
    assert.equal(await settingNow('bgColor'), '#eef6ff');
    // 밝은 단색 위 이름은 어두운 글자가 된다
    assert.equal(await js(`getComputedStyle(document.querySelector('#grid .tile .lb')).color`), 'rgb(29, 34, 41)');
    await click('#intro-prev');
    await click('#intro-bgtype button[data-v="gradient"]');
    await click('#intro-next');
    await sleep(150);
    assert.equal(await visible(), 'detailgradient');
    // 사진을 묻는 버튼은 그라데이션 세부에 없고, 그 자리에 흐르기 스위치가 있다
    assert.equal(await js(`!!document.querySelector('#intro section[data-bgtype="gradient"] #intro-photo')`), false);
    assert.match(await js(`document.getElementById('intro-motion-hint').textContent`), /그래픽 가속|CPU|배터리|동작 줄이기/);
    await js(`(() => { const m = document.getElementById('intro-motion'); m.checked = true; m.dispatchEvent(new Event('change')); })()`);
    await sleep(100);
    assert.equal(await settingNow('bgMotion'), 'motion');
    await click('#intro-next');
    await sleep(100);
    assert.equal(await visible(), 'legibility');
    assert.equal(await js(`document.getElementById('intro-next').textContent`), '시작하기');
    await click('#intro [data-intro-setting="legibility"] button[data-v="card"]');
    await sleep(100);
    assert.equal(await js(`document.documentElement.dataset.legibility`), 'card');
  });

  await step('처음 실행 안내: 이 PC에 사진이 이미 있으면 그 사진이 어디서 왔는지 밝힌다', async () => {
    await js(`chrome.storage.local.set({ bgImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' })`);
    await js(`window.__newtab.store.load()`);
    await click('#intro-prev');
    await click('#intro-prev');
    await click('#intro-bgtype button[data-v="image"]');
    await click('#intro-next');
    await sleep(150);
    assert.equal(await visible(), 'detailimage');
    assert.equal(await js(`document.getElementById('intro-photo-origin').hidden`), false);
    assert.equal(await js(`document.getElementById('intro-photo').textContent`), '다른 사진 선택');
    // 다음 시험을 위해 그라데이션으로 돌려 놓는다
    await click('#intro-prev');
    await click('#intro-bgtype button[data-v="gradient"]');
    await click('#intro-next');
    await click('#intro-next');
    await sleep(100);
    assert.equal(await visible(), 'legibility');
  });

  await step('그림자 잘림 없음: 처음 실행 안내와 유리 카드', async () => {
    await js(readFileSync(new URL('./shadow-clip.js', import.meta.url), 'utf8'));
    await noClips();
  });

  await step("'써 봤어요' 길: 바로 쓰던 설정 가져오기(계정 동기화, 백업 파일)로 간다", async () => {
    for (let i = 0; i < 4; i++) await click('#intro-prev');
    await sleep(100);
    assert.equal(await visible(), 'welcome');
    await click('#intro-path button[data-v="existing"]');
    await sleep(150);
    assert.equal(await visible(), 'existing');
    assert.equal(await js(`document.querySelectorAll('#intro-dots i').length`), 2);
    assert.equal(await js(`document.getElementById('intro-next').textContent`), '시작하기');
    assert.match(await js(`document.getElementById('intro-sync-text').textContent`), /받|동기화|확인/);
    assert.equal(await js(`!!document.getElementById('intro-import')`), true);
  });

  await step('처음 실행 안내를 마치면 이 PC에 기억하고 다시 뜨지 않는다', async () => {
    await click('#intro-next');
    await sleep(150);
    assert.equal(await js(`document.getElementById('intro').open`), false);
    assert.equal(await js(`chrome.storage.local.get('introDone').then(d => d.introDone)`), true);
  });

  await step('설정 서랍에 Tileshelf 판 표시와 법적·백업 안전 고지가 보인다', async () => {
    await js(`document.getElementById('settings-btn').click()`);
    await sleep(80);
    assert.match(await js(`document.getElementById('version').textContent`), /^Tileshelf /);
    assert.match(await js(`document.getElementById('legal-note').textContent`), /GPL-3\.0-or-later.*AS IS.*Google LLC/);
    await js(`document.querySelector('#settings [data-goto="backup"]').click()`);
    await sleep(50);
    assert.match(await js(`document.getElementById('backup-safety-note').textContent`), /암호화되지 않은 일반 텍스트/);
    await closeAll();
  });

  await step('영어 로케일(?lang=en)에서 화면 문구와 서랍 레이아웃이 영어로 올바르게 그려진다', async () => {
    await send('Page.navigate', { url: URL_.replace('bg=lake', 'bg=none&lang=en') });
    for (let i = 0; i < 50 && !(await js(`document.querySelectorAll('.tile[data-id]').length`).catch(() => 0)); i++) await sleep(100);
    await js(readFileSync(new URL('./shadow-clip.js', import.meta.url), 'utf8'));
    assert.equal(await js(`document.documentElement.lang`), 'en');
    assert.equal(await js(`document.title`), 'New Tab');
    assert.equal(await js(`document.getElementById('q').placeholder`), 'Find shortcuts · Search web · Go to URL');
    await js(`document.getElementById('settings-btn').click()`);
    await sleep(80);
    assert.equal(await js(`document.querySelector('#settings header h2').textContent`), 'Settings');
    assert.match(await js(`document.getElementById('legal-note').textContent`), /GPL-3\.0-or-later.*AS IS.*Google LLC/);
    await noDrawerOverflow();
    await noClips();
    await closeAll();
  });

  await step('CPU와 GPU가 같은 그림을 그린다 (채널 차이 2/255 이하)', async () => {
    await send('Page.navigate', { url: `http://127.0.0.1:${PREVIEW}/tests/dev/parity.html` });
    let r;
    for (let i = 0; i < 100 && !(r = await js('window.__parity')); i++) await sleep(100);
    assert.equal(r.webgl, true);
    assert.equal(r.cases.length, 16);
    for (const c of r.cases) assert.ok(c.max <= 2, JSON.stringify(c));
    await send('Page.navigate', { url: URL_.replace('bg=lake', 'bg=none') });
    for (let i = 0; i < 50 && !(await js(`document.querySelectorAll('.tile[data-id]').length`).catch(() => 0)); i++) await sleep(100);
    await js(readFileSync(new URL('./shadow-clip.js', import.meta.url), 'utf8'));
  });

  await step('검사기 자체 점검: 예전 두 버그를 되살리면 둘 다 잡는다', async () => {
    await js(`(() => { const s = document.createElement('style'); s.id = 'regress';
      s.textContent = 'dialog { overflow: auto !important } .tile .lb { padding: 0 !important; margin: 0 !important }';
      document.head.append(s); })()`);
    await js(`document.querySelector('.tile[data-id="s3"] .more').click()`);
    await sleep(100);
    const found = (await js('window.__shadowClips()')).join('\n');
    await js(`document.getElementById('regress').remove()`);
    await closeAll();
    assert.match(found, /form\.sheet ← dialog#edit/);
    assert.match(found, /text-shadow: span\.lb/);
  });
} finally {
  for (const [mark, name, err] of results) console.log(mark, name, err ? '\n   ' + err : '');
  const failed = results.filter((r) => r[0] === '✖').length;
  console.log(`\n${results.length - failed} 통과, ${failed} 실패`);
  ws?.close();
  chrome.kill();
  process.exitCode = failed ? 1 : 0;
}
