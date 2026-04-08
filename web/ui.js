import { state, hashColor, saveSelected, LS_THEME, LS_SIDEBAR, LS_COLLAPSIBLES, LS_SELECTED, loadFavorites } from './state.js';
import { fetchRecommendations } from './api.js';
import { $$, mobileQuery, sidebarArrow } from './helpers.js';
import { els } from './els.js';

let searchTimeout = null;
let fuseIndex = null;
let onSelectionChanged = null;

export function setOnSelectionChanged(fn) {
  onSelectionChanged = fn;
}

export function loadState() {
  try {
    const saved = localStorage.getItem(LS_SELECTED);
    if (saved) {
      const arr = JSON.parse(saved);
      arr.forEach((ep) => state.selectedEndpoints.add(ep));
    }
  } catch (e) {}
  loadFavorites();

  const theme = localStorage.getItem(LS_THEME);
  if (theme) document.documentElement.setAttribute('data-theme', theme);

  const savedSidebar = localStorage.getItem(LS_SIDEBAR);
  const collapsed = savedSidebar === null ? mobileQuery.matches : savedSidebar === 'true';
  els.selectionPanel.classList.toggle('collapsed', collapsed);
  els.sidebarToggle.classList.toggle('collapsed', collapsed);
  document.body.classList.toggle('drawer-open', mobileQuery.matches && !collapsed);
  els.sidebarToggle.innerHTML = sidebarArrow(collapsed);
}

function saveTheme(theme) {
  localStorage.setItem(LS_THEME, theme);
}

function saveSidebar(collapsed) {
  localStorage.setItem(LS_SIDEBAR, String(collapsed));
}

function updateThemeButton() {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  els.themeToggle.innerHTML = theme === 'dark'
    ? '<i class="fa-solid fa-moon"></i>'
    : '<i class="fa-solid fa-sun"></i>';
}

export function initTheme() {
  updateThemeButton();
  els.themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    saveTheme(next);
    updateThemeButton();
  });
}

export function initSidebar() {
  const applySidebarState = (isCollapsed, persist) => {
    els.selectionPanel.classList.toggle('collapsed', isCollapsed);
    els.sidebarToggle.classList.toggle('collapsed', isCollapsed);
    document.body.classList.toggle('drawer-open', mobileQuery.matches && !isCollapsed);
    els.sidebarToggle.innerHTML = sidebarArrow(isCollapsed);
    if (persist) saveSidebar(isCollapsed);
  };

  els.sidebarToggle.addEventListener('click', () => {
    const isCollapsed = !els.selectionPanel.classList.contains('collapsed');
    applySidebarState(isCollapsed, true);
  });

  mobileQuery.addEventListener('change', (e) => {
    let isCollapsed = els.selectionPanel.classList.contains('collapsed');
    if (localStorage.getItem(LS_SIDEBAR) === null) {
      isCollapsed = e.matches;
      applySidebarState(isCollapsed, false);
    }
    document.body.classList.toggle('drawer-open', e.matches && !isCollapsed);
    els.sidebarToggle.innerHTML = sidebarArrow(isCollapsed);
  });

  document.addEventListener('pointerdown', (e) => {
    if (!mobileQuery.matches) return;
    if (els.selectionPanel.classList.contains('collapsed')) return;
    if (els.selectionPanel.contains(e.target) || els.sidebarToggle.contains(e.target)) return;
    applySidebarState(true, true);
  });
}

export function initCollapsibles() {
  let saved = {};
  try {
    const raw = localStorage.getItem(LS_COLLAPSIBLES);
    if (raw) saved = JSON.parse(raw) || {};
  } catch (e) {}

  const saveCollapsibles = () => {
    const next = {};
    document.querySelectorAll('.collapsible-header').forEach((h) => {
      if (!h.id) return;
      const section = h.closest('.collapsible-section');
      next[h.id] = section ? section.classList.contains('collapsed') : false;
    });
    localStorage.setItem(LS_COLLAPSIBLES, JSON.stringify(next));
  };

  document.querySelectorAll('.collapsible-header').forEach((header) => {
    const section = header.closest('.collapsible-section');
    if (section && saved[header.id] === true) {
      section.classList.add('collapsed');
    }

    header.addEventListener('click', () => {
      if (!section) return;
      section.classList.toggle('collapsed');
      saveCollapsibles();
    });
  });
}

