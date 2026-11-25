import { imageUrl } from './api.js';
import { syncFavButton } from './reader.js';
import { comicTitle, favKey, isFav, paint, paintFav, persist, state, stripLabel } from './state.js';
import { openViewer } from './viewer.js';
import { $, $$, currentView, esc, formatDate } from './util.js';

const MESSAGE_MS = 4000;

const plural = (n) => (n === 1 ? '1 favorite' : `${n} favorites`);

function saveFavorites() {
  persist('favorites', state.favorites);
  syncFavButton();
  const keys = new Set(state.favorites.map(favKey));
  $$('[data-fav]').forEach((b) => paintFav(b, keys.has(b.dataset.fav)));
  if (currentView() === 'favorites') renderFavorites();
}

export function toggleFav(s = state.strip) {
  if (!s) return;
  if (isFav(s)) state.favorites = state.favorites.filter((f) => favKey(f) !== favKey(s));
  else state.favorites.push({ endpoint: s.endpoint, date: s.date, title: s.title, added: Date.now() });
  saveFavorites();
}

function addedLabel(ts) {
  const d = new Date(ts);
  const now = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function renderFavorites() {
  const n = state.favorites.length;
  $('#favCount').textContent = n ? (n === 1 ? '1 saved strip' : `${n} saved strips`) : '';
  $('#favEmpty').hidden = n > 0;
  $('#exportBtn').disabled = n === 0;
  const groups = [];
  [...state.favorites].sort((a, b) => (b.added ?? 0) - (a.added ?? 0)).forEach((f) => {
    const label = addedLabel(f.added ?? 0);
    if (groups.at(-1)?.label !== label) groups.push({ label, items: [] });
    groups.at(-1).items.push(f);
  });
  $('#favGroups').replaceChildren(...groups.map((g) => {
    const section = document.createElement('section');
    section.className = 'fav-group';
    section.innerHTML = `<h2>${esc(g.label)}</h2><div class="fav-grid"></div>`;
    $('.fav-grid', section).append(...g.items.map(favCard));
    return section;
  }));
}

function favCard(f) {
  const card = document.createElement('article');
  card.className = 'fav-card plate';
  paint(card, f.endpoint);
  card.innerHTML = `
    <button class="fav-open" type="button" aria-label="Zoom in on ${esc(comicTitle(f.endpoint))}, ${esc(formatDate(f.date))}">
      <img src="${imageUrl(f)}" alt="" loading="lazy">
    </button>
    <div class="fav-info">
      <div>
        <strong class="letter">${esc(comicTitle(f.endpoint))}</strong>
        <span>${esc(stripLabel(f, 'short'))}</span>
      </div>
      <button class="btn btn-round" type="button" aria-label="Remove from favorites"><svg class="i i-fill"><use href="#i-heart"/></svg></button>
    </div>`;
  $('.fav-open', card).onclick = () => openViewer(f);
  $('.fav-info .btn', card).onclick = () => toggleFav(f);
  return card;
}

let msgTimer;
function favMessage(text) {
  $('#favMsg').textContent = text;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { $('#favMsg').textContent = ''; }, MESSAGE_MS);
}

export function exportFavorites() {
  if (!state.favorites.length) return;
  const blob = new Blob([JSON.stringify(state.favorites, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `panels-favorites-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  favMessage(`Exported ${plural(state.favorites.length)}`);
}

export async function importFavorites(file) {
  let entries;
  try {
    entries = JSON.parse(await file.text());
  } catch {
    entries = null;
  }
  if (!Array.isArray(entries)) {
    favMessage('That file isn\'t a Panels favorites export.');
    return;
  }
  const valid = entries.filter((f) => f && typeof f.endpoint === 'string' && typeof f.date === 'string');
  const fresh = valid.filter((f) => !isFav(f));
  state.favorites.push(...fresh.map((f) => ({
    endpoint: f.endpoint, date: f.date, title: f.title || '', added: f.added || Date.now(),
  })));
  saveFavorites();
  if (!fresh.length) {
    favMessage('Already up to date');
    return;
  }
  const skipped = valid.length - fresh.length;
  favMessage(`Imported ${plural(fresh.length)}${skipped ? `, ${skipped} already saved` : ''}`);
}
