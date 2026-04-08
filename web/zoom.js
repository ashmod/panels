import { state } from './state.js';
import { clearSelection } from './helpers.js';
import { els } from './els.js';

let dragStart = { x: 0, y: 0 };
let touchPanStart = null;
let pinchStart = null;

export function clampScale(s) {
  return Math.min(5, Math.max(1, s));
}

function getTouchDistance(t1, t2) {
  return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
}

function getTouchCenter(t1, t2) {
  return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
}

export function applyScale(nextScale) {
  const clamped = clampScale(nextScale);
  state.zoom.scale = clamped;
  if (clamped <= 1) {
    state.zoom.offset = { x: 0, y: 0 };
  }
  updateZoomTransform();
}

function pan(dx, dy) {
  if (state.zoom.scale <= 1) return;
  state.zoom.offset.x += dx;
  state.zoom.offset.y += dy;
  updateZoomTransform();
}

export function resetZoom() {
  state.zoom.scale = 1;
  state.zoom.offset = { x: 0, y: 0 };
  state.zoom.dragging = false;
  updateZoomTransform();
}

function updateZoomTransform() {
  const { scale, offset, dragging } = state.zoom;
  const img = els.comicImage;
  img.style.transform = `translate(${offset.x}px, ${offset.y}px) scale(${scale})`;
  img.classList.toggle('dragging', dragging);

  if (scale > 1) {
    img.style.cursor = dragging ? 'grabbing' : 'grab';
  } else {
    img.style.cursor = 'zoom-in';
  }

  els.zoomLevel.textContent = `${Math.round(scale * 100)}%`;
  els.zoomSlider.value = String(Math.round(scale * 100));
}

export function initZoom() {
  const wrap = els.comicImageWrap;

  els.zoomOutBtn.addEventListener('click', () => applyScale(state.zoom.scale - 0.2));
  els.zoomInBtn.addEventListener('click', () => applyScale(state.zoom.scale + 0.2));
  els.zoomResetBtn.addEventListener('click', resetZoom);
  els.zoomSlider.addEventListener('input', () => {
    applyScale(Number(els.zoomSlider.value) / 100);
  });

  wrap.addEventListener('wheel', (e) => {
    if (!state.currentStrip) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.12 : 0.12;
    applyScale(state.zoom.scale + delta);
  }, { passive: false });

  els.comicImage.addEventListener('mousedown', (e) => {
    if (!state.currentStrip) return;
    e.preventDefault();
    clearSelection();
    if (state.zoom.scale <= 1) return;
    state.zoom.dragging = true;
    dragStart = { x: e.clientX, y: e.clientY };
    updateZoomTransform();
  });

  els.comicImage.addEventListener('dragstart', (e) => {
    e.preventDefault();
  });

  wrap.addEventListener('mousemove', (e) => {
    if (!state.zoom.dragging || state.zoom.scale <= 1) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    state.zoom.offset.x += dx;
    state.zoom.offset.y += dy;
    dragStart = { x: e.clientX, y: e.clientY };
    updateZoomTransform();
  });

  wrap.addEventListener('mouseup', () => {
    state.zoom.dragging = false;
    updateZoomTransform();
  });

  wrap.addEventListener('mouseleave', () => {
    state.zoom.dragging = false;
    updateZoomTransform();
  });

  wrap.addEventListener('touchstart', (e) => {
    if (!state.currentStrip) return;
    clearSelection();
    if (e.touches.length === 2) {
      e.preventDefault();
      state.zoom.dragging = true;
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      pinchStart = {
        distance: getTouchDistance(t1, t2),
        scale: state.zoom.scale,
        center: getTouchCenter(t1, t2),
        offset: { ...state.zoom.offset },
      };
      touchPanStart = null;
      updateZoomTransform();
      return;
    }
    if (e.touches.length === 1 && state.zoom.scale > 1) {
      e.preventDefault();
      state.zoom.dragging = true;
      touchPanStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      updateZoomTransform();
    }
  }, { passive: false });

  wrap.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && pinchStart) {
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const currentDist = getTouchDistance(t1, t2);
      const currentCenter = getTouchCenter(t1, t2);
      const ratio = currentDist / pinchStart.distance;
      const nextScale = clampScale(pinchStart.scale * ratio);
      state.zoom.scale = nextScale;
      state.zoom.offset = {
        x: pinchStart.offset.x + (currentCenter.x - pinchStart.center.x),
        y: pinchStart.offset.y + (currentCenter.y - pinchStart.center.y),
      };
      updateZoomTransform();
      return;
    }
    if (e.touches.length === 1 && state.zoom.scale > 1 && touchPanStart) {
      e.preventDefault();
      const touch = e.touches[0];
      const dx = touch.clientX - touchPanStart.x;
      const dy = touch.clientY - touchPanStart.y;
      pan(dx, dy);
      touchPanStart = { x: touch.clientX, y: touch.clientY };
    }
  }, { passive: false });

  wrap.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) pinchStart = null;
    if (e.touches.length === 0) {
      touchPanStart = null;
      state.zoom.dragging = false;
      updateZoomTransform();
    } else if (e.touches.length === 1 && state.zoom.scale > 1) {
      state.zoom.dragging = true;
      touchPanStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      updateZoomTransform();
    } else {
      state.zoom.dragging = false;
      updateZoomTransform();
    }
  });

  wrap.addEventListener('touchcancel', () => {
    pinchStart = null;
    touchPanStart = null;
    state.zoom.dragging = false;
    updateZoomTransform();
  });

  ['gesturestart', 'gesturechange', 'gestureend'].forEach((eventName) => {
    wrap.addEventListener(eventName, (e) => {
      e.preventDefault();
    }, { passive: false });
  });

  resetZoom();
}

