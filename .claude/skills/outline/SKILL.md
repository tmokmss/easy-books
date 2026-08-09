---
name: outline
description: 階層ズーム・リーダー用のアウトライン（節区切り＋段落/節/章/部/作品要約）を生成する。/outline <chapterId> [sonnet|opus|fable] で1章、/outline <workId> --all で不足章の一括生成から部・作品要約・machine-checked 昇格まで行う
---

# アウトライン（要約レイヤー）生成スキル

翻訳済みの章から、階層ズーム・リーダー（docs/ZOOM.md）の節区切りと要約をボトムアップで生成する。
生成はセッション内のサブエージェントが行い、ビルドに LLM は入れない。結果は必ずコミットする。
エージェント向けの詳細手順は `source/outlines/INSTRUCTIONS.md`（章）と
`INSTRUCTIONS-PART.md`（部・作品）が正。このスキルはその投入と検証のオーケストレーション。

## 原則（違反禁止）

- **ネタバレ封じ込め**: 各要約は範囲の終端（coversUpTo）までの情報だけで書く。生成エージェントには
  **対象章の本文だけ**を渡し、他章・既存アウトライン・原文を読ませない。モデルの事前知識も
  持ち込ませない（INSTRUCTIONS.md に明記済み。check-summaries が機械検出で裏を取る）
- ボトムアップ厳守: 段落→節→章→部→作品。部は「その部の章要約のみ」、作品は「部要約のみ」を材料にする
- 本文（訳文・原文とも）を長文のままプロンプトや応答に貼らない。ファイルパスで渡す
- status は必ず draft で入る（ツールが強制）。human-reviewed / verified と approved の節区切りは
  ツールが上書きから保護する
- 章 JSON には触れない。要約は訳文から作るので、訳文を大きく直したら該当章の要約も作り直す

## 前提

- 対象章に訳文（ja）が入っていること（draft でよい）
- 部構造のある作品は `src/content/overviews/<workId>.json` に parts の器（chapters 列挙のみ、
  summary なし）を先に作る。部を持たない作品は overview を置かなくてよい（構造ビューは章の
  フラット表示に自動フォールバックする）

## 1章モード: /outline <chapterId> [model]

1. `npx tsx tools/export-ja.ts <chapterId>` でエージェント入力を書き出す
2. サブエージェント（既定 `sonnet`。41章の実績あり）に下の雛形で生成させる
3. `npx tsx tools/check-summaries.ts <workId> <chapterId>` で検査。FAIL は要約側を直す
   （範囲外の人物名は本文の呼び方＝「青年」「一人の士官」等に置き換えるのが定石）

## 一括モード: /outline <workId> --all

1. `npx tsx tools/export-ja.ts --all`
2. `src/content/outlines/` に無い章を列挙し、**1章=1エージェントで7〜13章ずつ並行**投入。
   各エージェントが merge-outline を exit 0 まで通す（罪と罰41章で一発〜数回修正の実績）
3. 全章完了後: 部ごとに1エージェント（材料はその部の章要約のみ）→ 作品要約1エージェント
   （材料は部要約のみ）→ `npx tsx tools/merge-overview.ts <workId>`
4. `npx tsx tools/check-summaries.ts <workId>` → FAIL 修正 → `--promote` で machine-checked へ
   → `npm run build` が通ることを確認してコミット

## サブエージェントのプロンプト雛形（1章）

```
作業ディレクトリ: <リポジトリの絶対パス>

source/outlines/INSTRUCTIONS.md を読み、その手順に厳密に従って、章 <chapterId> の
節区切りと要約（段落→節→章のボトムアップ）を作成せよ。

- 本文: source/outlines/ja/<chapterId>.txt
- 人物表記: src/data/works/<workId>/people.json
- 出力: source/outlines/<chapterId>.json
- 検証: `npx tsx tools/merge-outline.ts <chapterId> source/outlines/<chapterId>.json` を exit 0 まで

INSTRUCTIONS.md の禁止事項（対象章以外を読まない・事前知識の持ち込み禁止・
本文の長い引用を応答に貼らない）を守ること。
```

段落数が20未満の短い章では「節は最低2つ・過不足なく連続分割できればよい（5〜15段落の
目安より優先）」と一言添える。

## 注意

- 訳文レビューや people.json の拡充のあとは check-summaries を再実行する。台帳に人物が
  増えると検出語彙が広がり、新たな FAIL が出うる（実例: 罪と罰で表記統一後に
  「名前の初出前使用」が5件検出され、本文の呼び方に修正した）
- 段落IDは不変が前提。翻訳側で段落構成が変わったらその章のアウトラインは作り直す
- 要約の human-reviewed 以上への昇格と節区切りの approved 化は人間の仕事。機械は
  machine-checked まで
