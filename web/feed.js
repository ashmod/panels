import { state, hashColor, stripKey, saveFavorites, isFavorited } from './state.js';
import { fetchStrip } from './api.js';
import { escapeHtml } from './helpers.js';
import { els } from './els.js';
import { openFeedZoom } from './zoom.js';
import { updateFavoriteButton } from './favorites.js';

function createSkeletonCard() {
  const card = document.createElement('article');
  card.className = 'feed-card feed-card-skeleton';
  card.innerHTML =
    '<div class="feed-card-header">' +
      '<div class="feed-card-badge skeleton-pulse"></div>' +
      '<div class="feed-card-info">' +
        '<div class="skeleton-pulse" style="width:120px;height:14px;"></div>' +
        '<div class="skeleton-pulse" style="width:80px;height:11px;margin-top:4px;"></div>' +
      '</div>' +
    '</div>' +
    '<div class="feed-card-image skeleton-pulse"></div>';
  return card;
}

function renderFeedCard(strip, comic) {
  const card = document.createElement('article');
  card.className = 'feed-card';

  const author = comic && comic.author ? comic.author : '';
  const authorHtml = author ? '<span class="feed-card-sub">by ' + escapeHtml(author) + ' &mdash; ' + escapeHtml(strip.date) + '</span>' : '<span class="feed-card-sub">' + escapeHtml(strip.date) + '</span>';
  const color = hashColor(strip.endpoint);

  const faved = isFavorited(strip.endpoint, strip.date);

  card.innerHTML =
    '<div class="feed-card-header">' +
      '<div class="feed-card-badge">' +
        '<div class="badge-circle-bg" style="background:' + color + ';"></div>' +
        '<img src="/api/badges/' + encodeURIComponent(strip.endpoint) + '.png" alt="" onerror="this.style.display=\'none\'">' +
      '</div>' +
      '<div class="feed-card-info">' +
        '<span class="feed-card-title">' + escapeHtml(strip.title) + '</span>' +
        authorHtml +
      '</div>' +
      '<button class="feed-card-fav' + (faved ? ' favorited' : '') + '" aria-label="Toggle favorite">' +
        '<i class="' + (faved ? 'fa-solid' : 'fa-regular') + ' fa-heart"></i>' +
      '</button>' +
    '</div>' +
    '<div class="feed-card-image">' +
      '<img src="/api/comics/' + encodeURIComponent(strip.endpoint) + '/' + encodeURIComponent(strip.date) + '/image" alt="' + escapeHtml(strip.title) + '" loading="lazy">' +
    '</div>';

  const cardImg = card.querySelector('.feed-card-image img');
  if (cardImg) {
    cardImg.addEventListener('click', () => openFeedZoom(cardImg.src));
  }

  const favBtn = card.querySelector('.feed-card-fav');
  if (favBtn) {
    favBtn.addEventListener('click', () => {
      const idx = state.favorites.findIndex((f) => f.endpoint === strip.endpoint && f.date === strip.date);
      if (idx >= 0) {
        state.favorites.splice(idx, 1);
        favBtn.classList.remove('favorited');
        favBtn.innerHTML = '<i class="fa-regular fa-heart"></i>';
      } else {
        state.favorites.push({ endpoint: strip.endpoint, date: strip.date, title: strip.title, added: Date.now() });
        favBtn.classList.add('favorited');
        favBtn.innerHTML = '<i class="fa-solid fa-heart"></i>';
      }
      saveFavorites();
      updateFavoriteButton();
    });
  }

  return card;
}

async function fetchRandomFeedStrip() {
  const endpoints = Array.from(state.selectedEndpoints);
  if (endpoints.length === 0) return null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
    try {
      const strip = await fetchStrip(endpoint, 'random');
      const key = stripKey(strip);
      if (attempt < 2 && state.feed.seenKeys.has(key)) continue;
      state.feed.seenKeys.add(key);
      return strip;
    } catch (e) {
      if (attempt === 2) return null;
    }
  }
  return null;
}

export async function loadFeedBatch() {
  if (state.feed.isLoadingBatch || state.selectedEndpoints.size === 0) return;
  state.feed.isLoadingBatch = true;

  const skeletons = [];
  for (let i = 0; i < 6; i++) {
    const skel = createSkeletonCard();
    els.feedScroll.appendChild(skel);
    skeletons.push(skel);
  }

  const promises = [];
  for (let i = 0; i < 6; i++) {
    promises.push(fetchRandomFeedStrip());
  }
  const results = await Promise.allSettled(promises);

  let loaded = 0;
  results.forEach((result, i) => {
    const strip = result.status === 'fulfilled' ? result.value : null;
    if (strip) {
      const comic = state.allComics.find((c) => c.endpoint === strip.endpoint);
      const card = renderFeedCard(strip, comic);
      skeletons[i].replaceWith(card);
      state.feed.strips.push(strip);
      loaded++;
    } else {
      skeletons[i].remove();
    }
  });

  if (state.feed.strips.length === 0) {
    els.feedEmpty.classList.remove('hidden');
  }

  state.feed.isLoadingBatch = false;
}

export function clearFeed() {
  state.feed.strips = [];
  state.feed.seenKeys = new Set();
  state.feed.isLoadingBatch = false;
  els.feedScroll.innerHTML = '';
  els.feedEmpty.classList.add('hidden');
}

export function initFeedScroll() {
  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && state.currentView === 'feed') {
      loadFeedBatch();
    }
  }, { root: els.feedContainer, rootMargin: '400px' });
  observer.observe(els.feedSentinel);
}
