// 既読メーターの描画。書棚（トップ）と構造ビューで同じ器（.meter > .meter-track > .meter-fill,
// .meter-label）を使うため、塗る処理はここに集約する。

export function paintMeter(el: HTMLElement, done: number, total: number): number {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const fill = el.querySelector<HTMLElement>('.meter-fill');
  const label = el.querySelector<HTMLElement>('.meter-label');
  if (fill) fill.style.width = `${pct}%`;
  if (label) label.textContent = pct > 0 ? `${pct}%` : '';
  el.title = `既読 ${pct}%`;
  return pct;
}
