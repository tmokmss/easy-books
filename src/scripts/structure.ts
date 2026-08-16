// 構造ビューの既読率表示。localStorage の既読データ（progress.ts が記録）を
// 章・部ごとに集計してメーターに描く。サーバ側は器だけ作り、ここで塗る。

import { paintMeter } from './meter';
import { loadRead, readCount } from './read-store';

interface StructureData {
  workId: string;
  chapters: { id: string; count: number }[];
}

export function initStructure(): void {
  const dataEl = document.getElementById('structure-data');
  if (!dataEl) return;
  const data: StructureData = JSON.parse(dataEl.textContent ?? '{}');
  const read = loadRead(data.workId);
  const countOf = new Map(data.chapters.map((c) => [c.id, c.count]));

  for (const el of document.querySelectorAll<HTMLElement>('.meter[data-ch]')) {
    const id = el.dataset.ch!;
    paintMeter(el, readCount(read, id), countOf.get(id) ?? 0);
  }

  for (const el of document.querySelectorAll<HTMLElement>('.meter[data-chapters]')) {
    const ids = (el.dataset.chapters ?? '').split(' ').filter(Boolean);
    const total = ids.reduce((n, id) => n + (countOf.get(id) ?? 0), 0);
    const done = ids.reduce((n, id) => n + readCount(read, id), 0);
    paintMeter(el, done, total);
  }
}
