# 読解支援リーダー（easy-books）

パブリックドメインの古典文学を、**読解支援レイヤー**（人物・語注の注釈）つきの新訳で読む静的サイト。
Astro で組み、GitHub Pages に配信する。

> この製品の中心価値は訳文そのものではなく、読解支援レイヤーである。
> UIの判断で迷ったら、この一文に戻ること。

v1 の対象はドストエフスキー『罪と罰』第一部 第一章。データ構造は作品を限定しない
（`src/data/works.json` に作品を追加すれば任意のパブリックドメイン古典を載せられる）。

## 構成

```
src/
├── content/chapters/       # 本文（原文+訳文+マークアップ）。Content Collections で検証
├── content/outlines/       # 階層ズーム: 章ごとの節区切り＋要約（docs/ZOOM.md）
├── content/overviews/      # 階層ズーム: 作品・部の要約
├── data/
│   ├── works.json          # 作品カタログ
│   └── works/<workId>/     # 作品ごとの台帳（people / glossary / style-guide）
├── components/             # Reader, PersonRail, AnnotationCard, SettingsPanel, ZoomBar
├── scripts/                # クライアント側 TS（reader.ts, settings.ts, stretchtext.ts, progress.ts ほか）
└── pages/                  # index, read/[chapter], works/[work]（構造ビュー）
tools/                      # ビルドと切り離したオフライン処理（下記）
source/                     # 原文と中間生成物（再現性のためコミットする）
```

## インラインマークアップ

3種類だけ。増やさない。

| 記法 | 意味 | 表示 |
|---|---|---|
| `{{p:id\|表示}}` | 固有名での人物言及 | 実線下線（緑）。愛称・父称形のときだけ本名グロス |
| `{{r:id\|表示}}` | 代名詞・普通名詞での言及 | 既定では無印。タップのみ効く |
| `{{n:id\|表示}}` | 語注 | 点線下線（黄） |

存在しないIDの参照や記法違反はビルド時に落ちる（`src/content.config.ts`）。

## パイプライン（手動実行・結果をコミット）

ビルド中にLLM APIは呼ばない。呼ぶと訳文がビルドごとに変わり差分レビューが成立しない。

```sh
# 1. 原文の取得（例: ロシア語版ウィキソースから）→ source/wikisource/ に保存
# 2. 段落スケルトン生成
npx tsx tools/wikisource-to-paragraphs.ts source/wikisource/crime-01-01.api.json crime crime-01-01 "第一部 第一章" 1
#    FB2 形式の原文には tools/fb2-to-paragraphs.ts を使う（出力形式は同一）

# 3. 翻訳 — 2経路ある
#    a) Claude Code 内で翻訳（推奨・APIキー不要）: /translate crime-01-01 [sonnet|opus]
#       モデル比較は /translate compare crime-01-01（.claude/skills/translate/ 参照）
#       結果の機械マージ: npx tsx tools/merge-translation.ts crime-01-01 <ja.json> --by <model>
#    b) APIで無人バッチ実行（要 ANTHROPIC_API_KEY または `ant auth login`）:
npm run tools:translate -- crime-01-01 --limit 10

# 4. 機械チェック（オフライン）。人間レビューの前のふるい
npm run tools:check -- crime-01-01

# 5. 文単位の対訳アラインメント（読書画面の「対訳（原文）を表示」用）
npx tsx tools/split-src.ts crime-01-01        # 原文を機械分割
#    → 対応付けJSONを LLM に作らせ（/translate スキル参照）、検証つきで反映:
npx tsx tools/align-segments.ts crime-01-01 source/alignments/crime-01-01.a1.json

# 5. 注釈候補の抽出（台帳への反映は人間が手で行う）
npm run tools:extract -- crime-01-01

# 6. 階層ズーム・リーダー（構造ビュー・stretchtext 用の節区切りと要約。詳細は docs/ZOOM.md）
npx tsx tools/export-ja.ts --all                    # エージェント入力（ja 本文）を書き出す
#    → 生成は Claude Code 内のエージェント（source/outlines/INSTRUCTIONS.md 参照）
npm run tools:outline -- crime-01-01 source/outlines/crime-01-01.json   # 検証つきマージ
npm run tools:check-summaries -- crime --promote    # ネタバレ・整合の機械ふるい → machine-checked
```

翻訳は `claude-opus-5` を使用。安全分類器の誤検知に備えてサーバーサイドフォールバック
（`fallbacks: "default"`）を有効にしている。

- 段落IDは一度振ったら変えない（読書位置と注釈の参照先になる）
- `status`: `draft`（機械訳）→ `checked` → `reviewed`（人間が原文と照合済み）
- `verified: false` の語注はUIに「未検証」と表示される

## 開発

```sh
npm install
npm run dev      # 開発サーバ
npm run build    # 静的ビルド（マークアップ検証込み）
```

デプロイは `main` への push で GitHub Actions（`withastro/action`）が実行する。
リポジトリの Settings > Pages で Source を **GitHub Actions** にすること。

## 著作権

- 原文はパブリックドメインの底本のみ使用し、出所を各章のフッターに明記する
- 既存の日本語訳は参照も流用もしない。訳出は原文から行う（AIによる新訳である旨をサイトに明記）
- 裏取りのない注釈は `verified: false` のまま公開してよいが、「未検証」と表示する
