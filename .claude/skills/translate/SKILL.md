---
name: translate
description: 章の翻訳を Claude Code のセッション内で追加・比較する。/translate <chapterId> [sonnet|opus|fable] [--limit N] で翻訳、/translate compare <chapterId> [--limit N] でモデル比較。外部APIスクリプトではなくエージェント自身（またはサブエージェント）が訳す
---

# 翻訳スキル

翻訳は Claude Code のセッション内で行う。モデル指定があるときは Agent ツールの `model`
オーバーライド（`sonnet` / `opus` / `haiku` / `fable`）でサブエージェントに訳させ、
指定がなければこのセッションのモデルで直接訳す。
（`tools/translate.ts` はAPIキーで無人バッチ実行するための別経路。このスキルでは使わない）

## 原則（違反禁止）

- 既存の日本語訳（米川・工藤・江川ほか）を参照・流用しない。原文からのみ訳す
- 段落は必ず1対1対応。訳し落とし・要約・平易化をしない。長い独白・意図的な冗長さは原文のまま保つ
- **原文（ロシア語等）を長文のまま自分の出力に書き出さない**（APIの出力フィルタが
  「書籍長文の逐語再現」を検知してブロックする）。原文は必ずファイル経由で受け渡す。
  サブエージェントには「読むファイルのパス」と「段落ID」を渡し、本文をプロンプトに貼らない
- `checked` / `reviewed` の段落は上書きしない（merge-translation.ts が機械的に保護する）
- 新しい訳文の status は必ず `draft`。人間の照合を経ずに上げない
- 注釈マークアップ（`{{p:}}` 等）はここでは付けない。注釈付けはレビュー工程で行う
- **一人称・口調は style-guide.json の `people.*.firstPerson` に、固有名詞の表記は
  people.json と style-guide.json の `names`（表記→原語の台帳）に完全一致で従う。**
  台帳に無い話者・固有名詞が出たら、翻訳エージェントは報告で申告し、オーケストレータが
  台帳に追記してから次の章を投入する（章ごとに独立に決め直すと必ず表記が割れる）

## 通常モード: /translate <chapterId> [model] [--limit N]

1. `source/paragraphs/<chapterId>.src.json` の存在を確認。無ければ、作品自体が未登録なら
   `/add-work <書名>` を先に実行、登録済みなら原文取得から（README「パイプライン」参照）
2. `src/content/chapters/<chapterId>.json` と突き合わせ、未翻訳の段落IDを列挙する
3. 翻訳を実行（10段落程度ずつのバッチ。バッチをまたぐときは直前3段落の訳を文脈として引き継ぐ）
   - **モデル指定あり** → 下のテンプレでサブエージェントを起動（`model` を指定）
   - **指定なし** → このセッションで直接訳し、同形式の ja JSON を書く
4. 機械マージ: `npx tsx tools/merge-translation.ts <chapterId> <ja.jsonのパス> --by <モデル名>`
5. ふるい: `npx tsx tools/check-alignment.ts <chapterId>`（章内の数量・否定・文数）と
   `npx tsx tools/check-consistency.ts <workId>`（作品全体の固有名詞・一人称ゆれ）を実行し、
   指摘を要約して報告（どちらも誤検知を含む。明白な訳し落とし・表記ゆれは修正して再マージ）
6. **文単位アラインメント**（対訳表示用の src↔ja 対応）:
   1. `npx tsx tools/split-src.ts <chapterId>` で原文を機械分割
   2. サブエージェントに対応付けを作らせる。読ませるのは sentences.json と章JSON。
      出力は `source/alignments/` に `{"pNNN": [{"s": [文番号...], "ja": "断片"}]}` 形式
      （**原文テキストを出力させない**。ja 断片の連結は元の ja と完全一致が条件）
   3. `npx tsx tools/align-segments.ts <chapterId> <alignment.json>` で検証・反映。
      失敗した段落だけ再実行させる
7. 所要時間と段落数を報告する（M3 の見積もりに使う）。コミットするかはユーザーに確認

## 複数章の一括翻訳（サブエージェント並行）

