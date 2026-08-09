/**
 * 部・作品要約（プレーンテキスト）を検証して src/content/overviews/<workId>.json に取り込む。
 * LLMは呼ばない。coversUpTo と status: draft はここで機械的に付ける。
 * 保護: human-reviewed / verified の要約は上書きしない。
 *
 * 入力: source/outlines/part-<partId>.txt（部ごと）、source/outlines/work-<workId>.txt（作品）
 *       存在するファイルだけ取り込む（無い部はスキップ）。
 *
 * 使い方: npx tsx tools/merge-overview.ts <workId>
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  validateWorkOverview,
  type Summary,
  type WorkOverview,
} from '../src/lib/outline';

const [workId] = process.argv.slice(2);
if (!workId) {
  console.error('usage: tsx tools/merge-overview.ts <workId>');
  process.exit(1);
}

const overviewPath = join('src', 'content', 'overviews', `${workId}.json`);
const overview = JSON.parse(readFileSync(overviewPath, 'utf-8')) as WorkOverview;

// 章の末尾段落ID（coversUpTo の計算に使う）
const chaptersDir = join('src', 'content', 'chapters');
const lastPidOf = new Map<string, string>();
const orderOf = new Map<string, number>();
for (const f of readdirSync(chaptersDir).filter((f) => f.endsWith('.json'))) {
  const data = JSON.parse(readFileSync(join(chaptersDir, f), 'utf-8'));
  if (data.workId !== workId) continue;
  const id = f.replace(/\.json$/, '');
  lastPidOf.set(id, data.paragraphs[data.paragraphs.length - 1].id);
  orderOf.set(id, data.order);
}

const protectedSummary = (s?: Summary) =>
  s && (s.status === 'human-reviewed' || s.status === 'verified');

const readText = (path: string): string | undefined =>
  existsSync(path) ? readFileSync(path, 'utf-8').trim().replace(/\s*\n\s*/g, '') : undefined;

let updated = 0;
for (const part of overview.parts) {
  const text = readText(join('source', 'outlines', `part-${part.id}.txt`));
  if (!text || protectedSummary(part.summary)) continue;
  const lastChapter = part.chapters[part.chapters.length - 1];
  part.summary = {
    text,
    status: 'draft',
    coversUpTo: `${lastChapter}#${lastPidOf.get(lastChapter)}`,
  };
  updated += 1;
}

const workText = readText(join('source', 'outlines', `work-${workId}.txt`));
if (workText && !protectedSummary(overview.summary)) {
  const lastChapter = [...orderOf.entries()].sort((a, b) => a[1] - b[1]).at(-1)![0];
  overview.summary = {
    text: workText,
    status: 'draft',
    coversUpTo: `${lastChapter}#${lastPidOf.get(lastChapter)}`,
  };
  updated += 1;
}

const chapters = [...orderOf.entries()]
  .sort((a, b) => a[1] - b[1])
  .map(([chapterId]) => ({ chapterId, lastParagraphId: lastPidOf.get(chapterId)! }));
const errors = validateWorkOverview(overview, chapters);
if (errors.length > 0) {
  for (const e of errors) console.error(`error: ${e}`);
  console.error(`\n${errors.length} 件のエラー。${overviewPath} は更新していない`);
  process.exit(1);
}

writeFileSync(overviewPath, JSON.stringify(overview, null, 2) + '\n');
console.log(`${overviewPath} を更新: 要約 ${updated} 件`);
