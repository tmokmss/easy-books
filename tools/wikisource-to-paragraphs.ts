/**
 * Wikisource の action=parse API レスポンス（HTML）を段落配列スケルトンに変換する。
 * 出力: ja が空の段落配列 JSON。翻訳パイプライン（translate.ts）の入力になる。
 *
 * 使い方:
 *   tsx tools/wikisource-to-paragraphs.ts <api.json> <workId> <chapterId> <chapterLabel> <order>
 *     [--lead-heading <正規表現>]
 * 例:
 *   tsx tools/wikisource-to-paragraphs.ts source/wikisource/crime-01-01.api.json \
 *     crime crime-01-01 "第一部 第一章" 1
 *   tsx tools/wikisource-to-paragraphs.ts source/wikisource/we-01.api.json \
 *     we we-01 "記録一" 1 --lead-heading '^Запись\s'
 *
 * --lead-heading: 本文冒頭の <center> 群（題辞・概要など、章の見出しブロック）を1段落にまとめる。
 *   正規表現に一致する行は章見出しそのもの（chapterLabel と重複）とみなして落とす。
 *   本文途中の <center> は通常の段落として扱う。
 *
 * ロシア語FB2用のコンバータは fb2-to-paragraphs.ts。出力形式は同一。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [apiJsonPath, workId, chapterId, chapterLabel, orderStr, ...flags] = process.argv.slice(2);
if (!apiJsonPath || !workId || !chapterId || !chapterLabel || !orderStr) {
  console.error('usage: tsx tools/wikisource-to-paragraphs.ts <api.json> <workId> <chapterId> <chapterLabel> <order> [--lead-heading <regex>]');
  process.exit(1);
}

const leadHeadingIdx = flags.indexOf('--lead-heading');
if (leadHeadingIdx >= 0 && !flags[leadHeadingIdx + 1]) {
  console.error('--lead-heading には正規表現を渡すこと');
  process.exit(1);
}
const leadHeadingDrop = leadHeadingIdx >= 0 ? new RegExp(flags[leadHeadingIdx + 1]) : null;

const api = JSON.parse(readFileSync(apiJsonPath, 'utf-8'));
const html: string = api.parse.text;

// 取得元ホストは作品カタログの sourceLang から決める（ru 決め打ちにしない）
const catalog = JSON.parse(readFileSync(join('src', 'data', 'works.json'), 'utf-8')) as Record<
  string,
  { sourceLang: string }
>;
const wikiLang = catalog[workId]?.sourceLang;
if (!wikiLang) {
  console.error(`works.json に workId "${workId}" が未登録（先にカタログへ追加すること）`);
  process.exit(1);
}

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

/** 方向制御・ゼロ幅文字は本文ではない（版によっては末尾の年記などに紛れ込む） */
function stripInvisible(s: string): string {
  return s.replace(/[\u200b-\u200f\ufeff]/g, '');
}

const unrenderedTex: string[] = [];

/**
 * 数式（<math>）は MathML＋フォールバック画像に展開される。素朴にタグを剥がすと
 * MathML の断片と TeX 注釈が本文に散らばるので、alttext の TeX から平文を組み立てる。
 * 対応していない式は TeX のまま残し、最後に警告する（人間が見て直す）。
 */
function texToPlain(tex: string): string {
  let s = tex
    .trim()
    .replace(/^\{\\displaystyle\s*([\s\S]*)\}$/, '$1')
    .trim();
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√$1');
  s = s
    .replace(/[{}]/g, '')
    .replace(/\s+/g, '')
    .replace(/-/g, '−');
  // 見慣れない記法が残っていたら平文にせず TeX のまま返す
  if (!s || s.includes('\\')) {
    unrenderedTex.push(tex);
    return tex;
  }
  return s;
}

interface SkeletonParagraph {
  id: string;
  src: string;
  ja: string;
  status: 'draft';
  em?: boolean;
}

// ライセンス表示・ナビゲーションは本文コンテナの外側にある（ru の PD テンプレート等）。
// コンテナがある版だけ、その内側に絞る。
const bodyStart = html.indexOf('<div class="text">');
const body = bodyStart >= 0 ? html.slice(bodyStart) : html;

interface Block {
  text: string;
  em: boolean;
  /** <center> 由来（題辞・概要・場面区切りなど、<p> の外に置かれる本文） */
  center: boolean;
}

// 本文は <p> だけとは限らない。題辞・概要・場面区切りを <center> に置く版がある
const blocks: Block[] = [];
for (const m of body.matchAll(/<(p|center)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
  let inner = m[2];
  // 朗読音声プレイヤー（de の Gesprochener Text 等）は本文ではない
  if (/<audio\b/.test(inner)) continue;
  // 強調は落とさずメタ情報として残す。注釈を当てる位置の目印になる
  const em = /<(i|em)\b/.test(inner);
  inner = inner
    // 数式は MathML の断片が本文に散らばる前に平文へ畳む
    .replace(/<math\b[^>]*alttext="([^"]*)"[\s\S]*?<\/math>/g, (_, tex) => texToPlain(tex))
    .replace(/<sup[\s\S]*?<\/sup>/g, '') // 脚注マーカー
    .replace(/<span[^>]*class="[^"]*mw-editsection[^"]*"[\s\S]*?<\/span>/g, '')
    // 校正版（Proofread Page）の原本ページ番号マーカー [59] を本文に混ぜない
    .replace(/<span[^>]*class="[^"]*(?:PageNumber|pagenum)[^"]*"[\s\S]*?<\/span>/gi, '')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '');
  const text = stripInvisible(decodeEntities(inner))
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
  if (!text) continue;
  // ナビゲーション・出典表記などの短い断片を除外（本文の段落は最低でも文がある）
  if (text.length < 2) continue;
  blocks.push({ text, em, center: m[1] === 'center' });
}

// 冒頭の <center> 群は章の見出しブロック。細切れの段落にすると訳しにくいので1段落にまとめ、
// 章見出しそのもの（chapterLabel と重複する行）は落とす。
if (leadHeadingDrop) {
  let lead = 0;
  while (lead < blocks.length && blocks[lead].center) lead += 1;
  if (lead > 0) {
    const kept = blocks.slice(0, lead).filter((b) => !leadHeadingDrop.test(b.text));
    const merged = kept
      .map((b) => b.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const heading: Block[] = merged ? [{ text: merged, em: kept.some((b) => b.em), center: true }] : [];
    blocks.splice(0, lead, ...heading);
  }
}

const paragraphs: SkeletonParagraph[] = blocks.map((b, i) => {
  const p: SkeletonParagraph = {
    id: `p${String(i + 1).padStart(3, '0')}`,
    src: b.text,
    ja: '',
    status: 'draft',
  };
  if (b.em) p.em = true;
  return p;
});

const out = {
  workId,
  chapterLabel,
  order: Number(orderStr),
  sourceUrl: `https://${wikiLang}.wikisource.org/?curid=${api.parse.pageid ?? ''}`,
  sourceRevId: api.parse.revid,
  paragraphs,
};

const outPath = join('source', 'paragraphs', `${chapterId}.src.json`);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf-8');
console.log(`${outPath}: ${paragraphs.length} paragraphs (em: ${paragraphs.filter((p) => p.em).length})`);
if (unrenderedTex.length > 0) {
  console.warn(`  警告: 平文にできなかった数式 ${unrenderedTex.length} 件（TeX のまま残した）:`);
  for (const tex of [...new Set(unrenderedTex)]) console.warn(`    ${tex}`);
}
