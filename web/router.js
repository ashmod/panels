import { renderFavorites } from './favorites.js';
import { renderFeedFilter, resetFeed } from './feed.js';
import { renderStage } from './reader.js';
import { $, $$, currentView } from './util.js';

export function route() {
  const v = currentView();
  $('#viewRead').hidden = v !== 'read';
  $('#viewFeed').hidden = v !== 'feed';
  $('#viewFavorites').hidden = v !== 'favorites';
  $$('.nav a').forEach((a) => {
    if (a.dataset.view === v) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (v === 'read') renderStage();
  if (v === 'feed') {
    renderFeedFilter();
    if (!$('#feedList').children.length) resetFeed();
  }
  if (v === 'favorites') renderFavorites();
  scrollTo(0, 0);
}

export function navigate(path) {
  if (location.pathname !== path) history.pushState(null, '', path);
  route();
}

export function initRouter() {
  addEventListener('popstate', route);
  $$('a.logo, .nav a').forEach((a) => {
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      navigate(a.getAttribute('href'));
    });
  });
}
