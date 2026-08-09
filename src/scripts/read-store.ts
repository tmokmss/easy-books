// 既読管理のストア（localStorage、段落単位）。
// 「画面に一定時間表示された段落」だけを既読にする。スクロールで飛ばした分は数えない。
// 要約を読んでも既読フラグは立てない（要約は本文の代替ではない）。

const KEY_PREFIX = 'ecb:read:';

/** chapterId → 既読段落の章内 index（0始まり、昇順とは限らない） */
export type ReadMap = Record<string, number[]>;

export function loadRead(workId: string): ReadMap {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY_PREFIX + workId) ?? '{}');
    return typeof raw === 'object' && raw !== null ? (raw as ReadMap) : {};
  } catch {
    return {};
  }
}

export function saveRead(workId: string, map: ReadMap): void {
  try {
    localStorage.setItem(KEY_PREFIX + workId, JSON.stringify(map));
  } catch {
    /* 保存できなくても読書は続けられる */
  }
}

/** 新規に既読になったら true */
export function markRead(map: ReadMap, chapterId: string, index: number): boolean {
  const arr = (map[chapterId] ??= []);
  if (arr.includes(index)) return false;
  arr.push(index);
  return true;
}

export function readCount(map: ReadMap, chapterId: string): number {
  return map[chapterId]?.length ?? 0;
}
