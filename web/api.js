export async function fetchComics() {
  const res = await fetch('/api/comics');
  if (!res.ok) throw new Error('Failed to fetch comics');
  return res.json();
}

export async function fetchStrip(endpoint, date) {
  const res = await fetch(`/api/comics/${encodeURIComponent(endpoint)}/${encodeURIComponent(date)}`);
  if (!res.ok) throw new Error('Failed to fetch strip');
  return res.json();
}

export async function fetchRecommendations(endpoints, limit) {
  const selected = Array.from(endpoints).join(',');
  const res = await fetch(`/api/recommendations?selected=${encodeURIComponent(selected)}&limit=${limit}`);
  if (!res.ok) throw new Error('Failed to fetch recommendations');
  return res.json();
}
