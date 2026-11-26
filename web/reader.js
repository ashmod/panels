import { badgeUrl, fetchStrip, imageUrl } from './api.js';
import { addComic, openLibrary } from './library.js';
import {
  comicTitle, faceHtml, isFav, ownTitle, paint, paintFav, plateOf, state, stripLabel,
} from './state.js';
import {
  $, $$, currentView, esc, formatDate, isOpen, linkedStrip, motion, pick, reduceMotion, SITE_TITLE,
  stripPath,
} from './util.js';

const STARTERS = [
  'garfield', 'peanuts', 'calvinandhobbes', 'xkcd', 'dilbert', 'phd',
  'pearlsbeforeswine', 'foxtrot', 'nonsequitur', 'doonesbury', 'getfuzzy', 'babyblues',
  'forbetterorforworse', 'boondocks', 'phoebe-and-her-unicorn', 'breaking-cat-news',
];
const SLOW_MS = 3500;
const UPSCALE = 1.5;

function wipeTo(ep) {
  const stage = $('#stage');
  const wipe = $('#stageWipe');
  const [h, c] = plateOf(ep);
  if (state.wipe) {
    state.wipe.anim.cancel();
    paint(stage, state.wipe.ep);
    state.wipe = null;
  }
  const same = stage.style.getPropertyValue('--h') === String(h) && stage.style.getPropertyValue('--c') === String(c);
  if (same) return;
  if (reduceMotion.matches || !stage.style.getPropertyValue('--h')) {
    paint(stage, ep);
    return;
  }
  paint(wipe, ep);
  const anim = wipe.animate(
    [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }],
    { duration: 560, easing: 'cubic-bezier(.7,0,.25,1)', fill: 'forwards' },
  );
  state.wipe = { anim, ep };
  anim.onfinish = () => {
    paint(stage, ep);
    anim.cancel();
    if (state.wipe?.anim === anim) state.wipe = null;
  };
}

export function setStageMode(mode) {
  const empty = mode === 'empty';
  $('#stageEmpty').hidden = !empty;
  $('#stageHead').hidden = empty;
  $('#stripArea').hidden = empty;
  $('#stageFoot').hidden = empty;
}

function showLoading(ep, token) {
  setStageMode('strip');
  const comic = state.byEp.get(ep);
  $('#stripTitle').textContent = comicTitle(ep);
  $('#stripSub').textContent = comic?.author ? `by ${comic.author}` : '';
  $('#stripDate').textContent = '';
  $('#earlierBtn').disabled = true;
  $('#laterBtn').disabled = true;
  $('#latestBtn').hidden = true;
  $('#favBtn').disabled = true;
  $('#stripImg').classList.remove('ready');
  $('#stripDots').hidden = false;
  const status = $('#stripStatus');
  status.hidden = true;
  status.classList.remove('is-note');
  setTimeout(() => {
    if (token !== state.token || $('#stripDots').hidden) return;
    status.hidden = false;
    status.classList.add('is-note');
    status.innerHTML = '<small>Still loading. Some sources take a few seconds.</small>';
  }, SLOW_MS);
}

function showStrip(strip) {
  const comic = state.byEp.get(strip.endpoint);
  const title = comic?.title ?? strip.title;
  const named = ownTitle(strip, title) ? `“${strip.title}” ` : '';
  $('#stripTitle').textContent = title;
  $('#stripSub').textContent = comic?.author ? `${named}by ${comic.author}` : named;
  $('#stripDate').textContent = formatDate(strip.date);
  $('#stripDate').setAttribute('datetime', /^\d{4}-/.test(strip.date) ? strip.date : '');
  $('#earlierBtn').disabled = !strip.prevDate;
  $('#laterBtn').disabled = !strip.nextDate;
  $('#latestBtn').hidden = !strip.nextDate;
  $('#favBtn').disabled = false;
  $('#stripDots').hidden = true;
  $('#stripStatus').hidden = true;
  const img = $('#stripImg');
  img.classList.remove('ready');
  img.style.width = '';
  img.alt = `${title}, ${formatDate(strip.date)}`;
  img.onload = () => {
    img.style.width = `${img.naturalWidth * UPSCALE}px`;
    img.classList.add('ready');
  };
  img.src = imageUrl(strip);
  syncFavButton();
}

function showError(ep) {
  $('#stripDots').hidden = true;
  const status = $('#stripStatus');
  status.hidden = false;
  status.classList.remove('is-note');
  status.innerHTML = `
    <span>This ${esc(comicTitle(ep))} strip didn't load.</span>
    <small>The source didn't respond in time. Try again, or shuffle to another comic.</small>
    <button class="btn btn-primary" type="button" id="retryBtn">Try again</button>`;
  $('#retryBtn').onclick = () => read(ep, state.lastRequest?.date ?? 'random');
}

export function showBootError() {
  setStageMode('strip');
  $('#stripTitle').textContent = 'Comics didn\'t load';
  $('#stripSub').textContent = 'The Panels server didn\'t respond. Check that it is running, then reload the page.';
  $('#stripDots').hidden = true;
  $('#stageFoot').hidden = true;
}

