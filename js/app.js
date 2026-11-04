import { SOURCES, SOURCE_IDS, makeGame, normTitle, parseImport, b64decodeUtf8 } from './parsers.js';
import { Wheel, PALETTES } from './wheel.js';
import { sound, confetti } from './effects.js';
import { loadState, saveState, wipeState, putFile, getFile, delFile, DEFAULT_SETTINGS } from './storage.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = loadState();
const S = state.settings;
let remote = { updatedAt: null, games: [] };
let library = [];          // все игры (удалённые + импортированные)
let pool = [];             // подходящие для рулетки (группы)
let wheelItems = [];       // то, что сейчас на колесе
let eliminated = [];
let spinning = false;
const save = () => saveState(state);

// ================= утилиты =================
function rnd(n) {
  const a = new Uint32Array(1); crypto.getRandomValues(a);
  return a[0] % n;
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`; el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; setTimeout(() => el.remove(), 400); }, 3800);
}
function coverOf(g) {
  if (g.cover) return g.cover;
  if (g.source === 'steam' && g.extId) return `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.extId}/header.jpg`;
  return '';
}
function initials(t) {
  return String(t).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).slice(0, 2).map((w) => [...w][0]).join('').toUpperCase();
}
function coverHtml(g) {
  const src = coverOf(g);
  const ini = `<span class="initials">${esc(initials(g.title))}</span>`;
  return src ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'initials',textContent:${esc(JSON.stringify(initials(g.title)))}}))">` : ini;
}
const badge = (src) => `<span class="badge" style="--c:${SOURCES[src]?.color || '#888'}">${esc(SOURCES[src]?.name || src)}</span>`;
function metaText(g) {
  const out = [];
  if (g.playtime != null) out.push(g.playtime < 60 ? `${Math.round(g.playtime)} мин` : `${(g.playtime / 60).toFixed(1)} ч`);
  if (g.progress != null) out.push(`${Math.round(g.progress)}%`);
  if (g.platform) out.push(g.platform);
  return out.join(' · ');
}
const flag = (id) => state.flags[id] || {};
function setFlag(id, key, val) {
  const f = { ...flag(id) };
  if (val) f[key] = true; else delete f[key];
  if (Object.keys(f).length) state.flags[id] = f; else delete state.flags[id];
}

// ================= данные =================
async function loadRemote() {
  try {
    const r = await fetch('data/games.json', { cache: 'no-store' });
    if (r.ok) {
      const d = await r.json();
      remote = { updatedAt: d.updatedAt || null, games: (d.games || []).map((g) => makeGame(g.source, g)).filter(Boolean), sources: d.sources || {} };
    }
  } catch (e) { console.warn('data/games.json не загружен', e); }
}

function rebuildLibrary() {
  const map = new Map();
  for (const g of remote.games) map.set(g.id, g);
  for (const g of state.imported) map.set(g.id, g);
  library = [...map.values()].sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  $('#libCount').textContent = library.length;
}

function eligibility(g) {
  const f = flag(g.id);
  if (f.done) return 'done';
  if (f.off) return 'off';
  if (S.sources[g.source] === false) return 'source';
  if (g.source === 'steam' && g.playtime != null && g.playtime > S.steamMaxHours * 60) return 'filtered';
  if ((g.source === 'psn' || g.source === 'xbox') && g.progress != null && g.progress > S.maxProgress) return 'filtered';
  return 'ok';
}

function rebuildPool() {
  const ok = library.filter((g) => eligibility(g) === 'ok');
  if (!S.dedupe) { pool = ok.map((g) => ({ ...g, ids: [g.id], sources: [g.source] })); return; }
  // флаг «пройдено» на любой копии игры исключает её из всех источников
  const doneKeys = new Set(library.filter((g) => flag(g.id).done || flag(g.id).off).map((g) => normTitle(g.title)));
  const groups = new Map();
  for (const g of ok) {
    const k = normTitle(g.title) || g.id;
    if (doneKeys.has(k)) continue;
    const cur = groups.get(k);
    if (!cur) groups.set(k, { ...g, ids: [g.id], sources: [g.source] });
    else {
      cur.ids.push(g.id);
      if (!cur.sources.includes(g.source)) cur.sources.push(g.source);
      if (!coverOf(cur) && coverOf(g)) { cur.cover = coverOf(g); }
    }
  }
  pool = [...groups.values()];
}

