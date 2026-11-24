import { badgeUrl, fetchStrip, imageUrl } from './api.js';
import { addComic, openLibrary } from './library.js';
import { comicTitle, faceHtml, isFav, ownTitle, paint, plateOf, state } from './state.js';
import { $, $$, esc, formatDate, isOpen, motion, pick, reduceMotion } from './util.js';

const STARTERS = ['garfield', 'peanuts', 'calvinandhobbes', 'xkcd', 'dilbert', 'pearlsbeforeswine'];
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
    return;
  }
  if (!state.stageEp || !state.selected.includes(state.stageEp)) shuffle();
}

function renderStarters() {
  $('#starters').replaceChildren(...STARTERS.filter((ep) => state.byEp.has(ep)).map((ep) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'starter';
    b.innerHTML = `${faceHtml(ep)}${esc(comicTitle(ep))}`;
    b.onclick = () => { addComic(ep); read(ep); };
    return b;
  }));
}

export function syncFavButton() {
  const on = !!state.strip && isFav(state.strip);
  const btn = $('#favBtn');
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', on ? 'Remove from favorites' : 'Add to favorites');
  $('#favIcon').classList.toggle('i-fill', on);
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

function markCast() {
  $$('.cast-member[data-ep]').forEach((b) => {
    if (b.dataset.ep !== state.stageEp) return b.removeAttribute('aria-current');
    b.setAttribute('aria-current', 'true');
    b.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: motion() });
  });
}
