import { enc } from './util.js';

export const badgeUrl = (ep) => `/api/badges/${enc(ep)}.png`;
export const imageUrl = (s) => `/api/comics/${enc(s.endpoint)}/${enc(s.date)}/image`;

export async function getJson(path, ms = 30000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(path, { signal: ctl.signal });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      err.retryAfter = Number(res.headers.get('Retry-After')) || 0;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchStrip(ep, date) {
  const strip = await getJson(`/api/comics/${enc(ep)}/${enc(date)}`);
  const img = new Image();
  img.src = imageUrl(strip);
  await img.decode();
  return strip;
}

export const fetchRandom = (ep) => getJson(`/api/comics/${enc(ep)}/random`);

export const fetchRecommendations = (selected, limit) =>
  getJson(`/api/recommendations?selected=${enc(selected.join(','))}&limit=${limit}`, 10000);
