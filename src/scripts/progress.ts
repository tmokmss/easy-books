// 読書画面の既読記録と現在位置バーの描画。
//   - 段落が「見えている状態が1.5秒続いたら」既読（スクロールで通過しただけでは立たない）
//   - 折りたたまれた節の段落は display:none で交差しないので、自然と数えられない
//   - バーは作品全体（全章）を横に並べ、既読の塗りと現在位置マーカーを重ねる

import { loadRead, markRead, saveRead } from './read-store';

interface ZoomData {
  workId: string;
  chapterId: string;
  chapters: { id: string; count: number }[];
}

const DWELL_MS = 1500;

export function initProgress(): void {
  const dataEl = document.getElementById('zoom-data');
  if (!dataEl) return;
  const data: ZoomData = JSON.parse(dataEl.textContent ?? '{}');

  const paras = [...document.querySelectorAll<HTMLElement>('#reader-flow .para')];
  const indexOf = new Map(paras.map((p, i) => [p, i]));
  const read = loadRead(data.workId);

  // ---- バーの塗り ----

  const fills = new Map<string, HTMLElement>();
  for (const seg of document.querySelectorAll<HTMLElement>('.zb-seg')) {
    const fill = seg.querySelector<HTMLElement>('.zb-fill');
    if (seg.dataset.ch && fill) fills.set(seg.dataset.ch, fill);
  }
  const paintFill = (chapterId: string) => {
    const fill = fills.get(chapterId);
    const total = data.chapters.find((c) => c.id === chapterId)?.count ?? 0;
    if (!fill || total === 0) return;
    fill.style.width = `${((read[chapterId]?.length ?? 0) / total) * 100}%`;
  };
  for (const c of data.chapters) paintFill(c.id);

  // ---- 既読の記録（滞留時間つき） ----

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveRead(data.workId, read), 800);
  };

  const dwell = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  const isReadablyVisible = (entry: IntersectionObserverEntry) => {
    if (!entry.isIntersecting) return false;
    // 画面より背の高い段落は 50% を満たせないので、可視部分の高さで判定する
    return (
      entry.intersectionRatio >= 0.5 ||
      entry.intersectionRect.height >= window.innerHeight * 0.5
    );
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        if (isReadablyVisible(entry)) {
          if (dwell.has(el)) continue;
          dwell.set(
            el,
            setTimeout(() => {
              dwell.delete(el);
              const i = indexOf.get(el);
              if (i !== undefined && markRead(read, data.chapterId, i)) {
                paintFill(data.chapterId);
                scheduleSave();
              }
            }, DWELL_MS),
          );
        } else {
          const timer = dwell.get(el);
          if (timer !== undefined) {
            clearTimeout(timer);
            dwell.delete(el);
          }
        }
      }
    },
    { threshold: [0, 0.5, 1] },
  );
  for (const p of paras) observer.observe(p);

  // ---- 現在位置マーカー ----

  const marker = document.querySelector<HTMLElement>('.zb-marker');
  const bar = document.querySelector<HTMLElement>('.zoom-bar');
  const curSeg = document.querySelector<HTMLElement>(`.zb-seg[data-ch="${data.chapterId}"]`);
  if (marker && bar && curSeg && paras.length > 0) {
    let raf = 0;
    const placeMarker = () => {
      raf = 0;
      // いちばん上に見えている段落を現在位置とする
      let topIdx = 0;
      for (let i = 0; i < paras.length; i++) {
        const r = paras[i].getBoundingClientRect();
        if (r.bottom > 0) {
          topIdx = i;
          break;
        }
      }
      const frac = paras.length > 1 ? topIdx / (paras.length - 1) : 0;
      const left = curSeg.offsetLeft + frac * curSeg.offsetWidth;
      marker.style.transform = `translateX(${left}px)`;
      marker.hidden = false;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(placeMarker);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    placeMarker();
  }
}
