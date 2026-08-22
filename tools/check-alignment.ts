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
const catalog = JSON.parse(readFileSync(join('src', 'data', 'works.json'), 'utf-8')) as Record<
  string,
  { sourceLang: string }
>;

// ---- 原語ごとの辞書 ----
// 新しい sourceLang を扱うときはここに1エントリ足す（数詞・否定語・語境界の文字クラス）。

interface SrcLangSpec {
  /** 語境界判定に使う、その言語の「語を構成する文字」クラス */
  letters: string;
  numbers: Record<string, number>;
  negations: string[];
  /**
   * 分かち書きしない言語（中国語）は語境界の先読みを使わない。
   * 「他不来」の「不」は前後が漢字なので、語境界を要求すると否定を1つも拾えなくなる。
   */
  noWordBoundary?: boolean;
  /** 漢数字（一二三…百千）を訳文と同じ規則で数える。numbers 辞書の代わりに使う */
  cjkNumerals?: boolean;
  /**
   * 漢数字を数える条件になる量詞・単位。指定すると「数字＋（多／幾）＋単位」だけを拾う。
   * 中国語は「一樣（同じ）」「不十分（さほど〜ない）」のように数でない漢数字が多く、
   * 素朴に拾うと段落の大半が誤検知になる。金額・年月だけに絞るためのふるい。
   */
  numeralUnits?: string;
  /** 文末記号（既定は欧文の . ! ? …） */
  sentenceEnd?: string;
}

const SRC_LANGS: Record<string, SrcLangSpec> = {
  ru: {
    letters: 'а-яёА-ЯЁ',
    numbers: {
      'один': 1, 'одна': 1, 'два': 2, 'две': 2, 'три': 3, 'четыре': 4, 'пять': 5,
      'шесть': 6, 'семь': 7, 'восемь': 8, 'девять': 9, 'десять': 10,
      'одиннадцать': 11, 'двенадцать': 12, 'двадцать': 20, 'тридцать': 30,
      'сорок': 40, 'пятьдесят': 50, 'сто': 100, 'тысяча': 1000,
      'первый': 1, 'второй': 2, 'третий': 3, 'пятиэтажный': 5, 'пятиэтажного': 5,
    },
    // нельзя / невозможно 等の一語で否定を担う語も入れる（訳文の「〜ない」が
    // 否定の混入と誤検知されるため）
    negations: ['не', 'ни', 'нет', 'никто', 'ничего', 'никакой', 'нельзя', 'невозможно',
      'никогда', 'нигде', 'никак', 'ничто'],
  },
  de: {
    letters: 'a-zA-ZäöüßÄÖÜ',
    // ein/eine/einen… は不定冠詞と同形なので数詞に入れない（誤検知が本文の全段落に出る）
    numbers: {
      'eins': 1, 'zwei': 2, 'drei': 3, 'vier': 4, 'fünf': 5, 'sechs': 6, 'sieben': 7,
      'acht': 8, 'neun': 9, 'zehn': 10, 'elf': 11, 'zwölf': 12, 'zwanzig': 20,
      'dreißig': 30, 'vierzig': 40, 'fünfzig': 50, 'hundert': 100, 'tausend': 1000,
      'erste': 1, 'zweite': 2, 'dritte': 3, 'beide': 2, 'beiden': 2,
    },
    negations: ['nicht', 'nichts', 'kein', 'keine', 'keinen', 'keinem', 'keiner', 'keines',
      'nie', 'niemals', 'niemand', 'nirgends'],
  },
  zh: {
    // 分かち書きしないので語境界は使えない（noWordBoundary）
    letters: '',
    // 漢数字は訳文側と同じ規則で数える（numbers 辞書は使わない）
    numbers: {},
    cjkNumerals: true,
    numeralUnits: '文錢钱碗碟歲岁年月日天個个顆颗件句斤里人',
    // 非（非常＝とても）・別（別的＝ほかの）は否定でない用法が多すぎるので入れない
    negations: ['不', '沒', '没', '無', '无', '未', '莫', '毫不', '並非', '并非'],
    noWordBoundary: true,
    // 「；」は独立した節を継ぐ。日本語では文に割れるので、原文側でも文の切れ目として数える
    sentenceEnd: '。！？…；',
  },
};

