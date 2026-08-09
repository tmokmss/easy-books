// 階層ズーム・リーダーのデータモデル（docs/ZOOM.md）。
// 章の JSON（src/content/chapters/）は不可侵で、ここは段落IDを「参照するだけ」の別レイヤー。
// 検証ロジックは content.config（ビルド）と tools/（マージ・チェック）の両方から使うため、
// import.meta.glob 等の Vite 依存をこのファイルに持ち込まないこと。

import { tokenize } from './markup';

/** 要約のステータス。draft / machine-checked は UI で「未確認」と表示する */
export const SUMMARY_STATUSES = ['draft', 'machine-checked', 'human-reviewed', 'verified'] as const;
export type SummaryStatus = (typeof SUMMARY_STATUSES)[number];

export interface Summary {
  text: string;
  status: SummaryStatus;
  /**
   * この要約が前提にしてよい既読範囲の終端。
   * 節・章では段落ID、部・作品では "chapterId#pid"。ネタバレ検出の基準線になる。
   */
  coversUpTo?: string | null;
}

export interface SectionOutline {
  /** s1, s2, … 章内で連番。切り直したら振り直してよい（段落IDと違い永続参照ではない） */
  id: string;
  /** 場面の見出し（15字目安）。その節より先の展開を含めない */
  label: string;
  /** [開始段落ID, 終了段落ID]。節は段落を保持せず範囲で指す */
  range: [string, string];
  /** 節の区切りは編集判断。機械提案は proposed、人が承認したら approved */
  boundaryStatus: 'proposed' | 'approved';
  summary?: Summary;
}

/** src/content/outlines/<chapterId>.json */
export interface ChapterOutline {
  workId: string;
  chapterId: string;
  summary?: Summary;
  sections: SectionOutline[];
  paragraphSummaries: Record<string, Summary>;
}

export interface PartOverview {
  id: string;
  label: string;
  /** この部に属する章ID（作品の order 順） */
  chapters: string[];
  summary?: Summary;
}

/** src/content/overviews/<workId>.json */
export interface WorkOverview {
  workId: string;
  /** fiction はネタバレ封じ込めの対象。作品全体の要約を既定では畳む */
  genre: 'fiction' | 'nonfiction';
  summary?: Summary;
  parts: PartOverview[];
}

/**
 * 分量の規定（仕様の核）。ズームアウトで情報量を減らすのではなく粒度を粗くする。
 * target から大きく外れたら check-summaries が警告、cap 超えはマージ・ビルドで落とす。
 */
export const SUMMARY_LENGTH = {
  work: { target: 400, cap: 600 },
  part: { target: 400, cap: 600 },
  chapter: { target: 300, cap: 450 },
  section: { target: 150, cap: 225 },
  paragraph: { target: 40, cap: 60 },
} as const;

export type SummaryLevel = keyof typeof SUMMARY_LENGTH;

/** ja のインラインマークアップを外して素のテキストにする（要約の突き合わせ・字数計算用） */
export function stripMarkup(ja: string): string {
  return tokenize(ja)
    .map((t) => t.text)
    .join('');
}

interface ParagraphRef {
  id: string;
  ja: string;
}

function checkSummaryShape(
  s: Summary,
  level: SummaryLevel,
  where: string,
  expectedCoversUpTo: string | null,
): string[] {
  const errors: string[] = [];
  if (!s.text || s.text.trim() === '') errors.push(`${where}: 要約が空`);
  if (s.text.includes('\n')) errors.push(`${where}: 要約に改行を入れない`);
  if (!SUMMARY_STATUSES.includes(s.status)) errors.push(`${where}: 不正な status "${s.status}"`);
  const cap = SUMMARY_LENGTH[level].cap;
  if (s.text.length > cap) {
    errors.push(`${where}: 要約が長すぎる（${s.text.length}字 > 上限${cap}字）`);
  }
  if (expectedCoversUpTo === null) {
    if (s.coversUpTo != null) errors.push(`${where}: このレベルの要約に coversUpTo は付けない`);
  } else if (s.coversUpTo !== expectedCoversUpTo) {
    errors.push(
      `${where}: coversUpTo が範囲の終端と一致しない（"${s.coversUpTo}" ≠ "${expectedCoversUpTo}"）`,
    );
  }
  return errors;
}

/**
 * 章アウトラインの不変条件。エラーの配列を返す（正常なら空）。
 *   - 節は章の段落を過不足なく連続分割する（節を持たない章は sections: [] でよい）
 *   - すべての段落参照が実在する
 *   - 段落要約は本文より短い（本文より長い要約は作らない＝省略する）
 *   - coversUpTo は範囲の終端と機械的に一致させる
 */
