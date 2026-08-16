# CLAUDE.md

パブリックドメイン古典を「新訳＋読解支援レイヤー（人物・語注注釈）」付きで読ませる静的サイト。
**中心価値は訳文そのものではなく読解支援レイヤー**。UIや仕様の判断で迷ったらこの一文に戻る（docs/SPEC.md 冒頭）。原文そのものの難しさは解かない＝本文の平易化はしない。

- 公開: https://tmokmss.github.io/easy-books/ （GitHub リポジトリは `tmokmss/easy-books`、Astro の `base` は `/easy-books`）
- 仕様の正: `docs/SPEC.md`（元指示書からの変更点も記載）。パイプラインの手順書: `README.md`

## 絶対に守る制約

1. **原文（ロシア語等の書籍本文）を長文のままモデル出力に書き出さない。** API の出力フィルタが「書籍長文の逐語再現」を検知して 400 (Output blocked by content filtering policy) でブロックする。PD かどうかは関係ない。原文は curl でファイルに直接落とし、tools/ のスクリプトで機械処理する。サブエージェントには**ファイルパスと段落ID・文番号だけ**を渡し、本文をプロンプトや出力に貼らない
2. 既存の日本語訳（米川・工藤・江川ほか）を参照・流用しない。原文からのみ訳す
3. 翻訳・アラインメントは Claude Code セッション内で行う（`/translate` スキル。モデル切替はサブエージェントの `model` オーバーライド）。ビルドに LLM を入れない。`tools/translate.ts` は API キーでの無人バッチ用の別経路で、通常は使わない
4. `status: checked / reviewed` の段落を上書きしない（マージツールが機械的に保護する）。新しい訳文の status は必ず `draft`。人間の照合なしに昇格させない
5. 段落は原文と1対1。訳し落とし・要約・平易化禁止。意図的な繰り返し・冗長さも原文のまま保つ
6. 公開リポジトリなので個人情報をコミットしない（ユーザーのメールアドレス等。git author は `tmokmss@users.noreply.github.com`）

## コマンド

```bash
npm run dev            # 開発サーバ
npm run build          # ビルド＝検証。zod がマークアップ参照・segments 不変条件まで検査する
npx tsx tools/check-alignment.ts <chapterId>   # 数詞・否定・文数の機械ふるい（誤検知あり）
npx tsx tools/check-consistency.ts <workId>    # 作品全体の固有名詞・一人称ゆれの機械ふるい
npx tsx tools/merge-aligned-translation.ts <chapterId> <aligned.json> --by <model>  # 翻訳+対応の検証つきマージ
npx tsx tools/split-src.ts <chapterId>         # 原文の文分割 → source/paragraphs/*.sentences.json
npx tsx tools/merge-outline.ts <chapterId> source/outlines/<chapterId>.json  # 階層ズームの要約マージ（検証つき）
npx tsx tools/check-summaries.ts <workId> [--promote]  # 要約のネタバレ・整合ふるい → machine-checked 昇格
```

## データモデルの要点

- 章: `src/content/chapters/<chapterId>.json`（chapterId 例: `crime-01-02`）。段落 = `{id, src, ja, status, em?, translatedBy?, segments?}`
- **segments 不変条件**（対訳表示用）: `segments[].ja` を順に連結すると段落の `ja` と完全一致、`src` 連結は正規化後の原文と一致。merge ツールと content.config の両方で検証される
- インラインマークアップは3種のみ: `{{p:id|表示}}`（人物・固有名）/ `{{r:id|表示}}`(代名詞参照・語注なし) / `{{n:id|表示}}`（語注）。未知 ID や不正形式はビルドが落ちる。翻訳段階では付けない（レビュー工程の仕事）
- 作品別データ: `src/data/works.json`（カタログ）＋ `src/data/works/<workId>/{people,glossary,style-guide}.json`。人物の音写は people.json の表記に完全一致させる。訳語は style-guide.json の terms に従う（例: рубль→ルーブル、распивочная→安酒場）
- 原文・中間生成物は `source/` にコミット（wikisource API 応答、段落スケルトン、文リスト、アラインメント）
- 階層ズーム・リーダー（構造ビュー `/works/<workId>/`・stretchtext・既読管理）: `src/content/outlines/<chapterId>.json`（節区切り＋節/章/段落要約）と `src/content/overviews/<workId>.json`（作品・部要約）。章データを段落IDで参照するだけの別レイヤーで、章 JSON には触れない。要約 status は draft→machine-checked→human-reviewed→verified、fiction はネタバレ封じ込め（coversUpTo）あり。生成手順は `source/outlines/INSTRUCTIONS.md`、仕様は `docs/ZOOM.md`

## ワークフロー

- 新しい作品の追加: `/add-work <書名>`（PD 確認→原文取得→カタログ・台帳→スケルトンまで）
- 章の翻訳: `/translate <chapterId> [sonnet|opus|fable]`。実績のある方式は「1章=1エージェント、翻訳と文アラインメントを一体で出力」: `{"pNNN": [{"s": [文番号], "ja": "断片"}]}` を `source/alignments/` に書き、エージェント自身が merge-aligned-translation.ts を exit 0 まで通す（41章連続で検証一発通過の実績）
- **一括翻訳の表記統一**: 最初の1章で style-guide.json の `people.*.firstPerson`（一人称・口調）と `names`（脇役・地名の音写台帳）を確定→残りをファンアウト→エージェントの「新規」報告を台帳に還流→部ごとに check-consistency で検査。この順序を崩すと章単位で表記が割れる（罪と罰では事後修正500箇所になった）
- **台帳に還流しても割れるもの**（われらの実測。波ごとに機械で洗うこと）:
  ①二人称（`ты`→おまえ／きみ／君）②同義語の訳し分け（`эллинг`→船台／格納庫／ドック）
  ③章をまたぐ自己引用（記録二十一が記録二十を引用する箇所）④ナンバー記号の前後の空白
  検査は「章ごとの訳文を横断して同義候補の出現章を数える」だけで足りる。
  台帳の訳語が実際に使われているかの照合（原文に語がある段落で訳語が出ているか）も有効だが、
  語幹照合なので複合語は全語の語幹がそろった段落だけを対象にしないと誤検知だらけになる
