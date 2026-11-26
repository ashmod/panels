import { badgeUrl, fetchStrip, imageUrl } from './api.js';
import { toggleFav } from './favorites.js';
import { addComic } from './library.js';
import { navigate } from './router.js';
import { downloadStrip, paintShare, shareStrip, warmShare } from './share.js';
import { comicTitle, favKey, isFav, ownTitle, paint, paintFav, state, stripLabel } from './state.js';
import { openViewer } from './viewer.js';
import { $, formatDate, linkedStrip, stripPath } from './util.js';

let shown = null;
let shownTitle = '';
let token = 0;

function setTitle(text) {
  shownTitle = `${text} | panels`;
  document.title = shownTitle;
}

function showFailed() {
  $('#sharedDots').hidden = true;
  $('#sharedStatus').hidden = false;
  shown = null;
}

function fill(strip) {
  const ep = strip.endpoint;
  const comic = state.byEp.get(ep);
  const title = comicTitle(ep);
  const named = ownTitle(strip, title) ? `“${strip.title}” ` : '';
  $('#sharedSub').textContent = comic?.author ? `${named}by ${comic.author}` : named;
  $('#sharedDate').textContent = formatDate(strip.date);
  $('#sharedDate').setAttribute('datetime', /^\d{4}-/.test(strip.date) ? strip.date : '');

  const img = $('#sharedImg');
  img.alt = `${title}, ${formatDate(strip.date)}`;
  img.src = imageUrl(strip);
  img.onclick = () => openViewer(strip);
  img.hidden = false;
  $('#sharedDots').hidden = true;

  const fav = $('#sharedFav');
  fav.dataset.fav = favKey(strip);
  paintFav(fav, isFav(strip));
  fav.onclick = () => toggleFav(strip);
  $('#sharedDownload').onclick = () => downloadStrip(strip);
  const share = $('#sharedShare');
  paintShare(share);
  share.onclick = () => shareStrip(strip);
  warmShare(strip);

  $('#sharedReadLabel').textContent = `Read more ${title}`;
  $('#sharedRead').onclick = () => {
    addComic(ep);
    navigate(stripPath(strip));
  };
  $('#sharedFoot').hidden = false;
  setTitle(`${title} · ${stripLabel(strip, 'short')}`);
}

export async function renderSharedStrip() {
  const linked = linkedStrip();
  const key = linked && `${linked.ep}:${linked.date}`;
  if (key && key === shown) {
    document.title = shownTitle;
    return;
  }
  shown = key;
  const t = ++token;

  const ep = linked?.ep;
  const known = Boolean(ep && state.byEp.has(ep));
  paint($('#shared'), known ? ep : null);
  $('#sharedPeek').parentElement.hidden = !known;
  if (known) $('#sharedPeek').src = badgeUrl(ep);
  $('#sharedTitle').textContent = known ? comicTitle(ep) : 'Strip not found';
  $('#sharedSub').textContent = '';
  $('#sharedDate').textContent = '';
  $('#sharedImg').hidden = true;
  $('#sharedDots').hidden = false;
  $('#sharedStatus').hidden = true;
  $('#sharedFoot').hidden = true;
  setTitle(known ? comicTitle(ep) : 'Strip not found');
  if (!known) {
    showFailed();
    return;
  }

  try {
    const strip = await fetchStrip(ep, linked.date);
    if (t === token) fill(strip);
  } catch {
    if (t === token) showFailed();
  }
}
