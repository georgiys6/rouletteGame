/* Букмарклет-сборщик Backlog Roulette.
   Сайт сам оборачивает этот файл в javascript:-ссылку и подставляет ROULETTE_URL.
   Код выполняется на странице магазина или трекера, где вы уже вошли в аккаунт, и только читает её. */
var RU = typeof ROULETTE_URL !== 'undefined' ? ROULETTE_URL : 'https://example.github.io/backlog-roulette/';
var old = document.getElementById('__rg_panel');
if (old) old.remove();

var host = location.hostname;
var detected =
  /steamcommunity\.com|steampowered\.com/.test(host) ? 'steam' :
  /backloggd\.com/.test(host) ? 'backloggd' :
  /epicgames\.com/.test(host) ? 'epic' :
  /playstation\.com/.test(host) ? 'psn' :
  /xbox\.com/.test(host) ? 'xbox' :
  /nintendo\./.test(host) ? 'nintendo' :
  /mygamelist|myvideogamelist/.test(host) ? 'mygamelist' : 'manual';

var NAMES = { steam: 'Steam', backloggd: 'Backloggd', mygamelist: 'MyGameList', epic: 'Epic Games', psn: 'PlayStation', xbox: 'Xbox', nintendo: 'Nintendo', manual: 'Другое' };
var items = [];

/* ---------- UI ---------- */
var panel = document.createElement('div');
panel.id = '__rg_panel';
panel.setAttribute('style', 'position:fixed;top:16px;right:16px;width:380px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);z-index:2147483647;background:#1d1436;color:#f3eefe;font:14px/1.45 system-ui,sans-serif;border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.18);display:flex;flex-direction:column;overflow:hidden');
var opts = '';
for (var k in NAMES) opts += '<option value="' + k + '"' + (k === detected ? ' selected' : '') + '>' + NAMES[k] + '</option>';
panel.innerHTML =
  '<div style="padding:14px 16px;background:linear-gradient(135deg,#ff4d9d,#7c5cff);display:flex;justify-content:space-between;align-items:center">' +
    '<b style="font-size:15px">🎡 Backlog Roulette</b><button data-x style="background:none;border:0;color:#fff;font-size:20px;cursor:pointer">×</button></div>' +
  '<div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px;overflow:auto">' +
    '<label style="display:flex;gap:8px;align-items:center">Источник: <select data-src style="flex:1;background:#120a24;color:#fff;border:1px solid #555;border-radius:8px;padding:5px">' + opts + '</select></label>' +
    '<div data-status style="color:#c9bdf0">Ищу игры…</div>' +
    '<textarea data-list rows="12" style="width:100%;box-sizing:border-box;background:#120a24;color:#fff;border:1px solid #555;border-radius:10px;padding:8px;font:12px/1.4 Consolas,monospace;resize:vertical" placeholder="По одной игре на строку"></textarea>' +
    '<div style="font-size:12px;color:#a99cc8">Список можно поправить: удалите лишние строки или допишите свои.</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button data-send style="flex:1;padding:10px;border:0;border-radius:10px;background:linear-gradient(135deg,#ff4d9d,#7c5cff);color:#fff;font-weight:700;cursor:pointer">Отправить в рулетку →</button>' +
      '<button data-copy style="padding:10px;border:1px solid #666;border-radius:10px;background:transparent;color:#fff;cursor:pointer">Копировать</button>' +
      '<button data-rescan style="padding:10px;border:1px solid #666;border-radius:10px;background:transparent;color:#fff;cursor:pointer" title="Собрать заново">↻</button>' +
    '</div></div>';
document.body.appendChild(panel);
var $p = function (s) { return panel.querySelector(s); };
var status = function (t) { $p('[data-status]').textContent = t; };
$p('[data-x]').onclick = function () { panel.remove(); };

function setItems(list) {
  var seen = {};
  items = list.filter(function (g) {
    if (!g || !g.title) return false;
    g.title = String(g.title).replace(/\s+/g, ' ').trim();
    var key = g.title.toLowerCase();
    if (!g.title || seen[key]) return false;
    seen[key] = 1; return true;
  });
  $p('[data-list]').value = items.map(function (g) { return g.title; }).join('\n');
  status('Найдено игр: ' + items.length);
}

function payload() {
  var lines = $p('[data-list]').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  var byTitle = {};
  items.forEach(function (g) { byTitle[g.title] = g; });
  return {
    source: $p('[data-src]').value,
    games: lines.map(function (t) { return byTitle[t] || { title: t }; }),
  };
}

function b64url(str) {
  var bytes = new TextEncoder().encode(str), bin = '';
  for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

$p('[data-send]').onclick = function () {
  var json = JSON.stringify(payload());
  var url = RU.split('#')[0] + '#import=' + b64url(json);
  if (url.length > 1900000) { alert('Список слишком большой для передачи ссылкой — нажмите «Копировать» и вставьте его на вкладке «Импорт».'); return; }
  window.open(url, '_blank');
};
$p('[data-copy]').onclick = function () {
  var json = JSON.stringify(payload());
  (navigator.clipboard ? navigator.clipboard.writeText(json) : Promise.reject()).then(
    function () { status('JSON скопирован — вставьте его на вкладке «Импорт»'); },
    function () { $p('[data-list]').value = json; $p('[data-list]').select(); document.execCommand('copy'); status('Скопировано'); }
  );
};
$p('[data-rescan]').onclick = function () { run($p('[data-src]').value); };

/* ---------- помощники ---------- */
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function getDoc(url) {
  return fetch(url, { credentials: 'include' }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }).then(function (t) { return new DOMParser().parseFromString(t, 'text/html'); });
}
function absUrl(u) { try { return new URL(u, location.href).href; } catch (e) { return u; } }

