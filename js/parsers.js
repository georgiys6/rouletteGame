// Общие функции: используются и сайтом, и скриптом синхронизации (scripts/fetch-games.mjs).

export const SOURCES = {
  steam:      { name: 'Steam',        color: '#66c0f4' },
  backloggd:  { name: 'Backloggd',    color: '#ff4fa3' },
  mygamelist: { name: 'MyGameList',   color: '#f5a623' },
  epic:       { name: 'Epic Games',   color: '#c9c9c9' },
  psn:        { name: 'PlayStation',  color: '#2f7cff' },
  xbox:       { name: 'Xbox',         color: '#3fbf3f' },
  nintendo:   { name: 'Nintendo',     color: '#ff3c3c' },
  manual:     { name: 'Вручную',      color: '#b38cff' },
};

export const SOURCE_IDS = Object.keys(SOURCES);

export function slugify(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[™®©]/g, '')
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '');
}

// Ключ для поиска одной и той же игры в разных источниках.
export function normTitle(s) {
  return slugify(
    String(s ?? '')
      .replace(/\((pc|ps4|ps5|xbox[^)]*|switch|steam)\)/gi, '')
      .replace(/[-:–—]?\s*(game of the year|goty|definitive|deluxe|complete|ultimate|enhanced|remastered|director'?s cut|standard)(\s+edition)?\s*$/i, '')
      .replace(/\s+edition\s*$/i, '')
  ).replace(/^the-/, '');
}

const num = (v) => (v === '' || v == null || isNaN(+v) ? undefined : +v);

export function makeGame(source, raw) {
  if (typeof raw === 'string') raw = { title: raw };
  const title = String(raw.title ?? raw.name ?? '').trim();
  if (!title) return null;
  const src = SOURCES[raw.source] ? raw.source : (SOURCES[source] ? source : 'manual');
  const extId = raw.extId != null && raw.extId !== '' ? String(raw.extId) : undefined;
  const g = {
    id: raw.id || `${src}:${extId || slugify(title)}`,
    source: src,
    title,
  };
  if (extId) g.extId = extId;
  if (raw.cover) g.cover = String(raw.cover);
  if (raw.url) g.url = String(raw.url);
  if (raw.platform) g.platform = String(raw.platform);
  const pt = num(raw.playtime);
  if (pt !== undefined) g.playtime = pt;
  const pr = num(raw.progress);
  if (pr !== undefined) g.progress = pr;
  if (raw.imported) g.imported = raw.imported;
  return g;
}

// ---------- CSV ----------
export function parseCSV(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delim = ['\t', ';', ','].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best, ',');
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const HEAD = {
  title: /^(title|name|game|game name|game title|название|игра)$/i,
  platform: /^(platform|platforms|платформа|system)$/i,
  playtime: /^(playtime|playtime_forever|minutes|время)$/i,
  hours: /^(hours|часы|hours played)$/i,
  progress: /^(progress|completion|прогресс|%)$/i,
  status: /^(status|статус|list|shelf)$/i,
  source: /^(source|источник)$/i,
  cover: /^(cover|image|img|обложка)$/i,
  url: /^(url|link|ссылка)$/i,
};

function csvToGames(text, source) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  const idx = {};
  for (const [k, re] of Object.entries(HEAD)) idx[k] = head.findIndex((h) => re.test(h));
  if (idx.title < 0) return rows.map((r) => makeGame(source, r[0])).filter(Boolean);
  const out = [];
  for (const r of rows.slice(1)) {
    const status = idx.status >= 0 ? (r[idx.status] || '').toLowerCase() : '';
    // если есть колонка статуса — пропускаем явно пройденные
    if (/^(beaten|completed|finished|done|пройдено|пройдена|mastered|100%)$/.test(status.trim())) continue;
    const g = makeGame(idx.source >= 0 ? r[idx.source] : source, {
      title: r[idx.title],
      platform: idx.platform >= 0 ? r[idx.platform] : undefined,
      playtime: idx.playtime >= 0 ? r[idx.playtime] : idx.hours >= 0 && r[idx.hours] ? +r[idx.hours] * 60 : undefined,
      progress: idx.progress >= 0 ? String(r[idx.progress]).replace('%', '') : undefined,
      cover: idx.cover >= 0 ? r[idx.cover] : undefined,
      url: idx.url >= 0 ? r[idx.url] : undefined,
    });
    if (g) out.push(g);
  }
  return out;
}

export function parseLines(text, source) {
  return text.split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•–]|\d+[.)])\s+/, '').trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => makeGame(source, l))
    .filter(Boolean);
}

/**
 * Разбирает текст импорта любого поддерживаемого формата.
 * Возвращает { source, games }.
 */
export function parseImport(text, { filename = '', source = 'manual' } = {}) {
  text = String(text || '').replace(/^﻿/, '');
  const t = text.trim();
  if (!t) return { source, games: [] };
  if (/^[\[{]/.test(t) || /\.json$/i.test(filename)) {
    const data = JSON.parse(t);
    if (Array.isArray(data)) return { source, games: data.map((x) => makeGame(source, x)).filter(Boolean) };
    const src = SOURCES[data.source] ? data.source : source;
    const list = data.games || data.items || data.titles || [];
    return { source: src, games: list.map((x) => makeGame(src, x)).filter(Boolean) };
  }
  if (/\.(csv|tsv)$/i.test(filename) || /^[^\n]*\b(title|name|название)\b[^\n]*[,;\t]/i.test(t)) {
    return { source, games: csvToGames(t, source) };
  }
  return { source, games: parseLines(t, source) };
}

// Base64 <-> UTF-8 (для передачи данных из букмарклета через #import=)
export function b64decodeUtf8(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
