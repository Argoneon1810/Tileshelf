# 오픈소스 라이선스 고지 및 외부 코드·자산 반입 기준 (`THIRD_PARTY_NOTICES.md`)

이 문서는 **Tileshelf** (`GPL-3.0-or-later`, Copyright (C) 2026 Jinhoon Choi, 공개 저장소 <https://github.com/Argoneon1810/Tileshelf>)의 배포 산출물(`dist/`, `release/tileshelf-*.zip`)과 개발·빌드 환경(`package-lock.json`)에 관련된 오픈소스 라이선스 현황을 밝히고, 저작권·상표권 충돌을 막기 위한 외부 코드·자산 반입 기준을 정의합니다.

---

## 1. 배포 확장 패키지(`dist/`, `release/*.zip`) 내 외부 패키지 및 알고리즘 출처

### 1.1 번들된 외부 npm 패키지: 0건

- 런타임 소스(`src/ts/**/*.ts`, `src/newtab.html`, `src/css/newtab.css`, `src/_locales/*/messages.json`)는 외부 npm 패키지(`dependencies`)를 단 하나도 포함하지 않으며 자체 작성 코드로만 컴파일됩니다.
- 확장 아이콘(`src/icons/icon16.png` ~ `icon128.png`)과 화면 내부 아이콘은 모두 자체 작성한 파이썬 생성 스크립트(`scripts/generate-icons.py`) 및 인라인 SVG입니다.
- 글꼴은 외부 웹폰트를 포함하거나 내려받지 않고 운영체제 기본 시스템 글꼴만 참조합니다.
- 프로젝트 전체는 루트의 [LICENSE](LICENSE)(`GPL-3.0-or-later`)에 따라 배포됩니다.

### 1.2 공개 도메인(CC0) 수학·난수 공식 출처 표기

런타임 그라데이션 렌더링 코드에는 아래 두 건의 공개 도메인(CC0) 수학 공식이 직접 구현되어 있으며, 두 공식 모두 `GPL-3.0-or-later`와 완전 호환됩니다.

| 대상 파일 | 내용 | 원저작자 및 출처 | 라이선스 |
| --- | --- | --- | --- |
| `src/ts/gradient.ts`, `src/ts/aurora.ts` | 선형 sRGB ↔ OKLab 색 공간 변환 행렬 및 역행렬 | Björn Ottosson (<https://bottosson.github.io/posts/oklab/>, 2020) | `CC0-1.0` (Public Domain) / `MIT` 이중 허가 |
| `src/ts/aurora.ts` (`rng`) | 32비트 시드 의사난수 생성기 (`mulberry32`) | Tommy Ettinger (2017) | `CC0-1.0` (Public Domain) |

---

## 2. 개발·빌드·타입 검사 도구 체인(`devDependencies`) 라이선스 명세

아래 패키지들은 개발 시점의 정적 타입 검사 및 JS 변환(`tsc`)에만 쓰이며 **배포용 확장 패키지(`dist/`, `release/*.zip`)에는 포함되지 않습니다.**

| 구분 | 패키지 및 버전 (`package-lock.json` 기준) | 라이선스 | 배포 번들 포함 여부 |
| --- | --- | --- | --- |
| 컴파일러·타입 검사 | `typescript@7.0.2` 및 플랫폼별 `@typescript/typescript-*@7.0.2` 19종 | `Apache-2.0` | 미포함 (빌드·타입 검사 전용) |
| 타입 정의 | `@types/chrome@0.3.6`, `@types/har-format@1.2.16` | `MIT` | 미포함 (타입 검사 전용) |

### 개발 도구 라이선스 고지 요약

- **TypeScript** — Copyright (c) Microsoft Corporation, Licensed under the Apache License, Version 2.0 (<http://www.apache.org/licenses/LICENSE-2.0>).
- **DefinitelyTyped (`@types/*`)** — Copyright (c) respective contributors, Licensed under the MIT License.

---

## 3. 외부 코드·자산 반입 제한 기준

### 3.1 타 새 탭 확장 프로그램 코드 반입 금지

- Chrome 웹 스토어의 상용·비공개 새 탭 확장 프로그램(라이선스 미부여 또는 전권 유보)에서 추출한 마크업, 스크립트, 스타일, 아이콘 자산은 복제·번역·변형 반입을 전면 금지합니다.
- 오픈소스 새 탭 확장(예: `MIT`인 `m8ty/newtab-ext`, `GPL-3.0`인 `victrme/Bonjourr`)이라도 현재 Tileshelf에는 반입된 코드가 **0줄**이며, 향후 일부라도 차용할 경우 원저작자 저작권 표기 및 라이선스 고지 의무를 먼저 충족해야 합니다.
- 자매 프로젝트 `Argoneon1810/Tiltfill` 및 `Argoneon1810/Fadedesk`는 모두 `Jinhoon Choi` 단독 저작물이며 동일하게 `GPL-3.0-or-later`를 따릅니다.

### 3.2 스토어 스크린샷·홍보 이미지 제작 시 반입 금지 자산

스토어 등록용 스크린샷(`1280×800`)과 프로모션 타일(`440×280`)에는 아래 요소를 절대 노출하지 않습니다.

1. **운영체제 기본 배경화면 및 외부 사진**: 로컬 대비 측정용 시험 이미지(`tests/dev/lake.jpg`, `tests/dev/ribbon.jpg` — git 추적 제외)를 비롯한 운영체제 내장 배경화면이나 외부 촬영 사진은 스토어·README 이미지에 사용하지 않으며, Tileshelf 자체 오로라·그라데이션 및 단색 배경만 사용합니다.
2. **제3자 기업·서비스 로고 및 상표명 파비콘**: 실제 상용 서비스(포털, 메신저, 스트리밍, 쇼핑몰 등)의 상표명과 공식 파비콘 대신 예약 도메인(`*.example`)과 일반 작업 이름(예: `Mail`, `Calendar`, `Docs`, `Code Repos`), 자체 제작 기하·모노그램 아이콘만 노출합니다.
