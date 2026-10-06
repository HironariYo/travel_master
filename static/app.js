// ドライブ旅程プランナーの画面
import { applyStatic, getLang, getLocale, LANGS, setLang, t } from './i18n.js';

const STORAGE_KEY = 'travel-master:plan';
const LEG_COLORS = ['#2563eb', '#d97706', '#059669', '#db2777', '#7c3aed', '#0891b2', '#dc2626', '#65a30d', '#9333ea'];

const $ = (sel, root = document) => root.querySelector(sel);
const stopsEl = $('#stops');
const form = $('#plan-form');
const template = $('#stop-template');
let maxStops = 10;
// 最後に計算した結果（言語を切り替えたときに表示し直す）
let lastResult = null;

// ---------- 入力欄 ----------

function pad(n) {
  return String(n).padStart(2, '0');
}

// 日本国内のドライブを計画するアプリなので、時刻は端末の設定によらず日本時間で入力・表示する
// （駐車区間の曜日・利用時間も日本時間で判定する）
const TIME_ZONE = 'Asia/Tokyo';
const JST_OFFSET = 9 * 60 * 60 * 1000;

// 初期値: 明日の 9:00（日本時間）
function defaultStart() {
  const d = new Date(Date.now() + JST_OFFSET + 24 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T09:00`;
}

// datetime-local の値（タイムゾーンなし）を日本時間として ISO 形式にする
function jstInputToIso(value) {
  return new Date(`${value.length === 16 ? `${value}:00` : value}+09:00`).toISOString();
}

function addStop(values = {}) {
  if (stopsEl.children.length >= maxStops) {
    showError(t('maxStops', { n: maxStops }));
    return;
  }
  const node = template.content.firstElementChild.cloneNode(true);
  setupCombo(node);
  $('[name=place]', node).value = values.place ?? '';
  setSelection(node, values.placeId || Number.isFinite(values.lat) ? values : null);
  $('[name=stayMinutes]', node).value = values.stayMinutes ?? 60;
  $('[name=departAt]', node).value = values.departAt ?? '';
  // 区間の条件。指定がなければ「全区間まとめて」の状態に合わせる
  $('[name=legAvoidTolls]', node).checked = values.avoidTolls ?? masterValue('avoidTolls');
  $('[name=legAvoidHighways]', node).checked = values.avoidHighways ?? masterValue('avoidHighways');
  $('[name=parking]', node).checked = Boolean(values.parking);
  stopsEl.append(node);
  relabel();
  return node;
}

// ---------- 有料道路・高速道路の条件 ----------
// 各目的地の「ここまでの道」が本体。上の「全区間まとめて」は全部をそろえるためのスイッチで、
// 区間ごとにばらばらのときは「一部」（indeterminate）を表示する

const LEG_FIELDS = { avoidTolls: 'legAvoidTolls', avoidHighways: 'legAvoidHighways' };

function legBoxes(key) {
  return [...stopsEl.children].slice(1).map((li) => $(`[name=${LEG_FIELDS[key]}]`, li));
}

function masterValue(key) {
  const box = form[key];
  return box.checked && !box.indeterminate;
}

function syncMasters() {
  for (const key of Object.keys(LEG_FIELDS)) {
    const values = legBoxes(key).map((b) => b.checked);
    const all = values.length > 0 && values.every(Boolean);
    const some = values.some(Boolean);
    form[key].checked = all;
    form[key].indeterminate = some && !all;
  }
}

for (const key of Object.keys(LEG_FIELDS)) {
  form[key].addEventListener('change', () => {
    for (const box of legBoxes(key)) box.checked = form[key].checked;
    form[key].indeterminate = false;
  });
}
stopsEl.addEventListener('change', (e) => {
  if (e.target.name === 'legAvoidTolls' || e.target.name === 'legAvoidHighways') syncMasters();
});

function stopName(i) {
  return i === 0 ? t('origin') : t('destination', { n: i });
}

function relabel() {
  [...stopsEl.children].forEach((li, i) => {
    const first = i === 0;
    li.classList.toggle('is-origin', first);
    $('.stop-label', li).textContent = stopName(i);
    $('.depart-label', li).textContent = t(first ? 'departOrigin' : 'departStop');
    $('[name=departAt]', li).required = first;
    $('[data-action=remove]', li).disabled = stopsEl.children.length <= 2;
    $('[data-action=up]', li).disabled = first;
    $('[data-action=down]', li).disabled = i === stopsEl.children.length - 1;
  });
  $('#add-stop').disabled = stopsEl.children.length >= maxStops;
  syncMasters();
}

stopsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const li = btn.closest('.stop');
  if (btn.dataset.action === 'remove') li.remove();
  if (btn.dataset.action === 'up' && li.previousElementSibling) li.previousElementSibling.before(li);
  if (btn.dataset.action === 'down' && li.nextElementSibling) li.nextElementSibling.after(li);
  relabel();
  save();
});

$('#add-stop').addEventListener('click', () => {
  const node = addStop();
  $('[name=place]', node)?.focus();
  save();
});

$('#reset').addEventListener('click', () => {
  stopsEl.replaceChildren();
  form.avoidTolls.checked = false;
  form.avoidHighways.checked = false;
  addStop({ departAt: defaultStart() });
  addStop();
  clearResults();
  save();
});

form.addEventListener('input', () => {
  save();
  // 結果を出したあとに入力を変えたら、まだ反映されていないことを知らせる
  if (!$('#summary').hidden) showStatus(t('inputChanged'));
});

function readForm() {
  return {
    stops: [...stopsEl.children].map((li) => ({
      place: $('[name=place]', li).value.trim(),
      ...selectionOf(li),
      stayMinutes: Number($('[name=stayMinutes]', li).value || 0),
      departAt: $('[name=departAt]', li).value,
      avoidTolls: $('[name=legAvoidTolls]', li).checked,
      avoidHighways: $('[name=legAvoidHighways]', li).checked,
      parking: $('[name=parking]', li).checked,
    })),
  };
}

function fillForm(plan) {
  stopsEl.replaceChildren();
  // 以前の形式（条件が全体に 1 つだけ）で保存・共有された計画は、その条件を全区間に当てはめる
  const fallback = { avoidTolls: Boolean(plan.avoidTolls), avoidHighways: Boolean(plan.avoidHighways) };
  plan.stops.forEach((s) => addStop({ ...fallback, ...s }));
  while (stopsEl.children.length < 2) addStop();
}

// 入力内容はこのブラウザにだけ保存する。共有は URL（#plan=...）で行う
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(readForm()));
  } catch {
    /* 保存できない環境では何もしない */
  }
}

function encodePlan(plan) {
  const bytes = new TextEncoder().encode(JSON.stringify(plan));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodePlan(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function loadInitialPlan() {
  const m = /[#&]plan=([^&]+)/.exec(location.hash);
  if (m) {
    try {
      return { plan: decodePlan(m[1]), fromUrl: true };
    } catch {
      /* 壊れた URL は無視する */
    }
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved?.stops?.length) return { plan: saved, fromUrl: false };
  } catch {
    /* 読めなければ初期値 */
  }
  return { plan: { stops: [{ departAt: defaultStart(), stayMinutes: 0 }, {}] }, fromUrl: false };
}

// ---------- 場所の候補 ----------
// 2 文字以上打つと /api/places に問い合わせ、候補を一覧で出す。選ぶと Place ID か座標を地点に覚えさせる

const SUGGEST_DELAY = 250;
let listSeq = 0;

function selectionOf(li) {
  const d = li.dataset;
  const out = {};
  if (d.placeId) out.placeId = d.placeId;
  if (d.lat && d.lng) Object.assign(out, { lat: Number(d.lat), lng: Number(d.lng) });
  return out;
}

// 候補を選んだ状態（placeId・座標と、選んだときの文字）を地点に保存する。null で解除
function setSelection(li, sel) {
  const d = li.dataset;
  delete d.placeId;
  delete d.lat;
  delete d.lng;
  delete d.selectedText;
  if (sel) {
    if (sel.placeId) d.placeId = sel.placeId;
    if (Number.isFinite(sel.lat) && Number.isFinite(sel.lng)) {
      d.lat = String(sel.lat);
      d.lng = String(sel.lng);
    }
    d.selectedText = sel.place ?? sel.name;
  }
  $('.place-check', li).hidden = !sel;
  li.classList.toggle('is-selected', Boolean(sel));
}

// 候補の検索を近くに寄せる: 直前の地点（なければ直後の地点）で選んだ場所の座標
function nearFor(li) {
  for (const sib of [li.previousElementSibling, li.nextElementSibling]) {
    if (sib?.dataset.lat) return { lat: sib.dataset.lat, lng: sib.dataset.lng };
  }
  return null;
}

function newSessionToken() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function setupCombo(li) {
  const input = $('[name=place]', li);
  const list = $('.suggestions', li);
  const id = `sugg-${++listSeq}`;
  list.id = id;
  input.id = `${id}-input`;
  $('.place-label', li).htmlFor = input.id;
  input.setAttribute('aria-controls', id);
  let items = [];
  let active = -1;
  let timer = null;
  let controller = null;
  let session = null;

  function close() {
    list.hidden = true;
    list.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    items = [];
    active = -1;
  }

  function highlight(i) {
    active = i;
    [...list.children].forEach((el, j) => el.setAttribute('aria-selected', String(j === i)));
    if (i >= 0) {
      input.setAttribute('aria-activedescendant', `${id}-${i}`);
      list.children[i]?.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  function choose(i) {
    const item = items[i];
    if (!item) return;
    input.value = item.name;
    setSelection(li, { ...item, place: item.name });
    session = null; // 選んだらセッションは終わり
    close();
    save();
  }

  function render(message) {
    list.replaceChildren();
    if (message) {
      const el = document.createElement('li');
      el.className = 'sugg-empty';
      el.textContent = message;
      list.append(el);
    }
    items.forEach((item, i) => {
      const el = document.createElement('li');
      el.id = `${id}-${i}`;
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', 'false');
      const name = document.createElement('span');
      name.className = 'sugg-name';
      name.textContent = item.name;
      el.append(name);
      if (item.detail) {
        const detail = document.createElement('span');
        detail.className = 'sugg-detail';
        detail.textContent = item.detail;
        el.append(detail);
      }
      // blur より先に選べるよう mousedown で拾う
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        choose(i);
      });
      list.append(el);
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    active = -1;
  }

  async function search(q) {
    controller?.abort();
    controller = new AbortController();
    session ??= newSessionToken();
    const params = new URLSearchParams({ q, session, lang: getLang() });
    const near = nearFor(li);
    if (near) {
      params.set('lat', near.lat);
      params.set('lng', near.lng);
    }
    try {
      const res = await fetch(`/api/places?${params}`, { signal: controller.signal });
      const data = await res.json().catch(() => ({}));
      if (input.value.trim() !== q || document.activeElement !== input) return;
      if (!res.ok) {
        items = [];
        return render(data.error || t('placesFailed'));
      }
      items = data.suggestions ?? [];
      render(items.length ? '' : t('noSuggestions'));
    } catch (err) {
      if (err.name !== 'AbortError') {
        items = [];
        render(t('placesFailed'));
      }
    }
  }

  input.addEventListener('input', () => {
    // 選んだあとに文字を変えたら、選択は取り消す
    if (li.dataset.selectedText !== undefined && input.value !== li.dataset.selectedText) setSelection(li, null);
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return close();
    timer = setTimeout(() => search(q), SUGGEST_DELAY);
  });

  input.addEventListener('keydown', (e) => {
    if (list.hidden || !items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlight((active + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlight(active <= 0 ? items.length - 1 : active - 1);
    } else if (e.key === 'Enter') {
      // 候補が開いているときの Enter は送信ではなく選択
      e.preventDefault();
      choose(active >= 0 ? active : 0);
    } else if (e.key === 'Escape') {
      close();
    }
  });

  input.addEventListener('blur', () => {
    clearTimeout(timer);
    controller?.abort();
    close();
  });
}

// ---------- 地図 ----------

// 地図ライブラリ（Leaflet）が読み込めなくても、時刻表は使えるようにする
const map = window.L ? L.map('map', { scrollWheelZoom: false }).setView([36.2, 138.25], 5) : null;
if (map) {
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
} else {
  $('#map').textContent = t('mapUnavailable');
  $('#map').classList.add('map-unavailable');
}
const routeLayer = map ? L.featureGroup().addTo(map) : null;

// encoded polyline を座標の配列にする。精度は Google が 1e5、Valhalla（OpenStreetMap）が 1e6
function decodePolyline(str, precision = 5) {
  const factor = 10 ** precision;
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < str.length) {
    for (const axis of [0, 1]) {
      let result = 0;
      let shift = 0;
      let b;
      do {
        b = str.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lng += delta;
    }
    points.push([lat / factor, lng / factor]);
  }
  return points;
}

function numberedIcon(label, cls) {
  return L.divIcon({ className: `pin ${cls}`, html: `<span>${label}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
}

function drawMap(result) {
  if (!map) return;
  routeLayer.clearLayers();
  result.legs.forEach((leg, i) => {
    if (!leg.polyline) return;
    L.polyline(decodePolyline(leg.polyline, leg.polylinePrecision), { color: LEG_COLORS[i % LEG_COLORS.length], weight: 5, opacity: 0.85 })
      .bindTooltip(t('legTooltip', { from: stopName(leg.from), to: stopName(leg.to), duration: formatDuration(leg.durationSeconds) }))
      .addTo(routeLayer);
  });
  result.stops.forEach((s) => {
    if (s.parking?.status !== 'ok') return;
    const p = [s.parking.point.lat, s.parking.point.lng];
    if (s.location) L.polyline([p, [s.location.lat, s.location.lng]], { color: '#475569', weight: 3, dashArray: '4 6' }).addTo(routeLayer);
    L.marker(p, { icon: L.divIcon({ className: 'pin pin-parking', html: '<span>P</span>', iconSize: [24, 24], iconAnchor: [12, 12] }), title: t('parkingZone') })
      .bindPopup(
        `<strong>${escapeHtml(t('parkingPopup', { place: s.place }))}</strong><br>${escapeHtml(parkingDetail(s.parking))}<br>` +
          escapeHtml(t('walkToDestination', { n: s.parking.walkMinutes })),
      )
      .addTo(routeLayer);
  });
  result.stops.forEach((s, i) => {
    if (!s.location) return;
    const label = i === 0 ? 'S' : String(i);
    const cls = i === 0 ? 'pin-start' : s.final ? 'pin-end' : '';
    L.marker([s.location.lat, s.location.lng], { icon: numberedIcon(label, cls), title: s.place })
      .bindPopup(`<strong>${escapeHtml(s.place)}</strong><br>${popupTimes(s)}`)
      .addTo(routeLayer);
  });
  if (routeLayer.getLayers().length) map.fitBounds(routeLayer.getBounds(), { padding: [30, 30] });
}

function popupTimes(s) {
  const parts = [];
  if (s.arrival) parts.push(`${t('arrive')} ${formatTime(s.arrival)}`);
  if (!s.final || s.stayMinutes) parts.push(`${t(s.final ? 'end' : 'depart')} ${formatTime(s.departure)}`);
  return parts.join(' / ');
}

// ---------- 表示 ----------

// 日付・時刻の書き方は言語に合わせ、タイムゾーンはいつも日本時間
let dateFmt;
let timeFmt;
function setupFormats() {
  dateFmt = new Intl.DateTimeFormat(getLocale(), { timeZone: TIME_ZONE, month: 'numeric', day: 'numeric', weekday: 'short' });
  timeFmt = new Intl.DateTimeFormat(getLocale(), { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false });
}
setupFormats();

function dayKey(ms) {
  return Math.floor((ms + JST_OFFSET) / (24 * 60 * 60 * 1000));
}

function formatTime(ms) {
  return timeFmt.format(new Date(ms));
}

function formatDateTime(ms) {
  return `${dateFmt.format(new Date(ms))} ${formatTime(ms)}`;
}

function formatDuration(totalSeconds) {
  const minutes = Math.round(totalSeconds / 60);
  return t('duration', { h: Math.floor(minutes / 60), m: minutes % 60 });
}

function formatDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 100000 ? 0 : 1)} km` : `${m} m`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Google マップに渡す場所: Place ID があれば名前と ID、OpenStreetMap の候補から選んだ地点は座標、それ以外は打った文字
function placeParam(s) {
  if (!s.placeId && s.pinned && s.location) return `${s.location.lat},${s.location.lng}`;
  return s.place;
}

// 車で向かう先: 駐車区間に停める地点はその場所（座標）、それ以外は地点そのもの
function driveTarget(s) {
  if (s.parking?.status === 'ok') return { param: `${s.parking.point.lat},${s.parking.point.lng}`, placeId: null };
  return { param: placeParam(s), placeId: s.placeId };
}

// Google マップのルート URL（https://developers.google.com/maps/documentation/urls/get-started）
// 出発時刻は URL では指定できないので、時刻の検証は Google マップ側で行う
function googleMapsUrl(stops) {
  const params = new URLSearchParams({ api: '1', travelmode: 'driving' });
  const [first, ...rest] = stops.map(driveTarget);
  const last = rest.pop();
  const mid = rest;
  params.set('origin', first.param);
  if (first.placeId) params.set('origin_place_id', first.placeId);
  params.set('destination', last.param);
  if (last.placeId) params.set('destination_place_id', last.placeId);
  if (mid.length) {
    params.set('waypoints', mid.map((x) => x.param).join('|'));
    // waypoint_place_ids は waypoints と同じ数でないと無視されるので、全部あるときだけ付ける
    if (mid.every((x) => x.placeId)) params.set('waypoint_place_ids', mid.map((x) => x.placeId).join('|'));
  }
  return `https://www.google.com/maps/dir/?${params}`;
}

