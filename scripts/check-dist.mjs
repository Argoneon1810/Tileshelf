// dist가 홀로 설 수 있는지 검사한다. dist 폴더만 다른 PC로 옮겨 Chrome에 불러오므로,
// 안에서 밖(src, node_modules, 상위 폴더)을 가리키거나 없는 파일을 가리키는 참조가 하나도 없어야 한다.
//
// 보는 참조: manifest의 파일 경로, html의 src·href, css의 url(), js의 import 문과 import().
// 모듈이 아닌 <script>(boot.js처럼 head에서 바로 도는 것)에 import·export가 있으면 Chrome이 오류를 내므로 함께 잡는다.
// 실행: node scripts/check-dist.mjs (npm run build가 마지막에 부른다)

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE_EXT = /\.(html|js|mjs|css|json|png|svg|jpg|jpeg|webp|ico|woff2?)$/i;
const EXTERNAL = /^(https?:|data:|blob:|chrome:|chrome-extension:|mailto:|#|about:)/i;

export function checkDist(dist) {
  const problems = [];
  const files = [...walk(dist)];
  const rel = (f) => relative(dist, f).split(sep).join('/');

  const ref = (from, spec, what) => {
    if (EXTERNAL.test(spec)) return;
    const clean = spec.split(/[?#]/)[0];
    if (!clean) return;
    const target = clean.startsWith('/') ? join(dist, clean) : resolve(dirname(from), clean);
    const r = relative(dist, target);
    if (r.startsWith('..') || resolve(target) === resolve(dist, '..')) {
      problems.push(`${rel(from)}: ${what}가 dist 바깥을 가리킨다: ${spec}`);
    } else if (/\.tsx?$/.test(clean)) {
      problems.push(`${rel(from)}: ${what}가 .js가 아닌 .ts를 가리킨다: ${spec}`);
    } else if (!existsSync(target)) {
      problems.push(`${rel(from)}: ${what}가 없는 파일을 가리킨다: ${spec}`);
    }
  };

  for (const f of files) {
    if (/\.(ts|tsx|map)$/.test(f)) problems.push(`${rel(f)}: dist에 소스 파일이 들어 있다`);
  }

  const manifest = join(dist, 'manifest.json');
  if (!existsSync(manifest)) problems.push('manifest.json이 없다');
  else {
    const manifestJson = JSON.parse(readFileSync(manifest, 'utf8'));
    const visit = (v) => {
      if (typeof v === 'string') {
        if (FILE_EXT.test(v) && !EXTERNAL.test(v)) ref(manifest, v, 'manifest의 경로');
      } else if (v && typeof v === 'object') Object.values(v).forEach(visit);
    };
    visit(manifestJson);

    if (manifestJson.default_locale) {
      const locales = ['en', 'ko'];
      const loaded = {};
      for (const loc of locales) {
        const msgFile = join(dist, '_locales', loc, 'messages.json');
        if (!existsSync(msgFile)) {
          problems.push(`_locales/${loc}/messages.json이 없다`);
          continue;
        }
        const dict = JSON.parse(readFileSync(msgFile, 'utf8'));
        loaded[loc] = dict;
        const desc = dict.extDescription?.message ?? '';
        if (!desc || desc.length > 132) {
          problems.push(`_locales/${loc}/messages.json: extDescription 길이(${desc.length})는 1~132자여야 한다`);
        }
      }
      if (loaded.en && loaded.ko) {
        const enKeys = Object.keys(loaded.en).sort();
        const koKeys = Object.keys(loaded.ko).sort();
        if (JSON.stringify(enKeys) !== JSON.stringify(koKeys)) {
          problems.push('_locales/en과 _locales/ko의 키 목록이 서로 다르다');
        }
        for (const field of ['name', 'description']) {
          const m = typeof manifestJson[field] === 'string' && manifestJson[field].match(/^__MSG_(\w+)__$/);
          if (m && (!loaded.en[m[1]]?.message || !loaded.ko[m[1]]?.message)) {
            problems.push(`manifest.${field}가 가리키는 다국어 키(${m[1]})가 _locales에 없다`);
          }
        }
      }
    }
  }

  for (const f of files.filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(f, 'utf8');
    for (const m of html.matchAll(/\s(?:src|href)\s*=\s*["']([^"']+)["']/g)) ref(f, m[1], 'html의 참조');
    // 모듈이 아닌 외부 스크립트는 import·export 문이 있으면 안 된다
    for (const m of html.matchAll(/<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>/g)) {
      if (/type\s*=\s*["']module["']/.test(m[1] + m[3]) || EXTERNAL.test(m[2])) continue;
      const target = resolve(dirname(f), m[2]);
      if (existsSync(target) && /^\s*(import|export)\b/m.test(readFileSync(target, 'utf8'))) {
        problems.push(`${rel(target)}: 모듈이 아닌 <script>로 불리는데 import·export 문이 있다`);
      }
    }
  }

  for (const f of files.filter((f) => f.endsWith('.css'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) ref(f, m[1], 'css의 url()');
  }

  for (const f of files.filter((f) => /\.m?js$/.test(f))) {
    const js = readFileSync(f, 'utf8');
    const specs = [
      ...js.matchAll(/^\s*(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/gm),
      ...js.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm),
      ...js.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((m) => m[1]);
    for (const s of specs) {
      if (!s.startsWith('.') && !s.startsWith('/')) problems.push(`${rel(f)}: dist에 없는 패키지를 불러온다: ${s}`);
      else ref(f, s, 'import 경로');
    }
  }
  return problems;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  const problems = checkDist(dist);
  console.log(problems.length ? problems.join('\n') : 'dist 참조 검사 통과');
  process.exit(problems.length ? 1 : 0);
}
