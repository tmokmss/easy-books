/**
 * 要約レイヤーの機械ふるい。要約も検証対象である（docs/ZOOM.md）。
 *
 * FAIL（exit 1・昇格を止める）:
 *   - 要約に出てくる人物（people.json の表記・別表記で照合）が、その範囲の本文に登場しない
 *   - 要約に出てくる人物の作品全体での初出が coversUpTo より後 ＝ ネタバレの混入
 * WARN（昇格は止めない）:
 *   - 人物台帳にないカタカナ語・数値が範囲の本文に見当たらない（誤検知が多いので警告どまり）
 *   - 分量が目安から大きく外れている
 *   - メタ言及（「この章では」等）・上位要約にだけ現れる人物（下位要約に無い内容）
 *
 * --promote: FAIL ゼロの draft 要約を machine-checked に昇格して書き戻す。
 *            human-reviewed / verified には触らない。
 *
 * 使い方: npx tsx tools/check-summaries.ts <workId> [chapterId ...] [--promote]
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SUMMARY_LENGTH,
  stripMarkup,
  type ChapterOutline,
  type Summary,
  type SummaryLevel,
  type WorkOverview,
} from '../src/lib/outline';

const args = process.argv.slice(2);
const promote = args.includes('--promote');
const [workId, ...onlyChapters] = args.filter((a) => !a.startsWith('--'));
if (!workId) {
  console.error('usage: tsx tools/check-summaries.ts <workId> [chapterId ...] [--promote]');
  process.exit(1);
}

// ---- 章・本文・人物台帳の読み込み ----

const chaptersDir = join('src', 'content', 'chapters');
const chapters = readdirSync(chaptersDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => {
    const data = JSON.parse(readFileSync(join(chaptersDir, f), 'utf-8'));
    return {
      chapterId: f.replace(/\.json$/, ''),
      workId: data.workId as string,
      order: data.order as number,
      paragraphs: (data.paragraphs as { id: string; ja: string }[]).map((p) => ({
        id: p.id,
        plain: stripMarkup(p.ja),
      })),
    };
  })
  .filter((c) => c.workId === workId)
  .sort((a, b) => a.order - b.order);
if (chapters.length === 0) {
  console.error(`章が見つからない: workId=${workId}`);
  process.exit(1);
}

const chapterIdx = new Map(chapters.map((c, i) => [c.chapterId, i]));
/** 作品全体での通し位置。章順×1e6＋段落順 */
const pos = (chapterId: string, paraIdx: number) => chapterIdx.get(chapterId)! * 1e6 + paraIdx;

interface PersonEntry {
  key: string;
  short: string;
  surfaces: string[];
  firstPos: number;
}
const peoplePath = join('src', 'data', 'works', workId, 'people.json');
const peopleRaw: Record<string, { name: string; short: string; aliases: string[] }> = existsSync(
  peoplePath,
)
  ? JSON.parse(readFileSync(peoplePath, 'utf-8'))
  : {};

const people: PersonEntry[] = Object.entries(peopleRaw).map(([key, p]) => {
  const surfaces = [...new Set([p.name, p.short, ...p.aliases])].filter((s) => s.length >= 2);
  let firstPos = Infinity;
  outer: for (const c of chapters) {
    for (let i = 0; i < c.paragraphs.length; i++) {
      if (surfaces.some((s) => c.paragraphs[i].plain.includes(s))) {
        firstPos = pos(c.chapterId, i);
        break outer;
      }
    }
  }
  return { key, short: p.short, surfaces, firstPos };
});

// ---- 検証対象（要約＋その範囲＋基準線）を集める ----

interface Target {
  where: string;
  level: SummaryLevel;
  summary: Summary;
  rangeText: string;
  /** この要約が前提にしてよい既読範囲の終端（通し位置） */
  coversPos: number;
  /** 下位要約の連結（containment 警告用）。最下層は null */
  childText: string | null;
  fails: string[];
  warns: string[];
}
const targets: Target[] = [];
/** promote の書き戻し対象 */
const files: { path: string; data: ChapterOutline | WorkOverview }[] = [];