function googlePlaceUrl(s) {
  const params = new URLSearchParams({ api: '1', query: placeParam(s) });
  if (s.placeId) params.set('query_place_id', s.placeId);
  return `https://www.google.com/maps/search/?${params}`;
}

function renderSummary(result) {
  const sum = result.totals;
  const el = $('#summary');
  el.innerHTML = `
    <dl>
      <div><dt>${t('sumStart')}</dt><dd>${formatDateTime(sum.start)}</dd></div>
      <div><dt>${t('sumEnd')}</dt><dd>${formatDateTime(sum.end)}</dd></div>
      <div><dt>${t('sumTotal')}</dt><dd>${formatDuration((sum.end - sum.start) / 1000)}</dd></div>
      <div><dt>${t('sumDrive')}</dt><dd>${formatDuration(sum.driveSeconds)}</dd></div>
      <div><dt>${t('sumDistance')}</dt><dd>${formatDistance(sum.distanceMeters)}</dd></div>
      <div><dt>${t('sumStayWait')}</dt><dd>${formatDuration((sum.stayMinutes + sum.waitMinutes) * 60)}</dd></div>
      ${sum.walkMinutes ? `<div><dt>${t('sumWalk')}</dt><dd>${formatDuration(sum.walkMinutes * 60)}</dd></div>` : ''}
    </dl>
    <p class="conditions">${escapeHtml(t('conditionsLabel', { text: planConditionText(result.legs) }))}</p>`;
  el.hidden = false;
}

