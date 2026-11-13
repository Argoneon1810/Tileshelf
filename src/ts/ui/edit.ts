// 바로가기 추가·편집 대화상자.

import { normalizeUrl, isSafeShortcutUrl } from '../store.ts';
import { hostLabel } from '../backup.ts';
import { readFile, makeIcon } from '../images.ts';
import { fillIcon } from './grid.ts';
import { toast } from './toast.ts';
import { t } from '../i18n.ts';
import type { Store } from '../store.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

export class EditDialog {
  // iconData: undefined는 그대로 두기, null은 자동 아이콘, 문자열은 새로 고른 아이콘
  store: Store;
  dlg: HTMLDialogElement;
  name: HTMLInputElement;
  url: HTMLInputElement;
  error: HTMLElement;
  icon: HTMLElement;
  #id: string | null = null;
  #iconData: string | null | undefined = undefined;
  #previewTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(store: Store) {
    this.store = store;
    this.dlg = $<HTMLDialogElement>('edit');
    this.name = $<HTMLInputElement>('edit-name');
    this.url = $<HTMLInputElement>('edit-url');
    this.error = $('edit-error');
    this.icon = $('edit-icon');

    this.dlg.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      this.#save();
    });
    this.dlg.addEventListener('close', () => clearTimeout(this.#previewTimer));
    this.url.addEventListener('input', () => {
      this.error.textContent = '';
      clearTimeout(this.#previewTimer);
      if (this.#currentCustom() || !this.url.value.trim()) this.#preview();
      else this.#previewTimer = setTimeout(() => this.#preview(), 350);
    });
    this.name.addEventListener('input', () => this.#preview());
    $('edit-icon-pick').addEventListener('click', () => $('edit-icon-file').click());
    $('edit-icon-file').addEventListener('change', async (e) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      try {
        this.#iconData = await makeIcon(await readFile(file));
        this.#preview();
      } catch (err) {
        this.error.textContent = (err as Error).message;
      }
    });
    $('edit-icon-auto').addEventListener('click', () => {
      this.#iconData = null;
      this.#preview();
    });
    $('edit-delete').addEventListener('click', () => this.#remove());
  }

  open(id: string | null = null): void {
    clearTimeout(this.#previewTimer);
    this.#id = id;
    this.#iconData = undefined;
    const s = id ? this.store.shortcuts.find((x) => x.id === id) : null;
    $('edit-title').textContent = s ? t('editTitleEdit') : t('editTitleAdd');
    $('edit-delete').hidden = !s;
    this.name.value = s?.name ?? '';
    this.url.value = s?.url ?? '';
    this.error.textContent = '';
    this.#preview();
    this.dlg.showModal();
    (s ? this.name : this.url).focus();
  }

  #currentCustom(): string | null {
    if (this.#iconData !== undefined) return this.#iconData;
    const s = this.#id ? this.store.shortcuts.find((x) => x.id === this.#id) : undefined;
    return (s?.icon && this.store.icons[s.icon]) || null;
  }

  #preview(): void {
    const url = normalizeUrl(this.url.value);
    fillIcon(this.icon, { name: this.name.value || hostLabel(url) || '?', url: url || 'about:blank', customData: this.#currentCustom() });
    $('edit-icon-auto').hidden = !this.#currentCustom();
  }

  async #save(): Promise<void> {
    clearTimeout(this.#previewTimer);
    const url = normalizeUrl(this.url.value);
    if (!url || !isSafeShortcutUrl(url)) {
      this.error.textContent = t('editUrlError');
      this.url.focus();
      return;
    }
    const name = this.name.value.trim() || hostLabel(url);
    if (this.#id) {
      await this.store.updateShortcut(this.#id, { name, url, iconData: this.#iconData });
    } else {
      await this.store.addShortcut({ name, url, iconData: this.#iconData || undefined });
    }
    this.dlg.close();
  }

  async #remove(): Promise<void> {
    const removed = await this.store.removeShortcut(this.#id!);
    this.dlg.close();
    if (removed) {
      toast(t('toastDeletedShortcut', removed.shortcut.name), {
        action: { label: t('actionUndo'), run: () => this.store.insertShortcut(removed) },
      });
    }
  }
}
