// 表示設定。localStorage に保存し、html の data 属性へ反映する。
// 描画前の復元は BaseLayout.astro のインラインスクリプトが行う（キーを揃えること）。

export interface Settings {
  fs: number; // 文字サイズ 1..4
  lh: number; // 行間 1..3
  gloss: boolean; // 愛称に本名を添える（既定オン、p のみ対象）
  rmark: boolean; // 代名詞にも印をつける（既定オフ）
  vertical: boolean; // 縦書き
  theme: 'day' | 'night';
}

const KEY = 'ecb:settings';

const DEFAULTS: Settings = {
  fs: 2,
  lh: 2,
  gloss: true,
  rmark: false,
  vertical: false,
  theme: 'day',
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed, theme: parsed.theme === 'night' ? 'night' : 'day' };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* プライベートブラウジング等で保存できなくても読書は続けられる */
  }
}

function applySettings(s: Settings): void {
  const d = document.documentElement;
  d.dataset.fs = String(s.fs);
  d.dataset.lh = String(s.lh);
  if (s.theme === 'night') d.dataset.theme = 'night';
  else delete d.dataset.theme;
  if (!s.gloss) d.dataset.gloss = 'off';
  else delete d.dataset.gloss;
  if (s.rmark) d.dataset.rmark = 'on';
  else delete d.dataset.rmark;
  if (s.vertical) d.dataset.vertical = 'on';
  else delete d.dataset.vertical;
}

/** 設定パネルの開閉と、入力 ⇄ 設定の同期 */
export function initSettings(): void {
  const panel = document.getElementById('settings-panel');
  const backdrop = document.getElementById('settings-backdrop');
  const opener = document.getElementById('settings-button');
  if (!panel || !backdrop || !opener) return;

  let settings = loadSettings();
  applySettings(settings);

  // 入力に現在値を反映
  const radios = panel.querySelectorAll<HTMLInputElement>('input[type="radio"]');
  for (const r of radios) {
    if (r.name === 'fs') r.checked = Number(r.value) === settings.fs;
    if (r.name === 'lh') r.checked = Number(r.value) === settings.lh;
  }
  const checks = panel.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  for (const c of checks) {
    if (c.name === 'gloss') c.checked = settings.gloss;
    if (c.name === 'rmark') c.checked = settings.rmark;
    if (c.name === 'vertical') c.checked = settings.vertical;
    if (c.name === 'theme') c.checked = settings.theme === 'night';
  }

  panel.addEventListener('change', (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement)) return;
    switch (input.name) {
      case 'fs':
        settings.fs = Number(input.value);
        break;
      case 'lh':
        settings.lh = Number(input.value);
        break;
      case 'gloss':
        settings.gloss = input.checked;
        break;
      case 'rmark':
        settings.rmark = input.checked;
        break;
      case 'vertical':
        settings.vertical = input.checked;
        break;
      case 'theme':
        settings.theme = input.checked ? 'night' : 'day';
        break;
    }
    applySettings(settings);
    saveSettings(settings);
  });

  const open = () => {
    panel.hidden = false;
    backdrop.hidden = false;
    opener.setAttribute('aria-expanded', 'true');
    panel.querySelector<HTMLElement>('input')?.focus();
  };
  const close = () => {
    panel.hidden = true;
    backdrop.hidden = true;
    opener.setAttribute('aria-expanded', 'false');
    (opener as HTMLElement).focus();
  };

  opener.addEventListener('click', () => (panel.hidden ? open() : close()));
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) close();
  });
}
