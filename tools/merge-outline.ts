/**
 * 章アウトライン（節区切り＋要約）のエージェント出力を検証して
 * src/content/outlines/<chapterId>.json を生成・更新する。LLMは呼ばない。
 *
 * 入力JSON（LLMが生成。本文テキストは含まない）:
 *   {
 *     "sections": [ { "label": "見出し", "range": ["p001", "p007"], "summary": "150字目安" } ],
 *     "chapterSummary": "300字目安",
 *     "paragraphSummaries": { "p001": "40字目安", ... }
 *   }
 *
 * このツールが機械的に決めること（エージェントに任せない）:
 *   - 節ID（s1 から連番）と boundaryStatus: "proposed"
 *   - すべての要約の status: "draft"
 *   - coversUpTo（＝範囲の終端。ネタバレ検出の基準線）
 * 保護: 既存の human-reviewed / verified の要約と approved の節区切りは上書きしない。
 *
 * 使い方: npx tsx tools/merge-outline.ts <chapterId> <candidate.json>
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  SUMMARY_LENGTH,
  stripMarkup,
  validateChapterOutline,
  type ChapterOutline,
  type SectionOutline,
  type Summary,
} from '../src/lib/outline';

const [chapterId, candidatePath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!chapterId || !candidatePath) {
  console.error('usage: tsx tools/merge-outline.ts <chapterId> <candidate.json>');
  process.exit(1);
}

interface Candidate {
  sections: { label: string; range: [string, string]; summary?: string }[];
  chapterSummary?: string;
  paragraphSummaries?: Record<string, string>;
}

const chapterPath = join('src', 'content', 'chapters', `${chapterId}.json`);
if (!existsSync(chapterPath)) {
  console.error(`存在しない章: ${chapterId}`);
  process.exit(1);
}
const chapter = JSON.parse(readFileSync(chapterPath, 'utf-8')) as {
  workId: string;
  paragraphs: { id: string; ja: string }[];
};
const candidate = JSON.parse(readFileSync(candidatePath, 'utf-8')) as Candidate;

const outPath = join('src', 'content', 'outlines', `${chapterId}.json`);
const prior: ChapterOutline | undefined = existsSync(outPath)
  ? JSON.parse(readFileSync(outPath, 'utf-8'))
  : undefined;

const errors: string[] = [];
const warnings: string[] = [];

// ---- 保護: 人が確認済みの内容を機械が壊さない ----

const protectedSummary = (s?: Summary) =>
  s && (s.status === 'human-reviewed' || s.status === 'verified');

const priorSectionByRange = new Map<string, SectionOutline>();
for (const sec of prior?.sections ?? []) {
  priorSectionByRange.set(sec.range.join('..'), sec);
}
// 承認済みの節区切りが、新しい提案に同一範囲で残っていなければ上書きを拒む
for (const sec of prior?.sections ?? []) {
  if (sec.boundaryStatus !== 'approved') continue;
  const match = (candidate.sections ?? []).some((c) => c.range.join('..') === sec.range.join('..'));
  if (!match) {
    errors.push(
      `承認済みの節 ${sec.id}（${sec.range.join('〜')}）が新しい区切り案に存在しない。承認済み区切りの変更は手で行うこと`,
    );
  }
}

// ---- 組み立て: ID・status・coversUpTo はここで機械的に決める ----

const draft = (text: string, coversUpTo?: string): Summary =>
  coversUpTo === undefined
    ? { text: text.trim(), status: 'draft' }
    : { text: text.trim(), status: 'draft', coversUpTo };

const sections: SectionOutline[] = (candidate.sections ?? []).map((c, i) => {
  const priorSec = priorSectionByRange.get(c.range.join('..'));
  const summary = protectedSummary(priorSec?.summary)
    ? priorSec!.summary
    : c.summary
      ? draft(c.summary, c.range[1])
      : priorSec?.summary;
  return {
    id: `s${i + 1}`,
    label: c.label?.trim() ?? '',
    range: c.range,
    boundaryStatus: priorSec?.boundaryStatus ?? 'proposed',
    ...(summary ? { summary } : {}),
  };
});

const lastPid = chapter.paragraphs[chapter.paragraphs.length - 1]?.id;
const chapterSummary = protectedSummary(prior?.summary)
  ? prior!.summary
  : candidate.chapterSummary
    ? draft(candidate.chapterSummary, lastPid)
    : prior?.summary;

const paragraphSummaries: Record<string, Summary> = {};
const paraIndex = new Map(chapter.paragraphs.map((p) => [p.id, p]));
for (const [pid, s] of Object.entries(prior?.paragraphSummaries ?? {})) {
  if (protectedSummary(s)) paragraphSummaries[pid] = s;
}
for (const [pid, text] of Object.entries(candidate.paragraphSummaries ?? {})) {
  if (protectedSummary(paragraphSummaries[pid])) continue;
  const para = paraIndex.get(pid);
  if (para && text.trim().length >= stripMarkup(para.ja).length) {
    // 本文より長い要約は作らない（仕様）。エラーにせず落とすだけにすると
    // エージェントが気づかないので、明示的に直させる
    errors.push(`段落要約 ${pid}: 要約（${text.trim().length}字）が本文より短くない。この段落の要約は省け`);
    continue;
  }
  paragraphSummaries[pid] = draft(text);
}

const outline: ChapterOutline = {
  workId: chapter.workId,
  chapterId,
  ...(chapterSummary ? { summary: chapterSummary } : {}),
  sections,
  paragraphSummaries,
};

// ---- 検証 ----

errors.push(...validateChapterOutline(outline, chapter));

// 分量とバランスの警告（マージは通す。check-summaries でも再警告される）
for (const sec of sections) {
  const size =
    chapter.paragraphs.findIndex((p) => p.id === sec.range[1]) -
    chapter.paragraphs.findIndex((p) => p.id === sec.range[0]) +
    1;
  if (size < 4 || size > 18) {
    warnings.push(`節${sec.id}「${sec.label}」: ${size}段落（目安は5〜15）`);
  }
  if (sec.summary && sec.summary.text.length < SUMMARY_LENGTH.section.target * 0.4) {
    warnings.push(`節${sec.id}: 要約が短い（${sec.summary.text.length}字、目安${SUMMARY_LENGTH.section.target}字）`);
  }
}
if (chapterSummary && chapterSummary.text.length < SUMMARY_LENGTH.chapter.target * 0.5) {
  warnings.push(`章要約が短い（${chapterSummary.text.length}字、目安${SUMMARY_LENGTH.chapter.target}字）`);
}
const longWithout = chapter.paragraphs.filter(
  (p) => stripMarkup(p.ja).length >= 200 && !paragraphSummaries[p.id],
).length;
if (longWithout > 0) {
  warnings.push(`200字以上なのに要約がない段落が ${longWithout} 件（意図的な省略なら問題ない）`);
}

for (const w of warnings) console.warn(`warn: ${w}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`error: ${e}`);
  console.error(`\n${errors.length} 件のエラー。${outPath} は更新していない`);
  process.exit(1);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(outline, null, 2) + '\n');
console.log(
  `${outPath} を更新: 節 ${sections.length}、章要約 ${chapterSummary ? 1 : 0}、段落要約 ${Object.keys(paragraphSummaries).length}`,
);
