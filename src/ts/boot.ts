// 페이지 맨 처음(head)에 바로 실행한다. 저장소를 읽는 main.ts보다 먼저, 지난번 판 색과 배경을 깔아 둔다.
// 이게 없으면 새 탭을 열 때마다 기본색이 잠깐 보였다가 배경으로 바뀐다. 값은 background.ts가 남긴다.
// 모듈이 아닌 일반 스크립트다(<script src>). import·export를 쓰면 Chrome이 실행하지 않는다.
try {
  const b: { theme?: string; bg?: string; url?: string | null; color?: string } | null = JSON.parse(localStorage.getItem('bootBg') ?? 'null');
  if (b) {
    const root = document.documentElement;
    if (b.theme === 'dark' || b.theme === 'light') root.dataset.theme = b.theme;
    if (b.bg === 'image' || b.bg === 'color' || b.bg === 'gradient') root.dataset.bg = b.bg;
    if (typeof b.url === 'string' && /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(b.url)) {
      root.style.setProperty('--boot-bg', `url("${b.url}")`);
    }
    if (typeof b.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(b.color)) {
      root.style.setProperty('--boot-color', b.color);
    }
  }
} catch {
  /* 남긴 값이 없거나 깨졌으면 기본색으로 시작한다 */
}
// 판 밝기 슬라이더로 정한 판 색(panel-tone.ts가 'r, g, b'로 남김)
try {
  const p = localStorage.getItem('bootPanel');
  if (p && /^\d{1,3}, \d{1,3}, \d{1,3}$/.test(p)) {
    document.documentElement.style.setProperty('--glass', p);
    document.documentElement.style.setProperty('--ic-panel', p);
  }
} catch {
  /* 남긴 값이 없으면 CSS 기본 판 색(가운데 값)으로 시작한다 */
}
