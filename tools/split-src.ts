/**
 * 原文を文単位に機械分割し、番号付きで保存する。対訳アラインメントの入力になる。
 * 分割は決定的（LLM不使用）。多少の過剰・過少分割はアラインメント側で
 * 「1セグメント=複数文」にまとめられるので許容する。
 *
 * 分割規則は works.json の sourceLang で切り替える（欧文＝空白＋大文字 / 中日＝句点と括弧）。
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

const catalog = JSON.parse(readFileSync(join('src', 'data', 'works.json'), 'utf-8')) as Record<
  string,
  { sourceLang: string }
>;
const sourceLang = catalog[skeleton.workId]?.sourceLang;
if (!sourceLang) {
  console.error(`works.json に workId "${skeleton.workId}" が未登録`);
  process.exit(1);
}

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

/** 分かち書きしない言語（中国語・日本語）。空白を手掛かりにできない */
const CJK_LANGS = new Set(['zh', 'ja']);

const CJK_OPEN = '「『（〈《【〔';
const CJK_CLOSE = '」』）〉》】〕';
/** 文末記号。… は単独では文末にしない（『…』の中の言いさしで多用されるため） */
const CJK_TERM = '。！？';
const CJK_TERM_TAIL = '。！？…';

/**
 * 中国語・日本語の文分割。句点・感嘆符・疑問符の直後で切るが、
 * 括弧・鉤括弧の内側では切らない（会話文が文の途中で割れるのを防ぐ）。
 * 閉じ括弧は直前が文末記号なら文に含めて切る（『…だ。』｜次の文）。
 */
function splitSentencesCjk(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    cur += ch;
    if (CJK_OPEN.includes(ch)) {
      depth += 1;
    } else if (CJK_CLOSE.includes(ch)) {
      if (depth > 0) depth -= 1;
      if (depth === 0 && CJK_TERM_TAIL.includes(text[i - 1] ?? '')) {
        out.push(cur);
        cur = '';
      }
    } else if (CJK_TERM.includes(ch) && depth === 0) {
      // 連続する文末記号（？！ や 。…… ）はひとまとまりにする
      while (i + 1 < text.length && CJK_TERM_TAIL.includes(text[i + 1])) cur += text[++i];
      // 直後が閉じ括弧なら、その括弧まで含めて切る（次のループの CJK_CLOSE 側で処理）
      if (!CJK_CLOSE.includes(text[i + 1] ?? '')) {
        out.push(cur);
        cur = '';
      }
    }
  }
  if (cur) out.push(cur);
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

const split = CJK_LANGS.has(sourceLang) ? splitSentencesCjk : splitSentences;

const out: Record<string, string[]> = {};
let total = 0;
for (const p of skeleton.paragraphs) {
  out[p.id] = split(p.src);
  total += out[p.id].length;
}

const outPath = join('source', 'paragraphs', `${chapterId}.sentences.json`);
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf-8');
console.log(`${outPath}: ${skeleton.paragraphs.length} 段落 / ${total} 文`);
