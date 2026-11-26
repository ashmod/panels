import { badgeUrl, fetchRecommendations } from './api.js';
import { renderFeedFilter, resetFeed } from './feed.js';
import { commitPicks, renderCast, renderStage } from './reader.js';
import { comicTitle, faceHtml, paint, persist, plateStyle, state, tagLabel } from './state.js';
import { $, $$, currentView, esc, isOpen, motion, pick, reduceMotion } from './util.js';

const LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
const SHOWN_RECS = 8;
const finePointer = matchMedia('(pointer: fine)');

function saveSelected() {
  persist('selected', state.selected);
  state.prefetched = null;
  renderCast();
}

export function addComic(ep) {
  if (state.selected.includes(ep)) return;
  state.selected.push(ep);
  state.arrivals.add(ep);
  saveSelected();
}

function removeComic(ep) {
  state.selected = state.selected.filter((e) => e !== ep);
  state.arrivals.delete(ep);
  saveSelected();
}

function toggleComic(ep) {
  if (state.selected.includes(ep)) removeComic(ep);
  else addComic(ep);
  syncLibrary();
}

export function clearComics() {
  state.selected = [];
  state.arrivals.clear();
  saveSelected();
  syncLibrary();
}

let lastFocus = null;

export function openLibrary() {
  lastFocus = document.activeElement;
  document.body.classList.add('library-open');
  $('#app').inert = true;
  // Picks made on the starter screen carry into the library instead of vanishing when it closes.
  commitPicks();
  renderChips();
  renderLetters();
  renderTiles();
  syncLibrary();
  loadRecs();
  // On touch screens, focusing the search would raise the keyboard over the comics.
  setTimeout(() => (finePointer.matches ? $('#search') : $('#library')).focus({ preventScroll: true }), 60);
}

export function toggleFilters() {
  const open = $('#library').classList.toggle('filters-open');
  $('#filtersBtn').setAttribute('aria-expanded', String(open));
}

function syncFilterCount() {
  const n = state.tags.size + (state.letter ? 1 : 0);
  $('#filterCount').textContent = n ? ` · ${n}` : '';
}

export function closeLibrary() {
  if (!isOpen('library')) return;
  document.body.classList.remove('library-open');
  $('#app').inert = false;
  renderCast();
  lastFocus?.focus?.();
  if (currentView() === 'read') renderStage();
  if (currentView() === 'feed') { renderFeedFilter(); resetFeed(); }
}

function syncLibrary() {
  const n = state.selected.length;
  $('#selCount').textContent = n === 1 ? '1 comic selected' : `${n} comics selected`;
  $('#picksSection').hidden = n === 0;
  $('#picksCount').textContent = n;
  $('#picks').replaceChildren(...state.selected.map(pickEl));
  $$('.tile').forEach((t) => t.setAttribute('aria-pressed', String(state.selected.includes(t.dataset.ep))));
}

function pickEl(ep) {
  const el = document.createElement('span');
  el.className = 'pick';
  el.dataset.ep = ep;
  paint(el, ep);
  el.innerHTML = `${faceHtml(ep)}${esc(comicTitle(ep))}<button type="button" aria-label="Remove ${esc(comicTitle(ep))}"><svg class="i"><use href="#i-close"/></svg></button>`;
  $('button', el).onclick = () => toggleComic(ep);
  return el;
}

function tileEl(comic) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tile';
  b.dataset.ep = comic.endpoint;
  paint(b, comic.endpoint);
  b.setAttribute('aria-pressed', String(state.selected.includes(comic.endpoint)));
  b.innerHTML = `
    <span class="tile-art">
      <span class="tile-plate plate" style="${plateStyle(comic.endpoint)}"></span>
      <img src="${badgeUrl(comic.endpoint)}" alt="" loading="lazy" draggable="false">
      <span class="tile-check"><svg class="i"><use href="#i-check"/></svg></span>
    </span>
    <span class="tile-name">${esc(comic.title)}</span>
    <span class="tile-by">${esc(comic.author ?? '')}</span>`;
  b.onclick = () => toggleComic(comic.endpoint);
  return b;
}

function renderChips() {
  const tags = [...new Set(state.comics.flatMap((c) => c.tags ?? []))].sort();
  $('#chips').replaceChildren(...tags.map((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = tagLabel(t);
    b.setAttribute('aria-pressed', String(state.tags.has(t)));
    b.onclick = () => {
      if (state.tags.has(t)) state.tags.delete(t);
      else state.tags.add(t);
      b.setAttribute('aria-pressed', String(state.tags.has(t)));
      renderTiles();
    };
    return b;
  }));
}

