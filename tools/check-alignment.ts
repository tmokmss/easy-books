/**
 * 原文と訳文の機械的な突き合わせ。人間が読む前のふるいとして使う。
 * LLM を使わないオフラインチェック。CIで落とす必要はない（レポートを出すだけ）。
 *
 * 使い方: npx tsx tools/check-alignment.ts <chapterId>
 *
 * 検出するもの:
 *   - 数量・金額・時刻の不一致（数詞の集合を比較）
 *   - 否定の有無の反転の兆候
 *   - 段落内の文の数が大きくずれている箇所（訳し落としの兆候）
 *   - 固有名詞の表記ゆれ（people.json と照合）
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const chapterId = process.argv[2];
if (!chapterId) {
  console.error('usage: tsx tools/check-alignment.ts <chapterId>');
  process.exit(1);
}

const chapter = JSON.parse(
  readFileSync(join('src', 'content', 'chapters', `${chapterId}.json`), 'utf-8'),
);
const people = JSON.parse(
  readFileSync(join('src', 'data', 'works', chapter.workId, 'people.json'), 'utf-8'),
);

// ---- 数詞の抽出 ----

const RU_NUMBERS: Record<string, number> = {
  'один': 1, 'одна': 1, 'два': 2, 'две': 2, 'три': 3, 'четыре': 4, 'пять': 5,
  'шесть': 6, 'семь': 7, 'восемь': 8, 'девять': 9, 'десять': 10,
  'одиннадцать': 11, 'двенадцать': 12, 'двадцать': 20, 'тридцать': 30,
  'сорок': 40, 'пятьдесят': 50, 'сто': 100, 'тысяча': 1000,
  'первый': 1, 'второй': 2, 'третий': 3, 'пятиэтажный': 5, 'пятиэтажного': 5,
};

const JA_DIGITS: Record<string, number> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
  '十': 10, '百': 100, '千': 1000,
};

function ruNumbers(text: string): number[] {
  const nums: number[] = [];
  for (const m of text.matchAll(/\d+/g)) nums.push(Number(m[0]));
  const lower = text.toLowerCase();
  for (const [word, value] of Object.entries(RU_NUMBERS)) {
    for (const m of lower.matchAll(new RegExp(`(?<![а-яё])${word}(?![а-яё])`, 'g'))) {
      void m;
      nums.push(value);
    }
  }
  return nums.sort((a, b) => a - b);
}

function jaNumbers(text: string): number[] {
  // マークアップを除いた表示テキストで数える
  const plain = text.replace(/\{\{[prn]:[a-z0-9-]+\|([^}]+)\}\}/g, '$1');
  const nums: number[] = [];
  for (const m of plain.matchAll(/\d+/g)) nums.push(Number(m[0]));
  for (const m of plain.matchAll(/ひとり|ひとつ|ふたり|ふたつ/g)) {
    nums.push(m[0].startsWith('ひと') ? 1 : 2);
  }
  // 漢数字の連なりを値に変換（十進の単純な組み合わせのみ）
  for (const m of plain.matchAll(/[一二三四五六七八九十百千]+/g)) {
    let total = 0;
    let current = 0;
    for (const ch of m[0]) {
      const v = JA_DIGITS[ch];
      if (v < 10) current = current * 10 + v;
      else {
        total += (current || 1) * v;
        current = 0;
      }
    }
    nums.push(total + current);
  }
  return nums.sort((a, b) => a - b);
}

// ---- 否定・文数 ----

function ruNegations(text: string): number {
  return [...text.toLowerCase().matchAll(/(?<![а-яё])(не|ни|нет|никто|ничего|никакой)(?![а-яё])/g)]
    .length;
}

function jaNegations(text: string): number {
  return [...text.matchAll(/ない|なかった|なく|ぬ(?![きぐ])|ず(?:に|、)|まい|せず|しない/g)].length;
}

function ruSentences(text: string): number {
  return text.split(/[.!?…]+[\s»)]*/).filter((s) => s.trim().length > 0).length;
}

function jaSentences(text: string): number {
  return text.split(/[。！？…]+[」』）]*/).filter((s) => s.trim().length > 0).length;
}

// ---- 固有名詞の表記ゆれ ----

const knownNames = new Set<string>();
for (const p of Object.values(people) as any[]) {
  knownNames.add(p.short);
  knownNames.add(p.name);
  for (const a of p.aliases ?? []) knownNames.add(a);
  for (const part of (p.name as string).split('・')) knownNames.add(part);
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

function nameVariants(text: string): string[] {
  const plain = text.replace(/\{\{[prn]:[a-z0-9-]+\|([^}]+)\}\}/g, '$1');
  const issues: string[] = [];
  for (const m of plain.matchAll(/[ァ-ヴー・]{4,}/g)) {
    const kana = m[0];
    if (knownNames.has(kana)) continue;
    for (const known of knownNames) {
      if (known.length >= 4 && editDistance(kana, known) <= 2) {
        issues.push(`「${kana}」（people.json の「${known}」の表記ゆれ？）`);
        break;
      }
    }
  }
  return issues;
}

// ---- レポート ----

let findings = 0;
console.log(`# check-alignment: ${chapterId}\n`);

for (const p of chapter.paragraphs) {
  const problems: string[] = [];

  const rn = ruNumbers(p.src);
  const jn = jaNumbers(p.ja);
  const missing = rn.filter((n) => !jn.includes(n));
  if (missing.length > 0) {
    problems.push(`数詞の不一致の可能性: 原文にある ${missing.join(', ')} が訳文で見つからない`);
  }

  const rNeg = ruNegations(p.src);
  const jNeg = jaNegations(p.ja);
  if (rNeg > 0 && jNeg === 0) problems.push(`否定の消失の可能性: 原文の否定 ${rNeg} 箇所に対し訳文 0`);
  if (rNeg === 0 && jNeg >= 2) problems.push(`否定の混入の可能性: 原文に否定がないが訳文に ${jNeg} 箇所`);

  const rs = ruSentences(p.src);
  const js = jaSentences(p.ja);
  if (Math.abs(rs - js) > Math.max(2, rs * 0.5)) {
    problems.push(`文数の乖離: 原文 ${rs} 文 / 訳文 ${js} 文（訳し落とし・過剰分割の兆候）`);
  }

  problems.push(...nameVariants(p.ja));

  if (problems.length > 0) {
    findings += problems.length;
    console.log(`## ${p.id} [${p.status}]`);
    for (const prob of problems) console.log(`- ${prob}`);
    console.log();
  }
}

console.log(
  findings === 0
    ? '機械チェックでの指摘なし。人間による原文照合は別途必要。'
    : `計 ${findings} 件。誤検知を含むため、必ず人間が原文と照合して判断すること。`,
);
