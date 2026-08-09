#!/usr/bin/env python3
"""main の表記ゆれ統一と注釈ブランチのマージ解消（一回きり）。

方針: origin/main の本文（表記統一後・無注釈）を正とし、注釈ブランチ（HEAD）の
マークアップを断片単位で移植する。表示文字列は統一の改名マップで追随。
移植後、strip(結果) == main本文 を全段落で機械検証する。
"""
import json
import re
import subprocess
import sys
import glob

MARKUP_RE = re.compile(r'\{\{([prn]):([a-z0-9-]+)\|([^{}|]+)\}\}')

# c2dca6c の統一規則（表示文字列の追随用）
RENAMES = [
    ('ザミョートフ', 'ザメートフ'),
    ('ペテルブルク', 'ペテルブルグ'),
    ('イワーノヴナ', 'イヴァーノヴナ'),
    ('フォーミチ', 'フォミーチ'),
    ('俺', 'おれ'),
]
# 原文追随で双方向がありうる父称
VARIANTS = [
    ('ロマーノヴィチ', 'ロマーヌイチ'),
    ('ザハーロヴィチ', 'ザハールイチ'),
]


def show(ref, path):
    r = subprocess.run(['git', 'show', f'{ref}:{path}'], capture_output=True, text=True)
    if r.returncode != 0:
        return None
    return json.loads(r.stdout)


def strip(s):
    return MARKUP_RE.sub(lambda m: m.group(3), s)


def candidates(display):
    """表示文字列の探索候補（原形→改名適用→父称バリアント）"""
    cands = [display]
    renamed = display
    for old, new in RENAMES:
        renamed = renamed.replace(old, new)
    if renamed != display:
        cands.append(renamed)
    for a, b in VARIANTS:
        for base in list(cands):
            if a in base:
                cands.append(base.replace(a, b))
            if b in base:
                cands.append(base.replace(b, a))
    return cands


def transplant_frag(my_frag, their_ja, log, where):
    """my_frag のマークアップを their_ja（無注釈）へ移植する"""
    if strip(my_frag) == their_ja:
        return my_frag  # 本文が変わっていない断片はそのまま
    tokens = [(m.group(1), m.group(2), m.group(3)) for m in MARKUP_RE.finditer(my_frag)]
    if not tokens:
        return their_ja
    result = their_ja
    cursor = 0
    for t, i, disp in tokens:
        found = None
        for cand in candidates(disp):
            idx = result.find(cand, cursor)
            if idx >= 0:
                found = (idx, cand)
                break
        if found is None:
            log.append(f'{where}: 「{disp}」({t}:{i}) が新本文に見つからず注釈を落とした')
            continue
        idx, cand = found
        wrapped = '{{%s:%s|%s}}' % (t, i, cand)
        result = result[:idx] + wrapped + result[idx + len(cand):]
        cursor = idx + len(wrapped)
    return result


def main():
    log = []
    dropped = []
    total_moved = 0
    for path in sorted(glob.glob('src/content/chapters/*.json')):
        theirs = show('origin/main', path)
        mine = show('HEAD', path)
        if theirs is None or mine is None:
            print(f'{path}: 片側に存在しない。手動対応が必要', file=sys.stderr)
            sys.exit(1)
        mine_by_id = {p['id']: p for p in mine['paragraphs']}
        # 自分が注釈を付けていない章（01-01）は theirs をそのまま採用
        if not any('{{' in p['ja'] for p in mine['paragraphs']) or path.endswith('crime-01-01.json'):
            out = theirs
        else:
            out = theirs
            for p in out['paragraphs']:
                mp = mine_by_id.get(p['id'])
                if mp is None or '{{' not in mp['ja']:
                    continue
                my_frags = [s['ja'] for s in mp['segments']] if mp.get('segments') else [mp['ja']]
                their_frags = [s['ja'] for s in p['segments']] if p.get('segments') else [p['ja']]
                if len(my_frags) != len(their_frags):
                    log.append(f'{path} {p["id"]}: 断片数が不一致（{len(my_frags)} vs {len(their_frags)}）。theirs を採用し注釈を落とした')
                    dropped.append(p['id'])
                    continue
                new_frags = [
                    transplant_frag(mf, tf, log, f'{path} {p["id"]}[{i}]')
                    for i, (mf, tf) in enumerate(zip(my_frags, their_frags))
                ]
                if p.get('segments'):
                    for s, nf in zip(p['segments'], new_frags):
                        s['ja'] = nf
                    p['ja'] = ''.join(new_frags)
                else:
                    p['ja'] = new_frags[0]
                total_moved += sum(len(MARKUP_RE.findall(f)) for f in new_frags)
        # 検証: strip(結果) == theirs 本文（01-01 は theirs 自体に注釈があるため除外）
        theirs2 = show('origin/main', path)
        for p_out, p_th in zip(out['paragraphs'], theirs2['paragraphs']):
            if path.endswith('crime-01-01.json'):
                break
            assert strip(p_out['ja']) == p_th['ja'], f'{path} {p_out["id"]}: strip不一致'
            if p_out.get('segments'):
                assert ''.join(s['ja'] for s in p_out['segments']) == p_out['ja'], f'{path} {p_out["id"]}: segments不一致'
        with open(path, 'w') as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
            f.write('\n')
    print(f'移植した注釈: {total_moved} 個')
    if log:
        print(f'\n警告 {len(log)} 件:')
        for line in log:
            print(' -', line)


if __name__ == '__main__':
    main()
