import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * GitHub Release 본문(한·영 수동 설치 안내 + CHANGELOG 발췌 + SHA-256 체크섬) 생성기.
 * RELEASE_TAG 환경변수가 주어지면(예: v1.0.0) src/manifest.json의 판 번호와 일치하는지 검증한다.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'manifest.json'), 'utf8'));
const version = manifest.version;
const allowedTags = new Set([`v${version}`]);
if (typeof manifest.version_name === 'string' && manifest.version_name.trim()) {
  allowedTags.add(`v${manifest.version_name.trim()}`);
}
const actualTag = process.env.RELEASE_TAG || `v${version}`;

if (!allowedTags.has(actualTag)) {
  console.error(
    `[FAIL] 태그(${actualTag})와 src/manifest.json 판 번호(${[...allowedTags].join(' 또는 ')})가 일치하지 않습니다.`,
  );
  process.exit(1);
}

const zipName = `tileshelf-${version}.zip`;
const zipRelPath = `release/${zipName}`;
const zipFullPath = path.join(ROOT, 'release', zipName);

if (!fs.existsSync(zipFullPath)) {
  console.error(`[FAIL] 패키지 산출물을 찾을 수 없습니다: ${zipFullPath} (먼저 npm run package를 실행하세요)`);
  process.exit(1);
}

const zipBuffer = fs.readFileSync(zipFullPath);
const sha256 = crypto.createHash('sha256').update(zipBuffer).digest('hex');

function extractChangelogForVersion(ver) {
  const changelogPath = path.join(ROOT, 'CHANGELOG.md');
  if (!fs.existsSync(changelogPath)) return '';
  const lines = fs.readFileSync(changelogPath, 'utf8').split(/\r?\n/);
  const matchedBlocks = [];
  let collecting = false;
  let current = [];

  const headerRe = /^##\s+(\d+\.\d+\.\d+)\b/;
  for (const line of lines) {
    const m = line.match(headerRe);
    if (m) {
      if (collecting && current.length > 0) {
        matchedBlocks.push(current.join('\n').trim());
      }
      if (m[1] === ver) {
        collecting = true;
        current = [`### ${line.replace(/^##\s+/, '')}`];
      } else {
        collecting = false;
        current = [];
      }
    } else if (collecting) {
      current.push(line);
    }
  }
  if (collecting && current.length > 0) {
    matchedBlocks.push(current.join('\n').trim());
  }
  return matchedBlocks.join('\n\n');
}

const changelogExcerpt = extractChangelogForVersion(version);

const firstReleaseSummary =
  version === '1.0.0'
    ? [
        '',
        '### 주요 포함 기능 (1.0.0 첫 정식 판)',
        '- **개수 제한 없는 바로가기 격자**: 드래그 정렬, 커스텀 아이콘 이미지, 로컬 파일(`file://`) 경로 및 원클릭 주소 복사 지원',
        '- **가입 없는 Google 계정 동기화 & 100단계 변경 기록**: 별도 서버 없이 기기 간 자동 동기화 및 기기별 100단계 시점 복원',
        '- **단일 파일(`.json`) 통합 백업**: 바로가기, 아이콘, 화면 설정, 내 사진 배경을 파일 하나로 내보내기·불러오기',
        '- **WebGL 그라데이션 & 실측 5:1 가독성**: 9가지 강조색 × 4가지 구도 그라데이션, 단색, 내 사진 배경 및 `배경 막`·`반투명 카드`·`그림자 효과`',
        '- **한·영 통합 검색창**: 바로가기 필터, 주소 직접 이동, Chrome 기본 검색 엔진 웹 검색 통합 (한국어·영어 자동 전환)',
      ].join('\n')
    : '';

const notes =
  [
    `## 바로 설치하기 (ZIP 수동 설치 · 빌드 도구 불필요)`,
    ``,
    `Chrome 웹 스토어 심사를 기다리는 동안이나 오프라인 환경에서 소스 빌드 없이 바로 설치해 쓸 수 있는 공식 패키지입니다.`,
    ``,
    `1. 아래 **Assets**에서 **\`${zipName}\`** 파일을 내려받아 지우지 않을 폴더(예: \`Documents\\Tileshelf\`)에 **압축을 풉니다**.`,
    `2. Chrome 주소창에 \`chrome://extensions\`를 입력해 이동한 뒤 오른쪽 위 **개발자 모드(Developer mode)** 를 켭니다.`,
    `3. 왼쪽 위 **압축해제된 확장 프로그램을 로드합니다(Load unpacked)** 를 누르고 방금 압축을 푼 폴더(\`manifest.json\`이 들어 있는 폴더)를 선택합니다.`,
    ``,
    `---`,
    ``,
    `## Quick Manual Install (Unpacked ZIP · No Node.js Needed)`,
    ``,
    `1. Download **\`${zipName}\`** from **Assets** below and extract it into a permanent folder.`,
    `2. Open \`chrome://extensions\` in Chrome and toggle **Developer mode** on (top-right corner).`,
    `3. Click **Load unpacked** (top-left) and select the extracted folder containing \`manifest.json\`.`,
    ``,
    `---`,
    ``,
    `## 바뀐 내역 (Changelog)`,
    ``,
    changelogExcerpt || `- [CHANGELOG.md](./CHANGELOG.md) 참고`,
    firstReleaseSummary,
    ``,
    `---`,
    ``,
    `### 파일 무결성 (SHA-256)`,
    ``,
    `- \`${zipName}\`: \`${sha256}\``,
  ]
    .filter((v) => v !== '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n') + '\n';

const notesRelPath = `release/release-notes-${version}.md`;
const notesFullPath = path.join(ROOT, 'release', `release-notes-${version}.md`);
fs.writeFileSync(notesFullPath, notes, 'utf8');

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `version=${version}\nzip_path=${zipRelPath}\nnotes_path=${notesRelPath}\n`,
    'utf8',
  );
}

console.log(`[PASS] Generated release notes for ${actualTag}: ${notesRelPath}`);
console.log(`       Archive: ${zipRelPath} (SHA-256: ${sha256})`);