const chapterOutlineOf = new Map<string, ChapterOutline>();
for (const c of chapters) {
  if (onlyChapters.length > 0 && !onlyChapters.includes(c.chapterId)) continue;
  const path = join('src', 'content', 'outlines', `${c.chapterId}.json`);
  if (!existsSync(path)) continue;
  const outline = JSON.parse(readFileSync(path, 'utf-8')) as ChapterOutline;
  chapterOutlineOf.set(c.chapterId, outline);
  files.push({ path, data: outline });

  const idxOf = new Map(c.paragraphs.map((p, i) => [p.id, i]));
  const plainOf = (start: number, end: number) =>
    c.paragraphs
      .slice(start, end + 1)
      .map((p) => p.plain)
      .join('\n');

  for (const sec of outline.sections) {
    if (!sec.summary) continue;
    const [s, e] = [idxOf.get(sec.range[0])!, idxOf.get(sec.range[1])!];
    targets.push({
      where: `${c.chapterId} 節${sec.id}「${sec.label}」`,
      level: 'section',
      summary: sec.summary,
      rangeText: plainOf(s, e),
      coversPos: pos(c.chapterId, e),
      childText: null,
      fails: [],
      warns: [],
    });
  }
  if (outline.summary) {
    targets.push({
      where: `${c.chapterId} 章要約`,
      level: 'chapter',
      summary: outline.summary,
      rangeText: plainOf(0, c.paragraphs.length - 1),
      coversPos: pos(c.chapterId, c.paragraphs.length - 1),
      childText:
        outline.sections.length > 0 && outline.sections.every((s) => s.summary)
          ? outline.sections.map((s) => `${s.label} ${s.summary!.text}`).join('\n')
          : null,
      fails: [],
      warns: [],
    });
  }
  for (const [pid, summary] of Object.entries(outline.paragraphSummaries)) {
    const i = idxOf.get(pid)!;
    targets.push({
      where: `${c.chapterId} 段落要約 ${pid}`,
      level: 'paragraph',
      summary,
      rangeText: c.paragraphs[i].plain,
      coversPos: pos(c.chapterId, i),
      childText: null,
      fails: [],
      warns: [],
    });
  }
}

const overviewPath = join('src', 'content', 'overviews', `${workId}.json`);
if (onlyChapters.length === 0 && existsSync(overviewPath)) {
  const overview = JSON.parse(readFileSync(overviewPath, 'utf-8')) as WorkOverview;
  files.push({ path: overviewPath, data: overview });
  const textOfChapters = (ids: string[]) =>
    ids
      .map((id) => chapters[chapterIdx.get(id)!].paragraphs.map((p) => p.plain).join('\n'))
      .join('\n');
  const summariesOfChapters = (ids: string[]) => {
    const texts = ids.map((id) => chapterOutlineOf.get(id)?.summary?.text).filter(Boolean);
    return texts.length === ids.length ? texts.join('\n') : null;
  };
  for (const part of overview.parts) {
    if (!part.summary) continue;
    const lastChapter = chapters[chapterIdx.get(part.chapters[part.chapters.length - 1])!];
    targets.push({
      where: `${part.id}（${part.label}）要約`,
      level: 'part',
      summary: part.summary,
      rangeText: textOfChapters(part.chapters),
      coversPos: pos(lastChapter.chapterId, lastChapter.paragraphs.length - 1),
      childText: summariesOfChapters(part.chapters),
      fails: [],
      warns: [],
    });
  }
  if (overview.summary) {
    const last = chapters[chapters.length - 1];
    targets.push({
      where: '作品要約',
      level: 'work',
      summary: overview.summary,
      rangeText: textOfChapters(chapters.map((c) => c.chapterId)),
      coversPos: pos(last.chapterId, last.paragraphs.length - 1),
      childText: overview.parts.every((p) => p.summary)
        ? overview.parts.map((p) => p.summary!.text).join('\n')
        : null,
      fails: [],
      warns: [],
    });
  }
}

