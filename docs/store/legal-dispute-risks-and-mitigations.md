# 인앱·스토어 법적 분쟁 소지 전수 점검 및 예방 조치 명세 (`docs/store/legal-dispute-risks-and-mitigations.md`)

작성일: 2026-11-13 (`0.12.0` 반영 완료)  
목적: `Tileshelf` 공개 출시 전 전수 점검으로 식별한 **잠재적 법적 분쟁·민원·스토어 심사 거절 요인 6가지**의 코드상 근거와 인앱·코드 예방 조치를 기록한다.

---

## 한눈에 보는 6대 분쟁·심사 시비 소지 및 반영 현황 (`0.12.0`)

| 번호 | 분쟁·클레임·심사 시나리오 | 코드상 실제 작동 근거 | `0.12.0` 반영 조치 |
| --- | --- | --- | --- |
| **1** | **동기화 유실 · 확장 삭제 · 용량 한도 초과에 따른 바로가기 손실 민원** | `chrome.storage.sync`는 항목·총량(`100KB`) 한도가 있고, 확장 삭제·계정 초기화 시 Google 계정 동기화 저장소가 비워질 수 있음 | 기기당 `100단계` 변경 기록 로컬+계정 이중 보관, 빈 계정 재채움(`reseed`), 되돌리기 직전 미저장 변경 선행 체크포인트(`sync.restore`), 단일 파일(`.json`) 백업 내장 + 인앱 설정(`#backup-safety-note`, `#legal-note`)·README·스토어에 주기적 백업 권장 및 `GPL-3.0-or-later` 무보증(`AS IS`) 명시 |
| **2** | **평문(`.json`) 백업 파일 유출 및 공용 PC · 화면 공유 시 주소 노출** | 백업 파일은 암호화 없는 UTF-8 JSON으로 바로가기 이름·전체 URL·배경 사진을 담으며, 새 탭을 열면 등록된 바로가기와 검색 결과가 화면에 즉시 표시됨 | 인앱 설정 → 백업(`#backup-safety-note`), `PRIVACY.md`, 한·영 `README`에 평문 백업 파일 외부 공유·공용 기기 보관 주의 및 화면 공유 전 확인 안내 수록 |
| **3** | **Google 파비콘 조회(`s2/favicons`) 시 미완성 입력·사내망 호스트 외부 전송** | 자동 아이콘 표시를 위해 `https://www.google.com/s2/favicons?domain=…&sz=64` 이미지를 불러옴 (`src/ts/images.ts`) | 편집 대화상자 URL 입력 `350ms` 디바운스 적용 + `shouldFetchRemoteFavicon()`으로 다중 라벨 공개 `http:`/`https:` 도메인만 조회하고 `file:`, `localhost`, 사설·공인 IP, 단일 라벨 사내 호스트, 예약 접미사(`.local`, `.internal`, `.lan`, `.corp`, `.home.arpa`, `.test`, `.invalid`, `.example`)는 Chrome 로컬 `_favicon`만 사용하도록 차단 + `PRIVACY.md` 및 스토어 `Web history` 고지 일치 |
| **4** | **악성 스킴(`javascript:`, `data:`) 주입 · 백업 SVG 스크립트 삽입 · 로컬 파일(`file://`) 열기 차단 오해** | 바로가기 입력과 백업 가져오기가 임의 문자열을 받으며, Chrome은 확장 페이지에서 `file://` 링크 직접 클릭 이동을 기본 차단함 (`manifest.json`에 `file:///*` 권한 미요청 원칙 유지) | `isSafeShortcutUrl()`로 `javascript:`·`data:`·`vbscript:`·`blob:` 스킴 원천 차단, `isSafeRasterDataUrl()`로 백업 내 아이콘·배경 이미지를 안전한 래스터 `data:image/(png\|jpe?g\|webp\|gif);base64,…`로만 제한, 전 구간 동적 `innerHTML` 0건 유지 + `file://` 타일 클릭 시 `chrome.tabs.create`/`update` 시도 후 차단되면 `주소 복사` / `Copy URL` 토스트 제공 (`src/ts/ui/open-url.ts`) |
| **5** | **아이콘 · 스토어 스크린샷 · 시험 갤러리의 타사 상표권 · 배경화면 저작권 시비** | 기존 `icon128.png` 여백 미달, `tests/dev/gallery.html`의 타사 상표 20건 및 Windows 기본 배경화면 파생 시험 사진(`lake.jpg`, `ribbon.jpg`) 존재 | 자체 제작 모티프 아이콘을 스토어 규격(`96×96` 본체 + `16px` 투명 여백)으로 재생성(`scripts/generate-icons.py`), 스토어 자산 5종을 RFC 2606 예약 도메인(`*.example`)과 자체 캔버스 도형만으로 촬영(`scripts/generate-store-assets.mjs`), `gallery.html` 타사 상표 전량 중립화, 인앱·문서에 Google LLC 상표 비제휴 고지 명시 |
| **6** | **스토어 이름 충돌 정책 위반 예방** | 일반 기능어 조합 이름은 스토어 기존 확장(`More Shortcuts New Tab`, `More Than 10 Shortcuts`)과 유사할 수 있음 | Chrome 웹 스토어·GitHub 충돌 `0건`인 고유 명칭 **`Tileshelf`** 채택 및 한·영 설명·패키지 일괄 반영 |

---

## 인앱 반영 문구 요약 (`설정` 서랍 하단 및 `백업` 하위 화면)

1. **설정 첫 화면 하단 고지 (`#legal-note` · `settingsLegalFooter`)**:
   - 국문: `GPL-3.0-or-later · 보증 없이 '있는 그대로(AS IS)' 제공됩니다. Google·Chrome은 Google LLC의 상표이며 본 확장과 제휴 관계가 아닙니다.`
   - 영문: `GPL-3.0-or-later · Provided "AS IS" without warranty. Google and Chrome are trademarks of Google LLC, unaffiliated with Tileshelf.`
2. **설정 → 백업 안전 안내 (`#backup-safety-note` · `backupSafetyNote`)**:
   - 국문: `중요한 바로가기는 주기적으로 백업 파일을 내보내 따로 보관하세요. 백업 파일(.json)은 암호화되지 않은 일반 텍스트로 바로가기 주소와 배경 사진이 그대로 담기므로 외부 공유나 공용 기기 보관에 주의하세요.`
   - 영문: `Export backup files periodically to keep an extra copy of important shortcuts. Backup (.json) files store shortcut URLs and photos in unencrypted plain text—keep them private on shared devices.`
3. **로컬 파일(`file://`) 열기 차단 시 복구 토스트 (`toastLocalFileBlocked` + `actionCopyUrl`)**:
   - 국문: `Chrome 보안 정책으로 로컬 파일 바로 열기가 차단되었습니다. 주소를 복사해 주소창에 붙여넣어 주세요.` (`주소 복사`)
   - 영문: `Chrome blocked opening this local file directly. Copy the address and paste it into the address bar.` (`Copy URL`)