- 章の要約（階層ズーム）: `/outline <chapterId> [model]`、作品一括は `/outline <workId> --all`（節区切り→段落/節/章/部/作品要約のボトムアップ生成→check-summaries→machine-checked 昇格まで。1章=1エージェント方式）
- 大量並行時は Codex CLI レーンも併用可: `codex exec -m gpt-5.6-sol -c model_reasoning_effort="high" -s workspace-write --ephemeral - < <promptfile>`（雛形は罪と罰の運用記録 issue 参照）
- デプロイ: main に push すると GitHub Actions（withastro/action, **node-version: 22 必須** — Astro 7 は Node >=22.12）

## 現在の状態と次の作業（2026-08-09 時点）

- 『罪と罰』(workId: `crime`) 全41章・3,765段落の草稿＋文対訳が完了、全段落 `draft`
- 作業統計・学び・レビュー引き継ぎは **issue #1**（tmokmss/easy-books）に記録済み
- 次工程は人間レビュー: draft→checked→reviewed 昇格、レビューノート3件の解消（ラズミーヒンの一人称ゆれ 02-02 vs 02-03以降 / ルージンの手紙の引用一致 03-02 vs 03-03 / レベジャートニコフの父称ゆれ）、注釈拡充と glossary の `verified: true` 化
- 短編2本を追加（2026-08-16）: プーシキン『駅長』(`stationmaster`, ru, 37段落) と
  カフカ『判決』(`urteil`, de, 65段落)。訳文＋文対訳＋アウトライン（machine-checked）まで完了、全段落 `draft`。
  注釈（`{{p:}}`/`{{n:}}`）は未着手で glossary は空。**このサイトの中心価値は読解支援レイヤーなので、
  短編の次工程は注釈付けと glossary の作成**（駅長なら十四等官・駅馬使用証・放蕩息子の版画、判決ならキエフの騒乱）
- ザミャーチン『われら』(`we`, ru) を追加・全訳（2026-08-16）: PD確認（没1937 → 日本は1988年から、露は既に満了、
  戦時加算はソ連に適用なし）→ 全40記録・1,544段落・日本語151,309字の草稿＋文対訳（4,231セグメント）が完了、全段落 `draft`。
  translatedBy の内訳は claude-opus-5 が910段落・gpt-5.6-sol が634段落（Codex レーン併用）。
  台帳は terms 245語・names 25語・rules 21項目まで育てた。
  階層ズームの要約レイヤーも全40章ぶん完了（節198・段落要約632・章要約40、すべて machine-checked、FAIL 0）。
  部を持たない作品なので `overviews/we.json` は置いていない（構造ビューは章のフラット表示）。
  次工程は人間レビュー（draft→checked）と注釈・glossary
- 作品の長さの見積もり: 露語1語 ≒ 日本語3.29字（罪と罰の実測 176,000語→580,000字）、文庫1ページ ≒ 500字。
  文庫20ページ ≒ 日本語1万字 ≒ 露語3,000語。新作品の候補を選ぶときの物差しに使う

## 落とし穴

- `astro preview` のデーモンが残ると古い設定（旧 base）を配信し続ける → `npx astro preview stop` してから再起動
- Wikisource API はレート制限が厳しい。リクエスト間 5 秒＋失敗時 60 秒バックオフ
- check-alignment の既知の誤検知: 複合数詞（семьсот тридцать 等）、日本語の自然な文分割による文数乖離（大半は良性）
- check-alignment の数詞・否定辞書は `SRC_LANGS`（ru / de）で `sourceLang` ごとに切り替える。新言語はここに1エントリ足す。
  独語で `ein/eine` を数詞に入れると不定冠詞と同形で全段落が誤検知になる（入れないこと）
- Wikisource の HTML には本文以外が混ざる: ru の PD ライセンス文（`<div class="text">` の外側）、
  de 等の校正版のページ番号 `[59]`（`class="PageNumber"` の span）、朗読音声プレイヤー（`<audio>`）。
  wikisource-to-paragraphs.ts で除去済みだが、新しい版元では出力段落の先頭・末尾を必ず目視すること
- 詩句・題辞の出典行が `<td>` に置かれていて `<p>` 走査から漏れることがある（駅長のヴャーゼムスキー）。段落数が原文と合うか確認する
- 章の見出しブロック（題辞・概要）が `<center>` に置かれる版がある（われらの Конспект 行）。
  `--lead-heading <正規表現>` で冒頭の `<center>` 群を1段落にまとめ、章見出しそのもの（chapterLabel と重複）を落とす。
  本文途中の `<center>`（場面区切り）は通常の段落として拾われる
- `<math>` は MathML＋フォールバック画像に展開される。素朴にタグを剥がすと TeX 注釈（`{\displaystyle …}`）が
  本文に残る。wikisource-to-paragraphs.ts が `alttext` から平文に畳む（`\sqrt{-1}` → `√−1`）。
  畳めない式は TeX のまま残して警告を出すので、警告が出たら手で直すこと
