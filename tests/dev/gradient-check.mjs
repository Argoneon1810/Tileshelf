// 그라데이션 배경을 실제로 그려서, 화면 어디에 바로가기 이름이 와도 읽히는지 잰다.
// 미리 고른 강조색 9개와 일부러 고른 어려운 색(원색, 흑백, 갈색 …)을, 어둡게·밝게 두 판 × 구도 4개 ×
// 씨앗 2개 × 시각 2개(정지 화면, 흐르는 중 9초)로 모두 그린다.
//
// 먼저 저장소 맨 위에서 `python -m http.server 8765`를 띄워 둔다.
// 실행: node tests/dev/gradient-check.mjs <출력폴더>
//   → 출력폴더에 경우마다 PNG를 남기고, python tests/dev/gradient_stats.py <출력폴더>로 대비를 잰다.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACCENT_PRESETS } from '../../src/ts/gradient.ts';

const OUT = process.argv[2] ?? join(tmpdir(), 'gradient-check');
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9335;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const HARD_CASES = [['ffff00', '원색 노랑'], ['0000ff', '원색 파랑'], ['00ff00', '원색 초록'], ['000000', '검정'], ['8b4513', '갈색']];
const COMPS = ['aurora', 'horizon', 'bloom', 'currents'];
const SEEDS = [1, 2];
const TIMES = [0, 9];
const cases = [...ACCENT_PRESETS.map(([k, n, hex]) => [hex.slice(1), n]), ...HARD_CASES];

mkdirSync(OUT, { recursive: true });
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${PORT}`, '--window-size=1440,900',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'grad-'))}`, 'about:blank',
], { stdio: 'ignore' });

let ws;
let seq = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve) => {
    pending.set(++seq, resolve);
    ws.send(JSON.stringify({ id: seq, method, params }));
  });

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
  for (const [hex, name] of cases) for (const mode of ['dark', 'light']) for (const comp of COMPS) for (const seed of SEEDS) for (const t of TIMES) runs.push({ hex, name, mode, comp, seed, t });
  for (const { hex, name, mode, comp, seed, t } of runs) {
    {
      await send('Page.navigate', { url: `http://127.0.0.1:8765/tests/dev/gradient.html?accent=${hex}&mode=${mode}&comp=${comp}&seed=${seed}&t=${t}` });
      for (let i = 0; i < 50; i++) {
        const r = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
        if (r?.result?.value === 'ready') break;
        await sleep(50);
      }
      await sleep(150);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const file = `${hex}-${mode}-${comp}-${seed}-${t}.png`;
      writeFileSync(join(OUT, file), Buffer.from(shot.data, 'base64'));
      index.push({ file, hex, name: `${name} ${comp} ${seed} t${t}`, mode, preset: ACCENT_PRESETS.some((p) => p[2] === '#' + hex) });
    }
  }
  writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 1));
  console.log(`${index.length}장 → ${OUT}`);
} finally {
  ws?.close();
  chrome.kill();
}
