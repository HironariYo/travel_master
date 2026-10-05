// 目的地の近くの時間制限駐車区間（パーキング・メーター／チケット）を探す
// データは scripts/build-parking-data.js で作る src/data/tokyo-parking.json（警視庁のオープンデータ）
//
// 区間が使えるかは、到着時刻（日本時間）の曜日・祝日・時刻で決める。
// 利用時間外や対象外の日に路上に停めてよいかは区間ごとの標識しだいなので、ここでは「使えない」として扱う

const JST_OFFSET = 9 * 60 * 60 * 1000;
const WALK_METERS_PER_MINUTE = 80;
// 直線距離から歩く距離への目安（道は直線ではないので少し長めに見る）
const WALK_DETOUR = 1.25;
export const DEFAULT_RADIUS = 500;

const CLOSED_LABEL = { sunHoliday: '日曜・休日', weekendHoliday: '土日・休日' };

const pad = (n) => String(n).padStart(2, '0');
export const formatMinutes = (m) => `${Math.floor(m / 60)}:${pad(m % 60)}`;

// 日本時間の日付・曜日・時刻（分）
export function jstParts(ms) {
  const d = new Date(ms + JST_OFFSET);
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    dow: d.getUTCDay(),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

// 区間がその時刻に使えるか。使えないときは理由を返す
export function zoneStatus(zone, ms, data) {
  const t = jstParts(ms);
  const warnings = [];
  if (t.month === 1 && t.day <= 3) return { ok: false, reason: '1月1日〜3日は対象外' };
  const holidaySet = data.holidaySet ?? (data.holidaySet = new Set(data.holidays));
  const holiday = holidaySet.has(t.date);
  if (!holiday && data.holidaysUntil && t.date > data.holidaysUntil) warnings.push('holidayUnknown');
  const closedToday =
    (zone.closed === 'sunHoliday' && (t.dow === 0 || holiday)) ||
    (zone.closed === 'weekendHoliday' && (t.dow === 0 || t.dow === 6 || holiday));
  if (closedToday) return { ok: false, reason: `${CLOSED_LABEL[zone.closed]}は対象外`, warnings };
  if (t.minutes < zone.from || t.minutes >= zone.to) {
    return { ok: false, reason: `利用時間外（${formatMinutes(zone.from)}〜${formatMinutes(zone.to)}）`, warnings };
  }
  return { ok: true, minutes: t.minutes, warnings };
}

// 緯度経度の近似（数百 m の範囲なので平面で計算する）
function toXY(lng, lat, origin) {
  const k = Math.cos((origin.lat * Math.PI) / 180);
  return [(lng - origin.lng) * 111320 * k, (lat - origin.lat) * 110540];
}

// 区間の線のうち、target にいちばん近い点と距離（m）
export function nearestOnZone(zone, target) {
  let best = { distance: Infinity, point: null };
  for (const line of zone.lines) {
    for (let i = 0; i + 3 < line.length; i += 2) {
      const [ax, ay] = toXY(line[i], line[i + 1], target);
      const [bx, by] = toXY(line[i + 2], line[i + 3], target);
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const px = ax + t * dx;
      const py = ay + t * dy;
      const distance = Math.hypot(px, py);
      if (distance < best.distance) {
        const lng = line[i] + t * (line[i + 2] - line[i]);
        const lat = line[i + 1] + t * (line[i + 3] - line[i + 1]);
        best = { distance, point: { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 } };
      }
    }
  }
  return best;
}

export const walkMinutesFor = (meters) => Math.max(1, Math.ceil((meters * WALK_DETOUR) / WALK_METERS_PER_MINUTE));

function zoneSummary(zone) {
  return {
    id: zone.id,
    kind: zone.kind === 'ticket' ? 'パーキング・チケット' : 'パーキング・メーター',
    hours: `${formatMinutes(zone.from)}〜${formatMinutes(zone.to)}`,
    limitMinutes: zone.limit,
    fee: zone.fee,
    closed: CLOSED_LABEL[zone.closed] ?? null,
  };
}

// 使える区間でも気をつけること（滞在が最大時間を超える、利用時間の終わりを過ぎる）
function stayWarnings(zone, status, parkMinutes) {
  const warnings = [...(status.warnings ?? [])];
  if (parkMinutes > zone.limit) warnings.push('overLimit');
  if (status.minutes + parkMinutes > zone.to) warnings.push('overHours');
  return warnings;
}

function describe(zone, near, status, stayMinutes) {
  const walkMinutes = walkMinutesFor(near.distance);
  const parkMinutes = stayMinutes + walkMinutes * 2;
  return {
    status: 'ok',
    zone: zoneSummary(zone),
    point: near.point,
    distanceMeters: Math.round(near.distance),
    walkMinutes,
    parkMinutes,
    warnings: stayWarnings(zone, status, parkMinutes),
  };
}

// target の近く（radius m 以内）で、arrivalMs に使える区間を選ぶ
// 最大時間・利用時間に収まる区間を優先し（300 m までの遠回りなら）、なければいちばん近い区間
export function findParking(data, target, arrivalMs, stayMinutes, { radius = DEFAULT_RADIUS } = {}) {
  const nearby = [];
  for (const zone of data.zones) {
    const near = nearestOnZone(zone, target);
    if (near.distance <= radius) nearby.push({ zone, near });
  }
  if (!nearby.length) return { status: 'none', radius };
  nearby.sort((a, b) => a.near.distance - b.near.distance);

  let best = null;
  for (const { zone, near } of nearby) {
    const status = zoneStatus(zone, arrivalMs, data);
    if (!status.ok) continue;
    const result = describe(zone, near, status, stayMinutes);
    const penalty = result.warnings.some((w) => w === 'overLimit' || w === 'overHours') ? 300 : 0;
    const score = near.distance + penalty;
    if (!best || score < best.score) best = { score, result };
  }
  if (best) return best.result;
  // 近くに区間はあるが、到着時刻には使えない
  const { zone, near } = nearby[0];
  return {
    status: 'unavailable',
    reason: zoneStatus(zone, arrivalMs, data).reason,
    zone: zoneSummary(zone),
    distanceMeters: Math.round(near.distance),
    radius,
  };
}

// 選んだ区間を、実際の到着時刻でもう一度確かめる（1 回目の到着見込みと数分ずれるため）
export function recheckParking(data, parking, arrivalMs, stayMinutes) {
  const zone = data.zones.find((z) => z.id === parking.zone.id);
  const status = zoneStatus(zone, arrivalMs, data);
  if (!status.ok) return { ...parking, warnings: [...parking.warnings, 'unavailableAtArrival'], arrivalReason: status.reason };
  const near = { distance: parking.distanceMeters, point: parking.point };
  return describe(zone, near, status, stayMinutes);
}
