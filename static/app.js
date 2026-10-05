// ドライブ旅程プランナーの画面
const STORAGE_KEY = 'travel-master:plan';
const LEG_COLORS = ['#2563eb', '#d97706', '#059669', '#db2777', '#7c3aed', '#0891b2', '#dc2626', '#65a30d', '#9333ea'];

const $ = (sel, root = document) => root.querySelector(sel);
const stopsEl = $('#stops');
const form = $('#plan-form');
const template = $('#stop-template');
let maxStops = 10;

// ---------- 入力欄 ----------

function pad(n) {
  return String(n).padStart(2, '0');
}

// Date → datetime-local の値（ブラウザのタイムゾーン）
function toLocalInput(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultStart() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return toLocalInput(d);
}

function addStop(values = {}) {
  if (stopsEl.children.length >= maxStops) {
    showError(`地点は ${maxStops} か所までです`);
    return;
  }
  const node = template.content.firstElementChild.cloneNode(true);
  setupCombo(node);
  $('[name=place]', node).value = values.place ?? '';
  setSelection(node, values.placeId || Number.isFinite(values.lat) ? values : null);
  $('[name=stayMinutes]', node).value = values.stayMinutes ?? 60;
  $('[name=departAt]', node).value = values.departAt ?? '';
  stopsEl.append(node);
  relabel();
  return node;
}

function relabel() {
  [...stopsEl.children].forEach((li, i) => {
    const first = i === 0;
    li.classList.toggle('is-origin', first);
    $('.stop-label', li).textContent = first ? '出発地' : `目的地 ${i}`;
    $('.depart-label', li).textContent = first ? '出発日時（必須）' : '出発時刻（任意）';
    $('[name=departAt]', li).required = first;
    $('[data-action=remove]', li).disabled = stopsEl.children.length <= 2;
    $('[data-action=up]', li).disabled = first;
    $('[data-action=down]', li).disabled = i === stopsEl.children.length - 1;
  });
  $('#add-stop').disabled = stopsEl.children.length >= maxStops;
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
  addStop({ departAt: defaultStart() });
  addStop();
  form.avoidTolls.checked = false;
  form.avoidHighways.checked = false;
  clearResults();
  save();
});

form.addEventListener('input', save);

function readForm() {
  return {
    stops: [...stopsEl.children].map((li) => ({
      place: $('[name=place]', li).value.trim(),
      ...selectionOf(li),
      stayMinutes: Number($('[name=stayMinutes]', li).value || 0),
      departAt: $('[name=departAt]', li).value,
    })),
    avoidTolls: form.avoidTolls.checked,
    avoidHighways: form.avoidHighways.checked,
  };
}

