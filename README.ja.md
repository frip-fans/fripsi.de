# fripSi.de

[简体中文](./README.md) | [日本語](./README.ja.md) | [English](./README.en.md)

[fripSi.de](https://fripsi.de) は、ファンが運営する非公式の fripSide イベントカレンダー兼ライブセットリスト資料庫です。

公開情報をもとに、イベント、リリース、楽曲バージョン、ライブでの演奏記録を整理しています。コンテンツは Cloudflare D1 に保存され、サイト内の管理画面から更新できるため、データ更新のたびにサイトを再ビルドする必要はありません。

> 本サイトは fripSide の公式サイトではなく、fripSide および関連団体との提携・所属関係もありません。公式情報は [fripside.net](https://fripside.net) をご確認ください。

## 主な機能

- 月ごとのイベント閲覧と、公開 iCalendar フィードによるカレンダー購読。
- 年、種類、開催地、キーワードによる過去イベントの検索。
- Live Journey の世界地図とタイムラインによる、歴代の現地イベント軌跡の再生。
- ライブセットリスト、リリース収録曲、楽曲バージョン、およびそれらの関連情報の閲覧。
- コミュニティページと埋め込み GitHub Discussions による公開ディスカッション。
- インタラクティブな「八木沼悟志濃度検定」でユーモアのある判定結果を生成。
- 公開サイトの簡体字中国語、繁体字中国語、日本語、英語表示。
- `/admin` からのイベント、楽曲、リリース、セットリスト管理。
- 情報源と管理操作の記録による、検証・訂正のサポート。
- 独立した Remote MCP Worker による資料検索と、レビュー対象となる変更提案の送信。

## 技術スタック

- [Astro](https://astro.build/) SSR
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- TypeScript、Vitest、Playwright
- Bootstrap Icons（ビルド時にローカル SVG として取り込み）
- Leaflet、MapLibre GL、OpenStreetMap（インタラクティブ地図と地図タイル）

React は使用していません。また、Notion などの外部サービスをオンラインデータソースとして利用していません。

## リポジトリ構成

```text
apps/
├── web/          Astro サイト、管理画面、Web API
└── mcp/          Remote MCP Worker
packages/
└── core/         データアクセス、検証、権限管理、共通ビジネスロジック
migrations/       D1 データベースマイグレーション
scripts/          データ収集、整形、インポート用スクリプト
data/             インポート用テンプレートと調査データ
docs/             アーキテクチャ、データモデル、デプロイ資料
```

## ローカル開発

Node.js 24 と npm が必要です。

```bash
git clone https://github.com/frip-fans/fripsi.de.git
cd fripsi.de
npm install

cp apps/web/.dev.vars.example apps/web/.dev.vars
cp apps/mcp/.dev.vars.example apps/mcp/.dev.vars

npm run db:migrate:local
npm run db:seed:local
npm run dev:web
```

デフォルトでは、サイトは `http://localhost:4321`、管理画面は `http://localhost:4321/admin` で起動します。ローカル用のサンプル設定では `DEV_AUTH_BYPASS` によりテスト用ユーザーを利用できますが、本番環境では絶対に有効にしないでください。

MCP Worker をデバッグする場合は、別のターミナルで次を実行します。

```bash
npm run dev:mcp
```

MCP エンドポイントのデフォルト URL は `http://localhost:8787/mcp`、ヘルスチェックは `/health` です。

## よく使うコマンド

| コマンド | 用途 |
|---|---|
| `npm run dev:web` | Web 開発サーバーを起動 |
| `npm run dev:mcp` | MCP Worker の開発サーバーを起動 |
| `npm run typecheck` | 全 workspace とデータスクリプトの型チェック |
| `npm test` | テストを実行 |
| `npm run build` | 全 workspace をビルド |
| `npm run build:web` | Web のみをビルド |
| `npm run visual:check` | Playwright でトップページの表示を確認 |
| `node scripts/visual-check-journey.mjs` | PC／モバイルで Journey の地図と再生操作を確認 |
| `npm run db:migrate:local` | ローカル D1 にマイグレーションを適用 |
| `npm run db:seed:local` | ローカル D1 にサンプルデータを投入 |

## データ管理

イベント、楽曲、リリース、セットリストについては D1 が唯一の正本です。一括更新では、まずリポジトリ所定の CSV 形式にデータを整理し、インポートスクリプトで構造化データを生成または書き込みます。情報の訂正を提出する際は、一般にアクセス可能な参照元 URL も添えてください。

- [音楽資料庫のデータ構造とインポート形式](./docs/music-library.md)
- [データベースモデル](./docs/data-model.md)
- [管理画面と MCP](./docs/admin-and-mcp.md)

Notion から旧イベントデータを移行する場合は、次を実行します。

```bash
npm run import:notion -- data/raw/export.csv
npm run import:sql
```

元のエクスポートファイルは、Git の追跡対象外である `data/raw/` に配置してください。インポート前に、生成された検証レポートと SQL を必ず確認してください。

## デプロイ

Web と MCP は、同じ D1 データベースを共有する別々の Cloudflare Worker としてデプロイされます。各 `wrangler.jsonc` には Worker、binding、公開環境変数の設定が含まれます。トークン、Access 認証情報などの機密値は、Cloudflare Secrets またはビルド環境変数で管理してください。

本番データベースのマイグレーションは別途実行する必要があり、サイトのビルド時には自動適用されません。デプロイ手順と Cloudflare Access の設定については、[デプロイ資料](./docs/deployment.md)を参照してください。

## コントリビューション

機能の提案、資料の訂正、バグ報告は [Issues](https://github.com/frip-fans/fripsi.de/issues) へお寄せください。Pull Request も歓迎します。

コードを提出する前に、次を実行してください。

```bash
npm run typecheck
npm test
npm run build
```

画面上の文言を変更する場合は、対応する4言語すべてを更新してください。イベントや音楽資料を変更する場合は情報源を添え、許諾のない画像・音声・著作物の長文をコミットしないでください。

## ライセンスと権利表記

本リポジトリのコードは [GNU General Public License v3.0](./LICENSE) のもとで公開されています。

fripSide の名称、ロゴ、作品、その他の関連素材に関する権利は、それぞれの権利者に帰属します。GPL が適用されるのは、本リポジトリ内でコントリビューターがライセンスできるコードのみです。第三者の名称、作品、データソース、メディア素材に対して追加の権利を付与するものではありません。
