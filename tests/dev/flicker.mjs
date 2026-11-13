// 설정을 바꾸는 순간 화면이 번쩍이는지, 프레임 단위로 잰다.
// 바꾸기 직전부터 직후까지 매 프레임(requestAnimationFrame)마다 다음을 기록한다.
//   - 화면에 보이는 바로가기 아이콘 그림 수 (다 그려진 img만 셈)
//   - 배경 캔버스 가운데 한 점의 색
//   - 바로가기 칸이 그대로인지 (지웠다 새로 만들면 아이콘과 유리 효과가 다시 그려지며 번쩍인다)
// 아이콘 수가 한 번이라도 줄거나 칸이 새로 만들어지면 실패, 배경이 한 프레임에 MAX_JUMP보다 크게 바뀌면 실패다.
// 배경은 바뀌더라도 FADE_MS 동안 섞이며 바뀌어야 한다.
//
// 먼저 저장소 맨 위에서 `python tests/dev/make_preview.py`와 `python -m http.server 8765`를 띄워 둔다.
// 실행: node tests/dev/flicker.mjs

import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9339;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_JUMP = 24;

const chrome = spawn(CHROME, [
  '--headless=new', '--hide-scrollbars', `--remote-debugging-port=${PORT}`, '--window-size=1440,900',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'fl-'))}`, 'about:blank',
], { stdio: 'ignore' });

let ws;
let seq = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve) => {
    pending.set(++seq, resolve);
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
const js = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r?.result?.value;
};

// 페이지 안에서: 바꾸기 전 200ms, 바꾼 뒤 800ms 동안 매 프레임 기록
const RECORD = (action) => `new Promise((done) => {
  const frames = [];
  const icons = () => [...document.querySelectorAll('#grid .tile .ic img')].filter((i) => i.complete && i.naturalWidth > 0 && i.isConnected).length;
  const c = document.querySelector('#bg canvas.main');
  const fade = document.querySelector('#bg canvas.fade');
  const read = (cv) => { const g = document.createElement('canvas'); g.width = g.height = 1; g.getContext('2d').drawImage(cv, cv.width / 2, cv.height * 0.8, 1, 1, 0, 0, 1, 1); return [...g.getContext('2d').getImageData(0, 0, 1, 1).data.slice(0, 3)]; };
  // 화면에 실제로 보이는 색: 섞는 중이면 위에 덮인 이전 그림과 지금 그림을 덮개의 현재 불투명도로 섞는다
  const px = () => {
    try {
      const m = read(c);
      if (fade.hidden) return m;
      const op = Number(getComputedStyle(fade).opacity);
      const f = read(fade);
      return m.map((v, k) => Math.round(op * f[k] + (1 - op) * v));
    } catch { return null; }
  };
  const first = document.querySelector('#grid .tile');
  const t0 = performance.now();
  let acted = false;
  const tick = () => {
    const t = performance.now() - t0;
    frames.push({ t: Math.round(t), icons: icons(), px: px(), same: first.isConnected });
    if (!acted && t > 200) { acted = true; (${action})(); }
    if (t < 1000) requestAnimationFrame(tick); else done(frames);
  };
  requestAnimationFrame(tick);
})`;

function summarize(name, frames) {
  const before = frames.filter((f) => f.t < 200);
  const after = frames.filter((f) => f.t >= 200);
  const base = Math.max(...before.map((f) => f.icons));
  const minIcons = Math.min(...after.map((f) => f.icons));
  const dropFrames = after.filter((f) => f.icons < base).length;
  const pxs = frames.map((f) => f.px).filter(Boolean);
  const jumps = pxs.slice(1).map((p, i) => Math.max(...p.map((v, k) => Math.abs(v - pxs[i][k]))));
  const replaced = frames.some((f) => !f.same);
  const maxJump = Math.max(0, ...jumps);
  const total = pxs.length ? Math.max(...pxs.at(-1).map((v, k) => Math.abs(v - pxs[0][k]))) : 0;
  const ok = dropFrames === 0 && !replaced && maxJump <= MAX_JUMP;
  console.log(`${ok ? '✔' : '✖'} ${name}: 아이콘 줄어든 프레임 ${dropFrames}/${after.length}, 바로가기 칸 새로 만듦 ${replaced ? '예' : '아니오'}, 배경 전체 변화 ${total}/255 중 한 프레임 최대 ${maxJump}/255`);
  return { ok };
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
    if (pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  };
  await new Promise((r) => (ws.onopen = r));
  await send('Page.navigate', { url: 'http://127.0.0.1:8765/tests/dev/preview.html?bg=none&theme=dark' });
  for (let i = 0; i < 60 && !(await js(`document.querySelectorAll('#grid .tile .ic img').length`).catch(() => 0)); i++) await sleep(100);
  await sleep(1500); // 아이콘 그림이 다 받아질 때까지

  const set = (k, v) => `() => window.__newtab.store.setSettings({ ${k}: ${JSON.stringify(v)} })`;
  const cases = [
    ['판 색 어둡게→밝게', 'theme', 'light'],
    ['판 색 밝게→어둡게', 'theme', 'dark'],
    ['강조색 바꾸기', 'accent', '#df5e97'],
    ['구도 바꾸기', 'bgComposition', 'horizon'],
    ['이름 글씨 처리: 유리 카드', 'legibility', 'card'],
    ['이름 글씨 처리: 배경 막', 'legibility', 'dim'],
    ['흐르기 켜기', 'bgMotion', 'motion'],
    ['흐르기 끄기', 'bgMotion', 'static'],
  ];
  const results = [];
  for (const [name, k, v] of cases) {
    results.push(summarize(name, await js(RECORD(set(k, v)))));
    await sleep(600);
  }
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
} finally {
  ws?.close();
  chrome.kill();
}
