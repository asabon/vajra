# AI コーディングエージェント開発ガイドライン (`AGENTS.md`)

このリポジトリは、AI コーディングエージェント向けに独自のワークフロースキルを生成するメタスキル **vajra** の Fork です。

本リポジトリで作業するすべての AI コーディングエージェント（Antigravity, Cursor, Claude Code, GitHub Copilot 等）は、以下のルールとアーキテクチャ設計を厳守してください。

---

## 🏗️ プロジェクトアーキテクチャ & モジュール構成

vajra の主要コードは `skills/vajra/` 配下に配置されています。

- **`skills/vajra/SKILL.md`**:
  - vajra メタスキルのエントリーポイント。エージェント向け指示、モード一覧（Generate, Consult, Evolve, Inspect, Update）を定義。
- **`skills/vajra/workflows/`**:
  - 各モードの具体的な実行手順（`generate.md`, `consult.md`, `evolve.md`, `inspect.md`）。
- **`skills/vajra/references/`**:
  - ワークフロー設計に必要な仕様群。
  - `blueprints/`: spike, poc, harden, ship などのプレイブック基本型。
  - `facets/`: 物理世界連携、データ依存、成果測定などのドメイン特性チェックリスト。
  - `rails.md`: ランタイムによるガードレール仕様、フックの挙動。
- **`skills/vajra/scripts/`**:
  - ランタイムおよび検証スクリプト。
  - `flow.mjs`: 生成された各スキルに同梱される軽量ランタイム（CLI / MCP / フック機能）。
  - `validate.mjs`: グラフの整合性・デッドロック・ドメイン適合性を検証するバリデータ。
  - `interview.mjs`: ユーザー要件ヒアリング用スクリプト。
  - `lib/`: ランタイムとバリデータの共通ライブラリ（`tools.mjs`, `hooks.mjs`, `settings.mjs`, `protect.mjs`, `bindings.mjs` 等）。
- **`examples/`**:
  - 代表的な実ドメインのサンプルフロー群（`medical-v-model-flow`, `robot-grasp-flow`, `scrum-team-flow`, `search-ranking-flow`）。
- **`tests/`**:
  - 単体・結合テスト群（`flow.test.mjs`, `validate.test.mjs`, `interview.test.mjs`, `library.test.mjs`）。
- **`evals/`**:
  - 各ケースに対する構造的適合性の評価スイート。

---

## 🌐 言語方針（日本語と英語の使い分け）

本リポジトリは英語圏のプロジェクトを Fork していますが、開発者の思考・作業効率を最優先するため、以下のように明確な境界線を設けて使い分けます。

- **日本語を使用する領域**:
  - AI エージェントとの対話・指示・相談
  - ローカルメモ、作業記録、設計検討 (`AGENTS.md`, `.agents/`, `scratch/` 内のファイル)
  - `feature` ブランチでの日々の作業（WIP コミットメッセージなど）
- **英語を使用する領域**:
  - `skills/` や `tests/` 配下のソースコード内のコメント・Docstring
  - 本家（Upstream: `zwire/vajra`）向け Pull Request のタイトルおよび本文
  - 本家向けコミットメッセージ (Conventional Commits 形式)

> 💡 **AI エージェントへの指示**:
> ユーザーからの指示が日本語であっても、`skills/` や `tests/` 配下のコードコメントや本家提出用の PR 本文・コミットメッセージを作成する際は、AI が責任を持って自然な英語に翻訳・作成してください。

---

## 🌿 Git & ブランチ運用ルール（最重要）

本リポジトリは **本家（`upstream`: `zwire/vajra`）にクリーンな PR を提出しつつ、手元で AI ハーネス環境を維持する** 運用を行います。

### 1. ブランチの役割
- **`develop`（開発本線・ハーネス保持ブランチ）**:
  - 開発のベースラインとなるブランチ。`AGENTS.md` や `.agents/` などの AI ハーネス環境が常備されています。
  - 日常の開発や検証はここをベースに進めます。
- **`feature/<topic-name>` / `fix/<topic-name>`（本家還元コード開発ブランチ）**:
  - `develop` から分岐して本家還元用のコード（`skills/`, `tests/` 等）を修正するブランチ。
  - 🚫 **ハーネス（`AGENTS.md`, `.agents/`, `.githooks/`, `.coderabbit.yaml`）の変更は禁止**。
- **`chore/<topic-name>`（環境整備・AI ハーネスブランチ）**:
  - CI ワークフロー、スクリプト、`AGENTS.md` などのローカル環境を改善するブランチ。
  - 🚫 **プロダクションコード（`skills/`, `tests/` 等）の変更は禁止**。
- **`upstream/main`（本家の追跡）**:
  - 本家の最新状態を同期するための読み取り専用ブランチ。直接コミットしてはなりません。
- **`origin/main`（Fork の main / 本家ミラー）**:
  - Fork 先リポジトリの main ブランチ。`upstream/main` のクリーンなコピーとし、直接の開発作業は行いません。
- **`pr/<topic-name>`（本家提出用 PR ブランチ）**:
  - 本家へ PR を出す際、**一時的に `upstream/main`（または `origin/main`）から作成する専用ブランチ**。
  - `develop` にマージされたコミットのうち、本家に還元するクリーンなコミットのみを cherry-pick / 適用して作成します。

### 2. コミット・ブランチ分離の原則（機械的強制とフック）
本家への PR に手作業での除外漏れやローカル環境の混入事故を防ぐため、以下の自動検査を実施しています：

- **`.agents/scripts/check-branch-isolation.mjs`**:
  - `feature/*` や `pr/*` ブランチでハーネスファイル（`AGENTS.md`, `.agents/`, `.githooks/`, `.coderabbit.yaml` 等）が変更されていないか検査。
- **`.agents/scripts/check-no-japanese.mjs`**:
  - コアスクリプト（`skills/vajra/scripts/`）に日本語文字が混入していないか検査。
- **`.githooks/` (Git フック)**:
  - `pre-commit`: `main` への直接コミットをブロック。
  - `pre-push`: `main` への直接 push をブロック、および `pr/*` ブランチへのハーネス・日本語混入を検査・遮断。

---

## 🛠️ Windows / PowerShell 環境における注意事項

Windows (PowerShell) 環境特有の構文・文字化け・改行コード問題を回避するため、エージェントは [`.agents/rules/windows-shell-commands.md`](.agents/rules/windows-shell-commands.md) および [`.agents/rules/cli-markdown-escaping.md`](.agents/rules/cli-markdown-escaping.md) に規定されたルールを厳格に遵守してください。