export function validateChapterOutline(
  outline: ChapterOutline,
  chapter: { workId: string; paragraphs: ParagraphRef[] } | undefined,
): string[] {
  const errors: string[] = [];
  if (!chapter) {
    return [`存在しない章: "${outline.chapterId}"`];
  }
  if (outline.workId !== chapter.workId) {
    errors.push(`workId が章と一致しない（"${outline.workId}" ≠ "${chapter.workId}"）`);
  }
  const pids = chapter.paragraphs.map((p) => p.id);
  const index = new Map(pids.map((id, i) => [id, i]));
  const lastPid = pids[pids.length - 1];

  // ---- 節 ----
  if (outline.sections.length > 0) {
    let expectedStart = 0;
    outline.sections.forEach((sec, i) => {
      const where = `節${sec.id}`;
      if (sec.id !== `s${i + 1}`) {
        errors.push(`${where}: 節IDは s1 から連番（${i + 1}番目が "${sec.id}"）`);
      }
      if (!sec.label || sec.label.trim() === '') errors.push(`${where}: label が空`);
      if (sec.label.length > 20) errors.push(`${where}: label は20字以内（${sec.label.length}字）`);
      const [startId, endId] = sec.range;
      const start = index.get(startId);
      const end = index.get(endId);
      if (start === undefined || end === undefined) {
        errors.push(`${where}: 存在しない段落IDを指している（${startId}〜${endId}）`);
        return;
      }
      if (start > end) errors.push(`${where}: 範囲が逆順（${startId} > ${endId}）`);
      if (start !== expectedStart) {
        errors.push(
          `${where}: 節が連続していない（${pids[expectedStart]} から始まるべきところ ${startId}）`,
        );
      }
      expectedStart = end + 1;
      if (sec.summary) errors.push(...checkSummaryShape(sec.summary, 'section', where, endId));
    });
    if (expectedStart !== pids.length) {
      errors.push(`節が章の末尾まで覆っていない（最後の節が ${pids[expectedStart - 1] ?? '?'} まで）`);
    }
  }

  // ---- 章要約 ----
  if (outline.summary) {
    errors.push(...checkSummaryShape(outline.summary, 'chapter', '章要約', lastPid));
  }

  // ---- 段落要約 ----
  for (const [pid, s] of Object.entries(outline.paragraphSummaries)) {
    const i = index.get(pid);
    const where = `段落要約 ${pid}`;
    if (i === undefined) {
      errors.push(`${where}: 存在しない段落ID`);
      continue;
    }
    errors.push(...checkSummaryShape(s, 'paragraph', where, null));
    const plain = stripMarkup(chapter.paragraphs[i].ja);
    if (s.text.length >= plain.length) {
      errors.push(`${where}: 要約（${s.text.length}字）が本文（${plain.length}字）より短くない。省略せよ`);
    }
  }
  return errors;
}

/**
 * 作品概観の不変条件。parts の章リストを連結すると作品の全章と order 順で完全一致すること。
 * 空の階層は存在しないものとして扱う（部を持たない作品は部1つに全章を入れず、そもそも
 * overview を置かなくてよい。置くなら実在の区分だけを書く）。
 */
export function validateWorkOverview(
  overview: WorkOverview,
  chapters: { chapterId: string; lastParagraphId: string }[] | undefined,
): string[] {
  const errors: string[] = [];
  if (!chapters || chapters.length === 0) {
    return [`存在しない作品または章ゼロ: "${overview.workId}"`];
  }
  const listed = overview.parts.flatMap((p) => p.chapters);
  const expected = chapters.map((c) => c.chapterId);
  if (listed.join(',') !== expected.join(',')) {
    errors.push(
      `parts の章リストが作品の全章（order 順）と一致しない。期待: [${expected.join(', ')}] 実際: [${listed.join(', ')}]`,
    );
  }
  const lastOf = new Map(chapters.map((c) => [c.chapterId, c.lastParagraphId]));
  const seen = new Set<string>();
  for (const part of overview.parts) {
    const where = `部 ${part.id}`;
    if (seen.has(part.id)) errors.push(`${where}: id が重複`);
    seen.add(part.id);
    if (!part.label || part.label.trim() === '') errors.push(`${where}: label が空`);
    if (part.chapters.length === 0) {
      errors.push(`${where}: 章ゼロの部を置かない（空の階層は存在しないものとして扱う）`);
      continue;
    }
    const lastChapter = part.chapters[part.chapters.length - 1];
    const lastPid = lastOf.get(lastChapter);
    if (part.summary && lastPid) {
      errors.push(...checkSummaryShape(part.summary, 'part', where, `${lastChapter}#${lastPid}`));
    }
  }
  if (overview.summary) {
    const last = chapters[chapters.length - 1];
    const expectedCovers = `${last.chapterId}#${last.lastParagraphId}`;
    // 作品全体の要約は coversUpTo を持たない（null）ことも許す＝初回は出し分けで隠す前提
    if (overview.summary.coversUpTo != null && overview.summary.coversUpTo !== expectedCovers) {
      errors.push(
        `作品要約: coversUpTo が末尾と一致しない（"${overview.summary.coversUpTo}" ≠ "${expectedCovers}"）`,
      );
    }
    errors.push(
      ...checkSummaryShape(overview.summary, 'work', '作品要約', overview.summary.coversUpTo ?? null),
    );
  }
  return errors;
}
