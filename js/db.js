/*
 * db.js — IndexedDB 草稿持久化（Promise 封装）
 * 库: form-wizard / 表: drafts / 键: 草稿名（默认 'current'）
 */
const DraftDB = (() => {
  'use strict';
  const DB_NAME = 'form-wizard';
  const STORE = 'drafts';

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tx(db, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      const result = fn(store);
      t.oncomplete = () => resolve(result && result._value);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
      if (result && typeof result === 'object' && 'onsuccess' in result) {
        result.onsuccess = () => { result._value = result.result; };
      }
    });
  }

  async function saveDraft(payload, key = 'current') {
    const db = await open();
    await tx(db, 'readwrite', (s) => s.put({ payload, savedAt: Date.now() }, key));
    db.close();
  }

  async function loadDraft(key = 'current') {
    const db = await open();
    const row = await tx(db, 'readonly', (s) => s.get(key));
    db.close();
    return row || null; // { payload, savedAt }
  }

  async function clearDraft(key = 'current') {
    const db = await open();
    await tx(db, 'readwrite', (s) => s.delete(key));
    db.close();
  }

  return { saveDraft, loadDraft, clearDraft };
})();
