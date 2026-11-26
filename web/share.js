import { imageUrl } from './api.js';
import { comicTitle, favKey, stripLabel } from './state.js';
import { $, stripPath } from './util.js';

const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
};
const CACHE_SIZE = 4;
const TOAST_MS = 2500;

const probe = new File([new Uint8Array(1)], 'probe.png', { type: 'image/png' });
const canShareFiles = Boolean(navigator.canShare?.({ files: [probe] }));
const canCopyImage = Boolean(navigator.clipboard?.write && window.ClipboardItem
  && (ClipboardItem.supports?.('image/png') ?? true));

const FILE_MODE = canShareFiles ? 'share' : canCopyImage ? 'copy' : null;
const LINK_MODE = navigator.share ? 'shareLink' : navigator.clipboard?.writeText ? 'copyLink' : null;
const LABEL = {
  share: 'Share strip', copy: 'Copy strip', shareLink: 'Share link', copyLink: 'Copy link',
};
const coarse = matchMedia('(pointer: coarse)');

let mode = FILE_MODE;

// A public instance can hand out links that preview the strip. Self-hosted copies usually sit on
// localhost or a home network, where a link means nothing to whoever receives it.
export function shareLinks() {
  mode = LINK_MODE;
}

// Touch share sheets already offer "Save Image", so a separate download button is redundant there.
export const shareSaves = () => mode === 'share' && coarse.matches;

const files = new Map();
let toastTimer;

export function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), TOAST_MS);
}

export function stripFile(strip) {
  const key = favKey(strip);
  const cached = files.get(key);
  if (cached) {
    files.delete(key);
    files.set(key, cached);
    return cached;
  }
  const file = fetch(imageUrl(strip)).then(async (res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const type = blob.type.split(';')[0] || 'image/jpeg';
    const name = `${strip.endpoint}-${strip.date}`.replace(/[^\w-]+/g, '');
    return new File([blob], `${name}.${EXT[type] ?? 'jpg'}`, { type });
  });
  file.catch(() => {
    if (files.get(key) === file) files.delete(key);
  });
  files.set(key, file);
  if (files.size > CACHE_SIZE) files.delete(files.keys().next().value);
  return file;
}

// Safari only lets the share sheet open right after a tap, so the file has to be ready before it.
export const warmShare = (strip) => {
  if (mode === 'share') stripFile(strip);
};

export function paintShare(btn) {
  btn.hidden = !mode;
  if (mode) btn.setAttribute('aria-label', LABEL[mode]);
}

export async function downloadStrip(strip) {
  try {
    const file = await stripFile(strip);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch {
    toast('Couldn\'t download this strip.');
  }
}

async function asPng(file) {
  if (file.type === 'image/png') return file;
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png');
  });
}

async function shareLink(strip) {
  const url = new URL(stripPath(strip, 'strip'), location.origin).href;
  if (mode === 'copyLink') {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied to the clipboard.');
    } catch {
      toast('Couldn\'t copy the link.');
    }
    return;
  }
  try {
    await navigator.share({ title: `${comicTitle(strip.endpoint)}, ${stripLabel(strip, 'long')}`, url });
  } catch (err) {
    if (err.name !== 'AbortError') toast('Couldn\'t share this strip.');
  }
}

export async function shareStrip(strip) {
  if (mode === 'shareLink' || mode === 'copyLink') {
    await shareLink(strip);
    return;
  }
  if (mode === 'copy') {
    try {
      // Browsers only take PNG on the clipboard. Passing the promise keeps the click's permission alive.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': stripFile(strip).then(asPng) })]);
      toast('Strip copied to the clipboard.');
    } catch {
      toast('Couldn\'t copy this strip.');
    }
    return;
  }
  try {
    // iOS drops "Save Image" from the share sheet when text rides along, so only the file goes.
    await navigator.share({ files: [await stripFile(strip)] });
  } catch (err) {
    if (err.name !== 'AbortError') toast('Couldn\'t share this strip.');
  }
}
