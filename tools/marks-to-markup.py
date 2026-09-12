#!/usr/bin/env python3
"""注釈の位置指定（marks）から、章JSONに当てるマークアップ・パッチを機械生成する。

注釈エージェントに markup.json を直接書かせると、本文を一字でも書き換えた瞬間に
apply-annotation.ts が落ちる（本文の改変ゼロを機械保証しているため）。そこで
エージェントには「どの段落のどのセグメントの、どの語に、どのIDを当てるか」だけを
書かせ、本文の文字列は章JSONから取ってくる。位置指定が一意でなければここで落とす。

入力: source/annotations/<chapterId>.marks.json
  [ {"p": "p002", "seg": 2, "text": "辻馬車の御者", "kind": "n", "id": "izvozchik"}, ... ]
  - seg は segments[] の番号（0始まり）。segments が無い段落は 0 のみ
  - text はそのセグメントに**ちょうど1回**現れる文字列でなければならない
  - kind は p（人物）/ r（代名詞参照）/ n（語注）

出力: source/annotations/<chapterId>.markup.json（apply-annotation.ts の入力）

使い方: python3 tools/marks-to-markup.py <chapterId>
"""
import json
import sys
from pathlib import Path

KINDS = {'p', 'r', 'n'}


def main() -> int:
    if len(sys.argv) != 2:
        print('usage: python3 tools/marks-to-markup.py <chapterId>', file=sys.stderr)
        return 1
    cid = sys.argv[1]

    chapter_path = Path('src/content/chapters') / f'{cid}.json'
    marks_path = Path('source/annotations') / f'{cid}.marks.json'
    out_path = Path('source/annotations') / f'{cid}.markup.json'

    chapter = json.loads(chapter_path.read_text(encoding='utf-8'))
    marks = json.loads(marks_path.read_text(encoding='utf-8'))

    segs: dict[str, list[str]] = {}
    for para in chapter['paragraphs']:
        s = para.get('segments')
        segs[para['id']] = [x['ja'] for x in s] if s else [para['ja']]

    work = {pid: list(v) for pid, v in segs.items()}
    errors: list[str] = []

    for i, m in enumerate(marks):
        where = f'marks[{i}]'
        pid, seg, text, kind, ident = m.get('p'), m.get('seg'), m.get('text'), m.get('kind'), m.get('id')
        if kind not in KINDS:
            errors.append(f'{where}: kind が p/r/n でない: {kind!r}')
            continue
        if pid not in work:
            errors.append(f'{where}: 段落 {pid} が章に無い')
            continue
        if not isinstance(seg, int) or seg < 0 or seg >= len(work[pid]):
            errors.append(f'{where}: {pid} のセグメント番号 {seg} が範囲外（0〜{len(work[pid]) - 1}）')
            continue
        cur = work[pid][seg]
        n = cur.count(text) if text else 0
        if n != 1:
            errors.append(
                f'{where}: {pid}[{seg}] に "{text}" が {n} 回（ちょうど1回である必要がある）。'
                '語を伸ばすか、別のセグメントを指すこと'
            )
            continue
        work[pid][seg] = cur.replace(text, '{{%s:%s|%s}}' % (kind, ident, text))

    if errors:
        print('\n'.join(errors), file=sys.stderr)
        return 1

    touched = sorted({m['p'] for m in marks})
    patch = {pid: work[pid] for pid in touched}
    out_path.write_text(json.dumps(patch, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{out_path}: {len(patch)} 段落 / マーク {len(marks)} 件')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
