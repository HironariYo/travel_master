import assert from 'node:assert/strict';
import { test } from 'node:test';
import { googleSuggest, photonSuggest } from '../src/places.js';
import { googleRouter, osmRouter, parseLatLng } from '../src/routing.js';
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
  const leg = await googleRouter('KEY', fakeFetch)(
    { place: '東京駅' },
    { place: '35.1, 139.1' },
    T0,
    { avoidTolls: true },
    T0 - 3600 * 1000,
  );
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
  await googleRouter('KEY', fakeFetch)({ place: 'A', placeId: 'ChIJabc' }, { place: 'B', location: { lat: 1, lng: 2 } }, T0, {}, T0 + 3600 * 1000);
  assert.deepEqual(sent.body.origin, { placeId: 'ChIJabc' }, '候補から選んだ地点は Place ID で検索する');
  assert.deepEqual(sent.body.destination, { location: { latLng: { latitude: 1, longitude: 2 } } });
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

test('候補から選んだ Place ID・座標を検証して地点に持たせる', async () => {
  const plan = normalizePlan({
    stops: [
      { place: '東京駅', placeId: 'ChIJ-abc_123', departAt: new Date(T0).toISOString() },
      { place: '箱根', lat: 35.23, lng: 139.1 },
      { place: '変な値', placeId: 'a b<script>', lat: 'x', lng: 200 },
    ],
  });
  assert.equal(plan.stops[0].placeId, 'ChIJ-abc_123');
  assert.deepEqual(plan.stops[1].location, { lat: 35.23, lng: 139.1 });
  assert.equal(plan.stops[2].placeId, null);
  assert.equal(plan.stops[2].location, null);

  const seen = [];
  const r = await buildSchedule(plan, async (from, to) => {
    seen.push([from.place, to.place]);
    return { durationSeconds: 60, distanceMeters: 1, polyline: '', start: null, end: null };
  });
  assert.deepEqual(seen, [['東京駅', '箱根'], ['箱根', '変な値']]);
  assert.deepEqual(r.stops[1].location, { lat: 35.23, lng: 139.1 }, 'ルート検索が座標を返さなくても選んだ座標を使う');
  assert.equal(r.stops[1].pinned, true);
  assert.equal(r.stops[0].placeId, 'ChIJ-abc_123');
});

test('場所の候補: Google Places API の結果を整える', async () => {
  let sent;
  const fakeFetch = async (url, init) => {
    sent = { url, body: JSON.parse(init.body), headers: init.headers };
    return Response.json({
      suggestions: [
        {
          placePrediction: {
            placeId: 'P1',
            text: { text: '箱根湯本駅、日本、神奈川県足柄下郡箱根町' },
            structuredFormat: { mainText: { text: '箱根湯本駅' }, secondaryText: { text: '日本、神奈川県足柄下郡箱根町' } },
          },
        },
        { queryPrediction: { text: { text: '箱根 温泉' } } },
      ],
    });
  };
  const out = await googleSuggest('KEY', { q: '箱根', near: { lat: 35, lng: 139 }, sessionToken: 'tok' }, fakeFetch);
  assert.deepEqual(out, [{ name: '箱根湯本駅', detail: '日本、神奈川県足柄下郡箱根町', placeId: 'P1' }]);
  assert.equal(sent.body.input, '箱根');
  assert.equal(sent.body.sessionToken, 'tok');
  assert.deepEqual(sent.body.includedRegionCodes, ['jp']);
  assert.equal(sent.body.locationBias.circle.center.latitude, 35);
});

test('場所の候補: Photon の結果からバス停と重複を除く', async () => {
  const feature = (name, props, coords = [139.07, 35.1]) => ({
    geometry: { coordinates: coords },
    properties: { name, countrycode: 'JP', ...props },
  });
  const fakeFetch = async () =>
    Response.json({
      features: [
        feature('熱海駅', { osm_value: 'bus_stop', state: '静岡県', city: '熱海市' }),
        feature('熱海駅', { osm_value: 'station', state: '静岡県', city: '熱海市' }),
        feature('熱海駅', { osm_value: 'station', state: '静岡県', city: '熱海市' }, [139.08, 35.11]),
        feature('熱海駅', { osm_value: 'station', state: '福島県', city: '郡山市' }, [140.27, 37.48]),
      ],
    });
  const out = await photonSuggest({ q: '熱海駅' }, fakeFetch);
  assert.deepEqual(out, [
    { name: '熱海駅', detail: '静岡県 熱海市', lat: 35.1, lng: 139.07 },
    { name: '熱海駅', detail: '福島県 郡山市', lat: 37.48, lng: 140.27 },
  ]);
});

test('API: 場所の候補は 2 文字未満なら問い合わせない。他のサイトからは 403', async () => {
  const env = {};
  const res = await worker.fetch(new Request('https://travel.example/api/places?q=箱'), env);
  assert.deepEqual(await res.json(), { suggestions: [] });
  const cross = await worker.fetch(
    new Request('https://travel.example/api/places?q=箱根', { headers: { 'Sec-Fetch-Site': 'cross-site' } }),
    env,
  );
  assert.equal(cross.status, 403);
});

