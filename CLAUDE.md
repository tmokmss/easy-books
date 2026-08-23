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
npx tsx tools/apply-annotation.ts <chapterId> source/annotations/<chapterId>.markup.json --glossary <fragment.json>  # 注釈の検証つき適用
python3 tools/merge-glossary-fragments.py <workId>     # source/annotations/<workId>-*.glossary.json → works の glossary.json
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
- デプロイ: main に push すると GitHub Actions（withastro/action, **node-version: 24** — Astro 7 は Node >=22.12 が必要）
- CI: 全ブランチの push で `.github/workflows/ci.yml` が `npm ci` → `npm run build`（＝スキーマ検証）を回す

## 現在の状態と次の作業（2026-08-09 時点）

- 『罪と罰』(workId: `crime`) 全41章・3,765段落の草稿＋文対訳が完了、全段落 `draft`
- 作業統計・学び・レビュー引き継ぎは **issue #1**（tmokmss/easy-books）に記録済み
- 次工程は人間レビュー: draft→checked→reviewed 昇格、レビューノート3件の解消（ラズミーヒンの一人称ゆれ 02-02 vs 02-03以降 / ルージンの手紙の引用一致 03-02 vs 03-03 / レベジャートニコフの父称ゆれ）、注釈拡充と glossary の `verified: true` 化
- 短編2本を追加（2026-08-16）: プーシキン『駅長』(`stationmaster`, ru, 37段落) と
  カフカ『判決』(`urteil`, de, 65段落)。訳文＋文対訳＋アウトライン（machine-checked）＋注釈レイヤーまで完了、全段落 `draft`。
  注釈は 駅長 42個（語注35・人物6・参照1）/ 判決 28個（語注23・人物4・参照1）、glossary は 35件 / 23件で
  すべて `verified: false`。**次工程は glossary の出典確認と `verified: true` 化**
  （`sources` に「要確認」と書いた項目＝駅長のデムート旅館・〈悲しむすべての人の喜び〉・騎兵大尉の官等・
  苦情帳、判決のキエフの騒乱・父の従軍年代 から潰す）と、draft→checked の人間レビュー
- ザミャーチン『われら』(`we`, ru) を追加・全訳（2026-08-16）: PD確認（没1937 → 日本は1988年から、露は既に満了、
  戦時加算はソ連に適用なし）→ 全40記録・1,544段落・日本語151,309字の草稿＋文対訳（4,231セグメント）が完了、全段落 `draft`。
  translatedBy の内訳は claude-opus-5 が910段落・gpt-5.6-sol が634段落（Codex レーン併用）。
  台帳は terms 245語・names 25語・rules 21項目まで育てた。
  階層ズームの要約レイヤーも全40章ぶん完了（節198・段落要約632・章要約40、すべて machine-checked、FAIL 0）。
  部を持たない作品なので `overviews/we.json` は置いていない（構造ビューは章のフラット表示）。
  読解支援レイヤーも全40章ぶん完了（人物205・参照139・語注387の計731、glossary 128項目、全 `verified: false`）。
  次工程は人間レビュー: 訳文の draft→checked 昇格と、glossary の裏取り＋ `verified: true` 化
- 魯迅『孔乙己』(`kongyiji`, zh) を追加（2026-08-22）。**初の中国語作品**。PD確認（没1936 → 日本は1987年から。
  中国は戦時加算の対象国ではないので加算なし。初出1919年なので米国もPD）→ 全14段落・日本語4,583字の
  草稿＋文対訳（92セグメント）、アウトライン（節3・段落要約11、machine-checked、FAIL 0）、
  読解支援レイヤー（人物5・語注29の計34、glossary 28項目、全 `verified: false`）まで完了。全段落 `draft`。
  次工程は glossary の裏取り＋`verified: true` 化（`sources` に「要確認」と書いた8項目＝
  大錢と小錢の区別／咸亨酒店と魯迅の一族／薦頭の慣行／手本文句の本文（丘乙己 説）／弔着打の私刑／
  生員の法的特権／服辯の書式／「回字四樣寫法」の具体）と、draft→checked の人間レビュー
- 魯迅『狂人日記』(`kuangren`, zh) を追加（2026-08-23）。PDは孔乙己と同じ（没1936・戦時加算なし・初出1918年）。
  全78段落・原文4,802字 → 日本語8,289字（文庫換算 約17ページ）、文対訳193セグメント、全段落 `draft`。
  アウトライン（節14・段落要約33、machine-checked、FAIL 0）、
  読解支援レイヤー（人物7・語注34の計41、glossary 34項目、全 `verified: false`）。
  **序が文言文・日記本文が白話**という二重構造が作品の仕掛けなので、訳文も
  文語体＋一人称「余」／口語＋一人称「おれ」で書き分けた（style-guide の rules 3 番目）。
  原文の節番号 一〜十三 は `<h2>` なので段落にせず、outlines の節 label に「一　三十何年ぶりの月」の形で載せた。
  次工程は glossary の裏取り＋`verified: true` 化（要確認9件＝候補制度／「迫害狂」の語源／女性話者の「老子」／
  心肝を食う俗信／『本草綱目』人部と李時珍の評言／清末の hyena 訳語／魯迅と『天演論』／
  徐錫麟の心肝伝承／割股の記録）と、draft→checked の人間レビュー