function conditionText(options = {}) {
  const parts = [];
  if (options.avoidTolls) parts.push(t('avoidTolls'));
  if (options.avoidHighways) parts.push(t('avoidHighways'));
  return parts.length ? parts.join(t('condJoin')) : t('condNone');
}

// 全区間が同じ条件ならその内容、違えば「区間ごと」
function planConditionText(legs) {
  const texts = [...new Set(legs.map((l) => conditionText(l.options)))];
  return texts.length === 1 ? texts[0] : t('condPerLeg');
}

function legConditionTags(options = {}) {
  const tags = [];
  if (options.avoidTolls) tags.push(t('tagNoToll'));
  if (options.avoidHighways) tags.push(t('tagNoHighway'));
  return tags.map((tag) => `<span class="tag tag-avoid">${escapeHtml(tag)}</span>`).join('');
}

function renderLinks(result) {
  const el = $('#links');
  el.innerHTML = `
    <a class="btn btn-primary" href="${escapeHtml(googleMapsUrl(result.stops))}" target="_blank" rel="noopener">${t('openAll')}</a>
    <button type="button" class="btn btn-ghost" id="share">${t('share')}</button>
    <button type="button" class="btn btn-ghost" id="copy-text">${t('copyText')}</button>`;
  el.hidden = false;
  $('#share').addEventListener('click', () => copy(`${location.origin}${location.pathname}#plan=${encodePlan(readForm())}`, '#share'));
  $('#copy-text').addEventListener('click', () => copy(scheduleText(result), '#copy-text'));
  // 駐車区間のデータは CC BY 4.0。使ったときは出典を出す
  const src = $('#source');
  src.hidden = !result.parkingSource;
  if (result.parkingSource) {
    const { url, dataDate } = result.parkingSource;
    const link = `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(t('sourceName'))}</a>`;
    src.innerHTML = t('source', { link, date: escapeHtml(dataDate ?? '') });
  }
}

