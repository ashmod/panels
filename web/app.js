import { getJson } from './api.js';
import { exportFavorites, importFavorites, toggleFav } from './favorites.js';
import { initFeed } from './feed.js';
import { clearComics, closeLibrary, feelingLucky, openLibrary, setQuery } from './library.js';
import { readLatest, renderCast, shuffle, showBootError, step } from './reader.js';
import { initRouter, route } from './router.js';
import { initScroller } from './scroller.js';
import { persist, state } from './state.js';
import { closeViewer, initViewer, openViewer, zoomAt } from './viewer.js';
import { $, $$, currentView, isOpen } from './util.js';

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = $('#themeBtn');
  btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  $('use', btn).setAttribute('href', theme === 'dark' ? '#i-sun' : '#i-moon');
}

function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (isOpen('viewer')) {
    if (e.key === 'Escape') closeViewer();
    if (e.key === '+' || e.key === '=') zoomAt(1.25);
    if (e.key === '-') zoomAt(0.8);
    return;
  }
  if (isOpen('library')) {
    if (e.key === 'Escape') closeLibrary();
    return;
  }
  if (e.target.closest('input, textarea')) return;
  if (e.key === '/') {
    e.preventDefault();
    openLibrary();
    return;
  }
  if (currentView() !== 'read' || !state.selected.length) return;
  if (e.target.closest('button, a, label') && (e.key === ' ' || e.key === 'Enter')) return;
  const actions = {
    ' ': shuffle,
    s: shuffle,
    ArrowLeft: () => step(-1),
    ArrowRight: () => step(1),
    l: readLatest,
    f: () => toggleFav(),
    z: () => openViewer(),
  };
  const fn = actions[e.key] ?? actions[e.key.toLowerCase()];
  if (fn) {
    e.preventDefault();
    fn();
  }
}

function bind() {
  $$('.scroller').forEach(initScroller);
  $('#shuffleBtn').onclick = shuffle;
  $('#earlierBtn').onclick = () => step(-1);
  $('#laterBtn').onclick = () => step(1);
  $('#latestBtn').onclick = readLatest;
  $('#favBtn').onclick = () => toggleFav();
  $('#stripImg').onclick = () => openViewer();
  $$('[data-action="library"]').forEach((b) => { b.onclick = openLibrary; });
  $('#libClose').onclick = closeLibrary;
  $('#libDone').onclick = closeLibrary;
  $('#scrim').onclick = closeLibrary;
  $('#luckyBtn').onclick = feelingLucky;
  $('#clearBtn').onclick = clearComics;
  let searchTimer;
  $('#search').oninput = (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => setQuery(e.target.value), 120);
  };
  $('#exportBtn').onclick = exportFavorites;
  $('#importInput').onchange = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) importFavorites(file);
  };
  $('#themeBtn').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    persist('theme', next);
  };
  initViewer();
  initFeed();
  initRouter();
  addEventListener('keydown', onKey);
  addEventListener('scroll', () => $('#topbar').classList.toggle('is-scrolled', scrollY > 4), { passive: true });
}

async function boot() {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  bind();
  const [comics, plates] = await Promise.all([
    getJson('/api/comics').catch(() => null),
    getJson('/plates.json').catch(() => ({})),
  ]);
  if (!comics) {
    showBootError();
    return;
  }
  state.plates = plates;
  state.comics = comics.sort((a, b) => a.title.localeCompare(b.title));
  state.comics.forEach((c) => state.byEp.set(c.endpoint, c));
  state.selected = state.selected.filter((ep) => state.byEp.has(ep));
  renderCast();
  route();
}

boot();