const sourceLang = catalog[chapter.workId]?.sourceLang;
const langSpec = SRC_LANGS[sourceLang];
if (!langSpec) {
  console.error(
    `sourceLang "${sourceLang}" の数詞・否定辞書が未定義。tools/check-alignment.ts の SRC_LANGS に追加すること`,
  );
  process.exit(1);
}

const JA_DIGITS: Record<string, number> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
  '十': 10, '百': 100, '千': 1000,
};

function srcNumbers(text: string): number[] {
  const nums: number[] = [];
  for (const m of text.matchAll(/\d+/g)) nums.push(Number(m[0]));
  if (langSpec.cjkNumerals) {
    nums.push(...cjkNumerals(text, langSpec.numeralUnits));
    return nums.sort((a, b) => a - b);
  }
  const lower = text.toLowerCase();
  const { letters } = langSpec;
  for (const [word, value] of Object.entries(langSpec.numbers)) {
    const re = langSpec.noWordBoundary
      ? new RegExp(word, 'g')
      : new RegExp(`(?<![${letters}])${word}(?![${letters}])`, 'g');
    for (const m of lower.matchAll(re)) {
      void m;
      nums.push(value);
    }
  }
  return nums.sort((a, b) => a - b);
}

/**
 * 漢数字の連なりを値に変換（十進の単純な組み合わせのみ）。原文が中国語のときは両側で使う。
 * units を渡すと「数字＋（多／幾／余）＋単位」の形だけを拾う（原文側の誤検知よけ）。
 */
function cjkNumerals(text: string, units?: string): number[] {
  const re = units
    ? new RegExp(`[一二三四五六七八九十百千]+(?=[多幾几餘余]?[${units}])`, 'g')
    : /[一二三四五六七八九十百千]+/g;
  const nums: number[] = [];
  for (const m of text.matchAll(re)) {
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
  return nums;
}

function jaNumbers(text: string): number[] {
  // マークアップを除いた表示テキストで数える
  const plain = text.replace(/\{\{[prn]:[a-z0-9-]+\|([^}]+)\}\}/g, '$1');
  const nums: number[] = [];
  for (const m of plain.matchAll(/\d+/g)) nums.push(Number(m[0]));
  for (const m of plain.matchAll(/ひとり|ひとつ|ふたり|ふたつ/g)) {
    nums.push(m[0].startsWith('ひと') ? 1 : 2);
  }
  nums.push(...cjkNumerals(plain));
  return nums.sort((a, b) => a - b);
}

// ---- 否定・文数 ----

function srcNegations(text: string): number {
  const { letters, negations, noWordBoundary } = langSpec;
  const re = noWordBoundary
    ? new RegExp(`(?:${negations.join('|')})`, 'g')
    : new RegExp(`(?<![${letters}])(?:${negations.join('|')})(?![${letters}])`, 'g');
  return [...text.toLowerCase().matchAll(re)].length;
}

function jaNegations(text: string): number {
  return [...text.matchAll(/ない|なかった|なく|ぬ(?![きぐ])|ず(?:に|、)|まい|せず|しない/g)].length;
}

function srcSentences(text: string): number {
  const ends = langSpec.sentenceEnd ?? '.!?…';
  const re = new RegExp(`[${ends.replace(/[.\-\]\\^]/g, '\\$&')}]+[\\s»")“”』」）]*`, 'g');
  return text.split(re).filter((s) => s.trim().length > 0).length;
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

  const rn = srcNumbers(p.src);
  const jn = jaNumbers(p.ja);
  const missing = rn.filter((n) => !jn.includes(n));
  if (missing.length > 0) {
    problems.push(`数詞の不一致の可能性: 原文にある ${missing.join(', ')} が訳文で見つからない`);
  }

  const rNeg = srcNegations(p.src);
  const jNeg = jaNegations(p.ja);
  if (rNeg > 0 && jNeg === 0) problems.push(`否定の消失の可能性: 原文の否定 ${rNeg} 箇所に対し訳文 0`);
  if (rNeg === 0 && jNeg >= 2) problems.push(`否定の混入の可能性: 原文に否定がないが訳文に ${jNeg} 箇所`);

  const rs = srcSentences(p.src);
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
