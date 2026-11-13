import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldFetchRemoteFavicon, autoIconSources } from '../src/ts/images.ts';

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
