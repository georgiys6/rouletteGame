// Состояние пользователя — localStorage; загруженные гифки (Blob) — IndexedDB.

const KEY = 'backlog-roulette:v1';

export const DEFAULT_SETTINGS = {
  mode: 'classic',
  wheelSize: 16,
  sources: {},            // { steam: false } — выключенные источники
  steamMaxHours: 2,
  maxProgress: 50,
  noRepeat: 3,            // не повторять N последних выпавших игр
  spinSeconds: 8,
  sound: true,
  confetti: true,
  palette: 'neon',
  gifUrl: '',
  gifFile: false,
  gifSize: 34,
  gifRotate: false,
  gifContain: false,
  winGifUrl: '',
  winGifFile: false,
};

export function loadState() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
  return {
    imported: Array.isArray(s.imported) ? s.imported : [],
    flags: s.flags && typeof s.flags === 'object' ? s.flags : {},
    history: Array.isArray(s.history) ? s.history : [],
    settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}) },
  };
}

let saveTimer;
export function saveState(state) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { console.error('Не удалось сохранить состояние', e); }
  }, 150);
}

export function wipeState() { try { localStorage.removeItem(KEY); } catch {} }

// ---------- IndexedDB для файлов ----------
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('backlog-roulette', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function putFile(key, blob) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('files', 'readwrite');
    tx.objectStore('files').put(blob, key);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
export async function getFile(key) {
  try {
    const d = await db();
    return await new Promise((res, rej) => {
      const r = d.transaction('files').objectStore('files').get(key);
      r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error);
    });
  } catch { return null; }
}
export async function delFile(key) {
  try {
    const d = await db();
    d.transaction('files', 'readwrite').objectStore('files').delete(key);
  } catch {}
}
