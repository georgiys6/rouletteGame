#!/usr/bin/env node
// Синхронизация библиотек для GitHub Actions (или локально: `npm run sync`).
// Результат пишется в data/games.json, сайт читает его при загрузке.
//
// Секреты (переменные окружения):
//   STEAM_API_KEY  — https://steamcommunity.com/dev/apikey (без ключа читаем открытую страницу профиля)
//   PSN_NPSSO      — токен npsso, см. README
//   OPENXBL_KEY    — ключ https://xbl.io
// Несекретные настройки — в roulette.config.json.
// Файлы data/import/<источник>.txt|csv|json тоже попадут в общий список.

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeGame, parseImport, SOURCES } from '../js/parsers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'games.json');
const UA = 'BacklogRoulette/1.0 (+https://github.com)';

const config = existsSync(path.join(ROOT, 'roulette.config.json'))
  ? JSON.parse(await readFile(path.join(ROOT, 'roulette.config.json'), 'utf8'))
  : {};

const prev = existsSync(OUT) ? JSON.parse(await readFile(OUT, 'utf8')) : { games: [] };
const prevBySource = (src) => (prev.games || []).filter((g) => g.source === src);

async function getJSON(url, headers = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${url.replace(/key=[^&]+/, 'key=***')}`);
  return r.json();
}
async function getText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${url}`);
  return r.text();
}
const decodeEntities = (s) => s.replace(/&quot;/g, '"').replace(/&#39;|&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// ---------------- Steam ----------------
async function steam() {
  const cfg = config.steam || {};
  if (!cfg.profile) return null;
  const key = process.env.STEAM_API_KEY;
  let id = String(cfg.profile).trim()
    .replace(/^https?:\/\/steamcommunity\.com\/(id|profiles)\//, '').replace(/\/.*$/, '');
  const isNumeric = /^\d{17}$/.test(id);

  if (key) {
    if (!isNumeric) {
      const v = await getJSON(`https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${key}&vanityurl=${encodeURIComponent(id)}`);
      if (v.response?.success !== 1) throw new Error(`Не удалось найти профиль Steam «${id}»`);
      id = v.response.steamid;
    }
    const d = await getJSON(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${key}&steamid=${id}&include_appinfo=1&include_played_free_games=1&format=json`);
    const games = d.response?.games;
    if (!games) throw new Error('Steam вернул пустой список: профиль или «Игры» скрыты в настройках приватности');
    return games.map((g) => makeGame('steam', {
      title: g.name, extId: g.appid, playtime: g.playtime_forever || 0,
      url: `https://store.steampowered.com/app/${g.appid}/`,
    }));
  }

  // без ключа читаем открытую страницу профиля
  const url = `https://steamcommunity.com/${isNumeric ? 'profiles' : 'id'}/${id}/games/?tab=all`;
  const html = await getText(url);
  const m = html.match(/data-profile-gameslist="([^"]+)"/);
  if (!m) throw new Error('Не нашёл список игр на странице профиля: добавьте STEAM_API_KEY или откройте профиль');
  const data = JSON.parse(decodeEntities(m[1]));
  return (data.rgGames || []).map((g) => makeGame('steam', {
    title: g.name, extId: g.appid, playtime: g.playtime_forever || 0,
    url: `https://store.steampowered.com/app/${g.appid}/`,
  }));
}

// ---------------- PlayStation ----------------
async function psn() {
  const npsso = process.env.PSN_NPSSO;
  if (!npsso) return null;
  const api = await import('psn-api');
  const toCode = api.exchangeNpssoForAccessCode || api.exchangeNpssoForCode;
  const toAuth = api.exchangeAccessCodeForAuthTokens || api.exchangeCodeForAccessToken;
  const auth = await toAuth(await toCode(npsso));
  const all = [];
  for (let offset = 0; ; ) {
    const r = await api.getUserTitles(auth, 'me', { limit: 800, offset });
    const list = r.trophyTitles || [];
    all.push(...list);
    offset += list.length;
    if (!list.length || offset >= (r.totalItemCount || 0)) break;
  }
  return all.map((t) => makeGame('psn', {
    title: t.trophyTitleName, extId: t.npCommunicationId,
    cover: t.trophyTitleIconUrl, progress: t.progress, platform: t.trophyTitlePlatform,
  }));
}

// ---------------- Xbox (OpenXBL) ----------------
async function xbox() {
  const key = process.env.OPENXBL_KEY;
  if (!key) return null;
  const d = await getJSON('https://xbl.io/api/v2/achievements', { 'X-Authorization': key });
  const titles = d.titles || d.content?.titles || [];
  return titles
    .filter((t) => !t.type || t.type === 'Game')
    .map((t) => makeGame('xbox', {
      title: t.name, extId: t.titleId, cover: t.displayImage,
      progress: t.achievement?.progressPercentage,
      platform: (t.devices || []).join(', '),
    }));
}

// ---------------- файлы data/import ----------------
async function importFiles() {
  const dir = path.join(ROOT, 'data', 'import');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of await readdir(dir)) {
    if (!/\.(txt|csv|tsv|json)$/i.test(f)) continue;
    const src = f.split(/[.\-_]/)[0].toLowerCase();
    const source = SOURCES[src] ? src : 'manual';
    const { games } = parseImport(await readFile(path.join(dir, f), 'utf8'), { filename: f, source });
    console.log(`  файл ${f}: ${games.length}`);
    out.push(...games);
  }
  return out;
}

// ---------------- сборка ----------------
const result = { updatedAt: new Date().toISOString(), sources: {}, games: [] };
for (const [name, fn] of Object.entries({ steam, psn, xbox })) {
  try {
    const list = await fn();
    if (list === null) {
      // источник не настроен: оставляем прошлые данные, если они были
      const old = prevBySource(name);
      if (old.length) { result.games.push(...old); result.sources[name] = { count: old.length, stale: true }; }
      continue;
    }
    const games = list.filter(Boolean);
    result.games.push(...games);
    result.sources[name] = { count: games.length };
    console.log(`✓ ${name}: ${games.length}`);
  } catch (e) {
    const old = prevBySource(name);
    result.games.push(...old);
    result.sources[name] = { count: old.length, error: String(e.message || e).slice(0, 300) };
    console.error(`✗ ${name}: ${e.message} (оставлены прошлые данные: ${old.length})`);
  }
}
const files = await importFiles();
result.games.push(...files);

// убираем дубли по id
const uniq = new Map(result.games.map((g) => [g.id, g]));
result.games = [...uniq.values()];

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(result, null, 1) + '\n');
console.log(`Итого: ${result.games.length} игр → data/games.json`);
