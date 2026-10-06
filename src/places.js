// 入力中の文字から場所の候補を出す
// - GOOGLE_MAPS_API_KEY があれば Google Places API (New) の Autocomplete。候補の placeId をそのままルート検索に使う
// - なければ Photon（OpenStreetMap のデータを使う、入力中の検索向けの公開サーバー）。候補の座標をルート検索に使う
import { RoutingError } from './messages.js';

const MAX_RESULTS = 6;

// ---- Google Places API (New) ----
// https://developers.google.com/maps/documentation/places/web-service/place-autocomplete

const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const FIELD_MASK = [
  'suggestions.placePrediction.placeId',
  'suggestions.placePrediction.text.text',
  'suggestions.placePrediction.structuredFormat',
].join(',');

export async function googleSuggest(apiKey, { q, near, sessionToken, lang = 'ja' }, fetchImpl = fetch) {
  // 候補の名前・住所は画面の言語で返してもらう（日本国内に限る）
  const body = { input: q, languageCode: lang, regionCode: 'jp', includedRegionCodes: ['jp'] };
  if (near) body.locationBias = { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 50000 } };
  // 同じ入力欄での一連の検索を 1 回の「セッション」として課金してもらう
  if (sessionToken) body.sessionToken = sessionToken;

  const res = await fetchImpl(AUTOCOMPLETE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELD_MASK },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[places api]', res.status, JSON.stringify(data?.error ?? data));
    throw new RoutingError('placesFailed');
  }
  return (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p) => p?.placeId)
    .slice(0, MAX_RESULTS)
    .map((p) => {
      const name = p.structuredFormat?.mainText?.text || p.text?.text || '';
      return { name, detail: p.structuredFormat?.secondaryText?.text ?? '', placeId: p.placeId };
    });
}

// ---- Photon（OpenStreetMap） ----
// https://photon.komoot.io/ 。公開サーバーは節度ある利用が条件。アクセスが多くなったら自前で立てるか Google に切り替える

const PHOTON_URL = 'https://photon.komoot.io/api/';
// バス停・乗り場は同じ名前で大量に出るので除く（駅は残す）
const NOISE = new Set(['bus_stop', 'stop', 'platform', 'stop_position', 'guidepost', 'information']);

function photonDetail(p) {
  const parts = [p.state, p.county, p.city, p.district, p.locality, p.street];
  if (p.housenumber) parts.push(p.housenumber);
  // 同じ値が続くことがあるので重複を除く。日本以外なら国名を先頭に
  const uniq = [...new Set(parts.filter(Boolean))].filter((v) => v !== p.name);
  if (p.countrycode && p.countrycode !== 'JP' && p.country) uniq.unshift(p.country);
  return uniq.join(' ');
}

async function photonQuery(params, fetchImpl) {
  const res = await fetchImpl(`${PHOTON_URL}?${params}`, { headers: { 'User-Agent': 'travel-master/0.1 (route planner)' } });
  if (!res.ok) throw new RoutingError('placesFailed');
  return (await res.json()).features ?? [];
}

// OpenStreetMap では日本の駅名に「駅」が付かない（「熱海」）ので、表示では付ける
// 英語の名前（Atami）なら " Station"、それ以外（日本語の名前）なら「駅」
function displayName(p) {
  const isStation = p.osm_key === 'railway' && (p.osm_value === 'station' || p.osm_value === 'halt');
  if (!isStation || /(駅|station)$/i.test(p.name)) return p.name;
  return /^[\x20-\x7e]+$/.test(p.name) ? `${p.name} Station` : `${p.name}駅`;
}

export async function photonSuggest({ q, near, lang = 'ja' }, fetchImpl = fetch) {
  const base = new URLSearchParams();
  // Photon の言語は default（現地の名前）/ en / de / fr だけ。英語のときだけ英語の名前にする
  if (lang === 'en') base.set('lang', 'en');
  if (near) {
    base.set('lat', String(near.lat));
    base.set('lon', String(near.lng));
  }
  const main = new URLSearchParams(base);
  main.set('q', q);
  main.set('limit', '15');
  const queries = [photonQuery(main, fetchImpl)];
  // 「熱海駅」と打たれたら、「熱海」という名前の駅も探して先頭に出す
  const stationName = q.endsWith('駅') ? q.slice(0, -1).trim() : /\sstation$/i.test(q) ? q.replace(/\s+station$/i, '') : '';
  if (stationName) {
    const st = new URLSearchParams(base);
    st.set('q', stationName);
    st.set('limit', '5');
    st.append('osm_tag', 'railway:station');
    st.append('osm_tag', 'railway:halt');
    queries.unshift(photonQuery(st, fetchImpl));
  }
  const features = (await Promise.all(queries)).flat();

  const seen = new Set();
  const out = [];
  for (const f of features) {
    const p = f.properties ?? {};
    const [lng, lat] = f.geometry?.coordinates ?? [];
    if (!p.name || !Number.isFinite(lat) || !Number.isFinite(lng) || NOISE.has(p.osm_value)) continue;
    const name = displayName(p);
    const key = `${name}|${p.state ?? ''}|${p.city ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, detail: photonDetail(p), lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 });
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}
