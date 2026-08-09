// stretchtext: 本文を読んでいる最中に、その場で伸縮する。ページ遷移を伴わないこと。
//   - 節の折りたたみ: 本文を節要約に置き換える（ズームアウト）。ひらくと本文に戻る
//   - 節・段落の要約表示: 見出し・段落末尾のボタンでその場に差し込む
//   - 段落の長押しでも要約が開く（ボタンが主経路。長押しは補助）
// トリガはすべて <button> ＋ aria-expanded で表す。

function setExpanded(btn: HTMLElement, on: boolean): void {
  btn.setAttribute('aria-expanded', String(on));
}

function controlled(btn: HTMLElement): HTMLElement | null {
  const id = btn.getAttribute('aria-controls');
  return id ? document.getElementById(id) : null;
}

export function initStretchtext(): void {
  document.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>(
      '.sec-fold, .sec-sum-btn, .para-sum-btn, .disclosure-btn',
    );
    if (!btn) return;

    if (btn.classList.contains('sec-fold')) {
      // 折りたたみ = 本文を隠して要約を出す。要約が無い節でも畳める
      const body = controlled(btn);
      if (!body) return;
      const sec = btn.closest<HTMLElement>('.zoom-sec');
      const sum = sec?.querySelector<HTMLElement>('.sec-sum');
      const sumBtn = sec?.querySelector<HTMLElement>('.sec-sum-btn');
      const folding = !body.hidden;
      body.hidden = folding;
      setExpanded(btn, !folding);
      sec?.classList.toggle('folded', folding);
      const hint = btn.querySelector<HTMLElement>('.sec-fold-hint');
      if (hint) hint.textContent = folding ? 'ひらく' : 'たたむ';
      if (sum) {
        if (folding) {
          sum.hidden = false;
        } else if (sum.dataset.userOpen !== '1') {
          sum.hidden = true;
        }
        if (sumBtn) setExpanded(sumBtn, !sum.hidden);
      }
      if (folding) sec?.scrollIntoView({ block: 'nearest' });
      return;
    }

    // 要約の表示切り替え（節・段落・あらすじ共通）
    const target = controlled(btn);
    if (!target) return;
    target.hidden = !target.hidden;
    setExpanded(btn, !target.hidden);
    if (btn.classList.contains('sec-sum-btn')) {
      target.dataset.userOpen = target.hidden ? '' : '1';
    }
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
