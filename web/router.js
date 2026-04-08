import { state } from './state.js';
import { els } from './els.js';
import { clearFeed, loadFeedBatch } from './feed.js';
import { renderFavGallery } from './favorites.js';

function switchToFeed() {
  state.currentView = 'feed';
  document.body.classList.add('view-feed');
  document.body.classList.remove('view-panel', 'view-favorites');
  els.feedContainer.classList.remove('hidden');
  els.favContainer.classList.add('hidden');
  els.navFeedLink.classList.add('active');
  els.navFavLink.classList.remove('active');

  const snapshot = Array.from(state.selectedEndpoints).sort().join(',');
  if (state.feed.lastSelectedSnapshot !== snapshot) {
    clearFeed();
    state.feed.lastSelectedSnapshot = snapshot;
  }

  if (state.selectedEndpoints.size === 0) {
    els.feedEmpty.classList.remove('hidden');
  } else if (state.feed.strips.length === 0 && !state.feed.isLoadingBatch) {
    els.feedEmpty.classList.add('hidden');
    loadFeedBatch();
  }
}

function switchToPanel() {
  state.currentView = 'panel';
  document.body.classList.remove('view-feed', 'view-favorites');
  document.body.classList.add('view-panel');
  els.navFeedLink.classList.remove('active');
  els.navFavLink.classList.remove('active');
  els.favContainer.classList.add('hidden');
}

function switchToFavorites() {
  state.currentView = 'favorites';
  document.body.classList.add('view-favorites');
  document.body.classList.remove('view-panel', 'view-feed');
  els.favContainer.classList.remove('hidden');
  els.feedContainer.classList.add('hidden');
  els.navFavLink.classList.add('active');
  els.navFeedLink.classList.remove('active');
  renderFavGallery();
}

function handleRoute() {
  if (location.pathname === '/feed') {
    switchToFeed();
  } else if (location.pathname === '/favorites') {
    switchToFavorites();
  } else {
    switchToPanel();
  }
}

function navigateTo(path) {
  if (location.pathname !== path) {
    history.pushState(null, '', path);
  }
  handleRoute();
}

export function initRouter() {
  window.addEventListener('popstate', handleRoute);

  els.navFeedLink.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo('/feed');
  });

  els.navFavLink.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo('/favorites');
  });

  els.logoLink.addEventListener('click', () => {
    navigateTo('/');
  });

  handleRoute();
}
