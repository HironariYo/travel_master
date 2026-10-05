# travel_master

車で回る旅程を計画する Web アプリ。MobileOrderInfra と同じ **Cloudflare Workers + Static Assets**（無料枠）で動きます。

## ページ 1: ドライブ旅程プランナー（`/`）

- 出発地と出発日時、目的地（いくつでも、既定で 10 か所まで）を入力する
- 目的地ごとに **滞在時間** と、任意で **出発時刻** を指定できる
  - 出発時刻が空欄 → 到着 + 滞在時間で出発
  - 出発時刻を指定 → その時刻まで待って出発（待ち時間を表示）。滞在を終えても間に合わないときは警告し、遅れた時刻で以降を計算する
- 区間ごとに車のルートを検索し、**地図**（ルートと番号つきのピン）と **時刻表**（到着・滞在・待ち・出発、日付の切り替わり）、合計（全体時間・運転時間・距離）を表示
- 有料道路・高速道路を使わない条件
- Google マップとの連動
  - 「Google マップで全ルートを開く」／区間ごと・地点ごとのリンク（スマホでは Google マップのアプリが開く）
  - `GOOGLE_MAPS_API_KEY` を登録すると、ルート検索に **Google Routes API** を使い、出発時刻に合わせた**渋滞予測**つきの所要時間になる
- 入力内容はブラウザに保存。「共有リンクをコピー」で同じ計画を別の人・端末で開ける
- 「旅程をテキストでコピー」で LINE などに貼れる

### ルート検索の仕組み

| `GOOGLE_MAPS_API_KEY` | ルート検索 | 渋滞 | 備考 |
|---|---|---|---|
| あり（推奨） | Google Routes API（Worker から呼ぶので、キーはブラウザに出ない） | 未来の出発なら考慮 | 住所・施設名の解決が正確 |
| なし | OpenStreetMap（Nominatim + OSRM の公開デモサーバー） | 考慮しない | お試し・開発用。同じ名前の別の場所になることがある（例: 「熱海駅」が福島県の熱海駅になる） |

地図の表示は Leaflet + OpenStreetMap のタイル（キー不要・無料）です。

## 構成

```
src/worker.js     Worker のエントリポイント（/api/route, /api/config。それ以外は static/ を返す）
src/schedule.js   旅程の計算（到着・待ち・出発）と入力の検証
src/routing.js    ルート検索（Google Routes API / OpenStreetMap）
static/           画面（index.html, app.js, style.css）
test/             単体テスト（node --test）
```

## 手元で動かす

```bash
npm install
cp .dev.vars.example .dev.vars   # Google のキーを使うなら GOOGLE_MAPS_API_KEY を書く
npm run dev                      # http://localhost:8787
npm test
```

公開の手順は [docs/DEPLOY.md](docs/DEPLOY.md) を参照してください。
