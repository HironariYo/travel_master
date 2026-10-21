// 有料道路の料金の計算（POST /api/tolls）
// ルート計算（/api/route）では料金を頼まず、画面の「料金を計算」ボタンを押したときだけここを呼ぶ。
// Google の料金の計算は Compute Routes Enterprise 扱い（月 1,000 回まで無料）で高いため
//
// 受け取るもの: { tollPayment: 'etc2' | 'etc' | 'cash', legs: [{ from, to, departure, avoidTolls, avoidHighways }] }
//   from / to は /api/route の結果の legs[].waypoints をそのまま送り返したもの（駐車するときは駐車場所）
import { InputError } from './messages.js';
import { normalizeWaypoint } from './schedule.js';

export const TOLL_PAYMENTS = ['etc2', 'etc', 'cash'];

export function normalizeTollRequest(body, { maxLegs = 9 } = {}) {
  if (!body || !Array.isArray(body.legs) || !body.legs.length) throw new InputError('noStops');
  if (body.legs.length > maxLegs) throw new InputError('tooManyStops', { max: maxLegs + 1 });
  const tollPayment = TOLL_PAYMENTS.includes(body.tollPayment) ? body.tollPayment : 'etc2';
  const legs = body.legs.map((l, i) => {
    const departure = Number(l?.departure);
    if (!Number.isFinite(departure)) throw new InputError('badTime', { value: String(l?.departure) });
    return {
      from: normalizeWaypoint(l.from, i + 1),
      to: normalizeWaypoint(l.to, i + 2),
      departure,
      options: { avoidTolls: Boolean(l.avoidTolls), avoidHighways: Boolean(l.avoidHighways) },
    };
  });
  return { tollPayment, legs };
}

// 区間ごとの料金と合計。区間は互いに関係しないので同時に検索する
// 「有料道路を使わない」区間は検索しない（料金 0 円、有料道路なし）
export async function computeTolls({ tollPayment, legs }, routeLeg) {
  const tolls = await Promise.all(
    legs.map(async ({ from, to, departure, options }) => {
      if (options.avoidTolls) return null;
      const leg = await routeLeg(from, to, departure, { ...options, tollPayment });
      return leg.toll ?? null;
    }),
  );
  return {
    tollPayment,
    tolls,
    totalYen: tolls.reduce((a, t) => a + (t?.status === 'priced' ? t.amount : 0), 0),
    unknown: tolls.some((t) => t?.status === 'unknown'),
  };
}
