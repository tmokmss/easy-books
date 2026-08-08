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
      }
    }),
});

export const collections = { chapters };
