// 타일 '활성' 표시(떠오름·이름·배지)가 늘 함께 켜지고 꺼지는지, 편집 칩과 편집 모드가 약속대로 동작하는지
// headless Chrome에서 확인하는 시험. 마우스로 ⋮를 눌러 편집 창을 열고 닫은 뒤 이름만 남던 버그(1.1.0)를 다시 잡는다.
// 먼저 저장소 맨 위에서 `python tests/dev/make_preview.py`와 `python -m http.server <포트>`를 띄워 둔다.
// 실행: node tests/dev/tile-active.mjs   (미리보기 포트가 8765가 아니면 PREVIEW_PORT=<포트>)

import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9334;
const PREVIEW = process.env.PREVIEW_PORT ?? '8765';
const URL_ = `http://127.0.0.1:${PREVIEW}/tests/dev/preview.html?bg=lake`;
const NEW_ID = 's19'; // chrome-shim.js가 방금 추가한 것으로 넣는 바로가기(배지가 붙음)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1440,900',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'tile-active-'))}`, 'about:blank',
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
async function click(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}
const move = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
async function key(k, code, keyCode) {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: keyCode });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: keyCode });
}
const rectOf = (sel) => js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; })()`);
const setRoot = (attrs) => js(`(() => { const r = document.documentElement; Object.assign(r.dataset, ${JSON.stringify(attrs)}); })()`);

// 타일 하나의 활성 표시 상태를 읽는다. 전환(.15s)이 끝난 뒤에 부른다.
function readTile(id) {
  return js(`(() => {
    const t = document.querySelector('.tile[data-id="${id}"]');
    const cs = (el) => getComputedStyle(el);
    const lift = cs(t.querySelector('.ic')).transform;
    const b = t.querySelector('.badge');
    const chip = t.querySelector('.more');
    return {
      lift: lift !== 'none',
      label: Number(cs(t.querySelector('.lb')).opacity) > 0.5,
      chip: Number(cs(chip).opacity) > 0.5,
      badgeLift: b ? cs(b).transform === lift : null,
      chipFocused: document.activeElement === chip,
      ring: !!t.querySelector(':focus-visible'),
    };
  })()`);
}
// 불변식: 떠오름·이름은 함께 켜지거나 함께 꺼진다. 배지는 아이콘과 같은 거리만큼 움직인다.
// 편집 칩은 표시가 아니라 마우스용 단추라 마우스를 올렸을 때(또는 편집 모드)만 보이고, 초점을 받지 않는다.
function assertConsistent(s, active, chip) {
  assert.deepEqual({ lift: s.lift, label: s.label, chip: s.chip }, { lift: active, label: active, chip },
    `표시가 엇갈림: ${JSON.stringify(s)}`);
  if (s.badgeLift !== null) assert.equal(s.badgeLift, true, '배지가 아이콘과 따로 움직임');
  assert.equal(s.chipFocused, false, '편집 칩이 초점을 가져감');
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
  // 이름 숨김 + 호버 시 이름 표시 모드(버그가 보이던 모드)
  await setRoot({ showLabel: 'false', hoverLabel: 'true' });
  await sleep(300);

  await step('새 바로가기의 배지는 링크 안에 있고, 뜻을 툴팁과 접근성 이름으로 알린다', async () => {
    const info = await js(`(() => { const b = document.querySelector('.tile[data-id="${NEW_ID}"] .badge');
      return b && { inLink: !!b.closest('.link'), title: b.title, hidden: b.getAttribute('aria-hidden'),
        aria: b.closest('.link')?.getAttribute('aria-label'), pe: getComputedStyle(b).pointerEvents }; })()`);
    assert.ok(info, '배지가 없음');
    assert.equal(info.inLink, true);
    assert.match(info.title, /24/);
    assert.equal(info.hidden, 'true');
    assert.match(info.aria, /24/);
    assert.notEqual(info.pe, 'none');
  });

  await step('편집 칩은 크기·이름 표시·카드 모드마다 아이콘 오른쪽 아래 모서리에 붙고 배지와 겹치지 않는다', async () => {
    await move(5, 5);
    const leg = await js('document.documentElement.dataset.legibility ?? ""');
    const bad = [];
    for (const size of ['sm', 'md', 'lg']) for (const showLabel of ['true', 'false']) for (const legibility of [leg, 'card']) {
      await setRoot({ size, showLabel, legibility });
      await sleep(250);
      const g = await js(`(() => { const t = document.querySelector('.tile[data-id="${NEW_ID}"]');
        const I = t.querySelector('.ic').getBoundingClientRect(), C = t.querySelector('.more').getBoundingClientRect(),
          B = t.querySelector('.badge').getBoundingClientRect();
        const ov = Math.max(0, Math.min(B.right, C.right) - Math.max(B.left, C.left)) * Math.max(0, Math.min(B.bottom, C.bottom) - Math.max(B.top, C.top));
        return { dx: C.left - (I.right - 17), dy: C.top - (I.bottom - 17), ov }; })()`);
      if (Math.abs(g.dx) > 1.5 || Math.abs(g.dy) > 1.5 || g.ov > 0) bad.push({ size, showLabel, legibility, ...g });
    }
    await setRoot({ size: 'md', showLabel: 'false', legibility: leg });
    await sleep(250);
    assert.deepEqual(bad, [], `칩 자리가 어긋남: ${JSON.stringify(bad)}`);
  });

  await step('아무것도 안 할 때는 활성 표시와 칩이 모두 꺼져 있다', async () => {
    await move(5, 5);
    await sleep(300);
    assertConsistent(await readTile(NEW_ID), false, false);
  });

  await step('마우스를 타일에 올리면 떠오름·이름·배지·칩이 함께 켜진다', async () => {
    const r = await rectOf(`.tile[data-id="${NEW_ID}"] .ic`);
    await move(r.cx, r.cy);
    await sleep(300);
    assertConsistent(await readTile(NEW_ID), true, true);
  });

  await step('마우스를 칩 위로 옮겨도 아이콘이 내려앉지 않는다', async () => {
    const r = await rectOf(`.tile[data-id="${NEW_ID}"] .more`);
    await move(r.cx, r.cy);
    await sleep(300);
    assertConsistent(await readTile(NEW_ID), true, true);
  });

  await step('마우스로 칩을 눌러 편집 창을 열고 취소로 닫은 뒤 밖으로 나가면 모두 꺼지고, 칩은 초점을 갖지 않는다', async () => {
    const m = await rectOf(`.tile[data-id="${NEW_ID}"] .more`);
    await click(m.cx, m.cy);
    await sleep(200);
    assert.equal(await js(`document.getElementById('edit').open`), true);
    const c = await rectOf('#edit [data-close]');
    await click(c.cx, c.cy);
    await sleep(200);
    assert.equal(await js(`document.getElementById('edit').open`), false);
    await move(5, 5);
    await sleep(300);
    assertConsistent(await readTile(NEW_ID), false, false);
  });

  await step('그 상태에서 키를 눌러도 어중간한 상태가 생기지 않는다', async () => {
    await key('Shift', 'ShiftLeft', 16);
    await sleep(300);
    const s = await readTile(NEW_ID);
    assertConsistent(s, s.ring, false);
  });

  await step('Tab은 타일마다 한 번만 멈춘다: 링크에서는 떠오름·이름·링이 켜지고 칩은 건너뛴다', async () => {
    await js(`document.querySelector('.tile[data-id="s18"] .link').focus()`);
    await key('Tab', 'Tab', 9);
    await sleep(300);
    assert.equal(await js(`document.activeElement === document.querySelector('.tile[data-id="${NEW_ID}"] .link')`), true);
    const s = await readTile(NEW_ID);
    assert.equal(s.ring, true);
    assertConsistent(s, true, false);
    await key('Tab', 'Tab', 9);
    await sleep(300);
    assert.equal(await js(`document.activeElement === document.querySelector('.tile.add .link')`), true, '칩에 Tab이 멈춤');
  });

  await step('편집 모드: 모든 타일에 칩이 뜨고, 타일을 누르면 사이트 대신 편집 창이 열리며, Esc로 끝난다', async () => {
    await js('document.activeElement?.blur()');
    await move(5, 5);
    const b = await rectOf('#edit-mode-btn');
    await click(b.cx, b.cy);
    await sleep(300);
    assert.equal(await js(`document.getElementById('edit-mode-btn').getAttribute('aria-pressed')`), 'true');
    await move(5, 5);
    await sleep(300);
    assert.equal(await js(`[...document.querySelectorAll('.tile[data-id] .more')].every((m) => Number(getComputedStyle(m).opacity) > 0.5)`), true);
    const href = await js('location.href');
    const ic = await rectOf('.tile[data-id="s0"] .ic');
    await click(ic.cx, ic.cy);
    await sleep(200);
    assert.equal(await js(`document.getElementById('edit').open`), true);
    assert.equal(await js('location.href'), href);
    await key('Escape', 'Escape', 27);
    await sleep(200);
    assert.equal(await js(`document.getElementById('edit').open`), false);
    assert.equal(await js(`document.documentElement.hasAttribute('data-editing')`), true, '대화상자를 닫는 Esc가 편집 모드까지 끝내면 안 됨');
    await key('Escape', 'Escape', 27);
    await sleep(200);
    assert.equal(await js(`document.documentElement.hasAttribute('data-editing')`), false);
    assert.equal(await js(`document.getElementById('edit-mode-btn').getAttribute('aria-pressed')`), 'false');
  });
} finally {
  for (const [mark, name, msg] of results) console.log(`${mark} ${name}${msg ? `\n    ${msg}` : ''}`);
  const failed = results.filter((r) => r[0] === '✖').length;
  console.log(`\n${results.length - failed}/${results.length} 통과`);
  ws?.close();
  chrome.kill();
  process.exitCode = failed ? 1 : 0;
}
