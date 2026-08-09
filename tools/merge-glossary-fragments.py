#!/usr/bin/env python3
"""source/annotations/*.glossary.json を works の glossary.json へマージする。

- 既存 ID と同一 ID のフラグメント: term が一致すれば読み飛ばし（先勝ち）、
  term が異なればエラーで列挙（手動で改名して該当章のマークアップも直す）
- 新規 ID は追記。verified は強制的に false
"""
import json, sys, glob, os

GLOSSARY = 'src/data/works/crime/glossary.json'

def main():
    with open(GLOSSARY) as f:
        glossary = json.load(f)
    conflicts = []
    added = []
    # 引数でファイルを指定したらそれだけ、無指定なら全フラグメント
    paths = sys.argv[1:] or sorted(glob.glob('source/annotations/*.glossary.json'))
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
    with open(GLOSSARY, 'w') as f:
        json.dump(glossary, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(f'追加 {len(added)} 件: {", ".join(added) if added else "なし"}')

if __name__ == '__main__':
    main()
