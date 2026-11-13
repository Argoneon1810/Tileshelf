=== COLOR PRESET (binding for all subsequent design) ===
Mode(s): both — 판 톤은 시스템 따라감(기본), 설정에서 어두운/밝은 유리 고정 가능
Key/primary:        #4c88d3   버튼 채움 #3a75bf  on-primary #ffffff (4.69:1)
Focus ring:         dark #6aa7f4 (6.8:1)  /  light #3a75bf (4.37:1)
Secondary/accent:   장밋빛  dark #e176a1 (5.88:1)  /  light #ae4974 (4.88:1)
Glass (dark):       #191d23   text #ebeff4 (14.64:1)  muted #a9aeb6 (7.58:1)
Glass (light):      #f4f7fb   text #1d2229 (14.87:1)  muted #585e66 (6.09:1)
Default background: #29323c (ramp 900, 사진이 없을 때)
Neutral ramp:       50 #eef6ff 100 #e3eefd 200 #d5dfee 300 #c2cddb 400 #acb7c5 500 #959fac
                    600 #7b8592 700 #606a76 800 #454e59 900 #29323c 950 #0f1720
States:             success btn #258343 / on-dark #5cb572
                    warning btn #a36500 / on-dark #d0901e
                    danger  btn #c74b43 / on-dark #f27166  (흰 글씨 4.65~4.77:1)
Photo legibility:   사진 전체에 검정 24% 덮기(설정에서 조절), 바로가기 이름은 흰색 + 그림자
Notes:              보조색은 '새로 추가됨' 점과 끌어서 놓을 자리에만 사용
=== END COLOR PRESET ===

--- 0.2.0에서 추가 ---
Accent presets (그라데이션 배경용, OKLCH에서 골라 hex로 변환):
  블루 #4087de 퍼플 #9163d5 핑크 #df5e97 레드 #db4241 오렌지 #e87f25
  옐로 #ecbe24 그린 #3eab5e 틸 #12a7a7 그래파이트 #767b80
Custom-color wheel: #ee79a1 #e78b30 #99b234 #00c2a8 #30aff8 #b48df4 (OKLCH L .72 C .15, 60°마다)
Gradient (0.3.0~): extension/js/aurora.js가 강조색의 색상각·채도로 팔레트를 만들어 캔버스에 그린다.
  어두운 판: 바탕 OKLab L .17/.12, 빛 L .60(주)/.53/.50/.30, 하이라이트 L .76
  밝은 판: 바탕 L .975/.952, 번짐 L .83/.86/.875/.80
  바로가기 자리(조용한 구역)는 바탕 쪽으로 되돌린다 (어두운 판 62%, 밝은 판 30%).
  대비는 tests/dev/label-contrast.mjs로 이름 뒤 배경을 실측한다 (기준 5:1).

모든 색은 mcp-color-convert 0.1.3으로 계산했고, 괄호 안 수치는 해당 판 배경 대비 명암비다.
대비 기준: 본문 글씨 4.5:1, 아이콘·테두리 등 UI 요소 3:1.