function fillForm(plan) {
  stopsEl.replaceChildren();
  plan.stops.forEach((s) => addStop(s));
  while (stopsEl.children.length < 2) addStop();
  form.avoidTolls.checked = Boolean(plan.avoidTolls);
  form.avoidHighways.checked = Boolean(plan.avoidHighways);
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
    const params = new URLSearchParams({ q, session });
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
        return render(data.error || '候補を取得できませんでした');
      }
      items = data.suggestions ?? [];
      render(items.length ? '' : '候補が見つかりません。別の言葉でお試しください');
    } catch (err) {
      if (err.name !== 'AbortError') {
        items = [];
        render('候補を取得できませんでした');
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
  $('#map').textContent = '地図を読み込めませんでした。時刻表と Google マップのリンクは使えます。';
  $('#map').classList.add('map-unavailable');
}
const routeLayer = map ? L.featureGroup().addTo(map) : null;

// Google / OSRM の encoded polyline（精度 1e5）を座標の配列にする
function decodePolyline(str) {
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
    points.push([lat / 1e5, lng / 1e5]);
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
    L.polyline(decodePolyline(leg.polyline), { color: LEG_COLORS[i % LEG_COLORS.length], weight: 5, opacity: 0.85 })
      .bindTooltip(`${leg.from === 0 ? '出発地' : `目的地 ${leg.from}`} → 目的地 ${leg.to}：${formatDuration(leg.durationSeconds)}`)
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
  if (s.arrival) parts.push(`到着 ${formatTime(s.arrival)}`);
  if (!s.final || s.stayMinutes) parts.push(`${s.final ? '終了' : '出発'} ${formatTime(s.departure)}`);
  return parts.join(' / ');
}

// ---------- 表示 ----------

const dateFmt = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' });
const timeFmt = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' });

function dayKey(ms) {
  return new Date(ms).toDateString();
}

function formatTime(ms) {
  return timeFmt.format(new Date(ms));
}

function formatDateTime(ms) {
  return `${dateFmt.format(new Date(ms))} ${formatTime(ms)}`;
}

function formatDuration(totalSeconds) {
  const minutes = Math.round(totalSeconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}分`;
  return m ? `${h}時間${m}分` : `${h}時間`;
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

// Google マップのルート URL（https://developers.google.com/maps/documentation/urls/get-started）
// 出発時刻は URL では指定できないので、時刻の検証は Google マップ側で行う
function googleMapsUrl(stops) {
  const params = new URLSearchParams({ api: '1', travelmode: 'driving' });
  const first = stops[0];
  const last = stops[stops.length - 1];
  const mid = stops.slice(1, -1);
  params.set('origin', placeParam(first));
  if (first.placeId) params.set('origin_place_id', first.placeId);
  params.set('destination', placeParam(last));
  if (last.placeId) params.set('destination_place_id', last.placeId);
  if (mid.length) {
    params.set('waypoints', mid.map(placeParam).join('|'));
    // waypoint_place_ids は waypoints と同じ数でないと無視されるので、全部あるときだけ付ける
    if (mid.every((s) => s.placeId)) params.set('waypoint_place_ids', mid.map((s) => s.placeId).join('|'));
  }
  return `https://www.google.com/maps/dir/?${params}`;
}

function googlePlaceUrl(s) {
  const params = new URLSearchParams({ api: '1', query: placeParam(s) });
  if (s.placeId) params.set('query_place_id', s.placeId);
  return `https://www.google.com/maps/search/?${params}`;
}

function renderSummary(result) {
  const t = result.totals;
  const el = $('#summary');
  el.innerHTML = `
    <dl>
      <div><dt>出発</dt><dd>${formatDateTime(t.start)}</dd></div>
      <div><dt>終了</dt><dd>${formatDateTime(t.end)}</dd></div>
      <div><dt>全体</dt><dd>${formatDuration((t.end - t.start) / 1000)}</dd></div>
      <div><dt>運転</dt><dd>${formatDuration(t.driveSeconds)}</dd></div>
      <div><dt>距離</dt><dd>${formatDistance(t.distanceMeters)}</dd></div>
      <div><dt>滞在・待ち</dt><dd>${formatDuration((t.stayMinutes + t.waitMinutes) * 60)}</dd></div>
    </dl>`;
  el.hidden = false;
}

function renderLinks(result) {
  const el = $('#links');
  el.innerHTML = `
    <a class="btn btn-primary" href="${escapeHtml(googleMapsUrl(result.stops))}" target="_blank" rel="noopener">Google マップで全ルートを開く</a>
    <button type="button" class="btn btn-ghost" id="share">共有リンクをコピー</button>
    <button type="button" class="btn btn-ghost" id="copy-text">旅程をテキストでコピー</button>`;
  el.hidden = false;
  $('#share').addEventListener('click', () => copy(`${location.origin}${location.pathname}#plan=${encodePlan(readForm())}`, '#share'));
  $('#copy-text').addEventListener('click', () => copy(scheduleText(result), '#copy-text'));
}

async function copy(text, sel) {
  const btn = $(sel);
  const label = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'コピーしました';
  } catch {
    window.prompt('コピーしてください', text);
  }
  setTimeout(() => (btn.textContent = label), 1500);
}

