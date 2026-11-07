# Quiz Practice

自分用のクイズ練習帳。iPhone 13 miniのSafariとPCのChromeを想定した、React + TypeScript / Hono / Cloudflare Workers / D1のアプリです。

## できること

- 問題の手入力・編集・検索、UTF-8 CSVの一括取り込み（1回500問）
- 取り込み前のプレビュー、エラー表示、同じ問題IDでの更新
- 全問題から出題。一巡内で重複せず、途中の問題・進み具合をクラウドに保存
- 日本語の読み上げ、停止、読み直し、速度調整
- 文字入力による正誤判定、登録した別解との照合、手動の正解扱い
- お気に入り追加・解除・一覧、解答履歴、簡単な成績
- 問題CSVおよび全データJSONの書き出し
- Cloudflare Accessで所有者1名に制限。WorkerでもJWTの署名・発行者・対象・メールアドレスを検証

初版の出題範囲は「全問題」のみです。iPhone標準キーボードのマイクで音声入力できます。アプリ独自の録音・音声認識、オフライン利用、JSONの一括復元画面は追加機能です。

## ローカルで起動

Node.js 22.12以降、npmが必要です。初回:

```powershell
npm ci
npm run build
npm run db:local
```

本番とローカルは別設定・別データです。`wrangler.local.jsonc`にはローカル環境用の設定があり、Cloudflareへのログインなしで動きます。

ターミナル1（API・ビルド済み画面）:

```powershell
npm run dev:api
```

ブラウザで `http://127.0.0.1:8797` を開けます。ソースの画面変更を即時反映したい場合は、ターミナル2で以下も実行し、表示されたViteのURLを開きます。

```powershell
npm run dev
```

「問題を管理」→「CSV取り込み」→「例題5問で試す」で、動作確認用の例題を登録できます。例題は本番データベースに自動登録されません。

## CSV形式

必須列は `id,text,answer`。任意列は `aliases,reading,category,source,note`。

```csv
id,text,answer,aliases,reading,category,source,note
q001,日本で最も高い山は何でしょう？,富士山,ふじさん|フジサン,,地理,,標高は3776メートルです。
```

- ファイルはUTF-8（BOM付きも可）、1回500問、4MB以内。Excelでは「CSV UTF-8」で保存。
- 日本語列名 `問題ID,問題文,正解,別解,読み上げ用,分野,出典,メモ` も使用可能。
- 別解は `|` 区切り。改行・カンマを含むセルは通常のCSV引用符で囲む。
- IDは固定。再取り込みは同じIDの問題を更新し、お気に入りを維持する。
- 過去の履歴・現在出題中の問題には出題時点の文章・正解・解説を保持する。
- 編集は後の出題に反映。一巡の途中で追加した問題は、その一巡の未出題に含める。

## 判定・進み具合

正解と別解をUnicode NFKCで正規化し、前後の空白を除去、英字を小文字にして完全一致で判定します。内部の空白、句読点、ひらがな・カタカナ、略称の差は勝手に除去しません。

出題順は問題登録時に付ける乱数キーと一巡ごとのランダムな開始位置で決めます。全件のランダムソートを繰り返さず、一巡内で同じ問題を出さない構成です。巡ごとに完全に独立したシャッフルではなく、登録済み問題の乱数順を回転させます。

同時に複数端末から「次の問題」を押しても、未回答の出題は1問に保ちます。判定の再送で履歴は増えません。「わからない・正解を見る」は履歴に記録し、正解率の分母から除外します。日別の集計は日本時間です。

## 本番への公開

アカウント: `yado`。Worker名・D1名: `q-practice`。

公開URL: https://q-practice.yado-quiz.workers.dev

AccessアプリID: `79d6d7cc-02d3-48f9-824c-bd470de6885d`。メールのワンタイムPINで所有者だけログイン可能。セッション期間は7日です。以下の初回設定はすでに反映済みです。通常の更新では `npm run deploy` を実行します。

希望ドメイン `q-practice.mega-yadoran.jp` は、現在のCloudflareアカウントに親ドメインのゾーンがないため保留です。切り替える場合の手順:

1. Cloudflareにドメインのゾーンがあり、そのDNSが有効であることを確認。
2. Cloudflare Zero Trustの無料プランでAccessを準備。
3. Self-hostedアプリを作成し、ドメインを指定。AllowポリシーのEmailsは `yado@mega-yadoran.jp` のみ。メールのワンタイムPINを利用可能にする。
4. `wrangler.jsonc`の `ACCESS_TEAM_DOMAIN` に `チーム名.cloudflareaccess.com`、`ACCESS_AUD` にAccessアプリのAudienceを設定。
5. `wrangler.jsonc`に `"routes":[{"pattern":"q-practice.mega-yadoran.jp","custom_domain":true,"zone_name":"mega-yadoran.jp"}]` を追加。旧URLを廃止する場合は `workers_dev` をfalseにする。
6. 以下を実行。

```powershell
npx wrangler login --device
npm run db:remote
npm run deploy
```

すでに作成済みのD1は `wrangler.jsonc` に紐付けています。通常の再公開で作り直す必要はありません。独自ドメインを設定するときは、同名の既存DNSレコードやサービスを上書きしないよう確認してください。

Accessの設定が不足している間は、Workerは503で閉じます。署名済みのAccessトークンがない利用者は401、所有者以外は403です。画面・API・静的ファイルのすべてをWorkerの認証処理に通します。`workers.dev`はAccessで保護し、プレビューURLは本番で無効にしています。

設定後は、未ログインのブラウザでAccessログイン画面になることと、所有者でログインするとアプリが開くことを確認します。iPhoneではSafariで開き、読み上げ・停止・標準キーボードでの音声入力を確認してください。

## バックアップ

設定画面の「問題をCSVで保存」は問題を再取り込みできます。「全データをJSONで保存」は問題・お気に入り・回答履歴・進み具合・設定を含む保管用です。JSONからの復元画面は初版に含めていません。

完全復元に使えるSQLバックアップ:

```powershell
npx wrangler d1 export q-practice --remote --output q-practice-backup.sql
```

バックアップは個人の問題・回答を含みます。安全な場所で保管し、Gitには追加しないでください。復旧するときは、まず新しい空のD1に読み込み、内容を確認してから本番の接続先を切り替えます。

```powershell
npx wrangler d1 execute <復元先の新しいDB名> --remote --file q-practice-backup.sql
```

D1無料枠のTime Travelは7日です。長期保管は別途SQLを書き出してください。容量上限は1データベース500MB。書き出しAPIは全データをまとめるため、データが大きくなったら上記のD1 SQL書き出しを使ってください。

## 検証

```powershell
npm test
npm run test:integration
npm run check:deploy
```

- 単体テスト: 正誤判定、CSVの往復・検証、公開時の認証・クロスサイト更新の拒否。
- 統合テスト: 独立したD1ローカル環境を作り、取り込み・問題更新・出題の同時操作・一巡完了・再開・お気に入り・履歴・設定・書き出しを確認。本番と通常のローカルデータは変更しない。
- 本番向けビルドとWorkerのdry run。

`scripts/integration.mjs`は専用の一時ポートと `.wrangler/integration-*` の保存先を使い、終了時に自分で起動したWorkerを停止します。

## ディレクトリ

```text
src/               Reactの画面、ブラウザでの読み上げ
worker/            HonoのAPI、Accessの認証、D1操作
shared/            問題の型・検証・CSV・判定ロジック
migrations/        D1のスキーマ
tests/             単体テスト
scripts/           統合テスト
wrangler.jsonc     本番設定
wrangler.local.jsonc ローカル設定
```
