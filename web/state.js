const BADGE_COLORS = [
  '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c',
  '#3498db', '#9b59b6', '#e84393', '#fd79a8', '#00cec9',
  '#6c5ce7', '#fdcb6e', '#55a3e8', '#ff7675', '#a29bfe',
  '#fab1a0', '#74b9ff', '#81ecec', '#dfe6e9', '#b2bec3',
];

export function hashColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return BADGE_COLORS[Math.abs(hash) % BADGE_COLORS.length];
}

export const LS_SELECTED = 'panels_selected';
export const LS_THEME = 'panels_theme';
export const LS_SIDEBAR = 'panels_sidebar_collapsed';
export const LS_COLLAPSIBLES = 'panels_collapsibles';
export const LS_FAVORITES = 'panels_favorites';

export const state = {
  allComics: [],
  selectedEndpoints: new Set(),
  currentStrip: null,
  activeTags: new Set(),
  activeLetter: null,
  searchQuery: '',
  recommendations: [],
  recommendEnabled: false,
  isLoading: false,
  zoom: { scale: 1, offset: { x: 0, y: 0 }, dragging: false },
  currentView: 'panel',
  favorites: [],
  feed: {
    strips: [],
    seenKeys: new Set(),
    isLoadingBatch: false,
    lastSelectedSnapshot: null,
  },
};

export const recentStrips = [];
export const MAX_RECENT = 20;

export function stripKey(strip) {
  return `${strip.endpoint}:${strip.date}`;
}

export function trackStrip(strip) {
  const key = stripKey(strip);
  recentStrips.push(key);
  if (recentStrips.length > MAX_RECENT) recentStrips.shift();
}

export function loadFavorites() {
  try {
    const saved = localStorage.getItem(LS_FAVORITES);
    if (saved) state.favorites = JSON.parse(saved);
  } catch (e) {
    state.favorites = [];
  }
}

export function saveFavorites() {
  localStorage.setItem(LS_FAVORITES, JSON.stringify(state.favorites));
}

export function isFavorited(endpoint, date) {
  return state.favorites.some((f) => f.endpoint === endpoint && f.date === date);
}

export function saveSelected() {
  localStorage.setItem(LS_SELECTED, JSON.stringify(Array.from(state.selectedEndpoints)));
}
