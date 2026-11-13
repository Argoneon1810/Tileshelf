// 그림자가 조상 상자에 잘리는 곳을 찾는다. 페이지 안에서 실행한다 (e2e.mjs가 넣음).
//
// box-shadow는 요소 바깥으로 번지고, text-shadow는 글자 둘레로 번진다. 번진 범위가
// overflow가 visible이 아닌 조상(자기 자신의 text-shadow면 자신 포함)의 안쪽 상자를 벗어나면 잘린다.
// html·body는 뺀다. 화면 밖으로 나간 부분은 어차피 보이지 않기 때문이다.
window.__shadowClips = () => {
  const px = (s) => parseFloat(s) || 0;
  const desc = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + [...el.classList].map((c) => '.' + c).join('');

  function parseShadows(str) {
    if (!str || str === 'none') return [];
    const parts = [];
    let depth = 0;
    let cur = '';
    for (const ch of str) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && !depth) {
        parts.push(cur);
        cur = '';
      } else cur += ch;
    }
    parts.push(cur);
    return parts
      .filter((p) => !/\binset\b/.test(p))
      .map((p) => {
        const nums = (p.replace(/[a-z-]+\([^)]*\)|#[0-9a-f]+/gi, '').match(/-?[\d.]+px/g) ?? []).map(px);
        const [ox = 0, oy = 0, blur = 0, spread = 0] = nums;
        return { ox, oy, blur, spread };
      });
  }

  function extent(r, shadows, isText) {
    let { left: l, top: t, right: rr, bottom: b } = r;
    for (const s of shadows) {
      const e = s.blur + (isText ? 0 : s.spread);
      l = Math.min(l, r.left + s.ox - e);
      rr = Math.max(rr, r.right + s.ox + e);
      t = Math.min(t, r.top + s.oy - e);
      b = Math.max(b, r.bottom + s.oy + e);
    }
    return { l, t, r: rr, b };
  }

  const issues = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (!el.checkVisibility()) continue;
    const cs = getComputedStyle(el);
    const checks = [];
    const box = parseShadows(cs.boxShadow);
    if (box.length) checks.push(['box-shadow', el.getBoundingClientRect(), box, false, el.parentElement]);
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const txt = hasText ? parseShadows(cs.textShadow) : [];
    if (txt.length) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const tr = range.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      // 말줄임으로 잘린 글자는 보이는 부분까지만 본다
      const left = Math.max(tr.left, er.left + px(cs.borderLeftWidth) + px(cs.paddingLeft));
      const right = Math.min(tr.right, er.right - px(cs.borderRightWidth) - px(cs.paddingRight));
      checks.push(['text-shadow', { left, right, top: tr.top, bottom: tr.bottom, width: right - left, height: tr.height }, txt, true, el]);
    }
    for (const [kind, rect, shadows, isText, start] of checks) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      const ext = extent(rect, shadows, isText);
      for (let a = start; a && a !== document.body; a = a.parentElement) {
        const acs = getComputedStyle(a);
        if (acs.overflowX === 'visible' && acs.overflowY === 'visible') continue;
        const ar = a.getBoundingClientRect();
        const cl = ar.left + px(acs.borderLeftWidth);
        const cr = ar.right - px(acs.borderRightWidth);
        const ct = ar.top + px(acs.borderTopWidth);
        const cb = ar.bottom - px(acs.borderBottomWidth);
        // 요소 자체가 스크롤로 가려진 경우는 그림자 문제가 아니다
        const own = el.getBoundingClientRect();
        if (own.left < cl || own.right > cr || own.top < ct || own.bottom > cb) {
          if (a !== el) break;
        }
        const cutX = acs.overflowX !== 'visible' && (ext.l < cl - 0.5 || ext.r > cr + 0.5);
        const cutY = acs.overflowY !== 'visible' && (ext.t < ct - 0.5 || ext.b > cb + 0.5);
        if (cutX || cutY) {
          issues.add(`${kind}: ${desc(el)} ← ${desc(a)} (overflow ${acs.overflowX}/${acs.overflowY})`);
          break;
        }
      }
    }
  }
  return [...issues];
};