async function copy(text, sel) {
  const btn = $(sel);
  const label = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = t('copied');
  } catch {
    window.prompt(t('copyPrompt'), text);
  }
  setTimeout(() => (btn.textContent = label), 1500);
}

function scheduleText(result) {
  const lines = [];
  result.stops.forEach((s, i) => {
    const leg = result.legs[i - 1];
    if (leg) lines.push(t('textCar', { duration: formatDuration(leg.durationSeconds), distance: formatDistance(leg.distanceMeters) }));
    const head = stopName(i);
    const times = [
      s.arrival ? t('textArrive', { time: formatDateTime(s.arrival) }) : null,
      !s.final || s.stayMinutes ? t(s.final ? 'textEnd' : 'textDepart', { time: formatDateTime(s.departure) }) : null,
    ]
      .filter(Boolean)
      .join(' → ');
    lines.push(`${head}: ${s.place}  ${times}`);
    if (s.parking && s.parking.status !== 'ok') lines.push(`  🅿 ${t('noParking')}`);
    if (s.parking?.status === 'ok') {
      const p = s.parking;
      const detail = parkingDetail(p);
      lines.push(`${t('textParking', { meters: p.distanceMeters, walk: p.walkMinutes, detail })} https://www.google.com/maps/search/?api=1&query=${p.point.lat},${p.point.lng}`);
    }
  });
  lines.push('', `${t('textGoogleMaps')}: ${googleMapsUrl(result.stops)}`);
  return lines.join('\n');
}

