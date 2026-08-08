// 読書画面のインタラクション:
//   - 注釈カード（人物・語注）の開閉と配置
//   - 人物レールの点灯（IntersectionObserver で可視段落を追う）
//   - 読書位置の保存・復元（localStorage、章ID+段落ID）

import type { GlossaryEntry, Person } from '../lib/types';

interface ReaderData {
  chapterId: string;
  people: Record<string, Person>;
  glossary: Record<string, GlossaryEntry>;
}

const POS_PREFIX = 'ecb:pos:';
const LAST_KEY = 'ecb:last';

function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function personCardHtml(p: Person): { title: string; body: string } {
  const parts: string[] = [];
  if (p.original) parts.push(`<p class="card-original">${esc(p.original)}</p>`);
  parts.push(`<p><span class="card-label">立場</span>${esc(p.role)}</p>`);
  if (p.rel) parts.push(`<p><span class="card-label">関係</span>${esc(p.rel)}</p>`);
  const names = [p.short, ...p.aliases.filter((a) => a !== p.short)];
  parts.push(
    `<p><span class="card-label">作中の呼ばれ方</span></p><ul class="card-aliases">${names
      .map((n) => `<li>${esc(n)}</li>`)
      .join('')}</ul>`,
  );
  if (p.hint) parts.push(`<p>${esc(p.hint)}</p>`);
  return { title: esc(p.name), body: parts.join('') };
}

function noteCardHtml(g: GlossaryEntry): { title: string; body: string } {
  // 裏取りしていない注釈を確定的に見せない
  const badge = g.verified ? '' : '<span class="card-unverified">未検証</span>';
  const parts: string[] = [`<p>${esc(g.body)}</p>`];
  if (g.sources.length > 0) {
    parts.push(`<p class="card-sources">出典: ${g.sources.map(esc).join(' / ')}</p>`);
  }
  return { title: esc(g.term) + badge, body: parts.join('') };
}

export function initReader(): void {
  const dataEl = document.getElementById('ecb-data');
  const flow = document.getElementById('reader-flow');
  const card = document.getElementById('ann-card');
  const cardTitle = document.getElementById('ann-card-title');
  const cardBody = document.getElementById('ann-card-body');
  const cardClose = document.getElementById('ann-card-close');
  const backdrop = document.getElementById('card-backdrop');
  if (!dataEl || !flow || !card || !cardTitle || !cardBody || !cardClose || !backdrop) return;

  const data: ReaderData = JSON.parse(dataEl.textContent ?? '{}');
  let opener: HTMLElement | null = null;

  // ---- 注釈カード ----

  const closeCard = (returnFocus = true) => {
    card.hidden = true;
    backdrop.hidden = true;
    if (returnFocus && opener) opener.focus();
    opener = null;
  };

  const openCard = (kind: 'person' | 'note', id: string, anchor: HTMLElement) => {
    const content =
      kind === 'person'
        ? data.people[id] && personCardHtml(data.people[id])
        : data.glossary[id] && noteCardHtml(data.glossary[id]);
    if (!content) return;

    opener = anchor;
    card.dataset.kind = kind;
    cardTitle.innerHTML = content.title;
    cardBody.innerHTML = content.body;
    card.hidden = false;
    backdrop.hidden = false;

    const isSheet = window.matchMedia('(max-width: 719px)').matches;
    if (isSheet) {
      // ボトムシート（CSS の fixed 配置に任せる）
      card.style.top = '';
      card.style.left = '';
    } else {
      // アンカー近くにポップオーバー
      const rect = anchor.getBoundingClientRect();
      const margin = 12;
      card.style.visibility = 'hidden';
      card.style.top = '0px';
      card.style.left = '0px';
      const cw = card.offsetWidth;
      const ch = card.offsetHeight;
      let left = window.scrollX + rect.left;
      left = Math.min(left, window.scrollX + window.innerWidth - cw - margin);
      left = Math.max(left, window.scrollX + margin);
      let top = window.scrollY + rect.bottom + 8;
      if (rect.bottom + 8 + ch > window.innerHeight && rect.top - 8 - ch > 0) {
        top = window.scrollY + rect.top - ch - 8;
      }
      card.style.top = `${top}px`;
      card.style.left = `${left}px`;
      card.style.visibility = '';
    }
    (cardClose as HTMLElement).focus();
  };

  flow.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.ann');
    if (!btn) return;
    const kind = btn.dataset.ann === 'n' ? 'note' : 'person';
    const id = btn.dataset.annId;
    if (id) openCard(kind, id, btn);
  });

  cardClose.addEventListener('click', () => closeCard());
  backdrop.addEventListener('click', () => closeCard(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !card.hidden) closeCard();
  });

  // ---- 人物レール ----

  const railButtons = new Map<string, HTMLElement>();
  for (const b of document.querySelectorAll<HTMLElement>('.rail-person')) {
    const id = b.dataset.personId;
    if (id) {
      railButtons.set(id, b);
      b.addEventListener('click', () => openCard('person', id, b));
    }
  }

  const paras = [...flow.querySelectorAll<HTMLElement>('.para')];
  const visibleParas = new Set<HTMLElement>();

  const updateRail = () => {
    const active = new Set<string>();
    for (const p of visibleParas) {
      for (const id of (p.dataset.persons ?? '').split(' ')) {
        if (id) active.add(id);
      }
    }
    for (const [id, btn] of railButtons) {
      btn.classList.toggle('active', active.has(id));
    }
  };

  // ---- 読書位置の保存 ----

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const savePosition = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      let topmost: HTMLElement | null = null;
      for (const p of visibleParas) {
        if (!topmost || p.offsetTop < topmost.offsetTop) topmost = p;
      }
      if (!topmost) return;
      try {
        localStorage.setItem(POS_PREFIX + data.chapterId, topmost.id);
        localStorage.setItem(LAST_KEY, JSON.stringify({ chapter: data.chapterId, para: topmost.id }));
      } catch {
        /* 保存できなくても読書は続けられる */
      }
    }, 400);
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visibleParas.add(entry.target as HTMLElement);
        else visibleParas.delete(entry.target as HTMLElement);
      }
      updateRail();
      savePosition();
    },
    { threshold: 0 },
  );
  for (const p of paras) observer.observe(p);

  // ---- 読書位置の復元 ----

  if (!location.hash) {
    try {
      const saved = localStorage.getItem(POS_PREFIX + data.chapterId);
      const target = saved && document.getElementById(saved);
      if (target && saved !== paras[0]?.id) {
        target.scrollIntoView({ block: 'start', behavior: 'auto' });
      }
    } catch {
      /* noop */
    }
  }
}
