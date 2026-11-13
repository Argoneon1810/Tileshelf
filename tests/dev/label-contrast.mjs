// 실제 새 탭 화면(preview.html)에서 바로가기 이름 바로 뒤의 배경을 찍어, 이름 글자와의 대비를 잰다.
// 이름 글자를 투명하게 숨기고 찍은 뒤, 이름이 차지하던 사각형 안의 픽셀만 본다.
// 강조색 × 판 2개 × 구도 4개 × 씨앗 2개 × 시각 2개(정지, 흐르는 중 9초)를 모두 돈다.
//
// 먼저 저장소 맨 위에서 `python tests/dev/make_preview.py`와 `python -m http.server 8765`를 띄워 둔다.
// 실행: node tests/dev/label-contrast.mjs <출력폴더> [--leg shadow,dim,card] [--bg none,lake,ribbon] [--mode dark,light] [--quick]
//   사진 배경은 이름이 늘 흰 글자라 판 톤과 상관없어 어둡게 판 한 번만 잰다
//   --leg  이름 글씨 처리 방법들 (기본 dim)     --bg  배경 (none = 그라데이션, lake·ribbon = 시험용 사진)
//   --quick 미리 고른 색만, 씨앗 1개, 정지 화면만
//   → python tests/dev/gradient_stats.py <출력폴더> 로 잰다 (index.json의 rects가 있으면 그 안만 잰다).

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACCENT_PRESETS } from '../../src/ts/gradient.ts';

const OUT = process.argv[2] ?? join(tmpdir(), 'label-contrast');
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1].split(',') : def;
};
const QUICK = process.argv.includes('--quick');
const LEGS = arg('--leg', ['dim']);
const BGS = arg('--bg', ['none']);
const MODES = arg('--mode', ['dark', 'light']);
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9338;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PRESETS = ACCENT_PRESETS.map(([, n, hex]) => [hex.slice(1), n, true]);
const COLORS = QUICK ? PRESETS : [...PRESETS, ['ffff00', '원색 노랑', false], ['00ff00', '원색 초록', false], ['000000', '검정', false]];
const COMPS = ['aurora', 'horizon', 'bloom', 'currents'];
const SEEDS = QUICK ? [1] : [1, 2];
const TIMES = QUICK ? [0] : [0, 9];

mkdirSync(OUT, { recursive: true });
const chrome = spawn(CHROME, [
  '--headless=new', '--hide-scrollbars', `--remote-debugging-port=${PORT}`, '--window-size=1440,900',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'lc-'))}`, 'about:blank',
], { stdio: 'ignore' });

let ws;
let seq = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve) => {
    pending.set(++seq, resolve);
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
const js = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))?.result?.value;

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
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const index = [];
  const runs = [];
  for (const bg of BGS) for (const leg of LEGS) for (const [hex, name, preset] of bg === 'none' ? COLORS : [COLORS[0]]) for (const mode of bg === 'none' ? MODES : ['dark']) {
    for (const comp of bg === 'none' ? COMPS : [COMPS[0]]) for (const seed of bg === 'none' ? SEEDS : [1]) for (const t of bg === 'none' ? TIMES : [0]) {
      runs.push({ bg, leg, hex, name: bg === 'none' ? name : '사진 ' + bg, preset, mode, comp, seed, t });
    }
  }
  for (const { bg, leg, hex, name, preset, mode, comp, seed, t } of runs) {
    {
      {
        {
          {
            const url = `http://127.0.0.1:8765/tests/dev/preview.html?bg=${bg}&leg=${leg}&accent=${hex}&theme=${mode}&comp=${comp}&seed=${seed}&t=${t}`;
            await send('Page.navigate', { url });
            for (let i = 0; i < 60 && !(await js(`document.querySelectorAll('.tile[data-id]').length`)); i++) await sleep(50);
            await sleep(1500); // 미리보기는 300ms 뒤에 시각 t로 멈춘다. 배경 전환(.45s)이 끝난 뒤에 찍어야 값이 흔들리지 않는다
            const info = await js(`(() => {
              // 숨기기 전에 이름의 실제 글자색을 읽는다 (사진 위는 흰색, 그라데이션·카드 위는 판 글자색)
              const rgb = getComputedStyle(document.querySelector('.tile .lb')).color.match(/[0-9]+/g).slice(0, 3);
              const text = '#' + rgb.map((v) => Number(v).toString(16).padStart(2, '0')).join('');
              const s = document.createElement('style');
              // 글자만 투명하게 한다. 그림자는 남겨서 그림자가 깔아 주는 어두움까지 '이름 뒤 배경'으로 잰다
              s.textContent = '.tile .lb { color: transparent !important; }';
              document.head.append(s);
              const rects = [...document.querySelectorAll('.tile .lb')].map((el) => {
                const r = document.createRange(); r.selectNodeContents(el);
                const b = r.getBoundingClientRect(), e = el.getBoundingClientRect();
                const pad = parseFloat(getComputedStyle(el).paddingLeft);
                return [Math.max(b.left, e.left + pad), b.top, Math.min(b.right, e.right - pad), b.bottom].map(Math.round);
              });
              return { rects, text };
            })()`);
            await sleep(50);
            const shot = await send('Page.captureScreenshot', { format: 'png' });
            const file = `${bg}-${leg}-${hex}-${mode}-${comp}-${seed}-${t}.png`;
            writeFileSync(join(OUT, file), Buffer.from(shot.data, 'base64'));
            index.push({ file, hex, name: `[${leg}] ${name} ${comp} ${seed} t${t}`, mode, preset, rects: info.rects, text: info.text });
          }
        }
      }
    }
  }
  writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 1));
  console.log(`${index.length}장 → ${OUT}`);
} finally {
  ws?.close();
  chrome.kill();
}
