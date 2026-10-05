# デプロイ手順（Cloudflare Workers・無料枠）

MobileOrderInfra（`order`）と同じ Cloudflare アカウントに、別の Worker `travel` として公開します。
公開 URL は `https://travel.<サブドメイン>.workers.dev`（MobileOrderInfra と同じサブドメインなら `https://travel.tanomus.workers.dev`）。

> 無料枠の内容は変わることがあります。数値は 2026-10 時点の目安です。

| 役割 | サービス | 無料枠の目安 |
|---|---|---|
| API（ルート検索の中継・旅程の計算） | Cloudflare Workers | 10 万リクエスト／日、CPU 10ms／リクエスト |
| 画面（HTML・CSS・JS） | Workers Static Assets | 無制限 |
| ルート検索 | Google Routes API（任意） | Essentials（Compute Routes）は月 10,000 回まで無料。渋滞予測（TRAFFIC_AWARE）は Pro 扱いで月 5,000 回まで無料 |
| 場所の候補 | Google Places API (New) Autocomplete（任意） | 月 10,000 回まで無料 |
| 地図のタイル | OpenStreetMap | 無料（利用規約あり。アクセスが多くなったら有料のタイル配信に切り替える） |

DB（Neon・Hyperdrive）は今は使いません。旅程の保存やログインが必要になったら、MobileOrderInfra と同じ方法で追加します。

場所の候補は、打つのが止まってから 0.25 秒後に 1 回問い合わせます（2 文字以上のとき）。1 地点あたり数回です。
1 回の計算で、区間の数だけ Routes API を呼びます（目的地 3 か所なら 3 回）。Worker のサブリクエストの上限（無料プランで 50）に収まるよう、地点は `MAX_STOPS`（既定 10）までにしています。

## 1. Google の API キーを作る（任意・推奨）

キーがなくても動きます（OpenStreetMap で候補とルートを検索し、渋滞は考慮しません）。

1. [Google Cloud コンソール](https://console.cloud.google.com/) でプロジェクトを作る（MobileOrderInfra 用のプロジェクトは削除予定なので使わない）
2. **お支払い** で請求先アカウントを設定する（無料枠内なら請求なし。念のため **予算とアラート** で月 1 円などの予算アラートを作る）
3. **API とサービス → ライブラリ** で **Routes API** と **Places API (New)** を有効にする（「Places API」と書かれた古いほうではない）
4. **API とサービス → 認証情報 → 認証情報を作成 → API キー**
5. 作ったキーの **API の制限** で **Routes API と Places API (New) だけ** を許可する
   - キーは Worker（サーバー側）からだけ使うので、「アプリケーションの制限」は「なし」でよい（ブラウザにキーは出ない）
6. 使いすぎを防ぐ: **API とサービス → Routes API / Places API (New) → 割り当て** で 1 日あたりのリクエスト数の上限を下げておく（例: Routes 300、Places 1000）

## 2. 公開する

```bash
npx wrangler login               # MobileOrderInfra で済んでいれば不要
npm install
npx wrangler secret put GOOGLE_MAPS_API_KEY   # 1 で作ったキー（使わないなら飛ばす）
npm run deploy
```

`https://travel.<サブドメイン>.workers.dev` を開き、出発地・目的地を入れて計算できることを確かめます。
キーを登録した場合は、場所の候補が Google の施設名・住所になり、結果の右上に「Google Routes API」と表示され、未来の出発時刻なら区間に「渋滞予測」が付きます。

## ログ

```bash
npx wrangler tail travel
```

Google の API のエラーは `[routes api]`・`[places api]` で始まる行に出ます（キーの制限や API の有効化を忘れると 403）。
