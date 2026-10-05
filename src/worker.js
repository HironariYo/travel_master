// Cloudflare Workers のエントリポイント
// 画面（static/）は Static Assets がそのまま返す。Worker が受け持つのは /api/* だけ
import { googleSuggest, photonSuggest } from './places.js';
import { googleRouter, osmRouter, RoutingError } from './routing.js';
import { buildSchedule, InputError, normalizePlan } from './schedule.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// 他のサイトから API キーを使われないよう、同じオリジンからの呼び出しだけを受ける
// （GET では Origin が付かないので、ブラウザが付ける Sec-Fetch-Site も見る）
function isCrossSite(request) {
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) return true;
  const site = request.headers.get('Sec-Fetch-Site');
  return Boolean(site) && site !== 'same-origin' && site !== 'none';
}

export async function handleRoute(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
  if (isCrossSite(request)) return json({ error: 'Forbidden' }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON の形式が正しくありません' }, 400);
  }

  try {
    const plan = normalizePlan(body, { maxStops: Number(env.MAX_STOPS) || 10 });
    const provider = env.GOOGLE_MAPS_API_KEY ? 'google' : 'osm';
    const routeLeg = provider === 'google' ? googleRouter(env.GOOGLE_MAPS_API_KEY) : osmRouter();
    const schedule = await buildSchedule(plan, routeLeg);
    return json({ provider, ...schedule });
  } catch (err) {
    if (err instanceof InputError) return json({ error: err.message }, 400);
    if (err instanceof RoutingError) return json({ error: err.message }, err.status);
    console.error('[route]', err);
    return json({ error: 'エラーが発生しました' }, 500);
  }
}

// GET /api/places?q=箱根&lat=35.6&lng=139.7&session=<uuid>
export async function handlePlaces(request, env) {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  if (isCrossSite(request)) return json({ error: 'Forbidden' }, 403);
  const params = new URL(request.url).searchParams;
  const q = (params.get('q') ?? '').trim().slice(0, 100);
  if (q.length < 2) return json({ suggestions: [] });
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  const near =
    params.has('lat') && params.has('lng') && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  const session = params.get('session');
  const sessionToken = session && /^[A-Za-z0-9-]{1,64}$/.test(session) ? session : undefined;
  try {
    const suggestions = env.GOOGLE_MAPS_API_KEY
      ? await googleSuggest(env.GOOGLE_MAPS_API_KEY, { q, near, sessionToken })
      : await photonSuggest({ q, near });
    return json({ suggestions });
  } catch (err) {
    if (err instanceof RoutingError) return json({ error: err.message }, err.status);
    console.error('[places]', err);
    return json({ error: 'エラーが発生しました' }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/route') return handleRoute(request, env);
    if (url.pathname === '/api/places') return handlePlaces(request, env);
    if (url.pathname === '/api/config') {
      return json({ provider: env.GOOGLE_MAPS_API_KEY ? 'google' : 'osm', maxStops: Number(env.MAX_STOPS) || 10 });
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not Found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
