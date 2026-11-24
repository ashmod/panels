export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => root.querySelectorAll(s);
export const enc = encodeURIComponent;
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
export const pick = (list) => list[Math.floor(Math.random() * list.length)];
export const motion = () => (reduceMotion.matches ? 'auto' : 'smooth');

export const isOpen = (id) => (id === 'library'
  ? document.body.classList.contains('library-open')
  : !$(`#${id}`).hidden);

export function formatDate(d, style = 'long') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const [y, m, day] = d.split('-').map(Number);
  const opts = style === 'long'
    ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
    : { day: 'numeric', month: 'short', year: 'numeric' };
  return new Intl.DateTimeFormat(undefined, opts).format(new Date(y, m - 1, day));
}

export function currentView() {
  const path = location.pathname.replace(/\/+$/, '');
  if (path === '/feed') return 'feed';
  if (path === '/favorites') return 'favorites';
  return 'read';
}