function scheduleText(result) {
  const lines = [];
  result.stops.forEach((s, i) => {
    const leg = result.legs[i - 1];
    if (leg) lines.push(`  ↓ 車 ${formatDuration(leg.durationSeconds)}（${formatDistance(leg.distanceMeters)}）`);
    const head = i === 0 ? '出発地' : `目的地 ${i}`;
    const times = [s.arrival ? `${formatDateTime(s.arrival)} 着` : null, !s.final || s.stayMinutes ? `${formatDateTime(s.departure)} ${s.final ? '終了' : '発'}` : null]
      .filter(Boolean)
      .join(' → ');
    lines.push(`${head}: ${s.place}  ${times}`);
  });
  lines.push('', `Google マップ: ${googleMapsUrl(result.stops)}`);
  return lines.join('\n');
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
        <span class="tl-leg-text">🚗 ${formatDuration(leg.durationSeconds)}・${formatDistance(leg.distanceMeters)}${leg.trafficAware ? '<span class="tag">渋滞予測</span>' : ''}</span>
        <a href="${escapeHtml(googleMapsUrl(legStops))}" target="_blank" rel="noopener" class="tl-link">この区間を Google マップで</a>`;
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
    if (s.arrival) rows.push(`<div><dt>到着</dt><dd>${formatTime(s.arrival)}</dd></div>`);
    if (i > 0 && s.stayMinutes) rows.push(`<div><dt>滞在</dt><dd>${formatDuration(s.stayMinutes * 60)}</dd></div>`);
    if (s.waitMinutes) rows.push(`<div><dt>出発待ち</dt><dd>${formatDuration(s.waitMinutes * 60)}</dd></div>`);
    if (!s.final || s.stayMinutes) {
      const crossesDay = s.arrival && dayKey(s.arrival) !== dayKey(s.departure);
      rows.push(`<div><dt>${s.final ? '終了' : '出発'}</dt><dd>${crossesDay ? formatDateTime(s.departure) : formatTime(s.departure)}</dd></div>`);
    }
    li.innerHTML = `
      <div class="tl-marker">${i === 0 ? 'S' : i}</div>
      <div class="tl-body">
        <div class="tl-title">
          <strong>${escapeHtml(s.place)}</strong>
          <a href="${escapeHtml(googlePlaceUrl(s))}" target="_blank" rel="noopener" class="tl-link">地図</a>
        </div>
        <dl class="tl-times">${rows.join('')}</dl>
        ${s.late ? `<p class="warn">指定の出発時刻に ${formatDuration(s.lateMinutes * 60)} 間に合いません。滞在を短くするか、時刻を見直してください。</p>` : ''}
      </div>`;
    el.append(li);
  });
}

function clearResults() {
  routeLayer?.clearLayers();
  $('#timeline').replaceChildren();
  $('#summary').hidden = true;
  $('#links').hidden = true;
  $('#empty').hidden = false;
  showError('');
}

function showError(message) {
  const el = $('#error');
  el.textContent = message;
  el.hidden = !message;
}

// ---------- 計算 ----------

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');
  const plan = readForm();
  const missing = plan.stops.findIndex((s) => !s.place);
  if (missing >= 0) return showError(`${missing === 0 ? '出発地' : `目的地 ${missing}`}を入力してください`);
  if (!plan.stops[0].departAt) return showError('出発地の出発日時を入力してください');

  // datetime-local はタイムゾーンを持たないので、ブラウザの時刻として ISO 形式に直して送る
  const body = {
    ...plan,
    stops: plan.stops.map((s) => ({ ...s, departAt: s.departAt ? new Date(s.departAt).toISOString() : null })),
  };

  const btn = $('#submit');
  btn.disabled = true;
  btn.textContent = '計算中…';
  try {
    const res = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `エラーが発生しました（${res.status}）`);
    $('#empty').hidden = true;
    const badge = $('#provider');
    badge.textContent = data.provider === 'google' ? 'Google Routes API' : 'OpenStreetMap（渋滞は考慮しません）';
    badge.hidden = false;
    drawMap(data);
    renderSummary(data);
    renderLinks(data);
    renderTimeline(data);
    if (window.matchMedia('(max-width: 900px)').matches) $('#result-title').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    showError(err.message || '通信に失敗しました');
  } finally {
    btn.disabled = false;
    btn.textContent = 'ルートとスケジュールを計算';
  }
});

// ---------- 起動 ----------

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
