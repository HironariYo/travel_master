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
