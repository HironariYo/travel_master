# travel_master

車で回る旅程を計画する Web アプリ。MobileOrderInfra と同じ **Cloudflare Workers + Static Assets**（無料枠）で動きます。

## ページ 1: ドライブ旅程プランナー（`/`）

- 出発地と出発日時、目的地（いくつでも、既定で 10 か所まで）を入力する
- 場所は **2 文字以上打つと候補が出る**（「熱海駅」「江ノ島」など）。選ぶと ✓ が付き、その地点の位置が確定する（同じ名前の別の場所と取り違えない）
- 目的地ごとに **滞在時間** と、任意で **出発時刻** を指定できる
  - 出発時刻が空欄 → 到着 + 滞在時間で出発
  - 出発時刻を指定 → その時刻まで待って出発（待ち時間を表示）。滞在を終えても間に合わないときは警告し、遅れた時刻で以降を計算する
- 区間ごとに車のルートを検索し、**地図**（ルートと番号つきのピン）と **時刻表**（到着・滞在・待ち・出発、日付の切り替わり）、合計（全体時間・運転時間・距離）を表示
- 有料道路・高速道路を使わない条件を**区間ごと**に指定できる（各目的地の「ここまでの道」。「全区間まとめて」で一括設定も可）
  - ほかに道がない区間は警告を出す
- **路上パーキングに停める**（東京都内）: 目的地ごとに選ぶと、到着時刻（日本時間）の曜日・祝日・利用時間で使える近くの時間制限駐車区間（パーキング・メーター／チケット）を探し、そこまでのルートにする
  - 目的地から 1 km 以内で、使える区間のうち近いもの（最大時間・利用時間に収まる区間を優先）
  - 駐車場所から目的地までの徒歩（往復）を滞在に足して時刻を計算し、次の区間は駐車場所から出発する
  - 最大時間（60 分など）を超える・利用時間の終わりを過ぎるときは警告。1 km 以内に使える区間がなければ「路上駐車場なし」と出し、目的地へそのまま向かう
  - 利用時間外や対象外の日（日曜・休日など）に停めてよいかは区間ごとの標識しだいなので、「使えない」として扱う
- 時刻はすべて日本時間で入力・表示する（端末のタイムゾーンによらない）
- Google マップとの連動
  - 「Google マップで全ルートを開く」／区間ごと・地点ごとのリンク（スマホでは Google マップのアプリが開く）
  - `GOOGLE_MAPS_API_KEY` を登録すると、ルート検索に **Google Routes API** を使い、出発時刻に合わせた**渋滞予測**つきの所要時間になる
- 入力内容はブラウザに保存。「共有リンクをコピー」で同じ計画を別の人・端末で開ける
- 「旅程をテキストでコピー」で LINE などに貼れる

### ルート検索の仕組み

| `GOOGLE_MAPS_API_KEY` | 場所の候補 | ルート検索 | 渋滞 |
|---|---|---|---|
| あり（推奨） | Google Places API (New) Autocomplete。選んだ候補の Place ID をそのままルート検索に使う | Google Routes API | 未来の出発なら考慮 |
| なし | Photon（OpenStreetMap）。選んだ候補の座標を使う | Valhalla の公開サーバー（FOSSGIS） | 考慮しない |

Google の API は Worker から呼ぶので、キーはブラウザに出ません。キーなしはお試し・開発用で、施設の情報は Google より少なめです。
候補から選ばずに文字のまま計算することもできますが、その場合は同じ名前の別の場所になることがあります（例: キーなしで「熱海駅」が福島県の熱海駅になる）。

地図の表示は Leaflet + OpenStreetMap のタイル（キー不要・無料）です。

## 構成

```
src/worker.js     Worker のエントリポイント（/api/route, /api/places, /api/config。それ以外は static/ を返す）
src/schedule.js   旅程の計算（到着・待ち・出発）と入力の検証
src/routing.js    ルート検索（Google Routes API / OpenStreetMap）
src/places.js     場所の候補（Google Places API / Photon）
src/parking.js    近くの時間制限駐車区間を探す（曜日・祝日・利用時間の判定）
src/data/         駐車区間と祝日のデータ（npm run build:parking で作る）
scripts/          データを作るスクリプト
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

## 駐車区間のデータ

`src/data/tokyo-parking.json` は、次のデータを `npm run build:parking`（`scripts/build-parking-data.js`）で加工したものです。

- 警視庁「[時間制限駐車区間案内地図](https://parking-meter.jp/) オープンデータ」（[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)）: 区間の線（KML）と属性（CSV。利用時間・最大時間・手数料・対象外の曜日）
- 内閣府「[国民の祝日について](https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html)」の祝日 CSV: 前年以降の祝日（内閣府の公開範囲まで。今は翌年まで）

警視庁のデータが更新されたとき、また毎年 2 月ごろ（内閣府が翌年の祝日を公開したあと）に実行し直して、コミットしてください。
画面には出典を表示しています（CC BY 4.0 の条件）。
