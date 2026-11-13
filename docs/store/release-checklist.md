# 스토어 및 공개 저장소 출시 점검표 (`docs/store/release-checklist.md`)

`Tileshelf 1.0.0` 공개 GitHub 저장소(`Argoneon1810/Tileshelf`) 및 Chrome 웹 스토어 제출 점검표다.

---

## 1. 출시 준비 완료 항목 (`1.0.0`)

- [x] **고유 이름 확정 (`Tileshelf`)**: Chrome 웹 스토어 및 GitHub 내 이름 충돌 `0건` 확인 (`competitors.md`).
- [x] **한·영 다국어 지원 (`en` 기본 + `ko`)**: `src/_locales/en/messages.json`, `src/_locales/ko/messages.json`, `src/ts/i18n.ts` 및 단위 시험(`tests/i18n.test.mjs`) 통과.
- [x] **보안·프라이버시·동기화 무결성 강화**:
  - 위험 스킴(`javascript:`, `data:`, `vbscript:`, `blob:`) 및 비래스터 이미지 데이터 원천 차단 (`src/ts/store.ts`, `src/ts/backup.ts`).
  - `file://` 로컬 파일 바로가기 클릭 시 탭 이동 시도 및 차단 시 `주소 복사` / `Copy URL` 안내 토스트 제공 (`src/ts/ui/open-url.ts`).
  - `s2/favicons` 외부 조회 `350ms` 디바운스 및 미완성·로컬·IP·사내망 호스트 전송 차단 (`src/ts/images.ts`).
  - 기록 되돌리기 직전 미저장 변경 선행 체크포인트 보존 및 동일 시각 역전 방지 (`src/ts/sync.ts`).
  - 검색창 한글 조합 확정 `Enter` 시 초점 이탈 방지 (`src/ts/ui/results.ts`).
- [x] **법적 고지 및 라이선스 완비**: 루트 `LICENSE`(`GPL-3.0-or-later`), `THIRD_PARTY_NOTICES.md`, `PRIVACY.md`, `docs/store/legal-dispute-risks-and-mitigations.md`, 인앱 `#backup-safety-note`·`#legal-note` 반영.
- [x] **스토어 규격 아이콘 및 홍보 그래픽 생성**:
  - `src/icons/icon{16,32,48,128}.png` (`icon128.png`: `96×96` 본체 + 사방 `16px` 투명 여백).
  - `docs/store/promo-440x280.png` 및 `docs/store/screenshots/1..4.png` (24-bit RGB, 타사 상표 `0건`).
- [x] **자동 릴리스 파이프라인**: `scripts/package.mjs`, `scripts/generate-release-notes.mjs`, `.github/workflows/release.yml` (Node.js 24 기준 타입·단위 시험 + `release/tileshelf-<버전>.zip` 자동 배포).

---

## 2. Chrome 웹 스토어 대시보드 제출 순서

1. `https://raw.githubusercontent.com/Argoneon1810/Tileshelf/main/PRIVACY.md` 페이지가 정상(`HTTP 200`) 열리는지 확인한다.
2. [Chrome 웹 스토어 개발자 대시보드](https://chrome.google.com/webstore/devconsole)에서 **새 항목**으로 `release/tileshelf-1.0.0.zip`을 업로드한다.
3. `docs/store/listing.md`에 적힌 정본 값을 **패키지 · 스토어 등록정보(English + 한국어) · 개인정보 보호 관행 · 테스트 안내** 탭에 차례로 입력하고 심사를 제출한다.
4. 대시보드가 부여한 32자리 스토어 확장 ID가 확정되면 `README.md`와 `README.en.md`의 Chrome 웹 스토어 링크에 반영한다.
