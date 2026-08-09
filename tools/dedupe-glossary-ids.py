#!/usr/bin/env python3
"""並行注釈付けで生まれた同一概念の重複語注IDを統合する（一回きりの整理スクリプト）。"""
import json
import glob

RENAMES = {
    'nomera': 'numera',
    'bakaleev-rooms': 'bakaleev-house',
    'v-prospect': 'v-prospekt',
    'five-percent-bonds': 'five-percent-bond',
    'khleb-sol': 'bread-and-salt',
}

total = 0
for path in sorted(glob.glob('src/content/chapters/*.json')):
    with open(path) as f:
        raw = f.read()
    orig = raw
    for old, new in RENAMES.items():
        raw = raw.replace('{{n:%s|' % old, '{{n:%s|' % new)
    if raw != orig:
        n = sum(orig.count('{{n:%s|' % old) for old in RENAMES)
        total += n
        with open(path, 'w') as f:
            f.write(raw)
        print(f'{path}: {n} 箇所を置換')

g = json.load(open('src/data/works/crime/glossary.json'))
removed = [old for old in RENAMES if g.pop(old, None) is not None]
with open('src/data/works/crime/glossary.json', 'w') as f:
    json.dump(g, f, ensure_ascii=False, indent=2)
    f.write('\n')
print(f'置換合計 {total}（ja+segments重複込み）/ 台帳から削除: {removed} / 残り {len(g)} 件')
