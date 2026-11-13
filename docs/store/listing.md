# Chrome 웹 스토어 등록 정보 정본 (`docs/store/listing.md`)

Chrome 웹 스토어 개발자 대시보드에 그대로 붙여 넣을 문구와 선택 값을 탭 순서대로 정리한 정본 문서다.  
모든 기능 설명·권한 사유·개인정보 고지·테스트 안내는 `0.12.0` 실제 소스 코드와 빌드 산출물 기준으로 대조·검증을 마쳤다.

---

## 1. 패키지 탭 (`Package`)

`npm run package`가 생성한 `release/tileshelf-<버전>.zip`(첫 스토어 정식 출시 시 `release/tileshelf-1.0.0.zip`)을 업로드한다.  
확장 이름과 짧은 설명은 ZIP 안의 `_locales/en/messages.json`(`default_locale: "en"`)과 `_locales/ko/messages.json`에서 자동으로 읽어 간다.

| 로케일 | `extName` | `extDescription` (한도 132자) | 글자 수 |
| --- | --- | --- | --- |
| `en` (기본) | `Tileshelf` | `Unlimited new-tab shortcut grid with Google account sync, 100-step version history, search, and single-file photo backup.` | 121자 |
| `ko` | `Tileshelf` | `개수 제한 없는 바로가기 새 탭. Google 계정 자동 동기화와 100단계 변경 기록, 배경 사진 단일 파일 백업을 지원합니다.` | 72자 |

---

## 2. 스토어 등록정보 탭 (`Store Listing`)

대시보드 우측 상단 언어 선택기에서 **English**와 **한국어** 두 언어를 각각 선택해 아래 상세 설명을 붙여 넣는다.

### 상세 설명 — English (`default_locale`)

```text
Turn Chrome's New Tab into a clean, unlimited shortcut shelf that stays in sync across your devices—without creating a separate account.

• Unlimited Shortcuts: Add as many tiles as you want, drag to reorder, and customize names, URLs (including local file:// paths), and custom icon images.
• Zero-Signup Chrome Sync: Shortcuts, custom icons, and display settings sync automatically across devices signed into the same Google account with Chrome Sync enabled.
• 100-Step Version History: Every change records a compact checkpoint. Open Settings → History to inspect per-device timelines and roll back to any earlier state.
• Single-File Backup (.json): Export and import shortcuts, custom icons, display settings, and your local background photo together in one portable file.
• Calm, Legible Backgrounds: Pick WebGL mesh gradients (9 accents × 4 compositions × gentle flow or still), solid colors, or your own local photo, paired with measured 5:1+ label legibility modes (Dim overlay, Frosted card, or Text shadow).
• Unified Search Bar: Filter your shortcuts, navigate directly to a URL, or search the web with your Chrome default search engine from one bar (reorderable priority; press Enter twice for the top action).

No news feeds, ads, weather widgets, analytics, or external accounts. UI automatically follows your Chrome language (English and Korean).

Privacy & Safety Notes:
• The developer operates no servers and collects no user data. Sync data stays in Chrome's storage (chrome.storage.local / chrome.storage.sync).
• For public http/https shortcuts without a custom image, the shortcut's domain (not full path or query) is requested from Google's icon service (www.google.com/s2/favicons), falling back to Chrome's local _favicon cache. Local files, localhost, IP addresses, and intranet hostnames are never sent externally.
• Export backup (.json) files periodically to keep an extra copy of important shortcuts. Backup files store URLs and photos in unencrypted plain text—keep them private on shared devices, and check visible tiles before screen sharing.
• Provided free of charge "AS IS" without warranty under GPL-3.0-or-later.

Google and Chrome are trademarks of Google LLC. Tileshelf is an independent project and is not affiliated with, endorsed by, or sponsored by Google LLC.
```

### 상세 설명 — 한국어 (`ko`)