export function buildTagFilters() {
  const tagSet = new Set();
  state.allComics.forEach((c) => c.tags.forEach((t) => tagSet.add(t)));
  const tags = Array.from(tagSet).sort();

  els.tagFilters.innerHTML = '';
  tags.forEach((tag) => {
    const color = hashColor(tag);
    const chip = document.createElement('button');
    chip.className = 'tag-chip';
    chip.textContent = tag;
    chip.dataset.tag = tag;
    chip.dataset.color = color;

    chip.addEventListener('click', () => {
      if (state.activeTags.has(tag)) {
        state.activeTags.delete(tag);
        chip.classList.remove('active');
        chip.style.background = '';
        chip.style.color = '';
        chip.style.borderColor = '';
      } else {
        state.activeTags.add(tag);
        chip.classList.add('active');
        chip.style.background = color;
        chip.style.color = '#fff';
        chip.style.borderColor = 'transparent';
      }
      renderBadgeGrid();
    });

    chip.addEventListener('dblclick', (e) => {
      e.preventDefault();
      state.activeTags.clear();
      $$('.tag-chip').forEach((c) => {
        c.classList.remove('active');
        c.style.background = '';
        c.style.color = '';
        c.style.borderColor = '';
      });
      renderBadgeGrid();
    });

    els.tagFilters.appendChild(chip);
  });
}

export function buildAlphaBar() {
  els.alphaBar.innerHTML = '';
  const letters = ['ALL', '#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];
  letters.forEach((letter) => {
    const btn = document.createElement('button');
    btn.className = 'alpha-btn';
    btn.textContent = letter;
    if (letter === 'ALL') btn.classList.add('active');
    btn.addEventListener('click', () => {
      if (letter === 'ALL') {
        state.activeLetter = null;
      } else {
        state.activeLetter = state.activeLetter === letter ? null : letter;
      }
      $$('.alpha-btn').forEach((b) => b.classList.remove('active'));
      if (state.activeLetter) {
        btn.classList.add('active');
      } else {
        els.alphaBar.querySelector('.alpha-btn').classList.add('active');
      }
      renderBadgeGrid();
    });
    els.alphaBar.appendChild(btn);
  });
}

export function initSearch() {
  els.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.searchQuery = els.searchInput.value.trim();
      renderBadgeGrid();
    }, 200);
    els.searchClear.classList.toggle('hidden', els.searchInput.value.length === 0);
  });

  els.searchClear.addEventListener('click', () => {
    els.searchInput.value = '';
    state.searchQuery = '';
    els.searchClear.classList.add('hidden');
    renderBadgeGrid();
    els.searchInput.focus();
  });
}

export function initRecommend() {
  els.recommendToggle.addEventListener('change', () => {
    state.recommendEnabled = els.recommendToggle.checked;
    if (state.recommendEnabled && state.selectedEndpoints.size > 0) {
      refreshRecommendations();
    } else {
      state.recommendations = [];
      renderBadgeGrid();
    }
  });

  els.luckyBtn.addEventListener('click', () => {
    const available = state.allComics.filter(
      (c) => c.available && !c.tags.some((t) => t === 'en-espanol')
    );
    if (available.length === 0) return;
    const count = Math.floor(Math.random() * 5) + 3;
    const shuffled = available.sort(() => Math.random() - 0.5);
    state.selectedEndpoints.clear();
    shuffled.slice(0, count).forEach((c) => state.selectedEndpoints.add(c.endpoint));
    saveSelected();
    renderBadgeGrid();
    updateNavVisibility();
    if (state.recommendEnabled) refreshRecommendations();
  });
}

export async function refreshRecommendations() {
  if (!state.recommendEnabled || state.selectedEndpoints.size === 0) {
    state.recommendations = [];
    return;
  }
  try {
    state.recommendations = await fetchRecommendations(state.selectedEndpoints, 10);
  } catch (e) {
    state.recommendations = [];
  }
  renderBadgeGrid();
}

function matchesTagAndAlphabet(c) {
  if (state.activeTags.size > 0 && !c.tags.some((t) => state.activeTags.has(t))) return false;
  if (state.activeLetter === '#' && !/^\d/.test(c.title)) return false;
  if (state.activeLetter && state.activeLetter !== '#' && !c.title.toUpperCase().startsWith(state.activeLetter)) return false;
  return true;
}

export function buildFuseIndex(comics) {
  fuseIndex = new Fuse(comics, {
    keys: [
      { name: 'title', weight: 1.0 },
      { name: 'author', weight: 0.8 },
      { name: 'keywords', weight: 0.6 },
      { name: 'tags', weight: 0.4 },
      { name: 'endpoint', weight: 0.3 },
    ],
    threshold: 0.4,
    ignoreLocation: true,
  });
}

