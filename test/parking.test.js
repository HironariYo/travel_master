import assert from 'node:assert/strict';
import { test } from 'node:test';
import realData from '../src/data/tokyo-parking.json' with { type: 'json' };
import { findParking, jstParts, nearestOnZone, recheckParking, walkMinutesFor, zoneStatus } from '../src/parking.js';
import { buildSchedule, normalizePlan } from '../src/schedule.js';

const at = (s) => Date.parse(`${s}+09:00`);

// 東西に延びる 1 本の区間（目的地の北 約 111 m）
const zone = (props) => ({
  id: 1,
  kind: 'meter',
  from: 9 * 60,
  to: 19 * 60,
  limit: 60,
  fee: 300,
  closed: 'sunHoliday',
  lines: [[139.7, 35.701, 139.702, 35.701]],
  ...props,
});
const data = (zones) => ({ zones, holidays: ['2026-11-03'], holidaysUntil: '2027-11-23' });
const target = { lat: 35.7, lng: 139.701 };

test('日本時間で曜日・時刻を出す', () => {
  // UTC では前日の 15:30
  assert.deepEqual(jstParts(Date.parse('2026-10-10T15:30:00Z')), { date: '2026-10-11', month: 10, day: 11, dow: 0, minutes: 30 });
});

test('区間が使えるか: 曜日・祝日・時刻・お正月', () => {
  const d = data([]);
  const z = zone();
  assert.equal(zoneStatus(z, at('2026-10-05T10:00:00'), d).ok, true, '月曜 10 時');
  assert.deepEqual(zoneStatus(z, at('2026-10-11T10:00:00'), d).reason, { code: 'closed', closed: 'sunHoliday' });
  assert.deepEqual(zoneStatus(z, at('2026-11-03T10:00:00'), d).reason, { code: 'closed', closed: 'sunHoliday' }, '文化の日（火）');
  assert.equal(zoneStatus(z, at('2026-10-10T10:00:00'), d).ok, true, '土曜は使える');
  assert.deepEqual(zoneStatus(zone({ closed: 'weekendHoliday' }), at('2026-10-10T10:00:00'), d).reason, { code: 'closed', closed: 'weekendHoliday' });
  assert.equal(zoneStatus(zone({ closed: 'none' }), at('2026-10-11T10:00:00'), d).ok, true, '曜日の制限なし');
  assert.deepEqual(zoneStatus(z, at('2026-10-05T08:59:00'), d).reason, { code: 'outsideHours', from: '9:00', to: '19:00' });
  assert.equal(zoneStatus(z, at('2026-10-05T19:00:00'), d).reason.code, 'outsideHours');
  assert.deepEqual(zoneStatus(zone({ closed: 'none' }), at('2027-01-02T10:00:00'), d).reason, { code: 'newYear' });
  assert.deepEqual(zoneStatus(z, at('2028-05-01T10:00:00'), d).warnings, ['holidayUnknown'], '祝日データの範囲外');
});

test('区間の線上でいちばん近い点', () => {
  const near = nearestOnZone(zone(), target);
  assert.deepEqual(near.point, { lat: 35.701, lng: 139.701 });
  assert.ok(Math.abs(near.distance - 110.5) < 1, `${near.distance}`);
  assert.equal(walkMinutesFor(near.distance), 2);
});

test('使える区間を選び、徒歩と最大時間を見る', () => {
  const d = data([zone()]);
  const ok = findParking(d, target, at('2026-10-05T10:00:00'), 50);
  assert.equal(ok.status, 'ok');
  assert.equal(ok.distanceMeters, 111);
  assert.equal(ok.walkMinutes, 2);
  assert.equal(ok.parkMinutes, 54, '滞在 50 分 + 徒歩往復 4 分');
  assert.deepEqual(ok.warnings, []);
  assert.deepEqual(ok.zone, { id: 1, kind: 'meter', from: '9:00', to: '19:00', limitMinutes: 60, fee: 300, closed: 'sunHoliday' });

  assert.deepEqual(findParking(d, target, at('2026-10-05T10:00:00'), 90).warnings, ['overLimit']);
  assert.deepEqual(findParking(d, target, at('2026-10-05T18:30:00'), 50).warnings, ['overHours']);

  const sunday = findParking(d, target, at('2026-10-11T10:00:00'), 50);
  assert.equal(sunday.status, 'unavailable');
  assert.deepEqual(sunday.reason, { code: 'closed', closed: 'sunHoliday' });

  // 区間の北 約 1.1 km（目的地から 1 km より遠い区間は探さない）
  assert.equal(findParking(d, { lat: 35.691, lng: 139.701 }, at('2026-10-05T10:00:00'), 50).status, 'none', '1 km 以内にない');
  assert.equal(findParking(d, { lat: 35.692, lng: 139.701 }, at('2026-10-05T10:00:00'), 50).status, 'ok', '約 1 km 以内ならある');
});

