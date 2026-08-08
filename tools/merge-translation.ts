/**
 * 訳文JSON（{"pNNN": "訳文"} 形式）を章JSONへ機械的にマージする。LLMは呼ばない。
 * Claude Code セッション内で訳した結果を反映する受け口（/translate スキルが使う）。
 *
 * 使い方:
 *   npx tsx tools/merge-translation.ts <chapterId> <ja.json> [--by <モデル名等のラベル>]
 *
 * ルール:
 *   - checked / reviewed の段落は絶対に上書きしない
 *   - ja.json に無い段落は既存の訳を保持。どちらにも無い段落は出力に含めない
 *   - 新規反映される段落は status: draft、--by があれば translatedBy を記録
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const [chapterId, jaPath] = args.filter((a) => !a.startsWith('--'));
const byIdx = args.indexOf('--by');
const by = byIdx >= 0 ? args[byIdx + 1] : undefined;

if (!chapterId || !jaPath) {
  console.error('usage: tsx tools/merge-translation.ts <chapterId> <ja.json> [--by <label>]');
  process.exit(1);
}

const skeleton = JSON.parse(
  readFileSync(join('source', 'paragraphs', `${chapterId}.src.json`), 'utf-8'),
);
const jaMap: Record<string, string> = JSON.parse(readFileSync(jaPath, 'utf-8'));
const chapterPath = join('src', 'content', 'chapters', `${chapterId}.json`);

const existing: Record<string, any> = {};
if (existsSync(chapterPath)) {
  const current = JSON.parse(readFileSync(chapterPath, 'utf-8'));
  for (const p of current.paragraphs) existing[p.id] = p;
}

const unknownIds = Object.keys(jaMap).filter(
  (id) => !skeleton.paragraphs.some((p: any) => p.id === id),
);
if (unknownIds.length > 0) {
  console.error(`スケルトンに存在しない段落ID: ${unknownIds.join(', ')}`);
  process.exit(1);
}

let added = 0;
let kept = 0;
let protectedCount = 0;

const paragraphs = skeleton.paragraphs.flatMap((p: any) => {
  const prior = existing[p.id];
  const incoming = jaMap[p.id]?.trim();

  // 人間確認済みは絶対に上書きしない
  if (prior && prior.status !== 'draft') {
    if (incoming) protectedCount += 1;
    kept += 1;
    return [prior];
  }
  if (incoming) {
    added += 1;
    const out: any = { id: p.id, src: p.src, ja: incoming, status: 'draft' };
    if (p.em) out.em = true;
    if (by) out.translatedBy = by;
    return [out];
  }
  if (prior?.ja) {
    kept += 1;
    return [prior];
  }
  return [];
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
  `${chapterPath}: 反映 ${added} 段落 / 保持 ${kept} 段落 / 計 ${paragraphs.length}/${skeleton.paragraphs.length}`,
);
if (protectedCount > 0) {
  console.log(`注意: checked/reviewed のため上書きしなかった段落が ${protectedCount} 件ある`);
}
