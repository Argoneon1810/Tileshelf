import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldFetchRemoteFavicon, autoIconSources } from '../src/ts/images.ts';
import { processIconPixels, sanitizeIconEffects, canReadIconPixels } from '../src/ts/icon-effects.ts';
import { Store } from '../src/ts/store.ts';
import { makeBackup, parseBackup } from '../src/ts/backup.ts';
import { newDevice } from './fake-chrome.mjs';

test('공개 웹 도메인만 외부 파비콘 호스트로 판정하고 미완성·로컬·사설 주소는 제외한다', () => {
  assert.equal(shouldFetchRemoteFavicon('https://github.com/org/repo?tab=1'), 'github.com');
  assert.equal(shouldFetchRemoteFavicon('http://sub.naver.co.kr:8080/path'), 'sub.naver.co.kr');
  assert.equal(shouldFetchRemoteFavicon('https://xn--9t4b11yi5a.xn--3e0b707e/'), 'xn--9t4b11yi5a.xn--3e0b707e');

  for (const skipped of [
    'https://naver',
    'https://naver.',
    'https://naver.c',
    'file:///D:/docs/report.pdf',
    'http://localhost:3000',
    'http://app.localhost:8080',
    'http://127.0.0.1:8765',
    'http://192.168.0.10/admin',
    'http://[::1]:8080',
    'https://nas.local',
    'https://jira.internal',
    'https://git.corp',
    'https://router.home.arpa',
    'https://docs.example',
    'https://www.example.com/page',
  ]) {
    assert.equal(shouldFetchRemoteFavicon(skipped), null, `외부 전송 제외여야 함: ${skipped}`);
    assert.equal(
      autoIconSources(skipped).some((u) => u.includes('google.com/s2/favicons')),
      false,
      `s2/favicons 없어야 함: ${skipped}`,
    );
  }

  assert.equal(
    autoIconSources('https://claude.ai/new').some((u) => u.includes('google.com/s2/favicons?domain=claude.ai')),
    true,
  );
});

test('외곽이 이미 투명한 아이콘(유튜브·배지류)은 알파 게이트(Gate 1)를 통과해 본체 색상이 지워지지 않는다', () => {
  const W = 64, H = 64;
  const rgba = new Uint8ClampedArray(W * H * 4);
  // 투명 캔버스 중앙(12..52)에 빨간 사각형(유튜브)과 가운데 흰 삼각형을 그린다
  for (let y = 14; y < 50; y++) {
    for (let x = 10; x < 54; x++) {
      const i = (y * W + x) * 4;
      rgba[i] = 255;
      rgba[i + 1] = 0;
      rgba[i + 2] = 51;
      rgba[i + 3] = 255;
    }
  }
  const res = processIconPixels(rgba, W, H, { removeBg: true, trimAlpha: true, opticalSize: true });
  assert.equal(res.shouldRemoveOuterBg, false, '외곽이 이미 투명하므로 배경 제거 대상이 아니어야 함');
  // 빨간 몸통 픽셀(20, 20)이 그대로 불투명하게 살아 있어야 한다
  const sampleIdx = (20 * W + 20) * 4;
  assert.equal(res.rgba[sampleIdx], 255);
  assert.equal(res.rgba[sampleIdx + 3], 255);
});

