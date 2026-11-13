// 아이콘·배경 이미지 처리와 자동 아이콘 주소.

import { t } from './i18n.ts';

export function readFile(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(t('errImageRead')));
    img.src = src;
  });
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t('errImageProcess'));
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

// 직접 고른 아이콘은 64×64 안에 비율을 지켜 넣고 webp로 줄인다.
// 계정 동기화 한도(100KB)를 아끼려는 것이다. 보통 2~5KB가 된다.
export async function makeIcon(dataUrl: string, size = 64): Promise<string> {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const scale = Math.min(size / img.width, size / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  context2d(canvas).drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return canvas.toDataURL('image/webp', 0.85);
}

// 배경 사진은 긴 변을 2560px 이하로 줄여 jpeg로 저장한다.
export async function makeBackground(dataUrl: string, maxSide = 2560): Promise<string> {
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  context2d(canvas).drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.88);
}

const NON_PUBLIC_HOST_SUFFIX = /\.(?:local|internal|lan|corp|home\.arpa|intranet|localdomain|test|invalid|example)$/i;
const EXAMPLE_SECOND_LEVEL = /^(?:.+\.)?example\.(?:com|org|net)$/i;

// 공개 웹 도메인(http/https + 유효한 최상위 도메인)일 때만 외부 파비콘 조회용 호스트를 돌려준다.
// 타이핑 중인 미완성 주소(naver.c), 로컬 파일(file://), localhost, IP, 사설 접미사는 제외한다.
export function shouldFetchRemoteFavicon(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.localhost')) return null;
    if (host.startsWith('.') || host.endsWith('.') || !host.includes('.')) return null;
    if (/^\d+(?:\.\d+){3}$/.test(host) || host.startsWith('[') || host.includes(':')) return null;
    if (NON_PUBLIC_HOST_SUFFIX.test(host) || EXAMPLE_SECOND_LEVEL.test(host)) return null;
    const tld = host.split('.').pop() ?? '';
    if (!/^(?:[a-z]{2,}|xn--[a-z0-9-]{2,})$/i.test(tld)) return null;
    return host;
  } catch {
    return null;
  }
}

// 자동 아이콘은 공개 도메인일 때만 Google 아이콘 서비스를 먼저 쓰고, 나머지와 실패 시에는 Chrome 내장 아이콘을 쓴다.
export function autoIconSources(url: string): string[] {
  const list: string[] = [];
  const host = shouldFetchRemoteFavicon(url);
  if (host) {
    list.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`);
  }
  if (typeof globalThis.chrome?.runtime?.getURL === 'function') {
    list.push(chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=64`));
  }
  return list;
}
