import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { validateParagraphMarkup } from './lib/markup';
import { getWorkData, listWorkIds } from './lib/works';

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
          const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
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

export const collections = { chapters };