// --- Feed zoom ---

const feedZoom = { scale: 1, offset: { x: 0, y: 0 }, dragging: false };
let feedDragStart = { x: 0, y: 0 };
let feedTouchPanStart = null;
let feedPinchStart = null;

export function openFeedZoom(imgSrc) {
  els.feedZoomImage.src = imgSrc;
  els.feedZoomOverlay.classList.remove('hidden');
  feedZoomResetState();
}

export function closeFeedZoom() {
  els.feedZoomOverlay.classList.add('hidden');
  els.feedZoomImage.src = '';
  feedZoomResetState();
}

function feedZoomApplyScale(nextScale) {
  const clamped = clampScale(nextScale);
  feedZoom.scale = clamped;
  if (clamped <= 1) {
    feedZoom.offset = { x: 0, y: 0 };
  }
  feedZoomUpdateTransform();
}

function feedZoomResetState() {
  feedZoom.scale = 1;
  feedZoom.offset = { x: 0, y: 0 };
  feedZoom.dragging = false;
  feedZoomUpdateTransform();
}

function feedZoomUpdateTransform() {
  const { scale, offset, dragging } = feedZoom;
  const img = els.feedZoomImage;
  img.style.transform = `translate(${offset.x}px, ${offset.y}px) scale(${scale})`;
  img.classList.toggle('dragging', dragging);

  if (scale > 1) {
    img.style.cursor = dragging ? 'grabbing' : 'grab';
  } else {
    img.style.cursor = 'zoom-in';
  }

  els.feedZoomLevel.textContent = `${Math.round(scale * 100)}%`;
  els.feedZoomSlider.value = String(Math.round(scale * 100));
}

