// Cloudflare Workers のエントリポイント
// 画面（static/）は Static Assets がそのまま返す。Worker が受け持つのは /api/* だけ
import { googleRouter, osmRouter, RoutingError } from './routing.js';
import { buildSchedule, InputError, normalizePlan } from './schedule.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function handleRoute(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
  // 他のサイトから API キーを使われないよう、同じオリジンからの呼び出しだけを受ける
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: 'Forbidden' }, 403);

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/route') return handleRoute(request, env);
    if (url.pathname === '/api/config') {
      return json({ provider: env.GOOGLE_MAPS_API_KEY ? 'google' : 'osm', maxStops: Number(env.MAX_STOPS) || 10 });
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not Found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