test('近い区間が使えないときは、使える区間を選ぶ。最大時間に収まる区間を優先する', () => {
  const near = zone({ id: 1 }); // 111 m、日曜は対象外
  const far = zone({ id: 2, closed: 'none', lines: [[139.7, 35.7025, 139.702, 35.7025]] }); // 277 m
  const short = zone({ id: 3, closed: 'none', limit: 20, lines: [[139.7, 35.7005, 139.702, 35.7005]] }); // 55 m、最大 20 分
  const d = data([near, far, short]);
  assert.equal(findParking(d, target, at('2026-10-11T10:00:00'), 50).zone.id, 2, '日曜は near が使えず、short は時間が足りない');
  assert.equal(findParking(d, target, at('2026-10-11T10:00:00'), 10).zone.id, 3, '10 分なら近い short');
});

test('実際の到着時刻で確かめ直す', () => {
  const d = data([zone()]);
  const found = findParking(d, target, at('2026-10-05T18:58:00'), 30);
  const late = recheckParking(d, found, at('2026-10-05T19:02:00'), 30);
  assert.ok(late.warnings.includes('unavailableAtArrival'));
  assert.equal(late.arrivalReason.code, 'outsideHours');
});

test('旅程: 駐車区間まで車で行き、徒歩の往復を滞在に足し、次は駐車場所から出る', async () => {
  const d = data([zone()]);
  const parking = {
    find: (t, arr, stay) => findParking(d, t, arr, stay),
    recheck: (f, arr, stay) => recheckParking(d, f, arr, stay),
  };
  const calls = [];
  const routeLeg = async (from, to) => {
    calls.push([from.place, to.location ?? to.place]);
    return { durationSeconds: 30 * 60, distanceMeters: 10000, polyline: '', start: null, end: to.location ?? target };
  };
  const plan = normalizePlan({
    stops: [
      { place: '自宅', departAt: '2026-10-05T09:00:00+09:00' },
      { place: '神田', stayMinutes: 50, parking: true },
      { place: '上野', stayMinutes: 30 },
    ],
  });
  const r = await buildSchedule(plan, routeLeg, { parking });
  assert.equal(calls.length, 3, '駐車する目的地はルート検索 2 回');
  assert.deepEqual(calls[1], ['自宅', { lat: 35.701, lng: 139.701 }], '2 回目は駐車区間へ');
  assert.deepEqual(calls[2][0], '神田', '次の区間は駐車場所から（場所名は目的地のまま）');
  const kanda = r.stops[1];
  assert.equal(kanda.parking.status, 'ok');
  assert.equal(kanda.walkMinutes, 2);
  assert.deepEqual(kanda.location, target, '地図のピンは目的地');
  assert.equal(kanda.departure - kanda.arrival, 54 * 60 * 1000, '滞在 50 分 + 徒歩往復 4 分');
  assert.equal(r.totals.walkMinutes, 4);

  // 出発時刻の指定で待つと、停めておく時間が最大 60 分を超える
  const waitPlan = normalizePlan({
    stops: [
      { place: '自宅', departAt: '2026-10-05T09:00:00+09:00' },
      { place: '神田', stayMinutes: 50, parking: true, departAt: '2026-10-05T11:00:00+09:00' },
      { place: '上野' },
    ],
  });
  const w = await buildSchedule(waitPlan, routeLeg, { parking });
  assert.ok(w.stops[1].parking.warnings.includes('overLimit'));
});

test('実データ: 東京駅の近くで平日は見つかり、元日は見つからない', () => {
  const tokyoStation = { lat: 35.6812, lng: 139.7671 };
  const weekday = findParking(realData, tokyoStation, at('2026-10-06T10:00:00'), 30);
  assert.equal(weekday.status, 'ok');
  assert.ok(weekday.distanceMeters <= 500);
  const newYear = findParking(realData, tokyoStation, at('2027-01-01T10:00:00'), 30);
  assert.equal(newYear.status, 'unavailable');
});

test('どの区間にも収まらないときは、超える時間がいちばん短い区間を選ぶ', () => {
  const short = zone({ id: 1, closed: 'none', limit: 20 }); // 111 m、最大 20 分
  const long = zone({ id: 2, closed: 'none', lines: [[139.7, 35.7015, 139.702, 35.7015]] }); // 166 m、最大 60 分
  const d = data([short, long]);
  const r = findParking(d, target, at('2026-10-18T11:00:00'), 60);
  assert.equal(r.zone.id, 2, '60 分の区間で数分超えるほうが、20 分の区間で 40 分以上超えるより良い');
  assert.deepEqual(r.warnings, ['overLimit']);
  assert.equal(r.maxStayMinutes, 54, '最大 60 分 − 徒歩往復 6 分');
  assert.equal(r.overMinutes, 6);
});
