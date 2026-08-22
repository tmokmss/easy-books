import type { GlossaryEntry, Person, WorkData, WorkMeta } from './types';
import worksCatalog from '../data/works.json';

// 作品を追加したら src/data/works.json に1エントリ足し、
// src/data/works/<workId>/{people,glossary,style-guide}.json を置くだけでよい。
const peopleFiles = import.meta.glob<Record<string, Person>>('../data/works/*/people.json', {
  eager: true,
  import: 'default',
});
const glossaryFiles = import.meta.glob<Record<string, GlossaryEntry>>(
  '../data/works/*/glossary.json',
  { eager: true, import: 'default' },
);

function workIdFromPath(path: string): string {
  const m = path.match(/works\/([^/]+)\//);
  if (!m) throw new Error(`works/ 配下でないパス: ${path}`);
  return m[1];
}

const catalog = worksCatalog as Record<string, WorkMeta>;

const peopleByWork: Record<string, Record<string, Person>> = {};
for (const [path, data] of Object.entries(peopleFiles)) {
  peopleByWork[workIdFromPath(path)] = data;
}

const glossaryByWork: Record<string, Record<string, GlossaryEntry>> = {};
for (const [path, data] of Object.entries(glossaryFiles)) {
  glossaryByWork[workIdFromPath(path)] = data;
}

export function listWorkIds(): string[] {
  return Object.keys(catalog);
}

const LANG_LABELS: Record<string, string> = {
  ru: 'ロシア語',
  de: 'ドイツ語',
  en: '英語',
  fr: 'フランス語',
  it: 'イタリア語',
  zh: '中国語',
  es: 'スペイン語',
  ja: '日本語',
};

/** 原語の表示名。未登録の言語コードはそのまま大文字で出す */
export function langLabel(code: string): string {
  return LANG_LABELS[code] ?? code.toUpperCase();
}

export function getWorkData(workId: string): WorkData {
  const meta = catalog[workId];
  if (!meta) {
    throw new Error(
      `works.json に存在しない workId: "${workId}"（登録済み: ${Object.keys(catalog).join(', ')}）`,
    );
  }
  return {
    id: workId,
    meta,
    people: peopleByWork[workId] ?? {},
    glossary: glossaryByWork[workId] ?? {},
  };
}