章ごとに独立したエージェントに任せると、一人称・音写の判断が章単位で割れる
（罪と罰の実測: 41章の並行翻訳で一人称425箇所・固有名詞75箇所のゆれが発生し、事後修正になった）。
一括実行では以下の順序を必ず守る:

1. **最初の1章を先に完成させる。** そこで決めた各人物の一人称・口調を style-guide.json の
   `people.*.firstPerson` に、脇役・地名の音写を `names`（表記→原語）に書き切る。
   音写の原則（例: 露語はアクセント音節に長音、в はヴ系）も `global.rules` に明文化する
2. 残りの章をファンアウトする。プロンプトには必ず style-guide / people.json を読ませる
3. 各エージェントの完了報告から「新規話者・新規固有名詞」を回収し、
   **台帳に追記してから**次のバッチを投入する
4. 部・巻の区切りごとに `npx tsx tools/check-consistency.ts <workId>` を実行し、
   WARN をその場で解消する（全巻完了後にまとめて直すより安い）

## 比較モード: /translate compare <chapterId> [--limit N]（既定 3段落）

1. 未翻訳の先頭 N 段落を対象にする
2. `sonnet` と `opus` のサブエージェントを**並行**起動（1メッセージで2つ launch）。
   出力先はそれぞれ `source/experiments/<chapterId>.<model>.ja.json`
3. 両方の完了後、段落ごとに「原文の要点 → sonnet訳 → opus訳」を並べて提示し、
   (a) 原文への忠実さ（訳し落とし・付け足し） (b) スタイルガイド遵守（常体、伏字、
   音写、冗長さの保存） (c) 文体の質 の3観点で所見を述べる
4. 双方に `check-alignment` はかけられない（canonical にマージ前のため）ので、
   数量・否定の目視確認を所見に含める
5. **どちらを採用するかはユーザーが決める。** 採用決定後に merge-translation.ts で
   `--by claude-sonnet-5` 等のラベル付きでマージする

## サブエージェント指示テンプレ

Agent ツールで `model` を指定し、以下を埋めて `prompt` に渡す（原文をプロンプトに貼らないこと）:

```
あなたは<著者>『<作品名>』の翻訳者。パブリックドメインの原文から現代日本語への新訳を作る。

まず以下のファイルを読むこと（すべてリポジトリルートからの相対パス）:
- src/data/works/<workId>/style-guide.json … 訳文スタイルガイド。全ルールに従う。
  特に people.*.firstPerson（人物ごとの一人称・口調。漢字/かなの区別まで従う）と
  names（脇役・地名の音写台帳。この表記以外を使わない）
- src/data/works/<workId>/people.json … 主要人物の表記一覧。この表記以外を使わない
- source/paragraphs/<chapterId>.src.json … 原文。段落 <開始ID>〜<終了ID> を訳す
- src/content/chapters/<chapterId>.json … 既訳。直前3段落（<ID列>）の訳文を文体の
  文脈として使う（訳し直さない）

絶対条件:
- 既存の日本語訳を参照・流用しない。原文からのみ訳す
- 段落1対1。訳し落とし・要約・平易化をしない。冗長さは原文のまま
- 訳文に注釈マークアップや訳注を入れない。訳文のみ
- 応答にも出力ファイルにも原文（ロシア語等）を転記しない
- 台帳（firstPerson / people.json / names）に無い話者・固有名詞は自分で決めてよいが、
  最後の報告で必ず申告する

出力: <出力先パス> に {"pNNN": "訳文", ...} 形式のJSONを書く（Write ツール使用）。
最後に次の2点だけを報告する:
1. 訳した段落数と、訳出で迷った点（3行以内）
2. 「新規:」として、台帳に無かった話者の一人称・口調と、新出の固有名詞の採用表記の一覧
   （原語→カタカナ表記。無ければ「新規なし」と書く）
```

## モデルの目安

- `opus`（Claude Opus 5）… 既定。品質重視
- `sonnet`（Claude Sonnet 5）… 速い・安い。品質が十分なら41章の主力候補
- `fable`（Fable 5）… 最高性能帯。比較のベンチマーク用
- 比較結果と採用判断は `docs/` かコミットメッセージに記録し、`translatedBy` で追跡する
