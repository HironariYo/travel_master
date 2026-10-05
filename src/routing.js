// 車のルート検索
// - GOOGLE_MAPS_API_KEY があれば Google Routes API（渋滞予測つき）
// - なければ OpenStreetMap（Nominatim で住所を座標に、OSRM でルート）。開発・お試し用で、渋滞は考慮しない
import { InputError } from './schedule.js';

export class RoutingError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'RoutingError';
    this.status = status;
  }
}

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
].join(',');

function googleWaypoint(place) {
  const ll = parseLatLng(place);
  if (ll) return { location: { latLng: { latitude: ll.lat, longitude: ll.lng } } };
  return { address: place };
}

function seconds(duration) {
  // "1234s" の形式
  return Math.round(parseFloat(String(duration ?? '0').replace(/s$/, '')) || 0);
}

function fromGoogleLatLng(loc) {
  const ll = loc?.latLng;
  return ll ? { lat: ll.latitude, lng: ll.longitude } : null;
}

export function googleRouter(apiKey, fetchImpl = fetch) {
  return async function routeLeg(origin, destination, departureMs, { avoidTolls, avoidHighways } = {}, now = Date.now()) {
    // 渋滞予測は未来の出発時刻でしか使えない（過去を指定するとエラーになる）
    const trafficAware = departureMs > now + 60 * 1000;
    const body = {
      origin: googleWaypoint(origin),
      destination: googleWaypoint(destination),
      travelMode: 'DRIVE',
      routingPreference: trafficAware ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE',
      languageCode: 'ja',
      regionCode: 'jp',
      units: 'METRIC',
      routeModifiers: { avoidTolls: Boolean(avoidTolls), avoidHighways: Boolean(avoidHighways) },
    };
    if (trafficAware) body.departureTime = new Date(departureMs).toISOString();

    const res = await fetchImpl(ROUTES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELD_MASK },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[routes api]', res.status, JSON.stringify(data?.error ?? data));
      if (res.status === 400) throw new InputError(`「${origin}」→「${destination}」のルートを検索できませんでした。地点を見直してください`);
      throw new RoutingError('ルート検索サービスでエラーが発生しました');
    }
    const route = data.routes?.[0];
    if (!route) throw new InputError(`「${origin}」→「${destination}」の車のルートが見つかりませんでした`);
    const leg = route.legs?.[0] ?? {};
    return {
      durationSeconds: seconds(route.duration),
      distanceMeters: route.distanceMeters ?? 0,
      polyline: route.polyline?.encodedPolyline ?? '',
      start: fromGoogleLatLng(leg.startLocation),
      end: fromGoogleLatLng(leg.endLocation),
      trafficAware,
    };
  };
}

// ---- OpenStreetMap（Nominatim + OSRM のデモサーバー） ----
// どちらも公開サーバーの利用規約があり（Nominatim は 1 秒 1 回まで）、本番での常用は想定しない

const USER_AGENT = 'travel-master/0.1 (route planner)';

export function osmRouter(fetchImpl = fetch) {
  const cache = new Map();

  async function geocode(place) {
    const ll = parseLatLng(place);
    if (ll) return ll;
    if (cache.has(place)) return cache.get(place);
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=ja&q=${encodeURIComponent(place)}`;
    const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (!res.ok) throw new RoutingError('住所の検索サービスでエラーが発生しました');
    const [hit] = await res.json();
    if (!hit) throw new InputError(`「${place}」が見つかりませんでした。住所や座標（35.68, 139.76）で入力してください`);
    const result = { lat: Number(hit.lat), lng: Number(hit.lon) };
    cache.set(place, result);
    return result;
  }

  return async function routeLeg(origin, destination) {
    const a = await geocode(origin);
    const b = await geocode(destination);
    const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=polyline`;
    const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && data?.code !== 'NoRoute') throw new RoutingError('ルート検索サービスでエラーが発生しました');
    const route = data.routes?.[0];
    if (!route) throw new InputError(`「${origin}」→「${destination}」の車のルートが見つかりませんでした`);
    return {
      durationSeconds: Math.round(route.duration),
      distanceMeters: Math.round(route.distance),
      polyline: route.geometry,
      start: a,
      end: b,
      trafficAware: false,
    };
  };
}
