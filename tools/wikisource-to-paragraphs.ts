/**
 * Wikisource の action=parse API レスポンス（HTML）を段落配列スケルトンに変換する。
 * 出力: ja が空の段落配列 JSON。翻訳パイプライン（translate.ts）の入力になる。
 *
 * 使い方:
 *   tsx tools/wikisource-to-paragraphs.ts <api.json> <workId> <chapterId> <chapterLabel> <order>
 * 例:
 *   tsx tools/wikisource-to-paragraphs.ts source/wikisource/crime-01-01.api.json \
 *     crime crime-01-01 "第一部 第一章" 1
 *
 * ロシア語FB2用のコンバータは fb2-to-paragraphs.ts。出力形式は同一。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [apiJsonPath, workId, chapterId, chapterLabel, orderStr] = process.argv.slice(2);
if (!apiJsonPath || !workId || !chapterId || !chapterLabel || !orderStr) {
  console.error('usage: tsx tools/wikisource-to-paragraphs.ts <api.json> <workId> <chapterId> <chapterLabel> <order>');
  process.exit(1);
}

const api = JSON.parse(readFileSync(apiJsonPath, 'utf-8'));
const html: string = api.parse.text;

const NAMED_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&laquo;': '«',
  '&raquo;': '»',
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&[a-z]+;/gi, (m) => NAMED_ENTITIES[m.toLowerCase()] ?? m);
}

interface SkeletonParagraph {
  id: string;
  src: string;
  ja: string;
  status: 'draft';
  em?: boolean;
}

const paragraphs: SkeletonParagraph[] = [];
let n = 0;
for (const m of html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
  let inner = m[1];
  // 強調は落とさずメタ情報として残す。注釈を当てる位置の目印になる
  const em = /<(i|em)\b/.test(inner);
  inner = inner
    .replace(/<sup[\s\S]*?<\/sup>/g, '') // 脚注マーカー
    .replace(/<span[^>]*class="[^"]*mw-editsection[^"]*"[\s\S]*?<\/span>/g, '')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '');
  const text = decodeEntities(inner).replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();
  if (!text) continue;
  // ナビゲーション・出典表記などの短い断片を除外（本文の段落は最低でも文がある）
  if (text.length < 2) continue;
  n += 1;
  const p: SkeletonParagraph = {
    id: `p${String(n).padStart(3, '0')}`,
    src: text,
    ja: '',
    status: 'draft',
  };
  if (em) p.em = true;
  paragraphs.push(p);
}

const out = {
  workId,
  chapterLabel,
  order: Number(orderStr),
  sourceUrl: `https://ru.wikisource.org/?curid=${api.parse.pageid ?? ''}`,
  sourceRevId: api.parse.revid,
  paragraphs,
};

const outPath = join('source', 'paragraphs', `${chapterId}.src.json`);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf-8');
console.log(`${outPath}: ${paragraphs.length} paragraphs (em: ${paragraphs.filter((p) => p.em).length})`);
