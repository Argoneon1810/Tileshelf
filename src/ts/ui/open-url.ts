// Chrome 보안 정책상 새 탭(chrome-extension://)의 일반 링크로는 로컬 파일(file://)을 열 수 없다.
// chrome.tabs로 이동을 시도하고, 차단되면 주소를 복사할 수 있는 안내 알림을 띄운다.

import { toast } from './toast.ts';
import { t } from '../i18n.ts';

export function isLocalFileUrl(url: string): boolean {
  return url.trim().toLowerCase().startsWith('file:');
}

export async function openLocalFileUrl(url: string, openInNewTab: boolean): Promise<void> {
  try {
    if (!globalThis.chrome?.tabs) throw new Error('no-tabs-api');
    if (openInNewTab) await chrome.tabs.create({ url });
    else await chrome.tabs.update({ url });
  } catch {
    toast(t('toastLocalFileBlocked'), {
      kind: 'warning',
      timeout: 8000,
      action: {
        label: t('actionCopyUrl'),
        run: async () => {
          try {
            await navigator.clipboard.writeText(url);
            toast(t('toastUrlCopied'), { kind: 'success' });
          } catch {
            /* 클립보드 접근이 제한된 환경이면 조용히 넘긴다 */
          }
        },
      },
    });
  }
}
