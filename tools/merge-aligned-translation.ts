/**
 * 「翻訳＋文アラインメント一体型」の出力を検証して章JSONを生成・更新する。LLMは呼ばない。
 * 1章＝1エージェントで訳させるとき（/translate の一括モード）の受け口。
 *
 * 入力JSON（LLMが生成。原文テキストは含まない）:
 *   { "p001": [ { "s": [1], "ja": "訳文断片" }, { "s": [2,3], "ja": "..." } ], ... }
 *   - 各段落の ja 断片を順に連結したものが、その段落の訳文全体になる
 *   - s は対応する原文の文番号（split-src の番号、1始まり）
 *
 * 検証: s の連結が 1..N とちょうど一致しない段落は反映しない（exit 1 で列挙）
 * 保護: 既存の checked / reviewed 段落は上書きしない
 *
 * 使い方: npx tsx tools/merge-aligned-translation.ts <chapterId> <aligned.json> [--by <label>]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const [chapterId, alignedPath] = args.filter((a) => !a.startsWith('--'));
const byIdx = args.indexOf('--by');
const by = byIdx >= 0 ? args[byIdx + 1] : undefined;

if (!chapterId || !alignedPath) {
  console.error(
    'usage: tsx tools/merge-aligned-translation.ts <chapterId> <aligned.json> [--by <label>]',
  );
  process.exit(1);
}

const skeleton = JSON.parse(
  readFileSync(join('source', 'paragraphs', `${chapterId}.src.json`), 'utf-8'),
);

// 分かち書きしない言語（中国語・日本語）は、文を空白で継ぐと原文にない空きが入る。
// segments[].src の連結が原文と一致する不変条件（content.config.ts）にも関わる。
const CJK_LANGS = new Set(['zh', 'ja']);
const catalog = JSON.parse(readFileSync(join('src', 'data', 'works.json'), 'utf-8')) as Record<
  string,
  { sourceLang: string }
>;
const srcJoin = CJK_LANGS.has(catalog[skeleton.workId]?.sourceLang) ? '' : ' ';
const sentences: Record<string, string[]> = JSON.parse(
  readFileSync(join('source', 'paragraphs', `${chapterId}.sentences.json`), 'utf-8'),
);
const aligned: Record<string, { s: number[]; ja: string }[]> = JSON.parse(
  readFileSync(alignedPath, 'utf-8'),
);

const chapterPath = join('src', 'content', 'chapters', `${chapterId}.json`);
const existing: Record<string, any> = {};
if (existsSync(chapterPath)) {
  const current = JSON.parse(readFileSync(chapterPath, 'utf-8'));
  for (const p of current.paragraphs) existing[p.id] = p;
}

let added = 0;
let kept = 0;
const failed: string[] = [];

const paragraphs = skeleton.paragraphs.flatMap((p: any) => {
  const prior = existing[p.id];
  if (prior && prior.status !== 'draft') {
    kept += 1;
    return [prior];
  }

  const segs = aligned[p.id];
  if (!segs) {
    if (prior?.ja) {
      kept += 1;
      return [prior];
    }
    failed.push(`${p.id}: 訳が入力に含まれていない`);
    return [];
  }

  const sents = sentences[p.id] ?? [];
  const indices = segs.flatMap((seg) => seg.s);
  const expected = Array.from({ length: sents.length }, (_, i) => i + 1);
  if (JSON.stringify(indices) !== JSON.stringify(expected)) {
    failed.push(`${p.id}: 文番号の並びが 1..${sents.length} と一致しない（[${indices.join(',')}]）`);
    if (prior?.ja) {
      kept += 1;
      return [prior];
    }
    return [];
  }
  if (segs.some((seg) => !seg.ja || seg.ja.trim().length === 0)) {
    failed.push(`${p.id}: 空の ja 断片がある`);
    return prior?.ja ? [prior] : [];
  }

  added += 1;
  const out: any = {
    id: p.id,
    src: p.src,
    ja: segs.map((seg) => seg.ja).join(''),
    status: 'draft',
  };
  if (p.em) out.em = true;
  if (by) out.translatedBy = by;
  out.segments = segs.map((seg) => ({
    src: seg.s.map((n) => sents[n - 1]).join(srcJoin),
    ja: seg.ja,
  }));
  return [out];
});

const chapter = {
  workId: skeleton.workId,
  chapterLabel: skeleton.chapterLabel,
  order: skeleton.order,
  sourceUrl: skeleton.sourceUrl,
  sourceRevId: skeleton.sourceRevId,
  paragraphs,
};
writeFileSync(chapterPath, JSON.stringify(chapter, null, 2) + '\n', 'utf-8');

console.log(
  `${chapterPath}: 反映 ${added} / 保持 ${kept} / 計 ${paragraphs.length}/${skeleton.paragraphs.length} 段落`,
);
if (failed.length > 0) {
  console.log(`\n失敗 ${failed.length} 件（該当段落の再生成が必要）:`);
  for (const f of failed) console.log(`- ${f}`);
  process.exitCode = 1;
}
