/**
 * 原文を文単位に機械分割し、番号付きで保存する。対訳アラインメントの入力になる。
 * 分割は決定的（LLM不使用）。多少の過剰・過少分割はアラインメント側で
 * 「1セグメント=複数文」にまとめられるので許容する。
 *
 * 使い方: npx tsx tools/split-src.ts <chapterId>
 * 出力:   source/paragraphs/<chapterId>.sentences.json  { "p001": ["文1", "文2", ...], ... }
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const chapterId = process.argv[2];
if (!chapterId) {
  console.error('usage: tsx tools/split-src.ts <chapterId>');
  process.exit(1);
}

const skeleton = JSON.parse(
  readFileSync(join('source', 'paragraphs', `${chapterId}.src.json`), 'utf-8'),
);

/**
 * 文末（. ! ? …）＋閉じ引用符の後で、次の文頭（大文字・ダッシュ・開き引用符）が
 * 続く位置で分割する。露語・欧文向けの簡易規則。
 */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…][»")»]*)\s+(?=[—«"(A-ZА-ЯЁ])/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const out: Record<string, string[]> = {};
let total = 0;
for (const p of skeleton.paragraphs) {
  out[p.id] = splitSentences(p.src);
  total += out[p.id].length;
}

const outPath = join('source', 'paragraphs', `${chapterId}.sentences.json`);
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf-8');
console.log(`${outPath}: ${skeleton.paragraphs.length} 段落 / ${total} 文`);
