// 車のルート検索
// - GOOGLE_MAPS_API_KEY があれば Google Routes API（渋滞予測つき）
// - なければ OpenStreetMap（Nominatim で住所を座標に、Valhalla でルート）。開発・お試し用で、渋滞は考慮しない
import { InputError, RoutingError } from './messages.js';

export { RoutingError };

// "35.6812, 139.7671" のような座標の入力
const LATLNG = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
export function parseLatLng(place) {
  const m = LATLNG.exec(place);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

// ---- Google Routes API ----
// https://developers.google.com/maps/documentation/routes/compute_route_directions

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const FIELD_MASK = [
  'routes.duration',
  'routes.staticDuration',
  'routes.distanceMeters',
  'routes.polyline.encodedPolyline',
  'routes.legs.startLocation',
  'routes.legs.endLocation',
  'routes.travelAdvisory.tollInfo',
].join(',');

// 有料道路の料金の払い方 → Routes API の tollPasses
// https://developers.google.com/maps/documentation/routes/calculate_toll_fees
// 日本ではパスなし（現金）だと料金が返らない（2026-10 に確認）ので、現金は ETC の料金を目安として出す。
// NEXCO の高速道路では ETC の通常料金と現金はほぼ同じだが、首都高などは現金のほうが高いことがある
// また Google が料金を持っていない道（首都高だけの区間、圏央道など）は「料金不明」になる
const TOLL_PASSES = { etc2: ['JP_ETC2'], etc: ['JP_ETC'], cash: ['JP_ETC'] };

// Money（units は文字列、nanos は 10^-9）→ 数値
function money(m) {
  return Number(m?.units ?? 0) + Number(m?.nanos ?? 0) / 1e9;
}

// tollInfo → { status: 'priced', amount, currency } / { status: 'unknown' }（有料道路を通るが料金が出ない）/ null（有料道路なし）
export function parseTollInfo(tollInfo) {
  if (!tollInfo) return null;
  const price = (tollInfo.estimatedPrice ?? []).find((p) => p.currencyCode === 'JPY') ?? tollInfo.estimatedPrice?.[0];
  if (!price) return { status: 'unknown' };
  return { status: 'priced', amount: Math.round(money(price)), currency: price.currencyCode };
}

// 候補から選んだ地点は Place ID か座標、手で打った地点は文字（座標の形なら座標）で渡す
function googleWaypoint(stop) {
  if (stop.placeId) return { placeId: stop.placeId };
  const ll = stop.location ?? parseLatLng(stop.place);
  if (ll) return { location: { latLng: { latitude: ll.lat, longitude: ll.lng } } };
  return { address: stop.place };
}

function seconds(duration) {
  // "1234s" の形式
  return Math.round(parseFloat(String(duration ?? '0').replace(/s$/, '')) || 0);
}

function fromGoogleLatLng(loc) {
  const ll = loc?.latLng;
  return ll ? { lat: ll.latitude, lng: ll.longitude } : null;
}

// 現金は ETC の料金からの目安であることを印す
function withEstimate(toll, tollPayment) {
  return toll?.status === 'priced' && tollPayment === 'cash' ? { ...toll, estimate: true } : toll;
}

export function googleRouter(apiKey, fetchImpl = fetch, { lang = 'ja' } = {}) {
  return async function routeLeg(from, to, departureMs, { avoidTolls, avoidHighways, tollPayment = 'none' } = {}, now = Date.now()) {
    // 渋滞予測は未来の出発時刻でしか使えない（過去を指定するとエラーになる）
    const trafficAware = departureMs > now + 60 * 1000;
    const body = {
      origin: googleWaypoint(from),
      destination: googleWaypoint(to),
      travelMode: 'DRIVE',
      routingPreference: trafficAware ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE',
      languageCode: lang,
      regionCode: 'jp',
      units: 'METRIC',
      routeModifiers: { avoidTolls: Boolean(avoidTolls), avoidHighways: Boolean(avoidHighways) },
    };
    if (trafficAware) body.departureTime = new Date(departureMs).toISOString();
    // 料金の計算は Compute Routes Enterprise の料金になる（月 1,000 回まで無料）ので、
    // 計算しない設定のときと、有料道路を使わない区間では頼まない
    const withTolls = TOLL_PASSES[tollPayment] !== undefined && !avoidTolls;
    if (withTolls) {
      body.extraComputations = ['TOLLS'];
      body.routeModifiers.tollPasses = TOLL_PASSES[tollPayment];
    }

    const res = await fetchImpl(ROUTES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELD_MASK },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[routes api]', res.status, JSON.stringify(data?.error ?? data));
      if (res.status === 400) throw new InputError('routeSearchFailed', { from: from.place, to: to.place });
      throw new RoutingError('routingServiceError');
    }
    const route = data.routes?.[0];
    if (!route) throw new InputError('noRoute', { from: from.place, to: to.place });
    const leg = route.legs?.[0] ?? {};
    return {
      durationSeconds: seconds(route.duration),
      distanceMeters: route.distanceMeters ?? 0,
      polyline: route.polyline?.encodedPolyline ?? '',
      start: fromGoogleLatLng(leg.startLocation),
      end: fromGoogleLatLng(leg.endLocation),
      trafficAware,
      // 料金を頼まなかったときは undefined（画面には出さない）
      toll: withTolls ? withEstimate(parseTollInfo(route.travelAdvisory?.tollInfo), tollPayment) : avoidTolls ? null : undefined,
    };
  };
}

