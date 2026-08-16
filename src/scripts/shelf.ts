// 書棚（トップページ）の既読表示。
// 作品ごとに既読率メーターを塗り、読みかけの本は「本文を読む」を
// 「続きから読む（章名）」に差し替える。読書位置は既読データから導く
// （最初の未読了章＝続きの位置）ので、専用の保存は増やさない。

import { paintMeter } from './meter';
import { loadRead, readCount } from './read-store';

interface ShelfData {
  works: { id: string; chapters: { id: string; label: string; count: number }[] }[];
}

export function initShelf(): void {
  const dataEl = document.getElementById('shelf-data');
  if (!dataEl) return;
  const data: ShelfData = JSON.parse(dataEl.textContent ?? '{}');
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');

  for (const work of data.works) {
    const read = loadRead(work.id);
    const total = work.chapters.reduce((n, c) => n + c.count, 0);
    const done = work.chapters.reduce((n, c) => n + readCount(read, c.id), 0);
    if (done === 0) continue;

    const meter = document.querySelector<HTMLElement>(`.meter[data-work="${work.id}"]`);
    if (meter) {
      paintMeter(meter, done, total);
      meter.hidden = false;
    }

    // 続きの位置 = 最初の読み終えていない章（全部読み終えていれば最終章）
    const next = work.chapters.find((c) => readCount(read, c.id) < c.count) ?? work.chapters.at(-1)!;
    const link = document.querySelector<HTMLAnchorElement>(`.read-btn[data-work="${work.id}"]`);
    if (!link) continue;
    link.href = `${base}/read/${next.id}/`;
    const main = link.querySelector<HTMLElement>('.read-btn-main');
    const sub = link.querySelector<HTMLElement>('.read-btn-sub');
    if (main) main.textContent = '続きから読む';
    if (sub && work.chapters.length > 1) sub.textContent = next.label;
  }
}