function refillWheel() {
  eliminated = [];
  const n = Math.min(S.wheelSize, pool.length);
  wheelItems = shuffle(pool).slice(0, n);
  wheel.setItems(wheelItems, PALETTES[S.palette]?.colors);
  renderRouletteSide();
}

function refreshAll({ refill = true } = {}) {
  rebuildLibrary();
  rebuildPool();
  if (refill) refillWheel(); else renderRouletteSide();
  renderLibrary();
  renderImportStatus();
}

// ================= колесо =================
const pointer = $('#pointer');
const hubImg = $('#hubGif');
const wheel = new Wheel($('#wheel'), {
  onTick() {
    sound.tick();
    pointer.classList.remove('tick'); void pointer.offsetWidth; pointer.classList.add('tick');
  },
  onFrame(rot) { if (S.gifRotate) hubImg.style.transform = `rotate(${rot}rad)`; },
});

async function spin() {
  if (spinning) return;
  if (wheelItems.length < 1) { toast('На колесе нет игр — импортируйте их во вкладке «Импорт»', 'err'); return; }
  if (S.mode === 'elimination' && wheelItems.length === 1) { showWinner(wheelItems[0], true); return; }
  sound.unlock();
  spinning = true;
  $('#wheelStage').classList.add('spinning');
  $('#spinBtn').disabled = true;
  const target = rnd(wheelItems.length);
  const idx = await wheel.spin(target, S.spinSeconds);
  const game = wheelItems[idx];
  wheel.setHighlight(idx);

  if (S.mode === 'elimination') {
    sound.out();
    await new Promise((r) => setTimeout(r, 900));
    eliminated.push(game);
    wheelItems.splice(idx, 1);
    wheel.setItems(wheelItems);
    renderRouletteSide();
    if (wheelItems.length === 1) {
      await new Promise((r) => setTimeout(r, 350));
      showWinner(wheelItems[0], true);
    }
  } else {
    showWinner(game, false);
  }
  spinning = false;
  $('#wheelStage').classList.remove('spinning');
  $('#spinBtn').disabled = false;
}

let currentWinner = null;
function showWinner(game, isElim) {
  currentWinner = game;
  sound.win();
  if (S.confetti) confetti($('#confetti'));
  $('#winKicker').textContent = isElim ? '🏆 Выжила последней!' : '🎉 Выпало!';
  $('#winCover').innerHTML = coverHtml(game);
  $('#winTitle').textContent = game.title;
  $('#winMeta').innerHTML = (game.sources || [game.source]).map(badge).join('') + (metaText(game) ? `<span>${esc(metaText(game))}</span>` : '');
  $('#winModal').hidden = false;
  state.history.unshift({ title: game.title, source: game.source, mode: S.mode, at: Date.now() });
  state.history = state.history.slice(0, 50);
  save();
  renderHistory();
}
function closeWinner() { $('#winModal').hidden = true; wheel.setHighlight(-1); }

$('#winOk').onclick = closeWinner;
$('#winModal').onclick = (e) => { if (e.target.id === 'winModal') closeWinner(); };
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#winModal').hidden) closeWinner();
  if (e.code === 'Space' && $('#view-roulette').classList.contains('active') && $('#winModal').hidden && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement.tagName)) { e.preventDefault(); spin(); }
});
function dropWinner(key) {
  if (!currentWinner) return;
  for (const id of currentWinner.ids || [currentWinner.id]) setFlag(id, key, true);
  save();
  rebuildPool();
  const i = wheelItems.indexOf(currentWinner);
  if (i >= 0 && S.mode === 'classic') { wheelItems.splice(i, 1); wheel.setItems(wheelItems); }
  renderRouletteSide(); renderLibrary();
  toast(key === 'done' ? `«${currentWinner.title}» отмечена пройденной` : `«${currentWinner.title}» убрана из рулетки`, 'ok');
  closeWinner();
}
$('#winDone').onclick = () => dropWinner('done');
$('#winOff').onclick = () => dropWinner('off');

$('#spinBtn').onclick = spin;
$('#hub').onclick = spin;
$('#shuffleBtn').onclick = () => { if (!spinning) refillWheel(); };
$('#resetElimBtn').onclick = () => { if (!spinning) refillWheel(); };