// ---- チェック本体 ----

const META_PHRASES = ['この章', 'この節', 'この段落', '本章', '本節', '後述'];
const posLabel = (p: number) => {
  const c = chapters[Math.floor(p / 1e6)];
  return `${c.chapterId}#${c.paragraphs[p % 1e6].id}`;
};

for (const t of targets) {
  const text = t.summary.text;

  // 人物: 初出が coversUpTo より後 ＝ ネタバレ（FAIL）。
  // 既出だが範囲外 ＝ 前の章への言及かもしれないので WARN（人が判断する）
  const mentioned = people.filter((p) => p.surfaces.some((s) => text.includes(s)));
  for (const p of mentioned) {
    if (p.firstPos > t.coversPos) {
      t.fails.push(
        `ネタバレ: 「${p.short}」の初出（${
          p.firstPos === Infinity ? '本文に登場しない' : posLabel(p.firstPos)
        }）が coversUpTo より後`,
      );
    } else if (!p.surfaces.some((s) => t.rangeText.includes(s))) {
      t.warns.push(`範囲の本文に登場しない人物「${p.short}」（既出の人物への言及なら可）`);
    }
  }

  // 台帳外のカタカナ語・数値（警告どまり。誤検知が多い）
  let residue = text;
  for (const p of mentioned) for (const s of p.surfaces) residue = residue.replaceAll(s, ' ');
  for (const m of residue.match(/[ァ-ヴー]{3,}/g) ?? []) {
    if (!t.rangeText.includes(m)) t.warns.push(`範囲の本文にないカタカナ語「${m}」`);
  }
  for (const m of text.match(/[0-9０-９]+|[一二三四五六七八九十百千万]+[歳年月日時人階]/g) ?? []) {
    if (!t.rangeText.includes(m)) t.warns.push(`範囲の本文にない数値「${m}」`);
  }

  // 分量: 縮尺一定の原則。目安から大きく外れたら警告
  const { target: len } = SUMMARY_LENGTH[t.level];
  if (text.length > len * 1.5) t.warns.push(`長すぎる（${text.length}字、目安${len}字）`);
  if (t.level !== 'paragraph' && text.length < len * 0.4)
    t.warns.push(`短すぎる（${text.length}字、目安${len}字）`);

  for (const phrase of META_PHRASES) {
    if (text.includes(phrase)) t.warns.push(`メタ言及「${phrase}」`);
  }

  // 下位要約に無い内容が上位要約に出ていないか（人物ベースの近似・警告どまり）
  if (t.childText) {
    for (const p of mentioned) {
      if (!p.surfaces.some((s) => t.childText!.includes(s))) {
        t.warns.push(`下位要約に現れない人物「${p.short}」`);
      }
    }
  }
}

// ---- 報告と昇格 ----

let failCount = 0;
let warnCount = 0;
let promoted = 0;
for (const t of targets) {
  for (const f of t.fails) console.error(`FAIL ${t.where}: ${f}`);
  for (const w of t.warns) console.warn(`warn ${t.where}: ${w}`);
  failCount += t.fails.length;
  warnCount += t.warns.length;
  if (promote && t.fails.length === 0 && t.summary.status === 'draft') {
    t.summary.status = 'machine-checked';
    promoted += 1;
  }
}

if (promote && promoted > 0) {
  for (const f of files) writeFileSync(f.path, JSON.stringify(f.data, null, 2) + '\n');
  console.log(`${promoted} 件を machine-checked に昇格`);
}
console.log(
  `検査 ${targets.length} 件: FAIL ${failCount} / warn ${warnCount}${promote ? '' : '（--promote で昇格）'}`,
);
if (failCount > 0) process.exit(1);