const firstLetter = (c) => {
  const ch = c.title.replace(/^the\s+/i, '').charAt(0).toUpperCase();
  return /[A-Z]/.test(ch) ? ch : '#';
};

function renderLetters() {
  const present = new Set(state.comics.map(firstLetter));
  const make = (label, value) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(state.letter === value));
    if (value && !present.has(value)) b.disabled = true;
    if (label === 'All') b.setAttribute('aria-label', 'All letters');
    b.onclick = () => {
      state.letter = state.letter === value ? null : value;
      $$('#letters button').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      (state.letter ? b : $('#letters button')).setAttribute('aria-pressed', 'true');
      renderTiles();
    };
    return b;
  };
  $('#letters').replaceChildren(make('All', null), ...LETTERS.map((l) => make(l, l)));
}

function matches(comic) {
  if (state.tags.size && !(comic.tags ?? []).some((t) => state.tags.has(t))) return false;
  if (state.letter && firstLetter(comic) !== state.letter) return false;
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  return [comic.title, comic.author, ...(comic.keywords ?? [])].some((s) => s && s.toLowerCase().includes(q));
}

const filtering = () => !!(state.query.trim() || state.tags.size || state.letter);

function syncRecsVisibility() {
  $('#recsSection').hidden = filtering() || !$('#recTiles').children.length;
}

export function setQuery(q) {
  state.query = q;
  renderTiles();
}

function renderTiles() {
  const list = state.comics.filter(matches);
  $('#allTitle').innerHTML = filtering()
    ? (list.length === 1 ? '1 match' : `${list.length} matches`)
    : `All comics <span>${state.comics.length}</span>`;
  $('#tiles').replaceChildren(...list.map(tileEl));
  syncRecsVisibility();
  syncFilterCount();
}

const recs = { pool: [] };

async function fetchRecs() {
  const list = await fetchRecommendations(state.selected, 24);
  return list.filter((c) => !state.selected.includes(c.endpoint));
}

function recTile(comic) {
  const b = tileEl(comic);
  b.onclick = () => pickRec(b, comic.endpoint);
  return b;
}

async function loadRecs() {
  if (!state.selected.length) {
    $('#recsSection').hidden = true;
    return;
  }
  try {
    recs.pool = await fetchRecs();
    $('#recTiles').replaceChildren(...recs.pool.splice(0, SHOWN_RECS).map(recTile));
    syncRecsVisibility();
  } catch {
    $('#recsSection').hidden = true;
  }
}

async function pickRec(tile, ep) {
  if (tile.dataset.leaving) return;
  tile.dataset.leaving = 'true';
  addComic(ep);
  syncLibrary();
  // Leave the picked tile checked for a moment so the pick registers before it is swapped.
  const settle = new Promise((r) => setTimeout(r, reduceMotion.matches ? 0 : 420));
  const usable = (c) => !state.selected.includes(c.endpoint)
    && !$(`#recTiles .tile[data-ep="${CSS.escape(c.endpoint)}"]`);
  if (!recs.pool.some(usable)) recs.pool = await fetchRecs().catch(() => []);
  await settle;
  if (!tile.isConnected) return;
  const next = recs.pool.find(usable);
  if (next) {
    recs.pool = recs.pool.filter((c) => c !== next);
    const fresh = recTile(next);
    fresh.classList.add('rec-in');
    tile.replaceWith(fresh);
  } else {
    tile.remove();
  }
  syncRecsVisibility();
}

export function feelingLucky() {
  const pool = state.comics.filter((c) => c.available !== false
    && !state.selected.includes(c.endpoint)
    && !(c.tags ?? []).includes('en-espanol'));
  if (!pool.length) return;
  const comic = pick(pool);
  addComic(comic.endpoint);
  syncLibrary();
  const sel = CSS.escape(comic.endpoint);
  const targets = $$(`.pick[data-ep="${sel}"], .tile[data-ep="${sel}"]`);
  targets.forEach((el) => {
    el.classList.add('lucky');
    el.addEventListener('animationend', () => el.classList.remove('lucky'), { once: true });
  });
  targets[0]?.scrollIntoView({ block: 'nearest', behavior: motion() });
}