- 作品の長さの見積もり: 露語1語 ≒ 日本語3.29字（罪と罰の実測 176,000語→580,000字）、
  中国語1字 ≒ 日本語1.73〜1.76字（孔乙己 2,611→4,583字 / 狂人日記 4,802→8,289字）、文庫1ページ ≒ 500字。
  文庫20ページ ≒ 日本語1万字 ≒ 露語3,000語 ≒ 中国語5,800字。新作品の候補を選ぶときの物差しに使う

## 落とし穴

- `astro preview` のデーモンが残ると古い設定（旧 base）を配信し続ける → `npx astro preview stop` してから再起動
- Wikisource API はレート制限が厳しい。リクエスト間 5 秒＋失敗時 60 秒バックオフ
- check-alignment の既知の誤検知: 複合数詞（семьсот тридцать 等）、日本語の自然な文分割による文数乖離（大半は良性）
- check-alignment の数詞・否定辞書は `SRC_LANGS`（ru / de / zh）で `sourceLang` ごとに切り替える。新言語はここに1エントリ足す。
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
- `{{p:}}` のインライン・グロス〔〕が出るのは「表示文字が people.json の `short` とも `name` とも違うとき」だけ。
  父称形を `name` に入れている人物（駅長のドゥーニャ＝`name` が「アヴドーチヤ・サムソノヴナ」）は、
  本文でその形が出てもグロスが出ない。結びつけはタップの人物カード（作中の呼ばれ方の一覧）に任せる
- `merge-glossary-fragments.py` は必ず `<workId>` で対象を絞る。全フラグメントを無条件に拾うと、
  別の作品の語注が混ざり込む（章IDが `<workId>-…` なのでファイル名の接頭辞が作品の切り分けになる）
- **作品内の節番号を `<h2>` に置く版がある**（狂人日記の 一〜十三）。wikisource-to-paragraphs は見出しを
  段落にせず、何を落としたかを警告で出す。節構造が要るなら章JSONに見出し段落を作らず、
  `source/outlines/<chapterId>.json` の節 label に「一　三十何年ぶりの月」の形で番号ごと載せること
  （リーダーは節 label を折りたたみ見出しとして出すので、原文の区切りがそのまま再現される）

### 新しい言語を足すとき（zh 対応で触った箇所の一覧）

`sourceLang` を1つ増やすと、少なくとも次の6ファイルが関わる。ru/de しか無かった前提が各所に埋まっている。

1. `tools/wikisource-to-paragraphs.ts` — 本文コンテナ。zh は校正版（ProofreadPage）なので
   `<div class="prp-pages-output">`。しかも **PD テンプレートが本文の「後ろ」**（`licenseContainer`）に来るので、
   前だけ切ると本文に混ざる。両端を切ること。
   また本文ブロックは `<p>` / `<center>` だけでなく **`<dd>`** もある（文語の序など一段下げた引用ブロック。
   狂人日記の序がこれで、拾わないと丸ごと落ちる）
2. `tools/split-src.ts` — 分かち書きしない言語は空白を手掛かりにできない。zh/ja は句点・感嘆符・疑問符で切り、
   **括弧の内側では切らない**（会話文が途中で割れる）。閉じ括弧は直前が文末記号なら文に含める
3. `tools/merge-aligned-translation.ts` + `src/content.config.ts` — `segments[].src` の連結は
   zh/ja では空白を挟まない。連結不変条件の比較は空白を落として行う（言語ごとに空白の意味が違うため）
4. `tools/check-alignment.ts` — `SRC_LANGS` に1エントリ。中国語は
   `noWordBoundary`（「他不来」の不は前後が漢字なので語境界を要求すると否定を1つも拾えない）、
   `cjkNumerals` + **`numeralUnits`**（量詞で錨を打たないと「一樣」「不十分」「一定」で誤検知だらけになる。
   単位で絞ると金額・年月だけが残る）、`sentenceEnd` に `；` を入れる（中国語の分号は日本語では文に割れる）
5. `src/lib/works.ts` の `LANG_LABELS`、`src/lib/types.ts` の `sourceLangTag`（字体まで指定したいとき。
   繁体字なら `zh-Hant`。原文は繁体字のまま、訳文だけ日本語の新字体にする）
6. `src/components/Reader.astro` — 対訳セグメントの区切り（zh/ja は空白を入れない）と、
   `:lang(zh)` の明朝スタック（既定の欧文セリフ先頭のままだと日本語明朝に落ちて字形が変わる）

中国語作品の訳し方は `src/data/works/kongyiji/style-guide.json` が雛形。要点は
「制度・身分・科挙・器物・食物の名は漢字のまま置いて語注に回す／動作・状態の描写語は日本語に開く／
固有名詞はカタカナ音写せず漢字のまま日本語音で読ませる／文語調の台詞は漢文訓読調で受ける」
