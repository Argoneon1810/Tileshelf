# 역할이 같거나 겹치는 앱 조사 및 명칭 결정 기록 (`docs/store/competitors.md`)

스토어 이름 충돌 방지와 차별점 정리를 위해 조사한 경쟁·유사 새 탭 확장 목록과 최종 명칭 결정 기록이다.

## 명칭 결정 요약 (`2026-11-13` 확정)

- 일반 기능어 조합 이름은 스토어 기존 확장인 `More Shortcuts New Tab`, `More Than 10 Shortcuts`(약 6천 명)와 겹쳐 혼동 유발 정책 위반 위험이 있었다.
- Chrome 웹 스토어와 GitHub 전역 검색에서 충돌이 `0건`인 고유 이름 **`Tileshelf`**로 최종 확정했다(`src/manifest.json`, `_locales/{en,ko}/messages.json`, `PRIVACY.md`, `README.md`, `README.en.md` 일괄 반영 완료).
- 경쟁 앱 대비 사실 확인 기준:
  - 별도 서비스 가입 없이 `chrome.storage.sync`를 쓰는 앱(Minimalist Speed Dial, DevX New Tab 등)이 이미 있으므로 설명문에 "유일하다"는 단정은 쓰지 않는다.
  - 대신 `Tileshelf`가 실제로 갖춘 조합 — **가입 없는 Google 계정 동기화 + 기기별 100단계 델타 변경 기록·되돌리기 + 배경 사진 포함 단일 파일(`.json`) 백업 + 실측 대비 5:1 이상 가독성 모드 + 한·영 통합 검색창** — 을 담백하게 기술한다.

---

## 유사·경쟁 확장 목록 (2026-10-31 1차 조사 기준)

등급 A는 바로가기 격자가 중심인 새 탭, B는 다른 위젯 기능이 함께 큰 새 탭이다.

| 등급 | 앱 | 사용자 / 평점 | 바로가기 수 | 동기화와 가입 | 백업 | 출처 |
|---|---|---|---|---|---|---|
| A | More Than 10 Shortcuts | 약 6천 명 | 10개 초과 | 파일로 옮김. 기기 간 동기화가 안 된다는 리뷰 있음 | JSON 내보내기 | [스토어](https://chromewebstore.google.com/detail/more-than-10-shortcuts/lfokhaobghfencjnlpfkhkdbaglcjace) |
| A | More Shortcuts New Tab | | 최대 30개 | | | [스토어](https://chromewebstore.google.com/detail/more-shortcuts-new-tab/kogaidjbbpniklkafmfbgmihfdmkjkaf?hl=ko) |
| A | SuperTab — Unlimited Shortcuts | | 제한 없음 | 설명에 언급 없음 | Chrome 바로가기 가져오기 | [스토어](https://chromewebstore.google.com/detail/supertab-—-unlimited-shor/lcmilkdkganpocmgkicgjlahdlilgedi) |
| A | Shortcut — Unlimited shortcuts to your homepage | | 제한 없음(이름 기준) | | | [스토어](https://chromewebstore.google.com/detail/shortcut-—-unlimited-shor/haldhepimlnimlglfpnpnajppookahkd) |
| A | Unlimited Chrome Shortcuts | | 10개 초과 | | | [스토어](https://chromewebstore.google.com/detail/unlimited-chrome-shortcut/cnjlcgimlbkpfcbdgdofemdkoiabmgkf) |
| A | Neatab | | 제한 없음 | 북마크 폴더를 만들어 로그인한 기기에 전달 | | [스토어](https://chromewebstore.google.com/detail/neatab/hhcielcjkghlcpdgiodjdoopcmepbhhb) |
| A | Minimalist Speed Dial | 약 185명 | | Chrome Sync(선택) | | [스토어](https://chromewebstore.google.com/detail/minimalist-speed-dial-new/hmhinmkabjngondeikjmjcmklbkahgnl) |
| A | Launchpad New Tab | | 제한 없음, 묶음 | | | [chromeboard](https://chromeboard.com/extension/launchpad-new-tab-shortcu-jfmmagapjdionoomkjmkfppcplkjilnp) |
| A | Custom Shortcut Grid | | 8줄까지 | | | [chromeboard](https://chromeboard.com/extension/custom-shortcut-grid-mjjpaloegbnjnkemhajhgnimblaffgoo) |
| A | Speed Dial 2 | 약 30만 명 / 4.1 (약 7.7천) | 제한 없음 | 유료 Pro 계정 | 무료는 수동 내보내기 | [스토어](https://chromewebstore.google.com/detail/speed-dial-2-new-tab/jpfpebmajhhopeonhlcgidhclcccjcik?hl=hy) |
| A | Speed Dial [FVD] | 약 50만 명 / 4.7 (약 11.8만) | | FVD 계정 | | [스토어](https://chromewebstore.google.com/detail/llaficoajjainaijghjlofdfmbjpebpa?hl=ml) |
| A | Group Speed Dial | 약 3만 명 / 4.5 (321) | | 클라우드 계정(기본 꺼짐) | 있다는 비교 글 | [스토어](https://chrome.google.com/webstore/detail/imfeikbeimbfpmgfkkmjekabdehiiajc) |
| A | DevX New Tab (오픈 소스, MIT) | | | `chrome.storage.sync`, 계정 없음 | | [GitHub](https://github.com/m8ty/newtab-ext) |
| A | NewTab++, homegrid, Panda Speed Dial | | | | | [NewTab++](https://chromewebstore.google.com/detail/newtab++/okmjkadnpjgfdlieakedebnflkggndfi), [homegrid](https://chromeboard.com/extension/homegrid-gpkbhcbjjacfafgjeodnconafdbioogc), [Panda](https://chromeboard.com/extension/panda-speed-dial-–-new-ta-nncmpcdlmkbimfjocjhcnkmjabejaaln) |
| B | Infinity New Tab | 수십만 명 이상(비교 글) | 기본 제한을 푼다고만 나옴 | 자기 계정(Google 등으로 로그인) | 클라우드 | [비교 글](https://webcatalog.io/en/blog/webcatalog-vs-infinity-new-tab) |
| B | Momentum | 200만 명 이상 / 4.5 (2차 출처) | 링크 위젯 | 무료 계정 | 계정 기반 | agy 시험 결과 |
| B | WeTab | 평점 약 4.0 (364) | | 계정(전화번호 가입 불만 있음) | | [extscope](https://www.extscope.org/extension/aikflfpejipbpjdlfabpgclhblkpaafo) |
| B | Bonjourr (오픈 소스, GPL-3.0) | | 빠른 링크, 폴더 | 계정 불필요, 설정 동기화 있다고 나옴(경쟁사 글) | 가져오기, 내보내기 | [비교 글](https://webcatalog.io/en/blog/webcatalog-vs-bonjourr) |
| B | Tabliss | | 빠른 링크 | 기기 간 빠른 링크가 덮어써진다는 리뷰 | 가져오기, 내보내기 | [Firefox 리뷰](https://addons.mozilla.org/es/firefox/addon/tabliss) |
| B | Mue, Foxy Tabs, Custom New Tab by NBYTE, NovaTab | | | | | [Foxy](https://chromewebstore.google.com/detail/foxy-tabs-modern-new-tab/legkgkghbgdnjniakjhbecfiohcapejh?hl=ko), [NBYTE](https://chromewebstore.google.com/detail/custom-new-tab-by-nbyte/dmojgfbcdbcodhkbhjaonahnbkgjbnkc) |
