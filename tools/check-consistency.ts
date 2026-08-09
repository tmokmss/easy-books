/**
 * 作品全体の表記の一貫性チェック。人間が読む前のふるいとして使う。
 * LLM を使わないオフラインチェック。レポートを出すだけで、修正はしない。
 *
 * 使い方: npx tsx tools/check-consistency.ts <workId>
 *
 * 検出するもの:
 *   - カタカナ固有名詞の表記ゆれ（people.json / style-guide.json の names・terms を正とし、
 *     編集距離1〜2の近似トークンを疑いとして報告。台帳外どうしの近似ペアも報告）
 *   - 一人称の分布（おれ/俺/僕/私/わたし/わたくし/あたし/わし の章別表と、
 *     漢字・かな混在などの作品レベルの警告）
 *   - style-guide.json の people.*.firstPerson 未定義の主要人物
 *
 * 注意: 原文の意図的な使い分け（父称の完全形/縮約形、訛り表現の「わたし」等）も
 * 検出に含まれるため、報告 = 要修正ではない。判断は人間（またはレビュー工程）が行う。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const workId = process.argv[2];
if (!workId) {
  console.error('usage: tsx tools/check-consistency.ts <workId>');
  process.exit(1);
}

const chapterDir = join('src', 'content', 'chapters');
const chapterFiles = readdirSync(chapterDir)
  .filter((f) => f.startsWith(`${workId}-`) && f.endsWith('.json'))
  .sort();
if (chapterFiles.length === 0) {
  console.error(`章ファイルが見つからない: ${chapterDir}/${workId}-*.json`);
  process.exit(1);
}

const people = JSON.parse(
  readFileSync(join('src', 'data', 'works', workId, 'people.json'), 'utf-8'),
) as Record<string, { name?: string; short?: string; aliases?: string[] }>;
let styleGuide: {
  names?: Record<string, string>;
  terms?: Record<string, string>;
  people?: Record<string, { firstPerson?: string }>;
} = {};
try {
  styleGuide = JSON.parse(
    readFileSync(join('src', 'data', 'works', workId, 'style-guide.json'), 'utf-8'),
  );
} catch {
  /* style-guide が無い作品は台帳照合をスキップ */
}

// ---- 台帳から正とするカタカナ表記の集合を作る（・区切りは部分に分解） ----

const canonical = new Set<string>();
function addCanonical(s: string | undefined) {
  if (!s) return;
  for (const part of s.split(/[・=]/)) {
    for (const m of part.matchAll(/[ァ-ヴー]{3,}/g)) canonical.add(m[0]);
  }
}
for (const p of Object.values(people)) {
  addCanonical(p.name);
  addCanonical(p.short);
  for (const a of p.aliases ?? []) addCanonical(a);
}
for (const k of Object.keys(styleGuide.names ?? {})) addCanonical(k);
for (const v of Object.values(styleGuide.terms ?? {})) addCanonical(v);

// ---- 章の読み込みとカタカナトークン集計 ----

type Freq = Map<string, Map<string, number>>; // token -> chapterId -> count
const freq: Freq = new Map();
const chapters: { id: string; paragraphs: { id: string; ja: string }[] }[] = [];
for (const f of chapterFiles) {
  const ch = JSON.parse(readFileSync(join(chapterDir, f), 'utf-8'));
  const id = f.replace('.json', '');
  chapters.push({ id, paragraphs: ch.paragraphs });
  for (const p of ch.paragraphs) {
    for (const m of (p.ja as string).matchAll(/[ァ-ヴー]{3,}/g)) {
      if (!freq.has(m[0])) freq.set(m[0], new Map());
      const byCh = freq.get(m[0])!;
      byCh.set(id, (byCh.get(id) ?? 0) + 1);
    }
  }
}
const total = (t: string) => [...(freq.get(t)?.values() ?? [])].reduce((a, b) => a + b, 0);
const chapterList = (t: string) => [...(freq.get(t)?.keys() ?? [])].join(',');

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return d[a.length][b.length];
}

// ---- 1) 台帳の表記に近い（が一致しない）トークン ----

console.log(`=== 固有名詞: 台帳（people/names/terms）との近似ゆれ疑い ===`);
let nameWarnings = 0;
for (const token of freq.keys()) {
  if (canonical.has(token)) continue;
  for (const canon of canonical) {
    if (token.length < 3 || canon.length < 3) continue;
    if (token.includes(canon) || canon.includes(token)) continue; // 語尾違い等は距離で拾う
    const d = editDistance(token, canon);
    const maxD = Math.min(token.length, canon.length) >= 5 ? 2 : 1;
    if (d >= 1 && d <= maxD) {
      console.log(
        `  ${token} (${total(token)}回: ${chapterList(token)}) ≈ 台帳「${canon}」`,
      );
      nameWarnings++;
      break;
    }
  }
}
if (nameWarnings === 0) console.log('  なし');

// ---- 2) 台帳外どうしの近似ペア（どちらも複数回出現するもの） ----

