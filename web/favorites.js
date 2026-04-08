import { state, saveFavorites, isFavorited } from './state.js';
import { escapeHtml } from './helpers.js';
import { els } from './els.js';
import { openFeedZoom } from './zoom.js';

export function toggleFavorite() {
  if (!state.currentStrip) return;
  const { endpoint, date, title } = state.currentStrip;
  const idx = state.favorites.findIndex((f) => f.endpoint === endpoint && f.date === date);
  if (idx >= 0) {
    state.favorites.splice(idx, 1);
  } else {
    state.favorites.push({ endpoint, date, title, added: Date.now() });
  }
  saveFavorites();
  updateFavoriteButton();
  if (state.currentView === 'favorites') renderFavGallery();
}

export function updateFavoriteButton() {
  if (!state.currentStrip) {
    els.btnFavorite.classList.add('hidden');
    return;
  }
  els.btnFavorite.classList.remove('hidden');
  const faved = isFavorited(state.currentStrip.endpoint, state.currentStrip.date);
  els.btnFavorite.classList.toggle('favorited', faved);
  els.btnFavorite.innerHTML = faved
    ? '<i class="fa-solid fa-heart"></i>'
    : '<i class="fa-regular fa-heart"></i>';
}

function formatFavDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = today - target;
  if (diff === 0) return 'Today';
  if (diff === 86400000) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function renderFavGallery() {
  els.favExportBtn.disabled = state.favorites.length === 0;
  if (state.favorites.length === 0) {
    els.favEmpty.classList.remove('hidden');
    els.favGallery.classList.add('hidden');
    return;
  }
  els.favEmpty.classList.add('hidden');
  els.favGallery.classList.remove('hidden');
  els.favGallery.innerHTML = '';

  const sorted = [...state.favorites].sort((a, b) => b.added - a.added);

  const groups = [];
  sorted.forEach((fav) => {
    const label = formatFavDate(fav.added);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.items.push(fav);
    } else {
      groups.push({ label, items: [fav] });
    }
  });

  groups.forEach((group) => {
    const header = document.createElement('div');
    header.className = 'fav-group-header';
    header.textContent = group.label;
    els.favGallery.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'fav-group-grid';

    group.items.forEach((fav) => {
      const card = document.createElement('div');
      card.className = 'fav-card';

      const imgSrc = `/api/comics/${encodeURIComponent(fav.endpoint)}/${encodeURIComponent(fav.date)}/image`;

      const img = document.createElement('img');
      img.className = 'fav-card-img';
      img.src = imgSrc;
      img.alt = fav.title;
      img.loading = 'lazy';
      img.addEventListener('click', () => {
        openFeedZoom(imgSrc);
      });

      const overlay = document.createElement('div');
      overlay.className = 'fav-card-overlay';

      const info = document.createElement('div');
      info.className = 'fav-card-info';
      info.innerHTML = '<span class="fav-card-title">' + escapeHtml(fav.title) + '</span>' +
        '<span class="fav-card-date">' + escapeHtml(fav.date) + '</span>';

      const unfav = document.createElement('button');
      unfav.className = 'fav-card-unfav';
      unfav.innerHTML = '<i class="fa-solid fa-heart"></i>';
      unfav.title = 'Remove from favorites';
      unfav.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = state.favorites.findIndex((f) => f.endpoint === fav.endpoint && f.date === fav.date);
        if (idx >= 0) state.favorites.splice(idx, 1);
        saveFavorites();
        updateFavoriteButton();
        renderFavGallery();
      });

      overlay.appendChild(info);
      overlay.appendChild(unfav);
      card.appendChild(img);
      card.appendChild(overlay);
      grid.appendChild(card);
    });

    els.favGallery.appendChild(grid);
  });
}

function exportFavorites() {
  if (state.favorites.length === 0) return;
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(state.favorites, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `panels-favorites-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

let _favMsgTimer = null;
function showFavToolbarMsg(msg) {
  els.favToolbarMsg.textContent = msg;
  els.favToolbarMsg.classList.remove('hidden');
  clearTimeout(_favMsgTimer);
  _favMsgTimer = setTimeout(() => els.favToolbarMsg.classList.add('hidden'), 3000);
}

function importFavorites(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    let entries;
    try {
      entries = JSON.parse(e.target.result);
    } catch {
      showFavToolbarMsg('Invalid file');
      return;
    }
    if (!Array.isArray(entries)) {
      showFavToolbarMsg('Invalid file');
      return;
    }
    const valid = entries.filter((f) => f && typeof f.endpoint === 'string' && typeof f.date === 'string');
    let added = 0;
    valid.forEach((f) => {
      if (!state.favorites.some((e) => e.endpoint === f.endpoint && e.date === f.date)) {
        state.favorites.push({ endpoint: f.endpoint, date: f.date, title: f.title || '', added: f.added || Date.now() });
        added++;
      }
    });
    saveFavorites();
    renderFavGallery();
    const skipped = valid.length - added;
    if (added === 0) {
      showFavToolbarMsg('Already up to date');
    } else {
      showFavToolbarMsg('Imported ' + added + ' favorite' + (added !== 1 ? 's' : '') + (skipped > 0 ? ' (' + skipped + ' already existed)' : ''));
    }
  };
  reader.readAsText(file);
}

export function initFavorites() {
  els.btnFavorite.addEventListener('click', toggleFavorite);
  els.favExportBtn.addEventListener('click', exportFavorites);
  els.favImportInput.addEventListener('change', (e) => {
    if (e.target.files[0]) {
      importFavorites(e.target.files[0]);
      e.target.value = '';
    }
  });
}
