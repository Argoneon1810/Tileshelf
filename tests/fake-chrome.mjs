// chrome.storage를 흉내 내는 가짜. sync 영역은 실제와 같은 한도를 지키고,
// 여러 PC가 같은 sync 영역을 나눠 쓰도록 만들 수 있다.

import { itemBytes, ITEM_LIMIT, TOTAL_LIMIT } from '../src/ts/syncdoc.ts';

class Hub {
  listeners = new Set();
  addListener(fn) {
    this.listeners.add(fn);
  }
  emit(changes, area) {
    // 실제 Chrome처럼 저장이 끝난 뒤 따로 알린다
    setTimeout(() => this.listeners.forEach((fn) => fn(structuredClone(changes), area)), 0);
  }
}

class Area {
  data = {};
  hubs = new Set();

  constructor(name, { quota = false } = {}) {
    this.name = name;
    this.quota = quota;
  }

  async get(keys) {
    const all = structuredClone(this.data);
    if (keys == null) return all;
    const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    return Object.fromEntries(list.filter((k) => k in all).map((k) => [k, all[k]]));
  }

  async set(obj) {
    if (this.quota) {
      for (const [k, v] of Object.entries(obj)) {
        if (itemBytes(k, v) > ITEM_LIMIT) throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
      }
      const next = { ...this.data, ...obj };
      const total = Object.entries(next).reduce((s, [k, v]) => s + itemBytes(k, v), 0);
      if (total > TOTAL_LIMIT) throw new Error('QUOTA_BYTES quota exceeded');
    }
    const changes = {};
    for (const [k, v] of Object.entries(obj)) {
      changes[k] = { oldValue: this.data[k], newValue: structuredClone(v) };
      this.data[k] = structuredClone(v);
    }
    this.#emit(changes);
  }

  async remove(keys) {
    const changes = {};
    for (const k of [].concat(keys)) {
      if (k in this.data) {
        changes[k] = { oldValue: this.data[k] };
        delete this.data[k];
      }
    }
    if (Object.keys(changes).length) this.#emit(changes);
  }

  #emit(changes) {
    this.hubs.forEach((h) => h.emit(changes, this.name));
  }
}

export function newAccount() {
  return new Area('sync', { quota: true });
}

// 한 PC의 chrome.storage. 같은 account를 넘기면 sync 영역을 나눠 쓴다.
export function newDevice(account = newAccount()) {
  const hub = new Hub();
  const local = new Area('local');
  local.hubs.add(hub);
  account.hubs.add(hub);
  return { local, sync: account, onChanged: hub };
}

export const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