export function renderBadgeGrid() {
  const isSearching = state.searchQuery.length > 0;

  document.body.classList.toggle('search-active', isSearching);
  els.badgeGrid.innerHTML = '';

  if (isSearching) {
    const selectedSet = new Set(state.selectedEndpoints);
    let allComics;
    if (fuseIndex) {
      const hits = fuseIndex.search(state.searchQuery);
      allComics = hits.map((r) => r.item).filter((c) => !selectedSet.has(c.endpoint));
    } else {
      const q = state.searchQuery.toLowerCase();
      allComics = state.allComics.filter((c) => !selectedSet.has(c.endpoint) && (c.title.toLowerCase().includes(q) || c.endpoint.toLowerCase().includes(q)));
    }
    if (allComics.length > 0) {
      appendSection(`[ results: ${allComics.length} ]`, allComics, '');
    }
    return;
  }

  const selectedComics = state.allComics.filter((c) => state.selectedEndpoints.has(c.endpoint));
  const recEndpoints = new Set(state.recommendations.map((r) => r.endpoint));
  const recommendedComics = state.recommendEnabled
    ? state.allComics.filter((c) => recEndpoints.has(c.endpoint) && !state.selectedEndpoints.has(c.endpoint))
    : [];
  const selectedSet = new Set([...state.selectedEndpoints, ...recEndpoints]);
  const allComics = state.allComics.filter((c) => !selectedSet.has(c.endpoint) && matchesTagAndAlphabet(c));

  if (selectedComics.length > 0) {
    appendSection(`[ selected: ${selectedComics.length} ]`, selectedComics, 'selected', true);
  }

  if (recommendedComics.length > 0) {
    appendSection('[ recommended ]', recommendedComics, 'recommended');
  }

  if (allComics.length > 0) {
    appendSection(`[ all comics: ${allComics.length} ]`, allComics, '');
  }
}

function appendSection(title, comics, badgeClass, showClear) {
  const header = document.createElement('div');
  header.className = 'badge-section-header';
  header.textContent = title;
  if (showClear) {
    const clearBtn = document.createElement('span');
    clearBtn.className = 'clear-selected';
    clearBtn.textContent = '\u00d7';
    clearBtn.title = 'Clear all selections';
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.selectedEndpoints.clear();
      saveSelected();
      state.recommendations = [];
      renderBadgeGrid();
      updateNavVisibility();
    });
    header.appendChild(clearBtn);
  }
  els.badgeGrid.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'badge-items';
  comics.forEach((comic) => {
    const badge = document.createElement('div');
    badge.className = 'badge';
    if (state.selectedEndpoints.has(comic.endpoint)) badge.classList.add('selected');
    if (badgeClass === 'recommended' && !state.selectedEndpoints.has(comic.endpoint)) badge.classList.add('recommended');
    badge.dataset.endpoint = comic.endpoint;

    const wrap = document.createElement('div');
    wrap.className = 'badge-img-wrap';

    const circle = document.createElement('div');
    circle.className = 'badge-circle';
    circle.style.background = hashColor(comic.endpoint);

    const img = document.createElement('img');
    img.className = 'badge-img';
    img.src = `/api/badges/${comic.endpoint}.png`;
    img.alt = comic.title;
    img.title = comic.title;
    img.loading = 'lazy';
    img.onerror = function () {
      this.style.display = 'none';
    };

    wrap.appendChild(circle);
    wrap.appendChild(img);

    const label = document.createElement('span');
    label.className = 'badge-label';
    label.textContent = comic.title;
    label.title = comic.title;

    badge.appendChild(wrap);
    badge.appendChild(label);
    badge.addEventListener('click', () => {
      if (state.selectedEndpoints.has(comic.endpoint)) {
        state.selectedEndpoints.delete(comic.endpoint);
      } else {
        state.selectedEndpoints.add(comic.endpoint);
      }
      saveSelected();
      renderBadgeGrid();
      updateNavVisibility();
      if (state.recommendEnabled) refreshRecommendations();
      if (onSelectionChanged) onSelectionChanged();
    });
    grid.appendChild(badge);
  });
  els.badgeGrid.appendChild(grid);
}

export function updateNavVisibility() {
  const count = state.selectedEndpoints.size;
  if (count === 0) {
    els.comicNavBar.classList.add('hidden');
    els.btnToday.classList.add('hidden');
    els.btnFavorite.classList.add('hidden');
    return;
  }
  els.comicNavBar.classList.remove('hidden');
  if (state.currentStrip || count === 1) {
    els.btnToday.classList.remove('hidden');
  } else {
    els.btnToday.classList.add('hidden');
  }
}
