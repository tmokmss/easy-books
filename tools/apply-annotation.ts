/**
 * 注釈マークアップのパッチを検証して章JSONに適用する。LLMは呼ばない。
 * 1章＝1エージェントで注釈を付けるときの受け口。
 *
 * 入力JSON（LLMが生成。原文テキストは含まない）:
 *   { "p001": ["注釈付き断片1", "注釈付き断片2", ...], ... }
 *   - 配列は当該段落の segments[].ja に1対1対応（segments が無い段落は要素1個＝ja全体）
 *   - 各断片からマークアップを除去したものが、現在の断片テキストと完全一致すること
 *     （＝本文の改変ゼロを機械保証する）
 *
 * 検証:
 *   - マークアップ記法（{{p:id|表示}} / {{r:id|表示}} / {{n:id|表示}}）以外の {{ }} が残っていない
 *   - p/r の id は people.json に、n の id は glossary.json か --glossary フラグメントに存在
 *   - draft 以外の段落は変更しない（エラー）
 *
 * 使い方: npx tsx tools/apply-annotation.ts <chapterId> <markup.json> [--glossary <fragment.json>]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MARKUP_RE = /\{\{([prn]):([a-z0-9-]+)\|([^{}|]+)\}\}/g;

function strip(s: string): string {
  return s.replace(MARKUP_RE, (_, _t, _id, text) => text);
}

const args = process.argv.slice(2);
const [chapterId, patchPath] = args.filter((a) => !a.startsWith('--'));
const glossIdx = args.indexOf('--glossary');
const glossPath = glossIdx >= 0 ? args[glossIdx + 1] : undefined;

if (!chapterId || !patchPath) {
  console.error('usage: tsx tools/apply-annotation.ts <chapterId> <markup.json> [--glossary <fragment.json>]');
  process.exit(1);
}

const chapterPath = join('src', 'content', 'chapters', `${chapterId}.json`);
const chapter = JSON.parse(readFileSync(chapterPath, 'utf-8'));
const patch: Record<string, string[]> = JSON.parse(readFileSync(patchPath, 'utf-8'));

const people = JSON.parse(readFileSync(join('src', 'data', 'works', chapter.workId, 'people.json'), 'utf-8'));
const glossary = JSON.parse(readFileSync(join('src', 'data', 'works', chapter.workId, 'glossary.json'), 'utf-8'));
const fragment: Record<string, any> = glossPath && existsSync(glossPath)
  ? JSON.parse(readFileSync(glossPath, 'utf-8'))
  : {};

const errors: string[] = [];

// 語注フラグメント自体の検査
for (const [id, e] of Object.entries(fragment)) {
  if (!/^[a-z0-9-]+$/.test(id)) errors.push(`glossary fragment: 不正なID "${id}"（英小文字・数字・ハイフンのみ）`);
  if (glossary[id]) errors.push(`glossary fragment: "${id}" は既に glossary.json にある（既存IDをそのまま使い、フラグメントに再定義しない）`);
  if (!e || typeof e.term !== 'string' || !e.term || typeof e.body !== 'string' || !e.body) {
    errors.push(`glossary fragment "${id}": term / body が必要`);
  }
  if (e && e.verified === true) errors.push(`glossary fragment "${id}": 新規注釈を verified: true にしない`);
}

// マークアップの検査ユーティリティ
function checkMarkup(pid: string, fragText: string): void {
  const leftovers = strip(fragText);
  if (leftovers.includes('{{') || leftovers.includes('}}')) {
    errors.push(`${pid}: パースできない {{ }} が残っている: "${leftovers.slice(0, 60)}"`);
  }
  for (const m of fragText.matchAll(MARKUP_RE)) {
    const [, type, id] = m;
    if (type === 'n') {
      if (!glossary[id] && !fragment[id]) errors.push(`${pid}: 語注ID "${id}" が glossary.json にもフラグメントにも無い`);
    } else if (!people[id]) {
      errors.push(`${pid}: 人物ID "${id}" が people.json に無い（{{${type}:${id}|...}}）`);
    }
  }
}

const byId: Record<string, any> = {};
for (const p of chapter.paragraphs) byId[p.id] = p;

let applied = 0;
let annCount = 0;

for (const [pid, frags] of Object.entries(patch)) {
  const para = byId[pid];
  if (!para) {
    errors.push(`${pid}: 章に存在しない段落ID`);
    continue;
  }
  if (para.status !== 'draft') {
    errors.push(`${pid}: status が ${para.status} のため変更不可`);
    continue;
  }
  if (!Array.isArray(frags) || frags.some((f) => typeof f !== 'string')) {
    errors.push(`${pid}: 値は文字列の配列であること`);
    continue;
  }

  const current: string[] = para.segments ? para.segments.map((s: any) => s.ja) : [para.ja];
  if (frags.length !== current.length) {
    errors.push(`${pid}: 断片数が合わない（入力 ${frags.length} / 現行 ${current.length}）`);
    continue;
  }

  let ok = true;
  for (let i = 0; i < frags.length; i++) {
    // 現行側もマークアップを剥がしてから比べる。そうしないと、すでに注釈の付いた
    // 段落に注釈を足す（＝レビューで注釈を見直す）ことが原理的にできなくなる。
    // 保証したいのは「読者に見える本文が変わらないこと」なので、素のテキスト同士で足りる
    if (strip(frags[i]) !== strip(current[i])) {
      ok = false;
      errors.push(
        `${pid}[${i}]: マークアップ除去後のテキストが現行と一致しない\n  現行: ${strip(current[i]).slice(0, 50)}\n  入力: ${strip(frags[i]).slice(0, 50)}`,
      );
    }
    checkMarkup(`${pid}[${i}]`, frags[i]);
  }
  if (!ok) continue;

  const n = [...frags.join('').matchAll(MARKUP_RE)].length;
  if (n === 0) continue; // マークアップ無しの断片は無視（変更なし）

  if (para.segments) {
    for (let i = 0; i < frags.length; i++) para.segments[i].ja = frags[i];
    para.ja = frags.join('');
  } else {
    para.ja = frags[0];
  }
  applied += 1;
  annCount += n;
}

if (errors.length > 0) {
  console.error(`検証エラー ${errors.length} 件:`);
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}

writeFileSync(chapterPath, JSON.stringify(chapter, null, 2) + '\n', 'utf-8');
console.log(
  `${chapterPath}: ${applied} 段落に計 ${annCount} 個の注釈を適用（語注フラグメント ${Object.keys(fragment).length} 件）`,
);
