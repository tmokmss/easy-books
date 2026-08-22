import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { validateParagraphMarkup } from './lib/markup';
import { getWorkData, listWorkIds } from './lib/works';
import { getChapterIndex, listWorkChapters } from './lib/chapter-index';
import {
  SUMMARY_STATUSES,
  validateChapterOutline,
  validateWorkOverview,
  type ChapterOutline,
  type WorkOverview,
} from './lib/outline';

// 記法違反・存在しないID参照はここでビルドを落とす。
// {{p:raskolnikov|…}} のようなタイプミスが本番で無言のまま素通りするのを防ぐ。
const chapters = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/chapters' }),
  schema: z
    .object({
      workId: z.string(),
      chapterLabel: z.string(),
      /** 作品内の並び順 */
      order: z.number().int().nonnegative(),
      /** 原文の取得元（再現性のための記録） */
      sourceUrl: z.string().optional(),
      sourceRevId: z.number().optional(),
      paragraphs: z
        .array(
          z.object({
            // 段落IDは一度振ったら変えない。読書位置と注釈の参照先になる。
            id: z.string().regex(/^p\d{3,}$/, '段落IDは p001 形式'),
            src: z.string().min(1),
            ja: z.string().min(1),
            status: z.enum(['draft', 'checked', 'reviewed']),
            em: z.boolean().optional(),
            /** draft を生成したモデル等のラベル（モデル比較の記録用） */
            translatedBy: z.string().optional(),
            /** 文単位の対訳対応（tools/align-segments.ts が生成）。連結不変条件は下で検証 */
            segments: z
              .array(z.object({ src: z.string().min(1), ja: z.string().min(1) }))
              .min(1)
              .optional(),
          }),
        )
        .min(1),
    })
    .superRefine((chapter, ctx) => {
      if (!listWorkIds().includes(chapter.workId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `works.json に存在しない workId: "${chapter.workId}"`,
        });
        return;
      }
      const { people, glossary } = getWorkData(chapter.workId);
      const seen = new Set<string>();
      for (const p of chapter.paragraphs) {
        if (seen.has(p.id)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `段落IDが重複: ${p.id}` });
        }
        seen.add(p.id);
        for (const err of validateParagraphMarkup(p.ja, people, glossary)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `[${p.id}] ${err}` });
        }
        // 対訳セグメントの連結不変条件: ずれた対応表を本番に出さない
        if (p.segments) {
          const joinedJa = p.segments.map((s) => s.ja).join('');
          if (joinedJa !== p.ja) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `[${p.id}] segments の ja を連結しても段落の ja と一致しない`,
            });
          }
          // 空白は言語ごとに扱いが違う（欧文は文の区切り、中日は原文に無い）。
          // 文字の欠落・重複を捕まえるのが目的なので、比較では空白を落とす。
          const norm = (s: string) => s.replace(/\s+/g, '');
          const joinedSrc = norm(p.segments.map((s) => s.src).join(' '));
          if (joinedSrc !== norm(p.src)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `[${p.id}] segments の src を連結しても段落の src と一致しない`,
            });
          }
        }
      }
    }),
});

// ---- 階層ズーム・リーダーの要約レイヤー（docs/ZOOM.md）----
// 段落IDへの参照が1つでも切れていたらビルドを落とす。実行時エラーにすると本番で無言のまま壊れる。

const summarySchema = z.object({
  text: z.string().min(1),
  status: z.enum(SUMMARY_STATUSES),
  coversUpTo: z.string().nullable().optional(),
});

const outlines = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/outlines' }),
  schema: z
    .object({
      workId: z.string(),
      chapterId: z.string(),
      summary: summarySchema.optional(),
      sections: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          range: z.tuple([z.string(), z.string()]),
          boundaryStatus: z.enum(['proposed', 'approved']),
          summary: summarySchema.optional(),
        }),
      ),
      paragraphSummaries: z.record(z.string(), summarySchema),
    })
    .superRefine((outline, ctx) => {
      for (const msg of validateChapterOutline(
        outline as ChapterOutline,
        getChapterIndex(outline.chapterId),
      )) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `[${outline.chapterId}] ${msg}` });
      }
    }),
});

const overviews = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/overviews' }),
  schema: z
    .object({
      workId: z.string(),
      genre: z.enum(['fiction', 'nonfiction']),
      summary: summarySchema.optional(),
      parts: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          chapters: z.array(z.string()),
          summary: summarySchema.optional(),
        }),
      ),
    })
    .superRefine((overview, ctx) => {
      const chapters = listWorkChapters(overview.workId).map((c) => ({
        chapterId: c.chapterId,
        lastParagraphId: c.paragraphs[c.paragraphs.length - 1]?.id ?? '',
      }));
      for (const msg of validateWorkOverview(overview as WorkOverview, chapters)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `[${overview.workId}] ${msg}` });
      }
    }),
});

export const collections = { chapters, outlines, overviews };
