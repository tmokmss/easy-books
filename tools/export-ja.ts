/**
 * 章の ja 本文だけをマークアップ抜きで書き出す（要約エージェントへの入力用）。
 * 章JSONは src・segments 込みで大きいので、要約作業に必要な最小限に絞る。
 *
 * 使い方: npx tsx tools/export-ja.ts <chapterId>|--all   → source/outlines/ja/<chapterId>.txt
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripMarkup } from '../src/lib/outline';

const [arg] = process.argv.slice(2);
if (!arg) {
  console.error('usage: tsx tools/export-ja.ts <chapterId>|--all');
  process.exit(1);
}

const chaptersDir = join('src', 'content', 'chapters');
const ids =
  arg === '--all'
    ? readdirSync(chaptersDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''))
    : [arg];

const outDir = join('source', 'outlines', 'ja');
mkdirSync(outDir, { recursive: true });

for (const chapterId of ids) {
  const chapter = JSON.parse(readFileSync(join(chaptersDir, `${chapterId}.json`), 'utf-8')) as {
    chapterLabel: string;
    paragraphs: { id: string; ja: string }[];
  };
  const lines = [`# ${chapterId} ${chapter.chapterLabel}（${chapter.paragraphs.length}段落）`, ''];
  for (const p of chapter.paragraphs) {
    const plain = stripMarkup(p.ja);
    lines.push(`## ${p.id}（${plain.length}字）`, plain, '');
  }
  const outPath = join(outDir, `${chapterId}.txt`);
  writeFileSync(outPath, lines.join('\n'));
  console.log(`${outPath}（${chapter.paragraphs.length}段落）`);
}
