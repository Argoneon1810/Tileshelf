// 아이콘 배경·여백 정리 대화상자를 headless Chrome에서 열어, 자동 아이콘(바깥 서버 그림)의 픽셀을 읽으려다
// CORS 오류를 내거나 다른 그림으로 바꾸는 일이 없는지 확인하는 시험(1.2.1에서 고친 버그).
// 먼저 저장소 맨 위에서 `python tests/dev/make_preview.py`와 `python -m http.server <포트>`를 띄워 둔다.
// 실행: node tests/dev/icon-inspector.mjs   (미리보기 포트가 8765가 아니면 PREVIEW_PORT=<포트>)

import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9338;
const PREVIEW = process.env.PREVIEW_PORT ?? '8765';
// customicon=1: 첫 바로가기(s0)만 직접 고른 아이콘, 나머지 19개는 자동 아이콘
const URL_ = `http://127.0.0.1:${PREVIEW}/tests/dev/preview.html?bg=none&customicon=1`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1440,900',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'icon-insp-'))}`, 'about:blank',
], { stdio: 'ignore' });

let ws;
let seq = 0;
const pending = new Map();
const corsLogs = [];
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
      return;
    }
    // 확장 오류 목록에 쌓이던 것과 같은 CORS 오류
    if (msg.method === 'Log.entryAdded' && /CORS|Access-Control-Allow-Origin/i.test(msg.params.entry.text)) {
      corsLogs.push(msg.params.entry.text);
    }
    // Chrome이 CORS로 막은 요청
    if (msg.method === 'Network.loadingFailed' && msg.params.corsErrorStatus) {
      corsLogs.push(`loadingFailed ${msg.params.corsErrorStatus.corsError}`);
    }
  };
  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
  // 페이지가 그림을 읽기 허가 방식(crossOrigin)으로 부르는 순간을 모두 기록한다. 네트워크 결과와 무관하게 잡힌다.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'crossOrigin');
    Object.defineProperty(HTMLImageElement.prototype, 'crossOrigin', { configurable: true, get: d.get,
      set(v) { (window.__corsImgs ??= []).push(this); d.set.call(this, v); } });
  })()` });
  await send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 50 && !(await js(`document.querySelectorAll('.tile[data-id]').length`).catch(() => 0)); i++) await sleep(100);

  await js(`document.getElementById('open-icon-inspector').click()`);
  // 예전 코드는 아이콘을 하나씩 네트워크로 받아 늦으므로 넉넉히(30초) 기다린다.
  for (let i = 0; i < 300 && (await js(`document.querySelectorAll('#insp-list .insp-card').length`)) < 20; i++) await sleep(100);
  await sleep(1000);

  await step('정리 대화상자가 바로가기 20개를 모두 보여 준다', async () => {
    assert.equal(await js(`document.querySelectorAll('#insp-list .insp-card').length`), 20);
  });

  await step('자동 아이콘 19개는 고를 수 없고, 직접 이미지를 지정하라는 안내를 보여 준다', async () => {
    const rows = await js(`[...document.querySelectorAll('#insp-list .insp-card')].map((c) => ({
      id: c.dataset.id, disabled: c.querySelector('input[type=checkbox]').disabled,
      hint: !!c.querySelector('.insp-hint'), chips: c.querySelectorAll('.insp-chip').length }))`);
    const auto = rows.filter((r) => r.id !== 's0');
    assert.equal(auto.length, 19);
    assert.deepEqual(auto.filter((r) => !r.disabled || !r.hint || r.chips), [], '자동 아이콘 줄이 고를 수 있게 되어 있음');
    const custom = rows.find((r) => r.id === 's0');
    assert.deepEqual({ disabled: custom.disabled, hint: custom.hint, chips: custom.chips }, { disabled: false, hint: false, chips: 3 });
  });

  await step('자동 아이콘 줄은 새 탭과 같은 주소의 아이콘을 그리기만 한다(다른 후보로 바뀌지 않음)', async () => {
    const pair = await js(`(() => {
      const card = document.querySelector('#insp-list .insp-card[data-id="s1"] .insp-preview-box img');
      const tile = document.querySelector('.tile[data-id="s1"] .ic img');
      return [card?.getAttribute('src'), tile?.getAttribute('src'), card?.crossOrigin ?? null];
    })()`);
    assert.ok(pair[0], '자동 아이콘 미리보기가 없음');
    assert.equal(pair[0], pair[1]);
    assert.ok(!pair[2], '미리보기가 읽기 허가 방식으로 불러옴');
  });

  await step('모두 선택은 직접 고른 아이콘 1개만 고른다', async () => {
    await js(`document.getElementById('insp-select-all').click()`);
    await sleep(100);
    assert.deepEqual(await js(`[...document.querySelectorAll('#insp-list .insp-card[data-checked="true"]')].map((c) => c.dataset.id)`), ['s0']);
  });

  await step('정리 대화상자를 열어도 바깥 그림을 읽기 허가 방식으로 부르지 않고, CORS 오류가 0건이다', async () => {
    const corsImgs = await js(`(window.__corsImgs ?? []).map((i) => i.src).filter((s) => /^https?:/.test(s))`);
    assert.deepEqual(corsImgs.slice(0, 3), [], `읽기 허가 방식으로 부른 바깥 그림 ${corsImgs.length}개`);
    assert.deepEqual(corsLogs.slice(0, 3), [], `CORS 오류 ${corsLogs.length}건`);
  });
} finally {
  for (const [mark, name, msg] of results) console.log(`${mark} ${name}${msg ? `\n    ${msg}` : ''}`);
  const failed = results.filter((r) => r[0] === '✖').length;
  console.log(`\n${results.length - failed}/${results.length} 통과`);
  ws?.close();
  chrome.kill();
  process.exitCode = failed ? 1 : 0;
}
