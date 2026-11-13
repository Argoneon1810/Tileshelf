// 빌드: dist를 비우고, tsc로 src의 스크립트를 내보낸 뒤, 나머지 파일(manifest, html, css, 아이콘)을 복사한다.
// 마지막에 dist 안의 모든 참조가 dist 안의 실제 파일을 가리키는지 검사하고, 아니면 실패한다.
// 실행: npm run build

import { spawnSync } from 'node:child_process';
import { cpSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDist } from './check-dist.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });

const tscBin = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const tsc = spawnSync(process.execPath, [tscBin, '-p', root], { stdio: 'inherit' });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

// 스크립트는 tsc가 내보냈으니, 그 밖의 파일만 복사한다
for (const file of walk(src)) {
  if (/\.(ts|js)$/.test(file)) continue;
  cpSync(file, join(dist, relative(src, file)));
}

const problems = checkDist(dist);
if (problems.length) {
  console.error('dist 참조 검사 실패:\n' + problems.map((p) => '  ' + p).join('\n'));
  process.exit(1);
}
console.log('빌드 완료: dist/ (바깥 참조 없음)');

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}
