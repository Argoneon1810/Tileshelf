// 스토어에 올릴 zip 만들기: dist의 내용물을 zip 맨 위에 담아 release/tileshelf-<버전>.zip으로 만든다.
// 스토어는 manifest.json이 zip 맨 위에 있어야 받는다. dist 폴더째 압축하면 한 단계 아래로 들어가 거절당한다.
// manifest에서 두 칸을 뺀다. key는 첫 업로드에서 거절당하고(스토어가 ID를 새로 정한다), version_name의 -dev는 사용자에게 보일 이름이 아니다.
// 실행: npm run package (빌드부터 한다). zip을 쓰는 도구를 따로 깔지 않으려고 형식을 직접 쓴다.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const release = join(root, 'release');

// 날짜를 고정한다. 같은 소스에서 만든 zip은 언제 만들어도 같은 파일이 된다.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
delete manifest.key;
delete manifest.version_name;

const parts = [];
const central = [];
let offset = 0;
const names = walk(dist);
for (const name of names) {
  const data = name === 'manifest.json' ? Buffer.from(JSON.stringify(manifest, null, 2)) : readFileSync(join(dist, name));
  const packed = zlib.deflateRawSync(data, { level: 9 });
  const nameBytes = Buffer.from(name, 'utf8');
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4); // 풀 때 필요한 판
  head.writeUInt16LE(0x0800, 6); // 이름이 UTF-8이다
  head.writeUInt16LE(8, 8); // deflate
  head.writeUInt16LE(DOS_TIME, 10);
  head.writeUInt16LE(DOS_DATE, 12);
  head.writeUInt32LE(zlib.crc32(data), 14);
  head.writeUInt32LE(packed.length, 18);
  head.writeUInt32LE(data.length, 22);
  head.writeUInt16LE(nameBytes.length, 26);
  parts.push(head, nameBytes, packed);

  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4);
  head.copy(entry, 6, 4, 30); // 판, 표시, 방식, 시각, CRC, 크기, 이름 길이
  entry.writeUInt32LE(offset, 42);
  central.push(entry, nameBytes);
  offset += head.length + nameBytes.length + packed.length;
}

const centralBytes = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(names.length, 8);
end.writeUInt16LE(names.length, 10);
end.writeUInt32LE(centralBytes.length, 12);
end.writeUInt32LE(offset, 16);

mkdirSync(release, { recursive: true });
const out = join(release, `tileshelf-${manifest.version}.zip`);
writeFileSync(out, Buffer.concat([...parts, centralBytes, end]));
console.log(`${out} (파일 ${names.length}개)`);

function walk(dir, base = '') {
  const list = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) list.push(...walk(join(dir, entry.name), rel));
    else list.push(rel);
  }
  return list.sort();
}
