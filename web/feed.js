import { fetchRandom, imageUrl } from './api.js';
import { toggleFav } from './favorites.js';
import { read } from './reader.js';
import { navigate } from './router.js';
import { comicTitle, faceHtml, isFav, state, stripLabel } from './state.js';
import { openViewer } from './viewer.js';
import { $, currentView, esc, formatDate } from './util.js';

const BATCH = 4;
const AHEAD_PX = 1500;
const EMPTY_RETRY_MS = 15000;
const MIN_PAUSE_S = 5;

const feed = {
  loading: false, deck: [], only: null, generation: 0, resumeAt: 0, timer: null,
};

function feedPool() {
  return feed.only && state.selected.includes(feed.only) ? [feed.only] : state.selected;
}

function drawFromDeck() {
  if (!feed.deck.length) {
    feed.deck = [...feedPool()];
    for (let i = feed.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [feed.deck[i], feed.deck[j]] = [feed.deck[j], feed.deck[i]];
    }
  }
  return feed.deck.pop();
}

export function renderFeedFilter() {
  $('#feedFilterWrap').hidden = !state.selected.length;
  const make = (ep) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = ep ? 'filter-pill' : 'filter-pill only-text';
    b.setAttribute('aria-pressed', String(feed.only === ep));
    b.innerHTML = ep ? `${faceHtml(ep)}${esc(comicTitle(ep))}` : 'Everything';
    b.onclick = () => {
      feed.only = ep;
      renderFeedFilter();
      resetFeed();
    };
    return b;
  };
  const pills = state.selected.length > 1 ? [make(null), ...state.selected.map(make)] : [];
  $('#feedFilter').replaceChildren(...pills);
}

function postEl(ep) {
  const el = document.createElement('article');
  el.className = 'post';
  el.dataset.ep = ep;
  el.innerHTML = `
    <header class="post-head">
      ${faceHtml(ep)}
      <div class="post-meta">
        <h2 class="letter">${esc(comicTitle(ep))}</h2>
        <span class="post-date">&nbsp;</span>
      </div>
      <div class="post-actions"></div>
    </header>
    <div class="post-strip"><div class="dots"></div></div>`;
  return el;
}

function fillPost(el, strip) {
  $('.post-date', el).textContent = stripLabel(strip, 'long');
  const actions = $('.post-actions', el);
  actions.innerHTML = `
    <button class="btn btn-round" type="button" data-fav><svg class="i"><use href="#i-heart"/></svg></button>
    <button class="btn btn-round" type="button" data-read aria-label="Open in the reader"><svg class="i"><use href="#i-right"/></svg></button>`;
  const favBtn = $('[data-fav]', actions);
  const sync = () => {
    const on = isFav(strip);
    favBtn.setAttribute('aria-pressed', String(on));
    favBtn.setAttribute('aria-label', on ? 'Remove from favorites' : 'Add to favorites');
    $('svg', favBtn).classList.toggle('i-fill', on);
  };
  favBtn.onclick = () => { toggleFav(strip); sync(); };
  $('[data-read]', actions).onclick = () => {
    navigate('/');
    read(strip.endpoint, strip.date);
  };
  sync();
  const img = new Image();
  img.alt = `${comicTitle(strip.endpoint)}, ${formatDate(strip.date)}`;
  img.draggable = false;
  img.onclick = () => openViewer(strip);
  img.onload = () => $('.post-strip', el).replaceChildren(img);
  img.onerror = () => el.remove();
  img.src = imageUrl(strip);
}

const nearEnd = () => $('#feedEnd').getBoundingClientRect().top < innerHeight + AHEAD_PX;

function showNote(text) {
  const note = $('#feedNote');
  note.textContent = text;
  note.hidden = !text;
}

function clearPause() {
  clearTimeout(feed.timer);
  feed.resumeAt = 0;
  showNote('');
}

function pauseFeed(ms, message) {
  feed.resumeAt = Date.now() + ms;
  showNote(message);
  clearTimeout(feed.timer);
  feed.timer = setTimeout(() => {
    clearPause();
    if (currentView() === 'feed' && nearEnd()) loadFeedBatch();
  }, ms);
}

// Strips load one at a time: parallel requests are what trip GoComics' rate limit.
export async function loadFeedBatch() {
  if (feed.loading || !state.selected.length || Date.now() < feed.resumeAt) return;
  feed.loading = true;
  const generation = feed.generation;
  let loaded = 0;
  for (let i = 0; i < BATCH; i++) {
    const el = postEl(drawFromDeck());
    $('#feedList').append(el);
    try {
      const strip = await fetchRandom(el.dataset.ep);
      if (generation !== feed.generation) return;
      fillPost(el, strip);
      loaded++;
    } catch (err) {
      if (generation !== feed.generation) return;
      el.remove();
      if (err.status === 503) {
        pauseFeed(
          Math.max(err.retryAfter, MIN_PAUSE_S) * 1000,
          'GoComics is limiting requests. More strips in a minute.',
        );
        break;
      }
    }
  }
  feed.loading = false;
  if (feed.resumeAt) return;
  if (!loaded) {
    pauseFeed(EMPTY_RETRY_MS, 'These strips didn\'t load. Trying again in a few seconds.');
    return;
  }
  // The observer only fires on intersection changes, so a short batch would otherwise stall.
  if (currentView() === 'feed' && nearEnd()) loadFeedBatch();
}

export function resetFeed() {
  feed.generation++;
  feed.loading = false;
  feed.deck = [];
  clearPause();
  $('#feedList').replaceChildren();
  $('#feedEmpty').hidden = state.selected.length > 0;
  if (state.selected.length) loadFeedBatch();
}

export function initFeed() {
  new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && currentView() === 'feed') loadFeedBatch();
  }, { rootMargin: `${AHEAD_PX}px` }).observe($('#feedEnd'));
}
