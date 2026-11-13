// 화면 아래쪽 알림. kind: info | success | warning | danger

export type ToastKind = 'info' | 'success' | 'warning' | 'danger';

export interface ToastOptions {
  kind?: ToastKind;
  action?: { label: string; run: () => unknown };
  timeout?: number;
}

export function toast(text: string, { kind = 'info', action, timeout = 5000 }: ToastOptions = {}): () => void {
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.kind = kind;
  el.setAttribute('role', kind === 'danger' ? 'alert' : 'status');
  const dot = document.createElement('i');
  const msg = document.createElement('span');
  msg.textContent = text;
  el.append(dot, msg);

  const close = () => el.remove();
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.textContent = action.label;
    b.addEventListener('click', () => {
      close();
      action.run();
    });
    el.append(b);
  }
  document.getElementById('toasts')!.append(el);
  if (timeout) setTimeout(close, action ? timeout + 3000 : timeout);
  return close;
}
