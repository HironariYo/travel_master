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
// stops[0] が出発地、以降が目的地。各地点は { place, placeId?, lat?, lng?, stayMinutes?, departAt?, avoidTolls?, avoidHighways? }
// placeId・lat/lng は候補から選んだときに付く。あればルート検索で place（文字）より優先する
// avoidTolls・avoidHighways は「その地点まで」の区間の条件。地点にないときは全体の指定（body.avoidTolls など）を使う
// parking: true の目的地は、近くの時間制限駐車区間（東京都内）まで車で行き、そこから歩く
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
      avoidTolls: i > 0 && Boolean(s.avoidTolls ?? body.avoidTolls),
      avoidHighways: i > 0 && Boolean(s.avoidHighways ?? body.avoidHighways),
      parking: i > 0 && Boolean(s.parking),
    };
  });
  if (stops.length < 2) throw new InputError('出発地と目的地を 1 つ以上入力してください');
  if (stops.length > maxStops) throw new InputError(`地点は ${maxStops} か所までです`);
  if (stops[0].departAt === null) throw new InputError('出発地の出発時刻を入力してください');
  return { stops };
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
//
// parking（任意）: 駐車区間を探す関数。{ find(target, arrivalMs, stayMinutes), recheck(found, arrivalMs, stayMinutes) }
// stayMinutes は目的地にいる時間（徒歩の往復は含まない）
// parking を指定した目的地は、まず目的地までのルートで到着時刻と位置を出し、その時刻に使える近くの区間を選んで、
// そこまでのルートを検索し直す（ルート検索は 2 回）。次の区間は駐車した場所から出発する
export async function buildSchedule(plan, routeLeg, { parking } = {}) {
  const { stops } = plan;
  const result = [];
  const legs = [];

  let departure = stops[0].departAt;
  // 次の区間の出発地（駐車したときは駐車した場所）
  let from = stops[0];
  result.push({ index: 0, place: stops[0].place, placeId: stops[0].placeId, pinned: Boolean(stops[0].location), arrival: null, departure, stayMinutes: 0, waitMinutes: 0, late: false });

  for (let i = 1; i < stops.length; i++) {
    // 区間ごとの条件（stops[i] まで）
    const options = { avoidTolls: stops[i].avoidTolls, avoidHighways: stops[i].avoidHighways };
    let leg = await routeLeg(from, stops[i], departure, options);
    const destination = leg.end ?? stops[i].location;
    let parked = null;
    if (stops[i].parking && parking) {
      if (!destination) {
        parked = { status: 'none', reason: '目的地の位置が分かりませんでした' };
      } else {
        parked = parking.find(destination, departure + leg.durationSeconds * 1000, stops[i].stayMinutes);
        if (parked.status === 'ok') {
          const spot = { place: `${stops[i].place}付近の駐車区間`, placeId: null, location: parked.point };
          leg = await routeLeg(from, spot, departure, options);
        }
      }
    }
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
      options,
      // 「使わない」を指定したのに通らざるを得なかった道（OpenStreetMap のときだけ分かる）
      unavoidable: [
        options.avoidTolls && leg.hasToll ? 'toll' : null,
        options.avoidHighways && leg.hasHighway ? 'highway' : null,
      ].filter(Boolean),
    });
    if (i === 1) result[0].location = leg.start ?? stops[0].location;

    const isLast = i === stops.length - 1;
    const walkMinutes = parked?.status === 'ok' ? parked.walkMinutes : 0;
    const stop = {
      index: i,
      place: stops[i].place,
      placeId: stops[i].placeId,
      pinned: Boolean(stops[i].location),
      arrival,
      stayMinutes: stops[i].stayMinutes,
      walkMinutes,
      location: destination,
      parking: parked,
    };
    // 駐車したときは、駐車場所と目的地の往復の徒歩も、その地点で過ごす時間に入れる
    const dwell = { ...stops[i], stayMinutes: stops[i].stayMinutes + walkMinutes * 2 };
    if (isLast && stops[i].departAt === null) {
      // 最終目的地: 出発時刻の指定がなければ、滞在の終わりを「終了」とする
      Object.assign(stop, { departure: arrival + dwell.stayMinutes * MINUTE, waitMinutes: 0, late: false, final: true });
    } else {
      Object.assign(stop, departureFor(dwell, arrival), isLast ? { final: true } : {});
    }
    if (parked?.status === 'ok') {
      // 実際の到着時刻と、出発待ちも含めて停めておく時間で確かめ直す（1 回目の到着見込みと数分ずれるため）
      const stayed = Math.round((stop.departure - arrival) / MINUTE) - walkMinutes * 2;
      stop.parking = parking.recheck(parked, arrival, stayed);
    }
    result.push(stop);
    departure = stop.departure;
    from = parked?.status === 'ok' ? { place: stops[i].place, placeId: null, location: parked.point } : stops[i];
  }

  const first = result[0].departure;
  const last = result[result.length - 1].departure;
  return {
    stops: result,
    legs,
    totals: {
      distanceMeters: legs.reduce((a, l) => a + l.distanceMeters, 0),
      driveSeconds: legs.reduce((a, l) => a + l.durationSeconds, 0),
      stayMinutes: result.reduce((a, s) => a + s.stayMinutes, 0),
      waitMinutes: result.reduce((a, s) => a + s.waitMinutes, 0),
      walkMinutes: result.reduce((a, s) => a + (s.walkMinutes ?? 0) * 2, 0),
      start: first,
      end: last,
    },
  };
}
