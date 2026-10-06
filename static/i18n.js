// 画面の文言（日本語・英語・韓国語）
// HTML の固定の文言は data-i18n（textContent）、data-i18n-html（innerHTML）、data-i18n-attr="placeholder:key,aria-label:key" で指定する
// JavaScript で組み立てる文言は t('key', { 値 }) で取り出す

export const LANGS = [
  { code: 'ja', label: '日本語', locale: 'ja-JP' },
  { code: 'en', label: 'English', locale: 'en-US' },
  { code: 'ko', label: '한국어', locale: 'ko-KR' },
];

const STORAGE_KEY = 'travel-master:lang';

const ja = {
  offDayDetail: ({ kind, days, hours, limit }) =>
    `${kind}・今日は${days}のためメーター対象外（料金・時間制限なし。ふだんは${hours}・最大${limit}分）`,
  offDayNewYear: '1月1日〜3日',
  warnCheckSigns: 'メーターが動いていない日です。駐車禁止の標識・表示がある場所には停められないので、現地で必ず確かめてください',
  sep: '・',
  title: 'ドライブ旅程プランナー',
  lead: '目的地と出発時刻・滞在時間を入れると、車のルートと全体のスケジュールを計算します。',
  language: '言語',
  planTitle: '行き先',
  addStop: '＋ 目的地を追加',
  optionsLegend: 'ルートの条件（全区間まとめて）',
  avoidTolls: '有料道路を使わない',
  avoidHighways: '高速道路を使わない',
  optionsNote: '区間ごとに変えるときは、各目的地の「ここまでの道」で選んでください。',
  hint:
    '時刻はすべて日本時間です。「出発時刻」は空欄でもかまいません。空欄なら到着後、滞在時間だけ過ごしてから出発します。' +
    '指定した場合は、その時刻まで待ってから出発します（間に合わないときは警告します）。' +
    '場所は 2 文字以上打つと候補が出るので、そこから選んでください（✓ が付きます）。' +
    '<code>35.6812, 139.7671</code> のような座標でも入力できます。',
  submit: 'ルートとスケジュールを計算',
  calculating: '計算中…',
  reset: 'クリア',
  resultTitle: 'ルートとスケジュール',
  mapRegion: 'ルートの地図',
  empty: '出発地と目的地を入力して「計算」を押すと、ここにルートと時刻表が表示されます。',
  moveUp: '上へ',
  moveDown: '下へ',
  remove: '削除',
  place: '場所',
  placePlaceholder: '例: 東京駅、箱根、江ノ島',
  placeChecked: '候補から選んだ場所',
  stayMinutes: '滞在時間（分）',
  departOrigin: '出発日時（必須）',
  departStop: '出発時刻（任意）',
  legOptions: 'ここまでの道',
  parkingOption: '🅿 近くの路上パーキング（パーキング・メーター等）に停めて歩く',
  parkingOptionNote: '東京都内のみ。目的地から 1 km 以内で、到着時刻の曜日・祝日・利用時間に使える区間を選びます',
  origin: '出発地',
  destination: ({ n }) => `目的地 ${n}`,
  maxStops: ({ n }) => `地点は ${n} か所までです`,
  enterPlace: ({ name }) => `${name}を入力してください`,
  enterDeparture: '出発地の出発日時を入力してください',
  httpError: ({ status }) => `エラーが発生しました（${status}）`,
  network: '通信に失敗しました',
  inputChanged: '入力が変わりました。「ルートとスケジュールを計算」を押すと反映されます',
  calculated: ({ time, conditions }) => `計算しました（${time}・${conditions}）`,
  placesFailed: '候補を取得できませんでした',
  noSuggestions: '候補が見つかりません。別の言葉でお試しください',
  mapUnavailable: '地図を読み込めませんでした。時刻表と Google マップのリンクは使えます。',
  legTooltip: ({ from, to, duration }) => `${from} → ${to}：${duration}`,
  parkingZone: '駐車区間',
  parkingPopup: ({ place }) => `🅿 ${place}の駐車区間`,
  walkToDestination: ({ n }) => `目的地まで徒歩約${n}分`,
  arrive: '到着',
  depart: '出発',
  end: '終了',
  walk: '徒歩',
  walkOneWay: ({ n }) => `片道${n}分`,
  stay: '滞在',
  wait: '出発待ち',
  duration: ({ h, m }) => (h ? (m ? `${h}時間${m}分` : `${h}時間`) : `${m}分`),
  hours: ({ from, to }) => `${from}〜${to}`,
  sumStart: '出発',
  sumEnd: '終了',
  sumTotal: '全体',
  sumDrive: '運転',
  sumDistance: '距離',
  sumStayWait: '滞在・待ち',
  sumWalk: '徒歩（往復）',
  conditionsLabel: ({ text }) => `ルートの条件: ${text}`,
  condNone: '指定なし（有料道路・高速道路も使う）',
  condPerLeg: '区間ごとに指定',
  condJoin: '・',
  tagNoToll: '有料道路なし',
  tagNoHighway: '高速道路なし',
  tagTraffic: '渋滞予測',
  toll: '有料道路',
  highway: '高速道路',
  unavoidable: ({ roads }) => `⚠ この区間は${roads}を通らないと行けません`,
  legLink: 'この区間を Google マップで',
  placeLink: '地図',
  openAll: 'Google マップで全ルートを開く',
  share: '共有リンクをコピー',
  copyText: '旅程をテキストでコピー',
  copied: 'コピーしました',
  copyPrompt: 'コピーしてください',
  source: ({ link, date }) => `駐車区間: ${link}（${date} 時点）。空きがあるとは限りません。現地の標識・表示に従ってください。`,
  sourceName: '警視庁 時間制限駐車区間案内地図オープンデータ（CC BY 4.0）を加工して作成',
  late: ({ duration }) => `指定の出発時刻に ${duration} 間に合いません。滞在を短くするか、時刻を見直してください。`,
  providerGoogle: 'Google Routes API',
  providerOsm: 'OpenStreetMap（渋滞は考慮しません）',
  textCar: ({ duration, distance }) => `  ↓ 車 ${duration}（${distance}）`,
  textArrive: ({ time }) => `${time} 着`,
  textDepart: ({ time }) => `${time} 発`,
  textEnd: ({ time }) => `${time} 終了`,
  textGoogleMaps: 'Google マップ',
  meter: 'パーキング・メーター',
  ticket: 'パーキング・チケット',
  closedSunHoliday: '日曜・休日',
  closedWeekendHoliday: '土日・休日',
  parkingDetail: ({ kind, hours, closed, limit, fee }) =>
    `${kind}・${hours}${closed ? `（${closed}を除く）` : ''}・最大${limit}分・${fee}円`,
  parkHere: '路上パーキングに停める',
  parkDistance: ({ meters, walk }) => `目的地から約${meters}m（徒歩約${walk}分）`,
  parkingSpot: '駐車場所',
  textParking: ({ meters, walk, detail }) => `  🅿 路上パーキング: 目的地から約${meters}m（徒歩${walk}分） ${detail}`,
  noParking: '路上駐車場なし',
  noParkingReason: ({ reason }) => `（近くの区間は${reason}）`,
  reasonNewYear: '1月1日〜3日は対象外',
  reasonClosed: ({ days }) => `${days}は対象外`,
  reasonOutsideHours: ({ hours }) => `利用時間外（${hours}）`,
  reasonNoLocation: '目的地の位置が分かりませんでした',
  warnOverLimit: ({ minutes, limit, maxStay }) =>
    `停めておく時間（滞在＋徒歩往復＋待ち＝${minutes}分）が最大${limit}分を超えます（延長はできません）。` +
    (maxStay > 0 ? `滞在を${maxStay}分以内にすると収まります` : '滞在が短くても収まりません'),
  warnOverHours: ({ hours }) => `利用時間（${hours}）の終わりを過ぎます。過ぎた後は現地の標識に従ってください`,
  warnUnavailableAtArrival: ({ reason }) => `到着時刻には使えません（${reason}）`,
  warnHolidayUnknown: '祝日データの範囲外の日付です。祝日かどうかは確かめてください',
};