```text
별도 회원가입 없이 Chrome 새 탭을 개수 제한 없는 깔끔한 바로가기 선반으로 바꿉니다.

• 개수 제한 없는 바로가기: 원하는 만큼 타일을 더하고 끌어 순서를 바꾸며, 이름·주소(로컬 file:// 경로 포함)·직접 고른 아이콘 이미지를 자유롭게 지정합니다.
• 가입 없는 Google 계정 동기화: Chrome 동기화를 켠 같은 Google 계정의 기기끼리 바로가기, 직접 고른 아이콘, 화면 설정이 자동으로 맞춰집니다.
• 기기별 100단계 변경 기록: 바꿀 때마다 가벼운 체크포인트가 쌓입니다. 설정 → 기록에서 기기별 변경 내역을 확인하고 원하는 시점으로 언제든 되돌릴 수 있습니다.
• 사진까지 담는 단일 파일 백업(.json): 바로가기, 직접 고른 아이콘, 화면 설정, 내 사진 배경을 파일 하나로 내보내고 불러옵니다.
• 눈이 편한 배경과 검증된 이름 가독성: 9가지 강조색 × 4가지 구도의 그라데이션(정지·흐르기), 단색, 내 사진 배경 중 고르고, 실측 대비 5:1 이상을 맞추는 가독성 효과(배경 막·반투명 카드·그림자 효과)로 이름을 또렷하게 표시합니다.
• 통합 검색창: 검색창 하나에서 바로가기 찾기, 주소 바로 이동, Chrome 기본 검색 엔진 웹 검색을 함께 처리합니다(묶음 우선순위 변경 지원, Enter 두 번으로 1순위 즉시 실행).

뉴스 피드, 광고, 날씨 위젯, 분석 도구, 별도 계정이 없습니다. Chrome 언어 설정에 따라 한국어와 영어로 자동 표시됩니다.

개인정보 및 안전 안내:
• 개발자가 운영하는 서버가 없으며 어떠한 사용자 정보도 수집하지 않습니다. 데이터는 브라우저 저장소(chrome.storage.local / chrome.storage.sync)에만 저장됩니다.
• 직접 이미지를 지정하지 않은 공개 웹(http/https) 바로가기는 사이트 아이콘 표시를 위해 도메인 이름(세부 경로·쿼리 제외)을 Google 아이콘 서비스(www.google.com/s2/favicons)에 요청하며, 실패 시 Chrome 내장 _favicon 캐시를 씁니다. 로컬 파일(file://), localhost, IP 주소, 사내망 호스트 이름은 외부로 보내지 않습니다.
• 중요한 바로가기는 주기적으로 백업 파일(.json)을 내보내 따로 보관하세요. 백업 파일은 암호화되지 않은 일반 텍스트로 주소와 사진이 담기므로 외부 공유나 공용 기기 보관에 유의하시고, 화면 공유 전 새 탭 노출 여부를 확인하세요.
• 본 확장 프로그램은 GPL-3.0-or-later 라이선스에 따라 보증 없이 '있는 그대로(AS IS)' 무상 제공됩니다.

Google과 Chrome은 Google LLC의 상표입니다. Tileshelf는 독립 프로젝트이며 Google LLC와 제휴하거나 후원·보증을 받지 않았습니다.
```

### 그래픽 자산 및 메타데이터 항목

| 항목 | 대시보드 입력 값 / 업로드 파일 | 규격 검증 결과 |
| --- | --- | --- |
| 카테고리 | `Make Chrome Yours` → `Functionality & UI` | 새 탭 UI 확장 분류 일치 |
| 스토어 아이콘 | `src/icons/icon128.png` | `128×128` RGBA (`96×96` 본체 + 사방 `16px` 투명 여백) |
| 스크린샷 1 | `docs/store/screenshots/1-grid-aurora.png` | `1280×800` 24-bit RGB (알파 없음, 타사 상표 0건) |
| 스크린샷 2 | `docs/store/screenshots/2-unified-search.png` | `1280×800` 24-bit RGB (통합 검색 3단 칩 화면) |
| 스크린샷 3 | `docs/store/screenshots/3-settings-theme.png` | `1280×800` 24-bit RGB (라이트 테마 + 배경 설정 서랍) |
| 스크린샷 4 | `docs/store/screenshots/4-sync-history.png` | `1280×800` 24-bit RGB (한국어 다크 테마 + 100단계 기록 서랍) |
| 작은 프로모션 타일 | `docs/store/promo-440x280.png` | `440×280` 24-bit RGB (알파 없음) |
| 홈페이지 URL | `https://github.com/Argoneon1810/Tileshelf` | 공개 저장소 `1.0.0` 푸시 직후 개통 |
| 지원 URL | `https://github.com/Argoneon1810/Tileshelf/issues` | 공개 저장소 `1.0.0` 푸시 직후 개통 |
| 성인 콘텐츠 | `아니오` (`No`) | 해당 없음 |

