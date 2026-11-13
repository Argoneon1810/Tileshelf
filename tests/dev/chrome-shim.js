// 확장으로 설치하지 않고 일반 웹 페이지로 newtab.html을 띄워 보기 위한 가짜 chrome API.
// 주소 뒤 ?bg=lake|ribbon|none&theme=dark|light&accent=rrggbb&empty=1&open=settings|edit|add 로 처음 상태를 고른다.
// bg=none이면 그라데이션 배경이다. comp=구도, seed=변형, motion=1이면 흐르기, t=초면 그 시각에 멈춘 모습,
// leg=auto|shadow|dim|calm|card는 이름 글씨 처리.
(() => {
  const params = new URLSearchParams(location.search);
  const listeners = new Set();

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

  const sites = [
    ['Gmail', 'https://mail.google.com'], ['YouTube', 'https://youtube.com'], ['네이버', 'https://naver.com'], ['Claude', 'https://claude.ai'],
    ['Drive', 'https://drive.google.com'], ['캘린더', 'https://calendar.google.com'], ['GitHub', 'https://github.com'], ['Notion', 'https://notion.so'],
    ['Figma', 'https://figma.com'], ['나무위키', 'https://namu.wiki'], ['쿠팡', 'https://coupang.com'], ['Netflix', 'https://netflix.com'],
    ['Stack Overflow', 'https://stackoverflow.com'], ['velog', 'https://velog.io'], ['네이버 지도', 'https://map.naver.com'], ['Google 문서', 'https://docs.google.com'],
    ['Reddit', 'https://reddit.com'], ['MDN', 'https://developer.mozilla.org'], ['번역', 'https://papago.naver.com'], ['토스', 'https://toss.im'],
  ];
  const now = Date.now();
  const shortcuts = params.get('empty')
    ? []
    : sites.map(([name, url], i) => ({ id: 's' + i, name, url, addedAt: i === 19 ? now : 1 }));

  const bg = params.get('bg') ?? 'lake';
  const local = {
    shortcuts,
    settings: {
      theme: params.get('theme') ?? 'dark',
      bgType: bg === 'none' ? 'gradient' : 'image',
      ...(params.get('accent') ? { accent: '#' + params.get('accent') } : {}),
      ...(params.get('comp') ? { bgComposition: params.get('comp') } : {}),
      ...(params.get('seed') ? { bgSeed: Number(params.get('seed')) } : {}),
      ...(params.get('motion') ? { bgMotion: 'motion' } : {}),
      ...(params.get('leg') ? { legibility: params.get('leg') } : {}),
    },
    syncState: { lastRev: null, dirty: false, updatedAt: 0 },
    // 처음 실행 안내는 intro=1일 때만 띄운다 (다른 화면 시험을 가리지 않게)
    ...(params.get('intro') ? {} : { introDone: true }),
  };

  window.chrome = {
    i18n: { getUILanguage: () => params.get('lang') ?? 'ko' },
    storage: { local: area('local', local), sync: area('sync'), onChanged: { addListener: (fn) => listeners.add(fn) } },
    runtime: { getURL: (p) => '/__missing__' + p, getManifest: () => ({ version: 'dev' }) },
    search: { query: ({ text }) => (window.__searched ??= []).push(text) },
  };

  // 배경 사진은 data URL로 넣어야 실제와 같다
  if (bg !== 'none') {
    window.__bgReady = fetch(`/tests/dev/${bg}.jpg`)
      .then((r) => r.blob())
      .then((b) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }))
      .then((url) => window.chrome.storage.local.set({ bgImage: url }));
  }

  addEventListener('load', () => {
    const open = params.get('open');
    setTimeout(() => {
      if (params.get('t')) window.__newtab?.background.freezeAt(Number(params.get('t')));
      if (open === 'settings') document.getElementById('settings-btn').click();
      if (open === 'edit') document.querySelector('.tile[data-id="s3"] .more').click();
      if (open === 'add') document.querySelector('.tile.add .link').click();
    }, 300);
  });
})();
