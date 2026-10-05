import assert from 'node:assert/strict';
import { test } from 'node:test';
import { googleRouter, parseLatLng } from '../src/routing.js';
import { buildSchedule, InputError, normalizePlan } from '../src/schedule.js';
import worker from '../src/worker.js';

const MIN = 60 * 1000;
const T0 = Date.parse('2030-05-01T09:00:00+09:00');

// 区間ごとに決まった時間（分）かかる偽のルート検索
function fakeRouter(minutesPerLeg) {
  const calls = [];
  let i = 0;
  const routeLeg = async (origin, destination, departure) => {
    calls.push({ origin, destination, departure });
    const minutes = minutesPerLeg[i++];
    return { durationSeconds: minutes * 60, distanceMeters: minutes * 1000, polyline: '', start: null, end: null };
  };
  return { routeLeg, calls };
}

test('滞在時間だけで到着・出発を順に計算する', async () => {
  const plan = normalizePlan({
    stops: [
      { place: '東京駅', departAt: new Date(T0).toISOString() },
      { place: '箱根', stayMinutes: 90 },
      { place: '熱海', stayMinutes: 30 },
    ],
  });
  const { routeLeg, calls } = fakeRouter([100, 40]);
  const r = await buildSchedule(plan, routeLeg);

  assert.equal(r.stops[1].arrival, T0 + 100 * MIN);
  assert.equal(r.stops[1].departure, T0 + 190 * MIN);
  assert.equal(calls[1].departure, T0 + 190 * MIN, '2 区間目は 1 か所目を出た時刻で検索する');
  assert.equal(r.stops[2].arrival, T0 + 230 * MIN);
  assert.equal(r.stops[2].departure, T0 + 260 * MIN, '最終地点は滞在の終わりが終了時刻');
  assert.equal(r.stops[2].final, true);
  assert.equal(r.totals.driveSeconds, 140 * 60);
  assert.equal(r.totals.stayMinutes, 120);
  assert.equal(r.totals.end - r.totals.start, 260 * MIN);
});

test('出発時刻の指定があればそこまで待つ。間に合わなければ遅れとして知らせる', async () => {
  const plan = normalizePlan({
    stops: [
      { place: 'A', departAt: new Date(T0).toISOString() },
      { place: 'B', stayMinutes: 30, departAt: new Date(T0 + 180 * MIN).toISOString() }, // 着 +60、滞在後 +90、指定 +180
      { place: 'C', stayMinutes: 60, departAt: new Date(T0 + 200 * MIN).toISOString() }, // 着 +240 → 間に合わない
      { place: 'D', stayMinutes: 0 },
    ],
  });
  const { routeLeg } = fakeRouter([60, 60, 30]);
  const r = await buildSchedule(plan, routeLeg);

  assert.equal(r.stops[1].departure, T0 + 180 * MIN);
  assert.equal(r.stops[1].waitMinutes, 90);
  assert.equal(r.stops[1].late, false);

  assert.equal(r.stops[2].arrival, T0 + 240 * MIN);
  assert.equal(r.stops[2].late, true);
  assert.equal(r.stops[2].lateMinutes, 100);
  assert.equal(r.stops[2].departure, T0 + 300 * MIN, '間に合わないときは滞在を終えてから出発する');

  assert.equal(r.stops[3].arrival, T0 + 330 * MIN);
  assert.equal(r.totals.waitMinutes, 90);
});

test('入力の検証', () => {
  assert.throws(() => normalizePlan({ stops: [{ place: 'A', departAt: '2030-01-01T00:00:00Z' }] }), InputError);
  assert.throws(() => normalizePlan({ stops: [{ place: 'A' }, { place: 'B' }] }), /出発時刻/);
  assert.throws(() => normalizePlan({ stops: [{ place: 'A', departAt: 'x' }, { place: 'B' }] }), /形式/);
  assert.throws(() => normalizePlan({ stops: [{ place: 'A', departAt: '2030-01-01T00:00:00Z' }, { place: ' ' }] }), /空/);
  assert.throws(
    () => normalizePlan({ stops: Array.from({ length: 4 }, () => ({ place: 'A', departAt: '2030-01-01T00:00:00Z' })) }, { maxStops: 3 }),
    /3 か所/,
  );
});

test('座標の入力', () => {
  assert.deepEqual(parseLatLng('35.6812, 139.7671'), { lat: 35.6812, lng: 139.7671 });
  assert.equal(parseLatLng('東京駅'), null);
  assert.equal(parseLatLng('95, 10'), null);
});

test('Google Routes API: 未来の出発は渋滞予測つきで検索する', async () => {
  let sent;
  const fakeFetch = async (url, init) => {
    sent = { url, init, body: JSON.parse(init.body) };
    return Response.json({
      routes: [
        {
          duration: '3600s',
          distanceMeters: 50000,
          polyline: { encodedPolyline: '_p~iF~ps|U' },
          legs: [{ startLocation: { latLng: { latitude: 1, longitude: 2 } }, endLocation: { latLng: { latitude: 3, longitude: 4 } } }],
        },
      ],
    });
  };
  const leg = await googleRouter('KEY', fakeFetch)('東京駅', '35.1, 139.1', T0, { avoidTolls: true }, T0 - 3600 * 1000);
  assert.equal(sent.init.headers['X-Goog-Api-Key'], 'KEY');
  assert.equal(sent.body.routingPreference, 'TRAFFIC_AWARE');
  assert.equal(sent.body.departureTime, new Date(T0).toISOString());
  assert.deepEqual(sent.body.origin, { address: '東京駅' });
  assert.deepEqual(sent.body.destination, { location: { latLng: { latitude: 35.1, longitude: 139.1 } } });
  assert.equal(sent.body.routeModifiers.avoidTolls, true);
  assert.deepEqual(leg, {
    durationSeconds: 3600,
    distanceMeters: 50000,
    polyline: '_p~iF~ps|U',
    start: { lat: 1, lng: 2 },
    end: { lat: 3, lng: 4 },
    trafficAware: true,
  });

  // 過去の出発時刻では departureTime を送らない（API がエラーにするため）
  await googleRouter('KEY', fakeFetch)('A', 'B', T0, {}, T0 + 3600 * 1000);
  assert.equal(sent.body.routingPreference, 'TRAFFIC_UNAWARE');
  assert.equal(sent.body.departureTime, undefined);
});

test('API: 入力が正しくなければ 400、他のサイトからの呼び出しは 403', async () => {
  const env = { ASSETS: { fetch: () => new Response('asset') } };
  const post = (body, headers = {}) =>
    worker.fetch(new Request('https://travel.example/api/route', { method: 'POST', headers, body: JSON.stringify(body) }), env);

  const bad = await post({ stops: [{ place: 'A' }] });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /目的地/);

  const cross = await post({ stops: [] }, { Origin: 'https://evil.example' });
  assert.equal(cross.status, 403);

  const page = await worker.fetch(new Request('https://travel.example/'), env);
  assert.equal(await page.text(), 'asset');
});