export function initFeedZoom() {
  const wrap = els.feedZoomWrap;
  const overlay = els.feedZoomOverlay;

  const preventNativeFeedPinch = (e) => {
    if (overlay.classList.contains('hidden')) return;
    if (e.touches && e.touches.length < 2) return;
    e.preventDefault();
  };

  els.feedZoomClose.addEventListener('click', closeFeedZoom);
  els.feedZoomBackdrop.addEventListener('click', closeFeedZoom);

  document.querySelector('.feed-zoom-content').addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) closeFeedZoom();
  });

  els.feedZoomOut.addEventListener('click', () => feedZoomApplyScale(feedZoom.scale - 0.2));
  els.feedZoomIn.addEventListener('click', () => feedZoomApplyScale(feedZoom.scale + 0.2));
  els.feedZoomReset.addEventListener('click', feedZoomResetState);
  els.feedZoomSlider.addEventListener('input', () => {
    feedZoomApplyScale(Number(els.feedZoomSlider.value) / 100);
  });

  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.12 : 0.12;
    feedZoomApplyScale(feedZoom.scale + delta);
  }, { passive: false });

  els.feedZoomImage.addEventListener('mousedown', (e) => {
    e.preventDefault();
    clearSelection();
    if (feedZoom.scale <= 1) return;
    feedZoom.dragging = true;
    feedDragStart = { x: e.clientX, y: e.clientY };
    feedZoomUpdateTransform();
  });

  els.feedZoomImage.addEventListener('dragstart', (e) => e.preventDefault());

  wrap.addEventListener('mousemove', (e) => {
    if (!feedZoom.dragging || feedZoom.scale <= 1) return;
    feedZoom.offset.x += e.clientX - feedDragStart.x;
    feedZoom.offset.y += e.clientY - feedDragStart.y;
    feedDragStart = { x: e.clientX, y: e.clientY };
    feedZoomUpdateTransform();
  });

  wrap.addEventListener('mouseup', () => {
    feedZoom.dragging = false;
    feedZoomUpdateTransform();
  });

  wrap.addEventListener('mouseleave', () => {
    feedZoom.dragging = false;
    feedZoomUpdateTransform();
  });

  wrap.addEventListener('touchstart', (e) => {
    clearSelection();
    if (e.touches.length === 2) {
      e.preventDefault();
      feedZoom.dragging = true;
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      feedPinchStart = {
        distance: getTouchDistance(t1, t2),
        scale: feedZoom.scale,
        center: getTouchCenter(t1, t2),
        offset: { ...feedZoom.offset },
      };
      feedTouchPanStart = null;
      feedZoomUpdateTransform();
      return;
    }
    if (e.touches.length === 1 && feedZoom.scale > 1) {
      e.preventDefault();
      feedZoom.dragging = true;
      feedTouchPanStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      feedZoomUpdateTransform();
    }
  }, { passive: false });

  wrap.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && feedPinchStart) {
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const currentDist = getTouchDistance(t1, t2);
      const currentCenter = getTouchCenter(t1, t2);
      const ratio = currentDist / feedPinchStart.distance;
      feedZoom.scale = clampScale(feedPinchStart.scale * ratio);
      feedZoom.offset = {
        x: feedPinchStart.offset.x + (currentCenter.x - feedPinchStart.center.x),
        y: feedPinchStart.offset.y + (currentCenter.y - feedPinchStart.center.y),
      };
      feedZoomUpdateTransform();
      return;
    }
    if (e.touches.length === 1 && feedZoom.scale > 1 && feedTouchPanStart) {
      e.preventDefault();
      const touch = e.touches[0];
      feedZoom.offset.x += touch.clientX - feedTouchPanStart.x;
      feedZoom.offset.y += touch.clientY - feedTouchPanStart.y;
      feedTouchPanStart = { x: touch.clientX, y: touch.clientY };
      feedZoomUpdateTransform();
    }
  }, { passive: false });

  wrap.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) feedPinchStart = null;
    if (e.touches.length === 0) {
      feedTouchPanStart = null;
      feedZoom.dragging = false;
      feedZoomUpdateTransform();
    } else if (e.touches.length === 1 && feedZoom.scale > 1) {
      feedZoom.dragging = true;
      feedTouchPanStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      feedZoomUpdateTransform();
    } else {
      feedZoom.dragging = false;
      feedZoomUpdateTransform();
    }
  });

  wrap.addEventListener('touchcancel', () => {
    feedPinchStart = null;
    feedTouchPanStart = null;
    feedZoom.dragging = false;
    feedZoomUpdateTransform();
  });

  overlay.addEventListener('touchstart', preventNativeFeedPinch, { passive: false });
  overlay.addEventListener('touchmove', preventNativeFeedPinch, { passive: false });

  ['gesturestart', 'gesturechange', 'gestureend'].forEach((eventName) => {
    wrap.addEventListener(eventName, (e) => e.preventDefault(), { passive: false });
    overlay.addEventListener(eventName, preventNativeFeedPinch, { passive: false });
  });
}
