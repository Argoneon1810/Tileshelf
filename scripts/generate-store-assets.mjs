// Chrome 웹 스토어 등록용 홍보 타일(440x280)과 실화면 스크린샷 4장(1280x800)을 생성한다.
// - 실제 빌드 산출물(dist/)을 로컬 임시 서버와 headless Chrome(CDP)으로 렌더링한다.
// - 모든 예시 바로가기는 RFC 2606 예약 도메인(*.example)과 자체 제작 캔버스 기하 아이콘만 써서 제3자 상표·로고를 0건으로 유지한다.
// - 출력 PNG는 스토어 규격에 맞춰 알파 채널 없는 24-bit RGB(color_type=2)로 저장하고 치수를 검증한다.
// 실행: npm run build && node scripts/generate-store-assets.mjs

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const OUT_STORE = join(ROOT, 'docs', 'store');
const OUT_SHOTS = join(OUT_STORE, 'screenshots');

if (!existsSync(join(DIST, 'newtab.html'))) {
  console.error('dist/newtab.html이 없습니다. 먼저 npm run build를 실행하세요.');
  process.exit(1);
}

const CHROME_CANDIDATES = [
  process.env.CHROME,
  process.env.CHROME_BIN,
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const CHROME = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!CHROME) {
  console.error('Chrome 실행 파일을 찾을 수 없습니다.');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// ---- 순수 Node.js PNG 디코더 & 24-bit RGB(color_type=2) 리패커 ----

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function toRgb24Png(rawPngBuf, targetW, targetH, bgRgb = [15, 23, 32]) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!rawPngBuf.subarray(0, 8).equals(sig)) throw new Error('유효한 PNG가 아닙니다.');

  let offset = 8;
  let srcW = 0;
  let srcH = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idats = [];

  while (offset < rawPngBuf.length) {
    const len = rawPngBuf.readUInt32BE(offset);
    const type = rawPngBuf.subarray(offset + 4, offset + 8).toString('ascii');
    const data = rawPngBuf.subarray(offset + 8, offset + 8 + len);
    offset += 12 + len;
    if (type === 'IHDR') {
      srcW = data.readUInt32BE(0);
      srcH = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idats.push(data);
    else if (type === 'IEND') break;
  }

  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`지원하지 않는 PNG 형식: bitDepth=${bitDepth}, colorType=${colorType}`);
  }
  if (srcW !== targetW || srcH !== targetH) {
    throw new Error(`캡처 크기 불일치: 예상 ${targetW}x${targetH}, 실제 ${srcW}x${srcH}`);
  }

  const bpp = colorType === 6 ? 4 : 3;
  const stride = srcW * bpp;
  const inflated = zlib.inflateSync(Buffer.concat(idats));
  const recon = Buffer.alloc(srcH * stride);

  for (let y = 0; y < srcH; y++) {
    const rowIn = y * (stride + 1);
    const filter = inflated[rowIn];
    const rowOut = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = inflated[rowIn + 1 + i];
      const a = i >= bpp ? recon[rowOut + i - bpp] : 0;
      const b = y > 0 ? recon[rowOut - stride + i] : 0;
      const c = y > 0 && i >= bpp ? recon[rowOut - stride + i - bpp] : 0;
      let val = x;
      if (filter === 1) val = (x + a) & 0xff;
      else if (filter === 2) val = (x + b) & 0xff;
      else if (filter === 3) val = (x + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) val = (x + paeth(a, b, c)) & 0xff;
      recon[rowOut + i] = val;
    }
  }

  const outStride = targetW * 3 + 1;
  const outRaw = Buffer.alloc(targetH * outStride);
  for (let y = 0; y < targetH; y++) {
    const outRow = y * outStride;
    outRaw[outRow] = 0;
    for (let x = 0; x < targetW; x++) {
      const idx = y * stride + x * bpp;
      const sr = recon[idx];
      const sg = recon[idx + 1];
      const sb = recon[idx + 2];
      const sa = bpp === 4 ? recon[idx + 3] / 255 : 1;
      const p = outRow + 1 + x * 3;
      outRaw[p] = Math.round(sr * sa + bgRgb[0] * (1 - sa));
      outRaw[p + 1] = Math.round(sg * sa + bgRgb[1] * (1 - sa));
      outRaw[p + 2] = Math.round(sb * sa + bgRgb[2] * (1 - sa));
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(targetW, 0);
  ihdr.writeUInt32BE(targetH, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // 24-bit RGB (no alpha)
  const outPng = Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(outRaw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);

  // 헤더 재검증
  if (outPng.readUInt32BE(16) !== targetW || outPng.readUInt32BE(20) !== targetH || outPng[25] !== 2) {
    throw new Error('출력 PNG 헤더 검증 실패');
  }
  return outPng;
}

// ---- 스토어 데모용 가짜 chrome API (중립 기하 아이콘 + *.example 도메인) ----

const STORE_SHIM_JS = `(() => {
  const params = new URLSearchParams(location.search);
  const lang = params.get('lang') ?? 'en';
  const scene = params.get('scene') ?? '1';
  const listeners = new Set();

  function makeIcon(bgHex, glyph) {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = bgHex;
    g.beginPath();
    g.roundRect(4, 4, 56, 56, 15);
    g.fill();
    g.strokeStyle = '#ffffff';
    g.fillStyle = '#ffffff';
    g.lineWidth = 3.6;
    g.lineCap = 'round';
    g.lineJoin = 'round';

    if (glyph === 'mail') {
      g.strokeRect(16, 21, 32, 22);
      g.beginPath(); g.moveTo(17, 23); g.lineTo(32, 34); g.lineTo(47, 23); g.stroke();
    } else if (glyph === 'cal') {
      g.strokeRect(17, 19, 30, 27);
      g.beginPath(); g.moveTo(17, 27); g.lineTo(47, 27); g.moveTo(24, 15); g.lineTo(24, 21); g.moveTo(40, 15); g.lineTo(40, 21); g.stroke();
    } else if (glyph === 'doc') {
      g.strokeRect(19, 15, 26, 34);
      g.beginPath(); g.moveTo(24, 24); g.lineTo(40, 24); g.moveTo(24, 32); g.lineTo(40, 32); g.moveTo(24, 40); g.lineTo(34, 40); g.stroke();
    } else if (glyph === 'code') {
      g.beginPath(); g.moveTo(26, 23); g.lineTo(17, 32); g.lineTo(26, 41); g.moveTo(38, 23); g.lineTo(47, 32); g.lineTo(38, 41); g.stroke();
    } else if (glyph === 'cloud') {
      g.beginPath(); g.arc(26, 34, 7, Math.PI * 0.5, Math.PI * 1.6); g.arc(34, 28, 8, Math.PI, Math.PI * 1.95); g.arc(41, 35, 6, Math.PI * 1.5, Math.PI * 0.5); g.closePath(); g.stroke();
    } else if (glyph === 'board') {
      g.strokeRect(16, 17, 14, 30); g.strokeRect(34, 17, 14, 19);
    } else if (glyph === 'chart') {
      g.beginPath(); g.moveTo(18, 45); g.lineTo(46, 45); g.moveTo(23, 45); g.lineTo(23, 33); g.moveTo(32, 45); g.lineTo(32, 22); g.moveTo(41, 45); g.lineTo(41, 28); g.stroke();
    } else if (glyph === 'check') {
      g.beginPath(); g.arc(32, 32, 14, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(25, 32); g.lineTo(30, 37); g.lineTo(40, 26); g.stroke();
    } else if (glyph === 'term') {
      g.strokeRect(16, 18, 32, 28);
      g.beginPath(); g.moveTo(22, 27); g.lineTo(28, 32); g.lineTo(22, 37); g.moveTo(32, 37); g.lineTo(40, 37); g.stroke();
    } else if (glyph === 'book') {
      g.strokeRect(19, 16, 26, 32);
      g.beginPath(); g.moveTo(25, 16); g.lineTo(25, 48); g.stroke();
    } else if (glyph === 'note') {
      g.beginPath(); g.moveTo(27, 40); g.lineTo(27, 21); g.lineTo(42, 18); g.lineTo(42, 37); g.stroke();
      g.beginPath(); g.arc(24, 40, 4, 0, Math.PI * 2); g.arc(39, 37, 4, 0, Math.PI * 2); g.fill();
    } else if (glyph === 'map') {
      g.beginPath(); g.arc(32, 28, 8, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(32, 36); g.lineTo(32, 47); g.stroke();
    } else if (glyph === 'shield') {
      g.beginPath(); g.moveTo(32, 16); g.lineTo(45, 22); g.lineTo(43, 36); g.lineTo(32, 47); g.lineTo(21, 36); g.lineTo(19, 22); g.closePath(); g.stroke();
    } else if (glyph === 'clock') {
      g.beginPath(); g.arc(32, 32, 14, 0, Math.PI * 2); g.moveTo(32, 24); g.lineTo(32, 32); g.lineTo(38, 36); g.stroke();
    } else if (glyph === 'layers') {
      g.beginPath(); g.moveTo(32, 18); g.lineTo(47, 26); g.lineTo(32, 34); g.lineTo(17, 26); g.closePath(); g.stroke();
      g.beginPath(); g.moveTo(17, 34); g.lineTo(32, 42); g.lineTo(47, 34); g.stroke();
    } else {
      g.beginPath(); g.arc(32, 32, 12, 0, Math.PI * 2); g.stroke();
    }
    return c.toDataURL('image/png');
  }

  const EN_ITEMS = [
    ['Inbox', 'https://mail.workspace.example', '#3a75bf', 'mail'],
    ['Calendar', 'https://calendar.workspace.example', '#d9584a', 'cal'],
    ['Release Docs', 'https://docs.workspace.example/releases', '#2d8a62', 'doc'],
    ['Code Repo', 'https://git.workspace.example', '#2b3440', 'code'],
    ['Cloud Drive', 'https://drive.workspace.example', '#189399', 'cloud'],
    ['Sprint Board', 'https://board.workspace.example', '#7e57c2', 'board'],
    ['Analytics', 'https://metrics.workspace.example', '#d97a26', 'chart'],
    ['Task Tracker', 'https://tasks.workspace.example', '#39935a', 'check'],
    ['Build Console', 'https://ci.workspace.example', '#455466', 'term'],
    ['API Docs', 'https://docs.workspace.example/api', '#3c78c8', 'book'],
    ['Design System', 'https://ui.workspace.example', '#c85588', 'layers'],
    ['Security Vault', 'https://vault.workspace.example', '#2e6b9e', 'shield'],
    ['Audio Studio', 'https://audio.workspace.example', '#b85d38', 'note'],
    ['Field Guide', 'https://maps.workspace.example', '#2c8c78', 'map'],
    ['Time Log', 'https://time.workspace.example', '#6c63b5', 'clock'],
    ['Team Wiki', 'https://wiki.workspace.example', '#4c88d3', 'doc'],
  ];

  const KO_ITEMS = [
    ['업무 메일', 'https://mail.workspace.example', '#3a75bf', 'mail'],
    ['일정 달력', 'https://calendar.workspace.example', '#d9584a', 'cal'],
    ['출시 문서', 'https://docs.workspace.example/releases', '#2d8a62', 'doc'],
    ['코드 저장소', 'https://git.workspace.example', '#2b3440', 'code'],
    ['클라우드 폴더', 'https://drive.workspace.example', '#189399', 'cloud'],
    ['칸반 보드', 'https://board.workspace.example', '#7e57c2', 'board'],
    ['지표 분석', 'https://metrics.workspace.example', '#d97a26', 'chart'],
    ['할 일 목록', 'https://tasks.workspace.example', '#39935a', 'check'],
    ['빌드 콘솔', 'https://ci.workspace.example', '#455466', 'term'],
    ['API 안내서', 'https://docs.workspace.example/api', '#3c78c8', 'book'],
    ['디자인 토큰', 'https://ui.workspace.example', '#c85588', 'layers'],
    ['보안 금고', 'https://vault.workspace.example', '#2e6b9e', 'shield'],
    ['사운드 노트', 'https://audio.workspace.example', '#b85d38', 'note'],
    ['답사 지도', 'https://maps.workspace.example', '#2c8c78', 'map'],
  ];

  const rawItems = lang === 'ko' ? KO_ITEMS : EN_ITEMS;
  const now = Date.now();
  const icons = {};
  const shortcuts = rawItems.map(([name, url, color, glyph], i) => {
    const icId = 'ic' + i;
    icons[icId] = makeIcon(color, glyph);
    return {
      id: 's' + i,
      name,
      url,
      icon: icId,
      addedAt: scene === '1' && i === rawItems.length - 1 ? now : 1700000000000 + i * 1000,
    };
  });

  const sceneSettings = {
    '1': { theme: 'dark', bgType: 'gradient', accent: '#4087de', bgComposition: 'aurora', bgSeed: 104729, legibility: 'dim', dim: 0.34 },
    '2': { theme: 'dark', bgType: 'gradient', accent: '#12a7a7', bgComposition: 'horizon', bgSeed: 42119, legibility: 'dim', dim: 0.38 },
    '3': { theme: 'light', bgType: 'gradient', accent: '#9163d5', bgComposition: 'bloom', bgSeed: 88177, legibility: 'card', dim: 0.30 },
    '4': { theme: 'dark', bgType: 'gradient', accent: '#df5e97', bgComposition: 'currents', bgSeed: 65537, legibility: 'dim', dim: 0.40 },
  }[scene];

  function area(name, initial = {}) {
    const data = structuredClone(initial);
    return {
      async get(keys) {
        const all = structuredClone(data);
        if (keys == null) return all;
        const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
        return Object.fromEntries(list.filter((k) => k in all).map((k) => [k, all[k]]));
      },
      async set(obj) {
        const changes = {};
        for (const [k, v] of Object.entries(obj)) {
          changes[k] = { oldValue: data[k], newValue: structuredClone(v) };
          data[k] = structuredClone(v);
        }
        setTimeout(() => listeners.forEach((fn) => fn(changes, name)), 0);
      },
      async remove(keys) {
        for (const k of [].concat(keys)) delete data[k];
      },
    };
  }

  const localInit = {
    shortcuts,
    icons,
    settings: sceneSettings,
    syncState: { lastRev: null, dirty: false, updatedAt: 0 },
    introDone: true,
  };

  window.chrome = {
    i18n: { getUILanguage: () => lang },
    storage: {
      local: area('local', localInit),
      sync: area('sync'),
      onChanged: { addListener: (fn) => listeners.add(fn) },
    },
    runtime: {
      getURL: (p) => '/dist/' + p.replace(/^\\/+/, ''),
      getManifest: () => ({ version: '1.0.0' }),
    },
    search: { query: () => {} },
  };
})();`;

const PROMO_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 440px; height: 280px; overflow: hidden; position: relative;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      color: #ebeff4; background: #0f1720;
    }
    canvas#bg { position: absolute; inset: 0; width: 440px; height: 280px; display: block; }
    .veil { position: absolute; inset: 0; background: linear-gradient(115deg, rgba(15, 23, 32, 0.72) 0%, rgba(15, 23, 32, 0.34) 100%); }
    .wrap {
      position: relative; z-index: 2; width: 100%; height: 100%;
      display: grid; grid-template-columns: 1.18fr 0.82fr; align-items: center;
      padding: 26px 26px 26px 28px; gap: 16px;
    }
    .brand { display: flex; align-items: center; gap: 11px; margin-bottom: 12px; }
    .brand img { width: 42px; height: 42px; margin: -5px; }
    .brand-name { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; color: #ffffff; }
    .tagline { font-size: 14.5px; line-height: 1.42; color: #d5dfee; font-weight: 500; margin-bottom: 16px; }
    .pills { display: flex; flex-wrap: wrap; gap: 6px; }
    .pill {
      font-size: 11px; font-weight: 600; color: #e3eefd;
      padding: 4px 9px; border-radius: 999px;
      background: rgba(25, 29, 35, 0.68);
      border: 1px solid rgba(172, 183, 197, 0.28);
      backdrop-filter: blur(10px);
    }
    .shelf-card {
      padding: 14px; border-radius: 18px;
      background: rgba(25, 29, 35, 0.72);
      border: 1px solid rgba(255, 255, 255, 0.14);
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.38);
      backdrop-filter: blur(16px);
    }
    .mini-search {
      height: 24px; border-radius: 999px; margin-bottom: 12px;
      background: rgba(255, 255, 255, 0.09);
      border: 1px solid rgba(255, 255, 255, 0.12);
      display: flex; align-items: center; padding: 0 10px; gap: 6px;
      font-size: 10px; color: #a9aeb6;
    }
    .mini-dot { width: 7px; height: 7px; border-radius: 50%; border: 1.5px solid #a9aeb6; }
    .mini-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; }
    .mini-tile {
      aspect-ratio: 1; border-radius: 11px;
      background: rgba(244, 247, 251, 0.92);
      display: grid; place-items: center; position: relative;
      box-shadow: 0 3px 8px rgba(0, 0, 0, 0.2);
    }
    .mini-tile i { width: 16px; height: 16px; border-radius: 5px; display: block; }
    .mini-tile.accent {
      background: #e176a1;
      box-shadow: 0 4px 12px rgba(225, 118, 161, 0.45);
    }
    .mini-tile.accent::before, .mini-tile.accent::after {
      content: ''; position: absolute; background: #ffffff; border-radius: 2px;
    }
    .mini-tile.accent::before { width: 12px; height: 2.4px; }
    .mini-tile.accent::after { width: 2.4px; height: 12px; }
  </style>
</head>
<body>
  <canvas id="bg" width="440" height="280"></canvas>
  <div class="veil"></div>
  <div class="wrap">
    <div>
      <div class="brand">
        <img src="/dist/icons/icon128.png" alt="">
        <span class="brand-name">Tileshelf</span>
      </div>
      <p class="tagline">Unlimited new-tab shortcuts with sync, search, and 100-step history.</p>
      <div class="pills">
        <span class="pill">Chrome Sync</span>
        <span class="pill">100-Step Undo</span>
        <span class="pill">Photo Backup</span>
      </div>
    </div>
    <div class="shelf-card">
      <div class="mini-search"><span class="mini-dot"></span><span>Search &amp; jump…</span></div>
      <div class="mini-grid">
        <div class="mini-tile"><i style="background:#3a75bf"></i></div>
        <div class="mini-tile"><i style="background:#2d8a62"></i></div>
        <div class="mini-tile"><i style="background:#7e57c2"></i></div>
        <div class="mini-tile"><i style="background:#189399"></i></div>
        <div class="mini-tile"><i style="background:#d97a26"></i></div>
        <div class="mini-tile"><i style="background:#455466"></i></div>
        <div class="mini-tile"><i style="background:#3c78c8"></i></div>
        <div class="mini-tile"><i style="background:#2e6b9e"></i></div>
        <div class="mini-tile accent"></div>
      </div>
    </div>
  </div>
  <script type="module">
    import { buildScene, AuroraGL, renderCPU } from '/dist/js/aurora.js';
    const canvas = document.getElementById('bg');
    const sc = buildScene({ accent: '#4087de', mode: 'dark', seed: 104729, composition: 'aurora', aspect: 440 / 280 });
    const gl = AuroraGL.create();
    if (gl) {
      gl.draw(sc, 3.6, 440, 280);
      canvas.getContext('2d').drawImage(gl.canvas, 0, 0);
    } else {
      canvas.getContext('2d').drawImage(renderCPU(sc, { width: 220 }), 0, 0, 440, 280);
    }
    window.__promoReady = true;
  </script>
</body>
</html>`;

function buildStoreAppHtml() {
  const raw = readFileSync(join(DIST, 'newtab.html'), 'utf8');
  return raw.replace(
    '<head>',
    '<head>\n  <base href="/dist/">\n  <script src="/__store_shim.js"></script>',
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = createServer((req, res) => {
  const urlPath = (req.url ?? '/').split('?')[0];
  if (urlPath === '/__store_app.html') {
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    res.end(buildStoreAppHtml());
    return;
  }
  if (urlPath === '/__store_shim.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'] });
    res.end(STORE_SHIM_JS);
    return;
  }
  if (urlPath === '/__store_promo.html') {
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    res.end(PROMO_HTML);
    return;
  }
  const full = resolve(ROOT, '.' + urlPath);
  if (!full.startsWith(DIST) || !existsSync(full) || statSync(full).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(full)] ?? 'application/octet-stream' });
  res.end(readFileSync(full));
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const httpPort = server.address().port;
const debugPort = 9345;

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    '--window-size=1280,800',
    '--force-device-scale-factor=1',
    '--hide-scrollbars',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'tileshelf-store-'))}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let ws;
let seq = 0;
const pending = new Map();

function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveP, rejectP) => pending.set(id, { resolve: resolveP, reject: rejectP }));
}

async function js(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

async function captureRgb(outPath, width, height, bgRgb) {
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  const rgbBuf = toRgb24Png(Buffer.from(shot.data, 'base64'), width, height, bgRgb);
  writeFileSync(outPath, rgbBuf);
  console.log(`Generated ${outPath.replace(ROOT + '\\', '').replace(ROOT + '/', '')} (${width}x${height} RGB, ${rgbBuf.length} bytes)`);
}

try {
  mkdirSync(OUT_SHOTS, { recursive: true });

  let targets;
  for (let i = 0; i < 50; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
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

  // ---- 1280x800 스크린샷 4장 ----
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  // 1) 1-grid-aurora.png (영문 메인 오로라 격자)
  await send('Page.navigate', { url: `http://127.0.0.1:${httpPort}/__store_app.html?scene=1&lang=en` });
  for (let i = 0; i < 50 && !(await js(`document.querySelectorAll('.tile[data-id]').length`).catch(() => 0)); i++) await sleep(100);
  await js(`window.__newtab.background.freezeAt(4.2)`);
  await sleep(300);
  await captureRgb(join(OUT_SHOTS, '1-grid-aurora.png'), 1280, 800, [15, 23, 32]);

  // 2) 2-unified-search.png (영문 통합 검색창 — 바로가기 필터 + 주소 이동 + 웹 검색 동시 시연)
  await send('Page.navigate', { url: `http://127.0.0.1:${httpPort}/__store_app.html?scene=2&lang=en` });
  for (let i = 0; i < 50 && !(await js(`document.querySelectorAll('.tile[data-id]').length`).catch(() => 0)); i++) await sleep(100);
  await js(`window.__newtab.background.freezeAt(2.8)`);
  await js(`(() => {
    const q = document.getElementById('q');
    q.value = 'docs.workspace.example';
    q.dispatchEvent(new Event('input'));
    document.querySelector('#results .chip')?.focus();
  })()`);
  await sleep(300);
  await captureRgb(join(OUT_SHOTS, '2-unified-search.png'), 1280, 800, [15, 23, 32]);

  // 3) 3-settings-theme.png (밝은 테마 + 유리 카드 타일 + 배경 구도·강조색 설정 서랍)
  await send('Page.navigate', { url: `http://127.0.0.1:${httpPort}/__store_app.html?scene=3&lang=en` });
  for (let i = 0; i < 50 && !(await js(`document.querySelectorAll('.tile[data-id]').length`).catch(() => 0)); i++) await sleep(100);
  await js(`window.__newtab.background.freezeAt(5.5)`);
  await js(`document.getElementById('settings-btn').click()`);
  await sleep(100);
  await js(`document.querySelector('#settings [data-goto="background"]').click()`);
  await js(`document.activeElement?.blur?.()`);
  await sleep(400);
  await captureRgb(join(OUT_SHOTS, '3-settings-theme.png'), 1280, 800, [238, 246, 255]);

  // 4) 4-sync-history.png (한국어 UI + 여러 기기 변경 기록·되돌리기 목록)
  await send('Page.navigate', { url: `http://127.0.0.1:${httpPort}/__store_app.html?scene=4&lang=ko` });
  for (let i = 0; i < 50 && !(await js(`document.querySelectorAll('.tile[data-id]').length`).catch(() => 0)); i++) await sleep(100);
  await js(`window.__newtab.background.freezeAt(1.9)`);
  // 실제 체크포인트 이력을 생성하고 다른 기기 기록도 함께 넣어 복원 목록을 시연한다
  await js(`(async () => {
    const { store, sync } = window.__newtab;
    const { encode } = await import('/dist/js/syncdoc.js');
    const { appendCheckpoint } = await import('/dist/js/checkpoints.js');
    const baseState = { shortcuts: store.shortcuts.slice(0, 12), settings: store.settings };
    const cp1 = { id: 'cp-other-1', dev: '8f2a9900', at: Date.now() - 3600_000 * 3, count: 12, what: { import: true }, root: 'root-demo' };
    let otherPack = appendCheckpoint(null, cp1, baseState);
    const cp2 = { id: 'cp-other-2', dev: '8f2a9900', at: Date.now() - 3600_000 * 1.5, count: 13, what: { add: 1 }, root: 'root-demo' };
    otherPack = appendCheckpoint(otherPack, cp2, { shortcuts: store.shortcuts.slice(0, 13), settings: store.settings });
    const encoded = encode('p:8f2a9900', otherPack);
    await chrome.storage.sync.set({
      'h:8f2a9900': { v: 2, dev: '8f2a9900', head: cp2, chunks: encoded.chunks },
      ...encoded.items,
    });
    await sync.reconcile();
    await store.addShortcut({ name: '팀 위키', url: 'https://wiki.workspace.example', iconData: store.icons.ic2 });
    await store.setSettings({ dim: 0.36 });
    await sync.reconcile();
  })()`);
  await sleep(1800);
  await js(`window.__newtab.sync.reconcile()`);
  await js(`document.getElementById('settings-btn').click()`);
  await sleep(100);
  await js(`document.querySelector('#settings [data-goto="history"]').click()`);
  await sleep(80);
  await js(`document.getElementById('history-toggle').click()`);
  await js(`document.activeElement?.blur?.()`);
  await sleep(300);
  await captureRgb(join(OUT_SHOTS, '4-sync-history.png'), 1280, 800, [15, 23, 32]);

  // ---- 440x280 소형 홍보 타일 ----
  await send('Emulation.setDeviceMetricsOverride', { width: 440, height: 280, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${httpPort}/__store_promo.html` });
  for (let i = 0; i < 50 && !(await js(`window.__promoReady`).catch(() => false)); i++) await sleep(100);
  await sleep(200);
  await captureRgb(join(OUT_STORE, 'promo-440x280.png'), 440, 280, [15, 23, 32]);
} finally {
  ws?.close();
  chrome.kill();
  server.close();
}