test('場所の候補: 「〜駅」と打つと、駅名に「駅」が付かない OpenStreetMap の駅も先頭に出す', async () => {
  const urls = [];
  const fakeFetch = async (url) => {
    urls.push(new URL(url));
    const station = new URL(url).searchParams.getAll('osm_tag').length > 0;
    return Response.json({
      features: station
        ? [{ geometry: { coordinates: [139.07, 35.1] }, properties: { name: '熱海', osm_key: 'railway', osm_value: 'station', state: '静岡県', city: '熱海市' } }]
        : [{ geometry: { coordinates: [139.08, 35.1] }, properties: { name: '熱海駅前郵便局', osm_key: 'amenity', osm_value: 'post_office', state: '静岡県', city: '熱海市' } }],
    });
  };
  const out = await photonSuggest({ q: '熱海駅' }, fakeFetch);
  assert.deepEqual(out.map((o) => o.name), ['熱海駅', '熱海駅前郵便局']);
  assert.equal(urls.find((u) => u.searchParams.has('osm_tag')).searchParams.get('q'), '熱海');
});

test('OpenStreetMap: 有料道路・高速道路を使わない条件を Valhalla に渡し、避けられなかった道を知らせる', async () => {
  let sent;
  const fakeFetch = async (url, init) => {
    sent = { url, body: JSON.parse(init.body) };
    return Response.json({
      trip: { summary: { time: 7200.4, length: 108.1, has_toll: true, has_highway: false }, legs: [{ shape: 'abc' }] },
    });
  };
  const plan = normalizePlan({
    stops: [
      { place: 'A', lat: 35.68, lng: 139.76, departAt: new Date(T0).toISOString() },
      { place: 'B', lat: 35.1, lng: 139.08 },
    ],
    avoidTolls: true,
    avoidHighways: true,
  });
  const r = await buildSchedule(plan, osmRouter(fakeFetch));
  assert.match(sent.url, /valhalla/);
  assert.deepEqual(sent.body.costing_options, { auto: { use_tolls: 0, use_highways: 0 } });
  assert.deepEqual(sent.body.locations[0], { lat: 35.68, lon: 139.76 });
  assert.equal(r.legs[0].durationSeconds, 7200);
  assert.equal(r.legs[0].distanceMeters, 108100);
  assert.equal(r.legs[0].polylinePrecision, 6);
  assert.deepEqual(r.legs[0].unavoidable, ['toll'], '有料道路は避けられなかった。高速道路は避けられた');
  assert.deepEqual(r.legs[0].options, { avoidTolls: true, avoidHighways: true }, '全体の指定は各区間に引き継ぐ');

  // 条件なしなら何も渡さず、警告も出さない
  const plainPlan = normalizePlan({
    stops: [
      { place: 'A', lat: 35.68, lng: 139.76, departAt: new Date(T0).toISOString() },
      { place: 'B', lat: 35.1, lng: 139.08 },
    ],
  });
  const plain = await buildSchedule(plainPlan, osmRouter(fakeFetch));
  assert.deepEqual(sent.body.costing_options, { auto: {} });
  assert.deepEqual(plain.legs[0].unavoidable, []);
});

test('OpenStreetMap: 道が見つからないときは入力の問題として伝える', async () => {
  const fakeFetch = async () => Response.json({ error_code: 442, error: 'No path could be found for input' }, { status: 400 });
  await assert.rejects(
    osmRouter(fakeFetch)({ place: '島', location: { lat: 1, lng: 1 } }, { place: '本土', location: { lat: 2, lng: 2 } }),
    (err) => err instanceof InputError && /見つかりません/.test(err.message),
  );
});

test('有料道路・高速道路の条件を区間ごとに指定できる', async () => {
  const plan = normalizePlan({
    stops: [
      { place: 'A', departAt: new Date(T0).toISOString(), avoidTolls: true }, // 出発地の指定は使わない
      { place: 'B', avoidTolls: true },
      { place: 'C' },
      { place: 'D', avoidHighways: true },
    ],
    avoidHighways: true, // 地点に指定がない区間だけに効く
  });
  assert.equal(plan.stops[0].avoidTolls, false);
  const seen = [];
  const r = await buildSchedule(plan, async (from, to, dep, options) => {
    seen.push(`${from.place}→${to.place} ${JSON.stringify(options)}`);
    return { durationSeconds: 60, distanceMeters: 1, polyline: '', start: null, end: null };
  });
  assert.deepEqual(seen, [
    'A→B {"avoidTolls":true,"avoidHighways":true}',
    'B→C {"avoidTolls":false,"avoidHighways":true}',
    'C→D {"avoidTolls":false,"avoidHighways":true}',
  ]);

  const explicit = normalizePlan({
    stops: [
      { place: 'A', departAt: new Date(T0).toISOString() },
      { place: 'B', avoidTolls: false, avoidHighways: false },
      { place: 'C', avoidTolls: true, avoidHighways: false },
    ],
    avoidTolls: true,
    avoidHighways: true,
  });
  assert.deepEqual(
    explicit.stops.slice(1).map((s) => [s.avoidTolls, s.avoidHighways]),
    [[false, false], [true, false]],
    '地点の指定（false も）が全体の指定より優先',
  );
  assert.deepEqual(r.legs.map((l) => l.options.avoidTolls), [true, false, false]);
});
