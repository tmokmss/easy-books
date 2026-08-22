/** 作品カタログ（src/data/works.json）の1エントリ */
export interface WorkMeta {
  /** 表示タイトル（例: 罪と罰） */
  title: string;
  /** 著者の日本語表記 */
  author: string;
  /** 原語での著者表記 */
  authorOriginal?: string;
  /** 原文の言語コード（ru, en, fr, ...）。ツール・言語ラベルの切り替えに使う */
  sourceLang: string;
  /**
   * 表示用の BCP 47 タグ。字体まで指定したいときだけ書く（中国語の繁体＝zh-Hant 等）。
   * 省略時は sourceLang をそのまま lang 属性にする
   */
  sourceLangTag?: string;
  /** 原語でのタイトル */
  sourceTitle?: string;
  /** 底本の書誌情報。フッターに表示する */
  sourceRef: string;
  /**
   * 書棚（トップ）に出す1行紹介。何の本かが分かる程度の導入だけを書き、
   * 展開・結末には触れない（要約レイヤーのネタバレ封じ込めと同じ方針）。
   */
  blurb?: string;
}

/** 人物台帳（people.json）の1エントリ。aliases は手で管理する */
export interface Person {
  /** 正式名（例: ロジオン・ロマーノヴィチ・ラスコーリニコフ） */
  name: string;
  /** 通常表記（例: ラスコーリニコフ）。これと一致する表示にはグロスを出さない */
  short: string;
  /** 原語表記（キリル文字など） */
  original?: string;
  /** 愛称・父称形などの別表記 */
  aliases: string[];
  /** 立場 */
  role: string;
  /** 関係 */
  rel?: string;
  /** 呼び分けの補足 */
  hint?: string;
  /** 初出（chapterId#paragraphId） */
  firstAppearance?: string;
}

/** 語注台帳（glossary.json）の1エントリ */
export interface GlossaryEntry {
  term: string;
  body: string;
  sources: string[];
  /** false のものは UI に「未検証」と表示する */
  verified: boolean;
}

export type ParagraphStatus = 'draft' | 'checked' | 'reviewed';

export interface Paragraph {
  /** 一度振ったら変えない。読書位置と注釈の参照先になる */
  id: string;
  /** 原文。v1 では表示しないが突き合わせのために必ず持つ */
  src: string;
  ja: string;
  status: ParagraphStatus;
  /** 原文で <emphasis> が含まれる段落。注釈を当てる位置の目印 */
  em?: boolean;
}

export interface WorkData {
  id: string;
  meta: WorkMeta;
  people: Record<string, Person>;
  glossary: Record<string, GlossaryEntry>;
}
