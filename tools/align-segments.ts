/**
 * 文単位の対訳アラインメントを検証して章JSONへ反映する。
 *
 * 入力のアラインメントJSON（LLMが生成。原文テキストは含まない）:
 *   { "p001": [ { "s": [1], "ja": "訳文の断片" }, { "s": [2,3], "ja": "..." } ], ... }
 *   - s: そのセグメントに対応する原文の文番号（split-src の番号、1始まり）
 *   - ja: 段落の訳文を先頭から順に切り出した断片
 *
 * 検証（どちらか失敗した段落は反映しない）:
 *   - 各段落で s を連結すると 1..N がちょうど1回ずつ昇順に現れる
 *   - ja 断片を連結すると段落の ja に「完全一致」する（1文字も変えられない）
 *
 * 反映: paragraph.segments = [{ src, ja }]（src は文番号から機械合成。LLM出力を使わない）
 *
 * 使い方: npx tsx tools/align-segments.ts <chapterId> <alignment.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [chapterId, alignPath] = process.argv.slice(2);
if (!chapterId || !alignPath) {
  console.error('usage: tsx tools/align-segments.ts <chapterId> <alignment.json>');
  process.exit(1);
}

const chapterPath = join('src', 'content', 'chapters', `${chapterId}.json`);
const chapter = JSON.parse(readFileSync(chapterPath, 'utf-8'));
const sentences: Record<string, string[]> = JSON.parse(
  readFileSync(join('source', 'paragraphs', `${chapterId}.sentences.json`), 'utf-8'),
);
const alignment: Record<string, { s: number[]; ja: string }[]> = JSON.parse(
  readFileSync(alignPath, 'utf-8'),
);

let ok = 0;
const failed: string[] = [];

for (const [pid, segs] of Object.entries(alignment)) {
  const para = chapter.paragraphs.find((p: any) => p.id === pid);
  const sents = sentences[pid];
  if (!para || !sents) {
    failed.push(`${pid}: 段落または文リストが存在しない`);
    continue;
  }

  const indices = segs.flatMap((seg) => seg.s);
  const expected = Array.from({ length: sents.length }, (_, i) => i + 1);
  if (JSON.stringify(indices) !== JSON.stringify(expected)) {
    failed.push(`${pid}: 文番号の並びが 1..${sents.length} と一致しない（[${indices.join(',')}]）`);
    continue;
  }

  const joinedJa = segs.map((seg) => seg.ja).join('');
  if (joinedJa !== para.ja) {
    // どこで食い違ったか分かるよう、先頭からの一致長を出す
    let i = 0;
    while (i < Math.min(joinedJa.length, para.ja.length) && joinedJa[i] === para.ja[i]) i++;
    failed.push(
      `${pid}: ja断片の連結が原文と不一致（${i}文字目から。連結=${joinedJa.length}字/原文=${para.ja.length}字）`,
    );
    continue;
  }

  para.segments = segs.map((seg) => ({
    src: seg.s.map((n) => sents[n - 1]).join(' '),
    ja: seg.ja,
  }));
  ok += 1;
}

writeFileSync(chapterPath, JSON.stringify(chapter, null, 2) + '\n', 'utf-8');
console.log(`${chapterPath}: ${ok} 段落にセグメント反映`);
if (failed.length > 0) {
  console.log(`\n失敗 ${failed.length} 件（再実行が必要）:`);
  for (const f of failed) console.log(`- ${f}`);
  process.exitCode = 1;
}
