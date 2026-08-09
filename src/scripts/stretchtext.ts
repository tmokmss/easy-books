// stretchtext: 本文を読んでいる最中に、その場で伸縮する。ページ遷移を伴わないこと。
//   - 既定はズームアウト: 要約を持つ節は要約カードだけを見せ、カード（または見出し）を
//     押して初めて本文にズームインする。ひらいた節は localStorage に記憶して復元する
//   - 読書位置の復元先・URLハッシュの段落を含む節は自動でひらく（ユーザーの意思では
//     ないので記憶しない）
//   - 段落要約はボタン（長押しでも可）でその場に差し込む
// トリガはすべて <button> ＋ aria-expanded で表す。

const OPEN_PREFIX = 'ecb:open:';
const POS_PREFIX = 'ecb:pos:';

function setExpanded(btn: HTMLElement, on: boolean): void {
  btn.setAttribute('aria-expanded', String(on));
}

function controlled(btn: HTMLElement): HTMLElement | null {
  const id = btn.getAttribute('aria-controls');
  return id ? document.getElementById(id) : null;
}

export function initStretchtext(): void {
  const zoomEl = document.getElementById('zoom-data');
  let chapterId: string | null = null;
  try {
    chapterId = zoomEl ? (JSON.parse(zoomEl.textContent ?? '{}').chapterId ?? null) : null;
  } catch {
    /* noop */
  }

  const sections = [...document.querySelectorAll<HTMLElement>('.zoom-sec')];
  const isOpenNow = (sec: HTMLElement) => !sec.classList.contains('folded');

  // ---- ひらいた節の記憶 ----

  const open = new Set<string>();
  if (chapterId) {
    try {
      const arr = JSON.parse(localStorage.getItem(OPEN_PREFIX + chapterId) ?? '[]');
      if (Array.isArray(arr)) for (const id of arr) open.add(String(id));
    } catch {
      /* noop */
    }
  }
  const saveOpen = () => {
    if (!chapterId) return;
    try {
      localStorage.setItem(OPEN_PREFIX + chapterId, JSON.stringify([...open]));
    } catch {
      /* 保存できなくても読書は続けられる */
    }
  };

  const setSectionOpen = (sec: HTMLElement, isOpen: boolean, persist = true) => {
    sec.classList.toggle('folded', !isOpen);
    const fold = sec.querySelector<HTMLElement>('.sec-fold');
    if (fold) {
      setExpanded(fold, isOpen);
      const hint = fold.querySelector<HTMLElement>('.sec-fold-hint');
      if (hint) hint.textContent = isOpen ? 'たたむ' : 'ひらく';
    }
    const card = sec.querySelector<HTMLElement>('.sec-sum-open');
    if (card) {
      card.hidden = isOpen;
      setExpanded(card, isOpen);
    }
    const sumBtn = sec.querySelector<HTMLElement>('.sec-sum-btn');
    if (sumBtn) sumBtn.hidden = !isOpen;
    if (!isOpen) {
      // たたんだら展開中の要約情報も戻す（カード自体が要約なので二重に出さない）
      const info = sec.querySelector<HTMLElement>('.sec-sum-info');
      if (info) info.hidden = true;
      if (sumBtn) setExpanded(sumBtn, false);
    }
    const id = sec.dataset.sec;
    if (persist && chapterId && id) {
      if (isOpen) open.add(id);
      else open.delete(id);
      saveOpen();
    }
  };

  // ---- 初期状態の復元 ----

  const sectionOf = (pid: string | null) =>
    pid ? (document.getElementById(pid)?.closest<HTMLElement>('.zoom-sec') ?? null) : null;

  for (const sec of sections) {
    if (sec.dataset.sec && open.has(sec.dataset.sec) && !isOpenNow(sec)) {
      setSectionOpen(sec, true, false);
    }
  }
  const hashPid = location.hash.replace(/^#/, '');
  if (hashPid) {
    const sec = sectionOf(hashPid);
    if (sec && !isOpenNow(sec)) {
      setSectionOpen(sec, true, false);
      // 折りたたみ中はブラウザのハッシュジャンプが効いていないので、ひらいてから飛び直す
      requestAnimationFrame(() =>
        document.getElementById(hashPid)?.scrollIntoView({ block: 'start' }),
      );
    }
  } else if (chapterId) {
    // 前回の読書位置を含む節をひらいておく（復元スクロールは reader.ts が行う）
    try {
      const sec = sectionOf(localStorage.getItem(POS_PREFIX + chapterId));
      if (sec && !isOpenNow(sec)) setSectionOpen(sec, true, false);
    } catch {
      /* noop */
    }
  }

  const allBtn = document.querySelector<HTMLElement>('.sec-all-btn');
  const syncAllBtn = () => {
    if (!allBtn) return;
    const anyFolded = sections.some((s) => !isOpenNow(s));
    allBtn.textContent = anyFolded ? 'すべての節をひらく' : 'すべての節をたたむ';
  };
  syncAllBtn();

  // ---- クリック操作 ----

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    const card = target.closest<HTMLElement>('.sec-sum-open');
    if (card) {
      const sec = card.closest<HTMLElement>('.zoom-sec');
      if (sec) {
        setSectionOpen(sec, true);
        syncAllBtn();
      }
      return;
    }

    const fold = target.closest<HTMLElement>('.sec-fold');
    if (fold) {
      const sec = fold.closest<HTMLElement>('.zoom-sec');
      if (sec) {
        const opening = !isOpenNow(sec);
        setSectionOpen(sec, opening);
        if (!opening) sec.scrollIntoView({ block: 'nearest' });
        syncAllBtn();
      }
      return;
    }

    if (target.closest('.sec-all-btn')) {
      const anyFolded = sections.some((s) => !isOpenNow(s));
      for (const sec of sections) setSectionOpen(sec, anyFolded);
      syncAllBtn();
      return;
    }

    // 要約の表示切り替え（展開中の節・段落・あらすじ共通）
    const btn = target.closest<HTMLElement>('.sec-sum-btn, .para-sum-btn, .disclosure-btn');
    if (!btn) return;
    const el = controlled(btn);
    if (!el) return;
    el.hidden = !el.hidden;
    setExpanded(btn, !el.hidden);
  });

  // ---- 段落の長押し（補助経路） ----

  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let pressStart: { x: number; y: number } | null = null;

  const cancelPress = () => {
    clearTimeout(pressTimer);
    pressTimer = undefined;
    pressStart = null;
  };

  document.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('button, a')) return; // 注釈ボタン等の操作を邪魔しない
    const group = t.closest<HTMLElement>('.para-group');
    const btn = group?.querySelector<HTMLElement>('.para-sum-btn');
    if (!group || !btn) return;
    pressStart = { x: e.clientX, y: e.clientY };
    pressTimer = setTimeout(() => {
      btn.click();
      cancelPress();
    }, 500);
  });
  document.addEventListener('pointermove', (e) => {
    if (pressStart && Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 10) {
      cancelPress();
    }
  });
  document.addEventListener('pointerup', cancelPress);
  document.addEventListener('pointercancel', cancelPress);
  window.addEventListener('scroll', cancelPress, { passive: true });
}
