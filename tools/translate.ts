/**
 * 段落単位の翻訳パイプライン。オフラインで手動実行し、生成結果は必ず git にコミットする。
 * `npm run build` の中で呼ばないこと（ビルドのたびに訳文が変わり、差分レビューが成立しなくなる）。
 *
 * 使い方:
 *   ANTHROPIC_API_KEY を設定（または `ant auth login` 済み）の上で
 *   npx tsx tools/translate.ts <chapterId> [--limit N] [--force]
 *
 *   --limit N : 未翻訳のうち先頭 N 段落だけ翻訳する（コスト計測用）
 *   --force   : 既存の draft 段落も訳し直す（checked / reviewed には触らない）
 *
 * 入力:  source/paragraphs/<chapterId>.src.json（コンバータの出力）
 * 出力:  src/content/chapters/<chapterId>.json（既存の訳があればマージ）
 *
 * プロンプトには毎回、style-guide.json・people.json の表記一覧・直前3段落の訳を同梱する。
 * 分割生成する以上、これがないと章をまたいで文体が崩れる。
 * 注釈マークアップ（{{p:...}} 等）はここでは付けない。注釈付けはレビュー工程で行う。
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MODEL = 'claude-opus-5';

interface SkeletonParagraph {
  id: string;
  src: string;
  ja: string;
  status: 'draft' | 'checked' | 'reviewed';
  em?: boolean;
}

const args = process.argv.slice(2);
const chapterId = args.find((a) => !a.startsWith('--'));
const force = args.includes('--force');
const limitArg = args.indexOf('--limit');
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;

if (!chapterId) {
  console.error('usage: tsx tools/translate.ts <chapterId> [--limit N] [--force]');
  process.exit(1);
}

const skeletonPath = join('source', 'paragraphs', `${chapterId}.src.json`);
const chapterPath = join('src', 'content', 'chapters', `${chapterId}.json`);

const skeleton = JSON.parse(readFileSync(skeletonPath, 'utf-8'));
const workId: string = skeleton.workId;

const works = JSON.parse(readFileSync(join('src', 'data', 'works.json'), 'utf-8'));
const work = works[workId];
const styleGuide = readFileSync(join('src', 'data', 'works', workId, 'style-guide.json'), 'utf-8');
const people = JSON.parse(
  readFileSync(join('src', 'data', 'works', workId, 'people.json'), 'utf-8'),
);

// 既存の章ファイルとマージ（checked / reviewed は絶対に上書きしない）
const existing: Record<string, SkeletonParagraph> = {};
if (existsSync(chapterPath)) {
  const current = JSON.parse(readFileSync(chapterPath, 'utf-8'));
  for (const p of current.paragraphs as SkeletonParagraph[]) existing[p.id] = p;
}

const peopleNotation = Object.values(people)
  .map((p: any) => `- ${p.name}（通常表記: ${p.short}／別表記: ${(p.aliases ?? []).join('、')}）`)
  .join('\n');

const system: Anthropic.TextBlockParam[] = [
  {
    type: 'text',
    text: `あなたは${work.author}『${work.title}』の翻訳者である。パブリックドメインの原文から、現代日本語への新訳を作る。

# 絶対条件
- 既存の日本語訳（米川・工藤・江川ほか）の訳文を参照・流用しない。原文からのみ訳す。
- 段落は必ず1対1で対応させる。訳し落とし・要約・平易化をしない。長い独白や意図的な冗長さは原文のまま保つ。
- 出力は訳文のみ。解説・注釈・前置きを付けない。

# 訳文スタイルガイド（style-guide.json）
${styleGuide}

# 人物の表記一覧（この表記に必ず従う）
${peopleNotation}`,
    // 章内の全段落で同一のプレフィックスになるためキャッシュする
    cache_control: { type: 'ephemeral' },
  },
];

const client = new Anthropic();

async function translateParagraph(
  src: string,
  context: { src: string; ja: string }[],
): Promise<string> {
  const contextText =
    context.length > 0
      ? `# 直前の段落の確定訳（文体の連続性の参考。訳し直さないこと）\n${context
          .map((c) => `【原文】${c.src}\n【訳文】${c.ja}`)
          .join('\n\n')}\n\n`
      : '';

  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    // 安全分類器の誤検知で拒否された場合はサーバー側で自動フォールバックする
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages: [
      {
        role: 'user',
        content: `${contextText}# 次の段落を訳せ\n${src}`,
      },
    ],
  } as any);

  const response = await stream.finalMessage();
  if (response.stop_reason === 'refusal') {
    throw new Error(`拒否された（フォールバック含め全滅）: ${JSON.stringify(response.stop_details)}`);
  }
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  if (!text) throw new Error('空の応答');
  return text;
}

const startedAt = Date.now();
const output: SkeletonParagraph[] = [];
let translated = 0;

for (const p of skeleton.paragraphs as SkeletonParagraph[]) {
  const prior = existing[p.id];
  const keep =
    prior && prior.ja && (prior.status !== 'draft' || !force);
  if (keep) {
    output.push(prior);
    continue;
  }
  if (translated >= limit) break;

  const context = output.slice(-3).filter((c) => c.ja);
  process.stdout.write(`${p.id} を翻訳中...`);
  const ja = await translateParagraph(p.src, context.map((c) => ({ src: c.src, ja: c.ja })));
  const out: SkeletonParagraph = { id: p.id, src: p.src, ja, status: 'draft' };
  if (p.em) out.em = true;
  output.push(out);
  translated += 1;
  console.log(` 完了（${ja.length}字）`);
}

const chapter = {
  workId,
  chapterLabel: skeleton.chapterLabel,
  order: skeleton.order,
  sourceUrl: skeleton.sourceUrl,
  sourceRevId: skeleton.sourceRevId,
  paragraphs: output,
};
writeFileSync(chapterPath, JSON.stringify(chapter, null, 2) + '\n', 'utf-8');

const minutes = ((Date.now() - startedAt) / 60000).toFixed(1);
console.log(
  `\n${chapterPath}: ${output.length}/${skeleton.paragraphs.length} 段落（今回 ${translated} 段落を翻訳、${minutes}分）`,
);
console.log('M3の見積もりのため、レビュー込みの実測時間を記録すること。');
