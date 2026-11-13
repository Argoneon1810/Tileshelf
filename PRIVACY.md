# Tileshelf 개인정보처리방침 / Privacy Policy

시행일 / Effective date: 2026-11-13

## 한국어

**Tileshelf는 개발자가 운영하는 별도 서버가 없으며, 개발자는 사용자의 어떠한 정보도 수집하거나 전달받지 않습니다.** 다만 브라우저 기능 동작을 위해 아래 두 경우에 한해 정보가 Google 서비스로 전달됩니다.

1. **Google 계정 동기화 (`chrome.storage.sync`).** 바로가기(이름, 주소, 순서), 사용자가 직접 고른 아이콘 이미지, 화면·배경 모양 설정, 변경 기록(체크포인트)은 Chrome의 확장 동기화 저장소(`chrome.storage.sync`)에 저장됩니다. 브라우저에서 Chrome 동기화를 켜 두었다면 이 데이터는 사용자의 Google 계정을 거쳐 같은 계정에 로그인된 다른 기기로 전달됩니다. 설정 → Google 계정 동기화에서 언제든 이 기기의 동기화를 끌 수 있습니다.
2. **바로가기 아이콘 자동 표시.** 바로가기에 사용자 지정 아이콘이 없고 공개 웹 도메인(`http://` 또는 `https://`)일 때만 사이트 아이콘을 표시하기 위해 바로가기 주소의 도메인 이름(예: `github.com`)을 Google 파비콘 서비스(`https://www.google.com/s2/favicons`)로 보내 이미지를 받아 오며, 실패하면 브라우저 내장 파비콘 캐시(`chrome://` `_favicon` 서비스)를 참조합니다. 전체 경로(URL path)나 쿼리 문자열은 외부로 보내지 않으며, `file://` 로컬 파일 경로·`localhost`·IP 주소·내부망 예약 도메인(`.local`, `.internal`, `.lan` 등)·입력 중인 미완성 주소는 외부로 전송하지 않습니다. 공개 도메인 접미사를 쓰는 비공개 사내 호스트 이름도 외부 조회를 원치 않는다면 바로가기 편집 창에서 사용자 지정 아이콘 이미지를 직접 선택해 저장하세요. Google 파비콘 요청에는 Google의 개인정보처리방침이 적용됩니다.
3. **기기에만 저장되는 정보 (`chrome.storage.local` 및 `localStorage`).** 위 항목의 기기 사본, 사용자가 직접 고른 배경 사진, 이 기기의 동기화 켜기/끄기 상태, 새 탭을 열 때 화면 깜빡임을 막기 위한 배경 색상 캐시(`bootBg`)는 사용자의 브라우저 내부에만 저장됩니다. 배경 사진은 용량 한도 때문에 Google 계정으로 동기화되지 않으며 기기 밖으로 나가지 않습니다. 확장을 삭제하면 이 기기에 저장된 내용도 함께 지워집니다.
4. **검색 (`chrome.search`).** 새 탭 검색창에서 웹 검색을 실행하면 입력한 검색어는 Chrome 브라우저에 설정된 기본 검색 엔진으로 바로 전달됩니다. Tileshelf는 검색어를 저장하거나 다른 곳으로 보내지 않으며 기본 검색 엔진 설정을 변경하지 않습니다.
5. **기기 환경 확인.** 처음 실행 안내에서 움직이는 그라데이션 배경의 권장 여부를 안내하기 위해 그래픽 가속(WebGL 렌더러) 지원 여부, 배터리 잔량·충전 상태, 운영체제의 '동작 줄이기(`prefers-reduced-motion`)' 설정을 기기 안에서만 읽습니다. 이 값은 저장하거나 외부로 전송하지 않습니다.
6. **제3자 제공 및 분석 도구.** 위에 적은 경우 외에는 외부 통신이 전혀 없습니다. 광고, 추적기, 외부 분석 도구를 일절 쓰지 않으며 사용자 정보를 제3자에게 판매하거나 이전하지 않습니다.
7. **백업 파일.** 백업 파일(`.json`)은 사용자가 직접 '백업 파일 내보내기'를 눌렀을 때만 만들어지며, 사용자가 지정한 로컬 폴더에 저장됩니다.
8. **문의.** <https://github.com/Argoneon1810/Tileshelf/issues>

이 방침이 바뀌면 이 문서를 갱신하고 시행일을 새로 적습니다.

## English

**Tileshelf operates no developer-run server, and the developer collects or receives none of your data.** Information reaches Google services only in the two browser-integrated cases below.

1. **Google account sync (`chrome.storage.sync`).** Shortcuts (names, URLs, and order), custom icons you choose, appearance settings, and change-history checkpoints are stored in Chrome's extension sync storage (`chrome.storage.sync`). When Chrome Sync is turned on in your browser, these items pass through your Google account to your other devices signed in to the same account. You can turn sync off for any device at any time in Settings → Google Account Sync.
2. **Automatic shortcut icons.** When a shortcut does not use a custom uploaded icon and points to a public web domain (`http://` or `https://`), the extension requests a site icon from Google's favicon service (`https://www.google.com/s2/favicons`) using only the shortcut URL's domain hostname (for example, `github.com`)—never the full URL path or query string—and falls back to Chrome's built-in local `_favicon` service if unavailable. Incomplete URLs while typing, `file://` local paths, `localhost`, IP addresses, and reserved internal suffixes (`.local`, `.internal`, `.lan`, etc.) are never sent to Google's favicon service. If you save a private intranet hostname that uses a public domain suffix and prefer not to query it externally, assign a custom icon image in the shortcut editor. Google's privacy policy applies to requests sent to `www.google.com`.
3. **Data stored only on your device (`chrome.storage.local` and `localStorage`).** Local copies of the items above, any background photo you choose, this device's sync toggle state, and a lightweight startup background color cache (`bootBg`, used to prevent first-frame flicker) stay strictly inside your browser on this device. Background photos are never uploaded to Google sync storage. Uninstalling the extension removes all data stored on this device.
4. **Search (`chrome.search`).** When you run a web search from the new tab search bar, your query is handed directly to the default search engine configured in Chrome via `chrome.search.query`. Tileshelf never stores search queries, never sends them anywhere else, and never modifies your search settings.
5. **Local device capability check.** During the first-run guide, Tileshelf checks WebGL hardware acceleration support, battery charging/level status, and your system `prefers-reduced-motion` setting locally in memory solely to suggest whether to enable animated backgrounds. None of these values are stored or transmitted.
6. **Sharing and analytics.** None beyond the cases above. Tileshelf includes no advertising, no tracking, and no third-party analytics, and never sells or transfers user data.
7. **Backup files.** A backup `.json` file is generated locally only when you explicitly click Export Backup, and is saved wherever you choose on your device.
8. **Contact.** <https://github.com/Argoneon1810/Tileshelf/issues>

The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.

If this policy changes, this document will be updated and the effective date revised.