console.log(`\n=== 固有名詞: 台帳外どうしの近似ペア（要判断・誤検知あり） ===`);
const tokens = [...freq.keys()].filter((t) => !canonical.has(t) && total(t) >= 2 && t.length >= 4);
let pairWarnings = 0;
for (let i = 0; i < tokens.length; i++) {
  for (let j = i + 1; j < tokens.length; j++) {
    const a = tokens[i];
    const b = tokens[j];
    if (a.includes(b) || b.includes(a)) continue;
    const d = editDistance(a, b);
    if (d >= 1 && d <= 2) {
      console.log(`  ${a} (${total(a)}回: ${chapterList(a)}) <-> ${b} (${total(b)}回: ${chapterList(b)})`);
      pairWarnings++;
    }
  }
}
if (pairWarnings === 0) console.log('  なし');

// ---- 3) 一人称の分布 ----

// 偽陽性ガードつきカウント。わし はトークン頭のみ（漏れあり）
function countPronouns(text: string): Record<string, number> {
  const c: Record<string, number> = {};
  const add = (k: string, n: number) => {
    if (n) c[k] = (c[k] ?? 0) + n;
  };
  add('おれ', [...text.matchAll(/(?<![し])おれ/g)].length);
  add('俺', [...text.matchAll(/俺/g)].length);
  add('僕', [...text.matchAll(/(?<![下従老公家])僕/g)].length);
  add('私', [...text.matchAll(/私(?![立生利腹欲物情淑服税財])/g)].length);
  // わたし: 見わたし等（直前が見/み/渡）と、〜わした/〜わして（直後がた/て。わたしたち は除外しない）を除く
  let n = 0;
  for (const m of text.matchAll(/わたし/g)) {
    const prev = text[m.index! - 1] ?? '';
    const next = text[m.index! + 3] ?? '';
    const next2 = text.slice(m.index! + 3, m.index! + 5);
    if (['見', 'み', '渡'].includes(prev)) continue;
    if ((next === 'た' || next === 'て') && next2 !== 'たち') continue;
    n++;
  }
  add('わたし', n);
  add('わたくし', [...text.matchAll(/わたくし/g)].length);
  add('あたし', [...text.matchAll(/あたし/g)].length);
  add('わし', [...text.matchAll(/(?<=^|[「、。！？…　])わし/gm)].length);
  return c;
}

console.log(`\n=== 一人称の章別分布 ===`);
const keys = ['おれ', '俺', '僕', '私', 'わたし', 'わたくし', 'あたし', 'わし'];
const workTotal: Record<string, number> = {};
console.log(`  ${'chapter'.padEnd(14)} ${keys.join('  ')}`);
for (const ch of chapters) {
  const c: Record<string, number> = {};
  for (const p of ch.paragraphs) {
    for (const [k, n] of Object.entries(countPronouns(p.ja))) {
      c[k] = (c[k] ?? 0) + n;
      workTotal[k] = (workTotal[k] ?? 0) + n;
    }
  }
  if (Object.keys(c).length === 0) continue;
  console.log(`  ${ch.id.padEnd(14)} ${keys.map((k) => String(c[k] ?? 0).padStart(2)).join('  ')}`);
}

console.log(`\n=== 一人称: 作品レベルの警告 ===`);
let pronounWarnings = 0;
if ((workTotal['俺'] ?? 0) > 0 && (workTotal['おれ'] ?? 0) > 0) {
  console.log(`  WARN 「俺」(${workTotal['俺']}) と「おれ」(${workTotal['おれ']}) が混在。表記を統一すること`);
  pronounWarnings++;
}
if ((workTotal['俺'] ?? 0) > 0 && (workTotal['おれ'] ?? 0) === 0) {
  console.log(`  NOTE 「俺」を使用中 (${workTotal['俺']})。既定の方針はひらがな「おれ」`);
  pronounWarnings++;
}
if ((workTotal['わたし'] ?? 0) > 0 && (workTotal['私'] ?? 0) > 0) {
  console.log(
    `  WARN 「わたし」(${workTotal['わたし']}) と「私」(${workTotal['私']}) が混在。` +
      `意図的な使い分け（訛り・聖書引用等が style-guide に明記されている場合）以外は「私」に統一すること`,
  );
  pronounWarnings++;
}

// ---- 4) style-guide の firstPerson 未定義 ----

console.log(`\n=== style-guide.json の一人称定義 ===`);
let fpWarnings = 0;
for (const pid of Object.keys(people)) {
  const fp = styleGuide.people?.[pid]?.firstPerson;
  if (!fp) {
    console.log(`  NOTE ${pid}（${people[pid].short ?? pid}）の firstPerson が未定義`);
    fpWarnings++;
  }
}
if (fpWarnings === 0) console.log('  主要人物すべてに firstPerson が定義済み');

console.log(
  `\n合計: 固有名詞ゆれ疑い ${nameWarnings + pairWarnings} 件 / 一人称警告 ${pronounWarnings} 件 / firstPerson 未定義 ${fpWarnings} 件`,
);
