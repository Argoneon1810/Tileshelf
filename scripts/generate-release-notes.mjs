import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * GitHub Release 본문(README 설치 절 안내 + CHANGELOG 발췌 + SHA-256 체크섬) 생성기.
 * RELEASE_TAG 환경변수가 주어지면(예: v1.0.0) src/manifest.json의 판 번호와 일치하는지 검증한다.
 * PUBLISHED_TAGS(이미 공개된 릴리스 태그 목록, 줄·공백 구분)가 주어지면, 그중 이번 판보다 작은 가장 큰 판
 * 다음부터 이번 판까지의 CHANGELOG 절을 모두 싣는다(공개하지 않은 중간 판의 변화도 빠지지 않게).
 * 주어지지 않으면 이번 판의 절만 싣는다.
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

// '1.2.10' 꼴 판 번호 비교. 음수면 a가 먼저
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

// 이미 공개된 판 가운데 이번 판보다 작은 가장 큰 판. 없으면 null
function previousPublishedVersion(ver) {
  const tags = (process.env.PUBLISHED_TAGS || '').split(/\s+/).filter(Boolean);
  const older = tags
    .map((t) => t.match(/^v(\d+\.\d+\.\d+)$/)?.[1])
    .filter((v) => v && compareVersions(v, ver) < 0)
    .sort(compareVersions);
  return older.length ? older[older.length - 1] : null;
}

// prev 다음부터 ver까지의 절(prev가 null이면 ver 절 하나)
function extractChangelogForVersion(ver, prev = null) {
  const inRange = (v) => (prev ? compareVersions(v, prev) > 0 && compareVersions(v, ver) <= 0 : v === ver);
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
      if (inRange(m[1])) {
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

const prevPublished = previousPublishedVersion(version);
const changelogExcerpt = extractChangelogForVersion(version, prevPublished);

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
    // 설치·업데이트 방법은 README의 설치 절 한 곳에만 둔다(두 곳에 두면 어긋난다). 문구는 개발자가 Gemini에게 받아 온 것.
    // 빈 줄('')은 아래 filter가 지우므로 한 덩어리 안에 넣는다. --- 바로 위에 글 줄이 붙으면 Markdown이 그 줄을 제목으로 만든다
    `아래 ZIP 파일로 새로 설치하거나 기존 폴더에 덮어써서 업데이트하는 방법은 [README의 설치하기 안내](https://github.com/Argoneon1810/Tileshelf#설치하기)를 참고해 주세요.\n\n` +
      `For instructions on installing the ZIP file below or updating an existing installation, please see the [Installation guide in the README](https://github.com/Argoneon1810/Tileshelf/blob/main/README.en.md#installation).\n`,
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
