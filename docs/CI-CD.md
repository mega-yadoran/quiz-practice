# GitHub ActionsによるCI/CD

設定ファイル: `.github/workflows/ci-cd.yml`

2026-11-07時点で設定・APIトークン登録とも完了。[初回実行のattempt 2](https://github.com/mega-yadoran/quiz-practice/actions/runs/42371017355/attempts/2) で、テスト・マイグレーション・本番デプロイ・公開先の認証チェックまで成功を確認しています。通常運用でトークンの再登録は不要です。以下の初回設定は再構築・トークン更新時の参照用です。

## いつ何が動くか

| 操作 | 自動実行 |
| --- | --- |
| 任意のブランチにpush | 単体テスト、型チェック、ビルド、Worker/D1統合テスト、デプロイのdry run |
| Pull Requestの作成・更新 | 同じ検証。本番の認証情報は渡さない |
| mainにpush・マージ | 検証成功後、D1マイグレーション → Workerデプロイ → 公開先の認証確認 |
| ActionsからRun workflow | 選択したブランチを検証。mainを選んだ場合だけ本番へ反映 |

同じブランチでは処理を直列化し、実行中のマイグレーションを新しいpushで中断しません。さらに、デプロイ直前にmainの先頭と比較し、古くなったコミットは本番反映を省略します。

CIは本番とは別のローカルD1でテストします。検証した画面のビルド結果をArtifactでデプロイジョブへ渡します。Artifactには問題データ・回答・認証情報を含めません。

## 初回だけ必要な設定

Cloudflareの専用APIトークンを、GitHubの暗号化されたActions secretに登録します。ローカルのブラウザログインはGitHub Actionsには引き継がれません。

1. [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)でカスタムトークンを作成。
2. 名前の例: `quiz-practice-github-actions`。
3. 権限を以下に限定。
   - Account / Workers Scripts / Edit
   - Account / D1 / Edit
   - Account / Account Settings / Read
4. Account Resourcesは `yado` アカウントのみを指定。Zoneの編集権限やAccessの編集権限は不要。
5. トークンをコピーし、[リポジトリのActions secrets](https://github.com/mega-yadoran/quiz-practice/settings/secrets/actions) → New repository secretで登録。
   - Name: `CLOUDFLARE_API_TOKEN`
   - Secret: 作成したトークン
6. [Actions](https://github.com/mega-yadoran/quiz-practice/actions) → CI / CD → Run workflow → mainで実行。

トークンはチャット・ソースコード・Gitに書かないでください。アカウントIDとD1 IDは `wrangler.jsonc` にあるため、追加のsecretは必要ありません。初期状態ではトークン未登録のデプロイは明示的に失敗し、マイグレーション前に止まります。

`production` Environmentに承認者を追加すると手動承認待ちになります。mainへのpushで自動反映したい場合、必須承認者は設定しません。

## Google音声の公開準備

`wrangler.jsonc` は `TTS_PROVIDER=google`、`GOOGLE_TTS_VOICE=ja-JP-Standard-D` を設定済みです。mainへのpush前に、[Cloudflareダッシュボード](https://dash.cloudflare.com/)の Workers & Pages → `q-practice` → Settings → Variables and Secretsで、タイプを **Secret**、名前を `GOOGLE_TTS_API_KEY` としてGoogle CloudのAPIキーを登録・保存します。ローカルの `.dev.vars` は本番へ送られません。キーをGitHubのコードや通常の環境変数へ記入しないでください。

CLIで登録する場合は `npx wrangler secret put GOOGLE_TTS_API_KEY --config wrangler.jsonc` を使い、対話入力します。通常のデプロイで既存シークレットは維持されます。登録後は通常のmainへのpushでCI/CDを実行し、Actions成功とログイン後の実機で、告知「問題」→0.3秒→本文、自動再生・停止を確認します。固定の告知MP3はリポジトリに含まれ、再生成は不要です。

この音声変更はDBマイグレーションを追加しません。並行作業のマイグレーションや問題データの取り込みは、その作業のコミットと公開範囲に合わせて扱います。

## マイグレーションの運用

- 新しい変更は `migrations/0002_説明.sql` などの新規ファイルとして追加します。実行済みSQLは編集しません。
- D1は未実行のマイグレーションだけ適用します。通常の画面変更でデータベースを作り直すことはありません。
- テスト失敗時は本番DB・Workerに触れません。マイグレーション失敗時はWorkerの更新に進みません。
- マイグレーション成功後にデプロイが失敗すると、DBは更新済みで、Workerは以前の版のままです。旧版でも動く列・テーブルの追加を先に行い、削除などは別リリースに分けてください。
- デプロイが失敗してもDBの自動巻き戻しは行いません。履歴とデータを確認してから修正し、失敗ジョブの再実行または修正コミットのpushで復旧します。
- 列やデータを削除する前は、READMEのSQLバックアップ手順で退避してください。

## 公開後の確認範囲

`npm run check:production` は画面・API・静的ファイルが指定のCloudflare Accessログイン画面へ誘導されることを確認します。ログイン後の実機操作はこのチェックとは別です。ユーザーのログインCookieや、Accessを迂回するサービス用トークンはCIに渡しません。

## 固定と更新

Node.jsは22系、npm依存は `package-lock.json` と `npm ci` で固定します。GitHub公式アクションもコミットSHAに固定しています。バージョン更新は通常の変更としてテストを通して反映します。
