import type { GlossaryEntry, Person } from './types';

/**
 * インラインマークアップは3種類だけ。増やさないこと。
 *   {{p:id|表示文字}} 固有名での言及   → 実線下線。愛称・父称形のときだけ本名グロス
 *   {{r:id|表示文字}} 代名詞等での言及 → 既定では無印。タップのみ効く。グロスは出さない
 *   {{n:id|表示文字}} 語注            → 点線下線
 */
export type RefType = 'p' | 'r' | 'n';

export type Token =
  | { kind: 'text'; text: string }
  | { kind: 'ref'; type: RefType; id: string; text: string };

// パーサは正規表現1本で足りる。凝らないこと。
const MARKUP_RE = /\{\{([prn]):([a-z0-9-]+)\|([^{}|]+)\}\}/g;

export function tokenize(ja: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const m of ja.matchAll(MARKUP_RE)) {
    if (m.index > last) tokens.push({ kind: 'text', text: ja.slice(last, m.index) });
    tokens.push({ kind: 'ref', type: m[1] as RefType, id: m[2], text: m[3] });
    last = m.index + m[0].length;
  }
  if (last < ja.length) tokens.push({ kind: 'text', text: ja.slice(last) });
  return tokens;
}

/** 段落に登場する人物ID（p と r の両方）。人物レールの点灯に使う */
export function collectPersonIds(tokens: Token[]): string[] {
  const ids = new Set<string>();
  for (const t of tokens) {
    if (t.kind === 'ref' && (t.type === 'p' || t.type === 'r')) ids.add(t.id);
  }
  return [...ids];
}

/**
 * 記法違反・存在しないID参照を検出してエラー文字列を返す（正常なら空配列）。
 * ビルド時に呼び、タイプミスが本番に無言のまま素通りするのを防ぐ。
 */
export function validateParagraphMarkup(
  ja: string,
  people: Record<string, Person>,
  glossary: Record<string, GlossaryEntry>,
): string[] {
  const errors: string[] = [];
  const tokens = tokenize(ja);
  for (const t of tokens) {
    if (t.kind === 'text') {
      // 記法として拾えなかった波括弧が残っていたら記法違反
      if (t.text.includes('{{') || t.text.includes('}}')) {
        errors.push(`記法違反（パースできない {{ }} が残っている）: "${t.text.trim().slice(0, 40)}"`);
      }
    } else if (t.type === 'p' || t.type === 'r') {
      if (!people[t.id]) errors.push(`people.json に存在しない人物ID: "${t.id}"（{{${t.type}:${t.id}|${t.text}}}）`);
    } else if (!glossary[t.id]) {
      errors.push(`glossary.json に存在しない語注ID: "${t.id}"（{{n:${t.id}|${t.text}}}）`);
    }
  }
  return errors;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * 段落の ja マークアップを HTML に変換する（ビルド時実行）。
 * 注釈は <button> にする。<span> + click にしない（キーボードで辿れることが必須）。
 *
 * グロスを出す条件: p かつ 表示文字 ≠ short かつ ≠ name のときだけ。
 * つまり「ラスコーリニコフ」には出さず、「ロージャ」「ロジオン・ロマーヌイチ」には出す。
 * r にグロスを出してはいけない。
 */
export function renderParagraphHtml(ja: string, people: Record<string, Person>): string {
  const parts: string[] = [];
  for (const t of tokenize(ja)) {
    if (t.kind === 'text') {
      parts.push(escapeHtml(t.text));
      continue;
    }
    const label = escapeHtml(t.text);
    if (t.type === 'n') {
      parts.push(
        `<button type="button" class="ann ann-n" data-ann="n" data-ann-id="${t.id}" aria-haspopup="dialog">${label}</button>`,
      );
      continue;
    }
    const person = people[t.id];
    const needsGloss =
      t.type === 'p' && person && t.text !== person.short && t.text !== person.name;
    const gloss = needsGloss
      ? `<span class="gloss">〔${escapeHtml(person.short)}〕</span>`
      : '';
    parts.push(
      `<button type="button" class="ann ann-${t.type}" data-ann="${t.type}" data-ann-id="${t.id}" aria-haspopup="dialog">${label}${gloss}</button>`,
    );
  }
  return parts.join('');
}
