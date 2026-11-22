/**
 * 表示上の改段（segments[].pb）を検証して章JSONに適用する。LLMは呼ばない。
 * 原文の1段落が長い版（古文など）を、段落の1対1を崩さずに読める長さに区切るための表示指定。
 * 訳文の文字列には触れないので、注釈を当てたあとでも適用できる。
 * merge-aligned-translation / align-segments は segments を作り直して pb を消すので、そのあとは
 * source/breaks/<chapterId>.json から適用し直す。
 *
 * 入力JSON: { "p036": [4, 9, 15], ... }
 *   - 数字は改段を入れる断片の番号（export-ja.ts --segments の [n] と同じ0始まり）。その断片の前で改段する
 *   - 列挙した段落は pb を付け直す（空配列なら改段をすべて外す）。列挙しない段落は触らない
 *
 * 使い方: npx tsx tools/apply-breaks.ts <chapterId> <breaks.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [chapterId, breaksPath] = process.argv.slice(2);
if (!chapterId || !breaksPath) {
  console.error('usage: tsx tools/apply-breaks.ts <chapterId> <breaks.json>');
  process.exit(1);
}

const chapterPath = join('src', 'content', 'chapters', `${chapterId}.json`);
const chapter = JSON.parse(readFileSync(chapterPath, 'utf-8'));
const breaks: Record<string, number[]> = JSON.parse(readFileSync(breaksPath, 'utf-8'));

const errors: string[] = [];
let applied = 0;
for (const [pid, indices] of Object.entries(breaks)) {
  const p = chapter.paragraphs.find((x: { id: string }) => x.id === pid);
  if (!p) {
    errors.push(`${pid}: 章に無い段落`);
    continue;
  }
  if (!p.segments) {
    errors.push(`${pid}: segments が無い段落には改段を入れられない`);
    continue;
  }
  const bad = indices.filter((i) => !Number.isInteger(i) || i < 1 || i >= p.segments.length);
  if (bad.length > 0) {
    errors.push(`${pid}: 断片番号 ${bad.join(', ')} は範囲外（1〜${p.segments.length - 1}）`);
    continue;
  }
  p.segments.forEach((seg: { pb?: true }, i: number) => {
    if (indices.includes(i)) seg.pb = true;
    else delete seg.pb;
  });
  applied += indices.length;
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}
writeFileSync(chapterPath, JSON.stringify(chapter, null, 2) + '\n', 'utf-8');
console.log(`${chapterPath}: 改段 ${applied} 箇所（${Object.keys(breaks).length} 段落）`);
