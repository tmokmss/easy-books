/**
 * 章の ja 本文だけをマークアップ抜きで書き出す（要約・注釈エージェントへの入力用）。
 * 章JSONは src・segments 込みで大きいので、作業に必要な最小限に絞る。
 * **原文（ロシア語等）を一切含まない**ので、エージェントに原文を扱わせずに済む。
 *
 * 使い方:
 *   npx tsx tools/export-ja.ts <chapterId>|--all              → source/outlines/ja/<chapterId>.txt
 *   npx tsx tools/export-ja.ts <chapterId>|--all --segments    → source/annotations/ja/<chapterId>.txt
 *
 * --segments はセグメント番号（0始まり）つきで出す。注釈の位置指定（marks.json の
 * {p, seg, text}）はこの番号を指すので、注釈エージェントにはこちらを渡す。
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripMarkup } from '../src/lib/outline';

const args = process.argv.slice(2);
const bySegment = args.includes('--segments');
const [arg] = args.filter((a) => !a.startsWith('--'));
if (!arg) {
  console.error('usage: tsx tools/export-ja.ts <chapterId>|--all [--segments]');
  process.exit(1);
}

const chaptersDir = join('src', 'content', 'chapters');
const ids =
  arg === '--all'
    ? readdirSync(chaptersDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''))
    : [arg];

const outDir = bySegment ? join('source', 'annotations', 'ja') : join('source', 'outlines', 'ja');
mkdirSync(outDir, { recursive: true });

for (const chapterId of ids) {
  const chapter = JSON.parse(readFileSync(join(chaptersDir, `${chapterId}.json`), 'utf-8')) as {
    chapterLabel: string;
    paragraphs: { id: string; ja: string; segments?: { ja: string }[] }[];
  };
  const lines = [`# ${chapterId} ${chapter.chapterLabel}（${chapter.paragraphs.length}段落）`, ''];
  for (const p of chapter.paragraphs) {
    if (bySegment) {
      const segs = p.segments?.length ? p.segments.map((s) => s.ja) : [p.ja];
      lines.push(`## ${p.id}（${segs.length}セグメント）`);
      segs.forEach((s, i) => lines.push(`[${i}] ${stripMarkup(s)}`));
      lines.push('');
    } else {
      const plain = stripMarkup(p.ja);
      lines.push(`## ${p.id}（${plain.length}字）`, plain, '');
    }
  }
  const outPath = join(outDir, `${chapterId}.txt`);
  writeFileSync(outPath, lines.join('\n'));
  console.log(`${outPath}（${chapter.paragraphs.length}段落）`);
}