test('흰 외곽 배경과 회색 안티앨리어싱 테두리는 2px 공선성 언믹싱으로 제거되고 다크모드 대비 보정이 무손실로 적용된다', () => {
  const W = 64, H = 64;
  const rgba = new Uint8ClampedArray(W * H * 4);
  // 전체를 흰 배경(255,255,255)으로 채우고 중앙에 짙은 남색(27,44,72) 도형과 반투명 회색 경계를 둔다
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = 255;
    rgba[i * 4 + 1] = 255;
    rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = 255;
  }
  for (let y = 18; y <= 46; y++) {
    for (let x = 18; x <= 46; x++) {
      const i = (y * W + x) * 4;
      const isEdge = y === 18 || y === 46 || x === 18 || x === 46;
      // 경계는 50% 남색 + 50% 흰색 = (141, 150, 164)
      rgba[i] = isEdge ? 141 : 27;
      rgba[i + 1] = isEdge ? 150 : 44;
      rgba[i + 2] = isEdge ? 164 : 72;
      rgba[i + 3] = 255;
    }
  }

  // 1) 밝은 테마에서는 흰 배경과 회색 테두리만 제거되고 본체 남색(27,44,72)은 그대로 유지된다
  const lightRes = processIconPixels(rgba, W, H, {
    removeBg: true,
    trimAlpha: true,
    opticalSize: true,
    themeAdapt: 'auto',
    currentTheme: 'light',
  });
  assert.equal(lightRes.shouldRemoveOuterBg, true);
  assert.equal(lightRes.clashesWithDarkTheme, true);
  assert.equal(lightRes.appliedThemeAdapt, 'none');
  assert.equal(lightRes.rgba[0 * 4 + 3], 0, '외곽 흰 배경은 투명해져야 함');
  const edgeIdx = (18 * W + 30) * 4;
  assert.equal(lightRes.rgba[edgeIdx], 27, '회색 경계 픽셀의 R 채널이 남색 코어(27)로 복원되어야 함');
  assert.equal(lightRes.rgba[edgeIdx + 1], 44);
  assert.equal(lightRes.rgba[edgeIdx + 2], 72);

  // 2) 어두운 테마에서는 비파괴 명도 리프트(luma-lift)가 적용된다
  const darkRes = processIconPixels(rgba, W, H, {
    removeBg: true,
    trimAlpha: true,
    opticalSize: true,
    themeAdapt: 'auto',
    currentTheme: 'dark',
  });
  assert.equal(darkRes.appliedThemeAdapt, 'luma-lift');
  const coreIdx = (32 * W + 32) * 4;
  assert.ok(darkRes.rgba[coreIdx + 2] > 180, '다크모드에서 남색 본체 명도가 밝게 리프트되어야 함');
});

test('비파괴 효과 스택과 아이콘 표시 영역·이름 표시 설정이 저장소와 백업에서 보존된다', async () => {
  const dev = newDevice();
  const store = new Store(dev.local);
  await store.load();
  assert.equal(store.settings.iconScale, 50);
  assert.equal(store.settings.showLabel, true);
  assert.equal(store.settings.hoverLabel, true);

  const sc = await store.addShortcut({ name: 'GitHub', url: 'https://github.com' });
  const sc2 = await store.addShortcut({ name: 'Naver', url: 'https://naver.com' });
  const eff = sanitizeIconEffects({
    enabled: true,
    bgRemove: true,
    trimAlpha: true,
    opticalSize: true,
    themeAdapt: 'invert-mark',
  });
  const changed = await store.applyIconEffectsBatch([
    { id: sc.id, iconEffects: eff },
    { id: sc2.id, iconEffects: null },
  ]);
  assert.equal(changed, 1);
  await store.setSettings({ iconScale: 58, showLabel: false, hoverLabel: true });

  const parsed = parseBackup(JSON.stringify(makeBackup(store)));
  const restored = new Store(newDevice().local);
  await restored.load();
  await restored.applyDoc(parsed.doc, { origin: 'import' });

  assert.equal(restored.settings.iconScale, 58);
  assert.equal(restored.settings.showLabel, false);
  assert.deepEqual(restored.shortcuts[0].iconEffects, eff);
  assert.equal(restored.shortcuts[1].iconEffects, undefined);
});

test('아이콘 정리는 직접 고른 이미지의 픽셀만 읽고, 자동 아이콘(바깥 서버)은 읽으려 하지 않는다', () => {
  // Google 파비콘 서버는 CORS 허가 헤더를 보내지 않아, 읽으려 하면 Chrome이 막고 확장 오류를 남긴다(1.2.1).
  for (const src of autoIconSources('https://youtube.com/')) assert.equal(canReadIconPixels(src), false, src);
  assert.equal(canReadIconPixels('https://www.google.com/s2/favicons?domain=youtube.com&sz=64'), false);
  assert.equal(canReadIconPixels('data:image/png;base64,iVBORw0KGgo='), true);
  assert.equal(canReadIconPixels('blob:chrome-extension://abc/123'), true);
});