async function present(ep, promise, date) {
  const token = ++state.token;
  state.stageEp = ep;
  state.lastRequest = { ep, date };
  state.strip = null;
  markCast();
  wipeTo(ep);
  showLoading(ep, token);
  try {
    const strip = await promise;
    if (token !== state.token) return;
    state.strip = strip;
    showStrip(strip);
    syncUrl();
    prefetchNext();
  } catch {
    if (token !== state.token) return;
    showError(ep);
  }
}

export function read(ep, date = 'random') {
  present(ep, fetchStrip(ep, date), date);
}

function pickEp() {
  const others = state.selected.filter((ep) => ep !== state.stageEp);
  return pick(others.length ? others : state.selected);
}

function prefetchNext() {
  if (!state.selected.length) return;
  const ep = pickEp();
  const promise = fetchStrip(ep, 'random');
  promise.catch(() => {});
  state.prefetched = { ep, promise };
}

export function shuffle() {
  if (!state.selected.length) return openLibrary();
  let job = state.prefetched;
  state.prefetched = null;
  if (!job || !state.selected.includes(job.ep) || job.ep === state.stageEp) {
    const ep = pickEp();
    job = { ep, promise: fetchStrip(ep, 'random') };
  }
  present(job.ep, job.promise, 'random');
}

export function step(dir) {
  const s = state.strip;
  const date = s && (dir < 0 ? s.prevDate : s.nextDate);
  if (date) read(s.endpoint, date);
}

export function readLatest() {
  if (state.strip) read(state.strip.endpoint, 'latest');
}

export function renderStage() {
  if (!state.selected.length) {
    state.token++;
    state.stageEp = null;
    state.strip = null;
    setStageMode('empty');
    wipeTo(null);
    renderStarters();
    syncUrl();
    return;
  }
  if (!state.stageEp || !state.selected.includes(state.stageEp)) shuffle();
  syncUrl();
}

// Replacing rather than pushing keeps Back meaning "leave the reader", not "previous strip".
function syncUrl() {
  if (currentView() !== 'read' || (state.stageEp && !state.strip)) return;
  const { strip } = state;
  const path = strip ? stripPath(strip) : '/';
  if (location.pathname !== path) history.replaceState(null, '', path);
  document.title = strip
    ? `${comicTitle(strip.endpoint)} · ${stripLabel(strip, 'short')} | panels`
    : SITE_TITLE;
}

const isShowing = ({ ep, date }) => (state.strip
  ? state.strip.endpoint === ep && state.strip.date === date
  : state.lastRequest?.ep === ep && state.lastRequest.date === date);

export function showRead() {
  const linked = linkedStrip();
  if (!linked || !state.byEp.has(linked.ep)) {
    renderStage();
    return;
  }
  if (isShowing(linked)) syncUrl();
  else read(linked.ep, linked.date);
}

const picks = new Set();

function syncStartButton() {
  const btn = $('#startBtn');
  const n = picks.size;
  btn.disabled = !n;
  btn.textContent = n ? `Start with ${n === 1 ? '1 comic' : `${n} comics`}` : 'Start reading';
}

export function commitPicks() {
  picks.forEach(addComic);
  picks.clear();
}

function startReading() {
  if (!picks.size) return;
  commitPicks();
  renderStage();
}

function renderStarters() {
  picks.clear();
  $('#starters').replaceChildren(...STARTERS.filter((ep) => state.byEp.has(ep)).map((ep) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'starter';
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `${faceHtml(ep)}${esc(comicTitle(ep))}<svg class="i starter-check"><use href="#i-check"/></svg>`;
    b.onclick = () => {
      if (picks.has(ep)) picks.delete(ep);
      else picks.add(ep);
      b.setAttribute('aria-pressed', String(picks.has(ep)));
      syncStartButton();
    };
    return b;
  }));
  $('#startBtn').onclick = startReading;
  syncStartButton();
}

export function syncFavButton() {
  const on = !!state.strip && isFav(state.strip);
  paintFav($('#favBtn'), on);
}

export function renderCast() {
  const animate = !isOpen('library') && !reduceMotion.matches;
  const members = state.selected.map((ep) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cast-member';
    if (animate && state.arrivals.has(ep)) b.classList.add('is-new');
    b.dataset.ep = ep;
    b.setAttribute('aria-label', `Read ${comicTitle(ep)}`);
    b.innerHTML = `<span class="balloon">${esc(comicTitle(ep))}</span><img src="${badgeUrl(ep)}" alt="" draggable="false">`;
    b.onclick = () => read(ep);
    return b;
  });
  if (animate) state.arrivals.clear();
  $('#cast').replaceChildren(...members);
  markCast();
}

// scrollIntoView would also scroll the cast vertically while a new member is still sliding up from
// below, leaving every figure lifted, so only the horizontal position is adjusted.
function revealInCast(b) {
  const cast = $('#cast');
  const start = b.offsetLeft;
  const end = start + b.offsetWidth;
  let left = cast.scrollLeft;
  if (start < left) left = start;
  else if (end > left + cast.clientWidth) left = end - cast.clientWidth;
  if (left !== cast.scrollLeft) cast.scrollTo({ left, behavior: motion() });
}

function markCast() {
  $$('.cast-member[data-ep]').forEach((b) => {
    if (b.dataset.ep !== state.stageEp) return b.removeAttribute('aria-current');
    b.setAttribute('aria-current', 'true');
    revealInCast(b);
  });
}
