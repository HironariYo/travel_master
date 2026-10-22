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
| 有料道路の料金 | Google Routes API の料金計算（任意） | 料金を計算するルート検索は **Compute Routes Enterprise** 扱いで、月 **1,000 回**まで無料、超えると 1,000 回あたり $15 |
| 地図のタイル | OpenStreetMap | 無料（利用規約あり。アクセスが多くなったら有料のタイル配信に切り替える） |

DB（Neon・Hyperdrive）は今は使いません。旅程の保存やログインが必要になったら、MobileOrderInfra と同じ方法で追加します。

場所の候補は、打つのが止まってから 0.25 秒後に 1 回問い合わせます（2 文字以上のとき）。1 地点あたり数回です。
1 回の計算で、区間の数だけ Routes API を呼びます（目的地 3 か所なら 3 回）。
有料道路の料金は、結果の「💴 有料道路の料金を計算」ボタンを押したときだけ計算します（`/api/tolls`）。そのとき有料道路を使う区間の数だけ Enterprise 扱いの検索をします（「有料道路を使わない」区間は検索しない）。ルートを計算するだけなら Enterprise の回数は増えません。Worker のサブリクエストの上限（無料プランで 50）に収まるよう、地点は `MAX_STOPS`（既定 10）までにしています。

## 1. Google の API キーを作る（任意・推奨）

キーがなくても動きます（OpenStreetMap で候補とルートを検索し、渋滞は考慮しません）。

1. [Google Cloud コンソール](https://console.cloud.google.com/) でプロジェクトを作る（MobileOrderInfra 用のプロジェクトは削除予定なので使わない）
2. **お支払い** で請求先アカウントを設定する（無料枠内なら請求なし。念のため **予算とアラート** で月 1 円などの予算アラートを作る）
3. **API とサービス → ライブラリ** で **Routes API** と **Places API (New)** を有効にする（「Places API」と書かれた古いほうではない）
4. **API とサービス → 認証情報 → 認証情報を作成 → API キー**
5. 作ったキーの **API の制限** で **Routes API と Places API (New) だけ** を許可する
   - キーは Worker（サーバー側）からだけ使うので、「アプリケーションの制限」は「なし」でよい（ブラウザにキーは出ない）
6. 使いすぎを防ぐ:
   - **Google Maps Platform → 割り当て**（https://console.cloud.google.com/google/maps-apis/quotas ）で、1 分あたりの上限を下げておく（例: Compute Routes 30、Autocomplete 60）。Routes API と Places API (New) は 1 分あたりの上限しか設定できない（1 日あたりの上限はない）
   - **お支払い → 予算とアラート** で月数百円の予算を作る（超えそうになるとメールが来る。課金は止まらない）
   - アプリ側でも 1 人（IP アドレス）あたりの回数を制限している（下の「セキュリティ」）

## 2. 公開する

```bash
npx wrangler login               # MobileOrderInfra で済んでいれば不要
npm install
npx wrangler secret put GOOGLE_MAPS_API_KEY   # 1 で作ったキー（使わないなら飛ばす）
npm run deploy
```

`https://travel.<サブドメイン>.workers.dev` を開き、出発地・目的地を入れて計算できることを確かめます。
キーを登録した場合は、場所の候補が Google の施設名・住所になり、結果の右上に「Google Routes API」と表示され、未来の出発時刻なら区間に「渋滞予測」が付きます。

## セキュリティ

- **回数制限**（`wrangler.jsonc` の `ratelimits`、Cloudflare の Rate Limiting・無料）: IP アドレスごとに 1 分あたり、ルート計算 10 回・場所の候補 60 回・料金の計算 5 回まで。超えると 429 を返し、画面に「少し待ってから」と出る。値は `wrangler.jsonc` で変えられる
- **画面のヘッダー**（`static/_headers`）: CSP（読み込めるのは自分のサイト・cdnjs・地図のタイルだけ、通信は自分の API だけ）、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy`、`Permissions-Policy`、HSTS。外部のファイルを足すときは CSP にも足す
- **地図ライブラリの改ざん検知**（`static/index.html` の `integrity`）: cdnjs の Leaflet が書き換えられていたら読み込まない。版を上げるときはハッシュも cdnjs の公表値に変える
- **API のヘッダー**（`src/worker.js` の `json()`）: `nosniff`・`no-store`・CSP。他のサイトからの呼び出しは 403
- **Google のキー**: Worker の秘密の値（`wrangler secret put`）に入れ、ブラウザには出さない
- **Node.js**: 本番は Cloudflare の実行環境（workerd）で動き、Node.js は使わない（Cloudflare が更新する）。手元の開発（`npm run dev`・テスト）は Node.js 24 以上（`.nvmrc`）。脆弱性の確認は `npm audit`、開発用ツールの更新は `npm install -D wrangler@latest`

## ログ

```bash
npx wrangler tail travel
```

Google の API のエラーは `[routes api]`・`[places api]` で始まる行に出ます（キーの制限や API の有効化を忘れると 403）。