$$('.mode').forEach((b) => b.onclick = () => {
  if (spinning) return;
  S.mode = b.dataset.mode; save();
  applyMode(); refillWheel();
});
function applyMode() {
  $$('.mode').forEach((b) => b.classList.toggle('active', b.dataset.mode === S.mode));
  const el = S.mode === 'elimination';
  $('#elimCard').hidden = !el;
  $('#resetElimBtn').hidden = !el;
  $('#shuffleBtn').hidden = el;
}

const sizeInput = $('#wheelSize');
sizeInput.oninput = () => {
  S.wheelSize = +sizeInput.value; save();
  $('#wheelSizeVal').textContent = S.wheelSize >= pool.length ? `все (${pool.length})` : S.wheelSize;
};
sizeInput.onchange = () => { if (!spinning) refillWheel(); };

function renderRouletteSide() {
  // слайдер
  sizeInput.max = Math.max(2, pool.length);
  sizeInput.value = Math.min(S.wheelSize, Math.max(2, pool.length));
  $('#wheelSizeVal').textContent = S.wheelSize >= pool.length ? `все (${pool.length})` : S.wheelSize;

  // чипы источников
  const counts = {};
  for (const g of library) if (!flag(g.id).done) counts[g.source] = (counts[g.source] || 0) + 1;
  $('#sourceChips').innerHTML = SOURCE_IDS.filter((s) => counts[s]).map((s) =>
    `<span class="chip ${S.sources[s] === false ? 'off' : ''}" data-src="${s}" style="--c:${SOURCES[s].color}">${esc(SOURCES[s].name)} <span class="n">${counts[s]}</span></span>`
  ).join('') || '<span class="muted small">Пока нет игр</span>';

  $('#poolInfo').innerHTML = `В пуле <b>${pool.length}</b> игр из ${library.length}. Фильтры «непройденности» — в настройках.`;

  // инфо под колесом
  const info = $('#stageInfo');
  if (!wheelItems.length) info.innerHTML = library.length ? 'Все игры отфильтрованы — проверьте источники и настройки' : 'Нет игр. Загляните во вкладку <b>Импорт</b>';
  else if (S.mode === 'elimination') info.innerHTML = wheelItems.length === 1 ? `Победитель: <b>${esc(wheelItems[0].title)}</b>` : `Осталось <b>${wheelItems.length}</b> · выбыло ${eliminated.length}`;
  else info.innerHTML = `На колесе <b>${wheelItems.length}</b> игр · пробел — крутить`;

  $('#elimCount').textContent = eliminated.length;
  $('#elimList').innerHTML = eliminated.map((g) => `<li>${esc(g.title)}</li>`).join('');
  $('#elimList').scrollTop = 1e6;
}
$('#sourceChips').onclick = (e) => {
  const c = e.target.closest('.chip'); if (!c || spinning) return;
  const s = c.dataset.src;
  S.sources[s] = S.sources[s] === false ? true : false; save();
  rebuildPool(); refillWheel(); renderLibrary();
};

function renderHistory() {
  const h = state.history;
  $('#history').innerHTML = h.length ? h.map((x) => `<li>${badge(x.source)}<span class="t" title="${esc(x.title)}">${x.mode === 'elimination' ? '🏆 ' : ''}${esc(x.title)}</span><time>${new Date(x.at).toLocaleDateString('ru', { day: 'numeric', month: 'short' })}</time></li>`).join('') : '<li class="muted small">Ещё ничего не выпадало</li>';
}
$('#clearHistory').onclick = () => { state.history = []; save(); renderHistory(); };