---

## 3. 개인정보 보호 관행 탭 (`Privacy Practices`)

### 단일 목적 설명 (`Single purpose description`)

```text
This extension has one purpose: replacing Chrome's new tab page with a customizable grid of the user's shortcuts, including built-in search, background appearance settings, and local/Chrome-account backup and sync for that new tab page.
```

### 권한 요청 사유 (`Permission justifications`)

#### `storage`

```text
Stores the user's shortcuts, custom icons, appearance settings, and 100-step checkpoint history in chrome.storage.local, and syncs them via chrome.storage.sync across devices signed into the same Google account.
```

#### `unlimitedStorage`

```text
Allows storing the user's local custom background photo and custom shortcut icon images in chrome.storage.local without failing on the default 10 MB local storage quota.
```

#### `favicon`

```text
Displays website icons on shortcut tiles via Chrome's built-in _favicon cache for intranet/local addresses or whenever a network icon is unavailable.
```

#### `search`

```text
Runs web searches typed into the new tab search bar through the user's configured default search engine via chrome.search.query without modifying browser search settings.
```

### 원격 코드 · 데이터 사용 · 정책 URL

| 항목 | 선택 값 | 코드 검증 근거 |
| --- | --- | --- |
| 원격 코드 사용 여부 (`Remote code`) | **No, I am not using remote code** | `src/ts/` 전 구간에 외부 `<script>`, `eval()`, `new Function()`, 동적 코드 `fetch()`가 전혀 없으며 번들된 정적 ES 모듈만 실행함 (`check-dist.mjs` 검증 통과) |
| 데이터 수집 항목 (`Data usage`) | **`Web history`만 체크** (나머지 모두 해제) | 개발자 서버 수집은 `0건`이나, 공개 `http`/`https` 바로가기의 아이콘 표시 시 도메인 이름이 `www.google.com/s2/favicons`로 전송되고 바로가기 URL이 `chrome.storage.sync`에 저장되므로 보수적으로 `Web history`를 고지해 심사 불일치 거절을 예방함 |
| 데이터 사용 인증 3항목 (`Certifications`) | **3개 모두 체크** | 제3자 판매·광고 금지, 단일 목적 외 사용 금지, 신용·대출 목적 사용 금지 모두 준수 |
| 개인정보처리방침 URL (`Privacy policy URL`) | `https://raw.githubusercontent.com/Argoneon1810/Tileshelf/main/PRIVACY.md` | GitHub `blob` 주소는 스토어 자동 크롤러 요청이 차단되어 거절된 전례(`Tiltfill`)가 있으므로 반드시 `raw.githubusercontent.com` 주소를 사용함 (공개 저장소 `main` 푸시 후 대시보드 제출) |

---

## 4. 테스트 안내 탭 (`Test Instructions`)

로그인 계정 입력란(아이디·비밀번호)은 비워 두고, **Additional instructions**(500자 제한)에 아래 473자 영문 안내를 붙여 넣는다.

```text
No login needed. UI follows Chrome language (English or Korean). 1) Open a new tab and choose "Keep it" if Chrome asks. 2) Complete or skip the welcome guide. 3) Click the "Add" tile, enter a name and URL (e.g. example.com), and save: the shortcut appears in the grid. 4) Type in the search bar to filter shortcuts, go to a URL, or search via Chrome's default engine. 5) Click the top-right gear button: History restores checkpoints and Backup exports a single .json file.
```