// ---------- 駐車区間 ----------

const CLOSED_KEYS = { sunHoliday: 'closedSunHoliday', weekendHoliday: 'closedWeekendHoliday' };

const zoneHours = (z) => t('hours', { from: z.from, to: z.to });

function parkingDetail(p) {
  const z = p.zone;
  return t('parkingDetail', {
    kind: t(z.kind === 'ticket' ? 'ticket' : 'meter'),
    hours: zoneHours(z),
    closed: z.closed ? t(CLOSED_KEYS[z.closed]) : '',
    limit: z.limitMinutes,
    fee: z.fee,
  });
}

// サーバーが返す理由のコード（{ code, ... }）を今の言語の文にする
function reasonText(reason) {
  if (!reason) return '';
  if (reason.code === 'newYear') return t('reasonNewYear');
  if (reason.code === 'closed') return t('reasonClosed', { days: t(CLOSED_KEYS[reason.closed]) });
  if (reason.code === 'outsideHours') return t('reasonOutsideHours', { hours: t('hours', { from: reason.from, to: reason.to }) });
  if (reason.code === 'noLocation') return t('reasonNoLocation');
  return '';
}

function parkingWarnings(p) {
  const z = p.zone;
  return p.warnings
    .map((w) => {
      if (w === 'overLimit') return t('warnOverLimit', { minutes: p.parkMinutes, limit: z.limitMinutes });
      if (w === 'overHours') return t('warnOverHours', { hours: zoneHours(z) });
      if (w === 'unavailableAtArrival') return t('warnUnavailableAtArrival', { reason: reasonText(p.arrivalReason) });
      if (w === 'holidayUnknown') return t('warnHolidayUnknown');
      return null;
    })
    .filter(Boolean);
}