// ================= гифки =================
let gifObjUrl = null, winObjUrl = null;
async function applyGifs() {
  if (gifObjUrl) URL.revokeObjectURL(gifObjUrl), gifObjUrl = null;
  if (winObjUrl) URL.revokeObjectURL(winObjUrl), winObjUrl = null;
  let src = S.gifUrl;
  if (S.gifFile) { const b = await getFile('gif'); if (b) src = gifObjUrl = URL.createObjectURL(b); }
  let wsrc = S.winGifUrl;
  if (S.winGifFile) { const b = await getFile('winGif'); if (b) wsrc = winObjUrl = URL.createObjectURL(b); }

  const hub = $('#hub');
  hub.style.setProperty('--size', S.gifSize + '%');
  wheel.hubFrac = S.gifSize / 100; wheel.render(); wheel.draw();
  hub.classList.toggle('has-gif', !!src);
  hub.classList.toggle('contain', !!S.gifContain);
  hubImg.hidden = !src;
  if (src) hubImg.src = src; else hubImg.removeAttribute('src');
  if (!S.gifRotate) hubImg.style.transform = '';
  $('#gifPreview').innerHTML = src ? `<img src="${esc(src)}" alt="">` : '<span>нет гифки</span>';
  $('#gifPreview').style.borderRadius = '50%';

  const wg = $('#winGif');
  wg.hidden = !wsrc;
  if (wsrc) wg.src = wsrc; else wg.removeAttribute('src');
  $('#winGifPreview').innerHTML = wsrc ? `<img src="${esc(wsrc)}" alt="">` : '<span>нет гифки</span>';
}
function bindGif(prefix, key, fileKey, urlKey) {
  $(`#${prefix}File`).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 25 * 1024 * 1024) { toast('Файл больше 25 МБ — возьмите поменьше', 'err'); return; }
    await putFile(key, f);
    S[fileKey] = true; S[urlKey] = ''; save();
    $(`#${prefix}Url`).value = '';
    applyGifs(); toast('Гифка сохранена', 'ok');
    e.target.value = '';
  };
  $(`#${prefix}UrlApply`).onclick = async () => {
    const u = $(`#${prefix}Url`).value.trim();
    S[urlKey] = u; S[fileKey] = false; save();
    await delFile(key); applyGifs();
  };
  $(`#${prefix}Clear`).onclick = async () => {
    S[urlKey] = ''; S[fileKey] = false; save();
    $(`#${prefix}Url`).value = '';
    await delFile(key); applyGifs();
  };
}
bindGif('gif', 'gif', 'gifFile', 'gifUrl');
bindGif('winGif', 'winGif', 'winGifFile', 'winGifUrl');

// ================= библиотека =================
let libLimit = 120;
const STATUS_LABEL = { ok: 'в рулетке', filtered: 'отсеяна фильтром', off: 'исключена', done: 'пройдена', source: 'источник выключен' };

function renderLibrary() {
  const q = $('#libSearch').value.trim().toLowerCase();
  const src = $('#libSource').value;
  const st = $('#libStatus').value;
  const list = library.filter((g) => {
    if (src && g.source !== src) return false;
    if (q && !g.title.toLowerCase().includes(q)) return false;
    if (st) {
      const e = eligibility(g);
      if (st === 'pool' && e !== 'ok') return false;
      if (st === 'filtered' && e !== 'filtered' && e !== 'source') return false;
      if (st !== 'pool' && st !== 'filtered' && e !== st) return false;
    }
    return true;
  });
  $('#libSummary').textContent = `Найдено: ${list.length}`;
  $('#libGrid').innerHTML = list.slice(0, libLimit).map((g) => {
    const e = eligibility(g), f = flag(g.id);
    const imported = state.imported.some((x) => x.id === g.id);
    return `<article class="game is-${e}" data-id="${esc(g.id)}">
      <div class="cover">${coverHtml(g)}</div>
      <div class="g-body">
        <div class="g-title">${g.url ? `<a href="${esc(g.url)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">${esc(g.title)}</a>` : esc(g.title)}</div>
        <div class="g-meta">${badge(g.source)}<span>${esc(metaText(g))}</span></div>
        <div class="g-meta"><span>${STATUS_LABEL[e]}</span></div>
        <div class="g-actions">
          <button class="btn ${!f.off && !f.done ? 'on' : ''}" data-act="off" title="Участвует в рулетке">${f.off ? '✕ исключена' : '🎡 в рулетке'}</button>
          <button class="btn ${f.done ? 'on' : ''}" data-act="done">${f.done ? '✓ пройдена' : 'пройдена?'}</button>
          ${imported ? '<button class="btn" data-act="del" title="Удалить импортированную игру">🗑</button>' : ''}
        </div>
      </div></article>`;
  }).join('') || '<p class="muted">Ничего не найдено.</p>';
  $('#libMore').hidden = list.length <= libLimit;
}
$('#libGrid').onclick = (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const id = b.closest('.game').dataset.id;
  const act = b.dataset.act;
  if (act === 'off') setFlag(id, 'off', !flag(id).off);
  if (act === 'done') setFlag(id, 'done', !flag(id).done);
  if (act === 'del') { state.imported = state.imported.filter((g) => g.id !== id); delete state.flags[id]; rebuildLibrary(); }
  save(); rebuildPool(); renderLibrary(); renderRouletteSide();
};
$('#libSearch').oninput = () => { libLimit = 120; renderLibrary(); };
$('#libSource').onchange = $('#libStatus').onchange = () => { libLimit = 120; renderLibrary(); };
$('#libMore').onclick = () => { libLimit += 240; renderLibrary(); };
$('#addForm').onsubmit = (e) => {
  e.preventDefault();
  const g = makeGame($('#addSource').value, { title: $('#addTitle').value, imported: Date.now() });
  if (!g) return;
  state.imported.push(g); save();
  $('#addTitle').value = '';
  refreshAll();
  toast(`Добавлено: ${g.title}`, 'ok');
};

