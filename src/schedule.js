// 旅程の計算（ルート検索の結果から、各地点の到着・出発時刻を決める）
// 時刻はすべてエポックミリ秒で扱う。Worker は UTC で動くので、表示用の整形はブラウザ側で行う

const MINUTE = 60 * 1000;

// "2026-10-05T09:00:00+09:00" などを受け取り、ミリ秒にする。空なら null
export function parseTime(value) {
  if (value === undefined || value === null || value === '') return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new InputError(`時刻の形式が正しくありません: ${value}`);
  return ms;
}

export class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InputError';
  }
}

// リクエストの検証と正規化
// stops[0] が出発地、以降が目的地。各地点は { place, placeId?, lat?, lng?, stayMinutes?, departAt? }
// placeId・lat/lng は候補から選んだときに付く。あればルート検索で place（文字）より優先する
export function normalizePlan(body, { maxStops = 10 } = {}) {
  if (!body || !Array.isArray(body.stops)) throw new InputError('stops がありません');
  const stops = body.stops.map((s, i) => {
    const place = String(s?.place ?? '').trim();
    if (!place) throw new InputError(`${i + 1} 番目の地点が空です`);
    if (place.length > 200) throw new InputError(`${i + 1} 番目の地点が長すぎます`);
    const stayMinutes = Number(s.stayMinutes ?? 0);
    if (!Number.isFinite(stayMinutes) || stayMinutes < 0 || stayMinutes > 7 * 24 * 60) {
      throw new InputError(`${i + 1} 番目の滞在時間が正しくありません`);
    }
    return {
      place,
      placeId: parsePlaceId(s.placeId),
      location: parseLocation(s.lat, s.lng),
      stayMinutes: i === 0 ? 0 : Math.round(stayMinutes),
      departAt: parseTime(s.departAt),
    };
  });
  if (stops.length < 2) throw new InputError('出発地と目的地を 1 つ以上入力してください');
  if (stops.length > maxStops) throw new InputError(`地点は ${maxStops} か所までです`);
  if (stops[0].departAt === null) throw new InputError('出発地の出発時刻を入力してください');
  return {
    stops,
    avoidTolls: Boolean(body.avoidTolls),
    avoidHighways: Boolean(body.avoidHighways),
  };
}

// Google の Place ID。形式が違うものは無視して、文字で検索する
function parsePlaceId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(value) ? value : null;
}

function parseLocation(lat, lng) {
  if (lat === undefined || lat === null || lat === '' || lng === undefined || lng === null || lng === '') return null;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  return { lat: la, lng: ln };
}

// 地点 i を出る時刻: 到着 + 滞在時間 と、指定の出発時刻の遅いほう
export function departureFor(stop, arrival) {
  const earliest = arrival + stop.stayMinutes * MINUTE;
  if (stop.departAt === null) return { departure: earliest, waitMinutes: 0, late: false };
  if (stop.departAt >= earliest) {
    return { departure: stop.departAt, waitMinutes: Math.round((stop.departAt - earliest) / MINUTE), late: false };
  }
  // 指定の出発時刻に間に合わない。予定より遅れて出発する
  return { departure: earliest, waitMinutes: 0, late: true, lateMinutes: Math.round((earliest - stop.departAt) / MINUTE) };
}

// 区間ごとにルートを検索しながら旅程を組み立てる
// routeLeg(originStop, destinationStop, departureMs, options) => { durationSeconds, distanceMeters, polyline, start, end, trafficAware }
// 区間の出発時刻は前の区間の到着で決まるので、順番に検索する
export async function buildSchedule(plan, routeLeg) {
  const { stops } = plan;
  const options = { avoidTolls: plan.avoidTolls, avoidHighways: plan.avoidHighways };
  const result = [];
  const legs = [];

  let departure = stops[0].departAt;
  result.push({ index: 0, place: stops[0].place, placeId: stops[0].placeId, pinned: Boolean(stops[0].location), arrival: null, departure, stayMinutes: 0, waitMinutes: 0, late: false });

  for (let i = 1; i < stops.length; i++) {
    const leg = await routeLeg(stops[i - 1], stops[i], departure, options);
    const arrival = departure + leg.durationSeconds * 1000;
    legs.push({
      from: i - 1,
      to: i,
      departure,
      arrival,
      durationSeconds: leg.durationSeconds,
      distanceMeters: leg.distanceMeters,
      polyline: leg.polyline,
      polylinePrecision: leg.polylinePrecision ?? 5,
      trafficAware: Boolean(leg.trafficAware),
      // 「使わない」を指定したのに通らざるを得なかった道（OpenStreetMap のときだけ分かる）
      unavoidable: [
        plan.avoidTolls && leg.hasToll ? 'toll' : null,
        plan.avoidHighways && leg.hasHighway ? 'highway' : null,
      ].filter(Boolean),
    });
    if (i === 1) result[0].location = leg.start ?? stops[0].location;

    const isLast = i === stops.length - 1;
    const stop = { index: i, place: stops[i].place, placeId: stops[i].placeId, pinned: Boolean(stops[i].location), arrival, stayMinutes: stops[i].stayMinutes, location: leg.end ?? stops[i].location };
    if (isLast && stops[i].departAt === null) {
      // 最終目的地: 出発時刻の指定がなければ、滞在の終わりを「終了」とする
      Object.assign(stop, { departure: arrival + stops[i].stayMinutes * MINUTE, waitMinutes: 0, late: false, final: true });
    } else {
      Object.assign(stop, departureFor(stops[i], arrival), isLast ? { final: true } : {});
    }
    result.push(stop);
    departure = stop.departure;
  }

  const first = result[0].departure;
  const last = result[result.length - 1].departure;
  return {
    options,
    stops: result,
    legs,
    totals: {
      distanceMeters: legs.reduce((a, l) => a + l.distanceMeters, 0),
      driveSeconds: legs.reduce((a, l) => a + l.durationSeconds, 0),
      stayMinutes: result.reduce((a, s) => a + s.stayMinutes, 0),
      waitMinutes: result.reduce((a, s) => a + s.waitMinutes, 0),
      start: first,
      end: last,
    },
  };
}