// ---- OpenStreetMap（Nominatim + Valhalla の公開サーバー） ----
// OSRM の公開サーバーは「有料道路・高速道路を使わない」に対応していないので Valhalla を使う
// https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/
// どちらも公開サーバーの利用規約があり（Nominatim は 1 秒 1 回まで）、本番での常用は想定しない

const USER_AGENT = 'travel-master/0.1 (route planner)';
const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';

export function osmRouter(fetchImpl = fetch) {
  const cache = new Map();

  async function geocode({ place, location }) {
    const ll = location ?? parseLatLng(place);
    if (ll) return ll;
    if (cache.has(place)) return cache.get(place);
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=ja&q=${encodeURIComponent(place)}`;
    const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (!res.ok) throw new RoutingError('geocodeServiceError');
    const [hit] = await res.json();
    if (!hit) throw new InputError('placeNotFound', { place });
    const result = { lat: Number(hit.lat), lng: Number(hit.lon) };
    cache.set(place, result);
    return result;
  }

  return async function routeLeg(from, to, departureMs, { avoidTolls, avoidHighways } = {}) {
    const a = await geocode(from);
    const b = await geocode(to);
    // 0 にすると、その道をできるだけ避ける（ほかに道がなければ通る。そのときは hasToll などで知らせる）
    const auto = {};
    if (avoidTolls) auto.use_tolls = 0;
    if (avoidHighways) auto.use_highways = 0;
    const res = await fetchImpl(VALHALLA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify({
        locations: [
          { lat: a.lat, lon: a.lng },
          { lat: b.lat, lon: b.lng },
        ],
        costing: 'auto',
        costing_options: { auto },
        units: 'kilometers',
        directions_type: 'none',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 4xx で error_code があるのは「道が見つからない」など入力側の問題（442: 経路なし、171: 近くに道がない など）
      if (res.status >= 400 && res.status < 500 && data?.error_code) {
        throw new InputError('noRoute', { from: from.place, to: to.place });
      }
      console.error('[valhalla]', res.status, JSON.stringify(data));
      throw new RoutingError('routingServiceError');
    }
    const trip = data.trip;
    const leg = trip?.legs?.[0];
    if (!trip || !leg) throw new InputError('noRoute', { from: from.place, to: to.place });
    return {
      durationSeconds: Math.round(trip.summary.time),
      distanceMeters: Math.round(trip.summary.length * 1000),
      polyline: leg.shape,
      polylinePrecision: 6,
      start: a,
      end: b,
      trafficAware: false,
      hasToll: Boolean(trip.summary.has_toll),
      hasHighway: Boolean(trip.summary.has_highway),
    };
  };
}