// ================= импорт =================
function importGames(source, games, replace) {
  const stamp = Date.now();
  games = games.map((g) => ({ ...g, imported: stamp }));
  if (replace) {
    const srcs = new Set(games.map((g) => g.source).concat(source));
    state.imported = state.imported.filter((g) => !srcs.has(g.source));
  }
  const map = new Map(state.imported.map((g) => [g.id, g]));
  for (const g of games) map.set(g.id, g);
  state.imported = [...map.values()];
  save();
  refreshAll();
  return games.length;
}

$('#pasteBtn').onclick = () => {
  try {
    const { source, games } = parseImport($('#pasteText').value, { source: $('#pasteSource').value });
    if (!games.length) return toast('Не нашёл ни одной игры', 'err');
    const n = importGames(source, games, $('#pasteReplace').checked);
    $('#pasteText').value = '';
    toast(`Импортировано игр: ${n}`, 'ok');
  } catch (e) { toast('Ошибка разбора: ' + e.message, 'err'); }
};
$('#pasteFile').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const { source, games } = parseImport(await f.text(), { filename: f.name, source: $('#pasteSource').value });
    if (!games.length) return toast('В файле не нашлось игр', 'err');
    toast(`Импортировано игр: ${importGames(source, games, $('#pasteReplace').checked)}`, 'ok');
  } catch (err) { toast('Ошибка чтения файла: ' + err.message, 'err'); }
  e.target.value = '';
};

// данные из букмарклета приходят в #import=<base64url(JSON)>
function consumeHashImport() {
  const m = location.hash.match(/^#import=(.+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const data = JSON.parse(b64decodeUtf8(decodeURIComponent(m[1])));
    const { source, games } = parseImport(JSON.stringify(data), { source: data.source || 'manual' });
    const n = importGames(source, games, true);
    toast(`Из ${SOURCES[source]?.name || source} получено игр: ${n}`, 'ok');
    switchView('library');
    $('#libSource').value = source; renderLibrary();
  } catch (e) { toast('Не удалось прочитать данные сборщика: ' + e.message, 'err'); }
}
window.addEventListener('hashchange', consumeHashImport);

async function setupBookmarklet() {
  try {
    const code = await (await fetch('js/collector.js', { cache: 'no-store' })).text();
    const site = location.origin + location.pathname;
    $('#bookmarklet').href = 'javascript:' + encodeURIComponent(`(function(){var ROULETTE_URL=${JSON.stringify(site)};${code}\n})();`);
  } catch { $('#bookmarklet').title = 'Не удалось загрузить сборщик'; }
  $('#bookmarklet').onclick = (e) => { e.preventDefault(); toast('Перетащите кнопку на панель закладок (Ctrl+Shift+B — показать панель)'); };
}

