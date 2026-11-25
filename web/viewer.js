import { imageUrl } from './api.js';
import { toggleFav } from './favorites.js';
import { comicTitle, favKey, isFav, paintFav, state } from './state.js';
import { $, formatDate, isOpen } from './util.js';

const MIN = 1;
const MAX = 5;

const zoom = { scale: 1, offset: { x: 0, y: 0 }, dragging: false };
const view = { strip: null, opener: null };
let dragStart = { x: 0, y: 0 };
let touchPanStart = null;
let pinchStart = null;

const clampScale = (s) => Math.min(MAX, Math.max(MIN, s));
const touchDistance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
const touchCenter = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });

function render() {
  const img = $('#viewerImg');
  const { scale, offset, dragging } = zoom;
  img.style.transform = `translate(${offset.x}px, ${offset.y}px) scale(${scale})`;
  img.classList.toggle('dragging', dragging);
  img.style.cursor = scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in';
  $('#vLevel').textContent = `${Math.round(scale * 100)}%`;
  $('#vSlider').value = String(Math.round(scale * 100));
}

function setScale(next) {
  zoom.scale = clampScale(next);
  if (zoom.scale <= 1) zoom.offset = { x: 0, y: 0 };
  render();
}

export const zoomBy = (delta) => setScale(zoom.scale + delta);

function resetZoom() {
  zoom.scale = 1;
  zoom.offset = { x: 0, y: 0 };
  zoom.dragging = false;
  render();
}

function syncFav() {
  const btn = $('#vFav');
  btn.dataset.fav = favKey(view.strip);
  paintFav(btn, isFav(view.strip));
}

export function openViewer(strip = state.strip) {
  if (!strip) return;
  view.strip = strip;
  view.opener = document.activeElement;
  const img = $('#viewerImg');
  img.alt = `${comicTitle(strip.endpoint)}, ${formatDate(strip.date)}`;
  img.src = imageUrl(strip);
  resetZoom();
  syncFav();
  $('#viewer').hidden = false;
  $('#app').inert = true;
  $('#viewer').focus();
}

export function closeViewer() {
  $('#viewer').hidden = true;
  pinchStart = null;
  touchPanStart = null;
  resetZoom();
  if (!isOpen('library')) $('#app').inert = false;
  view.opener?.focus?.({ preventScroll: true });
}

function bindMouse(v, wrap, img) {
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomBy(e.deltaY > 0 ? -0.12 : 0.12);
  }, { passive: false });

  img.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (zoom.scale <= 1) return;
    zoom.dragging = true;
    dragStart = { x: e.clientX, y: e.clientY };
    render();
  });
  img.addEventListener('dragstart', (e) => e.preventDefault());

  v.addEventListener('mousemove', (e) => {
    if (!zoom.dragging || zoom.scale <= 1) return;
    zoom.offset.x += e.clientX - dragStart.x;
    zoom.offset.y += e.clientY - dragStart.y;
    dragStart = { x: e.clientX, y: e.clientY };
    render();
  });
  const endDrag = () => {
    if (!zoom.dragging) return;
    zoom.dragging = false;
    render();
  };
  v.addEventListener('mouseup', endDrag);
  v.addEventListener('mouseleave', endDrag);
}

function bindTouch(v, wrap) {
  wrap.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const [a, b] = e.touches;
      zoom.dragging = true;
      pinchStart = {
        distance: touchDistance(a, b),
        scale: zoom.scale,
        center: touchCenter(a, b),
        offset: { ...zoom.offset },
      };
      touchPanStart = null;
      render();
      return;
    }
    if (e.touches.length === 1 && zoom.scale > 1) {
      e.preventDefault();
      zoom.dragging = true;
      touchPanStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      render();
    }
  }, { passive: false });

  wrap.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && pinchStart) {
      e.preventDefault();
      const [a, b] = e.touches;
      const center = touchCenter(a, b);
      zoom.scale = clampScale(pinchStart.scale * (touchDistance(a, b) / pinchStart.distance));
      zoom.offset = {
        x: pinchStart.offset.x + (center.x - pinchStart.center.x),
        y: pinchStart.offset.y + (center.y - pinchStart.center.y),
      };
      render();
      return;
    }
    if (e.touches.length === 1 && zoom.scale > 1 && touchPanStart) {
      e.preventDefault();
      const t = e.touches[0];
      zoom.offset.x += t.clientX - touchPanStart.x;
      zoom.offset.y += t.clientY - touchPanStart.y;
      touchPanStart = { x: t.clientX, y: t.clientY };
      render();
    }
  }, { passive: false });

  wrap.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) pinchStart = null;
    if (e.touches.length === 1 && zoom.scale > 1) {
      zoom.dragging = true;
      touchPanStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else {
      touchPanStart = null;
      zoom.dragging = false;
      if (zoom.scale <= 1) zoom.offset = { x: 0, y: 0 };
    }
    render();
  });

  wrap.addEventListener('touchcancel', () => {
    pinchStart = null;
    touchPanStart = null;
    zoom.dragging = false;
    render();
  });

  // Keep the browser's own page pinch from kicking in when a second finger lands outside the strip.
  const blockNativePinch = (e) => {
    if (e.touches && e.touches.length < 2) return;
    e.preventDefault();
  };
  v.addEventListener('touchstart', blockNativePinch, { passive: false });
  v.addEventListener('touchmove', blockNativePinch, { passive: false });
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((name) => {
    v.addEventListener(name, (e) => e.preventDefault(), { passive: false });
  });
}

export function initViewer() {
  const v = $('#viewer');
  const wrap = $('#viewerWrap');
  const img = $('#viewerImg');
  $('#vIn').onclick = () => zoomBy(0.2);
  $('#vOut').onclick = () => zoomBy(-0.2);
  $('#vReset').onclick = resetZoom;
  $('#vSlider').oninput = (e) => setScale(Number(e.target.value) / 100);
  $('#vClose').onclick = closeViewer;
  $('#vFav').onclick = () => {
    toggleFav(view.strip);
    syncFav();
  };
  $('#viewerStage').addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) closeViewer();
  });
  bindMouse(v, wrap, img);
  bindTouch(v, wrap);
}
