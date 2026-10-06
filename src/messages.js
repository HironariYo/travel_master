// API が返すエラーメッセージ（日本語・英語・韓国語）
// 画面で選んだ言語を lang で受け取り、その言語で返す。InputError などはキーと値だけを持つ

export const LANGS = ['ja', 'en', 'ko'];

export function normalizeLang(value) {
  return LANGS.includes(value) ? value : 'ja';
}

const MESSAGES = {
  ja: {
    badTime: ({ value }) => `時刻の形式が正しくありません: ${value}`,
    noStops: () => 'stops がありません',
    emptyStop: ({ n }) => `${n} 番目の地点が空です`,
    placeTooLong: ({ n }) => `${n} 番目の地点が長すぎます`,
    badStay: ({ n }) => `${n} 番目の滞在時間が正しくありません`,
    needDestination: () => '出発地と目的地を 1 つ以上入力してください',
    tooManyStops: ({ max }) => `地点は ${max} か所までです`,
    needDeparture: () => '出発地の出発時刻を入力してください',
    routeSearchFailed: ({ from, to }) => `「${from}」→「${to}」のルートを検索できませんでした。地点を候補から選び直してください`,
    noRoute: ({ from, to }) => `「${from}」→「${to}」の車のルートが見つかりませんでした`,
    placeNotFound: ({ place }) => `「${place}」が見つかりませんでした。入力中に出る候補から選んでください`,
    routingServiceError: () => 'ルート検索サービスでエラーが発生しました',
    geocodeServiceError: () => '住所の検索サービスでエラーが発生しました',
    placesFailed: () => '場所の候補を取得できませんでした',
    badJson: () => 'JSON の形式が正しくありません',
    unknownError: () => 'エラーが発生しました',
  },
  en: {
    badTime: ({ value }) => `Invalid time format: ${value}`,
    noStops: () => 'stops is missing',
    emptyStop: ({ n }) => `Place #${n} is empty`,
    placeTooLong: ({ n }) => `Place #${n} is too long`,
    badStay: ({ n }) => `The stay time for place #${n} is invalid`,
    needDestination: () => 'Enter a starting point and at least one destination',
    tooManyStops: ({ max }) => `You can enter up to ${max} places`,
    needDeparture: () => 'Enter the departure time from the starting point',
    routeSearchFailed: ({ from, to }) => `Couldn't search a route from "${from}" to "${to}". Please choose the places from the suggestions again`,
    noRoute: ({ from, to }) => `No driving route found from "${from}" to "${to}"`,
    placeNotFound: ({ place }) => `"${place}" was not found. Please choose from the suggestions shown as you type`,
    routingServiceError: () => 'The route search service returned an error',
    geocodeServiceError: () => 'The address search service returned an error',
    placesFailed: () => "Couldn't get place suggestions",
    badJson: () => 'Invalid JSON',
    unknownError: () => 'Something went wrong',
  },
  ko: {
    badTime: ({ value }) => `시각 형식이 올바르지 않습니다: ${value}`,
    noStops: () => 'stops가 없습니다',
    emptyStop: ({ n }) => `${n}번째 지점이 비어 있습니다`,
    placeTooLong: ({ n }) => `${n}번째 지점이 너무 깁니다`,
    badStay: ({ n }) => `${n}번째 지점의 체류 시간이 올바르지 않습니다`,
    needDestination: () => '출발지와 목적지를 1곳 이상 입력해 주세요',
    tooManyStops: ({ max }) => `지점은 ${max}곳까지 입력할 수 있습니다`,
    needDeparture: () => '출발지의 출발 시각을 입력해 주세요',
    routeSearchFailed: ({ from, to }) => `「${from}」→「${to}」 경로를 검색하지 못했습니다. 후보에서 지점을 다시 선택해 주세요`,
    noRoute: ({ from, to }) => `「${from}」→「${to}」 자동차 경로를 찾지 못했습니다`,
    placeNotFound: ({ place }) => `「${place}」을(를) 찾지 못했습니다. 입력 중에 나오는 후보에서 선택해 주세요`,
    routingServiceError: () => '경로 검색 서비스에서 오류가 발생했습니다',
    geocodeServiceError: () => '주소 검색 서비스에서 오류가 발생했습니다',
    placesFailed: () => '장소 후보를 가져오지 못했습니다',
    badJson: () => 'JSON 형식이 올바르지 않습니다',
    unknownError: () => '오류가 발생했습니다',
  },
};

export function message(lang, key, params = {}) {
  const fn = MESSAGES[normalizeLang(lang)][key] ?? MESSAGES.ja[key];
  return fn ? fn(params) : key;
}

// 入力の誤り（400）。メッセージは日本語で持ち、返すときに lang で訳し直す
export class InputError extends Error {
  constructor(key, params = {}) {
    super(message('ja', key, params));
    this.name = 'InputError';
    this.key = key;
    this.params = params;
  }
}

// 外部サービスの誤り（既定 502）
export class RoutingError extends Error {
  constructor(key, status = 502, params = {}) {
    super(message('ja', key, params));
    this.name = 'RoutingError';
    this.key = key;
    this.params = params;
    this.status = status;
  }
}