const GUIDE = {
  steam: {
    how: ['bookmarklet', 'actions'],
    steps: ['Профиль Steam должен быть открытым (Приватность → «Игры: открыто»)', 'Откройте <a href="https://steamcommunity.com/my/games/?tab=all" target="_blank" rel="noopener">steamcommunity.com/my/games</a> и нажмите закладку', 'Или GitHub Actions: секрет <code>STEAM_API_KEY</code> и steamId в конфиге'],
  },
  backloggd: {
    how: ['bookmarklet', 'file'],
    steps: ['Откройте в своём профиле список игр со статусом <b>Backlog</b> (Games → фильтр Backlog)', 'Нажмите закладку: сборщик сам пройдёт все страницы', 'Серверный импорт невозможен: Backloggd блокирует ботов'],
  },
  mygamelist: {
    how: ['bookmarklet', 'file'],
    steps: ['Откройте страницу своего списка «не пройдено/хочу пройти»', 'Нажмите закладку: сборщик возьмёт названия с обложек или выделенный текст', 'Или экспортируйте CSV и загрузите его ниже'],
  },
  epic: {
    how: ['bookmarklet', 'file'],
    steps: ['Войдите и откройте <a href="https://www.epicgames.com/account/transactions" target="_blank" rel="noopener">epicgames.com/account/transactions</a>', 'Нажмите закладку: сборщик скачает всю историю покупок, включая бесплатные раздачи', 'Публичного API у Epic нет'],
  },
  psn: {
    how: ['actions', 'bookmarklet'],
    steps: ['Лучше всего: GitHub Actions с секретом <code>PSN_NPSSO</code> (трофеи и прогресс)', 'Или откройте <a href="https://library.playstation.com/recently-played" target="_blank" rel="noopener">library.playstation.com</a>, прокрутите список до конца и нажмите закладку'],
  },
  xbox: {
    how: ['actions', 'bookmarklet'],
    steps: ['GitHub Actions: бесплатный ключ <a href="https://xbl.io" target="_blank" rel="noopener">OpenXBL</a> в секрете <code>OPENXBL_KEY</code>', 'Или откройте свою страницу достижений на xbox.com и нажмите закладку'],
  },
  nintendo: {
    how: ['bookmarklet', 'file'],
    steps: ['Откройте историю покупок в <a href="https://accounts.nintendo.com/" target="_blank" rel="noopener">аккаунте Nintendo</a> (Магазин → Покупки) или выделите список игр мышкой', 'Нажмите закладку и проверьте список', 'Публичного API у Nintendo нет'],
  },
};
const HOW = { bookmarklet: '🔖 закладка', actions: '⚙️ Actions', file: '📄 файл/текст' };

function renderImportGuide() {
  $('#sourceGuide').innerHTML = Object.entries(GUIDE).map(([id, g]) => {
    const n = library.filter((x) => x.source === id).length;
    return `<div class="source-card" style="--c:${SOURCES[id].color}">
      <h4>${esc(SOURCES[id].name)} <span class="pill">${n}</span></h4>
      <ol>${g.steps.map((s) => `<li>${s}</li>`).join('')}</ol>
      <div class="how">${g.how.map((h) => `<span class="badge" style="--c:${SOURCES[id].color}">${HOW[h]}</span>`).join('')}</div>
    </div>`;
  }).join('');
}
function renderImportStatus() {
  renderImportGuide();
  const el = $('#remoteStatus');
  if (!remote.updatedAt) { el.textContent = 'data/games.json пока пуст: синхронизация ещё не запускалась.'; return; }
  const by = {};
  for (const g of remote.games) by[g.source] = (by[g.source] || 0) + 1;
  const errs = Object.entries(remote.sources || {}).filter(([, v]) => v && v.error).map(([k, v]) => `${SOURCES[k]?.name || k}: ${v.error}`);
  el.innerHTML = `Последняя синхронизация: <b>${new Date(remote.updatedAt).toLocaleString('ru')}</b> · ` +
    (Object.entries(by).map(([k, v]) => `${esc(SOURCES[k]?.name || k)}: ${v}`).join(', ') || 'игр нет') +
    (errs.length ? `<br>⚠️ ${errs.map(esc).join('<br>⚠️ ')}` : '');
}

