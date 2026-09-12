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
 * 題辞（<div class="epigraph">）は本文として拾い、脚注・編集者注の一覧（references）は落とす。
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
// 校正版（ProofreadPage, zh 等）のコンテナは prp-pages-output で、PD テンプレートは本文の
// 「後ろ」に来る。前だけ切ると本文に混ざるので、licenseContainer 以降も落とす。
const BODY_CONTAINERS = ['<div class="text">', '<div class="prp-pages-output"'];
let bodyStart = -1;
for (const marker of BODY_CONTAINERS) {
  const i = html.indexOf(marker);
  if (i >= 0 && (bodyStart < 0 || i < bodyStart)) bodyStart = i;
}
let body = bodyStart >= 0 ? html.slice(bodyStart) : html;

/** class に marker を含む <tag> ブロックを、入れ子を数えて丸ごと落とす */
function stripBlocks(src: string, marker: string, tagNames: string[]): string {
  for (const tag of tagNames) {
    const open = new RegExp(`<${tag}\\b[^>]*class="[^"]*${marker}[^"]*"[^>]*>`, 'gi');
    let out = '';
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = open.exec(src))) {
      const afterOpen = open.lastIndex;
      const close = new RegExp(`<(\\/?)${tag}\\b[^>]*>`, 'gi');
      close.lastIndex = afterOpen;
      let depth = 1;
      let end = -1;
      let t: RegExpExecArray | null;
      while (depth > 0 && (t = close.exec(src))) {
        depth += t[1] ? -1 : 1;
        if (depth === 0) end = close.lastIndex;
      }
      if (end < 0) continue; // 閉じが見つからない壊れた HTML は触らない
      out += src.slice(last, m.index);
      last = end;
      open.lastIndex = end;
    }
    src = out + src.slice(last);
  }
  return src;
}

// 本文コンテナ（div.text 等）を持たない版がある。そのときは Wikisource 標準の
// `class="ws-noexport"`（書き出しに含めないブロック）が非本文の目印になる。
// ヘッダ・ナビゲーションだけでなく **PD ライセンス文もこの中**にあるので、
// これを落とさないとライセンス文が第1段落として本文に混ざる（チェーホフ短編の多く）。
body = stripBlocks(body, 'ws-noexport', ['div', 'table']);

// 本文の「後ろ」に付く非本文ブロックはここで切る。PD テンプレート（licenseContainer）のほかに、
// 脚注・編集者注の一覧がある（ru の «Примечания редакторов Викитеки» 等）。注の中身は
// <div class="poem"><p> を含むことがあり、切らないと注の引用を本文の段落として拾ってしまう。
const TAIL_MARKERS = ['licenseContainer', 'class="references', 'mw-references-wrap'];
for (const marker of TAIL_MARKERS) {
  const at = body.indexOf(marker);
  if (at >= 0) body = body.slice(0, at);
}

// 本文の後ろに「Примечания」「См. также」等の注記の節が、見出し＋素の <p> で置かれる版がある
// （references を使っていないので上のマーカーでは切れない）。見出しの文面で切る。
// 作品内の節番号を見出しに置く版（狂人日記の 一〜十三）を切らないよう、既知の節名だけを見る。
const NON_BODY_HEADINGS =
  /^(Примечания|См\.?\s*также|Редакции|Варианты|Источник|Литература|Ссылки|Издания|Комментарии)/;
const headingRe = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/g;
let cutAt = -1;
let hm: RegExpExecArray | null;
while ((hm = headingRe.exec(body))) {
  const text = stripInvisible(decodeEntities(hm[1].replace(/<[^>]+>/g, ''))).trim();
  if (NON_BODY_HEADINGS.test(text)) {
    cutAt = hm.index;
    break;
  }
}
if (cutAt >= 0) body = body.slice(0, cutAt);

// 題辞は <p> ではなく <div class="epigraph"> に置かれる版がある（チェーホフ短編の «Кому повем…»）。
// 入れ子の <div> を含むので開きタグから対応する </div> までを数えて取り出し、<center> と同じ
// 「本文だが <p> の外」ブロックとして本文の流れに戻す（位置が変わらないので段落順は保たれる）。
function foldEpigraphs(src: string): string {
  const open = /<div\b[^>]*class="[^"]*epigraph[^"]*"[^>]*>/gi;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = open.exec(src))) {
    const start = m.index;
    const afterOpen = open.lastIndex;
    const tag = /<(\/?)div\b[^>]*>/gi;
    tag.lastIndex = afterOpen;
    let depth = 1;
    let end = -1;
    let t: RegExpExecArray | null;
    while (depth > 0 && (t = tag.exec(src))) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) end = tag.lastIndex;
    }
    if (end < 0) continue; // 閉じが見つからない壊れた HTML は触らない
    out += src.slice(last, start) + '<center>' + src.slice(afterOpen, end - '</div>'.length) + '</center>';
    last = end;
    open.lastIndex = end;
  }
  return out + src.slice(last);
}
body = foldEpigraphs(body);

interface Block {
  text: string;
  em: boolean;
  /** <center> 由来（題辞・概要・場面区切りなど、<p> の外に置かれる本文） */
  center: boolean;
}

// 本文は <p> だけとは限らない。題辞・概要・場面区切りを <center> に置く版があり、
// 文語の序文など「引用として一段下げた」ブロックは <dl><dd> に入る（狂人日記の序）。
const blocks: Block[] = [];
for (const m of body.matchAll(/<(p|center|dd)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
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

// 見出し（<h2> 等）は段落として拾わない。作品内の節番号を見出しに置く版があるので
// （狂人日記の 一〜十三）、黙って落とさず何を落としたかを報告する。
// 節構造が要るなら outlines の節 label で表現し、章JSONには見出し段落を作らない。
const droppedHeadings = [...body.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/g)]
  .map((m) => stripInvisible(decodeEntities(m[1].replace(/<[^>]+>/g, ''))).trim())
  .filter((t) => t.length > 0);

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
if (droppedHeadings.length > 0) {
  console.warn(
    `  注意: 本文中の見出し ${droppedHeadings.length} 件を段落にしていない: ${droppedHeadings.join(' / ')}`,
  );
  console.warn('    節構造が要るなら source/outlines/<chapterId>.json の節 label で表現すること');
}
if (unrenderedTex.length > 0) {
  console.warn(`  警告: 平文にできなかった数式 ${unrenderedTex.length} 件（TeX のまま残した）:`);
  for (const tex of [...new Set(unrenderedTex)]) console.warn(`    ${tex}`);
}