function parkingHtml(s) {
  const p = s.parking;
  if (p.status === 'ok') {
    const mapUrl = `https://www.google.com/maps/search/?${new URLSearchParams({ api: '1', query: `${p.point.lat},${p.point.lng}` })}`;
    const warns = parkingWarnings(p).map((w) => `<li>⚠ ${escapeHtml(w)}</li>`).join('');
    return `
      <div class="parking">
        <div>🅿 <strong>${escapeHtml(t('parkHere'))}</strong>: ${escapeHtml(t('parkDistance', { meters: p.distanceMeters, walk: p.walkMinutes }))}
          <a href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener" class="tl-link">${escapeHtml(t('parkingSpot'))}</a></div>
        <div class="parking-detail">${escapeHtml(parkingDetail(p))}</div>
        ${warns ? `<ul class="parking-warn">${warns}</ul>` : ''}
      </div>`;
  }
  // 1 km 以内に使える区間がない。近くにあっても到着時刻に使えないときは、その理由だけ添える
  const reason = p.status === 'unavailable' ? t('noParkingReason', { reason: reasonText(p.reason) }) : '';
  return `<div class="parking is-none">🅿 ${escapeHtml(t('noParking') + reason)}</div>`;
}

function renderTimeline(result) {
  const el = $('#timeline');
  el.replaceChildren();
  let lastDay = null;

  result.stops.forEach((s, i) => {
    const leg = result.legs[i - 1];
    if (leg) {
      const li = document.createElement('li');
      li.className = 'tl-leg';
      li.style.setProperty('--leg-color', LEG_COLORS[(i - 1) % LEG_COLORS.length]);
      const legStops = [result.stops[i - 1], s];
      li.innerHTML = `
        <span class="tl-leg-line" aria-hidden="true"></span>
        <span class="tl-leg-text">🚗 ${formatDuration(leg.durationSeconds)}${t('sep')}${formatDistance(leg.distanceMeters)}${leg.trafficAware ? `<span class="tag">${t('tagTraffic')}</span>` : ''}${legConditionTags(leg.options)}</span>
        ${leg.unavoidable?.length ? `<span class="tl-leg-warn">${escapeHtml(t('unavoidable', { roads: leg.unavoidable.map((k) => t(k)).join(t('condJoin')) }))}</span>` : ''}
        <a href="${escapeHtml(googleMapsUrl(legStops))}" target="_blank" rel="noopener" class="tl-link">${t('legLink')}</a>`;
      el.append(li);
    }

    const day = dayKey(s.arrival ?? s.departure);
    if (day !== lastDay) {
      const d = document.createElement('li');
      d.className = 'tl-day';
      d.textContent = dateFmt.format(new Date(s.arrival ?? s.departure));
      el.append(d);
      lastDay = day;
    }

    const li = document.createElement('li');
    li.className = `tl-stop${i === 0 ? ' is-origin' : ''}${s.final ? ' is-final' : ''}${s.late ? ' is-late' : ''}`;
    const rows = [];
    if (s.arrival) rows.push(`<div><dt>${t('arrive')}</dt><dd>${formatTime(s.arrival)}</dd></div>`);
    if (s.walkMinutes) rows.push(`<div><dt>${t('walk')}</dt><dd>${t('walkOneWay', { n: s.walkMinutes })}</dd></div>`);
    if (i > 0 && s.stayMinutes) rows.push(`<div><dt>${t('stay')}</dt><dd>${formatDuration(s.stayMinutes * 60)}</dd></div>`);
    if (s.waitMinutes) rows.push(`<div><dt>${t('wait')}</dt><dd>${formatDuration(s.waitMinutes * 60)}</dd></div>`);
    if (!s.final || s.stayMinutes) {
      const crossesDay = s.arrival && dayKey(s.arrival) !== dayKey(s.departure);
      rows.push(`<div><dt>${t(s.final ? 'end' : 'depart')}</dt><dd>${crossesDay ? formatDateTime(s.departure) : formatTime(s.departure)}</dd></div>`);
    }
    li.innerHTML = `
      <div class="tl-marker">${i === 0 ? 'S' : i}</div>
      <div class="tl-body">
        <div class="tl-title">
          <strong>${escapeHtml(s.place)}</strong>
          <a href="${escapeHtml(googlePlaceUrl(s))}" target="_blank" rel="noopener" class="tl-link">${t('placeLink')}</a>
        </div>
        <dl class="tl-times">${rows.join('')}</dl>
        ${s.parking ? parkingHtml(s) : ''}
        ${s.late ? `<p class="warn">${escapeHtml(t('late', { duration: formatDuration(s.lateMinutes * 60) }))}</p>` : ''}
      </div>`;
    el.append(li);
  });
}