// ================= настройки =================
function bindSettings() {
  const num = (id, key, after) => { const el = $('#' + id); el.value = S[key]; el.onchange = () => { S[key] = +el.value; save(); after?.(); }; };
  const chk = (id, key, after) => { const el = $('#' + id); el.checked = !!S[key]; el.onchange = () => { S[key] = el.checked; save(); after?.(); }; };
  const refilter = () => { rebuildPool(); refillWheel(); renderLibrary(); };

  num('steamMaxHours', 'steamMaxHours', refilter);
  num('maxProgress', 'maxProgress', refilter);
  chk('optDedupe', 'dedupe', refilter);
  chk('optSound', 'sound', () => (sound.enabled = S.sound));
  chk('optConfetti', 'confetti');
  chk('gifRotate', 'gifRotate', applyGifs);
  // «обрезать по кругу» = НЕ contain
  $('#gifCover').checked = !S.gifContain;
  $('#gifCover').onchange = (e) => { S.gifContain = !e.target.checked; save(); applyGifs(); };

  const spinSec = $('#spinSec');
  spinSec.value = S.spinSeconds; $('#spinSecVal').textContent = S.spinSeconds;
  spinSec.oninput = () => { S.spinSeconds = +spinSec.value; $('#spinSecVal').textContent = S.spinSeconds; save(); };

  const gs = $('#gifSize');
  gs.value = S.gifSize; $('#gifSizeVal').textContent = S.gifSize + '%';
  gs.oninput = () => {
    S.gifSize = +gs.value; $('#gifSizeVal').textContent = S.gifSize + '%';
    $('#hub').style.setProperty('--size', S.gifSize + '%');
    wheel.hubFrac = S.gifSize / 100; wheel.render(); wheel.draw(); save();
  };

  $('#gifUrl').value = S.gifUrl; $('#winGifUrl').value = S.winGifUrl;
  sound.enabled = S.sound;

  $('#palettes').innerHTML = Object.entries(PALETTES).map(([k, p]) =>
    `<button class="palette ${k === S.palette ? 'active' : ''}" data-p="${k}"><div class="sw">${p.colors.map((c) => `<i style="background:${c}"></i>`).join('')}</div>${esc(p.name)}</button>`).join('');
  $('#palettes').onclick = (e) => {
    const b = e.target.closest('.palette'); if (!b) return;
    S.palette = b.dataset.p; save();
    $$('.palette').forEach((x) => x.classList.toggle('active', x === b));
    wheel.setItems(wheelItems, PALETTES[S.palette].colors);
  };

  // селекты источников
  const opts = SOURCE_IDS.map((s) => `<option value="${s}">${esc(SOURCES[s].name)}</option>`).join('');
  $('#pasteSource').innerHTML = opts; $('#pasteSource').value = 'backloggd';
  $('#addSource').innerHTML = opts; $('#addSource').value = 'manual';
  $('#libSource').innerHTML = '<option value="">Все источники</option>' + opts;

  $('#exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify({ app: 'backlog-roulette', version: 1, exportedAt: new Date().toISOString(), ...state }, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `backlog-roulette-${new Date().toISOString().slice(0, 10)}.json` });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#restoreFile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.app !== 'backlog-roulette') {
        // не резервная копия, а просто список — импортируем как игры
        const { source, games } = parseImport(JSON.stringify(d), { source: 'manual' });
        toast(`Импортировано игр: ${importGames(source, games, false)}`, 'ok'); return;
      }
      state.imported = (d.imported || []).map((g) => makeGame(g.source, g)).filter(Boolean);
      state.flags = d.flags || {}; state.history = d.history || [];
      Object.assign(S, DEFAULT_SETTINGS, d.settings || {});
      save(); location.reload();
    } catch (err) { toast('Не удалось восстановить: ' + err.message, 'err'); }
    e.target.value = '';
  };
  $('#wipeBtn').onclick = async () => {
    if (!confirm('Удалить все импортированные игры, отметки, историю, гифки и настройки в этом браузере?')) return;
    wipeState(); await delFile('gif'); await delFile('winGif'); location.reload();
  };
}

// ================= вкладки =================
function switchView(v) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
  $$('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + v));
  if (v === 'roulette') wheel.resize();
}
$$('.tab').forEach((t) => t.onclick = () => switchView(t.dataset.view));

// ================= старт =================
(async function init() {
  bindSettings();
  applyMode();
  applyGifs();
  renderHistory();
  await loadRemote();
  refreshAll();
  setupBookmarklet();
  consumeHashImport();
  document.fonts?.ready.then(() => wheel.setItems(wheelItems));
})();
