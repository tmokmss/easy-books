// 章 JSON への読み取り専用インデックス。アウトライン（要約レイヤー）の参照検証と
// 構造ビュー・位置バーの組み立てに使う。import.meta.glob を使うので Vite の外
//（tools/ の tsx 実行）からは import しないこと。tools は fs で直接読む。

import { stripMarkup } from './outline';

interface ChapterJson {
  workId: string;
  chapterLabel: string;
  order: number;
  paragraphs: { id: string; ja: string }[];
}

const chapterFiles = import.meta.glob<ChapterJson>('../content/chapters/*.json', {
  eager: true,
  import: 'default',
});

export interface ChapterIndexEntry {
  chapterId: string;
  workId: string;
  label: string;
  order: number;
  /** ja はマークアップを外した素のテキスト */
  paragraphs: { id: string; ja: string }[];
}

const byId = new Map<string, ChapterIndexEntry>();
for (const [path, data] of Object.entries(chapterFiles)) {
  const m = path.match(/([^/]+)\.json$/);
  if (!m) continue;
  byId.set(m[1], {
    chapterId: m[1],
    workId: data.workId,
    label: data.chapterLabel,
    order: data.order,
    paragraphs: data.paragraphs.map((p) => ({ id: p.id, ja: stripMarkup(p.ja) })),
  });
}

export function getChapterIndex(chapterId: string): ChapterIndexEntry | undefined {
  return byId.get(chapterId);
}

/** 作品の全章を order 順で返す */
export function listWorkChapters(workId: string): ChapterIndexEntry[] {
  return [...byId.values()]
    .filter((c) => c.workId === workId)
    .sort((a, b) => a.order - b.order);
}
