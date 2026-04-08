export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => document.querySelectorAll(sel);
export const mobileQuery = window.matchMedia('(max-width: 900px), (hover: none) and (pointer: coarse)');

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function clearSelection() {
  const sel = window.getSelection ? window.getSelection() : null;
  if (sel && sel.rangeCount > 0) {
    sel.removeAllRanges();
  }
}

export function sidebarArrow(collapsed) {
  return collapsed
    ? '<i class="fa-solid fa-chevron-left"></i>'
    : '<i class="fa-solid fa-chevron-right"></i>';
}
