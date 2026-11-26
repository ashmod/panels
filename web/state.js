import { badgeUrl } from './api.js';
import { formatDate } from './util.js';

export const KEYS = {
  selected: 'panels_selected',
  favorites: 'panels_favorites',
  theme: 'panels_theme',
};

const NEUTRAL = [222, 0.06];

function readList(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export const state = {
  comics: [],
  byEp: new Map(),
  plates: {},
  selected: readList(KEYS.selected) ?? [],
  favorites: readList(KEYS.favorites) ?? [],
  strip: null,
  stageEp: null,
  lastRequest: null,
  token: 0,
  prefetched: null,
  wipe: null,
  tags: new Set(),
  letter: null,
  query: '',
  arrivals: new Set(),
};

export const plateOf = (ep) => state.plates[ep] || NEUTRAL;
export const plateStyle = (ep) => `--h:${plateOf(ep)[0]};--c:${plateOf(ep)[1]}`;

export function paint(el, ep) {
  const [h, c] = plateOf(ep);
  el.style.setProperty('--h', h);
  el.style.setProperty('--c', c);
}

export const comicTitle = (ep) => state.byEp.get(ep)?.title ?? ep;
export const tagLabel = (t) => (t.charAt(0).toUpperCase() + t.slice(1)).replace(/-/g, ' ');
export const faceHtml = (ep) => `<span class="face plate" style="${plateStyle(ep)}"><img src="${badgeUrl(ep)}" alt="" loading="lazy"></span>`;

const loose = (t) => String(t ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export const ownTitle = (strip, comicName) => strip.title
  && loose(strip.title) !== loose(comicName)
  && loose(strip.title) !== loose(strip.endpoint);

export function stripLabel(strip, style) {
  const named = ownTitle(strip, state.byEp.get(strip.endpoint)?.title) ? ` “${strip.title}”` : '';
  return formatDate(strip.date, style) + named;
}

export const favKey = (s) => `${s.endpoint}:${s.date}`;
export const isFav = (s) => state.favorites.some((f) => favKey(f) === favKey(s));

export function paintFav(btn, on) {
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', on ? 'Remove from favorites' : 'Add to favorites');
  btn.querySelector('svg').classList.toggle('i-fill', on);
}

export function persist(key, value) {
  try {
    localStorage.setItem(KEYS[key], typeof value === 'string' ? value : JSON.stringify(value));
  } catch {}
}