function clearResults() {
  lastResult = null;
  routeLayer?.clearLayers();
  $('#timeline').replaceChildren();
  $('#summary').hidden = true;
  $('#links').hidden = true;
  $('#source').hidden = true;
  $('#empty').hidden = false;
  showError('');
  showStatus('');
}

function showStatus(message) {
  const el = $('#status');
  el.textContent = message;
  el.hidden = !message;
}

function showError(message) {
  const el = $('#error');
  el.textContent = message;
  el.hidden = !message;
}

// ---------- 計算 ----------

function renderResult(data) {
  $('#empty').hidden = true;
  const badge = $('#provider');
  badge.textContent = t(data.provider === 'google' ? 'providerGoogle' : 'providerOsm');
  badge.hidden = false;
  drawMap(data);
  renderSummary(data);
  renderLinks(data);
  renderTimeline(data);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');
  const plan = readForm();
  const missing = plan.stops.findIndex((s) => !s.place);
  if (missing >= 0) return showError(t('enterPlace', { name: stopName(missing) }));
  if (!plan.stops[0].departAt) return showError(t('enterDeparture'));

  // datetime-local はタイムゾーンを持たないので、日本時間として ISO 形式に直して送る
  const body = {
    ...plan,
    lang: getLang(),
    stops: plan.stops.map((s) => ({ ...s, departAt: s.departAt ? jstInputToIso(s.departAt) : null })),
  };

  const btn = $('#submit');
  showStatus('');
  btn.disabled = true;
  btn.textContent = t('calculating');
  try {
    const res = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || t('httpError', { status: res.status }));
    lastResult = data;
    renderResult(data);
    showStatus(t('calculated', { time: formatTime(Date.now()), conditions: planConditionText(data.legs) }));
    if (window.matchMedia('(max-width: 900px)').matches) $('#result-title').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    showError(err.message || t('network'));
  } finally {
    btn.disabled = false;
    btn.textContent = t('submit');
  }
});

// ---------- 言語 ----------

const langSelect = $('#lang');
for (const l of LANGS) langSelect.add(new Option(l.label, l.code));
langSelect.value = getLang();
langSelect.addEventListener('change', () => {
  setLang(langSelect.value);
  setupFormats();
  applyStatic();
  relabel();
  if (!map) $('#map').textContent = t('mapUnavailable');
  // 結果は、文言・日付の書き方だけ変えて表示し直す（ルートは検索し直さない）
  if (lastResult) renderResult(lastResult);
  showStatus('');
  showError('');
});

// ---------- 起動 ----------

applyStatic();
const initial = loadInitialPlan();
fillForm(initial.plan);
fetch('/api/config')
  .then((r) => r.json())
  .then((cfg) => {
    maxStops = cfg.maxStops || maxStops;
    relabel();
  })
  .catch(() => {});
if (initial.fromUrl) {
  history.replaceState(null, '', location.pathname);
  save();
  form.requestSubmit();
}
