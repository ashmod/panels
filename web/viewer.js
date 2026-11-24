import { imageUrl } from './api.js';
import { comicTitle, state } from './state.js';
import { $, formatDate, isOpen } from './util.js';

const MAX_ZOOM = 6;

const view = { scale: 1, x: 0, y: 0, min: 0.2, drag: null, opener: null };

export function openViewer(strip = state.strip) {
  if (!strip) return;
  view.opener = document.activeElement;
  const img = $('#viewerImg');
  img.alt = `${comicTitle(strip.endpoint)}, ${formatDate(strip.date)}`;
  img.style.transform = 'scale(0)';
  img.onload = fitViewer;
  img.src = imageUrl(strip);
  $('#viewer').hidden = false;
  $('#app').inert = true;
  if (img.complete && img.naturalWidth) fitViewer();
  $('#viewer').focus();
}

export function closeViewer() {
  $('#viewer').hidden = true;
  if (!isOpen('library')) $('#app').inert = false;
  view.opener?.focus?.({ preventScroll: true });
}

function fitViewer() {
  const img = $('#viewerImg');
  const s = Math.min((innerWidth * 0.92) / img.naturalWidth, (innerHeight * 0.78) / img.naturalHeight);
  view.min = s;
  setView(s, (innerWidth - img.naturalWidth * s) / 2, (innerHeight - img.naturalHeight * s) / 2 - 24);
}

function setView(scale, x, y) {
  view.scale = Math.min(Math.max(scale, view.min), view.min * MAX_ZOOM);
  view.x = x;
  view.y = y;
  $('#viewerImg').style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  $('#vLevel').textContent = `${Math.round((view.scale / view.min) * 100)}%`;
}

export function zoomAt(factor, cx = innerWidth / 2, cy = innerHeight / 2) {
  const next = Math.min(Math.max(view.scale * factor, view.min), view.min * MAX_ZOOM);
  const k = next / view.scale;
  setView(next, cx - (cx - view.x) * k, cy - (cy - view.y) * k);
}

export function initViewer() {
  const v = $('#viewer');
  const img = $('#viewerImg');
  $('#vIn').onclick = () => zoomAt(1.25);
  $('#vOut').onclick = () => zoomAt(0.8);
  $('#vClose').onclick = closeViewer;
  v.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(e.deltaY < 0 ? 1.12 : 0.89, e.clientX, e.clientY);
  }, { passive: false });
  v.addEventListener('dblclick', (e) => {
    zoomAt(view.scale > view.min * 1.5 ? view.min / view.scale : 2.2, e.clientX, e.clientY);
  });
  v.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.viewer-bar')) return;
    if (e.target === v) {
      closeViewer();
      return;
    }
    view.drag = { x: e.clientX - view.x, y: e.clientY - view.y };
    img.classList.add('dragging');
    v.setPointerCapture(e.pointerId);
  });
  v.addEventListener('pointermove', (e) => {
    if (view.drag) setView(view.scale, e.clientX - view.drag.x, e.clientY - view.drag.y);
  });
  v.addEventListener('pointerup', () => {
    view.drag = null;
    img.classList.remove('dragging');
  });
}
