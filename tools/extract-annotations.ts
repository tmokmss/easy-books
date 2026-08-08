/**
 * 注釈の「候補」を LLM に出させる。台帳への反映は人間がやる。
 * 自動で glossary.json / people.json に書き込まないこと。
 *
 * 使い方: npx tsx tools/extract-annotations.ts <chapterId>
 * 出力:   source/annotations/<chapterId>.candidates.json（レビュー用）
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MODEL = 'claude-opus-5';

const chapterId = process.argv[2];
if (!chapterId) {
  console.error('usage: tsx tools/extract-annotations.ts <chapterId>');
  process.exit(1);
}

const chapter = JSON.parse(
  readFileSync(join('src', 'content', 'chapters', `${chapterId}.json`), 'utf-8'),
);
const people = JSON.parse(
  readFileSync(join('src', 'data', 'works', chapter.workId, 'people.json'), 'utf-8'),
);
const glossary = JSON.parse(
  readFileSync(join('src', 'data', 'works', chapter.workId, 'glossary.json'), 'utf-8'),
);

const schema = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['person', 'term'] },
          paragraphId: { type: 'string', description: '初出の段落ID（p001 形式）' },
          surface: { type: 'string', description: '訳文中の表記' },
          original: { type: 'string', description: '原文中の対応表現' },
          reason: { type: 'string', description: 'なぜ現代の日本語読者に注釈が必要か' },
          draftBody: { type: 'string', description: '語注本文の草案。必ず要検証扱いとする' },
        },
        required: ['kind', 'paragraphId', 'surface', 'original', 'reason', 'draftBody'],
        additionalProperties: false,
      },
    },
  },
  required: ['candidates'],
  additionalProperties: false,
} as const;

const knownTerms = Object.values(glossary)
  .map((g: any) => g.term)
  .join('、');
const knownPeople = Object.values(people)
  .map((p: any) => p.short)
  .join('、');

const paragraphsText = chapter.paragraphs
  .map((p: any) => `[${p.id}]${p.em ? '（原文に強調あり）' : ''}\n原文: ${p.src}\n訳文: ${p.ja}`)
  .join('\n\n');

const client = new Anthropic();

const response = await client.beta.messages.create({
  model: MODEL,
  max_tokens: 16000,
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',
  output_config: { format: { type: 'json_schema', schema } },
  system: `古典文学の読解支援注釈の編集者として、注釈が必要な箇所の候補を挙げる。
対象読者は現代の日本語話者。当時の制度・貨幣・地理・風俗・呼称慣習など、現代の読者が文脈を取り違えやすい箇所を優先する。
本文そのものの解釈や比喩の解説は注釈にしない（読書体験を壊すため）。
原文に強調がある段落は、作者が意味を込めている可能性が高いので注意して見る。

すでに台帳にある項目は候補に挙げない。
既存の語注: ${knownTerms || '（なし）'}
既存の人物: ${knownPeople || '（なし）'}`,
  messages: [{ role: 'user', content: paragraphsText }],
} as any);

if (response.stop_reason === 'refusal') {
  console.error('拒否された:', JSON.stringify((response as any).stop_details));
  process.exit(1);
}

const text = response.content
  .filter((b: any) => b.type === 'text')
  .map((b: any) => b.text)
  .join('');
const result = JSON.parse(text);

const outPath = join('source', 'annotations', `${chapterId}.candidates.json`);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  JSON.stringify(
    {
      chapterId,
      note: 'レビュー用の候補。人間が検証してから people.json / glossary.json に手で反映する。verified は必ず false から始めること。',
      candidates: result.candidates,
    },
    null,
    2,
  ) + '\n',
  'utf-8',
);
console.log(`${outPath}: ${result.candidates.length} 件の候補`);
