/**
 * FB2（構造化XML）を段落配列スケルトンに変換する。
 * FB2 を選ぶ理由は、部・章・段落・強調がタグで入っているため。
 * 特に <emphasis> は落とさずメタ情報（em フラグ)として残す。
 * ドストエフスキーが「あのこと」を強調している箇所は、注釈を当てる位置の目印になる。
 *
 * 使い方:
 *   npx tsx tools/fb2-to-paragraphs.ts <file.fb2> <workId> [chapterIdPrefix]
 * 例:
 *   npx tsx tools/fb2-to-paragraphs.ts source/prestuplenie.fb2 crime crime
 *
 * 出力: 葉セクション（= 章）ごとに source/paragraphs/<prefix>-<部>-<章>.src.json
 * ※ Wikisource 由来の原文には wikisource-to-paragraphs.ts を使う。出力形式は同一。
 */
import { XMLParser } from 'fast-xml-parser';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [fb2Path, workId, prefix] = process.argv.slice(2);
if (!fb2Path || !workId) {
  console.error('usage: tsx tools/fb2-to-paragraphs.ts <file.fb2> <workId> [chapterIdPrefix]');
  process.exit(1);
}
const chapterPrefix = prefix ?? workId;

const parser = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: true, // 段落内の強調位置を保つため、順序付きノードで読む
});
const doc = parser.parse(readFileSync(fb2Path, 'utf-8'));

type OrderedNode = Record<string, any>;

function findAll(nodes: OrderedNode[], name: string): OrderedNode[][] {
  // preserveOrder 形式のノード列から、指定タグの子ノード列を集める
  const found: OrderedNode[][] = [];
  for (const node of nodes) {
    for (const [key, value] of Object.entries(node)) {
      if (key === ':@' || key === '#text') continue;
      if (key === name) found.push(value as OrderedNode[]);
      else if (Array.isArray(value)) found.push(...findAll(value as OrderedNode[], name));
    }
  }
  return found;
}

function textOf(nodes: OrderedNode[]): { text: string; hasEmphasis: boolean } {
  let text = '';
  let hasEmphasis = false;
  for (const node of nodes) {
    for (const [key, value] of Object.entries(node)) {
      if (key === '#text') {
        text += String(value);
      } else if (key === ':@') {
        continue;
      } else {
        if (key === 'emphasis') hasEmphasis = true;
        const inner = textOf(value as OrderedNode[]);
        text += inner.text;
        hasEmphasis = hasEmphasis || inner.hasEmphasis;
      }
    }
  }
  return { text, hasEmphasis };
}

interface LeafSection {
  titles: string[];
  paragraphs: { text: string; em: boolean }[];
}

function collectLeafSections(sectionNodes: OrderedNode[], titles: string[]): LeafSection[] {
  const childSections: OrderedNode[][] = [];
  let title = '';
  const paragraphs: { text: string; em: boolean }[] = [];

  for (const node of sectionNodes) {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'title') {
        title = textOf(value as OrderedNode[]).text.replace(/\s+/g, ' ').trim();
      } else if (key === 'section') {
        childSections.push(value as OrderedNode[]);
      } else if (key === 'p') {
        const { text, hasEmphasis } = textOf(value as OrderedNode[]);
        const clean = text.replace(/\s+/g, ' ').trim();
        if (clean) paragraphs.push({ text: clean, em: hasEmphasis });
      }
    }
  }

  const path = title ? [...titles, title] : titles;
  if (childSections.length === 0) {
    return paragraphs.length > 0 ? [{ titles: path, paragraphs }] : [];
  }
  return childSections.flatMap((child) => collectLeafSections(child, path));
}

const bodies = findAll(doc, 'body');
if (bodies.length === 0) {
  console.error('FB2 に <body> が見つからない');
  process.exit(1);
}

// 本文は最初の body（後続の body は脚注などのことが多い）
const topSections = findAll(bodies[0], 'section');
const leaves = topSections.flatMap((s) => collectLeafSections(s, []));

mkdirSync(join('source', 'paragraphs'), { recursive: true });

// 「部の中の章」構造を仮定して 部-章 の連番を振る。構造が異なる場合は連番のみ。
let part = 0;
let chapterInPart = 0;
let lastPartTitle = '';
let total = 0;

for (const leaf of leaves) {
  const partTitle = leaf.titles.length > 1 ? leaf.titles[0] : '';
  if (partTitle !== lastPartTitle) {
    part += 1;
    chapterInPart = 0;
    lastPartTitle = partTitle;
  }
  chapterInPart += 1;

  const chapterId = `${chapterPrefix}-${String(part).padStart(2, '0')}-${String(chapterInPart).padStart(2, '0')}`;
  const chapterLabel = leaf.titles.join(' ') || chapterId;

  const paragraphs = leaf.paragraphs.map((p, i) => {
    const out: Record<string, unknown> = {
      id: `p${String(i + 1).padStart(3, '0')}`,
      src: p.text,
      ja: '',
      status: 'draft',
    };
    if (p.em) out.em = true;
    return out;
  });

  const outPath = join('source', 'paragraphs', `${chapterId}.src.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      { workId, chapterLabel, order: part * 100 + chapterInPart, paragraphs },
      null,
      2,
    ) + '\n',
    'utf-8',
  );
  total += 1;
  console.log(`${outPath}: ${paragraphs.length} 段落（${chapterLabel}）`);
}

console.log(`計 ${total} 章`);
