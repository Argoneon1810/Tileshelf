// 계정 동기화 저장소(chrome.storage.sync)에 넣을 값을 압축하고 조각내고 다시 합치는 순수 함수 모음.
// 브라우저 API에 기대지 않아서 node에서 그대로 시험할 수 있다.
//
// chrome.storage.sync 한도 (https://developer.chrome.com/docs/extensions/reference/api/storage)
//   항목 하나: 키 길이 + JSON.stringify(값) 길이 ≤ 8192 바이트
//   전체: 102400 바이트
// 값 하나를 gzip → base64로 바꾼 뒤 7000자씩 잘라 <앞말>0, <앞말>1, … 키에 나눠 담는다.
// 조각마다 판(rev)을 앞에 붙여서, 다른 PC에 조각이 나뉘어 도착하는 동안 섞인 상태를 합치지 않게 한다.

export const ITEM_LIMIT = 8192;
export const TOTAL_LIMIT = 102400;
export const CHUNK_CHARS = 7000;

export type SyncItems = Record<string, unknown>;

export type QuotaProblem =
  | { reason: 'item'; key: string; bytes: number; limit: number }
  | { reason: 'total'; bytes: number; limit: number };

export function itemBytes(key: string, value: unknown): number {
  return key.length + new TextEncoder().encode(JSON.stringify(value)).length;
}

export function totalBytes(items: SyncItems): number {
  return Object.entries(items).reduce((sum, [k, v]) => sum + itemBytes(k, v), 0);
}

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(str: string): Uint8Array<ArrayBuffer> {
  const s = atob(str);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

export async function encode(value: unknown): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(value));
  return toBase64(await pipe(json, new CompressionStream('gzip')));
}

export async function decode<T = unknown>(str: string): Promise<T> {
  const json = await pipe(fromBase64(str), new DecompressionStream('gzip'));
  return JSON.parse(new TextDecoder().decode(json)) as T;
}

// 인코딩된 문자열을 prefix0, prefix1, … 조각으로 나눈다. n은 조각 수.
export function splitChunks(encoded: string, prefix: string, rev: string): { items: SyncItems; n: number } {
  const items: SyncItems = {};
  let n = 0;
  for (let i = 0; i < encoded.length; i += CHUNK_CHARS) {
    items[prefix + n] = rev + ':' + encoded.slice(i, i + CHUNK_CHARS);
    n++;
  }
  return { items, n };
}

// 조각들로 인코딩 문자열을 되살린다. 조각이 빠졌거나 다른 판의 조각이 섞여 있으면 null.
export function joinChunks(items: SyncItems, prefix: string, rev: string, n: number): string | null {
  const head = rev + ':';
  let out = '';
  for (let i = 0; i < n; i++) {
    const part = items[prefix + i];
    if (typeof part !== 'string' || !part.startsWith(head)) return null;
    out += part.slice(head.length);
  }
  return out;
}

// prefix 조각 중 n번 이상(새 판에는 없는 것)의 키
export function staleChunks(items: SyncItems, prefix: string, n: number): string[] {
  return Object.keys(items).filter((k) => k.startsWith(prefix) && /^\d+$/.test(k.slice(prefix.length)) && Number(k.slice(prefix.length)) >= n);
}

// 쓰기 전에 한도를 넘는지 확인한다. 넘으면 이유를 담은 객체를, 괜찮으면 null을 돌려준다.
export function checkQuota(items: SyncItems): QuotaProblem | null {
  for (const [k, v] of Object.entries(items)) {
    const b = itemBytes(k, v);
    if (b > ITEM_LIMIT) return { reason: 'item', key: k, bytes: b, limit: ITEM_LIMIT };
  }
  const total = totalBytes(items);
  if (total > TOTAL_LIMIT) return { reason: 'total', bytes: total, limit: TOTAL_LIMIT };
  return null;
}