const en = {
  offDayDetail: ({ kind, days, hours, limit }) =>
    `${kind} · meters are off today (${days}): no fee and no time limit (normally ${hours}, max ${limit} min)`,
  offDayNewYear: 'Jan 1–3',
  warnCheckSigns: 'Meters are off today. You cannot park where no-parking signs or markings apply, so always check on site',
  sep: ' · ',
  title: 'Drive Itinerary Planner',
  lead: 'Enter your destinations, departure times and how long you will stay, and get the driving route and a full schedule.',
  language: 'Language',
  planTitle: 'Destinations',
  addStop: '+ Add destination',
  optionsLegend: 'Route options (all legs)',
  avoidTolls: 'Avoid toll roads',
  avoidHighways: 'Avoid highways',
  optionsNote: 'To change this for one leg only, use "Route to here" on each destination.',
  hint:
    'All times are Japan Standard Time. "Departure time" is optional: if left blank, you leave after the stay time. ' +
    'If set, you wait until that time before leaving (you will be warned if you cannot make it). ' +
    'Type 2 or more characters to see suggestions and pick one (a ✓ appears). ' +
    'You can also enter coordinates such as <code>35.6812, 139.7671</code>.',
  submit: 'Calculate route & schedule',
  calculating: 'Calculating…',
  reset: 'Clear',
  resultTitle: 'Route & schedule',
  mapRegion: 'Route map',
  empty: 'Enter a starting point and destinations, then press "Calculate" to see the route and timetable here.',
  moveUp: 'Move up',
  moveDown: 'Move down',
  remove: 'Remove',
  place: 'Place',
  placePlaceholder: 'e.g. Tokyo Station, Hakone, Enoshima',
  placeChecked: 'Chosen from suggestions',
  stayMinutes: 'Stay (min)',
  departOrigin: 'Departure (required)',
  departStop: 'Departure time (optional)',
  legOptions: 'Route to here',
  parkingOption: '🅿 Park at nearby on-street parking (parking meters etc.) and walk',
  parkingOptionNote: 'Tokyo only. Picks a zone within 1 km of the destination that is usable on that day, holiday and time of arrival',
  origin: 'Start',
  destination: ({ n }) => `Destination ${n}`,
  maxStops: ({ n }) => `You can enter up to ${n} places`,
  enterPlace: ({ name }) => `Please enter a place for ${name}`,
  enterDeparture: 'Please enter the departure date and time from the start',
  httpError: ({ status }) => `Something went wrong (${status})`,
  network: 'Network error',
  inputChanged: 'Your input has changed. Press "Calculate route & schedule" to update',
  calculated: ({ time, conditions }) => `Calculated (${time} · ${conditions})`,
  placesFailed: "Couldn't get suggestions",
  noSuggestions: 'No suggestions found. Try different words',
  mapUnavailable: "Couldn't load the map. The timetable and Google Maps links still work.",
  legTooltip: ({ from, to, duration }) => `${from} → ${to}: ${duration}`,
  parkingZone: 'Parking zone',
  parkingPopup: ({ place }) => `🅿 Parking zone for ${place}`,
  walkToDestination: ({ n }) => `About ${n} min walk to the destination`,
  arrive: 'Arrive',
  depart: 'Depart',
  end: 'End',
  walk: 'Walk',
  walkOneWay: ({ n }) => `${n} min each way`,
  stay: 'Stay',
  wait: 'Wait',
  duration: ({ h, m }) => (h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`),
  hours: ({ from, to }) => `${from}–${to}`,
  sumStart: 'Start',
  sumEnd: 'End',
  sumTotal: 'Total',
  sumDrive: 'Driving',
  sumDistance: 'Distance',
  sumStayWait: 'Stay & wait',
  sumWalk: 'Walk (round trip)',
  conditionsLabel: ({ text }) => `Route options: ${text}`,
  condNone: 'None (toll roads and highways allowed)',
  condPerLeg: 'Set per leg',
  condJoin: ', ',
  tagNoToll: 'No tolls',
  tagNoHighway: 'No highways',
  tagTraffic: 'Traffic forecast',
  toll: 'toll roads',
  highway: 'highways',
  unavoidable: ({ roads }) => `⚠ This leg cannot avoid ${roads}`,
  legLink: 'Open this leg in Google Maps',
  placeLink: 'Map',
  openAll: 'Open the whole route in Google Maps',
  share: 'Copy share link',
  copyText: 'Copy itinerary as text',
  copied: 'Copied',
  copyPrompt: 'Copy this',
  source: ({ link, date }) => `Parking zones: ${link} (as of ${date}). Spaces may not be available. Always follow the signs on site.`,
  sourceName: 'Based on Tokyo Metropolitan Police Department "Time-Limited Parking Zone Map" open data (CC BY 4.0), modified',
  late: ({ duration }) => `You will be ${duration} late for the set departure time. Shorten the stay or change the time.`,
  providerGoogle: 'Google Routes API',
  providerOsm: 'OpenStreetMap (no traffic data)',
  textCar: ({ duration, distance }) => `  ↓ Drive ${duration} (${distance})`,
  textArrive: ({ time }) => `arrive ${time}`,
  textDepart: ({ time }) => `leave ${time}`,
  textEnd: ({ time }) => `end ${time}`,
  textGoogleMaps: 'Google Maps',
  meter: 'Parking meter',
  ticket: 'Parking ticket',
  closedSunHoliday: 'Sundays & holidays',
  closedWeekendHoliday: 'weekends & holidays',
  parkingDetail: ({ kind, hours, closed, limit, fee }) =>
    `${kind} · ${hours}${closed ? ` (except ${closed})` : ''} · max ${limit} min · ¥${fee}`,
  parkHere: 'Park on the street',
  parkDistance: ({ meters, walk }) => `about ${meters} m from the destination (about ${walk} min walk)`,
  parkingSpot: 'Parking spot',
  textParking: ({ meters, walk, detail }) => `  🅿 On-street parking: about ${meters} m from the destination (${walk} min walk) ${detail}`,
  noParking: 'No on-street parking',
  noParkingReason: ({ reason }) => ` (nearby zones: ${reason})`,
  reasonNewYear: 'not available Jan 1–3',
  reasonClosed: ({ days }) => `not available on ${days}`,
  reasonOutsideHours: ({ hours }) => `outside operating hours (${hours})`,
  reasonNoLocation: "couldn't locate the destination",
  warnOverLimit: ({ minutes, limit, maxStay }) =>
    `You would be parked ${minutes} min (stay + walking + waiting), over the ${limit} min limit (no extensions). ` +
    (maxStay > 0 ? `Stay ${maxStay} min or less to fit` : 'It does not fit even with a short stay'),
  warnOverHours: ({ hours }) => `You will still be parked after the operating hours (${hours}) end. After that, follow the signs on site`,
  warnUnavailableAtArrival: ({ reason }) => `Not usable at your arrival time (${reason})`,
  warnHolidayUnknown: 'This date is beyond the holiday data. Please check whether it is a public holiday',
};

const ko = {
  offDayDetail: ({ kind, days, hours, limit }) =>
    `${kind} · 오늘은 ${days}이라 미터 대상 외 (요금·시간 제한 없음. 평소에는 ${hours} · 최대 ${limit}분)`,
  offDayNewYear: '1월 1일~3일',
  warnCheckSigns: '미터가 작동하지 않는 날입니다. 주차 금지 표지·표시가 있는 곳에는 세울 수 없으니 현지에서 반드시 확인해 주세요',
  sep: ' · ',
  title: '드라이브 일정 플래너',
  lead: '목적지와 출발 시각, 체류 시간을 입력하면 자동차 경로와 전체 일정을 계산합니다.',
  language: '언어',
  planTitle: '목적지',
  addStop: '+ 목적지 추가',
  optionsLegend: '경로 조건 (전체 구간)',
  avoidTolls: '유료도로 이용 안 함',
  avoidHighways: '고속도로 이용 안 함',
  optionsNote: '구간별로 바꾸려면 각 목적지의 「여기까지의 길」에서 선택해 주세요.',
  hint:
    '시각은 모두 일본 시간입니다. 「출발 시각」은 비워 두어도 됩니다. 비워 두면 도착 후 체류 시간만큼 머문 뒤 출발합니다. ' +
    '지정하면 그 시각까지 기다렸다가 출발합니다 (늦을 때는 경고합니다). ' +
    '장소는 2글자 이상 입력하면 후보가 나오니 그중에서 선택해 주세요 (✓ 표시가 붙습니다). ' +
    '<code>35.6812, 139.7671</code> 같은 좌표로도 입력할 수 있습니다.',
  submit: '경로와 일정 계산',
  calculating: '계산 중…',
  reset: '지우기',
  resultTitle: '경로와 일정',
  mapRegion: '경로 지도',
  empty: '출발지와 목적지를 입력하고 「계산」을 누르면 여기에 경로와 시간표가 표시됩니다.',
  moveUp: '위로',
  moveDown: '아래로',
  remove: '삭제',
  place: '장소',
  placePlaceholder: '예: 도쿄역, 하코네, 에노시마',
  placeChecked: '후보에서 선택한 장소',
  stayMinutes: '체류 시간 (분)',
  departOrigin: '출발 일시 (필수)',
  departStop: '출발 시각 (선택)',
  legOptions: '여기까지의 길',
  parkingOption: '🅿 근처 노상 주차 (파킹 미터 등)에 세우고 걷기',
  parkingOptionNote: '도쿄도 내만 해당. 목적지에서 1km 이내에서 도착 시각의 요일·공휴일·이용 시간에 이용할 수 있는 구간을 고릅니다',
  origin: '출발지',
  destination: ({ n }) => `목적지 ${n}`,
  maxStops: ({ n }) => `지점은 ${n}곳까지 입력할 수 있습니다`,
  enterPlace: ({ name }) => `${name}: 장소를 입력해 주세요`,
  enterDeparture: '출발지의 출발 일시를 입력해 주세요',
  httpError: ({ status }) => `오류가 발생했습니다 (${status})`,
  network: '통신에 실패했습니다',
  inputChanged: '입력이 바뀌었습니다. 「경로와 일정 계산」을 누르면 반영됩니다',
  calculated: ({ time, conditions }) => `계산했습니다 (${time} · ${conditions})`,
  placesFailed: '후보를 가져오지 못했습니다',
  noSuggestions: '후보가 없습니다. 다른 말로 검색해 보세요',
  mapUnavailable: '지도를 불러오지 못했습니다. 시간표와 Google 지도 링크는 사용할 수 있습니다.',
  legTooltip: ({ from, to, duration }) => `${from} → ${to}: ${duration}`,
  parkingZone: '주차 구간',
  parkingPopup: ({ place }) => `🅿 ${place}의 주차 구간`,
  walkToDestination: ({ n }) => `목적지까지 도보 약 ${n}분`,
  arrive: '도착',
  depart: '출발',
  end: '종료',
  walk: '도보',
  walkOneWay: ({ n }) => `편도 ${n}분`,
  stay: '체류',
  wait: '출발 대기',
  duration: ({ h, m }) => (h ? (m ? `${h}시간 ${m}분` : `${h}시간`) : `${m}분`),
  hours: ({ from, to }) => `${from}~${to}`,
  sumStart: '출발',
  sumEnd: '종료',
  sumTotal: '전체',
  sumDrive: '운전',
  sumDistance: '거리',
  sumStayWait: '체류·대기',
  sumWalk: '도보 (왕복)',
  conditionsLabel: ({ text }) => `경로 조건: ${text}`,
  condNone: '지정 없음 (유료도로·고속도로도 이용)',
  condPerLeg: '구간별로 지정',
  condJoin: ' · ',
  tagNoToll: '유료도로 없음',
  tagNoHighway: '고속도로 없음',
  tagTraffic: '정체 예측',
  toll: '유료도로',
  highway: '고속도로',
  unavoidable: ({ roads }) => `⚠ 이 구간은 ${roads}를 지나지 않으면 갈 수 없습니다`,
  legLink: '이 구간을 Google 지도에서',
  placeLink: '지도',
  openAll: 'Google 지도에서 전체 경로 열기',
  share: '공유 링크 복사',
  copyText: '일정을 텍스트로 복사',
  copied: '복사했습니다',
  copyPrompt: '복사해 주세요',
  source: ({ link, date }) => `주차 구간: ${link} (${date} 기준). 빈자리가 있다고는 할 수 없습니다. 현지 표지판·표시를 따라 주세요.`,
  sourceName: '경시청 「시간제한 주차구간 안내지도」 오픈데이터 (CC BY 4.0)를 가공하여 작성',
  late: ({ duration }) => `지정한 출발 시각보다 ${duration} 늦습니다. 체류를 줄이거나 시각을 다시 확인해 주세요.`,
  providerGoogle: 'Google Routes API',
  providerOsm: 'OpenStreetMap (정체는 고려하지 않음)',
  textCar: ({ duration, distance }) => `  ↓ 자동차 ${duration} (${distance})`,
  textArrive: ({ time }) => `${time} 도착`,
  textDepart: ({ time }) => `${time} 출발`,
  textEnd: ({ time }) => `${time} 종료`,
  textGoogleMaps: 'Google 지도',
  meter: '파킹 미터',
  ticket: '파킹 티켓',
  closedSunHoliday: '일요일·공휴일',
  closedWeekendHoliday: '토·일요일·공휴일',
  parkingDetail: ({ kind, hours, closed, limit, fee }) =>
    `${kind} · ${hours}${closed ? ` (${closed} 제외)` : ''} · 최대 ${limit}분 · ${fee}엔`,
  parkHere: '노상 주차하기',
  parkDistance: ({ meters, walk }) => `목적지에서 약 ${meters}m (도보 약 ${walk}분)`,
  parkingSpot: '주차 장소',
  textParking: ({ meters, walk, detail }) => `  🅿 노상 주차: 목적지에서 약 ${meters}m (도보 ${walk}분) ${detail}`,
  noParking: '노상 주차장 없음',
  noParkingReason: ({ reason }) => ` (근처 구간은 ${reason})`,
  reasonNewYear: '1월 1일~3일은 이용 불가',
  reasonClosed: ({ days }) => `${days}은 이용 불가`,
  reasonOutsideHours: ({ hours }) => `이용 시간 외 (${hours})`,
  reasonNoLocation: '목적지의 위치를 알 수 없었습니다',
  warnOverLimit: ({ minutes, limit, maxStay }) =>
    `세워 두는 시간 (체류+도보 왕복+대기=${minutes}분)이 최대 ${limit}분을 넘습니다 (연장 불가). ` +
    (maxStay > 0 ? `체류를 ${maxStay}분 이내로 하면 맞습니다` : '체류를 줄여도 맞지 않습니다'),
  warnOverHours: ({ hours }) => `이용 시간 (${hours})이 끝난 뒤에도 세워 두게 됩니다. 그 후에는 현지 표지판을 따라 주세요`,
  warnUnavailableAtArrival: ({ reason }) => `도착 시각에는 이용할 수 없습니다 (${reason})`,
  warnHolidayUnknown: '공휴일 데이터 범위 밖의 날짜입니다. 공휴일인지 확인해 주세요',
};

const DICT = { ja, en, ko };

function initialLang() {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (DICT[fromUrl]) return fromUrl;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (DICT[saved]) return saved;
  } catch {
    /* 保存できない環境では端末の言語 */
  }
  for (const l of navigator.languages ?? [navigator.language]) {
    const code = String(l).slice(0, 2).toLowerCase();
    if (DICT[code]) return code;
  }
  return 'ja';
}

let current = initialLang();

export const getLang = () => current;
export const getLocale = () => LANGS.find((l) => l.code === current).locale;

export function setLang(code) {
  if (!DICT[code]) return;
  current = code;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* 保存できなくても切り替えはする */
  }
}

export function t(key, params = {}) {
  const v = DICT[current][key] ?? ja[key];
  if (v === undefined) return key;
  return typeof v === 'function' ? v(params) : v;
}

// data-i18n などの付いた要素の文言を、今の言語にする（<template> の中も）
export function applyStatic(root = document) {
  const roots = [root, ...[...root.querySelectorAll('template')].map((tpl) => tpl.content)];
  for (const r of roots) {
    r.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
    r.querySelectorAll('[data-i18n-html]').forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml)));
    r.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      for (const pair of el.dataset.i18nAttr.split(',')) {
        const [attr, key] = pair.split(':');
        el.setAttribute(attr.trim(), t(key.trim()));
      }
    });
  }
  if (root === document) {
    document.documentElement.lang = current;
    document.title = t('title');
  }
}
