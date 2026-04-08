import { state, recentStrips, stripKey, trackStrip } from './state.js';
import { fetchComics, fetchStrip } from './api.js';
import { els } from './els.js';
import { loadState, initTheme, initSidebar, initCollapsibles, initSearch, initRecommend, buildFuseIndex, buildTagFilters, buildAlphaBar, renderBadgeGrid, updateNavVisibility, refreshRecommendations, setOnSelectionChanged } from './ui.js';
import { initZoom, resetZoom, applyScale, initFeedZoom, closeFeedZoom } from './zoom.js';
import { initFavorites, toggleFavorite, updateFavoriteButton } from './favorites.js';
import { clearFeed, loadFeedBatch, initFeedScroll } from './feed.js';
import { initRouter } from './router.js';

function showComic(strip) {
  state.currentStrip = strip;
  els.comicEmpty.classList.add('hidden');
  els.comicLoading.classList.add('hidden');
  els.comicDisplay.classList.remove('hidden');
  els.comicNavBar.classList.remove('hidden');

  const comic = state.allComics.find((c) => c.endpoint === strip.endpoint);
  const author = comic && comic.author ? ` by ${comic.author}` : '';
  els.comicMeta.textContent = `[ ${strip.title} ]${author} — ${strip.date}`;
  els.comicImage.src = `/api/comics/${encodeURIComponent(strip.endpoint)}/${encodeURIComponent(strip.date)}/image`;
  resetZoom();

  updateNavVisibility();
  updateFavoriteButton();
}

function showEmpty() {
  state.currentStrip = null;
  els.comicEmpty.classList.remove('hidden');
  els.comicLoading.classList.add('hidden');
  els.comicDisplay.classList.add('hidden');
  els.comicNavBar.classList.add('hidden');
  resetZoom();
}

function showLoading() {
  state.isLoading = true;
  els.comicEmpty.classList.add('hidden');
  els.comicLoading.classList.remove('hidden');
  els.comicDisplay.classList.add('hidden');
  els.comicNavBar.classList.add('hidden');
  resetZoom();
}

function showError() {
  els.comicLoading.classList.add('hidden');
  els.comicEmpty.classList.remove('hidden');
  els.comicEmpty.querySelector('span').textContent = '[ strip not found — try again ]';
  els.comicDisplay.classList.add('hidden');
  resetZoom();
  updateNavVisibility();
}

async function nextPanel() {
  if (state.selectedEndpoints.size === 0 || state.isLoading) return;
  const endpoints = Array.from(state.selectedEndpoints);
  showLoading();

  for (let attempt = 0; attempt < 3; attempt++) {
    const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
    try {
      const strip = await fetchStrip(endpoint, 'random');
      if (attempt < 2 && recentStrips.includes(stripKey(strip))) {
        continue;
      }
      trackStrip(strip);
      showComic(strip);
      state.isLoading = false;
      return;
    } catch (e) {
      if (attempt === 2) showError();
    }
  }
  state.isLoading = false;
}

async function todayPanel() {
  if (state.isLoading) return;
  const endpoint = state.currentStrip
    ? state.currentStrip.endpoint
    : (state.selectedEndpoints.size === 1 ? Array.from(state.selectedEndpoints)[0] : null);
  if (!endpoint) return;
  showLoading();
  try {
    const strip = await fetchStrip(endpoint, 'latest');
    showComic(strip);
  } catch (e) {
    showError();
  }
  state.isLoading = false;
}

function initNav() {
  els.btnNextPanel.addEventListener('click', nextPanel);
  els.btnToday.addEventListener('click', todayPanel);
}

function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, button, select, textarea, a, [contenteditable]')) return;

    if (e.key === 'Escape' && !els.feedZoomOverlay.classList.contains('hidden')) {
      closeFeedZoom();
      e.preventDefault();
      return;
    }

    if (state.currentStrip && (e.key === '+' || e.key === '=')) { applyScale(state.zoom.scale + 0.2); e.preventDefault(); return; }
    if (state.currentStrip && e.key === '-') { applyScale(state.zoom.scale - 0.2); e.preventDefault(); return; }
    if (state.currentStrip && (e.key === '0' || e.key === 'Escape')) { resetZoom(); e.preventDefault(); return; }
    if ((e.key === ' ' || e.key === 'ArrowRight') && state.currentView === 'panel') { nextPanel(); e.preventDefault(); }
    if (e.key === 'f' && state.currentView === 'panel' && state.currentStrip) { toggleFavorite(); e.preventDefault(); }
  });
}

// Wire up feed sync when selections change in the sidebar
setOnSelectionChanged(() => {
  if (state.currentView === 'feed') {
    clearFeed();
    state.feed.lastSelectedSnapshot = Array.from(state.selectedEndpoints).sort().join(',');
    if (state.selectedEndpoints.size > 0) {
      loadFeedBatch();
    } else {
      els.feedEmpty.classList.remove('hidden');
    }
  }
});

async function init() {
  loadState();
  initTheme();
  initSidebar();
  initCollapsibles();
  initSearch();
  initRecommend();
  initNav();
  initFavorites();
  initZoom();
  initKeyboard();
  initFeedScroll();
  initFeedZoom();

  try {
    state.allComics = await fetchComics();
    buildFuseIndex(state.allComics);
    buildTagFilters();
    buildAlphaBar();
    renderBadgeGrid();

    if (state.selectedEndpoints.size > 0) {
      updateNavVisibility();
      if (state.recommendEnabled) refreshRecommendations();
    }

    initRouter();
  } catch (e) {
    els.badgeGrid.innerHTML = '<div class="badge-section-header">[ error loading comics ]</div>';
  }
}

init();
