#!/usr/bin/env python3
"""source/annotations/<workId>-*.glossary.json を works の glossary.json へマージする。

- 既存 ID と同一 ID のフラグメント: term が一致すれば読み飛ばし（先勝ち）、
  term が異なればエラーで列挙（手動で改名して該当章のマークアップも直す）
- 新規 ID は追記。verified は強制的に false

使い方: python3 tools/merge-glossary-fragments.py <workId> [fragment.json ...]
        （フラグメント無指定なら source/annotations/<workId>-*.glossary.json をすべて取り込む）

作品をまたいで取り込まないよう、必ず workId で対象を絞る。章IDは <workId>-… の形なので
フラグメント名の接頭辞がそのまま作品の切り分けになる。
"""
import json, sys, glob, os

def main():
    args = sys.argv[1:]
    if not args:
        print('usage: merge-glossary-fragments.py <workId> [fragment.json ...]', file=sys.stderr)
        sys.exit(1)
    work_id, paths = args[0], args[1:]
    glossary_path = f'src/data/works/{work_id}/glossary.json'
    if not os.path.exists(glossary_path):
        print(f'作品 "{work_id}" の glossary.json が無い: {glossary_path}', file=sys.stderr)
        sys.exit(1)

    with open(glossary_path) as f:
        glossary = json.load(f)
    conflicts = []
    added = []
    # 章IDは workId で始まるので、無指定ならその作品のフラグメントだけを拾う
    paths = paths or sorted(glob.glob(f'source/annotations/{work_id}-*.glossary.json'))
    for path in paths:
        with open(path) as f:
            frag = json.load(f)
        for gid, entry in frag.items():
            if gid in glossary:
                if glossary[gid]['term'] != entry['term']:
                    conflicts.append(f"{os.path.basename(path)}: {gid} (既存: {glossary[gid]['term']} / 新規: {entry['term']})")
                continue
            entry['verified'] = False
            entry.setdefault('sources', [])
            glossary[gid] = entry
            added.append(gid)
    if conflicts:
        print('ID衝突（termが不一致）:')
        for c in conflicts:
            print(' -', c)
        sys.exit(1)
    with open(glossary_path, 'w') as f:
        json.dump(glossary, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(f'{glossary_path}: 追加 {len(added)} 件: {", ".join(added) if added else "なし"}')

if __name__ == '__main__':
    main()
