# エージェント向け引き継ぎ

## 現在の状態と読む順番

2026-11-07にプロトタイプ完成。ユーザーから動作確認済みの報告あり。追加機能は次の依頼に応じて扱い、ドキュメントの候補一覧だけを根拠に実装を始めない。

最初に以下を読む。説明を重複させず、変更した内容の対応資料を更新する。

1. [README.md](README.md): 起動・操作・CSV・公開・バックアップ。
2. [docs/SPEC.md](docs/SPEC.md): ユーザーと合意した仕様と未実装の候補。
3. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): 構成、保存データ、実装上の制約。
4. [docs/CI-CD.md](docs/CI-CD.md): 自動テスト・マイグレーション・デプロイ・障害時の扱い。
5. [docs/VERIFICATION.md](docs/VERIFICATION.md): 確認済みの範囲と残る実機確認。

公開先: https://q-practice.yado-quiz.workers.dev

GitHub: https://github.com/mega-yadoran/quiz-practice

## 実装の基本

- Node.js + TypeScriptを基本とする。React/Viteが画面、HonoがAPI、Cloudflare Workersが本番実行環境、D1が保存先。Pythonは採用していない。
- Node.jsの開発環境とWorkersの実行環境は異なる。Node.js専用APIやライブラリを追加するときはWorkersでの互換性も確認する。
- 主対象はiPhone 13 miniのSafariとPCのChrome。片手で押せるボタン、モバイル幅、回答欄の入力しやすさを維持する。
- 判定・データ検証は `shared/` に集約し、クライアントの検証だけで済ませない。
- 問題ID、出題時点のスナップショット、一巡内の重複防止、判定の再送対策を維持する。詳細は実装メモを参照。
- 現在は所有者1人用。複数ユーザー用のデータ分離は実装されていない。

## ローカル開発と確認

初回は `npm ci` → `npm run build` → `npm run db:local`。`npm run dev:api` で http://127.0.0.1:8797 を開く。画面の即時反映が必要なら別ターミナルで `npm run dev` を起動する。

- ローカル: `wrangler.local.jsonc` / `--local`。
- 本番: `wrangler.jsonc` / `--remote`。D1は同じ名前でもローカルの保存先とは別。
- `.wrangler/` は実行状態と作業用ツールの置き場。新しいチャット・PCにこの中のファイルやログインが存在するとは限らない。
- 開発サーバーを起動した場合は終了時に自分のプロセスを片付け、他のプロジェクトのサーバーを止めない。

変更内容に応じて確認する:

- 判定・CSV・認証: `npm test`。
- 画面・型: `npm run build` と必要な画面操作。
- API・D1・出題・マイグレーション: ビルド後に `npm run test:integration`。
- Workerの公開設定: `npm run check:deploy`。
- 本番公開後の認証誘導: `npm run check:production`。これはログイン後の操作やiPhoneの音声動作の確認を代替しない。

文書だけの変更は、リンク・記述・`git diff --check`を確認すればよい。機能変更に不要なテストを増やさない。

## 認証・データ・公開

- Cloudflare AccessとWorkerのJWT検証を併用する。所有者メールの制限、署名・issuer・audience検証、設定不足時に閉じる動作を維持する。
- 画面・API・静的ファイルの認証を維持する。`assets.run_worker_first` の変更では静的配信による認証迂回が起きないか確認する。
- 認証省略は `ENVIRONMENT=local` かつloopbackホストのみ。本番をlocal設定で運用しない。
- `.dev.vars*`、`.env*`、トークン、ログインCookie、DB・問題・回答のバックアップをGitやログへ出さない。設定例は除外ルールの例外として管理できる。
- ツールの保存済み認証情報を直接読み取らず、公式ツールの通常の認証経路を使う。認証コードや秘密値をユーザーにチャットへ貼らせない。
- 既存の本番DBを初期化・再作成しない。スキーマ変更は新しいSQLマイグレーションを追加し、実行済みファイルは編集しない。
- マイグレーションは旧Workerでも動く変更を先に行う。データ削除などはバックアップと影響確認を伴う別作業にする。
- **mainへのpushは本番マイグレーションとデプロイを自動実行する。** 依頼範囲を確認してコミット・pushし、公開した場合はActionsの結果まで確認する。通常はCI/CDを使い、手動公開は復旧など必要な場合に限る。
- GitHubの `CLOUDFLARE_API_TOKEN` は登録済み。新しい作業で再登録を前提にしない。秘密値の取得・再作成は通常作業に不要。
- 独自ドメインは保留。ドメイン変更ではAccess、Worker、ワークフローのURL、公開後チェック、資料をまとめて確認する。

## ユーザーへの報告

日本語で、変更内容・確認結果・残っている作業を簡潔に伝える。プロジェクト方針への準拠を理由に未実施事項を列挙する説明は避ける。ユーザーが承認した内容を繰り返し確認しない。