/* ---------- Steam ---------- */
function steamFromDoc(doc) {
  var el = doc.querySelector('[data-profile-gameslist]');
  if (!el) return null;
  var data = JSON.parse(el.getAttribute('data-profile-gameslist'));
  return (data.rgGames || []).map(function (g) {
    return { title: g.name, extId: String(g.appid), playtime: g.playtime_forever || 0, url: 'https://store.steampowered.com/app/' + g.appid + '/' };
  });
}
async function collectSteam() {
  var list = steamFromDoc(document);
  if (!list) {
    var m = location.pathname.match(/^\/(id|profiles)\/[^/]+/);
    var base = m ? m[0] : '/my';
    status('Загружаю список игр профиля…');
    list = steamFromDoc(await getDoc(base + '/games/?tab=all'));
  }
  if (!list) {
    // на случай новой вёрстки: собираем ссылки на приложения
    list = [].map.call(document.querySelectorAll('a[href*="/app/"]'), function (a) {
      var id = (a.href.match(/\/app\/(\d+)/) || [])[1];
      return { title: a.textContent.trim(), extId: id };
    }).filter(function (g) { return g.title && g.extId; });
  }
  if (!list.length) throw new Error('Не нашёл игр. Откройте steamcommunity.com/my/games/?tab=all и проверьте, что профиль открыт.');
  return list;
}

/* ---------- Backloggd ---------- */
function backloggdFromDoc(doc, out) {
  var added = 0;
  doc.querySelectorAll('a[href^="/games/"]').forEach(function (a) {
    var card = a.closest('.game-cover, .card, .rating-hover');
    if (!card) return;
    var slug = (a.getAttribute('href').split('/')[2] || '').trim();
    if (!slug || slug === 'lib' || out[slug]) return;
    var img = card.querySelector('img');
    var txt = card.querySelector('.game-text-centered');
    var title = (img && img.getAttribute('alt')) || (txt && txt.textContent) || a.getAttribute('title') || '';
    title = title.trim();
    if (!title) title = slug.replace(/-/g, ' ');
    out[slug] = { title: title, extId: slug, url: 'https://backloggd.com/games/' + slug + '/', cover: img && img.src && img.src.indexOf('data:') !== 0 ? absUrl(img.src) : undefined };
    added++;
  });
  return added;
}
async function collectBackloggd() {
  if (!/^\/u\/[^/]+/.test(location.pathname)) throw new Error('Откройте раздел своего профиля Backloggd с играми, например список Backlog');
  var out = {};
  for (var p = 1; p <= 150; p++) {
    var u = new URL(location.href);
    u.searchParams.set('page', p);
    status('Читаю страницу ' + p + '… найдено ' + Object.keys(out).length);
    var doc = p === 1 && !new URL(location.href).searchParams.get('page') ? document : await getDoc(u.href);
    var added = backloggdFromDoc(doc, out);
    // страница без новых игр — значит, дошли до конца
    if (!added) break;
    await sleep(350);
  }
  return Object.keys(out).map(function (k) { return out[k]; });
}

/* ---------- Epic ---------- */
async function collectEpic() {
  var out = [], token = '';
  for (var i = 0; i < 200; i++) {
    status('Загружаю историю покупок Epic… ' + out.length);
    var url = '/account/v2/payment/ajaxGetOrderHistory?sortDir=DESC&sortBy=DATE&locale=en-US' + (token ? '&nextPageToken=' + encodeURIComponent(token) : '');
    var r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error('Epic вернул ' + r.status + '. Войдите в аккаунт и откройте epicgames.com/account/transactions');
    var j = await r.json();
    (j.orders || []).forEach(function (o) {
      if (o.orderType && /refund/i.test(o.orderType)) return;
      (o.items || []).forEach(function (it) {
        if (it.description) out.push({ title: it.description, extId: it.offerId || it.namespace });
      });
    });
    token = j.nextPageToken;
    if (!token || !(j.orders || []).length) break;
    await sleep(250);
  }
  // DLC и наборы обычно содержат эти слова — их отсекаем
  return out.filter(function (g) { return !/\b(DLC|Soundtrack|Season Pass|Pack|Bundle|Currency|V-Bucks|Points|Coins)\b/i.test(g.title); });
}

/* ---------- универсальный: выделение или обложки ---------- */
function collectGeneric() {
  var sel = String(window.getSelection ? window.getSelection() : '').trim();
  if (sel) return sel.split(/\n+/).map(function (t) { return { title: t.trim() }; });
  var bad = /^(logo|avatar|icon|profile|banner|image|img|cover|photo|user|thumbnail|\d+)$/i;
  var res = [];
  document.querySelectorAll('img[alt]').forEach(function (img) {
    var alt = (img.getAttribute('alt') || '').trim();
    var w = img.getBoundingClientRect().width || img.naturalWidth;
    if (alt.length < 2 || alt.length > 120 || bad.test(alt) || w < 50) return;
    alt = alt.replace(/\s*(cover|box art|обложка|thumbnail)$/i, '').trim();
    res.push({ title: alt, cover: img.currentSrc || img.src });
  });
  if (!res.length) throw new Error('Не нашёл игр. Выделите список названий мышкой и нажмите закладку ещё раз.');
  return res;
}

async function run(src) {
  status('Ищу игры…');
  try {
    var list;
    if (src === 'steam' && detected === 'steam') list = await collectSteam();
    else if (src === 'backloggd' && detected === 'backloggd') list = await collectBackloggd();
    else if (src === 'epic' && detected === 'epic') {
      try { list = await collectEpic(); }
      catch (e) { status(e.message + ' Пробую собрать со страницы…'); list = collectGeneric(); }
    } else list = collectGeneric();
    setItems(list);
  } catch (e) {
    status('⚠️ ' + e.message);
  }
}
run(detected);
